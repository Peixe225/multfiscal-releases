/**
 * Mecânicas do jogador: papel no elenco, desenvolvimento de OVR e valor de mercado.
 */
import { clamp, Rng } from '../rng'
import type { Position, SquadRole } from '../types'
import { DEV_TABLES, OVR_MAX, OVR_MIN, VALUE_CURVE } from './constants'
import type { DevCycle } from './memory'

// ───────────────────────── papel ─────────────────────────

const LADDER: SquadRole[] = ['substitute', 'low_rotation', 'high_rotation', 'starter']
const LADDER_GK: SquadRole[] = ['third_keeper', 'substitute', 'starter']

/**
 * Papel pelo delta OVR − força do clube. A força do clube é a média do seu melhor XI (Barcelona 87:
 * titulares de 84 a 90, reservas de uso de 82–83, banco de 78–81), então quem está até 2 pontos
 * abaixo dela é titular; de −3 a −6, rotação (25–35 jogos num grande); de −7 a −10, rotação baixa
 * (15–20); abaixo disso, reserva. Goleiro: só um joga — titular até −2, reserva até −7.
 * (O Copero usava 0/−4/−8, o que deixava um 83 do Barça com 5–10 jogos por temporada.)
 */
export function roleFromDelta(delta: number, isGK: boolean): SquadRole {
  if (isGK) return delta >= -2 ? 'starter' : delta >= -7 ? 'substitute' : 'third_keeper'
  if (delta >= -2) return 'starter'
  if (delta >= -6) return 'high_rotation'
  if (delta >= -10) return 'low_rotation'
  return 'substitute'
}

/** Normaliza um papel para a escada do goleiro/linha (o Copero deixava goleiro em "rotação baixa"). */
export function normalizeRole(role: SquadRole, isGK: boolean): SquadRole {
  if (isGK) {
    if (role === 'high_rotation') return 'substitute'
    if (role === 'low_rotation') return 'substitute'
    return role
  }
  return role === 'third_keeper' ? 'substitute' : role
}

export function shiftRole(role: SquadRole, isGK: boolean, shift: number): SquadRole {
  if (!shift) return normalizeRole(role, isGK)
  const ladder = isGK ? LADDER_GK : LADDER
  const i = ladder.indexOf(normalizeRole(role, isGK))
  return ladder[clamp(i + shift, 0, ladder.length - 1)]
}

export function predictRole(ovr: number, strength: number, position: Position): SquadRole {
  return roleFromDelta(ovr - strength, position === 'GOL')
}

export function isPlayingRole(role: SquadRole): boolean {
  return role === 'starter' || role === 'high_rotation'
}

export function isBenchRole(role: SquadRole): boolean {
  return role === 'low_rotation' || role === 'substitute' || role === 'third_keeper'
}

// ───────────────────────── desenvolvimento ─────────────────────────

export function devTableFor(profile: 'early' | 'normal' | 'late', position: Position) {
  return position === 'GOL' ? DEV_TABLES.gk : DEV_TABLES[profile]
}

/** Idade-alvo da janela de 2 anos que contém `age` (Copero: par → +2, ímpar → +1). */
export function cycleTarget(age: number): number {
  return age % 2 === 0 ? age + 2 : age + 1
}

/**
 * Sorteia a janela de 2 anos e divide em duas partes anuais (Copero `Qi` + `ol`).
 * Penalidade de banco a partir do alvo 24: sorteia duas vezes e fica com o menor.
 */
export function rollCycle(
  r: Rng,
  age: number,
  profile: 'early' | 'normal' | 'late',
  position: Position,
  role: SquadRole,
): DevCycle {
  const target = cycleTarget(age)
  const range = devTableFor(profile, position)[target]
  if (!range) return { targetAge: target, parts: [0, 0], next: age % 2 === 0 ? 0 : 1 }
  let delta = r.int(range[0], range[1])
  if (target >= 24 && isBenchRole(role)) delta = Math.min(delta, r.int(range[0], range[1]))
  const mag = Math.abs(delta)
  const first = mag >= 4 ? r.int(Math.ceil(mag * 0.25), Math.floor(mag * 0.75)) : r.int(0, mag)
  const signed = delta < 0 ? -first : first
  return { targetAge: target, parts: [signed, delta - signed], next: age % 2 === 0 ? 0 : 1 }
}

export function clampOvr(v: number): number {
  return clamp(Math.round(v), OVR_MIN, OVR_MAX)
}

// ───────────────────────── valor de mercado ─────────────────────────

export function valueFromCurve(ovr: number): number {
  const o = clamp(ovr, 50, 99)
  for (let i = 1; i < VALUE_CURVE.length; i++) {
    const [x1, y1] = VALUE_CURVE[i]
    const [x0, y0] = VALUE_CURVE[i - 1]
    if (o <= x1) return y0 + ((y1 - y0) * (o - x0)) / (x1 - x0)
  }
  return VALUE_CURVE[VALUE_CURVE.length - 1][1]
}

/** Fator de idade do Copero. */
export function ageValueFactor(age: number): number {
  if (age <= 18) return 1.5
  if (age <= 22) return 1.2
  if (age <= 26) return 1
  if (age <= 30) return 0.9
  if (age <= 32) return 0.8
  if (age <= 34) return 0.6
  return 0.2
}

/** Fator da liga (0,75 na liga mais fraca … 1,15 na Premier League). */
export function leagueValueFactor(coefficient: number): number {
  return clamp(0.75 + ((coefficient - 0.3) / 0.7) * 0.4, 0.75, 1.15)
}

/** Arredondamento do Copero: ≥€10M → 1M; ≥€1M → 100K; abaixo → 10K. */
export function roundMoney(v: number): number {
  if (v >= 10_000_000) return Math.round(v / 1_000_000) * 1_000_000
  if (v >= 1_000_000) return Math.round(v / 100_000) * 100_000
  return Math.max(10_000, Math.round(v / 10_000) * 10_000)
}

export function marketValue(r: Rng, ovr: number, age: number, leagueCoefficient: number, mult = 1): number {
  const base = valueFromCurve(ovr) * ageValueFactor(age) * r.range(0.95, 1.05) * leagueValueFactor(leagueCoefficient) * mult
  return roundMoney(base)
}

/** Salário anual estimado (€) exibido nos cards de oferta. */
export function estimateSalary(value: number, prestige: number, leagueCoefficient: number, mult = 1): number {
  const s = value * 0.12 * (0.7 + 0.12 * prestige) * (0.6 + 0.5 * leagueCoefficient) * mult
  return roundMoney(Math.max(24_000, s))
}

export function contractYears(age: number): number {
  if (age <= 23) return 5
  if (age <= 27) return 4
  if (age <= 30) return 3
  if (age <= 33) return 2
  return 1
}
