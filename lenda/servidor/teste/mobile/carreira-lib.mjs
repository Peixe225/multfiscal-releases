// LENDA v3.5 · suíte mobile — utilidades para jogar a carreira do Clássico pelo celular (emulação do Chromium).
//
//   import { APARELHOS, abrir, lento, medir, print } from './carreira-lib.mjs'
//
// Aparelho = viewport + DPR + isMobile + hasTouch + user agent de verdade. "Lento" = 4G lento do CDP (≈1,6 Mb/s,
// 150 ms) + processador 4× mais lento. medir() procura rolagem lateral, alvos de toque < 40 px (contando a área
// invisível de ::before/::after), texto cortado sem reticências, campos com fonte < 16 px (zoom do iOS) e
// elementos fixos por cima do campo focado. Nada aqui escreve no servidor.
import { mkdirSync } from 'node:fs'
import { APARELHOS, TODOS, EXE, PLAYWRIGHT, pastaPrints, religarToque, ARGS_TLS, barreiraProd, slug, ouvirErros, inesperados, placar } from './aparelhos.mjs'
const { chromium } = await import(PLAYWRIGHT)

export { APARELHOS, EXE, religarToque, barreiraProd, inesperados, placar }
export const URL0 = (process.env.LENDA_URL ?? 'http://127.0.0.1:9110/lenda/').replace(/\/?$/, '/')
export const PRINTS = pastaPrints('carreira')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Ajustes do jogo para o teste: som ligado (é o padrão), animações do jeito que a pessoa vê. */
export const AJUSTES_PADRAO = JSON.stringify({ state: { settings: { sound: true, volume: 0.7, skipAnimations: false, reducedMotion: null, lowFx: false, engine: 'auto' } }, version: 1 })

/**
 * Abre um aparelho (contexto novo: storage próprio). o.lento = 4G lento + CPU 4×. o.bloquearApi = aborta /api/
 * (produção: nada chega ao servidor, nem a medição de visitas). o.share: 'falso' = navigator.share de mentira
 * que aceita arquivo (como no Android/iOS); omitido = o do Chromium do Linux (não existe, como num WebView).
 */
export async function abrir(browser, nome, o = {}) {
  const a = TODOS[nome]
  if (!a) throw new Error(`aparelho desconhecido: ${nome}`)
  const ctx = await browser.newContext({
    viewport: { width: a.w, height: a.h },
    screen: { width: Math.min(a.w, a.h) === a.w ? a.w : a.h, height: Math.max(a.w, a.h) === a.h ? a.h : a.w },
    deviceScaleFactor: a.dpr,
    isMobile: !a.desktop,
    hasTouch: !a.desktop,
    userAgent: a.ua,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    acceptDownloads: true,
    // LENDA_IGNORAR_TLS=1: o servidor HTTP/2 de teste (ferramentas/servidor-h2.mjs) tem certificado autoassinado
    ignoreHTTPSErrors: !!process.env.LENDA_IGNORAR_TLS,
  })
  // produção: só leitura (o e.php respondido aqui com 204; escrita para /api/ barrada) — ver aparelhos.mjs
  const barrados = o.prod ? await barreiraProd(ctx) : []
  await ctx.addInitScript(
    ({ ajustes, share }) => {
      try {
        if (ajustes && !localStorage.getItem('lenda:settings')) localStorage.setItem('lenda:settings', ajustes)
      } catch {}
      try {
        Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true })
      } catch {}
      // som: conta os AudioContext e o estado deles (o jogo cria no primeiro toque)
      try {
        const AC = window.AudioContext
        window.__sons = { ctx: 0, estados: [], tons: 0 }
        window.AudioContext = class extends AC {
          constructor(...x) {
            super(...x)
            window.__sons.ctx++
            window.__sonsCtx = this
            this.addEventListener('statechange', () => window.__sons.estados.push(this.state))
          }
          createOscillator() {
            window.__sons.tons++
            return super.createOscillator()
          }
        }
      } catch {}
      // trava: tarefas longas (PerformanceObserver longtask) e o maior intervalo entre quadros
      try {
        window.__longas = []
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__longas.push({ t: Math.round(e.startTime), d: Math.round(e.duration), rota: location.hash })
        }).observe({ type: 'longtask', buffered: true })
      } catch {}
      // semente fixa da carreira (o randomSeed do jogo pede um Uint32Array(2)) quando o teste arma: sessionStorage
      // 'teste:sementes' = [[a0, a1], …] e 'teste:armado' = '1' logo antes do "Confirmar" (igual ao integracao/lib.mjs)
      try {
        const orig = crypto.getRandomValues.bind(crypto)
        crypto.getRandomValues = (arr) => {
          try {
            const fila = JSON.parse(sessionStorage.getItem('teste:sementes') || '[]')
            if (arr instanceof Uint32Array && arr.length === 2 && fila.length && sessionStorage.getItem('teste:armado') === '1') {
              const [x, y] = fila.shift()
              sessionStorage.setItem('teste:sementes', JSON.stringify(fila))
              sessionStorage.removeItem('teste:armado')
              arr[0] = x
              arr[1] = y
              return arr
            }
          } catch {}
          return orig(arr)
        }
      } catch {}
      // a hora do último toque (para medir quanto o Compartilhar demorou a chamar o navigator.share)
      addEventListener('pointerup', () => (window.__toqueEm = performance.now()), true)
      if (share === 'falso') {
        Object.defineProperty(navigator, 'canShare', { value: (d) => !!d, configurable: true })
        Object.defineProperty(navigator, 'share', {
          value: async (d) => {
            // ativa = ainda dentro da "ativação do usuário" do toque (o Chrome dá ~5 s; o Safari é mais curto):
            // fora dela, o navigator.share de verdade recusa com NotAllowedError
            window.__compartilhado = { n: (window.__compartilhado?.n ?? 0) + 1, ativa: navigator.userActivation?.isActive ?? null, aposToqueMs: window.__toqueEm ? Math.round(performance.now() - window.__toqueEm) : null, texto: d?.text ?? '', url: d?.url ?? '', arquivos: (d?.files ?? []).map((f) => `${f.name} ${f.type} ${f.size}`) }
          },
          configurable: true,
        })
      }
    },
    { ajustes: o.ajustes === undefined ? AJUSTES_PADRAO : o.ajustes, share: o.share ?? null },
  )
  const page = await ctx.newPage()
  const ou = ouvirErros(page, { ignorarFalha: (r) => o.bloquearApi && /\/api\//.test(r.url()) })
  const { erros, avisos, rede, s5xx } = ou
  const cdp = await ctx.newCDPSession(page)
  page.__cdp = cdp
  // bloqueio pelo CDP (e não por ctx.route: interceptar desliga o cache HTTP e a 2ª visita mediria errado)
  if (o.bloquearApi) {
    await cdp.send('Network.enable')
    await cdp.send('Network.setBlockedURLs', { urls: ['*/api/*'] })
  }
  if (o.lento) await lento(cdp)
  return { ctx, page, cdp, erros, avisos, rede, s5xx, barrados, nome, a }
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

// o Playwright força o loopback pelo proxy (<-loopback>) a não ser que esta variável exista: a pilha local fica direta
process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK ??= '1'
/** Chromium (com o proxy da máquina para a produção; 127.0.0.1 direto). */
export const lancar = () =>
  chromium.launch({
    executablePath: EXE,
    args: ['--autoplay-policy=user-gesture-required', ...ARGS_TLS],
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } } : {}),
  })

/** Print com o nome aparelho_tela.png (fullPage opcional). Devolve o caminho. */
export async function print(page, aparelho, tela, o = {}) {
  const dir = o.dir ?? PRINTS
  mkdirSync(dir, { recursive: true })
  const f = `${dir}/${slug(aparelho)}_${slug(tela)}.png`
  // o print trava a página por um instante (raster da tela inteira): a janela fica anotada para não contar como trava do jogo
  const t1 = await page.evaluate(() => performance.now()).catch(() => null)
  await page.screenshot({ path: f, fullPage: !!o.inteira, animations: 'allow', timeout: 60000 }).catch(async (e) => {
    await page.screenshot({ path: f, timeout: 60000 }).catch(() => console.log(`  ..  print falhou (${tela}): ${e.message}`))
  })
  // o print de página inteira desliga a emulação de toque: religa (senão o resto mediria como se fosse com mouse)
  if (o.inteira) await religarToque(page)
  await page.evaluate((t1) => (window.__prints = window.__prints ?? []).push([t1 ?? 0, performance.now()]), t1).catch(() => {})
  return f
}

/**
 * Medições da tela atual. Devolve { lateral, pequenos[], cortados[], fonteCampo[], coberto } (listas curtas, para o
 * relatório). o.raiz = seletor onde procurar (padrão: o documento inteiro, só o que está visível na janela).
 */
export async function medir(page, o = {}) {
  return page.evaluate(
    ({ raiz, minimo }) => {
      const de = document.documentElement
      const lateral = Math.max(de.scrollWidth, document.body.scrollWidth) - innerWidth
      const vis = (el) => {
        const r = el.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) return null
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return null
        if (el.closest('[hidden],[aria-hidden="true"],.sr-only,.lx-sr-only,[inert]')) return null
        if (r.width <= 2 || r.height <= 2) return null
        if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null
        return r
      }
      const nomeDe = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.id || el.className || el.tagName).toString().replace(/\s+/g, ' ').trim().slice(0, 48)
      const caminho = (el) => {
        const p = []
        for (let e = el; e && e !== document.body && p.length < 3; e = e.parentElement) p.unshift(e.tagName.toLowerCase() + (e.classList[0] ? '.' + e.classList[0] : ''))
        return p.join('>')
      }
      // área de toque efetiva: o retângulo + a área invisível de ::before/::after posicionados com inset negativo
      const area = (el, r) => {
        let { left, top, right, bottom } = r
        for (const ps of ['::before', '::after']) {
          const s = getComputedStyle(el, ps)
          if (!s || s.content === 'none' || s.position !== 'absolute') continue
          const n = (v) => (v.endsWith('px') ? parseFloat(v) : NaN)
          const [t, rr, b, l] = [n(s.top), n(s.right), n(s.bottom), n(s.left)]
          if (!Number.isNaN(l)) left = Math.min(left, r.left + l)
          if (!Number.isNaN(t)) top = Math.min(top, r.top + t)
          if (!Number.isNaN(rr)) right = Math.max(right, r.right - rr)
          if (!Number.isNaN(b)) bottom = Math.max(bottom, r.bottom - b)
        }
        return { w: right - left, h: bottom - top }
      }
      const base = raiz ? document.querySelector(raiz) : document
      const pequenos = []
      if (base) {
        const sel = 'button, a[href], [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="checkbox"], input:not([type="hidden"]), select, textarea, summary'
        const vistos = new Set()
        for (const el of base.querySelectorAll(sel)) {
          if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue
          let r = vis(el)
          if (!r) continue
          // campo dentro de um <label> ou de uma caixa que foca o campo em qualquer ponto (a .sc-input de 48 px, a .lx-input)
          const caixa = /INPUT|TEXTAREA|SELECT/.test(el.tagName) ? el.closest('label, .sc-input, .lx-input, .hl-fsel, .hl-fsearch') : null
          if (caixa && vis(caixa)) r = caixa.getBoundingClientRect()
          // um alvo dentro de outro alvo (o rótulo do switch) conta pelo de fora
          if (el.parentElement?.closest(sel) && vis(el.parentElement.closest(sel))) continue
          const a = area(el, r)
          if (a.w + 0.5 >= minimo && a.h + 0.5 >= minimo) continue
          const k = `${nomeDe(el)}|${Math.round(a.w)}x${Math.round(a.h)}`
          if (vistos.has(k)) continue
          vistos.add(k)
          pequenos.push({ nome: nomeDe(el), w: Math.round(a.w), h: Math.round(a.h), onde: caminho(el), y: Math.round(r.top) })
        }
      }
      // texto cortado: conteúdo maior que a caixa com overflow escondido e SEM reticências
      const cortados = []
      for (const el of (base ?? document).querySelectorAll('body *')) {
        if (!el.childNodes.length || el.children.length > 2) continue
        const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
        if (txt.length < 2) continue
        const r = vis(el)
        if (!r) continue
        const cs = getComputedStyle(el)
        const escondeX = /hidden|clip/.test(cs.overflowX)
        const escondeY = /hidden|clip/.test(cs.overflowY)
        const passaX = el.scrollWidth > el.clientWidth + 1
        // 4 px de folga na altura: a fonte display "vaza" um pouco da caixa de linha sem cortar nada visível
        const passaY = el.scrollHeight > el.clientHeight + 4 && cs.webkitLineClamp === 'none'
        if ((escondeX && passaX && cs.textOverflow !== 'ellipsis') || (escondeY && passaY && !cs.webkitLineClamp?.match(/\d/))) {
          cortados.push({ texto: txt.slice(0, 50), onde: caminho(el), w: el.clientWidth, sw: el.scrollWidth, h: el.clientHeight, sh: el.scrollHeight })
        }
        else if (escondeX && passaX && cs.textOverflow === 'ellipsis') cortados.push({ texto: txt.slice(0, 50), onde: caminho(el), reticencias: true })
      }
      // campos com fonte < 16 px: o Safari do iPhone dá zoom ao focar
      const fonteCampo = []
      for (const el of document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea, select')) {
        const r = el.getBoundingClientRect()
        if (r.width < 1) continue
        const fs = parseFloat(getComputedStyle(el).fontSize)
        if (fs < 16) fonteCampo.push({ campo: el.id || el.getAttribute('placeholder') || el.name || el.type, fonte: fs })
      }
      // o campo focado está à vista e nada por cima dele?
      let coberto = null
      const f = document.activeElement
      if (f && f !== document.body && /INPUT|TEXTAREA|SELECT/.test(f.tagName)) {
        const r = f.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const vv = window.visualViewport
        const altura = vv ? vv.height : innerHeight
        const fora = r.top < 0 || r.bottom > altura
        const topo = !fora ? document.elementFromPoint(cx, cy) : null
        coberto = { campo: f.id || f.getAttribute('placeholder'), top: Math.round(r.top), bottom: Math.round(r.bottom), altura: Math.round(altura), fora, porCima: topo && topo !== f && !f.contains(topo) && !topo.contains(f) ? caminho(topo) : null }
      }
      // sobreposição: o texto do centro da barra do topo passando por baixo dos botões da direita; toasts por cima
      // do cabeçalho do sheet da decisão
      const sobrepostos = []
      // a caixa visível do texto: recortada pelos pais com overflow escondido (o texto com reticências "Perfil do jog…" não
      // passa por baixo do botão, mesmo que o retângulo do texto inteiro passe)
      const recorte = (no, r) => {
        let { left, right, top, bottom } = r
        for (let e = no.parentElement; e && e !== document.body; e = e.parentElement) {
          const cs = getComputedStyle(e)
          if (/hidden|clip/.test(cs.overflowX) || /hidden|clip/.test(cs.overflowY)) {
            const c = e.getBoundingClientRect()
            left = Math.max(left, c.left)
            right = Math.min(right, c.right)
            top = Math.max(top, c.top)
            bottom = Math.min(bottom, c.bottom)
          }
        }
        return { left, right, top, bottom, width: right - left, height: bottom - top }
      }
      const textoRects = (el) => {
        const out = []
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (!n.textContent.trim() || n.parentElement.closest('[aria-hidden="true"],.sr-only,.lx-sr-only')) continue
          const rg = document.createRange()
          rg.selectNodeContents(n)
          for (const r0 of rg.getClientRects()) {
            const r = recorte(n, r0)
            if (r.width > 2 && r.height > 2) out.push({ r, t: n.textContent.trim().slice(0, 30) })
          }
        }
        return out
      }
      const cruza = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) > 3 && Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) > 3
      const centro = document.querySelector('.lx-topbar__center')
      const direita = document.querySelector('.lx-topbar__right')
      if (centro && direita) {
        const bts = [...direita.querySelectorAll('button, a')].filter((b) => vis(b))
        for (const { r, t } of textoRects(centro)) for (const b of bts) if (cruza(r, b.getBoundingClientRect())) sobrepostos.push(`barra do topo: "${t}" por baixo de "${nomeDe(b)}"`)
      }
      const kind = document.querySelector('.ck-sheet:not(.is-collapsed) .ck-sheet__peekrow')
      if (kind) {
        for (const tst of document.querySelectorAll('.lx-toast, [class*="toast"] [class*="count"], [class*="toast"] [class*="more"]')) {
          const rt = tst.getBoundingClientRect()
          if (!vis(tst)) continue
          for (const { r, t } of textoRects(kind)) if (cruza(r, rt)) sobrepostos.push(`toast "${(tst.textContent || '').trim().slice(0, 30)}" por cima de "${t}" (sheet)`)
        }
      }
      return { lateral, pequenos: pequenos.slice(0, 40), cortados: cortados.slice(0, 30), fonteCampo, coberto, sobrepostos: [...new Set(sobrepostos)].slice(0, 10), janela: `${innerWidth}x${innerHeight}`, rolagem: de.scrollHeight }
    },
    { raiz: o.raiz ?? null, minimo: o.minimo ?? 40 },
  )
}

/**
 * Teclado virtual: a janela encolhe (é o que acontece no WebView dos apps — TikTok, Instagram, WhatsApp — e no Android
 * com "resizes-content"; no iPhone é a janela visual). Como o navegador de verdade, depois de encolher rola o campo
 * focado para dentro da janela se ele ficou fora (o Chromium centraliza). altura = fração da tela que o teclado ocupa.
 */
export async function teclado(page, a, aberto, fr = 0.42) {
  const h = aberto ? Math.round(a.h * (1 - fr)) : a.h
  await page.setViewportSize({ width: a.w, height: h })
  await sleep(250)
  if (aberto)
    await page.evaluate(() => {
      const f = document.activeElement
      if (!f || f === document.body) return
      const r = f.getBoundingClientRect()
      if (r.top < 0 || r.bottom > innerHeight) f.scrollIntoView({ block: 'center', inline: 'nearest' })
    })
  await sleep(250)
}

/** Gira o aparelho (troca largura e altura) e devolve a função que desvira. */
export async function girar(page, a) {
  await page.setViewportSize({ width: a.h, height: a.w })
  await sleep(600)
  return async () => {
    await page.setViewportSize({ width: a.w, height: a.h })
    await sleep(600)
  }
}

/** IndexedDB do jogo: uma chave do store kv. */
export const lerKv = (page, chave) =>
  page.evaluate(
    (k) =>
      new Promise((res) => {
        const r = indexedDB.open('lenda', 1)
        r.onupgradeneeded = () => r.result.createObjectStore('kv')
        r.onsuccess = () => {
          try {
            const g = r.result.transaction('kv').objectStore('kv').get(k)
            g.onsuccess = () => res(g.result ?? null)
            g.onerror = () => res(null)
          } catch {
            res(null)
          }
        }
        r.onerror = () => res(null)
      }),
    chave,
  )

/** Escreve um resumo curto de medir() no console (e devolve se achou algo). */
export function relatar(rot, m, extra = {}) {
  const ach = []
  if (m.lateral > 0) ach.push(`ROLAGEM LATERAL de ${m.lateral}px`)
  if (m.pequenos.length) ach.push(`alvos < 40px: ${m.pequenos.map((p) => `"${p.nome}" ${p.w}×${p.h}`).slice(0, 8).join(' · ')}${m.pequenos.length > 8 ? ` (+${m.pequenos.length - 8})` : ''}`)
  const cort = m.cortados.filter((c) => !c.reticencias)
  if (cort.length) ach.push(`texto cortado: ${cort.map((c) => `"${c.texto}" (${c.onde} ${c.w}/${c.sw}×${c.h}/${c.sh})`).slice(0, 5).join(' · ')}`)
  if (extra.fonte && m.fonteCampo.length) ach.push(`campo com fonte < 16px (zoom no iPhone): ${m.fonteCampo.map((f) => `${f.campo} ${f.fonte}px`).join(', ')}`)
  if (m.sobrepostos?.length) ach.push(`SOBREPOSIÇÃO: ${m.sobrepostos.join(' · ')}`)
  if (m.coberto && (m.coberto.fora || m.coberto.porCima)) ach.push(`CAMPO ESCONDIDO com teclado: ${JSON.stringify(m.coberto)}`)
  console.log(`  ${ach.length ? '!!' : 'ok'}  ${rot}${ach.length ? ': ' + ach.join(' | ') : ''}`)
  return ach
}

/** Tarefas longas desde `desde` (performance.now da página), sem as que cruzam um print. */
export const longasDesde = (page, desde = 0) =>
  page
    .evaluate((desde) => {
      const pr = window.__prints ?? []
      return (window.__longas ?? []).filter((l) => l.t >= desde && !pr.some(([a, b]) => l.t < b + 50 && l.t + l.d > a - 50)).map((l) => l.d)
    }, desde)
    .catch(() => [])
export const agora = (page) => page.evaluate(() => performance.now()).catch(() => 0)
