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
import { isCaptureWindow } from './channel'
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

/**
 * @ do TikTok como a ponte espera: "@MeuPerfil " ou o link colado ("https://www.tiktok.com/@MeuPerfil/live")
 * → "meuperfil". O @ do TikTok é sempre minúsculo: com maiúscula o TikTok responde que o perfil não existe.
 */
export function cleanTikTokUser(raw: string): string {
  const s = raw.trim()
  const link = s.match(/tiktok\.com\/@([^/?#\s]+)/i)
  return (link ? link[1] : s).replace(/^@+/, '').replace(/\s+/g, '').toLowerCase()
}

/** Pede para a ponte entrar na live do @ configurado. */
export function bridgeJoin(username = useLiveConfig.getState().config.username) {
  const user = cleanTikTokUser(username)
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
  // a janela da live (e a do OBS) não troca a live que a ponte já está seguindo: quem escolhe o @ é o painel
  // (ou o --usuario da ponte). O OBS guarda a configuração da live anterior e, ao abrir, pediria o @ antigo
  // antes de a ponte mandar o novo. Ela só pede o @ dela com a ponte parada (a ponte reiniciou sem o painel).
  let joinIfIdle = false
  sock.onopen = () => {
    if (ws !== sock) return
    retry = 0
    if (cfg.source === 'ponte') {
      send({ type: 'hello' })
      if (isCaptureWindow()) joinIfIdle = true
      else if (cfg.username.trim()) bridgeJoin(cfg.username)
      else useLive.getState().setStatus({ state: 'idle', message: 'Ponte ligada. Digite o @ do perfil e clique em Conectar.' })
    } else {
      useLive.getState().setStatus({ state: 'connected', message: 'Recebendo eventos do TikFinity' })
    }
  }
  sock.onmessage = (e) => {
    if (ws !== sock) return
    const live = useLive.getState()
    for (const p of parseMessage(e.data)) {
      if (p.type === 'gift-raw') {
        const ev = resolveGift(p, tracker)
        if (ev) live.ingest(ev)
      } else if (p.type === 'status') {
        live.setStatus(p.status)
        if (joinIfIdle) {
          // a ponte manda o estado dela assim que a página conecta
          joinIfIdle = false
          const user = useLiveConfig.getState().config.username
          if (p.status.state === 'idle' && !p.status.user && user.trim()) bridgeJoin(user)
        }
      } else if (p.type === 'gifts') live.setCatalog(p.list)
      else if (p.type === 'hello') continue
      else live.ingest(p)
    }
  }
  sock.onclose = () => {
    // só o socket atual pode reconectar: o fechamento de um socket antigo (troca de fonte) chega depois,
    // quando `stopped` já voltou a false — sem esta checagem ele abriria um socket zumbi duplicado
    if (ws !== sock) return
    ws = null
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
  const source = LIVE_SANDBOXED ? 'simulador' : cfg.source
  // trocou a fonte (ex.: do simulador para a live de verdade): o público de teste não passa para a live
  if (store.source && store.source !== source) store.clearSession()
  store.setSource(source)
  if (source === 'simulador') {
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
  const s = ws
  ws = null
  if (s) {
    // solta os handlers antes de fechar: nada deste socket chega mais à live (nem o onclose tardio)
    s.onopen = null
    s.onmessage = null
    s.onclose = null
    s.onerror = null
    try {
      if (leave && s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type: 'disconnect' }))
      s.close()
    } catch {
      /* já fechado */
    }
  }
  useLive.getState().setStatus({ state: 'idle' })
}

export const liveConnected = () => !stopped
