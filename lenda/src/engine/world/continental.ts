/**
 * Competições continentais de clubes, supercopas, Copa Intercontinental e Mundial de Clubes.
 *
 * Formatos (simplificados, mas com a cara real):
 *   UEFA (Champions, Liga Europa, Conference): fase de liga suíça de 36 (8/8/6 jogos) →
 *        9º–24º play-offs → oitavas → quartas → semi (ida e volta) → final única neutra.
 *   CONMEBOL (Libertadores, Sul-Americana): 8 grupos de 4 → oitavas/quartas/semi ida e volta
 *        (sem prorrogação) → final única neutra.
 *   CONCACAF: mata-mata de 16 em ida e volta, final única. AFC Elite: fase de liga de 24 → oitavas
 *        ida e volta → quartas/semi/final centralizadas. CAF: 4 grupos de 4 → quartas/semi/final
 *        ida e volta. OFC: 2 grupos → semi e final.
 * Excesso de classificados → fase preliminar (ida e volta); quem cai desce para o torneio de baixo.
 */
import type { CupInProgress } from '../api'
import type { Competition, CompetitionKind, Confed, CupResult, StandingRow } from '../types'
import { rng as subRng, type Rng } from '../rng'
import { CONFEDS, confedOfClub, play, type DataIndex, type SeasonCtx } from './context'
import { inProgress, presetFrom, reachedFromCompleted } from './cups'
import { drawGroups, forceInto, playTie, runGroups, runKnockout, runSwiss, stageName, type PresetTie } from './knockout'
import { fillPairings } from './schedule'
import { addResult, sortTable } from './table'

export type Level = 'primary' | 'secondary' | 'tertiary'
export const LEVELS: Level[] = ['primary', 'secondary', 'tertiary']

interface Format {
  type: 'groups' | 'swiss' | 'knockout'
  phaseSize: number
  groups?: number
  matches?: number
  /** Fases com até N clubes em jogo único (AFC centralizada). */
  singleFrom?: number
  finalLegs: 1 | 2
  extraTime: boolean
  neutralFinal: boolean
}

export function formatFor(confed: Confed, level: Level): Format {
  switch (confed) {
    case 'UEFA':
      return { type: 'swiss', phaseSize: 36, matches: level === 'tertiary' ? 6 : 8, finalLegs: 1, extraTime: true, neutralFinal: true }
    case 'CONMEBOL':
      return { type: 'groups', phaseSize: 32, groups: 8, finalLegs: 1, extraTime: false, neutralFinal: true }
    case 'CONCACAF':
      return { type: 'knockout', phaseSize: 16, finalLegs: 1, extraTime: true, neutralFinal: false }
    case 'AFC':
      return level === 'primary'
        ? { type: 'swiss', phaseSize: 24, matches: 8, singleFrom: 8, finalLegs: 1, extraTime: true, neutralFinal: true }
        : { type: 'groups', phaseSize: 32, groups: 8, finalLegs: 1, extraTime: true, neutralFinal: false }
    case 'CAF':
      return { type: 'groups', phaseSize: 16, groups: 4, finalLegs: 2, extraTime: false, neutralFinal: false }
    case 'OFC':
    default:
      return { type: 'groups', phaseSize: 8, groups: 2, singleFrom: 4, finalLegs: 1, extraTime: true, neutralFinal: true }
  }
}

/** O tamanho da competição no catálogo limita a fase principal (ex.: AFC Champions Two com 16). */
function capFormat(f: Format, comp: Competition): Format {
  if (!comp.size || comp.size < 4 || comp.size >= f.phaseSize) return f
  if (f.type === 'groups') {
    let g = f.groups ?? 8
    while (g > 1 && g * 4 > comp.size) g /= 2
    return { ...f, groups: g, phaseSize: g * 4 }
  }
  if (f.type === 'swiss') return { ...f, phaseSize: comp.size - (comp.size % 2) }
  return { ...f, phaseSize: prevPow2(comp.size) }
}

export function levelComp(ix: DataIndex, confed: Confed, level: Level): Competition | undefined {
  return ix.confed[confed][level]
}

// ───────────────────────── classificação ─────────────────────────

export interface QualifyInput {
  /** Ordem final por liga (campeões dos torneios primeiro). */
  rankings: Map<string, string[]>
  /** Vencedores de copas nacionais por competitionId. */
  cupWinners: Map<string, string>
  /** Campeões da temporada das competições continentais (competitionId → clube). */
  holders: Map<string, string>
  strength: (id: string) => number
}

/**
 * Classificados para a próxima edição de cada continental: detentores, vagas por liga
 * (League.continentalSlots / continentalTertiarySlots), campeões de copa e clubes extras por força.
 * Listas em ordem de prioridade (os últimos disputam a fase preliminar).
 */
export function qualifyAll(ix: DataIndex, data: { leagues: import('../types').League[] }, q: QualifyInput): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const confed of CONFEDS) {
    const P = levelComp(ix, confed, 'primary')
    if (!P) continue
    const S = levelComp(ix, confed, 'secondary')
    const T = levelComp(ix, confed, 'tertiary')
    const lists: Record<Level, { id: string; pr: number }[]> = { primary: [], secondary: [], tertiary: [] }
    const taken = new Set<string>()
    const add = (lv: Level, id: string | undefined, pr: number) => {
      if (!id || taken.has(id) || !ix.club.has(id)) return false
      const real = lv === 'tertiary' && !T ? (S ? 'secondary' : 'primary') : lv === 'secondary' && !S ? 'primary' : lv
      lists[real].push({ id, pr })
      taken.add(id)
      return true
    }
    add('primary', q.holders.get(P.id), 1000)
    if (S) add('primary', q.holders.get(S.id), 990)
    if (T) add('secondary', q.holders.get(T.id), 980)

    const leagues = data.leagues
      .filter((l) => l.confed === confed && q.rankings.has(l.id))
      .filter((l) => l.continentalSlots[0] + l.continentalSlots[1] + (l.continentalTertiarySlots ?? 0) > 0)
      .sort((a, b) => b.coefficient - a.coefficient)
    for (const l of leagues) {
      const rank = q.rankings.get(l.id)!
      let p = l.continentalSlots[0]
      let s = l.continentalSlots[1]
      let t = l.continentalTertiarySlots ?? 0
      if (!S) (p += s), (s = 0)
      if (!T) t = 0
      const base = l.coefficient * 100
      let pos = 0
      const mine: Record<Level, string[]> = { primary: [], secondary: [], tertiary: [] }
      for (const id of rank) {
        const lv: Level | null = p > 0 ? 'primary' : s > 0 ? 'secondary' : t > 0 ? 'tertiary' : null
        if (!lv) break
        if (add(lv, id, base - pos * 4)) {
          mine[lv].push(id)
          if (lv === 'primary') p--
          else if (lv === 'secondary') s--
          else t--
        }
        pos++
      }
      // campeão da copa nacional: Libertadores (CONMEBOL) ou torneio secundário (demais)
      const cupWinner = l.domesticCupId ? q.cupWinners.get(l.domesticCupId) : undefined
      if (cupWinner && !taken.has(cupWinner) && ix.club.has(cupWinner)) {
        const lv: Level = confed === 'CONMEBOL' || !S ? 'primary' : 'secondary'
        add(lv, cupWinner, base - 3)
        // o último da liga naquele nível desce um degrau para manter o número de vagas por país
        if (lv === 'secondary' && mine.secondary.length) {
          const bumped = mine.secondary[mine.secondary.length - 1]
          lists.secondary = lists.secondary.filter((x) => x.id !== bumped)
          taken.delete(bumped)
          if (T) add('tertiary', bumped, base - pos * 4)
        }
      }
      const leagueCup = l.secondaryCupId ? q.cupWinners.get(l.secondaryCupId) : undefined
      if (T && leagueCup && !taken.has(leagueCup) && ix.club.has(leagueCup)) {
        add('tertiary', leagueCup, base - 5)
        if (mine.tertiary.length) {
          const bumped = mine.tertiary[mine.tertiary.length - 1]
          lists.tertiary = lists.tertiary.filter((x) => x.id !== bumped)
          taken.delete(bumped)
        }
      }
    }
    // clubes de países sem liga simulada, por força
    const extras = [...ix.extraClubs]
      .filter((id) => !taken.has(id) && confedOfClub(ix, id) === confed)
      .sort((a, b) => q.strength(b) - q.strength(a) || (a < b ? -1 : 1))
    for (const id of extras) {
      for (const lv of LEVELS) {
        const comp = levelComp(ix, confed, lv)
        if (!comp) continue
        const cap = Math.ceil(formatFor(confed, lv).phaseSize * 1.25)
        if (lists[lv].length < cap) {
          add(lv, id, q.strength(id) - 30)
          break
        }
      }
    }
    for (const lv of LEVELS) {
      const comp = levelComp(ix, confed, lv)
      if (!comp) continue
      out[comp.id] = lists[lv].sort((a, b) => b.pr - a.pr).map((x) => x.id)
    }
  }
  return out
}

// ───────────────────────── disputa ─────────────────────────

function strengthOf(ctx: SeasonCtx) {
  return (id: string) => ctx.str.get(id) ?? 60
}

/** Completa com os melhores clubes da confederação ainda sem vaga. */
function fillEntrants(ctx: SeasonCtx, confed: Confed, list: string[], size: number, used: Set<string>): string[] {
  if (list.length >= size) return list
  const out = list.slice()
  const pool: string[] = []
  for (const [id] of ctx.str) {
    if (used.has(id) || out.includes(id)) continue
    if (confedOfClub(ctx.ix, id) !== confed) continue
    const lg = ctx.ix.league.get(ctx.leagueOf.get(id) ?? '')
    // só 1ª divisão com vagas continentais (ligas sem vaga — ex.: Rússia suspensa — ficam de fora)
    if (lg && (lg.tier !== 1 || lg.continentalSlots[0] + lg.continentalSlots[1] + (lg.continentalTertiarySlots ?? 0) === 0)) continue
    pool.push(id)
  }
  pool.sort((a, b) => (ctx.str.get(b) ?? 0) - (ctx.str.get(a) ?? 0) || (a < b ? -1 : 1))
  for (const id of pool) {
    if (out.length >= size) break
    out.push(id)
  }
  return out
}

export interface ContinentalRun {
  cup: CupResult
  /** Eliminados na fase preliminar (descem para o torneio de baixo). */
  dropped: string[]
}

function effectiveFormat(f: Format, n: number): Format {
  if (f.type === 'groups') {
    let g = f.groups ?? 8
    while (g > 1 && g * 4 > n) g /= 2
    if (g * 4 > n) return { ...f, type: 'knockout', phaseSize: prevPow2(n) }
    return { ...f, groups: g, phaseSize: g * 4 }
  }
  if (f.type === 'swiss') {
    if (n < 10) return { ...f, type: 'knockout', phaseSize: prevPow2(n) }
    const size = Math.min(f.phaseSize, n - (n % 2))
    return { ...f, phaseSize: size, matches: Math.min(f.matches ?? 8, size - 1) }
  }
  return { ...f, phaseSize: Math.min(f.phaseSize, prevPow2(n)) }
}

function nextPow2Local(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

function prevPow2(n: number): number {
  let p = 1
  while (p * 2 <= n) p *= 2
  return p
}

/** Mata-mata de uma continental a partir de `seeds` (ordem de cabeça de chave ou chave fixa). */
function knockoutPhase(
  ctx: SeasonCtx,
  rng: Rng,
  kind: CompetitionKind,
  f: Format,
  seeds: string[],
  mode: 'bracket' | 'fixed',
  preset?: PresetTie[],
) {
  return runKnockout(
    ctx,
    rng,
    seeds,
    {
      kind,
      legs: (size) => (size === 2 ? f.finalLegs : f.singleFrom && size <= f.singleFrom ? 1 : 2),
      neutral: (size) => (size === 2 ? f.neutralFinal && f.finalLegs === 1 : !!f.singleFrom && size <= f.singleFrom),
      extraTime: f.extraTime,
      mode,
      keepFrom: 8,
    },
    preset,
  )
}

/** Título forçado: o clube do jogador eliminado na fase de liga ocupa a última vaga do mata-mata. */
function forceRow(ctx: SeasonCtx, kind: CompetitionKind, table: StandingRow[]): StandingRow[] {
  const ids = table.map((r) => r.clubId)
  const cut = table.length >= 24 ? 23 : table.length >= 16 ? 15 : 7
  const forcedIds = forceInto(ctx, kind, ids, ids.slice(0, cut + 1), cut)
  if (forcedIds.length === cut + 1 && forcedIds[cut] !== ids[cut]) {
    const i = ids.indexOf(forcedIds[cut])
    const out = table.slice()
    const [row] = out.splice(i, 1)
    out.splice(cut, 0, row)
    return out
  }
  return table
}

/** Oitavas a partir dos grupos: 1º do grupo i × 2º do grupo i+1 (sem repetir grupo). */
function groupKnockoutSeeds(tables: { name: string; table: StandingRow[] }[]): string[] {
  const g = tables.length
  const out: string[] = []
  if (g === 1) return tables[0].table.slice(0, 2).map((r) => r.clubId)
  for (let i = 0; i < g; i++) {
    out.push(tables[i].table[0].clubId)
    out.push(tables[(i + 1) % g].table[1].clubId)
  }
  return out
}

/** Chave fixa das oitavas após a fase suíça (1–8 × vencedores dos play-offs 9–24). */
function swissKnockout(
  ctx: SeasonCtx,
  rng: Rng,
  kind: CompetitionKind,
  f: Format,
  table: StandingRow[],
  reached: Record<string, string>,
  stagesOut: CupResult['knockout'],
): { winner: string; runnerUp: string; reached: Record<string, string> } {
  const ids = table.map((r) => r.clubId)
  const groups = [...new Set(table.map((r) => r.group).filter(Boolean))]
  if (groups.length >= 2) {
    // regiões (AFC Leste/Oeste): 16/G por região, intercalados
    const per = Math.max(1, Math.floor(16 / groups.length))
    const seeds: string[] = []
    for (let r = 0; r < per; r++) for (const g of groups) {
      const row = table.filter((x) => x.group === g)[r]
      if (row) seeds.push(row.clubId)
    }
    for (const id of ids) if (!seeds.includes(id)) reached[id] = 'Fase de liga'
    const ko = knockoutPhase(ctx, rng, kind, f, seeds, 'bracket')
    stagesOut.push(...ko.stages)
    Object.assign(reached, ko.reached)
    return ko
  }
  const n = ids.length
  if (n >= 24) {
    for (const id of ids.slice(24)) reached[id] = 'Fase de liga'
    const winners: string[] = []
    const stage = { name: 'Play-offs', ties: [] as CupResult['knockout'][number]['ties'] }
    for (let i = 0; i < 8; i++) {
      const a = ids[8 + i]
      const b = ids[23 - i]
      const r = playTie(ctx, rng, kind, { a, b, legs: 2, extraTime: f.extraTime })
      reached[r.loser] = 'Play-offs'
      winners.push(r.winner)
      if (ctx.userClub && (a === ctx.userClub || b === ctx.userClub)) stage.ties.push({ a, b, legs: r.legs, winner: r.winner })
    }
    if (stage.ties.length) stagesOut.push(stage)
    const order = [0, 7, 3, 4, 1, 6, 2, 5]
    const seeds: string[] = []
    for (const j of order) seeds.push(ids[j], winners[7 - j])
    const ko = knockoutPhase(ctx, rng, kind, f, seeds, 'fixed')
    stagesOut.push(...ko.stages)
    Object.assign(reached, ko.reached)
    return ko
  }
  const k = n >= 16 ? 16 : n >= 8 ? 8 : 4
  for (const id of ids.slice(k)) reached[id] = 'Fase de liga'
  const ko = knockoutPhase(ctx, rng, kind, f, ids.slice(0, k), 'bracket')
  stagesOut.push(...ko.stages)
  Object.assign(reached, ko.reached)
  return ko
}

/** Continua grupos reais em andamento: completa os jogos que faltam dentro de cada grupo. */
function continueGroups(ctx: SeasonCtx, rng: Rng, kind: CompetitionKind, rows: StandingRow[], perTeam: number) {
  const byGroup = new Map<string, StandingRow[]>()
  for (const r of rows) {
    const g = r.group ?? 'Grupo A'
    const l = byGroup.get(g)
    if (l) l.push({ ...r, group: g })
    else byGroup.set(g, [{ ...r, group: g }])
  }
  const out: { name: string; table: StandingRow[] }[] = []
  for (const [name, list] of [...byGroup.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const map = new Map(list.map((r) => [r.clubId, r] as const))
    const need = new Map(list.map((r) => [r.clubId, Math.max(0, perTeam - r.played)] as const))
    for (const [h, a] of fillPairings(need, rng)) {
      const m = play(ctx, rng, h, a, { kind })
      addResult(map.get(m.home)!, map.get(m.away)!, m.score[0], m.score[1])
    }
    out.push({ name, table: sortTable(list) })
  }
  return out
}

/**
 * Disputa uma continental. `entrants` em ordem de prioridade (já classificados); na 1ª temporada
 * usa a edição real em andamento quando existir.
 */
export function simulateContinental(
  ctx: SeasonCtx,
  comp: Competition,
  confed: Confed,
  level: Level,
  entrants: string[],
  used: Set<string>,
): ContinentalRun | null {
  const rng = subRng(ctx.seed, 'season', ctx.season, 'continental', comp.id)
  const base = capFormat(formatFor(confed, level), comp)
  const kind = comp.kind
  const reached: Record<string, string> = {}
  const stages: CupResult['knockout'] = []
  let groupsOut: CupResult['groups']
  const dropped: string[] = []
  const cip = inProgress(ctx, comp.id)

  if (cip) {
    const r = continueFromSnapshot(ctx, rng, comp, confed, base, cip, reached, stages)
    if (r) {
      for (const id of Object.keys(reached)) used.add(id)
      return { cup: r, dropped }
    }
  }

  let list = entrants.filter((id) => ctx.ix.club.has(id) && !used.has(id))
  list = fillEntrants(ctx, confed, list, base.phaseSize, used)
  if (list.length < 2) return null
  const f = effectiveFormat(base, list.length)
  for (const id of list) used.add(id)
  // fase preliminar (ida e volta) para o excesso
  if (list.length > f.phaseSize) {
    if (list.length > 2 * f.phaseSize) list = list.slice(0, 2 * f.phaseSize)
    const excess = list.length - f.phaseSize
    const direct = list.slice(0, list.length - 2 * excess)
    const pool = list.slice(list.length - 2 * excess)
    const winners: string[] = []
    for (let i = 0; i < excess; i++) {
      const a = pool[i]
      const b = pool[pool.length - 1 - i]
      const r = playTie(ctx, rng, kind, { a, b, legs: 2, extraTime: f.extraTime })
      winners.push(r.winner)
      dropped.push(r.loser)
      reached[r.loser] = 'Fase preliminar'
      if (ctx.userClub && (a === ctx.userClub || b === ctx.userClub)) {
        stages.push({ name: 'Fase preliminar', ties: [{ a, b, legs: r.legs, winner: r.winner }] })
      }
    }
    list = [...direct, ...winners]
  }
  for (const id of dropped) used.delete(id)
  const str = strengthOf(ctx)
  let ko: { winner: string; runnerUp: string }
  if (f.type === 'groups') {
    const groups = drawGroups(rng, list, f.groups!, str)
    const tables = runGroups(ctx, rng, groups, { kind, rounds: 2 })
    groupsOut = tables
    for (const t of tables) for (const r of t.table.slice(2)) reached[r.clubId] = 'Fase de grupos'
    const seeds = forceInto(ctx, kind, list, groupKnockoutSeeds(tables), 1)
    const res = knockoutPhase(ctx, rng, kind, f, seeds, 'fixed')
    stages.push(...res.stages)
    Object.assign(reached, res.reached)
    ko = res
  } else if (f.type === 'swiss') {
    const table = forceRow(ctx, kind, runSwiss(ctx, rng, list, f.matches ?? 8, kind))
    groupsOut = [{ name: 'Fase de liga', table }]
    ko = swissKnockout(ctx, rng, kind, f, table, reached, stages)
  } else {
    const seeds = list.slice(0, f.phaseSize).sort((a, b) => str(b) - str(a))
    const res = knockoutPhase(ctx, rng, kind, f, seeds, 'bracket')
    stages.push(...res.stages)
    Object.assign(reached, res.reached)
    ko = res
  }
  const cup: CupResult = {
    competitionId: comp.id,
    season: ctx.season,
    winner: ko.winner,
    runnerUp: ko.runnerUp,
    knockout: stages,
    reached,
  }
  if (groupsOut) cup.groups = groupsOut
  return { cup, dropped }
}

/** Edição real em andamento (1ª temporada): fase de liga/grupos, mata-mata ou preliminar. */
function continueFromSnapshot(
  ctx: SeasonCtx,
  rng: Rng,
  comp: Competition,
  confed: Confed,
  base: Format,
  cip: CupInProgress,
  reached: Record<string, string>,
  stages: CupResult['knockout'],
): CupResult | null {
  const kind = comp.kind
  reachedFromCompleted(ctx, cip, reached, kind)
  const rows = (cip.table ?? []).filter((r) => ctx.ix.club.has(r.clubId))
  const alive = cip.alive.filter((id) => ctx.ix.club.has(id))
  const isPhase = /liga|grupo|league|group/i.test(cip.stage) && rows.length >= 4
  let groupsOut: CupResult['groups']
  let ko: { winner: string; runnerUp: string } | null = null
  if (isPhase) {
    const hasGroups = new Set(rows.map((r) => r.group).filter(Boolean)).size >= 2
    if (base.type === 'swiss' || !hasGroups) {
      const matches = base.matches ?? 8
      let table: StandingRow[]
      if (hasGroups) {
        const parts: StandingRow[] = []
        for (const g of [...new Set(rows.map((r) => r.group!))].sort()) {
          const gr = rows.filter((r) => r.group === g)
          parts.push(...runSwiss(ctx, rng, gr.map((r) => r.clubId), Math.min(matches, gr.length - 1), kind, gr).map((r) => ({ ...r, group: g })))
        }
        table = parts
      } else table = runSwiss(ctx, rng, rows.map((r) => r.clubId), matches, kind, rows, ctx.data.fixtures?.[comp.id])
      groupsOut = [{ name: 'Fase de liga', table }]
      const f = effectiveFormat(base, table.length)
      ko = swissKnockout(ctx, rng, kind, { ...f, type: 'swiss' }, table, reached, stages)
    } else {
      const tables = continueGroups(ctx, rng, kind, rows, 6)
      groupsOut = tables
      for (const t of tables) for (const r of t.table.slice(2)) reached[r.clubId] = 'Fase de grupos'
      const res = knockoutPhase(ctx, rng, kind, base, groupKnockoutSeeds(tables), 'fixed')
      stages.push(...res.stages)
      Object.assign(reached, res.reached)
      ko = res
    }
  } else if (alive.length >= 2 && !/prelim|qualif|eliminat/i.test(cip.stage)) {
    for (const r of rows) if (!alive.includes(r.clubId) && !reached[r.clubId]) reached[r.clubId] = base.type === 'swiss' ? 'Fase de liga' : 'Fase de grupos'
    const preset = presetFrom(ctx, cip, reached, stageName(nextPow2Local(alive.length)))
    const covers = preset.length * 2 === alive.length
    const seeds = covers ? preset.flatMap((p) => [p.a, p.b]) : alive.slice().sort((a, b) => (ctx.str.get(b) ?? 0) - (ctx.str.get(a) ?? 0))
    const res = knockoutPhase(ctx, rng, kind, base, seeds, covers ? 'fixed' : 'bracket', preset.length ? preset : undefined)
    stages.push(...res.stages)
    Object.assign(reached, res.reached)
    ko = res
  } else return null
  if (!ko) return null
  const cup: CupResult = {
    competitionId: comp.id,
    season: ctx.season,
    winner: ko.winner,
    runnerUp: ko.runnerUp,
    knockout: stages,
    reached,
  }
  if (groupsOut) cup.groups = groupsOut
  return cup
}

// ───────────────────────── supercopas, Intercontinental, Mundial ─────────────────────────

export function singleFinal(ctx: SeasonCtx, comp: Competition, a: string, b: string, name = 'Final'): CupResult {
  const rng = subRng(ctx.seed, 'season', ctx.season, 'final', comp.id)
  const r = playTie(ctx, rng, comp.kind, { a, b, legs: 1, neutral: true, extraTime: true, isFinal: true })
  return {
    competitionId: comp.id,
    season: ctx.season,
    winner: r.winner,
    runnerUp: r.loser,
    knockout: [{ name, ties: [{ a, b, legs: r.legs, winner: r.winner }] }],
    reached: { [r.winner]: 'Campeão', [r.loser]: name },
  }
}

/**
 * Copa Intercontinental (dezembro): campeões continentais em escada —
 * OFC × AFC → × CAF (Copa África-Ásia-Pacífico); CONCACAF × CONMEBOL (Dérbi das Américas);
 * Copa Challenger entre os dois; final contra o campeão europeu.
 */
export function intercontinental(ctx: SeasonCtx, comp: Competition, champs: Partial<Record<Confed, string>>): CupResult | null {
  const rng = subRng(ctx.seed, 'season', ctx.season, 'intercontinental', comp.id)
  const reached: Record<string, string> = {}
  const stages: CupResult['knockout'] = []
  const match = (a: string | undefined, b: string | undefined, name: string): string | undefined => {
    if (!a) return b
    if (!b) return a
    const r = playTie(ctx, rng, comp.kind, { a, b, legs: 1, neutral: true, extraTime: true, isFinal: name === 'Final' })
    reached[r.loser] = name
    stages.push({ name, ties: [{ a, b, legs: r.legs, winner: r.winner }] })
    return r.winner
  }
  const ids = Object.values(champs).filter((x): x is string => !!x)
  if (ids.length < 2) return null
  const w1 = match(champs.AFC, champs.OFC, 'Play-off Ásia-Pacífico')
  const w2 = match(champs.CAF, w1, 'Copa África-Ásia-Pacífico')
  const w3 = match(champs.CONMEBOL, champs.CONCACAF, 'Dérbi das Américas')
  const w4 = match(w3, w2, 'Copa Challenger')
  const winner = match(champs.UEFA, w4, 'Final')!
  reached[winner] = 'Campeão'
  const final = stages[stages.length - 1]
  const runnerUp = final ? (final.ties[0].a === winner ? final.ties[0].b : final.ties[0].a) : ''
  return { competitionId: comp.id, season: ctx.season, winner, runnerUp, knockout: stages, reached }
}

export const CWC_QUOTAS: Record<Confed, number> = { UEFA: 12, CONMEBOL: 6, AFC: 4, CAF: 4, CONCACAF: 4, OFC: 1 }

/**
 * Mundial de Clubes (32): campeões continentais dos últimos 4 anos + ranking por força
 * (máx. 2 por país, salvo campeões) + 1 clube do país-sede. 8 grupos de 4 → oitavas (jogo único).
 */
export function clubWorldCup(
  ctx: SeasonCtx,
  comp: Competition,
  champions: Record<Confed, string[]>,
  hostCountry: string | undefined,
): CupResult | null {
  const rng = subRng(ctx.seed, 'season', ctx.season, 'cwc', comp.id)
  const chosen: string[] = []
  const perCountry = new Map<string, number>()
  const add = (id: string, cap: boolean) => {
    if (chosen.includes(id) || !ctx.ix.club.has(id)) return false
    const c = ctx.ix.club.get(id)!.country
    if (cap && (perCountry.get(c) ?? 0) >= 2) return false
    chosen.push(id)
    perCountry.set(c, (perCountry.get(c) ?? 0) + 1)
    return true
  }
  const byStrength = [...ctx.str.keys()].sort((a, b) => (ctx.str.get(b) ?? 0) - (ctx.str.get(a) ?? 0) || (a < b ? -1 : 1))
  let spare = 0
  for (const cf of CONFEDS) {
    const quota = CWC_QUOTAS[cf]
    let got = 0
    for (const id of champions[cf] ?? []) if (got < quota && add(id, false)) got++
    for (const id of byStrength) {
      if (got >= quota) break
      if (confedOfClub(ctx.ix, id) !== cf) continue
      const lg = ctx.ix.league.get(ctx.leagueOf.get(id) ?? '')
      if (lg && lg.tier !== 1) continue
      if (add(id, true)) got++
    }
    spare += quota - got
  }
  if (hostCountry) {
    const host = byStrength.find((id) => ctx.ix.club.get(id)?.country === hostCountry && !chosen.includes(id))
    if (host) add(host, false)
    else spare++
  } else spare++
  for (const id of byStrength) {
    if (spare <= 0 || chosen.length >= 32) break
    if (add(id, true)) spare--
  }
  if (chosen.length < 8) return null
  const size = chosen.length >= 32 ? 32 : chosen.length >= 16 ? 16 : 8
  const teams = chosen.slice(0, size)
  const groups = drawGroups(rng, teams, size / 4, (id) => ctx.str.get(id) ?? 60)
  const tables = runGroups(ctx, rng, groups, { kind: comp.kind, rounds: 1, neutral: true })
  const reached: Record<string, string> = {}
  for (const t of tables) for (const r of t.table.slice(2)) reached[r.clubId] = 'Fase de grupos'
  const seeds = forceInto(ctx, comp.kind, teams, groupKnockoutSeeds(tables), 1)
  const ko = runKnockout(ctx, rng, seeds, {
    kind: comp.kind,
    legs: () => 1,
    neutral: () => true,
    extraTime: true,
    mode: 'fixed',
    keepFrom: 16,
  })
  Object.assign(reached, ko.reached)
  return {
    competitionId: comp.id,
    season: ctx.season,
    winner: ko.winner,
    runnerUp: ko.runnerUp,
    groups: tables,
    knockout: ko.stages,
    reached,
  }
}

export { stageName }
