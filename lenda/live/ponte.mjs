#!/usr/bin/env node
/**
 * Ponte da live interativa do LENDA (TikTok LIVE → jogo).
 *
 *   npm run live                         abre o jogo em http://localhost:5178 e espera o @ pela tela
 *   npm run live -- --usuario seuperfil  já conecta na live desse perfil
 *   npm run live -- --demo               público de mentira (testar sem estar ao vivo)
 *   npm run live -- --abrir              abre o jogo numa janela 9:16 (Chrome/Edge) para captura
 *   npm run live -- --porta 5178 --chave <Euler Stream> --sem-site
 *
 * Ela faz duas coisas:
 *   1. serve o jogo já compilado (pasta dist/) — gera com "npm run build" se ainda não existir;
 *   2. conecta na live com o TikTok-Live-Connector e repassa comentários, presentes, curtidas, seguidores
 *      e espectadores por WebSocket (ws://localhost:5178/ws) para o jogo, no formato do conector.
 *
 * Nada de login: a leitura usa só o @ público da live. A assinatura da conexão passa pelo serviço gratuito
 * do Euler Stream (padrão do conector); a chave opcional só aumenta os limites.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

// ───────────────────────── argumentos ─────────────────────────
const argv = process.argv.slice(2)
const flag = (...names) => names.some((n) => argv.includes(n))
const opt = (...names) => {
  for (const n of names) {
    const i = argv.indexOf(n)
    if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
    const eq = argv.find((a) => a.startsWith(n + '='))
    if (eq) return eq.slice(n.length + 1)
  }
  return undefined
}
if (flag('--ajuda', '--help', '-h')) {
  console.log(`
  Ponte da live interativa do LENDA

  npm run live [-- opções]

    --usuario <perfil>   conecta na live desse @ ao iniciar (dá para fazer pela tela também)
    --porta <número>     porta do jogo e do WebSocket (padrão 5178)
    --chave <chave>      chave do Euler Stream (opcional, aumenta os limites)
    --demo               público de teste mandando votos e presentes (sem TikTok)
    --abrir              abre o jogo numa janela em pé (540×960) para capturar no LIVE Studio
    --sem-site           só o WebSocket (use com "npm run dev")
    --refazer            recompila o jogo antes de abrir
`)
  process.exit(0)
}
const PORT = Number(opt('--porta', '--port') ?? process.env.LENDA_LIVE_PORT ?? 5178)
const AUTO_USER = (opt('--usuario', '--user') ?? process.env.TIKTOK_USER ?? '').replace(/^@/, '').trim()
const SIGN_KEY = opt('--chave', '--sign-key') ?? process.env.EULER_API_KEY ?? ''
const DEMO = flag('--demo')
const OPEN = flag('--abrir', '--open')
const NO_SITE = flag('--sem-site', '--no-site')
const REBUILD = flag('--refazer', '--rebuild')
const DIST = path.resolve(opt('--pasta') ?? path.join(ROOT, 'dist'))

const log = (...a) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...a)

// ───────────────────────── jogo compilado ─────────────────────────
/** Arquivo mais novo do código do jogo (para recompilar sozinho depois de atualizar). */
function newestSource() {
  let max = 0
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else max = Math.max(max, fs.statSync(p).mtimeMs)
    }
  }
  try {
    walk(path.join(ROOT, 'src'))
    for (const f of ['index.html', 'package.json', 'vite.config.ts']) if (fs.existsSync(path.join(ROOT, f))) max = Math.max(max, fs.statSync(path.join(ROOT, f)).mtimeMs)
  } catch {
    /* sem código-fonte (só a pasta dist): usa o que existe */
  }
  return max
}

function ensureBuild() {
  if (NO_SITE) return
  const index = path.join(DIST, 'index.html')
  const exists = fs.existsSync(index)
  const stale = exists && newestSource() > fs.statSync(index).mtimeMs
  if (!REBUILD && exists && !stale) return
  log(!exists ? 'Primeira vez: compilando o jogo (leva cerca de 1 minuto)…' : stale ? 'O código mudou: recompilando o jogo…' : 'Recompilando o jogo…')
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const r = spawnSync(npm, ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0 || !fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('\n✖ Não consegui compilar o jogo. Rode "npm install" na pasta lenda e tente de novo.\n')
    process.exit(1)
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain',
}

function serveStatic(req, res) {
  if (NO_SITE) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    return res.end('Ponte do LENDA rodando (só WebSocket em /ws).')
  }
  let p = decodeURIComponent((req.url || '/').split('?')[0])
  if (p === '/') p = '/index.html'
  const file = path.resolve(DIST, '.' + p)
  if (!file.startsWith(DIST + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404)
    return res.end('não encontrado')
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': p === '/index.html' ? 'no-cache' : 'public, max-age=3600' })
  fs.createReadStream(file).pipe(res)
}

// ───────────────────────── WebSocket com o jogo ─────────────────────────
let WebSocketServer
try {
  ;({ WebSocketServer } = await import('ws'))
} catch {
  console.error('\n✖ Faltam dependências. Na pasta lenda, rode: npm install\n')
  process.exit(1)
}

const clients = new Set()
const safe = (_k, v) => (typeof v === 'bigint' ? v.toString() : v)
function broadcast(msg) {
  const s = JSON.stringify(msg, safe)
  for (const c of clients) if (c.readyState === 1) c.send(s)
}

let status = { state: 'idle', message: 'Esperando o @ do perfil' }
let catalog = []
function setStatus(s) {
  status = s
  broadcast({ type: 'status', status })
  log(`${s.state.toUpperCase()}${s.user ? ` @${s.user}` : ''}${s.message ? ` — ${s.message}` : ''}`)
}

// ───────────────────────── TikTok ─────────────────────────
let lib = null
async function loadConnector() {
  if (lib) return lib
  try {
    lib = await import('tiktok-live-connector')
    return lib
  } catch {
    setStatus({ state: 'error', message: 'Biblioteca tiktok-live-connector não instalada. Rode "npm install" na pasta lenda.' })
    return null
  }
}

let conn = null
let wantUser = ''
let wantKey = SIGN_KEY
let retryTimer = null
let attempt = 0

const firstUrl = (img) => (img && (img.url?.[0] ?? img.urlList?.[0] ?? img.url_list?.[0])) || undefined
// formato real do conector 2.x: o @ vem em displayId (uniqueId nas versões antigas), a foto em avatarThumb.urlList
const slimUser = (u = {}) => ({
  uniqueId: u.uniqueId || u.displayId || u.idStr || (u.id != null ? String(u.id) : undefined),
  nickname: u.nickname || u.displayId,
  profilePictureUrl: firstUrl(u.avatarThumb) ?? firstUrl(u.profilePicture) ?? u.profilePictureUrl,
})

/** Lista de presentes aprendida com os presentes que chegam (nome, preço e imagem reais da sala). */
function learnGift(g) {
  if (!g.name || catalog.some((x) => x.name === g.name)) return
  catalog = [...catalog, g].sort((a, b) => a.coins - b.coins)
  broadcast({ type: 'gifts', list: catalog })
}

function wire(c) {
  const E = lib.WebcastEvent ?? {}
  const on = (name, fn) => c.on(E[name] ?? name.toLowerCase(), (d) => {
    try {
      fn(d ?? {})
    } catch (err) {
      log('evento com formato inesperado', name, err?.message)
    }
  })
  on('CHAT', (d) => {
    const text = d.comment ?? d.content
    if (text) broadcast({ event: 'chat', data: { user: slimUser(d.user), comment: text } })
  })
  on('GIFT', (d) => {
    // conector 2.x: o presente vem em d.gift { name, diamondCount, type, icon.urlList } (giftDetails nas versões antigas)
    const g = d.gift ?? {}
    const det = d.giftDetails ?? {}
    const ext = d.extendedGiftInfo ?? {}
    const name = g.name || det.giftName || ext.name
    const coins = Number(g.diamondCount ?? det.diamondCount ?? ext.diamond_count ?? 1)
    const type = g.type ?? det.giftType ?? ext.type
    const image = firstUrl(g.icon) ?? firstUrl(g.image) ?? firstUrl(det.icon) ?? firstUrl(det.giftImage) ?? firstUrl(ext.image) ?? firstUrl(ext.icon)
    if (!name) return
    learnGift({ id: String(d.giftId ?? g.id ?? name), name, coins, image })
    broadcast({
      event: 'gift',
      data: {
        user: slimUser(d.user),
        giftId: d.giftId ?? g.id,
        repeatCount: d.repeatCount,
        repeatEnd: d.repeatEnd,
        groupId: d.groupId != null ? String(d.groupId) : undefined,
        giftDetails: { giftName: name, diamondCount: coins, giftType: type, icon: { urlList: image ? [image] : [] } },
      },
    })
  })
  on('LIKE', (d) => broadcast({ event: 'like', data: { user: slimUser(d.user), likeCount: d.likeCount ?? d.count, totalLikeCount: d.totalLikeCount ?? d.total } }))
  on('FOLLOW', (d) => broadcast({ event: 'follow', data: { user: slimUser(d.user) } }))
  on('SHARE', (d) => broadcast({ event: 'share', data: { user: slimUser(d.user) } }))
  on('MEMBER', (d) => broadcast({ event: 'member', data: { user: slimUser(d.user) } }))
  on('ROOM_USER', (d) => {
    const n = d.viewerCount ?? d.total
    if (n != null) broadcast({ event: 'roomUser', data: { viewerCount: Number(n) } })
  })
  on('STREAM_END', () => {
    setStatus({ state: 'offline', user: wantUser, message: 'A live terminou. Volto a procurar em 30 s.' })
    scheduleRetry(30_000)
  })
  const C = lib.ControlEvent ?? {}
  c.on(C.DISCONNECTED ?? 'disconnected', () => {
    if (!wantUser || conn !== c) return
    setStatus({ state: 'offline', user: wantUser, message: 'Conexão caiu. Reconectando…' })
    scheduleRetry(attempt < 3 ? 5_000 : 30_000)
  })
  c.on(C.ERROR ?? 'error', (err) => log('aviso do conector:', err?.info ?? err?.message ?? err))
}

function scheduleRetry(ms) {
  clearTimeout(retryTimer)
  if (!wantUser) return
  retryTimer = setTimeout(() => void join(wantUser, wantKey, true), ms)
}

async function leave(quiet = false) {
  clearTimeout(retryTimer)
  const c = conn
  conn = null
  if (c) {
    try {
      await c.disconnect()
    } catch {
      /* já fechada */
    }
  }
  if (!quiet) setStatus({ state: 'idle', message: 'Desconectado da live' })
}

async function join(user, key = wantKey, isRetry = false) {
  user = String(user || '').replace(/^@/, '').trim()
  if (!user) return
  if (!isRetry) attempt = 0
  wantUser = user
  wantKey = key
  if (DEMO) return
  const L = await loadConnector()
  if (!L) return
  await leave(true)
  attempt++
  setStatus({ state: 'connecting', user, message: `Entrando na live de @${user}…` })
  const Conn = L.TikTokLiveConnection ?? L.WebcastPushConnection
  // enableExtendedGiftInfo pede a lista de presentes da sala por uma assinatura paga do Euler Stream e
  // derruba a conexão no plano gratuito; cada evento de presente já traz nome, preço e imagem.
  const c = new Conn(user, { enableExtendedGiftInfo: false, processInitialData: false, ...(key ? { signApiKey: key } : {}) })
  conn = c
  wire(c)
  try {
    const st = await c.connect()
    if (conn !== c) return
    attempt = 0
    setStatus({ state: 'connected', user, roomId: String(st?.roomId ?? ''), message: 'Recebendo comentários e presentes' })
  } catch (err) {
    if (conn !== c) return
    const name = err?.constructor?.name ?? ''
    const msg = String(err?.message ?? err)
    if (name.includes('UserOffline') || /offline|not.*live|isn't live|LIVE has ended/i.test(msg)) {
      setStatus({ state: 'offline', user, message: `@${user} não está ao vivo agora. Comece a live — tento de novo em 30 s.` })
      scheduleRetry(30_000)
    } else if (/rate.?limit|429/i.test(msg)) {
      setStatus({ state: 'error', user, message: 'Limite do serviço de conexão atingido. Espere alguns minutos (ou use uma chave do Euler Stream).' })
      scheduleRetry(120_000)
    } else {
      setStatus({ state: 'error', user, message: `Falha ao conectar: ${msg.slice(0, 160)}` })
      scheduleRetry(Math.min(60_000, 10_000 * attempt))
    }
  }
}

// ───────────────────────── modo demonstração ─────────────────────────
function startDemo() {
  const names = ['gabi.fut', 'rafa_10', 'mari.gol', 'caio.mengao', 'bia_verdao', 'leo.inter', 'tati_galo', 'dudu.peixe', 'nina.saopaulo', 'theo_furacao']
  const gifts = [
    ['Rose', 1, 1], ['TikTok', 1, 1], ['GG', 1, 1], ['Ice Cream Cone', 1, 1], ['Finger Heart', 5, 1], ['Doughnut', 30, 0], ['Galaxy', 1000, 0],
  ]
  setStatus({ state: 'demo', user: 'demo', message: 'Modo demonstração: público de teste' })
  broadcast({ type: 'gifts', list: gifts.map(([name, coins]) => ({ id: name, name, coins })) })
  setInterval(() => {
    const n = names[Math.floor(Math.random() * names.length)]
    const user = { uniqueId: n, nickname: n }
    const r = Math.random()
    if (r < 0.55) broadcast({ event: 'chat', data: { user, comment: String(1 + Math.floor(Math.random() * 3)) } })
    else if (r < 0.92) {
      const g = gifts[Math.floor(Math.random() * 5)]
      const streak = 1 + Math.floor(Math.random() * 4)
      for (let i = 1; i <= streak; i++) broadcast({ event: 'gift', data: { user, giftId: g[0], repeatCount: i, repeatEnd: 0, giftDetails: { giftName: g[0], diamondCount: g[1], giftType: g[2] } } })
      broadcast({ event: 'gift', data: { user, giftId: g[0], repeatCount: streak, repeatEnd: 1, giftDetails: { giftName: g[0], diamondCount: g[1], giftType: g[2] } } })
    } else broadcast({ event: 'like', data: { user, likeCount: 10 + Math.floor(Math.random() * 30) } })
  }, 700)
}

// ───────────────────────── servidor ─────────────────────────
ensureBuild()
const server = http.createServer(serveStatic)
const wss = new WebSocketServer({ server, path: '/ws' })
wss.on('connection', (ws) => {
  clients.add(ws)
  ws.send(JSON.stringify({ type: 'hello', version: 1, ...(DEMO ? { demo: true } : {}) }))
  ws.send(JSON.stringify({ type: 'status', status }))
  if (catalog.length) ws.send(JSON.stringify({ type: 'gifts', list: catalog }))
  ws.on('message', (raw) => {
    let m
    try {
      m = JSON.parse(String(raw))
    } catch {
      return
    }
    if (m?.type === 'connect' && m.user) {
      if (status.state === 'connected' && wantUser === String(m.user).replace(/^@/, '')) ws.send(JSON.stringify({ type: 'status', status }))
      else void join(m.user, m.signKey || wantKey)
    } else if (m?.type === 'disconnect') {
      wantUser = ''
      void leave()
    }
  })
  ws.on('close', () => clients.delete(ws))
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`\n✖ A porta ${PORT} já está em uso. Feche a outra ponte ou use --porta 5179.\n`)
  else console.error(err)
  process.exit(1)
})

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/#/live`
  console.log(`
  ┌──────────────────────────────────────────────────────────┐
  │  LENDA · Live interativa                                 │
  │  Jogo:       ${NO_SITE ? '(use o npm run dev)                        ' : url.padEnd(44)}│
  │  WebSocket:  ${`ws://localhost:${PORT}/ws`.padEnd(44)}│
  └──────────────────────────────────────────────────────────┘
  Deixe esta janela aberta durante a live. Ctrl+C encerra.
`)
  if (DEMO) startDemo()
  else if (AUTO_USER) void join(AUTO_USER, SIGN_KEY)
  if (OPEN && !NO_SITE) openWindow(url)
})

/** Abre o jogo numa janela "app" 540×960 (Chrome ou Edge); senão, no navegador padrão. */
function openWindow(url) {
  const size = ['--window-size=540,960', `--app=${url}`]
  const tries =
    process.platform === 'win32'
      ? [
          `${process.env['ProgramFiles']}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${process.env['ProgramFiles']}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']
  const exe = tries.find((p) => p && fs.existsSync(p))
  if (exe) {
    spawn(exe, size, { detached: true, stdio: 'ignore' }).unref()
    return
  }
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref()
}

const bye = async () => {
  await leave(true)
  process.exit(0)
}
process.on('SIGINT', bye)
process.on('SIGTERM', bye)
