/**
 * Ganchos do Modo Imersivo: atalhos de teclado que respeitam diálogos abertos, som só depois do
 * primeiro gesto (sem avisos de autoplay ao recarregar no meio da partida) e foco preso em overlays.
 */
import { useEffect, useRef, type RefObject } from 'react'
import { sfx } from '@/ui/shell/sfx'

/** Algum diálogo modal do app está aberto (Modal deixa #root inert; overlays próprios usam aria-modal). */
export function appModalOpen(own?: Element | null): boolean {
  if (typeof document === 'undefined') return false
  if (document.getElementById('root')?.hasAttribute('inert')) return true
  const list = document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')
  for (const d of list) if (!own || !(d === own || d.contains(own) || own.contains(d))) return true
  return false
}

/** O evento de tecla deve ser ignorado por atalhos globais? */
export function keyBlocked(e: KeyboardEvent, own?: Element | null): boolean {
  const t = e.target as HTMLElement | null
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return true
  if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return true
  if (appModalOpen(own)) return true
  // foco dentro de outro diálogo (não modal) que não é o nosso
  const dlg = t?.closest?.('[role="dialog"], [role="alertdialog"]')
  if (dlg && !(own && (own === dlg || own.contains(dlg) || dlg.contains(own)))) return true
  return false
}

/**
 * Atalho global (window) que não dispara com um diálogo aberto por cima nem com foco em campos.
 * `scope`: elemento dono do atalho (um overlay próprio pode estar aberto).
 */
export function useImHotkey(keys: string | string[], handler: (e: KeyboardEvent) => void, opts: { enabled?: boolean; scope?: RefObject<Element | null> } = {}) {
  const h = useRef(handler)
  h.current = handler
  const enabled = opts.enabled ?? true
  const list = (Array.isArray(keys) ? keys : [keys]).map((k) => k.toLowerCase())
  const sig = list.join('|')
  useEffect(() => {
    if (!enabled) return
    const on = (e: KeyboardEvent) => {
      if (!list.includes(e.key.toLowerCase())) return
      if (keyBlocked(e, opts.scope?.current ?? null)) return
      h.current(e)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sig])
}

// ───────────────────────── som ─────────────────────────

let gestured = false
if (typeof window !== 'undefined') {
  const mark = () => {
    gestured = true
    window.removeEventListener('pointerdown', mark, true)
    window.removeEventListener('keydown', mark, true)
  }
  window.addEventListener('pointerdown', mark, true)
  window.addEventListener('keydown', mark, true)
}

type SfxName = Parameters<typeof sfx.play>[0]
/** Efeitos sonoros só depois do primeiro gesto do usuário (o AudioContext exige). */
export const imSfx = {
  play(name: SfxName) {
    if (gestured) sfx.play(name)
  },
  tick() {
    if (gestured) sfx.tick()
  },
}

// ───────────────────────── foco ─────────────────────────

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Prende o Tab dentro do overlay e foca o contêiner (sem rolar) ao abrir. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    const el = ref.current
    if (!active || !el) return
    const before = document.activeElement as HTMLElement | null
    el.focus({ preventScroll: true })
    el.scrollTop = 0
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement)
      if (!items.length) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const cur = document.activeElement as HTMLElement | null
      if (e.shiftKey && (cur === first || cur === el || !el.contains(cur))) {
        e.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!e.shiftKey && (cur === last || !el.contains(cur))) {
        e.preventDefault()
        first.focus({ preventScroll: true })
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (before && document.contains(before)) before.focus?.({ preventScroll: true })
    }
  }, [ref, active])
}
