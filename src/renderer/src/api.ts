import type { GarageApi } from '@shared/types'
import { createPreviewApi } from './previewApi'

const electronApi = window.blacklineAPI ?? window.blackline

if (electronApi) {
  console.info('Electron API detectada')
} else {
  console.error('No se encontró la API de Electron. Revisa preload y contextBridge.')
}

export const garageApi: GarageApi = electronApi ?? createPreviewApi()
