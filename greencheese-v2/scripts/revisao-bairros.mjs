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

  const montar = async (viewport) => {
    const ctx = await contexto(browser, viewport)
    await ctx.route(/\/api\/index\.php\?r=loja(&|$)/, (r) =>
      r.fulfill({ json: { ok: true, versao: 22, atualizadoEm: '2026-10-22T12:00:00.000Z', loja }, headers: { 'Cache-Control': 'no-cache', ETag: '"22"' } }),
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
    conferir(copia?.entrega?.bairro === 'Copacabana' && JSON.stringify(copia?.taxa) === JSON.stringify({ valor: 12, texto: 'taxa R$ 12,00' }), `bairros ${rot}: a cópia do pedido leva o bairro e a taxa que o site mostrou (${JSON.stringify({ b: copia?.entrega?.bairro, t: copia?.taxa })})`)
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
}
