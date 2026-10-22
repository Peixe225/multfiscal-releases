// O cupom direto no pedido (rodada do scripts/revisao.mjs; pedido do Ian em 22/10: "Quando fechar o pedido tem que ir
// com o cupom diretamente"). O cupom ativo da conta que vale pra esta sacola neste estado entra sozinho, sem o cliente
// tocar em "Usar cupom": ao abrir a sacola, ao chegar no resumo do pedido guiado e na hora de fechar. Com mais de um, o
// que vence primeiro (empate: o de maior raridade), escolhido de novo a cada mudança enquanto foi ele que entrou sozinho
// (a OCB cai pra 3 e volta pra 4; chega um prêmio que vence antes). A linha do cupom diz que ele entrou sozinho (e "é o
// que vence primeiro" só quando é) e deixa trocar ou tirar, também pelo teclado (o foco não cai no <body>);
// o que o cliente tirou não volta sozinho naquele pedido (volta depois que a sacola é limpa); o que não vale pra esta
// sacola (falta produto, outro estado, vencido) não entra, e a dica de como usar continua. A mensagem do WhatsApp (sacola
// e guiado) leva a linha do cupom, a cópia que vai pro servidor leva o código e o "Já mandei"/"Mandei" marca o cupom
// como usado, como antes. Os caminhos: o cupom guardado na Minha conta (conta do aparelho e conta da loja, no
// servidor), o prêmio que acabou de sair no Teste minha sorte com o jogo fechado sem tocar em "Usar no pedido", o pedido
// rápido da sacola e o pedido guiado.

const ZAP = 'https://wa.me/5533991139036?text='
const mensagemDe = (href) => decodeURIComponent((href ?? '').split('text=')[1] ?? '')
const DIA = 864e5
const ZAP_CLIENTE = '5533977712345'

const RETRATOS = {
  ocb: { titulo: '4 por 3 na OCB', regra: 'Leva 4 Seda OCB Premium Slim e paga 3', aplicaA: { produtos: ['seda-ocb-premium-slim'] }, comoUsar: 'Põe 4 na sacola e usa o cupom.', tipo: 'leve-x-pague-y', valor: { leve: 4, pague: 3 }, raridade: 'comum' },
  bandeja: { titulo: '10% na bandeja', regra: '10% de desconto na Bandeja RAW pequena', aplicaA: { produtos: ['bandeja-raw-pequena'] }, tipo: 'desconto-percentual', valor: 10, raridade: 'comum' },
  dichavador: { titulo: '40% no dichavador', regra: '40% de desconto no Dichavador de metal 4 partes', aplicaA: { produtos: ['dichavador-metal-4-partes'] }, tipo: 'desconto-percentual', valor: 40, raridade: 'lendario' },
}
const PREMIO = { ocb: 'ocb-4-por-3', bandeja: 'bandeja-10', dichavador: 'dichavador-40' }
const linhaDo = (codigo, qual) => `Cupom: ${codigo} — ${RETRATOS[qual].regra} (Teste minha sorte · a loja confirma)`

/** Cupom da conta do aparelho (o formato de gc-conta). */
const cupom = (codigo, qual, validoAte, extra = {}) => ({ codigo, interativo: 'sorte', premioId: PREMIO[qual], retrato: RETRATOS[qual], demo: true, ganhoEm: Date.now() - DIA, validoAte, ...extra })
const contaLocal = (cupons) => ({
  state: {
    contas: { [ZAP_CLIENTE]: { conta: { id: 'local-1', nome: 'Duda Cupom', whatsapp: ZAP_CLIENTE, aceitaPromo: false, aceitaPromoEm: null, confirmou18Em: Date.now() - DIA, criadaEm: Date.now() - DIA }, cupons } },
    atual: ZAP_CLIENTE,
    giros: {},
    pendente: null,
    vistos: ['sorte'],
  },
  version: 1,
})
const ocb = (qtd) => ({ id: 'seda-ocb-premium-slim', variacao: null, qtd })

/**
 * @param {{ browser: import('playwright').Browser, base: string, contexto: Function, conferir: Function, foto: Function,
 *   vigiarSemRede: Function }} h
 */
export async function rodadaCupom({ browser, base, contexto, conferir, foto, vigiarSemRede }) {
  /** Os contextos do cenário (fecham no fim dele, mesmo quando um passo quebra). */
  const abertos = []
  /** Cada cenário roda até o fim ou até quebrar: o que quebrou vira um problema e o próximo cenário roda igual. */
  const cenario = async (nome, f) => {
    try {
      await f()
    } catch (e) {
      conferir(false, `${nome}: quebrou (${String(e?.message ?? e).split('\n')[0]})`)
    } finally {
      for (const c of abertos.splice(0)) await c.close().catch(() => {})
    }
  }
  /**
   * Um aparelho com a conta (e os cupons) e a sacola guardados. servidor: a conta da loja (o recursos com sessão, o
   * cliente-eu com os cupons, o POST pedido e o cliente-cupom-usar guardados em `api`).
   */
  const montar = async ({ viewport = { width: 390, height: 844 }, conta, sacola, servidor = null, reduzir = false } = {}) => {
    const ctx = await contexto(browser, viewport, { reduzir })
    abertos.push(ctx)
    ctx.setDefaultTimeout(8000)
    const api = { pedidos: [], usados: [] }
    await ctx.route('**/api/index.php?r=pedido', async (route) => {
      const req = route.request()
      if (req.method() !== 'POST') return route.fallback()
      let c = null
      try {
        c = JSON.parse(req.postData() ?? '')
      } catch {
        c = null
      }
      api.pedidos.push(c)
      return route.fulfill({ status: 201, json: { ok: true, pedido: { codigo: c?.codigo, tipo: c?.tipo, status: 'novo', criadoEm: new Date().toISOString() } } })
    })
    if (servidor) {
      const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
      const eu = () => ({
        conta: { id: '7', nome: 'Bia da Loja', whatsapp: ZAP_CLIENTE, aceitaPromo: false, aceitaPromoEm: null, confirmou18Em: iso(Date.now()), criadaEm: iso(Date.now()) },
        cupons: servidor.cupons.map((k) => ({ ...k, ganhoEm: iso(k.ganhoEm), validoAte: iso(k.validoAte), usadoEm: api.usados.includes(k.codigo) ? iso(Date.now()) : null, origem: 'giro' })),
        enderecos: [],
        dias: {},
      })
      await ctx.route(/\/api\/index\.php\?r=(recursos|cliente-eu|cliente-cupom-usar|cliente-giro)(&|$)/, async (route) => {
        const r = new URL(route.request().url()).searchParams.get('r')
        if (r === 'recursos') return route.fulfill({ json: { ok: true, contas: { codigo: true, sessao: true } } })
        if (r === 'cliente-eu') return route.fulfill({ json: { ok: true, agora: iso(Date.now()), ...eu() } })
        if (r === 'cliente-giro') return route.fulfill({ json: { ok: true, agora: iso(Date.now()), giro: { disponivel: true }, pendente: null, dias: [] } })
        const corpo = JSON.parse(route.request().postData() ?? '{}')
        api.usados.push(corpo.codigo)
        const k = eu().cupons.find((x) => x.codigo === corpo.codigo)
        return route.fulfill({ json: { ok: true, cupom: k } })
      })
    }
    await ctx.addInitScript(
      ([c, s, srv]) => {
        try {
          localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
          sessionStorage.setItem('gc-abertura', '1')
          sessionStorage.setItem('gc-dica-hero', '1')
          // a semente vai uma vez só por aba: recarregar fica com o que o site gravou
          if (!sessionStorage.getItem('gc-teste-semente')) {
            sessionStorage.setItem('gc-teste-semente', '1')
            if (c) localStorage.setItem('gc-conta', JSON.stringify(srv ? { ...c, state: { ...c.state, servidor: c.state.atual, enderecos: [] } } : c))
            if (s) localStorage.setItem('gc-sacola', JSON.stringify({ state: { itens: s, ultimo: [], cupom: null }, version: 0 }))
          }
        } catch {
          /* ignora */
        }
        // o toque no WhatsApp fica no site: guarda o link que abriria
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
      },
      [conta ?? null, sacola ?? null, !!servidor],
    )
    return { ctx, api }
  }
  const abrirSacola = async (page) => {
    // a volta do WhatsApp (a página recarregada até 2 h depois do toque) já reabre a sacola sozinha
    if (!(await page.locator('.sacola-fechar').count())) await page.locator('.barra-abas [data-aba="sacola"]:visible, .lateral-item:has-text("Sacola"):visible').first().click()
    await page.locator('.sacola-fechar').waitFor({ timeout: 8000 })
    await page.waitForTimeout(600)
  }
  const fecharSacola = async (page) => {
    await page.keyboard.press('Escape')
    await page.locator('.sacola-fechar').waitFor({ state: 'detached', timeout: 6000 }).catch(() => {})
    await page.waitForTimeout(400)
  }
  /** A sacola agora: a linha do cupom e a mensagem que o botão abriria. */
  const naSacola = (page) =>
    page.evaluate(() => {
      const c = document.querySelector('.sacola .cupom-sacola, .folha .cupom-sacola')
      const b = document.querySelector('.sacola-zap')
      return {
        cupom: c ? { classe: c.className, texto: c.textContent?.replace(/\s+/g, ' ').trim() ?? '' } : null,
        href: b?.getAttribute('href') ?? null,
        botoes: [...(c?.querySelectorAll('button') ?? [])].map((x) => x.getAttribute('aria-label') || x.textContent?.trim()),
      }
    })
  const guardado = (page, chave) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.state ?? null, chave)
  /** Tocar no "Fechar pedido no WhatsApp" e devolver a mensagem que abriria. */
  const tocarZap = async (page) => {
    await page.evaluate(() => (window.__zap = null))
    await page.locator('a.sacola-zap').click()
    await page.waitForTimeout(500)
    return mensagemDe(await page.evaluate(() => window.__zap))
  }
  const esperar = async (page, f, ms = 4000) => {
    for (let i = 0; i < ms / 100 && !f(); i++) await page.waitForTimeout(100)
    return f()
  }

  // ── 1) conta do aparelho, cupom guardado na Minha conta, pedido rápido: entra sozinho, a mensagem leva ───────────
  await cenario('cupom guardado, pedido rápido', async () => {
    const { ctx, api } = await montar({ conta: contaLocal([cupom('SORTE-K8EA', 'ocb', Date.now() + 5 * DIA)]), sacola: [ocb(4)] })
    const page = await ctx.newPage()
    vigiarSemRede(page, 'cupom-sacola')
    await page.goto(`${base}?uf=mg`)
    await page.waitForTimeout(1200)
    await abrirSacola(page)
    let s = await naSacola(page)
    conferir(/cs-ok/.test(s.cupom?.classe ?? '') && /SORTE-K8EA/.test(s.cupom?.texto ?? ''), `sacola: o cupom guardado que vale entra sozinho, sem tocar em "Usar cupom" (${s.cupom?.texto ?? 'sem linha do cupom'})`)
    conferir(/[Ee]ntrou sozinho/.test(s.cupom?.texto ?? ''), `sacola: a linha do cupom diz que ele entrou sozinho (${s.cupom?.texto ?? ''})`)
    conferir(s.botoes.some((b) => /Tirar o cupom SORTE-K8EA/.test(b ?? '')), `sacola: a linha deixa tirar o cupom (${s.botoes.join(' | ')})`)
    conferir(mensagemDe(s.href).split('\n').includes(linhaDo('SORTE-K8EA', 'ocb')), `sacola: o link do WhatsApp já sai com a linha do cupom ("${mensagemDe(s.href).replace(/\n/g, ' / ')}")`)
    await foto(page, 'cupom-01-sacola-entrou-sozinho')
    const n0 = api.pedidos.length
    const msg = await tocarZap(page)
    conferir(msg.split('\n')[0] === 'PEDIDO GREEN CHEESE — MG / Teófilo Otoni' && msg.split('\n').includes(linhaDo('SORTE-K8EA', 'ocb')), `sacola: tocar em fechar abre o WhatsApp com a linha do cupom ("${msg.replace(/\n/g, ' / ')}")`)
    await esperar(page, () => api.pedidos.length > n0)
    const corpo = api.pedidos[n0]
    conferir(corpo?.origem === 'sacola' && corpo?.cupom?.codigo === 'SORTE-K8EA' && corpo?.mensagem === msg, `sacola: a cópia que vai pro servidor leva o código do cupom e a mesma mensagem (${JSON.stringify(corpo?.cupom ?? null)})`)
    // o "Já mandei" marca o cupom como usado, como antes
    await page.getByRole('button', { name: 'Já mandei: limpar a sacola', exact: true }).click()
    await page.waitForTimeout(600)
    const conta = await guardado(page, 'gc-conta')
    const k = conta?.contas?.[ZAP_CLIENTE]?.cupons?.find((x) => x.codigo === 'SORTE-K8EA')
    conferir(!!k?.usadoEm, `sacola: "Já mandei" marca o cupom que foi no pedido como usado (${k?.usadoEm ? 'usado' : 'não marcou'})`)
  })

  // ── 2) mais de um que vale: o que vence primeiro; empate, o de maior raridade; trocar ─────────────────────────────
  await cenario('mais de um cupom', async () => {
    const vence = Date.now() + 2 * DIA
    const cupons = [cupom('SORTE-AAA3', 'ocb', Date.now() + 5 * DIA), cupom('SORTE-BBB4', 'bandeja', vence), cupom('SORTE-CCC6', 'dichavador', vence)]
    const itens = [ocb(4), { id: 'bandeja-raw-pequena', variacao: null, qtd: 1 }, { id: 'dichavador-metal-4-partes', variacao: null, qtd: 1 }]
    const { ctx } = await montar({ conta: contaLocal(cupons), sacola: itens })
    const page = await ctx.newPage()
    vigiarSemRede(page, 'cupom-dois')
    await page.goto(`${base}?uf=mg`)
    await page.waitForTimeout(1200)
    await abrirSacola(page)
    let s = await naSacola(page)
    conferir(/SORTE-CCC6/.test(s.cupom?.texto ?? '') && mensagemDe(s.href).split('\n').includes(linhaDo('SORTE-CCC6', 'dichavador')), `dois vencem no mesmo dia: entra o de maior raridade (o lendário SORTE-CCC6), não o comum nem o que vence depois (${s.cupom?.texto ?? 'nenhum'})`)
    conferir(/vence primeiro/.test(s.cupom?.texto ?? ''), `com mais de um, a linha diz que entrou o que vence primeiro (${s.cupom?.texto ?? ''})`)
    await foto(page, 'cupom-02-sacola-vence-primeiro')
    const trocar = page.getByRole('button', { name: 'Trocar o cupom SORTE-CCC6', exact: true })
    conferir((await trocar.count()) === 1, 'com outro cupom que vale, a linha deixa trocar')
    if (await trocar.count()) {
      await trocar.click()
      await page.waitForTimeout(400)
      await foto(page, 'cupom-03-sacola-trocar')
      await page.locator('.cupom-sacola .cs-chip', { hasText: 'SORTE-AAA3' }).first().click()
      await page.waitForTimeout(500)
      s = await naSacola(page)
      conferir(/SORTE-AAA3/.test(s.cupom?.texto ?? '') && !/[Ee]ntrou sozinho/.test(s.cupom?.texto ?? '') && mensagemDe(s.href).split('\n').includes(linhaDo('SORTE-AAA3', 'ocb')), `trocar: o escolhido entra no lugar (sem o "entrou sozinho") e a mensagem leva ele (${s.cupom?.texto ?? ''})`)
      // fechar e abrir de novo não volta pro automático
      await fecharSacola(page)
      await abrirSacola(page)
      s = await naSacola(page)
      conferir(/SORTE-AAA3/.test(s.cupom?.texto ?? ''), `o cupom que o cliente escolheu fica (fechar e abrir a sacola não troca pelo automático) (${s.cupom?.texto ?? ''})`)
    }
  })

  // ── 2b) o que entrou sozinho é reescolhido: a OCB cai pra 3 e volta pra 4 → fica de novo o que vence primeiro ─────
  // (revisão de 22/10: com o automático ainda valendo, ele não era reescolhido, e a linha dizia "é o que vence
  // primeiro" de um cupom que vencia depois)
  const bandeja = { id: 'bandeja-raw-pequena', variacao: null, qtd: 1 }
  const noZap = (s) => mensagemDe(s.href).split('\n').filter((l) => l.startsWith('Cupom')).join(' / ') || 'sem cupom'
  await cenario('o automático é reescolhido', async () => {
    const cupons = [cupom('SORTE-AAA3', 'ocb', Date.now() + 2 * DIA), cupom('SORTE-BBB4', 'bandeja', Date.now() + 5 * DIA)]
    const { ctx } = await montar({ conta: contaLocal(cupons), sacola: [ocb(4), bandeja] })
    const page = await ctx.newPage()
    vigiarSemRede(page, 'cupom-reescolhe')
    await page.goto(`${base}?uf=mg`)
    await page.waitForTimeout(1200)
    await abrirSacola(page)
    const grupo = page.locator('[role="group"][aria-label="Quantidade de Seda OCB Premium Slim"]')
    let s = await naSacola(page)
    conferir(/SORTE-AAA3/.test(s.cupom?.texto ?? ''), `reescolhe: com as 4 OCB entra o que vence primeiro (SORTE-AAA3) (${s.cupom?.texto ?? 'nenhum'})`)
    await grupo.getByRole('button', { name: 'Menos um' }).click()
    await page.waitForTimeout(500)
    s = await naSacola(page)
    conferir(/SORTE-BBB4/.test(s.cupom?.texto ?? '') && mensagemDe(s.href).split('\n').includes(linhaDo('SORTE-BBB4', 'bandeja')), `reescolhe: com 3 OCB o da OCB deixa de valer e entra o da bandeja (${noZap(s)})`)
    await grupo.getByRole('button', { name: 'Mais um' }).click()
    await page.waitForTimeout(500)
    s = await naSacola(page)
    const linhas = mensagemDe(s.href).split('\n')
    conferir(
      /SORTE-AAA3/.test(s.cupom?.texto ?? '') && /vence primeiro/.test(s.cupom?.texto ?? '') && linhas.includes(linhaDo('SORTE-AAA3', 'ocb')) && !linhas.some((l) => l.includes('SORTE-BBB4')),
      `reescolhe: com as 4 OCB de volta, o automático volta pro que vence primeiro (SORTE-AAA3) e a mensagem leva ele (${s.cupom?.texto ?? 'nenhum'} · ${noZap(s)})`,
    )
    await foto(page, 'cupom-02a-sacola-reescolhe')
    await fecharSacola(page)
    await abrirSacola(page)
    s = await naSacola(page)
    conferir(/SORTE-AAA3/.test(s.cupom?.texto ?? ''), `reescolhe: fechar e abrir a sacola fica no SORTE-AAA3 (${s.cupom?.texto ?? 'nenhum'})`)
  })

  // ── 2c) com o automático na sacola, o jogo guarda um prêmio que vence antes (validade de 1 dia): ele entra no lugar ─
  await cenario('prêmio novo que vence antes', async () => {
    const { ctx } = await montar({ viewport: { width: 360, height: 740 }, conta: contaLocal([cupom('SORTE-AAA3', 'ocb', Date.now() + 6 * DIA)]), sacola: [ocb(4), bandeja] })
    const page = await ctx.newPage()
    vigiarSemRede(page, 'cupom-premio-novo')
    await page.goto(`${base}?uf=mg`)
    await page.waitForTimeout(1200)
    await abrirSacola(page)
    let s = await naSacola(page)
    conferir(/SORTE-AAA3/.test(s.cupom?.texto ?? '') && /[Ee]ntrou sozinho/.test(s.cupom?.texto ?? ''), `prêmio novo: antes, o SORTE-AAA3 entrou sozinho (${s.cupom?.texto ?? 'nenhum'})`)
    await fecharSacola(page)
    const conta = await guardado(page, 'gc-conta')
    conta.contas[ZAP_CLIENTE].cupons.push(cupom('SORTE-BBB4', 'bandeja', Date.now() + DIA, { ganhoEm: Date.now() }))
    await page.evaluate((st) => localStorage.setItem('gc-conta', JSON.stringify({ state: st, version: 1 })), conta)
    await page.reload()
    await page.waitForTimeout(1500)
    await abrirSacola(page)
    s = await naSacola(page)
    conferir(
      /SORTE-BBB4/.test(s.cupom?.texto ?? '') && /Entrou sozinho: é o que vence primeiro/.test(s.cupom?.texto ?? '') && mensagemDe(s.href).split('\n').includes(linhaDo('SORTE-BBB4', 'bandeja')),
      `prêmio novo: o que vence amanhã (SORTE-BBB4) entra no lugar do automático, e a mensagem leva ele (${s.cupom?.texto ?? 'nenhum'} · ${noZap(s)})`,
    )
    await foto(page, 'cupom-02b-sacola-premio-novo-360')
  })

  // ── 2d) a linha só diz "é o que vence primeiro" quando é: o cliente tirou um que vence antes e ganhou outro depois ──
  await cenario('vence primeiro só quando é', async () => {
    const { ctx } = await montar({ conta: contaLocal([cupom('SORTE-AAA3', 'ocb', Date.now() + 2 * DIA)]), sacola: [ocb(4), bandeja] })
    const page = await ctx.newPage()
    vigiarSemRede(page, 'cupom-vence-primeiro')
    await page.goto(`${base}?uf=mg`)
    await page.waitForTimeout(1200)
    await abrirSacola(page)
    await page.getByRole('button', { name: 'Tirar o cupom SORTE-AAA3', exact: true }).click()
    await page.waitForTimeout(400)
    await fecharSacola(page)
    const conta = await guardado(page, 'gc-conta')
    conta.contas[ZAP_CLIENTE].cupons.push(cupom('SORTE-CCC5', 'bandeja', Date.now() + 5 * DIA, { ganhoEm: Date.now() }))
    await page.evaluate((st) => localStorage.setItem('gc-conta', JSON.stringify({ state: st, version: 1 })), conta)
    await page.reload()
    await page.waitForTimeout(1500)
    await abrirSacola(page)
    const s = await naSacola(page)
    conferir(
      /SORTE-CCC5/.test(s.cupom?.texto ?? '') && /[Ee]ntrou sozinho/.test(s.cupom?.texto ?? '') && !/vence primeiro/.test(s.cupom?.texto ?? ''),
      `tirou o que vence antes e ganhou outro: o novo entra sozinho, e a linha não diz que ele "é o que vence primeiro" (o tirado vence antes) (${s.cupom?.texto ?? 'nenhum'})`,
    )
    await foto(page, 'cupom-02c-sacola-sem-vence-primeiro')
  })

  // ── 3) tirou: não volta sozinho naquele pedido (nem recarregando); volta depois que a sacola é limpa ─────────────
  await cenario('tirou o cupom', async () => {
    const { ctx } = await montar({ conta: contaLocal([cupom('SORTE-K8EA', 'ocb', Date.now() + 5 * DIA)]), sacola: [ocb(4)] })
    const page = await ctx.newPage()
    vigiarSemRede(page, 'cupom-tirou')
    await page.goto(`${base}?uf=mg`)
    await page.waitForTimeout(1200)
    await abrirSacola(page)
    await page.getByRole('button', { name: 'Tirar o cupom SORTE-K8EA', exact: true }).click()
    await page.waitForTimeout(500)
    let s = await naSacola(page)
    conferir(!/cs-ok/.test(s.cupom?.classe ?? '') && !mensagemDe(s.href).includes('Cupom:'), `tirou: a mensagem sai sem o cupom (${s.cupom?.texto ?? 'sem linha'})`)
    conferir(/cs-usar/.test(s.cupom?.classe ?? '') && /SORTE-K8EA/.test(s.cupom?.texto ?? ''), `tirou: o "Usar cupom" continua ali pra pôr de volta com um toque (${s.cupom?.texto ?? ''})`)
    await foto(page, 'cupom-04-sacola-tirou')
    await fecharSacola(page)
    await abrirSacola(page)
    s = await naSacola(page)
    conferir(!/cs-ok/.test(s.cupom?.classe ?? '') && !mensagemDe(s.href).includes('Cupom:'), 'tirou: fechar e abrir a sacola não põe ele de volta')
    await page.reload()
    await page.waitForTimeout(1500)
    await abrirSacola(page)
    s = await naSacola(page)
    conferir(!/cs-ok/.test(s.cupom?.classe ?? '') && !mensagemDe(s.href).includes('Cupom:'), 'tirou: nem recarregando a página (fica guardado com a sacola)')
    // fechou sem cupom e limpou a sacola: o próximo pedido começa do zero (o cupom não foi usado, então entra de novo)
    const msg = await tocarZap(page)
    conferir(!msg.includes('Cupom:'), 'tirou: o pedido vai pro WhatsApp sem a linha do cupom')
    await page.getByRole('button', { name: 'Já mandei: limpar a sacola', exact: true }).click()
    await page.waitForTimeout(600)
    const conta = await guardado(page, 'gc-conta')
    conferir(!conta?.contas?.[ZAP_CLIENTE]?.cupons?.[0]?.usadoEm, 'tirou: o cupom que não foi no pedido continua sem uso')
    const sac = await guardado(page, 'gc-sacola')
    await page.evaluate((st) => localStorage.setItem('gc-sacola', JSON.stringify({ state: { ...st, itens: [{ id: 'seda-ocb-premium-slim', variacao: null, qtd: 4 }] }, version: 0 })), sac)
    await page.reload()
    await page.waitForTimeout(1500)
    await abrirSacola(page)
    s = await naSacola(page)
    conferir(/cs-ok/.test(s.cupom?.classe ?? '') && /SORTE-K8EA/.test(s.cupom?.texto ?? ''), `depois de limpar a sacola, o pedido novo recebe o cupom sozinho de novo (${s.cupom?.texto ?? 'nenhum'})`)
  })

  // ── 4) o que não vale não entra (falta produto, vencido, outro estado); a dica continua ──────────────────────────
  {
    const casos = [
      { nome: 'falta 2 OCB', uf: 'mg', cupons: [cupom('SORTE-K8EA', 'ocb', Date.now() + 5 * DIA)], itens: [ocb(2)], usar: true },
      { nome: 'vencido', uf: 'mg', cupons: [cupom('SORTE-K8EA', 'ocb', Date.now() - DIA)], itens: [ocb(4)], usar: false },
      { nome: 'produto do cupom não tem no RJ', uf: 'rj', cupons: [cupom('SORTE-CCC6', 'dichavador', Date.now() + 5 * DIA)], itens: [ocb(4)], usar: true },
    ]
    for (const c of casos) await cenario(`cupom que não vale (${c.nome})`, async () => {
      const { ctx } = await montar({ conta: contaLocal(c.cupons), sacola: c.itens })
      const page = await ctx.newPage()
      vigiarSemRede(page, `cupom-nao-vale-${c.nome}`)
      await page.goto(`${base}?uf=${c.uf}`)
      await page.waitForTimeout(1200)
      await abrirSacola(page)
      const s = await naSacola(page)
      conferir(!/cs-ok|cs-aviso/.test(s.cupom?.classe ?? '') && !mensagemDe(s.href).includes('Cupom:'), `não vale (${c.nome}): o cupom não entra sozinho e a mensagem vai sem ele (${s.cupom?.texto ?? 'sem linha'})`)
      if (c.usar) conferir(/cs-usar/.test(s.cupom?.classe ?? ''), `não vale (${c.nome}): a dica de como usar continua (o "Usar cupom" com o cupom)`)
      if (c.nome === 'falta 2 OCB') {
        await foto(page, 'cupom-05-sacola-nao-vale')
        // tocar nele mostra como fazer valer (como antes): "Pôr mais 2"
        await page.locator('.cupom-sacola .cs-chip', { hasText: 'SORTE-K8EA' }).first().click()
        await page.waitForTimeout(500)
        const t = await naSacola(page)
        conferir(/são 4/.test(t.cupom?.texto ?? '') && t.botoes.some((b) => /Pôr mais 2/.test(b ?? '')), `não vale: tocar no cupom mostra o que falta e o "Pôr mais 2" (${t.cupom?.texto ?? ''})`)
        await page.getByRole('button', { name: 'Pôr mais 2', exact: true }).click()
        await page.waitForTimeout(500)
        const u = await naSacola(page)
        conferir(/cs-ok/.test(u.cupom?.classe ?? '') && mensagemDe(u.href).split('\n').includes(linhaDo('SORTE-K8EA', 'ocb')), 'não vale: com as 4 na sacola o cupom vale e vai na mensagem')
      }
    })
  }

  // ── 5) pedido guiado: o cupom entra sozinho no resumo; a mensagem e a cópia levam; "Mandei" marca usado ──────────
  await cenario('pedido guiado', async () => {
    const { ctx, api } = await montar({ conta: contaLocal([cupom('SORTE-K8EA', 'ocb', Date.now() + 5 * DIA)]), sacola: [ocb(4)] })
    const page = await ctx.newPage()
    vigiarSemRede(page, 'cupom-guiado')
    const clicar = async (nome) => {
      await page.getByRole('button', { name: nome, exact: true }).last().click()
      await page.waitForTimeout(450)
    }
    const digitar = async (t) => {
      await page.locator('.dm-entrada input').fill(t)
      await page.locator('.dm-entrada').evaluate((f) => f.requestSubmit())
      await page.waitForTimeout(650)
    }
    // direto no guiado, sem abrir a sacola antes
    await page.goto(`${base}?uf=mg&chat=pedido`)
    await page.locator('[aria-modal="true"][aria-label="Pedido guiado"]').waitFor({ timeout: 10000 })
    await page.waitForTimeout(1000)
    await clicar('Isso')
    await clicar('Tá certo')
    await digitar('Ian Teste')
    await digitar('39800000')
    await page.waitForTimeout(600)
    await digitar('120')
    await clicar('Pix')
    await digitar('Portão azul')
    await page.waitForTimeout(800)
    const r = await page.evaluate(() => ({
      msg: document.querySelector('.folha-chat pre.dm-mensagem')?.textContent ?? '',
      bolhas: [...document.querySelectorAll('.folha-chat .dm-atual .dm-loja')].map((b) => b.textContent?.replace(/\s+/g, ' ').trim()),
      chips: [...document.querySelectorAll('.folha-chat .dm-atual .dm-chip')].map((b) => b.textContent?.trim()),
      href: document.querySelector('.folha-chat a.dm-zap')?.getAttribute('href') ?? '',
    }))
    conferir(r.msg.split('\n').includes(linhaDo('SORTE-K8EA', 'ocb')) && mensagemDe(r.href) === r.msg, `guiado: no resumo o cupom entra sozinho e a mensagem (e o link) leva a linha dele ("${r.msg.replace(/\n/g, ' / ')}")`)
    conferir(r.bolhas.some((b) => /SORTE-K8EA/.test(b ?? '') && /sozinho/.test(b ?? '')), `guiado: a fala diz que o cupom entrou sozinho (${r.bolhas.join(' | ')})`)
    conferir(r.chips.includes('Tirar cupom') && !r.chips.includes('Usar cupom'), `guiado: dá pra tirar, sem perguntar "Usa nesse pedido?" (${r.chips.join(' | ')})`)
    await foto(page, 'cupom-06-guiado-resumo')
    const n0 = api.pedidos.length
    await page.locator('.folha-chat a.dm-zap').click()
    await esperar(page, () => api.pedidos.length > n0)
    const corpo = api.pedidos[n0]
    conferir(corpo?.origem === 'guiado' && corpo?.cupom?.codigo === 'SORTE-K8EA' && corpo?.mensagem === r.msg, `guiado: a cópia do pedido leva o código do cupom (${JSON.stringify(corpo?.cupom ?? null)})`)
    await page.waitForTimeout(800)
    await clicar('Mandei')
    await page.waitForTimeout(800)
    const conta = await guardado(page, 'gc-conta')
    conferir(!!conta?.contas?.[ZAP_CLIENTE]?.cupons?.[0]?.usadoEm, 'guiado: "Mandei" marca o cupom como usado, como antes')
  })

  // ── 5b) pedido guiado com dois cupons que valem: "Trocar cupom" pergunta qual vai e a mensagem leva o escolhido ─────
  await cenario('pedido guiado, trocar', async () => {
    const cupons = [cupom('SORTE-K8EA', 'ocb', Date.now() + 5 * DIA), cupom('SORTE-BBB4', 'bandeja', Date.now() + 6 * DIA)]
    const { ctx } = await montar({ conta: contaLocal(cupons), sacola: [ocb(4), { id: 'bandeja-raw-pequena', variacao: null, qtd: 1 }] })
    const page = await ctx.newPage()
    vigiarSemRede(page, 'cupom-guiado-trocar')
    const clicar = async (nome) => {
      await page.getByRole('button', { name: nome, exact: true }).last().click()
      await page.waitForTimeout(450)
    }
    const digitar = async (t) => {
      await page.locator('.dm-entrada input').fill(t)
      await page.locator('.dm-entrada').evaluate((f) => f.requestSubmit())
      await page.waitForTimeout(650)
    }
    await page.goto(`${base}?uf=mg&chat=pedido`)
    await page.locator('[aria-modal="true"][aria-label="Pedido guiado"]').waitFor({ timeout: 10000 })
    await page.waitForTimeout(1000)
    await clicar('Isso')
    await clicar('Tá certo')
    await digitar('Ian Teste')
    await digitar('39800000')
    await page.waitForTimeout(600)
    await digitar('120')
    await clicar('Pix')
    await digitar('Portão azul')
    await page.waitForTimeout(800)
    const msg = () => page.evaluate(() => document.querySelector('.folha-chat pre.dm-mensagem')?.textContent ?? '')
    conferir((await msg()).includes('Cupom: SORTE-K8EA'), 'guiado com dois: entra o que vence primeiro (SORTE-K8EA)')
    // pelo teclado: o chip tocado some com o toque, e o foco não pode cair no <body> (revisão de 22/10)
    const focado = () => page.evaluate(() => ({ txt: document.activeElement?.textContent?.trim().slice(0, 80) ?? '', tag: document.activeElement?.tagName, naFolha: !!document.activeElement?.closest('.folha-chat') }))
    await page.getByRole('button', { name: 'Trocar cupom', exact: true }).last().focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(450)
    const f1 = await focado()
    conferir(f1.naFolha && f1.txt.startsWith('SORTE-BBB4'), `guiado, teclado: "Trocar cupom" leva o foco pro 1º cupom da pergunta (${JSON.stringify(f1)})`)
    const qual = await page.evaluate(() => [...document.querySelectorAll('.folha-chat .dm-atual .dm-loja')].some((b) => /Qual cupom vai nesse pedido/.test(b.textContent ?? '')))
    conferir(qual, 'guiado: "Trocar cupom" pergunta qual cupom vai')
    await foto(page, 'cupom-06b-guiado-trocar')
    if (f1.txt.startsWith('SORTE-BBB4')) await page.keyboard.press('Enter')
    else await page.locator('.folha-chat .dm-atual .dm-chip', { hasText: 'SORTE-BBB4' }).last().click()
    await page.waitForTimeout(600)
    const f2 = await focado()
    conferir(f2.naFolha && f2.txt === 'Trocar cupom', `guiado, teclado: escolhido o cupom, o foco volta pro "Trocar cupom" (${JSON.stringify(f2)})`)
    const m2 = await msg()
    const href = mensagemDe(await page.evaluate(() => document.querySelector('.folha-chat a.dm-zap')?.getAttribute('href') ?? ''))
    conferir(m2.split('\n').includes(linhaDo('SORTE-BBB4', 'bandeja')) && !m2.includes('SORTE-K8EA') && href === m2, `guiado: o escolhido vai na mensagem no lugar do automático ("${m2.replace(/\n/g, ' / ')}")`)
  })

  // ── 6) conta da loja (servidor): o cupom da conta entra sozinho; a cópia leva o código; o usado vai pro servidor ──
  await cenario('conta da loja', async () => {
    const k = { codigo: 'SORTE-SRV7', interativo: 'sorte', premioId: 'ocb-4-por-3', retrato: RETRATOS.ocb, demo: true, ganhoEm: Date.now() - DIA, validoAte: Date.now() + 4 * DIA }
    const { ctx, api } = await montar({ conta: contaLocal([k]), sacola: [ocb(4)], servidor: { cupons: [k] } })
    const page = await ctx.newPage()
    vigiarSemRede(page, 'cupom-servidor')
    await page.goto(`${base}?uf=mg`)
    await page.waitForTimeout(1800)
    await abrirSacola(page)
    const s = await naSacola(page)
    conferir(/cs-ok/.test(s.cupom?.classe ?? '') && /SORTE-SRV7/.test(s.cupom?.texto ?? '') && mensagemDe(s.href).split('\n').includes(linhaDo('SORTE-SRV7', 'ocb')), `conta da loja: o cupom da conta entra sozinho e vai na mensagem (${s.cupom?.texto ?? 'nenhum'})`)
    const n0 = api.pedidos.length
    const msg = await tocarZap(page)
    await esperar(page, () => api.pedidos.length > n0)
    conferir(api.pedidos[n0]?.cupom?.codigo === 'SORTE-SRV7' && api.pedidos[n0]?.whatsapp && msg.includes('Cupom: SORTE-SRV7'), `conta da loja: a cópia leva o código do cupom e o WhatsApp da conta (${JSON.stringify(api.pedidos[n0]?.cupom ?? null)})`)
    await page.getByRole('button', { name: 'Já mandei: limpar a sacola', exact: true }).click()
    await esperar(page, () => api.usados.length > 0)
    conferir(api.usados[0] === 'SORTE-SRV7', `conta da loja: "Já mandei" marca o cupom como usado no servidor (cliente-cupom-usar ${api.usados[0] ?? 'não chamado'})`)
  })

  // ── 7) ganhou no Teste minha sorte e fechou o jogo sem "Usar no pedido": entra sozinho quando abre a sacola ──────
  await cenario('jogo fechado', async () => {
    const { ctx } = await montar({ conta: contaLocal([]), reduzir: true })
    const page = await ctx.newPage()
    vigiarSemRede(page, 'cupom-jogo')
    await page.goto(`${base}?uf=mg&jogo=sorte`)
    const slider = page.locator('.sorte [role="slider"]').first()
    await slider.waitFor({ timeout: 15000 })
    await page.waitForTimeout(700)
    await slider.focus()
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(200)
    }
    let ganho = null
    for (let i = 0; i < 80 && !ganho; i++) {
      await page.waitForTimeout(250)
      ganho = (await guardado(page, 'gc-conta'))?.contas?.[ZAP_CLIENTE]?.cupons?.[0] ?? null
    }
    conferir(!!ganho, `jogo: o giro com conta guardou o cupom (${ganho?.codigo ?? 'nenhum'})`)
    if (ganho) {
      await page.waitForTimeout(1200)
      await foto(page, 'cupom-07-jogo-premio')
      // fecha o jogo sem tocar em "Usar no pedido"
      await page.keyboard.press('Escape')
      await page.locator('.sorte').waitFor({ state: 'detached', timeout: 6000 }).catch(() => {})
      await page.waitForTimeout(500)
      // a sacola com o que o cupom pede (o produto, ou um da categoria; o "leva X" com X)
      const r = ganho.retrato
      const id = r.aplicaA.produtos?.[0] ?? (r.aplicaA.categorias?.includes('sedas') ? 'seda-ocb-premium-slim' : null)
      const qtd = r.tipo === 'leve-x-pague-y' ? r.valor.leve : 1
      const sac = await guardado(page, 'gc-sacola')
      await page.evaluate(([st, i, q]) => localStorage.setItem('gc-sacola', JSON.stringify({ state: { ...(st ?? { ultimo: [], cupom: null }), itens: [{ id: i, variacao: null, qtd: q }] }, version: 0 })), [sac, id, qtd])
      await page.goto(`${base}?uf=mg`)
      await page.waitForTimeout(1500)
      await abrirSacola(page)
      const s = await naSacola(page)
      conferir(/cs-ok/.test(s.cupom?.classe ?? '') && new RegExp(ganho.codigo).test(s.cupom?.texto ?? '') && mensagemDe(s.href).includes(`Cupom: ${ganho.codigo} — ${r.regra}`), `jogo: o prêmio de hoje (${ganho.codigo}, ${r.regra}) entra sozinho na sacola, sem ter tocado em "Usar no pedido" (${s.cupom?.texto ?? 'nenhum'})`)
      await foto(page, 'cupom-08-jogo-depois-sacola')
    }
  })

  // ── 8) o pedido que já foi pro WhatsApp não muda sozinho (nada de código novo por cima do "Já mandou?") ──────────
  await cenario('pedido que já foi', async () => {
    const { ctx } = await montar({ conta: contaLocal([]), sacola: [ocb(4)] })
    const page = await ctx.newPage()
    vigiarSemRede(page, 'cupom-ja-foi')
    await page.goto(`${base}?uf=mg`)
    await page.waitForTimeout(1200)
    await abrirSacola(page)
    const msg = await tocarZap(page)
    await fecharSacola(page)
    // o cupom aparece na conta depois (ganhou em outra aba, por exemplo) e a página recarrega
    const conta = await guardado(page, 'gc-conta')
    conta.contas[ZAP_CLIENTE].cupons = [cupom('SORTE-K8EA', 'ocb', Date.now() + 5 * DIA)]
    await page.evaluate((st) => localStorage.setItem('gc-conta', JSON.stringify({ state: st, version: 1 })), conta)
    await page.reload()
    await page.waitForTimeout(1500)
    await abrirSacola(page)
    const s = await naSacola(page)
    const jaMandou = await page.locator('.sacola-enviado').count()
    conferir(jaMandou === 1 && mensagemDe(s.href) === msg && !/cs-ok/.test(s.cupom?.classe ?? ''), `o pedido que já foi pro WhatsApp não ganha o cupom sozinho por cima (continua o "Já mandou?" com a mesma mensagem) (${s.cupom?.texto ?? 'sem linha'})`)
  })

  // ── 9) a linha do cupom no celular de 360 e no computador ───────────────────────────────────────────────────────
  for (const vp of [{ width: 360, height: 740 }, { width: 1280, height: 800 }]) await cenario(`a linha do cupom em ${vp.width}`, async () => {
    const cupons = [cupom('SORTE-AAA3', 'ocb', Date.now() + 5 * DIA), cupom('SORTE-CCC6', 'dichavador', Date.now() + 2 * DIA)]
    const { ctx } = await montar({ viewport: vp, conta: contaLocal(cupons), sacola: [ocb(4), { id: 'dichavador-metal-4-partes', variacao: null, qtd: 1 }] })
    const page = await ctx.newPage()
    vigiarSemRede(page, `cupom-${vp.width}`)
    await page.goto(`${base}?uf=mg`)
    await page.waitForTimeout(1500)
    await abrirSacola(page)
    const g = await page.evaluate(() => {
      const c = document.querySelector('.cupom-sacola')?.getBoundingClientRect()
      const bs = [...document.querySelectorAll('.cupom-sacola button')].map((b) => b.getBoundingClientRect())
      return { c: c ? { l: c.left, r: c.right } : null, alvos: bs.map((b) => Math.round(Math.min(b.width, b.height))), lateral: document.documentElement.scrollWidth > innerWidth + 0.5, w: innerWidth }
    })
    conferir(!!g.c && g.c.l >= -0.5 && g.c.r <= g.w + 0.5 && !g.lateral && g.alvos.every((a) => a >= 24), `${vp.width}: a linha do cupom cabe, sem rolagem lateral, os botões dá pra tocar (${JSON.stringify(g)})`)
    await foto(page, `cupom-09-sacola-${vp.width}`)
    if (vp.width >= 1024) {
      // teclado: "Trocar" → o 1º cupom → Enter; o foco fica na linha do cupom novo, no "Trocar" dele (revisão de 22/10:
      // o chip escolhido sumia e o foco caía no <body>)
      const focado = () => page.evaluate(() => ({ rotulo: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim().slice(0, 40), naLinha: !!document.activeElement?.closest('.cupom-sacola'), naSacola: !!document.activeElement?.closest('.sacola, .folha') }))
      await page.getByRole('button', { name: 'Trocar o cupom SORTE-CCC6', exact: true }).focus()
      await page.keyboard.press('Enter')
      await page.waitForTimeout(400)
      const f1 = await focado()
      conferir(f1.naLinha && /^SORTE-AAA3/.test(f1.rotulo ?? ''), `${vp.width}, teclado: "Trocar" leva o foco pro 1º cupom da lista (${JSON.stringify(f1)})`)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(500)
      const f2 = await focado()
      conferir(f2.naSacola && f2.rotulo === 'Trocar o cupom SORTE-AAA3', `${vp.width}, teclado: escolhido no "Trocar por", o foco fica na linha do cupom novo ("Trocar o cupom SORTE-AAA3") (${JSON.stringify(f2)})`)
      await foto(page, `cupom-09b-sacola-${vp.width}-teclado`)
    }
  })
}
