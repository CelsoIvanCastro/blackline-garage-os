import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, dialog } from 'electron'
import type {
  ChecklistSection,
  CreateOemKnowledgeItemInput,
  ImportOemDroppedReferenceInput,
  ImportOemReferenceInput,
  OemDashboard,
  OemKnowledgeCategory,
  OemKnowledgeItem,
  OemReferenceFileType,
  OemSuggestionStatus,
  ProjectDetail,
  VinDecodeRecord
} from '../../shared/types'
import { OemRepository, type CreateOemSuggestionInput } from '../repositories/oemRepository'
import { ProjectRepository } from '../repositories/projectRepository'

const nhtsaSourceName = 'NHTSA vPIC'
const nhtsaEndpoint = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended'

type VpicResponse = {
  Count?: number
  Message?: string
  Results?: Array<Record<string, string | null | undefined>>
}

export class OemResearchService {
  constructor(
    private readonly oemRepository: OemRepository,
    private readonly projectRepository: ProjectRepository
  ) {}

  getDashboard(projectId: string): OemDashboard {
    return this.oemRepository.getDashboard(this.projectRepository.getProjectDetail(projectId))
  }

  async researchProject(projectId: string): Promise<OemDashboard> {
    const detail = this.projectRepository.getProjectDetail(projectId)
    const project = detail.project
    const now = new Date().toISOString()

    this.oemRepository.upsertProfile({
      projectId,
      status: 'running',
      confidence: 0,
      originalColor: '',
      originalInterior: '',
      originalEngine: '',
      originalTransmission: '',
      originalEquipment: [],
      sourceSummary: 'Investigacion en proceso'
    })
    this.oemRepository.addHistoryEvent(projectId, 'oem_research_started', 'Investigacion OEM iniciada', project.vin || project.model, now)

    let vinDecode = this.oemRepository.getDashboard(detail).vinDecode

    if (project.vin.trim()) {
      vinDecode = await this.decodeVin(projectId, project.vin.trim())
    }

    const knowledge = this.buildKnowledgeFromEvidence(detail, vinDecode)
    const profile = this.buildProfileFromEvidence(detail, vinDecode, knowledge)
    this.oemRepository.upsertProfile(profile)
    const suggestions = this.buildSuggestions(detail, vinDecode)
    this.oemRepository.replacePendingSuggestions(projectId, suggestions)
    this.oemRepository.addHistoryEvent(
      projectId,
      'oem_research_completed',
      'Investigacion OEM actualizada',
      `${suggestions.length} sugerencia(s) generada(s)`,
      new Date().toISOString()
    )

    return this.getDashboard(projectId)
  }

  async importReferences(input: ImportOemReferenceInput): Promise<OemKnowledgeItem[]> {
    this.projectRepository.getProjectById(input.projectId)
    const result = await dialog.showOpenDialog({
      title: 'Seleccionar referencias OEM',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Referencias OEM', extensions: ['jpg', 'jpeg', 'png', 'heic', 'pdf', 'txt', 'md', 'csv'] }]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return []
    }

    return this.importReferencePaths({ ...input, filePaths: result.filePaths })
  }

  importReferencePaths(input: ImportOemDroppedReferenceInput): OemKnowledgeItem[] {
    const project = this.projectRepository.getProjectById(input.projectId)
    const directory = path.join(getOemStorageDirectory(), 'projects', input.projectId, 'references')
    fs.mkdirSync(directory, { recursive: true })
    const imported: OemKnowledgeItem[] = []

    for (const sourcePath of input.filePaths) {
      if (!fs.existsSync(sourcePath)) {
        continue
      }

      const extension = path.extname(sourcePath).toLowerCase()
      const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}${extension}`
      const destinationPath = path.join(directory, filename)
      fs.copyFileSync(sourcePath, destinationPath)
      const hash = hashFile(destinationPath)
      const item = this.oemRepository.createKnowledgeItem({
        project,
        projectId: project.id,
        category: input.category,
        title: path.basename(sourcePath),
        sourceName: 'Biblioteca local del taller',
        localPath: destinationPath,
        mimeType: inferMimeType(extension, input.fileType),
        hash,
        confidence: 0.7,
        metadataJson: JSON.stringify({ fileType: input.fileType, importedFrom: sourcePath })
      })
      imported.push(item)
    }

    if (imported.length > 0) {
      this.oemRepository.addHistoryEvent(
        input.projectId,
        'oem_references_imported',
        'Referencias OEM importadas',
        `${imported.length} archivo(s)`,
        new Date().toISOString()
      )
    }

    return imported
  }

  createKnowledgeItem(input: CreateOemKnowledgeItemInput): OemKnowledgeItem {
    const project = input.projectId ? this.projectRepository.getProjectById(input.projectId) : undefined
    const item = this.oemRepository.createKnowledgeItem({
      ...input,
      project,
      confidence: input.confidence ?? 0.6,
      sourceName: input.sourceName || 'Conocimiento local del taller'
    })

    if (input.projectId) {
      this.oemRepository.addHistoryEvent(input.projectId, 'oem_knowledge_created', 'Referencia OEM creada', item.title)
    }

    return item
  }

  approveSuggestion(id: string) {
    const suggestion = this.oemRepository.getSuggestion(id)
    let checklistItemId: string | undefined

    if (!suggestion.createdChecklistItemId) {
      const checklistItem = this.projectRepository.createChecklistItem({
        projectId: suggestion.projectId,
        section: suggestion.area,
        title: suggestion.title,
        notes: `${suggestion.description}\nReferencia OEM: ${suggestion.oemReference}\nConfianza: ${Math.round(
          suggestion.confidence * 100
        )}%`,
        status: 'pending'
      })
      checklistItemId = checklistItem.id
    }

    return this.oemRepository.markSuggestion(id, 'approved', checklistItemId)
  }

  rejectSuggestion(id: string) {
    return this.oemRepository.markSuggestion(id, 'rejected')
  }

  ignoreSuggestion(id: string) {
    return this.oemRepository.markSuggestion(id, 'ignored')
  }

  private async decodeVin(projectId: string, vin: string): Promise<VinDecodeRecord> {
    const sourceUrl = `${nhtsaEndpoint}/${encodeURIComponent(vin)}?format=json`
    const record = this.oemRepository.createVinDecode({
      projectId,
      vin,
      sourceName: nhtsaSourceName,
      sourceUrl
    })

    try {
      const payload = await fetchJsonWithTimeout(sourceUrl)
      const result = payload.Results?.[0] ?? {}
      const parsed = parseVpicResult(result)
      const hasUsefulData = Boolean(parsed.make || parsed.model || parsed.modelYear || parsed.engine || parsed.country)
      const errorText = cleanValue(result.ErrorText)
      const errorCode = cleanValue(result.ErrorCode)

      if (!hasUsefulData) {
        return this.oemRepository.failVinDecode(
          record.id,
          errorText || errorCode || payload.Message || 'NHTSA vPIC no devolvio datos utiles para este VIN.',
          JSON.stringify(payload)
        )
      }

      return this.oemRepository.completeVinDecode({
        id: record.id,
        ...parsed,
        rawJson: JSON.stringify(payload)
      })
    } catch (error) {
      return this.oemRepository.failVinDecode(
        record.id,
        error instanceof Error ? error.message : 'No se pudo consultar NHTSA vPIC.'
      )
    }
  }

  private buildKnowledgeFromEvidence(detail: ProjectDetail, vinDecode: VinDecodeRecord | null): OemKnowledgeItem[] {
    const project = detail.project
    const items: OemKnowledgeItem[] = []

    if (vinDecode?.status === 'completed') {
      const title = [vinDecode.modelYear, vinDecode.make, vinDecode.model, vinDecode.trim].filter(Boolean).join(' ')
      items.push(
        this.oemRepository.createKnowledgeItem({
          project,
          projectId: project.id,
          category: 'vin_decode',
          title: title || `VIN ${vinDecode.vin}`,
          sourceName: vinDecode.sourceName,
          sourceUrl: vinDecode.sourceUrl,
          hash: hashString(`${vinDecode.sourceName}:${vinDecode.vin}:${vinDecode.rawJson}`),
          confidence: 0.85,
          metadataJson: vinDecode.rawJson
        })
      )

      if (vinDecode.engine) {
        items.push(
          this.oemRepository.createKnowledgeItem({
            project,
            projectId: project.id,
            category: 'oem_engine',
            title: vinDecode.engine,
            sourceName: vinDecode.sourceName,
            sourceUrl: vinDecode.sourceUrl,
            hash: hashString(`${vinDecode.vin}:engine:${vinDecode.engine}`),
            confidence: 0.8,
            metadataJson: JSON.stringify({ vinDecodeId: vinDecode.id })
          })
        )
      }
    }

    if (project.oemColor.trim()) {
      items.push(
        this.oemRepository.createKnowledgeItem({
          project,
          projectId: project.id,
          category: 'oem_color',
          title: project.oemColor,
          sourceName: 'Ficha local del proyecto',
          hash: hashString(`${project.id}:oem-color:${project.oemColor}`),
          confidence: 0.55,
          metadataJson: JSON.stringify({ field: 'oemColor' })
        })
      )
    }

    return items
  }

  private buildProfileFromEvidence(
    detail: ProjectDetail,
    vinDecode: VinDecodeRecord | null,
    knowledge: OemKnowledgeItem[]
  ): Parameters<OemRepository['upsertProfile']>[0] {
    const project = detail.project
    const completedVin = vinDecode?.status === 'completed' ? vinDecode : null
    const originalColor = project.oemColor.trim()
    const sourceParts: string[] = []

    if (completedVin) {
      sourceParts.push(`${completedVin.sourceName} (${completedVin.vin})`)
    }

    if (originalColor) {
      sourceParts.push('Ficha local del proyecto: color OEM')
    }

    if (knowledge.length > 0) {
      sourceParts.push(`${knowledge.length} referencia(s) en biblioteca local`)
    }

    const confidence = Math.max(
      completedVin ? 0.78 : 0,
      originalColor ? 0.55 : 0,
      knowledge.length > 0 ? 0.45 : 0
    )

    return {
      projectId: project.id,
      status: sourceParts.length > 0 ? 'completed' : 'pending',
      confidence,
      originalColor,
      originalInterior: '',
      originalEngine: completedVin?.engine ?? '',
      originalTransmission: completedVin?.transmission ?? '',
      originalEquipment: completedVin?.equipment ?? [],
      sourceSummary: sourceParts.join(' / ')
    }
  }

  private buildSuggestions(detail: ProjectDetail, vinDecode: VinDecodeRecord | null): CreateOemSuggestionInput[] {
    const project = detail.project
    const dashboard = this.oemRepository.getDashboard(detail)
    const profile = dashboard.profile
    const suggestions: CreateOemSuggestionInput[] = []

    if (profile?.originalColor && project.currentColor && !sameText(profile.originalColor, project.currentColor)) {
      suggestions.push({
        projectId: project.id,
        differenceType: 'color_difference',
        area: 'paint',
        title: 'Posible color no OEM',
        description: `Color actual "${project.currentColor}" distinto a referencia OEM "${profile.originalColor}".`,
        currentEvidence: project.currentColor,
        oemReference: `${profile.originalColor} (${profile.sourceSummary || 'Perfil OEM local'})`,
        confidence: profile.confidence ? Math.min(0.82, profile.confidence) : 0.55
      })
    }

    if (vinDecode?.status === 'completed') {
      pushSpecMismatch(suggestions, project, 'Marca distinta al VIN', project.make, vinDecode.make, 'exterior', vinDecode)
      pushSpecMismatch(suggestions, project, 'Modelo distinto al VIN', project.model, vinDecode.model, 'exterior', vinDecode)
      pushSpecMismatch(
        suggestions,
        project,
        'Año distinto al VIN',
        project.year?.toString() ?? '',
        vinDecode.modelYear,
        'exterior',
        vinDecode
      )
    }

    for (const finding of this.oemRepository.listComparisonFindings(project.id)) {
      const hasReference = Boolean(profile?.sourceSummary || dashboard.knowledge.length > 0)

      if (!hasReference && finding.reviewStatus !== 'approved') {
        continue
      }

      suggestions.push({
        projectId: project.id,
        differenceType: finding.findingType === 'missing_part' ? 'missing_component' : 'possible_modification',
        area: finding.workCategory,
        title:
          finding.findingType === 'missing_part'
            ? `Posible faltante OEM: ${finding.name}`
            : `Posible modificacion visible: ${finding.name}`,
        description: finding.description,
        currentEvidence: `Hallazgo IA ${finding.reviewStatus}: ${finding.name}`,
        oemReference: profile?.sourceSummary || 'Referencia local pendiente de completar',
        confidence: Math.max(0.25, Math.min(0.68, finding.confidence * (finding.reviewStatus === 'approved' ? 0.78 : 0.52))),
        sourceFindingId: finding.id,
        sourceAssetId: finding.assetId
      })
    }

    return suggestions
  }
}

export function getOemStorageDirectory(): string {
  return path.join(app.getPath('userData'), 'storage', 'oem')
}

function pushSpecMismatch(
  suggestions: CreateOemSuggestionInput[],
  project: ProjectDetail['project'],
  title: string,
  currentValue: string,
  referenceValue: string,
  area: ChecklistSection,
  vinDecode: VinDecodeRecord
): void {
  if (!currentValue || !referenceValue || sameText(currentValue, referenceValue)) {
    return
  }

  suggestions.push({
    projectId: project.id,
    differenceType: 'specification_mismatch',
    area,
    title,
    description: `Dato actual "${currentValue}" distinto a decodificacion VIN "${referenceValue}".`,
    currentEvidence: currentValue,
    oemReference: `${referenceValue} (${vinDecode.sourceName})`,
    confidence: 0.86
  })
}

function parseVpicResult(result: Record<string, string | null | undefined>): Omit<CompleteVinDecodePayload, 'id' | 'rawJson'> {
  const engine = [
    cleanValue(result.EngineModel),
    cleanValue(result.EngineConfiguration),
    cleanValue(result.DisplacementL) ? `${cleanValue(result.DisplacementL)}L` : '',
    cleanValue(result.FuelTypePrimary)
  ]
    .filter(Boolean)
    .join(' / ')
  const transmission = [cleanValue(result.TransmissionStyle), cleanValue(result.TransmissionSpeeds)]
    .filter(Boolean)
    .join(' / ')
  const plant = [cleanValue(result.PlantCompanyName), cleanValue(result.PlantCity), cleanValue(result.PlantState)]
    .filter(Boolean)
    .join(' / ')
  const equipment = [
    cleanValue(result.Series),
    cleanValue(result.Trim2),
    cleanValue(result.OtherEngineInfo),
    cleanValue(result.OtherRestraintSystemInfo),
    cleanValue(result.SeatBeltsAll),
    cleanValue(result.ABS),
    cleanValue(result.AirBagLocFront)
  ].filter(Boolean)

  return {
    make: cleanValue(result.Make),
    model: cleanValue(result.Model),
    modelYear: cleanValue(result.ModelYear),
    trim: cleanValue(result.Trim),
    bodyClass: cleanValue(result.BodyClass),
    engine,
    transmission,
    driveType: cleanValue(result.DriveType),
    country: cleanValue(result.PlantCountry),
    plant,
    equipment
  }
}

type CompleteVinDecodePayload = Parameters<OemRepository['completeVinDecode']>[0]

async function fetchJsonWithTimeout(url: string): Promise<VpicResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`NHTSA vPIC respondio HTTP ${response.status}.`)
    }

    return (await response.json()) as VpicResponse
  } finally {
    clearTimeout(timeout)
  }
}

function cleanValue(value: string | null | undefined): string {
  const nextValue = String(value ?? '').trim()
  return nextValue.toLowerCase() === 'not applicable' || nextValue.toLowerCase() === 'null' ? '' : nextValue
}

function hashFile(filePath: string): string {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function hashString(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function sameText(left: string, right: string): boolean {
  return normalizeText(left) === normalizeText(right)
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function inferMimeType(extension: string, fileType: OemReferenceFileType): string {
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.heic':
      return 'image/heic'
    case '.pdf':
      return 'application/pdf'
    case '.csv':
      return 'text/csv'
    case '.txt':
    case '.md':
      return 'text/plain'
    default:
      return fileType === 'photo' ? 'image/*' : 'application/octet-stream'
  }
}
