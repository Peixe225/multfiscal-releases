// LENDA v3.5 · suíte mobile (ferramenta) — servidor HTTP/2 (TLS) parecido com a Hostinger (hcdn): brotli/gzip nos textos,
// cache como o .htaccess do build, e /lenda/api/*.php repassado ao php -S da pilha local. Serve para medir a abertura no
// 4G lento na pilha local com números comparáveis aos da produção (o php -S não comprime nem manda cabeçalho de cache).
//   node servidor/teste/mobile/ferramentas/servidor-h2.mjs <docroot (o public_html da pilha)> <porta> <porta do php -S> [arquivo-spki]
// O certificado é autoassinado (gerado com o openssl numa pasta temporária). O hash SPKI dele (base64 do SHA-256) vai para
// o [arquivo-spki]: com LENDA_TLS_SPKI=<hash>, o Chromium dos testes abre com --ignore-certificate-errors-spki-list e trata o
// certificado como válido — só o LENDA_IGNORAR_TLS=1 (ignoreHTTPSErrors) não basta para medir a 2ª visita, porque o
// Chromium não guarda no cache HTTP nada de uma origem com erro de certificado (a "2ª visita" baixava tudo de novo).
// O rodar.sh usa na área "carga".
import { execFileSync } from 'node:child_process'
import { createHash, createPublicKey } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import http2 from 'node:http2'
import http from 'node:http'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const [docroot, porta, portaPhp, arqSpki] = process.argv.slice(2)
const aqui = mkdtempSync(join(tmpdir(), 'lenda-h2-'))
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(aqui, 'chave.pem'), '-out', join(aqui, 'cert.pem'), '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
const spki = createHash('sha256')
  .update(createPublicKey(readFileSync(join(aqui, 'cert.pem'))).export({ type: 'spki', format: 'der' }))
  .digest('base64')
if (arqSpki) writeFileSync(arqSpki, spki)
void dirname
void fileURLToPath
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml' }
const TEXTO = /^(text\/|application\/(json|manifest\+json|xml)|image\/svg)/
const cache = new Map()
function comprimido(arq, enc) {
  const k = `${arq}|${enc}`
  if (!cache.has(k) || /\.html$/.test(arq)) {
    const b = readFileSync(arq)
    cache.set(k, enc === 'br' ? zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }) : enc === 'gzip' ? zlib.gzipSync(b, { level: 9 }) : b)
  }
  return cache.get(k)
}
const log = []
const chave = readFileSync(join(aqui, 'chave.pem'))
const certificado = readFileSync(join(aqui, 'cert.pem'))
rmSync(aqui, { recursive: true, force: true }) // a chave fica só na memória deste processo (nada sobra na pasta temporária)
const srv = http2.createSecureServer({ key: chave, cert: certificado, allowHTTP1: true }, (req, res) => {
  const url = new URL(req.url, 'https://x')
  if (/^\/lenda\/api\/.+\.php$/.test(url.pathname)) {
    // repassa ao php -S
    const cab = { ...req.headers }
    for (const k of Object.keys(cab)) if (k.startsWith(':')) delete cab[k]
    cab.host = `127.0.0.1:${portaPhp}`
    const p = http.request({ host: '127.0.0.1', port: portaPhp, method: req.method, path: req.url, headers: cab }, (r) => {
      const h = { ...r.headers }
      for (const k of ['connection', 'transfer-encoding', 'keep-alive']) delete h[k]
      res.writeHead(r.statusCode, h)
      r.pipe(res)
    })
    p.on('error', () => {
      res.writeHead(502)
      res.end()
    })
    req.pipe(p)
    return
  }
  let arq = join(docroot, decodeURIComponent(url.pathname))
  if (existsSync(arq) && statSync(arq).isDirectory()) arq = join(arq, 'index.html')
  if (!existsSync(arq)) {
    res.writeHead(404, { 'content-type': 'text/html' })
    res.end('404')
    return
  }
  const tipo = TIPOS[extname(arq)] ?? 'application/octet-stream'
  const ae = String(req.headers['accept-encoding'] ?? '')
  const enc = TEXTO.test(tipo) ? (/\bbr\b/.test(ae) ? 'br' : /gzip/.test(ae) ? 'gzip' : '') : ''
  const corpo = comprimido(arq, enc)
  const h = { 'content-type': tipo, 'content-length': corpo.length, 'x-content-type-options': 'nosniff', vary: 'Accept-Encoding' }
  if (enc) h['content-encoding'] = enc
  h['cache-control'] = /\.html?$/.test(arq) ? 'no-cache' : /\/assets\//.test(arq) ? 'public, max-age=31536000, immutable' : 'public, max-age=2592000'
  res.writeHead(200, h)
  res.end(corpo)
})
srv.listen(Number(porta), '127.0.0.1', () => console.log(`h2 em https://127.0.0.1:${porta}/ (docroot ${docroot}, php ${portaPhp})`))
