import { parentPort } from 'worker_threads'
import { executeBuiltinTool } from './services/agentBuiltinTools'

type ToolRequest = {
  id: number
  toolName: string
  args: Record<string, unknown>
  context?: { readLimit?: number }
}

// WCDB 连接在 worker 内独立建立，仅首次按需触发，之后复用。
let connectPromise: Promise<void> | null = null

async function ensureConnected(): Promise<void> {
  if (!connectPromise) {
    connectPromise = (async () => {
      const { chatService } = await import('./services/chatService')
      const result = await chatService.connect()
      if (!result.success) {
        throw new Error(result.error || 'WCDB 连接失败')
      }
    })().catch((error) => {
      connectPromise = null
      throw error
    })
  }
  return connectPromise
}

parentPort?.on('message', (req: ToolRequest) => {
  void (async () => {
    try {
      await ensureConnected()
      const result = await executeBuiltinTool(req.toolName, req.args, req.context)
      parentPort?.postMessage({ id: req.id, ok: true, result })
    } catch (error) {
      parentPort?.postMessage({
        id: req.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })()
})
