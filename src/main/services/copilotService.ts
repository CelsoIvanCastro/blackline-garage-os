import type {
  CopilotDashboard,
  CopilotDecision,
  CopilotDigitalTwinFocus,
  CopilotIntent,
  CopilotMode,
  CopilotSource,
  CopilotTurn,
  DigitalTwinDashboard,
  InventoryDashboard,
  OemDashboard,
  PlanningDashboard,
  PredictiveDashboard,
  ProjectDetail,
  SendCopilotMessageInput,
  VehicleProject
} from '../../shared/types'
import { CopilotRepository } from '../repositories/copilotRepository'
import { DigitalTwinRepository } from '../repositories/digitalTwinRepository'
import { InventoryRepository } from '../repositories/inventoryRepository'
import { OemRepository } from '../repositories/oemRepository'
import { PlanningRepository } from '../repositories/planningRepository'
import { PredictiveRepository } from '../repositories/predictiveRepository'
import { ProjectRepository } from '../repositories/projectRepository'
import { PlanningIntelligenceService } from './planningIntelligenceService'

interface CopilotContext {
  projectDetail: ProjectDetail | null
  projects: VehicleProject[]
  pipelineStats: ReturnType<ProjectRepository['getDashboardStats']>
  planning: PlanningDashboard | null
  oem: OemDashboard | null
  digitalTwin: DigitalTwinDashboard | null
  inventory: InventoryDashboard | null
  predictive: PredictiveDashboard | null
}

interface AnswerDraft {
  content: string
  intent: CopilotIntent
  confidence: number
  sources: CopilotSource[]
  digitalTwinFocus: CopilotDigitalTwinFocus | null
}

export class CopilotService {
  private readonly planningService: PlanningIntelligenceService

  constructor(
    private readonly copilotRepository: CopilotRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly planningRepository: PlanningRepository,
    private readonly oemRepository: OemRepository,
    private readonly digitalTwinRepository: DigitalTwinRepository,
    private readonly inventoryRepository?: InventoryRepository,
    private readonly predictiveRepository?: PredictiveRepository
  ) {
    this.planningService = new PlanningIntelligenceService(planningRepository, projectRepository)
  }

  getDashboard(projectId?: string | null): CopilotDashboard {
    const context = this.buildContext(projectId ?? null)
    const conversations = this.copilotRepository.listConversations(projectId ?? undefined)
    const messages = conversations[0] ? this.copilotRepository.listMessages(conversations[0].id) : []
    const decisionCenter = this.buildDecisionCenter(context)

    return {
      conversations,
      messages,
      decisionCenter,
      proactiveAlerts: decisionCenter.filter((decision) => ['high', 'critical'].includes(decision.severity))
    }
  }

  sendMessage(input: SendCopilotMessageInput): CopilotTurn {
    const normalizedMessage = input.message.trim()

    if (!normalizedMessage) {
      throw new Error('Escribe una pregunta para Blackline AI.')
    }

    const projectId = input.projectId ?? null
    const mode = input.mode
    const context = this.buildContext(projectId)
    const conversation = this.copilotRepository.getOrCreateConversation(
      input.conversationId,
      projectId,
      mode,
      normalizedMessage
    )
    const intent = classifyIntent(normalizedMessage)
    const userMessage = this.copilotRepository.createMessage({
      conversationId: conversation.id,
      projectId,
      role: 'user',
      mode,
      content: normalizedMessage,
      intent,
      confidence: 1,
      sources: [],
      digitalTwinFocus: null
    })
    const answer = this.answer(intent, normalizedMessage, mode, context)
    const assistantMessage = this.copilotRepository.createMessage({
      conversationId: conversation.id,
      projectId,
      role: 'assistant',
      mode,
      content: answer.content,
      intent: answer.intent,
      confidence: answer.confidence,
      sources: answer.sources,
      digitalTwinFocus: answer.digitalTwinFocus
    })

    return {
      conversation,
      userMessage,
      assistantMessage,
      decisionCenter: this.buildDecisionCenter(context)
    }
  }

  private buildContext(projectId: string | null): CopilotContext {
    const projectDetail = projectId ? this.projectRepository.getProjectDetail(projectId) : null
    const projects = this.projectRepository.listProjects('', true)
    const pipelineStats = this.projectRepository.getDashboardStats()
    const planning = projectId ? this.planningService.getDashboard(projectId) : null
    const oem = projectDetail ? this.oemRepository.getDashboard(projectDetail) : null
    const digitalTwin = projectId ? this.digitalTwinRepository.getDashboard(projectId) : null
    const inventory = this.inventoryRepository ? this.inventoryRepository.getDashboard(projectId ?? undefined) : null
    const predictive = this.predictiveRepository ? this.predictiveRepository.getDashboard(projectId ?? undefined) : null

    return {
      projectDetail,
      projects,
      pipelineStats,
      planning,
      oem,
      digitalTwin,
      inventory,
      predictive
    }
  }

  private answer(intent: CopilotIntent, message: string, mode: CopilotMode, context: CopilotContext): AnswerDraft {
    switch (intent) {
      case 'shop_status':
        return answerShopStatus(context, mode)
      case 'next_actions':
        return answerNextActions(context, mode)
      case 'purchase_recommendation':
        return answerPurchases(context, mode)
      case 'oem_recommendation':
        return answerOem(context, mode)
      case 'time_estimate':
        return answerTime(context, mode)
      case 'cost_estimate':
        return answerCosts(context, mode)
      case 'digital_twin':
        return answerDigitalTwin(context, message, mode)
      case 'client_summary':
        return answerClientSummary(context)
      case 'technical_summary':
        return answerTechnicalSummary(context)
      case 'universal_search':
        return answerUniversalSearch(context, message, mode)
      case 'project_status':
        return answerProjectStatus(context, mode)
      default:
        return answerUnknown(context, mode)
    }
  }

  private buildDecisionCenter(context: CopilotContext): CopilotDecision[] {
    const decisions: CopilotDecision[] = []
    const projectId = context.projectDetail?.project.id ?? null

    for (const alert of context.planning?.alerts ?? []) {
      decisions.push({
        id: `alert-${alert.id}`,
        type: alert.type === 'critical_part' ? 'purchase' : alert.type === 'delay' ? 'delay' : 'risk',
        severity: alert.severity,
        title: alert.title,
        body: alert.body,
        evidence: alert.evidence,
        confidence: 0.82,
        projectId,
        relatedChecklistItemIds: [],
        digitalTwinFocus: null
      })
    }

    for (const recommendation of context.planning?.recommendations ?? []) {
      decisions.push({
        id: `recommendation-${recommendation.id}`,
        type: mapRecommendationType(recommendation.type),
        severity: recommendation.priority <= 2 ? 'high' : recommendation.priority <= 4 ? 'medium' : 'low',
        title: recommendation.title,
        body: recommendation.body,
        evidence: recommendation.evidence,
        confidence: 0.72,
        projectId,
        relatedChecklistItemIds: recommendation.relatedChecklistItemIds,
        digitalTwinFocus: null
      })
    }

    for (const suggestion of context.oem?.suggestions.filter((item) => item.status === 'pending').slice(0, 4) ?? []) {
      decisions.push({
        id: `oem-${suggestion.id}`,
        type: 'priority',
        severity: suggestion.confidence > 0.7 ? 'high' : 'medium',
        title: suggestion.title,
        body: suggestion.description,
        evidence: suggestion.oemReference,
        confidence: suggestion.confidence,
        projectId,
        relatedChecklistItemIds: suggestion.createdChecklistItemId ? [suggestion.createdChecklistItemId] : [],
        digitalTwinFocus: null
      })
    }

    for (const alert of context.inventory?.alerts.slice(0, 5) ?? []) {
      decisions.push({
        id: `inventory-${alert.id}`,
        type: alert.title.includes('Pedido') ? 'delay' : alert.title.includes('Stock') ? 'purchase' : 'priority',
        severity: alert.severity,
        title: alert.title,
        body: alert.body,
        evidence: alert.evidence,
        confidence: 0.78,
        projectId: alert.projectId ?? projectId,
        relatedChecklistItemIds: [],
        digitalTwinFocus: null
      })
    }

    for (const purchase of context.inventory?.suggestedPurchases.slice(0, 5) ?? []) {
      decisions.push({
        id: `inventory-purchase-${purchase.id}`,
        type: 'purchase',
        severity: purchase.priority <= 1 ? 'high' : 'medium',
        title: purchase.title,
        body: `Compra sugerida para ${purchase.projectLabel}`,
        evidence: purchase.evidence,
        confidence: purchase.confidence,
        projectId: purchase.projectId,
        relatedChecklistItemIds: purchase.checklistItemId ? [purchase.checklistItemId] : [],
        digitalTwinFocus: null
      })
    }

    for (const risk of context.predictive?.risks.slice(0, 6) ?? []) {
      decisions.push({
        id: `predictive-risk-${risk.id}`,
        type: risk.type === 'delay' || risk.type === 'bottleneck' ? 'delay' : risk.type === 'missing_parts' ? 'purchase' : 'risk',
        severity: risk.severity,
        title: risk.title,
        body: risk.body,
        evidence: risk.evidence,
        confidence: risk.confidence,
        projectId: risk.projectId ?? projectId,
        relatedChecklistItemIds: [],
        digitalTwinFocus: null
      })
    }

    for (const recommendation of context.predictive?.recommendations.slice(0, 5) ?? []) {
      decisions.push({
        id: `predictive-recommendation-${recommendation.id}`,
        type: recommendation.title.toLowerCase().includes('comprar') ? 'purchase' : 'priority',
        severity: recommendation.priority <= 1 ? 'high' : recommendation.priority <= 3 ? 'medium' : 'low',
        title: recommendation.title,
        body: recommendation.body,
        evidence: recommendation.evidence,
        confidence: recommendation.confidence,
        projectId: recommendation.projectId ?? projectId,
        relatedChecklistItemIds: [],
        digitalTwinFocus: null
      })
    }

    return decisions.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.confidence - a.confidence)
  }
}

function classifyIntent(message: string): CopilotIntent {
  const text = normalize(message)

  if (/(taller|activos|completados|ocupados|libres|cuello|retrasado|mas retrasado|terminaron|este ano|este año|workshop score|score taller|capacidad|saturacion|productividad)/.test(text)) {
    return 'shop_status'
  }

  if (/(que le falta|estado|como va|avance|falt(a|an))/.test(text)) {
    return 'project_status'
  }

  if (/(despues|siguiente|primero|plan|prioridad|hacer ahora|optimizar|recomienda|acelerar)/.test(text)) {
    return 'next_actions'
  }

  if (/(comprar|compra|ordenar|piezas|refacciones|inventario|pedido|pedidos|proveedor|proveedores|transito|stock)/.test(text)) {
    return 'purchase_recommendation'
  }

  if (/(oem|original|incorrecto|modificado|faltante oem)/.test(text)) {
    return 'oem_recommendation'
  }

  if (/(cuanto falta|tiempo|duracion|fecha|termina|semanas|etapa tomara|predic|probable|pronostico|forecast)/.test(text)) {
    return 'time_estimate'
  }

  if (/(costo|costos|invertido|presupuesto|financier|cuanto hemos|cuanto cost)/.test(text)) {
    return 'cost_estimate'
  }

  if (/(gemelo|3d|muestrame|mostrar|piezas danadas|piezas dañadas|pendientes|componentes)/.test(text)) {
    return 'digital_twin'
  }

  if (/(cliente|informe cliente|explica simple|resumen para cliente)/.test(text)) {
    return 'client_summary'
  }

  if (/(tecnico|diagnostico|corrosion|panel|estructural|reemplazo|restauracion)/.test(text)) {
    return 'technical_summary'
  }

  if (/(donde esta|camaro|mustang|motor|vehiculo|proyecto tiene)/.test(text)) {
    return 'universal_search'
  }

  return 'unknown'
}

function answerProjectStatus(context: CopilotContext, mode: CopilotMode): AnswerDraft {
  const detail = context.projectDetail

  if (!detail) {
    return noProjectAnswer()
  }

  const pending = detail.checklist.filter((item) => !isChecklistItemClosed(item))
  const assembled = detail.checklist.length - pending.length
  const planning = context.planning
  const lines = [
    `${vehicleLabel(detail)} esta en ${detail.project.stageName}.`,
    `Checklist: ${assembled}/${detail.checklist.length} tareas ensambladas.`,
    `Costo invertido: ${formatMoney(detail.project.totalCostCents)}.`
  ]

  if (planning) {
    lines.push(`Avance estimado: ${planning.executive.completionPercent}%. Riesgo: ${labelRisk(planning.executive.riskLevel)}.`)
  }

  if (pending.length > 0) {
    lines.push(mode === 'client' ? 'Pendientes principales:' : 'Pendientes tecnicos principales:')
    lines.push(...pending.slice(0, 5).map((item) => `- ${item.title} (${item.section})`))
  } else {
    lines.push('No hay tareas pendientes registradas en checklist.')
  }

  return {
    content: lines.join('\n'),
    intent: 'project_status',
    confidence: detail.checklist.length > 0 ? 0.88 : 0.62,
    sources: projectSources(['Proyecto', 'Checklist', 'Costos', planning ? 'Planeacion IA' : '']),
    digitalTwinFocus: null
  }
}

function answerShopStatus(context: CopilotContext, mode: CopilotMode): AnswerDraft {
  const stats = context.pipelineStats
  const delayed = context.projects.filter((project) => project.status === 'paused')
  const lines = [
    `Taller: ${stats.activeVehicles} activo(s), ${stats.pausedVehicles} pausado(s), ${stats.completedVehicles} completado(s).`,
    `Procesos: ${stats.occupiedProcesses} ocupado(s), ${stats.freeProcesses} libre(s).`,
    `Invertido acumulado: ${formatMoney(stats.totalInvestedCents)}.`
  ]

  if (context.inventory) {
    lines.push(
      `Inventario: ${context.inventory.stats.itemCount} articulo(s), ${context.inventory.stats.activeOrderCount} pedido(s) activo(s), ${context.inventory.stats.delayedOrderCount} retrasado(s).`
    )
  }

  if (context.predictive) {
    lines.push(
      `Centro predictivo: Workshop Score ${context.predictive.workshopScore}/100, utilizacion ${context.predictive.capacity.utilizationPercent}%, ${context.predictive.risks.length} riesgo(s).`
    )
  }

  if (delayed.length > 0) {
    lines.push(mode === 'client' ? 'Vehiculos detenidos:' : 'Posibles cuellos de botella:')
    lines.push(...delayed.slice(0, 5).map((project) => `- ${project.make} ${project.model}: ${project.stageName}`))
  }

  return {
    content: lines.join('\n'),
    intent: 'shop_status',
    confidence: 0.92,
    sources: projectSources(['Dashboard', 'Pipeline', 'Proyectos', context.inventory ? 'Inventario' : '', context.predictive ? 'Predictive Engine' : '']),
    digitalTwinFocus: null
  }
}

function answerNextActions(context: CopilotContext, mode: CopilotMode): AnswerDraft {
  if (!context.projectDetail) {
    return noProjectAnswer()
  }

  const recommendations = context.planning?.recommendations ?? []
  const predictiveRecommendations = context.predictive?.recommendations ?? []

  if (recommendations.length === 0 && predictiveRecommendations.length === 0) {
    return {
      content: 'No encontre recomendaciones calculadas con la informacion actual. Agrega checklist, costos o inspeccion IA para priorizar mejor.',
      intent: 'next_actions',
      confidence: 0.35,
      sources: projectSources(['Planeacion IA']),
      digitalTwinFocus: null
    }
  }

  const predictiveShown = predictiveRecommendations.slice(0, 4)
  const lines = [mode === 'client' ? 'Siguiente paso recomendado:' : 'Plan de trabajo priorizado:']
  lines.push(
    ...predictiveShown
      .map((item, index) => `${index + 1}. ${item.title}: ${item.body} (${item.evidence}, confianza ${Math.round(item.confidence * 100)}%)`)
  )
  lines.push(
    ...recommendations.slice(0, 6).map((item, index) => `${index + 1 + predictiveShown.length}. ${item.title}: ${item.body} (${item.evidence})`)
  )

  return {
    content: lines.join('\n'),
    intent: 'next_actions',
    confidence: predictiveRecommendations.length > 0 ? 0.84 : 0.78,
    sources: projectSources(['Predictive Engine', 'Planeacion IA', 'Checklist', 'Historial']),
    digitalTwinFocus: null
  }
}

function answerPurchases(context: CopilotContext, mode: CopilotMode): AnswerDraft {
  const detail = context.projectDetail

  if (!detail) {
    const inventory = context.inventory
    const activeOrders = inventory?.purchaseOrders.filter((order) => !['received', 'canceled'].includes(order.status)) ?? []
    const suggestions = inventory?.suggestedPurchases ?? []

    return {
      content:
        inventory && (activeOrders.length > 0 || suggestions.length > 0)
          ? [
              `Inventario general: ${inventory.stats.itemCount} articulo(s), ${inventory.stats.activeOrderCount} pedido(s) activo(s), ${inventory.stats.delayedOrderCount} retrasado(s).`,
              activeOrders.length > 0 ? 'Pedidos en camino:' : 'No hay pedidos activos registrados.',
              ...activeOrders.slice(0, 5).map((order) => `- ${order.orderNumber || order.lines[0]?.description || order.id}: ${order.status}`),
              suggestions.length > 0 ? 'Compras sugeridas:' : 'Sin compras sugeridas con evidencia local.',
              ...suggestions.slice(0, 5).map((item) => `- ${item.title} para ${item.projectLabel} (${item.evidence})`)
            ].join('\n')
          : 'No hay inventario, pedidos o compras sugeridas suficientes para responder.',
      intent: 'purchase_recommendation',
      confidence: inventory && (activeOrders.length > 0 || suggestions.length > 0) ? 0.76 : 0.35,
      sources: projectSources(['Inventario', 'Compras', 'Proveedores']),
      digitalTwinFocus: null
    }
  }

  const purchaseTasks = detail.checklist.filter((item) => {
    const text = normalize(`${item.title} ${item.notes}`)
    return !isChecklistItemClosed(item) && /(compr|pieza|falt|orden|refaccion|emblema|faro|radio|volante)/.test(text)
  })
  const oemPurchase = context.oem?.suggestions.filter((item) => item.status === 'pending' && item.differenceType === 'missing_component') ?? []
  const inventoryItems = context.inventory?.items ?? []
  const inventorySuggestions = context.inventory?.suggestedPurchases.filter((item) => item.projectId === detail.project.id) ?? []
  const activeOrders = context.inventory?.purchaseOrders.filter((order) => !['received', 'canceled'].includes(order.status)) ?? []
  const lines = [mode === 'client' ? 'Compras sugeridas:' : 'Lista de compras priorizada por evidencia local:']

  if (purchaseTasks.length === 0 && oemPurchase.length === 0 && inventorySuggestions.length === 0 && activeOrders.length === 0) {
    lines.push('No encontre compras criticas registradas. Revisa inspeccion IA/OEM o agrega tareas al checklist para mejorar esta lista.')
  } else {
    if (inventoryItems.length > 0) {
      lines.push('Inventario/reservas del proyecto:')
      lines.push(...inventoryItems.slice(0, 5).map((item) => `- ${item.name}: ${item.status}, ${item.quantity} disponible(s)`))
    }
    if (activeOrders.length > 0) {
      lines.push('Pedidos relacionados:')
      lines.push(
        ...activeOrders
          .slice(0, 5)
          .map((order) => `- ${order.orderNumber || order.lines[0]?.description || order.id}: ${order.status}, ${formatMoney(order.totalCents)}`)
      )
    }
    lines.push(...inventorySuggestions.slice(0, 5).map((item) => `- ${item.title} (${item.evidence})`))
    lines.push(...purchaseTasks.slice(0, 5).map((item) => `- ${item.title} (${item.section})`))
    lines.push(...oemPurchase.slice(0, 4).map((item) => `- ${item.title} / confianza ${Math.round(item.confidence * 100)}%`))
  }

  return {
    content: lines.join('\n'),
    intent: 'purchase_recommendation',
    confidence: purchaseTasks.length + oemPurchase.length + inventorySuggestions.length + activeOrders.length > 0 ? 0.82 : 0.38,
    sources: projectSources(['Inventario', 'Compras', 'Checklist', 'Comparacion OEM']),
    digitalTwinFocus: null
  }
}

function answerOem(context: CopilotContext, mode: CopilotMode): AnswerDraft {
  if (!context.projectDetail) {
    return noProjectAnswer()
  }

  const oem = context.oem
  const pending = oem?.suggestions.filter((item) => item.status === 'pending') ?? []
  const lines = [
    `Coincidencia OEM general: ${oem?.stats.generalMatch ?? 0}%.`,
    `Exterior ${oem?.stats.exteriorMatch ?? 0}%, interior ${oem?.stats.interiorMatch ?? 0}%, mecanica ${oem?.stats.mechanicalMatch ?? 0}%.`
  ]

  if (pending.length > 0) {
    lines.push(mode === 'client' ? 'Diferencias por revisar:' : 'Diferencias OEM pendientes con confianza:')
    lines.push(...pending.slice(0, 6).map((item) => `- ${item.title}: ${Math.round(item.confidence * 100)}% (${item.oemReference})`))
  } else {
    lines.push('No hay diferencias OEM pendientes registradas.')
  }

  return {
    content: lines.join('\n'),
    intent: 'oem_recommendation',
    confidence: oem && (oem.knowledge.length > 0 || pending.length > 0) ? 0.76 : 0.42,
    sources: projectSources(['Investigador OEM', 'Biblioteca OEM']),
    digitalTwinFocus: null
  }
}

function answerTime(context: CopilotContext, mode: CopilotMode): AnswerDraft {
  if (!context.projectDetail) {
    return noProjectAnswer()
  }

  const planning = context.planning
  const predictiveProject = context.predictive?.projectPredictions.find((prediction) => prediction.projectId === context.projectDetail?.project.id)
  const longest = planning?.stageEstimates
    .filter((stage) => stage.remainingSeconds !== null)
    .sort((a, b) => (b.remainingSeconds ?? 0) - (a.remainingSeconds ?? 0))[0]
  const lines = [
    `Tiempo transcurrido: ${formatDuration(context.projectDetail.project.totalElapsedSeconds)}.`,
    `Fecha estimada: ${planning?.executive.estimatedFinishDate ? formatDate(planning.executive.estimatedFinishDate) : 'sin evidencia historica suficiente'}.`
  ]

  if (predictiveProject) {
    lines.push(
      `Prediccion operativa: ${predictiveProject.probableFinishDate ? formatDate(predictiveProject.probableFinishDate) : 'sin fecha confiable'}, confianza ${Math.round(predictiveProject.confidence * 100)}%, Health Score ${predictiveProject.healthScore}/100.`
    )
  }

  if (longest) {
    lines.push(`Etapa con mayor tiempo restante: ${longest.stageName} (${formatDuration(longest.remainingSeconds ?? 0)}).`)
  }

  return {
    content: lines.join('\n'),
    intent: 'time_estimate',
    confidence: predictiveProject ? predictiveProject.confidence : planning?.executive.estimatedRemainingSeconds === null ? 0.45 : 0.78,
    sources: projectSources(['Predictive Engine', 'Historial de etapas', 'Planeacion IA']),
    digitalTwinFocus: null
  }
}

function answerCosts(context: CopilotContext, mode: CopilotMode): AnswerDraft {
  if (!context.projectDetail) {
    return noProjectAnswer()
  }

  const project = context.projectDetail.project
  const planning = context.planning
  const expensive = planning?.costLines.sort((a, b) => b.estimatedCents - a.estimatedCents).slice(0, 4) ?? []
  const lines = [
    `Invertido: ${formatMoney(project.totalCostCents)}.`,
    `Presupuesto del proyecto: ${formatMoney(project.budgetCents)}.`,
    `Pendiente estimado intermedio: ${formatMoney(planning?.executive.estimatedPendingCents ?? 0)}.`,
    `Variacion: ${formatMoney(planning?.executive.budgetVarianceCents ?? 0)}.`
  ]

  if (expensive.length > 0) {
    lines.push(mode === 'client' ? 'Partidas principales:' : 'Componentes/partidas mas costosas:')
    lines.push(...expensive.map((line) => `- ${line.description}: ${formatMoney(line.estimatedCents)} (${line.evidence || 'sin evidencia adicional'})`))
  }

  return {
    content: lines.join('\n'),
    intent: 'cost_estimate',
    confidence: planning?.costLines.length ? 0.78 : 0.58,
    sources: projectSources(['Costos', 'Estimador de Costos']),
    digitalTwinFocus: null
  }
}

function answerDigitalTwin(context: CopilotContext, message: string, mode: CopilotMode): AnswerDraft {
  if (!context.projectDetail) {
    return noProjectAnswer()
  }

  const twin = context.digitalTwin
  const text = normalize(message)
  let components = twin?.components ?? []
  const damages = twin?.damageMarkers ?? []

  if (/danad|dañad|golpe|oxido|corrosion|rayon|grieta/.test(text)) {
    components = components.filter((component) => component.state === 'damaged')
  } else if (/pendiente|falta|comprar/.test(text)) {
    components = components.filter((component) => ['pending', 'uninspected'].includes(component.state))
  } else if (/oem|original/.test(text)) {
    const oemNames = new Set((context.oem?.suggestions ?? []).map((item) => normalize(item.title)))
    components = components.filter((component) => [...oemNames].some((name) => name.includes(normalize(component.name))))
  }

  const focus: CopilotDigitalTwinFocus | null =
    components.length > 0 || damages.length > 0
      ? {
          componentIds: components.slice(0, 12).map((component) => component.id),
          damageMarkerIds: damages.slice(0, 12).map((damage) => damage.id),
          reason: 'Consulta del Copilot sobre gemelo digital'
        }
      : null

  const lines =
    twin?.model?.status === 'ready'
      ? [
          `Gemelo digital listo con ${twin.components.length} componente(s) y ${twin.damageMarkers.length} marcador(es) de daño.`,
          components.length > 0
            ? `Voy a enfocar ${components.length} componente(s): ${components.slice(0, 5).map((item) => item.name).join(', ')}.`
            : 'No encontre componentes que coincidan con esa consulta.'
        ]
      : ['No hay gemelo digital generado para este proyecto. Genera el GLTF desde fotos/videos para poder resaltar piezas.']

  return {
    content: lines.join('\n'),
    intent: 'digital_twin',
    confidence: focus ? 0.78 : 0.42,
    sources: projectSources(['Gemelo Digital', 'Inspeccion IA', 'Comparacion OEM']),
    digitalTwinFocus: focus
  }
}

function answerClientSummary(context: CopilotContext): AnswerDraft {
  const detail = context.projectDetail

  if (!detail) {
    return noProjectAnswer()
  }

  const planning = context.planning
  const lines = [
    `Su vehiculo ${detail.project.make} ${detail.project.model} presenta un avance estimado de ${planning?.executive.completionPercent ?? 0}%.`,
    `Actualmente se encuentra en la etapa ${detail.project.stageName}.`,
    planning?.executive.estimatedFinishDate
      ? `Con la informacion disponible, la fecha probable de finalizacion es ${formatDate(planning.executive.estimatedFinishDate)}.`
      : 'Aun no hay historial suficiente para estimar una fecha confiable.',
    `Inversion registrada: ${formatMoney(detail.project.totalCostCents)}.`
  ]

  return {
    content: lines.join('\n'),
    intent: 'client_summary',
    confidence: 0.72,
    sources: projectSources(['Proyecto', 'Planeacion IA', 'Costos']),
    digitalTwinFocus: null
  }
}

function answerTechnicalSummary(context: CopilotContext): AnswerDraft {
  const detail = context.projectDetail

  if (!detail) {
    return noProjectAnswer()
  }

  const damageCount = context.digitalTwin?.damageMarkers.length ?? 0
  const inspectionEvidence = context.digitalTwin?.damageMarkers.slice(0, 5).map((item) => item.damageType) ?? []
  const lines = [
    `Diagnostico tecnico basado en evidencia local para ${vehicleLabel(detail)}:`,
    `- Etapa actual: ${detail.project.stageName}.`,
    `- Daños/marcadores registrados: ${damageCount}.`
  ]

  if (inspectionEvidence.length > 0) {
    lines.push(`- Evidencia visual: ${inspectionEvidence.join(', ')}.`)
    lines.push('Opinion: revisar reparacion vs reemplazo en las zonas marcadas antes de avanzar de etapa. Confianza media, depende de inspeccion humana.')
  } else {
    lines.push('- No hay marcadores de daño suficientes para emitir una opinion tecnica visual.')
  }

  return {
    content: lines.join('\n'),
    intent: 'technical_summary',
    confidence: damageCount > 0 ? 0.66 : 0.34,
    sources: projectSources(['Inspeccion IA', 'Gemelo Digital', 'Historial']),
    digitalTwinFocus: context.digitalTwin?.damageMarkers.length
      ? {
          componentIds: [],
          damageMarkerIds: context.digitalTwin.damageMarkers.slice(0, 12).map((marker) => marker.id),
          reason: 'Diagnostico tecnico del Copilot'
        }
      : null
  }
}

function answerUniversalSearch(context: CopilotContext, message: string, mode: CopilotMode): AnswerDraft {
  const text = normalize(message)
  const matchingProjects = context.projects.filter((project) =>
    normalize([project.make, project.model, project.year?.toString() ?? '', project.submodel, project.vin].join(' ')).includes(text)
  )
  const costQuery = /motor|pintura|radio|faro|emblema/.exec(text)?.[0]

  if (matchingProjects.length > 0) {
    return {
      content: matchingProjects
        .slice(0, 5)
        .map((project) => `${project.make} ${project.model} esta en ${project.stageName}, estado ${project.status}.`)
        .join('\n'),
      intent: 'universal_search',
      confidence: 0.82,
      sources: projectSources(['Busqueda de proyectos', 'Pipeline']),
      digitalTwinFocus: null
    }
  }

  if (costQuery && context.projectDetail) {
    const costs = context.projectDetail.costs.filter((cost) => normalize(cost.concept).includes(costQuery))

    return {
      content:
        costs.length > 0
          ? costs.map((cost) => `${cost.concept}: ${formatMoney(cost.amountCents)} (${formatDate(cost.occurredOn)})`).join('\n')
          : `No encontre costos registrados que coincidan con "${costQuery}" en el proyecto abierto.`,
      intent: 'universal_search',
      confidence: costs.length > 0 ? 0.78 : 0.4,
      sources: projectSources(['Costos']),
      digitalTwinFocus: null
    }
  }

  if (context.inventory) {
    const inventoryMatches = context.inventory.items.filter((item) =>
      normalize(`${item.name} ${item.partNumber} ${item.supplierName} ${item.projectLinks.map((link) => link.projectLabel).join(' ')}`).includes(text)
    )
    const orderMatches = context.inventory.purchaseOrders.filter((order) =>
      normalize(`${order.orderNumber} ${order.supplierName} ${order.projectLabel} ${order.lines.map((line) => line.description).join(' ')}`).includes(text)
    )

    if (inventoryMatches.length > 0 || orderMatches.length > 0) {
      return {
        content: [
          ...inventoryMatches
            .slice(0, 5)
            .map((item) => `${item.name}: ${item.status}, ${item.quantity} disponible(s), ubicacion ${item.locationName || 'sin ubicacion'}.`),
          ...orderMatches
            .slice(0, 5)
            .map((order) => `${order.orderNumber || order.id}: ${order.status}, proveedor ${order.supplierName || 'sin proveedor'}.`)
        ].join('\n'),
        intent: 'universal_search',
        confidence: 0.78,
        sources: projectSources(['Inventario', 'Compras', 'Proveedores']),
        digitalTwinFocus: null
      }
    }
  }

  return {
    content: mode === 'client' ? 'No encontre informacion suficiente para responder eso.' : 'No encontre coincidencias en proyectos, costos o contexto abierto.',
    intent: 'universal_search',
    confidence: 0.25,
    sources: projectSources(['Busqueda local']),
    digitalTwinFocus: null
  }
}

function answerUnknown(context: CopilotContext, mode: CopilotMode): AnswerDraft {
  if (context.projectDetail) {
    return answerProjectStatus(context, mode)
  }

  return answerShopStatus(context, mode)
}

function noProjectAnswer(): AnswerDraft {
  return {
    content: 'Selecciona un proyecto o pregunta por el taller completo. Sin proyecto abierto no puedo inferir a que vehiculo te refieres.',
    intent: 'unknown',
    confidence: 0.2,
    sources: [],
    digitalTwinFocus: null
  }
}

function projectSources(labels: string[]): CopilotSource[] {
  return labels
    .filter(Boolean)
    .map((label) => ({
      label,
      detail: 'Dato local de BLACKLINE GARAGE OS'
    }))
}

function vehicleLabel(detail: ProjectDetail): string {
  return [detail.project.year, detail.project.make, detail.project.model, detail.project.submodel].filter(Boolean).join(' ')
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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

  return `${hours}h`
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(value))
}

function labelRisk(value: string): string {
  const labels: Record<string, string> = {
    low: 'bajo',
    medium: 'medio',
    high: 'alto',
    critical: 'critico'
  }

  return labels[value] ?? value
}

function severityRank(value: string): number {
  const ranks: Record<string, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4
  }

  return ranks[value] ?? 0
}

function isChecklistItemClosed(item: ProjectDetail['checklist'][number]): boolean {
  return item.status === 'assembled' || item.status === 'completed'
}

function mapRecommendationType(value: string): CopilotDecision['type'] {
  switch (value) {
    case 'cost':
      return 'risk'
    case 'duration':
      return 'delay'
    case 'dependency':
      return 'priority'
    case 'risk':
      return 'risk'
    default:
      return 'next_action'
  }
}
