/**
 * Avaliação de runs e do Hall inteiro: nota, recordes, ranking geral misto (runs + lendas),
 * pódios por categoria e frases de comparação ("Sua run nº 3 tem mais Libertadores que Pelé").
 */
import { REAL_LEGENDS, type Legend } from '../../data/catalog/legends'
import { CATEGORIES, CATEGORY_IDS, formatCategoryValue, type CategoryId, type CategoryValues } from './categories'
import { evaluateLegends, type LegendLegacy } from './legends'
import { historicRecords, personalRecords, type LegacyRecord } from './records'
import { legacyTier, scoreValues, type BreakdownItem, type LegacyTier } from './score'
import { runStats, type RunInput, type RunStats } from './stats'

/**
 * Recordes pessoais (contra as suas runs anteriores) NÃO entram na nota nem na categoria Recordes:
 * a nota de uma run depende só dela mesma, então Hall, Resumo e conquistas mostram o mesmo número
 * e ele não muda com a ordem das runs ou quando uma run antiga sai do Hall.
 */
export const PERSONAL_RECORD_WEIGHT = 0

export interface RunLegacy {
  kind: 'run'
  id: string
  runNo: number
  input: RunInput
  stats: RunStats
  values: CategoryValues
  /** Recordes mundiais quebrados (contam na categoria e na nota). */
  historic: LegacyRecord[]
  /** Recordes das suas runs (só selo; nunca comparados com lendas). */
  personal: LegacyRecord[]
  /** historic + personal, para listar. */
  records: LegacyRecord[]
  score: number
  raw: number
  breakdown: BreakdownItem[]
  tier: LegacyTier
}

export interface EvaluateOptions {
  /** Runs encerradas ANTES desta (para recordes pessoais). */
  previous?: { stats: RunStats; runNo?: number }[]
  legends?: Legend[]
  /** false = carreira em andamento (ignora marcas que ainda podem cair). */
  finished?: boolean
}

export function evaluateRun(input: RunInput, opts: EvaluateOptions = {}): RunLegacy {
  const stats = runStats(input)
  const historic = historicRecords(stats, { legends: opts.legends, finished: opts.finished })
  const personal = personalRecords(stats, opts.previous ?? [])
  const values: CategoryValues = { ...stats.values, records: historic.length }
  const s = scoreValues({ values, apps: stats.apps, positionGroup: stats.positionGroup, oneClub: stats.oneClub })
  return {
    kind: 'run',
    id: input.id,
    runNo: input.runNo ?? (opts.previous?.length ?? 0) + 1,
    input,
    stats,
    values,
    historic,
    personal,
    records: [...historic, ...personal],
    score: s.score,
    raw: s.raw,
    breakdown: s.breakdown,
    tier: legacyTier(s.score),
  }
}

// ───────────────────────── ranking ─────────────────────────

export type RankEntry = RunLegacy | LegendLegacy

export interface RankRow {
  rank: number
  entry: RankEntry
  /** Valor ordenado (nota no geral; valor da categoria nos pódios). */
  value: number
}

const entryName = (e: RankEntry) => (e.kind === 'run' ? e.input.identity.surname : e.legend.name)

function rankRows(entries: RankEntry[], value: (e: RankEntry) => number, tie: (e: RankEntry) => number): RankRow[] {
  const sorted = entries.slice().sort((a, b) => value(b) - value(a) || tie(b) - tie(a) || (a.kind === 'run' ? -1 : 1) || entryName(a).localeCompare(entryName(b)))
  const rows: RankRow[] = []
  sorted.forEach((entry, i) => {
    const v = value(entry)
    const prev = rows[i - 1]
    rows.push({ entry, value: v, rank: prev && Math.abs(prev.value - v) < 1e-9 ? prev.rank : i + 1 })
  })
  return rows
}

/** Ranking geral por Nota de Legado (runs e lendas misturadas). */
export function overallRanking(runs: RunLegacy[], legends: LegendLegacy[]): RankRow[] {
  return rankRows([...runs, ...legends], (e) => e.score, (e) => e.raw)
}

const appsOf = (e: RankEntry) => (e.kind === 'run' ? e.stats.apps : e.apps)

/** Ranking de uma categoria (média de gols exige o mínimo de jogos). */
export function categoryRanking(id: CategoryId, runs: RunLegacy[], legends: LegendLegacy[]): RankRow[] {
  const min = CATEGORIES[id].minApps ?? 0
  const pool = [...runs, ...legends].filter((e) => appsOf(e) >= min)
  const round = CATEGORIES[id].ratio ? (v: number) => Math.round(v * 100) / 100 : (v: number) => v
  return rankRows(pool, (e) => round(e.values[id]), (e) => e.raw)
}

// ───────────────────────── comparações ─────────────────────────

export interface LegacyComparison {
  category: CategoryId | 'score'
  legendId: string
  text: string
  /** Menor = mais impressionante (posição da lenda superada no ranking da categoria). */
  weight: number
}

const runLabel = (run: RunLegacy) => `Sua run nº ${run.runNo}`
const PRODUCTION = new Set<CategoryId>(['goals', 'assists', 'goalsPerGame'])

/**
 * Frases de comparação com lendas reais. Para cada categoria, a lenda superada com o MAIOR valor
 * (ignora lendas com 0 — "mais Libertadores que Messi (0)" não diz nada).
 */
export function compareRun(run: RunLegacy, legends: LegendLegacy[] = evaluateLegends(), opts: { max?: number } = {}): LegacyComparison[] {
  const out: LegacyComparison[] = []
  for (const id of CATEGORY_IDS) {
    const meta = CATEGORIES[id]
    if (meta.minApps && run.stats.apps < meta.minApps) continue
    const rv = run.values[id]
    if (rv <= 0) continue
    const r2 = meta.ratio ? Math.round(rv * 100) / 100 : rv
    // gols/assistências/média: só contra quem vive disso (bater Beckenbauer em gols não diz nada)
    const prod = PRODUCTION.has(id)
    const pool = legends.filter((l) => l.values[id] > 0 && (!meta.minApps || l.apps >= meta.minApps) && (!prod || l.positionGroup === 'attacking' || l.positionGroup === 'support'))
    const sorted = pool.slice().sort((a, b) => b.values[id] - a.values[id] || b.raw - a.raw)
    const below = sorted.filter((l) => (meta.ratio ? Math.round(l.values[id] * 100) / 100 : l.values[id]) < r2)
    const target = below[0]
    if (target) {
      const pos = sorted.indexOf(target)
      const v = formatCategoryValue(id, target.values[id], { approx: !!target.approx[id], unit: false })
      const lead = pos === 0 ? ' — ninguém entre as lendas tem mais' : ''
      out.push({ category: id, legendId: target.id, text: `${runLabel(run)} ${meta.more} ${target.legend.name} (${v})${lead}.`, weight: pos / Math.max(1, sorted.length) + CATEGORY_IDS.indexOf(id) * 0.01 + (id === 'clubs' ? 0.6 : 0) })
    } else {
      // igualou o topo?
      const top = sorted[0]
      if (top && (meta.ratio ? Math.round(top.values[id] * 100) / 100 : top.values[id]) === r2)
        out.push({ category: id, legendId: top.id, text: `${runLabel(run)} igualou ${top.legend.name}: ${formatCategoryValue(id, rv, { approx: !!top.approx[id] })}.`, weight: 0.05 })
    }
  }
  // nota geral
  const beaten = legends.filter((l) => l.raw < run.raw).sort((a, b) => b.raw - a.raw)[0]
  if (beaten) {
    const pos = legends.indexOf(beaten)
    out.push({ category: 'score', legendId: beaten.id, text: `${runLabel(run)} tem Nota de Legado maior que a de ${beaten.legend.name} (${beaten.score}).`, weight: pos / Math.max(1, legends.length) - 0.02 })
  }
  out.sort((a, b) => a.weight - b.weight)
  return out.slice(0, opts.max ?? 8)
}

/** Próxima lenda acima da run no ranking geral ("Próximo alvo"). */
export function nextTarget(run: RunLegacy, legends: LegendLegacy[] = evaluateLegends()): { legend: LegendLegacy; gap: number } | null {
  const above = legends.filter((l) => l.raw > run.raw).sort((a, b) => a.raw - b.raw)[0]
  // gap 0 = mesma nota arredondada (a lenda está à frente por décimos)
  return above ? { legend: above, gap: Math.max(0, above.score - run.score) } : null
}

// ───────────────────────── Hall inteiro ─────────────────────────

export interface HallEvaluation {
  /** Runs em ordem cronológica (run nº 1 primeiro). */
  runs: RunLegacy[]
  legends: LegendLegacy[]
  overall: RankRow[]
  categories: Record<CategoryId, RankRow[]>
  bestRun: RunLegacy | null
  topLegend: LegendLegacy
}

/**
 * Avalia todas as runs em ordem cronológica (cada uma contra as anteriores) e monta os rankings.
 * `inputs` pode vir em qualquer ordem: usa `runNo`, depois `finishedAt`.
 */
export function evaluateHall(inputs: RunInput[], opts: { legends?: Legend[] } = {}): HallEvaluation {
  const legends = evaluateLegends(opts.legends ?? REAL_LEGENDS)
  const ordered = inputs
    .slice()
    .sort((a, b) => (a.runNo ?? Infinity) - (b.runNo ?? Infinity) || (a.finishedAt ?? '').localeCompare(b.finishedAt ?? ''))
  const runs: RunLegacy[] = []
  let next = Math.max(0, ...ordered.map((r) => r.runNo ?? 0))
  for (const input of ordered) {
    const runNo = input.runNo ?? ++next
    const previous = runs.map((r) => ({ stats: r.stats, runNo: r.runNo }))
    runs.push(evaluateRun({ ...input, runNo }, { previous, legends: opts.legends }))
  }
  const categories = Object.fromEntries(CATEGORY_IDS.map((id) => [id, categoryRanking(id, runs, legends)])) as Record<CategoryId, RankRow[]>
  const bestRun = runs.slice().sort((a, b) => b.raw - a.raw)[0] ?? null
  return { runs, legends, overall: overallRanking(runs, legends), categories, bestRun, topLegend: legends[0] }
}

/**
 * Posição de UMA run (ex.: a carreira que acabou de terminar) no ranking geral, contra as lendas e
 * as runs já no Hall. `previous` = runs encerradas antes dela.
 */
export function placeRun(input: RunInput, previousInputs: RunInput[] = [], opts: { legends?: Legend[]; finished?: boolean } = {}) {
  const hall = evaluateHall(previousInputs, opts)
  const runNo = input.runNo ?? Math.max(0, ...hall.runs.map((r) => r.runNo)) + 1
  const run = evaluateRun({ ...input, runNo }, { previous: hall.runs.map((r) => ({ stats: r.stats, runNo: r.runNo })), legends: opts.legends, finished: opts.finished })
  const others = hall.runs.filter((r) => r.id !== run.id)
  const overall = overallRanking([...others, run], hall.legends)
  const row = overall.find((r) => r.entry === run)!
  const legendsBelow = hall.legends.filter((l) => l.raw < run.raw).length
  const runsAbove = others.filter((r) => r.raw > run.raw).length
  return { run, rank: row.rank, total: overall.length, legendsBelow, runRank: runsAbove + 1, runCount: others.length + 1, comparisons: compareRun(run, hall.legends), next: nextTarget(run, hall.legends) }
}
