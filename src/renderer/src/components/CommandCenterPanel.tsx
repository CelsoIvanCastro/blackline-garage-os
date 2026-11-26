import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  BarChart3,
  BookOpen,
  BrainCircuit,
  Check,
  Clock,
  Gauge,
  Map,
  RefreshCw,
  Search,
  ShieldAlert,
  Workflow
} from 'lucide-react'
import type {
  CommandCenterAlert,
  CommandCenterDashboard,
  CommandCenterKnowledgeResult,
  CommandCenterMode
} from '@shared/types'
import { garageApi } from '../api'

interface CommandCenterPanelProps {
  onOpenProject: (projectId: string) => void
}

const modes: Array<{ mode: CommandCenterMode; label: string }> = [
  { mode: 'executive', label: 'Direccion' },
  { mode: 'operational', label: 'Operativo' },
  { mode: 'restorer', label: 'Restaurador' }
]

export function CommandCenterPanel({ onOpenProject }: CommandCenterPanelProps) {
  const [mode, setMode] = useState<CommandCenterMode>('executive')
  const [dashboard, setDashboard] = useState<CommandCenterDashboard | null>(null)
  const [knowledgeQuery, setKnowledgeQuery] = useState('')
  const [knowledgeResults, setKnowledgeResults] = useState<CommandCenterKnowledgeResult[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    setError(null)
    try {
      const nextDashboard = await garageApi.commandCenter.getDashboard(mode)
      setDashboard(nextDashboard)
      if (!knowledgeQuery.trim()) {
        setKnowledgeResults(nextDashboard.knowledge)
      }
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [knowledgeQuery, mode])

  useEffect(() => {
    setIsLoading(true)
    void loadDashboard()
    const interval = window.setInterval(() => void loadDashboard(), 15000)
    return () => window.clearInterval(interval)
  }, [loadDashboard])

  const visibleAlerts = useMemo(() => {
    if (!dashboard) {
      return []
    }

    if (mode === 'executive') {
      return dashboard.alerts.filter((alert) => ['important', 'critical'].includes(alert.level)).slice(0, 8)
    }

    return dashboard.alerts.slice(0, mode === 'restorer' ? 10 : 12)
  }, [dashboard, mode])

  const visibleRecommendations = useMemo(() => {
    if (!dashboard) {
      return []
    }

    if (mode === 'operational') {
      return dashboard.recommendations.filter((item) => /compra|capacidad|proceso|pieza|acelerar/i.test(`${item.title} ${item.body}`)).slice(0, 8)
    }

    if (mode === 'restorer') {
      return dashboard.recommendations.filter((item) => /oem|pieza|proyecto|riesgo|faro|motor|interior/i.test(`${item.title} ${item.body}`)).slice(0, 8)
    }

    return dashboard.recommendations.slice(0, 6)
  }, [dashboard, mode])

  async function handleAcknowledge(alert: CommandCenterAlert): Promise<void> {
    setError(null)
    try {
      await garageApi.commandCenter.acknowledgeAlert(alert.id)
      await loadDashboard()
    } catch (actionError) {
      setError(getErrorMessage(actionError))
    }
  }

  async function handleKnowledgeSearch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    try {
      setKnowledgeResults(await garageApi.commandCenter.searchKnowledge({ query: knowledgeQuery, limit: 24 }))
    } catch (searchError) {
      setError(getErrorMessage(searchError))
    }
  }

  async function handleGenerateSummary(summaryType: 'daily' | 'weekly'): Promise<void> {
    setError(null)
    try {
      await garageApi.commandCenter.generateSummary({ summaryType })
      await loadDashboard()
    } catch (summaryError) {
      setError(getErrorMessage(summaryError))
    }
  }

  if (!dashboard) {
    return (
      <section className="command-center loading-state">
        <RefreshCw size={18} aria-hidden="true" />
        <span>{isLoading ? 'Cargando Command Center' : error ?? 'Sin datos disponibles'}</span>
      </section>
    )
  }

  return (
    <section className={`command-center mode-${mode}`} aria-label="BLACKLINE COMMAND CENTER">
      <header className="command-hero">
        <div>
          <p className="eyebrow">Centro de control e inteligencia operativa</p>
          <h2>BLACKLINE COMMAND CENTER</h2>
        </div>
        <div className="command-actions">
          <div className="segmented-control" role="tablist" aria-label="Modo Command Center">
            {modes.map((item) => (
              <button
                className={mode === item.mode ? 'active' : ''}
                key={item.mode}
                type="button"
                onClick={() => setMode(item.mode)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button className="primary-icon-button" type="button" onClick={() => void loadDashboard()}>
            <RefreshCw size={16} aria-hidden="true" />
            Actualizar
          </button>
        </div>
      </header>

      {error ? <div className="system-alert">{error}</div> : null}

      <div className="command-kpi-grid">
        {dashboard.kpis.map((kpi) => (
          <article className={`command-kpi ${kpi.level}`} key={kpi.id}>
            <span>{kpi.label}</span>
            <strong>{kpi.value}</strong>
            <small>{kpi.detail}</small>
          </article>
        ))}
      </div>

      <div className="command-layout">
        <section className="command-panel executive-summary-panel">
          <PanelTitle icon={<BrainCircuit size={17} />} title="Resumen Ejecutivo" badge={dashboard.generatedAt.slice(11, 16)} />
          <div className="summary-columns">
            <SummaryBlock title={dashboard.dailySummary.title} body={dashboard.dailySummary.body} metrics={dashboard.dailySummary.metrics} />
            <SummaryBlock title={dashboard.weeklySummary.title} body={dashboard.weeklySummary.body} metrics={dashboard.weeklySummary.metrics} />
          </div>
          <div className="command-inline-actions">
            <button type="button" onClick={() => void handleGenerateSummary('daily')}>
              Diario
            </button>
            <button type="button" onClick={() => void handleGenerateSummary('weekly')}>
              Semanal
            </button>
          </div>
        </section>

        <section className="command-panel productivity-panel">
          <PanelTitle icon={<Gauge size={17} />} title="Productividad" badge={`${dashboard.productivity.workshopScore}/100`} />
          <div className="productivity-grid">
            <Metric label="Activos" value={dashboard.productivity.activeProjects.toString()} />
            <Metric label="Terminados" value={dashboard.productivity.completedProjects.toString()} />
            <Metric label="Utilizacion" value={`${dashboard.productivity.utilizationPercent}%`} />
            <Metric label="Promedio" value={formatDuration(dashboard.productivity.averageCompletionSeconds)} />
            <Metric label="Costo prom." value={formatMoney(dashboard.productivity.averageCostCents ?? 0)} />
            <Metric label="Evidencia" value={dashboard.productivity.evidenceProjectCount.toString()} />
          </div>
        </section>

        <section className="command-panel alerts-panel">
          <PanelTitle icon={<ShieldAlert size={17} />} title="Centro de Alertas" badge={visibleAlerts.length.toString()} />
          <div className="command-list">
            {visibleAlerts.length === 0 ? <EmptyLine text="Sin alertas activas con los datos actuales" /> : null}
            {visibleAlerts.map((alert) => (
              <article className={`command-alert ${alert.level}`} key={alert.id}>
                <div>
                  <strong>{alert.title}</strong>
                  <span>{alert.body || alert.projectLabel || alert.source}</span>
                  <small>{alert.evidence}</small>
                </div>
                <button className="icon-button" type="button" title="Reconocer alerta" onClick={() => void handleAcknowledge(alert)}>
                  <Check size={15} aria-hidden="true" />
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="command-panel recommendations-panel">
          <PanelTitle icon={<Workflow size={17} />} title="Recomendaciones Estrategicas" badge={visibleRecommendations.length.toString()} />
          <div className="command-list">
            {visibleRecommendations.length === 0 ? <EmptyLine text="Sin recomendaciones nuevas" /> : null}
            {visibleRecommendations.map((recommendation) => (
              <button
                className="command-recommendation"
                key={recommendation.id}
                type="button"
                onClick={() => recommendation.projectId && onOpenProject(recommendation.projectId)}
              >
                <span>Prioridad {recommendation.priority}</span>
                <strong>{recommendation.title}</strong>
                <small>{recommendation.body}</small>
                <em>{recommendation.source} | {Math.round(recommendation.confidence * 100)}%</em>
              </button>
            ))}
          </div>
        </section>

        <section className="command-panel workshop-map-panel">
          <PanelTitle icon={<Map size={17} />} title="Mapa del Taller" badge={`${dashboard.stats.occupiedProcesses}/${dashboard.stats.occupiedProcesses + dashboard.stats.freeProcesses}`} />
          <div className="workshop-map-grid">
            {dashboard.workshopMap.map((area) => (
              <button
                className={`workshop-area ${area.status}`}
                key={area.stageCode}
                type="button"
                onClick={() => area.vehicle && onOpenProject(area.vehicle.id)}
              >
                <span>{area.occupied}/{area.capacity}</span>
                <strong>{area.stageName}</strong>
                <small>{area.vehicle ? `${area.vehicle.make} ${area.vehicle.model}` : 'Libre'}</small>
                <em>{formatDuration(area.accumulatedSeconds)}</em>
              </button>
            ))}
          </div>
        </section>

        <section className="command-panel vehicle-control-panel">
          <PanelTitle icon={<BarChart3 size={17} />} title="Control Total de Vehiculos" badge={dashboard.projects.length.toString()} />
          <div className="vehicle-control-list">
            {dashboard.projects.slice(0, 10).map((project) => (
              <button className="vehicle-control-item" key={project.id} type="button" onClick={() => onOpenProject(project.id)}>
                <strong>
                  {project.year ? `${project.year} ` : ''}
                  {project.make} {project.model}
                </strong>
                <span>{project.stageName}</span>
                <small>{project.status} | {formatMoney(project.totalCostCents)}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="command-panel knowledge-panel">
          <PanelTitle icon={<BookOpen size={17} />} title="Centro de Conocimiento" badge={knowledgeResults.length.toString()} />
          <form className="knowledge-search" onSubmit={(event) => void handleKnowledgeSearch(event)}>
            <Search size={15} aria-hidden="true" />
            <input value={knowledgeQuery} onChange={(event) => setKnowledgeQuery(event.target.value)} placeholder="Buscar manuales, OEM, historial, reportes" />
            <button type="submit">Buscar</button>
          </form>
          <div className="command-list">
            {knowledgeResults.length === 0 ? <EmptyLine text="Sin referencias indexadas todavia" /> : null}
            {knowledgeResults.slice(0, 8).map((item) => (
              <article className="knowledge-result" key={`${item.category}-${item.id}`}>
                <strong>{item.title}</strong>
                <span>{item.source} | {item.category}</span>
                <small>{item.projectLabel || item.detail || 'Referencia global'}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="command-panel audit-panel">
          <PanelTitle icon={<Clock size={17} />} title="Auditoria Operativa" badge={dashboard.auditTrail.length.toString()} />
          <div className="audit-timeline">
            {dashboard.auditTrail.length === 0 ? <EmptyLine text="Sin eventos auditables todavia" /> : null}
            {dashboard.auditTrail.slice(0, 12).map((entry) => (
              <article key={`${entry.source}-${entry.id}`}>
                <strong>{entry.title}</strong>
                <span>{entry.source} | {formatDate(entry.occurredAt)}</span>
                <small>{entry.projectLabel || entry.body || entry.eventType}</small>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}

function PanelTitle({ icon, title, badge }: { icon: ReactNode; title: string; badge: string }) {
  return (
    <div className="command-panel-title">
      <span>{icon}</span>
      <strong>{title}</strong>
      <small>{badge}</small>
    </div>
  )
}

function SummaryBlock({ title, body, metrics }: { title: string; body: string; metrics: string[] }) {
  return (
    <article className="summary-block">
      <strong>{title}</strong>
      <p>{body}</p>
      <div>
        {metrics.slice(0, 4).map((metric) => (
          <span key={metric}>{metric}</span>
        ))}
      </div>
    </article>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="mini-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function EmptyLine({ text }: { text: string }) {
  return <div className="empty-line">{text}</div>
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return 'Sin historial'
  }

  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`
  }

  if (seconds < 86400) {
    return `${Math.round(seconds / 3600)}h`
  }

  return `${Math.round(seconds / 86400)}d`
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Ocurrio un error inesperado.'
}
