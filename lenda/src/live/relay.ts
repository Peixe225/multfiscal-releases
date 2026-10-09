/**
 * Revezamento pela ponte: o painel (janela do Chrome/Edge) e a live dentro do OBS (a fonte de navegador do
 * OBS é OUTRO navegador, com outro armazenamento) não se enxergam pelo localStorage nem pelo
 * BroadcastChannel. Com a ponte ligada, o que passa por esses caminhos também passa por ela, num socket só
 * de revezamento (ws://localhost:5178/ws?papel=revezamento) — ele não recebe os eventos do TikTok, então
 * nada entra dobrado na live:
 *
 *   comandos, começo e testes   { type: 'relay', msg }            → as outras janelas
 *   batimentos (trava e janela) { type: 'beat', key, beat }       → cada janela guarda na memória
 *                               { type: 'beat-clear', key, id }
 *   configuração da live        { type: 'config', from, at, config } → a ponte guarda a última (também em
 *                                                                     lenda/.cache/live-config.json) e manda
 *                                                                     para quem conecta
 *
 *   openRelay('ws://localhost:5178/ws')   // reconecta sozinho, devagar (ponte fechada não é erro)
 *   relaySend({ type: 'beat', … })        // false = sem ponte agora
 *   onRelay((m) => …) · onRelayOpen(() => …)
 *   closeRelay()
 *
 * Aqui ficam o socket e as regras puras (relay.test.ts); quem usa é o channel.ts.
 */

type Msg = Record<string, unknown>

/** O mínimo de um batimento para as regras de trava (o LiveBeat do channel.ts). */
export interface BeatLike {
  id: string
  at: number
  /** Desde quando esta janela roda a live (só no batimento da trava). */
  since?: number
}

/** Ids de mensagens já vistas: a mesma mensagem chega pelo BroadcastChannel e pela ponte e vale uma vez. */
export function createSeen(max = 400): (id: string) => boolean {
  const seen = new Set<string>()
  return (id) => {
    if (seen.has(id)) return false
    seen.add(id)
    if (seen.size > max) seen.delete(seen.values().next().value as string)
    return true
  }
}

/**
 * Duas janelas rodando a live ao mesmo tempo (as duas começaram antes de se verem — painel e OBS, ou a
 * ponte voltou depois de cair): fica a que começou antes; empate, o menor id. `a` ganha de `b`?
 */
export function holderWins(a: BeatLike, b: BeatLike): boolean {
  const sa = a.since ?? a.at
  const sb = b.since ?? b.at
  return sa !== sb ? sa < sb : a.id < b.id
}

/** Batimentos válidos de OUTRAS janelas: mais novos que `staleMs`. */
export function freshBeats<B extends BeatLike>(list: readonly (B | null | undefined)[], self: string, now: number, staleMs: number): B[] {
  return list.filter((b): b is B => !!b && typeof b.id === 'string' && typeof b.at === 'number' && b.id !== self && now - b.at < staleMs)
}

export function isBeat(v: unknown): v is BeatLike {
  if (!v || typeof v !== 'object') return false
  const b = v as BeatLike
  return typeof b.id === 'string' && !!b.id && b.id.length <= 64 && typeof b.at === 'number' && Number.isFinite(b.at)
}

/** Onde a configuração está: a última que chegou da ponte e quantos envios desta janela ainda não voltaram. */
export interface SyncState {
  rev: number
  pending: number
}

/**
 * Chegou uma configuração da ponte (a ponte devolve a todos, na ordem em que recebeu, com `rev` crescente).
 * Enquanto um envio desta janela não voltou, as anteriores não valem (senão o campo "voltaria" no meio da
 * digitação); quando o último volta, vale o que a ponte tem — as janelas terminam todas iguais.
 */
export function configArrived(s: SyncState, m: { rev: number; from?: string | null }, self: string): { state: SyncState; apply: boolean } {
  if (!(m.rev > s.rev)) return { state: s, apply: false }
  const pending = m.from === self ? Math.max(0, s.pending - 1) : s.pending
  return { state: { rev: m.rev, pending }, apply: pending === 0 }
}

/**
 * Ao conectar, a ponte manda a configuração que guarda (ou nada, na primeira vez):
 *   - igual à desta janela → nada;
 *   - a ponte não tem → o painel manda a dele; a janela da live (OBS) espera o painel;
 *   - esta janela mudou depois (editada com a ponte fechada) → o painel manda; a janela da live espera;
 *   - senão → vale a da ponte (é assim que o OBS começa com a configuração do painel).
 */
export function firstConfigAction(o: { hasSnapshot: boolean; snapshotAt: number; localAt: number; capture: boolean; same: boolean }): 'push' | 'apply' | 'none' {
  if (o.same) return 'none'
  if (!o.hasSnapshot || o.localAt > o.snapshotAt) return o.capture ? 'none' : 'push'
  return 'apply'
}

/** Endereço do socket de revezamento: o da ponte com ?papel=revezamento ('' = endereço inválido). */
export function relayUrl(bridgeUrl: string): string {
  try {
    const u = new URL(bridgeUrl.trim())
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return ''
    u.searchParams.set('papel', 'revezamento')
    return u.toString()
  } catch {
    return ''
  }
}

// ── socket ──

const OPEN = 1
let ws: WebSocket | null = null
let target = ''
let retry = 0
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<(m: Msg) => void>()
const openers = new Set<() => void>()

/** Liga (ou troca de endereço). Mesmo endereço já ligado ou tentando: nada muda. */
export function openRelay(bridgeUrl: string) {
  const url = relayUrl(bridgeUrl)
  if (url && url === target && (ws || timer)) return
  closeRelay()
  target = url
  if (url) connect()
}

function connect() {
  timer = null
  if (!target || typeof WebSocket === 'undefined') return
  let s: WebSocket
  try {
    s = new WebSocket(target)
  } catch {
    schedule()
    return
  }
  ws = s
  s.onopen = () => {
    if (ws !== s) return
    retry = 0
    for (const f of [...openers]) f()
  }
  s.onmessage = (e) => {
    if (ws !== s || typeof e.data !== 'string') return
    let m: unknown
    try {
      m = JSON.parse(e.data)
    } catch {
      return
    }
    dispatchRelay(m)
  }
  s.onclose = () => {
    if (ws !== s) return
    ws = null
    schedule()
  }
}

function schedule() {
  if (!target || timer) return
  // ponte fechada (TikFinity sem a ponte, npm run dev): tenta de novo devagar, sem aviso — o revezamento é extra
  const wait = Math.min(15_000, 1000 * 2 ** retry++)
  timer = setTimeout(connect, wait)
}

export function closeRelay() {
  target = ''
  retry = 0
  if (timer) clearTimeout(timer)
  timer = null
  const s = ws
  ws = null
  if (!s) return
  s.onopen = null
  s.onmessage = null
  s.onclose = null
  s.onerror = null
  try {
    s.close()
  } catch {
    /* já fechado */
  }
}

/** Manda para a ponte. false = revezamento desligado agora (a mensagem não foi). */
export function relaySend(m: Msg): boolean {
  if (!ws || ws.readyState !== OPEN) return false
  try {
    ws.send(JSON.stringify(m))
    return true
  } catch {
    return false
  }
}

export const relayConnected = () => !!ws && ws.readyState === OPEN

/** Entrada das mensagens que chegam da ponte (os testes também entram por aqui). */
export function dispatchRelay(m: unknown) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return
  for (const f of [...listeners]) f(m as Msg)
}

export function onRelay(fn: (m: Msg) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Conectou (ou reconectou) na ponte. */
export function onRelayOpen(fn: () => void): () => void {
  openers.add(fn)
  return () => {
    openers.delete(fn)
  }
}
