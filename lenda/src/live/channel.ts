/**
 * Várias abas/janelas: só UMA roda a live (trava com batimento no localStorage) e as outras viram painel
 * de controle — os comandos vão por BroadcastChannel para a janela que está rodando.
 *
 *   acquireLiveLock()               // true = esta janela roda o autopiloto
 *   sendLiveCommand('pause')        // de qualquer janela
 *   onLiveCommand((cmd) => …)       // na janela que roda
 *
 * Janela da live (a de captura, aberta por "Abrir janela da live"): abre PRONTA, sem começar. Enquanto
 * espera, publica um batimento próprio (captureReady()) e o painel manda o começo por aqui:
 *
 *   sendLiveStart('new' | 'continue')   // painel → janela da live
 *   onLiveStart((mode) => …)            // na janela da live
 *
 * Botões de teste num painel: os eventos simulados vão para a janela que roda a live.
 *
 *   sendLiveSim(evento) · onLiveSim((evento) => store.ingest(evento))
 *
 * Live dentro do OBS (fonte de navegador → http://localhost:5178/obs): é outro navegador, sem o
 * localStorage nem o BroadcastChannel do painel. Com a ponte ligada (startRelay(), no LiveRoot), tudo isto
 * também passa por ela (relay.ts): comandos, começo, testes, os batimentos (guardados na memória, com a
 * mesma validade) e a configuração da live. Cada mensagem tem id: a que chega pelos dois caminhos vale uma
 * vez só. Duas janelas que começaram juntas (antes de se verem) se acertam: fica a que começou antes.
 */
import { LIVE_SANDBOXED, mergeSyncedConfig, onConfigEdited, sameSyncedConfig, syncedConfig, useLiveConfig } from './config'
import { closeRelay, configArrived, createSeen, firstConfigAction, freshBeats, holderWins, isBeat, onRelay, onRelayOpen, openRelay, relaySend, type SyncState } from './relay'
import type { LiveEvent, LiveUser } from './types'

export type LiveCommand = 'pause' | 'resume' | 'close-vote' | 'new-legend' | 'stop'
/** Como a live começa: continuar a carreira salva ou abrir uma nova lenda (disputa / apoiador / votação). */
export type StartMode = 'continue' | 'new'

/** Resumo que a janela da live publica para os painéis das outras janelas. */
export interface LiveSummary {
  status: string
  /** Título da votação aberta. */
  round?: string
  secondsLeft?: number
  paused?: boolean
  stage?: string
  /** Disputa (bidding) ou criação (creating) em andamento. */
  creation?: { phase: 'bidding' | 'creating'; secondsLeft: number; winner?: LiveUser }
  /** Sobrenome da lenda da carreira em jogo (se houver). */
  career?: string
}

/** Onde a janela está: no OBS (fonte de navegador), na janela da live do Chrome/Edge ou numa aba comum. */
export type BeatWhere = 'obs' | 'janela' | 'aba'

export interface LiveBeat {
  id: string
  at: number
  /** Desde quando esta janela roda a live (trava): duas rodando juntas → fica a que começou antes. */
  since?: number
  where?: BeatWhere
  /**
   * Janela pronta: a carreira em andamento salva NELA (o OBS guarda as carreiras dele, separadas das do
   * painel) — o painel oferece "Continuar" e confirma a nova lenda com este nome.
   */
  career?: string
  summary?: LiveSummary
}

const KEY = 'lenda:live:lock'
const READY_KEY = 'lenda:live:janela'
type BeatKey = 'lock' | 'janela'
const STORAGE_KEY: Record<BeatKey, string> = { lock: KEY, janela: READY_KEY }
const STALE_MS = 6000
/** Nome da janela de captura (window.open(url, CAPTURE_WINDOW_NAME)): sobrevive a recarregar a página. */
export const CAPTURE_WINDOW_NAME = 'lenda-live'
/** Nome do quadro do jogo dentro da página /obs da ponte (live/revezamento.mjs). */
export const OBS_FRAME_NAME = 'lenda-obs'
export const WINDOW_ID = Math.random().toString(36).slice(2, 10)

function readBeat(key: string): LiveBeat | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as LiveBeat) : null
  } catch {
    return null
  }
}

/** Batimentos que chegaram pela ponte (de outro navegador, ou repetidos do mesmo): `${key}|${id}`. */
const remote = new Map<string, LiveBeat>()

/** Batimentos válidos das OUTRAS janelas (deste navegador e, pela ponte, do OBS). */
function othersBeats(key: BeatKey, now: number): LiveBeat[] {
  const list: LiveBeat[] = []
  const local = readBeat(STORAGE_KEY[key])
  if (local) list.push(local)
  for (const [k, b] of remote) {
    if (now - b.at > STALE_MS * 10) remote.delete(k)
    else if (k.startsWith(`${key}|`)) list.push(b)
  }
  return freshBeats(list, WINDOW_ID, now, STALE_MS)
}

// ── trava ──

/** Desde quando ESTA janela roda a live (0 = não roda) e o último batimento dela. */
let heldSince = 0
let lastLockBeat: LiveBeat | null = null
const holding = (now: number) => heldSince > 0 && !!lastLockBeat && now - lastLockBeat.at < STALE_MS

/** Outra janela está rodando a live agora? (Se as duas rodam e esta começou antes, quem sai é a outra.) */
export function lockHolder(now = Date.now()): LiveBeat | null {
  const list = othersBeats('lock', now)
  if (!list.length) return null
  const best = list.reduce((a, b) => (holderWins(b, a) ? b : a))
  if (holding(now) && holderWins({ id: WINDOW_ID, at: now, since: heldSince }, best)) return null
  return best
}

function whereAmI(): BeatWhere {
  return isObsView() ? 'obs' : isCaptureWindow() ? 'janela' : 'aba'
}

export function acquireLiveLock(summary?: LiveBeat['summary']): boolean {
  const now = Date.now()
  // esta janela ficou parada (aba congelada) além da validade: perdeu a vez
  if (heldSince && !holding(now)) heldSince = 0
  if (lockHolder(now)) {
    // outra janela ficou com a live (as duas começaram juntas): solta o que ainda estiver no ar desta
    if (heldSince) releaseLiveLock()
    return false
  }
  if (!heldSince) heldSince = now
  const beat: LiveBeat = { id: WINDOW_ID, at: now, since: heldSince, where: whereAmI(), ...(summary ? { summary } : {}) }
  lastLockBeat = beat
  try {
    localStorage.setItem(KEY, JSON.stringify(beat))
  } catch {
    /* sem storage: roda mesmo assim */
  }
  relaySend({ type: 'beat', key: 'lock', beat })
  return true
}

export function releaseLiveLock() {
  const had = heldSince > 0 || !!lastLockBeat
  heldSince = 0
  lastLockBeat = null
  try {
    if (readBeat(KEY)?.id === WINDOW_ID) localStorage.removeItem(KEY)
  } catch {
    /* ignora */
  }
  if (had) relaySend({ type: 'beat-clear', key: 'lock', id: WINDOW_ID })
}

// ── janela da live (captura) ──

const CAPTURE_FLAG = 'lenda:live:captura'
const OBS_FLAG = 'lenda:live:obs'

/** Marca esta janela como a de captura (a marca fica no sessionStorage: recarregar mantém). */
export function markCaptureWindow() {
  try {
    sessionStorage.setItem(CAPTURE_FLAG, '1')
  } catch {
    /* ignora */
  }
}

/** Esta é a janela da live (aberta por "Abrir janela da live", pelo endereço com ?janela=1 ou a do OBS)? */
export function isCaptureWindow(): boolean {
  if (typeof window === 'undefined') return false
  return obsMarked() || captureMarked()
}

/**
 * A live está dentro do OBS? A página /obs da ponte (live/revezamento.mjs) marca o quadro do jogo (nome e
 * ?obs=1); uma fonte de navegador apontando direto para a janela da live (?janela=1) também conta — o OBS
 * põe window.obsstudio nas páginas dele (só isso não basta: um painel aberto como doca do OBS também tem).
 */
export function isObsView(): boolean {
  if (typeof window === 'undefined') return false
  return obsMarked() || ('obsstudio' in window && captureMarked())
}

function captureMarked(): boolean {
  if (window.name === CAPTURE_WINDOW_NAME) return true
  if (/[?&](?:janela|iniciar)=1\b/.test(location.hash)) {
    markCaptureWindow()
    return true
  }
  try {
    return sessionStorage.getItem(CAPTURE_FLAG) === '1'
  } catch {
    return false
  }
}

function obsMarked(): boolean {
  if (window.name === OBS_FRAME_NAME) return true
  if (/[?&]obs=1\b/.test(location.hash)) {
    try {
      sessionStorage.setItem(OBS_FLAG, '1')
    } catch {
      /* ignora */
    }
    return true
  }
  try {
    return sessionStorage.getItem(OBS_FLAG) === '1'
  } catch {
    return false
  }
}

let readyBeat: LiveBeat | null = null

/** A janela da live publica que está pronta (aberta, esperando o começo), com a carreira salva nela. */
export function beatCaptureReady(career?: string) {
  const beat: LiveBeat = { id: WINDOW_ID, at: Date.now(), where: whereAmI(), ...(career ? { career } : {}) }
  readyBeat = beat
  try {
    localStorage.setItem(READY_KEY, JSON.stringify(beat))
  } catch {
    /* ignora */
  }
  relaySend({ type: 'beat', key: 'janela', beat })
}

export function clearCaptureReady() {
  try {
    if (readBeat(READY_KEY)?.id === WINDOW_ID) localStorage.removeItem(READY_KEY)
  } catch {
    /* ignora */
  }
  if (readyBeat) relaySend({ type: 'beat-clear', key: 'janela', id: WINDOW_ID })
  readyBeat = null
}

/** Há uma janela da live aberta e esperando o começo (em outra janela)? Com duas, vale a do OBS. */
export function captureReady(now = Date.now()): LiveBeat | null {
  const list = othersBeats('janela', now)
  if (!list.length) return null
  return list.reduce((a, b) => {
    const oa = a.where === 'obs'
    const ob = b.where === 'obs'
    return oa !== ob ? (ob ? b : a) : b.at > a.at ? b : a
  })
}

// ── mensagens entre janelas ──

type Message = { cmd: LiveCommand } | { cmd: 'start'; mode: StartMode; to?: string } | { sim: LiveEvent }
/** No fio: id da mensagem (para não valer duas vezes) e quem mandou. */
type Wire = Message & { mid?: string; from?: string }

let seq = 0
const firstTime = createSeen()
const handlers = new Set<(m: Message) => void>()

function deliver(raw: unknown) {
  if (!raw || typeof raw !== 'object') return
  const w = raw as Wire
  if (w.from === WINDOW_ID) return
  if (typeof w.mid === 'string' && !firstTime(w.mid)) return
  for (const h of [...handlers]) h(w)
}

let bc: BroadcastChannel | null = null
const channel = () => {
  if (bc || typeof BroadcastChannel === 'undefined') return bc
  try {
    bc = new BroadcastChannel('lenda-live')
    bc.addEventListener('message', (e: MessageEvent) => deliver(e.data))
  } catch {
    bc = null
  }
  return bc
}

const post = (m: Message) => {
  const w: Wire = { ...m, mid: `${WINDOW_ID}.${++seq}`, from: WINDOW_ID }
  try {
    channel()?.postMessage(w)
  } catch {
    /* canal fechado */
  }
  relaySend({ type: 'relay', msg: w })
}

function listen(fn: (m: Message) => void): () => void {
  channel()
  handlers.add(fn)
  return () => {
    handlers.delete(fn)
  }
}

const COMMANDS: readonly string[] = ['pause', 'resume', 'close-vote', 'new-legend', 'stop'] satisfies LiveCommand[]

export function sendLiveCommand(cmd: LiveCommand) {
  post({ cmd })
}

export function onLiveCommand(fn: (cmd: LiveCommand) => void): () => void {
  return listen((m) => {
    if ('cmd' in m && COMMANDS.includes(m.cmd)) fn(m.cmd as LiveCommand)
  })
}

/** Painel → janela da live: comece (continuar a carreira ou nova lenda). `to` = id da janela pronta. */
export function sendLiveStart(mode: StartMode, to = captureReady()?.id) {
  post({ cmd: 'start', mode, ...(to ? { to } : {}) })
}

export function onLiveStart(fn: (mode: StartMode) => void): () => void {
  return listen((m) => {
    if ('cmd' in m && m.cmd === 'start' && (!m.to || m.to === WINDOW_ID)) fn(m.mode === 'new' ? 'new' : 'continue')
  })
}

/** Botão de teste num painel: o evento simulado vai para a janela que roda a live. */
export function sendLiveSim(e: LiveEvent) {
  post({ sim: e })
}

export function onLiveSim(fn: (e: LiveEvent) => void): () => void {
  return listen((m) => {
    if ('sim' in m && m.sim && typeof m.sim === 'object' && typeof (m.sim as { type?: unknown }).type === 'string') fn(m.sim)
  })
}

// ── pela ponte ──

const beatKey = (k: unknown): BeatKey | null => (k === 'lock' || k === 'janela' ? k : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

let sync: SyncState = { rev: -1, pending: 0 }

/** Esta janela mudou a configuração: vai para a ponte (que repassa às outras e guarda no disco). */
function pushConfig() {
  const { config, editedAt } = useLiveConfig.getState()
  if (relaySend({ type: 'config', from: WINDOW_ID, at: editedAt, config: syncedConfig(config) })) sync = { ...sync, pending: sync.pending + 1 }
}

function applyConfig(incoming: unknown, at: number) {
  const s = useLiveConfig.getState()
  const config = mergeSyncedConfig(s.config, incoming)
  // setState direto (não as ações): o que chegou de fora não volta para a ponte
  if (!sameSyncedConfig(config, s.config)) useLiveConfig.setState({ config, editedAt: at })
  else if (at > s.editedAt) useLiveConfig.setState({ editedAt: at })
}

function onConfigMessage(m: Record<string, unknown>) {
  const at = num(m.at) ?? 0
  const snap = m.config && typeof m.config === 'object' && !Array.isArray(m.config) ? m.config : null
  if (m.first === true) {
    // acabou de conectar: a ponte manda a que guarda (ou nada, na primeira vez)
    sync = { rev: num(m.rev) ?? 0, pending: 0 }
    const s = useLiveConfig.getState()
    const action = firstConfigAction({
      hasSnapshot: !!snap,
      snapshotAt: at,
      localAt: s.editedAt,
      capture: isCaptureWindow(),
      same: !!snap && sameSyncedConfig(mergeSyncedConfig(s.config, snap), s.config),
    })
    if (action === 'push') pushConfig()
    else if (action === 'apply') applyConfig(snap, at)
    return
  }
  const r = configArrived(sync, { rev: num(m.rev) ?? -1, from: typeof m.from === 'string' ? m.from : null }, WINDOW_ID)
  sync = r.state
  if (r.apply && snap) applyConfig(snap, at)
}

onRelay((m) => {
  if (m.type === 'relay') deliver(m.msg)
  else if (m.type === 'beat') {
    const key = beatKey(m.key)
    if (key && isBeat(m.beat) && m.beat.id !== WINDOW_ID) remote.set(`${key}|${m.beat.id}`, m.beat as LiveBeat)
  } else if (m.type === 'beat-clear') {
    const key = beatKey(m.key)
    if (key && typeof m.id === 'string') remote.delete(`${key}|${m.id}`)
  } else if (m.type === 'config') onConfigMessage(m)
})

/**
 * Liga o revezamento pela ponte (no endereço da ponte da configuração, mesmo com a fonte em Simulador ou
 * TikFinity) enquanto a live está montada. Sem ponte, tenta de novo devagar; no claude.ai não liga.
 */
export function startRelay(): () => void {
  if (LIVE_SANDBOXED || typeof window === 'undefined') return () => {}
  let url = useLiveConfig.getState().config.bridgeUrl
  openRelay(url)
  const offUrl = useLiveConfig.subscribe((s) => {
    if (s.config.bridgeUrl === url) return
    url = s.config.bridgeUrl
    openRelay(url)
  })
  const offEdit = onConfigEdited(pushConfig)
  // (re)conectou: a ponte manda a configuração dela; os batimentos desta janela vão na hora
  const offOpen = onRelayOpen(() => {
    sync = { rev: -1, pending: 0 }
    const now = Date.now()
    if (lastLockBeat && holding(now)) relaySend({ type: 'beat', key: 'lock', beat: lastLockBeat })
    if (readyBeat && now - readyBeat.at < STALE_MS) relaySend({ type: 'beat', key: 'janela', beat: readyBeat })
  })
  return () => {
    offUrl()
    offEdit()
    offOpen()
    closeRelay()
  }
}
