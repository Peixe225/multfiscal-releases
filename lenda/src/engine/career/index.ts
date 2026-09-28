/**
 * Motor da carreira do modo Clássico — API pública.
 *
 *   import { createCareerEngine, formatMoney, roleLabel } from '@/engine/career'
 *   const engine = createCareerEngine(worldEngine)
 *   let state = engine.newCareer(data, identity, 'normal', seed)
 *   const { state: next, reveal } = engine.choose(data, state, state.pendingDecision!.options[0].id)
 *
 * O motor recebe o WorldEngine por injeção (o mundo real vive em src/engine/world).
 */
import type { CareerState, GameData } from '../types'
import { forceEventDecision } from './events/runtime'
import { cloneState } from './engine'
import { mem } from './memory'

export { createCareerEngine, cloneState, nextDecision, applyEffects } from './engine'
export { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, detectAchievements } from './achievements'
export { EVENTS, EVENT_BY_KEY } from './events/catalog'
export { forceEventDecision, isEventEligible, planEventSlots, slotAges, dueSlot } from './events/runtime'
export type { EffectSpec, OptionSpec, OutcomeSpec, EventDef } from './events/types'
export { summarize, LEGENDS } from './summary'
export { AWARD_NAMES, totalsOf, deltaBucket, qualityFactor, clubBoost } from './season'
export {
  marketValue,
  valueFromCurve,
  ageValueFactor,
  leagueValueFactor,
  roleFromDelta,
  shiftRole,
  predictRole,
  rollCycle,
  cycleTarget,
} from './player'
export { academyClubs, transferOffers, loanClubs, nonRenewalClubs, locationWeights } from './offers'
export {
  formatMoney,
  roleLabel,
  roleShortLabel,
  positionGroup,
  rateRole,
  POSITION_NAMES,
  clubArticle,
  withArticle,
} from './util'
export {
  PACES,
  INJURIES,
  DEV_TABLES,
  VALUE_CURVE,
  APP_SHARE,
  START_AGE,
  START_OVR,
  START_SEASON,
  START_VALUE,
  RETIREMENT_AGE,
  ENGINE_VERSION,
} from './constants'
export type { CareerMemory } from './memory'

/** Memória interna do motor (somente leitura para ferramentas de depuração). */
export function careerMemory(state: CareerState) {
  return mem(state)
}

/**
 * Troca a decisão pendente por um evento específico (depuração/testes).
 * Devolve null se o evento não puder ser montado nesse estado.
 */
export function withPendingEvent(data: GameData, state: CareerState, key: string, variant?: string): CareerState | null {
  const s = cloneState(state)
  const d = forceEventDecision(data, s, key, variant)
  if (!d) return null
  s.pendingDecision = d
  return s
}
