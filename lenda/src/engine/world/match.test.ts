import { describe, expect, it } from 'vitest'
import { Rng } from '../rng'
import { expectedGoals, penaltyShootout, simulateMatch, simulateTwoLegs } from './match'

describe('modelo de partida', () => {
  it('liga: 2,5–2,8 gols por jogo e 24–28% de empates', () => {
    const rng = new Rng('m1')
    let goals = 0
    let draws = 0
    const n = 60000
    for (let i = 0; i < n; i++) {
      const a = 75 + rng.normal(0, 5)
      const b = 75 + rng.normal(0, 5)
      const m = simulateMatch(a, b, rng)
      goals += m.score[0] + m.score[1]
      if (m.score[0] === m.score[1]) draws++
    }
    expect(goals / n).toBeGreaterThan(2.5)
    expect(goals / n).toBeLessThan(2.8)
    expect(draws / n).toBeGreaterThan(0.24)
    expect(draws / n).toBeLessThan(0.28)
  })

  it('10 pontos de vantagem em casa ≈ 65–72% de vitórias', () => {
    const rng = new Rng('m2')
    let w = 0
    const n = 60000
    for (let i = 0; i < n; i++) if (simulateMatch(80, 70, rng).winner === 0) w++
    expect(w / n).toBeGreaterThan(0.65)
    expect(w / n).toBeLessThan(0.72)
  })

  it('mando de campo e simetria', () => {
    const [h, a] = expectedGoals(75, 75)
    expect(h).toBeGreaterThan(a)
    const [nh, na] = expectedGoals(75, 75, true)
    expect(nh).toBeCloseTo(na)
  })

  it('mata-mata sempre tem vencedor (prorrogação/pênaltis)', () => {
    const rng = new Rng('m3')
    let pens = 0
    for (let i = 0; i < 5000; i++) {
      const m = simulateMatch(75, 75, rng, { knockout: true, neutral: true })
      expect(m.winner === 0 || m.winner === 1).toBe(true)
      if (m.pens) {
        pens++
        expect(m.pens[0]).not.toBe(m.pens[1])
        expect(m.score[0]).toBe(m.score[1])
      }
    }
    expect(pens).toBeGreaterThan(300)
    const noEt = simulateMatch(75, 75, new Rng('x'), { knockout: true, extraTime: false })
    expect(noEt.winner).toBeDefined()
  })

  it('ida e volta: agregado coerente com o vencedor', () => {
    const rng = new Rng('m4')
    for (let i = 0; i < 2000; i++) {
      const t = simulateTwoLegs(78, 72, rng)
      const [aa, bb] = t.aggregate
      if (aa !== bb) expect(t.winner).toBe(aa > bb ? 'a' : 'b')
      else expect(t.legs[1].pens).toBeDefined()
    }
  })

  it('pênaltis nunca empatam', () => {
    const rng = new Rng('m5')
    for (let i = 0; i < 2000; i++) {
      const [a, b] = penaltyShootout(rng)
      expect(a).not.toBe(b)
    }
  })

  it('determinístico com a mesma semente', () => {
    const a = new Rng('same')
    const b = new Rng('same')
    for (let i = 0; i < 100; i++) expect(simulateMatch(70, 72, a)).toEqual(simulateMatch(70, 72, b))
  })
})
