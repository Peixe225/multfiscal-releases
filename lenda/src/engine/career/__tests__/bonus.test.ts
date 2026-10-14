/** Bônus de OVR (indicações / compartilhar no site): `newCareer(…, { bonusOvr })`. */
import { describe, expect, it } from 'vitest'
import { data, engine, identity, playCareer, randomPolicy } from '../__fixtures__/play'
import { BONUS_OVR_MAX, START_OVR, clampBonusOvr } from '../constants'
import { summarize } from '../summary'

function play(seed: string, bonus: number) {
  let s = engine.newCareer(data, identity(), 'normal', seed, { bonusOvr: bonus })
  const pol = randomPolicy(seed)
  for (let i = 0; i < 200 && !s.retired; i++) s = engine.choose(data, s, pol(s.pendingDecision!, s, i)).state
  return s
}
const mediaOvr = (s: ReturnType<typeof play>) => s.seasons.reduce((a, r) => a + r.ovrEnd, 0) / s.seasons.length
const mediana = (l: number[]) => [...l].sort((a, b) => a - b)[Math.floor(l.length / 2)]

describe('bônus de OVR', () => {
  it('sem bônus (ou bônus 0) a carreira é idêntica à de sempre: mesma semente → mesmo resultado', () => {
    const base = playCareer('bonus-igual', 'normal')
    let s = engine.newCareer(data, identity(), 'normal', 'bonus-igual', { bonusOvr: 0 })
    const pol = randomPolicy('bonus-igual')
    for (let i = 0; i < 200 && !s.retired; i++) s = engine.choose(data, s, pol(s.pendingDecision!, s, i)).state
    expect('bonusOvr' in s).toBe(false)
    expect(JSON.stringify(s)).toBe(JSON.stringify(base.state))
    expect(summarize(data, s)).toEqual(summarize(data, base.state))
  }, 60_000)

  it('começa N pontos acima, guarda CareerState.bonusOvr e diz no diário', () => {
    const s = engine.newCareer(data, identity(), 'normal', 'bonus-inicio', { bonusOvr: 3 })
    expect(s.ovr).toBe(START_OVR + 3)
    expect(s.bonusOvr).toBe(3)
    expect(s.log[0].text).toContain('OVR 53 (+3 de bônus)')
    // a oferta da base já é para um jogador de 53 (o papel previsto usa o OVR com bônus)
    expect(s.pendingDecision?.kind).toBe('academy')
  })

  it('fica N acima do normal durante a carreira inteira (OVR médio e pico), de forma determinística', () => {
    for (const n of [3, 6]) {
      const dif: number[] = []
      const picos: number[] = []
      for (let i = 0; i < 6; i++) {
        const a = play(`bonus-ao-longo-${i}`, 0)
        const b = play(`bonus-ao-longo-${i}`, n)
        expect(b.bonusOvr).toBe(n)
        dif.push(mediaOvr(b) - mediaOvr(a))
        picos.push(summarize(data, b).peakOvr - summarize(data, a).peakOvr)
      }
      const m = dif.reduce((x, y) => x + y, 0) / dif.length
      expect(m).toBeGreaterThan(n - 1.5)
      expect(m).toBeLessThan(n + 2)
      expect(mediana(picos)).toBe(n)
    }
    // mesma semente e mesmo bônus → mesma carreira
    expect(JSON.stringify(play('bonus-det', 4))).toBe(JSON.stringify(play('bonus-det', 4)))
  }, 120_000)

  it('o pico do resumo nunca fica abaixo do OVR inicial com bônus', () => {
    const s = engine.newCareer(data, identity(), 'normal', 'bonus-pico', { bonusOvr: 7 })
    expect(summarize(data, s).peakOvr).toBe(57)
  })

  it('limites: 0 a 10, inteiro', () => {
    expect(clampBonusOvr(undefined)).toBe(0)
    expect(clampBonusOvr(-3)).toBe(0)
    expect(clampBonusOvr(Number.NaN)).toBe(0)
    expect(clampBonusOvr('5')).toBe(0)
    expect(clampBonusOvr(2.6)).toBe(3)
    expect(clampBonusOvr(42)).toBe(BONUS_OVR_MAX)
    expect(engine.newCareer(data, identity(), 'normal', 'bonus-teto', { bonusOvr: 99 }).ovr).toBe(START_OVR + BONUS_OVR_MAX)
  })
})
