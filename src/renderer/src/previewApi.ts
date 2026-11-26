import type {
  ChecklistItem,
  CommandCenterDashboard,
  CommandCenterMode,
  CopilotDashboard,
  CostEntry,
  CreateChecklistItemInput,
  CreateCostEntryInput,
  CreateVehicleProjectInput,
  DashboardStats,
  DigitalTwinDashboard,
  GarageApi,
  InspectionDashboard,
  InventoryDashboard,
  MediaCategory,
  OemDashboard,
  PipelineStage,
  PipelineStageCode,
  PipelineSnapshot,
  PlanningDashboard,
  PredictiveDashboard,
  ProjectDetail,
  ProjectMedia,
  ProjectStatus,
  UpdateChecklistItemInput,
  UpdateCostEntryInput,
  UpdateVehicleProjectInput,
  VehicleProject
} from '@shared/types'

const stageSeedTuples = [
  ['stage_inspection_total_general', 'inspection_total_general', 'Inspeccion Total General', 1],
  ['stage_mechanical_electrical', 'mechanical_electrical', 'Mecanica / Electrico', 2],
  ['stage_sound', 'sound', 'Sonido', 3],
  ['stage_exterior', 'exterior', 'Exterior', 4],
  ['stage_paint', 'paint', 'Pintura', 5],
  ['stage_exterior_interior_assembly', 'exterior_interior_assembly', 'Ensamblaje Exterior e Interior', 6],
  ['stage_total_detailing', 'total_detailing', 'Detallado Total', 7],
  ['stage_completed', 'completed', 'Completado', 8]
] as const

const stages: PipelineStage[] = stageSeedTuples.map(([id, code, name, position]) => ({
  id,
  code,
  name,
  position,
  capacity: 1,
  isTerminal: code === 'completed',
  projectCount: 0
}))

let projects: VehicleProject[] = []
let checklist: ChecklistItem[] = []
let costs: CostEntry[] = []

let media: ProjectMedia[] = []
const emptyInspectionDashboard: InspectionDashboard = { runs: [], assets: [], findings: [] }
const emptyDigitalTwinDashboard: DigitalTwinDashboard = {
  model: null,
  layers: [],
  components: [],
  damageMarkers: [],
  snapshots: [],
  timeline: [],
  zipImports: [],
  photogrammetryJobs: [],
  logs: [],
  stats: {
    restorationEstimate: 0,
    sourceMediaCount: 0,
    componentCount: 0,
    damageCount: 0,
    linkedChecklistCount: 0
  }
}
const emptyOemDashboard: OemDashboard = {
  profile: null,
  vinDecode: null,
  knowledge: [],
  suggestions: [],
  stats: {
    exteriorMatch: 0,
    interiorMatch: 0,
    mechanicalMatch: 0,
    generalMatch: 0,
    pendingSuggestions: 0,
    approvedSuggestions: 0,
    referenceCount: 0
  }
}
const emptyPlanningDashboard: PlanningDashboard = {
  executive: {
    completionPercent: 0,
    riskLevel: 'low',
    investedCents: 0,
    estimatedPendingCents: 0,
    estimatedBudgetCents: 0,
    budgetVarianceCents: 0,
    elapsedSeconds: 0,
    estimatedRemainingSeconds: null,
    estimatedFinishDate: null
  },
  scenarioSummaries: [
    { scenario: 'conservative', estimatedTotalCents: 0, investedCents: 0, pendingCents: 0, budgetVarianceCents: 0, lineCount: 0, confidence: 0 },
    { scenario: 'intermediate', estimatedTotalCents: 0, investedCents: 0, pendingCents: 0, budgetVarianceCents: 0, lineCount: 0, confidence: 0 },
    { scenario: 'complete_oem', estimatedTotalCents: 0, investedCents: 0, pendingCents: 0, budgetVarianceCents: 0, lineCount: 0, confidence: 0 }
  ],
  costLines: [],
  stageEstimates: [],
  alerts: [],
  recommendations: [],
  workshopMetrics: [],
  comparableProjects: [],
  reports: []
}
const emptyCopilotDashboard: CopilotDashboard = {
  conversations: [],
  messages: [],
  decisionCenter: [],
  proactiveAlerts: []
}
const emptyInventoryDashboard: InventoryDashboard = {
  stats: {
    itemCount: 0,
    totalQuantity: 0,
    totalValueCents: 0,
    reservedValueCents: 0,
    usedValueCents: 0,
    pendingValueCents: 0,
    activeOrderCount: 0,
    delayedOrderCount: 0,
    supplierCount: 0
  },
  items: [],
  suppliers: [],
  purchaseOrders: [],
  locations: [],
  alerts: [],
  suggestedPurchases: [],
  reports: []
}
const emptyPredictiveDashboard: PredictiveDashboard = {
  workshopScore: 0,
  capacity: {
    currentCapacity: 0,
    maximumCapacity: 0,
    usedCapacity: 0,
    availableCapacity: 0,
    utilizationPercent: 0,
    overloadedStages: [],
    emptyStages: [],
    underusedStages: []
  },
  performance: {
    completedVehicles: 0,
    averageCompletionSeconds: null,
    averageCostCents: null,
    productivityScore: 0,
    evidenceProjectCount: 0
  },
  projectPredictions: [],
  bottlenecks: [],
  risks: [],
  recommendations: [],
  simulations: [],
  reports: []
}

export function createPreviewApi(): GarageApi {
  return {
    dashboard: {
      getStats: async () => getStats()
    },
    pipeline: {
      getSnapshot: async () => getSnapshot(),
      moveProject: async (projectId, stageCode) => moveProject(projectId, stageCode)
    },
    projects: {
      list: async (query = '') => listProjects(query),
      getDetail: async (id) => getDetail(id),
      create: async (input) => createProject(input),
      update: async (input) => updateProject(input),
      pause: async (id) => setStatus(id, 'paused'),
      resume: async (id) => setStatus(id, 'active'),
      archive: async (id) => setStatus(id, 'archived'),
      reactivate: async (id) => setStatus(id, 'active'),
      complete: async (id) => completeProject(id),
      delete: async (id) => {
        projects = projects.filter((project) => project.id !== id)
        checklist = checklist.filter((item) => item.projectId !== id)
        costs = costs.filter((item) => item.projectId !== id)
        media = media.filter((item) => item.projectId !== id)
      }
    },
    checklist: {
      create: async (input) => createChecklistItem(input),
      update: async (input) => updateChecklistItem(input),
      delete: async (id) => {
        checklist = checklist.filter((item) => item.id !== id)
      }
    },
    costs: {
      create: async (input) => createCost(input),
      update: async (input) => updateCost(input),
      delete: async (id) => {
        costs = costs.filter((item) => item.id !== id)
      }
    },
    media: {
      importPhotos: async () => [],
      importPhotoZip: async () => ({
        imported: [],
        importedCount: 0,
        ignoredCount: 0,
        zipFilename: '',
        zipImport: null,
        analysisJob: null,
        reconstructionJob: null,
        logs: [],
        warning: null,
        message: 'No se encontró la API de Electron. Revisa preload y contextBridge.'
      }),
      delete: async (id) => {
        media = media.filter((item) => item.id !== id)
      }
    },
    inspection: {
      getDashboard: async () => emptyInspectionDashboard,
      importFiles: async () => null,
      importDroppedFiles: async () => null,
      approveFinding: async () => {
        throw new Error('La inspeccion IA requiere la app Electron para acceder a archivos locales.')
      },
      rejectFinding: async () => {
        throw new Error('La inspeccion IA requiere la app Electron para acceder a archivos locales.')
      },
      updateFinding: async () => {
        throw new Error('La inspeccion IA requiere la app Electron para acceder a archivos locales.')
      }
    },
    digitalTwin: {
      getDashboard: async () => emptyDigitalTwinDashboard,
      generate: async () => {
        throw new Error('El gemelo digital requiere la app Electron para leer archivos locales.')
      },
      getJobLogs: async () => [],
      getJobStatus: async () => 'pending',
      updateLayer: async () => {
        throw new Error('El gemelo digital requiere la app Electron para persistir capas.')
      },
      createSnapshot: async () => {
        throw new Error('El gemelo digital requiere la app Electron para persistir snapshots.')
      }
    },
    oem: {
      getDashboard: async () => emptyOemDashboard,
      researchProject: async () => {
        throw new Error('El investigador OEM requiere la app Electron para consultar VIN y guardar referencias.')
      },
      importReferences: async () => [],
      importDroppedReferences: async () => [],
      createKnowledgeItem: async () => {
        throw new Error('La biblioteca OEM requiere la app Electron para persistir referencias.')
      },
      approveSuggestion: async () => {
        throw new Error('La comparacion OEM requiere la app Electron para persistir decisiones.')
      },
      rejectSuggestion: async () => {
        throw new Error('La comparacion OEM requiere la app Electron para persistir decisiones.')
      },
      ignoreSuggestion: async () => {
        throw new Error('La comparacion OEM requiere la app Electron para persistir decisiones.')
      }
    },
    planning: {
      getDashboard: async () => emptyPlanningDashboard,
      createCostLine: async () => {
        throw new Error('El estimador de costos requiere la app Electron para persistir planeacion.')
      },
      updateCostLine: async () => {
        throw new Error('El estimador de costos requiere la app Electron para persistir planeacion.')
      },
      deleteCostLine: async () => {
        throw new Error('El estimador de costos requiere la app Electron para persistir planeacion.')
      },
      generateReport: async () => {
        throw new Error('Los reportes avanzados requieren la app Electron para escribir archivos locales.')
      }
    },
    inventory: {
      getDashboard: async () => emptyInventoryDashboard,
      createLocation: async () => {
        throw new Error('El inventario requiere la app Electron para persistir ubicaciones.')
      },
      createSupplier: async () => {
        throw new Error('El inventario requiere la app Electron para persistir proveedores.')
      },
      updateSupplier: async () => {
        throw new Error('El inventario requiere la app Electron para persistir proveedores.')
      },
      createItem: async () => {
        throw new Error('El inventario requiere la app Electron para persistir articulos.')
      },
      updateItem: async () => {
        throw new Error('El inventario requiere la app Electron para persistir articulos.')
      },
      deleteItem: async () => {
        throw new Error('El inventario requiere la app Electron para persistir articulos.')
      },
      reserveItem: async () => {
        throw new Error('El inventario requiere la app Electron para persistir reservas.')
      },
      importItemPhotos: async () => {
        throw new Error('El inventario requiere la app Electron para almacenar fotografias.')
      },
      createPurchaseOrder: async () => {
        throw new Error('Compras requiere la app Electron para persistir ordenes.')
      },
      updatePurchaseOrder: async () => {
        throw new Error('Compras requiere la app Electron para persistir ordenes.')
      },
      cancelPurchaseOrder: async () => {
        throw new Error('Compras requiere la app Electron para persistir ordenes.')
      },
      completePurchaseOrder: async () => {
        throw new Error('Compras requiere la app Electron para persistir ordenes.')
      },
      generateReport: async () => {
        throw new Error('Los reportes de inventario requieren la app Electron para escribir archivos locales.')
      }
    },
    predictive: {
      getDashboard: async () => emptyPredictiveDashboard,
      runSimulation: async () => {
        throw new Error('La simulacion operativa requiere la app Electron para leer la base local del taller.')
      },
      generateReport: async () => {
        throw new Error('Los reportes predictivos requieren la app Electron para escribir archivos locales.')
      }
    },
    commandCenter: {
      getDashboard: async (mode = 'executive') => getPreviewCommandCenter(mode),
      acknowledgeAlert: async (id) => {
        const alert = getPreviewCommandCenter('executive').alerts.find((item) => item.id === id)
        if (!alert) {
          throw new Error('Alerta no encontrada.')
        }
        return { ...alert, status: 'acknowledged', acknowledgedAt: new Date().toISOString() }
      },
      generateSummary: async ({ summaryType }) =>
        summaryType === 'weekly' ? getPreviewCommandCenter('executive').weeklySummary : getPreviewCommandCenter('executive').dailySummary,
      searchKnowledge: async ({ query }) => {
        const normalized = query.trim().toLowerCase()
        return getPreviewCommandCenter('executive').knowledge.filter((item) =>
          [item.title, item.source, item.detail, item.projectLabel].join(' ').toLowerCase().includes(normalized)
        )
      }
    },
    copilot: {
      getDashboard: async () => emptyCopilotDashboard,
      sendMessage: async () => {
        throw new Error('BLACKLINE AI COPILOT requiere la app Electron para leer la base local del taller.')
      }
    },
    maintenance: {
      clearDatabase: async () => {
        projects = []
        checklist = []
        costs = []
        media = []
        return { deletedRows: 0, storageCleared: false, resetAt: new Date().toISOString() }
      }
    }
  }
}

function getSnapshot(): PipelineSnapshot {
  const pipelineProjects = projects.filter((project) => ['active', 'paused'].includes(project.status))
  const nextStages = stages.map((stage) => ({
    ...stage,
    projectCount: pipelineProjects.filter((project) => project.status === 'active' && project.stageCode === stage.code).length
  }))

  return {
    stages: nextStages,
    projects: pipelineProjects,
    stats: getStats()
  }
}

function getPreviewCommandCenter(mode: CommandCenterMode): CommandCenterDashboard {
  const now = new Date().toISOString()
  const snapshot = getSnapshot()
  const stats = getStats()
  const alerts = projects
    .filter((project) => project.status === 'paused')
    .map((project) => ({
      id: `preview-alert-${project.id}`,
      fingerprint: `preview-paused-${project.id}`,
      level: 'important' as const,
      source: 'pipeline',
      title: 'Proyecto pausado',
      body: `${project.make} ${project.model}`,
      evidence: project.stageName,
      projectId: project.id,
      projectLabel: `${project.year ?? ''} ${project.make} ${project.model}`.trim(),
      status: 'open' as const,
      firstDetectedAt: project.updatedAt,
      lastDetectedAt: now,
      acknowledgedAt: null
    }))
  const dailySummary = {
    id: 'preview-command-daily',
    summaryType: 'daily' as const,
    title: 'Resumen ejecutivo diario',
    body: `Estado actual: ${stats.activeVehicles} activo(s), ${stats.pausedVehicles} pausado(s), ${stats.occupiedProcesses} proceso(s) ocupado(s).`,
    metrics: [`${stats.activeVehicles} activo(s)`, `${stats.pausedVehicles} pausado(s)`, `${alerts.length} alerta(s)`, 'Preview local'],
    generatedAt: now
  }
  const weeklySummary = {
    id: 'preview-command-weekly',
    summaryType: 'weekly' as const,
    title: 'Resumen ejecutivo semanal',
    body: 'Vista semanal disponible en la app Electron con historial SQLite real.',
    metrics: [`${stats.completedVehicles} completado(s)`, `${formatPreviewMoney(stats.totalInvestedCents)} invertido`, 'Sin historial Electron'],
    generatedAt: now
  }

  return {
    mode,
    generatedAt: now,
    stats,
    kpis: [
      {
        id: 'preview-score',
        label: 'Workshop Score',
        value: '0/100',
        detail: 'Requiere historial real',
        level: 'info',
        evidenceCount: 0
      },
      {
        id: 'preview-alerts',
        label: 'Riesgos activos',
        value: String(alerts.length),
        detail: `${alerts.length} alerta(s)`,
        level: alerts.length > 0 ? 'important' : 'info',
        evidenceCount: alerts.length
      },
      {
        id: 'preview-purchases',
        label: 'Compras pendientes',
        value: '0',
        detail: 'Sin compras preview',
        level: 'info',
        evidenceCount: 0
      },
      {
        id: 'preview-completed',
        label: 'Proyectos terminados',
        value: `${stats.completedVehicles}`,
        detail: `${projects.length} proyecto(s)`,
        level: 'info',
        evidenceCount: projects.length
      },
      {
        id: 'preview-budget',
        label: 'Balance operativo',
        value: formatPreviewMoney(stats.activeBudgetCents - stats.totalInvestedCents),
        detail: 'Presupuesto menos inversion',
        level: 'info',
        evidenceCount: projects.length
      }
    ],
    alerts,
    recommendations: [
      {
        id: 'preview-monitoring',
        priority: 5,
        title: 'Continuar monitoreo',
        body: 'La app Electron calculara recomendaciones desde SQLite.',
        source: 'Preview',
        evidence: 'Datos visuales de desarrollo',
        confidence: 0.4,
        projectId: null
      }
    ],
    workshopMap: snapshot.stages
      .filter((stage) => !stage.isTerminal)
      .map((stage) => {
        const vehicle = snapshot.projects.find((project) => project.stageCode === stage.code) ?? null
        return {
          stageCode: stage.code,
          stageName: stage.name,
          capacity: stage.capacity,
          occupied: stage.projectCount,
          available: Math.max(0, stage.capacity - stage.projectCount),
          utilizationPercent: stage.capacity > 0 ? Math.round((stage.projectCount / stage.capacity) * 100) : 0,
          status: stage.projectCount === 0 ? ('free' as const) : vehicle?.status === 'paused' ? ('blocked' as const) : ('occupied' as const),
          vehicle,
          accumulatedSeconds: vehicle?.currentStageSeconds ?? 0,
          alertCount: vehicle?.status === 'paused' ? 1 : 0
        }
      }),
    productivity: {
      activeProjects: stats.activeVehicles + stats.pausedVehicles,
      completedProjects: stats.completedVehicles,
      averageCompletionSeconds: null,
      averageCostCents: null,
      utilizationPercent: snapshot.stages.length > 0 ? Math.round((stats.occupiedProcesses / snapshot.stages.length) * 100) : 0,
      workshopScore: 0,
      productivityScore: 0,
      evidenceProjectCount: 0
    },
    dailySummary,
    weeklySummary,
    knowledge: projects.map((project) => ({
      id: `preview-knowledge-${project.id}`,
      category: 'project',
      title: `${project.year ?? ''} ${project.make} ${project.model}`.trim(),
      source: 'Proyecto',
      detail: project.vin || project.notes,
      projectId: project.id,
      projectLabel: `${project.make} ${project.model}`,
      createdAt: project.updatedAt,
      relevance: 70
    })),
    auditTrail: projects.map((project) => ({
      id: `preview-audit-${project.id}`,
      eventType: 'project_preview',
      title: 'Proyecto en preview',
      body: project.stageName,
      source: 'preview',
      projectId: project.id,
      projectLabel: `${project.make} ${project.model}`,
      occurredAt: project.updatedAt
    })),
    projects,
    predictive: emptyPredictiveDashboard,
    inventory: emptyInventoryDashboard,
    copilot: emptyCopilotDashboard
  }
}

function getStats(): DashboardStats {
  const snapshotStages = stages.map((stage) => ({
    ...stage,
    projectCount: projects.filter((project) => project.status === 'active' && project.stageCode === stage.code)
      .length
  }))

  return {
    activeVehicles: projects.filter((project) => project.status === 'active').length,
    completedVehicles: projects.filter((project) => project.status === 'completed').length,
    pausedVehicles: projects.filter((project) => project.status === 'paused').length,
    archivedVehicles: projects.filter((project) => project.status === 'archived').length,
    occupiedProcesses: snapshotStages.filter((stage) => stage.projectCount > 0).length,
    freeProcesses: snapshotStages.filter((stage) => stage.projectCount === 0).length,
    totalInvestedCents: projects.reduce((sum, project) => sum + project.totalCostCents, 0),
    activeBudgetCents: projects
      .filter((project) => ['active', 'paused'].includes(project.status))
      .reduce((sum, project) => sum + project.budgetCents, 0)
  }
}

function listProjects(query: string): VehicleProject[] {
  const normalized = query.trim().toLowerCase()

  if (!normalized) {
    return projects
  }

  return projects.filter((project) =>
    [project.make, project.model, project.year?.toString() ?? '', project.submodel, project.vin]
      .join(' ')
      .toLowerCase()
      .includes(normalized)
  )
}

function formatPreviewMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}

function getDetail(id: string): ProjectDetail {
  const project = findProject(id)

  return {
    project,
    checklist: checklist.filter((item) => item.projectId === id),
    costs: costs.filter((item) => item.projectId === id),
    media: media.filter((item) => item.projectId === id),
    history: [
      {
        id: `history-${id}`,
        projectId: id,
        eventType: 'project_created',
        title: 'Proyecto creado',
        body: `${project.make} ${project.model}`,
        occurredAt: project.createdAt,
        createdAt: project.createdAt
      }
    ],
    stageTimes: [
      {
        id: `stage-time-${id}`,
        projectId: id,
        stageId: project.stageId,
        stageName: project.stageName,
        enteredAt: project.currentStageEnteredAt,
        exitedAt: null,
        durationSeconds: project.currentStageSeconds
      }
    ]
  }
}

function createProject(input: CreateVehicleProjectInput): VehicleProject {
  const stageCode = input.stageCode ?? 'inspection_total_general'
  const status = input.status ?? 'active'

  if (status === 'active') {
    assertCapacity(stageCode)
  }

  const project = createPreviewProject({
    id: crypto.randomUUID(),
    stageCode,
    projectName: input.projectName ?? '',
    make: input.make,
    model: input.model,
    year: input.year ?? null,
    submodel: input.submodel ?? '',
    vin: input.vin ?? '',
    currentColor: input.currentColor ?? '',
    oemColor: input.oemColor ?? '',
    notes: input.notes ?? '',
    budgetCents: input.budgetCents ?? 0,
    totalCostCents: 0,
    status
  })

  projects = [...projects, project]
  return project
}

function updateProject(input: UpdateVehicleProjectInput): VehicleProject {
  const existing = findProject(input.id)
  const updated = { ...existing, ...input, updatedAt: new Date().toISOString() }
  projects = projects.map((project) => (project.id === updated.id ? updated : project))
  return updated
}

function moveProject(projectId: string, stageCode: PipelineStageCode): VehicleProject {
  if (stageCode === 'completed') {
    return completeProject(projectId)
  }

  const project = findProject(projectId)

  if (project.stageCode !== stageCode && project.status === 'active') {
    assertCapacity(stageCode)
  }

  const stage = getStage(stageCode)
  const now = new Date().toISOString()
  const updated = {
    ...project,
    stageId: stage.id,
    stageCode: stage.code,
    stageName: stage.name,
    currentStageEnteredAt: now,
    updatedAt: now
  }

  projects = projects.map((candidate) => (candidate.id === projectId ? updated : candidate))
  return updated
}

function completeProject(id: string): VehicleProject {
  const stage = getStage('completed')
  const now = new Date().toISOString()
  const project = findProject(id)
  const updated = {
    ...project,
    status: 'completed' as const,
    stageId: stage.id,
    stageCode: stage.code,
    stageName: stage.name,
    completedAt: now,
    exitDate: now,
    updatedAt: now
  }
  projects = projects.map((candidate) => (candidate.id === id ? updated : candidate))
  return updated
}

function setStatus(id: string, status: ProjectStatus): VehicleProject {
  const project = findProject(id)
  const now = new Date().toISOString()

  if (status === 'paused' && project.status !== 'active') {
    throw new Error('Solo los proyectos activos pueden pausarse.')
  }

  if (status === 'active' && project.status === 'archived') {
    assertCapacity(project.stageCode)
  } else if (status === 'active' && project.status !== 'paused') {
    throw new Error('Solo los proyectos pausados pueden reanudarse.')
  } else if (status === 'active') {
    assertCapacity(project.stageCode)
  }

  if (status === 'archived' && project.status === 'completed') {
    throw new Error('No se puede archivar un proyecto completado.')
  }

  const updated = {
    ...project,
    status,
    archivedAt: status === 'archived' ? now : status === 'active' ? null : project.archivedAt,
    currentStageEnteredAt: status === 'active' ? now : project.currentStageEnteredAt,
    updatedAt: now
  }
  projects = projects.map((candidate) => (candidate.id === id ? updated : candidate))
  return updated
}

function createChecklistItem(input: CreateChecklistItemInput): ChecklistItem {
  const now = new Date().toISOString()
  const item: ChecklistItem = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    section: input.section,
    title: input.title,
    status: input.status ?? 'pending',
    notes: input.notes ?? '',
    completedAt: input.status === 'assembled' || input.status === 'completed' ? now : null,
    createdAt: now,
    updatedAt: now
  }

  checklist = [...checklist, item]
  return item
}

function updateChecklistItem(input: UpdateChecklistItemInput): ChecklistItem {
  const existing = checklist.find((item) => item.id === input.id)

  if (!existing) {
    throw new Error('Tarea no encontrada.')
  }

  const now = new Date().toISOString()
  const status = input.status ?? existing.status
  const updated = {
    ...existing,
    ...input,
    status,
    completedAt: status === 'assembled' || status === 'completed' ? existing.completedAt ?? now : null,
    updatedAt: now
  }

  checklist = checklist.map((item) => (item.id === input.id ? updated : item))
  return updated
}

function createCost(input: CreateCostEntryInput): CostEntry {
  const now = new Date().toISOString()
  const item: CostEntry = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    concept: input.concept,
    amountCents: input.amountCents,
    occurredOn: input.occurredOn,
    createdAt: now,
    updatedAt: now
  }

  costs = [item, ...costs]
  projects = projects.map((project) =>
    project.id === input.projectId
      ? { ...project, totalCostCents: project.totalCostCents + input.amountCents, updatedAt: now }
      : project
  )
  return item
}

function updateCost(input: UpdateCostEntryInput): CostEntry {
  const existing = costs.find((item) => item.id === input.id)

  if (!existing) {
    throw new Error('Costo no encontrado.')
  }

  const updated = { ...existing, ...input, concept: input.concept ?? existing.concept, updatedAt: new Date().toISOString() }
  costs = costs.map((item) => (item.id === input.id ? updated : item))
  return updated
}

function createPreviewProject(input: {
  id: string
  projectName: string
  stageCode: PipelineStageCode
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
  status: ProjectStatus
}): VehicleProject {
  const stage = getStage(input.stageCode)
  const now = new Date().toISOString()

  return {
    id: input.id,
    projectName:
      input.projectName.trim() ||
      [input.year, input.make, input.model, input.submodel].filter(Boolean).join(' '),
    stageId: stage.id,
    stageCode: stage.code,
    stageName: stage.name,
    status: input.status,
    make: input.make,
    model: input.model,
    year: input.year,
    submodel: input.submodel,
    vin: input.vin,
    currentColor: input.currentColor,
    oemColor: input.oemColor,
    notes: input.notes,
    budgetCents: input.budgetCents,
    totalCostCents: input.totalCostCents,
    currentStageEnteredAt: now,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    completedAt: null,
    entryDate: now,
    exitDate: null,
    totalElapsedSeconds: 0,
    currentStageSeconds: 0
  }
}

function assertCapacity(stageCode: PipelineStageCode): void {
  const stage = getSnapshot().stages.find((candidate) => candidate.code === stageCode)

  if (!stage) {
    throw new Error('Proceso no encontrado.')
  }

  if (stage.projectCount >= stage.capacity) {
    throw new Error('El proceso seleccionado ya alcanzo su capacidad maxima.')
  }
}

function findProject(id: string): VehicleProject {
  const project = projects.find((candidate) => candidate.id === id)

  if (!project) {
    throw new Error('Proyecto no encontrado.')
  }

  return project
}

function getStage(code: PipelineStageCode): PipelineStage {
  const stage = stages.find((candidate) => candidate.code === code)

  if (!stage) {
    throw new Error('Proceso no encontrado.')
  }

  return stage
}
