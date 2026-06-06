/**
 * AI Agent 对话页（Phase C）——使用 AI SDK 的 useChat + AI Elements 组件。
 * 数据：useChat 走 IpcChatTransport（IPC → AI 子进程 → 流式 UIMessageChunk）。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useChat } from '@ai-sdk/react'
import { isToolUIPart, type ChatStatus } from 'ai'
import { BarChart3, Braces, Brain, CheckIcon, Clock3, FileText, Image as ImageIcon, Search, Wrench } from 'lucide-react'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageAttachment, MessageAttachments, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputProvider,
  PromptInputSpeechButton,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
  usePromptInputController,
} from '@/components/ai-elements/prompt-input'
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from '@/components/ai-elements/model-selector'
import { Button } from '@/components/ui/button'
import AIProviderLogo from '@/components/ai/AIProviderLogo'
import { getAIProviders, type AIModelInfo, type AIProviderInfo } from '@/types/ai'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from '@/components/ai-elements/chain-of-thought'
import { Loader } from '@/components/ai-elements/loader'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { IpcChatTransport, type AgentModelConfig, type AgentReasoningEffort } from '@/features/aiagent/transport/ipcChatTransport'
import * as configService from '@/services/config'

const PROMPT_PRESETS = [
  { label: '最近聊了什么', text: '最近一周我和大家主要聊了什么？按主题总结，并列出关键时间。', icon: Clock3 },
  { label: '找相关记录', text: '帮我找一下最近聊到“”的聊天记录，按相关度排序。', icon: Search },
  { label: '统计高频联系人', text: '统计最近一个月互动最多的联系人，并说明互动高峰时间。', icon: BarChart3 },
]

const REASONING_EFFORT_OPTIONS: Array<{ value: AgentReasoningEffort; label: string }> = [
  { value: 'auto', label: '思考：自动' },
  { value: 'minimal', label: '思考：最少' },
  { value: 'low', label: '思考：低' },
  { value: 'medium', label: '思考：中' },
  { value: 'high', label: '思考：高' },
]

function PromptPresetMenuItem({ label, text, icon: Icon }: (typeof PROMPT_PRESETS)[number]) {
  const { textInput } = usePromptInputController()
  return (
    <PromptInputActionMenuItem onSelect={() => textInput.setInput(text)}>
      <Icon className="size-4" />
      {label}
    </PromptInputActionMenuItem>
  )
}

function AgentPromptSubmit({ busy, status }: { busy: boolean; status: ChatStatus }) {
  const { textInput, attachments } = usePromptInputController()
  const disabled = !busy && !textInput.value.trim() && attachments.files.length === 0
  return <PromptInputSubmit disabled={disabled} status={status} />
}

type AgentModelItem = {
  chef: string
  chefSlug: string
  id: string
  name: string
  modelDetail?: AIModelInfo
}

// 与设置页 ModelCapabilityStrip 同一套能力图标
const CAPABILITY_ICONS = [
  { key: 'reasoning', label: '推理', icon: Brain, on: (d: AIModelInfo) => d.capabilities.reasoning },
  { key: 'tool', label: '工具调用', icon: Wrench, on: (d: AIModelInfo) => d.capabilities.toolCall },
  { key: 'structured', label: '结构化输出', icon: Braces, on: (d: AIModelInfo) => d.capabilities.structuredOutput },
  { key: 'image', label: '图像输入', icon: ImageIcon, on: (d: AIModelInfo) => d.modalities.input.includes('image') },
  { key: 'pdf', label: 'PDF', icon: FileText, on: (d: AIModelInfo) => d.modalities.input.includes('pdf') },
]

function ModelCapabilityIcons({ detail }: { detail: AIModelInfo }) {
  const active = CAPABILITY_ICONS.filter((item) => item.on(detail))
  if (active.length === 0) return null
  return (
    <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
      {active.map(({ key, label, icon: Icon }) => (
        <span className="inline-flex" key={key} title={`${label}：支持`}>
          <Icon className="size-3.5" />
        </span>
      ))}
    </span>
  )
}

const ModelItem = memo(
  ({ model, selectedModel, onSelect }: { model: AgentModelItem; selectedModel: string; onSelect: (id: string) => void }) => {
    const handleSelect = useCallback(() => onSelect(model.id), [onSelect, model.id])
    return (
      <ModelSelectorItem key={model.id} onSelect={handleSelect} value={model.id}>
        {model.chefSlug && <AIProviderLogo providerId={model.chefSlug} alt={model.chef} className="shrink-0" size={20} />}
        <ModelSelectorName>{model.name}</ModelSelectorName>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {model.modelDetail && <ModelCapabilityIcons detail={model.modelDetail} />}
          {selectedModel === model.id ? <CheckIcon className="size-4" /> : <div className="size-4" />}
        </span>
      </ModelSelectorItem>
    )
  }
)
ModelItem.displayName = 'ModelItem'

function MessageChainOfThought({ active, children }: { active: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(active)
  const prevActive = useRef(active)
  useEffect(() => {
    if (prevActive.current !== active) {
      prevActive.current = active
      setOpen(active)
    }
  }, [active])
  return (
    <ChainOfThought onOpenChange={setOpen} open={open}>
      <ChainOfThoughtHeader />
      <ChainOfThoughtContent>{children}</ChainOfThoughtContent>
    </ChainOfThought>
  )
}

function formatToolName(toolName: string) {
  return toolName.replace(/[_-]+/g, ' ')
}

function renderChainLabel(label: string, active: boolean) {
  if (!active) return label
  return (
    <Shimmer as="span" duration={1.25}>
      {label}
    </Shimmer>
  )
}

function collectToolBadges(value: unknown, badges: string[] = []): string[] {
  if (badges.length >= 6 || value == null) return badges
  if (typeof value === 'string') {
    const matches = value.match(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s"'<>)]*)?/gi) || []
    for (const match of matches) {
      const normalized = match.replace(/^https?:\/\//i, '').replace(/\/$/, '')
      if (!badges.includes(normalized)) badges.push(normalized)
      if (badges.length >= 6) break
    }
    return badges
  }
  if (Array.isArray(value)) {
    for (const item of value) collectToolBadges(item, badges)
    return badges
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectToolBadges(item, badges)
  }
  return badges
}

export default function AgentPage() {
  const [presets, setPresets] = useState<configService.AiConfigPreset[]>([])
  const [providersInfo, setProvidersInfo] = useState<AIProviderInfo[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState('current')
  const [reasoningEffort, setReasoningEffort] = useState<AgentReasoningEffort>('auto')
  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) || null,
    [presets, selectedPresetId]
  )
  const modelInfoByKey = useMemo(() => {
    const map = new Map<string, AIModelInfo>()
    for (const provider of providersInfo) {
      for (const detail of provider.modelDetails || []) {
        map.set(`${provider.id}::${detail.id}`, detail)
        if (!map.has(detail.id)) map.set(detail.id, detail)
      }
    }
    return map
  }, [providersInfo])
  const models = useMemo<AgentModelItem[]>(() => {
    const list = presets.map((preset) => ({
      chef: preset.provider || '其他',
      chefSlug: preset.provider || '',
      id: preset.id,
      name: preset.name,
      modelDetail: modelInfoByKey.get(`${preset.provider}::${preset.model}`) || modelInfoByKey.get(preset.model),
    }))
    return [{ chef: '默认', chefSlug: '', id: 'current', name: '当前配置' }, ...list]
  }, [presets, modelInfoByKey])
  const chefs = useMemo(() => [...new Set(models.map((model) => model.chef))], [models])
  const selectedModelData = models.find((model) => model.id === selectedPresetId)
  const selectedModelConfig = useMemo<AgentModelConfig | null>(() => {
    if (!selectedPreset) return { reasoningEffort }
    return {
      provider: selectedPreset.provider,
      apiKey: selectedPreset.apiKey,
      model: selectedPreset.model,
      baseURL: selectedPreset.baseURL,
      protocol: selectedPreset.protocol,
      reasoningEffort,
    }
  }, [selectedPreset, reasoningEffort])
  const selectedModelConfigRef = useRef<AgentModelConfig | null>(null)
  selectedModelConfigRef.current = selectedModelConfig

  const transport = useMemo(
    () => new IpcChatTransport({ kind: 'global' }, () => selectedModelConfigRef.current),
    []
  )
  const { messages, sendMessage, status, stop } = useChat({ transport })
  const [modelOpen, setModelOpen] = useState(false)
  const busy = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    let cancelled = false
    void configService.getAiConfigPresets().then((items) => {
      if (cancelled) return
      setPresets(items)
      setSelectedPresetId((current) => {
        if (current !== 'current' && items.some((item) => item.id === current)) return current
        return items[0]?.id || 'current'
      })
    })
    void getAIProviders().then((items) => {
      if (!cancelled) setProvidersInfo(items)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = (message: PromptInputMessage) => {
    if (busy) {
      void stop()
      return
    }
    const text = message.text.trim()
    if (!text && message.files.length === 0) return
    void sendMessage({ text, files: message.files })
  }

  const handleModelSelect = useCallback((id: string) => {
    setSelectedPresetId(id)
    setModelOpen(false)
  }, [])

  return (
    <div style={{ '--agent-radius': '12px', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } as CSSProperties}>
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="AI 助手"
              description="用自然语言问问你的聊天记录吧"
            />
          ) : (
            messages.map((message, messageIndex) => {
              const chainParts = message.parts.filter((part) => part.type === 'reasoning' || isToolUIPart(part))
              const isLastMessage = messageIndex === messages.length - 1
              const lastPart = message.parts[message.parts.length - 1]
              const isReasoningStreaming = isLastMessage && status === 'streaming' && lastPart?.type === 'reasoning'
              const chainActive = isLastMessage && busy
              return (
                <Message from={message.role} key={message.id}>
                  <MessageContent>
                    {chainParts.length > 0 && (
                      <MessageChainOfThought active={chainActive}>
                        {chainParts.map((part, index) => {
                          if (part.type === 'reasoning') {
                            const reasoningActive = isReasoningStreaming && index === chainParts.length - 1
                            return (
                              <ChainOfThoughtStep
                                icon={Brain}
                                key={`chain-${index}`}
                                label={renderChainLabel('Reasoning', reasoningActive)}
                                status={reasoningActive ? 'active' : 'complete'}
                              >
                                <div className="whitespace-pre-wrap text-muted-foreground text-sm">
                                  {part.text}
                                </div>
                              </ChainOfThoughtStep>
                            )
                          }
                          const toolName = part.type.replace(/^tool-/, '')
                          const done = part.state === 'output-available' || part.state === 'output-error'
                          const toolLabel = formatToolName(toolName)
                          const badges = collectToolBadges(part.input)
                          if (part.state === 'output-available') collectToolBadges(part.output, badges)
                          return (
                            <ChainOfThoughtStep
                              icon={toolName.includes('search') ? Search : Wrench}
                              key={`chain-${index}`}
                              label={renderChainLabel(toolLabel, !done)}
                              status={done ? 'complete' : 'active'}
                            >
                              {badges.length > 0 && (
                                <ChainOfThoughtSearchResults>
                                  {badges.map((badge) => (
                                    <ChainOfThoughtSearchResult key={badge}>
                                      {badge}
                                    </ChainOfThoughtSearchResult>
                                  ))}
                                </ChainOfThoughtSearchResults>
                              )}
                              {part.state === 'output-error' && part.errorText && (
                                <p className="text-destructive text-xs">{part.errorText}</p>
                              )}
                            </ChainOfThoughtStep>
                          )
                        })}
                      </MessageChainOfThought>
                    )}
                    {message.parts.map((part, index) => {
                      if (part.type === 'text') {
                        return <MessageResponse key={`text-${index}`}>{part.text}</MessageResponse>
                      }
                      if (part.type === 'file') {
                        return (
                          <MessageAttachments key={`file-${index}`}>
                            <MessageAttachment data={part} />
                          </MessageAttachments>
                        )
                      }
                      return null
                    })}
                  </MessageContent>
                </Message>
              )
            })
          )}
          {status === 'submitted' && <Loader />}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div style={{ padding: 12 }}>
        <PromptInputProvider>
          <PromptInput
            accept="image/*,.txt,.md,.json,.csv"
            className="**:data-[slot=input-group]:rounded-[var(--agent-radius,12px)] **:data-[slot=input-group]:border-border/60 **:data-[slot=input-group]:bg-card/80 **:data-[slot=input-group]:shadow-lg **:data-[slot=input-group]:backdrop-blur-xl"
            maxFiles={6}
            maxFileSize={8 * 1024 * 1024}
            multiple
            onSubmit={handleSubmit}
          >
            <PromptInputHeader className="border-b">
              <PromptInputAttachments className="p-0">
                {(attachment) => <PromptInputAttachment data={attachment} />}
              </PromptInputAttachments>
            </PromptInputHeader>

            <PromptInputBody>
              <PromptInputTextarea placeholder="问问你的聊天记录，Enter 发送，Shift + Enter 换行…" />
            </PromptInputBody>

            <PromptInputFooter>
              <PromptInputTools className="flex-wrap">
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger aria-label="更多输入操作" />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments label="添加图片或文件" />
                    {PROMPT_PRESETS.map((preset) => (
                      <PromptPresetMenuItem key={preset.label} {...preset} />
                    ))}
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                <PromptInputSpeechButton aria-label="语音输入" language="zh-CN" />

                <PromptInputSelect
                  onValueChange={(value) => setReasoningEffort(value as AgentReasoningEffort)}
                  value={reasoningEffort}
                >
                  <PromptInputSelectTrigger aria-label="思考程度" className="h-8 gap-1.5 rounded-[var(--agent-radius,12px)] px-2.5">
                    <Brain className="size-3.5" />
                    <PromptInputSelectValue />
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent align="start" position="popper" side="top">
                    {REASONING_EFFORT_OPTIONS.map((option) => (
                      <PromptInputSelectItem key={option.value} value={option.value}>
                        {option.label}
                      </PromptInputSelectItem>
                    ))}
                  </PromptInputSelectContent>
                </PromptInputSelect>

                <ModelSelector onOpenChange={setModelOpen} open={modelOpen}>
                  <ModelSelectorTrigger asChild>
                    <Button className="max-w-48 rounded-[var(--agent-radius,12px)] border-border/60 bg-transparent hover:bg-accent/50" variant="outline">
                      {selectedModelData?.chefSlug && (
                        <AIProviderLogo providerId={selectedModelData.chefSlug} alt={selectedModelData.chef} className="shrink-0" size={18} />
                      )}
                      {selectedModelData?.name && (
                        <ModelSelectorName>{selectedModelData.name}</ModelSelectorName>
                      )}
                    </Button>
                  </ModelSelectorTrigger>
                  <ModelSelectorContent>
                    <ModelSelectorInput placeholder="搜索模型..." />
                    <ModelSelectorList>
                      <ModelSelectorEmpty>没有匹配的模型</ModelSelectorEmpty>
                      {chefs.map((chef) => (
                        <ModelSelectorGroup heading={chef} key={chef}>
                          {models
                            .filter((model) => model.chef === chef)
                            .map((model) => (
                              <ModelItem
                                key={model.id}
                                model={model}
                                onSelect={handleModelSelect}
                                selectedModel={selectedPresetId}
                              />
                            ))}
                        </ModelSelectorGroup>
                      ))}
                    </ModelSelectorList>
                  </ModelSelectorContent>
                </ModelSelector>
              </PromptInputTools>

              <AgentPromptSubmit busy={busy} status={status} />
            </PromptInputFooter>
          </PromptInput>
        </PromptInputProvider>
      </div>
    </div>
  )
}
