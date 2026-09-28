/**
 * LENDA — contrato central de tipos.
 *
 * Três camadas:
 *   1. Dados estáticos (gerados por scripts/build-data.mjs a partir da ESPN + catálogos próprios).
 *   2. Mundo simulado (WorldState): ligas, copas, continentais, seleções e prêmios evoluindo ano a ano.
 *   3. Carreira do jogador (CareerState): modo Clássico (decisões por período) e, depois, modo Imersivo.
 *
 * Convenção de calendário: `season` é o ANO DE INÍCIO da temporada. A temporada 2026 é
 * "2026" nas ligas de ano civil (Brasil, Argentina, MLS…) e "2026/27" nas ligas europeias.
 * Torneios de seleções e o Mundial de Clubes disputados no meio do ano T encerram a temporada T-1.
 * A Bola de Ouro do ano T premia a temporada T-1.
 */

// ───────────────────────────── básicos ─────────────────────────────

export type Confed = 'CONMEBOL' | 'UEFA' | 'CONCACAF' | 'CAF' | 'AFC' | 'OFC'

/** Códigos de posição exibidos (PT-BR), iguais aos do Copero. */
export type Position = 'GOL' | 'ZAG' | 'LD' | 'LE' | 'VOL' | 'MC' | 'ME' | 'MD' | 'MEI' | 'PE' | 'PD' | 'CA'

/** Grupo usado nas fórmulas (taxas de gol/assistência, prêmios). */
export type PositionGroup = 'goalkeeper' | 'defensive' | 'support' | 'attacking'

export type Foot = 'left' | 'right'

export type GameMode = 'classic' | 'immersive'

/** Ritmo do modo Clássico: temporadas simuladas por decisão = 1 | 2 | 3. */
export type Pace = 'intensa' | 'normal' | 'expressa'

/** Papel no elenco na temporada (define jogos disputados). */
export type SquadRole = 'starter' | 'high_rotation' | 'low_rotation' | 'substitute' | 'third_keeper'

export type Hex = `#${string}`

// ───────────────────────────── dados estáticos ─────────────────────────────

export interface Country {
  /** Código FIFA de 3 letras (BRA, ARG, ENG…) — chave primária. */
  code: string
  /** ISO 3166-1 alpha-2 minúsculo para bandeira flag-icons (br, ar, gb-eng…). */
  iso2: string
  name: string // pt-BR
  confed: Confed
  /** Força atual da seleção (40–95), usada para simular jogos de seleções. */
  strength: number
  /** OVR mínimo para ser convocado. */
  callUpOvr: number
  colors: { primary: Hex; kit1: Hex; kit2: Hex; kit3?: Hex }
  /** Padrão do uniforme na tela de identidade. */
  kitPattern?: 'stripes' | 'checker' | 'sash' | 'hoops'
}

export type LeagueCalendar = 'calendar' | 'split' // ano civil | ago–mai

export interface League {
  id: string // slug estável, ex.: "bra.1"
  name: string // "Brasileirão Série A"
  shortName: string // "Brasileirão"
  country: string // código FIFA
  confed: Confed
  tier: 1 | 2 | 3
  espnSlug?: string
  logo?: string // caminho em public/, ex.: "leagues/bra.1.webp"
  calendar: LeagueCalendar
  /** Fator de força da liga (0.30–1.00) — pesa em gols, valor de mercado e prêmios. */
  coefficient: number
  /** Formato simplificado para a simulação. */
  format: {
    rounds: 1 | 2 | 3 | 4 // turnos (2 = ida e volta)
    /** Mata-mata no fim (MLS, Liga MX, Argentina…): quantos avançam. 0 = pontos corridos. */
    playoffTeams: number
  }
  /** Vagas de acesso para a divisão de cima (quando existir). */
  promotion: number
  /** Vagas de rebaixamento para a divisão de baixo (quando existir). */
  relegation: number
  upperLeagueId?: string
  lowerLeagueId?: string
  domesticCupId?: string
  /** Vagas continentais a partir da classificação final: [principal, secundária]. */
  continentalSlots: [number, number]
  trophyId: string
  // ── campos opcionais acrescentados pelo pipeline de dados (aditivos) ──
  /** Nível real na pirâmide quando `tier` (limitado a 3) não basta — ex.: League Two = 4. */
  level?: number
  /** Ligas de Apertura/Clausura: 2 campeões por temporada (México, Argentina, Colômbia…). */
  tournamentsPerSeason?: 1 | 2
  /**
   * Play-off de acesso definido na liga DE BAIXO. `promotion` da liga de baixo e `relegation`
   * da de cima já incluem `spots`. Ex.: Championship 3º–6º → 1 vaga; 2. Bundesliga 3º enfrenta
   * o 16º da Bundesliga (`upperPosition`) → quem vencer fica/sobe.
   */
  promotionPlayoff?: { positions: [number, number]; spots: number; upperPosition?: number }
  /** Vagas para a continental terciária (Liga Conferência), depois das [principal, secundária]. */
  continentalTertiarySlots?: number
  /** Segunda copa nacional (Copa da Liga Inglesa). */
  secondaryCupId?: string
  /** Snapshot da ESPN desatualizado (Suíça/Romênia): a tabela real foi zerada. */
  stale?: boolean
}

export interface CrestRef {
  /** Arquivo atlas em public/crests/, ex.: "bra.1.webp". */
  atlas: string
  /** Índice da célula no atlas (grade de ATLAS_COLS colunas, CREST_SIZE px). */
  index: number
}

export interface Club {
  id: string // "e2029" (ESPN) ou slug
  espnId?: string
  name: string // "Palmeiras"
  shortName: string // cabe em tabela
  abbr: string // "PAL"
  country: string // código FIFA
  /** Liga no início (temporada 2026). O mundo pode movê-lo por acesso/rebaixamento. */
  leagueId: string
  colors: { primary: Hex; secondary: Hex }
  crest?: CrestRef
  /** Força inicial do time (40–92, mesma escala do OVR de jogador). */
  strength: number
  /** Prestígio histórico 0–5 (tamanho do clube, torcida, atração de jogadores). */
  prestige: number
  /** Restrições de elenco reais (Athletic só bascos/ESP, Chivas só MEX). */
  onlyNationality?: string
  /** UF do clube brasileiro (SP, RJ, MG…) — define o estadual que disputa. */
  state?: string
}

export type CompetitionKind =
  | 'league'
  | 'domestic_cup'
  | 'continental_primary' // Libertadores, Champions…
  | 'continental_secondary' // Sul-Americana, Europa League…
  | 'continental_tertiary' // Conference League
  | 'club_world_cup'
  | 'world_cup'
  | 'national_continental' // Copa América, Euro…
  | 'award'

export interface Competition {
  id: string // "conmebol.libertadores", "bra.copa", "fifa.world"…
  name: string
  kind: CompetitionKind
  confed?: Confed
  country?: string
  /** Número de participantes na simulação. */
  size: number
  /** Anos (de disputa) para torneios não anuais: primeira edição simulada + intervalo. */
  schedule?: { firstYear: number; every: number }
  trophyId: string
  logo?: string
  /** Supercopa (Recopa, Supercopa da UEFA): jogo único entre campeões, não é a "principal". */
  superCup?: boolean
  /** Estadual brasileiro: UF dos clubes participantes (Club.state). */
  region?: string
}

/** Competições de cada confederação (atalho para o motor não "adivinhar" pelo kind). */
export interface ConfedCompetitions {
  primary?: string
  secondary?: string
  tertiary?: string
  superCup?: string
  national: string
}

/** Metadados do snapshot real de cada liga (gerado pelo pipeline). */
export interface LeagueSnapshot {
  season: number
  /** Fase atual em pt-BR ("Clausura 2026", "2026/27"…). */
  phase: string
  /** Jogos por clube na fase atual (tabela + restantes). */
  gamesPerTeam: number
  /** true se `fixtures` cobre todos os jogos que faltam; false = o motor completa o calendário. */
  fixturesComplete: boolean
  /** Tabela zerada porque a ESPN não tem a temporada atual. */
  stale?: boolean
}

/** Família visual do troféu — decide a arte SVG e a ordem na vitrine. */
export type TrophyFamily =
  | 'world_cup'
  | 'national_continental'
  | 'club_world_cup'
  | 'continental_primary'
  | 'continental_secondary'
  | 'continental_tertiary'
  | 'league'
  | 'domestic_cup'
  | 'award'

export interface Trophy {
  id: string // "libertadores", "brasileirao", "ballon-dor"…
  name: string // pt-BR
  family: TrophyFamily
  /** Chave do componente de arte (src/ui/trophies). Se ausente, usa arte genérica por família. */
  art?: string
  /** Metal predominante para arte genérica. */
  metal?: 'gold' | 'silver' | 'bronze' | 'crystal'
  /** Cor de acento (fita, base) para arte genérica. */
  accent?: Hex
}

/** Jogador real (estrela) usado como rival em prêmios e, no modo Imersivo, em elencos. */
export interface RealPlayer {
  id: string
  name: string
  shortName: string
  nationality: string // FIFA
  position: Position
  birthYear: number
  clubId?: string
  ovr: number
  /** Potencial máximo estimado (para jovens). */
  potential?: number
  espnId?: string
}

/** Pacote de dados estáticos carregado pelo jogo. */
export interface GameData {
  generatedAt: string // ISO — data do snapshot das tabelas reais
  countries: Country[]
  leagues: League[]
  clubs: Club[]
  competitions: Competition[]
  trophies: Trophy[]
  stars: RealPlayer[]
  /** Classificação REAL de hoje por liga (snapshot) — ponto de partida da temporada 2026. */
  standings: Record<string, StandingRow[]>
  /** Jogos reais restantes da temporada atual por liga (quando disponíveis). */
  fixtures: Record<string, Fixture[]>
  /** Histórico real recente para "Mundo" e Bola de Ouro. */
  history: RealHistory
  /** Competições em andamento hoje (Libertadores nas semis, Champions na fase de liga…). */
  cupsInProgress: Record<string, import('./api').CupInProgress>
  /**
   * Clubes que não jogam liga simulada (países sem dados) mas disputam continentais
   * (ex.: Shakhtar, Slavia Praga, Qarabağ). Mesmo formato de Club com leagueId = "none".
   */
  extraClubIds: string[]
  /** Competições por confederação (principal, secundária, supercopa, seleções). */
  confederations?: Partial<Record<Confed, ConfedCompetitions>>
  /** Metadados do snapshot por liga (fase, calendário completo ou não, desatualizado). */
  snapshot?: Record<string, LeagueSnapshot>
}

export interface RealHistory {
  ballonDor: { year: number; player: string; nationality: string; club: string }[]
  worldCup: { year: number; champion: string; runnerUp: string; score?: string; host?: string }[]
  /** Campeões reais recentes: competitionId → [{season, clubId|countryCode}] */
  champions: Record<string, { season: number; winner: string }[]>
  /** Indicados reais à próxima Bola de Ouro (a de 2026 ainda não foi entregue: o jogo simula). */
  ballonDorShortlist?: { year: number; ceremony?: string; players: string[] }
}

// ───────────────────────────── partidas e tabelas ─────────────────────────────

export interface StandingRow {
  clubId: string
  played: number
  won: number
  drawn: number
  lost: number
  gf: number
  ga: number
  points: number
  /** Grupo/zona quando a liga tem grupos (Argentina, MLS). */
  group?: string
}

export interface Fixture {
  round?: number
  date?: string // ISO
  home: string // clubId
  away: string
  /** Placar se já disputado. */
  score?: [number, number]
}

export interface MatchResult {
  home: string
  away: string
  score: [number, number]
  /** Pênaltis em mata-mata. */
  pens?: [number, number]
  /** Prorrogação disputada. */
  aet?: boolean
}

/** Resultado de um mata-mata (fase a fase), para chaveamento na UI. */
export interface KnockoutStage {
  name: string // "Oitavas de final", "Final"…
  ties: { a: string; b: string; legs: MatchResult[]; winner: string }[]
}

export interface CupResult {
  competitionId: string
  season: number
  winner: string // clubId ou código FIFA
  runnerUp: string
  /** Fase de grupos/liga (se houver) — tabelas finais. */
  groups?: { name: string; table: StandingRow[] }[]
  knockout: KnockoutStage[]
  /** Participantes e até onde cada um chegou (0 = eliminado na 1ª fase … N = campeão). */
  reached: Record<string, string> // id → nome da fase alcançada ("Campeão", "Final", "Semifinal"…)
  /**
   * (aditivo, motor do mundo) Troféu da competição. Necessário porque `WorldEngine.nationSeason`
   * recebe só o resultado (sem GameData) e precisa devolver `trophyId`.
   */
  trophyId?: string
}

export interface LeagueSeasonResult {
  leagueId: string
  season: number
  table: StandingRow[] // ordenada, já com critério de desempate
  champion: string
  promoted: string[] // subiram PARA a liga de cima
  relegated: string[] // caíram PARA a liga de baixo
  /** Artilheiros simulados da liga (inclui o jogador do usuário quando for o caso). */
  topScorers: { name: string; clubId: string; goals: number; isUser?: boolean }[]
  playoffs?: KnockoutStage[]
  /**
   * (aditivo, motor do mundo) Ligas de Apertura/Clausura (`tournamentsPerSeason: 2`) coroam dois
   * campeões por temporada; `champion` é o do último torneio e `table` é a tabela anual (soma).
   */
  champions?: { name: string; clubId: string }[]
}

// ───────────────────────────── prêmios ─────────────────────────────

export type AwardId =
  | 'ballon_dor'
  | 'golden_boot' // Chuteira de Ouro europeia
  | 'golden_glove' // Luva de Ouro (goleiros)
  | 'the_best'
  | 'kopa' // melhor sub-21
  | 'league_top_scorer' // artilheiro da liga
  | 'league_best_player' // craque da liga (ex.: Bola de Ouro/Craque do Brasileirão)
  | 'wc_golden_ball'
  | 'wc_golden_boot'
  | 'puskas'
  | 'team_of_the_year'

export interface AwardRankingEntry {
  name: string
  nationality: string
  clubId?: string
  position: Position
  score: number
  isUser?: boolean
}

export interface AwardResult {
  award: AwardId
  /** Ano de entrega (Bola de Ouro 2027 premia a temporada 2026). */
  year: number
  winner: AwardRankingEntry
  /** Top 10 (Bola de Ouro), top 5 (outros). */
  ranking: AwardRankingEntry[]
  leagueId?: string
}

// ───────────────────────────── mundo simulado ─────────────────────────────

export interface ClubDynamic {
  strength: number // força atual (evolui)
  leagueId: string // liga atual (muda com acesso/rebaixamento)
  prestige: number // pode crescer com títulos
}

export interface NationalTournamentResult extends CupResult {
  host?: string
}

export interface SeasonWorldResult {
  season: number
  leagues: Record<string, LeagueSeasonResult>
  cups: Record<string, CupResult> // domésticas + continentais + mundial de clubes, por competitionId
  national: Record<string, NationalTournamentResult> // torneios de seleções que terminaram nesta temporada
  awards: AwardResult[]
  /**
   * (aditivo, motor do mundo) Totais compactos por clube em TODOS os jogos oficiais da temporada
   * (liga + copas + continentais + Mundial): [jogos, gols pró, gols contra, jogos sem sofrer gol].
   * Necessário porque `clubSeason(result, …)` precisa desses totais e não guardamos cada partida.
   */
  clubStats?: Record<string, [number, number, number, number]>
  /** (aditivo, motor do mundo) Por seleção: [jogos, gols pró] (eliminatórias, amistosos e torneio). */
  nationStats?: Record<string, [number, number]>
}

export interface Rival {
  id: string
  name: string
  shortName: string
  nationality: string
  position: Position
  birthYear: number
  ovr: number
  potential: number
  clubId: string
  /** true = jogador fictício gerado (nova geração), false = jogador real. */
  generated: boolean
  retired?: boolean
  /** Gols/assistências da última temporada simulada (para prêmios). */
  lastSeason?: { apps: number; goals: number; assists: number }
}

export interface WorldState {
  seed: string
  /** Temporada que será simulada a seguir. */
  nextSeason: number
  clubs: Record<string, ClubDynamic>
  /** Força atual das seleções. */
  nations: Record<string, number>
  rivals: Rival[]
  /** Resultados por temporada já simulada. */
  seasons: Record<number, SeasonWorldResult>
  /** Classificados para continentais na próxima temporada: competitionId → clubIds. */
  qualified: Record<string, string[]>
}

// ───────────────────────────── carreira ─────────────────────────────

export interface PlayerIdentity {
  surname: string // até 15 caracteres
  number: number // 1–99
  foot: Foot
  nationality: string // código FIFA
  position: Position
}

export interface SeasonStats {
  apps: number
  goals: number
  assists: number
  /** Goleiros */
  cleanSheets?: number
  conceded?: number
  /** Nota média 0–10. */
  rating: number
  minutes?: number
}

export interface TrophyWin {
  trophyId: string
  competitionId: string
  season: number
  /** Clube ou seleção pela qual foi conquistado. */
  teamId: string
  scope: 'club' | 'national'
  // ── aditivos (motor da carreira): permitem detectar conquistas e montar a vitrine sem GameData ──
  /** Tipo da competição (liga, copa, continental…). */
  kind?: CompetitionKind
  /** Confederação do clube (scope club) ou da seleção (scope national). */
  confed?: Confed
  /** Divisão quando kind = 'league' (título da Série B = 2). */
  tier?: 1 | 2 | 3
  /** Taça menor (estadual, supercopa): conta na vitrine, não em "tríplice coroa" e afins. */
  minor?: boolean
}

export interface AwardWin {
  award: AwardId
  year: number
  /** Colocação quando não venceu (Bola de Ouro 2º, 3º…) — só registramos top 3. */
  place: 1 | 2 | 3
  leagueId?: string
}

export interface SeasonRecord {
  season: number
  age: number
  clubId: string
  leagueId: string
  tier: 1 | 2 | 3
  loan: boolean
  /** Período em que a temporada foi simulada (índice de decisão). */
  period: number
  role: SquadRole
  ovrStart: number
  ovrEnd: number
  marketValue: number // em euros, ao fim da temporada
  stats: SeasonStats
  leaguePosition?: number
  promoted?: boolean
  relegated?: boolean
  suspended?: boolean
  injury?: { id: string; name: string; ovrDelta: number }
  trophies: TrophyWin[]
  awards: AwardWin[]
  national?: { apps: number; goals: number; assists: number; tournament?: { competitionId: string; reached: string } }
  captain?: boolean
  // ── aditivos (motor da carreira) ──
  /** País (FIFA) e confederação da liga do clube nesta temporada. */
  country?: string
  confed?: Confed
  /** Seleção que o jogador representava (muda com o evento "avô estrangeiro"). */
  nationality?: string
  /** Posição em campo nesta temporada (muda com "recuar de posição"). */
  position?: Position
  /** Prestígio (0–5) do clube nesta temporada. */
  clubPrestige?: number
}

export type EffectKind = 'positive' | 'negative' | 'neutral' | 'fixed'

/** Pílula de efeito mostrada em uma opção ("+4 OVR" 65%). */
export interface EffectChip {
  kind: EffectKind
  label: string
  probability?: number // 0–1, exibida como "65%"
}

export type DecisionKind =
  | 'academy' // oferta de base (3 clubes)
  | 'transfer' // janela de transferências (até 2 clubes + ficar)
  | 'loan' // oferta de empréstimo (3 clubes)
  | 'loan_return' // fim de empréstimo
  | 'non_renewal' // fim de ciclo (sem renovação)
  | 'event' // evento pessoal (25+ tipos)
  | 'injury'
  | 'club_priority' // priorizar liga × copa internacional
  | 'national_call' // convocação/conflito com seleção
  | 'contract' // renovação
  | 'retirement'

export interface DecisionOption {
  id: string
  label: string // "Assinar com", "Fazer", "Ficar no"
  /** Texto principal do card (nome do clube ou da ação). */
  title?: string
  clubId?: string
  trophyId?: string
  /** Chave de ilustração do card (src/ui/illustrations). */
  art?: string
  effects: EffectChip[]
  /** Detalhes extras (salário, contrato, papel previsto). */
  details?: { label: string; value: string }[]
  /** Minijogo associado (pênalti decisivo). */
  minigame?: 'penalty'
}

export interface Decision {
  id: string
  kind: DecisionKind
  /** Chave do evento no catálogo (para eventos pessoais). */
  eventKey?: string
  variant?: string
  title: string
  description: string
  options: DecisionOption[]
  /** Contexto usado pelo resolvedor (clubes ofertados, papel previsto etc.). */
  context?: Record<string, unknown>
}

/** Resultado da escolha: o que foi sorteado e aplicado. */
export interface DecisionOutcome {
  decisionId: string
  optionId: string
  /** Índice do efeito sorteado (para a animação de "roleta"). */
  rolledEffect?: number
  ovrDelta?: number
  summary: string
}

export interface NationalTeamCareer {
  firstCallUp?: number // temporada
  apps: number
  goals: number
  assists: number
  trophies: TrophyWin[]
  tournaments: { competitionId: string; year: number; reached: string; apps: number; goals: number }[]
}

export interface CareerLogEntry {
  season: number
  age: number
  type:
    | 'joined'
    | 'loan_started'
    | 'loan_ended'
    | 'decision'
    | 'trophy'
    | 'award'
    | 'injury'
    | 'promotion'
    | 'relegation'
    | 'call_up'
    | 'milestone'
    | 'retired'
  text: string
  data?: Record<string, unknown>
}

export type CareerPhase = 'identity' | 'deciding' | 'revealing' | 'finished'

export interface CareerState {
  version: 1
  id: string
  mode: GameMode
  pace: Pace
  seed: string
  identity: PlayerIdentity
  createdAt: string
  phase: CareerPhase
  /** Idade atual (início da próxima temporada a simular). */
  age: number
  season: number
  ovr: number
  /** Perfil de desenvolvimento oculto. */
  devProfile: 'early' | 'normal' | 'late'
  marketValue: number
  clubId: string | null
  /** Clube dono do passe durante empréstimo. */
  parentClubId?: string
  contractUntil?: number
  seasons: SeasonRecord[]
  national: NationalTeamCareer
  pendingDecision: Decision | null
  lastOutcome?: DecisionOutcome
  period: number
  /** Controles de eventos (uma vez por carreira, cooldown, lesões). */
  events: {
    done: string[]
    slots: number[] // idades planejadas
    lastEventAge: number
    injuries: number
  }
  /** Modificadores temporários (penalidade de OVR na temporada, papel forçado, suspensão…). */
  modifiers: {
    roleOverride?: SquadRole
    tempOvr?: number
    suspendedSeasons?: number
    forceTrophy?: { competitionKind: CompetitionKind; chance: number }
    priority?: 'league' | 'continental'
  }
  streaks: { lowRole: number; substitute: number }
  world: WorldState
  log: CareerLogEntry[]
  retired: boolean
  retiredReason?: string
  // ── aditivos (motor da carreira) ──
  /** Conquistas (ids do catálogo) já desbloqueadas nesta carreira. */
  achievements?: string[]
  /** Memória interna do motor da carreira (JSON; a UI não deve depender dela). */
  engine?: Record<string, unknown>
}

/** Resumo final (tela "Ver resumo" e card compartilhável). */
export interface CareerSummary {
  identity: PlayerIdentity
  seasons: number
  clubs: { clubId: string; seasons: number; apps: number; goals: number; assists: number; trophies: number; loan: boolean }[]
  totals: { apps: number; goals: number; assists: number; cleanSheets?: number }
  national: NationalTeamCareer
  trophies: { trophyId: string; count: number; seasons: number[] }[]
  awards: { award: AwardId; count: number; years: number[] }[]
  peakOvr: number
  peakOvrAge: number
  peakValue: number
  ballonDorPodiums: { year: number; place: number }[]
  legacyScore: number // 0–100
  /** Título honorífico ("Lenda do Palmeiras", "Rei da Libertadores"…). */
  headline: string
  comparisons: string[] // "Mais gols que Romário pelo Vasco…"
}

export interface Achievement {
  id: string
  title: string
  description: string
  icon: string // lucide ou chave de arte
  rarity: 'comum' | 'rara' | 'epica' | 'lendaria'
  hidden?: boolean
}
