// O pedido rápido da sacola (rodada do scripts/revisao.mjs; pedido do Ian em 14/10): o "Fechar pedido no WhatsApp"
// da sacola abre o WhatsApp do estado num toque, com o pedido inteiro na mensagem (cabeçalho, código, itens com o
// combo, subtotal, entrega como o estado diz e "Endereço: mando aqui na conversa"), sem pedir nome, endereço nem
// pagamento; a cópia vai pro servidor no mesmo toque (origem "sacola", sem nome); "Já mandei" limpa a sacola. O
// pedido mínimo do estado (o GET loja simulado no formato do API.md, com pedidoMinimo em MG): "Faltam R$ X pro pedido
// mínimo de R$ Y pra entrega", o botão travado (o leitor de tela ouve o porquê) até chegar, conta com o combo, o item
// "Consultar" não trava (avisa que a loja confere na conversa), o estado sem mínimo nem mostra nada; o pedido guiado
// continua (botão discreto da sacola, e o ?chat=pedido) e respeita o mínimo; o botão cabe em 320 e 360.
import { lojaDaSemente } from './revisao-loja.mjs'

const ZAP = 'https://wa.me/5533991139036?text='
const LINHA_CODIGO = /^Código: GC-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/
const semNbsp = (s) => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()

/**
 * @param {{ browser: import('playwright').Browser, base: string, contexto: Function, conferir: Function, foto: Function,
 *   vigiarSemRede: Function }} h
 */
export async function rodadaSacola({ browser, base, contexto, conferir, foto, vigiarSemRede }) {
  const loja = lojaDaSemente()
  const est = (uf) => loja.estados.find((e) => e.uf === uf)
  // o dono pôs R$ 20 de mínimo em MG (RJ fica sem); a cuia (preço a consultar) também à venda em MG
  est('mg').pedidoMinimo = 20
  loja.produtos.find((p) => p.id === 'cuia-de-silicone-raw').disponivel.mg = true
  const recebidos = []

  const montar = async (viewport) => {
    const ctx = await contexto(browser, viewport)
    await ctx.route(/\/api\/index\.php\?r=loja(&|$)/, (r) => r.fulfill({ json: { ok: true, versao: 8, atualizadoEm: new Date().toISOString(), loja }, headers: { 'Cache-Control': 'no-cache', ETag: '"8"' } }))
    await ctx.route('**/api/index.php?r=pedido', async (route) => {
      const req = route.request()
      if (req.method() !== 'POST') return route.fallback()
      let c = null
      try {
        c = JSON.parse(req.postData() ?? '')
      } catch {
        c = null
      }
      recebidos.push({ c, via: req.resourceType() })
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
  /** Abre o site no estado com a sacola pronta e abre a sacola. */
  const abrir = async (ctx, uf, itens, nome) => {
    const page = await ctx.newPage()
    vigiarSemRede(page, nome)
    await page.goto(`${base}?uf=${uf}`)
    await page.evaluate((x) => localStorage.setItem('gc-sacola', JSON.stringify({ state: { itens: x, ultimo: [], cupom: null }, version: 0 })), itens)
    await page.reload()
    // a loja do servidor chegou (o mínimo vem nela)
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.versao === 8, null, { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(500)
    await page.locator('.barra-abas [data-aba="sacola"]:visible, .lateral-item:has-text("Sacola"):visible').first().click()
    await page.locator('.sacola-fechar').waitFor({ timeout: 8000 })
    await page.waitForTimeout(500)
    return page
  }
  const ver = (page) =>
    page.evaluate(() => {
      const b = document.querySelector('.sacola-zap')
      const r = b?.getBoundingClientRect()
      return {
        aviso: document.querySelector('#sacola-minimo')?.textContent ?? null,
        ehLink: b?.tagName === 'A',
        travado: b?.getAttribute('aria-disabled') === 'true',
        descrito: b?.getAttribute('aria-describedby') ?? null,
        href: b?.getAttribute('href') ?? null,
        h: r ? Math.round(r.height) : 0,
        dentro: r ? r.left >= -0.5 && r.right <= innerWidth + 0.5 : false,
        lateral: document.documentElement.scrollWidth > innerWidth + 0.5,
        taxa: [...document.querySelectorAll('.ls-taxa')].map((x) => x.textContent).join(' | '),
        zaps: document.querySelectorAll('.sacola a[href*="wa.me"], .sacola-fechar a[href*="wa.me"]').length,
      }
    })
  const mensagemDe = (href) => decodeURIComponent((href ?? '').split('text=')[1] ?? '')
  const ocb = (qtd) => [{ id: 'seda-ocb-premium-slim', variacao: null, qtd }]

  // ── MG com mínimo de R$ 20: travado, falta 1 centavo, destravado, um toque ───────────────────────────────────────
  {
    const ctx = await montar({ width: 390, height: 844 })
    const page = await abrir(ctx, 'mg', ocb(1), 'sacola-mg')
    let v = await ver(page)
    conferir(semNbsp(v.aviso) === 'Faltam R$ 10,01 pro pedido mínimo de R$ 20,00 pra entrega.', `sacola MG (1 OCB, R$ 9,99): "Faltam R$ 10,01 pro pedido mínimo de R$ 20,00 pra entrega." (${semNbsp(v.aviso)})`)
    conferir(!v.ehLink && v.travado && v.descrito === 'sacola-minimo' && v.zaps === 0, `sacola abaixo do mínimo: o botão travado (aria-disabled, descrito pelo aviso) e nenhum link do WhatsApp (${JSON.stringify({ ehLink: v.ehLink, travado: v.travado, descrito: v.descrito, zaps: v.zaps })})`)
    conferir(/Pedido mínimo pra entrega: R\$ 20,00/.test(v.taxa), `a sacola diz o mínimo junto da entrega (${v.taxa})`)
    const nome = await page.locator('.sacola-zap').evaluate((b) => b.textContent?.trim())
    conferir(nome === 'Fechar pedido no WhatsApp', `o botão principal: "Fechar pedido no WhatsApp" (${nome})`)
    await foto(page, 'sacola-01-mg-travada')
    // o toque no travado não manda nada: leva o foco pro aviso (o leitor de tela lê quanto falta)
    await page.locator('.sacola-zap').click({ force: true })
    await page.waitForTimeout(500)
    const foco = await page.evaluate(() => document.activeElement?.id ?? null)
    conferir(recebidos.length === 0 && (await page.evaluate(() => window.__zap ?? null)) === null && foco === 'sacola-minimo', `tocar no travado: nada vai pro servidor nem pro WhatsApp, o foco vai pro aviso (${foco})`)
    // 3 OCB = combo 3 por R$ 19,99: ainda falta 1 centavo (a conta é com o combo)
    await page.getByRole('button', { name: 'Mais um', exact: true }).first().click()
    await page.getByRole('button', { name: 'Mais um', exact: true }).first().click()
    await page.waitForTimeout(400)
    v = await ver(page)
    conferir(semNbsp(v.aviso) === 'Faltam R$ 0,01 pro pedido mínimo de R$ 20,00 pra entrega.' && v.travado, `3 OCB no combo (R$ 19,99): ainda trava, falta R$ 0,01 (${semNbsp(v.aviso)})`)
    await page.getByRole('button', { name: 'Mais um', exact: true }).first().click()
    await page.waitForTimeout(400)
    v = await ver(page)
    conferir(v.aviso === null && v.ehLink && !v.travado && v.href?.startsWith(ZAP), `4 OCB (R$ 29,98): destrava, o botão vira o link do WhatsApp do estado (${v.href?.slice(0, 40)})`)
    await foto(page, 'sacola-02-mg-destravada')
    const texto = mensagemDe(v.href)
    const linhas = texto.split('\n')
    conferir(
      linhas[0] === 'PEDIDO GREEN CHEESE — MG / Teófilo Otoni' &&
        LINHA_CODIGO.test(linhas[1] ?? '') &&
        linhas[2] === '4x Seda OCB Premium Slim — R$ 29,98 (combo 3 por R$ 19,99 + 1 avulsa)' &&
        linhas[3] === 'Subtotal: R$ 29,98' &&
        linhas[4] === 'Entrega: taxa a confirmar' &&
        linhas.at(-1) === 'Endereço: mando aqui na conversa' &&
        !/^(Nome|Pagamento|Obs\.):/m.test(texto),
      `a mensagem da sacola: cabeçalho, código, itens com o combo, subtotal, entrega e "Endereço: mando aqui na conversa", sem nome nem pagamento:\n${texto}`,
    )
    // um toque: o WhatsApp abre e a cópia vai pro servidor junto
    await page.locator('a.sacola-zap').click()
    for (let k = 0; k < 40 && !recebidos.length; k++) await page.waitForTimeout(100)
    const zap = await page.evaluate(() => window.__zap ?? null)
    const a = recebidos[0]?.c
    conferir(zap === v.href, 'um toque no "Fechar pedido no WhatsApp": abre o WhatsApp com a mensagem pronta')
    conferir(
      !!a && a.origem === 'sacola' && a.tipo === 'pedido' && a.nome === '' && a.uf === 'mg' && a.cidade === 'Teófilo Otoni' && a.codigo === linhas[1].replace('Código: ', '') && a.mensagem === texto && a.itens?.length === 1 && a.itens[0].qtd === 4 && a.itens[0].combo === '3 por R$ 19,99 + 1 avulsa' && a.subtotal === 29.98 && !a.entrega && !a.pagamento && /^[0-9a-f]{32}$/.test(a.token ?? ''),
      `a cópia no servidor, no mesmo toque: origem "sacola", sem nome, endereço nem pagamento, a mensagem exata (${recebidos[0]?.via ?? 'nada chegou'})`,
    )
    const enviado = semNbsp(await page.locator('.sacola-enviado').textContent().catch(() => ''))
    conferir(enviado.includes(`Pedido ${a?.codigo} pronto no WhatsApp`) && enviado.includes('Já mandei: limpar a sacola'), `de volta no site: "Pedido ${a?.codigo} pronto no WhatsApp…" e o "Já mandei: limpar a sacola" (${enviado})`)
    await foto(page, 'sacola-03-mg-depois-do-toque')
    // tocou de novo com a mesma sacola: o mesmo código (o servidor não ganha outro pedido)
    const n = recebidos.length
    await page.locator('a.sacola-zap').click()
    for (let k = 0; k < 20 && recebidos.length === n; k++) await page.waitForTimeout(100)
    conferir(recebidos.slice(n).every((x) => x.c?.codigo === a?.codigo && x.c?.token === a?.token), 'tocou de novo sem mudar nada: vai com o mesmo código e token (o servidor reconhece o repetido)')
    await page.getByRole('button', { name: 'Já mandei: limpar a sacola' }).click()
    await page.waitForTimeout(500)
    const vazia = await page.evaluate(() => JSON.parse(localStorage.getItem('gc-sacola') || '{}')?.state?.itens?.length ?? -1)
    conferir(vazia === 0, `"Já mandei": a sacola fica limpa pro próximo pedido (${vazia} itens)`)
    await ctx.close()
  }

  // ── item "Consultar" com o mínimo: não trava, avisa que a loja confere na conversa ──────────────────────────────
  {
    const ctx = await montar({ width: 390, height: 844 })
    const page = await abrir(ctx, 'mg', [...ocb(1), { id: 'cuia-de-silicone-raw', variacao: null, qtd: 1 }], 'sacola-consultar')
    const v = await ver(page)
    conferir(semNbsp(v.aviso) === 'Tem item com preço a consultar: a loja confere o pedido mínimo de R$ 20,00 na conversa.' && v.ehLink && !v.travado, `com item "Consultar" abaixo do mínimo: não trava e avisa que a loja confere (${semNbsp(v.aviso)})`)
    const texto = mensagemDe(v.href)
    conferir(/^1x Cuia de silicone RAW — preço a consultar$/m.test(texto) && /^Subtotal: R\$ 9,99 \+ itens a consultar$|^Subtotal: R\$ 9,99/m.test(texto), `a mensagem com o "preço a consultar" (${texto.split('\n').slice(2, 5).join(' / ')})`)
    await foto(page, 'sacola-04-mg-consultar')
    await ctx.close()
  }

  // ── RJ sem mínimo: nada de aviso, o link direto já com 1 item ──────────────────────────────────────────────────
  {
    const ctx = await montar({ width: 390, height: 844 })
    const page = await abrir(ctx, 'rj', ocb(1), 'sacola-rj')
    const v = await ver(page)
    conferir(v.aviso === null && v.ehLink && v.href?.startsWith(ZAP) && !/mínimo/.test(v.taxa), `RJ sem mínimo: sem aviso, o link do WhatsApp com 1 item só (${v.taxa})`)
    const texto = mensagemDe(v.href)
    conferir(texto.startsWith('PEDIDO GREEN CHEESE — RJ / Rio de Janeiro\nCódigo: GC-') && texto.endsWith('\nEndereço: mando aqui na conversa'), 'RJ: a mensagem com o cabeçalho do RJ e o endereço na conversa')
    await foto(page, 'sacola-05-rj-sem-minimo')
    await ctx.close()
  }

  // ── o pedido guiado continua: botão discreto da sacola e o ?chat=pedido, e respeita o mínimo ──────────────────
  {
    const ctx = await montar({ width: 390, height: 844 })
    const page = await abrir(ctx, 'mg', ocb(1), 'sacola-guiado')
    const secundario = page.locator('.sacola-guiado').getByRole('button', { name: 'Pedido guiado', exact: true })
    const pesos = await page.evaluate(() => {
      const a = document.querySelector('.sacola-zap')?.getBoundingClientRect()
      const b = document.querySelector('.sacola-guiado-botao')?.getBoundingClientRect()
      return a && b ? { principal: Math.round(a.height * a.width), guiado: Math.round(b.height * b.width), depois: b.top >= a.bottom - 1 } : null
    })
    conferir(!!pesos && pesos.guiado * 3 < pesos.principal && pesos.depois, `o pedido guiado fica discreto, embaixo do principal (${JSON.stringify(pesos)})`)
    await secundario.click()
    await page.locator('[aria-modal="true"][aria-label="Pedido guiado"]').waitFor({ timeout: 8000 })
    await page.waitForTimeout(900)
    // confirma o atendimento (Teófilo Otoni, MG): o passo seguinte confere a sacola
    await page.getByRole('button', { name: 'Isso', exact: true }).last().click()
    await page.waitForTimeout(900)
    const bolhas = semNbsp((await page.locator('.dm-loja').allTextContents()).join(' | '))
    conferir(/Faltam R\$ 10,01 pro pedido mínimo de R\$ 20,00 pra entrega/.test(bolhas), `pedido guiado abaixo do mínimo: avisa quanto falta (${bolhas.slice(-160)})`)
    conferir((await page.getByRole('button', { name: 'Mexer na sacola' }).count()) > 0, 'pedido guiado abaixo do mínimo: oferece "Mexer na sacola"')
    await foto(page, 'sacola-06-guiado-minimo')
    await ctx.close()
    // ?chat=pedido (o link direto): o pedido guiado abre como antes
    const ctx2 = await montar({ width: 390, height: 844 })
    const pg = await ctx2.newPage()
    vigiarSemRede(pg, 'sacola-chat-pedido')
    await pg.goto(`${base}?uf=rj`)
    await pg.evaluate((x) => localStorage.setItem('gc-sacola', JSON.stringify({ state: { itens: x, ultimo: [], cupom: null }, version: 0 })), ocb(3))
    await pg.goto(`${base}?uf=rj&chat=pedido`)
    const abriu = await pg.locator('[aria-modal="true"][aria-label="Pedido guiado"]').waitFor({ timeout: 8000 }).then(() => true, () => false)
    conferir(abriu, '?chat=pedido: o pedido guiado abre direto, como antes')
    await ctx2.close()
  }

  // ── cabe no celular pequeno: 360×640 e 320×568, travado e destravado ─────────────────────────────────────────
  for (const [w, h] of [[360, 640], [320, 568]]) {
    const ctx = await montar({ width: w, height: h })
    const page = await abrir(ctx, 'mg', ocb(1), `sacola-${w}`)
    const travado = await ver(page)
    await page.getByRole('button', { name: 'Mais um', exact: true }).first().click()
    await page.getByRole('button', { name: 'Mais um', exact: true }).first().click()
    await page.getByRole('button', { name: 'Mais um', exact: true }).first().click()
    await page.waitForTimeout(400)
    const livre = await ver(page)
    // o texto (sem o ícone) numa linha só: os retângulos dele, todos na mesma altura
    const linhaUnica = await page.locator('.sacola-zap').evaluate((b) => {
      const texto = [...b.querySelector('span').childNodes].find((n) => n.nodeType === 3 && n.textContent.trim())
      if (!texto) return false
      const r = document.createRange()
      r.selectNodeContents(texto)
      return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size <= 1
    })
    conferir(
      travado.dentro && livre.dentro && !travado.lateral && !livre.lateral && livre.h <= 60 && linhaUnica,
      `${w}×${h}: o "Fechar pedido no WhatsApp" cabe numa linha, dentro da tela, travado e destravado (${livre.h} px)`,
    )
    if (w === 360) await foto(page, 'sacola-07-360-destravada')
    await ctx.close()
  }

  // ── computador: a sacola do lado, o mesmo caminho direto ───────────────────────────────────────────────────────
  {
    const ctx = await montar({ width: 1280, height: 860 })
    const page = await abrir(ctx, 'mg', ocb(4), 'sacola-pc')
    const v = await ver(page)
    conferir(v.ehLink && v.href?.startsWith(ZAP) && v.aviso === null, 'computador: 4 OCB em MG, o link direto do WhatsApp')
    await foto(page, 'sacola-08-pc')
    await ctx.close()
  }
}
