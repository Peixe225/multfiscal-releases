/**
 * Catálogo de ligas (escrito à mão). `id` = slug da ESPN.
 *
 * - `coefficient` (0.30–1.00): força relativa da liga — pesa em gols, valor de mercado e prêmios.
 * - `promotion`/`relegation`: vagas REAIS de 2026/27 entre ligas simuladas (diretas + play-off).
 *   Divisões de baixo que não simulamos (Série C, National League, Serie C…) não geram troca:
 *   nesses casos o rebaixamento fica 0 para manter o tamanho da liga.
 * - `continentalSlots`: vagas pela classificação final para as PRÓXIMAS edições
 *   (Libertadores/Sul-Americana 2027, Champions/Liga Europa 2027/28…). O campeão da copa nacional
 *   costuma herdar uma vaga — o motor decide.
 * - `logo` e `espnSlug` são preenchidos pelo pipeline (scripts/build-data.mjs).
 */
import type { League } from '../../engine/types'

type LeagueMeta = Omit<League, 'logo' | 'espnSlug'>

const RR = (rounds: 1 | 2 | 3 | 4, playoffTeams = 0) => ({ rounds, playoffTeams })

export const LEAGUES: LeagueMeta[] = [
  // ─────────────── Brasil ───────────────
  { id: 'bra.1', name: 'Brasileirão Série A', shortName: 'Brasileirão', country: 'BRA', confed: 'CONMEBOL', tier: 1, calendar: 'calendar', coefficient: 0.74, format: RR(2), promotion: 0, relegation: 4, lowerLeagueId: 'bra.2', domesticCupId: 'bra.copa_do_brazil', continentalSlots: [6, 6], trophyId: 'brasileirao' },
  { id: 'bra.2', name: 'Brasileirão Série B', shortName: 'Série B', country: 'BRA', confed: 'CONMEBOL', tier: 2, calendar: 'calendar', coefficient: 0.5, format: RR(2), promotion: 4, relegation: 0, upperLeagueId: 'bra.1', domesticCupId: 'bra.copa_do_brazil', continentalSlots: [0, 0], trophyId: 'serie-b-brasil' },

  // ─────────────── Inglaterra ───────────────
  { id: 'eng.1', name: 'Premier League', shortName: 'Premier League', country: 'ENG', confed: 'UEFA', tier: 1, calendar: 'split', coefficient: 1, format: RR(2), promotion: 0, relegation: 3, lowerLeagueId: 'eng.2', domesticCupId: 'eng.fa', secondaryCupId: 'eng.league_cup', continentalSlots: [5, 2], continentalTertiarySlots: 1, trophyId: 'premier-league' },
  { id: 'eng.2', name: 'EFL Championship', shortName: 'Championship', country: 'ENG', confed: 'UEFA', tier: 2, calendar: 'split', coefficient: 0.6, format: RR(2), promotion: 3, promotionPlayoff: { positions: [3, 6], spots: 1 }, relegation: 3, upperLeagueId: 'eng.1', lowerLeagueId: 'eng.3', domesticCupId: 'eng.fa', secondaryCupId: 'eng.league_cup', continentalSlots: [0, 0], trophyId: 'championship' },
  { id: 'eng.3', name: 'EFL League One', shortName: 'League One', country: 'ENG', confed: 'UEFA', tier: 3, level: 3, calendar: 'split', coefficient: 0.45, format: RR(2), promotion: 3, promotionPlayoff: { positions: [3, 6], spots: 1 }, relegation: 4, upperLeagueId: 'eng.2', lowerLeagueId: 'eng.4', domesticCupId: 'eng.fa', secondaryCupId: 'eng.league_cup', continentalSlots: [0, 0], trophyId: 'league-one' },
  { id: 'eng.4', name: 'EFL League Two', shortName: 'League Two', country: 'ENG', confed: 'UEFA', tier: 3, level: 4, calendar: 'split', coefficient: 0.38, format: RR(2), promotion: 4, promotionPlayoff: { positions: [4, 7], spots: 1 }, relegation: 0, upperLeagueId: 'eng.3', domesticCupId: 'eng.fa', secondaryCupId: 'eng.league_cup', continentalSlots: [0, 0], trophyId: 'league-two' },

  // ─────────────── Espanha ───────────────
  { id: 'esp.1', name: 'LaLiga', shortName: 'LaLiga', country: 'ESP', confed: 'UEFA', tier: 1, calendar: 'split', coefficient: 0.94, format: RR(2), promotion: 0, relegation: 3, lowerLeagueId: 'esp.2', domesticCupId: 'esp.copa_del_rey', continentalSlots: [5, 2], continentalTertiarySlots: 1, trophyId: 'laliga' },
  { id: 'esp.2', name: 'LaLiga Hypermotion', shortName: 'LaLiga 2', country: 'ESP', confed: 'UEFA', tier: 2, calendar: 'split', coefficient: 0.52, format: RR(2), promotion: 3, promotionPlayoff: { positions: [3, 6], spots: 1 }, relegation: 0, upperLeagueId: 'esp.1', domesticCupId: 'esp.copa_del_rey', continentalSlots: [0, 0], trophyId: 'laliga-2' },

  // ─────────────── Itália ───────────────
  { id: 'ita.1', name: 'Serie A Italiana', shortName: 'Serie A', country: 'ITA', confed: 'UEFA', tier: 1, calendar: 'split', coefficient: 0.9, format: RR(2), promotion: 0, relegation: 3, lowerLeagueId: 'ita.2', domesticCupId: 'ita.coppa_italia', continentalSlots: [4, 2], continentalTertiarySlots: 1, trophyId: 'serie-a' },
  { id: 'ita.2', name: 'Serie B Italiana', shortName: 'Serie B', country: 'ITA', confed: 'UEFA', tier: 2, calendar: 'split', coefficient: 0.5, format: RR(2), promotion: 3, promotionPlayoff: { positions: [3, 8], spots: 1 }, relegation: 0, upperLeagueId: 'ita.1', domesticCupId: 'ita.coppa_italia', continentalSlots: [0, 0], trophyId: 'serie-b-italia' },

  // ─────────────── Alemanha ───────────────
  { id: 'ger.1', name: 'Bundesliga', shortName: 'Bundesliga', country: 'GER', confed: 'UEFA', tier: 1, calendar: 'split', coefficient: 0.9, format: RR(2), promotion: 0, relegation: 3, lowerLeagueId: 'ger.2', domesticCupId: 'ger.dfb_pokal', continentalSlots: [4, 2], continentalTertiarySlots: 1, trophyId: 'bundesliga' },
  { id: 'ger.2', name: '2. Bundesliga', shortName: '2. Bundesliga', country: 'GER', confed: 'UEFA', tier: 2, calendar: 'split', coefficient: 0.55, format: RR(2), promotion: 3, promotionPlayoff: { positions: [3, 3], spots: 1, upperPosition: 16 }, relegation: 0, upperLeagueId: 'ger.1', domesticCupId: 'ger.dfb_pokal', continentalSlots: [0, 0], trophyId: '2-bundesliga' },

  // ─────────────── França ───────────────
  { id: 'fra.1', name: 'Ligue 1', shortName: 'Ligue 1', country: 'FRA', confed: 'UEFA', tier: 1, calendar: 'split', coefficient: 0.85, format: RR(2), promotion: 0, relegation: 3, lowerLeagueId: 'fra.2', domesticCupId: 'fra.coupe_de_france', continentalSlots: [3, 2], continentalTertiarySlots: 1, trophyId: 'ligue-1' },
  { id: 'fra.2', name: 'Ligue 2', shortName: 'Ligue 2', country: 'FRA', confed: 'UEFA', tier: 2, calendar: 'split', coefficient: 0.47, format: RR(2), promotion: 3, promotionPlayoff: { positions: [3, 5], spots: 1, upperPosition: 16 }, relegation: 0, upperLeagueId: 'fra.1', domesticCupId: 'fra.coupe_de_france', continentalSlots: [0, 0], trophyId: 'ligue-2' },

  // ─────────────── Portugal / Holanda / Bélgica / Escócia ───────────────
  { id: 'por.1', name: 'Liga Portugal', shortName: 'Liga Portugal', country: 'POR', confed: 'UEFA', tier: 1, calendar: 'split', coefficient: 0.72, format: RR(2), promotion: 0, relegation: 0, domesticCupId: 'por.taca.portugal', continentalSlots: [2, 2], continentalTertiarySlots: 1, trophyId: 'primeira-liga' },
  { id: 'ned.1', name: 'Eredivisie', shortName: 'Eredivisie', country: 'NED', confed: 'UEFA', tier: 1, calendar: 'split', coefficient: 0.7, format: RR(2), promotion: 0, relegation: 3, lowerLeagueId: 'ned.2', domesticCupId: 'ned.cup', continentalSlots: [2, 2], continentalTertiarySlots: 1, trophyId: 'eredivisie' },
  { id: 'ned.2', name: 'Eerste Divisie', shortName: 'Eerste Divisie', country: 'NED', confed: 'UEFA', tier: 2, calendar: 'split', coefficient: 0.4, format: RR(2), promotion: 3, promotionPlayoff: { positions: [3, 8], spots: 1, upperPosition: 16 }, relegation: 0, upperLeagueId: 'ned.1', domesticCupId: 'ned.cup', continentalSlots: [0, 0], trophyId: 'eerste-divisie' },
  { id: 'bel.1', name: 'Pro League Belga', shortName: 'Pro League', country: 'BEL', confed: 'UEFA', tier: 1, calendar: 'split', coefficient: 0.62, format: RR(2), promotion: 0, relegation: 0, domesticCupId: 'bel.cup', continentalSlots: [2, 1], continentalTertiarySlots: 1, trophyId: 'pro-league-belgium' },
  { id: 'sco.1', name: 'Premiership Escocesa', shortName: 'Premiership', country: 'SCO', confed: 'UEFA', tier: 1, calendar: 'split', coefficient: 0.54, format: RR(3), promotion: 0, relegation: 2, lowerLeagueId: 'sco.2', domesticCupId: 'sco.tennents', continentalSlots: [2, 1], continentalTertiarySlots: 1, trophyId: 'scottish-premiership' },
  { id: 'sco.2', name: 'Championship Escocesa', shortName: 'Champ. Escocesa', country: 'SCO', confed: 'UEFA', tier: 2, calendar: 'split', coefficient: 0.33, format: RR(4), promotion: 2, promotionPlayoff: { positions: [2, 4], spots: 1, upperPosition: 11 }, relegation: 0, upperLeagueId: 'sco.1', domesticCupId: 'sco.tennents', continentalSlots: [0, 0], trophyId: 'scottish-championship' },

  // ─────────────── Resto da Europa ───────────────
  { id: 'tur.1', name: 'Süper Lig Turca', shortName: 'Süper Lig', country: 'TUR', confed: 'UEFA', tier: 1, calendar: 'split', coefficient: 0.62, format: RR(2), promotion: 0, relegation: 0, domesticCupId: 'tur.cup', continentalSlots: [2, 1], continentalTertiarySlots: 1, trophyId: 'super-lig' },
  { id: 'rus.1', name: 'Premier League Russa', shortName: 'Liga Russa', country: 'RUS', confed: 'UEFA', tier: 1, calendar: 'split', coefficient: 0.55, format: RR(2), promotion: 0, relegation: 0, domesticCupId: 'rus.cup', continentalSlots: [0, 0], trophyId: 'russian-premier-league' },
  { id: 'gre.1', name: 'Super League Grega', shortName: 'Liga Grega', country: 'GRE', confed: 'UEFA', tier: 1, calendar: 'split', coefficient: 0.52, format: RR(2), promotion: 0, relegation: 0, domesticCupId: 'gre.cup', continentalSlots: [1, 1], continentalTertiarySlots: 1, trophyId: 'greek-super-league' },
  { id: 'aut.1', name: 'Bundesliga Austríaca', shortName: 'Liga Austríaca', country: 'AUT', confed: 'UEFA', tier: 1, calendar: 'split', coefficient: 0.52, format: RR(3), promotion: 0, relegation: 0, domesticCupId: 'aut.cup', continentalSlots: [1, 1], continentalTertiarySlots: 1, trophyId: 'austrian-bundesliga' },
  { id: 'den.1', name: 'Superliga Dinamarquesa', shortName: 'Superliga', country: 'DEN', confed: 'UEFA', tier: 1, calendar: 'split', coefficient: 0.5, format: RR(3), promotion: 0, relegation: 0, domesticCupId: 'den.cup', continentalSlots: [1, 1], continentalTertiarySlots: 1, trophyId: 'danish-superliga' },
  { id: 'sui.1', name: 'Super League Suíça', shortName: 'Liga Suíça', country: 'SUI', confed: 'UEFA', tier: 1, calendar: 'split', coefficient: 0.52, format: RR(3), promotion: 0, relegation: 0, domesticCupId: 'sui.cup', continentalSlots: [1, 1], continentalTertiarySlots: 1, trophyId: 'swiss-super-league', stale: true },
  { id: 'nor.1', name: 'Eliteserien', shortName: 'Eliteserien', country: 'NOR', confed: 'UEFA', tier: 1, calendar: 'calendar', coefficient: 0.48, format: RR(2), promotion: 0, relegation: 0, domesticCupId: 'nor.cup', continentalSlots: [1, 1], continentalTertiarySlots: 1, trophyId: 'eliteserien' },
  { id: 'swe.1', name: 'Allsvenskan', shortName: 'Allsvenskan', country: 'SWE', confed: 'UEFA', tier: 1, calendar: 'calendar', coefficient: 0.46, format: RR(2), promotion: 0, relegation: 0, domesticCupId: 'swe.cup', continentalSlots: [1, 1], continentalTertiarySlots: 1, trophyId: 'allsvenskan' },
  { id: 'rou.1', name: 'Liga I Romena', shortName: 'Liga Romena', country: 'ROU', confed: 'UEFA', tier: 1, calendar: 'split', coefficient: 0.44, format: RR(2), promotion: 0, relegation: 0, domesticCupId: 'rou.cup', continentalSlots: [1, 1], continentalTertiarySlots: 1, trophyId: 'liga-1-romania', stale: true },

  // ─────────────── Argentina ───────────────
  { id: 'arg.1', name: 'Liga Profesional Argentina', shortName: 'Liga Argentina', country: 'ARG', confed: 'CONMEBOL', tier: 1, calendar: 'calendar', coefficient: 0.64, format: RR(1, 16), tournamentsPerSeason: 2, promotion: 0, relegation: 2, lowerLeagueId: 'arg.2', domesticCupId: 'arg.copa', continentalSlots: [6, 6], trophyId: 'liga-profesional' },
  { id: 'arg.2', name: 'Primera Nacional', shortName: 'Primera Nacional', country: 'ARG', confed: 'CONMEBOL', tier: 2, calendar: 'calendar', coefficient: 0.42, format: RR(2, 2), promotion: 2, promotionPlayoff: { positions: [2, 9], spots: 1 }, relegation: 2, upperLeagueId: 'arg.1', lowerLeagueId: 'arg.3', domesticCupId: 'arg.copa', continentalSlots: [0, 0], trophyId: 'primera-nacional' },
  { id: 'arg.3', name: 'Primera B Metropolitana', shortName: 'Primera B', country: 'ARG', confed: 'CONMEBOL', tier: 3, calendar: 'calendar', coefficient: 0.3, format: RR(2), promotion: 2, promotionPlayoff: { positions: [2, 9], spots: 1 }, relegation: 0, upperLeagueId: 'arg.2', domesticCupId: 'arg.copa', continentalSlots: [0, 0], trophyId: 'primera-b-metro' },

  // ─────────────── Resto da CONMEBOL ───────────────
  { id: 'col.1', name: 'Liga BetPlay', shortName: 'Liga Colombiana', country: 'COL', confed: 'CONMEBOL', tier: 1, calendar: 'calendar', coefficient: 0.52, format: RR(1, 8), tournamentsPerSeason: 2, promotion: 0, relegation: 0, domesticCupId: 'col.copa', continentalSlots: [4, 4], trophyId: 'liga-colombia' },
  { id: 'uru.1', name: 'Liga AUF Uruguaia', shortName: 'Liga Uruguaia', country: 'URU', confed: 'CONMEBOL', tier: 1, calendar: 'calendar', coefficient: 0.48, format: RR(1), tournamentsPerSeason: 2, promotion: 0, relegation: 0, domesticCupId: 'uru.copa', continentalSlots: [4, 4], trophyId: 'liga-uruguay' },
  { id: 'chi.1', name: 'Liga de Primera Chilena', shortName: 'Liga Chilena', country: 'CHI', confed: 'CONMEBOL', tier: 1, calendar: 'calendar', coefficient: 0.47, format: RR(2), promotion: 0, relegation: 0, domesticCupId: 'chi.copa_chi', continentalSlots: [4, 4], trophyId: 'liga-chile' },
  { id: 'par.1', name: 'Primera División Paraguaia', shortName: 'Liga Paraguaia', country: 'PAR', confed: 'CONMEBOL', tier: 1, calendar: 'calendar', coefficient: 0.45, format: RR(2), tournamentsPerSeason: 2, promotion: 0, relegation: 0, domesticCupId: 'par.copa', continentalSlots: [4, 4], trophyId: 'liga-paraguay' },
  { id: 'per.1', name: 'Liga 1 Peruana', shortName: 'Liga Peruana', country: 'PER', confed: 'CONMEBOL', tier: 1, calendar: 'calendar', coefficient: 0.4, format: RR(1), tournamentsPerSeason: 2, promotion: 0, relegation: 0, continentalSlots: [4, 4], trophyId: 'liga-peru' },
  { id: 'ecu.1', name: 'LigaPro Equatoriana', shortName: 'LigaPro', country: 'ECU', confed: 'CONMEBOL', tier: 1, calendar: 'calendar', coefficient: 0.5, format: RR(2, 6), promotion: 0, relegation: 0, continentalSlots: [4, 4], trophyId: 'ligapro-ecuador' },
  { id: 'bol.1', name: 'División Profesional Boliviana', shortName: 'Liga Boliviana', country: 'BOL', confed: 'CONMEBOL', tier: 1, calendar: 'calendar', coefficient: 0.35, format: RR(2), promotion: 0, relegation: 0, domesticCupId: 'bol.copa', continentalSlots: [4, 4], trophyId: 'liga-bolivia' },
  { id: 'ven.1', name: 'Liga FUTVE', shortName: 'Liga Venezuelana', country: 'VEN', confed: 'CONMEBOL', tier: 1, calendar: 'calendar', coefficient: 0.35, format: RR(1, 4), tournamentsPerSeason: 2, promotion: 0, relegation: 0, continentalSlots: [4, 4], trophyId: 'liga-venezuela' },

  // ─────────────── CONCACAF ───────────────
  { id: 'mex.1', name: 'Liga MX', shortName: 'Liga MX', country: 'MEX', confed: 'CONCACAF', tier: 1, calendar: 'split', coefficient: 0.6, format: RR(1, 10), tournamentsPerSeason: 2, promotion: 0, relegation: 0, continentalSlots: [6, 0], trophyId: 'liga-mx' },
  { id: 'mex.2', name: 'Liga de Expansión MX', shortName: 'Expansión MX', country: 'MEX', confed: 'CONCACAF', tier: 2, calendar: 'split', coefficient: 0.36, format: RR(1, 10), tournamentsPerSeason: 2, promotion: 0, relegation: 0, continentalSlots: [0, 0], trophyId: 'liga-expansion' },
  { id: 'usa.1', name: 'Major League Soccer', shortName: 'MLS', country: 'USA', confed: 'CONCACAF', tier: 1, calendar: 'calendar', coefficient: 0.58, format: RR(2, 18), promotion: 0, relegation: 0, domesticCupId: 'usa.open', continentalSlots: [5, 0], trophyId: 'mls-cup' },
  { id: 'crc.1', name: 'Primera División da Costa Rica', shortName: 'Liga Costa-riquenha', country: 'CRC', confed: 'CONCACAF', tier: 1, calendar: 'split', coefficient: 0.38, format: RR(2, 4), tournamentsPerSeason: 2, promotion: 0, relegation: 0, continentalSlots: [2, 0], trophyId: 'liga-costa-rica' },
  { id: 'hon.1', name: 'Liga Nacional de Honduras', shortName: 'Liga Hondurenha', country: 'HON', confed: 'CONCACAF', tier: 1, calendar: 'split', coefficient: 0.33, format: RR(2, 6), tournamentsPerSeason: 2, promotion: 0, relegation: 0, continentalSlots: [2, 0], trophyId: 'liga-honduras' },
  { id: 'gua.1', name: 'Liga Nacional da Guatemala', shortName: 'Liga Guatemalteca', country: 'GUA', confed: 'CONCACAF', tier: 1, calendar: 'split', coefficient: 0.32, format: RR(2, 8), tournamentsPerSeason: 2, promotion: 0, relegation: 0, continentalSlots: [1, 0], trophyId: 'liga-guatemala' },
  { id: 'slv.1', name: 'Primera División de El Salvador', shortName: 'Liga Salvadorenha', country: 'SLV', confed: 'CONCACAF', tier: 1, calendar: 'split', coefficient: 0.3, format: RR(2, 8), tournamentsPerSeason: 2, promotion: 0, relegation: 0, continentalSlots: [1, 0], trophyId: 'liga-el-salvador' },

  // ─────────────── AFC / CAF ───────────────
  { id: 'ksa.1', name: 'Saudi Pro League', shortName: 'Liga Saudita', country: 'KSA', confed: 'AFC', tier: 1, calendar: 'split', coefficient: 0.58, format: RR(2), promotion: 0, relegation: 0, domesticCupId: 'ksa.kings.cup', continentalSlots: [3, 1], trophyId: 'saudi-pro-league' },
  { id: 'jpn.1', name: 'J1 League', shortName: 'J1 League', country: 'JPN', confed: 'AFC', tier: 1, calendar: 'split', coefficient: 0.52, format: RR(2), promotion: 0, relegation: 0, domesticCupId: 'jpn.emperors_cup', continentalSlots: [3, 1], trophyId: 'j1-league' },
  { id: 'chn.1', name: 'Superliga Chinesa', shortName: 'Liga Chinesa', country: 'CHN', confed: 'AFC', tier: 1, calendar: 'calendar', coefficient: 0.44, format: RR(2), promotion: 0, relegation: 0, domesticCupId: 'chn.fa_cup', continentalSlots: [2, 1], trophyId: 'chinese-super-league' },
  { id: 'aus.1', name: 'A-League', shortName: 'A-League', country: 'AUS', confed: 'AFC', tier: 1, calendar: 'split', coefficient: 0.42, format: RR(2, 6), promotion: 0, relegation: 0, domesticCupId: 'aus.cup', continentalSlots: [1, 1], trophyId: 'a-league' },
  { id: 'rsa.1', name: 'Premiership Sul-Africana', shortName: 'Liga Sul-Africana', country: 'RSA', confed: 'CAF', tier: 1, calendar: 'split', coefficient: 0.4, format: RR(2), promotion: 0, relegation: 0, domesticCupId: 'rsa.cup', continentalSlots: [2, 2], trophyId: 'south-african-premiership' },
]

/** Ligas cujo snapshot da ESPN está desatualizado (tabela zerada, só a lista de clubes). */
export const STALE_LEAGUES = LEAGUES.filter((l) => l.stale).map((l) => l.id)
