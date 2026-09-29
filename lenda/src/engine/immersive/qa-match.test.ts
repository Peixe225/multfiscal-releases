/** QA da partida ao vivo: trocas coerentes, prévia do treino exata e narração com artigo certo. */
import { describe, expect, it, vi } from 'vitest'
import type { GameData } from '../types'
import { careerAt, dispatch, E, hasRealData, realData } from './__fixtures__/helpers'
import type { ImmersiveState, MatchEvent } from './types'

vi.setConfig({ testTimeout: 120_000 })

/** Joga as próximas `n` partidas do calendário (lances resolvidos pela 1ª opção) e devolve os eventos de cada uma. */
function playMatches(data: GameData, s0: ImmersiveState, n: number): { state: ImmersiveState; games: MatchEvent[][] } {
  let s = s0
  const games: MatchEvent[][] = []
  for (let g = 0; g < n; g++) {
    for (let i = 0; i < 60 && !s.live; i++) {
      if (s.pendingDecision) s = dispatch(data, s, { type: 'decision_choose', optionId: s.pendingDecision.options[0].id }).state
      else s = dispatch(data, s, { type: 'auto', until: 'next_match' }).state
      if (s.calendar[s.cursor]?.kind === 'match' || s.calendar[s.cursor]?.kind === 'national_match') s = dispatch(data, s, { type: 'match_start' }).state
    }
    for (let i = 0; i < 200 && s.live && s.live.phase !== 'full_time'; i++) {
      const km = s.live.pendingMoment
      s = (km ? dispatch(data, s, { type: 'match_choose', optionId: km.options[0].id, minigame: { side: 'left', timing: 0.6 } }) : dispatch(data, s, { type: 'match_sim' })).state
    }
    if (s.live) games.push(s.live.events.slice())
    s = dispatch(data, s, { type: 'match_finish' }).state
  }
  return { state: s, games }
}

describe.skipIf(!hasRealData)('imersivo · QA da partida', () => {
  const data = hasRealData ? realData() : (null as unknown as GameData)

  it('trocas: ninguém sai duas vezes, quem entrou não sai e ninguém entra repetido', () => {
    const club = data.clubs.find((c) => c.shortName === 'Ponte Preta') ?? data.clubs[0]
    const { games } = playMatches(data, careerAt(data, 'qa-subs', club.id), 6)
    expect(games.length).toBeGreaterThan(3)
    for (const ev of games) {
      for (const side of ['home', 'away'] as const) {
        const subs = ev.filter((e) => (e.type === 'sub_on' || e.type === 'sub_off') && e.side === side)
        const off: string[] = []
        const on: string[] = []
        for (const e of subs) {
          if (e.type === 'sub_on') {
            on.push(e.player!)
            off.push(e.assist!)
          } else {
            off.push(e.player!)
            on.push(e.assist!)
          }
        }
        expect(new Set(off).size).toBe(off.length)
        expect(new Set(on).size).toBe(on.length)
        for (const name of on) expect(off).not.toContain(name)
        // dupla substituição com dois nomes diferentes
        for (const e of subs) expect(/entram (\S+) e \1;/.test(e.text)).toBe(false)
      }
    }
  })

  it('narração: artigo feminino da Ponte Preta', () => {
    const club = data.clubs.find((c) => c.shortName === 'Ponte Preta')
    if (!club) return
    const s0 = careerAt(data, 'qa-art', club.id)
    expect(s0.inbox.some((m) => m.subject === 'Bem-vindo à Ponte Preta')).toBe(true)
    const { games } = playMatches(data, s0, 5)
    const texts = games.flat().map((e) => e.text)
    expect(texts.some((t) => /\b(do|no|pelo) Ponte Preta\b|\bO Ponte Preta\b/.test(t))).toBe(false)
  })

  it('disputa de pênaltis: cobranças marcadas (não são gols do jogo)', () => {
    // qualquer jogo com pênaltis nas partidas jogadas: os eventos da disputa vêm com shootout
    const club = data.clubs.find((c) => c.shortName === 'Atlético-MG') ?? data.clubs[0]
    const { games } = playMatches(data, careerAt(data, 'qa-pens', club.id), 8)
    for (const ev of games) {
      const ftIdx = ev.findIndex((e) => e.type === 'full_time' && /pênaltis/i.test(e.text))
      if (ftIdx < 0) continue
      for (const e of ev.slice(ftIdx + 1)) if (e.type === 'penalty_goal' || e.type === 'penalty_miss') expect(e.shootout).toBe(true)
    }
  })

  it('prévia do treino = treino de verdade', () => {
    const club = data.clubs.find((c) => c.shortName === 'Atlético-MG') ?? data.clubs[0]
    let s = careerAt(data, 'qa-train', club.id)
    for (let i = 0; i < 10 && s.calendar[s.cursor]?.kind !== 'training'; i++) s = dispatch(data, s, { type: 'advance' }).state
    expect(s.calendar[s.cursor]?.kind).toBe('training')
    for (const [focus, intensity] of [['finishing', 'intensa'], ['physical', 'normal'], ['tactical', 'leve']] as const) {
      const pv = E.trainingPreview!(data, s, focus, intensity)
      const after = dispatch(data, s, { type: 'train', focus, intensity }).state
      for (const g of pv.gains) expect((after.attributes as unknown as Record<string, number>)[g.key]).toBe(g.to)
    }
  })
})
