/**
 * Tiny mock GameData — used only when the data pipeline (src/data/index.ts) is not available.
 * Real club names/colours; ids follow the ESPN pattern where known (e2029 Palmeiras, e819 Flamengo…).
 */
import type { Club, Competition, Country, GameData, Hex, League, RealPlayer, StandingRow, Trophy } from '@/engine/types'

const C = (code: string, iso2: string, name: string, confed: Country['confed'], strength: number, primary: Hex, kit1: Hex, kit2: Hex, kitPattern?: Country['kitPattern']): Country => ({
  code,
  iso2,
  name,
  confed,
  strength,
  callUpOvr: Math.round(strength - 6),
  colors: { primary, kit1, kit2 },
  kitPattern,
})

export const MOCK_COUNTRIES: Country[] = [
  C('BRA', 'br', 'Brasil', 'CONMEBOL', 88, '#009c3b', '#ffd600', '#0b3aa8'),
  C('ARG', 'ar', 'Argentina', 'CONMEBOL', 90, '#6cace4', '#ffffff', '#1b2a4a', 'stripes'),
  C('URU', 'uy', 'Uruguai', 'CONMEBOL', 82, '#5aa3dd', '#5aa3dd', '#ffffff'),
  C('COL', 'co', 'Colômbia', 'CONMEBOL', 81, '#fcd116', '#fcd116', '#003893'),
  C('POR', 'pt', 'Portugal', 'UEFA', 87, '#c8102e', '#c8102e', '#006233'),
  C('ESP', 'es', 'Espanha', 'UEFA', 90, '#c60b1e', '#c60b1e', '#ffc400'),
  C('FRA', 'fr', 'França', 'UEFA', 90, '#1d3f8f', '#1d3f8f', '#ffffff'),
  C('ENG', 'gb-eng', 'Inglaterra', 'UEFA', 88, '#ffffff', '#ffffff', '#1d2b5c'),
  C('GER', 'de', 'Alemanha', 'UEFA', 86, '#ffffff', '#ffffff', '#111111'),
  C('ITA', 'it', 'Itália', 'UEFA', 84, '#1f5fb4', '#1f5fb4', '#ffffff'),
  C('NED', 'nl', 'Holanda', 'UEFA', 85, '#ff6c00', '#ff6c00', '#1d2b5c'),
  C('BEL', 'be', 'Bélgica', 'UEFA', 82, '#e30613', '#e30613', '#111111'),
  C('MEX', 'mx', 'México', 'CONCACAF', 78, '#006847', '#006847', '#ffffff'),
  C('USA', 'us', 'Estados Unidos', 'CONCACAF', 78, '#ffffff', '#ffffff', '#1d2b5c'),
  C('MAR', 'ma', 'Marrocos', 'CAF', 82, '#c1272d', '#c1272d', '#006233'),
  C('JPN', 'jp', 'Japão', 'AFC', 79, '#1d2b8f', '#1d2b8f', '#ffffff'),
]

const L = (
  id: string,
  name: string,
  shortName: string,
  country: string,
  confed: League['confed'],
  tier: 1 | 2,
  calendar: League['calendar'],
  coefficient: number,
  trophyId: string,
  extra: Partial<League> = {},
): League => ({
  id,
  name,
  shortName,
  country,
  confed,
  tier,
  calendar,
  coefficient,
  format: { rounds: 2, playoffTeams: 0 },
  promotion: 0,
  relegation: 0,
  continentalSlots: [0, 0],
  trophyId,
  ...extra,
})

export const MOCK_LEAGUES: League[] = [
  L('bra.1', 'Brasileirão Série A', 'Brasileirão', 'BRA', 'CONMEBOL', 1, 'calendar', 0.74, 'brasileirao', { relegation: 4, lowerLeagueId: 'bra.2', domesticCupId: 'bra.copa_do_brazil', continentalSlots: [6, 6] }),
  L('bra.2', 'Brasileirão Série B', 'Série B', 'BRA', 'CONMEBOL', 2, 'calendar', 0.5, 'serie-b-brasil', { promotion: 4, upperLeagueId: 'bra.1', domesticCupId: 'bra.copa_do_brazil' }),
  L('arg.1', 'Liga Profesional', 'Liga Argentina', 'ARG', 'CONMEBOL', 1, 'calendar', 0.66, 'liga-argentina'),
  L('eng.1', 'Premier League', 'Premier League', 'ENG', 'UEFA', 1, 'split', 1, 'premier-league', { relegation: 3, domesticCupId: 'eng.fa', continentalSlots: [5, 2] }),
  L('esp.1', 'LaLiga', 'LaLiga', 'ESP', 'UEFA', 1, 'split', 0.94, 'laliga', { relegation: 3, domesticCupId: 'esp.copa_del_rey', continentalSlots: [5, 2] }),
  L('ita.1', 'Serie A Italiana', 'Serie A', 'ITA', 'UEFA', 1, 'split', 0.9, 'serie-a', { relegation: 3, continentalSlots: [4, 2] }),
  L('ger.1', 'Bundesliga', 'Bundesliga', 'GER', 'UEFA', 1, 'split', 0.9, 'bundesliga', { relegation: 3, continentalSlots: [4, 2] }),
  L('fra.1', 'Ligue 1', 'Ligue 1', 'FRA', 'UEFA', 1, 'split', 0.82, 'ligue-1', { relegation: 3, continentalSlots: [4, 2] }),
  L('por.1', 'Liga Portugal', 'Liga Portugal', 'POR', 'UEFA', 1, 'split', 0.72, 'liga-portugal', { relegation: 3, continentalSlots: [2, 2] }),
]

const K = (id: string, name: string, shortName: string, abbr: string, country: string, leagueId: string, primary: Hex, secondary: Hex, strength: number, prestige: number, state?: string): Club => ({
  id,
  name,
  shortName,
  abbr,
  country,
  leagueId,
  colors: { primary, secondary },
  strength,
  prestige,
  state,
})

export const MOCK_CLUBS: Club[] = [
  // Brasileirão
  K('e2029', 'Palmeiras', 'Palmeiras', 'PAL', 'BRA', 'bra.1', '#0b7a43', '#ffffff', 80, 5, 'SP'),
  K('e819', 'Flamengo', 'Flamengo', 'FLA', 'BRA', 'bra.1', '#c4161c', '#111111', 81, 5, 'RJ'),
  K('e874', 'Corinthians', 'Corinthians', 'COR', 'BRA', 'bra.1', '#f2f2f2', '#111111', 75, 5, 'SP'),
  K('e2026', 'São Paulo', 'São Paulo', 'SAO', 'BRA', 'bra.1', '#e4032e', '#111111', 76, 5, 'SP'),
  K('e6086', 'Botafogo', 'Botafogo', 'BOT', 'BRA', 'bra.1', '#111111', '#ffffff', 77, 4, 'RJ'),
  K('e3445', 'Fluminense', 'Fluminense', 'FLU', 'BRA', 'bra.1', '#8a1538', '#00613c', 75, 4, 'RJ'),
  K('e7632', 'Atlético-MG', 'Atlético-MG', 'CAM', 'BRA', 'bra.1', '#111111', '#ffffff', 76, 4, 'MG'),
  K('e2022', 'Cruzeiro', 'Cruzeiro', 'CRU', 'BRA', 'bra.1', '#0a3fa0', '#ffffff', 76, 4, 'MG'),
  K('e1936', 'Internacional', 'Internacional', 'INT', 'BRA', 'bra.1', '#d7141a', '#ffffff', 75, 4, 'RS'),
  K('e6273', 'Grêmio', 'Grêmio', 'GRE', 'BRA', 'bra.1', '#0d80bf', '#111111', 74, 4, 'RS'),
  K('e3454', 'Vasco da Gama', 'Vasco', 'VAS', 'BRA', 'bra.1', '#111111', '#ffffff', 73, 4, 'RJ'),
  K('e2674', 'Santos', 'Santos', 'SAN', 'BRA', 'bra.1', '#ffffff', '#111111', 73, 5, 'SP'),
  K('e9967', 'Bahia', 'Bahia', 'BAH', 'BRA', 'bra.1', '#0a55a3', '#e30613', 74, 3, 'BA'),
  K('e6272', 'Fortaleza', 'Fortaleza', 'FOR', 'BRA', 'bra.1', '#0b4ea2', '#e30613', 72, 3, 'CE'),
  K('e3458', 'Athletico-PR', 'Athletico', 'CAP', 'BRA', 'bra.1', '#c8102e', '#111111', 72, 3, 'PR'),
  K('e6079', 'Red Bull Bragantino', 'Bragantino', 'RBB', 'BRA', 'bra.1', '#ffffff', '#d0021b', 73, 2, 'SP'),
  K('e3457', 'Vitória', 'Vitória', 'VIT', 'BRA', 'bra.1', '#d7141a', '#111111', 70, 2, 'BA'),
  K('e9969', 'Ceará', 'Ceará', 'CEA', 'BRA', 'bra.1', '#111111', '#ffffff', 70, 2, 'CE'),
  K('e15088', 'Mirassol', 'Mirassol', 'MIR', 'BRA', 'bra.1', '#ffd400', '#0a7a3b', 71, 1, 'SP'),
  K('e7631', 'Sport Recife', 'Sport', 'SPT', 'BRA', 'bra.1', '#d7141a', '#111111', 68, 2, 'PE'),
  // Série B
  K('e6270', 'Juventude', 'Juventude', 'JUV', 'BRA', 'bra.2', '#0f7a3a', '#ffffff', 66, 1, 'RS'),
  K('e9318', 'Chapecoense', 'Chapecoense', 'CHA', 'BRA', 'bra.2', '#0a8a3a', '#ffffff', 64, 2, 'SC'),
  K('e3456', 'Coritiba', 'Coritiba', 'CFC', 'BRA', 'bra.2', '#00613c', '#ffffff', 67, 2, 'PR'),
  K('e3395', 'Goiás', 'Goiás', 'GOI', 'BRA', 'bra.2', '#00613c', '#ffffff', 65, 2, 'GO'),
  K('e7633', 'América-MG', 'América-MG', 'AME', 'BRA', 'bra.2', '#0a7a3b', '#111111', 65, 1, 'MG'),
  K('e9971', 'Ponte Preta', 'Ponte Preta', 'PON', 'BRA', 'bra.2', '#111111', '#ffffff', 62, 1, 'SP'),
  K('e10297', 'Novorizontino', 'Novorizontino', 'NOV', 'BRA', 'bra.2', '#ffd400', '#111111', 64, 1, 'SP'),
  K('e3452', 'Avaí', 'Avaí', 'AVA', 'BRA', 'bra.2', '#0a55a3', '#ffffff', 62, 1, 'SC'),
  // Argentina
  K('e5', 'Boca Juniors', 'Boca', 'BOC', 'ARG', 'arg.1', '#0a3a8c', '#ffd100', 77, 5),
  K('e16', 'River Plate', 'River', 'RIV', 'ARG', 'arg.1', '#ffffff', '#e30613', 78, 5),
  K('e4', 'Racing Club', 'Racing', 'RAC', 'ARG', 'arg.1', '#6cace4', '#ffffff', 74, 4),
  // England
  K('e382', 'Manchester City', 'Man City', 'MCI', 'ENG', 'eng.1', '#6cabdd', '#1c2c5b', 88, 5),
  K('e364', 'Liverpool', 'Liverpool', 'LIV', 'ENG', 'eng.1', '#c8102e', '#00b2a9', 87, 5),
  K('e359', 'Arsenal', 'Arsenal', 'ARS', 'ENG', 'eng.1', '#ef0107', '#ffffff', 87, 5),
  K('e363', 'Chelsea', 'Chelsea', 'CHE', 'ENG', 'eng.1', '#034694', '#ffffff', 84, 5),
  K('e360', 'Manchester United', 'Man United', 'MUN', 'ENG', 'eng.1', '#da291c', '#111111', 82, 5),
  K('e367', 'Tottenham Hotspur', 'Tottenham', 'TOT', 'ENG', 'eng.1', '#ffffff', '#132257', 81, 4),
  K('e361', 'Newcastle United', 'Newcastle', 'NEW', 'ENG', 'eng.1', '#111111', '#ffffff', 82, 4),
  // Spain
  K('e86', 'Real Madrid', 'Real Madrid', 'RMA', 'ESP', 'esp.1', '#ece6d2', '#febe10', 89, 5),
  K('e83', 'Barcelona', 'Barcelona', 'BAR', 'ESP', 'esp.1', '#a50044', '#004d98', 87, 5),
  K('e1068', 'Atlético de Madrid', 'Atlético', 'ATM', 'ESP', 'esp.1', '#cb3524', '#27306b', 84, 4),
  K('e243', 'Sevilla', 'Sevilla', 'SEV', 'ESP', 'esp.1', '#ffffff', '#d7141a', 76, 4),
  // Italy
  K('e110', 'Inter de Milão', 'Inter', 'INT', 'ITA', 'ita.1', '#0068a8', '#111111', 85, 5),
  K('e103', 'Milan', 'Milan', 'MIL', 'ITA', 'ita.1', '#fb090b', '#111111', 82, 5),
  K('e111', 'Juventus', 'Juventus', 'JUV', 'ITA', 'ita.1', '#111111', '#ffffff', 83, 5),
  K('e114', 'Napoli', 'Napoli', 'NAP', 'ITA', 'ita.1', '#12a0d7', '#ffffff', 83, 4),
  // Germany
  K('e132', 'Bayern de Munique', 'Bayern', 'BAY', 'GER', 'ger.1', '#dc052d', '#0066b2', 88, 5),
  K('e124', 'Borussia Dortmund', 'Dortmund', 'BVB', 'GER', 'ger.1', '#fde100', '#111111', 82, 4),
  K('e131', 'Bayer Leverkusen', 'Leverkusen', 'B04', 'GER', 'ger.1', '#e32221', '#111111', 83, 3),
  // France / Portugal
  K('e160', 'Paris Saint-Germain', 'PSG', 'PSG', 'FRA', 'fra.1', '#004170', '#da291c', 87, 5),
  K('e176', 'Olympique de Marseille', 'Marseille', 'OM', 'FRA', 'fra.1', '#2faee0', '#ffffff', 78, 4),
  K('e1929', 'Benfica', 'Benfica', 'BEN', 'POR', 'por.1', '#e30613', '#ffffff', 80, 4),
  K('e437', 'Porto', 'Porto', 'POR', 'POR', 'por.1', '#003f8a', '#ffffff', 79, 4),
  K('e2250', 'Sporting CP', 'Sporting', 'SCP', 'POR', 'por.1', '#008057', '#ffffff', 80, 4),
]

const P = (id: string, name: string, kind: Competition['kind'], trophyId: string, size: number, extra: Partial<Competition> = {}): Competition => ({ id, name, kind, trophyId, size, ...extra })

export const MOCK_COMPETITIONS: Competition[] = [
  P('bra.1', 'Brasileirão Série A', 'league', 'brasileirao', 20, { country: 'BRA' }),
  P('bra.copa_do_brazil', 'Copa do Brasil', 'domestic_cup', 'copa-do-brasil', 32, { country: 'BRA' }),
  P('conmebol.libertadores', 'Copa Libertadores', 'continental_primary', 'libertadores', 32, { confed: 'CONMEBOL' }),
  P('conmebol.sudamericana', 'Copa Sul-Americana', 'continental_secondary', 'sul-americana', 32, { confed: 'CONMEBOL' }),
  P('uefa.champions', 'Liga dos Campeões', 'continental_primary', 'champions-league', 36, { confed: 'UEFA' }),
  P('uefa.europa', 'Liga Europa', 'continental_secondary', 'europa-league', 36, { confed: 'UEFA' }),
  P('fifa.cwc', 'Copa do Mundo de Clubes', 'club_world_cup', 'mundial-de-clubes', 32, { schedule: { firstYear: 2029, every: 4 } }),
  P('fifa.world', 'Copa do Mundo', 'world_cup', 'copa-do-mundo', 48, { schedule: { firstYear: 2030, every: 4 } }),
  P('conmebol.america', 'Copa América', 'national_continental', 'copa-america', 16, { confed: 'CONMEBOL', schedule: { firstYear: 2028, every: 4 } }),
  P('uefa.euro', 'Eurocopa', 'national_continental', 'eurocopa', 24, { confed: 'UEFA', schedule: { firstYear: 2028, every: 4 } }),
  P('ballon_dor', "Bola de Ouro", 'award', 'bola-de-ouro', 30),
]

const T = (id: string, name: string, family: Trophy['family'], metal: Trophy['metal'] = 'gold', accent?: Hex): Trophy => ({ id, name, family, metal, accent })

export const MOCK_TROPHIES: Trophy[] = [
  T('copa-do-mundo', 'Copa do Mundo', 'world_cup', 'gold', '#1f8a4c'),
  T('copa-america', 'Copa América', 'national_continental', 'silver', '#c8a24a'),
  T('eurocopa', 'Eurocopa', 'national_continental', 'silver', '#1d3f8f'),
  T('mundial-de-clubes', 'Copa do Mundo de Clubes', 'club_world_cup', 'gold', '#2a2a2a'),
  T('libertadores', 'Copa Libertadores', 'continental_primary', 'silver', '#c8a24a'),
  T('champions-league', 'Liga dos Campeões', 'continental_primary', 'silver', '#1d2b5c'),
  T('sul-americana', 'Copa Sul-Americana', 'continental_secondary', 'silver', '#1f5fb4'),
  T('europa-league', 'Liga Europa', 'continental_secondary', 'silver', '#f39200'),
  T('brasileirao', 'Brasileirão', 'league', 'gold', '#0b7a43'),
  T('serie-b-brasil', 'Série B', 'league', 'silver', '#1f5fb4'),
  T('liga-argentina', 'Liga Argentina', 'league', 'silver', '#6cace4'),
  T('premier-league', 'Premier League', 'league', 'silver', '#3d195b'),
  T('laliga', 'LaLiga', 'league', 'silver', '#ff4b44'),
  T('serie-a', 'Serie A', 'league', 'silver', '#1f5fb4'),
  T('bundesliga', 'Bundesliga', 'league', 'silver', '#d20515'),
  T('ligue-1', 'Ligue 1', 'league', 'silver', '#dae025'),
  T('liga-portugal', 'Liga Portugal', 'league', 'silver', '#0a2240'),
  T('copa-do-brasil', 'Copa do Brasil', 'domestic_cup', 'gold', '#0b3aa8'),
  T('bola-de-ouro', 'Bola de Ouro', 'award', 'gold'),
]

const S = (id: string, name: string, shortName: string, nationality: string, position: RealPlayer['position'], birthYear: number, clubId: string, ovr: number): RealPlayer => ({ id, name, shortName, nationality, position, birthYear, clubId, ovr })

export const MOCK_STARS: RealPlayer[] = [
  S('s1', 'Kylian Mbappé', 'K. Mbappé', 'FRA', 'CA', 1998, 'e86', 91),
  S('s2', 'Erling Haaland', 'E. Haaland', 'NOR', 'CA', 2000, 'e382', 91),
  S('s3', 'Lamine Yamal', 'L. Yamal', 'ESP', 'PD', 2007, 'e83', 90),
  S('s4', 'Vinícius Júnior', 'Vini Jr.', 'BRA', 'PE', 2000, 'e86', 89),
  S('s5', 'Jude Bellingham', 'J. Bellingham', 'ENG', 'MEI', 2003, 'e86', 89),
  S('s6', 'Mohamed Salah', 'M. Salah', 'EGY', 'PD', 1992, 'e364', 88),
  S('s7', 'Raphinha', 'Raphinha', 'BRA', 'PE', 1996, 'e83', 88),
  S('s8', 'Pedri', 'Pedri', 'ESP', 'MC', 2002, 'e83', 88),
  S('s9', 'Florian Wirtz', 'F. Wirtz', 'GER', 'MEI', 2003, 'e364', 88),
  S('s10', 'Jamal Musiala', 'J. Musiala', 'GER', 'MEI', 2003, 'e132', 87),
  S('s11', 'Harry Kane', 'H. Kane', 'ENG', 'CA', 1993, 'e132', 89),
  S('s12', 'Lautaro Martínez', 'L. Martínez', 'ARG', 'CA', 1997, 'e110', 87),
  S('s13', 'Cole Palmer', 'C. Palmer', 'ENG', 'MEI', 2002, 'e363', 86),
  S('s14', 'Estêvão', 'Estêvão', 'BRA', 'PD', 2007, 'e363', 84),
]

/** Deterministic pseudo-standings (Flamengo leads the Brasileirão, like the landing ticker). */
function standings(leagueId: string, played: number): StandingRow[] {
  const clubs = MOCK_CLUBS.filter((c) => c.leagueId === leagueId).sort((a, b) => b.strength - a.strength)
  return clubs.map((c, i) => {
    const won = Math.max(1, Math.round(played * (0.62 - i * 0.028)))
    const drawn = Math.max(1, Math.round(played * 0.24 - (i % 3)))
    const lost = Math.max(0, played - won - drawn)
    const gf = won * 2 + drawn
    const ga = lost * 2 + drawn
    return { clubId: c.id, played, won, drawn, lost, gf, ga, points: won * 3 + drawn }
  })
}

export const mockGameData: GameData = {
  generatedAt: '2026-09-27T12:00:00.000Z',
  countries: MOCK_COUNTRIES,
  leagues: MOCK_LEAGUES,
  clubs: MOCK_CLUBS,
  competitions: MOCK_COMPETITIONS,
  trophies: MOCK_TROPHIES,
  stars: MOCK_STARS,
  standings: Object.fromEntries(MOCK_LEAGUES.map((l) => [l.id, standings(l.id, l.calendar === 'split' ? 6 : 27)])),
  fixtures: {},
  history: {
    ballonDor: [
      { year: 2024, player: 'Rodri', nationality: 'ESP', club: 'Manchester City' },
      { year: 2025, player: 'Ousmane Dembélé', nationality: 'FRA', club: 'Paris Saint-Germain' },
    ],
    worldCup: [
      { year: 2022, champion: 'ARG', runnerUp: 'FRA', score: '3–3 (4–2 pên.)', host: 'Catar' },
      { year: 2026, champion: 'ESP', runnerUp: 'ARG', score: '2–1', host: 'EUA/México/Canadá' },
    ],
    champions: {},
  },
  cupsInProgress: {},
  extraClubIds: [],
  snapshot: Object.fromEntries(MOCK_LEAGUES.map((l) => [l.id, { season: 2026, phase: l.calendar === 'split' ? '2026/27' : 'Rodada 28', gamesPerTeam: 38, fixturesComplete: false }])),
}
