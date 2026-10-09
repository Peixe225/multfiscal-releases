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
 */
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

export interface LiveBeat {
  id: string
  at: number
  summary?: LiveSummary
}

const KEY = 'lenda:live:lock'
const READY_KEY = 'lenda:live:janela'
const STALE_MS = 6000
/** Nome da janela de captura (window.open(url, CAPTURE_WINDOW_NAME)): sobrevive a recarregar a página. */
export const CAPTURE_WINDOW_NAME = 'lenda-live'
export const WINDOW_ID = Math.random().toString(36).slice(2, 10)

function readBeat(key: string): LiveBeat | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as LiveBeat) : null
  } catch {
    return null
  }
}

/** Outra janela está rodando a live agora? */
export function lockHolder(now = Date.now()): LiveBeat | null {
  const b = readBeat(KEY)
  return b && b.id !== WINDOW_ID && now - b.at < STALE_MS ? b : null
}

export function acquireLiveLock(summary?: LiveBeat['summary']): boolean {
  if (lockHolder()) return false
  try {
    localStorage.setItem(KEY, JSON.stringify({ id: WINDOW_ID, at: Date.now(), ...(summary ? { summary } : {}) } satisfies LiveBeat))
  } catch {
    /* sem storage: roda mesmo assim */
  }
  return true
}

export function releaseLiveLock() {
  try {
    if (readBeat(KEY)?.id === WINDOW_ID) localStorage.removeItem(KEY)
  } catch {
    /* ignora */
  }
}

// ── janela da live (captura) ──

const CAPTURE_FLAG = 'lenda:live:captura'

/** Marca esta janela como a de captura (a marca fica no sessionStorage: recarregar mantém). */
export function markCaptureWindow() {
  try {
    sessionStorage.setItem(CAPTURE_FLAG, '1')
  } catch {
    /* ignora */
  }
}

/** Esta é a janela da live (aberta por "Abrir janela da live" ou pelo endereço com ?janela=1)? */
export function isCaptureWindow(): boolean {
  if (typeof window === 'undefined') return false
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

/** A janela da live publica que está pronta (aberta, esperando o começo). */
export function beatCaptureReady() {
  try {
    localStorage.setItem(READY_KEY, JSON.stringify({ id: WINDOW_ID, at: Date.now() } satisfies LiveBeat))
  } catch {
    /* ignora */
  }
}

export function clearCaptureReady() {
  try {
    if (readBeat(READY_KEY)?.id === WINDOW_ID) localStorage.removeItem(READY_KEY)
  } catch {
    /* ignora */
  }
}

/** Há uma janela da live aberta e esperando o começo (em outra janela)? */
export function captureReady(now = Date.now()): LiveBeat | null {
  const b = readBeat(READY_KEY)
  return b && b.id !== WINDOW_ID && now - b.at < STALE_MS ? b : null
}

// ── mensagens entre janelas ──

type Message = { cmd: LiveCommand } | { cmd: 'start'; mode: StartMode; to?: string } | { sim: LiveEvent }

let bc: BroadcastChannel | null = null
const channel = () => {
  if (bc || typeof BroadcastChannel === 'undefined') return bc
  try {
    bc = new BroadcastChannel('lenda-live')
  } catch {
    bc = null
  }
  return bc
}

const post = (m: Message) => {
  try {
    channel()?.postMessage(m)
  } catch {
    /* canal fechado */
  }
}

function listen(fn: (m: Message) => void): () => void {
  const c = channel()
  if (!c) return () => {}
  const h = (e: MessageEvent) => {
    const m = e.data as Message | null
    if (m && typeof m === 'object') fn(m)
  }
  c.addEventListener('message', h)
  return () => c.removeEventListener('message', h)
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
