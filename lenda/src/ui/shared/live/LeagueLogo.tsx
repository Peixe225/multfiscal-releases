/**
 * League logo on a "logo tile". ESPN logos are made for light backgrounds, so the tile is white —
 * except for logos that are themselves (almost) white, which get a dark tile.
 *
 * The white logos are listed up front (measured from public/leagues/*.webp: mean luminance of the
 * opaque pixels > 0.86), so the right tile shows on the first frame and also where the canvas
 * probe cannot run — e.g. inside claude.ai, where a tainted canvas made the Premier League logo a
 * blank white square. Logos outside the list are still measured once per URL.
 */
import { memo, useState } from 'react'
import { Trophy } from 'lucide-react'
import type { League } from '@/engine/types'
import { cx } from '@/ui/primitives'
import { leagueLogoUrl } from './leagues'

const lightCache = new Map<string, boolean>()

/** (Almost) white logos in public/leagues — see the header. */
export const LIGHT_LOGOS: ReadonlySet<string> = new Set([
  'eng.1',
  'fra.1',
  'ned.1',
  'sco.1',
  'aus.1',
  'arg.copa',
  'ita.coppa_italia',
  'uefa.champions',
  'uefa.europa',
  'uefa.europa.conf',
])

function isLightLogo(img: HTMLImageElement): boolean {
  try {
    const c = document.createElement('canvas')
    const n = 24
    c.width = n
    c.height = n
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return false
    ctx.drawImage(img, 0, 0, n, n)
    const d = ctx.getImageData(0, 0, n, n).data
    let sum = 0
    let count = 0
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255
      if (a < 0.35) continue
      sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
      count++
    }
    return count > 20 && sum / count > 0.86
  } catch {
    return false
  }
}

export const LeagueLogo = memo(function LeagueLogo({ league, size = 30, className, tile = true }: { league: Pick<League, 'id' | 'logo' | 'shortName'>; size?: number; className?: string; tile?: boolean }) {
  const url = leagueLogoUrl(league)
  const [failed, setFailed] = useState(false)
  const known = LIGHT_LOGOS.has(league.id)
  const [light, setLight] = useState(() => known || (lightCache.get(url) ?? false))
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
          onLoad={(e) => {
            if (!tile || known) return
            let v = lightCache.get(url)
            if (v === undefined) {
              v = isLightLogo(e.currentTarget)
              lightCache.set(url, v)
            }
            if (v) setLight(true)
          }}
          className="w-full h-full object-contain"
        />
      )}
    </span>
  )
})
