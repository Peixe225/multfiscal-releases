// A loja do servidor no site (rodada do scripts/revisao.mjs): o GET loja simulado no formato do API.md ("Loja"),
// nascido da semente (public/api/nucleo/semente-loja.json, a loja de um servidor recém-instalado) e mexido como o dono
// mexe no painel. Confere: o story do Início na ordem do dono (depois da rua) e sem a rua quando ela é desligada (na
// Home 2, ?home=2, o story só com os do dono e a rua no fim do Início, que some com a chave desligada); o
// "RESTAM 2" no card, no story e na página do produto, a quantidade que não passa do que resta e o aviso; o estado
// ativado no painel (BA) no site inteiro, sem a tela de sem atendimento piscar; o WhatsApp próprio do estado e o "o
// mesmo pra todos"; a entrega grátis em mais de um dia; a frase do story; o material da loja de 11/10 (os 2 novos só no
// RJ, com "Consultar"; os 4 do material no desenho do site, sem a foto nem a thumb de fábrica; um produto com a thumb
// do dono, uploads/, e outro com a de fábrica, produtos/, no GET loja, cada um com a capa no card, sem o halo); a arte em
// pixel que sai do nome (a lata alta da Fanta da China com a estampa dela, não a do Arizona, no desenho e na grade do RJ
// com as ilustrações seguradas; o APPLE do Tennessee Apple só onde a fonte cabe); o Teste minha sorte desligado; a loja guardada
// no aparelho com o servidor fora do ar; o 404 sem-loja (volta pra embutida); a resposta torta (ignorada); e o estado
// que sai do site (quem estava nele vê a tela de sem atendimento).
import { readFileSync } from 'node:fs'

/** A loja pública de um servidor recém-instalado (o que o GET loja devolve antes de o dono mexer). */
export function lojaDaSemente() {
  const s = JSON.parse(readFileSync(new URL('../public/api/nucleo/semente-loja.json', import.meta.url), 'utf8'))
  return {
    whatsapp: s.ajustes.whatsapp,
    restamAte: s.ajustes.restamAte,
    ruaNoStory: true,
    textos: s.textos,
    categorias: s.categorias,
    // o que é só do painel (a anotação do dono) não sai no GET loja
    produtos: s.produtos.map(({ obs: _obs, ...p }) => ({ ...p, restam: {} })),
    estados: s.estados,
    stories: {},
    sorte: s.sorte,
  }
}

// ── a arte em pixel (src/arte/produtos/desenhar.ts): a grade de desenho é 90×160 e a lata alta cresce 1,03 no meio ──
/** Da unidade do desenho da lata alta pro pixel de uma imagem w×h. */
const naLataAlta = (u, v, w, h) => [Math.round(((45 + (u - 45) * 1.03) * w) / 90), Math.round(((80 + (v - 80) * 1.03) * h) / 160)]
/** Pixel claro e sem cor (o creme do painel do Arizona, o branco do logo da Fanta). */
const creme = (d, i) => d[i + 3] > 200 && Math.max(d[i], d[i + 1], d[i + 2]) > 200 && Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) < 40
/** Quanto do meio da lata alta (embaixo da flor do painel do Arizona, entre os fios e a borda dele) é creme. */
function cremeNaCaixa({ w, h, d }) {
  const [x0, y0] = naLataAlta(36, 84, w, h)
  const [x1, y1] = naLataAlta(54, 94, w, h)
  let n = 0
  let t = 0
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      t++
      if (creme(d, (y * w + x) * 4)) n++
    }
  return n / Math.max(1, t)
}
/** Sobreposição (interseção ÷ união) do creme de duas latas altas do mesmo tamanho, na parte impressa. */
function iouDoCreme(a, b) {
  if (a.w !== b.w || a.h !== b.h) return null
  const [, y0] = naLataAlta(0, 33, a.w, a.h)
  const [, y1] = naLataAlta(0, 130, a.w, a.h)
  let i = 0
  let u = 0
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < a.w; x++) {
      const k = (y * a.w + x) * 4
      const ca = creme(a.d, k)
      const cb = creme(b.d, k)
      if (ca && cb) i++
      if (ca || cb) u++
    }
  return u ? i / u : 0
}

/**
 * O desenho em pixel sai do nome também (desenharArte, empacotado com o rolldown e rodado no navegador): a lata alta da
 * Fanta da China com a estampa dela (diferente da mesma lata com o nome do Arizona, sem o painel creme), o Arizona com
 * o painel, outra lata alta só com os filetes; e o letreiro do rótulo só quando a fonte cabe inteira na saída (o APPLE
 * do Tennessee Apple sai na página, 120 px, e no card, 72 px, fica o filete, como numa garrafa quadrada sem nada escrito).
 */
export async function desenhoDoNome({ browser, conferir }) {
  const { rolldown } = await import('rolldown')
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const tmp = mkdtempSync(join(tmpdir(), 'gc-desenho-'))
  const pacote = await rolldown({ input: new URL('../src/arte/produtos/desenhar.ts', import.meta.url).pathname, logLevel: 'silent' })
  await pacote.write({ file: join(tmp, 'd.js'), format: 'iife', name: 'GCDesenho' })
  await pacote.close()
  const codigo = readFileSync(join(tmp, 'd.js'), 'utf8')
  rmSync(tmp, { recursive: true, force: true })
  const cat = JSON.parse(readFileSync(new URL('../src/dados/catalogo.json', import.meta.url), 'utf8')).produtos
  const P = (id) => cat.find((p) => p.id === id)
  const ctx = await browser.newContext()
  const pg = await ctx.newPage()
  await pg.setContent('<!doctype html><title>desenho</title>')
  await pg.addScriptTag({ content: codigo })
  const r = await pg.evaluate(
    ({ china, arizona, apple, old }) => {
      const des = (arte, nome, w) => {
        const h = Math.round((w * 16) / 9)
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const g = c.getContext('2d')
        window.GCDesenho.desenharArte(g, arte, w, h, { nome })
        return { w, h, d: Array.from(g.getImageData(0, 0, w, h).data) }
      }
      const dif = (a, b) => {
        let n = 0
        for (let i = 0; i < a.d.length; i += 4) if (Math.abs(a.d[i] - b.d[i]) + Math.abs(a.d[i + 1] - b.d[i + 1]) + Math.abs(a.d[i + 2] - b.d[i + 2]) + Math.abs(a.d[i + 3] - b.d[i + 3]) > 8) n++
        return n
      }
      const neutro = 'Garrafa da casa'
      const fc = des(china.arte, china.nome, 90)
      const fa = des(china.arte, arizona.nome, 90)
      const outra = des(china.arte, 'Lata alta da casa', 90)
      return {
        china: fc,
        chinaComNomeDoArizona: fa,
        arizona: des(arizona.arte, arizona.nome, 90),
        outraAlta: outra,
        difChina: dif(fc, fa),
        difOutra: dif(outra, fa),
        apple72: dif(des(apple.arte, apple.nome, 72), des(apple.arte, neutro, 72)),
        apple120: dif(des(apple.arte, apple.nome, 120), des(apple.arte, neutro, 120)),
        old72: dif(des(old.arte, old.nome, 72), des(old.arte, neutro, 72)),
      }
    },
    { china: P('fanta-maca-china'), arizona: P('arizona-green-tea'), apple: P('jack-daniels-tennessee-apple'), old: P('jack-daniels-old-no7-1l') },
  )
  await ctx.close()
  const cr = (x) => cremeNaCaixa(x).toFixed(2)
  conferir(r.difChina > 400, `desenho: a lata alta da Fanta da China (com o nome dela) não é a do Arizona recolorida (${r.difChina} pixels diferentes da mesma arte com o nome do Arizona)`)
  conferir(cremeNaCaixa(r.china) < 0.1 && cremeNaCaixa(r.arizona) > 0.35 && cremeNaCaixa(r.chinaComNomeDoArizona) > 0.35, `desenho: o painel creme no meio da lata só no Arizona (creme no meio: Fanta da China ${cr(r.china)}, Arizona ${cr(r.arizona)}, a estampa do Arizona nas cores da Fanta ${cr(r.chinaComNomeDoArizona)})`)
  conferir(r.difOutra > 400 && cremeNaCaixa(r.outraAlta) < 0.1, `desenho: outra lata alta (nem Arizona nem Fanta) sem as flores nem o painel, só os filetes (${r.difOutra} pixels diferentes da estampa do Arizona, creme no meio ${cr(r.outraAlta)})`)
  conferir(r.apple72 === 0 && r.apple120 > 50, `desenho: o APPLE do Tennessee Apple só onde a fonte cabe inteira (página, 120 px: ${r.apple120} pixels de letreiro; card, 72 px: ${r.apple72}, o filete de sempre)`)
  conferir(r.old72 > 30, `desenho: o Nº 7 do Old No. 7 cabe no card e sai (${r.old72} pixels)`)
}

const ZAP_LOJA = 'https://wa.me/5533991139036?text='
// número de teste (não é da loja): o WhatsApp próprio de MG no painel
const ZAP_MG = '5533988887777'

/**
 * @param {{ browser: import('playwright').Browser, base: string, contexto: Function, conferir: Function, foto: Function,
 *   vigiar: Function, vigiarSemRede: Function, clicar: Function, digitar: Function }} h
 */
export async function rodadaLoja({ browser, base, contexto, conferir, foto, vigiar, vigiarSemRede, clicar, digitar }) {
  // o dia da semana de Brasília (o fuso do navegador do teste e o da loja): perto da meia-noite UTC o container já
  // está no dia seguinte e a entrega grátis "de hoje" não bateria
  const hoje = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(new Date()))
  const loja = lojaDaSemente()
  const est = (uf) => loja.estados.find((e) => e.uf === uf)
  const prod = (id) => loja.produtos.find((p) => p.id === id)
  // o dono no painel: BA ativada (Salvador, só Pix, emblema de pino), OCB contada em MG (restam 2), story de MG
  // escolhido, WhatsApp próprio em MG, entrega grátis de SP em dois dias (hoje e amanhã) e a frase do story nova
  loja.estados.push({
    uf: 'ba',
    nome: 'Bahia',
    destaque: 'DELIVERY BA',
    nomePerfil: null,
    cidades: [{ slug: 'salvador', nome: 'Salvador' }],
    instagram: 'greencheese_importsba',
    whatsapp: null,
    horario: { semana: [null, null, null, null, null, null, null], demo: true },
    taxaEntrega: { valor: null, demo: false },
    entregaGratis: null,
    pagamento: { opcoes: ['pix'], demo: false },
    emblema: 'generico',
  })
  for (const p of loja.produtos) p.disponivel.ba = ['seda-ocb-premium-slim', 'isqueiro-clipper', 'piteira-de-papel-raw'].includes(p.id)
  prod('seda-ocb-premium-slim').restam = { mg: 2 }
  loja.stories = { mg: ['piteira-de-papel-raw', 'seda-ocb-premium-slim'] }
  est('mg').whatsapp = ZAP_MG
  est('sp').entregaGratis = { diaSemana: hoje, dias: [hoje, (hoje + 1) % 7], texto: 'Entrega grátis no fim de semana!', demo: false }
  loja.textos = { ...loja.textos, fraseStory: 'Vem que tem!' }

  const servidor = { modo: 'ok', versao: 7, em: new Date(Date.now() - 3 * 60_000).toISOString(), loja, pedidos: 0 }
  const responder = (route) => {
    if (servidor.modo === 'fora') return route.fulfill({ status: 502, contentType: 'text/html', body: 'Bad gateway' })
    if (servidor.modo === 'sem-loja') return route.fulfill({ status: 404, json: { ok: false, erro: 'sem-loja', mensagem: 'A loja ainda não foi montada no servidor.' } })
    if (servidor.modo === 'torto') return route.fulfill({ json: { ok: true, versao: 999, atualizadoEm: new Date().toISOString(), loja: { estados: [] } } })
    servidor.pedidos++
    return route.fulfill({ json: { ok: true, versao: servidor.versao, atualizadoEm: servidor.em, loja: servidor.loja }, headers: { 'Cache-Control': 'no-cache', ETag: `"${servidor.versao}"` } })
  }
  const guardada = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.versao ?? null)
  /** Espera a condição na página (a loja troca num respiro do navegador, depois de chegar). */
  const esperar = (page, f, arg, ms = 6000) => page.waitForFunction(f, arg, { timeout: ms }).then(() => true, () => false)

  const ctx = await contexto(browser, { width: 390, height: 844 })
  await ctx.route(/\/api\/index\.php\?r=loja(&|$)/, responder)
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
      sessionStorage.setItem('gc-abertura', '1')
      sessionStorage.setItem('gc-dica-hero', '1')
    } catch {
      /* ignora */
    }
  })
  const page = await ctx.newPage()
  // o 502 e o 404 que a rodada provoca no fim aparecem no console como falha de rede (o resto não pode ter erro)
  vigiarSemRede(page, 'loja')

  // ── MG: a loja do servidor troca a embutida ──
  await page.goto(`${base}?uf=mg`)
  conferir(await esperar(page, () => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.versao === 7), 'loja: a resposta do servidor fica guardada no aparelho (gc-loja, versão 7)')
  conferir(await esperar(page, () => document.querySelector('.hero-story.na-rua') && document.querySelectorAll('.hero-barras .story-barra').length === 3), 'loja: MG, story do Início com a rua e os 2 escolhidos pelo dono (3 barrinhas)')
  const nomes = []
  for (let i = 0; i < 3; i++) {
    nomes.push(await page.evaluate(() => (document.querySelector('.hero-story.na-rua') ? 'rua' : (document.querySelector('.hero-palco .sq-nome')?.textContent ?? '?'))))
    await page.locator('.hero-quadro').first().click({ position: { x: 370, y: 300 } })
    await page.waitForTimeout(700)
  }
  conferir(JSON.stringify(nomes) === JSON.stringify(['rua', 'Piteira de papel RAW', 'Seda OCB Premium Slim']), `loja: a ordem do dono depois da rua (${nomes.join(' → ')})`)
  {
    // a Home 2 (?home=2) no mesmo aparelho: o story só com os 2 do dono, sem a rua, e a rua no fim do Início
    const h2 = await ctx.newPage()
    vigiarSemRede(h2, 'loja-home2')
    await h2.goto(`${base}?home=2&uf=mg`)
    conferir(
      await esperar(h2, () => document.querySelectorAll('.hero-barras .story-barra').length === 2 && !document.querySelector('.hero .rua, .hero .rua-vaga, .rua-story') && !!document.querySelector('.vista-inicio .rua-fim .rua-vaga')),
      'loja: Home 2, MG, story do Início com os 2 escolhidos pelo dono (2 barrinhas, sem a rua) e a rua no fim do Início',
    )
    const nomesH2 = []
    for (let i = 0; i < 3; i++) {
      nomesH2.push(await h2.evaluate(() => document.querySelector('.hero-palco .sq-nome')?.textContent ?? '?'))
      await h2.locator('.hero-quadro').first().click({ position: { x: 370, y: 300 } })
      await h2.waitForTimeout(700)
    }
    conferir(JSON.stringify(nomesH2) === JSON.stringify(['Piteira de papel RAW', 'Seda OCB Premium Slim', 'Piteira de papel RAW']), `loja: Home 2, a ordem do dono, dando a volta (${nomesH2.join(' → ')})`)
    await h2.close()
  }
  // de volta na OCB (o 3º): o adesivo do estoque no story do Início
  await page.locator('.hero-quadro').first().click({ position: { x: 20, y: 300 } })
  await page.waitForTimeout(700)
  conferir((await page.locator('.hero-palco .sq-restam').textContent().catch(() => null)) === 'RESTAM 2', 'loja: "RESTAM 2" no story do Início')
  await foto(page, 'loja-01-story-restam')
  const frase = (await page.locator('.hero-frase .adesivo-texto').textContent())?.trim()
  conferir(frase === (est('mg').entregaGratis?.dias.includes(hoje) ? est('mg').entregaGratis.texto : 'Vem que tem!'), `loja: a frase do story é a do painel (ou a da entrega grátis de hoje): "${frase}"`)

  // o card da grade
  const card = page.locator('.vista-inicio .card').filter({ hasText: 'Seda OCB Premium Slim' }).first()
  await card.scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  conferir((await card.locator('.sq-restam').textContent().catch(() => null)) === 'RESTAM 2', 'loja: "RESTAM 2" no card da grade')
  conferir(/restam 2\. Abrir story/.test((await card.locator('button').first().getAttribute('aria-label')) ?? ''), 'loja: o card diz "restam 2" pro leitor de tela')
  conferir((await page.locator('.vista-inicio .card').filter({ hasText: 'Isqueiro Clipper' }).locator('.sq-restam').count()) === 0, 'loja: sem estoque contado, sem adesivo')
  await foto(page, 'loja-02-card-restam')

  // a página do produto: "Só restam 2", a quantidade não passa do que resta, e avisa
  await page.goto(`${base}?uf=mg&produto=seda-ocb-premium-slim`)
  await page.locator('.pp-disp-restam').waitFor({ timeout: 6000 }).catch(() => {})
  conferir((await page.locator('.pp-disp-restam').textContent().catch(() => null)) === 'Só restam 2 unidades', 'loja: página do produto com "Só restam 2 unidades"')
  conferir((await page.locator('.pp-restam .adesivo-restam').textContent().catch(() => null)) === 'RESTAM 2', 'loja: o adesivo "RESTAM 2" na arte da página')
  conferir(await page.getByRole('radio', { name: /3 por R\$ 19,99/ }).isDisabled().catch(() => false), 'loja: o combo de 3 apaga (só restam 2)')
  const mais = page.locator('.pp-qtd').getByRole('button', { name: 'Mais um' })
  await mais.click()
  conferir(await mais.isDisabled(), 'loja: o "+" para no 2')
  await page.getByRole('button', { name: /Pôr na sacola/ }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /Pôr na sacola/ }).click()
  conferir(await esperar(page, () => /As 2 que restam aqui já tão na tua sacola/.test(document.querySelector('.aviso')?.textContent ?? '')), 'loja: com as 2 na sacola, adicionar de novo só avisa')
  await foto(page, 'loja-03-produto-restam')
  const naSacola = await page.evaluate(() => JSON.parse(localStorage.getItem('gc-sacola') || 'null')?.state?.itens ?? [])
  conferir(naSacola.length === 1 && naSacola[0].qtd === 2, `loja: a sacola ficou com 2 (${JSON.stringify(naSacola)})`)

  // o pedido de MG fecha no WhatsApp próprio de MG
  const fecharPedido = async () => {
    await page.goto(`${base}?uf=mg`)
    await page.waitForTimeout(1200)
    await page.locator('.barra-abas [data-aba="sacola"]').click()
    await page.locator('.sacola-guiado').getByRole('button', { name: 'Pedido guiado', exact: true }).click()
    await page.waitForTimeout(700)
    await clicar(page, 'Isso')
    await clicar(page, 'Tá certo')
    await digitar(page, 'Ian Teste')
    await digitar(page, '39800000')
    await page.waitForTimeout(500)
    await digitar(page, '120')
    await clicar(page, 'Pix')
    await digitar(page, 'Portão azul')
    await page.waitForTimeout(500)
    return page.getByRole('link', { name: 'Fechar pedido no WhatsApp' }).getAttribute('href')
  }
  let zap = await fecharPedido()
  conferir(zap?.startsWith(`https://wa.me/${ZAP_MG}?text=`), `loja: o pedido de MG fecha no WhatsApp próprio de MG (${zap?.slice(0, 40)}…)`)
  conferir(/^2x Seda OCB Premium Slim — R\$ 14,99$/m.test(decodeURIComponent(zap?.split('text=')[1] ?? '')), 'loja: a mensagem leva as 2 que restam, no combo')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  // ── SP: entrega grátis em mais de um dia (a frase fica nos produtos; a rua tem o adesivo dela) ──
  await page.goto(`${base}?uf=sp`)
  await esperar(page, () => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.versao === 7 && !!document.querySelector('.hero-story.na-rua'))
  await page.locator('.hero-quadro').first().click({ position: { x: 370, y: 300 } })
  conferir(await esperar(page, () => document.querySelector('.hero-frase .adesivo-texto')?.textContent?.trim() === 'Entrega grátis no fim de semana!'), 'loja: SP com entrega grátis hoje e amanhã: a frase dela no story')

  // ── BA: estado ativado no painel (primeira visita, sem nada guardado) ──
  const ba = await ctx.newPage()
  vigiarSemRede(ba, 'loja-ba')
  await ba.addInitScript(() => {
    if (!sessionStorage.getItem('gc-limpo')) {
      localStorage.removeItem('gc-loja')
      localStorage.removeItem('gc-local')
      sessionStorage.setItem('gc-limpo', '1')
    }
  })
  let semAtendimento = false
  await ba.goto(`${base}?uf=ba`)
  // a tela de sem atendimento nunca pisca enquanto a loja do servidor chega
  for (let i = 0; i < 12; i++) {
    if (await ba.locator('.sem').count()) semAtendimento = true
    await ba.waitForTimeout(150)
  }
  conferir(!semAtendimento, 'loja: BA (ativada no painel) nunca mostra "ainda não chegou aí" enquanto a loja chega')
  conferir(await esperar(ba, () => document.querySelector('.hero .story-cab-nome')?.textContent === 'greencheese_importsba'), 'loja: BA com o story do perfil dela')
  conferir((await ba.locator('.hero-cab-local').textContent().catch(() => ''))?.includes('Salvador'), 'loja: BA com a cidade cadastrada (Salvador, a única)')
  await foto(ba, 'loja-04-ba-inicio')
  conferir(/@greencheese_importsba/.test((await ba.locator('.vista-inicio .faixa').textContent()) ?? ''), 'loja: o @ da BA na faixa')
  await ba.getByRole('button', { name: 'DELIVERY BA: atendimento, horário e entrega' }).first().click()
  await ba.locator('.info-emblema').waitFor({ timeout: 5000 }).catch(() => {})
  conferir((await ba.locator('.info-emblema').count()) === 1, 'loja: o story do estado da BA com o emblema de pino')
  await foto(ba, 'loja-05-ba-info')
  await ba.keyboard.press('Escape')
  await ba.waitForTimeout(500)
  await ba.locator('[data-aba="estados"]:visible').first().click()
  await ba.locator('.vista:not([hidden]) #estados').waitFor({ timeout: 5000 })
  await ba.waitForTimeout(800)
  const lista = await ba.locator('.vista:not([hidden]) .pe-contas-lista').first().textContent()
  conferir(/greencheese_importsba/.test(lista ?? ''), 'loja: Por estado com o perfil da BA')
  await foto(ba, 'loja-06-ba-por-estado')
  conferir(/greencheese_importsba/.test((await ba.locator('.rodape').textContent()) ?? ''), 'loja: o rodapé com o @ da BA')

  // ── RJ: o material da loja de 11/10 (na semente): os 2 novos à venda só no RJ, com "Consultar" (MG: indisponíveis); os
  // 4 do material (a Fanta Ghost Face, o Hennessy, o Jack Apple e a Fanta da China) no desenho do site, como o resto do
  // catálogo (pedido do Ian em 15/10: nada da foto nem da thumb animada de fábrica); e a thumb animada continua: um
  // produto com vídeo no GET loja mostra a capa no card, sem o halo pontilhado, com a thumb que o dono subiu (uploads/:
  // a Piteira de vidro) e com a de fábrica, que continua no build e o dono pode ligar pela API (produtos/: o Dr Pepper;
  // e é o que a loja guardada nos aparelhos ainda traz até pegar a nova), só nesta parte ──
  {
    const vidro = prod('piteira-de-vidro-raw')
    vidro.video = 'uploads/thumbdaloja01.webm'
    vidro.capa = 'uploads/capadaloja01.png'
    const drPepper = prod('dr-pepper')
    drPepper.video = 'produtos/hennessy-very-special.mp4'
    drPepper.capa = 'produtos/hennessy-very-special-capa.webp'
    const ctxRj = await contexto(browser, { width: 390, height: 844 })
    await ctxRj.route(/\/api\/index\.php\?r=loja(&|$)/, responder)
    // a capa é uma imagem pequena; o vídeo fica baixando (não chega): a capa não sai do card enquanto a rodada olha
    const capaPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    await ctxRj.route(/\/uploads\/capadaloja01\.png$/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: capaPng }))
    await ctxRj.route(/\/uploads\/thumbdaloja01\.webm$/, () => {})
    await ctxRj.addInitScript(() => {
      try {
        localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
        sessionStorage.setItem('gc-abertura', '1')
        sessionStorage.setItem('gc-dica-hero', '1')
      } catch {
        /* ignora */
      }
    })
    const rj = await ctxRj.newPage()
    vigiarSemRede(rj, 'loja-rj')
    const cards = async (uf) => {
      await rj.goto(`${base}?uf=${uf}`)
      await esperar(rj, () => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.versao === 7)
      await rj.locator('.vista-inicio .catalogo-inicio .grade').waitFor({ timeout: 8000 }).catch(() => {})
      // as ilustrações vêm num pedaço à parte: até ele chegar, o card mostra a arte em pixel por cima do halo
      await esperar(rj, () => !!document.querySelector('.vista-inicio .catalogo-inicio .grade svg.pv-real'), undefined, 10000)
      await rj.waitForTimeout(400)
      return rj.evaluate(() =>
        Object.fromEntries(
          [...document.querySelectorAll('.vista-inicio .catalogo-inicio .grade > .card[data-flip-id]')].map((li) => [
            li.getAttribute('data-flip-id'),
            {
              off: li.classList.contains('card-off'),
              preco: li.querySelector('.sq-preco')?.textContent ?? '',
              img: li.querySelector('img')?.getAttribute('src') ?? '',
              video: !!li.querySelector('video'),
              halo: !!li.querySelector('.pv.pv-com-halo'),
              // o desenho do site: a ilustração (svg) ou, sem ela, a arte em pixel do produto (canvas)
              desenho: li.querySelector('svg.pv-real') ? 'ilustracao' : li.querySelector('.arte-produto canvas') ? 'pixel' : '',
            },
          ]),
        ),
      )
    }
    const noRj = await cards('rj')
    for (const id of ['jack-daniels-tennessee-apple', 'fanta-maca-china']) {
      const c = noRj[id]
      conferir(!!c && !c.off && c.preco === 'Consultar', `loja: RJ, ${id} à venda e "Consultar" (${JSON.stringify(c)})`)
    }
    // os 4 do material de 11/10 no desenho, como os outros: nenhuma imagem (nem a foto nem a capa de fábrica) e nenhum vídeo
    for (const id of ['fanta-ghost-face-punch', 'hennessy-very-special', 'jack-daniels-tennessee-apple', 'fanta-maca-china']) {
      const c = noRj[id]
      conferir(!!c && c.img === '' && !c.video && !!c.desenho, `loja: RJ, ${id} no desenho do site, sem foto e sem thumb de fábrica (${JSON.stringify(c)})`)
    }
    // e na ilustração, como as outras 17: o Jack Apple e a Fanta da China ganharam a deles (na arte em pixel ficavam
    // fora do padrão de novo)
    const quatro = ['fanta-ghost-face-punch', 'hennessy-very-special', 'jack-daniels-tennessee-apple', 'fanta-maca-china']
    conferir(quatro.every((id) => noRj[id]?.desenho === 'ilustracao'), `loja: RJ, os 4 na ilustração do site, como o resto do catálogo (${quatro.map((id) => `${id}: ${noRj[id]?.desenho}`).join(', ')})`)
    conferir(Object.values(noRj).every((c) => c.desenho !== 'pixel'), `loja: RJ, nenhum card da grade na arte em pixel (${Object.entries(noRj).filter(([, c]) => c.desenho === 'pixel').map(([id]) => id).join(', ')})`)
    // a mesma cara do resto da grade: o desenho com o halo pontilhado (e nenhum card da grade com foto de fábrica)
    conferir(['hennessy-very-special', 'jack-daniels-old-no7-1l', 'coca-cola-vanilla'].every((id) => noRj[id]?.desenho === 'ilustracao' && noRj[id]?.halo), `loja: RJ, o Hennessy no desenho com o halo, igual ao Jack Old No. 7 e à Coca (${JSON.stringify([noRj['hennessy-very-special'], noRj['jack-daniels-old-no7-1l']])})`)
    conferir(quatro.every((id) => !/produtos\//.test(noRj[id]?.img ?? '')), 'loja: RJ, nenhum dos 4 com mídia de fábrica (produtos/)')
    // a thumb animada (quadro sobre preto, sem transparência) sem o halo, que vazava pelo escuro do produto; o desenho, com
    const pv = noRj['piteira-de-vidro-raw']
    conferir(!!pv && pv.img.endsWith('uploads/capadaloja01.png') && pv.halo === false, `loja: o produto com a thumb animada do dono (uploads/) no GET loja mostra a capa no card, sem o halo pontilhado (${JSON.stringify(pv)})`)
    const dp = noRj['dr-pepper']
    conferir(!!dp && dp.img.endsWith('produtos/hennessy-very-special-capa.webp') && dp.halo === false && !dp.desenho, `loja: o produto com a thumb animada de fábrica (produtos/, o vídeo e a capa que estão no build) mostra a capa de fábrica no card, sem o halo pontilhado (${JSON.stringify(dp)})`)
    await foto(rj, 'loja-04b-rj-novos')
    const noMg = await cards('mg')
    conferir(noMg['jack-daniels-tennessee-apple']?.off === true && noMg['fanta-maca-china']?.off === true, 'loja: MG, os 2 novos indisponíveis (só RJ)')
    conferir(noMg['fanta-ghost-face-punch']?.desenho === 'ilustracao' && noMg['fanta-ghost-face-punch']?.halo && noMg['fanta-ghost-face-punch']?.img === '', `loja: MG, a Fanta Ghost Face de volta na ilustração de antes, com o halo (${JSON.stringify(noMg['fanta-ghost-face-punch'])})`)
    await ctxRj.close()
    delete vidro.video
    delete vidro.capa
    delete drPepper.video
    delete drPepper.capa
  }

  // ── a arte em pixel da lata alta (a do chiado da revelação, a da espera da ilustração e a da vitrine da rua): a Fanta
  // da China tem a estampa dela, não a do Arizona recolorida (achado da revisão de 15/10) ──
  await desenhoDoNome({ browser, conferir })
  {
    // as ilustrações seguradas (4G lento ou o pedaço que falhou): a grade fica na arte em pixel, que é a que aparece
    const ctxPx = await contexto(browser, { width: 390, height: 844 })
    await ctxPx.route(/\/api\/index\.php\?r=loja(&|$)/, responder)
    await ctxPx.route(/\/assets\/realista-[\w-]+\.js$/, () => {})
    await ctxPx.addInitScript(() => {
      try {
        localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
        sessionStorage.setItem('gc-abertura', '1')
        sessionStorage.setItem('gc-dica-hero', '1')
      } catch {
        /* ignora */
      }
    })
    const px = await ctxPx.newPage()
    vigiarSemRede(px, 'loja-rj-pixel')
    await px.goto(`${base}?uf=rj`)
    await esperar(px, () => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.versao === 7)
    const sel = (id) => `.vista-inicio .catalogo-inicio .grade > .card[data-flip-id="${id}"] .arte-produto .arte-quadro > canvas`
    for (const id of ['fanta-maca-china', 'arizona-green-tea']) {
      await px.locator(sel(id)).scrollIntoViewIfNeeded().catch(() => {})
      await esperar(px, (s) => (document.querySelector(s)?.width ?? 1) > 1, sel(id), 10000)
    }
    // a revelação (chiado → pixel) termina antes de olhar
    await px.waitForTimeout(1600)
    const cards = await px.evaluate(
      ({ ids, sel }) =>
        Object.fromEntries(
          ids.map((id) => {
            const c = document.querySelector(sel.replace('§', id))
            if (!c || c.width < 8) return [id, null]
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
            return [id, { w: c.width, h: c.height, d: Array.from(d) }]
          }),
        ),
      { ids: ['fanta-maca-china', 'arizona-green-tea'], sel: sel('§') },
    )
    const china = cards['fanta-maca-china']
    const arizona = cards['arizona-green-tea']
    const fc = china && cremeNaCaixa(china)
    const fa = arizona && cremeNaCaixa(arizona)
    conferir(!!china && !!arizona && fa > 0.3 && fc < 0.1, `loja: RJ com as ilustrações seguradas, a Fanta da China em pixel sem o painel creme do Arizona no meio da lata (creme no meio: Fanta ${fc?.toFixed(2)}, Arizona ${fa?.toFixed(2)})`)
    const iou = china && arizona && iouDoCreme(china, arizona)
    conferir(iou != null && iou < 0.4, `loja: RJ, o claro da Fanta da China em pixel (o logo e a maçã) não cai onde fica o do Arizona (o painel e os filetes): sobreposição ${iou?.toFixed(2)}`)
    await foto(px, 'loja-04c-rj-pixel')
    await ctxPx.close()
  }

  // ── a loja muda de novo: o Teste minha sorte desligado, "o mesmo WhatsApp pra todos", a rua desligada ──
  servidor.versao = 8
  servidor.em = new Date().toISOString()
  servidor.loja = { ...loja, ruaNoStory: false, estados: loja.estados.map((e) => ({ ...e, whatsapp: null })), sorte: { ...loja.sorte, ligado: false } }
  await page.goto(`${base}?uf=mg&jogo=sorte`)
  conferir(await esperar(page, () => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.versao === 8), 'loja: a versão nova chega e fica guardada')
  conferir(await esperar(page, () => !document.querySelector('.barra-abas [data-aba="sorte"]') && !document.querySelector('.hero-story.na-rua') && !!document.querySelector('.hero-palco .sq-nome')), 'loja: Teste minha sorte desligado (some da barra) e o Início do celular sem a rua')
  conferir(!(await page.locator('.casca').count()) && !new URL(page.url()).searchParams.has('jogo'), 'loja: ?jogo=sorte com o jogo desligado: nada abre e o parâmetro sai')
  conferir((await page.locator('.hero-palco .sq-nome').textContent()) === 'Piteira de papel RAW', 'loja: sem a rua, o story começa no 1º do dono')
  await foto(page, 'loja-07-sem-rua-sem-sorte')
  {
    // a Home 2 com a rua desligada: o fim do Início sem ela (a grade e logo o rodapé)
    const h2 = await ctx.newPage()
    vigiarSemRede(h2, 'loja-home2-sem-rua')
    await h2.goto(`${base}?home=2&uf=mg`)
    conferir(
      await esperar(h2, () => !document.querySelector('.vista-inicio .rua-fim, .vista-inicio .rua-vaga, .vista-inicio .rua, .rua-story') && !!document.querySelector('.hero-palco .sq-nome')),
      'loja: Home 2 com a rua desligada: o Início do celular sem a rua (nem no story nem no fim)',
    )
    const fim = await h2.evaluate(() => {
      const g = document.querySelector('.vista-inicio .catalogo-inicio')?.getBoundingClientRect()
      const r = document.querySelector('.rodape')?.getBoundingClientRect()
      return g && r ? Math.round(r.top - g.bottom) : null
    })
    conferir(fim != null && fim >= -1 && fim <= 2, `loja: Home 2 sem a rua, o rodapé vem logo depois da grade (${fim} px)`)
    await h2.close()
  }
  zap = await fecharPedido()
  conferir(zap?.startsWith(ZAP_LOJA), `loja: "o mesmo WhatsApp pra todos": o pedido de MG fecha no da loja (${zap?.slice(0, 40)}…)`)
  await page.keyboard.press('Escape')

  // ── servidor fora do ar: a loja guardada vale (BA continua no site, sem esperar) ──
  servidor.modo = 'fora'
  await ba.goto(`${base}?uf=ba`)
  await ba.waitForTimeout(400)
  conferir((await ba.locator('.sem').count()) === 0 && (await ba.locator('.hero .story-cab-nome').textContent().catch(() => '')) === 'greencheese_importsba', 'loja: servidor fora do ar: a loja guardada no aparelho abre na hora (BA no site)')
  // resposta torta: ignorada
  servidor.modo = 'torto'
  await ba.reload()
  await ba.waitForTimeout(1500)
  conferir((await guardada(ba)) === 8 && (await ba.locator('.sem').count()) === 0, 'loja: resposta torta do servidor não troca nada (fica a versão 8)')

  // loja guardada por outro build (o formato velho, só a resposta crua) com o servidor fora: a primeira tela sai com a
  // embutida, a guardada é conferida no pedaço à parte e entra (a BA volta sem a tela de sem atendimento piscar)
  servidor.modo = 'fora'
  await ba.evaluate((l) => localStorage.setItem('gc-loja', JSON.stringify({ formato: 1, versao: 6, atualizadoEm: new Date().toISOString(), loja: l })), loja)
  await ba.reload()
  let piscou = false
  for (let i = 0; i < 10; i++) {
    if (await ba.locator('.sem').count()) piscou = true
    await ba.waitForTimeout(150)
  }
  conferir(!piscou && (await esperar(ba, () => document.querySelector('.hero .story-cab-nome')?.textContent === 'greencheese_importsba')), 'loja: guardada por outro build, com o servidor fora: conferida de novo e a BA abre (sem "ainda não chegou aí")')
  conferir(await esperar(ba, () => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.formato === 3), 'loja: a guardada é regravada já conferida por este build (formato 3, com a frequência e as chances do Teste minha sorte)')
  // guardada (já conferida) por outro build: abre a primeira tela na hora e é conferida de novo por este
  await ba.evaluate(() => {
    const g = JSON.parse(localStorage.getItem('gc-loja'))
    localStorage.setItem('gc-loja', JSON.stringify({ ...g, build: 'outro-build' }))
  })
  await ba.reload()
  await ba.waitForTimeout(300)
  conferir((await ba.locator('.hero .story-cab-nome').textContent().catch(() => '')) === 'greencheese_importsba', 'loja: guardada por outro build: a pronta abre a primeira tela na hora (BA)')
  conferir(await esperar(ba, () => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.build !== 'outro-build'), 'loja: e é conferida de novo e regravada por este build')

  // ── a BA sai do site: quem estava nela vê a tela de sem atendimento ──
  servidor.modo = 'ok'
  servidor.versao = 9
  servidor.loja = { ...servidor.loja, estados: servidor.loja.estados.filter((e) => e.uf !== 'ba') }
  await ba.reload()
  conferir(await esperar(ba, () => !!document.querySelector('.sem')), 'loja: estado tirado do site: quem tava nele vê "ainda não chegou aí"')
  await foto(ba, 'loja-08-ba-saiu')

  // ── 404 sem-loja (painel ainda não instalado): volta pra embutida e esquece a guardada ──
  servidor.modo = 'sem-loja'
  await page.goto(`${base}?uf=mg`)
  conferir(await esperar(page, () => localStorage.getItem('gc-loja') === null), 'loja: 404 sem-loja apaga a loja guardada')
  // a rua volta pra conta do story (sem trocar o produto que tá na tela) e a Sorte volta pra barra
  conferir(await esperar(page, () => !!document.querySelector('.vista-inicio .rua-story') && document.querySelectorAll('.hero-barras .story-barra').length === 9 && !!document.querySelector('.barra-abas [data-aba="sorte"]')), 'loja: 404 sem-loja: volta pra embutida (a rua e a Sorte de volta)')
  {
    // na Home 2, a rua volta pro fim do Início e o story pro automático (8 barrinhas, só produtos)
    const h2 = await ctx.newPage()
    vigiarSemRede(h2, 'loja-home2-sem-loja')
    await h2.goto(`${base}?home=2&uf=mg`)
    conferir(
      await esperar(h2, () => !!document.querySelector('.vista-inicio .rua-fim .rua-vaga') && document.querySelectorAll('.hero-barras .story-barra').length === 8 && !document.querySelector('.hero .rua, .rua-story') && !!document.querySelector('.barra-abas [data-aba="sorte"]')),
      'loja: 404 sem-loja na Home 2: volta pra embutida (a rua no fim do Início e a Sorte de volta)',
    )
    await h2.close()
  }
  // ── o Teste minha sorte com a frequência do dono (2 giros por semana): o jogo fala da semana, não do dia ──
  servidor.modo = 'ok'
  servidor.versao = 10
  servidor.em = new Date().toISOString()
  servidor.loja = { ...servidor.loja, sorte: { ...loja.sorte, ligado: true, regras: { ...loja.sorte.regras, intervaloDias: 7, girosPorIntervalo: 2, girosPorDiaComConta: 2 } } }
  {
    const sp = await ctx.newPage()
    vigiar(sp, 'loja-sorte-semana')
    await sp.goto(`${base}?uf=mg&jogo=sorte`)
    conferir(await esperar(sp, () => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.loja?.sorte?.regras?.intervaloDias === 7, undefined, 8000), 'loja: a frequência do dono (a cada 7 dias) chega e fica guardada')
    const rodape = (await esperar(sp, () => /Com conta:/.test(document.querySelector('.casca .sorte-rodape')?.textContent ?? ''), undefined, 8000))
      ? ((await sp.locator('.casca .sorte-rodape').first().textContent()) ?? '')
      : ''
    conferir(rodape.includes('Com conta: 2 giros por semana.') && !/por dia/.test(rodape), `loja: Teste minha sorte com 2 giros por semana: o jogo diz "2 giros por semana" (${rodape.slice(0, 90)})`)
    await sp.close()
  }

  conferir(servidor.pedidos >= 4, `loja: o site perguntou a loja a cada abertura (${servidor.pedidos} pedidos)`)
  await ctx.close()
}
