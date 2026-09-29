/**
 * Calendário da temporada no Modo Imersivo.
 *
 * Cada partida da agenda (pré-simulação do mundo) ganha uma SEMANA por gabarito, independente das
 * outras partidas — assim, ao pré-simular de novo (copa que mudou de rumo), os jogos já disputados
 * não mudam de lugar:
 *   - calendário europeu ("split", ago–mai): semana 0 = pré-temporada (julho), liga nos fins de
 *     semana 1–42, copas e continentais no meio de semana, datas FIFA 6/11/16/33, janelas 0 e 23,
 *     Intercontinental em dezembro, bloco de torneios (Copa, Euro, Mundial de Clubes) de junho em diante;
 *   - ano civil ("calendar", jan–dez): estaduais nas semanas 1–15, liga 16–50 (6–48 sem estadual),
 *     datas FIFA 11/23/36/41/46, janelas 0 e 27, Intercontinental em dezembro, torneios no fim.
 * Ordem dentro da semana (`order`): 0 janela · 5 convocação · 10 treino · 20 evento · 30–69 jogos de
 * meio de semana (40 copa, 41 copa secundária, 43 supercopa, 44 play-off de liga, 45/46/47
 * continentais, 48 Intercontinental, 50 rodada extra) · 60/80 seleção · 70 liga. Coletiva: ordem do
 * jogo − 0,5 (nunca colide com outra partida).
 *
 * Mata-mata: só a fase ATUAL de cada copa aparece (sem spoiler da pré-simulação); a próxima fase é
 * revelada quando o mundo é pré-simulado de novo ao fim da fase. Fase revelada cuja semana do
 * gabarito já passou (ou que cairia antes da fase anterior) vai para a semana seguinte ao ponto atual
 * e a posição fica gravada (`m.slots`), estável nas próximas pré-simulações.
 * Liga: ordem natural das rodadas — com `immersiveRules` o mundo gera o turno pelo método do círculo
 * balanceado (mando alternado, ≤ 2 quebras por turno) e o Clausura espelha o Apertura. Rodadas duplas
 * (liga maior que as semanas livres) vão de preferência para semanas sem copa/continental.
 * Intercontinental/Mundial de Clubes que dependem do título continental da própria temporada só
 * aparecem quando a campanha continental do clube termina.
 */
import type { CompetitionKind, GameData, UserLeagueLog } from '../types'
import { rng as subRng } from '../rng'
import { stageDepth } from '../world/knockout'
import type { CalendarItem, ImmersiveState } from './types'
import { mem, type Fx, type ImmersiveMemory } from './mem'
import { clubLeagueId, clubOf, compOf, countryOf, leagueById } from './util'

export type CalKind = 'split' | 'calendar'

export const FIFA_WEEKS: Record<CalKind, number[]> = { split: [6, 11, 16, 33], calendar: [11, 23, 36, 41, 46] }
export const WINDOW_WEEKS: Record<CalKind, number[]> = { split: [0, 23], calendar: [0, 27] }
/** Semana do bloco de torneios de fim de temporada e do encerramento. */
export const TOURNAMENT_WEEK: Record<CalKind, number> = { split: 45, calendar: 52 }
export const END_WEEK = 62

const CUP_WEEKS: Record<CalKind, Record<string, number>> = {
  split: {
    'Fase preliminar': 2,
    '128 avos de final': 2,
    '64 avos de final': 3,
    '32 avos de final': 9,
    '16 avos de final': 14,
    'Oitavas de final': 22,
    'Quartas de final': 29,
    Semifinal: 36,
    Final: 43,
  },
  calendar: {
    'Fase preliminar': 3,
    '128 avos de final': 3,
    '64 avos de final': 5,
    '32 avos de final': 8,
    '16 avos de final': 17,
    'Oitavas de final': 27,
    'Quartas de final': 32,
    Semifinal: 38,
    Final: 44,
  },
}
const SECONDARY_CUP_WEEKS: Record<string, number> = {
  'Fase preliminar': 1,
  '64 avos de final': 2,
  '32 avos de final': 4,
  '16 avos de final': 8,
  'Oitavas de final': 13,
  'Quartas de final': 18,
  Semifinal: 24,
  Final: 30,
}
const CONT_WEEKS: Record<CalKind, { prelim: number; groups: number[]; ko: Record<string, number> }> = {
  split: {
    prelim: 1,
    groups: [3, 5, 9, 13, 15, 19, 24, 26],
    ko: { 'Play-offs': 27, 'Oitavas de final': 30, 'Quartas de final': 34, Semifinal: 37, Final: 43 },
  },
  calendar: {
    prelim: 6,
    groups: [14, 16, 18, 20, 22, 25, 26, 28],
    ko: { 'Play-offs': 29, 'Oitavas de final': 31, 'Quartas de final': 34, Semifinal: 39, Final: 47 },
  },
}
const REGIONAL_KO: Record<string, number> = { 'Quartas de final': 11, Semifinal: 12, Final: 13 }

const SHORT_COMP: Record<string, string> = {
  'conmebol.libertadores': 'Libertadores',
  'conmebol.sudamericana': 'Sul-Americana',
  'conmebol.recopa': 'Recopa',
  'uefa.champions': 'Champions League',
  'uefa.europa': 'Liga Europa',
  'uefa.europa.conf': 'Conference League',
  'uefa.super_cup': 'Supercopa da UEFA',
  'fifa.cwc': 'Mundial de Clubes',
  'fifa.intercontinental_cup': 'Intercontinental',
  'bra.copa_do_brazil': 'Copa do Brasil',
  'fifa.world': 'Copa do Mundo',
  'conmebol.america': 'Copa América',
  'uefa.euro': 'Eurocopa',
}

export function shortComp(data: GameData, id: string | undefined): string {
  if (!id) return 'Amistoso'
  if (SHORT_COMP[id]) return SHORT_COMP[id]
  const l = leagueById(data, id)
  if (l) return l.shortName || l.name
  const c = compOf(data, id)
  if (c?.region) return c.name.replace('Campeonato ', '')
  return c?.name ?? id
}

// ───────────────────────── datas ─────────────────────────

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function addDays(year: number, month: number, day: number, n: number): { y: number; m: number; d: number } {
  let y = year
  let m = month
  let d = day + n
  for (;;) {
    const len = MONTH_DAYS[m - 1] + (m === 2 && y % 4 === 0 ? 1 : 0)
    if (d <= len) break
    d -= len
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return { y, m, d }
}

/** Mês/ano aproximados da semana. */
export function weekDate(kind: CalKind, season: number, week: number): { month?: number; year?: number } {
  if (kind === 'calendar') {
    if (week >= TOURNAMENT_WEEK.calendar) return {}
    const r = addDays(season, 1, 5, week * 7)
    return { month: r.m, year: r.y }
  }
  if (week > 52) return {}
  const r = addDays(season, 7, 20, week * 7)
  return { month: r.m, year: r.y }
}

/** Semana correspondente à data do snapshot (1ª temporada começa no meio). */
export function snapshotWeek(kind: CalKind, iso: string, season: number): number {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7))
  const d = Number(iso.slice(8, 10))
  if (!y || !m) return 0
  const dayOfYear = (yy: number, mm: number, dd: number) => {
    let n = dd
    for (let i = 1; i < mm; i++) n += MONTH_DAYS[i - 1] + (i === 2 && yy % 4 === 0 ? 1 : 0)
    return n
  }
  if (kind === 'calendar') {
    if (y !== season) return 0
    return Math.max(0, Math.floor((dayOfYear(y, m, d) - 5) / 7))
  }
  const start = dayOfYear(season, 7, 20)
  const doy = y === season ? dayOfYear(y, m, d) : y === season + 1 ? dayOfYear(y, m, d) + 365 : 0
  return Math.max(0, Math.floor((doy - start) / 7))
}

// ───────────────────────── liga: ordem das rodadas ─────────────────────────

/**
 * Reordenação das rodadas para exibição. Com `immersiveRules` o mundo já gera o mando alternado
 * (círculo balanceado), então a ordem natural é a melhor — mantida por compatibilidade (saves antigos
 * guardam `m.matchday`).
 */
export function matchdayOrder(_log: UserLeagueLog | undefined, _data: GameData): Record<number, number> | undefined {
  return undefined
}

export function matchdayOf(m: ImmersiveMemory, round: number | undefined): number {
  if (!round) return 0
  return m.matchday?.[round] ?? round
}

// ───────────────────────── importância ─────────────────────────

export function fixtureImportance(data: GameData, s: ImmersiveState, f: Fx, lastRound: number): number {
  const kind = f.kind
  const depth = stageDepth(f.stage)
  const comp = compOf(data, f.competitionId)
  const user = clubOf(data, f.userHome ? f.home : f.away)
  const opp = clubOf(data, f.opponent)
  const oppPrestige = opp ? (s.world.clubs[opp.id]?.prestige ?? opp.prestige) : 3
  if (kind === 'league') {
    if (f.stage !== 'Liga' && f.stage.includes(' — ')) return f.stage.endsWith('Final') ? 0.95 : 0.75
    if (f.stage === 'Play-in' || f.stage.startsWith('Play-off')) return 0.8
    let v = 0.35 + (oppPrestige >= 4 ? 0.15 : 0)
    if (user && opp && user.country === opp.country && user.prestige >= 3.5 && opp.prestige >= 3.5 && (!user.state || user.state === opp.state)) v = 0.8
    if (f.round && lastRound && f.round >= lastRound - 4) v += 0.1
    return Math.min(0.95, v)
  }
  if (comp?.region) return depth >= 9 ? 0.85 : depth >= 7 ? 0.6 : 0.3 + (oppPrestige >= 4 ? 0.2 : 0)
  if (comp?.superCup) return 0.75
  if (kind === 'world_cup' || kind === 'national_continental') return depth >= 9 ? 1 : depth >= 8 ? 0.92 : depth >= 5 ? 0.85 : 0.72
  if (kind === 'club_world_cup') return depth >= 9 ? 1 : depth >= 5 ? 0.85 : 0.72
  const base = kind === 'continental_primary' ? 0.62 : kind === 'continental_secondary' ? 0.52 : kind === 'continental_tertiary' ? 0.46 : 0.45
  if (depth >= 9) return kind === 'domestic_cup' ? 0.92 : 1
  if (depth >= 8) return Math.min(0.95, base + 0.25)
  if (depth >= 5) return Math.min(0.9, base + (depth - 4) * 0.05)
  return base
}

// ───────────────────────── semanas ─────────────────────────

interface Placed {
  week: number
  order: number
}

function avoidFifa(kind: CalKind, w: number): number {
  let x = w
  while (FIFA_WEEKS[kind].includes(x)) x++
  return x
}

function koIndex(stage: string): number {
  const d = stageDepth(stage)
  // grupo=3 → 0; 32 avos=4; 16 avos/play-off=5; oitavas=6; quartas=7; semi=8; final=9
  return d <= 3 ? 0 : d - 1
}

export interface CalendarBuild {
  items: CalendarItem[]
  lastClubWeek: number
}

const isRegularLeague = (f: Fx) => f.kind === 'league' && !!f.round && !f.leg

/** Semanas de meio de semana ocupadas por copa/continental no gabarito (independe da agenda: estável). */
function busyWeeks(kind: CalKind, secondaryCup: boolean): Set<number> {
  const out = new Set<number>()
  const add = (w: number) => out.add(avoidFifa(kind, w))
  for (const w of Object.values(CUP_WEEKS[kind])) (add(w), add(w + 2))
  if (secondaryCup && kind === 'split') for (const w of Object.values(SECONDARY_CUP_WEEKS)) (add(w), add(w + 2))
  const c = CONT_WEEKS[kind]
  add(c.prelim)
  add(c.prelim + 1)
  for (const w of c.groups) add(w)
  for (const w of Object.values(c.ko)) (add(w), add(w + 1))
  return out
}

/** Ordem (dentro da semana) de cada tipo de competição — distinta para não colidir. */
function compOrder(data: GameData, f: Fx, secondaryId: string | undefined): number {
  const comp = compOf(data, f.competitionId)
  if (comp?.superCup) return 43
  if (f.kind === 'continental_primary') return 45
  if (f.kind === 'continental_secondary') return 46
  if (f.kind === 'continental_tertiary') return 47
  if (f.kind === 'club_world_cup') return 48
  if (secondaryId && f.competitionId === secondaryId) return 41
  return 40
}

/**
 * Semana/ordem de cada partida da agenda pelo gabarito (sem ajuste à posição atual — ver
 * `adjustPlacements`).
 */
export function placeFixtures(data: GameData, s: ImmersiveState, fixtures: Fx[], national: Fx[]): Map<string, Placed> {
  const m = mem(s)
  const kind = m.calKind
  const out = new Map<string, Placed>()
  const clubLeague = m.league?.leagueId
  const league = leagueById(data, clubLeague)
  const secondaryId = league?.secondaryCupId
  const hasRegional = fixtures.some((f) => !!compOf(data, f.competitionId)?.region)
  const start = m.startWeek
  const first = start > 0
  const busy = busyWeeks(kind, !!secondaryId)

  // ── liga ──
  const lg = fixtures.filter(isRegularLeague)
  const [L0, L1] = kind === 'split' ? [1, 42] : hasRegional ? [16, 50] : [6, 48]
  const tournaments = league?.tournamentsPerSeason ?? 1
  const leagueEndByT: number[] = []
  const tNames = [...new Set(lg.map((f) => f.stage))]
  for (let t = 0; t < Math.max(1, tNames.length); t++) {
    const list = lg.filter((f) => (tNames.length ? f.stage === tNames[t] : true))
    if (!list.length) continue
    const mid = Math.floor((L0 + L1) / 2)
    const span = tournaments === 2 && tNames.length === 2 ? (t === 0 ? [L0, mid - 6] : [mid + 1, L1]) : [L0, L1]
    const lo = Math.max(span[0], first ? start + 1 : span[0])
    // semanas livres; se não couber (1ª temporada começando no meio do torneio), o torneio se estende
    // (até perto do próximo) para no máx. 2 rodadas por semana — e nunca mais de 3
    const hard = tournaments === 2 && tNames.length === 2 && t === 0 ? mid - 2 : kind === 'split' ? 44 : TOURNAMENT_WEEK.calendar - 1
    let endW = span[1]
    const avail: number[] = []
    const fill = () => {
      avail.length = 0
      for (let w = lo; w <= endW; w++) if (!FIFA_WEEKS[kind].includes(w)) avail.push(w)
    }
    fill()
    while (avail.length * 2 < list.length && endW < hard) (endW++, fill())
    while (avail.length * 3 < list.length && endW < END_WEEK) (endW++, fill())
    if (!avail.length) avail.push(lo)
    const ordered = list.slice().sort((a, b) => matchdayOf(m, a.round) - matchdayOf(m, b.round) || a.seq - b.seq)
    const n = ordered.length
    // capacidade por semana: 1 rodada; rodadas extras (liga maior que as semanas) vão de preferência
    // para semanas sem copa/continental no gabarito, espalhadas; no máx. 3 por semana
    const cap = new Map<number, number>(avail.map((w) => [w, 1]))
    let extra = Math.max(0, n - avail.length)
    const spread = (pool: number[], k: number) => (k >= pool.length ? pool.slice() : Array.from({ length: k }, (_, i) => pool[Math.floor(((i + 0.5) * pool.length) / k)]))
    for (let level = 1; extra > 0 && level < 3; level++) {
      const free = avail.filter((w) => !busy.has(w) && cap.get(w) === level)
      const taken = avail.filter((w) => busy.has(w) && cap.get(w) === level)
      for (const pool of [free, taken]) {
        const pick = spread(pool, Math.min(extra, pool.length))
        for (const w of pick) cap.set(w, level + 1)
        extra -= pick.length
        if (extra <= 0) break
      }
    }
    const byWeek = new Map<number, Fx[]>()
    let wi = 0
    for (const f of ordered) {
      while (wi < avail.length - 1 && (byWeek.get(avail[wi])?.length ?? 0) >= (cap.get(avail[wi]) ?? 1)) wi++
      const w = avail[wi]
      const l = byWeek.get(w)
      if (l) l.push(f)
      else byWeek.set(w, [f])
    }
    let end = lo
    for (const [w, l] of byWeek) {
      const orders = l.length === 1 ? [70] : l.length === 2 ? [50, 70] : [30, 50, 70, 75, 78].slice(0, l.length)
      l.forEach((f, i) => out.set(f.key, { week: w, order: orders[i] ?? 70 + i }))
      end = Math.max(end, w)
    }
    leagueEndByT[t] = end
  }
  // play-offs de liga e de acesso: logo depois do fim do torneio correspondente
  const po = fixtures.filter((f) => f.kind === 'league' && !isRegularLeague(f))
  const poDepth = (f: Fx) => (f.stage.includes('Play-in') ? 1 : stageDepth(f.stage.split(' — ').pop() ?? f.stage))
  for (const f of po) {
    const t = Math.max(0, tNames.findIndex((n) => f.stage.startsWith(n + ' — ')))
    const base = leagueEndByT[t] ?? L1
    const depths = [...new Set(po.filter((x) => Math.max(0, tNames.findIndex((n) => x.stage.startsWith(n + ' — '))) === t).map(poDepth))].sort((a, b) => a - b)
    const idx = Math.max(0, depths.indexOf(poDepth(f)))
    const w = avoidFifa(kind, base + 1 + idx * 2 + ((f.leg ?? 1) - 1))
    out.set(f.key, { week: w, order: (f.leg ?? 1) === 1 ? 44 : 70 })
  }

  // ── copas, continentais, estaduais ──
  const groupCounter = new Map<string, number>()
  const groupTotals = new Map<string, number>()
  for (const f of fixtures) {
    if (f.kind === 'league') continue
    const k = `${f.competitionId}|${f.stage}`
    groupTotals.set(k, (groupTotals.get(k) ?? 0) + 1)
  }
  const tb = TOURNAMENT_WEEK[kind]
  const hasCwc = fixtures.some((f) => f.kind === 'club_world_cup' && compOf(data, f.competitionId)?.schedule)
  for (const f of fixtures) {
    if (f.kind === 'league') continue
    const comp = compOf(data, f.competitionId)
    const k = `${f.competitionId}|${f.stage}`
    const gi = groupCounter.get(k) ?? 0
    groupCounter.set(k, gi + 1)
    const leg = f.leg ?? 1
    let w: number
    let order = compOrder(data, f, secondaryId)
    if (comp?.region) {
      const d = stageDepth(f.stage)
      if (d <= 3) {
        // fase de grupos do estadual: semanas 1–10; dois jogos na mesma semana → meio + fim de semana
        const total = groupTotals.get(k) ?? 1
        const wk = (i: number) => 1 + Math.floor((i * 10) / Math.max(1, total))
        w = wk(gi)
        const sameAsPrev = gi > 0 && wk(gi - 1) === w
        const sameAsNext = gi + 1 < total && wk(gi + 1) === w
        order = sameAsNext && !sameAsPrev ? 50 : 70
      } else {
        w = (REGIONAL_KO[f.stage] ?? 13) + (leg - 1)
        order = leg === 2 || f.stage === 'Final' ? 70 : 50
      }
    } else if (comp?.superCup) {
      w = kind === 'split' ? 1 : 4
    } else if (f.kind === 'club_world_cup' && !comp?.schedule) {
      // Intercontinental (dezembro), fases em escada
      const steps = ['Play-off Ásia-Pacífico', 'Copa África-Ásia-Pacífico', 'Dérbi das Américas', 'Copa Challenger', 'Final']
      const i = Math.max(0, steps.indexOf(f.stage))
      w = (kind === 'split' ? 18 : 47) + i
    } else if (f.kind === 'club_world_cup') {
      const idx = stageDepth(f.stage) <= 3 ? gi : koIndex(f.stage)
      w = tb + Math.floor(idx / 2)
      order = idx % 2 ? 80 : 60
    } else if (f.kind === 'continental_primary' || f.kind === 'continental_secondary' || f.kind === 'continental_tertiary') {
      const t = CONT_WEEKS[kind]
      if (f.stage === 'Fase preliminar') w = t.prelim + (leg - 1)
      else if (stageDepth(f.stage) <= 3) {
        const total = groupTotals.get(k) ?? 1
        const slots = t.groups
        const offset = first ? Math.max(0, slots.length - total) : 0
        w = slots[Math.min(slots.length - 1, gi + offset)] ?? slots[slots.length - 1]
      } else w = (t.ko[f.stage] ?? t.ko.Final) + (leg - 1)
    } else {
      // copas nacionais
      const secondary = secondaryId === f.competitionId
      const table = secondary && kind === 'split' ? SECONDARY_CUP_WEEKS : CUP_WEEKS[kind]
      w = (table[f.stage] ?? table.Final) + (leg - 1) * 2
    }
    w = avoidFifa(kind, w)
    if (first && w <= start) {
      // 1ª temporada: fases em andamento começam logo depois da data do snapshot (o ajuste de
      // congestionamento espalha as partidas pelas semanas seguintes)
      w = avoidFifa(kind, start + 1)
    }
    out.set(f.key, { week: w, order })
  }

  // ── seleção (torneio de fim de temporada) ──
  const natBase = tb + (hasCwc ? 5 : 0)
  const natCounter = new Map<string, number>()
  for (const f of national) {
    const k = `${f.competitionId}|${f.stage}`
    const gi = natCounter.get(k) ?? 0
    natCounter.set(k, gi + 1)
    const idx = stageDepth(f.stage) <= 3 ? gi : koIndex(f.stage)
    out.set(f.key, { week: natBase + Math.floor(idx / 2), order: idx % 2 ? 80 : 60 })
  }
  return out
}

/** Partidas por semana (futuras) — para espalhar copas/continentais. */
export type WeekLoad = Map<number, number>

/**
 * Ajuste à posição atual e ao congestionamento. Para cada partida VISÍVEL ainda não jogada (fora os
 * pontos corridos), em ordem dentro da competição:
 *   - fica depois da partida anterior da mesma competição (ida → volta com ≥ 1 semana) e depois de
 *     `minPos` (fase revelada por nova pré-simulação cuja semana do gabarito já passou);
 *   - evita semanas cheias: procura, a partir da semana do gabarito, uma semana com ≤ 1 jogo nas 3
 *     seguintes; senão a primeira com ≤ 2 (nunca mais de 3 jogos na semana);
 *   - a posição escolhida fica gravada em `m.slots` (estável nas próximas pré-simulações: o que já
 *     apareceu no calendário não muda de semana).
 * Partidas escondidas (fases futuras) não são posicionadas nem contam.
 */
export function adjustPlacements(s: ImmersiveState, fixtures: Fx[], placed: Map<string, Placed>, minPos: number, visible?: Set<string>, load?: WeekLoad): void {
  const m = mem(s)
  const kind = m.calKind
  const slots = (m.slots ??= {})
  const prevBy = new Map<string, number>()
  const cnt = load ?? new Map<number, number>()
  const free = (w: number, max: number) => (cnt.get(w) ?? 0) <= max
  const pickWeek = (w0: number): number => {
    for (let d = 0, w = w0; d <= 3; d++, w = avoidFifa(kind, w + 1)) if (free(w, 1)) return w
    let w = w0
    for (let g = 0; g < 40 && !free(w, 2); g++) w = avoidFifa(kind, w + 1)
    return w
  }
  const list = fixtures.filter((f) => !isRegularLeague(f)).sort((a, b) => a.seq - b.seq)
  for (const f of list) {
    const p = placed.get(f.key)
    if (!p) continue
    const prev = prevBy.get(f.competitionId) ?? -1
    let pos = slots[f.key] ?? p.week * 1000 + p.order
    if (m.fixed[f.key]) {
      placed.set(f.key, { week: Math.floor(pos / 1000), order: pos % 1000 })
      prevBy.set(f.competitionId, Math.max(prev, pos))
      continue
    }
    if (visible && !visible.has(f.key)) continue
    if (slots[f.key] === undefined) {
      let w = p.week
      const after = Math.max(minPos, prev)
      if (w * 1000 + p.order <= after) w = Math.floor(after / 1000) + 1
      w = pickWeek(avoidFifa(kind, w))
      pos = w * 1000 + p.order
      if (visible) slots[f.key] = pos
    }
    const wk = Math.floor(pos / 1000)
    placed.set(f.key, { week: wk, order: pos % 1000 })
    cnt.set(wk, (cnt.get(wk) ?? 0) + 1)
    prevBy.set(f.competitionId, Math.max(prev, pos))
  }
}

/** Fixtures visíveis: toda a liga e, em cada copa, só até a fase atual (a do 1º jogo não disputado). */
export function visibleFixtures(fixtures: Fx[], fixed: Record<string, unknown>): Fx[] {
  const byComp = new Map<string, Fx[]>()
  for (const f of fixtures) {
    const l = byComp.get(f.competitionId)
    if (l) l.push(f)
    else byComp.set(f.competitionId, [f])
  }
  const out: Fx[] = []
  for (const [, list] of byComp) {
    let currentStage: string | null = null
    for (const f of list) {
      if (isRegularLeague(f) || fixed[f.key]) {
        out.push(f)
        continue
      }
      if (currentStage === null) currentStage = f.stage
      if (f.stage === currentStage) out.push(f)
    }
  }
  return out
}

/**
 * Intercontinental (clube da CONMEBOL: campeão da Libertadores do mesmo ano) e Mundial de Clubes
 * (bloco de fim de temporada): enquanto a campanha continental do clube não termina, a vaga ainda
 * não está decidida — a partida prevista fica escondida.
 */
function awaitingQualification(data: GameData, s: ImmersiveState, f: Fx): boolean {
  if (f.kind !== 'club_world_cup') return false
  const m = mem(s)
  const confed = leagueById(data, clubLeagueId(s.world, data, s.clubId))?.confed
  if (!confed) return false
  const comp = compOf(data, f.competitionId)
  if (!comp?.schedule && confed !== 'CONMEBOL') return false
  const primary = data.competitions.find((c) => c.kind === 'continental_primary' && c.confed === confed)
  if (!primary) return false
  return m.agenda.some((x) => x.competitionId === primary.id && !m.fixed[x.key])
}

function stageLabel(f: Fx, m: ImmersiveMemory): string {
  if (isRegularLeague(f)) {
    const md = matchdayOf(m, f.round)
    return f.stage === 'Liga' ? `${md}ª rodada` : `${f.stage} · ${md}ª rodada`
  }
  let st = f.stage || 'Jogo'
  if (f.legs === 2) st += f.leg === 1 ? ' · ida' : ' · volta'
  return st
}

/** Semanas das janelas "procurando clube" (sem clube: uma a cada 4 semanas até o fim da liga). */
function freeAgentWeeks(kind: CalKind, from: number): number[] {
  const last = kind === 'split' ? 40 : 46
  const out: number[] = []
  for (let w = Math.max(0, from); w <= last; w += 4) out.push(w)
  return out.length ? out : [Math.max(0, from)]
}

/**
 * Monta o calendário inteiro da temporada (itens novos, nenhum concluído). `minPos` = posição atual
 * (semana·1000 + ordem): partidas ainda não jogadas vão para depois dela.
 */
export function buildCalendar(data: GameData, s: ImmersiveState, minPos = -1): CalendarItem[] {
  const m = mem(s)
  const season = s.season
  const kind = m.calKind
  const items: CalendarItem[] = []
  const club = clubOf(data, s.clubId)
  const date = (w: number) => weekDate(kind, season, w)
  const push = (it: Omit<CalendarItem, 'season' | 'done' | 'month' | 'year'>) => {
    const d = date(it.week)
    const full: CalendarItem = { ...it, season, done: false }
    if (d.month) full.month = d.month
    if (d.year) full.year = d.year
    items.push(full)
  }
  if (!club) {
    for (const w of freeAgentWeeks(kind, s.week)) push({ id: `w:${season}:${w}`, week: w, order: 0, kind: 'transfer_window', title: 'Mercado · procurando clube' })
    push({ id: `end:${season}`, week: END_WEEK, order: 0, kind: 'season_end', title: `Fim da temporada ${seasonLabel(data, s)}` })
    push({ id: `aw:${season}`, week: END_WEEK, order: 10, kind: 'awards', title: `Premiação da temporada ${seasonLabel(data, s)}` })
    return items
  }
  const nat = m.natTournament?.called ? m.natAgenda : []
  const vis = visibleFixtures(m.agenda, m.fixed).filter((f) => m.fixed[f.key] || !awaitingQualification(data, s, f))
  const natVis = visibleFixtures(nat, m.fixed)
  const placed = placeFixtures(data, s, m.agenda, nat)
  const visible = new Set([...vis, ...natVis].map((f) => f.key))
  const load: WeekLoad = new Map()
  for (const f of vis) {
    const p = placed.get(f.key)
    if (p && isRegularLeague(f) && !m.fixed[f.key] && p.week * 1000 + p.order > minPos) load.set(p.week, (load.get(p.week) ?? 0) + 1)
  }
  adjustPlacements(s, m.agenda, placed, minPos, visible, load)
  adjustPlacements(s, nat, placed, minPos, visible, load)
  const lastRound = m.league?.matches.length ? Math.max(...m.league.matches.map((x) => x[4])) : 0
  const start = m.startWeek
  let lastClubWeek = start
  const pressWeeks = new Set<number>()
  let lastPress = -10

  const matches: CalendarItem[] = []
  for (const f of [...vis, ...natVis]) {
    const p = placed.get(f.key)
    if (!p) continue
    const national = f.kind === 'world_cup' || f.kind === 'national_continental'
    const imp = fixtureImportance(data, s, f, lastRound)
    const it: CalendarItem = {
      id: `m:${season}:${f.key}`,
      season,
      week: p.week,
      order: p.order,
      kind: national ? 'national_match' : 'match',
      title: `${shortComp(data, f.competitionId)} · ${stageLabel(f, m)}`,
      competitionId: f.competitionId,
      fixtureKey: f.key,
      opponentId: f.opponent,
      home: f.userHome,
      stage: stageLabel(f, m),
      importance: Math.round(imp * 100) / 100,
      done: false,
    }
    if (f.legs && f.legs > 1) {
      it.leg = f.leg
      it.legs = f.legs
    }
    const d = date(p.week)
    if (d.month) it.month = d.month
    if (d.year) it.year = d.year
    matches.push(it)
    if (!national) lastClubWeek = Math.max(lastClubWeek, p.week)
  }
  matches.sort((a, b) => a.week - b.week || a.order - b.order)
  for (const it of matches) {
    items.push(it)
    // coletiva antes de jogo grande (no máx. 1 por semana) e uma de rotina a cada ~6 semanas
    const big = (it.importance ?? 0) >= 0.72
    const routine = it.kind === 'match' && it.week - lastPress >= 6 && (it.importance ?? 0) >= 0.35
    if ((big || routine) && !pressWeeks.has(it.week)) {
      pressWeeks.add(it.week)
      lastPress = it.week
      push({
        id: `p:${season}:${it.fixtureKey ?? it.week}`,
        week: it.week,
        order: it.order - 0.5,
        kind: 'press',
        title: `Coletiva · antes de ${it.title.split(' · ')[0]} contra ${teamLabel(data, it.opponentId)}`,
        opponentId: it.opponentId,
        competitionId: it.competitionId,
        importance: it.importance,
        fixtureKey: it.fixtureKey,
      })
    }
  }

  // ── pré-temporada e treinos ──
  const first = start > 0
  const trainFrom = first ? start : 0
  for (let w = trainFrom; w <= lastClubWeek; w++) {
    push({
      id: `t:${season}:${w}`,
      week: w,
      order: 10,
      kind: 'training',
      title: w === trainFrom ? (first ? 'Semana de apresentação' : 'Pré-temporada') : 'Treino da semana',
    })
  }
  // ── janelas ──
  for (const w of WINDOW_WEEKS[kind]) {
    if (w === 0 && first) continue
    if (w < trainFrom || w > lastClubWeek) continue
    push({ id: `w:${season}:${w}`, week: w, order: 0, kind: 'transfer_window', title: w === 0 ? 'Janela de transferências · pré-temporada' : 'Janela de transferências · meio da temporada' })
  }
  // ── datas FIFA ──
  const country = countryOf(data, s.identity.nationality)
  if (country && !m.nationalRetired) {
    for (const w of FIFA_WEEKS[kind]) {
      if (w <= trainFrom || w > lastClubWeek) continue
      push({ id: `c:${season}:${w}`, week: w, order: 5, kind: 'national_callup', title: `Convocação · ${country.name}` })
    }
    if (m.natAgenda.length) {
      const comp = compOf(data, m.natAgenda[0].competitionId)
      const tw = TOURNAMENT_WEEK[kind] + (m.agenda.some((f) => f.kind === 'club_world_cup' && compOf(data, f.competitionId)?.schedule) ? 5 : 0)
      push({ id: `ct:${season}`, week: tw, order: 5, kind: 'national_callup', title: `Convocação · ${comp?.name ?? 'torneio'} ${season + 1}`, competitionId: comp?.id })
    }
  }
  // ── eventos de bastidores (~4–6 semanas) ──
  const r = subRng(s.seed, 'imm', 'story-weeks', season)
  for (let w = trainFrom + r.int(3, 5); w <= lastClubWeek; w += r.int(4, 6)) {
    push({ id: `s:${season}:${w}`, week: w, order: 20, kind: 'story', title: 'Bastidores' })
  }
  push({ id: `end:${season}`, week: END_WEEK, order: 0, kind: 'season_end', title: `Fim da temporada ${seasonLabel(data, s)}` })
  push({ id: `aw:${season}`, week: END_WEEK, order: 10, kind: 'awards', title: `Premiação da temporada ${seasonLabel(data, s)}` })
  items.sort((a, b) => a.week - b.week || a.order - b.order || (a.id < b.id ? -1 : 1))
  return items
}

function teamLabel(data: GameData, id: string | undefined): string {
  if (!id) return 'o rival'
  const c = clubOf(data, id)
  return c ? c.shortName || c.name : (countryOf(data, id)?.name ?? id)
}

export function seasonLabel(data: GameData, s: ImmersiveState): string {
  return mem(s).calKind === 'split' ? `${s.season}/${String((s.season + 1) % 100).padStart(2, '0')}` : `${s.season}`
}

/**
 * Junta o calendário novo com o atual: itens concluídos ficam; itens novos ESTRITAMENTE antes da
 * posição atual (`pos` = semana·1000 + ordem) são descartados — os da mesma posição ainda por jogar
 * ficam (duas copas na mesma semana); convocações/amistosos inseridos ficam.
 */
export function mergeCalendar(old: CalendarItem[], fresh: CalendarItem[], pos: number): CalendarItem[] {
  const out: CalendarItem[] = []
  const oldById = new Map(old.map((it) => [it.id, it] as const))
  const freshIds = new Set(fresh.map((it) => it.id))
  for (const it of old) if (it.done) out.push(it)
  for (const it of fresh) {
    const o = oldById.get(it.id)
    if (o?.done) continue
    if (it.week * 1000 + it.order < pos) continue
    out.push(it)
  }
  // itens dinâmicos (amistosos da seleção) ainda por vir
  for (const it of old) if (!it.done && !freshIds.has(it.id) && it.id.startsWith('n:') && it.week * 1000 + it.order >= pos) out.push(it)
  out.sort((a, b) => a.week - b.week || a.order - b.order || (a.id < b.id ? -1 : 1))
  return out
}

export function kindIsNational(k: CompetitionKind): boolean {
  return k === 'world_cup' || k === 'national_continental'
}
