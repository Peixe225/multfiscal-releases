// A vitrine da rua (rodada do scripts/revisao.mjs): com a loja do servidor (o GET loja simulado, a da semente mexida
// como o dono mexe), o mercador ergue produtos de verdade, um de cada vez, com a plaquinha do nome e do preço. Confere,
// nos três lugares da rua (o 1º story do celular, a faixa do computador e o fim do Início da Home 2):
//  · os produtos do estado certo, na ordem do story do dono e depois os outros, e nunca bebida alcoólica (a loja de
//    teste tem no topo do story de MG uma lata de nome neutro numa categoria marcada "Bebida alcoólica" no painel, uma
//    caneca nos Destilados sem a marca, um destilado e um gin) nem o isqueiro;
//  · o preço da plaquinha igual ao do catálogo (o dono mudou o do dichavador) e "Consultar" sem preço;
//  · tocar no produto (ou na plaquinha) abre a página dele; no story, tocar na borda continua passando, segurar continua
//    pausando e tocar no mercador continua chamando; pelo teclado, a plaquinha é um link com o nome do produto, antes do
//    mercador, sem aviso nenhum a cada troca;
//  · com movimento reduzido, a foto com um produto parado (o próximo só quando a rua volta à vista);
//  · sem a loja do servidor (fora do ar) e com a chave do painel desligada, a rua de sempre, só com os itens desenhados.
// Com a rua no relógio de verdade (a faixa do computador), a plaquinha aparece sozinha entre um cliente e outro; nos
// outros casos a rua anda na mão (?ruaquadros: o relógio para e window.__rua.avancar(ms) anda), pra ser rápido e igual.
import { lojaDaSemente } from './revisao-loja.mjs'

const brl = (v) => (v == null ? 'Consultar' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v).replace(/\s/g, ' '))

/**
 * @param {{ browser: import('playwright').Browser, base: string, contexto: Function, conferir: Function, foto: Function,
 *   vigiarSemRede: Function }} h
 */
export async function rodadaVitrine({ browser, base, contexto, conferir, foto, vigiarSemRede }) {
  const loja = lojaDaSemente()
  const prod = (id) => loja.produtos.find((p) => p.id === id)
  // o dono: o destilado e o gin no topo do story de MG (a rua pula os dois), o dichavador com preço novo
  // a marca "Bebida alcoólica" do painel (alcool): a categoria de nome neutro marcada fica fora da rua inteira, até a lata
  // sem nome de bebida ("Lata da casa"); e a dedução pelo nome continua, de reforço: os Destilados sem a marca (a loja de
  // um servidor de antes dela) seguem fora, até a caneca de nome neutro que mora lá
  const fanta = prod('fanta-ghost-face-punch')
  loja.categorias.push({ id: 'da-casa', nome: 'Da casa', curto: 'Da casa', icone: 'lata', bebida: true, alcool: true })
  loja.categorias.find((c) => c.id === 'destilados').alcool = false
  loja.produtos.push(
    { ...fanta, id: 'lata-da-casa', nome: 'Lata da casa', tamanho: '473 ml', detalhe: '', descricao: '', categoria: 'da-casa', preco: 15, foto: null },
    { ...fanta, id: 'caneca-de-cobre', nome: 'Caneca de cobre', tamanho: '', detalhe: '', descricao: '', categoria: 'destilados', preco: 39.9, foto: null },
  )
  loja.stories = { mg: ['lata-da-casa', 'caneca-de-cobre', 'jack-daniels-old-no7-1l', 'gin-tanqueray-london-dry', 'dichavador-metal-4-partes', 'seda-ocb-premium-slim'] }
  prod('dichavador-metal-4-partes').preco = 61.5
  const ALCOOL = new Set(loja.produtos.filter((p) => p.categoria === 'destilados' || p.categoria === 'da-casa').map((p) => p.id))
  /** O que pode aparecer na rua no estado (à venda lá, sem destilado e sem isqueiro). */
  const pode = (uf) => new Set(loja.produtos.filter((p) => p.disponivel[uf] && !ALCOOL.has(p.id) && p.arte.tipo !== 'isqueiro').map((p) => p.id))

  const servidor = { modo: 'ok', versao: 21, em: new Date(Date.now() - 60_000).toISOString(), loja }
  const responder = (route) => {
    if (servidor.modo === 'fora') return route.fulfill({ status: 502, contentType: 'text/html', body: 'Bad gateway' })
    return route.fulfill({ json: { ok: true, versao: servidor.versao, atualizadoEm: servidor.em, loja: servidor.loja }, headers: { 'Cache-Control': 'no-cache', ETag: `"${servidor.versao}"` } })
  }
  const esperar = (page, f, arg, ms = 8000) => page.waitForFunction(f, arg, { timeout: ms }).then(() => true, () => false)
  const abrir = async (viewport, url, opts = {}) => {
    const ctx = await contexto(browser, viewport, { semDica: true, ...opts })
    // a loja de teste (simulada); `semLoja`: nenhuma (o "sem servidor" de sempre, mesmo com GC_LOJA_REAL); `real`: a do
    // servidor de verdade (GC_LOJA_REAL=1, PHP ligado e painel instalado)
    if (opts.semLoja) await ctx.route(/\/api\/index\.php\?r=loja(&|$)/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>sem servidor</title>' }))
    else if (!opts.real) await ctx.route(/\/api\/index\.php\?r=loja(&|$)/, responder)
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
        sessionStorage.setItem('gc-abertura', '1')
      } catch {
        /* ignora */
      }
    })
    const page = await ctx.newPage()
    vigiarSemRede(page, `vitrine ${viewport.width}`)
    await page.goto(`${base}${url}`)
    return { ctx, page }
  }
  /** A rua à vista (a do story, a da faixa do computador ou a do fim da Home 2). */
  const RUA = '.vista:not([hidden]) .rua'
  const prontos = (page) => page.evaluate((s) => Number(document.querySelector(s)?.getAttribute('data-vitrine') ?? -1), RUA)
  /** Anda a rua na mão (?ruaquadros) até a plaquinha aparecer; devolve o produto e o texto dela. */
  const ateMostrar = (page, max = 90_000) =>
    page.evaluate(
      async ({ s, max }) => {
        const vis = () => document.querySelector(`${s} .rua-vitrine.mostra`)
        for (let t = 0; !vis() && t < max; t += 250) {
          window.__rua.avancar(250)
          await new Promise((ok) => requestAnimationFrame(() => ok()))
        }
        const v = vis()
        return v ? { id: v.getAttribute('data-produto'), texto: v.textContent, nome: v.querySelector('.rua-vitrine-nome')?.textContent, preco: v.querySelector('.rua-vitrine-preco')?.textContent } : null
      },
      { s: RUA, max },
    )
  const ateGuardar = (page) =>
    page.evaluate(async (s) => {
      for (let t = 0; document.querySelector(`${s} .rua-vitrine.mostra`) && t < 10_000; t += 250) {
        window.__rua.avancar(250)
        await new Promise((ok) => requestAnimationFrame(() => ok()))
      }
    }, RUA)
  /** Onde o produto erguido está na tela (px do cliente), pela caixa do item na mão do mercador. */
  const caixaDoProduto = (page) =>
    page.evaluate((s) => {
      const r = window.__rua
      const m = r.motor
      const merc = m.ator('mercador')
      const c = m.caixaDoItem(merc)
      const tela = document.querySelector(`${s} .rua-tela`).getBoundingClientRect()
      const px = tela.width / m.w
      return c ? { x: tela.left + ((c[0] + c[2]) / 2) * px, y: tela.top + ((c[1] + c[3]) / 2) * px } : null
    }, RUA)
  const produtoAberto = (page) => page.evaluate(() => (document.querySelector('.pp-topo') ? new URL(location.href).searchParams.get('produto') : null))
  /** Uns produtos seguidos da vitrine: os ids e se a plaquinha mostra o nome e o preço do catálogo. */
  const sequencia = async (page, n) => {
    const vistos = []
    for (let i = 0; i < n; i++) {
      const v = await ateMostrar(page)
      if (!v) break
      vistos.push(v)
      await ateGuardar(page)
    }
    return vistos
  }
  const conferirPlaquinhas = (nome, uf, vistos) => {
    const ok = pode(uf)
    const ids = vistos.map((v) => v.id)
    conferir(vistos.length > 0 && ids.every((id) => ok.has(id)), `${nome}: só produtos à venda em ${uf.toUpperCase()} e permitidos na rua (${ids.join(', ')})`)
    conferir(!ids.some((id) => ALCOOL.has(id) || id === 'isqueiro-clipper'), `${nome}: nenhum destilado nem o isqueiro na rua`)
    const precos = vistos.map((v) => [v.id, v.nome, v.preco?.trim(), prod(v.id)?.nome, brl(prod(v.id)?.preco)])
    conferir(precos.every(([, nomeP, preco, nomeC, precoC]) => nomeP === nomeC && preco === precoC), `${nome}: a plaquinha com o nome e o preço do catálogo (${precos.map(([id, , p]) => `${id} ${p}`).join(' · ')})`)
  }

  // ── o 1º story do Início no celular (MG): a ordem do dono sem o destilado e o gin, o preço novo, os gestos ──
  {
    const nome = 'vitrine-story-390'
    const { ctx, page } = await abrir({ width: 390, height: 844 }, '?uf=mg&ruaquadros=7')
    conferir(await esperar(page, (s) => Number(document.querySelector(s)?.getAttribute('data-vitrine')) >= 4, RUA, 15000), `${nome}: as artes da vitrine prontas depois que a rua pintou (${await prontos(page)})`)
    // o story parado (K): a rua anda só na mão
    await page.keyboard.press('k')
    const vistos = await sequencia(page, 4)
    conferir(vistos[0]?.id === 'dichavador-metal-4-partes' && vistos[1]?.id === 'seda-ocb-premium-slim', `${nome}: a ordem do story do dono, pulando a categoria marcada como bebida alcoólica, os Destilados (pelo nome), o destilado e o gin (${vistos.map((v) => v.id).join(' → ')})`)
    conferirPlaquinhas(nome, 'mg', vistos)
    conferir(vistos[0]?.preco?.trim() === 'R$ 61,50', `${nome}: o preço que o dono mudou (${vistos[0]?.preco})`)
    conferir(vistos.some((v) => v.preco?.trim() === 'Consultar'), `${nome}: sem preço, "Consultar" (${vistos.map((v) => v.preco?.trim()).join(', ')})`)
    // a plaquinha à vista: dentro do quadro do story, sem rolagem lateral, e nenhum aviso pro leitor de tela
    const v = await ateMostrar(page)
    const placa = await page.evaluate((s) => {
      const el = document.querySelector(`${s} .rua-vitrine`)
      const r = el.getBoundingClientRect()
      const q = document.querySelector('.vista-inicio .hero-quadro').getBoundingClientRect()
      return {
        dentro: r.left >= q.left - 1 && r.right <= q.right + 1 && r.top >= q.top && r.bottom <= q.bottom,
        lateral: document.documentElement.scrollWidth > innerWidth,
        vivo: !!el.closest('[aria-live]') || !!el.querySelector('[aria-live]'),
        alvo: Math.round(r.height),
      }
    }, RUA)
    conferir(placa.dentro && !placa.lateral && !placa.vivo && placa.alvo >= 44, `${nome}: a plaquinha dentro do quadro, alvo de 44 px, sem aria-live (${JSON.stringify(placa)})`)
    await foto(page, `${nome}-1-plaquinha`)
    // segurar na plaquinha pausa (e soltar não abre o produto)
    const pb = await page.locator(`${RUA} .rua-vitrine`).boundingBox()
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(450)
    const segurou = await page.evaluate(() => !!document.querySelector('.vista-inicio .hero-story.segurando'))
    await page.mouse.up()
    await page.waitForTimeout(500)
    conferir(segurou && !(await produtoAberto(page)), `${nome}: segurar na plaquinha pausa o story e soltar não abre o produto`)
    // tocar no produto erguido abre a página dele (o mesmo caminho do story de produto); o story não passa
    const c = await caixaDoProduto(page)
    await page.touchscreen.tap(c.x, c.y)
    conferir(await esperar(page, (id) => !!document.querySelector('.pp-topo') && new URL(location.href).searchParams.get('produto') === id, v?.id), `${nome}: tocar no produto erguido abre a página dele (${v?.id} → ${await produtoAberto(page)})`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
    // tocar na plaquinha também
    const v2 = await ateMostrar(page)
    await page.locator(`${RUA} .rua-vitrine`).tap()
    conferir(await esperar(page, (id) => new URL(location.href).searchParams.get('produto') === id && !!document.querySelector('.pp-topo'), v2?.id), `${nome}: tocar na plaquinha abre a página do produto dela (${v2?.id})`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
    // com o produto erguido, tocar na borda continua passando o story (a rua fica escondida, no produto)
    await ateMostrar(page)
    const q = await page.locator('.vista-inicio .hero-quadro').boundingBox()
    await page.touchscreen.tap(q.x + q.width * 0.95, q.y + q.height * 0.4)
    conferir(await esperar(page, () => !document.querySelector('.vista-inicio .hero-story.na-rua') && !!document.querySelector('.vista-inicio .hero-palco .sq-nome')), `${nome}: com o produto erguido, a borda continua passando o story`)
    await page.touchscreen.tap(q.x + q.width * 0.05, q.y + q.height * 0.4)
    await esperar(page, () => !!document.querySelector('.vista-inicio .hero-story.na-rua'))
    // o clique que vem logo depois de passar o story na borda não vale (Hero.tsx, semClique): espera ele
    await page.waitForTimeout(500)
    // e tocar no mercador continua chamando (o "Ver o Mercado"): com ele no miolo do quadro (nas bordas o toque passa
    // o story, mesmo em cima dele) e sem produto na mão
    await page.evaluate(async (s) => {
      for (let t = 0; t < 30_000; t += 250) {
        const b = document.querySelector(`${s} .rua-mercador`).getBoundingClientRect()
        const q = document.querySelector('.vista-inicio .hero-quadro').getBoundingClientRect()
        const f = (b.left + b.width / 2 - q.left) / q.width
        if (f > 0.34 && f < 0.66 && !window.__rua.motor.mostrando) break
        window.__rua.avancar(250)
        await new Promise((ok) => requestAnimationFrame(() => ok()))
      }
    }, RUA)
    const m = await page.locator(`${RUA} .rua-mercador`).boundingBox()
    await page.touchscreen.tap(m.x + m.width / 2, m.y + m.height * 0.6)
    conferir(await esperar(page, () => !!document.querySelector('.vista-inicio .rua-ver')), `${nome}: tocar no mercador continua chamando (o "Ver o Mercado")`)
    // pelo teclado: a plaquinha é um link com o nome e o preço, logo antes do mercador; Enter abre o produto
    await page.locator(`${RUA} .rua-mercador`).focus()
    await page.keyboard.press('Shift+Tab')
    const tecla = await page.evaluate((s) => {
      const a = document.activeElement
      const r = a?.getBoundingClientRect()
      return { link: a?.matches(`${s} a.rua-vitrine`), id: a?.getAttribute('data-produto'), nome: a?.textContent, visivel: a ? getComputedStyle(a).opacity === '1' && r.width > 0 : false }
    }, RUA)
    const pt = prod(tecla.id)
    conferir(tecla.link && tecla.visivel && tecla.nome === `Ver ${pt?.nome}, ${brl(pt?.preco)}`, `${nome}: pelo teclado, a plaquinha é um link antes do mercador, aparece com o foco e diz o nome e o preço (${JSON.stringify(tecla)})`)
    await foto(page, `${nome}-2-teclado`)
    await page.keyboard.press('Enter')
    conferir(await esperar(page, (id) => new URL(location.href).searchParams.get('produto') === id, tecla.id), `${nome}: Enter na plaquinha abre o produto (${tecla.id})`)
    await ctx.close()
  }

  // ── a faixa do computador (RJ), no relógio de verdade: a plaquinha aparece sozinha entre um cliente e outro ──
  {
    const nome = 'vitrine-faixa-1280'
    const { ctx, page } = await abrir({ width: 1280, height: 800 }, '?uf=rj')
    conferir(await esperar(page, (s) => document.querySelector(s)?.getAttribute('data-rua') === 'rodando' && Number(document.querySelector(s)?.getAttribute('data-vitrine')) >= 4, RUA, 15000), `${nome}: a rua andando e a vitrine pronta (${await prontos(page)})`)
    const apareceu = await esperar(page, (s) => !!document.querySelector(`${s} .rua-vitrine.mostra`), RUA, 60000)
    const id = await page.locator(`${RUA} .rua-vitrine`).getAttribute('data-produto').catch(() => null)
    conferir(apareceu && pode('rj').has(id), `${nome}: a plaquinha aparece sozinha, com um produto de RJ (${id})`)
    // a plaquinha dentro da faixa (sem cobrir o botão de pausar)
    const caixa = await page.evaluate((s) => {
      const r = document.querySelector(`${s} .rua-vitrine`).getBoundingClientRect()
      const f = document.querySelector(s).getBoundingClientRect()
      const p = document.querySelector(`${s} .rua-pausa`).getBoundingClientRect()
      const cobre = r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top
      return { dentro: r.left >= f.left && r.right <= f.right && r.top >= f.top && r.bottom <= f.bottom, cobre }
    }, RUA)
    conferir(caixa.dentro && !caixa.cobre, `${nome}: a plaquinha dentro da faixa, sem cobrir o "Pausar a rua" (${JSON.stringify(caixa)})`)
    // clicar na plaquinha (ela fica uns 2,6 s) abre a página do produto dela
    const agora = await page.locator(`${RUA} .rua-vitrine`).getAttribute('data-produto')
    await page.locator(`${RUA} .rua-vitrine`).click({ timeout: 2000 }).catch(() => {})
    conferir(await esperar(page, (x) => new URL(location.href).searchParams.get('produto') === x, agora), `${nome}: clicar na plaquinha abre a página do produto (${agora})`)
    await ctx.close()
  }

  // ── a faixa do computador na mão (SC): a sequência de SC ──
  {
    const nome = 'vitrine-faixa-sc'
    const { ctx, page } = await abrir({ width: 1280, height: 800 }, '?uf=sc&ruaquadros=3')
    await esperar(page, (s) => Number(document.querySelector(s)?.getAttribute('data-vitrine')) >= 4, RUA, 15000)
    const vistos = await sequencia(page, 3)
    conferirPlaquinhas(nome, 'sc', vistos)
    await ateMostrar(page)
    const c = await caixaDoProduto(page)
    const id = await page.locator(`${RUA} .rua-vitrine`).getAttribute('data-produto')
    await page.mouse.click(c.x, c.y)
    conferir(await esperar(page, (x) => new URL(location.href).searchParams.get('produto') === x, id), `${nome}: clicar no produto erguido abre a página dele (${id})`)
    await ctx.close()
  }

  // ── o fim do Início da Home 2 (celular, ES) ──
  {
    const nome = 'vitrine-fim-h2-390'
    const { ctx, page } = await abrir({ width: 390, height: 844 }, '?home=2&uf=es&ruaquadros=5')
    // a rua do fim só baixa perto da tela: rola até ela (de novo, se a grade montou depois e empurrou a vaga)
    let pronta = false
    for (let k = 0; k < 15 && !pronta; k++) {
      await page.evaluate(() => document.querySelector('.vista:not([hidden]) .rua-vaga')?.scrollIntoView({ block: 'center' }))
      pronta = await esperar(page, (s) => Number(document.querySelector(s)?.getAttribute('data-vitrine')) >= 4, RUA, 1000)
    }
    conferir(pronta, `${nome}: a vitrine pronta na rua do fim do Início (${await prontos(page)})`)
    const vistos = await sequencia(page, 2)
    conferirPlaquinhas(nome, 'es', vistos)
    await ateMostrar(page)
    await foto(page, `${nome}-1-plaquinha`)
    const id = await page.locator(`${RUA} .rua-vitrine`).getAttribute('data-produto')
    await page.locator(`${RUA} .rua-vitrine`).tap()
    conferir(await esperar(page, (x) => new URL(location.href).searchParams.get('produto') === x && new URL(location.href).searchParams.get('home') === '2', id), `${nome}: tocar na plaquinha abre o produto, na Home 2 (${id})`)
    await ctx.close()
  }

  // ── movimento reduzido: a foto com um produto parado; o próximo só quando a rua volta à vista ──
  for (const [w, h, url] of [
    [390, 844, '?uf=mg'],
    [1280, 800, '?uf=mg'],
  ]) {
    const nome = `vitrine-reduzido-${w}`
    const { ctx, page } = await abrir({ width: w, height: h }, url, { reduzir: true })
    conferir(await esperar(page, (s) => document.querySelector(s)?.getAttribute('data-rua') === 'foto' && !!document.querySelector(`${s} .rua-vitrine.mostra`), RUA, 15000), `${nome}: a foto com o produto erguido e a plaquinha`)
    const quadro = () => page.evaluate((s) => document.querySelector(`${s} .rua-tela`).toDataURL(), RUA)
    const prodAgora = () => page.locator(`${RUA} .rua-vitrine`).getAttribute('data-produto')
    const a = await quadro()
    const p1 = await prodAgora()
    await page.waitForTimeout(4000)
    conferir(a === (await quadro()) && p1 === (await prodAgora()), `${nome}: parado (o mesmo quadro e o mesmo produto em 4 s: ${p1})`)
    conferir(p1 === 'dichavador-metal-4-partes', `${nome}: o primeiro da vitrine de MG (${p1})`)
    await foto(page, `${nome}-1`)
    if (w < 900) {
      // passa pro produto e volta: a rua à vista de novo mostra o próximo
      const q = await page.locator('.vista-inicio .hero-quadro').boundingBox()
      await page.touchscreen.tap(q.x + q.width * 0.95, q.y + q.height * 0.4)
      await page.waitForTimeout(500)
      await page.touchscreen.tap(q.x + q.width * 0.05, q.y + q.height * 0.4)
      conferir(await esperar(page, (p) => document.querySelector('.vista-inicio .rua .rua-vitrine.mostra')?.getAttribute('data-produto') !== p, p1), `${nome}: a rua de volta à vista mostra o próximo (${p1} → ${await prodAgora()})`)
    }
    // tocar no produto da foto abre ele (depois do meio segundo em que o clique depois da borda não vale)
    await page.waitForTimeout(500)
    const id = await prodAgora()
    await page.locator(`${RUA} .rua-vitrine`).click()
    conferir(await esperar(page, (x) => new URL(location.href).searchParams.get('produto') === x, id), `${nome}: a plaquinha da foto abre o produto (${id})`)
    await ctx.close()
  }

  // ── sem a loja do servidor (fora do ar, nada guardado) e com a chave desligada: a rua de sempre ──
  for (const caso of ['fora', 'desligada', 'sem-servidor']) {
    const nome = `vitrine-${caso}`
    servidor.modo = caso === 'fora' ? 'fora' : 'ok'
    servidor.loja = caso === 'desligada' ? { ...loja, vitrineNaRua: false } : loja
    servidor.versao++
    const { ctx, page } = await abrir({ width: 390, height: 844 }, '?uf=mg&ruaquadros=7', { semLoja: caso === 'sem-servidor' })
    await esperar(page, (s) => document.querySelector(s)?.getAttribute('data-rua') === 'parada', RUA, 15000)
    await page.keyboard.press('k')
    await page.waitForTimeout(2500)
    // um ciclo inteiro de clientes na mão: nenhum produto da loja, e o skatista leva a seda desenhada de sempre
    const r = await page.evaluate(async (s) => {
      const itens = new Set()
      for (let t = 0; t < 40_000; t += 250) {
        window.__rua.avancar(250)
        for (const a of window.__rua.motor.atores) if (a.item) itens.add(a.item)
        if (t % 2000 === 0) await new Promise((ok) => requestAnimationFrame(() => ok()))
      }
      return { prontos: document.querySelector(s)?.getAttribute('data-vitrine'), placa: document.querySelectorAll(`${s} .rua-vitrine`).length, itens: [...itens] }
    }, RUA)
    conferir(r.prontos === '0' && r.placa === 0 && !r.itens.some((i) => i.startsWith('produto:')) && r.itens.length > 0, `${nome}: a rua de sempre, só com os itens desenhados (${JSON.stringify(r)})`)
    await ctx.close()
  }
  servidor.modo = 'ok'
  servidor.loja = loja

  // ── GC_LOJA_REAL=1: a loja do servidor de verdade (a da semente, sem mexer) também vira vitrine ──
  if (process.env.GC_LOJA_REAL) {
    const nome = 'vitrine-php'
    const { ctx, page } = await abrir({ width: 390, height: 844 }, '?uf=mg&ruaquadros=7', { real: true })
    conferir(await esperar(page, (s) => Number(document.querySelector(s)?.getAttribute('data-vitrine')) >= 4, RUA, 15000), `${nome}: com o PHP, a vitrine pronta (${await prontos(page)})`)
    await page.keyboard.press('k')
    const vistos = await sequencia(page, 2)
    const semente = lojaDaSemente()
    const ok = new Set(semente.produtos.filter((p) => p.disponivel.mg && p.categoria !== 'destilados' && p.arte.tipo !== 'isqueiro').map((p) => p.id))
    conferir(vistos.length === 2 && vistos.every((v) => ok.has(v.id) && v.preco?.trim() === brl(semente.produtos.find((p) => p.id === v.id)?.preco)), `${nome}: produtos de MG da loja do servidor, com o preço dela (${vistos.map((v) => `${v.id} ${v.preco}`).join(' · ')})`)
    await ctx.close()
  }
}
