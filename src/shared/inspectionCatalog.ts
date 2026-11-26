import type { ChecklistSection } from './types'

export const CHECKLIST_SECTION_LABELS: Record<ChecklistSection, string> = {
  interior: 'Interior',
  exterior: 'Exterior',
  mechanical: 'Mecanica',
  electrical: 'Electrico',
  sound: 'Sonido',
  paint: 'Pintura',
  detailing: 'Detallado'
}

export const CHECKLIST_SECTIONS = Object.entries(CHECKLIST_SECTION_LABELS).map(([value, label]) => ({
  value: value as ChecklistSection,
  label
}))

export const EXTERIOR_COMPONENTS = [
  'Cofre',
  'Defensa delantera',
  'Defensa trasera',
  'Parrilla',
  'Faro izquierdo',
  'Faro derecho',
  'Calaveras',
  'Salpicaderas',
  'Puertas',
  'Cristales',
  'Espejos',
  'Molduras',
  'Emblemas',
  'Rines',
  'Llantas'
] as const

export const INTERIOR_COMPONENTS = [
  'Volante',
  'Tablero',
  'Cluster',
  'Radio',
  'Consola central',
  'Asientos',
  'Cabeceras',
  'Paneles de puerta',
  'Tapicerias',
  'Alfombra',
  'Guantera',
  'Techo interior'
] as const

export const DAMAGE_TYPES = [
  'Oxido',
  'Corrosion',
  'Abolladuras',
  'Rayones',
  'Grietas',
  'Desgaste',
  'Roturas',
  'Decoloracion',
  'Piezas faltantes'
] as const

