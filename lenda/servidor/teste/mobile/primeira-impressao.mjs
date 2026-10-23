#!/usr/bin/env node
// LENDA v3.5 · revisão mobile — PRIMEIRA IMPRESSÃO E VELOCIDADE (emulação do Chromium do Playwright).
//
// Etapas (--etapas=a,b,c; padrão: todas as que o alvo permite):
//   home     a Home em cada aparelho: print da dobra (o que aparece sem rolar) e da página inteira; rolagem lateral,
//            "Começar carreira" acima da dobra e sem nada por cima, alvos de toque < 40 px, texto cortado, erros no console;
//            girar o iPhone (retrato → deitado → retrato).
//   inicio   toca em "Começar carreira" e mede/printa a tela seguinte (campos com fonte < 16 px = zoom do iOS).
//   carga    4G lento (CDP: 1,6 Mb/s, 150 ms) + processador 4× mais lento, cache vazio e depois com cache: primeira pintura,
//            splash, botão visível, botão funcionando (toque → tela de identidade), bytes baixados até lá, maiores
//            arquivos, tarefas longas, e quando a medição manda o 1º pedido (a visita só existe para o painel daí em diante).
//            ATENÇÃO: o php -S da pilha local não comprime nem manda cabeçalho de cache (2,1 MB e ~12 s até o botão, contra
//            ~650 KB e ~7 s na Hostinger) — os números de referência são os de --alvo=prod.
//   filme    a mesma carga lenta, com um print a cada 1,5 s até o botão aparecer (o que a pessoa vê esperando).
//   animacao quadros por segundo da Home parada e rolando com o dedo, processador 4× mais lento.
//   inapp    navegadores de dentro do TikTok / Instagram / WhatsApp (user agent de verdade, sem navigator.share, com
//            clipboard negado e window.open bloqueado): abre? dá para começar a carreira?
//   medicao  (só local) a visita de quem chega por esses navegadores entra no banco como gente (bot=0, celular, origem
//            certa) e aparece nos números do painel (painel.php com o Bearer); referrer android-app:// do WhatsApp.
//   rede     (só local) arquivo do jogo que não chega (game-data, CSS, tela de identidade sem internet, API fora do ar).
//   storage  (só local) localStorage que lança (aba anônima antiga) e IndexedDB que não abre.
//   safari   (só local) simulação do CSS do Safari 15.6 / 16.1 (o que eles não entendem é invalidado no CSS servido).
//
// PRODUÇÃO (--alvo=prod): só lê. Todo POST/PUT/DELETE para api/ é abortado e o e.php (medição) recebe 204 daqui mesmo
// (nenhuma visita de teste entra no painel do dono). Etapas permitidas em prod: home, inicio, carga, filme, animacao, inapp.
//
// Uso:
//   node servidor/teste/mobile/primeira-impressao.mjs --alvo=prod --etapas=home,carga --saida=/caminho/prints
//   LENDA_INTEG_BASE=/tmp/lenda-v35 node servidor/teste/mobile/primeira-impressao.mjs --alvo=local --etapas=medicao,rede
//   (a pilha local: LENDA_INTEG_BASE=... PORTA=... BANCO=... bash servidor/teste/integracao/subir.sh)
// Sai com código 1 se alguma conferência falhou; o relatório vai em <saida>/relatorio-<alvo>.json.
const { chromium } = await import(process.env.LENDA_PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright/index.mjs')
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d
const ALVO = arg('alvo', 'local')
const SAIDA = arg('saida', process.env.LENDA_PRINTS ?? join(process.cwd(), 'mobile-primeira'))
mkdirSync(SAIDA, { recursive: true })
const EXE = process.env.LENDA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const BASE = process.env.LENDA_INTEG_BASE ?? '/tmp/lenda-integracao'
const env =
  ALVO === 'local' && existsSync(`${BASE}/segredos.env`)
    ? Object.fromEntries(readFileSync(`${BASE}/segredos.env`, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
    : {}
const URL0 = ALVO === 'prod' ? 'https://oprojeto.online/lenda/' : (process.env.LENDA_URL ?? `http://127.0.0.1:${env.PORTA || '8752'}/lenda/`)
const sql = (q) =>
  execFileSync('mariadb', [`--socket=${env.SOCK || '/run/mysqld/mysqld.sock'}`, '--default-character-set=utf8mb4', '-uroot', '-N', '-B', env.BANCO || 'lenda_integracao', '-e', q], {
    encoding: 'utf8',
  }).trim()

const PERMITIDAS = ALVO === 'prod' ? ['home', 'inicio', 'carga', 'filme', 'animacao', 'inapp'] : ['home', 'inicio', 'carga', 'filme', 'animacao', 'inapp', 'medicao', 'saida', 'rede', 'storage', 'safari']
const ETAPAS = arg('etapas', PERMITIDAS.join(',')).split(',').filter(Boolean)
for (const e of ETAPAS) if (!PERMITIDAS.includes(e)) throw new Error(`etapa "${e}" não roda com --alvo=${ALVO} (permitidas: ${PERMITIDAS.join(', ')})`)

// ───────────────────────── aparelhos ─────────────────────────
// tela = o tamanho da tela; janela = o que a página recebe (a tela menos as barras do navegador ou do app). É a janela
// que decide o que aparece "sem rolar".
const SAFARI = (v, ver) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${ver} Mobile/15E148 Safari/604.1`
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
export const APARELHOS = {
  'iphone-se': { tela: [375, 667], janela: [375, 553], dpr: 2, ua: SAFARI('16_7_10', '16.6'), nome: 'iPhone SE (Safari, iOS 16)' },
  'iphone-14': { tela: [390, 844], janela: [390, 664], dpr: 3, ua: SAFARI('18_6_2', '18.6'), nome: 'iPhone 14/15 (Safari)' },
  'galaxy-a': { tela: [360, 800], janela: [360, 672], dpr: 3, ua: CHROME_ANDROID, nome: 'Galaxy A (Chrome)' },
  'pixel-7': { tela: [412, 915], janela: [412, 797], dpr: 2.625, ua: CHROME_ANDROID, nome: 'Pixel 7 (Chrome)' },
  'pequeno-320': { tela: [320, 640], janela: [320, 528], dpr: 2, ua: 'Mozilla/5.0 (Linux; Android 9; SM-J260M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', nome: 'celular pequeno 320 (Chrome)' },
  deitado: { tela: [844, 390], janela: [844, 340], dpr: 3, ua: SAFARI('18_6_2', '18.6'), nome: 'iPhone 14 deitado (Safari)' },
  'tiktok-android': {
    tela: [360, 800],
    janela: [360, 680],
    dpr: 3,
    app: 'tiktok',
    android: true,
    nome: 'TikTok (Android, navegador do app)',
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-A155M Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.7339.207 Mobile Safari/537.36 trill_410603 JsSdk/1.0 NetType/4G Channel/googleplay AppName/trill app_version/41.6.3 ByteLocale/pt-BR ByteFullLocale/pt-BR Region/BR AppId/1180 Spark/1.7.8.6-bugfix AppVersion/41.6.3 BytedanceWebview/d8a21c6',
  },
  'tiktok-ios': {
    tela: [390, 844],
    janela: [390, 700],
    dpr: 3,
    app: 'tiktok',
    nome: 'TikTok (iPhone, navegador do app)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_41.5.0 JsSdk/2.0 NetType/4G Channel/App Store ByteLocale/pt Region/BR isDarkMode/1 WKWebView/1 RevealType/Dialog BytedanceWebview/d8a21c6 FalconTag/',
  },
  'instagram-android': {
    tela: [360, 800],
    janela: [360, 690],
    dpr: 3,
    app: 'instagram',
    android: true,
    nome: 'Instagram (Android, navegador do app)',
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-A155M Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.70 Mobile Safari/537.36 Instagram 401.0.0.48.79 Android (34/14; 450dpi; 1080x2340; samsung; SM-A155M; a15; mt6789; pt_BR; 800000000)',
  },
  'instagram-ios': {
    tela: [390, 844],
    janela: [390, 690],
    dpr: 3,
    app: 'instagram',
    nome: 'Instagram (iPhone, navegador do app)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 401.0.0.29.80 (iPhone14,7; iOS 18_5; pt_BR; pt-BR; scale=3.00; 1170x2532; 800000000) NW/3',
  },
  // O WhatsApp não tem navegador próprio: no Android abre a Custom Tab do Chrome (UA do Chrome, referrer
  // android-app://com.whatsapp/), no iPhone abre o Safari. A janela é a da aba sobre o app.
  'whatsapp-android': { tela: [360, 800], janela: [360, 696], dpr: 3, app: 'whatsapp', android: true, ua: CHROME_ANDROID, nome: 'WhatsApp (Android → Custom Tab do Chrome)', referrer: 'android-app://com.whatsapp/' },
  'whatsapp-ios': { tela: [390, 844], janela: [390, 664], dpr: 3, app: 'whatsapp', ua: SAFARI('18_6_2', '18.6'), nome: 'WhatsApp (iPhone → Safari)' },
}
const LISTA = arg('aparelhos', '')
const aparelhos = (filtro) => Object.entries(APARELHOS).filter(([k, a]) => (!LISTA || LISTA.split(',').includes(k)) && (!filtro || filtro(a, k)))

// ───────────────────────── conferências ─────────────────────────
const resultado = { alvo: ALVO, url: URL0, quando: new Date().toISOString(), etapas: {}, falhas: [] }
let falhas = 0
function ok(c, m, extra) {
  console.log(`${c ? '  ok  ' : '  XX  '}${m}${extra ? `  ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : ''}`)
  if (!c) {
    falhas++
    resultado.falhas.push(extra ? `${m} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : m)
  }
  return !!c
}
const registro = (etapa, chave, valor) => {
  resultado.etapas[etapa] ??= {}
  resultado.etapas[etapa][chave] = valor
}

/**
 * Contexto de um aparelho. o.real: esconde o navigator.webdriver (a pessoa de verdade — só na pilha local, para a medição);
 * o.restricoes: o que os navegadores de dentro dos apps não têm (share, clipboard, window.open); o.cache: reaproveita o
 * contexto (cache quente).
 */
async function abrir(browser, chave, o = {}) {
  const a = APARELHOS[chave]
  const [w, h] = o.janela ?? a.janela
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    screen: { width: a.tela[0], height: a.tela[1] },
    deviceScaleFactor: a.dpr,
    isMobile: true,
    hasTouch: true,
    userAgent: a.ua,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    extraHTTPHeaders: o.headers ?? {},
  })
  await ctx.addInitScript(
    ({ real, restr, android, referrer, falhaLs, falhaIdb }) => {
      window.__marcas = {}
      window.__ePhp = []
      const marca = (k) => {
        if (window.__marcas[k] == null) window.__marcas[k] = Math.round(performance.now())
      }
      if (real) {
        try {
          Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true })
        } catch {}
      }
      if (referrer) {
        try {
          Object.defineProperty(Document.prototype, 'referrer', { get: () => referrer, configurable: true })
        } catch {}
      }
      if (restr) {
        // Android WebView (TikTok/Instagram no Android) não tem Web Share; nos dois, o app pode negar a área de
        // transferência e bloquear janelas novas. Aqui: o pior caso.
        if (android) {
          try {
            delete Navigator.prototype.share
            delete Navigator.prototype.canShare
          } catch {}
        }
        try {
          const negar = () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'))
          if (navigator.clipboard) {
            navigator.clipboard.writeText = negar
            navigator.clipboard.write = negar
          }
        } catch {}
        window.open = () => {
          window.__abriuJanela = (window.__abriuJanela || 0) + 1
          return null
        }
      }
      if (falhaLs === 'cheio') {
        // localStorage cheio (ou aba anônima do Safari antigo): ler funciona, gravar lança QuotaExceededError
        const set = Storage.prototype.setItem
        Storage.prototype.setItem = function (k, v) {
          if (this === window.localStorage) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
          return set.call(this, k, v)
        }
      } else if (falhaLs === 'seguranca') {
        // iPhone com "Bloquear todos os cookies" (Ajustes › Safari): só de tocar em window.localStorage já lança
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new DOMException('The operation is insecure.', 'SecurityError')
          },
          configurable: true,
        })
      } else if (falhaLs === 'nulo') {
        // WebView do Android com o DOM storage desligado: window.localStorage é null
        Object.defineProperty(window, 'localStorage', { get: () => null, configurable: true })
      }
      if (falhaIdb) {
        // IndexedDB que não abre (aba anônima / navegador do app sem armazenamento): onerror logo depois
        const open = IDBFactory.prototype.open
        IDBFactory.prototype.open = function () {
          const req = open.apply(this, arguments)
          const fake = {
            result: undefined,
            error: new DOMException('Unable to open database', 'UnknownError'),
            onerror: null,
            onsuccess: null,
            onupgradeneeded: null,
            onblocked: null,
            addEventListener() {},
          }
          try {
            req.onsuccess = () => {}
          } catch {}
          setTimeout(() => fake.onerror && fake.onerror(new Event('error')), 5)
          return fake
        }
      }
      // marcas de tempo (performance.now, ms desde o início da navegação)
      const of = window.fetch
      window.fetch = function (u, i) {
        try {
          if (String(u).includes('e.php')) {
            marca('ePhp')
            window.__ePhp.push(Math.round(performance.now()))
          }
        } catch {}
        return of.apply(this, arguments)
      }
      const sb = navigator.sendBeacon?.bind(navigator)
      if (sb)
        navigator.sendBeacon = (u, d) => {
          if (String(u).includes('e.php')) {
            marca('ePhp')
            window.__ePhp.push(Math.round(performance.now()))
          }
          return sb(u, d)
        }
      const olhar = () => {
        try {
          if (document.querySelector('.lx-splash')) marca('splash')
          const b = [...document.querySelectorAll('button')].find((x) => /Começar carreira/.test(x.textContent || ''))
          if (b) {
            const r = b.getBoundingClientRect()
            if (r.width > 0 && r.height > 0) marca('cta')
          }
          if (document.querySelector('.id-wiz, .id-steps') || [...document.querySelectorAll('h1')].some((x) => /identidade/i.test(x.textContent || ''))) marca('identidade')
          if (sessionStorage.getItem('lenda:sid')) marca('sessaoMedicao')
        } catch {}
        if (!window.__marcas.identidade) requestAnimationFrame(olhar)
      }
      requestAnimationFrame(olhar)
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) {
            window.__longas = window.__longas || []
            window.__longas.push([Math.round(e.startTime), Math.round(e.duration)])
          }
        }).observe({ type: 'longtask', buffered: true })
      } catch {}
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__lcp = Math.round(e.startTime)
        }).observe({ type: 'largest-contentful-paint', buffered: true })
      } catch {}
    },
    { real: !!o.real, restr: !!o.restricoes, android: !!a.android, referrer: o.referrer ?? null, falhaLs: o.falhaLs ?? null, falhaIdb: !!o.falhaIdb },
  )
  const page = await ctx.newPage()
  await protegerProd(page)
  const erros = []
  const falhou = []
  page.on('console', (m) => {
    if (m.type() === 'error') erros.push(m.text().slice(0, 300))
  })
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message.slice(0, 300)}`))
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText ?? ''
    if (!/ERR_ABORTED/.test(f) || !/e\.php/.test(r.url())) falhou.push(`${f} ${r.url().replace(URL0, './')}`)
  })
  return { ctx, page, erros, falhou, a }
}

/**
 * Produção: nada é gravado. A medição (e.php) recebe 204 daqui e qualquer outro pedido de escrita para a API é barrado.
 * Pelo domínio Fetch do CDP só para api/ — o page.route do Playwright desligaria o cache HTTP da página inteira (e a
 * medida de "2ª visita" sairia errada).
 */
async function protegerProd(page) {
  if (ALVO !== 'prod') return
  const cdp = await page.context().newCDPSession(page)
  cdp.on('Fetch.requestPaused', (e) => {
    const m = e.request.method
    if (e.request.url.includes('/api/e.php')) return cdp.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: 204, body: '' }).catch(() => {})
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
      resultado.barradosEmProd = [...(resultado.barradosEmProd ?? []), `${m} ${e.request.url}`]
      return cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'BlockedByClient' }).catch(() => {})
    }
    return cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => {})
  })
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/lenda/api/*', requestStage: 'Request' }] })
}

/** Espera o "Começar carreira" aparecer (a Home pronta). */
const esperarCta = (page, ms = 60_000) => page.getByRole('button', { name: /Começar carreira/ }).first().waitFor({ state: 'visible', timeout: ms })

/** Medidas da tela de agora (no próprio navegador). */
async function medirTela(page) {
  return page.evaluate(() => {
    const W = innerWidth
    const H = innerHeight
    const visivel = (el) => {
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    const desc = (el) => {
      const t = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 50)
      return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} "${t}"`
    }
    // rolagem lateral de verdade: dá para arrastar a página para o lado?
    const antes = scrollX
    scrollTo(60, scrollY)
    const rolaLado = scrollX > 0
    scrollTo(antes, scrollY)
    const larguraDoc = document.documentElement.scrollWidth
    const paraFora = []
    if (rolaLado || larguraDoc > W + 1) {
      for (const el of document.querySelectorAll('body *')) {
        if (!visivel(el)) continue
        const r = el.getBoundingClientRect()
        if (r.right > W + 1 || r.left < -1) paraFora.push(`${desc(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`)
        if (paraFora.length > 15) break
      }
    }
    // alvos de toque (o que a pessoa toca) menores que 40 px — conta a área de ::before/::after com inset negativo
    const tocaveis = [...document.querySelectorAll('a[href], button, [role="button"], [role="tab"], [role="switch"], input:not([type="hidden"]), select, textarea, summary, label[for]')]
    const pequenos = []
    for (const el of tocaveis) {
      if (!visivel(el) || el.closest('[aria-hidden="true"]') || el.disabled) continue
      const r = el.getBoundingClientRect()
      if (r.bottom < 0 || r.top > document.documentElement.scrollHeight) continue
      let w = r.width
      let h = r.height
      for (const p of ['::before', '::after']) {
        const cs = getComputedStyle(el, p)
        if (cs.content === 'none' || cs.position !== 'absolute') continue
        const ins = (v) => (v.endsWith('px') ? -Math.min(0, parseFloat(v)) : 0)
        w = Math.max(w, r.width + ins(cs.left) + ins(cs.right))
        h = Math.max(h, r.height + ins(cs.top) + ins(cs.bottom))
      }
      if (w < 40 || h < 40) pequenos.push(`${desc(el)} ${Math.round(w)}×${Math.round(h)} @y${Math.round(r.top + scrollY)}`)
    }
    // texto cortado: conteúdo maior que a caixa, com overflow escondido
    const cortados = []
    for (const el of document.querySelectorAll('body *')) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
      if (!visivel(el)) continue
      const cs = getComputedStyle(el)
      const esconde = /hidden|clip/.test(cs.overflowX + cs.overflowY) || cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none'
      if (!esconde) continue
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2) cortados.push(`${desc(el)} (${el.scrollWidth}×${el.scrollHeight} em ${el.clientWidth}×${el.clientHeight}${cs.textOverflow === 'ellipsis' ? ', com …' : ''})`)
      if (cortados.length > 20) break
    }
    // campos com fonte < 16 px (o iPhone dá zoom ao tocar)
    const campos = [...document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea')]
      .filter(visivel)
      .map((el) => [desc(el), parseFloat(getComputedStyle(el).fontSize)])
      .filter(([, f]) => f < 16)
      .map(([d, f]) => `${d} ${f}px`)
    // o "Começar carreira"
    const b = [...document.querySelectorAll('button')].find((x) => /Começar carreira/.test(x.textContent || '') && visivel(x))
    let cta = null
    if (b) {
      const r = b.getBoundingClientRect()
      // "nada por cima": com o botão rolado para o meio da janela (fixos, faixas e toasts não podem cobrir o toque)
      const y0 = scrollY
      b.scrollIntoView({ block: 'center', behavior: 'instant' })
      const r2 = b.getBoundingClientRect()
      const pontos = [
        [r2.left + r2.width / 2, r2.top + r2.height / 2],
        [r2.left + 12, r2.top + r2.height / 2],
        [r2.right - 12, r2.top + r2.height / 2],
      ]
      const cobertos = pontos.map(([x, y]) => document.elementFromPoint(x, y)).filter((t) => !t || !(b === t || b.contains(t)))
      scrollTo(scrollX, y0)
      cta = {
        y: Math.round(r.top + scrollY),
        base: Math.round(r.bottom + scrollY),
        w: Math.round(r.width),
        h: Math.round(r.height),
        acimaDaDobra: r.bottom <= H,
        visivelPx: Math.max(0, Math.round(Math.min(H, r.bottom) - Math.max(0, r.top))),
        semNadaPorCima: !cobertos.length,
        porCima: cobertos.length ? cobertos.map((t) => (t ? desc(t) : 'nada')).join(' | ') : null,
      }
    }
    // elementos fixos (barra do topo, faixas, toasts)
    const fixos = []
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el)
      if ((cs.position === 'fixed' || cs.position === 'sticky') && visivel(el)) {
        const r = el.getBoundingClientRect()
        if (r.height > 4 && r.width > 40 && r.height < H * 0.9) fixos.push(`${desc(el)} ${cs.position} y${Math.round(r.top)} h${Math.round(r.height)}`)
      }
    }
    // o que dá para ler sem rolar
    const dobra = []
    for (const el of document.querySelectorAll('h1, h2, h3, p, .lx-btn, button')) {
      if (!visivel(el)) continue
      const r = el.getBoundingClientRect()
      if (r.top >= 0 && r.bottom <= H) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
        if (t && !dobra.includes(t)) dobra.push(t.slice(0, 90))
      }
    }
    return { W, H, larguraDoc, rolaLado, paraFora, pequenos, cortados, campos, cta, fixos: fixos.slice(0, 10), alturaDoc: document.documentElement.scrollHeight, dobra: dobra.slice(0, 20) }
  })
}

const nomePrint = (etapa, chave, tela) => join(SAIDA, `${etapa}-${chave}-${tela}.png`)

// ───────────────────────── etapa: home ─────────────────────────
async function etapaHome(browser) {
  console.log('\n— home —')
  for (const [k, a] of aparelhos()) {
    const { ctx, page, erros, falhou } = await abrir(browser, k, { restricoes: !!a.app, referrer: a.referrer })
    const t0 = Date.now()
    await page.goto(URL0, { waitUntil: 'domcontentloaded' })
    let pronto = true
    try {
      await esperarCta(page)
    } catch {
      pronto = false
    }
    const ms = Date.now() - t0
    await sleep(1800) // as animações de entrada assentam
    await page.screenshot({ path: nomePrint('home', k, 'dobra') })
    await page.screenshot({ path: nomePrint('home', k, 'inteira'), fullPage: true })
    const m = await medirTela(page)
    registro('home', k, { ms, ...m, erros, falhou })
    ok(pronto, `[${k}] Home abriu com o "Começar carreira"`, `${ms} ms`)
    ok(!m.rolaLado && m.larguraDoc <= m.W + 1, `[${k}] sem rolagem lateral`, m.rolaLado || m.larguraDoc > m.W + 1 ? { larguraDoc: m.larguraDoc, W: m.W, paraFora: m.paraFora } : '')
    ok(!!m.cta?.acimaDaDobra, `[${k}] "Começar carreira" aparece sem rolar (janela ${m.W}×${m.H})`, m.cta ? `botão de y=${m.cta.y} a ${m.cta.base} (${m.cta.visivelPx} px dele à vista)` : 'sem botão')
    ok(!!m.cta?.semNadaPorCima, `[${k}] nada por cima do "Começar carreira"`, m.cta?.porCima ?? '')
    ok(!m.cortados.length, `[${k}] nenhum texto cortado`, m.cortados.length ? m.cortados : '')
    ok(!m.pequenos.length, `[${k}] alvos de toque ≥ 40 px`, m.pequenos.length ? m.pequenos.slice(0, 12) : '')
    ok(!erros.length, `[${k}] sem erro no console`, erros.length ? erros.slice(0, 5) : '')
    ok(!falhou.length, `[${k}] nenhum pedido falhou`, falhou.length ? falhou.slice(0, 5) : '')
    if (k === 'iphone-14') {
      // girar: retrato → deitado → retrato
      await page.setViewportSize({ width: 844, height: 340 })
      await sleep(900)
      await page.screenshot({ path: nomePrint('home', k, 'girou-deitado') })
      const d = await medirTela(page)
      await page.setViewportSize({ width: 390, height: 664 })
      await sleep(900)
      await page.screenshot({ path: nomePrint('home', k, 'girou-de-volta') })
      const v = await medirTela(page)
      registro('home', `${k}-girar`, { deitado: d, voltou: v })
      ok(!d.rolaLado && !v.rolaLado, `[${k}] girar o celular não cria rolagem lateral`)
      ok(!!v.cta?.acimaDaDobra === !!m.cta?.acimaDaDobra, `[${k}] depois de girar e voltar, a Home fica igual`)
    }
    await ctx.close()
  }
}

// ───────────────────────── etapa: inicio ─────────────────────────
async function etapaInicio(browser) {
  console.log('\n— inicio (tocar em "Começar carreira") —')
  for (const [k, a] of aparelhos()) {
    const { ctx, page, erros } = await abrir(browser, k, { restricoes: !!a.app })
    await page.goto(URL0, { waitUntil: 'domcontentloaded' })
    await esperarCta(page)
    await sleep(600)
    const t0 = Date.now()
    await page.getByRole('button', { name: /Começar carreira/ }).first().tap()
    let foi = true
    try {
      await page.waitForFunction(() => window.__marcas?.identidade != null, null, { timeout: 30_000 })
    } catch {
      foi = false
    }
    const ms = Date.now() - t0
    await sleep(900)
    await page.screenshot({ path: nomePrint('inicio', k, 'identidade-dobra') })
    const m = await medirTela(page)
    registro('inicio', k, { ms, hash: await page.evaluate(() => location.hash), ...m, erros })
    ok(foi, `[${k}] tocar em "Começar carreira" leva à identidade`, `${ms} ms`)
    ok(!m.campos.length, `[${k}] campos com fonte ≥ 16 px (sem zoom no iPhone)`, m.campos.length ? m.campos : '')
    ok(!m.rolaLado, `[${k}] identidade sem rolagem lateral`)
    ok(!erros.length, `[${k}] sem erro no console`, erros.length ? erros.slice(0, 5) : '')
    // teclado aberto no "Buscar país": a janela encolhe ~260 px (iPhone/Android); o campo continua à vista?
    const campo = page.getByPlaceholder(/Buscar país/i).first()
    if (await campo.isVisible().catch(() => false)) {
      await campo.tap()
      const [w, h] = a.janela
      await page.setViewportSize({ width: w, height: Math.max(220, h - 260) })
      await page.keyboard.type('bra')
      await sleep(600)
      await page.screenshot({ path: nomePrint('inicio', k, 'teclado-aberto-buscar-pais') })
      const r = await campo.boundingBox()
      // o que está por cima do campo, de verdade (o que o dedo tocaria): pontos ao longo do campo
      const fixosPorCima = await page.evaluate(() => {
        const el = document.activeElement
        if (!el) return []
        const b = el.getBoundingClientRect()
        const ys = [b.top + 4, b.top + b.height / 2, b.bottom - 4].filter((y) => y >= 0 && y < innerHeight)
        const xs = [b.left + 12, b.left + b.width / 2, b.right - 12]
        const fora = new Set()
        for (const y of ys)
          for (const x of xs) {
            const t = document.elementFromPoint(x, y)
            if (t && t !== el && !el.contains(t) && !t.contains(el)) fora.add((t.closest('[class]')?.className || t.tagName).toString().slice(0, 40))
          }
        return [...fora]
      })
      ok(!!r && r.y >= 0 && r.y + r.height <= Math.max(220, h - 260), `[${k}] com o teclado aberto o campo "Buscar país" fica à vista`, r ? `y=${Math.round(r.y)}` : '')
      ok(!fixosPorCima.length, `[${k}] nada fixo por cima do campo com o teclado aberto`, fixosPorCima)
      await page.setViewportSize({ width: w, height: h })
    }
    // voltar do Android na identidade: volta para a Home (e não sai do site)
    await page.goBack().catch(() => {})
    const voltou = await esperarCta(page, 10_000).then(() => true).catch(() => false)
    ok(voltou, `[${k}] "voltar" na identidade leva de volta à Home`, await page.evaluate(() => location.href).catch(() => ''))
    await ctx.close()
  }
}

// ───────────────────────── etapa: carga (4G lento + CPU 4×) ─────────────────────────
const REDE_LENTA = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }

async function medirCarga(page, cdp, rotulo, k) {
  const pedidos = new Map()
  const t0 = { ts: null }
  cdp.on('Network.requestWillBeSent', (e) => {
    if (t0.ts == null) t0.ts = e.timestamp
    pedidos.set(e.requestId, { url: e.request.url, ini: e.timestamp, tipo: e.type })
  })
  cdp.on('Network.responseReceived', (e) => {
    const p = pedidos.get(e.requestId)
    if (p) {
      p.status = e.response.status
      p.cache = e.response.fromDiskCache || e.response.fromServiceWorker || e.response.fromPrefetchCache
      p.enc = e.response.headers['content-encoding'] || e.response.headers['Content-Encoding'] || ''
    }
  })
  cdp.on('Network.loadingFinished', (e) => {
    const p = pedidos.get(e.requestId)
    if (p) {
      p.fim = e.timestamp
      p.bytes = e.encodedDataLength
    }
  })
  cdp.on('Network.loadingFailed', (e) => {
    const p = pedidos.get(e.requestId)
    if (p) {
      p.fim = e.timestamp
      p.falhou = e.errorText
    }
  })
  const inicio = Date.now()
  await page.goto(URL0, { waitUntil: 'commit', timeout: 120_000 })
  let ctaOk = true
  try {
    await page.waitForFunction(() => window.__marcas?.cta != null, null, { timeout: 120_000, polling: 100 })
  } catch {
    ctaOk = false
  }
  // toca no botão assim que ele aparece (o que uma pessoa apressada faz) e mede até a tela de identidade
  const tToque = await page.evaluate(() => Math.round(performance.now()))
  await page
    .getByRole('button', { name: /Começar carreira/ })
    .first()
    .tap({ timeout: 30_000 })
    .catch(() => {})
  // o que a pessoa vê enquanto a tela seguinte chega (o botão parece morto?)
  await sleep(700)
  await page.screenshot({ path: nomePrint('carga', k, `${rotulo.replace(/\s+/g, '-')}-700ms-depois-do-toque`) }).catch(() => {})
  let idOk = true
  try {
    await page.waitForFunction(() => window.__marcas?.identidade != null, null, { timeout: 120_000, polling: 100 })
  } catch {
    idOk = false
  }
  await sleep(2500)
  const marcas = await page.evaluate(() => {
    const p = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')
    const nav = performance.getEntriesByType('navigation')[0]
    return {
      ...window.__marcas,
      fcp: p ? Math.round(p.startTime) : null,
      lcp: window.__lcp ?? null,
      dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      ePhp: window.__ePhp ?? [],
      longas: window.__longas ?? [],
    }
  })
  const rel = (ts) => (ts == null || t0.ts == null ? null : Math.round((ts - t0.ts) * 1000))
  const lista = [...pedidos.values()].map((p) => ({ url: p.url.replace(URL0, './').replace(/\?.*$/, ''), ini: rel(p.ini), fim: rel(p.fim), kb: Math.round((p.bytes ?? 0) / 102.4) / 10, cache: !!p.cache, enc: p.enc, status: p.status, falhou: p.falhou }))
  const ateCta = lista.filter((p) => p.fim != null && marcas.cta != null && p.fim <= marcas.cta)
  const kbAteCta = Math.round(ateCta.reduce((s, p) => s + p.kb, 0))
  const kbTotal = Math.round(lista.reduce((s, p) => s + p.kb, 0))
  const maiores = [...ateCta].sort((a, b) => b.kb - a.kb).slice(0, 12).map((p) => `${p.kb} KB ${p.enc || 'sem compressão'} ${p.url}`)
  const tbt = marcas.longas.reduce((s, [, d]) => s + Math.max(0, d - 50), 0)
  const r = {
    rotulo,
    msParede: Date.now() - inicio,
    fcp: marcas.fcp,
    lcp: marcas.lcp,
    splash: marcas.splash ?? null,
    cta: marcas.cta ?? null,
    toque: tToque,
    identidade: marcas.identidade ?? null,
    respostaDoToque: marcas.identidade != null ? marcas.identidade - tToque : null,
    sessaoMedicao: marcas.sessaoMedicao ?? null,
    primeiroEphp: marcas.ePhp[0] ?? null,
    pedidosAteCta: ateCta.length,
    kbAteCta,
    kbTotalAte: kbTotal,
    maioresAteCta: maiores,
    tarefasLongas: marcas.longas.length,
    tbtMs: tbt,
    maiorTarefa: Math.max(0, ...marcas.longas.map(([, d]) => d)),
    semCompressao: lista.filter((p) => p.kb > 20 && !p.enc && /\.(js|css|json|svg|html)$|\/$/.test(p.url) && !p.cache).map((p) => `${p.kb} KB ${p.url}`),
    pedidos: lista,
  }
  console.log(
    `  [${k}] ${rotulo}: 1ª pintura ${r.fcp} ms · splash ${r.splash} · botão ${r.cta} ms · toque→identidade ${r.respostaDoToque} ms · ${r.kbAteCta} KB até o botão (${r.pedidosAteCta} pedidos) · 1º e.php ${r.primeiroEphp} ms · TBT ${tbt} ms`,
  )
  return { r, ctaOk, idOk }
}

async function etapaCarga(browser) {
  console.log('\n— carga: 4G lento (1,6 Mb/s, 150 ms) + processador 4× —')
  const lista = arg('aparelhos', '') ? aparelhos() : aparelhos((a, k) => ['galaxy-a', 'tiktok-android', 'iphone-se'].includes(k))
  for (const [k, a] of lista) {
    const rodadas = []
    const { ctx, page, erros } = await abrir(browser, k, { restricoes: !!a.app })
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false })
    await cdp.send('Network.emulateNetworkConditions', REDE_LENTA)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    const fria = await medirCarga(page, cdp, 'cache vazio', k)
    rodadas.push(fria.r)
    await page.screenshot({ path: nomePrint('carga', k, 'depois-do-toque-cache-vazio') })
    // 2ª visita (cache quente): outra página no mesmo contexto
    const p2 = await ctx.newPage()
    await protegerProd(p2)
    const cdp2 = await ctx.newCDPSession(p2)
    await cdp2.send('Network.enable')
    await cdp2.send('Network.emulateNetworkConditions', REDE_LENTA)
    await cdp2.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.close()
    const quente = await medirCarga(p2, cdp2, 'cache quente', k)
    rodadas.push(quente.r)
    registro('carga', k, { rodadas, erros })
    ok(fria.ctaOk, `[${k}] botão aparece no 4G lento`, `${fria.r.cta} ms`)
    ok(fria.r.cta != null && fria.r.cta <= 5000, `[${k}] "Começar carreira" em até 5 s no 4G lento com cache vazio`, `${fria.r.cta} ms; ${fria.r.kbAteCta} KB baixados antes`)
    ok(fria.r.fcp != null && fria.r.fcp <= 2500, `[${k}] primeira pintura em até 2,5 s`, `${fria.r.fcp} ms`)
    ok(fria.idOk && fria.r.respostaDoToque != null && fria.r.respostaDoToque <= 2000, `[${k}] o toque no botão leva à identidade em até 2 s`, `${fria.r.respostaDoToque} ms`)
    ok(fria.r.primeiroEphp != null && fria.r.primeiroEphp <= 5000, `[${k}] a medição manda a visita em até 5 s`, `1º e.php em ${fria.r.primeiroEphp} ms`)
    ok(!fria.r.semCompressao.length, `[${k}] texto (JS/CSS/JSON) chega comprimido`, fria.r.semCompressao.slice(0, 6))
    ok(quente.r.cta != null && quente.r.cta <= 2500, `[${k}] 2ª visita (cache): botão em até 2,5 s`, `${quente.r.cta} ms`)
    await ctx.close()
  }
}

// ───────────────────────── etapa: filme (o que a pessoa vê enquanto carrega) ─────────────────────────
async function etapaFilme(browser) {
  console.log('\n— filme da carga: 4G lento + CPU 4×, cache vazio, um print a cada 1,5 s —')
  const lista = arg('aparelhos', '') ? aparelhos() : aparelhos((a, k) => k === 'tiktok-android')
  for (const [k, a] of lista) {
    const { ctx, page } = await abrir(browser, k, { restricoes: !!a.app })
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', REDE_LENTA)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    const t0 = Date.now()
    await page.goto(URL0, { waitUntil: 'commit', timeout: 120_000 })
    const quadros = []
    for (let i = 1; i <= 8; i++) {
      await sleep(Math.max(0, i * 1500 - (Date.now() - t0)))
      const ms = Date.now() - t0
      await page.screenshot({ path: nomePrint('filme', k, `${String(ms).padStart(5, '0')}ms`) }).catch(() => {})
      const cta = await page.evaluate(() => window.__marcas?.cta ?? null).catch(() => null)
      quadros.push({ ms, cta })
      if (cta != null) break
    }
    registro('filme', k, quadros)
    console.log(`  [${k}] ${quadros.map((q) => `${q.ms} ms${q.cta != null ? ' (botão)' : ''}`).join(' · ')}`)
    await ctx.close()
  }
}

// ───────────────────────── etapa: animacao (processador 4× mais lento) ─────────────────────────
// Com a Home pronta: quadros por segundo parada (as animações da arte) e rolando com o dedo até o fim.
async function etapaAnimacao(browser) {
  console.log('\n— animação na Home com o processador 4× mais lento —')
  const lista = arg('aparelhos', '') ? aparelhos() : aparelhos((a, k) => ['galaxy-a', 'iphone-se'].includes(k))
  for (const [k, a] of lista) {
    const { ctx, page, erros } = await abrir(browser, k, { restricoes: !!a.app })
    await page.goto(URL0, { waitUntil: 'domcontentloaded' })
    await esperarCta(page)
    await sleep(2500)
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    const quadros = (ms) =>
      page.evaluate(
        (dur) =>
          new Promise((res) => {
            const ts = []
            const t0 = performance.now()
            const f = (t) => {
              ts.push(t)
              if (t - t0 < dur) requestAnimationFrame(f)
              else {
                const d = ts.slice(1).map((x, i) => x - ts[i])
                res({ fps: Math.round((d.length / (ts[ts.length - 1] - ts[0])) * 1000), travadas: d.filter((x) => x > 50).length, pior: Math.round(Math.max(...d)) })
              }
            }
            requestAnimationFrame(f)
          }),
        ms,
      )
    const parada = await quadros(3000)
    const rolando = quadros(3500)
    await sleep(100)
    await cdp.send('Input.synthesizeScrollGesture', { x: 180, y: 400, yDistance: -2400, speed: 1200, gestureSourceType: 'touch' }).catch(() => {})
    const rol = await rolando
    registro('animacao', k, { parada, rolando: rol, erros })
    console.log(`  [${k}] parada: ${parada.fps} qps, ${parada.travadas} quadros > 50 ms (pior ${parada.pior} ms) · rolando: ${rol.fps} qps, ${rol.travadas} > 50 ms (pior ${rol.pior} ms)`)
    ok(parada.travadas <= 3, `[${k}] Home parada sem travar (CPU 4×)`, parada)
    ok(rol.travadas <= 6, `[${k}] rolar a Home sem travar (CPU 4×)`, rol)
    await ctx.close()
  }
}

// ───────────────────────── etapa: inapp ─────────────────────────
async function etapaInapp(browser) {
  console.log('\n— navegadores de dentro dos apps (sem share, clipboard negado, sem janela nova) —')
  for (const [k, a] of aparelhos((x) => !!x.app)) {
    const { ctx, page, erros, falhou } = await abrir(browser, k, { restricoes: true, referrer: a.referrer })
    await page.goto(URL0, { waitUntil: 'domcontentloaded' })
    let abriu = true
    try {
      await esperarCta(page)
    } catch {
      abriu = false
    }
    await sleep(1500)
    const armaz = await page.evaluate(async () => {
      const r = { ls: false, ss: false, idb: false, share: typeof navigator.share === 'function', clipboard: !!navigator.clipboard }
      try {
        localStorage.setItem('__t', '1')
        r.ls = localStorage.getItem('__t') === '1'
        localStorage.removeItem('__t')
      } catch {}
      try {
        sessionStorage.setItem('__t', '1')
        r.ss = true
      } catch {}
      r.idb = await new Promise((res) => {
        try {
          const q = indexedDB.open('lenda', 1)
          q.onsuccess = () => res(true)
          q.onerror = () => res(false)
        } catch {
          res(false)
        }
      })
      return r
    })
    await page.getByRole('button', { name: /Começar carreira/ }).first().tap()
    let foi = true
    try {
      await page.waitForFunction(() => window.__marcas?.identidade != null, null, { timeout: 30_000 })
    } catch {
      foi = false
    }
    await sleep(700)
    await page.screenshot({ path: nomePrint('inapp', k, 'identidade') })
    registro('inapp', k, { abriu, armaz, foi, erros, falhou, janelas: await page.evaluate(() => window.__abriuJanela ?? 0) })
    ok(abriu, `[${k}] a Home abre`)
    ok(foi, `[${k}] dá para começar a carreira`)
    ok(!erros.length, `[${k}] sem erro no console`, erros.length ? erros.slice(0, 5) : '')
    await ctx.close()
  }
}

// ───────────────────────── etapa: medicao (só local) ─────────────────────────
async function etapaMedicao(browser) {
  console.log('\n— medição: a visita de quem vem pelos apps entra como gente e aparece no painel —')
  const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
  const painel = async (q) => {
    const r = await fetch(`${URL0}api/painel.php?${q}`, { headers: { Authorization: `Bearer ${env.PAINEL_TOKEN}` } })
    return r.json().catch(() => null)
  }
  const antes = await painel(`de=${hoje}&ate=${hoje}&bots=0&_=${Date.now()}`)
  const casos = [
    ...aparelhos((x) => !!x.app).map(([k, a]) => ({ k, a, query: '', esperado: a.app === 'whatsapp' && a.referrer ? 'whatsapp' : 'direto' })),
    { k: 'tiktok-android', a: APARELHOS['tiktok-android'], query: '?utm_source=tiktok&utm_medium=social', esperado: 'tiktok', rotulo: 'link curto /lenda/tiktok' },
    { k: 'instagram-ios', a: APARELHOS['instagram-ios'], query: '', esperado: 'instagram', referrer: 'https://l.instagram.com/', rotulo: 'referrer l.instagram.com' },
    { k: 'galaxy-a', a: APARELHOS['galaxy-a'], query: '', esperado: 'direto', robo: true, rotulo: 'Playwright sem esconder o webdriver (tem que ser robô)' },
  ]
  const linhas = []
  for (const c of casos) {
    const { ctx, page, erros } = await abrir(browser, c.k, { real: !c.robo, restricoes: !!c.a.app, referrer: c.referrer ?? c.a.referrer })
    await page.goto(URL0 + c.query, { waitUntil: 'domcontentloaded' })
    await esperarCta(page).catch(() => {})
    await page.waitForFunction(() => (window.__ePhp ?? []).length > 0, null, { timeout: 15_000 }).catch(() => {})
    await sleep(1500)
    const sid = await page.evaluate(() => sessionStorage.getItem('lenda:sid'))
    const v = sid ? sql(`SELECT bot, dispositivo, origem, IFNULL(tela,''), IFNULL(idioma,''), IFNULL(rota,'') FROM visitas WHERE sid = '${sid.replace(/[^0-9a-f-]/gi, '')}'`) : ''
    const [bot, disp, origem, tela, idioma, rota] = v.split('\t')
    linhas.push({ caso: c.rotulo ?? c.k, ua: c.a.ua.slice(0, 60), sid, bot, disp, origem, tela, idioma, rota, erros })
    if (c.robo) ok(bot === '1', `[${c.rotulo}] marcado como robô`, { bot })
    else {
      ok(!!v, `[${c.rotulo ?? c.k}] a visita entrou no banco`, { sid })
      ok(bot === '0', `[${c.rotulo ?? c.k}] a visita conta como gente (bot=0)`, { bot })
      ok(disp === 'mobile', `[${c.rotulo ?? c.k}] dispositivo = celular`, { disp })
      ok(origem === c.esperado, `[${c.rotulo ?? c.k}] origem = ${c.esperado}`, { origem })
    }
    await ctx.close()
  }
  // a mesma regra do servidor, sem navegador: os user agents dos apps não casam com o ROBO_UA do e.php
  const robo = /bot|crawl|spider|preview|headless|facebookexternalhit|slurp|curl|wget|python/i
  for (const [k, a] of aparelhos((x) => !!x.app)) ok(!robo.test(a.ua), `[${k}] user agent não cai no ROBO_UA do e.php`)
  await sleep(500)
  const depois = await painel(`de=${hoje}&ate=${hoje}&bots=0&_=${Date.now() + 1}`)
  const agora = await painel(`so=agora`)
  registro('medicao', 'visitas', linhas)
  registro('medicao', 'painel', { antes, depois, agora })
  console.log(`  painel (bots=0) antes/depois: ${JSON.stringify(antes?.totais ?? antes?.resumo ?? Object.keys(antes ?? {}))} → ${JSON.stringify(depois?.totais ?? depois?.resumo ?? '')}`)
}

// ───────────────────────── etapa: saida (só local) ─────────────────────────
// Quem entra e sai logo: a visita chega ao banco? Fecha a aba (com pagehide) em momentos diferentes, no 4G lento + CPU 4×.
async function etapaSaida(browser) {
  console.log('\n— saída rápida: quem fecha logo aparece no painel? (4G lento + CPU 4×) —')
  const momentos = [
    ['fecha-aos-3s', { ms: 3000 }],
    ['fecha-aos-5s', { ms: 5000 }],
    ['fecha-logo-que-a-medicao-liga', { aposSessao: 100 }],
    ['fecha-1,6s-depois-da-medicao', { aposSessao: 1600 }],
    ['fecha-aos-10s', { ms: 10000 }],
  ]
  const linhas = []
  for (const [nome, q] of momentos) {
    const { ctx, page } = await abrir(browser, 'tiktok-android', { real: true, restricoes: true })
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', REDE_LENTA)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    const vid = `00000000-0000-4000-8000-${String(Date.now()).slice(-12)}`
    await ctx.addInitScript((v) => {
      try {
        localStorage.setItem('lenda:vid', v)
      } catch {}
    }, vid)
    const t0 = Date.now()
    await page.goto(URL0, { waitUntil: 'commit' })
    if (q.ms) await sleep(Math.max(0, q.ms - (Date.now() - t0)))
    else {
      await page.waitForFunction(() => window.__marcas?.sessaoMedicao != null, null, { timeout: 60_000, polling: 50 }).catch(() => {})
      await sleep(q.aposSessao)
    }
    const m = await page.evaluate(() => ({ ...window.__marcas, ePhp: window.__ePhp })).catch(() => ({}))
    const fechouEm = Date.now() - t0
    await page.close({ runBeforeUnload: true })
    await sleep(3000)
    const n = Number(sql(`SELECT COUNT(*) FROM visitas WHERE vid = '${vid}'`))
    linhas.push({ nome, fechouEm, sessao: m.sessaoMedicao ?? null, cta: m.cta ?? null, ePhp: m.ePhp ?? [], visitas: n })
    console.log(`  [${nome}] fechou em ${fechouEm} ms · medição ligou em ${m.sessaoMedicao ?? '—'} · botão ${m.cta ?? '—'} · e.php antes de fechar: ${(m.ePhp ?? []).length} → visitas no banco: ${n}`)
    await ctx.close()
  }
  registro('saida', 'momentos', linhas)
}

// ───────────────────────── etapa: rede (só local) ─────────────────────────
async function etapaRede(browser) {
  console.log('\n— rede: arquivo que não chega —')
  const k = 'galaxy-a'
  const casos = [
    { nome: 'game-data-nao-chega', rota: /assets\/game-data-[^/]+\.js$/, acao: 'abort' },
    { nome: 'css-nao-chega', rota: /assets\/index-[^/]+\.css$/, acao: 'abort' },
    { nome: 'api-fora-do-ar', rota: /\/api\/(?!e\.php)/, acao: 503 },
    { nome: 'site-root-nao-chega', rota: /assets\/SiteRoot-[^/]+\.js$/, acao: 'abort' },
  ]
  for (const c of casos) {
    const { ctx, page, erros } = await abrir(browser, k)
    let n = 0
    await page.route(c.rota, (route) => {
      n++
      return c.acao === 'abort' ? route.abort('connectionreset') : route.fulfill({ status: c.acao, contentType: 'text/html', body: '<html><body>503 Service Unavailable</body></html>' })
    })
    await page.goto(URL0, { waitUntil: 'domcontentloaded' })
    await sleep(9000)
    await page.screenshot({ path: nomePrint('rede', k, c.nome) })
    const tela = await page.evaluate(() => ({
      texto: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 400),
      cta: [...document.querySelectorAll('button')].some((b) => /Começar carreira/.test(b.textContent || '')),
      dados: (() => {
        try {
          return JSON.stringify(window.__dadosFonte ?? null)
        } catch {
          return null
        }
      })(),
      recarregou: performance.getEntriesByType('navigation')[0]?.type,
    }))
    let depois = null
    if (c.nome === 'game-data-nao-chega' && tela.cta) {
      // a Home abriu mesmo sem os dados: com quais dados? (toca em Começar e olha a lista de países da identidade)
      await page.getByRole('button', { name: /Começar carreira/ }).first().tap()
      await page.waitForFunction(() => window.__marcas?.identidade != null, null, { timeout: 20_000 }).catch(() => {})
      await sleep(1500)
      await page.screenshot({ path: nomePrint('rede', k, `${c.nome}-identidade`) })
      depois = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 600))
      ok(false, `[${c.nome}] sem os dados do jogo a Home abre assim mesmo (dados de exemplo, sem aviso)`, depois.slice(0, 200))
    }
    registro('rede', c.nome, { pedidosBarrados: n, ...tela, depois, erros: erros.slice(0, 8) })
    console.log(`  [${c.nome}] barrados ${n} · ${tela.cta ? 'Home com botão' : 'sem botão'} · nav ${tela.recarregou} · "${tela.texto.slice(0, 160)}"`)
    await ctx.close()
  }
  // sem internet depois de abrir: tocar em "Começar carreira"
  {
    const { ctx, page, erros } = await abrir(browser, k)
    await page.goto(URL0, { waitUntil: 'domcontentloaded' })
    await esperarCta(page)
    await sleep(3500) // as pré-cargas do site (2,5 s) já foram
    await ctx.setOffline(true)
    await page.getByRole('button', { name: /Começar carreira/ }).first().tap()
    await sleep(5000)
    await page.screenshot({ path: nomePrint('rede', k, 'sem-internet-ao-comecar') })
    const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 400))
    registro('rede', 'sem-internet-ao-comecar', { texto: t, erros: erros.slice(0, 8), identidade: await page.evaluate(() => window.__marcas?.identidade ?? null) })
    console.log(`  [sem internet ao começar] "${t.slice(0, 200)}"`)
    await ctx.close()
  }
}

// ───────────────────────── etapa: storage (só local) ─────────────────────────
async function etapaStorage(browser) {
  console.log('\n— armazenamento bloqueado —')
  for (const [nome, o] of [
    ['localstorage-cheio', { falhaLs: 'cheio' }],
    ['localstorage-bloqueado-cookies', { falhaLs: 'seguranca' }],
    ['localstorage-nulo-webview', { falhaLs: 'nulo' }],
    ['indexeddb-nao-abre', { falhaIdb: true }],
    ['indexeddb-e-localstorage-cheio', { falhaLs: 'cheio', falhaIdb: true }],
  ]) {
    const { ctx, page, erros } = await abrir(browser, 'iphone-se', o)
    await page.goto(URL0, { waitUntil: 'domcontentloaded' })
    let abriu = true
    try {
      await esperarCta(page, 30_000)
    } catch {
      abriu = false
    }
    let foi = false
    if (abriu) {
      await page.getByRole('button', { name: /Começar carreira/ }).first().tap()
      foi = await page
        .waitForFunction(() => window.__marcas?.identidade != null, null, { timeout: 20_000 })
        .then(() => true)
        .catch(() => false)
    }
    await sleep(800)
    await page.screenshot({ path: nomePrint('storage', 'iphone-se', nome) })
    registro('storage', nome, { abriu, foi, erros: erros.slice(0, 8) })
    ok(abriu && foi, `[${nome}] a Home abre e dá para começar`, erros.slice(0, 3))
    await ctx.close()
  }
}

// ───────────────────────── etapa: safari (só local) ─────────────────────────
// O Safari descarta, ao ler o CSS, a declaração com valor que não entende (vale a anterior da mesma regra), a regra
// inteira com seletor que não entende e o bloco @ que não conhece; numa variável (--x: color-mix(...)) o valor só falha
// na hora de usar, e a propriedade vira "unset". Trocar o nome da função/unidade/seletor por um inválido faz o Chromium
// se comportar igualzinho. Perfis: o que falta no Safari 15.6 (último dos iPhone 6s/7/SE1) e no 16.1.
const PERFIS = {
  'safari-15.6': [
    [/color-mix\(/g, 'color-mixx('],
    [/@container\b/g, '@containerx'],
    [/(\d)(cqw|cqi|cqh|cqmin|cqmax)\b/g, '$1$2x'],
    [/@property\b/g, '@propertyx'],
    [/\(\(-webkit-hyphens:none\)\) and \(not \(margin-trim:inline\)\)/g, '(display:block)'],
    [/text-wrap:\s*(balance|pretty)/g, 'text-wrapx:$1'],
    [/(\d)lh\b/g, '$1lhx'],
  ],
  'safari-16.1': [
    [/color-mix\(/g, 'color-mixx('],
    [/@property\b/g, '@propertyx'],
    [/\(\(-webkit-hyphens:none\)\) and \(not \(margin-trim:inline\)\)/g, '(display:block)'],
    [/text-wrap:\s*(balance|pretty)/g, 'text-wrapx:$1'],
    [/(\d)lh\b/g, '$1lhx'],
  ],
}
async function etapaSafari(browser) {
  console.log('\n— Safari antigo (CSS que ele não entende, simulado) —')
  for (const [perfil, trocas] of Object.entries(PERFIS)) {
    const { ctx, page, erros } = await abrir(browser, 'iphone-se')
    await page.route(/\.css(\?.*)?$/, async (route) => {
      const resp = await route.fetch()
      let css = await resp.text()
      for (const [de, para] of trocas) css = css.replace(de, para)
      return route.fulfill({ response: resp, body: css, headers: { ...resp.headers(), 'content-type': 'text/css' } })
    })
    await page.goto(URL0, { waitUntil: 'domcontentloaded' })
    await esperarCta(page).catch(() => {})
    await sleep(2000)
    await page.screenshot({ path: nomePrint('safari', 'iphone-se', `${perfil}-home-dobra`) })
    await page.screenshot({ path: nomePrint('safari', 'iphone-se', `${perfil}-home-inteira`), fullPage: true })
    const m = await medirTela(page)
    await page.getByRole('button', { name: /Começar carreira/ }).first().tap().catch(() => {})
    await page.waitForFunction(() => window.__marcas?.identidade != null, null, { timeout: 20_000 }).catch(() => {})
    await sleep(900)
    await page.screenshot({ path: nomePrint('safari', 'iphone-se', `${perfil}-identidade`) })
    registro('safari', perfil, { ...m, erros })
    ok(!m.rolaLado, `[${perfil}] sem rolagem lateral`)
    ok(!!m.cta?.acimaDaDobra, `[${perfil}] botão acima da dobra`)
    await ctx.close()
  }
}

// ───────────────────────── roda ─────────────────────────
const browser = await chromium.launch({ executablePath: EXE })
try {
  const mapa = { home: etapaHome, inicio: etapaInicio, carga: etapaCarga, filme: etapaFilme, animacao: etapaAnimacao, inapp: etapaInapp, medicao: etapaMedicao, saida: etapaSaida, rede: etapaRede, storage: etapaStorage, safari: etapaSafari }
  for (const e of ETAPAS) await mapa[e](browser)
} finally {
  await browser.close()
  writeFileSync(join(SAIDA, `relatorio-${ALVO}.json`), JSON.stringify(resultado, null, 2))
}
console.log(`\n${falhas ? `✗ ${falhas} conferência(s) falharam` : '✓ tudo certo'} — relatório em ${join(SAIDA, `relatorio-${ALVO}.json`)}`)
process.exit(falhas ? 1 : 0)
