import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BarChart3, CalendarClock, FileDown, Plus, Trash2 } from 'lucide-react'
import type {
  ComponentCostBucket,
  PipelineStageCode,
  PlanningDashboard,
  PlanningReportFormat,
  PlanningReportType,
  PlanningScenario,
  ProjectDetail
} from '@shared/types'
import { garageApi } from '../api'

interface PlanningPanelProps {
  detail: ProjectDetail
  onRefreshProject: () => Promise<void>
}

const scenarioLabels: Record<PlanningScenario, string> = {
  conservative: 'Conservador',
  intermediate: 'Intermedio',
  complete_oem: 'Completo OEM'
}

const bucketLabels: Record<ComponentCostBucket, string> = {
  purchase: 'Compra',
  repair: 'Reparacion',
  paint: 'Pintura',
  installation: 'Instalacion',
  shipping: 'Envio',
  import: 'Importacion'
}

const stageOptions: Array<{ value: PipelineStageCode; label: string }> = [
  { value: 'inspection_total_general', label: 'Inspeccion' },
  { value: 'mechanical_electrical', label: 'Mecanica' },
  { value: 'sound', label: 'Sonido' },
  { value: 'exterior', label: 'Exterior' },
  { value: 'paint', label: 'Pintura' },
  { value: 'exterior_interior_assembly', label: 'Ensamblaje' },
  { value: 'total_detailing', label: 'Detallado' },
  { value: 'completed', label: 'Entrega' }
]

const reportTypes: Array<{ value: PlanningReportType; label: string }> = [
  { value: 'executive', label: 'Ejecutivo' },
  { value: 'financial', label: 'Financiero' },
  { value: 'technical', label: 'Tecnico' },
  { value: 'progress', label: 'Avance' },
  { value: 'client', label: 'Cliente' }
]

export function PlanningPanel({ detail, onRefreshProject }: PlanningPanelProps) {
  const [dashboard, setDashboard] = useState<PlanningDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reportType, setReportType] = useState<PlanningReportType>('executive')
  const [reportFormat, setReportFormat] = useState<PlanningReportFormat>('pdf')
  const [draft, setDraft] = useState({
    scenario: 'intermediate' as PlanningScenario,
    stageCode: detail.project.stageCode,
    bucket: 'repair' as ComponentCostBucket,
    componentName: '',
    description: '',
    amount: '',
    evidence: ''
  })

  const loadDashboard = useCallback(async () => {
    setError(null)
    setDashboard(await garageApi.planning.getDashboard(detail.project.id))
  }, [detail.project.id])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const linesByScenario = useMemo(
    () =>
      new Map(
        (dashboard?.scenarioSummaries ?? []).map((summary) => [
          summary.scenario,
          dashboard?.costLines.filter((line) => line.scenario === summary.scenario) ?? []
        ])
      ),
    [dashboard]
  )

  async function handleCreateLine(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!draft.description.trim()) {
      return
    }

    await runAction(async () => {
      await garageApi.planning.createCostLine({
        projectId: detail.project.id,
        scenario: draft.scenario,
        stageCode: draft.stageCode,
        bucket: draft.bucket,
        componentName: draft.componentName,
        description: draft.description,
        estimatedCents: Math.round(Number(draft.amount || 0) * 100),
        evidence: draft.evidence,
        confidence: draft.evidence.trim() ? 0.65 : 0.35
      })
      setDraft({ ...draft, componentName: '', description: '', amount: '', evidence: '' })
      await loadDashboard()
    })
  }

  async function handleDeleteLine(id: string): Promise<void> {
    await runAction(async () => {
      await garageApi.planning.deleteCostLine(id)
      await loadDashboard()
    })
  }

  async function handleGenerateReport(): Promise<void> {
    await runAction(async () => {
      await garageApi.planning.generateReport({
        projectId: detail.project.id,
        reportType,
        format: reportFormat
      })
      await loadDashboard()
      await onRefreshProject()
    })
  }

  async function runAction(action: () => Promise<void>): Promise<void> {
    setError(null)

    try {
      await action()
    } catch (actionError) {
      setError(getErrorMessage(actionError))
    }
  }

  const executive = dashboard?.executive

  return (
    <div className="planning-panel">
      <div className="twin-commandbar">
        <div>
          <p className="eyebrow">Resumen Ejecutivo</p>
          <h4>{detail.project.make} {detail.project.model}</h4>
        </div>
        <span className={`risk-badge ${executive?.riskLevel ?? 'low'}`}>{labelRisk(executive?.riskLevel ?? 'low')}</span>
      </div>

      {error ? <div className="system-alert">{error}</div> : null}

      <div className="twin-stat-strip">
        <InfoStat label="Avance" value={`${executive?.completionPercent ?? 0}%`} />
        <InfoStat label="Invertido" value={formatMoney(executive?.investedCents ?? 0)} />
        <InfoStat label="Pendiente" value={formatMoney(executive?.estimatedPendingCents ?? 0)} />
        <InfoStat label="Variacion" value={formatMoney(executive?.budgetVarianceCents ?? 0)} />
        <InfoStat label="Entrega probable" value={executive?.estimatedFinishDate ? formatDate(executive.estimatedFinishDate) : 'Sin evidencia'} />
      </div>

      <div className="planning-grid">
        <section className="planning-card">
          <div className="section-title">
            <span>
              <BarChart3 size={15} aria-hidden="true" />
              Escenarios
            </span>
            <small>{dashboard?.costLines.length ?? 0} linea(s)</small>
          </div>
          <div className="scenario-grid">
            {(dashboard?.scenarioSummaries ?? []).map((summary) => (
              <div className="scenario-card" key={summary.scenario}>
                <strong>{scenarioLabels[summary.scenario]}</strong>
                <span>Total {formatMoney(summary.estimatedTotalCents)}</span>
                <span>Pendiente {formatMoney(summary.pendingCents)}</span>
                <small>{summary.lineCount} linea(s) / {Math.round(summary.confidence * 100)}% confianza</small>
              </div>
            ))}
          </div>

          <form className="planning-cost-form" onSubmit={handleCreateLine}>
            <select value={draft.scenario} onChange={(event) => setDraft({ ...draft, scenario: event.target.value as PlanningScenario })}>
              {Object.entries(scenarioLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select value={draft.stageCode} onChange={(event) => setDraft({ ...draft, stageCode: event.target.value as PipelineStageCode })}>
              {stageOptions.map((stage) => (
                <option key={stage.value} value={stage.value}>
                  {stage.label}
                </option>
              ))}
            </select>
            <select value={draft.bucket} onChange={(event) => setDraft({ ...draft, bucket: event.target.value as ComponentCostBucket })}>
              {Object.entries(bucketLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input value={draft.componentName} onChange={(event) => setDraft({ ...draft, componentName: event.target.value })} placeholder="Componente" />
            <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Descripcion" />
            <input value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="Monto" inputMode="decimal" />
            <input value={draft.evidence} onChange={(event) => setDraft({ ...draft, evidence: event.target.value })} placeholder="Evidencia" />
            <button className="primary-icon-button" type="submit">
              <Plus size={15} aria-hidden="true" />
              Agregar
            </button>
          </form>

          <div className="planning-line-list">
            {Array.from(linesByScenario.entries()).map(([scenario, lines]) =>
              lines.map((line) => (
                <div className="planning-line" key={line.id}>
                  <div>
                    <strong>{line.description}</strong>
                    <span>{scenarioLabels[scenario]} / {bucketLabels[line.bucket]} / {line.evidence || 'Sin evidencia adicional'}</span>
                  </div>
                  <strong>{formatMoney(line.estimatedCents)}</strong>
                  <button className="icon-button danger" type="button" title="Eliminar" onClick={() => void handleDeleteLine(line.id)}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))
            )}
            {dashboard?.costLines.length === 0 ? <div className="empty-slot">Sin estimaciones registradas</div> : null}
          </div>
        </section>

        <section className="planning-card">
          <div className="section-title">
            <span>
              <CalendarClock size={15} aria-hidden="true" />
              Cronograma visual
            </span>
            <small>{dashboard?.stageEstimates.filter((stage) => stage.evidenceProjectCount > 0).length ?? 0} con historial</small>
          </div>
          <div className="planning-timeline">
            {(dashboard?.stageEstimates ?? []).map((stage) => (
              <div className={stage.stageCode === detail.project.stageCode ? 'planning-stage active' : 'planning-stage'} key={stage.stageCode}>
                <span />
                <div>
                  <strong>{stage.stageName}</strong>
                  <p>
                    {stage.estimatedSeconds === null
                      ? 'Sin historial suficiente'
                      : `${formatDuration(stage.elapsedSeconds)} transcurrido / ${formatDuration(stage.remainingSeconds ?? 0)} restante`}
                  </p>
                  <small>{stage.evidenceProjectCount} referencia(s)</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="planning-grid">
        <section className="planning-card">
          <div className="section-title">
            <span>
              <AlertTriangle size={15} aria-hidden="true" />
              Riesgos y alertas
            </span>
            <small>{dashboard?.alerts.length ?? 0}</small>
          </div>
          <div className="planning-alert-list">
            {(dashboard?.alerts ?? []).map((alert) => (
              <div className={`planning-alert ${alert.severity}`} key={alert.id}>
                <strong>{alert.title}</strong>
                <p>{alert.body}</p>
                <span>{alert.evidence}</span>
              </div>
            ))}
            {dashboard?.alerts.length === 0 ? <div className="empty-slot">Sin alertas con la informacion actual</div> : null}
          </div>
        </section>

        <section className="planning-card">
          <div className="section-title">
            <span>Planificador Inteligente</span>
            <small>{dashboard?.recommendations.length ?? 0}</small>
          </div>
          <div className="planning-alert-list">
            {(dashboard?.recommendations ?? []).map((recommendation) => (
              <div className="planning-recommendation" key={recommendation.id}>
                <strong>{recommendation.title}</strong>
                <p>{recommendation.body}</p>
                <span>{recommendation.evidence}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="planning-grid">
        <section className="planning-card">
          <div className="section-title">
            <span>Historico del taller</span>
            <small>{dashboard?.comparableProjects.length ?? 0}</small>
          </div>
          <div className="twin-stat-strip compact-stats">
            {(dashboard?.workshopMetrics ?? []).map((metric) => (
              <InfoStat key={metric.label} label={metric.label} value={`${metric.value} (${metric.evidenceCount})`} />
            ))}
          </div>
          <div className="planning-line-list">
            {(dashboard?.comparableProjects ?? []).map((project) => (
              <div className="planning-line" key={project.projectId}>
                <div>
                  <strong>{project.label}</strong>
                  <span>{project.completedAt ? formatDate(project.completedAt) : 'No completado'}</span>
                </div>
                <strong>{formatMoney(project.totalCostCents)}</strong>
              </div>
            ))}
            {dashboard?.comparableProjects.length === 0 ? <div className="empty-slot">Sin proyectos comparables aun</div> : null}
          </div>
        </section>

        <section className="planning-card">
          <div className="section-title">
            <span>
              <FileDown size={15} aria-hidden="true" />
              Reportes avanzados
            </span>
            <small>{dashboard?.reports.length ?? 0}</small>
          </div>
          <div className="planning-report-form">
            <select value={reportType} onChange={(event) => setReportType(event.target.value as PlanningReportType)}>
              {reportTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            <select value={reportFormat} onChange={(event) => setReportFormat(event.target.value as PlanningReportFormat)}>
              <option value="pdf">PDF</option>
              <option value="excel">Excel</option>
            </select>
            <button className="primary-icon-button" type="button" onClick={() => void handleGenerateReport()}>
              Generar
            </button>
          </div>
          <div className="planning-line-list">
            {(dashboard?.reports ?? []).map((report) => (
              <div className="planning-line" key={report.id}>
                <div>
                  <strong>{report.reportType} / {report.format}</strong>
                  <span>{report.status} / {formatDate(report.createdAt)}</span>
                </div>
                {report.localFileUrl ? (
                  <a href={report.localFileUrl} target="_blank" rel="noreferrer">
                    Abrir
                  </a>
                ) : null}
              </div>
            ))}
            {dashboard?.reports.length === 0 ? <div className="empty-slot">Sin reportes generados</div> : null}
          </div>
        </section>
      </div>
    </div>
  )
}

function InfoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function labelRisk(value: string): string {
  const labels: Record<string, string> = {
    low: 'Riesgo bajo',
    medium: 'Riesgo medio',
    high: 'Riesgo alto',
    critical: 'Riesgo critico'
  }

  return labels[value] ?? value
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(cents / 100)
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(value))
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)

  if (days > 0) {
    return `${days}d ${hours}h`
  }

  return `${hours}h`
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Ocurrio un error inesperado.'
}
