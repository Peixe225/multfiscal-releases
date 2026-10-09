#!/usr/bin/env node
/**
 * Ponte da live interativa do LENDA (TikTok LIVE → jogo).
 *
 *   npm run live                         abre o jogo em http://localhost:5178 e espera o @ pela tela
 *   npm run live -- --usuario seuperfil  já conecta na live desse perfil
 *   npm run live -- --demo               público de mentira passando pela ponte (testar sem estar ao vivo)
 *   npm run live -- --abrir              abre o painel da live numa janela própria do Chrome/Edge
 *   npm run live -- --porta 5178 --chave <Euler Stream> --sem-site
 *
 * Ela faz duas coisas:
 *   1. serve o jogo já compilado (pasta dist/) — compila sozinha ("npm run build") na primeira vez e
 *      sempre que o código mudar;
 *   2. conecta na live com o TikTok-Live-Connector e repassa comentários, presentes, curtidas, seguidores
 *      e espectadores por WebSocket (ws://localhost:5178/ws) para o jogo, no formato do conector.
 *
 * Só escuta no próprio computador (127.0.0.1) e só aceita o WebSocket de páginas abertas em
 * localhost/127.0.0.1: ninguém na rede consegue trocar a live ou derrubar a ponte.
 *
 * Uma conexão com o TikTok por vez: várias janelas pedindo a mesma live (painel + janela da live, F5…)
 * reaproveitam a conexão que já existe; trocar de @ fecha a anterior de verdade antes de abrir a nova.
 *
 * Live no OBS: fonte de navegador em http://localhost:5178/obs (1080×1920). O OBS é outro navegador e não
 * enxerga o painel do Chrome/Edge; a ponte faz o revezamento entre os dois (live/revezamento.mjs): comandos,
 * começo, testes, quem está rodando a live e a configuração (guardada em lenda/.cache/live-config.json).
 *
 * Nada de login: a leitura usa só o @ público da live. A assinatura da conexão passa pelo serviço gratuito
 * do Euler Stream (padrão do conector); a chave opcional só aumenta os limites.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRelayHub, isRelayRequest, obsPage } from './revezamento.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

const log = (...a) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...a)

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
    --demo               público de teste passando pela ponte: votos, presentes, curtidas e
                         comandos de criação (!criar…), sem TikTok
    --abrir              abre o painel da live numa janela própria do Chrome/Edge (perfil separado,
                         que não congela quando fica atrás do LIVE Studio)
    --sem-site           só o WebSocket (use com "npm run dev")
    --refazer            recompila o jogo antes de abrir
`)
  process.exit(0)
}

/**
 * "@MeuPerfil", " meuperfil ", "https://www.tiktok.com/@MeuPerfil/live" → "meuperfil".
 * O @ do TikTok é sempre minúsculo: com maiúscula o TikTok responde "user_not_found".
 */
function normUser(u) {
  if (typeof u !== 'string') return ''
  const s = u.trim()
  const link = s.match(/tiktok\.com\/@([^/?#\s]+)/i)
  return (link ? link[1] : s).replace(/^@+/, '').replace(/\s+/g, '').toLowerCase()
}
/** @ do TikTok: letras, números, ponto e sublinhado. */
const validUser = (u) => /^[a-z0-9._]{1,40}$/.test(u)
const BAD_USER = 'Esse @ não parece um perfil do TikTok: use só o que vem depois do @ no link do perfil (tiktok.com/@seuperfil).'

const PORT = Number(opt('--porta', '--port') ?? process.env.LENDA_LIVE_PORT ?? 5178)
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`\n✖ Porta inválida: ${opt('--porta', '--port') ?? process.env.LENDA_LIVE_PORT}. Use um número como 5178 ou 5179.\n`)
  process.exit(1)
}
const AUTO_USER = normUser(opt('--usuario', '--user') ?? process.env.TIKTOK_USER ?? '')
const SIGN_KEY = (opt('--chave', '--sign-key') ?? process.env.EULER_API_KEY ?? '').trim()
const DEMO = flag('--demo')
const OPEN = flag('--abrir', '--open')
const NO_SITE = flag('--sem-site', '--no-site')
const REBUILD = flag('--refazer', '--rebuild')
/** --pasta: serve outra pasta já compilada (sem compilar nada). */
const CUSTOM_DIST = opt('--pasta') != null
const DIST = path.resolve(opt('--pasta') ?? path.join(ROOT, 'dist'))
/** Só o próprio computador: sem aviso do Firewall do Windows e sem ninguém da rede mexendo na live. */
const HOST = '127.0.0.1'
const SITE_URL = `http://localhost:${PORT}`
const WS_URL = `ws://localhost:${PORT}/ws`

// ───────────────────────── Node e dependências ─────────────────────────
const NODE_MAJOR = Number(process.versions.node.split('.')[0])

/**
 * O que está em node_modules ainda corresponde ao package.json/package-lock.json? Falta dependência (o
 * LENDA foi atualizado e ganhou uma) ou a versão instalada não é a do package-lock.json (atualizou uma)
 * → precisa de "npm install". Compara o conteúdo, não a data dos arquivos (o npm grava o package-lock.json
 * e o node_modules/.package-lock.json em momentos diferentes).
 */
function dependencyProblem() {
  const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
  let pkg
  try {
    pkg = readJson(path.join(ROOT, 'package.json'))
  } catch {
    return '' // só a pasta dist (sem package.json): nada a conferir
  }
  const nm = path.join(ROOT, 'node_modules')
  if (!fs.existsSync(nm)) return 'as dependências ainda não foram instaladas'
  const names = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) })
  const missing = names.filter((n) => !fs.existsSync(path.join(nm, n, 'package.json')))
  if (missing.length) return `faltam dependências (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''})`
  let lock = null
  try {
    lock = readJson(path.join(ROOT, 'package-lock.json'))
  } catch {
    /* sem package-lock: só a conferência acima */
  }
  const outdated = names.filter((n) => {
    const want = lock?.packages?.[`node_modules/${n}`]?.version
    if (!want) return false
    try {
      return readJson(path.join(nm, n, 'package.json')).version !== want
    } catch {
      return true
    }
  })
  if (outdated.length) return `dependências desatualizadas (${outdated.slice(0, 3).join(', ')}${outdated.length > 3 ? '…' : ''})`
  return ''
}

// usado pelo INICIAR-LIVE.bat: diz o motivo e sai com 1 quando precisa rodar "npm install"
if (flag('--checar-dependencias')) {
  const problem = dependencyProblem()
  if (problem) console.log(`\n  ${problem[0].toUpperCase()}${problem.slice(1)}.`)
  process.exit(problem ? 1 : 0)
}

if (NODE_MAJOR < 22)
  console.warn(`\n⚠ Este Node.js é a versão ${process.versions.node}. O LENDA precisa do 22 ou mais novo (versão LTS em https://nodejs.org); se algo falhar, atualize.\n`)
{
  const problem = dependencyProblem()
  if (problem) console.warn(`\n⚠ ${problem[0].toUpperCase()}${problem.slice(1)}: rode "npm install" na pasta lenda (o INICIAR-LIVE.bat faz isso sozinho).\n`)
}

// ───────────────────────── jogo compilado ─────────────────────────
/** O que entra na compilação: mudou algo aqui (atualização, edição) → recompila sozinho. */
const BUILD_INPUTS = ['src', 'public', 'docs', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'vite.config.js', 'vite.config.mjs']
const BUILD_STAMP = '.lenda-build'

/** Assinatura das fontes: arquivo mais novo + quantos são (apagar um arquivo também conta). */
function sourceSignature() {
  let max = 0
  let count = 0
  const visit = (p) => {
    let st
    try {
      st = fs.statSync(p)
    } catch {
      return
    }
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p)) visit(path.join(p, e))
    } else {
      count++
      max = Math.max(max, st.mtimeMs)
    }
  }
  for (const f of BUILD_INPUTS) visit(path.join(ROOT, f))
  try {
    for (const f of fs.readdirSync(ROOT)) if (/^tsconfig.*\.json$|^\.env/.test(f)) visit(path.join(ROOT, f))
  } catch {
    /* sem código-fonte (só a pasta dist): usa o que existe */
  }
  return { max, sig: count ? `${Math.floor(max)}:${count}` : '' }
}

/** Compila o jogo quando falta a pasta dist ou o código mudou desde a última compilação. Roda com a porta já reservada. */
function ensureBuild() {
  if (NO_SITE) return
  const index = path.join(DIST, 'index.html')
  const stampFile = path.join(DIST, BUILD_STAMP)
  const exists = fs.existsSync(index)
  if (CUSTOM_DIST) {
    if (exists) return
    console.error(`\n✖ A pasta ${DIST} não tem o jogo compilado (index.html).\n`)
    process.exit(1)
  }
  const { max, sig } = sourceSignature()
  let stale = false
  if (exists && sig) {
    let stamp = ''
    try {
      stamp = fs.readFileSync(stampFile, 'utf8').trim()
    } catch {
      /* compilado por fora (npm run build): compara pela data */
    }
    stale = stamp ? stamp !== sig : max > fs.statSync(index).mtimeMs
    if (!stale && !stamp) writeStamp(stampFile, sig)
  }
  if (!REBUILD && exists && !stale) return
  log(!exists ? 'Primeira vez: compilando o jogo (leva cerca de 1 minuto)…' : stale ? 'O código mudou: recompilando o jogo…' : 'Recompilando o jogo…')
  // no Windows o npm é um .cmd: precisa do shell (o comando inteiro numa string evita o aviso DEP0190 do Node)
  const r = process.platform === 'win32' ? spawnSync('npm run build', { cwd: ROOT, stdio: 'inherit', shell: true }) : spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
  if (r.status !== 0 || !fs.existsSync(index)) {
    console.error('\n✖ Não consegui compilar o jogo. Veja o erro acima; se faltar alguma dependência, rode "npm install" na pasta lenda e tente de novo.\n')
    process.exit(1)
  }
  writeStamp(stampFile, sourceSignature().sig)
}

function writeStamp(file, sig) {
  try {
    if (sig) fs.writeFileSync(file, sig)
  } catch {
    /* pasta só de leitura: compara pela data da próxima vez */
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
}

/**
 * Recado da ponte para a página, antes do jogo carregar (só no index.html servido por aqui). Ajusta a
 * configuração salva da live (chave e formato de src/live/config.ts — 'lenda:live:v1', persist do zustand):
 *   - "#/live?fonte=ponte" (o endereço que --abrir e live:demo abrem) → fonte "TikTok (ponte do LENDA)" no
 *     lugar do simulador; quem escolheu o TikFinity continua nele. Em --demo é sempre a ponte. O "fonte=" sai
 *     do endereço depois de lido: recarregar a página não desfaz uma troca feita no painel;
 *   - ponte noutra porta (--porta 5179) → o endereço da ponte salvo ainda no padrão (5178) passa a ser o desta porta;
 *   - "&usuario=perfil" (o --abrir põe o --usuario da ponte) → o @ do painel passa a ser esse, para o painel não
 *     trocar a live que a ponte já está seguindo pelo @ de antes. Também sai do endereço depois de lido.
 * A fonte e o @ pedidos pelo endereço contam como mudança feita agora (editedAt): o painel manda a configuração
 * dele para o OBS pelo revezamento, em vez de voltar para a que a ponte guardou da live anterior.
 */
function bootScript() {
  const P = JSON.stringify({ demo: DEMO })
  return `<script>/* ponte do LENDA (live/ponte.mjs) */(function(){try{
var P=${P},K='lenda:live:v1',want={};
var h=location.hash,qi=h.indexOf('?'),hq=null;
try{hq=new URLSearchParams(qi>=0?h.slice(qi+1):'')}catch(e){}
var asked=(hq&&hq.get('fonte'))||new URLSearchParams(location.search).get('fonte');
var f=P.demo?'ponte':asked;
var wu=String((hq&&hq.get('usuario'))||'').replace(/^@+/,'').replace(/\\s+/g,'').toLowerCase();
if(!/^[a-z0-9._]{1,40}$/.test(wu))wu='';
if(hq&&(hq.has('fonte')||hq.has('usuario'))){hq.delete('fonte');hq.delete('usuario');var rest=hq.toString();try{history.replaceState(history.state,'',location.pathname+location.search+h.slice(0,qi)+(rest?'?'+rest:''))}catch(e){}}
var raw=localStorage.getItem(K),s=raw?JSON.parse(raw):null;
var c=(s&&s.state&&s.state.config)||{};
if(f==='ponte'||f==='tikfinity'||f==='simulador'){if(P.demo||f!=='ponte'||c.source!=='tikfinity')want.source=f}
var ws='ws://'+location.host+'/ws',cur=c.bridgeUrl||'ws://localhost:5178/ws';
if(/^ws:\\/\\/localhost:5178\\/ws$/.test(cur)&&cur!==ws)want.bridgeUrl=ws;
if(wu)want.username=wu;
var changed=false;for(var k in want)if(c[k]!==want[k])changed=true;
var stamp=(!!asked&&(want.source||c.source)===asked)||!!wu;
if(!changed&&!stamp)return;
if(!s||typeof s!=='object')s={state:{},version:1};
if(!s.state||typeof s.state!=='object')s.state={};
s.state.config=Object.assign({},c,want);
if(stamp)s.state.editedAt=Date.now();
localStorage.setItem(K,JSON.stringify(s));
}catch(e){}})()</script>`
}

function serveStatic(req, res) {
  if (NO_SITE) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    return res.end('Ponte do LENDA rodando (só WebSocket em /ws).')
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    return res.end()
  }
  let p
  try {
    p = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0])
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    return res.end('endereço inválido')
  }
  // fonte de navegador do OBS: o jogo em 540×960 ampliado nítido para o tamanho da fonte (live/revezamento.mjs)
  if (p === '/obs' || p === '/obs/') {
    res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' })
    return res.end(req.method === 'HEAD' ? undefined : obsPage())
  }
  if (p === '/') p = '/index.html'
  const file = path.resolve(DIST, '.' + p)
  let ok = false
  try {
    // nada fora da pasta dist, nada escondido (".lenda-build"), só arquivos
    ok = !p.includes('\0') && file.startsWith(DIST + path.sep) && !path.relative(DIST, file).split(path.sep).some((s) => s.startsWith('.')) && fs.statSync(file).isFile()
  } catch {
    ok = false
  }
  if (!ok) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    return res.end('não encontrado')
  }
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  if (p === '/index.html') {
    let html
    try {
      html = fs.readFileSync(file, 'utf8')
    } catch {
      res.writeHead(500)
      return res.end()
    }
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + bootScript()) : bootScript() + html
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' })
    return res.end(req.method === 'HEAD' ? undefined : html)
  }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=3600' })
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res)
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
function sendTo(ws, msg) {
  if (ws.readyState !== 1) return
  try {
    ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg, safe))
  } catch {
    /* socket fechando */
  }
}
function broadcast(msg) {
  const s = JSON.stringify(msg, safe)
  for (const c of clients) sendTo(c, s)
}

/** Revezamento painel ↔ OBS (sockets ?papel=revezamento): fora de `clients`, não recebe os eventos da live. */
const relay = createRelayHub({ file: path.join(ROOT, '.cache', 'live-config.json'), log, send: sendTo })

let status = { state: 'idle', message: 'Esperando o @ do perfil' }
let catalog = []
function setStatus(s) {
  status = s
  broadcast({ type: 'status', status })
  log(`${s.state.toUpperCase()}${s.user ? ` @${s.user}` : ''}${s.message ? ` — ${s.message}` : ''}`)
}

/** Páginas do próprio computador (qualquer porta) ou clientes sem Origin (scripts locais). */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i
const refusedOrigins = new Set()
function allowOrigin(origin) {
  if (!origin || LOCAL_ORIGIN.test(origin)) return true
  if (!refusedOrigins.has(origin) && refusedOrigins.size < 20) {
    refusedOrigins.add(origin)
    log(`Recusei uma conexão de ${String(origin).slice(0, 80)} (só páginas abertas em localhost podem usar a ponte).`)
  }
  return false
}

// ───────────────────────── TikTok ─────────────────────────
let lib = null
async function loadConnector() {
  if (lib) return lib
  try {
    lib = await import('tiktok-live-connector')
    return lib
  } catch {
    setStatus({ state: 'error', message: 'Biblioteca tiktok-live-connector não instalada. Rode "npm install" na pasta lenda (ou abra pelo INICIAR-LIVE.bat).' })
    return null
  }
}

/** A conexão atual. Eventos de qualquer outra (antiga, trocada, "zumbi") são ignorados. */
let conn = null
let wantUser = ''
let wantKey = SIGN_KEY
let retryTimer = null
let stableTimer = null
/** Tentativas seguidas sem uma conexão que durou (zera depois de 60 s conectado). */
let attempt = 0
/** Cada join/leave novo invalida os que ainda estão no meio do caminho. */
let joinSeq = 0
let joining = false
/** O serviço de assinatura pediu pausa até este horário: não adianta insistir antes. */
let limitedUntil = 0

const BACKOFF = [5_000, 15_000, 30_000, 60_000]
const backoff = () => BACKOFF[Math.min(Math.max(attempt - 1, 0), BACKOFF.length - 1)]
const secs = (ms) => (ms >= 120_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`)

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

function wire(c, user) {
  const E = lib.WebcastEvent ?? {}
  const C = lib.ControlEvent ?? {}
  // a live terminou: o "disconnected" que o conector solta logo depois não é queda de conexão
  let ended = false
  // o TikTok às vezes entrega a mesma mensagem duas vezes (mesmo msgId): um presente não pode valer dobrado
  const seen = new Set()
  const fresh = (d) => {
    const id = d?.common?.msgId ?? d?.msgId
    if (id == null || id === '' || id === 0 || id === '0') return true
    const k = String(id)
    if (seen.has(k)) return false
    seen.add(k)
    if (seen.size > 4000) seen.delete(seen.values().next().value)
    return true
  }
  const on = (name, fn) =>
    c.on(E[name] ?? name.toLowerCase(), (d) => {
      if (conn !== c || !fresh(d)) return
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
    if (ended) return
    ended = true
    clearTimeout(stableTimer)
    attempt = 0
    setStatus({ state: 'offline', user, message: 'A live terminou. Quando você começar outra, eu entro sozinho (procuro a cada 30 s).' })
    scheduleRetry(30_000)
  })
  c.on(C.DISCONNECTED ?? 'disconnected', () => {
    if (conn !== c || ended || !wantUser) return
    clearTimeout(stableTimer)
    // caiu logo depois de entrar (sem os 60 s estáveis): a espera cresce a cada vez (5 s, 15 s, 30 s, 1 min)
    const wait = backoff()
    setStatus({ state: 'offline', user, message: `A conexão com a live caiu. Reconectando em ${secs(wait)}…` })
    scheduleRetry(wait)
  })
  c.on(C.ERROR ?? 'error', (err) => {
    if (conn === c) log('aviso do conector:', err?.info ?? err?.message ?? err, err?.exception?.message ? `(${String(err.exception.message).slice(0, 160)})` : '')
  })
}

function scheduleRetry(ms) {
  clearTimeout(retryTimer)
  if (!wantUser) return
  retryTimer = setTimeout(() => void join(wantUser, wantKey, true), ms)
}

/** Fecha a conexão atual (de verdade: espera o socket do TikTok fechar). */
async function drop() {
  clearTimeout(stableTimer)
  const c = conn
  conn = null
  if (c) {
    try {
      await c.disconnect()
    } catch {
      /* já fechada */
    }
  }
}

/** Sai da live (botão Desconectar ou Ctrl+C): cancela tentativas em andamento e agendadas. */
async function leave(quiet = false) {
  joinSeq++
  joining = false
  wantUser = ''
  attempt = 0
  limitedUntil = 0
  clearTimeout(retryTimer)
  await drop()
  if (!quiet) setStatus({ state: 'idle', message: 'Desconectado da live' })
}

async function join(rawUser, key = wantKey, isRetry = false) {
  const user = normUser(rawUser)
  if (!user) return
  if (!validUser(user)) return setStatus({ state: 'error', user, message: BAD_USER })
  key = String(key ?? '').trim()
  if (DEMO) {
    wantUser = user
    broadcast({ type: 'status', status })
    return
  }
  const same = user === wantUser && key === wantKey
  if (!isRetry && same) {
    // a mesma live já está ligada ou entrando (outra janela, F5, a janela da live abrindo): só repassa o estado
    if (joining || conn?.isConnected || conn?.isConnecting) return void broadcast({ type: 'status', status })
    // o serviço de assinatura pediu pausa: insistir antes da hora só estende o bloqueio
    if (Date.now() < limitedUntil) return void broadcast({ type: 'status', status })
  }
  const seq = ++joinSeq
  clearTimeout(retryTimer)
  if (!isRetry || !same) attempt = 0
  if (!same) limitedUntil = 0
  wantUser = user
  wantKey = key
  joining = true
  try {
    const L = await loadConnector()
    if (seq !== joinSeq || !L) return
    await drop()
    if (seq !== joinSeq) return
    attempt++
    setStatus({ state: 'connecting', user, message: `Entrando na live de @${user}…` })
    const Conn = L.TikTokLiveConnection ?? L.WebcastPushConnection
    // enableExtendedGiftInfo pede a lista de presentes da sala por uma assinatura paga do Euler Stream e
    // derruba a conexão no plano gratuito; cada evento de presente já traz nome, preço e imagem.
    const c = new Conn(user, { enableExtendedGiftInfo: false, processInitialData: false, ...(key ? { signApiKey: key } : {}) })
    conn = c
    wire(c, user)
    let st
    try {
      st = await c.connect()
    } catch (err) {
      if (conn !== c) return
      conn = null
      joinFailed(err, user, L)
      return
    }
    if (conn !== c) {
      // trocaram de live (ou desconectaram) enquanto esta entrava: o conector só fecha depois de conectado
      c.disconnect().catch(() => {})
      return
    }
    limitedUntil = 0
    setStatus({ state: 'connected', user, roomId: String(st?.roomId ?? ''), message: 'Recebendo comentários e presentes' })
    clearTimeout(stableTimer)
    stableTimer = setTimeout(() => {
      if (conn === c && c.isConnected) attempt = 0
    }, 60_000)
  } finally {
    if (seq === joinSeq) joining = false
  }
}

/** Erro ao entrar → mensagem em português que diz o que fazer, e quando a ponte tenta de novo. */
function joinFailed(err, user, L) {
  const is = (C) => typeof C === 'function' && err instanceof C
  const msg = String(err?.message ?? err ?? '')
  const inner = (err?.config?.requestErrs ?? []).map((e) => String(e?.message ?? e)).join(' | ')
  const all = `${msg} ${inner} ${err?.exception?.message ?? ''} ${err?.cause?.message ?? ''} ${err?.code ?? ''}`
  if (is(L.UserOfflineError) || /isn't online|is not online|not.*live|offline|LIVE has ended/i.test(msg)) {
    setStatus({ state: 'offline', user, message: `@${user} não está ao vivo agora. Comece a live no TikTok — eu entro sozinho (tento a cada 30 s).` })
    scheduleRetry(30_000)
  } else if (is(L.InvalidResponseCompositeError) || /Room ID|user_not_found/i.test(all)) {
    // perfil sem live no ar (ou @ diferente do link do perfil): o TikTok não devolve sala nenhuma
    const wait = attempt <= 4 ? 30_000 : 60_000
    setStatus({
      state: 'offline',
      user,
      message: `Não achei a live de @${user}. Confira se o @ está igual ao do link do perfil (tiktok.com/@${user}) e se a live já começou — tento de novo em ${secs(wait)}.`,
    })
    scheduleRetry(wait)
  } else if (is(L.SignatureRateLimitError) || /rate.?limit|too many|429/i.test(all)) {
    const hinted = Number(err?.retryAfter) || (Number(err?.resetTime) ? Number(err.resetTime) - Date.now() : 0)
    const wait = Math.min(30 * 60_000, Math.max(60_000, hinted || 120_000))
    limitedUntil = Date.now() + wait
    setStatus({
      state: 'error',
      user,
      message: `O serviço gratuito que libera a conexão (Euler Stream) pediu uma pausa: muitas conexões seguidas. Tento de novo sozinho em ${secs(wait)} — não precisa reiniciar nada. Uma chave do Euler Stream (Opções avançadas) aumenta esse limite.`,
    })
    scheduleRetry(wait)
  } else if (is(L.PremiumFeatureError) || /premium|permission|402|403|unauthori[sz]ed/i.test(msg)) {
    setStatus({ state: 'error', user, message: 'O serviço de conexão (Euler Stream) recusou o pedido. Se você colocou uma chave em Opções avançadas, confira se ela está certa (ou apague para usar o plano gratuito). Tento de novo em 2 min.' })
    scheduleRetry(120_000)
  } else if (is(L.InvalidUniqueIdError)) {
    setStatus({ state: 'error', user, message: '@ inválido. Digite só o @ do perfil, como aparece no link: tiktok.com/@seuperfil.' })
  } else if (is(L.ConnectTimeoutError) || /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|socket hang up|network|fetch failed|timed? ?out|Connect Error/i.test(all)) {
    const wait = backoff()
    setStatus({ state: 'error', user, message: `Sem resposta do TikTok (a internet caiu ou o serviço está instável). Tento de novo em ${secs(wait)}.` })
    scheduleRetry(wait)
  } else {
    const wait = backoff()
    setStatus({ state: 'error', user, message: `Não consegui entrar na live de @${user} (${msg.slice(0, 120)}). Tento de novo em ${secs(wait)}.` })
    scheduleRetry(wait)
  }
}

// ───────────────────────── modo demonstração ─────────────────────────
/**
 * Público de mentira passando pela ponte (o caminho completo: ponte → WebSocket → jogo): votos de 1 a 4,
 * conversa, presentes em sequência e avulsos (com a lista de presentes da "sala"), curtidas, seguidores,
 * espectadores e um "maior doador" que manda Galáxias e digita os comandos de criação da lenda.
 */
function startDemo() {
  const crowd = [
    ['gabi.fut', 'Gabi ⚽'], ['rafa_10', 'Rafa 10'], ['mari.gol', 'Mari'], ['caio.mengao', 'Caio Mengão'], ['bia_verdao', 'Bia'],
    ['leo.inter', 'Léo'], ['tati_galo', 'Tati do Galo'], ['dudu.peixe', 'Dudu'], ['nina.saopaulo', 'Nina'], ['theo_furacao', 'Théo'],
  ]
  // [nome do TikTok, moedas, tipo (1 = em sequência)]
  const gifts = [
    ['Rose', 1, 1], ['TikTok', 1, 1], ['GG', 1, 1], ['Ice Cream Cone', 1, 1], ['Finger Heart', 5, 1], ['Doughnut', 30, 0], ['Hand Hearts', 100, 0], ['Galaxy', 1000, 0],
  ]
  const talk = ['bora!!', 'que jogo', 'vai lenda', 'kkkkk', 'GOL', 'qual o time?', 'chuta!', 'joga muito']
  // o maior doador: manda Galáxias (vence a disputa) e, a cada ciclo, cria a lenda e corrige um campo
  const whale = { uniqueId: 'gabi.fut', nickname: 'Gabi ⚽' }
  const commands = ['!criar Gabi Fut, Brasil, atacante', '!posicao meia', '!ok']
  catalog = gifts.map(([name, coins]) => ({ id: name, name, coins }))
  setStatus({ state: 'demo', user: 'demo', message: 'Modo demonstração: público de teste passando pela ponte' })
  broadcast({ type: 'gifts', list: catalog })
  let tick = 0
  let viewers = 48
  const sendGift = (user, [name, coins, type], streak = 1) => {
    const data = (i, end) => ({ user, giftId: name, repeatCount: i, repeatEnd: end ? 1 : 0, giftDetails: { giftName: name, diamondCount: coins, giftType: type } })
    if (type !== 1) return broadcast({ event: 'gift', data: data(1, true) })
    for (let i = 1; i <= streak; i++) broadcast({ event: 'gift', data: data(i, false) })
    broadcast({ event: 'gift', data: data(streak, true) })
  }
  setInterval(() => {
    tick++
    // maior doador: uma Galáxia a cada 14 s (vence qualquer disputa) e, a cada ~42 s, !criar, uma correção e o !ok
    const phase = tick % 60
    if (phase % 20 === 1) sendGift(whale, gifts[gifts.length - 1])
    if (phase === 12) broadcast({ event: 'chat', data: { user: whale, comment: commands[0] } })
    if (phase === 17) broadcast({ event: 'chat', data: { user: whale, comment: commands[1] } })
    if (phase === 23) broadcast({ event: 'chat', data: { user: whale, comment: commands[2] } })
    if (tick % 7 === 0) {
      viewers = Math.max(12, viewers + Math.round((Math.random() - 0.45) * 6))
      broadcast({ event: 'roomUser', data: { viewerCount: viewers } })
    }
    const [id, nick] = crowd[1 + Math.floor(Math.random() * (crowd.length - 1))]
    const user = { uniqueId: id, nickname: nick }
    const r = Math.random()
    if (r < 0.5) {
      const n = Math.random() < 0.12 ? 4 : 1 + Math.floor(Math.random() * 3)
      broadcast({ event: 'chat', data: { user, comment: String(n) } })
    } else if (r < 0.58) broadcast({ event: 'chat', data: { user, comment: talk[Math.floor(Math.random() * talk.length)] } })
    else if (r < 0.86) {
      const g = Math.random() < 0.85 ? gifts[Math.floor(Math.random() * 5)] : gifts[5 + Math.floor(Math.random() * 2)]
      sendGift(user, g, 1 + Math.floor(Math.random() * 4))
    } else if (r < 0.95) broadcast({ event: 'like', data: { user, likeCount: 10 + Math.floor(Math.random() * 30) } })
    else if (r < 0.97) broadcast({ event: 'follow', data: { user } })
    else if (r < 0.98) broadcast({ event: 'share', data: { user } })
    else broadcast({ event: 'member', data: { user } })
  }, 700)
}

// ───────────────────────── servidor ─────────────────────────
let listening = false
const server = http.createServer((req, res) => {
  try {
    serveStatic(req, res)
  } catch (err) {
    log('erro ao servir', req.url, err?.message)
    try {
      res.writeHead(500)
      res.end()
    } catch {
      res.destroy()
    }
  }
})
// clientes só mandam JSON pequeno (connect/disconnect/hello, revezamento): nada de mensagens enormes
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024, verifyClient: ({ origin }) => allowOrigin(origin) })
// (antes de abrir a porta o erro já é tratado em server.on('error'))
wss.on('error', (err) => {
  if (listening) log('WebSocket:', err?.message ?? err)
})
wss.on('connection', (ws, req) => {
  if (isRelayRequest(req)) {
    ws.on('error', () => {
      relay.remove(ws)
      ws.terminate()
    })
    ws.on('close', () => relay.remove(ws))
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return
      try {
        relay.message(ws, JSON.parse(String(raw)))
      } catch {
        /* mensagem quebrada: ignora */
      }
    })
    relay.add(ws)
    return
  }
  clients.add(ws)
  ws.on('error', () => {
    clients.delete(ws)
    ws.terminate()
  })
  ws.on('close', () => clients.delete(ws))
  sendTo(ws, { type: 'hello', version: 1, ...(DEMO ? { demo: true } : {}) })
  sendTo(ws, { type: 'status', status })
  if (catalog.length) sendTo(ws, { type: 'gifts', list: catalog })
  ws.on('message', (raw, isBinary) => {
    if (isBinary) return
    let m
    try {
      m = JSON.parse(String(raw))
    } catch {
      return
    }
    if (!m || typeof m !== 'object') return
    if (m.type === 'connect') {
      const user = normUser(m.user)
      if (!user) return
      if (!validUser(user)) return sendTo(ws, { type: 'status', status: { state: 'error', user, message: BAD_USER } })
      void join(user, typeof m.signKey === 'string' && m.signKey.trim() ? m.signKey : wantKey)
    } else if (m.type === 'disconnect') {
      // no modo demonstração o público de teste continua: só repete o estado
      if (DEMO) sendTo(ws, { type: 'status', status })
      else void leave()
    }
  })
})

server.on('error', (err) => {
  if (listening) return log('servidor:', err?.message ?? err)
  if (err.code === 'EADDRINUSE') console.error(`\n✖ A porta ${PORT} já está em uso: a ponte já está aberta em outra janela? Feche a outra ou use outra porta (npm run live -- --porta 5179).\n`)
  else if (err.code === 'EACCES') console.error(`\n✖ Sem permissão para usar a porta ${PORT}. Use outra (npm run live -- --porta 5179).\n`)
  else console.error(err)
  process.exit(1)
})
// um erro inesperado (rede, biblioteca) não pode derrubar a ponte no meio da live
process.on('uncaughtException', (err) => log('erro inesperado (a ponte continua):', err?.stack ?? err))
process.on('unhandledRejection', (err) => log('erro inesperado (a ponte continua):', err?.stack ?? err))

// reserva a porta ANTES de compilar: uma segunda ponte não apaga a pasta dist da primeira
server.listen(PORT, HOST, () => {
  listening = true
  ensureBuild()
  const url = `${SITE_URL}/#/live?fonte=ponte`
  const row = (t) => `  │${t.padEnd(58)}│`
  console.log(
    [
      '',
      `  ┌${'─'.repeat(58)}┐`,
      row(`  LENDA · Live interativa${DEMO ? ' (demonstração)' : ''}`),
      row(`  Jogo:       ${NO_SITE ? '(use o npm run dev)' : url}`),
      row(`  WebSocket:  ${WS_URL}`),
      ...(NO_SITE ? [] : [row(`  OBS:        ${SITE_URL}/obs  (1080×1920)`)]),
      `  └${'─'.repeat(58)}┘`,
      '  Deixe esta janela aberta durante a live. Ctrl+C encerra.',
      '',
    ].join('\n'),
  )
  if (DEMO) startDemo()
  else if (AUTO_USER) void join(AUTO_USER, SIGN_KEY)
  // o painel aberto pela ponte já vem com o @ do --usuario (o "usuario=" sai do endereço depois de lido)
  if (OPEN && !NO_SITE) openWindow(AUTO_USER && validUser(AUTO_USER) && !DEMO ? `${url}&usuario=${encodeURIComponent(AUTO_USER)}` : url)
})

/**
 * Abre o painel da live numa janela própria do Chrome/Edge, com um perfil só dela (.cache/janela-live):
 * assim as opções valem mesmo com o navegador já aberto, e a janela da live (9:16, aberta pelo painel)
 * continua desenhando e com os relógios em dia quando o LIVE Studio fica na frente.
 * Sem Chrome/Edge: abre no navegador padrão.
 */
function openWindow(url) {
  const profile = path.join(ROOT, '.cache', 'janela-live')
  const args = [
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    // sem --window-size: ele vale para TODAS as janelas do processo e a janela da live (window.open 540×960)
    // abriria do tamanho do painel
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
    `--app=${url}`,
  ]
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
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge']
  const exe = process.env.LENDA_NAVEGADOR || tries.find((p) => p && !p.startsWith('undefined') && fs.existsSync(p))
  const fail = () => log(`Não consegui abrir o navegador sozinho. Abra ${url} no Chrome ou no Edge.`)
  if (exe) {
    try {
      fs.mkdirSync(profile, { recursive: true })
    } catch {
      /* o navegador cria */
    }
    try {
      spawn(exe, args, { detached: true, stdio: 'ignore' }).on('error', fail).unref()
      log('Abri o painel da live numa janela própria do navegador (perfil separado, só do LENDA). Configure e comece a live por ela.')
    } catch {
      fail()
    }
    return
  }
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try {
    spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).on('error', fail).unref()
  } catch {
    fail()
  }
}

let closing = false
const bye = async () => {
  if (closing) return
  closing = true
  // sai do TikTok direito, mas não fica preso se o conector demorar
  setTimeout(() => process.exit(0), 3000).unref()
  await leave(true)
  process.exit(0)
}
process.on('SIGINT', bye)
process.on('SIGTERM', bye)
process.on('SIGHUP', bye)
