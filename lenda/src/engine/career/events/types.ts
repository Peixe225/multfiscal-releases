import type { Rng } from '../../rng'
import type {
  CareerState,
  Club,
  CompetitionKind,
  Country,
  DecisionOption,
  EffectChip,
  GameData,
  League,
  Position,
  SquadRole,
} from '../../types'
import type { CareerMemory } from '../memory'

/** Efeito concreto de um resultado (aplicado antes de simular o período). */
export interface EffectSpec {
  /** Delta de OVR permanente, aplicado já. */
  ovr?: number
  /** Delta temporário: aplica agora e devolve depois de N temporadas (ou no fim do período). */
  temp?: { delta: number; afterSeasons?: number }
  roleOverride?: SquadRole
  roleSeasons?: number
  roleShift?: number
  /** Se presente, o `roleShift` deste efeito vale só nas primeiras N temporadas do período (lesão). */
  roleShiftSeasons?: number
  /** Post polêmico: titular/rotação → rotação baixa, rotação baixa → reserva, reserva → 0 jogos. */
  demoteRoleSeasons?: number
  suspend?: boolean
  /** Ajuste na força do clube passada ao mundo (substitui os multiplicadores de título do Copero). */
  boost?: number
  priority?: 'league' | 'continental'
  forceTrophy?: { kind: CompetitionKind; win: boolean }
  national?: 'force' | 'skip'
  nationalBoost?: number
  switchNationality?: string
  retireNational?: boolean
  declineFactor?: number
  offerBoost?: number
  superAgent?: boolean
  captain?: boolean | 'lose'
  salaryMult?: number
  renewYears?: number
  valueMult?: number
  statsMult?: number
  newPosition?: Position
  spotlightOff?: boolean
  injury?: { id: string; name: string; ovrDelta: number }
}

export interface OutcomeSpec {
  p: number
  /** Índice da pílula correspondente em option.effects (para a roleta da UI). */
  chip?: number
  kind: 'positive' | 'negative' | 'neutral'
  fx: EffectSpec
  /** Frase do resultado para o log/revelação. */
  summary: string
}

export type OptionType = 'choice' | 'join' | 'stay' | 'loan' | 'permanent' | 'retire'

/** O que o resolvedor precisa saber de cada opção (guardado em decision.context.specs). */
export interface OptionSpec {
  type: OptionType
  optionKey: string
  clubId?: string
  outcomes: OutcomeSpec[]
  penalty?: { side: 'left' | 'center' | 'right' }
  /** Motivo da aposentadoria (voluntary | no_offers). */
  retireReason?: string
}

export interface EventOption {
  option: DecisionOption
  spec: OptionSpec
}

export interface BuiltEvent {
  title: string
  description: string
  options: EventOption[]
  context?: Record<string, unknown>
}

export interface TrophyTarget {
  kind: CompetitionKind
  competitionId: string
  trophyId: string
  name: string
  scope: 'club' | 'national'
}

export interface EventEnv {
  data: GameData
  state: CareerState
  m: CareerMemory
  age: number
  ovr: number
  position: Position
  isGK: boolean
  club: Club | null
  clubStrength: number
  clubPrestige: number
  league: League | null
  tier: number
  /** Papel previsto no clube atual para o próximo período. */
  role: SquadRole
  nat: Country | null
  abroad: boolean
  /** Temporadas que o próximo período vai simular. */
  periodSeasons: number[]
  paceSeasons: number
  calledUpBefore: boolean
  callUpOvr: number
  /** Ofertas de transferência que a janela teria agora (simulação a seco, memorizada). */
  offers(): Club[]
  clubTrophyTarget(): TrophyTarget | null
  penaltyTarget(): TrophyTarget | null
  /** Próximo torneio de seleções no período (nome em pt-BR). */
  nationalTournament(): TrophyTarget | null
  worldCupAhead(): boolean
}

export interface EventDef {
  key: string
  weight: number
  origin: 'copero' | 'lenda'
  variants?: { key: string; weight: number }[]
  eligible(env: EventEnv): boolean
  build(env: EventEnv, variant: string | undefined, r: Rng): BuiltEvent | null
}

export type { EffectChip }
