import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  CommandCenterAlert,
  CommandCenterAlertLevel,
  CommandCenterAuditEntry,
  CommandCenterDashboard,
  CommandCenterKpi,
  CommandCenterKnowledgeCategory,
  CommandCenterKnowledgeResult,
  CommandCenterMode,
  CommandCenterProductivity,
  CommandCenterStrategicRecommendation,
  CommandCenterSummary,
  CommandCenterSummaryType,
  CommandCenterWorkshopArea,
  CopilotDashboard,
  DashboardStats,
  GenerateCommandCenterSummaryInput,
  InventoryAlert,
  InventoryDashboard,
  PipelineSnapshot,
  PipelineStage,
  PredictiveDashboard,
  PredictiveRisk,
  RiskLevel,
  SearchCommandCenterKnowledgeInput,
  VehicleProject
} from '../../shared/types'
import { InventoryRepository } from '../repositories/inventoryRepository'
import { PredictiveRepository } from '../repositories/predictiveRepository'
import { ProjectRepository } from '../repositories/projectRepository'
import { CopilotService } from './copilotService'

type AlertCandidate = {
  fingerprint: string
  level: CommandCenterAlertLevel
  source: string
  title: string
  body: string
  evidence: string
  projectId: string | null
  projectLabel: string
}

type AlertRow = {
  id: string
  fingerprint: string
  level: CommandCenterAlertLevel
  source: string
  title: string
  body: string
  evidence: string
  project_id: string | null
  project_label: string
  status: 'open' | 'acknowledged'
  first_detected_at: string
  last_detected_at: string
  acknowledged_at: string | null
}

type SummaryRow = {
  id: string
  summary_type: CommandCenterSummaryType
  title: string
  body: string
  metrics_json: string
  generated_at: string
}

type KnowledgeRow = {
  id: string
  category: CommandCenterKnowledgeCategory
  title: string
  source: string
  detail: string
  project_id: string | null
  project_label: string
  created_at: string
  relevance: number
}

type AuditRow = {
  id: string
  event_type: string
  title: string
  body: string
  source: string
  project_id: string | null
  project_label: string
  occurred_at: string
}

type PeriodStats = {
  createdProjects: number
  completedProjects: number
  costCents: number
  historyEvents: number
}

type WorkshopMonitorContext = {
  stats: DashboardStats
  projects: VehicleProject[]
  pipeline: PipelineSnapshot
  inventory: InventoryDashboard
  predictive: PredictiveDashboard
  copilot: CopilotDashboard
}

const stalledImportantSeconds = 14 * 86400
const stalledCriticalSeconds = 30 * 86400

export class WorkshopMonitorService {
  constructor(
    private readonly database: Database.Database,
    private readonly projectRepository: ProjectRepository,
    private readonly inventoryRepository: InventoryRepository,
    private readonly predictiveRepository: PredictiveRepository,
    private readonly copilotService: CopilotService
  ) {}

  getDashboard(mode: CommandCenterMode = 'executive'): CommandCenterDashboard {
    const context = this.buildContext()
    const alerts = this.observe(context)
    const dailySummary = this.ensureSummary('daily', context, alerts)
    const weeklySummary = this.ensureSummary('weekly', context, alerts)

    return {
      mode,
      generatedAt: new Date().toISOString(),
      stats: context.stats,
      kpis: buildKpis(context, alerts),
      alerts,
      recommendations: buildRecommendations(context, alerts),
      workshopMap: buildWorkshopMap(context.pipeline.stages, context.pipeline.projects, alerts),
      productivity: buildProductivity(context),
      dailySummary,
      weeklySummary,
      knowledge: this.searchKnowledge({ query: '', limit: 12 }),
      auditTrail: this.listAuditTrail(28),
      projects: context.projects,
      predictive: context.predictive,
      inventory: context.inventory,
      copilot: context.copilot
    }
  }

  acknowledgeAlert(id: string): CommandCenterAlert {
    const now = new Date().toISOString()
    this.database
      .prepare("UPDATE command_center_alerts_v9 SET status = 'acknowledged', acknowledged_at = ? WHERE id = ?")
      .run(now, id)
    const alert = this.getAlert(id)
    this.recordAudit('alert_acknowledged', 'Alerta reconocida', alert.title, 'command_center', alert.projectId, alert.projectLabel)
    return alert
  }

  generateSummary(input: GenerateCommandCenterSummaryInput): CommandCenterSummary {
    const context = this.buildContext()
    const alerts = this.observe(context)
    return this.createSummary(input.summaryType, context, alerts)
  }

  searchKnowledge(input: SearchCommandCenterKnowledgeInput): CommandCenterKnowledgeResult[] {
    const query = input.query.trim()
    const like = `%${query.toLowerCase()}%`
    const limit = Math.max(1, Math.min(80, input.limit ?? 24))
    const params = { like, limit }
    const whereProject = query
      ? `
        WHERE lower(trim(COALESCE(project.year || ' ', '') || project.make || ' ' || project.model || ' ' || project.vin)) LIKE @like
          OR lower(project.notes) LIKE @like
      `
      : ''
    const whereOem = query
      ? `
        WHERE lower(item.title || ' ' || item.category || ' ' || item.source_name || ' ' || item.make || ' ' || item.model) LIKE @like
      `
      : ''
    const whereHistory = query ? `WHERE lower(history.title || ' ' || history.body || ' ' || history.event_type) LIKE @like` : ''
    const whereMedia = query ? `WHERE lower(media.filename || ' ' || media.category || ' ' || media.mime_type) LIKE @like` : ''
    const whereInventory = query
      ? `
        WHERE lower(item.name || ' ' || item.category || ' ' || item.part_number || ' ' || item.manufacturer || ' ' || item.description) LIKE @like
      `
      : ''
    const whereCopilot = query ? `WHERE lower(message.content || ' ' || message.intent) LIKE @like` : ''

    const rows = [
      ...this.database
        .prepare(
          `
          SELECT
            project.id,
            'project' as category,
            trim(COALESCE(project.year || ' ', '') || project.make || ' ' || project.model) as title,
            'Proyectos' as source,
            project.vin || ' ' || project.stage_id || ' ' || project.status as detail,
            project.id as project_id,
            trim(COALESCE(project.year || ' ', '') || project.make || ' ' || project.model) as project_label,
            project.updated_at as created_at,
            80 as relevance
          FROM vehicle_projects project
          ${whereProject}
          ORDER BY project.updated_at DESC
          LIMIT @limit
        `
        )
        .all(params),
      ...this.database
        .prepare(
          `
          SELECT
            item.id,
            'oem' as category,
            item.title,
            item.source_name as source,
            item.category || ' ' || item.source_url as detail,
            item.project_id,
            trim(COALESCE(project.year || ' ', '') || project.make || ' ' || project.model) as project_label,
            item.created_at,
            CAST(70 + item.confidence * 20 AS INTEGER) as relevance
          FROM oem_knowledge_items item
          LEFT JOIN vehicle_projects project ON project.id = item.project_id
          ${whereOem}
          ORDER BY item.created_at DESC
          LIMIT @limit
        `
        )
        .all(params),
      ...this.database
        .prepare(
          `
          SELECT
            history.id,
            'history' as category,
            history.title,
            history.event_type as source,
            history.body as detail,
            history.project_id,
            trim(COALESCE(project.year || ' ', '') || project.make || ' ' || project.model) as project_label,
            history.occurred_at as created_at,
            64 as relevance
          FROM history_events history
          LEFT JOIN vehicle_projects project ON project.id = history.project_id
          ${whereHistory}
          ORDER BY history.occurred_at DESC
          LIMIT @limit
        `
        )
        .all(params),
      ...this.database
        .prepare(
          `
          SELECT
            media.id,
            'media' as category,
            media.filename as title,
            media.category as source,
            media.mime_type as detail,
            media.project_id,
            trim(COALESCE(project.year || ' ', '') || project.make || ' ' || project.model) as project_label,
            media.created_at,
            56 as relevance
          FROM project_media media
          LEFT JOIN vehicle_projects project ON project.id = media.project_id
          ${whereMedia}
          ORDER BY media.created_at DESC
          LIMIT @limit
        `
        )
        .all(params),
      ...this.database
        .prepare(
          `
          SELECT
            item.id,
            'inventory' as category,
            item.name as title,
            item.status as source,
            item.part_number || ' ' || item.location_id as detail,
            NULL as project_id,
            '' as project_label,
            item.updated_at as created_at,
            58 as relevance
          FROM inventory_stock_items_v7 item
          ${whereInventory}
          ORDER BY item.updated_at DESC
          LIMIT @limit
        `
        )
        .all(params),
      ...this.database
        .prepare(
          `
          SELECT
            message.id,
            'copilot' as category,
            message.intent as title,
            message.role as source,
            message.content as detail,
            message.project_id,
            trim(COALESCE(project.year || ' ', '') || project.make || ' ' || project.model) as project_label,
            message.created_at,
            CAST(45 + message.confidence * 35 AS INTEGER) as relevance
          FROM copilot_messages message
          LEFT JOIN vehicle_projects project ON project.id = message.project_id
          ${whereCopilot}
          ORDER BY message.created_at DESC
          LIMIT @limit
        `
        )
        .all(params)
    ] as KnowledgeRow[]

    return rows
      .map(mapKnowledge)
      .sort((a, b) => b.relevance - a.relevance || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit)
  }

  private buildContext(): WorkshopMonitorContext {
    const stats = this.projectRepository.getDashboardStats()
    const stages = this.projectRepository.listStages()
    const pipelineProjects = this.projectRepository.listPipelineProjects()
    const projects = this.projectRepository.listProjects('', true)
    const inventory = this.inventoryRepository.getDashboard()
    const predictive = this.predictiveRepository.getDashboard()
    const copilot = this.copilotService.getDashboard()

    return {
      stats,
      projects,
      pipeline: {
        stages,
        projects: pipelineProjects,
        stats
      },
      inventory,
      predictive,
      copilot
    }
  }

  private observe(context: WorkshopMonitorContext): CommandCenterAlert[] {
    const candidates: AlertCandidate[] = [
      ...buildPipelineAlerts(context.pipeline.projects),
      ...buildBudgetAlerts(context.projects),
      ...context.inventory.alerts.map(mapInventoryAlert),
      ...context.predictive.risks.filter((risk) => ['high', 'critical'].includes(risk.severity)).map(mapPredictiveRisk),
      ...buildCapacityAlerts(context.pipeline.stages),
      ...buildCopilotAlerts(context.copilot)
    ]

    if (candidates.length === 0) {
      return []
    }

    const now = new Date().toISOString()
    const upsert = this.database.prepare(
      `
      INSERT INTO command_center_alerts_v9 (
        id, fingerprint, level, source, title, body, evidence, project_id, project_label,
        status, first_detected_at, last_detected_at
      )
      VALUES (
        @id, @fingerprint, @level, @source, @title, @body, @evidence, @projectId, @projectLabel,
        'open', @now, @now
      )
      ON CONFLICT(fingerprint) DO UPDATE SET
        level = excluded.level,
        source = excluded.source,
        title = excluded.title,
        body = excluded.body,
        evidence = excluded.evidence,
        project_id = excluded.project_id,
        project_label = excluded.project_label,
        last_detected_at = excluded.last_detected_at
    `
    )
    const getByFingerprint = this.database.prepare('SELECT * FROM command_center_alerts_v9 WHERE fingerprint = ?')

    const save = this.database.transaction(() =>
      candidates.map((candidate) => {
        upsert.run({ ...candidate, id: crypto.randomUUID(), now })
        return mapAlert(getByFingerprint.get(candidate.fingerprint) as AlertRow)
      })
    )

    return save().sort((a, b) => alertRank(b.level) - alertRank(a.level) || b.lastDetectedAt.localeCompare(a.lastDetectedAt))
  }

  private ensureSummary(
    summaryType: CommandCenterSummaryType,
    context: WorkshopMonitorContext,
    alerts: CommandCenterAlert[]
  ): CommandCenterSummary {
    const row = this.database
      .prepare('SELECT * FROM command_center_summaries_v9 WHERE summary_type = ? ORDER BY generated_at DESC LIMIT 1')
      .get(summaryType) as SummaryRow | undefined

    if (row && isCurrentPeriod(row.generated_at, summaryType)) {
      return mapSummary(row)
    }

    return this.createSummary(summaryType, context, alerts)
  }

  private createSummary(
    summaryType: CommandCenterSummaryType,
    context: WorkshopMonitorContext,
    alerts: CommandCenterAlert[]
  ): CommandCenterSummary {
    const period = summaryType === 'daily' ? this.getPeriodStats(1) : this.getPeriodStats(7)
    const title = summaryType === 'daily' ? 'Resumen ejecutivo diario' : 'Resumen ejecutivo semanal'
    const metrics = [
      `${context.stats.activeVehicles} activo(s)`,
      `${context.stats.pausedVehicles} pausado(s)`,
      `${context.inventory.stats.activeOrderCount} compra(s) activa(s)`,
      `${alerts.filter((alert) => ['important', 'critical'].includes(alert.level)).length} alerta(s) relevantes`,
      `${period.completedProjects} completado(s) en periodo`,
      `Score taller ${context.predictive.workshopScore}/100`
    ]
    const body =
      summaryType === 'daily'
        ? `Estado actual: ${context.stats.activeVehicles} activo(s), ${context.stats.pausedVehicles} pausado(s), ${context.stats.occupiedProcesses} proceso(s) ocupado(s). Prioridad: atender ${alerts[0]?.title.toLowerCase() ?? 'monitoreo operativo'} con datos disponibles.`
        : `La semana registra ${period.createdProjects} ingreso(s), ${period.completedProjects} entrega(s), ${formatMoney(period.costCents)} en costos y ${period.historyEvents} evento(s) operativos.`
    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    this.database
      .prepare(
        `
        INSERT INTO command_center_summaries_v9 (id, summary_type, title, body, metrics_json, generated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      )
      .run(id, summaryType, title, body, JSON.stringify(metrics), now)
    this.recordAudit('summary_generated', title, body, 'command_center', null, '')

    return this.getSummary(id)
  }

  private getPeriodStats(days: number): PeriodStats {
    const since = new Date(Date.now() - days * 86400 * 1000).toISOString()
    const row = this.database
      .prepare(
        `
        SELECT
          (SELECT COUNT(*) FROM vehicle_projects WHERE created_at >= @since) as created_projects,
          (SELECT COUNT(*) FROM vehicle_projects WHERE completed_at IS NOT NULL AND completed_at >= @since) as completed_projects,
          (SELECT COALESCE(SUM(amount_cents), 0) FROM cost_entries WHERE created_at >= @since OR occurred_on >= substr(@since, 1, 10)) as cost_cents,
          (SELECT COUNT(*) FROM history_events WHERE occurred_at >= @since) as history_events
      `
      )
      .get({ since }) as {
      created_projects: number
      completed_projects: number
      cost_cents: number
      history_events: number
    }

    return {
      createdProjects: row.created_projects,
      completedProjects: row.completed_projects,
      costCents: row.cost_cents,
      historyEvents: row.history_events
    }
  }

  private listAuditTrail(limit: number): CommandCenterAuditEntry[] {
    const rows = this.database
      .prepare(
        `
        SELECT *
        FROM (
          SELECT
            audit.id,
            audit.event_type,
            audit.title,
            audit.body,
            audit.source,
            audit.project_id,
            audit.project_label,
            audit.occurred_at
          FROM command_center_audit_v9 audit

          UNION ALL

          SELECT
            history.id,
            history.event_type,
            history.title,
            history.body,
            'history' as source,
            history.project_id,
            trim(COALESCE(project.year || ' ', '') || project.make || ' ' || project.model) as project_label,
            history.occurred_at
          FROM history_events history
          LEFT JOIN vehicle_projects project ON project.id = history.project_id

          UNION ALL

          SELECT
            po.id,
            'purchase_' || po.status as event_type,
            'Orden de compra',
            po.order_number || ' ' || po.notes as body,
            'compras' as source,
            po.project_id,
            trim(COALESCE(project.year || ' ', '') || project.make || ' ' || project.model) as project_label,
            po.updated_at as occurred_at
          FROM purchase_orders_v7 po
          LEFT JOIN vehicle_projects project ON project.id = po.project_id

          UNION ALL

          SELECT
            simulation.id,
            'simulation_run' as event_type,
            simulation.scenario_name as title,
            'Simulacion operativa' as body,
            'predictive' as source,
            simulation.project_id,
            trim(COALESCE(project.year || ' ', '') || project.make || ' ' || project.model) as project_label,
            simulation.created_at as occurred_at
          FROM predictive_simulations_v8 simulation
          LEFT JOIN vehicle_projects project ON project.id = simulation.project_id
        )
        ORDER BY occurred_at DESC
        LIMIT ?
      `
      )
      .all(limit) as AuditRow[]

    return rows.map(mapAudit)
  }

  private getAlert(id: string): CommandCenterAlert {
    const row = this.database.prepare('SELECT * FROM command_center_alerts_v9 WHERE id = ?').get(id) as AlertRow | undefined

    if (!row) {
      throw new Error('Alerta no encontrada.')
    }

    return mapAlert(row)
  }

  private getSummary(id: string): CommandCenterSummary {
    const row = this.database.prepare('SELECT * FROM command_center_summaries_v9 WHERE id = ?').get(id) as SummaryRow | undefined

    if (!row) {
      throw new Error('Resumen no encontrado.')
    }

    return mapSummary(row)
  }

  private recordAudit(
    eventType: string,
    title: string,
    body: string,
    source: string,
    projectId: string | null,
    projectLabel: string
  ): void {
    this.database
      .prepare(
        `
        INSERT INTO command_center_audit_v9 (id, event_type, title, body, source, project_id, project_label, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(crypto.randomUUID(), eventType, title, body, source, projectId, projectLabel, new Date().toISOString())
  }
}

function buildPipelineAlerts(projects: VehicleProject[]): AlertCandidate[] {
  return projects
    .filter((project) => project.currentStageSeconds >= stalledImportantSeconds || project.status === 'paused')
    .map((project) => {
      const stalled = project.currentStageSeconds >= stalledImportantSeconds
      const level: CommandCenterAlertLevel =
        project.currentStageSeconds >= stalledCriticalSeconds ? 'critical' : stalled || project.status === 'paused' ? 'important' : 'warning'

      return {
        fingerprint: `${stalled ? 'stalled' : 'paused'}-${project.id}`,
        level,
        source: 'pipeline',
        title: stalled ? 'Vehiculo detenido en proceso' : 'Proyecto pausado',
        body: projectLabel(project),
        evidence: stalled ? `${formatDays(project.currentStageSeconds)} en ${project.stageName}` : project.stageName,
        projectId: project.id,
        projectLabel: projectLabel(project)
      }
    })
}

function buildBudgetAlerts(projects: VehicleProject[]): AlertCandidate[] {
  return projects
    .filter((project) => ['active', 'paused'].includes(project.status) && project.budgetCents > 0 && project.totalCostCents > project.budgetCents)
    .map((project) => ({
      fingerprint: `budget-${project.id}`,
      level: project.totalCostCents > project.budgetCents * 1.2 ? 'critical' : 'important',
      source: 'costos',
      title: 'Presupuesto excedido',
      body: projectLabel(project),
      evidence: `${formatMoney(project.totalCostCents)} de ${formatMoney(project.budgetCents)}`,
      projectId: project.id,
      projectLabel: projectLabel(project)
    }))
}

function buildCapacityAlerts(stages: PipelineStage[]): AlertCandidate[] {
  return stages
    .filter((stage) => !stage.isTerminal && stage.projectCount >= stage.capacity)
    .map((stage) => ({
      fingerprint: `capacity-${stage.code}`,
      level: stage.projectCount > stage.capacity ? 'critical' : 'warning',
      source: 'capacidad',
      title: stage.projectCount > stage.capacity ? 'Proceso sobrecargado' : 'Proceso sin capacidad libre',
      body: stage.name,
      evidence: `${stage.projectCount}/${stage.capacity}`,
      projectId: null,
      projectLabel: ''
    }))
}

function buildCopilotAlerts(copilot: CopilotDashboard): AlertCandidate[] {
  return copilot.proactiveAlerts.slice(0, 6).map((decision) => ({
    fingerprint: `copilot-${decision.id}`,
    level: riskToAlertLevel(decision.severity),
    source: 'blackline_ai',
    title: decision.title,
    body: decision.body,
    evidence: decision.evidence,
    projectId: decision.projectId,
    projectLabel: ''
  }))
}

function mapInventoryAlert(alert: InventoryAlert): AlertCandidate {
  return {
    fingerprint: `inventory-${alert.id}`,
    level: riskToAlertLevel(alert.severity),
    source: 'inventario',
    title: alert.title,
    body: alert.body,
    evidence: alert.evidence,
    projectId: alert.projectId,
    projectLabel: ''
  }
}

function mapPredictiveRisk(risk: PredictiveRisk): AlertCandidate {
  return {
    fingerprint: `predictive-${risk.id}`,
    level: riskToAlertLevel(risk.severity),
    source: 'predictive_engine',
    title: risk.title,
    body: risk.body,
    evidence: `${risk.evidence} | confianza ${Math.round(risk.confidence * 100)}%`,
    projectId: risk.projectId,
    projectLabel: ''
  }
}

function buildKpis(
  context: WorkshopMonitorContext,
  alerts: CommandCenterAlert[]
): CommandCenterKpi[] {
  const activeTotal = context.stats.activeVehicles + context.stats.pausedVehicles
  const completedTotal = context.stats.completedVehicles
  const totalKnown = activeTotal + completedTotal
  const completionRate = totalKnown > 0 ? Math.round((completedTotal / totalKnown) * 100) : 0
  const importantAlerts = alerts.filter((alert) => ['important', 'critical'].includes(alert.level)).length
  const budgetDelta = context.stats.activeBudgetCents - context.stats.totalInvestedCents

  return [
    {
      id: 'workshop-score',
      label: 'Workshop Score',
      value: `${context.predictive.workshopScore}/100`,
      detail: `${context.predictive.capacity.utilizationPercent}% utilizacion`,
      level: context.predictive.workshopScore < 50 ? 'critical' : context.predictive.workshopScore < 70 ? 'important' : 'info',
      evidenceCount: context.predictive.performance.evidenceProjectCount
    },
    {
      id: 'alerts',
      label: 'Riesgos activos',
      value: String(importantAlerts),
      detail: `${alerts.length} alerta(s) totales`,
      level: importantAlerts > 3 ? 'critical' : importantAlerts > 0 ? 'important' : 'info',
      evidenceCount: alerts.length
    },
    {
      id: 'pending-purchases',
      label: 'Compras pendientes',
      value: String(context.inventory.stats.activeOrderCount),
      detail: `${context.inventory.stats.delayedOrderCount} retrasada(s)`,
      level: context.inventory.stats.delayedOrderCount > 0 ? 'important' : 'info',
      evidenceCount: context.inventory.purchaseOrders.length
    },
    {
      id: 'completion-rate',
      label: 'Proyectos terminados',
      value: `${completionRate}%`,
      detail: `${completedTotal} terminado(s) de ${totalKnown}`,
      level: completionRate >= 50 ? 'info' : totalKnown > 0 ? 'warning' : 'info',
      evidenceCount: totalKnown
    },
    {
      id: 'budget-delta',
      label: 'Balance operativo',
      value: formatMoney(budgetDelta),
      detail: 'Presupuesto activo menos inversion total',
      level: budgetDelta < 0 ? 'important' : 'info',
      evidenceCount: context.projects.length
    }
  ]
}

function buildWorkshopMap(stages: PipelineStage[], projects: VehicleProject[], alerts: CommandCenterAlert[]): CommandCenterWorkshopArea[] {
  return stages
    .filter((stage) => !stage.isTerminal)
    .map((stage) => {
      const stageProjects = projects.filter((project) => project.stageCode === stage.code)
      const vehicle = stageProjects[0] ?? null
      const stageAlerts = alerts.filter((alert) => alert.projectId && stageProjects.some((project) => project.id === alert.projectId))
      const utilization = stage.capacity > 0 ? Math.round((stage.projectCount / stage.capacity) * 100) : 0
      const status: CommandCenterWorkshopArea['status'] =
        stage.projectCount > stage.capacity
          ? 'overloaded'
          : stageAlerts.some((alert) => ['important', 'critical'].includes(alert.level))
            ? 'blocked'
            : stage.projectCount === 0
              ? 'free'
              : 'occupied'

      return {
        stageCode: stage.code,
        stageName: stage.name,
        capacity: stage.capacity,
        occupied: stage.projectCount,
        available: Math.max(0, stage.capacity - stage.projectCount),
        utilizationPercent: utilization,
        status,
        vehicle,
        accumulatedSeconds: stageProjects.reduce((max, project) => Math.max(max, project.currentStageSeconds), 0),
        alertCount: stageAlerts.length
      }
    })
}

function buildProductivity(context: WorkshopMonitorContext): CommandCenterProductivity {
  return {
    activeProjects: context.stats.activeVehicles + context.stats.pausedVehicles,
    completedProjects: context.stats.completedVehicles,
    averageCompletionSeconds: context.predictive.performance.averageCompletionSeconds,
    averageCostCents: context.predictive.performance.averageCostCents,
    utilizationPercent: context.predictive.capacity.utilizationPercent,
    workshopScore: context.predictive.workshopScore,
    productivityScore: context.predictive.performance.productivityScore,
    evidenceProjectCount: context.predictive.performance.evidenceProjectCount
  }
}

function buildRecommendations(
  context: WorkshopMonitorContext,
  alerts: CommandCenterAlert[]
): CommandCenterStrategicRecommendation[] {
  const recommendations: CommandCenterStrategicRecommendation[] = [
    ...context.predictive.recommendations.map((item) => ({
      id: `predictive-${item.id}`,
      priority: item.priority,
      title: item.title,
      body: item.body,
      source: 'Predictive Engine',
      evidence: item.evidence,
      confidence: item.confidence,
      projectId: item.projectId
    })),
    ...context.inventory.suggestedPurchases.slice(0, 6).map((item) => ({
      id: `purchase-${item.id}`,
      priority: item.priority,
      title: 'Comprar pieza prioritaria',
      body: item.title,
      source: 'Inventario',
      evidence: `${item.projectLabel} | ${item.evidence}`,
      confidence: item.confidence,
      projectId: item.projectId
    })),
    ...context.copilot.decisionCenter.slice(0, 5).map((item) => ({
      id: `copilot-${item.id}`,
      priority: item.severity === 'critical' ? 1 : item.severity === 'high' ? 2 : 4,
      title: item.title,
      body: item.body,
      source: 'Blackline AI',
      evidence: item.evidence,
      confidence: item.confidence,
      projectId: item.projectId
    }))
  ]

  const criticalAlert = alerts.find((alert) => alert.level === 'critical')
  if (criticalAlert) {
    recommendations.push({
      id: `alert-${criticalAlert.id}`,
      priority: 1,
      title: 'Atender alerta critica',
      body: criticalAlert.title,
      source: criticalAlert.source,
      evidence: criticalAlert.evidence,
      confidence: 0.86,
      projectId: criticalAlert.projectId
    })
  }

  if (context.predictive.capacity.availableCapacity > 0 && alerts.every((alert) => alert.level !== 'critical')) {
    recommendations.push({
      id: 'use-available-capacity',
      priority: 5,
      title: 'Capacidad disponible',
      body: 'Revisar si algun proyecto puede avanzar a un proceso libre.',
      source: 'Capacidad',
      evidence: `${context.predictive.capacity.availableCapacity} espacio(s) libre(s)`,
      confidence: 0.62,
      projectId: null
    })
  }

  return dedupeById(recommendations)
    .sort((a, b) => a.priority - b.priority || b.confidence - a.confidence)
    .slice(0, 12)
}

function mapAlert(row: AlertRow): CommandCenterAlert {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    level: row.level,
    source: row.source,
    title: row.title,
    body: row.body,
    evidence: row.evidence,
    projectId: row.project_id,
    projectLabel: row.project_label,
    status: row.status,
    firstDetectedAt: row.first_detected_at,
    lastDetectedAt: row.last_detected_at,
    acknowledgedAt: row.acknowledged_at
  }
}

function mapSummary(row: SummaryRow): CommandCenterSummary {
  return {
    id: row.id,
    summaryType: row.summary_type,
    title: row.title,
    body: row.body,
    metrics: parseJson<string[]>(row.metrics_json, []),
    generatedAt: row.generated_at
  }
}

function mapKnowledge(row: KnowledgeRow): CommandCenterKnowledgeResult {
  return {
    id: row.id,
    category: row.category,
    title: row.title || 'Referencia',
    source: row.source || row.category,
    detail: row.detail || '',
    projectId: row.project_id,
    projectLabel: row.project_label ?? '',
    createdAt: row.created_at,
    relevance: Number(row.relevance)
  }
}

function mapAudit(row: AuditRow): CommandCenterAuditEntry {
  return {
    id: row.id,
    eventType: row.event_type,
    title: row.title,
    body: row.body,
    source: row.source,
    projectId: row.project_id,
    projectLabel: row.project_label,
    occurredAt: row.occurred_at
  }
}

function riskToAlertLevel(level: RiskLevel): CommandCenterAlertLevel {
  switch (level) {
    case 'critical':
      return 'critical'
    case 'high':
      return 'important'
    case 'medium':
      return 'warning'
    default:
      return 'info'
  }
}

function alertRank(level: CommandCenterAlertLevel): number {
  switch (level) {
    case 'critical':
      return 4
    case 'important':
      return 3
    case 'warning':
      return 2
    default:
      return 1
  }
}

function projectLabel(project: VehicleProject): string {
  return [project.year, project.make, project.model, project.submodel].filter(Boolean).join(' ')
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}

function formatDays(seconds: number): string {
  return `${Math.round(seconds / 86400)} dia(s)`
}

function isCurrentPeriod(value: string, summaryType: CommandCenterSummaryType): boolean {
  const date = new Date(value)
  const now = new Date()

  if (!Number.isFinite(date.getTime())) {
    return false
  }

  if (summaryType === 'daily') {
    return date.toDateString() === now.toDateString()
  }

  return now.getTime() - date.getTime() < 7 * 86400 * 1000
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false
    }
    seen.add(item.id)
    return true
  })
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
