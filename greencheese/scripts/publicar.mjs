// Publica dist/ em oprojeto.online/greencheese/ pelo gerenciador de arquivos da Hostinger (protocolo TUS).
// Só escreve dentro da pasta de destino: o resto do site do domínio não é tocado.
// Uso: HOSTINGER_UPLOAD_URL=… HOSTINGER_AUTH=… HOSTINGER_AUTH_REST=… node scripts/publicar.mjs [pasta-destino]
// (url e chaves saem de "Generate upload URL" da API da Hostinger; valem por pouco tempo e não vão para o repositório)
// Ensaio sem rede: PUBLICAR_SECO=1 node scripts/publicar.mjs → lista o que subiria, na ordem, e o que fica de fora.
// PUBLICAR_DIST=<pasta> troca a pasta do build (padrão: dist/). Pra publicar à mão (hPanel): scripts/empacotar.mjs.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { foraDaPublicacao, instalacaoDeDev, listar, ordenar, relativo } from './publicacao.mjs'

const seco = process.env.PUBLICAR_SECO === '1'
const { HOSTINGER_UPLOAD_URL: url, HOSTINGER_AUTH: auth, HOSTINGER_AUTH_REST: authRest } = process.env
if (!seco && (!url || !auth || !authRest)) {
  console.error('faltam HOSTINGER_UPLOAD_URL, HOSTINGER_AUTH e HOSTINGER_AUTH_REST (ou PUBLICAR_SECO=1 para só listar)')
  process.exit(1)
}
const destino = (process.argv[2] ?? 'greencheese').replace(/^\/+|\/+$/g, '')
const dist = process.env.PUBLICAR_DIST ? resolve(process.env.PUBLICAR_DIST) : fileURLToPath(new URL('../dist/', import.meta.url))

// Código de instalação: com o de desenvolvimento, qualquer um que leu o repositório instalaria o painel no ar. Confere
// a marca "// DEV" e o próprio hash (publicacao.mjs). Gere o de verdade antes: php scripts/codigo-instalacao.php &&
// npm run build.
const dev = instalacaoDeDev(dist)
if (dev) {
  console.error(`recusado: o api/instalacao.php do build ${dev}.`)
  console.error('rode "php scripts/codigo-instalacao.php", depois "npm run build", e publique de novo.')
  process.exit(1)
}

// SO=".htaccess,index.html" → sobe só esses (caminhos relativos a dist/)
const so = process.env.SO?.split(',').map((s) => s.trim()).filter(Boolean)
const tudo = listar(dist).map((f) => relativo(dist, f))
const fora = tudo.filter(foraDaPublicacao)
const todos = ordenar(tudo.filter((r) => !foraDaPublicacao(r) && (!so || so.includes(r))))

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
