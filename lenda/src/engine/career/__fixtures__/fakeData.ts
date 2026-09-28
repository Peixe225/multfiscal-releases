/**
 * GameData pequeno e determinístico para os testes da carreira (não depende do pipeline real).
 * 17 ligas / ~250 clubes / 6 confederações / copas nacionais, continentais, Mundial e Copa.
 */
import type { Club, Competition, Confed, Country, GameData, League, Position, RealPlayer, Trophy } from '../../types'

interface LeagueSpec {
  id: string
  country: string
  confed: Confed
  tier: 1 | 2
  n: number
  min: number
  max: number
  coefficient: number
  upper?: string
  lower?: string
  swap?: number
}

const COUNTRIES: [string, string, string, Confed, number, number][] = [
  // code, iso2, nome, confed, força, OVR de convocação
  ['BRA', 'br', 'Brasil', 'CONMEBOL', 88, 80],
  ['ARG', 'ar', 'Argentina', 'CONMEBOL', 88, 80],
  ['URU', 'uy', 'Uruguai', 'CONMEBOL', 80, 75],
  ['COL', 'co', 'Colômbia', 'CONMEBOL', 80, 75],
  ['CHI', 'cl', 'Chile', 'CONMEBOL', 74, 72],
  ['ENG', 'gb-eng', 'Inglaterra', 'UEFA', 87, 81],
  ['ESP', 'es', 'Espanha', 'UEFA', 88, 81],
  ['ITA', 'it', 'Itália', 'UEFA', 85, 80],
  ['GER', 'de', 'Alemanha', 'UEFA', 86, 80],
  ['FRA', 'fr', 'França', 'UEFA', 89, 82],
  ['POR', 'pt', 'Portugal', 'UEFA', 85, 79],
  ['NED', 'nl', 'Holanda', 'UEFA', 84, 79],
  ['MEX', 'mx', 'México', 'CONCACAF', 78, 74],
  ['USA', 'us', 'Estados Unidos', 'CONCACAF', 77, 73],
  ['CAN', 'ca', 'Canadá', 'CONCACAF', 74, 70],
  ['KSA', 'sa', 'Arábia Saudita', 'AFC', 70, 68],
  ['JPN', 'jp', 'Japão', 'AFC', 78, 74],
  ['MAR', 'ma', 'Marrocos', 'CAF', 80, 75],
  ['SEN', 'sn', 'Senegal', 'CAF', 78, 74],
  ['NZL', 'nz', 'Nova Zelândia', 'OFC', 60, 58],
  ['FIJ', 'fj', 'Fiji', 'OFC', 45, 50],
]

const LEAGUES: LeagueSpec[] = [
  { id: 'bra.1', country: 'BRA', confed: 'CONMEBOL', tier: 1, n: 20, min: 68, max: 80, coefficient: 0.74, lower: 'bra.2', swap: 4 },
  { id: 'bra.2', country: 'BRA', confed: 'CONMEBOL', tier: 2, n: 20, min: 60, max: 69, coefficient: 0.5, upper: 'bra.1', swap: 4 },
  { id: 'arg.1', country: 'ARG', confed: 'CONMEBOL', tier: 1, n: 16, min: 65, max: 78, coefficient: 0.64 },
  { id: 'uru.1', country: 'URU', confed: 'CONMEBOL', tier: 1, n: 8, min: 58, max: 70, coefficient: 0.45 },
  { id: 'col.1', country: 'COL', confed: 'CONMEBOL', tier: 1, n: 8, min: 60, max: 71, coefficient: 0.48 },
  { id: 'eng.1', country: 'ENG', confed: 'UEFA', tier: 1, n: 20, min: 74, max: 87, coefficient: 1, lower: 'eng.2', swap: 3 },
  { id: 'eng.2', country: 'ENG', confed: 'UEFA', tier: 2, n: 16, min: 66, max: 74, coefficient: 0.62, upper: 'eng.1', swap: 3 },
  { id: 'esp.1', country: 'ESP', confed: 'UEFA', tier: 1, n: 20, min: 71, max: 88, coefficient: 0.95 },
  { id: 'ita.1', country: 'ITA', confed: 'UEFA', tier: 1, n: 18, min: 71, max: 85, coefficient: 0.9 },
  { id: 'ger.1', country: 'GER', confed: 'UEFA', tier: 1, n: 18, min: 71, max: 86, coefficient: 0.9 },
  { id: 'fra.1', country: 'FRA', confed: 'UEFA', tier: 1, n: 18, min: 68, max: 85, coefficient: 0.82 },
  { id: 'por.1', country: 'POR', confed: 'UEFA', tier: 1, n: 12, min: 64, max: 81, coefficient: 0.7 },
  { id: 'ned.1', country: 'NED', confed: 'UEFA', tier: 1, n: 12, min: 64, max: 80, coefficient: 0.68 },
  { id: 'mex.1', country: 'MEX', confed: 'CONCACAF', tier: 1, n: 12, min: 65, max: 76, coefficient: 0.6 },
  { id: 'usa.1', country: 'USA', confed: 'CONCACAF', tier: 1, n: 12, min: 64, max: 75, coefficient: 0.55 },
  { id: 'ksa.1', country: 'KSA', confed: 'AFC', tier: 1, n: 10, min: 60, max: 78, coefficient: 0.5 },
  { id: 'jpn.1', country: 'JPN', confed: 'AFC', tier: 1, n: 10, min: 62, max: 72, coefficient: 0.5 },
  { id: 'mar.1', country: 'MAR', confed: 'CAF', tier: 1, n: 8, min: 56, max: 68, coefficient: 0.4 },
  { id: 'nzl.1', country: 'NZL', confed: 'OFC', tier: 1, n: 6, min: 48, max: 58, coefficient: 0.3 },
]

const CLUB_WORDS = ['Atlético', 'Esporte', 'União', 'Real', 'Nacional', 'Sporting', 'Olímpico', 'Racing', 'Estrela', 'Cruzeiro', 'Ferroviário', 'Operário', 'Guarani', 'América', 'Botafogo', 'Juventude', 'Internacional', 'Palmeiras', 'Santos', 'Vitória']

const CONFED_COMPS: Record<Confed, { primary: string; primaryName: string; secondary?: string; secondaryName?: string; national: string; nationalName: string; nationalFirst: number; nationalEvery: number }> = {
  CONMEBOL: { primary: 'conmebol.libertadores', primaryName: 'Copa Libertadores', secondary: 'conmebol.sudamericana', secondaryName: 'Copa Sul-Americana', national: 'conmebol.america', nationalName: 'Copa América', nationalFirst: 2028, nationalEvery: 4 },
  UEFA: { primary: 'uefa.champions', primaryName: 'Liga dos Campeões', secondary: 'uefa.europa', secondaryName: 'Liga Europa', national: 'uefa.euro', nationalName: 'Eurocopa', nationalFirst: 2028, nationalEvery: 4 },
  CONCACAF: { primary: 'concacaf.champions', primaryName: 'Copa dos Campeões da Concacaf', national: 'concacaf.gold', nationalName: 'Copa Ouro', nationalFirst: 2027, nationalEvery: 2 },
  AFC: { primary: 'afc.champions', primaryName: 'Liga dos Campeões da Ásia', national: 'afc.asian', nationalName: 'Copa da Ásia', nationalFirst: 2027, nationalEvery: 4 },
  CAF: { primary: 'caf.champions', primaryName: 'Liga dos Campeões da África', national: 'caf.afcon', nationalName: 'Copa Africana de Nações', nationalFirst: 2027, nationalEvery: 2 },
  OFC: { primary: 'ofc.champions', primaryName: 'Liga dos Campeões da Oceania', national: 'ofc.nations', nationalName: 'Copa das Nações da OFC', nationalFirst: 2028, nationalEvery: 4 },
}

const POSITIONS: Position[] = ['GOL', 'ZAG', 'ZAG', 'LD', 'LE', 'VOL', 'MC', 'MEI', 'PE', 'PD', 'CA', 'CA']

export function makeFakeData(): GameData {
  const countries: Country[] = COUNTRIES.map(([code, iso2, name, confed, strength, callUpOvr]) => ({
    code,
    iso2,
    name,
    confed,
    strength,
    callUpOvr,
    colors: { primary: '#008000', kit1: '#ffff00', kit2: '#0000ff' },
  }))
  const leagues: League[] = []
  const clubs: Club[] = []
  const competitions: Competition[] = []
  const trophies: Trophy[] = []

  for (const spec of LEAGUES) {
    const cupId = `${spec.country.toLowerCase()}.copa`
    leagues.push({
      id: spec.id,
      name: `Liga ${spec.country} ${spec.tier}`,
      shortName: `${spec.country} ${spec.tier}`,
      country: spec.country,
      confed: spec.confed,
      tier: spec.tier,
      calendar: spec.confed === 'UEFA' ? 'split' : 'calendar',
      coefficient: spec.coefficient,
      format: { rounds: 2, playoffTeams: 0 },
      promotion: spec.upper ? spec.swap ?? 0 : 0,
      relegation: spec.lower ? spec.swap ?? 0 : 0,
      upperLeagueId: spec.upper,
      lowerLeagueId: spec.lower,
      domesticCupId: cupId,
      continentalSlots: spec.tier === 1 ? [4, 3] : [0, 0],
      trophyId: `trophy-${spec.id}`,
    })
    trophies.push({ id: `trophy-${spec.id}`, name: `Campeonato ${spec.country}${spec.tier === 2 ? ' (2ª divisão)' : ''}`, family: 'league' })
    if (!competitions.some((c) => c.id === cupId)) {
      competitions.push({ id: cupId, name: `Copa ${spec.country}`, kind: 'domestic_cup', country: spec.country, confed: spec.confed, size: 32, trophyId: `trophy-${cupId}` })
      trophies.push({ id: `trophy-${cupId}`, name: `Copa ${spec.country}`, family: 'domestic_cup' })
    }
    for (let i = 0; i < spec.n; i++) {
      const strength = Math.round(spec.max - ((spec.max - spec.min) * i) / Math.max(1, spec.n - 1))
      const prestige = spec.tier === 2 ? (i < 4 ? 1 : 0) : i < 2 ? 5 : i < 4 ? 4 : i < 7 ? 3 : i < 11 ? 2 : 1
      const word = CLUB_WORDS[i % CLUB_WORDS.length]
      const name = `${word} ${spec.country}${spec.tier === 2 ? ' B' : ''} ${i + 1}`
      const club: Club = {
        id: `${spec.id}-${i + 1}`,
        name,
        shortName: name,
        abbr: `${spec.country.slice(0, 2)}${i + 1}`,
        country: spec.country,
        leagueId: spec.id,
        colors: { primary: '#112233', secondary: '#ffffff' },
        strength,
        prestige,
      }
      if (spec.id === 'esp.1' && i === 6) club.onlyNationality = 'ESP' // "Athletic"
      if (spec.id === 'mex.1' && i === 1) club.onlyNationality = 'MEX' // "Chivas"
      clubs.push(club)
    }
  }

  const confederations: GameData['confederations'] = {}
  for (const [confed, c] of Object.entries(CONFED_COMPS) as [Confed, (typeof CONFED_COMPS)[Confed]][]) {
    competitions.push({ id: c.primary, name: c.primaryName, kind: 'continental_primary', confed, size: 32, trophyId: `trophy-${c.primary}` })
    trophies.push({ id: `trophy-${c.primary}`, name: c.primaryName, family: 'continental_primary' })
    if (c.secondary) {
      competitions.push({ id: c.secondary, name: c.secondaryName!, kind: 'continental_secondary', confed, size: 32, trophyId: `trophy-${c.secondary}` })
      trophies.push({ id: `trophy-${c.secondary}`, name: c.secondaryName!, family: 'continental_secondary' })
    }
    competitions.push({ id: c.national, name: c.nationalName, kind: 'national_continental', confed, size: 16, schedule: { firstYear: c.nationalFirst, every: c.nationalEvery }, trophyId: `trophy-${c.national}` })
    trophies.push({ id: `trophy-${c.national}`, name: c.nationalName, family: 'national_continental' })
    confederations[confed] = { primary: c.primary, secondary: c.secondary, national: c.national }
  }
  competitions.push({ id: 'fifa.cwc', name: 'Mundial de Clubes', kind: 'club_world_cup', size: 32, schedule: { firstYear: 2029, every: 4 }, trophyId: 'trophy-fifa.cwc' })
  trophies.push({ id: 'trophy-fifa.cwc', name: 'Mundial de Clubes', family: 'club_world_cup' })
  competitions.push({ id: 'fifa.world', name: 'Copa do Mundo', kind: 'world_cup', size: 32, schedule: { firstYear: 2030, every: 4 }, trophyId: 'trophy-fifa.world' })
  trophies.push({ id: 'trophy-fifa.world', name: 'Copa do Mundo', family: 'world_cup' })

  // estrelas reais (rivais nos prêmios e na convocação)
  const stars: RealPlayer[] = []
  const starNations = ['BRA', 'ARG', 'FRA', 'ENG', 'ESP', 'GER', 'POR', 'ITA', 'NED', 'URU', 'COL', 'MAR', 'JPN', 'USA', 'MEX']
  const bigClubs = clubs.filter((c) => c.prestige >= 4 && ['ENG', 'ESP', 'GER', 'ITA', 'FRA'].includes(c.country))
  let k = 0
  for (const nat of starNations) {
    const top = ['BRA', 'ARG', 'FRA', 'ENG', 'ESP', 'GER', 'POR'].includes(nat)
    const count = top ? 10 : 5
    for (let i = 0; i < count; i++) {
      const ovr = (top ? 90 : 85) - Math.floor(i * (top ? 1.1 : 1.5)) - (k % 3)
      const club = bigClubs[k % bigClubs.length]
      stars.push({
        id: `star-${nat}-${i}`,
        name: `Craque ${nat} ${i + 1}`,
        shortName: `Craque ${i + 1}`,
        nationality: nat,
        position: POSITIONS[(i + k) % POSITIONS.length],
        birthYear: 1994 + ((i * 3 + k) % 12),
        clubId: club.id,
        ovr,
        potential: ovr + 2,
      })
      k++
    }
  }

  return {
    generatedAt: '2026-09-27T12:00:00.000Z',
    countries,
    leagues,
    clubs,
    competitions,
    trophies,
    stars,
    standings: {},
    fixtures: {},
    history: { ballonDor: [], worldCup: [], champions: {} },
    cupsInProgress: {},
    extraClubIds: [],
    confederations,
  }
}

let cached: GameData | null = null
/** Instância compartilhada (os índices são memorizados por referência). */
export function fakeData(): GameData {
  if (!cached) cached = makeFakeData()
  return cached
}
