import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  CopilotConversation,
  CopilotDigitalTwinFocus,
  CopilotIntent,
  CopilotMessage,
  CopilotMode,
  CopilotRole,
  CopilotSource
} from '../../shared/types'

type ConversationRow = {
  id: string
  project_id: string | null
  title: string
  mode: CopilotMode
  created_at: string
  updated_at: string
}

type MessageRow = {
  id: string
  conversation_id: string
  project_id: string | null
  role: CopilotRole
  mode: CopilotMode
  content: string
  intent: CopilotIntent
  confidence: number
  sources_json: string
  digital_twin_focus_json: string
  created_at: string
}

export interface CreateCopilotMessageInput {
  conversationId: string
  projectId: string | null
  role: CopilotRole
  mode: CopilotMode
  content: string
  intent: CopilotIntent
  confidence: number
  sources: CopilotSource[]
  digitalTwinFocus: CopilotDigitalTwinFocus | null
}

export class CopilotRepository {
  constructor(private readonly database: Database.Database) {}

  getOrCreateConversation(
    conversationId: string | null | undefined,
    projectId: string | null,
    mode: CopilotMode,
    titleSeed: string
  ): CopilotConversation {
    if (conversationId) {
      const existing = this.getConversation(conversationId)
      this.touchConversation(existing.id, mode)
      return { ...existing, mode }
    }

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    this.database
      .prepare(
        `
        INSERT INTO copilot_conversations (
          id, project_id, title, mode, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `
      )
      .run(id, projectId, createTitle(titleSeed), mode, now, now)

    return this.getConversation(id)
  }

  listConversations(projectId?: string | null): CopilotConversation[] {
    const rows =
      projectId === undefined
        ? (this.database
            .prepare('SELECT * FROM copilot_conversations ORDER BY updated_at DESC LIMIT 20')
            .all() as ConversationRow[])
        : (this.database
            .prepare(
              `
              SELECT *
              FROM copilot_conversations
              WHERE project_id IS ?
              ORDER BY updated_at DESC
              LIMIT 20
            `
            )
            .all(projectId) as ConversationRow[])

    return rows.map(mapConversation)
  }

  listMessages(conversationId: string, limit = 50): CopilotMessage[] {
    const rows = this.database
      .prepare(
        `
        SELECT *
        FROM copilot_messages
        WHERE conversation_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `
      )
      .all(conversationId, limit) as MessageRow[]

    return rows.reverse().map(mapMessage)
  }

  listRecentMessages(projectId?: string | null, limit = 40): CopilotMessage[] {
    const rows =
      projectId === undefined
        ? (this.database
            .prepare('SELECT * FROM copilot_messages ORDER BY created_at DESC LIMIT ?')
            .all(limit) as MessageRow[])
        : (this.database
            .prepare(
              `
              SELECT *
              FROM copilot_messages
              WHERE project_id IS ?
              ORDER BY created_at DESC
              LIMIT ?
            `
            )
            .all(projectId, limit) as MessageRow[])

    return rows.reverse().map(mapMessage)
  }

  createMessage(input: CreateCopilotMessageInput): CopilotMessage {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    this.database
      .prepare(
        `
        INSERT INTO copilot_messages (
          id, conversation_id, project_id, role, mode, content, intent, confidence,
          sources_json, digital_twin_focus_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.conversationId,
        input.projectId,
        input.role,
        input.mode,
        input.content,
        input.intent,
        input.confidence,
        JSON.stringify(input.sources),
        input.digitalTwinFocus ? JSON.stringify(input.digitalTwinFocus) : '',
        now
      )

    this.touchConversation(input.conversationId, input.mode)
    return this.getMessage(id)
  }

  private getConversation(id: string): CopilotConversation {
    const row = this.database.prepare('SELECT * FROM copilot_conversations WHERE id = ?').get(id) as ConversationRow | undefined

    if (!row) {
      throw new Error('Conversacion no encontrada.')
    }

    return mapConversation(row)
  }

  private getMessage(id: string): CopilotMessage {
    const row = this.database.prepare('SELECT * FROM copilot_messages WHERE id = ?').get(id) as MessageRow | undefined

    if (!row) {
      throw new Error('Mensaje no encontrado.')
    }

    return mapMessage(row)
  }

  private touchConversation(id: string, mode: CopilotMode): void {
    this.database
      .prepare('UPDATE copilot_conversations SET mode = ?, updated_at = ? WHERE id = ?')
      .run(mode, new Date().toISOString(), id)
  }
}

function mapConversation(row: ConversationRow): CopilotConversation {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    mode: row.mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapMessage(row: MessageRow): CopilotMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    projectId: row.project_id,
    role: row.role,
    mode: row.mode,
    content: row.content,
    intent: row.intent,
    confidence: row.confidence,
    sources: parseJson<CopilotSource[]>(row.sources_json, []),
    digitalTwinFocus: row.digital_twin_focus_json
      ? parseJson<CopilotDigitalTwinFocus | null>(row.digital_twin_focus_json, null)
      : null,
    createdAt: row.created_at
  }
}

function createTitle(sourceText: string): string {
  const normalized = sourceText.trim().replace(/\s+/g, ' ')
  return normalized.length > 42 ? `${normalized.slice(0, 39)}...` : normalized || 'Blackline AI'
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
