// A taxa de entrega por bairro no site (rodada do scripts/revisao.mjs; pedido do Ian em 22/10), com o GET loja simulado
// no formato do API.md: o RJ cobra por bairro e a lista aparece no site; o ES cobra por bairro e o cliente consulta; MG
// segue com uma taxa só. Nos celulares (360×740 e 390×844) e no computador:
// - a sacola: "Teu bairro" (opcional) sugere os bairros da lista enquanto digita (à vista, sem o rodapé cobrir), mostra a
//   taxa e o total com ela; fora da lista, "a consultar" (e nada disso enquanto o começo digitado ainda acha bairro); a
//   mensagem do WhatsApp diz o bairro e a taxa, e a cópia que vai pro servidor leva o bairro e a taxa;
// - o story de atendimento: a busca "Qual a taxa do meu bairro?" no quadro da entrega, que para o story enquanto a
//   pessoa digita e lê; o bairro é o mesmo da sacola (fica guardado no aparelho);
// - o modo consulta: sem valor nenhum, "a taxa depende do bairro" e o "Perguntar no WhatsApp" com a frase pronta;
// - o estado de uma taxa só (MG): nada muda;
// - o pedido guiado: o bairro do CEP ("Copacabana") casa com a lista e a taxa vai na mensagem;
// - o site guardado no celular de antes (a loja guardada sem o campo novo) abre igual.
// Da revisão de 22/10 (o corretor): o estado com duas cidades e o cliente sem cidade (a sugestão diz a cidade e nunca
// responde "não tá na lista" depois), o rótulo da busca no story (não passa o quadro), o teclado na sugestão (Tab, ↓ e
// Enter), o "Total com a entrega" com o pedido mínimo (o mínimo conta só os produtos), o dia de entrega grátis (sem o
// bairro guardado na mensagem) e o pedido guiado sem CEP (o bairro escrito no endereço vale mais que o guardado).
// Da junção com o cupom direto (22/10): o cupom que entrou sozinho e o "Teu bairro" na mesma sacola, em 360 e 390.
// Da revisão da junção (22/10): depois do pedido guiado, o cartão "Confere a sacola" e a sacola dizem a entrega da
// mensagem (o bairro do endereço, guardado no aparelho; a sacola sem o campo), e trocar o cupom é pedido novo.
import { lojaDaSemente } from './revisao-loja.mjs'

const ZAP = 'https://wa.me/5533991139036?text='
const semNbsp = (s) => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
const mensagemDo = (href) => decodeURIComponent((href ?? '').split('text=')[1] ?? '')
const linhaEntrega = (href) => mensagemDo(href).split('\n').find((l) => l.startsWith('Entrega:')) ?? null

/**
 * @param {{ browser: import('playwright').Browser, base: string, contexto: Function, conferir: Function, foto: Function,
 *   vigiarSemRede: Function, clicar: Function, digitar: Function }} h
 */
export async function rodadaBairros({ browser, base, contexto, conferir, foto, vigiarSemRede, clicar, digitar }) {
  const loja = lojaDaSemente()
  const est = (uf) => loja.estados.find((e) => e.uf === uf)
  const aberto = { semana: Array.from({ length: 7 }, () => ['00:00', '23:59']), demo: false }
  Object.assign(est('rj'), {
    horario: aberto,
    taxaEntrega: { valor: null, demo: false },
    taxaPorBairro: {
      modo: 'site',
      bairros: [
        { nome: 'Copacabana', taxa: 12 },
        { nome: 'Ipanema', taxa: 12.5 },
        { nome: 'Leblon', taxa: 15 },
        { nome: 'Botafogo', taxa: 10 },
        { nome: 'Tijuca', taxa: null },
        { nome: 'Lapa', taxa: 0 },
      ],
    },
  })
  Object.assign(est('es'), { horario: aberto, cidades: [{ slug: 'vila-velha', nome: 'Vila Velha' }], taxaEntrega: { valor: null, demo: false }, taxaPorBairro: { modo: 'consulta' } })
  const doEstado = (uf) => loja.produtos.filter((p) => p.disponivel[uf] && p.preco != null)
  const recebidos = []

  const montar = async (viewport, lojaUsada = loja) => {
    const ctx = await contexto(browser, viewport)
    await ctx.route(/\/api\/index\.php\?r=loja(&|$)/, (r) =>
      r.fulfill({ json: { ok: true, versao: 22, atualizadoEm: '2026-10-22T12:00:00.000Z', loja: lojaUsada }, headers: { 'Cache-Control': 'no-cache', ETag: '"22"' } }),
    )
    await ctx.route('**/api/index.php?r=pedido', async (route) => {
      const req = route.request()
      if (req.method() !== 'POST') return route.fallback()
      let c = null
      try {
        c = JSON.parse(req.postData() ?? '')
      } catch {
        c = null
      }
      recebidos.push(c)
      return route.fulfill({ status: 201, json: { ok: true, pedido: { codigo: c?.codigo, tipo: c?.tipo, status: 'novo', criadoEm: new Date().toISOString() } } })
    })
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
        sessionStorage.setItem('gc-abertura', '1')
        sessionStorage.setItem('gc-dica-hero', '1')
      } catch {
        /* ignora */
      }
      // o toque no WhatsApp fica no site (aqui não tem WhatsApp): guarda o link que abriria
      document.addEventListener(
        'click',
        (e) => {
          const a = e.target instanceof Element ? e.target.closest('a[href*="wa.me"]') : null
          if (a) {
            e.preventDefault()
            window.__zap = a.getAttribute('href')
          }
        },
        true,
      )
    })
    return ctx
  }
  const abrirSacola = async (page) => {
    // a volta do WhatsApp (a página recarregada depois do toque) já reabre a sacola, perguntando "Já mandou?"
    if (await page.locator('.sacola-fechar').isVisible().catch(() => false)) return
    await page.locator('.barra-abas [data-aba="sacola"]:visible, .lateral-item:has-text("Sacola"):visible').first().click()
    await page.locator('.sacola-fechar').waitFor({ timeout: 8000 })
    await page.waitForTimeout(500)
  }
  const abrir = async (ctx, uf, ids, nome) => {
    const page = await ctx.newPage()
    vigiarSemRede(page, nome)
    await page.goto(`${base}?uf=${uf}`)
    await page.evaluate((x) => localStorage.setItem('gc-sacola', JSON.stringify({ state: { itens: x.map((id) => ({ id, variacao: null, qtd: 1 })), ultimo: [], cupom: null }, version: 0 })), ids)
    await page.reload()
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.versao === 22, null, { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(500)
    return page
  }
  const fechar = async (page) => {
    await page.evaluate(() => (window.__zap = null))
    await page.locator('a.sacola-zap').click()
    await page.waitForTimeout(400)
    return page.evaluate(() => window.__zap)
  }
  /** O story de atendimento aberto no quadro da entrega (o 3º). */
  const storyNaEntrega = async (page, vp) => {
    await page.locator('[data-destaque="estado"]:visible').first().click()
    await page.locator('#story-info, .story').first().waitFor({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(400)
    for (let k = 0; k < 2; k++) {
      await page
        .locator('.story-seta-dir:visible')
        .first()
        .click({ timeout: 1500 })
        .catch(async () => page.mouse.click(vp.width * 0.85, vp.height * 0.5))
      await page.waitForTimeout(350)
    }
  }

  const rj = doEstado('rj').slice(0, 2)
  const subtotalRj = Math.round(rj.reduce((s, p) => s + p.preco, 0) * 100) / 100
  const brl = (n) => `R$ ${n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`

  for (const [rot, vp] of [
    ['360', { width: 360, height: 740 }],
    ['390', { width: 390, height: 844 }],
    ['computador', { width: 1280, height: 800 }],
  ]) {
    const ctx = await montar(vp)
    const page = await abrir(ctx, 'rj', rj.map((p) => p.id), `bairros-rj-${rot}`)
    await abrirSacola(page)
    // ─── a sacola: "Teu bairro" ───
    const campo = page.locator('#bairro-sacola')
    conferir((await campo.count()) === 1, `bairros ${rot}: a sacola do RJ (por bairro) tem o "Teu bairro"`)
    conferir(semNbsp(await page.locator('.bt-cabeca').textContent()) === 'Entrega: a taxa depende do bairro.', `bairros ${rot}: a sacola diz que a taxa depende do bairro`)
    conferir((await page.locator('.ls-taxa').count()) === 0, `bairros ${rot}: a linha da taxa única sai (o "Teu bairro" fica no lugar dela)`)
    await campo.fill('cop')
    await page.waitForTimeout(400)
    const sug = page.locator('.bt-sugestao')
    conferir((await sug.count()) === 1 && semNbsp(await sug.first().textContent()) === 'Copacabana: R$ 12,00', `bairros ${rot}: digitando "cop", a sugestão "Copacabana: R$ 12,00" (${semNbsp(await sug.first().textContent().catch(() => ''))})`)
    const caixas = await page.evaluate(() => {
      const s = document.querySelector('.bt-sugestoes')?.getBoundingClientRect()
      const r = document.querySelector('.folha-rodape, .sacola-fechar')?.getBoundingClientRect()
      return s && r ? { sug: s.bottom, rodape: r.top } : null
    })
    conferir(!!caixas && caixas.sug <= caixas.rodape + 1, `bairros ${rot}: a sugestão fica à vista, sem o rodapé da sacola por cima (${JSON.stringify(caixas)})`)
    await foto(page, `bairros-${rot}-sacola-sugestao`)
    await sug.first().click()
    await page.waitForTimeout(400)
    const res = semNbsp(await page.locator('.bt-resposta').textContent())
    const total = brl(subtotalRj + 12)
    conferir(res.includes('Taxa do bairro Copacabana: R$ 12,00') && res.includes(`Total com a entrega${total}`), `bairros ${rot}: escolheu Copacabana: a taxa e o total com ela (${total}) ("${res}")`)
    await page.locator('.bt-resposta').scrollIntoViewIfNeeded()
    await foto(page, `bairros-${rot}-sacola-copacabana`)
    const antes = recebidos.length
    const href = await fechar(page)
    conferir(href?.startsWith(ZAP) && linhaEntrega(href) === 'Entrega: Copacabana (taxa R$ 12,00)', `bairros ${rot}: a mensagem do WhatsApp diz o bairro e a taxa ("${linhaEntrega(href)}")`)
    await page.waitForTimeout(600)
    const copia = recebidos[antes]
    conferir(
      copia?.entrega?.bairro === 'Copacabana' && copia?.taxa?.valor === 12 && copia?.taxa?.texto === 'taxa R$ 12,00' && Math.abs((copia?.taxa?.em ?? 0) - Date.now() / 1000) < 300,
      `bairros ${rot}: a cópia do pedido leva o bairro, a taxa que o site mostrou e a hora do toque (${JSON.stringify({ b: copia?.entrega?.bairro, t: copia?.taxa })})`,
    )
    // um começo que ainda acha bairro não é "fora da lista"; o bairro que não tá, é "a consultar"
    await page.locator('.sacola-enviado button, .sacola-guiado-botao').first().waitFor({ timeout: 2000 }).catch(() => {})
    await campo.fill('Ipa')
    await page.waitForTimeout(300)
    conferir(!/não tá na lista/.test(semNbsp(await page.locator('.bt-resposta').textContent())), `bairros ${rot}: digitando "Ipa" (ainda acha Ipanema), nada de "não tá na lista"`)
    await campo.fill('Jacarepaguá')
    await campo.blur()
    await page.waitForTimeout(400)
    conferir(semNbsp(await page.locator('.bt-resposta').textContent()) === 'O bairro Jacarepaguá não tá na lista: a taxa vem no atendimento.', `bairros ${rot}: fora da lista: a consultar (nenhum valor inventado)`)
    await page.locator('.bt-resposta').scrollIntoViewIfNeeded()
    await foto(page, `bairros-${rot}-sacola-fora`)
    conferir(linhaEntrega(await fechar(page)) === 'Entrega: Jacarepaguá (taxa do bairro a consultar)', `bairros ${rot}: fora da lista, a mensagem diz "taxa do bairro a consultar"`)
    await campo.fill('tijuca')
    await campo.blur()
    await page.waitForTimeout(300)
    conferir(semNbsp(await page.locator('.bt-resposta').textContent()) === 'Taxa do bairro Tijuca: a consultar no atendimento.', `bairros ${rot}: bairro marcado "consultar" (o nome como o dono escreveu)`)
    // ─── o story de atendimento: a busca ───
    await page.keyboard.press('Escape')
    await page.waitForTimeout(700)
    await storyNaEntrega(page, vp)
    const busca = page.locator('#bairro-story')
    conferir((await busca.count()) === 1 && (await page.locator('.bt-story .info-grande').textContent()) === 'Taxa por bairro', `bairros ${rot}: o story de atendimento tem a busca "Qual a taxa do meu bairro?" no quadro da entrega`)
    conferir((await busca.inputValue().catch(() => '')) === 'tijuca', `bairros ${rot}: o bairro da sacola já tá na busca do story (guardado no aparelho)`)
    await busca.fill('Leb')
    await page.waitForTimeout(300)
    await foto(page, `bairros-${rot}-story-sugestao`)
    await page.locator('.bt-story .bt-sugestao').first().click()
    await page.waitForTimeout(300)
    conferir(semNbsp(await page.locator('.bt-story .bt-resposta').textContent()) === 'Leblon: R$ 15,00A loja confirma no atendimento.', `bairros ${rot}: a busca acha Leblon: R$ 15,00`)
    await foto(page, `bairros-${rot}-story-leblon`)
    await page.waitForTimeout(5200)
    conferir((await page.locator('#bairro-story').count()) === 1, `bairros ${rot}: o story fica parado na entrega enquanto a pessoa lê a taxa (5 s depois, ainda lá)`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    // o bairro fica guardado: depois de recarregar, a sacola já sabe
    await page.reload()
    await page.waitForTimeout(900)
    await abrirSacola(page)
    conferir((await page.locator('#bairro-sacola').inputValue().catch(() => '')) === 'Leblon', `bairros ${rot}: o bairro fica guardado no aparelho (recarregou: Leblon)`)
    await ctx.close()
  }

  // ─── o modo consulta (ES) e o estado de uma taxa só (MG) ───
  for (const [rot, vp] of [
    ['360', { width: 360, height: 740 }],
    ['computador', { width: 1280, height: 800 }],
  ]) {
    const ctx = await montar(vp)
    const page = await abrir(ctx, 'es', doEstado('es').slice(0, 1).map((p) => p.id), `bairros-es-${rot}`)
    await abrirSacola(page)
    const bloco = page.locator('.bairro-taxa')
    conferir((await bloco.count()) === 1 && !/R\$/.test(semNbsp(await bloco.textContent())), `bairros consulta ${rot}: "a taxa depende do bairro", sem valor nenhum`)
    await page.locator('#bairro-sacola').fill('Praia da Costa')
    await page.waitForTimeout(300)
    const perguntar = page.locator('.bt-perguntar')
    conferir(
      (await perguntar.getAttribute('href')) === `${ZAP}${encodeURIComponent('Oi! Quanto fica a entrega pro bairro Praia da Costa?')}`,
      `bairros consulta ${rot}: o "Perguntar no WhatsApp" abre a conversa do pedido com a frase pronta e o bairro`,
    )
    const caixa = await perguntar.boundingBox()
    conferir(!!caixa && caixa.height <= 50, `bairros consulta ${rot}: o botão cabe numa linha (${Math.round(caixa?.height ?? 0)} px)`)
    await perguntar.scrollIntoViewIfNeeded()
    await foto(page, `bairros-${rot}-consulta-sacola`)
    conferir(linhaEntrega(await fechar(page)) === 'Entrega: taxa a consultar (bairro Praia da Costa)', `bairros consulta ${rot}: a mensagem diz "taxa a consultar (bairro …)"`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(700)
    await storyNaEntrega(page, vp)
    conferir((await page.locator('.bt-story .info-grande').textContent()) === 'A taxa depende do bairro' && (await page.locator('.bt-story .bt-perguntar').count()) === 1, `bairros consulta ${rot}: o story diz que a taxa depende do bairro, com o botão de perguntar`)
    await foto(page, `bairros-${rot}-consulta-story`)
    await ctx.close()
    // MG: uma taxa só, como sempre
    const ctxMg = await montar(vp)
    const mg = await abrir(ctxMg, 'mg', doEstado('mg').slice(0, 1).map((p) => p.id), `bairros-mg-${rot}`)
    await abrirSacola(mg)
    conferir((await mg.locator('.bairro-taxa').count()) === 0 && (await mg.locator('.ls-taxa').count()) >= 1, `bairros ${rot}: em MG (uma taxa só), nada de bairro: a linha da entrega de sempre`)
    conferir(/^Entrega: taxa/.test(linhaEntrega(await fechar(mg)) ?? ''), `bairros ${rot}: a mensagem de MG com a entrega de sempre`)
    await ctxMg.close()
  }

  // ─── o pedido guiado: o bairro do CEP casa com a lista ───
  {
    const ctx = await montar({ width: 390, height: 844 })
    const page = await abrir(ctx, 'rj', rj.map((p) => p.id), 'bairros-guiado')
    await page.evaluate(() => localStorage.removeItem('gc-bairro'))
    await page.reload()
    await page.waitForTimeout(800)
    await abrirSacola(page)
    await page.locator('.sacola-guiado').getByRole('button', { name: 'Pedido guiado', exact: true }).click()
    await page.waitForTimeout(700)
    await clicar(page, 'Isso')
    await clicar(page, 'Tá certo')
    await digitar(page, 'Ana Souza')
    await digitar(page, '22041001')
    await page.waitForTimeout(600)
    await digitar(page, '120')
    await clicar(page, 'Pix')
    await digitar(page, 'Portão azul')
    await page.waitForTimeout(500)
    const href = await page.getByRole('link', { name: 'Fechar pedido no WhatsApp' }).getAttribute('href').catch(() => null)
    conferir(linhaEntrega(href) === 'Entrega: Rua Barata Ribeiro, 120, Copacabana (taxa do bairro: R$ 12,00)', `bairros: no pedido guiado, o "Copacabana" do CEP casa com a lista e a taxa vai na mensagem ("${linhaEntrega(href)}")`)
    await foto(page, 'bairros-390-guiado-resumo')
    await ctx.close()
  }

  // ─── o site guardado no celular de antes ───
  {
    const ctx = await montar({ width: 360, height: 740 })
    const page = await ctx.newPage()
    vigiarSemRede(page, 'bairros-guardada')
    await page.goto(`${base}?uf=rj`)
    // a loja guardada por um build de antes (sem a taxa por bairro, outro build): abre com ela e troca pela nova
    await page.evaluate((l) => {
      const velha = { ...l, estados: l.estados.map(({ taxaPorBairro: _t, ...e }) => ({ ...e, taxaEntrega: { valor: 10, demo: false } })) }
      localStorage.setItem('gc-loja', JSON.stringify({ formato: 3, build: 'um-build-de-antes', versao: 21, atualizadoEm: '2026-10-15T12:00:00.000Z', loja: velha, pronta: { ...velha, canais: velha.estados, stories: {} } }))
    }, loja)
    await page.reload()
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.versao === 22, null, { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(600)
    await page.evaluate((x) => localStorage.setItem('gc-sacola', JSON.stringify({ state: { itens: x.map((id) => ({ id, variacao: null, qtd: 1 })), ultimo: [], cupom: null }, version: 0 })), rj.map((p) => p.id))
    await page.reload()
    await page.waitForTimeout(900)
    await abrirSacola(page)
    conferir((await page.locator('#bairro-sacola').count()) === 1, 'bairros: com a loja de antes guardada no celular, o site abre e troca pela nova (o "Teu bairro" aparece)')
    await ctx.close()
  }

  // ─── revisão de 22/10 (o corretor) ──────────────────────────────────────────────────────────────────────────
  const loja2 = structuredClone(loja)
  const est2 = (uf) => loja2.estados.find((e) => e.uf === uf)
  // SP com duas cidades e o "Centro" das duas com taxas diferentes; o cliente sem cidade escolhida (o ?uf=sp)
  Object.assign(est2('sp'), {
    horario: aberto,
    cidades: [{ slug: 'sao-paulo', nome: 'São Paulo' }, { slug: 'guarulhos', nome: 'Guarulhos' }],
    taxaEntrega: { valor: null, demo: false },
    taxaPorBairro: {
      modo: 'site',
      bairros: [
        { nome: 'Centro', cidade: 'Guarulhos', taxa: 10 },
        { nome: 'Centro', cidade: 'São Paulo', taxa: 8 },
        { nome: 'Moema', cidade: 'São Paulo', taxa: 9 },
        { nome: 'Liberdade', taxa: 11 },
      ],
    },
  })
  const sp = loja2.produtos.filter((p) => p.disponivel.sp && p.preco != null).slice(0, 1)
  const respostaDe = async (page, sel = '.bt-resposta') => semNbsp(await page.locator(sel).first().textContent({ timeout: 3000 }).catch(() => ''))
  // cada bloco: o que quebra (o código de antes, por exemplo) vira uma falha com o nome dele, e os outros seguem
  const T = { timeout: 5000 }
  const tentar = async (nome, ctx, fn) => {
    try {
      await fn()
    } catch (e) {
      conferir(false, `${nome}: quebrou (${e.message.split('\n')[0]})`)
    } finally {
      await ctx.close()
    }
  }
  for (const [rot, vp] of [
    ['360', { width: 360, height: 740 }],
    ['390', { width: 390, height: 844 }],
    ['computador', { width: 1280, height: 800 }],
  ]) {
    const ctx = await montar(vp, loja2)
    await tentar(`bairros sem cidade ${rot}`, ctx, async () => {
      const page = await abrir(ctx, 'sp', sp.map((p) => p.id), `bairros-sp-${rot}`)
      await abrirSacola(page)
      const campo = page.locator('#bairro-sacola')
      // a sugestão de um bairro que só tem numa cidade: com a cidade, e escolhida, dá a taxa (nunca "não tá na lista")
      await campo.fill('Moe')
      await page.waitForTimeout(350)
      const sugMoema = (await page.locator('.bt-sugestao').allTextContents()).map(semNbsp)
      conferir(sugMoema.length === 1 && sugMoema[0] === 'Moema · São Paulo: R$ 9,00', `bairros sem cidade ${rot}: "Moe" sugere "Moema · São Paulo: R$ 9,00" (${sugMoema.join(' | ')})`)
      await page.locator('.bt-sugestao').first().click(T)
      await page.waitForTimeout(350)
      const resMoema = await respostaDe(page)
      conferir(resMoema.startsWith('Taxa do bairro Moema: R$ 9,00'), `bairros sem cidade ${rot}: escolheu Moema: a taxa dele, e não "não tá na lista" ("${resMoema}")`)
      const hMoema = await fechar(page)
      conferir(linhaEntrega(hMoema) === 'Entrega: Moema (taxa R$ 9,00)' && mensagemDo(hMoema).startsWith('PEDIDO GREEN CHEESE — SP / São Paulo'), `bairros sem cidade ${rot}: a mensagem com a taxa e a cidade que a escolha disse ("${linhaEntrega(hMoema)}")`)
      // o "Centro" das duas cidades, sem cidade escolhida: as duas opções, cada uma com a cidade e a taxa
      await page.evaluate(() => {
        const l = JSON.parse(localStorage.getItem('gc-local') || '{}')
        l.state = { ...(l.state ?? {}), cidade: null }
        localStorage.setItem('gc-local', JSON.stringify(l))
        localStorage.removeItem('gc-bairro')
    })
    await page.goto(`${base}?uf=sp`)
    await page.waitForTimeout(900)
    await abrirSacola(page)
    await campo.fill('Cen')
    await page.waitForTimeout(350)
    const sugCentro = (await page.locator('.bt-sugestao').allTextContents()).map(semNbsp)
    conferir(sugCentro.join(' | ') === 'Centro · Guarulhos: R$ 10,00 | Centro · São Paulo: R$ 8,00', `bairros sem cidade ${rot}: "Cen" sugere o Centro de cada cidade, com a taxa de cada um (${sugCentro.join(' | ')})`)
    await page.locator('.bt-sugestoes').scrollIntoViewIfNeeded()
    await foto(page, `bairros-${rot}-sem-cidade-sugestao`)
    // digitado inteiro (sem tocar na sugestão): pede a cidade, com as opções à vista mesmo fora do campo
    await campo.fill('Centro')
    await campo.blur()
    await page.waitForTimeout(400)
    const resCentro = await respostaDe(page)
    conferir(resCentro === 'Centro tem taxa diferente em cada cidade: escolhe a tua aqui embaixo.' && (await page.locator('.bt-sugestao').count()) === 2, `bairros sem cidade ${rot}: "Centro" digitado pede a cidade, com as 2 opções ("${resCentro}")`)
    conferir(linhaEntrega(await fechar(page)) === 'Entrega: Centro (taxa do bairro a consultar)', `bairros sem cidade ${rot}: sem a cidade, a mensagem diz "a consultar" (nunca um dos dois valores)`)
    await page.locator('.bt-sugestao', { hasText: 'Guarulhos' }).click(T)
    await page.waitForTimeout(400)
    const resGru = await respostaDe(page)
    conferir(resGru.startsWith('Taxa do bairro Centro: R$ 10,00'), `bairros sem cidade ${rot}: escolheu "Centro · Guarulhos": R$ 10,00 ("${resGru}")`)
    const hGru = await fechar(page)
    conferir(linhaEntrega(hGru) === 'Entrega: Centro (taxa R$ 10,00)' && mensagemDo(hGru).startsWith('PEDIDO GREEN CHEESE — SP / Guarulhos'), `bairros sem cidade ${rot}: a mensagem do Centro de Guarulhos ("${linhaEntrega(hGru)}")`)
    await page.locator('.bt-resposta').scrollIntoViewIfNeeded()
    await foto(page, `bairros-${rot}-sem-cidade-escolheu`)
    })
  }

  // o rótulo da busca no story não passa o quadro; o teclado escolhe a sugestão; o total com a entrega e o mínimo
  for (const [rot, vp] of [
    ['360', { width: 360, height: 740 }],
    ['computador', { width: 1280, height: 800 }],
  ]) {
    const lojaMin = structuredClone(loja)
    // o mínimo entre o subtotal e o subtotal com a taxa de Copacabana (R$ 12)
    lojaMin.estados.find((e) => e.uf === 'rj').pedidoMinimo = Math.round((subtotalRj + 6) * 100) / 100
    const ctx = await montar(vp, lojaMin)
    await tentar(`bairros rótulo, teclado e mínimo ${rot}`, ctx, async () => {
      const page = await abrir(ctx, 'rj', rj.map((p) => p.id), `bairros-rotulo-${rot}`)
      await abrirSacola(page)
      const campo = page.locator('#bairro-sacola')
      if (rot === 'computador') {
        // teclado: digita, Tab pra sugestão (a lista fica), Enter escolhe e o foco volta pro campo
        await campo.click()
        await page.keyboard.type('copa', { delay: 20 })
        await page.waitForTimeout(250)
        await page.keyboard.press('Tab')
        await page.waitForTimeout(400)
        const noTab = await page.evaluate(() => ({ foco: document.activeElement?.className ?? '', n: document.querySelectorAll('.bt-sugestao').length }))
        conferir(noTab.n === 1 && noTab.foco.includes('bt-sugestao'), `bairros teclado: Tab do campo vai pra sugestão e a lista fica (${JSON.stringify(noTab)})`)
        await page.keyboard.press('Enter')
        await page.waitForTimeout(350)
        const depois = await page.evaluate(() => ({ foco: document.activeElement?.id ?? '', valor: document.querySelector('#bairro-sacola')?.value }))
        conferir(depois.valor === 'Copacabana' && depois.foco === 'bairro-sacola', `bairros teclado: Enter escolhe Copacabana e o foco volta pro campo (${JSON.stringify(depois)})`)
        await campo.fill('Bot')
        await page.keyboard.press('ArrowDown')
        await page.waitForTimeout(150)
        conferir(semNbsp(await page.evaluate(() => document.activeElement?.textContent ?? '')) === 'Botafogo: R$ 10,00', 'bairros teclado: ↓ no campo vai pra primeira sugestão')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(150)
        conferir(await page.evaluate(() => document.activeElement?.id === 'bairro-sacola'), 'bairros teclado: Esc na sugestão volta pro campo')
      }
      await campo.fill('Copacabana')
      await campo.blur()
      await page.waitForTimeout(400)
      const res = await respostaDe(page)
      const notaMin = `O pedido mínimo de ${brl(subtotalRj + 6)} conta só os produtos, sem a taxa.`
      conferir(res.includes(`Total com a entrega${brl(subtotalRj + 12)}`) && res.includes(notaMin), `bairros mínimo ${rot}: o total com a taxa passa do mínimo, e a tela diz que o mínimo conta só os produtos ("${res}")`)
      await page.locator('.bt-total').scrollIntoViewIfNeeded()
      await foto(page, `bairros-${rot}-total-minimo`)
      // o story: o toque no rótulo "Qual a taxa do meu bairro?" fica no quadro (e põe o cursor no campo)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(700)
      await storyNaEntrega(page, vp)
      const quadroAntes = await page.locator('.story .story-palco + span[aria-live]').first().textContent().catch(() => '')
      await page.locator('.bt-story .bt-rotulo').click(T)
      await page.waitForTimeout(700)
      const quadroDepois = await page.locator('.story .story-palco + span[aria-live]').first().textContent().catch(() => '')
      const foco = await page.evaluate(() => document.activeElement?.id ?? '')
      conferir(quadroAntes === quadroDepois && (await page.locator('#bairro-story').count()) === 1 && foco === 'bairro-story', `bairros story ${rot}: o toque no rótulo fica na entrega e põe o cursor no campo (${quadroAntes} → ${quadroDepois}, foco ${foco})`)
      await page.locator('.bt-story .bt-resposta').click({ force: true }).catch(() => {})
      await page.waitForTimeout(500)
      conferir((await page.locator('#bairro-story').count()) === 1, `bairros story ${rot}: o toque na resposta também não passa o quadro`)
    })
  }

  // o dia de entrega grátis: a sacola não mostra o "Teu bairro", e a mensagem não leva o bairro guardado
  {
    const lojaGratis = structuredClone(loja)
    lojaGratis.estados.find((e) => e.uf === 'rj').entregaGratis = { dias: [0, 1, 2, 3, 4, 5, 6], texto: 'Hoje tem entrega grátis!', demo: false }
    const ctx = await montar({ width: 360, height: 740 }, lojaGratis)
    await tentar('bairros dia grátis', ctx, async () => {
      const page = await abrir(ctx, 'rj', rj.map((p) => p.id), 'bairros-gratis')
      await page.evaluate(() => localStorage.setItem('gc-bairro', JSON.stringify({ state: { porUf: { rj: 'Copacabana' } }, version: 0 })))
      await page.reload()
      await page.waitForTimeout(900)
      await abrirSacola(page)
      conferir((await page.locator('#bairro-sacola').count()) === 0, 'bairros dia grátis: a sacola não mostra o "Teu bairro" (a taxa não depende dele hoje)')
      const antes = recebidos.length
      const href = await fechar(page)
      conferir(linhaEntrega(href) === 'Entrega: grátis hoje', `bairros dia grátis: a mensagem sem o bairro guardado de outra visita ("${linhaEntrega(href)}")`)
      await page.waitForTimeout(600)
      const copia = recebidos[antes]
      conferir(!copia?.entrega?.bairro && copia?.taxa?.texto === 'grátis hoje', `bairros dia grátis: a cópia sem o bairro, com o "grátis hoje" (${JSON.stringify({ e: copia?.entrega, t: copia?.taxa })})`)
    })
  }

  // o pedido guiado sem CEP: o bairro escrito no endereço vale mais que o guardado no aparelho
  {
    const ctx = await montar({ width: 390, height: 844 })
    await tentar('bairros guiado sem CEP', ctx, async () => {
      const page = await abrir(ctx, 'rj', rj.map((p) => p.id), 'bairros-guiado-sem-cep')
      await page.evaluate(() => localStorage.setItem('gc-bairro', JSON.stringify({ state: { porUf: { rj: 'Leblon' } }, version: 0 })))
      await page.reload()
      await page.waitForTimeout(800)
      await abrirSacola(page)
      await page.locator('.sacola-guiado').getByRole('button', { name: 'Pedido guiado', exact: true }).click()
      await page.waitForTimeout(700)
      const escrever = async (texto) => {
        await page.locator('.dm-entrada input, .dm-entrada textarea').first().fill(texto)
        await page.locator('.dm-entrada').evaluate((f) => f.requestSubmit())
        await page.waitForTimeout(350)
      }
      await clicar(page, 'Isso')
      await clicar(page, 'Tá certo')
      await escrever('Ana Souza')
      await clicar(page, 'Sem CEP')
      await escrever('Rua Barata Ribeiro, 120, Copacabana')
      await clicar(page, 'Pix')
      await clicar(page, 'Sem observação')
      await page.waitForTimeout(500)
      const link = page.getByRole('link', { name: 'Fechar pedido no WhatsApp' })
      const href = await link.getAttribute('href').catch(() => null)
      conferir(linhaEntrega(href) === 'Entrega: Rua Barata Ribeiro, 120, Copacabana (taxa do bairro: R$ 12,00)', `bairros: guiado sem CEP com o Leblon guardado e Copacabana no endereço: a taxa de Copacabana ("${linhaEntrega(href)}")`)
      // o cartão "Confere a sacola" (fica vivo no histórico até o resumo) diz o bairro da mensagem, e não o guardado
      // (revisão da junção, 22/10: dizia "bairro Leblon, taxa R$ 15,00" logo acima da mensagem com Copacabana)
      const cartao = semNbsp(await page.locator('.dm-cartao .ls-taxa').first().textContent(T).catch(() => ''))
      conferir(cartao === 'Entrega: bairro Copacabana, taxa R$ 12,00 (a loja confirma).', `bairros: guiado sem CEP, o cartão "Confere a sacola" diz o bairro e a taxa da mensagem ("${cartao}")`)
      const guardado = await page.evaluate(() => JSON.parse(localStorage.getItem('gc-bairro') || 'null')?.state?.porUf?.rj ?? null)
      conferir(guardado === 'Copacabana', `bairros: guiado sem CEP, o bairro do endereço fica guardado no aparelho pra sacola e o story dizerem o mesmo (${guardado})`)
      await foto(page, 'bairros-390-guiado-sem-cep')
      const antes = recebidos.length
      await link.evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()))
      await link.click().catch(() => {})
      await page.waitForTimeout(700)
      const copia = recebidos[antes]
      conferir(copia?.entrega?.bairro === 'Copacabana' && copia?.taxa?.valor === 12, `bairros: a cópia do guiado sem CEP com o bairro do endereço (${JSON.stringify({ b: copia?.entrega?.bairro, t: copia?.taxa })})`)
    })
  }

  // ─── o cupom que entrou sozinho e a taxa do bairro na mesma sacola (a junção das duas frentes de 22/10) ───
  // as duas mexeram no meio da sacola (a linha do cupom com o Trocar e o Tirar; o "Teu bairro" com a taxa e o total): no
  // celular cabem as duas sem rolar pro lado, a sugestão não fica embaixo do rodapé e a mensagem leva as duas linhas (o
  // cupom depois do Subtotal, a entrega com o bairro); a cópia leva o código do cupom, o bairro e a taxa
  const DIA = 864e5
  const zapCliente = '5533977712345'
  const contaComCupom = {
    state: {
      contas: {
        [zapCliente]: {
          conta: { id: 'local-1', nome: 'Duda Cupom', whatsapp: zapCliente, aceitaPromo: false, aceitaPromoEm: null, confirmou18Em: Date.now() - DIA, criadaEm: Date.now() - DIA },
          cupons: [
            {
              codigo: 'SORTE-K8EA',
              interativo: 'sorte',
              premioId: 'ocb-4-por-3',
              retrato: { titulo: '4 por 3 na OCB', regra: 'Leva 4 Seda OCB Premium Slim e paga 3', aplicaA: { produtos: ['seda-ocb-premium-slim'] }, comoUsar: 'Põe 4 na sacola e usa o cupom.', tipo: 'leve-x-pague-y', valor: { leve: 4, pague: 3 }, raridade: 'comum' },
              demo: true,
              ganhoEm: Date.now() - DIA,
              validoAte: Date.now() + 5 * DIA,
            },
          ],
        },
      },
      atual: zapCliente,
      giros: {},
      pendente: null,
      vistos: ['sorte'],
    },
    version: 1,
  }
  for (const [rot, vp] of [
    ['360', { width: 360, height: 740 }],
    ['390', { width: 390, height: 844 }],
  ]) {
    const ctx = await montar(vp)
    await tentar(`bairros e cupom ${rot}`, ctx, async () => {
      const page = await ctx.newPage()
      vigiarSemRede(page, `bairros-cupom-${rot}`)
      await page.goto(`${base}?uf=rj`)
      await page.evaluate((c) => {
        localStorage.setItem('gc-conta', JSON.stringify(c))
        localStorage.setItem('gc-sacola', JSON.stringify({ state: { itens: [{ id: 'seda-ocb-premium-slim', variacao: null, qtd: 4 }], ultimo: [], cupom: null }, version: 0 }))
        localStorage.removeItem('gc-bairro')
      }, contaComCupom)
      await page.reload()
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.versao === 22, null, { timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(800)
      await abrirSacola(page)
      await page.waitForTimeout(500)
      const linhaCupom = semNbsp(await page.locator('.cupom-sacola.cs-ok').first().textContent(T).catch(() => ''))
      conferir(/SORTE-K8EA/.test(linhaCupom) && /Entrou sozinho/.test(linhaCupom), `bairros e cupom ${rot}: o cupom da conta entra sozinho na sacola do RJ por bairro ("${linhaCupom}")`)
      const campo = page.locator('#bairro-sacola')
      await campo.fill('Copa')
      await page.waitForTimeout(400)
      const caixas = await page.evaluate(() => {
        const s = document.querySelector('.bt-sugestoes')?.getBoundingClientRect()
        const r = document.querySelector('.folha-rodape, .sacola-fechar')?.getBoundingClientRect()
        return s && r ? { sug: s.bottom, rodape: r.top } : null
      })
      conferir(!!caixas && caixas.sug <= caixas.rodape + 1, `bairros e cupom ${rot}: com a linha do cupom em cima, a sugestão fica à vista, sem o rodapé por cima (${JSON.stringify(caixas)})`)
      await page.locator('.bt-sugestao').first().click(T)
      await page.waitForTimeout(400)
      const subtotal = await page.locator('.ls-subtotal .px').first().textContent(T)
      const valorSub = Number(semNbsp(subtotal).replace(/[^\d,]/g, '').replace(',', '.'))
      const res = await respostaDe(page)
      conferir(res.includes('Taxa do bairro Copacabana: R$ 12,00') && res.includes(`Total com a entrega${brl(valorSub + 12)}`), `bairros e cupom ${rot}: a taxa de Copacabana e o total com ela (${brl(valorSub + 12)}) com o cupom na sacola ("${res}")`)
      // o site nunca faz a conta do cupom: o total diz que é sem o desconto (sem isso, "Total" embaixo de um "leva 4 paga 3")
      conferir(res.endsWith('Sem o desconto do cupom: a loja confirma a taxa e o desconto no atendimento.'), `bairros e cupom ${rot}: o total diz que é sem o desconto do cupom ("${res}")`)
      conferir((await page.locator('.cupom-sacola.cs-ok').count()) === 1, `bairros e cupom ${rot}: escolher o bairro não tira o cupom que entrou sozinho`)
      // nada passa da tela pro lado: a linha do cupom (o código, o Trocar e o Tirar), o campo do bairro e o total
      const fora = await page.evaluate(() => {
        const sel = '.cupom-sacola, .cupom-sacola .cs-botao, .cupom-sacola .cs-adesivo, .bairro-taxa, .bt-input, .bt-total, .bt-resposta, .ls-subtotal'
        return [...document.querySelectorAll(sel)]
          .map((e) => ({ c: e.className, r: e.getBoundingClientRect() }))
          .filter((x) => x.r.width > 0 && (x.r.left < -0.5 || x.r.right > innerWidth + 0.5))
          .map((x) => `${x.c} ${Math.round(x.r.left)}–${Math.round(x.r.right)}`)
          .concat(document.documentElement.scrollWidth > innerWidth + 0.5 ? [`página ${document.documentElement.scrollWidth}`] : [])
      })
      conferir(fora.length === 0, `bairros e cupom ${rot}: a linha do cupom e o bairro com a taxa cabem na largura, sem rolar pro lado (${fora.join(' | ') || 'tudo dentro'})`)
      await page.locator('.cupom-sacola').first().scrollIntoViewIfNeeded()
      await page.locator('.bt-total').scrollIntoViewIfNeeded()
      await foto(page, `bairros-cupom-${rot}-sacola`)
      const antes = recebidos.length
      const href = await fechar(page)
      const linhas = mensagemDo(href).split('\n')
      const iCupom = linhas.findIndex((l) => l.startsWith('Cupom: SORTE-K8EA'))
      conferir(iCupom > 0 && linhas[iCupom - 1].startsWith('Subtotal:') && linhaEntrega(href) === 'Entrega: Copacabana (taxa R$ 12,00)', `bairros e cupom ${rot}: a mensagem leva o cupom depois do Subtotal e a entrega com o bairro ("${linhas.join(' / ')}")`)
      await page.waitForTimeout(600)
      const copia = recebidos[antes]
      conferir(copia?.cupom?.codigo === 'SORTE-K8EA' && copia?.entrega?.bairro === 'Copacabana' && copia?.taxa?.valor === 12, `bairros e cupom ${rot}: a cópia do pedido leva o cupom, o bairro e a taxa (${JSON.stringify({ k: copia?.cupom?.codigo, b: copia?.entrega?.bairro, t: copia?.taxa?.valor })})`)
    })
  }

  // ─── depois do pedido guiado (revisão da junção, 22/10) ──────────────────────────────────────────────────────
  // O guiado com o CEP de Copacabana, o Leblon guardado no aparelho e dois cupons na conta (o das sedas entra sozinho).
  // Depois do toque no WhatsApp, a sacola reconhece o pedido guiado e o botão abre a mesma mensagem: tudo o que ela
  // mostra tem de ser o que foi. O cartão "Confere a sacola" e o "Teu bairro" diziam o Leblon guardado (R$ 15,00) com a
  // mensagem em Copacabana (R$ 12,00); o Trocar do cupom não mudava o que ia e o "Já mandei" marcava como usado o cupom
  // que não foi. Agora: o bairro do endereço fica guardado no aparelho, a sacola mostra a entrega da mensagem do guiado
  // (sem o campo, que não mudaria nada) e trocar o cupom é pedido novo (como mudar um item), que entra no lugar do guiado.
  {
    const vp = { width: 390, height: 844 }
    const ctx = await montar(vp)
    await tentar('bairros depois do guiado', ctx, async () => {
      const cupomDe = (codigo, premioId, retrato, dias) => ({ codigo, interativo: 'sorte', premioId, retrato, demo: false, ganhoEm: Date.now() - DIA, validoAte: Date.now() + dias * DIA })
      const conta = structuredClone(contaComCupom)
      conta.state.contas[zapCliente].cupons = [
        cupomDe('SORTE-K8EA', 'ocb-4-por-3', contaComCupom.state.contas[zapCliente].cupons[0].retrato, 5),
        cupomDe('SORTE-PCT7', 'sedas-10', { titulo: '10% nas sedas', regra: '10% de desconto nas sedas', aplicaA: { categorias: ['sedas'] }, comoUsar: 'Põe uma seda na sacola.', tipo: 'desconto-percentual', valor: 10, raridade: 'raro' }, 3),
      ]
      const page = await ctx.newPage()
      vigiarSemRede(page, 'bairros-depois-do-guiado')
      await page.goto(`${base}?uf=rj`)
      await page.evaluate((c) => {
        localStorage.setItem('gc-conta', JSON.stringify(c))
        localStorage.setItem('gc-sacola', JSON.stringify({ state: { itens: [{ id: 'seda-ocb-premium-slim', variacao: null, qtd: 4 }], ultimo: [], cupom: null }, version: 0 }))
        localStorage.setItem('gc-bairro', JSON.stringify({ state: { porUf: { rj: 'Leblon' } }, version: 0 }))
      }, conta)
      await page.reload()
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.versao === 22, null, { timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(800)
      await abrirSacola(page)
      await page.locator('.sacola-guiado').getByRole('button', { name: 'Pedido guiado', exact: true }).click(T)
      await page.waitForTimeout(700)
      const escrever = async (texto) => {
        await page.locator('.dm-entrada input, .dm-entrada textarea').first().fill(texto)
        await page.locator('.dm-entrada').evaluate((f) => f.requestSubmit())
        await page.waitForTimeout(400)
      }
      await clicar(page, 'Isso')
      await clicar(page, 'Tá certo')
      await escrever('Ana Souza')
      await escrever('22041001')
      await page.waitForTimeout(700)
      await escrever('120')
      await clicar(page, 'Pix')
      await clicar(page, 'Sem observação')
      await page.waitForTimeout(700)
      const link = page.getByRole('link', { name: 'Fechar pedido no WhatsApp' })
      const hGuiado = await link.getAttribute('href', T)
      const msgGuiado = mensagemDo(hGuiado)
      const codigoGuiado = msgGuiado.split('\n')[1]?.replace('Código: ', '') ?? ''
      conferir(linhaEntrega(hGuiado) === 'Entrega: Rua Barata Ribeiro, 120, Copacabana (taxa do bairro: R$ 12,00)' && msgGuiado.includes('Cupom: SORTE-PCT7'), `bairros depois do guiado: a mensagem do guiado com o CEP de Copacabana e o cupom que entrou sozinho ("${linhaEntrega(hGuiado)}")`)
      const cartao = semNbsp(await page.locator('.dm-cartao .ls-taxa').first().textContent(T).catch(() => ''))
      conferir(cartao === 'Entrega: bairro Copacabana, taxa R$ 12,00 (a loja confirma).', `bairros depois do guiado: o cartão "Confere a sacola" diz o bairro do CEP, o mesmo da mensagem logo abaixo ("${cartao}")`)
      const guardado = await page.evaluate(() => JSON.parse(localStorage.getItem('gc-bairro') || 'null')?.state?.porUf?.rj ?? null)
      conferir(guardado === 'Copacabana', `bairros depois do guiado: o bairro do CEP fica guardado no aparelho no lugar do Leblon (${guardado})`)
      await page.locator('.dm-cartao .ls-taxa').first().scrollIntoViewIfNeeded().catch(() => {})
      await foto(page, 'bairros-guiado-cartao')
      const antesGuiado = recebidos.length
      await link.evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()))
      await link.click(T)
      await page.waitForTimeout(700)
      conferir(recebidos.length === antesGuiado + 1 && recebidos[antesGuiado]?.codigo === codigoGuiado, `bairros depois do guiado: a cópia do guiado foi pro servidor (${recebidos[antesGuiado]?.codigo})`)
      // fecha o guiado e abre a sacola: ela reconhece o pedido guiado
      await page.keyboard.press('Escape')
      await page.waitForTimeout(700)
      await abrirSacola(page)
      await page.waitForTimeout(400)
      const rodape = semNbsp(await page.locator('.sacola-fechar').textContent(T))
      conferir(rodape.includes(`O pedido ${codigoGuiado} já foi montado no pedido guiado`), `bairros depois do guiado: a sacola reconhece o pedido guiado ("${rodape.slice(0, 90)}")`)
      // a entrega: a da mensagem do guiado, sem o campo (mudar o "Teu bairro" aqui não mudaria nada no que vai)
      const entrega = semNbsp(await page.locator('.lista-sacola .bairro-taxa').first().textContent(T).catch(() => ''))
      conferir((await page.locator('#bairro-sacola').count()) === 0 && entrega.includes('Rua Barata Ribeiro, 120, Copacabana (taxa do bairro: R$ 12,00)') && !entrega.includes('Leblon'), `bairros depois do guiado: a sacola mostra a entrega que foi no guiado, sem o campo do bairro ("${entrega}")`)
      await page.evaluate(() => {
        const c = document.querySelector('.folha-corpo')
        if (c) c.scrollTop = c.scrollHeight
      })
      await foto(page, 'bairros-guiado-sacola')
      const hIgual = await fechar(page)
      conferir(mensagemDo(hIgual) === msgGuiado, 'bairros depois do guiado: o botão da sacola abre a mesma mensagem do guiado')
      // trocar o cupom é mudar o pedido: a mensagem nova leva o cupom escolhido, com outro código, no lugar do guiado
      await page.locator('.cupom-sacola .cs-botao', { hasText: 'Trocar' }).click(T)
      await page.waitForTimeout(400)
      await page.locator('.cs-trocar .cs-chip', { hasText: 'SORTE-K8EA' }).click(T)
      await page.waitForTimeout(600)
      const rodape2 = semNbsp(await page.locator('.sacola-fechar').textContent(T))
      conferir(!rodape2.includes('já foi montado no pedido guiado'), `bairros depois do guiado: trocado o cupom, a sacola não diz mais que o botão abre o pedido guiado ("${rodape2.slice(0, 90)}")`)
      const antesTroca = recebidos.length
      const hTroca = await fechar(page)
      const msgTroca = mensagemDo(hTroca)
      const codigoTroca = msgTroca.split('\n')[1]?.replace('Código: ', '') ?? ''
      conferir(msgTroca.includes('Cupom: SORTE-K8EA') && !msgTroca.includes('SORTE-PCT7') && codigoTroca !== codigoGuiado && linhaEntrega(hTroca) === 'Entrega: Copacabana (taxa R$ 12,00)', `bairros depois do guiado: o botão manda o cupom trocado, com código novo e o bairro do guiado ("${msgTroca.split('\n').join(' / ')}")`)
      await page.waitForTimeout(600)
      const copia = recebidos[antesTroca]
      conferir(copia?.cupom?.codigo === 'SORTE-K8EA' && copia?.substitui?.codigo === codigoGuiado && copia?.entrega?.bairro === 'Copacabana', `bairros depois do guiado: a cópia nova leva o cupom trocado e entra no lugar do guiado (${JSON.stringify({ k: copia?.cupom?.codigo, s: copia?.substitui?.codigo, b: copia?.entrega?.bairro })})`)
      // o "Já mandei" marca como usado o cupom que foi na mensagem
      await page.getByRole('button', { name: 'Já mandei: limpar a sacola' }).click(T)
      await page.waitForTimeout(1200)
      const cupons = await page.evaluate(() => {
        const c = JSON.parse(localStorage.getItem('gc-conta') || 'null')
        return Object.fromEntries((c?.state?.contas?.[c?.state?.atual]?.cupons ?? []).map((x) => [x.codigo, !!x.usadoEm]))
      })
      conferir(cupons['SORTE-K8EA'] === true && cupons['SORTE-PCT7'] === false, `bairros depois do guiado: o "Já mandei" marca o cupom que foi (o K8EA usado, o PCT7 ativo) (${JSON.stringify(cupons)})`)
    })
  }

  // o "Já mandei" logo depois do guiado (sem trocar nada): marca o cupom que foi na mensagem do guiado
  {
    const ctx = await montar({ width: 360, height: 740 })
    await tentar('bairros depois do guiado, Já mandei', ctx, async () => {
      const page = await ctx.newPage()
      vigiarSemRede(page, 'bairros-depois-do-guiado-mandei')
      await page.goto(`${base}?uf=rj`)
      await page.evaluate((c) => {
        localStorage.setItem('gc-conta', JSON.stringify(c))
        localStorage.setItem('gc-sacola', JSON.stringify({ state: { itens: [{ id: 'seda-ocb-premium-slim', variacao: null, qtd: 4 }], ultimo: [], cupom: null }, version: 0 }))
      }, contaComCupom)
      await page.reload()
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.versao === 22, null, { timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(800)
      await abrirSacola(page)
      await page.locator('.sacola-guiado').getByRole('button', { name: 'Pedido guiado', exact: true }).click(T)
      await page.waitForTimeout(700)
      await clicar(page, 'Isso')
      await clicar(page, 'Tá certo')
      await digitar(page, 'Ana Souza')
      await clicar(page, 'Sem CEP')
      await page.locator('.dm-entrada input, .dm-entrada textarea').first().fill('Rua Visconde de Pirajá, 100, Ipanema')
      await page.locator('.dm-entrada').evaluate((f) => f.requestSubmit())
      await page.waitForTimeout(400)
      await clicar(page, 'Pix')
      await clicar(page, 'Sem observação')
      await page.waitForTimeout(600)
      const link = page.getByRole('link', { name: 'Fechar pedido no WhatsApp' })
      const msg = mensagemDo(await link.getAttribute('href', T))
      await link.evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()))
      await link.click(T)
      await page.waitForTimeout(600)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(700)
      await abrirSacola(page)
      const entrega = semNbsp(await page.locator('.lista-sacola .bairro-taxa').first().textContent(T).catch(() => ''))
      conferir(msg.includes('Cupom: SORTE-K8EA') && entrega.includes('Rua Visconde de Pirajá, 100, Ipanema (taxa do bairro: R$ 12,50)'), `bairros depois do guiado sem CEP: a sacola mostra a entrega do guiado ("${entrega}")`)
      await foto(page, 'bairros-guiado-sem-cep-sacola')
      await page.getByRole('button', { name: 'Já mandei: limpar a sacola' }).click(T)
      await page.waitForTimeout(1200)
      const usado = await page.evaluate(() => {
        const c = JSON.parse(localStorage.getItem('gc-conta') || 'null')
        return (c?.state?.contas?.[c?.state?.atual]?.cupons ?? []).find((x) => x.codigo === 'SORTE-K8EA')?.usadoEm ?? null
      })
      conferir(!!usado, 'bairros depois do guiado sem CEP: o "Já mandei" marca como usado o cupom que foi na mensagem do guiado')
    })
  }
}
