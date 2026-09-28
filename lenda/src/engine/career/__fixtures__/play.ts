/** Helpers de teste: joga carreiras inteiras com uma política de escolha. */
import type { RevealScript } from '../../api'
import { rng } from '../../rng'
import type { CareerState, Decision, Pace, PlayerIdentity, Position } from '../../types'
import { createCareerEngine } from '../engine'
import { fakeData } from './fakeData'
import { createFakeWorld } from './fakeWorld'

export const world = createFakeWorld()
export const engine = createCareerEngine(world)
export const data = fakeData()

export function identity(position: Position = 'CA', nationality = 'BRA'): PlayerIdentity {
  return { surname: 'Silva', number: 9, foot: 'right', nationality, position }
}

export type Policy = (d: Decision, s: CareerState, step: number) => string

/** Escolha aleatória reprodutível (evita aposentar cedo, a menos que seja a única opção). */
export function randomPolicy(seed: string): Policy {
  return (d, s, step) => {
    const r = rng(seed, 'policy', step)
    const opts = d.options.filter((o) => !o.id.startsWith('retire-'))
    return (opts.length ? r.pick(opts) : d.options[0]).id
  }
}

export function playCareer(seed: string, pace: Pace, policy: Policy = randomPolicy(seed), id: PlayerIdentity = identity()) {
  let state = engine.newCareer(data, id, pace, seed)
  const reveals: RevealScript[] = []
  const decisions: Decision[] = []
  for (let step = 0; step < 200 && !state.retired; step++) {
    const d = state.pendingDecision!
    decisions.push(d)
    const out = engine.choose(data, state, policy(d, state, step))
    reveals.push(out.reveal)
    state = out.state
  }
  return { state, reveals, decisions }
}
