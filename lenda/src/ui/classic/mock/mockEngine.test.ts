import { describe, expect, it } from 'vitest'
import type { DecisionKind } from '@/engine/types'
import { mockGameData } from './mockData'
import { createMockEngine } from './mockEngine'
import { careerEnd, careerMid, sampleReveal } from './fixtures'
import { rng } from '@/engine/rng'

describe('mock engine', () => {
  it('plays full careers and covers every decision kind', () => {
    const engine = createMockEngine()
    const kinds = new Set<DecisionKind>()
    for (let i = 0; i < 40; i++) {
      const pace = (['intensa', 'normal', 'expressa'] as const)[i % 3]
      let s = engine.newCareer(mockGameData, { surname: 'TESTE', number: 10, foot: 'left', nationality: i % 4 ? 'BRA' : 'ESP', position: i % 5 ? 'CA' : 'GOL' }, pace, `seed-${i}`)
      const r = rng('pick', i)
      for (let g = 0; g < 60 && s.phase !== 'finished'; g++) {
        const d = s.pendingDecision!
        kinds.add(d.kind)
        expect(d.options.length).toBeGreaterThan(0)
        const { state, reveal } = engine.choose(mockGameData, s, r.pick(d.options).id)
        expect(reveal.ovrAfter).toBeGreaterThanOrEqual(40)
        s = state
      }
      expect(s.phase).toBe('finished')
      expect(s.age).toBeLessThanOrEqual(40)
      const sum = engine.summarize(mockGameData, s)
      expect(sum.seasons).toBe(s.seasons.length)
    }
    const all: DecisionKind[] = ['academy', 'transfer', 'loan', 'loan_return', 'non_renewal', 'event', 'injury', 'club_priority', 'national_call', 'contract', 'retirement']
    for (const k of all) expect(kinds.has(k), k).toBe(true)
  })

  it('is deterministic per seed', () => {
    const a = createMockEngine()
    const b = createMockEngine()
    const id = { surname: 'X', number: 9, foot: 'right' as const, nationality: 'BRA', position: 'CA' as const }
    let s1 = a.newCareer(mockGameData, id, 'normal', 'det')
    let s2 = b.newCareer(mockGameData, id, 'normal', 'det')
    for (let i = 0; i < 5; i++) {
      s1 = a.choose(mockGameData, s1, s1.pendingDecision!.options[0].id).state
      s2 = b.choose(mockGameData, s2, s2.pendingDecision!.options[0].id).state
    }
    expect(s1.seasons.map((x) => x.ovrEnd)).toEqual(s2.seasons.map((x) => x.ovrEnd))
  })

  it('fixtures', () => {
    const mid = careerMid()
    expect(mid.seasons).toHaveLength(10)
    expect(mid.age).toBe(26)
    expect(mid.pendingDecision?.kind).toBe('transfer')
    expect(mid.seasons.reduce((a, x) => a + x.trophies.length, 0)).toBe(8)
    expect(mid.seasons.reduce((a, x) => a + x.stats.apps, 0)).toBe(321)
    expect(mid.seasons.reduce((a, x) => a + x.stats.goals, 0)).toBe(147)
    const end = careerEnd()
    expect(end.phase).toBe('finished')
    expect(end.retired).toBe(true)
    expect(end.seasons[end.seasons.length - 1].age).toBe(39)
    expect(end.retiredReason).toContain('39')
    const { reveal, state } = sampleReveal()
    expect(reveal.ovrAfter).toBe(90)
    expect(state.seasons).toHaveLength(12)
    expect(state.pendingDecision).toBeTruthy()
  })
})
