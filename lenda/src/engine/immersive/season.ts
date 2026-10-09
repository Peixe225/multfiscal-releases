/**
 * Laço da temporada no Modo Imersivo.
 *
 *   startSeason  → pré-simula o mundo (sem consolidar) com `collectUserFixtures` para descobrir a
 *                  agenda do clube/seleção + a liga rodada a rodada; monta o calendário.
 *   resim        → depois de cada FASE de copa/continental/torneio concluída, pré-simula de novo com
 *                  os resultados fixos até aqui (o caminho na copa pode ter mudado) e refaz o calendário.
 *   endSeason    → simula a temporada de verdade com TODOS os resultados fixos, consolida o mundo,
 *                  calcula prêmios com os números reais do jogador, grava a SeasonRecord (formato do
 *                  Clássico), aplica evolução (idade + treino + minutos + fase), valor e contrato.
 *   startNextSeason → envelhece, devolve empréstimo, aposenta aos 40, abre a próxima temporada.
 */
import type { UserAwardEntry, UserSeasonContext, WorldEngine } from '../api'
import { rng as subRng } from '../rng'
import type { AwardId, AwardResult, AwardWin, GameData, SeasonRecord, SquadRole, TrophyWin, UserFixture } from '../types'
import { detectAchievements } from '../career/achievements'
import { positionGroup } from '../career/util'
import { buildCalendar, matchdayOrder, mergeCalendar, placeFixtures, snapshotWeek, type CalKind } from './calendar'
import type { ImmersiveEffect, ImmersiveState } from './types'
import { mem, type Fx } from './mem'
import { signContract } from './offers'
import { addInbox, addNews } from './media'
import {
  applyDecline,
  applyGrowth,
  declineRate,
  growthRate,
  isGK,
  marketValueOf,
  ovrOf,
  potentialFactor,
  scoutPotential,
} from './player'
import { shadowCareer } from './shadow'
import { artigo, clamp, clubLeagueId, clubOf, clubPrestige, compOf, countryArt, countryOf, do_, irng, ix, leagueById, no, r1 } from './util'

const PODIUM_AWARDS = new Set<AwardId>(['ballon_dor', 'the_best', 'golden_boot', 'golden_glove', 'kopa'])

export function userCtx(s: ImmersiveState, collect: boolean): UserSeasonContext {
  const m = mem(s)
  const ctx: UserSeasonContext = {
    clubId: s.clubId,
    nationalTeam: s.identity.nationality,
    clubStrengthBoost: 0,
    nationalStrengthBoost: 0,
    fixedResults: m.fixed,
    immersiveRules: true,
  }
  if (m.priority && s.season <= (m.priorityUntil ?? s.season)) ctx.priority = m.priority
  if (collect) {
    ctx.collectUserFixtures = true
    ctx.agendaOnly = true
  }
  return ctx
}

function compact(f: UserFixture): Fx {
  const o: Fx = {
    key: f.key,
    competitionId: f.competitionId,
    kind: f.kind,
    stage: f.stage,
    home: f.home,
    away: f.away,
    opponent: f.opponent,
    userHome: f.userHome,
    score: f.score,
    strength: f.strength,
    seq: f.seq,
  }
  if (f.round) o.round = f.round
  if (f.neutral) o.neutral = true
  if (f.knockout) o.knockout = true
  if (f.leg) o.leg = f.leg
  if (f.legs) o.legs = f.legs
  if (f.extraTime !== undefined) o.extraTime = f.extraTime
  if (f.seedAdvancesOnDraw) o.seedAdvancesOnDraw = true
  if (f.userSeed !== undefined) o.userSeed = f.userSeed
  if (f.pens) o.pens = f.pens
  if (f.prior) o.prior = f.prior
  return o
}

/** Pré-simulação (não consolida o mundo). `withLeague` = guarda a liga rodada a rodada. */
export function preSim(W: WorldEngine, data: GameData, s: ImmersiveState, withLeague: boolean): void {
  const m = mem(s)
  const { result } = W.simulateSeason(data, s.world, userCtx(s, true))
  m.agenda = (result.userFixtures ?? []).map(compact)
  m.natAgenda = (result.userNationalFixtures ?? []).map(compact)
  if (withLeague) {
    m.league = result.userLeague
    m.matchday = matchdayOrder(m.league, data)
  }
  m.lastResim = m.tick
}

function isFirstWorldSeason(data: GameData, s: ImmersiveState): boolean {
  return Object.keys(s.world.seasons).length === 0 && s.world.nextSeason === ix(data).firstSeason
}

export function calKindFor(data: GameData, s: ImmersiveState): CalKind {
  const lg = leagueById(data, clubLeagueId(s.world, data, s.clubId))
  if (lg) return lg.calendar === 'split' ? 'split' : 'calendar'
  const conf = countryOf(data, s.identity.nationality)?.confed
  return conf === 'UEFA' ? 'split' : 'calendar'
}

/** Zera a memória da temporada. */
function resetSeasonMemory(s: ImmersiveState) {
  const m = mem(s)
  m.fixed = {}
  m.agenda = []
  m.natAgenda = []
  m.league = undefined
  m.matchday = undefined
  m.natSeason = { apps: 0, goals: 0, assists: 0, tournamentGoals: 0 }
  m.spans = s.clubId ? [{ clubId: s.clubId, comps: [], apps: 0, loan: !!m.loan }] : []
  m.lastLeaguePos = undefined
  m.seasonStartOvr = s.ovr
  m.seasonInjury = undefined
  m.physicalWeeks = 0
  m.trainingWeeks = 0
  m.storiesThisSeason = 0
  m.natTournament = undefined
  m.natCalled = false
  m.clubMatches = 0
  m.live = undefined
  m.pendingAwards = undefined
  m.seasonConceded = 0
  m.eliminated = []
  m.resims = 0
  m.slots = {}
  m.leagueGoals = 0
  m.paidWeeks = 0
  s.seasonStats = { apps: 0, starts: 0, minutes: 0, goals: 0, assists: 0, cleanSheets: 0, ratingSum: 0, motm: 0 }
  // a rede social vira a página: posts de torcedores e veículos da temporada passada saem (os seus ficam)
  s.social = s.social.filter((p) => p.season >= s.season || p.byUser)
}

export function startSeason(W: WorldEngine, data: GameData, s: ImmersiveState): void {
  const m = mem(s)
  resetSeasonMemory(s)
  m.calKind = calKindFor(data, s)
  const first = isFirstWorldSeason(data, s)
  m.startWeek = first ? snapshotWeek(m.calKind, data.generatedAt, s.season) : 0
  s.week = m.startWeek
  s.leagueId = clubLeagueId(s.world, data, s.clubId) ?? null
  if (s.clubId) preSim(W, data, s, true)
  s.calendar = buildCalendar(data, s)
  s.cursor = 0
  m.seasonTrainingWeeks = s.calendar.filter((it) => it.kind === 'training').length
}

/** Posição (semana·1000 + ordem) do item atual. */
export function currentPos(s: ImmersiveState): number {
  const it = s.calendar[s.cursor]
  return it ? it.week * 1000 + it.order : s.week * 1000
}

export function rebuildCalendar(data: GameData, s: ImmersiveState, pos = currentPos(s)): void {
  s.calendar = mergeCalendar(s.calendar, buildCalendar(data, s, pos), pos)
  const i = s.calendar.findIndex((it) => !it.done)
  s.cursor = i < 0 ? s.calendar.length : i
}

/**
 * Nova pré-simulação com os resultados fixos até aqui + calendário refeito. `withLeague` também
 * atualiza a liga rodada a rodada (fim de um torneio de Apertura/Clausura).
 */
export function resim(W: WorldEngine, data: GameData, s: ImmersiveState, pos = currentPos(s), withLeague = false): void {
  const m = mem(s)
  m.resims = (m.resims ?? 0) + 1
  preSim(W, data, s, withLeague && !!m.league)
  rebuildCalendar(data, s, pos)
}

const isRegular = (f: Fx) => f.kind === 'league' && !!f.round && !f.leg

function calKindOfClub(data: GameData, s: ImmersiveState, clubId: string): CalKind {
  const lg = leagueById(data, clubLeagueId(s.world, data, clubId))
  if (lg) return lg.calendar === 'split' ? 'split' : 'calendar'
  return calKindFor(data, s)
}

/** Semana equivalente (mesma data) no calendário do outro tipo; pode ser negativa. */
function convWeek(from: CalKind, to: CalKind, w: number): number {
  const d0 = (k: CalKind) => (k === 'split' ? 200 : 5)
  return Math.floor((d0(from) + 7 * w - d0(to)) / 7)
}

/**
 * Dá para jogar pelo clube novo ainda nesta temporada do mundo? Não quando o calendário é de outro
 * tipo e a liga dele já acabou (ex.: Europa → Brasil em dezembro): a transferência fica para a
 * pré-temporada seguinte. Pré-simula o clube novo e desfaz tudo.
 */
export function canJoinNow(W: WorldEngine, data: GameData, s: ImmersiveState, clubId: string): boolean {
  const m = mem(s)
  const newKind = calKindOfClub(data, s, clubId)
  if (newKind === m.calKind || !s.clubId) return true
  const saved = { clubId: s.clubId, leagueId: s.leagueId, week: s.week, calKind: m.calKind, startWeek: m.startWeek, agenda: m.agenda, natAgenda: m.natAgenda, league: m.league, matchday: m.matchday, lastResim: m.lastResim }
  const week = Math.max(0, convWeek(m.calKind, newKind, s.week))
  const p = week * 1000 + 999
  s.clubId = clubId
  m.startWeek = m.startWeek > 0 ? Math.max(0, convWeek(m.calKind, newKind, m.startWeek)) : 0
  m.calKind = newKind
  s.week = week
  preSim(W, data, s, true)
  const placed = placeFixtures(data, s, m.agenda, [])
  const league = m.agenda.filter(isRegular)
  const ahead = league.filter((f) => {
    const at = placed.get(f.key)
    return !at || at.week * 1000 + at.order > p
  })
  s.clubId = saved.clubId
  s.leagueId = saved.leagueId
  s.week = saved.week
  m.calKind = saved.calKind
  m.startWeek = saved.startWeek
  m.agenda = saved.agenda
  m.natAgenda = saved.natAgenda
  m.league = saved.league
  m.matchday = saved.matchday
  m.lastResim = saved.lastResim
  return !league.length || ahead.length >= 3
}

/**
 * Troca de clube no meio da temporada (janela ou evento): os jogos do clube novo que já
 * "aconteceram" ficam fixos no placar da pré-simulação; o calendário segue do ponto atual.
 */
export function transferNow(W: WorldEngine, data: GameData, s: ImmersiveState, clubId: string): void {
  const m = mem(s)
  const pos = currentPos(s)
  const oldKind = m.calKind
  s.clubId = clubId
  const newKind = calKindFor(data, s)
  let week = s.week
  let p = pos
  if (newKind !== oldKind) {
    // converte a semana atual para o calendário do clube novo (mesma temporada do mundo); os itens
    // já jogados mantêm mês/ano (a semana é só para ordenar)
    const conv = (w: number) => Math.max(0, convWeek(oldKind, newKind, w))
    week = conv(s.week)
    p = week * 1000 + 999
    for (const it of s.calendar) if (it.done) it.week = Math.min(week, conv(it.week))
    if (m.startWeek > 0) m.startWeek = conv(m.startWeek)
  }
  m.leagueGoals = 0
  // eliminações e posições gravadas eram do clube antigo
  m.eliminated = []
  m.calKind = newKind
  s.week = week
  s.leagueId = clubLeagueId(s.world, data, clubId) ?? null
  preSim(W, data, s, true)
  const placed = placeFixtures(data, s, m.agenda, [])
  for (const f of m.agenda) {
    const at = placed.get(f.key)
    if (at && at.week * 1000 + at.order <= p && !m.fixed[f.key]) m.fixed[f.key] = f.pens ? { score: f.score, pens: f.pens } : { score: f.score }
  }
  if (!m.spans.some((x) => x.clubId === clubId)) m.spans.push({ clubId, comps: [], apps: 0, loan: !!m.loan })
  m.lastLeaguePos = undefined
  // itens futuros do clube antigo saem (merge só mantém os concluídos); os do novo entram
  s.calendar = mergeCalendar(s.calendar, buildCalendar(data, s), p)
  const i = s.calendar.findIndex((it) => !it.done)
  s.cursor = i < 0 ? s.calendar.length : i
}

// ───────────────────────── fim da temporada ─────────────────────────

function roleFromShare(s: ImmersiveState): SquadRole {
  const m = mem(s)
  const ss = s.seasonStats
  const total = Math.max(1, m.clubMatches)
  const starts = ss.starts / total
  if (isGK(s.identity.position)) return starts >= 0.5 ? 'starter' : ss.apps > 0 ? 'substitute' : 'third_keeper'
  if (starts >= 0.6) return 'starter'
  if (starts >= 0.35 || ss.apps / total >= 0.6) return 'high_rotation'
  if (ss.apps / total >= 0.25) return 'low_rotation'
  return 'substitute'
}

function isMinorComp(data: GameData, id: string): boolean {
  const c = compOf(data, id)
  return !!c && (!!c.region || !!c.superCup)
}

export interface SeasonEndResult {
  record: SeasonRecord
  trophies: TrophyWin[]
  awards: AwardResult[]
}

export function endSeason(W: WorldEngine, data: GameData, s: ImmersiveState, fx: ImmersiveEffect[]): SeasonEndResult {
  const m = mem(s)
  const season = s.season
  const clubId = s.clubId
  const sim = W.simulateSeason(data, s.world, userCtx(s, false))
  let world = sim.world
  const club = clubOf(data, clubId)
  const summary = clubId ? W.clubSeason(sim.result, data, clubId) : null
  const nat = s.identity.nationality
  const country = countryOf(data, nat)
  const ss = s.seasonStats
  const role = roleFromShare(s)
  const idxd = ix(data)

  // ── títulos ──
  const trophies: TrophyWin[] = []
  const suspendedAll = ss.apps === 0 && (s.condition.suspendedMatches ?? 0) > 0
  const addClubTitles = (cid: string, filterComps?: string[]) => {
    const sum = W.clubSeason(sim.result, data, cid)
    for (const t of sum.titles) {
      if (filterComps && !filterComps.includes(t.competitionId)) continue
      const lg = idxd.league.get(t.competitionId)
      const comp = idxd.comp.get(t.competitionId)
      trophies.push({
        trophyId: t.trophyId,
        competitionId: t.competitionId,
        season,
        teamId: cid,
        scope: 'club',
        kind: t.kind,
        confed: comp?.confed ?? lg?.confed ?? idxd.league.get(clubOf(data, cid)?.leagueId ?? '')?.confed,
        tier: t.kind === 'league' ? (lg?.tier ?? sum.tier) : undefined,
        minor: isMinorComp(data, t.competitionId) || undefined,
      })
    }
  }
  // títulos: só das competições em que o jogador entrou em campo (clube atual e anteriores)
  if (!suspendedAll) for (const span of m.spans) if (span.apps > 0) addClubTitles(span.clubId, span.comps)
  let national: SeasonRecord['national']
  let natTournament: UserAwardEntry['nationalTournament']
  if (m.natSeason.apps > 0) {
    national = { apps: m.natSeason.apps, goals: m.natSeason.goals, assists: m.natSeason.assists }
    const ns = W.nationSeason(sim.result, nat)
    if (ns.tournament && m.natTournament?.called) {
      national.tournament = { competitionId: ns.tournament.competitionId, reached: ns.tournament.reached }
      natTournament = { competitionId: ns.tournament.competitionId, reached: ns.tournament.reached, goals: m.natSeason.tournamentGoals }
      s.national.tournaments.push({ competitionId: ns.tournament.competitionId, year: season + 1, reached: ns.tournament.reached, apps: m.natSeason.tournamentApps ?? 0, goals: m.natSeason.tournamentGoals })
      if (ns.tournament.champion) {
        const tw: TrophyWin = {
          trophyId: ns.tournament.trophyId,
          competitionId: ns.tournament.competitionId,
          season,
          teamId: nat,
          scope: 'national',
          kind: compOf(data, ns.tournament.competitionId)?.kind ?? 'national_continental',
          confed: country?.confed,
        }
        trophies.push(tw)
        s.national.trophies.push(tw)
      }
    }
  }

  // ── prêmios ──
  const awards: AwardWin[] = []
  let awardResults: AwardResult[] = []
  if (!suspendedAll) {
    const entry: UserAwardEntry = {
      name: s.identity.surname,
      nationality: nat,
      position: s.identity.position,
      clubId,
      leagueId: summary?.leagueId ?? null,
      ovr: s.ovr - (m.farFromSpotlight ? 4 : 0),
      age: s.age,
      role,
      apps: ss.apps,
      goals: ss.goals + m.natSeason.goals,
      assists: ss.assists + m.natSeason.assists,
      cleanSheets: isGK(s.identity.position) ? ss.cleanSheets : undefined,
      titles: trophies.map((t) => t.competitionId),
      nationalTournament: natTournament,
      leagueGoals: m.leagueGoals ?? undefined,
    }
    const res = W.computeAwards(data, world, season, entry)
    world = res.world
    awardResults = res.awards
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

  // ── evolução de fim de temporada (30% do crescimento + declínio) ──
  const ovrStart = m.seasonStartOvr
  const before = s.ovr
  const gk = isGK(s.identity.position)
  const r = irng(s, 'season-end', season)
  const minutesShare = ss.minutes / Math.max(1, m.clubMatches * 90)
  const playF = 0.5 + 0.8 * Math.min(1, minutesShare * 1.3)
  const avg = ss.apps ? ss.ratingSum / ss.apps : 6.2
  const ratingF = clamp(1 + (avg - 6.6) * 0.25, 0.7, 1.3)
  const grow = growthRate(s.age, m.profile, gk) * 0.3 * potentialFactor(s.ovr, m.truePotential) * playF * ratingF
  const ups = applyGrowth(s.attributes, s.identity.position, 'tactical', grow / 0.85, m.xp)
  const dec = declineRate(s.age, gk) * m.declineFactor * (1 - 0.3 * Math.min(1, m.physicalWeeks / 20))
  const downs = applyDecline(s.attributes, s.identity.position, dec, r)
  for (const u of [...ups, ...downs]) fx.push({ type: 'attribute_up', key: u.key, from: u.from, to: u.to })
  s.ovr = ovrOf(s.attributes, s.identity.position)
  if (s.ovr !== before) fx.push({ type: 'ovr_change', from: before, to: s.ovr })
  if (m.tempOvr && m.tempOvr.untilSeason <= season) m.tempOvr = undefined

  // ── valor, fama, capitania ──
  const league = leagueById(data, summary?.leagueId ?? s.leagueId)
  const bigTitles = trophies.filter((t) => !t.minor).length
  s.reputation = r1(clamp(s.reputation * 0.88 + Math.max(0, s.ovr - 55) * 0.25 + ss.goals * 0.1 * (league?.coefficient ?? 0.6) + bigTitles * 2.5 + awards.length * 3 + (national?.apps ?? 0) * 0.3, 0, 100))
  s.marketValue = marketValueOf({ ovr: s.ovr, age: s.age + 1, leagueCoefficient: league?.coefficient ?? 0.5, form: s.condition.form, reputation: s.reputation, potential: m.truePotential, mult: m.valueMult })
  s.potential = scoutPotential(m.truePotential, s.ovr, s.age + 1, r)
  if (clubId && !m.loan && role === 'starter' && s.age >= 26 && m.seasonsAtClub >= 5 && m.captainAt !== clubId) {
    m.captainAt = clubId
    s.captain = true
    addNews(s, `${s.identity.surname} é o novo capitão ${do_(club)} ${club?.shortName ?? 'clube'}`, 'positive', fx)
  }

  // ── linha da tabela ──
  const stats: SeasonRecord['stats'] = {
    apps: ss.apps,
    goals: ss.goals,
    assists: ss.assists,
    rating: ss.apps ? r1(ss.ratingSum / ss.apps) : 0,
    minutes: ss.minutes,
  }
  if (gk) {
    stats.cleanSheets = ss.cleanSheets
    stats.conceded = m.seasonConceded ?? 0
  }
  const record: SeasonRecord = {
    season,
    age: s.age,
    clubId: clubId ?? m.spans[0]?.clubId ?? s.seasons[s.seasons.length - 1]?.clubId ?? m.firstClubId ?? '',
    leagueId: summary?.leagueId ?? s.leagueId ?? '',
    tier: summary?.tier ?? league?.tier ?? 1,
    loan: !!m.loan,
    period: s.seasons.length,
    role,
    ovrStart,
    ovrEnd: s.ovr,
    marketValue: s.marketValue,
    stats,
    leaguePosition: summary?.position || undefined,
    trophies,
    awards,
    country: club?.country,
    confed: club ? (idxd.league.get(club.leagueId)?.confed ?? countryOf(data, club.country)?.confed) : undefined,
    nationality: nat,
    position: s.identity.position,
    clubPrestige: clubId ? clubPrestige(s.world, data, clubId) : undefined,
  }
  // temporada dividida (transferência/empréstimo no meio): a parte de cada clube, com a posição dele
  const played = m.spans.filter((x) => x.apps > 0)
  if (played.length > 1 || (played.length === 1 && played[0].clubId !== record.clubId)) {
    record.spans = played.map((x) => {
      const sp: NonNullable<SeasonRecord['spans']>[number] = { clubId: x.clubId, apps: x.apps, goals: x.goals ?? 0, assists: x.assists ?? 0, minutes: x.minutes ?? 0 }
      const lg = clubLeagueId(s.world, data, x.clubId)
      if (lg) sp.leagueId = lg
      if (x.loan) sp.loan = true
      const pos = x.clubId === clubId ? summary?.position : W.clubSeason(sim.result, data, x.clubId).position
      if (pos) sp.leaguePosition = pos
      return sp
    })
  }
  if (summary?.promoted) record.promoted = true
  if (summary?.relegated) record.relegated = true
  if (suspendedAll) record.suspended = true
  if (m.seasonInjury) record.injury = m.seasonInjury
  if (national) record.national = national
  if (s.captain && clubId === m.captainAt) record.captain = true
  s.seasons.push(record)
  s.trophies.push(...trophies)
  s.awards.push(...awards)
  s.world = world

  // ── log ──
  const cname = club?.shortName ?? clubId ?? ''
  for (const t of trophies) {
    const name = idxd.comp.get(t.competitionId)?.name ?? idxd.league.get(t.competitionId)?.name ?? t.competitionId
    s.log.push({ season, age: s.age, type: 'trophy', text: `Campeão: ${name} (${t.scope === 'club' ? teamLabel(data, t.teamId) : (country?.name ?? nat)}).`, data: { trophyId: t.trophyId } })
    fx.push({ type: 'trophy', trophy: t })
    s.finance.balance += s.finance.bonuses?.perTitle ?? 0
  }
  for (const a of awards) s.log.push({ season, age: s.age, type: 'award', text: `${a.place === 1 ? 'Venceu' : `${a.place}º lugar`}: ${AWARD_LABEL[a.award]} ${a.year}.`, data: { award: a.award, place: a.place } })
  if (record.promoted) s.log.push({ season, age: s.age, type: 'promotion', text: `Acesso com ${artigo(club)} ${cname}!` })
  if (record.relegated) s.log.push({ season, age: s.age, type: 'relegation', text: `Rebaixamento com ${artigo(club)} ${cname}.` })
  seasonNews(data, s, record, fx)
  fx.push({ type: 'season_end', record })
  m.pendingAwards = awardResults
    .filter((a) => a.award === 'ballon_dor' || a.winner.isUser || a.ranking.some((e) => e.isUser))
    .map((a) => ({ ...a, ranking: a.ranking.slice(0, 10) }))

  // ── conquistas ──
  const found = detectAchievements(shadowCareer(s))
  const fresh = found.filter((id) => !s.achievements.includes(id))
  s.achievements.push(...fresh)
  for (const id of fresh) fx.push({ type: 'achievement', id })
  m.seasonsAtClub++
  return { record, trophies, awards: awardResults }
}

/**
 * Manchetes do fim da temporada: títulos ("Brasileirão: Flamengo é campeão com Ribeiro"), acesso,
 * rebaixamento ou a posição final na liga.
 */
function seasonNews(data: GameData, s: ImmersiveState, record: SeasonRecord, fx: ImmersiveEffect[]): void {
  const idxd = ix(data)
  const me = s.identity.surname
  const champ = (art: string) => (art === 'a' ? 'campeã' : art === 'as' ? 'campeãs' : art === 'os' ? 'campeões' : 'campeão')
  for (const t of record.trophies) {
    const comp = idxd.league.get(t.competitionId)?.shortName ?? idxd.comp.get(t.competitionId)?.name ?? t.competitionId
    const team = clubOf(data, t.teamId)
    const name = team ? team.shortName || team.name : (countryOf(data, t.teamId)?.name ?? t.teamId)
    const art = team ? artigo(team) : countryArt(name)
    addNews(s, `${comp}: ${name} é ${champ(art)} com ${me}`, 'positive', fx, { clubId: team?.id })
  }
  const club = clubOf(data, record.clubId)
  if (!club || record.suspended) return
  const name = club.shortName || club.name
  if (record.relegated) addNews(s, `Rebaixamento: ${name} cai de divisão`, 'negative', fx, { aboutUser: false, clubId: club.id })
  else if (record.promoted) addNews(s, `Acesso: ${name} sobe de divisão`, 'positive', fx, { aboutUser: false, clubId: club.id })
  else if (record.leaguePosition && !record.trophies.some((t) => t.kind === 'league' && t.teamId === club.id))
    addNews(s, `${name} termina a temporada em ${record.leaguePosition}º lugar na liga`, record.leaguePosition <= 4 ? 'positive' : 'neutral', fx, { aboutUser: false, clubId: club.id })
}

export const AWARD_LABEL: Record<AwardId, string> = {
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

function teamLabel(data: GameData, id: string): string {
  return clubOf(data, id)?.shortName ?? countryOf(data, id)?.name ?? id
}

/** Entre temporadas: envelhece, empréstimo, contrato, aposentadoria aos 40 e próxima temporada. */
export function startNextSeason(W: WorldEngine, data: GameData, s: ImmersiveState, fx: ImmersiveEffect[]): void {
  const m = mem(s)
  const season = s.season
  s.season = season + 1
  s.age = s.age + 1
  s.week = 0
  if (s.age >= 40) {
    retireNow(s, 'retirement_age', fx)
    return
  }
  // empréstimo termina
  if (m.loan && m.loan.untilSeason <= season) {
    const parent = m.loan.parentClubId
    const loanClub = s.clubId
    if (m.loan.parentSalary) s.finance.salary = m.loan.parentSalary
    m.loan = undefined
    s.clubId = parent
    s.parentClubId = undefined
    m.seasonsAtClub = 0
    s.log.push({ season: s.season, age: s.age, type: 'loan_ended', text: `Fim do empréstimo. De volta: ${teamLabel(data, parent)}.`, data: { parentClubId: parent, loanClubId: loanClub } })
    if (s.finance.contractUntil <= season) {
      // o contrato com o clube dono acabou durante o empréstimo: não há para onde voltar
      const pc = clubOf(data, parent)
      s.log.push({ season: s.season, age: s.age, type: 'decision', text: `Contrato com ${artigo(pc)} ${teamLabel(data, parent)} encerrado durante o empréstimo. Livre no mercado.` })
      addInbox(s, 'Seu empresário', 'Você está livre no mercado', `Seu contrato com ${artigo(pc)} ${teamLabel(data, parent)} terminou durante o empréstimo. Vou buscar propostas — fique de olho na caixa de entrada.`)
      s.clubId = null
      s.captain = false
      m.captainAt = null
    } else addInbox(s, 'Diretoria', 'De volta para casa', `O empréstimo acabou. Você se reapresenta ${no(clubOf(data, parent))} ${teamLabel(data, parent)} para a pré-temporada.`)
  } else if (s.clubId && s.finance.contractUntil <= season) {
    // contrato acabou sem renovação (emprestado: o contrato que acabou é o do clube dono)
    const old = m.loan?.parentClubId ?? s.clubId
    s.log.push({ season: s.season, age: s.age, type: 'decision', text: `Contrato com ${artigo(clubOf(data, old))} ${teamLabel(data, old)} encerrado. Livre no mercado.` })
    addInbox(s, 'Seu empresário', 'Você está livre no mercado', `O contrato com ${artigo(clubOf(data, old))} ${teamLabel(data, old)} acabou. Vou buscar propostas — fique de olho na caixa de entrada.`)
    s.clubId = null
    s.captain = false
    m.captainAt = null
    m.loan = undefined
    s.parentClubId = undefined
  }
  // transferência acertada no meio da temporada para um clube de outro calendário
  if (m.deferredJoin) {
    const o = m.deferredJoin
    m.deferredJoin = undefined
    signContract(data, s, o, fx)
  }
  if (m.priority && s.season > (m.priorityUntil ?? s.season)) m.priority = undefined
  if (s.clubId !== m.captainAt) s.captain = false
  startSeason(W, data, s)
  const lab = m.calKind === 'split' ? `${s.season}/${String((s.season + 1) % 100).padStart(2, '0')}` : `${s.season}`
  fx.push({ type: 'toast', tone: 'info', title: `Temporada ${lab}`, description: s.clubId ? `${teamLabel(data, s.clubId)} · ${s.age} anos · OVR ${s.ovr}` : 'Sem clube: avalie as propostas.' })
}

export function retireNow(s: ImmersiveState, reason: string, fx: ImmersiveEffect[]): void {
  s.retired = true
  s.retiredReason = reason
  s.live = null
  s.press = null
  s.pendingDecision = null
  const text =
    reason === 'retirement_age'
      ? `Fim da linha: aposentadoria aos ${s.age} anos.`
      : reason === 'no_offers'
        ? `Sem propostas, encerrou a carreira aos ${s.age} anos.`
        : `Pendurou as chuteiras aos ${s.age} anos.`
  s.log.push({ season: s.season, age: s.age, type: 'retired', text, data: { reason } })
  addNews(s, `${s.identity.surname} anuncia a aposentadoria`, 'neutral', fx)
  fx.push({ type: 'retired' })
}

/** Rede de segurança: seeds e ids determinísticos por temporada. */
export function seasonRng(s: ImmersiveState, key: string) {
  return subRng(s.seed, 'imm', s.season, key)
}

export { positionGroup }
