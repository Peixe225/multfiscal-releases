/**
 * Recordes quebrados por uma run:
 *   - "historia": contra o histórico real (HISTORIC_RECORDS + máximos do conjunto de lendas). É o
 *     que entra na categoria Recordes e na Nota de Legado;
 *   - "runs": contra as SUAS runs anteriores (recorde pessoal). Só selo/frase: não entra na nota
 *     nem é comparado com lendas. Precisa superar uma marca que já existia (0 não é marca).
 * Só conta quem SUPERA a marca (igualar não quebra recorde).
 *
 * As lendas pontuam na MESMA base: `legendWorldRecords` conta as métricas acima em que a lenda
 * detém o recorde mundial hoje (HISTORIC_RECORDS.holderIds / máximo do Hall) ou deteve na época
 * (`Legend.pastRecords`). Os textos livres de `Legend.records` são só para exibição.
 */
import { HISTORIC_RECORDS, REAL_LEGENDS, type Legend, type LegendRecordMetric } from '../../data/catalog/legends'
import type { RunStats } from './stats'

/** Métricas de recorde (definidas junto das lendas, que usam as mesmas). */
export type RecordMetric = LegendRecordMetric

export interface LegacyRecord {
  id: string
  scope: 'historia' | 'runs'
  metric: RecordMetric
  /** Rótulo curto: "Bolas de Ouro", "Gols numa temporada". */
  label: string
  value: number
  previous: number
  /** Quem tinha a marca: "Messi", "carreira nº 2". */
  holder: string
  /** Marca nova, pronta para exibir: "9 Bolas de Ouro". */
  valueText: string
  /** Frase completa em pt-BR. */
  text: string
  approx?: boolean
}

const int = (v: number) => Math.round(v).toLocaleString('pt-BR')
const dec = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pl = (v: number, one: string, many: string) => `${int(v)} ${Math.round(v) === 1 ? one : many}`

interface MetricDef {
  label: string
  get(s: RunStats): number | null
  fmt(v: number): string
  lowerIsBetter?: boolean
  /** Métrica que pode cair com o tempo — só vale com a carreira encerrada. */
  finalOnly?: boolean
  /** Jogos mínimos para valer (média). */
  minApps?: number
}

export const RECORD_METRICS: Record<RecordMetric, MetricDef> = {
  ballonDor: { label: 'Bolas de Ouro', get: (s) => s.values.ballonDor, fmt: (v) => pl(v, 'Bola de Ouro', 'Bolas de Ouro') },
  ballonDorStreak: { label: 'Bolas de Ouro seguidas', get: (s) => s.ballonDorStreak, fmt: (v) => `${int(v)} Bolas de Ouro seguidas` },
  worldCups: { label: 'Copas do Mundo', get: (s) => s.values.worldCups, fmt: (v) => pl(v, 'Copa do Mundo', 'Copas do Mundo') },
  goldenBoots: { label: 'Chuteiras de Ouro', get: (s) => s.values.goldenBoots, fmt: (v) => pl(v, 'Chuteira de Ouro', 'Chuteiras de Ouro') },
  ucl: { label: 'Champions League', get: (s) => s.values.ucl, fmt: (v) => `${int(v)} Champions` },
  libertadores: { label: 'Libertadores', get: (s) => s.values.libertadores, fmt: (v) => `${int(v)} Libertadores` },
  leagueTitles: { label: 'Títulos nacionais', get: (s) => s.values.leagueTitles, fmt: (v) => pl(v, 'título nacional', 'títulos nacionais') },
  titles: { label: 'Títulos na carreira', get: (s) => s.titles, fmt: (v) => pl(v, 'título', 'títulos') },
  goals: { label: 'Gols na carreira', get: (s) => s.goals, fmt: (v) => pl(v, 'gol', 'gols') },
  assists: { label: 'Assistências na carreira', get: (s) => s.assists, fmt: (v) => pl(v, 'assistência', 'assistências') },
  apps: { label: 'Jogos na carreira', get: (s) => s.apps, fmt: (v) => pl(v, 'jogo', 'jogos') },
  goalsPerGame: { label: 'Média de gols', get: (s) => s.values.goalsPerGame, fmt: (v) => `média de ${dec(v)} gol por jogo`, finalOnly: true, minApps: 300 },
  seasonGoals: { label: 'Gols numa temporada', get: (s) => s.bestSeasonGoals?.value ?? 0, fmt: (v) => `${pl(v, 'gol', 'gols')} numa temporada` },
  seasonAssists: { label: 'Assistências numa temporada', get: (s) => s.bestSeasonAssists?.value ?? 0, fmt: (v) => `${pl(v, 'assistência', 'assistências')} numa temporada` },
  clubGoals: { label: 'Gols por um só clube', get: (s) => s.bestClubGoals?.goals ?? 0, fmt: (v) => `${pl(v, 'gol', 'gols')} por um só clube` },
  nationalGoals: { label: 'Gols pela seleção', get: (s) => s.nationalGoals, fmt: (v) => `${pl(v, 'gol', 'gols')} pela seleção` },
  youngestBallonDor: { label: 'Bola de Ouro mais jovem', get: (s) => s.youngestBallonDorAge, fmt: (v) => `Bola de Ouro aos ${int(v)} anos`, lowerIsBetter: true },
}

interface HistoricRef {
  metric: RecordMetric
  value: number
  holder: string
  holderIds?: string[]
  detail?: string
  approx?: boolean
  lowerIsBetter?: boolean
}

let refCache: { src: Legend[]; refs: HistoricRef[] } | null = null

/** Referências históricas: lista explícita + máximos do conjunto de lendas (títulos nacionais, jogos, média). */
export function historicRefs(legends: Legend[] = REAL_LEGENDS): HistoricRef[] {
  if (refCache && refCache.src === legends) return refCache.refs
  const refs: HistoricRef[] = HISTORIC_RECORDS.map((r) => ({ ...r }))
  const top = (get: (l: Legend) => number, filter: (l: Legend) => boolean = () => true) => {
    const pool = legends.filter(filter)
    const max = Math.max(0, ...pool.map(get))
    const top = pool.filter((l) => get(l) === max)
    const approx = top.some((l) => (l.uncertain?.length ?? 0) > 0)
    return { value: max, holder: joinNames(top.map((l) => l.name)), holderIds: top.map((l) => l.id), approx }
  }
  refs.push({ metric: 'leagueTitles', ...top((l) => l.leagueTitles), detail: 'entre as lendas do Hall' })
  refs.push({ metric: 'apps', ...top((l) => l.apps), detail: 'entre as lendas do Hall' })
  const gpg = top((l) => Math.round((l.goals / l.apps) * 100) / 100, (l) => l.apps >= 300)
  refs.push({ metric: 'goalsPerGame', ...gpg, detail: 'mínimo de 300 jogos' })
  refCache = { src: legends, refs }
  return refs
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}

const beats = (v: number, rec: number, lower?: boolean) => (lower ? v < rec : v > rec)

/** Recordes históricos que a run quebrou. `finished: false` ignora marcas que podem cair (média). */
export function historicRecords(stats: RunStats, opts: { legends?: Legend[]; finished?: boolean } = {}): LegacyRecord[] {
  const out: LegacyRecord[] = []
  const finished = opts.finished ?? true
  for (const ref of historicRefs(opts.legends)) {
    const def = RECORD_METRICS[ref.metric]
    if (def.finalOnly && !finished) continue
    if (def.minApps && stats.apps < def.minApps) continue
    const v = def.get(stats)
    if (v === null || v === undefined || (!def.lowerIsBetter && v <= 0)) continue
    if (!beats(v, ref.value, def.lowerIsBetter)) continue
    const prev = ref.metric === 'goalsPerGame' ? dec(ref.value) : int(ref.value)
    const who = `${ref.holder}${ref.detail && ref.metric !== 'goalsPerGame' && !ref.detail.startsWith('entre') ? `, ${ref.detail}` : ''}`
    const valueText = def.fmt(v)
    const text = def.lowerIsBetter
      ? `${valueText}: a mais jovem da história (antes: ${who}, aos ${prev}).`
      : ref.detail?.startsWith('entre')
        ? `${cap(valueText)}: mais que qualquer lenda do Hall (antes: ${who}, ${ref.approx ? '≈' : ''}${prev}).`
        : `${cap(valueText)}: recorde histórico (antes: ${who}, ${ref.approx ? '≈' : ''}${prev}).`
    out.push({ id: `historia:${ref.metric}`, scope: 'historia', metric: ref.metric, label: def.label, value: v, previous: ref.value, holder: ref.holder, valueText, text, approx: ref.approx })
  }
  return out
}

/** Métricas comparadas com as runs anteriores. */
const PERSONAL: RecordMetric[] = ['goals', 'assists', 'apps', 'ballonDor', 'worldCups', 'goldenBoots', 'ucl', 'libertadores', 'leagueTitles', 'titles', 'seasonGoals', 'seasonAssists', 'clubGoals', 'nationalGoals', 'goalsPerGame']

/** Recordes pessoais: supera o melhor valor de TODAS as runs anteriores (precisa existir ao menos uma). */
export function personalRecords(stats: RunStats, previous: { stats: RunStats; runNo?: number }[]): LegacyRecord[] {
  if (!previous.length) return []
  const out: LegacyRecord[] = []
  for (const metric of PERSONAL) {
    const def = RECORD_METRICS[metric]
    if (def.minApps && stats.apps < def.minApps) continue
    const v = def.get(stats) ?? 0
    if (v <= 0) continue
    let best = 0
    let who: number | undefined
    for (const p of previous) {
      if (def.minApps && p.stats.apps < def.minApps) continue
      const pv = def.get(p.stats) ?? 0
      if (pv > best) (best = pv), (who = p.runNo)
    }
    // "primeira vez" (as anteriores tinham 0) não é recorde
    if (best <= 0 || v <= best) continue
    const valueText = def.fmt(v)
    const prev = metric === 'goalsPerGame' ? dec(best) : int(best)
    const holder = who ? `carreira nº ${who}` : 'carreira anterior'
    const text = `${cap(valueText)}: recorde das suas carreiras (antes: ${prev}, ${holder}).`
    out.push({ id: `runs:${metric}`, scope: 'runs', metric, label: def.label, value: v, previous: best, holder, valueText, text })
  }
  return out
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export interface LegendWorldRecord {
  metric: RecordMetric
  label: string
  /** true = detém hoje; false = deteve na época e perdeu depois. */
  current: boolean
}

/**
 * Recordes mundiais de uma lenda nas métricas do jogo — a mesma régua que as runs quebram
 * (`historicRecords`). Conta cada métrica uma vez (atual vence "na época").
 */
export function legendWorldRecords(l: Legend, legends: Legend[] = REAL_LEGENDS): LegendWorldRecord[] {
  const out = new Map<RecordMetric, LegendWorldRecord>()
  for (const ref of historicRefs(legends)) if (ref.holderIds?.includes(l.id)) out.set(ref.metric, { metric: ref.metric, label: RECORD_METRICS[ref.metric].label, current: true })
  for (const m of l.pastRecords ?? []) if (!out.has(m)) out.set(m, { metric: m, label: RECORD_METRICS[m].label, current: false })
  return [...out.values()]
}

