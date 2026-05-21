import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import './Select.scss'

export interface SelectOption<T extends string | number = string> {
  value: T
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

interface SelectProps<T extends string | number = string> {
  options: readonly SelectOption<T>[]
  value: T
  onChange: (value: T) => void
  placeholder?: string
  className?: string
  style?: CSSProperties
}

function Select<T extends string | number = string>({
  options,
  value,
  onChange,
  placeholder = '请选择',
  className = '',
  style
}: SelectProps<T>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [triggerH, setTriggerH] = useState(0)
  const [listH, setListH] = useState(0)

  // 测量触发器与列表高度 —— 盒子靠显式高度才能平滑「生长」
  useLayoutEffect(() => {
    setTriggerH(triggerRef.current?.offsetHeight ?? 0)
    setListH(listRef.current?.scrollHeight ?? 0)
  }, [options])

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = options.find((o) => o.value === value)
  const classes = ['glass-select', open ? 'open' : '', className].filter(Boolean).join(' ')
  const boxHeight = triggerH ? (open ? triggerH + listH : triggerH) : undefined

  return (
    <div
      className={classes}
      style={{ ...style, height: triggerH || undefined }}
      ref={rootRef}
    >
      <div className="glass-select-box" style={{ height: boxHeight }}>
        <button
          ref={triggerRef}
          type="button"
          className="glass-select-trigger"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="glass-select-value">{selected?.label ?? placeholder}</span>
          <ChevronDown size={16} className="glass-select-arrow" />
        </button>
        <div className="glass-select-list" ref={listRef} role="listbox">
          {options.map((option, index) => (
            <button
              key={String(option.value)}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              style={{ ['--i']: index } as CSSProperties}
              className={`glass-select-option ${option.value === value ? 'is-selected' : ''}`}
              onClick={() => {
                if (option.disabled) return
                onChange(option.value)
                setOpen(false)
              }}
            >
              <span className="glass-select-option-main">
                <span className="glass-select-option-label">{option.label}</span>
                {option.description && (
                  <span className="glass-select-option-desc">{option.description}</span>
                )}
              </span>
              {option.value === value && (
                <Check size={15} className="glass-select-option-check" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Select
