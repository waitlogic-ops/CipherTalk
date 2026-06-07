/**
 * 长期记忆工具 —— remember / recall（L2 用户级语义记忆，Letta/LangMem 式「agent 自编辑」范式）。
 *
 * agent 在 ReAct 循环里自己决定记什么、查什么，写进 agent_memory.db 的 memory_items（FTS 关键词检索）。
 * 只存稳定的「用户画像 profile」与「长期事实 fact」，带 importance；高重要度的会在下次开场注入系统提示。
 * 复用 memoryDatabase 现成读写层——子进程经 ConfigService + better-sqlite3 直连 app 派生库（同 messageVectorService）。
 * 故意只挂在主 Agent（buildTools），子 Agent（delegate）不带，避免子任务乱写记忆。
 */
import { tool } from 'ai'
import { z } from 'zod'
import type { AgentScope } from '../types'
import { memoryDatabase, hashMemoryContent } from '../../memory/memoryDatabase'

/** 开场注入的画像/会话事实条数上限；先取 SCAN_LIMIT 再按 importance 排序截断。 */
const INJECT_PROFILE_LIMIT = 10
const INJECT_FACT_LIMIT = 10
const SCAN_LIMIT = 50

function memoryUid(title: string, content: string): string {
  return `mem-${hashMemoryContent(title, content).slice(0, 16)}`
}

/** about 缺省回退：当前已 @ 某会话则归到该会话，否则不限定（关于用户本人）。 */
function resolveAbout(about: string | undefined, scope: AgentScope): string | null {
  const explicit = String(about || '').trim()
  if (explicit) return explicit
  if (scope.kind === 'session') return scope.sessionId
  return null
}

export function createRemember(scope: AgentScope) {
  return tool({
    description:
      '记住一条关于用户的长期记忆，跨对话保留（下次开场会注入高重要度记忆）。' +
      '只在用户透露稳定的偏好/身份/重要关系或事实时用（如"我是产品经理""我女朋友叫小美""老王是我室友"）；' +
      '一次性、琐碎、或能直接从聊天记录查到的别记。记之前可先用 recall 查是否已记过，避免重复。',
    inputSchema: z.object({
      content: z.string().min(1).describe('要记住的事实，一句话写清'),
      kind: z.enum(['profile', 'fact']).default('fact')
        .describe('profile=关于用户本人的画像/偏好；fact=其它长期事实（含关于某联系人）'),
      about: z.string().optional().describe('这条记忆关于谁（联系人/会话 username）；不填且当前已 @ 某会话则默认归到该会话'),
      importance: z.number().min(0).max(1).default(0.5).describe('重要度 0~1，越高越会在开场被注入系统提示'),
      tags: z.array(z.string()).optional().describe('可选标签，便于检索'),
    }),
    execute: async ({ content, kind, about, importance, tags }) => {
      try {
        const text = content.trim()
        const title = text.slice(0, 40)
        const sessionId = resolveAbout(about, scope)
        const item = memoryDatabase.upsertMemoryItem({
          memoryUid: memoryUid(title, text),
          sourceType: kind,
          sessionId,
          contactId: sessionId,
          title,
          content: text,
          importance,
          tags: tags || [],
        })
        return { remembered: true, id: item.id, kind: item.sourceType, importance: item.importance, about: sessionId }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    },
  })
}

export function createRecall(scope: AgentScope) {
  return tool({
    description:
      '检索你记过的长期记忆（用户画像/偏好/长期事实）。回答涉及用户个人情况、偏好、长期关系时先查一下。',
    inputSchema: z.object({
      query: z.string().min(1).describe('检索意图/关键词'),
      about: z.string().optional().describe('限定关于某联系人/会话 username；不填且已 @ 某会话则默认该会话'),
      limit: z.number().int().min(1).max(30).default(10).describe('返回条数上限'),
    }),
    execute: async ({ query, about, limit }) => {
      try {
        const sessionId = resolveAbout(about, scope)
        const hits = memoryDatabase.searchMemoryItemsByKeyword({
          query,
          ...(sessionId ? { sessionId } : {}),
          sourceTypes: ['profile', 'fact'],
          limit,
        })
        return {
          count: hits.length,
          memories: hits.map((h) => ({
            kind: h.item.sourceType,
            content: h.item.content,
            about: h.item.sessionId,
            importance: h.item.importance,
            tags: h.item.tags,
          })),
        }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    },
  })
}

/** 读高重要度长期记忆拼成系统提示片段；无记忆返回空串，读失败不影响 agent。 */
export async function buildMemoryContext(scope: AgentScope): Promise<string> {
  try {
    const profiles = memoryDatabase
      .listMemoryItems({ sourceType: 'profile', limit: SCAN_LIMIT })
      .sort((a, b) => b.importance - a.importance)
      .slice(0, INJECT_PROFILE_LIMIT)

    const facts = scope.kind === 'session'
      ? memoryDatabase
          .listMemoryItems({ sourceType: 'fact', sessionId: scope.sessionId, limit: SCAN_LIMIT })
          .sort((a, b) => b.importance - a.importance)
          .slice(0, INJECT_FACT_LIMIT)
      : []

    if (profiles.length === 0 && facts.length === 0) return ''

    const lines = [...profiles, ...facts].map((m) => `- ${m.content.slice(0, 120)}`)
    return `\n\n# 你记住的长期记忆\n以下是你在过往对话中记下的、关于用户的长期记忆，回答时可参考；若与当前对话冲突，以当前对话为准。需要更多细节用 recall 检索。\n${lines.join('\n')}`
  } catch {
    return ''
  }
}
