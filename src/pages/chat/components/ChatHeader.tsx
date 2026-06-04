import { Aperture, Image as ImageIcon, Loader2, Mic, RefreshCw } from 'lucide-react'
import { Button, Tooltip } from '@heroui/react'
import { DateJumpPicker } from './DateJumpPicker'
import type { ChatSession } from '../../../types/models'
import { isGroupChat } from '../utils/messageGuards'
import { SessionAvatar } from './SessionSidebar'

type Progress = {
  current: number
  total: number
}

interface ChatHeaderProps {
  currentSession: ChatSession
  currentSessionId: string | null
  isRefreshingMessages: boolean
  isLoadingMessages: boolean
  isUpdating: boolean
  onRefreshMessages: () => void | Promise<void>
  selectedDate: string
  onSelectedDateChange: (value: string) => void
  onJumpToDate: (dateValue?: string) => void | Promise<void>
  isJumpingToDate: boolean
  isBatchTranscribing: boolean
  batchTranscribeProgress: Progress
  onBatchTranscribe: () => void | Promise<void>
  isBatchDecrypting: boolean
  batchDecryptProgress: Progress
  onBatchDecrypt: () => void | Promise<void>
}

export function ChatHeader({
  currentSession,
  currentSessionId,
  isRefreshingMessages,
  isLoadingMessages,
  isUpdating,
  onRefreshMessages,
  selectedDate,
  onSelectedDateChange,
  onJumpToDate,
  isJumpingToDate,
  isBatchTranscribing,
  batchTranscribeProgress,
  onBatchTranscribe,
  isBatchDecrypting,
  batchDecryptProgress,
  onBatchDecrypt
}: ChatHeaderProps) {
  return (
    <div className="message-header">
      <SessionAvatar session={currentSession} size={40} />
      <div className="header-info">
        <h3>
          {currentSession.displayName || currentSession.username}
          {currentSession.isWeCom && (
            currentSession.weComCorp
              ? <span className="wecom-corp" title="企业微信">@{currentSession.weComCorp}</span>
              : <span className="wecom-badge" title="企业微信">企</span>
          )}
        </h3>
        {isGroupChat(currentSession.username) && (
          <div className="header-subtitle">群聊</div>
        )}
      </div>
      <div className="header-actions">
        <Tooltip delay={0}>
          <Tooltip.Trigger>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="刷新消息"
              onPress={onRefreshMessages}
              isDisabled={isRefreshingMessages || isLoadingMessages}
            >
              <RefreshCw size={18} className={isRefreshingMessages || isUpdating ? 'animate-spin' : ''} />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>刷新消息</Tooltip.Content>
        </Tooltip>

        {!isGroupChat(currentSession.username) && (
          <Tooltip delay={0}>
            <Tooltip.Trigger>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label="查看朋友圈"
                onPress={() => window.electronAPI.window.openMomentsWindow(currentSession.username)}
              >
                <Aperture size={18} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>查看朋友圈</Tooltip.Content>
          </Tooltip>
        )}

        <DateJumpPicker
          value={selectedDate}
          onChange={onSelectedDateChange}
          onJump={onJumpToDate}
          disabled={!currentSessionId || isJumpingToDate}
          loading={isJumpingToDate}
        />

        <Tooltip delay={0}>
          <Tooltip.Trigger>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="批量语音转文字"
              onPress={onBatchTranscribe}
              isDisabled={isBatchTranscribing || !currentSessionId}
            >
              {isBatchTranscribing ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>
            {isBatchTranscribing ? `批量转写中 (${batchTranscribeProgress.current}/${batchTranscribeProgress.total})` : '批量语音转文字'}
          </Tooltip.Content>
        </Tooltip>

        <Tooltip delay={0}>
          <Tooltip.Trigger>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="批量解密图片"
              onPress={onBatchDecrypt}
              isDisabled={isBatchDecrypting || !currentSessionId}
            >
              {isBatchDecrypting ? <Loader2 size={18} className="animate-spin" /> : <ImageIcon size={18} />}
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>
            {isBatchDecrypting ? `批量解密中 (${batchDecryptProgress.current}/${batchDecryptProgress.total})` : '批量解密图片'}
          </Tooltip.Content>
        </Tooltip>
      </div>
    </div>
  )
}
