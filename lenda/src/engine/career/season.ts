/**
 * Uma temporada do jogador: papel → contexto para o mundo → mundo simulado → números do
 * jogador → seleção → prêmios → títulos → OVR → valor de mercado → linha da tabela.
 */
import type { UserAwardEntry, UserSeasonContext, WorldEngine } from '../api'
import { clamp, rng } from '../rng'
import type {
  AwardId,
  AwardWin,
  CareerLogEntry,
  CareerState,
  Competition,
  Country,
  GameData,
  SeasonRecord,
  SeasonStats,
  SquadRole,
  TrophyWin,
} from '../types'
import {
  APP_SHARE,
  APP_SHARE_GK,
  ASSIST_RATES,
  AVG_MINUTES,
  FALLBACK_MATCHES,
  GOAL_RATES,
  NATIONAL_SLOTS,
  type RateRole,
} from './constants'
import { mem } from './memory'
import {
  clampOvr,
  cycleTarget,
  isPlayingRole,
  marketValue,
  normalizeRole,
  roleFromDelta,
  rollCycle,
  shiftRole,
} from './player'
import {
  clubConfed,
  clubLeagueId,
  clubPrestige,
  clubStrength,
  competitionKind,
  indexData,
  nationStrength,
  positionGroup,
  rateRole,
  round1,
  stochasticRound,
  tournamentInSeason,
  trophyName,
} from './util'

const PODIUM_AWARDS = new Set<AwardId>(['ballon_dor', 'the_best', 'golden_boot', 'golden_glove', 'kopa'])

/** Faixa de delta do Copero (`rl`). */
export function deltaBucket(delta: number): number {
  if (delta >= 10) return 0
  if (delta >= 6) return 1
  if (delta >= 3) return 2
  if (delta >= -2) return 3
  if (delta >= -5) return 4
  if (delta >= -9) return 5
  return 6
}

/** Fator de qualidade do Copero (`Yt`). */
export function qualityFactor(ovr: number): number {
  const o = clamp(ovr, 40, 99)
  if (o <= 65) return 0.6
  if (o <= 80) return 0.6 + ((o - 65) / 15) * 0.25
  if (o <= 85) return 0.85 + ((o - 80) / 5) * 0.15
  if (o <= 95) return 1 + ((o - 85) / 10) * 0.1
  return 1.1
}

const ROLE_BOOST: Record<SquadRole, number> = { starter: 1, high_rotation: 0.5, low_rotation: 0.2, substitute: 0, third_keeper: 0 }

/** Quanto o jogador soma à força do clube (estrela titular a +8 ⇒ ~3,6; reserva ⇒ 0). */
export function clubBoost(delta: number, role: SquadRole): number {
  return clamp(Math.max(0, delta + 1.5) * 0.38 * ROLE_BOOST[role], 0, 6)
}

/** Torneio de seleções (Copa do Mundo ou continental da confederação) que termina nesta temporada. */
export function nationalCompetitionIn(data: GameData, country: Country | undefined, season: number): Competition | undefined {
  if (!country) return undefined
  return data.competitions.find(
    (c) => !!c.schedule && (c.kind === 'world_cup' || (c.kind === 'national_continental' && c.confed === country.confed)) && tournamentInSeason(c, season),
  )
}

/** Estadual ou supercopa. */
function isMinor(c: Competition | undefined): boolean {
  return !!c && (!!c.region || !!c.superCup)
}

export interface SeasonInput {
  world: WorldEngine
  data: GameData
  /** Estado já clonado (é mutado). */
  s: CareerState
  seasonIdx: number
  periodSeasons: number
  log: CareerLogEntry[]
}

function statsFor(
  r: ReturnType<typeof rng>,
  rr: RateRole,
  apps: number,
  delta: number,
  ovr: number,
  factor: number,
  cap: { goals: number; assists: number },
): { goals: number; assists: number } {
  if (apps <= 0) return { goals: 0, assists: 0 }
  const b = deltaBucket(delta)
  const noise = r.range(0.9, 1.1)
  const q = qualityFactor(ovr)
  const g = apps * GOAL_RATES[rr][b] * factor * noise * q
  const a = apps * ASSIST_RATES[rr][b] * factor * noise * q
  return {
    goals: Math.max(0, Math.min(stochasticRound(g, r.next()), cap.goals)),
    assists: Math.max(0, Math.min(stochasticRound(a, r.next()), cap.assists)),
  }
}

function rating(
  apps: number,
  delta: number,
  role: SquadRole,
  rr: RateRole,
  st: { goals: number; assists: number; cleanSheets?: number; conceded?: number },
  champion: boolean,
  noise: number,
): number {
  if (apps <= 0) return 0
  let v = 6.3 + clamp(delta, -15, 15) * 0.04 + (role === 'starter' ? 0.2 : 0)
  if (rr === 'goalkeeper') {
    v += ((st.cleanSheets ?? 0) / apps) * 1.6 - Math.max(0, (st.conceded ?? 0) / apps - 1) * 0.8
  } else {
    const w = rr === 'attacker' ? 1.4 : rr === 'creator' ? 1.6 : rr === 'support' ? 2.2 : 2.6
    v += ((st.goals + 0.7 * st.assists) / apps) * w
  }
  if (champion) v += 0.25
  return round1(clamp(v + noise, 5, 9.7))
}

const GOAL_MILESTONES = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
const APP_MILESTONES = [100, 300, 500, 700, 900, 1000]

export function playSeason(inp: SeasonInput): SeasonRecord {
  const { world: W, data, s, seasonIdx, periodSeasons, log } = inp
  const idx = indexData(data)
  const m = mem(s)
  const season = s.season
  const age = s.age
  const clubId = s.clubId
  if (!clubId) throw new Error('Temporada sem clube.')
  const club = idx.club.get(clubId)
  const w0 = s.world
  const strength = club ? clubStrength(w0, club) : 60
  const leagueId0 = club ? clubLeagueId(w0, club) : ''
  const position = s.identity.position
  const isGK = position === 'GOL'
  const rr = rateRole(position)
  const group = positionGroup(position)
  const suspended = (s.modifiers.suspendedSeasons ?? 0) > 0
  const effOvr = s.ovr + (s.modifiers.tempOvr ?? 0)
  const delta = effOvr - strength
  const ovrStart = s.ovr
  const key = (k: string) => rng(s.seed, 'season', season, k)
  const before = totalsOf(s)

  // ── papel ──
  const ov = s.modifiers.roleOverride
  const ovActive = !!ov && (m.period.roleOverrideSeasons === undefined || seasonIdx < m.period.roleOverrideSeasons)
  const role: SquadRole = ovActive ? normalizeRole(ov!, isGK) : shiftRole(roleFromDelta(delta, isGK), isGK, m.period.roleShift)
  const zeroApps = (m.period.zeroAppsSeasons ?? 0) > seasonIdx

  // ── seleção ──
  const nat = s.identity.nationality
  const country = idx.country.get(nat)
  const tourney = nationalCompetitionIn(data, country, season)
  let calledUp = false
  let natRole: 'starter' | 'rotation' | 'reserve' = 'reserve'
  if (country && !suspended && !m.nationalRetired && age >= 17) {
    const better = w0.rivals.filter(
      (rv) => !rv.retired && rv.nationality === nat && positionGroup(rv.position) === group && rv.ovr > effOvr,
    ).length
    const eligible = effOvr >= country.callUpOvr && better < NATIONAL_SLOTS[group]
    calledUp = eligible
    if (m.period.national && tourney) calledUp = m.period.national === 'force' ? true : false
    if (eligible) natRole = better < (isGK ? 1 : 3) ? 'starter' : better < (isGK ? 2 : 5) ? 'rotation' : 'reserve'
  }
  const nStrength = nationStrength(data, w0, nat)

  // ── contexto para o mundo ──
  const playing = !suspended && !zeroApps
  let boost = playing ? clubBoost(delta, role) : 0
  boost = clamp(boost + m.period.boostAdj, -4, 7)
  const natBoost = calledUp
    ? clamp(Math.max(0, effOvr - nStrength + 2) * 0.3 * (natRole === 'starter' ? 1 : natRole === 'rotation' ? 0.4 : 0), 0, 4) + (m.period.nationalBoost ?? 0)
    : 0
  let forceTrophy: UserSeasonContext['forceTrophy']
  const ft = s.modifiers.forceTrophy
  if (ft) {
    const nationalKind = ft.competitionKind === 'world_cup' || ft.competitionKind === 'national_continental'
    const now = nationalKind ? !!tourney && tourney.kind === ft.competitionKind : true
    if (now) {
      forceTrophy = { kind: ft.competitionKind, chance: ft.chance }
      s.modifiers.forceTrophy = undefined
    }
  }
  const ctx: UserSeasonContext = {
    clubId,
    nationalTeam: calledUp ? nat : null,
    clubStrengthBoost: round1(boost),
    nationalStrengthBoost: round1(natBoost),
    priority: s.modifiers.priority,
    forceTrophy,
    suspended: suspended || undefined,
  }

  // ── mundo ──
  const sim = W.simulateSeason(data, w0, ctx)
  const summary = W.clubSeason(sim.result, data, clubId)
  const leagueId = summary.leagueId || leagueId0
  const league = idx.league.get(leagueId)
  const matches = summary.matches > 0 ? summary.matches : FALLBACK_MATCHES

  // ── números no clube ──
  const rs = key('stats')
  const share = (isGK ? APP_SHARE_GK : APP_SHARE)[role]
  let frac = rs.range(share[0], share[1])
  if (age === 16) frac *= 0.6 // primeira temporada: poucos jogos, como no Copero
  const apps = playing ? Math.round(matches * frac) : 0
  const gf = summary.goalsFor > 0 ? summary.goalsFor : matches * 1.4
  const attack = clamp(gf / matches / 1.6, 0.6, 1.4)
  const lc = 0.7 + 0.3 * (league?.coefficient ?? 0.6)
  const appShare = apps / matches
  const { goals, assists } = statsFor(rs, rr, apps, delta, effOvr, attack * lc * m.period.statsMult, {
    goals: Math.round(gf * appShare * 0.5),
    assists: Math.round(gf * appShare * 0.4),
  })
  const stats: SeasonStats = { apps, goals, assists, rating: 0, minutes: apps * AVG_MINUTES[role] }
  if (isGK) {
    const gkf = clamp(1 - delta * 0.015, 0.8, 1.2)
    const ga = summary.goalsAgainst > 0 ? summary.goalsAgainst : matches * 1.1
    const cs = summary.cleanSheets >= 0 ? summary.cleanSheets : matches * 0.3
    stats.conceded = Math.max(0, Math.round(ga * appShare * rs.range(0.92, 1.08) * gkf))
    stats.cleanSheets = Math.min(apps, Math.max(0, Math.round(cs * appShare * rs.range(0.9, 1.1) * (2 - gkf))))
  }
  stats.rating = rating(apps, delta, role, rr, stats, summary.leagueChampion, rs.normal(0, 0.15))

  // ── seleção: números ──
  let national: SeasonRecord['national']
  let nationTrophy: TrophyWin | null = null
  let natTournament: UserAwardEntry['nationalTournament']
  if (calledUp) {
    const ns = W.nationSeason(sim.result, nat)
    const rn = key('national')
    const range = natRole === 'starter' ? [0.65, 0.95] : natRole === 'rotation' ? [0.35, 0.6] : [0.1, 0.3]
    const nm = ns.matches > 0 ? ns.matches : 8
    const napps = Math.max(1, Math.round(nm * rn.range(range[0], range[1])))
    const nd = effOvr - nStrength
    const ng = statsFor(rn, rr, napps, nd, effOvr, 0.6 * m.period.statsMult, { goals: Math.round(Math.max(ns.goalsFor, 1) * 0.6), assists: Math.round(Math.max(ns.goalsFor, 1) * 0.5) })
    national = { apps: napps, goals: ng.goals, assists: ng.assists }
    if (ns.tournament) {
      national.tournament = { competitionId: ns.tournament.competitionId, reached: ns.tournament.reached }
      natTournament = { competitionId: ns.tournament.competitionId, reached: ns.tournament.reached, goals: ng.goals }
      s.national.tournaments.push({ competitionId: ns.tournament.competitionId, year: season + 1, reached: ns.tournament.reached, apps: napps, goals: ng.goals })
      if (ns.tournament.champion)
        nationTrophy = {
          trophyId: ns.tournament.trophyId,
          competitionId: ns.tournament.competitionId,
          season,
          teamId: nat,
          scope: 'national',
          kind: competitionKind(data, ns.tournament.competitionId) ?? 'national_continental',
          confed: country?.confed,
        }
    }
    if (s.national.firstCallUp === undefined) {
      s.national.firstCallUp = season
      log.push({ season, age, type: 'call_up', text: `Primeira convocação: seleção de ${country?.name ?? nat}.` })
    }
    s.national.apps += napps
    s.national.goals += ng.goals
    s.national.assists += ng.assists
  }

  // ── títulos ──
  const trophies: TrophyWin[] = []
  const confed = club ? clubConfed(data, club) : undefined
  if (!suspended) {
    for (const t of summary.titles) {
      const lg = idx.league.get(t.competitionId)
      trophies.push({
        trophyId: t.trophyId,
        competitionId: t.competitionId,
        season,
        teamId: clubId,
        scope: 'club',
        kind: t.kind,
        confed: idx.competition.get(t.competitionId)?.confed ?? lg?.confed ?? confed,
        tier: t.kind === 'league' ? lg?.tier ?? summary.tier : undefined,
        minor: isMinor(idx.competition.get(t.competitionId)) || undefined,
      })
    }
    if (nationTrophy) {
      trophies.push(nationTrophy)
      s.national.trophies.push(nationTrophy)
    }
  }

  // ── prêmios ──
  let world = sim.world
  const awards: AwardWin[] = []
  if (!suspended) {
    const entry: UserAwardEntry = {
      name: s.identity.surname,
      nationality: nat,
      position,
      clubId,
      leagueId,
      // longe dos holofotes (Arábia/MLS): os votantes enxergam menos
      ovr: effOvr - (m.farFromSpotlight ? 4 : 0),
      age,
      role,
      apps,
      goals: goals + (national?.goals ?? 0),
      assists: assists + (national?.assists ?? 0),
      cleanSheets: stats.cleanSheets,
      titles: trophies.map((t) => t.competitionId),
      nationalTournament: natTournament,
    }
    const res = W.computeAwards(data, world, season, entry)
    world = res.world
    for (const a of res.awards) {
      let place = 0
      if (a.winner.isUser) place = 1
      else {
        const i = a.ranking.findIndex((e) => e.isUser)
        if (i >= 0) place = a.award === 'team_of_the_year' ? 1 : i + 1
      }
      if (!place) continue
      if (PODIUM_AWARDS.has(a.award) ? place <= 3 : place === 1) awards.push({ award: a.award, year: a.year, place: place as 1 | 2 | 3, leagueId: a.leagueId })
    }
  }

  // ── desenvolvimento ──
  const rd = key('dev')
  if (!m.devCycle || m.devCycle.targetAge !== cycleTarget(age)) m.devCycle = rollCycle(rd, age, s.devProfile, position, role)
  let part = m.devCycle.parts[m.devCycle.next]
  m.devCycle = m.devCycle.next === 0 ? { ...m.devCycle, next: 1 } : null
  if (suspended && part > 0) part = 0
  if (part < 0 && m.declineFactor < 1) part = -stochasticRound(Math.abs(part) * m.declineFactor, rd.next())
  // bônus do LENDA: jovem (18–23) que brilha ou ganha títulos jogando evolui um pouco mais
  let bonus = 0
  const bigTitle = trophies.some((t) => !t.minor && (t.kind === 'league' || t.kind === 'continental_primary' || t.kind === 'world_cup' || t.kind === 'national_continental'))
  if (age >= 18 && age <= 23 && apps > 0 && (stats.rating >= 7.5 || (bigTitle && isPlayingRole(role))) && rd.chance(0.2)) bonus = 1
  s.ovr = clampOvr(s.ovr + part + bonus)

  // OVR temporário devolvido depois desta temporada (ou no fim do período)
  const last = seasonIdx === periodSeasons - 1 || age + 1 >= 40
  const keep: typeof m.deferred = []
  for (const d of m.deferred) {
    const due = d.afterSeasons !== undefined ? seasonIdx + 1 >= d.afterSeasons : last
    if (due || last) s.ovr = clampOvr(s.ovr + d.delta)
    else keep.push(d)
  }
  m.deferred = keep

  // ── valor de mercado ──
  const value = marketValue(key('value'), s.ovr, age + 1, league?.coefficient ?? 0.5, m.period.valueMult)
  s.marketValue = value

  // ── capitania ──
  if (!m.loan && role === 'starter' && age >= 26 && m.seasonsAtClub >= 5 && m.captainAt !== clubId) m.captainAt = clubId
  const captain = m.captainAt === clubId && !m.loan

  const record: SeasonRecord = {
    season,
    age,
    clubId,
    leagueId,
    tier: summary.tier ?? league?.tier ?? 1,
    loan: !!m.loan,
    period: s.period,
    role,
    ovrStart,
    ovrEnd: s.ovr,
    marketValue: value,
    stats,
    leaguePosition: summary.position || undefined,
    trophies,
    awards,
    country: club?.country,
    confed,
    nationality: nat,
    position,
    clubPrestige: club ? clubPrestige(w0, club) : undefined,
  }
  if (summary.promoted) record.promoted = true
  if (summary.relegated) record.relegated = true
  if (suspended) record.suspended = true
  if (seasonIdx === 0 && m.period.injury) record.injury = m.period.injury
  if (national) record.national = national
  if (captain) record.captain = true

  // ── log ──
  const cname = club?.shortName ?? club?.name ?? clubId
  for (const t of trophies)
    log.push({ season, age, type: 'trophy', text: `Campeão: ${trophyName(data, t.trophyId, t.competitionId)} (${t.scope === 'club' ? cname : country?.name ?? nat}).`, data: { trophyId: t.trophyId } })
  for (const a of awards) log.push({ season, age, type: 'award', text: awardText(a), data: { award: a.award, place: a.place } })
  if (record.promoted) log.push({ season, age, type: 'promotion', text: `Acesso com o ${cname}!` })
  if (record.relegated) log.push({ season, age, type: 'relegation', text: `Rebaixamento com o ${cname}.` })
  s.seasons.push(record)
  const after = totalsOf(s)
  for (const g of GOAL_MILESTONES) if (before.goals < g && after.goals >= g) log.push({ season, age, type: 'milestone', text: `${g} gols na carreira!` })
  for (const g of APP_MILESTONES) if (before.apps < g && after.apps >= g) log.push({ season, age, type: 'milestone', text: `${g} jogos na carreira!` })

  // ── avança ──
  s.world = world
  s.age = age + 1
  s.season = season + 1
  if ((s.modifiers.suspendedSeasons ?? 0) > 0) s.modifiers.suspendedSeasons = (s.modifiers.suspendedSeasons ?? 1) - 1
  m.seasonsAtClub++
  return record
}

export const AWARD_NAMES: Record<AwardId, string> = {
  ballon_dor: 'Bola de Ouro',
  golden_boot: 'Chuteira de Ouro',
  golden_glove: 'Luva de Ouro',
  the_best: 'The Best da FIFA',
  kopa: 'Troféu Kopa',
  league_top_scorer: 'Artilharia da liga',
  league_best_player: 'Craque da liga',
  wc_golden_ball: 'Bola de Ouro da Copa',
  wc_golden_boot: 'Chuteira de Ouro da Copa',
  puskas: 'Prêmio Puskás',
  team_of_the_year: 'Seleção do ano',
}

function awardText(a: AwardWin): string {
  const name = AWARD_NAMES[a.award]
  if (a.place === 1) return `Venceu: ${name} ${a.year}.`
  return `${a.place}º lugar: ${name} ${a.year}.`
}

/** Totais de carreira (clube + seleção), como o cabeçalho do Copero. */
export function totalsOf(s: CareerState): { apps: number; goals: number; assists: number; cleanSheets: number } {
  let apps = s.national.apps
  let goals = s.national.goals
  let assists = s.national.assists
  let cleanSheets = 0
  for (const r of s.seasons) {
    apps += r.stats.apps
    goals += r.stats.goals
    assists += r.stats.assists
    cleanSheets += r.stats.cleanSheets ?? 0
  }
  return { apps, goals, assists, cleanSheets }
}
