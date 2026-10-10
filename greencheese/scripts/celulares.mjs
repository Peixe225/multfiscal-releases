// Matriz de celulares: rolagem lateral e alvos de toque em cada aba, barra de abas, voltar entre abas, story cabendo
// na tela com gestos de toque reais, chat pela linha de resposta do story e o Início (story, com a rua viva como o
// primeiro story → faixa → perfil → destaques com as abas primeiro, o fio e os filtros → grade → rodapé; a faixa da rua
// entre a faixa dos @ e o perfil não existe mais no celular; o mercador só na rua, sem Teste minha sorte e sem repost
// no fim; as abas primeiro, inteiras (as 5, com o Rateio, de 360 px em diante), e o primeiro destaque que não cabe
// espiando na borda da primeira tela, o sinal de que a linha continua (o "Tudo" não precisa caber inteiro); o filtro
// filtra a grade do próprio Início; a faixa só com os perfis confirmados). O story da rua: na primeira tela, a cena
// inteira no quadro (pés acima dos adesivos, balões longe do cabeçalho), ~12 s antes de passar sozinho, uma barrinha a
// mais que os produtos, a volta para ela no fim e o link ?p= começando no produto. Também: celular deitado (story do
// hero inteiro acima da barra, nada encavalado; a rua na faixa larga, entre o cabeçalho e a linha de baixo; o produto
// depois dela), o aviso do palpite de IP na rua e no produto, celular grande deitado com o layout de computador
// (lateral rola, Por estado alcançável) e o teclado do Android (interactive-widget=resizes-content: a janela encolhe e
// a barra de abas sai). A API do rateio responde como "sem servidor" (o zip, o preview sem PHP): os rateios de
// exemplo, sem erro no console.
// A Home 2 (oprojeto.online/greencheese/home2/ → ?home=2, pedido do Ian em 10/10) em cada celular, aberta pelo endereço
// de verdade: o topo de 08/10 (o 1º story é de produto, uma barrinha por produto, o último volta pro primeiro em 5 s,
// o ?p= abre o produto por cima) e a rua do mercador só no fim do Início, depois da grade e antes do rodapé, com a
// altura guardada desde o começo; o pedaço dela não baixa na primeira tela (só quando a vaga chega perto), anda à vista
// e para fora da tela; deitado e com o palpite de IP no pé do story, também. Trocar de aba mantém a Home 2.
// Uso: com "npm run dev" rodando → node scripts/celulares.mjs [pasta-saida] [url-base]
// GC_LOJA_REAL=1: o GET loja vai pro servidor de verdade (o resto da API continua como "sem servidor").
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
  // GC_LOJA_REAL=1: a loja vem do servidor de verdade (PHP ligado e painel instalado; sem mexer, é a mesma da semente)
  if (process.env.GC_LOJA_REAL) await ctx.route(/\/api\/index\.php\?r=loja(&|$)/, (r) => r.continue())
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
 * O Início, de cima a baixo: story (a rua viva é o primeiro story; o mercador mora nela), faixa, perfil (com "Ver
 * loja", logo depois da faixa: a faixa da rua saiu do celular), destaques, grade (a caixa de encomenda por último) e o
 * rodapé. Na Home 2 (h2): story só de produtos, faixa, perfil, destaques, grade, a rua viva (uma vaga só, com a altura
 * da faixa guardada) e o rodapé. Destaques: o grupo das abas (estado, Buscar, Rateio, interativos, Por estado), o fio
 * e o grupo dos filtros. Nada do fim da aba Mercado (Teste minha sorte) e nenhum mercador de repost (o do topo do
 * Mercado). Ids próprios (o #catalogo é da aba Mercado, que o chat e a rolagem usam).
 */
async function conferirInicio(p, nome, h2 = false) {
  const r = await p.evaluate((h2) => {
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
    // a linha na primeira tela (sem arrastar): quanto aparece de cada destaque, na ordem (abas, depois filtros), dentro
    // da caixa da própria linha
    const linhaEl = v?.querySelector('.destaques-inicio')
    const lb = linhaEl?.getBoundingClientRect()
    const visivel = (e) => {
      const b = e.getBoundingClientRect()
      return { nome: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 16), px: Math.max(0, Math.min(b.right, lb.right) - Math.max(b.left, lb.left)), w: b.width }
    }
    const caminhosEl = nav ? [...nav.children].filter((e) => e.getClientRects().length > 0) : []
    const filtrosEl = filtros ? [...filtros.querySelectorAll('[aria-pressed]')] : []
    return {
      linha: lb ? { itens: [...caminhosEl, ...filtrosEl].map(visivel), larg: innerWidth, rola: linhaEl.scrollWidth > linhaEl.clientWidth + 1, sl: linhaEl.scrollLeft } : null,
      faixaAConfirmar: /confirmar|importsvv/i.test(v?.querySelector('.faixa')?.textContent ?? ''),
      setas: v?.querySelectorAll('.destaques-seta').length ?? 0,
      ordem: ['.hero', '.faixa', '.so-celular .perfil', '.destaques-inicio', '.catalogo-inicio .grade', ...(h2 ? ['.rua-fim .rua-vaga'] : [])].map(topo),
      gradeFim: grade ? grade.getBoundingClientRect().bottom + scrollY : null,
      rodape: rodape ? rodape.getBoundingClientRect().top + scrollY : null,
      // Home 2: a rua no fim, uma vaga só no Início (nada da rua no story), com a altura da faixa guardada desde o começo
      rua: (() => {
        const e = v?.querySelector('.rua-fim .rua-vaga')
        const b = e?.getBoundingClientRect()
        return b ? { t: b.top + scrollY, b: b.bottom + scrollY, h: b.height } : null
      })(),
      ruaNoHero: v?.querySelectorAll('.hero .rua:not(.rua-em-story), .hero .rua-vaga').length ?? 0,
      ultimoCaixa: !!ultimo?.classList.contains('card-caixa'),
      ordemDestaques,
      // só os caminhos à vista
      abas: nav ? [...nav.children].filter((e) => e.getClientRects().length > 0).map((e) => e.getAttribute('data-destaque') ?? (e.classList.contains('destaque-interativo') ? 'interativo' : 'estado')) : [],
      filtros: filtros ? filtros.querySelectorAll('[aria-pressed]').length : 0,
      fio: fioB ? { w: fioB.width, h: fioB.height } : null,
      fimCatalogo: !!v?.querySelector('.aba-fim, .reposts, .adesivos-interativos, #secao-interativo, #secao-marcados'),
      mercador: !!v?.querySelector('.repost-figura'),
      // a rua mora no primeiro story; a faixa dela entre a faixa dos @ e o perfil saiu do celular (o perfil vem colado)
      ruaNoStory: !!v?.querySelector('.hero .rua-story'),
      faixaDaRua: v?.querySelectorAll('.rua-vaga').length ?? 0,
      perfilColado: (() => {
        const faixa = v?.querySelector('.faixa')
        const perfil = v?.querySelector('.so-celular .perfil')
        if (!faixa || !perfil) return null
        return Math.round(perfil.getBoundingClientRect().top - faixa.getBoundingClientRect().bottom)
      })(),
      idsRepetidos: !!v?.querySelector('#catalogo, #catalogo-titulo'),
      busca: !!v?.querySelector('.busca, .chip-disp'),
    }
  }, h2)
  const o = r.ordem
  if (o.some((y) => y == null)) problemas.push(`${nome}: falta peça no Início (${JSON.stringify(o)})`)
  else if (o.some((y, i) => i && y < o[i - 1])) problemas.push(`${nome}: ordem do Início errada (${o.map(Math.round).join(' < ')})`)
  if (!h2) {
    if (r.gradeFim != null && r.rodape != null && (r.rodape < r.gradeFim - 1 || r.rodape - r.gradeFim > 120)) problemas.push(`${nome}: o rodapé não vem logo depois da grade (${Math.round(r.gradeFim)} → ${Math.round(r.rodape)})`)
  } else {
    // Home 2: a rua fecha o Início, logo depois da grade (o título pequeno no meio) e logo antes do rodapé
    if (!r.rua) problemas.push(`${nome}: a rua não está no fim do Início`)
    else {
      if (r.gradeFim == null || r.rua.t < r.gradeFim - 1 || r.rua.t - r.gradeFim > 100) problemas.push(`${nome}: a rua não vem logo depois da grade (${Math.round(r.gradeFim ?? -1)} → ${Math.round(r.rua.t)})`)
      if (r.rodape == null || r.rodape < r.rua.b - 1 || r.rodape - r.rua.b > 40) problemas.push(`${nome}: o rodapé não vem logo depois da rua (${Math.round(r.rua.b)} → ${Math.round(r.rodape ?? -1)})`)
      if (r.rua.h < 150 || r.rua.h > 190) problemas.push(`${nome}: a vaga da rua com ${Math.round(r.rua.h)} px (150–190)`)
    }
    if (r.faixaDaRua !== 1 || r.ruaNoHero || r.ruaNoStory) problemas.push(`${nome}: a rua fora do fim do Início (${r.faixaDaRua} vagas, ${r.ruaNoHero + (r.ruaNoStory ? 1 : 0)} no story)`)
  }
  if (!r.ultimoCaixa) problemas.push(`${nome}: a caixa de encomenda não é a última célula da grade do Início`)
  if (!r.ordemDestaques) problemas.push(`${nome}: destaques do Início fora da ordem abas → fio → filtros`)
  // o Rateio logo depois de Buscar, também no celular (pedido do Rateio: "ajuste os tamanhos")
  if (JSON.stringify(r.abas) !== JSON.stringify(['estado', 'catalogo', 'rateio', 'interativo', 'estados'])) problemas.push(`${nome}: abas dos destaques ${JSON.stringify(r.abas)}`)
  if (r.filtros < 6) problemas.push(`${nome}: só ${r.filtros} filtros nos destaques do Início`)
  if (!r.fio || r.fio.w > 1.5 || r.fio.h < 20) problemas.push(`${nome}: fio entre abas e filtros ${JSON.stringify(r.fio)}`)
  if (r.fimCatalogo) problemas.push(`${nome}: o Início ainda tem o fim da aba Catálogo (Teste minha sorte/repost)`)
  if (r.mercador) problemas.push(`${nome}: mercador de repost no Início do celular (ele mora na rua)`)
  if (!h2 && !r.ruaNoStory) problemas.push(`${nome}: a rua não está no story do Início`)
  if (!h2 && r.faixaDaRua) problemas.push(`${nome}: a faixa da rua continua no Início do celular`)
  if (r.perfilColado == null || r.perfilColado > 40) problemas.push(`${nome}: o perfil não vem logo depois da faixa dos @ (${r.perfilColado})`)
  if (r.idsRepetidos) problemas.push(`${nome}: #catalogo/#catalogo-titulo repetidos no Início`)
  if (r.busca) problemas.push(`${nome}: busca ou "Só DISPONÍVEL" no Início`)
  // a linha de destaques na primeira tela (pedido do Ian: as abas primeiro, os filtros à direita): as abas inteiras (as 5
  // de 360 px em diante; em 320, as 4 primeiras) e o primeiro destaque que não cabe espiando na borda, de 8 px até quase
  // inteiro, o sinal de que a linha continua. O "Tudo" não precisa caber inteiro
  if (!r.linha) problemas.push(`${nome}: linha de destaques sem medida`)
  else {
    const { itens, larg, rola, sl } = r.linha
    const inteiro = (c) => c.px >= c.w - 0.5
    const abasInteiras = larg >= 360 ? 5 : 4
    if (sl > 0) problemas.push(`${nome}: a linha de destaques não começa do início (${sl} px)`)
    if (itens.length < abasInteiras || itens.slice(0, abasInteiras).some((c) => !inteiro(c))) problemas.push(`${nome}: aba dos destaques cortada na primeira tela (${itens.slice(0, 5).map((c) => Math.round(c.px)).join('/')})`)
    const corte = itens.find((c) => !inteiro(c))
    if (!corte) {
      if (rola) problemas.push(`${nome}: a linha de destaques rola, mas nada fica cortado na borda`)
    } else if (corte.px < 8 || corte.px > corte.w - 4) problemas.push(`${nome}: nada espia na borda da linha de destaques (o "${corte.nome}" mostra ${Math.round(corte.px)} de ${Math.round(corte.w)} px)`)
  }
  if (r.faixaAConfirmar) problemas.push(`${nome}: perfil a confirmar na faixa dos @`)
  // as setas da linha são do computador com mouse; no celular a linha anda com o dedo
  if (r.setas) problemas.push(`${nome}: setas da linha de destaques no celular`)
}

/**
 * O story da rua na primeira tela: é o primeiro segmento, a rua anda, o mercador inteiro entre o cabeçalho e o pé do
 * story (os pés acima dos adesivos e da linha "Enviar mensagem…"), balão nenhum por cima do cabeçalho nem dos adesivos,
 * e o story acima da barra de abas.
 */
async function conferirRuaNoStory(p, nome) {
  await p.locator('.vista-inicio .rua-story[data-rua="rodando"]').waitFor({ timeout: 10000 }).catch(() => {})
  const r = await p.evaluate(() => {
    const caixa = (e) => {
      const b = e?.getBoundingClientRect()
      return b && b.width ? { t: b.top, b: b.bottom, l: b.left, r: b.right } : null
    }
    const v = document.querySelector('.vista-inicio')
    const cena = v?.querySelector('.rua-story')
    return {
      estado: cena?.getAttribute('data-rua'),
      aqui: !!cena && !cena.hidden,
      cab: caixa(v?.querySelector('.hero-cab')),
      pe: caixa(v?.querySelector('.rua-adesivos')),
      merc: caixa(v?.querySelector('.rua-em-story .rua-mercador')),
      baloes: [...(v?.querySelectorAll('.rua-em-story .rua-balao') ?? [])].map(caixa),
      quadro: caixa(v?.querySelector('.hero-quadro')),
      barra: caixa(document.querySelector('.barra-abas')),
    }
  })
  if (!r.aqui) problemas.push(`${nome}: o story não abre na rua`)
  if (r.estado !== 'rodando') problemas.push(`${nome}: a rua do story não andou (${r.estado})`)
  if (!r.merc || !r.cab || !r.pe) problemas.push(`${nome}: rua sem mercador, cabeçalho ou pé medidos`)
  else {
    if (r.merc.t < r.cab.b) problemas.push(`${nome}: o mercador encosta no cabeçalho (${Math.round(r.merc.t)} < ${Math.round(r.cab.b)})`)
    if (r.merc.b > r.pe.t + 1) problemas.push(`${nome}: os pés do mercador passam do pé do story (${Math.round(r.merc.b)} > ${Math.round(r.pe.t)})`)
  }
  for (const b of r.baloes) if (b && r.cab && r.pe && (b.t < r.cab.b - 1 || b.b > r.pe.t + 1)) problemas.push(`${nome}: balão por cima do cabeçalho ou dos adesivos (${Math.round(b.t)}..${Math.round(b.b)})`)
  if (r.quadro && r.barra && r.quadro.b > r.barra.t + 1) problemas.push(`${nome}: o story passa da barra de abas`)
}

/** O pedaço da rua (Rua-*.js) ou o worker do elenco já pedidos pela página? */
const ruaBaixada = (p) => p.evaluate(() => performance.getEntriesByType('resource').some((e) => /\/Rua-[^/]*\.js|elenco\.worker/.test(e.name)))

/**
 * Home 2, a primeira tela: o 1º story é de produto (nada da rua no story), o story acima da barra de abas e a rua do fim
 * nem montada nem baixada (a primeira tela não paga nada por ela).
 */
async function conferirTopoHome2(p, nome) {
  const r = await p.evaluate(() => {
    const caixa = (e) => {
      const b = e?.getBoundingClientRect()
      return b && b.width ? { t: b.top, b: b.bottom } : null
    }
    const v = document.querySelector('.vista-inicio')
    return {
      produto: v?.querySelector('.hero-palco .sq-nome')?.textContent ?? null,
      ruaNoStory: v?.querySelectorAll('.hero .rua, .hero .rua-vaga, .rua-story').length ?? 0,
      ruaMontada: v?.querySelectorAll('.rua').length ?? 0,
      quadro: caixa(v?.querySelector('.hero-quadro')),
      barra: caixa(document.querySelector('.barra-abas')),
    }
  })
  if (!r.produto) problemas.push(`${nome}: o 1º story do Início não é de produto`)
  if (r.ruaNoStory) problemas.push(`${nome}: a rua continua no story do Início`)
  if (r.ruaMontada || (await ruaBaixada(p))) problemas.push(`${nome}: a rua do fim montou ou baixou na primeira tela`)
  if (r.quadro && r.barra && r.quadro.b > r.barra.t + 1) problemas.push(`${nome}: o story passa da barra de abas`)
}

/**
 * Home 2, a rua no fim do Início: rolando até ela, o pedaço baixa e ela anda (o canvas desenhado), sem rolagem lateral ali e o
 * canvas dentro da tela; de volta ao topo, ela para (fora da tela). Foto com ela à vista.
 */
async function conferirRuaNoFim(p, nome, foto) {
  await p.evaluate(() => {
    const v = document.querySelector('.vista-inicio .rua-fim')
    if (v) scrollTo(0, v.getBoundingClientRect().top + scrollY - Math.max(0, innerHeight - 64 - v.offsetHeight) / 2)
  })
  const estado = () => p.evaluate(() => document.querySelector('.vista-inicio .rua-fim .rua')?.getAttribute('data-rua') ?? null)
  for (let k = 0; k < 80 && (await estado()) !== 'rodando'; k++) await p.waitForTimeout(100)
  const r = await p.evaluate(() => {
    const c = document.querySelector('.vista-inicio .rua-fim .rua-tela')
    let cores = 0
    if (c && c.width) {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      const s = new Set()
      for (let i = 0; i < d.length; i += 4 * 7) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
      cores = s.size
    }
    const t = c?.getBoundingClientRect()
    return { cores, larg: document.documentElement.scrollWidth > innerWidth, dentro: !!t && t.left >= -1 && t.right <= innerWidth + 1 }
  })
  const andou = await estado()
  if (andou !== 'rodando') problemas.push(`${nome}: a rua do fim não andou à vista (${andou})`)
  if (r.cores <= 6) problemas.push(`${nome}: a rua do fim sem desenho no canvas (${r.cores} cores)`)
  if (r.larg) problemas.push(`${nome}: rolagem lateral na rua do fim`)
  if (!r.dentro) problemas.push(`${nome}: o canvas da rua passa da tela`)
  if (foto) await p.screenshot({ path: foto })
  await p.evaluate(() => scrollTo(0, 0))
  let parou = null
  for (let k = 0; k < 20 && (parou = await estado()) !== 'parada'; k++) await p.waitForTimeout(100)
  if (parou !== 'parada') problemas.push(`${nome}: fora da tela, a rua do fim não parou (${parou})`)
}

/** A Home 2 de verdade: ?home=2 na URL (na pasta da loja, não na home2/) e o data-home do app. */
async function conferirHome2(p, nome) {
  const r = await p.evaluate(() => ({ pasta: location.pathname, q: location.search, home: document.querySelector('.app')?.getAttribute('data-home') ?? null }))
  if (new URLSearchParams(r.q).get('home') !== '2' || r.home !== '2' || /home2/i.test(r.pasta)) problemas.push(`${nome}: não está na Home 2 (${JSON.stringify(r)})`)
}

/** A home de sempre: sem chave home* na URL e sem o data-home. */
async function conferirHomeDeSempre(p, nome) {
  const r = await p.evaluate(() => ({ q: location.search, home: document.querySelector('.app')?.getAttribute('data-home') ?? null }))
  if ([...new URLSearchParams(r.q).keys()].some((k) => /^home/i.test(k)) || r.home != null) problemas.push(`${nome}: não está na home de sempre (${JSON.stringify(r)})`)
}

for (const [nome, w, h] of aparelhos) {
  const ctx = await contexto(w, h)
  const p = await ctx.newPage()
  await abrir(p, nome, `${base}?uf=mg`)
  await conferirHomeDeSempre(p, nome)
  await conferirRuaNoStory(p, nome)
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
  // a aba Mercado: o mercador no topo (uma vez só: sem o repost do fim), a busca e o Teste minha sorte no fim
  const fim = await p.evaluate(() => {
    const v = document.querySelector('.vista[data-vista="catalogo"]')
    const topo = v?.querySelector('.mercado-topo .repost-figura')
    const busca = v?.querySelector('.busca input')
    return {
      topo: !!topo && !!busca && topo.getBoundingClientRect().top < busca.getBoundingClientRect().top,
      mercadores: v?.querySelectorAll('.repost-figura').length ?? 0,
      interativo: !!v?.querySelector('#secao-interativo'),
      busca: !!busca,
      titulo: v?.querySelector('h1')?.textContent?.trim(),
    }
  })
  if (!fim.topo || fim.mercadores !== 1 || !fim.interativo || !fim.busca || fim.titulo !== 'Mercado') problemas.push(`${nome}: a aba Mercado sem o mercador no topo (uma vez), a busca ou o Teste minha sorte (${JSON.stringify(fim)})`)
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

// ---------- Home 2 em cada celular (pelo endereço home2/, que leva pra ../?home=2 com o resto do link): o topo de 08/10
// e a rua no fim do Início; a Mercado e o Início de novo mantêm a Home 2 ----------
for (const [aparelho, w, h] of aparelhos) {
  const nome = `h2-${aparelho}`
  const ctx = await contexto(w, h)
  const p = await ctx.newPage()
  await abrir(p, nome, `${base}home2/?uf=mg`)
  await conferirHome2(p, nome)
  await conferirTopoHome2(p, nome)
  await p.screenshot({ path: `${out}${nome}-1-home.png` })
  await fotoInteira(p, `${out}${nome}-1b-home-inteira.png`)
  await conferirBarra(p, nome)
  await p.locator('.vista-inicio .catalogo-inicio .grade').waitFor({ state: 'attached', timeout: 6000 }).catch(() => {})
  await conferirInicio(p, nome, true)
  await conferirRuaNoFim(p, nome, `${out}${nome}-1e-rua-fim.png`)
  await varrer(p, nome, 'inicio')
  await irAba(p, 'catalogo')
  await conferirHome2(p, `${nome} (Mercado)`)
  await irAba(p, 'inicio')
  await conferirHome2(p, `${nome} (de volta ao Início)`)
  if (await p.locator('.vista-inicio .rua-story').count()) problemas.push(`${nome}: de volta ao Início, a rua apareceu no story`)
  await ctx.close()
  console.log('✓', nome)
}

// ---------- story do Início: a rua primeiro, uma barrinha por story (a rua e cada produto); o último volta para a rua;
// a rua dura ~12 s (o bastante para um atendimento inteiro) e os produtos 5 s ----------
{
  const ctx = await contexto(390, 844, { semDica: true })
  const p = await ctx.newPage()
  await abrir(p, 'barras', `${base}?uf=mg`)
  await p.locator('.vista-inicio .rua-story[data-rua="rodando"]').waitFor({ timeout: 10000 }).catch(() => {})
  const info = () =>
    p.evaluate(() => ({
      barras: document.querySelectorAll('.hero-barras .story-barra').length,
      nome: document.querySelector('.vista-inicio .rua-story:not([hidden])') ? 'rua' : (document.querySelector('.hero-palco .sq-nome')?.textContent ?? '?'),
    }))
  const quadro = await p.locator('.hero-quadro').boundingBox()
  const vistos = []
  let atual = await info()
  if (atual.nome !== 'rua') problemas.push(`barras: o story não começa na rua (${atual.nome})`)
  // passa até dar a volta (a rua de novo) e guarda quantos passos tem
  for (let k = 0; k < 14; k++) {
    vistos.push(atual.nome)
    await p.touchscreen.tap(quadro.x + quadro.width * 0.92, quadro.y + quadro.height * 0.3)
    await p.waitForTimeout(450)
    atual = await info()
    if (atual.nome === 'rua') break
  }
  if (atual.nome !== 'rua') problemas.push('barras: passar todos os produtos não voltou para a rua')
  if (atual.barras !== vistos.length || vistos.filter((n) => n === 'rua').length !== 1) problemas.push(`barras: ${atual.barras} barrinhas para ${vistos.length} stories (${vistos.join(', ')})`)
  // volta ao último produto e espera ele andar sozinho para a rua (5 s)
  await p.touchscreen.tap(quadro.x + quadro.width * 0.08, quadro.y + quadro.height * 0.3)
  await p.waitForTimeout(500)
  const noUltimo = await info()
  let t0 = 0
  for (let k = 0; k < 40 && !t0; k++) {
    await p.waitForTimeout(200)
    if ((await info()).nome === 'rua') t0 = Date.now()
  }
  if (noUltimo.nome === 'rua' || !t0) problemas.push(`barras: o último produto (${noUltimo.nome}) não andou sozinho para a rua`)
  // na rua, ~12 s antes de passar sozinha (com 6 s, ainda nela)
  await p.waitForTimeout(6000)
  if ((await info()).nome !== 'rua') problemas.push('barras: a rua passou antes de ~12 s')
  let passou = 0
  for (let k = 0; k < 40 && !passou; k++) {
    await p.waitForTimeout(250)
    if ((await info()).nome !== 'rua') passou = Date.now() - t0
  }
  if (!passou || passou < 11000 || passou > 13500) problemas.push(`barras: a rua durou ${passou} ms (esperado ~12 s)`)
  await ctx.close()
  console.log('✓ barras do story', `(${vistos.length} stories: a rua e ${vistos.length - 1} produtos; a rua em ${passou} ms)`)
}

// ---------- link direto de um produto (?p=): o story do produto abre por cima e o do Início começa nele, não na rua ----
{
  const ctx = await contexto(390, 844, { semDica: true })
  const p = await ctx.newPage()
  await abrirLembrado(ctx, p, 'link-p', `${base}?uf=mg`)
  const quadro = await p.locator('.hero-quadro').boundingBox()
  // o terceiro story (o segundo produto): um que não é o primeiro de nenhuma conta
  for (let k = 0; k < 2; k++) {
    await p.touchscreen.tap(quadro.x + quadro.width * 0.92, quadro.y + quadro.height * 0.3)
    await p.waitForTimeout(450)
  }
  const alvo = await p.evaluate(() => ({ nome: document.querySelector('.hero-palco .sq-nome')?.textContent, href: document.querySelector('.hero-produto')?.getAttribute('href') }))
  const id = new URLSearchParams(alvo.href ?? '').get('produto')
  await ctx.close()
  const ctx2 = await contexto(390, 844, { semDica: true })
  const p2 = await ctx2.newPage()
  await abrirLembrado(ctx2, p2, 'link-p', `${base}?uf=mg&p=${encodeURIComponent(id ?? '')}`)
  const r = await p2.evaluate(() => ({
    camada: !!document.querySelector('.story'),
    rua: !!document.querySelector('.vista-inicio .rua-story:not([hidden])'),
    nome: document.querySelector('.hero-palco .sq-nome')?.textContent,
  }))
  if (!id || !r.camada || r.rua || r.nome !== alvo.nome) problemas.push(`link-p: ?p= não começou no produto (${JSON.stringify({ id, alvo: alvo.nome, ...r })})`)
  await ctx2.close()
  console.log('✓ link direto ?p=', `(${alvo.nome})`)
}

// ---------- Home 2, story do Início: só produtos (o 1º é de produto), uma barrinha por produto; o último volta pro
// primeiro sozinho em 5 s ----------
{
  const ctx = await contexto(390, 844, { semDica: true })
  const p = await ctx.newPage()
  await abrir(p, 'h2-barras', `${base}?home=2&uf=mg`)
  const info = () =>
    p.evaluate(() => ({
      barras: document.querySelectorAll('.hero-barras .story-barra').length,
      nome: document.querySelector('.hero-palco .sq-nome')?.textContent ?? '?',
      rua: document.querySelectorAll('.hero .rua, .hero .rua-vaga, .rua-story').length,
    }))
  const quadro = await p.locator('.hero-quadro').boundingBox()
  const vistos = []
  let atual = await info()
  const primeiro = atual.nome
  if (primeiro === '?' || atual.rua) problemas.push(`h2-barras: o 1º story do celular não é de produto (${primeiro}, rua ${atual.rua})`)
  // passa até dar a volta (o primeiro de novo) e guarda quantos passos tem
  for (let k = 0; k < 14; k++) {
    vistos.push(atual.nome)
    await p.touchscreen.tap(quadro.x + quadro.width * 0.92, quadro.y + quadro.height * 0.3)
    await p.waitForTimeout(450)
    atual = await info()
    if (atual.nome === primeiro || atual.rua) break
  }
  if (atual.nome !== primeiro) problemas.push('h2-barras: passar todos os produtos não voltou para o primeiro')
  if (atual.rua) problemas.push('h2-barras: a rua apareceu no story')
  if (atual.barras !== vistos.length || new Set(vistos).size !== vistos.length) problemas.push(`h2-barras: ${atual.barras} barrinhas para ${vistos.length} stories (${vistos.join(', ')})`)
  // volta ao último produto e espera ele andar sozinho para o primeiro (5 s)
  await p.touchscreen.tap(quadro.x + quadro.width * 0.08, quadro.y + quadro.height * 0.3)
  const t0 = Date.now()
  await p.waitForTimeout(300)
  const noUltimo = await info()
  let passou = 0
  for (let k = 0; k < 40 && !passou; k++) {
    await p.waitForTimeout(200)
    if ((await info()).nome === primeiro) passou = Date.now() - t0
  }
  if (noUltimo.nome !== vistos.at(-1)) problemas.push(`h2-barras: voltar do primeiro não foi pro último (${noUltimo.nome})`)
  if (!passou || passou < 4300 || passou > 6500) problemas.push(`h2-barras: o último produto passou pro primeiro em ${passou} ms (esperado ~5 s)`)
  await ctx.close()
  console.log('✓ Home 2: barras do story', `(${vistos.length} produtos; o último volta pro primeiro em ${passou} ms)`)
}

// ---------- Home 2, link direto de um produto (?p=): o story do produto abre por cima (o do Início, atrás, só com
// produtos) ----------
{
  const ctx = await contexto(390, 844, { semDica: true })
  const p = await ctx.newPage()
  await abrirLembrado(ctx, p, 'h2-link-p', `${base}?home=2&uf=mg`)
  const quadro = await p.locator('.hero-quadro').boundingBox()
  // o terceiro story (o segundo produto): um que não é o primeiro de nenhuma conta
  for (let k = 0; k < 2; k++) {
    await p.touchscreen.tap(quadro.x + quadro.width * 0.92, quadro.y + quadro.height * 0.3)
    await p.waitForTimeout(450)
  }
  const alvo = await p.evaluate(() => ({ nome: document.querySelector('.hero-palco .sq-nome')?.textContent, href: document.querySelector('.hero-produto')?.getAttribute('href') }))
  const id = new URLSearchParams(alvo.href ?? '').get('produto')
  await ctx.close()
  const ctx2 = await contexto(390, 844, { semDica: true })
  const p2 = await ctx2.newPage()
  await abrirLembrado(ctx2, p2, 'h2-link-p', `${base}?home=2&uf=mg&p=${encodeURIComponent(id ?? '')}`)
  const r = await p2.evaluate(() => ({
    camada: !!document.querySelector('.story'),
    nome: document.querySelector('.story .story-produto .sq-nome')?.textContent,
    rua: document.querySelectorAll('.hero .rua, .hero .rua-vaga, .rua-story').length,
    hero: !!document.querySelector('.vista-inicio .hero-palco .sq-nome'),
  }))
  if (!id || !r.camada || r.rua || !r.hero || r.nome !== alvo.nome) problemas.push(`h2-link-p: ?p= não abriu o produto por cima (${JSON.stringify({ id, alvo: alvo.nome, ...r })})`)
  await ctx2.close()
  console.log('✓ Home 2: link direto ?p=', `(${alvo.nome})`)
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
        quadro: r('.hero-quadro'),
        barra: r('.barra-abas'),
        resposta: r('.hero-resposta .barra-pilula'),
        ver: r('.hero-ver'),
        disp: r('.hero-palco .sq-disp'),
        preco: r('.hero-palco .sq-preco'),
        // a rua (o primeiro story): a faixa larga entre o cabeçalho e a linha de baixo
        rua: r('.vista-inicio .rua-story:not([hidden])'),
        estado: document.querySelector('.vista-inicio .rua-story')?.getAttribute('data-rua'),
        cab: r('.hero-cab'),
        pe: r('.rua-adesivos'),
        merc: r('.rua-em-story .rua-mercador'),
        tela: r('.rua-em-story .rua-tela'),
        baloes: [...document.querySelectorAll('.rua-em-story .rua-balao')].map((e) => {
          const b = e.getBoundingClientRect()
          return { t: b.top, b: b.bottom }
        }),
      }
    })
  const conferirPe = (m, onde) => {
    if (m.story && m.barra && m.story.b > m.barra.t + 1) problemas.push(`${nome}: story passa da barra de abas ${onde} (${Math.round(m.story.b)} > ${Math.round(m.barra.t)})`)
    if (m.resposta && m.barra && m.resposta.b > m.barra.t + 1) problemas.push(`${nome}: "Enviar mensagem…" atrás da barra de abas ${onde}`)
  }
  await p.locator('.vista-inicio .rua-story[data-rua="rodando"]').waitFor({ timeout: 10000 }).catch(() => {})
  const a = await medir()
  if (!a.rua || a.estado !== 'rodando') problemas.push(`${nome}: o story deitado não abre na rua andando (${a.estado})`)
  else if (!a.merc || !a.cab || !a.pe) problemas.push(`${nome}: rua deitada sem mercador, cabeçalho ou pé medidos`)
  else {
    if (a.merc.t < a.cab.b) problemas.push(`${nome}: o mercador debaixo do cabeçalho (${Math.round(a.merc.t)} < ${Math.round(a.cab.b)})`)
    if (a.merc.b > a.pe.t + 1) problemas.push(`${nome}: os pés do mercador passam do pé do story (${Math.round(a.merc.b)} > ${Math.round(a.pe.t)})`)
    // a ponta do poste (a linha 1 da faixa de 92) abaixo do cabeçalho
    if (a.tela && a.tela.t + (a.tela.b - a.tela.t) / 92 < a.cab.b - 1) problemas.push(`${nome}: o poste da rua entra no cabeçalho (${Math.round(a.tela.t)} / ${Math.round(a.cab.b)})`)
    for (const b of a.baloes) if (b.t < a.cab.b - 1 || b.b > a.pe.t + 1) problemas.push(`${nome}: balão por cima do cabeçalho ou dos adesivos (${Math.round(b.t)}..${Math.round(b.b)})`)
  }
  conferirPe(a, 'na rua')
  await p.screenshot({ path: `${out}${nome}-1-hero.png` })
  // o primeiro produto: VER PRODUTO longe do preço e do DISPONÍVEL, tudo dentro do story
  if (a.quadro) {
    await p.touchscreen.tap(a.quadro.l + (a.quadro.r - a.quadro.l) * 0.92, a.quadro.t + (a.quadro.b - a.quadro.t) * 0.3)
    await p.waitForTimeout(800)
  }
  const m = await medir()
  if (m.rua || !m.ver) problemas.push(`${nome}: tocar à direita na rua não passou para o produto`)
  conferirPe(m, 'no produto')
  if (cruza(m.disp, m.ver) || cruza(m.preco, m.ver)) problemas.push(`${nome}: VER PRODUTO por cima do preço/DISPONÍVEL`)
  if (m.disp && m.story && m.disp.b > m.story.b) problemas.push(`${nome}: DISPONÍVEL fora do story`)
  await p.screenshot({ path: `${out}${nome}-1b-hero-produto.png` })
  await ctx.close()
  console.log('✓', nome)
}

// Home 2 deitado: o 1º story é de produto (e o 2º também, tudo dentro do story) e a rua no fim do Início
for (const [aparelho, w, h] of deitados) {
  const nome = `h2-${aparelho}`
  const ctx = await contexto(w, h, { semDica: true })
  const p = await ctx.newPage()
  await abrirLembrado(ctx, p, nome, `${base}?home=2&uf=mg`)
  const medir = () =>
    p.evaluate(() => {
      const r = (s) => {
        const e = document.querySelector(s)
        const b = e?.getBoundingClientRect()
        return b && b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null
      }
      return {
        story: r('.hero-story'),
        quadro: r('.hero-quadro'),
        barra: r('.barra-abas'),
        resposta: r('.hero-resposta .barra-pilula'),
        ver: r('.hero-ver'),
        disp: r('.hero-palco .sq-disp'),
        preco: r('.hero-palco .sq-preco'),
        nome: document.querySelector('.hero-palco .sq-nome')?.textContent ?? null,
        rua: document.querySelectorAll('.hero .rua, .hero .rua-vaga, .rua-story').length,
      }
    })
  const conferirPe = (m, onde) => {
    if (m.story && m.barra && m.story.b > m.barra.t + 1) problemas.push(`${nome}: story passa da barra de abas ${onde} (${Math.round(m.story.b)} > ${Math.round(m.barra.t)})`)
    if (m.resposta && m.barra && m.resposta.b > m.barra.t + 1) problemas.push(`${nome}: "Enviar mensagem…" atrás da barra de abas ${onde}`)
  }
  // o primeiro produto (o 1º story; a rua fica no fim do Início): VER PRODUTO longe do preço e do DISPONÍVEL, tudo
  // dentro do story; o segundo também
  const conferirProduto = (m, onde) => {
    if (!m.ver || !m.nome) problemas.push(`${nome}: o story deitado sem o produto ${onde}`)
    if (m.rua) problemas.push(`${nome}: a rua no story deitado ${onde}`)
    conferirPe(m, onde)
    if (cruza(m.disp, m.ver) || cruza(m.preco, m.ver)) problemas.push(`${nome}: VER PRODUTO por cima do preço/DISPONÍVEL ${onde}`)
    if (m.disp && m.story && m.disp.b > m.story.b) problemas.push(`${nome}: DISPONÍVEL fora do story ${onde}`)
  }
  const a = await medir()
  conferirProduto(a, 'no 1º produto')
  if (await ruaBaixada(p)) problemas.push(`${nome}: a rua do fim baixou na primeira tela`)
  await p.screenshot({ path: `${out}${nome}-1-hero.png` })
  if (a.quadro) {
    await p.touchscreen.tap(a.quadro.l + (a.quadro.r - a.quadro.l) * 0.92, a.quadro.t + (a.quadro.b - a.quadro.t) * 0.3)
    await p.waitForTimeout(800)
  }
  const m = await medir()
  if (m.nome === a.nome) problemas.push(`${nome}: tocar à direita não passou pro 2º produto`)
  conferirProduto(m, 'no 2º produto')
  await p.screenshot({ path: `${out}${nome}-1b-hero-produto.png` })
  // a rua no fim do Início, deitado também
  await p.locator('.vista-inicio .catalogo-inicio .grade').waitFor({ state: 'attached', timeout: 6000 }).catch(() => {})
  await conferirRuaNoFim(p, nome, `${out}${nome}-1c-rua-fim.png`)
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
          quadro: r('.vista-inicio .hero-quadro'),
          rua: r('.vista-inicio .rua-story:not([hidden])'),
          ruaPe: r('.vista-inicio .rua-adesivos .rua-frase'),
          merc: r('.vista-inicio .rua-em-story .rua-mercador'),
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
    await p.locator('.vista-inicio .rua-story[data-rua="rodando"]').waitFor({ timeout: 10000 }).catch(() => {})
    const m0 = await medir()
    await p.screenshot({ path: `${out}${tag.replace(' ', '-')}-1.png` })
    // na rua (o primeiro story): o aviso no pé, sem cobrir o adesivo dela nem o mercador
    if (!m0.rua) problemas.push(`${tag}: o story não abriu na rua`)
    else if (!m0.noStory) problemas.push(`${tag}: na rua, o aviso não ficou no pé do story`)
    else {
      if (cruza(m0.noStory, m0.ruaPe)) problemas.push(`${tag}: aviso por cima do adesivo da rua`)
      if (m0.merc && m0.merc.b > m0.noStory.t + 1) problemas.push(`${tag}: aviso por cima do mercador (${Math.round(m0.merc.b)} > ${Math.round(m0.noStory.t)})`)
      if (m0.opcoes.length !== 2 || m0.opcoes.includes(false)) problemas.push(`${tag}: na rua, opção do aviso coberta (${JSON.stringify(m0.opcoes)})`)
    }
    // o primeiro produto: o aviso não cobre o VER PRODUTO nem o DISPONÍVEL
    if (m0.quadro) {
      await p.touchscreen.tap(m0.quadro.l + (m0.quadro.r - m0.quadro.l) * 0.92, m0.quadro.t + (m0.quadro.b - m0.quadro.t) * 0.3)
      await p.waitForTimeout(800)
    }
    const m = await medir()
    if (m.rua || !m.ver) problemas.push(`${tag}: tocar à direita na rua não passou para o produto`)
    await p.screenshot({ path: `${out}${tag.replace(' ', '-')}-1b-produto.png` })
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

// ---------- Home 2, palpite de IP pendente: no Início o aviso fica no pé do story (o 1º é de produto), no lugar da linha
// "Enviar mensagem…" (nada por cima do produto, do VER PRODUTO nem da linha de resposta); nas outras abas, fixo acima da
// barra. Estado sem entrega (BA): opções embaixo ----------
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
    const tag = `h2-${nome}-${ip ? 'BA' : 'MG'} palpite`
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
    await p.goto(`${base}?home=2`)
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
          quadro: r('.vista-inicio .hero-quadro'),
          rua: document.querySelectorAll('.vista-inicio .hero .rua, .vista-inicio .hero .rua-vaga, .rua-story').length,
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
    // o primeiro produto (o 1º story): o aviso não cobre o VER PRODUTO nem o DISPONÍVEL
    const m = await medir()
    if (m.rua || !m.ver) problemas.push(`${tag}: o 1º story não é de produto (rua ${m.rua})`)
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
