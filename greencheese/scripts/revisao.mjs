// Revisão por screenshots (seção 10 do briefing) + teste do fluxo até o link do WhatsApp (RJ e MG).
// Uso: npm run dev (em outro terminal) e depois: node scripts/revisao.mjs [rodada] [url-base]
// IP e CEP são simulados para o resultado ser repetível.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const rodada = process.argv[2] ?? 'r1'
const base = process.argv[3] ?? 'http://localhost:5173/'
const dir = new URL(`../revisao/${rodada}/`, import.meta.url).pathname
mkdirSync(dir, { recursive: true })

const erros = []
const relatorio = []

async function contexto(browser, viewport, opts = {}) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: viewport.width < 600 ? 2 : 1,
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
  return ctx
}

function vigiar(page, nome) {
  page.on('console', (m) => {
    if (m.type() === 'error') erros.push(`[${nome}] console: ${m.text()}`)
  })
  page.on('pageerror', (e) => erros.push(`[${nome}] pageerror: ${e.message}`))
}

async function foto(page, nome) {
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${dir}${nome}.png` })
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
  // monta a sacola: abre o primeiro disponível, põe 1; depois a seda OCB com 3 (combo) se houver
  await page.evaluate(() => document.querySelector('#catalogo')?.scrollIntoView())
  await page.waitForTimeout(300)
  const resultado = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('gc-sacola') || '{"state":{"itens":[]}}')
    return s
  })
  void resultado
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
  // sacola
  await page.locator('.barra-fixa .barra-sacola:visible, .lateral-item:has-text("Sacola"):visible').first().click()
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
  return { uf, href, texto }
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
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 0.85))
  await page.waitForTimeout(600)
  await foto(page, 'cel-06-perfil')
  await page.evaluate(() => document.querySelector('#catalogo')?.scrollIntoView())
  await page.waitForTimeout(800)
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
  const mg = await fluxoPedido(page, 'mg', '39800001', 'cel-11-mg')
  relatorio.push({ mg })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await page.evaluate(() => document.querySelector('#estados')?.scrollIntoView())
  await page.waitForTimeout(1600)
  await foto(page, 'cel-12-por-estado')
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
  await ctx.close()
}

// ---------- navegador do Instagram apertado (360×560) ----------
{
  const ctx = await contexto(browser, { width: 360, height: 560 })
  const page = await ctx.newPage()
  vigiar(page, 'ig')
  await page.goto(`${base}?uf=mg`)
  await passarAbertura(page)
  await foto(page, 'ig-01-hero')
  await page.evaluate(() => document.querySelector('#catalogo')?.scrollIntoView())
  await page.waitForTimeout(700)
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
  await page.evaluate(() => document.querySelector('#catalogo')?.scrollIntoView())
  await page.waitForTimeout(1200)
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
  await page.evaluate(() => document.querySelector('#estados')?.scrollIntoView())
  await page.waitForTimeout(1600)
  await foto(page, 'desk-07-por-estado')
  await page.goto(`${base}?uf=ba`)
  await page.waitForTimeout(1500)
  await foto(page, 'desk-08-sem-atendimento')
  await ctx.close()
}

await browser.close()
writeFileSync(`${dir}relatorio.json`, JSON.stringify({ erros, relatorio }, null, 2))
console.log(JSON.stringify({ erros, relatorio }, null, 2))
