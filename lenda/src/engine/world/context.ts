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
  UserFixture,
  UserLeagueLog,
} from '../types'
import type { FixedResult, UserSeasonContext } from '../api'
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
  // ── aditivos (Modo Imersivo): só existem com fixedResults/collectUserFixtures ──
  /** Contador de chaves de partida (desambigua jogos repetidos). Presente ⇒ modo imersivo ativo. */
  keys?: Map<string, number>
  /** Competição/fase em disputa (chave e rótulo das partidas). */
  tag?: { comp: string; stage: string; round?: number; t?: number }
  /** Confronto em andamento (playTie): jogo `index` de `legs`. */
  tie?: { legs: number; index: number; a: string; b: string; extraTime: boolean; seedAdvancesOnDraw?: boolean; prior: MatchResult[] }
  /** Partidas cujo placar veio de `fixedResults` → placar simulado original (consumo do rng). */
  fixedSet?: WeakSet<MatchResult>
  simScore?: WeakMap<MatchResult, [number, number]>
  /** Partida → agenda coletada (atualizada com prorrogação/pênaltis decididos no confronto). */
  collected?: WeakMap<MatchResult, UserFixture>
  /** Agenda coletada do jogador. */
  collect?: { club: UserFixture[]; nation: UserFixture[]; league?: UserLeagueLog; seq: number }
  /** Regras de calendário do Modo Imersivo (`UserSeasonContext.immersiveRules`). */
  imm?: boolean
}

/** (Modo Imersivo) Marca a competição/fase das próximas partidas (no-op fora do modo imersivo). */
export function setTag(ctx: SeasonCtx, comp: string | undefined, stage: string | undefined, round?: number): void {
  if (!ctx.keys) return
  const cur = ctx.tag ?? { comp: '?', stage: '?' }
  ctx.tag = { comp: comp ?? cur.comp, stage: stage ?? cur.stage, t: cur.t }
  if (round !== undefined) ctx.tag.round = round
}

/** Chave determinística da partida: competição | fase | mandante | visitante (#n quando repete). */
export function fixtureKey(ctx: SeasonCtx, home: string, away: string): string {
  const base = `${ctx.tag?.comp ?? '?'}|${ctx.tag?.stage ?? '?'}|${home}|${away}`
  const keys = ctx.keys!
  const n = keys.get(base) ?? 0
  keys.set(base, n + 1)
  return n ? `${base}#${n}` : base
}

function normFixed(f: FixedResult): { score: [number, number]; pens?: [number, number]; aet?: boolean } {
  if (Array.isArray(f)) {
    const out: { score: [number, number]; pens?: [number, number] } = { score: [f[0], f[1]] }
    if (f.length >= 4) out.pens = [f[2] as number, f[3] as number]
    return out
  }
  return f
}

function hashStr(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
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
  const sh = strengthIn(ctx, h, o.kind)
  const sa = strengthIn(ctx, a, o.kind)
  const m = simulateMatch(sh, sa, rng, {
    neutral,
    knockout: o.knockout,
    extraTime: o.extraTime,
  })
  let fixedHit = false
  let key = ''
  let simulated: [number, number] | undefined
  if (ctx.keys) {
    // modo imersivo: a simulação acima já consumiu o rng; o placar fixo só substitui o resultado
    key = fixtureKey(ctx, h, a)
    const raw = ctx.user.fixedResults?.[key]
    if (raw) {
      const f = normFixed(raw)
      fixedHit = true
      simulated = [m.score[0], m.score[1]]
      m.score = [f.score[0], f.score[1]]
      delete m.aet
      delete m.pens
      if (o.knockout) {
        if (f.aet) m.aet = true
        if (m.score[0] === m.score[1]) m.pens = f.pens ? [f.pens[0], f.pens[1]] : hashStr(key) % 2 ? [5, 4] : [4, 5]
      } else if (ctx.tie && ctx.tie.legs > 1 && ctx.tie.index === ctx.tie.legs - 1) {
        // jogo de volta: prorrogação/pênaltis do agregado vêm do resultado fixo
        if (f.aet) m.aet = true
        if (f.pens) m.pens = [f.pens[0], f.pens[1]]
      }
    }
  }
  record(ctx, h, m.score[0], m.score[1], national)
  record(ctx, a, m.score[1], m.score[0], national)
  const r: MatchResult = { home: h, away: a, score: m.score }
  if (m.aet) r.aet = true
  if (m.pens) r.pens = m.pens
  if (ctx.keys) {
    if (fixedHit) {
      ctx.fixedSet?.add(r)
      if (simulated) ctx.simScore?.set(r, simulated)
    }
    if (ctx.collect) collectFixture(ctx, key, r, o, !!neutral, fixedHit, sh, sa)
  }
  return r
}

function collectFixture(ctx: SeasonCtx, key: string, r: MatchResult, o: PlayOpts, neutral: boolean, fixed: boolean, sh: number, sa: number) {
  const c = ctx.collect!
  const national = isNationalKind(o.kind)
  const tag = ctx.tag
  if (!national && o.kind === 'league' && !ctx.tie && c.league && tag?.comp === c.league.leagueId) {
    c.league.matches.push([r.home, r.away, r.score[0], r.score[1], tag.round ?? 0, tag.t ?? 0])
  }
  const ent = national ? ctx.userNation : ctx.userClub
  if (!ent || (r.home !== ent && r.away !== ent)) return
  const userHome = r.home === ent
  const f: UserFixture = {
    key,
    competitionId: tag?.comp ?? '?',
    kind: o.kind,
    stage: tag?.stage ?? '',
    home: r.home,
    away: r.away,
    opponent: userHome ? r.away : r.home,
    userHome,
    score: [r.score[0], r.score[1]],
    strength: [Math.round(sh * 10) / 10, Math.round(sa * 10) / 10],
    seq: c.seq++,
  }
  if (o.kind === 'league' && !ctx.tie && tag?.round) f.round = tag.round
  if (neutral) f.neutral = true
  if (o.knockout) f.knockout = true
  const tie = ctx.tie
  if (tie) {
    f.leg = tie.index + 1
    f.legs = tie.legs
    f.extraTime = tie.extraTime
    if (tie.seedAdvancesOnDraw) {
      f.seedAdvancesOnDraw = true
      f.userSeed = tie.a === ent
    }
    if (tie.index > 0) {
      let u = 0
      let op = 0
      for (const l of tie.prior) {
        if (l.home === ent) (u += l.score[0]), (op += l.score[1])
        else if (l.away === ent) (u += l.score[1]), (op += l.score[0])
      }
      f.prior = [u, op]
    }
  } else if (o.knockout) f.extraTime = o.extraTime !== false
  if (r.pens) f.pens = [r.pens[0], r.pens[1]]
  if (r.aet) f.aet = true
  if (fixed) f.fixed = true
  ;(national ? c.nation : c.club).push(f)
  ctx.collected?.set(r, f)
}

/** Registra um jogo cujo placar é conhecido (jogo real já disputado). */
export function recordKnown(ctx: SeasonCtx, r: MatchResult, kind: CompetitionKind): void {
  const national = isNationalKind(kind)
  record(ctx, r.home, r.score[0], r.score[1], national)
  record(ctx, r.away, r.score[1], r.score[0], national)
}

/** Forma da temporada: pequeno ruído por clube (técnico, lesões, sorte). */
export const FORM_SD = 2

export function clampStrength(s: number): number {
  return clamp(s, 40, 92)
}
