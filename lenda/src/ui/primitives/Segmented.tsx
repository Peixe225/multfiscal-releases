/**
 * Segmented control (radio group) with an animated thumb.
 *
 *   <Segmented aria-label="Ritmo" value={pace} onChange={setPace}
 *     options={[{ value: 'intensa', label: 'Intensa' }, { value: 'normal', label: 'Normal' }, { value: 'expressa', label: 'Expressa' }]} />
 *   <Segmented variant="solid" full … />   // identity foot choice (white selected)
 */
import { useId, useRef, type ComponentType, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { motion } from 'motion/react'
import type { LucideProps } from 'lucide-react'
import { cx } from './cx'
import { useReducedMotion } from './hooks'
import { sfx } from '@/ui/shell/sfx'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  icon?: ComponentType<LucideProps>
  disabled?: boolean
  /** Tooltip / accessible description. */
  hint?: string
}

export interface SegmentedProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: SegmentOption<T>[]
  variant?: 'track' | 'solid'
  /** Stretch items to fill the width. */
  full?: boolean
  size?: 'sm' | 'md'
  'aria-label': string
  className?: string
  style?: CSSProperties
}

export function Segmented<T extends string>({ value, onChange, options, variant = 'track', full, size = 'md', className, style, ...aria }: SegmentedProps<T>) {
  const id = useId()
  const rm = useReducedMotion()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const idx = Math.max(0, options.findIndex((o) => o.value === value))

  const move = (e: KeyboardEvent, dir: number) => {
    e.preventDefault()
    const n = options.length
    for (let k = 1; k <= n; k++) {
      const j = (idx + dir * k + n) % n
      if (!options[j].disabled) {
        onChange(options[j].value)
        refs.current[j]?.focus()
        sfx.play('tap')
        return
      }
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={aria['aria-label']}
      className={cx('lx-seg lx-seg--animated', variant === 'solid' && 'lx-seg--solid', full && 'lx-seg--full', className)}
      style={style}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(e, 1)
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(e, -1)
      }}
    >
      {options.map((o, i) => {
        const on = o.value === value
        const Ico = o.icon
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={o.disabled}
            title={o.hint}
            className={cx('lx-seg__item', on && 'is-on')}
            style={size === 'sm' ? { height: 28, padding: '0 11px', fontSize: 12.5 } : undefined}
            onClick={() => {
              if (!on) {
                sfx.play('tap')
                onChange(o.value)
              }
            }}
          >
            {on && (
              <motion.span
                layoutId={`seg-${id}`}
                className="lx-seg__thumb"
                transition={rm ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40, mass: 0.8 }}
                aria-hidden="true"
              />
            )}
            <span className="lx-seg__label">
              {Ico && <Ico size={15} aria-hidden />}
              {o.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
