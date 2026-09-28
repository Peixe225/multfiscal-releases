/** Lendas reais na mesma escala das runs (legendScore). */
import { REAL_LEGENDS, type Legend, type LegendField } from '../../data/catalog/legends'
import type { PositionGroup } from '../types'
import { positionGroupOf, type CategoryId, type CategoryValues } from './categories'
import { legendWorldRecords, type LegendWorldRecord } from './records'
import { legacyTier, scoreValues, type BreakdownItem, type LegacyTier } from './score'

export interface LegendLegacy {
  kind: 'legend'
  id: string
  legend: Legend
  values: CategoryValues
  apps: number
  positionGroup: PositionGroup
  score: number
  raw: number
  breakdown: BreakdownItem[]
  tier: LegacyTier
  /** Recordes mundiais nas métricas do jogo (a categoria Recordes conta estes). */
  worldRecords: LegendWorldRecord[]
  /** Categoria com valor incerto/estimado (a UI mostra "≈"). */
  approx: Partial<Record<CategoryId, boolean>>
}

const FIELD_TO_CAT: Partial<Record<LegendField, CategoryId>> = {
  goals: 'goals',
  assists: 'assists',
  ballonDor: 'ballonDor',
  worldCups: 'worldCups',
  goldenBoots: 'goldenBoots',
  ucl: 'ucl',
  libertadores: 'libertadores',
  leagueTitles: 'leagueTitles',
}

export function legendValues(l: Legend, pool: Legend[] = REAL_LEGENDS): CategoryValues {
  return {
    ballonDor: l.ballonDor,
    worldCups: l.worldCups,
    goldenBoots: l.goldenBoots,
    ucl: l.ucl,
    libertadores: l.libertadores,
    leagueTitles: l.leagueTitles,
    clubs: l.clubs.length,
    goals: l.goals,
    assists: l.assists,
    records: legendWorldRecords(l, pool).length,
    goalsPerGame: l.apps > 0 ? l.goals / l.apps : 0,
  }
}

export function evaluateLegend(l: Legend, pool: Legend[] = REAL_LEGENDS): LegendLegacy {
  const values = legendValues(l, pool)
  const positionGroup = positionGroupOf(l.position)
  const s = scoreValues({ values, apps: l.apps, positionGroup, oneClub: l.clubs.length === 1, retroBallonDor: l.retroBallonDor })
  const approx: LegendLegacy['approx'] = {}
  for (const f of l.uncertain ?? []) {
    const cat = FIELD_TO_CAT[f]
    if (cat) approx[cat] = true
    if (f === 'apps' || f === 'goals') approx.goalsPerGame = true
  }
  if (l.assistsEstimated) approx.assists = true
  return { kind: 'legend', id: l.id, legend: l, values, apps: l.apps, positionGroup, score: s.score, raw: s.raw, breakdown: s.breakdown, tier: legacyTier(s.score), worldRecords: legendWorldRecords(l, pool), approx }
}

let cache: { src: Legend[]; out: LegendLegacy[] } | null = null

/** Todas as lendas avaliadas, da maior nota para a menor (memoizado para a lista padrão). */
export function evaluateLegends(legends: Legend[] = REAL_LEGENDS): LegendLegacy[] {
  if (cache && cache.src === legends) return cache.out
  const out = legends.map((l) => evaluateLegend(l, legends)).sort((a, b) => b.raw - a.raw)
  if (legends === REAL_LEGENDS) cache = { src: legends, out }
  return out
}
