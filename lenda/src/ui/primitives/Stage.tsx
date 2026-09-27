/**
 * Fixed ambient backdrop lit by the club colour (DESIGN-SPEC §3 · .lx-stage).
 * Render once near the root of a screen; the colour crossfades over 800ms when the club changes.
 *
 *   <Stage />                          uses the inherited --club / --club-glow / --club-2
 *   <Stage club={club} />              local override (glow slots A/B from the club, C = secondary)
 *   <Stage preset="brand" />           landing (indigo + gold + pitch green)
 *   <Stage preset="duo" colors={nationColors(country)} />   identity (nation colours)
 *   presets: 'club' | 'brand' | 'duo' | 'legend' | 'ceremony' | 'versus'
 */
import { memo, type CSSProperties } from 'react'
import { ambientGlow, clubColors, type ClubColors, type ClubLike } from '@/ui/theme/club'
import { cx } from './cx'

export type StagePreset = 'club' | 'brand' | 'duo' | 'legend' | 'ceremony' | 'versus'

export interface StageProps {
  preset?: StagePreset
  club?: ClubLike
  colors?: ClubColors
  /** Explicit slot colours (override club/colors). */
  glowA?: string
  glowB?: string
  glowC?: string
  /** Extra layers: 'rays' behind content, 'dust' particles, 'noise' grain. */
  rays?: boolean
  className?: string
  style?: CSSProperties
}

export const Stage = memo(function Stage({ preset = 'club', club, colors, glowA, glowB, glowC, rays, className, style }: StageProps) {
  const cc = colors ?? (club ? clubColors(club) : null)
  const vars: Record<string, string> = {}
  if (cc) {
    const g = ambientGlow(cc)
    vars['--lx-glow-a'] = g
    vars['--lx-glow-b'] = g
    vars['--lx-glow-c'] = cc.secondary
    // duo/versus use a/b as two colours
    if (preset === 'duo' || preset === 'versus') vars['--lx-glow-b'] = cc.secondary
  }
  if (glowA) vars['--lx-glow-a'] = glowA
  if (glowB) vars['--lx-glow-b'] = glowB
  if (glowC) vars['--lx-glow-c'] = glowC
  return (
    <div className={cx('lx-stage', preset !== 'club' && `lx-stage--${preset}`, className)} style={{ ...(vars as CSSProperties), ...style }} aria-hidden="true">
      {rays && <div className="lx-rays" style={{ position: 'absolute', left: '50%', top: '38%', width: 1400, height: 1400, opacity: 0.5 }} />}
    </div>
  )
})
