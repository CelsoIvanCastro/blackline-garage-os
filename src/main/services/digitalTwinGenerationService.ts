import fs from 'node:fs'
import path from 'node:path'
import { app, nativeImage } from 'electron'
import type {
  BoundingBox,
  ChecklistSection,
  DigitalTwinComponentState,
  DigitalTwinLayerKey,
  DigitalTwinModel,
  DigitalTwinSnapshot,
  DigitalTwinSnapshotType,
  Vector3Tuple
} from '../../shared/types'
import {
  DigitalTwinRepository,
  type CreateDigitalTwinComponentRecord,
  type CreateDigitalTwinDamageRecord,
  type DigitalTwinSourceFinding,
  type DigitalTwinSourceImage
} from '../repositories/digitalTwinRepository'
import { ProjectRepository } from '../repositories/projectRepository'
import { ensureProjectDirectories } from './fileStorageService'
import { PhotogrammetryService } from './photogrammetryService'

interface PreparedPlane {
  source: DigitalTwinSourceImage
  textureUri: string
  width: number
  height: number
  angle: number
  radius: number
  center: Vector3Tuple
}

export class DigitalTwinGenerationService {
  constructor(
    private readonly digitalTwinRepository: DigitalTwinRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly photogrammetryService: PhotogrammetryService
  ) {}

  getDashboard(projectId: string) {
    this.projectRepository.getProjectById(projectId)
    return this.digitalTwinRepository.getDashboard(projectId)
  }

  async generate(projectId: string): Promise<DigitalTwinModel> {
    const sourceImages = this.digitalTwinRepository.listSourceImages(projectId)

    if (sourceImages.length === 0) {
      throw new Error('No hay fotos para reconstruccion. Sube imagenes o un ZIP con fotos del vehiculo antes de generar modelo 3D.')
    }

    return this.photogrammetryService.runReconstruction(
      projectId,
      sourceImages.map((image) => image.localPath)
    )

    /*try {
      const modelDirectory = path.join(getDigitalTwinStorageDirectory(), 'projects', projectId, twin.id)
      const texturesDirectory = path.join(modelDirectory, 'textures')
      fs.mkdirSync(texturesDirectory, { recursive: true })

      const preparedPlanes = preparePlanes(sourceImages, texturesDirectory)

      if (preparedPlanes.length === 0) {
        throw new Error('No se pudieron preparar texturas navegables desde los archivos cargados.')
      }

      const modelPath = path.join(modelDirectory, 'model.gltf')
      const gltf = buildPhotoSpaceGltf(preparedPlanes)
      fs.writeFileSync(modelPath, JSON.stringify(gltf, null, 2))

      const findings = this.digitalTwinRepository.listSourceFindings(projectId)
      const { components, damageMarkers } = buildSceneEntities(projectId, findings, preparedPlanes)
      this.digitalTwinRepository.replaceSceneEntities(twin.id, projectId, components, damageMarkers)

      return this.digitalTwinRepository.markTwinReady(twin.id, modelPath, sourceImages, {
        engine: 'blackline-photo-space-gltf-v1',
        sourceMediaCount: sourceImages.length,
        renderedPlaneCount: preparedPlanes.length,
        componentCount: components.length,
        damageCount: damageMarkers.length,
        photogrammetryReady: true,
        futurePipeline: ['COLMAP/OpenMVG export', 'dense reconstruction', 'GLB bake', 'OEM comparison']
      })
    } catch (error) {
      this.digitalTwinRepository.markTwinFailed(twin.id, error instanceof Error ? error.message : 'Fallo la generacion 3D.')
      throw error
    }*/
  }

  updateLayer(input: Parameters<DigitalTwinRepository['updateLayer']>[0]) {
    return this.digitalTwinRepository.updateLayer(input)
  }

  createSnapshot(digitalTwinId: string, name: string, snapshotType: DigitalTwinSnapshotType = 'milestone'): DigitalTwinSnapshot {
    return this.digitalTwinRepository.createSnapshot(digitalTwinId, name, snapshotType)
  }
}

export function getDigitalTwinStorageDirectory(): string {
  return path.join(app.getPath('documents'), 'BlacklineGarageOS', 'digital-twins')
}

function preparePlanes(sourceImages: DigitalTwinSourceImage[], texturesDirectory: string): PreparedPlane[] {
  const prepared: PreparedPlane[] = []
  const count = sourceImages.length
  const radius = Math.max(3.4, Math.min(8, count * 0.42))

  for (let index = 0; index < sourceImages.length; index += 1) {
    const source = sourceImages[index]
    const texture = writeTexture(source, texturesDirectory)

    if (!texture) {
      continue
    }

    const angle = (Math.PI * 2 * prepared.length) / Math.max(1, count)
    const center = {
      x: Math.sin(angle) * radius,
      y: 1.15,
      z: Math.cos(angle) * radius
    }
    prepared.push({
      source,
      textureUri: `textures/${texture.filename}`,
      width: texture.aspect >= 1 ? 1.95 : 1.42,
      height: texture.aspect >= 1 ? 1.32 : 1.95,
      angle,
      radius,
      center
    })
  }

  return prepared
}

function writeTexture(source: DigitalTwinSourceImage, texturesDirectory: string): { filename: string; aspect: number } | null {
  const image = nativeImage.createFromPath(source.localPath)

  if (!image.isEmpty()) {
    const size = image.getSize()
    const resized = size.width > 1600 ? image.resize({ width: 1600 }) : image
    const nextSize = resized.getSize()
    const filename = `${safeFilename(source.id)}.jpg`
    fs.writeFileSync(path.join(texturesDirectory, filename), resized.toJPEG(86))
    return { filename, aspect: nextSize.width / Math.max(1, nextSize.height) }
  }

  const extension = path.extname(source.localPath).toLowerCase()

  if (extension === '.jpg' || extension === '.jpeg' || extension === '.png') {
    const filename = `${safeFilename(source.id)}${extension === '.jpeg' ? '.jpg' : extension}`
    fs.copyFileSync(source.localPath, path.join(texturesDirectory, filename))
    return { filename, aspect: 1.45 }
  }

  return null
}

function buildSceneEntities(
  projectId: string,
  findings: DigitalTwinSourceFinding[],
  planes: PreparedPlane[]
): {
  components: CreateDigitalTwinComponentRecord[]
  damageMarkers: CreateDigitalTwinDamageRecord[]
} {
  const planeBySourceId = new Map(planes.map((plane) => [plane.source.id, plane]))
  const components: CreateDigitalTwinComponentRecord[] = []
  const damageMarkers: CreateDigitalTwinDamageRecord[] = []

  for (const finding of findings) {
    const plane = planeBySourceId.get(finding.assetId)

    if (!plane) {
      continue
    }

    const boundingBox = parseBoundingBox(finding.boundingBoxJson)
    const position = projectToPlane(plane, boundingBox)
    const layer = inferLayer(finding.name, finding.workCategory)

    if (finding.findingType === 'component') {
      components.push({
        projectId,
        sourceFindingId: finding.id,
        sourceAssetId: finding.assetId,
        name: finding.name,
        layer,
        state: finding.reviewStatus === 'approved' ? 'uninspected' : 'uninspected',
        confidence: finding.confidence,
        position,
        boundingBoxJson: finding.boundingBoxJson,
        notes: finding.description,
        checklistItemId: finding.createdChecklistItemId
      })
    }

    if (finding.findingType === 'missing_part') {
      components.push({
        projectId,
        sourceFindingId: finding.id,
        sourceAssetId: finding.assetId,
        name: finding.name,
        layer,
        state: 'pending',
        confidence: finding.confidence,
        position,
        boundingBoxJson: finding.boundingBoxJson,
        notes: finding.description,
        checklistItemId: finding.createdChecklistItemId
      })
      damageMarkers.push({
        projectId,
        sourceFindingId: finding.id,
        sourceAssetId: finding.assetId,
        damageType: `Pieza faltante: ${finding.name}`,
        severity: 'pending',
        confidence: finding.confidence,
        position,
        boundingBoxJson: finding.boundingBoxJson
      })
    }

    if (finding.findingType === 'damage') {
      damageMarkers.push({
        projectId,
        sourceFindingId: finding.id,
        sourceAssetId: finding.assetId,
        damageType: finding.name,
        severity: 'damaged',
        confidence: finding.confidence,
        position,
        boundingBoxJson: finding.boundingBoxJson
      })
    }

    if (finding.findingType === 'possible_modification') {
      damageMarkers.push({
        projectId,
        sourceFindingId: finding.id,
        sourceAssetId: finding.assetId,
        damageType: `Posible modificacion: ${finding.name}`,
        severity: 'in_process',
        confidence: finding.confidence,
        position,
        boundingBoxJson: finding.boundingBoxJson
      })
    }
  }

  return { components, damageMarkers }
}

function projectToPlane(plane: PreparedPlane, boundingBox: BoundingBox | null): Vector3Tuple {
  const centerX = boundingBox ? boundingBox.x + boundingBox.width / 2 : 0.5
  const centerY = boundingBox ? boundingBox.y + boundingBox.height / 2 : 0.5
  const localX = (centerX - 0.5) * plane.width
  const localY = (0.5 - centerY) * plane.height
  const right = { x: Math.cos(plane.angle), y: 0, z: -Math.sin(plane.angle) }
  const normal = { x: -Math.sin(plane.angle), y: 0, z: -Math.cos(plane.angle) }

  return {
    x: plane.center.x + right.x * localX + normal.x * 0.08,
    y: plane.center.y + localY,
    z: plane.center.z + right.z * localX + normal.z * 0.08
  }
}

function buildPhotoSpaceGltf(planes: PreparedPlane[]): Record<string, unknown> {
  const bytesPerPlane = 92
  const buffer = Buffer.alloc(bytesPerPlane * planes.length)
  const bufferViews: Array<Record<string, unknown>> = []
  const accessors: Array<Record<string, unknown>> = []
  const meshes: Array<Record<string, unknown>> = []
  const nodes: Array<Record<string, unknown>> = []
  const images: Array<Record<string, unknown>> = []
  const textures: Array<Record<string, unknown>> = []
  const materials: Array<Record<string, unknown>> = []

  for (let index = 0; index < planes.length; index += 1) {
    const plane = planes[index]
    const baseOffset = index * bytesPerPlane
    const positionOffset = baseOffset
    const uvOffset = baseOffset + 48
    const indexOffset = baseOffset + 80
    const halfWidth = plane.width / 2
    const halfHeight = plane.height / 2

    writeFloatArray(buffer, positionOffset, [
      -halfWidth,
      -halfHeight,
      0,
      halfWidth,
      -halfHeight,
      0,
      halfWidth,
      halfHeight,
      0,
      -halfWidth,
      halfHeight,
      0
    ])
    writeFloatArray(buffer, uvOffset, [0, 1, 1, 1, 1, 0, 0, 0])
    writeIndexArray(buffer, indexOffset, [0, 1, 2, 0, 2, 3])

    const positionView = bufferViews.push({ buffer: 0, byteOffset: positionOffset, byteLength: 48, target: 34962 }) - 1
    const uvView = bufferViews.push({ buffer: 0, byteOffset: uvOffset, byteLength: 32, target: 34962 }) - 1
    const indexView = bufferViews.push({ buffer: 0, byteOffset: indexOffset, byteLength: 12, target: 34963 }) - 1
    const positionAccessor =
      accessors.push({
        bufferView: positionView,
        componentType: 5126,
        count: 4,
        type: 'VEC3',
        min: [-halfWidth, -halfHeight, 0],
        max: [halfWidth, halfHeight, 0]
      }) - 1
    const uvAccessor =
      accessors.push({ bufferView: uvView, componentType: 5126, count: 4, type: 'VEC2', min: [0, 0], max: [1, 1] }) - 1
    const indexAccessor =
      accessors.push({ bufferView: indexView, componentType: 5123, count: 6, type: 'SCALAR', min: [0], max: [3] }) - 1
    const imageIndex = images.push({ uri: plane.textureUri }) - 1
    const textureIndex = textures.push({ source: imageIndex }) - 1
    const materialIndex =
      materials.push({
        name: `photo_material_${index + 1}`,
        pbrMetallicRoughness: {
          baseColorTexture: { index: textureIndex },
          metallicFactor: 0,
          roughnessFactor: 0.92
        },
        doubleSided: true
      }) - 1
    const meshIndex =
      meshes.push({
        name: `photo_plane_${index + 1}`,
        primitives: [
          {
            attributes: { POSITION: positionAccessor, TEXCOORD_0: uvAccessor },
            indices: indexAccessor,
            material: materialIndex
          }
        ]
      }) - 1
    const yaw = plane.angle + Math.PI

    nodes.push({
      name: `source_${plane.source.id}`,
      mesh: meshIndex,
      translation: [plane.center.x, plane.center.y, plane.center.z],
      rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
      extras: {
        sourceId: plane.source.id,
        sourceKind: plane.source.sourceKind,
        filename: plane.source.filename
      }
    })
  }

  return {
    asset: {
      version: '2.0',
      generator: 'BLACKLINE GARAGE OS photo-space GLTF'
    },
    scene: 0,
    scenes: [{ name: 'BLACKLINE Photo Space', nodes: nodes.map((_node, index) => index) }],
    nodes,
    meshes,
    materials,
    textures,
    images,
    bufferViews,
    accessors,
    buffers: [
      {
        byteLength: buffer.length,
        uri: `data:application/octet-stream;base64,${buffer.toString('base64')}`
      }
    ]
  }
}

function inferLayer(name: string, workCategory: ChecklistSection): DigitalTwinLayerKey {
  const normalized = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  if (normalized.includes('cristal') || normalized.includes('parabrisas') || normalized.includes('vidrio')) {
    return 'glass'
  }

  if (
    normalized.includes('tapicer') ||
    normalized.includes('asiento') ||
    normalized.includes('cabecera') ||
    normalized.includes('alfombra') ||
    normalized.includes('techo interior')
  ) {
    return 'upholstery'
  }

  if (normalized.includes('motor') || normalized.includes('cofre')) {
    return 'engine'
  }

  if (normalized.includes('chasis')) {
    return 'chassis'
  }

  if (normalized.includes('suspension') || normalized.includes('rin') || normalized.includes('llanta')) {
    return 'suspension'
  }

  if (workCategory === 'electrical') {
    return 'electrical'
  }

  if (workCategory === 'mechanical') {
    return 'engine'
  }

  if (workCategory === 'interior' || workCategory === 'sound') {
    return 'interior'
  }

  return 'exterior'
}

function parseBoundingBox(value: string): BoundingBox | null {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as BoundingBox
  } catch {
    return null
  }
}

function writeFloatArray(buffer: Buffer, offset: number, values: number[]): void {
  for (let index = 0; index < values.length; index += 1) {
    buffer.writeFloatLE(values[index], offset + index * 4)
  }
}

function writeIndexArray(buffer: Buffer, offset: number, values: number[]): void {
  for (let index = 0; index < values.length; index += 1) {
    buffer.writeUInt16LE(values[index], offset + index * 2)
  }
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}
