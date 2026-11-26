import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  ChecklistSection,
  CreateOemKnowledgeItemInput,
  OemComparisonSuggestion,
  OemDashboard,
  OemDifferenceType,
  OemKnowledgeCategory,
  OemKnowledgeItem,
  OemProfile,
  OemResearchStatus,
  OemSuggestionStatus,
  ProjectDetail,
  VehicleProject,
  VinDecodeRecord
} from '../../shared/types'

type OemProfileRow = {
  id: string
  project_id: string
  status: OemResearchStatus
  confidence: number
  original_color: string
  original_interior: string
  original_engine: string
  original_transmission: string
  original_equipment_json: string
  source_summary: string
  created_at: string
  updated_at: string
}

type VinDecodeRow = {
  id: string
  project_id: string
  vin: string
  status: OemResearchStatus
  source_name: string
  source_url: string
  make: string
  model: string
  model_year: string
  trim: string
  body_class: string
  engine: string
  transmission: string
  drive_type: string
  country: string
  plant: string
  equipment_json: string
  raw_json: string
  error_message: string
  created_at: string
  updated_at: string
}

type KnowledgeRow = {
  id: string
  project_id: string | null
  make: string
  model: string
  year: number | null
  category: OemKnowledgeCategory
  title: string
  source_name: string
  source_url: string
  local_path: string
  mime_type: string
  hash: string
  confidence: number
  metadata_json: string
  created_at: string
}

type SuggestionRow = {
  id: string
  project_id: string
  difference_type: OemDifferenceType
  area: ChecklistSection
  title: string
  description: string
  current_evidence: string
  oem_reference: string
  confidence: number
  status: OemSuggestionStatus
  source_finding_id: string | null
  source_asset_id: string | null
  reference_knowledge_id: string | null
  created_checklist_item_id: string | null
  created_at: string
  reviewed_at: string | null
}

export interface CreateVinDecodeInput {
  projectId: string
  vin: string
  sourceName: string
  sourceUrl: string
}

export interface CompleteVinDecodeInput {
  id: string
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
}

export interface UpsertOemProfileInput {
  projectId: string
  status: OemResearchStatus
  confidence: number
  originalColor: string
  originalInterior: string
  originalEngine: string
  originalTransmission: string
  originalEquipment: string[]
  sourceSummary: string
}

export interface CreateKnowledgeRecordInput extends CreateOemKnowledgeItemInput {
  localPath?: string
  mimeType?: string
  hash?: string
  project?: VehicleProject
}

export interface CreateOemSuggestionInput {
  projectId: string
  differenceType: OemDifferenceType
  area: ChecklistSection
  title: string
  description: string
  currentEvidence: string
  oemReference: string
  confidence: number
  sourceFindingId?: string | null
  sourceAssetId?: string | null
  referenceKnowledgeId?: string | null
}

export interface OemComparisonFinding {
  id: string
  assetId: string
  findingType: 'missing_part' | 'possible_modification'
  workCategory: ChecklistSection
  name: string
  description: string
  confidence: number
  reviewStatus: 'pending' | 'approved' | 'rejected'
}

export class OemRepository {
  constructor(private readonly database: Database.Database) {}

  getDashboard(projectDetail: ProjectDetail): OemDashboard {
    const profile = this.getProfile(projectDetail.project.id)
    const vinDecode = this.getLatestVinDecode(projectDetail.project.id)
    const knowledge = this.listKnowledgeForProject(projectDetail.project)
    const suggestions = this.listSuggestions(projectDetail.project.id)

    return {
      profile,
      vinDecode,
      knowledge,
      suggestions,
      stats: buildStats(suggestions, knowledge.length)
    }
  }

  getProfile(projectId: string): OemProfile | null {
    const row = this.database
      .prepare('SELECT * FROM oem_profiles WHERE project_id = ?')
      .get(projectId) as OemProfileRow | undefined

    return row ? mapProfile(row) : null
  }

  upsertProfile(input: UpsertOemProfileInput): OemProfile {
    const existing = this.getProfile(input.projectId)
    const now = new Date().toISOString()

    if (existing) {
      this.database
        .prepare(
          `
          UPDATE oem_profiles
          SET
            status = ?,
            confidence = ?,
            original_color = ?,
            original_interior = ?,
            original_engine = ?,
            original_transmission = ?,
            original_equipment_json = ?,
            source_summary = ?,
            updated_at = ?
          WHERE project_id = ?
        `
        )
        .run(
          input.status,
          input.confidence,
          input.originalColor,
          input.originalInterior,
          input.originalEngine,
          input.originalTransmission,
          JSON.stringify(input.originalEquipment),
          input.sourceSummary,
          now,
          input.projectId
        )
    } else {
      this.database
        .prepare(
          `
          INSERT INTO oem_profiles (
            id, project_id, status, confidence, original_color, original_interior,
            original_engine, original_transmission, original_equipment_json,
            source_summary, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          crypto.randomUUID(),
          input.projectId,
          input.status,
          input.confidence,
          input.originalColor,
          input.originalInterior,
          input.originalEngine,
          input.originalTransmission,
          JSON.stringify(input.originalEquipment),
          input.sourceSummary,
          now,
          now
        )
    }

    return this.getProfile(input.projectId) as OemProfile
  }

  createVinDecode(input: CreateVinDecodeInput): VinDecodeRecord {
    const existing = this.database
      .prepare('SELECT * FROM oem_vin_decodes WHERE project_id = ? AND vin = ? AND source_name = ?')
      .get(input.projectId, input.vin, input.sourceName) as VinDecodeRow | undefined
    const now = new Date().toISOString()

    if (existing) {
      this.database
        .prepare(
          `
          UPDATE oem_vin_decodes
          SET status = 'running', error_message = '', source_url = ?, updated_at = ?
          WHERE id = ?
        `
        )
        .run(input.sourceUrl, now, existing.id)
      return this.getVinDecode(existing.id)
    }

    const id = crypto.randomUUID()
    this.database
      .prepare(
        `
        INSERT INTO oem_vin_decodes (
          id, project_id, vin, status, source_name, source_url, created_at, updated_at
        )
        VALUES (?, ?, ?, 'running', ?, ?, ?, ?)
      `
      )
      .run(id, input.projectId, input.vin, input.sourceName, input.sourceUrl, now, now)

    return this.getVinDecode(id)
  }

  completeVinDecode(input: CompleteVinDecodeInput): VinDecodeRecord {
    const now = new Date().toISOString()
    this.database
      .prepare(
        `
        UPDATE oem_vin_decodes
        SET
          status = 'completed',
          make = ?,
          model = ?,
          model_year = ?,
          trim = ?,
          body_class = ?,
          engine = ?,
          transmission = ?,
          drive_type = ?,
          country = ?,
          plant = ?,
          equipment_json = ?,
          raw_json = ?,
          error_message = '',
          updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        input.make,
        input.model,
        input.modelYear,
        input.trim,
        input.bodyClass,
        input.engine,
        input.transmission,
        input.driveType,
        input.country,
        input.plant,
        JSON.stringify(input.equipment),
        input.rawJson,
        now,
        input.id
      )

    return this.getVinDecode(input.id)
  }

  failVinDecode(id: string, errorMessage: string, rawJson = '{}'): VinDecodeRecord {
    const now = new Date().toISOString()
    this.database
      .prepare(
        `
        UPDATE oem_vin_decodes
        SET status = 'failed', error_message = ?, raw_json = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(errorMessage, rawJson, now, id)

    return this.getVinDecode(id)
  }

  getLatestVinDecode(projectId: string): VinDecodeRecord | null {
    const row = this.database
      .prepare(
        `
        SELECT *
        FROM oem_vin_decodes
        WHERE project_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `
      )
      .get(projectId) as VinDecodeRow | undefined

    return row ? mapVinDecode(row) : null
  }

  createKnowledgeItem(input: CreateKnowledgeRecordInput): OemKnowledgeItem {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const make = input.make ?? input.project?.make ?? ''
    const model = input.model ?? input.project?.model ?? ''
    const year = input.year === undefined ? input.project?.year ?? null : input.year
    const hash = input.hash ?? ''

    if (hash) {
      const existing = this.database
        .prepare('SELECT * FROM oem_knowledge_items WHERE hash = ?')
        .get(hash) as KnowledgeRow | undefined

      if (existing) {
        return mapKnowledge(existing)
      }
    }

    this.database
      .prepare(
        `
        INSERT INTO oem_knowledge_items (
          id, project_id, make, model, year, category, title, source_name, source_url,
          local_path, mime_type, hash, confidence, metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.projectId ?? input.project?.id ?? null,
        make,
        model,
        year,
        input.category,
        input.title.trim(),
        input.sourceName ?? '',
        input.sourceUrl ?? '',
        input.localPath ?? '',
        input.mimeType ?? '',
        hash,
        input.confidence ?? 0,
        input.metadataJson ?? '{}',
        now
      )

    return this.getKnowledgeItem(id)
  }

  getKnowledgeItem(id: string): OemKnowledgeItem {
    const row = this.database.prepare('SELECT * FROM oem_knowledge_items WHERE id = ?').get(id) as KnowledgeRow | undefined

    if (!row) {
      throw new Error('Referencia OEM no encontrada.')
    }

    return mapKnowledge(row)
  }

  getKnowledgeLocalPath(id: string): string {
    const row = this.database
      .prepare('SELECT local_path FROM oem_knowledge_items WHERE id = ?')
      .get(id) as { local_path: string } | undefined

    if (!row?.local_path) {
      throw new Error('Archivo OEM no encontrado.')
    }

    return row.local_path
  }

  listKnowledgeForProject(project: VehicleProject): OemKnowledgeItem[] {
    const rows = this.database
      .prepare(
        `
        SELECT *
        FROM oem_knowledge_items
        WHERE
          project_id = @projectId OR
          (
            lower(make) = lower(@make) AND
            lower(model) = lower(@model) AND
            (year IS NULL OR year = @year)
          )
        ORDER BY created_at DESC
      `
      )
      .all({
        projectId: project.id,
        make: project.make,
        model: project.model,
        year: project.year
      }) as KnowledgeRow[]

    return rows.map(mapKnowledge)
  }

  listComparisonFindings(projectId: string): OemComparisonFinding[] {
    const rows = this.database
      .prepare(
        `
        SELECT
          id,
          asset_id,
          finding_type,
          work_category,
          name,
          description,
          confidence,
          review_status
        FROM inspection_findings
        WHERE project_id = ?
          AND review_status != 'rejected'
          AND finding_type IN ('missing_part', 'possible_modification')
        ORDER BY created_at DESC
      `
      )
      .all(projectId) as Array<{
      id: string
      asset_id: string
      finding_type: 'missing_part' | 'possible_modification'
      work_category: ChecklistSection
      name: string
      description: string
      confidence: number
      review_status: 'pending' | 'approved' | 'rejected'
    }>

    return rows.map((row) => ({
      id: row.id,
      assetId: row.asset_id,
      findingType: row.finding_type,
      workCategory: row.work_category,
      name: row.name,
      description: row.description,
      confidence: row.confidence,
      reviewStatus: row.review_status
    }))
  }

  replacePendingSuggestions(projectId: string, suggestions: CreateOemSuggestionInput[]): void {
    const now = new Date().toISOString()
    const replace = this.database.transaction(() => {
      this.database.prepare("DELETE FROM oem_comparison_suggestions WHERE project_id = ? AND status = 'pending'").run(projectId)
      const insert = this.database.prepare(
        `
        INSERT INTO oem_comparison_suggestions (
          id, project_id, difference_type, area, title, description, current_evidence,
          oem_reference, confidence, source_finding_id, source_asset_id,
          reference_knowledge_id, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )

      for (const suggestion of dedupeSuggestions(suggestions)) {
        insert.run(
          crypto.randomUUID(),
          projectId,
          suggestion.differenceType,
          suggestion.area,
          suggestion.title,
          suggestion.description,
          suggestion.currentEvidence,
          suggestion.oemReference,
          suggestion.confidence,
          suggestion.sourceFindingId ?? null,
          suggestion.sourceAssetId ?? null,
          suggestion.referenceKnowledgeId ?? null,
          now
        )
      }
    })

    replace()
  }

  listSuggestions(projectId: string): OemComparisonSuggestion[] {
    const rows = this.database
      .prepare(
        `
        SELECT *
        FROM oem_comparison_suggestions
        WHERE project_id = ?
        ORDER BY
          CASE status
            WHEN 'pending' THEN 1
            WHEN 'approved' THEN 2
            WHEN 'ignored' THEN 3
            ELSE 4
          END,
          confidence DESC,
          created_at DESC
      `
      )
      .all(projectId) as SuggestionRow[]

    return rows.map(mapSuggestion)
  }

  getSuggestion(id: string): OemComparisonSuggestion {
    const row = this.database
      .prepare('SELECT * FROM oem_comparison_suggestions WHERE id = ?')
      .get(id) as SuggestionRow | undefined

    if (!row) {
      throw new Error('Sugerencia OEM no encontrada.')
    }

    return mapSuggestion(row)
  }

  markSuggestion(id: string, status: OemSuggestionStatus, checklistItemId?: string): OemComparisonSuggestion {
    const existing = this.getSuggestion(id)
    const now = new Date().toISOString()

    this.database
      .prepare(
        `
        UPDATE oem_comparison_suggestions
        SET status = ?, created_checklist_item_id = ?, reviewed_at = ?
        WHERE id = ?
      `
      )
      .run(status, checklistItemId ?? existing.createdChecklistItemId, now, id)

    this.database
      .prepare(
        `
        INSERT INTO oem_decision_memory (
          id, make, model, year, normalized_key, decision, correction_json, created_at
        )
        SELECT ?, vp.make, vp.model, vp.year, ?, ?, ?, ?
        FROM vehicle_projects vp
        WHERE vp.id = ?
      `
      )
      .run(crypto.randomUUID(), normalizeText(existing.title), status, '{}', now, existing.projectId)

    this.addHistoryEvent(
      existing.projectId,
      status === 'approved' ? 'oem_suggestion_approved' : `oem_suggestion_${status}`,
      status === 'approved' ? 'Sugerencia OEM aprobada' : 'Sugerencia OEM revisada',
      existing.title,
      now
    )

    return this.getSuggestion(id)
  }

  addHistoryEvent(projectId: string, eventType: string, title: string, body: string, occurredAt = new Date().toISOString()): void {
    this.database
      .prepare(
        `
        INSERT INTO history_events (
          id, project_id, event_type, title, body, occurred_at, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(crypto.randomUUID(), projectId, eventType, title, body, occurredAt, occurredAt)
  }

  private getVinDecode(id: string): VinDecodeRecord {
    const row = this.database.prepare('SELECT * FROM oem_vin_decodes WHERE id = ?').get(id) as VinDecodeRow | undefined

    if (!row) {
      throw new Error('Decodificacion VIN no encontrada.')
    }

    return mapVinDecode(row)
  }
}

function mapProfile(row: OemProfileRow): OemProfile {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    confidence: row.confidence,
    originalColor: row.original_color,
    originalInterior: row.original_interior,
    originalEngine: row.original_engine,
    originalTransmission: row.original_transmission,
    originalEquipment: parseStringArray(row.original_equipment_json),
    sourceSummary: row.source_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapVinDecode(row: VinDecodeRow): VinDecodeRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    vin: row.vin,
    status: row.status,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    make: row.make,
    model: row.model,
    modelYear: row.model_year,
    trim: row.trim,
    bodyClass: row.body_class,
    engine: row.engine,
    transmission: row.transmission,
    driveType: row.drive_type,
    country: row.country,
    plant: row.plant,
    equipment: parseStringArray(row.equipment_json),
    rawJson: row.raw_json,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapKnowledge(row: KnowledgeRow): OemKnowledgeItem {
  return {
    id: row.id,
    projectId: row.project_id,
    make: row.make,
    model: row.model,
    year: row.year,
    category: row.category,
    title: row.title,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    localFileUrl: row.local_path ? `blackline-oem://${row.id}` : null,
    mimeType: row.mime_type,
    hash: row.hash,
    confidence: row.confidence,
    metadataJson: row.metadata_json,
    createdAt: row.created_at
  }
}

function mapSuggestion(row: SuggestionRow): OemComparisonSuggestion {
  return {
    id: row.id,
    projectId: row.project_id,
    differenceType: row.difference_type,
    area: row.area,
    title: row.title,
    description: row.description,
    currentEvidence: row.current_evidence,
    oemReference: row.oem_reference,
    confidence: row.confidence,
    status: row.status,
    sourceFindingId: row.source_finding_id,
    sourceAssetId: row.source_asset_id,
    sourceMediaUrl: row.source_asset_id ? `blackline-media://${row.source_asset_id}` : null,
    referenceKnowledgeId: row.reference_knowledge_id,
    createdChecklistItemId: row.created_checklist_item_id,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at
  }
}

function buildStats(suggestions: OemComparisonSuggestion[], referenceCount: number): OemDashboard['stats'] {
  const scoreFor = (area: ChecklistSection): number => {
    const areaSuggestions = suggestions.filter((suggestion) => suggestion.area === area && suggestion.status !== 'rejected')
    const penalty = areaSuggestions.reduce((sum, suggestion) => sum + suggestion.confidence * 18, 0)
    return Math.max(0, Math.min(100, Math.round(100 - penalty)))
  }
  const exteriorMatch = scoreFor('exterior')
  const interiorMatch = scoreFor('interior')
  const mechanicalMatch = scoreFor('mechanical')
  const generalMatch = Math.round((exteriorMatch + interiorMatch + mechanicalMatch) / 3)

  return {
    exteriorMatch,
    interiorMatch,
    mechanicalMatch,
    generalMatch,
    pendingSuggestions: suggestions.filter((suggestion) => suggestion.status === 'pending').length,
    approvedSuggestions: suggestions.filter((suggestion) => suggestion.status === 'approved').length,
    referenceCount
  }
}

function dedupeSuggestions(suggestions: CreateOemSuggestionInput[]): CreateOemSuggestionInput[] {
  const seen = new Set<string>()
  const result: CreateOemSuggestionInput[] = []

  for (const suggestion of suggestions) {
    const key = [suggestion.differenceType, suggestion.area, normalizeText(suggestion.title), suggestion.sourceFindingId ?? ''].join('|')

    if (!seen.has(key)) {
      seen.add(key)
      result.push(suggestion)
    }
  }

  return result
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
