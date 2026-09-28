/**
 * Kit colours for the jersey (identity screen, landing player cards, hall cards).
 * Nation kits come from Country.colors (kit1 = shirt, kit2 = shorts/second colour, kit3 = detail)
 * with hand-tuned overrides for the iconic shirts; club kits come from Club.colors.
 */
import type { Club, Country } from '@/engine/types'
import { bestInk, contrast, darken, lighten, luminance, normHex } from '@/ui/theme/club'

export type KitPattern = 'stripes' | 'checker' | 'sash' | 'hoops' | 'center'

export interface KitColors {
  /** Shirt body (bottom of the gradient). */
  base: string
  /** Shirt body (top of the gradient). */
  base2: string
  /** Collar, cuffs, piping. */
  trim: string
  /** Name + number. */
  ink: string
  /** Outline. */
  stroke: string
  /** Pattern colour (stripes, checker, sash, hoops, centre stripe). */
  stripe?: string
  pattern?: KitPattern
}

/** No nationality yet: neutral training shirt (Copero uses #e9e9e9 with black trim). */
export const BLANK_KIT: KitColors = { base: '#e3e6ec', base2: '#f7f8fa', trim: '#1b1d24', ink: '#111318', stroke: 'rgba(0,0,0,.14)' }

const K = (base: string, trim: string, ink: string, extra: Partial<KitColors> = {}): KitColors => ({
  base,
  base2: extra.base2 ?? (luminance(base) > 0.8 ? '#ffffff' : lighten(base, 0.12)),
  trim,
  ink,
  stroke: luminance(base) > 0.75 ? 'rgba(0,0,0,.14)' : 'rgba(0,0,0,.28)',
  ...extra,
})

/** Iconic national shirts (FIFA codes). */
const NATION_KITS: Record<string, KitColors> = {
  BRA: K('#ffd21f', '#0f9a50', '#0d4fa3', { base2: '#ffe45c' }),
  ARG: K('#f4f6f8', '#1b2a4a', '#1b2a4a', { pattern: 'stripes', stripe: '#74acdf' }),
  URU: K('#62a8e5', '#111318', '#111318', { base2: '#86c0f0' }),
  PAR: K('#f4f6f8', '#0038a8', '#0038a8', { pattern: 'stripes', stripe: '#d52b1e' }),
  CRO: K('#f4f6f8', '#171796', '#171796', { pattern: 'checker', stripe: '#e3262f' }),
  PER: K('#f4f6f8', '#d91023', '#111318', { pattern: 'sash', stripe: '#d91023' }),
  COL: K('#fcd116', '#003893', '#003893', { base2: '#ffe060' }),
  CHI: K('#d52b1e', '#ffffff', '#ffffff'),
  ECU: K('#ffdd00', '#034ea2', '#034ea2', { base2: '#ffe95c' }),
  BOL: K('#0f8a4a', '#fcd116', '#ffffff'),
  VEN: K('#7b1e2b', '#fcd116', '#ffffff'),
  MEX: K('#0b6b3a', '#ffffff', '#ffffff', { base2: '#0f8a4a' }),
  USA: K('#f4f6f8', '#1d2b5c', '#1d2b5c'),
  CAN: K('#d52b1e', '#ffffff', '#ffffff'),
  ENG: K('#f4f6f8', '#1d2b5c', '#1d2b5c'),
  ESP: K('#c60b1e', '#ffc400', '#ffc400', { base2: '#e2202f' }),
  GER: K('#f4f6f8', '#111318', '#111318'),
  ITA: K('#1f5fb4', '#ffffff', '#ffffff', { base2: '#2d74cf' }),
  FRA: K('#1d3f8f', '#e30613', '#ffffff', { base2: '#28509f' }),
  POR: K('#b3121f', '#0b6b3a', '#f4d27a', { base2: '#cf1f2e' }),
  NED: K('#ff6c00', '#1d2b5c', '#1d2b5c', { base2: '#ff8a2e' }),
  BEL: K('#d7141a', '#ffd200', '#ffd200'),
  TUR: K('#e30a17', '#ffffff', '#ffffff'),
  RUS: K('#f4f6f8', '#1c3578', '#1c3578'),
  JPN: K('#1d2b8f', '#ffffff', '#ffffff', { base2: '#2a3ca8' }),
  KOR: K('#d7141a', '#111318', '#ffffff'),
  MAR: K('#c1272d', '#006233', '#ffffff'),
  SEN: K('#f4f6f8', '#00853f', '#00853f'),
  NGA: K('#008751', '#ffffff', '#ffffff'),
  CMR: K('#007a5e', '#ce1126', '#fcd116'),
  GHA: K('#f4f6f8', '#111318', '#111318'),
  EGY: K('#c8102e', '#111318', '#ffffff'),
  SCO: K('#1c2c5b', '#ffffff', '#ffffff'),
  WAL: K('#c8102e', '#ffffff', '#ffffff'),
  IRL: K('#169b62', '#ffffff', '#ffffff'),
  DEN: K('#c60c30', '#ffffff', '#ffffff'),
  SWE: K('#fecc00', '#004b87', '#004b87', { base2: '#ffdc4a' }),
  NOR: K('#ba0c2f', '#00205b', '#ffffff'),
  SUI: K('#d52b1e', '#ffffff', '#ffffff'),
  AUT: K('#ed2939', '#ffffff', '#ffffff'),
  POL: K('#f4f6f8', '#dc143c', '#dc143c'),
  SRB: K('#c6363c', '#0c4076', '#ffffff'),
  UKR: K('#ffd500', '#005bbb', '#005bbb'),
  AUS: K('#ffcd00', '#00843d', '#00843d'),
  CRC: K('#ce1126', '#002b7f', '#ffffff'),
  KSA: K('#f4f6f8', '#006c35', '#006c35'),
}

const nearWhite = (h: string) => luminance(h) > 0.86
const nearBlack = (h: string) => luminance(h) < 0.02

function inkFor(base: string, candidates: (string | undefined)[]): string {
  for (const c of candidates) {
    if (c && contrast(base, normHex(c)) >= 2.6) return normHex(c)
  }
  return bestInk(base)
}

export function nationKit(country: Pick<Country, 'code' | 'colors' | 'kitPattern'> | null | undefined): KitColors {
  if (!country) return BLANK_KIT
  const o = NATION_KITS[country.code]
  if (o) return o
  const c = country.colors ?? { primary: '#8a8f9c', kit1: '#8a8f9c', kit2: '#ffffff' }
  let base = normHex(c.kit1 || c.primary)
  if (nearWhite(base)) base = '#f1f3f6'
  if (nearBlack(base)) base = '#26282e'
  const second = normHex(c.kit2 || '#ffffff')
  const pattern = country.kitPattern
  const trim = normHex(pattern ? (c.kit3 ?? second) : second === base ? (c.kit3 ?? bestInk(base)) : second)
  const ink = inkFor(base, [second, c.kit3, trim])
  return K(base, trim, ink, pattern ? { pattern, stripe: second } : {})
}

/** Club shirts that the default rule gets wrong (ESPN ids). */
const CLUB_KITS: Record<string, KitColors> = {
  e2029: K('#0b6b3a', '#ffffff', '#ffffff', { base2: '#0f8a4a' }), // Palmeiras
  e86: K('#f4f2ea', '#c9a44a', '#1b2a5a', { base2: '#ffffff', stroke: 'rgba(0,0,0,.12)' }), // Real Madrid
  e9967: K('#f5f6f8', '#1a64c4', '#1a64c4', { pattern: 'center', stripe: '#d4121c' }), // Bahia
  e819: K('#c4161c', '#111318', '#ffffff', { pattern: 'hoops', stripe: '#111318' }), // Flamengo
  e874: K('#f4f4f4', '#111318', '#111318'), // Corinthians
  e83: K('#a50044', '#edbb00', '#edbb00', { pattern: 'stripes', stripe: '#004d98' }), // Barcelona
  e16: K('#f4f6f8', '#e30613', '#111318', { pattern: 'sash', stripe: '#e30613' }), // River Plate
  e5: K('#0a3a8c', '#ffd100', '#ffd100', { pattern: 'hoops', stripe: '#ffd100' }), // Boca
  e103: K('#d7141a', '#111318', '#ffffff', { pattern: 'stripes', stripe: '#111318' }), // Milan
  e110: K('#0068a8', '#111318', '#ffffff', { pattern: 'stripes', stripe: '#111318' }), // Inter
  e111: K('#f4f6f8', '#111318', '#111318', { pattern: 'stripes', stripe: '#111318' }), // Juventus
  e2674: K('#f4f6f8', '#111318', '#111318'), // Santos
  e3454: K('#111318', '#ffffff', '#ffffff', { pattern: 'sash', stripe: '#f4f6f8' }), // Vasco
  e6086: K('#111318', '#ffffff', '#ffffff', { pattern: 'stripes', stripe: '#f4f6f8' }), // Botafogo
  e2026: K('#f4f6f8', '#e4032e', '#111318'), // São Paulo
  e7632: K('#111318', '#ffffff', '#ffffff', { pattern: 'stripes', stripe: '#f4f6f8' }), // Atlético-MG
  e3445: K('#8a1538', '#ffffff', '#ffffff', { pattern: 'stripes', stripe: '#00613c' }), // Fluminense
}

export function clubKit(club: Pick<Club, 'id' | 'colors'> | null | undefined): KitColors {
  if (!club) return BLANK_KIT
  const o = CLUB_KITS[club.id]
  if (o) return o
  let base = normHex(club.colors?.primary)
  const second = normHex(club.colors?.secondary ?? '#ffffff')
  if (nearWhite(base)) base = '#f1f3f6'
  if (nearBlack(base)) base = '#1d1f25'
  const ink = inkFor(base, [second])
  const trim = contrast(base, second) >= 1.4 ? second : ink
  return K(base, trim, ink)
}

/** Slightly darker variant for small renders (keeps white shirts visible on dark cards). */
export const kitShade = (k: KitColors, t = 0.06): KitColors => ({ ...k, base: darken(k.base, t) })
