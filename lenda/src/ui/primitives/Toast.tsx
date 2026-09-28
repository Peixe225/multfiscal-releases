/**
 * Toasts (aria-live). Mount <Toaster /> once (the shell does).
 *
 *   toast({ title: 'Carreira salva', tone: 'success' })
 *   toast.gold('Conquista desbloqueada', 'Hat-trick de Bolas de Ouro', { icon: Medal })
 *   toast.error('Não foi possível salvar')
 *   toast({ key: 'achievements', … })   // substitui (e reinicia) o toast vivo com a mesma chave
 *
 * - Desktop: no canto superior direito, logo abaixo da barra do topo (fora da coluna da decisão e das
 *   últimas linhas da tabela, onde a revelação acontece), 340px, no máximo 2 visíveis.
 * - Celular (< 720px): 1 visível, compacto (1 linha de título + 1 de texto), opaco, abaixo da barra
 *   do topo (menu/som/salvar continuam livres).
 * - A ação aparece só como ícone (o rótulo fica no aria-label/title), para não cortar o título.
 * - Os demais esperam na fila (chip "+N") e entram quando um sai.
 * - Duração padrão: curta para avisos sem ação (2,4 s; erro 4 s; dourado 3,2 s) e 4,5 s quando há
 *   um botão. O timer pausa com o ponteiro/foco em cima e só começa quando o toast aparece.
 */
import { useEffect, useRef, type ComponentType, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { create } from 'zustand'
import { ArrowRight, Check, Info, Sparkles, TriangleAlert, X, type LucideProps } from 'lucide-react'
import { cx } from './cx'
import { useIsDesktop, useReducedMotion } from './hooks'
import { sfx } from '@/ui/shell/sfx'

export type ToastTone = 'default' | 'success' | 'danger' | 'gold'
export interface ToastItem {
  id: string
  title: ReactNode
  description?: ReactNode
  tone: ToastTone
  icon?: ComponentType<LucideProps>
  /** ms; 0 = sticky. Default: 2400 (erro 4000, dourado 3200); com ação, 4500. */
  duration: number
  /** Ação: botão só com ícone (padrão: seta); o rótulo vira aria-label/title. */
  action?: { label: string; onClick: () => void; icon?: ComponentType<LucideProps> }
  /** Chave de agrupamento: um novo toast com a mesma chave substitui o vivo (visível ou na fila). */
  key?: string
  /** Incrementa a cada substituição (reinicia o timer). */
  rev?: number
}
type ToastInput = Partial<Omit<ToastItem, 'id'>> & { title: ReactNode }

/** Toasts visíveis ao mesmo tempo (desktop; no celular, 1). */
export const MAX_VISIBLE_TOASTS = 2
const PHONE_QUERY = '(max-width: 44.99rem)'
function maxVisible(): number {
  try {
    return typeof matchMedia === 'function' && matchMedia(PHONE_QUERY).matches ? 1 : MAX_VISIBLE_TOASTS
  } catch {
    return MAX_VISIBLE_TOASTS
  }
}
/** Fila máxima (os mais antigos sem ação são descartados primeiro). */
const MAX_QUEUE = 6

interface ToastStore {
  /** Visíveis (no máximo MAX_VISIBLE_TOASTS). */
  items: ToastItem[]
  /** Aguardando vaga. */
  queue: ToastItem[]
  push(t: ToastInput): string
  dismiss(id: string): void
}

function defaultDuration(tone: ToastTone, actionable: boolean): number {
  if (actionable) return 4500
  return tone === 'danger' ? 4000 : tone === 'gold' ? 3200 : 2400
}

function trimQueue(q: ToastItem[]): ToastItem[] {
  const out = q.slice()
  while (out.length > MAX_QUEUE) {
    const i = out.findIndex((t) => !t.action)
    out.splice(i >= 0 ? i : 0, 1)
  }
  return out
}

function onShow(t: ToastItem) {
  if (t.tone === 'gold') sfx.play('unlock')
  else if (t.tone === 'danger') sfx.play('error')
}

let n = 0
export const useToasts = create<ToastStore>()((set, get) => ({
  items: [],
  queue: [],
  push: (t) => {
    const id = `t${++n}`
    const tone = t.tone ?? 'default'
    const item: ToastItem = { ...t, id, tone, duration: t.duration ?? defaultDuration(tone, !!t.action) } as ToastItem
    const { items, queue } = get()
    // same key (e.g. achievements): replace the live one in place and restart its timer
    if (t.key) {
      const hit = [...items, ...queue].find((x) => x.key === t.key)
      if (hit) {
        const next: ToastItem = { ...item, id: hit.id, rev: (hit.rev ?? 0) + 1 }
        set({ items: items.map((x) => (x.id === hit.id ? next : x)), queue: queue.map((x) => (x.id === hit.id ? next : x)) })
        return hit.id
      }
    }
    // the same plain-text notice twice in a row (double click, repeated failure): keep one
    const same = [...items, ...queue].find((x) => typeof x.title === 'string' && x.title === t.title && x.tone === tone && x.description === t.description)
    if (same) return same.id
    if (items.length < maxVisible() && !queue.length) {
      set({ items: [...items, item] })
      onShow(item)
    } else set({ queue: trimQueue([...queue, item]) })
    return id
  },
  dismiss: (id) => {
    const { items, queue } = get()
    if (queue.some((q) => q.id === id)) return set({ queue: queue.filter((q) => q.id !== id) })
    const rest = items.filter((i) => i.id !== id)
    const free = maxVisible() - rest.length
    const promoted = free > 0 ? queue.slice(0, free) : []
    set({ items: [...rest, ...promoted], queue: queue.slice(promoted.length) })
    promoted.forEach(onShow)
  },
}))

type Opts = Partial<Omit<ToastItem, 'id' | 'title' | 'description' | 'tone'>>
export const toast = Object.assign((t: ToastInput) => useToasts.getState().push(t), {
  success: (title: ReactNode, description?: ReactNode, o?: Opts) => useToasts.getState().push({ title, description, tone: 'success', ...o }),
  error: (title: ReactNode, description?: ReactNode, o?: Opts) => useToasts.getState().push({ title, description, tone: 'danger', ...o }),
  gold: (title: ReactNode, description?: ReactNode, o?: Opts) => useToasts.getState().push({ title, description, tone: 'gold', ...o }),
  info: (title: ReactNode, description?: ReactNode, o?: Opts) => useToasts.getState().push({ title, description, tone: 'default', ...o }),
  dismiss: (id: string) => useToasts.getState().dismiss(id),
})

const TONE_ICON: Record<ToastTone, ComponentType<LucideProps>> = { default: Info, success: Check, danger: TriangleAlert, gold: Sparkles }

/** Timer que pausa enquanto o usuário interage com o toast. */
function useAutoDismiss(t: ToastItem, dismiss: (id: string) => void) {
  const left = useRef(t.duration)
  const started = useRef(0)
  const timer = useRef(0)
  const run = () => {
    if (!t.duration || timer.current) return
    started.current = Date.now()
    timer.current = window.setTimeout(() => dismiss(t.id), Math.max(400, left.current))
  }
  const pause = () => {
    if (!timer.current) return
    clearTimeout(timer.current)
    timer.current = 0
    left.current -= Date.now() - started.current
  }
  useEffect(() => {
    left.current = t.duration
    run()
    return () => {
      clearTimeout(timer.current)
      timer.current = 0
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id, t.duration, t.rev])
  return { pause, resume: run }
}

function ToastView({ t, fromTop, ref }: { t: ToastItem; fromTop: boolean; ref?: Ref<HTMLDivElement> }) {
  const rm = useReducedMotion()
  const dismiss = useToasts((s) => s.dismiss)
  const { pause, resume } = useAutoDismiss(t, dismiss)
  const Ico = t.icon ?? TONE_ICON[t.tone]
  const dy = fromTop ? -18 : 24
  return (
    <motion.div
      ref={ref}
      layout={!rm}
      role={t.tone === 'danger' ? 'alert' : 'status'}
      className={cx('lx-toast', t.tone !== 'default' && `lx-toast--${t.tone}`)}
      initial={rm ? { opacity: 0 } : { opacity: 0, y: dy, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={rm ? { opacity: 0 } : { opacity: 0, y: dy / 2, scale: 0.97, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      onPointerEnter={pause}
      onPointerLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      <span className="lx-toast__ic" aria-hidden="true">
        <Ico />
      </span>
      <div className="min-w-0 flex-1">
        <div className="lx-toast__title">{t.title}</div>
        {t.description && <div className="lx-toast__desc">{t.description}</div>}
      </div>
      {t.action && (
        <button
          type="button"
          className="lx-btn lx-btn--ghost lx-btn--sm lx-toast__action flex-none"
          aria-label={t.action.label}
          title={t.action.label}
          onClick={() => (t.action!.onClick(), dismiss(t.id))}
        >
          <span className="lx-toast__action-label">{t.action.label}</span>
          {(() => {
            const A = t.action.icon ?? ArrowRight
            return <A className="lx-toast__action-ic" aria-hidden="true" />
          })()}
        </button>
      )}
      <button type="button" className="lx-icon-btn lx-icon-btn--sm lx-toast__x flex-none" aria-label="Dispensar" onClick={() => dismiss(t.id)}>
        <X aria-hidden style={{ width: 14, height: 14 }} />
      </button>
    </motion.div>
  )
}

export function Toaster() {
  const all = useToasts((s) => s.items)
  const queuedCount = useToasts((s) => s.queue.length)
  const desktop = useIsDesktop()
  if (typeof document === 'undefined') return null
  // a viewport that shrank to phone width keeps the extra visible ones hidden (they count as queued)
  const items = desktop ? all : all.slice(0, 1)
  const queued = queuedCount + (all.length - items.length)
  return createPortal(
    <div className="lx-toaster" aria-live="polite" aria-relevant="additions">
      <AnimatePresence initial={false} mode="popLayout">
        {items.map((t) => (
          <ToastView key={t.id} t={t} fromTop />
        ))}
      </AnimatePresence>
      {queued > 0 && (
        <span className="lx-toaster__more" aria-hidden="true">
          +{queued}
        </span>
      )}
    </div>,
    document.body,
  )
}
