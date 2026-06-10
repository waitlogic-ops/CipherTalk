import { useEffect, useState } from 'react'
import { PET_STATES, type PetStateId } from './petStates'

/** 空闲彩蛋默认动作池：挥手/跳跃/张望/审视，外加原地跑和左右跑 */
export const DEFAULT_FLAIR_POOL: PetStateId[] = [
  'waving',
  'jumping',
  'waiting',
  'review',
  'running',
  'running-right',
  'running-left',
]

/**
 * 空闲彩蛋调度（Codex 同款）：active 时每隔 6~14 秒随机播一段小动作，
 * 播两圈后回到 null（呼吸待机）。active 变 false 立即清空。
 */
export function useIdleFlair(active: boolean, pool: PetStateId[] = DEFAULT_FLAIR_POOL): PetStateId | null {
  const [flair, setFlair] = useState<PetStateId | null>(null)

  useEffect(() => {
    if (!active) {
      setFlair(null)
      return
    }
    let flairTimer = 0
    let resetTimer = 0
    const schedule = () => {
      flairTimer = window.setTimeout(() => {
        const next = pool[Math.floor(Math.random() * pool.length)]
        setFlair(next)
        resetTimer = window.setTimeout(() => {
          setFlair(null)
          schedule()
        }, PET_STATES[next].durationMs * 2)
      }, 6000 + Math.random() * 8000)
    }
    schedule()
    return () => {
      window.clearTimeout(flairTimer)
      window.clearTimeout(resetTimer)
      setFlair(null)
    }
    // pool 视为常量配置，不参与依赖比较（调用方传字面量会导致每次渲染重建）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return flair
}
