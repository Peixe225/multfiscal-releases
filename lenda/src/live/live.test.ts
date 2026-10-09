import { describe, expect, it } from 'vitest'
import { createStreakTracker, parseMessage, resolveGift } from './protocol'
import { applyEvent, createRound, decide, fitOptions, leaders, parseVote, pendingCoins, percents, shouldExtend, type Round, type VoteRules } from './votes'
import { checkName, cleanFixed, creatorFeedback, isOffensive, makeCountryFinder, nationChoices, parseCreatorCommand, safeName, surnameFromNick } from './identity'
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
  it('unbound gifts count for the number the sender commented in this vote', () => {
    const r = run(round(), [chat('ana', '3'), gift('ana', 'Perfume', 20), chat('ana', '1'), gift('ana', 'Doughnut', 30)])
    expect(r.tallies.map((t) => t.points)).toEqual([301, 0, 200])
    expect(r.tallies.map((t) => t.coins)).toEqual([30, 0, 20])
  })
  it('unbound gifts sent before commenting are held and count as soon as the sender comments', () => {
    const held = applyEvent(round(), gift('ana', 'Perfume', 20), RULES)
    expect(held).toMatchObject({ option: null, points: 0, decided: false, held: true })
    expect(held.round.tallies.map((t) => t.points)).toEqual([0, 0, 0])
    const r1 = run(held.round, [gift('ana', 'Perfume', 20, 2), gift('ana', 'Doughnut', 30)])
    expect(pendingCoins(r1)).toBe(90)
    const res = applyEvent(r1, chat('ana', '3'), RULES)
    expect(res).toMatchObject({ option: 2, points: 901, decided: false, released: { coins: 90, units: 4, points: 900 } })
    expect(res.round.tallies[2]).toMatchObject({ points: 901, coins: 90, comments: 1, voters: 1 })
    expect(pendingCoins(res.round)).toBe(0)
    // depois de liberado, mudar o comentário não leva os presentes junto
    const r2 = applyEvent(res.round, chat('ana', '1'), RULES).round
    expect(r2.tallies.map((t) => t.points)).toEqual([1, 0, 900])
  })
  it('held gifts are per vote: a number commented in a previous vote does not count', () => {
    const prev = run(round(), [chat('ana', '2')])
    expect(prev.commentVote.ana).toBe(1)
    const next = applyEvent(round(), gift('ana', 'Hand Hearts', 100), RULES)
    expect(next.held).toBe(true)
    expect(next.round.tallies.map((t) => t.points)).toEqual([0, 0, 0])
  })
  it('without "unbound gifts follow the comment", unbound gifts are ignored (not held)', () => {
    const rules = { ...RULES, unboundGiftsFollowComment: false }
    const r = run(round(), [gift('ana', 'Perfume', 20), chat('ana', '3'), gift('ana', 'Perfume', 20)], rules)
    expect(r.tallies.map((t) => t.points)).toEqual([0, 0, 1])
    expect(pendingCoins(r)).toBe(0)
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
    // presente antes do número: guardado e liberado pelo comentário (que sozinho não vale voto)
    const held = run(round(), [gift('bia', 'Doughnut', 30)], rules)
    const res = applyEvent(held, chat('bia', '3'), rules)
    expect(res).toMatchObject({ option: 2, points: 300, released: { coins: 30 } })
    expect(res.round.tallies[2]).toMatchObject({ points: 300, comments: 0, voters: 1 })
    expect(applyEvent(round(), chat('caio', '1'), rules).option).toBeNull()
  })
  it('switching "comment votes" mid-vote never takes points from other voters', () => {
    const off = { ...RULES, commentVotes: false }
    let r = run(round(), [chat('bob', '1')])
    r = run(r, [chat('ana', '1')], off) // não pontua (regra desligada)
    r = run(r, [chat('ana', '2')]) // religada: pontua no 2 sem tirar do 1 (o do Bob)
    expect(r.tallies.map((t) => t.points)).toEqual([1, 1, 0])
    r = run(r, [chat('ana', '1')], { ...RULES, commentPoints: 3 }) // muda de ideia: devolve o que tinha dado
    expect(r.tallies.map((t) => t.points)).toEqual([4, 0, 0])
    expect(r.tallies.map((t) => t.comments)).toEqual([2, 0, 0])
  })
  it('a big gift decides instantly when enabled', () => {
    const rules = { ...RULES, instantWinCoins: 1000 }
    const r0 = round()
    const res = applyEvent(run(r0, [chat('x', '1'), chat('y', '1')], rules), gift('rico', 'Galaxy', 1000), rules)
    expect(res).toMatchObject({ decided: false, held: true }) // presente "solto" sem comentário fica guardado…
    const late = applyEvent(res.round, chat('rico', '2'), rules) // …e decide quando ele comenta
    expect(late.decided).toBe(true)
    expect(late.round.closed).toBe(true)
    expect(late.round.decidedBy).toMatchObject({ user: { id: 'rico' }, gift: 'Galaxy', coins: 1000, option: 1 })
    expect(decide(late.round)).toEqual({ winner: 1, reason: 'instant' })
    // um presente pequeno guardado não decide
    const small = run(r0, [gift('ana', 'Doughnut', 30)], rules)
    expect(applyEvent(small, chat('ana', '1'), rules).decided).toBe(false)
    const r1 = run(r0, [chat('rico', '3')], rules)
    const res2 = applyEvent(r1, gift('rico', 'Galaxy', 1000), rules)
    expect(res2.decided).toBe(true)
    expect(decide(res2.round)).toEqual({ winner: 2, reason: 'instant' })
    expect(applyEvent(res2.round, chat('z', '1'), rules).round).toBe(res2.round)
  })
  it('decides by points, then coins, then voters; no votes → stable draw', () => {
    expect(decide(run(round(), [chat('a', '2'), chat('b', '2'), chat('c', '1')]))).toEqual({ winner: 1, reason: 'votes' })
    // 10 pontos cada: o presente (mais moedas) vence os 10 comentários — e o resultado diz que foi desempate
    const many = Array.from({ length: 10 }, (_, i) => chat(`v${i}`, '1'))
    const byCoins = run(round(), [...many, gift('g', 'TikTok', 1)])
    expect(percents(byCoins)).toEqual([50, 50, 0])
    expect(decide(byCoins)).toEqual({ winner: 1, reason: 'tie-break', tieBy: 'coins' })
    // mesmos pontos e moedas: mais pessoas
    const rules = { ...RULES, pointsPerCoin: 1 }
    const byVoters = run(round(), [gift('x', 'Rose', 1), chat('y', '1'), gift('g', 'TikTok', 1), chat('g', '2')], rules)
    expect(byVoters.tallies.map((t) => [t.points, t.coins, t.voters])).toEqual([[2, 1, 2], [2, 1, 1], [0, 0, 0]])
    expect(decide(byVoters)).toEqual({ winner: 0, reason: 'tie-break', tieBy: 'voters' })
    // tudo igual: sorteio estável
    const draw = run(round(), [chat('a', '1'), chat('b', '2')])
    expect(decide(draw)).toMatchObject({ reason: 'tie-break', tieBy: 'draw' })
    expect(decide(draw).winner).toBe(decide(draw).winner)
    const empty = decide(round())
    expect(empty.reason).toBe('no-votes')
    expect(decide(round()).winner).toBe(empty.winner)
  })
  it('keeps at most 4 options: stay/retire stay in the vote, offers fill the rest (original order)', () => {
    const opts = ['transfer-a', 'transfer-b', 'transfer-c', 'stay-x', 'retire-9'].map((id) => ({ id }))
    expect(fitOptions(opts).map((o) => o.id)).toEqual(['transfer-a', 'transfer-b', 'stay-x', 'retire-9'])
    const four = opts.slice(0, 4)
    expect(fitOptions(four)).toBe(four)
    expect(createRound({ id: 'r', kind: 'decision', title: 'T', options: opts.map((o) => ({ ...o, label: o.id })), seconds: 20 }, 0).options).toHaveLength(4)
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
  it('a lost end does not swallow a later combo; a repeated end is not counted again', () => {
    const at = (repeat: number, end: boolean, t: number, group?: string): RawGiftEvent => ({ ...raw(repeat, end), at: t, ...(group ? { group } : {}) })
    const t1 = createStreakTracker()
    // combo de 1 sem o fim; 1 minuto depois, outro combo de 1 (mesma chave, sem groupId)
    expect([at(1, false, 0), at(1, false, 60_000), at(1, true, 60_001)].map(t1)).toEqual([1, 1, 0])
    const t2 = createStreakTracker()
    // fim perdido de uma sequência de 3; nova sequência 1,2 + fim logo depois
    expect([at(1, false, 0), at(2, false, 1), at(3, false, 2), at(1, false, 3), at(2, false, 4), at(2, true, 5)].map(t2)).toEqual([1, 1, 1, 1, 1, 0])
    const t3 = createStreakTracker()
    // fim duplicado (o TikTok reenviou a mensagem)
    expect([at(1, false, 0), at(2, false, 1), at(2, true, 2), at(2, true, 3)].map(t3)).toEqual([1, 1, 0, 0])
    const t4 = createStreakTracker()
    // fora de ordem: 1, 3, 2, fim(3) → 3
    expect([at(1, false, 0), at(3, false, 1), at(2, false, 2), at(3, true, 3)].map(t4).reduce((a, b) => a + b, 0)).toBe(3)
    const t5 = createStreakTracker()
    // dois envios únicos seguidos ainda contam 2
    expect([at(1, false, 0), at(1, true, 1), at(1, false, 2), at(1, true, 3)].map(t5)).toEqual([1, 0, 1, 0])
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
    expect(surnameFromNick('𝓖𝓪𝓫𝓲𝓰𝓸𝓵')).toBe('GABIGOL')
    expect(surnameFromNick('xX_GaBiGoL_Xx')).toBe('GABIGOL')
    for (const nick of ['Putinha', 'cuzinho', 'porrinha', 'prostituta', 'vadia', 'joao.pinto', 'p.u.t.a', 'baitola99']) expect(surnameFromNick(nick)).toBeNull()
    expect(cleanFixed('  de bruyne ')).toBe('DE BRUYNE')
    expect(cleanFixed('Cristiano Ronaldo Santos')).toBe('SANTOS')
  })
  it('profanity filter sees through spacing, punctuation, leetspeak, repeats and abbreviations', () => {
    for (const s of ['P-U-T-A', 'PU TA', 'CARA LHO', 'c.a.r.a.l.h.o', 'p0rr4', 'puuuuta', 'k4r4lh0', 'viad0', 'F D P', 'c u', 'FDP', 'VSF', 'PQP', 'krl', 'Veado', 'Baitola', 'Boiola', 'ｐｕｔａ', 'pu\u200bta'])
      expect(safeName(s), s).toBeNull()
    expect(isOffensive('Ricardo Pinto')).toBe(true)
    for (const s of ['Gabigol', 'De Bruyne', 'Vinícius Júnior', 'Kaká', 'Zé Roberto', 'Nazário', 'Hulk', 'Pelé', 'Nigel', 'G4BIGOL']) expect(safeName(s), s).not.toBeNull()
    expect(safeName('G4BIGOL')).toBe('GABIGOL')
    expect(checkName('CR7')).toEqual({ rejected: 'name' }) // sem vogal
  })
  it('long names are shortened at a word boundary (never mid-word)', () => {
    expect(checkName('Cristiano Ronaldo')).toEqual({ name: 'RONALDO', shortened: true })
    expect(safeName('Ronaldinho Gaúcho')).toBe('RONALDINHO')
    expect(safeName('Lionel Andres Messi')).toBe('MESSI')
    expect(safeName('Neymar da Silva Santos Júnior')).toBe('SANTOS JUNIOR')
    expect(safeName('Pedro Henrique Alves da Silva')).toBe('SILVA')
    expect(safeName('Vinícius Júnior')).toBe('VINICIUS JUNIOR')
    expect(checkName('Supercalifragilisticoespialidoso')).toEqual({ rejected: 'name-long' })
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
  const COUNTRIES = [
    { code: 'BRA', name: 'Brasil' },
    { code: 'ARG', name: 'Argentina' },
    { code: 'USA', name: 'Estados Unidos' },
    { code: 'NED', name: 'Países Baixos' },
    { code: 'JPN', name: 'Japão' },
    { code: 'POR', name: 'Portugal' },
  ]
  const find = makeCountryFinder(COUNTRIES)
  // com nomes que confundem: Israel, Comores (como), Paraguai (para), País de Gales (!pais), Guiné (gui), Costa Rica
  const findAll = makeCountryFinder([
    ...COUNTRIES,
    { code: 'ISR', name: 'Israel' },
    { code: 'COM', name: 'Comores' },
    { code: 'PAR', name: 'Paraguai' },
    { code: 'WAL', name: 'País de Gales' },
    { code: 'GUI', name: 'Guiné' },
    { code: 'CRC', name: 'Costa Rica' },
    { code: 'MRI', name: 'Maurício' },
    { code: 'BEL', name: 'Bélgica' },
  ])
  it('finds countries by name, code, accent-free text, aliases and unique prefix', () => {
    expect(find('Brasil')).toBe('BRA')
    expect(find('arg')).toBe('ARG')
    expect(find('japao')).toBe('JPN')
    expect(find('EUA')).toBe('USA')
    expect(find('holanda')).toBe('NED')
    expect(find('portu')).toBe('POR')
    expect(find('França')).toBeNull()
    expect(find('brasileira')).toBe('BRA')
    expect(find('o Brasil')).toBe('BRA')
    expect(find('Brasil mesmo')).toBe('BRA')
  })
  it('strict lookup (bare messages): only full names or aliases with 4+ letters', () => {
    const all = makeCountryFinder([...COUNTRIES, { code: 'COM', name: 'Comores' }, { code: 'PAR', name: 'Paraguai' }, { code: 'WAL', name: 'País de Gales' }, { code: 'PER', name: 'Peru' }])
    expect(all('Brasil', true)).toBe('BRA')
    expect(all('holanda', true)).toBe('NED')
    expect(all('brasileiro', true)).toBe('BRA')
    expect(all('peru', true)).toBe('PER')
    for (const q of ['como', 'para', 'pais', 'arg', 'eua', 'portu', 'bra']) expect(all(q, true), q).toBeNull()
    expect(all('como')).toBe('COM') // depois de "!pais", começo do nome ainda vale
  })
  it('keyword commands need "!" or "/" (accents, ":" and a leading @mention are fine)', () => {
    expect(parseCreatorCommand('!nome Gabigol', find)?.draft).toEqual({ surname: 'GABIGOL' })
    expect(parseCreatorCommand('!nome:de bruyne', find)?.draft).toEqual({ surname: 'DE BRUYNE' })
    expect(parseCreatorCommand('/nome Gabigol', find)?.draft).toEqual({ surname: 'GABIGOL' })
    expect(parseCreatorCommand('@streamer !nome Gabigol', find)?.draft).toEqual({ surname: 'GABIGOL' })
    expect(parseCreatorCommand('!nome dele vai ser Gabigol', find)?.draft).toEqual({ surname: 'GABIGOL' })
    expect(parseCreatorCommand('!país Argentina', find)?.draft).toEqual({ nationality: 'ARG' })
    expect(parseCreatorCommand('!País:Argentina', find)?.draft).toEqual({ nationality: 'ARG' })
    expect(parseCreatorCommand('!naçao Brasil', find)?.draft).toEqual({ nationality: 'BRA' })
    expect(parseCreatorCommand('!seleção Brasil', find)?.draft).toEqual({ nationality: 'BRA' })
    expect(parseCreatorCommand('!nacionalidade brasileira', find)?.draft).toEqual({ nationality: 'BRA' })
    expect(parseCreatorCommand('!posicao goleiro', find)?.draft).toEqual({ position: 'GOL' })
    expect(parseCreatorCommand('!posiçao goleirão', find)?.draft).toEqual({ position: 'GOL' })
    expect(parseCreatorCommand('!posicão zagueiro central', find)?.draft).toEqual({ position: 'ZAG' })
    expect(parseCreatorCommand('!posicao atacante 9', find)?.draft).toEqual({ position: 'CA' })
    expect(parseCreatorCommand('!pos lateral esquerdo', find)?.draft).toEqual({ position: 'LE' })
    expect(parseCreatorCommand('!posição camisa 10', find)?.draft).toEqual({ position: 'MEI' })
    // sem "!" não é comando
    for (const t of ['nome: de bruyne', 'nome Gabigol', 'nome é Gabigol', 'lenda demais', 'jogador bom demais', 'criar Gabigol, Brasil, atacante']) expect(parseCreatorCommand(t, find), t).toBeNull()
    expect(parseCreatorCommand('!oi', find)).toBeNull()
  })
  it('empty keywords give a hint, unknown values say what was not recognized, !ok confirms', () => {
    expect(parseCreatorCommand('!pais', find)).toEqual({ draft: {}, hint: 'Escreva o país junto: !pais Brasil' })
    expect(parseCreatorCommand('!nome', find)?.hint).toBe('Escreva o nome junto: !nome Gabigol')
    expect(parseCreatorCommand('!pais Wakanda', find)).toEqual({ draft: {}, rejected: 'country', value: 'Wakanda' })
    expect(parseCreatorCommand('!posicao goleador', find)).toEqual({ draft: {}, rejected: 'position', value: 'goleador' })
    expect(parseCreatorCommand('!nome Supercalifragilisticoespialidoso', find)).toEqual({ draft: {}, rejected: 'name-long' })
    for (const t of ['!ok', '/ok', '!OK!', '!confirmar']) expect(parseCreatorCommand(t, find), t).toEqual({ draft: {}, confirm: true })
    const name = (c: string) => COUNTRIES.find((x) => x.code === c)?.name
    expect(creatorFeedback(parseCreatorCommand('!criar Gabigol, Brasil, atacante', find)!, name)).toBe('Nome: GABIGOL · País: Brasil · Posição: Centroavante ✓')
    expect(creatorFeedback(parseCreatorCommand('!pais Wakanda', find)!, name)).toBe('País não reconhecido: Wakanda — tente !pais Brasil')
    expect(creatorFeedback(parseCreatorCommand('!pais caralho', find)!, name)).toBe('País não reconhecido — tente !pais Brasil')
    expect(creatorFeedback(parseCreatorCommand('!nome Cristiano Ronaldo', find)!, name)).toBe('Nome: RONALDO (até 15 letras) ✓')
    expect(creatorFeedback(parseCreatorCommand('!ok', find)!)).toBeNull()
  })
  it('reads !criar positionally first (name, country, position), then in any order', () => {
    expect(parseCreatorCommand('!criar Fenômeno, Brasil, atacante', find)?.draft).toEqual({ surname: 'FENOMENO', nationality: 'BRA', position: 'CA' })
    // nomes que também são países
    expect(parseCreatorCommand('!criar Israel, Brasil, zagueiro', findAll)?.draft).toEqual({ surname: 'ISRAEL', nationality: 'BRA', position: 'ZAG' })
    expect(parseCreatorCommand('!criar Holanda, Brasil, meia', find)?.draft).toEqual({ surname: 'HOLANDA', nationality: 'BRA', position: 'MEI' })
    expect(parseCreatorCommand('!criar Holanda, atacante, Brasil', find)?.draft).toEqual({ surname: 'HOLANDA', nationality: 'BRA', position: 'CA' })
    expect(parseCreatorCommand('!criar zagueiro / japão / Tsubasa', find)?.draft).toEqual({ surname: 'TSUBASA', nationality: 'JPN', position: 'ZAG' })
    expect(parseCreatorCommand('!criar Gabigol, Brasil e atacante', find)?.draft).toEqual({ surname: 'GABIGOL', nationality: 'BRA', position: 'CA' })
    expect(parseCreatorCommand('!criar Gabigol - Brasil - atacante', find)?.draft).toEqual({ surname: 'GABIGOL', nationality: 'BRA', position: 'CA' })
    expect(parseCreatorCommand('!criar Cristiano Ronaldo, Portugal, atacante', find)).toEqual({ draft: { surname: 'RONALDO', nationality: 'POR', position: 'CA' }, shortened: true })
    expect(parseCreatorCommand('!criar Gabigol, Wakanda, atacante', find)).toEqual({ draft: { surname: 'GABIGOL', position: 'CA' }, rejected: 'country', value: 'Wakanda' })
    expect(parseCreatorCommand('!criar', find)?.hint).toBe('Tudo de uma vez: !criar Nome, País, Posição')
  })
  it('reads !criar without commas when unambiguous', () => {
    expect(parseCreatorCommand('!criar Gabigol Brasil atacante', find)?.draft).toEqual({ surname: 'GABIGOL', nationality: 'BRA', position: 'CA' })
    expect(parseCreatorCommand('!criar Gabigol atacante Brasil', find)?.draft).toEqual({ surname: 'GABIGOL', nationality: 'BRA', position: 'CA' })
    expect(parseCreatorCommand('!criar Joel Costa Rica zagueiro', findAll)?.draft).toEqual({ surname: 'JOEL', nationality: 'CRC', position: 'ZAG' })
    expect(parseCreatorCommand('!criar Diego Costa atacante', find)?.draft).toEqual({ surname: 'DIEGO COSTA', position: 'CA' })
    expect(parseCreatorCommand('!criar Gabigol', find)?.draft).toEqual({ surname: 'GABIGOL' })
  })
  it('bare messages only fill an empty field, with exact country/position words', () => {
    expect(parseCreatorCommand('Brasil', find)).toEqual({ draft: { nationality: 'BRA' }, bare: true })
    expect(parseCreatorCommand('goleiro', find)).toEqual({ draft: { position: 'GOL' }, bare: true })
    expect(parseCreatorCommand('País: Argentina', find)?.draft).toEqual({ nationality: 'ARG' })
    expect(parseCreatorCommand('Brasil', find, { nationality: 'ARG' })).toBeNull()
    expect(parseCreatorCommand('goleiro', find, { position: 'CA' })).toBeNull()
    for (const t of ['como?', 'para', 'gol', 'GOL!!', 'me', 'pe', 'cam', 'st', '1', '9', 'vai brasil', 'bora time kkkk', 'arg', 'portu', 'eua'])
      expect(parseCreatorCommand(t, findAll), t).toBeNull()
  })
  it('refuses offensive names and keeps shirt names short', () => {
    expect(parseCreatorCommand('!nome caralhudo', find)).toEqual({ draft: {}, rejected: 'name' })
    expect(parseCreatorCommand('!nome P-U-T-A', find)).toEqual({ draft: {}, rejected: 'name' })
    expect(parseCreatorCommand('!criar Porra, Brasil, meia', find)).toEqual({ draft: { nationality: 'BRA', position: 'MEI' }, rejected: 'name' })
    expect(safeName('Pedro Henrique Alves da Silva')?.length).toBeLessThanOrEqual(15)
    expect(safeName('x')).toBeNull()
  })
})
