import { describe, expect, it } from 'vitest'
import { HISTORIC_RECORDS, REAL_LEGENDS } from '../../../data/catalog/legends'
import { Rng, rng } from '../../rng'
import { DEV_TABLES } from '../constants'
import {
  ageValueFactor,
  cycleTarget,
  leagueValueFactor,
  marketValue,
  roleFromDelta,
  rollCycle,
  roundMoney,
  shiftRole,
  valueFromCurve,
} from '../player'
import { clubBoost, deltaBucket, qualityFactor } from '../season'
import { callUpOvr, clubArticle, withArticle } from '../util'
import { data, engine, identity, playCareer } from '../__fixtures__/play'

describe('corte de convocação (callUpOvr)', () => {
  it('potências 80–82, médias ~74–76, fracas bem abaixo; cresce com a força da seleção', () => {
    expect(callUpOvr({ strength: 94 })).toBe(82) // Espanha
    expect(callUpOvr({ strength: 89 })).toBe(81) // Brasil (antes 84: um 83 do Barça ficava de fora)
    expect(callUpOvr({ strength: 87 })).toBe(80) // Alemanha
    expect(callUpOvr({ strength: 82 })).toBe(76) // Uruguai/Suíça
    expect(callUpOvr({ strength: 80 })).toBe(74) // EUA/México/Japão
    expect(callUpOvr({ strength: 70 })).toBe(65)
    expect(callUpOvr({ strength: 40 })).toBe(44)
    let prev = 0
    for (let x = 35; x <= 99; x++) {
      const v = callUpOvr({ strength: x })
      expect(v).toBeGreaterThanOrEqual(prev)
      expect(v).toBeLessThanOrEqual(82)
      prev = v
    }
  })
})

describe('papel no elenco (força do clube = média do melhor XI)', () => {
  it('linha: titular ≥−2, rotação ≥−6, rotação baixa ≥−10, reserva abaixo', () => {
    expect(roleFromDelta(0, false)).toBe('starter')
    expect(roleFromDelta(-2, false)).toBe('starter')
    expect(roleFromDelta(-2.1, false)).toBe('high_rotation')
    // um 83 num Barcelona de 88: rotação (25–35 jogos), não banco
    expect(roleFromDelta(-5, false)).toBe('high_rotation')
    expect(roleFromDelta(-6, false)).toBe('high_rotation')
    expect(roleFromDelta(-7, false)).toBe('low_rotation')
    expect(roleFromDelta(-10, false)).toBe('low_rotation')
    expect(roleFromDelta(-11, false)).toBe('substitute')
  })
  it('goleiro: titular ≥−2, reserva ≥−7, terceiro goleiro abaixo', () => {
    expect(roleFromDelta(0, true)).toBe('starter')
    expect(roleFromDelta(-2, true)).toBe('starter')
    expect(roleFromDelta(-3, true)).toBe('substitute')
    expect(roleFromDelta(-7, true)).toBe('substitute')
    expect(roleFromDelta(-8, true)).toBe('third_keeper')
  })
  it('deslocamento de papel respeita a escada e as pontas', () => {
    expect(shiftRole('starter', false, -1)).toBe('high_rotation')
    expect(shiftRole('substitute', false, -1)).toBe('substitute')
    expect(shiftRole('starter', false, 3)).toBe('starter')
    expect(shiftRole('starter', true, -1)).toBe('substitute')
    expect(shiftRole('low_rotation', true, 0)).toBe('substitute')
  })
  it('boost no clube: craque titular a +8 ≈ 2,5–4; reserva 0', () => {
    expect(clubBoost(8, 'starter')).toBeGreaterThanOrEqual(2.5)
    expect(clubBoost(8, 'starter')).toBeLessThanOrEqual(4)
    expect(clubBoost(8, 'substitute')).toBe(0)
    expect(clubBoost(-10, 'starter')).toBe(0)
  })
})

describe('desenvolvimento (tabelas de 2 anos do Copero)', () => {
  it('idade-alvo e congelamento aos 38–39', () => {
    expect(cycleTarget(16)).toBe(18)
    expect(cycleTarget(17)).toBe(18)
    expect(cycleTarget(38)).toBe(40)
    const c = rollCycle(new Rng(1), 38, 'normal', 'CA', 'starter')
    expect(c.parts).toEqual([0, 0])
  })
  it('as duas partes somam um valor dentro da faixa da tabela', () => {
    for (let i = 0; i < 500; i++) {
      const age = 16 + 2 * (i % 11)
      const c = rollCycle(rng('dev', i), age, 'normal', 'CA', 'starter')
      const [lo, hi] = DEV_TABLES.normal[cycleTarget(age)]
      const total = c.parts[0] + c.parts[1]
      expect(total).toBeGreaterThanOrEqual(lo)
      expect(total).toBeLessThanOrEqual(hi)
    }
  })
  it('goleiro usa a tabela própria', () => {
    for (let i = 0; i < 200; i++) {
      const c = rollCycle(rng('gk', i), 28, 'early', 'GOL', 'starter')
      const total = c.parts[0] + c.parts[1]
      expect(total).toBeGreaterThanOrEqual(DEV_TABLES.gk[30][0])
      expect(total).toBeLessThanOrEqual(DEV_TABLES.gk[30][1])
    }
  })
  it('penalidade de banco a partir dos 22 (mínimo de 2 sorteios)', () => {
    let starter = 0
    let bench = 0
    for (let i = 0; i < 2000; i++) {
      const a = rollCycle(rng('b', i), 22, 'normal', 'CA', 'starter')
      const b = rollCycle(rng('b', i), 22, 'normal', 'CA', 'substitute')
      starter += a.parts[0] + a.parts[1]
      bench += b.parts[0] + b.parts[1]
    }
    expect(bench / 2000).toBeLessThan(starter / 2000 - 1)
  })
  it('OVR sempre entre 40 e 99', () => {
    for (let k = 0; k < 6; k++) {
      const { state } = playCareer(`clamp-${k}`, 'intensa')
      for (const r of state.seasons) {
        expect(r.ovrEnd).toBeGreaterThanOrEqual(40)
        expect(r.ovrEnd).toBeLessThanOrEqual(99)
      }
    }
  })
})

describe('valor de mercado (curva do Copero)', () => {
  it('pontos da curva e interpolação', () => {
    expect(valueFromCurve(50)).toBe(100_000)
    expect(valueFromCurve(85)).toBe(50_000_000)
    expect(valueFromCurve(99)).toBe(250_000_000)
    expect(valueFromCurve(52.5)).toBe(175_000)
    expect(valueFromCurve(30)).toBe(100_000)
  })
  it('fatores de idade e de liga', () => {
    expect(ageValueFactor(17)).toBe(1.5)
    expect(ageValueFactor(22)).toBe(1.2)
    expect(ageValueFactor(26)).toBe(1)
    expect(ageValueFactor(30)).toBe(0.9)
    expect(ageValueFactor(32)).toBe(0.8)
    expect(ageValueFactor(34)).toBe(0.6)
    expect(ageValueFactor(35)).toBe(0.2)
    expect(leagueValueFactor(1)).toBeCloseTo(1.15)
    expect(leagueValueFactor(0.3)).toBeCloseTo(0.75)
  })
  it('arredondamento e casos das capturas de tela (liga média)', () => {
    expect(roundMoney(12_345_678)).toBe(12_000_000)
    expect(roundMoney(5_123_456)).toBe(5_100_000)
    expect(roundMoney(376_000)).toBe(380_000)
    // 55 aos 17 ≈ €380K; 84 aos 25 ≈ €45M (Brasileirão ≈ fator 1)
    const v55 = marketValue(rng('v', 1), 55, 17, 0.65)
    expect(v55).toBeGreaterThan(330_000)
    expect(v55).toBeLessThan(430_000)
    const v84 = marketValue(rng('v', 2), 84, 25, 0.65)
    expect(v84).toBeGreaterThan(38_000_000)
    expect(v84).toBeLessThan(50_000_000)
  })
})

describe('gols e assistências (taxas do Copero)', () => {
  it('faixas de delta e fator de qualidade', () => {
    expect(deltaBucket(10)).toBe(0)
    expect(deltaBucket(6)).toBe(1)
    expect(deltaBucket(3)).toBe(2)
    expect(deltaBucket(-2)).toBe(3)
    expect(deltaBucket(-5)).toBe(4)
    expect(deltaBucket(-9)).toBe(5)
    expect(deltaBucket(-10)).toBe(6)
    expect(qualityFactor(65)).toBeCloseTo(0.6)
    expect(qualityFactor(80)).toBeCloseTo(0.85)
    expect(qualityFactor(85)).toBeCloseTo(1)
    expect(qualityFactor(99)).toBeCloseTo(1.1)
  })
  it('atacantes marcam muito mais que zagueiros; goleiro tem SG e gols sofridos', () => {
    const goals = (pos: 'CA' | 'ZAG' | 'GOL') => {
      let g = 0
      let cs = 0
      for (let k = 0; k < 4; k++) {
        const { state } = playCareer(`g-${pos}-${k}`, 'normal', undefined, identity(pos))
        for (const r of state.seasons) {
          g += r.stats.goals
          cs += r.stats.cleanSheets ?? 0
          if (pos === 'GOL' && r.stats.apps > 0) expect(r.stats.conceded).toBeDefined()
        }
      }
      return { g, cs }
    }
    const ca = goals('CA')
    const zag = goals('ZAG')
    const gol = goals('GOL')
    expect(ca.g).toBeGreaterThan(zag.g * 3)
    expect(gol.g).toBe(0)
    expect(gol.cs).toBeGreaterThan(0)
  })
})

describe('textos pt-BR', () => {
  it('artigo do clube (no/na) corrige o "no Juventus" do Copero', () => {
    expect(clubArticle({ name: 'Juventus', shortName: 'Juventus' })).toBe('a')
    expect(clubArticle({ name: 'Palmeiras', shortName: 'Palmeiras' })).toBe('o')
    expect(clubArticle({ name: 'Chapecoense', shortName: 'Chapecoense' })).toBe('a')
    expect(clubArticle({ name: 'Internacional', shortName: 'Inter' })).toBe('o')
    expect(withArticle('em', { name: 'Roma', shortName: 'Roma' })).toBe('na')
    expect(withArticle('a', { name: 'Flamengo', shortName: 'Flamengo' })).toBe('ao')
  })
  it('nenhum resquício de espanhol nos textos de decisão', () => {
    for (let k = 0; k < 3; k++) {
      const { decisions } = playCareer(`txt-${k}`, 'intensa')
      for (const d of decisions) {
        const text = [d.title, d.description, ...d.options.flatMap((o) => [o.label, o.title ?? '', ...o.effects.map((e) => e.label)])].join(' ')
        expect(text).not.toMatch(/madurez|salida|Volver a|jugador|equipo /i)
      }
    }
  })
  it('resumo: manchete e comparações com lendas reais', () => {
    const { state } = playCareer('sum-legends', 'normal')
    const sum = engine.summarize(data, state)
    expect(typeof sum.headline).toBe('string')
    // comparações vêm da base curada do Hall das Lendas (src/data/catalog/legends.ts)
    const names = [...REAL_LEGENDS.map((l) => l.name), ...HISTORIC_RECORDS.map((r) => r.holder)]
    for (const c of sum.comparisons) expect(names.some((n) => c.includes(n))).toBe(true)
    expect(sum.clubs.reduce((t, c) => t + c.seasons, 0)).toBe(state.seasons.length)
    expect(sum.totals.apps).toBe(state.seasons.reduce((t, r) => t + r.stats.apps, 0) + state.national.apps)
    expect(sum.trophies.reduce((t, g) => t + g.count, 0)).toBe(state.seasons.reduce((t, r) => t + r.trophies.length, 0))
  })
})
