/**
 * Revezamento da ponte entre as janelas da live (usado pelo live/ponte.mjs).
 *
 * O painel (janela do Chrome/Edge) e a live dentro do OBS (fonte de navegador = outro navegador, com outro
 * localStorage e sem o BroadcastChannel do painel) conversam por aqui. Cada página abre um socket só de
 * revezamento (ws://localhost:5178/ws?papel=revezamento — sem os eventos do TikTok) e a ponte repassa:
 *
 *   { type: 'relay', msg }                 comandos, começo e testes → todas as OUTRAS páginas
 *   { type: 'beat', key, beat }            batimentos da trava ('lock') e da janela pronta ('janela'):
 *   { type: 'beat-clear', key, id }        guardados aqui também, para quem conecta depois saber na hora
 *   { type: 'config', from, at, config }   configuração da live: a ponte guarda a última (rev crescente),
 *                                          devolve a TODOS (inclusive a quem mandou) e grava em
 *                                          lenda/.cache/live-config.json — o OBS começa com a do painel
 *
 * Ao conectar, a página recebe { type: 'config', first: true, rev, at, config | null } e os batimentos
 * ainda válidos. A página que fecha (ou cai) leva os batimentos dela junto.
 *
 * Também serve a página /obs: o jogo em 540×960 (o mesmo tamanho da janela da live) ampliado nítido para o
 * tamanho da fonte de navegador do OBS (1080×1920 → 2×, 720×1280 → 1,33×).
 */
import fs from 'node:fs'
import path from 'node:path'

/** ?papel=revezamento no endereço do WebSocket. */
export const RELAY_ROLE = 'revezamento'
const BEAT_KEYS = new Set(['lock', 'janela'])
/** Mesma validade dos batimentos nas páginas (src/live/channel.ts). */
const STALE_MS = 6000
/** Ficam em cada página: a chave do Euler Stream (segredo) e o endereço da ponte. Nunca vão para o disco. */
const LOCAL_ONLY = new Set(['signKey', 'bridgeUrl'])

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** O WebSocket que chegou é de revezamento (e não o dos eventos da live)? */
export function isRelayRequest(req) {
  try {
    return new URL(req?.url ?? '/', 'http://localhost').searchParams.get('papel') === RELAY_ROLE
  } catch {
    return false
  }
}

function validBeat(b) {
  return isObj(b) && typeof b.id === 'string' && b.id.length > 0 && b.id.length <= 64 && typeof b.at === 'number' && Number.isFinite(b.at)
}

/** Só valores simples (texto, número, sim/não, listas de texto) e sem os campos de cada página. */
export function cleanConfig(c) {
  const out = {}
  let n = 0
  for (const [k, v] of Object.entries(c)) {
    if (LOCAL_ONLY.has(k) || k.length > 40 || ++n > 80) continue
    if (typeof v === 'string') out[k] = v.slice(0, 200)
    else if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') out[k] = v
    else if (Array.isArray(v) && v.length <= 12 && v.every((x) => typeof x === 'string')) out[k] = v.map((x) => x.slice(0, 80))
  }
  return out
}

function loadSnapshot(file, log) {
  if (!file) return null
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!isObj(s) || !isObj(s.config)) return null
    return { rev: Number.isInteger(s.rev) && s.rev > 0 ? s.rev : 1, at: Number(s.at) || 0, config: cleanConfig(s.config) }
  } catch (err) {
    if (err?.code !== 'ENOENT') log(`Não consegui ler a configuração salva da live (${path.basename(file)}): começo sem ela.`)
    return null
  }
}

/**
 * @param {{ file?: string, log?: (...a: unknown[]) => void, send: (ws: unknown, msg: unknown) => void }} o
 *   file: onde guardar a configuração (lenda/.cache/live-config.json); send: o sendTo da ponte.
 */
export function createRelayHub({ file, log = () => {}, send }) {
  const clients = new Set()
  /** `${key}|${id}` → { key, beat, ws } */
  const beats = new Map()
  let snap = loadSnapshot(file, log)
  let saveTimer = null

  const broadcast = (msg, except) => {
    const s = JSON.stringify(msg)
    for (const c of clients) if (c !== except) send(c, s)
  }

  function save() {
    if (!file) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        const tmp = `${file}.tmp`
        fs.writeFileSync(tmp, JSON.stringify(snap, null, 2), 'utf8')
        fs.renameSync(tmp, file)
      } catch (err) {
        log('Não consegui salvar a configuração da live:', err?.message ?? err)
      }
    }, 300)
    saveTimer.unref?.()
  }

  function add(ws) {
    clients.add(ws)
    send(ws, { type: 'hello', version: 1, relay: true })
    send(ws, { type: 'config', first: true, rev: snap?.rev ?? 0, at: snap?.at ?? 0, config: snap?.config ?? null })
    const now = Date.now()
    for (const [k, e] of beats) {
      if (now - e.beat.at < STALE_MS) send(ws, { type: 'beat', key: e.key, beat: e.beat })
      else beats.delete(k)
    }
  }

  function remove(ws) {
    if (!clients.delete(ws)) return
    for (const [k, e] of beats) {
      if (e.ws !== ws) continue
      beats.delete(k)
      broadcast({ type: 'beat-clear', key: e.key, id: e.beat.id })
    }
  }

  function message(ws, m) {
    if (!isObj(m) || !clients.has(ws)) return
    if (m.type === 'relay') {
      if (isObj(m.msg)) broadcast({ type: 'relay', msg: m.msg }, ws)
    } else if (m.type === 'beat') {
      if (!BEAT_KEYS.has(m.key) || !validBeat(m.beat)) return
      beats.set(`${m.key}|${m.beat.id}`, { key: m.key, beat: m.beat, ws })
      broadcast({ type: 'beat', key: m.key, beat: m.beat }, ws)
    } else if (m.type === 'beat-clear') {
      if (!BEAT_KEYS.has(m.key) || typeof m.id !== 'string') return
      beats.delete(`${m.key}|${m.id}`)
      broadcast({ type: 'beat-clear', key: m.key, id: m.id }, ws)
    } else if (m.type === 'config') {
      if (!isObj(m.config)) return
      const config = cleanConfig(m.config)
      const at = typeof m.at === 'number' && Number.isFinite(m.at) ? m.at : Date.now()
      const changed = !snap || JSON.stringify(snap.config) !== JSON.stringify(config)
      snap = { rev: (snap?.rev ?? 0) + 1, at, config }
      // volta para todos, inclusive para quem mandou: é assim que cada página sabe a ordem (rev)
      broadcast({ type: 'config', rev: snap.rev, at, from: typeof m.from === 'string' ? m.from.slice(0, 64) : null, config })
      if (changed) save()
    }
  }

  return {
    add,
    remove,
    message,
    /** Configuração guardada agora (para testes e para o log). */
    snapshot: () => snap,
    size: () => clients.size,
  }
}

/**
 * Página /obs (fonte de navegador do OBS): o jogo num quadro de 540×960 — a janela da live, com a área segura
 * do TikTok — ampliado com transform: scale(), que o navegador redesenha nítido (zoom no CSS do OBS quebra
 * o layout: 100vh passa da tela). Fonte fora de 9:16 fica centralizada, com faixas pretas.
 */
export function obsPage() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LENDA · live no OBS</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
html{background:#000}
html,body{margin:0;width:100%;height:100%;overflow:hidden}
body{background:transparent}
iframe{position:absolute;left:0;top:0;width:540px;height:960px;border:0;display:block;transform-origin:0 0;background:#000}
</style>
</head>
<body>
<iframe id="jogo" name="lenda-obs" title="LENDA" src="/#/live?tela=palco&janela=1&obs=1" allow="autoplay; fullscreen"></iframe>
<script>
(function () {
  var f = document.getElementById('jogo')
  function fit() {
    var w = window.innerWidth || 540
    var h = window.innerHeight || 960
    var s = Math.min(w / 540, h / 960)
    f.style.transform = 'scale(' + s + ')'
    f.style.left = Math.round((w - 540 * s) / 2) + 'px'
    f.style.top = Math.round((h - 960 * s) / 2) + 'px'
  }
  window.addEventListener('resize', fit)
  fit()
})()
</script>
</body>
</html>
`
}
