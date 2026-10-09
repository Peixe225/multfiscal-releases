/**
 * Estado da live em tempo real: conexão, votação em andamento, apoiadores, feed e termômetro de curtidas.
 *
 *   const outcome = await useLive.getState().startRound({ id, kind: 'decision', title, options })
 *   useLive.getState().ingest({ type: 'gift', … })       // simulador / conexão
 */
import { create } from 'zustand'
import { useLiveConfig, useLiveSession } from './config'
import { giftLabel } from './gifts'
import type { BridgeStatus, LiveEvent, LiveGiftInfo, LiveSource, LiveUser } from './types'
import { applyEvent, createRound, decide, extend, shouldExtend, type Outcome, type Round, type RoundKind, type VoteOption } from './votes'

export interface FeedItem {
  id: number
  kind: 'gift' | 'vote' | 'follow' | 'share' | 'join' | 'result' | 'info'
  user?: LiveUser
  text: string
  gift?: LiveGiftInfo
  count?: number
  coins?: number
  /** Opção beneficiada (0-based). */
  option?: number
  at: number
}

export interface Supporter {
  user: LiveUser
  coins: number
  gifts: number
  at: number
}

export interface Announcement {
  kicker: string
  title: string
  lines: string[]
  /** Apoiador homenageado (dá nome ao jogador). */
  honoree?: LiveUser
  until: number
}

export interface RoundSpec {
  id: string
  kind: RoundKind
  title: string
  subtitle?: string
  options: VoteOption[]
  seconds?: number
}

interface LiveStore {
  source: LiveSource | null
  status: BridgeStatus
  viewers: number | null
  likes: number
  /** Curtidas acumuladas para o próximo "termômetro cheio". */
  likesMeter: number
  /** Quantas vezes o termômetro encheu na sessão. */
  likeBursts: number
  catalog: LiveGiftInfo[]
  round: Round | null
  result: { round: Round; outcome: Outcome; at: number } | null
  supporters: Record<string, Supporter>
  /** Apoiadores desde o começo da carreira atual (homenagem no fim / nome da próxima lenda). */
  careerSupporters: Record<string, Supporter>
  feed: FeedItem[]
  /** Fase do autopiloto (para o palco e a HUD). */
  stage: 'idle' | 'identity' | 'career' | 'ending'
  /** Fim de carreira: quando começa a próxima (ms epoch). */
  nextCareerAt: number | null
  announce: Announcement | null

  setSource(s: LiveSource | null): void
  setStatus(s: BridgeStatus): void
  setCatalog(list: LiveGiftInfo[]): void
  ingest(e: LiveEvent): void
  startRound(spec: RoundSpec): Promise<Outcome | null>
  /** Encerra a votação agora (o streamer apertou "encerrar"). */
  closeNow(): void
  cancelRound(): void
  resetCareerSupporters(): void
  clearSession(): void
  pushInfo(text: string): void
}

const FEED_MAX = 14
let feedId = 1
let resolver: ((o: Outcome | null) => void) | null = null
let ticker: ReturnType<typeof setInterval> | null = null
let lastTick = 0

function addSupporter(map: Record<string, Supporter>, user: LiveUser, coins: number, count: number, at: number): Record<string, Supporter> {
  const cur = map[user.id]
  return { ...map, [user.id]: { user: { ...cur?.user, ...user }, coins: (cur?.coins ?? 0) + coins, gifts: (cur?.gifts ?? 0) + count, at } }
}

export function topSupporters(map: Record<string, Supporter>, n = 3): Supporter[] {
  return Object.values(map)
    .sort((a, b) => b.coins - a.coins || a.at - b.at)
    .slice(0, n)
}

export const useLive = create<LiveStore>()((set, get) => {
  const pushFeed = (item: Omit<FeedItem, 'id'>) => set((s) => ({ feed: [{ ...item, id: feedId++ }, ...s.feed].slice(0, FEED_MAX) }))

  const close = () => {
    const r = get().round
    if (!r) return
    const done: Round = { ...r, closed: true }
    const outcome = decide(done)
    set({ round: null, result: { round: done, outcome, at: Date.now() } })
    const opt = done.options[outcome.winner]
    pushFeed({ kind: 'result', text: opt ? opt.label : '', option: outcome.winner, at: Date.now() })
    const res = resolver
    resolver = null
    res?.(outcome)
  }

  const tick = () => {
    const now = Date.now()
    const dt = lastTick ? now - lastTick : 0
    lastTick = now
    const r = get().round
    if (!r) return
    if (useLiveSession.getState().paused) {
      // pausa congela o relógio
      set({ round: { ...r, endsAt: r.endsAt + dt } })
      return
    }
    if (now < r.endsAt) return
    if (shouldExtend(r, now, useLiveConfig.getState().config.extendOnTie)) {
      set({ round: extend(r, 10) })
      pushFeed({ kind: 'info', text: 'Empate! Mais 10 segundos de votação', at: now })
      return
    }
    close()
  }

  return {
    source: null,
    status: { state: 'idle' },
    viewers: null,
    likes: 0,
    likesMeter: 0,
    likeBursts: 0,
    catalog: [],
    round: null,
    result: null,
    supporters: {},
    careerSupporters: {},
    feed: [],
    stage: 'idle',
    nextCareerAt: null,
    announce: null,

    setSource: (source) => set({ source }),
    setStatus: (status) => set({ status }),
    setCatalog: (catalog) => set({ catalog }),

    ingest(e) {
      const cfg = useLiveConfig.getState().config
      if (e.type === 'viewers') {
        set({ viewers: e.count })
        return
      }
      if (e.type === 'like') {
        const goal = Math.max(50, cfg.likesGoal)
        const meter = get().likesMeter + e.count
        const bursts = Math.floor(meter / goal)
        set({ likes: get().likes + e.count, likesMeter: meter % goal, likeBursts: get().likeBursts + bursts })
        if (bursts) pushFeed({ kind: 'info', text: 'Termômetro da torcida cheio! 🔥', at: e.at })
        return
      }
      if (e.type === 'follow' || e.type === 'share') {
        pushFeed({ kind: e.type, user: e.user, text: e.type === 'follow' ? 'começou a seguir' : 'compartilhou a live', at: e.at })
        return
      }
      if (e.type === 'join') return
      if (e.type === 'gift') {
        const coins = e.gift.coins * e.count
        // a lista de presentes da configuração aprende com os presentes reais (imagem e preço da sala)
        if (e.gift.image && !get().catalog.some((g) => g.name === e.gift.name)) set((s) => ({ catalog: [...s.catalog, e.gift].sort((a, b) => a.coins - b.coins) }))
        set((s) => ({ supporters: addSupporter(s.supporters, e.user, coins, e.count, e.at), careerSupporters: addSupporter(s.careerSupporters, e.user, coins, e.count, e.at) }))
      }
      const r = get().round
      if (r) {
        const res = applyEvent(r, e, cfg)
        if (res.round !== r) set({ round: res.round })
        if (e.type === 'gift') pushFeed({ kind: 'gift', user: e.user, text: `${e.count > 1 ? `${e.count}× ` : ''}${giftLabel(e.gift.name)}`, gift: e.gift, count: e.count, coins: e.gift.coins * e.count, ...(res.option != null ? { option: res.option } : {}), at: e.at })
        else if (res.option != null) pushFeed({ kind: 'vote', user: e.user, text: `votou ${res.option + 1}`, option: res.option, at: e.at })
        if (res.decided) close()
        return
      }
      if (e.type === 'gift') pushFeed({ kind: 'gift', user: e.user, text: `${e.count > 1 ? `${e.count}× ` : ''}${giftLabel(e.gift.name)}`, gift: e.gift, count: e.count, coins: e.gift.coins * e.count, at: e.at })
    },

    startRound(spec) {
      // uma votação por vez: a anterior é cancelada
      if (get().round) get().cancelRound()
      const cfg = useLiveConfig.getState().config
      const round = createRound({ ...spec, seconds: spec.seconds ?? cfg.voteSeconds }, Date.now())
      set({ round, result: null })
      lastTick = Date.now()
      if (!ticker) ticker = setInterval(tick, 200)
      return new Promise<Outcome | null>((res) => {
        resolver = res
      })
    },

    closeNow() {
      if (get().round) close()
    },

    cancelRound() {
      const res = resolver
      resolver = null
      set({ round: null })
      res?.(null)
    },

    resetCareerSupporters: () => set({ careerSupporters: {} }),

    clearSession() {
      get().cancelRound()
      if (ticker) clearInterval(ticker)
      ticker = null
      set({ result: null, feed: [], supporters: {}, careerSupporters: {}, likes: 0, likesMeter: 0, likeBursts: 0, stage: 'idle', nextCareerAt: null, announce: null })
    },

    pushInfo: (text) => pushFeed({ kind: 'info', text, at: Date.now() }),
  }
})
