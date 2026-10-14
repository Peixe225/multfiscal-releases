/** Lendas reais na mesma escala das runs (legendScore). */
import { REAL_LEGENDS, legendTotalTitles, type Legend, type LegendAwardKey, type LegendField } from '../../data/catalog/legends'
import type { AwardId, PositionGroup } from '../types'
import { awardCategoryValues, CATEGORIES, CATEGORY_IDS, positionGroupOf, type CategoryId, type CategoryValues } from './categories'
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
  totalTitles: 'titles',
}

/** Taças menores da lenda (estaduais e supercopas): valem MINOR_TITLE_CREDIT em Títulos (todos). */
export const legendMinorTitles = (l: Legend) => (l.honours ?? []).reduce((s, h) => s + (h.kind === 'supercup' || h.kind === 'state' ? h.n : 0), 0)

/** Prêmios da lenda por chave (soma de `awards[].n`). */
export function legendAwardCounts(l: Legend): Partial<Record<LegendAwardKey, number>> {
  const out: Partial<Record<LegendAwardKey, number>> = {}
  for (const a of l.awards ?? []) out[a.key] = (out[a.key] ?? 0) + a.n
  return out
}

export function legendValues(l: Legend, pool: Legend[] = REAL_LEGENDS): CategoryValues {
  const counts = legendAwardCounts(l)
  // Bola de Ouro e Chuteira de Ouro vêm dos campos (as listas de prêmios batem com eles — ver os testes)
  const prizes = awardCategoryValues((a: AwardId) => (a === 'ballon_dor' ? l.ballonDor : a === 'golden_boot' ? l.goldenBoots : (counts[a as LegendAwardKey] ?? 0)))
  return {
    ...prizes,
    worldCups: l.worldCups,
    ucl: l.ucl,
    libertadores: l.libertadores,
    leagueTitles: l.leagueTitles,
    titles: legendTotalTitles(l),
    clubs: (l.clubs ?? []).length,
    goals: l.goals,
    assists: l.assists,
    records: legendWorldRecords(l, pool).length,
    goalsPerGame: l.apps > 0 ? l.goals / l.apps : 0,
  }
}

export function evaluateLegend(l: Legend, pool: Legend[] = REAL_LEGENDS): LegendLegacy {
  const values = legendValues(l, pool)
  const positionGroup = positionGroupOf(l.position)
  const s = scoreValues({ values, apps: l.apps, positionGroup, oneClub: (l.clubs ?? []).length === 1, retroBallonDor: l.retroBallonDor, minorTitles: legendMinorTitles(l) })
  const approx: LegendLegacy['approx'] = {}
  for (const f of l.uncertain ?? []) {
    const cat = FIELD_TO_CAT[f]
    if (cat) approx[cat] = true
    if (f === 'apps' || f === 'goals') approx.goalsPerGame = true
  }
  if (l.assistsEstimated) approx.assists = true
  // prêmio com contagem em aberto: "≈" nas categorias que o somam
  for (const k of l.uncertainAwards ?? []) for (const id of CATEGORY_IDS) if (CATEGORIES[id].awards?.includes(k as AwardId)) approx[id] = true
  return { kind: 'legend', id: l.id, legend: l, values, apps: l.apps, positionGroup, score: s.score, raw: s.raw, breakdown: s.breakdown, tier: legacyTier(s.score), worldRecords: legendWorldRecords(l, pool), approx }
}

let cache: { src: Legend[]; out: LegendLegacy[] } | null = null

/** Todas as lendas avaliadas, da maior nota para a menor (memoizado para a última lista avaliada). */
export function evaluateLegends(legends: Legend[] = REAL_LEGENDS): LegendLegacy[] {
  if (cache && cache.src === legends) return cache.out
  const out = legends.map((l) => evaluateLegend(l, legends)).sort((a, b) => b.raw - a.raw)
  cache = { src: legends, out }
  return out
}
