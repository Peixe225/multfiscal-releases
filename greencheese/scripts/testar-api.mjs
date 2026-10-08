// Testes da API (PHP + SQLite), sem dependência nova: php -l em todos os .php, o código de instalação, o ensaio do
// publicar.mjs e, num php -S com pasta de dados temporária, o contrato do API.md e o painel inteiro: instalar, entrar
// (limite, cookie), CSRF e Origin, rateios (criar, editar, status, apagar, tabaco/vape), entrar no rateio (cada erro),
// CONCORRÊNCIA (30 entradas juntas em 10 vagas → exatamente 10), vencimento da reserva (relógio de teste),
// confirmar → contador → fecha sozinho, minhas vagas, CSV, envio de imagem e o que tem que ficar fechado.
// Uso: node scripts/testar-api.mjs   (termina com "api ok")
// GC_TESTE_PORTA escolhe a porta (padrão: uma livre); PHP=/caminho/do/php troca o binário; GC_TESTE_MANTER=1 guarda a
// pasta temporária (banco, log, envios) pra olhar depois.
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'

const raiz = fileURLToPath(new URL('..', import.meta.url))
const PHP = process.env.PHP ?? 'php'
const api = join(raiz, 'public', 'api')
let falhas = 0
let checagens = 0
let secao = ''

function ok(cond, msg) {
  checagens++
  if (!cond) {
    falhas++
    console.error(`✗ [${secao}] ${msg}`)
  }
  return cond
}
function igual(veio, esperado, msg) {
  return ok(JSON.stringify(veio) === JSON.stringify(esperado), `${msg}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(veio)}`)
}
function erro(res, status, codigo, msg) {
  igual(res.status, status, `${msg} (status)`)
  igual(res.json?.erro, codigo, `${msg} (erro)`)
  ok(res.json?.ok === false && typeof res.json?.mensagem === 'string' && res.json.mensagem.length > 0, `${msg} (mensagem)`)
}
function parte(nome) {
  secao = nome
  console.log(`· ${nome}`)
}

function arquivosPhp(dir) {
  return readdirSync(dir).flatMap((n) => {
    const c = join(dir, n)
    return statSync(c).isDirectory() ? arquivosPhp(c) : n.endsWith('.php') ? [c] : []
  })
}

async function portaLivre() {
  if (process.env.GC_TESTE_PORTA) return Number(process.env.GC_TESTE_PORTA)
  return new Promise((res) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => res(p))
    })
  })
}

// php -S com workers: o grupo inteiro sai junto (no PHP 8.1, matar só o pai deixa os workers vivos na porta)
const servidores = []
function derrubar(filho) {
  try {
    process.kill(-filho.pid, 'SIGTERM')
  } catch {
    /* já saiu */
  }
}
process.on('exit', () => servidores.forEach(derrubar))

async function subirPhp(porta, env, args) {
  // porta ocupada (um servidor velho) daria falso positivo: confere antes
  const ocupada = await fetch(`http://127.0.0.1:${porta}/`).then(() => true, () => false)
  if (ocupada) throw new Error(`a porta ${porta} já está em uso`)
  const filho = spawn(PHP, ['-d', 'display_errors=0', '-d', 'upload_max_filesize=16M', '-d', 'post_max_size=20M', '-S', `127.0.0.1:${porta}`, ...args], {
    env: { ...process.env, PHP_CLI_SERVER_WORKERS: '8', ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  })
  servidores.push(filho)
  let saida = ''
  filho.stderr.on('data', (d) => (saida += d))
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/api/index.php?r=admin-sessao`)
      if (r.status > 0) return filho
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  derrubar(filho)
  throw new Error(`php -S não subiu na porta ${porta}: ${saida.slice(-500)}`)
}

// PNG de verdade, feito aqui (sem dependência): w×h de uma cor só, com alfa
function png(w, h, cor = [0, 170, 90, 255]) {
  const linha = Buffer.alloc(1 + w * 4)
  for (let x = 0; x < w; x++) linha.set(cor, 1 + x * 4)
  const cru = Buffer.concat(Array.from({ length: h }, () => linha))
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
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pedaco('IHDR', ihdr), pedaco('IDAT', deflateSync(cru)), pedaco('IEND', Buffer.alloc(0))])
}

// GD com WebP? (sem WebP o servidor recodifica no formato original; sem GD, guarda o original conferido)
const temGd = execFileSync(PHP, ['-r', 'echo extension_loaded("gd") ? 1 : 0;'], { encoding: 'utf8' }) === '1'
const temWebp = temGd && execFileSync(PHP, ['-r', 'echo function_exists("imagewebp") && (imagetypes() & IMG_WEBP) ? 1 : 0;'], { encoding: 'utf8' }) === '1'

const CHAVES_RATEIO = [
  'aceitaEntradas', 'atualizadoEm', 'chegouEm', 'confirmadas', 'demo', 'descricao', 'disponiveis', 'fechaEm', 'fechadoEm', 'id', 'imagem',
  'limitePorPessoa', 'pedidoEm', 'precoDepois', 'precoRateio', 'previsaoMax', 'previsaoMin', 'produtoId', 'reservaHoras', 'reservadas',
  'status', 'titulo', 'ufs', 'vagas',
]
const CHAVES_PARTICIPACAO = ['codigo', 'confirmadoEm', 'criadoEm', 'expiraEm', 'quantidade', 'rateio', 'rateioStatus', 'status', 'titulo', 'token', 'total']
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const chaves = (o) => Object.keys(o ?? {}).sort()

// ─── sem servidor ───────────────────────────────────────────────────────────────────────────────────────────────

parte('php -l')
const todosPhp = [...arquivosPhp(api), ...arquivosPhp(join(raiz, 'scripts'))]
for (const f of todosPhp) {
  try {
    execFileSync(PHP, ['-l', f], { stdio: 'pipe' })
    ok(true, f)
  } catch (e) {
    ok(false, `php -l ${f}: ${e.stdout ?? e.message}`)
  }
}
ok(todosPhp.length >= 13, `achou os .php (${todosPhp.length})`)

parte('guarda dos módulos')
for (const f of [...arquivosPhp(join(api, 'nucleo')), join(api, 'instalacao.php')]) {
  const txt = readFileSync(f, 'utf8')
  ok(/^<\?php\n(declare\(strict_types=1\);\n)?(\/\/[^\n]*\n)*defined\('GC_API'\) \|\| exit;/.test(txt), `${f.slice(raiz.length)} começa com a guarda`)
  const saida = execFileSync(PHP, [f], { encoding: 'utf8' })
  igual(saida, '', `${f.slice(raiz.length)} rodado direto não faz nada`)
}

const tmp = mkdtempSync(join(tmpdir(), 'gc-api-'))
const dados = join(tmp, 'dados')
const uploads = join(tmp, 'uploads')
const instalacaoTeste = join(tmp, 'instalacao.php')
writeFileSync(instalacaoTeste, readFileSync(join(api, 'instalacao.php')))

parte('código de instalação')
const gerado = join(tmp, 'gerado.php')
const saidaCodigo = execFileSync(PHP, [join(raiz, 'scripts', 'codigo-instalacao.php'), gerado], { encoding: 'utf8' })
const codigoNovo = /^\s+([a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5})$/m.exec(saidaCodigo)?.[1]
ok(codigoNovo && !/[01ilo]/.test(codigoNovo.replaceAll('-', '')), `código legível sem ambíguos (${codigoNovo})`)
const txtGerado = readFileSync(gerado, 'utf8')
ok(!/^\/\/ DEV/m.test(txtGerado) && !txtGerado.includes(codigoNovo ?? '#'), 'o arquivo gerado tem só o hash, sem marca de DEV')
const confere = execFileSync(PHP, ['-r', `define('GC_API', 1); echo password_verify($argv[1], require $argv[2]) ? 'sim' : 'nao';`, (codigoNovo ?? '').replaceAll('-', ''), gerado], { encoding: 'utf8' })
igual(confere, 'sim', 'o hash gravado confere com o código mostrado')
ok(/^\/\/ DEV/m.test(readFileSync(join(api, 'instalacao.php'), 'utf8')), 'o instalacao.php do projeto é o de desenvolvimento (// DEV)')

parte('publicar (ensaio)')
{
  const falso = join(tmp, 'dist-falso')
  const arquivos = {
    '.htaccess': 'x', 'index.html': 'x', 'favicon.svg': 'x', 'assets/a-1.js': 'x', 'assets/b-2.css': 'x', 'home2/index.html': 'x', 'home2/ir.js': 'x',
    'api/.htaccess': 'x', 'api/index.php': 'x', 'api/instalacao.php': readFileSync(join(api, 'instalacao.php'), 'utf8'), 'api/nucleo/.htaccess': 'x',
    'api/nucleo/base.php': 'x', 'api/privado/.htaccess': 'x', 'api/privado/index.html': 'x', 'api/privado/loja.sqlite': 'x',
    'api/privado/loja.sqlite-wal': 'x', 'api/privado/erros.log': 'x', 'uploads/.htaccess': 'x', 'uploads/abc12345.webp': 'x',
    'painel/index.html': 'x', 'painel/painel.js': 'x', 'outra/copia.sqlite': 'x',
  }
  for (const [r, c] of Object.entries(arquivos)) {
    mkdirSync(join(falso, r, '..'), { recursive: true })
    writeFileSync(join(falso, r), c)
  }
  const rodar = () => {
    try {
      return { codigo: 0, saida: execFileSync('node', [join(raiz, 'scripts', 'publicar.mjs')], { env: { ...process.env, PUBLICAR_SECO: '1', PUBLICAR_DIST: falso }, encoding: 'utf8', stdio: 'pipe' }) }
    } catch (e) {
      return { codigo: e.status, saida: `${e.stdout}${e.stderr}` }
    }
  }
  const recusa = rodar()
  ok(recusa.codigo === 1 && /hash de desenvolvimento/.test(recusa.saida) && !/subiria/.test(recusa.saida), 'recusa publicar com o hash de dev')
  writeFileSync(join(falso, 'api/instalacao.php'), txtGerado)
  const ensaio = rodar()
  igual(ensaio.codigo, 0, 'ensaio com o hash de verdade passa')
  const ordem = [...ensaio.saida.matchAll(/^subiria greencheese\/(\S+)/gm)].map((m) => m[1])
  const foraLista = [...ensaio.saida.matchAll(/^fica fora: (\S+)/gm)].map((m) => m[1]).sort()
  igual(foraLista, ['api/privado/erros.log', 'api/privado/loja.sqlite', 'api/privado/loja.sqlite-wal', 'outra/copia.sqlite', 'uploads/abc12345.webp'], 'banco, log e envios ficam de fora')
  const pos = (r) => ordem.indexOf(r)
  ok(ordem.slice(0, 5).every((r) => r.endsWith('.htaccess')) && ordem.filter((r) => r.endsWith('.htaccess')).length === 5, '.htaccess de todas as pastas primeiro')
  ok(pos('api/nucleo/base.php') < pos('api/index.php') && pos('api/index.php') < pos('assets/a-1.js'), 'api (módulos antes do index.php) antes dos assets')
  ok(pos('assets/b-2.css') < pos('painel/painel.js') && pos('painel/painel.js') < pos('painel/index.html'), 'assets antes do painel')
  igual(ordem.at(-3), 'index.html', 'index.html do site por último (antes só dos atalhos Home2/HOME2)')
  ok(ordem.includes('Home2/index.html') && ordem.includes('HOME2/index.html'), 'atalhos Home2/HOME2 continuam')
  ok(ordem.includes('api/privado/.htaccess') && ordem.includes('api/privado/index.html') && ordem.includes('uploads/.htaccess'), 'sobe as proteções das pastas de dados')
}

// ─── servidor de teste ──────────────────────────────────────────────────────────────────────────────────────────

const porta = await portaLivre()
const base = `http://127.0.0.1:${porta}`
const php = await subirPhp(porta, { GC_TESTE: '1', GC_DADOS: dados, GC_UPLOADS: uploads, GC_INSTALACAO: instalacaoTeste }, ['-t', join(raiz, 'public'), join(raiz, 'scripts', 'api-dev.php')])
let ipSeq = 0
const novoIp = () => `203.0.113.${(ipSeq++ % 250) + 1}.${ipSeq}`
const AGORA = Math.floor(Date.now() / 1000)

class Cliente {
  constructor(ip = novoIp()) {
    this.ip = ip
    this.cookie = null
    this.csrf = null
  }
  async req(rota, { metodo = 'GET', corpo, cab = {}, origem = base, query = '', agora, csrf } = {}) {
    const headers = { 'X-GC-IP': this.ip, ...cab }
    if (origem) headers.Origin = origem
    if (this.cookie) headers.Cookie = `gc_painel=${this.cookie}`
    const token = csrf === undefined ? this.csrf : csrf
    if (token && metodo === 'POST') headers['X-CSRF'] = token
    if (agora) headers['X-GC-Agora'] = String(agora)
    let body
    if (corpo instanceof FormData) body = corpo
    else if (corpo !== undefined) {
      body = typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
      headers['Content-Type'] ??= 'application/json'
    }
    const r = await fetch(`${base}/api/index.php?r=${rota}${query}`, { method: metodo, headers, body, redirect: 'manual' })
    const cookies = r.headers.getSetCookie()
    for (const c of cookies) {
      const m = /^gc_painel=([^;]*)/.exec(c)
      if (m) this.cookie = m[1] || null
    }
    const texto = await r.text()
    let json = null
    try {
      json = JSON.parse(texto)
    } catch {
      /* não é JSON (CSV) */
    }
    if (json?.csrf) this.csrf = json.csrf
    return { status: r.status, json, texto, headers: r.headers, cookies }
  }
  get(rota, opts = {}) {
    return this.req(rota, opts)
  }
  post(rota, corpo, opts = {}) {
    return this.req(rota, { metodo: 'POST', corpo, ...opts })
  }
}
const site = () => new Cliente()
const crua = (caminho) => fetch(`${base}${caminho}`, { redirect: 'manual' })

let numero = 0
const whats = () => `(33) 9${String(80000000 + numero++).padStart(8, '0')}`
const entrar = (rateio, extra = {}, cli = site()) => cli.post('rateio-entrar', { rateio, nome: 'Fulano Teste', whatsapp: whats(), uf: 'mg', quantidade: 1, ...extra })

try {
  parte('cabeçalhos e rotas')
  {
    const r = await site().get('rateios')
    igual(r.status, 200, 'rateios responde')
    igual(r.headers.get('content-type'), 'application/json; charset=utf-8', 'JSON UTF-8')
    ok(/no-store/.test(r.headers.get('cache-control') ?? ''), 'Cache-Control no-store')
    igual(r.headers.get('x-content-type-options'), 'nosniff', 'nosniff')
    igual(r.headers.get('referrer-policy'), 'same-origin', 'Referrer-Policy')
    igual(r.headers.get('x-powered-by'), null, 'sem X-Powered-By')
    igual(r.json.rateios, [], 'antes de instalar não tem rateio')
    ok(ISO.test(r.json.agora), 'agora em ISO UTC')
    erro(await site().get('nao-existe'), 404, 'rota-desconhecida', 'rota desconhecida')
    const m = await site().get('rateio-entrar')
    erro(m, 405, 'metodo', 'GET numa rota POST')
    igual(m.headers.get('allow'), 'POST', 'Allow: POST')
    erro(await site().post('pix-webhook', {}, { origem: null }), 501, 'pix-nao-configurado', 'webhook do Pix ainda 501')
    const e = await site().get('teste-erro')
    erro(e, 500, 'erro-interno', 'erro interno')
    ok(!e.texto.includes('detalhe-secreto') && !e.texto.includes('/caminho'), 'erro não vaza detalhe')
    ok(readFileSync(join(dados, 'erros.log'), 'utf8').includes('detalhe-secreto-do-teste'), 'o detalhe vai pro log no privado')
    ok(existsSync(join(dados, '.htaccess')) && existsSync(join(dados, 'index.html')), 'pasta de dados nasce com .htaccess e index.html')
  }

  parte('instalar')
  const dono = new Cliente('198.51.100.10')
  {
    const s = await dono.get('admin-sessao')
    igual([s.json.instalado, s.json.usuario, s.json.csrf], [false, null, null], 'sessão antes de instalar')
    const certo = { codigo: 'dev-instalar-greencheese', login: 'Dono', nome: 'Dono da Loja', senha: 'senha-forte-123' }
    erro(await dono.post('admin-instalar', certo, { origem: null }), 403, 'origem', 'instalar sem Origin')
    erro(await dono.post('admin-instalar', certo, { origem: 'https://golpe.example' }), 403, 'origem', 'instalar com Origin de fora')
    erro(await dono.post('admin-instalar', { ...certo, codigo: 'errado-errado' }), 403, 'codigo-invalido', 'código errado')
    erro(await dono.post('admin-instalar', { ...certo, senha: 'curta' }), 400, 'invalido', 'senha curta')
    erro(await dono.post('admin-instalar', { ...certo, login: 'x' }), 400, 'invalido', 'login curto')
    const r = await dono.post('admin-instalar', { ...certo, codigo: '  DEV instalar GREENCHEESE ' })
    igual(r.status, 201, 'instalou (código com espaço e maiúscula vale)')
    igual(r.json.usuario, { login: 'dono', nome: 'Dono da Loja', papel: 'dono' }, 'usuário criado')
    const ck = r.cookies.find((c) => c.startsWith('gc_painel=')) ?? ''
    ok(/gc_painel=[0-9a-f]{64};/.test(ck), 'cookie com token de 32 bytes')
    ok(/HttpOnly/i.test(ck) && /SameSite=Strict/i.test(ck) && /path=\/;/i.test(ck) && /Max-Age=2592000/i.test(ck), `cookie HttpOnly, SameSite=Strict, Path=/ e 30 dias (${ck})`)
    ok(!/Secure/i.test(ck), 'sem Secure no http')
    erro(await new Cliente().post('admin-instalar', certo), 409, 'ja-instalado', 'segunda instalação recusada')
    const s2 = await dono.get('admin-sessao')
    igual([s2.json.instalado, s2.json.usuario?.login, typeof s2.json.csrf], [true, 'dono', 'string'], 'sessão depois de instalar')
    ok(/^[0-9a-f]{64}$/.test(s2.json.csrf), 'csrf de 32 bytes')
    const lista = await site().get('rateios')
    igual(lista.json.rateios.map((x) => x.id), ['arizona-green-tea', 'dichavador-metal-4-partes'], 'exemplos semeados na instalação')
    for (const x of lista.json.rateios) {
      igual(chaves(x), CHAVES_RATEIO, `Rateio ${x.id} com as chaves do contrato`)
      igual([x.confirmadas, x.reservadas, x.demo, x.status, x.aceitaEntradas, x.fechaEm, x.reservaHoras, x.previsaoMin, x.previsaoMax], [0, 0, true, 'aberto', true, null, 24, 6, 10], `exemplo ${x.id} zerado`)
      ok(ISO.test(x.atualizadoEm), 'atualizadoEm ISO')
    }
    const az = lista.json.rateios[0]
    igual([az.titulo, az.descricao, az.produtoId, az.imagem, az.precoRateio, az.precoDepois, az.vagas, az.limitePorPessoa, az.ufs], ['Arizona Green Tea 680 ml', 'Chá verde gelado da AriZona, na lata alta de 680 ml. Importado.', 'arizona-green-tea', null, 14.9, 19.9, 24, 6, ['rj', 'mg', 'sp', 'es']], 'exemplo a) igual ao combinado')
    const di = lista.json.rateios[1]
    igual([di.titulo, di.descricao, di.precoRateio, di.precoDepois, di.vagas, di.limitePorPessoa, di.ufs], ['Dichavador de metal 4 partes 55 mm', 'Metal, 55 mm, 4 partes e com peneira.', 44.9, 59.9, 10, 2, ['mg', 'sp', 'es', 'sc']], 'exemplo b) igual ao combinado')
    const sem = await new Cliente().get('admin-resumo')
    erro(sem, 401, 'sem-sessao', 'painel sem sessão')
  }

  parte('código de desenvolvimento no ar')
  {
    // cópia da API rodando sem GC_DADOS (como no ar): os dados vão pra api/privado/ da cópia e o código de dev não vale
    const copia = join(tmp, 'site-no-ar')
    cpSync(join(raiz, 'public', 'api'), join(copia, 'api'), { recursive: true })
    const p2 = await portaLivre()
    const filho = await subirPhp(p2 === porta ? p2 + 1 : p2, { GC_TESTE: '', GC_DADOS: '', GC_UPLOADS: '' }, ['-t', copia])
    try {
      const b2 = `http://127.0.0.1:${p2 === porta ? p2 + 1 : p2}`
      const r = await fetch(`${b2}/api/index.php?r=admin-instalar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: b2 },
        body: JSON.stringify({ codigo: 'dev-instalar-greencheese', login: 'dono', nome: 'Dono', senha: 'senha-forte-123' }),
      })
      const j = await r.json()
      igual([r.status, j.erro], [403, 'codigo-de-desenvolvimento'], 'no ar, o código de dev é recusado')
      ok(existsSync(join(copia, 'api', 'privado', 'loja.sqlite')), 'no ar, o banco nasce em api/privado/loja.sqlite')
      const t = await fetch(`${b2}/api/index.php?r=teste-erro`)
      igual(t.status, 404, 'sem GC_TESTE, a rota de teste não existe')
      const a = await fetch(`${b2}/api/index.php?r=rateios`, { headers: { 'X-GC-Agora': '2000000000' } })
      igual((await a.json()).agora.slice(0, 4), new Date().toISOString().slice(0, 4), 'sem GC_TESTE, o relógio de teste é ignorado')
    } finally {
      derrubar(filho)
    }
  }

  parte('entrar no painel')
  {
    const errada = { login: 'dono', senha: 'senha-errada-000' }
    const a = new Cliente('198.51.100.20')
    for (let i = 0; i < 5; i++) erro(await a.post('admin-entrar', errada), 401, 'credenciais', `senha errada ${i + 1}`)
    erro(await a.post('admin-entrar', { login: 'dono', senha: 'senha-forte-123' }), 429, 'muitas-tentativas', '6ª tentativa travada (mesmo com a senha certa)')
    const outro = new Cliente('198.51.100.21')
    erro(await outro.post('admin-entrar', { login: 'ninguem', senha: 'senha-forte-123' }), 401, 'credenciais', 'usuário que não existe: mesma mensagem')
    const r = await outro.post('admin-entrar', { login: ' DONO ', senha: 'senha-forte-123' })
    igual(r.status, 200, 'outro IP entra')
    ok(r.json.csrf && outro.cookie && outro.cookie !== dono.cookie, 'sessão nova com token novo')
    const antigo = outro.cookie
    await outro.post('admin-entrar', { login: 'dono', senha: 'senha-forte-123' })
    ok(outro.cookie !== antigo, 'entrar de novo troca o token')
    const velho = new Cliente()
    velho.cookie = antigo
    igual((await velho.get('admin-sessao')).json.usuario, null, 'o token de antes morreu')
    const c = new Cliente('198.51.100.22')
    for (let i = 0; i < 20; i++) await c.post('admin-entrar', { login: `tentativa${Math.floor(i / 4)}`, senha: 'x-errada-xxx' })
    erro(await c.post('admin-entrar', { login: 'dono', senha: 'senha-forte-123' }), 429, 'muitas-tentativas', '20 erros no mesmo IP travam o IP')
    const https = new Cliente('198.51.100.23')
    const h = await https.post('admin-entrar', { login: 'dono', senha: 'senha-forte-123' }, { cab: { 'X-Forwarded-Proto': 'https' } })
    ok(h.cookies.some((k) => /Secure/i.test(k)), 'Secure no HTTPS')
    erro(await new Cliente().post('admin-entrar', { login: 'dono', senha: 'senha-forte-123' }, { origem: null }), 403, 'origem', 'entrar sem Origin')
    const ref = await new Cliente().post('admin-entrar', { login: 'dono', senha: 'senha-forte-123' }, { origem: null, cab: { Referer: `${base}/painel/` } })
    igual(ref.status, 200, 'sem Origin mas com Referer do site, passa')
    const xs = await new Cliente().post('admin-entrar', { login: 'dono', senha: 'senha-forte-123' }, { cab: { 'Sec-Fetch-Site': 'cross-site' } })
    erro(xs, 403, 'origem', 'Sec-Fetch-Site: cross-site')
  }

  parte('CSRF e Origin no painel')
  {
    const novo = { titulo: 'Teste CSRF', precoRateio: 10, vagas: 5, ufs: ['mg'] }
    erro(await dono.post('admin-rateio-salvar', novo, { csrf: null }), 403, 'csrf', 'sem X-CSRF')
    erro(await dono.post('admin-rateio-salvar', novo, { csrf: 'f'.repeat(64) }), 403, 'csrf', 'X-CSRF errado')
    erro(await dono.post('admin-rateio-salvar', novo, { origem: 'https://golpe.example' }), 403, 'origem', 'Origin de fora')
    erro(await dono.post('admin-rateio-salvar', novo, { origem: null }), 403, 'origem', 'sem Origin nem Referer')
    erro(await dono.post('admin-rateio-salvar', JSON.stringify(novo), { cab: { 'Content-Type': 'text/plain' } }), 415, 'invalido', 'corpo que não é JSON')
    erro(await dono.post('admin-rateio-salvar', '{quebrado', {}), 400, 'invalido', 'JSON quebrado')
    erro(await dono.post('admin-rateio-salvar', [1, 2]), 400, 'invalido', 'JSON que não é objeto')
    const outra = new Cliente()
    outra.csrf = dono.csrf
    erro(await outra.post('admin-rateio-salvar', novo), 401, 'sem-sessao', 'CSRF sem a sessão não vale')
  }

  parte('rateio: criar, editar, tabaco')
  let r10
  {
    const base10 = { titulo: 'Teste 10 vagas', descricao: 'Rateio do teste.', precoRateio: '19,90', precoDepois: 29.9, vagas: 10, limitePorPessoa: 1, ufs: ['MG', 'mg'], status: 'aberto' }
    for (const [campo, valor, termo] of [
      ['titulo', 'Backwoods Honey Bourbon', 'backwoods'], ['titulo', 'Pod descartável 5000', 'pod descartavel'], ['descricao', 'Pra quem curte VAPE.', 'vape'],
      ['titulo', 'Rapé de mentira', 'rape'], ['titulo', 'Black&Mild', 'black & mild'], ['titulo', 'Elf Bar 600', 'elf bar'], ['titulo', 'Ignite V50', 'ignite'],
      ['titulo', 'Seda + Tabaco', 'tabaco'], ['titulo', 'Cigarro eletrônico', 'cigarro'], ['titulo', 'Kit palheiro', 'palheiro'], ['produtoId', 'cigarrilha-x', 'cigarrilha'],
      ['titulo', 'Dutch Masters', 'dutch master'], ['titulo', 'Essência de narguilé', 'essencia de narguile'], ['titulo', 'ELFBAR', 'elfbar'],
    ]) {
      const r = await dono.post('admin-rateio-salvar', { ...base10, [campo]: valor })
      erro(r, 422, 'proibido', `recusa "${valor}"`)
      igual([r.json.campo, r.json.termo], [campo, termo], `campo e termo de "${valor}"`)
    }
    for (const t of ['Grape Soda', 'Uva Pêssego', 'Tabacaria importada', 'Charuteira de couro', 'Perfume importado']) {
      const r = await dono.post('admin-rateio-salvar', { ...base10, titulo: t, status: 'rascunho' })
      igual(r.status, 201, `aceita "${t}" (não é tabaco)`)
      await dono.post('admin-rateio-apagar', { id: r.json.rateio.id })
    }
    erro(await dono.post('admin-rateio-salvar', { ...base10, produtoId: 'Abc!' }), 400, 'invalido', 'produtoId fora do padrão')
    erro(await dono.post('admin-rateio-salvar', { ...base10, precoDepois: 19.9 }), 400, 'invalido', 'preço depois igual ao do rateio')
    erro(await dono.post('admin-rateio-salvar', { ...base10, precoRateio: 0 }), 400, 'invalido', 'preço zero')
    erro(await dono.post('admin-rateio-salvar', { ...base10, precoRateio: 14.999 }), 400, 'invalido', 'preço com 3 casas')
    erro(await dono.post('admin-rateio-salvar', { ...base10, vagas: 0 }), 400, 'invalido', 'zero vagas')
    erro(await dono.post('admin-rateio-salvar', { ...base10, limitePorPessoa: 11 }), 400, 'invalido', 'limite maior que as vagas')
    erro(await dono.post('admin-rateio-salvar', { ...base10, ufs: [] }), 400, 'invalido', 'sem estado')
    erro(await dono.post('admin-rateio-salvar', { ...base10, ufs: ['xx'] }), 400, 'invalido', 'estado que não existe')
    erro(await dono.post('admin-rateio-salvar', { ...base10, previsaoMin: 10, previsaoMax: 6 }), 400, 'invalido', 'previsão máxima menor')
    erro(await dono.post('admin-rateio-salvar', { ...base10, fechaEm: '2001-01-01T00:00:00Z' }), 400, 'invalido', 'prazo no passado')
    erro(await dono.post('admin-rateio-salvar', { ...base10, fechaEm: 'amanhã' }), 400, 'invalido', 'prazo que não é data')
    erro(await dono.post('admin-rateio-salvar', { ...base10, imagem: 'uploads/naoexiste123.webp' }), 400, 'invalido', 'imagem que não existe')
    erro(await dono.post('admin-rateio-salvar', { ...base10, imagem: '../api/privado/loja.sqlite' }), 400, 'invalido', 'imagem fora de uploads/')
    erro(await dono.post('admin-rateio-salvar', { ...base10, titulo: 'ab' }), 400, 'invalido', 'título curto')
    erro(await dono.post('admin-rateio-salvar', { ...base10, status: 'fechado' }), 400, 'invalido', 'rateio novo não nasce fechado')

    const c = await dono.post('admin-rateio-salvar', base10)
    igual(c.status, 201, 'criou')
    r10 = c.json.rateio
    igual([r10.id, r10.status, r10.precoRateio, r10.precoDepois, r10.ufs, r10.demo, r10.reservaHoras], ['teste-10-vagas', 'aberto', 19.9, 29.9, ['mg'], false, 24], 'campos do rateio novo')
    ok(ISO.test(r10.abertoEm) && ISO.test(r10.criadoEm), 'datas de criado e aberto')
    igual(r10.totais, { pessoasConfirmadas: 0, pessoasReservadas: 0, entregues: 0, expiradas: 0, canceladas: 0, participacoes: 0, arrecadado: 0, aReceber: 0 }, 'totais zerados')
    igual(r10.proximos, ['fechado', 'cancelado'], 'próximos passos')
    const d = await dono.post('admin-rateio-salvar', { ...base10, status: undefined, titulo: 'Teste 10 vagas' })
    igual([d.json.rateio.id, d.json.rateio.status, d.json.rateio.noSite], ['teste-10-vagas-2', 'rascunho', false], 'mesmo título ganha -2 e nasce rascunho')
    erro(await site().get('rateio', { query: '&id=teste-10-vagas-2' }), 404, 'nao-encontrado', 'rascunho não aparece no site')
    ok(!(await site().get('rateios')).json.rateios.some((x) => x.id === 'teste-10-vagas-2'), 'rascunho fora da lista')
    const e = await dono.post('admin-rateio-salvar', { id: 'teste-10-vagas-2', descricao: 'Mudou só a descrição.\n\n\n\nCom linha.' })
    igual([e.status, e.json.rateio.descricao, e.json.rateio.titulo, e.json.rateio.vagas], [200, 'Mudou só a descrição.\n\nCom linha.', 'Teste 10 vagas', 10], 'editar só um campo mantém o resto')
    erro(await dono.post('admin-rateio-status', { id: 'teste-10-vagas-2', status: 'pedido' }), 409, 'transicao-invalida', 'rascunho → pedido não vale')
    const ab = await dono.post('admin-rateio-status', { id: 'teste-10-vagas-2', status: 'aberto' })
    igual(ab.json.rateio.status, 'aberto', 'rascunho → aberto')
    igual((await dono.post('admin-rateio-apagar', { id: 'teste-10-vagas-2' })).status, 200, 'apaga rateio sem participação')
    erro(await dono.post('admin-rateio-apagar', { id: 'teste-10-vagas-2' }), 404, 'nao-encontrado', 'apagado não existe mais')
    const lista = await dono.get('admin-rateios')
    ok(lista.json.rateios.some((x) => x.id === 'teste-10-vagas') && lista.json.rateios.every((x) => 'totais' in x), 'admin-rateios com totais')
  }

  parte('entrar no rateio: erros do contrato')
  {
    const ok1 = { rateio: 'teste-10-vagas', nome: 'Maria', whatsapp: whats(), uf: 'mg', quantidade: 1 }
    const casos = [
      [{ nome: 'A' }, 'nome'], [{ nome: 'x'.repeat(61) }, 'nome'], [{ nome: '   ' }, 'nome'], [{ nome: 5 }, 'nome'],
      [{ whatsapp: '(20) 99999-9999' }, 'whatsapp'], [{ whatsapp: '(33) 3522-1234' }, 'whatsapp'], [{ whatsapp: '9911-39036' }, 'whatsapp'], [{ whatsapp: 'abc' }, 'whatsapp'],
      [{ uf: 'xx' }, 'uf'], [{ uf: null }, 'uf'], [{ quantidade: 0 }, 'quantidade'], [{ quantidade: 1.5 }, 'quantidade'], [{ quantidade: 'muitas' }, 'quantidade'],
      [{ rateio: 'NAO VALE' }, 'rateio'], [{ rateio: undefined }, 'rateio'], [{ site: 'http://spam.example' }, 'rateio'],
    ]
    for (const [mudar, campo] of casos) {
      const r = await site().post('rateio-entrar', { ...ok1, ...mudar })
      erro(r, 400, 'invalido', `inválido ${JSON.stringify(mudar)}`)
      igual(r.json.campo, campo, `campo de ${JSON.stringify(mudar)}`)
    }
    erro(await site().post('rateio-entrar', JSON.stringify(ok1), { cab: { 'Content-Type': 'text/plain' } }), 415, 'invalido', 'sem JSON')
    erro(await site().post('rateio-entrar', ok1, { origem: 'https://golpe.example' }), 403, 'origem', 'entrar de outro site')
    const p = await dono.get('admin-participantes', { query: '&rateio=teste-10-vagas' })
    igual(p.json.participantes.length, 0, 'nada gravado pela armadilha nem pelos erros')
    erro(await site().post('rateio-entrar', { ...ok1, rateio: 'nao-existe' }), 404, 'nao-encontrado', 'rateio que não existe')
    const fe = await site().post('rateio-entrar', { ...ok1, rateio: 'dichavador-metal-4-partes', uf: 'rj' })
    erro(fe, 409, 'fora-do-estado', 'fora do estado')
    igual(fe.json.ufs, ['mg', 'sp', 'es', 'sc'], 'fora-do-estado diz onde vale')
    const lim = await site().post('rateio-entrar', { ...ok1, rateio: 'dichavador-metal-4-partes', quantidade: 3 })
    erro(lim, 409, 'limite-por-pessoa', 'acima do limite por pessoa')
    igual(lim.json.limite, 2, 'limite no erro')
    const w = whats()
    const primeira = await site().post('rateio-entrar', { ...ok1, whatsapp: `+55 ${w}` })
    igual(primeira.status, 201, 'entrou (+55 na frente vale)')
    const ja = await site().post('rateio-entrar', { ...ok1, whatsapp: w.replace(/\D/g, '') })
    erro(ja, 409, 'ja-participa', 'mesmo WhatsApp de novo')
    igual(ja.json.codigo, primeira.json.participacao.codigo, 'ja-participa traz o código')
    const pp = primeira.json.participacao
    igual(chaves(pp), CHAVES_PARTICIPACAO, 'Participacao com as chaves do contrato')
    ok(/^RAT-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(pp.codigo), `código ${pp.codigo}`)
    ok(/^[0-9a-f]{32}$/.test(pp.token), 'token de 32 hex')
    igual([pp.status, pp.quantidade, pp.total, pp.rateioStatus, pp.confirmadoEm], ['reservado', 1, 19.9, 'aberto', null], 'participação reservada')
    igual(Date.parse(pp.expiraEm) - Date.parse(pp.criadoEm), 24 * 3600 * 1000, 'reserva de 24 h')
    igual([primeira.json.rateio.confirmadas, primeira.json.rateio.reservadas, primeira.json.rateio.disponiveis], [0, 1, 9], 'o rateio volta com o contador novo')
    const adm = (await dono.get('admin-participantes', { query: '&rateio=teste-10-vagas' })).json.participantes[0]
    igual([adm.nome, adm.whatsapp, adm.uf, adm.origem, adm.status], ['Maria', `55${w.replace(/\D/g, '')}`, 'mg', 'site', 'reservado'], 'painel vê os dados completos (WhatsApp normalizado)')
    const ped = await dono.post('admin-rateio-salvar', { id: 'teste-10-vagas', vagas: 0 })
    erro(ped, 400, 'invalido', 'vagas abaixo de 1')
    // prazo: vence com o relógio de teste
    const pz = await dono.post('admin-rateio-salvar', { titulo: 'Com prazo', precoRateio: 5, vagas: 3, ufs: ['mg'], status: 'aberto', fechaEm: new Date((AGORA + 7200) * 1000).toISOString() })
    igual(pz.status, 201, 'rateio com prazo')
    erro(await site().post('rateio-entrar', { ...ok1, rateio: 'com-prazo' }, { agora: AGORA + 3 * 3600 }), 409, 'rateio-fechado', 'depois do prazo')
    igual((await site().get('rateio', { query: '&id=com-prazo', agora: AGORA + 3 * 3600 })).json.rateio.aceitaEntradas, false, 'aceitaEntradas false depois do prazo')
    igual((await dono.post('admin-rateio-status', { id: 'com-prazo', status: 'fechado' }, { agora: AGORA + 3 * 3600 })).json.rateio?.status, 'fechado', 'fechar à mão')
    erro(await dono.post('admin-rateio-status', { id: 'com-prazo', status: 'aberto' }, { agora: AGORA + 3 * 3600 }), 409, 'prazo-vencido', 'reabrir com o prazo vencido')
  }

  parte('concorrência')
  {
    const c = await dono.post('admin-rateio-salvar', { titulo: 'Concorrência', precoRateio: 30, vagas: 10, limitePorPessoa: 1, ufs: ['mg'], status: 'aberto' })
    const id = c.json.rateio.id
    igual(id, 'concorrencia', 'slug sem acento')
    const res = await Promise.all(Array.from({ length: 30 }, () => entrar(id)))
    const status = res.map((r) => r.status)
    igual(status.filter((s) => s === 201).length, 10, '30 entradas juntas em 10 vagas: 10 entram')
    igual(status.filter((s) => s === 409).length, 20, '20 recebem 409')
    ok(res.filter((r) => r.status === 409).every((r) => r.json.erro === 'sem-vagas' && r.json.disponiveis === 0), 'os 20 com sem-vagas e disponiveis 0')
    const r = (await site().get('rateio', { query: `&id=${id}` })).json.rateio
    igual([r.reservadas, r.disponiveis, r.confirmadas, r.aceitaEntradas], [10, 0, 0, false], 'rateio cheio de reservas')
    const codigos = new Set(res.filter((x) => x.status === 201).map((x) => x.json.participacao.codigo))
    igual(codigos.size, 10, 'códigos únicos')
    erro(await entrar(id), 409, 'sem-vagas', 'mais um depois de cheio')
    // o mesmo WhatsApp 30 vezes ao mesmo tempo: só uma vaga
    const c2 = await dono.post('admin-rateio-salvar', { titulo: 'Mesmo número', precoRateio: 30, vagas: 50, limitePorPessoa: 1, ufs: ['mg'], status: 'aberto' })
    const w = whats()
    const mesmo = await Promise.all(Array.from({ length: 30 }, () => entrar(c2.json.rateio.id, { whatsapp: w })))
    igual([mesmo.filter((x) => x.status === 201).length, mesmo.filter((x) => x.json?.erro === 'ja-participa').length], [1, 29], 'mesmo WhatsApp junto: 1 entra, 29 ja-participa')
    // confirmar as 10 juntas: o contador chega a 10 e fecha uma vez só
    const parts = (await dono.get('admin-participantes', { query: `&rateio=${id}` })).json.participantes
    const conf = await Promise.all(parts.map((p) => dono.post('admin-participante-status', { id: p.id, status: 'confirmado' })))
    ok(conf.every((x) => x.status === 200), 'as 10 confirmações passam')
    const depois = (await site().get('rateio', { query: `&id=${id}` })).json.rateio
    igual([depois.confirmadas, depois.reservadas, depois.status, depois.aceitaEntradas], [10, 0, 'fechado', false], 'lotou e fechou sozinho')
    ok(ISO.test(depois.fechadoEm), 'fechadoEm')
    const ev = (await dono.get('admin-eventos')).json.eventos
    igual(ev.filter((e) => e.acao === 'rateio-fechou-sozinho' && e.alvo === `rateio:${id}`).length, 1, 'fechou sozinho uma vez só')
  }

  parte('vencimento da reserva')
  {
    const c = await dono.post('admin-rateio-salvar', { titulo: 'Vencimento', precoRateio: 12.5, vagas: 5, limitePorPessoa: 2, ufs: ['mg', 'sp'], status: 'aberto', reservaHoras: 1 })
    const id = c.json.rateio.id
    const w = whats()
    const a = await entrar(id, { whatsapp: w, quantidade: 2 })
    const b = await entrar(id, { uf: 'sp' })
    igual([a.status, b.status, b.json.rateio.reservadas, b.json.rateio.disponiveis], [201, 201, 3, 2], 'duas reservas')
    igual(Date.parse(a.json.participacao.expiraEm) - Date.parse(a.json.participacao.criadoEm), 3600 * 1000, 'reserva de 1 h (reservaHoras do rateio)')
    const dentro = (await site().get('rateio', { query: `&id=${id}`, agora: AGORA + 3500 })).json.rateio
    igual(dentro.reservadas, 3, 'ainda no prazo')
    const fora = (await site().get('rateio', { query: `&id=${id}`, agora: AGORA + 3700 })).json.rateio
    igual([fora.reservadas, fora.disponiveis, fora.confirmadas], [0, 5, 0], 'vencidas: as vagas voltam')
    const mv = await site().get('minhas-vagas', { query: `&t=${a.json.participacao.token},${b.json.participacao.token}`, agora: AGORA + 3700 })
    igual(mv.json.participacoes.map((p) => [p.status, p.expiraEm]), [['expirado', null], ['expirado', null]], 'minhas vagas: expirado, sem expiraEm')
    const adm = (await dono.get('admin-participantes', { query: `&rateio=${id}`, agora: AGORA + 3700 })).json.participantes
    ok(adm.every((p) => p.status === 'expirado' && ISO.test(p.expiradoEm)), 'painel: expirado com a data')
    igual(adm[0].expiradoEm, a.json.participacao.expiraEm, 'expirou na hora marcada')
    const de_novo = await entrar(id, { whatsapp: w, quantidade: 2 }, site())
    igual(de_novo.status, 201, 'depois de vencer, o mesmo WhatsApp entra de novo')
    // pagou atrasado: o dono confirma a vencida se ainda couber
    const vencida = adm[1]
    const cv = await dono.post('admin-participante-status', { id: vencida.id, status: 'confirmado' })
    igual([cv.status, cv.json.participante.status, cv.json.rateio.confirmadas], [200, 'confirmado', 1], 'confirma reserva vencida que ainda cabe')
    const ev = (await dono.get('admin-eventos')).json.eventos
    ok(ev.some((e) => e.acao === 'participacao-expirada' && e.origem === 'sistema'), 'vencimento entra na auditoria')
  }

  parte('confirmar, contador, fechar e os passos')
  let lota
  const tokensLota = []
  {
    const c = await dono.post('admin-rateio-salvar', { titulo: 'Lota', descricao: '', precoRateio: 20, precoDepois: null, vagas: 3, limitePorPessoa: 1, ufs: ['mg'], status: 'aberto', previsaoMin: 7, previsaoMax: 12 })
    lota = c.json.rateio.id
    const e = []
    for (let i = 0; i < 3; i++) {
      const r = await entrar(lota)
      e.push(r)
      tokensLota.push(r.json.participacao.token)
    }
    const parts = (await dono.get('admin-participantes', { query: `&rateio=${lota}` })).json.participantes
    const r1 = await dono.post('admin-participante-status', { id: parts[0].id, status: 'confirmado' })
    igual([r1.json.rateio.confirmadas, r1.json.rateio.reservadas, r1.json.rateio.status], [1, 2, 'aberto'], 'confirmou 1: 1/3')
    igual([r1.json.participante.status, r1.json.participante.confirmadoPor], ['confirmado', 'painel:dono'], 'quem confirmou')
    igual(r1.json.rateio.totais.arrecadado, 20, 'arrecadado')
    igual(r1.json.rateio.totais.aReceber, 40, 'a receber das reservas')
    const pub = (await site().get('rateio', { query: `&id=${lota}` })).json.rateio
    igual([pub.confirmadas, pub.vagas, pub.reservadas, pub.previsaoMin, pub.previsaoMax, pub.precoDepois], [1, 3, 2, 7, 12, null], 'o site vê 1/3 e +2 reservadas')
    const antes = (await dono.get('admin-eventos')).json.eventos.length
    const de_novo = await dono.post('admin-participante-status', { id: parts[0].id, status: 'confirmado' })
    erro(de_novo, 409, 'transicao-invalida', 'confirmar de novo pelo painel: já está confirmado')
    igual((await dono.get('admin-eventos')).json.eventos.length, antes, 'nada novo na auditoria')
    await dono.post('admin-participante-status', { id: parts[1].id, status: 'confirmado' })
    const r3 = await dono.post('admin-participante-status', { id: parts[2].id, status: 'confirmado' })
    igual([r3.json.rateio.confirmadas, r3.json.rateio.status, r3.json.rateio.aceitaEntradas], [3, 'fechado', false], '3/3: fechou sozinho')
    erro(await entrar(lota), 409, 'rateio-fechado', 'entrar depois de fechar')
    const mv = await site().get('minhas-vagas', { query: `&t=${tokensLota.join(',')}` })
    ok(mv.json.participacoes.every((p) => p.status === 'confirmado' && ISO.test(p.confirmadoEm) && p.rateioStatus === 'fechado'), 'minhas vagas: confirmada, rateio fechado')
    erro(await dono.post('admin-rateio-status', { id: lota, status: 'aberto' }), 409, 'lotado', 'reabrir lotado')
    const canc = await dono.post('admin-participante-status', { id: parts[2].id, status: 'cancelado' })
    igual([canc.json.participante.status, canc.json.rateio.confirmadas, canc.json.rateio.status], ['cancelado', 2, 'fechado'], 'cancelar confirmada: contador desce, segue fechado')
    const re = await dono.post('admin-rateio-status', { id: lota, status: 'aberto' })
    igual([re.json.rateio.status, re.json.rateio.fechadoEm, re.json.rateio.disponiveis], ['aberto', null, 1], 'reabriu com 1 vaga')
    const volta = await dono.post('admin-participante-status', { id: parts[2].id, status: 'reservado' })
    igual([volta.json.participante.status, volta.json.rateio.reservadas], ['reservado', 1], 'cancelada volta a reservado (cabia)')
    erro(await entrar(lota), 409, 'sem-vagas', 'sem vaga pra mais um')
    await dono.post('admin-participante-status', { id: parts[2].id, status: 'confirmado' })
    const passos = ['pedido', 'caminho', 'chegou', 'encerrado']
    erro(await dono.post('admin-rateio-status', { id: lota, status: 'chegou' }), 409, 'transicao-invalida', 'pular passo')
    for (const p of passos) {
      const r = await dono.post('admin-rateio-status', { id: lota, status: p })
      igual(r.json.rateio.status, p, `fechado → … → ${p}`)
    }
    const fim = (await dono.get('admin-rateio', { query: `&id=${lota}` })).json.rateio
    ok([fim.fechadoEm, fim.pedidoEm, fim.caminhoEm, fim.chegouEm, fim.encerradoEm].every((d) => ISO.test(d ?? '')), 'data de cada passo')
    igual(fim.proximos, ['cancelado'], 'encerrado só cancela')
    erro(await dono.post('admin-rateio-salvar', { id: lota, titulo: 'Mudar' }), 409, 'nao-editavel', 'encerrado não edita')
    const lista = (await site().get('rateios')).json.rateios
    ok(lista.some((x) => x.id === lota && x.status === 'encerrado'), 'encerrado aparece no site')
    igual(lista.at(-1).id, lota, 'encerrado no fim da lista')
    igual(lista[0].status, 'aberto', 'aberto primeiro')
    ok(!(await site().get('rateios', { agora: AGORA + 16 * 86400 })).json.rateios.some((x) => x.id === lota), 'encerrado some do site depois de 15 dias')
    erro(await site().get('rateio', { query: `&id=${lota}`, agora: AGORA + 16 * 86400 }), 404, 'nao-encontrado', 'e o link dele dá 404')
    const ent = await dono.post('admin-participante-status', { id: parts[0].id, status: 'entregue' })
    igual([ent.json.participante.status, ent.json.rateio.confirmadas], ['entregue', 3], 'entregue continua contando')
    igual((await dono.post('admin-participante-status', { id: parts[0].id, status: 'confirmado' })).json.participante.entregueEm, null, 'desfaz a entrega')
    erro(await dono.post('admin-participante-status', { id: parts[0].id, status: 'expirado' }), 400, 'invalido', 'status que o painel não põe')
    erro(await dono.post('admin-rateio-apagar', { id: lota }), 409, 'use-cancelar', 'rateio com gente: cancelar, não apagar')
    const cn = await dono.post('admin-rateio-status', { id: lota, status: 'cancelado' })
    ok(cn.json.rateio.status === 'cancelado' && ISO.test(cn.json.rateio.canceladoEm), 'cancelou')
    erro(await site().get('rateio', { query: `&id=${lota}` }), 404, 'nao-encontrado', 'cancelado some do site')
    const mvc = await site().get('minhas-vagas', { query: `&t=${tokensLota[0]}` })
    igual(mvc.json.participacoes[0].rateioStatus, 'cancelado', 'minhas vagas mostra o rateio cancelado')
    erro(await dono.post('admin-participante-status', { id: parts[1].id, status: 'entregue' }), 409, 'rateio-cancelado', 'rateio cancelado: só cancela participação')
  }

  parte('minhas vagas')
  {
    const id = 'arizona-green-tea'
    const a = await entrar(id, { quantidade: 6, uf: 'rj', cidade: 'Rio de Janeiro' })
    igual([a.status, a.json.participacao.total], [201, 89.4], '6 latas: total 89,40')
    const t = a.json.participacao.token
    const lixo = ['x', 'f'.repeat(32), 'G'.repeat(32), t.toUpperCase()]
    const mv = await site().get('minhas-vagas', { query: `&t=${lixo.join(',')}` })
    igual(mv.json.participacoes.length, 1, 'token desconhecido e inválido ignorados (maiúscula vale)')
    igual(mv.json.participacoes[0].token, t.toUpperCase().toLowerCase(), 'devolve o token')
    igual(chaves(mv.json.participacoes[0]), CHAVES_PARTICIPACAO, 'chaves do contrato')
    igual((await site().get('minhas-vagas')).json.participacoes, [], 'sem token: lista vazia')
    const muitos = await site().get('minhas-vagas', { query: `&t=${[...Array.from({ length: 20 }, (_, i) => i.toString(16).padStart(32, '0')), t].join(',')}` })
    igual(muitos.json.participacoes.length, 0, 'só os 20 primeiros tokens contam')
  }

  parte('participante incluído à mão')
  {
    const id = 'dichavador-metal-4-partes'
    const w = whats()
    const r = await dono.post('admin-participante-salvar', { rateio: id, nome: 'Zé da DM', whatsapp: w, uf: 'rj', quantidade: 2, status: 'confirmado', observacao: 'Pagou no Pix às 14h' })
    igual(r.status, 201, 'incluiu')
    igual([r.json.participante.status, r.json.participante.origem, r.json.participante.uf, r.json.rateio.confirmadas], ['confirmado', 'painel', 'rj', 2], 'confirmado direto (estado fora da lista vale no painel)')
    ok(/^[0-9a-f]{32}$/.test(r.json.token), 'token da vaga (pra mandar o link, se o site usar)')
    const mv = await site().get('minhas-vagas', { query: `&t=${r.json.token}` })
    igual(mv.json.participacoes[0]?.status, 'confirmado', 'o token da inclusão serve no minhas-vagas')
    erro(await dono.post('admin-participante-salvar', { rateio: id, nome: 'Zé de novo', whatsapp: w, uf: 'mg', quantidade: 1 }), 409, 'ja-participa', 'mesmo WhatsApp')
    erro(await dono.post('admin-participante-salvar', { rateio: id, nome: 'Muita', whatsapp: whats(), uf: 'mg', quantidade: 3 }), 409, 'limite-por-pessoa', 'limite vale no painel')
    erro(await dono.post('admin-participante-salvar', { rateio: id, nome: 'Status', whatsapp: whats(), uf: 'mg', quantidade: 1, status: 'entregue' }), 400, 'invalido', 'começa só reservado ou confirmado')
    const b = await dono.post('admin-participante-salvar', { rateio: id, nome: 'Outra Pessoa', whatsapp: whats(), uf: 'mg', quantidade: 1 })
    igual([b.json.participante.status, b.json.rateio.reservadas], ['reservado', 1], 'incluiu reservado')
    const ed = await dono.post('admin-participante-salvar', { id: b.json.participante.id, nome: 'Outra Pessoa Editada', quantidade: 2 })
    igual([ed.json.participante.nome, ed.json.participante.quantidade, ed.json.rateio.reservadas], ['Outra Pessoa Editada', 2, 2], 'editou nome e quantidade')
    erro(await dono.post('admin-participante-salvar', { id: b.json.participante.id, whatsapp: w }), 409, 'ja-participa', 'trocar pra um WhatsApp que já está')
    erro(await dono.post('admin-participante-salvar', { id: 999999, nome: 'Ninguém' }), 404, 'nao-encontrado', 'participação que não existe')
    const csvNome = await dono.post('admin-participante-salvar', { rateio: id, nome: '=HYPERLINK("x";"y")', whatsapp: whats(), uf: 'sp', quantidade: 1, observacao: 'linha 1\nlinha; 2' })
    igual(csvNome.status, 201, 'nome esquisito (pro CSV)')
    // LGPD: apagar os dados de quem pediu (a vaga fica na conta)
    const sai = await entrar(id, { nome: 'Quer Sair', cidade: 'C'.repeat(80) })
    igual(sai.status, 201, 'entrou (cidade longa corta em 60)')
    const pid = (await dono.get('admin-participantes', { query: `&rateio=${id}` })).json.participantes.find((p) => p.codigo === sai.json.participacao.codigo)
    igual(pid.cidade.length, 60, 'cidade cortada em 60')
    erro(await dono.post('admin-participante-apagar', { id: pid.id }), 409, 'participacao-ativa', 'vaga ativa: cancela antes')
    await dono.post('admin-participante-status', { id: pid.id, status: 'cancelado' })
    const ap = await dono.post('admin-participante-apagar', { id: pid.id })
    igual([ap.status, ap.json.participante.nome, ap.json.participante.whatsapp, ap.json.participante.cidade, ap.json.participante.codigo, ap.json.participante.status], [200, 'Dados apagados', '', '', pid.codigo, 'cancelado'], 'dados apagados, vaga na conta')
    igual((await site().get('minhas-vagas', { query: `&t=${sai.json.participacao.token}` })).json.participacoes, [], 'o token do aparelho para de valer')
  }

  parte('cópia do banco')
  {
    const r = await fetch(`${base}/api/index.php?r=admin-backup`, { headers: { Cookie: `gc_painel=${dono.cookie}`, 'X-GC-IP': dono.ip } })
    igual([r.status, r.headers.get('content-type')], [200, 'application/vnd.sqlite3'], 'baixa a cópia')
    ok(/attachment; filename="greencheese-loja-\d{4}-\d{2}-\d{2}-\d{4}\.sqlite"/.test(r.headers.get('content-disposition') ?? ''), 'nome do arquivo com a data')
    const copia = Buffer.from(await r.arrayBuffer())
    igual(copia.subarray(0, 16).toString('latin1'), 'SQLite format 3\0', 'é um banco SQLite')
    const arq = join(tmp, 'copia.sqlite')
    writeFileSync(arq, copia)
    const contar = (f) => execFileSync(PHP, ['-r', '$d = new PDO("sqlite:" . $argv[1]); echo $d->query("SELECT (SELECT COUNT(*) FROM rateios) || \'/\' || (SELECT COUNT(*) FROM participacoes)")->fetchColumn();', f], { encoding: 'utf8' })
    igual(contar(arq), contar(join(dados, 'loja.sqlite')), 'a cópia tem tudo (rateios/participações), até o que estava no diário')
    ok(!readdirSync(dados).some((n) => n.startsWith('copia-')), 'nenhuma cópia fica no privado')
    erro(await new Cliente().get('admin-backup'), 401, 'sem-sessao', 'cópia sem sessão')
  }

  parte('CSV')
  {
    const r = await dono.get('admin-participantes-csv', { query: '&rateio=dichavador-metal-4-partes' })
    igual(r.status, 200, 'CSV responde')
    igual(r.headers.get('content-type'), 'text/csv; charset=utf-8', 'text/csv UTF-8')
    ok(/attachment; filename="rateio-dichavador-metal-4-partes-\d{4}-\d{2}-\d{2}\.csv"/.test(r.headers.get('content-disposition') ?? ''), 'baixa como arquivo')
    const bytes = Buffer.from(await (await fetch(`${base}/api/index.php?r=admin-participantes-csv&rateio=dichavador-metal-4-partes`, { headers: { Cookie: `gc_painel=${dono.cookie}`, 'X-GC-IP': dono.ip } })).arrayBuffer())
    igual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'começa com o BOM')
    const linhas = r.texto.replace(/^﻿/, '').split('\r\n')
    ok(linhas[0].startsWith('Código;Nome;WhatsApp;Estado;Cidade;Quantidade;'), 'cabeçalho com ;')
    ok(r.texto.includes(`"'=HYPERLINK(""x"";""y"")"`), 'fórmula vira texto (e aspas escapadas)')
    ok(r.texto.includes('"linha 1\nlinha; 2"'), 'observação com quebra e ; entre aspas')
    ok(/;44,90;89,80;confirmado;painel;/.test(r.texto), 'valores com vírgula, status e origem')
    ok(/\(\d{2}\) 9\d{4}-\d{4}/.test(r.texto), 'WhatsApp formatado')
    erro(await new Cliente().get('admin-participantes-csv', { query: '&rateio=dichavador-metal-4-partes' }), 401, 'sem-sessao', 'CSV sem sessão')
  }

  parte('envio de imagem')
  let imagem
  {
    const enviar = (buf, nome, tipo) => {
      const f = new FormData()
      f.append('imagem', new Blob([buf], { type: tipo }), nome)
      return dono.post('admin-upload', f)
    }
    const r = await enviar(png(2400, 1200), 'foto.png', 'image/png')
    igual(r.status, 201, 'PNG enviado')
    imagem = r.json.imagem
    const ext = temWebp ? 'webp' : 'png'
    ok(new RegExp(`^uploads/[0-9a-f]{24}\\.${ext}$`).test(imagem ?? ''), `vira ${ext} com nome aleatório (${imagem})`)
    igual([r.json.largura, r.json.altura, r.json.tipo], temGd ? [1600, 800, `image/${ext}`] : [2400, 1200, 'image/png'], temGd ? 'lado maior até 1600 px' : 'sem GD: o original')
    const arq = join(uploads, imagem.slice('uploads/'.length))
    const conteudo = readFileSync(arq)
    ok(temWebp ? conteudo.subarray(0, 4).toString() === 'RIFF' && conteudo.subarray(8, 12).toString() === 'WEBP' : conteudo.subarray(1, 4).toString() === 'PNG', `é ${ext} de verdade`)
    ok(existsSync(join(uploads, '.htaccess')) && !existsSync(join(uploads, 'index.html')), 'uploads/ nasce com o .htaccess')
    const g = await crua(`/${imagem}`)
    igual([g.status, g.headers.get('content-type'), g.headers.get('x-content-type-options')], [200, `image/${ext}`, 'nosniff'], 'a imagem abre em /uploads/')
    const fake = await enviar(Buffer.from('<?php echo "pwned"; ?>\n'.repeat(4)), 'foto.png', 'image/png')
    erro(fake, 415, 'tipo-invalido', 'PHP renomeado pra .png')
    const poliglota = Buffer.concat([png(64, 64), Buffer.from('<?php system($_GET["c"]); ?>')])
    const pg = await enviar(poliglota, 'poli.png', 'image/png')
    igual(pg.status, 201, 'PNG com PHP no fim: aceita, mas recodifica')
    if (temGd) ok(!readFileSync(join(uploads, pg.json.imagem.slice(8))).includes('<?php'), 'o PHP escondido some na recodificação')
    else igual((await crua(`/${pg.json.imagem}`)).headers.get('content-type'), 'image/png', 'sem GD: fica como imagem (nunca roda)')
    erro(await enviar(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'x.svg', 'image/svg+xml'), 415, 'tipo-invalido', 'SVG recusado')
    erro(await enviar(Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'latin1'), 'x.gif', 'image/gif'), 415, 'tipo-invalido', 'GIF recusado')
    erro(await enviar(Buffer.from('<!doctype html><script>alert(1)</script>'), 'x.html', 'text/html'), 415, 'tipo-invalido', 'HTML recusado')
    const grande = await enviar(Buffer.alloc(9 * 1048576, 1), 'grande.png', 'image/png')
    erro(grande, 413, 'grande-demais', 'maior que 8 MB')
    igual(grande.json.limite, 8 * 1048576, 'limite de 8 MB no erro')
    erro(await enviar(Buffer.alloc(21 * 1048576, 1), 'enorme.png', 'image/png'), 413, 'grande-demais', 'maior que o post_max_size do PHP')
    const vazio = new FormData()
    erro(await dono.post('admin-upload', vazio), 400, 'invalido', 'sem arquivo')
    const semCsrf = new FormData()
    semCsrf.append('imagem', new Blob([png(10, 10)], { type: 'image/png' }), 'a.png')
    erro(await dono.post('admin-upload', semCsrf, { csrf: null }), 403, 'csrf', 'envio sem CSRF')
    const comImg = await dono.post('admin-rateio-salvar', { id: 'arizona-green-tea', imagem })
    igual(comImg.json.rateio.imagem, imagem, 'rateio com a imagem enviada')
    igual((await site().get('rateio', { query: '&id=arizona-green-tea' })).json.rateio.imagem, imagem, 'o site recebe o caminho relativo')
  }

  parte('fechado pela web')
  {
    for (const caminho of ['/api/privado/loja.sqlite', '/api/privado/', '/api/privado/erros.log', '/api/nucleo/base.php', '/api/nucleo/', '/api/instalacao.php', '/api/.htaccess', '/uploads/.htaccess', '/uploads/gc.php', '/uploads/a.php.png', '/uploads/../api/privado/loja.sqlite']) {
      const r = await crua(caminho)
      ok(r.status === 403 || r.status === 400, `${caminho} fechado (${r.status})`)
      const corpo = await r.text()
      ok(!corpo.includes('SQLite format') && !corpo.includes('$2y$') && !corpo.includes('<?php'), `${caminho} não vaza nada`)
    }
    igual((await crua('/uploads/naoexiste12.webp')).status, 404, 'imagem que não existe: 404')
    // o IP nunca fica guardado puro
    const bruto = ['loja.sqlite', 'loja.sqlite-wal'].filter((n) => existsSync(join(dados, n))).map((n) => readFileSync(join(dados, n)).toString('latin1')).join('')
    ok(!bruto.includes('203.0.113.') && !bruto.includes('198.51.100.'), 'nenhum IP em claro no banco')
  }

  parte('limite de tentativas do site')
  {
    const robo = new Cliente('192.0.2.77')
    for (let i = 0; i < 12; i++) await robo.post('rateio-entrar', { rateio: 'arizona-green-tea', nome: 'x' })
    const r = await robo.post('rateio-entrar', { rateio: 'arizona-green-tea', nome: 'Gente Boa', whatsapp: whats(), uf: 'mg', quantidade: 1 })
    erro(r, 429, 'muitas-tentativas', 'rateio-entrar: 13ª na hora')
    ok(Number(r.headers.get('retry-after')) > 3000 && r.json.esperaSegundos > 3000, 'Retry-After e esperaSegundos')
    igual((await robo.post('rateio-entrar', { rateio: 'arizona-green-tea', nome: 'x' }, { agora: AGORA + 3700 })).json.erro, 'invalido', 'passou a hora: libera')
    const curioso = new Cliente('192.0.2.88')
    const ts = []
    for (let i = 0; i < 120; i++) ts.push((await curioso.get('minhas-vagas', { query: '&t=' + 'a'.repeat(32) })).status)
    ok(ts.every((s) => s === 200), '120 consultas na hora passam')
    erro(await curioso.get('minhas-vagas'), 429, 'muitas-tentativas', 'minhas-vagas: 121ª na hora')
  }

  parte('sessões')
  {
    // o relógio de teste empurrou a sessão do dono pro futuro: entra de novo pra ela voltar a ser a mais velha
    igual((await dono.post('admin-entrar', { login: 'dono', senha: 'senha-forte-123' })).status, 200, 'dono entra de novo')
    const r = await dono.get('admin-resumo')
    igual(r.status, 200, 'resumo')
    ok(r.json.rateios.aberto >= 1 && Array.isArray(r.json.esperandoPagamento) && r.json.reservas.pessoas >= 1, 'resumo com reservas esperando pagamento')
    ok(r.json.esperandoPagamento.length > 0 && r.json.esperandoPagamento.every((p) => p.status === 'reservado' && p.rateioTitulo), 'esperando pagamento traz o título do rateio')
    ok(r.json.ultimasEntradas.length > 0, 'últimas entradas')
    const varios = []
    for (let i = 0; i < 12; i++) {
      const c = new Cliente(`198.51.100.${40 + i}`)
      igual((await c.post('admin-entrar', { login: 'dono', senha: 'senha-forte-123' })).status, 200, `login ${i + 1}`)
      varios.push(c)
    }
    const vivas = []
    for (const c of varios) vivas.push((await c.get('admin-sessao')).json.usuario !== null)
    igual(vivas, [false, false, ...Array(10).fill(true)], 'no máximo 10 por usuário: saem as mais velhas')
    igual((await dono.get('admin-sessao')).json.usuario, null, 'a do começo também saiu')
    const saida = varios.at(-2)
    const sai = await saida.post('admin-sair', {})
    igual(sai.status, 200, 'sair')
    ok(sai.cookies.some((c) => /^gc_painel=(deleted)?;/.test(c)), 'sair apaga o cookie')
    igual((await varios.at(-3).get('admin-sessao')).json.usuario?.login, 'dono', 'sair não derruba as outras')
    const s = varios.at(-1)
    igual((await s.get('admin-eventos', { agora: AGORA + 20 * 86400 })).status, 200, '20 dias depois: vale e desliza')
    igual((await s.get('admin-eventos', { agora: AGORA + 45 * 86400 })).status, 200, '45 dias depois (25 sem usar): vale')
    erro(await s.get('admin-eventos', { agora: AGORA + 80 * 86400 }), 401, 'sem-sessao', '35 dias sem usar: acabou')
    igual((await dono.post('admin-entrar', { login: 'dono', senha: 'senha-forte-123' })).status, 200, 'dono entra de novo')
  }

  parte('senha')
  {
    const outra = new Cliente('198.51.100.90')
    await outra.post('admin-entrar', { login: 'dono', senha: 'senha-forte-123' })
    erro(await dono.post('admin-senha', { atual: 'errada-errada', nova: 'nova-senha-456' }), 403, 'senha-atual', 'senha atual errada')
    erro(await dono.post('admin-senha', { atual: 'senha-forte-123', nova: 'curta' }), 400, 'invalido', 'senha nova curta')
    erro(await dono.post('admin-senha', { atual: 'senha-forte-123', nova: 'senha-forte-123' }), 400, 'invalido', 'senha nova igual')
    igual((await dono.post('admin-senha', { atual: 'senha-forte-123', nova: 'nova-senha-456' })).status, 200, 'trocou')
    igual((await dono.get('admin-sessao')).json.usuario?.login, 'dono', 'esta sessão continua')
    igual((await outra.get('admin-sessao')).json.usuario, null, 'as outras caem')
    igual((await new Cliente().post('admin-entrar', { login: 'dono', senha: 'nova-senha-456' })).status, 200, 'entra com a nova')
  }

  parte('recuperar com código novo')
  {
    const x = new Cliente('198.51.100.95')
    erro(await x.post('admin-recuperar', { codigo: 'dev-instalar-greencheese', senha: 'recuperada-789' }), 409, 'codigo-usado', 'o código da instalação não serve de novo')
    writeFileSync(instalacaoTeste, txtGerado)
    erro(await x.post('admin-recuperar', { codigo: 'aaaaa-bbbbb-ccccc-ddddd', senha: 'recuperada-789' }), 403, 'codigo-invalido', 'código errado')
    const r = await x.post('admin-recuperar', { codigo: codigoNovo.toUpperCase(), senha: 'recuperada-789' })
    igual([r.status, r.json.usuario?.login], [200, 'dono'], 'código novo troca a senha e entra')
    igual((await dono.get('admin-sessao')).json.usuario, null, 'derruba as sessões de antes')
    erro(await new Cliente().post('admin-recuperar', { codigo: codigoNovo, senha: 'outra-senha-000' }), 409, 'codigo-usado', 'cada código vale uma vez')
    igual((await new Cliente().post('admin-entrar', { login: 'dono', senha: 'recuperada-789' })).status, 200, 'entra com a recuperada')
    const lim = new Cliente('198.51.100.96')
    for (let i = 0; i < 10; i++) await lim.post('admin-recuperar', { codigo: 'errado', senha: 'x' })
    erro(await lim.post('admin-recuperar', { codigo: codigoNovo, senha: 'recuperada-789' }), 429, 'muitas-tentativas', 'código: 10 por hora por IP')
    dono.cookie = x.cookie
    dono.csrf = x.csrf
  }

  parte('apagar exemplo, diagnóstico e auditoria')
  {
    const ap = await dono.post('admin-rateio-apagar', { id: 'dichavador-metal-4-partes' })
    igual(ap.status, 200, 'exemplo com gente pode apagar')
    const d = await dono.get('admin-diagnostico')
    igual(d.status, 200, 'diagnóstico')
    igual([d.json.php.ok, d.json.extensoes.pdo_sqlite, d.json.dados.gravavel, d.json.dados.diario, d.json.instalacao.codigoDev], [true, true, true, 'wal', false], 'PHP, SQLite em WAL, pasta gravável')
    igual(d.json.limites.envioMaximo, 8 * 1048576, 'envio máximo')
    igual(d.json.web.testado, true, `testou pela web (${d.json.web.motivo})`)
    ok(d.json.web.itens.length >= 7 && d.json.web.itens.every((i) => i.ok === true), `tudo fechado pela web: ${JSON.stringify(d.json.web.itens)}`)
    ok(d.json.web.itens.some((i) => i.nome === 'php em uploads/'), 'testou um .php em uploads/')
    ok(!readdirSync(uploads).some((n) => n.endsWith('.php')), 'a sonda do diagnóstico some')
    const ev = (await dono.get('admin-eventos')).json.eventos
    ok(ev.length === 100 && ev[0].id > ev[1].id, 'últimos 100, do mais novo')
    ok(ev.every((e) => typeof e.texto === 'string' && e.texto.length > 0 && ISO.test(e.em)), 'cada evento com texto e data')
    ok(ev.some((e) => e.acao === 'rateio-apagado' && e.usuario === 'dono' && /Apagou o rateio "Dichavador/.test(e.texto)), 'apagar entra na auditoria com quem fez')
    ok(ev.some((e) => e.acao === 'imagem-enviada'), 'envio na auditoria')
  }
} catch (e) {
  ok(false, `exceção: ${e.stack}`)
}
derrubar(php)
if (process.env.GC_TESTE_MANTER === '1') console.log(`dados do teste em ${tmp}`)
else rmSync(tmp, { recursive: true, force: true })
console.log(falhas ? `${falhas} problema(s) em ${checagens} checagens` : `${checagens} checagens · api ok`)
process.exit(falhas ? 1 : 0)
