// Publica dist/ em oprojeto.online/greencheese/ pelo gerenciador de arquivos da Hostinger (protocolo TUS).
// Só escreve dentro da pasta de destino: o resto do site do domínio não é tocado.
// Uso: HOSTINGER_UPLOAD_URL=… HOSTINGER_AUTH=… HOSTINGER_AUTH_REST=… node scripts/publicar.mjs [pasta-destino]
// (url e chaves saem de "Generate upload URL" da API da Hostinger; valem por pouco tempo e não vão para o repositório)
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
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

function enviar(arquivo) {
  const rel = relative(dist, arquivo).split('\\').join('/')
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
const todos = listar(dist).filter((f) => !so || so.includes(relative(dist, f).split('\\').join('/')))
const peso = (f) => (f.endsWith('.htaccess') ? 0 : f.endsWith('index.html') ? 2 : 1)
todos.sort((a, b) => peso(a) - peso(b))
for (const f of todos) enviar(f)
console.log(`publicado: ${todos.length} arquivos em /${destino}/`)
