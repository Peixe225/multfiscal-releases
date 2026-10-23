// A revelação do Teste minha sorte (rodada do scripts/revisao.mjs; pedido do Ian em 11/10, direção da 2ª rodada): a
// fumaça (RevelacaoFumaca) monta já no convite e espera; quando a tampa voa, o beck sobe de dentro da câmara desenhado
// por ela (data-beck: o meio dele, em px), é aceso, fumado, a fumaça anuncia o prêmio e a raridade pro leitor de tela, chega
// no auge (data-fase="pronto") e o story dos Melhores amigos sai dela (o produto voa até o lugar dele; a fumaça abre
// como cortina e sai da tela). Pular: um toque em qualquer lugar (inclusive no meio da fumaça) e o Enter (guardado se
// vier cedo) levam ao story pronto; os toques seguintes de quem tem pressa não apertam nada do story. Movimento
// reduzido: o quadro final parado, o story em corte seco e o foco no destaque. No build de produção o ?raridade= (só de
// desenvolvimento) é ignorado; com a loja do servidor (GC_LOJA_REAL), a raridade que vem nos dados chega na revelação.
// Desenho: um caminho só, em pixel no processador (data-desenho="pixel"), o mesmo com e sem placa de vídeo.

const URL_JOGO = (base, extra = '') => `${base}?uf=mg&jogo=sorte${extra}`

async function abrirEGirar(page, url) {
  await page.goto(url)
  await page.locator('.sorte [role="slider"]').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(700)
  await page.locator('.sorte [role="slider"]').first().focus()
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)
  }
}

/** O estado da revelação agora (o beck desenhado na fumaça, a fumaça, o story, o foco). */
const estado = (page) =>
  page.evaluate(() => {
    const fm = document.querySelector('.fm')
    const sorte = document.querySelector('.sorte')
    const q = document.querySelector('.story-premio')
    const cs = q ? getComputedStyle(q) : null
    return {
      fase: [...(sorte?.classList ?? [])].find((c) => /^sorte-(revelando|premio)$/.test(c)) ?? null,
      fm: fm ? { fase: fm.getAttribute('data-fase'), raridade: fm.getAttribute('data-raridade'), desenho: fm.getAttribute('data-desenho'), beck: fm.getAttribute('data-beck'), anuncio: fm.querySelector('.fm-sr')?.textContent ?? '' } : null,
      forcada: document.querySelector('.sorte-fumaca')?.hasAttribute('data-forcada') ?? false,
      story: q ? { vis: cs.visibility, op: +cs.opacity } : null,
      casca: !!document.querySelector('.casca'),
      foco: document.activeElement?.closest('.sp-titulo') ? 'destaque' : `${document.activeElement?.tagName ?? ''}.${document.activeElement?.className ?? ''}`,
      vivo: [...document.querySelectorAll('.sorte [aria-live]')].map((x) => x.textContent).join(' | '),
    }
  })

/** Espera a fumaça chegar numa fase (a cada quadro: o auge dura uns 0,4 s antes do story sair dela). */
const naFase = (page, fase, ms, comBeck = false) =>
  page
    .waitForFunction(
      ([f, b]) => {
        const fm = document.querySelector('.fm')
        return fm?.getAttribute('data-fase') === f && (!b || fm.hasAttribute('data-beck'))
      },
      [fase, comBeck],
      { polling: 'raf', timeout: ms },
    )
    .catch(() => {})

/** A fumaça saiu da tela (depois da cortina e do resto que sobe no fundo do story). */
const fumacaSaiu = (page, ms = 3500) =>
  page
    .locator('.fm')
    .waitFor({ state: 'detached', timeout: ms })
    .then(() => true)
    .catch(() => false)

export async function rodadaSorte({ browser, base, contexto, conferir, foto, vigiarSemRede }) {
  const novo = async (opts = {}) => {
    const ctx = await contexto(browser, { width: 390, height: 844 }, opts)
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
        sessionStorage.setItem('gc-abertura', '1')
        sessionStorage.setItem('gc-dica-hero', '1')
      } catch {
        /* ignora */
      }
    })
    return ctx
  }

  // 1) o fluxo inteiro, com o ?raridade= de desenvolvimento (o build de produção ignora)
  {
    const ctx = await novo()
    const page = await ctx.newPage()
    vigiarSemRede(page, 'sorte-fumaca')
    await page.goto(URL_JOGO(base, '&raridade=lendario'))
    await page.locator('.sorte [role="slider"]').first().waitFor({ timeout: 15000 })
    // a fumaça já está montada no convite, esperando (sem tocar em nada: o gesto é do dichavador)
    await page.locator('.fm[data-desenho]').waitFor({ timeout: 8000 }).catch(() => {})
    const pre = await estado(page)
    conferir(pre.fm?.fase === 'espera' && pre.fm?.desenho === 'pixel', `sorte: a fumaça monta no convite e espera, com o motor pronto (${pre.fm?.fase}, ${pre.fm?.desenho})`)
    await page.waitForTimeout(700)
    await page.locator('.sorte [role="slider"]').first().focus()
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(200)
    }
    await naFase(page, 'sobe', 4000, true)
    const a = await estado(page)
    // sai reto da boca da câmara nos primeiros 0,28 s (depois voa até a pose, no meio da tela)
    await page.waitForTimeout(130)
    const b = await estado(page)
    const ya = Number(a.fm?.beck)
    const yb = Number(b.fm?.beck)
    conferir(a.fase === 'sorte-revelando' && Number.isFinite(ya) && Number.isFinite(yb) && yb < ya - 30, `sorte: o beck sobe de dentro da câmara, desenhado pela fumaça (${a.fm?.beck} → ${b.fm?.beck})`)
    const dev = a.forcada
    conferir(!!a.fm && ['comum', 'raro', 'epico', 'lendario'].includes(a.fm.raridade ?? ''), `sorte: a fumaça recebe a raridade do prêmio no estalo (${a.fm?.raridade})`)
    conferir(dev ? a.fm?.raridade === 'lendario' : !a.forcada, dev ? 'sorte: em desenvolvimento, ?raridade=lendario força o lendário' : `sorte: no build de produção o ?raridade= é ignorado (saiu ${a.fm?.raridade}, a raridade dos dados)`)
    conferir(/pular/i.test(a.vivo), `sorte: o leitor de tela ouve que dá pra pular ("${a.vivo}")`)
    await naFase(page, 'pronto', 15000)
    const d = await estado(page)
    conferir(d.fm?.fase === 'pronto' && /^Prêmio (comum|raro|épico|lendário): .+, .+\.$/.test(d.fm?.anuncio ?? ''), `sorte: no auge o leitor de tela ouve o prêmio e a raridade ("${d.fm?.anuncio}")`)
    await foto(page, 'sorte-fumaca-auge')
    await page.locator('.sorte.sorte-premio').waitFor({ timeout: 6000 }).catch(() => {})
    await page.waitForTimeout(300)
    const e = await estado(page)
    conferir(e.fase === 'sorte-premio' && e.story?.vis === 'visible' && e.story.op === 1, `sorte: o story sai da fumaça (${JSON.stringify({ fase: e.fase, story: e.story })})`)
    conferir(await fumacaSaiu(page), 'sorte: a fumaça sai da tela depois do story (a cortina e o resto no fundo)')
    conferir(e.foco === 'destaque', `sorte: no fim o foco vai pro destaque do story (${e.foco})`)
    const selo = await page.locator('.story-premio [data-raridade-selo]').innerText().catch(() => '')
    conferir(/COMUM|RARO|ÉPICO|LENDÁRIO/.test(selo), `sorte: o story leva o carimbo da raridade (${selo.replace(/\s+/g, ' ')})`)
    const h3 = await page.locator('.story-premio .sp-titulo').textContent().catch(() => '')
    conferir(/Prêmio (comum|raro|épico|lendário)\./.test(h3 ?? ''), `sorte: o destaque do story (o foco) diz a raridade pro leitor de tela ("${(h3 ?? '').replace(/\s+/g, ' ').slice(0, 80)}")`)
    await foto(page, 'sorte-fumaca-story')
    await ctx.close()
  }

  // 2) um toque NO MEIO da fumaça pula pro story pronto; os toques seguintes (quem tem pressa) não apertam nada
  {
    const ctx = await novo()
    const page = await ctx.newPage()
    vigiarSemRede(page, 'sorte-fumaca-pular')
    await abrirEGirar(page, URL_JOGO(base))
    await page.locator('.fm[data-fase="puxada"]').waitFor({ timeout: 6000 }).catch(() => {})
    await page.touchscreen.tap(195, 420)
    // o 2º e o 3º toque, logo depois, onde vão ficar "Agora não" e "Guardar meu prêmio"
    for (const [x, y, ms] of [
      [315, 810, 180],
      [195, 758, 160],
    ]) {
      await page.waitForTimeout(ms)
      await page.touchscreen.tap(x, y)
    }
    await page.locator('.sorte.sorte-premio').waitFor({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(150)
    const e = await estado(page)
    conferir(e.fase === 'sorte-premio' && e.story?.vis === 'visible', `sorte: um toque no meio da fumaça pula pro story pronto (${JSON.stringify({ fase: e.fase, fm: !!e.fm })})`)
    conferir(e.casca && !(await page.locator('.sorte-cadastro').count()), `sorte: os toques seguintes não fecham o jogo nem abrem o cadastro (${e.casca ? 'aberto' : 'fechou'})`)
    conferir(/Prêmio (comum|raro|épico|lendário): /.test(e.vivo), `sorte: quem pula ouve o prêmio e a raridade ("${e.vivo.slice(0, 90)}")`)
    conferir(await fumacaSaiu(page), 'sorte: depois de pular, a fumaça sai da tela')
    await ctx.close()
  }

  // 3) o Enter pula também; o que vem cedo demais (logo depois das setas) fica guardado e vale na hora
  {
    const ctx = await novo()
    const page = await ctx.newPage()
    vigiarSemRede(page, 'sorte-fumaca-enter')
    await abrirEGirar(page, URL_JOGO(base))
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')
    await page.locator('.sorte.sorte-premio').waitFor({ timeout: 4000 }).catch(() => {})
    const e = await estado(page)
    conferir(e.fase === 'sorte-premio' && e.story?.vis === 'visible', `sorte: o Enter (mesmo cedo) pula pro story pronto (${e.fase})`)
    await page.waitForTimeout(400)
    const f = await estado(page)
    conferir(f.foco === 'destaque', `sorte: depois de pular o foco vai pro destaque (${f.foco})`)
    await ctx.close()
  }

  // 4) movimento reduzido: o dichavador aberto, o quadro final parado (fumaça desenhada + prêmio), o story e o foco
  {
    const ctx = await novo({ reduzir: true })
    const page = await ctx.newPage()
    vigiarSemRede(page, 'sorte-fumaca-reduzido')
    await abrirEGirar(page, URL_JOGO(base))
    await page.locator('.fm[data-fase="pronto"]').waitFor({ timeout: 4000 }).catch(() => {})
    const a = await estado(page)
    const cartao = await page.locator('.fm-cartao').evaluate((c) => +getComputedStyle(c).opacity).catch(() => 0)
    conferir(a.fm?.fase === 'pronto' && cartao === 1, `sorte: com movimento reduzido, a fumaça já no quadro final com o prêmio (${a.fm?.fase}, cartão ${cartao})`)
    await foto(page, 'sorte-fumaca-reduzido')
    await page.locator('.sorte.sorte-premio').waitFor({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(300)
    const b = await estado(page)
    conferir(b.fase === 'sorte-premio' && !b.fm, `sorte: com movimento reduzido, o story entra em corte seco (${b.fase})`)
    conferir(b.foco === 'destaque', `sorte: com movimento reduzido, o foco vai pro destaque (${b.foco})`)
    conferir(/Prêmio (comum|raro|épico|lendário): /.test(b.vivo), `sorte: com movimento reduzido, o leitor de tela ouve o prêmio e a raridade ("${b.vivo.slice(0, 90)}")`)
    await ctx.close()
  }

  // 5) com a loja do servidor: a raridade que vem nos dados do prêmio chega na revelação e no story (não some no caminho)
  if (process.env.GC_LOJA_REAL) {
    const ctx = await novo()
    await ctx.route(/\/api\/index\.php\?r=loja(&|$)/, async (r) => {
      const resp = await r.fetch()
      const j = await resp.json().catch(() => null)
      if (!j?.loja?.sorte?.premios) return r.fulfill({ response: resp })
      for (const p of j.loja.sorte.premios) p.raridade = 'raro'
      return r.fulfill({ response: resp, json: j })
    })
    const page = await ctx.newPage()
    vigiarSemRede(page, 'sorte-raridade-dados')
    await abrirEGirar(page, URL_JOGO(base))
    await page.locator('.fm[data-fase="puxada"]').waitFor({ timeout: 6000 }).catch(() => {})
    const a = await estado(page)
    conferir(a.fm?.raridade === 'raro', `sorte: a raridade dos dados do servidor chega na fumaça (${a.fm?.raridade})`)
    await page.keyboard.press('Enter')
    await page.locator('.sorte.sorte-premio').waitFor({ timeout: 4000 }).catch(() => {})
    const selo = await page.locator('.story-premio [data-raridade-selo]').innerText().catch(() => '')
    conferir(/RARO/.test(selo), `sorte: e no carimbo do story (${selo.replace(/\s+/g, ' ')})`)
    await ctx.close()
  }
}
