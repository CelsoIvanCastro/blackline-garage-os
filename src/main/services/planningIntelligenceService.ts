import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import {
  PIPELINE_STAGE_CODES,
  type ChecklistItem,
  type CreatePlanningReportInput,
  type CreatePlanningCostLineInput,
  type PipelineStageCode,
  type PlanningAlert,
  type PlanningCostLine,
  type PlanningDashboard,
  type PlanningRecommendation,
  type PlanningReport,
  type PlanningScenario,
  type PlanningScenarioSummary,
  type PlanningStageEstimate,
  type RiskLevel,
  type UpdatePlanningCostLineInput
} from '../../shared/types'
import { PlanningRepository, type ComparableProjectRow, type StageAverageRow } from '../repositories/planningRepository'
import { ProjectRepository } from '../repositories/projectRepository'

const stageLabels: Record<PipelineStageCode, string> = {
  inspection_total_general: 'Inspeccion Total General',
  mechanical_electrical: 'Mecanica / Electrico',
  sound: 'Sonido',
  exterior: 'Exterior',
  paint: 'Pintura',
  exterior_interior_assembly: 'Ensamblaje Exterior e Interior',
  total_detailing: 'Detallado Total',
  completed: 'Completado'
}

const scenarios: PlanningScenario[] = ['conservative', 'intermediate', 'complete_oem']

export class PlanningIntelligenceService {
  constructor(
    private readonly planningRepository: PlanningRepository,
    private readonly projectRepository: ProjectRepository
  ) {}

  getDashboard(projectId: string): PlanningDashboard {
    const detail = this.projectRepository.getProjectDetail(projectId)
    const costLines = this.planningRepository.listCostLines(projectId)
    const stageAverages = this.planningRepository.listStageAverages(projectId)
    const comparableRows = this.planningRepository.listComparableProjects(projectId, detail.project.make, detail.project.model)
    const stageEstimates = buildStageEstimates(detail, stageAverages)
    const alerts = buildAlerts(detail, stageEstimates, costLines, this.planningRepository)
    const recommendations = buildRecommendations(detail, alerts, this.planningRepository)
    const scenarioSummaries = buildScenarioSummaries(detail.project.totalCostCents, detail.project.budgetCents, costLines)
    const executive = buildExecutiveSummary(detail, scenarioSummaries, stageEstimates, alerts)
    const reports = this.planningRepository.listReports(projectId)

    return {
      executive,
      scenarioSummaries,
      costLines,
      stageEstimates,
      alerts,
      recommendations,
      workshopMetrics: buildWorkshopMetrics(this.planningRepository, stageAverages, comparableRows),
      comparableProjects: comparableRows.map((row) => ({
        projectId: row.id,
        label: [row.year, row.make, row.model].filter(Boolean).join(' '),
        totalCostCents: row.total_cost_cents,
        totalElapsedSeconds: row.elapsed_seconds ?? 0,
        completedAt: row.completed_at
      })),
      reports
    }
  }

  createCostLine(input: CreatePlanningCostLineInput): PlanningCostLine {
    this.projectRepository.getProjectById(input.projectId)
    return this.planningRepository.createCostLine(input)
  }

  updateCostLine(input: UpdatePlanningCostLineInput): PlanningCostLine {
    return this.planningRepository.updateCostLine(input)
  }

  deleteCostLine(id: string): void {
    this.planningRepository.deleteCostLine(id)
  }

  generateReport(input: CreatePlanningReportInput): PlanningReport {
    const detail = this.projectRepository.getProjectDetail(input.projectId)
    const report = this.planningRepository.createReport(input.projectId, input.reportType, input.format)
    const dashboard = this.getDashboard(input.projectId)
    const directory = path.join(getPlanningStorageDirectory(), 'projects', input.projectId, 'reports')
    fs.mkdirSync(directory, { recursive: true })
    const basename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${input.reportType}`
    const localPath = path.join(directory, input.format === 'pdf' ? `${basename}.pdf` : `${basename}.xls`)

    try {
      if (input.format === 'pdf') {
        fs.writeFileSync(localPath, buildSimplePdf(buildReportLines(detail, dashboard)))
      } else {
        fs.writeFileSync(localPath, buildExcelXml(buildReportLines(detail, dashboard)))
      }

      this.planningRepository.addHistoryEvent(
        input.projectId,
        'planning_report_generated',
        'Reporte avanzado generado',
        `${input.reportType} / ${input.format}`
      )
      return this.planningRepository.markReportGenerated(report.id, localPath)
    } catch {
      return this.planningRepository.markReportFailed(report.id)
    }
  }
}

export function getPlanningStorageDirectory(): string {
  return path.join(app.getPath('userData'), 'storage', 'planning')
}

function buildScenarioSummaries(
  investedCents: number,
  projectBudgetCents: number,
  lines: PlanningCostLine[]
): PlanningScenarioSummary[] {
  return scenarios.map((scenario) => {
    const scenarioLines = lines.filter((line) => line.scenario === scenario)
    const pendingCents = scenarioLines.reduce((sum, line) => sum + Math.max(0, line.estimatedCents - line.actualCents), 0)
    const estimatedTotalCents = investedCents + pendingCents
    const confidence =
      scenarioLines.length > 0
        ? scenarioLines.reduce((sum, line) => sum + line.confidence, 0) / scenarioLines.length
        : 0

    return {
      scenario,
      estimatedTotalCents,
      investedCents,
      pendingCents,
      budgetVarianceCents: projectBudgetCents > 0 ? estimatedTotalCents - projectBudgetCents : 0,
      lineCount: scenarioLines.length,
      confidence
    }
  })
}

function buildStageEstimates(detail: ReturnType<ProjectRepository['getProjectDetail']>, averages: StageAverageRow[]): PlanningStageEstimate[] {
  const currentIndex = PIPELINE_STAGE_CODES.indexOf(detail.project.stageCode)
  const averageByStage = new Map(averages.map((row) => [row.stage_code, row]))

  return PIPELINE_STAGE_CODES.map((stageCode, index) => {
    const average = averageByStage.get(stageCode)
    const stageTime = detail.stageTimes.find((item) => item.stageName === (average?.stage_name ?? stageLabels[stageCode]))
    const elapsedSeconds =
      stageCode === detail.project.stageCode
        ? detail.project.currentStageSeconds
        : stageTime?.durationSeconds ?? 0
    const estimatedSeconds = average?.average_seconds ? Math.round(average.average_seconds) : null
    const remainingSeconds =
      index < currentIndex
        ? 0
        : estimatedSeconds === null
          ? null
          : Math.max(0, estimatedSeconds - (stageCode === detail.project.stageCode ? elapsedSeconds : 0))

    return {
      stageCode,
      stageName: average?.stage_name ?? stageLabels[stageCode],
      estimatedSeconds,
      elapsedSeconds,
      remainingSeconds,
      evidenceProjectCount: average?.evidence_count ?? 0,
      delaySeconds: estimatedSeconds === null ? 0 : Math.max(0, elapsedSeconds - estimatedSeconds)
    }
  })
}

function buildExecutiveSummary(
  detail: ReturnType<ProjectRepository['getProjectDetail']>,
  summaries: PlanningScenarioSummary[],
  stages: PlanningStageEstimate[],
  alerts: PlanningAlert[]
): PlanningDashboard['executive'] {
  const intermediate = summaries.find((summary) => summary.scenario === 'intermediate') ?? summaries[0]
  const futureStages = stages.filter((stage) => stage.remainingSeconds !== 0)
  const hasCompleteTimeEvidence = futureStages.every((stage) => stage.remainingSeconds !== null)
  const estimatedRemainingSeconds = hasCompleteTimeEvidence
    ? futureStages.reduce((sum, stage) => sum + (stage.remainingSeconds ?? 0), 0)
    : null
  const estimatedFinishDate =
    estimatedRemainingSeconds === null
      ? null
      : new Date(Date.now() + estimatedRemainingSeconds * 1000).toISOString()

  return {
    completionPercent: calculateCompletionPercent(detail),
    riskLevel: resolveRisk(alerts),
    investedCents: detail.project.totalCostCents,
    estimatedPendingCents: intermediate.pendingCents,
    estimatedBudgetCents: intermediate.estimatedTotalCents,
    budgetVarianceCents: intermediate.budgetVarianceCents,
    elapsedSeconds: detail.project.totalElapsedSeconds,
    estimatedRemainingSeconds,
    estimatedFinishDate
  }
}

function buildAlerts(
  detail: ReturnType<ProjectRepository['getProjectDetail']>,
  stages: PlanningStageEstimate[],
  lines: PlanningCostLine[],
  repository: PlanningRepository
): PlanningAlert[] {
  const alerts: PlanningAlert[] = []
  const now = new Date().toISOString()
  const pendingChecklist = detail.checklist.filter((item) => !isChecklistItemClosed(item))
  const currentStage = stages.find((stage) => stage.stageCode === detail.project.stageCode)
  const missingParts = repository.countInspectionFindings(detail.project.id, 'missing_part')
  const pendingOem = repository.countOemPendingSuggestions(detail.project.id)
  const intermediatePending = lines
    .filter((line) => line.scenario === 'intermediate')
    .reduce((sum, line) => sum + Math.max(0, line.estimatedCents - line.actualCents), 0)
  const projectedTotal = detail.project.totalCostCents + intermediatePending

  if (detail.project.budgetCents > 0 && projectedTotal > detail.project.budgetCents) {
    const overage = projectedTotal - detail.project.budgetCents
    alerts.push({
      id: 'budget-overage',
      type: 'budget',
      severity: overage > detail.project.budgetCents * 0.2 ? 'critical' : 'high',
      title: 'Presupuesto en riesgo',
      body: 'El total invertido mas estimaciones intermedias supera el presupuesto actual.',
      evidence: `${projectedTotal} vs ${detail.project.budgetCents}`,
      createdAt: now
    })
  }

  if (currentStage && currentStage.delaySeconds > 0) {
    alerts.push({
      id: 'stage-delay',
      type: 'delay',
      severity: currentStage.delaySeconds > 7 * 86400 ? 'high' : 'medium',
      title: 'Proceso con retraso',
      body: `${currentStage.stageName} excede el promedio historico local.`,
      evidence: `${currentStage.evidenceProjectCount} proyecto(s) usados como referencia`,
      createdAt: now
    })
  }

  if (detail.project.status === 'paused') {
    alerts.push({
      id: 'project-paused',
      type: 'blocked_process',
      severity: 'medium',
      title: 'Proyecto pausado',
      body: 'El proyecto esta detenido dentro del pipeline.',
      evidence: detail.project.stageName,
      createdAt: now
    })
  }

  if (detail.project.stageCode === 'paint' && hasPendingSection(pendingChecklist, ['exterior'])) {
    alerts.push({
      id: 'paint-dependency',
      type: 'dependency',
      severity: 'high',
      title: 'Pintura bloqueada por exterior',
      body: 'Existen tareas exteriores pendientes antes de cerrar pintura.',
      evidence: pendingChecklist.filter((item) => item.section === 'exterior').map((item) => item.title).join(', '),
      createdAt: now
    })
  }

  if (detail.project.stageCode === 'exterior_interior_assembly' && (missingParts > 0 || pendingOem > 0)) {
    alerts.push({
      id: 'assembly-missing-parts',
      type: 'critical_part',
      severity: 'high',
      title: 'Ensamblaje con piezas pendientes',
      body: 'Hay piezas faltantes o diferencias OEM pendientes de decision.',
      evidence: `${missingParts} faltante(s) IA / ${pendingOem} sugerencia(s) OEM`,
      createdAt: now
    })
  }

  if (pendingChecklist.length > 0 && detail.project.stageCode === 'completed') {
    alerts.push({
      id: 'completion-dependency',
      type: 'dependency',
      severity: 'critical',
      title: 'Completado con checklist pendiente',
      body: 'El proyecto tiene tareas no ensambladas.',
      evidence: `${pendingChecklist.length} tarea(s)`,
      createdAt: now
    })
  }

  return alerts
}

function buildRecommendations(
  detail: ReturnType<ProjectRepository['getProjectDetail']>,
  alerts: PlanningAlert[],
  repository: PlanningRepository
): PlanningRecommendation[] {
  const recommendations: PlanningRecommendation[] = []
  const pending = detail.checklist.filter((item) => !isChecklistItemClosed(item))
  const purchased = pending.filter((item) => item.status === 'purchased_or_repaired')
  const missingParts = repository.countInspectionFindings(detail.project.id, 'missing_part')

  if (alerts.some((alert) => alert.type === 'dependency')) {
    recommendations.push({
      id: 'resolve-dependencies',
      type: 'dependency',
      priority: 1,
      title: 'Resolver dependencias antes de avanzar',
      body: 'Atiende los bloqueos activos para evitar retrabajo.',
      evidence: alerts.filter((alert) => alert.type === 'dependency').map((alert) => alert.title).join(', '),
      relatedChecklistItemIds: pending.slice(0, 4).map((item) => item.id)
    })
  }

  if (missingParts > 0) {
    recommendations.push({
      id: 'order-missing-parts',
      type: 'priority',
      priority: 2,
      title: 'Ordenar componentes pendientes',
      body: 'La inspeccion IA registra piezas posiblemente faltantes.',
      evidence: `${missingParts} hallazgo(s)`,
      relatedChecklistItemIds: pending.filter((item) => /compr|pieza|falt/i.test(item.title)).map((item) => item.id)
    })
  }

  if (purchased.length > 0) {
    recommendations.push({
      id: 'install-purchased',
      type: 'priority',
      priority: 3,
      title: 'Instalar piezas ya compradas o reparadas',
      body: 'Hay tareas listas para pasar a ensamblado.',
      evidence: `${purchased.length} tarea(s)`,
      relatedChecklistItemIds: purchased.map((item) => item.id)
    })
  }

  if (alerts.some((alert) => alert.type === 'budget')) {
    recommendations.push({
      id: 'review-budget',
      type: 'cost',
      priority: 2,
      title: 'Revisar presupuesto antes de comprar',
      body: 'El estimador detecta riesgo financiero con los datos actuales.',
      evidence: alerts.find((alert) => alert.type === 'budget')?.evidence ?? '',
      relatedChecklistItemIds: []
    })
  }

  if (recommendations.length === 0 && pending.length > 0) {
    const nextTask = pending[0]
    recommendations.push({
      id: 'next-checklist-task',
      type: 'priority',
      priority: 4,
      title: 'Siguiente tarea sugerida',
      body: nextTask.title,
      evidence: `Checklist ${nextTask.section}`,
      relatedChecklistItemIds: [nextTask.id]
    })
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: 'no-blockers',
      type: 'risk',
      priority: 5,
      title: 'Sin bloqueos detectados',
      body: 'No hay alertas con la informacion local actual.',
      evidence: 'Checklist, costos e historial revisados',
      relatedChecklistItemIds: []
    })
  }

  return recommendations.sort((a, b) => a.priority - b.priority)
}

function buildWorkshopMetrics(
  repository: PlanningRepository,
  stageAverages: StageAverageRow[],
  comparableRows: ComparableProjectRow[]
): PlanningDashboard['workshopMetrics'] {
  const completedCount = repository.countCompletedProjects()
  const paintAverage = stageAverages.find((stage) => stage.stage_code === 'paint')
  const damageFrequencies = repository.getDamageFrequencies()
  const completedComparable = comparableRows.filter((row) => row.completed_at)
  const averageComparableCost =
    completedComparable.length > 0
      ? Math.round(completedComparable.reduce((sum, row) => sum + row.total_cost_cents, 0) / completedComparable.length)
      : 0

  return [
    {
      label: 'Proyectos completados',
      value: String(completedCount),
      evidenceCount: completedCount
    },
    {
      label: 'Promedio pintura',
      value: paintAverage?.average_seconds ? formatDuration(Math.round(paintAverage.average_seconds)) : 'Sin historial',
      evidenceCount: paintAverage?.evidence_count ?? 0
    },
    {
      label: 'Costo promedio comparable',
      value: averageComparableCost > 0 ? formatMoney(averageComparableCost) : 'Sin historial',
      evidenceCount: completedComparable.length
    },
    {
      label: 'Daño frecuente',
      value: damageFrequencies[0]?.name ?? 'Sin historial',
      evidenceCount: damageFrequencies[0]?.count ?? 0
    }
  ]
}

function calculateCompletionPercent(detail: ReturnType<ProjectRepository['getProjectDetail']>): number {
  if (detail.checklist.length > 0) {
    return Math.round((detail.checklist.filter(isChecklistItemClosed).length / detail.checklist.length) * 100)
  }

  const index = PIPELINE_STAGE_CODES.indexOf(detail.project.stageCode)
  return Math.round((index / (PIPELINE_STAGE_CODES.length - 1)) * 100)
}

function resolveRisk(alerts: PlanningAlert[]): RiskLevel {
  const order: RiskLevel[] = ['low', 'medium', 'high', 'critical']

  return alerts.reduce<RiskLevel>((highest, alert) => {
    return order.indexOf(alert.severity) > order.indexOf(highest) ? alert.severity : highest
  }, 'low')
}

function hasPendingSection(items: ChecklistItem[], sections: ChecklistItem['section'][]): boolean {
  return items.some((item) => sections.includes(item.section))
}

function formatDuration(seconds: number): string {
  const days = Math.round(seconds / 86400)

  if (days > 0) {
    return `${days}d`
  }

  const hours = Math.round(seconds / 3600)
  return `${hours}h`
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(cents / 100)
}

function buildReportLines(
  detail: ReturnType<ProjectRepository['getProjectDetail']>,
  dashboard: PlanningDashboard
): string[] {
  const lines = [
    'BLACKLINE GARAGE OS - Reporte avanzado',
    `${detail.project.year ?? ''} ${detail.project.make} ${detail.project.model}`.trim(),
    `VIN: ${detail.project.vin || 'Sin VIN'}`,
    `Estado: ${detail.project.status}`,
    `Riesgo: ${dashboard.executive.riskLevel}`,
    `Avance: ${dashboard.executive.completionPercent}%`,
    `Invertido: ${formatMoney(dashboard.executive.investedCents)}`,
    `Pendiente estimado: ${formatMoney(dashboard.executive.estimatedPendingCents)}`,
    `Presupuesto estimado: ${formatMoney(dashboard.executive.estimatedBudgetCents)}`,
    `Fecha estimada: ${dashboard.executive.estimatedFinishDate ?? 'Sin evidencia suficiente'}`,
    '',
    'Escenarios'
  ]

  for (const summary of dashboard.scenarioSummaries) {
    lines.push(
      `${summary.scenario}: total ${formatMoney(summary.estimatedTotalCents)}, pendiente ${formatMoney(
        summary.pendingCents
      )}, confianza ${Math.round(summary.confidence * 100)}%`
    )
  }

  lines.push('', 'Alertas')
  for (const alert of dashboard.alerts) {
    lines.push(`${alert.severity.toUpperCase()} - ${alert.title}: ${alert.body}`)
  }

  lines.push('', 'Recomendaciones')
  for (const recommendation of dashboard.recommendations) {
    lines.push(`${recommendation.title}: ${recommendation.body}`)
  }

  return lines
}

function buildExcelXml(lines: string[]): string {
  const rows = lines
    .map((line) => {
      const escaped = escapeXml(line)
      return `<Row><Cell><Data ss:Type="String">${escaped}</Data></Cell></Row>`
    })
    .join('')

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Reporte">
  <Table>${rows}</Table>
 </Worksheet>
</Workbook>`
}

function buildSimplePdf(lines: string[]): Buffer {
  const escapedLines = lines.map((line) => escapePdf(line).slice(0, 110))
  const content = [
    'BT',
    '/F1 11 Tf',
    '48 780 Td',
    ...escapedLines.flatMap((line, index) => (index === 0 ? [`(${line}) Tj`] : ['0 -16 Td', `(${line}) Tj`])),
    'ET'
  ].join('\n')
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    `5 0 obj << /Length ${Buffer.byteLength(content)} >> stream\n${content}\nendstream endobj`
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${object}\n`
  }

  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf)
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function isChecklistItemClosed(item: ChecklistItem): boolean {
  return item.status === 'assembled' || item.status === 'completed'
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}
