/**
 * Reveal timeline state (module store, shared by every cockpit piece).
 *
 * Phases follow Copero's post-decision choreography (ref-content-2 §5), after an optional
 * "outcome" pre-roll (probability roulette 2500 ms · penalty minigame 2010 ms):
 *
 *   idle → choosing → outcome? → metrics 0 → identity 300 → history 650 → stats 850 → trophies 1150
 *        → (celebrating: overlay, timeline paused) → overall 1500 → postOverall 2400 → complete 3200 → idle
 *
 * `reached(p)` is true once the timeline passed `p` (and always true when idle: no reveal = show all).
 */
import { create } from 'zustand'
import type { Decision } from '@/engine/types'
import type { CelebrationItem } from '@/ui/classic/celebration/items'

export type RevealPhase =
  | 'idle'
  | 'choosing'
  | 'outcome'
  | 'metrics'
  | 'identity'
  | 'history'
  | 'stats'
  | 'trophies'
  | 'celebrating'
  | 'overall'
  | 'postOverall'
  | 'complete'

export const PHASE_ORDER: Record<RevealPhase, number> = {
  choosing: 0,
  outcome: 1,
  metrics: 2,
  identity: 3,
  history: 4,
  stats: 5,
  trophies: 6,
  celebrating: 7,
  overall: 8,
  postOverall: 9,
  complete: 10,
  idle: 99,
}

/** Copero `nc` (ms after the outcome pre-roll). */
export const PHASE_AT = { metrics: 0, identity: 300, history: 650, stats: 850, trophies: 1150, overall: 1500, postOverall: 2400, complete: 3200 } as const
/** Roulette: flip every 200 ms for 1000 ms, then hold until 2500 ms (Copero `ac`). */
export const ROULETTE = { flip: 200, spin: 1000, total: 2500 } as const
/** Penalty minigame pre-roll (Copero `rc`). */
export const PENALTY_TOTAL = 2010
/** Celebration auto-dismiss (Copero `Hc`), counted after the entrance. */
export const CELEBRATION_HOLD = 1800

export type Side = 'left' | 'center' | 'right'

export interface RevealStore {
  runId: number
  phase: RevealPhase
  /** Option picked (set on click, before the engine answers). */
  chosenId: string | null
  /** Decision being resolved (frozen: the store already moved on to the next one). */
  decision: Decision | null
  /** Keyboard highlight (1–4 · arrows), confirmed with Enter. */
  focusIdx: number | null
  /** Penalty: corner the user aimed at. */
  penaltySide: Side | null
  /** Roulette: chip lit during the spin, and whether it settled on the result. */
  spinIdx: number | null
  settled: boolean
  /** Outcome pre-roll kind for this run. */
  outcome: 'none' | 'roulette' | 'penalty'
  celebration: CelebrationItem[] | null
  celebrationOpen: boolean
  /** Mobile sheet collapsed by the user (or by the reveal). */
  sheetCollapsed: boolean
  set(p: Partial<RevealStore>): void
}

export const useReveal = create<RevealStore>()((set) => ({
  runId: 0,
  phase: 'idle',
  chosenId: null,
  decision: null,
  focusIdx: null,
  penaltySide: null,
  spinIdx: null,
  settled: false,
  outcome: 'none',
  celebration: null,
  celebrationOpen: false,
  sheetCollapsed: false,
  set: (p) => set(p),
}))

export const reachedIn = (phase: RevealPhase, target: RevealPhase) => PHASE_ORDER[phase] >= PHASE_ORDER[target]

/** Subscribe to "has the timeline reached `target`?" (re-renders only when the answer flips). */
export function useReached(target: RevealPhase): boolean {
  return useReveal((s) => reachedIn(s.phase, target))
}

export const isRevealing = (phase: RevealPhase) => phase !== 'idle'
