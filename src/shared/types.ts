export const PIPELINE_STAGE_CODES = [
  'inspection_total_general',
  'mechanical_electrical',
  'sound',
  'exterior',
  'paint',
  'exterior_interior_assembly',
  'total_detailing',
  'completed'
] as const

export type PipelineStageCode = (typeof PIPELINE_STAGE_CODES)[number]

export type ProjectStatus = 'active' | 'paused' | 'archived' | 'completed'

export type ComponentStatus = 'pending' | 'purchased_or_repaired' | 'assembled' | 'completed'

export type ChecklistSection = 'interior' | 'exterior' | 'mechanical' | 'electrical' | 'sound' | 'paint' | 'detailing'

export type CostCategory = 'purchase' | 'repair' | 'paint' | 'labor' | 'transport'

export type MediaCategory =
  | 'reception'
  | 'exterior'
  | 'interior'
  | 'engine'
  | 'trunk'
  | 'chassis'
  | 'damage'
  | 'process'
  | 'final'
  | 'disassembly'
  | 'repair'
  | 'paint'
  | 'assembly'
  | 'technical'
  | 'other'

export type InspectionRunStatus = 'pending' | 'running' | 'completed' | 'failed'

export type InspectionAssetKind = 'image' | 'video' | 'frame'

export type InspectionFindingType = 'component' | 'damage' | 'missing_part' | 'possible_modification'

export type InspectionReviewStatus = 'pending' | 'approved' | 'rejected'

export type DigitalTwinStatus = 'placeholder' | 'pending' | 'processing' | 'ready' | 'failed' | 'archived'

export type DigitalTwinLayerKey =
  | 'exterior'
  | 'interior'
  | 'engine'
  | 'chassis'
  | 'suspension'
  | 'electrical'
  | 'glass'
  | 'upholstery'

export type DigitalTwinViewMode = 'exterior' | 'interior' | 'mixed'

export type DigitalTwinComponentState = 'uninspected' | 'pending' | 'damaged' | 'purchased_or_repaired' | 'in_process' | 'completed'

export type DigitalTwinSnapshotType = 'initial' | 'current' | 'milestone'

export type OemResearchStatus = 'pending' | 'running' | 'completed' | 'failed'

export type OemKnowledgeCategory =
  | 'vin_decode'
  | 'technical_specification'
  | 'oem_color'
  | 'oem_interior'
  | 'oem_engine'
  | 'oem_photo'
  | 'manual'
  | 'catalog'
  | 'diagram'
  | 'documentation'
  | 'equipment'

export type OemReferenceFileType = 'photo' | 'manual' | 'catalog' | 'diagram' | 'document' | 'technical'

export type OemDifferenceType =
  | 'missing_component'
  | 'possible_modification'
  | 'incorrect_component'
  | 'color_difference'
  | 'specification_mismatch'

export type OemSuggestionStatus = 'pending' | 'approved' | 'rejected' | 'ignored'

export type PlanningScenario = 'conservative' | 'intermediate' | 'complete_oem'

export type ComponentCostBucket = 'purchase' | 'repair' | 'paint' | 'installation' | 'shipping' | 'import'

export type PlanningAlertType = 'critical_part' | 'delay' | 'budget' | 'blocked_process' | 'dependency'

export type PlanningRecommendationType = 'cost' | 'duration' | 'priority' | 'dependency' | 'risk'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type PlanningReportType = 'executive' | 'financial' | 'technical' | 'progress' | 'client'

export type PlanningReportFormat = 'pdf' | 'excel'

export type InventoryItemType =
  | 'oem_part'
  | 'aftermarket_part'
  | 'restored_part'
  | 'used_part'
  | 'material'
  | 'consumable'
  | 'tool'

export type InventoryItemStatus =
  | 'available'
  | 'reserved'
  | 'ordered'
  | 'in_transit'
  | 'received'
  | 'installed'
  | 'repair'
  | 'discarded'

export type InventoryLocationType = 'shelf' | 'warehouse' | 'workshop' | 'paint_area' | 'assembly_area' | 'custom'

export type PurchaseOrderStatus = 'pending' | 'ordered' | 'paid' | 'in_transit' | 'received' | 'canceled'

export type InventoryReportType = 'inventory' | 'purchases' | 'suppliers' | 'project_parts'

export type PredictiveRiskType = 'financial' | 'operational' | 'delay' | 'dependency' | 'missing_parts' | 'bottleneck'

export type PredictiveReportType = 'risk' | 'productivity' | 'capacity' | 'predictions'

export type CommandCenterMode = 'executive' | 'operational' | 'restorer'

export type CommandCenterAlertLevel = 'info' | 'warning' | 'important' | 'critical'

export type CommandCenterAlertStatus = 'open' | 'acknowledged'

export type CommandCenterSummaryType = 'daily' | 'weekly'

export type CommandCenterKnowledgeCategory =
  | 'project'
  | 'oem'
  | 'report'
  | 'history'
  | 'media'
  | 'inventory'
  | 'copilot'

export type CopilotMode = 'restorer' | 'client'

export type CopilotRole = 'user' | 'assistant'

export type CopilotIntent =
  | 'project_status'
  | 'shop_status'
  | 'next_actions'
  | 'purchase_recommendation'
  | 'oem_recommendation'
  | 'time_estimate'
  | 'cost_estimate'
  | 'digital_twin'
  | 'client_summary'
  | 'technical_summary'
  | 'universal_search'
  | 'unknown'

export type CopilotDecisionType = 'next_action' | 'risk' | 'purchase' | 'delay' | 'priority'

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface PipelineStage {
  id: string
  code: PipelineStageCode
  name: string
  position: number
  capacity: number
  isTerminal: boolean
  projectCount: number
}

export interface VehicleProject {
  id: string
  projectName: string
  stageId: string
  stageCode: PipelineStageCode
  stageName: string
  status: ProjectStatus
  make: string
  model: string
  year: number | null
  submodel: string
  vin: string
  currentColor: string
  oemColor: string
  notes: string
  budgetCents: number
  totalCostCents: number
  createdAt: string
  updatedAt: string
  currentStageEnteredAt: string
  archivedAt: string | null
  completedAt: string | null
  entryDate: string
  exitDate: string | null
  totalElapsedSeconds: number
  currentStageSeconds: number
}

export interface CreateVehicleProjectInput {
  projectName?: string
  make: string
  model: string
  year?: number | null
  submodel?: string
  vin?: string
  currentColor?: string
  oemColor?: string
  notes?: string
  budgetCents?: number
  stageCode?: PipelineStageCode
  status?: Extract<ProjectStatus, 'active' | 'paused'>
}

export interface UpdateVehicleProjectInput extends Partial<CreateVehicleProjectInput> {
  id: string
}

export interface DashboardStats {
  activeVehicles: number
  completedVehicles: number
  pausedVehicles: number
  archivedVehicles: number
  occupiedProcesses: number
  freeProcesses: number
  totalInvestedCents: number
  activeBudgetCents: number
}

export interface PipelineSnapshot {
  stages: PipelineStage[]
  projects: VehicleProject[]
  stats: DashboardStats
}

export interface ChecklistItem {
  id: string
  projectId: string
  section: ChecklistSection
  title: string
  status: ComponentStatus
  notes: string
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateChecklistItemInput {
  projectId: string
  section: ChecklistSection
  title: string
  status?: ComponentStatus
  notes?: string
}

export interface UpdateChecklistItemInput {
  id: string
  title?: string
  section?: ChecklistSection
  status?: ComponentStatus
  notes?: string
}

export interface CostEntry {
  id: string
  projectId: string
  concept: string
  amountCents: number
  occurredOn: string
  createdAt: string
  updatedAt: string
}

export interface CreateCostEntryInput {
  projectId: string
  concept: string
  amountCents: number
  occurredOn: string
}

export interface UpdateCostEntryInput {
  id: string
  concept?: string
  amountCents?: number
  occurredOn?: string
}

export interface ProjectMedia {
  id: string
  projectId: string
  category: MediaCategory
  filename: string
  localPath: string
  mimeType: string
  mediaUrl: string
  source: 'manual' | 'zip' | 'inspection' | 'generated'
  importedAt: string
  width: number | null
  height: number | null
  status: 'imported' | 'error'
  createdAt: string
}

export interface ImportProjectPhotosInput {
  projectId: string
  category: MediaCategory
}

export interface ImportProjectPhotoZipInput {
  projectId: string
  category: MediaCategory
}

export interface ImportProjectPhotoZipResult {
  imported: ProjectMedia[]
  importedCount: number
  ignoredCount: number
  zipFilename: string
  zipImport: PhotoZipImport | null
  analysisJob: PhotogrammetryJob | null
  reconstructionJob: DigitalTwinModel | null
  logs: DigitalTwinLogEntry[]
  warning: string | null
  message: string
}

export type PhotogrammetryJobStatus = 'pending' | 'processing' | 'completed' | 'error' | 'waiting_for_engine'
export type PhotogrammetryJobType = 'analysis' | 'reconstruction'

export interface PhotoZipImport {
  id: string
  projectId: string
  filename: string
  originalPath: string
  localPath: string
  importedAt: string
  sizeBytes: number
  importedCount: number
  ignoredCount: number
  status: 'imported' | 'error'
  metadata: Record<string, unknown>
}

export interface PhotogrammetryJob {
  id: string
  projectId: string
  type: PhotogrammetryJobType
  status: PhotogrammetryJobStatus
  progress: number
  imageCount: number
  zipImportId: string | null
  modelPath: string
  logPath: string
  logs: string[]
  errorMessage: string
  createdAt: string
  updatedAt: string
}

export interface DigitalTwinLogEntry {
  id: string
  level: 'info' | 'warning' | 'error'
  message: string
  createdAt: string
}

export interface HistoryEvent {
  id: string
  projectId: string
  eventType: string
  title: string
  body: string
  occurredAt: string
  createdAt: string
}

export interface StageTimeEntry {
  id: string
  projectId: string
  stageId: string
  stageName: string
  enteredAt: string
  exitedAt: string | null
  durationSeconds: number
}

export interface ProjectDetail {
  project: VehicleProject
  checklist: ChecklistItem[]
  costs: CostEntry[]
  media: ProjectMedia[]
  history: HistoryEvent[]
  stageTimes: StageTimeEntry[]
}

export interface InspectionRun {
  id: string
  projectId: string
  status: InspectionRunStatus
  progress: number
  modelName: string
  summary: string
  restorationEstimate: number
  assetsTotal: number
  processedAssets: number
  componentCount: number
  damageCount: number
  missingPartCount: number
  possibleModificationCount: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
  errorMessage: string
}

export interface InspectionAsset {
  id: string
  runId: string
  projectId: string
  kind: InspectionAssetKind
  filename: string
  mimeType: string
  mediaUrl: string
  frameTimestampSeconds: number | null
  capturedAt: string | null
  createdAt: string
  componentCount: number
  damageCount: number
}

export interface InspectionFinding {
  id: string
  runId: string
  assetId: string
  projectId: string
  findingType: InspectionFindingType
  workCategory: ChecklistSection
  name: string
  description: string
  confidence: number
  boundingBox: BoundingBox | null
  reviewStatus: InspectionReviewStatus
  suggestedAction: string
  checklistTitle: string
  createdChecklistItemId: string | null
  mediaUrl: string
  createdAt: string
  reviewedAt: string | null
}

export interface IntelligentGalleryFilter {
  projectId: string
  findingType?: InspectionFindingType
  workCategory?: ChecklistSection
  reviewStatus?: InspectionReviewStatus
}

export interface InspectionDashboard {
  runs: InspectionRun[]
  assets: InspectionAsset[]
  findings: InspectionFinding[]
}

export interface ImportInspectionFilesInput {
  projectId: string
}

export interface ImportInspectionDroppedFilesInput {
  projectId: string
  filePaths: string[]
}

export interface UpdateInspectionFindingInput {
  id: string
  name?: string
  description?: string
  workCategory?: ChecklistSection
  suggestedAction?: string
  checklistTitle?: string
}

export interface Vector3Tuple {
  x: number
  y: number
  z: number
}

export interface DigitalTwinModel {
  id: string
  projectId: string
  name: string
  status: DigitalTwinStatus
  modelUrl: string
  sourceMediaCount: number
  componentCount: number
  damageCount: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface DigitalTwinLayerState {
  id: string
  digitalTwinId: string
  layer: DigitalTwinLayerKey
  visible: boolean
  opacity: number
  xrayEnabled: boolean
  updatedAt: string
}

export interface DigitalTwinComponent {
  id: string
  digitalTwinId: string
  projectId: string
  name: string
  layer: DigitalTwinLayerKey
  state: DigitalTwinComponentState
  color: string
  confidence: number
  sourceFindingId: string | null
  sourceAssetId: string | null
  sourceMediaUrl: string | null
  checklistItemIds: string[]
  pendingTaskCount: number
  costCents: number
  position: Vector3Tuple
  notes: string
  createdAt: string
  updatedAt: string
}

export interface DigitalTwinDamageMarker {
  id: string
  digitalTwinId: string
  projectId: string
  damageType: string
  severity: DigitalTwinComponentState
  confidence: number
  sourceFindingId: string | null
  sourceAssetId: string | null
  sourceMediaUrl: string | null
  position: Vector3Tuple
  createdAt: string
}

export interface DigitalTwinSnapshot {
  id: string
  digitalTwinId: string
  projectId: string
  name: string
  snapshotType: DigitalTwinSnapshotType
  componentStateJson: string
  createdAt: string
}

export interface DigitalTwinTimelineEntry {
  id: string
  title: string
  body: string
  occurredAt: string
  source: 'history' | 'snapshot'
}

export interface DigitalTwinStats {
  restorationEstimate: number
  sourceMediaCount: number
  componentCount: number
  damageCount: number
  linkedChecklistCount: number
}

export interface DigitalTwinDashboard {
  model: DigitalTwinModel | null
  layers: DigitalTwinLayerState[]
  components: DigitalTwinComponent[]
  damageMarkers: DigitalTwinDamageMarker[]
  snapshots: DigitalTwinSnapshot[]
  timeline: DigitalTwinTimelineEntry[]
  zipImports: PhotoZipImport[]
  photogrammetryJobs: PhotogrammetryJob[]
  logs: DigitalTwinLogEntry[]
  stats: DigitalTwinStats
}

export interface UpdateDigitalTwinLayerInput {
  id: string
  visible?: boolean
  opacity?: number
  xrayEnabled?: boolean
}

export interface CreateDigitalTwinSnapshotInput {
  digitalTwinId: string
  name: string
  snapshotType?: DigitalTwinSnapshotType
}

export interface VinDecodeRecord {
  id: string
  projectId: string
  vin: string
  status: OemResearchStatus
  sourceName: string
  sourceUrl: string
  make: string
  model: string
  modelYear: string
  trim: string
  bodyClass: string
  engine: string
  transmission: string
  driveType: string
  country: string
  plant: string
  equipment: string[]
  rawJson: string
  errorMessage: string
  createdAt: string
  updatedAt: string
}

export interface OemProfile {
  id: string
  projectId: string
  status: OemResearchStatus
  confidence: number
  originalColor: string
  originalInterior: string
  originalEngine: string
  originalTransmission: string
  originalEquipment: string[]
  sourceSummary: string
  createdAt: string
  updatedAt: string
}

export interface OemKnowledgeItem {
  id: string
  projectId: string | null
  make: string
  model: string
  year: number | null
  category: OemKnowledgeCategory
  title: string
  sourceName: string
  sourceUrl: string
  localFileUrl: string | null
  mimeType: string
  hash: string
  confidence: number
  metadataJson: string
  createdAt: string
}

export interface OemComparisonSuggestion {
  id: string
  projectId: string
  differenceType: OemDifferenceType
  area: ChecklistSection
  title: string
  description: string
  currentEvidence: string
  oemReference: string
  confidence: number
  status: OemSuggestionStatus
  sourceFindingId: string | null
  sourceAssetId: string | null
  sourceMediaUrl: string | null
  referenceKnowledgeId: string | null
  createdChecklistItemId: string | null
  createdAt: string
  reviewedAt: string | null
}

export interface OemDashboard {
  profile: OemProfile | null
  vinDecode: VinDecodeRecord | null
  knowledge: OemKnowledgeItem[]
  suggestions: OemComparisonSuggestion[]
  stats: {
    exteriorMatch: number
    interiorMatch: number
    mechanicalMatch: number
    generalMatch: number
    pendingSuggestions: number
    approvedSuggestions: number
    referenceCount: number
  }
}

export interface ImportOemReferenceInput {
  projectId: string
  category: OemKnowledgeCategory
  fileType: OemReferenceFileType
}

export interface ImportOemDroppedReferenceInput extends ImportOemReferenceInput {
  filePaths: string[]
}

export interface CreateOemKnowledgeItemInput {
  projectId?: string | null
  make?: string
  model?: string
  year?: number | null
  category: OemKnowledgeCategory
  title: string
  sourceName?: string
  sourceUrl?: string
  metadataJson?: string
  confidence?: number
}

export interface PlanningCostLine {
  id: string
  projectId: string
  scenario: PlanningScenario
  stageCode: PipelineStageCode
  componentName: string
  bucket: ComponentCostBucket
  description: string
  estimatedCents: number
  actualCents: number
  confidence: number
  evidence: string
  createdAt: string
  updatedAt: string
}

export interface CreatePlanningCostLineInput {
  projectId: string
  scenario: PlanningScenario
  stageCode: PipelineStageCode
  componentName?: string
  bucket: ComponentCostBucket
  description: string
  estimatedCents: number
  confidence?: number
  evidence?: string
}

export interface UpdatePlanningCostLineInput {
  id: string
  scenario?: PlanningScenario
  stageCode?: PipelineStageCode
  componentName?: string
  bucket?: ComponentCostBucket
  description?: string
  estimatedCents?: number
  confidence?: number
  evidence?: string
}

export interface PlanningScenarioSummary {
  scenario: PlanningScenario
  estimatedTotalCents: number
  investedCents: number
  pendingCents: number
  budgetVarianceCents: number
  lineCount: number
  confidence: number
}

export interface PlanningStageEstimate {
  stageCode: PipelineStageCode
  stageName: string
  estimatedSeconds: number | null
  elapsedSeconds: number
  remainingSeconds: number | null
  evidenceProjectCount: number
  delaySeconds: number
}

export interface PlanningAlert {
  id: string
  type: PlanningAlertType
  severity: RiskLevel
  title: string
  body: string
  evidence: string
  createdAt: string
}

export interface PlanningRecommendation {
  id: string
  type: PlanningRecommendationType
  priority: number
  title: string
  body: string
  evidence: string
  relatedChecklistItemIds: string[]
}

export interface WorkshopMetric {
  label: string
  value: string
  evidenceCount: number
}

export interface ComparableProjectSummary {
  projectId: string
  label: string
  totalCostCents: number
  totalElapsedSeconds: number
  completedAt: string | null
}

export interface PlanningExecutiveSummary {
  completionPercent: number
  riskLevel: RiskLevel
  investedCents: number
  estimatedPendingCents: number
  estimatedBudgetCents: number
  budgetVarianceCents: number
  elapsedSeconds: number
  estimatedRemainingSeconds: number | null
  estimatedFinishDate: string | null
}

export interface PlanningReport {
  id: string
  projectId: string
  reportType: PlanningReportType
  format: PlanningReportFormat
  status: 'pending' | 'generated' | 'failed'
  localFileUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface CreatePlanningReportInput {
  projectId: string
  reportType: PlanningReportType
  format: PlanningReportFormat
}

export interface PlanningDashboard {
  executive: PlanningExecutiveSummary
  scenarioSummaries: PlanningScenarioSummary[]
  costLines: PlanningCostLine[]
  stageEstimates: PlanningStageEstimate[]
  alerts: PlanningAlert[]
  recommendations: PlanningRecommendation[]
  workshopMetrics: WorkshopMetric[]
  comparableProjects: ComparableProjectSummary[]
  reports: PlanningReport[]
}

export interface InventoryLocation {
  id: string
  name: string
  locationType: InventoryLocationType
  notes: string
  createdAt: string
  updatedAt: string
}

export interface InventorySupplier {
  id: string
  name: string
  country: string
  contactName: string
  email: string
  phone: string
  website: string
  notes: string
  rating: number
  deliveryScore: number
  qualityScore: number
  costScore: number
  purchaseCount: number
  totalSpendCents: number
  averageDeliverySeconds: number | null
  createdAt: string
  updatedAt: string
}

export interface InventoryItemPhoto {
  id: string
  itemId: string
  filename: string
  mimeType: string
  photoUrl: string
  createdAt: string
}

export interface InventoryProjectLink {
  id: string
  itemId: string
  projectId: string
  projectLabel: string
  quantityReserved: number
  status: 'reserved' | 'installed' | 'released'
  notes: string
  createdAt: string
  updatedAt: string
}

export interface InventoryItem {
  id: string
  itemType: InventoryItemType
  name: string
  category: string
  description: string
  brand: string
  partNumber: string
  manufacturer: string
  quantity: number
  lowStockThreshold: number
  locationId: string | null
  locationName: string
  status: InventoryItemStatus
  unitCostCents: number
  supplierId: string | null
  supplierName: string
  projectLinks: InventoryProjectLink[]
  photos: InventoryItemPhoto[]
  createdAt: string
  updatedAt: string
}

export interface PurchaseOrderLine {
  id: string
  purchaseOrderId: string
  inventoryItemId: string | null
  projectId: string | null
  projectLabel: string
  description: string
  partNumber: string
  quantity: number
  unitCostCents: number
  lineTotalCents: number
  createdAt: string
}

export interface PurchaseOrder {
  id: string
  supplierId: string | null
  supplierName: string
  projectId: string | null
  projectLabel: string
  orderNumber: string
  orderedOn: string
  expectedOn: string | null
  receivedOn: string | null
  status: PurchaseOrderStatus
  subtotalCents: number
  taxCents: number
  shippingCents: number
  importCents: number
  totalCents: number
  notes: string
  lines: PurchaseOrderLine[]
  createdAt: string
  updatedAt: string
}

export interface InventoryAlert {
  id: string
  severity: RiskLevel
  title: string
  body: string
  evidence: string
  projectId: string | null
  itemId: string | null
  purchaseOrderId: string | null
}

export interface SuggestedPurchase {
  id: string
  projectId: string
  projectLabel: string
  title: string
  source: 'checklist' | 'inspection' | 'oem' | 'inventory'
  priority: number
  evidence: string
  confidence: number
  checklistItemId: string | null
}

export interface InventoryReport {
  id: string
  reportType: InventoryReportType
  status: 'generated' | 'failed'
  localFileUrl: string | null
  createdAt: string
}

export interface InventoryStats {
  itemCount: number
  totalQuantity: number
  totalValueCents: number
  reservedValueCents: number
  usedValueCents: number
  pendingValueCents: number
  activeOrderCount: number
  delayedOrderCount: number
  supplierCount: number
}

export interface InventoryDashboard {
  stats: InventoryStats
  items: InventoryItem[]
  suppliers: InventorySupplier[]
  purchaseOrders: PurchaseOrder[]
  locations: InventoryLocation[]
  alerts: InventoryAlert[]
  suggestedPurchases: SuggestedPurchase[]
  reports: InventoryReport[]
}

export interface CreateInventoryLocationInput {
  name: string
  locationType: InventoryLocationType
  notes?: string
}

export interface CreateInventorySupplierInput {
  name: string
  country?: string
  contactName?: string
  email?: string
  phone?: string
  website?: string
  notes?: string
  rating?: number
}

export interface UpdateInventorySupplierInput extends Partial<CreateInventorySupplierInput> {
  id: string
}

export interface CreateInventoryItemInput {
  itemType: InventoryItemType
  name: string
  category?: string
  description?: string
  brand?: string
  partNumber?: string
  manufacturer?: string
  quantity?: number
  lowStockThreshold?: number
  locationId?: string | null
  status?: InventoryItemStatus
  unitCostCents?: number
  supplierId?: string | null
  projectId?: string | null
  reservedQuantity?: number
}

export interface UpdateInventoryItemInput extends Partial<CreateInventoryItemInput> {
  id: string
}

export interface ReserveInventoryItemInput {
  itemId: string
  projectId: string
  quantityReserved: number
  notes?: string
}

export interface CreatePurchaseOrderInput {
  supplierId?: string | null
  projectId?: string | null
  orderNumber?: string
  orderedOn: string
  expectedOn?: string | null
  status?: PurchaseOrderStatus
  taxCents?: number
  shippingCents?: number
  importCents?: number
  notes?: string
  lines: Array<{
    inventoryItemId?: string | null
    projectId?: string | null
    description: string
    partNumber?: string
    quantity: number
    unitCostCents: number
  }>
}

export interface UpdatePurchaseOrderInput {
  id: string
  supplierId?: string | null
  projectId?: string | null
  orderNumber?: string
  orderedOn?: string
  expectedOn?: string | null
  receivedOn?: string | null
  status?: PurchaseOrderStatus
  taxCents?: number
  shippingCents?: number
  importCents?: number
  notes?: string
}

export interface CreateInventoryReportInput {
  reportType: InventoryReportType
  projectId?: string | null
}

export interface StagePrediction {
  stageCode: PipelineStageCode
  stageName: string
  estimatedRemainingSeconds: number | null
  probableDelaySeconds: number
  probableCompletionDate: string | null
  confidence: number
  dataPoints: number
  explanation: string
}

export interface PredictiveRisk {
  id: string
  type: PredictiveRiskType
  severity: RiskLevel
  title: string
  body: string
  evidence: string
  confidence: number
  projectId: string | null
}

export interface ProjectPrediction {
  projectId: string
  projectLabel: string
  stageCode: PipelineStageCode
  stageName: string
  healthScore: number
  completionPercent: number
  estimatedRemainingSeconds: number | null
  probableFinishDate: string | null
  predictedCostCents: number | null
  budgetVarianceCents: number | null
  confidence: number
  dataPoints: number
  explanation: string
  stagePredictions: StagePrediction[]
  risks: PredictiveRisk[]
}

export interface BottleneckPrediction {
  stageCode: PipelineStageCode
  stageName: string
  severity: RiskLevel
  activeCount: number
  capacity: number
  utilizationPercent: number
  averageSeconds: number | null
  blockedProjectCount: number
  confidence: number
  explanation: string
}

export interface WorkshopCapacity {
  currentCapacity: number
  maximumCapacity: number
  usedCapacity: number
  availableCapacity: number
  utilizationPercent: number
  overloadedStages: string[]
  emptyStages: string[]
  underusedStages: string[]
}

export interface WorkshopPerformance {
  completedVehicles: number
  averageCompletionSeconds: number | null
  averageCostCents: number | null
  productivityScore: number
  evidenceProjectCount: number
}

export interface OperationalRecommendation {
  id: string
  priority: number
  title: string
  body: string
  evidence: string
  confidence: number
  projectId: string | null
}

export interface SimulationCapacityChange {
  stageCode: PipelineStageCode
  capacityDelta: number
}

export interface RunOperationalSimulationInput {
  projectId?: string | null
  scenarioName?: string
  newVehicleCount?: number
  stageDelayCode?: PipelineStageCode | null
  stageDelayDays?: number
  missingPartsDelayDays?: number
  capacityChanges?: SimulationCapacityChange[]
}

export interface OperationalSimulationResult {
  id: string | null
  scenarioName: string
  projectedUtilizationPercent: number
  projectedAvailableCapacity: number
  projectedDelaySeconds: number
  overloadedStages: string[]
  recommendations: string[]
  confidence: number
  dataPoints: number
  explanation: string
  createdAt: string
}

export interface PredictiveReport {
  id: string
  reportType: PredictiveReportType
  status: 'generated' | 'failed'
  localFileUrl: string | null
  createdAt: string
}

export interface PredictiveDashboard {
  workshopScore: number
  capacity: WorkshopCapacity
  performance: WorkshopPerformance
  projectPredictions: ProjectPrediction[]
  bottlenecks: BottleneckPrediction[]
  risks: PredictiveRisk[]
  recommendations: OperationalRecommendation[]
  simulations: OperationalSimulationResult[]
  reports: PredictiveReport[]
}

export interface CreatePredictiveReportInput {
  reportType: PredictiveReportType
  projectId?: string | null
}

export interface CommandCenterKpi {
  id: string
  label: string
  value: string
  detail: string
  level: CommandCenterAlertLevel
  evidenceCount: number
}

export interface CommandCenterAlert {
  id: string
  fingerprint: string
  level: CommandCenterAlertLevel
  source: string
  title: string
  body: string
  evidence: string
  projectId: string | null
  projectLabel: string
  status: CommandCenterAlertStatus
  firstDetectedAt: string
  lastDetectedAt: string
  acknowledgedAt: string | null
}

export interface CommandCenterWorkshopArea {
  stageCode: PipelineStageCode
  stageName: string
  capacity: number
  occupied: number
  available: number
  utilizationPercent: number
  status: 'free' | 'occupied' | 'blocked' | 'overloaded'
  vehicle: VehicleProject | null
  accumulatedSeconds: number
  alertCount: number
}

export interface CommandCenterStrategicRecommendation {
  id: string
  priority: number
  title: string
  body: string
  source: string
  evidence: string
  confidence: number
  projectId: string | null
}

export interface CommandCenterProductivity {
  activeProjects: number
  completedProjects: number
  averageCompletionSeconds: number | null
  averageCostCents: number | null
  utilizationPercent: number
  workshopScore: number
  productivityScore: number
  evidenceProjectCount: number
}

export interface CommandCenterSummary {
  id: string
  summaryType: CommandCenterSummaryType
  title: string
  body: string
  metrics: string[]
  generatedAt: string
}

export interface CommandCenterKnowledgeResult {
  id: string
  category: CommandCenterKnowledgeCategory
  title: string
  source: string
  detail: string
  projectId: string | null
  projectLabel: string
  createdAt: string
  relevance: number
}

export interface CommandCenterAuditEntry {
  id: string
  eventType: string
  title: string
  body: string
  source: string
  projectId: string | null
  projectLabel: string
  occurredAt: string
}

export interface CommandCenterDashboard {
  mode: CommandCenterMode
  generatedAt: string
  stats: DashboardStats
  kpis: CommandCenterKpi[]
  alerts: CommandCenterAlert[]
  recommendations: CommandCenterStrategicRecommendation[]
  workshopMap: CommandCenterWorkshopArea[]
  productivity: CommandCenterProductivity
  dailySummary: CommandCenterSummary
  weeklySummary: CommandCenterSummary
  knowledge: CommandCenterKnowledgeResult[]
  auditTrail: CommandCenterAuditEntry[]
  projects: VehicleProject[]
  predictive: PredictiveDashboard
  inventory: InventoryDashboard
  copilot: CopilotDashboard
}

export interface SearchCommandCenterKnowledgeInput {
  query: string
  limit?: number
}

export interface GenerateCommandCenterSummaryInput {
  summaryType: CommandCenterSummaryType
}

export interface DatabaseResetResult {
  deletedRows: number
  storageCleared: boolean
  resetAt: string
}

export interface CopilotConversation {
  id: string
  projectId: string | null
  title: string
  mode: CopilotMode
  createdAt: string
  updatedAt: string
}

export interface CopilotSource {
  label: string
  detail: string
}

export interface CopilotDigitalTwinFocus {
  componentIds: string[]
  damageMarkerIds: string[]
  layer?: DigitalTwinLayerKey
  reason: string
}

export interface CopilotMessage {
  id: string
  conversationId: string
  projectId: string | null
  role: CopilotRole
  mode: CopilotMode
  content: string
  intent: CopilotIntent
  confidence: number
  sources: CopilotSource[]
  digitalTwinFocus: CopilotDigitalTwinFocus | null
  createdAt: string
}

export interface CopilotTurn {
  conversation: CopilotConversation
  userMessage: CopilotMessage
  assistantMessage: CopilotMessage
  decisionCenter: CopilotDecision[]
}

export interface SendCopilotMessageInput {
  conversationId?: string | null
  projectId?: string | null
  message: string
  mode: CopilotMode
}

export interface CopilotDecision {
  id: string
  type: CopilotDecisionType
  severity: RiskLevel
  title: string
  body: string
  evidence: string
  confidence: number
  projectId: string | null
  relatedChecklistItemIds: string[]
  digitalTwinFocus: CopilotDigitalTwinFocus | null
}

export interface CopilotDashboard {
  conversations: CopilotConversation[]
  messages: CopilotMessage[]
  decisionCenter: CopilotDecision[]
  proactiveAlerts: CopilotDecision[]
}

export interface GarageApi {
  dashboard: {
    getStats: () => Promise<DashboardStats>
  }
  pipeline: {
    getSnapshot: () => Promise<PipelineSnapshot>
    moveProject: (projectId: string, stageCode: PipelineStageCode) => Promise<VehicleProject>
  }
  projects: {
    list: (query?: string) => Promise<VehicleProject[]>
    getDetail: (id: string) => Promise<ProjectDetail>
    create: (input: CreateVehicleProjectInput) => Promise<VehicleProject>
    update: (input: UpdateVehicleProjectInput) => Promise<VehicleProject>
    pause: (id: string) => Promise<VehicleProject>
    resume: (id: string) => Promise<VehicleProject>
    archive: (id: string) => Promise<VehicleProject>
    reactivate: (id: string) => Promise<VehicleProject>
    complete: (id: string) => Promise<VehicleProject>
    delete: (id: string) => Promise<void>
  }
  checklist: {
    create: (input: CreateChecklistItemInput) => Promise<ChecklistItem>
    update: (input: UpdateChecklistItemInput) => Promise<ChecklistItem>
    delete: (id: string) => Promise<void>
  }
  costs: {
    create: (input: CreateCostEntryInput) => Promise<CostEntry>
    update: (input: UpdateCostEntryInput) => Promise<CostEntry>
    delete: (id: string) => Promise<void>
  }
  media: {
    importPhotos: (input: ImportProjectPhotosInput) => Promise<ProjectMedia[]>
    importPhotoZip: (input: ImportProjectPhotoZipInput) => Promise<ImportProjectPhotoZipResult>
    delete: (id: string) => Promise<void>
  }
  inspection: {
    getDashboard: (projectId: string) => Promise<InspectionDashboard>
    importFiles: (input: ImportInspectionFilesInput) => Promise<InspectionRun | null>
    importDroppedFiles: (projectId: string, files: File[]) => Promise<InspectionRun | null>
    approveFinding: (id: string) => Promise<InspectionFinding>
    rejectFinding: (id: string) => Promise<InspectionFinding>
    updateFinding: (input: UpdateInspectionFindingInput) => Promise<InspectionFinding>
  }
  digitalTwin: {
    getDashboard: (projectId: string) => Promise<DigitalTwinDashboard>
    generate: (projectId: string) => Promise<DigitalTwinModel>
    getJobLogs: (jobId: string) => Promise<string[]>
    getJobStatus: (jobId: string) => Promise<PhotogrammetryJobStatus>
    updateLayer: (input: UpdateDigitalTwinLayerInput) => Promise<DigitalTwinLayerState>
    createSnapshot: (input: CreateDigitalTwinSnapshotInput) => Promise<DigitalTwinSnapshot>
  }
  oem: {
    getDashboard: (projectId: string) => Promise<OemDashboard>
    researchProject: (projectId: string) => Promise<OemDashboard>
    importReferences: (input: ImportOemReferenceInput) => Promise<OemKnowledgeItem[]>
    importDroppedReferences: (
      projectId: string,
      category: OemKnowledgeCategory,
      fileType: OemReferenceFileType,
      files: File[]
    ) => Promise<OemKnowledgeItem[]>
    createKnowledgeItem: (input: CreateOemKnowledgeItemInput) => Promise<OemKnowledgeItem>
    approveSuggestion: (id: string) => Promise<OemComparisonSuggestion>
    rejectSuggestion: (id: string) => Promise<OemComparisonSuggestion>
    ignoreSuggestion: (id: string) => Promise<OemComparisonSuggestion>
  }
  planning: {
    getDashboard: (projectId: string) => Promise<PlanningDashboard>
    createCostLine: (input: CreatePlanningCostLineInput) => Promise<PlanningCostLine>
    updateCostLine: (input: UpdatePlanningCostLineInput) => Promise<PlanningCostLine>
    deleteCostLine: (id: string) => Promise<void>
    generateReport: (input: CreatePlanningReportInput) => Promise<PlanningReport>
  }
  inventory: {
    getDashboard: (projectId?: string | null) => Promise<InventoryDashboard>
    createLocation: (input: CreateInventoryLocationInput) => Promise<InventoryLocation>
    createSupplier: (input: CreateInventorySupplierInput) => Promise<InventorySupplier>
    updateSupplier: (input: UpdateInventorySupplierInput) => Promise<InventorySupplier>
    createItem: (input: CreateInventoryItemInput) => Promise<InventoryItem>
    updateItem: (input: UpdateInventoryItemInput) => Promise<InventoryItem>
    deleteItem: (id: string) => Promise<void>
    reserveItem: (input: ReserveInventoryItemInput) => Promise<InventoryItem>
    importItemPhotos: (itemId: string) => Promise<InventoryItemPhoto[]>
    createPurchaseOrder: (input: CreatePurchaseOrderInput) => Promise<PurchaseOrder>
    updatePurchaseOrder: (input: UpdatePurchaseOrderInput) => Promise<PurchaseOrder>
    cancelPurchaseOrder: (id: string) => Promise<PurchaseOrder>
    completePurchaseOrder: (id: string) => Promise<PurchaseOrder>
    generateReport: (input: CreateInventoryReportInput) => Promise<InventoryReport>
  }
  predictive: {
    getDashboard: (projectId?: string | null) => Promise<PredictiveDashboard>
    runSimulation: (input: RunOperationalSimulationInput) => Promise<OperationalSimulationResult>
    generateReport: (input: CreatePredictiveReportInput) => Promise<PredictiveReport>
  }
  commandCenter: {
    getDashboard: (mode?: CommandCenterMode) => Promise<CommandCenterDashboard>
    acknowledgeAlert: (id: string) => Promise<CommandCenterAlert>
    generateSummary: (input: GenerateCommandCenterSummaryInput) => Promise<CommandCenterSummary>
    searchKnowledge: (input: SearchCommandCenterKnowledgeInput) => Promise<CommandCenterKnowledgeResult[]>
  }
  copilot: {
    getDashboard: (projectId?: string | null) => Promise<CopilotDashboard>
    sendMessage: (input: SendCopilotMessageInput) => Promise<CopilotTurn>
  }
  maintenance: {
    clearDatabase: () => Promise<DatabaseResetResult>
  }
}

export interface BlacklineElectronApi extends GarageApi {
  isElectron: true
  selectZipFile: (projectId: string, category?: MediaCategory) => Promise<ImportProjectPhotoZipResult>
}

export interface ApiErrorPayload {
  message: string
  code?: string
}

declare global {
  interface Window {
    blackline?: GarageApi
    blacklineAPI?: BlacklineElectronApi
  }
}
