import { ipcMain } from 'electron'
import type {
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
  ImportOemDroppedReferenceInput,
  ImportOemReferenceInput,
  ImportProjectPhotoZipInput,
  ImportProjectPhotosInput,
  ImportInspectionDroppedFilesInput,
  ImportInspectionFilesInput,
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
import { getDatabase } from './database/connection'
import { CopilotRepository } from './repositories/copilotRepository'
import { DigitalTwinRepository } from './repositories/digitalTwinRepository'
import { InspectionRepository } from './repositories/inspectionRepository'
import { InventoryRepository } from './repositories/inventoryRepository'
import { OemRepository } from './repositories/oemRepository'
import { PlanningRepository } from './repositories/planningRepository'
import { PredictiveRepository } from './repositories/predictiveRepository'
import { ProjectRepository } from './repositories/projectRepository'
import { DigitalTwinGenerationService } from './services/digitalTwinGenerationService'
import { DatabaseMaintenanceService } from './services/databaseMaintenanceService'
import { CopilotService } from './services/copilotService'
import { FileStorageService } from './services/fileStorageService'
import { IntelligentInspectionService } from './services/intelligentInspectionService'
import { InventoryService } from './services/inventoryService'
import { OemResearchService } from './services/oemResearchService'
import { PlanningIntelligenceService } from './services/planningIntelligenceService'
import { PhotogrammetryService } from './services/photogrammetryService'
import { PredictiveEngineService } from './services/predictiveEngineService'
import { PipelineService } from './services/pipelineService'
import { WorkshopMonitorService } from './services/workshopMonitorService'

export function registerIpcHandlers(): void {
  const projectRepository = new ProjectRepository(getDatabase())
  const copilotRepository = new CopilotRepository(getDatabase())
  const inspectionRepository = new InspectionRepository(getDatabase())
  const digitalTwinRepository = new DigitalTwinRepository(getDatabase())
  const oemRepository = new OemRepository(getDatabase())
  const planningRepository = new PlanningRepository(getDatabase())
  const inventoryRepository = new InventoryRepository(getDatabase())
  const predictiveRepository = new PredictiveRepository(getDatabase())
  const photogrammetryService = new PhotogrammetryService(digitalTwinRepository, projectRepository)
  const fileStorageService = new FileStorageService(projectRepository, digitalTwinRepository)
  const databaseMaintenanceService = new DatabaseMaintenanceService(getDatabase())
  const intelligentInspectionService = new IntelligentInspectionService(inspectionRepository, projectRepository)
  const digitalTwinGenerationService = new DigitalTwinGenerationService(
    digitalTwinRepository,
    projectRepository,
    photogrammetryService
  )
  const oemResearchService = new OemResearchService(oemRepository, projectRepository)
  const planningIntelligenceService = new PlanningIntelligenceService(planningRepository, projectRepository)
  const inventoryService = new InventoryService(inventoryRepository)
  const predictiveEngineService = new PredictiveEngineService(predictiveRepository)
  const copilotService = new CopilotService(
    copilotRepository,
    projectRepository,
    planningRepository,
    oemRepository,
    digitalTwinRepository,
    inventoryRepository,
    predictiveRepository
  )
  const workshopMonitorService = new WorkshopMonitorService(
    getDatabase(),
    projectRepository,
    inventoryRepository,
    predictiveRepository,
    copilotService
  )
  const pipelineService = new PipelineService()

  ipcMain.handle('dashboard:getStats', async () => projectRepository.getDashboardStats())

  ipcMain.handle('pipeline:getSnapshot', async () => pipelineService.getSnapshot())

  ipcMain.handle('pipeline:moveProject', async (_event, projectId: string, stageCode: PipelineStageCode) =>
    pipelineService.moveProject(projectId, stageCode)
  )

  ipcMain.handle('projects:list', async (_event, query?: string) => projectRepository.listProjects(query))

  ipcMain.handle('projects:getDetail', async (_event, id: string) => projectRepository.getProjectDetail(id))

  ipcMain.handle('projects:create', async (_event, input: CreateVehicleProjectInput) =>
    projectRepository.createProject(input)
  )

  ipcMain.handle('projects:update', async (_event, input: UpdateVehicleProjectInput) =>
    projectRepository.updateProject(input)
  )

  ipcMain.handle('projects:pause', async (_event, id: string) => projectRepository.pauseProject(id))

  ipcMain.handle('projects:resume', async (_event, id: string) => projectRepository.resumeProject(id))

  ipcMain.handle('projects:archive', async (_event, id: string) => projectRepository.archiveProject(id))

  ipcMain.handle('projects:reactivate', async (_event, id: string) => projectRepository.reactivateProject(id))

  ipcMain.handle('projects:complete', async (_event, id: string) => projectRepository.completeProject(id))

  ipcMain.handle('projects:delete', async (_event, id: string) => {
    projectRepository.deleteProject(id)
    fileStorageService.deleteProjectFiles(id)
  })

  ipcMain.handle('checklist:create', async (_event, input: CreateChecklistItemInput) =>
    projectRepository.createChecklistItem(input)
  )

  ipcMain.handle('checklist:update', async (_event, input: UpdateChecklistItemInput) =>
    projectRepository.updateChecklistItem(input)
  )

  ipcMain.handle('checklist:delete', async (_event, id: string) => projectRepository.deleteChecklistItem(id))

  ipcMain.handle('costs:create', async (_event, input: CreateCostEntryInput) => projectRepository.createCostEntry(input))

  ipcMain.handle('costs:update', async (_event, input: UpdateCostEntryInput) => projectRepository.updateCostEntry(input))

  ipcMain.handle('costs:delete', async (_event, id: string) => projectRepository.deleteCostEntry(id))

  ipcMain.handle('media:importPhotos', async (_event, input: ImportProjectPhotosInput) =>
    fileStorageService.importPhotos(input.projectId, input.category)
  )

  ipcMain.handle('media:importPhotoZip', async (_event, input: ImportProjectPhotoZipInput) =>
    fileStorageService.importPhotoZip(input.projectId, input.category)
  )

  ipcMain.handle('media:delete', async (_event, id: string) => fileStorageService.deleteMedia(id))

  ipcMain.handle('inspection:getDashboard', async (_event, projectId: string) =>
    intelligentInspectionService.getDashboard(projectId)
  )

  ipcMain.handle('inspection:importFiles', async (_event, input: ImportInspectionFilesInput) =>
    intelligentInspectionService.importFiles(input.projectId)
  )

  ipcMain.handle('inspection:importDroppedFiles', async (_event, input: ImportInspectionDroppedFilesInput) =>
    intelligentInspectionService.importFilePaths(input.projectId, input.filePaths)
  )

  ipcMain.handle('inspection:approveFinding', async (_event, id: string) => intelligentInspectionService.approveFinding(id))

  ipcMain.handle('inspection:rejectFinding', async (_event, id: string) => intelligentInspectionService.rejectFinding(id))

  ipcMain.handle('inspection:updateFinding', async (_event, input: UpdateInspectionFindingInput) =>
    intelligentInspectionService.updateFinding(input)
  )

  ipcMain.handle('digitalTwin:getDashboard', async (_event, projectId: string) =>
    digitalTwinGenerationService.getDashboard(projectId)
  )

  ipcMain.handle('digitalTwin:generate', async (_event, projectId: string) =>
    digitalTwinGenerationService.generate(projectId)
  )

  ipcMain.handle('digitalTwin:getJobLogs', async (_event, jobId: string) => photogrammetryService.getJobLogs(jobId))

  ipcMain.handle('digitalTwin:getJobStatus', async (_event, jobId: string) => photogrammetryService.getJobStatus(jobId))

  ipcMain.handle('digitalTwin:updateLayer', async (_event, input: UpdateDigitalTwinLayerInput) =>
    digitalTwinGenerationService.updateLayer(input)
  )

  ipcMain.handle('digitalTwin:createSnapshot', async (_event, input: CreateDigitalTwinSnapshotInput) =>
    digitalTwinGenerationService.createSnapshot(input.digitalTwinId, input.name, input.snapshotType)
  )

  ipcMain.handle('oem:getDashboard', async (_event, projectId: string) => oemResearchService.getDashboard(projectId))

  ipcMain.handle('oem:researchProject', async (_event, projectId: string) => oemResearchService.researchProject(projectId))

  ipcMain.handle('oem:importReferences', async (_event, input: ImportOemReferenceInput) =>
    oemResearchService.importReferences(input)
  )

  ipcMain.handle('oem:importDroppedReferences', async (_event, input: ImportOemDroppedReferenceInput) =>
    oemResearchService.importReferencePaths(input)
  )

  ipcMain.handle('oem:createKnowledgeItem', async (_event, input: CreateOemKnowledgeItemInput) =>
    oemResearchService.createKnowledgeItem(input)
  )

  ipcMain.handle('oem:approveSuggestion', async (_event, id: string) => oemResearchService.approveSuggestion(id))

  ipcMain.handle('oem:rejectSuggestion', async (_event, id: string) => oemResearchService.rejectSuggestion(id))

  ipcMain.handle('oem:ignoreSuggestion', async (_event, id: string) => oemResearchService.ignoreSuggestion(id))

  ipcMain.handle('planning:getDashboard', async (_event, projectId: string) =>
    planningIntelligenceService.getDashboard(projectId)
  )

  ipcMain.handle('planning:createCostLine', async (_event, input: CreatePlanningCostLineInput) =>
    planningIntelligenceService.createCostLine(input)
  )

  ipcMain.handle('planning:updateCostLine', async (_event, input: UpdatePlanningCostLineInput) =>
    planningIntelligenceService.updateCostLine(input)
  )

  ipcMain.handle('planning:deleteCostLine', async (_event, id: string) => planningIntelligenceService.deleteCostLine(id))

  ipcMain.handle('planning:generateReport', async (_event, input: CreatePlanningReportInput) =>
    planningIntelligenceService.generateReport(input)
  )

  ipcMain.handle('inventory:getDashboard', async (_event, projectId?: string | null) => inventoryService.getDashboard(projectId))

  ipcMain.handle('inventory:createLocation', async (_event, input: CreateInventoryLocationInput) =>
    inventoryService.createLocation(input)
  )

  ipcMain.handle('inventory:createSupplier', async (_event, input: CreateInventorySupplierInput) =>
    inventoryService.createSupplier(input)
  )

  ipcMain.handle('inventory:updateSupplier', async (_event, input: UpdateInventorySupplierInput) =>
    inventoryService.updateSupplier(input)
  )

  ipcMain.handle('inventory:createItem', async (_event, input: CreateInventoryItemInput) => inventoryService.createItem(input))

  ipcMain.handle('inventory:updateItem', async (_event, input: UpdateInventoryItemInput) => inventoryService.updateItem(input))

  ipcMain.handle('inventory:deleteItem', async (_event, id: string) => inventoryService.deleteItem(id))

  ipcMain.handle('inventory:reserveItem', async (_event, input: ReserveInventoryItemInput) => inventoryService.reserveItem(input))

  ipcMain.handle('inventory:importItemPhotos', async (_event, itemId: string) => inventoryService.importItemPhotos(itemId))

  ipcMain.handle('inventory:createPurchaseOrder', async (_event, input: CreatePurchaseOrderInput) =>
    inventoryService.createPurchaseOrder(input)
  )

  ipcMain.handle('inventory:updatePurchaseOrder', async (_event, input: UpdatePurchaseOrderInput) =>
    inventoryService.updatePurchaseOrder(input)
  )

  ipcMain.handle('inventory:cancelPurchaseOrder', async (_event, id: string) => inventoryService.cancelPurchaseOrder(id))

  ipcMain.handle('inventory:completePurchaseOrder', async (_event, id: string) => inventoryService.completePurchaseOrder(id))

  ipcMain.handle('inventory:generateReport', async (_event, input: CreateInventoryReportInput) =>
    inventoryService.generateReport(input)
  )

  ipcMain.handle('predictive:getDashboard', async (_event, projectId?: string | null) =>
    predictiveEngineService.getDashboard(projectId)
  )

  ipcMain.handle('predictive:runSimulation', async (_event, input: RunOperationalSimulationInput) =>
    predictiveEngineService.runSimulation(input)
  )

  ipcMain.handle('predictive:generateReport', async (_event, input: CreatePredictiveReportInput) =>
    predictiveEngineService.generateReport(input)
  )

  ipcMain.handle('commandCenter:getDashboard', async (_event, mode?: CommandCenterMode) =>
    workshopMonitorService.getDashboard(mode)
  )

  ipcMain.handle('commandCenter:acknowledgeAlert', async (_event, id: string) => workshopMonitorService.acknowledgeAlert(id))

  ipcMain.handle('commandCenter:generateSummary', async (_event, input: GenerateCommandCenterSummaryInput) =>
    workshopMonitorService.generateSummary(input)
  )

  ipcMain.handle('commandCenter:searchKnowledge', async (_event, input: SearchCommandCenterKnowledgeInput) =>
    workshopMonitorService.searchKnowledge(input)
  )

  ipcMain.handle('copilot:getDashboard', async (_event, projectId?: string | null) => copilotService.getDashboard(projectId))

  ipcMain.handle('copilot:sendMessage', async (_event, input: SendCopilotMessageInput) => copilotService.sendMessage(input))

  ipcMain.handle('maintenance:clearDatabase', async () => databaseMaintenanceService.clearDatabase())
}
