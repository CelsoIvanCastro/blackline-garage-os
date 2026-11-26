import { DragEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Check, FileSearch, Library, Plus, RefreshCw, Upload, X } from 'lucide-react'
import type {
  CreateOemKnowledgeItemInput,
  OemComparisonSuggestion,
  OemDashboard,
  OemKnowledgeCategory,
  OemReferenceFileType,
  ProjectDetail
} from '@shared/types'
import { garageApi } from '../api'

interface OemResearchPanelProps {
  detail: ProjectDetail
  onRefreshProject: () => Promise<void>
}

const knowledgeCategories: Array<{ value: OemKnowledgeCategory; label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'catalog', label: 'Catalogo' },
  { value: 'diagram', label: 'Diagrama' },
  { value: 'oem_photo', label: 'Foto OEM' },
  { value: 'oem_color', label: 'Color OEM' },
  { value: 'oem_interior', label: 'Interior OEM' },
  { value: 'oem_engine', label: 'Motor OEM' },
  { value: 'technical_specification', label: 'Especificacion' },
  { value: 'equipment', label: 'Equipamiento' },
  { value: 'documentation', label: 'Documento' }
]

const fileTypes: Array<{ value: OemReferenceFileType; label: string }> = [
  { value: 'document', label: 'Documento' },
  { value: 'photo', label: 'Foto' },
  { value: 'manual', label: 'Manual' },
  { value: 'catalog', label: 'Catalogo' },
  { value: 'diagram', label: 'Diagrama' },
  { value: 'technical', label: 'Tecnico' }
]

export function OemResearchPanel({ detail, onRefreshProject }: OemResearchPanelProps) {
  const [dashboard, setDashboard] = useState<OemDashboard | null>(null)
  const [category, setCategory] = useState<OemKnowledgeCategory>('manual')
  const [fileType, setFileType] = useState<OemReferenceFileType>('document')
  const [isResearching, setIsResearching] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualDraft, setManualDraft] = useState({
    title: '',
    category: 'technical_specification' as OemKnowledgeCategory,
    sourceName: '',
    sourceUrl: ''
  })

  const loadDashboard = useCallback(async () => {
    setError(null)
    setDashboard(await garageApi.oem.getDashboard(detail.project.id))
  }, [detail.project.id])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const groupedSuggestions = useMemo(() => {
    const pending = dashboard?.suggestions.filter((suggestion) => suggestion.status === 'pending') ?? []
    const reviewed = dashboard?.suggestions.filter((suggestion) => suggestion.status !== 'pending') ?? []
    return { pending, reviewed }
  }, [dashboard?.suggestions])

  async function handleResearch(): Promise<void> {
    setIsResearching(true)
    setError(null)

    try {
      setDashboard(await garageApi.oem.researchProject(detail.project.id))
      await onRefreshProject()
    } catch (researchError) {
      setError(getErrorMessage(researchError))
      await loadDashboard()
    } finally {
      setIsResearching(false)
    }
  }

  async function handleImport(): Promise<void> {
    const imported = await garageApi.oem.importReferences({ projectId: detail.project.id, category, fileType })

    if (imported.length > 0) {
      await loadDashboard()
    }
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault()
    setIsDragging(false)
    const files = [...event.dataTransfer.files]

    if (files.length === 0) {
      return
    }

    await garageApi.oem.importDroppedReferences(detail.project.id, category, fileType, files)
    await loadDashboard()
  }

  async function handleManualSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!manualDraft.title.trim()) {
      return
    }

    const input: CreateOemKnowledgeItemInput = {
      projectId: detail.project.id,
      category: manualDraft.category,
      title: manualDraft.title,
      sourceName: manualDraft.sourceName,
      sourceUrl: manualDraft.sourceUrl,
      confidence: 0.6
    }
    await garageApi.oem.createKnowledgeItem(input)
    setManualDraft({ ...manualDraft, title: '', sourceName: '', sourceUrl: '' })
    await loadDashboard()
  }

  async function reviewSuggestion(id: string, action: 'approve' | 'reject' | 'ignore'): Promise<void> {
    if (action === 'approve') {
      await garageApi.oem.approveSuggestion(id)
    }

    if (action === 'reject') {
      await garageApi.oem.rejectSuggestion(id)
    }

    if (action === 'ignore') {
      await garageApi.oem.ignoreSuggestion(id)
    }

    await loadDashboard()
    await onRefreshProject()
  }

  return (
    <div className="oem-panel">
      <div className="twin-commandbar">
        <div>
          <p className="eyebrow">Investigador OEM</p>
          <h4>{detail.project.vin || `${detail.project.make} ${detail.project.model}`}</h4>
        </div>
        <button className="primary-icon-button" type="button" disabled={isResearching} onClick={() => void handleResearch()}>
          <RefreshCw size={16} aria-hidden="true" />
          Investigar
        </button>
      </div>

      {error ? <div className="system-alert">{error}</div> : null}

      <div className="twin-stat-strip">
        <InfoStat label="OEM general" value={`${dashboard?.stats.generalMatch ?? 0}%`} />
        <InfoStat label="Exterior" value={`${dashboard?.stats.exteriorMatch ?? 0}%`} />
        <InfoStat label="Interior" value={`${dashboard?.stats.interiorMatch ?? 0}%`} />
        <InfoStat label="Mecanica" value={`${dashboard?.stats.mechanicalMatch ?? 0}%`} />
        <InfoStat label="Referencias" value={String(dashboard?.stats.referenceCount ?? 0)} />
      </div>

      <div className="oem-grid">
        <section className="oem-card">
          <div className="section-title">
            <span>
              <FileSearch size={15} aria-hidden="true" />
              Perfil OEM
            </span>
            <small>{dashboard?.profile?.status ?? 'pending'}</small>
          </div>
          <div className="oem-profile-list">
            <Fact label="Color original" value={dashboard?.profile?.originalColor} />
            <Fact label="Motor" value={dashboard?.profile?.originalEngine} />
            <Fact label="Transmision" value={dashboard?.profile?.originalTransmission} />
            <Fact label="Confianza" value={dashboard?.profile ? `${Math.round(dashboard.profile.confidence * 100)}%` : ''} />
            <Fact label="Fuentes" value={dashboard?.profile?.sourceSummary} />
          </div>
        </section>

        <section className="oem-card">
          <div className="section-title">
            <span>VIN Decoder</span>
            <small>{dashboard?.vinDecode?.sourceName ?? 'sin fuente'}</small>
          </div>
          <div className="oem-profile-list">
            <Fact label="Marca" value={dashboard?.vinDecode?.make} />
            <Fact label="Modelo" value={dashboard?.vinDecode?.model} />
            <Fact label="Año" value={dashboard?.vinDecode?.modelYear} />
            <Fact label="Pais" value={dashboard?.vinDecode?.country} />
            <Fact label="Planta" value={dashboard?.vinDecode?.plant} />
            {dashboard?.vinDecode?.errorMessage ? <p className="oem-warning">{dashboard.vinDecode.errorMessage}</p> : null}
          </div>
        </section>
      </div>

      <section className="oem-card">
        <div className="section-title">
          <span>
            <Library size={15} aria-hidden="true" />
            Biblioteca OEM
          </span>
          <small>{dashboard?.knowledge.length ?? 0}</small>
        </div>
        <div className="oem-library-toolbar">
          <select value={category} onChange={(event) => setCategory(event.target.value as OemKnowledgeCategory)}>
            {knowledgeCategories.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <select value={fileType} onChange={(event) => setFileType(event.target.value as OemReferenceFileType)}>
            {fileTypes.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button className="primary-icon-button" type="button" onClick={() => void handleImport()}>
            <Upload size={16} aria-hidden="true" />
            Subir
          </button>
        </div>
        <div
          className={isDragging ? 'inspection-dropzone active' : 'inspection-dropzone'}
          onDragOver={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => void handleDrop(event)}
        >
          <Upload size={17} aria-hidden="true" />
          Arrastra manuales, catalogos, diagramas o fotografias OEM
        </div>

        <form className="oem-manual-form" onSubmit={handleManualSubmit}>
          <select
            value={manualDraft.category}
            onChange={(event) => setManualDraft({ ...manualDraft, category: event.target.value as OemKnowledgeCategory })}
          >
            {knowledgeCategories.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <input
            value={manualDraft.title}
            onChange={(event) => setManualDraft({ ...manualDraft, title: event.target.value })}
            placeholder="Dato o referencia"
          />
          <input
            value={manualDraft.sourceName}
            onChange={(event) => setManualDraft({ ...manualDraft, sourceName: event.target.value })}
            placeholder="Fuente"
          />
          <input
            value={manualDraft.sourceUrl}
            onChange={(event) => setManualDraft({ ...manualDraft, sourceUrl: event.target.value })}
            placeholder="URL opcional"
          />
          <button className="primary-icon-button" type="submit">
            <Plus size={15} aria-hidden="true" />
            Agregar
          </button>
        </form>

        <div className="oem-reference-list">
          {(dashboard?.knowledge ?? []).map((item) => (
            <div className="oem-reference" key={item.id}>
              <strong>{item.title}</strong>
              <span>
                {labelCategory(item.category)} / {item.sourceName || 'local'}
              </span>
              {item.localFileUrl ? (
                <a href={item.localFileUrl} target="_blank" rel="noreferrer">
                  Abrir archivo
                </a>
              ) : null}
            </div>
          ))}
          {dashboard?.knowledge.length === 0 ? <div className="empty-slot">Sin referencias OEM</div> : null}
        </div>
      </section>

      <section className="oem-card">
        <div className="section-title">
          <span>Comparacion OEM</span>
          <small>{groupedSuggestions.pending.length} pendiente(s)</small>
        </div>
        <div className="oem-suggestion-list">
          {groupedSuggestions.pending.map((suggestion) => (
            <SuggestionCard key={suggestion.id} suggestion={suggestion} onReview={reviewSuggestion} />
          ))}
          {groupedSuggestions.pending.length === 0 ? <div className="empty-slot">Sin diferencias pendientes</div> : null}
        </div>
      </section>

      {groupedSuggestions.reviewed.length > 0 ? (
        <section className="oem-card">
          <div className="section-title">
            <span>Decisiones previas</span>
            <small>{groupedSuggestions.reviewed.length}</small>
          </div>
          <div className="oem-suggestion-list compact">
            {groupedSuggestions.reviewed.map((suggestion) => (
              <SuggestionCard key={suggestion.id} suggestion={suggestion} onReview={reviewSuggestion} readonly />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function SuggestionCard({
  suggestion,
  onReview,
  readonly = false
}: {
  suggestion: OemComparisonSuggestion
  onReview: (id: string, action: 'approve' | 'reject' | 'ignore') => Promise<void>
  readonly?: boolean
}) {
  return (
    <article className={`oem-suggestion ${suggestion.status}`}>
      {suggestion.sourceMediaUrl ? (
        <figure>
          <img src={suggestion.sourceMediaUrl} alt={suggestion.title} />
        </figure>
      ) : null}
      <div>
        <div className="finding-title-row">
          <strong>{suggestion.title}</strong>
          <span>{Math.round(suggestion.confidence * 100)}%</span>
        </div>
        <p>{suggestion.description}</p>
        <dl>
          <div>
            <dt>Evidencia</dt>
            <dd>{suggestion.currentEvidence}</dd>
          </div>
          <div>
            <dt>Referencia OEM</dt>
            <dd>{suggestion.oemReference}</dd>
          </div>
        </dl>
        {readonly ? (
          <span className={`review-chip ${suggestion.status}`}>{suggestion.status}</span>
        ) : (
          <div className="finding-actions">
            <button className="icon-button approve" type="button" title="Aprobar" onClick={() => void onReview(suggestion.id, 'approve')}>
              <Check size={15} aria-hidden="true" />
            </button>
            <button className="icon-button danger" type="button" title="Rechazar" onClick={() => void onReview(suggestion.id, 'reject')}>
              <X size={15} aria-hidden="true" />
            </button>
            <button className="icon-button" type="button" title="Ignorar" onClick={() => void onReview(suggestion.id, 'ignore')}>
              Ignorar
            </button>
          </div>
        )}
      </div>
    </article>
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

function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="oem-fact">
      <span>{label}</span>
      <strong>{value?.trim() || 'Sin evidencia'}</strong>
    </div>
  )
}

function labelCategory(category: OemKnowledgeCategory): string {
  return knowledgeCategories.find((item) => item.value === category)?.label ?? category
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Ocurrio un error inesperado.'
}
