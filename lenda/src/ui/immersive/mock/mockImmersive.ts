/**
 * Motor de EXEMPLO do Modo Imersivo (implementa ImmersiveEngine) — para a UI funcionar antes do
 * motor real (src/engine/immersive). Usa os dados reais (clubes, tabelas, jogos restantes da
 * temporada 2026, elencos) e é determinístico pela seed. Não tenta ser um simulador completo:
 * uma liga + copa nacional (+ continental se classificado), seleção de base, coletivas, eventos
 * de história, janela de transferências e premiação no fim da temporada.
 *
 * Convenções (as mesmas que a UI espera do motor real):
 *   - calendário: cada `advance`/ação conclui o item atual e anda o cursor; ao "chegar" num item
 *     de história a decisão fica pendente; numa janela, as propostas chegam na caixa de entrada.
 *   - partida: `advance` num jogo cria `live` na fase 'pre'; `match_start` começa; `match_sim`
 *     anda até o próximo lance-chave, intervalo ou fim; `match_finish` encerra (fase 'full_time').
 *   - MatchEvent.at: 0–100 (x: a CASA ataca para a direita), y 0–100.
 *   - MatchEvent.side = time "dono" do lance (quem finalizou, quem levou o cartão…).
 */
import type {
  Attributes,
  AttributeKey,
  CalendarItem,
  ContractOffer,
  ImmersiveAction,
  ImmersiveEffect,
  ImmersiveEngine,
  ImmersiveState,
  InboxMessage,
  KeyMoment,
  KeyMomentOption,
  KeyMomentSituation,
  LiveMatch,
  MatchEvent,
  NewsItem,
  PressQuestion,
  SocialPost,
  TeamSide,
  TrainingFocus,
  UserMatchStats,
} from '@/engine/immersive/types'
import type { AwardResult, AwardRankingEntry, Club, Decision, GameData, PlayerIdentity, Position, SeasonRecord, StandingRow, TrophyWin, WorldState } from '@/engine/types'
import { Rng, clamp } from '@/engine/rng'
import { addResult, newRow, sortTable } from '@/engine/world/table'
import { ATTR_LABEL, GK_KEYS, INTENSITY, LIFESTYLE_ITEMS, OUTFIELD_KEYS, OUTLETS, POST_TEMPLATES, RECOVERY_GAIN, TRAINING_FOCUS } from '../model/constants'
import { attackersOf, keeperOf, lineupOf, squadOf, type SquadPlayer } from './roster'

// ───────────────────────────── memória do motor (state.engine) ─────────────────────────────

interface PlannedMoment {
  minute: number
  situation: KeyMomentSituation
  minigame?: KeyMoment['minigame']
}

interface Plan {
  bg: MatchEvent[]
  moments: PlannedMoment[]
  onAt: number
  offAt?: number
  /** Opções do lance pendente → dados internos para resolver. */
  pending?: { id: string; defaultId: string; attr: Record<string, number> }
  startMinute: number
  momentsDone: number
  lastScorer?: string
}

interface CupRun {
  competitionId: string
  alive: boolean
}

interface Mem {
  tick: number
  leagueId: string
  table: StandingRow[]
  rounds: { home: string; away: string }[][]
  roundDone: boolean[]
  form: ('V' | 'E' | 'D')[]
  ratings: number[]
  followers: number
  plan?: Plan
  baseline: { season: number; ovr: number; attributes: Attributes }
  cups: CupRun[]
  scorers: Record<string, { name: string; clubId: string; goals: number }>
  pendingMove?: { clubId: string; salary: number; years: number; role: ContractOffer['role']; fee?: number; loan?: boolean }
  press?: Record<string, Record<string, Partial<Deltas>>>
  story?: { id: string; options: Record<string, { ok: Partial<Deltas>; bad?: Partial<Deltas>; p: number; okText: string; badText?: string }> }
  called?: boolean
  storyUsed: string[]
  lastResult?: { res: 'V' | 'E' | 'D'; goals: number; oppId: string; score: [number, number]; userSide: 'home' | 'away' }
  seasonTrophies: TrophyWin[]
  seed: string
}

interface Deltas {
  coach: number
  teammates: number
  fans: number
  media: number
  morale: number
  fitness: number
  balance: number
  reputation: number
  followers: number
  attr?: { key: AttributeKey; delta: number }
}

const mem = (s: ImmersiveState) => s.engine as unknown as Mem
const clone = <T,>(x: T): T => structuredClone(x)
const r1 = (n: number) => Math.round(n * 10) / 10

// ───────────────────────────── jogador ─────────────────────────────

const WEIGHTS: Record<Position, Partial<Record<AttributeKey, number>>> = {
  CA: { shooting: 0.32, pace: 0.18, dribbling: 0.18, physical: 0.14, passing: 0.12, defending: 0.06 },
  PE: { pace: 0.26, dribbling: 0.26, shooting: 0.2, passing: 0.16, physical: 0.08, defending: 0.04 },
  PD: { pace: 0.26, dribbling: 0.26, shooting: 0.2, passing: 0.16, physical: 0.08, defending: 0.04 },
  MEI: { passing: 0.3, dribbling: 0.26, shooting: 0.2, pace: 0.1, physical: 0.06, defending: 0.08 },
  MC: { passing: 0.3, dribbling: 0.16, defending: 0.18, physical: 0.16, shooting: 0.1, pace: 0.1 },
  VOL: { defending: 0.32, physical: 0.24, passing: 0.24, pace: 0.08, dribbling: 0.06, shooting: 0.06 },
  ME: { pace: 0.22, passing: 0.24, dribbling: 0.22, shooting: 0.12, physical: 0.1, defending: 0.1 },
  MD: { pace: 0.22, passing: 0.24, dribbling: 0.22, shooting: 0.12, physical: 0.1, defending: 0.1 },
  ZAG: { defending: 0.42, physical: 0.3, pace: 0.12, passing: 0.1, dribbling: 0.03, shooting: 0.03 },
  LD: { defending: 0.3, pace: 0.26, physical: 0.16, passing: 0.16, dribbling: 0.08, shooting: 0.04 },
  LE: { defending: 0.3, pace: 0.26, physical: 0.16, passing: 0.16, dribbling: 0.08, shooting: 0.04 },
  GOL: { diving: 0.24, handling: 0.22, reflexes: 0.26, positioning: 0.2, kicking: 0.08 },
}

export function ovrOf(attributes: Attributes, position: Position): number {
  const w = WEIGHTS[position] ?? WEIGHTS.MC
  let sum = 0
  let tw = 0
  for (const [k, v] of Object.entries(w)) {
    const a = (attributes as unknown as Record<string, number>)[k]
    if (typeof a === 'number') {
      sum += a * (v as number)
      tw += v as number
    }
  }
  return Math.round(tw ? sum / tw : 50)
}

function baseAttributes(position: Position, rng: Rng): Attributes {
  const j = () => rng.int(-3, 3)
  if (position === 'GOL') return { diving: 60 + j(), handling: 57 + j(), reflexes: 62 + j(), positioning: 55 + j(), kicking: 50 + j() }
  const w = WEIGHTS[position]
  const attrs = {} as Record<string, number>
  for (const k of OUTFIELD_KEYS) {
    const weight = (w[k] ?? 0.04) as number
    attrs[k] = Math.round(34 + weight * 100 + j())
  }
  return attrs as unknown as Attributes
}

const isGk = (p: Position) => p === 'GOL'
const attrKeys = (p: Position): AttributeKey[] => (isGk(p) ? [...GK_KEYS] : [...OUTFIELD_KEYS])
const attr = (s: ImmersiveState, k: AttributeKey) => (s.attributes as unknown as Record<string, number>)[k] ?? 50

export function marketValueOf(ovr: number, age: number, potential: number): number {
  const ageF = age <= 21 ? 1.25 + (potential - ovr) / 40 : age <= 27 ? 1.2 : age <= 30 ? 0.9 : age <= 33 ? 0.55 : 0.25
  const v = 110_000 * Math.pow(1.185, ovr - 50) * ageF
  const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1)
  return Math.max(50_000, Math.round(v / mag) * mag)
}

// ───────────────────────────── dados auxiliares ─────────────────────────────

const clubOf = (data: GameData, id: string | null | undefined): Club | undefined => (id ? data.clubs.find((c) => c.id === id) : undefined)
const leagueOf = (data: GameData, id: string) => data.leagues.find((l) => l.id === id)
const leagueClubs = (data: GameData, leagueId: string) => data.clubs.filter((c) => c.leagueId === leagueId)

function teamSide(data: GameData, id: string, national: boolean): TeamSide {
  if (national) {
    const c = data.countries.find((x) => x.code === id)
    return { id, name: c?.name ?? id, shortName: id, strength: c?.strength ?? 70, national: true }
  }
  const c = clubOf(data, id)
  return { id, name: c?.name ?? id, shortName: c?.shortName ?? id, strength: c?.strength ?? 65, national: false }
}
const abbrOf = (data: GameData, id: string) => clubOf(data, id)?.abbr ?? id.slice(0, 3).toUpperCase()
const nameOf = (data: GameData, id: string) => clubOf(data, id)?.name ?? data.countries.find((c) => c.code === id)?.name ?? id

function startingClub(data: GameData, nationality: string, rng: Rng): Club {
  const leagues = data.leagues.filter((l) => l.country === nationality && l.tier === 1)
  let pool: Club[] = []
  for (const l of leagues) pool.push(...leagueClubs(data, l.id))
  if (!pool.length) {
    const fallback = ['por.1', 'esp.1', 'bra.1'].map((id) => leagueOf(data, id)).find(Boolean)
    if (fallback) pool = leagueClubs(data, fallback.id)
  }
  if (!pool.length) pool = data.clubs.slice(0, 20)
  const sorted = pool.slice().sort((a, b) => b.strength - a.strength)
  // top-8 clube de camisa, mas não o melhor da liga (a promessa precisa de espaço)
  const cand = sorted.slice(1, Math.min(sorted.length, 9)).filter((c) => c.prestige >= 3)
  return rng.pick(cand.length ? cand : sorted.slice(0, Math.max(1, Math.min(6, sorted.length))))
}

// ───────────────────────────── calendário ─────────────────────────────

function groupRounds(fixtures: { home: string; away: string; date?: string }[]): { home: string; away: string }[][] {
  const sorted = fixtures.slice().sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  const last = new Map<string, number>()
  const rounds: { home: string; away: string }[][] = []
  for (const f of sorted) {
    const r = Math.max(last.get(f.home) ?? -1, last.get(f.away) ?? -1) + 1
    ;(rounds[r] ??= []).push({ home: f.home, away: f.away })
    last.set(f.home, r)
    last.set(f.away, r)
  }
  return rounds.filter(Boolean)
}

function roundRobin(ids: string[], legs: number, rng: Rng): { home: string; away: string }[][] {
  const t = rng.shuffle(ids)
  if (t.length % 2) t.push('__bye__')
  const n = t.length
  const first: { home: string; away: string }[][] = []
  for (let r = 0; r < n - 1; r++) {
    const round: { home: string; away: string }[] = []
    for (let i = 0; i < n / 2; i++) {
      const a = t[i]
      const b = t[n - 1 - i]
      if (a !== '__bye__' && b !== '__bye__') round.push(r % 2 ? { home: b, away: a } : { home: a, away: b })
    }
    first.push(round)
    t.splice(1, 0, t.pop()!)
  }
  const out: { home: string; away: string }[][] = []
  for (let l = 0; l < Math.max(1, Math.min(2, legs)); l++) for (const r of first) out.push(l % 2 ? r.map((m) => ({ home: m.away, away: m.home })) : r)
  return out
}

const CUP_STAGES_DOMESTIC = ['Terceira fase', 'Oitavas de final', 'Quartas de final', 'Semifinal', 'Final']
const CUP_STAGES_CONT = ['Oitavas de final', 'Quartas de final', 'Semifinal', 'Final']

interface BuildOpts {
  firstSeason: boolean
}

function buildSeason(data: GameData, s: ImmersiveState, m: Mem, season: number, opts: BuildOpts): CalendarItem[] {
  const club = clubOf(data, s.clubId)!
  const league = leagueOf(data, club.leagueId) ?? data.leagues[0]
  const rng = new Rng(`${s.seed}:cal:${season}`)
  const clubs = leagueClubs(data, league.id)
  const real = opts.firstSeason && data.snapshot?.[league.id]?.fixturesComplete && (data.fixtures[league.id]?.length ?? 0) > 0
  m.leagueId = league.id
  if (real) {
    const byId = new Map((data.standings[league.id] ?? []).map((r) => [r.clubId, { ...r }]))
    m.table = clubs.map((c) => byId.get(c.id) ?? newRow(c.id))
    m.rounds = groupRounds(data.fixtures[league.id].filter((f) => !f.score))
  } else {
    m.table = clubs.map((c) => newRow(c.id))
    m.rounds = roundRobin(
      clubs.map((c) => c.id),
      league.format.rounds,
      rng,
    )
  }
  m.roundDone = m.rounds.map(() => false)
  m.scorers = {}
  m.seasonTrophies = []
  m.cups = []
  const R = m.rounds.length
  const items: CalendarItem[] = []
  const push = (it: Omit<CalendarItem, 'id' | 'season' | 'order' | 'done'>) => {
    const order = items.filter((x) => x.week === it.week).length
    items.push({ ...it, id: `${season}-${it.week}-${order}-${it.kind}`, season, order, done: false })
  }
  const leagueName = league.shortName
  // rivais "clássicos": mesma cidade/estado e camisa pesada
  const derby = (opp: Club) => (opp.state && opp.state === club.state && opp.prestige >= 4 ? 0.85 : opp.prestige >= 5 ? 0.62 : 0.42)

  // copa nacional: 2026 = edição real em andamento; depois, desde a 3ª fase
  const cupId = league.domesticCupId
  const cupPlan: { comp: string; stages: string[]; weeks: number[] }[] = []
  if (cupId) {
    if (opts.firstSeason) {
      const cip = data.cupsInProgress[cupId]
      if (cip?.alive.includes(club.id)) {
        const idx = Math.max(0, CUP_STAGES_DOMESTIC.indexOf(cip.stage))
        const stages = CUP_STAGES_DOMESTIC.slice(idx)
        cupPlan.push({ comp: cupId, stages, weeks: stages.map((_, i) => Math.max(2, Math.round(((i + 1) / (stages.length + 1)) * R))) })
      }
    } else {
      cupPlan.push({ comp: cupId, stages: CUP_STAGES_DOMESTIC, weeks: CUP_STAGES_DOMESTIC.map((_, i) => Math.max(2, Math.round((0.14 + i * 0.17) * R))) })
    }
  }
  const prevPos = s.seasons.length ? s.seasons[s.seasons.length - 1].leaguePosition : undefined
  const confComp = data.confederations?.[league.confed]?.primary
  if (!opts.firstSeason && confComp && prevPos && prevPos <= Math.max(1, league.continentalSlots[0]) && s.seasons[s.seasons.length - 1].clubId === club.id) {
    cupPlan.push({ comp: confComp, stages: CUP_STAGES_CONT, weeks: CUP_STAGES_CONT.map((_, i) => Math.max(3, Math.round((0.22 + i * 0.19) * R))) })
  }
  const cupOpp = (comp: string, i: number) => {
    const pool =
      comp === confComp
        ? data.clubs.filter((c) => c.id !== club.id && leagueOf(data, c.leagueId)?.confed === league.confed && leagueOf(data, c.leagueId)?.tier === 1 && c.country !== club.country && c.strength >= 66)
        : data.clubs.filter((c) => c.id !== club.id && c.country === club.country && (leagueOf(data, c.leagueId)?.tier ?? 3) <= 2)
    const sorted = pool.sort((a, b) => b.strength - a.strength)
    const band = sorted.slice(0, Math.max(4, Math.round(sorted.length * (0.9 - i * 0.18))))
    return rng.pick(band.length ? band : sorted)
  }
  for (const c of cupPlan) m.cups.push({ competitionId: c.comp, alive: true })

  const national = data.countries.find((c) => c.code === s.identity.nationality)
  const callupWeeks = R >= 20 ? [Math.round(R * 0.25), Math.round(R * 0.62)] : [Math.max(2, Math.round(R * 0.4))]
  const windowWeek = opts.firstSeason ? Math.max(2, Math.round(R * 0.55)) : Math.round(R * 0.5)
  const pressEvery = R >= 20 ? 5 : 4
  const storyWeeks = R >= 20 ? [4, 11, 17, 24, 31, 36].filter((w) => w <= R) : [3, 7].filter((w) => w <= R)

  // pré-temporada
  push({ week: 0, kind: 'training', title: opts.firstSeason ? 'Semana de apresentação' : 'Pré-temporada' })
  if (!opts.firstSeason) push({ week: 0, kind: 'transfer_window', title: 'Janela de transferências · pré-temporada' })

  for (let w = 1; w <= R; w++) {
    push({ week: w, kind: 'training', title: 'Treino da semana' })
    const round = m.rounds[w - 1] ?? []
    const fx = round.find((f) => f.home === club.id || f.away === club.id)
    if (storyWeeks.includes(w)) push({ week: w, kind: 'story', title: 'Bastidores' })
    if (callupWeeks.includes(w) && national) push({ week: w, kind: 'national_callup', title: `Convocação · ${national.name}` })
    if (w === windowWeek) push({ week: w, kind: 'transfer_window', title: 'Janela de transferências' })
    if (fx) {
      const home = fx.home === club.id
      const oppId = home ? fx.away : fx.home
      const opp = clubOf(data, oppId)
      if (w % pressEvery === 2) push({ week: w, kind: 'press', title: `Coletiva pré-jogo · ${opp?.shortName ?? 'rival'}`, opponentId: oppId })
      const playedBefore = m.table.find((r) => r.clubId === club.id)?.played ?? 0
      push({
        week: w,
        kind: 'match',
        title: `${leagueName} · ${playedBefore + w}ª rodada`,
        competitionId: league.id,
        fixtureKey: `${league.id}:${season}:${w}:${fx.home}-${fx.away}`,
        opponentId: oppId,
        home,
        stage: `${playedBefore + w}ª rodada`,
        importance: opp ? derby(opp) : 0.4,
      })
    }
    for (const c of cupPlan) {
      const i = c.weeks.indexOf(w)
      if (i < 0) continue
      const opp = cupOpp(c.comp, i)
      const comp = data.competitions.find((x) => x.id === c.comp)
      const stage = c.stages[i]
      push({
        week: w,
        kind: 'match',
        title: `${comp?.name ?? 'Copa'} · ${stage}`,
        competitionId: c.comp,
        fixtureKey: `${c.comp}:${season}:${i}`,
        opponentId: opp.id,
        home: rng.chance(0.5),
        stage,
        importance: stage === 'Final' ? 1 : stage === 'Semifinal' ? 0.85 : 0.6,
      })
    }
    if (callupWeeks.includes(w - 1) && national) {
      const rivals = data.countries.filter((c) => c.confed === national.confed && c.code !== national.code).sort((a, b) => b.strength - a.strength)
      const opp = rng.pick(rivals.slice(0, 8).length ? rivals.slice(0, 8) : data.countries.filter((c) => c.code !== national.code))
      push({ week: w, kind: 'national_match', title: `${national.name} · Amistoso`, opponentId: opp.code, home: rng.chance(0.5), stage: 'Amistoso internacional', importance: 0.55, competitionId: 'friendly' })
    }
  }
  push({ week: R + 1, kind: 'season_end', title: `Fim da temporada ${season}` })
  push({ week: R + 1, kind: 'awards', title: `Premiação ${season}` })
  return items
}

// ───────────────────────────── estado inicial ─────────────────────────────

function emptyWorld(data: GameData, seed: string): WorldState {
  const clubs: WorldState['clubs'] = {}
  for (const c of data.clubs) clubs[c.id] = { strength: c.strength, leagueId: c.leagueId, prestige: c.prestige }
  const nations: Record<string, number> = {}
  for (const c of data.countries) nations[c.code] = c.strength
  return { seed, nextSeason: 2026, clubs, nations, rivals: [], seasons: {}, qualified: {} }
}

let idc = 0
const uid = (s: ImmersiveState, p: string) => `${p}-${s.season}-${s.week}-${mem(s).tick}-${++idc % 100000}`

function newCareer(data: GameData, identity: PlayerIdentity, seed: string): ImmersiveState {
  const rng = new Rng(`${seed}:new`)
  const club = startingClub(data, identity.nationality, rng)
  const attributes = baseAttributes(identity.position, rng)
  const ovr = ovrOf(attributes, identity.position)
  const potential = rng.int(80, 93)
  const m: Mem = {
    tick: 0,
    leagueId: club.leagueId,
    table: [],
    rounds: [],
    roundDone: [],
    form: [],
    ratings: [],
    followers: 1800 + rng.int(0, 900),
    baseline: { season: 2026, ovr, attributes: clone(attributes) },
    cups: [],
    scorers: {},
    storyUsed: [],
    seasonTrophies: [],
    seed,
  }
  const s: ImmersiveState = {
    version: 1,
    mode: 'immersive',
    id: `imm-${seed}`,
    seed,
    identity,
    createdAt: new Date(Date.UTC(2026, 8, 28)).toISOString(),
    age: 16,
    season: 2026,
    week: 0,
    ovr,
    potential,
    attributes,
    condition: { fitness: 92, form: 60, morale: 72, sharpness: 45 },
    relationships: {
      coach: 52,
      teammates: 58,
      fans: 50,
      media: 45,
      bonds: [],
    },
    finance: { salary: 72_000, balance: 18_000, contractUntil: 2028, releaseClause: 25_000_000, bonuses: { perGoal: 2_000, perTitle: 20_000 }, lifestyle: [] },
    clubId: club.id,
    squadNumber: identity.number,
    captain: false,
    marketValue: marketValueOf(ovr, 16, potential),
    reputation: 8,
    calendar: [],
    cursor: 0,
    live: null,
    press: null,
    inbox: [],
    offers: [],
    news: [],
    social: [],
    pendingDecision: null,
    seasonStats: { apps: 0, starts: 0, minutes: 0, goals: 0, assists: 0, cleanSheets: 0, ratingSum: 0, motm: 0 },
    seasons: [],
    national: { apps: 0, goals: 0, assists: 0, trophies: [], tournaments: [] },
    trophies: [],
    awards: [],
    world: emptyWorld(data, seed),
    engine: m as unknown as Record<string, unknown>,
    log: [{ season: 2026, age: 16, type: 'joined', text: `Promovido ao profissional do ${club.name}.`, data: { clubId: club.id } }],
    achievements: [],
    retired: false,
  }
  const squad = squadOf(data, club.id, seed)
  const veteran = squad.slice().sort((a, b) => b.ovr - a.ovr)[0]
  const partner = attackersOf(squad).sort((a, b) => b.ovr - a.ovr)[0] ?? squad[1]
  s.relationships.bonds = [
    ...(veteran ? [{ name: veteran.name, role: 'mentor' as const, value: 62 }] : []),
    ...(partner && partner !== veteran ? [{ name: partner.name, role: 'parceiro' as const, value: 55 }] : []),
  ]
  s.calendar = buildSeason(data, s, m, 2026, { firstSeason: true })
  s.inbox.push(
    msg(s, 'Diretoria', `Bem-vindo ao ${club.name}`, `Parabéns, ${identity.surname}! Você foi promovido da base para o elenco principal. Contrato até ${s.finance.contractUntil}, com salário de €${Math.round(s.finance.salary / 1000)} mil por ano. Honre a camisa.`),
    msg(s, 'Seu empresário', 'Vamos construir sua carreira', 'Primeiro passo: ganhar a confiança do técnico nos treinos. Quando surgirem propostas, eu te aviso por aqui — nada de assinar sem falar comigo.'),
  )
  s.news.push(news(s, `${club.shortName} promove ${identity.surname}, joia de 16 anos, ao profissional`, 'positive', 'Diário da Bola', `O ${club.name} anunciou a subida do ${positionName(identity.position)} para o time principal.`))
  s.social.push(
    post(s, `${club.name}`, `@${slug(club.shortName)}`, `Bem-vindo ao profissional, ${cap(identity.surname)}! Camisa ${identity.number}. 🔥 #${slug(club.shortName)}`, 'positive', { verified: true, likes: 12400, reposts: 1800 }),
    post(s, 'Torcedor raiz', `@${slug(club.abbr)}_ate_morrer`, `Vi esse garoto na base, ${cap(identity.surname)} é diferente. Anotem.`, 'positive', { likes: 310, reposts: 44 }),
  )
  arrive(data, s, [])
  return s
}

// ───────────────────────────── textos ─────────────────────────────

const POS_NAME: Record<Position, string> = { GOL: 'goleiro', ZAG: 'zagueiro', LD: 'lateral', LE: 'lateral', VOL: 'volante', MC: 'meio-campista', ME: 'meia', MD: 'meia', MEI: 'meia', PE: 'ponta', PD: 'ponta', CA: 'centroavante' }
const positionName = (p: Position) => POS_NAME[p] ?? 'jogador'
const cap = (x: string) => x.charAt(0) + x.slice(1).toLowerCase()
const slug = (x: string) =>
  x
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

function msg(s: ImmersiveState, from: string, subject: string, body: string, extra: Partial<InboxMessage> = {}): InboxMessage {
  return { id: uid(s, 'msg'), season: s.season, week: s.week, from, subject, body, read: false, ...extra }
}
function news(s: ImmersiveState, headline: string, tone: NewsItem['tone'], outlet: string, body?: string, aboutUser = true): NewsItem {
  return { id: uid(s, 'news'), season: s.season, week: s.week, headline, body, outlet, tone, aboutUser, clubId: s.clubId ?? undefined }
}
function post(s: ImmersiveState, author: string, handle: string, text: string, tone: SocialPost['tone'], o: { verified?: boolean; likes?: number; reposts?: number; byUser?: boolean } = {}): SocialPost {
  return { id: uid(s, 'post'), season: s.season, week: s.week, author, handle, text, likes: o.likes ?? 0, reposts: o.reposts ?? 0, tone, byUser: o.byUser, verified: o.verified }
}

// ───────────────────────────── fluxo do calendário ─────────────────────────────

function current(s: ImmersiveState): CalendarItem | null {
  return s.calendar[s.cursor] ?? null
}

/** Conclui o item atual e chega no próximo. */
function complete(data: GameData, s: ImmersiveState, fx: ImmersiveEffect[], result?: CalendarItem['result']) {
  const it = current(s)
  if (it) {
    it.done = true
    if (result) it.result = result
  }
  s.cursor = Math.min(s.calendar.length, s.cursor + 1)
  while (s.calendar[s.cursor]?.done) s.cursor++
  arrive(data, s, fx)
}

function weekTick(data: GameData, s: ImmersiveState, to: number, fx: ImmersiveEffect[]) {
  const m = mem(s)
  while (s.week < to) {
    s.week++
    s.finance.balance += Math.round(s.finance.salary / 52)
    s.condition.fitness = clamp(s.condition.fitness + 6, 0, 100)
    s.condition.sharpness = clamp(s.condition.sharpness - 3, 0, 100)
    s.condition.morale = Math.round(s.condition.morale + (62 - s.condition.morale) * 0.08)
    if (s.condition.injury) {
      s.condition.injury.weeksLeft--
      if (s.condition.injury.weeksLeft <= 0) {
        fx.push({ type: 'toast', tone: 'success', title: 'Liberado pelo departamento médico', description: `Recuperado de ${s.condition.injury.name.toLowerCase()}.` })
        s.condition.injury = undefined
      }
    }
    // rodadas passadas sem jogo do usuário
    for (let r = 0; r < Math.min(m.rounds.length, s.week - 1); r++) if (!m.roundDone[r]) simulateRound(data, s, r)
    // propostas vencidas
    const expired = s.offers.filter((o) => o.expiresWeek < s.week)
    if (expired.length) {
      s.offers = s.offers.filter((o) => o.expiresWeek >= s.week)
      for (const o of expired) s.inbox.unshift(msg(s, 'Seu empresário', `Proposta do ${nameOf(data, o.clubId)} expirou`, 'Eles seguiram atrás de outro nome. Faz parte — outras virão.'))
    }
  }
}

function arrive(data: GameData, s: ImmersiveState, fx: ImmersiveEffect[]) {
  const it = current(s)
  if (!it) return
  if (it.week > s.week) weekTick(data, s, it.week, fx)
  const m = mem(s)
  switch (it.kind) {
    case 'story': {
      s.pendingDecision = pickStory(data, s)
      break
    }
    case 'transfer_window': {
      const offers = generateOffers(data, s)
      s.offers.push(...offers)
      for (const o of offers)
        s.inbox.unshift(
          msg(
            s,
            'Seu empresário',
            o.kind === 'renewal' ? `${nameOf(data, o.clubId)} quer renovar` : `Proposta: ${nameOf(data, o.clubId)}`,
            o.kind === 'renewal'
              ? `A diretoria oferece ${o.years} anos e €${fmtK(o.salary)}/ano. Dá para pedir mais — eles têm margem.`
              : `${nameOf(data, o.clubId)} ofereceu ${o.fee ? `€${fmtK(o.fee)}` : 'uma proposta'} e te quer como ${o.role.toLowerCase()}. ${o.note ?? ''}`,
            { offerId: o.id },
          ),
        )
      if (offers.length) fx.push({ type: 'toast', tone: 'gold', title: 'Janela aberta', description: `${offers.length} ${offers.length === 1 ? 'proposta chegou' : 'propostas chegaram'} na caixa de entrada.` })
      break
    }
    case 'national_callup': {
      const country = data.countries.find((c) => c.code === s.identity.nationality)
      const youth = s.age <= 20
      const threshold = (country?.callUpOvr ?? 75) - (youth ? 24 : 0)
      m.called = s.ovr >= threshold || s.seasonStats.goals >= 3
      const team = youth ? `${country?.name ?? 'Seleção'} Sub-20` : country?.name ?? 'Seleção'
      s.inbox.unshift(
        msg(s, `Seleção · ${team}`, m.called ? 'Você foi convocado!' : 'Lista divulgada', m.called ? `A comissão técnica da ${team} convocou você para o amistoso da próxima semana. Apresentação na segunda-feira.` : `Seu nome ficou fora desta vez. A comissão acompanha seus jogos — continue somando minutos.`),
      )
      if (m.called) {
        s.news.unshift(news(s, `${s.identity.surname} é convocado para a ${team}`, 'positive', 'LENDA TV'))
        fx.push({ type: 'toast', tone: 'gold', title: 'Convocado!', description: `${team} · amistoso na próxima semana.` })
      } else {
        // sem convocação: o amistoso sai do seu calendário
        s.calendar = s.calendar.filter((c, i) => !(i > s.cursor && c.kind === 'national_match' && !c.done && c.week <= it.week + 1))
      }
      break
    }
    default:
      break
  }
}

const fmtK = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace('.', ',')}M` : `${Math.round(v / 1000)} mil`)

// ───────────────────────────── tabela da liga ─────────────────────────────

function simGoals(rng: Rng, hs: number, as: number): [number, number] {
  const d = (hs + 3 - as) * 0.045
  return [rng.poisson(clamp(1.3 + d, 0.25, 3.4)), rng.poisson(clamp(1.05 - d, 0.2, 3))]
}

function creditScorers(data: GameData, s: ImmersiveState, clubId: string, n: number, rng: Rng, names?: string[]) {
  const m = mem(s)
  const att = attackersOf(squadOf(data, clubId, s.seed))
  for (let i = 0; i < n; i++) {
    const nm = names?.[i] ?? (att.length ? rng.weighted(att, (p) => p.ovr - 55).name : null)
    if (!nm) continue
    const key = `${clubId}|${nm}`
    m.scorers[key] = { name: nm, clubId, goals: (m.scorers[key]?.goals ?? 0) + 1 }
  }
}

function simulateRound(data: GameData, s: ImmersiveState, r: number, skipUser = false) {
  const m = mem(s)
  const rng = new Rng(`${s.seed}:round:${s.season}:${r}`)
  for (const f of m.rounds[r] ?? []) {
    if (skipUser && (f.home === s.clubId || f.away === s.clubId)) continue
    const h = m.table.find((x) => x.clubId === f.home)
    const a = m.table.find((x) => x.clubId === f.away)
    if (!h || !a) continue
    const [gh, ga] = simGoals(rng, s.world.clubs[f.home]?.strength ?? 65, s.world.clubs[f.away]?.strength ?? 65)
    addResult(h, a, gh, ga)
    creditScorers(data, s, f.home, gh, rng)
    creditScorers(data, s, f.away, ga, rng)
  }
  m.roundDone[r] = true
}

function liveTable(_data: GameData, state: ImmersiveState): StandingRow[] {
  const m = mem(state)
  return sortTable((m.table ?? []).map((r) => ({ ...r })))
}

// ───────────────────────────── partida: criação ─────────────────────────────

const emptyStats = (): UserMatchStats => ({ minutes: 0, goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, keyPasses: 0, dribbles: 0, tackles: 0, rating: 6 })

function createLive(data: GameData, s: ImmersiveState, it: CalendarItem): LiveMatch {
  const m = mem(s)
  const national = it.kind === 'national_match'
  const userTeam = national ? s.identity.nationality : s.clubId!
  const oppId = it.opponentId!
  const home = it.home ?? true
  const us = teamSide(data, userTeam, national)
  const them = teamSide(data, oppId, national)
  if (national && s.age <= 20) {
    us.name = `${us.name} Sub-20`
    them.name = `${them.name} Sub-20`
    us.strength -= 14
    them.strength -= 14
  }
  const rng = new Rng(`${s.seed}:plan:${it.id}`)
  // escalação: confiança do técnico + OVR relativo + energia
  const ovrGap = s.ovr - us.strength
  const score = s.relationships.coach + ovrGap * 1.6 + (s.condition.form - 50) * 0.2 + (national ? 12 : 0) + (it.importance ?? 0.4) * -6
  let status: LiveMatch['userStatus'] = score >= 50 ? 'starter' : 'bench'
  if (s.condition.injury || (s.condition.suspendedMatches ?? 0) > 0) status = 'out'
  else if (s.condition.fitness < 30) status = 'bench'
  const onAt = status === 'starter' ? 0 : status === 'bench' ? rng.int(56, 74) : 999
  const knockout = !national && it.competitionId !== m.leagueId && it.competitionId !== undefined && it.competitionId !== 'friendly'
  const live: LiveMatch = {
    itemId: it.id,
    fixtureKey: it.fixtureKey,
    competitionId: it.competitionId ?? m.leagueId,
    stage: it.stage,
    home: home ? us : them,
    away: home ? them : us,
    userSide: home ? 'home' : 'away',
    userStatus: status,
    userOnPitch: false,
    phase: 'pre',
    minute: 0,
    score: [0, 0],
    knockout,
    events: [],
    pendingMoment: null,
    stats: emptyStats(),
    team: { possession: [50, 50], shots: [0, 0], onTarget: [0, 0] },
    importance: it.importance ?? 0.4,
  }
  const hs = live.home.strength
  const as = live.away.strength
  const pos = clamp(Math.round(50 + (hs + 2 - as) * 0.7), 34, 66)
  live.team.possession = [pos, 100 - pos]
  m.plan = { bg: planBackground(data, s, live, rng, status), moments: planMoments(s, rng, status, onAt), onAt, startMinute: 0, momentsDone: 0 }
  return live
}

function planMoments(s: ImmersiveState, rng: Rng, status: LiveMatch['userStatus'], onAt: number): PlannedMoment[] {
  if (status === 'out') return []
  const p = s.identity.position
  const group: KeyMomentSituation[] =
    p === 'GOL'
      ? ['save', 'save', 'penalty_save', 'save']
      : p === 'ZAG' || p === 'LD' || p === 'LE'
        ? ['tackle', 'interception', 'block', 'header', 'cross', 'tackle']
        : p === 'VOL' || p === 'MC'
          ? ['pass', 'through_ball', 'tackle', 'shot', 'interception', 'free_kick']
          : p === 'ME' || p === 'MD' || p === 'MEI'
            ? ['through_ball', 'dribble', 'shot', 'free_kick', 'pass', 'cross']
            : ['shot', 'one_on_one', 'dribble', 'header', 'shot', 'free_kick']
  const n = status === 'starter' ? rng.int(3, 4) : rng.int(1, 2)
  const from = status === 'starter' ? 7 : onAt + 3
  const span = 88 - from
  const out: PlannedMoment[] = []
  for (let i = 0; i < n; i++) {
    const minute = Math.round(from + ((i + 0.3 + rng.next() * 0.5) / n) * span)
    let situation = rng.pick(group)
    if (rng.chance(p === 'GOL' ? 0.12 : 0.1) && p !== 'GOL') situation = 'penalty'
    const minigame: KeyMoment['minigame'] = situation === 'penalty' ? 'penalty_kick' : situation === 'penalty_save' ? 'penalty_save' : situation === 'free_kick' || (situation === 'shot' && rng.chance(0.35)) ? 'timing' : undefined
    out.push({ minute: Math.min(89, Math.max(from, minute)), situation, minigame })
  }
  // dedupe minutes
  out.sort((a, b) => a.minute - b.minute)
  for (let i = 1; i < out.length; i++) if (out[i].minute <= out[i - 1].minute) out[i].minute = Math.min(89, out[i - 1].minute + 3)
  return out
}

const AT = {
  goal: (side: 'home' | 'away', rng: Rng) => ({ x: side === 'home' ? rng.int(88, 97) : rng.int(3, 12), y: rng.int(38, 62) }),
  box: (side: 'home' | 'away', rng: Rng) => ({ x: side === 'home' ? rng.int(76, 92) : rng.int(8, 24), y: rng.int(26, 74) }),
  mid: (rng: Rng) => ({ x: rng.int(30, 70), y: rng.int(15, 85) }),
}

function planBackground(data: GameData, s: ImmersiveState, live: LiveMatch, rng: Rng, status: LiveMatch['userStatus']): MatchEvent[] {
  const ev: MatchEvent[] = []
  let [gh, ga] = simGoals(rng, live.home.strength, live.away.strength)
  // os lances do usuário também geram gols: tira um pouco do time dele
  if (status !== 'out') {
    if (live.userSide === 'home' && gh > 0 && rng.chance(0.55)) gh--
    if (live.userSide === 'away' && ga > 0 && rng.chance(0.55)) ga--
  }
  const hSquad = squadOf(data, live.home.id, s.seed)
  const aSquad = squadOf(data, live.away.id, s.seed)
  const keeper = (side: 'home' | 'away') => keeperOf(side === 'home' ? aSquad : hSquad)?.short ?? 'o goleiro'
  const scorer = (side: 'home' | 'away') => {
    const att = attackersOf(side === 'home' ? hSquad : aSquad)
    const any = side === 'home' ? hSquad : aSquad
    return (att.length ? rng.weighted(att, (p) => p.ovr - 50) : rng.pick(any)).name
  }
  const minute = () => rng.int(3, 90)
  const teamName = (side: 'home' | 'away') => (side === 'home' ? live.home.shortName : live.away.shortName)
  const add = (e: MatchEvent) => ev.push(e)
  for (const [side, n] of [
    ['home', gh],
    ['away', ga],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const pl = scorer(side)
      const squad = side === 'home' ? hSquad : aSquad
      const asst = rng.chance(0.7) ? rng.pick(squad.filter((p) => p.name !== pl && p.position !== 'GOL'))?.name : undefined
      add({ minute: minute(), type: 'goal', side, player: pl, assist: asst, text: '', at: AT.goal(side, rng) })
    }
    const chances = rng.int(3, 6)
    for (let i = 0; i < chances; i++) {
      const pl = scorer(side)
      const kind = rng.pick(['chance', 'chance', 'save', 'save', 'woodwork'] as const)
      add({ minute: minute(), type: kind, side, player: pl, text: '', at: AT.box(side, rng) })
    }
    const cards = rng.int(0, 3)
    const outfield = (side === 'home' ? hSquad : aSquad).filter((p) => p.position !== 'GOL')
    for (let i = 0; i < cards; i++) add({ minute: minute(), type: 'yellow', side, player: rng.pick(outfield)?.name, text: '', at: AT.mid(rng) })
    if (rng.chance(0.06)) add({ minute: rng.int(40, 88), type: 'red', side, player: rng.pick(outfield)?.name, text: '', at: AT.mid(rng) })
    const subs = rng.int(2, 3)
    for (let i = 0; i < subs; i++) {
      const squad = side === 'home' ? hSquad : aSquad
      const off = rng.pick(squad.slice(0, 11))?.name
      const on = rng.pick(squad.slice(11))?.name ?? rng.pick(squad)?.name
      add({ minute: rng.int(56, 84), type: 'sub_on', side, player: on, assist: off, text: '', at: { x: 50, y: 99 } })
    }
  }
  if (rng.chance(0.18)) add({ minute: minute(), type: 'var', side: rng.chance(0.5) ? 'home' : 'away', text: '', at: { x: 50, y: 50 } })
  ev.sort((a, b) => a.minute - b.minute)
  for (const e of ev) e.text = narrate(e, teamName, keeper, rng)
  return ev
}

function narrate(e: MatchEvent, teamName: (s: 'home' | 'away') => string, keeper: (s: 'home' | 'away') => string, rng: Rng): string {
  const t = teamName(e.side)
  const p = e.player ?? 'o camisa 9'
  switch (e.type) {
    case 'goal':
      return rng.pick([
        `GOOOL do ${t}! ${p} aproveita a sobra e bate firme${e.assist ? `, depois de passe de ${e.assist}` : ''}.`,
        `GOOOL! ${p} recebe${e.assist ? ` de ${e.assist}` : ''}, gira e manda no canto. Festa do ${t}!`,
        `É GOL! ${p} sobe mais que todo mundo e testa para o fundo da rede. ${t} comemora.`,
      ])
    case 'chance':
      return rng.pick([`${p} arrisca de fora da área e a bola passa raspando a trave.`, `Boa chance do ${t}: ${p} finaliza cruzado, para fora.`, `${p} escapa pela ponta, cruza e ninguém completa.`])
    case 'save':
      return rng.pick([`Grande defesa! ${keeper(e.side)} espalma o chute de ${p}.`, `${p} bate colocado e ${keeper(e.side)} faz milagre.`, `${keeper(e.side)} encaixa firme a finalização de ${p}.`])
    case 'woodwork':
      return `NA TRAVE! ${p} carimba o poste e o ${t} lamenta.`
    case 'yellow':
      return `Cartão amarelo para ${p} (${t}) após falta dura.`
    case 'red':
      return `VERMELHO! ${p} é expulso e o ${t} fica com um a menos.`
    case 'sub_on':
      return `Substituição no ${t}: sai ${e.assist ?? 'um titular'}, entra ${p}.`
    case 'var':
      return 'O VAR revisa um lance na área… segue o jogo.'
    default:
      return e.text
  }
}

// ───────────────────────────── partida: simulação ─────────────────────────────

const uSide = (l: LiveMatch) => l.userSide
const oSide = (l: LiveMatch): 'home' | 'away' => (l.userSide === 'home' ? 'away' : 'home')
const idx = (side: 'home' | 'away') => (side === 'home' ? 0 : 1)

function applyEvent(s: ImmersiveState, live: LiveMatch, e: MatchEvent, fx: ImmersiveEffect[]) {
  const i = idx(e.side)
  if (e.type === 'goal' || e.type === 'penalty_goal') {
    live.score[i]++
    live.team.shots[i]++
    live.team.onTarget[i]++
    if (live.userOnPitch) live.stats.rating = r1(live.stats.rating + (e.side === uSide(live) ? 0.15 : -0.12))
  } else if (e.type === 'own_goal') live.score[i]++
  else if (e.type === 'save' || e.type === 'penalty_miss') {
    live.team.shots[i]++
    if (e.type === 'save') live.team.onTarget[i]++
  } else if (e.type === 'chance' || e.type === 'woodwork') live.team.shots[i]++
  live.events.push(e)
  fx.push({ type: 'match_event', event: e })
}

function drift(s: ImmersiveState, live: LiveMatch, rng: Rng) {
  const [p] = live.team.possession
  const target = clamp(Math.round(50 + (live.home.strength + 2 - live.away.strength) * 0.7), 32, 68)
  const next = clamp(Math.round(p + (target - p) * 0.3 + rng.int(-3, 3)), 28, 72)
  live.team.possession = [next, 100 - next]
}

function kickoff(s: ImmersiveState, live: LiveMatch, fx: ImmersiveEffect[]) {
  live.phase = 'first_half'
  live.minute = 0
  const m = mem(s)
  if (m.plan!.onAt === 0) live.userOnPitch = true
  applyEvent(s, live, { minute: 0, type: 'kickoff', side: live.userSide, text: `Rola a bola! ${live.home.shortName} e ${live.away.shortName} começam a partida${live.stage ? ` · ${live.stage}` : ''}.`, at: { x: 50, y: 50 } }, fx)
}

/** Anda até o próximo lance-chave, intervalo ou fim. */
function simulate(data: GameData, s: ImmersiveState, fx: ImmersiveEffect[]) {
  const live = s.live!
  const m = mem(s)
  const plan = m.plan!
  const rng = new Rng(`${s.seed}:sim:${live.itemId}:${live.minute}:${m.tick}`)
  if (live.phase === 'pre') return kickoff(s, live, fx)
  if (live.phase === 'full_time' || live.pendingMoment) return
  if (live.phase === 'half_time') {
    live.phase = 'second_half'
    live.minute = 45
    applyEvent(s, live, { minute: 46, type: 'kickoff', side: oSide(live), text: 'Começa o segundo tempo!', at: { x: 50, y: 50 } }, fx)
    live.minute = 46
    return
  }
  if (live.phase === 'penalties') return shootout(data, s, fx)
  const endOfHalf = live.phase === 'first_half' ? 45 : 90
  const nextMoment = plan.moments.find((mm) => mm.minute > live.minute && (live.userOnPitch || mm.minute >= plan.onAt) && (plan.offAt == null || mm.minute < plan.offAt))
  const stop = Math.min(endOfHalf, nextMoment?.minute ?? 999)
  // entrada do banco
  if (!live.userOnPitch && plan.onAt < 999 && plan.onAt > live.minute && plan.onAt <= stop && plan.offAt == null) {
    // eventos até a entrada
    for (const e of plan.bg.filter((e) => e.minute > live.minute && e.minute <= plan.onAt)) applyEvent(s, live, e, fx)
    live.userOnPitch = true
    live.stats.rating = 6
    plan.startMinute = plan.onAt
    const squad = squadOf(data, uSide(live) === 'home' ? live.home.id : live.away.id, s.seed)
    const off = squad.find((p) => p.position === s.identity.position)?.name ?? squad[9]?.name
    applyEvent(s, live, { minute: plan.onAt, type: 'sub_on', side: uSide(live), byUser: true, player: s.identity.surname, assist: off, text: `Entra ${s.identity.surname}! Sai ${off}. A torcida aplaude a mudança.`, at: { x: 50, y: 99 } }, fx)
    live.minute = plan.onAt
    drift(s, live, rng)
    return
  }
  for (const e of plan.bg.filter((e) => e.minute > live.minute && e.minute <= stop)) applyEvent(s, live, e, fx)
  drift(s, live, rng)
  if (nextMoment && nextMoment.minute <= endOfHalf && nextMoment.minute === stop) {
    live.minute = stop
    const km = buildMoment(data, s, live, nextMoment)
    live.pendingMoment = km
    fx.push({ type: 'key_moment', moment: km })
    return
  }
  live.minute = endOfHalf
  const added = rng.int(1, 5)
  if (endOfHalf === 45) {
    live.phase = 'half_time'
    applyEvent(s, live, { minute: 45, addedTime: added, type: 'half_time', side: 'home', text: `Fim do primeiro tempo: ${live.home.shortName} ${live.score[0]} × ${live.score[1]} ${live.away.shortName}.`, at: { x: 50, y: 50 } }, fx)
  } else if (live.knockout && live.score[0] === live.score[1]) {
    live.phase = 'penalties'
    live.pens = [0, 0]
    applyEvent(s, live, { minute: 90, addedTime: added, type: 'full_time', side: 'home', text: 'Empate no tempo normal! A decisão vai para os pênaltis.', at: { x: 50, y: 50 } }, fx)
    if (live.userOnPitch && s.identity.position !== 'GOL') {
      const km = buildMoment(data, s, live, { minute: 90, situation: 'penalty', minigame: 'penalty_kick' })
      km.description = `Disputa por pênaltis. Você é o terceiro cobrador. ${live.home.shortName} ${live.score[0]} × ${live.score[1]} ${live.away.shortName} — tudo nos seus pés.`
      live.pendingMoment = km
      fx.push({ type: 'key_moment', moment: km })
    }
  } else endMatch(s, live, fx, added)
}

function endMatch(s: ImmersiveState, live: LiveMatch, fx: ImmersiveEffect[], added = 3) {
  live.phase = 'full_time'
  live.minute = 90
  const m = mem(s)
  const plan = m.plan!
  if (live.userOnPitch) live.stats.minutes = 90 - plan.startMinute
  else if (plan.offAt != null) live.stats.minutes = plan.offAt - plan.startMinute
  const us = live.score[idx(uSide(live))]
  const them = live.score[idx(oSide(live))]
  if (live.stats.minutes > 0) live.stats.rating = r1(clamp(live.stats.rating + (us > them ? 0.35 : us < them ? -0.3 : 0), 3, 10))
  const txt = live.pens
    ? `Fim de jogo nos pênaltis: ${live.home.shortName} ${live.pens[0]} × ${live.pens[1]} ${live.away.shortName}.`
    : `Fim de jogo: ${live.home.shortName} ${live.score[0]} × ${live.score[1]} ${live.away.shortName}.`
  applyEvent(s, live, { minute: 90, addedTime: added, type: 'full_time', side: 'home', text: txt, at: { x: 50, y: 50 } }, fx)
}

function shootout(data: GameData, s: ImmersiveState, fx: ImmersiveEffect[], userScored?: boolean) {
  const live = s.live!
  const rng = new Rng(`${s.seed}:pens:${live.itemId}`)
  let h = 0
  let a = 0
  for (let k = 0; k < 5; k++) {
    const isUserKick = k === 2 && userScored !== undefined
    const hk = isUserKick && uSide(live) === 'home' ? userScored : rng.chance(0.76)
    const ak = isUserKick && uSide(live) === 'away' ? userScored : rng.chance(0.74)
    if (hk) h++
    if (ak) a++
  }
  while (h === a) {
    const hk = rng.chance(0.72)
    const ak = rng.chance(0.72)
    if (hk) h++
    if (ak) a++
  }
  live.pens = [h, a]
  endMatch(s, live, fx)
}

// ───────────────────────────── lances-chave ─────────────────────────────

function teammate(data: GameData, s: ImmersiveState, live: LiveMatch, prefer: Position[] = ['CA', 'PE', 'PD', 'MEI']): SquadPlayer {
  const squad = squadOf(data, uSide(live) === 'home' ? live.home.id : live.away.id, s.seed)
  const xi = lineupOf(squad, s.identity.position).filter(Boolean) as SquadPlayer[]
  return xi.filter((p) => prefer.includes(p.position)).sort((a, b) => b.ovr - a.ovr)[0] ?? xi[0] ?? squad[0]
}
function opponentPlayer(data: GameData, s: ImmersiveState, live: LiveMatch, prefer: Position[]): SquadPlayer {
  const squad = squadOf(data, oSide(live) === 'home' ? live.home.id : live.away.id, s.seed)
  return squad.filter((p) => prefer.includes(p.position)).sort((a, b) => b.ovr - a.ovr)[0] ?? squad[0]
}

const pct = (base: number, a: number, mod = 0) => clamp(r1(base + (a - 60) / 90 + mod) , 0.08, 0.93)

function buildMoment(data: GameData, s: ImmersiveState, live: LiveMatch, pm: PlannedMoment): KeyMoment {
  const m = mem(s)
  const rng = new Rng(`${s.seed}:km:${live.itemId}:${pm.minute}`)
  const tm = teammate(data, s, live)
  const gk = opponentPlayer(data, s, live, ['GOL'])
  const def = opponentPlayer(data, s, live, ['ZAG', 'VOL'])
  const att = opponentPlayer(data, s, live, ['CA', 'PE', 'PD'])
  const us = live.score[idx(uSide(live))]
  const them = live.score[idx(oSide(live))]
  const ctx = us === them ? `Placar ${live.score[0]}–${live.score[1]}` : us > them ? `Vocês vencem por ${us}–${them}` : `Vocês perdem por ${us}–${them}`
  const stakes = live.importance >= 0.8 ? ', jogo grande' : live.minute >= 80 ? ', reta final' : ''
  const fin = attr(s, 'shooting')
  const dri = attr(s, 'dribbling')
  const pas = attr(s, 'passing')
  const dfn = attr(s, 'defending')
  const phy = attr(s, 'physical')
  const pac = attr(s, 'pace')
  const opts: (KeyMomentOption & { key: string })[] = []
  let description = ''
  const O = (id: string, label: string, detail: string, chance: number, icon: string, risk?: string) => opts.push({ id, key: id, label, detail, chance: clamp(chance, 0.06, 0.94), icon, risk })
  switch (pm.situation) {
    case 'shot':
      description = `${tm.short} ajeita na entrada da área e a bola sobra limpa para você. ${def.short} vem fechando.`
      O('shoot_placed', 'Chutar colocado', `FIN ${fin} · chute`, pct(0.34, fin), 'target')
      O('shoot_power', 'Bater forte', `FIN ${fin} · FIS ${phy}`, pct(0.28, (fin + phy) / 2), 'zap', 'Pode isolar')
      O('pass_tm', `Tocar para ${tm.short}`, `PAS ${pas} · passe`, pct(0.42, pas), 'send')
      break
    case 'one_on_one':
      description = `${tm.short} rola na medida e você sai cara a cara com ${gk.short}.`
      O('finish', 'Tirar do goleiro', `FIN ${fin} · chute`, pct(0.5, fin), 'target')
      O('round_gk', 'Driblar o goleiro', `DRI ${dri} · drible`, pct(0.4, dri), 'zap', 'Perde a bola')
      O('square', `Rolar para ${tm.short}`, `PAS ${pas} · passe`, pct(0.52, pas), 'send')
      break
    case 'dribble':
      description = `Você recebe aberto pela ponta, ${def.short} no mano a mano.`
      O('take_on', 'Partir para cima', `DRI ${dri} · VEL ${pac}`, pct(0.42, (dri + pac) / 2), 'zap', 'Contra-ataque')
      O('one_two', `Tabelar com ${tm.short}`, `PAS ${pas} · tabela`, pct(0.46, pas), 'repeat')
      O('cut_in', 'Cortar para dentro e chutar', `FIN ${fin} · chute`, pct(0.26, fin), 'target')
      break
    case 'pass':
    case 'through_ball':
      description = `Você tem a bola no meio. ${tm.short} dá o pique nas costas de ${def.short}.`
      O('through', `Enfiar para ${tm.short}`, `PAS ${pas} · enfiada`, pct(0.4, pas), 'send')
      O('switch', 'Inverter o jogo', `PAS ${pas} · lançamento`, pct(0.52, pas, 0.04), 'arrow')
      O('long_shot', 'Arriscar de longe', `FIN ${fin} · chute`, pct(0.16, fin), 'target', 'Perde a posse')
      break
    case 'cross':
      description = `Você chega ao fundo pela lateral. ${tm.short} e mais dois na área.`
      O('cross_high', 'Cruzar na área', `PAS ${pas} · cruzamento`, pct(0.36, pas), 'send')
      O('low_cross', 'Cruzamento rasteiro', `PAS ${pas} · passe`, pct(0.4, pas), 'arrow')
      O('cut_back', 'Cortar e chutar', `FIN ${fin} · chute`, pct(0.2, fin), 'target')
      break
    case 'header':
      description = `Escanteio para vocês. A bola vem na segunda trave, você sobe com ${def.short}.`
      O('head_goal', 'Cabecear no canto', `FIS ${phy} · FIN ${fin}`, pct(0.3, (phy + fin) / 2), 'target')
      O('head_down', `Escorar para ${tm.short}`, `FIS ${phy} · passe`, pct(0.38, phy), 'send')
      break
    case 'free_kick':
      description = `Falta na meia-lua. Barreira armada, ${gk.short} ajeita o posicionamento.`
      O('fk_over', 'Por cima da barreira', `FIN ${fin} · falta`, pct(0.24, fin), 'target')
      O('fk_low', 'Rasteiro no canto do goleiro', `FIN ${fin} · surpresa`, pct(0.18, fin), 'zap', 'Barreira')
      O('fk_cross', 'Cruzar na área', `PAS ${pas} · cruzamento`, pct(0.34, pas), 'send')
      break
    case 'penalty':
      description = `PÊNALTI! Você pega a bola. ${gk.short} se mexe na linha${stakes}.`
      O('left', 'Canto esquerdo', `FIN ${fin} · colocado`, pct(0.66, fin), 'arrow-left')
      O('center', 'Meio (cavadinha)', 'Frieza · alto risco', pct(0.58, fin, -0.06), 'arrow-up', 'Vira meme se errar')
      O('right', 'Canto direito', `FIN ${fin} · forte`, pct(0.66, fin), 'arrow-right')
      break
    case 'tackle':
      description = `${att.short} arranca em velocidade na sua direção. Contra-ataque perigoso.`
      O('tackle', 'Dar o bote', `DEF ${dfn} · desarme`, pct(0.44, dfn), 'shield', 'Cartão amarelo')
      O('jockey', 'Acompanhar', `DEF ${dfn} · VEL ${pac}`, pct(0.52, (dfn + pac) / 2), 'move')
      O('slide', 'Carrinho', `DEF ${dfn} · FIS ${phy}`, pct(0.38, (dfn + phy) / 2), 'zap', 'Vermelho / pênalti')
      break
    case 'interception':
      description = `O ${oSide(live) === 'home' ? live.home.shortName : live.away.shortName} troca passes na intermediária procurando ${att.short}.`
      O('anticipate', 'Antecipar', `DEF ${dfn} · VEL ${pac}`, pct(0.42, (dfn + pac) / 2), 'zap', 'Deixa espaço')
      O('cover', 'Fechar a linha de passe', `DEF ${dfn} · posição`, pct(0.52, dfn), 'shield')
      O('press', 'Pressionar a saída', `FIS ${phy} · pressão`, pct(0.44, phy), 'move')
      break
    case 'block':
      description = `${att.short} ajeita para o chute na entrada da área. Você é o último homem.`
      O('block', 'Bloquear o chute', `DEF ${dfn} · FIS ${phy}`, pct(0.5, (dfn + phy) / 2), 'shield')
      O('angle', 'Fechar o ângulo', `DEF ${dfn} · posição`, pct(0.46, dfn), 'move')
      break
    case 'save':
      description = `${att.short} invade a área e finaliza de perto!`
      O('parry', 'Espalmar para escanteio', `ELA ${attr(s, 'diving')} · reflexo`, pct(0.52, attr(s, 'diving')), 'hand')
      O('catch', 'Encaixar', `FIR ${attr(s, 'handling')} · encaixe`, pct(0.44, attr(s, 'handling')), 'shield', 'Rebote')
      O('rush', 'Sair nos pés', `POS ${attr(s, 'positioning')} · saída`, pct(0.4, attr(s, 'positioning')), 'zap', 'Pênalti')
      break
    case 'penalty_save':
      description = `Pênalti contra! ${att.short} ajeita a bola. Você na linha${stakes}.`
      O('left', 'Pular à esquerda', `ELA ${attr(s, 'diving')}`, pct(0.3, attr(s, 'diving')), 'arrow-left')
      O('center', 'Ficar no meio', `REF ${attr(s, 'reflexes')}`, pct(0.22, attr(s, 'reflexes')), 'arrow-up')
      O('right', 'Pular à direita', `ELA ${attr(s, 'diving')}`, pct(0.3, attr(s, 'diving')), 'arrow-right')
      break
  }
  // opção padrão = mais segura (maior chance)
  const defaultOpt = opts.slice().sort((a, b) => b.chance - a.chance)[0]
  const attrMap: Record<string, number> = {}
  for (const o of opts) attrMap[o.id] = o.chance
  m.plan!.pending = { id: '', defaultId: defaultOpt.id, attr: attrMap }
  const attacking = !['tackle', 'interception', 'block', 'save', 'penalty_save'].includes(pm.situation)
  const side = attacking ? uSide(live) : oSide(live)
  const at = pm.situation === 'penalty' || pm.situation === 'penalty_save' ? { x: side === 'home' ? 89 : 11, y: 50 } : attacking ? AT.box(side, rng) : { x: side === 'home' ? rng.int(62, 80) : rng.int(20, 38), y: rng.int(25, 75) }
  const km: KeyMoment = {
    id: `${live.itemId}:${pm.minute}:${pm.situation}`,
    minute: pm.minute,
    situation: pm.situation,
    description: `${description} ${ctx}${stakes}.`,
    options: opts.map(({ key: _k, ...o }) => ({ ...o, chance: r1(o.chance * 100) / 100 })),
    timeLimitMs: pm.situation === 'penalty' || pm.situation === 'penalty_save' ? 12000 : 10000,
    minigame: pm.minigame,
    at,
  }
  m.plan!.pending.id = km.id
  return km
}

function resolveMoment(data: GameData, s: ImmersiveState, optionId: string | null, mini: { side?: 'left' | 'center' | 'right'; timing?: number } | undefined, fx: ImmersiveEffect[], timeout = false) {
  const live = s.live!
  const km = live.pendingMoment!
  const m = mem(s)
  const plan = m.plan!
  const rng = new Rng(`${s.seed}:res:${km.id}:${optionId}:${mini?.side ?? ''}:${Math.round((mini?.timing ?? 0) * 20)}`)
  const opt = km.options.find((o) => o.id === optionId) ?? km.options.find((o) => o.id === plan.pending?.defaultId) ?? km.options[0]
  let chance = opt.chance
  if (mini?.timing != null) chance = clamp(chance * (0.55 + 0.75 * mini.timing), 0.05, 0.95)
  if (timeout) chance *= 0.85
  const minute = km.minute
  const tm = teammate(data, s, live)
  const us = uSide(live)
  const them = oSide(live)
  const me = s.identity.surname
  const at = km.at ?? { x: 50, y: 50 }
  let success: boolean
  let goal = false
  let text = ''
  const st = live.stats
  const add = (e: Omit<MatchEvent, 'minute'>) => applyEvent(s, live, { minute, ...e }, fx)
  // pênaltis: canto × goleiro
  if (km.minigame === 'penalty_kick') {
    const side = mini?.side ?? (opt.id as 'left' | 'center' | 'right')
    const keeperSide = rng.weighted(['left', 'center', 'right'] as const, (x) => (x === 'center' ? 0.2 : 0.4))
    success = keeperSide !== side ? rng.chance(side === 'center' ? 0.97 : 0.92) : side === 'center' ? false : rng.chance(0.18)
    st.shots++
    if (success) st.shotsOnTarget++
    if (live.phase === 'penalties') {
      live.pendingMoment = null
      text = success ? `Converte! ${me} bate no ${side === 'left' ? 'canto esquerdo' : side === 'right' ? 'canto direito' : 'meio'}, o goleiro vai para o outro lado.` : `Defendeu! O goleiro adivinha o canto de ${me}.`
      add({ type: success ? 'penalty_goal' : 'penalty_miss', side: us, byUser: true, player: me, text, at })
      // placar do jogo não muda nos pênaltis
      if (success) live.score[idx(us)]--
      live.stats.rating = r1(clamp(live.stats.rating + (success ? 0.3 : -0.4), 3, 10))
      fx.push({ type: 'moment_result', success, text, goal: success })
      shootout(data, s, fx, success)
      return
    }
    text = success ? `GOOOL! ${me} bate com categoria e desloca o goleiro!` : `PERDEU! O goleiro espalma a cobrança de ${me}.`
    add({ type: success ? 'penalty_goal' : 'penalty_miss', side: us, byUser: true, player: me, text, at })
    if (success) {
      st.goals++
      goal = true
    }
  } else if (km.minigame === 'penalty_save') {
    const side = mini?.side ?? (opt.id as 'left' | 'center' | 'right')
    const shot = rng.weighted(['left', 'center', 'right'] as const, (x) => (x === 'center' ? 0.18 : 0.41))
    success = shot === side ? rng.chance(0.72) : rng.chance(0.06)
    st.saves = (st.saves ?? 0) + (success ? 1 : 0)
    text = success ? `PEGOU! ${me} voa no canto e defende o pênalti!` : `Gol do adversário. ${me} vai para um lado, a bola para o outro.`
    add({ type: success ? 'penalty_miss' : 'penalty_goal', side: them, byUser: true, player: success ? undefined : opponentPlayer(data, s, live, ['CA']).name, text, at })
    if (!success) st.conceded = (st.conceded ?? 0) + 1
  } else {
    success = rng.chance(chance)
    const sit = km.situation
    const shooting = ['shoot_placed', 'shoot_power', 'finish', 'round_gk', 'cut_in', 'long_shot', 'head_goal', 'fk_over', 'fk_low', 'cut_back'].includes(opt.id)
    const passing = ['pass_tm', 'square', 'one_two', 'through', 'switch', 'cross_high', 'low_cross', 'head_down', 'fk_cross'].includes(opt.id)
    if (sit === 'save') {
      text = success ? `Milagre de ${me}! Defesa espetacular.` : `Não deu. A bola passa por ${me} e morre no fundo da rede.`
      add({ type: success ? 'save' : 'goal', side: them, byUser: true, player: opponentPlayer(data, s, live, ['CA', 'PE']).name, text, at })
      if (success) st.saves = (st.saves ?? 0) + 1
      else st.conceded = (st.conceded ?? 0) + 1
    } else if (shooting) {
      st.shots++
      if (success) {
        st.shotsOnTarget++
        st.goals++
        goal = true
        text = rng.pick([`GOOOL! ${me} ${sit === 'header' ? 'testa firme' : 'finaliza com categoria'} e estufa a rede!`, `É DELE! ${me} não perdoa e marca um golaço!`, `GOL DE ${me.toUpperCase()}! Que finalização!`])
        add({ type: 'goal', side: us, byUser: true, player: me, assist: sit === 'one_on_one' || sit === 'shot' ? tm.name : undefined, text, at: { x: us === 'home' ? 93 : 7, y: at.y } })
      } else {
        const onT = rng.chance(0.5)
        if (onT) st.shotsOnTarget++
        text = onT ? `Defesa do goleiro! A finalização de ${me} para nas mãos dele.` : rng.chance(0.3) ? `NA TRAVE! ${me} acerta o poste!` : `Para fora! ${me} finaliza e a bola passa perto.`
        add({ type: onT ? 'save' : text.includes('TRAVE') ? 'woodwork' : 'chance', side: us, byUser: true, player: me, text, at })
      }
    } else if (passing) {
      st.keyPasses++
      if (success) {
        const conv = rng.chance(0.62)
        if (conv) {
          st.assists++
          goal = true
          text = `GOL! Passe perfeito de ${me} e ${tm.short} só empurra para as redes!`
          add({ type: 'goal', side: us, byUser: true, player: tm.name, assist: me, text, at: { x: us === 'home' ? 92 : 8, y: at.y } })
        } else {
          text = `Que passe de ${me}! ${tm.short} finaliza, mas o goleiro salva.`
          add({ type: 'save', side: us, byUser: true, player: tm.name, assist: me, text, at })
        }
      } else {
        text = `O passe de ${me} é interceptado. Perde a posse.`
        add({ type: 'key_moment', side: us, byUser: true, player: me, text, at })
      }
    } else if (['take_on'].includes(opt.id)) {
      st.dribbles++
      if (success) {
        const conv = rng.chance(0.4)
        text = conv ? `${me} deixa o marcador no chão e bate cruzado: GOOOL!` : `${me} passa como quer pelo marcador e cruza, a zaga afasta.`
        if (conv) {
          st.goals++
          st.shots++
          st.shotsOnTarget++
          goal = true
        }
        add({ type: conv ? 'goal' : 'chance', side: us, byUser: true, player: me, text, at })
      } else {
        text = `${me} tenta o drible e perde a bola. Contra-ataque adversário!`
        add({ type: 'key_moment', side: us, byUser: true, player: me, text, at })
        if (rng.chance(0.25)) {
          const scorer = opponentPlayer(data, s, live, ['CA', 'PE', 'PD'])
          add({ type: 'goal', side: them, player: scorer.name, text: `GOL do ${them === 'home' ? live.home.shortName : live.away.shortName}! ${scorer.short} aproveita o contra-ataque.`, at: AT.goal(them, rng) })
        }
      }
    } else {
      // defensivos
      st.tackles++
      if (success) {
        text = rng.pick([`${me} dá o bote certeiro e recupera a bola!`, `Leitura perfeita de ${me}, que corta o lance.`, `${me} trava tudo! A torcida vibra.`])
        add({ type: 'key_moment', side: us, byUser: true, player: me, text, at })
      } else {
        const card = opt.risk && rng.chance(opt.id === 'slide' ? 0.55 : 0.35)
        text = card ? `Falta de ${me}. Cartão amarelo.` : `${me} chega atrasado e o adversário escapa.`
        if (card) {
          st.yellow = true
          add({ type: 'yellow', side: us, byUser: true, player: me, text, at })
        } else add({ type: 'key_moment', side: us, byUser: true, player: me, text, at })
        if (rng.chance(0.35)) {
          const scorer = opponentPlayer(data, s, live, ['CA', 'PE', 'PD'])
          add({ type: 'goal', side: them, player: scorer.name, text: `GOL do ${them === 'home' ? live.home.shortName : live.away.shortName}. ${scorer.short} finaliza sem chance para o goleiro.`, at: AT.goal(them, rng) })
        }
      }
    }
  }
  live.stats.rating = r1(clamp(live.stats.rating + (goal ? 0.9 : success ? 0.3 : -0.3) + (timeout ? -0.1 : 0), 3, 10))
  live.pendingMoment = null
  plan.momentsDone++
  if (plan.pending) plan.pending = undefined
  fx.push({ type: 'moment_result', success, text: text || (success ? 'Deu certo!' : 'Não deu.'), goal })
  if (timeout) s.condition.morale = clamp(s.condition.morale - 1, 0, 100)
}

// ───────────────────────────── fim de jogo ─────────────────────────────

function finishMatch(data: GameData, s: ImmersiveState, fx: ImmersiveEffect[]) {
  const live = s.live!
  const it = current(s)!
  const m = mem(s)
  const plan = m.plan
  const us = live.score[idx(uSide(live))]
  const them = live.score[idx(oSide(live))]
  const won = live.pens ? live.pens[idx(uSide(live))] > live.pens[idx(oSide(live))] : us > them
  const lost = live.pens ? !won : us < them
  const res: 'V' | 'E' | 'D' = won ? 'V' : lost ? 'D' : 'E'
  const st = live.stats
  const played = st.minutes > 0
  const national = it.kind === 'national_match'
  const oppId = uSide(live) === 'home' ? live.away.id : live.home.id
  // estatísticas
  if (played) {
    if (national) {
      s.national.apps++
      s.national.goals += st.goals
      s.national.assists += st.assists
      s.national.firstCallUp ??= s.season
    } else {
      s.seasonStats.apps++
      if (live.userStatus === 'starter') s.seasonStats.starts++
      s.seasonStats.minutes += st.minutes
      s.seasonStats.goals += st.goals
      s.seasonStats.assists += st.assists
      s.seasonStats.ratingSum = r1(s.seasonStats.ratingSum + st.rating)
      if (them === 0 && (s.identity.position === 'GOL' || ['ZAG', 'LD', 'LE'].includes(s.identity.position)) && st.minutes >= 60) s.seasonStats.cleanSheets++
    }
    m.ratings = [...m.ratings, st.rating].slice(-5)
  }
  const motm = played && st.rating >= 7.8 && !lost
  if (motm && !national) s.seasonStats.motm++
  // condição e relações
  s.condition.fitness = clamp(Math.round(s.condition.fitness - st.minutes * 0.3), 5, 100)
  s.condition.sharpness = clamp(Math.round(s.condition.sharpness + (played ? st.minutes / 7 : -4)), 0, 100)
  const avg = m.ratings.length ? m.ratings.reduce((a, b) => a + b, 0) / m.ratings.length : 6.5
  s.condition.form = clamp(Math.round((avg - 5) * 25), 5, 100)
  s.condition.morale = clamp(Math.round(s.condition.morale + (won ? 4 : lost ? -5 : 0) + st.goals * 3 + (played ? 0 : -3)), 0, 100)
  const R = s.relationships
  if (played) R.coach = clamp(Math.round(R.coach + (st.rating - 6.6) * 5 + (st.yellow ? -1 : 0)), 0, 100)
  else R.coach = clamp(R.coach - 1, 0, 100)
  R.fans = clamp(Math.round(R.fans + st.goals * 3 + st.assists + (won ? 1 : lost ? -1 : 0) + (motm ? 2 : 0)), 0, 100)
  R.teammates = clamp(Math.round(R.teammates + (won ? 1 : 0) + st.assists), 0, 100)
  R.media = clamp(Math.round(R.media + st.goals * 2 + (motm ? 2 : 0)), 0, 100)
  s.reputation = clamp(Math.round(s.reputation + st.goals * 0.6 + (motm ? 0.6 : 0) + live.importance * (won ? 0.5 : 0)), 0, 100)
  m.followers = Math.round(m.followers * (1 + st.goals * 0.07 + (motm ? 0.05 : 0) + (won ? 0.01 : 0)) + st.goals * 400)
  if (st.goals) s.finance.balance += (s.finance.bonuses?.perGoal ?? 0) * st.goals
  if (st.yellow) s.condition.suspendedMatches = 0
  // conquistas
  const ach = (id: string) => {
    if (!s.achievements.includes(id)) {
      s.achievements.push(id)
      fx.push({ type: 'achievement', id })
    }
  }
  if (played) ach('imersivo-estreia')
  if (st.goals > 0) ach('imersivo-primeiro-gol')
  if (st.goals >= 3) ach('imersivo-hat-trick')
  if (national && played) ach('imersivo-selecao')
  // tabela
  if (!national) {
    m.form = [...m.form, res].slice(-5)
    m.lastResult = { res, goals: st.goals, oppId, score: [...live.score] as [number, number], userSide: live.userSide }
    if (it.competitionId === m.leagueId) {
      const h = m.table.find((r) => r.clubId === live.home.id)
      const a = m.table.find((r) => r.clubId === live.away.id)
      if (h && a) addResult(h, a, live.score[0], live.score[1])
      const scorersUs = live.events.filter((e) => (e.type === 'goal' || e.type === 'penalty_goal') && e.side === uSide(live) && e.player)
      const scorersThem = live.events.filter((e) => (e.type === 'goal' || e.type === 'penalty_goal') && e.side === oSide(live) && e.player)
      const rng = new Rng(`${s.seed}:credit:${it.id}`)
      creditScorers(data, s, s.clubId!, scorersUs.length, rng, scorersUs.map((e) => e.player!))
      creditScorers(data, s, oppId, scorersThem.length, rng, scorersThem.map((e) => e.player!))
      const r = it.week - 1
      if (r >= 0 && !m.roundDone[r]) simulateRound(data, s, r, true)
    } else {
      // mata-mata
      const cup = m.cups.find((c) => c.competitionId === it.competitionId)
      if (cup) {
        if (!won) {
          cup.alive = false
          s.calendar = s.calendar.filter((c, i) => !(i > s.cursor && !c.done && c.competitionId === it.competitionId))
          s.news.unshift(news(s, `${clubOf(data, s.clubId)?.shortName} cai na ${it.stage ?? 'copa'} para o ${nameOf(data, oppId)}`, 'negative', 'Diário da Bola'))
        } else if (it.stage === 'Final') {
          const comp = data.competitions.find((c) => c.id === it.competitionId)
          const tw: TrophyWin = { trophyId: comp?.trophyId ?? 'cup-generic', competitionId: it.competitionId!, season: s.season, teamId: s.clubId!, scope: 'club', kind: comp?.kind }
          s.trophies.push(tw)
          m.seasonTrophies.push(tw)
          s.finance.balance += s.finance.bonuses?.perTitle ?? 0
          fx.push({ type: 'trophy', trophy: tw })
          s.log.push({ season: s.season, age: s.age, type: 'trophy', text: `Campeão da ${comp?.name ?? 'copa'}.`, data: { trophyId: tw.trophyId } })
          ach('imersivo-primeiro-titulo')
        }
      }
    }
  }
  s.marketValue = marketValueOf(s.ovr, s.age, s.potential)
  // mídia
  const clubShort = national ? live[uSide(live)].shortName : clubOf(data, s.clubId)?.shortName ?? 'Clube'
  const oppShort = live[oSide(live)].shortName
  const sc = `${live.score[idx(uSide(live))]}×${live.score[idx(oSide(live))]}`
  const outlet = OUTLETS[(m.tick + s.week) % OUTLETS.length]
  const me = s.identity.surname
  let headline: string
  let tone: NewsItem['tone'] = won ? 'positive' : lost ? 'negative' : 'neutral'
  if (st.goals >= 2) headline = `${me} brilha com ${st.goals} gols e ${clubShort} ${won ? 'vence' : 'empata com'} o ${oppShort}`
  else if (st.goals === 1 && won) headline = `${me} decide e ${clubShort} bate o ${oppShort} por ${sc}`
  else if (st.assists && won) headline = `Garçom: ${me} dá assistência na vitória do ${clubShort}`
  else if (!played) headline = `${me} fica no banco e ${clubShort} ${won ? 'vence' : lost ? 'perde para' : 'empata com'} o ${oppShort}`
  else if (st.rating < 5.8) ((headline = `Noite para esquecer: ${me} vai mal em ${won ? 'vitória' : 'tropeço'} do ${clubShort}`), (tone = 'negative'))
  else headline = won ? `${clubShort} vence o ${oppShort} por ${sc}` : lost ? `${clubShort} perde para o ${oppShort} e liga o alerta` : `${clubShort} e ${oppShort} empatam: ${sc}`
  const item = news(s, headline, tone, outlet, played ? `Nota ${st.rating.toFixed(1).replace('.', ',')} · ${st.minutes} minutos em campo.` : undefined)
  s.news.unshift(item)
  fx.push({ type: 'news', item })
  const club = clubOf(data, s.clubId)
  const fans = national ? live[uSide(live)].shortName.toLowerCase() : slug(club?.abbr ?? 'clube')
  const likesBase = Math.round(m.followers * 0.08 + 200)
  if (st.goals > 0) s.social.unshift(post(s, national ? `${live[uSide(live)].name}` : club?.name ?? clubShort, `@${national ? 'selecao' : slug(club?.shortName ?? 'clube')}`, `GOOOL DE ${me.toUpperCase()}! ⚽🔥 ${clubShort} ${sc} ${oppShort}`, 'positive', { verified: true, likes: likesBase * 6, reposts: likesBase }))
  s.social.unshift(
    post(
      s,
      'Torcedor',
      `@${fans}_${['raiz', 'fiel', 'sempre', '1914', 'doente'][s.week % 5]}`,
      won ? (st.goals ? `${cap(me)} é craque, não tem jeito. Que jogador!` : `Vitória importante! Seguimos.`) : lost ? (played && st.rating < 6 ? `${cap(me)} sumiu hoje. Precisa de mais.` : `Inaceitável perder esse jogo.`) : `Empate com gosto amargo…`,
      won ? 'positive' : lost ? 'negative' : 'neutral',
      { likes: Math.round(likesBase * 0.4), reposts: Math.round(likesBase * 0.05) },
    ),
  )
  if (played && st.rating >= 8)
    s.social.unshift(post(s, OUTLETS[1], '@radioarquibancada', `Nota ${st.rating.toFixed(1).replace('.', ',')} para ${me}: o melhor em campo em ${clubShort} ${sc} ${oppShort}. #Craque${slug(me)}`, 'positive', { verified: true, likes: likesBase, reposts: Math.round(likesBase * 0.2) }))
  s.social = s.social.slice(0, 60)
  s.news = s.news.slice(0, 60)
  // técnico comenta
  if (played && (st.rating >= 8.2 || st.rating <= 5.5)) s.inbox.unshift(msg(s, 'Técnico', st.rating >= 8.2 ? 'Grande jogo' : 'Precisamos conversar', st.rating >= 8.2 ? 'É isso que eu quero de você. Continue assim e a vaga é sua.' : 'Esperava mais. Treine forte esta semana, que eu quero ver reação.'))
  fx.push({ type: 'toast', tone: won ? 'success' : lost ? 'danger' : 'info', title: `${won ? 'Vitória' : lost ? 'Derrota' : 'Empate'} · ${clubShort} ${sc} ${oppShort}`, description: played ? `Sua nota: ${st.rating.toFixed(1).replace('.', ',')}${st.goals ? ` · ${st.goals} gol${st.goals > 1 ? 's' : ''}` : ''}${st.assists ? ` · ${st.assists} assist.` : ''}` : 'Você não entrou em campo.' })
  const result = { score: [...live.score] as [number, number], userGoals: st.goals, userAssists: st.assists, rating: st.rating, played }
  s.live = null
  m.plan = undefined
  complete(data, s, fx, result)
}

// ───────────────────────────── treino ─────────────────────────────

function train(data: GameData, s: ImmersiveState, focus: TrainingFocus, intensity: 'leve' | 'normal' | 'intensa', fx: ImmersiveEffect[]) {
  const rng = new Rng(`${s.seed}:train:${s.season}:${s.week}:${focus}:${intensity}`)
  const meta = TRAINING_FOCUS[focus]
  const I = INTENSITY[intensity]
  const gk = isGk(s.identity.position)
  const keys = (gk ? meta.gkAttrs : meta.attrs).filter((k) => attrKeys(s.identity.position).includes(k))
  const before = s.ovr
  const ageF = s.age <= 19 ? 1.25 : s.age <= 23 ? 1 : s.age <= 28 ? 0.7 : 0.35
  const room = clamp((s.potential - s.ovr) / 20, 0.15, 1.2)
  const ups: string[] = []
  for (const k of keys) {
    const cur = attr(s, k)
    const p = clamp(0.42 * I.gain * ageF * room * (s.condition.fitness < 40 ? 0.6 : 1), 0.05, 0.92)
    let d = rng.chance(p) ? 1 : 0
    if (d && intensity === 'intensa' && rng.chance(0.3)) d = 2
    if (d) {
      ;(s.attributes as unknown as Record<string, number>)[k] = Math.min(99, cur + d)
      fx.push({ type: 'attribute_up', key: k, from: cur, to: cur + d })
      ups.push(`+${d} ${ATTR_LABEL[k].label}`)
    }
  }
  const rec = RECOVERY_GAIN[focus] ?? 0
  s.condition.fitness = clamp(Math.round(s.condition.fitness + (rec ? rec : I.fitness)), 0, 100)
  if (!rec) s.condition.sharpness = clamp(s.condition.sharpness + I.sharp, 0, 100)
  if (focus === 'rest') s.condition.morale = clamp(s.condition.morale + 5, 0, 100)
  if (focus === 'tactical') s.relationships.coach = clamp(s.relationships.coach + (intensity === 'intensa' ? 3 : 2), 0, 100)
  if (!rec && intensity === 'intensa') s.relationships.coach = clamp(s.relationships.coach + 1, 0, 100)
  if (!rec && focus !== 'rest' && rng.chance(I.injury * (s.condition.fitness < 35 ? 2.5 : 1))) {
    const weeks = rng.int(1, 3)
    s.condition.injury = { name: rng.pick(['Lesão muscular na coxa', 'Entorse no tornozelo', 'Contusão no joelho']), weeksLeft: weeks }
    fx.push({ type: 'toast', tone: 'danger', title: 'Lesão no treino', description: `${s.condition.injury.name} · ${weeks} semana${weeks > 1 ? 's' : ''} fora.` })
    s.news.unshift(news(s, `${s.identity.surname} sente lesão e vira desfalque`, 'negative', 'Jornal do Gramado'))
  }
  s.ovr = ovrOf(s.attributes, s.identity.position)
  if (s.ovr !== before) {
    fx.push({ type: 'ovr_change', from: before, to: s.ovr })
    s.marketValue = marketValueOf(s.ovr, s.age, s.potential)
  }
  fx.push({ type: 'toast', tone: ups.length ? 'success' : 'info', title: `Treino ${INTENSITY[intensity].label.toLowerCase()} · ${meta.label}`, description: ups.length ? ups.join(' · ') : rec ? `Energia ${s.condition.fitness}` : 'Sem evolução visível desta vez.' })
  complete(data, s, fx)
}

// ───────────────────────────── coletiva ─────────────────────────────

function buildPress(data: GameData, s: ImmersiveState): PressQuestion[] {
  const m = mem(s)
  const it = current(s)
  const opp = it?.opponentId ? nameOf(data, it.opponentId) : 'o próximo adversário'
  const club = clubOf(data, s.clubId)
  const rng = new Rng(`${s.seed}:press:${s.season}:${s.week}`)
  const j = () => rng.pick([['Marina Lopes', OUTLETS[1]], ['Caio Ribas', OUTLETS[0]], ['Bia Tavares', OUTLETS[2]], ['Tonho Vieira', OUTLETS[4]], ['Rafa Duarte', OUTLETS[3]]] as const)
  const qs: { q: string; a: [string, PressQuestion['answers'][number]['tone'], string[], Partial<Deltas>][] }[] = []
  const last = m.lastResult
  qs.push({
    q: last ? (last.res === 'V' ? `Vitória na última rodada. O ${club?.shortName} chega embalado contra o ${opp}?` : last.res === 'D' ? `Depois da derrota, a pressão aumentou. O que muda contra o ${opp}?` : `O empate deixou gosto amargo? Como encarar o ${opp}?`) : `Qual é a sua expectativa para o duelo contra o ${opp}?`,
    a: [
      ['“Respeito muito o adversário. Vamos com humildade e trabalho.”', 'humilde', ['Técnico +', 'Vestiário +'], { coach: 2, teammates: 2 }],
      ['“Estamos prontos. Em casa ou fora, a gente vai para ganhar.”', 'confiante', ['Torcida +', 'Mídia +'], { fans: 3, media: 2, morale: 2 }],
      [`“O ${opp} que se preocupe com a gente.”`, 'provocador', ['Torcida ++', 'Mídia −', 'Pressão ▲'], { fans: 5, media: -3, coach: -1 }],
      ['“Pergunta para o professor. Eu só penso no treino.”', 'evasivo', ['Sem efeito'], {}],
    ],
  })
  const bench = s.seasonStats.apps > 0 && s.seasonStats.starts < s.seasonStats.apps / 2
  qs.push({
    q: bench ? 'Você tem começado no banco. Está incomodado com a reserva?' : `Você vive boa fase${s.seasonStats.goals ? ` com ${s.seasonStats.goals} gols` : ''}. Já se sente titular absoluto?`,
    a: [
      ['“Quem decide é o treinador. Eu trabalho para estar pronto.”', 'humilde', ['Técnico ++'], { coach: 4 }],
      ['“Eu sei do meu potencial. Minha hora vai chegar — ou já chegou.”', 'confiante', ['Mídia +', 'Técnico −'], { media: 3, coach: -1, morale: 2 }],
      ['“Se não tiver espaço aqui, vai ter em outro lugar.”', 'provocador', ['Diretoria −−', 'Proposta ▲', 'Torcida −'], { coach: -4, fans: -3, media: 4, reputation: 1 }],
      ['“Isso é conversa para dentro do vestiário.”', 'evasivo', ['Vestiário +'], { teammates: 2 }],
    ],
  })
  const rumor = s.offers.find((o) => o.kind !== 'renewal')
  qs.push({
    q: rumor ? `O ${nameOf(data, rumor.clubId)} fez uma proposta por você. Você garante que fica no ${club?.shortName}?` : `Os torcedores já cantam o seu nome. O que você diz para a torcida do ${club?.shortName}?`,
    a: rumor
      ? [
          ['“Estou feliz aqui. Meu foco é o clube.”', 'humilde', ['Torcida +', 'Diretoria +'], { fans: 3, coach: 1 }],
          ['“Proposta boa todo mundo gosta de receber. É sinal de trabalho bem feito.”', 'confiante', ['Mídia ++', 'Valor +3%'], { media: 4, reputation: 1 }],
          ['“Se a diretoria não valorizar, tem clube que valoriza.”', 'provocador', ['Diretoria −−', 'Torcida −', 'Proposta ▲'], { coach: -3, fans: -4, media: 3 }],
          ['“Meu empresário cuida disso. Eu só penso no próximo jogo.”', 'evasivo', ['Sem efeito', 'Mídia −'], { media: -1 }],
        ]
      : [
          ['“Obrigado pelo carinho. Vou devolver dentro de campo.”', 'humilde', ['Torcida ++'], { fans: 5 }],
          ['“Podem esperar muitos gols. Isso é só o começo.”', 'confiante', ['Torcida +', 'Mídia +', 'Pressão ▲'], { fans: 3, media: 3 }],
          ['“Torcida que vaia não ganha jogo. Quero apoio o tempo todo.”', 'provocador', ['Torcida −−', 'Mídia +'], { fans: -6, media: 2 }],
          ['“Prefiro deixar o futebol falar.”', 'evasivo', ['Sem efeito'], {}],
        ],
  })
  m.press = {}
  return qs.map((q, i) => {
    const [name, outlet] = j()
    const id = `q${s.season}-${s.week}-${i}`
    m.press![id] = {}
    return {
      id,
      journalist: name,
      outlet,
      question: q.q,
      answers: q.a.map(([label, tone, effects, d], k) => {
        const aid = `${id}-a${k}`
        m.press![id][aid] = d
        return { id: aid, label, tone, effects }
      }),
    }
  })
}

function applyDeltas(s: ImmersiveState, d: Partial<Deltas>) {
  const R = s.relationships
  if (d.coach) R.coach = clamp(R.coach + d.coach, 0, 100)
  if (d.teammates) R.teammates = clamp(R.teammates + d.teammates, 0, 100)
  if (d.fans) R.fans = clamp(R.fans + d.fans, 0, 100)
  if (d.media) R.media = clamp(R.media + d.media, 0, 100)
  if (d.morale) s.condition.morale = clamp(s.condition.morale + d.morale, 0, 100)
  if (d.fitness) s.condition.fitness = clamp(s.condition.fitness + d.fitness, 0, 100)
  if (d.balance) s.finance.balance += d.balance
  if (d.reputation) s.reputation = clamp(s.reputation + d.reputation, 0, 100)
  if (d.followers) mem(s).followers = Math.max(0, Math.round(mem(s).followers + d.followers))
  if (d.attr) {
    const k = d.attr.key
    ;(s.attributes as unknown as Record<string, number>)[k] = clamp(attr(s, k) + d.attr.delta, 1, 99)
  }
}

// ───────────────────────────── histórias ─────────────────────────────

interface StoryDef {
  key: string
  title: string
  description: (s: ImmersiveState, club: string) => string
  options: { id: string; label: string; title: string; art: string; p: number; ok: Partial<Deltas>; bad?: Partial<Deltas>; chips: Decision['options'][number]['effects']; okText: string; badText?: string }[]
}

const STORIES: StoryDef[] = [
  {
    key: 'training_extra',
    title: 'Treino extra com o ídolo',
    description: (_s, club) => `O capitão do ${club} te chamou para ficar depois do treino batendo faltas. O resto do grupo vai para o churrasco do aniversário do roupeiro.`,
    options: [
      { id: 'accept', label: 'Ficar', title: 'Treinar com o capitão', art: 'training_extra-accept', p: 0.7, ok: { attr: { key: 'shooting', delta: 1 }, coach: 2, fitness: -6 }, bad: { fitness: -10 }, chips: [{ kind: 'positive', label: '+1 Finalização', probability: 0.7 }, { kind: 'negative', label: 'Energia −', probability: 1 }], okText: 'As faltas começaram a sair no ângulo. +1 Finalização.', badText: 'Muito cansaço, pouco resultado.' },
      { id: 'reject', label: 'Ir ao churrasco', title: 'Fortalecer o vestiário', art: 'training_extra-reject', p: 1, ok: { teammates: 5, morale: 3 }, chips: [{ kind: 'positive', label: 'Vestiário +', probability: 1 }, { kind: 'positive', label: 'Moral +', probability: 1 }], okText: 'O grupo te abraçou de vez.' },
    ],
  },
  {
    key: 'super_agent',
    title: 'Superempresário na porta',
    description: () => 'Um agente famoso quer te representar: promete Europa em um ano, mas cobra 15% de tudo e exige exposição na mídia.',
    options: [
      { id: 'sign', label: 'Assinar', title: 'Fechar com o agente', art: 'super_agent-sign', p: 0.6, ok: { reputation: 4, media: 5, balance: -15_000 }, bad: { media: 2, balance: -15_000, coach: -3 }, chips: [{ kind: 'positive', label: 'Fama ++', probability: 0.6 }, { kind: 'negative', label: '−€15 mil', probability: 1 }], okText: 'Seu nome começou a circular na Europa.', badText: 'Muito barulho e o técnico não gostou.' },
      { id: 'reject', label: 'Recusar', title: 'Manter o empresário', art: 'super_agent-reject', p: 1, ok: { coach: 2, morale: 1 }, chips: [{ kind: 'positive', label: 'Técnico +', probability: 1 }, { kind: 'neutral', label: 'Sem pressa', probability: 1 }], okText: 'Pé no chão. O técnico elogiou a maturidade.' },
    ],
  },
  {
    key: 'controversial_post',
    title: 'Post polêmico',
    description: (_s, club) => `Um vídeo seu dançando na balada na véspera do jogo viralizou. A torcida do ${club} está dividida.`,
    options: [
      { id: 'support_club', label: 'Pedir desculpas', title: 'Nota oficial', art: 'controversial_post-support_club', p: 0.8, ok: { fans: 3, media: 2 }, bad: { fans: -2 }, chips: [{ kind: 'positive', label: 'Torcida +', probability: 0.8 }], okText: 'Desculpas aceitas. Página virada.', badText: 'Pareceu forçado.' },
      { id: 'support_family', label: 'Ignorar', title: 'Seguir a vida', art: 'controversial_post-support_family', p: 0.45, ok: { followers: 3000, morale: 2 }, bad: { fans: -6, coach: -3 }, chips: [{ kind: 'positive', label: 'Seguidores +', probability: 0.45 }, { kind: 'negative', label: 'Torcida −−', probability: 0.55 }], okText: 'O assunto morreu e você ganhou seguidores.', badText: 'A torcida cobrou forte no treino aberto.' },
    ],
  },
  {
    key: 'coach_conflict',
    title: 'O técnico quer te improvisar',
    description: () => 'O treinador pediu para você jogar fora de posição no próximo jogo para cobrir um desfalque.',
    options: [
      { id: 'adapt', label: 'Aceitar', title: 'Jogar onde precisar', art: 'coach_conflict-adapt', p: 1, ok: { coach: 6, teammates: 2 }, chips: [{ kind: 'positive', label: 'Técnico ++', probability: 1 }, { kind: 'negative', label: 'Nota pode cair', probability: 0.5 }], okText: 'O técnico não vai esquecer.' },
      { id: 'confront', label: 'Contestar', title: 'Pedir a sua posição', art: 'coach_conflict-confront', p: 0.35, ok: { morale: 4, media: 2 }, bad: { coach: -8 }, chips: [{ kind: 'positive', label: 'Moral +', probability: 0.35 }, { kind: 'negative', label: 'Técnico −−', probability: 0.65 }], okText: 'Ele cedeu: você joga na sua.', badText: 'Clima pesado com o treinador.' },
    ],
  },
  {
    key: 'documentary',
    title: 'Convite para documentário',
    description: () => 'Uma plataforma de streaming quer gravar sua rotina por um mês. Cachê alto, mas câmeras no CT e em casa.',
    options: [
      { id: 'accept', label: 'Topar', title: 'Gravar a série', art: 'documentary-accept', p: 0.65, ok: { balance: 90_000, followers: 12_000, media: 6 }, bad: { balance: 90_000, coach: -4, fitness: -5 }, chips: [{ kind: 'positive', label: '+€90 mil', probability: 1 }, { kind: 'positive', label: 'Seguidores ++', probability: 0.65 }, { kind: 'negative', label: 'Técnico −', probability: 0.35 }], okText: 'Sucesso de audiência!', badText: 'O técnico reclamou da distração.' },
      { id: 'decline', label: 'Recusar', title: 'Foco total', art: 'documentary-decline', p: 1, ok: { coach: 2, morale: 1 }, chips: [{ kind: 'positive', label: 'Técnico +', probability: 1 }], okText: 'Discrição: o grupo aprovou.' },
    ],
  },
  {
    key: 'personal_coach',
    title: 'Preparador físico particular',
    description: () => 'Você pode contratar um preparador para treinos extras em casa. Custa caro, mas acelera a evolução.',
    options: [
      { id: 'accept', label: 'Contratar', title: 'Investir no corpo', art: 'personal_coach-accept', p: 0.8, ok: { attr: { key: 'physical', delta: 2 }, balance: -30_000 }, bad: { balance: -30_000, fitness: -8 }, chips: [{ kind: 'positive', label: '+2 Físico', probability: 0.8 }, { kind: 'negative', label: '−€30 mil', probability: 1 }], okText: 'Mais forte e mais rápido. +2 Físico.', badText: 'Sobrecarga: energia lá embaixo.' },
      { id: 'reject', label: 'Deixar para depois', title: 'Economizar', art: 'personal_coach-reject', p: 1, ok: { morale: 1 }, chips: [{ kind: 'neutral', label: 'Sem mudança', probability: 1 }], okText: 'Dinheiro guardado.' },
    ],
  },
]

function pickStory(data: GameData, s: ImmersiveState): Decision {
  const m = mem(s)
  const club = clubOf(data, s.clubId)?.shortName ?? 'clube'
  const rng = new Rng(`${s.seed}:story:${s.season}:${s.week}`)
  const pool = STORIES.filter((x) => !m.storyUsed.includes(x.key))
  const def = rng.pick(pool.length ? pool : STORIES)
  m.storyUsed = [...m.storyUsed, def.key].slice(-5)
  const gk = isGk(s.identity.position)
  const d: Decision = {
    id: `story-${s.season}-${s.week}-${def.key}`,
    kind: 'event',
    eventKey: def.key,
    title: def.title,
    description: def.description(s, club),
    options: def.options.map((o) => ({ id: o.id, label: o.label, title: o.title, art: o.art, effects: gk ? o.chips.map((c) => ({ ...c, label: c.label.replace('Finalização', 'Reflexo') })) : o.chips })),
    context: { immersive: true },
  }
  m.story = { id: d.id, options: Object.fromEntries(def.options.map((o) => [o.id, { ok: gk && o.ok.attr?.key === 'shooting' ? { ...o.ok, attr: { key: 'reflexes' as AttributeKey, delta: 1 } } : o.ok, bad: o.bad, p: o.p, okText: o.okText, badText: o.badText }])) }
  return d
}

// ───────────────────────────── mercado ─────────────────────────────

function roleFor(ovr: number, strength: number): ContractOffer['role'] {
  const g = ovr - strength
  return g >= 0 ? 'Titular' : g >= -5 ? 'Rotação' : g >= -10 ? 'Reserva' : 'Promessa'
}

function generateOffers(data: GameData, s: ImmersiveState): ContractOffer[] {
  const rng = new Rng(`${s.seed}:offers:${s.season}:${s.week}`)
  const club = clubOf(data, s.clubId)!
  const out: ContractOffer[] = []
  const talent = s.ovr + (s.potential - s.ovr) * (s.age <= 21 ? 0.45 : 0.15) + s.seasonStats.goals * 0.6
  const bigger = data.clubs
    .filter((c) => c.id !== club.id && (leagueOf(data, c.leagueId)?.tier ?? 3) === 1 && c.strength > club.strength - 2 && c.strength <= talent + 12)
    .sort((a, b) => b.strength - a.strength)
  const n = clamp(Math.round(1 + (talent - 55) / 10), 1, 3)
  const picks = rng.sample(bigger.slice(0, 40), n)
  const week = s.week
  for (const c of picks) {
    const lg = leagueOf(data, c.leagueId)
    const coef = lg?.coefficient ?? 0.6
    const fee = Math.round((s.marketValue * rng.range(1.05, 1.6)) / 100_000) * 100_000
    const salary = Math.round((s.finance.salary * rng.range(1.4, 2.6) + coef * 400_000 * (s.ovr / 70)) / 1000) * 1000
    out.push({
      id: `off-${s.season}-${week}-${c.id}`,
      clubId: c.id,
      kind: s.age <= 19 && rng.chance(0.3) ? 'loan' : 'transfer',
      fee,
      salary,
      years: rng.int(3, 5),
      role: roleFor(s.ovr + 3, c.strength),
      releaseClause: Math.round((fee * rng.range(2.5, 4)) / 1e6) * 1e6,
      signingBonus: Math.round((salary * rng.range(0.1, 0.3)) / 1000) * 1000,
      expiresWeek: week + (mem(s).rounds.length >= 20 ? 3 : 2),
      roundsLeft: rng.int(2, 3),
      note: rng.pick([`O técnico te quer como camisa ${s.identity.number}.`, 'Projeto de longo prazo, vaga aberta no ataque.', 'A diretoria acompanha você desde a base.', 'Querem fechar ainda nesta janela.']),
    })
  }
  if (s.finance.contractUntil <= s.season + 1 || rng.chance(0.35)) {
    const salary = Math.round((s.finance.salary * rng.range(1.2, 1.7)) / 1000) * 1000
    out.push({
      id: `off-${s.season}-${week}-renew`,
      clubId: club.id,
      kind: 'renewal',
      salary,
      years: rng.int(3, 4),
      role: roleFor(s.ovr + 2, club.strength),
      releaseClause: Math.round((s.marketValue * 4) / 1e6) * 1e6,
      signingBonus: Math.round((salary * 0.15) / 1000) * 1000,
      expiresWeek: week + 4,
      roundsLeft: 3,
      note: 'Renovação com aumento e multa maior.',
    })
  }
  return out
}

function respondOffer(data: GameData, s: ImmersiveState, a: Extract<ImmersiveAction, { type: 'offer_respond' }>, fx: ImmersiveEffect[]) {
  const o = s.offers.find((x) => x.id === a.offerId)
  if (!o) return
  const m = mem(s)
  const clubName = nameOf(data, o.clubId)
  if (a.response === 'reject') {
    s.offers = s.offers.filter((x) => x.id !== o.id)
    s.inbox.unshift(msg(s, 'Seu empresário', `Recusamos o ${clubName}`, 'Avisei a diretoria deles. Portas abertas para o futuro.'))
    fx.push({ type: 'toast', tone: 'info', title: `Proposta do ${clubName} recusada` })
    if (o.kind === 'renewal') s.relationships.coach = clamp(s.relationships.coach - 2, 0, 100)
    return
  }
  if (a.response === 'counter') {
    const rng = new Rng(`${s.seed}:counter:${o.id}:${o.roundsLeft}`)
    const want = a.counter ?? {}
    const cap = o.salary * 1.45
    const salaryAsk = want.salary ?? o.salary
    const roleRank = { Promessa: 0, Reserva: 1, Rotação: 2, Titular: 3 } as const
    const roleAsk = want.role ?? o.role
    const over = Math.max(0, salaryAsk / o.salary - 1)
    const p = clamp(0.92 - over * 1.4 - Math.max(0, roleRank[roleAsk] - roleRank[o.role]) * 0.22 - Math.abs((want.years ?? o.years) - o.years) * 0.05, 0.05, 0.95)
    o.roundsLeft = Math.max(0, o.roundsLeft - 1)
    if (rng.chance(p) && salaryAsk <= cap) {
      o.salary = Math.round(salaryAsk)
      o.years = want.years ?? o.years
      o.role = roleAsk
      o.note = 'A diretoria aceitou os seus termos. Falta só assinar.'
      s.inbox.unshift(msg(s, clubName, 'Contraproposta aceita', `Fechamos em €${fmtK(o.salary)}/ano, ${o.years} anos, papel de ${o.role.toLowerCase()}. Aguardamos sua assinatura.`, { offerId: o.id }))
      fx.push({ type: 'toast', tone: 'success', title: 'Contraproposta aceita!', description: `${clubName} topou: €${fmtK(o.salary)}/ano · ${o.years} anos.` })
    } else if (o.roundsLeft <= 0) {
      s.offers = s.offers.filter((x) => x.id !== o.id)
      s.inbox.unshift(msg(s, clubName, 'Negociação encerrada', 'Chegamos ao nosso limite. Agradecemos o interesse e desejamos sorte.'))
      fx.push({ type: 'toast', tone: 'danger', title: `${clubName} encerrou a negociação`, description: 'A paciência da diretoria acabou.' })
    } else {
      const improved = Math.round((o.salary + (Math.min(salaryAsk, cap) - o.salary) * 0.45) / 1000) * 1000
      o.salary = Math.max(o.salary, improved)
      o.note = `Melhoramos para €${fmtK(o.salary)}/ano. É o que dá, por enquanto.`
      s.inbox.unshift(msg(s, clubName, 'Nova oferta', `Não chegamos no seu número, mas subimos para €${fmtK(o.salary)}/ano. Restam ${o.roundsLeft} rodada${o.roundsLeft > 1 ? 's' : ''}.`, { offerId: o.id }))
      fx.push({ type: 'toast', tone: 'info', title: `${clubName} melhorou a proposta`, description: `€${fmtK(o.salary)}/ano · restam ${o.roundsLeft} rodada${o.roundsLeft > 1 ? 's' : ''}.` })
    }
    return
  }
  // accept
  if (o.kind === 'renewal') {
    s.finance.salary = o.salary
    s.finance.contractUntil = s.season + o.years
    s.finance.releaseClause = o.releaseClause
    if (o.signingBonus) s.finance.balance += o.signingBonus
    s.offers = s.offers.filter((x) => x.id !== o.id)
    s.relationships.coach = clamp(s.relationships.coach + 3, 0, 100)
    s.relationships.fans = clamp(s.relationships.fans + 3, 0, 100)
    s.news.unshift(news(s, `${s.identity.surname} renova com o ${clubName} até ${s.finance.contractUntil}`, 'positive', 'Portal Camisa 10'))
    fx.push({ type: 'toast', tone: 'gold', title: 'Contrato renovado', description: `Até ${s.finance.contractUntil} · €${fmtK(o.salary)}/ano.` })
    return
  }
  const preseason = current(s)?.week === 0
  s.offers = s.offers.filter((x) => x.kind === 'renewal' && x.clubId !== s.clubId ? false : x.id !== o.id && x.kind === 'renewal')
  if (preseason) {
    // janela da pré-temporada: muda já
    moveTo(data, s, { clubId: o.clubId, salary: o.salary, years: o.years, role: o.role, fee: o.fee, loan: o.kind === 'loan' }, fx)
  } else {
    m.pendingMove = { clubId: o.clubId, salary: o.salary, years: o.years, role: o.role, fee: o.fee, loan: o.kind === 'loan' }
    s.news.unshift(news(s, `${s.identity.surname} acerta com o ${clubName} para a próxima temporada`, 'neutral', 'LENDA TV', o.fee ? `Transferência de €${fmtK(o.fee)}.` : undefined))
    s.inbox.unshift(msg(s, 'Seu empresário', 'Pré-contrato assinado!', `Você se apresenta no ${clubName} ao fim da temporada. Até lá, honre a camisa atual.`))
    fx.push({ type: 'toast', tone: 'gold', title: `Acerto com o ${clubName}`, description: 'Transferência na próxima temporada.' })
  }
}

function moveTo(data: GameData, s: ImmersiveState, mv: NonNullable<Mem['pendingMove']>, fx: ImmersiveEffect[]) {
  const from = s.clubId
  const m = mem(s)
  if (mv.loan) s.parentClubId = from ?? undefined
  else s.parentClubId = undefined
  s.clubId = mv.clubId
  s.finance.salary = mv.salary
  s.finance.contractUntil = s.season + mv.years
  s.relationships.coach = mv.role === 'Titular' ? 62 : mv.role === 'Rotação' ? 54 : 46
  s.relationships.teammates = 50
  s.relationships.fans = 50
  m.form = []
  m.ratings = []
  const club = clubOf(data, mv.clubId)
  s.log.push({ season: s.season, age: s.age, type: mv.loan ? 'loan_started' : 'joined', text: `${mv.loan ? 'Emprestado ao' : 'Contratado pelo'} ${club?.name}.`, data: { clubId: mv.clubId, fee: mv.fee } })
  s.news.unshift(news(s, `${club?.shortName} anuncia ${s.identity.surname}${mv.fee ? ` por €${fmtK(mv.fee)}` : ''}`, 'positive', 'LENDA TV'))
  s.social.unshift(post(s, club?.name ?? 'Clube', `@${slug(club?.shortName ?? 'clube')}`, `Chegou! Seja bem-vindo, ${cap(s.identity.surname)}! ✍️ #${slug(club?.shortName ?? 'clube')}`, 'positive', { verified: true, likes: 48_000, reposts: 6_200 }))
  fx.push({ type: 'transfer', clubId: mv.clubId, fee: mv.fee })
  // recomeça o calendário no novo clube (só na pré-temporada: nada foi jogado)
  const done = s.calendar.slice(0, s.cursor + 1)
  const fresh = buildSeason(data, s, m, s.season, { firstSeason: false }).filter((it) => !(it.week === 0 && done.some((d) => d.kind === it.kind && d.week === 0)))
  s.calendar = [...done, ...fresh.filter((it) => it.week > 0 || !done.some((d) => d.kind === it.kind))]
  m.pendingMove = undefined
}

// ───────────────────────────── fim de temporada ─────────────────────────────

function computeAwards(data: GameData, s: ImmersiveState): AwardResult[] {
  const m = mem(s)
  const rng = new Rng(`${s.seed}:awards:${s.season}`)
  const avgRating = s.seasonStats.apps ? s.seasonStats.ratingSum / s.seasonStats.apps : 6
  const userEntry: AwardRankingEntry = { name: `${s.identity.surname}`, nationality: s.identity.nationality, clubId: s.clubId ?? undefined, position: s.identity.position, score: 0, isUser: true }
  // Bola de Ouro: estrelas reais + você
  const stars = data.stars
    .filter((x) => x.clubId)
    .map((x) => ({ name: x.name, nationality: x.nationality, clubId: x.clubId, position: x.position, score: Math.round((x.ovr - 70) * 38 + rng.range(0, 260)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
  const userBallon = Math.round((s.ovr - 72) * 40 + s.seasonStats.goals * 12 + s.seasonStats.assists * 6 + m.seasonTrophies.length * 90 + (avgRating - 6.5) * 120)
  const ballon = [...stars, ...(userBallon > (stars[9]?.score ?? 9999) ? [{ ...userEntry, score: userBallon }] : [])].sort((a, b) => b.score - a.score).slice(0, 10)
  const results: AwardResult[] = [{ award: 'ballon_dor', year: s.season + 1, winner: ballon[0], ranking: ballon }]
  // craque e artilheiro da liga
  const sc = Object.values(m.scorers).sort((a, b) => b.goals - a.goals)
  const lg = m.leagueId
  const topScorers: AwardRankingEntry[] = sc.slice(0, 6).map((x) => ({ name: x.name, nationality: clubOf(data, x.clubId)?.country ?? 'BRA', clubId: x.clubId, position: 'CA' as Position, score: x.goals }))
  const userGoals = s.seasonStats.goals
  if (userGoals > 0 && !topScorers.some((t) => t.name === s.identity.surname)) topScorers.push({ ...userEntry, score: userGoals })
  topScorers.sort((a, b) => b.score - a.score)
  results.push({ award: 'league_top_scorer', year: s.season, winner: topScorers[0] ?? userEntry, ranking: topScorers.slice(0, 5), leagueId: lg })
  const best: AwardRankingEntry[] = sc.slice(0, 4).map((x) => ({ name: x.name, nationality: clubOf(data, x.clubId)?.country ?? 'BRA', clubId: x.clubId, position: 'CA' as Position, score: Math.round(x.goals * 9 + rng.range(20, 60)) }))
  const userBest = Math.round((avgRating - 6) * 45 + userGoals * 9 + s.seasonStats.assists * 5 + s.seasonStats.motm * 8)
  best.push({ ...userEntry, score: userBest })
  best.sort((a, b) => b.score - a.score)
  results.push({ award: 'league_best_player', year: s.season, winner: best[0], ranking: best.slice(0, 5), leagueId: lg })
  return results
}

function endSeason(data: GameData, s: ImmersiveState, fx: ImmersiveEffect[]) {
  const m = mem(s)
  for (let r = 0; r < m.rounds.length; r++) if (!m.roundDone[r]) simulateRound(data, s, r)
  const table = liveTable(data, s)
  const league = leagueOf(data, m.leagueId)
  const pos = table.findIndex((r) => r.clubId === s.clubId) + 1
  if (pos === 1 && league) {
    const tw: TrophyWin = { trophyId: league.trophyId, competitionId: league.id, season: s.season, teamId: s.clubId!, scope: 'club', kind: 'league', tier: league.tier }
    s.trophies.push(tw)
    m.seasonTrophies.push(tw)
    fx.push({ type: 'trophy', trophy: tw })
  }
  const awards = computeAwards(data, s)
  const seasonAwards: SeasonRecord['awards'] = []
  for (const a of awards) {
    const place = a.ranking.findIndex((x) => x.isUser) + 1
    if (place >= 1 && place <= 3 && (a.award === 'ballon_dor' || place === 1)) {
      const w = { award: a.award, year: a.year, place: place as 1 | 2 | 3, leagueId: a.leagueId }
      s.awards.push(w)
      seasonAwards.push(w)
      fx.push({ type: 'award', award: a })
    }
  }
  const sorted = Object.values(m.scorers).sort((a, b) => b.goals - a.goals)
  s.world.seasons[s.season] = {
    season: s.season,
    leagues: {
      [m.leagueId]: {
        leagueId: m.leagueId,
        season: s.season,
        table,
        champion: table[0]?.clubId ?? '',
        promoted: [],
        relegated: league?.relegation ? table.slice(-league.relegation).map((r) => r.clubId) : [],
        topScorers: sorted.slice(0, 10).map((x) => ({ name: x.name, clubId: x.clubId, goals: x.goals })),
      },
    },
    cups: {},
    national: {},
    awards,
  }
  s.world.nextSeason = s.season + 1
  const apps = s.seasonStats.apps
  const rec: SeasonRecord = {
    season: s.season,
    age: s.age,
    clubId: s.clubId!,
    leagueId: m.leagueId,
    tier: league?.tier ?? 1,
    loan: !!s.parentClubId,
    period: s.season - 2026,
    role: apps === 0 ? 'substitute' : s.seasonStats.starts / Math.max(1, apps) > 0.7 ? 'starter' : s.seasonStats.starts / Math.max(1, apps) > 0.4 ? 'high_rotation' : 'low_rotation',
    ovrStart: m.baseline.ovr,
    ovrEnd: s.ovr,
    marketValue: s.marketValue,
    stats: { apps, goals: s.seasonStats.goals, assists: s.seasonStats.assists, rating: apps ? r1(s.seasonStats.ratingSum / apps) : 0, minutes: s.seasonStats.minutes, cleanSheets: s.seasonStats.cleanSheets },
    leaguePosition: pos || undefined,
    relegated: league?.relegation ? pos > table.length - league.relegation : false,
    trophies: m.seasonTrophies.slice(),
    awards: seasonAwards,
    national: s.national.apps ? { apps: s.national.apps, goals: s.national.goals, assists: s.national.assists } : undefined,
    captain: s.captain,
    country: league?.country,
    confed: league?.confed,
    nationality: s.identity.nationality,
    position: s.identity.position,
    clubPrestige: clubOf(data, s.clubId)?.prestige,
  }
  s.seasons.push(rec)
  fx.push({ type: 'season_end', record: rec })
  s.news.unshift(news(s, pos === 1 ? `${clubOf(data, s.clubId)?.shortName} é campeão!` : `${clubOf(data, s.clubId)?.shortName} termina a temporada em ${pos}º`, pos === 1 ? 'positive' : pos > table.length - (league?.relegation ?? 0) ? 'negative' : 'neutral', 'LENDA TV'))
}

function startNextSeason(data: GameData, s: ImmersiveState, fx: ImmersiveEffect[]) {
  const m = mem(s)
  const rng = new Rng(`${s.seed}:aging:${s.season}`)
  s.season++
  s.age++
  s.week = 0
  // evolução natural por idade
  const before = s.ovr
  for (const k of attrKeys(s.identity.position)) {
    const cur = attr(s, k)
    const d = s.age <= 21 ? rng.int(0, 2) : s.age <= 27 ? rng.int(0, 1) : s.age <= 31 ? rng.int(-1, 0) : rng.int(-2, 0)
    if (d) {
      ;(s.attributes as unknown as Record<string, number>)[k] = clamp(cur + d, 1, 99)
      if (d > 0) fx.push({ type: 'attribute_up', key: k, from: cur, to: cur + d })
    }
  }
  s.ovr = ovrOf(s.attributes, s.identity.position)
  if (s.ovr !== before) fx.push({ type: 'ovr_change', from: before, to: s.ovr })
  s.marketValue = marketValueOf(s.ovr, s.age, s.potential)
  s.seasonStats = { apps: 0, starts: 0, minutes: 0, goals: 0, assists: 0, cleanSheets: 0, ratingSum: 0, motm: 0 }
  s.condition = { ...s.condition, fitness: 95, sharpness: 50, morale: clamp(s.condition.morale + 4, 0, 100) }
  s.national = { ...s.national }
  if (m.pendingMove) {
    const mv = m.pendingMove
    m.pendingMove = undefined
    const from = s.clubId
    s.clubId = mv.clubId
    s.parentClubId = mv.loan ? from ?? undefined : undefined
    s.finance.salary = mv.salary
    s.finance.contractUntil = s.season - 1 + mv.years
    s.relationships.coach = mv.role === 'Titular' ? 62 : 52
    s.relationships.fans = 50
    s.relationships.teammates = 50
    m.form = []
    m.ratings = []
    const club = clubOf(data, mv.clubId)
    s.log.push({ season: s.season, age: s.age, type: mv.loan ? 'loan_started' : 'joined', text: `Chegou ao ${club?.name}.`, data: { clubId: mv.clubId } })
    fx.push({ type: 'transfer', clubId: mv.clubId, fee: mv.fee })
    s.news.unshift(news(s, `${s.identity.surname} é apresentado no ${club?.shortName}`, 'positive', 'LENDA TV'))
  } else if (s.finance.contractUntil < s.season) {
    s.finance.contractUntil = s.season + 2
    s.inbox.unshift(msg(s, 'Diretoria', 'Contrato estendido', 'Seu contrato terminou e renovamos automaticamente por mais duas temporadas, nas mesmas bases.'))
  }
  m.baseline = { season: s.season, ovr: s.ovr, attributes: clone(s.attributes) }
  m.storyUsed = m.storyUsed.slice(-3)
  s.calendar = buildSeason(data, s, m, s.season, { firstSeason: false })
  s.cursor = 0
  s.offers = s.offers.filter((o) => o.kind === 'renewal')
  if (s.age >= 38) {
    s.retired = true
    s.retiredReason = 'Aposentadoria aos 38 anos.'
    fx.push({ type: 'retired' })
  }
  fx.push({ type: 'toast', tone: 'gold', title: `Temporada ${s.season}`, description: `${s.age} anos · OVR ${s.ovr} · ${clubOf(data, s.clubId)?.name ?? ''}` })
  arrive(data, s, fx)
}

// ───────────────────────────── dispatch ─────────────────────────────

/** "Simular até…" (ação aditiva `auto`): resolve itens com as escolhas padrão até o alvo. */
function autoRun(data: GameData, state: ImmersiveState, a: Extract<ImmersiveAction, { type: 'auto' }>): { state: ImmersiveState; effects: ImmersiveEffect[] } {
  const until = a.until ?? 'next_match'
  const keep = new Set<ImmersiveEffect['type']>(['trophy', 'award', 'season_end', 'transfer', 'ovr_change', 'achievement', 'retired'])
  const effects: ImmersiveEffect[] = []
  let s = state
  let steps = 0
  const w0 = state.week
  const s0 = state.season
  for (; steps < (a.maxSteps ?? 400); steps++) {
    const it = nextItem(s)
    if (!it || s.retired) break
    if (until === 'next_match' && !s.live && (it.kind === 'match' || it.kind === 'national_match')) break
    if (until === 'next_week' && (s.week > w0 || s.season > s0)) break
    if (until === 'season_end' && it.kind === 'season_end') break
    if (until === 'decision' && (s.pendingDecision || (it.kind === 'transfer_window' && s.offers.length))) break
    const act: ImmersiveAction = s.live
      ? { type: 'match_finish' }
      : s.press?.length
        ? { type: 'press_skip' }
        : s.pendingDecision
          ? { type: 'decision_choose', optionId: s.pendingDecision.options[0].id }
          : it.kind === 'training'
            ? { type: 'train', focus: isGk(s.identity.position) ? 'goalkeeping' : 'tactical', intensity: s.condition.fitness < 55 ? 'leve' : 'normal' }
            : { type: 'advance' }
    const r = dispatch(data, s, act)
    for (const e of r.effects) if (keep.has(e.type)) effects.push(e)
    if (r.state === s) break
    s = r.state
  }
  const it = nextItem(s)
  effects.push({ type: 'toast', tone: 'info', title: 'Simulação concluída', description: it ? `Próximo: ${it.title}` : undefined })
  return { state: s, effects }
}

function dispatch(data: GameData, state: ImmersiveState, action: ImmersiveAction): { state: ImmersiveState; effects: ImmersiveEffect[] } {
  if (action.type === 'auto') return autoRun(data, state, action)
  const s = clone(state)
  const fx: ImmersiveEffect[] = []
  const m = mem(s)
  m.tick = (m.tick ?? 0) + 1
  if (s.retired && action.type !== 'inbox_read') return { state: s, effects: fx }
  const it = current(s)
  switch (action.type) {
    case 'advance': {
      if (s.live) {
        if (s.live.phase === 'full_time') finishMatch(data, s, fx)
        else simulate(data, s, fx)
        break
      }
      if (!it) break
      if (it.kind === 'match' || it.kind === 'national_match') {
        s.live = createLive(data, s, it)
        break
      }
      if (it.kind === 'press') {
        if (!s.press) s.press = buildPress(data, s)
        break
      }
      if (it.kind === 'story' && s.pendingDecision) break
      if (it.kind === 'training') return dispatch(data, state, { type: 'train', focus: isGk(s.identity.position) ? 'goalkeeping' : 'tactical', intensity: 'normal' })
      if (it.kind === 'season_end') {
        endSeason(data, s, fx)
        complete(data, s, fx)
        break
      }
      if (it.kind === 'awards') {
        startNextSeason(data, s, fx)
        break
      }
      complete(data, s, fx)
      break
    }
    case 'train': {
      if (it?.kind !== 'training') break
      train(data, s, action.focus, action.intensity, fx)
      break
    }
    case 'match_start': {
      if (!s.live && it && (it.kind === 'match' || it.kind === 'national_match')) s.live = createLive(data, s, it)
      if (s.live && s.live.phase === 'pre') {
        if (action.accept === false && s.live.userStatus === 'bench') {
          s.relationships.coach = clamp(s.relationships.coach - 6, 0, 100)
          m.plan!.onAt = 999
          m.plan!.moments = []
          s.live.userStatus = 'out'
          fx.push({ type: 'toast', tone: 'danger', title: 'Você se recusou a ficar no banco', description: 'O técnico não gostou.' })
        }
        kickoff(s, s.live, fx)
      }
      break
    }
    case 'match_sim': {
      if (!s.live) break
      simulate(data, s, fx)
      break
    }
    case 'match_choose': {
      if (!s.live?.pendingMoment) break
      resolveMoment(data, s, action.optionId, action.minigame, fx)
      break
    }
    case 'match_timeout': {
      if (!s.live?.pendingMoment) break
      resolveMoment(data, s, null, undefined, fx, true)
      fx.push({ type: 'toast', tone: 'info', title: 'Tempo esgotado', description: 'Você hesitou: a jogada padrão foi escolhida.' })
      break
    }
    case 'match_sub_request': {
      const live = s.live
      if (!live || !live.userOnPitch || live.phase === 'full_time') break
      live.userOnPitch = false
      m.plan!.offAt = live.minute
      live.stats.minutes = live.minute - m.plan!.startMinute
      m.plan!.moments = m.plan!.moments.filter((x) => x.minute < live.minute)
      applyEvent(s, live, { minute: live.minute, type: 'sub_off', side: live.userSide, byUser: true, player: s.identity.surname, text: `${s.identity.surname} pede para sair, sentindo o cansaço. Aplausos da torcida.`, at: { x: 50, y: 99 } }, fx)
      s.relationships.coach = clamp(s.relationships.coach - (s.condition.fitness > 50 ? 2 : 0), 0, 100)
      break
    }
    case 'match_finish': {
      if (!s.live) break
      if (s.live.phase !== 'full_time') {
        // simula o resto sem lances (atalho "encerrar")
        let guard = 0
        const phaseOf = () => (s.live?.phase ?? 'full_time') as LiveMatch['phase']
        while (phaseOf() !== 'full_time' && guard++ < 20) {
          if (s.live?.pendingMoment) resolveMoment(data, s, null, undefined, fx, true)
          else simulate(data, s, fx)
        }
      }
      finishMatch(data, s, fx)
      break
    }
    case 'press_answer': {
      if (!s.press) break
      const d = m.press?.[action.questionId]?.[action.answerId] ?? {}
      applyDeltas(s, d)
      const q = s.press.find((x) => x.id === action.questionId)
      const a = q?.answers.find((x) => x.id === action.answerId)
      if (q && a) {
        const headline = a.tone === 'provocador' ? `${s.identity.surname} provoca: ${a.label.replace(/[“”]/g, '')}` : a.tone === 'confiante' ? `Confiante, ${s.identity.surname} avisa: ${a.label.replace(/[“”]/g, '')}` : a.tone === 'humilde' ? `${s.identity.surname} mantém os pés no chão` : `${s.identity.surname} desconversa na coletiva`
        const n = news(s, headline, a.tone === 'provocador' ? 'negative' : a.tone === 'evasivo' ? 'neutral' : 'positive', q.outlet)
        s.news.unshift(n)
        fx.push({ type: 'news', item: n })
      }
      s.press = s.press.filter((x) => x.id !== action.questionId)
      if (!s.press.length) {
        s.press = null
        fx.push({ type: 'toast', tone: 'success', title: 'Coletiva encerrada', description: `Torcida ${s.relationships.fans} · Mídia ${s.relationships.media}` })
        complete(data, s, fx)
      }
      break
    }
    case 'press_skip': {
      if (!s.press && it?.kind !== 'press') break
      s.press = null
      s.relationships.media = clamp(s.relationships.media - 5, 0, 100)
      s.news.unshift(news(s, `${s.identity.surname} falta à coletiva e irrita a imprensa`, 'negative', 'Canal Resenha'))
      fx.push({ type: 'toast', tone: 'danger', title: 'Coletiva cancelada', description: 'Mídia −5' })
      complete(data, s, fx)
      break
    }
    case 'social_post': {
      const t = POST_TEMPLATES.find((x) => x.id === action.templateId)
      if (!t) break
      const club = clubOf(data, s.clubId)
      if (t.id !== 'silencio') {
        const likes = Math.round(m.followers * (0.06 + (t.tone === 'positive' ? 0.05 : 0.02)))
        s.social.unshift(post(s, `${s.identity.surname} (você)`, `@${slug(s.identity.surname)}${s.identity.number}`, t.text.replace('{club}', slug(club?.shortName ?? 'lenda')), t.tone, { byUser: true, likes, reposts: Math.round(likes * 0.12), verified: s.reputation >= 20 }))
        const deltas: Record<string, Partial<Deltas>> = {
          obrigado_torcida: { fans: 3, followers: 900 },
          foto_gol: { followers: 2500, fans: 1 },
          provocar_rival: { fans: 4, media: -3, followers: 3500 },
          foco_treino: { coach: 2, followers: 300 },
          pedir_desculpas: { fans: 2, morale: -1 },
          mirar_titulo: { media: 2, followers: 1200 },
          familia: { morale: 3, followers: 700 },
        }
        applyDeltas(s, deltas[t.id] ?? {})
        s.social.splice(1, 0, post(s, 'Torcedor', `@${slug(club?.abbr ?? 'fc')}_na_veia`, t.tone === 'negative' ? 'Kkkkk provocou mesmo! 🔥' : 'Tamo junto, craque! 👏', 'positive', { likes: Math.round(likes * 0.05) }))
        fx.push({ type: 'toast', tone: 'success', title: 'Post publicado', description: t.hint })
      } else fx.push({ type: 'toast', tone: 'info', title: 'Você preferiu o silêncio' })
      break
    }
    case 'offer_respond':
      respondOffer(data, s, action, fx)
      break
    case 'decision_choose': {
      const d = s.pendingDecision
      if (!d) break
      const def = m.story?.options[action.optionId]
      const rng = new Rng(`${s.seed}:dec:${d.id}:${action.optionId}`)
      const ok = !def || rng.chance(def.p)
      if (def) applyDeltas(s, ok ? def.ok : def.bad ?? {})
      const before = s.ovr
      s.ovr = ovrOf(s.attributes, s.identity.position)
      if (s.ovr !== before) fx.push({ type: 'ovr_change', from: before, to: s.ovr })
      fx.push({ type: 'toast', tone: ok ? 'success' : 'danger', title: d.title, description: ok ? def?.okText : def?.badText ?? def?.okText })
      s.log.push({ season: s.season, age: s.age, type: 'decision', text: `${d.title}: ${d.options.find((o) => o.id === action.optionId)?.title ?? action.optionId}.` })
      s.pendingDecision = null
      m.story = undefined
      if (it?.kind === 'story') complete(data, s, fx)
      break
    }
    case 'inbox_read': {
      const x = s.inbox.find((i) => i.id === action.messageId)
      if (x) x.read = true
      break
    }
    case 'buy': {
      const item = LIFESTYLE_ITEMS.find((i) => i.id === action.itemId)
      if (!item || s.finance.balance < item.price) {
        fx.push({ type: 'toast', tone: 'danger', title: 'Saldo insuficiente' })
        break
      }
      s.finance.balance -= item.price
      s.finance.lifestyle = [...(s.finance.lifestyle ?? []), { id: item.id, name: item.name, price: item.price, season: s.season }]
      s.condition.morale = clamp(s.condition.morale + item.morale, 0, 100)
      fx.push({ type: 'toast', tone: 'gold', title: item.name, description: `Moral +${item.morale}` })
      break
    }
    case 'retire': {
      s.retired = true
      s.retiredReason = 'Aposentadoria por decisão própria.'
      fx.push({ type: 'retired' })
      break
    }
  }
  return { state: s, effects: fx }
}

function nextItem(state: ImmersiveState): CalendarItem | null {
  return state.calendar[state.cursor] ?? null
}

export const mockImmersive: ImmersiveEngine = { newCareer, dispatch, nextItem, ovrOf, liveTable }
export default mockImmersive
