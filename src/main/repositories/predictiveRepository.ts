import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  PIPELINE_STAGE_CODES,
  type BottleneckPrediction,
  type OperationalRecommendation,
  type OperationalSimulationResult,
  type PipelineStageCode,
  type PredictiveDashboard,
  type PredictiveReport,
  type PredictiveReportType,
  type PredictiveRisk,
  type ProjectPrediction,
  type RiskLevel,
  type RunOperationalSimulationInput,
  type StagePrediction
} from '../../shared/types'

type StageRow = {
  id: string
  code: PipelineStageCode
  name: string
  position: number
  capacity: number
  is_terminal: 0 | 1
  active_count: number
}

type ProjectRow = {
  id: string
  stage_code: PipelineStageCode
  stage_name: string
  status: 'active' | 'paused' | 'archived' | 'completed'
  make: string
  model: string
  year: number | null
  submodel: string
  budget_cents: number
  total_cost_cents: number
  current_stage_entered_at: string
  created_at: string
  completed_at: string | null
}

type StageAverageRow = {
  stage_code: PipelineStageCode
  stage_name: string
  average_seconds: number | null
  evidence_count: number
}

type CostAverageRow = {
  average_cost_cents: number | null
  evidence_count: number
}

type ReportRow = {
  id: string
  report_type: PredictiveReportType
  status: 'generated' | 'failed'
  local_path: string
  created_at: string
}

type SimulationRow = {
  id: string
  scenario_name: string
  result_json: string
  created_at: string
}

export class PredictiveRepository {
  constructor(private readonly database: Database.Database) {}

  getDashboard(projectId?: string | null): PredictiveDashboard {
    const stages = this.listStages()
    const projects = this.listProjects(projectId)
    const allOpenProjects = this.listProjects(null).filter((project) => ['active', 'paused'].includes(project.status))
    const stageAverages = this.listStageAverages()
    const projectPredictions = projects
      .filter((project) => ['active', 'paused'].includes(project.status))
      .map((project) => this.buildProjectPrediction(project, stageAverages))
    const capacity = buildCapacity(stages)
    const bottlenecks = buildBottlenecks(stages, stageAverages, allOpenProjects, this.database)
    const risks = [
      ...projectPredictions.flatMap((prediction) => prediction.risks),
      ...bottlenecks
        .filter((bottleneck) => bottleneck.severity !== 'low')
        .map<PredictiveRisk>((bottleneck) => ({
          id: `bottleneck-${bottleneck.stageCode}`,
          type: 'bottleneck',
          severity: bottleneck.severity,
          title: 'Cuello de botella probable',
          body: bottleneck.stageName,
          evidence: bottleneck.explanation,
          confidence: bottleneck.confidence,
          projectId: null
        }))
    ].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.confidence - a.confidence)
    const performance = this.buildPerformance()
    const recommendations = buildRecommendations(projectPredictions, bottlenecks, risks, capacity)

    return {
      workshopScore: buildWorkshopScore(capacity, performance, risks),
      capacity,
      performance,
      projectPredictions,
      bottlenecks,
      risks,
      recommendations,
      simulations: this.listSimulations(projectId ?? undefined),
      reports: this.listReports(projectId ?? undefined)
    }
  }

  runSimulation(input: RunOperationalSimulationInput): OperationalSimulationResult {
    const dashboard = this.getDashboard(input.projectId ?? undefined)
    const newVehicleCount = Math.max(0, Math.round(input.newVehicleCount ?? 0))
    const stageDelayDays = Math.max(0, Number(input.stageDelayDays ?? 0))
    const missingPartsDays = Math.max(0, Number(input.missingPartsDelayDays ?? 0))
    const capacityDelta = (input.capacityChanges ?? []).reduce((sum, item) => sum + Number(item.capacityDelta || 0), 0)
    const projectedUsed = dashboard.capacity.usedCapacity + newVehicleCount
    const projectedCapacity = Math.max(1, dashboard.capacity.currentCapacity + capacityDelta)
    const projectedUtilization = Math.round((projectedUsed / projectedCapacity) * 100)
    const delaySeconds = Math.round((stageDelayDays + missingPartsDays) * 86400)
    const overloadedStages = [...dashboard.capacity.overloadedStages]

    if (projectedUtilization > 100 && !overloadedStages.includes('Capacidad total')) {
      overloadedStages.push('Capacidad total')
    }

    if (input.stageDelayCode) {
      const stage = dashboard.bottlenecks.find((item) => item.stageCode === input.stageDelayCode)
      if (stage && !overloadedStages.includes(stage.stageName)) {
        overloadedStages.push(stage.stageName)
      }
    }

    const recommendations = [
      projectedUtilization > 100 ? 'No ingresar nuevos vehiculos sin liberar o ampliar capacidad.' : '',
      stageDelayDays > 0 && input.stageDelayCode ? 'Reprogramar entregas afectadas por retraso de etapa.' : '',
      missingPartsDays > 0 ? 'Ordenar piezas criticas antes de avanzar a ensamblaje.' : '',
      capacityDelta > 0 ? 'La capacidad adicional reduce saturacion si se asigna al proceso correcto.' : '',
      projectedUtilization < 65 ? 'Hay capacidad disponible para recibir trabajo adicional.' : ''
    ].filter(Boolean)
    const dataPoints = dashboard.performance.evidenceProjectCount + dashboard.projectPredictions.reduce((sum, item) => sum + item.dataPoints, 0)
    const result: OperationalSimulationResult = {
      id: null,
      scenarioName: input.scenarioName?.trim() || 'Simulacion operativa',
      projectedUtilizationPercent: projectedUtilization,
      projectedAvailableCapacity: Math.max(0, projectedCapacity - projectedUsed),
      projectedDelaySeconds: delaySeconds,
      overloadedStages,
      recommendations,
      confidence: confidenceFromEvidence(dataPoints),
      dataPoints,
      explanation:
        dataPoints > 0
          ? 'Simulacion basada en capacidad actual, proyectos abiertos e historial local disponible.'
          : 'Simulacion basada solo en capacidad actual; no hay historial suficiente para alta confianza.',
      createdAt: new Date().toISOString()
    }

    return this.saveSimulation(input, result)
  }

  createReport(reportType: PredictiveReportType, projectId: string | null, status: 'generated' | 'failed', localPath: string): PredictiveReport {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    this.database
      .prepare(
        `
        INSERT INTO predictive_reports_v8 (id, report_type, project_id, status, local_path, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, '{}', ?)
      `
      )
      .run(id, reportType, projectId, status, localPath, now)

    return this.getReport(id)
  }

  getReportPath(id: string): string {
    const row = this.database.prepare('SELECT local_path FROM predictive_reports_v8 WHERE id = ?').get(id) as
      | { local_path: string }
      | undefined

    if (!row || !row.local_path) {
      throw new Error('Reporte predictivo no encontrado.')
    }

    return row.local_path
  }

  private listStages(): StageRow[] {
    return this.database
      .prepare(
        `
        SELECT
          ps.*,
          (
            SELECT COUNT(*)
            FROM vehicle_projects vp
            WHERE vp.stage_id = ps.id AND vp.status = 'active'
          ) as active_count
        FROM pipeline_stages ps
        ORDER BY ps.position ASC
      `
      )
      .all() as StageRow[]
  }

  private listProjects(projectId?: string | null): ProjectRow[] {
    const where = projectId ? 'WHERE vp.id = @projectId' : ''
    const statement = this.database.prepare(
      `
      SELECT
        vp.id,
        ps.code as stage_code,
        ps.name as stage_name,
        vp.status,
        vp.make,
        vp.model,
        vp.year,
        vp.submodel,
        vp.budget_cents,
        COALESCE(SUM(ce.amount_cents), 0) as total_cost_cents,
        vp.current_stage_entered_at,
        vp.created_at,
        vp.completed_at
      FROM vehicle_projects vp
      INNER JOIN pipeline_stages ps ON ps.id = vp.stage_id
      LEFT JOIN cost_entries ce ON ce.project_id = vp.id
      ${where}
      GROUP BY vp.id
      ORDER BY
        CASE vp.status WHEN 'active' THEN 1 WHEN 'paused' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,
        vp.updated_at DESC
    `
    )

    return (projectId ? statement.all({ projectId }) : statement.all()) as ProjectRow[]
  }

  private listStageAverages(): StageAverageRow[] {
    return this.database
      .prepare(
        `
        SELECT
          ps.code as stage_code,
          ps.name as stage_name,
          AVG(strftime('%s', pst.exited_at) - strftime('%s', pst.entered_at)) as average_seconds,
          COUNT(pst.id) as evidence_count
        FROM pipeline_stages ps
        LEFT JOIN project_stage_times pst ON pst.stage_id = ps.id AND pst.exited_at IS NOT NULL
        GROUP BY ps.id
        ORDER BY ps.position ASC
      `
      )
      .all() as StageAverageRow[]
  }

  private getCostAverage(project: ProjectRow): CostAverageRow {
    return this.database
      .prepare(
        `
        SELECT AVG(total_cost_cents) as average_cost_cents, COUNT(*) as evidence_count
        FROM (
          SELECT vp.id, COALESCE(SUM(ce.amount_cents), 0) as total_cost_cents
          FROM vehicle_projects vp
          LEFT JOIN cost_entries ce ON ce.project_id = vp.id
          WHERE vp.status = 'completed'
            AND vp.id != ?
            AND (lower(vp.make) = lower(?) OR lower(vp.model) = lower(?))
          GROUP BY vp.id
        )
      `
      )
      .get(project.id, project.make, project.model) as CostAverageRow
  }

  private buildProjectPrediction(project: ProjectRow, stageAverages: StageAverageRow[]): ProjectPrediction {
    const currentIndex = PIPELINE_STAGE_CODES.indexOf(project.stage_code)
    const futureStages = PIPELINE_STAGE_CODES.slice(Math.max(0, currentIndex))
    let cursor = new Date()
    const stagePredictions: StagePrediction[] = futureStages.map((stageCode, index) => {
      const average = stageAverages.find((item) => item.stage_code === stageCode)
      const elapsed = stageCode === project.stage_code ? secondsSince(project.current_stage_entered_at) : 0
      const estimatedRemaining =
        average?.average_seconds === null || average?.average_seconds === undefined
          ? null
          : Math.max(0, Math.round(average.average_seconds) - elapsed)
      const delay = average?.average_seconds ? Math.max(0, elapsed - Math.round(average.average_seconds)) : 0

      if (estimatedRemaining !== null) {
        cursor = new Date(cursor.getTime() + estimatedRemaining * 1000)
      }

      return {
        stageCode,
        stageName: average?.stage_name ?? stageCode,
        estimatedRemainingSeconds: estimatedRemaining,
        probableDelaySeconds: index === 0 ? delay : 0,
        probableCompletionDate: estimatedRemaining === null ? null : cursor.toISOString(),
        confidence: confidenceFromEvidence(average?.evidence_count ?? 0),
        dataPoints: average?.evidence_count ?? 0,
        explanation:
          (average?.evidence_count ?? 0) > 0
            ? `Promedio historico local de ${average?.evidence_count ?? 0} registro(s).`
            : 'Sin historial terminado para esta etapa.'
      }
    })
    const hasTimeEvidence = stagePredictions.every((stage) => stage.estimatedRemainingSeconds !== null)
    const estimatedRemaining = hasTimeEvidence
      ? stagePredictions.reduce((sum, stage) => sum + (stage.estimatedRemainingSeconds ?? 0), 0)
      : null
    const costAverage = this.getCostAverage(project)
    const predictedCost = costAverage.average_cost_cents === null ? null : Math.round(costAverage.average_cost_cents)
    const budgetVariance = predictedCost === null || project.budget_cents <= 0 ? null : predictedCost - project.budget_cents
    const inventoryMissing = this.countSuggestedPurchases(project.id)
    const pendingChecklist = this.countPendingChecklist(project.id)
    const completionPercent = this.calculateCompletion(project.id, currentIndex)
    const risks = buildProjectRisks(project, stagePredictions, predictedCost, budgetVariance, inventoryMissing, pendingChecklist)
    const dataPoints =
      stagePredictions.reduce((sum, stage) => sum + stage.dataPoints, 0) + costAverage.evidence_count + pendingChecklist + inventoryMissing
    const confidence = confidenceFromEvidence(dataPoints)

    return {
      projectId: project.id,
      projectLabel: projectLabel(project),
      stageCode: project.stage_code,
      stageName: project.stage_name,
      healthScore: buildHealthScore(completionPercent, risks, budgetVariance),
      completionPercent,
      estimatedRemainingSeconds: estimatedRemaining,
      probableFinishDate: estimatedRemaining === null ? null : new Date(Date.now() + estimatedRemaining * 1000).toISOString(),
      predictedCostCents: predictedCost,
      budgetVarianceCents: budgetVariance,
      confidence,
      dataPoints,
      explanation:
        dataPoints > 0
          ? 'Prediccion calculada desde historial de etapas, costos comparables, checklist e inventario local.'
          : 'No hay datos historicos suficientes; registra proyectos terminados para mejorar la prediccion.',
      stagePredictions,
      risks
    }
  }

  private calculateCompletion(projectId: string, currentIndex: number): number {
    const row = this.database
      .prepare(
        `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status IN ('assembled', 'completed') THEN 1 ELSE 0 END) as done
        FROM project_checklist_items
        WHERE project_id = ?
      `
      )
      .get(projectId) as { total: number; done: number | null }

    if (row.total > 0) {
      return Math.round(((row.done ?? 0) / row.total) * 100)
    }

    return Math.round((Math.max(0, currentIndex) / (PIPELINE_STAGE_CODES.length - 1)) * 100)
  }

  private countPendingChecklist(projectId: string): number {
    const row = this.database
      .prepare("SELECT COUNT(*) as count FROM project_checklist_items WHERE project_id = ? AND status NOT IN ('assembled', 'completed')")
      .get(projectId) as { count: number }

    return row.count
  }

  private countSuggestedPurchases(projectId: string): number {
    const checklist = this.database
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM project_checklist_items
        WHERE project_id = ?
          AND status NOT IN ('assembled', 'completed')
          AND lower(title || ' ' || notes) GLOB '*compr*'
      `
      )
      .get(projectId) as { count: number }
    const oem = this.database
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM oem_comparison_suggestions
        WHERE project_id = ? AND status = 'pending' AND difference_type = 'missing_component'
      `
      )
      .get(projectId) as { count: number }

    return checklist.count + oem.count
  }

  private buildPerformance(): PredictiveDashboard['performance'] {
    const row = this.database
      .prepare(
        `
        SELECT
          COUNT(vp.id) as completed_count,
          AVG(strftime('%s', vp.completed_at) - strftime('%s', vp.created_at)) as average_completion_seconds,
          AVG(project_cost.total_cost_cents) as average_cost_cents
        FROM vehicle_projects vp
        LEFT JOIN (
          SELECT project_id, SUM(amount_cents) as total_cost_cents
          FROM cost_entries
          GROUP BY project_id
        ) project_cost ON project_cost.project_id = vp.id
        WHERE vp.status = 'completed' AND vp.completed_at IS NOT NULL
      `
      )
      .get() as { completed_count: number; average_completion_seconds: number | null; average_cost_cents: number | null }

    return {
      completedVehicles: row.completed_count,
      averageCompletionSeconds: row.average_completion_seconds === null ? null : Math.round(row.average_completion_seconds),
      averageCostCents: row.average_cost_cents === null ? null : Math.round(row.average_cost_cents),
      productivityScore: Math.min(100, Math.round(row.completed_count * 12)),
      evidenceProjectCount: row.completed_count
    }
  }

  private saveSimulation(input: RunOperationalSimulationInput, result: OperationalSimulationResult): OperationalSimulationResult {
    const id = crypto.randomUUID()
    this.database
      .prepare(
        `
        INSERT INTO predictive_simulations_v8 (id, project_id, scenario_name, input_json, result_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      )
      .run(id, input.projectId ?? null, result.scenarioName, JSON.stringify(input), JSON.stringify({ ...result, id }), result.createdAt)

    return { ...result, id }
  }

  private listSimulations(projectId?: string | null): OperationalSimulationResult[] {
    const where = projectId === undefined ? '' : 'WHERE project_id IS @projectId OR project_id IS NULL'
    const statement = this.database.prepare(
      `
      SELECT *
      FROM predictive_simulations_v8
      ${where}
      ORDER BY created_at DESC
      LIMIT 12
    `
    )
    const rows =
      projectId === undefined ? (statement.all() as SimulationRow[]) : (statement.all({ projectId: projectId ?? null }) as SimulationRow[])

    return rows.map((row) => parseJson<OperationalSimulationResult>(row.result_json, fallbackSimulation(row)))
  }

  private listReports(projectId?: string | null): PredictiveReport[] {
    const where = projectId === undefined ? '' : 'WHERE project_id IS @projectId OR project_id IS NULL'
    const statement = this.database.prepare(
      `
      SELECT *
      FROM predictive_reports_v8
      ${where}
      ORDER BY created_at DESC
      LIMIT 20
    `
    )
    const rows =
      projectId === undefined ? (statement.all() as ReportRow[]) : (statement.all({ projectId: projectId ?? null }) as ReportRow[])

    return rows.map(mapReport)
  }

  private getReport(id: string): PredictiveReport {
    const row = this.database.prepare('SELECT * FROM predictive_reports_v8 WHERE id = ?').get(id) as ReportRow | undefined

    if (!row) {
      throw new Error('Reporte predictivo no encontrado.')
    }

    return mapReport(row)
  }
}

function buildCapacity(stages: StageRow[]): PredictiveDashboard['capacity'] {
  const activeStages = stages.filter((stage) => !stage.is_terminal)
  const currentCapacity = activeStages.reduce((sum, stage) => sum + stage.capacity, 0)
  const usedCapacity = activeStages.reduce((sum, stage) => sum + stage.active_count, 0)

  return {
    currentCapacity,
    maximumCapacity: currentCapacity,
    usedCapacity,
    availableCapacity: Math.max(0, currentCapacity - usedCapacity),
    utilizationPercent: currentCapacity > 0 ? Math.round((usedCapacity / currentCapacity) * 100) : 0,
    overloadedStages: activeStages.filter((stage) => stage.active_count > stage.capacity).map((stage) => stage.name),
    emptyStages: activeStages.filter((stage) => stage.active_count === 0).map((stage) => stage.name),
    underusedStages: activeStages.filter((stage) => stage.active_count > 0 && stage.active_count < stage.capacity).map((stage) => stage.name)
  }
}

function buildBottlenecks(
  stages: StageRow[],
  averages: StageAverageRow[],
  openProjects: ProjectRow[],
  database: Database.Database
): BottleneckPrediction[] {
  return stages
    .filter((stage) => !stage.is_terminal)
    .map((stage) => {
      const average = averages.find((item) => item.stage_code === stage.code)
      const stageProjects = openProjects.filter((project) => project.stage_code === stage.code)
      const delayed = average?.average_seconds
        ? stageProjects.filter((project) => secondsSince(project.current_stage_entered_at) > (average.average_seconds ?? 0)).length
        : 0
      const blocked = countBlockedProjects(database, stage.code)
      const utilization = stage.capacity > 0 ? Math.round((stage.active_count / stage.capacity) * 100) : 0
      const severity: RiskLevel =
        stage.active_count > stage.capacity || delayed > 1
          ? 'critical'
          : utilization >= 100 || delayed > 0 || blocked > 0
            ? 'high'
            : utilization === 0
              ? 'low'
              : 'medium'

      return {
        stageCode: stage.code,
        stageName: stage.name,
        severity,
        activeCount: stage.active_count,
        capacity: stage.capacity,
        utilizationPercent: utilization,
        averageSeconds: average?.average_seconds === null || average?.average_seconds === undefined ? null : Math.round(average.average_seconds),
        blockedProjectCount: blocked,
        confidence: confidenceFromEvidence((average?.evidence_count ?? 0) + stageProjects.length),
        explanation:
          (average?.evidence_count ?? 0) > 0
            ? `${stage.active_count}/${stage.capacity} ocupado; ${delayed} proyecto(s) sobre promedio historico.`
            : `${stage.active_count}/${stage.capacity} ocupado; sin historial terminado para velocidad promedio.`
      }
    })
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.utilizationPercent - a.utilizationPercent)
}

function countBlockedProjects(database: Database.Database, stageCode: PipelineStageCode): number {
  const row = database
    .prepare(
      `
      SELECT COUNT(DISTINCT vp.id) as count
      FROM vehicle_projects vp
      INNER JOIN pipeline_stages ps ON ps.id = vp.stage_id
      LEFT JOIN project_checklist_items checklist ON checklist.project_id = vp.id AND checklist.status NOT IN ('assembled', 'completed')
      LEFT JOIN oem_comparison_suggestions oem ON oem.project_id = vp.id AND oem.status = 'pending' AND oem.difference_type = 'missing_component'
      WHERE ps.code = ?
        AND vp.status IN ('active', 'paused')
        AND (
          vp.status = 'paused' OR
          oem.id IS NOT NULL OR
          (ps.code IN ('paint', 'exterior_interior_assembly', 'completed') AND checklist.id IS NOT NULL)
        )
    `
    )
    .get(stageCode) as { count: number }

  return row.count
}

function buildProjectRisks(
  project: ProjectRow,
  stagePredictions: StagePrediction[],
  predictedCost: number | null,
  budgetVariance: number | null,
  missingParts: number,
  pendingChecklist: number
): PredictiveRisk[] {
  const risks: PredictiveRisk[] = []
  const currentStage = stagePredictions[0]

  if (budgetVariance !== null && budgetVariance > 0) {
    risks.push({
      id: `financial-${project.id}`,
      type: 'financial',
      severity: budgetVariance > project.budget_cents * 0.2 ? 'critical' : 'high',
      title: 'Riesgo financiero',
      body: `${projectLabel(project)} puede exceder presupuesto.`,
      evidence: `${predictedCost ?? 0} vs ${project.budget_cents}`,
      confidence: confidenceFromEvidence(currentStage?.dataPoints ?? 0),
      projectId: project.id
    })
  }

  if (currentStage?.probableDelaySeconds > 0) {
    risks.push({
      id: `delay-${project.id}`,
      type: 'delay',
      severity: currentStage.probableDelaySeconds > 7 * 86400 ? 'high' : 'medium',
      title: 'Riesgo de retraso',
      body: `${projectLabel(project)} excede el promedio de ${project.stage_name}.`,
      evidence: currentStage.explanation,
      confidence: currentStage.confidence,
      projectId: project.id
    })
  }

  if (project.status === 'paused') {
    risks.push({
      id: `operational-${project.id}`,
      type: 'operational',
      severity: 'medium',
      title: 'Riesgo operativo',
      body: `${projectLabel(project)} esta pausado.`,
      evidence: project.stage_name,
      confidence: 0.8,
      projectId: project.id
    })
  }

  if (missingParts > 0) {
    risks.push({
      id: `missing-${project.id}`,
      type: 'missing_parts',
      severity: missingParts > 2 ? 'high' : 'medium',
      title: 'Riesgo de faltantes',
      body: `${projectLabel(project)} tiene piezas sugeridas para compra.`,
      evidence: `${missingParts} faltante(s) detectado(s)`,
      confidence: 0.72,
      projectId: project.id
    })
  }

  if (pendingChecklist > 0 && ['paint', 'exterior_interior_assembly', 'completed'].includes(project.stage_code)) {
    risks.push({
      id: `dependency-${project.id}`,
      type: 'dependency',
      severity: project.stage_code === 'completed' ? 'critical' : 'high',
      title: 'Riesgo de dependencia',
      body: `${projectLabel(project)} tiene checklist pendiente en una etapa avanzada.`,
      evidence: `${pendingChecklist} tarea(s) pendientes`,
      confidence: 0.84,
      projectId: project.id
    })
  }

  return risks
}

function buildRecommendations(
  predictions: ProjectPrediction[],
  bottlenecks: BottleneckPrediction[],
  risks: PredictiveRisk[],
  capacity: PredictiveDashboard['capacity']
): OperationalRecommendation[] {
  const recommendations: OperationalRecommendation[] = []
  const riskiestProject = predictions.sort((a, b) => a.healthScore - b.healthScore)[0]
  const topBottleneck = bottlenecks.find((item) => ['critical', 'high'].includes(item.severity))
  const missing = risks.find((risk) => risk.type === 'missing_parts')

  if (riskiestProject && riskiestProject.healthScore < 70) {
    recommendations.push({
      id: 'prioritize-risk-project',
      priority: 1,
      title: 'Priorizar proyecto en riesgo',
      body: riskiestProject.projectLabel,
      evidence: `Health Score ${riskiestProject.healthScore}`,
      confidence: riskiestProject.confidence,
      projectId: riskiestProject.projectId
    })
  }

  if (topBottleneck) {
    recommendations.push({
      id: 'accelerate-bottleneck',
      priority: 2,
      title: 'Acelerar etapa saturada',
      body: topBottleneck.stageName,
      evidence: topBottleneck.explanation,
      confidence: topBottleneck.confidence,
      projectId: null
    })
  }

  if (missing) {
    recommendations.push({
      id: 'buy-critical-parts',
      priority: 2,
      title: 'Comprar faltantes criticos',
      body: missing.body,
      evidence: missing.evidence,
      confidence: missing.confidence,
      projectId: missing.projectId
    })
  }

  if (capacity.utilizationPercent > 90) {
    recommendations.push({
      id: 'protect-capacity',
      priority: 3,
      title: 'Proteger capacidad del taller',
      body: 'Evitar nuevos ingresos hasta liberar procesos ocupados.',
      evidence: `${capacity.utilizationPercent}% utilizado`,
      confidence: 0.82,
      projectId: null
    })
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: 'continue-monitoring',
      priority: 5,
      title: 'Continuar monitoreo',
      body: 'No hay riesgos predictivos altos con los datos actuales.',
      evidence: 'Pipeline, costos, inventario e historial revisados',
      confidence: 0.62,
      projectId: null
    })
  }

  return recommendations.sort((a, b) => a.priority - b.priority)
}

function buildWorkshopScore(
  capacity: PredictiveDashboard['capacity'],
  performance: PredictiveDashboard['performance'],
  risks: PredictiveRisk[]
): number {
  const utilizationPenalty = capacity.utilizationPercent > 100 ? 28 : Math.abs(78 - capacity.utilizationPercent) * 0.35
  const riskPenalty = risks.reduce((sum, risk) => sum + severityRank(risk.severity) * 4, 0)
  const evidenceBonus = Math.min(8, performance.evidenceProjectCount * 2)
  return clampScore(Math.round(100 - utilizationPenalty - riskPenalty + evidenceBonus))
}

function buildHealthScore(completionPercent: number, risks: PredictiveRisk[], budgetVariance: number | null): number {
  const riskPenalty = risks.reduce((sum, risk) => sum + severityRank(risk.severity) * 5, 0)
  const budgetPenalty = budgetVariance && budgetVariance > 0 ? 8 : 0
  return clampScore(Math.round(55 + completionPercent * 0.35 - riskPenalty - budgetPenalty))
}

function confidenceFromEvidence(points: number): number {
  if (points <= 0) {
    return 0.15
  }

  return Math.min(0.92, 0.32 + points * 0.08)
}

function secondsSince(value: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
}

function projectLabel(project: ProjectRow): string {
  return [project.year, project.make, project.model, project.submodel].filter(Boolean).join(' ')
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function severityRank(value: RiskLevel): number {
  const ranks: Record<RiskLevel, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4
  }

  return ranks[value]
}

function mapReport(row: ReportRow): PredictiveReport {
  return {
    id: row.id,
    reportType: row.report_type,
    status: row.status,
    localFileUrl: row.local_path ? `blackline-predictive://report/${row.id}` : null,
    createdAt: row.created_at
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function fallbackSimulation(row: SimulationRow): OperationalSimulationResult {
  return {
    id: row.id,
    scenarioName: row.scenario_name,
    projectedUtilizationPercent: 0,
    projectedAvailableCapacity: 0,
    projectedDelaySeconds: 0,
    overloadedStages: [],
    recommendations: [],
    confidence: 0,
    dataPoints: 0,
    explanation: 'Simulacion guardada sin resultado legible.',
    createdAt: row.created_at
  }
}
