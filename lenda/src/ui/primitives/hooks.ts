import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useApp, selectReducedMotion } from '@/store/app'

/** Effective reduced motion (in-game setting, else OS). */
export function useReducedMotion(): boolean {
  return useApp(selectReducedMotion)
}

/** Skip-animations setting OR reduced motion → jump to end states. */
export function useSkipAnimations(): boolean {
  const skip = useApp((s) => s.settings.skipAnimations)
  const rm = useReducedMotion()
  return skip || rm
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => matchMedia(query).matches,
    () => false,
  )
}

/** ≥ 720px (md) → dialogs instead of bottom sheets. */
export const useIsDesktop = () => useMediaQuery('(min-width: 45rem)')
/** ≥ 1104px (lg) → two-column cockpit. */
export const useIsWide = () => useMediaQuery('(min-width: 69rem)')
/** Touch-first device (hide kbd hints). */
export const useIsTouch = () => useMediaQuery('(hover: none) and (pointer: coarse)')

/** Previous value of a prop (for delta animations). */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined)
  const [prev, setPrev] = useState<T | undefined>(undefined)
  useEffect(() => {
    setPrev(ref.current)
    ref.current = value
  }, [value])
  return prev
}

/** Stable unique id prefix (React 19 useId is fine, but SVG ids need no colons). */
let uid = 0
export function useSvgId(prefix = 'lx'): string {
  const ref = useRef<string | null>(null)
  if (ref.current == null) ref.current = `${prefix}-${(++uid).toString(36)}`
  return ref.current
}

/** Keyboard shortcut (ignored while typing in inputs). */
export function useHotkey(keys: string | string[], handler: (e: KeyboardEvent) => void, enabled = true) {
  const h = useRef(handler)
  h.current = handler
  useEffect(() => {
    if (!enabled) return
    const list = (Array.isArray(keys) ? keys : [keys]).map((k) => k.toLowerCase())
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (list.includes(e.key.toLowerCase())) h.current(e)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [enabled, Array.isArray(keys) ? keys.join('|') : keys])
}
