/**
 * Estado da live em tempo real: conexão, votação em andamento, apoiadores, feed e termômetro de curtidas.
 *
 *   const outcome = await useLive.getState().startRound({ id, kind: 'decision', title, options })
 *   useLive.getState().ingest({ type: 'gift', … })                 // conexão
 *   useLive.getState().ingest(evento, { sim: true })              // simulador / botões de teste
 *
 * Eventos simulados numa live de verdade (fonte ponte/TikFinity) valem voto, mas não entram nos apoiadores
 * nem nos lances da disputa — gente de mentira nunca dá nome à lenda nem aparece no pódio.
 *
 * Disputa, criação, anúncio e apoiadores ficam também no sessionStorage da aba: recarregar a janela da live
 * no meio da disputa retoma de onde parou (quem pagou não perde o direito de criar).
 */
import { create } from 'zustand'
import type { PlayerIdentity } from '@/engine/types'
import { getCountry, useData } from '@/store/data'
import { LIVE_SANDBOXED, useLiveConfig, useLiveSession } from './config'
import { giftLabel } from './gifts'
import { creatorFeedback, makeCountryFinder, parseCreatorCommand, type CountryFinder, type CreatorDraft } from './identity'
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
  /** Presente solto guardado: a pessoa ainda não comentou um número (valor = quantas opções há). */
  held?: number
  at: number
}

export interface Supporter {
  user: LiveUser
  coins: number
  gifts: number
  at: number
  /** Veio do simulador / botões de teste. */
  sim?: boolean
}

export interface Announcement {
  kicker: string
  title: string
  lines: string[]
  /** Apoiador homenageado (dá nome ao jogador). */
  honoree?: LiveUser
  until: number
  /** A lenda anunciada (recarregar no meio do anúncio começa direto esta carreira). */
  identity?: PlayerIdentity
}

export interface Bid {
  user: LiveUser
  coins: number
  at: number
  sim?: boolean
}

/** Ficha já decidida pelo criador enquanto o chat vota o que faltou (para retomar depois de recarregar). */
export interface PendingLegend {
  draft: CreatorDraft
  creator: Bid | null
}

/** Ficha completa: espera esse tempo antes de começar (cada correção reinicia; "!ok" começa na hora). */
export const CONFIRM_MS = 6000

/** Disputa (quem doar mais cria a lenda) e a criação pelo vencedor (comandos no chat). */
export interface Creation {
  phase: 'bidding' | 'creating'
  startedAt: number
  endsAt: number
  bids: Record<string, Bid>
  winner?: Bid
  draft: CreatorDraft
  /** Último retorno para o criador ("Nome: GABIGOL ✓", "nome recusado"). */
  feedback?: string
  /** Ficha completa: a carreira começa neste instante (ms epoch). Some se a ficha ficar incompleta. */
  readyAt?: number
}

export function topBids(c: Creation | null, n = 5): Bid[] {
  return c ? Object.values(c.bids).sort((a, b) => b.coins - a.coins || a.at - b.at).slice(0, n) : []
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
  creation: Creation | null
  pendingLegend: PendingLegend | null

  setSource(s: LiveSource | null): void
  setStatus(s: BridgeStatus): void
  setCatalog(list: LiveGiftInfo[]): void
  /** `sim`: evento do simulador ou de um botão de teste. */
  ingest(e: LiveEvent, meta?: { sim?: boolean }): void
  startRound(spec: RoundSpec): Promise<Outcome | null>
  /** Encerra a votação agora (o streamer apertou "encerrar"). */
  closeNow(): void
  cancelRound(): void
  resetCareerSupporters(): void
  /** Zera a sessão (apoiadores, feed, disputa…): começo de uma live ou troca de fonte. */
  clearSession(): void
  pushInfo(text: string): void
  startBidding(seconds: number): void
  startCreating(winner: Bid, seconds: number): void
  /** Religa o relógio de uma disputa/criação retomada depois de recarregar. */
  resumeClock(): void
  endCreation(): void
}

let countryFinder: { src: unknown; find: CountryFinder } | null = null
/** `strict`: mensagem solta (sem "!") — só nome inteiro/apelido de 4+ letras. */
function findCountry(q: string, strict?: boolean): string | null {
  const countries = useData.getState().data?.countries ?? []
  if (!countryFinder || countryFinder.src !== countries) countryFinder = { src: countries, find: makeCountryFinder(countries) }
  return countryFinder.find(q, strict)
}

const FEED_MAX = 14
let feedId = 1
let resolver: ((o: Outcome | null) => void) | null = null
let ticker: ReturnType<typeof setInterval> | null = null
let lastTick = 0

function addSupporter(map: Record<string, Supporter>, user: LiveUser, coins: number, count: number, at: number, sim: boolean): Record<string, Supporter> {
  const cur = map[user.id]
  return { ...map, [user.id]: { user: { ...cur?.user, ...user }, coins: (cur?.coins ?? 0) + coins, gifts: (cur?.gifts ?? 0) + count, at, ...(sim || cur?.sim ? { sim: true } : {}) } }
}

export function topSupporters(map: Record<string, Supporter>, n = 3): Supporter[] {
  return Object.values(map)
    .sort((a, b) => b.coins - a.coins || a.at - b.at)
    .slice(0, n)
}

/** A live está recebendo eventos de verdade (ponte/TikFinity), não do simulador. */
export function realSource(source: LiveSource | null = useLive.getState().source): boolean {
  return !LIVE_SANDBOXED && source != null && source !== 'simulador'
}

const draftComplete = (d: CreatorDraft) => !!(d.surname && d.nationality && d.position)
const CONFIRM_RE = /^\s*[!/]\s*(ok|okay|confirmar|confirma|pronto|bora)\s*[!.]*\s*$/i

// ── retomada depois de recarregar (sessionStorage da aba) ──

const SNAP_KEY = 'lenda:live:estado'
type Snapshot = Pick<LiveStore, 'creation' | 'announce' | 'pendingLegend' | 'supporters' | 'careerSupporters' | 'stage'> & { v: 1; at: number }

function readSnapshot(): Snapshot | null {
  try {
    if (!useLiveSession.getState().on) return null
    const raw = sessionStorage.getItem(SNAP_KEY)
    const s = raw ? (JSON.parse(raw) as Snapshot) : null
    // retomada é para recarregar a página, não para voltar horas depois
    return s && s.v === 1 && Date.now() - s.at < 30 * 60_000 ? s : null
  } catch {
    return null
  }
}

function writeSnapshot(s: LiveStore) {
  try {
    const snap: Snapshot = { v: 1, at: Date.now(), creation: s.creation, announce: s.announce, pendingLegend: s.pendingLegend, supporters: s.supporters, careerSupporters: s.careerSupporters, stage: s.stage }
    sessionStorage.setItem(SNAP_KEY, JSON.stringify(snap))
  } catch {
    /* sem storage: só não retoma */
  }
}

function dropSnapshot() {
  try {
    sessionStorage.removeItem(SNAP_KEY)
  } catch {
    /* ignora */
  }
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

  const stopClock = () => {
    if (ticker) clearInterval(ticker)
    ticker = null
  }

  const tick = () => {
    const now = Date.now()
    const dt = lastTick ? now - lastTick : 0
    lastTick = now
    const c = get().creation
    const r = get().round
    // nada para cronometrar: o relógio para (volta com a próxima votação/disputa)
    if (!c && !r) return stopClock()
    if (c && useLiveSession.getState().paused) set({ creation: { ...c, endsAt: c.endsAt + dt, ...(c.readyAt ? { readyAt: c.readyAt + dt } : {}) } })
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

  const startClock = () => {
    lastTick = Date.now()
    if (!ticker) ticker = setInterval(tick, 200)
  }

  /**
   * Mensagem do criador: aplica a ficha (mensagem sem "!" só preenche o que falta), dá o retorno na tela e
   * cuida da confirmação — ficha completa espera CONFIRM_MS, cada mudança reinicia, "!ok" começa já.
   */
  const creatorChat = (c: Creation, text: string) => {
    const parsed = parseCreatorCommand(text, findCountry, c.draft)
    const confirm = parsed?.confirm === true || (!parsed && CONFIRM_RE.test(text))
    if (!parsed && !confirm) return
    const now = Date.now()
    let draft = c.draft
    let feedback = c.feedback
    if (parsed) {
      const bare = parsed.bare === true || !/^\s*(?:@\S+\s*)*[!/]/.test(text)
      const got: CreatorDraft = {}
      for (const k of ['surname', 'nationality', 'position'] as const) {
        const v = parsed.draft[k]
        if (v && !(bare && c.draft[k])) (got as Record<string, unknown>)[k] = v
      }
      draft = { ...c.draft, ...got }
      const fb = creatorFeedback({ ...parsed, draft: got }, (code) => getCountry(code)?.name)
      if (fb) feedback = fb
    }
    const complete = draftComplete(draft)
    const changed = draft.surname !== c.draft.surname || draft.nationality !== c.draft.nationality || draft.position !== c.draft.position
    let readyAt = c.readyAt
    if (!complete) {
      readyAt = undefined
      if (confirm) {
        const missing = [!draft.surname && '!nome', !draft.nationality && '!pais', !draft.position && '!posicao'].filter(Boolean)
        feedback = `Ainda falta: ${missing.join(', ')}`
      }
    } else if (confirm) {
      readyAt = now
      feedback = 'Confirmado! A lenda vai nascer ✓'
    } else if (changed || !readyAt) {
      readyAt = now + CONFIRM_MS
      feedback = `${feedback && feedback !== c.feedback ? `${feedback} · ` : ''}Ficha completa: começa em ${CONFIRM_MS / 1000} s (corrija ou digite !ok)`
    }
    const { readyAt: _old, feedback: _fb, ...rest } = c
    set({ creation: { ...rest, draft, ...(feedback ? { feedback } : {}), ...(readyAt ? { readyAt } : {}) } })
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
    creation: null,
    pendingLegend: null,

    setSource: (source) => set({ source }),
    setStatus: (status) => set({ status }),
    setCatalog: (catalog) => set({ catalog }),

    ingest(e, meta) {
      const cfg = useLiveConfig.getState().config
      const sim = !!meta?.sim
      // numa live de verdade, teste vale voto mas não vira apoiador nem lance
      const counts = !(sim && realSource(get().source))
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
        if (counts) {
          set((s) => ({ supporters: addSupporter(s.supporters, e.user, coins, e.count, e.at, sim), careerSupporters: addSupporter(s.careerSupporters, e.user, coins, e.count, e.at, sim) }))
          const c = get().creation
          if (c?.phase === 'bidding' && Date.now() < c.endsAt) {
            const cur = c.bids[e.user.id]
            set({ creation: { ...c, bids: { ...c.bids, [e.user.id]: { user: { ...cur?.user, ...e.user }, coins: (cur?.coins ?? 0) + coins, at: cur?.at ?? e.at, ...(sim || cur?.sim ? { sim: true } : {}) } } } })
          }
        }
      }
      if (e.type === 'chat') {
        const c = get().creation
        if (c?.phase === 'creating' && c.winner && c.winner.user.id === e.user.id && Date.now() < c.endsAt) creatorChat(c, e.text)
      }
      const r = get().round
      if (r) {
        const res = applyEvent(r, e, cfg)
        if (res.round !== r) set({ round: res.round })
        if (e.type === 'gift')
          pushFeed({
            kind: 'gift',
            user: e.user,
            text: `${e.count > 1 ? `${e.count}× ` : ''}${giftLabel(e.gift.name)}`,
            gift: e.gift,
            count: e.count,
            coins: e.gift.coins * e.count,
            ...(res.option != null ? { option: res.option } : {}),
            // presente solto de quem ainda não comentou: fica guardado até a pessoa comentar um número
            ...(res.held ? { held: r.options.length } : {}),
            at: e.at,
          })
        else if (res.released && res.option != null)
          pushFeed({ kind: 'info', user: e.user, text: `${e.user.name}: presente guardado`, option: res.option, at: e.at })
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
      startClock()
      return new Promise<Outcome | null>((res) => {
        resolver = res
      })
    },

    closeNow() {
      if (get().round) close()
      const c = get().creation
      if (c) set({ creation: { ...c, endsAt: Date.now() } })
    },

    startBidding(seconds) {
      const now = Date.now()
      set({ creation: { phase: 'bidding', startedAt: now, endsAt: now + seconds * 1000, bids: {}, draft: {} } })
      startClock()
    },

    startCreating(winner, seconds) {
      const now = Date.now()
      set((s) => ({ creation: { phase: 'creating', startedAt: now, endsAt: now + seconds * 1000, bids: s.creation?.bids ?? {}, winner, draft: {} } }))
      startClock()
    },

    resumeClock: () => {
      if (get().creation || get().round) startClock()
    },

    endCreation: () => set({ creation: null }),

    cancelRound() {
      const res = resolver
      resolver = null
      set({ round: null })
      res?.(null)
    },

    resetCareerSupporters: () => set({ careerSupporters: {} }),

    clearSession() {
      get().cancelRound()
      stopClock()
      set({ result: null, feed: [], supporters: {}, careerSupporters: {}, likes: 0, likesMeter: 0, likeBursts: 0, stage: 'idle', nextCareerAt: null, announce: null, creation: null, pendingLegend: null })
      dropSnapshot()
    },

    pushInfo: (text) => pushFeed({ kind: 'info', text, at: Date.now() }),
  }
})

// retomada: a aba recarregou no meio da live → volta a disputa, a ficha, o anúncio e os apoiadores
{
  const snap = readSnapshot()
  if (snap) {
    const { v: _v, at: _at, ...rest } = snap
    useLive.setState(rest)
  }
  let pending: ReturnType<typeof setTimeout> | null = null
  const KEYS = ['creation', 'announce', 'pendingLegend', 'supporters', 'careerSupporters', 'stage'] as const
  useLive.subscribe((s, prev) => {
    if (!KEYS.some((k) => s[k] !== prev[k])) return
    if (pending) return
    pending = setTimeout(() => {
      pending = null
      if (useLiveSession.getState().on) writeSnapshot(useLive.getState())
      else dropSnapshot()
    }, 250)
  })
  if (typeof window !== 'undefined')
    window.addEventListener('pagehide', () => {
      if (useLiveSession.getState().on) writeSnapshot(useLive.getState())
    })
}
