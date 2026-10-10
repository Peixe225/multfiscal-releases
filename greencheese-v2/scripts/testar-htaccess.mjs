// Testa os .htaccess de verdade num Apache local com mod_php (o mais perto da Hostinger que dá pra ter aqui; lá é
// LiteSpeed, que lê o mesmo .htaccess). Copia o build pra uma pasta temporária em /greencheese/, sem GC_DADOS
// (como no ar: banco em api/privado/), gera um código de instalação de verdade e confere: o site abre, a API
// responde, banco/log/módulos/instalacao.php dão 403, uploads/ só serve imagem (nenhum .php roda), o envio de
// imagem funciona, o pedido do site entra (e as falas do pedido guiado voltam com ETag e 304), o diagnóstico do
// painel, pela web, acha tudo fechado e o GET da loja sai com no-cache e ETag (304 quando nada mudou) enquanto o resto
// da API segue no-store.
// Uso: node scripts/testar-htaccess.mjs [pasta-do-build]   (padrão: dist/; termina com "htaccess ok")
// Precisa do apache2 e do libapache2-mod-php (APACHE=/caminho/do/apache2; GC_TESTE_PORTA escolhe a porta).
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { pedidoValido } from './testar-api-pedidos.mjs'

const raiz = fileURLToPath(new URL('..', import.meta.url))
const build = resolve(process.argv[2] ?? join(raiz, 'dist'))
const APACHE = process.env.APACHE ?? '/usr/sbin/apache2'
const modulos = process.env.APACHE_MODULOS ?? '/usr/lib/apache2/modules'
const modPhp = existsSync(modulos) ? readdirSync(modulos).find((n) => /^libphp[\d.]*\.so$/.test(n)) : undefined
if (!existsSync(APACHE) || !modPhp) {
  console.error(`sem Apache com mod_php aqui (${APACHE}, ${modulos}): instale apache2 e libapache2-mod-php`)
  process.exit(2)
}
if (!existsSync(join(build, 'api', 'index.php'))) {
  console.error(`${build} não tem api/index.php: rode o build antes`)
  process.exit(2)
}

let falhas = 0
let checagens = 0
function ok(cond, msg) {
  checagens++
  if (!cond) {
    falhas++
    console.error(`✗ ${msg}`)
  }
  return cond
}

function png(w, h) {
  const linha = Buffer.alloc(1 + w * 4)
  for (let x = 0; x < w; x++) linha.set([0, 170, 90, 255], 1 + x * 4)
  const pedaco = (tipo, dados) => {
    const t = Buffer.from(tipo, 'latin1')
    const tam = Buffer.alloc(4)
    tam.writeUInt32BE(dados.length)
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc32(Buffer.concat([t, dados])) >>> 0)
    return Buffer.concat([tam, t, dados, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pedaco('IHDR', ihdr), pedaco('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => linha)))), pedaco('IEND', Buffer.alloc(0))])
}

// Duas rodadas: "moderno" (o ramo Require, de mod_authz_core) e "compatível" (o ramo Order/Deny, que um servidor sem
// Require usaria: os .htaccess da cópia ficam só com ele, e quem lê é o mod_access_compat). Cada uma num Apache e
// numa cópia própria.
async function portaLivre() {
  return new Promise((res) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => res(p))
    })
  })
}

async function rodada(modo, porta) {
  const antes = falhas
  const okm = (cond, msg) => ok(cond, `[${modo}] ${msg}`)
  const tmp = mkdtempSync(join(tmpdir(), 'gc-apache-'))
  chmodSync(tmp, 0o755)
  const www = join(tmp, 'www')
  const site = join(www, 'greencheese')
  mkdirSync(www, { recursive: true })
  cpSync(build, site, { recursive: true })
  // código de instalação de verdade (o de desenvolvimento não vale fora do dev)
  const saida = execFileSync('php', [join(raiz, 'scripts', 'codigo-instalacao.php'), join(site, 'api', 'instalacao.php')], { encoding: 'utf8' })
  const codigo = /^\s+([a-z2-9]{5}(?:-[a-z2-9]{5}){3})$/m.exec(saida)?.[1]
  const root = process.getuid?.() === 0
  if (modo !== 'moderno') {
    // só o ramo <IfModule !mod_authz_core.c>, sem o IfModule em volta
    const htaccess = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? htaccess(join(dir, e.name)) : e.name === '.htaccess' ? [join(dir, e.name)] : []))
    for (const f of htaccess(site)) {
      const txt = readFileSync(f, 'utf8')
        .replace(/<IfModule mod_authz_core\.c>[\s\S]*?\n<\/IfModule>\n?/g, '')
        .replace(/<IfModule !mod_authz_core\.c>\n([\s\S]*?)\n<\/IfModule>/g, '$1')
      writeFileSync(f, txt)
      if (/Require /.test(txt)) okm(false, `${f}: sobrou Require no modo compatível`)
    }
  }
  if (root) execFileSync('chown', ['-R', 'www-data:www-data', join(site, 'api', 'privado'), join(site, 'uploads')])

  const moderno = modo === 'moderno'
  const conf = join(tmp, 'httpd.conf')
  const mod = (n) => `LoadModule ${n}_module ${modulos}/mod_${n}.so`
  const negar = moderno ? 'Require all denied' : 'Order deny,allow\n  Deny from all'
  const liberar = moderno ? 'Require all granted' : 'Order allow,deny\n  Allow from all'
  writeFileSync(conf, `
ServerRoot "${tmp}"
ServerName 127.0.0.1
Listen 127.0.0.1:${porta}
PidFile "${tmp}/httpd.pid"
ErrorLog "${tmp}/error.log"
LogLevel warn
${mod('mpm_prefork')}
${mod('authz_core')}
${mod('authz_host')}
${mod('access_compat')}
${mod('dir')}
${mod('mime')}
${mod('headers')}
${mod('expires')}
${mod('env')}
LoadModule php_module ${modulos}/${modPhp}
${root ? 'User www-data\nGroup www-data' : ''}
TypesConfig /etc/mime.types
StartServers 3
MinSpareServers 3
MaxSpareServers 6
MaxRequestWorkers 12
DocumentRoot "${www}"
<Directory />
  AllowOverride None
  ${negar}
</Directory>
<Directory "${www}">
  Options FollowSymLinks
  AllowOverride All
  ${liberar}
</Directory>
<FilesMatch ".+\\.ph(?:ar|p|tml)$">
  SetHandler application/x-httpd-php
</FilesMatch>
DirectoryIndex index.html
php_admin_value display_errors 0
php_admin_value upload_max_filesize 16M
php_admin_value post_max_size 20M
`)

  const apache = spawn(APACHE, ['-f', conf, '-DFOREGROUND'], { stdio: ['ignore', 'ignore', 'pipe'], detached: true })
  let erroApache = ''
  apache.stderr.on('data', (d) => (erroApache += d))
  const base = `http://127.0.0.1:${porta}/greencheese`
  const parar = () => {
    try {
      process.kill(-apache.pid, 'SIGTERM')
    } catch {
      /* já saiu */
    }
  }
  process.on('exit', parar)
  let pronto = false
  for (let i = 0; i < 80 && !pronto; i++) {
    pronto = await fetch(`${base}/`).then(() => true, () => false)
    if (!pronto) await new Promise((r) => setTimeout(r, 100))
  }
  if (!pronto) {
    ok(false, `[${modo}] o Apache não subiu: ${erroApache}${existsSync(join(tmp, 'error.log')) ? readFileSync(join(tmp, 'error.log'), 'utf8') : ''}`)
    return
  }
  try {
    const home = await fetch(`${base}/`)
    okm(home.status === 200 && (await home.clone().text()).includes('<div id="raiz"'), 'o site abre')
    okm(/default-src 'self'/.test(home.headers.get('content-security-policy') ?? ''), 'o .htaccess do site vale (CSP)')

    // painel do dono em /greencheese/painel/: abre, fora dos buscadores, sem cache, com a CSP do site e os arquivos
    // achados por caminho relativo (como na Hostinger, numa subpasta)
    const painel = await fetch(`${base}/painel/`)
    const htmlPainel = await painel.text()
    okm(painel.status === 200 && htmlPainel.includes('<div id="painel"'), `o painel abre em /greencheese/painel/ (${painel.status})`)
    okm(/noindex/.test(painel.headers.get('x-robots-tag') ?? ''), `painel com X-Robots-Tag noindex (${painel.headers.get('x-robots-tag')})`)
    okm(/no-store/.test(painel.headers.get('cache-control') ?? ''), `HTML do painel sem cache (${painel.headers.get('cache-control')})`)
    okm(/default-src 'self'/.test(painel.headers.get('content-security-policy') ?? ''), 'a CSP do site vale no painel')
    const refsPainel = [...htmlPainel.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
    for (const r of refsPainel) {
      const u = new URL(r, `${base}/painel/`)
      const res = await fetch(u)
      okm(res.status === 200, `painel: ${r} → ${res.status}`)
    }

    const api = await fetch(`${base}/api/index.php?r=rateios`)
    okm(api.status === 200 && (await api.json()).ok === true, 'a API responde pelo Apache')
    const cab = ['x-content-type-options', 'cache-control', 'referrer-policy', 'content-security-policy', 'content-type'].map((k) => api.headers.get(k))
    okm(JSON.stringify(cab) === JSON.stringify(['nosniff', 'no-store, max-age=0', 'same-origin', "default-src 'none'; frame-ancestors 'none'", 'application/json; charset=utf-8']), `cabeçalhos da API, sem nada em dobro: ${JSON.stringify(cab)}`)
    okm(existsSync(join(site, 'api', 'privado', 'loja.sqlite')), 'o banco nasceu em api/privado/ (sem GC_DADOS, como no ar)')
    const semLoja = await fetch(`${base}/api/index.php?r=loja`)
    okm(semLoja.status === 404 && (await semLoja.json()).erro === 'sem-loja', `antes de instalar, GET loja: 404 sem-loja (${semLoja.status})`)

    // instala com o código de verdade, pela web
    const inst = await fetch(`${base}/api/index.php?r=admin-instalar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${porta}` },
      body: JSON.stringify({ codigo, login: 'dono', nome: 'Dono', senha: 'senha-forte-123' }),
    })
    const ij = await inst.json()
    okm(inst.status === 201, `instala com o código gerado (${inst.status} ${ij.erro ?? ''})`)
    const ck = inst.headers.getSetCookie().find((c) => c.startsWith('gc_painel=')) ?? ''
    okm(/path=\/greencheese\//i.test(ck), `cookie no caminho do site (${ck.split(';').slice(1).join(';')})`)
    const cookie = ck.split(';')[0]
    const csrf = ij.csrf

    // a loja (semeada na instalação) pelo Apache: no-cache + ETag, e 304 sem corpo quando nada mudou
    const lj = await fetch(`${base}/api/index.php?r=loja`)
    const ljj = await lj.json()
    okm(lj.status === 200 && ljj.ok === true && ljj.loja?.produtos?.length > 0, `GET loja pelo Apache (${lj.status}, ${ljj.loja?.produtos?.length} produtos)`)
    const cabLoja = ['x-content-type-options', 'cache-control', 'referrer-policy', 'content-security-policy', 'content-type'].map((k) => lj.headers.get(k))
    okm(JSON.stringify(cabLoja) === JSON.stringify(['nosniff', 'no-cache', 'same-origin', "default-src 'none'; frame-ancestors 'none'", 'application/json; charset=utf-8']), `cabeçalhos do GET loja (no-cache), sem nada em dobro: ${JSON.stringify(cabLoja)}`)
    const etag = lj.headers.get('etag') ?? ''
    okm(/^(W\/)?"[0-9a-f]{32}(-gzip)?"$/.test(etag), `GET loja com ETag (${etag})`)
    const l304 = await fetch(`${base}/api/index.php?r=loja`, { headers: { 'If-None-Match': etag } })
    okm(l304.status === 304 && (await l304.text()) === '', `If-None-Match igual: 304 sem corpo (${l304.status})`)
    const l200 = await fetch(`${base}/api/index.php?r=loja`, { headers: { 'If-None-Match': '"00000000000000000000000000000000"' } })
    okm(l200.status === 200 && (await l200.json()).ok === true, `If-None-Match diferente: 200 com a loja (${l200.status})`)
    const rt = await fetch(`${base}/api/index.php?r=rateios`)
    okm(rt.headers.get('cache-control') === 'no-store, max-age=0' && !rt.headers.get('etag'), `o resto da API segue no-store, sem ETag (${rt.headers.get('cache-control')})`)

    const fechados = [
      'api/privado/loja.sqlite', 'api/privado/loja.sqlite-wal', 'api/privado/loja.sqlite-shm', 'api/privado/erros.log', 'api/privado/', 'api/privado/index.html',
      'api/privado/.htaccess', 'api/nucleo/base.php', 'api/nucleo/', 'api/nucleo/.htaccess', 'api/instalacao.php', 'api/.htaccess', 'uploads/', 'uploads/.htaccess',
      // os módulos dos pedidos, dos avisos (que leem os segredos do gateway) e a lista das falas
      'api/nucleo/pedido.php', 'api/nucleo/avisos.php', 'api/nucleo/textos.php', 'api/nucleo/pedido-migracoes.php', 'api/nucleo/textos-pedido.json',
    ]
    for (const c of fechados) {
      const r = await fetch(`${base}/${c}`)
      const corpo = await r.text()
      okm(r.status === 403, `${c} → ${r.status} (esperado 403)`)
      okm(!corpo.includes('SQLite format') && !corpo.includes('$2y$') && !corpo.includes('<?php'), `${c} não vaza nada`)
    }

    // arquivos maliciosos plantados direto em uploads/ (como se o envio tivesse falhado em barrar)
    const plantados = {
      'gc-mal.php': '<?php echo "EXEC" . "UTOU";', 'gc-mal.phtml': '<?php echo "EXEC" . "UTOU";', 'gc-mal.phar': '<?php echo "EXEC" . "UTOU";',
      'gc-mal.php5': '<?php echo "EXEC" . "UTOU";', 'abcdefgh.php.png': '<?php echo "EXEC" . "UTOU";', 'abcdefgh.png.php': '<?php echo "EXEC" . "UTOU";',
      'gc-mal.html': '<script>alert(1)</script>', 'gc-mal.svg': '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', 'gc-mal.js': 'alert(1)',
      '.user.ini': 'auto_prepend_file=gc-mal.php',
    }
    for (const [n, c] of Object.entries(plantados)) writeFileSync(join(site, 'uploads', n), c)
    for (const n of Object.keys(plantados)) {
      const r = await fetch(`${base}/uploads/${n}`)
      const corpo = await r.text()
      okm(r.status === 403, `uploads/${n} → ${r.status} (esperado 403)`)
      okm(!corpo.includes('EXECUTOU'), `uploads/${n} não executa`)
    }

    // envio de imagem pelo Apache, e a imagem servida de uploads/
    const f = new FormData()
    f.append('imagem', new Blob([png(1800, 900)], { type: 'image/png' }), 'foto.png')
    const up = await fetch(`${base}/api/index.php?r=admin-upload`, { method: 'POST', headers: { Cookie: cookie, 'X-CSRF': csrf, Origin: `http://127.0.0.1:${porta}` }, body: f })
    const uj = await up.json()
    okm(up.status === 201 && /^uploads\/[0-9a-f]{24}\.(webp|png)$/.test(uj.imagem ?? ''), `envio de imagem pelo Apache (${up.status} ${uj.erro ?? uj.imagem})`)
    if (uj.imagem) {
      const img = await fetch(`${base}/${uj.imagem}`)
      okm(img.status === 200 && /^image\/(webp|png)$/.test(img.headers.get('content-type') ?? ''), `a imagem abre (${img.status} ${img.headers.get('content-type')})`)
      okm(img.headers.get('x-content-type-options') === 'nosniff' && img.headers.get('content-security-policy') === "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox", `imagem com nosniff e CSP sandbox, sem nada em dobro (${img.headers.get('content-security-policy')})`)
    }

    // o pedido do site pelo Apache (no toque do WhatsApp) e as falas do pedido guiado com ETag e 304
    const pedido = pedidoValido()
    const pp = await fetch(`${base}/api/index.php?r=pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${porta}` }, body: JSON.stringify(pedido) })
    const pj = await pp.json()
    okm(pp.status === 201 && pj.pedido?.codigo === pedido.codigo, `o pedido do site entra pelo Apache (${pp.status} ${pj.erro ?? pj.pedido?.codigo})`)
    const lp = await fetch(`${base}/api/index.php?r=admin-pedidos`, { headers: { Cookie: cookie } })
    okm((await lp.json()).pedidos?.[0]?.codigo === pedido.codigo, 'e aparece no painel')
    const ft = await fetch(`${base}/api/index.php?r=pedido-textos`)
    const fj = await ft.json()
    okm(ft.status === 200 && fj.ok === true && typeof fj.versao === 'string' && ft.headers.get('etag') === fj.versao, `falas do pedido com ETag (${ft.status} ${ft.headers.get('etag')})`)
    const f304 = await fetch(`${base}/api/index.php?r=pedido-textos`, { headers: { 'If-None-Match': fj.versao } })
    okm(f304.status === 304 && (await f304.text()) === '', `falas com a mesma versão: 304 sem corpo (${f304.status})`)

    // o diagnóstico do painel, pela web (o mesmo teste que o dono roda depois de publicar)
    const d = await fetch(`${base}/api/index.php?r=admin-diagnostico`, { headers: { Cookie: cookie } })
    const dj = await d.json()
    okm(d.status === 200 && dj.web?.testado === true, `diagnóstico testou pela web (${dj.web?.motivo ?? dj.erro})`)
    okm((dj.web?.itens ?? []).length >= 7 && dj.web.itens.every((i) => i.ok === true), `diagnóstico: tudo fechado ${JSON.stringify(dj.web?.itens)}`)
    okm(!readdirSync(join(site, 'uploads')).some((n) => n.startsWith('gc-sonda-')), 'a sonda do diagnóstico some')
  } catch (e) {
    okm(false, `exceção: ${e.stack}`)
  }
  parar()
  const log = existsSync(join(tmp, 'error.log')) ? readFileSync(join(tmp, 'error.log'), 'utf8') : ''
  const graves = log.split('\n').filter((l) => /\[(core|php):(error|crit|alert)\]|Invalid command/i.test(l) && !/client denied by server configuration/.test(l))
  okm(graves.length === 0, `erros no log do Apache: ${graves.join(' | ')}`)
  if (process.env.GC_TESTE_MANTER === '1') console.log(`[${modo}] Apache de teste em ${tmp}`)
  else rmSync(tmp, { recursive: true, force: true })
  console.log(`· ${modo}: ${falhas === antes ? 'tudo certo' : `${falhas - antes} problema(s)`}`)
}

const p1 = process.env.GC_TESTE_PORTA ? Number(process.env.GC_TESTE_PORTA) : await portaLivre()
await rodada('moderno', p1)
await rodada('compativel', process.env.GC_TESTE_PORTA ? p1 + 1 : await portaLivre())
console.log(falhas ? `${falhas} problema(s) em ${checagens} checagens` : `${checagens} checagens · htaccess ok`)
process.exit(falhas ? 1 : 0)
