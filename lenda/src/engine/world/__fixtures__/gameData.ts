/**
 * GameData sintético (determinístico) para os testes do motor do mundo. Cobre: ligas ligadas com
 * play-off de acesso (inglês e alemão), Apertura/Clausura com zonas (Argentina), play-offs (MLS,
 * Liga MX), liga desatualizada (stale), estaduais, continentais das 6 confederações, clubes extras,
 * edições em andamento (Libertadores na semi, Champions na fase de liga, Copa do Brasil na semi).
 */
import type {
  Club,
  Competition,
  CompetitionKind,
  Confed,
  Country,
  Fixture,
  GameData,
  League,
  LeagueSnapshot,
  Position,
  RealPlayer,
  StandingRow,
  Trophy,
} from '../../types'
import type { CupInProgress } from '../../api'
import { Rng } from '../../rng'
import { randomName } from '../names'
import { roundRobin } from '../schedule'
import { addResult, newRow, sortTable } from '../table'
import { simulateMatch } from '../match'

const COUNTRIES: Record<Confed, string[]> = {
  UEFA: 'ESP FRA ENG POR GER NED ITA BEL CRO SUI DEN AUT NOR TUR SCO SRB UKR POL SWE CZE HUN GRE WAL IRL ROU SVK SVN RUS ISL FIN'.split(' '),
  CONMEBOL: 'ARG BRA URU COL ECU PAR CHI PER VEN BOL'.split(' '),
  CONCACAF: 'MEX USA CAN PAN CRC JAM HON SLV GUA TRI HAI CUB'.split(' '),
  CAF: 'MAR SEN NGA EGY CIV CMR ALG TUN GHA MLI RSA BFA COD GUI CPV GAB ZAM ANG UGA KEN TAN BEN EQG MOZ'.split(' '),
  AFC: 'JPN KOR IRN AUS KSA QAT IRQ UAE UZB JOR OMA BHR CHN SYR PLE KUW LBN THA VIE IDN IND KGZ TJK PRK'.split(' '),
  OFC: 'NZL FIJ TAH PNG SOL VAN'.split(' '),
}
const CONFED_TOP: Record<Confed, number> = { UEFA: 88, CONMEBOL: 88, CONCACAF: 78, CAF: 80, AFC: 79, OFC: 62 }

interface LeagueSpec {
  id: string
  country: string
  confed: Confed
  tier: 1 | 2
  n: number
  coef: number
  rounds?: 1 | 2 | 3 | 4
  playoff?: number
  tournaments?: 1 | 2
  calendar?: 'calendar' | 'split'
  promotion?: number
  relegation?: number
  upper?: string
  lower?: string
  cup?: string
  cup2?: string
  slots?: [number, number]
  t?: number
  pp?: League['promotionPlayoff']
  stale?: boolean
}

const LEAGUES: LeagueSpec[] = [
  { id: 'bra.1', country: 'BRA', confed: 'CONMEBOL', tier: 1, n: 20, coef: 0.74, calendar: 'calendar', relegation: 4, lower: 'bra.2', cup: 'bra.copa', slots: [6, 6] },
  { id: 'bra.2', country: 'BRA', confed: 'CONMEBOL', tier: 2, n: 20, coef: 0.5, calendar: 'calendar', promotion: 4, upper: 'bra.1', cup: 'bra.copa' },
  { id: 'arg.1', country: 'ARG', confed: 'CONMEBOL', tier: 1, n: 28, coef: 0.64, calendar: 'calendar', rounds: 1, playoff: 16, tournaments: 2, relegation: 2, lower: 'arg.2', cup: 'arg.copa', slots: [6, 6] },
  { id: 'arg.2', country: 'ARG', confed: 'CONMEBOL', tier: 2, n: 20, coef: 0.42, calendar: 'calendar', promotion: 2, pp: { positions: [2, 9], spots: 1 }, upper: 'arg.1', cup: 'arg.copa' },
  { id: 'col.1', country: 'COL', confed: 'CONMEBOL', tier: 1, n: 16, coef: 0.52, calendar: 'calendar', rounds: 1, playoff: 8, tournaments: 2, slots: [4, 4] },
  { id: 'uru.1', country: 'URU', confed: 'CONMEBOL', tier: 1, n: 12, coef: 0.48, calendar: 'calendar', slots: [4, 4] },
  { id: 'chi.1', country: 'CHI', confed: 'CONMEBOL', tier: 1, n: 12, coef: 0.47, calendar: 'calendar', slots: [4, 4] },
  { id: 'ecu.1', country: 'ECU', confed: 'CONMEBOL', tier: 1, n: 12, coef: 0.5, calendar: 'calendar', playoff: 6, slots: [4, 4] },
  { id: 'par.1', country: 'PAR', confed: 'CONMEBOL', tier: 1, n: 12, coef: 0.45, calendar: 'calendar', tournaments: 2, slots: [4, 4] },
  { id: 'eng.1', country: 'ENG', confed: 'UEFA', tier: 1, n: 20, coef: 1, relegation: 3, lower: 'eng.2', cup: 'eng.fa', cup2: 'eng.league_cup', slots: [5, 2], t: 1 },
  { id: 'eng.2', country: 'ENG', confed: 'UEFA', tier: 2, n: 24, coef: 0.6, promotion: 3, pp: { positions: [3, 6], spots: 1 }, upper: 'eng.1', cup: 'eng.fa', cup2: 'eng.league_cup' },
  { id: 'esp.1', country: 'ESP', confed: 'UEFA', tier: 1, n: 20, coef: 0.94, cup: 'esp.copa', slots: [5, 2], t: 1 },
  { id: 'ita.1', country: 'ITA', confed: 'UEFA', tier: 1, n: 20, coef: 0.9, cup: 'ita.copa', slots: [4, 2], t: 1 },
  { id: 'ger.1', country: 'GER', confed: 'UEFA', tier: 1, n: 18, coef: 0.9, relegation: 3, lower: 'ger.2', cup: 'ger.pokal', slots: [4, 2], t: 1 },
  { id: 'ger.2', country: 'GER', confed: 'UEFA', tier: 2, n: 18, coef: 0.55, promotion: 3, pp: { positions: [3, 3], spots: 1, upperPosition: 16 }, upper: 'ger.1', cup: 'ger.pokal' },
  { id: 'fra.1', country: 'FRA', confed: 'UEFA', tier: 1, n: 18, coef: 0.85, cup: 'fra.coupe', slots: [3, 2], t: 1 },
  { id: 'por.1', country: 'POR', confed: 'UEFA', tier: 1, n: 18, coef: 0.72, cup: 'por.taca', slots: [2, 2], t: 1 },
  { id: 'ned.1', country: 'NED', confed: 'UEFA', tier: 1, n: 18, coef: 0.7, slots: [2, 2], t: 1 },
  { id: 'tur.1', country: 'TUR', confed: 'UEFA', tier: 1, n: 18, coef: 0.62, slots: [2, 1], t: 1 },
  { id: 'sco.1', country: 'SCO', confed: 'UEFA', tier: 1, n: 12, coef: 0.54, rounds: 3, slots: [2, 1], t: 1, stale: true },
  { id: 'rus.1', country: 'RUS', confed: 'UEFA', tier: 1, n: 16, coef: 0.55, slots: [0, 0] },
  { id: 'mex.1', country: 'MEX', confed: 'CONCACAF', tier: 1, n: 18, coef: 0.6, calendar: 'split', rounds: 1, playoff: 10, tournaments: 2, slots: [6, 0] },
  { id: 'usa.1', country: 'USA', confed: 'CONCACAF', tier: 1, n: 20, coef: 0.58, calendar: 'calendar', playoff: 18, cup: 'usa.open', slots: [5, 0] },
  { id: 'crc.1', country: 'CRC', confed: 'CONCACAF', tier: 1, n: 10, coef: 0.38, calendar: 'split', playoff: 4, tournaments: 2, slots: [2, 0] },
  { id: 'ksa.1', country: 'KSA', confed: 'AFC', tier: 1, n: 18, coef: 0.58, cup: 'ksa.cup', slots: [3, 1] },
  { id: 'jpn.1', country: 'JPN', confed: 'AFC', tier: 1, n: 18, coef: 0.52, slots: [3, 1] },
  { id: 'aus.1', country: 'AUS', confed: 'AFC', tier: 1, n: 12, coef: 0.42, playoff: 6, slots: [1, 1] },
  { id: 'rsa.1', country: 'RSA', confed: 'CAF', tier: 1, n: 16, coef: 0.4, slots: [2, 2] },
]

const EXTRAS: [string, number][] = [
  ['UKR', 74], ['CZE', 72], ['SRB', 72], ['CRO', 73], ['GRE', 73], ['AUT', 72], ['SUI', 71], ['POL', 70], ['HUN', 69], ['DEN', 71], ['NOR', 70], ['SWE', 69],
  ['EGY', 72], ['EGY', 69], ['EGY', 68], ['MAR', 70], ['MAR', 68], ['MAR', 66], ['TUN', 67], ['TUN', 65], ['ALG', 64], ['NGA', 60], ['SEN', 60], ['CIV', 61],
  ['QAT', 68], ['QAT', 66], ['QAT', 64], ['UAE', 67], ['UAE', 65], ['UAE', 63], ['KOR', 67], ['KOR', 66], ['IRN', 65], ['IRN', 64],
  ['PAN', 60], ['HON', 58], ['GUA', 57], ['JAM', 56], ['NZL', 55],
]

export const FIXTURE_FIRST_SEASON = 2026

function comp(id: string, kind: CompetitionKind, size: number, extra: Partial<Competition> = {}): Competition {
  return { id, name: id, kind, size, trophyId: `t-${id}`, ...extra }
}

export function buildFixture(): GameData {
  const rng = new Rng('lenda-fixture')
  const countries: Country[] = []
  for (const [cf, list] of Object.entries(COUNTRIES) as [Confed, string[]][]) {
    list.forEach((code, i) => {
      countries.push({
        code,
        iso2: code.toLowerCase().slice(0, 2),
        name: code,
        confed: cf,
        strength: Math.round(CONFED_TOP[cf] - i * (cf === 'CONMEBOL' ? 2.2 : 1.3)),
        callUpOvr: 70,
        colors: { primary: '#123456', kit1: '#123456', kit2: '#ffffff' },
      })
    })
  }

  const leagues: League[] = []
  const clubs: Club[] = []
  const standings: Record<string, StandingRow[]> = {}
  const fixtures: Record<string, Fixture[]> = {}
  const snapshot: Record<string, LeagueSnapshot> = {}
  for (const s of LEAGUES) {
    const l: League = {
      id: s.id,
      name: s.id,
      shortName: s.id,
      country: s.country,
      confed: s.confed,
      tier: s.tier,
      calendar: s.calendar ?? 'split',
      coefficient: s.coef,
      format: { rounds: s.rounds ?? 2, playoffTeams: s.playoff ?? 0 },
      promotion: s.promotion ?? 0,
      relegation: s.relegation ?? 0,
      continentalSlots: s.slots ?? [0, 0],
      trophyId: `t-${s.id}`,
    }
    if (s.upper) l.upperLeagueId = s.upper
    if (s.lower) l.lowerLeagueId = s.lower
    if (s.cup) l.domesticCupId = s.cup
    if (s.cup2) l.secondaryCupId = s.cup2
    if (s.t) l.continentalTertiarySlots = s.t
    if (s.tournaments) l.tournamentsPerSeason = s.tournaments
    if (s.pp) l.promotionPlayoff = s.pp
    if (s.stale) l.stale = true
    leagues.push(l)
    const mean = 55 + 25 * s.coef
    for (let i = 0; i < s.n; i++) {
      const id = `${s.id}-${String(i + 1).padStart(2, '0')}`
      const club: Club = {
        id,
        name: `Clube ${id}`,
        shortName: id,
        abbr: id.slice(0, 3).toUpperCase(),
        country: s.country,
        leagueId: s.id,
        colors: { primary: '#aa0000', secondary: '#ffffff' },
        strength: Math.round((mean + 7 - (14 * i) / (s.n - 1) + rng.normal(0, 1)) * 10) / 10,
        prestige: Math.max(0, Math.round((5 - (6 * i) / s.n) * 10) / 10),
      }
      if (s.country === 'BRA') club.state = ['SP', 'RJ', 'MG', 'RS', 'SP', 'PR'][i % 6]
      if (s.id === 'esp.1' && i === 6) club.onlyNationality = 'ESP'
      clubs.push(club)
    }
  }
  const extraClubIds: string[] = []
  EXTRAS.forEach(([country, strength], i) => {
    const id = `x-${country.toLowerCase()}-${i}`
    clubs.push({
      id,
      name: id,
      shortName: id,
      abbr: 'EXT',
      country,
      leagueId: 'none',
      colors: { primary: '#000000', secondary: '#ffffff' },
      strength,
      prestige: 2.5,
    })
    extraClubIds.push(id)
  })
  const byLeague = (id: string) => clubs.filter((c) => c.leagueId === id)
  const strength = new Map(clubs.map((c) => [c.id, c.strength] as const))

  // tabela real parcial: joga os `played` primeiros jogos de um turno e devolve o resto como fixtures
  const partial = (leagueId: string, rounds: number, played: number, opts: { groups?: string[]; phase?: string; complete?: boolean; dropFixtures?: number } = {}) => {
    const ids = byLeague(leagueId).map((c) => c.id)
    const groupOf = new Map<string, string>()
    let lists: string[][] = [ids]
    if (opts.groups) {
      lists = opts.groups.map((g, gi) => ids.filter((_, i) => i % opts.groups!.length === gi))
      lists.forEach((l, gi) => l.forEach((id) => groupOf.set(id, opts.groups![gi])))
    }
    const rows = new Map(ids.map((id) => [id, newRow(id, groupOf.get(id))] as const))
    const rest: Fixture[] = []
    let games = 0
    for (const list of lists) {
      const days = roundRobin(list, rounds, rng)
      games = Math.max(games, days.length)
      days.forEach((day, d) => {
        for (const [h, a] of day) {
          if (d < played) {
            const m = simulateMatch(strength.get(h)!, strength.get(a)!, rng)
            addResult(rows.get(h)!, rows.get(a)!, m.score[0], m.score[1])
          } else rest.push({ round: d + 1, home: h, away: a })
        }
      })
    }
    standings[leagueId] = sortTable([...rows.values()])
    fixtures[leagueId] = rest.slice(0, rest.length - (opts.dropFixtures ?? 0))
    snapshot[leagueId] = {
      season: FIXTURE_FIRST_SEASON,
      phase: opts.phase ?? String(FIXTURE_FIRST_SEASON),
      gamesPerTeam: games,
      fixturesComplete: opts.complete ?? !opts.dropFixtures,
    }
  }
  partial('bra.1', 2, 28)
  partial('bra.2', 2, 30, { dropFixtures: 40, complete: false })
  partial('eng.1', 2, 5)
  partial('arg.1', 1, 10, { groups: ['Zona A', 'Zona B'], phase: `Clausura ${FIXTURE_FIRST_SEASON}` })
  partial('mex.1', 1, 9, { phase: `Apertura ${FIXTURE_FIRST_SEASON}` })
  partial('usa.1', 2, 15, { groups: ['Leste', 'Oeste'] })
  // Argentina: 13 jogos na zona + 3 interzonais
  snapshot['arg.1'].gamesPerTeam = 16
  snapshot['arg.1'].fixturesComplete = false
  standings['sco.1'] = byLeague('sco.1').map((c) => newRow(c.id))
  snapshot['sco.1'] = { season: FIXTURE_FIRST_SEASON, phase: '2026/27', gamesPerTeam: 33, fixturesComplete: false, stale: true }

  const competitions: Competition[] = []
  for (const l of leagues) competitions.push(comp(l.id, 'league', byLeague(l.id).length, { country: l.country, confed: l.confed }))
  const cupIds = new Set<string>()
  for (const l of leagues) for (const id of [l.domesticCupId, l.secondaryCupId]) if (id) cupIds.add(id)
  for (const id of cupIds) competitions.push(comp(id, 'domestic_cup', id === 'bra.copa' ? 32 : 64, { country: id.split('.')[0].toUpperCase() }))
  competitions.push(comp('bra.camp.paulista', 'domestic_cup', 16, { country: 'BRA', region: 'SP' }))
  competitions.push(comp('bra.camp.carioca', 'domestic_cup', 12, { country: 'BRA', region: 'RJ' }))
  const cont: [string, CompetitionKind, Confed, number, boolean?][] = [
    ['conmebol.libertadores', 'continental_primary', 'CONMEBOL', 32],
    ['conmebol.sudamericana', 'continental_secondary', 'CONMEBOL', 32],
    ['conmebol.recopa', 'continental_secondary', 'CONMEBOL', 2, true],
    ['uefa.champions', 'continental_primary', 'UEFA', 36],
    ['uefa.europa', 'continental_secondary', 'UEFA', 36],
    ['uefa.europa.conf', 'continental_tertiary', 'UEFA', 36],
    ['uefa.super_cup', 'continental_secondary', 'UEFA', 2, true],
    ['concacaf.champions', 'continental_primary', 'CONCACAF', 16],
    ['afc.champions', 'continental_primary', 'AFC', 24],
    ['afc.cup', 'continental_secondary', 'AFC', 16],
    ['caf.champions', 'continental_primary', 'CAF', 16],
    ['caf.confed', 'continental_secondary', 'CAF', 16],
  ]
  for (const [id, kind, confed, size, sup] of cont) competitions.push(comp(id, kind, size, sup ? { confed, superCup: true } : { confed }))
  competitions.push(comp('fifa.cwc', 'club_world_cup', 32, { schedule: { firstYear: 2029, every: 4 } }))
  competitions.push(comp('fifa.intercontinental_cup', 'club_world_cup', 6))
  competitions.push(comp('fifa.world', 'world_cup', 48, { schedule: { firstYear: 2030, every: 4 } }))
  competitions.push(comp('conmebol.america', 'national_continental', 16, { confed: 'CONMEBOL', schedule: { firstYear: 2028, every: 4 } }))
  competitions.push(comp('uefa.euro', 'national_continental', 24, { confed: 'UEFA', schedule: { firstYear: 2028, every: 4 } }))
  competitions.push(comp('concacaf.gold', 'national_continental', 16, { confed: 'CONCACAF', schedule: { firstYear: 2027, every: 2 } }))
  competitions.push(comp('caf.nations', 'national_continental', 24, { confed: 'CAF', schedule: { firstYear: 2027, every: 2 } }))
  competitions.push(comp('afc.asian.cup', 'national_continental', 24, { confed: 'AFC', schedule: { firstYear: 2027, every: 4 } }))
  competitions.push(comp('ofc.nations', 'national_continental', 8, { confed: 'OFC', schedule: { firstYear: 2028, every: 4 } }))
  const trophies: Trophy[] = competitions.map((c) => ({ id: c.trophyId, name: c.name, family: c.kind === 'award' ? 'award' : c.kind }))

  // estrelas: concentradas nos clubes fortes das ligas grandes
  const stars: RealPlayer[] = []
  const positions: Position[] = ['CA', 'CA', 'PE', 'PD', 'MEI', 'MC', 'VOL', 'ZAG', 'ZAG', 'LD', 'LE', 'GOL']
  const strongClubs = clubs
    .filter((c) => c.leagueId !== 'none' && leagues.find((l) => l.id === c.leagueId)!.tier === 1)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 60)
  const nats = ['BRA', 'FRA', 'ESP', 'ENG', 'ARG', 'GER', 'POR', 'NED', 'ITA', 'BEL', 'NOR', 'URU', 'COL', 'CRO', 'MAR', 'SEN', 'NGA', 'JPN', 'KOR', 'USA', 'MEX']
  for (let i = 0; i < 160; i++) {
    const club = strongClubs[i % strongClubs.length]
    const nationality = club.onlyNationality ?? (rng.chance(0.4) ? club.country : rng.pick(nats))
    const ovr = Math.round(Math.min(92, Math.max(76, club.strength + rng.normal(1, 3.5))))
    const nm = randomName(nationality, rng)
    stars.push({
      id: `star-${i}`,
      name: nm.name,
      shortName: nm.shortName,
      nationality,
      position: positions[i % positions.length],
      birthYear: FIXTURE_FIRST_SEASON - rng.int(18, 35),
      clubId: club.id,
      ovr,
    })
  }

  // edições em andamento
  const cupsInProgress: Record<string, CupInProgress> = {}
  const top = (leagueId: string, k: number) => byLeague(leagueId).slice(0, k).map((c) => c.id)
  const lib = [top('bra.1', 2), top('arg.1', 2)].flat()
  cupsInProgress['conmebol.libertadores'] = {
    competitionId: 'conmebol.libertadores',
    season: FIXTURE_FIRST_SEASON,
    stage: 'Semifinal',
    alive: lib,
    pairs: [
      { a: lib[0], b: lib[2], legs: [{ home: lib[2], away: lib[0] }, { home: lib[0], away: lib[2] }] },
      { a: lib[1], b: lib[3], legs: [{ home: lib[3], away: lib[1] }, { home: lib[1], away: lib[3] }] },
    ],
    completed: [
      {
        name: 'Quartas de final',
        ties: lib.map((id, i) => ({
          a: id,
          b: byLeague('uru.1')[i].id,
          legs: [{ home: byLeague('uru.1')[i].id, away: id, score: [0, 1] as [number, number] }],
          winner: id,
        })),
      },
    ],
  }
  const cdb = [byLeague('bra.1')[3].id, byLeague('bra.1')[4].id, byLeague('bra.1')[1].id, byLeague('bra.2')[0].id]
  cupsInProgress['bra.copa'] = {
    competitionId: 'bra.copa',
    season: FIXTURE_FIRST_SEASON,
    stage: 'Semifinal',
    alive: cdb,
    pairs: [
      { a: cdb[0], b: cdb[1], legs: [{ home: cdb[1], away: cdb[0], score: [2, 0] }, { home: cdb[0], away: cdb[1] }] },
      { a: cdb[2], b: cdb[3], legs: [{ home: cdb[3], away: cdb[2], score: [1, 1] }, { home: cdb[2], away: cdb[3] }] },
    ],
  }
  const uefaClubs = clubs
    .filter((c) => leagues.find((l) => l.id === c.leagueId)?.confed === 'UEFA' && leagues.find((l) => l.id === c.leagueId)?.tier === 1)
    .sort((a, b) => b.strength - a.strength)
  const phaseTable = (ids: string[], played: number): StandingRow[] => {
    const rows = new Map(ids.map((id) => [id, newRow(id)] as const))
    if (played) for (let i = 0; i < ids.length; i += 2) {
      const m = simulateMatch(strength.get(ids[i])!, strength.get(ids[i + 1])!, rng)
      addResult(rows.get(ids[i])!, rows.get(ids[i + 1])!, m.score[0], m.score[1])
    }
    return sortTable([...rows.values()])
  }
  const ucl = uefaClubs.slice(0, 36).map((c) => c.id)
  const uel = uefaClubs.slice(36, 72).map((c) => c.id)
  cupsInProgress['uefa.champions'] = { competitionId: 'uefa.champions', season: FIXTURE_FIRST_SEASON, stage: 'Fase de liga', alive: ucl, table: phaseTable(ucl, 1) }
  cupsInProgress['uefa.europa'] = { competitionId: 'uefa.europa', season: FIXTURE_FIRST_SEASON, stage: 'Fase de liga', alive: uel, table: phaseTable(uel, 0) }
  fixtures['uefa.champions'] = [{ home: ucl[1], away: ucl[3] }, { home: ucl[5], away: ucl[7] }]

  const champ = (id: string) => ({ season: FIXTURE_FIRST_SEASON - 1, winner: id })
  return {
    generatedAt: '2026-09-27T12:00:00Z',
    countries,
    leagues,
    clubs,
    competitions,
    trophies,
    stars,
    standings,
    fixtures,
    history: {
      ballonDor: [],
      worldCup: [{ year: 2026, champion: 'ESP', runnerUp: 'ARG' }],
      champions: {
        'uefa.champions': [champ(byLeague('fra.1')[0].id)],
        'uefa.europa': [champ(byLeague('eng.1')[6].id)],
        'conmebol.libertadores': [champ(byLeague('bra.1')[0].id)],
        'conmebol.sudamericana': [champ(byLeague('arg.1')[5].id)],
        'concacaf.champions': [champ(byLeague('mex.1')[0].id)],
        'afc.champions': [champ(byLeague('ksa.1')[0].id)],
        'caf.champions': [champ(byLeague('rsa.1')[0].id)],
        'arg.1': [{ season: FIXTURE_FIRST_SEASON, winner: byLeague('arg.1')[7].id }],
      },
    },
    cupsInProgress,
    extraClubIds,
    confederations: {
      CONMEBOL: { primary: 'conmebol.libertadores', secondary: 'conmebol.sudamericana', superCup: 'conmebol.recopa', national: 'conmebol.america' },
      UEFA: { primary: 'uefa.champions', secondary: 'uefa.europa', tertiary: 'uefa.europa.conf', superCup: 'uefa.super_cup', national: 'uefa.euro' },
      CONCACAF: { primary: 'concacaf.champions', national: 'concacaf.gold' },
      AFC: { primary: 'afc.champions', secondary: 'afc.cup', national: 'afc.asian.cup' },
      CAF: { primary: 'caf.champions', secondary: 'caf.confed', national: 'caf.nations' },
      OFC: { national: 'ofc.nations' },
    },
    snapshot,
  }
}

let cached: GameData | undefined
/** Fixture memorizado (testes não mutam dados). */
export function fixture(): GameData {
  return (cached ??= buildFixture())
}
