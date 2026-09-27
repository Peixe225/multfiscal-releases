/**
 * <Crest club={club} size={28} />      — club crest from its CSS sprite atlas (CrestRef)
 * <Crest clubId="e2029" size={120} />  — resolved from the loaded GameData
 *
 * Falls back to a shield in the club colours with the abbreviation while the atlas loads
 * or when it is missing. Very dark crests get a light edge on the near-black stage.
 */
import { memo, type CSSProperties } from 'react'
import type { Club } from '@/engine/types'
import { useClub } from '@/store/data'
import { clubColors, isDarkOnStage, normHex, yiqInk, darken, lighten } from '@/ui/theme/club'
import { cx } from './cx'
import { crestSpriteStyle, useAtlas } from './crestAtlas'
import { useSvgId } from './hooks'

export type CrestClub = Pick<Club, 'id'> & Partial<Pick<Club, 'name' | 'shortName' | 'abbr' | 'colors' | 'crest'>>

export interface CrestProps {
  club?: CrestClub | null
  /** Resolved through the data store when `club` is not given. */
  clubId?: string | null
  /** Pixel size (square), 16–160. Default 28. */
  size?: number
  /** Light hairline edge for dark crests on the dark stage. 'auto' uses the club primary. */
  edge?: 'auto' | 'on' | 'off'
  /** Drop shadow (default true from 24px). */
  shadow?: boolean
  /** Accessible name. Default: club name. Pass `decorative` to hide from AT. */
  title?: string
  decorative?: boolean
  className?: string
  style?: CSSProperties
}

export const Crest = memo(function Crest({ club, clubId, size = 28, edge = 'auto', shadow, title, decorative, className, style }: CrestProps) {
  const fromStore = useClub(club ? null : clubId)
  const c = club ?? fromStore ?? null
  const atlas = useAtlas(c?.crest?.atlas)
  const px = Math.max(12, Math.min(200, Math.round(size)))
  const name = title ?? c?.name ?? 'Clube'
  const colors = clubColors(c ? { id: c.id, name: c.name, colors: c.colors } : null)
  const dark = edge === 'on' || (edge === 'auto' && isDarkOnStage(colors.primary))
  const withShadow = shadow ?? px >= 24
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': name }

  const showSprite = !!c?.crest && atlas?.status === 'ok'
  return (
    <span
      className={cx('lx-crest-box', dark && 'lx-crest-box--edge', !dark && withShadow && 'lx-crest-box--shadow', className)}
      style={{ width: px, height: px, ...style }}
      title={decorative ? undefined : name}
      {...a11y}
    >
      {showSprite ? (
        <span className="lx-crest-sprite" style={crestSpriteStyle(c!.crest!, px, atlas)} />
      ) : (
        <CrestFallback abbr={c?.abbr || initials(c?.shortName || c?.name)} primary={colors.primary} secondary={colors.secondary} size={px} />
      )}
    </span>
  )
})

function initials(name?: string): string {
  if (!name) return '?'
  const words = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

/** Shield badge in club colours — also used directly by the data-less previews. */
export function CrestFallback({ abbr, primary, secondary, size }: { abbr: string; primary: string; secondary: string; size: number }) {
  const id = useSvgId('cfb')
  const p = normHex(primary)
  let s = normHex(secondary)
  if (s === p) s = yiqInk(p) === '#ffffff' ? lighten(p, 0.7) : darken(p, 0.6)
  const ink = yiqInk(p, '#0b0c10', '#ffffff')
  const label = size < 22 ? abbr.slice(0, 1) : abbr.slice(0, 3)
  const fs = label.length <= 1 ? 30 : label.length === 2 ? 25 : 20
  return (
    <svg className="lx-crest-fb" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={lighten(p, 0.12)} />
          <stop offset="1" stopColor={darken(p, 0.22)} />
        </linearGradient>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".38" />
          <stop offset=".45" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-c`}>
          <path d="M32 4 55 11.5V31c0 14.4-10.4 24.3-23 29C19.4 55.3 9 45.4 9 31V11.5z" />
        </clipPath>
      </defs>
      <path d="M32 2 57.5 10.2V31c0 15.9-11.6 26.9-25.5 32C18.1 57.9 6.5 46.9 6.5 31V10.2z" fill={s} />
      <g clipPath={`url(#${id}-c)`}>
        <rect x="0" y="0" width="64" height="64" fill={`url(#${id}-f)`} />
        <path d="M0 47 64 33v31H0z" fill={s} opacity=".22" />
        <rect x="0" y="0" width="64" height="64" fill={`url(#${id}-g)`} />
      </g>
      <text x="32" y={label.length <= 1 ? 43 : 40} textAnchor="middle" fontSize={fs} fill={ink}>
        {label}
      </text>
    </svg>
  )
}
