import crypto from 'node:crypto'
import path from 'node:path'
import type Database from 'better-sqlite3'
import type {
  ChecklistItem,
  ChecklistSection,
  ComponentStatus,
  DigitalTwinComponent,
  DigitalTwinComponentState,
  DigitalTwinDashboard,
  DigitalTwinDamageMarker,
  DigitalTwinLayerKey,
  DigitalTwinLayerState,
  DigitalTwinLogEntry,
  DigitalTwinModel,
  DigitalTwinSnapshot,
  DigitalTwinSnapshotType,
  DigitalTwinStatus,
  DigitalTwinTimelineEntry,
  InspectionFindingType,
  InspectionReviewStatus,
  PhotogrammetryJob,
  PhotogrammetryJobStatus,
  PhotogrammetryJobType,
  PhotoZipImport,
  UpdateDigitalTwinLayerInput,
  Vector3Tuple
} from '../../shared/types'

const twinLayers: DigitalTwinLayerKey[] = [
  'exterior',
  'interior',
  'engine',
  'chassis',
  'suspension',
  'electrical',
  'glass',
  'upholstery'
]

const stateColors: Record<DigitalTwinComponentState, string> = {
  uninspected: '#9a9a9a',
  pending: '#cc2f2f',
  damaged: '#f06b2f',
  purchased_or_repaired: '#d9b72f',
  in_process: '#2f6fcc',
  completed: '#2e8f4f'
}

type TwinRow = {
  id: string
  project_id: string
  name: string
  status: DigitalTwinStatus
  model_path: string
  source_media_json: string
  metadata_json: string
  created_at: string
  updated_at: string
}

type LayerRow = {
  id: string
  digital_twin_id: string
  layer: DigitalTwinLayerKey
  visible: 0 | 1
  opacity: number
  xray_enabled: 0 | 1
  updated_at: string
}

type PhotoZipImportRow = {
  id: string
  project_id: string
  filename: string
  original_path: string
  local_path: string
  imported_at: string
  size_bytes: number
  imported_count: number
  ignored_count: number
  status: PhotoZipImport['status']
  metadata_json: string
  created_at: string
  updated_at: string
}

type PhotogrammetryJobRow = {
  id: string
  project_id: string
  job_type: PhotogrammetryJobType
  status: PhotogrammetryJobStatus
  progress: number
  image_count: number
  zip_import_id: string | null
  model_path: string
  log_path: string
  logs_json: string
  error_message: string
  metadata_json: string
  created_at: string
  updated_at: string
}

type ComponentRow = {
  id: string
  digital_twin_id: string
  project_id: string
  source_finding_id: string | null
  source_asset_id: string | null
  name: string
  layer: DigitalTwinLayerKey
  state: DigitalTwinComponentState
  confidence: number
  position_json: string
  notes: string
  created_at: string
  updated_at: string
}

type DamageRow = {
  id: string
  digital_twin_id: string
  project_id: string
  source_finding_id: string | null
  source_asset_id: string | null
  damage_type: string
  severity: DigitalTwinComponentState
  confidence: number
  position_json: string
  created_at: string
}

type SnapshotRow = {
  id: string
  digital_twin_id: string
  project_id: string
  name: string
  snapshot_type: DigitalTwinSnapshotType
  component_state_json: string
  created_at: string
}

type ChecklistRow = {
  id: string
  project_id: string
  section: ChecklistSection
  title: string
  status: ComponentStatus
  notes: string
  completed_at: string | null
  created_at: string
  updated_at: string
}

type TimelineRow = {
  id: string
  title: string
  body: string
  occurred_at: string
  source: 'history' | 'snapshot'
}

export interface DigitalTwinSourceImage {
  id: string
  sourceKind: 'project_media' | 'inspection_asset'
  localPath: string
  filename: string
  mimeType: string
  createdAt: string
}

export interface DigitalTwinSourceFinding {
  id: string
  assetId: string
  findingType: InspectionFindingType
  workCategory: ChecklistSection
  name: string
  description: string
  confidence: number
  boundingBoxJson: string
  reviewStatus: InspectionReviewStatus
  checklistTitle: string
  createdChecklistItemId: string | null
}

export interface CreateDigitalTwinComponentRecord {
  projectId: string
  sourceFindingId: string | null
  sourceAssetId: string | null
  name: string
  layer: DigitalTwinLayerKey
  state: DigitalTwinComponentState
  confidence: number
  position: Vector3Tuple
  boundingBoxJson: string
  notes: string
  checklistItemId?: string | null
}

export interface CreateDigitalTwinDamageRecord {
  projectId: string
  sourceFindingId: string | null
  sourceAssetId: string | null
  damageType: string
  severity: DigitalTwinComponentState
  confidence: number
  position: Vector3Tuple
  boundingBoxJson: string
}

export class DigitalTwinRepository {
  constructor(private readonly database: Database.Database) {}

  getDashboard(projectId: string): DigitalTwinDashboard {
    const model = this.getLatestTwin(projectId)
    const zipImports = this.listPhotoZipImports(projectId)
    const photogrammetryJobs = this.listPhotogrammetryJobs(projectId)
    const logs = buildDashboardLogs(zipImports, photogrammetryJobs)

    if (!model) {
      return {
        model: null,
        layers: [],
        components: [],
        damageMarkers: [],
        snapshots: [],
        timeline: this.listTimeline(projectId),
        zipImports,
        photogrammetryJobs,
        logs,
        stats: {
          restorationEstimate: 0,
          sourceMediaCount: this.listSourceImages(projectId).length,
          componentCount: 0,
          damageCount: 0,
          linkedChecklistCount: 0
        }
      }
    }

    this.ensureDefaultLayers(model.id)
    this.syncChecklistLinks(model.id, projectId)

    const layers = this.listLayers(model.id)
    const components = this.listComponents(model.id, projectId)
    const damageMarkers = this.listDamageMarkers(model.id)
    const snapshots = this.listSnapshots(projectId)
    const linkedChecklistCount = new Set(components.flatMap((component) => component.checklistItemIds)).size

    return {
      model,
      layers,
      components,
      damageMarkers,
      snapshots,
      timeline: this.listTimeline(projectId),
      zipImports,
      photogrammetryJobs,
      logs,
      stats: {
        restorationEstimate: estimateRestorationFromComponents(components, damageMarkers.length),
        sourceMediaCount: model.sourceMediaCount,
        componentCount: components.length,
        damageCount: damageMarkers.length,
        linkedChecklistCount
      }
    }
  }

  createPhotoZipImport(input: {
    projectId: string
    filename: string
    originalPath: string
    localPath: string
    importedAt: string
    sizeBytes: number
    importedCount?: number
    ignoredCount?: number
    status?: PhotoZipImport['status']
    metadata?: Record<string, unknown>
  }): PhotoZipImport {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    this.database
      .prepare(
        `
        INSERT INTO project_photo_zip_imports (
          id, project_id, filename, original_path, local_path, imported_at, size_bytes,
          imported_count, ignored_count, status, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.projectId,
        input.filename,
        input.originalPath,
        input.localPath,
        input.importedAt,
        input.sizeBytes,
        input.importedCount ?? 0,
        input.ignoredCount ?? 0,
        input.status ?? 'imported',
        JSON.stringify(input.metadata ?? {}),
        now,
        now
      )

    return this.getPhotoZipImport(id)
  }

  updatePhotoZipImport(
    id: string,
    input: {
      importedCount?: number
      ignoredCount?: number
      status?: PhotoZipImport['status']
      metadata?: Record<string, unknown>
    }
  ): PhotoZipImport {
    const existing = this.getPhotoZipImport(id)
    const now = new Date().toISOString()

    this.database
      .prepare(
        `
        UPDATE project_photo_zip_imports
        SET imported_count = ?, ignored_count = ?, status = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        input.importedCount ?? existing.importedCount,
        input.ignoredCount ?? existing.ignoredCount,
        input.status ?? existing.status,
        JSON.stringify(input.metadata ?? existing.metadata),
        now,
        id
      )

    return this.getPhotoZipImport(id)
  }

  createPhotogrammetryJob(input: {
    projectId: string
    type: PhotogrammetryJobType
    status?: PhotogrammetryJobStatus
    progress?: number
    imageCount?: number
    zipImportId?: string | null
    modelPath?: string
    logPath?: string
    logs?: string[]
    errorMessage?: string
    metadata?: Record<string, unknown>
  }): PhotogrammetryJob {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    this.database
      .prepare(
        `
        INSERT INTO photogrammetry_jobs (
          id, project_id, job_type, status, progress, image_count, zip_import_id, model_path,
          log_path, logs_json, error_message, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.projectId,
        input.type,
        input.status ?? 'pending',
        input.progress ?? 0,
        input.imageCount ?? 0,
        input.zipImportId ?? null,
        input.modelPath ?? '',
        input.logPath ?? '',
        JSON.stringify(input.logs ?? []),
        input.errorMessage ?? '',
        JSON.stringify(input.metadata ?? {}),
        now,
        now
      )

    return this.getPhotogrammetryJob(id)
  }

  updatePhotogrammetryJob(
    id: string,
    input: Partial<Pick<PhotogrammetryJob, 'status' | 'progress' | 'imageCount' | 'modelPath' | 'logPath' | 'logs' | 'errorMessage'>>
  ): PhotogrammetryJob {
    const existing = this.getPhotogrammetryJob(id)
    const now = new Date().toISOString()

    this.database
      .prepare(
        `
        UPDATE photogrammetry_jobs
        SET status = ?, progress = ?, image_count = ?, model_path = ?, log_path = ?, logs_json = ?, error_message = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        input.status ?? existing.status,
        input.progress ?? existing.progress,
        input.imageCount ?? existing.imageCount,
        input.modelPath ?? existing.modelPath,
        input.logPath ?? existing.logPath,
        JSON.stringify(input.logs ?? existing.logs),
        input.errorMessage ?? existing.errorMessage,
        now,
        id
      )

    return this.getPhotogrammetryJob(id)
  }

  appendPhotogrammetryJobLog(id: string, line: string): PhotogrammetryJob {
    const existing = this.getPhotogrammetryJob(id)
    return this.updatePhotogrammetryJob(id, { logs: [...existing.logs, line] })
  }

  createProcessingTwin(projectId: string, name: string, sourceImages: DigitalTwinSourceImage[]): DigitalTwinModel {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    this.database
      .prepare(
        `
        INSERT INTO digital_twins (
          id, project_id, name, status, source_media_json, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, 'processing', ?, ?, ?, ?)
      `
      )
      .run(
        id,
        projectId,
        name,
        JSON.stringify(sourceImages.map((image) => ({ id: image.id, sourceKind: image.sourceKind }))),
        JSON.stringify({ engine: 'photogrammetry-external', status: 'waiting_for_photogrammetry_engine' }),
        now,
        now
      )

    this.ensureDefaultLayers(id)
    this.addHistoryEvent(projectId, 'digital_twin_started', 'Gemelo digital iniciado', name, now)
    return this.getTwin(id)
  }

  createPendingTwin(
    projectId: string,
    name: string,
    sourceImages: DigitalTwinSourceImage[],
    metadata: Record<string, unknown>
  ): DigitalTwinModel {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    this.database
      .prepare(
        `
        INSERT INTO digital_twins (
          id, project_id, name, status, source_media_json, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
      `
      )
      .run(
        id,
        projectId,
        name,
        JSON.stringify(sourceImages.map((image) => ({ id: image.id, sourceKind: image.sourceKind }))),
        JSON.stringify(metadata),
        now,
        now
      )

    this.ensureDefaultLayers(id)
    this.addHistoryEvent(projectId, 'digital_twin_prepared', 'Reconstruccion 3D preparada', name, now)
    return this.getTwin(id)
  }

  markTwinReady(
    id: string,
    modelPath: string,
    sourceImages: DigitalTwinSourceImage[],
    metadata: Record<string, unknown>
  ): DigitalTwinModel {
    const existing = this.getTwin(id)
    const now = new Date().toISOString()

    this.database
      .prepare(
        `
        UPDATE digital_twins
        SET status = 'ready', model_path = ?, source_media_json = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        modelPath,
        JSON.stringify(sourceImages.map((image) => ({ id: image.id, sourceKind: image.sourceKind }))),
        JSON.stringify(metadata),
        now,
        id
      )

    this.addHistoryEvent(existing.projectId, 'digital_twin_ready', 'Gemelo digital actualizado', existing.name, now)
    return this.getTwin(id)
  }

  markTwinFailed(id: string, errorMessage: string): DigitalTwinModel {
    const existing = this.getTwin(id)
    const now = new Date().toISOString()

    this.database
      .prepare(
        `
        UPDATE digital_twins
        SET status = 'failed', metadata_json = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(JSON.stringify({ ...existing.metadata, errorMessage }), now, id)

    this.addHistoryEvent(existing.projectId, 'digital_twin_failed', 'Gemelo digital fallido', errorMessage, now)
    return this.getTwin(id)
  }

  getTwin(id: string): DigitalTwinModel {
    const row = this.database.prepare('SELECT * FROM digital_twins WHERE id = ?').get(id) as TwinRow | undefined

    if (!row) {
      throw new Error('Gemelo digital no encontrado.')
    }

    return mapTwin(row)
  }

  getLatestTwin(projectId: string): DigitalTwinModel | null {
    const row = this.database
      .prepare(
        `
        SELECT *
        FROM digital_twins
        WHERE project_id = ? AND status != 'archived'
        ORDER BY updated_at DESC
        LIMIT 1
      `
      )
      .get(projectId) as TwinRow | undefined

    return row ? mapTwin(row) : null
  }

  listPhotoZipImports(projectId: string): PhotoZipImport[] {
    const rows = this.database
      .prepare(
        `
        SELECT *
        FROM project_photo_zip_imports
        WHERE project_id = ?
        ORDER BY imported_at DESC
        LIMIT 12
      `
      )
      .all(projectId) as PhotoZipImportRow[]

    return rows.map(mapPhotoZipImport)
  }

  getPhotoZipImport(id: string): PhotoZipImport {
    const row = this.database.prepare('SELECT * FROM project_photo_zip_imports WHERE id = ?').get(id) as
      | PhotoZipImportRow
      | undefined

    if (!row) {
      throw new Error('Importacion ZIP no encontrada.')
    }

    return mapPhotoZipImport(row)
  }

  listPhotogrammetryJobs(projectId: string): PhotogrammetryJob[] {
    const rows = this.database
      .prepare(
        `
        SELECT *
        FROM photogrammetry_jobs
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT 16
      `
      )
      .all(projectId) as PhotogrammetryJobRow[]

    return rows.map(mapPhotogrammetryJob)
  }

  getPhotogrammetryJob(id: string): PhotogrammetryJob {
    const row = this.database.prepare('SELECT * FROM photogrammetry_jobs WHERE id = ?').get(id) as
      | PhotogrammetryJobRow
      | undefined

    if (!row) {
      throw new Error('Job de fotogrametria no encontrado.')
    }

    return mapPhotogrammetryJob(row)
  }

  getPhotogrammetryJobLogs(id: string): string[] {
    return this.getPhotogrammetryJob(id).logs
  }

  getPhotogrammetryJobStatus(id: string): PhotogrammetryJobStatus {
    return this.getPhotogrammetryJob(id).status
  }

  getModelPath(id: string): string {
    const row = this.database
      .prepare('SELECT model_path FROM digital_twins WHERE id = ?')
      .get(id) as { model_path: string } | undefined

    if (!row?.model_path) {
      throw new Error('Modelo 3D no encontrado.')
    }

    return row.model_path
  }

  getModelRoot(id: string): string {
    return path.dirname(this.getModelPath(id))
  }

  updateLayer(input: UpdateDigitalTwinLayerInput): DigitalTwinLayerState {
    const existing = this.getLayer(input.id)
    const now = new Date().toISOString()

    this.database
      .prepare(
        `
        UPDATE digital_twin_layers
        SET visible = ?, opacity = ?, xray_enabled = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        input.visible === undefined ? Number(existing.visible) : Number(input.visible),
        clampOpacity(input.opacity ?? existing.opacity),
        input.xrayEnabled === undefined ? Number(existing.xrayEnabled) : Number(input.xrayEnabled),
        now,
        input.id
      )

    return this.getLayer(input.id)
  }

  replaceSceneEntities(
    digitalTwinId: string,
    projectId: string,
    components: CreateDigitalTwinComponentRecord[],
    damageMarkers: CreateDigitalTwinDamageRecord[]
  ): void {
    const now = new Date().toISOString()
    const replace = this.database.transaction(() => {
      this.database.prepare('DELETE FROM digital_twin_damage_markers WHERE digital_twin_id = ?').run(digitalTwinId)
      this.database.prepare('DELETE FROM digital_twin_components WHERE digital_twin_id = ?').run(digitalTwinId)

      const insertComponent = this.database.prepare(
        `
        INSERT INTO digital_twin_components (
          id, digital_twin_id, project_id, source_finding_id, source_asset_id, name,
          layer, state, confidence, position_json, bounding_box_json, notes, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      const insertLink = this.database.prepare(
        `
        INSERT OR IGNORE INTO digital_twin_component_checklist_links (
          id, digital_twin_component_id, checklist_item_id, created_at
        )
        VALUES (?, ?, ?, ?)
      `
      )
      const insertDamage = this.database.prepare(
        `
        INSERT INTO digital_twin_damage_markers (
          id, digital_twin_id, project_id, source_finding_id, source_asset_id, damage_type,
          severity, confidence, position_json, bounding_box_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )

      for (const component of components) {
        const id = crypto.randomUUID()
        insertComponent.run(
          id,
          digitalTwinId,
          projectId,
          component.sourceFindingId,
          component.sourceAssetId,
          component.name,
          component.layer,
          component.state,
          component.confidence,
          JSON.stringify(component.position),
          component.boundingBoxJson,
          component.notes,
          now,
          now
        )

        if (component.checklistItemId) {
          insertLink.run(crypto.randomUUID(), id, component.checklistItemId, now)
        }
      }

      for (const marker of damageMarkers) {
        insertDamage.run(
          crypto.randomUUID(),
          digitalTwinId,
          projectId,
          marker.sourceFindingId,
          marker.sourceAssetId,
          marker.damageType,
          marker.severity,
          marker.confidence,
          JSON.stringify(marker.position),
          marker.boundingBoxJson,
          now
        )
      }
    })

    replace()
  }

  createSnapshot(digitalTwinId: string, name: string, snapshotType: DigitalTwinSnapshotType): DigitalTwinSnapshot {
    const twin = this.getTwin(digitalTwinId)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const components = this.listComponents(digitalTwinId, twin.projectId).map((component) => ({
      id: component.id,
      name: component.name,
      layer: component.layer,
      state: component.state,
      color: component.color,
      checklistItemIds: component.checklistItemIds
    }))

    this.database
      .prepare(
        `
        INSERT INTO digital_twin_snapshots (
          id, digital_twin_id, project_id, name, snapshot_type, model_path, component_state_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        digitalTwinId,
        twin.projectId,
        name.trim() || 'Snapshot',
        snapshotType,
        this.getModelPath(digitalTwinId),
        JSON.stringify(components),
        now
      )

    this.addHistoryEvent(twin.projectId, 'digital_twin_snapshot', 'Snapshot del gemelo digital', name, now)
    return this.getSnapshot(id)
  }

  listSourceImages(projectId: string): DigitalTwinSourceImage[] {
    const projectMedia = this.database
      .prepare(
        `
        SELECT id, local_path, filename, mime_type, created_at
        FROM project_media
        WHERE project_id = ? AND kind = 'photo'
        ORDER BY created_at ASC
      `
      )
      .all(projectId) as Array<{
      id: string
      local_path: string
      filename: string
      mime_type: string
      created_at: string
    }>

    const inspectionAssets = this.database
      .prepare(
        `
        SELECT id, local_path, filename, mime_type, created_at
        FROM inspection_assets
        WHERE project_id = ? AND kind IN ('image', 'frame')
        ORDER BY created_at ASC
      `
      )
      .all(projectId) as Array<{
      id: string
      local_path: string
      filename: string
      mime_type: string
      created_at: string
    }>

    const sources = [
      ...projectMedia.map((row) => ({
        id: row.id,
        sourceKind: 'project_media' as const,
        localPath: row.local_path,
        filename: row.filename,
        mimeType: row.mime_type,
        createdAt: row.created_at
      })),
      ...inspectionAssets.map((row) => ({
        id: row.id,
        sourceKind: 'inspection_asset' as const,
        localPath: row.local_path,
        filename: row.filename,
        mimeType: row.mime_type,
        createdAt: row.created_at
      }))
    ]

    const seenPaths = new Set<string>()
    return sources
      .filter((source) => {
        if (seenPaths.has(source.localPath)) {
          return false
        }

        seenPaths.add(source.localPath)
        return true
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  listSourceFindings(projectId: string): DigitalTwinSourceFinding[] {
    const rows = this.database
      .prepare(
        `
        SELECT
          id,
          asset_id,
          finding_type,
          work_category,
          name,
          description,
          confidence,
          bounding_box_json,
          review_status,
          checklist_title,
          created_checklist_item_id
        FROM inspection_findings
        WHERE project_id = ? AND review_status != 'rejected'
        ORDER BY created_at ASC
      `
      )
      .all(projectId) as Array<{
      id: string
      asset_id: string
      finding_type: InspectionFindingType
      work_category: ChecklistSection
      name: string
      description: string
      confidence: number
      bounding_box_json: string
      review_status: InspectionReviewStatus
      checklist_title: string
      created_checklist_item_id: string | null
    }>

    return rows.map((row) => ({
      id: row.id,
      assetId: row.asset_id,
      findingType: row.finding_type,
      workCategory: row.work_category,
      name: row.name,
      description: row.description,
      confidence: row.confidence,
      boundingBoxJson: row.bounding_box_json,
      reviewStatus: row.review_status,
      checklistTitle: row.checklist_title,
      createdChecklistItemId: row.created_checklist_item_id
    }))
  }

  private ensureDefaultLayers(digitalTwinId: string): void {
    const existing = this.database
      .prepare('SELECT layer FROM digital_twin_layers WHERE digital_twin_id = ?')
      .all(digitalTwinId) as Array<{ layer: DigitalTwinLayerKey }>
    const existingLayers = new Set(existing.map((row) => row.layer))
    const now = new Date().toISOString()
    const insert = this.database.prepare(
      `
      INSERT INTO digital_twin_layers (
        id, digital_twin_id, layer, visible, opacity, xray_enabled, created_at, updated_at
      )
      VALUES (?, ?, ?, 1, 1, 0, ?, ?)
    `
    )

    for (const layer of twinLayers) {
      if (!existingLayers.has(layer)) {
        insert.run(crypto.randomUUID(), digitalTwinId, layer, now, now)
      }
    }
  }

  private listLayers(digitalTwinId: string): DigitalTwinLayerState[] {
    const rows = this.database
      .prepare(
        `
        SELECT id, digital_twin_id, layer, visible, opacity, xray_enabled, updated_at
        FROM digital_twin_layers
        WHERE digital_twin_id = ?
        ORDER BY CASE layer
          WHEN 'exterior' THEN 1
          WHEN 'interior' THEN 2
          WHEN 'engine' THEN 3
          WHEN 'chassis' THEN 4
          WHEN 'suspension' THEN 5
          WHEN 'electrical' THEN 6
          WHEN 'glass' THEN 7
          ELSE 8
        END
      `
      )
      .all(digitalTwinId) as LayerRow[]

    return rows.map(mapLayer)
  }

  private getLayer(id: string): DigitalTwinLayerState {
    const row = this.database
      .prepare(
        `
        SELECT id, digital_twin_id, layer, visible, opacity, xray_enabled, updated_at
        FROM digital_twin_layers
        WHERE id = ?
      `
      )
      .get(id) as LayerRow | undefined

    if (!row) {
      throw new Error('Capa no encontrada.')
    }

    return mapLayer(row)
  }

  private listComponents(digitalTwinId: string, projectId: string): DigitalTwinComponent[] {
    const rows = this.database
      .prepare(
        `
        SELECT *
        FROM digital_twin_components
        WHERE digital_twin_id = ?
        ORDER BY layer ASC, name ASC
      `
      )
      .all(digitalTwinId) as ComponentRow[]
    const checklistByComponent = this.getChecklistByComponent(rows.map((row) => row.id))
    const costByComponent = this.getCostsByComponentName(projectId, rows.map((row) => row.name))

    return rows.map((row) => {
      const linkedItems = checklistByComponent.get(row.id) ?? []
      const state = resolveComponentState(row.state, linkedItems)

      return {
        id: row.id,
        digitalTwinId: row.digital_twin_id,
        projectId: row.project_id,
        name: row.name,
        layer: row.layer,
        state,
        color: stateColors[state],
        confidence: row.confidence,
        sourceFindingId: row.source_finding_id,
        sourceAssetId: row.source_asset_id,
        sourceMediaUrl: row.source_asset_id ? `blackline-media://${row.source_asset_id}` : null,
        checklistItemIds: linkedItems.map((item) => item.id),
        pendingTaskCount: linkedItems.filter((item) => !isChecklistItemClosed(item)).length,
        costCents: costByComponent.get(normalizeText(row.name)) ?? 0,
        position: parseVector(row.position_json),
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    })
  }

  private listDamageMarkers(digitalTwinId: string): DigitalTwinDamageMarker[] {
    const rows = this.database
      .prepare(
        `
        SELECT *
        FROM digital_twin_damage_markers
        WHERE digital_twin_id = ?
        ORDER BY created_at ASC
      `
      )
      .all(digitalTwinId) as DamageRow[]

    return rows.map((row) => ({
      id: row.id,
      digitalTwinId: row.digital_twin_id,
      projectId: row.project_id,
      damageType: row.damage_type,
      severity: row.severity,
      confidence: row.confidence,
      sourceFindingId: row.source_finding_id,
      sourceAssetId: row.source_asset_id,
      sourceMediaUrl: row.source_asset_id ? `blackline-media://${row.source_asset_id}` : null,
      position: parseVector(row.position_json),
      createdAt: row.created_at
    }))
  }

  private listSnapshots(projectId: string): DigitalTwinSnapshot[] {
    const rows = this.database
      .prepare(
        `
        SELECT id, digital_twin_id, project_id, name, snapshot_type, component_state_json, created_at
        FROM digital_twin_snapshots
        WHERE project_id = ?
        ORDER BY created_at DESC
      `
      )
      .all(projectId) as SnapshotRow[]

    return rows.map(mapSnapshot)
  }

  private getSnapshot(id: string): DigitalTwinSnapshot {
    const row = this.database
      .prepare(
        `
        SELECT id, digital_twin_id, project_id, name, snapshot_type, component_state_json, created_at
        FROM digital_twin_snapshots
        WHERE id = ?
      `
      )
      .get(id) as SnapshotRow | undefined

    if (!row) {
      throw new Error('Snapshot no encontrado.')
    }

    return mapSnapshot(row)
  }

  private syncChecklistLinks(digitalTwinId: string, projectId: string): void {
    const components = this.database
      .prepare('SELECT id, name FROM digital_twin_components WHERE digital_twin_id = ?')
      .all(digitalTwinId) as Array<{ id: string; name: string }>
    const checklist = this.listChecklist(projectId)
    const now = new Date().toISOString()
    const insert = this.database.prepare(
      `
      INSERT OR IGNORE INTO digital_twin_component_checklist_links (
        id, digital_twin_component_id, checklist_item_id, created_at
      )
      VALUES (?, ?, ?, ?)
    `
    )

    for (const component of components) {
      const componentText = normalizeText(component.name)

      for (const item of checklist) {
        const itemText = normalizeText(item.title)

        if (itemText.includes(componentText) || componentText.includes(itemText)) {
          insert.run(crypto.randomUUID(), component.id, item.id, now)
        }
      }
    }
  }

  private getChecklistByComponent(componentIds: string[]): Map<string, ChecklistItem[]> {
    if (componentIds.length === 0) {
      return new Map()
    }

    const placeholders = componentIds.map(() => '?').join(', ')
    const rows = this.database
      .prepare(
        `
        SELECT
          dtccl.digital_twin_component_id,
          pci.*
        FROM digital_twin_component_checklist_links dtccl
        INNER JOIN project_checklist_items pci ON pci.id = dtccl.checklist_item_id
        WHERE dtccl.digital_twin_component_id IN (${placeholders})
        ORDER BY pci.created_at ASC
      `
      )
      .all(...componentIds) as Array<ChecklistRow & { digital_twin_component_id: string }>

    const map = new Map<string, ChecklistItem[]>()

    for (const row of rows) {
      const list = map.get(row.digital_twin_component_id) ?? []
      list.push(mapChecklist(row))
      map.set(row.digital_twin_component_id, list)
    }

    return map
  }

  private getCostsByComponentName(projectId: string, componentNames: string[]): Map<string, number> {
    const rows = this.database
      .prepare(
        `
        SELECT description, amount_cents
        FROM cost_entries
        WHERE project_id = ?
      `
      )
      .all(projectId) as Array<{ description: string; amount_cents: number }>
    const map = new Map<string, number>()

    for (const name of componentNames) {
      const normalizedName = normalizeText(name)
      const total = rows
        .filter((row) => normalizeText(row.description).includes(normalizedName))
        .reduce((sum, row) => sum + row.amount_cents, 0)

      if (total > 0) {
        map.set(normalizedName, total)
      }
    }

    return map
  }

  private listChecklist(projectId: string): ChecklistItem[] {
    const rows = this.database
      .prepare(
        `
        SELECT *
        FROM project_checklist_items
        WHERE project_id = ?
        ORDER BY created_at ASC
      `
      )
      .all(projectId) as ChecklistRow[]

    return rows.map(mapChecklist)
  }

  private listTimeline(projectId: string): DigitalTwinTimelineEntry[] {
    const rows = this.database
      .prepare(
        `
        SELECT id, title, body, occurred_at, 'history' as source
        FROM history_events
        WHERE project_id = ?
        UNION ALL
        SELECT id, name as title, snapshot_type as body, created_at as occurred_at, 'snapshot' as source
        FROM digital_twin_snapshots
        WHERE project_id = ?
        ORDER BY occurred_at ASC
      `
      )
      .all(projectId, projectId) as TimelineRow[]

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      occurredAt: row.occurred_at,
      source: row.source
    }))
  }

  private addHistoryEvent(projectId: string, eventType: string, title: string, body: string, occurredAt: string): void {
    this.database
      .prepare(
        `
        INSERT INTO history_events (
          id, project_id, event_type, title, body, occurred_at, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(crypto.randomUUID(), projectId, eventType, title, body, occurredAt, occurredAt)
  }
}

function mapTwin(row: TwinRow): DigitalTwinModel {
  const metadata = parseRecord(row.metadata_json)
  const sourceMedia = parseArray(row.source_media_json)
  const modelFilename = row.model_path ? path.basename(row.model_path) : ''

  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    status: row.status,
    modelUrl: row.model_path ? `blackline-model://${row.id}/${encodeURIComponent(modelFilename)}` : '',
    sourceMediaCount: sourceMedia.length,
    componentCount: Number(metadata.componentCount ?? 0),
    damageCount: Number(metadata.damageCount ?? 0),
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapPhotoZipImport(row: PhotoZipImportRow): PhotoZipImport {
  return {
    id: row.id,
    projectId: row.project_id,
    filename: row.filename,
    originalPath: row.original_path,
    localPath: row.local_path,
    importedAt: row.imported_at,
    sizeBytes: row.size_bytes,
    importedCount: row.imported_count,
    ignoredCount: row.ignored_count,
    status: row.status,
    metadata: parseRecord(row.metadata_json)
  }
}

function mapPhotogrammetryJob(row: PhotogrammetryJobRow): PhotogrammetryJob {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.job_type,
    status: row.status,
    progress: row.progress,
    imageCount: row.image_count,
    zipImportId: row.zip_import_id,
    modelPath: row.model_path,
    logPath: row.log_path,
    logs: parseStringArray(row.logs_json),
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function buildDashboardLogs(zipImports: PhotoZipImport[], jobs: PhotogrammetryJob[]): DigitalTwinLogEntry[] {
  const entries: DigitalTwinLogEntry[] = []

  for (const zipImport of zipImports) {
    entries.push({
      id: `zip-${zipImport.id}`,
      level: zipImport.status === 'error' ? 'error' : 'info',
      message: `ZIP seleccionado: ${zipImport.filename}. Fotos validas: ${zipImport.importedCount}. Ignoradas: ${zipImport.ignoredCount}.`,
      createdAt: zipImport.importedAt
    })
  }

  for (const job of jobs) {
    entries.push({
      id: `job-${job.id}`,
      level: job.status === 'error' ? 'error' : job.status === 'waiting_for_engine' ? 'warning' : 'info',
      message: `${labelJobType(job.type)}: ${labelJobStatus(job.status)} (${job.progress}%). Imagenes: ${job.imageCount}.`,
      createdAt: job.updatedAt
    })

    for (const [index, log] of job.logs.slice(-5).entries()) {
      entries.push({
        id: `job-${job.id}-log-${index}`,
        level: job.status === 'error' ? 'error' : job.status === 'waiting_for_engine' ? 'warning' : 'info',
        message: log,
        createdAt: job.updatedAt
      })
    }
  }

  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 24)
}

function labelJobType(type: PhotogrammetryJobType): string {
  return type === 'analysis' ? 'Analisis de imagenes' : 'Reconstruccion 3D'
}

function labelJobStatus(status: PhotogrammetryJobStatus): string {
  const labels: Record<PhotogrammetryJobStatus, string> = {
    pending: 'Pendiente',
    processing: 'Procesando',
    completed: 'Completado',
    error: 'Error',
    waiting_for_engine: 'Pendiente de motor'
  }

  return labels[status]
}

function mapLayer(row: LayerRow): DigitalTwinLayerState {
  return {
    id: row.id,
    digitalTwinId: row.digital_twin_id,
    layer: row.layer,
    visible: Boolean(row.visible),
    opacity: row.opacity,
    xrayEnabled: Boolean(row.xray_enabled),
    updatedAt: row.updated_at
  }
}

function mapSnapshot(row: SnapshotRow): DigitalTwinSnapshot {
  return {
    id: row.id,
    digitalTwinId: row.digital_twin_id,
    projectId: row.project_id,
    name: row.name,
    snapshotType: row.snapshot_type,
    componentStateJson: row.component_state_json,
    createdAt: row.created_at
  }
}

function mapChecklist(row: ChecklistRow): ChecklistItem {
  return {
    id: row.id,
    projectId: row.project_id,
    section: row.section,
    title: row.title,
    status: row.status,
    notes: row.notes,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function resolveComponentState(
  storedState: DigitalTwinComponentState,
  linkedItems: ChecklistItem[]
): DigitalTwinComponentState {
  if (linkedItems.length === 0) {
    return storedState
  }

  if (linkedItems.every(isChecklistItemClosed)) {
    return 'completed'
  }

  if (linkedItems.some((item) => item.status === 'purchased_or_repaired')) {
    return 'purchased_or_repaired'
  }

  if (linkedItems.some((item) => item.status === 'pending')) {
    return 'pending'
  }

  return storedState
}

function isChecklistItemClosed(item: ChecklistItem): boolean {
  return item.status === 'assembled' || item.status === 'completed'
}

function estimateRestorationFromComponents(components: DigitalTwinComponent[], damageCount: number): number {
  if (components.length === 0) {
    return Math.max(0, 100 - damageCount * 6)
  }

  const scoreByState: Record<DigitalTwinComponentState, number> = {
    uninspected: 40,
    pending: 20,
    damaged: 25,
    purchased_or_repaired: 68,
    in_process: 55,
    completed: 100
  }
  const componentScore = components.reduce((sum, component) => sum + scoreByState[component.state], 0) / components.length
  return Math.max(0, Math.min(100, Math.round(componentScore - damageCount * 2)))
}

function parseVector(value: string): Vector3Tuple {
  try {
    const parsed = JSON.parse(value) as Partial<Vector3Tuple>

    return {
      x: Number(parsed.x ?? 0),
      y: Number(parsed.y ?? 0),
      z: Number(parsed.z ?? 0)
    }
  } catch {
    return { x: 0, y: 0, z: 0 }
  }
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return {}
  }
}

function parseArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseStringArray(value: string): string[] {
  return parseArray(value).filter((item): item is string => typeof item === 'string')
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function clampOpacity(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1))
}
