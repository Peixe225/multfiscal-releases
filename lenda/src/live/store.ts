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
 *
 * Sala vazia (o começo de toda live):
 *   - quem participa (comenta, manda presente, curte, segue, compartilha) entra na conta de "pessoas nos
 *     últimos 5 min" (recentParticipants) — é ela que escolhe o ritmo automático da próxima lenda;
 *   - votação/disputa sem nenhum voto depois de config.quietSeconds fecha antes do fim (quietAt). Sinal de
 *     gente de verdade na sala (entrou, comentou qualquer coisa, curtiu…) empurra esse prazo: quem acabou de
 *     chegar ainda vê a live com atraso (TikTok) e precisa de tempo para ler e comentar;
 *   - quem entra na sala, segue ou compartilha ganha uma chamada na tela (fila em shoutouts.ts → `shout`);
 *   - o streamer pode votar como uma pessoa do chat (streamerVote): vale um comentário e pode mudar.
 * Nada disso inventa gente: numa live de verdade, teste e voto do streamer não contam como participante.
 *
 * Demonstração da ponte (npm run live:demo): o público é de teste, mesmo chegando pela ponte. `bridgeDemo`
 * guarda isso e realLive() fica false — lenda criada na demonstração vai marcada como de teste (ranking) e,
 * quando a ponte volta para a live de verdade com a janela aberta, a sessão zera (apoiadores da demo não
 * passam para a live).
 */
import { create } from 'zustand'
import type { Pace, PlayerIdentity } from '@/engine/types'
import { getCountry, useData } from '@/store/data'
import { AUTO_PACE, LIVE_SANDBOXED, useLiveConfig, useLiveSession } from './config'
import { giftLabel } from './gifts'
import { creatorFeedback, makeCountryFinder, parseCreatorCommand, type CountryFinder, type CreatorDraft } from './identity'
import { JOIN_SHOUT_MAX_VIEWERS, SHOUT, createShoutQueue, shoutGap, type Shout, type ShoutKind } from './shoutouts'
import type { BridgeStatus, LiveEvent, LiveGiftInfo, LiveSource, LiveUser } from './types'
import { applyEvent, createRound, decide, extend, hasVotes, participants as roundVoters, shouldExtend, type Outcome, type Round, type RoundKind, type VoteOption } from './votes'

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
  /** Voto do streamer (painel): aparece como "voto do streamer". */
  streamer?: boolean
  at: number
}

/** Quem vota pelo painel ("votar como streamer"): um @ que o TikTok não aceita, então nunca é de alguém do chat. */
export const STREAMER: LiveUser = { id: '#streamer', name: 'Streamer' }

/** Quem criou a lenda da carreira em jogo (para o ranking da live no fim dela). */
export interface LegendCredit {
  careerId: string
  /** Vencedor da disputa / maior apoiador. Sem = o chat. */
  by?: LiveUser
  /** Criada com o simulador ou com um lance de teste. */
  sim?: boolean
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
  /** Ritmo da carreira que vai começar (o automático já decidido) e o selo da tela ("Ritmo Normal · automático"). */
  pace?: Pace
  badge?: string
  /** Quem criou (para o ranking da live), guardado para a retomada depois de recarregar. */
  credit?: { by?: LiveUser; sim?: boolean }
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
  /** Disputa: sem nenhum lance até este instante, ela acaba antes do fim ("sala vazia"). */
  quietAt?: number
  /** A disputa acabou cedo porque ninguém deu lance. */
  quiet?: boolean
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
  /** Boas-vindas / agradecimento na tela agora (some em `until`). */
  shout: (Shout & { until: number }) | null
  /** Quem criou a lenda da carreira em jogo. É da carreira, não da sessão: clearSession não apaga. */
  credit: LegendCredit | null
  /** A ponte está no modo demonstração (público de teste gerado por ela). Fica até a ponte dizer o contrário. */
  bridgeDemo: boolean

  setSource(s: LiveSource | null): void
  setStatus(s: BridgeStatus): void
  /** "hello" da ponte: `demo` = ela está no modo demonstração. */
  setBridgeDemo(demo: boolean): void
  setCatalog(list: LiveGiftInfo[]): void
  /** `sim`: evento do simulador ou de um botão de teste. `streamer`: voto do streamer pelo painel. */
  ingest(e: LiveEvent, meta?: { sim?: boolean; streamer?: boolean }): void
  /**
   * Voto do streamer na opção `option` (0-based): um comentário do STREAMER — vale o mesmo que o de uma
   * pessoa e pode mudar. `roundId`: só vale se ainda for a mesma votação. false = não havia o que votar.
   */
  streamerVote(option: number, roundId?: string): boolean
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

// ── quem participou (para o ritmo automático) ──

/** @ → última participação (ms epoch). */
const participants = new Map<string, number>()

function noteParticipant(id: string, at: number) {
  participants.set(id, at)
  if (participants.size > 5000) for (const [k, t] of participants) if (at - t > AUTO_PACE.windowMs) participants.delete(k)
}

/**
 * Pessoas diferentes que comentaram, mandaram presente, curtiram, seguiram ou compartilharam nos últimos
 * `windowMs` (entrar na sala não conta). Numa live de verdade, eventos de teste e o voto do streamer ficam
 * de fora; no simulador, o público de teste conta (é para ver o ritmo automático funcionando).
 */
export function recentParticipants(now = Date.now(), windowMs: number = AUTO_PACE.windowMs): number {
  let n = 0
  for (const [k, t] of participants) {
    if (now - t <= windowMs) n++
    else if (now - t > windowMs * 2) participants.delete(k)
  }
  return n
}

// ── boas-vindas e agradecimentos ──

const shouts = createShoutQueue()
let shoutTimer: ReturnType<typeof setTimeout> | null = null

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

/**
 * Live de verdade com gente de verdade: fonte real E a ponte fora do modo demonstração. É o que decide se uma
 * lenda vale para o ranking da live de hoje (a demo da ponte manda eventos "reais" de um público de teste).
 */
export function realLive(s: Pick<LiveStore, 'source' | 'bridgeDemo'> = useLive.getState()): boolean {
  return realSource(s.source) && !s.bridgeDemo
}

const draftComplete = (d: CreatorDraft) => !!(d.surname && d.nationality && d.position)
const CONFIRM_RE = /^\s*[!/]\s*(ok|okay|confirmar|confirma|pronto|bora)\s*[!.]*\s*$/i

// ── retomada depois de recarregar (sessionStorage da aba) ──

const SNAP_KEY = 'lenda:live:estado'
// bridgeDemo vai junto: recarregar a janela bem quando a ponte sai da demonstração ainda zera a sessão
type Snapshot = Pick<LiveStore, 'creation' | 'announce' | 'pendingLegend' | 'supporters' | 'careerSupporters' | 'stage' | 'credit' | 'bridgeDemo'> & { v: 1; at: number }

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
    const snap: Snapshot = { v: 1, at: Date.now(), creation: s.creation, announce: s.announce, pendingLegend: s.pendingLegend, supporters: s.supporters, careerSupporters: s.careerSupporters, stage: s.stage, credit: s.credit, bridgeDemo: s.bridgeDemo }
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

  /** Fecha a votação aberta. `quiet`: ninguém votou até quietAt ("sala vazia") — mesmo sorteio, outra frase. */
  const close = (quiet = false) => {
    const r = get().round
    if (!r) return
    const done: Round = { ...r, closed: true }
    const base = decide(done)
    // só o streamer votou: a tela diz que foi ele (não "o chat decidiu · 100% dos votos")
    const voters = roundVoters(done)
    const solo = base.reason !== 'no-votes' && voters.size === 1 && voters.has(STREAMER.id)
    const outcome: Outcome = { ...base, ...(quiet ? { quiet: true } : {}), ...(solo ? { streamer: true } : {}) }
    set({ round: null, result: { round: done, outcome, at: Date.now() } })
    const opt = done.options[outcome.winner]
    if (quiet) pushFeed({ kind: 'info', text: 'Ninguém votou: o destino escolheu', at: Date.now() })
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
    const paused = useLiveSession.getState().paused
    // nada para cronometrar: o relógio para (volta com a próxima votação/disputa)
    if (!c && !r) return stopClock()
    if (c && paused) set({ creation: { ...c, endsAt: c.endsAt + dt, ...(c.readyAt ? { readyAt: c.readyAt + dt } : {}), ...(c.quietAt ? { quietAt: c.quietAt + dt } : {}) } })
    else if (c?.phase === 'bidding' && c.quietAt != null && now >= c.quietAt && now < c.endsAt && !Object.keys(c.bids).length) {
      // sala vazia: ninguém deu lance até quietAt → a disputa acaba já (o autopiloto segue o "ninguém doou")
      set({ creation: { ...c, endsAt: now, quiet: true } })
    }
    if (!r) return
    if (paused) {
      // pausa congela o relógio (e o prazo da sala vazia junto)
      set({ round: { ...r, endsAt: r.endsAt + dt, ...(r.quietAt != null ? { quietAt: r.quietAt + dt } : {}) } })
      return
    }
    // sala vazia: ninguém votou até quietAt → fecha já, com o sorteio de sempre. Chegou um voto, vai até o fim.
    if (r.quietAt != null && now >= r.quietAt && now < r.endsAt && !hasVotes(r)) {
      close(true)
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
   * Sinal de gente de verdade na sala (entrou, comentou qualquer coisa, curtiu, seguiu…) com a votação/disputa
   * ainda sem voto: o prazo da sala vazia passa a ser pelo menos `agora + quietSeconds`. Quem acabou de
   * entrar vê a live alguns segundos atrasada e ainda precisa ler as opções — cortar a rodada na cara dele é
   * perder o primeiro voto. Se o prazo novo passar do fim normal, a rodada vai até o fim.
   */
  const extendQuiet = (now: number) => {
    const quiet = Math.max(0, useLiveConfig.getState().config.quietSeconds || 0) * 1000
    if (!quiet) return
    const r = get().round
    if (r?.quietAt != null && !hasVotes(r) && now + quiet > r.quietAt) {
      const { quietAt: _q, ...rest } = r
      set({ round: now + quiet < r.endsAt ? { ...r, quietAt: now + quiet } : rest })
    }
    const c = get().creation
    if (c?.phase === 'bidding' && c.quietAt != null && !Object.keys(c.bids).length && now + quiet > c.quietAt) {
      const { quietAt: _q, ...rest } = c
      set({ creation: now + quiet < c.endsAt ? { ...c, quietAt: now + quiet } : rest })
    }
  }

  /** Mostra a próxima chamada da fila quando der (1 a cada shoutGap(espectadores), cada uma por SHOUT.showMs). */
  const pumpShouts = () => {
    if (shoutTimer) clearTimeout(shoutTimer)
    shoutTimer = null
    const now = Date.now()
    const cur = get().shout
    const later = (ms: number) => {
      shoutTimer = setTimeout(pumpShouts, Math.max(50, ms))
    }
    if (cur && now < cur.until) return later(cur.until - now)
    const gap = shoutGap(get().viewers)
    const next = shouts.take(now, gap)
    if (next) {
      set({ shout: { ...next, until: now + SHOUT.showMs } })
      return later(SHOUT.showMs)
    }
    if (cur) set({ shout: null })
    const wait = shouts.wait(now, gap)
    if (wait != null) later(wait)
  }

  const shoutOut = (kind: ShoutKind, user: LiveUser) => {
    // sala cheia: a linha é das chamadas de como jogar — entrar não ganha boas-vindas (seguir/compartilhar ganha)
    if (kind === 'join' && (get().viewers ?? 0) >= JOIN_SHOUT_MAX_VIEWERS) return
    if (shouts.push(kind, user, Date.now())) pumpShouts()
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
    shout: null,
    credit: null,
    bridgeDemo: false,

    setSource: (source) => set((s) => (s.source === source ? { source } : { source, bridgeDemo: false })),
    setStatus(status) {
      // "demo" só é a demonstração da PONTE com a fonte ponte (o simulador também usa o estado 'demo')
      const demo = status.state === 'demo' && get().source === 'ponte' ? true : status.state === 'connected' ? false : get().bridgeDemo
      set({ status })
      get().setBridgeDemo(demo)
    },
    setBridgeDemo(demo) {
      const was = get().bridgeDemo
      if (was === demo) return
      set({ bridgeDemo: demo })
      // a ponte saiu da demonstração e entrou na live de verdade com esta janela aberta: o público de teste
      // (apoiadores, lances, quem já foi saudado) não passa para a live — mesma regra da troca de fonte
      // (sem aviso no feed: ele vai ao ar, e o público da live não precisa saber da demonstração)
      if (was && !demo) get().clearSession()
    },
    setCatalog: (catalog) => set({ catalog }),

    ingest(e, meta) {
      const cfg = useLiveConfig.getState().config
      const sim = !!meta?.sim
      const streamer = !!meta?.streamer
      // numa live de verdade, teste vale voto mas não vira apoiador nem lance
      const counts = !(sim && realSource(get().source))
      if (e.type === 'viewers') {
        set({ viewers: e.count })
        return
      }
      const person = counts && !streamer && e.user.id !== STREAMER.id
      // participou (ritmo automático): gente de verdade — ou o público do simulador, no simulador
      if (person && e.type !== 'join') noteParticipant(e.user.id, Date.now())
      // tem gente na sala: a votação/disputa sem voto ainda não fecha pela sala vazia (ver extendQuiet)
      if (person) extendQuiet(Date.now())
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
        if (counts) shoutOut(e.type, e.user)
        return
      }
      if (e.type === 'join') {
        // boas-vindas na tela (com limite: ver shoutouts.ts). Entrada de teste numa live de verdade não aparece.
        if (counts) shoutOut('join', e.user)
        return
      }
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
        else if (streamer && res.option != null) pushFeed({ kind: 'info', user: e.user, text: 'Voto do streamer', option: res.option, streamer: true, at: e.at })
        else if (res.option != null) pushFeed({ kind: 'vote', user: e.user, text: `votou ${res.option + 1}`, option: res.option, at: e.at })
        if (res.decided) close()
        return
      }
      if (e.type === 'gift') pushFeed({ kind: 'gift', user: e.user, text: `${e.count > 1 ? `${e.count}× ` : ''}${giftLabel(e.gift.name)}`, gift: e.gift, count: e.count, coins: e.gift.coins * e.count, at: e.at })
    },

    streamerVote(option, roundId) {
      const r = get().round
      if (!r || (roundId && r.id !== roundId) || !Number.isInteger(option) || option < 0 || option >= r.options.length) return false
      // com "comentário vale voto" desligado o comentário do streamer não pontua: nem finge votar, nem
      // segura a rodada contra a sala vazia (o painel esconde os botões)
      if (!useLiveConfig.getState().config.commentVotes) return false
      get().ingest({ type: 'chat', user: STREAMER, text: String(option + 1), at: Date.now() }, { streamer: true })
      return true
    },

    startRound(spec) {
      // uma votação por vez: a anterior é cancelada
      if (get().round) get().cancelRound()
      const cfg = useLiveConfig.getState().config
      const now = Date.now()
      const round0 = createRound({ ...spec, seconds: spec.seconds ?? cfg.voteSeconds }, now)
      // sala vazia: sem voto nenhum em quietSeconds, a rodada fecha antes (só se isso for antes do fim normal)
      const quiet = Math.max(0, cfg.quietSeconds || 0) * 1000
      const round: Round = quiet > 0 && now + quiet < round0.endsAt ? { ...round0, quietAt: now + quiet } : round0
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
      const endsAt = now + seconds * 1000
      const quiet = Math.max(0, useLiveConfig.getState().config.quietSeconds || 0) * 1000
      set({ creation: { phase: 'bidding', startedAt: now, endsAt, bids: {}, draft: {}, ...(quiet > 0 && now + quiet < endsAt ? { quietAt: now + quiet } : {}) } })
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
      participants.clear()
      shouts.clear()
      if (shoutTimer) clearTimeout(shoutTimer)
      shoutTimer = null
      // `credit` fica: ele é da carreira (careerId), e o `sim` dele precisa sobreviver a "parar o simulador e
      // continuar a mesma carreira na live de verdade" — senão a lenda de teste entraria no ranking como real
      set({ result: null, feed: [], supporters: {}, careerSupporters: {}, likes: 0, likesMeter: 0, likeBursts: 0, stage: 'idle', nextCareerAt: null, announce: null, creation: null, pendingLegend: null, shout: null })
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
  const KEYS = ['creation', 'announce', 'pendingLegend', 'supporters', 'careerSupporters', 'stage', 'credit', 'bridgeDemo'] as const
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
