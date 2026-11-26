import { FormEvent, useState } from 'react'
import { Plus } from 'lucide-react'
import type { CreateVehicleProjectInput, PipelineStage } from '@shared/types'

interface ProjectFormProps {
  stages: PipelineStage[]
  onCreate: (input: CreateVehicleProjectInput) => Promise<void>
}

const initialState = {
  projectName: '',
  make: '',
  model: '',
  year: '',
  submodel: '',
  vin: '',
  currentColor: '',
  oemColor: '',
  status: 'active',
  stageCode: 'inspection_total_general',
  budget: '',
  notes: ''
}

export function ProjectForm({ stages, onCreate }: ProjectFormProps) {
  const [form, setForm] = useState(initialState)
  const [isSaving, setIsSaving] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setIsSaving(true)

    try {
      await onCreate({
        projectName: form.projectName,
        make: form.make,
        model: form.model,
        year: form.year ? Number(form.year) : null,
        submodel: form.submodel,
        vin: form.vin,
        currentColor: form.currentColor,
        oemColor: form.oemColor,
        notes: form.notes,
        budgetCents: Number(form.budget || 0) * 100,
        stageCode: form.stageCode as CreateVehicleProjectInput['stageCode'],
        status: form.status as CreateVehicleProjectInput['status']
      })
      setForm(initialState)
      setIsOpen(false)
    } finally {
      setIsSaving(false)
    }
  }

  const selectedStage = stages.find((stage) => stage.code === form.stageCode)
  const selectedStageIsFull = form.status === 'active' && selectedStage ? selectedStage.projectCount >= selectedStage.capacity : false

  return (
    <form className="project-form" onSubmit={handleSubmit}>
      <div className="form-heading">
        <div>
          <p className="eyebrow">Nuevo vehiculo</p>
          <h3>Agregar vehiculo / proyecto</h3>
        </div>
        {!isOpen ? (
          <button className="primary-icon-button" type="button" onClick={() => setIsOpen(true)}>
            <Plus size={18} aria-hidden="true" />
            <span>Agregar vehiculo / proyecto</span>
          </button>
        ) : (
          <button className="primary-icon-button" type="submit" disabled={isSaving || selectedStageIsFull} title="Crear">
            <Plus size={18} aria-hidden="true" />
            <span>{isSaving ? 'Guardando' : 'Crear'}</span>
          </button>
        )}
      </div>

      {isOpen ? (
        <>
          <div className="form-grid">
            <input
              value={form.projectName}
              onChange={(event) => setForm({ ...form, projectName: event.target.value })}
              placeholder="Nombre del proyecto"
              required
            />
            <input
              value={form.make}
              onChange={(event) => setForm({ ...form, make: event.target.value })}
              placeholder="Marca"
              required
            />
            <input
              value={form.model}
              onChange={(event) => setForm({ ...form, model: event.target.value })}
              placeholder="Modelo"
              required
            />
            <input
              value={form.year}
              onChange={(event) => setForm({ ...form, year: event.target.value })}
              placeholder="Año"
              inputMode="numeric"
              required
            />
            <input
              value={form.submodel}
              onChange={(event) => setForm({ ...form, submodel: event.target.value })}
              placeholder="Version / submodelo"
            />
            <input
              value={form.vin}
              onChange={(event) => setForm({ ...form, vin: event.target.value })}
              placeholder="VIN"
            />
            <input
              value={form.currentColor}
              onChange={(event) => setForm({ ...form, currentColor: event.target.value })}
              placeholder="Color actual"
            />
            <input
              value={form.oemColor}
              onChange={(event) => setForm({ ...form, oemColor: event.target.value })}
              placeholder="Color OEM"
            />
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="active">Activo</option>
              <option value="paused">Pausado</option>
            </select>
            <select value={form.stageCode} onChange={(event) => setForm({ ...form, stageCode: event.target.value })}>
              {stages.map((stage) => (
                <option key={stage.code} value={stage.code}>
                  {stage.name}
                </option>
              ))}
            </select>
            <input
              value={form.budget}
              onChange={(event) => setForm({ ...form, budget: event.target.value })}
              placeholder="Presupuesto"
              inputMode="numeric"
            />
            <textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Notas"
            />
          </div>

          {selectedStageIsFull ? (
            <p className="capacity-note">
              El proceso seleccionado ya tiene un vehiculo activo. Puedes crear el proyecto pausado o elegir otro proceso.
            </p>
          ) : null}
        </>
      ) : null}
    </form>
  )
}
