import { useCallback, useEffect, useState } from 'react'
import { Box, Eye, EyeOff, Rotate3D } from 'lucide-react'
import type { DigitalTwinDashboard, VehicleProject } from '@shared/types'
import { garageApi } from '../api'
import { DigitalTwinCanvas } from './DigitalTwinCanvas'

interface DigitalTwinViewportProps {
  project: VehicleProject | null
}

export function DigitalTwinViewport({ project }: DigitalTwinViewportProps) {
  const [dashboard, setDashboard] = useState<DigitalTwinDashboard | null>(null)
  const [grayBackground, setGrayBackground] = useState(false)
  const [transparentMode, setTransparentMode] = useState(false)

  const loadDashboard = useCallback(async () => {
    if (!project) {
      setDashboard(null)
      return
    }

    setDashboard(await garageApi.digitalTwin.getDashboard(project.id))
  }, [project])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const modelReady = dashboard?.model?.status === 'ready'

  return (
    <section className="digital-twin">
      <div className="viewport-toolbar">
        <div>
          <p className="eyebrow">Gemelo digital</p>
          <h3>{project ? project.projectName || `${project.make} ${project.model}` : 'Sin proyecto'}</h3>
        </div>
        <div className="viewport-actions">
          <button
            className={grayBackground ? 'icon-button active' : 'icon-button'}
            type="button"
            title="Fondo gris claro"
            onClick={() => setGrayBackground((value) => !value)}
          >
            <Box size={16} aria-hidden="true" />
          </button>
          <button
            className={transparentMode ? 'icon-button active' : 'icon-button'}
            type="button"
            title="Modo transparente"
            onClick={() => setTransparentMode((value) => !value)}
          >
            {transparentMode ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
          <span className="icon-button passive" title="Rotar, zoom y pan" aria-hidden="true">
            <Rotate3D size={16} aria-hidden="true" />
          </span>
        </div>
      </div>
      {modelReady ? (
        <DigitalTwinCanvas
          dashboard={dashboard}
          background={grayBackground ? 'gray' : 'white'}
          viewMode="mixed"
          transparentMode={transparentMode}
          xrayMode={false}
        />
      ) : (
        <div className="three-viewport compact-empty">
          <Box size={24} aria-hidden="true" />
          <span>No hay modelo 3D generado todavia. Sube un ZIP con fotos del vehiculo para iniciar reconstruccion.</span>
        </div>
      )}
    </section>
  )
}
