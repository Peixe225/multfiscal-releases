/**
 * Small status pills and tags.
 *
 *   <Pill tone="positive" icon={ArrowUp}>ACESSO</Pill>      tones: neutral|positive|negative|warning|gold|info|solid
 *   <Tag kind="up">Acesso</Tag>   <Tag kind="down">Rebaixado</Tag>   <Tag kind="gold" icon={Trophy}>Bola 3º</Tag>
 *   <LivePill>Temporada 2026 ao vivo</LivePill>   <YouBadge />   <NewBadge />   <Kbd>Esc</Kbd>   <Eyebrow>Vitrine</Eyebrow>
 */
import type { ComponentType, CSSProperties, ReactNode } from 'react'
import { ArrowDown, ArrowUp, type LucideProps } from 'lucide-react'
import { cx } from './cx'

type IconType = ComponentType<LucideProps>

export type PillTone = 'neutral' | 'positive' | 'negative' | 'warning' | 'gold' | 'info' | 'solid'

export interface PillProps {
  tone?: PillTone
  size?: 'sm' | 'md' | 'lg'
  icon?: IconType
  children?: ReactNode
  className?: string
  style?: CSSProperties
  title?: string
}

export function Pill({ tone = 'neutral', size = 'md', icon: Ico, children, className, style, title }: PillProps) {
  return (
    <span className={cx('lx-pill', tone !== 'neutral' && `lx-pill--${tone}`, size !== 'md' && `lx-pill--${size}`, className)} style={style} title={title}>
      {Ico && <Ico aria-hidden strokeWidth={2.4} />}
      {children}
    </span>
  )
}

/** Table-row tag (ACESSO / REBAIXADO / BOLA 3º). Text hides on phones; `label` stays for AT. */
export function Tag({ kind, icon, children, label, className }: { kind: 'up' | 'down' | 'gold'; icon?: IconType; children: ReactNode; label?: string; className?: string }) {
  const Ico = icon ?? (kind === 'up' ? ArrowUp : kind === 'down' ? ArrowDown : undefined)
  return (
    <span className={cx('lx-tag', `lx-tag--${kind}`, className)} title={label ?? (typeof children === 'string' ? children : undefined)}>
      {Ico && <Ico aria-hidden />}
      <span>{children}</span>
    </span>
  )
}

export function LivePill({ children, red, className }: { children: ReactNode; red?: boolean; className?: string }) {
  return (
    <span className={cx('lx-live', red && 'lx-live--red', className)}>
      <span className="lx-dot lx-dot--pulse" aria-hidden="true" />
      {children}
    </span>
  )
}

export function GoldPill({ children, className, icon: Ico }: { children: ReactNode; className?: string; icon?: IconType }) {
  return (
    <span className={cx('lx-pill-gold', className)}>
      {Ico && <Ico aria-hidden size={14} />}
      {children}
    </span>
  )
}

export const YouBadge = ({ children = 'VOCÊ', className }: { children?: ReactNode; className?: string }) => <span className={cx('lx-you', className)}>{children}</span>
export const NewBadge = ({ children = 'NOVO', className }: { children?: ReactNode; className?: string }) => <span className={cx('lx-badge-new', className)}>{children}</span>
export const Kbd = ({ children, className }: { children: ReactNode; className?: string }) => <kbd className={cx('lx-kbd', className)}>{children}</kbd>
export const Eyebrow = ({ children, className, as: As = 'span' }: { children: ReactNode; className?: string; as?: 'span' | 'div' | 'h2' | 'h3' | 'p' }) => (
  <As className={cx('lx-eyebrow', className)}>{children}</As>
)
