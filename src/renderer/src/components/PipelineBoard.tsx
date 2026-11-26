import { ArrowRight, CheckCircle2, CirclePause, Play } from 'lucide-react'
import type { DragEvent } from 'react'
import type { PipelineStage, PipelineStageCode, VehicleProject } from '@shared/types'
import { ProjectCard } from './ProjectCard'

interface PipelineBoardProps {
  stages: PipelineStage[]
  projects: VehicleProject[]
  completedProjects?: VehicleProject[]
  selectedProjectId: string | null
  onSelectProject: (project: VehicleProject) => void
  onMoveProject: (projectId: string, stageCode: PipelineStageCode) => Promise<void>
  onPauseProject: (projectId: string) => Promise<void>
  onResumeProject: (projectId: string) => Promise<void>
  onCompleteProject: (projectId: string) => Promise<void>
}

export function PipelineBoard({
  stages,
  projects,
  completedProjects = [],
  selectedProjectId,
  onSelectProject,
  onMoveProject,
  onPauseProject,
  onResumeProject,
  onCompleteProject
}: PipelineBoardProps) {
  function handleDrop(event: DragEvent<HTMLDivElement>, stage: PipelineStage): void {
    event.preventDefault()
    const projectId = event.dataTransfer.getData('text/plain')

    if (projectId) {
      void onMoveProject(projectId, stage.code)
    }
  }

  return (
    <section className="pipeline-section" aria-label="Pipeline del Taller">
      <div className="pipeline-heading">
        <div>
          <p className="eyebrow">Linea de Progresion</p>
          <h3>Pipeline del Taller</h3>
        </div>
        <div className="pipeline-summary">
          <span>{projects.filter((project) => project.status === 'active').length} activos</span>
          <span>{projects.filter((project) => project.status === 'paused').length} pausados</span>
          <span>{stages.filter((stage) => stage.projectCount > 0).length}/{stages.length} ocupados</span>
        </div>
      </div>

      <div className="pipeline-board" aria-label="Kanban de restauracion">
        {stages.map((stage, index) => {
          const stageProjects = [
            ...projects.filter((project) => project.stageCode === stage.code),
            ...(stage.code === 'completed'
              ? completedProjects.filter((project) => project.stageCode === stage.code)
              : [])
          ]
          const activeProjects = stageProjects.filter((project) => project.status === 'active')
          const pausedProjects = stageProjects.filter((project) => project.status === 'paused')
          const completedStageProjects = stageProjects.filter((project) => project.status === 'completed')
          const nextStage = stages[index + 1]
          const isFull = stage.projectCount >= stage.capacity
          const stageStatus = getStageStatus(activeProjects.length, pausedProjects.length, completedStageProjects.length)

          return (
            <div
              className={isFull ? 'pipeline-column full' : 'pipeline-column'}
              key={stage.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, stage)}
            >
              <div className="column-header">
                <div>
                  <span className={isFull ? 'capacity-pill full' : 'capacity-pill'}>
                    {stage.projectCount}/{stage.capacity}
                  </span>
                  <h3>{stage.name}</h3>
                  <small className={`stage-status ${stageStatus.kind}`}>{stageStatus.label}</small>
                </div>
              </div>

              <div className="column-body">
                {activeProjects.map((project) => (
                  <PipelineProjectCard
                    key={project.id}
                    nextStage={nextStage}
                    project={project}
                    selectedProjectId={selectedProjectId}
                    onCompleteProject={onCompleteProject}
                    onMoveProject={onMoveProject}
                    onPauseProject={onPauseProject}
                    onResumeProject={onResumeProject}
                    onSelectProject={onSelectProject}
                  />
                ))}

                {pausedProjects.length > 0 ? (
                  <div className="paused-stack">
                    <span>Vehiculos pausados</span>
                    {pausedProjects.map((project) => (
                      <PipelineProjectCard
                        key={project.id}
                        nextStage={nextStage}
                        project={project}
                        selectedProjectId={selectedProjectId}
                        onCompleteProject={onCompleteProject}
                        onMoveProject={onMoveProject}
                        onPauseProject={onPauseProject}
                        onResumeProject={onResumeProject}
                        onSelectProject={onSelectProject}
                      />
                    ))}
                  </div>
                ) : null}

                {completedStageProjects.length > 0 ? (
                  <div className="completed-stack">
                    <span>Vehiculos completados</span>
                    {completedStageProjects.map((project) => (
                      <PipelineProjectCard
                        key={project.id}
                        project={project}
                        selectedProjectId={selectedProjectId}
                        onCompleteProject={onCompleteProject}
                        onMoveProject={onMoveProject}
                        onPauseProject={onPauseProject}
                        onResumeProject={onResumeProject}
                        onSelectProject={onSelectProject}
                      />
                    ))}
                  </div>
                ) : null}

                {stageProjects.length === 0 ? <div className="empty-slot">Vacio / libre</div> : null}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function PipelineProjectCard({
  project,
  selectedProjectId,
  nextStage,
  onSelectProject,
  onMoveProject,
  onPauseProject,
  onResumeProject,
  onCompleteProject
}: {
  project: VehicleProject
  selectedProjectId: string | null
  nextStage?: PipelineStage
  onSelectProject: (project: VehicleProject) => void
  onMoveProject: (projectId: string, stageCode: PipelineStageCode) => Promise<void>
  onPauseProject: (projectId: string) => Promise<void>
  onResumeProject: (projectId: string) => Promise<void>
  onCompleteProject: (projectId: string) => Promise<void>
}) {
  return (
    <ProjectCard
      project={project}
      isSelected={selectedProjectId === project.id}
      onSelect={() => onSelectProject(project)}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', project.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
    >
      <div className="pipeline-card-actions">
        {project.status === 'active' ? (
          <button
            className="icon-button"
            type="button"
            title="Pausar vehiculo"
            onClick={(event) => {
              event.stopPropagation()
              void onPauseProject(project.id)
            }}
          >
            <CirclePause size={15} aria-hidden="true" />
          </button>
        ) : (
          <button
            className="icon-button"
            type="button"
            title="Reanudar vehiculo"
            onClick={(event) => {
              event.stopPropagation()
              void onResumeProject(project.id)
            }}
          >
            <Play size={15} aria-hidden="true" />
          </button>
        )}

        {nextStage ? (
          <button
            className="icon-button"
            type="button"
            title={`Mover a ${nextStage.name}`}
            onClick={(event) => {
              event.stopPropagation()
              void onMoveProject(project.id, nextStage.code)
            }}
          >
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        ) : null}

        <button
          className="icon-button"
          type="button"
          title="Marcar como completado"
          onClick={(event) => {
            event.stopPropagation()
            void onCompleteProject(project.id)
          }}
        >
          <CheckCircle2 size={15} aria-hidden="true" />
        </button>
      </div>
    </ProjectCard>
  )
}

function getStageStatus(
  activeCount: number,
  pausedCount: number,
  completedCount: number
): { kind: string; label: string } {
  if (activeCount > 0 && pausedCount > 0) {
    return { kind: 'occupied', label: 'Ocupado + pausado' }
  }

  if (activeCount > 0) {
    return { kind: 'occupied', label: 'Ocupado' }
  }

  if (pausedCount > 0) {
    return { kind: 'paused', label: 'Pausado' }
  }

  if (completedCount > 0) {
    return { kind: 'completed', label: 'Completado' }
  }

  return { kind: 'free', label: 'Libre' }
}
