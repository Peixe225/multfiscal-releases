/**
 * FUT-style LENDA player card (shield shape), tiers bronze → prata → ouro → lenda.
 * Resolution independent: the theme sizes everything in cqw from `width`.
 */
import { memo, type CSSProperties } from 'react'
import { Crest, Flag, cx, tierOf, TIER_LABEL, type CrestClub } from '@/ui/primitives'
import { Jersey } from '@/ui/shared/identity/Jersey'
import type { KitColors } from '@/ui/shared/identity/kit'

const OUTER =
  'M18,10 H98 C104,10 108,14 112,18 L118,24 C122,28 128,28 132,24 L138,18 C142,14 146,10 152,10 H232 C238,10 242,14 242,20 V286 C242,296 236,302 228,306 L136,346 C129,349 121,349 114,346 L22,306 C14,302 8,296 8,286 V20 C8,14 12,10 18,10 Z'
const INNER =
  'M24,20 H96 C101,20 104,23 107,26 L114,33 C120,39 130,39 136,33 L143,26 C146,23 149,20 154,20 H226 C230,20 232,22 232,26 V282 C232,290 228,294 221,297 L134,335 C128,338 122,338 116,335 L29,297 C22,294 18,290 18,282 V26 C18,22 20,20 24,20 Z'

export interface PlayerCardProps {
  ovr: number
  /** Position label (CA, MEI…). */
  pos: string
  nationality?: string | null
  club?: CrestClub | null
  kit: KitColors
  name: string
  number: number | string
  stats: [label: string, value: string | number][]
  width?: number
  className?: string
  style?: CSSProperties
  /** Decorative cards are hidden from assistive tech. */
  decorative?: boolean
}

export const PlayerCard = memo(function PlayerCard({ ovr, pos, nationality, club, kit, name, number, stats, width = 250, className, style, decorative }: PlayerCardProps) {
  const tier = tierOf(ovr)
  const W = width
  const label = `${name.toUpperCase()}, OVR ${ovr}, ${TIER_LABEL[tier]}`
  return (
    <article
      className={cx('lx-pcard', `lx-tier-${tier}`, className)}
      style={{ width: W, ...style }}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
    >
      <div className="lx-pcard__shape" />
      <svg className="lx-pcard__frame" viewBox="0 0 250 356" preserveAspectRatio="none" aria-hidden="true">
        <path d={OUTER} fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="1.4" />
        <path d={INNER} fill="none" stroke="rgba(0,0,0,.22)" strokeWidth="1" />
        <path d={INNER} fill="none" stroke="rgba(255,255,255,.35)" strokeWidth=".8" transform="translate(0 1)" />
      </svg>
      <div className="lx-pcard__ovr">
        <b>{ovr}</b>
        <span>{pos}</span>
        <i />
        {nationality && <Flag code={nationality} h={Math.round(W * 0.088)} w={Math.round(W * 0.12)} radius={3} decorative />}
        {club && <Crest club={club} size={Math.round(W * 0.128)} decorative shadow className="mt-[3.2cqw]" />}
      </div>
      <div className="lx-pcard__kit">
        <Jersey name={name} number={number} kit={kit} />
      </div>
      <div className="lx-pcard__name" style={name.length > 9 ? { fontSize: `${Math.max(5.6, 96 / name.length)}cqw` } : undefined}>
        {name.toUpperCase()}
      </div>
      <div className="lx-pcard__stats">
        {stats.slice(0, 3).map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
      <div className="lx-pcard__tier">{TIER_LABEL[tier]}</div>
    </article>
  )
})
