// Checagem do Teste minha sorte em 21 tamanhos: o story do prêmio (prêmio, "Ver condições" aberto e guardado) em
// celular em pé, celular deitado (do 568×320 ao 932×430, que já pega o layout de computador), tablet e computador
// (inclusive janela baixa de notebook). Em cada tela confere:
// - nada sai do quadro do story nem encavala (cabeçalho × destaque, destaque × adesivos, adesivos × "Ver condições",
//   um adesivo × o outro, produto × texto no story deitado);
// - todo botão do story e das ações dá pra tocar (o centro dele não fica coberto por outra coisa, nem fora da tela);
// - o adesivo trancado em no máximo 3 linhas; sem rolagem lateral; a coluna rola no máximo o tolerado;
// - o story não pula no fim da revelação (o lugar dele na revelação é o lugar final);
// - com "Ver condições" aberto: a lista dentro do quadro e da tela, o que ela cobre fora do Tab, Esc fecha só a lista.
// O prêmio sorteado é fixo (PREMIO=ocb|vidro|brinde|dichavador|bandeja; padrão ocb, o destaque mais comprido) e o
// código do cupom sai com as letras mais largas (SORTE-WMWM).
// Uso: npm run dev (ou vite preview) e depois: node scripts/sorte-tamanhos.mjs [pasta-saida] [url-base]
//      VP=915x412,568x320 node scripts/sorte-tamanhos.mjs   (só esses tamanhos)
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers'
const { chromium } = await import(new URL('../node_modules/playwright/index.mjs', import.meta.url).href)
import { mkdirSync } from 'node:fs'

const base = process.argv[3] ?? 'http://localhost:5173/'
const out = new URL(`../revisao/${process.argv[2] ?? 'sorte-tamanhos'}/`, import.meta.url).pathname
mkdirSync(out, { recursive: true })

// [nome, largura, altura, celular (toque)]
const TODOS = [
  ['se-320x568', 320, 568, true],
  ['android-360x640', 360, 640, true],
  ['ig-360x560', 360, 560, true],
  ['iphone8-375x667', 375, 667, true],
  ['iphone13-390x844', 390, 844, true],
  ['promax-430x932', 430, 932, true],
  ['deitado-568x320', 568, 320, true],
  ['deitado-640x360', 640, 360, true],
  ['deitado-667x375', 667, 375, true],
  ['deitado-740x360', 740, 360, true],
  ['deitado-812x375', 812, 375, true],
  ['deitado-844x390', 844, 390, true],
  ['deitado-915x412', 915, 412, true],
  ['deitado-932x430', 932, 430, true],
  ['tablet-768x1024', 768, 1024, true],
  ['note-1024x600', 1024, 600, false],
  ['note-1280x560', 1280, 560, false],
  ['note-1280x600', 1280, 600, false],
  ['note-1366x640', 1366, 640, false],
  ['note-1366x768', 1366, 768, false],
  ['desk-1440x900', 1440, 900, false],
]
const filtro = process.env.VP?.split(',')
const aparelhos = filtro ? TODOS.filter(([n]) => filtro.some((f) => n.endsWith(f))) : TODOS
/** Fração do sorteio (crypto.getRandomValues de 1 número) que cai em cada prêmio (pesos 30/20/25/15/10). */
const FRACAO = { ocb: 0.05, vidro: 0.4, brinde: 0.6, dichavador: 0.8, bandeja: 0.97 }
const premio = process.env.PREMIO ?? 'ocb'
/** Quanto a coluna pode rolar com o story na tela (px): só o celular deitado pequeno (568×320) rola um pouco. */
const ROLA_MAX = (w, h) => (h <= 320 ? 48 : 0)

const b = await chromium.launch()
const problemas = []

async function contexto(w, h, celular) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: celular, hasTouch: celular, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  await ctx.route(/ipwho|geojs/, (r) => r.fulfill({ json: { success: true, country_code: 'BR', region: 'Minas Gerais', region_code: 'MG' } }))
  await ctx.route(/brasilapi|viacep/, (r) => r.fulfill({ json: { erro: true } }))
  await ctx.addInitScript((f) => {
    try {
      localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
      sessionStorage.setItem('gc-abertura', '1')
      sessionStorage.setItem('gc-dica-hero', '1')
    } catch {
      /* ignora */
    }
    // o sorteio pede 1 número; o código do cupom pede 4: as letras mais largas (SORTE-WMWM), o pior caso do adesivo
    const orig = crypto.getRandomValues.bind(crypto)
    crypto.getRandomValues = (a) => {
      if (a instanceof Uint32Array && a.length === 1) {
        a[0] = Math.floor(f * 2 ** 32)
        return a
      }
      if (a instanceof Uint32Array && a.length === 4) {
        a.set([18, 10, 18, 10])
        return a
      }
      return orig(a)
    }
  }, FRACAO[premio] ?? FRACAO.ocb)
  return ctx
}

/** Medidas do story na tela: o que sai do quadro, o que encavala, o que não dá pra tocar. */
function medir() {
  const r = []
  const R = (el) => {
    if (!el) return null
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden]')) return null
    const b = el.getBoundingClientRect()
    return b.width && b.height ? b : null
  }
  const cruza = (a, c, folga = 1) => a && c && a.left < c.right - folga && a.right > c.left + folga && a.top < c.bottom - folga && a.bottom > c.top + folga
  const txt = (el) => (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 28)
  const de = document.documentElement
  if (de.scrollWidth > innerWidth + 1) r.push(`rolagem lateral na página (${de.scrollWidth} > ${innerWidth})`)
  const corpo = document.querySelector('.casca-corpo')
  const q = document.querySelector('.story-premio')
  const story = document.querySelector('.sorte-story')
  if (!corpo || !q || !story) return { problemas: ['o story do prêmio não apareceu'], info: {} }
  if (corpo.scrollWidth > corpo.clientWidth + 1) r.push(`rolagem lateral na coluna (${corpo.scrollWidth} > ${corpo.clientWidth})`)
  corpo.scrollTo({ top: 0 })
  const Q = q.getBoundingClientRect()
  const info = { modo: story.dataset.modo, quadro: `${Math.round(Q.width)}×${Math.round(Q.height)}`, rola: corpo.scrollHeight - corpo.clientHeight }
  // nada do story sai do quadro (o quadro corta: o que passa some)
  for (const el of q.querySelectorAll('*')) {
    if (el.closest('.sp-festa, .sr-only, canvas, [hidden]') || el.classList.contains('sr-only') || el.closest('.sp-brilho')) continue
    const e = R(el)
    if (!e || +getComputedStyle(el).opacity === 0) continue
    if (e.left < Q.left - 1 || e.right > Q.right + 1 || e.top < Q.top - 1 || e.bottom > Q.bottom + 1)
      r.push(`sai do quadro: ${el.getAttribute('class') ?? el.tagName} "${txt(el)}" [${Math.round(e.left)},${Math.round(e.top)},${Math.round(e.right)},${Math.round(e.bottom)}] quadro [${Math.round(Q.left)},${Math.round(Q.top)},${Math.round(Q.right)},${Math.round(Q.bottom)}]`)
  }
  // encavalados
  const um = (s) => R(q.querySelector(s))
  const cab = um('.sp-cab-txt') ?? um('.sp-cab')
  const titulo = um('.sp-titulo')
  const valor = um('.sp-valor')
  const alvo = um('.sp-alvo')
  const apoio = um('.sp-apoio')
  const codigo = um('[data-codigo] .ad-codigo')
  const contagem = um('[data-contagem]')
  // "Ver condições" / "Ver produto": o texto deles (o alvo de toque de 44 px pode passar por baixo de um adesivo torto)
  const textoDe = (el) => {
    if (!R(el)) return null
    const f = document.createRange()
    f.selectNodeContents(el)
    return f.getBoundingClientRect()
  }
  const linhaTxt = [textoDe(q.querySelector('.cond-botao')), textoDe(q.querySelector('.sp-ver'))].filter(Boolean)
  const linha = linhaTxt.length ? linhaTxt.reduce((a, c) => ({ left: Math.min(a.left, c.left), right: Math.max(a.right, c.right), top: Math.min(a.top, c.top), bottom: Math.max(a.bottom, c.bottom) })) : null
  const produto = um('.sp-produto')
  const deu = um('.sp-deu')
  const pares = [
    ['cabeçalho', cab, 'destaque', valor],
    ['cabeçalho', cab, 'produto (texto)', alvo],
    ['cabeçalho', cab, 'DEU SORTE!', deu],
    ['destaque', titulo, 'adesivo do código', codigo],
    ['destaque', titulo, 'adesivo da contagem', contagem],
    ['apoio', apoio, 'adesivo do código', codigo],
    ['apoio', apoio, 'adesivo da contagem', contagem],
    ['adesivo do código', codigo, 'adesivo da contagem', contagem],
    ['adesivo do código', codigo, 'Ver condições', linha],
    ['adesivo da contagem', contagem, 'Ver condições', linha],
    ['destaque', titulo, 'Ver condições', linha],
  ]
  if (info.modo === 'lado') pares.push(['produto', produto, 'destaque', titulo], ['produto', produto, 'adesivo do código', codigo], ['produto', produto, 'adesivo da contagem', contagem])
  for (const [na, a, nb, c] of pares) if (cruza(a, c, 2)) r.push(`encavala: ${na} × ${nb}`)
  // as ações por cima do pé ('sobre') não cobrem o texto do story
  const pe = document.querySelector('.sorte-pe')
  for (const bt of pe ? pe.querySelectorAll('button, .sorte-pe-nota') : []) {
    const a = R(bt)
    for (const [n, c] of [['Ver condições', linha], ['adesivo do código', codigo], ['adesivo da contagem', contagem], ['destaque', titulo]]) if (cruza(a, c, 2)) r.push(`ação "${txt(bt)}" cobre ${n}`)
  }
  // o texto dos botões cabe neles
  for (const bt of document.querySelectorAll('.sorte-pe .botao')) {
    if (!R(bt)) continue
    const cs = getComputedStyle(bt)
    const livre = bt.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    const f = document.createRange()
    f.selectNodeContents(bt)
    const largura = f.getBoundingClientRect().width
    if (largura > livre + 1) r.push(`o texto não cabe no botão "${txt(bt)}" (${Math.round(largura)} > ${Math.round(livre)})`)
  }
  // trancado: "Guarda pra liberar o código" em até 3 linhas
  const tr = q.querySelector('.ad-codigo-trancado .ad-codigo-txt')
  if (tr && R(tr)) {
    const linhas = Math.round(tr.getBoundingClientRect().height / (parseFloat(getComputedStyle(tr).lineHeight) || 16))
    info.trancado = linhas
    if (linhas > 3) r.push(`adesivo trancado em ${linhas} linhas`)
  }
  // "Ver condições" e "Ver produto" na mesma linha
  const cb = R(q.querySelector('.cond-botao'))
  const vp = R(q.querySelector('.sp-ver'))
  if (cb && vp && Math.abs(cb.top - vp.top) > 4) info.verProdutoEmbaixo = true
  // texto cortado (overflow escondido)
  for (const el of q.querySelectorAll('p, span, button, h3')) {
    if (el.closest('[hidden], .sr-only')) continue
    const cs = getComputedStyle(el)
    // reticências de propósito (o @ comprido no cabeçalho, como no Instagram) não contam
    if (cs.overflow !== 'visible' && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1) r.push(`texto cortado: "${txt(el)}" (${el.scrollWidth} > ${el.clientWidth})`)
  }
  return { problemas: r, info }
}

/** Todo botão do story e das ações: rola até ele (como a pessoa faria) e confere que o centro dele é ele mesmo. */
function alcance() {
  const r = []
  const corpo = document.querySelector('.casca-corpo')
  const botoes = [...document.querySelectorAll('.story-premio button, .sorte-pe button')].filter((b) => {
    const cs = getComputedStyle(b)
    return !b.closest('[hidden], [inert]') && cs.visibility !== 'hidden' && cs.display !== 'none' && b.getBoundingClientRect().width
  })
  for (const bt of botoes) {
    bt.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const e = bt.getBoundingClientRect()
    const c = corpo.getBoundingClientRect()
    const nome = (bt.textContent || bt.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 28)
    const x = e.left + e.width / 2
    const y = e.top + e.height / 2
    if (y < c.top || y > c.bottom || x < 0 || x > innerWidth) {
      r.push(`"${nome}" fora da área visível`)
      continue
    }
    const t = document.elementFromPoint(x, y)
    if (!t || (t !== bt && !bt.contains(t))) r.push(`"${nome}" coberto por ${t?.getAttribute('class') ?? t?.tagName}`)
    if (e.height < 40 && !bt.classList.contains('ad-codigo')) r.push(`"${nome}" com ${Math.round(e.height)} px de altura`)
  }
  corpo.scrollTo({ top: 0 })
  return r
}

const quadroAgora = (p) => p.evaluate(() => {
  const q = document.querySelector('.story-premio')?.getBoundingClientRect()
  return q ? { x: Math.round(q.left), y: Math.round(q.top), w: Math.round(q.width), h: Math.round(q.height) } : null
})

for (const [nome, w, h, celular] of aparelhos) {
  const ctx = await contexto(w, h, celular)
  const p = await ctx.newPage()
  const erros = []
  p.on('pageerror', (e) => erros.push(e.message))
  const prob = (s) => problemas.push(`${nome}: ${s}`)
  await p.goto(`${base}?uf=mg&jogo=sorte`)
  await p.locator('.sorte [role="slider"]').first().waitFor({ timeout: 15000 })
  await p.waitForTimeout(800)
  await p.locator('.sorte [role="slider"]').first().focus()
  for (let i = 0; i < 8; i++) {
    await p.keyboard.press('ArrowRight')
    await p.waitForTimeout(220)
  }
  // o lugar do story na revelação (antes do corte ele já está lá, escondido) = o lugar final
  await p.waitForTimeout(500)
  const naRevelacao = await quadroAgora(p)
  await p.waitForTimeout(3300)
  const final = await quadroAgora(p)
  if (naRevelacao && final && (Math.abs(naRevelacao.x - final.x) > 1 || Math.abs(naRevelacao.y - final.y) > 1 || naRevelacao.w !== final.w || naRevelacao.h !== final.h))
    prob(`o story pula no fim da revelação (${JSON.stringify(naRevelacao)} → ${JSON.stringify(final)})`)
  await p.screenshot({ path: `${out}${nome}-1-premio.png` })
  const m1 = await p.evaluate(medir)
  m1.problemas.forEach((s) => prob(`prêmio: ${s}`))
  if (m1.info.rola > ROLA_MAX(w, h)) prob(`prêmio: a coluna rola ${m1.info.rola} px`)
  ;(await p.evaluate(alcance)).forEach((s) => prob(`prêmio: ${s}`))

  // "Ver condições": abre por cima; o que fica coberto sai do Tab; Esc fecha só a lista e o foco volta pro botão
  const cond = p.locator('.story-premio .cond-botao')
  await cond.click({ timeout: 3000 }).catch((e) => prob(`não deu pra tocar em "Ver condições" (${e.message.split('\n')[0].slice(0, 90)})`))
  await p.waitForTimeout(350)
  await p.screenshot({ path: `${out}${nome}-2-condicoes.png` })
  const c = await p.evaluate(() => {
    const r = []
    const pn = document.querySelector('.story-premio .cond-painel')
    if (!pn || pn.hidden) return ['a lista não abriu']
    const e = pn.getBoundingClientRect()
    const q = document.querySelector('.story-premio').getBoundingClientRect()
    const corpo = document.querySelector('.casca-corpo').getBoundingClientRect()
    if (e.top < q.top - 1 || e.bottom > q.bottom + 1) r.push('a lista sai do quadro')
    if (e.top < corpo.top - 1 || e.bottom > corpo.bottom + 1) r.push('a lista sai da área visível')
    for (const el of document.querySelectorAll('.story-premio button, .story-premio [tabindex]')) {
      if (pn.contains(el) || el.closest('[inert], [hidden]') || el.tabIndex < 0) continue
      const a = el.getBoundingClientRect()
      if (a.width && a.left < e.right - 2 && a.right > e.left + 2 && a.top < e.bottom - 2 && a.bottom > e.top + 2) r.push(`"${(el.textContent || '').trim().slice(0, 24)}" coberto pela lista e ainda no Tab`)
    }
    return r
  })
  c.forEach((s) => prob(`condições: ${s}`))
  // teclado: Tab do botão vai pra lista; Shift+Tab do botão não cai em nada escondido debaixo dela
  await cond.focus()
  await p.keyboard.press('Tab')
  if (!(await p.evaluate(() => document.activeElement?.classList.contains('cond-painel')))) prob('condições: o Tab depois de "Ver condições" não vai pra lista')
  await cond.focus()
  await p.keyboard.press('Shift+Tab')
  const antes = await p.evaluate(() => {
    const a = document.activeElement
    if (!a || a === document.body) return null
    const e = a.getBoundingClientRect()
    const t = document.elementFromPoint(e.left + e.width / 2, e.top + e.height / 2)
    return { nome: (a.textContent || a.getAttribute('aria-label') || '').trim().slice(0, 24), visivel: !!t && (t === a || a.contains(t) || t.contains(a)) }
  })
  if (antes && !antes.visivel) prob(`condições: Shift+Tab de "Ver condições" foca "${antes.nome}", que está escondido`)
  await cond.focus()
  await p.keyboard.press('Escape')
  await p.waitForTimeout(250)
  const esc = await p.evaluate(() => ({ jogo: !!document.querySelector('.sorte'), aberta: !document.querySelector('.story-premio .cond-painel')?.hidden, foco: document.activeElement?.classList.contains('cond-botao') }))
  if (!esc.jogo) prob('Esc com a lista aberta fechou o jogo')
  else if (esc.aberta) prob('Esc não fechou a lista')
  else if (!esc.foco) prob('Esc fechou a lista mas o foco não voltou pro "Ver condições"')
  if (!esc.jogo) {
    await ctx.close()
    continue
  }

  // guardar: cadastro → guardado
  await p.locator('.sorte-pe .botao-cheio').click({ timeout: 3000 }).catch((e) => prob(`não deu pra tocar em "Guardar meu prêmio" (${e.message.split('\n')[0].slice(0, 90)})`))
  await p.waitForTimeout(700)
  await p.getByLabel('Teu nome').fill('Ian Teste')
  await p.getByLabel('Teu WhatsApp').fill('33991234567')
  await p.locator('.form-acoes .botao-cheio').click()
  await p.waitForTimeout(2200)
  await p.screenshot({ path: `${out}${nome}-3-guardado.png` })
  const m3 = await p.evaluate(medir)
  m3.problemas.forEach((s) => prob(`guardado: ${s}`))
  if (m3.info.rola > ROLA_MAX(w, h)) prob(`guardado: a coluna rola ${m3.info.rola} px`)
  ;(await p.evaluate(alcance)).forEach((s) => prob(`guardado: ${s}`))
  if (!celular && m1.info.modo !== m3.info.modo) prob(`o story muda de modo ao guardar (${m1.info.modo} → ${m3.info.modo})`)
  erros.forEach((e) => prob(`pageerror ${e}`))
  console.log(`${nome}: prêmio ${m1.info.modo} ${m1.info.quadro} rola ${m1.info.rola}${m1.info.trancado ? ` · trancado ${m1.info.trancado} linhas` : ''}${m1.info.verProdutoEmbaixo ? ' · Ver produto embaixo' : ''} | guardado ${m3.info.modo} ${m3.info.quadro} rola ${m3.info.rola}`)
  await ctx.close()
}
await b.close()

console.log(`\nprints em ${out}`)
if (problemas.length) {
  console.log(`\n${problemas.length} problema(s):\n- ${problemas.join('\n- ')}`)
  process.exitCode = 1
} else console.log('\nsem problemas')
