/**
 * Memória interna do motor imersivo (guardada em `ImmersiveState.engine`, 100% JSON).
 * A UI não deve depender destes campos.
 */
import type { FixedResult } from '../api'
import type { AwardResult, Confed, CompetitionKind, Decision, UserFixture, UserLeagueLog } from '../types'
import type { ImmersiveState, KeyMomentSituation, MatchPosture } from './types'

export const MEM_VERSION = 1

/** Partida da agenda (subconjunto de UserFixture, compacto). */
export type Fx = Pick<
  UserFixture,
  | 'key'
  | 'competitionId'
  | 'kind'
  | 'stage'
  | 'round'
  | 'home'
  | 'away'
  | 'opponent'
  | 'userHome'
  | 'neutral'
  | 'knockout'
  | 'leg'
  | 'legs'
  | 'extraTime'
  | 'seedAdvancesOnDraw'
  | 'userSeed'
  | 'score'
  | 'pens'
  | 'strength'
  | 'seq'
  | 'prior'
>

export interface PlannedMoment {
  minute: number
  situation: KeyMomentSituation
  /** Lance encadeado (drible que vira chute…). */
  chained?: boolean
}

/** Estado interno de uma partida ao vivo. */
export interface LiveMem {
  itemId: string
  national: boolean
  /** λ de fundo por 90 min [mandante, visitante] (o jogador soma os lances dele por cima). */
  lambda: [number, number]
  plan: PlannedMoment[]
  momentIdx: number
  /** Minuto em que o jogador entra (0 titular, 999 não entra). */
  onAt: number
  offAt?: number
  startMinute: number
  /** Energia ao vivo (0–100). */
  fitness: number
  userSeed?: boolean
  /** Mata-mata: prorrogação permitida e se este jogo decide o confronto. */
  decider: boolean
  extraTime: boolean
  seedAdvancesOnDraw?: boolean
  prior?: [number, number]
  teammates: string[]
  opponents: string[]
  /**
   * Quem está em campo e quem sobra no banco de cada lado [mandante, visitante] (narração das
   * trocas: ninguém sai duas vezes nem entra quem já está jogando). Sem o jogador do usuário.
   */
  xi?: [string[], string[]]
  bench?: [string[], string[]]
  /** Quem entrou do banco em cada lado (não é substituído de novo). */
  fromBench?: [string[], string[]]
  /** Jogadores de fundo com amarelo em cada lado (o 2º expulsa). */
  booked?: [string[], string[]]
  keeper: [string, string]
  /** Nomes que já saíram (substituídos/expulsos) — narrativa. */
  subsDone: [number, number]
  cards: { yellow: number; red: boolean }
  injured?: boolean
  /** Opções do lance pendente com o que acontece em cada uma. */
  pending?: MomentSpec
  /** Disputa de pênaltis em andamento. */
  shootout?: { h: number; a: number; k: number; userKick?: number; userDone?: boolean }
  /** Gols do jogador + assistências + lances (para a nota). */
  goalsFor: number
  goalsAgainst: number
  lastEventMinute: number
  motm?: boolean
  /** Fora por suspensão (desconta um jogo ao fim). */
  suspendedOut?: boolean
  /** Ajustes finais da nota já aplicados (no apito final). */
  rated?: boolean
  /** Postura atual e saldo de lances criados (+) ou cortados (−) por ela (limitado a −1…+2). */
  posture?: MatchPosture
  postureNet?: number
}

export interface MomentOptionSpec {
  id: string
  chance: number
  /** O que o sucesso significa. */
  onSuccess: 'goal' | 'assist_chance' | 'chance' | 'stop' | 'save' | 'follow_shot' | 'foul_won'
  /** Prob. de gol do adversário se falhar (lances defensivos) ou de gol de companheiro no sucesso (passe). */
  p2?: number
  /** Risco de cartão (0–1). */
  card?: number
  rating: [number, number]
  label: string
}

export interface MomentSpec {
  id: string
  situation: KeyMomentSituation
  options: MomentOptionSpec[]
  teammate: string
  opponent: string
  minigame?: 'penalty_kick' | 'penalty_save' | 'timing'
  /** Opção recomendada (IA "esperta" sem sorteio) — a do tempo esgotado. */
  suggested?: string
}

export interface Deltas {
  coach?: number
  teammates?: number
  fans?: number
  media?: number
  morale?: number
  form?: number
  fitness?: number
  reputation?: number
  followers?: number
}

export interface StoryCtx {
  source: 'classic' | 'mini' | 'academy' | 'retire_offer'
  eventKey?: string
  /** Mini-eventos: resultado por opção. */
  mini?: Record<string, { p: number; ok: Deltas & { ovr?: number }; bad?: Deltas & { ovr?: number }; okText: string; badText?: string }>
}

export interface SeasonClubSpan {
  clubId: string
  comps: string[]
  apps: number
  // ── números da passagem (temporada dividida entre clubes; ausentes em saves antigos) ──
  loan?: boolean
  goals?: number
  assists?: number
  minutes?: number
}

export interface ImmersiveMemory {
  v: number
  /** Perfil de desenvolvimento oculto e potencial real. */
  profile: 'early' | 'normal' | 'late'
  truePotential: number
  /** XP fracionário por atributo. */
  xp: Record<string, number>
  /** Contador de ações (sub-streams de rng). */
  tick: number
  /** Resultados fixos da temporada corrente. */
  fixed: Record<string, FixedResult>
  agenda: Fx[]
  natAgenda: Fx[]
  league?: UserLeagueLog
  /** rodada do mundo → ordem de exibição (1ª, 2ª…); ausente = identidade. */
  matchday?: Record<number, number>
  /** Semana inicial da temporada (1ª temporada começa no meio). */
  startWeek: number
  calKind: 'split' | 'calendar'
  /** Convocado na janela atual / no torneio de fim de temporada. */
  natCalled: boolean
  natTournament?: { competitionId: string; called: boolean }
  live?: LiveMem
  press?: Record<string, Record<string, Deltas>>
  story?: StoryCtx
  /** Estatísticas da seleção na temporada. */
  natSeason: { apps: number; goals: number; assists: number; tournamentGoals: number; tournamentApps?: number }
  /** Clubes pelos quais jogou na temporada (títulos de meia temporada). */
  spans: SeasonClubSpan[]
  seasonStartOvr: number
  seasonInjury?: { id: string; name: string; ovrDelta: number }
  /** Últimas notas (forma). */
  ratings: number[]
  /** Semanas de treino físico na temporada (freia o declínio). */
  physicalWeeks: number
  trainingWeeks: number
  lastFocus?: string
  lastIntensity?: 'leve' | 'normal' | 'intensa'
  lastPostWeek?: number
  /** Prêmios da temporada encerrada (cerimônia). */
  pendingAwards?: AwardResult[]
  /** Gols sofridos em campo (goleiro) na temporada. */
  seasonConceded?: number
  // ── ecos do Clássico (eventos) ──
  eventsDone: string[]
  lastClassicEventSeason: number
  superAgent: boolean
  nationalRetired: boolean
  declineFactor: number
  offerBoost: number
  captainAt: string | null
  retrainedFrom?: string
  farFromSpotlight: boolean
  natConfeds: Record<string, Confed>
  seasonsAtClub: number
  firstClubId: string | null
  /** Empréstimo em curso; `parentSalary` = salário do contrato com o clube dono (volta ao fim). */
  loan?: { parentClubId: string; untilSeason: number; parentSalary?: number }
  tempOvr?: { delta: number; untilSeason: number }
  valueMult: number
  /** Priorizar liga × continental (evento): aplicado na próxima temporada. */
  priority?: 'league' | 'continental'
  /** Participação na seleção forçada/pulada no torneio (evento), válida na temporada indicada. */
  nationalFlag?: 'force' | 'skip'
  nationalFlagSeason?: number
  injuries: number
  /** Contagem de eventos pessoais já exibidos na temporada. */
  storiesThisSeason: number
  /** Minutos de clube disponíveis na temporada (para o papel). */
  clubMatches: number
  /** Resultado previsto pelo mundo para cada partida jogada (decide nova pré-simulação). */
  lastResim: number
  /** Kinds de competições em que jogou (títulos). */
  compKinds?: Record<string, CompetitionKind>
  /** Decisão de aposentadoria já oferecida nesta temporada. */
  retireOffered?: number
  followersBase?: number
  lastDecision?: Decision['id']
  /** Contador de ids (notícias, posts, mensagens, propostas). */
  idSeq?: number
  /** Último item do calendário em que a "chegada" já rodou. */
  arrivedId?: string
  /** Semana do último jogo com minutos (ritmo). */
  lastMatchWeek?: number
  /** Amarelos acumulados (3 = suspensão). */
  yellows?: number
  /** Mini-eventos recentes (evita repetir). */
  recentMini?: string[]
  /** Temporada em que a diretoria avisou que não renova. */
  noRenewal?: number
  /** Competições em que o jogador já foi eliminado na temporada. */
  eliminated?: string[]
  /** Pré-simulações feitas na temporada (diagnóstico). */
  resims?: number
  // ── auditoria (aditivos; saves antigos seguem válidos) ──
  /** Posição (semana·1000 + ordem) gravada de partidas empurradas para depois do ponto atual. */
  slots?: Record<string, number>
  /** Temporada até a qual a prioridade (liga × continental) do evento vale. */
  priorityUntil?: number
  /** Gols na liga (campeonato de pontos corridos do clube) na temporada — prêmios. */
  leagueGoals?: number
  /** Intensidade/foco escolhidos pelo jogador (a IA repete; nunca herda descanso da IA). */
  userIntensity?: 'leve' | 'normal' | 'intensa'
  userFocus?: string
  /** Semanas de treino no calendário da temporada (normaliza o ganho semanal). */
  seasonTrainingWeeks?: number
  /** Posts na semana (efeito decrescente) e semana do último "foco no treino". */
  postsWeek?: number
  postsCount?: number
  focusPostWeek?: number
  /** Posts "foco no treino" que já mexeram com o técnico na temporada (efeito decrescente). */
  focusPostsSeason?: number
  /** Salário: semanas já pagas na temporada (máx. 52). */
  paidWeeks?: number
  /** Transferência acertada para a próxima temporada (calendário do clube novo já encerrado). */
  deferredJoin?: { clubId: string; kind: 'transfer' | 'loan' | 'free_agent'; salary: number; years: number; fee?: number; role: 'Titular' | 'Rotação' | 'Reserva' | 'Promessa'; releaseClause?: number; signingBonus?: number }
  /** Janelas seguidas sem clube (garante uma proposta modesta). */
  freeAgentTries?: number
  /** Salário original de cada proposta (teto da negociação). */
  offerBase?: Record<string, number>
  /** Mini-evento → temporada em que apareceu (cooldown de 2 temporadas). */
  miniSeen?: Record<string, number>
  /** Lados das últimas cobranças de pênalti do jogador (0 esq., 1 meio, 2 dir.) — o goleiro se adapta. */
  penHist?: number[]
  /** Amarelos por competição (suspensão ao acumular). */
  yellowsBy?: Record<string, number>
  /** Coletivas: pergunta → semana em que saiu (temporada·100 + semana); não volta em 4 semanas. */
  pressSeen?: Record<string, number>
  /** Manchete da coletiva em andamento (uma só por coletiva: a resposta mais quente). */
  pressHead?: { newsId: string; rank: number }
  /** Posição na liga depois do último jogo de liga (notícias de G-4/Z-4, liderança). */
  lastLeaguePos?: number
  /** Semana (temporada·100 + semana) da última notícia de tabela/sequência. */
  tableNewsWeek?: number
}

export function mem(s: ImmersiveState): ImmersiveMemory {
  return s.engine as unknown as ImmersiveMemory
}

export function newMemory(): ImmersiveMemory {
  return {
    v: MEM_VERSION,
    profile: 'normal',
    truePotential: 80,
    xp: {},
    tick: 0,
    fixed: {},
    agenda: [],
    natAgenda: [],
    startWeek: 0,
    calKind: 'calendar',
    natCalled: false,
    natSeason: { apps: 0, goals: 0, assists: 0, tournamentGoals: 0 },
    spans: [],
    seasonStartOvr: 50,
    ratings: [],
    physicalWeeks: 0,
    trainingWeeks: 0,
    eventsDone: [],
    lastClassicEventSeason: 0,
    superAgent: false,
    nationalRetired: false,
    declineFactor: 1,
    offerBoost: 0,
    captainAt: null,
    farFromSpotlight: false,
    natConfeds: {},
    seasonsAtClub: 0,
    firstClubId: null,
    valueMult: 1,
    injuries: 0,
    storiesThisSeason: 0,
    clubMatches: 0,
    lastResim: 0,
  }
}
