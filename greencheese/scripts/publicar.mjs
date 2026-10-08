// Publica dist/ em oprojeto.online/greencheese/ pelo gerenciador de arquivos da Hostinger (protocolo TUS).
// Só escreve dentro da pasta de destino: o resto do site do domínio não é tocado.
// Uso: HOSTINGER_UPLOAD_URL=… HOSTINGER_AUTH=… HOSTINGER_AUTH_REST=… node scripts/publicar.mjs [pasta-destino]
// (url e chaves saem de "Generate upload URL" da API da Hostinger; valem por pouco tempo e não vão para o repositório)
// Rateio: sem o servidor da loja (a pasta api/ da frente F8), o site no ar mostraria os rateios de EXEMPLO (preços
// inventados, sem carimbo) pra todo visitante, com "Entrar pelo WhatsApp" pro WhatsApp de verdade da loja. Então só
// publica com dist/api/ (ou com a api/ já respondendo no destino); RATEIO_SEM_API=1 publica assim mesmo, de propósito.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const { HOSTINGER_UPLOAD_URL: url, HOSTINGER_AUTH: auth, HOSTINGER_AUTH_REST: authRest } = process.env
if (!url || !auth || !authRest) {
  console.error('faltam HOSTINGER_UPLOAD_URL, HOSTINGER_AUTH e HOSTINGER_AUTH_REST')
  process.exit(1)
}
const destino = (process.argv[2] ?? 'greencheese').replace(/^\/+|\/+$/g, '')
const dist = new URL('../dist/', import.meta.url).pathname

function listar(dir) {
  return readdirSync(dir).flatMap((n) => {
    const c = join(dir, n)
    return statSync(c).isDirectory() ? listar(c) : [c]
  })
}

function curl(args) {
  return execFileSync('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '--retry', '3', ...args], { encoding: 'utf8' }).trim()
}

function enviar(arquivo, rel = relative(dist, arquivo).split('\\').join('/')) {
  const alvo = `${url.replace(/\/+$/, '')}/${destino}/${rel.split('/').map(encodeURIComponent).join('/')}?override=true`
  const tam = statSync(arquivo).size
  const cab = ['-H', `X-Auth: ${auth}`, '-H', `X-Auth-Rest: ${authRest}`, '-H', 'Tus-Resumable: 1.0.0']
  const criar = curl(['-X', 'POST', alvo, ...cab, '-H', `Upload-Length: ${tam}`, '-H', 'Upload-Offset: 0'])
  if (criar !== '201') throw new Error(`${rel}: criar → ${criar}`)
  const mandar = curl(['-X', 'PATCH', alvo, ...cab, '-H', 'Content-Type: application/offset+octet-stream', '-H', 'Upload-Offset: 0', '--data-binary', `@${arquivo}`])
  if (mandar !== '204') throw new Error(`${rel}: enviar → ${mandar}`)
  console.log(`✓ ${destino}/${rel} (${tam} B)`)
}

// .htaccess primeiro, assets depois, index.html por último: nunca fica um index apontando para arquivo que ainda não subiu
// SO=".htaccess,index.html" → sobe só esses (caminhos relativos a dist/)
const so = process.env.SO?.split(',').map((s) => s.trim()).filter(Boolean)

// rateio sem servidor no ar = exemplos inventados pra todo mundo (ver o topo)
if ((!so || so.includes('index.html')) && process.env.RATEIO_SEM_API !== '1' && /dadosDeExemplo:\s*true/.test(readFileSync(new URL('../src/dados/config.ts', import.meta.url), 'utf8'))) {
  let temApi = existsSync(join(dist, 'api', 'index.php'))
  if (!temApi) {
    const site = process.env.SITE_URL ?? `https://oprojeto.online/${destino}/`
    try {
      const r = await fetch(new URL('api/index.php?r=rateios', site), { signal: AbortSignal.timeout(10000) })
      temApi = (r.headers.get('content-type') ?? '').includes('json') && (await r.json())?.ok === true
    } catch {
      temApi = false
    }
  }
  if (!temApi) {
    console.error('sem a api/ do servidor (dist/api/index.php) e sem ela respondendo no destino: o rateio no ar mostraria os rateios de exemplo, com preços inventados, pra todo mundo.')
    console.error('publica junto com a frente F8 (servidor), ou RATEIO_SEM_API=1 pra publicar assim mesmo.')
    process.exit(1)
  }
}

const todos = listar(dist).filter((f) => !so || so.includes(relative(dist, f).split('\\').join('/')))
const peso = (f) => (f.endsWith('.htaccess') ? 0 : f.endsWith('index.html') ? 2 : 1)
todos.sort((a, b) => peso(a) - peso(b))
for (const f of todos) enviar(f)

// Atalhos da Home 2 com maiúscula (Home2/, HOME2/): o servidor diferencia maiúsculas, mas no repositório (e no zip)
// pastas que só mudam a caixa colidem no Windows e no macOS. Então só existe dist/home2/; as outras duas sobem daqui,
// com o mesmo HTML apontando para o script de lá.
let extras = 0
const atalho = join(dist, 'home2', 'index.html')
if (!so || so.includes('home2/index.html')) {
  const html = readFileSync(atalho, 'utf8').replace('src="ir.js"', 'src="../home2/ir.js"')
  const tmp = join(mkdtempSync(join(tmpdir(), 'gc-atalho-')), 'index.html')
  writeFileSync(tmp, html)
  for (const pasta of ['Home2', 'HOME2']) {
    enviar(tmp, `${pasta}/index.html`)
    extras++
  }
}
console.log(`publicado: ${todos.length + extras} arquivos em /${destino}/`)
