/**
 * Integração com os dados REAIS (src/data/generated/game-data.json) e o mundo REAL
 * (src/engine/world). Pulado automaticamente enquanto algum dos dois não existir.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CareerEngine } from '../../api'
import type { GameData, Pace, Position } from '../../types'
import { rng } from '../../rng'

const dataPath = fileURLToPath(new URL('../../../data/generated/game-data.json', import.meta.url))
const worldPath = fileURLToPath(new URL('../../world/index.ts', import.meta.url))
const available = existsSync(dataPath) && existsSync(worldPath)

async function load(): Promise<{ data: GameData; engine: CareerEngine }> {
  const data = JSON.parse(readFileSync(dataPath, 'utf8')) as GameData
  const mod = (await import('../default')) as { careerEngine: CareerEngine }
  return { data, engine: mod.careerEngine }
}

function play(engine: CareerEngine, data: GameData, seed: string, pace: Pace, position: Position, nationality: string) {
  let s = engine.newCareer(data, { surname: 'Teste', number: 10, foot: 'right', nationality, position }, pace, seed)
  let steps = 0
  while (!s.retired && steps < 60) {
    const d = s.pendingDecision!
    const opts = d.options.filter((o) => !o.id.startsWith('retire-'))
    const pick = (opts.length ? rng(seed, 'p', steps).pick(opts) : d.options[0]).id
    s = engine.choose(data, s, pick).state
    steps++
  }
  return s
}

describe.skipIf(!available)('integração: dados reais + mundo real', () => {
  it('oferta de base com clubes reais do Brasil', async () => {
    const { data, engine } = await load()
    const s = engine.newCareer(data, { surname: 'Teste', number: 10, foot: 'right', nationality: 'BRA', position: 'CA' }, 'normal', 'real-academy')
    const d = s.pendingDecision!
    expect(d.options).toHaveLength(3)
    for (const o of d.options) expect(data.clubs.find((c) => c.id === o.clubId)?.country).toBe('BRA')
  }, 120_000)

  for (const [pace, pos, nat] of [
    ['expressa', 'CA', 'BRA'],
    ['normal', 'MEI', 'ARG'],
    ['intensa', 'GOL', 'ENG'],
  ] as [Pace, Position, string][]) {
    it(`carreira completa (${pace}, ${pos}, ${nat})`, async () => {
      const { data, engine } = await load()
      const s = play(engine, data, `real-${pace}`, pace, pos, nat)
      expect(s.retired).toBe(true)
      expect(s.seasons.length).toBeGreaterThan(10)
      const sum = engine.summarize(data, s)
      expect(sum.legacyScore).toBeGreaterThanOrEqual(0)
      expect(JSON.parse(JSON.stringify(s)).seasons.length).toBe(s.seasons.length)
      if (process.env.REAL_LOG)
        console.log(
          s.seasons.map((r) => `${r.age} ${data.clubs.find((c) => c.id === r.clubId)?.shortName} ${r.role} ${r.ovrStart}->${r.ovrEnd} ${r.stats.apps}j ${r.stats.goals}g ${r.trophies.map((t) => t.trophyId).join(',')} ${r.awards.map((a) => a.award + a.place).join(',')}`).join('\n'),
          '\n',
          sum.headline,
          sum.totals,
        )
    }, 300_000)
  }
})
