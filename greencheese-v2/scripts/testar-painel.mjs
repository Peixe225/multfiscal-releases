// Teste do painel do dono no navegador (Chromium do Playwright), contra a API de verdade: php -S com pasta de dados
// temporária + vite preview do build (o mesmo proxy de /api e /uploads do desenvolvimento).
// Fluxo: instalar → entrar → criar rateio com foto do celular → publicar → clientes entram pela API (como o site faz)
// → reservas no painel → confirmar (o contador sobe) → lota → fecha sozinho → avisar todos → pedido feito → a caminho
// → chegou → entregue → CSV → incluir quem veio pela DM → trocar senha → sair → entrar com a nova. E a robustez:
// rascunho guardado, tabaco recusado, erro de rede, sessão que cai no meio (o salvar e o CSV terminam sozinhos depois
// de entrar), toque duplo, voltar do Android fecha a folha, teclado, celular deitado, 320 px sem rolagem lateral (nas
// telas e nas folhas de incluir e editar, com o + das vagas dentro da caixa). E o dono sem depender de ninguém: a barra
// com o nome de cada ícone e o "+" (Novo produto, Novo rateio), o Mais agrupado com o rodapé, o guia "Como usar o
// painel", a lista "Pra deixar a loja pronta" (pular com Desfazer; some quando fica feito), a cópia de segurança em
// Conta (com "última cópia", o lembrete do Início depois de 7 dias e o Diagnóstico que falha sem esconder a cópia), os
// campos de senha com "Mostrar", os textos do Entrar e do Esqueci a senha e a lateral no tablet (768).
// Também confere o HTML do painel (noindex, título, manifesto, caminhos relativos, sem o CSS do site) e que o site
// não carrega nada do painel. A loja (produtos, estoque, foto, estado novo, story, prêmio, textos) fica em
// scripts/testar-painel-loja.mjs, a mudança em massa por estado (Selecionar vários, a folha, a confirmação curta, o
// Desfazer, teclado e 360 px) em scripts/testar-painel-massa.mjs, a foto pesada do celular (50 MP e 25 MB: abre
// reduzida, sobe e o site serve a do tamanho de hoje) em scripts/testar-painel-foto.mjs, e o Teste minha sorte (frequência, chances, raridade,
// simular, teste da animação) em scripts/testar-painel-sorte.mjs, chamados daqui.
// Uso: node scripts/testar-painel.mjs <pasta-do-build>   (termina com "painel ok")
// GC_TESTE_PORTA = porta do PHP (a do preview é a seguinte, ou GC_TESTE_PORTA_SITE); as contas sobem outro PHP e outro
// preview (GC_TESTE_PORTA_CONTAS e GC_TESTE_PORTA_CONTAS_SITE, ou portas livres); GC_PRINTS=<pasta> guarda os prints; GC_AXE=<axe.min.js>
// roda o axe em cada tela; PHP=/caminho troca o binário.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fluxoLoja, ROTAS_LOJA } from './testar-painel-loja.mjs'
import { fluxoSorte } from './testar-painel-sorte.mjs'
import { fluxoMassa } from './testar-painel-massa.mjs'
import { fluxoFoto } from './testar-painel-foto.mjs'

const raiz = fileURLToPath(new URL('..', import.meta.url))
const build = process.argv[2] ? resolve(process.argv[2]) : null
if (!build || !existsSync(join(build, 'painel', 'index.html'))) {
  console.error('uso: node scripts/testar-painel.mjs <pasta-do-build> (com painel/index.html: rode o vite build antes)')
  process.exit(1)
}
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers'
const { chromium } = await import('playwright')
const sharp = (await import('sharp')).default
const PHP = process.env.PHP ?? 'php'
const PRINTS = process.env.GC_PRINTS ?? null
const AXE = process.env.GC_AXE ?? (existsSync('/tmp/claude-0/axe/node_modules/axe-core/axe.min.js') ? '/tmp/claude-0/axe/node_modules/axe-core/axe.min.js' : null)

let falhas = 0
let checagens = 0
function ok(cond, msg) {
  checagens++
  if (!cond) falhas++
  console.log(`${cond ? '✓' : '✗'} ${msg}`)
  return cond
}

async function portaLivre() {
  return new Promise((res) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => res(p))
    })
  })
}
const portaPhp = process.env.GC_TESTE_PORTA ? Number(process.env.GC_TESTE_PORTA) : await portaLivre()
const portaSite = process.env.GC_TESTE_PORTA_SITE ? Number(process.env.GC_TESTE_PORTA_SITE) : process.env.GC_TESTE_PORTA ? portaPhp + 1 : await portaLivre()
const BASE = `http://127.0.0.1:${portaSite}`

// ─── HTML do build, sem navegador ───────────────────────────────────────────────────────────────────────────────

const htmlPainel = readFileSync(join(build, 'painel', 'index.html'), 'utf8')
const htmlSite = readFileSync(join(build, 'index.html'), 'utf8')
ok(htmlPainel.includes('<meta name="robots" content="noindex, nofollow"'), 'painel: noindex, nofollow')
ok(htmlPainel.includes('<title>Painel · Green Cheese</title>'), 'painel: título "Painel · Green Cheese"')
ok(/<link rel="manifest" href="\.\/manifest\.webmanifest"/.test(htmlPainel) && existsSync(join(build, 'painel', 'manifest.webmanifest')), 'painel: manifesto próprio')
const refs = [...htmlPainel.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
ok(refs.every((r) => r.startsWith('./') || r.startsWith('../')), `painel: tudo por caminho relativo (${refs.filter((r) => !/^\.\.?\//.test(r)).join(' ') || 'ok'})`)
ok(!/rel="stylesheet"/.test(htmlPainel), 'painel: não baixa o CSS do site')
ok(existsSync(join(build, 'painel', '.htaccess')) && /X-Robots-Tag "noindex, nofollow"/.test(readFileSync(join(build, 'painel', '.htaccess'), 'utf8')), 'painel: .htaccess com X-Robots-Tag')
ok(!/painel/i.test(htmlSite), 'site: o HTML não cita nem linka o painel')
const doSite = [...htmlSite.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1])
ok(doSite.length > 0 && doSite.every((a) => !/admin-sessao|pn-barra|Painel da loja/.test(readFileSync(join(build, a), 'utf8'))), `site: nenhum pedaço do painel no que a página carrega (${doSite.length} arquivos)`)
// o site tem a aba Rateio quando algum pedaço dele (fora o do painel) fala com a rota pública de entrar no rateio
const siteComRateio = readdirSync(join(build, 'assets')).some((n) => n.endsWith('.js') && !n.startsWith('painel-') && readFileSync(join(build, 'assets', n), 'utf8').includes('rateio-entrar'))
const doPainel = readdirSync(join(build, 'assets')).filter((n) => n.startsWith('painel-') && n.endsWith('.js'))
ok(doPainel.length === 1, 'painel: um pedaço só dele (painel-*.js)')

// ─── servidores ─────────────────────────────────────────────────────────────────────────────────────────────────

const dados = mkdtempSync(join(tmpdir(), 'gc-painel-'))
const filhos = []
const derrubar = () => filhos.forEach((f) => {
  try {
    process.kill(-f.pid, 'SIGTERM')
  } catch {
    /* já saiu */
  }
})
process.on('exit', derrubar)
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(1))

// GC_TESTE=1: a hora do servidor vem do X-GC-Agora quando o teste manda (a lista de pedidos que vira na meia-noite)
const php = spawn(PHP, ['-d', 'display_errors=0', '-d', 'upload_max_filesize=40M', '-d', 'post_max_size=48M', '-S', `127.0.0.1:${portaPhp}`, '-t', join(raiz, 'public'), join(raiz, 'scripts', 'api-dev.php')], {
  env: { ...process.env, PHP_CLI_SERVER_WORKERS: '4', GC_TESTE: '1', GC_DADOS: dados, GC_UPLOADS: join(dados, 'uploads') },
  stdio: 'ignore',
  detached: true,
})
filhos.push(php)
const site = spawn(process.execPath, [join(raiz, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--outDir', build, '--port', String(portaSite), '--strictPort', '--host', '127.0.0.1'], {
  cwd: raiz,
  env: { ...process.env, GC_API_PORTA: String(portaPhp), VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' },
  stdio: 'ignore',
  detached: true,
})
filhos.push(site)
for (let i = 0; i < 150; i++) {
  const pronto = await fetch(`${BASE}/api/index.php?r=admin-sessao`).then((r) => r.ok, () => false)
  if (pronto) break
  await new Promise((r) => setTimeout(r, 100))
}

const banco = join(dados, 'loja.sqlite')
const sql = (q) => execFileSync(PHP, ['-r', `$d=new PDO('sqlite:${banco}');$d->exec(${JSON.stringify(q)});`])
const foto = join(dados, 'foto-do-celular.jpg')
await sharp({ create: { width: 3000, height: 4000, channels: 3, background: '#1c1c1c' } })
  .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="2200"><rect width="800" height="2200" rx="120" fill="#e2552f"/></svg>'), left: 1100, top: 900 }])
  .jpeg({ quality: 92 })
  .toFile(foto)
// a foto do produto como o dono tira (fundo claro, com sombra), pro Estúdio da foto
const fotoClara = join(dados, 'produto-fundo-branco.jpg')
await sharp({ create: { width: 2400, height: 3200, channels: 3, background: '#f4f3ef' } })
  .composite([
    { input: await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="3200"><ellipse cx="1200" cy="2620" rx="520" ry="70" fill="#000" fill-opacity="0.3"/></svg>')).blur(40).png().toBuffer(), left: 0, top: 0 },
    { input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="700" height="1900"><rect x="200" width="300" height="300" rx="40" fill="#222"/><rect y="260" width="700" height="1640" rx="140" fill="#e2552f"/><rect x="80" y="900" width="540" height="420" fill="#f7e7c4"/></svg>'), left: 850, top: 700 },
  ])
  .jpeg({ quality: 90 })
  .toFile(fotoClara)
// os vídeos da thumb animada (o ffmpeg gera; o Chromium dos testes não abre H.264, então vão em VP9): o produto
// "girando" num fundo claro (WebM) e um "MP4 original" pequeno (VP9 dentro do MP4) pro caminho sem MediaRecorder
let videos = null
try {
  const ff = (args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'pipe' })
  const cena = ['-f', 'lavfi', '-i', 'color=c=0xf2f1ec:s=360x640:r=24:d=4', '-f', 'lavfi', '-i', 'color=c=0xd8432a:s=120x330:r=24:d=4', '-filter_complex', "[1]scale=w='max(8,trunc(120*abs(cos(t*1.6))/2)*2)':h=330:eval=frame[l];[0][l]overlay=x='(W-w)/2':y=150:eval=frame,format=yuv420p"]
  videos = { webm: join(dados, 'produto-girando.webm'), mp4: join(dados, 'produto-original.mp4'), tela: join(dados, 'gravacao-da-tela.webm'), reel: process.env.GC_TESTE_REEL || null }
  ff([...cena, '-t', '4', '-c:v', 'libvpx-vp9', '-b:v', '600k', videos.webm])
  ff([...cena, '-t', '3', '-c:v', 'libvpx-vp9', '-b:v', '600k', '-f', 'mp4', videos.mp4])
  // a gravação da tela, como a loja manda o reel (o item1.mp4 de 11/10): a interface do Instagram no modo escuro em
  // volta (a barra do celular, as barrinhas, o nome do perfil, "Enviar mensagem", o cinza do story) e, no meio, a
  // janela preta do reel com os cantos arredondados, o nome do perfil e o tempo em cima, e o produto girando. Com
  // GC_TESTE_REEL=<o reel de verdade em WebM> o mesmo teste roda também nele (o Chromium daqui não abre H.264).
  const caixa = (x, y, w, h, cor, t = 'fill') => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${cor}:t=${t}`
  const tela = [
    caixa(0, 0, 384, 46, '0x0f1015'), caixa(26, 12, 56, 20, '0xd02030'), caixa(300, 16, 60, 10, '0xe0e0e0'), caixa(8, 46, 368, 3, '0xbbbbbb'),
    caixa(56, 60, 150, 10, '0xe8e8e8'), caixa(56, 76, 110, 8, '0xc8c8c8'), caixa(38, 110, 308, 550, '0x020003'),
    caixa(38, 110, 4, 4, '0x1e1b1f'), caixa(342, 110, 4, 4, '0x1e1b1f'), caixa(38, 656, 4, 4, '0x1e1b1f'), caixa(342, 656, 4, 4, '0x1e1b1f'),
    caixa(52, 126, 120, 10, '0xe8e8e8'), caixa(316, 126, 22, 10, '0xe8e8e8'),
    caixa(0, 740, 384, 92, '0x0f1015'), caixa(14, 756, 200, 40, '0x9a9a9a', 2), caixa(150, 822, 84, 5, '0xf0f0f0'),
  ].join(',')
  ff([
    '-f', 'lavfi', '-i', 'color=c=0x1e1b1f:s=384x832:r=24:d=4', '-f', 'lavfi', '-i', 'color=c=0xd8432a:s=110x260:r=24:d=4',
    '-filter_complex', `[1]scale=w='max(8,trunc(110*abs(cos(t*1.6))/2)*2)':h=260:eval=frame[l];[0]${tela}[b];[b][l]overlay=x='(W-w)/2':y=270:eval=frame,${caixa(177, 232, 30, 38, '0xd8b040')},format=yuv420p`,
    '-t', '4', '-c:v', 'libvpx-vp9', '-b:v', '900k', videos.tela,
  ])
} catch {
  videos = null
}

const browser = await chromium.launch()
const erros = []
async function novoContexto(w, h, celular = true) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: celular ? 3 : 1, isMobile: celular, hasTouch: celular, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ body: 'whatsapp' }))
  return ctx
}
async function print(p, nome, cheia = false) {
  if (PRINTS) await p.screenshot({ path: join(PRINTS, `${nome}.png`), fullPage: cheia })
}
async function axe(p, nome) {
  if (!AXE) return
  await p.addScriptTag({ path: AXE })
  const v = await p.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map((x) => `${x.id} (${x.nodes.length}: ${x.nodes.map((n) => n.target.join(' ')).join(', ').slice(0, 200)})`))
  ok(v.length === 0, `axe ${nome}: ${v.join(', ') || '0 violações'}`)
}
const lateral = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 0.5)
// folha aberta: o corpo não rola pro lado e o + das vagas (quando tem) fica dentro dele
const semLadoNaFolha = (p) =>
  p.evaluate(() => {
    const c = document.querySelector('.pn-folha-corpo')
    if (!c) return false
    const mais = document.querySelector('.pn-folha-corpo button[aria-label="Uma vaga a mais"]')
    return c.scrollWidth <= c.clientWidth + 0.5 && (!mais || mais.getBoundingClientRect().right <= c.getBoundingClientRect().right + 0.5)
  })

try {
  const ctx = await novoContexto(390, 844)
  const p = await ctx.newPage()
  p.on('pageerror', (e) => erros.push(e.message))

  // instalar
  await p.goto(`${BASE}/painel/`)
  await p.getByLabel('Código de instalação').fill('dev-instalar-greencheese')
  await p.getByLabel('Teu nome').fill('Dono da Green')
  await p.getByLabel('Login').fill('dono')
  await p.getByLabel('Senha', { exact: true }).fill('senha-forte-123')
  await p.getByLabel('Repete a senha', { exact: true }).fill('senha-forte-123')
  await axe(p, 'primeiro acesso')
  await p.getByRole('button', { name: 'Criar acesso' }).tap()
  await p.getByText('Oi, Dono.').waitFor()
  ok(true, 'instalou com o código de desenvolvimento e entrou')
  await p.locator('.pn-rlinha').nth(1).waitFor()
  ok((await p.locator('.pn-rlinha').count()) === 2, 'resumo: os 2 rateios de exemplo abertos')
  await axe(p, 'resumo')

  // criar rateio com foto
  await p.getByRole('link', { name: 'Criar rateio' }).first().tap()
  await p.getByPlaceholder('Busca: Arizona, dichavador…').fill('isqueiro')
  await p.getByRole('button', { name: /Isqueiro Clipper/ }).tap()
  ok((await p.getByLabel('Nome do rateio').inputValue()) === 'Isqueiro Clipper', 'produto do catálogo preenche o nome')
  const [escolha] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Enviar foto').tap()])
  await escolha.setFiles(foto)
  await p.getByText('Trocar foto').waitFor({ timeout: 20000 })
  ok(true, 'foto do celular (3000×4000) subiu')
  await p.getByLabel('No rateio').fill('9,90')
  await p.getByLabel('Quando chegar').fill('14,99')
  ok(await p.getByText('Economia de R$ 5,09').isVisible(), 'mostra a economia')
  await p.getByLabel('Total de vagas').fill('3')
  for (const uf of ['São Paulo', 'Espírito Santo', 'Santa Catarina']) await p.getByRole('button', { name: uf }).tap()
  await axe(p, 'criar rateio')
  await print(p, 'criar', true)
  await p.getByRole('button', { name: 'Publicar no site' }).tap()
  await p.getByText('Publicado!').waitFor({ timeout: 15000 })
  ok(p.url().endsWith('#/rateio/isqueiro-clipper'), 'publicou e abriu o rateio')
  const pub = await (await fetch(`${BASE}/api/index.php?r=rateio&id=isqueiro-clipper`)).json()
  ok(pub.ok && pub.rateio.status === 'aberto' && /^uploads\/[0-9a-f]+\.\w+$/.test(pub.rateio.imagem) && pub.rateio.ufs.join() === 'rj,mg', 'o site já enxerga o rateio (aberto, com a foto, RJ e MG)')
  const img = await fetch(`${BASE}/${pub.rateio.imagem}`)
  ok(img.ok && /^image\//.test(img.headers.get('content-type') ?? ''), 'a foto abre pelo endereço do site')
  // o site público do mesmo build (/?rateio=<id>): quando o build já tem a aba Rateio, o rateio criado aparece nele
  if (siteComRateio) {
    const cs = await novoContexto(390, 844)
    await cs.addInitScript(() => {
      localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
      sessionStorage.setItem('gc-abertura', '1')
    })
    await cs.route(/ipwho|geojs/, (r) => r.fulfill({ json: { success: true, country_code: 'BR', region: 'Minas Gerais', region_code: 'MG', city: 'Teófilo Otoni' } }))
    const ps = await cs.newPage()
    ps.on('pageerror', (e) => erros.push(`site: ${e.message}`))
    await ps.goto(`${BASE}/?uf=mg&rateio=isqueiro-clipper`)
    // o título aparece em caixa-alta na Pixelify; vale o texto à vista na página, não um nó escondido
    const viu = await ps.waitForFunction(() => /isqueiro clipper/i.test(document.body.innerText) && /R\$\s?9,90/.test(document.body.innerText), null, { timeout: 15000 }).then(() => true, () => false)
    await print(ps, 'site-rateio')
    ok(viu, 'no site (/?rateio=isqueiro-clipper) o rateio criado no painel aparece')
    await cs.close()
  } else console.log('· este build do site ainda não tem a aba Rateio: o rateio foi conferido pela API pública (r=rateio)')

  // clientes entram pelo site
  const entra = async (nome, whatsapp, uf) => {
    const r = await fetch(`${BASE}/api/index.php?r=rateio-entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ rateio: 'isqueiro-clipper', nome, whatsapp, uf, quantidade: 1 }) })
    return r.status
  }
  ok((await entra('Ana Souza', '(21) 99876-5432', 'rj')) === 201 && (await entra('Bruno Lima', '33 98765-4321', 'mg')) === 201 && (await entra('Carla Dias', '+55 31 99123-4567', 'mg')) === 201, '3 clientes entram pelo site')
  await p.reload()
  await p.getByRole('heading', { name: /Participantes/ }).waitFor()
  ok(await p.getByText('+3 reservadas').isVisible(), 'o painel mostra as 3 reservas')
  await axe(p, 'rateio')

  async function confirmar(nome) {
    await p.getByRole('button', { name: `Confirmar pagamento de ${nome}` }).tap()
    const d = p.getByRole('alertdialog')
    await d.getByRole('button', { name: 'Confirmar pagamento' }).tap()
    const res = p.getByRole('dialog', { name: /Pagamento confirmado/ })
    await res.waitFor()
    const href = await res.getByRole('link', { name: /Avisar no WhatsApp/ }).getAttribute('href')
    ok(/^https:\/\/wa\.me\/55\d{11}\?text=/.test(href ?? '') && decodeURIComponent(href ?? '').includes('Pagamento confirmado'), `${nome}: "Avisar no WhatsApp" com a mensagem pronta`)
    const lotou = await res.getByText('Lotou!').isVisible()
    await res.getByRole('button', { name: 'Pronto' }).tap()
    await res.waitFor({ state: 'detached' })
    return lotou
  }
  await confirmar('Ana Souza')
  ok((await p.locator('.pn-contador-num').innerText()) === '1/3', 'confirmou: o contador sobe pra 1/3')
  await confirmar('Bruno Lima')
  ok(await confirmar('Carla Dias'), 'lotou: avisa que fechou sozinho')
  ok((await p.locator('.pn-det-cab .pn-selo').innerText()) === 'FECHOU', 'o rateio fechou sozinho')

  // avisar todos
  await p.getByRole('button', { name: /Avisar todos no WhatsApp/ }).tap()
  const av = p.getByRole('dialog', { name: /^Avisar/ })
  const [aba] = await Promise.all([ctx.waitForEvent('page'), av.getByRole('link', { name: /Avisar Ana Souza/ }).tap()])
  await aba.close()
  ok(await av.getByText('1 de 3 avisados').isVisible(), 'avisar todos: um link por pessoa, marca quem já foi')
  await axe(p, 'avisar todos')
  await av.getByRole('button', { name: /Termino depois/ }).tap()
  await av.waitFor({ state: 'detached' })

  async function passo(botao) {
    await p.getByRole('button', { name: botao, exact: true }).tap()
    const d = p.getByRole('alertdialog')
    await d.getByRole('button', { name: botao, exact: true }).tap()
    await d.waitFor({ state: 'detached' })
    const avisos = p.getByRole('dialog', { name: /^Avisar/ })
    await avisos.waitFor()
    await avisos.getByRole('button', { name: /Termino depois|Pronto/ }).tap()
    await avisos.waitFor({ state: 'detached' })
  }
  await passo('Pedido feito')
  await passo('A caminho')
  await passo('Chegou')
  ok((await p.locator('.pn-det-cab .pn-selo').innerText()) === 'CHEGOU', 'pedido feito → a caminho → chegou, cada um abrindo o "Avisar"')
  await p.getByRole('button', { name: 'Entregue pra Ana Souza' }).tap()
  await p.locator('.pn-pessoa-entregue').waitFor()
  ok(true, 'marcou a entrega da Ana')
  await print(p, 'rateio-chegou', true)

  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: /CSV/ }).tap()])
  const csv = readFileSync(await dl.path(), 'utf8')
  ok(csv.startsWith('﻿') && csv.split('\r\n').filter(Boolean).length === 4 && csv.includes('Ana Souza;'), `CSV pro Excel (${dl.suggestedFilename()})`)
  // sessão vencida: o CSV abre o login por cima e baixa depois de entrar (antes, o toque não fazia nada)
  sql('DELETE FROM sessoes')
  await p.getByRole('button', { name: /CSV/ }).tap()
  const caiu = p.getByRole('dialog', { name: 'Tua sessão acabou' })
  await caiu.waitFor()
  await caiu.getByLabel('Senha', { exact: true }).fill('senha-forte-123')
  const [dl2] = await Promise.all([p.waitForEvent('download'), caiu.getByRole('button', { name: 'Entrar e continuar' }).tap()])
  ok((await dl2.failure()) === null && /^rateio-isqueiro-clipper-\d{4}-\d{2}-\d{2}\.csv$/.test(dl2.suggestedFilename()), `CSV com a sessão vencida: entrou por cima e baixou (${dl2.suggestedFilename()})`)

  // incluir quem entrou pela DM
  await p.goto(`${BASE}/painel/#/rateio/arizona-green-tea`)
  await p.getByRole('button', { name: 'Incluir' }).tap()
  const fp = p.getByRole('dialog', { name: 'Incluir no rateio' })
  await fp.getByLabel('Nome').fill('Eduardo Rocha')
  await fp.getByLabel('WhatsApp').fill('5527999990000')
  await fp.getByLabel('Estado').selectOption('es')
  ok(await semLadoNaFolha(p), 'incluir: a folha não rola pro lado e o + fica dentro da caixa')
  // chegou no limite (o − voltou pro 1): o botão fica aria-disabled e o foco não sai dele nem da folha (Esc e Tab
  // continuam valendo; com disabled, o foco caía no body)
  await fp.getByRole('button', { name: 'Uma vaga a mais' }).tap()
  await fp.getByRole('button', { name: 'Uma vaga a menos' }).tap()
  ok(await p.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Uma vaga a menos' && document.activeElement.getAttribute('aria-disabled') === 'true' && !!document.activeElement.closest('[role="dialog"]')), 'no limite, o − fica aria-disabled com o foco nele (dentro da folha)')
  await fp.getByRole('button', { name: 'Uma vaga a mais' }).tap()
  await fp.getByText('Já pagou', { exact: true }).tap()
  await axe(p, 'incluir participante')
  await fp.getByRole('button', { name: /Incluir com as vagas pagas/ }).tap()
  await p.getByText('Eduardo Rocha entrou no rateio').waitFor()
  ok((await p.locator('.pn-contador-num').innerText()) === '2/24', 'incluiu já pago: o contador sobe 2')

  // robustez
  await p.goto(`${BASE}/painel/#/novo`)
  await p.getByRole('button', { name: /Não tá no catálogo/ }).tap()
  await p.getByLabel('Nome do rateio').fill('Bandeja RAW grande')
  await p.getByLabel('No rateio').fill('59,90')
  await p.waitForTimeout(500)
  await p.reload()
  await p.getByText('Continuando de onde tu parou').waitFor()
  ok((await p.getByLabel('Nome do rateio').inputValue()) === 'Bandeja RAW grande', 'rascunho: recarregou e o que tava digitado voltou')
  await p.getByLabel('Nome do rateio').fill('Backwoods Honey')
  ok(await p.getByText(/Tabaco e vape não entram no site/).first().isVisible(), 'tabaco: aviso na hora, sem sermão')
  await p.getByRole('button', { name: 'Publicar no site' }).tap()
  await p.waitForTimeout(300)
  ok(p.url().endsWith('#/novo') && (await p.evaluate(() => document.activeElement?.id)) === 'r-titulo', 'tabaco: não publica e o foco vai pro nome')
  await p.getByLabel('Nome do rateio').fill('Bandeja RAW grande')
  await p.route('**/api/index.php?r=admin-rateio-salvar*', (r) => r.abort())
  await p.getByRole('button', { name: 'Publicar no site' }).tap()
  await p.getByText('Sem conexão com o servidor').waitFor()
  ok((await p.getByLabel('No rateio').inputValue()) === '59,90', 'sem rede: mensagem clara e nada se perde')
  await p.unroute('**/api/index.php?r=admin-rateio-salvar*')
  sql('DELETE FROM sessoes')
  await p.getByRole('button', { name: 'Publicar no site' }).tap()
  const sessao = p.getByRole('dialog', { name: 'Tua sessão acabou' })
  await sessao.waitFor()
  await axe(p, 'sessão caiu')
  await sessao.getByLabel('Senha', { exact: true }).fill('senha-forte-123')
  await sessao.getByRole('button', { name: 'Entrar e continuar' }).tap()
  await p.getByText('Publicado!').waitFor({ timeout: 15000 })
  ok(p.url().endsWith('#/rateio/bandeja-raw-grande'), 'sessão caiu: entrou por cima e o publicar terminou sozinho')

  await fetch(`${BASE}/api/index.php?r=rateio-entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ rateio: 'bandeja-raw-grande', nome: 'Fernanda Melo', whatsapp: '(21) 97777-1111', uf: 'rj', quantidade: 1 }) })
  await p.reload()
  await p.getByRole('button', { name: 'Confirmar pagamento de Fernanda Melo' }).tap()
  let pedidos = 0
  p.on('request', (r) => r.url().includes('admin-participante-status') && pedidos++)
  await p.getByRole('alertdialog').getByRole('button', { name: 'Confirmar pagamento' }).evaluate((el) => {
    el.click()
    el.click()
    el.click()
  })
  await p.getByRole('dialog', { name: /Pagamento confirmado/ }).waitFor()
  ok(pedidos === 1, `toque triplo no confirmar: ${pedidos} pedido`)
  const url = p.url()
  await p.goBack()
  await p.getByRole('dialog').waitFor({ state: 'detached' })
  ok(p.url() === url, 'voltar do Android fecha a folha e fica na tela')
  // 1 de 10 paga e ninguém reservado: não é "tudo pago"
  const receber = await p.locator('dl').filter({ hasText: 'A receber' }).innerText()
  ok(/nenhuma reserva esperando/.test(receber) && !/tudo pago/.test(receber), `"A receber" com vaga livre: nenhuma reserva esperando (${receber.replace(/\s+/g, ' ')})`)
  await p.getByRole('button', { name: /Mais ações de Fernanda/ }).tap()
  await p.getByRole('dialog', { name: 'Fernanda Melo' }).waitFor()
  await p.keyboard.press('Escape')
  await p.getByRole('dialog').waitFor({ state: 'detached' })
  ok(true, 'Esc fecha a folha')

  await fluxoLoja({ p, BASE, ok, print, axe, foto, fotoClara, videos, browser, sharp })
  // classificar em massa por estado (22/10): Selecionar vários, a folha, a confirmação, o Desfazer, teclado e 360 px
  const entrarDono = async (pg) => {
    await pg.goto(`${BASE}/painel/`)
    await pg.getByLabel('Login').fill('dono')
    await pg.getByLabel('Senha', { exact: true }).fill('senha-forte-123')
    await pg.getByRole('button', { name: 'Entrar', exact: true }).click()
    await pg.getByText('Oi, Dono.').waitFor()
  }
  await fluxoMassa({ p, BASE, ok, print, axe, novoContexto, entrar: entrarDono })
  // a foto pesada do celular (22/10, limite de 32 MB): abre reduzida, sobe e o site serve a do tamanho de hoje
  await fluxoFoto({ BASE, ok, print, novoContexto, entrar: entrarDono, sharp, pasta: dados })
  // o Teste minha sorte: frequência, chances, raridade, chance real, simular e o teste da animação
  await fluxoSorte({ p, BASE, ok, print, axe, browser })

  // ─── o dono sem depender de ninguém ──────────────────────────────────────────────────────────────────────────────
  // o "+" da barra: Novo produto e Novo rateio
  await p.goto(`${BASE}/painel/#/`)
  await p.locator('.pn-pronto').waitFor()
  await p.locator('.pn-barra').getByRole('button', { name: 'Criar' }).tap()
  const criar = p.getByRole('dialog', { name: 'Criar' })
  await criar.waitFor()
  const opcoesCriar = (await criar.getByRole('link').allInnerTexts()).map((x) => x.split('\n')[0].trim())
  ok(opcoesCriar.join(' · ') === 'Novo produto · Novo rateio', `o + da barra: Novo produto e Novo rateio (${opcoesCriar.join(' · ')})`)
  await axe(p, 'criar')
  await print(p, 'criar-folha')
  await criar.getByRole('link', { name: /Novo rateio/ }).tap()
  await p.waitForFunction(() => location.hash === '#/novo', null, { timeout: 5000 })
  ok(true, '"Novo rateio" abre o Criar rateio')
  await p.goBack()
  await p.waitForFunction(() => location.hash === '#/' || location.hash === '', null, { timeout: 5000 })
  ok((await p.getByRole('dialog').count()) === 0, 'voltar do Criar rateio cai no Início (a folha não fica no caminho)')
  // a lista "Pra deixar a loja pronta": cada item leva à tela; pular tira da lista (com Desfazer)
  const pronto = p.locator('.pn-pronto')
  ok(/Pra deixar a loja pronta/.test(await pronto.innerText()) && (await pronto.getByText('Troca a senha que veio na entrega').count()) === 1, 'Início: a lista "Pra deixar a loja pronta" (a senha da entrega primeiro)')
  ok((await pronto.getByText('Horário e taxa de cada estado').count()) === 1, 'a lista vê os estados com horário ou taxa de exemplo')
  await axe(p, 'início com a lista')
  await print(p, 'inicio-lista', true)
  await pronto.getByRole('button', { name: 'Pular: Horário e taxa de cada estado' }).tap()
  await p.getByText('“Horário e taxa de cada estado” saiu da lista.').waitFor()
  ok((await pronto.getByText('Horário e taxa de cada estado').count()) === 0, 'pular: o item sai da lista')
  await p.locator('.pn-recados').getByRole('button', { name: 'Desfazer' }).tap()
  await pronto.getByText('Horário e taxa de cada estado').waitFor()
  ok(true, 'Desfazer: o item volta')
  await pronto.getByRole('link', { name: /Troca a senha que veio na entrega/ }).tap()
  await p.waitForFunction(() => location.hash === '#/conta', null, { timeout: 5000 })
  ok(true, 'o item leva à tela certa (a senha: Conta)')
  // Conta: cópia de segurança com "última cópia", senha com "Mostrar", a senha esquecida e o rodapé
  await p.getByRole('heading', { name: 'Cópia de segurança' }).waitFor()
  ok(await p.getByText('Nenhuma cópia ainda.').isVisible(), 'Conta: "Nenhuma cópia ainda" (antes, a cópia morava em Servidor, no fim)')
  ok((await p.getByRole('button', { name: 'Mostrar a senha' }).count()) === 3, 'Conta: os três campos de senha com "Mostrar a senha"')
  ok(/Só tu é dono/.test(await p.locator('.pn-senha-esquecida').innerText()) && /código de instalação novo/.test(await p.locator('.pn-senha-esquecida').innerText()), 'Conta: se esquecer a senha (2º dono; sem os Avisos, o WhatsApp não vale; o código de instalação por último)')
  ok((await p.locator('.pn-rodape-painel').innerText()).trim() === '© 2026 Green Cheese Imports · painel por I&H Soluções Digitais', 'Conta: o rodapé da loja')
  const [copia] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Baixar cópia de segurança' }).tap()])
  ok(/^greencheese-loja-\d{4}-\d{2}-\d{2}-\d{4}\.sqlite$/.test(copia.suggestedFilename()), `Conta: baixou a cópia (${copia.suggestedFilename()})`)
  await p.getByText(/^Cópia baixada \(greencheese-loja-.*Guarda fora do celular/).waitFor()
  ok(await p.getByText('Última cópia: hoje.').isVisible(), 'depois de baixar: "Última cópia: hoje" e o recado embaixo (antes, nenhum recado)')
  await axe(p, 'conta com a cópia')
  await print(p, 'conta-dono', true)
  // a lista não pede mais a 1ª cópia; passou de 7 dias, o Início lembra
  sql(`UPDATE ajustes SET valor = '${Math.floor(Date.now() / 1000) - 8 * 86400}' WHERE chave = 'copia_em'`)
  await p.goto(`${BASE}/painel/#/`)
  await p.locator('.pn-lembrete-copia').waitFor()
  ok(/Faz uma cópia de segurança/.test(await p.locator('.pn-lembrete-copia').innerText()) && /há 8 dias/.test(await p.locator('.pn-lembrete-copia').innerText()), 'Início: passou de 7 dias, lembra a cópia ("há 8 dias")')
  ok((await p.locator('.pn-pronto').getByText('Baixar a 1ª cópia de segurança').count()) === 0, 'a lista não pede mais a 1ª cópia')
  const [copia2] = await Promise.all([p.waitForEvent('download'), p.locator('.pn-lembrete-copia').getByRole('button', { name: 'Baixar agora' }).tap()])
  ok(/\.sqlite$/.test(copia2.suggestedFilename()), 'o lembrete baixa com 1 toque')
  await p.locator('.pn-lembrete-copia').waitFor({ state: 'detached' })
  ok(true, 'baixou: o lembrete some')
  // o Diagnóstico que falha não esconde a cópia
  await p.route('**/api/index.php?r=admin-diagnostico*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"erro":"erro-interno","mensagem":"Deu erro aqui. Tenta de novo."}' }))
  await p.goto(`${BASE}/painel/#/servidor`)
  await p.getByText('Deu erro aqui. Tenta de novo.').waitFor()
  ok(await p.getByRole('button', { name: 'Baixar cópia de segurança' }).isVisible(), 'Diagnóstico que falhou: a cópia de segurança continua à vista (antes, sumia)')
  await p.unroute('**/api/index.php?r=admin-diagnostico*')
  // Mais: tudo agrupado, com o guia e o rodapé
  await p.goto(`${BASE}/painel/#/`)
  await p.locator('.pn-barra').getByRole('link', { name: 'Mais' }).tap()
  await p.getByRole('heading', { name: 'Mais', level: 1 }).waitFor()
  const grupos = (await p.locator('.pn-mais-grupo h2').allInnerTexts()).map((x) => x.trim())
  ok(grupos.join(' · ') === 'Dia a dia · Loja · Configurações da loja · Ajuda · Tua conta', `Mais: os grupos (${grupos.join(' · ')})`)
  const config = await p.locator('.pn-mais-grupo').filter({ hasText: 'Configurações da loja' }).innerText()
  ok(['Avisos no WhatsApp', 'Textos do pedido', 'Categorias', 'Equipe', 'Clientes', 'Diagnóstico'].every((x) => config.includes(x)), 'Mais: o que se configura uma vez junto (Avisos, Textos, Categorias, Equipe, Clientes, Diagnóstico)')
  ok((await p.locator('.pn-barra-item.ativa').innerText()).trim() === 'Mais', 'a barra acende Mais')
  ok((await p.locator('.pn-rodape-painel').count()) === 1, 'Mais: o rodapé da loja')
  await axe(p, 'mais')
  await print(p, 'mais', true)
  await p.getByRole('link', { name: /^Como usar o painel/ }).tap()
  await p.getByRole('heading', { name: 'Como usar o painel', level: 1 }).waitFor()
  const tarefas = await p.locator('.pn-ajuda-item summary').allInnerTexts()
  ok(tarefas.length >= 10 && tarefas.length <= 12, `Como usar o painel: ${tarefas.length} tarefas do dono`)
  ok(['Mudar o preço de um produto', 'Marcar que acabou (esgotado)', 'Trocar a foto de um produto', 'Cadastrar um produto novo', 'Confirmar um pedido', 'Criar um rateio e confirmar o pagamento', 'Mudar o horário e a taxa de entrega', 'Pôr entrega grátis num dia', 'Trocar os produtos dos stories', 'Dar acesso pra alguém da equipe', 'Fazer a cópia de segurança', 'O aviso do WhatsApp não chegou'].every((x) => tarefas.some((t) => t.includes(x))), 'Como usar: as tarefas do dia a dia, do preço ao aviso que não chegou')
  await p.locator('.pn-ajuda-item summary').filter({ hasText: 'Mudar o preço de um produto' }).tap()
  const passos = await p.locator('#ajuda-preco ol li').count()
  ok(passos >= 2 && passos <= 4, `cada tarefa em 2 a 4 passos (${passos})`)
  await axe(p, 'como usar')
  await print(p, 'como-usar', true)
  await p.locator('#ajuda-preco').getByRole('link', { name: 'Abrir Produtos' }).tap()
  await p.waitForFunction(() => location.hash === '#/produtos', null, { timeout: 5000 })
  ok(true, 'o botão da tarefa leva à tela')

  // conta: trocar senha, sair, entrar com a nova
  await p.goto(`${BASE}/painel/#/conta`)
  await p.getByLabel('Senha de agora').fill('senha-forte-123')
  await p.getByLabel('Senha nova', { exact: true }).fill('outra-senha-boa-456')
  await p.getByLabel('Repete a senha nova').fill('outra-senha-boa-456')
  await p.getByRole('button', { name: 'Trocar a senha' }).tap()
  await p.getByText('Senha trocada.').waitFor()
  await axe(p, 'conta')
  await p.getByRole('button', { name: 'Sair do painel' }).tap()
  await p.getByRole('heading', { name: 'Painel da loja' }).waitFor()
  ok(await p.getByText('Entra pra cuidar da loja: pedidos, produtos e rateios.').isVisible(), 'Entrar: fala da loja inteira (antes, "pra cuidar dos rateios")')
  await p.getByRole('button', { name: 'Esqueci a senha' }).tap()
  await p.getByRole('heading', { name: 'Esqueci a senha' }).waitFor()
  const jeitos = await p.locator('.pn-esqueci').innerText()
  ok(/É da equipe/.test(jeitos) && /Pede pro dono gerar uma senha provisória/.test(jeitos), 'Esqueci a senha: quem é da equipe resolve com o dono')
  ok((await p.getByRole('button', { name: 'Receber o código no WhatsApp da loja' }).count()) === 0, 'Esqueci a senha: sem os Avisos ligados, não oferece o código no WhatsApp')
  await axe(p, 'esqueci a senha')
  await print(p, 'esqueci')
  await p.getByRole('button', { name: 'Lembrei a senha' }).tap()
  await p.getByRole('heading', { name: 'Painel da loja' }).waitFor()
  await p.getByLabel('Senha', { exact: true }).fill('senha-forte-123')
  await p.getByRole('button', { name: 'Entrar', exact: true }).tap()
  await p.getByText('Login ou senha não confere.').waitFor()
  ok(true, 'a senha velha não entra mais')
  await p.getByLabel('Senha', { exact: true }).fill('outra-senha-boa-456')
  await p.getByRole('button', { name: 'Entrar', exact: true }).tap()
  await p.getByText('Oi, Dono.').waitFor()
  ok(true, 'trocou a senha, saiu e entrou com a nova')
  await p.locator('.pn-pronto').waitFor()
  ok((await p.locator('.pn-pronto').getByText('Troca a senha que veio na entrega').count()) === 0, 'a lista: a senha trocada sai sozinha (calculada do estado de verdade)')
  for (const [nome, rota, espera] of [['atividade', '#/atividade', 'Hoje'], ['servidor', '#/servidor', /Fechado pra quem não deve/], ['rateios', '#/rateios', 'Em andamento']]) {
    await p.goto(`${BASE}/painel/${rota}`)
    await p.getByRole('heading', { name: espera }).waitFor({ timeout: 20000 })
    await axe(p, nome)
  }
  await ctx.close()

  // teclado, deitado e 320 px
  const k = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const t = await k.newPage()
  await t.goto(`${BASE}/painel/`)
  await t.getByLabel('Login').waitFor()
  await t.keyboard.type('dono')
  await t.keyboard.press('Tab')
  await t.keyboard.type('outra-senha-boa-456')
  await t.keyboard.press('Enter')
  await t.getByText('Oi, Dono.').waitFor()
  await t.keyboard.press('Tab')
  ok(/Pular pro conteúdo/.test((await t.evaluate(() => document.activeElement?.textContent)) ?? ''), 'teclado: entra só com Tab/Enter; o primeiro Tab cai no "Pular pro conteúdo"')
  await k.close()
  {
    const c = await novoContexto(768, 1024)
    const q = await c.newPage()
    await q.goto(`${BASE}/painel/`)
    await q.getByLabel('Login').fill('dono')
    await q.getByLabel('Senha', { exact: true }).fill('outra-senha-boa-456')
    await q.getByRole('button', { name: 'Entrar', exact: true }).tap()
    await q.getByText('Oi, Dono.').waitFor()
    ok((await q.locator('.pn-lateral').isVisible()) && !(await q.locator('.pn-barra').isVisible()), 'tablet (768): a lateral no lugar da barra de baixo')
    ok(await lateral(q), 'tablet (768): sem rolagem lateral')
    await print(q, 'tablet-inicio', true)
    await c.close()
  }
  for (const [w, h] of [[844, 390], [320, 568]]) {
    const c = await novoContexto(w, h)
    const q = await c.newPage()
    await q.goto(`${BASE}/painel/`)
    await q.getByLabel('Login').fill('dono')
    await q.getByLabel('Senha', { exact: true }).fill('outra-senha-boa-456')
    await q.getByRole('button', { name: 'Entrar', exact: true }).tap()
    await q.getByText('Oi, Dono.').waitFor()
    let todas = true
    for (const rota of ['#/', '#/rateios', '#/rateio/isqueiro-clipper', '#/novo', '#/conta', '#/servidor', '#/atividade', ...ROTAS_LOJA]) {
      await q.goto(`${BASE}/painel/${rota}`)
      await q.waitForTimeout(500)
      if (!(await lateral(q))) {
        todas = false
        ok(false, `${w}×${h} ${rota}: rolagem lateral`)
      }
    }
    ok(todas, `${w}×${h}: nenhuma tela com rolagem lateral`)
    if (w === 320) {
      // Produtos: o "Organizar" com o nome à vista ("Ordem" no estreito) e o título "Produtos" numa linha (antes, "Produto/s")
      await q.goto(`${BASE}/painel/#/produtos`)
      await q.getByRole('heading', { name: 'Produtos', level: 1 }).waitFor()
      const topoP = await q.evaluate(() => {
        const h1 = document.querySelector('.pn-topo .pn-h1')
        const b = document.querySelector('.pn-botao-organizar')
        const linha = parseFloat(getComputedStyle(h1).lineHeight) || 28
        return { linhas: Math.round(h1.getBoundingClientRect().height / linha), botao: b?.innerText.trim(), dentro: !!b && b.getBoundingClientRect().right <= innerWidth }
      })
      ok(topoP.linhas === 1 && topoP.botao === 'Ordem' && topoP.dentro, `320: Produtos com o título numa linha e o botão da ordem com o nome à vista (${JSON.stringify(topoP)})`)
    }
    // as folhas com o número de vagas (incluir e editar) também não rolam pro lado
    await q.goto(`${BASE}/painel/#/rateio/arizona-green-tea`)
    await q.getByRole('button', { name: 'Incluir', exact: true }).tap()
    await q.getByRole('dialog', { name: 'Incluir no rateio' }).waitFor()
    await q.waitForTimeout(400)
    const incluir = await semLadoNaFolha(q)
    await q.getByRole('dialog', { name: 'Incluir no rateio' }).getByRole('button', { name: 'Fechar', exact: true }).tap()
    await q.getByRole('button', { name: /Mais ações de Eduardo/ }).tap()
    await q.getByRole('dialog', { name: 'Eduardo Rocha' }).getByRole('button', { name: 'Editar dados' }).tap()
    await q.getByRole('dialog', { name: /^Editar RAT-/ }).waitFor()
    await q.waitForTimeout(400)
    ok(incluir && (await semLadoNaFolha(q)), `${w}×${h}: as folhas de incluir e editar não rolam pro lado (o + fica dentro)`)
    await c.close()
  }
  // pedidos, avisos no WhatsApp e textos do pedido guiado (scripts/testar-painel-pedidos.mjs), com a senha nova do dono
  const { fluxoPedidos } = await import('./testar-painel-pedidos.mjs')
  await fluxoPedidos({ browser, novoContexto, BASE, ok, print, axe, lateral, erros, login: 'dono', senha: 'outra-senha-boa-456', nome: 'Dono da Green', prints: PRINTS })
  // equipe (papéis e estados), clientes e a conta do site no servidor (scripts/testar-painel-contas.mjs, num PHP próprio
  // com o Z-API falso que recebe o código de entrada)
  const { fluxoContas } = await import('./testar-painel-contas.mjs')
  await fluxoContas({ browser, build, ok, axe, erros, prints: PRINTS })
} catch (e) {
  ok(false, `exceção: ${e.stack}`)
  for (const c of browser.contexts()) for (const pg of c.pages()) if (PRINTS) await pg.screenshot({ path: join(PRINTS, `falha-${Date.now()}.png`) }).catch(() => {})
} finally {
  await browser.close()
  derrubar()
  rmSync(dados, { recursive: true, force: true })
}
ok(erros.length === 0, `sem erro de JavaScript na página (${erros.join(' | ') || 'nenhum'})`)
console.log(falhas ? `${falhas} problema(s) em ${checagens} checagens` : `${checagens} checagens · painel ok`)
process.exit(falhas ? 1 : 0)
