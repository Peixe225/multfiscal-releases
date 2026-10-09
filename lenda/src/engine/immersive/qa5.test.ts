/**
 * QA v5 (motor imersivo): cartões e expulsões, tempo esgotado no lance, nota do apito final,
 * coletiva só para quem joga, play-off escondido até o fim da fase regular, decisão aberta no
 * "simular", empréstimo que termina com o contrato vencido e o salto de semanas do fim de temporada.
 */
import { describe, expect, it, vi } from 'vitest'
import type { DecisionOption, GameData } from '../types'
import { advanceUntil, careerAt, closeSeason, dispatch, hasRealData, realData, toSeasonEnd, tweak } from './__fixtures__/helpers'
import { visibleFixtures } from './calendar'
import { immersiveMemory, safestOption } from './index'
import type { Fx } from './mem'
import type { ImmersiveState, MatchEvent } from './types'

vi.setConfig({ testTimeout: 120_000 })

const fx = (key: string, stage: string, kind: Fx['kind'] = 'league', round?: number): Fx => ({
  key,
  competitionId: 'lg',
  kind,
  stage,
  round,
  home: 'a',
  away: 'b',
  opponent: 'b',
  userHome: true,
  score: [0, 0],
  strength: [70, 70],
  seq: 0,
})

describe('imersivo · QA v5 (puro)', () => {
  it('play-off de liga só aparece com a fase regular do torneio encerrada', () => {
    const list = [fx('r1', 'Liga', 'league', 1), fx('r2', 'Liga', 'league', 2), fx('po', 'Play-off de acesso — Quartas de final')]
    expect(visibleFixtures(list, { r1: [1, 0] }).map((f) => f.key)).toEqual(['r1', 'r2'])
    expect(visibleFixtures(list, { r1: [1, 0], r2: [0, 0] }).map((f) => f.key)).toEqual(['r1', 'r2', 'po'])
    // Apertura/Clausura: o play-off do Apertura não espera o Clausura
    const two = [fx('a1', 'Apertura', 'league', 1), fx('c1', 'Clausura', 'league', 2), fx('apo', 'Apertura — Final')]
    expect(visibleFixtures(two, { a1: [2, 1] }).map((f) => f.key)).toContain('apo')
    expect(visibleFixtures(two, {}).map((f) => f.key)).not.toContain('apo')
  })

  it('decisão aberta no "simular": a opção de menor risco (nunca a aposta)', () => {
    const opt = (id: string, effects: DecisionOption['effects']): DecisionOption => ({ id, label: id, effects })
    const accept = opt('accept', [
      { kind: 'positive', label: '+2 OVR', probability: 0.5 },
      { kind: 'negative', label: 'Suspensão', probability: 0.5 },
    ])
    const reject = opt('reject', [{ kind: 'fixed', label: 'Nada acontece' }])
    expect(safestOption([accept, reject]).id).toBe('reject')
    const a = opt('a', [{ kind: 'positive', label: 'Técnico +' }])
    const b = opt('b', [{ kind: 'positive', label: 'Seguidores +' }, { kind: 'negative', label: 'Risco' }])
    expect(safestOption([b, a]).id).toBe('a')
  })
})

describe.skipIf(!hasRealData)('imersivo · QA v5 (partidas)', () => {
  const data = hasRealData ? realData() : (null as unknown as GameData)
  const club = (n: string) => data.clubs.find((c) => c.shortName === n) ?? data.clubs[0]

  /** Joga as próximas `n` partidas no tempo esgotado (lances) e devolve eventos + notas do apito. */
  function play(s0: ImmersiveState, n: number, onMoment?: (s: ImmersiveState) => void) {
    let s = s0
    const games: { events: MatchEvent[]; ftRating: number; played: boolean; itemId: string }[] = []
    for (let g = 0; g < n; g++) {
      s = advanceUntil(data, s, 'match')
      if (s.calendar[s.cursor]?.kind !== 'match') break
      s = dispatch(data, s, { type: 'match_start', accept: true }).state
      for (let i = 0; i < 300 && s.live && s.live.phase !== 'full_time'; i++) {
        if (s.live.pendingMoment) {
          onMoment?.(s)
          s = dispatch(data, s, { type: 'match_timeout' }).state
        } else s = dispatch(data, s, { type: 'match_sim' }).state
      }
      if (!s.live) break
      games.push({ events: s.live.events.slice(), ftRating: s.live.stats.rating, played: s.live.stats.minutes > 0, itemId: s.live.itemId })
      s = dispatch(data, s, { type: 'match_finish' }).state
    }
    return { state: s, games }
  }

  it('expulso não volta a aparecer; o 2º amarelo expulsa; amarelo e vermelho direto nunca no mesmo minuto', () => {
    const { games } = play(careerAt(data, 'qa5-cards', club('Grêmio').id), 14)
    expect(games.length).toBeGreaterThan(8)
    for (const { events } of games) {
      for (const side of ['home', 'away'] as const) {
        const off = new Set<string>()
        const booked = new Map<string, number>()
        for (const e of events.filter((x) => x.side === side && !x.byUser && !x.shootout)) {
          if (e.player) expect(off.has(e.player)).toBe(false)
          if (e.type === 'yellow') {
            expect(booked.has(e.player!)).toBe(false)
            booked.set(e.player!, e.minute)
          }
          if (e.type === 'red') {
            if (booked.get(e.player!) === e.minute) expect(e.text).toMatch(/[Ss]egundo amarelo/)
            off.add(e.player!)
          }
        }
      }
    }
  })

  it('tempo esgotado vale a jogada recomendada; a nota do apito é a gravada na carreira', () => {
    const picks: string[] = []
    const { state, games } = play(careerAt(data, 'qa5-timeout', club('Bahia').id), 6, (s) => picks.push(s.live!.pendingMoment!.suggested ?? ''))
    expect(picks.length).toBeGreaterThan(0)
    expect(picks.every((x) => x.length > 0)).toBe(true)
    for (const g of games.filter((x) => x.played)) expect(state.calendar.find((x) => x.id === g.itemId)?.result?.rating).toBe(g.ftRating)
  })

  it('coletiva pré-jogo só com o jogador relacionado (lesionado: recado da assessoria)', () => {
    let s = careerAt(data, 'qa5-press', club('Bahia').id)
    const pi = s.calendar.findIndex((x, i) => i > s.cursor && x.kind === 'press')
    expect(pi).toBeGreaterThan(0)
    for (let i = 0; i < 200 && s.cursor < pi - 1; i++) {
      if (s.pendingDecision) s = dispatch(data, s, { type: 'decision_choose', optionId: s.pendingDecision.options[0].id }).state
      else if (s.live) s = dispatch(data, s, { type: 'match_finish' }).state
      else if (s.press) s = dispatch(data, s, { type: 'press_skip' }).state
      else s = dispatch(data, s, { type: 'advance' }).state
    }
    expect(s.cursor).toBe(pi - 1)
    s = tweak(s, (x) => {
      x.condition.injury = { name: 'Entorse', weeksLeft: 6 }
    })
    s = dispatch(data, s, { type: 'advance' }).state
    expect(s.press).toBeNull()
    expect(s.calendar[pi].done).toBe(true)
    expect(s.inbox.some((m) => m.subject === 'Coletiva sem você')).toBe(true)
  })

  it('fim de empréstimo com o contrato vencido: livre no mercado (sem jogar outra temporada com contrato velho)', () => {
    let s = careerAt(data, 'qa5-loan', club('Bahia').id)
    const parent = club('Vitória').id
    s = tweak(s, (x) => {
      immersiveMemory(x).loan = { parentClubId: parent, untilSeason: x.season, parentSalary: 24_000 }
      x.parentClubId = parent
      x.finance.contractUntil = x.season
    })
    s = toSeasonEnd(data, s)
    const sharpAtEnd = s.condition.sharpness
    const next = closeSeason(data, s).state
    expect(next.clubId).toBeNull()
    expect(immersiveMemory(next).loan).toBeUndefined()
    expect(next.inbox.some((m) => /terminou durante o empréstimo/.test(m.body))).toBe(true)
    // o salto até a semana 62 não zera o ritmo (só 2 semanas contam como semanas sem jogo)
    expect(sharpAtEnd).toBeGreaterThan(0)
  })
})
