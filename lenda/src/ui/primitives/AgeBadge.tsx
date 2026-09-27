/**
 * Age badge in club colours (Copero's most "club-coloured" pixel), YIQ-contrast ink.
 *
 *   <AgeBadge age={25} club={club} />                      filled with the club kit colour
 *   <AgeBadge age={25} club={club} current />              glowing ring (current season)
 *   <AgeBadge age={26} state="pending" />                  decision pending (grey)
 *   <AgeBadge age={33} state="empty" />                    future age (decorative)
 */
import { memo, type CSSProperties } from 'react'
import type { ClubLike, ClubColors } from '@/ui/theme/club'
import { rowClubVars } from '@/ui/theme/club'
import { useClub } from '@/store/data'
import { cx } from './cx'

export interface AgeBadgeProps {
  age: number
  club?: ClubLike | ClubColors
  clubId?: string | null
  state?: 'filled' | 'pending' | 'empty'
  current?: boolean
  size?: 'sm' | 'md'
  className?: string
  style?: CSSProperties
}

export const AgeBadge = memo(function AgeBadge({ age, club, clubId, state = 'filled', current, size = 'md', className, style }: AgeBadgeProps) {
  const fromStore = useClub(club ? null : clubId)
  const c = (club ?? fromStore) as ClubLike | ClubColors
  const vars = state === 'filled' ? rowClubVars(c) : {}
  return (
    <span
      className={cx('lx-age', state === 'pending' && 'lx-age--pending', state === 'empty' && 'lx-age--empty', current && 'lx-age--current', className)}
      style={{ ...vars, ...(size === 'sm' ? { width: 26, height: 20, fontSize: 13.5, borderRadius: 6 } : {}), ...style }}
      aria-label={`${age} anos`}
      aria-hidden={state === 'empty' || undefined}
    >
      {age}
    </span>
  )
})
