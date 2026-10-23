// LENDA v3.5 · suíte mobile — o que é comum a todas as áreas (carreira, primeira impressão, Hall, conta, painel, toque):
//
//   import { APARELHOS, EXTRAS, pastaPrints, barreiraProd, religarToque, inesperados, placar } from './aparelhos.mjs'
//
// · APARELHOS: os celulares da revisão, com a janela, o DPR e o user agent de verdade de cada um (inclusive os navegadores
//   de dentro do TikTok, do Instagram e do WhatsApp). w×h = a janela que a página recebe nos testes (a tela inteira nos
//   navegadores comuns; nos apps, a área do WebView abaixo da barra do app); `janela` = o que sobra da tela com as barras
//   do navegador (Safari/Chrome) — é ela que decide o que aparece "sem rolar" na primeira impressão; `tela` = a tela.
//   EXTRAS: aparelhos que só algumas áreas usam (o Galaxy A deitado da conta, o WhatsApp do iPhone da primeira impressão).
// · pastaPrints(area): onde ficam os prints e os relatórios. LENDA_PRINTS é a pasta-raiz (padrão ${TMPDIR:-/tmp}/lenda-mobile);
//   cada área escreve em <raiz>/<area>.
// · barreiraProd(ctx): produção só leitura. Em todo documento (e em toda aba nova do contexto): o e.php (medição de visitas)
//   é respondido aqui mesmo com 204, e qualquer escrita (POST/PUT/PATCH/DELETE) para /api/ é barrada — pelo domínio Fetch
//   do CDP (não pelo page.route, que desligaria o cache HTTP da página) e também dentro da página (fetch, sendBeacon e
//   XMLHttpRequest), porque o sendBeacon do pagehide sai quando a aba fecha, depois de o CDP já ter soltado a página.
// · religarToque(page): o print de página inteira (fullPage) do Playwright desliga a emulação de toque do Chromium
//   ((pointer: coarse) deixa de valer e a página passa a ser medida como se fosse com mouse). Os print() das libs chamam.
// · inesperados(lista): tira da lista de erros os que são esperados (o 404 do perfil.php para código que não existe, as
//   escritas barradas de propósito em produção, os 401 de quem não está logado).
// · placar(nome): conferências (ok/falha/nota) e o código de saída (1 quando alguma falhou).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const URL_PROD = 'https://oprojeto.online/lenda/'
/**
 * O servidor HTTP/2 de teste (ferramentas/servidor-h2.mjs) tem certificado autoassinado: com LENDA_TLS_SPKI (o hash que ele
 * grava), o Chromium o trata como válido — e aí guarda as respostas no cache HTTP (com erro de certificado, não guarda, e a
 * "2ª visita" da carga baixava tudo de novo). Vai nos args do chromium.launch().
 */
export const ARGS_TLS = process.env.LENDA_TLS_SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.LENDA_TLS_SPKI}`] : []
export const EXE = process.env.LENDA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
export const PLAYWRIGHT = process.env.LENDA_PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright/index.mjs'

export const IOS_SAFARI = (v, ver = v.replace(/_/g, '.')) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${ver} Mobile/15E148 Safari/604.1`
export const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'

/** Os 11 aparelhos da revisão (os que as áreas percorrem quando a lista não é dada). */
export const APARELHOS = {
  'iphone-se': { w: 375, h: 667, dpr: 2, ios: true, tela: [375, 667], janela: [375, 553], ua: IOS_SAFARI('17_7'), nome: 'iPhone SE (Safari)' },
  'iphone-14': { w: 390, h: 844, dpr: 3, ios: true, tela: [390, 844], janela: [390, 664], ua: IOS_SAFARI('18_6'), nome: 'iPhone 14/15 (Safari)' },
  'galaxy-a': {
    w: 360,
    h: 800,
    dpr: 3,
    tela: [360, 800],
    janela: [360, 672],
    ua: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
    nome: 'Galaxy A (Samsung Internet)',
  },
  'pixel-7': { w: 412, h: 915, dpr: 2.625, tela: [412, 915], janela: [412, 797], ua: CHROME_ANDROID, nome: 'Pixel 7 (Chrome)' },
  'pequeno-320': {
    w: 320,
    h: 640,
    dpr: 2,
    tela: [320, 640],
    janela: [320, 528],
    ua: 'Mozilla/5.0 (Linux; Android 9; SM-J260M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    nome: 'celular pequeno 320 (Chrome)',
  },
  deitado: { w: 844, h: 390, dpr: 3, ios: true, tela: [844, 390], janela: [844, 340], ua: IOS_SAFARI('18_6'), nome: 'iPhone 14 deitado (Safari)' },
  'tiktok-android': {
    w: 360,
    h: 680,
    dpr: 3,
    android: true,
    app: 'tiktok',
    tela: [360, 800],
    janela: [360, 680],
    nome: 'TikTok (Android, navegador do app)',
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.107 Mobile Safari/537.36 trill_370104 JsSdk/1.0 NetType/4G Channel/googleplay AppName/trill app_version/37.1.4 ByteLocale/pt-BR ByteFullLocale/pt-BR Region/BR AppId/1180 Spark/1.5.9.1 AppVersion/37.1.4 BytedanceWebview/d8a21c6',
  },
  'tiktok-ios': {
    w: 390,
    h: 720,
    dpr: 3,
    ios: true,
    app: 'tiktok',
    tela: [390, 844],
    janela: [390, 700],
    nome: 'TikTok (iPhone, navegador do app)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_37.1.0 JsSdk/2.0 NetType/4G Channel/App Store ByteLocale/pt Region/BR isDarkMode/1 WKWebView/1 RevealType/Dialog BytedanceWebview/d8a21c6',
  },
  'instagram-android': {
    w: 412,
    h: 790,
    dpr: 2.625,
    android: true,
    app: 'instagram',
    tela: [412, 915],
    janela: [412, 790],
    nome: 'Instagram (Android, navegador do app)',
    ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 7 Build/AP4A.250205.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/133.0.6943.137 Mobile Safari/537.36 Instagram 370.1.0.43.96 Android (35/15; 420dpi; 1080x2219; Google/google; Pixel 7; panther; panther; pt_BR; 704872281)',
  },
  'instagram-ios': {
    w: 390,
    h: 710,
    dpr: 3,
    ios: true,
    app: 'instagram',
    tela: [390, 844],
    janela: [390, 690],
    nome: 'Instagram (iPhone, navegador do app)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 370.0.0.24.108 (iPhone15,2; iOS 18_6; pt_BR; pt; scale=3.00; 1179x2556; 705050118)',
  },
  // O WhatsApp do Android abre o link no navegador do próprio app (WebView com "WhatsApp/…" no UA) ou na Custom Tab do
  // Chrome; nos dois casos o referrer é android-app://com.whatsapp/.
  'whatsapp-android': {
    w: 360,
    h: 700,
    dpr: 3,
    android: true,
    app: 'whatsapp',
    tela: [360, 800],
    janela: [360, 696],
    referrer: 'android-app://com.whatsapp/',
    nome: 'WhatsApp (Android, navegador do app)',
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.107 Mobile Safari/537.36 WhatsApp/2.24.21.77',
  },
}

/** Aparelhos que só algumas áreas usam (não entram no "todos" das áreas). */
export const EXTRAS = {
  // o Galaxy A deitado (Chrome do Android: o teclado encolhe a janela, que deitada fica com ~150 px)
  'galaxy-a-deitado': { ...APARELHOS['galaxy-a'], w: 800, h: 360, tela: [800, 360], janela: [800, 300], nome: 'Galaxy A deitado' },
  // o WhatsApp do iPhone abre o Safari
  'whatsapp-ios': { w: 390, h: 844, dpr: 3, ios: true, app: 'whatsapp', tela: [390, 844], janela: [390, 664], ua: IOS_SAFARI('18_6'), nome: 'WhatsApp (iPhone → Safari)' },
  // o computador, para conferir que o celular não quebrou a tela larga
  'desktop-1366': { w: 1366, h: 900, dpr: 1, desktop: true, tela: [1366, 900], janela: [1366, 900], ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', nome: 'computador 1366×900' },
}
export const TODOS = { ...APARELHOS, ...EXTRAS }
/** O aparelho pelo nome (dos 11 ou dos extras); erro claro se não existir. */
export function aparelho(nome) {
  const a = TODOS[nome]
  if (!a) throw new Error(`aparelho desconhecido: ${nome} (conhecidos: ${Object.keys(TODOS).join(', ')})`)
  return a
}

// ───────────────────────── prints ─────────────────────────
export const RAIZ_PRINTS = process.env.LENDA_PRINTS || join(process.env.TMPDIR || '/tmp', 'lenda-mobile')
/** A pasta de prints/relatórios da área (criada). `especifica` = a variável antiga da área (LENDA_PRINTS_HALL…), se houver. */
export function pastaPrints(area, especifica) {
  const d = especifica || join(RAIZ_PRINTS, area)
  mkdirSync(d, { recursive: true })
  return d
}
export const slug = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

/** Depois de um print de página inteira: a emulação de toque de volta (o fullPage do Playwright a desliga). */
export async function religarToque(page) {
  try {
    const cdp = page.__cdp ?? (page.__cdp = await page.context().newCDPSession(page))
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: false }).catch(() => {})
    // espera a página reagir à volta do (pointer: coarse): o (pointer: coarse) volta a valer (o renderer aplica a emulação
    // depois de o CDP responder; com a máquina ocupada, demora), e o layout e os ResizeObserver rodam nos quadros seguintes
    await page
      .waitForFunction(() => matchMedia('(pointer: coarse)').matches, null, { timeout: 3000, polling: 30 })
      .catch(() => {})
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 150)))))).catch(() => {})
  } catch {}
}

/**
 * Abre a URL e espera o seletor. Na produção, com paciência: depois de uma rajada de contextos novos (cada um baixa o jogo
 * inteiro, sem cache) a hospedagem às vezes segura o IP por um tempo e a tela não chega. Então espera 30 s e tenta de
 * novo (até 3 vezes), contando no erro as respostas ≥ 400 que viu — e assim também pesa menos para o servidor de verdade.
 */
export async function abrirEsperando(page, url, seletor, { prod = false, ms = 120000, tentativas = prod ? 3 : 1, pausa = 30000 } = {}) {
  const ruins = []
  const ver = (r) => {
    if (r.status() >= 400) ruins.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 80)}`)
  }
  page.on('response', ver)
  try {
    for (let i = 1; ; i++) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: ms })
        await page.locator(seletor).first().waitFor({ state: 'visible', timeout: prod ? Math.min(ms, 60000) : ms })
        return
      } catch (e) {
        if (i >= tentativas) {
          e.message = `${String(e.message).split('\n')[0]} (${i} tentativa(s)${ruins.length ? `; respostas ≥ 400: ${[...new Set(ruins)].slice(0, 5).join(' · ')}` : ''})`
          throw e
        }
        console.log(`  ..  ${seletor} não apareceu em ${url} (tentativa ${i}${ruins.length ? `; ${[...new Set(ruins)].slice(0, 3).join(' · ')}` : ''}); de novo em ${pausa / 1000} s`)
        await new Promise((r) => setTimeout(r, pausa))
      }
    }
  } finally {
    page.off('response', ver)
  }
}

// ───────────────────────── produção só leitura ─────────────────────────
const ESCRITA = /^(POST|PUT|PATCH|DELETE)$/i
/**
 * Barreira da produção num contexto: e.php respondido com 204 aqui, escrita para /api/ barrada (CDP + dentro da página).
 * Devolve a lista (viva) do que foi barrado/respondido aqui, para o relatório.
 */
export async function barreiraProd(ctx, registro = []) {
  await ctx.addInitScript(() => {
    const ehApi = (u) => /\/api\//.test(String(u))
    const ehMedicao = (u) => /\/api\/e\.php/.test(String(u))
    const barrados = (window.__barradosProd = [])
    const of = window.fetch
    window.fetch = function (u, i) {
      const url = typeof u === 'string' ? u : u?.url ?? String(u)
      const metodo = String(i?.method ?? (typeof u === 'object' && u?.method) ?? 'GET').toUpperCase()
      if (ehMedicao(url)) {
        barrados.push(`medição ${metodo} ${url}`)
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (ehApi(url) && !['GET', 'HEAD', 'OPTIONS'].includes(metodo)) {
        barrados.push(`${metodo} ${url}`)
        return Promise.reject(new TypeError('Failed to fetch (barrado: produção só leitura)'))
      }
      return of.apply(this, arguments)
    }
    if (navigator.sendBeacon) {
      const sb = navigator.sendBeacon.bind(navigator)
      navigator.sendBeacon = (u, d) => {
        if (ehApi(u)) {
          barrados.push(`beacon ${u}`)
          return true
        }
        return sb(u, d)
      }
    }
    const xo = XMLHttpRequest.prototype.open
    const xs = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (m, u) {
      this.__barrar = ehApi(u) && (ehMedicao(u) || !/^(GET|HEAD|OPTIONS)$/i.test(m))
      this.__url = `${m} ${u}`
      return xo.apply(this, arguments)
    }
    XMLHttpRequest.prototype.send = function () {
      if (this.__barrar) {
        barrados.push(`xhr ${this.__url}`)
        return
      }
      return xs.apply(this, arguments)
    }
  })
  const proteger = async (page) => {
    try {
      const cdp = await ctx.newCDPSession(page)
      cdp.on('Fetch.requestPaused', (e) => {
        const m = e.request.method
        if (/\/api\/e\.php/.test(e.request.url)) {
          registro.push(`medição respondida aqui (204): ${m} ${e.request.url.replace(/\?.*/, '')}`)
          return cdp.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: 204, body: '' }).catch(() => {})
        }
        if (ESCRITA.test(m)) {
          registro.push(`escrita barrada: ${m} ${e.request.url.replace(/\?.*/, '')}`)
          return cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'BlockedByClient' }).catch(() => {})
        }
        return cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => {})
      })
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] })
    } catch {}
  }
  for (const p of ctx.pages()) await proteger(p)
  ctx.on('page', (p) => void proteger(p))
  return registro
}

// ───────────────────────── Safari antigo (simulado no CSS servido) ─────────────────────────
/**
 * O que cada Safari antigo não entende, trocado no CSS servido por algo inválido: o parser do Chromium descarta a
 * declaração (ou o @supports dá falso) e fica valendo a reserva escrita antes — exatamente o que o Safari faz. (Injetar
 * CSS com !important, como se fazia antes, não vê as reservas.)
 */
export const PERFIS_SAFARI = {
  // iOS 16.0–16.1: sem color-mix() (16.2), @property, text-wrap: balance/pretty, unidade lh
  'safari-16.1': [
    [/color-mix\(/g, 'color-mixx('],
    [/@property\b/g, '@propertyx'],
    [/text-wrap:\s*(balance|pretty)/g, 'text-wrapx:$1'],
    [/(\d)lh\b/g, '$1lhx'],
  ],
  // iOS 15.4–15.8: e mais sem overflow: clip (16), @container/cqw (16)
  'safari-15.6': [
    [/color-mix\(/g, 'color-mixx('],
    [/@container\b/g, '@containerx'],
    [/\bcontainer-(type|name)\b/g, 'container-$1x'],
    [/([;{\s])container\s*:/g, '$1containerx:'],
    [/(\d)(cqw|cqi|cqh|cqmin|cqmax)\b/g, '$1$2x'],
    [/@property\b/g, '@propertyx'],
    [/text-wrap:\s*(balance|pretty)/g, 'text-wrapx:$1'],
    [/(\d)lh\b/g, '$1lhx'],
    [/(overflow(?:-x|-y)?:\s*)clip\b/g, '$1clipx'],
    [/(overflow:\s*\w+\s+)clip\b/g, '$1clipx'],
  ],
  // iOS 15.0–15.3: e mais sem dvh/svh/lvh (15.4) e sem :has() (15.4)
  'safari-15.3': [
    [/color-mix\(/g, 'color-mixx('],
    [/@container\b/g, '@containerx'],
    [/\bcontainer-(type|name)\b/g, 'container-$1x'],
    [/([;{\s])container\s*:/g, '$1containerx:'],
    [/(\d)(cqw|cqi|cqh|cqmin|cqmax)\b/g, '$1$2x'],
    [/@property\b/g, '@propertyx'],
    [/text-wrap:\s*(balance|pretty)/g, 'text-wrapx:$1'],
    [/(\d)lh\b/g, '$1lhx'],
    [/(overflow(?:-x|-y)?:\s*)clip\b/g, '$1clipx'],
    [/(overflow:\s*\w+\s+)clip\b/g, '$1clipx'],
    [/(\d)(dvh|svh|lvh|dvw|svw|lvw)\b/g, '$1$2x'],
    [/:has\(/g, ':hasx('],
  ],
}
/** Serve o CSS do jogo (arquivos .css) como o Safari daquele perfil o entenderia. Num contexto ou numa página. */
export async function simularSafari(alvo, perfil) {
  const trocas = PERFIS_SAFARI[perfil]
  if (!trocas) throw new Error(`perfil de Safari desconhecido: ${perfil}`)
  await alvo.route(/\.css(\?.*)?$/, async (route) => {
    const resp = await route.fetch()
    let css = await resp.text()
    for (const [de, para] of trocas) css = css.replace(de, para)
    return route.fulfill({ response: resp, body: css, headers: { ...resp.headers(), 'content-type': 'text/css' } })
  })
}

// ───────────────────────── erros esperados ─────────────────────────
/**
 * O que NÃO é defeito: o 404 do perfil.php para código que não existe (a tela mostra "Perfil não encontrado"; é o
 * contrato da v3.3), os 401 de quem não está logado, as escritas barradas de propósito em produção e o aborto da
 * medição quando a aba fecha.
 */
export const ESPERADOS = [
  /perfil\.php\?[^ ]*\b(c|codigo)=[^ ]*.*\b404\b|404 .*perfil\.php/,
  /status of 401|\b401 .*\/api\//,
  /ERR_BLOCKED_BY_CLIENT|blockedbyclient|barrado: produção só leitura/,
  /ERR_ABORTED.*e\.php|e\.php.*ERR_ABORTED/,
  // pedido cancelado pelo próprio navegador porque a página navegou/recarregou no meio (não aparece para a pessoa)
  /^falhou net::ERR_ABORTED /,
]
export const esperado = (t, extra = []) => [...ESPERADOS, ...extra].some((re) => re.test(t))
export const inesperados = (lista, extra = []) => [...new Set(lista)].filter((t) => !esperado(t, extra))

/**
 * Liga os ouvintes de erro numa página: erros do console (com o endereço do recurso, para dar para separar o 404 do
 * perfil.php), pageerror, pedidos que falharam e respostas 4xx/5xx. Devolve { erros, rede, s5xx }.
 */
export function ouvirErros(page, o = {}) {
  const r = { erros: [], avisos: [], rede: [], s5xx: [] }
  page.on('console', (m) => {
    const t = m.text()
    const onde = m.location()?.url
    const linha = /Failed to load resource/.test(t) && onde ? `${t} @ ${onde}` : t
    if (m.type() === 'error') r.erros.push(linha)
    else if (m.type() === 'warning') r.avisos.push(linha)
  })
  page.on('pageerror', (e) => r.erros.push(`pageerror: ${e.message}`))
  page.on('requestfailed', (q) => {
    if (o.ignorarFalha?.(q)) return
    r.rede.push(`falhou ${q.failure()?.errorText} ${q.url()}`)
  })
  page.on('response', (q) => {
    if (q.status() >= 400) r.rede.push(`${q.status()} ${q.url()}`)
    if (q.status() >= 500) r.s5xx.push(`${q.status()} ${q.request().method()} ${q.url()}`)
  })
  return r
}

// ───────────────────────── placar e código de saída ─────────────────────────
/** Conferências de um script. fim() escreve o resumo e põe process.exitCode = 1 se alguma falhou. */
export function placar(nome) {
  const p = { nome, oks: 0, falhas: [], notas: [] }
  p.ok = (c, msg, extra) => {
    const txt = extra === undefined ? msg : `${msg} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`
    console.log(`${c ? '  ok  ' : '  XX  '}${txt}`)
    if (c) p.oks++
    else p.falhas.push(txt)
    return !!c
  }
  p.falha = (msg, extra) => p.ok(false, msg, extra)
  p.nota = (msg) => {
    console.log(`  ..  ${msg}`)
    p.notas.push(msg)
  }
  p.fim = () => {
    console.log(`\n${nome}: ${p.oks} ok · ${p.falhas.length} falha(s) · ${p.notas.length} nota(s)`)
    for (const f of p.falhas.slice(0, 30)) console.log(`   XX ${f}`)
    process.exitCode = p.falhas.length ? 1 : process.exitCode ?? 0
    return p.falhas.length
  }
  return p
}
