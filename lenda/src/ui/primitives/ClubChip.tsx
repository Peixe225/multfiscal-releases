/**
 * Crest + club name (career rows, standings, option cards, ticker).
 *
 *   <ClubChip clubId="e2029" />                          Palmeiras
 *   <ClubChip club={club} sub="Brasileirão" size="lg" />  two lines
 *   <ClubChip club={club} loan variant="chip" />          ↳ arrow + pill background
 *   <ClubChip club={club} short />                       shortName (tables)
 */
import { memo, type CSSProperties, type ReactNode } from 'react'
import type { Club } from '@/engine/types'
import { useClub } from '@/store/data'
import { cx } from './cx'
import { Crest, type CrestClub } from './Crest'
import { LoanIcon } from './icons'

export interface ClubChipProps {
  club?: (CrestClub & Partial<Pick<Club, 'shortName'>>) | null
  clubId?: string | null
  /** sm: crest 18 / 12.5px · md: crest 20 / 13.5px (default) · lg: crest 28 / 15px bold */
  size?: 'sm' | 'md' | 'lg'
  /** Use shortName (fits tables). */
  short?: boolean
  /** Second line (league, country, "Empréstimo"…). */
  sub?: ReactNode
  /** Loan arrow before the crest (↳). */
  loan?: boolean
  variant?: 'plain' | 'chip'
  /** Trailing content (tags, trophies). */
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

const SZ = { sm: { crest: 18, font: 12.5, gap: 7 }, md: { crest: 20, font: 13.5, gap: 8 }, lg: { crest: 28, font: 15, gap: 10 } } as const

export const ClubChip = memo(function ClubChip({ club, clubId, size = 'md', short, sub, loan, variant = 'plain', children, className, style }: ClubChipProps) {
  const fromStore = useClub(club ? null : clubId)
  const c = club ?? fromStore
  const s = SZ[size]
  const name = c ? (short ? c.shortName || c.name : c.name) || '—' : 'Sem clube'
  return (
    <span
      className={cx('inline-flex items-center min-w-0 max-w-full', variant === 'chip' && 'lx-chip', className)}
      style={{ gap: s.gap, ...(variant === 'chip' ? { height: size === 'lg' ? 32 : 26, fontSize: s.font } : {}), ...style }}
    >
      {loan && <LoanIcon size={14} strokeWidth={2} className="flex-none text-text-3" aria-label="Empréstimo" />}
      {c ? <Crest club={c} size={s.crest} decorative /> : <span className="grid place-items-center rounded-full bg-surface-2 text-text-3 text-[10px] font-bold flex-none" style={{ width: s.crest, height: s.crest }} aria-hidden>?</span>}
      <span className="min-w-0 flex flex-col leading-tight">
        <span className="truncate text-text" style={{ fontSize: s.font, fontWeight: size === 'lg' ? 800 : 650, fontFamily: size === 'lg' ? 'var(--font-display)' : undefined, letterSpacing: size === 'lg' ? '-0.01em' : undefined }}>
          {name}
        </span>
        {sub && <span className="truncate text-text-3 text-[11.5px] font-semibold mt-px">{sub}</span>}
      </span>
      {children}
    </span>
  )
})
