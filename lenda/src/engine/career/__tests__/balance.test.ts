/**
 * Harness de balanceamento (desligado por padrão). Rode com:
 *   BALANCE=1 npx vitest run src/engine/career/__tests__/balance.test.ts
 * Opcional: BALANCE_N=500, BALANCE_PACE=normal|intensa|expressa, BALANCE_REAL=1 (mundo e dados
 * reais em vez do mundo falso — bem mais lento, ~2 s por carreira).
 *
 * Alvo (sensação do Copero): maioria com pico 75–86, ~10–15% chegam a 88+, Bola de Ouro rara
 * mas possível, ~550–700 jogos numa carreira longa.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CareerEngine } from '../../api'
import { rng } from '../../rng'
import type { GameData, Pace, Position } from '../../types'
import { data as fakeData, engine as fakeEngine, identity, randomPolicy } from '../__fixtures__/play'
import { positionGroup } from '../util'

async function setup(): Promise<{ engine: CareerEngine; data: GameData }> {
  if (!process.env.BALANCE_REAL) return { engine: fakeEngine, data: fakeData }
  const path = fileURLToPath(new URL('../../../data/generated/game-data.json', import.meta.url))
  if (!existsSync(path)) throw new Error('BALANCE_REAL=1 sem game-data.json')
  const mod = (await import('../default')) as { careerEngine: CareerEngine }
  return { engine: mod.careerEngine, data: JSON.parse(readFileSync(path, 'utf8')) as GameData }
}

function play(engine: CareerEngine, data: GameData, seed: string, pace: Pace, id: ReturnType<typeof identity>) {
  const policy = randomPolicy(seed)
  let state = engine.newCareer(data, id, pace, seed)
  const decisions = []
  for (let step = 0; step < 200 && !state.retired; step++) {
    const d = state.pendingDecision!
    decisions.push(d)
    state = engine.choose(data, state, policy(d, state, step)).state
  }
  return { state, decisions }
}

const RUN = !!process.env.BALANCE
const N = Number(process.env.BALANCE_N ?? 500)

function pct(values: number[], p: number) {
  const s = values.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}
const mean = (v: number[]) => Math.round((v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)) * 10) / 10

describe.skipIf(!RUN)('balanceamento (BALANCE=1)', () => {
  it(`${N} carreiras com escolhas aleatórias`, async () => {
    const { engine, data } = await setup()
    const positions: Position[] = ['GOL', 'ZAG', 'LD', 'LE', 'VOL', 'MC', 'ME', 'MD', 'MEI', 'PE', 'PD', 'CA']
    const nats = ['BRA', 'BRA', 'BRA', 'ARG', 'ENG', 'ESP', 'FRA', 'POR', 'MEX', 'JPN', 'USA', 'MAR']
    const paces: Pace[] = process.env.BALANCE_PACE ? [process.env.BALANCE_PACE as Pace] : ['intensa', 'normal', 'expressa']
    const peaks: number[] = []
    const apps: number[] = []
    const titles: number[] = []
    const ballons: number[] = []
    const podiums: number[] = []
    const goalsBy: Record<string, number[]> = { attacking: [], support: [], defensive: [], goalkeeper: [] }
    const legacy: number[] = []
    const events: Record<string, number> = {}
    const achievements: Record<string, number> = {}
    let injuries = 0
    let loans = 0
    let nonRenewals = 0
    const retire: Record<string, number> = {}
    const t0 = performance.now()
    for (let i = 0; i < N; i++) {
      const r = rng('balance', i)
      const pos = r.pick(positions)
      const seed = `bal-${i}`
      const { state, decisions } = play(engine, data, seed, paces[i % paces.length], identity(pos, r.pick(nats)))
      const sum = engine.summarize(data, state)
      peaks.push(sum.peakOvr)
      apps.push(sum.totals.apps)
      titles.push(state.seasons.reduce((t, s) => t + s.trophies.filter((x) => !x.minor).length, 0))
      ballons.push(sum.awards.find((a) => a.award === 'ballon_dor')?.count ?? 0)
      podiums.push(sum.ballonDorPodiums.length)
      goalsBy[positionGroup(pos)].push(sum.totals.goals)
      legacy.push(sum.legacyScore)
      for (const d of decisions) {
        if (d.kind === 'event' && d.eventKey) events[d.eventKey] = (events[d.eventKey] ?? 0) + 1
        if (d.kind === 'injury') injuries++
        if (d.kind === 'loan') loans++
        if (d.kind === 'non_renewal') nonRenewals++
      }
      for (const a of state.achievements ?? []) achievements[a] = (achievements[a] ?? 0) + 1
      retire[state.retiredReason ?? '?'] = (retire[state.retiredReason ?? '?'] ?? 0) + 1
    }
    const ms = Math.round(performance.now() - t0)
    const share = (v: number[], f: (x: number) => boolean) => `${Math.round((v.filter(f).length / v.length) * 1000) / 10}%`
    const report = {
      world: process.env.BALANCE_REAL ? 'real' : 'fake',
      careers: N,
      ms,
      peakOvr: { p10: pct(peaks, 10), p25: pct(peaks, 25), p50: pct(peaks, 50), p75: pct(peaks, 75), p90: pct(peaks, 90), max: Math.max(...peaks), '75-86': share(peaks, (x) => x >= 75 && x <= 86), '88+': share(peaks, (x) => x >= 88), '90+': share(peaks, (x) => x >= 90) },
      apps: { p10: pct(apps, 10), p50: pct(apps, 50), p90: pct(apps, 90), mean: mean(apps) },
      goals: Object.fromEntries(Object.entries(goalsBy).map(([k, v]) => [k, { n: v.length, p50: pct(v, 50), p90: pct(v, 90), max: Math.max(0, ...v) }])),
      titles: { p10: pct(titles, 10), p50: pct(titles, 50), p90: pct(titles, 90), mean: mean(titles) },
      ballonDor: { careersWithOne: share(ballons, (x) => x > 0), total: ballons.reduce((a, b) => a + b, 0), max: Math.max(...ballons), careersWithPodium: share(podiums, (x) => x > 0) },
      legacy: { p10: pct(legacy, 10), p50: pct(legacy, 50), p90: pct(legacy, 90) },
      injuries,
      loans,
      nonRenewals,
      retire,
      events,
      achievements,
    }
    console.log(JSON.stringify(report, null, 1))
    expect(peaks.length).toBe(N)
  }, 3_600_000)
})
