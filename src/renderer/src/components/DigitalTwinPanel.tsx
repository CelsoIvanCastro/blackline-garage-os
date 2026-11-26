import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Camera, Clock, Eye, EyeOff, FileArchive, Layers, MousePointer2, RefreshCw, Save } from 'lucide-react'
import type {
  ChecklistItem,
  CopilotDigitalTwinFocus,
  DigitalTwinComponent,
  DigitalTwinDashboard,
  DigitalTwinLayerKey,
  DigitalTwinStatus,
  DigitalTwinViewMode,
  OemDashboard,
  PhotogrammetryJobStatus,
  ProjectDetail
} from '@shared/types'
import { garageApi } from '../api'
import { DigitalTwinCanvas } from './DigitalTwinCanvas'

interface DigitalTwinPanelProps {
  detail: ProjectDetail
  onRefreshProject: () => Promise<void>
  focus?: CopilotDigitalTwinFocus | null
}

const layerLabels: Record<DigitalTwinLayerKey, string> = {
  exterior: 'Exterior',
  interior: 'Interior',
  engine: 'Motor',
  chassis: 'Chasis',
  suspension: 'Suspension',
  electrical: 'Electrico',
  glass: 'Cristales',
  upholstery: 'Tapiceria'
}

const viewModes: Array<{ value: DigitalTwinViewMode; label: string }> = [
  { value: 'mixed', label: 'Mixto' },
  { value: 'exterior', label: 'Exterior' },
  { value: 'interior', label: 'Interior' }
]

type VisibleTwinStatus = DigitalTwinStatus | 'placeholder'

const twinStatusLabels: Record<VisibleTwinStatus, string> = {
  placeholder: 'Sin modelo',
  pending: 'Pendiente',
  processing: 'Procesando',
  ready: 'Completado',
  failed: 'Error',
  archived: 'Archivado'
}

export function DigitalTwinPanel({ detail, onRefreshProject, focus }: DigitalTwinPanelProps) {
  const [dashboard, setDashboard] = useState<DigitalTwinDashboard | null>(null)
  const [oemDashboard, setOemDashboard] = useState<OemDashboard | null>(null)
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null)
  const [background, setBackground] = useState<'white' | 'gray'>('white')
  const [viewMode, setViewMode] = useState<DigitalTwinViewMode>('mixed')
  const [transparentMode, setTransparentMode] = useState(false)
  const [xrayMode, setXrayMode] = useState(false)
  const [snapshotName, setSnapshotName] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isImportingZip, setIsImportingZip] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zipMessage, setZipMessage] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    setError(null)
    const [nextDashboard, nextOemDashboard] = await Promise.all([
      garageApi.digitalTwin.getDashboard(detail.project.id),
      garageApi.oem.getDashboard(detail.project.id)
    ])
    setDashboard(nextDashboard)
    setOemDashboard(nextOemDashboard)
  }, [detail.project.id])

  useEffect(() => {
    setSelectedComponentId(null)
    void loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    if (!focus) {
      return
    }

    setSelectedComponentId(focus.componentIds[0] ?? null)

    if (focus.layer === 'interior' || focus.layer === 'upholstery' || focus.layer === 'electrical') {
      setViewMode('interior')
    } else if (focus.layer) {
      setViewMode('exterior')
    }
  }, [focus])

  const selectedComponent = useMemo(
    () => dashboard?.components.find((component) => component.id === selectedComponentId) ?? null,
    [dashboard?.components, selectedComponentId]
  )

  const selectedTasks = useMemo(
    () => getLinkedTasks(selectedComponent, detail.checklist),
    [detail.checklist, selectedComponent]
  )

  const comparisonSummary = useMemo(() => buildComparisonSummary(dashboard), [dashboard])

  async function handleGenerate(): Promise<void> {
    setIsGenerating(true)
    setError(null)
    setZipMessage('Detectando COLMAP...')
    const progressTimer = window.setInterval(() => {
      void loadDashboard()
    }, 2500)

    try {
      await garageApi.digitalTwin.generate(detail.project.id)
      setZipMessage('Reconstruccion 3D completada.')
      await loadDashboard()
      await onRefreshProject()
    } catch (generateError) {
      const message = getErrorMessage(generateError)
      setError(message)
      setZipMessage('Error en reconstruccion 3D. Revisa los logs y vuelve a intentar.')
      await loadDashboard()
    } finally {
      window.clearInterval(progressTimer)
      setIsGenerating(false)
    }
  }

  async function handleImportZip(): Promise<void> {
    setIsImportingZip(true)
    setError(null)
    setZipMessage(null)

    try {
      const result = await garageApi.media.importPhotoZip({
        projectId: detail.project.id,
        category: 'exterior'
      })

      setZipMessage([result.message, result.warning].filter(Boolean).join(' '))
      await loadDashboard()
      await onRefreshProject()
    } catch (importError) {
      setError(getErrorMessage(importError))
      await loadDashboard()
    } finally {
      setIsImportingZip(false)
    }
  }

  async function handleLayerUpdate(layerId: string, input: { visible?: boolean; opacity?: number; xrayEnabled?: boolean }) {
    await garageApi.digitalTwin.updateLayer({ id: layerId, ...input })
    await loadDashboard()
  }

  async function handleSnapshot(): Promise<void> {
    const model = dashboard?.model

    if (!model) {
      return
    }

    await garageApi.digitalTwin.createSnapshot({
      digitalTwinId: model.id,
      name: snapshotName.trim() || `Snapshot ${new Date().toLocaleDateString('es-MX')}`,
      snapshotType: dashboard.snapshots.length === 0 ? 'initial' : 'milestone'
    })
    setSnapshotName('')
    await loadDashboard()
  }

  const modelReady = dashboard?.model?.status === 'ready'

  return (
    <div className="digital-twin-panel">
      <div className="twin-commandbar">
        <div>
          <p className="eyebrow">Gemelo Digital</p>
          <h4>{dashboard?.model?.name ?? `${detail.project.make} ${detail.project.model}`}</h4>
        </div>
        <div className="twin-actions">
          <button
            className="primary-icon-button"
            type="button"
            disabled={isImportingZip}
            onClick={() => void handleImportZip()}
          >
            <FileArchive size={16} aria-hidden="true" />
            {isImportingZip ? 'Importando' : 'Cargar ZIP de fotos'}
          </button>
          <button className="primary-icon-button" type="button" disabled={isGenerating} onClick={() => void handleGenerate()}>
            <RefreshCw size={16} aria-hidden="true" />
            {modelReady ? 'Actualizar' : 'Generar modelo 3D'}
          </button>
          <button
            className={background === 'gray' ? 'icon-button active' : 'icon-button'}
            type="button"
            title="Fondo gris claro"
            onClick={() => setBackground((value) => (value === 'white' ? 'gray' : 'white'))}
          >
            <Box size={16} aria-hidden="true" />
          </button>
          <button
            className={transparentMode ? 'icon-button active' : 'icon-button'}
            type="button"
            title="Transparencia"
            onClick={() => setTransparentMode((value) => !value)}
          >
            {transparentMode ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
          <button
            className={xrayMode ? 'icon-button active' : 'icon-button'}
            type="button"
            title="Rayos X"
            onClick={() => setXrayMode((value) => !value)}
          >
            <MousePointer2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {error ? <div className="system-alert">{error}</div> : null}
      {zipMessage ? <div className="system-alert">{zipMessage}</div> : null}
      {focus ? <div className="system-alert">Enfoque Blackline AI: {focus.reason}</div> : null}

      <div className="twin-stat-strip">
        <InfoStat label="Restauracion" value={`${Math.round(dashboard?.stats.restorationEstimate ?? 0)}%`} />
        <InfoStat label="Fotos/fotogramas" value={String(dashboard?.stats.sourceMediaCount ?? 0)} />
        <InfoStat label="Componentes" value={String(dashboard?.stats.componentCount ?? 0)} />
        <InfoStat label="Daños" value={String(dashboard?.stats.damageCount ?? 0)} />
        <InfoStat label="Checklist ligado" value={String(dashboard?.stats.linkedChecklistCount ?? 0)} />
        <InfoStat label="Estado 3D" value={labelTwinStatus(dashboard?.model?.status ?? 'placeholder')} />
      </div>

      <div className="twin-layout">
        <div className="twin-stage">
          {modelReady ? (
            <DigitalTwinCanvas
              dashboard={dashboard}
              background={background}
              viewMode={viewMode}
              transparentMode={transparentMode}
              xrayMode={xrayMode}
              selectedComponentId={selectedComponentId}
              focusComponentIds={focus?.componentIds ?? []}
              focusDamageMarkerIds={focus?.damageMarkerIds ?? []}
              onSelectComponent={(component) => setSelectedComponentId(component?.id ?? null)}
            />
          ) : (
            <div className="twin-empty">
              <Camera size={26} aria-hidden="true" />
              <strong>No hay modelo 3D generado todavia</strong>
              <span>{dashboard?.stats.sourceMediaCount ?? 0} archivo(s) disponible(s)</span>
              <span>Estado: {labelTwinStatus(dashboard?.model?.status ?? 'placeholder')}</span>
              <p>Sube un ZIP con fotos del vehiculo para iniciar reconstruccion.</p>
              <button
                className="primary-icon-button"
                type="button"
                disabled={isImportingZip}
                onClick={() => void handleImportZip()}
              >
                <FileArchive size={16} aria-hidden="true" />
                Cargar ZIP de fotos
              </button>
              <button className="primary-icon-button" type="button" disabled={isGenerating} onClick={() => void handleGenerate()}>
                <RefreshCw size={16} aria-hidden="true" />
                Generar modelo 3D
              </button>
            </div>
          )}
        </div>

        <aside className="twin-inspector">
          <div className="segmented-control" role="tablist" aria-label="Modo de vista">
            {viewModes.map((mode) => (
              <button
                key={mode.value}
                className={viewMode === mode.value ? 'active' : ''}
                type="button"
                onClick={() => setViewMode(mode.value)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <ComponentInspector component={selectedComponent} tasks={selectedTasks} />
        </aside>
      </div>

      <div className="twin-bottom-grid">
        <section className="twin-control-panel twin-log-panel">
          <div className="section-title">
            <span>
              <FileArchive size={15} aria-hidden="true" />
              Logs 3D
            </span>
            <small>{dashboard?.logs.length ?? 0}</small>
          </div>
          <div className="job-strip">
            {(dashboard?.photogrammetryJobs ?? []).slice(0, 3).map((job) => (
              <div className="job-pill" key={job.id}>
                <strong>{job.type === 'analysis' ? 'Analisis' : 'Reconstruccion'}</strong>
                <span>{labelJobStatus(job.status)}</span>
                <small>{job.progress}% / {job.imageCount} fotos</small>
              </div>
            ))}
            {(dashboard?.zipImports ?? []).slice(0, 2).map((zipImport) => (
              <div className="job-pill" key={zipImport.id}>
                <strong>{zipImport.filename}</strong>
                <span>{zipImport.importedCount} validas / {zipImport.ignoredCount} ignoradas</span>
                <small>{formatBytes(zipImport.sizeBytes)}</small>
              </div>
            ))}
          </div>
          <div className="twin-log-list">
            {(dashboard?.logs ?? []).length === 0 ? (
              <p>No hay logs de reconstruccion todavia.</p>
            ) : (
              (dashboard?.logs ?? []).map((log) => (
                <div className={`twin-log-entry ${log.level}`} key={log.id}>
                  <span>{formatDateTime(log.createdAt)}</span>
                  <p>{log.message}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="twin-control-panel">
          <div className="section-title">
            <span>
              <Layers size={15} aria-hidden="true" />
              Capas
            </span>
            <small>{dashboard?.layers.length ?? 0}</small>
          </div>
          <div className="layer-list">
            {(dashboard?.layers ?? []).map((layer) => (
              <div className="layer-row" key={layer.id}>
                <button
                  className={layer.visible ? 'icon-button active' : 'icon-button'}
                  type="button"
                  title={layer.visible ? 'Ocultar' : 'Mostrar'}
                  onClick={() => void handleLayerUpdate(layer.id, { visible: !layer.visible })}
                >
                  {layer.visible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                </button>
                <span>{layerLabels[layer.layer]}</span>
                <input
                  aria-label={`Opacidad ${layerLabels[layer.layer]}`}
                  min="0"
                  max="1"
                  step="0.05"
                  type="range"
                  value={layer.opacity}
                  onChange={(event) => void handleLayerUpdate(layer.id, { opacity: Number(event.target.value) })}
                />
                <button type="button" onClick={() => void handleLayerUpdate(layer.id, { opacity: 0.35 })}>
                  Parcial
                </button>
                <button type="button" onClick={() => void handleLayerUpdate(layer.id, { opacity: 0 })}>
                  Total
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="twin-control-panel">
          <div className="section-title">
            <span>
              <Save size={15} aria-hidden="true" />
              Snapshots
            </span>
            <small>{dashboard?.snapshots.length ?? 0}</small>
          </div>
          <div className="snapshot-form">
            <input value={snapshotName} onChange={(event) => setSnapshotName(event.target.value)} placeholder="Nombre" />
            <button className="primary-icon-button" type="button" disabled={!modelReady} onClick={() => void handleSnapshot()}>
              Guardar
            </button>
          </div>
          <div className="timeline compact">
            {(dashboard?.snapshots ?? []).map((snapshot) => (
              <div className="timeline-item" key={snapshot.id}>
                <span />
                <div>
                  <strong>{snapshot.name}</strong>
                  <p>{snapshot.snapshotType}</p>
                  <small>{formatDateTime(snapshot.createdAt)}</small>
                </div>
              </div>
            ))}
          </div>
          <div className="comparison-line">
            <strong>Comparacion temporal</strong>
            <span>{comparisonSummary}</span>
          </div>
        </section>

        <section className="twin-control-panel">
          <div className="section-title">
            <span>
              <Clock size={15} aria-hidden="true" />
              Timeline visual
            </span>
            <small>{dashboard?.timeline.length ?? 0}</small>
          </div>
          <div className="timeline compact">
            {(dashboard?.timeline ?? []).map((event) => (
              <div className="timeline-item" key={`${event.source}-${event.id}`}>
                <span />
                <div>
                  <strong>{event.title}</strong>
                  <p>{event.body || event.source}</p>
                  <small>{formatDateTime(event.occurredAt)}</small>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="twin-control-panel">
          <div className="section-title">
            <span>Comparar OEM</span>
            <small>{oemDashboard?.stats.generalMatch ?? 0}%</small>
          </div>
          <div className="oem-compare-mini">
            <InfoStat label="Exterior" value={`${oemDashboard?.stats.exteriorMatch ?? 0}%`} />
            <InfoStat label="Interior" value={`${oemDashboard?.stats.interiorMatch ?? 0}%`} />
            <InfoStat label="Mecanica" value={`${oemDashboard?.stats.mechanicalMatch ?? 0}%`} />
          </div>
          <div className="oem-difference-strip">
            {(oemDashboard?.suggestions ?? [])
              .filter((suggestion) => suggestion.status === 'pending')
              .slice(0, 4)
              .map((suggestion) => (
                <div className="oem-difference-pill" key={suggestion.id}>
                  <span>{suggestion.title}</span>
                  <strong>{Math.round(suggestion.confidence * 100)}%</strong>
                </div>
              ))}
            {(oemDashboard?.suggestions ?? []).filter((suggestion) => suggestion.status === 'pending').length === 0 ? (
              <span className="empty-slot">Sin diferencias OEM pendientes</span>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}

function ComponentInspector({ component, tasks }: { component: DigitalTwinComponent | null; tasks: ChecklistItem[] }) {
  if (!component) {
    return (
      <div className="component-inspector empty">
        <span>Selecciona un marcador</span>
      </div>
    )
  }

  return (
    <div className="component-inspector">
      <div className="component-heading">
        <span style={{ backgroundColor: component.color }} />
        <div>
          <strong>{component.name}</strong>
          <small>{layerLabels[component.layer]}</small>
        </div>
      </div>
      <dl>
        <div>
          <dt>Estado</dt>
          <dd>{labelState(component.state)}</dd>
        </div>
        <div>
          <dt>Confianza</dt>
          <dd>{Math.round(component.confidence * 100)}%</dd>
        </div>
        <div>
          <dt>Costos</dt>
          <dd>{formatMoney(component.costCents)}</dd>
        </div>
        <div>
          <dt>Tareas pendientes</dt>
          <dd>{component.pendingTaskCount}</dd>
        </div>
      </dl>
      {component.sourceMediaUrl ? (
        <figure className="component-photo">
          <img src={component.sourceMediaUrl} alt={component.name} />
        </figure>
      ) : null}
      <div className="linked-task-list">
        {tasks.map((task) => (
          <div className="linked-task" key={task.id}>
            <strong>{task.title}</strong>
            <span>{labelChecklistStatus(task.status)}</span>
          </div>
        ))}
        {tasks.length === 0 ? <span>Sin tareas ligadas</span> : null}
      </div>
      {component.notes ? <p className="component-notes">{component.notes}</p> : null}
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

function getLinkedTasks(component: DigitalTwinComponent | null, checklist: ChecklistItem[]): ChecklistItem[] {
  if (!component) {
    return []
  }

  const ids = new Set(component.checklistItemIds)
  return checklist.filter((item) => ids.has(item.id))
}

function buildComparisonSummary(dashboard: DigitalTwinDashboard | null): string {
  if (!dashboard || dashboard.snapshots.length === 0) {
    return 'Sin snapshot inicial'
  }

  const initial = dashboard.snapshots[dashboard.snapshots.length - 1]
  const initialStates = parseComponentStates(initial.componentStateJson)
  const currentById = new Map(dashboard.components.map((component) => [component.id, component.state]))
  const changed = initialStates.filter((component) => currentById.get(component.id) && currentById.get(component.id) !== component.state)

  return `${changed.length} componente(s) con cambio desde ${formatDate(initial.createdAt)}`
}

function parseComponentStates(value: string): Array<{ id: string; state: string }> {
  try {
    const parsed = JSON.parse(value) as Array<{ id: string; state: string }>
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function labelState(value: DigitalTwinComponent['state']): string {
  const labels = {
    uninspected: 'Sin inspeccionar',
    pending: 'Pendiente',
    damaged: 'Dañado',
    purchased_or_repaired: 'Comprado/Reparado',
    in_process: 'En proceso',
    completed: 'Completado'
  }

  return labels[value]
}

function labelChecklistStatus(value: ChecklistItem['status']): string {
  const labels = {
    pending: 'Pendiente',
    purchased_or_repaired: 'Comprado/Reparado',
    assembled: 'Ensamblado',
    completed: 'Completado'
  }

  return labels[value]
}

function labelTwinStatus(value: VisibleTwinStatus): string {
  return twinStatusLabels[value]
}

function labelJobStatus(value: PhotogrammetryJobStatus): string {
  const labels: Record<PhotogrammetryJobStatus, string> = {
    pending: 'Pendiente',
    processing: 'Procesando',
    completed: 'Completado',
    error: 'Error',
    waiting_for_engine: 'Pendiente de motor'
  }

  return labels[value]
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

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Ocurrio un error inesperado.'
}
