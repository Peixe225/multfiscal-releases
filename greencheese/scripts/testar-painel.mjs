// Teste do painel do dono no navegador (Chromium do Playwright), contra a API de verdade: php -S com pasta de dados
// temporária + vite preview do build (o mesmo proxy de /api e /uploads do desenvolvimento).
// Fluxo: instalar → entrar → criar rateio com foto do celular → publicar → clientes entram pela API (como o site faz)
// → reservas no painel → confirmar (o contador sobe) → lota → fecha sozinho → avisar todos → pedido feito → a caminho
// → chegou → entregue → CSV → incluir quem veio pela DM → trocar senha → sair → entrar com a nova. E a robustez:
// rascunho guardado, tabaco recusado, erro de rede, sessão que cai no meio (o salvar e o CSV terminam sozinhos depois
// de entrar), toque duplo, voltar do Android fecha a folha, teclado, celular deitado, 320 px sem rolagem lateral (nas
// telas e nas folhas de incluir e editar, com o + das vagas dentro da caixa).
// Também confere o HTML do painel (noindex, título, manifesto, caminhos relativos, sem o CSS do site) e que o site
// não carrega nada do painel.
// Uso: node scripts/testar-painel.mjs <pasta-do-build>   (termina com "painel ok")
// GC_TESTE_PORTA = porta do PHP (a do preview é a seguinte, ou GC_TESTE_PORTA_SITE); GC_PRINTS=<pasta> guarda os prints; GC_AXE=<axe.min.js>
// roda o axe em cada tela; PHP=/caminho troca o binário.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const php = spawn(PHP, ['-d', 'display_errors=0', '-d', 'upload_max_filesize=8M', '-d', 'post_max_size=10M', '-S', `127.0.0.1:${portaPhp}`, '-t', join(raiz, 'public'), join(raiz, 'scripts', 'api-dev.php')], {
  env: { ...process.env, PHP_CLI_SERVER_WORKERS: '4', GC_DADOS: dados, GC_UPLOADS: join(dados, 'uploads') },
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
  const v = await p.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map((x) => `${x.id} (${x.nodes.length})`))
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
  await p.getByLabel('Senha', { exact: true }).fill('senha-forte-123')
  await p.getByRole('button', { name: 'Entrar', exact: true }).tap()
  await p.getByText('Login ou senha não confere.').waitFor()
  ok(true, 'a senha velha não entra mais')
  await p.getByLabel('Senha', { exact: true }).fill('outra-senha-boa-456')
  await p.getByRole('button', { name: 'Entrar', exact: true }).tap()
  await p.getByText('Oi, Dono.').waitFor()
  ok(true, 'trocou a senha, saiu e entrou com a nova')
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
  for (const [w, h] of [[844, 390], [320, 568]]) {
    const c = await novoContexto(w, h)
    const q = await c.newPage()
    await q.goto(`${BASE}/painel/`)
    await q.getByLabel('Login').fill('dono')
    await q.getByLabel('Senha', { exact: true }).fill('outra-senha-boa-456')
    await q.getByRole('button', { name: 'Entrar', exact: true }).tap()
    await q.getByText('Oi, Dono.').waitFor()
    let todas = true
    for (const rota of ['#/', '#/rateios', '#/rateio/isqueiro-clipper', '#/novo', '#/conta', '#/servidor', '#/atividade']) {
      await q.goto(`${BASE}/painel/${rota}`)
      await q.waitForTimeout(500)
      if (!(await lateral(q))) {
        todas = false
        ok(false, `${w}×${h} ${rota}: rolagem lateral`)
      }
    }
    ok(todas, `${w}×${h}: nenhuma tela com rolagem lateral`)
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
