/**
 * Ligas: temporada completa (ou continuação da tabela real na 1ª temporada), Apertura/Clausura,
 * play-offs (MLS, Liga MX, Argentina…), acesso/rebaixamento entre divisões ligadas.
 */
import type { KnockoutStage, League, LeagueSeasonResult, StandingRow } from '../types'
import { rng as subRng, type Rng } from '../rng'
import { play, type SeasonCtx } from './context'
import { playTie, runKnockout } from './knockout'
import { remainingSchedule, seasonSchedule, type Pairing } from './schedule'
import { addResult, newRow, sortTable, sumTables } from './table'

/** LeagueSeasonResult + campeões de cada torneio (Apertura/Clausura). */
export interface LeagueRun {
  result: LeagueSeasonResult
  /** Ordem para vagas continentais: campeões dos torneios primeiro, depois a tabela (anual). */
  ranking: string[]
}

/** Zonas/conferências reais (Argentina, MLS) a partir do snapshot; novos clubes vão para o menor grupo. */
export function leagueGroups(ctx: SeasonCtx, leagueId: string, clubs: readonly string[]): Map<string, string> | undefined {
  const rows = ctx.data.standings[leagueId] ?? []
  const count = new Map<string, number>()
  for (const r of rows) if (r.group) count.set(r.group, (count.get(r.group) ?? 0) + 1)
  if (count.size < 2 || [...count.values()].some((n) => n < 4)) return undefined
  const map = new Map<string, string>()
  const size = new Map<string, number>([...count.keys()].map((g) => [g, 0]))
  const inLeague = new Set(clubs)
  for (const r of rows) {
    if (r.group && inLeague.has(r.clubId)) {
      map.set(r.clubId, r.group)
      size.set(r.group, size.get(r.group)! + 1)
    }
  }
  for (const c of clubs) {
    if (map.has(c)) continue
    const g = [...size.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))[0][0]
    map.set(c, g)
    size.set(g, size.get(g)! + 1)
  }
  return map
}

/** Qual torneio está em andamento no snapshot (0 = Apertura, 1 = Clausura). */
export function currentTournament(ctx: SeasonCtx, league: League): 0 | 1 {
  const phase = ctx.data.snapshot?.[league.id]?.phase ?? ''
  if (/clausura|finaliza|segund|second|2º|\bii\b/i.test(phase)) return 1
  if (/apertura|primer|first|1º/i.test(phase)) return 0
  return league.calendar === 'calendar' ? 1 : 0
}

export function tournamentNames(league: League, season: number): [string, string] {
  const second = league.country === 'COL' ? 'Finalización' : 'Clausura'
  if (league.calendar === 'split') return [`Apertura ${season}`, `${second} ${season + 1}`]
  return [`Apertura ${season}`, `${second} ${season}`]
}

const TWO_LEG_PLAYOFFS = new Set(['MEX', 'CRC', 'HON', 'GUA', 'SLV', 'COL', 'ECU', 'PAR', 'VEN', 'PAN', 'BOL', 'PER', 'CHI', 'URU'])
const SEED_ADVANCES = new Set(['MEX', 'CRC', 'HON', 'GUA', 'SLV', 'PAN'])

/** Play-offs de liga (MLS, Liguilla, Argentina…): retorna o campeão e as fases guardadas. */
export function leaguePlayoffs(
  ctx: SeasonCtx,
  rng: Rng,
  league: League,
  sorted: StandingRow[],
  label = '',
): { champion: string; stages: KnockoutStage[] } {
  const P = Math.min(league.format.playoffTeams, sorted.length)
  if (P < 2) return { champion: sorted[0]?.clubId ?? '', stages: [] }
  const groups = [...new Set(sorted.map((r) => r.group).filter((g): g is string => !!g))]
  let seeds: string[]
  if (groups.length >= 2) {
    const per = Math.floor(P / groups.length)
    const byGroup = groups.map((g) => sorted.filter((r) => r.group === g))
    byGroup.sort((a, b) => b[0].points - a[0].points)
    seeds = []
    for (let r = 0; r < per; r++) for (const g of byGroup) if (g[r]) seeds.push(g[r].clubId)
    for (const row of sorted) {
      if (seeds.length >= P) break
      if (!seeds.includes(row.clubId)) seeds.push(row.clubId)
    }
  } else seeds = sorted.slice(0, P).map((r) => r.clubId)

  const twoLegs = TWO_LEG_PLAYOFFS.has(league.country)
  const kind = 'league' as const
  const stages: KnockoutStage[] = []
  let K = 1
  while (K * 2 <= seeds.length) K *= 2
  const excess = seeds.length - K
  if (excess > 0) {
    // play-in: os 2×excesso últimos se enfrentam (melhor campanha em casa)
    const direct = seeds.slice(0, K - excess)
    const pool = seeds.slice(K - excess)
    const winners: string[] = []
    const stage: KnockoutStage = { name: `${label}Play-in`, ties: [] }
    for (let i = 0; i < pool.length / 2; i++) {
      const a = pool[i]
      const b = pool[pool.length - 1 - i]
      const r = playTie(ctx, rng, kind, { a, b, legs: 1, extraTime: true, seedAdvancesOnDraw: SEED_ADVANCES.has(league.country) })
      winners.push(r.winner)
      if (ctx.userClub && (a === ctx.userClub || b === ctx.userClub)) stage.ties.push({ a, b, legs: r.legs, winner: r.winner })
    }
    if (stage.ties.length) stages.push(stage)
    seeds = [...direct, ...winners]
  }
  const ko = runKnockout(ctx, rng, seeds, {
    kind,
    legs: () => (twoLegs ? 2 : 1),
    neutral: (size) => size === 2 && league.country === 'ARG',
    extraTime: true,
    mode: 'bracket',
    keepFrom: 2,
    seedAdvancesOnDraw: SEED_ADVANCES.has(league.country),
    prefix: label,
  })
  return { champion: ko.winner, stages: [...stages, ...ko.stages] }
}

/** Jogos reais já disputados entram nas estatísticas da temporada (sem-sofrer-gol estimado por Poisson). */
function seedRealStats(ctx: SeasonCtx, r: StandingRow) {
  if (r.played <= 0) return
  const cs = Math.round(r.played * Math.exp(-r.ga / r.played))
  const cur = ctx.cs.get(r.clubId)
  if (cur) (cur[0] += r.played), (cur[1] += r.gf), (cur[2] += r.ga), (cur[3] += cs)
  else ctx.cs.set(r.clubId, [r.played, r.gf, r.ga, cs])
}

function playMatches(ctx: SeasonCtx, rng: Rng, rows: Map<string, StandingRow>, pairs: Pairing[]) {
  for (const [h, a] of pairs) {
    const rh = rows.get(h)
    const ra = rows.get(a)
    if (!rh || !ra) continue
    const m = play(ctx, rng, h, a, { kind: 'league' })
    addResult(rh, ra, m.score[0], m.score[1])
  }
}

/** Simula a temporada de uma liga. `clubs` = participantes nesta temporada. */
export function simulateLeague(ctx: SeasonCtx, league: League, clubs: readonly string[]): LeagueRun {
  const rng = subRng(ctx.seed, 'season', ctx.season, 'league', league.id)
  const snap = ctx.data.snapshot?.[league.id]
  const groups = leagueGroups(ctx, league.id, clubs)
  const tournaments = league.tournamentsPerSeason ?? 1
  const rounds = league.format.rounds
  const defaultGames = groups
    ? Math.max(...[...new Set(groups.values())].map((g) => [...groups.values()].filter((x) => x === g).length)) - 1
    : clubs.length - 1
  let target = snap?.gamesPerTeam && snap.gamesPerTeam > 0 ? snap.gamesPerTeam : defaultGames * rounds
  // calendário incompleto com jogos adiados duplicados (ex.: 39 no Brasileirão): limita a um turno completo
  if (snap && !snap.fixturesComplete && !groups && tournaments === 1) target = Math.min(target, (clubs.length - 1) * rounds)

  const realRows = (ctx.data.standings[league.id] ?? []).filter((r) => clubs.includes(r.clubId))
  const stale = !!(league.stale || snap?.stale) || (snap?.season !== undefined && snap.season !== ctx.season)
  const canContinue = ctx.first && !stale && realRows.some((r) => r.played > 0)
  const current = tournaments === 2 ? currentTournament(ctx, league) : 0
  const names = tournaments === 2 ? tournamentNames(league, ctx.season) : ['', '']

  const tables: StandingRow[][] = []
  const champions: { name: string; clubId: string }[] = []
  const playoffs: KnockoutStage[] = []

  for (let t = 0; t < tournaments; t++) {
    if (canContinue && t < current) {
      // torneio já encerrado antes do snapshot: campeão real (se houver no histórico)
      const past = (ctx.data.history?.champions?.[league.id] ?? []).filter((c) => c.season === ctx.season)
      if (past[0] && ctx.ix.club.has(past[0].winner)) champions.push({ name: names[t], clubId: past[0].winner })
      continue
    }
    const rows = new Map<string, StandingRow>()
    for (const c of clubs) rows.set(c, newRow(c, groups?.get(c)))
    let pairs: Pairing[]
    if (canContinue && t === current) {
      for (const r of realRows) {
        rows.set(r.clubId, { ...r, group: groups?.get(r.clubId) ?? r.group })
        seedRealStats(ctx, r)
      }
      pairs = remainingSchedule([...rows.values()], ctx.data.fixtures?.[league.id], target, rng, snap?.fixturesComplete)
    } else {
      pairs = seasonSchedule(clubs, rounds, rng, target, groups)
    }
    playMatches(ctx, rng, rows, pairs)
    for (const r of rows.values()) if (!groups) delete r.group
    const sorted = sortTable([...rows.values()])
    tables.push(sorted)
    if (league.format.playoffTeams >= 2) {
      const po = leaguePlayoffs(ctx, rng, league, sorted, tournaments === 2 ? `${names[t]} — ` : '')
      champions.push({ name: names[t], clubId: po.champion })
      playoffs.push(...po.stages)
    } else champions.push({ name: names[t], clubId: sorted[0]?.clubId ?? '' })
  }

  const table = tables.length === 1 ? tables[0] : sumTables(tables)
  const last = champions[champions.length - 1]
  const result: LeagueSeasonResult = {
    leagueId: league.id,
    season: ctx.season,
    table,
    champion: last?.clubId ?? table[0]?.clubId ?? '',
    promoted: [],
    relegated: [],
    topScorers: [],
  }
  if (tournaments === 2) result.champions = champions
  if (playoffs.length) result.playoffs = playoffs
  const ranking: string[] = []
  for (const c of champions) if (c.clubId && !ranking.includes(c.clubId)) ranking.push(c.clubId)
  // em ligas com play-off o campeão do mata-mata tem prioridade, o resto segue a tabela
  for (const r of table) if (!ranking.includes(r.clubId)) ranking.push(r.clubId)
  return { result, ranking }
}

/**
 * Acesso/rebaixamento entre `upper` e `lower` (lower.upperLeagueId === upper.id).
 * Troca n = min(lower.promotion, upper.relegation) clubes; play-off opcional da liga de baixo,
 * com ou sem o clube da liga de cima (`upperPosition`).
 */
export function promotionExchange(
  ctx: SeasonCtx,
  upper: League,
  lower: League,
  upperTable: StandingRow[],
  lowerTable: StandingRow[],
): { up: string[]; down: string[]; playoff: KnockoutStage[] } {
  const n = Math.min(lower.promotion, upper.relegation, Math.floor(lowerTable.length / 2), Math.floor(upperTable.length / 2))
  if (n <= 0) return { up: [], down: [], playoff: [] }
  const pp = lower.promotionPlayoff
  const spots = pp ? Math.min(pp.spots, n) : 0
  const upperSeat =
    pp?.upperPosition && spots > 0 && pp.upperPosition <= upperTable.length ? upperTable[pp.upperPosition - 1].clubId : null
  const directUp = n - spots
  const directDown = n - (upperSeat ? spots : 0)
  const up = lowerTable.slice(0, directUp).map((r) => r.clubId)
  const down = upperTable.slice(upperTable.length - directDown).map((r) => r.clubId)
  const playoff: KnockoutStage[] = []
  if (spots > 0 && pp) {
    const from = Math.max(pp.positions[0], 1) - 1
    const to = Math.min(pp.positions[1], lowerTable.length)
    const pool = lowerTable
      .slice(from, to)
      .map((r) => r.clubId)
      .filter((c) => !up.includes(c))
    const seeds = upperSeat && !down.includes(upperSeat) ? [upperSeat, ...pool] : pool
    if (seeds.length >= 2) {
      const rng = subRng(ctx.seed, 'season', ctx.season, 'promotion', lower.id)
      const ko = runKnockout(ctx, rng, seeds, {
        kind: 'league',
        // semifinais em ida e volta; final única em Wembley no caso inglês
        legs: (size) => (size === 2 && lower.country === 'ENG' ? 1 : 2),
        neutral: (size) => size === 2 && lower.country === 'ENG',
        extraTime: true,
        mode: 'bracket',
        keepFrom: 2,
        stopAt: spots,
        prefix: 'Play-off de acesso — ',
      })
      for (const w of ko.survivors) if (w !== upperSeat) up.push(w)
      if (upperSeat && !ko.survivors.includes(upperSeat)) down.push(upperSeat)
      playoff.push(...ko.stages)
    } else if (seeds.length === 1 && seeds[0] !== upperSeat) up.push(seeds[0])
  }
  // mantém os tamanhos das ligas: mesmo número sobe e desce
  const k = Math.min(up.length, down.length)
  return { up: up.slice(0, k), down: down.slice(down.length - k), playoff }
}
