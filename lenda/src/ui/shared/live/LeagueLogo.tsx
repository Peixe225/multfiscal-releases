/**
 * League logo on a "logo tile". ESPN logos are made for light backgrounds, so the tile is white —
 * except for logos that are themselves (almost) white, which get a dark tile.
 *
 * The tone logic (listed white logos + per-URL luminance probe) lives in `@/ui/art/logoTone`, shared
 * with the career tabs' CompLogo.
 */
import { memo, useState } from 'react'
import { Trophy } from 'lucide-react'
import type { League } from '@/engine/types'
import { cx } from '@/ui/primitives'
import { useLogoTone } from '@/ui/art/logoTone'
import { leagueLogoUrl } from './leagues'

export { LIGHT_LOGOS } from '@/ui/art/logoTone'

export const LeagueLogo = memo(function LeagueLogo({ league, size = 30, className, tile = true }: { league: Pick<League, 'id' | 'logo' | 'shortName'>; size?: number; className?: string; tile?: boolean }) {
  const url = leagueLogoUrl(league)
  const [failed, setFailed] = useState(false)
  const [light, onLoad] = useLogoTone(url, tile)
  const pad = tile ? Math.max(2, Math.round(size * 0.13)) : 0
  return (
    <span
      className={cx('inline-grid place-items-center flex-none overflow-hidden', tile && (light ? 'lx-league-tile lx-league-tile--dark' : 'lx-league-tile'), className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), padding: pad }}
      aria-hidden="true"
    >
      {failed ? (
        <Trophy size={Math.round(size * 0.58)} strokeWidth={2} style={{ color: tile ? '#2a2d36' : 'currentColor' }} />
      ) : (
        <img
          src={url}
          alt=""
          width={size - pad * 2}
          height={size - pad * 2}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          onLoad={onLoad}
          className="w-full h-full object-contain"
        />
      )}
    </span>
  )
})
