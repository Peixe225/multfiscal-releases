/**
 * What the cockpit shows right now: the career store already holds the NEXT state while a
 * reveal plays, so every piece reads these gates to decide between "before" and "after".
 */
import { useMemo } from 'react'
import type { CareerState, SeasonRecord } from '@/engine/types'
import { useCareer } from '@/store/career'
import { useReveal, reachedIn } from '@/ui/classic/reveal/store'

export interface RevealGates {
  /** A reveal is running (store has previous + reveal). */
  revealing: boolean
  identity: boolean
  history: boolean
  stats: boolean
  /** Trophy icons may appear (phase ≥ trophies and the overlay is closed). */
  trophies: boolean
  overall: boolean
  postOverall: boolean
}

const ALL: RevealGates = { revealing: false, identity: true, history: true, stats: true, trophies: true, overall: true, postOverall: true }

export function useGates(): RevealGates {
  const hasReveal = useCareer((s) => !!s.reveal && !!s.previous)
  const phase = useReveal((s) => s.phase)
  const open = useReveal((s) => s.celebrationOpen)
  return useMemo(() => {
    if (!hasReveal || phase === 'idle') return ALL
    return {
      revealing: true,
      identity: reachedIn(phase, 'identity'),
      history: reachedIn(phase, 'history'),
      stats: reachedIn(phase, 'stats'),
      trophies: reachedIn(phase, 'trophies') && !open,
      overall: reachedIn(phase, 'overall'),
      postOverall: reachedIn(phase, 'postOverall'),
    }
  }, [hasReveal, phase, open])
}

export interface CockpitData {
  state: CareerState
  previous: CareerState | null
  /** Seasons added by the running reveal. */
  newSeasons: Set<number>
  /** Seasons whose content is visible (before `identity` the new ones are hidden). */
  visibleSeasons: SeasonRecord[]
  /** Seasons whose trophies are visible (gated by the celebration). */
  trophySeasons: SeasonRecord[]
  /** Seasons counted in totals (stats phase). */
  statSeasons: SeasonRecord[]
  gates: RevealGates
}

export function useCockpitData(): CockpitData | null {
  const state = useCareer((s) => s.state)
  const previous = useCareer((s) => s.previous)
  const reveal = useCareer((s) => s.reveal)
  const gates = useGates()
  return useMemo(() => {
    if (!state) return null
    const newSeasons = new Set<number>(gates.revealing && reveal ? reveal.seasons.map((r) => r.season) : [])
    const old = state.seasons.filter((r) => !newSeasons.has(r.season))
    return {
      state,
      previous: gates.revealing ? previous : null,
      newSeasons,
      visibleSeasons: gates.identity ? state.seasons : old,
      trophySeasons: gates.trophies ? state.seasons : old,
      statSeasons: gates.stats ? state.seasons : old,
      gates,
    }
  }, [state, previous, reveal, gates])
}
