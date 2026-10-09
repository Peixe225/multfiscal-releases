import { describe, expect, it } from 'vitest'
import { createStreakTracker, parseMessage, resolveGift } from './protocol'
import { applyEvent, createRound, decide, leaders, parseVote, percents, shouldExtend, type Round, type VoteRules } from './votes'
import { cleanFixed, makeCountryFinder, nationChoices, parseCreatorCommand, safeName, surnameFromNick } from './identity'
import { sameGift } from './gifts'
import type { LiveEvent, RawGiftEvent } from './types'

const RULES: VoteRules = {
  commentVotes: true,
  commentPoints: 1,
  pointsPerCoin: 10,
  giftBindings: ['Rose', 'TikTok', 'GG', 'Ice Cream Cone'],
  instantWinCoins: 0,
  unboundGiftsFollowComment: true,
}
const u = (id: string) => ({ id, name: id })
const chat = (id: string, text: string): LiveEvent => ({ type: 'chat', user: u(id), text, at: 0 })
const gift = (id: string, name: string, coins: number, count = 1): LiveEvent => ({ type: 'gift', user: u(id), gift: { id: name, name, coins }, count, at: 0 })
const round = (n = 3): Round => createRound({ id: 'r1', kind: 'decision', title: 'T', options: Array.from({ length: n }, (_, i) => ({ id: `o${i}`, label: `Opção ${i + 1}` })), seconds: 20 }, 0)
const run = (r: Round, evs: LiveEvent[], rules = RULES) => evs.reduce((acc, e) => applyEvent(acc, e, rules).round, r)

describe('parseVote', () => {
  it('reads numbers in the common chat forms', () => {
    expect(parseVote('2', 3)).toBe(1)
    expect(parseVote(' #3!!', 3)).toBe(2)
    expect(parseVote('opção 1', 3)).toBe(0)
    expect(parseVote('voto 2 kkk', 3)).toBe(1)
    expect(parseVote('vou de 3', 3)).toBe(2)
  })
  it('ignores numbers out of range and longer numbers', () => {
    expect(parseVote('4', 3)).toBeNull()
    expect(parseVote('10', 3)).toBeNull()
    expect(parseVote('2024 é o ano', 3)).toBeNull()
    expect(parseVote('o 2 é melhor', 3)).toBeNull()
  })
})

describe('votes', () => {
  it('one comment vote per person; a new number moves it', () => {
    const r = run(round(), [chat('ana', '1'), chat('ana', '1'), chat('bia', '2'), chat('ana', '2')])
    expect(r.tallies.map((t) => t.points)).toEqual([0, 2, 0])
    expect(r.tallies.map((t) => t.voters)).toEqual([0, 2, 0])
  })
  it('bound gifts score coins × points per coin for their option', () => {
    const r = run(round(), [gift('ana', 'Rose', 1, 5), gift('bia', 'TikTok', 1)])
    expect(r.tallies.map((t) => t.points)).toEqual([50, 10, 0])
    expect(r.tallies[0].coins).toBe(5)
  })
  it('unbound gifts follow the last commented number, and are ignored without one', () => {
    const r = run(round(), [gift('ana', 'Perfume', 20), chat('ana', '3'), gift('ana', 'Perfume', 20)])
    expect(r.tallies.map((t) => t.points)).toEqual([0, 0, 201])
  })
  it('a gift bound to an option beyond the round size does not count', () => {
    const r = run(round(2), [gift('ana', 'GG', 1)])
    expect(r.tallies.map((t) => t.points)).toEqual([0, 0])
  })
  it('gifters keep backing an option even after moving their comment vote', () => {
    const r = run(round(), [chat('ana', '1'), gift('ana', 'Rose', 1), chat('ana', '2')])
    expect(r.tallies[0].voters).toBe(1)
    expect(r.tallies[1].voters).toBe(1)
    expect(r.tallies[0].points).toBe(10)
  })
  it('comment votes can be switched off (numbers still route loose gifts)', () => {
    const rules = { ...RULES, commentVotes: false }
    const r = run(round(), [chat('ana', '2'), gift('ana', 'Doughnut', 30)], rules)
    expect(r.tallies.map((t) => t.points)).toEqual([0, 300, 0])
  })
  it('a big gift decides instantly when enabled', () => {
    const rules = { ...RULES, instantWinCoins: 1000 }
    const r0 = round()
    const res = applyEvent(run(r0, [chat('x', '1'), chat('y', '1')], rules), gift('rico', 'Galaxy', 1000), rules)
    expect(res.decided).toBe(false) // presente "solto" sem comentário não tem opção
    const r1 = run(r0, [chat('rico', '3')], rules)
    const res2 = applyEvent(r1, gift('rico', 'Galaxy', 1000), rules)
    expect(res2.decided).toBe(true)
    expect(decide(res2.round)).toEqual({ winner: 2, reason: 'instant' })
    expect(applyEvent(res2.round, chat('z', '1'), rules).round).toBe(res2.round)
  })
  it('decides by points, then coins, then voters; no votes → stable draw', () => {
    expect(decide(run(round(), [chat('a', '2'), chat('b', '2'), chat('c', '1')])).winner).toBe(1)
    // 10 pontos cada: o presente (mais moedas) vence os 10 comentários
    const many = Array.from({ length: 10 }, (_, i) => chat(`v${i}`, '1'))
    expect(decide(run(round(), [...many, gift('g', 'TikTok', 1)])).winner).toBe(1)
    const empty = decide(round())
    expect(empty.reason).toBe('no-votes')
    expect(decide(round()).winner).toBe(empty.winner)
  })
  it('percents add up to 100 and extension happens once on a tie', () => {
    const r = run(round(), [chat('a', '1'), chat('b', '2'), chat('c', '3')])
    expect(percents(r).reduce((s, x) => s + x, 0)).toBe(100)
    expect(leaders(r)).toHaveLength(3)
    expect(shouldExtend(r, r.endsAt, true)).toBe(true)
    expect(shouldExtend({ ...r, extended: true }, r.endsAt, true)).toBe(false)
    expect(shouldExtend(r, r.endsAt, false)).toBe(false)
  })
})

describe('protocol', () => {
  const raw = (repeat: number, end: boolean, streakable = true): RawGiftEvent => ({ type: 'gift-raw', user: u('ana'), gift: { id: '5655', name: 'Rose', coins: 1 }, repeat, streakable, streakEnd: end, at: 0 })
  it('counts streak gifts once (single send = 2 events)', () => {
    const t = createStreakTracker()
    expect([raw(1, false), raw(1, true)].map(t)).toEqual([1, 0])
  })
  it('counts streak deltas', () => {
    const t = createStreakTracker()
    expect([1, 2, 3, 4, 5].map((r) => t(raw(r, false))).concat(t(raw(5, true)))).toEqual([1, 1, 1, 1, 1, 0])
    // nova sequência depois do fim
    expect(t(raw(2, true))).toBe(2)
  })
  it('non-streak gifts count repeat', () => {
    const t = createStreakTracker()
    expect(t(raw(1, false, false))).toBe(1)
    expect(resolveGift(raw(1, true), t)?.type).toBe('gift')
  })
  it('parses TikTok-Live-Connector v1 flat and v2 nested payloads (TikFinity)', () => {
    const v1 = parseMessage(JSON.stringify({ event: 'gift', data: { uniqueId: 'ana', nickname: 'Ana', giftId: 5655, giftName: 'Rose', diamondCount: 1, repeatCount: 3, repeatEnd: true, giftType: 1 } }))
    expect(v1[0]).toMatchObject({ type: 'gift-raw', user: { id: 'ana', name: 'Ana' }, gift: { id: '5655', name: 'Rose', coins: 1 }, repeat: 3, streakable: true, streakEnd: true })
    const v2 = parseMessage({ event: 'gift', data: { user: { uniqueId: 'bia', nickname: 'Bia', profilePicture: { url: ['https://x/a.jpg'] } }, giftId: 5269, repeatCount: 1, repeatEnd: 0, giftDetails: { giftName: 'TikTok', diamondCount: 1, giftType: 1, icon: { url: ['https://x/g.webp'] } } } })
    expect(v2[0]).toMatchObject({ type: 'gift-raw', user: { id: 'bia', avatar: 'https://x/a.jpg' }, gift: { name: 'TikTok', coins: 1, image: 'https://x/g.webp' }, streakEnd: false })
    expect(parseMessage({ event: 'chat', data: { uniqueId: 'c', comment: '2' } })[0]).toMatchObject({ type: 'chat', text: '2' })
    expect(parseMessage({ event: 'like', data: { uniqueId: 'c', likeCount: 15, totalLikeCount: 300 } })[0]).toMatchObject({ type: 'like', count: 15, total: 300 })
    expect(parseMessage({ event: 'roomUser', data: { viewerCount: 42 } })[0]).toMatchObject({ type: 'viewers', count: 42 })
    expect(parseMessage({ event: 'social', data: { uniqueId: 'c', displayType: 'pm_mt_msg_viewer_follow' } })[0]).toMatchObject({ type: 'follow' })
  })
  it('parses the real TikTok-Live-Connector 2.x shapes (displayId, content, gift.name, count/total)', () => {
    const user = { id: '7663906417342170134', nickname: 'Gabi ⚽', displayId: 'gabi.fut', avatarThumb: { urlList: ['https://p16/a.webp'] } }
    expect(parseMessage({ event: 'chat', data: { user, content: '2' } })[0]).toMatchObject({ type: 'chat', user: { id: 'gabi.fut', name: 'Gabi ⚽', avatar: 'https://p16/a.webp' }, text: '2' })
    expect(parseMessage({ event: 'like', data: { user, count: 12, total: '1160275' } })[0]).toMatchObject({ type: 'like', count: 12, total: 1160275 })
    expect(parseMessage({ event: 'roomUser', data: { total: 1651, totalUser: 5131432 } })[0]).toMatchObject({ type: 'viewers', count: 1651 })
    const g = parseMessage({ event: 'gift', data: { user, giftId: '5655', repeatCount: 4, repeatEnd: 0, groupId: '123', gift: { id: '5655', name: 'Rose', diamondCount: 1, type: 1, icon: { urlList: ['https://p16/rose.webp'] } } } })[0]
    expect(g).toMatchObject({ type: 'gift-raw', user: { id: 'gabi.fut' }, gift: { id: '5655', name: 'Rose', coins: 1, image: 'https://p16/rose.webp' }, repeat: 4, streakable: true, streakEnd: false, group: '123' })
  })
  it('parses the bridge format and ignores junk', () => {
    expect(parseMessage('{"type":"status","status":{"state":"connected","user":"eu"}}')[0]).toEqual({ type: 'status', status: { state: 'connected', user: 'eu' } })
    expect(parseMessage({ type: 'gifts', list: [{ id: 1, name: 'Rose', coins: 1 }] })[0]).toEqual({ type: 'gifts', list: [{ id: '1', name: 'Rose', coins: 1 }] })
    expect(parseMessage({ type: 'gift-raw', user: { id: 'a', name: 'A' }, gift: { id: 'g', name: 'GG', coins: 1 }, repeat: 2, streakable: true, streakEnd: false })[0]).toMatchObject({ gift: { name: 'GG' }, repeat: 2 })
    expect(parseMessage('not json')).toEqual([])
    expect(parseMessage({ event: 'unknown', data: {} })).toEqual([])
    expect(parseMessage([{ type: 'viewers', count: 3 }, { type: 'viewers', count: 4 }])).toHaveLength(2)
  })
})

describe('identity & gifts', () => {
  it('turns nicknames into shirt names, filtering profanity', () => {
    expect(surnameFromNick('Gabi Futebol ⚽')).toBe('FUTEBOL')
    expect(surnameFromNick('joão_pedro10')).toBe('PEDRO')
    expect(surnameFromNick('caralhudo')).toBeNull()
    expect(surnameFromNick('xx')).toBeNull()
    expect(surnameFromNick('Supercalifragilisticoespialidoso')?.length).toBe(15)
    expect(cleanFixed('  de bruyne ')).toBe('DE BRUYNE')
  })
  it('nation choices always include Brazil plus 3 distinct others', () => {
    const c = nationChoices(7)
    expect(c[0]).toBe('BRA')
    expect(new Set(c).size).toBe(4)
  })
  it('matches gifts by English name, Portuguese name or id', () => {
    expect(sameGift({ id: '5655', name: 'Rose' }, 'Rose')).toBe(true)
    expect(sameGift({ id: '5655', name: 'Rose' }, 'Rosa')).toBe(true)
    expect(sameGift({ id: '5655', name: 'rose' }, '5655')).toBe(true)
    expect(sameGift({ id: '1', name: 'GG' }, 'Rose')).toBe(false)
  })
})

describe('creator commands (top donor builds the legend)', () => {
  const find = makeCountryFinder([
    { code: 'BRA', name: 'Brasil' },
    { code: 'ARG', name: 'Argentina' },
    { code: 'USA', name: 'Estados Unidos' },
    { code: 'NED', name: 'Países Baixos' },
    { code: 'JPN', name: 'Japão' },
    { code: 'POR', name: 'Portugal' },
  ])
  it('finds countries by name, code, accent-free text, aliases and unique prefix', () => {
    expect(find('Brasil')).toBe('BRA')
    expect(find('arg')).toBe('ARG')
    expect(find('japao')).toBe('JPN')
    expect(find('EUA')).toBe('USA')
    expect(find('holanda')).toBe('NED')
    expect(find('portu')).toBe('POR')
    expect(find('França')).toBeNull()
  })
  it('reads single commands with or without "!" and separators', () => {
    expect(parseCreatorCommand('!nome Gabigol', find)?.draft).toEqual({ surname: 'GABIGOL' })
    expect(parseCreatorCommand('nome: de bruyne', find)?.draft).toEqual({ surname: 'DE BRUYNE' })
    expect(parseCreatorCommand('!país Argentina', find)?.draft).toEqual({ nationality: 'ARG' })
    expect(parseCreatorCommand('!posicao goleiro', find)?.draft).toEqual({ position: 'GOL' })
    expect(parseCreatorCommand('!pos lateral esquerdo', find)?.draft).toEqual({ position: 'LE' })
    expect(parseCreatorCommand('posição: camisa 10', find)?.draft).toEqual({ position: 'MEI' })
  })
  it('reads !criar in any order and plain country/position messages', () => {
    expect(parseCreatorCommand('!criar Fenômeno, Brasil, atacante', find)?.draft).toEqual({ surname: 'FENOMENO', nationality: 'BRA', position: 'CA' })
    expect(parseCreatorCommand('!criar zagueiro / japão / Tsubasa', find)?.draft).toEqual({ surname: 'TSUBASA', nationality: 'JPN', position: 'ZAG' })
    expect(parseCreatorCommand('Brasil', find)?.draft).toEqual({ nationality: 'BRA' })
    expect(parseCreatorCommand('goleiro', find)?.draft).toEqual({ position: 'GOL' })
    expect(parseCreatorCommand('1', find)).toBeNull()
    expect(parseCreatorCommand('bora time kkkk', find)).toBeNull()
    expect(parseCreatorCommand('!pais Wakanda', find)).toBeNull()
  })
  it('refuses offensive names and keeps shirt names short', () => {
    expect(parseCreatorCommand('!nome caralhudo', find)).toEqual({ draft: {}, rejected: 'name' })
    expect(parseCreatorCommand('!criar Porra, Brasil, meia', find)).toEqual({ draft: { nationality: 'BRA', position: 'MEI' }, rejected: 'name' })
    expect(safeName('Pedro Henrique Alves da Silva')?.length).toBeLessThanOrEqual(15)
    expect(safeName('x')).toBeNull()
  })
})
