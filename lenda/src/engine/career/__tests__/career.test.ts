import { describe, expect, it } from 'vitest'
import type { Pace } from '../../types'
import { data, engine, identity, playCareer, randomPolicy } from '../__fixtures__/play'
import { formatMoney, positionGroup, roleLabel, roleShortLabel } from '../util'
import { PACES, RETIREMENT_AGE } from '../constants'
import { careerMemory } from '../index'

describe('newCareer', () => {
  const s = engine.newCareer(data, identity('CA', 'BRA'), 'normal', 'seed-new')

  it('começa aos 16, temporada 2026, OVR 50, €100K e sem clube', () => {
    expect(s.version).toBe(1)
    expect(s.age).toBe(16)
    expect(s.season).toBe(2026)
    expect(s.ovr).toBe(50)
    expect(s.marketValue).toBe(100_000)
    expect(s.clubId).toBeNull()
    expect(s.phase).toBe('deciding')
    expect(['early', 'normal', 'late']).toContain(s.devProfile)
    expect(s.world.nextSeason).toBe(2026)
  })

  it('oferta de base: 3 clubes reais do país (grande, médio e menor), "Assinar com"', () => {
    const d = s.pendingDecision!
    expect(d.kind).toBe('academy')
    expect(d.options).toHaveLength(3)
    const clubs = d.options.map((o) => data.clubs.find((c) => c.id === o.clubId)!)
    expect(new Set(clubs.map((c) => c.id)).size).toBe(3)
    for (const c of clubs) expect(c.country).toBe('BRA')
    for (const o of d.options) {
      expect(o.label).toBe('Assinar com')
      expect(o.title).toBeTruthy()
      expect(o.details?.map((x) => x.label)).toEqual(expect.arrayContaining(['Papel previsto', 'Salário/ano', 'Contrato']))
    }
    const strengths = clubs.map((c) => c.strength).sort((a, b) => b - a)
    expect(strengths[0] - strengths[2]).toBeGreaterThanOrEqual(6)
    expect(clubs.some((c) => c.leagueId === 'bra.2')).toBe(true)
  })

  it('país sem liga cai para a confederação e respeita Chivas/Athletic', () => {
    for (let i = 0; i < 30; i++) {
      const c = engine.newCareer(data, identity('CA', 'CAN'), 'normal', `can-${i}`)
      for (const o of c.pendingDecision!.options) {
        const club = data.clubs.find((x) => x.id === o.clubId)!
        expect(['MEX', 'USA']).toContain(club.country)
        expect(club.onlyNationality).toBeUndefined()
      }
    }
  })

  it('perfil de desenvolvimento ~10/80/10 e goleiro sempre normal', () => {
    const counts = { early: 0, normal: 0, late: 0 }
    for (let i = 0; i < 1000; i++) counts[engine.newCareer(data, identity('CA'), 'normal', `dev-${i}`).devProfile]++
    expect(counts.early).toBeGreaterThan(60)
    expect(counts.early).toBeLessThan(140)
    expect(counts.late).toBeGreaterThan(60)
    expect(counts.late).toBeLessThan(140)
    for (let i = 0; i < 50; i++) expect(engine.newCareer(data, identity('GOL'), 'normal', `gk-${i}`).devProfile).toBe('normal')
  })

  it('agenda de eventos por ritmo (Intensa 6–7 gap≥2, Normal 3–4 gap≥4, Expressa 2–3 gap≥6)', () => {
    const rules: Record<Pace, [number, number, number]> = { intensa: [6, 7, 2], normal: [3, 4, 4], expressa: [2, 3, 6] }
    for (const pace of Object.keys(rules) as Pace[]) {
      const [lo, hi, gap] = rules[pace]
      for (let i = 0; i < 40; i++) {
        const slots = engine.newCareer(data, identity(), pace, `slots-${pace}-${i}`).events.slots
        expect(slots.length).toBeGreaterThanOrEqual(lo)
        expect(slots.length).toBeLessThanOrEqual(hi)
        for (const a of slots) expect(a >= 22 && a <= 37).toBe(true)
        for (let k = 1; k < slots.length; k++) expect(slots[k] - slots[k - 1]).toBeGreaterThanOrEqual(gap)
      }
    }
  })
})

describe('carreira completa', () => {
  for (const pace of ['intensa', 'normal', 'expressa'] as Pace[]) {
    it(`${pace}: joga até a aposentadoria com escolhas aleatórias`, () => {
      for (let k = 0; k < 4; k++) {
        const { state, reveals } = playCareer(`full-${pace}-${k}`, pace)
        expect(state.retired).toBe(true)
        expect(state.phase).toBe('finished')
        expect(state.pendingDecision).toBeNull()
        const n = PACES[pace].seasons
        for (const r of reveals) {
          expect(r.seasons.length).toBeLessThanOrEqual(n)
          expect(r.trophies).toEqual(r.seasons.flatMap((x) => x.trophies))
          expect(r.awards).toEqual(r.seasons.flatMap((x) => x.awards))
          expect(typeof r.ovrBefore).toBe('number')
          expect(typeof r.valueAfter).toBe('number')
          expect(Array.isArray(r.log)).toBe(true)
          expect(Array.isArray(r.achievements)).toBe(true)
        }
        expect(reveals.filter((r) => r.finished)).toHaveLength(1)
        expect(reveals[reveals.length - 1].finished).toBe(true)
        // uma linha por temporada, idades consecutivas desde os 16
        state.seasons.forEach((r, i) => {
          expect(r.age).toBe(16 + i)
          expect(r.season).toBe(2026 + i)
          expect(r.ovrStart).toBeGreaterThanOrEqual(40)
          expect(r.ovrEnd).toBeLessThanOrEqual(99)
          expect(r.stats.apps).toBeGreaterThanOrEqual(0)
          expect(r.stats.rating).toBeGreaterThanOrEqual(0)
          expect(r.stats.rating).toBeLessThanOrEqual(10)
          expect(r.marketValue).toBeGreaterThan(0)
        })
        if (state.retiredReason === 'retirement_age') {
          expect(state.seasons).toHaveLength(24)
          expect(state.age).toBe(RETIREMENT_AGE)
          expect(state.seasons[23].age).toBe(39)
        }
        // OVR congelado aos 38–39 (sem tabela para o alvo 40), fora eventos
        const s38 = state.seasons.find((r) => r.age === 38)
        const s39 = state.seasons.find((r) => r.age === 39)
        if (s38 && s39 && !s38.injury) expect(s39.ovrEnd).toBeGreaterThanOrEqual(s38.ovrStart - 5)
        expect(state.log.some((l) => l.type === 'retired')).toBe(true)
        const sum = engine.summarize(data, state)
        expect(sum.seasons).toBe(state.seasons.length)
        expect(sum.legacyScore).toBeGreaterThanOrEqual(0)
        expect(sum.legacyScore).toBeLessThanOrEqual(100)
        expect(sum.headline.length).toBeGreaterThan(3)
      }
    })
  }

  it('primeira temporada aos 16 tem poucos jogos (como no Copero)', () => {
    for (let i = 0; i < 20; i++) {
      const { state } = playCareer(`first-${i}`, 'intensa')
      expect(state.seasons[0].stats.apps).toBeLessThanOrEqual(30)
    }
  })

  it('valores de mercado seguem a regra do Copero no fim', () => {
    const { state } = playCareer('value-end', 'normal')
    const last = state.seasons[state.seasons.length - 1]
    // aos 40 o fator de idade é 0,2
    expect(last.marketValue).toBeLessThan(10_000_000)
  })
})

describe('determinismo e serialização', () => {
  it('mesma semente + mesmas escolhas ⇒ carreira idêntica', () => {
    const a = playCareer('det-1', 'normal')
    const b = playCareer('det-1', 'normal')
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state))
    expect(JSON.stringify(a.reveals)).toBe(JSON.stringify(b.reveals))
    const c = playCareer('det-2', 'normal')
    expect(JSON.stringify(c.state.seasons)).not.toBe(JSON.stringify(a.state.seasons))
  })

  it('estado é JSON puro e continuar a partir do JSON dá o mesmo resultado', () => {
    const policy = randomPolicy('ser')
    let s1 = engine.newCareer(data, identity('MEI', 'ARG'), 'normal', 'ser')
    for (let i = 0; i < 4; i++) s1 = engine.choose(data, s1, policy(s1.pendingDecision!, s1, i)).state
    const s2 = JSON.parse(JSON.stringify(s1))
    expect(s2).toEqual(JSON.parse(JSON.stringify(s1)))
    let a = s1
    let b = s2
    for (let i = 4; i < 200 && !a.retired; i++) {
      a = engine.choose(data, a, policy(a.pendingDecision!, a, i)).state
      b = engine.choose(data, b, policy(b.pendingDecision!, b, i)).state
    }
    expect(JSON.stringify(b.seasons)).toBe(JSON.stringify(a.seasons))
    expect(careerMemory(a).step).toBe(careerMemory(b).step)
  })

  it('choose não muta o estado recebido', () => {
    const s = engine.newCareer(data, identity(), 'normal', 'immut')
    const before = JSON.stringify(s)
    engine.choose(data, s, s.pendingDecision!.options[0].id)
    expect(JSON.stringify(s)).toBe(before)
  })

  it('erros claros para opção inválida e carreira encerrada', () => {
    const s = engine.newCareer(data, identity(), 'normal', 'err')
    expect(() => engine.choose(data, s, 'nao-existe')).toThrow(/Opção desconhecida/)
    const { state } = playCareer('err-end', 'expressa')
    expect(() => engine.choose(data, state, 'x')).toThrow(/terminou/)
  })
})

describe('helpers para a UI', () => {
  it('formatMoney segue a regra do Copero, com vírgula decimal e sem ",0"', () => {
    expect(formatMoney(100_000)).toBe('€100K')
    expect(formatMoney(380_000)).toBe('€380K')
    expect(formatMoney(5_500_000)).toBe('€5,5M')
    expect(formatMoney(5_100_000)).toBe('€5,1M')
    expect(formatMoney(7_000_000)).toBe('€7M')
    expect(formatMoney(9_980_000)).toBe('€10M')
    expect(formatMoney(999_800)).toBe('€1M')
    expect(formatMoney(45_000_000)).toBe('€45M')
    expect(formatMoney(250_000_000)).toBe('€250M')
    expect(formatMoney(10_000)).toBe('€10K')
  })

  it('roleLabel e positionGroup em pt-BR', () => {
    expect(roleLabel('starter')).toBe('Titular')
    expect(roleLabel('high_rotation')).toBe('Rotação')
    expect(roleLabel('low_rotation')).toBe('Rotação baixa')
    expect(roleLabel('substitute')).toBe('Reserva')
    expect(roleLabel('third_keeper')).toBe('Terceiro goleiro')
    expect(roleShortLabel('low_rotation')).toBe('Rotação')
    expect(positionGroup('GOL')).toBe('goalkeeper')
    expect(positionGroup('ZAG')).toBe('defensive')
    expect(positionGroup('VOL')).toBe('defensive')
    expect(positionGroup('LD')).toBe('defensive')
    expect(positionGroup('MC')).toBe('support')
    expect(positionGroup('MEI')).toBe('support')
    expect(positionGroup('PE')).toBe('attacking')
    expect(positionGroup('CA')).toBe('attacking')
  })

  it('describeOption devolve as pílulas da opção', () => {
    const s = engine.newCareer(data, identity(), 'normal', 'desc')
    const o = s.pendingDecision!.options[0]
    expect(engine.describeOption!(data, s, o.id)).toEqual(o.effects)
  })
})
