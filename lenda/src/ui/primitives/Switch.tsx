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
  // a linha inteira (rótulo + descrição) é o alvo do toque: o <label for> aciona o botão; o botão tem 44 px de área
  return (
    <label htmlFor={id} className={cx('flex items-center gap-3 min-h-[48px] py-1 cursor-pointer select-none', disabled && 'opacity-50 cursor-default', className)}>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-text">{label}</span>
        {description && <span className="block text-[12px] text-text-3 mt-0.5">{description}</span>}
      </span>
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
        className="relative flex-none w-[46px] h-[28px] rounded-pill border transition-colors duration-200 before:absolute before:-inset-2 before:content-['']"
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
    </label>
  )
}
