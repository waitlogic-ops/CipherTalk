import type {
  ConversationRequest,
  ProgressEvent,
  ProgressEmit,
  ScopedSession,
  RunConversationResult,
  StreamEvent,
  StreamEmit
} from './types'
import { aiService } from '../ai/aiService'
import { resolveScope } from './scope'
import { runGlobalConversation } from './global/globalAgent'

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('Aborted')
  }
}

function emitStream(emit: StreamEmit, event: unknown): void {
  emit(event as StreamEvent)
}

function emitProgress(onProgress: ProgressEmit, event: unknown): void {
  onProgress(event as ProgressEvent)
}

function getScopedSessions(request: ConversationRequest): ScopedSession[] {
  const sessions = new Map<string, ScopedSession>()
  for (const session of request.scopedSessions || []) {
    const id = String(session.id || '').trim()
    if (!id) continue
    sessions.set(id, { id, name: session.name || id })
  }
  return [...sessions.values()]
}

function buildScopedQuestion(request: ConversationRequest): string {
  const hint = request.commandHint?.trim()
  return hint ? `${request.message}\n\n用户意图补充：${hint}` : request.message
}

export async function run(
  request: ConversationRequest,
  emit: StreamEmit,
  onProgress: ProgressEmit,
  signal: AbortSignal
): Promise<RunConversationResult> {
  const scope = resolveScope(request.scope)
  assertNotAborted(signal)
  const scopedSessions = getScopedSessions(request)

  const scopedSession = scopedSessions.length === 1 ? scopedSessions[0] : null
  if (scopedSession) {
    emitProgress(onProgress, {
      id: 'global-scope-resolved',
      stage: 'intent',
      status: 'completed',
      title: '识别会话范围',
      detail: `已定位到单个会话：${scopedSession.name}，切换到会话编排`,
      requestId: request.requestId,
      createdAt: Date.now(),
      source: 'chat'
    })

    const result = await aiService.answerSessionQuestion(
      {
        conversationId: request.conversationId,
        sessionId: scopedSession.id,
        sessionName: scopedSession.name,
        question: buildScopedQuestion(request),
        history: request.history,
        provider: request.provider.provider,
        apiKey: request.provider.apiKey,
        model: request.provider.model,
        enableThinking: request.forceThinking ?? request.provider.enableThinking,
        signal,
      },
      event => emitStream(emit, event),
      event => emitProgress(onProgress, event)
    )

    return {
      conversationId: request.conversationId ?? 0,
      answerText: result.answerText
    }
  }

  if (scope.kind === 'session' && scopedSessions.length > 1) {
    emitProgress(onProgress, {
      id: 'session-extra-scope-resolved',
      stage: 'intent',
      status: 'completed',
      title: '识别多会话范围',
      detail: `已包含 ${scopedSessions.length} 个会话范围，切换到全局 Agent`,
      requestId: request.requestId,
      createdAt: Date.now(),
      source: 'chat'
    })

    const answerText = await runGlobalConversation(
      { ...request, scope: { kind: 'global' }, scopedSessions },
      emit,
      signal
    )
    return {
      conversationId: request.conversationId ?? 0,
      answerText
    }
  }

  if (scope.kind === 'session') {
    const result = await aiService.answerSessionQuestion(
      {
        conversationId: request.conversationId,
        sessionId: scope.sessionId,
        sessionName: scope.sessionName,
        question: request.message,
        history: request.history,
        provider: request.provider.provider,
        apiKey: request.provider.apiKey,
        model: request.provider.model,
        enableThinking: request.forceThinking ?? request.provider.enableThinking,
        signal,
      },
      event => emitStream(emit, event),
      event => emitProgress(onProgress, event)
    )

    return {
      conversationId: request.conversationId ?? 0,
      answerText: result.answerText
    }
  }

  const answerText = await runGlobalConversation(request, emit, signal)
  return {
    conversationId: request.conversationId ?? 0,
    answerText
  }
}
