/**
 * Alcance das conquistas em níveis com JOGO HÁBIL (desligado por padrão). Rode com:
 *   LEGACY_REACH=1 npx vitest run src/engine/legacy/__tests__/reach.test.ts
 * Opcional: LEGACY_REACH_N=60, LEGACY_REACH_REAL=1 (mundo/dados reais, ~2 s por carreira),
 * LEGACY_REACH_OUT=/caminho/relatorio.txt (grava o relatório em vez de imprimir).
 *
 * Política gulosa: vai para o clube mais forte que oferece papel de titular/rotação e, nos
 * eventos, escolhe a opção com mais efeitos positivos. Mostra, por conquista do Hall, em quantas
 * carreiras ela saiu e a distribuição da Nota de Legado — serve para calibrar a raridade.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CareerEngine } from '../../api'
import { ACHIEVEMENTS, detectAchievements } from '../../career/achievements'
import { data as fakeData, engine as fakeEngine, identity, type Policy } from '../../career/__fixtures__/play'
import { rng } from '../../rng'
import type { GameData, Position } from '../../types'
import { evaluateRun } from '..'

async function setup(): Promise<{ engine: CareerEngine; data: GameData }> {
  if (!process.env.LEGACY_REACH_REAL) return { engine: fakeEngine, data: fakeData }
  const path = fileURLToPath(new URL('../../../data/generated/game-data.json', import.meta.url))
  if (!existsSync(path)) throw new Error('LEGACY_REACH_REAL=1 sem game-data.json')
  const mod = (await import('../../career/default')) as { careerEngine: CareerEngine }
  return { engine: mod.careerEngine, data: JSON.parse(readFileSync(path, 'utf8')) as GameData }
}

const ROLE: Record<string, number> = { Titular: 10, 'Rotação': 4, Reserva: -6 }

/** Clube mais forte com papel de titular; eventos: saldo de efeitos positivos. */
export function greedyPolicy(data: GameData, seed: string): Policy {
  const clubs = new Map(data.clubs.map((c) => [c.id, c]))
  return (d, _s, step) => {
    const opts = d.options.filter((o) => !o.id.startsWith('retire-'))
    if (!opts.length) return d.options[0].id
    const r = rng(seed, 'greedy', step)
    const value = (o: (typeof opts)[number]) => {
      let v = r.next() * 0.5
      for (const e of o.effects) v += (e.kind === 'positive' ? 1 : e.kind === 'negative' ? -1 : 0) * (e.probability ?? 1) * 3
      const club = o.clubId ? clubs.get(o.clubId) : undefined
      if (club && (d.kind === 'transfer' || d.kind === 'academy' || d.kind === 'loan' || d.kind === 'loan_return' || o.details?.some((x) => x.label === 'Papel previsto'))) {
        const role = o.details?.find((x) => x.label === 'Papel previsto')?.value ?? ''
        v += (club.strength ?? 0) * 0.6 + (club.prestige ?? 0) * 0.2 + (ROLE[role] ?? 0)
      }
      return v
    }
    return opts.slice().sort((a, b) => value(b) - value(a))[0].id
  }
}

const RUN = !!process.env.LEGACY_REACH
const N = Number(process.env.LEGACY_REACH_N ?? 60)

describe.skipIf(!RUN)('alcance das conquistas do Hall (LEGACY_REACH=1)', () => {
  it(`${N} carreiras com política gulosa`, async () => {
    const { engine, data } = await setup()
    const positions: Position[] = ['CA', 'CA', 'PE', 'PD', 'MEI', 'MC', 'VOL', 'ZAG', 'LD', 'GOL']
    const nats = ['BRA', 'ARG', 'FRA', 'ESP', 'ENG', 'POR', 'BRA', 'GER']
    const hits = new Map<string, number>()
    const scores: number[] = []
    const best: string[] = []
    for (let i = 0; i < N; i++) {
      const seed = `reach-${i}`
      const pos = positions[i % positions.length]
      let s = engine.newCareer(data, identity(pos, nats[i % nats.length]), 'normal', seed)
      const pol = greedyPolicy(data, seed)
      for (let step = 0; step < 200 && !s.retired; step++) s = engine.choose(data, s, pol(s.pendingDecision!, s, step)).state
      for (const id of detectAchievements(s)) hits.set(id, (hits.get(id) ?? 0) + 1)
      const run = evaluateRun({ id: s.id, identity: s.identity, seasons: s.seasons, national: s.national })
      scores.push(run.score)
      const v = run.values
      best.push(`${pos} nota ${run.score} · BdO ${v.ballonDor} · Copa ${v.worldCups} · UCL ${v.ucl} · Lib ${v.libertadores} · ligas ${v.leagueTitles} · gols ${v.goals} · ass ${v.assists} · recordes ${run.historic.map((h) => h.metric).join('/') || 0}`)
    }
    const pct = (n: number) => `${Math.round((100 * n) / N)}%`
    const lines = ACHIEVEMENTS.map((a) => `${a.rarity.padEnd(8)} ${a.id.padEnd(22)} ${pct(hits.get(a.id) ?? 0)}`)
    const sorted = scores.slice().sort((a, b) => a - b)
    const report = [
        `Nota: mediana ${sorted[Math.floor(N / 2)]} · p90 ${sorted[Math.floor(N * 0.9)]} · máx ${sorted[N - 1]}`,
        ...best.sort((a, b) => Number(b.split(' ')[2]) - Number(a.split(' ')[2])).slice(0, 8),
        ...lines,
      ].join('\n')
    if (process.env.LEGACY_REACH_OUT) writeFileSync(process.env.LEGACY_REACH_OUT, report)
    else console.log(report)
    expect(scores.length).toBe(N)
  }, 3_600_000)
})
