import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  BlacklineElectronApi,
  CreateDigitalTwinSnapshotInput,
  CreateChecklistItemInput,
  CreateCostEntryInput,
  CreateInventoryItemInput,
  CreateInventoryLocationInput,
  CreateInventoryReportInput,
  CreateInventorySupplierInput,
  CommandCenterMode,
  CreateOemKnowledgeItemInput,
  CreatePlanningCostLineInput,
  CreatePlanningReportInput,
  CreatePredictiveReportInput,
  CreatePurchaseOrderInput,
  CreateVehicleProjectInput,
  GarageApi,
  ImportInspectionFilesInput,
  ImportOemReferenceInput,
  ImportProjectPhotoZipInput,
  MediaCategory,
  OemKnowledgeCategory,
  OemReferenceFileType,
  ImportProjectPhotosInput,
  PipelineStageCode,
  ReserveInventoryItemInput,
  RunOperationalSimulationInput,
  GenerateCommandCenterSummaryInput,
  SearchCommandCenterKnowledgeInput,
  SendCopilotMessageInput,
  UpdateDigitalTwinLayerInput,
  UpdateChecklistItemInput,
  UpdateCostEntryInput,
  UpdateInventoryItemInput,
  UpdateInventorySupplierInput,
  UpdateInspectionFindingInput,
  UpdatePlanningCostLineInput,
  UpdatePurchaseOrderInput,
  UpdateVehicleProjectInput
} from '../shared/types'

const api: GarageApi = {
  dashboard: {
    getStats: () => ipcRenderer.invoke('dashboard:getStats')
  },
  pipeline: {
    getSnapshot: () => ipcRenderer.invoke('pipeline:getSnapshot'),
    moveProject: (projectId: string, stageCode: PipelineStageCode) =>
      ipcRenderer.invoke('pipeline:moveProject', projectId, stageCode)
  },
  projects: {
    list: (query?: string) => ipcRenderer.invoke('projects:list', query),
    getDetail: (id: string) => ipcRenderer.invoke('projects:getDetail', id),
    create: (input: CreateVehicleProjectInput) => ipcRenderer.invoke('projects:create', input),
    update: (input: UpdateVehicleProjectInput) => ipcRenderer.invoke('projects:update', input),
    pause: (id: string) => ipcRenderer.invoke('projects:pause', id),
    resume: (id: string) => ipcRenderer.invoke('projects:resume', id),
    archive: (id: string) => ipcRenderer.invoke('projects:archive', id),
    reactivate: (id: string) => ipcRenderer.invoke('projects:reactivate', id),
    complete: (id: string) => ipcRenderer.invoke('projects:complete', id),
    delete: (id: string) => ipcRenderer.invoke('projects:delete', id)
  },
  checklist: {
    create: (input: CreateChecklistItemInput) => ipcRenderer.invoke('checklist:create', input),
    update: (input: UpdateChecklistItemInput) => ipcRenderer.invoke('checklist:update', input),
    delete: (id: string) => ipcRenderer.invoke('checklist:delete', id)
  },
  costs: {
    create: (input: CreateCostEntryInput) => ipcRenderer.invoke('costs:create', input),
    update: (input: UpdateCostEntryInput) => ipcRenderer.invoke('costs:update', input),
    delete: (id: string) => ipcRenderer.invoke('costs:delete', id)
  },
  media: {
    importPhotos: (input: ImportProjectPhotosInput) => ipcRenderer.invoke('media:importPhotos', input),
    importPhotoZip: (input: ImportProjectPhotoZipInput) => {
      console.info('Abriendo Finder')
      return ipcRenderer.invoke('media:importPhotoZip', input)
    },
    delete: (id: string) => ipcRenderer.invoke('media:delete', id)
  },
  inspection: {
    getDashboard: (projectId: string) => ipcRenderer.invoke('inspection:getDashboard', projectId),
    importFiles: (input: ImportInspectionFilesInput) => ipcRenderer.invoke('inspection:importFiles', input),
    importDroppedFiles: (projectId: string, files: File[]) => {
      const filePaths = files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)
      return ipcRenderer.invoke('inspection:importDroppedFiles', { projectId, filePaths })
    },
    approveFinding: (id: string) => ipcRenderer.invoke('inspection:approveFinding', id),
    rejectFinding: (id: string) => ipcRenderer.invoke('inspection:rejectFinding', id),
    updateFinding: (input: UpdateInspectionFindingInput) => ipcRenderer.invoke('inspection:updateFinding', input)
  },
  digitalTwin: {
    getDashboard: (projectId: string) => ipcRenderer.invoke('digitalTwin:getDashboard', projectId),
    generate: (projectId: string) => ipcRenderer.invoke('digitalTwin:generate', projectId),
    getJobLogs: (jobId: string) => ipcRenderer.invoke('digitalTwin:getJobLogs', jobId),
    getJobStatus: (jobId: string) => ipcRenderer.invoke('digitalTwin:getJobStatus', jobId),
    updateLayer: (input: UpdateDigitalTwinLayerInput) => ipcRenderer.invoke('digitalTwin:updateLayer', input),
    createSnapshot: (input: CreateDigitalTwinSnapshotInput) => ipcRenderer.invoke('digitalTwin:createSnapshot', input)
  },
  oem: {
    getDashboard: (projectId: string) => ipcRenderer.invoke('oem:getDashboard', projectId),
    researchProject: (projectId: string) => ipcRenderer.invoke('oem:researchProject', projectId),
    importReferences: (input: ImportOemReferenceInput) => ipcRenderer.invoke('oem:importReferences', input),
    importDroppedReferences: (
      projectId: string,
      category: OemKnowledgeCategory,
      fileType: OemReferenceFileType,
      files: File[]
    ) => {
      const filePaths = files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)
      return ipcRenderer.invoke('oem:importDroppedReferences', { projectId, category, fileType, filePaths })
    },
    createKnowledgeItem: (input: CreateOemKnowledgeItemInput) => ipcRenderer.invoke('oem:createKnowledgeItem', input),
    approveSuggestion: (id: string) => ipcRenderer.invoke('oem:approveSuggestion', id),
    rejectSuggestion: (id: string) => ipcRenderer.invoke('oem:rejectSuggestion', id),
    ignoreSuggestion: (id: string) => ipcRenderer.invoke('oem:ignoreSuggestion', id)
  },
  planning: {
    getDashboard: (projectId: string) => ipcRenderer.invoke('planning:getDashboard', projectId),
    createCostLine: (input: CreatePlanningCostLineInput) => ipcRenderer.invoke('planning:createCostLine', input),
    updateCostLine: (input: UpdatePlanningCostLineInput) => ipcRenderer.invoke('planning:updateCostLine', input),
    deleteCostLine: (id: string) => ipcRenderer.invoke('planning:deleteCostLine', id),
    generateReport: (input: CreatePlanningReportInput) => ipcRenderer.invoke('planning:generateReport', input)
  },
  inventory: {
    getDashboard: (projectId?: string | null) => ipcRenderer.invoke('inventory:getDashboard', projectId),
    createLocation: (input: CreateInventoryLocationInput) => ipcRenderer.invoke('inventory:createLocation', input),
    createSupplier: (input: CreateInventorySupplierInput) => ipcRenderer.invoke('inventory:createSupplier', input),
    updateSupplier: (input: UpdateInventorySupplierInput) => ipcRenderer.invoke('inventory:updateSupplier', input),
    createItem: (input: CreateInventoryItemInput) => ipcRenderer.invoke('inventory:createItem', input),
    updateItem: (input: UpdateInventoryItemInput) => ipcRenderer.invoke('inventory:updateItem', input),
    deleteItem: (id: string) => ipcRenderer.invoke('inventory:deleteItem', id),
    reserveItem: (input: ReserveInventoryItemInput) => ipcRenderer.invoke('inventory:reserveItem', input),
    importItemPhotos: (itemId: string) => ipcRenderer.invoke('inventory:importItemPhotos', itemId),
    createPurchaseOrder: (input: CreatePurchaseOrderInput) => ipcRenderer.invoke('inventory:createPurchaseOrder', input),
    updatePurchaseOrder: (input: UpdatePurchaseOrderInput) => ipcRenderer.invoke('inventory:updatePurchaseOrder', input),
    cancelPurchaseOrder: (id: string) => ipcRenderer.invoke('inventory:cancelPurchaseOrder', id),
    completePurchaseOrder: (id: string) => ipcRenderer.invoke('inventory:completePurchaseOrder', id),
    generateReport: (input: CreateInventoryReportInput) => ipcRenderer.invoke('inventory:generateReport', input)
  },
  predictive: {
    getDashboard: (projectId?: string | null) => ipcRenderer.invoke('predictive:getDashboard', projectId),
    runSimulation: (input: RunOperationalSimulationInput) => ipcRenderer.invoke('predictive:runSimulation', input),
    generateReport: (input: CreatePredictiveReportInput) => ipcRenderer.invoke('predictive:generateReport', input)
  },
  commandCenter: {
    getDashboard: (mode?: CommandCenterMode) => ipcRenderer.invoke('commandCenter:getDashboard', mode),
    acknowledgeAlert: (id: string) => ipcRenderer.invoke('commandCenter:acknowledgeAlert', id),
    generateSummary: (input: GenerateCommandCenterSummaryInput) => ipcRenderer.invoke('commandCenter:generateSummary', input),
    searchKnowledge: (input: SearchCommandCenterKnowledgeInput) => ipcRenderer.invoke('commandCenter:searchKnowledge', input)
  },
  copilot: {
    getDashboard: (projectId?: string | null) => ipcRenderer.invoke('copilot:getDashboard', projectId),
    sendMessage: (input: SendCopilotMessageInput) => ipcRenderer.invoke('copilot:sendMessage', input)
  },
  maintenance: {
    clearDatabase: () => ipcRenderer.invoke('maintenance:clearDatabase')
  }
}

const blacklineApi: BlacklineElectronApi = {
  ...api,
  isElectron: true,
  selectZipFile: (projectId: string, category: MediaCategory = 'exterior') => {
    console.info('Abriendo Finder')
    return ipcRenderer.invoke('media:importPhotoZip', { projectId, category })
  }
}

console.info('Electron API detectada')
contextBridge.exposeInMainWorld('blacklineAPI', blacklineApi)
contextBridge.exposeInMainWorld('blackline', api)
