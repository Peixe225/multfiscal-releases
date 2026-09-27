/**
 * Count-up (Copero `yo`: rAF, ease-out cubic, Math.round). Respects reduced motion / skip.
 *
 *   const v = useCountUp(to, { from, duration: 1700, start: phase === 'ovr' })
 *   <CountUp to={147} from={116} duration={500} format={formatInt} />
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useSkipAnimations } from './hooks'

export const easeOutCubic = (u: number) => 1 - (1 - u) ** 3

export interface CountUpOptions {
  /** Start value. Default: previous `to` (animates from the last shown value). */
  from?: number
  /** ms. Default 700. */
  duration?: number
  /** When false the hook holds `from` (e.g. until its reveal phase). Default true. */
  start?: boolean
  /** Delay before starting, ms. */
  delay?: number
  /** Decimal places (0 = integers, Copero behaviour). */
  decimals?: number
  /** Called on each integer step (e.g. SFX tick). */
  onStep?: (value: number) => void
  onDone?: () => void
}

export function useCountUp(to: number, opts: CountUpOptions = {}): number {
  const { duration = 700, start = true, delay = 0, decimals = 0 } = opts
  const skip = useSkipAnimations()
  const last = useRef<number>(opts.from ?? to)
  const [value, setValue] = useState<number>(opts.from ?? to)
  const cbs = useRef(opts)
  cbs.current = opts

  useEffect(() => {
    const from = opts.from ?? last.current
    if (!start) {
      setValue(from)
      return
    }
    if (skip || duration <= 0 || from === to) {
      last.current = to
      setValue(to)
      cbs.current.onDone?.()
      return
    }
    let raf = 0
    let t0 = 0
    let prevShown = from
    const p = 10 ** decimals
    const tick = (now: number) => {
      if (!t0) t0 = now
      const u = Math.min(1, (now - t0) / duration)
      const v = Math.round((from + (to - from) * easeOutCubic(u)) * p) / p
      if (v !== prevShown) {
        prevShown = v
        setValue(v)
        cbs.current.onStep?.(v)
      }
      if (u < 1) raf = requestAnimationFrame(tick)
      else {
        last.current = to
        cbs.current.onDone?.()
      }
    }
    const timer = window.setTimeout(() => (raf = requestAnimationFrame(tick)), delay)
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(raf)
      last.current = prevShown
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, start, skip, duration, delay, decimals, opts.from])

  return value
}

export interface CountUpProps extends CountUpOptions {
  to: number
  format?: (v: number) => string
  className?: string
  style?: CSSProperties
  /** Screen readers get the final value immediately (live region off by default). */
  'aria-live'?: 'off' | 'polite'
}

export function CountUp({ to, format, className, style, 'aria-live': live = 'off', ...opts }: CountUpProps) {
  const v = useCountUp(to, opts)
  const text = format ? format(v) : String(v)
  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums', ...style }} aria-live={live}>
      <span aria-hidden="true">{text}</span>
      <span className="lx-sr-only">{format ? format(to) : String(to)}</span>
    </span>
  )
}
