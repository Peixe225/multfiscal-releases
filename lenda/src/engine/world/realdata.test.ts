/**
 * Smoke test com os dados REAIS (src/data/generated/game-data.json). Pulado se o JSON não existir.
 * Imprime um resumo legível da temporada 2026.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { UserSeasonContext } from '../api'
import type { GameData } from '../types'
import { worldEngine } from './index'

const path = fileURLToPath(new URL('../../data/generated/game-data.json', import.meta.url))
const hasData = existsSync(path)
const NO_USER: UserSeasonContext = { clubId: null, nationalTeam: null, clubStrengthBoost: 0, nationalStrengthBoost: 0 }

describe.skipIf(!hasData)('dados reais', () => {
  const data = (hasData ? JSON.parse(readFileSync(path, 'utf8')) : null) as GameData
  const name = (id: string | undefined) => (id && data.clubs.find((c) => c.id === id)?.shortName) || id || '—'

  it('temporada 2026 completa + resumo legível', () => {
    let t = performance.now()
    const w0 = worldEngine.createWorld(data, 'lenda-smoke')
    const createMs = performance.now() - t
    t = performance.now()
    const { world, result } = worldEngine.simulateSeason(data, w0, NO_USER)
    const seasonMs = performance.now() - t
    const { awards } = worldEngine.computeAwards(data, world, result.season, null)

    const L = result.leagues
    const C = result.cups
    const bra = L['bra.1']
    const lines = [
      `createWorld ${createMs.toFixed(0)} ms · simulateSeason(2026) ${seasonMs.toFixed(0)} ms`,
      `Brasileirão 2026 — campeão: ${name(bra.champion)}`,
      ...bra.table.slice(0, 6).map((r, i) => `  ${i + 1}. ${name(r.clubId)} ${r.points} pts (${r.won}V ${r.drawn}E ${r.lost}D, ${r.gf}:${r.ga})`),
      `  Rebaixados: ${bra.relegated.map(name).join(', ')}`,
      `  Artilharia: ${bra.topScorers.map((s) => `${s.name} (${name(s.clubId)}) ${s.goals}`).join(' · ')}`,
      `Série B — sobem: ${L['bra.2'].promoted.map(name).join(', ')}`,
      `Libertadores 2026: ${name(C['conmebol.libertadores']?.winner)} (vice ${name(C['conmebol.libertadores']?.runnerUp)})`,
      `Sul-Americana 2026: ${name(C['conmebol.sudamericana']?.winner)} (vice ${name(C['conmebol.sudamericana']?.runnerUp)})`,
      `Copa do Brasil 2026: ${name(C['bra.copa_do_brazil']?.winner)} (vice ${name(C['bra.copa_do_brazil']?.runnerUp)})`,
      `Champions 2026/27: ${name(C['uefa.champions']?.winner)} (vice ${name(C['uefa.champions']?.runnerUp)})`,
      `Liga Europa 2026/27: ${name(C['uefa.europa']?.winner)} · Conference: ${name(C['uefa.europa.conf']?.winner)}`,
      `Intercontinental 2026: ${name(C['fifa.intercontinental_cup']?.winner)}`,
      `Premier League: ${name(L['eng.1']?.champion)} · LaLiga: ${name(L['esp.1']?.champion)} · Serie A: ${name(L['ita.1']?.champion)} · Bundesliga: ${name(L['ger.1']?.champion)} · Ligue 1: ${name(L['fra.1']?.champion)}`,
      `Torneios de seleções (2027): ${Object.values(result.national).map((t) => `${t.competitionId} → ${t.winner}`).join(' · ')}`,
      `Bola de Ouro 2027 (top 5): ${awards.find((a) => a.award === 'ballon_dor')!.ranking.slice(0, 5).map((e, i) => `${i + 1}. ${e.name} (${name(e.clubId)}) ${e.score}`).join(' · ')}`,
    ]
    console.log('\n' + lines.join('\n') + '\n')

    expect(bra.table).toHaveLength(20)
    for (const r of bra.table) expect(r.played).toBe(38)
    expect(bra.relegated).toHaveLength(4)
    expect(L['bra.2'].promoted).toHaveLength(4)
    // campeões da 1ª temporada saem das edições reais em andamento
    expect(data.cupsInProgress['conmebol.libertadores'].alive).toContain(C['conmebol.libertadores'].winner)
    expect(data.cupsInProgress['conmebol.sudamericana'].alive).toContain(C['conmebol.sudamericana'].winner)
    expect(data.cupsInProgress['bra.copa_do_brazil'].alive).toContain(C['bra.copa_do_brazil'].winner)
    expect(data.cupsInProgress['uefa.champions'].alive).toContain(C['uefa.champions'].winner)
    expect(C['uefa.champions'].groups![0].table).toHaveLength(36)
    expect(createMs).toBeLessThan(200)
    expect(seasonMs).toBeLessThan(400) // 1ª execução inclui aquecimento do JIT; ver o teste de desempenho
  })

  it('desempenho: simulateSeason < 250 ms e 12 temporadas sem erro', () => {
    let w = worldEngine.createWorld(data, 'lenda-perf')
    const times: number[] = []
    for (let i = 0; i < 12; i++) {
      const t = performance.now()
      const r = worldEngine.simulateSeason(data, w, NO_USER)
      times.push(performance.now() - t)
      w = worldEngine.computeAwards(data, r.world, r.result.season, null).world
    }
    const avg = times.reduce((s, x) => s + x, 0) / times.length
    console.log(`simulateSeason (dados reais): média ${avg.toFixed(0)} ms, máx ${Math.max(...times).toFixed(0)} ms`)
    expect(avg).toBeLessThan(250)
    expect(Math.max(...times.slice(1))).toBeLessThan(250)
    // mundo compacto: tamanho médio por temporada guardada
    const perSeason = JSON.stringify(w.seasons).length / 1024 / Object.keys(w.seasons).length
    console.log(`WorldState: ${(JSON.stringify(w).length / 1024).toFixed(0)} KB (${perSeason.toFixed(0)} KB por temporada)`)
    expect(perSeason).toBeLessThan(300)
  })
})
