import { describe, expect, it } from 'vitest'
import { Rng } from '../rng'
import { remainingSchedule, roundRobin, seasonSchedule, swissPairings } from './schedule'
import { newRow, sortTable } from './table'

const teams = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`)

describe('calendário', () => {
  it('pontos corridos (2 turnos): todos contra todos, ida e volta, mando equilibrado', () => {
    for (const n of [4, 10, 19, 20]) {
      const days = roundRobin(teams(n), 2, new Rng('rr'))
      const games = days.flat()
      expect(games.length).toBe(n * (n - 1))
      const pairs = new Map<string, number>()
      const homes = new Map<string, number>()
      for (const [h, a] of games) {
        pairs.set(`${h}|${a}`, (pairs.get(`${h}|${a}`) ?? 0) + 1)
        homes.set(h, (homes.get(h) ?? 0) + 1)
      }
      for (const v of pairs.values()) expect(v).toBe(1)
      for (const t of teams(n)) expect(homes.get(t)).toBe(n - 1)
      // cada rodada: ninguém joga duas vezes
      for (const d of days) {
        const seen = new Set<string>()
        for (const [h, a] of d) {
          expect(seen.has(h) || seen.has(a)).toBe(false)
          seen.add(h)
          seen.add(a)
        }
      }
    }
  })

  it('turno único e 3 turnos', () => {
    const one = roundRobin(teams(12), 1).flat()
    expect(one.length).toBe(66)
    const three = roundRobin(teams(12), 3).flat()
    expect(three.length).toBe(198)
  })

  it('temporada com alvo de jogos por clube (zonas + interzonais)', () => {
    const ids = teams(28)
    const groups = new Map(ids.map((t, i) => [t, i % 2 ? 'B' : 'A'] as const))
    const games = seasonSchedule(ids, 1, new Rng('s'), 16, groups)
    const count = new Map<string, number>()
    for (const [h, a] of games) {
      count.set(h, (count.get(h) ?? 0) + 1)
      count.set(a, (count.get(a) ?? 0) + 1)
    }
    for (const t of ids) expect(count.get(t)).toBe(16)
  })

  it('continuação: jogos reais restantes + complemento até o total', () => {
    const ids = teams(20)
    const rows = ids.map((id, i) => ({ ...newRow(id), played: i % 3 === 0 ? 27 : 28 }))
    const real = [
      { home: 't0', away: 't1' },
      { home: 't2', away: 't3', score: [1, 0] as [number, number] }, // já jogado: ignorado
      { home: 't4', away: 'desconhecido' },
    ]
    const games = remainingSchedule(rows, real, 38, new Rng('c'), false)
    const count = new Map(rows.map((r) => [r.clubId, r.played] as const))
    for (const [h, a] of games) {
      count.set(h, count.get(h)! + 1)
      count.set(a, count.get(a)! + 1)
    }
    expect(games[0]).toEqual(['t0', 't1'])
    for (const t of ids) expect(count.get(t)).toBeGreaterThanOrEqual(37)
    for (const t of ids) expect(count.get(t)).toBeLessThanOrEqual(38)
  })

  it('fase suíça: 8 jogos por clube, adversários distintos', () => {
    const ids = teams(36)
    const games = swissPairings(ids, 8, new Rng('sw'))
    expect(games.length).toBe(144)
    const opp = new Map<string, Set<string>>()
    for (const [h, a] of games) {
      if (!opp.has(h)) opp.set(h, new Set())
      if (!opp.has(a)) opp.set(a, new Set())
      opp.get(h)!.add(a)
      opp.get(a)!.add(h)
    }
    for (const t of ids) expect(opp.get(t)!.size).toBe(8)
  })

  it('desempate: pontos, vitórias, saldo, gols pró', () => {
    const r = (id: string, p: number, w: number, gf: number, ga: number) => ({ ...newRow(id), points: p, won: w, gf, ga, played: 10 })
    const t = sortTable([r('a', 20, 5, 10, 5), r('b', 20, 6, 8, 8), r('c', 20, 5, 12, 7), r('d', 21, 5, 1, 9)])
    expect(t.map((x) => x.clubId)).toEqual(['d', 'b', 'c', 'a'])
  })
})
