/**
 * 编排护栏 —— 防死循环 + 防工具卡死（见 Docs 文档 §9.2）。
 *
 * 1. loopGuardCondition：做成 stopWhen 条件，检测连续 N 步相同的工具调用指纹（toolName+input），
 *    命中即让 ToolLoopAgent「优雅停止」（不抛 AbortError，已产出的内容照常返回）。
 * 2. withToolTimeouts：给每个工具 execute 套 Promise.race 超时，超时返回 {error} 不挂住对话。
 *    首次触发重建的工具（semantic_search 嵌入 / search_messages 建 FTS 索引）给更长超时，避免误杀。
 *
 * 报错兜底（工具一律返回 {error} 不抛）已在各 tool 的 execute try/catch 内实现，此处不重复。
 */
import type { StepResult, StopCondition, Tool, ToolSet } from 'ai'
import { reportAgentProgress } from './progress'

/** 连续这么多步出现相同工具调用指纹 → 判定死循环，停止。 */
const MAX_IDENTICAL_TOOL_REPEATS = 3
/** 工具执行默认超时（毫秒）。本地 SQLite 工具远快于此，超时即视为卡死。 */
const DEFAULT_TOOL_TIMEOUT_MS = 60_000
/** 首次会触发重建（嵌入 / FTS 索引）或本身跑子 Agent 的重工具，给更宽松超时。 */
const TOOL_TIMEOUT_OVERRIDES: Record<string, number> = {
  semantic_search: 240_000,
  search_messages: 240_000,
  delegate_analysis: 360_000, // 子 Agent 整轮（多步 + 可能触发首次重建），给更长上限
}

function stepFingerprint(step: StepResult<ToolSet>): string | null {
  if (!step.toolCalls || step.toolCalls.length === 0) return null
  return step.toolCalls
    .map((c) => {
      let input = ''
      try {
        input = JSON.stringify(c.input)
      } catch {
        input = '<unserializable>'
      }
      return `${c.toolName}:${input}`
    })
    .sort()
    .join('|')
}

/** 死循环检测：最近 N 步工具调用指纹完全相同（且非空）→ 停止。 */
export function loopGuardCondition(): StopCondition<ToolSet> {
  return ({ steps }) => {
    if (steps.length < MAX_IDENTICAL_TOOL_REPEATS) return false
    const recent = steps.slice(-MAX_IDENTICAL_TOOL_REPEATS).map(stepFingerprint)
    const first = recent[0]
    return first !== null && recent.every((fp) => fp === first)
  }
}

/** 给每个工具的 execute 套超时，超时返回 {error}（不抛、不挂住循环）。 */
export function withToolTimeouts(tools: ToolSet, defaultMs = DEFAULT_TOOL_TIMEOUT_MS): ToolSet {
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    const orig = t.execute
    if (typeof orig !== 'function') {
      out[name] = t
      continue
    }
    const ms = TOOL_TIMEOUT_OVERRIDES[name] ?? defaultMs
    out[name] = {
      ...t,
      execute: (input: unknown, options) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const startedAt = Date.now()
        reportAgentProgress({
          stage: 'tool_started',
          title: `调用工具 ${name}`,
          toolName: name,
        })
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => resolve({ error: `工具 ${name} 执行超时（>${ms}ms）` }), ms)
        })
        return Promise.race([Promise.resolve(orig(input, options)), timeout])
          .then((result) => {
            const error = result && typeof result === 'object' && 'error' in result
              ? String((result as { error?: unknown }).error || '')
              : ''
            reportAgentProgress({
              stage: error ? 'error' : 'tool_finished',
              title: error ? `工具 ${name} 返回错误` : `工具 ${name} 完成`,
              detail: error || undefined,
              toolName: name,
              elapsedMs: Date.now() - startedAt,
            })
            return result
          })
          .finally(() => {
            if (timer) clearTimeout(timer)
          })
      },
    } as Tool
  }
  return out
}
