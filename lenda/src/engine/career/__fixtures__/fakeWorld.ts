/**
 * WorldEngine FALSO, determinístico e rápido, só para os testes da carreira.
 * Imita o contrato de src/engine/api.ts: ligas por força + ruído, acesso/rebaixamento pela
 * tabela, copas ponderadas, continentais pelos classificados, Mundial/Copa pelo calendário,
 * prêmios com rivais reais (estrelas) e o jogador do usuário concorrendo.
 */
import type { ClubSeasonSummary, NationSeasonSummary, UserAwardEntry, UserSeasonContext, WorldEngine } from '../../api'
import { clamp, rng, type Rng } from '../../rng'
import type {
  AwardRankingEntry,
  AwardResult,
  CompetitionKind,
  Confed,
  CupResult,
  GameData,
  LeagueSeasonResult,
  NationalTournamentResult,
  Rival,
  SeasonWorldResult,
  StandingRow,
  WorldState,
} from '../../types'

const STAGES = ['Campeão', 'Final', 'Semifinal', 'Quartas de final', 'Oitavas de final', 'Fase de grupos']

function schedOk(first: number, every: number, season: number) {
  const y = season + 1
  return y >= first && (y - first) % every === 0
}

function weightedWinner(r: Rng, ids: string[], power: (id: string) => number, temp: number): string {
  const max = Math.max(...ids.map(power))
  return r.weighted(ids, (id) => Math.exp((power(id) - max) / temp))
}

/** Aplica forceTrophy (chance > 0 força; < 0 impede) sobre o vencedor sorteado. */
function applyForce(r: Rng, winner: string, ids: string[], userId: string | null, kind: CompetitionKind, ctx: UserSeasonContext): string {
  const f = ctx.forceTrophy
  if (!f || f.kind !== kind || !userId || !ids.includes(userId)) return winner
  if (f.chance > 0 && r.chance(f.chance)) return userId
  if (f.chance < 0 && winner === userId && r.chance(-f.chance)) return ids.find((x) => x !== userId) ?? winner
  return winner
}

function cup(r: Rng, competitionId: string, season: number, ids: string[], power: (id: string) => number, temp: number, userId: string | null, kind: CompetitionKind, ctx: UserSeasonContext): CupResult {
  let winner = weightedWinner(r, ids, power, temp)
  winner = applyForce(r, winner, ids, userId, kind, ctx)
  const rest = r.shuffle(ids.filter((x) => x !== winner)).sort((a, b) => power(b) + r.normal(0, 3) - power(a))
  const reached: Record<string, string> = { [winner]: 'Campeão' }
  rest.forEach((id, i) => {
    reached[id] = i === 0 ? 'Final' : i < 3 ? 'Semifinal' : i < 7 ? 'Quartas de final' : i < 15 ? 'Oitavas de final' : 'Fase de grupos'
  })
  return { competitionId, season, winner, runnerUp: rest[0] ?? winner, knockout: [], reached }
}

export function createFakeWorld(): WorldEngine {
  const engine: WorldEngine = {
    createWorld(data: GameData, seed: string): WorldState {
      const clubs: WorldState['clubs'] = {}
      for (const c of data.clubs) clubs[c.id] = { strength: c.strength, leagueId: c.leagueId, prestige: c.prestige }
      const nations: WorldState['nations'] = {}
      for (const c of data.countries) nations[c.code] = c.strength
      const rivals: Rival[] = data.stars.map((p) => ({
        id: p.id,
        name: p.name,
        shortName: p.shortName,
        nationality: p.nationality,
        position: p.position,
        birthYear: p.birthYear,
        ovr: p.ovr,
        potential: p.potential ?? p.ovr,
        clubId: p.clubId ?? '',
        generated: false,
      }))
      const w: WorldState = { seed, nextSeason: 2026, clubs, nations, rivals, seasons: {}, qualified: {} }
      w.qualified = qualify(data, w, {})
      return w
    },

    simulateSeason(data, world, ctx) {
      const season = world.nextSeason
      const r = rng(world.seed, 'fake', season)
      const user = ctx.suspended ? null : ctx.clubId
      const power = (id: string) => (world.clubs[id]?.strength ?? 50) + (id === user ? ctx.clubStrengthBoost : 0)
      const leagues: Record<string, LeagueSeasonResult> = {}
      const cups: Record<string, CupResult> = {}
      const national: Record<string, NationalTournamentResult> = {}
      const clubs = structuredClone(world.clubs)

      // ligas
      for (const lg of data.leagues) {
        const ids = Object.keys(world.clubs).filter((id) => world.clubs[id].leagueId === lg.id)
        if (!ids.length) continue
        const prio = (id: string) => (id === user && ctx.priority ? (ctx.priority === 'league' ? 2 : -1) : 0)
        const scores = new Map(ids.map((id) => [id, power(id) + prio(id) + r.normal(0, 3.5)]))
        let order = ids.slice().sort((a, b) => scores.get(b)! - scores.get(a)!)
        const forced = applyForce(r, order[0], ids, user, 'league', ctx)
        if (forced !== order[0]) order = [forced, ...order.filter((x) => x !== forced)]
        const mean = ids.reduce((t, id) => t + scores.get(id)!, 0) / ids.length
        const played = 2 * (ids.length - 1)
        let prevPts = Infinity
        const table: StandingRow[] = order.map((id) => {
          const d = scores.get(id)! - mean
          let points = clamp(Math.round(played * (1.35 + d / 12)), 5, played * 3)
          points = Math.min(points, prevPts)
          prevPts = points
          const won = clamp(Math.round((points - played * 0.25) / 2.75), 0, played)
          const drawn = clamp(points - won * 3, 0, played - won)
          const gf = Math.max(Math.round(played * 0.6), Math.round(played * (1.35 + d / 10)))
          const ga = Math.max(Math.round(played * 0.5), Math.round(played * (1.35 - d / 10)))
          return { clubId: id, played, won, drawn, lost: played - won - drawn, gf, ga, points }
        })
        const promoted = lg.upperLeagueId ? order.slice(0, lg.promotion) : []
        const relegated = lg.lowerLeagueId ? order.slice(order.length - lg.relegation) : []
        leagues[lg.id] = {
          leagueId: lg.id,
          season,
          table,
          champion: order[0],
          promoted,
          relegated,
          topScorers: [{ name: 'Artilheiro', clubId: order[0], goals: Math.round(14 + r.range(0, 14) + (lg.coefficient - 0.5) * 6) }],
        }
      }
      for (const lg of data.leagues) {
        const res = leagues[lg.id]
        if (!res) continue
        for (const id of res.promoted) if (lg.upperLeagueId) clubs[id].leagueId = lg.upperLeagueId
        for (const id of res.relegated) if (lg.lowerLeagueId) clubs[id].leagueId = lg.lowerLeagueId
      }

      // copas nacionais
      for (const comp of data.competitions.filter((c) => c.kind === 'domestic_cup')) {
        const ids = Object.keys(world.clubs).filter((id) => data.leagues.find((l) => l.id === world.clubs[id].leagueId)?.domesticCupId === comp.id)
        if (ids.length >= 2) cups[comp.id] = cup(r, comp.id, season, ids, power, 4, user, 'domestic_cup', ctx)
      }
      // continentais
      for (const comp of data.competitions.filter((c) => c.kind === 'continental_primary' || c.kind === 'continental_secondary')) {
        const ids = (world.qualified[comp.id] ?? []).filter((id) => world.clubs[id])
        if (ids.length < 2) continue
        const prio = (id: string) => power(id) + (id === user && ctx.priority && comp.kind === 'continental_primary' ? (ctx.priority === 'continental' ? 2 : -1) : 0)
        cups[comp.id] = cup(r, comp.id, season, ids, prio, 2.5, user, comp.kind, ctx)
      }
      const cwc = data.competitions.find((c) => c.kind === 'club_world_cup')
      if (cwc?.schedule && schedOk(cwc.schedule.firstYear, cwc.schedule.every, season)) {
        const ids = (world.qualified[cwc.id] ?? []).filter((id) => world.clubs[id])
        if (ids.length >= 2) cups[cwc.id] = cup(r, cwc.id, season, ids, power, 2.5, user, 'club_world_cup', ctx)
      }
      // seleções
      const nPower = (code: string) => (world.nations[code] ?? 50) + (code === ctx.nationalTeam ? ctx.nationalStrengthBoost : 0)
      for (const comp of data.competitions.filter((c) => (c.kind === 'world_cup' || c.kind === 'national_continental') && c.schedule)) {
        if (!schedOk(comp.schedule!.firstYear, comp.schedule!.every, season)) continue
        let ids = data.countries.filter((c) => comp.kind === 'world_cup' || c.confed === comp.confed).map((c) => c.code)
        if (comp.kind === 'world_cup') ids = ids.sort((a, b) => nPower(b) - nPower(a)).slice(0, 16)
        if (ids.length < 2) continue
        const res = cup(r, comp.id, season, ids, nPower, 2.2, ctx.nationalTeam, comp.kind, ctx)
        national[comp.id] = res
      }

      const result: SeasonWorldResult = { season, leagues, cups, national, awards: [] }

      // evolução: forças, seleções e rivais
      for (const c of data.clubs) {
        const cur = clubs[c.id]
        cur.strength = Math.round(clamp(cur.strength + r.normal(0, 0.8) - 0.15 * (cur.strength - c.strength), 40, 92) * 10) / 10
      }
      const nations = { ...world.nations }
      for (const c of data.countries) nations[c.code] = Math.round(clamp(nations[c.code] + r.normal(0, 0.6) - 0.2 * (nations[c.code] - c.strength), 40, 95) * 10) / 10
      const rivals = world.rivals.map((rv) => {
        if (rv.retired) return rv
        const age = season - rv.birthYear
        const d = age < 24 ? r.int(0, 3) : age < 29 ? r.int(-1, 1) : age < 32 ? r.int(-2, 0) : r.int(-3, -1)
        const ovr = clamp(rv.ovr + d, 50, 95)
        return { ...rv, ovr, retired: age >= 37 || undefined, lastSeason: { apps: 40, goals: Math.round(Math.max(0, ovr - 70) * 1.6 * (['CA', 'PE', 'PD'].includes(rv.position) ? 1 : 0.35) + r.range(0, 8)), assists: 5 } }
      })
      // nova geração: repõe estrelas que se aposentam
      const alive = rivals.filter((x) => !x.retired).length
      const nats = ['BRA', 'ARG', 'FRA', 'ENG', 'ESP', 'GER', 'POR', 'NED', 'ITA']
      const pos = ['CA', 'PE', 'PD', 'MEI', 'MC', 'VOL', 'ZAG', 'LD', 'LE', 'GOL'] as const
      for (let i = alive; i < data.stars.length; i++) {
        const nat = r.pick(nats)
        rivals.push({
          id: `gen-${season}-${i}`,
          name: `Promessa ${nat} ${season}-${i}`,
          shortName: `Promessa ${i}`,
          nationality: nat,
          position: r.pick(pos),
          birthYear: season - 20,
          ovr: r.int(78, 86),
          potential: 90,
          clubId: r.pick(data.clubs.filter((c) => c.prestige >= 4)).id,
          generated: true,
        })
      }
      const next: WorldState = {
        seed: world.seed,
        nextSeason: season + 1,
        clubs,
        nations,
        rivals,
        seasons: { ...world.seasons, [season]: result },
        qualified: {},
      }
      next.qualified = qualify(data, next, leagues, cups, world.qualified)
      return { world: next, result }
    },

    computeAwards(data, world, season, user) {
      const r = rng(world.seed, 'fake-awards', season)
      const year = season + 1
      const res = world.seasons[season]
      const out: AwardResult[] = []
      const alive = world.rivals.filter((x) => !x.retired)
      const posBonus = (p: string) => (['CA', 'PE', 'PD'].includes(p) ? 1.5 : ['MEI', 'ME', 'MD'].includes(p) ? 0.8 : p === 'GOL' ? -4 : ['ZAG', 'VOL'].includes(p) ? -2.5 : -1)
      const rivalEntry = (x: Rival, score: number): AwardRankingEntry => ({ name: x.name, nationality: x.nationality, clubId: x.clubId, position: x.position, score })
      const userEntry = (u: UserAwardEntry, score: number): AwardRankingEntry => ({ name: u.name, nationality: u.nationality, clubId: u.clubId ?? undefined, position: u.position, score, isUser: true })
      const titleScore = (ids: string[]) =>
        ids.reduce((t, id) => {
          const k = data.competitions.find((c) => c.id === id)?.kind ?? (data.leagues.some((l) => l.id === id) ? 'league' : undefined)
          return t + (k === 'continental_primary' ? 3 : k === 'world_cup' ? 4 : k === 'national_continental' ? 2 : k === 'league' ? 1.5 : k === 'club_world_cup' ? 1 : 0.5)
        }, 0)
      const userScore = (u: UserAwardEntry) =>
        u.ovr + posBonus(u.position) + titleScore(u.titles) + Math.max(0, u.goals - 30) / 10 + (u.role === 'starter' ? 0 : u.role === 'high_rotation' ? -2 : -12) + r.normal(0, 1.5)
      const rank = (entries: AwardRankingEntry[], k: number) => entries.sort((a, b) => b.score - a.score).slice(0, k)

      const ballon = (award: 'ballon_dor' | 'the_best') => {
        const entries = alive.map((x) => rivalEntry(x, x.ovr + posBonus(x.position) + r.normal(0, 2.2) + 2))
        if (user) entries.push(userEntry(user, userScore(user)))
        const ranking = rank(entries, 10)
        out.push({ award, year, winner: ranking[0], ranking })
      }
      ballon('ballon_dor')
      ballon('the_best')

      // Luva de Ouro
      {
        const entries = alive.filter((x) => x.position === 'GOL').map((x) => rivalEntry(x, x.ovr + r.normal(0, 2)))
        entries.push({ name: 'Goleiro do ano', nationality: 'GER', position: 'GOL', score: 86 + r.normal(0, 2) })
        if (user && user.position === 'GOL' && user.role === 'starter') entries.push(userEntry(user, user.ovr + (user.cleanSheets ?? 0) / 6 + titleScore(user.titles) / 2 + r.normal(0, 1.5)))
        if (entries.length) {
          const ranking = rank(entries, 5)
          out.push({ award: 'golden_glove', year, winner: ranking[0], ranking })
        }
      }
      // Kopa (sub-21)
      {
        const entries = alive.filter((x) => year - x.birthYear <= 21).map((x) => rivalEntry(x, x.ovr - 4 + r.normal(0, 2)))
        for (let i = 0; i < 3; i++) entries.push({ name: `Promessa ${i + 1}`, nationality: 'FRA', position: 'PE', score: 79 + r.normal(0, 2.5) })
        if (user && user.age <= 21 && user.apps >= 15) entries.push(userEntry(user, userScore(user)))
        if (entries.length) {
          const ranking = rank(entries, 5)
          out.push({ award: 'kopa', year, winner: ranking[0], ranking })
        }
      }
      // Chuteira de Ouro (ligas europeias)
      {
        const uefa = (clubId: string | null | undefined) => {
          const lg = data.leagues.find((l) => l.id === (clubId ? world.clubs[clubId]?.leagueId : undefined))
          return (lg?.confed as Confed | undefined) === 'UEFA'
        }
        const entries = alive.filter((x) => uefa(x.clubId)).map((x) => rivalEntry(x, x.lastSeason?.goals ?? 0))
        entries.push({ name: 'Artilheiro europeu', nationality: 'ENG', position: 'CA', score: 27 + r.range(0, 12) })
        if (user && user.position !== 'GOL' && uefa(user.clubId)) entries.push(userEntry(user, user.goals * 0.85))
        if (entries.length) {
          const ranking = rank(entries, 5)
          out.push({ award: 'golden_boot', year, winner: ranking[0], ranking })
        }
      }
      // artilharia e craque da liga do usuário
      if (user?.leagueId && res?.leagues[user.leagueId]) {
        const top = res.leagues[user.leagueId].topScorers[0]
        const clubGoals = Math.round(user.goals * 0.85)
        const scorerWinner = clubGoals >= top.goals ? userEntry(user, clubGoals) : { name: top.name, nationality: 'BRA', clubId: top.clubId, position: 'CA' as const, score: top.goals }
        out.push({ award: 'league_top_scorer', year, winner: scorerWinner, ranking: [scorerWinner], leagueId: user.leagueId })
        const best = user.role === 'starter' && r.chance(clamp((user.ovr - 76) / 12, 0, 0.8)) ? userEntry(user, user.ovr) : { name: 'Outro craque', nationality: 'BRA', position: 'MEI' as const, score: 80 }
        out.push({ award: 'league_best_player', year, winner: best, ranking: [best], leagueId: user.leagueId })
      }
      if (user && user.goals >= 10 && r.chance(0.02)) {
        const p = userEntry(user, 1)
        out.push({ award: 'puskas', year, winner: p, ranking: [p] })
      }
      if (user?.nationalTournament) {
        const wc = data.competitions.find((c) => c.id === user.nationalTournament!.competitionId)?.kind === 'world_cup'
        const deep = ['Campeão', 'Final'].includes(user.nationalTournament.reached)
        if (wc && deep && user.ovr >= 84 && r.chance(0.35)) {
          const p = userEntry(user, user.ovr)
          out.push({ award: 'wc_golden_ball', year, winner: p, ranking: [p] })
        }
      }
      return { world: { ...world, seasons: { ...world.seasons, [season]: { ...world.seasons[season], awards: out } } }, awards: out }
    },

    clubSeason(result, data, clubId): ClubSeasonSummary {
      let leagueId = ''
      let row: StandingRow | undefined
      let pos = 0
      let lr: LeagueSeasonResult | undefined
      for (const l of Object.values(result.leagues)) {
        const i = l.table.findIndex((x) => x.clubId === clubId)
        if (i >= 0) {
          leagueId = l.leagueId
          row = l.table[i]
          pos = i + 1
          lr = l
          break
        }
      }
      const league = data.leagues.find((l) => l.id === leagueId)
      const titles: ClubSeasonSummary['titles'] = []
      if (lr && lr.champion === clubId && league) titles.push({ competitionId: league.id, trophyId: league.trophyId, kind: 'league' })
      const reached: Record<string, string> = {}
      let extra = 0
      for (const c of Object.values(result.cups)) {
        const st = c.reached[clubId]
        if (!st) continue
        reached[c.competitionId] = st
        const comp = data.competitions.find((x) => x.id === c.competitionId)
        const depth = STAGES.length - STAGES.indexOf(st)
        extra += comp?.kind === 'domestic_cup' ? depth * 1.5 : comp?.kind === 'club_world_cup' ? Math.min(depth, 4) : 6 + depth * 2
        if (c.winner === clubId && comp) titles.push({ competitionId: comp.id, trophyId: comp.trophyId, kind: comp.kind })
      }
      const played = row?.played ?? 30
      const matches = Math.round(played + extra)
      const gf = Math.round(((row?.gf ?? played * 1.3) / played) * matches)
      const ga = Math.round(((row?.ga ?? played * 1.3) / played) * matches)
      return {
        clubId,
        leagueId,
        tier: league?.tier ?? 1,
        position: pos,
        points: row?.points ?? 0,
        leagueChampion: lr?.champion === clubId,
        promoted: !!lr?.promoted.includes(clubId),
        relegated: !!lr?.relegated.includes(clubId),
        matches,
        goalsFor: gf,
        goalsAgainst: ga,
        cleanSheets: Math.round(matches * clamp(0.55 - 0.25 * (ga / matches), 0.08, 0.5)),
        titles,
        reached,
      }
    },

    nationSeason(result, code): NationSeasonSummary {
      let tournament: NationSeasonSummary['tournament']
      let extra = 0
      for (const t of Object.values(result.national)) {
        const st = t.reached[code]
        if (!st) continue
        tournament = { competitionId: t.competitionId, reached: st, champion: t.winner === code, trophyId: `trophy-${t.competitionId}` }
        extra = 3 + Math.max(0, 4 - STAGES.indexOf(st))
      }
      const matches = 8 + extra
      return { countryCode: code, matches, goalsFor: Math.round(matches * 1.5), tournament }
    },
  }
  return engine
}

/** Classificados para a próxima temporada: topo das ligas de 1ª divisão da confederação. */
function qualify(
  data: GameData,
  w: WorldState,
  leagues: Record<string, LeagueSeasonResult>,
  cups: Record<string, CupResult> = {},
  prev: WorldState['qualified'] = {},
): WorldState['qualified'] {
  const q: WorldState['qualified'] = {}
  const byConfed = new Map<string, { p: string[]; s: string[] }>()
  for (const lg of data.leagues.filter((l) => l.tier === 1)) {
    const order = leagues[lg.id]?.table.map((x) => x.clubId) ?? Object.keys(w.clubs).filter((id) => w.clubs[id].leagueId === lg.id).sort((a, b) => w.clubs[b].strength - w.clubs[a].strength)
    const e = byConfed.get(lg.confed) ?? { p: [], s: [] }
    e.p.push(...order.slice(0, lg.continentalSlots[0]))
    e.s.push(...order.slice(lg.continentalSlots[0], lg.continentalSlots[0] + lg.continentalSlots[1]))
    byConfed.set(lg.confed, e)
  }
  const champs: string[] = []
  for (const comp of data.competitions) {
    const e = comp.confed ? byConfed.get(comp.confed) : undefined
    if (comp.kind === 'continental_primary' && e) q[comp.id] = e.p
    if (comp.kind === 'continental_secondary' && e) q[comp.id] = e.s
    if (comp.kind === 'continental_primary' && cups[comp.id]) champs.push(cups[comp.id].winner)
  }
  const cwc = data.competitions.find((c) => c.kind === 'club_world_cup')
  if (cwc) q[cwc.id] = Array.from(new Set([...(prev[cwc.id] ?? []), ...champs])).slice(-12)
  if (cwc && !q[cwc.id].length) q[cwc.id] = [...(byConfed.get('UEFA')?.p.slice(0, 6) ?? []), ...(byConfed.get('CONMEBOL')?.p.slice(0, 4) ?? [])]
  return q
}
