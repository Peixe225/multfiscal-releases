/**
 * Fixture careers for building / screenshotting screens in every state.
 *
 *   careerMid(data)      age 25, 10 seasons (the career.html mockup: Palmeiras → loans → Palmeiras, 8 títulos,
 *                        Bola de Ouro 3º, pending "O Real Madrid bateu à sua porta")
 *   careerEnd(data)      retired at 39 (careerMid continued by the mock engine)
 *   sampleReveal(data)   { before, state, reveal } — 2 seasons at Real Madrid: LaLiga + Champions + Bola de Ouro, OVR 87 → 90 (Lenda)
 *   careerNew(data)      fresh career at the academy offer
 *
 * Club ids are resolved against the loaded GameData (id → name → same country) so fixtures keep
 * working when the real data pack replaces the mock one.
 */
import type { AwardWin, CareerState, Club, Decision, GameData, PlayerIdentity, SeasonRecord, SquadRole, TrophyWin } from '@/engine/types'
import type { RevealScript } from '@/engine/api'
import { mockGameData } from './mockData'
import { createMockEngine, mockMarketValue, summarizeCareer } from './mockEngine'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function resolveClub(data: GameData, id: string, name: string, country = 'BRA'): Club {
  return (
    data.clubs.find((c) => c.id === id) ??
    data.clubs.find((c) => norm(c.name) === norm(name) || norm(c.shortName) === norm(name)) ??
    data.clubs.find((c) => c.country === country) ??
    data.clubs[0]
  )
}

const trophyId = (data: GameData, id: string, fallbackName: string) =>
  data.trophies.find((t) => t.id === id)?.id ?? data.trophies.find((t) => norm(t.name).includes(norm(fallbackName)))?.id ?? id

export const FIXTURE_IDENTITY: PlayerIdentity = { surname: 'RIBEIRO', number: 9, foot: 'right', nationality: 'BRA', position: 'CA' }

interface Row {
  age: number
  club: Club
  loan?: boolean
  ovr: number
  apps: number
  goals: number
  assists: number
  role?: SquadRole
  pos?: number
  promoted?: boolean
  relegated?: boolean
  trophies?: [string, string][] // [trophyId, competitionId]
  awards?: AwardWin[]
  value?: number
  national?: SeasonRecord['national']
}

function rec(data: GameData, r: Row, prevOvr: number, period: number): SeasonRecord {
  const season = 2026 + (r.age - 16)
  const lg = data.leagues.find((l) => l.id === r.club.leagueId)
  return {
    season,
    age: r.age,
    clubId: r.club.id,
    leagueId: r.club.leagueId,
    tier: lg?.tier ?? 1,
    loan: !!r.loan,
    period,
    role: r.role ?? (r.apps >= 38 ? 'starter' : r.apps >= 26 ? 'high_rotation' : r.apps >= 12 ? 'low_rotation' : 'substitute'),
    ovrStart: prevOvr,
    ovrEnd: r.ovr,
    marketValue: r.value ?? mockMarketValue(r.ovr, r.age, lg?.coefficient ?? 0.7),
    stats: { apps: r.apps, goals: r.goals, assists: r.assists, rating: Math.round((6.2 + (r.ovr - 60) / 11) * 10) / 10 },
    leaguePosition: r.pos,
    promoted: r.promoted,
    relegated: r.relegated,
    trophies: (r.trophies ?? []).map(([t, c]): TrophyWin => ({ trophyId: t, competitionId: c, season, teamId: c.startsWith('fifa.world') ? 'BRA' : r.club.id, scope: c === 'fifa.world' ? 'national' : 'club' })),
    awards: r.awards ?? [],
    national: r.national,
    captain: r.age >= 24 && !r.loan,
  }
}

function baseState(data: GameData, seasons: SeasonRecord[], extra: Partial<CareerState> = {}): CareerState {
  const last = seasons[seasons.length - 1]
  const s: CareerState = {
    version: 1,
    id: 'fixture-ribeiro',
    mode: 'classic',
    pace: 'normal',
    seed: 'fixture-ribeiro',
    identity: FIXTURE_IDENTITY,
    createdAt: '2026-09-27T20:00:00.000Z',
    phase: 'deciding',
    age: last ? last.age + 1 : 16,
    season: last ? last.season + 1 : 2026,
    ovr: last?.ovrEnd ?? 54,
    devProfile: 'normal',
    marketValue: last?.marketValue ?? 100_000,
    clubId: last?.clubId ?? null,
    contractUntil: last ? last.season + 2 : undefined,
    seasons,
    national: { apps: 0, goals: 0, assists: 0, trophies: [], tournaments: [] },
    pendingDecision: null,
    period: seasons.length ? Math.max(...seasons.map((x) => x.period)) + 1 : 0,
    events: { done: [], slots: [], lastEventAge: 0, injuries: 0 },
    modifiers: {},
    streaks: { lowRole: 0, substitute: 0 },
    world: { seed: 'fixture-ribeiro', nextSeason: last ? last.season + 1 : 2026, clubs: {}, nations: {}, rivals: [], seasons: {}, qualified: {} },
    log: [],
    retired: false,
    ...extra,
  }
  // national totals from the rows
  for (const r of seasons) {
    if (!r.national) continue
    s.national.apps += r.national.apps
    s.national.goals += r.national.goals
    s.national.assists += r.national.assists
    s.national.firstCallUp ??= r.season
    s.national.trophies.push(...r.trophies.filter((t) => t.scope === 'national'))
    if (r.national.tournament) s.national.tournaments.push({ competitionId: r.national.tournament.competitionId, year: r.season + 1, reached: r.national.tournament.reached, apps: 7, goals: 3 })
  }
  return s
}

/** The career.html mockup, row for row. */
export function careerMid(data: GameData = mockGameData): CareerState {
  const pal = resolveClub(data, 'e2029', 'Palmeiras')
  const juv = resolveClub(data, 'e6270', 'Juventude')
  const cha = resolveClub(data, 'e9318', 'Chapecoense')
  const cfc = resolveClub(data, 'e3456', 'Coritiba')
  const bah = resolveClub(data, 'e9967', 'Bahia')
  const rma = resolveClub(data, 'e86', 'Real Madrid', 'ESP')
  const T = {
    br: trophyId(data, 'brasileirao', 'Brasileir'),
    cdb: trophyId(data, 'copa-do-brasil', 'Copa do Brasil'),
    lib: trophyId(data, 'libertadores', 'Libertadores'),
    cwc: trophyId(data, 'mundial-de-clubes', 'Mundo de Clubes'),
    wc: trophyId(data, 'copa-do-mundo', 'Copa do Mundo'),
  }
  const nat = (apps: number, goals: number, assists: number, tournament?: { competitionId: string; reached: string }) => ({ apps, goals, assists, tournament })
  const rows: Row[] = [
    { age: 16, club: pal, ovr: 52, apps: 6, goals: 0, assists: 0, pos: 3, value: 100_000 },
    { age: 17, club: pal, ovr: 57, apps: 14, goals: 2, assists: 1, pos: 2, trophies: [[T.cdb, 'bra.copa_do_brazil']], value: 380_000 },
    { age: 18, club: juv, loan: true, ovr: 62, apps: 31, goals: 8, assists: 3, pos: 3, promoted: true, value: 1_200_000 },
    { age: 19, club: cha, loan: true, ovr: 66, apps: 29, goals: 9, assists: 4, pos: 18, relegated: true, value: 2_900_000 },
    { age: 20, club: cfc, loan: true, ovr: 70, apps: 33, goals: 12, assists: 5, pos: 7, value: 5_500_000 },
    { age: 21, club: bah, loan: true, ovr: 75, apps: 34, goals: 15, assists: 6, pos: 6, value: 11_000_000, national: nat(4, 1, 0) },
    { age: 22, club: pal, ovr: 79, apps: 38, goals: 17, assists: 7, pos: 2, trophies: [[T.lib, 'conmebol.libertadores'], [T.cdb, 'bra.copa_do_brazil']], value: 24_000_000, national: nat(5, 2, 1) },
    {
      age: 23,
      club: pal,
      ovr: 82,
      apps: 45,
      goals: 24,
      assists: 9,
      pos: 1,
      trophies: [[T.br, 'bra.1'], [T.wc, 'fifa.world']],
      awards: [{ award: 'league_top_scorer', year: 2034, place: 1, leagueId: pal.leagueId }],
      value: 38_000_000,
      national: nat(8, 4, 2, { competitionId: 'fifa.world', reached: 'Campeão' }),
    },
    { age: 24, club: pal, ovr: 85, apps: 47, goals: 29, assists: 11, pos: 1, trophies: [[T.br, 'bra.1']], value: 54_000_000, national: nat(5, 2, 1) },
    {
      age: 25,
      club: pal,
      ovr: 87,
      apps: 44,
      goals: 31,
      assists: 12,
      pos: 2,
      trophies: [[T.lib, 'conmebol.libertadores'], [T.cwc, 'fifa.cwc']],
      awards: [{ award: 'ballon_dor', year: 2036, place: 3 }],
      value: 68_000_000,
      national: nat(4, 2, 1),
    },
  ]
  let prev = 51
  const periods = [0, 0, 1, 2, 3, 3, 4, 4, 5, 5]
  const seasons = rows.map((r, i) => {
    const x = rec(data, r, prev, periods[i])
    prev = r.ovr
    return x
  })
  // loans belong to Palmeiras
  const s = baseState(data, seasons, { period: 6 })
  s.pendingDecision = realMadridOffer(data, rma, pal)
  s.log = [
    { season: 2026, age: 16, type: 'joined', text: `Assinou com o ${pal.name} (base).` },
    { season: 2028, age: 18, type: 'loan_started', text: `Emprestado ao ${juv.name}.` },
    { season: 2033, age: 23, type: 'trophy', text: 'Campeão do Mundo 2034 com o Brasil.' },
  ]
  return s
}

function realMadridOffer(data: GameData, rma: Club, pal: Club): Decision {
  const lg = (c: Club) => data.leagues.find((l) => l.id === c.leagueId)?.shortName ?? ''
  return {
    id: 'transfer-2036',
    kind: 'transfer',
    title: `O ${rma.name} bateu à sua porta`,
    description: `Depois do 3º lugar na Bola de Ouro, os merengues oferecem €95M ao ${pal.name}. O Verdão quer renovar e te dar a braçadeira.`,
    options: [
      {
        id: 'opt-rma',
        label: 'Assinar com',
        title: rma.name,
        clubId: rma.id,
        effects: [
          { kind: 'positive', label: '+3 OVR', probability: 0.6 },
          { kind: 'negative', label: '−2 OVR · adaptação', probability: 0.4 },
        ],
        details: [
          { label: 'Salário', value: '€14M/ano' },
          { label: 'Contrato', value: '5 anos' },
          { label: 'Liga', value: lg(rma) },
        ],
      },
      {
        id: 'opt-pal',
        label: 'Renovar com',
        title: pal.name,
        clubId: pal.id,
        effects: [
          { kind: 'positive', label: '+1 OVR', probability: 0.8 },
          { kind: 'fixed', label: 'Capitão do time', probability: 1 },
        ],
        details: [
          { label: 'Salário', value: '€6M/ano' },
          { label: 'Contrato', value: '4 anos' },
          { label: 'Liga', value: lg(pal) },
        ],
      },
    ],
  }
}

/** Fresh career waiting for the academy offer. */
export function careerNew(data: GameData = mockGameData, identity: PlayerIdentity = FIXTURE_IDENTITY): CareerState {
  return createMockEngine().newCareer(data, identity, 'normal', 'fixture-new')
}

/** careerMid continued by the mock engine until retirement at 39. */
export function careerEnd(data: GameData = mockGameData): CareerState {
  const engine = createMockEngine()
  let s = careerMid(data)
  // one season per decision from here, never retire early → last season at 39
  s = { ...s, seed: 'fixture-end', pace: 'intensa' }
  for (let guard = 0; guard < 40 && s.phase !== 'finished'; guard++) {
    const d = s.pendingDecision
    if (!d) break
    const opt = d.kind === 'retirement' ? (d.options.find((o) => o.id !== 'retire') ?? d.options[0]) : d.options[0]
    s = engine.choose(data, s, opt.id).state
  }
  return { ...s, pace: 'normal' }
}

/** A reveal with trophies + a Bola de Ouro + tier crossing (87 → 90 Lenda). */
export function sampleReveal(data: GameData = mockGameData): { before: CareerState; state: CareerState; reveal: RevealScript } {
  const before = careerMid(data)
  const rma = resolveClub(data, 'e86', 'Real Madrid', 'ESP')
  const liga = trophyId(data, 'laliga', 'LaLiga')
  const ucl = trophyId(data, 'champions-league', 'Campeões')
  const s1 = rec(data, { age: 26, club: rma, ovr: 89, apps: 49, goals: 34, assists: 14, pos: 1, trophies: [[liga, rma.leagueId]], value: 105_000_000, national: { apps: 6, goals: 3, assists: 1 } }, 87, 6)
  const s2 = rec(
    data,
    {
      age: 27,
      club: rma,
      ovr: 90,
      apps: 51,
      goals: 38,
      assists: 15,
      pos: 1,
      trophies: [[liga, rma.leagueId], [ucl, 'uefa.champions']],
      awards: [{ award: 'ballon_dor', year: 2038, place: 1 }],
      value: 150_000_000,
      national: { apps: 7, goals: 4, assists: 2 },
    },
    89,
    6,
  )
  const state = baseState(data, [...before.seasons, s1, s2], { period: 7, pendingDecision: null })
  state.pendingDecision = createMockEngine().choose(data, { ...before, seed: 'fixture-reveal' }, 'opt-rma').state.pendingDecision
  const reveal: RevealScript = {
    optionId: 'opt-rma',
    rolledEffect: 0,
    seasons: [s1, s2],
    trophies: [...s1.trophies, ...s2.trophies],
    awards: [...s1.awards, ...s2.awards],
    relegated: false,
    promoted: false,
    ovrBefore: 87,
    ovrAfter: 90,
    valueBefore: 68_000_000,
    valueAfter: 150_000_000,
    log: [
      { season: 2036, age: 26, type: 'joined', text: `Assinou com o ${rma.name}.` },
      { season: 2036, age: 26, type: 'trophy', text: 'Campeão da LaLiga.' },
      { season: 2037, age: 27, type: 'trophy', text: 'Campeão da Liga dos Campeões.' },
      { season: 2037, age: 27, type: 'award', text: 'Bola de Ouro 2038!' },
    ],
    achievements: ['bola-de-ouro', 'lenda-90'],
    finished: false,
  }
  return { before, state, reveal }
}

/** Summary of any fixture (convenience for the summary / hall screens). */
export const fixtureSummary = (data: GameData = mockGameData, s: CareerState = careerEnd(data)) => summarizeCareer(data, s)
