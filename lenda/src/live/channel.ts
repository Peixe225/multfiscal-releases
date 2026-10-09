/**
 * Várias abas/janelas: só UMA roda a live (trava com batimento no localStorage) e as outras viram painel
 * de controle — os comandos vão por BroadcastChannel para a janela que está rodando.
 *
 *   acquireLiveLock()               // true = esta janela roda o autopiloto
 *   sendLiveCommand('pause')        // de qualquer janela
 *   onLiveCommand((cmd) => …)       // na janela que roda
 */
export type LiveCommand = 'pause' | 'resume' | 'close-vote' | 'new-legend' | 'stop'

export interface LiveBeat {
  id: string
  at: number
  /** Resumo para o painel das outras janelas. */
  summary?: { status: string; round?: string; secondsLeft?: number; paused?: boolean; stage?: string }
}

const KEY = 'lenda:live:lock'
const STALE_MS = 6000
export const WINDOW_ID = Math.random().toString(36).slice(2, 10)

function read(): LiveBeat | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as LiveBeat) : null
  } catch {
    return null
  }
}

/** Outra janela está rodando a live agora? */
export function lockHolder(now = Date.now()): LiveBeat | null {
  const b = read()
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
    if (read()?.id === WINDOW_ID) localStorage.removeItem(KEY)
  } catch {
    /* ignora */
  }
}

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

export function sendLiveCommand(cmd: LiveCommand) {
  channel()?.postMessage({ cmd })
}

export function onLiveCommand(fn: (cmd: LiveCommand) => void): () => void {
  const c = channel()
  if (!c) return () => {}
  const h = (e: MessageEvent) => {
    const cmd = (e.data as { cmd?: LiveCommand })?.cmd
    if (cmd) fn(cmd)
  }
  c.addEventListener('message', h)
  return () => c.removeEventListener('message', h)
}
