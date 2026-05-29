import { app, type WebContents } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { Worker } from 'worker_threads'
import type { SessionQAOptions, SessionQAResult } from '../ai/aiService'
import { dataManagementService } from '../dataManagementService'
import { getElectronWorkerEnv } from '../workerEnvironment'
import { conversationStore } from './conversationStore'
import { run } from './engine'
import type { ConversationRequest, ProgressEvent, StreamEvent } from './types'

type StartResult = {
  success: boolean
  requestId: string
  conversationId?: number
  error?: string
}

type CancelResult = {
  success: boolean
  requestId: string
  error?: string
}

type WorkerEvent =
  | { kind: 'progress'; progress: ProgressEvent; createdAt?: number }
  | { kind: 'stream'; streamEvent: StreamEvent; createdAt?: number }
  | { kind: 'final'; result: SessionQAResult; createdAt?: number }
  | { kind: 'error'; error: string; createdAt?: number }

type AIAgentJob = {
  requestId: string
  conversationId: number
  request: ConversationRequest
  sender: WebContents
  controller: AbortController
  worker?: Worker
  assistantContent: string
}

function createRequestId(): string {
  return `aiagent-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function hasScopedSessions(request: ConversationRequest): boolean {
  return (request.scopedSessions || []).some(session => String(session.id || '').trim())
}

class AIAgentJobService {
  private jobs = new Map<string, AIAgentJob>()
  private vectorWarmupJobs = new Map<string, Worker>()

  start(request: ConversationRequest, sender: WebContents): StartResult {
    const requestId = request.requestId?.trim() || createRequestId()
    if (this.jobs.has(requestId)) {
      return { success: false, requestId, error: '相同 requestId 的对话任务已存在' }
    }
    if (!conversationStore.isInitialized()) {
      return { success: false, requestId, error: 'AI Agent 会话数据库未初始化' }
    }

    const conversationId = request.conversationId && conversationStore.hasConversation(request.conversationId)
      ? request.conversationId
      : conversationStore.createConversation(request.scope)

    const normalizedRequest: ConversationRequest = {
      ...request,
      requestId,
      conversationId
    }

    conversationStore.appendMessage(conversationId, 'user', normalizedRequest.message)

    const job: AIAgentJob = {
      requestId,
      conversationId,
      request: normalizedRequest,
      sender,
      controller: new AbortController(),
      assistantContent: ''
    }
    this.jobs.set(requestId, job)

    if (normalizedRequest.scope.kind === 'session' && !hasScopedSessions(normalizedRequest)) {
      const workerPath = this.findElectronWorkerPath('sessionQaWorker.js')
      if (!workerPath) {
        this.jobs.delete(requestId)
        return { success: false, requestId, error: '未找到 sessionQaWorker.js' }
      }
      this.startSessionWorker(job, workerPath)
    } else {
      this.startGlobalMainProcessJob(job)
    }

    this.notifyConversationUpdated(job)
    this.sendProgress(job, {
      id: 'job-start',
      stage: 'intent',
      status: 'completed',
      title: '启动 AI Agent',
      detail: '任务已创建，正在进入对话流程',
      requestId,
      createdAt: Date.now()
    })

    return { success: true, requestId, conversationId }
  }

  async cancel(requestId: string): Promise<CancelResult> {
    const job = this.jobs.get(requestId)
    if (!job) {
      return { success: false, requestId, error: '对话任务不存在或已结束' }
    }

    this.jobs.delete(requestId)
    job.controller.abort()
    if (job.worker) {
      await job.worker.terminate()
      dataManagementService.resumeFromAi()
    }

    conversationStore.appendMessage(
      job.conversationId,
      'assistant',
      job.assistantContent || '已取消回答。'
    )
    this.sendProgress(job, {
      id: 'job-cancelled',
      stage: 'answer',
      status: 'failed',
      title: '已取消回答',
      detail: '用户已取消本次对话',
      requestId,
      createdAt: Date.now()
    })
    this.sendDone(job)
    this.notifyConversationUpdated(job)
    return { success: true, requestId }
  }

  private startSessionWorker(job: AIAgentJob, workerPath: string): void {
    const request = job.request
    if (request.scope.kind !== 'session') return

    const options: SessionQAOptions = {
      conversationId: job.conversationId,
      sessionId: request.scope.sessionId,
      sessionName: request.scope.sessionName,
      question: request.message,
      history: request.history,
      provider: request.provider.provider,
      apiKey: request.provider.apiKey,
      model: request.provider.model,
      enableThinking: request.forceThinking ?? request.provider.enableThinking
    }

    const worker = new Worker(workerPath, {
      env: getElectronWorkerEnv(),
      workerData: {
        requestId: job.requestId,
        options
      }
    })
    job.worker = worker
    dataManagementService.pauseForAi()
    this.warmupVectorIndex(request.scope.sessionId)

    worker.on('message', (message) => {
      this.handleWorkerEvent(job.requestId, message as WorkerEvent)
    })
    worker.on('error', (error) => {
      this.handleWorkerEvent(job.requestId, { kind: 'error', error: String(error) })
    })
    worker.on('exit', (code) => {
      dataManagementService.resumeFromAi()
      const current = this.jobs.get(job.requestId)
      if (!current) return
      if (code !== 0) {
        this.handleWorkerEvent(job.requestId, {
          kind: 'error',
          error: `问答任务异常退出，代码：${code}`
        })
      }
    })
  }

  private startGlobalMainProcessJob(job: AIAgentJob): void {
    void (async () => {
      try {
        const result = await run(
          job.request,
          event => this.handleStreamEvent(job, event),
          progress => this.sendProgress(job, progress),
          job.controller.signal
        )
        const content = result.answerText || job.assistantContent
        conversationStore.appendMessage(job.conversationId, 'assistant', content)
        this.sendDone(job)
        this.notifyConversationUpdated(job)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (job.controller.signal.aborted) {
          conversationStore.appendMessage(job.conversationId, 'assistant', job.assistantContent || '已取消回答。')
          this.sendDone(job)
        } else {
          this.sendError(job, message)
          conversationStore.appendMessage(job.conversationId, 'assistant', job.assistantContent || message)
        }
        this.notifyConversationUpdated(job)
      } finally {
        this.jobs.delete(job.requestId)
      }
    })()
  }

  private handleWorkerEvent(requestId: string, event: WorkerEvent): void {
    const job = this.jobs.get(requestId)
    if (!job) return

    if (event.kind === 'stream') {
      this.handleStreamEvent(job, event.streamEvent)
      return
    }

    if (event.kind === 'progress') {
      this.sendProgress(job, {
        ...event.progress,
        requestId: event.progress.requestId || requestId,
        createdAt: event.progress.createdAt || event.createdAt || Date.now()
      })
      return
    }

    if (event.kind === 'final') {
      const content = event.result.answerText || job.assistantContent
      conversationStore.appendMessage(job.conversationId, 'assistant', content)
      this.jobs.delete(requestId)
      void job.worker?.terminate().catch(() => undefined)
      this.sendDone(job)
      this.notifyConversationUpdated(job)
      return
    }

    this.jobs.delete(requestId)
    void job.worker?.terminate().catch(() => undefined)
    const message = event.error || 'AI Agent 对话失败'
    conversationStore.appendMessage(job.conversationId, 'assistant', job.assistantContent || message)
    this.sendError(job, message)
    this.notifyConversationUpdated(job)
  }

  private handleStreamEvent(job: AIAgentJob, event: StreamEvent): void {
    if (event.type === 'content_delta') {
      job.assistantContent += event.text
    }
    if (event.type === 'message_done' && event.content && !job.assistantContent) {
      job.assistantContent = event.content
    }
    if (!job.sender.isDestroyed()) {
      job.sender.send('aiagent:streamEvent', { requestId: job.requestId, event })
    }
  }

  private sendProgress(job: AIAgentJob, progress: ProgressEvent): void {
    if (job.sender.isDestroyed()) return
    job.sender.send('aiagent:progress', {
      ...progress,
      requestId: progress.requestId || job.requestId,
      createdAt: progress.createdAt || Date.now()
    })
  }

  private sendDone(job: AIAgentJob): void {
    if (job.sender.isDestroyed()) return
    job.sender.send('aiagent:done', {
      requestId: job.requestId,
      conversationId: job.conversationId
    })
  }

  private sendError(job: AIAgentJob, message: string): void {
    if (job.sender.isDestroyed()) return
    job.sender.send('aiagent:error', {
      requestId: job.requestId,
      message
    })
  }

  private notifyConversationUpdated(job: AIAgentJob): void {
    if (job.sender.isDestroyed()) return
    const conversation = conversationStore.loadConversation(job.conversationId)
    if (conversation) {
      job.sender.send('aiagent:conversationUpdated', conversation)
    }
  }

  private warmupVectorIndex(sessionId: string): void {
    if (!sessionId || this.vectorWarmupJobs.has(sessionId)) return

    const workerPath = this.findElectronWorkerPath('sessionVectorIndexWorker.js')
    if (!workerPath) return

    const worker = new Worker(workerPath, {
      env: getElectronWorkerEnv(),
      workerData: { sessionId }
    })
    this.vectorWarmupJobs.set(sessionId, worker)
    dataManagementService.pauseForAi()

    worker.on('message', (message: { type?: string; error?: string }) => {
      if (message?.type === 'error') {
        console.warn('[AIAgentJob] 后台语义向量增强失败:', message.error)
      }
      if (message?.type === 'completed' || message?.type === 'error') {
        void worker.terminate().catch(() => undefined)
      }
    })
    worker.on('error', (error) => {
      console.warn('[AIAgentJob] 后台语义向量增强 Worker 异常:', error)
      this.vectorWarmupJobs.delete(sessionId)
    })
    worker.on('exit', () => {
      dataManagementService.resumeFromAi()
      this.vectorWarmupJobs.delete(sessionId)
    })
  }

  private findElectronWorkerPath(fileName: string): string | null {
    const candidates = app.isPackaged
      ? [
          join(process.resourcesPath, 'app.asar', 'dist-electron', fileName),
          join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', fileName),
          join(process.resourcesPath, 'dist-electron', fileName),
          join(__dirname, fileName),
          join(__dirname, '..', '..', fileName),
          join(__dirname, '..', fileName)
        ]
      : [
          join(__dirname, fileName),
          join(__dirname, '..', '..', fileName),
          join(__dirname, '..', fileName),
          join(app.getAppPath(), 'dist-electron', fileName)
        ]

    return candidates.find(candidate => existsSync(candidate)) || null
  }
}

export const aiagentJobService = new AIAgentJobService()
