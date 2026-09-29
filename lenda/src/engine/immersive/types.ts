/**
 * LENDA — Modo Imersivo: contrato de tipos (motor ↔ UI).
 *
 * A carreira é jogada item a item de um CALENDÁRIO (treinos, partidas, coletivas, janelas,
 * convocações, cerimônias). O mundo continua sendo o do motor do mundo (src/engine/world):
 * no início de cada temporada ele é PRÉ-SIMULADO para descobrir a agenda do clube do jogador;
 * cada partida do jogador é jogada ao vivo e o placar resultante vira um "resultado fixo"
 * (UserSeasonContext.fixedResults); ao fim da temporada o mundo é simulado de novo com todos
 * os resultados fixos e então consolidado (tabelas, copas, prêmios coerentes com o que o
 * jogador viveu).
 *
 * Toda mudança de estado passa por `dispatch(action)` → estado novo + efeitos para a UI animar.
 * Determinístico por seed (rng.ts), serializável em JSON, sem Math.random/Date.now.
 */
import type {
  AwardResult,
  Decision,
  GameData,
  PlayerIdentity,
  Position,
  SeasonRecord,
  TrophyWin,
  AwardWin,
  WorldState,
  NationalTeamCareer,
  CareerLogEntry,
} from '../types'

// ───────────────────────────── jogador ─────────────────────────────

/** Atributos de linha (1–99). */
export interface OutfieldAttributes {
  pace: number // Velocidade
  shooting: number // Finalização
  passing: number // Passe
  dribbling: number // Drible
  defending: number // Defesa
  physical: number // Físico
}

/** Atributos de goleiro (1–99). */
export interface GoalkeeperAttributes {
  diving: number // Elasticidade
  handling: number // Firmeza
  reflexes: number // Reflexo
  positioning: number // Posicionamento
  kicking: number // Reposição
}

export type Attributes = OutfieldAttributes | GoalkeeperAttributes
export type AttributeKey = keyof OutfieldAttributes | keyof GoalkeeperAttributes

/** Condição física e mental (0–100). */
export interface Condition {
  fitness: number // Condição física (cansaço ↓)
  form: number // Fase (últimas atuações)
  morale: number // Moral
  sharpness: number // Ritmo de jogo (minutos recentes)
  injury?: { name: string; weeksLeft: number; ovrDelta?: number }
  suspendedMatches?: number
}

/** Relações (0–100). */
export interface Relationships {
  coach: number // Confiança do técnico (define titular/banco)
  teammates: number // Vestiário
  fans: number // Torcida
  media: number // Imprensa
  /** Rival/ídolo/parceiro de ataque etc. (histórias). */
  bonds?: { name: string; role: 'parceiro' | 'rival' | 'mentor' | 'pupilo'; value: number }[]
}

export interface Finance {
  /** Salário anual em euros. */
  salary: number
  /** Saldo acumulado (euros). */
  balance: number
  contractUntil: number // temporada final do contrato
  releaseClause?: number
  /** Bônus por gol/título (euros). */
  bonuses?: { perGoal?: number; perTitle?: number }
  /** Compras de estilo de vida (carro, casa…) — puramente cosméticas + moral. */
  lifestyle?: { id: string; name: string; price: number; season: number }[]
}

export type TrainingFocus =
  | 'finishing'
  | 'passing'
  | 'dribbling'
  | 'physical'
  | 'defending'
  | 'goalkeeping'
  | 'tactical'
  | 'rest'
  | 'recovery'

// ───────────────────────────── calendário ─────────────────────────────

export type CalendarKind =
  | 'training' // semana de treino (escolha de foco)
  | 'match' // partida do clube
  | 'national_match' // partida da seleção
  | 'press' // coletiva de imprensa
  | 'story' // evento de história (mesmos moldes do Clássico: Decision)
  | 'transfer_window' // abre/fecha janela: propostas chegam na caixa de entrada
  | 'national_callup' // anúncio da convocação
  | 'season_end' // fim de temporada: balanço, evolução, renovação
  | 'awards' // cerimônia (Bola de Ouro, prêmios da liga)

export interface CalendarItem {
  id: string
  season: number
  /** Semana da temporada (0 = pré-temporada). Ordenação: week, depois order. */
  week: number
  order: number
  kind: CalendarKind
  title: string // pt-BR: "Brasileirão · 29ª rodada", "Treino da semana", "Coletiva pré-clássico"
  competitionId?: string
  /** Chave da partida no motor do mundo (para resultado fixo). */
  fixtureKey?: string
  opponentId?: string // clubId ou código FIFA
  home?: boolean
  stage?: string // "29ª rodada", "Oitavas · ida", "Final"
  /** Importância 0–1 (clássico, final, decisão de título) — pesa em pressão, moral, torcida. */
  importance?: number
  done: boolean
  result?: {
    score: [number, number]
    userGoals: number
    userAssists: number
    rating: number
    played: boolean
    // ── aditivos (motor) ──
    /** Pênaltis [mandante, visitante] (mata-mata). */
    pens?: [number, number]
    /** Decidido na prorrogação. */
    aet?: boolean
    minutes?: number
  }
  // ── aditivos (motor) ──
  /** Mês (1–12) e ano aproximados da semana (ausentes no bloco de torneios de fim de temporada). */
  month?: number
  year?: number
  /** Jogo de ida/volta: 1 ou 2 (de `legs`). */
  leg?: number
  legs?: number
}

// ───────────────────────────── partida ao vivo ─────────────────────────────

export interface TeamSide {
  id: string // clubId ou código FIFA
  name: string
  shortName: string
  strength: number
  national: boolean
}

export type MatchPhase = 'pre' | 'first_half' | 'half_time' | 'second_half' | 'extra_time' | 'penalties' | 'full_time'

export type MatchEventType =
  | 'kickoff'
  | 'goal'
  | 'own_goal'
  | 'penalty_goal'
  | 'penalty_miss'
  | 'chance'
  | 'save'
  | 'woodwork'
  | 'yellow'
  | 'red'
  | 'sub_on'
  | 'sub_off'
  | 'injury'
  | 'var'
  | 'half_time'
  | 'full_time'
  | 'key_moment'

export interface MatchEvent {
  minute: number
  addedTime?: number
  type: MatchEventType
  side: 'home' | 'away'
  /** Texto de narração pt-BR ("GOOOL! Ribeiro bate cruzado e abre o placar!"). */
  text: string
  player?: string
  assist?: string
  byUser?: boolean
  /** Posição aproximada no campo (0–100 x, 0–100 y) para a animação 2D. */
  at?: { x: number; y: number }
}

export type KeyMomentSituation =
  | 'shot'
  | 'one_on_one'
  | 'dribble'
  | 'pass'
  | 'through_ball'
  | 'cross'
  | 'header'
  | 'free_kick'
  | 'penalty'
  | 'tackle'
  | 'interception'
  | 'block'
  | 'save' // goleiro
  | 'penalty_save' // goleiro

export interface KeyMomentOption {
  id: string
  label: string // "Chutar colocado", "Tocar para o Neymar", "Dar o carrinho"
  detail?: string
  /** Probabilidade de sucesso já calculada (0–1), exibida como %. */
  chance: number
  /** Risco associado (cartão, lesão, contra-ataque) exibido como pílula. */
  risk?: string
  icon?: string // nome lucide
}

export interface KeyMoment {
  id: string
  minute: number
  situation: KeyMomentSituation
  /** pt-BR: "Ribeiro recebe na entrada da área, marcado por Marquinhos…" */
  description: string
  options: KeyMomentOption[]
  /** Tempo para decidir (ms). Sem resposta → a IA escolhe a opção mais segura. */
  timeLimitMs: number
  /** Minijogo associado (pênalti: escolher canto; timing: barra de precisão). */
  minigame?: 'penalty_kick' | 'penalty_save' | 'timing'
  at?: { x: number; y: number }
}

export interface UserMatchStats {
  minutes: number
  goals: number
  assists: number
  shots: number
  shotsOnTarget: number
  keyPasses: number
  dribbles: number
  tackles: number
  saves?: number
  conceded?: number
  rating: number // 0–10 (nota ao vivo)
  yellow?: boolean
  red?: boolean
}

export interface LiveMatch {
  itemId: string
  fixtureKey?: string
  competitionId: string
  stage?: string
  home: TeamSide
  away: TeamSide
  userSide: 'home' | 'away'
  /** Titular, banco (pode entrar), fora (não relacionado). */
  userStatus: 'starter' | 'bench' | 'out'
  userOnPitch: boolean
  phase: MatchPhase
  minute: number
  score: [number, number]
  pens?: [number, number]
  /** Mata-mata: placar agregado da ida (para exibir). */
  aggregate?: [number, number]
  knockout: boolean
  events: MatchEvent[]
  pendingMoment: KeyMoment | null
  stats: UserMatchStats
  /** Posse de bola/finalizações ao vivo para o placar da TV. */
  team: { possession: [number, number]; shots: [number, number]; onTarget: [number, number] }
  importance: number
  /** (aditivo) Por que o técnico escalou/deixou no banco/fora (pt-BR), para o pré-jogo. */
  selectionReason?: string
  /** (aditivo) Postura do jogador em campo: muda quantos lances decisivos ele tem e o desgaste. */
  posture?: MatchPosture
}

/** Pedir a bola: +lances decisivos, cansa mais · Equilibrada · Poupar: −lances, cansa menos. */
export type MatchPosture = 'ataque' | 'equilibrada' | 'poupar'

// ───────────────────────────── mídia, social, caixa de entrada ─────────────────────────────

export interface NewsItem {
  id: string
  season: number
  week: number
  headline: string // pt-BR
  body?: string
  outlet: string // veículo fictício ("Gazeta Esportiva", "Placar Digital"…)
  tone: 'positive' | 'negative' | 'neutral'
  aboutUser: boolean
  clubId?: string
}

export interface SocialPost {
  id: string
  season: number
  week: number
  author: string // "@torcedor_verdao", "Ribeiro (você)"
  handle: string
  text: string
  likes: number
  reposts: number
  tone: 'positive' | 'negative' | 'neutral'
  byUser?: boolean
  verified?: boolean
}

export interface ContractOffer {
  id: string
  clubId: string
  kind: 'transfer' | 'loan' | 'renewal' | 'free_agent'
  fee?: number // valor da transferência (euros)
  salary: number // anual
  years: number
  role: 'Titular' | 'Rotação' | 'Reserva' | 'Promessa'
  releaseClause?: number
  signingBonus?: number
  expiresWeek: number
  /** Negociação: quantas contrapropostas ainda cabem. */
  roundsLeft: number
  note?: string // "O técnico te quer como camisa 10"
}

export interface InboxMessage {
  id: string
  season: number
  week: number
  from: string // "Seu empresário", "Técnico", "Diretoria", "Seleção Brasileira"
  subject: string
  body: string
  read: boolean
  offerId?: string
  decisionId?: string
}

export interface PressQuestion {
  id: string
  journalist: string
  outlet: string
  question: string
  answers: { id: string; label: string; tone: 'humilde' | 'confiante' | 'provocador' | 'evasivo'; effects: string[] }[]
}

// ───────────────────────────── estado ─────────────────────────────

export interface ImmersiveState {
  version: 1
  mode: 'immersive'
  id: string
  seed: string
  identity: PlayerIdentity
  createdAt: string
  age: number
  season: number
  week: number
  ovr: number // derivado dos atributos + posição
  potential: number
  attributes: Attributes
  condition: Condition
  relationships: Relationships
  finance: Finance
  clubId: string | null
  parentClubId?: string
  squadNumber: number
  captain: boolean
  marketValue: number
  reputation: number // 0–100 (fama mundial)
  calendar: CalendarItem[]
  /** Índice do próximo item não concluído. */
  cursor: number
  live: LiveMatch | null
  press: PressQuestion[] | null
  inbox: InboxMessage[]
  offers: ContractOffer[]
  news: NewsItem[]
  social: SocialPost[]
  pendingDecision: Decision | null // evento de história (reuso do Clássico)
  /** Estatísticas da temporada corrente (acumulando partida a partida). */
  seasonStats: { apps: number; starts: number; minutes: number; goals: number; assists: number; cleanSheets: number; ratingSum: number; motm: number }
  seasons: SeasonRecord[] // mesmo formato do Clássico (tabela de carreira, resumo, Hall das Lendas)
  national: NationalTeamCareer
  trophies: TrophyWin[]
  awards: AwardWin[]
  world: WorldState
  /** Memória opaca do motor (resultados fixos da temporada, pré-simulação, sementes…). */
  engine: Record<string, unknown>
  log: CareerLogEntry[]
  achievements: string[]
  retired: boolean
  retiredReason?: string
  // ── aditivos (motor) ──
  /** Liga atual do clube (o mundo move clubes por acesso/rebaixamento). */
  leagueId?: string | null
  /** Seguidores nas redes (alcance dos posts). */
  followers?: number
}

// ───────────────────────────── ações e efeitos ─────────────────────────────

export type ImmersiveAction =
  | { type: 'advance' } // vai para o próximo item do calendário (ou para o próximo passo dele)
  | { type: 'train'; focus: TrainingFocus; intensity: 'leve' | 'normal' | 'intensa' }
  | { type: 'match_start'; accept?: boolean; posture?: MatchPosture } // entra na partida (aceitar banco/titularidade)
  | { type: 'match_posture'; posture: MatchPosture } // muda a postura durante o jogo (replaneja os lances que faltam)
  | { type: 'match_sim' } // simula até o próximo lance-chave, intervalo ou fim
  | { type: 'match_choose'; optionId: string; minigame?: { side?: 'left' | 'center' | 'right'; timing?: number } }
  | { type: 'match_timeout' } // tempo do lance acabou
  | { type: 'match_sub_request' } // pedir para sair (cansaço)
  | { type: 'match_finish' }
  | { type: 'press_answer'; questionId: string; answerId: string }
  | { type: 'press_skip' }
  | { type: 'social_post'; templateId: string }
  | { type: 'offer_respond'; offerId: string; response: 'accept' | 'reject' | 'counter'; counter?: { salary?: number; years?: number; role?: ContractOffer['role'] } }
  | { type: 'decision_choose'; optionId: string } // eventos de história
  | { type: 'inbox_read'; messageId: string }
  | { type: 'buy'; itemId: string }
  | { type: 'retire' }
  /**
   * (aditivo) "Simular até…": resolve itens sozinho (treino com o último foco, partidas com a IA,
   * coletivas puladas, eventos com a opção mais segura) até algo pedir o jogador ou o alvo chegar.
   * `next_match` para ANTES de abrir a próxima partida; `decision` para em decisão/proposta.
   */
  | { type: 'auto'; until?: 'next_match' | 'next_week' | 'season_end' | 'decision' | 'retirement'; maxSteps?: number }

export type ImmersiveEffect =
  | { type: 'toast'; tone: 'info' | 'success' | 'gold' | 'danger'; title: string; description?: string }
  | { type: 'attribute_up'; key: AttributeKey; from: number; to: number }
  | { type: 'ovr_change'; from: number; to: number }
  | { type: 'match_event'; event: MatchEvent }
  | { type: 'key_moment'; moment: KeyMoment }
  | {
      type: 'moment_result'
      success: boolean
      text: string
      goal?: boolean
      /** (aditivo) Opção efetivamente resolvida (em pênalti, a do lado escolhido no minijogo). */
      optionId?: string
      /** (aditivo) Pênalti: canto da cobrança e do pulo do goleiro (visão da câmera atrás do batedor). */
      penalty?: { shot: 'left' | 'center' | 'right'; keeper: 'left' | 'center' | 'right' }
    }
  | { type: 'trophy'; trophy: TrophyWin }
  | { type: 'award'; award: AwardResult }
  | { type: 'transfer'; clubId: string; fee?: number }
  | { type: 'news'; item: NewsItem }
  | { type: 'achievement'; id: string }
  | { type: 'season_end'; record: SeasonRecord }
  | { type: 'retired' }

export interface ImmersiveEngine {
  /** Nova carreira imersiva a partir dos dados reais (mesmo mundo inicial do Clássico). */
  newCareer(data: GameData, identity: PlayerIdentity, seed: string): ImmersiveState
  /** Única porta de mudança de estado. */
  dispatch(data: GameData, state: ImmersiveState, action: ImmersiveAction): { state: ImmersiveState; effects: ImmersiveEffect[] }
  /** Utilitários para a UI. */
  nextItem(state: ImmersiveState): CalendarItem | null
  ovrOf(attributes: Attributes, position: Position): number
  /** Tabela ao vivo da liga do jogador na rodada atual (reais + pré-simulados + os do jogador). */
  liveTable(data: GameData, state: ImmersiveState): import('../types').StandingRow[]
  // ── aditivos (motor) ──
  /** Ações aceitas agora pelo `dispatch` (as demais viram no-op com toast). */
  validActions?(state: ImmersiveState): ImmersiveAction['type'][]
  /** Resumo de carreira no formato do Clássico (tela final, Hall das Lendas). */
  summarize?(data: GameData, state: ImmersiveState): import('../types').CareerSummary
  /**
   * Chances da contraproposta (mesma conta do `offer_respond` com `response: 'counter'`):
   * { accept, improve, walk } somam 1; `ceiling` = teto de salário do clube; null = pedido inválido.
   */
  acceptChance?(
    data: GameData,
    state: ImmersiveState,
    offerId: string,
    counter: { salary?: number; years?: number; role?: ContractOffer['role'] },
  ): { accept: number; improve: number; walk: number; ceiling: number; roundsLeft: number } | null
}
