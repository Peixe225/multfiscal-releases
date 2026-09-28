/**
 * Tasteful placeholder for screens other teams are still building.
 */
import type { ComponentType, ReactNode } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, type LucideProps } from 'lucide-react'
import { Button, Card, Eyebrow } from '@/ui/primitives'
import { useReducedMotion } from '@/ui/primitives/hooks'

export interface PlaceholderProps {
  eyebrow: string
  title: string
  description: ReactNode
  icon: ComponentType<LucideProps>
  /** Bullet list of what the finished screen will show. */
  items?: string[]
  actions?: ReactNode
  children?: ReactNode
}

export function PlaceholderScreen({ eyebrow, title, description, icon: Ico, items, actions, children }: PlaceholderProps) {
  const rm = useReducedMotion()
  return (
    <main id="conteudo" tabIndex={-1} className="relative z-[1] flex-1 grid place-items-center px-4 py-10 sm:px-6 outline-none">
      <motion.div className="w-full max-w-[560px]" initial={rm ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
        <Card padding="lg" radius="xl" className="overflow-hidden">
          <div className="absolute inset-x-0 -top-24 h-48 pointer-events-none" style={{ background: 'radial-gradient(closest-side, color-mix(in srgb, var(--club-glow, var(--club)) 35%, transparent), transparent)' }} aria-hidden />
          <div className="relative flex items-start gap-4">
            <span className="grid place-items-center w-12 h-12 rounded-md flex-none bg-surface-2 border border-border-strong text-text">
              <Ico size={22} aria-hidden />
            </span>
            <div className="min-w-0">
              <Eyebrow>{eyebrow}</Eyebrow>
              <h1 className="font-display text-[26px] sm:text-[30px] font-extrabold tracking-[-0.03em] leading-[1.08] mt-1 mb-0">{title}</h1>
            </div>
          </div>
          <p className="relative text-[14.5px] leading-relaxed text-text-2 mt-4 mb-0">{description}</p>
          {items && (
            <ul className="relative mt-4 mb-0 p-0 list-none grid gap-2">
              {items.map((it) => (
                <li key={it} className="flex items-start gap-2.5 text-[13px] text-text-2">
                  <span className="mt-[7px] w-1.5 h-1.5 rounded-full flex-none" style={{ background: 'var(--club-hi, var(--accent))' }} aria-hidden />
                  {it}
                </li>
              ))}
            </ul>
          )}
          {children}
          <div className="relative flex flex-wrap gap-2.5 mt-6">
            {actions ?? (
              <Button href="#/" variant="ghost" size="md" icon={ArrowLeft}>
                Voltar ao início
              </Button>
            )}
          </div>
        </Card>
      </motion.div>
    </main>
  )
}
