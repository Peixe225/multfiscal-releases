/**
 * Torneios de seleções (Copa do Mundo 48, Euro, Copa América, Copa Ouro, CAN, Copa da Ásia, OFC)
 * e jogos de seleções por temporada (eliminatórias/amistosos) para as convocações.
 *
 * Um torneio disputado no meio do ano T encerra a temporada T-1 (guardado no resultado de T-1).
 * Classificação ponderada por força (Country.strength evoluída + ruído); anfitriões garantidos.
 */
import type { Competition, Confed, Country, NationalTournamentResult, StandingRow } from '../types'
import { rng as subRng, type Rng } from '../rng'
import { CONFEDS, setTag, type SeasonCtx } from './context'
import { drawGroups, forceInto, runGroups, runKnockout } from './knockout'
import { compareRows } from './table'

/** Cotas da Copa de 48 (2026+): 16 UEFA, 9 CAF, 8 AFC, 6 CONMEBOL, 6 CONCACAF, 1 OFC + 2 repescagem. */
export const WC_QUOTAS: Record<Confed, number> = { UEFA: 16, CAF: 9, AFC: 8, CONMEBOL: 6, CONCACAF: 6, OFC: 1 }

/** Sedes conhecidas (ano do torneio → países). Demais edições: sorteio ponderado. */
const KNOWN_HOSTS: Record<string, Record<number, string[]>> = {
  world_cup: { 2030: ['ESP', 'POR', 'MAR', 'URU', 'ARG', 'PAR'], 2034: ['KSA'] },
  UEFA: { 2028: ['ENG', 'SCO', 'WAL', 'IRL'], 2032: ['ITA', 'TUR'] },
  CONMEBOL: { 2028: ['ECU'] },
  CONCACAF: { 2027: ['USA'] },
  CAF: { 2027: ['KEN', 'UGA', 'TAN'] },
  AFC: { 2027: ['KSA'] },
}

/** Ano (T) em que a competição é disputada se encerrar a temporada `season`. */
export function tournamentYear(season: number): number {
  return season + 1
}

export function isScheduled(comp: Competition, year: number): boolean {
  const s = comp.schedule
  if (!s || s.every <= 0) return false
  return year >= s.firstYear && (year - s.firstYear) % s.every === 0
}

function hostsFor(ctx: SeasonCtx, comp: Competition, year: number, pool: Country[], rng: Rng): string[] {
  const table = KNOWN_HOSTS[comp.kind === 'world_cup' ? 'world_cup' : (comp.confed ?? '')]
  const known = table?.[year]?.filter((c) => ctx.ix.country.has(c))
  if (known?.length) return known
  if (comp.kind === 'national_continental') {
    // Copa Ouro: nos EUA (às vezes dividida com Canadá ou México); Oceania: rodízio entre os membros
    if (comp.confed === 'CONCACAF' && ctx.ix.country.has('USA')) {
      const co = ['CAN', 'MEX'].filter((c) => ctx.ix.country.has(c))
      return co.length && rng.chance(0.3) ? ['USA', rng.pick(co)] : ['USA']
    }
    if (comp.confed === 'OFC' && pool.length) return [rng.pick(pool).code]
  }
  const cands = pool.filter((c) => c.strength >= 60)
  if (!cands.length) return pool.length ? [pool[0].code] : []
  return [rng.weighted(cands, (c) => Math.pow(c.strength / 60, 4)).code]
}

function nationScore(ctx: SeasonCtx, code: string, rng: Rng): number {
  // ctx.nat já inclui o reforço do jogador na seleção dele
  return (ctx.nat.get(code) ?? 50) + rng.normal(0, 3)
}

/** Seleciona os participantes (anfitriões + melhores por força com ruído de eliminatória). */
function pickParticipants(ctx: SeasonCtx, comp: Competition, year: number, rng: Rng): { teams: string[]; hosts: string[] } {
  const all = ctx.data.countries.filter((c) => ctx.nat.has(c.code))
  const isWorld = comp.kind === 'world_cup'
  const confedPool = isWorld ? all : all.filter((c) => c.confed === comp.confed)
  const hosts = hostsFor(ctx, comp, year, confedPool.length ? confedPool : all, rng)
  const size = Math.max(4, comp.size || (isWorld ? 48 : 16))
  const scored = new Map(all.map((c) => [c.code, nationScore(ctx, c.code, rng)] as const))
  const byScore = (list: Country[]) => list.slice().sort((a, b) => scored.get(b.code)! - scored.get(a.code)!)
  const teams: string[] = [...hosts]
  if (isWorld) {
    const factor = size / 48
    for (const cf of CONFEDS) {
      const quota = Math.round(WC_QUOTAS[cf] * factor)
      const pool = byScore(all.filter((c) => c.confed === cf))
      let got = teams.filter((t) => ctx.ix.country.get(t)?.confed === cf).length
      for (const c of pool) {
        if (got >= quota) break
        if (!teams.includes(c.code)) {
          teams.push(c.code)
          got++
        }
      }
    }
    // repescagem intercontinental: melhores restantes fora da UEFA
    const rest = byScore(all.filter((c) => !teams.includes(c.code) && c.confed !== 'UEFA'))
    const extra = Math.max(0, size - teams.length)
    for (const c of rest.slice(0, extra)) teams.push(c.code)
    if (teams.length < size) for (const c of byScore(all)) if (teams.length < size && !teams.includes(c.code)) teams.push(c.code)
  } else {
    for (const c of byScore(confedPool)) {
      if (teams.length >= size) break
      if (!teams.includes(c.code)) teams.push(c.code)
    }
    if (teams.length < size) {
      // convidados (Copa América com seleções da CONCACAF, etc.)
      const guestConfed: Confed = comp.confed === 'CONMEBOL' ? 'CONCACAF' : comp.confed === 'CONCACAF' ? 'CONMEBOL' : 'AFC'
      for (const c of byScore(all.filter((x) => x.confed === guestConfed))) {
        if (teams.length >= size) break
        if (!teams.includes(c.code)) teams.push(c.code)
      }
    }
  }
  const n = Math.floor(Math.min(teams.length, size) / 4) * 4
  return { teams: teams.slice(0, n), hosts: hosts.filter((h) => teams.slice(0, n).includes(h)) }
}

/** Torneio de seleções: grupos de 4 → melhores (1º, 2º e terceiros) → mata-mata em jogo único. */
export function simulateNationalTournament(ctx: SeasonCtx, comp: Competition): NationalTournamentResult | null {
  const year = tournamentYear(ctx.season)
  const rng = subRng(ctx.seed, 'season', ctx.season, 'national', comp.id)
  const { teams, hosts } = pickParticipants(ctx, comp, year, rng)
  if (teams.length < 4) return null
  setTag(ctx, comp.id, '')
  const G = teams.length / 4
  const hostSet = new Set(hosts)
  const groups = drawGroups(rng, teams, G, (c) => ctx.nat.get(c) ?? 50, hosts)
  const tables = runGroups(ctx, rng, groups, { kind: comp.kind, rounds: 1, neutral: true, hosts: hostSet })
  let K = 1
  while (K < 2 * G) K *= 2
  if (K - 2 * G > G) K /= 2
  if (G === 1) K = 2
  const cands: { row: StandingRow; pos: number }[] = []
  for (const t of tables) t.table.forEach((row, pos) => cands.push({ row, pos }))
  cands.sort((a, b) => a.pos - b.pos || compareRows(a.row, b.row))
  const qualified = forceInto(ctx, comp.kind, teams, cands.slice(0, K).map((c) => c.row.clubId), K - 1)
  const reached: Record<string, string> = {}
  for (const t of teams) if (!qualified.includes(t)) reached[t] = 'Fase de grupos'
  const ko = runKnockout(ctx, rng, qualified, {
    kind: comp.kind,
    legs: () => 1,
    neutral: () => true,
    extraTime: true,
    mode: 'bracket',
    keepFrom: 64,
    hosts: hostSet,
  })
  Object.assign(reached, ko.reached)
  const res: NationalTournamentResult = {
    competitionId: comp.id,
    season: ctx.season,
    winner: ko.winner,
    runnerUp: ko.runnerUp,
    groups: tables,
    knockout: ko.stages,
    reached,
    trophyId: comp.trophyId,
  }
  if (hosts.length) res.host = hosts.join(',')
  return res
}

/**
 * Jogos de seleções fora dos torneios (eliminatórias + amistosos): 8–10 por temporada
 * (5–7 para quem jogou torneio). Gols ~ Poisson contra um adversário médio da confederação.
 */
export function nationFriendlies(ctx: SeasonCtx, inTournament: Set<string>): void {
  const rng = subRng(ctx.seed, 'season', ctx.season, 'nations')
  const confedMean = new Map<Confed, number>()
  for (const cf of CONFEDS) {
    const list = ctx.data.countries.filter((c) => c.confed === cf)
    confedMean.set(cf, list.length ? list.reduce((s, c) => s + (ctx.nat.get(c.code) ?? c.strength), 0) / list.length : 60)
  }
  for (const c of ctx.data.countries) {
    const games = inTournament.has(c.code) ? rng.int(5, 7) : rng.int(8, 10)
    const s = ctx.nat.get(c.code) ?? c.strength
    const opp = (confedMean.get(c.confed) ?? 60) + 4
    const lambda = 1.3 * Math.exp(0.038 * (s - opp))
    let gf = 0
    for (let i = 0; i < games; i++) gf += rng.poisson(lambda)
    const cur = ctx.ns.get(c.code)
    if (cur) {
      cur[0] += games
      cur[1] += gf
    } else ctx.ns.set(c.code, [games, gf])
  }
}
