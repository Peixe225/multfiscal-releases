/**
 * Hall das Lendas — ponte entre o store (HallEntry[]) e o motor de legado (src/engine/legacy).
 *
 *   const hall = useHallModel()        // HallEvaluation + entryById, memoizado
 *   hallEntryToRun(entry)              // HallEntry → RunInput
 */
import { useMemo } from 'react'
import type { CareerState } from '@/engine/types'
import { evaluateHall, type HallEvaluation, type RunInput, type RunLegacy } from '@/engine/legacy'
import { useCareer, type HallEntry } from '@/store/career'
import { useData } from '@/store/data'

export function hallEntryToRun(h: HallEntry, leagueTier?: RunInput['leagueTier']): RunInput {
  return {
    id: h.id,
    runNo: h.runNo,
    finishedAt: h.finishedAt,
    identity: h.identity,
    seasons: h.career.seasons ?? [],
    national: h.career.national,
    summary: h.summary,
    leagueTier,
  }
}

export function careerToRun(c: CareerState | Omit<CareerState, 'world'>, runNo?: number): RunInput {
  return { id: c.id, runNo, identity: c.identity, seasons: c.seasons ?? [], national: c.national }
}

export interface HallModel extends HallEvaluation {
  entryById: Map<string, HallEntry>
  runById: Map<string, RunLegacy>
}

export function useHallModel(): HallModel {
  const list = useCareer((s) => s.finishedCareers)
  const leagues = useData((s) => s.data?.leagues)
  return useMemo(() => {
    // só usado por runs sem temporadas (resumos antigos): divisão da liga de cada troféu
    const tiers = new Map((leagues ?? []).map((l) => [l.trophyId, l.tier]))
    const leagueTier = leagues ? (id: string) => tiers.get(id) : undefined
    const ev = evaluateHall(list.map((h) => hallEntryToRun(h, leagueTier)))
    return { ...ev, entryById: new Map(list.map((h) => [h.id, h])), runById: new Map(ev.runs.map((r) => [r.id, r])) }
  }, [list, leagues])
}

/** "2004–" / "1956–1977". */
export const yearsLabel = (y: [number, number | null]) => `${y[0]}–${y[1] ?? ''}`

/** "falta 1 ponto" · "faltam 4 pontos" · "por décimos" (mesma nota arredondada). */
export const gapText = (gap: number) => (gap <= 0 ? 'por décimos' : gap === 1 ? 'falta 1 ponto' : `faltam ${gap} pontos`)
