import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  ChecklistItem,
  ChecklistSection,
  ComponentStatus,
  CostEntry,
  CreateChecklistItemInput,
  CreateCostEntryInput,
  CreateVehicleProjectInput,
  DashboardStats,
  HistoryEvent,
  MediaCategory,
  PipelineStage,
  PipelineStageCode,
  ProjectDetail,
  ProjectMedia,
  ProjectStatus,
  StageTimeEntry,
  UpdateChecklistItemInput,
  UpdateCostEntryInput,
  UpdateVehicleProjectInput,
  VehicleProject
} from '../../shared/types'

type ProjectRow = {
  id: string
  project_name: string
  stage_id: string
  stage_code: PipelineStageCode
  stage_name: string
  status: ProjectStatus
  make: string
  model: string
  year: number | null
  submodel: string
  vin: string
  current_color: string
  oem_color: string
  notes: string
  budget_cents: number
  total_cost_cents: number | null
  current_stage_entered_at: string
  created_at: string
  updated_at: string
  archived_at: string | null
  completed_at: string | null
}

type StageRow = {
  id: string
  code: PipelineStageCode
  name: string
  position: number
  capacity: number
  is_terminal: 0 | 1
  project_count: number
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

type CostRow = {
  id: string
  project_id: string
  description: string
  amount_cents: number
  occurred_on: string
  created_at: string
  updated_at: string
}

type MediaRow = {
  id: string
  project_id: string
  category: MediaCategory
  local_path: string
  filename: string
  mime_type: string
  source: ProjectMedia['source']
  imported_at: string
  width: number | null
  height: number | null
  status: ProjectMedia['status']
  created_at: string
}

type HistoryRow = {
  id: string
  project_id: string
  event_type: string
  title: string
  body: string
  occurred_at: string
  created_at: string
}

type StageTimeRow = {
  id: string
  project_id: string
  stage_id: string
  stage_name: string
  entered_at: string
  exited_at: string | null
}

const projectSelect = `
  SELECT
    vp.id,
    vp.project_name,
    vp.stage_id,
    ps.code as stage_code,
    ps.name as stage_name,
    vp.status,
    vp.make,
    vp.model,
    vp.year,
    vp.submodel,
    vp.vin,
    vp.current_color,
    vp.oem_color,
    vp.notes,
    vp.budget_cents,
    COALESCE(SUM(ce.amount_cents), 0) as total_cost_cents,
    vp.current_stage_entered_at,
    vp.created_at,
    vp.updated_at,
    vp.archived_at,
    vp.completed_at
  FROM vehicle_projects vp
  INNER JOIN pipeline_stages ps ON ps.id = vp.stage_id
  LEFT JOIN cost_entries ce ON ce.project_id = vp.id
`

export class ProjectRepository {
  constructor(private readonly database: Database.Database) {}

  getDashboardStats(): DashboardStats {
    const statuses = this.database
      .prepare(
        `
        SELECT status, COUNT(*) as count
        FROM vehicle_projects
        GROUP BY status
      `
      )
      .all() as Array<{ status: ProjectStatus; count: number }>

    const stages = this.listStages()
    const totalInvested = this.database
      .prepare('SELECT COALESCE(SUM(amount_cents), 0) as value FROM cost_entries')
      .get() as { value: number }
    const activeBudget = this.database
      .prepare("SELECT COALESCE(SUM(budget_cents), 0) as value FROM vehicle_projects WHERE status IN ('active', 'paused')")
      .get() as { value: number }

    const countFor = (status: ProjectStatus): number =>
      statuses.find((row) => row.status === status)?.count ?? 0

    return {
      activeVehicles: countFor('active'),
      completedVehicles: countFor('completed'),
      pausedVehicles: countFor('paused'),
      archivedVehicles: countFor('archived'),
      occupiedProcesses: stages.filter((stage) => stage.projectCount > 0).length,
      freeProcesses: stages.filter((stage) => stage.projectCount === 0).length,
      totalInvestedCents: totalInvested.value,
      activeBudgetCents: activeBudget.value
    }
  }

  listProjects(query = '', includeInactive = true): VehicleProject[] {
    const normalizedQuery = `%${query.trim().toLowerCase()}%`
    const statusClause = includeInactive ? '1 = 1' : "vp.status IN ('active', 'paused')"
    const searchClause = query.trim()
      ? `AND (
          lower(vp.make) LIKE @query OR
          lower(vp.model) LIKE @query OR
          CAST(vp.year AS TEXT) LIKE @query OR
          lower(vp.submodel) LIKE @query OR
          lower(vp.vin) LIKE @query OR
          lower(vp.current_color) LIKE @query OR
          lower(vp.oem_color) LIKE @query
        )`
      : ''

    const rows = this.database
      .prepare(
        `
        ${projectSelect}
        WHERE ${statusClause}
        ${searchClause}
        GROUP BY vp.id
        ORDER BY
          CASE vp.status
            WHEN 'active' THEN 1
            WHEN 'paused' THEN 2
            WHEN 'completed' THEN 3
            ELSE 4
          END,
          ps.position ASC,
          vp.created_at DESC
      `
      )
      .all({ query: normalizedQuery }) as ProjectRow[]

    return rows.map(mapProjectRow)
  }

  listPipelineProjects(): VehicleProject[] {
    const rows = this.database
      .prepare(
        `
        ${projectSelect}
        WHERE vp.status IN ('active', 'paused')
        GROUP BY vp.id
        ORDER BY ps.position ASC, vp.created_at ASC
      `
      )
      .all() as ProjectRow[]

    return rows.map(mapProjectRow)
  }

  getProjectById(id: string): VehicleProject {
    const row = this.database
      .prepare(
        `
        ${projectSelect}
        WHERE vp.id = ?
        GROUP BY vp.id
      `
      )
      .get(id) as ProjectRow | undefined

    if (!row) {
      throw new Error('Proyecto no encontrado.')
    }

    return mapProjectRow(row)
  }

  getProjectDetail(id: string): ProjectDetail {
    return {
      project: this.getProjectById(id),
      checklist: this.listChecklist(id),
      costs: this.listCosts(id),
      media: this.listMedia(id),
      history: this.listHistory(id),
      stageTimes: this.listStageTimes(id)
    }
  }

  listStages(): PipelineStage[] {
    const rows = this.database
      .prepare(
        `
        SELECT
          ps.id,
          ps.code,
          ps.name,
          ps.position,
          ps.capacity,
          ps.is_terminal,
          COUNT(vp.id) as project_count
        FROM pipeline_stages ps
        LEFT JOIN vehicle_projects vp ON vp.stage_id = ps.id AND vp.status = 'active'
        GROUP BY ps.id
        ORDER BY ps.position ASC
      `
      )
      .all() as StageRow[]

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      position: row.position,
      capacity: row.capacity,
      isTerminal: Boolean(row.is_terminal),
      projectCount: row.project_count
    }))
  }

  getStageByCode(code: PipelineStageCode): PipelineStage {
    const row = this.database
      .prepare(
        `
        SELECT
          ps.id,
          ps.code,
          ps.name,
          ps.position,
          ps.capacity,
          ps.is_terminal,
          COUNT(vp.id) as project_count
        FROM pipeline_stages ps
        LEFT JOIN vehicle_projects vp ON vp.stage_id = ps.id AND vp.status = 'active'
        WHERE ps.code = ?
        GROUP BY ps.id
      `
      )
      .get(code) as StageRow | undefined

    if (!row) {
      throw new Error('Etapa no encontrada.')
    }

    return {
      id: row.id,
      code: row.code,
      name: row.name,
      position: row.position,
      capacity: row.capacity,
      isTerminal: Boolean(row.is_terminal),
      projectCount: row.project_count
    }
  }

  createProject(input: CreateVehicleProjectInput): VehicleProject {
    const create = this.database.transaction(() => {
      const stage = this.getStageByCode(input.stageCode ?? 'inspection_total_general')
      const status = input.status ?? 'active'

      if (status === 'active') {
        this.assertStageCapacity(stage.id, stage.capacity)
      }

      const now = new Date().toISOString()
      const id = crypto.randomUUID()
      const make = normalizeRequired(input.make, 'Marca')
      const model = normalizeRequired(input.model, 'Modelo')
      const year = normalizeRequiredYear(input.year)
      const submodel = normalizeOptional(input.submodel)
      const projectName = normalizeProjectName(input.projectName, make, model, year, submodel)

      this.database
        .prepare(
          `
          INSERT INTO vehicle_projects (
            id, project_name, stage_id, status, make, model, year, submodel, vin, current_color,
            oem_color, notes, budget_cents, current_stage_entered_at, created_at, updated_at
          )
          VALUES (
            @id, @projectName, @stageId, @status, @make, @model, @year, @submodel, @vin, @currentColor,
            @oemColor, @notes, @budgetCents, @currentStageEnteredAt, @createdAt, @updatedAt
          )
        `
        )
        .run({
          id,
          projectName,
          stageId: stage.id,
          status,
          make,
          model,
          year,
          submodel,
          vin: normalizeVin(input.vin),
          currentColor: normalizeOptional(input.currentColor),
          oemColor: normalizeOptional(input.oemColor),
          notes: normalizeOptional(input.notes),
          budgetCents: input.budgetCents ?? 0,
          currentStageEnteredAt: now,
          createdAt: now,
          updatedAt: now
        })

      this.openStageTime(id, stage.id, now)
      this.addHistoryEvent(id, 'project_created', 'Proyecto creado', projectName, now)
      return id
    })

    return this.getProjectById(create())
  }

  updateProject(input: UpdateVehicleProjectInput): VehicleProject {
    const existing = this.getProjectById(input.id)
    const now = new Date().toISOString()

    this.database
      .prepare(
        `
        UPDATE vehicle_projects
        SET
          project_name = @projectName,
          make = @make,
          model = @model,
          year = @year,
          submodel = @submodel,
          vin = @vin,
          current_color = @currentColor,
          oem_color = @oemColor,
          notes = @notes,
          budget_cents = @budgetCents,
          updated_at = @updatedAt
        WHERE id = @id
      `
      )
      .run({
        id: input.id,
        projectName:
          input.projectName === undefined
            ? existing.projectName
            : normalizeProjectName(
                input.projectName,
                input.make ?? existing.make,
                input.model ?? existing.model,
                input.year === undefined ? existing.year : input.year,
                input.submodel ?? existing.submodel
              ),
        make: input.make === undefined ? existing.make : normalizeRequired(input.make, 'Marca'),
        model: input.model === undefined ? existing.model : normalizeRequired(input.model, 'Modelo'),
        year: input.year === undefined ? existing.year : normalizeRequiredYear(input.year),
        submodel: input.submodel === undefined ? existing.submodel : normalizeOptional(input.submodel),
        vin: input.vin === undefined ? existing.vin : normalizeVin(input.vin),
        currentColor:
          input.currentColor === undefined ? existing.currentColor : normalizeOptional(input.currentColor),
        oemColor: input.oemColor === undefined ? existing.oemColor : normalizeOptional(input.oemColor),
        notes: input.notes === undefined ? existing.notes : normalizeOptional(input.notes),
        budgetCents: input.budgetCents === undefined ? existing.budgetCents : input.budgetCents,
        updatedAt: now
      })

    this.addHistoryEvent(input.id, 'project_updated', 'Proyecto actualizado', '', now)
    return this.getProjectById(input.id)
  }

  moveProject(projectId: string, stageCode: PipelineStageCode): VehicleProject {
    if (stageCode === 'completed') {
      return this.completeProject(projectId)
    }

    const move = this.database.transaction(() => {
      const project = this.getProjectById(projectId)

      if (!['active', 'paused'].includes(project.status)) {
        throw new Error('Solo los proyectos activos o pausados pueden moverse dentro del pipeline.')
      }

      const stage = this.getStageByCode(stageCode)

      if (project.stageId !== stage.id && project.status === 'active') {
        this.assertStageCapacity(stage.id, stage.capacity, projectId)
      }

      const now = new Date().toISOString()
      this.closeOpenStageTime(projectId, now)

      this.database
        .prepare(
          `
          UPDATE vehicle_projects
          SET stage_id = ?, current_stage_entered_at = ?, updated_at = ?
          WHERE id = ?
        `
        )
        .run(stage.id, now, now, projectId)

      this.openStageTime(projectId, stage.id, now)
      this.addHistoryEvent(projectId, 'pipeline_moved', `Movido a ${stage.name}`, '', now)
      return projectId
    })

    return this.getProjectById(move())
  }

  pauseProject(id: string): VehicleProject {
    const pause = this.database.transaction(() => {
      const project = this.getProjectById(id)

      if (project.status !== 'active') {
        throw new Error('Solo los proyectos activos pueden pausarse.')
      }

      const now = new Date().toISOString()
      this.closeOpenStageTime(id, now)
      this.database
        .prepare(
          `
          UPDATE vehicle_projects
          SET status = 'paused', updated_at = ?
          WHERE id = ?
        `
        )
        .run(now, id)
      this.addHistoryEvent(id, 'project_paused', 'Proyecto pausado', '', now)
      return id
    })

    return this.getProjectById(pause())
  }

  resumeProject(id: string): VehicleProject {
    const resume = this.database.transaction(() => {
      const project = this.getProjectById(id)

      if (project.status !== 'paused') {
        throw new Error('Solo los proyectos pausados pueden reanudarse.')
      }

      const stage = this.getStageByCode(project.stageCode)
      this.assertStageCapacity(stage.id, stage.capacity, id)
      const now = new Date().toISOString()

      this.database
        .prepare(
          `
          UPDATE vehicle_projects
          SET status = 'active', current_stage_entered_at = ?, updated_at = ?
          WHERE id = ?
        `
        )
        .run(now, now, id)
      this.openStageTime(id, stage.id, now)
      this.addHistoryEvent(id, 'project_resumed', 'Proyecto reanudado', '', now)
      return id
    })

    return this.getProjectById(resume())
  }

  archiveProject(id: string): VehicleProject {
    const now = new Date().toISOString()
    this.getProjectById(id)
    this.closeOpenStageTime(id, now)

    this.database
      .prepare(
        `
        UPDATE vehicle_projects
        SET status = 'archived', archived_at = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(now, now, id)

    this.addHistoryEvent(id, 'project_archived', 'Proyecto archivado', '', now)
    return this.getProjectById(id)
  }

  reactivateProject(id: string): VehicleProject {
    const project = this.getProjectById(id)

    if (project.status !== 'archived') {
      throw new Error('Solo los proyectos archivados pueden reactivarse.')
    }

    const stage = this.getStageByCode(project.stageCode)
    this.assertStageCapacity(stage.id, stage.capacity, id)
    const now = new Date().toISOString()

    this.closeOpenStageTime(id, now)
    this.database
      .prepare(
        `
        UPDATE vehicle_projects
        SET status = 'active', archived_at = NULL, current_stage_entered_at = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(now, now, id)

    this.openStageTime(id, stage.id, now)
    this.addHistoryEvent(id, 'project_reactivated', 'Proyecto reactivado', '', now)
    return this.getProjectById(id)
  }

  completeProject(id: string): VehicleProject {
    const complete = this.database.transaction(() => {
      const completedStage = this.getStageByCode('completed')
      const project = this.getProjectById(id)
      const now = new Date().toISOString()

      if (!['active', 'paused'].includes(project.status)) {
        throw new Error('Solo los proyectos activos o pausados pueden completarse.')
      }

      this.closeOpenStageTime(id, now)

      this.database
        .prepare(
          `
          UPDATE vehicle_projects
          SET status = 'completed', stage_id = ?, completed_at = ?, updated_at = ?
          WHERE id = ?
        `
        )
        .run(completedStage.id, now, now, id)

      this.addHistoryEvent(id, 'project_completed', 'Proyecto completado', '', now)
      return id
    })

    return this.getProjectById(complete())
  }

  deleteProject(id: string): void {
    this.getProjectById(id)
    this.database.prepare('DELETE FROM vehicle_projects WHERE id = ?').run(id)
  }

  listChecklist(projectId: string): ChecklistItem[] {
    const rows = this.database
      .prepare(
        `
        SELECT *
        FROM project_checklist_items
        WHERE project_id = ?
        ORDER BY section ASC, created_at ASC
      `
      )
      .all(projectId) as ChecklistRow[]

    return rows.map(mapChecklistRow)
  }

  createChecklistItem(input: CreateChecklistItemInput): ChecklistItem {
    this.getProjectById(input.projectId)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const status = input.status ?? 'pending'

    this.database
      .prepare(
        `
        INSERT INTO project_checklist_items (
          id, project_id, section, title, status, notes, completed_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.projectId,
        input.section,
        normalizeRequired(input.title, 'Tarea'),
        status,
        normalizeOptional(input.notes),
        status === 'assembled' || status === 'completed' ? now : null,
        now,
        now
      )

    this.addHistoryEvent(input.projectId, 'checklist_created', 'Tarea agregada', input.title, now)
    return this.getChecklistItemById(id)
  }

  updateChecklistItem(input: UpdateChecklistItemInput): ChecklistItem {
    const existing = this.getChecklistItemById(input.id)
    const now = new Date().toISOString()
    const nextStatus = input.status ?? existing.status

    this.database
      .prepare(
        `
        UPDATE project_checklist_items
        SET section = ?, title = ?, status = ?, notes = ?, completed_at = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        input.section ?? existing.section,
        input.title === undefined ? existing.title : normalizeRequired(input.title, 'Tarea'),
        nextStatus,
        input.notes === undefined ? existing.notes : normalizeOptional(input.notes),
        nextStatus === 'assembled' || nextStatus === 'completed' ? existing.completedAt ?? now : null,
        now,
        input.id
      )

    this.addHistoryEvent(existing.projectId, 'checklist_updated', 'Checklist actualizado', existing.title, now)
    return this.getChecklistItemById(input.id)
  }

  deleteChecklistItem(id: string): void {
    const existing = this.getChecklistItemById(id)
    const now = new Date().toISOString()
    this.database.prepare('DELETE FROM project_checklist_items WHERE id = ?').run(id)
    this.addHistoryEvent(existing.projectId, 'checklist_deleted', 'Tarea eliminada', existing.title, now)
  }

  listCosts(projectId: string): CostEntry[] {
    const rows = this.database
      .prepare(
        `
        SELECT id, project_id, description, amount_cents, occurred_on, created_at, updated_at
        FROM cost_entries
        WHERE project_id = ?
        ORDER BY occurred_on DESC, created_at DESC
      `
      )
      .all(projectId) as CostRow[]

    return rows.map(mapCostRow)
  }

  createCostEntry(input: CreateCostEntryInput): CostEntry {
    this.getProjectById(input.projectId)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    this.database
      .prepare(
        `
        INSERT INTO cost_entries (
          id, project_id, category, description, amount_cents, occurred_on, created_at, updated_at
        )
        VALUES (?, ?, 'repair', ?, ?, ?, ?, ?)
      `
      )
      .run(id, input.projectId, normalizeRequired(input.concept, 'Concepto'), input.amountCents, input.occurredOn, now, now)

    this.addHistoryEvent(input.projectId, 'cost_created', 'Costo agregado', input.concept, now)
    return this.getCostEntryById(id)
  }

  updateCostEntry(input: UpdateCostEntryInput): CostEntry {
    const existing = this.getCostEntryById(input.id)
    const now = new Date().toISOString()

    this.database
      .prepare(
        `
        UPDATE cost_entries
        SET description = ?, amount_cents = ?, occurred_on = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        input.concept === undefined ? existing.concept : normalizeRequired(input.concept, 'Concepto'),
        input.amountCents === undefined ? existing.amountCents : input.amountCents,
        input.occurredOn ?? existing.occurredOn,
        now,
        input.id
      )

    this.addHistoryEvent(existing.projectId, 'cost_updated', 'Costo actualizado', existing.concept, now)
    return this.getCostEntryById(input.id)
  }

  deleteCostEntry(id: string): void {
    const existing = this.getCostEntryById(id)
    const now = new Date().toISOString()
    this.database.prepare('DELETE FROM cost_entries WHERE id = ?').run(id)
    this.addHistoryEvent(existing.projectId, 'cost_deleted', 'Costo eliminado', existing.concept, now)
  }

  listMedia(projectId: string): ProjectMedia[] {
    const rows = this.database
      .prepare(
        `
        SELECT
          id,
          project_id,
          category,
          local_path,
          filename,
          mime_type,
          source,
          imported_at,
          width,
          height,
          status,
          created_at
        FROM project_media
        WHERE project_id = ? AND kind = 'photo'
        ORDER BY created_at DESC
      `
      )
      .all(projectId) as MediaRow[]

    return rows.map(mapMediaRow)
  }

  createMediaRecord(input: {
    projectId: string
    category: MediaCategory
    localPath: string
    filename: string
    mimeType: string
    hash: string
    source?: ProjectMedia['source']
    importedAt?: string
    width?: number | null
    height?: number | null
    status?: ProjectMedia['status']
  }): ProjectMedia {
    this.getProjectById(input.projectId)
    const now = input.importedAt ?? new Date().toISOString()
    const id = crypto.randomUUID()

    this.database
      .prepare(
        `
        INSERT INTO project_media (
          id, project_id, kind, category, local_path, filename, mime_type, hash, source,
          imported_at, width, height, status, created_at
        )
        VALUES (?, ?, 'photo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.projectId,
        input.category,
        input.localPath,
        input.filename,
        input.mimeType,
        input.hash,
        input.source ?? 'manual',
        now,
        input.width ?? null,
        input.height ?? null,
        input.status ?? 'imported',
        now
      )

    this.addHistoryEvent(input.projectId, 'media_created', 'Fotografia agregada', input.filename, now)
    return mapMediaRow({
      id,
      project_id: input.projectId,
      category: input.category,
      local_path: input.localPath,
      filename: input.filename,
      mime_type: input.mimeType,
      source: input.source ?? 'manual',
      imported_at: now,
      width: input.width ?? null,
      height: input.height ?? null,
      status: input.status ?? 'imported',
      created_at: now
    })
  }

  getMediaPath(id: string): string {
    const row = this.database
      .prepare('SELECT local_path FROM project_media WHERE id = ?')
      .get(id) as { local_path: string } | undefined

    if (!row) {
      throw new Error('Archivo no encontrado.')
    }

    return row.local_path
  }

  deleteMedia(id: string): string {
    const row = this.database
      .prepare('SELECT project_id, local_path, filename FROM project_media WHERE id = ?')
      .get(id) as { project_id: string; local_path: string; filename: string } | undefined

    if (!row) {
      throw new Error('Archivo no encontrado.')
    }

    const now = new Date().toISOString()
    this.database.prepare('DELETE FROM project_media WHERE id = ?').run(id)
    this.addHistoryEvent(row.project_id, 'media_deleted', 'Fotografia eliminada', row.filename, now)
    return row.local_path
  }

  listHistory(projectId: string): HistoryEvent[] {
    const rows = this.database
      .prepare(
        `
        SELECT id, project_id, event_type, title, body, occurred_at, created_at
        FROM history_events
        WHERE project_id = ?
        ORDER BY occurred_at DESC, created_at DESC
      `
      )
      .all(projectId) as HistoryRow[]

    return rows.map(mapHistoryRow)
  }

  listStageTimes(projectId: string): StageTimeEntry[] {
    const rows = this.database
      .prepare(
        `
        SELECT
          pst.id,
          pst.project_id,
          pst.stage_id,
          ps.name as stage_name,
          pst.entered_at,
          pst.exited_at
        FROM project_stage_times pst
        INNER JOIN pipeline_stages ps ON ps.id = pst.stage_id
        WHERE pst.project_id = ?
        ORDER BY pst.entered_at ASC
      `
      )
      .all(projectId) as StageTimeRow[]

    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      stageId: row.stage_id,
      stageName: row.stage_name,
      enteredAt: row.entered_at,
      exitedAt: row.exited_at,
      durationSeconds: secondsBetween(row.entered_at, row.exited_at ?? new Date().toISOString())
    }))
  }

  private getChecklistItemById(id: string): ChecklistItem {
    const row = this.database
      .prepare('SELECT * FROM project_checklist_items WHERE id = ?')
      .get(id) as ChecklistRow | undefined

    if (!row) {
      throw new Error('Tarea no encontrada.')
    }

    return mapChecklistRow(row)
  }

  private getCostEntryById(id: string): CostEntry {
    const row = this.database
      .prepare(
        `
        SELECT id, project_id, description, amount_cents, occurred_on, created_at, updated_at
        FROM cost_entries
        WHERE id = ?
      `
      )
      .get(id) as CostRow | undefined

    if (!row) {
      throw new Error('Costo no encontrado.')
    }

    return mapCostRow(row)
  }

  private assertStageCapacity(stageId: string, capacity: number, excludingProjectId?: string): void {
    const row = this.database
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM vehicle_projects
        WHERE stage_id = ?
          AND status = 'active'
          AND (? IS NULL OR id != ?)
      `
      )
      .get(stageId, excludingProjectId ?? null, excludingProjectId ?? null) as { count: number }

    if (row.count >= capacity) {
      throw new Error('El proceso seleccionado ya alcanzo su capacidad maxima.')
    }
  }

  private openStageTime(projectId: string, stageId: string, now: string): void {
    this.database
      .prepare(
        `
        INSERT INTO project_stage_times (id, project_id, stage_id, entered_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      )
      .run(crypto.randomUUID(), projectId, stageId, now, now, now)
  }

  private closeOpenStageTime(projectId: string, now: string): void {
    this.database
      .prepare(
        `
        UPDATE project_stage_times
        SET exited_at = ?, updated_at = ?
        WHERE project_id = ? AND exited_at IS NULL
      `
      )
      .run(now, now, projectId)
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

function mapProjectRow(row: ProjectRow): VehicleProject {
  const now = new Date().toISOString()
  const exitDate = row.completed_at ?? row.archived_at
  const currentStageEndsAt = row.status === 'paused' ? row.updated_at : exitDate ?? now

  return {
    id: row.id,
    projectName: row.project_name || [row.year, row.make, row.model, row.submodel].filter(Boolean).join(' '),
    stageId: row.stage_id,
    stageCode: row.stage_code,
    stageName: row.stage_name,
    status: row.status,
    make: row.make,
    model: row.model,
    year: row.year,
    submodel: row.submodel,
    vin: row.vin,
    currentColor: row.current_color,
    oemColor: row.oem_color,
    notes: row.notes,
    budgetCents: row.budget_cents,
    totalCostCents: row.total_cost_cents ?? 0,
    currentStageEnteredAt: row.current_stage_entered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    completedAt: row.completed_at,
    entryDate: row.created_at,
    exitDate,
    totalElapsedSeconds: secondsBetween(row.created_at, exitDate ?? now),
    currentStageSeconds: secondsBetween(row.current_stage_entered_at, currentStageEndsAt)
  }
}

function mapChecklistRow(row: ChecklistRow): ChecklistItem {
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

function mapCostRow(row: CostRow): CostEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    concept: row.description,
    amountCents: row.amount_cents,
    occurredOn: row.occurred_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapMediaRow(row: MediaRow): ProjectMedia {
  return {
    id: row.id,
    projectId: row.project_id,
    category: row.category,
    filename: row.filename,
    localPath: row.local_path,
    mimeType: row.mime_type,
    mediaUrl: `blackline-media://${row.id}`,
    source: row.source,
    importedAt: row.imported_at,
    width: row.width,
    height: row.height,
    status: row.status,
    createdAt: row.created_at
  }
}

function mapHistoryRow(row: HistoryRow): HistoryEvent {
  return {
    id: row.id,
    projectId: row.project_id,
    eventType: row.event_type,
    title: row.title,
    body: row.body,
    occurredAt: row.occurred_at,
    createdAt: row.created_at
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

function normalizeVin(value?: string): string {
  return normalizeOptional(value).toUpperCase()
}

function normalizeRequiredYear(value?: number | null): number {
  const year = Number(value)

  if (!Number.isInteger(year) || year < 1886 || year > new Date().getFullYear() + 1) {
    throw new Error('Año es obligatorio y debe ser valido.')
  }

  return year
}

function normalizeProjectName(
  value: string | undefined,
  make: string,
  model: string,
  year: number | null,
  submodel: string
): string {
  const normalized = normalizeOptional(value)

  if (normalized) {
    return normalized
  }

  return [year, make, model, submodel].filter(Boolean).join(' ')
}

function secondsBetween(start: string, end: string): number {
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return 0
  }

  return Math.max(0, Math.floor((endMs - startMs) / 1000))
}
