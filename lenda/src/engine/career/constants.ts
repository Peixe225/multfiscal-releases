/**
 * Constantes do motor da carreira (modo Clássico).
 *
 * Os números que definem a "sensação" do Copero foram mantidos (tabelas de desenvolvimento,
 * curva de valor de mercado, probabilidades de eventos, penalidades de lesão). Onde o LENDA
 * tem um mundo simulado de verdade (jogos, gols do clube, títulos), as fórmulas foram adaptadas.
 */
import type { Pace, PositionGroup, SquadRole } from '../types'

export const ENGINE_VERSION = 1
export const START_AGE = 16
export const START_SEASON = 2026
export const START_OVR = 50
export const START_VALUE = 100_000
/** A carreira termina aos 40: a última temporada jogada é a dos 39 anos. */
export const RETIREMENT_AGE = 40
export const OVR_MIN = 40
export const OVR_MAX = 99

export interface PaceConfig {
  seasons: 1 | 2 | 3
  /** Quantidade de eventos pessoais sorteada no início (mín, máx). */
  events: [number, number]
  /** Períodos seguidos como reserva / rotação baixa antes do "Fim de ciclo". */
  substituteBeforeNonRenewal: number
  lowRotationBeforeNonRenewal: number
  label: string
  hint: string
}

export const PACES: Record<Pace, PaceConfig> = {
  intensa: {
    seasons: 1,
    events: [6, 7],
    substituteBeforeNonRenewal: 2,
    lowRotationBeforeNonRenewal: 3,
    label: 'Intensa',
    hint: 'Uma decisão por temporada, para viver cada detalhe.',
  },
  normal: {
    seasons: 2,
    events: [3, 4],
    substituteBeforeNonRenewal: 1,
    lowRotationBeforeNonRenewal: 2,
    label: 'Normal',
    hint: 'Uma decisão a cada duas temporadas, no ritmo certo.',
  },
  expressa: {
    seasons: 3,
    events: [2, 3],
    substituteBeforeNonRenewal: 1,
    lowRotationBeforeNonRenewal: 2,
    label: 'Expressa',
    hint: 'Uma decisão a cada três temporadas, para chegar logo ao fim.',
  },
}

// ───────────────────────── eventos ─────────────────────────

export const EVENT_FIRST_AGE = 22
export const EVENT_LAST_AGE = 37
/** Chance de a janela de evento virar lesão (Copero: 2%, no máximo 2 por carreira). */
export const INJURY_CHANCE = 0.02
export const MAX_INJURIES = 2

export interface InjuryDef {
  id: string
  weight: number
  ovr: number
  name: string
}

/** As 10 lesões do Copero (pesos somam 100), com os nomes em pt-BR. */
export const INJURIES: InjuryDef[] = [
  { id: 'hamstring', weight: 24, ovr: -3, name: 'Lesão na coxa posterior' },
  { id: 'meniscus', weight: 18, ovr: -2, name: 'Ruptura de menisco' },
  { id: 'acl', weight: 14, ovr: -5, name: 'Rompimento do ligamento cruzado' },
  { id: 'ankle_sprain', weight: 14, ovr: -1, name: 'Entorse no tornozelo' },
  { id: 'tibia_fibula', weight: 8, ovr: -8, name: 'Fratura de tíbia e fíbula' },
  { id: 'calf_tear', weight: 8, ovr: -2, name: 'Estiramento na panturrilha' },
  { id: 'metatarsal_fracture', weight: 5, ovr: -4, name: 'Fratura no metatarso' },
  { id: 'achilles', weight: 4, ovr: -10, name: 'Rompimento do tendão de Aquiles' },
  { id: 'shoulder_dislocation', weight: 3, ovr: -4, name: 'Luxação no ombro' },
  { id: 'disc_hernia', weight: 2, ovr: -5, name: 'Hérnia de disco' },
]

// ───────────────────────── desenvolvimento de OVR ─────────────────────────

export type DevTable = Record<number, [number, number]>

/**
 * Tabelas de 2 anos do Copero, pela IDADE-ALVO (fim da janela de 2 anos).
 * Alvo 18 = idades 16–17; alvo 40 não existe → OVR congelado aos 38–39.
 */
export const DEV_TABLES: Record<'early' | 'normal' | 'late' | 'gk', DevTable> = {
  early: { 18: [7, 16], 20: [6, 16], 22: [4, 10], 24: [0, 7], 26: [-2, 1], 28: [-2, -1], 30: [-2, 0], 32: [-4, 0], 34: [-6, -1], 36: [-8, -2], 38: [-10, -3] },
  normal: { 18: [4, 14], 20: [3, 14], 22: [2, 10], 24: [1, 8], 26: [0, 3], 28: [-1, 0], 30: [-1, 0], 32: [-3, 0], 34: [-5, -1], 36: [-7, -2], 38: [-10, -3] },
  late: { 18: [2, 12], 20: [1, 12], 22: [1, 9], 24: [2, 9], 26: [1, 5], 28: [0, 1], 30: [0, 1], 32: [-2, 0], 34: [-5, -1], 36: [-7, -2], 38: [-10, -3] },
  gk: { 18: [2, 10], 20: [2, 10], 22: [2, 9], 24: [2, 8], 26: [1, 7], 28: [1, 5], 30: [0, 0], 32: [-1, 0], 34: [-2, 0], 36: [-4, -1], 38: [-6, -2] },
}

// ───────────────────────── valor de mercado ─────────────────────────

/** Curva do Copero (OVR → €). Interpolação linear entre os pontos. */
export const VALUE_CURVE: [number, number][] = [
  [50, 100_000],
  [55, 250_000],
  [60, 500_000],
  [65, 1_200_000],
  [70, 3_000_000],
  [75, 5_000_000],
  [80, 15_000_000],
  [85, 50_000_000],
  [90, 100_000_000],
  [95, 150_000_000],
  [99, 250_000_000],
]

// ───────────────────────── papel, jogos e gols ─────────────────────────

/** Fração dos jogos do clube que o jogador disputa, por papel (linha). */
export const APP_SHARE: Record<SquadRole, [number, number]> = {
  starter: [0.72, 0.9],
  high_rotation: [0.45, 0.65],
  low_rotation: [0.25, 0.42],
  substitute: [0.08, 0.22],
  third_keeper: [0, 0.05],
}

/** Goleiros: o titular joga quase tudo; o reserva pega copas. */
export const APP_SHARE_GK: Record<SquadRole, [number, number]> = {
  starter: [0.8, 0.95],
  high_rotation: [0.3, 0.5],
  low_rotation: [0.12, 0.25],
  substitute: [0.05, 0.16],
  third_keeper: [0, 0.05],
}

export const AVG_MINUTES: Record<SquadRole, number> = {
  starter: 82,
  high_rotation: 64,
  low_rotation: 46,
  substitute: 27,
  third_keeper: 90,
}

/** Grupo de taxa do Copero (5 famílias). O `PositionGroup` público tem 4. */
export type RateRole = 'attacker' | 'creator' | 'support' | 'defensive' | 'goalkeeper'

/** Gols por jogo por faixa de delta (OVR − força do clube): ≥10, ≥6, ≥3, ≥−2, ≥−5, ≥−9, menor. */
export const GOAL_RATES: Record<RateRole, number[]> = {
  attacker: [1.1, 0.85, 0.65, 0.5, 0.3, 0.15, 0.05],
  creator: [0.85, 0.6, 0.45, 0.3, 0.2, 0.1, 0.05],
  support: [0.15, 0.1, 0.08, 0.05, 0.02, 0, 0],
  defensive: [0.1, 0.08, 0.06, 0.04, 0.02, 0, 0],
  goalkeeper: [0, 0, 0, 0, 0, 0, 0],
}

export const ASSIST_RATES: Record<RateRole, number[]> = {
  attacker: [0.4, 0.3, 0.2, 0.15, 0.1, 0.08, 0.05],
  creator: [0.6, 0.45, 0.35, 0.25, 0.15, 0.08, 0.05],
  support: [0.35, 0.25, 0.18, 0.12, 0.07, 0.03, 0.02],
  defensive: [0.1, 0.07, 0.05, 0.03, 0.01, 0, 0],
  goalkeeper: [0, 0, 0, 0, 0, 0, 0],
}

/** Vagas "reais" por posição na seleção (quantos rivais melhores ele aceita e ainda é convocado). */
export const NATIONAL_SLOTS: Record<PositionGroup, number> = {
  goalkeeper: 3,
  defensive: 8,
  support: 7,
  attacking: 6,
}

/** Jogos oficiais de referência quando o mundo não informa (liga + copas). */
export const FALLBACK_MATCHES = 44
