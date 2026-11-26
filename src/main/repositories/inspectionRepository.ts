import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  BoundingBox,
  ChecklistSection,
  InspectionAsset,
  InspectionAssetKind,
  InspectionDashboard,
  InspectionFinding,
  InspectionFindingType,
  InspectionReviewStatus,
  InspectionRun,
  InspectionRunStatus,
  UpdateInspectionFindingInput
} from '../../shared/types'

type InspectionRunRow = {
  id: string
  project_id: string
  status: InspectionRunStatus
  progress: number
  model_name: string
  summary: string
  restoration_estimate: number
  assets_total: number
  processed_assets: number
  component_count: number
  damage_count: number
  missing_part_count: number
  possible_modification_count: number
  created_at: string
  updated_at: string
  completed_at: string | null
  error_message: string
}

type InspectionAssetRow = {
  id: string
  run_id: string
  project_id: string
  kind: InspectionAssetKind
  local_path: string
  filename: string
  mime_type: string
  frame_timestamp_seconds: number | null
  captured_at: string | null
  created_at: string
  component_count: number
  damage_count: number
}

type InspectionFindingRow = {
  id: string
  run_id: string
  asset_id: string
  project_id: string
  finding_type: InspectionFindingType
  work_category: ChecklistSection
  name: string
  description: string
  confidence: number
  bounding_box_json: string
  review_status: InspectionReviewStatus
  suggested_action: string
  checklist_title: string
  created_checklist_item_id: string | null
  created_at: string
  reviewed_at: string | null
}

export interface CreateInspectionAssetInput {
  runId: string
  projectId: string
  kind: InspectionAssetKind
  localPath: string
  filename: string
  mimeType: string
  hash: string
  frameTimestampSeconds?: number | null
  sourceAssetId?: string | null
  metadataJson?: string
}

export interface CreateInspectionFindingInput {
  runId: string
  assetId: string
  projectId: string
  findingType: InspectionFindingType
  workCategory: ChecklistSection
  name: string
  description: string
  confidence: number
  boundingBox: BoundingBox | null
  suggestedAction: string
  checklistTitle: string
  metadataJson?: string
}

export class InspectionRepository {
  constructor(private readonly database: Database.Database) {}

  getDashboard(projectId: string): InspectionDashboard {
    return {
      runs: this.listRuns(projectId),
      assets: this.listAssets(projectId),
      findings: this.listFindings(projectId)
    }
  }

  createRun(projectId: string, modelName: string): InspectionRun {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    this.database
      .prepare(
        `
        INSERT INTO inspection_runs (
          id, project_id, status, model_name, progress, created_at, updated_at
        )
        VALUES (?, ?, 'pending', ?, 0, ?, ?)
      `
      )
      .run(id, projectId, modelName, now, now)

    this.addHistoryEvent(projectId, 'ai_inspection_created', 'Inspeccion inteligente creada', modelName, now)
    return this.getRun(id)
  }

  startRun(id: string, assetsTotal: number): void {
    const now = new Date().toISOString()
    this.database
      .prepare(
        `
        UPDATE inspection_runs
        SET status = 'running', progress = 1, assets_total = ?, processed_assets = 0, updated_at = ?
        WHERE id = ?
      `
      )
      .run(assetsTotal, now, id)
  }

  updateRunProgress(id: string, processedAssets: number, assetsTotal: number): void {
    const progress = assetsTotal > 0 ? Math.min(95, Math.round((processedAssets / assetsTotal) * 95)) : 95
    this.database
      .prepare(
        `
        UPDATE inspection_runs
        SET processed_assets = ?, assets_total = ?, progress = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(processedAssets, assetsTotal, progress, new Date().toISOString(), id)
  }

  completeRun(id: string): InspectionRun {
    const run = this.getRun(id)
    const counts = this.getFindingCounts(id)
    const now = new Date().toISOString()
    const restorationEstimate = estimateRestoration(counts.damage, counts.missingPart, counts.possibleModification)
    const summary = [
      `${counts.component} componente(s) visible(s)`,
      `${counts.damage} dano(s) detectado(s)`,
      `${counts.missingPart} pieza(s) posiblemente faltante(s)`,
      `${counts.possibleModification} posible(s) modificacion(es)`
    ].join('. ')

    this.database
      .prepare(
        `
        UPDATE inspection_runs
        SET
          status = 'completed',
          progress = 100,
          summary = ?,
          restoration_estimate = ?,
          component_count = ?,
          damage_count = ?,
          missing_part_count = ?,
          possible_modification_count = ?,
          completed_at = ?,
          updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        summary,
        restorationEstimate,
        counts.component,
        counts.damage,
        counts.missingPart,
        counts.possibleModification,
        now,
        now,
        id
      )

    this.addHistoryEvent(run.projectId, 'ai_inspection_completed', 'Inspeccion inteligente completada', summary, now)
    return this.getRun(id)
  }

  failRun(id: string, errorMessage: string): InspectionRun {
    const now = new Date().toISOString()
    this.database
      .prepare(
        `
        UPDATE inspection_runs
        SET status = 'failed', error_message = ?, updated_at = ?, completed_at = ?
        WHERE id = ?
      `
      )
      .run(errorMessage, now, now, id)

    return this.getRun(id)
  }

  createAsset(input: CreateInspectionAssetInput): InspectionAsset {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    this.database
      .prepare(
        `
        INSERT INTO inspection_assets (
          id, run_id, project_id, kind, local_path, filename, mime_type, hash,
          frame_timestamp_seconds, source_asset_id, metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.runId,
        input.projectId,
        input.kind,
        input.localPath,
        input.filename,
        input.mimeType,
        input.hash,
        input.frameTimestampSeconds ?? null,
        input.sourceAssetId ?? null,
        input.metadataJson ?? '{}',
        now
      )

    return this.getAsset(id)
  }

  createFinding(input: CreateInspectionFindingInput): InspectionFinding {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    this.database
      .prepare(
        `
        INSERT INTO inspection_findings (
          id, run_id, asset_id, project_id, finding_type, work_category, name,
          description, confidence, bounding_box_json, suggested_action, checklist_title,
          metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.runId,
        input.assetId,
        input.projectId,
        input.findingType,
        input.workCategory,
        input.name,
        input.description,
        input.confidence,
        input.boundingBox ? JSON.stringify(input.boundingBox) : '',
        input.suggestedAction,
        input.checklistTitle,
        input.metadataJson ?? '{}',
        now
      )

    return this.getFinding(id)
  }

  getRun(id: string): InspectionRun {
    const row = this.database.prepare('SELECT * FROM inspection_runs WHERE id = ?').get(id) as InspectionRunRow | undefined

    if (!row) {
      throw new Error('Inspeccion no encontrada.')
    }

    return mapRun(row)
  }

  getAsset(id: string): InspectionAsset {
    const row = this.database
      .prepare(
        `
        SELECT
          ia.*,
          COALESCE(SUM(CASE WHEN ifn.finding_type = 'component' THEN 1 ELSE 0 END), 0) as component_count,
          COALESCE(SUM(CASE WHEN ifn.finding_type = 'damage' THEN 1 ELSE 0 END), 0) as damage_count
        FROM inspection_assets ia
        LEFT JOIN inspection_findings ifn ON ifn.asset_id = ia.id
        WHERE ia.id = ?
        GROUP BY ia.id
      `
      )
      .get(id) as InspectionAssetRow | undefined

    if (!row) {
      throw new Error('Archivo de inspeccion no encontrado.')
    }

    return mapAsset(row)
  }

  getFinding(id: string): InspectionFinding {
    const row = this.database
      .prepare('SELECT * FROM inspection_findings WHERE id = ?')
      .get(id) as InspectionFindingRow | undefined

    if (!row) {
      throw new Error('Hallazgo no encontrado.')
    }

    return mapFinding(row)
  }

  getAssetPath(id: string): string {
    const row = this.database
      .prepare('SELECT local_path FROM inspection_assets WHERE id = ?')
      .get(id) as { local_path: string } | undefined

    if (!row) {
      throw new Error('Archivo de inspeccion no encontrado.')
    }

    return row.local_path
  }

  updateFinding(input: UpdateInspectionFindingInput): InspectionFinding {
    const existing = this.getFinding(input.id)
    const now = new Date().toISOString()

    this.database
      .prepare(
        `
        UPDATE inspection_findings
        SET
          name = ?,
          description = ?,
          work_category = ?,
          suggested_action = ?,
          checklist_title = ?
        WHERE id = ?
      `
      )
      .run(
        input.name ?? existing.name,
        input.description ?? existing.description,
        input.workCategory ?? existing.workCategory,
        input.suggestedAction ?? existing.suggestedAction,
        input.checklistTitle ?? existing.checklistTitle,
        input.id
      )

    this.addHistoryEvent(existing.projectId, 'ai_finding_edited', 'Hallazgo IA editado', existing.name, now)
    return this.getFinding(input.id)
  }

  markFinding(id: string, reviewStatus: InspectionReviewStatus, createdChecklistItemId?: string): InspectionFinding {
    const existing = this.getFinding(id)
    const now = new Date().toISOString()

    this.database
      .prepare(
        `
        UPDATE inspection_findings
        SET review_status = ?, created_checklist_item_id = ?, reviewed_at = ?
        WHERE id = ?
      `
      )
      .run(reviewStatus, createdChecklistItemId ?? existing.createdChecklistItemId, now, id)

    this.addHistoryEvent(
      existing.projectId,
      reviewStatus === 'approved' ? 'ai_finding_approved' : 'ai_finding_rejected',
      reviewStatus === 'approved' ? 'Hallazgo IA aprobado' : 'Hallazgo IA rechazado',
      existing.name,
      now
    )

    return this.getFinding(id)
  }

  listRuns(projectId: string): InspectionRun[] {
    const rows = this.database
      .prepare('SELECT * FROM inspection_runs WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as InspectionRunRow[]

    return rows.map(mapRun)
  }

  listAssets(projectId: string): InspectionAsset[] {
    const rows = this.database
      .prepare(
        `
        SELECT
          ia.*,
          COALESCE(SUM(CASE WHEN ifn.finding_type = 'component' THEN 1 ELSE 0 END), 0) as component_count,
          COALESCE(SUM(CASE WHEN ifn.finding_type = 'damage' THEN 1 ELSE 0 END), 0) as damage_count
        FROM inspection_assets ia
        LEFT JOIN inspection_findings ifn ON ifn.asset_id = ia.id
        WHERE ia.project_id = ?
        GROUP BY ia.id
        ORDER BY ia.created_at DESC
      `
      )
      .all(projectId) as InspectionAssetRow[]

    return rows.map(mapAsset)
  }

  listFindings(projectId: string): InspectionFinding[] {
    const rows = this.database
      .prepare('SELECT * FROM inspection_findings WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as InspectionFindingRow[]

    return rows.map(mapFinding)
  }

  private getFindingCounts(runId: string): {
    component: number
    damage: number
    missingPart: number
    possibleModification: number
  } {
    const rows = this.database
      .prepare(
        `
        SELECT finding_type, COUNT(*) as count
        FROM inspection_findings
        WHERE run_id = ?
        GROUP BY finding_type
      `
      )
      .all(runId) as Array<{ finding_type: string; count: number }>

    const count = (type: string): number => rows.find((row) => row.finding_type === type)?.count ?? 0

    return {
      component: count('component'),
      damage: count('damage'),
      missingPart: count('missing_part'),
      possibleModification: count('possible_modification')
    }
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

function mapRun(row: InspectionRunRow): InspectionRun {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    progress: row.progress,
    modelName: row.model_name,
    summary: row.summary,
    restorationEstimate: row.restoration_estimate,
    assetsTotal: row.assets_total,
    processedAssets: row.processed_assets,
    componentCount: row.component_count,
    damageCount: row.damage_count,
    missingPartCount: row.missing_part_count,
    possibleModificationCount: row.possible_modification_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message
  }
}

function mapAsset(row: InspectionAssetRow): InspectionAsset {
  return {
    id: row.id,
    runId: row.run_id,
    projectId: row.project_id,
    kind: row.kind,
    filename: row.filename,
    mimeType: row.mime_type,
    mediaUrl: `blackline-media://${row.id}`,
    frameTimestampSeconds: row.frame_timestamp_seconds,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    componentCount: row.component_count,
    damageCount: row.damage_count
  }
}

function mapFinding(row: InspectionFindingRow): InspectionFinding {
  return {
    id: row.id,
    runId: row.run_id,
    assetId: row.asset_id,
    projectId: row.project_id,
    findingType: row.finding_type,
    workCategory: row.work_category,
    name: row.name,
    description: row.description,
    confidence: row.confidence,
    boundingBox: parseBoundingBox(row.bounding_box_json),
    reviewStatus: row.review_status,
    suggestedAction: row.suggested_action,
    checklistTitle: row.checklist_title,
    createdChecklistItemId: row.created_checklist_item_id,
    mediaUrl: `blackline-media://${row.asset_id}`,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at
  }
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

function estimateRestoration(damageCount: number, missingPartCount: number, possibleModificationCount: number): number {
  const penalty = damageCount * 4 + missingPartCount * 8 + possibleModificationCount * 2
  return Math.max(5, Math.min(100, 100 - penalty))
}

