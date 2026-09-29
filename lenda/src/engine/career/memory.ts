/**
 * Memória interna do motor (guardada em `CareerState.engine`, 100% JSON).
 * A UI não deve depender destes campos.
 */
import type { CareerState, CompetitionKind, Confed, SquadRole } from '../types'

export interface DevCycle {
  /** Idade-alvo da janela de 2 anos (tabela do Copero). */
  targetAge: number
  parts: [number, number]
  next: 0 | 1
}

export interface DeferredDelta {
  delta: number
  /** Aplica depois de N temporadas do período; ausente = no fim do período. */
  afterSeasons?: number
}

export interface LoanInfo {
  parentClubId: string
  loanClubId: string
  /** Idade em que o empréstimo termina (idade no início da temporada seguinte). */
  returnAge: number
}

/** Efeitos que valem para o período que vai ser simulado (zerados a cada decisão). */
export interface PeriodEffects {
  roleShift: number
  /** Degraus de papel perdidos só nas primeiras `seasons` temporadas do período (lesão moderada). */
  tempShift?: { shift: number; seasons: number }
  roleOverride?: SquadRole
  /** Quantas temporadas o roleOverride dura (ausente = período inteiro). */
  roleOverrideSeasons?: number
  /** Temporadas com 0 jogos (post polêmico sendo reserva). */
  zeroAppsSeasons?: number
  /** Ajuste na força do clube que o mundo recebe (mentor ×2 títulos ≈ +1,5; crise ≈ −3). */
  boostAdj: number
  /** Multiplicador de gols/assistências. */
  statsMult: number
  /** Multiplicador de valor de mercado (fama). */
  valueMult: number
  /** Participação na seleção: forçar/impedir no torneio do período. */
  national?: 'force' | 'skip'
  /** Força extra da seleção (jogar a Copa no sacrifício). */
  nationalBoost?: number
  /** Forçar/impedir título só na PRIMEIRA temporada do período (Copero aplicava em todas). */
  forceTrophy?: { kind: CompetitionKind; chance: number }
  /** Lesão sofrida no início do período (vai para a primeira linha). */
  injury?: { id: string; name: string; ovrDelta: number }
}

export interface CareerMemory {
  step: number
  devCycle: DevCycle | null
  deferred: DeferredDelta[]
  period: PeriodEffects
  loan: LoanInfo | null
  completedLoan: { parentClubId: string; loanClubId: string } | null
  firstClubId: string | null
  /** Idades de slot de evento já consumidas. */
  slotsDone: number[]
  nationalRetired: boolean
  /** Fator do declínio (1 = normal; 0,6 = declina 40% mais devagar). */
  declineFactor: number
  /** Deslocamento da faixa de força das ofertas na próxima janela (+3 = clubes maiores). */
  offerBoost: number
  /** Superempresário: ofertas melhores e uma terceira proposta, pra sempre. */
  superAgent: boolean
  /** Clube em que é capitão. */
  captainAt: string | null
  originalNationality: string
  salary: number
  /** Temporadas seguidas no clube atual (para capitania/ídolo). */
  seasonsAtClub: number
  /** Posição original, se recuou de posição. */
  retrainedFrom?: string
  /** Fez a proposta milionária (Arábia/MLS): prêmios individuais ficam distantes. */
  farFromSpotlight: boolean
  /** Confederação de cada seleção que ele já pôde defender (detecção pura de conquistas). */
  natConfeds: Record<string, Confed>
}

export function emptyPeriod(): PeriodEffects {
  return { roleShift: 0, boostAdj: 0, statsMult: 1, valueMult: 1 }
}

export function newMemory(nationality: string, confed?: Confed): CareerMemory {
  return {
    step: 0,
    devCycle: null,
    deferred: [],
    period: emptyPeriod(),
    loan: null,
    completedLoan: null,
    firstClubId: null,
    slotsDone: [],
    nationalRetired: false,
    declineFactor: 1,
    offerBoost: 0,
    superAgent: false,
    captainAt: null,
    originalNationality: nationality,
    salary: 0,
    seasonsAtClub: 0,
    farFromSpotlight: false,
    natConfeds: confed ? { [nationality]: confed } : {},
  }
}

export function mem(state: CareerState): CareerMemory {
  const m = state.engine as unknown as CareerMemory | undefined
  if (!m) throw new Error('CareerState sem memória do motor (engine).')
  return m
}
