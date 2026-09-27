/**
 * Índices sobre GameData e o contexto de simulação de UMA temporada (forças efetivas, estatísticas
 * agregadas por clube/seleção, modificadores do jogador). Tudo determinístico.
 */
import type {
  Club,
  Competition,
  CompetitionKind,
  Confed,
  Country,
  GameData,
  League,
  MatchResult,
} from '../types'
import type { UserSeasonContext } from '../api'
import { clamp, type Rng } from '../rng'
import { simulateMatch } from './match'

export const CONFEDS: Confed[] = ['UEFA', 'CONMEBOL', 'CONCACAF', 'AFC', 'CAF', 'OFC']

export interface ConfedComps {
  primary?: Competition
  secondary?: Competition
  tertiary?: Competition
  superCup?: Competition
  national?: Competition
}

export interface DataIndex {
  club: Map<string, Club>
  league: Map<string, League>
  comp: Map<string, Competition>
  country: Map<string, Country>
  firstSeason: number
  /** Ligas por confederação (todas as divisões) na ordem do catálogo. */
  confedLeagues: Map<Confed, League[]>
  confed: Record<Confed, ConfedComps>
  worldCup?: Competition
  clubWorldCup?: Competition
  intercontinental?: Competition
  /** Torneios de seleções com calendário (Copa, Euro, Copa América…). */
  nationalComps: Competition[]
  /** Estaduais (Competition.region). */
  regionalComps: Competition[]
  /** Força média inicial e prestígio médio por liga (âncoras da evolução). */
  leagueMean: Map<string, number>
  leaguePrestige: Map<string, number>
  /** 5 ligas UEFA de maior coeficiente (Chuteira de Ouro ×2). */
  uefaTop5: Set<string>
  /** Clubes extras (sem liga simulada). */
  extraClubs: Set<string>
}

const cache = new WeakMap<GameData, DataIndex>()

export function confedOfClub(ix: DataIndex, clubId: string): Confed | undefined {
  const c = ix.club.get(clubId)
  if (!c) return undefined
  const l = ix.league.get(c.leagueId)
  return l?.confed ?? ix.country.get(c.country)?.confed
}

function inferFirstSeason(data: GameData): number {
  const counts = new Map<number, number>()
  for (const s of Object.values(data.snapshot ?? {})) counts.set(s.season, (counts.get(s.season) ?? 0) + 1)
  let best = 0
  let bestN = 0
  for (const [s, n] of counts) if (n > bestN || (n === bestN && s < best)) (best = s), (bestN = n)
  if (best) return best
  const y = Number(String(data.generatedAt ?? '').slice(0, 4))
  return Number.isFinite(y) && y > 1990 ? y : 2026
}

export function indexData(data: GameData): DataIndex {
  const hit = cache.get(data)
  if (hit) return hit
  const club = new Map(data.clubs.map((c) => [c.id, c] as const))
  const league = new Map(data.leagues.map((l) => [l.id, l] as const))
  const comp = new Map(data.competitions.map((c) => [c.id, c] as const))
  const country = new Map(data.countries.map((c) => [c.code, c] as const))

  const confedLeagues = new Map<Confed, League[]>()
  for (const c of CONFEDS) confedLeagues.set(c, [])
  for (const l of data.leagues) confedLeagues.get(l.confed)?.push(l)

  const confed = {} as Record<Confed, ConfedComps>
  for (const cf of CONFEDS) {
    const m = data.confederations?.[cf]
    const byKind = (kind: CompetitionKind) =>
      data.competitions.find((c) => c.kind === kind && c.confed === cf && !c.superCup && !c.region)
    confed[cf] = {
      primary: (m?.primary && comp.get(m.primary)) || byKind('continental_primary'),
      secondary: (m?.secondary && comp.get(m.secondary)) || byKind('continental_secondary'),
      tertiary: (m?.tertiary && comp.get(m.tertiary)) || byKind('continental_tertiary'),
      superCup: (m?.superCup && comp.get(m.superCup)) || data.competitions.find((c) => c.superCup && c.confed === cf),
      national: (m?.national && comp.get(m.national)) || byKind('national_continental'),
    }
  }

  const cwcs = data.competitions.filter((c) => c.kind === 'club_world_cup')
  const isInter = (c: Competition) => /intercontinental/i.test(c.id + ' ' + c.name) || (c.schedule?.every ?? 1) <= 1
  const intercontinental = cwcs.find(isInter)
  const clubWorldCup = cwcs.find((c) => !isInter(c))
  const worldCup = data.competitions.find((c) => c.kind === 'world_cup')
  const nationalComps = data.competitions.filter(
    (c) => (c.kind === 'world_cup' || c.kind === 'national_continental') && !!c.schedule,
  )
  const regionalComps = data.competitions.filter((c) => !!c.region)

  const sums = new Map<string, [number, number, number]>()
  for (const c of data.clubs) {
    const s = sums.get(c.leagueId) ?? [0, 0, 0]
    s[0] += c.strength
    s[1] += c.prestige
    s[2]++
    sums.set(c.leagueId, s)
  }
  const leagueMean = new Map<string, number>()
  const leaguePrestige = new Map<string, number>()
  for (const [id, s] of sums) {
    leagueMean.set(id, s[0] / s[2])
    leaguePrestige.set(id, s[1] / s[2])
  }
  const uefaTop5 = new Set(
    data.leagues
      .filter((l) => l.confed === 'UEFA' && l.tier === 1)
      .sort((a, b) => b.coefficient - a.coefficient)
      .slice(0, 5)
      .map((l) => l.id),
  )
  const extraClubs = new Set(data.extraClubIds ?? [])
  for (const c of data.clubs) if (c.leagueId === 'none' || !league.has(c.leagueId)) extraClubs.add(c.id)

  const ix: DataIndex = {
    club,
    league,
    comp,
    country,
    firstSeason: inferFirstSeason(data),
    confedLeagues,
    confed,
    worldCup,
    clubWorldCup,
    intercontinental,
    nationalComps,
    regionalComps,
    leagueMean,
    leaguePrestige,
    uefaTop5,
    extraClubs,
  }
  cache.set(data, ix)
  return ix
}

// ───────────────────────── contexto da temporada ─────────────────────────

/** Bônus/ônus da prioridade escolhida (liga × copa internacional), em pontos de força. */
export const PRIORITY_BOOST = 1.5
/** Força extra aplicada quando o título é "forçado" (o resultado final ainda é garantido no mata-mata). */
export const FORCE_BOOST = 10

export interface SeasonCtx {
  data: GameData
  ix: DataIndex
  seed: string
  season: number
  first: boolean
  /** Força efetiva dos clubes na temporada (forma + reforço do jogador). */
  str: Map<string, number>
  nat: Map<string, number>
  user: UserSeasonContext
  userClub: string | null
  userNation: string | null
  /** Estatísticas por clube: [jogos, gols pró, gols contra, jogos sem sofrer gol]. */
  cs: Map<string, [number, number, number, number]>
  /** Estatísticas por seleção: [jogos, gols pró]. */
  ns: Map<string, [number, number]>
  /** Título forçado/impedido já sorteado para a temporada. */
  force: { kind: CompetitionKind; win: boolean } | null
  /** Liga de cada clube nesta temporada. */
  leagueOf: Map<string, string>
}

const CONTINENTAL: CompetitionKind[] = ['continental_primary', 'continental_secondary', 'continental_tertiary']

export function isNationalKind(kind: CompetitionKind): boolean {
  return kind === 'world_cup' || kind === 'national_continental'
}

/** Entidade do usuário afetada por uma competição (clube ou seleção). */
export function userEntity(ctx: SeasonCtx, kind: CompetitionKind): string | null {
  return isNationalKind(kind) ? ctx.userNation : ctx.userClub
}

export function forced(ctx: SeasonCtx, kind: CompetitionKind, id: string): 'win' | 'lose' | null {
  if (!ctx.force || ctx.force.kind !== kind) return null
  return userEntity(ctx, kind) === id ? (ctx.force.win ? 'win' : 'lose') : null
}

/** Força de um time numa competição (aplica prioridade e título forçado do jogador). */
export function strengthIn(ctx: SeasonCtx, id: string, kind: CompetitionKind): number {
  const national = isNationalKind(kind)
  let s = national ? (ctx.nat.get(id) ?? 55) : (ctx.str.get(id) ?? 60)
  if (!national && id === ctx.userClub && ctx.user.priority) {
    const inLeague = kind === 'league'
    const inCont = CONTINENTAL.includes(kind)
    if (ctx.user.priority === 'league') s += inLeague ? PRIORITY_BOOST : inCont ? -PRIORITY_BOOST : 0
    else s += inCont ? PRIORITY_BOOST : inLeague ? -PRIORITY_BOOST : 0
  }
  const f = forced(ctx, kind, id)
  if (f === 'win') s += FORCE_BOOST
  else if (f === 'lose') s -= FORCE_BOOST / 2
  return s
}

function record(ctx: SeasonCtx, id: string, gf: number, ga: number, national: boolean) {
  if (national) {
    const s = ctx.ns.get(id)
    if (s) {
      s[0]++
      s[1] += gf
    } else ctx.ns.set(id, [1, gf])
    return
  }
  const s = ctx.cs.get(id)
  if (s) {
    s[0]++
    s[1] += gf
    s[2] += ga
    if (ga === 0) s[3]++
  } else ctx.cs.set(id, [1, gf, ga, ga === 0 ? 1 : 0])
}

export interface PlayOpts {
  kind: CompetitionKind
  neutral?: boolean
  knockout?: boolean
  extraTime?: boolean
  /** Seleções anfitriãs jogam "em casa" mesmo em sede neutra. */
  hosts?: Set<string>
}

/** Uma partida oficial: simula, registra estatísticas e devolve o MatchResult. */
export function play(ctx: SeasonCtx, rng: Rng, home: string, away: string, o: PlayOpts): MatchResult {
  const national = isNationalKind(o.kind)
  let neutral = o.neutral
  let h = home
  let a = away
  if (neutral && o.hosts) {
    if (o.hosts.has(away) && !o.hosts.has(home)) {
      h = away
      a = home
      neutral = false
    } else if (o.hosts.has(home) && !o.hosts.has(away)) neutral = false
  }
  const m = simulateMatch(strengthIn(ctx, h, o.kind), strengthIn(ctx, a, o.kind), rng, {
    neutral,
    knockout: o.knockout,
    extraTime: o.extraTime,
  })
  record(ctx, h, m.score[0], m.score[1], national)
  record(ctx, a, m.score[1], m.score[0], national)
  const r: MatchResult = { home: h, away: a, score: m.score }
  if (m.aet) r.aet = true
  if (m.pens) r.pens = m.pens
  return r
}

/** Registra um jogo cujo placar é conhecido (jogo real já disputado). */
export function recordKnown(ctx: SeasonCtx, r: MatchResult, kind: CompetitionKind): void {
  const national = isNationalKind(kind)
  record(ctx, r.home, r.score[0], r.score[1], national)
  record(ctx, r.away, r.score[1], r.score[0], national)
}

/** Forma da temporada: pequeno ruído por clube (técnico, lesões, sorte). */
export const FORM_SD = 1.5

export function clampStrength(s: number): number {
  return clamp(s, 40, 92)
}
