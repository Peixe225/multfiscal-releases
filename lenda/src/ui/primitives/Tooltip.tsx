/**
 * Tooltip (hover after 250ms, keyboard focus, Esc to hide; tap-to-toggle on touch for non-interactive
 * triggers only — a tap on a button just runs the button — and a touch-opened tip hides by itself).
 * Positioned in a portal, flipped/clamped inside the viewport.
 *
 *   <Tooltip content="Próxima decisão em 2 temporadas"><button …/></Tooltip>
 *   <Tooltip card side="bottom" content={<TrophyCard …/>}>…</Tooltip>
 */
import { cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { cx } from './cx'
import { useReducedMotion } from './hooks'

export interface TooltipProps {
  content: ReactNode
  children: ReactElement
  side?: 'top' | 'bottom'
  /** Rich card style (min 200px, padding 10/12). */
  card?: boolean
  delay?: number
  disabled?: boolean
  className?: string
  /** Wrapper element classes (the trigger is wrapped in an inline-flex span). */
  wrapperClassName?: string
}

const ACTIONABLE = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="checkbox"]'

export function Tooltip({ content, children, side = 'top', card, delay = 250, disabled, className, wrapperClassName }: TooltipProps) {
  const id = useId()
  const rm = useReducedMotion()
  const wrap = useRef<HTMLSpanElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const autoHide = useRef<number | undefined>(undefined)
  /** Focus that comes right after a pointer press (on touch it lands after the tap) is not keyboard focus: no tip for it. */
  const pressedAt = useRef(0)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number; side: 'top' | 'bottom' }>({ x: -9999, y: -9999, side })

  const show = useCallback(
    (now = false) => {
      if (disabled) return
      clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setOpen(true), now ? 0 : delay)
    },
    [delay, disabled],
  )
  const hide = useCallback(() => {
    clearTimeout(timer.current)
    clearTimeout(autoHide.current)
    setOpen(false)
  }, [])

  useEffect(
    () => () => {
      clearTimeout(timer.current)
      clearTimeout(autoHide.current)
    },
    [],
  )
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    const onScroll = () => hide()
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, hide])

  useLayoutEffect(() => {
    if (!open || !wrap.current || !tip.current) return
    const r = wrap.current.getBoundingClientRect()
    const t = tip.current.getBoundingClientRect()
    const m = 10
    let s = side
    let y = s === 'top' ? r.top - t.height - m : r.bottom + m
    if (s === 'top' && y < 8) {
      s = 'bottom'
      y = r.bottom + m
    } else if (s === 'bottom' && y + t.height > innerHeight - 8) {
      s = 'top'
      y = r.top - t.height - m
    }
    const x = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8)
    setPos({ x, y, side: s })
  }, [open, side, content])

  const child = isValidElement(children) ? cloneElement(children as ReactElement<Record<string, unknown>>, { 'aria-describedby': open ? id : undefined }) : children

  return (
    <>
      <span
        ref={wrap}
        className={cx('inline-flex max-w-full', wrapperClassName)}
        onPointerEnter={(e) => e.pointerType === 'mouse' && show()}
        onPointerLeave={(e) => e.pointerType === 'mouse' && hide()}
        onPointerDown={() => (pressedAt.current = Date.now())}
        onPointerUp={(e) => {
          if (e.pointerType === 'mouse') return
          if ((e.target as Element).closest?.(ACTIONABLE)) return hide()
          if (open) return hide()
          show(true)
          clearTimeout(autoHide.current)
          autoHide.current = window.setTimeout(hide, card ? 4000 : 1600)
        }}
        onFocus={() => Date.now() - pressedAt.current > 1000 && show(true)}
        onBlur={hide}
      >
        {child}
      </span>
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={tip}
                id={id}
                role="tooltip"
                className={cx('lx-tip', card && 'lx-tip--card', className)}
                style={{ left: pos.x, top: pos.y }}
                initial={{ opacity: 0, y: rm ? 0 : pos.side === 'top' ? 4 : -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                {content}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  )
}
