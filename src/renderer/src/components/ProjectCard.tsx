import type { DragEvent, PropsWithChildren } from 'react'
import { BadgeCheck, CarFront, CirclePause } from 'lucide-react'
import type { VehicleProject } from '@shared/types'

interface ProjectCardProps {
  project: VehicleProject
  isSelected: boolean
  onSelect: () => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
}

export function ProjectCard({
  project,
  isSelected,
  onSelect,
  onDragStart,
  children
}: PropsWithChildren<ProjectCardProps>) {
  return (
    <article
      className={isSelected ? 'project-card selected' : 'project-card'}
      role="button"
      tabIndex={0}
      draggable={project.status !== 'completed' && project.status !== 'archived'}
      onDragStart={onDragStart}
      onClick={onSelect}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <div className="project-card-main">
        <CarFront size={18} aria-hidden="true" />
        <div>
          <strong>
            {project.projectName || `${project.year ? `${project.year} ` : ''}${project.make} ${project.model}`}
          </strong>
          <span>{project.submodel || project.vin || `${project.make} ${project.model}`}</span>
        </div>
      </div>

      <div className="project-card-footer">
        <span>{project.currentColor || 'Color pendiente'}</span>
        <span className="cost-chip">{formatMoney(project.totalCostCents)}</span>
      </div>

      <div className="project-card-meta">
        <span>{formatDuration(project.currentStageSeconds)} en proceso</span>
        {project.status === 'paused' ? (
          <span className="status-chip paused">
            <CirclePause size={12} aria-hidden="true" />
            Pausado
          </span>
        ) : null}
      </div>

      <div className="card-actions">
        {project.stageCode === 'completed' ? <BadgeCheck size={16} aria-hidden="true" /> : children}
      </div>
    </article>
  )
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(cents / 100)
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)

  if (days > 0) {
    return `${days}d ${hours}h`
  }

  return `${Math.max(0, hours)}h`
}
