/**
 * Conexão com a fonte de eventos da live.
 *
 *   ponte      ws://localhost:5178/ws  — live/ponte.mjs (npm run live) conecta no TikTok pelo @ do perfil
 *   tikfinity  ws://localhost:21213/   — quem já usa o TikFinity aponta para a API WebSocket dele
 *   simulador  sem rede                — público de mentira (src/live/simulator.ts)
 *
 *   connectLive()      // usa a configuração salva
 *   disconnectLive()
 */
import { LIVE_SANDBOXED, useLiveConfig } from './config'
import { createStreakTracker, parseMessage, resolveGift } from './protocol'
import { startSimulator, stopSimulator } from './simulator'
import { useLive } from './store'

let ws: WebSocket | null = null
let stopped = true
let retry = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
let tracker = createStreakTracker()

function send(msg: unknown) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

/** Pede para a ponte entrar na live do @ configurado. */
export function bridgeJoin(username = useLiveConfig.getState().config.username) {
  const user = username.trim().replace(/^@/, '')
  const { signKey } = useLiveConfig.getState().config
  if (!user) {
    useLive.getState().setStatus({ state: 'idle', message: 'Digite o @ do perfil que está ao vivo.' })
    return
  }
  send({ type: 'connect', user, ...(signKey.trim() ? { signKey: signKey.trim() } : {}) })
}

export function bridgeLeave() {
  send({ type: 'disconnect' })
}

function open() {
  const cfg = useLiveConfig.getState().config
  const url = cfg.source === 'tikfinity' ? cfg.tikfinityUrl : cfg.bridgeUrl
  const store = useLive.getState()
  store.setStatus({ state: 'connecting', message: cfg.source === 'tikfinity' ? 'Conectando ao TikFinity…' : 'Procurando a ponte do LENDA…' })
  let sock: WebSocket
  try {
    sock = new WebSocket(url)
  } catch {
    store.setStatus({ state: 'error', message: `Endereço inválido: ${url}` })
    return
  }
  ws = sock
  sock.onopen = () => {
    retry = 0
    if (cfg.source === 'ponte') {
      send({ type: 'hello' })
      if (cfg.username.trim()) bridgeJoin(cfg.username)
      else useLive.getState().setStatus({ state: 'idle', message: 'Ponte ligada. Digite o @ do perfil e clique em Conectar.' })
    } else {
      useLive.getState().setStatus({ state: 'connected', message: 'Recebendo eventos do TikFinity' })
    }
  }
  sock.onmessage = (e) => {
    const live = useLive.getState()
    for (const p of parseMessage(e.data)) {
      if (p.type === 'gift-raw') {
        const ev = resolveGift(p, tracker)
        if (ev) live.ingest(ev)
      } else if (p.type === 'status') live.setStatus(p.status)
      else if (p.type === 'gifts') live.setCatalog(p.list)
      else if (p.type === 'hello') continue
      else live.ingest(p)
    }
  }
  sock.onclose = () => {
    if (ws === sock) ws = null
    if (stopped) return
    const wait = Math.min(10_000, 1000 * 2 ** retry++)
    useLive.getState().setStatus({
      state: 'error',
      message: cfg.source === 'tikfinity' ? 'Sem resposta do TikFinity (ele está aberto com a API WebSocket ligada?). Tentando de novo…' : 'A ponte não está rodando. Abra o LENDA pelo "npm run live" (ou INICIAR-LIVE.bat). Tentando de novo…',
    })
    retryTimer = setTimeout(() => {
      if (!stopped) open()
    }, wait)
  }
}

export function connectLive() {
  disconnectLive()
  stopped = false
  tracker = createStreakTracker()
  const cfg = useLiveConfig.getState().config
  const store = useLive.getState()
  store.setSource(cfg.source)
  if (cfg.source === 'simulador' || LIVE_SANDBOXED) {
    store.setStatus({ state: 'demo', message: cfg.simAuto ? 'Simulador: público de teste votando' : 'Simulador: use os botões de teste' })
    if (cfg.simAuto) startSimulator()
    return
  }
  open()
}

/** `leave`: também pede para a ponte sair da live do TikTok (senão ela continua ligada para a próxima aba). */
export function disconnectLive({ leave = false }: { leave?: boolean } = {}) {
  stopped = true
  stopSimulator()
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  if (ws) {
    try {
      if (leave) bridgeLeave()
      ws.close()
    } catch {
      /* já fechado */
    }
  }
  ws = null
  useLive.getState().setStatus({ state: 'idle' })
}

export const liveConnected = () => !stopped
