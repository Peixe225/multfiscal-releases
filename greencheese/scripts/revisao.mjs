// Revisão por screenshots (seção 10 do briefing) + teste do fluxo até o link do WhatsApp (RJ e MG), com a navegação
// em abas (Início | Catálogo | Por estado), as sequências de voltar, os links diretos, a Home 2, a matriz de desktop
// e o axe em cada aba.
// Uso: npm run dev (em outro terminal) e depois: node scripts/revisao.mjs [rodada] [url-base]
// IP e CEP são simulados para o resultado ser repetível.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers'
const { chromium } = await import(new URL('../node_modules/playwright/index.mjs', import.meta.url).href)
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const rodada = process.argv[2] ?? 'r1'
const base = process.argv[3] ?? 'http://localhost:5173/'
const dir = new URL(`../revisao/${rodada}/`, import.meta.url).pathname
mkdirSync(dir, { recursive: true })

/** axe-core (não é dependência do projeto): AXE=caminho, ou <tmp>/<pasta>/axe/node_modules/axe-core, ou o node_modules. */
function acharAxe() {
  if (process.env.AXE) return process.env.AXE
  try {
    for (const d of readdirSync(tmpdir())) {
      const c = join(tmpdir(), d, 'axe/node_modules/axe-core/axe.min.js')
      if (existsSync(c)) return c
    }
  } catch {
    /* sem acesso ao tmp */
  }
  const local = new URL('../node_modules/axe-core/axe.min.js', import.meta.url).pathname
  return existsSync(local) ? local : ''
}
const AXE = acharAxe()

const erros = []
const relatorio = []

// As mensagens do WhatsApp não podem mudar (só a linha "Entrega:", que traz o endereço do CEP simulado)
const REFERENCIA = {
  mg: "PEDIDO GREEN CHEESE — MG / Teófilo Otoni\n1x Jack Daniel's Old No. 7 1 L — R$ 149,90\n3x Seda OCB Premium Slim — R$ 19,99\nSubtotal: R$ 169,89\nEntrega: …\nPagamento: Pix\nNome: Ian Teste\nObs.: Portão azul",
  rj: "PEDIDO GREEN CHEESE — RJ / Rio de Janeiro\n1x Jack Daniel's Old No. 7 1 L — R$ 149,90\n3x Seda OCB Premium Slim — R$ 19,99\nSubtotal: R$ 169,89\nEntrega: …\nPagamento: Pix\nNome: Ian Teste\nObs.: Portão azul",
}
function conferirMensagem(uf, texto) {
  const semEntrega = texto.replace(/^Entrega: .*$/m, 'Entrega: …')
  if (semEntrega !== REFERENCIA[uf]) erros.push(`[mensagem ${uf}] mudou:\n--- referência\n${REFERENCIA[uf]}\n--- agora\n${semEntrega}`)
  else relatorio.push(`mensagem ${uf}: igual à referência`)
}

async function contexto(browser, viewport, opts = {}) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: viewport.width < 600 ? 3 : 1,
    hasTouch: viewport.width < 600,
    isMobile: viewport.width < 600,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    reducedMotion: opts.reduzir ? 'reduce' : 'no-preference',
  })
  await ctx.route(/ipwho\.is/, (r) => r.fulfill({ json: { success: true, country_code: 'BR', region: opts.ipRegiao ?? 'Minas Gerais', region_code: opts.ipUf ?? 'MG' } }))
  await ctx.route(/geojs\.io/, (r) => r.fulfill({ json: { country_code: 'BR', region: opts.ipRegiao ?? 'Minas Gerais' } }))
  await ctx.route(/brasilapi\.com\.br\/api\/cep/, (r) => {
    const cep = r.request().url().split('/').pop()
    if (cep.startsWith('398')) return r.fulfill({ json: { cep, state: 'MG', city: 'Teófilo Otoni', neighborhood: 'Centro', street: 'Rua Doutor Manoel Esteves' } })
    if (cep.startsWith('2')) return r.fulfill({ json: { cep, state: 'RJ', city: 'Rio de Janeiro', neighborhood: 'Copacabana', street: 'Rua Barata Ribeiro' } })
    if (cep.startsWith('01')) return r.fulfill({ json: { cep, state: 'SP', city: 'São Paulo', neighborhood: 'Sé', street: 'Praça da Sé' } })
    return r.fulfill({ status: 404, json: { message: 'not found' } })
  })
  await ctx.route(/viacep\.com\.br/, (r) => r.fulfill({ json: { erro: true } }))
  if (opts.semDica) await ctx.addInitScript(() => sessionStorage.setItem('gc-dica-hero', '1'))
  return ctx
}

function vigiar(page, nome) {
  page.on('console', (m) => {
    if (m.type() === 'error') erros.push(`[${nome}] console: ${m.text()}`)
  })
  page.on('pageerror', (e) => erros.push(`[${nome}] pageerror: ${e.message}`))
}

async function foto(page, nome, cheia = false) {
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${dir}${nome}.png`, fullPage: cheia })
  relatorio.push(nome)
}

async function passarAbertura(page) {
  const tenho = page.getByRole('button', { name: 'Tenho', exact: true })
  await tenho.waitFor({ timeout: 8000 })
  await tenho.click()
  // sem ?uf, o palpite de IP é confirmado no quadro do local da própria abertura ("Você está em …?" [Sim | Trocar])
  const sim = page.locator('.abertura .enquete').getByRole('button', { name: 'Sim', exact: true })
  await Promise.race([
    page.locator('.abertura').waitFor({ state: 'detached', timeout: 8000 }),
    sim.waitFor({ timeout: 8000 }).then(() => sim.click()).catch(() => {}),
  ])
  await page.locator('.abertura').waitFor({ state: 'detached', timeout: 8000 })
  await page.waitForTimeout(400)
}

/** Troca de aba pela barra do celular ou pela lateral do desktop e espera a vista aparecer. */
async function irAba(page, aba) {
  await page.locator(`[data-aba="${aba}"]:visible`).first().click()
  const alvo = aba === 'catalogo' ? '#catalogo, #catalogo-titulo' : aba === 'estados' ? '#estados' : '.hero, .sem'
  await page.locator(`.vista:not([hidden]) :is(${alvo})`).first().waitFor({ state: 'visible', timeout: 6000 })
  await page.waitForTimeout(300)
}
const abaAberta = (page) => page.evaluate(() => document.querySelector('.vista:not([hidden])')?.dataset.vista ?? null)
function conferir(cond, msg) {
  if (!cond) erros.push(msg)
  else relatorio.push(`ok: ${msg}`)
}
async function voltar(page) {
  await page.goBack({ waitUntil: 'commit' }).catch(() => {})
  await page.waitForTimeout(700)
}

async function clicar(page, nome) {
  await page.getByRole('button', { name: nome, exact: true }).last().click()
  await page.waitForTimeout(250)
}

async function digitar(page, texto) {
  const campo = page.locator('.dm-entrada input')
  await campo.fill(texto)
  await page.locator('.dm-entrada').evaluate((f) => f.requestSubmit())
  await page.waitForTimeout(300)
}

async function fluxoPedido(page, uf, cep, nomeArq) {
  // monta a sacola pela aba Catálogo: Jack com 1; depois a seda OCB com 3 (combo)
  await irAba(page, 'catalogo')
  await page.getByRole('button', { name: /Jack Daniel's.*Abrir story/ }).click()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'Pôr na sacola' }).click()
  await page.waitForTimeout(900)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: /Seda OCB Premium Slim.*Abrir story/ }).click()
  await page.waitForTimeout(900)
  const tres = page.getByRole('radio', { name: /3 por/ })
  if (await tres.count()) await tres.click()
  await page.getByRole('button', { name: 'Pôr na sacola' }).click()
  await page.waitForTimeout(900)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  // sacola (aba da barra no celular, item da lateral no desktop)
  await page.locator('.barra-abas [data-aba="sacola"]:visible, .lateral-item:has-text("Sacola"):visible').first().click()
  await page.waitForTimeout(700)
  await foto(page, `${nomeArq}-sacola`)
  await page.getByRole('button', { name: 'Fazer pedido' }).click()
  await page.waitForTimeout(700)
  // chat
  await clicar(page, 'Isso')
  await clicar(page, 'Tá certo')
  await digitar(page, 'Ian Teste')
  await digitar(page, cep)
  await page.waitForTimeout(500)
  await digitar(page, '120, apto 201')
  await clicar(page, 'Pix')
  await digitar(page, 'Portão azul')
  await page.waitForTimeout(500)
  await foto(page, `${nomeArq}-chat-resumo`)
  const href = await page.getByRole('link', { name: /Enviar no WhatsApp/ }).getAttribute('href')
  const texto = decodeURIComponent(href.split('text=')[1] ?? '')
  conferirMensagem(uf, texto)
  return { uf, href, texto }
}

/** axe em cada aba (0 violações). */
async function axeNasAbas(page, nome) {
  if (!AXE || !existsSync(AXE)) return relatorio.push("axe: axe-core não encontrado (AXE=caminho), pulei")
  await page.addScriptTag({ path: AXE })
  for (const aba of ['inicio', 'catalogo', 'estados']) {
    if ((await abaAberta(page)) !== aba) await irAba(page, aba)
    await page.waitForTimeout(400)
    const v = await page.evaluate(async () => {
      const r = await window.axe.run(document, { resultTypes: ['violations'] })
      return r.violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)
    })
    if (v.length) erros.push(`[axe ${nome} ${aba}] ${v.join('; ')}`)
    else relatorio.push(`axe ${nome} ${aba}: 0 violações`)
  }
}

const browser = await chromium.launch()

// ---------- celular 390×844 ----------
{
  const ctx = await contexto(browser, { width: 390, height: 844 })
  const page = await ctx.newPage()
  vigiar(page, 'cel')
  await page.goto(base)
  await page.waitForTimeout(700)
  await foto(page, 'cel-01-abertura-logo')
  await page.getByRole('button', { name: 'Tenho', exact: true }).waitFor({ timeout: 8000 })
  await page.waitForTimeout(900)
  await foto(page, 'cel-02-abertura-18')
  await page.getByRole('button', { name: 'Tenho', exact: true }).click()
  // o palpite de IP (MG) é perguntado no quadro do local da abertura, embaixo do adesivo — não na home
  const simAbertura = page.locator('.abertura .enquete').getByRole('button', { name: 'Sim', exact: true })
  await simAbertura.waitFor({ timeout: 8000 })
  await page.waitForTimeout(500)
  await foto(page, 'cel-03-abertura-adesivo')
  await simAbertura.click()
  await page.locator('.abertura').waitFor({ state: 'detached', timeout: 8000 })
  await page.waitForTimeout(600)
  await foto(page, 'cel-04-hero-palpite-ip')
  await page.waitForTimeout(500)
  await foto(page, 'cel-05-hero-confirmado')
  await page.evaluate(() => document.querySelector('.vista:not([hidden]) .so-celular .perfil')?.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(600)
  await foto(page, 'cel-06-perfil')
  await foto(page, 'cel-16-home-inteira', true)
  conferir(!(await page.locator('.vista[data-vista="inicio"] #catalogo, .vista[data-vista="inicio"] #estados').count()), 'cel: o Início termina no story + perfil + rodapé')
  await page.evaluate(() => window.scrollTo(0, 0))
  await irAba(page, 'catalogo')
  await foto(page, 'cel-07-catalogo')
  await page.evaluate(() => window.scrollBy(0, 900))
  await page.waitForTimeout(800)
  await foto(page, 'cel-08-catalogo-indisponivel')
  await page.getByRole('button', { name: /Piteira de vidro RAW.*Abrir story/ }).click().catch(() => {})
  await page.waitForTimeout(1200)
  await foto(page, 'cel-09-story-indisponivel')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: /Gin Tanqueray.*Abrir story/ }).click()
  await page.waitForTimeout(1300)
  await foto(page, 'cel-10-story-produto')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  conferir((await abaAberta(page)) === 'catalogo', 'cel: fechar o story continua no Catálogo')
  const mg = await fluxoPedido(page, 'mg', '39800001', 'cel-11-mg')
  relatorio.push({ mg })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await irAba(page, 'estados')
  await page.waitForTimeout(1300)
  await foto(page, 'cel-12-por-estado')
  await axeNasAbas(page, 'cel h1')
  await ctx.close()
}

// ---------- RJ pelo link da bio ----------
{
  const ctx = await contexto(browser, { width: 390, height: 844 })
  const page = await ctx.newPage()
  vigiar(page, 'rj')
  await page.goto(`${base}?uf=rj`)
  await passarAbertura(page)
  await foto(page, 'cel-13-rj-hero')
  // OCB e Jack no RJ
  const rj = await fluxoPedido(page, 'rj', '22041001', 'cel-14-rj')
  relatorio.push({ rj })
  await ctx.close()
}

// ---------- estado sem atendimento ----------
{
  const ctx = await contexto(browser, { width: 390, height: 844 })
  const page = await ctx.newPage()
  vigiar(page, 'ba')
  await page.goto(`${base}?uf=ba`)
  await passarAbertura(page)
  await foto(page, 'cel-15-sem-atendimento')
  conferir((await page.locator('.barra-abas a, .barra-abas button').count()) === 4, 'ba: 4 abas (sem a Sorte)')
  await irAba(page, 'catalogo')
  await foto(page, 'cel-15b-sem-atendimento-catalogo')
  conferir((await page.locator('.sem-entrega').count()) === 1, 'ba: Catálogo mostra "Esse estado ainda não tem entrega."')
  await ctx.close()
}

// ---------- Home 2 no celular: passo do mercador, rosto na barra, balão ----------
{
  const ctx = await contexto(browser, { width: 390, height: 844 }, { semDica: true })
  const page = await ctx.newPage()
  vigiar(page, 'cel-h2')
  await page.goto(`${base}?uf=mg&home=2`)
  await passarAbertura(page)
  await foto(page, 'cel-17-home2')
  conferir((await page.locator('.barra-abas .aba-mercador').count()) === 1, 'h2: rosto do mercador na barra')
  const q = await page.locator('.hero-quadro').boundingBox()
  await page.touchscreen.tap(q.x + q.width * 0.92, q.y + q.height * 0.3)
  await page.waitForTimeout(1000)
  conferir((await page.locator('.hero-palco .sm-passo').count()) === 1, 'h2: o 2º passo do story é o mercador')
  conferir(await page.evaluate(() => getComputedStyle(document.querySelector('.hero-palco .q-aberto')).visibility === 'visible'), 'h2: o casaco abre logo que o passo entra')
  await foto(page, 'cel-17b-home2-mercador')
  await page.locator('.balao-mercador').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
  conferir((await page.locator('.balao-mercador').count()) === 1, 'h2: balão do mercador depois do passo')
  await foto(page, 'cel-17c-home2-balao')
  await ctx.close()
}

// ---------- voltar entre abas e camadas, links diretos ----------
{
  const nova = async (url, nome) => {
    const ctx = await contexto(browser, { width: 390, height: 844 })
    const page = await ctx.newPage()
    vigiar(page, nome)
    await page.goto('about:blank')
    await page.goto(url)
    await passarAbertura(page)
    return { ctx, page }
  }
  {
    const { ctx, page } = await nova(`${base}?uf=mg`, 'voltar-1')
    await irAba(page, 'catalogo')
    await page.getByRole('button', { name: /Seda OCB Premium Slim.*Abrir story/ }).click()
    await page.waitForTimeout(1000)
    await voltar(page)
    conferir(!(await page.locator('.story').count()) && (await abaAberta(page)) === 'catalogo', 'voltar: fecha o story e fica no Catálogo')
    await voltar(page)
    conferir((await abaAberta(page)) === 'inicio', 'voltar: Catálogo → Início')
    await voltar(page)
    conferir(page.url() === 'about:blank', 'voltar: do Início sai do site')
    await ctx.close()
  }
  {
    const { ctx, page } = await nova(`${base}?uf=mg`, 'voltar-2')
    await irAba(page, 'catalogo')
    await irAba(page, 'estados')
    await page.evaluate(() => {
      const bt = [...document.querySelectorAll('.vista[data-vista="estados"] button')].find((e) => /Rio de Janeiro|\bRJ\b/.test(e.getAttribute('aria-label') || e.textContent || ''))
      bt?.click()
    })
    await page.waitForTimeout(900)
    conferir((await abaAberta(page)) === 'inicio', 'voltar: escolher RJ em Por estado leva ao Início')
    await voltar(page)
    conferir((await abaAberta(page)) === 'estados' && page.url().includes('uf=rj'), 'voltar: Início → Por estado (já em RJ)')
    await voltar(page)
    conferir((await abaAberta(page)) === 'catalogo', 'voltar: Por estado → Catálogo')
    await ctx.close()
  }
  {
    // trocar de estado com uma camada aberta (o chat continua) na aba Por estado: a ida ao Início espera o chat fechar
    // (a entrada da aba nunca entra por cima da entrada do chat). Pelo X e pelo voltar.
    for (const modo of ['x', 'voltar']) {
      const { ctx, page } = await nova(`${base}?uf=mg`, `estado-com-chat-${modo}`)
      await irAba(page, 'estados')
      // abre o pedido guiado pela aba (o botão de pedido do estado atual, "Pedir aqui" hoje)
      const bt = page.locator('.vista:not([hidden]) button', { hasText: /Pedir aqui|Pedir em MG|Fazer pedido/ }).first()
      if (await bt.count()) await bt.click()
      await page.waitForTimeout(900)
      const chatAberto = await page.locator('[aria-modal="true"][aria-label="Pedido guiado"]').count()
      if (!chatAberto) {
        relatorio.push(`aviso: estado-com-chat-${modo}: a aba Por estado não tem botão de pedido; caso pulado`)
        await ctx.close()
        continue
      }
      await page.getByRole('button', { name: 'Trocar estado' }).last().click()
      await page.waitForTimeout(900)
      await page.locator('[aria-modal="true"][aria-label^="Escolher estado"]').getByRole('button', { name: /Rio de Janeiro/ }).first().click()
      await page.waitForTimeout(1200)
      const st = await page.evaluate(() => history.state)
      conferir((await abaAberta(page)) === 'estados' && st?.gc === 'chat', `estado com chat (${modo}): o chat continua por cima de Por estado, sem entrada de aba por cima dele`)
      if (modo === 'x') {
        await page.locator('[aria-modal="true"][aria-label="Pedido guiado"] button[aria-label^="Fechar"]').first().click()
        await page.waitForTimeout(1200)
      } else await voltar(page)
      conferir((await abaAberta(page)) === 'inicio' && page.url().includes('uf=rj'), `estado com chat (${modo}): fechar o chat leva ao Início (RJ)`)
      await voltar(page)
      conferir((await abaAberta(page)) === 'estados' && !(await page.locator('.folha').count()), `estado com chat (${modo}): voltar cai em Por estado, sem reabrir o chat`)
      await ctx.close()
    }
  }
  {
    const { ctx, page } = await nova(`${base}?uf=mg&aba=inicio`, 'link-inicio')
    conferir((await abaAberta(page)) === 'inicio' && !page.url().includes('aba='), 'link: ?aba=inicio abre o Início e sai da URL')
    await ctx.close()
  }
  {
    const { ctx, page } = await nova(`${base}?uf=mg&aba=catalogo`, 'link-catalogo')
    conferir((await abaAberta(page)) === 'catalogo', 'link: ?aba=catalogo abre o Catálogo')
    await voltar(page)
    conferir(page.url() === 'about:blank', 'link: ?aba=catalogo, voltar sai do site')
    await ctx.close()
  }
  {
    const { ctx, page } = await nova(`${base}?uf=mg&aba=estados`, 'link-estados')
    conferir((await abaAberta(page)) === 'estados', 'link: ?aba=estados abre Por estado')
    await ctx.close()
  }
  {
    const { ctx, page } = await nova(`${base}?uf=mg&aba=catalogo&produto=jack-daniels-old-no7-1l`, 'link-produto')
    await page.waitForTimeout(900)
    await foto(page, 'cel-18-link-produto-catalogo')
    await voltar(page)
    conferir((await abaAberta(page)) === 'catalogo' && !page.url().includes('produto='), 'link: ?aba=catalogo&produto=, voltar fecha no Catálogo')
    await ctx.close()
  }
  {
    const { ctx, page } = await nova(`${base}?uf=mg`, 'voltar-sacola')
    await irAba(page, 'catalogo')
    await page.locator('.barra-abas [data-aba="sacola"]').click()
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: 'Fazer pedido' }).click().catch(() => {})
    await page.waitForTimeout(800)
    for (let k = 0; k < 3 && (await page.locator('.folha').count()); k++) await voltar(page)
    conferir(!(await page.locator('.folha').count()) && (await abaAberta(page)) === 'catalogo', 'voltar: sacola → pedido, uma camada por vez, fica no Catálogo')
    await ctx.close()
  }
}

// ---------- atalho da Home 2 (sem script: meta refresh) ----------
{
  const r = await fetch(new URL('home2/index.html', base)).catch(() => null)
  const html = r?.ok ? await r.text() : ''
  conferir(/http-equiv="refresh"[^>]*url=\.\.\/\?home=2/.test(html) && !/<script/i.test(html), 'home2/index.html: meta refresh para ../?home=2, sem script')
}

// ---------- navegador do Instagram apertado (360×560) ----------
{
  const ctx = await contexto(browser, { width: 360, height: 560 })
  const page = await ctx.newPage()
  vigiar(page, 'ig')
  await page.goto(`${base}?uf=mg`)
  await passarAbertura(page)
  await foto(page, 'ig-01-hero')
  await irAba(page, 'catalogo')
  await page.getByRole('button', { name: /Seda OCB Premium Slim.*Abrir story/ }).click()
  await page.waitForTimeout(1300)
  await foto(page, 'ig-02-story-combo')
  await ctx.close()
}

// ---------- desktop 1440×900 ----------
{
  const ctx = await contexto(browser, { width: 1440, height: 900 })
  const page = await ctx.newPage()
  vigiar(page, 'desk')
  await page.goto(base)
  await page.waitForTimeout(700)
  await foto(page, 'desk-01-abertura')
  await passarAbertura(page)
  await foto(page, 'desk-02-hero-palpite')
  await irAba(page, 'catalogo')
  await page.waitForTimeout(900)
  await foto(page, 'desk-03-catalogo')
  await page.getByRole('button', { name: /Jack Daniel's.*Abrir story/ }).click()
  await page.waitForTimeout(1300)
  await foto(page, 'desk-04-story')
  await page.getByRole('button', { name: 'Pôr na sacola' }).click()
  await page.waitForTimeout(900)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  await page.locator('.lateral-item:has-text("Sacola")').click()
  await page.waitForTimeout(700)
  await foto(page, 'desk-05-sacola')
  await page.getByRole('button', { name: 'Fazer pedido' }).click()
  await page.waitForTimeout(800)
  await foto(page, 'desk-06-chat')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await irAba(page, 'estados')
  await page.waitForTimeout(1300)
  await foto(page, 'desk-07-por-estado')
  await axeNasAbas(page, 'desk h1')
  await page.goto(`${base}?uf=ba`)
  await page.waitForTimeout(1500)
  await foto(page, 'desk-08-sem-atendimento')
  await ctx.close()
}

// ---------- lateral: Buscar e Catálogo ativos; foco ao voltar ao Início na Home 2 ----------
{
  const ctx = await contexto(browser, { width: 1440, height: 900 })
  const page = await ctx.newPage()
  vigiar(page, 'lateral-ativo')
  await page.goto(`${base}?uf=mg&home=2`)
  await passarAbertura(page)
  const ativo = () => page.evaluate(() => [...document.querySelectorAll('.lateral [aria-current="page"]')].map((e) => e.textContent.trim()))
  await page.locator('.lateral [data-aba="buscar"]').click()
  await page.waitForTimeout(900)
  await page.keyboard.type('jack')
  await page.waitForTimeout(300)
  conferir(JSON.stringify(await ativo()) === '["Buscar"]', 'lateral: Buscar ativo com a busca em uso')
  await page.locator('.lateral [data-aba="catalogo"]').click()
  await page.waitForTimeout(700)
  conferir(JSON.stringify(await ativo()) === '["Catálogo"]', 'lateral: tocar em Catálogo depois de buscar deixa Catálogo ativo')
  // Início pelo teclado: o Tab seguinte vai para o card do mercador (o que vem antes do perfil), não pula ele
  await page.locator('.lateral [data-aba="inicio"]').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  await page.keyboard.press('Tab')
  const foco = await page.evaluate(() => document.activeElement?.className ?? '')
  conferir(/sm-cta/.test(foco), `Home 2: Início pelo teclado, o Tab vai para o card do mercador (${foco})`)
  await ctx.close()
}

// ---------- notebook baixo com a enquete de local: a lateral rola até Por estado e a prévia ----------
for (const [w, h] of [[1280, 650], [1366, 657]]) {
  const ctx = await contexto(browser, { width: w, height: h })
  const page = await ctx.newPage()
  vigiar(page, `lateral-baixa-${w}`)
  await page.goto(`${base}?home=2`)
  await passarAbertura(page)
  const l = await page.evaluate(() => {
    const e = document.querySelector('.lateral')
    return { rola: e.scrollHeight > e.clientHeight, ov: getComputedStyle(e).overflowY, prevent: e.hasAttribute('data-lenis-prevent') }
  })
  conferir(!l.rola || (l.ov === 'auto' && l.prevent), `lateral ${w}x${h}: passa da tela e rola (overflow ${l.ov}, roda do mouse na lateral)`)
  await page.mouse.move(110, h - 80)
  for (let k = 0; k < 6; k++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(60)
  }
  await page.waitForTimeout(700)
  const fim = await page.evaluate(() => {
    const b = (s) => document.querySelector(s)?.getBoundingClientRect().bottom ?? 0
    return { estados: b('.lateral [data-aba="estados"]'), previa: b('.lateral-previa'), h: innerHeight }
  })
  conferir(fim.estados <= fim.h + 1 && fim.previa <= fim.h + 1, `lateral ${w}x${h}: rolando a lateral, Por estado e a troca de home aparecem`)
  await foto(page, `desk-lateral-baixa-${w}x${h}`)
  await ctx.close()
}

// ---------- axe na Home 2 (celular e desktop) ----------
for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  const ctx = await contexto(browser, vp)
  const page = await ctx.newPage()
  vigiar(page, `axe-h2-${vp.width}`)
  await page.goto(`${base}?uf=mg&home=2`)
  await passarAbertura(page)
  await axeNasAbas(page, `${vp.width < 900 ? 'cel' : 'desk'} h2`)
  await ctx.close()
}

// ---------- matriz de desktop: Home 1 e Home 2 (+ Catálogo e Por estado) ----------
// altura cheia da tela e a área útil de verdade (menos a barra do navegador): 1366×657, 1280×650, 1536×730, 1440×790
const TAMANHOS = [
  [1280, 720],
  [1280, 800],
  [1366, 768],
  [1440, 900],
  [1536, 864],
  [1920, 1080],
  [1240, 800],
  [1100, 800],
  [1366, 657],
  [1280, 650],
  [1536, 730],
  [1440, 790],
  [1240, 700],
  [1200, 900],
]
for (const home of [1, 2]) {
  for (const [w, h] of TAMANHOS) {
    const nome = `desk-h${home}-${w}x${h}`
    const ctx = await contexto(browser, { width: w, height: h })
    const page = await ctx.newPage()
    vigiar(page, nome)
    await page.goto(`${base}?uf=mg${home === 2 ? '&home=2' : ''}`)
    await page.getByRole('button', { name: 'Tenho', exact: true }).click()
    await page.locator('.abertura').waitFor({ state: 'detached', timeout: 8000 })
    // Home 2 >= 1200: o mercador do card abre o casaco em até 1,5 s depois da abertura
    if (home === 2 && w >= 1200) {
      const t0 = Date.now()
      let aberto = null
      for (let k = 0; k < 40 && aberto == null; k++) {
        const v = await page.evaluate(() => {
          const e = document.querySelector('.hero-vitrine .q-aberto')
          return e ? getComputedStyle(e).visibility : null
        })
        if (v === 'visible') aberto = Date.now() - t0
        else await page.waitForTimeout(50)
      }
      conferir(aberto != null && aberto <= 1500, `${nome}: casaco do mercador abre em até 1,5 s (${aberto} ms)`)
    }
    await page.waitForTimeout(500)
    const c = await page.evaluate(() => {
      const r = (s) => {
        const e = document.querySelector(s)
        const b = e?.getBoundingClientRect()
        return b && b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width } : null
      }
      const textos = [...document.querySelectorAll('.hero-desktop-perfil *')].filter((e) => !e.children.length && e.getClientRects().length && e.textContent.trim())
      return {
        vitrine: r('.hero-vitrine .sm'),
        perfil: r('.hero-desktop-perfil .perfil'),
        story: r('.hero-quadro'),
        setaE: r('.hero-seta-esq'),
        setaD: r('.hero-seta-dir'),
        cta: r('.hero-vitrine .sm-cta'),
        figura: r('.hero-vitrine .repost-figura'),
        lateral: r('.lateral'),
        textoPerfil: textos.length ? Math.min(...textos.map((e) => e.getBoundingClientRect().left)) : null,
        alto: innerHeight,
        larg: document.documentElement.scrollWidth > innerWidth,
      }
    })
    const cruza = (a, b) => a && b && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1
    const nomes = ['vitrine', 'perfil', 'story', 'setaE', 'setaD']
    for (let i = 0; i < nomes.length; i++) for (let j = i + 1; j < nomes.length; j++) if (cruza(c[nomes[i]], c[nomes[j]])) erros.push(`[${nome}] ${nomes[i]} por cima de ${nomes[j]}`)
    // o story fica com 330 px ou mais, a não ser que a altura da janela (16:9) ou, na Home 2 entre 1200 e 1279, a
    // largura que sobra ao lado do card e do perfil não deixem (aí o mínimo é 300)
    const minimo = Math.min(home === 2 && w < 1280 ? 300 : 330, Math.floor(((h - 120) * 9) / 16) - 2)
    conferir(!!c.story && c.story.w >= minimo, `${nome}: story com ${c.story ? Math.round(c.story.w) : 0} px (>= ${minimo})`)
    conferir(!c.larg, `${nome}: sem rolagem lateral`)
    if (c.lateral && c.textoPerfil != null) conferir(c.textoPerfil >= c.lateral.r - 1, `${nome}: texto do perfil fora da lateral (${Math.round(c.textoPerfil)} >= ${Math.round(c.lateral.r)})`)
    if (home === 2) conferir(!!c.vitrine, `${nome}: card do mercador no Início`)
    if (home === 2 && w >= 1200) {
      conferir(!!c.cta && c.cta.b <= c.alto, `${nome}: "Testar minha sorte" do card dentro da janela`)
      conferir(!!c.figura && c.figura.w >= 130, `${nome}: mercador do card em 3× ou mais (${c.figura ? Math.round(c.figura.w) : 0} px)`)
    }
    await foto(page, nome, true)
    await irAba(page, 'catalogo')
    await foto(page, `${nome}-catalogo`, true)
    await irAba(page, 'estados')
    await foto(page, `${nome}-estados`, true)
    await ctx.close()
  }
}

await browser.close()
writeFileSync(`${dir}relatorio.json`, JSON.stringify({ erros, relatorio }, null, 2))
console.log(JSON.stringify({ erros, relatorio: relatorio.filter((r) => typeof r !== 'string' || !r.startsWith('ok:')) }, null, 2))
console.log(erros.length ? `${erros.length} problema(s)` : 'sem problemas')
