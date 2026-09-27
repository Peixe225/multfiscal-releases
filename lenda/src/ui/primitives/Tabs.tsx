/**
 * Tabs with an animated indicator (sliding pill or underline) + roving focus.
 *
 *   <Tabs aria-label="Painel" idPrefix="cockpit" value={tab} onChange={setTab}
 *     tabs={[{ value: 'carreira', label: 'Carreira', icon: LineChart }, { value: 'premios', label: 'Prêmios', badge: 'BOLA 3º' }]} />
 *   <TabPanel idPrefix="cockpit" value="carreira" active={tab === 'carreira'}>…</TabPanel>
 */
import { useId, useRef, type ComponentType, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { motion } from 'motion/react'
import type { LucideProps } from 'lucide-react'
import { cx } from './cx'
import { useReducedMotion } from './hooks'
import { sfx } from '@/ui/shell/sfx'

export interface TabItem<T extends string> {
  value: T
  label: ReactNode
  icon?: ComponentType<LucideProps>
  /** Amber badge after the label ("BOLA 3º", "2"). */
  badge?: ReactNode
  disabled?: boolean
}

export interface TabsProps<T extends string> {
  value: T
  onChange: (value: T) => void
  tabs: TabItem<T>[]
  /** 'pill' (mockup: selected = surface-2 + ring) or 'underline'. */
  variant?: 'pill' | 'underline'
  idPrefix?: string
  'aria-label': string
  className?: string
  style?: CSSProperties
}

export function Tabs<T extends string>({ value, onChange, tabs, variant = 'pill', idPrefix, className, style, ...aria }: TabsProps<T>) {
  const auto = useId()
  const prefix = idPrefix ?? `tabs${auto.replace(/:/g, '')}`
  const rm = useReducedMotion()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const idx = Math.max(0, tabs.findIndex((t) => t.value === value))

  const focusTo = (e: KeyboardEvent, j: number) => {
    e.preventDefault()
    const t = tabs[j]
    if (!t || t.disabled) return
    onChange(t.value)
    refs.current[j]?.focus()
    refs.current[j]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: rm ? 'auto' : 'smooth' })
  }
  const step = (e: KeyboardEvent, dir: number) => {
    const n = tabs.length
    for (let k = 1; k <= n; k++) {
      const j = (idx + dir * k + n) % n
      if (!tabs[j].disabled) return focusTo(e, j)
    }
  }

  return (
    <div
      role="tablist"
      aria-label={aria['aria-label']}
      className={cx('lx-tabs', variant === 'pill' ? 'lx-tabs--pill' : 'lx-tabs--underline', className)}
      style={style}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') step(e, 1)
        else if (e.key === 'ArrowLeft') step(e, -1)
        else if (e.key === 'Home') focusTo(e, 0)
        else if (e.key === 'End') focusTo(e, tabs.length - 1)
      }}
    >
      {tabs.map((t, i) => {
        const on = t.value === value
        const Ico = t.icon
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            id={`${prefix}-tab-${t.value}`}
            role="tab"
            type="button"
            aria-selected={on}
            aria-controls={`${prefix}-panel-${t.value}`}
            tabIndex={on ? 0 : -1}
            disabled={t.disabled}
            className="lx-tab"
            onClick={() => {
              if (!on) {
                sfx.play('tap')
                onChange(t.value)
              }
            }}
          >
            {on && (
              <motion.span
                layoutId={`tab-${prefix}`}
                className="lx-tabs__ind"
                transition={rm ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 38 }}
                aria-hidden="true"
              />
            )}
            <span className="lx-tabs__label">
              {Ico && <Ico size={16} aria-hidden />}
              {t.label}
              {t.badge != null && <span className="lx-tab__badge">{t.badge}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel({ idPrefix, value, active, children, className, keepMounted }: { idPrefix: string; value: string; active: boolean; children: ReactNode; className?: string; keepMounted?: boolean }) {
  if (!active && !keepMounted) return null
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${value}`} aria-labelledby={`${idPrefix}-tab-${value}`} hidden={!active} tabIndex={0} className={className}>
      {children}
    </div>
  )
}
