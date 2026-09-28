/** League logo on the white "logo tile" (ESPN logos are made for light backgrounds). */
import { memo, useState } from 'react'
import { Trophy } from 'lucide-react'
import type { League } from '@/engine/types'
import { cx } from '@/ui/primitives'
import { leagueLogoUrl } from './leagues'

export const LeagueLogo = memo(function LeagueLogo({ league, size = 30, className, tile = true }: { league: Pick<League, 'id' | 'logo' | 'shortName'>; size?: number; className?: string; tile?: boolean }) {
  const [failed, setFailed] = useState(false)
  const pad = tile ? Math.max(2, Math.round(size * 0.13)) : 0
  return (
    <span
      className={cx('inline-grid place-items-center flex-none overflow-hidden', tile && 'lx-league-tile', className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), padding: pad }}
      aria-hidden="true"
    >
      {failed ? (
        <Trophy size={Math.round(size * 0.58)} strokeWidth={2} style={{ color: tile ? '#2a2d36' : 'currentColor' }} />
      ) : (
        <img src={leagueLogoUrl(league)} alt="" width={size - pad * 2} height={size - pad * 2} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} className="w-full h-full object-contain" />
      )}
    </span>
  )
})
