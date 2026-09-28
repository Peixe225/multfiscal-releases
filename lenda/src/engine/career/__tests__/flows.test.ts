import { describe, expect, it } from 'vitest'
import { rng } from '../../rng'
import type { CareerState } from '../../types'
import { data, engine, identity } from '../__fixtures__/play'
import { cloneState, nextDecision } from '../engine'
import { withPendingEvent } from '../index'
import { mem } from '../memory'
import { locationWeights, transferOffers } from '../offers'
import { clubConfed, clubStrength } from '../util'

function afterAcademy(seed: string, pace: 'intensa' | 'normal' | 'expressa' = 'normal', clubId = 'bra.1-1'): CareerState {
  const s = engine.newCareer(data, identity('CA', 'BRA'), pace, seed)
  const d = s.pendingDecision!
  // força a base num clube grande (vira reserva e gera empréstimo)
  const opt = d.options.find((o) => o.clubId === clubId) ?? d.options[0]
  if (opt.clubId !== clubId) {
    const c = cloneState(s)
    const specs = c.pendingDecision!.context!.specs as Record<string, { clubId?: string }>
    specs[opt.id].clubId = clubId
    c.pendingDecision!.options = c.pendingDecision!.options.map((o) => (o.id === opt.id ? { ...o, clubId } : o))
    return engine.choose(data, c, opt.id).state
  }
  return engine.choose(data, s, opt.id).state
}

describe('empréstimo (↳ + volta)', () => {
  it('reserva jovem recebe oferta de empréstimo, joga emprestado e volta ao clube', () => {
    let found = 0
    for (let i = 0; i < 40 && found < 3; i++) {
      const s = afterAcademy(`loan-${i}`)
      if (s.pendingDecision!.kind !== 'loan') continue
      found++
      const d = s.pendingDecision!
      const loans = d.options.filter((o) => o.id.startsWith('loan-'))
      expect(loans).toHaveLength(3)
      for (const o of loans) {
        expect(o.label).toBe('Ir por empréstimo para')
        const club = data.clubs.find((c) => c.id === o.clubId)!
        expect(club.id).not.toBe(s.clubId)
        expect(clubStrength(s.world, club)).toBeLessThanOrEqual(s.ovr + 4)
      }
      const out = engine.choose(data, s, loans[0].id)
      expect(out.reveal.seasons.every((r) => r.loan && r.clubId === loans[0].clubId)).toBe(true)
      expect(out.reveal.log.some((l) => l.type === 'loan_started')).toBe(true)
      expect(out.reveal.log.some((l) => l.type === 'loan_ended')).toBe(true)
      expect(out.state.clubId).toBe('bra.1-1')
      expect(out.state.parentClubId).toBeUndefined()
      const back = out.state.pendingDecision!
      expect(back.kind).toBe('loan_return')
      expect(back.options.some((o) => o.clubId === 'bra.1-1')).toBe(true)
      if (back.context!.retained === false) expect(back.options.some((o) => o.label === 'Assinar em definitivo com')).toBe(true)
      // assinar em definitivo com o clube do empréstimo
      const perm = back.options.find((o) => o.id.startsWith('permanent-'))
      if (perm) {
        const p = engine.choose(data, out.state, perm.id)
        expect(p.reveal.seasons[0].clubId).toBe(loans[0].clubId)
        expect(p.reveal.seasons[0].loan).toBe(false)
      }
    }
    expect(found).toBeGreaterThan(0)
  })

  it('empréstimo só entre 18 e 24 anos', () => {
    for (let i = 0; i < 20; i++) {
      const s = afterAcademy(`loan-age-${i}`)
      const c = cloneState(s)
      c.age = 25
      c.ovr = 60
      expect(nextDecision(data, c)?.kind).not.toBe('loan')
    }
  })
})

describe('fim de ciclo e aposentadoria', () => {
  function bench(age: number, ovr: number, subStreak: number): CareerState {
    const s = afterAcademy(`nr-${age}-${ovr}`)
    const c = cloneState(s)
    c.age = age
    c.ovr = ovr
    c.streaks = { lowRole: 0, substitute: subStreak }
    c.events.slots = []
    return c
  }

  it('"Fim de ciclo" com 26+ e sequência de banco (Normal: 1 período de reserva)', () => {
    const d = nextDecision(data, bench(27, 70, 1))!
    expect(d.kind).toBe('non_renewal')
    expect(d.title).toBe('Fim de ciclo')
    expect(d.options).toHaveLength(3)
    expect(d.options.some((o) => o.title === 'Aposentar-se')).toBe(false)
    expect(nextDecision(data, bench(25, 70, 1))!.kind).not.toBe('non_renewal')
    expect(nextDecision(data, bench(27, 70, 0))!.kind).not.toBe('non_renewal')
  })

  it('aos 32+: duas ofertas + "Aposentar-se"; aposentadoria voluntária encerra sem simular', () => {
    const s = bench(33, 70, 1)
    const d = nextDecision(data, s)!
    expect(d.kind).toBe('non_renewal')
    expect(d.options).toHaveLength(3)
    const retire = d.options.find((o) => o.title === 'Aposentar-se')!
    s.pendingDecision = d
    const out = engine.choose(data, s, retire.id)
    expect(out.state.retired).toBe(true)
    expect(out.state.retiredReason).toBe('voluntary')
    expect(out.reveal.finished).toBe(true)
    expect(out.reveal.seasons).toHaveLength(0)
    const sum = engine.summarize(data, out.state)
    expect(sum.seasons).toBe(out.state.seasons.length)
  })

  it('"Sem propostas" quando ninguém quer um veterano (32+)', () => {
    const s = bench(34, 40, 1)
    const d = nextDecision(data, s)!
    expect(d.kind).toBe('retirement')
    expect(d.title).toBe('Sem propostas')
    expect(d.options).toHaveLength(1)
    s.pendingDecision = d
    const out = engine.choose(data, s, d.options[0].id)
    expect(out.state.retiredReason).toBe('no_offers')
  })

  it('janela sem ofertas aos 34+ oferece "Aposentar-se"; aos 36+ sempre', () => {
    const s = bench(34, 40, 0)
    const d = nextDecision(data, s)!
    expect(d.kind).toBe('transfer')
    expect(d.options.filter((o) => o.clubId && o.clubId !== s.clubId)).toHaveLength(0)
    expect(d.options.some((o) => o.title === 'Aposentar-se')).toBe(true)
    const t = bench(36, 75, 0)
    const d2 = nextDecision(data, t)!
    if (d2.kind === 'transfer') expect(d2.options.some((o) => o.title === 'Aposentar-se')).toBe(true)
    const y = bench(30, 75, 0)
    const d3 = nextDecision(data, y)!
    if (d3.kind === 'transfer') expect(d3.options.some((o) => o.title === 'Aposentar-se')).toBe(false)
  })

  it('aposentadoria automática depois da temporada dos 39 anos', () => {
    let s = afterAcademy('auto-40', 'expressa')
    while (!s.retired) s = engine.choose(data, s, s.pendingDecision!.options.find((o) => o.title !== 'Aposentar-se')?.id ?? s.pendingDecision!.options[0].id).state
    if (s.retiredReason === 'retirement_age') {
      expect(s.seasons[s.seasons.length - 1].age).toBe(39)
      expect(s.age).toBe(40)
    }
    expect(s.log[s.log.length - 1].type).toBe('retired')
  })
})

describe('suspensão', () => {
  it('suspenso: 0 jogos, sem títulos/prêmios/seleção, e a próxima decisão é a janela', () => {
    let hit = false
    for (let i = 0; i < 60 && !hit; i++) {
      const b = afterAcademy(`susp-${i}`, 'intensa')
      const c = cloneState(b)
      c.age = 24
      mem(c).step = 50 + i
      const s = withPendingEvent(data, c, 'mysterious_substance')!
      const out = engine.choose(data, s, 'mysterious_substance-consume')
      if (out.reveal.rolledEffect !== 1) continue
      hit = true
      const r = out.reveal.seasons[0]
      expect(r.suspended).toBe(true)
      expect(r.stats.apps).toBe(0)
      expect(r.trophies).toHaveLength(0)
      expect(r.awards).toHaveLength(0)
      expect(r.national).toBeUndefined()
      // Intensa: suspensão mínima de 2 temporadas → a decisão seguinte é a janela, ainda suspenso
      expect(out.state.modifiers.suspendedSeasons).toBe(1)
      expect(out.state.pendingDecision!.kind).toBe('transfer')
      const next = engine.choose(data, out.state, out.state.pendingDecision!.options[0].id)
      expect(next.reveal.seasons[0].suspended).toBe(true)
      expect(next.state.modifiers.suspendedSeasons ?? 0).toBe(0)
    }
    expect(hit).toBe(true)
  })
})

describe('ofertas de transferência', () => {
  const base = afterAcademy('offers')

  it('faixa de força ≈ OVR−2..OVR+3 com deriva', () => {
    for (let i = 0; i < 60; i++) {
      const c = cloneState(base)
      c.ovr = 70 + (i % 15)
      for (const club of transferOffers(data, c, rng('band', i))) {
        const st = clubStrength(c.world, club)
        expect(st).toBeGreaterThanOrEqual(c.ovr - 2 - 4 - 10)
        expect(st).toBeLessThanOrEqual(c.ovr + 3 + 4 + 10)
      }
    }
  })

  it('localização pelo OVR: <73 só país; 83+ o mundo todo', () => {
    expect(locationWeights(70).countryClub).toBe(50)
    expect(locationWeights(75).confedClub).toBe(50)
    expect(locationWeights(80).random).toBe(50)
    expect(locationWeights(85).random).toBe(100)
    const countries = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const c = cloneState(base)
      c.ovr = 70
      for (const club of transferOffers(data, c, rng('loc70', i))) expect(club.country).toBe('BRA')
      const d = cloneState(base)
      d.ovr = 85
      for (const club of transferOffers(data, d, rng('loc85', i))) countries.add(clubConfed(data, club))
    }
    expect(countries.has('UEFA')).toBe(true)
  })

  it('respeita restrições de nacionalidade (Athletic/Chivas)', () => {
    for (let i = 0; i < 200; i++) {
      const c = cloneState(base)
      c.ovr = 72 + (i % 12)
      c.clubId = i % 2 ? 'esp.1-10' : 'mex.1-5'
      for (const club of transferOffers(data, c, rng('only', i), { count: 3 })) expect(club.onlyNationality).toBeUndefined()
    }
  })

  it('card de oferta traz papel previsto, salário/ano e contrato', () => {
    let s = base
    for (let i = 0; i < 10 && s.pendingDecision!.kind !== 'transfer'; i++) s = engine.choose(data, s, s.pendingDecision!.options[0].id).state
    const d = s.pendingDecision!
    if (d.kind === 'transfer') {
      const stay = d.options.find((o) => o.id.startsWith('stay-'))!
      expect(stay.label).toMatch(/^Ficar n[oa]$/)
      for (const o of d.options.filter((x) => x.clubId)) {
        const labels = o.details!.map((x) => x.label)
        expect(labels).toEqual(expect.arrayContaining(['Papel previsto', 'Salário/ano', 'Contrato']))
        expect(['Titular', 'Rotação', 'Reserva']).toContain(o.details!.find((x) => x.label === 'Papel previsto')!.value)
        expect(o.details!.find((x) => x.label === 'Salário/ano')!.value).toMatch(/^€\d/)
      }
    }
  })
})
