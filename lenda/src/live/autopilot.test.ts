import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Decision } from '@/engine/types'
import { mergeHall, useCareer, type HallEntry } from '@/store/career'
import { kv, KV_KEYS } from '@/store/persist'
import { useApp } from '@/store/app'
import { useData } from '@/store/data'
import { director } from '@/ui/classic/reveal/director'
import { useReveal } from '@/ui/classic/reveal/store'
import { decisionRound, newLegendNow, startAutopilot, stopAutopilot } from './autopilot'
import { DEFAULT_LIVE_CONFIG, useLiveConfig, useLiveSession } from './config'
import { connectLive, disconnectLive } from './connection'
import { CONFIRM_MS, useLive } from './store'
import type { LiveUser } from './types'

const eff = (p: number) => [{ label: 'Gol! Título', kind: 'positive' as const, probability: p }, { label: 'Defesa: fica com o vice', kind: 'negative' as const, probability: 1 - p }]

describe('decisionRound', () => {
  it('penalty: one vote option per corner, each mapped to its option + side', () => {
    const d = {
      id: 'pen1',
      kind: 'event',
      title: 'Pênalti decisivo',
      description: '',
      options: (['left', 'center', 'right'] as const).map((s, i) => ({ id: `penalty_final:${s}`, label: s, art: `penalty-${s}`, minigame: 'penalty' as const, effects: eff([0.7, 0.5, 0.72][i]) })),
    } as unknown as Decision
    const { spec, picks } = decisionRound(d)
    // os mesmos nomes das zonas do pênalti na tela
    expect(spec.options.map((o) => o.label)).toEqual(['Esquerda', 'Meio', 'Direita'])
    expect(spec.options[0].sub).toBe('70% de chance')
    expect(picks).toEqual([
      { optionId: 'penalty_final:left', side: 'left' },
      { optionId: 'penalty_final:center', side: 'center' },
      { optionId: 'penalty_final:right', side: 'right' },
    ])
    expect(spec.id).toBe('d:pen1')
  })
  it('regular decisions keep option order, use title/club name and cap at 4', () => {
    const d = {
      id: 'x',
      kind: 'transfer',
      title: 'Janela',
      description: '',
      options: [
        { id: 'a', label: 'Assinar com', title: 'Real Madrid', effects: [] },
        { id: 'b', label: 'Ficar no Palmeiras', effects: [] },
        { id: 'c', label: 'c', effects: [] },
        { id: 'd', label: 'd', effects: [] },
        { id: 'e', label: 'e', effects: [] },
      ],
    } as unknown as Decision
    const { spec, picks } = decisionRound(d)
    expect(spec.options.map((o) => o.label)).toEqual(['Real Madrid', 'Ficar no Palmeiras', 'c', 'd'])
    expect(spec.options[0].sub).toBe('Assinar com')
    expect(picks.map((p) => p.optionId)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('5 opções (3 propostas + ficar + aposentar-se): ficam "ficar" e "aposentar-se", e o voto escolhe a opção certa', () => {
    const d = {
      id: 'y',
      kind: 'transfer',
      title: 'Janela',
      description: '',
      options: ['transfer-1', 'transfer-2', 'transfer-3', 'stay-9', 'retire-4'].map((id) => ({ id, label: id, effects: [] })),
    } as unknown as Decision
    const { spec, picks } = decisionRound(d)
    expect(spec.options.map((o) => o.id)).toEqual(['transfer-1', 'transfer-2', 'stay-9', 'retire-4'])
    expect(picks.map((p) => p.optionId)).toEqual(spec.options.map((o) => o.id))
  })
})

// ── autopiloto / store / conexão (ambiente node: navegador mínimo de mentira) ──

const fan = (id: string): LiveUser => ({ id, name: id })
const gift = (user: LiveUser, coins: number) => ({ type: 'gift' as const, user, gift: { id: 'g', name: 'Doughnut', coins }, count: 1, at: Date.now() })
const chat = (user: LiveUser, text: string) => ({ type: 'chat' as const, user, text, at: Date.now() })

const decision = (id: string) =>
  ({
    id,
    kind: 'transfer',
    title: 'Proposta',
    description: '',
    options: [
      { id: `${id}-a`, label: 'Aceitar', effects: [] },
      { id: `${id}-b`, label: 'Recusar', effects: [] },
    ],
  }) as unknown as Decision

const career = (over: Record<string, unknown> = {}) => ({ id: 'old', phase: 'deciding', retired: false, identity: { surname: 'VELHO' }, pendingDecision: decision('d1'), ...over }) as never

let startCareer: ReturnType<typeof vi.fn>

/** Rota direto no estado (o persist do app.ts não tem storage no node e quebraria um setState). */
function setRoute(path: '/carreira' | '/live', tela?: string) {
  ;(useApp.getState() as { route: unknown }).route = { path, query: tela ? { tela } : {} }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('location', { hash: '', pathname: '/', origin: 'http://localhost' })
  vi.stubGlobal('history', { state: null, replaceState: () => {} })
  vi.stubGlobal('window', { scrollTo: () => {}, addEventListener: () => {}, removeEventListener: () => {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('innerHeight', 800)
  vi.stubGlobal('document', { querySelector: () => null })
  useLiveConfig.setState({ config: { ...DEFAULT_LIVE_CONFIG, creator: 'disputa', bidSeconds: 10, createSeconds: 20, minBidCoins: 1, identityVote: false, nameMode: 'aleatorio', nextCareerSeconds: 5, simAuto: false } })
  useLiveSession.setState({ on: true, paused: false })
  useLive.getState().clearSession()
  useLive.setState({ source: 'simulador' })
  startCareer = vi.fn(async () => ({}))
  useCareer.setState({ status: 'ready', isFixture: false, busy: false, state: null, start: startCareer as never })
  useReveal.setState({ phase: 'idle', celebrationOpen: false })
  useData.setState({ data: { countries: [{ code: 'BRA', name: 'Brasil' }, { code: 'ARG', name: 'Argentina' }] } as never })
  setRoute('/live', 'palco')
})

afterEach(() => {
  useLiveSession.setState({ on: false, paused: false })
  stopAutopilot()
  disconnectLive()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('autopiloto', () => {
  it('"Nova lenda" pedida antes de o autopiloto rodar abre a disputa, mesmo com uma carreira em andamento', async () => {
    useCareer.setState({ state: career() })
    setRoute('/carreira')
    newLegendNow()
    startAutopilot()
    await vi.advanceTimersByTimeAsync(500)
    expect(useLive.getState().creation?.phase).toBe('bidding')
    expect(useLive.getState().round).toBeNull()
  })

  it('lance abaixo do mínimo: avisa "ninguém chegou ao mínimo" (não "ninguém doou")', async () => {
    useLiveConfig.getState().set({ minBidCoins: 50 })
    startAutopilot()
    await vi.advanceTimersByTimeAsync(500)
    useLive.getState().ingest(gift(fan('ana'), 5))
    await vi.advanceTimersByTimeAsync(10_500)
    const texts = useLive.getState().feed.map((f) => f.text)
    expect(texts).toContain('Ninguém chegou ao mínimo de 50 moedas')
    expect(texts.some((t) => t.startsWith('Ninguém doou'))).toBe(false)
  })

  it('"Nova lenda" com a votação de decisão aberta: a votação morre e nada é escolhido na carreira velha', async () => {
    const pick = vi.spyOn(director, 'pick').mockResolvedValue(undefined)
    useCareer.setState({ state: career() })
    setRoute('/carreira')
    startAutopilot()
    await vi.advanceTimersByTimeAsync(500)
    expect(useLive.getState().round?.id).toBe('d:d1')
    newLegendNow()
    expect(useLive.getState().round).toBeNull()
    await vi.advanceTimersByTimeAsync(3000)
    expect(pick).not.toHaveBeenCalled()
    expect(useLive.getState().creation?.phase).toBe('bidding')
  })

  it('votação já decidida + "Nova lenda" durante a pausa de 1,5 s: não escolhe na carreira velha', async () => {
    const pick = vi.spyOn(director, 'pick').mockResolvedValue(undefined)
    useCareer.setState({ state: career() })
    setRoute('/carreira')
    startAutopilot()
    await vi.advanceTimersByTimeAsync(500)
    useLive.getState().closeNow()
    await vi.advanceTimersByTimeAsync(100)
    newLegendNow()
    await vi.advanceTimersByTimeAsync(3000)
    expect(pick).not.toHaveBeenCalled()
  })

  it('parar e religar durante o anúncio: só UMA carreira nasce e a disputa nova não é encerrada pelo fluxo velho', async () => {
    useLiveConfig.getState().set({ creator: 'votacao' })
    startAutopilot()
    await vi.advanceTimersByTimeAsync(500)
    expect(useLive.getState().announce).not.toBeNull()
    // o streamer sai do modo live e liga de novo no meio do anúncio (agora em modo disputa)
    useLiveSession.setState({ on: false })
    stopAutopilot()
    useLiveConfig.getState().set({ creator: 'disputa' })
    useLiveSession.setState({ on: true })
    startAutopilot()
    await vi.advanceTimersByTimeAsync(500)
    expect(useLive.getState().creation?.phase).toBe('bidding')
    await vi.advanceTimersByTimeAsync(5000)
    expect(startCareer).not.toHaveBeenCalled()
    expect(useLive.getState().creation?.phase).toBe('bidding')
  })

  it('pausa congela a contagem do fim de carreira', async () => {
    useCareer.setState({ state: career({ phase: 'finished', pendingDecision: null }) })
    setRoute('/carreira')
    startAutopilot()
    await vi.advanceTimersByTimeAsync(500)
    expect(useLive.getState().stage).toBe('ending')
    expect(useLive.getState().nextCareerAt).not.toBeNull()
    useLiveSession.getState().setPaused(true)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(useLive.getState().stage).toBe('ending')
    useLiveSession.getState().setPaused(false)
    await vi.advanceTimersByTimeAsync(6000)
    expect(useLive.getState().stage).toBe('identity')
  })

  it('pausa congela a comemoração (só some depois de retomar)', async () => {
    const dismiss = vi.spyOn(director, 'dismissCelebration').mockImplementation(() => {})
    useLiveConfig.getState().set({ celebrationSeconds: 3 })
    useCareer.setState({ state: career() })
    useReveal.setState({ celebrationOpen: true })
    setRoute('/carreira')
    startAutopilot()
    await vi.advanceTimersByTimeAsync(500)
    useLiveSession.getState().setPaused(true)
    await vi.advanceTimersByTimeAsync(8000)
    expect(dismiss).not.toHaveBeenCalled()
    useLiveSession.getState().setPaused(false)
    await vi.advanceTimersByTimeAsync(4000)
    expect(dismiss).toHaveBeenCalled()
  })

  it('o anúncio credita o vencedor da disputa com as moedas por extenso ("1,1 mil moedas")', async () => {
    useLiveConfig.getState().set({ identityVote: false })
    startAutopilot()
    await vi.advanceTimersByTimeAsync(500)
    const ana = fan('ana')
    useLive.getState().ingest(gift(ana, 1100))
    await vi.advanceTimersByTimeAsync(10_500)
    expect(useLive.getState().creation?.phase).toBe('creating')
    useLive.getState().ingest(chat(ana, '!criar Israel, Brasil, zagueiro'))
    expect(useLive.getState().creation?.draft).toEqual({ surname: 'ISRAEL', nationality: 'BRA', position: 'ZAG' })
    useLive.getState().ingest(chat(ana, '!ok'))
    await vi.advanceTimersByTimeAsync(600)
    const a = useLive.getState().announce
    expect(a?.title).toBe('ISRAEL')
    expect(a?.lines).toContain('Criada por @ana, que venceu a disputa com 1,1 mil moedas!')
  })

  it('apoiador de teste nunca dá nome à lenda numa live de verdade', async () => {
    useLive.setState({ source: 'ponte' })
    useLiveConfig.getState().set({ creator: 'votacao', nameMode: 'apoiador' })
    useLive.getState().ingest(gift(fan('fefe.sport'), 1000), { sim: true })
    useLive.getState().ingest(gift(fan('carla.real'), 10))
    expect(Object.keys(useLive.getState().supporters)).toEqual(['carla.real'])
    startAutopilot()
    await vi.advanceTimersByTimeAsync(500)
    expect(useLive.getState().announce?.honoree?.id).toBe('carla.real')
  })
})

describe('criação pelo vencedor', () => {
  const winner = fan('dono')
  const open = () => useLive.getState().startCreating({ user: winner, coins: 100, at: Date.now() }, 60)

  it('ficha completa espera ~6 s; cada correção reinicia; "!ok" começa na hora', () => {
    open()
    const say = (t: string) => useLive.getState().ingest(chat(winner, t))
    say('!nome Gabigol')
    say('!pais BRA')
    expect(useLive.getState().creation?.readyAt).toBeUndefined()
    say('!posicao atacante')
    const c1 = useLive.getState().creation!
    expect(c1.draft.position).toBe('CA')
    expect(c1.readyAt).toBe(Date.now() + CONFIRM_MS)
    vi.advanceTimersByTime(4000)
    say('!nome Zico')
    expect(useLive.getState().creation?.draft.surname).toBe('ZICO')
    expect(useLive.getState().creation?.readyAt).toBe(Date.now() + CONFIRM_MS)
    say('!ok')
    expect(useLive.getState().creation?.readyAt).toBe(Date.now())
  })

  it('pausa empurra o "começa em 6 s"', () => {
    open()
    const say = (t: string) => useLive.getState().ingest(chat(winner, t))
    say('!nome Gabigol')
    say('!pais BRA')
    say('!posicao goleiro')
    const at = useLive.getState().creation!.readyAt!
    useLiveSession.getState().setPaused(true)
    vi.advanceTimersByTime(10_000)
    expect(useLive.getState().creation!.readyAt! - at).toBeGreaterThanOrEqual(9000)
  })

  it('"!ok" com a ficha incompleta diz o que falta', () => {
    open()
    useLive.getState().ingest(chat(winner, '!nome Gabigol'))
    useLive.getState().ingest(chat(winner, '!ok'))
    expect(useLive.getState().creation?.readyAt).toBeUndefined()
    expect(useLive.getState().creation?.feedback).toMatch(/Ainda falta/)
  })

  it('mensagens de outras pessoas não mexem na ficha', () => {
    open()
    useLive.getState().ingest(chat(fan('intruso'), '!nome Bobo'))
    expect(useLive.getState().creation?.draft).toEqual({})
  })
})

describe('sessão', () => {
  it('simulado vota mas não vira apoiador nem lance numa live de verdade; no simulador conta', () => {
    useLive.setState({ source: 'ponte' })
    useLive.getState().startBidding(30)
    useLive.getState().ingest(gift(fan('teste'), 500), { sim: true })
    expect(useLive.getState().supporters).toEqual({})
    expect(useLive.getState().creation?.bids).toEqual({})
    useLive.setState({ source: 'simulador' })
    useLive.getState().ingest(gift(fan('teste'), 500), { sim: true })
    expect(useLive.getState().supporters.teste.coins).toBe(500)
    expect(useLive.getState().supporters.teste.sim).toBe(true)
  })

  it('presente solto de quem ainda não comentou fica guardado (o feed pede o número) e vale quando a pessoa comenta', () => {
    void useLive.getState().startRound({ id: 'r-held', kind: 'decision', title: 'T', options: ['A', 'B', 'C'].map((l) => ({ id: l, label: l })) })
    const ana = fan('ana')
    useLive.getState().ingest(gift(ana, 30))
    expect(useLive.getState().feed[0]).toMatchObject({ kind: 'gift', held: 3 })
    expect(useLive.getState().feed[0].option).toBeUndefined()
    expect(useLive.getState().round!.tallies.map((t) => t.points)).toEqual([0, 0, 0])
    useLive.getState().ingest(chat(ana, '2'))
    expect(useLive.getState().feed[0]).toMatchObject({ kind: 'info', option: 1, text: 'ana: presente guardado' })
    expect(useLive.getState().round!.tallies.map((t) => t.points)).toEqual([0, 301, 0])
    // quem já comentou: o presente vai direto para o número dela
    useLive.getState().ingest(gift(ana, 30))
    expect(useLive.getState().feed[0]).toMatchObject({ kind: 'gift', option: 1 })
    expect(useLive.getState().feed[0].held).toBeUndefined()
  })

  it('clearSession zera apoiadores, feed, disputa e ficha pendente', () => {
    useLive.getState().ingest(gift(fan('a'), 10))
    useLive.getState().startBidding(30)
    useLive.setState({ pendingLegend: { draft: { surname: 'X' }, creator: null } })
    useLive.getState().clearSession()
    const s = useLive.getState()
    expect([s.supporters, s.careerSupporters, s.feed, s.creation, s.pendingLegend]).toEqual([{}, {}, [], null, null])
  })
})

describe('conexão', () => {
  class FakeSocket {
    static all: FakeSocket[] = []
    static OPEN = 1
    readyState = 0
    onopen: (() => void) | null = null
    onmessage: ((e: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(public url: string) {
      FakeSocket.all.push(this)
    }
    send() {}
    close() {
      this.readyState = 3
      // como no navegador: o "close" chega depois, de forma assíncrona
      setTimeout(() => this.onclose?.(), 0)
    }
  }

  it('trocar de fonte com o socket aberto não deixa socket zumbi (nem reconexão fantasma)', async () => {
    FakeSocket.all = []
    vi.stubGlobal('WebSocket', FakeSocket)
    useLiveConfig.getState().set({ source: 'ponte', bridgeUrl: 'ws://localhost:1/ws' })
    connectLive()
    expect(FakeSocket.all).toHaveLength(1)
    useLiveConfig.getState().set({ source: 'simulador' })
    connectLive()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(FakeSocket.all).toHaveLength(1)
    useLiveConfig.getState().set({ source: 'ponte' })
    connectLive()
    await vi.advanceTimersByTimeAsync(100)
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('trocar de fonte zera o público de teste', () => {
    useLiveConfig.getState().set({ source: 'simulador' })
    connectLive()
    useLive.getState().ingest(gift(fan('fake'), 100), { sim: true })
    expect(Object.keys(useLive.getState().supporters)).toEqual(['fake'])
    vi.stubGlobal('WebSocket', FakeSocket)
    useLiveConfig.getState().set({ source: 'ponte' })
    connectLive()
    expect(useLive.getState().supporters).toEqual({})
  })
})

describe('Hall das Lendas', () => {
  const entry = (id: string, runNo?: number) => ({ id, runNo, finishedAt: `2026-01-0${runNo ?? 9}T00:00:00Z` }) as unknown as HallEntry
  it('mergeHall junta o gravado com a memória sem perder runs de outra janela', () => {
    const merged = mergeHall([entry('b', 2), entry('c', 3)], [entry('a', 1), entry('b', 2)])
    expect(merged.map((h) => h.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('carreira encerrada numa aba com o Hall velho na memória não apaga as runs gravadas por outra janela', async () => {
    vi.useRealTimers()
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k) })
    vi.stubGlobal('requestAnimationFrame', (f: () => void) => setTimeout(f, 0))
    // a janela da live gravou uma run que esta aba não conhece
    await kv.set(KV_KEYS.hall, [{ ...entry('da-janela', 1), summary: { legacyScore: 80 } }])
    const finished = { id: 'c1', version: 1, phase: 'finished', retired: true, identity: { surname: 'NOVO' }, seasons: [], pace: 'normal', mode: 'classico', pendingDecision: null }
    const engine = { choose: () => ({ state: finished, reveal: { finished: true, achievements: [] } }), summarize: () => ({ legacyScore: 10 }) }
    useCareer.setState({ finishedCareers: [], state: { id: 'c1', version: 1, phase: 'deciding', pendingDecision: { id: 'x', options: [{ id: 'o' }] } } as never, engine: engine as never, data: {} as never, engineKind: 'mock', busy: false, isFixture: false })
    await useCareer.getState().choose('o')
    const hall = (await kv.get<HallEntry[]>(KV_KEYS.hall)) ?? []
    expect(hall.map((h) => h.id).sort()).toEqual(['c1', 'da-janela'])
    expect(useCareer.getState().finishedCareers.map((h) => h.id).sort()).toEqual(['c1', 'da-janela'])
  })

  it('reload() traz a carreira e o Hall gravados por outra janela', async () => {
    vi.useRealTimers()
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k) })
    await kv.set(KV_KEYS.current, { id: 'nova', version: 1, phase: 'deciding', period: 3, seasons: [{}, {}], identity: { surname: 'B' } })
    await kv.set(KV_KEYS.hall, [entry('x', 1)])
    useCareer.setState({ status: 'ready', state: null, finishedCareers: [entry('y', 2)], busy: false, saving: false, reveal: null, isFixture: false })
    await useCareer.getState().reload()
    expect(useCareer.getState().state?.id).toBe('nova')
    expect(useCareer.getState().finishedCareers.map((h) => h.id).sort()).toEqual(['x', 'y'])
  })
})
