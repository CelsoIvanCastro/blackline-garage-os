import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Bot, BrainCircuit, Crosshair, RefreshCw, Send, Wrench } from 'lucide-react'
import type {
  CopilotDashboard,
  CopilotDecision,
  CopilotDigitalTwinFocus,
  CopilotMessage,
  CopilotMode
} from '@shared/types'
import { garageApi } from '../api'

interface CopilotPanelProps {
  projectId: string
  onFocusDigitalTwin: (focus: CopilotDigitalTwinFocus) => void
}

const quickPrompts = [
  'Que le falta?',
  'Que deberia hacer despues?',
  'Que pieza debo comprar primero?',
  'Cuanto falta?',
  'Muestrame piezas danadas.',
  'Resumen para cliente.'
]

const emptyDashboard: CopilotDashboard = {
  conversations: [],
  messages: [],
  decisionCenter: [],
  proactiveAlerts: []
}

export function CopilotPanel({ projectId, onFocusDigitalTwin }: CopilotPanelProps) {
  const [dashboard, setDashboard] = useState<CopilotDashboard>(emptyDashboard)
  const [messages, setMessages] = useState<CopilotMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [mode, setMode] = useState<CopilotMode>('restorer')
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)

  const loadDashboard = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const nextDashboard = await garageApi.copilot.getDashboard(projectId)
      setDashboard(nextDashboard)
      setMessages(nextDashboard.messages)
      setConversationId(nextDashboard.conversations[0]?.id ?? null)
      setMode(nextDashboard.conversations[0]?.mode ?? 'restorer')
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setMessages([])
    setConversationId(null)
    void loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    const thread = threadRef.current

    if (thread) {
      thread.scrollTop = thread.scrollHeight
    }
  }, [messages.length])

  const visibleDecisions = useMemo(() => dashboard.decisionCenter.slice(0, 8), [dashboard.decisionCenter])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    await submitMessage(draft)
  }

  async function submitMessage(value: string): Promise<void> {
    const message = value.trim()

    if (!message || isSending) {
      return
    }

    setIsSending(true)
    setError(null)
    setDraft('')

    try {
      const turn = await garageApi.copilot.sendMessage({
        conversationId,
        projectId,
        message,
        mode
      })
      setConversationId(turn.conversation.id)
      setMessages((current) => [...current, turn.userMessage, turn.assistantMessage])
      setDashboard((current) => ({
        ...current,
        conversations: upsertConversation(current.conversations, turn.conversation),
        decisionCenter: turn.decisionCenter,
        proactiveAlerts: turn.decisionCenter.filter((decision) => ['high', 'critical'].includes(decision.severity))
      }))

      if (turn.assistantMessage.digitalTwinFocus) {
        onFocusDigitalTwin(turn.assistantMessage.digitalTwinFocus)
      }
    } catch (sendError) {
      setError(getErrorMessage(sendError))
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="copilot-panel">
      <div className="copilot-commandbar">
        <div>
          <p className="eyebrow">Blackline AI</p>
          <h4>BLACKLINE AI COPILOT</h4>
        </div>
        <div className="copilot-command-actions">
          <div className="segmented-control compact" role="tablist" aria-label="Modo del Copilot">
            <button className={mode === 'restorer' ? 'active' : ''} type="button" onClick={() => setMode('restorer')}>
              Restaurador
            </button>
            <button className={mode === 'client' ? 'active' : ''} type="button" onClick={() => setMode('client')}>
              Cliente
            </button>
          </div>
          <button className="icon-button" type="button" title="Actualizar" disabled={isLoading} onClick={() => void loadDashboard()}>
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {error ? <div className="system-alert">{error}</div> : null}

      <div className="copilot-summary-strip">
        <InfoTile label="Alertas" value={String(dashboard.proactiveAlerts.length)} />
        <InfoTile label="Decisiones" value={String(dashboard.decisionCenter.length)} />
        <InfoTile label="Memoria" value={String(messages.length)} />
        <InfoTile label="Modo" value={mode === 'restorer' ? 'Restaurador' : 'Cliente'} />
      </div>

      <div className="copilot-layout">
        <section className="copilot-chat">
          <div className="copilot-thread" ref={threadRef}>
            {messages.length === 0 ? (
              <div className="copilot-empty">
                <Bot size={26} aria-hidden="true" />
                <strong>Listo para consultar el proyecto abierto</strong>
                <span>Usa preguntas naturales sobre avances, costos, tiempos, OEM, compras y gemelo digital.</span>
              </div>
            ) : (
              messages.map((message) => (
                <MessageBubble key={message.id} message={message} onFocusDigitalTwin={onFocusDigitalTwin} />
              ))
            )}
          </div>

          <div className="copilot-quickbar">
            {quickPrompts.map((prompt) => (
              <button key={prompt} type="button" disabled={isSending} onClick={() => void submitMessage(prompt)}>
                {prompt}
              </button>
            ))}
          </div>

          <form className="copilot-compose" onSubmit={handleSubmit}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Pregunta a Blackline AI..."
            />
            <button className="primary-icon-button" type="submit" disabled={isSending || !draft.trim()}>
              <Send size={16} aria-hidden="true" />
              Enviar
            </button>
          </form>
        </section>

        <aside className="copilot-decision-center">
          <section className="copilot-side-section">
            <div className="section-title">
              <span>
                <BrainCircuit size={15} aria-hidden="true" />
                Recomendaciones IA
              </span>
              <small>{visibleDecisions.length}</small>
            </div>
            <div className="copilot-decision-list">
              {visibleDecisions.map((decision) => (
                <DecisionCard key={decision.id} decision={decision} onFocusDigitalTwin={onFocusDigitalTwin} />
              ))}
              {visibleDecisions.length === 0 ? (
                <div className="compact-empty">
                  <Wrench size={18} aria-hidden="true" />
                  Sin recomendaciones con evidencia suficiente
                </div>
              ) : null}
            </div>
          </section>

          <section className="copilot-side-section">
            <div className="section-title">
              <span>
                <AlertTriangle size={15} aria-hidden="true" />
                Alertas proactivas
              </span>
              <small>{dashboard.proactiveAlerts.length}</small>
            </div>
            <div className="copilot-decision-list compact">
              {dashboard.proactiveAlerts.map((decision) => (
                <DecisionCard key={decision.id} decision={decision} onFocusDigitalTwin={onFocusDigitalTwin} />
              ))}
              {dashboard.proactiveAlerts.length === 0 ? <span className="empty-slot">Sin alertas criticas</span> : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function MessageBubble({
  message,
  onFocusDigitalTwin
}: {
  message: CopilotMessage
  onFocusDigitalTwin: (focus: CopilotDigitalTwinFocus) => void
}) {
  return (
    <article className={message.role === 'assistant' ? 'copilot-message assistant' : 'copilot-message user'}>
      <div className="copilot-message-head">
        <strong>{message.role === 'assistant' ? 'Blackline AI' : 'Usuario'}</strong>
        <span>
          {labelIntent(message.intent)}
          {message.role === 'assistant' ? ` · ${Math.round(message.confidence * 100)}%` : ''}
        </span>
      </div>
      <p>{message.content}</p>
      {message.digitalTwinFocus ? (
        <button className="copilot-focus-button" type="button" onClick={() => onFocusDigitalTwin(message.digitalTwinFocus!)}>
          <Crosshair size={14} aria-hidden="true" />
          Abrir enfoque 3D
        </button>
      ) : null}
      {message.sources.length > 0 ? (
        <div className="copilot-source-list">
          {message.sources.map((source) => (
            <span key={`${message.id}-${source.label}-${source.detail}`}>
              {source.label}: {source.detail}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  )
}

function DecisionCard({
  decision,
  onFocusDigitalTwin
}: {
  decision: CopilotDecision
  onFocusDigitalTwin: (focus: CopilotDigitalTwinFocus) => void
}) {
  return (
    <article className={`copilot-decision ${decision.severity}`}>
      <div className="copilot-decision-head">
        <span>{labelDecisionType(decision.type)}</span>
        <strong>{Math.round(decision.confidence * 100)}%</strong>
      </div>
      <h5>{decision.title}</h5>
      <p>{decision.body}</p>
      {decision.evidence ? <small>{decision.evidence}</small> : null}
      {decision.digitalTwinFocus ? (
        <button className="copilot-focus-button" type="button" onClick={() => onFocusDigitalTwin(decision.digitalTwinFocus!)}>
          <Crosshair size={14} aria-hidden="true" />
          Ver en 3D
        </button>
      ) : null}
    </article>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function upsertConversation(
  conversations: CopilotDashboard['conversations'],
  conversation: CopilotDashboard['conversations'][number]
): CopilotDashboard['conversations'] {
  return [conversation, ...conversations.filter((item) => item.id !== conversation.id)].slice(0, 20)
}

function labelIntent(value: CopilotMessage['intent']): string {
  const labels: Record<CopilotMessage['intent'], string> = {
    project_status: 'Proyecto',
    shop_status: 'Taller',
    next_actions: 'Acciones',
    purchase_recommendation: 'Compras',
    oem_recommendation: 'OEM',
    time_estimate: 'Tiempo',
    cost_estimate: 'Costos',
    digital_twin: 'Gemelo 3D',
    client_summary: 'Cliente',
    technical_summary: 'Tecnico',
    universal_search: 'Busqueda',
    unknown: 'Consulta'
  }

  return labels[value]
}

function labelDecisionType(value: CopilotDecision['type']): string {
  const labels: Record<CopilotDecision['type'], string> = {
    next_action: 'Accion',
    risk: 'Riesgo',
    purchase: 'Compra',
    delay: 'Retraso',
    priority: 'Prioridad'
  }

  if (value === 'purchase') {
    return `${labels[value]}`
  }

  if (value === 'delay') {
    return `${labels[value]}`
  }

  return labels[value]
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Ocurrio un error inesperado.'
}
