import { Archive, CarFront, CheckCircle2, CirclePause, Command, Search, Settings, Wrench } from 'lucide-react'
import type { VehicleProject } from '@shared/types'

export type AppModule = 'command' | 'projects' | 'workshop' | 'completed' | 'archive' | 'settings'

interface SidebarProps {
  activeModule: AppModule
  query: string
  projects: VehicleProject[]
  selectedProjectId: string | null
  onModuleChange: (module: AppModule) => void
  onQueryChange: (query: string) => void
  onSelectProject: (project: VehicleProject) => void
}

export function Sidebar({
  activeModule,
  query,
  projects,
  selectedProjectId,
  onModuleChange,
  onQueryChange,
  onSelectProject
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">BL</div>
        <div>
          <p className="eyebrow">macOS local</p>
          <h1>BLACKLINE GARAGE OS</h1>
        </div>
      </div>

      <label className="search-box">
        <Search size={16} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Buscar marca, modelo, año o VIN"
        />
      </label>

      <nav className="module-nav" aria-label="Modulos">
        <button
          className={activeModule === 'command' ? 'module-nav-item active' : 'module-nav-item'}
          type="button"
          title="Command Center"
          onClick={() => onModuleChange('command')}
        >
          <Command size={18} aria-hidden="true" />
          <span>Command</span>
        </button>
        <button
          className={activeModule === 'projects' ? 'module-nav-item active' : 'module-nav-item'}
          type="button"
          title="Proyectos"
          onClick={() => onModuleChange('projects')}
        >
          <CarFront size={18} aria-hidden="true" />
          <span>Proyectos</span>
        </button>
        <button
          className={activeModule === 'workshop' ? 'module-nav-item active' : 'module-nav-item'}
          type="button"
          title="Taller"
          onClick={() => onModuleChange('workshop')}
        >
          <Wrench size={18} aria-hidden="true" />
          <span>Taller</span>
        </button>
        <button
          className={activeModule === 'completed' ? 'module-nav-item active' : 'module-nav-item'}
          type="button"
          title="Completados"
          onClick={() => onModuleChange('completed')}
        >
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>Completados</span>
        </button>
        <button
          className={activeModule === 'archive' ? 'module-nav-item active' : 'module-nav-item'}
          type="button"
          title="Archivo"
          onClick={() => onModuleChange('archive')}
        >
          <Archive size={18} aria-hidden="true" />
          <span>Archivo</span>
        </button>
        <button
          className={activeModule === 'settings' ? 'module-nav-item active' : 'module-nav-item'}
          type="button"
          title="Configuracion"
          onClick={() => onModuleChange('settings')}
        >
          <Settings size={18} aria-hidden="true" />
          <span>Config</span>
        </button>
      </nav>

      <section className="search-results" aria-label="Resultados de busqueda">
        <div className="section-title">
          <span>Resultados</span>
          <small>{projects.length}</small>
        </div>

        <div className="result-list">
          {projects.slice(0, 9).map((project) => (
            <button
              key={project.id}
              className={selectedProjectId === project.id ? 'result-item selected' : 'result-item'}
              type="button"
              onClick={() => onSelectProject(project)}
            >
              <span>
                {project.projectName || `${project.year ? `${project.year} ` : ''}${project.make} ${project.model}`}
              </span>
              <small>
                {project.status === 'paused' ? <CirclePause size={12} aria-hidden="true" /> : null}
                {project.vin || project.stageName}
              </small>
            </button>
          ))}
        </div>
      </section>
    </aside>
  )
}
