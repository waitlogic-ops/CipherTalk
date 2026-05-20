import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { Worker } from 'worker_threads'
import { getElectronWorkerEnv } from './workerEnvironment'

type PendingCall = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

type WorkerReply = {
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

// 空闲一段时间后回收 worker，释放精排模型占用的内存。
const IDLE_TIMEOUT_MS = 5 * 60 * 1000

/**
 * 内置 Agent 工具（ct_*）在常驻 worker 线程内执行。
 * better-sqlite3 同步查询与本地 ONNX 推理都被隔离在 worker，主进程事件循环不再被阻塞。
 */
class AgentToolWorkerService {
  private worker: Worker | null = null
  private pending = new Map<number, PendingCall>()
  private seq = 0
  private idleTimer: NodeJS.Timeout | null = null

  async run(
    toolName: string,
    args: Record<string, unknown>,
    context?: { readLimit?: number }
  ): Promise<unknown> {
    const worker = this.ensureWorker()
    const id = ++this.seq
    this.clearIdleTimer()
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        worker.postMessage({ id, toolName, args, context })
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const workerPath = this.resolveWorkerPath()
    if (!workerPath) {
      throw new Error('未找到 agentToolWorker.js')
    }
    const worker = new Worker(workerPath, { env: getElectronWorkerEnv() })
    worker.on('message', (message: WorkerReply) => this.handleReply(message))
    worker.on('error', (error) => this.handleFatal(error instanceof Error ? error : new Error(String(error))))
    worker.on('exit', (code) => {
      if (code !== 0 && this.worker === worker) {
        this.handleFatal(new Error(`agentToolWorker 异常退出，代码：${code}`))
      }
    })
    this.worker = worker
    return worker
  }

  private handleReply(message: WorkerReply) {
    const call = this.pending.get(message.id)
    if (!call) return
    this.pending.delete(message.id)
    if (message.ok) {
      call.resolve(message.result)
    } else {
      call.reject(new Error(message.error || '工具执行失败'))
    }
    this.scheduleIdleShutdownIfFree()
  }

  private handleFatal(error: Error) {
    for (const call of this.pending.values()) {
      call.reject(error)
    }
    this.pending.clear()
    const worker = this.worker
    this.worker = null
    this.clearIdleTimer()
    if (worker) void worker.terminate().catch(() => undefined)
  }

  private scheduleIdleShutdownIfFree() {
    if (this.pending.size > 0) return
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.pending.size > 0) return
      const worker = this.worker
      this.worker = null
      if (worker) void worker.terminate().catch(() => undefined)
    }, IDLE_TIMEOUT_MS)
    this.idleTimer.unref?.()
  }

  private clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private resolveWorkerPath(): string | null {
    const fileName = 'agentToolWorker.js'
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
    return candidates.find((candidate) => existsSync(candidate)) || null
  }
}

export const agentToolWorkerService = new AgentToolWorkerService()
