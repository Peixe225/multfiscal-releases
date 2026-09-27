/**
 * Toasts (bottom-centre stack, aria-live). Mount <Toaster /> once (the shell does).
 *
 *   toast({ title: 'Carreira salva', tone: 'success' })
 *   toast.gold('Conquista desbloqueada', 'Hat-trick de Bolas de Ouro', { icon: Medal })
 *   toast.error('Não foi possível salvar')
 */
import { useEffect, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { create } from 'zustand'
import { Check, Info, Sparkles, TriangleAlert, X, type LucideProps } from 'lucide-react'
import { cx } from './cx'
import { useReducedMotion } from './hooks'
import { sfx } from '@/ui/shell/sfx'

export type ToastTone = 'default' | 'success' | 'danger' | 'gold'
export interface ToastItem {
  id: string
  title: ReactNode
  description?: ReactNode
  tone: ToastTone
  icon?: ComponentType<LucideProps>
  /** ms; 0 = sticky. Default 4200 (gold 5200). */
  duration: number
  action?: { label: string; onClick: () => void }
}
type ToastInput = Partial<Omit<ToastItem, 'id'>> & { title: ReactNode }

interface ToastStore {
  items: ToastItem[]
  push(t: ToastInput): string
  dismiss(id: string): void
}

let n = 0
export const useToasts = create<ToastStore>()((set) => ({
  items: [],
  push: (t) => {
    const id = `t${++n}`
    const tone = t.tone ?? 'default'
    const item: ToastItem = { id, tone, duration: t.duration ?? (tone === 'gold' ? 5200 : 4200), ...t } as ToastItem
    set((s) => ({ items: [...s.items.slice(-3), item] }))
    if (tone === 'gold') sfx.play('unlock')
    else if (tone === 'danger') sfx.play('error')
    return id
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
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

function ToastView({ t }: { t: ToastItem }) {
  const rm = useReducedMotion()
  const dismiss = useToasts((s) => s.dismiss)
  useEffect(() => {
    if (!t.duration) return
    const h = window.setTimeout(() => dismiss(t.id), t.duration)
    return () => clearTimeout(h)
  }, [t.id, t.duration, dismiss])
  const Ico = t.icon ?? TONE_ICON[t.tone]
  return (
    <motion.div
      layout={!rm}
      role={t.tone === 'danger' ? 'alert' : 'status'}
      className={cx('lx-toast', t.tone !== 'default' && `lx-toast--${t.tone}`)}
      initial={rm ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={rm ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
    >
      <span className="lx-toast__ic" aria-hidden="true">
        <Ico />
      </span>
      <div className="min-w-0 flex-1">
        <div className="lx-toast__title">{t.title}</div>
        {t.description && <div className="lx-toast__desc">{t.description}</div>}
      </div>
      {t.action && (
        <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm flex-none" onClick={() => (t.action!.onClick(), dismiss(t.id))}>
          {t.action.label}
        </button>
      )}
      <button type="button" className="lx-icon-btn lx-icon-btn--sm flex-none" style={{ position: 'relative', width: 28, height: 28, borderRadius: 9 }} aria-label="Dispensar" onClick={() => dismiss(t.id)}>
        <X aria-hidden style={{ width: 14, height: 14 }} />
      </button>
    </motion.div>
  )
}

export function Toaster() {
  const items = useToasts((s) => s.items)
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="lx-toaster" aria-live="polite" aria-relevant="additions">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <ToastView key={t.id} t={t} />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  )
}
