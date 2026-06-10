import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useCurrentPetLoader } from '@/features/pets/PetContext'
import { PetSprite } from '@/features/pets/PetSprite'
import { petStateForAgent, type PetAgentState, type PetStateId } from '@/features/pets/petStates'
import { useIdleFlair } from '@/features/pets/useIdleFlair'

/**
 * 桌面悬浮桌宠窗口（透明无边框，跟随 Agent 运行状态切动画）。
 * 整个窗口是拖拽区域，悬停时右上角出现关闭按钮；拖动时按方向播跑/跳动画。
 */
export default function PetWindow() {
  const pet = useCurrentPetLoader()
  const [agentState, setAgentState] = useState<PetAgentState>('idle')
  const [dragState, setDragState] = useState<PetStateId | null>(null)

  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    const root = document.getElementById('root')
    if (root) root.style.background = 'transparent'
  }, [])

  useEffect(() => {
    let doneTimer = 0
    const off = window.electronAPI.pet.onAgentState((state) => {
      window.clearTimeout(doneTimer)
      if (state === 'done') {
        setAgentState('done')
        doneTimer = window.setTimeout(() => setAgentState('idle'), 2600)
        return
      }
      if (state === 'running' || state === 'failed' || state === 'idle') {
        setAgentState(state)
      }
    })
    return () => {
      window.clearTimeout(doneTimer)
      off()
    }
  }, [])

  // 拖动动作：一拖就锁定跑姿（默认原地跑），只在有明确水平位移时切左/右跑方向，
  // 期间绝不切别的动作避免闪烁；停止移动 800ms 后才复原。
  useEffect(() => {
    let lastX: number | null = null
    let settleTimer = 0
    const off = window.electronAPI.pet.onWindowMove((x) => {
      window.clearTimeout(settleTimer)
      setDragState((current) => {
        let next: PetStateId = current ?? 'running'
        if (lastX !== null) {
          const dx = x - lastX
          if (dx > 2) next = 'running-right'
          else if (dx < -2) next = 'running-left'
          // |dx| ≤ 2：保持当前跑姿不变
        }
        return next
      })
      lastX = x
      settleTimer = window.setTimeout(() => {
        setDragState(null)
        lastX = null
      }, 800)
    })
    return () => {
      window.clearTimeout(settleTimer)
      off()
    }
  }, [])

  // 空闲彩蛋（Codex 同款）：待机且没在拖动时，不定时来一段随机小动作
  const flair = useIdleFlair(agentState === 'idle' && dragState === null)

  const state: PetStateId = dragState
    ?? (agentState === 'idle' && flair ? flair : petStateForAgent(agentState))

  return (
    <div
      className="group flex h-screen w-screen flex-col items-center justify-end overflow-hidden pb-1"
      style={{ WebkitAppRegion: 'drag', background: 'transparent' } as React.CSSProperties}
    >
      <button
        aria-label="收起桌宠"
        className="absolute top-1 right-1 rounded-full bg-black/30 p-1 text-white/80 opacity-0 transition-opacity hover:bg-black/50 group-hover:opacity-100"
        onClick={() => void window.electronAPI.pet.toggleDesktopWindow(false)}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        type="button"
      >
        <X className="size-3.5" />
      </button>
      {pet ? (
        <>
          <PetSprite label={pet.displayName} scale={0.62} src={pet.spriteUrl} state={state} />
          <span className="mt-0.5 rounded-full bg-black/30 px-2 py-0.5 text-[10px] text-white/90 opacity-0 transition-opacity group-hover:opacity-100">
            {pet.displayName}
          </span>
        </>
      ) : (
        <span className="rounded-(--agent-radius,12px) bg-black/40 px-3 py-2 text-center text-white/90 text-xs">
          还没选宠物
          <br />
          去「AI 宠物」页挑一只吧
        </span>
      )}
    </div>
  )
}
