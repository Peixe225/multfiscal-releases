/**
 * Club theming — one helper used by every surface that "belongs" to a club
 * (DESIGN-SPEC-noite §1.5). Sets --club, --club-2, --club-ink, --club-glow inline.
 *
 *   <div style={clubVars(club)}> … </div>            // whole subtree tinted
 *   <div style={rowClubVars(club)} className="lx-club-row lx-club-row--filled">  // one row
 *
 * Never derive club colours inside [data-theme] custom properties (they would freeze at the root).
 */
import type { CSSProperties } from 'react'

export interface ClubColors {
  primary: string
  secondary: string
  /** Ambient-safe glow colour (near-black / near-white / grey kits). */
  glow?: string
  /** Text on --club when the computed contrast is not what the brand wants. */
  ink?: string
}

export type ClubLike = { id?: string; name?: string; colors?: { primary: string; secondary: string } | null } | null | undefined

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Normalises "#abc" / "abc" / "#aabbcc" → "#aabbcc" (falls back to a neutral grey). */
export function normHex(h: string | undefined | null, fallback = '#8a8f9c'): string {
  if (!h) return fallback
  const m = HEX_RE.exec(h.trim())
  if (!m) return fallback
  let v = m[1]
  if (v.length === 3) v = v.split('').map((c) => c + c).join('')
  return `#${v.toLowerCase()}`
}

export function rgb(h: string): [number, number, number] {
  const n = parseInt(normHex(h).slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** WCAG relative luminance (0–1). */
export function luminance(h: string): number {
  return rgb(h)
    .map((v) => {
      const c = v / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0)
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

export function saturation(h: string): number {
  const c = rgb(h).map((v) => v / 255)
  const mx = Math.max(...c)
  const mn = Math.min(...c)
  const l = (mx + mn) / 2
  return mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1))
}

/** Best ink (white or near-black) on a background, WCAG based. */
export function bestInk(bg: string): string {
  const b = normHex(bg)
  return contrast(b, '#ffffff') >= 4.5 ? '#ffffff' : contrast(b, '#0a0b10') > contrast(b, '#ffffff') ? '#0a0b10' : '#ffffff'
}

/** Copero-style YIQ ink (used by the age badge): ≥128 → dark ink, else white. */
export function yiqInk(bg: string, dark = '#09090b', light = '#ffffff'): string {
  const [r, g, b] = rgb(bg)
  return (r * 299 + g * 587 + b * 114) / 1000 >= 128 ? dark : light
}

const glowable = (h: string) => {
  const L = luminance(h)
  return L > 0.02 && L < 0.6 && saturation(h) > 0.12
}

export function ambientGlow(c: ClubColors): string {
  if (c.glow) return c.glow
  const p = normHex(c.primary)
  const s = normHex(c.secondary)
  return glowable(p) ? p : glowable(s) ? s : '#c8c8c8'
}

/** Mix a hex towards white (t = 0..1). */
export function lighten(h: string, t: number): string {
  const [r, g, b] = rgb(h)
  const f = (v: number) => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0')
  return `#${f(r)}${f(g)}${f(b)}`
}

/** Mix a hex towards black (t = 0..1). */
export function darken(h: string, t: number): string {
  const [r, g, b] = rgb(h)
  const f = (v: number) => Math.round(v * (1 - t)).toString(16).padStart(2, '0')
  return `#${f(r)}${f(g)}${f(b)}`
}

/**
 * Data overrides from the mockups (§1.5). Keyed by club id AND by lowercase name so they
 * apply whether the pipeline uses ESPN ids ("e2029") or slugs.
 */
export const CLUB_COLOR_OVERRIDES: Record<string, Partial<ClubColors>> = {
  e2029: { primary: '#0b7a43', glow: '#0e8c4c' },
  palmeiras: { primary: '#0b7a43', glow: '#0e8c4c' },
  e86: { primary: '#ece6d2', ink: '#1a1a2a', glow: '#a082ff' },
  'real madrid': { primary: '#ece6d2', ink: '#1a1a2a', glow: '#a082ff' },
  e874: { primary: '#f2f2f2', ink: '#111111', glow: '#dcdcdc' },
  corinthians: { primary: '#f2f2f2', ink: '#111111', glow: '#dcdcdc' },
  e6086: { glow: '#c8c8c8' },
  botafogo: { glow: '#c8c8c8' },
  e111: { glow: '#c8c8c8' },
  juventus: { glow: '#c8c8c8' },
  e382: { primary: '#6cabdd', ink: '#0b2340' },
  'manchester city': { primary: '#6cabdd', ink: '#0b2340' },
}

/** Resolve the colours for a Club (applies the overrides). */
export function clubColors(club: ClubLike): ClubColors {
  const base: ClubColors = {
    primary: normHex(club?.colors?.primary, '#5c50ff'),
    secondary: normHex(club?.colors?.secondary, '#ffc45c'),
  }
  const o = (club?.id && CLUB_COLOR_OVERRIDES[club.id]) || (club?.name && CLUB_COLOR_OVERRIDES[club.name.toLowerCase()]) || null
  return o ? { ...base, ...o, primary: normHex(o.primary ?? base.primary) } : base
}

export type ClubVars = CSSProperties & {
  '--club': string
  '--club-2': string
  '--club-ink': string
  '--club-glow': string
  '--club-hi': string
}

/** The four runtime variables for a club subtree. Accepts ClubColors or a Club. */
export function clubVars(c: ClubColors | (ClubLike)): ClubVars {
  const cc: ClubColors = c && 'primary' in c ? (c as ClubColors) : clubColors(c as ClubLike)
  const primary = normHex(cc.primary)
  return {
    '--club': primary,
    '--club-2': normHex(cc.secondary),
    '--club-ink': cc.ink ?? bestInk(primary),
    '--club-glow': ambientGlow(cc),
    '--club-hi': clubHighlight(cc),
  } as ClubVars
}

/**
 * Per-row variables (career table, standings, summary strip, option cards).
 *   --row-club / --row-club-ink → age badge + club strip fill (the real kit colour, YIQ ink like Copero)
 *   --rc → row tint (ambient-safe: white/black kits tint with their glow colour instead)
 *   --oc → option-card tint
 */
export function rowClubVars(c: ClubColors | ClubLike | null | undefined): CSSProperties {
  if (!c) return {}
  const cc: ClubColors = 'primary' in c ? (c as ClubColors) : clubColors(c as ClubLike)
  const primary = normHex(cc.primary)
  const glow = ambientGlow(cc)
  return {
    '--row-club': primary,
    '--row-club-ink': cc.ink ?? yiqInk(primary),
    '--rc': glow,
    '--oc': glow,
  } as CSSProperties
}

/** Club colour lifted towards white (progress bars, celebration kicker) — L ≥ ~80%. */
export function clubHighlight(c: ClubColors | ClubLike): string {
  const cc: ClubColors = c && 'primary' in c ? (c as ClubColors) : clubColors(c as ClubLike)
  const g = ambientGlow(cc)
  return lighten(g, luminance(g) > 0.35 ? 0.15 : 0.45)
}

/** Nation colours as a ClubColors (identity step tints the stage with the nation). */
export function nationColors(country: { colors?: { primary: string; kit1?: string; kit2?: string } } | null | undefined): ClubColors {
  const p = normHex(country?.colors?.primary, '#009c3b')
  const s = normHex(country?.colors?.kit2 ?? country?.colors?.kit1, '#ffd600')
  return { primary: p, secondary: s }
}

/** True when a crest/colour is so dark it needs a light edge on the near-black stage. */
export function isDarkOnStage(hex: string | undefined | null): boolean {
  if (!hex) return false
  return luminance(normHex(hex)) < 0.035
}
