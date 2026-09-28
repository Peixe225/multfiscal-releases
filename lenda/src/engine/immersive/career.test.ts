/** Carreira inteira no automático + números de desempenho (dados reais). */
import { cpus, loadavg } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type { GameData } from '../types'
import { worldEngine } from '../world'
import { careerAt, closeSeason, dispatch, E, hasRealData, identity, realData, toSeasonEnd, tweak } from './__fixtures__/helpers'
import { attributesFor } from './index'
import type { ImmersiveAction, ImmersiveState } from './types'

// simulações pesadas: margem para máquinas carregadas (CI, vários agentes)
vi.setConfig({ testTimeout: 120_000 })

/**
 * Limites de tempo relativos à carga da máquina (load average ÷ núcleos, mín. 1): com vários
 * processos disputando a CPU os números absolutos sobem sem que o motor tenha piorado.
 * `LENDA_PERF_STRICT=1` força os limites absolutos.
 */
const loadFactor = process.env.LENDA_PERF_STRICT ? 1 : Math.max(1, loadavg()[0] / Math.max(1, cpus().length))

describe.skipIf(!hasRealData)('carreira imersiva', () => {
  const data = hasRealData ? realData() : (null as unknown as GameData)

  it('24 temporadas no automático até a aposentadoria, sem erros', { timeout: 300000 }, () => {
    const t0 = performance.now()
    let s = E.newCareer(data, identity('MEI'), 'career-24')
    for (let i = 0; i < 100 && !s.retired; i++) s = dispatch(data, s, { type: 'auto', until: 'retirement', maxSteps: 4000 }).state
    const secs = (performance.now() - t0) / 1000
    expect(s.retired).toBe(true)
    expect(s.retiredReason).toBe('retirement_age')
    expect(s.age).toBe(40)
    expect(s.seasons).toHaveLength(24)
    expect(s.seasons.map((r) => r.age)).toEqual(Array.from({ length: 24 }, (_, i) => 16 + i))
    expect(s.seasons.map((r) => r.season)).toEqual(Array.from({ length: 24 }, (_, i) => 2026 + i))
    const peak = Math.max(...s.seasons.map((r) => r.ovrEnd))
    expect(peak).toBeGreaterThanOrEqual(62)
    const apps = s.seasons.reduce((t, r) => t + r.stats.apps, 0)
    expect(apps).toBeGreaterThan(300)
    for (const r of s.seasons) {
      expect(r.clubId).toBeTruthy()
      expect(r.stats.rating === 0 || (r.stats.rating >= 4 && r.stats.rating <= 9.5)).toBe(true)
    }
    const sum = E.summarize!(data, s)
    expect(sum.seasons).toBe(24)
    expect(sum.totals.apps).toBeGreaterThan(300)
    const { world, ...rest } = s
    const bytes = JSON.stringify(rest).length
    console.log(
      `carreira MEI: ${secs.toFixed(1)} s · pico OVR ${peak} · ${sum.totals.apps} jogos, ${sum.totals.goals} gols, ${sum.totals.assists} assist. · ${s.trophies.length} títulos · ${s.achievements.length} conquistas · estado ${(bytes / 1024).toFixed(0)} KB + mundo ${(JSON.stringify(world).length / 1024).toFixed(0)} KB · "${sum.headline}"`,
    )
    expect(bytes).toBeLessThan(1_000_000)
    // dispatch continua funcionando (no-op) depois da aposentadoria
    expect(dispatch(data, s, { type: 'advance' }).state.retired).toBe(true)
  })

  it('desempenho: pré-simulação < 200 ms e dispatch típico < 30 ms', { timeout: 120000 }, () => {
    const w = worldEngine.createWorld(data, 'perf')
    const pal = data.clubs.find((c) => c.name === 'Palmeiras')!
    worldEngine.simulateSeason(data, w, { clubId: pal.id, nationalTeam: 'BRA', clubStrengthBoost: 0, nationalStrengthBoost: 0, collectUserFixtures: true })
    const pre: number[] = []
    const full: number[] = []
    for (let i = 0; i < 5; i++) {
      let t = performance.now()
      worldEngine.simulateSeason(data, w, { clubId: pal.id, nationalTeam: 'BRA', clubStrengthBoost: 0, nationalStrengthBoost: 0, collectUserFixtures: true, agendaOnly: true, fixedResults: {} })
      pre.push(performance.now() - t)
      t = performance.now()
      worldEngine.simulateSeason(data, w, { clubId: pal.id, nationalTeam: 'BRA', clubStrengthBoost: 0, nationalStrengthBoost: 0, fixedResults: {} })
      full.push(performance.now() - t)
    }
    const preAvg = pre.reduce((a, b) => a + b, 0) / pre.length
    const fullAvg = full.reduce((a, b) => a + b, 0) / full.length

    // uma temporada completa jogada "à mão" (sem o atalho auto) por um titular, medindo cada dispatch
    let s: ImmersiveState = careerAt(data, 'perf-1', data.clubs.find((c) => c.shortName === 'Bahia')!.id)
    s = toSeasonEnd(data, s)
    s = closeSeason(data, s).state
    s = tweak(s, (x) => {
      x.age = 23
      x.attributes = attributesFor('CA', 77)
      x.ovr = 77
      x.relationships.coach = 75
    })
    const times: Record<string, number[]> = {}
    const run = (a: ImmersiveAction) => {
      const t = performance.now()
      const r = dispatch(data, s, a)
      ;(times[a.type] ??= []).push(performance.now() - t)
      s = r.state
      return r
    }
    const sample: string[] = []
    for (let i = 0; i < 6000 && s.season === 2027 && !s.retired; i++) {
      const it = s.calendar[s.cursor]
      if (s.pendingDecision) run({ type: 'decision_choose', optionId: s.pendingDecision.options[0].id })
      else if (s.press) run({ type: 'press_answer', questionId: s.press[0].id, answerId: s.press[0].answers[0].id })
      else if (s.live) {
        const km = s.live.pendingMoment
        if (km) run({ type: 'match_choose', optionId: km.options[0].id, minigame: { side: 'left', timing: 0.6 } })
        else if (s.live.phase === 'full_time') {
          const r = run({ type: 'match_finish' })
          const toast = r.effects.find((e) => e.type === 'toast')
          if (toast && toast.type === 'toast' && sample.length < 14 && (sample.length < 10 || it?.competitionId !== s.leagueId)) sample.push(`${it?.title}: ${toast.title}${toast.description ? ` (${toast.description})` : ''}`)
        } else if (s.live.phase === 'pre') run({ type: 'match_start' })
        else run({ type: 'match_sim' })
      } else if (it?.kind === 'training') run({ type: 'train', focus: 'finishing', intensity: 'normal' })
      else run({ type: 'advance' })
    }
    const all = Object.values(times).flat().sort((a, b) => a - b)
    const p50 = all[Math.floor(all.length * 0.5)]
    const p90 = all[Math.floor(all.length * 0.9)]
    const lines = Object.entries(times).map(([k, v]) => `${k} ×${v.length} méd ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)} ms máx ${Math.max(...v).toFixed(0)} ms`)
    console.log(`pré-simulação da agenda: média ${preAvg.toFixed(0)} ms · máx ${Math.max(...pre).toFixed(0)} ms · temporada completa (consolidação): média ${fullAvg.toFixed(0)} ms`)
    console.log(`dispatch: ${all.length} ações · p50 ${p50.toFixed(1)} ms · p90 ${p90.toFixed(1)} ms · máx ${all[all.length - 1].toFixed(0)} ms\n  ${lines.join('\n  ')}`)
    console.log(`amostra da temporada 2027:\n  ${sample.join('\n  ')}`)
    console.log(`fator de carga da máquina: ${loadFactor.toFixed(2)}`)
    expect(preAvg).toBeLessThan(200 * loadFactor)
    expect(p50).toBeLessThan(30 * loadFactor)
    expect(p90).toBeLessThan(30 * loadFactor)
  })
})
