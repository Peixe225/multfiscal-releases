import { beforeEach, describe, expect, it } from 'vitest'
import { coinsLabel, fmtCoins } from '@/ui/live/bits'
import { isPenaltyRound, outcomeWhy } from '@/ui/live/LiveHud'
import { DEFAULT_LIVE_CONFIG, bindingConflict, dedupeBindings, useLiveConfig } from './config'
import { applyEvent, createRound, decide, type VoteRules } from './votes'

describe('presente de cada opção', () => {
  beforeEach(() => useLiveConfig.setState({ config: { ...DEFAULT_LIVE_CONFIG, giftBindings: ['Rose', 'TikTok', 'GG', 'Ice Cream Cone'] } }))

  it('o mesmo presente nunca fica em duas opções: escolher um presente já usado troca os dois', () => {
    useLiveConfig.getState().setBinding(2, 'Rose')
    expect(useLiveConfig.getState().config.giftBindings).toEqual(['GG', 'TikTok', 'Rose', 'Ice Cream Cone'])
    // "Rosa" (nome em português) é o mesmo presente que "Rose"
    useLiveConfig.getState().setBinding(0, 'Rosa')
    expect(useLiveConfig.getState().config.giftBindings).toEqual(['Rosa', 'TikTok', 'GG', 'Ice Cream Cone'])
  })

  it('opção sem presente que pega um presente usado deixa a outra sem presente', () => {
    useLiveConfig.getState().setBinding(3, '')
    useLiveConfig.getState().setBinding(3, 'TikTok')
    expect(useLiveConfig.getState().config.giftBindings).toEqual(['Rose', '', 'GG', 'TikTok'])
  })

  it('acha o conflito e limpa repetições de configurações antigas', () => {
    expect(bindingConflict(['Rose', 'TikTok', 'GG', ''], 3, 'Rosa')).toBe(0)
    expect(bindingConflict(['Rose', 'TikTok', 'GG', ''], 0, 'Rose')).toBe(-1)
    expect(bindingConflict(['Rose', 'TikTok', 'GG', ''], 1, '')).toBe(-1)
    expect(dedupeBindings(['GG', 'TikTok', 'GG', 'Ice Cream Cone'])).toEqual(['GG', 'TikTok', '', 'Ice Cream Cone'])
    expect(dedupeBindings(['Rose', 'Rosa', '', ''])).toEqual(['Rose', '', '', ''])
  })
})

describe('moedas na tela', () => {
  it('singular, milhar sem ",0" e milhar quebrado', () => {
    expect(coinsLabel(1)).toBe('1 moeda')
    expect(coinsLabel(30)).toBe('30 moedas')
    expect(fmtCoins(1000)).toBe('1 mil')
    expect(fmtCoins(1100)).toBe('1,1 mil')
    expect(coinsLabel(2000)).toBe('2 mil moedas')
    expect(fmtCoins(12500)).toBe('13 mil')
  })
})

describe('faixa da live', () => {
  const RULES: VoteRules = { commentVotes: true, commentPoints: 1, pointsPerCoin: 10, giftBindings: ['Rose', 'TikTok', 'GG', ''], instantWinCoins: 0, unboundGiftsFollowComment: true }
  const r0 = () => createRound({ id: 'r', kind: 'decision', title: 'T', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], seconds: 20 }, 0)

  it('empate nos votos decidido nas moedas aparece como desempate, não como "50% dos votos"', () => {
    let r = r0()
    for (let i = 0; i < 10; i++) r = applyEvent(r, { type: 'chat', user: { id: `u${i}`, name: `u${i}` }, text: '1', at: 0 }, RULES).round
    // 1 TikTok (1 moeda = 10 pontos) na opção 2: 10 × 10, mas a 2 tem moedas
    r = applyEvent(r, { type: 'gift', user: { id: 'g', name: 'g' }, gift: { id: 'tiktok', name: 'TikTok', coins: 1 }, count: 1, at: 0 }, RULES).round
    const out = decide({ ...r, closed: true })
    expect(out).toEqual({ winner: 1, reason: 'tie-break', tieBy: 'coins' })
    expect(outcomeWhy(r, out)).toBe('Empate nos votos — venceu quem mandou mais moedas')
    expect(outcomeWhy(r, { winner: 0, reason: 'tie-break', tieBy: 'coins' })).toBe('Empate nos votos — venceu quem mandou mais moedas')
    expect(outcomeWhy(r, { winner: 0, reason: 'tie-break', tieBy: 'voters' })).toBe('Empate nos votos — venceu a opção com mais gente')
    expect(outcomeWhy(r, { winner: 0, reason: 'tie-break', tieBy: 'draw' })).toBe('Empate total: decidido no sorteio')
    expect(outcomeWhy(r0(), { winner: 1, reason: 'no-votes' })).toBe('Ninguém votou: sorteio')
  })

  it('reconhece a votação do pênalti (zonas do gol) para mostrar o placar na faixa', () => {
    const pen = createRound({ id: 'p', kind: 'decision', title: 'Pênalti', options: [{ id: 'x:left', label: 'Esquerda' }, { id: 'x:center', label: 'Meio' }, { id: 'x:right', label: 'Direita' }], seconds: 20 }, 0)
    expect(isPenaltyRound(pen)).toBe(true)
    expect(isPenaltyRound(r0())).toBe(false)
    expect(isPenaltyRound({ ...pen, kind: 'identity' })).toBe(false)
    expect(isPenaltyRound(null)).toBe(false)
  })
})
