/**
 * Avaliação de runs e do Hall inteiro: nota, recordes, ranking geral misto (runs + lendas),
 * pódios por categoria e frases de comparação ("Sua carreira nº 3 tem mais Libertadores que Pelé").
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
  const s = scoreValues({ values, apps: stats.apps, positionGroup: stats.positionGroup, oneClub: stats.oneClub, minorTitles: stats.minorTitles })
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

/** Um critério da cadeia de desempate. */
export interface TieCriterion {
  id: string
  /** Texto da UI: "desempate: nota bruta 53,07 × 53,05", "desempate: Bolas de Ouro 5 × 3". */
  label: string
  get(e: RankEntry): number
  fmt?(v: number): string
  /** Menor vence (ex.: menos jogos para o mesmo número de gols). */
  lowerIsBetter?: boolean
}

/** Por que uma linha ficou à frente da de baixo com o mesmo valor exibido. */
export interface TieBreak {
  criterion: string
  label: string
  /** Valor desta linha e o da linha de baixo, já formatados. */
  mine: string
  theirs: string
  /** Nome de quem ficou atrás. */
  against: string
}

export interface RankRow {
  rank: number
  entry: RankEntry
  /** Valor ordenado (nota no geral; valor da categoria nos pódios). */
  value: number
  /** Desempate contra a linha de BAIXO quando as duas têm o mesmo valor (nota ou valor da categoria). */
  tieBreak?: TieBreak
  /** O mesmo desempate visto por quem ficou atrás (contra a linha de CIMA): `mine` é o desta linha. */
  behind?: TieBreak
}

const entryName = (e: RankEntry) => (e.kind === 'run' ? e.input.identity.surname : e.legend.name)
const appsOf = (e: RankEntry) => (e.kind === 'run' ? e.stats.apps : e.apps)
const dec2 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const EPS = 1e-9

const RAW: TieCriterion = { id: 'raw', label: 'nota bruta', get: (e) => e.raw, fmt: dec2 }
const APPS: TieCriterion = { id: 'apps', label: 'jogos', get: appsOf }
const FEWER_APPS: TieCriterion = { id: 'fewerApps', label: 'menos jogos', get: appsOf, lowerIsBetter: true }
const cat = (id: CategoryId, label = CATEGORIES[id].label.toLowerCase()): TieCriterion => ({ id, label, get: (e) => e.values[id], fmt: CATEGORIES[id].ratio ? dec2 : undefined })
const RETRO: TieCriterion = { id: 'retroBallonDor', label: 'Bolas de Ouro retroativas', get: (e) => (e.kind === 'legend' ? (e.legend.retroBallonDor ?? 0) : 0) }
const CONTINENTAL: TieCriterion = { id: 'continental', label: 'Champions + Libertadores', get: (e) => e.values.ucl + e.values.libertadores }

/**
 * Desempate do RANKING GERAL, nesta ordem, quando duas notas (arredondadas) empatam:
 *   nota bruta → Bolas de Ouro → Copas do Mundo → títulos (todos) → prêmios individuais → gols →
 *   jogos → nome (empate em tudo: a sua carreira fica à frente da lenda; a posição é dividida).
 */
export const OVERALL_TIEBREAK: readonly TieCriterion[] = [RAW, cat('ballonDor', 'Bolas de Ouro'), cat('worldCups', 'Copas do Mundo'), cat('titles'), cat('awards'), cat('goals'), APPS]

/**
 * Desempate de cada categoria (depois do valor da categoria; no fim, nota bruta e nome). Mesma
 * lógica do geral: primeiro o que mais se parece com a categoria, depois a carreira como um todo.
 */
export const CATEGORY_TIEBREAK: Record<CategoryId, readonly TieCriterion[]> = {
  ballonDor: [RETRO, cat('bestPlayer'), cat('awards'), RAW],
  bestPlayer: [cat('ballonDor', 'Bolas de Ouro'), cat('awards'), RAW],
  goldenBoots: [cat('topScorer'), cat('goals'), RAW],
  topScorer: [cat('goldenBoots', 'Chuteiras de Ouro'), cat('goals'), RAW],
  puskas: [cat('goals'), cat('awards'), RAW],
  goldenGloves: [cat('titles'), APPS, RAW],
  awards: [cat('ballonDor', 'Bolas de Ouro'), cat('bestPlayer'), RAW],
  worldCups: [cat('ballonDor', 'Bolas de Ouro'), cat('titles'), RAW],
  ucl: [cat('titles'), cat('leagueTitles'), RAW],
  libertadores: [cat('titles'), cat('leagueTitles'), RAW],
  leagueTitles: [cat('titles'), RAW],
  titles: [cat('worldCups', 'Copas do Mundo'), CONTINENTAL, cat('leagueTitles'), RAW],
  goals: [FEWER_APPS, RAW],
  assists: [FEWER_APPS, RAW],
  goalsPerGame: [cat('goals'), RAW],
  records: [RAW],
  clubs: [APPS, RAW],
}

function rankRows(entries: RankEntry[], value: (e: RankEntry) => number, criteria: readonly TieCriterion[]): RankRow[] {
  const diff = (c: TieCriterion, a: RankEntry, b: RankEntry) => {
    const d = c.get(a) - c.get(b)
    return Math.abs(d) < EPS ? 0 : c.lowerIsBetter ? -d : d
  }
  const cmp = (a: RankEntry, b: RankEntry) => {
    const d = value(b) - value(a)
    if (Math.abs(d) >= EPS) return d
    for (const c of criteria) {
      const x = diff(c, b, a)
      if (x) return x
    }
    return (a.kind === b.kind ? 0 : a.kind === 'run' ? -1 : 1) || entryName(a).localeCompare(entryName(b), 'pt-BR')
  }
  const sorted = entries.slice().sort(cmp)
  const rows: RankRow[] = sorted.map((entry) => ({ entry, value: value(entry), rank: 0 }))
  rows.forEach((row, i) => {
    const prev = rows[i - 1]
    const tied = !!prev && Math.abs(prev.value - row.value) < EPS
    // empate em tudo (só o nome separa): posição dividida
    row.rank = tied && criteria.every((c) => !diff(c, prev.entry, row.entry)) ? prev.rank : i + 1
    if (tied) {
      const c = criteria.find((k) => diff(k, prev.entry, row.entry))
      if (c) {
        const f = c.fmt ?? ((v: number) => Math.round(v).toLocaleString('pt-BR'))
        prev.tieBreak = { criterion: c.id, label: c.label, mine: f(c.get(prev.entry)), theirs: f(c.get(row.entry)), against: entryName(row.entry) }
        row.behind = { criterion: c.id, label: c.label, mine: f(c.get(row.entry)), theirs: f(c.get(prev.entry)), against: entryName(prev.entry) }
      }
    }
  })
  return rows
}

/** Ranking geral por Nota de Legado (runs e lendas misturadas), com a cadeia de desempate acima. */
export function overallRanking(runs: RunLegacy[], legends: LegendLegacy[]): RankRow[] {
  return rankRows([...runs, ...legends], (e) => e.score, OVERALL_TIEBREAK)
}

/** Ranking de uma categoria (média de gols exige o mínimo de jogos). */
export function categoryRanking(id: CategoryId, runs: RunLegacy[], legends: LegendLegacy[]): RankRow[] {
  const min = CATEGORIES[id].minApps ?? 0
  const pool = [...runs, ...legends].filter((e) => appsOf(e) >= min)
  const round = CATEGORIES[id].ratio ? (v: number) => Math.round(v * 100) / 100 : (v: number) => v
  return rankRows(pool, (e) => round(e.values[id]), CATEGORY_TIEBREAK[id])
}

// ───────────────────────── comparações ─────────────────────────

export interface LegacyComparison {
  category: CategoryId | 'score'
  legendId: string
  text: string
  /** Menor = mais impressionante (posição da lenda superada no ranking da categoria). */
  weight: number
}

const runLabel = (run: RunLegacy) => `Sua carreira nº ${run.runNo}`
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
      out.push({ category: id, legendId: target.id, text: `${runLabel(run)} ${meta.more} ${target.legend.name} (${v})${lead}.`, weight: pos / Math.max(1, sorted.length) + CATEGORY_IDS.indexOf(id) * 0.01 + (id === 'clubs' ? 0.6 : id === 'awards' ? 0.3 : 0) })
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

export interface HallOptions {
  /** Lendas do Hall (padrão: REAL_LEGENDS; no site, com os números ao vivo de Messi e Cristiano). */
  legends?: Legend[]
  /**
   * Lendas que servem de régua para os RECORDES das runs (padrão: as mesmas de `legends`). O Hall passa
   * REAL_LEGENDS aqui: a nota de uma run não muda quando os números ao vivo de uma lenda mudam.
   */
  recordBase?: Legend[]
}

/**
 * Avalia todas as runs em ordem cronológica (cada uma contra as anteriores) e monta os rankings.
 * `inputs` pode vir em qualquer ordem: usa `runNo`, depois `finishedAt`.
 */
export function evaluateHall(inputs: RunInput[], opts: HallOptions = {}): HallEvaluation {
  const legends = evaluateLegends(opts.legends ?? REAL_LEGENDS)
  const ordered = inputs
    .slice()
    .sort((a, b) => (a.runNo ?? Infinity) - (b.runNo ?? Infinity) || (a.finishedAt ?? '').localeCompare(b.finishedAt ?? ''))
  const runs: RunLegacy[] = []
  let next = Math.max(0, ...ordered.map((r) => r.runNo ?? 0))
  for (const input of ordered) {
    const runNo = input.runNo ?? ++next
    const previous = runs.map((r) => ({ stats: r.stats, runNo: r.runNo }))
    runs.push(evaluateRun({ ...input, runNo }, { previous, legends: opts.recordBase ?? opts.legends }))
  }
  const categories = Object.fromEntries(CATEGORY_IDS.map((id) => [id, categoryRanking(id, runs, legends)])) as Record<CategoryId, RankRow[]>
  const bestRun = runs.slice().sort((a, b) => b.raw - a.raw)[0] ?? null
  return { runs, legends, overall: overallRanking(runs, legends), categories, bestRun, topLegend: legends[0] }
}

/**
 * Posição de UMA run (ex.: a carreira que acabou de terminar) no ranking geral, contra as lendas e
 * as runs já no Hall. `previous` = runs encerradas antes dela.
 */
export function placeRun(input: RunInput, previousInputs: RunInput[] = [], opts: HallOptions & { finished?: boolean } = {}) {
  const hall = evaluateHall(previousInputs, opts)
  const runNo = input.runNo ?? Math.max(0, ...hall.runs.map((r) => r.runNo)) + 1
  const run = evaluateRun({ ...input, runNo }, { previous: hall.runs.map((r) => ({ stats: r.stats, runNo: r.runNo })), legends: opts.recordBase ?? opts.legends, finished: opts.finished })
  const others = hall.runs.filter((r) => r.id !== run.id)
  const overall = overallRanking([...others, run], hall.legends)
  const row = overall.find((r) => r.entry === run)!
  const legendsBelow = hall.legends.filter((l) => l.raw < run.raw).length
  const runsAbove = others.filter((r) => r.raw > run.raw).length
  return { run, rank: row.rank, total: overall.length, legendsBelow, runRank: runsAbove + 1, runCount: others.length + 1, comparisons: compareRun(run, hall.legends), next: nextTarget(run, hall.legends) }
}
