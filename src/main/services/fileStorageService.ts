import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, dialog, nativeImage } from 'electron'
import extractZip from 'extract-zip'
import type { DigitalTwinLogEntry, ImportProjectPhotoZipResult, MediaCategory, ProjectMedia } from '../../shared/types'
import { DigitalTwinRepository } from '../repositories/digitalTwinRepository'
import { ProjectRepository } from '../repositories/projectRepository'

const supportedImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp'])
const supportedImageFilters = [{ name: 'Fotografias', extensions: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'] }]
const minimumRecommendedPhotos = 50

export class FileStorageService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly digitalTwinRepository: DigitalTwinRepository
  ) {}

  async importPhotos(projectId: string, category: MediaCategory): Promise<ProjectMedia[]> {
    this.repository.getProjectById(projectId)
    const result = await dialog.showOpenDialog({
      title: 'Seleccionar fotografias',
      properties: ['openFile', 'multiSelections'],
      filters: supportedImageFilters
    })

    if (result.canceled || result.filePaths.length === 0) {
      return []
    }

    const directories = ensureProjectDirectories(projectId)

    const imported: ProjectMedia[] = []

    for (const sourcePath of result.filePaths) {
      const importedItem = this.importOnePhoto(projectId, category, sourcePath, directories.photos)
      if (importedItem) {
        imported.push(importedItem)
      }
    }

    return imported
  }

  async importPhotoZip(projectId: string, category: MediaCategory): Promise<ImportProjectPhotoZipResult> {
    const project = this.repository.getProjectById(projectId)
    console.info('Abriendo Finder')
    const result = await dialog.showOpenDialog({
      title: 'Seleccionar ZIP de fotos del vehículo',
      properties: ['openFile'],
      filters: [{ name: 'ZIP de fotos', extensions: ['zip'] }]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return {
        imported: [],
        importedCount: 0,
        ignoredCount: 0,
        zipFilename: '',
        zipImport: null,
        analysisJob: null,
        reconstructionJob: null,
        logs: [],
        warning: null,
        message: 'Importacion cancelada.'
      }
    }

    const sourceZipPath = result.filePaths[0]
    console.info(`ZIP seleccionado: ${sourceZipPath}`)
    const extension = path.extname(sourceZipPath).toLowerCase()

    if (extension !== '.zip') {
      throw new Error('Selecciona un archivo ZIP valido.')
    }

    const directories = ensureProjectDirectories(projectId)
    const importedAt = new Date().toISOString()
    const importId = `import-${timestamp()}`
    const storedZipPath = path.join(directories.zips, `${importId}-${sanitizeFilename(path.basename(sourceZipPath))}`)
    const importDirectory = path.join(directories.photos, importId)
    fs.copyFileSync(sourceZipPath, storedZipPath)
    console.info(`ZIP copiado: ${storedZipPath}`)
    fs.mkdirSync(importDirectory, { recursive: true })
    const zipStats = fs.statSync(storedZipPath)
    const zipImport = this.digitalTwinRepository.createPhotoZipImport({
      projectId,
      filename: path.basename(sourceZipPath),
      originalPath: sourceZipPath,
      localPath: storedZipPath,
      importedAt,
      sizeBytes: zipStats.size,
      metadata: {
        importDirectory,
        category
      }
    })

    try {
      await extractZip(storedZipPath, { dir: importDirectory })
      console.info(`ZIP extraído: ${importDirectory}`)
      const extractedFiles = walkFiles(importDirectory)
      const imported: ProjectMedia[] = []
      let ignoredCount = 0

      for (const filePath of extractedFiles) {
        const importedItem = this.importOnePhoto(projectId, category, filePath, importDirectory, 'zip')

        if (importedItem) {
          imported.push(importedItem)
        } else {
          ignoredCount += 1
        }
      }

      if (imported.length === 0) {
        throw new Error('El ZIP no contiene imagenes compatibles JPG, JPEG, PNG, HEIC o WEBP.')
      }

      console.info(`Imágenes importadas: ${imported.length}`)

      const warning =
        imported.length < minimumRecommendedPhotos
          ? 'Se recomienda usar al menos 50 fotos desde distintos ángulos para un mejor modelo 3D.'
          : null
      const completedZipImport = this.digitalTwinRepository.updatePhotoZipImport(zipImport.id, {
        importedCount: imported.length,
        ignoredCount,
        status: 'imported',
        metadata: {
          importDirectory,
          category,
          warning
        }
      })
      const sourceImages = this.digitalTwinRepository.listSourceImages(projectId)
      const logPath = path.join(directories.logs, `${timestamp()}-zip-reconstruction-prepared.log`)
      const message = 'Se importaron ' + imported.length + ' imágenes correctamente.'
      const logs = [
        `ZIP seleccionado: ${path.basename(sourceZipPath)}`,
        `Ruta local ZIP: ${storedZipPath}`,
        `Fotos extraídas: ${extractedFiles.length}`,
        `Fotos válidas: ${imported.length}`,
        `Fotos ignoradas: ${ignoredCount}`,
        warning ?? 'Cantidad de fotos suficiente para iniciar reconstrucción.',
        'Reconstrucción 3D preparada. Falta configurar motor de fotogrametría si no existe uno activo.',
        'Motores compatibles preparados: COLMAP, Meshroom u OpenMVG.'
      ]
      fs.writeFileSync(logPath, logs.join('\n'))
      const analysisJob = this.digitalTwinRepository.createPhotogrammetryJob({
        projectId,
        type: 'analysis',
        status: 'completed',
        progress: 100,
        imageCount: imported.length,
        zipImportId: zipImport.id,
        logPath,
        logs
      })
      const reconstructionJob = this.digitalTwinRepository.createPendingTwin(
        projectId,
        `${project.projectName} - Reconstruccion 3D`,
        sourceImages,
        {
          source: 'zip_import',
          zipPath: storedZipPath,
          logPath,
          importDirectory,
          analysisJobId: analysisJob.id,
          importedCount: imported.length,
          ignoredCount,
          photogrammetryReady: true,
          requiredEngine: 'COLMAP/Meshroom/OpenMVG',
          message,
          warning
        }
      )

      return {
        imported,
        importedCount: imported.length,
        ignoredCount,
        zipFilename: path.basename(sourceZipPath),
        zipImport: completedZipImport,
        analysisJob,
        reconstructionJob,
        logs: toLogEntries(logs, analysisJob.id),
        warning,
        message
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo importar el ZIP.'
      const logs = [
        `ZIP seleccionado: ${path.basename(sourceZipPath)}`,
        `Ruta local ZIP: ${storedZipPath}`,
        message
      ]
      this.digitalTwinRepository.updatePhotoZipImport(zipImport.id, {
        status: 'error',
        importedCount: 0,
        ignoredCount: 0,
        metadata: {
          importDirectory,
          category,
          errorMessage: message
        }
      })
      this.digitalTwinRepository.createPhotogrammetryJob({
        projectId,
        type: 'analysis',
        status: 'error',
        progress: 100,
        imageCount: 0,
        zipImportId: zipImport.id,
        logs,
        errorMessage: message
      })
      throw error
    }
  }

  deleteMedia(id: string): void {
    const localPath = this.repository.deleteMedia(id)

    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath)
    }
  }

  deleteProjectFiles(projectId: string): void {
    const projectDirectory = path.join(getStorageDirectory(), 'projects', projectId)

    if (fs.existsSync(projectDirectory)) {
      fs.rmSync(projectDirectory, { recursive: true, force: true })
    }
  }

  private importOnePhoto(
    projectId: string,
    category: MediaCategory,
    sourcePath: string,
    destinationDirectory: string,
    source: ProjectMedia['source'] = 'manual'
  ): ProjectMedia | null {
    const extension = path.extname(sourcePath).toLowerCase()

    if (!supportedImageExtensions.has(extension)) {
      return null
    }

    fs.mkdirSync(destinationDirectory, { recursive: true })
    const destinationPath =
      source === 'zip' ? sourcePath : path.join(destinationDirectory, `${timestamp()}-${crypto.randomUUID()}${extension}`)

    if (source !== 'zip') {
      fs.copyFileSync(sourcePath, destinationPath)
    }

    const dimensions = getImageDimensions(destinationPath)

    return this.repository.createMediaRecord({
      projectId,
      category,
      localPath: destinationPath,
      filename: path.basename(sourcePath),
      mimeType: inferMimeType(extension),
      hash: hashFile(destinationPath),
      source,
      width: dimensions.width,
      height: dimensions.height,
      status: 'imported'
    })
  }
}

export function getStorageDirectory(): string {
  return path.join(app.getPath('documents'), 'BlacklineGarageOS')
}

export function getProjectStorageDirectories(projectId: string): Record<'root' | 'photos' | 'zips' | 'models' | 'documents' | 'logs', string> {
  const root = path.join(getStorageDirectory(), 'projects', projectId)

  return {
    root,
    photos: path.join(root, 'photos'),
    zips: path.join(root, 'zips'),
    models: path.join(root, 'models'),
    documents: path.join(root, 'documents'),
    logs: path.join(root, 'logs')
  }
}

export function ensureProjectDirectories(projectId: string): ReturnType<typeof getProjectStorageDirectories> {
  const directories = getProjectStorageDirectories(projectId)

  for (const directory of Object.values(directories)) {
    fs.mkdirSync(directory, { recursive: true })
  }

  return directories
}

function hashFile(filePath: string): string {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function inferMimeType(extension: string): string {
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.heic':
    case '.heif':
      return 'image/heic'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

function walkFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }

  return files
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function getImageDimensions(filePath: string): { width: number | null; height: number | null } {
  const image = nativeImage.createFromPath(filePath)

  if (image.isEmpty()) {
    return { width: null, height: null }
  }

  const size = image.getSize()
  return {
    width: size.width || null,
    height: size.height || null
  }
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, '-')
}

function toLogEntries(lines: string[], sourceId: string): DigitalTwinLogEntry[] {
  const createdAt = new Date().toISOString()

  return lines.map((message, index) => ({
    id: `${sourceId}-${index}`,
    level: message.toLowerCase().includes('recomienda') ? 'warning' : 'info',
    message,
    createdAt
  }))
}
