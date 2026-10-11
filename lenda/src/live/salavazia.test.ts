/**
 * Live com a sala vazia: ritmo automático (F1), rodadas que fecham sem votos (F2), chamadas na tela (F3),
 * boas-vindas (F4), ranking da live de hoje (F5) e voto do streamer (F6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '@/store/app'
import { useCareer } from '@/store/career'
import { useData } from '@/store/data'
import { director } from '@/ui/classic/reveal/director'
import { useReveal } from '@/ui/classic/reveal/store'
import { joinInvite } from '@/ui/live/LiveCallout'
import { outcomeWhy, resultKicker } from '@/ui/live/LiveHud'
import { newLegendNow, resolvePace, startAutopilot, stopAutopilot } from './autopilot'
import { WINDOW_ID, onStreamerVote } from './channel'
import { AUTO_PACE, DEFAULT_LIVE_CONFIG, autoPace, mergePersistedConfig, mergeSyncedConfig, migrateConfig, useLiveConfig, useLiveSession } from './config'
import { disconnectLive } from './connection'
import { CTA_PERIOD_MS, CTA_QUIET_WARN_S, cleanCustomCta, ctaItems, pickCta, type CtaContext } from './cta'
import { parseMessage } from './protocol'
import { RANKING_CAP, RANKING_PREFIX, SIM_RANKING_CAP, creatorLabel, creatorPhrase, dayKey, insertRanking, readRanking, recordLiveLegend, useLiveRanking, visibleRanking, type RankEntry } from './ranking'
import { dispatchRelay } from './relay'
import { JOIN_SHOUT_MAX_VIEWERS, SHOUT, createShoutQueue, shoutGap } from './shoutouts'
import { STREAMER, realLive, recentParticipants, useLive } from './store'
import type { LiveEvent, LiveUser } from './types'
import { createRound, hasVotes, roundClock, type VoteRules } from './votes'

// o motor de legado de verdade precisa de uma carreira inteira: aqui a nota vem pronta
vi.mock('@/engine/legacy', () => ({
  evaluateRun: (input: { identity: { surname: string } }) => ({ score: input.identity.surname === 'RECORDE' ? 93 : 64, raw: 1 }),
  legacyTier: (score: number) => ({ label: score >= 90 ? 'Imortal' : 'Craque' }),
}))

const fan = (id: string): LiveUser => ({ id, name: id })
const chat = (user: LiveUser, text: string): LiveEvent => ({ type: 'chat', user, text, at: Date.now() })
const gift = (user: LiveUser, coins: number): LiveEvent => ({ type: 'gift', user, gift: { id: 'g', name: 'Doughnut', coins }, count: 1, at: Date.now() })
const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, label: `Opção ${i + 1}` }))

/** localStorage de mentira (com key/length, que o ranking usa para limpar os dias velhos). */
function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    _map: m,
  }
}

let startCareer: ReturnType<typeof vi.fn>

function setRoute(path: '/carreira' | '/live', tela?: string) {
  ;(useApp.getState() as { route: unknown }).route = { path, query: tela ? { tela } : {} }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 10, 21, 0, 0))
  vi.stubGlobal('location', { hash: '', pathname: '/', origin: 'http://localhost' })
  vi.stubGlobal('history', { state: null, replaceState: () => {} })
  vi.stubGlobal('window', { scrollTo: () => {}, addEventListener: () => {}, removeEventListener: () => {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('innerHeight', 800)
  vi.stubGlobal('document', { querySelector: () => null })
  vi.stubGlobal('localStorage', memoryStorage())
  useLiveConfig.setState({ config: { ...DEFAULT_LIVE_CONFIG, creator: 'disputa', bidSeconds: 30, createSeconds: 20, voteSeconds: 25, quietSeconds: 10, identityVote: false, nameMode: 'aleatorio', nextCareerSeconds: 5, simAuto: false } })
  useLiveSession.setState({ on: true, paused: false })
  useLive.getState().clearSession()
  useLive.setState({ source: 'simulador', viewers: null, bridgeDemo: false, credit: null })
  useLiveRanking.setState({ day: '', list: [], last: null })
  startCareer = vi.fn(async () => ({}))
  useCareer.setState({ status: 'ready', isFixture: false, busy: false, state: null, start: startCareer as never })
  useReveal.setState({ phase: 'idle', celebrationOpen: false })
  useData.setState({ data: { countries: [{ code: 'BRA', name: 'Brasil' }] } as never })
  setRoute('/live', 'palco')
})

afterEach(() => {
  useLiveSession.setState({ on: false, paused: false })
  stopAutopilot()
  disconnectLive()
  useLive.getState().clearSession()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ───────────────────────── F1 · ritmo automático ─────────────────────────

describe('F1 · ritmo automático', () => {
  it('menos de 3 pessoas = Expresso, 3 a 14 = Normal, 15 ou mais = Intenso', () => {
    expect([0, 2, 3, 14, 15, 80].map(autoPace)).toEqual(['expressa', 'expressa', 'normal', 'normal', 'intensa', 'intensa'])
    expect(AUTO_PACE).toEqual({ windowMs: 300_000, normalFrom: 3, intenseFrom: 15 })
  })

  it('conta pessoas diferentes que comentaram, mandaram presente, curtiram, seguiram ou compartilharam nos últimos 5 min', () => {
    const s = useLive.getState()
    s.ingest(chat(fan('a'), 'oi'))
    s.ingest(chat(fan('a'), '2'))
    s.ingest(gift(fan('b'), 1))
    s.ingest({ type: 'like', user: fan('c'), count: 5, at: Date.now() })
    s.ingest({ type: 'follow', user: fan('d'), at: Date.now() })
    s.ingest({ type: 'share', user: fan('e'), at: Date.now() })
    // entrar na sala não é participar
    s.ingest({ type: 'join', user: fan('f'), at: Date.now() })
    expect(recentParticipants()).toBe(5)
    vi.advanceTimersByTime(AUTO_PACE.windowMs + 1000)
    s.ingest(chat(fan('g'), '1'))
    expect(recentParticipants()).toBe(1)
  })

  it('numa live de verdade, teste e voto do streamer não contam como gente', () => {
    useLive.setState({ source: 'ponte' })
    const s = useLive.getState()
    s.ingest(chat(fan('teste'), '1'), { sim: true })
    void s.startRound({ id: 'r', kind: 'decision', title: 'T', options: opts(2) })
    s.streamerVote(0)
    s.ingest(chat(fan('real'), '2'))
    expect(recentParticipants()).toBe(1)
  })

  it('a lenda nasce no ritmo da sala: vazia → Expresso; 15 pessoas → Intenso (e o anúncio mostra)', async () => {
    useLiveConfig.getState().set({ creator: 'votacao', pace: 'auto' })
    expect(resolvePace()).toMatchObject({ pace: 'expressa', auto: true, people: 0, badge: 'Ritmo Expresso · automático' })
    startAutopilot()
    await vi.advanceTimersByTimeAsync(500)
    expect(useLive.getState().announce?.badge).toBe('Ritmo Expresso · automático')
    await vi.advanceTimersByTimeAsync(5500)
    expect(startCareer).toHaveBeenLastCalledWith(expect.anything(), 'expressa')

    // sem carreira (o start é de mentira) o autopiloto já abriu outro anúncio: some antes de religar
    stopAutopilot()
    useLive.setState({ announce: null, pendingLegend: null, stage: 'idle' })
    for (let i = 0; i < 15; i++) useLive.getState().ingest(chat(fan(`p${i}`), 'bora'))
    expect(resolvePace().pace).toBe('intensa')
    startAutopilot()
    await vi.advanceTimersByTimeAsync(500)
    expect(useLive.getState().announce?.badge).toBe('Ritmo Intenso · automático')
    await vi.advanceTimersByTimeAsync(5500)
    expect(startCareer).toHaveBeenLastCalledWith(expect.anything(), 'intensa')
  })

  it('ritmo fixo continua fixo (o selo só diz qual é)', () => {
    useLiveConfig.getState().set({ pace: 'normal' })
    for (let i = 0; i < 20; i++) useLive.getState().ingest(chat(fan(`p${i}`), '1'))
    expect(resolvePace()).toMatchObject({ pace: 'normal', auto: false, badge: 'Ritmo Normal' })
  })

  it('configuração nova começa no automático; a salva guarda o ritmo dela; ritmo desconhecido não entra', () => {
    expect(DEFAULT_LIVE_CONFIG.pace).toBe('auto')
    expect(mergePersistedConfig(undefined).config).toMatchObject({ pace: 'auto', quietSeconds: 15, ctaOn: true, ctaCustom: '' })
    // salva antes do ritmo automático existir: continua no Normal e ganha os campos novos com o padrão
    expect(mergePersistedConfig({ config: { pace: 'normal', voteSeconds: 30 }, editedAt: 5 })).toMatchObject({ editedAt: 5, config: { pace: 'normal', voteSeconds: 30, quietSeconds: 15, ctaOn: true } })
    expect(mergePersistedConfig({ config: { pace: 'turbo' } }).config.pace).toBe('auto')
    expect(mergeSyncedConfig({ ...DEFAULT_LIVE_CONFIG, pace: 'intensa' }, { pace: 'turbo' }).pace).toBe('intensa')
    expect(mergeSyncedConfig(DEFAULT_LIVE_CONFIG, { pace: 'expressa' }).pace).toBe('expressa')
  })

  it('v1 → v2: quem estava com a sala vazia no padrão antigo (10 s) passa para 15 s; outro valor fica', () => {
    expect(migrateConfig({ config: { quietSeconds: 10, pace: 'normal' }, editedAt: 3 }, 1)).toEqual({ config: { quietSeconds: 15, pace: 'normal' }, editedAt: 3 })
    expect(migrateConfig({ config: { quietSeconds: 20 } }, 1)).toEqual({ config: { quietSeconds: 20 } })
    expect(migrateConfig({ config: { quietSeconds: 0 } }, 1)).toEqual({ config: { quietSeconds: 0 } })
    expect(migrateConfig({ config: { quietSeconds: 10 } }, 2)).toEqual({ config: { quietSeconds: 10 } })
    expect(migrateConfig(null, 1)).toBeNull()
  })
})

// ───────────────────────── F2 · sala vazia ─────────────────────────

describe('F2 · sala vazia (rodadas sem votos fecham antes)', () => {
  it('ninguém votou em 10 s: fecha com o sorteio estável e "o destino escolheu"', async () => {
    const p = useLive.getState().startRound({ id: 'd:x', kind: 'decision', title: 'T', options: opts(3) })
    vi.advanceTimersByTime(9_600)
    expect(useLive.getState().round).not.toBeNull()
    vi.advanceTimersByTime(600)
    const out = await p
    expect(useLive.getState().round).toBeNull()
    expect(out).toMatchObject({ reason: 'no-votes', quiet: true })
    const res = useLive.getState().result!
    expect(outcomeWhy(res.round, res.outcome)).toBe('Ninguém votou: o destino escolheu')
    expect(useLive.getState().feed.map((f) => f.text)).toContain('Ninguém votou: o destino escolheu')
  })

  it('chegou um voto antes: a votação vai até o fim (nunca corta rodada com voto)', async () => {
    const p = useLive.getState().startRound({ id: 'd:y', kind: 'decision', title: 'T', options: opts(3) })
    vi.advanceTimersByTime(5000)
    useLive.getState().ingest(chat(fan('ana'), '2'))
    vi.advanceTimersByTime(15_000)
    expect(useLive.getState().round).not.toBeNull()
    vi.advanceTimersByTime(5_500)
    const out = await p
    expect(out).toMatchObject({ winner: 1, reason: 'votes' })
    expect(out?.quiet).toBeUndefined()
  })

  it('a pausa empurra o prazo da sala vazia; 0 desliga', async () => {
    void useLive.getState().startRound({ id: 'd:z', kind: 'decision', title: 'T', options: opts(2) })
    vi.advanceTimersByTime(4000)
    useLiveSession.getState().setPaused(true)
    vi.advanceTimersByTime(30_000)
    useLiveSession.getState().setPaused(false)
    vi.advanceTimersByTime(5000)
    expect(useLive.getState().round).not.toBeNull()
    vi.advanceTimersByTime(1500)
    expect(useLive.getState().round).toBeNull()

    useLiveConfig.getState().set({ quietSeconds: 0 })
    void useLive.getState().startRound({ id: 'd:w', kind: 'decision', title: 'T', options: opts(2) })
    expect(useLive.getState().round?.quietAt).toBeUndefined()
    vi.advanceTimersByTime(20_000)
    expect(useLive.getState().round).not.toBeNull()
  })

  it('qualquer participação conta como voto: número comentado (mesmo sem valer ponto), presente guardado', () => {
    const rules: VoteRules = { commentVotes: false, commentPoints: 1, pointsPerCoin: 10, giftBindings: ['Rose', '', '', ''], instantWinCoins: 0, unboundGiftsFollowComment: true }
    const r = createRound({ id: 'r', kind: 'decision', title: 'T', options: opts(2), seconds: 20 }, 0)
    expect(hasVotes(r)).toBe(false)
    expect(hasVotes({ ...r, commentVote: { ana: 0 } })).toBe(true)
    expect(hasVotes({ ...r, pendingGifts: { bia: [{ user: fan('bia'), gift: 'Perfume', coins: 20, units: 1, top: 20 }] } })).toBe(true)
    void rules
  })

  it('disputa sem lance em 10 s acaba já e segue o caminho de "ninguém doou"; com lance, vai até o fim', async () => {
    startAutopilot()
    await vi.advanceTimersByTimeAsync(500)
    expect(useLive.getState().creation?.phase).toBe('bidding')
    await vi.advanceTimersByTimeAsync(10_300)
    expect(useLive.getState().creation).toBeNull()
    expect(useLive.getState().feed.map((f) => f.text)).toContain('Ninguém doou na disputa')

    // com lance: a disputa continua até os 30 s
    useLive.getState().startBidding(30)
    useLive.getState().ingest(gift(fan('ana'), 5))
    vi.advanceTimersByTime(15_000)
    expect(useLive.getState().creation?.phase).toBe('bidding')
    expect(useLive.getState().creation?.endsAt).toBeGreaterThan(Date.now())
  })

  it('sinal de gente na sala (entrou, comentou qualquer coisa) empurra o prazo; teste não; passou do fim, vai até o fim', () => {
    useLive.setState({ source: 'ponte' })
    const s = useLive.getState()
    void s.startRound({ id: 'd:vida', kind: 'decision', title: 'T', options: opts(3) })
    const t0 = Date.now()
    expect(useLive.getState().round?.quietAt).toBe(t0 + 10_000)
    vi.advanceTimersByTime(8000)
    // entrou alguém (o evento chega antes de a pessoa ver a live, que tem atraso): ganha quietSeconds
    s.ingest({ type: 'join', user: fan('novo'), at: Date.now() })
    expect(useLive.getState().round?.quietAt).toBe(t0 + 18_000)
    // teste numa live de verdade não é gente
    vi.advanceTimersByTime(1000)
    s.ingest(chat(fan('teste'), 'oi'), { sim: true })
    expect(useLive.getState().round?.quietAt).toBe(t0 + 18_000)
    // comentário sem número também é gente; o prazo novo passaria do fim normal → a rodada vai até o fim
    vi.advanceTimersByTime(7000)
    s.ingest(chat(fan('novo'), 'que jogo'))
    expect(useLive.getState().round?.quietAt).toBeUndefined()
    vi.advanceTimersByTime(5000)
    expect(useLive.getState().round).not.toBeNull()
  })

  it('na disputa também: entrou alguém → o prazo da sala vazia anda (e depois fecha se ninguém der lance)', () => {
    useLive.setState({ source: 'ponte' })
    useLive.getState().startBidding(30)
    const t0 = Date.now()
    expect(useLive.getState().creation?.quietAt).toBe(t0 + 10_000)
    vi.advanceTimersByTime(6000)
    useLive.getState().ingest({ type: 'join', user: fan('ana'), at: Date.now() })
    expect(useLive.getState().creation?.quietAt).toBe(t0 + 16_000)
    vi.advanceTimersByTime(9_500)
    expect(useLive.getState().creation?.quiet).toBeUndefined()
    vi.advanceTimersByTime(700)
    expect(useLive.getState().creation).toMatchObject({ quiet: true })
  })

  it('só o streamer votou: "O streamer escolheu", sem "100% dos votos"; com o chat junto, o chat decidiu', async () => {
    useLive.setState({ source: 'ponte' })
    const p = useLive.getState().startRound({ id: 'd:so', kind: 'decision', title: 'T', options: opts(3) })
    useLive.getState().streamerVote(2)
    vi.advanceTimersByTime(25_500)
    const out = await p
    expect(out).toMatchObject({ winner: 2, reason: 'votes', streamer: true })
    const res = useLive.getState().result!
    expect(resultKicker(res.outcome)).toBe('O streamer escolheu')
    expect(outcomeWhy(res.round, res.outcome)).toBe('Só o streamer votou: comente o número e decida a próxima')

    const p2 = useLive.getState().startRound({ id: 'd:so2', kind: 'decision', title: 'T', options: opts(3) })
    useLive.getState().streamerVote(2)
    useLive.getState().ingest(chat(fan('ana'), '3'))
    vi.advanceTimersByTime(25_500)
    const out2 = await p2
    expect(out2?.streamer).toBeUndefined()
    expect(resultKicker(out2!)).toBe('O chat decidiu')
  })
})

// ───────────────────────── F3 · chamadas na tela ─────────────────────────

describe('F3 · chamadas na tela', () => {
  const ctx = (over: Partial<CtaContext> = {}): CtaContext => ({
    cfg: { ...DEFAULT_LIVE_CONFIG, giftBindings: ['Rose', 'TikTok', 'GG', 'Ice Cream Cone'], pointsPerCoin: 10, ctaCustom: '' },
    phase: 'vote',
    round: { options: 3, voted: false, quietIn: 7 },
    giftCoins: () => 1,
    ...over,
  })

  it('ninguém votou: chamada "quente" FIXA no jeito grátis de votar; nos últimos segundos, o aviso do destino', () => {
    const r = ctaItems(ctx({ round: { options: 3, voted: false, quietIn: 9, startedAt: 1000 } }))
    expect(r.hot).toBe(true)
    expect(r.items.map((i) => i.text)).toEqual(['Seja o primeiro: comente 1, 2 ou 3'])
    // a rodada inteira mostra a mesma chamada (nada de preço de presente girando no lugar do jeito de jogar)
    for (let t = 1000; t < 16_000; t += 1000) expect(pickCta(r.items, t, CTA_PERIOD_MS, r.anchor)?.text).toBe('Seja o primeiro: comente 1, 2 ou 3')
    const end = ctaItems(ctx({ round: { options: 3, voted: false, quietIn: CTA_QUIET_WARN_S - 1, startedAt: 1000 } }))
    expect(end.items).toEqual([expect.objectContaining({ id: 'vote', kind: 'quiet', text: 'Comente 1, 2 ou 3 já · sem votos, o destino escolhe em 4 s' })])
  })

  it('sem "comentário vale voto": o presente é o único jeito — jeito de votar intercalado com cada presente, contado do começo da rodada', () => {
    const r = ctaItems(ctx({ cfg: { ...ctx().cfg, commentVotes: false }, round: { options: 3, voted: false, quietIn: 12, startedAt: 7777 } }))
    expect(r.items.map((i) => i.text)).toEqual(['Mande o presente da opção para escolher', 'Rosa = 10 pontos na opção 1', 'Mande o presente da opção para escolher', 'TikTok = 10 pontos na opção 2', 'Mande o presente da opção para escolher', 'GG = 10 pontos na opção 3'])
    expect(r.anchor).toBe(7777)
    // a primeira chamada de cada rodada é sempre como votar, qualquer que seja a hora
    expect(pickCta(r.items, 7777, CTA_PERIOD_MS, r.anchor)?.text).toBe('Mande o presente da opção para escolher')
    expect(pickCta(r.items, 7777 + CTA_PERIOD_MS, CTA_PERIOD_MS, r.anchor)?.gift).toBe('Rose')
  })

  it('o anel da faixa conta até o fechamento da sala vazia; com voto, até o fim normal', () => {
    const r = { ...createRound({ id: 'r', kind: 'decision', title: 'T', options: opts(2), seconds: 25 }, 0), quietAt: 15_000 }
    expect(roundClock(r)).toEqual({ endsAt: 15_000, total: 15_000, quiet: true })
    expect(roundClock({ ...r, commentVote: { ana: 0 } })).toEqual({ endsAt: 25_000, total: 25_000, quiet: false })
    const { quietAt: _q, ...plain } = r
    expect(roundClock(plain)).toEqual({ endsAt: 25_000, total: 25_000, quiet: false })
  })

  it('com votos: gira tudo — votar, presentes, quem cria a lenda, jogar grátis, seguir e a frase do streamer', () => {
    const { items, hot } = ctaItems(ctx({ round: { options: 4, voted: true }, giftCoins: (n) => (n === 'GG' ? 5 : 1), cfg: { ...ctx().cfg, ctaCustom: '  Meta:   100 seguidores! ' } }))
    expect(hot).toBe(false)
    const texts = items.map((i) => i.text)
    expect(texts[0]).toBe('Comente 1, 2, 3 ou 4 para escolher')
    expect(texts).toContain('GG = 50 pontos na opção 3')
    expect(texts).toContain('Quem doar mais cria a próxima lenda')
    expect(texts).toContain('Jogue grátis: oprojeto.online/lenda')
    expect(texts).toContain('Siga para ver a próxima lenda nascer')
    expect(texts).toContain('Meta: 100 seguidores!')
  })

  it('frase do streamer passa pelo filtro de palavrões; a chamada gira pelo relógio a cada 6 s', () => {
    expect(cleanCustomCta('vai tomar no cu')).toBeNull()
    expect(cleanCustomCta('   ')).toBeNull()
    expect(cleanCustomCta('x'.repeat(200))).toHaveLength(80)
    const { items } = ctaItems(ctx({ phase: 'other', round: null }))
    expect(pickCta(items, 0)?.id).toBe(items[0].id)
    expect(pickCta(items, CTA_PERIOD_MS)?.id).toBe(items[1].id)
    expect(pickCta(items, CTA_PERIOD_MS * items.length)?.id).toBe(items[0].id)
    expect(pickCta([], 0)).toBeNull()
  })
})

// ───────────────────────── F4 · boas-vindas ─────────────────────────

describe('F4 · boas-vindas', () => {
  it('lê a entrada na sala da ponte (conector 2.x), do TikFinity (v1 plano) e do formato da ponte; ignora "virou assinante"', () => {
    const user = { displayId: 'gabi.fut', nickname: 'Gabi ⚽', avatarThumb: { urlList: ['https://p16/a.webp'] } }
    // o que a ponte repassa (slimUser + actionId)
    expect(parseMessage({ event: 'member', data: { user: { uniqueId: 'gabi.fut', nickname: 'Gabi ⚽' }, actionId: 1 } })[0]).toMatchObject({ type: 'join', user: { id: 'gabi.fut', name: 'Gabi ⚽' } })
    // o evento cru do conector 2.x (action 1 = entrou)
    expect(parseMessage({ event: 'member', data: { user, action: 1 } })[0]).toMatchObject({ type: 'join', user: { id: 'gabi.fut', avatar: 'https://p16/a.webp' } })
    // TikFinity: formato v1, campos planos
    expect(parseMessage(JSON.stringify({ event: 'member', data: { uniqueId: 'lia.tf', nickname: 'Lia', profilePictureUrl: 'https://x/l.jpg', actionId: 1, label: '{0:user} joined' } }))[0]).toMatchObject({ type: 'join', user: { id: 'lia.tf', name: 'Lia', avatar: 'https://x/l.jpg' } })
    // sem código: vale como entrada (ponte antiga)
    expect(parseMessage({ event: 'member', data: { user: { uniqueId: 'x' } } })[0]).toMatchObject({ type: 'join' })
    // 3 = virou assinante (não é entrada)
    expect(parseMessage({ event: 'member', data: { user, action: 3 } })).toEqual([])
    expect(parseMessage({ type: 'join', user: { id: 'sim', name: 'Sim' } })[0]).toMatchObject({ type: 'join', user: { id: 'sim' } })
  })

  it('fila: 1 a cada 4 s, no máximo 3 esperando, a mesma pessoa não volta em 10 min; seguir toma o lugar de uma entrada', () => {
    const q = createShoutQueue()
    expect(q.push('join', fan('a'), 0)).toBe(true)
    expect(q.take(0)?.user.id).toBe('a')
    expect(q.push('join', fan('b'), 100)).toBe(true)
    expect(q.take(1000)).toBeNull()
    expect(q.wait(1000)).toBe(3000)
    expect(q.take(SHOUT.gapMs)?.user.id).toBe('b')
    // repetida em 10 min: não entra
    expect(q.push('join', fan('a'), 60_000)).toBe(false)
    expect(q.push('join', fan('a'), SHOUT.repeatMs + 1)).toBe(true)
    // fila cheia (3): entrada nova cai; seguir entra no lugar da entrada mais antiga
    expect(q.push('join', fan('c'), SHOUT.repeatMs + 2)).toBe(true)
    expect(q.push('join', fan('d'), SHOUT.repeatMs + 3)).toBe(true)
    expect(q.size()).toBe(3)
    expect(q.push('join', fan('e'), SHOUT.repeatMs + 4)).toBe(false)
    expect(q.push('follow', fan('e'), SHOUT.repeatMs + 5)).toBe(true)
    expect(q.size()).toBe(3)
    const order: string[] = []
    for (let t = SHOUT.repeatMs + 10_000, s; (s = q.take(t)); t += SHOUT.gapMs) order.push(`${s.kind}:${s.user.id}`)
    expect(order).toEqual(['join:c', 'join:d', 'follow:e'])
  })

  it('na tela: quem entra ganha a chamada, a próxima espera 4 s; seguir/compartilhar agradece; teste numa live de verdade não aparece', () => {
    const s = useLive.getState()
    s.ingest({ type: 'join', user: fan('ana'), at: Date.now() })
    expect(useLive.getState().shout).toMatchObject({ kind: 'join', user: { id: 'ana' } })
    s.ingest({ type: 'join', user: fan('bia'), at: Date.now() })
    s.ingest({ type: 'join', user: fan('ana'), at: Date.now() })
    s.ingest({ type: 'follow', user: fan('caio'), at: Date.now() })
    vi.advanceTimersByTime(SHOUT.showMs + 50)
    expect(useLive.getState().shout).toBeNull()
    vi.advanceTimersByTime(SHOUT.gapMs - SHOUT.showMs)
    expect(useLive.getState().shout).toMatchObject({ kind: 'join', user: { id: 'bia' } })
    vi.advanceTimersByTime(SHOUT.gapMs)
    expect(useLive.getState().shout).toMatchObject({ kind: 'follow', user: { id: 'caio' } })
    vi.advanceTimersByTime(SHOUT.gapMs * 3)
    expect(useLive.getState().shout).toBeNull()

    useLive.setState({ source: 'tikfinity' })
    s.ingest({ type: 'join', user: fan('fake'), at: Date.now() }, { sim: true })
    expect(useLive.getState().shout).toBeNull()
  })

  it('sala enchendo: o intervalo entre boas-vindas cresce; sala cheia não saúda entrada (só seguir); entrada velha na fila cai', () => {
    expect([null, 0, 4, 5, 19, 20, 300].map(shoutGap)).toEqual([4000, 4000, 4000, 8000, 8000, 14_000, 14_000])
    const q = createShoutQueue()
    q.push('join', fan('a'), 0)
    q.push('join', fan('b'), 0)
    expect(q.take(0, 14_000)?.user.id).toBe('a')
    expect(q.take(8000, 14_000)).toBeNull()
    // 'b' esperou mais que joinMaxAgeMs: talvez nem esteja mais na sala
    expect(q.take(SHOUT.joinMaxAgeMs + 1, 14_000)).toBeNull()
    expect(q.size()).toBe(0)
    useLive.setState({ viewers: JOIN_SHOUT_MAX_VIEWERS })
    useLive.getState().ingest({ type: 'join', user: fan('ana'), at: Date.now() })
    expect(useLive.getState().shout).toBeNull()
    useLive.getState().ingest({ type: 'follow', user: fan('ana'), at: Date.now() })
    expect(useLive.getState().shout).toMatchObject({ kind: 'follow', user: { id: 'ana' } })
  })

  it('boas-vindas convida para o que dá para fazer agora (número só com a votação aberta)', () => {
    const round = createRound({ id: 'r', kind: 'decision', title: 'T', options: opts(3), seconds: 20 }, 0)
    expect(joinInvite({ round, creation: null })).toBe('comenta 1 a 3 pra jogar')
    expect(joinInvite({ round: null, creation: 'bidding' })).toBe('doe e crie a próxima lenda')
    expect(joinInvite({ round: null, creation: 'creating' })).toBe('a próxima lenda está nascendo')
    expect(joinInvite({ round: null, creation: null })).toBe('a próxima votação já vem: comente o número')
  })
})

// ───────────────────────── F5 · ranking da live ─────────────────────────

describe('F5 · ranking da live de hoje', () => {
  const entry = (id: string, score: number, over: Partial<RankEntry> = {}): RankEntry => ({ id, surname: id.toUpperCase(), score, tier: 'Craque', at: score, ...over })

  it('um ranking por dia local (lenda:live:ranking:AAAA-MM-DD), em ordem de nota, sem repetir e com limite', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    let list: RankEntry[] = []
    for (let i = 0; i < RANKING_CAP + 5; i++) list = insertRanking(list, entry(`l${i}`, i))
    expect(list).toHaveLength(RANKING_CAP)
    expect(list[0].score).toBe(RANKING_CAP + 4)
    expect(insertRanking(list, entry('l60', 99)).filter((e) => e.id === 'l60')).toHaveLength(1)
  })

  it('grava no dia, comemora só quando bate o recorde, e numa live de verdade esconde as lendas do simulador', () => {
    const r1 = recordLiveLegend(entry('a', 50), true)
    expect(r1.record).toBe(false)
    expect(localStorage.getItem(`${RANKING_PREFIX}2026-10-10`)).toContain('"a"')
    expect(recordLiveLegend(entry('b', 40), true).record).toBe(false)
    // do simulador numa live de verdade: entra marcada, mas não conta como recorde nem aparece
    expect(recordLiveLegend(entry('s', 99, { sim: true }), true).record).toBe(false)
    expect(recordLiveLegend(entry('c', 70, { by: 'ana' }), true).record).toBe(true)
    expect(visibleRanking(readRanking(), true).map((e) => e.id)).toEqual(['c', 'a', 'b'])
    expect(visibleRanking(readRanking(), false).map((e) => e.id)).toEqual(['s', 'c', 'a', 'b'])
    // virou o dia: ranking novo; dias com mais de uma semana somem
    vi.setSystemTime(new Date(2026, 9, 20, 12, 0))
    expect(recordLiveLegend(entry('d', 10), true).list.map((e) => e.id)).toEqual(['d'])
    expect(localStorage.getItem(`${RANKING_PREFIX}2026-10-10`)).toBeNull()
  })

  it('carreira jogada na live termina → entra no ranking com a nota, a faixa e quem criou (o vencedor da disputa)', async () => {
    useLive.setState({ source: 'ponte' })
    const pick = vi.spyOn(director, 'pick').mockResolvedValue(undefined)
    startCareer.mockImplementation(async (identity: { surname: string }) => {
      useCareer.setState({ state: { id: 'c-1', phase: 'deciding', retired: false, identity, seasons: [], pendingDecision: null } as never })
    })
    useLiveConfig.getState().set({ minBidCoins: 1 })
    startAutopilot()
    await vi.advanceTimersByTimeAsync(500)
    const ana = fan('ana')
    useLive.getState().ingest(gift(ana, 100))
    await vi.advanceTimersByTimeAsync(30_500)
    useLive.getState().ingest(chat(ana, '!criar Recorde, Brasil, atacante'))
    useLive.getState().ingest(chat(ana, '!ok'))
    await vi.advanceTimersByTimeAsync(6000)
    expect(useLive.getState().credit).toMatchObject({ careerId: 'c-1', by: { id: 'ana' } })
    expect(useLive.getState().credit?.sim).toBeUndefined()
    setRoute('/carreira')
    await vi.advanceTimersByTimeAsync(500)
    // a carreira acaba
    useCareer.setState({ state: { ...useCareer.getState().state!, phase: 'finished', retired: true } as never })
    await vi.advanceTimersByTimeAsync(1000)
    expect(useLive.getState().stage).toBe('ending')
    const list = readRanking()
    expect(list).toEqual([expect.objectContaining({ id: 'c-1', surname: 'RECORDE', score: 93, tier: 'Imortal', by: 'ana' })])
    expect(list[0].sim).toBeUndefined()
    void pick
  })

  it('carreira que já tinha acabado antes da live não entra (só a que o autopiloto viu em jogo)', async () => {
    useCareer.setState({ state: { id: 'velha', phase: 'finished', retired: true, identity: { surname: 'VELHA' }, seasons: [], pendingDecision: null } as never })
    setRoute('/carreira')
    startAutopilot()
    await vi.advanceTimersByTimeAsync(1500)
    expect(useLive.getState().stage).toBe('ending')
    expect(readRanking()).toEqual([])
  })
})

describe('F5 · ranking: só lenda de verdade vai ao ar numa live de verdade', () => {
  const entry = (id: string, score: number, over: Partial<RankEntry> = {}): RankEntry => ({ id, surname: id.toUpperCase(), score, tier: 'Craque', at: score, ...over })

  /** Disputa vencida por `who` (presente de 100), ficha pelo chat, carreira que termina — como numa live. */
  async function playCareer(who: LiveUser, careerId: string) {
    vi.spyOn(director, 'pick').mockResolvedValue(undefined)
    startCareer.mockImplementation(async (identity: { surname: string }) => {
      useCareer.setState({ state: { id: careerId, phase: 'deciding', retired: false, identity, seasons: [], pendingDecision: null } as never })
    })
    startAutopilot()
    await vi.advanceTimersByTimeAsync(500)
    useLive.getState().ingest(gift(who, 100))
    await vi.advanceTimersByTimeAsync(30_500)
    useLive.getState().ingest(chat(who, '!criar Recorde, Brasil, atacante'))
    useLive.getState().ingest(chat(who, '!ok'))
    await vi.advanceTimersByTimeAsync(6000)
    setRoute('/carreira')
    await vi.advanceTimersByTimeAsync(500)
    useCareer.setState({ state: { ...useCareer.getState().state!, phase: 'finished', retired: true } as never })
    await vi.advanceTimersByTimeAsync(1000)
  }

  it('demonstração da ponte (npm run live:demo): a lenda vai como teste e some numa live de verdade; sair da demo zera a sessão', async () => {
    useLive.setState({ source: 'ponte' })
    useLive.getState().setStatus({ state: 'demo', user: 'demo' })
    expect(useLive.getState().bridgeDemo).toBe(true)
    expect(realLive()).toBe(false)
    await playCareer(fan('gabi.fut'), 'c-demo')
    expect(useLive.getState().credit).toMatchObject({ careerId: 'c-demo', sim: true })
    const list = readRanking()
    expect(list).toEqual([expect.objectContaining({ id: 'c-demo', by: 'gabi.fut', sim: true })])
    expect(visibleRanking(list, true)).toEqual([])
    expect(visibleRanking(list, realLive())).toHaveLength(1)
    expect(useLive.getState().supporters['gabi.fut']).toBeDefined()
    // a ponte reinicia sem --demo (a janela continua aberta): o público da demo sai de cena
    stopAutopilot()
    useLive.getState().setStatus({ state: 'connected', user: 'meu.perfil' })
    expect(useLive.getState().bridgeDemo).toBe(false)
    expect(realLive()).toBe(true)
    expect(useLive.getState().supporters).toEqual({})
    // o "hello" da ponte também diz o modo (a ponte de verdade chega dizendo que não é demo)
    useLive.getState().setBridgeDemo(true)
    useLive.getState().setBridgeDemo(false)
    expect(useLive.getState().bridgeDemo).toBe(false)
    // o simulador também usa o estado 'demo', mas não é a demonstração da ponte
    useLive.setState({ source: 'simulador' })
    useLive.getState().setStatus({ state: 'demo' })
    expect(useLive.getState().bridgeDemo).toBe(false)
  })

  it('quem criou é da carreira: começar a live não apaga o crédito; carreira sem crédito conhecido entra como teste', async () => {
    useLive.setState({ credit: { careerId: 'c-sim', sim: true } })
    useLive.getState().clearSession()
    expect(useLive.getState().credit).toEqual({ careerId: 'c-sim', sim: true })
    // live de verdade, carreira jogada aqui sem saber quem criou (continuada de antes): não vai ao ar como "do chat"
    useLive.setState({ source: 'tikfinity', credit: null })
    useCareer.setState({ state: { id: 'c-x', phase: 'deciding', retired: false, identity: { surname: 'SEMDONO' }, seasons: [], pendingDecision: null } as never })
    setRoute('/carreira')
    startAutopilot()
    await vi.advanceTimersByTimeAsync(500)
    useCareer.setState({ state: { ...useCareer.getState().state!, phase: 'finished', retired: true } as never })
    await vi.advanceTimersByTimeAsync(1000)
    expect(readRanking()).toEqual([expect.objectContaining({ id: 'c-x', sim: true })])
    expect(visibleRanking(readRanking(), true)).toEqual([])
  })

  it('lenda do simulador que termina depois de trocar para a live de verdade continua de teste', async () => {
    useCareer.setState({ state: { id: 'c-s', phase: 'deciding', retired: false, identity: { surname: 'DUDU' }, seasons: [], pendingDecision: null } as never })
    useLive.setState({ credit: { careerId: 'c-s', sim: true } })
    // trocou a fonte: a store zera a sessão (o crédito fica)
    useLive.getState().clearSession()
    useLive.setState({ source: 'ponte' })
    setRoute('/carreira')
    startAutopilot()
    await vi.advanceTimersByTimeAsync(500)
    useCareer.setState({ state: { ...useCareer.getState().state!, phase: 'finished', retired: true } as never })
    await vi.advanceTimersByTimeAsync(1000)
    expect(readRanking()).toEqual([expect.objectContaining({ id: 'c-s', sim: true })])
  })

  it('lendas de teste não tomam a vaga das de verdade; gravar relê o armazenamento (outra janela gravou no meio)', () => {
    let list: RankEntry[] = []
    for (let i = 0; i < RANKING_CAP + 10; i++) list = insertRanking(list, entry(`s${i}`, 60 + (i % 30), { sim: true }))
    list = insertRanking(list, entry('real', 55))
    expect(list.filter((e) => e.sim)).toHaveLength(SIM_RANKING_CAP)
    expect(visibleRanking(list, true).map((e) => e.id)).toEqual(['real'])
    recordLiveLegend(entry('a1', 50), true)
    // outra janela deste navegador grava depois que esta leu
    const key = `${RANKING_PREFIX}${dayKey()}`
    localStorage.setItem(key, JSON.stringify([...JSON.parse(localStorage.getItem(key)!), entry('b1', 40)]))
    recordLiveLegend(entry('a2', 30), true)
    expect(readRanking().map((e) => e.id)).toEqual(['a1', 'b1', 'a2'])
  })

  it('"criada pelo chat" (com a contração); @ ofensivo no ranking vira "um torcedor"', () => {
    expect(creatorPhrase({})).toBe('criada pelo chat')
    expect(creatorPhrase({ by: 'gabi.fut' })).toBe('criada por @gabi.fut')
    expect(creatorLabel({})).toBe('o chat')
    expect(creatorLabel({ by: 'vai_tomar_no_cu' })).toBe('um torcedor')
    expect(creatorPhrase({ by: 'vai_tomar_no_cu' })).toBe('criada por um torcedor')
  })
})

// ───────────────────────── F6 · voto do streamer ─────────────────────────

describe('F6 · voto do streamer', () => {
  it('vale um comentário, pode mudar, aparece como "voto do streamer" e só na votação certa', () => {
    useLive.setState({ source: 'ponte' })
    void useLive.getState().startRound({ id: 'd:s', kind: 'decision', title: 'T', options: opts(3) })
    expect(useLive.getState().streamerVote(1, 'd:outra')).toBe(false)
    expect(useLive.getState().streamerVote(7)).toBe(false)
    expect(useLive.getState().streamerVote(1, 'd:s')).toBe(true)
    expect(useLive.getState().round!.tallies.map((t) => t.points)).toEqual([0, 1, 0])
    expect(useLive.getState().feed[0]).toMatchObject({ kind: 'info', text: 'Voto do streamer', option: 1, streamer: true, user: STREAMER })
    useLive.getState().streamerVote(2, 'd:s')
    expect(useLive.getState().round!.tallies.map((t) => t.points)).toEqual([0, 0, 1])
    // um voto só: a mesma pessoa
    useLive.getState().ingest(chat(fan('ana'), '1'))
    expect(useLive.getState().round!.tallies.map((t) => t.points)).toEqual([1, 0, 1])
    // é voto: a sala vazia não corta a rodada
    vi.advanceTimersByTime(12_000)
    expect(useLive.getState().round).not.toBeNull()
  })

  it('com "comentário vale voto" desligado: o voto do streamer não acontece (nem segura a sala vazia)', () => {
    useLive.setState({ source: 'ponte' })
    useLiveConfig.getState().set({ commentVotes: false })
    void useLive.getState().startRound({ id: 'd:off', kind: 'decision', title: 'T', options: opts(3) })
    expect(useLive.getState().streamerVote(1)).toBe(false)
    expect(hasVotes(useLive.getState().round!)).toBe(false)
    expect(useLive.getState().feed.some((f) => f.streamer)).toBe(false)
    vi.advanceTimersByTime(10_300)
    expect(useLive.getState().result?.outcome).toMatchObject({ reason: 'no-votes', quiet: true })
  })

  it('chega pela ponte (painel em outro navegador): só a mensagem certa, uma vez', () => {
    const got: [number, string | undefined][] = []
    const off = onStreamerVote((o, r) => got.push([o, r]))
    const msg = { cmd: 'streamer-vote', option: 2, round: 'd:x', mid: 'painel.1', from: 'painel' }
    dispatchRelay({ type: 'relay', msg })
    dispatchRelay({ type: 'relay', msg })
    dispatchRelay({ type: 'relay', msg: { cmd: 'streamer-vote', option: 'dois', mid: 'painel.2', from: 'painel' } })
    dispatchRelay({ type: 'relay', msg: { cmd: 'streamer-vote', option: 1, mid: `${WINDOW_ID}.9`, from: WINDOW_ID } })
    off()
    expect(got).toEqual([[2, 'd:x']])
  })
})
