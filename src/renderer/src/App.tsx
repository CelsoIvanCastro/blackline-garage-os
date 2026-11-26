import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ChecklistItem,
  CostEntry,
  CreateVehicleProjectInput,
  MediaCategory,
  PipelineSnapshot,
  ProjectDetail,
  UpdateVehicleProjectInput,
  VehicleProject
} from '@shared/types'
import { garageApi } from './api'
import { CommandCenterPanel } from './components/CommandCenterPanel'
import { DigitalTwinViewport } from './components/DigitalTwinViewport'
import { InventoryExecutivePanel } from './components/InventoryExecutivePanel'
import { OperationalIntelligencePanel } from './components/OperationalIntelligencePanel'
import { PipelineBoard } from './components/PipelineBoard'
import { ProjectEditor } from './components/ProjectEditor'
import { ProjectForm } from './components/ProjectForm'
import { Sidebar, type AppModule } from './components/Sidebar'
import { SummaryBar } from './components/SummaryBar'

function App() {
  const [snapshot, setSnapshot] = useState<PipelineSnapshot>({
    stages: [],
    projects: [],
    stats: {
      activeVehicles: 0,
      completedVehicles: 0,
      pausedVehicles: 0,
      archivedVehicles: 0,
      occupiedProcesses: 0,
      freeProcesses: 0,
      totalInvestedCents: 0,
      activeBudgetCents: 0
    }
  })
  const [allProjects, setAllProjects] = useState<VehicleProject[]>([])
  const [query, setQuery] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('project'))
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activeModule, setActiveModule] = useState<AppModule>('projects')

  const loadProjectDetail = useCallback(async (id: string | null) => {
    if (!id) {
      setDetail(null)
      return
    }

    try {
      setDetail(await garageApi.projects.getDetail(id))
    } catch {
      setDetail(null)
      setSelectedProjectId(null)
    }
  }, [])

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [nextSnapshot, projects] = await Promise.all([
        garageApi.pipeline.getSnapshot(),
        garageApi.projects.list(query)
      ])
      setSnapshot(nextSnapshot)
      setAllProjects(projects)
      await loadProjectDetail(selectedProjectId)
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [loadProjectDetail, query, selectedProjectId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const visiblePipelineProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase()

    if (!normalized) {
      return snapshot.projects
    }

    return snapshot.projects.filter((project) => projectMatches(project, normalized))
  }, [query, snapshot.projects])

  const visibleCompletedProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const completedProjects = allProjects.filter(
      (project) => project.status === 'completed' && project.stageCode === 'completed'
    )

    if (!normalized) {
      return completedProjects
    }

    return completedProjects.filter((project) => projectMatches(project, normalized))
  }, [allProjects, query])

  async function selectProject(project: VehicleProject): Promise<void> {
    setActiveModule('projects')
    setSelectedProjectId(project.id)
    setDetail(await garageApi.projects.getDetail(project.id))
  }

  async function openProjectFromCommand(projectId: string): Promise<void> {
    setActiveModule('projects')
    setSelectedProjectId(projectId)
    setDetail(await garageApi.projects.getDetail(projectId))
  }

  async function afterMutation(nextSelectedId = selectedProjectId): Promise<void> {
    await loadData()
    await loadProjectDetail(nextSelectedId)
  }

  async function handleCreate(input: CreateVehicleProjectInput): Promise<void> {
    await runAction(async () => {
      const project = await garageApi.projects.create(input)
      setSelectedProjectId(project.id)
      await afterMutation(project.id)
    })
  }

  async function handleMove(projectId: string, stageCode: VehicleProject['stageCode']): Promise<void> {
    await runAction(async () => {
      const project = await garageApi.pipeline.moveProject(projectId, stageCode)
      setSelectedProjectId(project.id)
      await afterMutation(project.id)
    })
  }

  async function handleUpdate(project: VehicleProject): Promise<void> {
    await runAction(async () => {
      const input: UpdateVehicleProjectInput = {
        id: project.id,
        projectName: project.projectName,
        make: project.make,
        model: project.model,
        year: project.year,
        submodel: project.submodel,
        vin: project.vin,
        currentColor: project.currentColor,
        oemColor: project.oemColor,
        notes: project.notes,
        budgetCents: project.budgetCents
      }
      await garageApi.projects.update(input)
      await afterMutation(project.id)
    })
  }

  async function handlePause(projectId: string): Promise<void> {
    await runAction(async () => {
      await garageApi.projects.pause(projectId)
      await afterMutation(projectId)
    })
  }

  async function handleResume(projectId: string): Promise<void> {
    await runAction(async () => {
      await garageApi.projects.resume(projectId)
      await afterMutation(projectId)
    })
  }

  async function handleReactivate(projectId: string): Promise<void> {
    await runAction(async () => {
      await garageApi.projects.reactivate(projectId)
      await afterMutation(projectId)
    })
  }

  async function handleArchive(projectId: string): Promise<void> {
    await runAction(async () => {
      await garageApi.projects.archive(projectId)
      setSelectedProjectId(null)
      await afterMutation(null)
    })
  }

  async function handleComplete(projectId: string): Promise<void> {
    await runAction(async () => {
      await garageApi.projects.complete(projectId)
      setSelectedProjectId(projectId)
      await afterMutation(projectId)
    })
  }

  async function handleDelete(projectId: string): Promise<void> {
    await runAction(async () => {
      await garageApi.projects.delete(projectId)
      setSelectedProjectId(null)
      await afterMutation(null)
    })
  }

  async function handleClearDatabase(): Promise<void> {
    await runAction(async () => {
      await garageApi.maintenance.clearDatabase()
      setSelectedProjectId(null)
      setDetail(null)
      await loadData()
    })
  }

  async function handleCreateChecklist(input: Omit<ChecklistItem, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>) {
    await runAction(async () => {
      await garageApi.checklist.create(input)
      await afterMutation(input.projectId)
    })
  }

  async function handleUpdateChecklist(item: ChecklistItem): Promise<void> {
    await runAction(async () => {
      await garageApi.checklist.update(item)
      await afterMutation(item.projectId)
    })
  }

  async function handleDeleteChecklist(item: ChecklistItem): Promise<void> {
    await runAction(async () => {
      await garageApi.checklist.delete(item.id)
      await afterMutation(item.projectId)
    })
  }

  async function handleCreateCost(input: Omit<CostEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> {
    await runAction(async () => {
      await garageApi.costs.create(input)
      await afterMutation(input.projectId)
    })
  }

  async function handleDeleteCost(item: CostEntry): Promise<void> {
    await runAction(async () => {
      await garageApi.costs.delete(item.id)
      await afterMutation(item.projectId)
    })
  }

  async function handleImportPhotos(projectId: string, category: MediaCategory): Promise<void> {
    await runAction(async () => {
      await garageApi.media.importPhotos({ projectId, category })
      await afterMutation(projectId)
    })
  }

  async function handleImportPhotoZip(projectId: string, category: MediaCategory): Promise<string> {
    let message = ''
    await runAction(async () => {
      const result = await garageApi.media.importPhotoZip({ projectId, category })
      message = result.message || `Importadas ${result.importedCount} foto(s).`
      await afterMutation(projectId)
    })
    return message
  }

  async function handleDeleteMedia(projectId: string, mediaId: string): Promise<void> {
    await runAction(async () => {
      await garageApi.media.delete(mediaId)
      await afterMutation(projectId)
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

  return (
    <main className="app-shell">
      <Sidebar
        activeModule={activeModule}
        query={query}
        projects={allProjects}
        selectedProjectId={selectedProjectId}
        onModuleChange={setActiveModule}
        onQueryChange={setQuery}
        onSelectProject={(project) => void selectProject(project)}
      />

      <section className="workspace" aria-label="Operacion del taller">
        <SummaryBar stats={snapshot.stats} isLoading={isLoading} />

        {error ? <div className="system-alert">{error}</div> : null}

        {activeModule === 'command' ? (
          <CommandCenterPanel onOpenProject={(projectId) => void openProjectFromCommand(projectId)} />
        ) : activeModule === 'completed' ? (
          <ProjectCollection
            title="Vehiculos completados"
            subtitle="Proyectos cerrados en Completado"
            projects={allProjects.filter((project) => project.status === 'completed')}
            onSelect={(project) => void selectProject(project)}
          />
        ) : activeModule === 'archive' ? (
          <ProjectCollection
            title="Archivo"
            subtitle="Proyectos archivados"
            projects={allProjects.filter((project) => project.status === 'archived')}
            onSelect={(project) => void selectProject(project)}
          />
        ) : activeModule === 'settings' ? (
          <SettingsPanel onClearDatabase={() => void handleClearDatabase()} />
        ) : (
          <div className="workspace-grid">
            <section className="operations-panel" aria-label="Pipeline de restauracion">
              <PipelineBoard
                projects={visiblePipelineProjects}
                completedProjects={visibleCompletedProjects}
                stages={snapshot.stages}
                selectedProjectId={selectedProjectId}
                onSelectProject={(project) => void selectProject(project)}
                onMoveProject={handleMove}
                onPauseProject={handlePause}
                onResumeProject={handleResume}
                onCompleteProject={handleComplete}
              />
              <ProjectForm onCreate={handleCreate} stages={snapshot.stages} />
              <InventoryExecutivePanel />
              <OperationalIntelligencePanel compact />
            </section>

            <aside className="detail-panel" aria-label="Detalle del vehiculo">
              <DigitalTwinViewport project={detail?.project ?? null} />
              <ProjectEditor
                detail={detail}
                stages={snapshot.stages}
                onUpdate={handleUpdate}
                onPause={handlePause}
                onResume={handleResume}
                onArchive={handleArchive}
                onReactivate={handleReactivate}
                onComplete={handleComplete}
                onDelete={handleDelete}
                onMove={handleMove}
                onCreateChecklist={handleCreateChecklist}
                onUpdateChecklist={handleUpdateChecklist}
                onDeleteChecklist={handleDeleteChecklist}
                onCreateCost={handleCreateCost}
                onDeleteCost={handleDeleteCost}
                onImportPhotos={handleImportPhotos}
                onImportPhotoZip={handleImportPhotoZip}
                onDeleteMedia={handleDeleteMedia}
                onRefresh={() => afterMutation(selectedProjectId)}
              />
            </aside>
          </div>
        )}
      </section>
    </main>
  )
}

function ProjectCollection({
  title,
  subtitle,
  projects,
  onSelect
}: {
  title: string
  subtitle: string
  projects: VehicleProject[]
  onSelect: (project: VehicleProject) => void
}) {
  return (
    <section className="collection-panel">
      <div className="collection-heading">
        <div>
          <p className="eyebrow">{subtitle}</p>
          <h3>{title}</h3>
        </div>
        <strong>{projects.length}</strong>
      </div>
      <div className="collection-grid">
        {projects.map((project) => (
          <button className="collection-card" key={project.id} type="button" onClick={() => onSelect(project)}>
            <strong>{project.projectName || `${project.make} ${project.model}`}</strong>
            <span>
              {project.year ? `${project.year} ` : ''}
              {project.make} {project.model}
            </span>
            <small>{project.vin || project.stageName}</small>
          </button>
        ))}
        {projects.length === 0 ? <div className="empty-slot">Sin proyectos en esta seccion</div> : null}
      </div>
    </section>
  )
}

function SettingsPanel({ onClearDatabase }: { onClearDatabase: () => void }) {
  return (
    <section className="settings-panel">
      <div className="collection-heading">
        <div>
          <p className="eyebrow">Configuracion</p>
          <h3>Mantenimiento local</h3>
        </div>
      </div>
      <div className="settings-card danger-zone">
        <strong>Limpiar base de datos</strong>
        <p>Borra proyectos, fotos, costos, checklist, historial, inventario, reportes, jobs 3D y archivos locales.</p>
        <button
          className="primary-icon-button danger-action"
          type="button"
          onClick={() => {
            if (window.confirm('Esto borrara todos los datos locales de BLACKLINE GARAGE OS. Continuar?')) {
              onClearDatabase()
            }
          }}
        >
          Limpiar base de datos
        </button>
      </div>
    </section>
  )
}

function projectMatches(project: VehicleProject, query: string): boolean {
  return [project.projectName, project.make, project.model, project.year?.toString() ?? '', project.submodel, project.vin]
    .join(' ')
    .toLowerCase()
    .includes(query)
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Ocurrio un error inesperado.'
}

export default App
