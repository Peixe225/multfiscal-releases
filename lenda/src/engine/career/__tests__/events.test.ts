import { describe, expect, it } from 'vitest'
import type { CareerState, Position } from '../../types'
import { data, engine, identity } from '../__fixtures__/play'
import { cloneState, applyEffects } from '../engine'
import { EVENTS, isSevereInjury } from '../events/catalog'
import { isEventEligible, tryEventDecision } from '../events/runtime'
import type { OptionSpec } from '../events/types'
import { INJURIES } from '../constants'
import { careerMemory, withPendingEvent } from '../index'
import { mem } from '../memory'
import { roleFromDelta, shiftRole } from '../player'
import { clubStrength } from '../util'

/** Estado logo após a oferta de base, ajustado para as condições do evento. */
function stateWith(o: { age?: number; ovr?: number; club?: string; position?: Position; nat?: string; firstClub?: string; nationalApps?: number; seed?: string; pace?: 'intensa' | 'normal' | 'expressa' }): CareerState {
  let s = engine.newCareer(data, identity(o.position ?? 'CA', o.nat ?? 'BRA'), o.pace ?? 'normal', o.seed ?? 'ev-base')
  s = engine.choose(data, s, s.pendingDecision!.options[0].id).state
  const c = cloneState(s)
  if (o.age !== undefined) c.age = o.age
  if (o.ovr !== undefined) c.ovr = o.ovr
  if (o.club) {
    c.clubId = o.club
    c.parentClubId = undefined
    mem(c).loan = null
    mem(c).seasonsAtClub = 3
  }
  if (o.firstClub) mem(c).firstClubId = o.firstClub
  if (o.nationalApps !== undefined) c.national = { ...c.national, apps: o.nationalApps, firstCallUp: 2030 }
  c.world = { ...c.world, qualified: { ...c.world.qualified, 'conmebol.libertadores': ['bra.1-1', 'bra.1-2', ...(c.world.qualified['conmebol.libertadores'] ?? [])] } }
  return c
}

const STATES: Record<string, () => CareerState> = {
  star: () => stateWith({ age: 27, ovr: 82, club: 'bra.1-1' }),
  starRival: () => stateWith({ age: 27, ovr: 82, club: 'bra.1-2' }),
  young: () => stateWith({ age: 24, ovr: 78, club: 'bra.1-5' }),
  abroad: () => stateWith({ age: 30, ovr: 80, club: 'eng.1-8' }),
  veteran: () => stateWith({ age: 33, ovr: 80, club: 'eng.1-8', firstClub: 'bra.1-10', nationalApps: 40 }),
}

function findState(key: string): CareerState | null {
  for (const make of Object.values(STATES)) {
    const s = make()
    if (isEventEligible(data, s, key)) return s
  }
  return null
}

describe('catálogo de eventos', () => {
  it('25 do Copero + 10 novos, chaves únicas, arte `${evento}-${opção}`', () => {
    expect(EVENTS.filter((e) => e.origin === 'copero')).toHaveLength(24) // + a lesão, construída à parte = 25
    expect(EVENTS.filter((e) => e.origin === 'lenda')).toHaveLength(10)
    expect(new Set(EVENTS.map((e) => e.key)).size).toBe(EVENTS.length)
    expect(INJURIES).toHaveLength(10)
    expect(INJURIES.reduce((t, i) => t + i.weight, 0)).toBe(100)
  })

  for (const def of EVENTS) {
    it(`${def.key}: alcançável, todas as opções jogáveis e efeitos aplicados`, () => {
      const base = findState(def.key)
      expect(base, `nenhum estado de teste deixa "${def.key}" elegível`).not.toBeNull()
      const variants = def.variants?.map((v) => v.key) ?? [undefined]
      for (const variant of variants) {
        const s = withPendingEvent(data, base!, def.key, variant)
        expect(s, `${def.key}/${variant} não montou`).not.toBeNull()
        const d = s!.pendingDecision!
        expect(d.kind).toBe('event')
        expect(d.eventKey).toBe(def.key)
        expect(d.title.length).toBeGreaterThan(3)
        expect(d.description.length).toBeGreaterThan(10)
        const specs = d.context!.specs as Record<string, OptionSpec>
        for (const opt of d.options) {
          const spec = specs[opt.id]
          expect(spec, opt.id).toBeTruthy()
          expect(opt.effects.length).toBeGreaterThan(0)
          if (spec.type === 'choice') expect(opt.art).toBe(`${def.key}-${spec.optionKey}`)
          // pílulas batem com as probabilidades reais
          const probs = spec.outcomes.reduce((t, o) => t + o.p, 0)
          expect(Math.abs(probs - 1)).toBeLessThan(1e-6)
          for (const o of spec.outcomes) {
            if (spec.outcomes.length > 1) {
              expect(o.chip).toBeDefined()
              const chip = opt.effects[o.chip!]
              expect(chip.probability).toBeCloseTo(o.p, 2)
              expect(chip.kind).toBe(o.kind)
            }
          }
          // cada resultado aplicado diretamente ao estado
          for (const o of spec.outcomes) {
            const t = cloneState(s!)
            const before = t.ovr
            applyEffects(data, t, o.fx, [])
            const m = mem(t)
            if (o.fx.ovr !== undefined || o.fx.temp) {
              const expected = Math.max(40, Math.min(99, before + (o.fx.ovr ?? 0) + (o.fx.temp?.delta ?? 0)))
              expect(t.ovr).toBe(expected)
            }
            if (o.fx.temp) expect(m.deferred.some((x) => x.delta === -o.fx.temp!.delta)).toBe(true)
            if (o.fx.roleOverride) expect(t.modifiers.roleOverride).toBe(o.fx.roleOverride)
            if (o.fx.roleShift) expect(m.period.roleShift).toBe(o.fx.roleShift)
            if (o.fx.suspend) expect(t.modifiers.suspendedSeasons).toBeGreaterThanOrEqual(2)
            if (o.fx.boost) expect(m.period.boostAdj).toBe(o.fx.boost)
            if (o.fx.priority) expect(t.modifiers.priority).toBe(o.fx.priority)
            if (o.fx.forceTrophy) expect(t.modifiers.forceTrophy).toEqual({ competitionKind: o.fx.forceTrophy.kind, chance: o.fx.forceTrophy.win ? 1 : -1 })
            if (o.fx.national) expect(m.period.national).toBe(o.fx.national)
            if (o.fx.switchNationality) expect(t.identity.nationality).toBe(o.fx.switchNationality)
            if (o.fx.retireNational) expect(m.nationalRetired).toBe(true)
            if (o.fx.declineFactor) expect(m.declineFactor).toBeLessThan(1)
            if (o.fx.offerBoost) expect(m.offerBoost).toBe(o.fx.offerBoost)
            if (o.fx.superAgent) expect(m.superAgent).toBe(true)
            if (o.fx.captain === true) expect(m.captainAt).toBe(t.clubId)
            if (o.fx.newPosition) expect(t.identity.position).toBe(o.fx.newPosition)
            if (o.fx.spotlightOff) expect(m.farFromSpotlight).toBe(true)
            if (o.fx.valueMult) expect(m.period.valueMult).toBeCloseTo(o.fx.valueMult)
            if (o.fx.demoteRoleSeasons) expect(!!t.modifiers.roleOverride || (m.period.zeroAppsSeasons ?? 0) > 0).toBe(true)
          }
          // e escolhendo de verdade (simula o período)
          const out = engine.choose(data, s!, opt.id)
          expect(out.state.events.done).toContain(def.key)
          expect(out.reveal.seasons.length).toBeGreaterThan(0)
          if (spec.type === 'join') expect(out.reveal.seasons[0].clubId).toBe(spec.clubId)
          const first = out.reveal.seasons[0]
          const rolled = spec.outcomes.length > 1 ? spec.outcomes.find((o) => o.chip === out.reveal.rolledEffect) : spec.outcomes[0]
          expect(rolled).toBeTruthy()
          const fx = rolled!.fx
          if (fx.ovr !== undefined || fx.temp) expect(first.ovrStart).toBe(Math.max(40, Math.min(99, s!.ovr + (fx.ovr ?? 0) + (fx.temp?.delta ?? 0))))
          if (fx.suspend) {
            expect(first.suspended).toBe(true)
            expect(first.stats.apps).toBe(0)
            expect(first.trophies).toHaveLength(0)
            expect(first.awards).toHaveLength(0)
          }
          if (fx.roleOverride && !fx.suspend) expect(first.role).toBe(fx.roleOverride)
          if (fx.captain === true) expect(first.captain).toBe(true)
          if (fx.newPosition) expect(first.position).toBe(fx.newPosition)
          if (opt.minigame === 'penalty') expect(out.reveal.penalty).toBeDefined()
          expect(out.state.log.some((l) => l.data?.eventKey === def.key)).toBe(true)
        }
      }
    })
  }

  it('apostas: os dois resultados acontecem (roleta com rolledEffect 0 e 1)', () => {
    const base = STATES.star()
    const seen = new Set<number>()
    for (let i = 0; i < 40 && seen.size < 2; i++) {
      const b = cloneState(base)
      mem(b).step = 100 + i
      const s = withPendingEvent(data, b, 'training_extra', 'preseason_camp')!
      const out = engine.choose(data, s, 'training_extra-accept')
      seen.add(out.reveal.rolledEffect!)
    }
    expect([...seen].sort()).toEqual([0, 1])
  })

  it('forçar título: "Jogar no sacrifício" com sucesso dá o título-alvo na 1ª temporada', () => {
    const base = STATES.star()
    let checked = 0
    for (let i = 0; i < 30; i++) {
      const b = cloneState(base)
      mem(b).step = 300 + i
      const s = withPendingEvent(data, b, 'injury_at_peak')!
      const target = (s.pendingDecision!.context!.target as { kind: string; competitionId: string })
      const out = engine.choose(data, s, 'injury_at_peak-play_injured')
      const won = out.reveal.seasons[0].trophies.some((t) => t.competitionId === target.competitionId)
      expect(won).toBe(out.reveal.rolledEffect === 0)
      checked++
    }
    expect(checked).toBe(30)
  })

  it('avô estrangeiro troca a seleção de verdade', () => {
    const s = withPendingEvent(data, STATES.star(), 'foreign_grandfather')!
    const alt = s.pendingDecision!.context!.alternativeNationality as string
    const out = engine.choose(data, s, 'foreign_grandfather-switch_national_team')
    expect(out.state.identity.nationality).toBe(alt)
    expect(out.state.seasons[out.state.seasons.length - 1].nationality).toBe(alt)
  })

  it('aposentadoria da seleção: sem convocações depois', () => {
    let s = withPendingEvent(data, STATES.veteran(), 'national_retirement')!
    s = engine.choose(data, s, 'national_retirement-retire_national').state
    expect(s.seasons.slice(-2).every((r) => !r.national)).toBe(true)
  })

  it('cada evento acontece no máximo uma vez por carreira', () => {
    const s = STATES.star()
    s.events.done = EVENTS.map((e) => e.key)
    s.events.slots = [22, 26]
    mem(s).slotsDone = []
    s.events.lastEventAge = 0
    for (let i = 0; i < 30; i++) {
      mem(s).step = 500 + i
      const d = tryEventDecision(data, s)
      if (d) expect(d.kind).toBe('injury')
    }
  })
})

describe('lesões', () => {
  it('pré-sorteio de 2% por janela de evento vencida', () => {
    const s = STATES.star()
    s.events.slots = [22]
    mem(s).slotsDone = []
    let inj = 0
    const N = 4000
    for (let i = 0; i < N; i++) {
      mem(s).step = i
      const d = tryEventDecision(data, s)
      if (d?.kind === 'injury') inj++
    }
    expect(inj / N).toBeGreaterThan(0.012)
    expect(inj / N).toBeLessThan(0.03)
  })

  it('lesão: −OVR, só a 1ª temporada afetada (grave: reserva; moderada: um degrau), contador (máx. 2)', () => {
    const kinds = new Set<boolean>()
    for (let i = 0; i < 24; i++) {
      const b = STATES.star()
      b.pace = 'expressa'
      mem(b).step = 700 + i
      const s = withPendingEvent(data, b, 'injury')!
      const d = s.pendingDecision!
      expect(d.kind).toBe('injury')
      const inj = INJURIES.find((x) => x.id === d.variant)!
      expect(d.title).toBe(inj.name)
      const out = engine.choose(data, s, d.options[0].id)
      const [first, ...rest] = out.reveal.seasons
      expect(first.ovrStart).toBe(Math.max(40, s.ovr + inj.ovr))
      expect(first.injury?.id).toBe(inj.id)
      const club = data.clubs.find((c) => c.id === first.clubId)!
      const natural = roleFromDelta(first.ovrStart - clubStrength(s.world, club), false)
      kinds.add(isSevereInjury(inj))
      if (isSevereInjury(inj)) expect(first.role).toBe('substitute')
      else expect(first.role).toBe(shiftRole(natural, false, -1))
      // as temporadas seguintes do período não carregam a lesão (no Expressa eram 3 anos de banco)
      expect(rest.length).toBeGreaterThan(0)
      for (const r of rest) expect(r.injury).toBeUndefined()
      expect(rest.some((r) => r.role !== 'substitute')).toBe(true)
      expect(out.state.events.injuries).toBe(1)
      expect(out.state.log.some((l) => l.type === 'injury')).toBe(true)
    }
    expect(kinds.size).toBe(2)
    const s = STATES.star()
    s.events.injuries = 2
    s.events.slots = [22]
    mem(s).slotsDone = []
    for (let i = 0; i < 500; i++) {
      mem(s).step = i
      expect(tryEventDecision(data, s)?.kind).not.toBe('injury')
    }
  })
})

describe('agenda na prática', () => {
  it('eventos só entre 22 e 37 anos e respeitando o cooldown', () => {
    for (let k = 0; k < 6; k++) {
      let s = engine.newCareer(data, identity(), 'intensa', `agenda-${k}`)
      const ages: number[] = []
      while (!s.retired) {
        const d = s.pendingDecision!
        if (d.kind === 'event' || d.kind === 'injury') ages.push(s.age)
        s = engine.choose(data, s, d.options.find((o) => !o.id.startsWith('retire-'))?.id ?? d.options[0].id).state
      }
      for (const a of ages) expect(a >= 22 && a <= 37).toBe(true)
      for (let i = 1; i < ages.length; i++) expect(ages[i] - ages[i - 1]).toBeGreaterThanOrEqual(2)
      expect(careerMemory(s).slotsDone.length).toBe(ages.length)
    }
  })
})
