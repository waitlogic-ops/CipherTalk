import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Download, Loader2, X } from 'lucide-react'
import type { ChatSession, Message } from '../../../types/models'
import { isGroupChat, isSystemMessage } from '../utils/messageGuards'
import { formatDateDivider, shouldShowDateDivider } from '../utils/time'

interface SenderInfo {
  name: string
  avatarUrl?: string
}

interface SharePosterModalProps {
  session: ChatSession
  messages: Message[]
  myAvatarUrl?: string
  onClose: () => void
  showTopToast: (text: string, success?: boolean) => void
}

function avatarLetter(name: string): string {
  const trimmed = (name || '?').trim()
  return trimmed ? trimmed[0].toUpperCase() : '?'
}

async function waitForImages(node: HTMLElement): Promise<void> {
  const imgs = Array.from(node.querySelectorAll('img'))
  await Promise.all(imgs.map((img) => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      img.addEventListener('load', () => resolve(), { once: true })
      img.addEventListener('error', () => resolve(), { once: true })
    })
  }))
}

export function SharePosterModal({ session, messages, myAvatarUrl, onClose, showTopToast }: SharePosterModalProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  const [senders, setSenders] = useState<Map<string, SenderInfo>>(new Map())
  const group = isGroupChat(session.username)

  const ordered = useMemo(
    () => [...messages].sort((a, b) => a.createTime - b.createTime || a.sortSeq - b.sortSeq),
    [messages]
  )

  useEffect(() => {
    if (!group) {
      setSenders(new Map())
      return
    }
    const usernames = Array.from(new Set(
      ordered
        .filter((m) => m.isSend !== 1 && m.senderUsername)
        .map((m) => m.senderUsername as string)
    ))
    if (usernames.length === 0) {
      setSenders(new Map())
      return
    }
    let cancelled = false
    void (async () => {
      const map = new Map<string, SenderInfo>()
      for (const username of usernames) {
        try {
          const result = await window.electronAPI.chat.getContactAvatar(username)
          map.set(username, { name: result?.displayName || username, avatarUrl: result?.avatarUrl })
        } catch {
          map.set(username, { name: username })
        }
      }
      if (!cancelled) setSenders(map)
    })()
    return () => { cancelled = true }
  }, [ordered, group])

  const resolveSender = (msg: Message): SenderInfo => {
    if (msg.isSend === 1) return { name: '我', avatarUrl: myAvatarUrl }
    if (group && msg.senderUsername) {
      return senders.get(msg.senderUsername) || { name: msg.senderUsername }
    }
    return { name: session.displayName || session.username, avatarUrl: session.avatarUrl }
  }

  const dateRange = useMemo(() => {
    if (ordered.length === 0) return ''
    const fmt = (ts: number) => {
      const d = new Date(ts * 1000)
      return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`
    }
    const first = fmt(ordered[0].createTime)
    const last = fmt(ordered[ordered.length - 1].createTime)
    return first === last ? first : `${first} - ${last}`
  }, [ordered])

  const handleSave = async () => {
    if (saving || copying) return
    const node = cardRef.current
    if (!node) return
    setSaving(true)
    try {
      await waitForImages(node)
      const domtoimage = (await import('dom-to-image-more')).default
      const dataUrl = await (domtoimage as any).toPng(node, { scale: 2, bgcolor: '#ededed' })
      const link = document.createElement('a')
      link.download = `密语聊天记录-${Date.now()}.png`
      link.href = dataUrl
      link.click()
      showTopToast('海报已保存', true)
    } catch (e) {
      console.error('[SharePoster] 生成失败', e)
      showTopToast('海报生成失败', false)
    } finally {
      setSaving(false)
    }
  }

  const handleCopy = async () => {
    if (saving || copying) return
    const node = cardRef.current
    if (!node) return
    setCopying(true)
    try {
      await waitForImages(node)
      const domtoimage = (await import('dom-to-image-more')).default
      const blob: Blob = await (domtoimage as any).toBlob(node, { scale: 2, bgcolor: '#ededed' })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      showTopToast('海报已复制到剪贴板', true)
    } catch (e) {
      console.error('[SharePoster] 复制失败', e)
      showTopToast('复制失败，请改用保存图片', false)
    } finally {
      setCopying(false)
    }
  }

  const busy = saving || copying

  return (
    <div className="poster-overlay" onMouseDown={onClose}>
      <div className="poster-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="poster-dialog__toolbar">
          <span className="poster-dialog__hint">
            分享预览 · 共 {ordered.length} 条
            {ordered.length > 120 ? '（条数较多，生成可能稍慢）' : ''}
          </span>
          <div className="poster-dialog__actions">
            <button type="button" className="poster-btn" onClick={handleCopy} disabled={busy}>
              {copying ? <Loader2 size={14} className="poster-spin" /> : <Copy size={14} />}
              复制图片
            </button>
            <button type="button" className="poster-btn poster-btn--primary" onClick={handleSave} disabled={busy}>
              {saving ? <Loader2 size={14} className="poster-spin" /> : <Download size={14} />}
              保存图片
            </button>
            <button type="button" className="poster-btn poster-btn--icon" onClick={onClose} aria-label="关闭">
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="poster-dialog__scroll">
          <div className="poster-card" ref={cardRef}>
            <div className="poster-card__header">
              <div className="poster-card__title">{session.displayName || session.username}</div>
              {dateRange && <div className="poster-card__subtitle">{dateRange}</div>}
            </div>

            <div className="poster-card__body">
              {ordered.map((msg, index) => {
                const prev = index > 0 ? ordered[index - 1] : undefined
                const showDivider = shouldShowDateDivider(msg, prev)
                const system = isSystemMessage(msg)
                const sender = resolveSender(msg)
                const sent = msg.isSend === 1
                return (
                  <div key={`${msg.localId}-${msg.createTime}-${msg.sortSeq}`}>
                    {showDivider && (
                      <div className="poster-divider"><span>{formatDateDivider(msg.createTime)}</span></div>
                    )}
                    {system ? (
                      <div className="poster-system">{msg.parsedContent}</div>
                    ) : (
                      <div className={`poster-row ${sent ? 'sent' : 'received'}`}>
                        <div className="poster-avatar">
                          {sender.avatarUrl
                            ? <img src={sender.avatarUrl} alt="" referrerPolicy="no-referrer" />
                            : <span>{avatarLetter(sender.name)}</span>}
                        </div>
                        <div className="poster-msg">
                          {!sent && group && <div className="poster-name">{sender.name}</div>}
                          <div className="poster-bubble">{msg.parsedContent || ' '}</div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="poster-card__footer">由 密语 CipherTalk 导出</div>
          </div>
        </div>
      </div>
    </div>
  )
}
