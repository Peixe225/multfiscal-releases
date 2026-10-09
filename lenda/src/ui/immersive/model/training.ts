/**
 * Prévia do treino (só exibição): chance de evoluir cada atributo, custo de energia e risco.
 * Mesma forma de cálculo do motor de exemplo; o motor real pode divergir levemente.
 */
import type { AttributeKey, ImmersiveState, TrainingFocus } from '@/engine/immersive/types'
import { GK_KEYS, INTENSITY, OUTFIELD_KEYS, RECOVERY_GAIN, TRAINING_FOCUS, type Intensity } from './constants'
import { isGk } from './view'

export interface TrainingPreview {
  gains: { key: AttributeKey; value: number; chance: number }[]
  fitnessAfter: number
  fitnessDelta: number
  injuryRisk: number
  extra?: string
  disabled?: string
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** Energia que o motor devolve a cada virada de semana (weekTick). */
export const WEEK_RECOVERY = 22

/**
 * Energia no próximo compromisso: a de logo após o treino mais a recuperação de cada semana que vira
 * até ele (treino na semana 38, jogo na 39: +22). Mesmo semana: a de logo após o treino.
 */
export function energyAtNext(s: Pick<ImmersiveState, 'calendar' | 'cursor' | 'week'>, after: number): { value: number; weeks: number } {
  const next = s.calendar[s.cursor + 1]
  const weeks = next ? Math.max(0, Math.min(52, next.week) - s.week) : 0
  return { value: clamp(Math.round(after + weeks * WEEK_RECOVERY), 0, 100), weeks }
}

export function attrKeysFor(s: Pick<ImmersiveState, 'identity'>): AttributeKey[] {
  return isGk(s.identity.position) ? [...GK_KEYS] : [...OUTFIELD_KEYS]
}

export const attrValue = (s: Pick<ImmersiveState, 'attributes'>, k: AttributeKey) => (s.attributes as unknown as Record<string, number>)[k] ?? 0

export function trainingPreview(s: ImmersiveState, focus: TrainingFocus, intensity: Intensity): TrainingPreview {
  const meta = TRAINING_FOCUS[focus]
  const I = INTENSITY[intensity]
  const gk = isGk(s.identity.position)
  const valid = attrKeysFor(s)
  const keys = (gk ? meta.gkAttrs : meta.attrs).filter((k) => valid.includes(k))
  const ageF = s.age <= 19 ? 1.25 : s.age <= 23 ? 1 : s.age <= 28 ? 0.7 : 0.35
  const room = clamp((s.potential - s.ovr) / 20, 0.15, 1.2)
  const tired = s.condition.fitness < 40 ? 0.6 : 1
  const gains = keys.map((key) => ({ key, value: attrValue(s, key), chance: clamp(0.42 * I.gain * ageF * room * tired, 0.05, 0.92) }))
  const rec = RECOVERY_GAIN[focus] ?? 0
  const fitnessDelta = rec ? rec : I.fitness
  const fitnessAfter = clamp(Math.round(s.condition.fitness + fitnessDelta), 0, 100)
  const injuryRisk = rec || focus === 'rest' ? 0 : I.injury * (s.condition.fitness < 35 ? 2.5 : 1)
  const disabled = meta.only === 'gk' && !gk ? 'Só para goleiros' : meta.only === 'outfield' && gk ? 'Só para jogadores de linha' : undefined
  return { gains, fitnessAfter, fitnessDelta: fitnessAfter - s.condition.fitness, injuryRisk, extra: meta.extra, disabled }
}
