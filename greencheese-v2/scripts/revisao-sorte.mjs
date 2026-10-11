// A revelação do Teste minha sorte (rodada do scripts/revisao.mjs; pedido do Ian em 11/10): o beck sobe de dentro da
// câmara, a fumaça (RevelacaoFumaca) assume na emenda, anuncia o prêmio e a raridade pro leitor de tela, chega no auge
// (data-fase="pronto") e o story dos Melhores amigos sai dela; um toque e o Enter pulam pro story pronto; com movimento
// reduzido, o quadro final parado e o story; no build de produção o ?raridade= (só de desenvolvimento) é ignorado.
// Desenho: no headless o WebGL é de software e o site usa o canvas 2D (failIfMajorPerformanceCaveat): confere que um
// dos dois desenhou.

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

/** O estado da revelação agora (o beck do jogo, a fumaça, o story). */
const estado = (page) =>
  page.evaluate(() => {
    const beck = document.querySelector('.sorte-beck')
    const fm = document.querySelector('.fm')
    const sorte = document.querySelector('.sorte')
    const q = document.querySelector('.story-premio')
    const cs = q ? getComputedStyle(q) : null
    return {
      fase: [...(sorte?.classList ?? [])].find((c) => /^sorte-(revelando|premio)$/.test(c)) ?? null,
      beck: beck ? { y: Math.round(beck.getBoundingClientRect().top), vis: getComputedStyle(beck).visibility, op: +getComputedStyle(beck).opacity } : null,
      fm: fm ? { fase: fm.getAttribute('data-fase'), raridade: fm.getAttribute('data-raridade'), desenho: fm.getAttribute('data-desenho'), anuncio: fm.querySelector('.fm-sr')?.textContent ?? '' } : null,
      forcada: document.querySelector('.sorte-fumaca')?.hasAttribute('data-forcada') ?? false,
      story: q ? { vis: cs.visibility, op: +cs.opacity } : null,
      foco: document.activeElement?.closest('.sp-titulo') ? 'destaque' : (document.activeElement?.tagName ?? ''),
    }
  })

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
    await abrirEGirar(page, URL_JOGO(base, '&raridade=lendario'))
    await page.waitForTimeout(350)
    const a = await estado(page)
    await page.waitForTimeout(700)
    const b = await estado(page)
    conferir(a.fase === 'sorte-revelando' && a.beck && b.beck && b.beck.op > 0.5 && b.beck.y < a.beck.y - 40, `sorte: o beck sobe de dentro da câmara (${a.beck?.y} → ${b.beck?.y})`)
    await page.locator('.fm').waitFor({ timeout: 6000 })
    const c = await estado(page)
    conferir(!!c.fm && ['comum', 'raro', 'epico', 'lendario'].includes(c.fm.raridade ?? ''), `sorte: a fumaça assume na emenda com a raridade do prêmio (${c.fm?.raridade})`)
    const dev = c.forcada
    conferir(dev ? c.fm?.raridade === 'lendario' : !c.forcada, dev ? 'sorte: em desenvolvimento, ?raridade=lendario força o lendário' : `sorte: no build de produção o ?raridade= é ignorado (saiu ${c.fm?.raridade}, a raridade dos dados)`)
    await page.locator('.fm[data-desenho]').waitFor({ timeout: 6000 }).catch(() => {})
    const d0 = await estado(page)
    conferir(d0.fm?.desenho === 'gl' || d0.fm?.desenho === '2d', `sorte: a fumaça desenha (${d0.fm?.desenho}; sem placa de vídeo, canvas 2D)`)
    await page.locator('.fm[data-fase="pronto"]').waitFor({ timeout: 15000 }).catch(() => {})
    const d = await estado(page)
    conferir(d.fm?.fase === 'pronto' && /^Prêmio (comum|raro|épico|lendário): .+, .+\.$/.test(d.fm?.anuncio ?? ''), `sorte: no auge o leitor de tela ouve o prêmio e a raridade ("${d.fm?.anuncio}")`)
    await foto(page, 'sorte-fumaca-auge')
    await page.locator('.sorte.sorte-premio').waitFor({ timeout: 6000 }).catch(() => {})
    await page.waitForTimeout(400)
    const e = await estado(page)
    conferir(e.fase === 'sorte-premio' && !e.fm && e.story?.vis === 'visible' && e.story.op === 1, `sorte: o story sai da fumaça e a fumaça sai da tela (${JSON.stringify(e)})`)
    conferir(e.foco === 'destaque', `sorte: no fim o foco vai pro destaque do story (${e.foco})`)
    const selo = await page.locator('.story-premio [data-raridade-selo]').innerText().catch(() => '')
    conferir(/COMUM|RARO|ÉPICO|LENDÁRIO/.test(selo), `sorte: o story leva o carimbo da raridade (${selo.replace(/\s+/g, ' ')})`)
    await foto(page, 'sorte-fumaca-story')
    await ctx.close()
  }

  // 2) um toque na fumaça pula pro story pronto
  {
    const ctx = await novo()
    const page = await ctx.newPage()
    vigiarSemRede(page, 'sorte-fumaca-pular')
    await abrirEGirar(page, URL_JOGO(base))
    await page.locator('.fm').waitFor({ timeout: 6000 })
    await page.waitForTimeout(500)
    await page.touchscreen.tap(195, 600)
    await page.waitForTimeout(500)
    const e = await estado(page)
    conferir(e.fase === 'sorte-premio' && !e.fm && e.story?.vis === 'visible', `sorte: um toque na fumaça pula pro story pronto (${JSON.stringify({ fase: e.fase, fm: !!e.fm })})`)
    await ctx.close()
  }

  // 3) o Enter pula também (antes da emenda, no beck subindo)
  {
    const ctx = await novo()
    const page = await ctx.newPage()
    vigiarSemRede(page, 'sorte-fumaca-enter')
    await abrirEGirar(page, URL_JOGO(base))
    await page.waitForTimeout(1100)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    const e = await estado(page)
    conferir(e.fase === 'sorte-premio' && e.story?.vis === 'visible', `sorte: o Enter pula pro story pronto (${e.fase})`)
    await ctx.close()
  }

  // 4) movimento reduzido: o dichavador aberto, o quadro final parado (fumaça desenhada + prêmio) e o story
  {
    const ctx = await novo({ reduzir: true })
    const page = await ctx.newPage()
    vigiarSemRede(page, 'sorte-fumaca-reduzido')
    await abrirEGirar(page, URL_JOGO(base))
    await page.locator('.fm').waitFor({ timeout: 4000 })
    await page.waitForTimeout(250)
    const a = await estado(page)
    const cartao = await page.locator('.fm-cartao').evaluate((c) => +getComputedStyle(c).opacity).catch(() => 0)
    conferir(a.fm?.fase === 'pronto' && cartao === 1, `sorte: com movimento reduzido, a fumaça já no quadro final com o prêmio (${a.fm?.fase}, cartão ${cartao})`)
    await foto(page, 'sorte-fumaca-reduzido')
    await page.locator('.sorte.sorte-premio').waitFor({ timeout: 4000 }).catch(() => {})
    const b = await estado(page)
    conferir(b.fase === 'sorte-premio' && !b.fm, `sorte: com movimento reduzido, o story entra em corte seco (${b.fase})`)
    await ctx.close()
  }
}
