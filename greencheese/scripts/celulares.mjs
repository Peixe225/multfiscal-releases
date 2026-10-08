// Matriz de celulares: rolagem lateral e alvos de toque em cada aba, barra de abas, voltar entre abas, story cabendo
// na tela com gestos de toque reais, chat pela linha de resposta do story e o Início (story → faixa → perfil →
// destaques com as abas primeiro, o fio e os filtros → grade → rodapé, sem mercador, sem Teste minha sorte e sem
// repost no fim; o "Tudo" inteiro e o filtro seguinte espiando na primeira tela da linha; o filtro filtra a grade do
// próprio Início; a faixa só com os perfis confirmados). Também: celular deitado (story do hero inteiro acima da
// barra, nada encavalado), celular grande deitado com o layout de computador (lateral rola, Por estado alcançável) e
// o teclado do Android (interactive-widget=resizes-content: a janela encolhe e a barra de abas sai). A API do rateio
// responde como "sem servidor" (o zip, o preview sem PHP): os rateios de exemplo, sem erro no console.
// Uso: com "npm run dev" rodando → node scripts/celulares.mjs [pasta-saida] [url-base]
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers'
const { chromium } = await import(new URL('../node_modules/playwright/index.mjs', import.meta.url).href)
import { mkdirSync } from 'node:fs'

const base = process.argv[3] ?? 'http://localhost:5173/'
const out = new URL(`../revisao/${process.argv[2] ?? 'celulares'}/`, import.meta.url).pathname
mkdirSync(out, { recursive: true })
const aparelhos = [
  ['se-320x568', 320, 568],
  ['android-360x640', 360, 640],
  ['ig-360x560', 360, 560],
  ['iphone8-375x667', 375, 667],
  ['iphone13-390x844', 390, 844],
  ['pixel-412x915', 412, 915],
  ['promax-430x932', 430, 932],
]
const b = await chromium.launch()
const problemas = []

async function contexto(w, h, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'pt-BR' })
  const ip = opts.ip ?? { region: 'Minas Gerais', region_code: 'MG' }
  await ctx.route(/ipwho|geojs/, (r) => r.fulfill({ json: { success: true, country_code: 'BR', ...ip } }))
  // sem servidor da loja (HTML no lugar de JSON, como o preview sem PHP): o rateio mostra os exemplos
  await ctx.route('**/api/index.php**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>sem servidor</title>' }))
  if (opts.semDica) await ctx.addInitScript(() => sessionStorage.setItem('gc-dica-hero', '1'))
  return ctx
}

async function abrir(p, nome, url) {
  p.on('pageerror', (e) => problemas.push(`${nome}: pageerror ${e.message}`))
  await p.goto(url)
  await p.getByRole('button', { name: 'Tenho', exact: true }).tap()
  await p.locator('.abertura').waitFor({ state: 'detached', timeout: 9000 })
  await p.waitForTimeout(700)
}

/**
 * Abre já com a idade lembrada (sem a abertura): deitado, o "Tenho" da abertura fica abaixo da dobra (a abertura
 * não é desta rodada; aqui interessa o hero e a lateral).
 */
async function abrirLembrado(ctx, p, nome, url) {
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
      sessionStorage.setItem('gc-abertura', '1')
    } catch {
      /* ignora */
    }
  })
  p.on('pageerror', (e) => problemas.push(`${nome}: pageerror ${e.message}`))
  await p.goto(url)
  await p.waitForTimeout(1500)
}

/** Troca de aba pela barra (ou pela lateral) e espera a vista aparecer. */
async function irAba(p, aba) {
  await p.locator(`[data-aba="${aba}"]:visible`).first().click()
  const alvo = aba === 'catalogo' ? '#catalogo' : aba === 'estados' ? '#estados' : aba === 'rateio' ? '#rateio-titulo' : '.hero'
  await p.locator(`.vista:not([hidden]) ${alvo}`).first().waitFor({ state: 'visible', timeout: 5000 })
  await p.waitForTimeout(300)
}

/** Percorre a vista aberta procurando estouro lateral e alvos pequenos. */
async function varrer(p, nome, aba) {
  const larg = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  if (larg[0] > larg[1]) problemas.push(`${nome} (${aba}): rolagem lateral (${larg[0]} > ${larg[1]})`)
  const ruins = await p.evaluate(async () => {
    const r = []
    const H = document.body.scrollHeight
    for (let y = 0; y < H; y += window.innerHeight * 0.8) {
      window.scrollTo(0, y)
      await new Promise((res) => setTimeout(res, 120))
      if (document.documentElement.scrollWidth > window.innerWidth) r.push(`rolagem lateral em y=${Math.round(y)}`)
    }
    window.scrollTo(0, 0)
    for (const el of document.querySelectorAll('main button, main a, main input, .barra-abas a, .barra-abas button')) {
      const b = el.getBoundingClientRect()
      const st = getComputedStyle(el)
      if (st.visibility === 'hidden' || st.display === 'none' || b.width === 0) continue
      if (el.closest('[aria-hidden="true"], [hidden], [inert]')) continue
      if (b.right > window.innerWidth + 1 || b.left < -1) r.push(`fora da tela: ${el.className || el.tagName} "${(el.textContent || '').trim().slice(0, 30)}" (${Math.round(b.left)}..${Math.round(b.right)})`)
      if ((b.height < 40 || b.width < 40) && !el.classList.contains('card-abrir')) r.push(`alvo pequeno ${Math.round(b.width)}×${Math.round(b.height)}: ${el.className || el.tagName} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`)
    }
    return [...new Set(r)]
  })
  // fora da tela em carrosséis horizontais (destaques, faixa) é esperado
  ruins.filter((x) => !/destaque|faixa-item/.test(x)).forEach((x) => problemas.push(`${nome} (${aba}): ${x}`))
}

/** Foto da página inteira: o card fora da tela pula a pintura (content-visibility: auto); na foto, todos pintam. */
async function fotoInteira(p, caminho) {
  await p.locator('.vista-inicio .catalogo-inicio .grade').waitFor({ state: 'attached', timeout: 6000 }).catch(() => {})
  const estilo = await p.addStyleTag({ content: '.grade > .card { content-visibility: visible !important }' })
  await p.waitForTimeout(300)
  await p.screenshot({ path: caminho, fullPage: true })
  await estilo.evaluate((e) => e.remove())
}

/** Barra de abas: fixa no pé, de 4 a 6 células de 44×44 ou mais, dentro da tela, Início marcado. */
async function conferirBarra(p, nome) {
  const r = await p.evaluate(() => {
    const barra = document.querySelector('.barra-abas')
    if (!barra) return null
    const bb = barra.getBoundingClientRect()
    const itens = [...barra.querySelectorAll('a, button')].map((e) => {
      const b = e.getBoundingClientRect()
      return { aba: e.dataset.aba, w: b.width, h: b.height, l: b.left, r: b.right, atual: e.getAttribute('aria-current') }
    })
    return { fundo: bb.bottom, alto: window.innerHeight, itens, larg: window.innerWidth }
  })
  if (!r) return problemas.push(`${nome}: sem .barra-abas`)
  if (Math.abs(r.fundo - r.alto) > 2) problemas.push(`${nome}: barra de abas fora do pé (${Math.round(r.fundo)} ≠ ${r.alto})`)
  if (r.itens.length < 4 || r.itens.length > 6) problemas.push(`${nome}: barra com ${r.itens.length} itens`)
  // com entrega: Início, Catálogo, Rateio, Teste minha sorte, Sacola, Por estado (nessa ordem)
  const ordem = r.itens.map((i) => i.aba).join(',')
  if (ordem !== 'inicio,catalogo,rateio,sorte,sacola,estados') problemas.push(`${nome}: ordem da barra ${ordem}`)
  for (const i of r.itens) {
    if (i.w < 44 || i.h < 44) problemas.push(`${nome}: aba ${i.aba} pequena (${Math.round(i.w)}×${Math.round(i.h)})`)
    if (i.l < -1 || i.r > r.larg + 1) problemas.push(`${nome}: aba ${i.aba} fora da tela`)
  }
  if (r.itens.find((i) => i.aba === 'inicio')?.atual !== 'page') problemas.push(`${nome}: Início sem aria-current`)
}

const abaAberta = (p) => p.evaluate(() => document.querySelector('.vista:not([hidden])')?.dataset.vista)

/**
 * O Início, de cima a baixo: story, faixa, perfil (com "Ver loja"), destaques, grade (a caixa de encomenda por último)
 * e o rodapé. Destaques: o grupo das abas (estado, Buscar, Rateio, interativos, Por estado), o fio e o grupo dos
 * filtros.
 * Nada do fim da aba Catálogo (Teste minha sorte, repost do mercador) e nenhum mercador. Ids próprios (o #catalogo é
 * da aba Catálogo, que o chat e a rolagem usam).
 */
async function conferirInicio(p, nome) {
  const r = await p.evaluate(() => {
    const v = document.querySelector('.vista[data-vista="inicio"]')
    const topo = (s) => {
      const e = v?.querySelector(s)
      return e && e.getClientRects().length ? e.getBoundingClientRect().top + scrollY : null
    }
    const rodape = document.querySelector('.rodape')
    const grade = v?.querySelector('.catalogo-inicio .grade')
    const ultimo = grade?.lastElementChild
    const nav = v?.querySelector('.destaques-inicio nav.destaques-grupo')
    const fio = v?.querySelector('.destaques-inicio .destaques-fio')
    const filtros = v?.querySelector('.destaques-inicio [role="group"][aria-label="Categorias"]')
    const ordemDestaques = nav && fio && filtros ? !!(nav.compareDocumentPosition(fio) & 4) && !!(fio.compareDocumentPosition(filtros) & 4) : false
    const fioB = fio?.getBoundingClientRect()
    // a linha na primeira tela (sem arrastar): quanto aparece do último caminho, do fio e do 1º filtro
    const visivel = (e) => {
      const b = e?.getBoundingClientRect()
      return b ? { px: Math.max(0, Math.min(b.right, innerWidth) - Math.max(b.left, 0)), w: b.width } : null
    }
    const [f1] = filtros ? [...filtros.querySelectorAll('[aria-pressed]')] : []
    const caminhos = nav ? [...nav.children] : []
    return {
      linha: { tudo: visivel(f1), caminhos: caminhos.map(visivel), fio: visivel(fio), larg: innerWidth },
      faixaAConfirmar: /confirmar|importsvv/i.test(v?.querySelector('.faixa')?.textContent ?? ''),
      setas: v?.querySelectorAll('.destaques-seta').length ?? 0,
      ordem: ['.hero', '.faixa', '.so-celular .perfil', '.destaques-inicio', '.catalogo-inicio .grade'].map(topo),
      gradeFim: grade ? grade.getBoundingClientRect().bottom + scrollY : null,
      rodape: rodape ? rodape.getBoundingClientRect().top + scrollY : null,
      ultimoCaixa: !!ultimo?.classList.contains('card-caixa'),
      ordemDestaques,
      abas: nav ? [...nav.children].map((e) => e.getAttribute('data-destaque') ?? (e.classList.contains('destaque-interativo') ? 'interativo' : 'estado')) : [],
      filtros: filtros ? filtros.querySelectorAll('[aria-pressed]').length : 0,
      fio: fioB ? { w: fioB.width, h: fioB.height } : null,
      fimCatalogo: !!v?.querySelector('.aba-fim, .reposts, .adesivos-interativos, #secao-interativo, #secao-marcados'),
      mercador: !!v?.querySelector('.mercador-loja, .repost-figura'),
      idsRepetidos: !!v?.querySelector('#catalogo, #catalogo-titulo'),
      busca: !!v?.querySelector('.busca, .chip-disp'),
    }
  })
  const o = r.ordem
  if (o.some((y) => y == null)) problemas.push(`${nome}: falta peça no Início (${JSON.stringify(o)})`)
  else if (o.some((y, i) => i && y < o[i - 1])) problemas.push(`${nome}: ordem do Início errada (${o.map(Math.round).join(' < ')})`)
  if (r.gradeFim != null && r.rodape != null && (r.rodape < r.gradeFim - 1 || r.rodape - r.gradeFim > 120)) problemas.push(`${nome}: o rodapé não vem logo depois da grade (${Math.round(r.gradeFim)} → ${Math.round(r.rodape)})`)
  if (!r.ultimoCaixa) problemas.push(`${nome}: a caixa de encomenda não é a última célula da grade do Início`)
  if (!r.ordemDestaques) problemas.push(`${nome}: destaques do Início fora da ordem abas → fio → filtros`)
  if (JSON.stringify(r.abas) !== JSON.stringify(['estado', 'catalogo', 'rateio', 'interativo', 'estados'])) problemas.push(`${nome}: abas dos destaques ${JSON.stringify(r.abas)}`)
  if (r.filtros < 6) problemas.push(`${nome}: só ${r.filtros} filtros nos destaques do Início`)
  if (!r.fio || r.fio.w > 1.5 || r.fio.h < 20) problemas.push(`${nome}: fio entre abas e filtros ${JSON.stringify(r.fio)}`)
  if (r.fimCatalogo) problemas.push(`${nome}: o Início ainda tem o fim da aba Catálogo (Teste minha sorte/repost)`)
  if (r.mercador) problemas.push(`${nome}: mercador no Início do celular`)
  if (r.idsRepetidos) problemas.push(`${nome}: #catalogo/#catalogo-titulo repetidos no Início`)
  if (r.busca) problemas.push(`${nome}: busca ou "Só DISPONÍVEL" no Início`)
  // a primeira tela da linha mostra que ela rola: com o Rateio nos caminhos, de 360 px em diante os 5 caminhos inteiros,
  // o fio e o "Tudo" espiando na borda (8 px ou mais, sem caber inteiro); em 320, o último caminho espiando
  const { tudo, caminhos, fio, larg } = r.linha
  const espia = (v) => !!v && v.px >= 8 && v.px <= v.w - 4
  if (!tudo || !caminhos.length) problemas.push(`${nome}: destaques sem medida`)
  else if (larg >= 360) {
    if (caminhos.some((c) => !c || c.px < c.w - 0.5)) problemas.push(`${nome}: caminho dos destaques cortado (${caminhos.map((c) => Math.round(c?.px ?? 0)).join('/')})`)
    if (!fio || fio.px < 1) problemas.push(`${nome}: o fio entre caminhos e filtros fora da primeira tela`)
    if (!espia(tudo)) problemas.push(`${nome}: o "Tudo" não espia na borda (${Math.round(tudo.px)} de ${Math.round(tudo.w)} px)`)
  } else if (!espia(caminhos[caminhos.length - 1])) problemas.push(`${nome}: em ${larg} px, nada espiando na borda da linha de destaques`)
  if (r.faixaAConfirmar) problemas.push(`${nome}: perfil a confirmar na faixa dos @`)
  // as setas da linha são do computador com mouse; no celular a linha anda com o dedo
  if (r.setas) problemas.push(`${nome}: setas da linha de destaques no celular`)
}

for (const [nome, w, h] of aparelhos) {
  const ctx = await contexto(w, h)
  const p = await ctx.newPage()
  await abrir(p, nome, `${base}?uf=mg`)
  await p.screenshot({ path: `${out}${nome}-1-home.png` })
  await fotoInteira(p, `${out}${nome}-1b-home-inteira.png`)
  await conferirBarra(p, nome)
  // a grade do Início entra no primeiro respiro: espera ela
  await p.locator('.vista-inicio .catalogo-inicio .grade').waitFor({ state: 'attached', timeout: 6000 }).catch(() => {})
  await conferirInicio(p, nome)
  // perfil e destaques ("Ver loja" desce até eles)
  await p.locator('.vista-inicio .so-celular .perfil-loja').tap()
  await p.waitForTimeout(1200)
  const loja = await p.evaluate(() => ({ topo: document.querySelector('.vista-inicio .destaques-inicio').getBoundingClientRect().top, aba: document.querySelector('.vista:not([hidden])')?.dataset.vista }))
  if (loja.aba !== 'inicio' || loja.topo < 40 || loja.topo > 160) problemas.push(`${nome}: "Ver loja" não parou nos destaques (${JSON.stringify(loja)})`)
  await p.screenshot({ path: `${out}${nome}-1c-destaques.png` })
  // filtro do Início: Sedas filtra a grade dele (a da aba Catálogo fica como está)
  const sedas = p.locator('.vista-inicio .destaque[aria-pressed]', { hasText: 'Sedas' })
  await sedas.scrollIntoViewIfNeeded()
  await sedas.tap()
  await p.waitForTimeout(900)
  const f = await p.evaluate(() => ({
    nomes: [...document.querySelectorAll('.vista-inicio .catalogo-inicio .grade > .card:not(.card-caixa) .sq-nome')].map((e) => e.textContent),
    catalogo: document.querySelectorAll('.vista[data-vista="catalogo"] .grade > .card:not(.card-caixa)').length,
    pressionado: document.querySelector('.vista-inicio .destaque[aria-pressed="true"]')?.textContent,
  }))
  if (!f.nomes.length || f.nomes.some((n) => !/seda/i.test(n)) || !/Sedas/.test(f.pressionado ?? '')) problemas.push(`${nome}: filtro Sedas do Início não filtrou a grade (${JSON.stringify(f)})`)
  if (f.catalogo && f.catalogo <= f.nomes.length) problemas.push(`${nome}: o filtro do Início mexeu na grade da aba Catálogo`)
  await p.screenshot({ path: `${out}${nome}-1d-filtro-sedas.png` })
  await p.locator('.vista-inicio .destaque[aria-pressed]', { hasText: 'Tudo' }).tap()
  await p.waitForTimeout(600)
  await p.evaluate(() => scrollTo(0, 0))
  await varrer(p, nome, 'inicio')
  await irAba(p, 'catalogo')
  await p.screenshot({ path: `${out}${nome}-2-catalogo.png` })
  await varrer(p, nome, 'catalogo')
  // a aba Catálogo continua com o fim dela (Teste minha sorte e o repost do mercador)
  const fim = await p.evaluate(() => {
    const v = document.querySelector('.vista[data-vista="catalogo"]')
    return { reposts: !!v?.querySelector('.reposts .repost-figura'), interativo: !!v?.querySelector('#secao-interativo'), busca: !!v?.querySelector('.busca input') }
  })
  if (!fim.reposts || !fim.interativo || !fim.busca) problemas.push(`${nome}: a aba Catálogo perdeu busca/Teste minha sorte/repost (${JSON.stringify(fim)})`)
  await irAba(p, 'estados')
  await p.screenshot({ path: `${out}${nome}-3-estados.png` })
  await varrer(p, nome, 'estados')
  // voltar do Android/navegador: Por estado → Catálogo → Início
  await p.goBack()
  await p.waitForTimeout(600)
  if ((await abaAberta(p)) !== 'catalogo' || !(await p.locator('.vista:not([hidden]) #catalogo').isVisible())) problemas.push(`${nome}: voltar não caiu no Catálogo`)
  await p.goBack()
  await p.waitForTimeout(600)
  if ((await abaAberta(p)) !== 'inicio') problemas.push(`${nome}: voltar não caiu no Início`)

  // story: abre pelo Catálogo, cabe na tela, gestos; fecha e continua no Catálogo
  await irAba(p, 'catalogo')
  const card = p.getByRole('button', { name: /Seda OCB Premium Slim.*Abrir story/ })
  await card.scrollIntoViewIfNeeded()
  await p.waitForTimeout(400)
  await card.click()
  await p.waitForTimeout(1100)
  await p.screenshot({ path: `${out}${nome}-4-story.png` })
  const caixa = await p.evaluate(() => {
    const q = document.querySelector('.story-quadro').getBoundingClientRect()
    const rod = document.querySelector('.story-rodape')?.getBoundingClientRect()
    const por = document.querySelector('.ad-por')?.getBoundingClientRect()
    return { q: [q.top, q.bottom], rod: rod ? [rod.top, rod.bottom] : null, por: por ? [por.top, por.bottom] : null, h: window.innerHeight }
  })
  if (caixa.rod && caixa.rod[1] > caixa.h + 1) problemas.push(`${nome}: rodapé do story cortado (${Math.round(caixa.rod[1])} > ${caixa.h})`)
  if (caixa.por && caixa.por[1] > caixa.q[1]) problemas.push(`${nome}: "Pôr na sacola" fora do quadro`)
  // toque no lado direito avança, esquerdo volta
  const nomeAntes = await p.locator('.story-produto .sq-nome').textContent()
  const q = await p.locator('.story-palco').boundingBox()
  await p.touchscreen.tap(q.x + q.width * 0.85, q.y + q.height * 0.35)
  await p.waitForTimeout(500)
  const nomeDepois = await p.locator('.story-produto .sq-nome').textContent()
  if (nomeAntes === nomeDepois) problemas.push(`${nome}: toque à direita não avançou o story`)
  await p.touchscreen.tap(q.x + q.width * 0.12, q.y + q.height * 0.35)
  await p.waitForTimeout(500)
  if ((await p.locator('.story-produto .sq-nome').textContent()) !== nomeAntes) problemas.push(`${nome}: toque à esquerda não voltou`)
  // arrastar para baixo fecha (toque real via CDP)
  const cdp = await ctx.newCDPSession(p)
  const x = q.x + q.width / 2
  const y0 = q.y + q.height * 0.3
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
  for (let k = 1; k <= 10; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + k * 22 }] })
    await p.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await p.waitForTimeout(900)
  if (await p.locator('.story').count()) problemas.push(`${nome}: arrastar para baixo não fechou o story`)
  if ((await abaAberta(p)) !== 'catalogo') problemas.push(`${nome}: fechar o story saiu do Catálogo`)

  // rateio: a aba (os 2 rateios de exemplo, sem servidor), sem rolagem lateral e com alvos de 44 px; a página abre pelo
  // adesivo "Entrar no rateio" e o voltar do Android fecha ela
  await irAba(p, 'rateio')
  await p.locator('.vista[data-vista="rateio"] .rt').first().waitFor({ timeout: 6000 }).catch(() => {})
  await p.screenshot({ path: `${out}${nome}-3b-rateio.png` })
  await varrer(p, nome, 'rateio')
  if ((await p.locator('.vista[data-vista="rateio"] .rt').count()) !== 2) problemas.push(`${nome}: aba Rateio sem os 2 rateios de exemplo`)
  await p.locator('.vista[data-vista="rateio"] .rt-entrar').first().tap()
  await p.waitForTimeout(900)
  const pg = await p.evaluate(() => {
    const j = document.querySelector('.rp .pp-janela')?.getBoundingClientRect()
    return { aberta: !!j, cobre: !!j && j.width >= innerWidth - 1 && j.height >= innerHeight - 1, larg: document.documentElement.scrollWidth > innerWidth }
  })
  if (!pg.aberta || !pg.cobre || pg.larg) problemas.push(`${nome}: página do rateio (${JSON.stringify(pg)})`)
  await p.screenshot({ path: `${out}${nome}-3c-rateio-pagina.png` })
  await p.goBack()
  await p.waitForTimeout(800)
  if ((await p.locator('.rp').count()) || (await abaAberta(p)) !== 'rateio') problemas.push(`${nome}: voltar não fechou a página do rateio`)

  // chat: pela linha de resposta do story do Início
  await irAba(p, 'inicio')
  await p.locator('.hero-resposta .barra-pilula').click()
  await p.waitForTimeout(700)
  await p.getByRole('button', { name: 'Isso', exact: true }).last().click()
  await p.waitForTimeout(300)
  await p.screenshot({ path: `${out}${nome}-5-chat.png` })
  const chips = await p.locator('.dm-atual .dm-chip').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return b.bottom <= window.innerHeight && b.right <= window.innerWidth }))
  if (chips.some((v) => !v)) problemas.push(`${nome}: resposta rápida fora da tela no chat`)
  await ctx.close()
  console.log('✓', nome)
}

// ---------- story do Início: uma barrinha por produto; o último também anda sozinho ----------
{
  const ctx = await contexto(390, 844, { semDica: true })
  const p = await ctx.newPage()
  await abrir(p, 'barras', `${base}?uf=mg`)
  const info = () =>
    p.evaluate(() => ({
      barras: document.querySelectorAll('.hero-barras .story-barra').length,
      nome: document.querySelector('.hero-palco .sq-nome')?.textContent ?? '?',
    }))
  const quadro = await p.locator('.hero-quadro').boundingBox()
  const vistos = new Set()
  let ultimo = await info()
  // passa até dar a volta (o mesmo nome de novo) e guarda quantos passos tem
  for (let k = 0; k < 12; k++) {
    vistos.add(ultimo.nome)
    await p.touchscreen.tap(quadro.x + quadro.width * 0.92, quadro.y + quadro.height * 0.3)
    await p.waitForTimeout(450)
    const i = await info()
    if (vistos.has(i.nome)) break
    ultimo = i
  }
  if (ultimo.barras !== vistos.size) problemas.push(`barras: ${ultimo.barras} barrinhas para ${vistos.size} produtos`)
  // volta ao último passo e espera ele andar sozinho
  await p.touchscreen.tap(quadro.x + quadro.width * 0.08, quadro.y + quadro.height * 0.3)
  await p.waitForTimeout(500)
  const noUltimo = await info()
  await p.waitForTimeout(7000)
  if ((await info()).nome === noUltimo.nome) problemas.push(`barras: o último produto (${noUltimo.nome}) travou`)
  await ctx.close()
  console.log('✓ barras do story', `(${vistos.size} produtos)`)
}

// ---------- celular deitado: o story do hero inteiro acima da barra de abas ----------
const deitados = [
  ['se-deitado-568x320', 568, 320],
  ['android-deitado-640x360', 640, 360],
  ['iphone8-deitado-667x375', 667, 375],
  ['android-deitado-740x360', 740, 360],
  ['iphone13-deitado-844x390', 844, 390],
]
const cruza = (a, b) => a && b && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1
for (const [nome, w, h] of deitados) {
  const ctx = await contexto(w, h, { semDica: true })
  const p = await ctx.newPage()
  await abrirLembrado(ctx, p, nome, `${base}?uf=mg`)
  const medir = () =>
    p.evaluate(() => {
      const r = (s) => {
        const e = document.querySelector(s)
        const b = e?.getBoundingClientRect()
        return b && b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null
      }
      return {
        story: r('.hero-story'),
        barra: r('.barra-abas'),
        resposta: r('.hero-resposta .barra-pilula'),
        ver: r('.hero-ver'),
        disp: r('.hero-palco .sq-disp'),
        preco: r('.hero-palco .sq-preco'),
      }
    })
  const m = await medir()
  if (m.story && m.barra && m.story.b > m.barra.t + 1) problemas.push(`${nome}: story passa da barra de abas (${Math.round(m.story.b)} > ${Math.round(m.barra.t)})`)
  if (m.resposta && m.barra && m.resposta.b > m.barra.t + 1) problemas.push(`${nome}: "Enviar mensagem…" atrás da barra de abas`)
  if (cruza(m.disp, m.ver) || cruza(m.preco, m.ver)) problemas.push(`${nome}: VER PRODUTO por cima do preço/DISPONÍVEL`)
  if (m.disp && m.story && m.disp.b > m.story.b) problemas.push(`${nome}: DISPONÍVEL fora do story`)
  await p.screenshot({ path: `${out}${nome}-1-hero.png` })
  await ctx.close()
  console.log('✓', nome)
}

// ---------- celular grande deitado (>= 900 px: layout de computador): a lateral rola e Por estado abre ----------
for (const [nome, w, h] of [['promax-deitado-932x430', 932, 430], ['pixel-deitado-915x412', 915, 412]]) {
  const ctx = await contexto(w, h, { semDica: true })
  const p = await ctx.newPage()
  await abrirLembrado(ctx, p, nome, `${base}?uf=mg`)
  const lat = await p.evaluate(() => {
    const l = document.querySelector('.lateral')
    return { rola: l.scrollHeight > l.clientHeight, overflow: getComputedStyle(l).overflowY }
  })
  if (lat.rola && lat.overflow !== 'auto') problemas.push(`${nome}: lateral passa da tela e não rola`)
  // arrasto de dedo em cima da lateral rola ela (não a página)
  const cdp = await ctx.newCDPSession(p)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: h - 40 }] })
  for (let k = 1; k <= 10; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: h - 40 - k * 25 }] })
    await p.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await p.waitForTimeout(700)
  const est = await p.evaluate(() => {
    const b = document.querySelector('.lateral [data-aba="estados"]').getBoundingClientRect()
    return { t: b.top, b: b.bottom, h: innerHeight, st: document.querySelector('.lateral').scrollTop }
  })
  if (lat.rola && est.st <= 0) problemas.push(`${nome}: arrastar a lateral não rolou`)
  if (est.b > est.h + 1) problemas.push(`${nome}: Por estado fora da tela mesmo depois de rolar a lateral`)
  await p.screenshot({ path: `${out}${nome}-lateral.png` })
  await p.locator('.lateral [data-aba="estados"]').tap()
  await p.waitForTimeout(900)
  if ((await abaAberta(p)) !== 'estados') problemas.push(`${nome}: Por estado não abriu pela lateral`)
  await ctx.close()
  console.log('✓', nome)
}

// ---------- teclado do Android (resizes-content): a janela encolhe e a barra de abas sai ----------
{
  const ctx = await contexto(360, 640, { semDica: true })
  const p = await ctx.newPage()
  await abrir(p, 'teclado', `${base}?uf=mg`)
  await irAba(p, 'catalogo')
  // a lupa de novo vai até a busca e foca
  await p.locator('.barra-abas [data-aba="catalogo"]').click()
  await p.waitForTimeout(900)
  await p.setViewportSize({ width: 360, height: 330 })
  await p.waitForTimeout(500)
  const r = await p.evaluate(() => ({
    foco: document.activeElement?.matches('.busca input'),
    teclado: document.documentElement.classList.contains('com-teclado'),
    barra: getComputedStyle(document.querySelector('.barra-abas')).visibility,
  }))
  if (!r.foco) problemas.push('teclado: a lupa tocada de novo não focou a busca')
  if (!r.teclado || r.barra !== 'hidden') problemas.push('teclado: com a janela encolhida pelo teclado, a barra de abas continua na tela')
  await p.screenshot({ path: `${out}teclado-busca.png` })
  await p.setViewportSize({ width: 360, height: 640 })
  await p.waitForTimeout(500)
  if (await p.evaluate(() => document.documentElement.classList.contains('com-teclado'))) problemas.push('teclado: fechou o teclado e a barra não voltou')
  await ctx.close()
  console.log('✓ teclado')
}

// ---------- palpite de IP pendente (a pessoa pulou a pergunta da abertura) ----------
// No Início o aviso fica no pé do story, no lugar da linha "Enviar mensagem…" (nada por cima do produto, do VER
// PRODUTO nem da linha de resposta); nas outras abas, fixo acima da barra. Estado sem entrega (BA): opções embaixo.
{
  const BA = { region: 'Bahia', region_code: 'BA' }
  const casos = [
    ['safari-390x664', 390, 664, null],
    ['se-320x568', 320, 568, null],
    ['iphone8-375x667', 375, 667, BA],
    ['iphone13-390x844', 390, 844, BA],
    ['deitado-844x390', 844, 390, null],
  ]
  for (const [nome, w, h, ip] of casos) {
    const tag = `${nome}-${ip ? 'BA' : 'MG'} palpite`
    const ctx = await contexto(w, h, { semDica: true, ip: ip ?? undefined })
    // +18 já lembrado (deitado o "Tenho" pode ficar abaixo da dobra; não é o que esta rodada confere)
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
      } catch {
        /* ignora */
      }
    })
    const p = await ctx.newPage()
    p.on('pageerror', (e) => problemas.push(`${tag}: pageerror ${e.message}`))
    await p.goto(base)
    if (!ip) {
      // a pergunta aparece na abertura; tocar fora dela segue sem responder
      await p.locator('.abertura .enquete-confirmar').waitFor({ timeout: 9000 }).catch(() => problemas.push(`${tag}: a abertura não perguntou`))
      await p.touchscreen.tap(w - 30, h - 30)
    }
    await p.locator('.abertura').waitFor({ state: 'detached', timeout: 9000 })
    await p.waitForTimeout(900)
    const medir = () =>
      p.evaluate(() => {
        const r = (s) => {
          const e = document.querySelector(s)
          if (!e) return null
          const b = e.getBoundingClientRect()
          const st = getComputedStyle(e)
          return b.width && st.display !== 'none' && st.visibility !== 'hidden' ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null
        }
        const livre = (e) => {
          const b = e.getBoundingClientRect()
          const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
          return !!t && (t === e || e.contains(t))
        }
        const ver = document.querySelector('.vista-inicio .hero-ver')
        const pilula = document.querySelector('.vista-inicio .hero-resposta .barra-pilula')
        return {
          noStory: r('.vista-inicio .hero .aviso-local-story'),
          fixo: r('.aviso-local-fixo'),
          pilula: r('.vista-inicio .hero-resposta .barra-pilula'),
          pilulaLivre: pilula ? livre(pilula) : null,
          ver: r('.vista-inicio .hero-ver'),
          verLivre: ver ? livre(ver) : null,
          disp: r('.vista-inicio .hero-palco .sq-disp'),
          barra: r('.barra-abas'),
          opcoes: [...document.querySelectorAll('.vista-inicio .aviso-local-story .aviso-local-op')].map(livre),
        }
      })
    const m = await medir()
    await p.screenshot({ path: `${out}${tag.replace(' ', '-')}-1.png` })
    if (!m.noStory) problemas.push(`${tag}: o aviso não ficou no pé do story`)
    else {
      if (m.fixo) problemas.push(`${tag}: aviso duplicado (o fixo também na tela)`)
      if (m.pilula) problemas.push(`${tag}: a linha de resposta continua junto com o aviso`)
      if (cruza(m.noStory, m.ver) || cruza(m.noStory, m.disp)) problemas.push(`${tag}: aviso por cima do VER PRODUTO/DISPONÍVEL`)
      if (m.barra && m.noStory.b > m.barra.t + 1) problemas.push(`${tag}: aviso atrás da barra de abas`)
      if (m.opcoes.length !== 2 || m.opcoes.includes(false)) problemas.push(`${tag}: opção do aviso coberta (${JSON.stringify(m.opcoes)})`)
      if (m.verLivre === false) problemas.push(`${tag}: VER PRODUTO coberto`)
    }
    if (ip) {
      // estado sem entrega: "Estados" abre o seletor
      await p.locator('.aviso-local-story').getByRole('button', { name: 'Estados', exact: true }).tap()
      await p.waitForTimeout(800)
      if (!(await p.locator('[role="dialog"]').count())) problemas.push(`${tag}: "Estados" não abriu o seletor`)
    } else {
      // outra aba: o aviso vai para cima da barra; volta para o story no Início
      await irAba(p, 'catalogo')
      const c = await medir()
      if (!c.fixo) problemas.push(`${tag}: no Catálogo, o aviso fixo não apareceu`)
      else if (c.barra && c.fixo.b > c.barra.t + 1) problemas.push(`${tag}: no Catálogo, o aviso fica atrás da barra`)
      await p.screenshot({ path: `${out}${tag.replace(' ', '-')}-2-catalogo.png` })
      await irAba(p, 'inicio')
      await p.evaluate(() => window.scrollTo(0, 0))
      await p.waitForTimeout(500)
      const v = await medir()
      if (!v.noStory || v.fixo) problemas.push(`${tag}: de volta ao Início, o aviso não voltou para o story`)
      // "Sim": o aviso sai e a linha de resposta volta, livre
      await p.locator('.aviso-local-story').getByRole('button', { name: 'Sim', exact: true }).tap()
      await p.waitForTimeout(600)
      const d = await medir()
      if (d.noStory || d.fixo) problemas.push(`${tag}: depois do Sim, o aviso continua`)
      if (!d.pilula || d.pilulaLivre === false) problemas.push(`${tag}: depois do Sim, a linha de resposta não voltou livre`)
      await p.screenshot({ path: `${out}${tag.replace(' ', '-')}-3-sim.png` })
    }
    await ctx.close()
    console.log('✓', tag)
  }
}

await b.close()
console.log(problemas.length ? problemas.join('\n') : 'sem problemas')
