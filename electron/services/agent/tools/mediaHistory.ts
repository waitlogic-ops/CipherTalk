/**
 * 历史媒体工具 —— 检索聊天里的图片/表情，并把选中的媒体作为当前回复图片展示。
 *
 * 这里仍不做视觉理解：模型只能根据发送者、时间、前文语境和类型来选。
 * 选中后再解密/下载成纯图片文件，前端用 local-image:// 展示。
 */
import { tool } from 'ai'
import { z } from 'zod'
import * as fs from 'fs'
import * as path from 'path'
import { detectImageExtension } from '../../chat/emoji'
import { parseEmojiInfo, parseImageInfo } from '../../chat/contentParsers'
import type { ChatSearchMediaKind, ChatSearchMediaMessageRow } from '../../search/chatSearchIndexService'
import { resolveSenders, toLocalTime } from './shared'
import { bootstrapIndexRecentSessions, getAiImageOutputDir, writeDataUrlToFile } from './stickers'

type MediaIdPayload = {
  kind: ChatSearchMediaKind
  sessionId: string
  localId: number
  createTime: number
}

function safeFileSegment(value: string): string {
  return String(value || 'media').replace(/[^a-zA-Z0-9_@.-]/g, '_').slice(0, 80) || 'media'
}

function encodeMediaId(payload: MediaIdPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function decodeMediaId(value: string): MediaIdPayload | null {
  try {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Partial<MediaIdPayload>
    const kind = parsed.kind === 'emoji' ? 'emoji' : parsed.kind === 'image' ? 'image' : null
    const sessionId = String(parsed.sessionId || '').trim()
    const localId = Number(parsed.localId)
    const createTime = Number(parsed.createTime || 0)
    if (!kind || !sessionId || !Number.isFinite(localId) || localId <= 0) return null
    return { kind, sessionId, localId, createTime }
  } catch {
    return null
  }
}

function extractAttr(content: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*['"]([^'"]+)['"]`, 'i').exec(content)
  return match ? match[1].replace(/&amp;/g, '&') : undefined
}

function mediaKindFromRow(row: ChatSearchMediaMessageRow): ChatSearchMediaKind {
  return Number(row.localType) === 47 ? 'emoji' : 'image'
}

function mediaLabel(kind: ChatSearchMediaKind): string {
  return kind === 'emoji' ? '表情包' : '图片'
}

function normalizeQuery(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .replace(/[，。！？；：、“”‘’（）()[\]{}<>《》|\\/+=*_~`#$%^&-]+/g, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 8)
}

async function resolveImageToFile(sessionId: string, localId: number, createTime: number): Promise<string | null> {
  const { chatService } = await import('../../chatService')
  const res = await chatService.getImageData(sessionId, String(localId), createTime)
  if (!res.success || !res.data) return null
  const buffer = Buffer.from(res.data, 'base64')
  const ext = detectImageExtension(buffer) || '.jpg'
  const dir = await getAiImageOutputDir()
  if (!dir) return null
  const filePath = path.join(dir, `history-${safeFileSegment(sessionId)}-${localId}${ext}`)
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, buffer)
  }
  return filePath
}

async function resolveEmojiToFile(rawContent: string, localId: number, createTime: number): Promise<string | null> {
  const info = parseEmojiInfo(rawContent)
  const md5 = info.md5 || ''
  const { chatService } = await import('../../chatService')
  const res = await chatService.downloadEmoji(
    info.cdnUrl || '',
    md5,
    info.productId,
    createTime,
    extractAttr(rawContent, 'encrypturl'),
    extractAttr(rawContent, 'aeskey')
  )
  if (!res.success || !res.localPath) return null
  return writeDataUrlToFile(res.localPath, `history-emoji-${safeFileSegment(md5 || String(localId))}`)
}

async function resolveRowToFile(row: ChatSearchMediaMessageRow): Promise<string | null> {
  const kind = mediaKindFromRow(row)
  return kind === 'emoji'
    ? resolveEmojiToFile(row.rawContent, row.localId, row.createTime)
    : resolveImageToFile(row.sessionId, row.localId, row.createTime)
}

async function listRowsWithBootstrap(options: {
  sessionId?: string
  kinds?: ChatSearchMediaKind[]
  startTimeMs?: number
  endTimeMs?: number
  direction?: 'in' | 'out'
  limit: number
}): Promise<ChatSearchMediaMessageRow[]> {
  const { chatSearchIndexService } = await import('../../search/chatSearchIndexService')
  let rows = chatSearchIndexService.listMediaMessageRows(options)
  if (rows.length > 0) return rows

  if (options.sessionId) {
    await chatSearchIndexService.listSessionMemoryMessages(options.sessionId, undefined, 5000)
  } else {
    await bootstrapIndexRecentSessions()
  }
  rows = chatSearchIndexService.listMediaMessageRows(options)
  return rows
}

export const searchMedia = tool({
  description:
    '检索本地聊天记录里已索引的图片/表情包，按会话、时间、方向、类型和前文语境筛选。' +
    '结果里的 mediaId 可传给 send_media_from_history 展示/回复。' +
    '注意：你仍看不到图片画面本身，只能根据发送者、时间、前文语境和类型判断。',
  inputSchema: z.object({
    query: z.string().optional().describe('按前文语境/文本线索筛选，如 晚安、笑、截图、照片；不填则按时间返回最近媒体'),
    kind: z.enum(['all', 'image', 'emoji']).default('all').describe('媒体类型'),
    sessionId: z.string().optional().describe('限定某会话/群 username；不填则从已索引最近会话里找'),
    startTimeMs: z.number().optional().describe('起始时间，毫秒时间戳'),
    endTimeMs: z.number().optional().describe('结束时间，毫秒时间戳'),
    direction: z.enum(['in', 'out']).optional().describe('in=别人发的，out=我发的'),
    limit: z.number().int().min(1).max(20).default(8).describe('返回条数上限'),
    includeLocalPaths: z.boolean().default(false).describe('是否尝试解析本地图片路径；会更慢，通常只在需要预览候选时打开'),
  }),
  execute: async ({ query, kind, sessionId, startTimeMs, endTimeMs, direction, limit, includeLocalPaths }) => {
    try {
      const kinds: ChatSearchMediaKind[] = kind === 'all' ? ['image', 'emoji'] : [kind]
      const rows = await listRowsWithBootstrap({
        sessionId,
        kinds,
        startTimeMs,
        endTimeMs,
        direction,
        limit: Math.max(limit * 4, limit),
      })

      const terms = normalizeQuery(query || '')
      const { chatSearchIndexService } = await import('../../search/chatSearchIndexService')
      const withContext = rows.map((row) => {
        const kind = mediaKindFromRow(row)
        const context = chatSearchIndexService.getPrecedingText(row.sessionId, row.sortSeq)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120)
        const imageInfo = kind === 'image' ? parseImageInfo(row.rawContent) : {}
        const emojiInfo = kind === 'emoji' ? parseEmojiInfo(row.rawContent) : {}
        const haystack = [
          mediaLabel(kind),
          context,
          row.parsedContent,
          imageInfo.md5,
          emojiInfo.md5,
          emojiInfo.productId
        ].join(' ').toLowerCase()
        const score = terms.length === 0
          ? 1
          : terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0)
        return { row, kind, context, imageInfo, emojiInfo, score }
      })

      const matched = terms.length === 0 ? undefined : withContext.some((item) => item.score > 0)
      const picked = (terms.length > 0 ? withContext.filter((item) => item.score > 0) : withContext)
        .sort((a, b) => b.score - a.score || b.row.sortSeq - a.row.sortSeq || b.row.createTime - a.row.createTime)
        .slice(0, limit)

      const names = await resolveSenders(
        picked.flatMap((item) => [item.row.sessionId, item.row.senderUsername || ''])
      )
      const hits = []
      for (const item of picked) {
        const localPath = includeLocalPaths ? await resolveRowToFile(item.row) : null
        hits.push({
          mediaId: encodeMediaId({
            kind: item.kind,
            sessionId: item.row.sessionId,
            localId: item.row.localId,
            createTime: item.row.createTime,
          }),
          kind: item.kind,
          label: mediaLabel(item.kind),
          time: toLocalTime(item.row.createTime),
          from: names.get(item.row.sessionId) || item.row.sessionId,
          sender: item.row.isSend === 1
            ? '我'
            : names.get(item.row.senderUsername || '') || item.row.senderUsername || undefined,
          context: item.context || undefined,
          md5: item.kind === 'image' ? item.imageInfo.md5 : item.emojiInfo.md5,
          localPath: localPath || undefined,
        })
      }

      return {
        matched,
        note: terms.length > 0 && matched === false ? '没有匹配语境的媒体；可以放宽关键词或指定会话/时间。' : undefined,
        hits,
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
})

export const sendMediaFromHistory = tool({
  description:
    '把 search_media 返回的一张历史图片/表情包作为当前回复图片展示或回复附件。' +
    '只在用户明确要看/发/抽取历史图片或表情包时使用；发出后不要输出路径。',
  inputSchema: z.object({
    mediaId: z.string().min(8).describe('来自 search_media 命中的 mediaId'),
  }),
  execute: async ({ mediaId }) => {
    try {
      const payload = decodeMediaId(mediaId)
      if (!payload) return { error: 'mediaId 无效' }

      const { chatService } = await import('../../chatService')
      const msgResult = await chatService.getMessageByLocalId(payload.sessionId, payload.localId)
      if (!msgResult.success || !msgResult.message) return { error: '未找到这条媒体消息' }

      const message = msgResult.message
      const kind = payload.kind
      const filePath = kind === 'emoji'
        ? await resolveEmojiToFile(String(message.rawContent || ''), payload.localId, payload.createTime || Number(message.createTime || 0))
        : await resolveImageToFile(payload.sessionId, payload.localId, payload.createTime || Number(message.createTime || 0))
      if (!filePath) return { error: `${mediaLabel(kind)}解密或落盘失败` }

      const names = await resolveSenders([payload.sessionId, message.senderUsername || ''])
      return {
        success: true,
        filePath,
        kind: 'image',
        mediaKind: kind,
        from: names.get(payload.sessionId) || payload.sessionId,
        sender: message.isSend === 1
          ? '我'
          : names.get(message.senderUsername || '') || message.senderUsername || undefined,
        time: toLocalTime(payload.createTime || Number(message.createTime || 0)),
        note: `${mediaLabel(kind)}已准备作为当前回复图片，回答里不要输出路径或链接。`,
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
})
