// LENDA v3.5 · suíte mobile — o PAINEL DO ADMIN no celular (emulação do Chromium do Playwright).
//
//   import { APARELHOS, abrir, entrar, medir, relatar, print, teclado, lento } from './painel-lib.mjs'
//
// Lê a pilha local que o painel-rodar.sh subiu (o segredos.env do $LENDA_PAINEL_BASE, pelo ../painel/lib.mjs: porta,
// banco, senha e token do painel). Aparelho = viewport + DPR + isMobile + hasTouch + user agent de verdade.
// medir() procura: rolagem lateral da página, elementos que passam da borda da janela (fora de uma caixa que rola),
// alvos de toque < 40 px, texto cortado sem reticências, campos com fonte < 16 px (zoom do Safari do iPhone) e o campo
// focado escondido pelo teclado. Só mexe na pilha local (nunca na produção).
const { chromium } = await import(process.env.LENDA_PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright/index.mjs')
import { mkdirSync } from 'node:fs'
import { BASE, PAINEL, env, sql } from '../painel/lib.mjs'

export { BASE, PAINEL, env, sql }
export const EXE = process.env.LENDA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
export const PRINTS = process.env.LENDA_PRINTS ?? '/tmp/claude-0/-home-user-multfiscal-releases/856de241-fe5b-5ff3-9843-1a584641489b/scratchpad/v35-mobile/painel'
mkdirSync(PRINTS, { recursive: true })
export const PIN_DONO = process.env.LENDA_PIN_DONO ?? '729153'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const IOS_SAFARI = (v) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v.replace(/_/g, '.')} Mobile/15E148 Safari/604.1`
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'

/** w×h = a janela que a página recebe. */
export const APARELHOS = {
  'iphone-se': { w: 375, h: 667, dpr: 2, ios: true, ua: IOS_SAFARI('17_7') },
  'iphone-14': { w: 390, h: 844, dpr: 3, ios: true, ua: IOS_SAFARI('18_6') },
  'galaxy-a': { w: 360, h: 800, dpr: 3, ua: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36' },
  'pixel-7': { w: 412, h: 915, dpr: 2.625, ua: CHROME_ANDROID },
  'pequeno-320': { w: 320, h: 640, dpr: 2, ua: 'Mozilla/5.0 (Linux; Android 9; SM-J260M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' },
  deitado: { w: 844, h: 390, dpr: 3, ios: true, ua: IOS_SAFARI('18_6') },
  'whatsapp-android': {
    w: 360,
    h: 700,
    dpr: 3,
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.107 Mobile Safari/537.36 WhatsApp/2.24.21.77',
  },
  'instagram-ios': {
    w: 390,
    h: 710,
    dpr: 3,
    ios: true,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 370.0.0.24.108 (iPhone15,2; iOS 18_6; pt_BR; pt; scale=3.00; 1179x2556; 705050118)',
  },
}

export const lancar = () => chromium.launch({ executablePath: EXE, args: ['--lang=pt-BR'] })

/**
 * Abre um aparelho (contexto novo). o.estado = storageState (sessão do painel já aberta); o.tema = 'claro'|'alto'
 * (preferência do aparelho no localStorage, como a de quem já trocou); o.lento = 4G lento + CPU 4×.
 */
export async function abrir(browser, nome, o = {}) {
  const a = APARELHOS[nome]
  if (!a) throw new Error(`aparelho desconhecido: ${nome}`)
  const ctx = await browser.newContext({
    viewport: { width: a.w, height: a.h },
    screen: { width: Math.min(a.w, a.h), height: Math.max(a.w, a.h) },
    deviceScaleFactor: a.dpr,
    isMobile: true,
    hasTouch: true,
    userAgent: a.ua,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: o.esquema ?? 'dark',
    storageState: o.estado ?? undefined,
  })
  if (o.tema) await ctx.addInitScript((t) => { try { const p = JSON.parse(localStorage.getItem('lenda:painel') || '{}'); p.tema = t; localStorage.setItem('lenda:painel', JSON.stringify(p)) } catch {} }, o.tema)
  await ctx.addInitScript(() => {
    window.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI))
    try {
      window.__longas = []
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longas.push({ t: Math.round(e.startTime), d: Math.round(e.duration), rota: location.hash }) }).observe({ type: 'longtask', buffered: true })
    } catch {}
  })
  const page = await ctx.newPage()
  const erros = []
  const rede = []
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    // 401/4xx esperados (entrada sem sessão, senha errada): ficam na lista da rede, não como erro de console
    if (/^Failed to load resource: the server responded with a status of 4\d\d/.test(t)) return
    erros.push(t)
  })
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`))
  page.on('response', (r) => { if (r.status() >= 500) rede.push(`${r.status()} ${r.url()}`) })
  page.on('requestfailed', (r) => rede.push(`falhou ${r.failure()?.errorText} ${r.url()}`))
  page.on('dialog', (d) => { page.__nativos = (page.__nativos ?? []).concat(d.message()); d.accept() })
  const cdp = await ctx.newCDPSession(page)
  if (o.lento) await lento(cdp)
  return { ctx, page, cdp, erros, rede, nome, a }
}

export async function lento(cdp, { cpu = 4, kbps = 1600, latencia = 150 } = {}) {
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: latencia, downloadThroughput: (kbps * 1000) / 8, uploadThroughput: (750 * 1000) / 8 })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
}
export async function semLentidao(cdp) {
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
}
export async function offline(cdp, sim) {
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: !!sim, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
}

/** Espera o painel decidir: tela de entrada ou painel aberto. */
export async function esperarDecisao(page, ms = 20000) {
  await page.waitForFunction(() => {
    const p = document.getElementById('tela-painel')
    const e = document.getElementById('tela-entrar')
    return !!p && !!e && (!p.hidden || !e.hidden)
  }, null, { timeout: ms })
}
/** Pulso chegou (o selo "atualizado às"). */
export async function esperarPulso(page, ms = 30000) {
  await page.waitForFunction(() => /atualizado às/.test(document.getElementById('selo-atualizado')?.textContent || ''), null, { timeout: ms })
}

/** Digita o PIN tocando na 1ª caixa (o teclado numérico do celular abre ali). */
export async function digitarPin(page, raiz, pin) {
  await page.locator(`${raiz} .pin-caixa`).first().tap()
  await page.keyboard.type(pin, { delay: 40 })
}

/** Entra pelo formulário (toque, não clique): senha do arquivo (Dono) ou e-mail + senha; PIN se pedir. */
export async function entrar(page, o = {}) {
  await page.goto(PAINEL)
  await esperarDecisao(page)
  if (await page.isVisible('#tela-painel')) return 'ja'
  if (o.email) { await page.locator('#email').tap(); await page.fill('#email', o.email) }
  await page.locator('#senha').tap()
  await page.fill('#senha', o.senha ?? env.PAINEL_SENHA)
  await page.locator('#botao-entrar').tap()
  await page.waitForSelector('#tela-painel:not([hidden]), #form-pin:not([hidden]), #form-criar-pin:not([hidden]), #form-trocar-senha:not([hidden]), #erro-entrar:not([hidden])', { timeout: 20000 })
  if (await page.isVisible('#form-pin')) {
    await digitarPin(page, '#pin-caixas', o.pin ?? PIN_DONO)
    await page.waitForSelector('#tela-painel:not([hidden]), #erro-pin:not([hidden])', { timeout: 20000 })
  }
  return (await page.isVisible('#tela-painel')) ? 'entrou' : 'parou'
}

/** Vai para a aba (pelo hash, como o toque no link) e espera a lista sair do "carregando". */
export async function irAba(page, hash, ms = 1500) {
  await page.evaluate((x) => { location.hash = x }, hash)
  await page.waitForTimeout(300)
  await page.waitForFunction(() => {
    const a = document.querySelector('.aba:not([hidden])')
    return a && !a.querySelector('.estado-carregando') && !a.classList.contains('esmaecido')
  }, null, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(ms)
}

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
/** Print aparelho_tela.png na pasta (o.inteira = a página toda). Devolve o caminho. */
export async function print(page, aparelho, tela, o = {}) {
  const dir = o.dir ?? PRINTS
  mkdirSync(dir, { recursive: true })
  const f = `${dir}/${slug(aparelho)}_${slug(tela)}.png`
  await page.screenshot({ path: f, fullPage: !!o.inteira, animations: 'disabled', timeout: 60000 }).catch(async (e) => {
    await page.screenshot({ path: f, timeout: 60000 }).catch(() => console.log(`  ..  print falhou (${tela}): ${e.message}`))
  })
  return f
}

/**
 * Medições da tela atual. Devolve { lateral, foraDaJanela[], pequenos[], cortados[], fonteCampo[], coberto, janela }.
 * o.raiz = onde procurar alvos e textos (padrão: o documento). o.todaPagina = alvos fora da janela também contam
 * (rolando a página, a pessoa chega neles).
 */
export async function medir(page, o = {}) {
  return page.evaluate(
    ({ raiz, minimo, todaPagina }) => {
      const de = document.documentElement
      const lateral = Math.max(de.scrollWidth, document.body.scrollWidth) - de.clientWidth
      const W = de.clientWidth
      const escondido = (el) => !!el.closest('[hidden],[aria-hidden="true"],.fora-da-tela,[inert],details:not([open]) > :not(summary)')
      const vis = (el, naJanela = !todaPagina) => {
        const r = el.getBoundingClientRect()
        if (r.width <= 2 || r.height <= 2) return null
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return null
        if (escondido(el)) return null
        if (naJanela && (r.bottom < 0 || r.top > innerHeight)) return null
        return r
      }
      const nomeDe = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.id || el.className || el.tagName).toString().replace(/\s+/g, ' ').trim().slice(0, 48)
      const caminho = (el) => {
        const p = []
        for (let e = el; e && e !== document.body && p.length < 4; e = e.parentElement) p.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.classList[0] ? '.' + e.classList[0] : ''))
        return p.join('>')
      }
      const base = raiz ? document.querySelector(raiz) : document
      // dentro de uma caixa que rola de lado (tabela, abas): passar da borda é esperado
      const rolaDeLado = (el) => {
        for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
          const cs = getComputedStyle(e)
          if (/auto|scroll|hidden|clip/.test(cs.overflowX) && e.scrollWidth >= e.clientWidth) return e
          if (cs.position === 'fixed') return null
        }
        return null
      }
      const foraDaJanela = []
      if (base) {
        for (const el of base.querySelectorAll('body *')) {
          if (el.closest('dialog:not([open])') || el.tagName === 'svg' || el.closest('svg')) continue
          const r = vis(el, false)
          if (!r) continue
          if (r.right <= W + 1 && r.left >= -1) continue
          const caixa = rolaDeLado(el)
          if (caixa) {
            const rc = caixa.getBoundingClientRect()
            if (rc.right <= W + 1 && rc.left >= -1) continue
          }
          if (foraDaJanela.some((f) => el.closest(f.sel))) continue
          const sel = caminho(el)
          foraDaJanela.push({ onde: sel, sel: el.id ? '#' + el.id : null, esq: Math.round(r.left), dir: Math.round(r.right), texto: nomeDe(el).slice(0, 40) })
          if (foraDaJanela.length > 12) break
        }
      }
      const pequenos = []
      if (base) {
        const sel = 'button, a[href], [role="button"], [role="tab"], [role="radio"], [role="switch"], input:not([type="hidden"]), select, textarea, summary, tr.clicavel'
        const vistos = new Set()
        for (const el of base.querySelectorAll(sel)) {
          if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue
          let r = vis(el)
          if (!r) continue
          if (el.closest('.fora-da-tela')) continue
          const caixa = /INPUT|TEXTAREA|SELECT/.test(el.tagName) ? el.closest('label') : null
          if (caixa && vis(caixa)) r = caixa.getBoundingClientRect()
          if (el.parentElement?.closest(sel) && vis(el.parentElement.closest(sel))) continue
          // link no meio de um parágrafo (texto corrido): fica de fora (WCAG 2.5.8, exceção "inline")
          if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.parentElement && /^(P|LI|SPAN|TD|DD|SMALL|FOOTER)$/.test(el.parentElement.tagName) && el.parentElement.textContent.trim().length > el.textContent.trim().length + 8) continue
          if (r.width + 0.5 >= minimo && r.height + 0.5 >= minimo) continue
          const k = `${nomeDe(el)}|${Math.round(r.width)}x${Math.round(r.height)}`
          if (vistos.has(k)) continue
          vistos.add(k)
          pequenos.push({ nome: nomeDe(el), w: Math.round(r.width), h: Math.round(r.height), onde: caminho(el), y: Math.round(r.top + scrollY) })
        }
      }
      const cortados = []
      for (const el of (base ?? document).querySelectorAll('body *')) {
        if (!el.childNodes.length || el.children.length > 2) continue
        const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
        if (txt.length < 2) continue
        const r = vis(el, false)
        if (!r) continue
        const cs = getComputedStyle(el)
        const escondeX = /hidden|clip/.test(cs.overflowX)
        const escondeY = /hidden|clip/.test(cs.overflowY)
        const passaX = el.scrollWidth > el.clientWidth + 1
        const passaY = el.scrollHeight > el.clientHeight + 4 && cs.webkitLineClamp === 'none'
        if ((escondeX && passaX && cs.textOverflow !== 'ellipsis') || (escondeY && passaY)) cortados.push({ texto: txt.slice(0, 50), onde: caminho(el), w: el.clientWidth, sw: el.scrollWidth, h: el.clientHeight, sh: el.scrollHeight })
        else if (escondeX && passaX && cs.textOverflow === 'ellipsis') cortados.push({ texto: txt.slice(0, 50), onde: caminho(el), reticencias: true })
        // texto que passa da caixa sem overflow escondido (vaza por cima do vizinho)
        else if (!escondeX && el.scrollWidth > el.clientWidth + 2 && cs.display !== 'inline' && el.clientWidth > 0 && !/auto|scroll/.test(cs.overflowX)) cortados.push({ texto: txt.slice(0, 50), onde: caminho(el), vaza: true, w: el.clientWidth, sw: el.scrollWidth })
      }
      // conteúdo que passa da própria caixa (overflow visível): vaza por cima do vizinho ou da borda do cartão
      let vazam = []
      for (const el of (base ?? document).querySelectorAll('body *')) {
        if (el.closest('svg') || el.closest('dialog:not([open])')) continue
        const cs = getComputedStyle(el)
        if (cs.display === 'inline' || cs.display === 'contents' || cs.overflowX !== 'visible') continue
        if (el.clientWidth < 1 || el.scrollWidth <= el.clientWidth + 2) continue
        if (!vis(el, false)) continue
        if (/^(TABLE|TBODY|THEAD|TR)$/.test(el.tagName) && !el.closest('.lista.cartoes')) continue
        vazam.push(el)
      }
      vazam = vazam.filter((el) => !vazam.some((o) => o !== el && el.contains(o)))
      const vazamInfo = vazam.slice(0, 12).map((el) => ({ onde: caminho(el), rotulo: el.dataset?.rotulo ?? null, texto: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40), w: el.clientWidth, sw: el.scrollWidth }))
      const fonteCampo = []
      for (const el of document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="range"]), textarea, select')) {
        const r = el.getBoundingClientRect()
        if (r.width < 4 || el.closest('[hidden]') || el.classList.contains('fora-da-tela')) continue
        const fs = parseFloat(getComputedStyle(el).fontSize)
        if (fs < 16) fonteCampo.push({ campo: el.id || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || el.type, fonte: fs })
      }
      let coberto = null
      const f = document.activeElement
      if (f && f !== document.body && /INPUT|TEXTAREA|SELECT/.test(f.tagName)) {
        const r = f.getBoundingClientRect()
        const vv = window.visualViewport
        const altura = vv ? vv.height : innerHeight
        const fora = r.top < 0 || r.bottom > altura
        const topo = !fora ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null
        coberto = { campo: f.id || f.getAttribute('aria-label') || f.getAttribute('placeholder'), top: Math.round(r.top), bottom: Math.round(r.bottom), altura: Math.round(altura), fora, porCima: topo && topo !== f && !f.contains(topo) && !topo.contains(f) ? caminho(topo) : null }
      }
      return { lateral, foraDaJanela: foraDaJanela.map(({ sel, ...x }) => x), pequenos: pequenos.slice(0, 60), cortados: cortados.slice(0, 30), vazam: vazamInfo, fonteCampo, coberto, janela: `${innerWidth}x${innerHeight}`, altura: de.scrollHeight }
    },
    { raiz: o.raiz ?? null, minimo: o.minimo ?? 40, todaPagina: o.todaPagina ?? true },
  )
}

/** Resumo curto de medir() no console; devolve a lista do que achou. */
export function relatar(rot, m, extra = {}) {
  const ach = []
  if (m.lateral > 0) ach.push(`ROLAGEM LATERAL de ${m.lateral}px`)
  if (m.foraDaJanela.length) ach.push(`passa da borda: ${m.foraDaJanela.slice(0, 4).map((f) => `${f.onde} [${f.esq}..${f.dir}] "${f.texto}"`).join(' · ')}`)
  if (m.pequenos.length && !extra.semAlvos) ach.push(`alvos < 40px (${m.pequenos.length}): ${m.pequenos.slice(0, 10).map((p) => `"${p.nome}" ${p.w}×${p.h}`).join(' · ')}`)
  const cort = m.cortados.filter((c) => !c.reticencias)
  if (cort.length) ach.push(`texto cortado/vazando: ${cort.slice(0, 6).map((c) => `"${c.texto}" (${c.onde} ${c.w}/${c.sw}${c.vaza ? ' vaza' : ''})`).join(' · ')}`)
  if (m.vazam?.length) ach.push(`conteúdo vaza da caixa (${m.vazam.length}): ${m.vazam.slice(0, 5).map((v) => `${v.rotulo ? '[' + v.rotulo + '] ' : ''}"${v.texto}" ${v.w}<${v.sw} (${v.onde})`).join(' · ')}`)
  if (extra.fonte && m.fonteCampo.length) ach.push(`campos < 16px (zoom do iPhone): ${[...new Set(m.fonteCampo.map((f) => `${f.campo} ${f.fonte}px`))].slice(0, 8).join(', ')}`)
  if (m.coberto && (m.coberto.fora || m.coberto.porCima)) ach.push(`CAMPO ESCONDIDO: ${JSON.stringify(m.coberto)}`)
  console.log(`  ${ach.length ? '!!' : 'ok'}  ${rot}${ach.length ? ': ' + ach.join(' | ') : ''}`)
  return ach
}

/**
 * Teclado virtual: a janela encolhe (WebView dos apps e Android com resizes-content). Depois de encolher, rola o campo
 * focado para dentro se ele ficou fora (como o Chromium faz). fr = fração da altura que o teclado ocupa.
 */
export async function teclado(page, a, aberto, fr = 0.42) {
  const h = aberto ? Math.round(a.h * (1 - fr)) : a.h
  await page.setViewportSize({ width: a.w, height: h })
  await sleep(250)
  if (aberto) await page.evaluate(() => {
    const f = document.activeElement
    if (!f || f === document.body) return
    const r = f.getBoundingClientRect()
    if (r.top < 0 || r.bottom > innerHeight) f.scrollIntoView({ block: 'center', inline: 'nearest' })
  })
  await sleep(250)
}

/** Tarefas longas desde `desde` (performance.now da página). */
export const longasDesde = (page, desde = 0) => page.evaluate((d) => (window.__longas ?? []).filter((l) => l.t >= d).map((l) => l.d), desde).catch(() => [])
export const agora = (page) => page.evaluate(() => performance.now()).catch(() => 0)
