/**
 * Motor do MUNDO do LENDA (implementa WorldEngine).
 *
 * simulateSeason(S):
 *   1. entressafra dos rivais (S > 1ª temporada): envelhecer, aposentar, transferir, nova geração
 *   2. forças efetivas: força do clube + forma N(0; 2) + reforço do jogador (só nesta temporada)
 *   3. ligas (1ª temporada continua da tabela real) → acesso/rebaixamento (com play-offs)
 *   4. copas nacionais e estaduais → supercopas → continentais (1ª temporada: edições reais em
 *      andamento) → Intercontinental → Mundial de Clubes (anos de edição)
 *   5. torneios de seleções que terminam nesta temporada + jogos de seleções
 *   6. estatísticas dos rivais, artilharia por liga, classificados para S+1, evolução de forças
 *   7. compacta a temporada S−4 (ver compact.ts)
 */
import type { UserSeasonContext, WorldEngine } from '../api'
import type {
  ClubDynamic,
  CompetitionKind,
  Confed,
  CupResult,
  GameData,
  LeagueSeasonResult,
  NationalTournamentResult,
  SeasonWorldResult,
  WorldState,
} from '../types'
import { clamp, rng as subRng } from '../rng'
import { computeAwards } from './awards'
import { COMPACT_AFTER, compactSeason } from './compact'
import {
  CONFEDS,
  FORM_SD,
  confedOfClub,
  indexData,
  type DataIndex,
  type SeasonCtx,
} from './context'
import {
  LEVELS,
  clubWorldCup,
  intercontinental,
  levelComp,
  qualifyAll,
  simulateContinental,
  singleFinal,
} from './continental'
import { inProgress, simulateDomesticCup, simulateRegionalCup } from './cups'
import { leagueTopScorers, promotionExchange, simulateLeague, type LeagueRun } from './league'
import { isScheduled, nationFriendlies, simulateNationalTournament, tournamentYear } from './national'
import { createRivals, nationalityWeights, offseasonRivals, rivalSeasonStats } from './rivals'
import { evolveClubs, evolveNations, topTalent } from './strength'
import { clubSeason, nationSeason } from './summary'
import { sortTable } from './table'

export { simulateMatch, simulateTwoLegs, expectedGoals, MATCH } from './match'
export { roundRobin, seasonSchedule, remainingSchedule, swissPairings, fillPairings } from './schedule'
export { sortTable, addResult, newRow } from './table'
export { computeAwards } from './awards'
export { clubSeason, nationSeason } from './summary'

// ───────────────────────── criação ─────────────────────────

function rankingFromStandings(data: GameData, ix: DataIndex, leagueId: string): string[] {
  const rows = (data.standings[leagueId] ?? []).filter((r) => ix.club.has(r.clubId))
  const ids = sortTable(rows).map((r) => r.clubId)
  const rest = data.clubs
    .filter((c) => c.leagueId === leagueId && !ids.includes(c.id))
    .sort((a, b) => b.strength - a.strength)
    .map((c) => c.id)
  return [...ids, ...rest]
}

/** Último campeão conhecido de uma competição até a temporada `upTo` (mundo simulado ou histórico real). */
function championOf(data: GameData, world: WorldState, compId: string, season: number, upToHistory = season): string | undefined {
  const sim = world.seasons[season]?.cups[compId]?.winner
  if (sim) return sim
  const hist = (data.history?.champions?.[compId] ?? []).filter((h) => h.season <= upToHistory)
  if (!hist.length) return undefined
  return hist.reduce((a, b) => (b.season > a.season ? b : a)).winner
}

export function createWorld(data: GameData, seed: string): WorldState {
  const ix = indexData(data)
  const clubs: Record<string, ClubDynamic> = {}
  for (const c of data.clubs) clubs[c.id] = { strength: c.strength, leagueId: c.leagueId, prestige: c.prestige }
  const nations: Record<string, number> = {}
  for (const c of data.countries) nations[c.code] = c.strength
  const rivals = createRivals(data, ix, clubs, seed)
  const world: WorldState = { seed, nextSeason: ix.firstSeason, clubs, nations, rivals, seasons: {}, qualified: {} }

  // classificados das continentais que ainda não começaram (ex.: Concacaf 2027): tabela real de hoje
  const rankings = new Map<string, string[]>()
  for (const l of data.leagues) rankings.set(l.id, rankingFromStandings(data, ix, l.id))
  const holders = new Map<string, string>()
  for (const cf of CONFEDS) {
    for (const lv of LEVELS) {
      const comp = levelComp(ix, cf, lv)
      if (!comp) continue
      const w = championOf(data, world, comp.id, ix.firstSeason - 1, ix.firstSeason)
      if (w) holders.set(comp.id, w)
    }
  }
  const cupWinners = new Map<string, string>()
  for (const l of data.leagues) {
    for (const id of [l.domesticCupId, l.secondaryCupId]) {
      if (!id || cupWinners.has(id)) continue
      const w = championOf(data, world, id, ix.firstSeason - 1, ix.firstSeason - 1)
      if (w) cupWinners.set(id, w)
    }
  }
  const q = qualifyAll(ix, data, { rankings, cupWinners, holders, strength: (id) => clubs[id]?.strength ?? 60 })
  for (const [compId, list] of Object.entries(q)) {
    const cip = data.cupsInProgress?.[compId]
    if (cip && cip.season === ix.firstSeason) continue
    world.qualified[compId] = list
  }
  return world
}

// ───────────────────────── temporada ─────────────────────────

function leagueMembers(data: GameData, ix: DataIndex, ctx: SeasonCtx, leagueId: string): string[] {
  const members = data.clubs.filter((c) => ctx.leagueOf.get(c.id) === leagueId).map((c) => c.id)
  if (!ctx.first) return members
  // 1ª temporada: na ordem da tabela real
  const order = new Map((data.standings[leagueId] ?? []).map((r, i) => [r.clubId, i] as const))
  return members.sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999))
}

function decideForce(seed: string, season: number, user: UserSeasonContext): SeasonCtx['force'] {
  const f = user.forceTrophy
  if (!f || !f.chance) return null
  const hit = subRng(seed, 'season', season, 'force', f.kind).chance(Math.min(1, Math.abs(f.chance)))
  return hit ? { kind: f.kind, win: f.chance > 0 } : null
}

export function simulateSeason(
  data: GameData,
  world: WorldState,
  user: UserSeasonContext,
): { world: WorldState; result: SeasonWorldResult } {
  const ix = indexData(data)
  const S = world.nextSeason
  const first = S === ix.firstSeason && Object.keys(world.seasons).length === 0
  const seed = world.seed

  // 1. entressafra dos rivais
  const natWeight = nationalityWeights(data)
  const targetPop = Math.max(120, data.stars.length)
  const targetElite = Math.max(25, data.stars.filter((s) => s.ovr >= 85).length)
  let rivals = first
    ? world.rivals
    : offseasonRivals({ data, ix, seed, season: S, clubs: world.clubs, targetPop, targetElite, natWeight }, world.rivals)

  // 2. forças efetivas da temporada
  const formRng = subRng(seed, 'season', S, 'form')
  const str = new Map<string, number>()
  const leagueOf = new Map<string, string>()
  for (const c of data.clubs) {
    const d = world.clubs[c.id]
    const base = d?.strength ?? c.strength
    str.set(c.id, base + formRng.normal(0, FORM_SD))
    leagueOf.set(c.id, d?.leagueId ?? c.leagueId)
  }
  const userClub = user.clubId && str.has(user.clubId) ? user.clubId : null
  const userNation = user.nationalTeam && data.countries.some((c) => c.code === user.nationalTeam) ? user.nationalTeam : null
  if (userClub && !user.suspended) str.set(userClub, str.get(userClub)! + (user.clubStrengthBoost || 0))
  const nat = new Map<string, number>()
  for (const c of data.countries) nat.set(c.code, world.nations[c.code] ?? c.strength)
  if (userNation && !user.suspended) nat.set(userNation, nat.get(userNation)! + (user.nationalStrengthBoost || 0))
  const ctx: SeasonCtx = {
    data,
    ix,
    seed,
    season: S,
    first,
    str,
    nat,
    user,
    userClub,
    userNation,
    cs: new Map(),
    ns: new Map(),
    force: decideForce(seed, S, user),
    leagueOf,
  }

  // 3. ligas
  const runs = new Map<string, LeagueRun>()
  const leagues: Record<string, LeagueSeasonResult> = {}
  for (const l of data.leagues) {
    const members = leagueMembers(data, ix, ctx, l.id)
    if (members.length < 2) continue
    const run = simulateLeague(ctx, l, members)
    runs.set(l.id, run)
    leagues[l.id] = run.result
  }
  // acesso/rebaixamento
  const moves = new Map<string, string>()
  for (const upper of data.leagues) {
    const lower = upper.lowerLeagueId ? ix.league.get(upper.lowerLeagueId) : undefined
    if (!lower || !leagues[upper.id] || !leagues[lower.id]) continue
    const ex = promotionExchange(ctx, upper, lower, leagues[upper.id].table, leagues[lower.id].table)
    if (!ex.up.length) continue
    leagues[upper.id] = { ...leagues[upper.id], relegated: [...leagues[upper.id].relegated, ...ex.down] }
    const lr = leagues[lower.id]
    leagues[lower.id] = {
      ...lr,
      promoted: [...lr.promoted, ...ex.up],
      playoffs: ex.playoff.length ? [...(lr.playoffs ?? []), ...ex.playoff] : lr.playoffs,
    }
    if (!leagues[lower.id].playoffs) delete leagues[lower.id].playoffs
    for (const c of ex.up) moves.set(c, upper.id)
    for (const c of ex.down) moves.set(c, lower.id)
  }

  // 4. copas nacionais
  const cups: Record<string, CupResult> = {}
  const cupIds: string[] = []
  for (const l of data.leagues) for (const id of [l.domesticCupId, l.secondaryCupId]) if (id && !cupIds.includes(id)) cupIds.push(id)
  for (const id of cupIds) {
    const comp = ix.comp.get(id)
    if (!comp) continue
    const participants = data.clubs
      .filter((c) => {
        const lg = ix.league.get(leagueOf.get(c.id) ?? '')
        return lg && (lg.domesticCupId === id || lg.secondaryCupId === id)
      })
      .map((c) => c.id)
    const r = simulateDomesticCup(ctx, comp, participants)
    if (r) cups[id] = r
  }
  if (!first) {
    for (const comp of ix.regionalComps) {
      const country = comp.country ?? 'BRA'
      const participants = data.clubs
        .filter((c) => c.state === comp.region && c.country === country && ix.league.has(leagueOf.get(c.id) ?? ''))
        .map((c) => c.id)
      const r = simulateRegionalCup(ctx, comp, participants)
      if (r) cups[comp.id] = r
    }
  }

  // supercopas (campeões da temporada anterior)
  const prev = world.seasons[S - 1]
  if (prev) {
    for (const cf of CONFEDS) {
      const sc = ix.confed[cf].superCup
      const P = ix.confed[cf].primary
      const Sx = ix.confed[cf].secondary
      if (!sc || !P || !Sx) continue
      const a = prev.cups[P.id]?.winner
      const b = prev.cups[Sx.id]?.winner
      if (a && b && a !== b) cups[sc.id] = singleFinal(ctx, sc, a, b)
    }
  }

  // continentais
  const used = new Set<string>()
  for (const cf of CONFEDS) {
    let dropped: string[] = []
    for (const lv of LEVELS) {
      const comp = levelComp(ix, cf, lv)
      if (!comp) continue
      const entrants = [...(world.qualified[comp.id] ?? []), ...dropped]
      if (!entrants.length && !inProgress(ctx, comp.id)) {
        dropped = []
        continue
      }
      const run = simulateContinental(ctx, comp, cf, lv, entrants, used)
      dropped = run?.dropped ?? []
      if (run) cups[comp.id] = run.cup
    }
  }

  // Intercontinental (dezembro): campeões continentais
  if (ix.intercontinental) {
    const comp = ix.intercontinental
    const champs: Partial<Record<Confed, string>> = {}
    const cip = inProgress(ctx, comp.id)
    if (cip) {
      for (const id of cip.alive) {
        const cf = confedOfClub(ix, id)
        if (cf && !champs[cf]) champs[cf] = id
      }
      const lib = ix.confed.CONMEBOL.primary
      if (!champs.CONMEBOL && lib && cups[lib.id]) champs.CONMEBOL = cups[lib.id].winner
    } else {
      for (const cf of CONFEDS) {
        const P = ix.confed[cf].primary
        if (!P) continue
        // CONMEBOL: edição do mesmo ano civil; demais: edição encerrada no meio do ano
        const w = cf === 'CONMEBOL' ? cups[P.id]?.winner : championOf(data, world, P.id, S - 1, S)
        if (w && ix.club.has(w)) champs[cf] = w
      }
    }
    const r = intercontinental(ctx, comp, champs)
    if (r) {
      if (cip?.completed?.length) r.knockout = [...cip.completed.filter((st) => st.ties.every((t) => ix.club.has(t.a) && ix.club.has(t.b))), ...r.knockout]
      cups[comp.id] = r
    }
  }

  // Mundial de Clubes (ano T = S+1)
  const T = tournamentYear(S)
  const cwc = ix.clubWorldCup
  if (cwc && isScheduled(cwc, T)) {
    const champions = {} as Record<Confed, string[]>
    for (const cf of CONFEDS) {
      champions[cf] = []
      const P = ix.confed[cf].primary
      if (!P) continue
      for (let s = S; s >= S - 3; s--) {
        const w = s === S ? cups[P.id]?.winner : championOf(data, world, P.id, s, s)
        if (w && !champions[cf].includes(w)) champions[cf].push(w)
      }
    }
    const hostRng = subRng(seed, 'cwc-host', T)
    const hostCands = data.countries.filter((c) => c.strength >= 70 && data.clubs.some((k) => k.country === c.code && ix.league.get(leagueOf.get(k.id) ?? '')?.tier === 1))
    const host = hostCands.length ? hostRng.pick(hostCands).code : undefined
    const r = clubWorldCup(ctx, cwc, champions, host)
    if (r) cups[cwc.id] = r
  }

  // 5. seleções
  const national: Record<string, NationalTournamentResult> = {}
  const inTournament = new Set<string>()
  for (const comp of ix.nationalComps) {
    if (!isScheduled(comp, T)) continue
    const r = simulateNationalTournament(ctx, comp)
    if (!r) continue
    national[comp.id] = r
    for (const code of Object.keys(r.reached)) inTournament.add(code)
  }
  nationFriendlies(ctx, inTournament)

  // clubes sem liga simulada: liga local "fantasma" (30 jogos) para estatísticas realistas
  for (const id of ix.extraClubs) {
    const s = str.get(id) ?? 65
    const m = 30
    const gf = Math.round(m * clamp(1.5 + (s - 70) * 0.05, 0.9, 2.6))
    const ga = Math.round(m * clamp(1.0 - (s - 70) * 0.03, 0.5, 1.4))
    const cs = Math.round(m * clamp(0.3 + (s - 70) * 0.012, 0.15, 0.5))
    const cur = ctx.cs.get(id)
    if (cur) (cur[0] += m), (cur[1] += gf), (cur[2] += ga), (cur[3] += cs)
    else ctx.cs.set(id, [m, gf, ga, cs])
  }

  // 6. estatísticas dos rivais e artilharia
  rivals = rivalSeasonStats(seed, S, rivals, ctx.cs, (id) => str.get(id) ?? 60)
  const leaguePlayed = new Map<string, number>()
  for (const lr of Object.values(leagues)) for (const r of lr.table) leaguePlayed.set(r.clubId, r.played)
  const rivalsByClub = new Map<string, { name: string; goals: number }[]>()
  for (const r of rivals) {
    if (!r.lastSeason) continue
    const total = ctx.cs.get(r.clubId)?.[0] ?? 0
    const share = total > 0 ? (leaguePlayed.get(r.clubId) ?? 0) / total : 0
    const g = Math.round(r.lastSeason.goals * share)
    const l = rivalsByClub.get(r.clubId)
    if (l) l.push({ name: r.name, goals: g })
    else rivalsByClub.set(r.clubId, [{ name: r.name, goals: g }])
  }
  for (const id of Object.keys(leagues)) leagues[id] = { ...leagues[id], topScorers: leagueTopScorers(ctx, leagues[id], rivalsByClub) }

  const clubStats: Record<string, [number, number, number, number]> = {}
  for (const c of data.clubs) {
    const s = ctx.cs.get(c.id)
    if (s) clubStats[c.id] = [s[0], s[1], s[2], s[3]]
  }
  const nationStats: Record<string, [number, number]> = {}
  for (const c of data.countries) {
    const s = ctx.ns.get(c.code)
    if (s) nationStats[c.code] = [s[0], s[1]]
  }
  const result: SeasonWorldResult = { season: S, leagues, cups, national, awards: [], clubStats, nationStats }

  // classificados para S+1
  const rankings = new Map<string, string[]>()
  for (const [id, run] of runs) rankings.set(id, run.ranking)
  const cupWinners = new Map<string, string>()
  for (const [id, c] of Object.entries(cups)) if (c.winner) cupWinners.set(id, c.winner)
  const holders = new Map<string, string>()
  for (const cf of CONFEDS) for (const lv of LEVELS) {
    const comp = levelComp(ix, cf, lv)
    const w = comp && cups[comp.id]?.winner
    if (comp && w) holders.set(comp.id, w)
  }
  const nextClubs = evolveClubs(data, ix, seed, world.clubs, result, moves)
  const qualified = qualifyAll(ix, data, { rankings, cupWinners, holders, strength: (id) => nextClubs[id]?.strength ?? 60 })
  const initialTalent = topTalent(data.stars)
  const nations = evolveNations(data, seed, S, world.nations, result, initialTalent, rivals)

  const seasons = { ...world.seasons, [S]: result }
  const old = seasons[S - COMPACT_AFTER]
  if (old) seasons[S - COMPACT_AFTER] = compactSeason(old)
  const next: WorldState = {
    seed,
    nextSeason: S + 1,
    clubs: nextClubs,
    nations,
    rivals,
    seasons,
    qualified,
  }
  return { world: next, result }
}

export const worldEngine: WorldEngine = {
  createWorld,
  simulateSeason,
  computeAwards,
  clubSeason,
  nationSeason,
}

export default worldEngine

/** Tipos úteis para quem reutiliza os módulos (modo Imersivo). */
export type { CompetitionKind }
