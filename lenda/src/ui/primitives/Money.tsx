/**
 * <Money value={68_000_000} />                 → €68M
 * <Money value={v} from={prev} countUp />      → animated (700ms, like Copero's header)
 * <Money value={14_000_000} delta />           → "↑ €14M" style (+/− coloured)
 */
import type { CSSProperties } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { formatMoney } from './format'
import { useCountUp } from './CountUp'
import { cx } from './cx'

export { formatMoney }

export interface MoneyProps {
  value: number
  from?: number
  countUp?: boolean | { duration?: number; delay?: number; start?: boolean }
  /** Render as a signed delta (green up / red down, with arrow). */
  delta?: boolean
  className?: string
  style?: CSSProperties
}

export function Money({ value, from, countUp, delta, className, style }: MoneyProps) {
  const cu = typeof countUp === 'object' ? countUp : {}
  const v = useCountUp(value, { from: countUp ? from : value, duration: countUp ? (cu.duration ?? 700) : 0, delay: cu.delay, start: cu.start ?? true })
  if (delta) {
    const up = value >= 0
    return (
      <span
        className={cx('num inline-flex items-center gap-1', className)}
        style={{ color: up ? 'var(--positive)' : 'var(--negative)', fontWeight: 700, ...style }}
        aria-label={`${up ? 'valorizou' : 'desvalorizou'} ${formatMoney(Math.abs(value))}`}
      >
        {up ? <ArrowUp size="0.9em" strokeWidth={2.6} aria-hidden /> : <ArrowDown size="0.9em" strokeWidth={2.6} aria-hidden />}
        {formatMoney(Math.abs(v))}
      </span>
    )
  }
  return (
    <span className={cx('num', className)} style={style} aria-label={formatMoney(value)}>
      <span aria-hidden="true">{formatMoney(v)}</span>
    </span>
  )
}
