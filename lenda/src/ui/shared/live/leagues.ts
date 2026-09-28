/**
 * League helpers shared by the landing ticker and "Ligas ao vivo":
 * ordering, sorting, groups, rounds and qualification/relegation zones.
 */
import type { GameData, League, StandingRow } from '@/engine/types'

/** Ticker / selector order (the leagues people follow most from Brazil first). */
export const FEATURED_LEAGUES = ['bra.1', 'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'arg.1', 'por.1', 'ned.1', 'usa.1', 'mex.1', 'bra.2', 'tur.1', 'sau.1', 'ksa.1', 'col.1', 'uru.1', 'chi.1']

export const leagueLogoUrl = (l: Pick<League, 'id' | 'logo'>) => `${import.meta.env.BASE_URL ?? './'}${l.logo ?? `leagues/${l.id}.webp`}`

/** Copa-style table order: points, wins, goal difference, goals for. */
export function sortRows(rows: StandingRow[]): StandingRow[] {
  return [...rows].sort((a, b) => b.points - a.points || b.won - a.won || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf)
}

export interface StandingGroup {
  name: string | null
  rows: StandingRow[]
}

export function groupRows(rows: StandingRow[]): StandingGroup[] {
  const hasGroups = rows.some((r) => r.group)
  if (!hasGroups) return [{ name: null, rows: sortRows(rows) }]
  const map = new Map<string, StandingRow[]>()
  for (const r of rows) {
    const g = r.group ?? 'Geral'
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(r)
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR')).map(([name, rs]) => ({ name, rows: sortRows(rs) }))
}

/** "Rodada 28": the most games played by any club (ESPN tables are in sync per round). */
export const roundOf = (rows: StandingRow[] | undefined) => (rows?.length ? Math.max(...rows.map((r) => r.played)) : 0)

export function leaderOf(rows: StandingRow[] | undefined): StandingRow | null {
  if (!rows?.length) return null
  return sortRows(rows)[0] ?? null
}

/** Tier-1 leagues with standings, featured first. */
export function liveLeagues(data: GameData | null): League[] {
  if (!data) return []
  const withRows = data.leagues.filter((l) => (data.standings[l.id]?.length ?? 0) > 0)
  const rank = (l: League) => {
    const i = FEATURED_LEAGUES.indexOf(l.id)
    return i >= 0 ? i : 100 + l.tier * 50 + (1 - l.coefficient) * 40
  }
  return withRows.sort((a, b) => rank(a) - rank(b))
}

// ───────────────────────── zones ─────────────────────────

export type ZoneKind = 'cont1' | 'pre' | 'cont2' | 'cont3' | 'promo' | 'promo-po' | 'releg-po' | 'releg'

export interface Zone {
  kind: ZoneKind
  label: string
  color: string
}

const Z_COLOR: Record<ZoneKind, string> = {
  cont1: 'var(--nx-zone-libertadores, #3ee6a4)',
  pre: 'var(--nx-zone-pre, #7fd9ff)',
  cont2: 'var(--nx-zone-sula, #6f8cff)',
  cont3: '#b48cff',
  promo: 'var(--nx-zone-libertadores, #3ee6a4)',
  'promo-po': 'var(--nx-zone-pre, #7fd9ff)',
  'releg-po': '#ffb057',
  releg: 'var(--nx-zone-z4, #ff5e78)',
}

const CONT_NAMES: Record<League['confed'], [string, string, string]> = {
  CONMEBOL: ['Libertadores', 'Sul-Americana', 'Sul-Americana'],
  UEFA: ['Champions League', 'Europa League', 'Conference League'],
  CONCACAF: ['Champions Cup', 'Liga Concacaf', 'Liga Concacaf'],
  AFC: ['Champions da Ásia', 'Liga dos Campeões 2', 'Copa da AFC'],
  CAF: ['Champions da África', 'Copa das Confederações', 'Copa das Confederações'],
  OFC: ['Champions da Oceania', 'Champions da Oceania', 'Champions da Oceania'],
}

/** Zone for each position (1-based) of a table of `size` clubs. */
export function zonesFor(league: League, size: number, data: GameData | null): (Zone | null)[] {
  const out: (Zone | null)[] = Array.from({ length: size + 1 }, () => null)
  const put = (from: number, to: number, kind: ZoneKind, label: string) => {
    for (let p = Math.max(1, from); p <= Math.min(size, to); p++) if (!out[p]) out[p] = { kind, label, color: Z_COLOR[kind] }
  }
  const [c1, c2] = league.continentalSlots ?? [0, 0]
  const c3 = league.continentalTertiarySlots ?? 0
  const names = CONT_NAMES[league.confed] ?? CONT_NAMES.UEFA
  let p = 1
  // promotion (lower divisions)
  if (league.promotion > 0) {
    const po = league.promotionPlayoff
    const direct = po ? Math.max(0, league.promotion - po.spots) : league.promotion
    put(1, direct, 'promo', 'Acesso')
    if (po) put(po.positions[0], po.positions[1], 'promo-po', 'Playoff de acesso')
  }
  if (c1 > 0) {
    if (league.confed === 'CONMEBOL' && c1 >= 6) {
      put(p, p + c1 - 3, 'cont1', names[0])
      put(p + c1 - 2, p + c1 - 1, 'pre', `Pré-${names[0]}`)
    } else put(p, p + c1 - 1, 'cont1', names[0])
    p += c1
  }
  if (c2 > 0) {
    put(p, p + c2 - 1, 'cont2', names[1])
    p += c2
  }
  if (c3 > 0) put(p, p + c3 - 1, 'cont3', names[2])
  // relegation (with a play-off against the lower division's contender)
  if (league.relegation > 0) {
    const lower = data?.leagues.find((l) => l.upperLeagueId === league.id && l.promotionPlayoff?.upperPosition)
    const upperPos = lower?.promotionPlayoff?.upperPosition
    const direct = upperPos ? league.relegation - 1 : league.relegation
    put(size - direct + 1, size, 'releg', 'Rebaixamento')
    if (upperPos) put(upperPos, upperPos, 'releg-po', 'Playoff de permanência')
  }
  return out
}

/** Unique zones in table order, for the legend. */
export function zoneLegend(zones: (Zone | null)[]): Zone[] {
  const seen = new Set<string>()
  const out: Zone[] = []
  for (const z of zones) {
    if (!z || seen.has(z.label)) continue
    seen.add(z.label)
    out.push(z)
  }
  return out
}

/** "27 set" from an ISO date. */
export function shortDate(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', timeZone: 'America/Sao_Paulo' }).replace('.', '').replace(' de ', ' ')
}
