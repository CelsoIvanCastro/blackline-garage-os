import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, BrainCircuit, FileDown, Gauge, Play, RefreshCw } from 'lucide-react'
import type {
  PipelineStageCode,
  PredictiveDashboard,
  PredictiveReportType,
  ProjectPrediction,
  RunOperationalSimulationInput
} from '@shared/types'
import { garageApi } from '../api'

interface OperationalIntelligencePanelProps {
  projectId?: string | null
  compact?: boolean
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

const reportLabels: Record<PredictiveReportType, string> = {
  risk: 'Riesgos',
  productivity: 'Productividad',
  capacity: 'Capacidad',
  predictions: 'Predicciones'
}

const emptyDashboard: PredictiveDashboard = {
  workshopScore: 0,
  capacity: {
    currentCapacity: 0,
    maximumCapacity: 0,
    usedCapacity: 0,
    availableCapacity: 0,
    utilizationPercent: 0,
    overloadedStages: [],
    emptyStages: [],
    underusedStages: []
  },
  performance: {
    completedVehicles: 0,
    averageCompletionSeconds: null,
    averageCostCents: null,
    productivityScore: 0,
    evidenceProjectCount: 0
  },
  projectPredictions: [],
  bottlenecks: [],
  risks: [],
  recommendations: [],
  simulations: [],
  reports: []
}

export function OperationalIntelligencePanel({ projectId = null, compact = false }: OperationalIntelligencePanelProps) {
  const [dashboard, setDashboard] = useState<PredictiveDashboard>(emptyDashboard)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [simulationDraft, setSimulationDraft] = useState({
    scenarioName: '',
    newVehicleCount: '0',
    stageDelayCode: 'paint' as PipelineStageCode,
    stageDelayDays: '0',
    missingPartsDelayDays: '0',
    capacityStageCode: 'paint' as PipelineStageCode,
    capacityDelta: '0'
  })

  const loadDashboard = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      setDashboard(await garageApi.predictive.getDashboard(projectId))
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const focusedPrediction = useMemo<ProjectPrediction | null>(() => {
    if (!projectId) {
      return dashboard.projectPredictions[0] ?? null
    }

    return dashboard.projectPredictions.find((prediction) => prediction.projectId === projectId) ?? null
  }, [dashboard.projectPredictions, projectId])

  async function runAction(action: () => Promise<void>): Promise<void> {
    setError(null)

    try {
      await action()
      await loadDashboard()
    } catch (actionError) {
      setError(getErrorMessage(actionError))
    }
  }

  async function handleSimulation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const input: RunOperationalSimulationInput = {
      projectId,
      scenarioName: simulationDraft.scenarioName,
      newVehicleCount: Number(simulationDraft.newVehicleCount || 0),
      stageDelayCode: Number(simulationDraft.stageDelayDays || 0) > 0 ? simulationDraft.stageDelayCode : null,
      stageDelayDays: Number(simulationDraft.stageDelayDays || 0),
      missingPartsDelayDays: Number(simulationDraft.missingPartsDelayDays || 0),
      capacityChanges:
        Number(simulationDraft.capacityDelta || 0) === 0
          ? []
          : [{ stageCode: simulationDraft.capacityStageCode, capacityDelta: Number(simulationDraft.capacityDelta || 0) }]
    }

    await runAction(async () => {
      await garageApi.predictive.runSimulation(input)
    })
  }

  async function handleGenerateReport(reportType: PredictiveReportType): Promise<void> {
    await runAction(async () => {
      await garageApi.predictive.generateReport({ reportType, projectId })
    })
  }

  return (
    <section className={compact ? 'operational-intelligence compact' : 'operational-intelligence'}>
      <div className="twin-commandbar">
        <div>
          <p className="eyebrow">Predictive Engine</p>
          <h4>Centro de Inteligencia Operativa</h4>
        </div>
        <button className="primary-icon-button" type="button" disabled={isLoading} onClick={() => void loadDashboard()}>
          <RefreshCw size={16} aria-hidden="true" />
          Actualizar
        </button>
      </div>

      {error ? <div className="system-alert">{error}</div> : null}

      <div className="predictive-stat-strip">
        <InfoStat label="Workshop Score" value={`${dashboard.workshopScore}/100`} />
        <InfoStat label="Utilizacion" value={`${dashboard.capacity.utilizationPercent}%`} />
        <InfoStat label="Capacidad libre" value={String(dashboard.capacity.availableCapacity)} />
        <InfoStat label="Riesgos" value={String(dashboard.risks.length)} />
        <InfoStat label="Evidencia" value={String(dashboard.performance.evidenceProjectCount)} />
      </div>

      {focusedPrediction ? (
        <section className="predictive-focus-card">
          <div>
            <span className={`health-score ${scoreTone(focusedPrediction.healthScore)}`}>{focusedPrediction.healthScore}</span>
          </div>
          <div>
            <strong>{focusedPrediction.projectLabel}</strong>
            <p>
              {focusedPrediction.stageName} / avance {focusedPrediction.completionPercent}% / confianza {Math.round(focusedPrediction.confidence * 100)}%
            </p>
            <small>{focusedPrediction.explanation}</small>
          </div>
          <div>
            <span>Entrega probable</span>
            <strong>{focusedPrediction.probableFinishDate ? formatDate(focusedPrediction.probableFinishDate) : 'Sin evidencia'}</strong>
          </div>
          <div>
            <span>Costo predicho</span>
            <strong>{focusedPrediction.predictedCostCents === null ? 'Sin evidencia' : formatMoney(focusedPrediction.predictedCostCents)}</strong>
          </div>
        </section>
      ) : null}

      <div className="predictive-grid">
        <section className="predictive-card">
          <div className="section-title">
            <span>
              <AlertTriangle size={15} aria-hidden="true" />
              Riesgos inteligentes
            </span>
            <small>{dashboard.risks.length}</small>
          </div>
          <div className="predictive-list">
            {dashboard.risks.slice(0, compact ? 4 : 8).map((risk) => (
              <article className={`predictive-risk ${risk.severity}`} key={risk.id}>
                <strong>{risk.title}</strong>
                <span>{risk.body}</span>
                <small>{risk.evidence} / {Math.round(risk.confidence * 100)}%</small>
              </article>
            ))}
            {dashboard.risks.length === 0 ? <div className="empty-slot">Sin riesgos predictivos altos</div> : null}
          </div>
        </section>

        <section className="predictive-card">
          <div className="section-title">
            <span>
              <Gauge size={15} aria-hidden="true" />
              Capacidad y cuellos
            </span>
            <small>{dashboard.bottlenecks.length}</small>
          </div>
          <div className="predictive-list">
            {dashboard.bottlenecks.slice(0, compact ? 4 : 8).map((bottleneck) => (
              <article className={`predictive-risk ${bottleneck.severity}`} key={bottleneck.stageCode}>
                <strong>{bottleneck.stageName}</strong>
                <span>{bottleneck.activeCount}/{bottleneck.capacity} ocupado, {bottleneck.utilizationPercent}%</span>
                <small>{bottleneck.explanation} / {Math.round(bottleneck.confidence * 100)}%</small>
              </article>
            ))}
          </div>
        </section>

        {!compact ? (
          <section className="predictive-card">
            <div className="section-title">
              <span>
                <BrainCircuit size={15} aria-hidden="true" />
                Simulacion Operativa
              </span>
              <small>{dashboard.simulations.length}</small>
            </div>
            <form className="predictive-simulation-form" onSubmit={handleSimulation}>
              <input value={simulationDraft.scenarioName} onChange={(event) => setSimulationDraft({ ...simulationDraft, scenarioName: event.target.value })} placeholder="Nombre del escenario" />
              <input value={simulationDraft.newVehicleCount} onChange={(event) => setSimulationDraft({ ...simulationDraft, newVehicleCount: event.target.value })} placeholder="Vehiculos nuevos" inputMode="numeric" />
              <select value={simulationDraft.stageDelayCode} onChange={(event) => setSimulationDraft({ ...simulationDraft, stageDelayCode: event.target.value as PipelineStageCode })}>
                {stageOptions.map((stage) => (
                  <option key={stage.value} value={stage.value}>
                    {stage.label}
                  </option>
                ))}
              </select>
              <input value={simulationDraft.stageDelayDays} onChange={(event) => setSimulationDraft({ ...simulationDraft, stageDelayDays: event.target.value })} placeholder="Retraso dias" inputMode="numeric" />
              <input value={simulationDraft.missingPartsDelayDays} onChange={(event) => setSimulationDraft({ ...simulationDraft, missingPartsDelayDays: event.target.value })} placeholder="Faltantes dias" inputMode="numeric" />
              <select value={simulationDraft.capacityStageCode} onChange={(event) => setSimulationDraft({ ...simulationDraft, capacityStageCode: event.target.value as PipelineStageCode })}>
                {stageOptions.map((stage) => (
                  <option key={stage.value} value={stage.value}>
                    {stage.label}
                  </option>
                ))}
              </select>
              <input value={simulationDraft.capacityDelta} onChange={(event) => setSimulationDraft({ ...simulationDraft, capacityDelta: event.target.value })} placeholder="Cambio capacidad" inputMode="numeric" />
              <button className="primary-icon-button" type="submit">
                <Play size={15} aria-hidden="true" />
                Simular
              </button>
            </form>
            <div className="predictive-list">
              {dashboard.simulations.slice(0, 4).map((simulation) => (
                <article className="predictive-simulation" key={simulation.id ?? simulation.createdAt}>
                  <strong>{simulation.scenarioName}</strong>
                  <span>Utilizacion {simulation.projectedUtilizationPercent}% / demora {formatDuration(simulation.projectedDelaySeconds)}</span>
                  <small>{simulation.explanation}</small>
                </article>
              ))}
              {dashboard.simulations.length === 0 ? <div className="empty-slot">Sin simulaciones guardadas</div> : null}
            </div>
          </section>
        ) : null}

        <section className="predictive-card">
          <div className="section-title">
            <span>
              <Activity size={15} aria-hidden="true" />
              Recomendaciones
            </span>
            <small>{dashboard.recommendations.length}</small>
          </div>
          <div className="predictive-list">
            {dashboard.recommendations.slice(0, compact ? 4 : 8).map((recommendation) => (
              <article className="predictive-recommendation" key={recommendation.id}>
                <strong>{recommendation.title}</strong>
                <span>{recommendation.body}</span>
                <small>{recommendation.evidence} / {Math.round(recommendation.confidence * 100)}%</small>
              </article>
            ))}
          </div>
        </section>

        {!compact ? (
          <section className="predictive-card">
            <div className="section-title">
              <span>
                <FileDown size={15} aria-hidden="true" />
                Reportes ejecutivos
              </span>
              <small>{dashboard.reports.length}</small>
            </div>
            <div className="predictive-report-actions">
              {(Object.keys(reportLabels) as PredictiveReportType[]).map((reportType) => (
                <button className="primary-icon-button" key={reportType} type="button" onClick={() => void handleGenerateReport(reportType)}>
                  <FileDown size={15} aria-hidden="true" />
                  {reportLabels[reportType]}
                </button>
              ))}
            </div>
            <div className="planning-line-list">
              {dashboard.reports.map((report) => (
                <div className="planning-line" key={report.id}>
                  <div>
                    <strong>{reportLabels[report.reportType]}</strong>
                    <span>{formatDateTime(report.createdAt)}</span>
                  </div>
                  <strong>{report.status}</strong>
                  {report.localFileUrl ? <a href={report.localFileUrl}>Abrir</a> : <span>Sin archivo</span>}
                </div>
              ))}
              {dashboard.reports.length === 0 ? <div className="empty-slot">Sin reportes predictivos</div> : null}
            </div>
          </section>
        ) : null}
      </div>
    </section>
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

function scoreTone(score: number): string {
  if (score >= 82) {
    return 'healthy'
  }

  if (score >= 62) {
    return 'watch'
  }

  return 'risk'
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

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function formatDuration(seconds: number): string {
  const days = Math.round(seconds / 86400)

  if (days > 0) {
    return `${days}d`
  }

  return `${Math.round(seconds / 3600)}h`
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Ocurrio un error inesperado.'
}
