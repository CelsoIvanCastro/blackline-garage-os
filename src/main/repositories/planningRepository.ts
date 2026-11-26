import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  ComponentCostBucket,
  CreatePlanningCostLineInput,
  PipelineStageCode,
  PlanningCostLine,
  PlanningReport,
  PlanningReportFormat,
  PlanningReportType,
  PlanningScenario,
  UpdatePlanningCostLineInput
} from '../../shared/types'

type CostLineRow = {
  id: string
  project_id: string
  scenario: PlanningScenario
  stage_code: PipelineStageCode
  component_name: string
  bucket: ComponentCostBucket
  description: string
  estimated_cents: number
  actual_cents: number | null
  confidence: number
  evidence: string
  created_at: string
  updated_at: string
}

type ReportRow = {
  id: string
  project_id: string
  report_type: PlanningReportType
  format: PlanningReportFormat
  status: 'pending' | 'generated' | 'failed'
  local_path: string
  created_at: string
  updated_at: string
}

export type StageAverageRow = {
  stage_code: PipelineStageCode
  stage_name: string
  average_seconds: number | null
  evidence_count: number
}

export type ComparableProjectRow = {
  id: string
  make: string
  model: string
  year: number | null
  total_cost_cents: number
  created_at: string
  completed_at: string | null
  elapsed_seconds: number | null
}

export type DamageFrequencyRow = {
  name: string
  count: number
}

export class PlanningRepository {
  constructor(private readonly database: Database.Database) {}

  listCostLines(projectId: string): PlanningCostLine[] {
    const rows = this.database
      .prepare(
        `
        SELECT
          pcl.*,
          (
            SELECT COALESCE(SUM(ce.amount_cents), 0)
            FROM cost_entries ce
            WHERE ce.project_id = pcl.project_id
              AND (
                (pcl.component_name != '' AND lower(ce.description) LIKE '%' || lower(pcl.component_name) || '%') OR
                lower(ce.description) LIKE '%' || lower(pcl.description) || '%'
              )
          ) as actual_cents
        FROM planning_cost_lines pcl
        WHERE pcl.project_id = ?
        ORDER BY
          CASE pcl.scenario
            WHEN 'conservative' THEN 1
            WHEN 'intermediate' THEN 2
            ELSE 3
          END,
          pcl.created_at DESC
      `
      )
      .all(projectId) as CostLineRow[]

    return rows.map(mapCostLine)
  }

  createCostLine(input: CreatePlanningCostLineInput): PlanningCostLine {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    this.database
      .prepare(
        `
        INSERT INTO planning_cost_lines (
          id, project_id, scenario, stage_code, component_name, bucket, description,
          estimated_cents, confidence, evidence, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.projectId,
        input.scenario,
        input.stageCode,
        normalizeOptional(input.componentName),
        input.bucket,
        normalizeRequired(input.description, 'Descripcion'),
        Math.max(0, Math.round(input.estimatedCents)),
        clampConfidence(input.confidence ?? 0.55),
        normalizeOptional(input.evidence),
        now,
        now
      )

    this.addHistoryEvent(input.projectId, 'planning_cost_created', 'Estimacion de costo agregada', input.description, now)
    return this.getCostLine(id)
  }

  updateCostLine(input: UpdatePlanningCostLineInput): PlanningCostLine {
    const existing = this.getCostLine(input.id)
    const now = new Date().toISOString()

    this.database
      .prepare(
        `
        UPDATE planning_cost_lines
        SET
          scenario = ?,
          stage_code = ?,
          component_name = ?,
          bucket = ?,
          description = ?,
          estimated_cents = ?,
          confidence = ?,
          evidence = ?,
          updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        input.scenario ?? existing.scenario,
        input.stageCode ?? existing.stageCode,
        input.componentName === undefined ? existing.componentName : normalizeOptional(input.componentName),
        input.bucket ?? existing.bucket,
        input.description === undefined ? existing.description : normalizeRequired(input.description, 'Descripcion'),
        input.estimatedCents === undefined ? existing.estimatedCents : Math.max(0, Math.round(input.estimatedCents)),
        clampConfidence(input.confidence ?? existing.confidence),
        input.evidence === undefined ? existing.evidence : normalizeOptional(input.evidence),
        now,
        input.id
      )

    this.addHistoryEvent(existing.projectId, 'planning_cost_updated', 'Estimacion de costo actualizada', existing.description, now)
    return this.getCostLine(input.id)
  }

  deleteCostLine(id: string): void {
    const existing = this.getCostLine(id)
    const now = new Date().toISOString()
    this.database.prepare('DELETE FROM planning_cost_lines WHERE id = ?').run(id)
    this.addHistoryEvent(existing.projectId, 'planning_cost_deleted', 'Estimacion de costo eliminada', existing.description, now)
  }

  getCostLine(id: string): PlanningCostLine {
    const row = this.database
      .prepare(
        `
        SELECT
          pcl.*,
          (
            SELECT COALESCE(SUM(ce.amount_cents), 0)
            FROM cost_entries ce
            WHERE ce.project_id = pcl.project_id
              AND (
                (pcl.component_name != '' AND lower(ce.description) LIKE '%' || lower(pcl.component_name) || '%') OR
                lower(ce.description) LIKE '%' || lower(pcl.description) || '%'
              )
          ) as actual_cents
        FROM planning_cost_lines pcl
        WHERE pcl.id = ?
      `
      )
      .get(id) as CostLineRow | undefined

    if (!row) {
      throw new Error('Estimacion no encontrada.')
    }

    return mapCostLine(row)
  }

  listStageAverages(excludeProjectId: string): StageAverageRow[] {
    return this.database
      .prepare(
        `
        SELECT
          ps.code as stage_code,
          ps.name as stage_name,
          AVG(strftime('%s', pst.exited_at) - strftime('%s', pst.entered_at)) as average_seconds,
          COUNT(pst.id) as evidence_count
        FROM pipeline_stages ps
        LEFT JOIN project_stage_times pst
          ON pst.stage_id = ps.id
          AND pst.exited_at IS NOT NULL
          AND pst.project_id != ?
        GROUP BY ps.id
        ORDER BY ps.position ASC
      `
      )
      .all(excludeProjectId) as StageAverageRow[]
  }

  listComparableProjects(projectId: string, make: string, model: string): ComparableProjectRow[] {
    return this.database
      .prepare(
        `
        SELECT
          vp.id,
          vp.make,
          vp.model,
          vp.year,
          COALESCE(SUM(ce.amount_cents), 0) as total_cost_cents,
          vp.created_at,
          vp.completed_at,
          CASE
            WHEN vp.completed_at IS NOT NULL THEN strftime('%s', vp.completed_at) - strftime('%s', vp.created_at)
            ELSE NULL
          END as elapsed_seconds
        FROM vehicle_projects vp
        LEFT JOIN cost_entries ce ON ce.project_id = vp.id
        WHERE vp.id != ?
          AND (
            lower(vp.make) = lower(?) OR
            lower(vp.model) = lower(?) OR
            vp.status = 'completed'
          )
        GROUP BY vp.id
        ORDER BY
          CASE WHEN vp.status = 'completed' THEN 1 ELSE 2 END,
          vp.completed_at DESC,
          vp.updated_at DESC
        LIMIT 6
      `
      )
      .all(projectId, make, model) as ComparableProjectRow[]
  }

  getDamageFrequencies(): DamageFrequencyRow[] {
    return this.database
      .prepare(
        `
        SELECT name, COUNT(*) as count
        FROM inspection_findings
        WHERE finding_type IN ('damage', 'missing_part', 'possible_modification')
        GROUP BY lower(name)
        ORDER BY count DESC, name ASC
        LIMIT 5
      `
      )
      .all() as DamageFrequencyRow[]
  }

  countCompletedProjects(): number {
    const row = this.database
      .prepare("SELECT COUNT(*) as count FROM vehicle_projects WHERE status = 'completed'")
      .get() as { count: number }
    return row.count
  }

  countInspectionFindings(projectId: string, findingType?: string): number {
    const clause = findingType ? 'AND finding_type = ?' : ''
    const row = this.database
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM inspection_findings
        WHERE project_id = ?
          AND review_status != 'rejected'
          ${clause}
      `
      )
      .get(...(findingType ? [projectId, findingType] : [projectId])) as { count: number }

    return row.count
  }

  countOemPendingSuggestions(projectId: string): number {
    const row = this.database
      .prepare("SELECT COUNT(*) as count FROM oem_comparison_suggestions WHERE project_id = ? AND status = 'pending'")
      .get(projectId) as { count: number }
    return row.count
  }

  createReport(projectId: string, reportType: PlanningReportType, format: PlanningReportFormat): PlanningReport {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    this.database
      .prepare(
        `
        INSERT INTO planning_reports (
          id, project_id, report_type, format, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 'pending', ?, ?)
      `
      )
      .run(id, projectId, reportType, format, now, now)

    return this.getReport(id)
  }

  markReportGenerated(id: string, localPath: string): PlanningReport {
    const now = new Date().toISOString()
    this.database
      .prepare(
        `
        UPDATE planning_reports
        SET status = 'generated', local_path = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(localPath, now, id)

    return this.getReport(id)
  }

  markReportFailed(id: string): PlanningReport {
    const now = new Date().toISOString()
    this.database.prepare("UPDATE planning_reports SET status = 'failed', updated_at = ? WHERE id = ?").run(now, id)
    return this.getReport(id)
  }

  listReports(projectId: string): PlanningReport[] {
    const rows = this.database
      .prepare('SELECT * FROM planning_reports WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as ReportRow[]

    return rows.map(mapReport)
  }

  getReportPath(id: string): string {
    const row = this.database.prepare('SELECT local_path FROM planning_reports WHERE id = ?').get(id) as
      | { local_path: string }
      | undefined

    if (!row?.local_path) {
      throw new Error('Reporte no encontrado.')
    }

    return row.local_path
  }

  addHistoryEvent(projectId: string, eventType: string, title: string, body: string, occurredAt = new Date().toISOString()): void {
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

  private getReport(id: string): PlanningReport {
    const row = this.database.prepare('SELECT * FROM planning_reports WHERE id = ?').get(id) as ReportRow | undefined

    if (!row) {
      throw new Error('Reporte no encontrado.')
    }

    return mapReport(row)
  }
}

function mapCostLine(row: CostLineRow): PlanningCostLine {
  return {
    id: row.id,
    projectId: row.project_id,
    scenario: row.scenario,
    stageCode: row.stage_code,
    componentName: row.component_name,
    bucket: row.bucket,
    description: row.description,
    estimatedCents: row.estimated_cents,
    actualCents: row.actual_cents ?? 0,
    confidence: row.confidence,
    evidence: row.evidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapReport(row: ReportRow): PlanningReport {
  return {
    id: row.id,
    projectId: row.project_id,
    reportType: row.report_type,
    format: row.format,
    status: row.status,
    localFileUrl: row.local_path ? `blackline-report://${row.id}` : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function normalizeRequired(value: string, label: string): string {
  const normalized = value.trim()

  if (!normalized) {
    throw new Error(`${label} es obligatorio.`)
  }

  return normalized
}

function normalizeOptional(value?: string): string {
  return value?.trim() ?? ''
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}
