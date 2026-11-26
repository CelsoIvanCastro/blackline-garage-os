import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Archive,
  BadgeCheck,
  BarChart3,
  Bot,
  Box,
  Boxes,
  Camera,
  CirclePause,
  ClipboardCheck,
  DollarSign,
  FileSearch,
  History,
  Image,
  Play,
  Save,
  Gauge,
  Trash2
} from 'lucide-react'
import { CHECKLIST_SECTIONS } from '@shared/inspectionCatalog'
import type {
  ChecklistItem,
  ChecklistSection,
  ComponentStatus,
  CopilotDigitalTwinFocus,
  CostEntry,
  MediaCategory,
  PipelineStage,
  ProjectDetail,
  VehicleProject
} from '@shared/types'
import { CopilotPanel } from './CopilotPanel'
import { DigitalTwinPanel } from './DigitalTwinPanel'
import { IntelligentInspectionPanel } from './IntelligentInspectionPanel'
import { InventoryPanel } from './InventoryPanel'
import { OemResearchPanel } from './OemResearchPanel'
import { OperationalIntelligencePanel } from './OperationalIntelligencePanel'
import { PlanningPanel } from './PlanningPanel'

interface ProjectEditorProps {
  detail: ProjectDetail | null
  stages: PipelineStage[]
  onUpdate: (project: VehicleProject) => Promise<void>
  onPause: (id: string) => Promise<void>
  onResume: (id: string) => Promise<void>
  onArchive: (id: string) => Promise<void>
  onReactivate: (id: string) => Promise<void>
  onComplete: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onMove: (projectId: string, stageCode: VehicleProject['stageCode']) => Promise<void>
  onCreateChecklist: (
    input: Omit<ChecklistItem, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>
  ) => Promise<void>
  onUpdateChecklist: (item: ChecklistItem) => Promise<void>
  onDeleteChecklist: (item: ChecklistItem) => Promise<void>
  onCreateCost: (input: Omit<CostEntry, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
  onDeleteCost: (item: CostEntry) => Promise<void>
  onImportPhotos: (projectId: string, category: MediaCategory) => Promise<void>
  onImportPhotoZip: (projectId: string, category: MediaCategory) => Promise<string>
  onDeleteMedia: (projectId: string, mediaId: string) => Promise<void>
  onRefresh: () => Promise<void>
}

type EditorTab =
  | 'vehicle'
  | 'inspection'
  | 'oem'
  | 'digitalTwin'
  | 'planning'
  | 'inventory'
  | 'predictive'
  | 'copilot'
  | 'checklist'
  | 'costs'
  | 'gallery'
  | 'history'

const checklistStatuses: Array<{ value: ComponentStatus; label: string }> = [
  { value: 'pending', label: 'Pendiente' },
  { value: 'purchased_or_repaired', label: 'Comprado/Reparado' },
  { value: 'assembled', label: 'Ensamblado' },
  { value: 'completed', label: 'Completado' }
]

const mediaCategories: Array<{ value: MediaCategory; label: string }> = [
  { value: 'reception', label: 'Recepcion' },
  { value: 'exterior', label: 'Exterior' },
  { value: 'interior', label: 'Interior' },
  { value: 'engine', label: 'Motor' },
  { value: 'trunk', label: 'Cajuela' },
  { value: 'chassis', label: 'Chasis' },
  { value: 'damage', label: 'Daños' },
  { value: 'process', label: 'Proceso' },
  { value: 'final', label: 'Final' }
]

export function ProjectEditor({
  detail,
  stages,
  onUpdate,
  onPause,
  onResume,
  onArchive,
  onReactivate,
  onComplete,
  onDelete,
  onMove,
  onCreateChecklist,
  onUpdateChecklist,
  onDeleteChecklist,
  onCreateCost,
  onDeleteCost,
  onImportPhotos,
  onImportPhotoZip,
  onDeleteMedia,
  onRefresh
}: ProjectEditorProps) {
  const [tab, setTab] = useState<EditorTab>('vehicle')
  const [draft, setDraft] = useState<VehicleProject | null>(detail?.project ?? null)
  const [newTask, setNewTask] = useState({ section: 'interior' as ChecklistSection, title: '', notes: '' })
  const [newCost, setNewCost] = useState({
    concept: '',
    amount: '',
    occurredOn: new Date().toISOString().slice(0, 10)
  })
  const [galleryCategory, setGalleryCategory] = useState<MediaCategory>('reception')
  const [galleryMessage, setGalleryMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [digitalTwinFocus, setDigitalTwinFocus] = useState<CopilotDigitalTwinFocus | null>(null)

  useEffect(() => {
    setDraft(detail?.project ?? null)
    setDigitalTwinFocus(null)
  }, [detail])

  const checklistBySection = useMemo(() => {
    const items = detail?.checklist ?? []
    return CHECKLIST_SECTIONS.map((section) => ({
      ...section,
      items: items.filter((item) => item.section === section.value)
    }))
  }, [detail])

  const totalCost = useMemo(
    () => (detail?.costs ?? []).reduce((sum, item) => sum + item.amountCents, 0),
    [detail?.costs]
  )

  if (!draft || !detail) {
    return (
      <section className="editor-empty">
        <p className="eyebrow">Detalle</p>
        <h3>Selecciona un vehiculo</h3>
        <p>El panel mostrara ficha, checklist, costos, galeria, tiempos e historial.</p>
      </section>
    )
  }

  const activeProjectId = detail.project.id

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!draft) {
      return
    }

    setIsSaving(true)

    try {
      await onUpdate(draft)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!newTask.title.trim()) {
      return
    }

    await onCreateChecklist({
      projectId: activeProjectId,
      section: newTask.section,
      title: newTask.title,
      status: 'pending',
      notes: newTask.notes
    })
    setNewTask({ section: newTask.section, title: '', notes: '' })
  }

  async function handleCreateCost(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!newCost.concept.trim()) {
      return
    }

    await onCreateCost({
      projectId: activeProjectId,
      concept: newCost.concept,
      amountCents: Math.round(Number(newCost.amount || 0) * 100),
      occurredOn: newCost.occurredOn
    })
    setNewCost({ concept: '', amount: '', occurredOn: new Date().toISOString().slice(0, 10) })
  }

  return (
    <section className="project-editor">
      <form onSubmit={handleSubmit}>
        <div className="editor-heading">
          <div>
            <p className="eyebrow">Ficha activa</p>
            <h3>
              {draft.projectName || `${draft.make} ${draft.model}`}
            </h3>
          </div>
          <div className="editor-actions">
            <button className="icon-button" type="submit" title="Guardar" disabled={isSaving}>
              <Save size={16} aria-hidden="true" />
            </button>
            {draft.status === 'archived' ? (
              <button className="icon-button" type="button" title="Reactivar" onClick={() => void onReactivate(draft.id)}>
                <Play size={16} aria-hidden="true" />
              </button>
            ) : draft.status === 'paused' ? (
              <button className="icon-button" type="button" title="Reanudar" onClick={() => void onResume(draft.id)}>
                <Play size={16} aria-hidden="true" />
              </button>
            ) : draft.status === 'active' ? (
              <button className="icon-button" type="button" title="Pausar" onClick={() => void onPause(draft.id)}>
                <CirclePause size={16} aria-hidden="true" />
              </button>
            ) : null}
            {draft.status !== 'completed' && draft.status !== 'archived' ? (
              <button className="icon-button" type="button" title="Completar" onClick={() => void onComplete(draft.id)}>
                <BadgeCheck size={16} aria-hidden="true" />
              </button>
            ) : null}
            {draft.status !== 'archived' && draft.status !== 'completed' ? (
              <button className="icon-button" type="button" title="Archivar" onClick={() => void onArchive(draft.id)}>
                <Archive size={16} aria-hidden="true" />
              </button>
            ) : null}
            {draft.status === 'completed' ? (
              <button className="icon-button" type="button" title="Archivar" onClick={() => void onArchive(draft.id)}>
                <Archive size={16} aria-hidden="true" />
              </button>
            ) : null}
            <button
              className="icon-button danger"
              type="button"
              title="Eliminar"
              onClick={() => {
                if (window.confirm('Eliminar este proyecto y sus archivos locales?')) {
                  void onDelete(draft.id)
                }
              }}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="editor-tabs" role="tablist" aria-label="Modulos del proyecto">
          <TabButton icon={<CarIcon />} label="Ficha" active={tab === 'vehicle'} onClick={() => setTab('vehicle')} />
          <TabButton
            icon={<Camera size={15} />}
            label="Inspeccion IA"
            active={tab === 'inspection'}
            onClick={() => setTab('inspection')}
          />
          <TabButton
            icon={<FileSearch size={15} />}
            label="Investigador OEM"
            active={tab === 'oem'}
            onClick={() => setTab('oem')}
          />
          <TabButton
            icon={<Box size={15} />}
            label="Gemelo Digital"
            active={tab === 'digitalTwin'}
            onClick={() => setTab('digitalTwin')}
          />
          <TabButton
            icon={<BarChart3 size={15} />}
            label="Planeacion IA"
            active={tab === 'planning'}
            onClick={() => setTab('planning')}
          />
          <TabButton
            icon={<Boxes size={15} />}
            label="Inventario"
            active={tab === 'inventory'}
            onClick={() => setTab('inventory')}
          />
          <TabButton
            icon={<Gauge size={15} />}
            label="Predictivo"
            active={tab === 'predictive'}
            onClick={() => setTab('predictive')}
          />
          <TabButton
            icon={<Bot size={15} />}
            label="Blackline AI"
            active={tab === 'copilot'}
            onClick={() => setTab('copilot')}
          />
          <TabButton
            icon={<ClipboardCheck size={15} />}
            label="Checklist"
            active={tab === 'checklist'}
            onClick={() => setTab('checklist')}
          />
          <TabButton
            icon={<DollarSign size={15} />}
            label="Costos"
            active={tab === 'costs'}
            onClick={() => setTab('costs')}
          />
          <TabButton icon={<Image size={15} />} label="Fotos / Inspeccion" active={tab === 'gallery'} onClick={() => setTab('gallery')} />
          <TabButton
            icon={<History size={15} />}
            label="Historial"
            active={tab === 'history'}
            onClick={() => setTab('history')}
          />
        </div>

        {tab === 'vehicle' ? (
          <div className="editor-section">
            <div className="stage-line">
              {stages.map((stage) => (
                <button
                  key={stage.id}
                  className={draft.stageCode === stage.code ? 'stage-dot active' : 'stage-dot'}
                  type="button"
                  title={stage.name}
                  disabled={draft.status === 'archived' || draft.status === 'completed'}
                  onClick={() => void onMove(draft.id, stage.code)}
                >
                  {stage.position}
                </button>
              ))}
            </div>

            <div className="editor-grid">
              <label>
                Nombre del proyecto
                <input
                  value={draft.projectName}
                  onChange={(event) => setDraft({ ...draft, projectName: event.target.value })}
                />
              </label>
              <label>
                Marca
                <input value={draft.make} onChange={(event) => setDraft({ ...draft, make: event.target.value })} />
              </label>
              <label>
                Modelo
                <input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />
              </label>
              <label>
                Año
                <input
                  value={draft.year ?? ''}
                  onChange={(event) =>
                    setDraft({ ...draft, year: event.target.value ? Number(event.target.value) : null })
                  }
                />
              </label>
              <label>
                Submodelo
                <input
                  value={draft.submodel}
                  onChange={(event) => setDraft({ ...draft, submodel: event.target.value })}
                />
              </label>
              <label>
                VIN
                <input value={draft.vin} onChange={(event) => setDraft({ ...draft, vin: event.target.value })} />
              </label>
              <label>
                Color actual
                <input
                  value={draft.currentColor}
                  onChange={(event) => setDraft({ ...draft, currentColor: event.target.value })}
                />
              </label>
              <label>
                Color OEM
                <input
                  value={draft.oemColor}
                  onChange={(event) => setDraft({ ...draft, oemColor: event.target.value })}
                />
              </label>
              <label>
                Presupuesto
                <input
                  value={Math.round(draft.budgetCents / 100)}
                  onChange={(event) => setDraft({ ...draft, budgetCents: Number(event.target.value || 0) * 100 })}
                />
              </label>
            </div>

            <label className="notes-field">
              Notas generales
              <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
            </label>

            <div className="time-grid">
              <InfoTile label="Entrada" value={formatDate(draft.entryDate)} />
              <InfoTile label="Salida" value={draft.exitDate ? formatDate(draft.exitDate) : 'Abierto'} />
              <InfoTile label="Proceso actual" value={draft.stageName} />
              <InfoTile label="Tiempo en proceso" value={formatDuration(draft.currentStageSeconds)} />
              <InfoTile label="Tiempo total" value={formatDuration(draft.totalElapsedSeconds)} />
              <InfoTile label="Estado" value={translateStatus(draft.status)} />
            </div>
          </div>
        ) : null}
      </form>

      {tab === 'inspection' ? (
        <IntelligentInspectionPanel projectId={draft.id} onRefreshProject={onRefresh} />
      ) : null}

      {tab === 'oem' ? <OemResearchPanel detail={detail} onRefreshProject={onRefresh} /> : null}

      {tab === 'digitalTwin' ? (
        <DigitalTwinPanel detail={detail} onRefreshProject={onRefresh} focus={digitalTwinFocus} />
      ) : null}

      {tab === 'planning' ? <PlanningPanel detail={detail} onRefreshProject={onRefresh} /> : null}

      {tab === 'inventory' ? <InventoryPanel detail={detail} onRefreshProject={onRefresh} /> : null}

      {tab === 'predictive' ? <OperationalIntelligencePanel projectId={draft.id} /> : null}

      {tab === 'copilot' ? (
        <CopilotPanel
          projectId={draft.id}
          onFocusDigitalTwin={(focus) => {
            setDigitalTwinFocus(focus)
            setTab('digitalTwin')
          }}
        />
      ) : null}

      {tab === 'checklist' ? (
        <div className="editor-section">
          <form className="compact-form" onSubmit={handleCreateTask}>
            <select
              value={newTask.section}
              onChange={(event) => setNewTask({ ...newTask, section: event.target.value as ChecklistSection })}
            >
              {CHECKLIST_SECTIONS.map((section) => (
                <option key={section.value} value={section.value}>
                  {section.label}
                </option>
              ))}
            </select>
            <input
              value={newTask.title}
              onChange={(event) => setNewTask({ ...newTask, title: event.target.value })}
              placeholder="Nueva tarea"
            />
            <input
              value={newTask.notes}
              onChange={(event) => setNewTask({ ...newTask, notes: event.target.value })}
              placeholder="Notas"
            />
            <button className="primary-icon-button" type="submit">
              Crear
            </button>
          </form>

          {checklistBySection.map((section) => (
            <ChecklistSectionView
              key={section.value}
              title={section.label}
              items={section.items}
              onUpdate={onUpdateChecklist}
              onDelete={onDeleteChecklist}
            />
          ))}
        </div>
      ) : null}

      {tab === 'costs' ? (
        <div className="editor-section">
          <div className="cost-total">
            <span>Total invertido</span>
            <strong>{formatMoney(totalCost)}</strong>
          </div>
          <form className="compact-form" onSubmit={handleCreateCost}>
            <input
              value={newCost.concept}
              onChange={(event) => setNewCost({ ...newCost, concept: event.target.value })}
              placeholder="Concepto"
            />
            <input
              value={newCost.amount}
              onChange={(event) => setNewCost({ ...newCost, amount: event.target.value })}
              placeholder="Monto"
              inputMode="decimal"
            />
            <input
              type="date"
              value={newCost.occurredOn}
              onChange={(event) => setNewCost({ ...newCost, occurredOn: event.target.value })}
            />
            <button className="primary-icon-button" type="submit">
              Registrar
            </button>
          </form>

          <div className="row-list">
            {detail.costs.map((cost) => (
              <div className="list-row" key={cost.id}>
                <div>
                  <strong>{cost.concept}</strong>
                  <span>{formatDate(cost.occurredOn)}</span>
                </div>
                <strong>{formatMoney(cost.amountCents)}</strong>
                <button className="icon-button danger" type="button" title="Eliminar" onClick={() => void onDeleteCost(cost)}>
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'gallery' ? (
        <div className="editor-section">
          <div className="gallery-toolbar">
            <select value={galleryCategory} onChange={(event) => setGalleryCategory(event.target.value as MediaCategory)}>
              {mediaCategories.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
            <button className="primary-icon-button" type="button" onClick={() => void onImportPhotos(draft.id, galleryCategory)}>
              <Camera size={16} aria-hidden="true" />
              Subir fotos
            </button>
            <button
              className="primary-icon-button"
              type="button"
              onClick={async () => {
                const message = await onImportPhotoZip(draft.id, galleryCategory)
                setGalleryMessage(message)
              }}
            >
              <Camera size={16} aria-hidden="true" />
              Subir ZIP
            </button>
          </div>
          {galleryMessage ? <div className="system-alert">{galleryMessage}</div> : null}

          <div className="gallery-grid">
            {detail.media.map((item) => (
              <figure className="media-tile" key={item.id}>
                {item.mediaUrl ? <img src={item.mediaUrl} alt={item.filename} /> : <div className="media-placeholder" />}
                <figcaption>
                  <span>{labelMediaCategory(item.category)}</span>
                  <button
                    className="icon-button danger"
                    type="button"
                    title="Eliminar fotografia"
                    onClick={() => void onDeleteMedia(draft.id, item.id)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </figcaption>
              </figure>
            ))}
            {detail.media.length === 0 ? <div className="empty-slot">Sin fotografias</div> : null}
          </div>
        </div>
      ) : null}

      {tab === 'history' ? (
        <div className="editor-section">
          <div className="timeline">
            {detail.history.map((event) => (
              <div className="timeline-item" key={event.id}>
                <span />
                <div>
                  <strong>{event.title}</strong>
                  <p>{event.body || event.eventType}</p>
                  <small>{formatDateTime(event.occurredAt)}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ChecklistSectionView({
  title,
  items,
  onUpdate,
  onDelete
}: {
  title: string
  items: ChecklistItem[]
  onUpdate: (item: ChecklistItem) => Promise<void>
  onDelete: (item: ChecklistItem) => Promise<void>
}) {
  return (
    <section className="checklist-group">
      <div className="section-title">
        <span>{title}</span>
        <small>{items.length}</small>
      </div>
      <div className="row-list">
        {items.map((item) => (
          <div className="checklist-row" key={item.id}>
            <input value={item.title} onChange={(event) => void onUpdate({ ...item, title: event.target.value })} />
            <input value={item.notes} onChange={(event) => void onUpdate({ ...item, notes: event.target.value })} />
            <select
              value={item.status}
              onChange={(event) => void onUpdate({ ...item, status: event.target.value as ComponentStatus })}
            >
              {checklistStatuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
            <button className="icon-button danger" type="button" title="Eliminar" onClick={() => void onDelete(item)}>
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

function TabButton({
  icon,
  label,
  active,
  onClick
}: {
  icon: ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button className={active ? 'tab-button active' : 'tab-button'} type="button" title={label} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function CarIcon() {
  return <BadgeCheck size={15} aria-hidden="true" />
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
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) {
    return `${days}d ${hours}h`
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  return `${minutes}m`
}

function translateStatus(status: VehicleProject['status']): string {
  const labels = {
    active: 'Activo',
    paused: 'Pausado',
    archived: 'Archivado',
    completed: 'Completado'
  }

  return labels[status]
}

function labelMediaCategory(category: MediaCategory): string {
  return mediaCategories.find((item) => item.value === category)?.label ?? category
}
