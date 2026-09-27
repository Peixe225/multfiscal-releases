/**
 * Glass / card surfaces (DESIGN-SPEC §2.1, §7).
 *
 *   <Card>…</Card>                      frosted glass panel (r20, shadow-2)       = .lx-glass
 *   <Card variant="flat" />             in-flow flat card                          = .lx-glass-flat
 *   <Card variant="well" />             recessed well (inputs, lists)              = .lx-glass-well
 *   <Card variant="hud" /> / "tag"      dark glass over art                        = .lx-glass-hud / .lx-glass-tag
 *   <Card variant="club" />             club-tinted hero card (uses --club)        = .lx-club-card
 *   <Card variant="panel" />            faint club wash panel (career table)       = .lx-glass .lx-club-panel
 *   <Card as="section" padding="lg" radius="xl" />
 */
import { createElement, forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'

export type SurfaceVariant = 'glass' | 'flat' | 'well' | 'hud' | 'tag' | 'club' | 'panel'
const V: Record<SurfaceVariant, string> = {
  glass: 'lx-glass',
  flat: 'lx-glass-flat',
  well: 'lx-glass-well',
  hud: 'lx-glass-hud',
  tag: 'lx-glass-tag',
  club: 'lx-club-card',
  panel: 'lx-glass lx-club-panel',
}
const PAD = { none: '', sm: 'p-3', md: 'px-[18px] pt-4 pb-3.5', lg: 'p-5' } as const
const RAD = { md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-[22px]' } as const

export interface CardProps extends HTMLAttributes<HTMLElement> {
  variant?: SurfaceVariant
  padding?: keyof typeof PAD
  radius?: keyof typeof RAD
  as?: 'div' | 'section' | 'article' | 'aside' | 'header' | 'footer' | 'li' | 'ul'
  children?: ReactNode
  style?: CSSProperties
}

export const Card = forwardRef<HTMLElement, CardProps>(function Card({ variant = 'glass', padding = 'md', radius, as = 'div', className, children, ...rest }, ref) {
  return createElement(as, { ref, className: cx(V[variant], PAD[padding], radius && RAD[radius], 'relative', className), ...rest }, children)
})

export const Glass = Card

/** Section header inside a card: eyebrow/title left, actions right. */
export function CardHeader({ title, eyebrow, actions, className }: { title?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center gap-3 min-w-0', className)}>
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="lx-eyebrow">{eyebrow}</div>}
        {title && <h2 className="font-display text-[16.5px] font-extrabold tracking-[-0.015em] text-text truncate m-0">{title}</h2>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-none">{actions}</div>}
    </div>
  )
}

/** 1px hairline divider. */
export const Hairline = ({ className, vertical }: { className?: string; vertical?: boolean }) => (
  <span aria-hidden="true" className={cx('block flex-none bg-border', vertical ? 'w-px self-stretch' : 'h-px w-full', className)} />
)
