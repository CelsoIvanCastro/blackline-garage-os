import { ChangeEvent, DragEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ImagePlus, Pencil, RefreshCw, Search, Upload, X } from 'lucide-react'
import { CHECKLIST_SECTIONS } from '@shared/inspectionCatalog'
import type {
  ChecklistSection,
  InspectionDashboard,
  InspectionFinding,
  InspectionFindingType,
  InspectionReviewStatus,
  UpdateInspectionFindingInput
} from '@shared/types'
import { garageApi } from '../api'

interface IntelligentInspectionPanelProps {
  projectId: string
  onRefreshProject: () => Promise<void>
}

type FindingDrafts = Record<string, UpdateInspectionFindingInput>

const findingTypeLabels: Record<InspectionFindingType, string> = {
  component: 'Componente',
  damage: 'Dano',
  missing_part: 'Pieza faltante',
  possible_modification: 'Posible modificacion'
}

const reviewLabels: Record<InspectionReviewStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado'
}

export function IntelligentInspectionPanel({ projectId, onRefreshProject }: IntelligentInspectionPanelProps) {
  const [dashboard, setDashboard] = useState<InspectionDashboard>({ runs: [], assets: [], findings: [] })
  const [drafts, setDrafts] = useState<FindingDrafts>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [findingType, setFindingType] = useState<'all' | InspectionFindingType>('all')
  const [reviewStatus, setReviewStatus] = useState<'all' | InspectionReviewStatus>('all')
  const [workCategory, setWorkCategory] = useState<'all' | ChecklistSection>('all')

  const loadDashboard = useCallback(async () => {
    setError(null)

    try {
      const nextDashboard = await garageApi.inspection.getDashboard(projectId)
      setDashboard(nextDashboard)
      setDrafts(
        Object.fromEntries(
          nextDashboard.findings.map((finding) => [
            finding.id,
            {
              id: finding.id,
              name: finding.name,
              description: finding.description,
              workCategory: finding.workCategory,
              suggestedAction: finding.suggestedAction,
              checklistTitle: finding.checklistTitle
            }
          ])
        )
      )
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    const hasRunning = dashboard.runs.some((run) => run.status === 'pending' || run.status === 'running')

    if (!hasRunning) {
      return undefined
    }

    const timer = window.setInterval(() => {
      void loadDashboard()
    }, 900)

    return () => window.clearInterval(timer)
  }, [dashboard.runs, loadDashboard])

  const latestRun = dashboard.runs[0] ?? null
  const filteredFindings = useMemo(
    () =>
      dashboard.findings.filter((finding) => {
        if (findingType !== 'all' && finding.findingType !== findingType) return false
        if (reviewStatus !== 'all' && finding.reviewStatus !== reviewStatus) return false
        if (workCategory !== 'all' && finding.workCategory !== workCategory) return false
        return true
      }),
    [dashboard.findings, findingType, reviewStatus, workCategory]
  )

  async function handleDialogImport(): Promise<void> {
    await runImport(async () => {
      await garageApi.inspection.importFiles({ projectId })
    })
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files)

    if (files.length === 0) {
      return
    }

    await runImport(async () => {
      await garageApi.inspection.importDroppedFiles(projectId, files)
    })
  }

  async function runImport(action: () => Promise<void>): Promise<void> {
    setIsImporting(true)
    setError(null)

    try {
      await action()
      await loadDashboard()
    } catch (importError) {
      setError(getErrorMessage(importError))
    } finally {
      setIsImporting(false)
    }
  }

  async function saveFinding(event: FormEvent<HTMLFormElement>, finding: InspectionFinding): Promise<void> {
    event.preventDefault()
    const draft = drafts[finding.id]

    if (!draft) {
      return
    }

    await runFindingAction(async () => {
      await garageApi.inspection.updateFinding(draft)
    })
  }

  async function approveFinding(finding: InspectionFinding): Promise<void> {
    await runFindingAction(async () => {
      await garageApi.inspection.approveFinding(finding.id)
      await onRefreshProject()
    })
  }

  async function rejectFinding(finding: InspectionFinding): Promise<void> {
    await runFindingAction(async () => {
      await garageApi.inspection.rejectFinding(finding.id)
      await onRefreshProject()
    })
  }

  async function runFindingAction(action: () => Promise<void>): Promise<void> {
    setError(null)

    try {
      await action()
      await loadDashboard()
    } catch (actionError) {
      setError(getErrorMessage(actionError))
    }
  }

  function updateDraft(id: string, input: Partial<UpdateInspectionFindingInput>): void {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...current[id],
        id,
        ...input
      }
    }))
  }

  return (
    <section className="inspection-panel">
      <div className="inspection-header">
        <div>
          <p className="eyebrow">Inspeccion Inteligente</p>
          <h4>Analisis local de fotografias y videos</h4>
        </div>
        <button className="primary-icon-button" type="button" onClick={() => void handleDialogImport()} disabled={isImporting}>
          <Upload size={16} aria-hidden="true" />
          Cargar
        </button>
      </div>

      <div
        className={isImporting ? 'inspection-dropzone active' : 'inspection-dropzone'}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => void handleDrop(event)}
      >
        <ImagePlus size={22} aria-hidden="true" />
        <span>Arrastra JPG, JPEG, PNG, HEIC, MP4 o MOV</span>
      </div>

      {error ? <div className="system-alert">{error}</div> : null}

      <div className="inspection-summary-grid">
        <SummaryTile label="Restauracion estimada" value={latestRun ? `${Math.round(latestRun.restorationEstimate)}%` : '-'} />
        <SummaryTile label="Componentes" value={(latestRun?.componentCount ?? 0).toString()} />
        <SummaryTile label="Danos" value={(latestRun?.damageCount ?? 0).toString()} />
        <SummaryTile label="Faltantes" value={(latestRun?.missingPartCount ?? 0).toString()} />
      </div>

      {latestRun ? (
        <div className="inspection-run-status">
          <div>
            <strong>{translateRunStatus(latestRun.status)}</strong>
            <span>{latestRun.summary || latestRun.modelName}</span>
          </div>
          <div className="progress-track">
            <span style={{ width: `${latestRun.progress}%` }} />
          </div>
          <small>{latestRun.processedAssets}/{latestRun.assetsTotal} archivo(s) procesado(s)</small>
        </div>
      ) : (
        <div className="empty-slot">Sin inspecciones IA</div>
      )}

      <div className="inspection-filters">
        <label>
          <Search size={14} aria-hidden="true" />
          <select value={findingType} onChange={(event) => setFindingType(event.target.value as 'all' | InspectionFindingType)}>
            <option value="all">Todos los hallazgos</option>
            <option value="component">Componentes</option>
            <option value="damage">Danos</option>
            <option value="missing_part">Faltantes</option>
            <option value="possible_modification">Modificaciones</option>
          </select>
        </label>
        <select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as 'all' | InspectionReviewStatus)}>
          <option value="all">Todos los estados</option>
          <option value="pending">Pendientes</option>
          <option value="approved">Aprobados</option>
          <option value="rejected">Rechazados</option>
        </select>
        <select value={workCategory} onChange={(event) => setWorkCategory(event.target.value as 'all' | ChecklistSection)}>
          <option value="all">Todas las areas</option>
          {CHECKLIST_SECTIONS.map((section) => (
            <option key={section.value} value={section.value}>
              {section.label}
            </option>
          ))}
        </select>
        <button className="icon-button" type="button" title="Actualizar" onClick={() => void loadDashboard()}>
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="intelligent-gallery">
        {dashboard.assets.map((asset) => (
          <figure className="inspection-asset" key={asset.id}>
            {asset.kind === 'video' ? (
              <video src={asset.mediaUrl} controls muted />
            ) : (
              <img src={asset.mediaUrl} alt={asset.filename} />
            )}
            <figcaption>
              <span>{asset.kind === 'frame' ? 'Fotograma' : asset.kind === 'video' ? 'Video' : 'Imagen'}</span>
              <small>{asset.componentCount} comp. / {asset.damageCount} danos</small>
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="inspection-findings">
        {filteredFindings.map((finding) => {
          const draft = drafts[finding.id] ?? { id: finding.id }

          return (
            <form className={`finding-card ${finding.reviewStatus}`} key={finding.id} onSubmit={(event) => void saveFinding(event, finding)}>
              <div className="finding-media">
                <img src={finding.mediaUrl} alt={finding.name} />
                {finding.boundingBox ? <BoxOverlay box={finding.boundingBox} /> : null}
              </div>
              <div className="finding-body">
                <div className="finding-title-row">
                  <span>{findingTypeLabels[finding.findingType]}</span>
                  <strong>{Math.round(finding.confidence * 100)}%</strong>
                </div>
                <input
                  value={draft.name ?? ''}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => updateDraft(finding.id, { name: event.target.value })}
                />
                <textarea
                  value={draft.description ?? ''}
                  onChange={(event) => updateDraft(finding.id, { description: event.target.value })}
                />
                <div className="finding-controls">
                  <select
                    value={draft.workCategory ?? finding.workCategory}
                    onChange={(event) => updateDraft(finding.id, { workCategory: event.target.value as ChecklistSection })}
                  >
                    {CHECKLIST_SECTIONS.map((section) => (
                      <option key={section.value} value={section.value}>
                        {section.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={draft.checklistTitle ?? ''}
                    onChange={(event) => updateDraft(finding.id, { checklistTitle: event.target.value })}
                    placeholder="Tarea sugerida"
                  />
                </div>
                <div className="finding-actions">
                  <span className={`review-chip ${finding.reviewStatus}`}>{reviewLabels[finding.reviewStatus]}</span>
                  <button className="icon-button" type="submit" title="Guardar edicion">
                    <Pencil size={14} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button approve"
                    type="button"
                    title="Aprobar"
                    disabled={finding.reviewStatus === 'approved'}
                    onClick={() => void approveFinding(finding)}
                  >
                    <Check size={14} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button danger"
                    type="button"
                    title="Rechazar"
                    disabled={finding.reviewStatus === 'rejected'}
                    onClick={() => void rejectFinding(finding)}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </form>
          )
        })}
        {!isLoading && filteredFindings.length === 0 ? <div className="empty-slot">Sin hallazgos para este filtro</div> : null}
      </div>
    </section>
  )
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="inspection-summary-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function BoxOverlay({ box }: { box: { x: number; y: number; width: number; height: number } }) {
  return (
    <span
      className="finding-box"
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.width * 100}%`,
        height: `${box.height * 100}%`
      }}
    />
  )
}

function translateRunStatus(status: string): string {
  if (status === 'pending') return 'Pendiente'
  if (status === 'running') return 'Analizando'
  if (status === 'completed') return 'Completado'
  return 'Fallido'
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Ocurrio un error en inspeccion IA.'
}

