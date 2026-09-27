/**
 * <Switch checked={on} onChange={setOn} label="Som" description="Efeitos sonoros sintetizados" />
 */
import { useId, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { cx } from './cx'
import { useReducedMotion } from './hooks'
import { sfx } from '@/ui/shell/sfx'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
  className?: string
}

export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
  const id = useId()
  const rm = useReducedMotion()
  return (
    <div className={cx('flex items-center gap-3 min-h-[44px]', disabled && 'opacity-50', className)}>
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-[13.5px] font-semibold text-text cursor-pointer">
          {label}
        </label>
        {description && <div className="text-[12px] text-text-3 mt-0.5">{description}</div>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => {
          sfx.play('tap')
          onChange(!checked)
        }}
        className="relative flex-none w-[46px] h-[28px] rounded-pill border transition-colors duration-200"
        style={{
          background: checked ? 'var(--positive)' : 'rgba(0,0,0,.35)',
          borderColor: checked ? 'transparent' : 'var(--border-strong)',
          boxShadow: checked ? '0 0 16px -4px color-mix(in srgb, var(--positive) 70%, transparent)' : undefined,
        }}
      >
        <motion.span
          className="absolute top-[3px] left-[3px] w-5 h-5 rounded-full bg-white"
          style={{ boxShadow: '0 2px 6px rgba(0,0,0,.4)' }}
          animate={{ x: checked ? 18 : 0 }}
          transition={rm ? { duration: 0 } : { type: 'spring', stiffness: 600, damping: 36 }}
          aria-hidden
        />
      </button>
    </div>
  )
}
