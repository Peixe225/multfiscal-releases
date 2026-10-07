// Revisão por screenshots (seção 10 do briefing) + teste do fluxo até o link do WhatsApp (RJ e MG), com a navegação
// em abas (Início | Catálogo | Por estado), as sequências de voltar, os links diretos, o Início (destaques e grade,
// sem o fim da aba Catálogo), o mercador ao lado do perfil na matriz de desktop (ou o hero empilhado quando ele não
// cabe ali, nunca sumindo), as setas da linha de destaques no computador, o atalho antigo home2/, o axe em cada aba e
// os pontos de referência do leitor de tela (nenhuma região "Início" vazia nas outras abas).
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
  // página inteira: o card fora da tela pula a pintura (content-visibility: auto); na foto, todos pintam
  const estilo = cheia ? await page.addStyleTag({ content: '.grade > .card { content-visibility: visible !important }' }) : null
  if (estilo) await page.waitForTimeout(300)
  await page.screenshot({ path: `${dir}${nome}.png`, fullPage: cheia })
  if (estilo) await estilo.evaluate((e) => e.remove())
  relatorio.push(nome)
}

/**
 * O Início acaba na grade (a caixa de encomenda por último) e no rodapé: destaques com as abas primeiro, o fio e os
 * filtros; sem busca, sem o Teste minha sorte e o repost do fim da aba Catálogo, sem os ids dela.
 */
async function conferirInicio(page, nome) {
  await page.locator('.vista-inicio .catalogo-inicio .grade').waitFor({ state: 'attached', timeout: 6000 }).catch(() => {})
  const r = await page.evaluate(() => {
    const v = document.querySelector('.vista[data-vista="inicio"]')
    const grade = v?.querySelector('.catalogo-inicio .grade')
    const rodape = document.querySelector('.rodape')
    const nav = v?.querySelector('.destaques-inicio nav')
    const fio = v?.querySelector('.destaques-inicio .destaques-fio')
    const filtros = v?.querySelector('.destaques-inicio [role="group"]')
    return {
      grade: !!grade,
      caixaNoFim: !!grade?.lastElementChild?.classList.contains('card-caixa'),
      rodapeLogo: grade && rodape ? rodape.getBoundingClientRect().top - grade.getBoundingClientRect().bottom : null,
      destaques: !!(nav && fio && filtros && nav.compareDocumentPosition(fio) & 4 && fio.compareDocumentPosition(filtros) & 4),
      fimCatalogo: !!v?.querySelector('.aba-fim, .reposts, .adesivos-interativos'),
      ids: !!v?.querySelector('#catalogo, #catalogo-titulo'),
      busca: !!v?.querySelector('.busca, .chip-disp'),
    }
  })
  conferir(r.grade && r.caixaNoFim, `${nome}: Início com a grade e a caixa de encomenda por último`)
  conferir(r.rodapeLogo != null && r.rodapeLogo >= -1 && r.rodapeLogo <= 120, `${nome}: o rodapé vem logo depois da grade (${r.rodapeLogo == null ? '?' : Math.round(r.rodapeLogo)} px)`)
  conferir(r.destaques, `${nome}: destaques do Início com as abas, o fio e os filtros, nessa ordem`)
  conferir(!r.fimCatalogo && !r.ids && !r.busca, `${nome}: Início sem Teste minha sorte/repost do fim, sem os ids e a busca da aba Catálogo`)
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

/** Pontos de referência e regiões que o leitor de tela anuncia (árvore de acessibilidade do Chromium). */
async function pontosDeReferencia(page) {
  const cdp = await page.context().newCDPSession(page)
  const { nodes } = await cdp.send('Accessibility.getFullAXTree')
  await cdp.detach()
  return nodes.filter((n) => !n.ignored && /^(region|navigation|main|contentinfo|complementary|banner)$/.test(n.role?.value ?? '')).map((n) => `${n.role.value}:${n.name?.value ?? ''}`)
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
  await conferirInicio(page, 'cel')
  conferir(!(await page.locator('.vista[data-vista="inicio"] .mercador-loja, .vista[data-vista="inicio"] .repost-figura').count()), 'cel: nenhum mercador no Início do celular')
  await page.locator('.vista-inicio .so-celular .perfil-loja').click()
  await page.waitForTimeout(1200)
  await foto(page, 'cel-06b-destaques')
  await foto(page, 'cel-16-home-inteira', true)
  await page.evaluate(() => window.scrollTo(0, 0))
  conferir((await pontosDeReferencia(page)).includes('region:Início'), 'cel: a vista do Início é a região "Início"')
  conferir(!/confirmar|importsvv/i.test((await page.locator('.vista-inicio .faixa').textContent()) ?? ''), 'cel: a faixa dos @ só com os perfis confirmados')
  await irAba(page, 'catalogo')
  const refs = await pontosDeReferencia(page)
  conferir(!refs.includes('region:Início') && refs.includes('region:Catálogo'), `cel: na aba Catálogo, nenhuma região "Início" vazia para o leitor de tela (${refs.join(', ')})`)
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
  await axeNasAbas(page, 'cel')
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

// ---------- links velhos da Home 2: home2/ (Home2/ e HOME2/ sobem pelo publicar.mjs), ?home=2, ?Home2 ----------
// abrem a home de sempre, com o resto do link e sem as chaves home*
{
  for (const pasta of ['home2']) {
    const r = await fetch(new URL(`${pasta}/index.html`, base)).catch(() => null)
    const html = r?.ok ? await r.text() : ''
    // script só de arquivo (a CSP bloqueia script em linha) e o meta refresh para quem está sem JavaScript
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    conferir(
      scripts.length === 1 && /src="[^"]*ir\.js"/.test(scripts[0][1]) && !scripts[0][2].trim() && /<noscript><meta http-equiv="refresh"[^>]*url=\.\.\/"/.test(html),
      `${pasta}/index.html: script de arquivo + meta refresh de reserva para ../`,
    )
  }
  const ctx = await contexto(browser, { width: 390, height: 844 })
  const page = await ctx.newPage()
  vigiar(page, 'atalho-h2')
  for (const [entrada, espera] of [
    ['home2/?uf=rj&aba=catalogo', { uf: 'rj', aba: 'catalogo' }],
    ['home2/', {}],
    ['?Home2&uf=rj', { uf: 'rj' }],
    ['?HOME=2', {}],
    ['?home=1&uf=mg', { uf: 'mg' }],
  ]) {
    await page.goto(new URL(entrada, base).href)
    await page.locator('.app').waitFor({ state: 'attached', timeout: 15000 })
    await page.waitForTimeout(300)
    const r = await page.evaluate(() => ({
      home: document.querySelector('.app')?.getAttribute('data-home'),
      pasta: location.pathname,
      q: Object.fromEntries(new URLSearchParams(location.search)),
    }))
    const ok =
      r.home == null &&
      !/home2/i.test(r.pasta) &&
      Object.entries(espera).every(([k, v]) => r.q[k] === v) &&
      !Object.keys(r.q).some((k) => /^home/i.test(k))
    conferir(ok, `link velho ${entrada}: home de sempre${Object.keys(espera).length ? ', ' + Object.keys(espera).join('/') + ' mantidos' : ''}, sem home* na URL (${JSON.stringify(r)})`)
  }
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
  await axeNasAbas(page, 'desk')
  await page.goto(`${base}?uf=ba`)
  await page.waitForTimeout(1500)
  await foto(page, 'desk-08-sem-atendimento')
  await ctx.close()
}

// ---------- lateral: Buscar e Catálogo ativos; foco ao voltar ao Início ----------
{
  const ctx = await contexto(browser, { width: 1440, height: 900 })
  const page = await ctx.newPage()
  vigiar(page, 'lateral-ativo')
  await page.goto(`${base}?uf=mg`)
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
  // Início pelo teclado: o foco vai para o título do perfil e o Tab seguinte cai nos botões dele (o mercador ao lado é
  // decorativo, sem parada)
  await page.locator('.lateral [data-aba="inicio"]').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  await page.keyboard.press('Tab')
  const foco = await page.evaluate(() => {
    const a = document.activeElement
    return { perfil: !!a?.closest('.hero-loja .perfil'), mercador: !!a?.closest('.mercador-loja'), txt: (a?.textContent ?? '').trim().slice(0, 30) }
  })
  conferir(foco.perfil && !foco.mercador, `Início pelo teclado: o Tab cai no perfil, não no mercador (${foco.txt})`)
  // Ver loja (computador): desce até os destaques do Início e o foco vai junto
  await page.locator('.hero-loja .perfil-loja').click()
  await page.waitForTimeout(1500)
  const loja = await page.evaluate(() => ({ topo: Math.round(document.querySelector('.vista-inicio .destaques-inicio').getBoundingClientRect().top), foco: document.activeElement?.id }))
  conferir(loja.topo >= 0 && loja.topo <= 80 && loja.foco === 'inicio-loja-titulo', `Ver loja (computador): destaques no alto (${loja.topo} px) e foco na loja (${loja.foco})`)
  await foto(page, 'desk-09-ver-loja')
  await ctx.close()
}

// ---------- notebook baixo com a enquete de local: a lateral rola até Por estado ----------
for (const [w, h] of [[1280, 650], [1366, 657]]) {
  const ctx = await contexto(browser, { width: w, height: h })
  const page = await ctx.newPage()
  vigiar(page, `lateral-baixa-${w}`)
  await page.goto(base)
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
  conferir(fim.estados <= fim.h + 1 && fim.previa <= fim.h + 1, `lateral ${w}x${h}: rolando a lateral, Por estado aparece`)
  await foto(page, `desk-lateral-baixa-${w}x${h}`)
  await ctx.close()
}

// ---------- axe no celular estreito e no computador largo (mercador em 5× ao lado do perfil) ----------
for (const vp of [{ width: 320, height: 568 }, { width: 1920, height: 1080 }]) {
  const ctx = await contexto(browser, vp)
  const page = await ctx.newPage()
  vigiar(page, `axe-${vp.width}`)
  await page.goto(`${base}?uf=mg`)
  await passarAbertura(page)
  await axeNasAbas(page, `${vp.width < 900 ? 'cel' : 'desk'} ${vp.width}`)
  await ctx.close()
}

// ---------- matriz de desktop: Início com o mercador ao lado do perfil (+ Catálogo e Por estado) ----------
// altura cheia da tela e a área útil de verdade (menos a barra do navegador): 1366×657, 1280×650, 1536×730, 1440×790.
// De 1200 em diante, o mercador ao lado do perfil; onde ele não cabe ali (janela alta de 1200 a ~1270), o hero empilha
// como de 900 a 1199 (story em cima, mercador e perfil embaixo) — o mercador nunca some no computador
const TAMANHOS = [
  [900, 800],
  [1024, 768],
  [1100, 800],
  [1200, 900],
  [1200, 650],
  [1240, 800],
  [1240, 700],
  [1280, 720],
  [1280, 800],
  [1280, 650],
  [1280, 1024],
  [1300, 1000],
  [1366, 768],
  [1366, 657],
  [1440, 900],
  [1440, 790],
  [1440, 720],
  [1536, 864],
  [1536, 730],
  [1920, 1080],
  [1920, 720],
]
for (const [w, h] of TAMANHOS) {
  const nome = `desk-${w}x${h}`
  const ctx = await contexto(browser, { width: w, height: h })
  const page = await ctx.newPage()
  vigiar(page, nome)
  await page.goto(`${base}?uf=mg`)
  await page.getByRole('button', { name: 'Tenho', exact: true }).click()
  await page.locator('.abertura').waitFor({ state: 'detached', timeout: 8000 })
  // o mercador abre o casaco em até 1,5 s depois de aparecer (abaixo de 1200 ele fica embaixo do story: rola até ele)
  let aberto = null
  if (await page.locator('.hero-loja .mercador-loja').count()) {
    const fora = await page.evaluate(() => document.querySelector('.hero-loja .mercador-loja').getBoundingClientRect().bottom > innerHeight)
    if (fora) await page.evaluate(() => document.querySelector('.hero-loja .mercador-loja').scrollIntoView({ block: 'center' }))
    const t0 = Date.now()
    for (let k = 0; k < 40 && aberto == null; k++) {
      const v = await page.evaluate(() => getComputedStyle(document.querySelector('.hero-loja .q-aberto')).visibility)
      if (v === 'visible') aberto = Date.now() - t0
      else await page.waitForTimeout(50)
    }
    if (fora) await page.evaluate(() => window.scrollTo(0, 0))
  }
  await page.waitForTimeout(500)
  const c = await page.evaluate(() => {
    const r = (s) => {
      const e = document.querySelector(s)
      const b = e?.getBoundingClientRect()
      return b && b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } : null
    }
    const textos = [...document.querySelectorAll('.hero-desktop-perfil *')].filter((e) => !e.children.length && e.getClientRects().length && e.textContent.trim())
    const merc = document.querySelector('.hero-loja .mercador-loja')
    return {
      mercador: r('.hero-loja .mercador-loja .repost-figura'),
      perfil: r('.hero-desktop-perfil .perfil'),
      story: r('.hero-quadro'),
      setaE: r('.hero-seta-esq'),
      setaD: r('.hero-seta-dir'),
      lateral: r('.lateral'),
      textoPerfil: textos.length ? Math.min(...textos.map((e) => e.getBoundingClientRect().left)) : null,
      // o mercador natural: só ele, sem texto, sem link, decorativo
      mercadorTexto: merc ? merc.textContent.trim() : '',
      mercadorFocavel: merc ? !!merc.querySelector('a, button, [tabindex]') : false,
      mercadorOculto: merc ? merc.getAttribute('aria-hidden') === 'true' : true,
      sorteNoHero: /Teste minha sorte|Tá com sorte|Todo giro ganha/i.test(document.querySelector('.vista-inicio .hero')?.textContent ?? ''),
      empilhado: !!document.querySelector('.vista-inicio .hero.hero-empilhado'),
      regua: document.querySelector('.vista-inicio .hero-regua')?.clientWidth ?? null,
      storyAntes: (() => {
        const st = document.querySelector('.vista-inicio .hero-story')
        const lj = document.querySelector('.vista-inicio .hero-loja')
        return !!(st && lj && st.compareDocumentPosition(lj) & 4)
      })(),
      alto: innerHeight,
      larg: document.documentElement.scrollWidth > innerWidth,
    }
  })
  const cruza = (a, b) => a && b && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1
  const nomes = ['mercador', 'perfil', 'story', 'setaE', 'setaD', 'lateral']
  for (let i = 0; i < nomes.length; i++) for (let j = i + 1; j < nomes.length; j++) if (cruza(c[nomes[i]], c[nomes[j]])) erros.push(`[${nome}] ${nomes[i]} por cima de ${nomes[j]}`)
  // o story nunca encolhe por causa do mercador: 330 px ou mais, a não ser que a altura da janela (16:9) não deixe
  const minimo = Math.min(330, Math.floor(((h - 120) * 9) / 16) - 2)
  conferir(!!c.story && c.story.w >= minimo, `${nome}: story com ${c.story ? Math.round(c.story.w) : 0} px (>= ${minimo})`)
  conferir(!c.larg, `${nome}: sem rolagem lateral`)
  if (c.lateral && c.textoPerfil != null) conferir(c.textoPerfil >= c.lateral.r - 1, `${nome}: texto do perfil fora da lateral (${Math.round(c.textoPerfil)} >= ${Math.round(c.lateral.r)})`)
  conferir(!c.sorteNoHero, `${nome}: nada do Teste minha sorte no topo do Início`)
  if (c.mercador) {
    const k = c.mercador.w / 44
    conferir(Number.isInteger(Math.round(k * 100) / 100) && k >= 3 && k <= 5, `${nome}: mercador em escala inteira de 3× a 5× (${Math.round(c.mercador.w)} px)`)
    conferir(!c.mercadorTexto && !c.mercadorFocavel && c.mercadorOculto, `${nome}: mercador sem texto, sem link e decorativo`)
    conferir(!!c.perfil && Math.abs(c.mercador.b - c.perfil.b) <= 2, `${nome}: pés do mercador na linha do fim do perfil (${Math.round(c.mercador.b)} / ${c.perfil ? Math.round(c.perfil.b) : '?'})`)
    conferir(aberto != null && aberto <= 1500, `${nome}: casaco do mercador abre em até 1,5 s (${aberto} ms)`)
  }
  conferir(!!c.mercador, `${nome}: mercador no Início do computador (${c.empilhado ? 'embaixo do story, ao lado do perfil' : 'ao lado do perfil e do story'})`)
  // arranjo coerente por largura: de 900 a 1199 sempre empilhado; de 1200 em diante, empilhado só onde o mercador 3×
  // (44 + 5 de vão, × 3) e o perfil de 285 px não cabem na coluna ao lado do story
  if (w < 1200) conferir(c.empilhado && c.storyAntes, `${nome}: story em cima, mercador e perfil embaixo`)
  else conferir(c.empilhado === (c.regua != null && c.regua < 49 * 3 + 285) && c.storyAntes === c.empilhado, `${nome}: ${c.empilhado ? 'empilhado (não cabe ao lado: ' : 'lado a lado (coluna de '}${c.regua} px${c.empilhado ? ')' : ')'}`)
  await conferirInicio(page, nome)
  await foto(page, nome, true)
  await irAba(page, 'catalogo')
  await foto(page, `${nome}-catalogo`, true)
  await irAba(page, 'estados')
  await foto(page, `${nome}-estados`, true)
  await ctx.close()
}

// ---------- destaques do Início no computador: setas nas pontas quando a linha não cabe; Shift + roda anda de lado ----
for (const [w, h] of [[1024, 768], [1440, 900]]) {
  const ctx = await contexto(browser, { width: w, height: h })
  const page = await ctx.newPage()
  vigiar(page, `setas-${w}`)
  await page.goto(`${base}?uf=mg`)
  await passarAbertura(page)
  await page.locator('.vista-inicio .catalogo-inicio .grade').waitFor({ state: 'attached', timeout: 6000 }).catch(() => {})
  const topo = await page.evaluate(() => document.querySelector('.vista-inicio .destaques-moldura').getBoundingClientRect().top + scrollY)
  await page.mouse.move(w / 2, 300)
  await page.mouse.wheel(0, topo - 200)
  await page.waitForTimeout(1500)
  const linha = () =>
    page.evaluate(() => {
      const d = document.querySelector('.vista-inicio .destaques-inicio')
      const m = d.parentElement
      return { sl: Math.round(d.scrollLeft), sobra: d.scrollWidth - d.clientWidth, esq: !!m.querySelector('.destaques-seta-esq'), dir: !!m.querySelector('.destaques-seta-dir') }
    })
  const a = await linha()
  if (a.sobra > 0) {
    conferir(a.dir && !a.esq, `setas ${w}: a linha não cabe (${a.sobra} px) e só a seta da direita aparece`)
    await foto(page, `desk-11-destaques-setas-${w}`)
    await page.locator('.destaques-seta-dir').click()
    await page.waitForTimeout(900)
    const b = await linha()
    conferir(b.sl >= b.sobra - 1 && b.esq && !b.dir, `setas ${w}: a seta leva ao fim da linha (${b.sl}/${b.sobra}) e troca de lado`)
    await page.locator('.destaques-seta-esq').click()
    await page.waitForTimeout(900)
    const box = await page.locator('.vista-inicio .destaques-inicio').boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + 40)
    const y0 = await page.evaluate(() => scrollY)
    await page.keyboard.down('Shift')
    await page.mouse.wheel(0, 200)
    await page.keyboard.up('Shift')
    await page.waitForTimeout(700)
    const c = await linha()
    const y1 = await page.evaluate(() => scrollY)
    conferir(c.sl > 0 && Math.abs(y1 - y0) < 2, `setas ${w}: Shift + roda anda a linha de lado (${c.sl} px) sem descer a página`)
  } else conferir(!a.esq && !a.dir, `setas ${w}: a linha cabe inteira e fica sem setas`)
  await ctx.close()
}

// ---------- mercador: o mouse em cima abre o casaco na hora; movimento reduzido, parado ----------
for (const reduzir of [false, true]) {
  const ctx = await contexto(browser, { width: 1440, height: 900 }, { reduzir })
  const page = await ctx.newPage()
  vigiar(page, `mercador-mouse${reduzir ? '-reduzido' : ''}`)
  await page.goto(`${base}?uf=mg`)
  await passarAbertura(page)
  const fig = page.locator('.hero-loja .mercador-loja')
  await fig.waitFor({ timeout: 5000 })
  // espera a parte parada (nenhuma camada da apresentação à vista) e passa o mouse
  const visivel = (s) => page.evaluate((s) => [...document.querySelectorAll(`.hero-loja ${s}`)].some((e) => getComputedStyle(e).visibility === 'visible' && getComputedStyle(e).display !== 'none'), s)
  for (let k = 0; k < 150 && (await visivel('.repost-quadro')); k++) await page.waitForTimeout(100)
  await page.mouse.move(5, 5)
  await fig.hover()
  await page.waitForTimeout(300)
  const abriu = await visivel('.q-aberto, .q-meio')
  if (reduzir) conferir(!abriu, 'mercador com movimento reduzido: fica parado (o mouse não anima)')
  else conferir(abriu, 'mercador: o mouse em cima abre o casaco na hora')
  await foto(page, `desk-10-mercador-mouse${reduzir ? '-reduzido' : ''}`)
  await ctx.close()
}

await browser.close()
writeFileSync(`${dir}relatorio.json`, JSON.stringify({ erros, relatorio }, null, 2))
console.log(JSON.stringify({ erros, relatorio: relatorio.filter((r) => typeof r !== 'string' || !r.startsWith('ok:')) }, null, 2))
console.log(erros.length ? `${erros.length} problema(s)` : 'sem problemas')
