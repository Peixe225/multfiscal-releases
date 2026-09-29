/**
 * Equilíbrio de longo prazo (strength.ts): gigantes estruturais (prestígio acima da elite típica da
 * liga) têm força-base extra, voltam rápido à âncora e quase não sentem o ciclo negativo; só quem
 * sobra mais de `freeGap` sobre o 2º da liga (o PSG) tem o excedente comprimido; a 1ª temporada usa
 * a força real. Números de 30 temporadas × 48 seeds: harness de calibração no scratchpad (não versionado).
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { GameData, SeasonWorldResult } from '../types'
import { indexData } from './context'
import { EVOLVE, EVOLVE_NAT, baseStrength, clubAnchor, clubCycle, evolveNations, giantness, topTalent } from './strength'
import { worldEngine } from './index'

const path = fileURLToPath(new URL('../../data/generated/game-data.json', import.meta.url))
const hasData = existsSync(path)

describe.skipIf(!hasData)('strength · dados reais', () => {
  const data = (hasData ? JSON.parse(readFileSync(path, 'utf8')) : null) as GameData
  const ix = indexData(data)
  const top = (leagueId: string) => data.clubs.filter((c) => c.leagueId === leagueId).sort((a, b) => b.strength - a.strength)
  const club = (name: string) => data.clubs.find((c) => c.shortName === name)!
  const g = (name: string) => giantness(ix, club(name).id, club(name).prestige)

  it('só o líder isolado (PSG) é comprimido; o resto da liga fica com a força real', () => {
    const [psg, second, ...rest] = top('fra.1')
    const b = baseStrength(ix, psg.id)
    expect(b).toBeLessThan(psg.strength - 2)
    expect(b).toBeGreaterThan(second.strength + EVOLVE.freeGap)
    for (const c of [second, ...rest]) if (giantness(ix, c.id, c.prestige) === 0) expect(baseStrength(ix, c.id)).toBe(c.strength)
  })

  it('gigantes estruturais: Bayern acima do Dortmund, ligas de muitos grandes abertas', () => {
    expect(g('Bayern')).toBeGreaterThan(0.6)
    expect(g('Dortmund')).toBeGreaterThan(0)
    expect(g('Dortmund')).toBeLessThan(g('Bayern'))
    expect(g('Leverkusen')).toBe(0)
    // o Bayern não é comprimido e ganha força estrutural; o Leverkusen segue com a força real
    expect(baseStrength(ix, club('Bayern').id)).toBeGreaterThan(club('Bayern').strength + 1)
    expect(baseStrength(ix, club('Bayern').id) - baseStrength(ix, club('Dortmund').id)).toBeGreaterThan(4)
    expect(baseStrength(ix, club('Leverkusen').id)).toBe(club('Leverkusen').strength)
    for (const n of ['Real Madrid', 'Barcelona', 'Porto', 'Benfica', 'Celtic', 'Rangers', 'PSG']) expect(g(n)).toBeGreaterThanOrEqual(0.5)
    // Premier League e Brasileirão: muitos grandes do mesmo tamanho, ninguém é "o" gigante
    for (const l of ['eng.1', 'bra.1']) for (const c of top(l)) expect(giantness(ix, c.id, c.prestige)).toBeLessThanOrEqual(0.25)
  })

  it('o gigante atravessa a fase ruim do ciclo quase sem tombo; o emergente sente tudo', () => {
    const bayern = club('Bayern')
    const lev = club('Leverkusen')
    let negatives = 0
    for (let s = 2027; s < 2060; s++) {
      for (const c of [bayern, lev]) {
        const dyn = { strength: c.strength, leagueId: c.leagueId, prestige: c.prestige }
        const cyc = clubCycle('damp', c.id, s, ix.firstSeason)
        const got = clubAnchor(ix, c.id, dyn, s, 'damp') - clubAnchor(ix, c.id, dyn, s)
        const gg = giantness(ix, c.id, c.prestige)
        expect(got).toBeCloseTo(cyc < 0 ? cyc * (1 - EVOLVE.giantDamp * gg) : cyc, 9)
        if (cyc < 0 && c === bayern) negatives++
      }
    }
    expect(negatives).toBeGreaterThan(0)
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

  it('hegemonias reais: Bayern e PSG ganham a maioria, sem jejum longo; o Brasileirão segue aberto', () => {
    let w = worldEngine.createWorld(data, 'hegemonia')
    const ctx = { clubId: null, nationalTeam: null, clubStrengthBoost: 0, nationalStrengthBoost: 0 }
    const champs: Record<string, string[]> = { 'ger.1': [], 'fra.1': [], 'bra.1': [] }
    for (let i = 0; i < 20; i++) {
      const r = worldEngine.simulateSeason(data, w, ctx)
      w = r.world
      for (const k of Object.keys(champs)) champs[k].push(r.result.leagues[k].champion)
    }
    const share = (k: string, id: string) => champs[k].filter((x) => x === id).length / champs[k].length
    const drought = (k: string, id: string) => {
      let d = 0
      let cur = 0
      for (const x of champs[k]) d = Math.max(d, (cur = x === id ? 0 : cur + 1))
      return d
    }
    expect(share('ger.1', club('Bayern').id)).toBeGreaterThanOrEqual(0.5)
    expect(drought('ger.1', club('Bayern').id)).toBeLessThanOrEqual(5)
    expect(share('fra.1', club('PSG').id)).toBeGreaterThanOrEqual(0.5)
    expect(new Set(champs['bra.1']).size).toBeGreaterThanOrEqual(4)
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
