/**
 * Equilíbrio de longo prazo (strength.ts): a base comprime só o excesso de quem sobra na liga de
 * origem, o ciclo do clube é determinístico e de média ~0, e a 1ª temporada usa a força real.
 * Números de 30 temporadas × vários seeds: harness de calibração no scratchpad (não versionado).
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { GameData, SeasonWorldResult } from '../types'
import { indexData } from './context'
import { EVOLVE, EVOLVE_NAT, baseStrength, clubCycle, evolveNations, topTalent } from './strength'
import { worldEngine } from './index'

const path = fileURLToPath(new URL('../../data/generated/game-data.json', import.meta.url))
const hasData = existsSync(path)

describe.skipIf(!hasData)('strength · dados reais', () => {
  const data = (hasData ? JSON.parse(readFileSync(path, 'utf8')) : null) as GameData
  const ix = indexData(data)
  const top = (leagueId: string) => data.clubs.filter((c) => c.leagueId === leagueId).sort((a, b) => b.strength - a.strength)

  it('comprime o gigante isolado e preserva quem tem rival à altura', () => {
    const [psg, ...rest] = top('fra.1')
    const ref = (rest[0].strength + rest[1].strength + rest[2].strength) / 3
    const b = baseStrength(ix, psg.id)
    expect(b).toBeLessThan(psg.strength)
    expect(b).toBeGreaterThan(ref + EVOLVE.freeGap - 1e-9)
    // do 2º colocado para baixo (na liga de origem) nada muda
    for (const c of rest.slice(0, 5)) expect(baseStrength(ix, c.id)).toBeLessThanOrEqual(c.strength)
    for (const c of rest.slice(3, 10)) expect(baseStrength(ix, c.id)).toBe(c.strength)
    // ligas com duelo equilibrado quase não mudam
    const [a] = top('esp.1')
    expect(a.strength - baseStrength(ix, a.id)).toBeLessThan(1.5)
  })

  it('ciclo do clube: determinístico, limitado e com média ~0', () => {
    const ids = data.clubs.slice(0, 300).map((c) => c.id)
    let sum = 0
    let n = 0
    for (const id of ids)
      for (let s = 2026; s < 2056; s++) {
        const v = clubCycle('seed-x', id, s, 2026)
        expect(Math.abs(v)).toBeLessThanOrEqual(2 * EVOLVE.cycleSd + 1e-9)
        sum += v
        n++
      }
    expect(Math.abs(sum / n)).toBeLessThan(0.3)
    expect(clubCycle('seed-x', ids[0], 2031, 2026)).toBe(clubCycle('seed-x', ids[0], 2031, 2026))
    expect(clubCycle('seed-x', ids[0], 2031, 2026)).not.toBe(clubCycle('seed-y', ids[0], 2031, 2026))
  })

  it('a 1ª temporada começa das forças reais', () => {
    const w = worldEngine.createWorld(data, 'strength-first')
    for (const c of data.clubs.slice(0, 200)) expect(w.clubs[c.id]?.strength).toBe(c.strength)
  })

  it('seleções: bi e tri custam mais que o 1º título (quebra sequências)', () => {
    const nations = Object.fromEntries(data.countries.map((c) => [c.code, c.strength]))
    const talent = topTalent(data.stars)
    const rivals = worldEngine.createWorld(data, 'nat-streak').rivals
    const euro = (season: number, winner: string) =>
      ({ season, leagues: {}, cups: {}, awards: [], national: { 'uefa.euro': { competitionId: 'uefa.euro', season, winner, runnerUp: 'FRA', groups: [], knockout: [], reached: {} } } }) as unknown as SeasonWorldResult
    const S = 2035
    const next = (past: Record<number, SeasonWorldResult>) => evolveNations(data, 'nat-streak', S, nations, euro(S, 'ESP'), talent, rivals, past).ESP
    const first = next({})
    const bi = next({ [S - 4]: euro(S - 4, 'ESP') })
    const tri = next({ [S - 4]: euro(S - 4, 'ESP'), [S - 8]: euro(S - 8, 'ESP') })
    expect(bi).toBeLessThan(first - EVOLVE_NAT.streakCost + 0.05)
    expect(tri).toBeLessThan(bi - 2 * EVOLVE_NAT.streakCost + 0.05)
    // Oceania: a Nova Zelândia não é "desgastada" por dominar a OFC
    const ofc = { season: S, leagues: {}, cups: {}, awards: [], national: { 'ofc.nations': { competitionId: 'ofc.nations', season: S, winner: 'NZL', runnerUp: 'FIJ', groups: [], knockout: [], reached: {} } } } as unknown as SeasonWorldResult
    const none = { ...ofc, national: {} } as SeasonWorldResult
    expect(evolveNations(data, 'nat-streak', S, nations, ofc, talent, rivals, { [S - 4]: ofc }).NZL).toBe(evolveNations(data, 'nat-streak', S, nations, none, talent, rivals, {}).NZL)
    // quem não ganhou nada não paga nada
    const fra = evolveNations(data, 'nat-streak', S, nations, euro(S, 'ESP'), talent, rivals, { [S - 4]: euro(S - 4, 'ESP') }).FRA
    expect(fra).toBe(evolveNations(data, 'nat-streak', S, nations, euro(S, 'ESP'), talent, rivals, {}).FRA)
  })
})
