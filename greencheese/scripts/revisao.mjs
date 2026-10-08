// Revisão por screenshots (seção 10 do briefing) + teste do fluxo até o link do WhatsApp da loja (RJ e MG, pedido e
// encomenda), o Pix "em breve", as dúvidas na DM do estado, a navegação em abas (Início | Mercado | Por estado), as
// sequências de voltar, os links diretos (?aba=mercado e o velho ?aba=catalogo), o Início (destaques e grade, sem o fim
// da aba Mercado), a rua viva (no celular entre a faixa e o perfil; no computador embaixo do perfil, em escala inteira,
// na matriz de desktop): aparece, para fora da tela (o rAF para), pausa no botão, fica parada com movimento reduzido,
// o mercador chamado oferece o Mercado; o Mercado com o mercador no topo; as falas da rua sem palavra proibida; as
// setas da linha de destaques no computador, o atalho antigo home2/, o axe em cada aba e os pontos de referência.
// Uso: npm run dev (em outro terminal) e depois: node scripts/revisao.mjs [rodada] [url-base]
// IP e CEP são simulados para o resultado ser repetível.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers'
const { chromium } = await import(new URL('../node_modules/playwright/index.mjs', import.meta.url).href)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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

// O pedido e a encomenda fecham no WhatsApp da loja (config.whatsappPedidos), o mesmo em todos os estados
const ZAP = 'https://wa.me/5533991139036?text='
const dmDo = (uf) => `https://ig.me/m/greencheese_imports${uf}`

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
  const href = await page.getByRole('link', { name: 'Fechar pedido no WhatsApp' }).getAttribute('href')
  conferir(href?.startsWith(ZAP), `${uf}: "Fechar pedido no WhatsApp" abre o WhatsApp da loja (${href?.slice(0, 48)}…)`)
  const texto = decodeURIComponent(href.split('text=')[1] ?? '')
  conferirMensagem(uf, texto)
  // a DM saiu do fechamento: nenhum outro link de saída nas ações do resumo
  conferir((await page.locator('.dm-acoes a').count()) === 1, `${uf}: no resumo, o WhatsApp é o único link (sem "Copiar pedido e abrir a DM")`)
  // dúvida fora do pedido: o começo da conversa aponta pra DM do estado
  const duvida = await page.locator('.dm-duvida').getAttribute('href')
  conferir(duvida === dmDo(uf), `${uf}: "Outra dúvida?" do chat abre a DM do estado (${duvida})`)
  // Pix no site: em breve. Tocar não sai do site, a loja responde e o foco volta pro WhatsApp
  const antes = page.url()
  const abas = page.context().pages().length
  await page.getByRole('button', { name: /Pagar com Pix aqui no site/ }).click()
  await page.waitForTimeout(600)
  const pix = await page.evaluate(() => ({
    bolha: [...document.querySelectorAll('.dm-resposta-pix .dm-loja')].map((e) => e.textContent).join(' '),
    foco: document.activeElement?.textContent?.trim() ?? '',
    realce: !!document.querySelector('.dm-zap.dm-realce'),
  }))
  conferir(/Pix direto no site chega em breve/.test(pix.bolha), `${uf}: Pix em breve responde no chat ("${pix.bolha.slice(0, 60)}…")`)
  conferir(pix.foco === 'Fechar pedido no WhatsApp' && pix.realce, `${uf}: depois do Pix, foco e realce no WhatsApp (${pix.foco})`)
  conferir(page.url() === antes && page.context().pages().length === abas, `${uf}: o Pix em breve não sai do site`)
  await foto(page, `${nomeArq}-chat-pix-em-breve`)
  if (uf === 'mg') await pixComOutroPagamento(page, uf, nomeArq)
  return { uf, href, texto }
}

/** Pix em breve com pagamento no cartão: a loja oferece "Trocar pra Pix"; o WhatsApp só ganha o foco depois da troca. */
async function pixComOutroPagamento(page, uf, nomeArq) {
  const pagamentoNoZap = () =>
    page.locator('.dm-zap').evaluate((a) => decodeURIComponent(a.getAttribute('href').split('text=')[1] ?? '').match(/^Pagamento: .*$/m)?.[0] ?? '')
  await clicar(page, 'Mudar pagamento')
  await clicar(page, 'Cartão na entrega')
  await digitar(page, 'Portão azul')
  await page.waitForTimeout(500)
  conferir((await pagamentoNoZap()) === 'Pagamento: Cartão na entrega', `${uf}: no cartão, o WhatsApp leva "Pagamento: Cartão na entrega"`)
  await page.getByRole('button', { name: /Pagar com Pix aqui no site/ }).click()
  await page.waitForTimeout(700)
  const antes = await page.evaluate(() => ({
    bolha: [...document.querySelectorAll('.dm-resposta-pix .dm-loja')].map((e) => e.textContent).join(' '),
    foco: document.activeElement?.textContent?.trim() ?? '',
    realce: !!document.querySelector('.dm-zap.dm-realce'),
  }))
  conferir(/Troca o pagamento aqui/.test(antes.bolha), `${uf}: Pix em breve no cartão oferece a troca ("${antes.bolha.slice(0, 70)}…")`)
  conferir(antes.foco === 'Trocar pra Pix' && !antes.realce, `${uf}: no cartão, o foco vai pro "Trocar pra Pix", sem realçar o WhatsApp (${antes.foco})`)
  await foto(page, `${nomeArq}-chat-pix-cartao`)
  await clicar(page, 'Trocar pra Pix')
  await page.waitForTimeout(700)
  const depois = await page.evaluate(() => ({
    foco: document.activeElement?.textContent?.trim() ?? '',
    realce: !!document.querySelector('.dm-zap.dm-realce'),
    resumo: document.querySelector('.dm-mensagem')?.textContent ?? '',
  }))
  conferir((await pagamentoNoZap()) === 'Pagamento: Pix' && /Pagamento: Pix/.test(depois.resumo), `${uf}: "Trocar pra Pix" muda o pagamento no resumo e no WhatsApp`)
  conferir(depois.foco === 'Fechar pedido no WhatsApp' && depois.realce, `${uf}: depois da troca, foco e realce no WhatsApp (${depois.foco})`)
  const href = await page.locator('.dm-zap').getAttribute('href')
  conferirMensagem(uf, decodeURIComponent(href.split('text=')[1] ?? ''))
  await foto(page, `${nomeArq}-chat-pix-trocou`)
}

/** Encomenda até o resumo: fecha no mesmo WhatsApp, sem Pix (ainda não tem preço). */
async function fluxoEncomenda(page, uf, nomeArq) {
  await clicar(page, 'Pode')
  await digitar(page, 'Fanta de uva japonesa')
  await clicar(page, '2')
  await clicar(page, 'Pular')
  await digitar(page, 'Ian Teste')
  await page.waitForTimeout(500)
  await foto(page, `${nomeArq}-encomenda-resumo`)
  const href = await page.getByRole('link', { name: 'Fechar encomenda no WhatsApp' }).getAttribute('href')
  const texto = decodeURIComponent(href?.split('text=')[1] ?? '')
  conferir(href?.startsWith(ZAP) && texto.startsWith(`ENCOMENDA GREEN CHEESE — ${uf.toUpperCase()}`), `${uf}: "Fechar encomenda no WhatsApp" abre o WhatsApp da loja com a encomenda`)
  conferir(!(await page.getByRole('button', { name: /Pix/ }).count()), `${uf}: encomenda sem o Pix em breve`)
  // celular estreito: "Fechar no WhatsApp" numa linha só, com o ícone colado no texto
  await page.setViewportSize({ width: 320, height: 568 })
  await page.waitForTimeout(400)
  const zap = page.getByRole('link', { name: 'Fechar no WhatsApp', exact: true })
  // uma linha = 52 px de altura (duas passam de 56)
  const m = await zap
    .evaluate((a) => ({ h: Math.round(a.getBoundingClientRect().height), sw: document.documentElement.scrollWidth }))
    .catch(() => null)
  conferir(m && m.h <= 54 && m.sw <= 320, `${uf}: em 320 px, "Fechar no WhatsApp" numa linha (${JSON.stringify(m)})`)
  await zap.scrollIntoViewIfNeeded().catch(() => {})
  await foto(page, `${nomeArq}-encomenda-320`)
  await page.setViewportSize({ width: 390, height: 844 })
}

/** Nenhum wa.me fora do último passo do pedido: o WhatsApp só aparece no fechamento. */
async function semZapForaDoFechamento(page, nome) {
  const n = await page.evaluate(() => document.querySelectorAll('a[href*="wa.me"]').length)
  conferir(n === 0, `${nome}: nenhum link do WhatsApp fora do fechamento do pedido (${n})`)
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
  {
    // a rua viva entre a faixa e o perfil (o mercador mora nela); mercador de repost, só no topo do Mercado
    const r = await page.evaluate(() => {
      const v = document.querySelector('.vista[data-vista="inicio"]')
      const topo = (s) => v?.querySelector(s)?.getBoundingClientRect().top ?? null
      return { faixa: topo('.faixa'), rua: topo('.rua-vaga'), perfil: topo('.so-celular .perfil'), repost: v?.querySelectorAll('.repost-figura').length ?? 0 }
    })
    conferir(r.rua != null && r.faixa < r.rua && r.rua < r.perfil && !r.repost, `cel: a rua viva entre a faixa e o perfil, sem mercador de repost no Início (${JSON.stringify(r)})`)
  }
  await page.locator('.vista-inicio .so-celular .perfil-loja').click()
  await page.waitForTimeout(1200)
  await foto(page, 'cel-06b-destaques')
  await foto(page, 'cel-16-home-inteira', true)
  await page.evaluate(() => window.scrollTo(0, 0))
  conferir((await pontosDeReferencia(page)).includes('region:Início'), 'cel: a vista do Início é a região "Início"')
  conferir(!/confirmar|importsvv/i.test((await page.locator('.vista-inicio .faixa').textContent()) ?? ''), 'cel: a faixa dos @ só com os perfis confirmados')
  await irAba(page, 'catalogo')
  const refs = await pontosDeReferencia(page)
  conferir(!refs.includes('region:Início') && refs.includes('region:Mercado'), `cel: na aba Mercado, nenhuma região "Início" vazia para o leitor de tela (${refs.join(', ')})`)
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
  // "Avisar quando chegar" vai pra DM do Instagram do estado (não pro WhatsApp da loja)
  const avisar = await page.locator('.vista:not([hidden]) .card-avisar').first().getAttribute('href')
  conferir(avisar === dmDo('mg'), `cel: "Avisar quando chegar" abre a DM do estado (${avisar})`)
  await semZapForaDoFechamento(page, 'cel catálogo')
  // destaque do estado: o último quadro é o das dúvidas, com a DM do estado
  await page.locator('.vista:not([hidden]) .destaque', { hasText: /TEÓFILO OTONI/ }).first().click()
  await page.waitForTimeout(900)
  for (let k = 0; k < 5; k++) {
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(400)
  await foto(page, 'cel-10b-destaque-duvidas')
  const dmInfo = await page.locator('.story a', { hasText: 'Chamar na DM' }).getAttribute('href').catch(() => null)
  conferir(dmInfo === dmDo('mg'), `cel: quadro "Dúvidas" do destaque do estado abre a DM (${dmInfo})`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  const mg = await fluxoPedido(page, 'mg', '39800001', 'cel-11-mg')
  relatorio.push({ mg })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await irAba(page, 'estados')
  await page.waitForTimeout(1300)
  await foto(page, 'cel-12-por-estado')
  await semZapForaDoFechamento(page, 'cel por estado')
  await irAba(page, 'inicio')
  await semZapForaDoFechamento(page, 'cel início')
  // rodapé: a dúvida vai pra DM do estado; perfil a confirmar fora da lista pública
  const rodapeDm = await page.locator('.rodape .rodape-dm').getAttribute('href').catch(() => null)
  conferir(rodapeDm === dmDo('mg'), `cel: rodapé "Outra dúvida? Chama a @… na DM" abre a DM do estado (${rodapeDm})`)
  const perfis = await page.locator('.rodape .rodape-perfis a').allTextContents()
  conferir(perfis.length === 5 && perfis.every((t) => /^@greencheese_imports(rj|mg|sp|es|sc)$/.test(t.trim())), `cel: rodapé lista só os 5 perfis dos estados (${perfis.join(', ')})`)
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

// ---------- encomenda (MG): fecha no mesmo WhatsApp, sem Pix ----------
{
  const ctx = await contexto(browser, { width: 390, height: 844 })
  const page = await ctx.newPage()
  vigiar(page, 'encomenda')
  await page.goto(`${base}?uf=mg&chat=encomenda`)
  await passarAbertura(page)
  await page.locator('[aria-modal="true"][aria-label="Pedido guiado"]').waitFor({ timeout: 8000 })
  await page.waitForTimeout(700)
  await fluxoEncomenda(page, 'mg', 'cel-14b-mg')
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
    conferir((await abaAberta(page)) === 'catalogo', 'link: ?aba=catalogo (link velho) abre o Mercado')
    await voltar(page)
    conferir(page.url() === 'about:blank', 'link: ?aba=catalogo, voltar sai do site')
    await ctx.close()
  }
  {
    const { ctx, page } = await nova(`${base}?uf=mg&aba=mercado`, 'link-mercado')
    conferir((await abaAberta(page)) === 'catalogo' && (await page.locator('.vista:not([hidden]) h1').first().textContent())?.trim() === 'Mercado', 'link: ?aba=mercado abre o Mercado')
    await irAba(page, 'inicio')
    await irAba(page, 'catalogo')
    conferir(new URL(page.url()).searchParams.get('aba') === 'mercado', `link: a aba Mercado escreve ?aba=mercado (${page.url()})`)
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
  conferir(JSON.stringify(await ativo()) === '["Mercado"]', 'lateral: tocar em Mercado depois de buscar deixa Mercado ativo')
  // Início pelo teclado: o foco vai para o título do perfil e o Tab seguinte cai nos botões dele (a rua vem depois)
  await page.locator('.lateral [data-aba="inicio"]').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  await page.keyboard.press('Tab')
  const foco = await page.evaluate(() => {
    const a = document.activeElement
    return { perfil: !!a?.closest('.hero-loja .perfil'), rua: !!a?.closest('.rua'), txt: (a?.textContent ?? '').trim().slice(0, 30) }
  })
  conferir(foco.perfil && !foco.rua, `Início pelo teclado: o Tab cai no perfil antes da rua (${foco.txt})`)
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

// ---------- matriz de desktop: Início com a rua viva embaixo do perfil (+ Mercado e Por estado) ----------
// altura cheia da tela e a área útil de verdade (menos a barra do navegador): 1366×657, 1280×650, 1536×730, 1440×790.
// De 1200 em diante, [perfil e rua | story]; de 900 a 1199 o hero empilha (story em cima, perfil e rua embaixo). A rua
// sempre à vista no computador, em escala inteira, sem cobrir o perfil, o story, as setas nem a lateral
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
  // a rua monta no respiro depois da abertura (abaixo de 1200 ela fica embaixo do story: rola até ela)
  await page.locator('.hero-loja .rua[data-rua]').waitFor({ timeout: 10000 }).catch(() => {})
  const foraDaTela = await page.evaluate(() => {
    const e = document.querySelector('.hero-loja .rua-vaga')
    return !!e && e.getBoundingClientRect().bottom > innerHeight
  })
  if (foraDaTela) await page.evaluate(() => document.querySelector('.hero-loja .rua-vaga').scrollIntoView({ block: 'center' }))
  for (let k = 0; k < 60 && (await page.locator('.hero-loja .rua').getAttribute('data-rua').catch(() => null)) !== 'rodando'; k++) await page.waitForTimeout(100)
  const ruaEstado = await page.locator('.hero-loja .rua').getAttribute('data-rua').catch(() => null)
  if (foraDaTela) await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(500)
  const c = await page.evaluate(() => {
    const r = (s) => {
      const e = document.querySelector(s)
      const b = e?.getBoundingClientRect()
      return b && b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } : null
    }
    const textos = [...document.querySelectorAll('.hero-desktop-perfil *')].filter((e) => !e.children.length && e.getClientRects().length && e.textContent.trim())
    const tela = document.querySelector('.hero-loja .rua-tela')
    return {
      rua: r('.hero-loja .rua-vaga'),
      ruaPx: tela ? tela.getBoundingClientRect().height / tela.height : null,
      perfil: r('.hero-desktop-perfil .perfil'),
      story: r('.hero-quadro'),
      setaE: r('.hero-seta-esq'),
      setaD: r('.hero-seta-dir'),
      lateral: r('.lateral'),
      textoPerfil: textos.length ? Math.min(...textos.map((e) => e.getBoundingClientRect().left)) : null,
      sorteNoHero: /Teste minha sorte|Tá com sorte|Todo giro ganha/i.test(document.querySelector('.vista-inicio .hero')?.textContent ?? ''),
      empilhado: !!document.querySelector('.vista-inicio .hero.hero-empilhado'),
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
  const nomes = ['rua', 'perfil', 'story', 'setaE', 'setaD', 'lateral']
  for (let i = 0; i < nomes.length; i++) for (let j = i + 1; j < nomes.length; j++) if (cruza(c[nomes[i]], c[nomes[j]])) erros.push(`[${nome}] ${nomes[i]} por cima de ${nomes[j]}`)
  // o story nunca encolhe por causa da rua: 330 px ou mais, a não ser que a altura da janela (16:9) não deixe
  const minimo = Math.min(330, Math.floor(((h - 120) * 9) / 16) - 2)
  conferir(!!c.story && c.story.w >= minimo, `${nome}: story com ${c.story ? Math.round(c.story.w) : 0} px (>= ${minimo})`)
  conferir(!c.larg, `${nome}: sem rolagem lateral`)
  if (c.lateral && c.textoPerfil != null) conferir(c.textoPerfil >= c.lateral.r - 1, `${nome}: texto do perfil fora da lateral (${Math.round(c.textoPerfil)} >= ${Math.round(c.lateral.r)})`)
  conferir(!c.sorteNoHero, `${nome}: nada do Teste minha sorte no topo do Início`)
  conferir(!!c.rua && ruaEstado === 'rodando', `${nome}: a rua viva no Início do computador, andando à vista (${ruaEstado})`)
  if (c.rua) {
    conferir(c.ruaPx != null && Math.abs(c.ruaPx - Math.round(c.ruaPx)) < 0.01 && c.ruaPx >= 2 && c.ruaPx <= 5, `${nome}: rua em escala inteira de 2× a 5× (${c.ruaPx})`)
    conferir(!!c.perfil && c.rua.t >= c.perfil.b - 1, `${nome}: a rua embaixo do perfil (${Math.round(c.rua.t)} / ${c.perfil ? Math.round(c.perfil.b) : '?'})`)
  }
  // arranjo por largura: de 900 a 1199 empilhado (story em cima); de 1200 em diante, perfil e rua ao lado do story
  if (w < 1200) conferir(c.empilhado && c.storyAntes, `${nome}: story em cima, perfil e rua embaixo`)
  else conferir(!c.empilhado && !c.storyAntes, `${nome}: perfil e rua ao lado do story`)
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

// ---------- Mercado: o mercador no topo (o dono da banca), o mouse abre o casaco na hora; movimento reduzido, parado ----
for (const reduzir of [false, true]) {
  const ctx = await contexto(browser, { width: 1440, height: 900 }, { reduzir })
  const page = await ctx.newPage()
  vigiar(page, `mercado-topo${reduzir ? '-reduzido' : ''}`)
  await page.goto(`${base}?uf=mg&aba=mercado`)
  await passarAbertura(page)
  const fig = page.locator('.vista:not([hidden]) .mercado-topo .mercado-dono')
  await fig.waitFor({ timeout: 5000 })
  const m = await page.evaluate(() => {
    const v = document.querySelector('.vista[data-vista="catalogo"]')
    const topo = v?.querySelector('.mercado-topo')
    const busca = v?.querySelector('.busca')
    return {
      antesDaBusca: !!topo && !!busca && topo.getBoundingClientRect().bottom <= busca.getBoundingClientRect().top + 1,
      mercadores: v?.querySelectorAll('.repost-figura').length ?? 0,
      fala: v?.querySelector('.mercado-fala')?.textContent?.trim(),
      titulo: v?.querySelector('h1')?.textContent?.trim(),
    }
  })
  conferir(m.antesDaBusca && m.mercadores === 1 && m.fala === 'Chega mais.' && m.titulo === 'Mercado', `Mercado: o mercador no topo, uma vez só, recebendo ("Chega mais.") (${JSON.stringify(m)})`)
  // espera a parte parada (nenhuma camada da apresentação à vista) e passa o mouse
  const visivel = (s) => page.evaluate((s) => [...document.querySelectorAll(`.mercado-dono ${s}`)].some((e) => getComputedStyle(e).visibility === 'visible' && getComputedStyle(e).display !== 'none'), s)
  for (let k = 0; k < 150 && (await visivel('.repost-quadro')); k++) await page.waitForTimeout(100)
  await page.mouse.move(5, 5)
  await fig.hover()
  await page.waitForTimeout(300)
  const abriu = await visivel('.q-aberto, .q-meio')
  if (reduzir) conferir(!abriu, 'Mercado com movimento reduzido: o mercador fica parado (o mouse não anima)')
  else conferir(abriu, 'Mercado: o mouse em cima do mercador abre o casaco na hora')
  await fig.click()
  conferir((await page.locator('.mercado-fala').textContent())?.trim() !== 'Chega mais.', 'Mercado: tocar no mercador muda a fala')
  await foto(page, `desk-10-mercado-topo${reduzir ? '-reduzido' : ''}`)
  await ctx.close()
}

// ---------- a rua viva: aparece, para fora da tela (o rAF para), pausa, movimento reduzido parado, chamar o mercador ----
for (const [w, h, reduzir] of [[390, 844, false], [1280, 800, false], [390, 844, true]]) {
  const nome = `rua-${w}${reduzir ? '-reduzido' : ''}`
  const ctx = await contexto(browser, { width: w, height: h }, { reduzir })
  // conta só as voltas do requestAnimationFrame do relógio da rua (o laço com o acumulador, motor.ts); o resto da
  // página (story, GSAP) tem os rAF dele
  await ctx.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window)
    window.__voltas = 0
    window.requestAnimationFrame = (cb) => {
      if (!String(cb).includes('acum')) return raf(cb)
      return raf((t) => {
        window.__voltas++
        cb(t)
      })
    }
  })
  const page = await ctx.newPage()
  vigiar(page, nome)
  await page.goto(`${base}?uf=mg`)
  await passarAbertura(page)
  const rua = page.locator('.vista:not([hidden]) .rua')
  await rua.waitFor({ state: 'attached', timeout: 10000 })
  await page.evaluate(() => document.querySelector('.vista:not([hidden]) .rua-vaga').scrollIntoView({ block: 'center' }))
  for (let k = 0; k < 60 && !['rodando', 'foto'].includes(await rua.getAttribute('data-rua')); k++) await page.waitForTimeout(100)
  const estado = await rua.getAttribute('data-rua')
  conferir(estado === (reduzir ? 'foto' : 'rodando'), `${nome}: a rua ${reduzir ? 'vira uma foto (movimento reduzido)' : 'anda à vista'} (${estado})`)
  conferir((await page.locator('.vista:not([hidden]) .rua-tela[aria-hidden="true"]').count()) === 1 && (await rua.getAttribute('aria-label')) === 'A rua da loja', `${nome}: canvas decorativo e grupo com rótulo curto`)
  // desenho de verdade no canvas (não ficou preto)
  const cores = await page.evaluate(() => {
    const c = document.querySelector('.vista:not([hidden]) .rua-tela')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    const s = new Set()
    for (let i = 0; i < d.length; i += 4 * 7) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
    return s.size
  })
  conferir(cores > 6, `${nome}: a rua desenhada no canvas (${cores} cores)`)
  const quadro = () => page.evaluate(() => document.querySelector('.vista:not([hidden]) .rua-tela').toDataURL())
  if (reduzir) {
    const a = await quadro()
    await page.waitForTimeout(2500)
    conferir(a === (await quadro()), `${nome}: com movimento reduzido nada anda (o mesmo quadro)`)
    conferir(!(await page.locator('.rua-pausa').count()), `${nome}: sem botão de pausar (nada se mexe)`)
  } else {
    // botão de pausar: alvo de 44 px, pausa e continua
    const pausa = page.locator('.vista:not([hidden]) .rua-pausa')
    const bb = await pausa.boundingBox()
    conferir(!!bb && bb.width >= 44 && bb.height >= 44, `${nome}: botão de pausar com alvo de 44 px (${bb ? `${bb.width}×${bb.height}` : '?'})`)
    await pausa.click()
    await page.waitForTimeout(200)
    const v0 = await page.evaluate(() => window.__voltas)
    await page.waitForTimeout(1000)
    const v1 = await page.evaluate(() => window.__voltas)
    conferir((await rua.getAttribute('data-rua')) === 'parada' && (await pausa.getAttribute('aria-label')) === 'Continuar a rua', `${nome}: pausar para a rua`)
    await pausa.click()
    await page.waitForTimeout(200)
    conferir((await rua.getAttribute('data-rua')) === 'rodando', `${nome}: continuar volta a andar`)
    // fora da tela o relógio para: o rAF quase não volta (só o que sobra do resto da página)
    const n0 = await page.evaluate(() => window.__voltas)
    await page.waitForTimeout(1000)
    const n1 = await page.evaluate(() => window.__voltas)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForTimeout(600)
    const f0 = await page.evaluate(() => window.__voltas)
    await page.waitForTimeout(1500)
    const f1 = await page.evaluate(() => window.__voltas)
    conferir((await rua.getAttribute('data-rua')) === 'parada', `${nome}: fora da tela a rua para`)
    relatorio.push(`${nome}: rAF por segundo — à vista ${n1 - n0}, pausada ${v1 - v0}, fora da tela ${Math.round((f1 - f0) / 1.5)}`)
    conferir(n1 - n0 >= 30 && f1 - f0 <= 3 && v1 - v0 <= 3, `${nome}: o rAF da rua para fora da tela e pausada (${n1 - n0} → ${f1 - f0} / ${v1 - v0})`)
    await page.evaluate(() => document.querySelector('.vista:not([hidden]) .rua-vaga').scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(400)
  }
  // chamar o mercador pelo teclado: o botão focável abre o balão e o adesivo "Ver o Mercado", que leva à aba Mercado
  const botao = page.locator('.vista:not([hidden]) .rua-mercador')
  await botao.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const cta = page.locator('.vista:not([hidden]) .rua-cta')
  const bal = await page.locator('.vista:not([hidden]) .rua-balao').allTextContents()
  conferir((await cta.count()) === 1 && bal.some((t) => /Chega mais|Vem no certo|Quem já usou/.test(t)), `${nome}: chamar o mercador abre o balão e o "Ver o Mercado" (${bal.join(' | ')})`)
  const cb = await cta.boundingBox()
  conferir(!!cb && cb.height >= 44, `${nome}: "Ver o Mercado" com alvo de 44 px (${cb ? Math.round(cb.height) : '?'})`)
  await foto(page, `${nome}-chamado`)
  await page.keyboard.press('Tab')
  conferir(await cta.evaluate((e) => e === document.activeElement), `${nome}: o Tab seguinte cai no "Ver o Mercado"`)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  conferir((await abaAberta(page)) === 'catalogo', `${nome}: "Ver o Mercado" abre a aba Mercado`)
  await ctx.close()
}

// ---------- as falas da rua: nenhuma palavra da lista PALAVRAS_PROIBIDAS (src/dados/sorte.ts) ----------
{
  const raiz = new URL('../src/', import.meta.url)
  const sorte = readFileSync(new URL('dados/sorte.ts', raiz), 'utf8')
  const lista = [...(sorte.match(/PALAVRAS_PROIBIDAS = \[([\s\S]*?)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  const falas = readFileSync(new URL('componentes/rua/falas.ts', raiz), 'utf8')
  const textos = [...falas.replace(/^\s*\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map((m) => m[1].toLowerCase())
  const achou = lista.filter((p) => textos.some((t) => new RegExp(`(^|[^a-zà-ú])${p}([^a-zà-ú]|$)`).test(t)))
  conferir(lista.length > 10 && textos.length > 20 && !achou.length, `rua: as falas sem palavra proibida (${achou.join(', ') || `${textos.length} falas`})`)
}

await browser.close()
writeFileSync(`${dir}relatorio.json`, JSON.stringify({ erros, relatorio }, null, 2))
console.log(JSON.stringify({ erros, relatorio: relatorio.filter((r) => typeof r !== 'string' || !r.startsWith('ok:')) }, null, 2))
console.log(erros.length ? `${erros.length} problema(s)` : 'sem problemas')
