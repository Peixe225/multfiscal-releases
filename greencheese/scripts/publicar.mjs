// Publica dist/ em oprojeto.online/greencheese/ pelo gerenciador de arquivos da Hostinger (protocolo TUS).
// Só escreve dentro da pasta de destino: o resto do site do domínio não é tocado.
// Uso: HOSTINGER_UPLOAD_URL=… HOSTINGER_AUTH=… HOSTINGER_AUTH_REST=… node scripts/publicar.mjs [pasta-destino]
// (url e chaves saem de "Generate upload URL" da API da Hostinger; valem por pouco tempo e não vão para o repositório)
// Ensaio sem rede: PUBLICAR_SECO=1 node scripts/publicar.mjs → lista o que subiria, na ordem, e o que fica de fora.
// PUBLICAR_DIST=<pasta> troca a pasta do build (padrão: dist/).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const seco = process.env.PUBLICAR_SECO === '1'
const { HOSTINGER_UPLOAD_URL: url, HOSTINGER_AUTH: auth, HOSTINGER_AUTH_REST: authRest } = process.env
if (!seco && (!url || !auth || !authRest)) {
  console.error('faltam HOSTINGER_UPLOAD_URL, HOSTINGER_AUTH e HOSTINGER_AUTH_REST (ou PUBLICAR_SECO=1 para só listar)')
  process.exit(1)
}
const destino = (process.argv[2] ?? 'greencheese').replace(/^\/+|\/+$/g, '')
const dist = process.env.PUBLICAR_DIST ? resolve(process.env.PUBLICAR_DIST) : fileURLToPath(new URL('../dist/', import.meta.url))

function listar(dir) {
  return readdirSync(dir).flatMap((n) => {
    const c = join(dir, n)
    return statSync(c).isDirectory() ? listar(c) : [c]
  })
}

const rel = (f) => relative(dist, f).split('\\').join('/')

// Código de instalação: com o hash de desenvolvimento ("// DEV"), qualquer um que leu o repositório instalaria o
// painel no ar. Gere o de verdade antes: php scripts/codigo-instalacao.php && npm run build.
const instalacao = join(dist, 'api', 'instalacao.php')
if (existsSync(instalacao) && /^\/\/ DEV/m.test(readFileSync(instalacao, 'utf8'))) {
  console.error('recusado: dist/api/instalacao.php ainda tem o hash de desenvolvimento.')
  console.error('rode "php scripts/codigo-instalacao.php", depois "npm run build", e publique de novo.')
  process.exit(1)
}

// O que nunca sobe: dados do servidor (banco, log) e envios do painel. De api/privado/ só o .htaccess e o index.html
// vazio; de uploads/, só o .htaccess. Banco, diário do SQLite e log também não sobem de nenhuma outra pasta.
function foraDaPublicacao(r) {
  if (r.startsWith('api/privado/')) return !['api/privado/.htaccess', 'api/privado/index.html'].includes(r)
  if (r.startsWith('uploads/')) return r !== 'uploads/.htaccess'
  return /\.(sqlite|sqlite-wal|sqlite-shm|sqlite-journal|db|log)(\.\d+)?$/i.test(r) || /(^|\/)\.envio-/.test(r)
}

// Ordem: .htaccess de todas as pastas primeiro (nada fica aberto nem um instante), depois a API (módulos antes do
// index.php), os assets, o resto, o painel e, por último, os index.html (nunca fica um index apontando para
// arquivo que ainda não subiu; o do site é o último de todos).
function peso(r) {
  if (r.endsWith('.htaccess')) return 0
  if (r.startsWith('api/')) return r === 'api/index.php' ? 2 : 1
  if (r.startsWith('assets/')) return 3
  if (r.startsWith('painel/')) return r.endsWith('index.html') ? 6 : 5
  if (r === 'index.html') return 8
  if (r.endsWith('index.html')) return 7
  return 4
}

// SO=".htaccess,index.html" → sobe só esses (caminhos relativos a dist/)
const so = process.env.SO?.split(',').map((s) => s.trim()).filter(Boolean)
const tudo = listar(dist).map(rel)
const fora = tudo.filter(foraDaPublicacao)
const todos = tudo.filter((r) => !foraDaPublicacao(r) && (!so || so.includes(r)))
todos.sort((a, b) => peso(a) - peso(b) || (a < b ? -1 : a > b ? 1 : 0))

function curl(args) {
  return execFileSync('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '--retry', '3', ...args], { encoding: 'utf8' }).trim()
}

function enviar(arquivo, caminho) {
  const tam = statSync(arquivo).size
  if (seco) {
    console.log(`subiria ${destino}/${caminho} (${tam} B)`)
    return
  }
  const alvo = `${url.replace(/\/+$/, '')}/${destino}/${caminho.split('/').map(encodeURIComponent).join('/')}?override=true`
  const cab = ['-H', `X-Auth: ${auth}`, '-H', `X-Auth-Rest: ${authRest}`, '-H', 'Tus-Resumable: 1.0.0']
  const criar = curl(['-X', 'POST', alvo, ...cab, '-H', `Upload-Length: ${tam}`, '-H', 'Upload-Offset: 0'])
  if (criar !== '201') throw new Error(`${caminho}: criar → ${criar}`)
  const mandar = curl(['-X', 'PATCH', alvo, ...cab, '-H', 'Content-Type: application/offset+octet-stream', '-H', 'Upload-Offset: 0', '--data-binary', `@${arquivo}`])
  if (mandar !== '204') throw new Error(`${caminho}: enviar → ${mandar}`)
  console.log(`✓ ${destino}/${caminho} (${tam} B)`)
}

for (const r of todos) enviar(join(dist, r), r)

// Atalhos da Home 2 com maiúscula (Home2/, HOME2/): o servidor diferencia maiúsculas, mas no repositório (e no zip)
// pastas que só mudam a caixa colidem no Windows e no macOS. Então só existe dist/home2/; as outras duas sobem daqui,
// com o mesmo HTML apontando para o script de lá.
let extras = 0
const atalho = join(dist, 'home2', 'index.html')
if (existsSync(atalho) && (!so || so.includes('home2/index.html'))) {
  const html = readFileSync(atalho, 'utf8').replace('src="ir.js"', 'src="../home2/ir.js"')
  const pastaTmp = mkdtempSync(join(tmpdir(), 'gc-atalho-'))
  const tmp = join(pastaTmp, 'index.html')
  writeFileSync(tmp, html)
  try {
    for (const pasta of ['Home2', 'HOME2']) {
      enviar(tmp, `${pasta}/index.html`)
      extras++
    }
  } finally {
    rmSync(pastaTmp, { recursive: true, force: true })
  }
}
for (const r of fora) console.log(`fica fora: ${r}`)
console.log(`${seco ? 'ensaio (nada subiu)' : 'publicado'}: ${todos.length + extras} arquivos em /${destino}/${fora.length ? ` · ${fora.length} de fora` : ''}`)
