import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createImmersiveEngine } from '.'
import type { GameData } from '../types'
const data = JSON.parse(readFileSync(new URL('../../data/generated/game-data.json', import.meta.url), 'utf8')) as GameData
describe('postura', () => {
  it('pedir a bola cria lances; poupar corta', () => {
    const eng = createImmersiveEngine()
    let s = eng.newCareer(data, { surname: 'Teste', number: 9, foot: 'right', nationality: 'BRA', position: 'CA' }, 'post-1')
    // resolve a oferta da base e anda até uma partida com o jogador titular
    let guard = 0
    const counts: Record<string, number[]> = { ataque: [], equilibrada: [], poupar: [] }
    while (guard++ < 4000 && counts.ataque.length + counts.equilibrada.length + counts.poupar.length < 18) {
      const nx = eng.nextItem(s)
      if (!s.pendingDecision && !s.press && nx && nx.kind === 'match') {
        const k = (['ataque', 'equilibrada', 'poupar'] as const)[guard % 3]
                s = eng.dispatch(data, s, { type: 'match_start', posture: k }).state
        let moments = 0
        let g2 = 0
        while (s.live && s.live.phase !== 'full_time' && g2++ < 200) {
          if (s.live.pendingMoment) { moments++; s = eng.dispatch(data, s, { type: 'match_choose', optionId: s.live.pendingMoment.options[0].id, minigame: s.live.pendingMoment.minigame === 'timing' ? { timing: 0.5 } : s.live.pendingMoment.minigame ? { side: 'left' } : undefined }).state }
          else s = eng.dispatch(data, s, { type: 'match_sim' }).state
        }
        if (s.live?.userStatus === 'starter') counts[k].push(moments)
        s = eng.dispatch(data, s, { type: 'match_finish' }).state
        continue
      }
      if (s.pendingDecision) s = eng.dispatch(data, s, { type: 'decision_choose', optionId: s.pendingDecision.options[0].id }).state
      else if (s.press?.length) s = eng.dispatch(data, s, { type: 'press_answer', questionId: s.press[0].id, answerId: s.press[0].answers[0].id }).state
      else s = eng.dispatch(data, s, { type: 'advance' }).state
    }
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)

    expect(counts.ataque.length).toBeGreaterThan(2)
    expect(counts.poupar.length).toBeGreaterThan(2)
    expect(avg(counts.ataque)).toBeGreaterThan(avg(counts.poupar))
  }, 240000)
})
