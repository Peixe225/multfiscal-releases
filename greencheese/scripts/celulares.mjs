// Matriz de celulares: rolagem lateral, alvos de toque, story cabendo na tela e gestos de toque reais.
// Uso: com "npm run dev" rodando → node scripts/celulares.mjs [pasta-saida]
import { chromium } from 'playwright'
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
for (const [nome, w, h] of aparelhos) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR' })
  await ctx.route(/ipwho|geojs/, (r) => r.fulfill({ json: { success: true, country_code: 'BR', region: 'Minas Gerais', region_code: 'MG' } }))
  const p = await ctx.newPage()
  p.on('pageerror', (e) => problemas.push(`${nome}: pageerror ${e.message}`))
  await p.goto(`${base}?uf=mg`)
  await p.getByRole('button', { name: 'Tenho', exact: true }).tap()
  await p.locator('.abertura').waitFor({ state: 'detached', timeout: 9000 })
  await p.waitForTimeout(700)
  await p.screenshot({ path: `${out}${nome}-1-hero.png` })
  // rolagem lateral
  const larg = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  if (larg[0] > larg[1]) problemas.push(`${nome}: rolagem lateral (${larg[0]} > ${larg[1]})`)
  // percorre a página procurando estouro lateral e alvos pequenos
  const ruins = await p.evaluate(async () => {
    const r = []
    const H = document.body.scrollHeight
    for (let y = 0; y < H; y += window.innerHeight * 0.8) {
      window.scrollTo(0, y)
      await new Promise((res) => setTimeout(res, 120))
    }
    window.scrollTo(0, 0)
    for (const el of document.querySelectorAll('main button, main a, main input, .barra-fixa button')) {
      const b = el.getBoundingClientRect()
      const st = getComputedStyle(el)
      if (st.visibility === 'hidden' || st.display === 'none' || b.width === 0) continue
      if (el.closest('[aria-hidden="true"]')) continue
      if (b.right > window.innerWidth + 1 || b.left < -1) r.push(`fora da tela: ${el.className || el.tagName} "${(el.textContent || '').trim().slice(0, 30)}" (${Math.round(b.left)}..${Math.round(b.right)})`)
      if ((b.height < 40 || b.width < 40) && !el.classList.contains('card-abrir')) r.push(`alvo pequeno ${Math.round(b.width)}×${Math.round(b.height)}: ${el.className || el.tagName} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`)
    }
    return [...new Set(r)]
  })
  // fora da tela em carrosséis horizontais (destaques, faixa) é esperado
  ruins.filter((x) => !/destaque|faixa-item/.test(x)).forEach((x) => problemas.push(`${nome}: ${x}`))
  // story: abre, cabe na tela, gestos
  await p.evaluate(() => document.querySelector('#catalogo')?.scrollIntoView())
  await p.waitForTimeout(500)
  const card = p.getByRole('button', { name: /Seda OCB Premium Slim.*Abrir story/ })
  await card.scrollIntoViewIfNeeded()
  await p.waitForTimeout(400)
  await card.click()
  await p.waitForTimeout(1100)
  await p.screenshot({ path: `${out}${nome}-2-story.png` })
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
  // chat: abre e o campo aparece
  await p.locator('.barra-fixa .barra-pilula').click()
  await p.waitForTimeout(700)
  await p.getByRole('button', { name: 'É daí', exact: true }).last().click()
  await p.waitForTimeout(300)
  await p.screenshot({ path: `${out}${nome}-3-chat.png` })
  const chips = await p.locator('.dm-atual .dm-chip').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return b.bottom <= window.innerHeight && b.right <= window.innerWidth }))
  if (chips.some((v) => !v)) problemas.push(`${nome}: resposta rápida fora da tela no chat`)
  await ctx.close()
  console.log('✓', nome)
}
await b.close()
console.log(problemas.length ? problemas.join('\n') : 'sem problemas')
