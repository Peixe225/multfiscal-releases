import { describe, expect, it } from 'vitest'
import type { Decision } from '@/engine/types'
import { decisionRound } from './autopilot'

const eff = (p: number) => [{ label: 'Gol! Título', kind: 'positive' as const, probability: p }, { label: 'Defesa: fica com o vice', kind: 'negative' as const, probability: 1 - p }]

describe('decisionRound', () => {
  it('penalty: one vote option per corner, each mapped to its option + side', () => {
    const d = {
      id: 'pen1',
      kind: 'event',
      title: 'Pênalti decisivo',
      description: '',
      options: (['left', 'center', 'right'] as const).map((s, i) => ({ id: `penalty_final:${s}`, label: s, art: `penalty-${s}`, minigame: 'penalty' as const, effects: eff([0.7, 0.5, 0.72][i]) })),
    } as unknown as Decision
    const { spec, picks } = decisionRound(d)
    expect(spec.options.map((o) => o.label)).toEqual(['Canto esquerdo', 'No meio', 'Canto direito'])
    expect(spec.options[0].sub).toBe('70% de chance')
    expect(picks).toEqual([
      { optionId: 'penalty_final:left', side: 'left' },
      { optionId: 'penalty_final:center', side: 'center' },
      { optionId: 'penalty_final:right', side: 'right' },
    ])
    expect(spec.id).toBe('d:pen1')
  })
  it('regular decisions keep option order, use title/club name and cap at 4', () => {
    const d = {
      id: 'x',
      kind: 'transfer',
      title: 'Janela',
      description: '',
      options: [
        { id: 'a', label: 'Assinar com', title: 'Real Madrid', effects: [] },
        { id: 'b', label: 'Ficar no Palmeiras', effects: [] },
        { id: 'c', label: 'c', effects: [] },
        { id: 'd', label: 'd', effects: [] },
        { id: 'e', label: 'e', effects: [] },
      ],
    } as unknown as Decision
    const { spec, picks } = decisionRound(d)
    expect(spec.options.map((o) => o.label)).toEqual(['Real Madrid', 'Ficar no Palmeiras', 'c', 'd'])
    expect(spec.options[0].sub).toBe('Assinar com')
    expect(picks.map((p) => p.optionId)).toEqual(['a', 'b', 'c', 'd'])
  })
})
