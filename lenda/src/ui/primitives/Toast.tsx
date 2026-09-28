/**
 * Toasts (aria-live). Mount <Toaster /> once (the shell does).
 *
 *   toast({ title: 'Carreira salva', tone: 'success' })
 *   toast.gold('Conquista desbloqueada', 'Hat-trick de Bolas de Ouro', { icon: Medal })
 *   toast.error('Não foi possível salvar')
 *
 * - Desktop: pilha no rodapé, ao centro. Celular (< 720px): compactos, no topo, abaixo da safe-area
 *   (não cobrem a tabela da carreira nem a barra de decisão).
 * - No máximo 2 visíveis; os demais esperam na fila e entram quando um sai.
 * - Duração padrão: curta para avisos sem ação (2,8 s; erro 4 s; dourado 3,8 s) e longa quando há
 *   um botão (6 s). O timer pausa com o ponteiro/foco em cima e só começa quando o toast aparece.
 */
import { useEffect, useRef, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { create } from 'zustand'
import { Check, Info, Sparkles, TriangleAlert, X, type LucideProps } from 'lucide-react'
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
  /** ms; 0 = sticky. Default: 2800 (erro 4000, dourado 3800); com ação, 6000. */
  duration: number
  action?: { label: string; onClick: () => void }
}
type ToastInput = Partial<Omit<ToastItem, 'id'>> & { title: ReactNode }

/** Toasts visíveis ao mesmo tempo. */
export const MAX_VISIBLE_TOASTS = 2
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
  if (actionable) return 6000
  return tone === 'danger' ? 4000 : tone === 'gold' ? 3800 : 2800
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
    if (items.length < MAX_VISIBLE_TOASTS && !queue.length) {
      set({ items: [...items, item] })
      onShow(item)
    } else set({ queue: trimQueue([...queue, item]) })
    return id
  },
  dismiss: (id) => {
    const { items, queue } = get()
    if (queue.some((q) => q.id === id)) return set({ queue: queue.filter((q) => q.id !== id) })
    const rest = items.filter((i) => i.id !== id)
    const free = MAX_VISIBLE_TOASTS - rest.length
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
    run()
    return () => {
      clearTimeout(timer.current)
      timer.current = 0
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id, t.duration])
  return { pause, resume: run }
}

function ToastView({ t, fromTop }: { t: ToastItem; fromTop: boolean }) {
  const rm = useReducedMotion()
  const dismiss = useToasts((s) => s.dismiss)
  const { pause, resume } = useAutoDismiss(t, dismiss)
  const Ico = t.icon ?? TONE_ICON[t.tone]
  const dy = fromTop ? -18 : 24
  return (
    <motion.div
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
        <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-toast__action flex-none" onClick={() => (t.action!.onClick(), dismiss(t.id))}>
          {t.action.label}
        </button>
      )}
      <button type="button" className="lx-icon-btn lx-icon-btn--sm lx-toast__x flex-none" aria-label="Dispensar" onClick={() => dismiss(t.id)}>
        <X aria-hidden style={{ width: 14, height: 14 }} />
      </button>
    </motion.div>
  )
}

export function Toaster() {
  const items = useToasts((s) => s.items)
  const queued = useToasts((s) => s.queue.length)
  const desktop = useIsDesktop()
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="lx-toaster" aria-live="polite" aria-relevant="additions">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <ToastView key={t.id} t={t} fromTop={!desktop} />
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
