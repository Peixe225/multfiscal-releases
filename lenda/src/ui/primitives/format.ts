/**
 * Formatting helpers (pt-BR UI, Copero-compatible money).
 *
 *   formatMoney(100_000)    → "€100K"
 *   formatMoney(5_500_000)  → "€5,5M"
 *   formatMoney(45_000_000) → "€45M"
 *   formatMoney(1.2e9)      → "€1,2B"
 */
import type { League, Position, PositionGroup } from '@/engine/types'

export const MINUS = '−' // real minus sign for "−2 OVR"

export function formatMoney(v: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const neg = v < 0
  const a = Math.abs(v)
  let s: string
  if (a >= 1e9) s = `€${trim((a / 1e9).toFixed(a >= 1e10 ? 0 : 1))}B`
  else if (a >= 999_500) {
    const m = a / 1e6
    // Copero: 1 decimal under €10M, integer from €10M (fixes its "€10.0M" / "€1000K" quirks)
    s = m >= 9.95 ? `€${Math.round(m)}M` : `€${trim(m.toFixed(1))}M`
  } else if (a >= 1000) s = `€${Math.round(a / 1e3)}K`
  else s = `€${Math.round(a)}`
  if (neg) return `${MINUS}${s}`
  return opts.sign ? `+${s}` : s
}
/** pt-BR: "5.5" → "5,5" e "7.0" → "7". */
const trim = (s: string) => s.replace(/\.0$/, '').replace('.', ',')

const intFmt = new Intl.NumberFormat('pt-BR')
/** pt-BR integer: 1284 → "1.284". */
export function formatInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return intFmt.format(Math.round(n))
}

/** Signed with real minus: +3 / −2 / 0 (digits → pt-BR decimals, "+0,5"). */
export function signed(n: number, digits = 0): string {
  const a = Math.abs(n)
  const v = digits ? a.toFixed(digits).replace('.', ',') : String(Math.round(a))
  return n > 0 && v !== '0' ? `+${v}` : n < 0 && v !== '0' ? `${MINUS}${v}` : v
}

/** 0.65 → "65%". */
export function formatPercent(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return ''
  return `${Math.round(p * 100)}%`
}

/** Decimal rating in pt-BR: 7.4 → "7,4". */
export function formatRating(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r)) return '—'
  return r.toFixed(1).replace('.', ',')
}

/** Season label: calendar leagues "2026", split leagues "2026/27". */
export function formatSeason(season: number, calendar: League['calendar'] | 'split' | 'calendar' = 'calendar'): string {
  return calendar === 'split' ? `${season}/${String((season + 1) % 100).padStart(2, '0')}` : String(season)
}

/** Age for a given season (player is 16 in 2026). */
export const ageAt = (season: number) => 16 + (season - 2026)

export const POSITION_LABEL: Record<Position, string> = {
  GOL: 'Goleiro',
  ZAG: 'Zagueiro',
  LD: 'Lateral-direito',
  LE: 'Lateral-esquerdo',
  VOL: 'Volante',
  MC: 'Meio-campista',
  ME: 'Meia-esquerda',
  MD: 'Meia-direita',
  MEI: 'Meia-atacante',
  PE: 'Ponta-esquerda',
  PD: 'Ponta-direita',
  CA: 'Centroavante',
}

export function positionGroup(p: Position): PositionGroup {
  if (p === 'GOL') return 'goalkeeper'
  if (p === 'ZAG' || p === 'LD' || p === 'LE') return 'defensive'
  if (p === 'VOL' || p === 'MC' || p === 'ME' || p === 'MD') return 'support'
  return 'attacking'
}

/** Chip family used by .lx-chip--atk|mid|def|gk / .lx-pchip--*. */
export function positionFamily(p: Position): 'atk' | 'mid' | 'def' | 'gk' {
  const g = positionGroup(p)
  return g === 'goalkeeper' ? 'gk' : g === 'defensive' ? 'def' : g === 'support' ? 'mid' : 'atk'
}

/** "1 temporada" / "3 temporadas". */
export function plural(n: number, one: string, many: string): string {
  return `${formatInt(n)} ${n === 1 ? one : many}`
}

/** Ordinal pt-BR (masc.): 1 → "1º". */
export const ordinal = (n: number) => `${n}º`
