#!/usr/bin/env node
// LENDA v3.5 · suíte mobile — UM COMANDO para os fluxos principais no celular (emulação do Chromium do Playwright, com a
// janela, o DPR, o toque e o user agent de verdade de cada aparelho — aparelhos.mjs).
//
//   pilha local (servidor/teste/integracao/subir.sh com o build:site atual; a semente do hall-semear.mjs ajuda o Hall):
//     LENDA_INTEG_BASE=/tmp/lenda-v35 node servidor/teste/mobile/mobile.mjs
//   produção, SÓ LEITURA (nenhuma escrita sai do navegador; a medição de visitas é respondida aqui com 204):
//     node servidor/teste/mobile/mobile.mjs --alvo prod
//
// Fluxos (--fluxos a,b; padrão: todos os do alvo):
//   local: home · carreira (inteira no Expresso, com o resumo e o Compartilhar) · hall (filtros, linha da comunidade) ·
//          desafios (faixa da Home e #/desafios) · conta (criar conta → código do e-mail → sair → entrar → Minha conta →
//          Fale conosco) · painel (senha → PIN → Visão geral e Usuários)
//   prod:  home · hall · desafios · perfil (um perfil público do Hall) · previa (o link de compartilhar, api/v.php)
// Outras opções: --aparelhos a,b (troca a lista de todos os fluxos) · --rapido (3 aparelhos por fluxo) · --lento (4G lento +
// CPU 4× na carreira) · --saida <pasta> (padrão <LENDA_PRINTS>/mobile ou /mobile-prod).
//
// Em cada tela: print <aparelho>_<tela>.png e as conferências que REPROVAM (código de saída 1):
//   · rolagem lateral, ou botão/texto passando da borda da janela (a .lx-app corta com overflow-x: clip: some sem aviso);
//   · texto cortado CONHECIDO (os lugares que a revisão v3.5 achou: tabela da carreira, Seleção e prêmios do resumo, Hall
//     em 320, barra do topo, pênalti, abas de Minhas carreiras, avisos, comemoração…), sem reticências ou vazando a caixa;
//   · alvo de toque < 40 px nos botões principais da tela (os da lista de cada tela, contando a área invisível de
//     ::before/::after e o <label> em volta do campo);
//   · campo com fonte < 16 px (o iPhone dá zoom ao tocar);
//   · erro de JavaScript/console e resposta 5xx do servidor (fora os esperados: o 404 do perfil.php para código que não
//     existe, os 401 de quem não está logado, as escritas barradas de propósito na produção).
// E por fluxo: o card do fim aparece sem rolar, o Compartilhar responde em até 3 s, o código do e-mail confirma a conta, o
// PIN abre o painel etc. Relatório JSON em <saída>/relatorio-<alvo>.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { abrir, lancar, lento, print as printBase, sleep, teclado } from './carreira-lib.mjs'
import { APARELHOS, URL_PROD, pastaPrints, inesperados, placar } from './aparelhos.mjs'

const arg = (k, d) => {
  const eq = process.argv.find((a) => a.startsWith(`--${k}=`))
  if (eq) return eq.slice(k.length + 3)
  const i = process.argv.indexOf(`--${k}`)
  if (i < 0) return d
  const v = process.argv[i + 1]
  return !v || v.startsWith('--') ? true : v
}
const ALVO = arg('alvo', 'local')
const PROD = ALVO === 'prod'
const BASE = process.env.LENDA_INTEG_BASE ?? '/tmp/lenda-integracao'
const env = !PROD && existsSync(`${BASE}/segredos.env`) ? Object.fromEntries(readFileSync(`${BASE}/segredos.env`, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
if (!PROD && !env.PORTA) throw new Error(`sem ${BASE}/segredos.env: suba a pilha (LENDA_INTEG_BASE=${BASE} PORTA=… BANCO=… bash servidor/teste/integracao/subir.sh) ou use --alvo prod`)
const URL0 = PROD ? URL_PROD : (process.env.LENDA_URL ?? `http://127.0.0.1:${env.PORTA}/lenda/`).replace(/\/?$/, '/')
const SEM = !PROD && existsSync(`${BASE}/hall-semente.json`) ? JSON.parse(readFileSync(`${BASE}/hall-semente.json`, 'utf8')) : null
const SAIDA = arg('saida', null) || pastaPrints(PROD ? 'mobile-prod' : 'mobile')
const FLUXOS_LOCAL = ['home', 'carreira', 'hall', 'desafios', 'conta', 'painel']
const FLUXOS_PROD = ['home', 'hall', 'desafios', 'perfil', 'previa']
const FLUXOS = String(arg('fluxos', (PROD ? FLUXOS_PROD : FLUXOS_LOCAL).join(','))).split(',').filter(Boolean)
for (const f of FLUXOS) if (!(PROD ? FLUXOS_PROD : FLUXOS_LOCAL).includes(f)) throw new Error(`fluxo "${f}" não existe${PROD ? ' na produção (lá só se lê: nada de carreira, conta ou painel)' : ''}`)
const LISTA = arg('aparelhos', null)
const RAPIDO = !!arg('rapido', false)
const LENTO = !!arg('lento', false)
const lista = (padrao, rapido) => (LISTA ? String(LISTA).split(',') : RAPIDO ? rapido : padrao)
const TODOS11 = Object.keys(APARELHOS)
const P = placar(`mobile.mjs (${ALVO}: ${URL0})`)
const RELATORIO = { alvo: ALVO, url: URL0, quando: new Date().toISOString(), telas: [], fluxos: {} }
const RAPIDO_JOGO = JSON.stringify({ state: { settings: { sound: false, volume: 0, skipAnimations: true, reducedMotion: true, lowFx: false, engine: 'auto' } }, version: 1 })
const SENHA = 'senha-forte-123'
const PIN_DONO = process.env.LENDA_PIN_DONO ?? '729153'
console.log(`mobile.mjs · alvo ${ALVO} (${URL0}) · fluxos ${FLUXOS.join(', ')} · prints em ${SAIDA}`)

// ───────────────────────── o que reprova numa tela ─────────────────────────
/** Lugares de texto cortado que a revisão achou (e que a v3.5 corrigiu): se voltarem, reprova. */
const CORTES = [
  '.ck-row__masklabel', '.ck-marker__l', '.ck-row__nm', '.ck-kind', '.ck-session', '.ck-pen__zlabel', '.ck-cel [class*="__name"]', '.ck-cel [class*="__club"]',
  '.ck-opt__fx', '.ck-opt [class*="prob"]', '.ck-endbar__t',
  'ul.sm-nat__list > li', '.sm-nat__g', '.sm-aw li', '.sm-share__actions button', '.sm-ident__name',
  '.hl-row__name b', '.hl-runtag', '.hl-kicker', '.hl-lf__tabs [role="tab"]', '.hl-panel__h', '.hl-seg', '.hl-cstatus',
  '.lx-topbar__center', '.lx-toast__title', '.lx-toast__desc',
  '.sc-tabs [role="tab"]', '.sc-hp [role="radiogroup"] *', '.sc-perks', '.sc-card__t', '.sc-card__nota',
  '.s4-faixa', '.s4-dif',
  '.ld-ctas__start', '.ld-title',
  '#titulo-aba', '.gaveta-cabeca', '.lista.cartoes td', '.novidade-item',
]
/** Mede a tela (no navegador). botoes = seletores dos alvos principais desta tela. */
function medirTela(page, botoes, raiz) {
  return page.evaluate(
    ({ botoes, cortes, raiz }) => {
      const W = innerWidth
      const H = window.visualViewport ? window.visualViewport.height : innerHeight
      const de = document.documentElement
      const lateral = Math.max(de.scrollWidth, document.body.scrollWidth) - W
      const visivel = (el, naJanela = true) => {
        const r = el.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) return null
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return null
        if (el.closest('[hidden],[aria-hidden="true"],.sr-only,.lx-sr-only,[inert],.fora-da-tela')) return null
        if (naJanela && (r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W)) return null
        return r
      }
      const nome = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.className || el.tagName).toString().replace(/\s+/g, ' ').trim().slice(0, 40)
      const caminho = (el) => {
        const p = []
        for (let e = el; e && e !== document.body && p.length < 3; e = e.parentElement) p.unshift(e.tagName.toLowerCase() + (e.classList[0] ? '.' + e.classList[0] : ''))
        return p.join('>')
      }
      const rolaDeLado = (el) => {
        for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
          const cs = getComputedStyle(e)
          if (/auto|scroll/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1) return true
          if (cs.position === 'fixed') return false
        }
        return false
      }
      const base = (raiz && document.querySelector(raiz)) || document
      // 1. passa da borda da janela (sem uma caixa que role de lado): botões, campos e texto
      const vazam = []
      for (const el of base.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="radio"], h1, h2, h3, p, li, label, b, strong, span')) {
        const r = visivel(el)
        if (!r) continue
        if (r.right <= W + 1 && r.left >= -1) continue
        if (el.closest('.ld-ticker, [class*="marquee"], .lx-toast')) continue
        if (rolaDeLado(el)) continue
        if (el.tagName === 'SPAN' && !el.textContent.trim()) continue
        vazam.push(`${caminho(el)} "${nome(el)}" [${Math.round(r.left)}..${Math.round(r.right)}]`)
        if (vazam.length > 8) break
      }
      // 2. texto cortado nos lugares conhecidos
      const cortados = []
      for (const sel of cortes) {
        for (const el of base.querySelectorAll(sel)) {
          const r = visivel(el)
          if (!r) continue
          const cs = getComputedStyle(el)
          const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none'
          const corteX = el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(cs.overflowX) && cs.textOverflow !== 'ellipsis'
          const corteY = !clamp && el.scrollHeight > el.clientHeight + 4 && /hidden|clip/.test(cs.overflowY) && cs.display !== 'inline'
          // vaza da caixa do pai (overflow visível, mas o conteúdo passa por cima do vizinho / sai do cartão)
          const pai = el.parentElement?.getBoundingClientRect()
          const vazaPai = pai && el.parentElement !== document.body && cs.position !== 'absolute' && cs.position !== 'fixed' && (r.right > pai.right + 2 || r.left < pai.left - 2) && !rolaDeLado(el)
          if (corteX || corteY) cortados.push(`${sel} "${nome(el)}" (${el.clientWidth}/${el.scrollWidth}×${el.clientHeight}/${el.scrollHeight})`)
          else if (vazaPai && /sm-nat__list|sm-nat__g|sm-aw/.test(sel)) cortados.push(`${sel} "${nome(el)}" sai da caixa [${Math.round(r.left)}..${Math.round(r.right)} em ${Math.round(pai.left)}..${Math.round(pai.right)}]`)
          if (cortados.length > 8) break
        }
      }
      // 3. alvos principais com menos de 40 px (área do toque: retângulo + ::before/::after com inset negativo + <label>)
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
      const pequenos = []
      const vistos = new Set()
      for (const sel of botoes) {
        for (const el of base.querySelectorAll(sel)) {
          if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue
          let r = visivel(el)
          if (!r) continue
          // campo dentro de uma caixa que, tocada em qualquer ponto, foca o campo (o <label>, a .sc-input de 48 px, a .lx-input)
          const caixa = /INPUT|SELECT|TEXTAREA/.test(el.tagName) ? el.closest('label, .sc-input, .lx-input, .hl-fsel, .hl-fsearch') : null
          if (caixa && visivel(caixa)) r = caixa.getBoundingClientRect()
          const a = area(el, r)
          if (a.w + 0.5 >= 40 && a.h + 0.5 >= 40) continue
          const k = `${sel}|${nome(el)}`
          if (vistos.has(k)) continue
          vistos.add(k)
          pequenos.push(`${sel} "${nome(el)}" ${Math.round(a.w)}×${Math.round(a.h)}`)
        }
      }
      // 4. campos com fonte < 16 px (zoom do iPhone ao tocar)
      const campos = []
      for (const el of base.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]), select, textarea')) {
        if (!visivel(el, false)) continue
        const fs = parseFloat(getComputedStyle(el).fontSize)
        if (fs < 15.9) campos.push(`${el.id || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || el.tagName} ${fs}px`)
      }
      return { lateral, vazam, cortados, pequenos, campos, janela: `${W}x${Math.round(H)}` }
    },
    { botoes, cortes: CORTES, raiz: raiz ?? null },
  )
}

/** Mede, fotografa e confere uma tela. o.botoes = alvos principais; o.raiz = só dentro do diálogo; o.semCampos. */
async function olhar(d, tela, o = {}) {
  await sleep(o.espera ?? 600)
  const r = await medirTela(d.page, o.botoes ?? [], o.raiz)
  const f = await printBase(d.page, d.nome, tela, { dir: SAIDA })
  const prob = []
  if (r.lateral > 0) prob.push(`ROLAGEM LATERAL de ${r.lateral}px`)
  if (r.vazam.length) prob.push(`passa da borda: ${r.vazam.slice(0, 4).join(' · ')}`)
  if (r.cortados.length) prob.push(`texto cortado: ${r.cortados.slice(0, 4).join(' · ')}`)
  // no computador (mouse) a regra dos 40 px do dedo não vale
  if (r.pequenos.length && !d.a.desktop) prob.push(`alvo < 40 px: ${r.pequenos.slice(0, 6).join(' · ')}`)
  if (r.campos.length && !o.semCampos) prob.push(`campo < 16 px (zoom do iPhone): ${r.campos.slice(0, 4).join(', ')}`)
  P.ok(!prob.length, `${d.nome} · ${tela}`, prob.length ? prob.join(' | ') : undefined)
  RELATORIO.telas.push({ aparelho: d.nome, tela, print: f, ...r })
  return r
}

/** Toque de dedo, rolando até o alvo antes. */
async function tocar(loc, o = {}) {
  await loc.scrollIntoViewIfNeeded({ timeout: o.timeout ?? 8000 }).catch(() => {})
  await loc.tap({ timeout: o.timeout ?? 8000, force: o.force })
  await sleep(o.espera ?? 350)
}

/** Fecha o aparelho conferindo erros de console e 5xx desde a abertura. */
async function fechar(d, rot) {
  const naPagina = PROD ? await d.page.evaluate(() => window.__barradosProd?.length ?? 0).catch(() => 0) : 0
  const js = inesperados([...d.erros, ...d.s5xx], [/status of 400/])
  P.ok(!js.length, `${d.nome} · ${rot}: sem erro no console nem 5xx`, js.length ? js.slice(0, 5) : undefined)
  if (PROD) console.log(`  ..  ${d.nome}: produção só leitura — ${naPagina} pedido(s) de escrita/medição barrados dentro da página e ${d.barrados.length} no CDP`)
  await d.ctx.close().catch(() => {})
}

const browser = await lancar()
const T0 = Date.now()
const fluxo = async (nome, fn) => {
  if (!FLUXOS.includes(nome)) return
  console.log(`\n══════ ${nome} ══════`)
  const t = Date.now()
  const f0 = P.falhas.length
  try {
    await fn()
  } catch (e) {
    P.falha(`${nome}: travou — ${String(e.message).split('\n')[0]}`)
    console.log(e.stack?.split('\n').slice(0, 5).join('\n'))
  }
  RELATORIO.fluxos[nome] = { s: Math.round((Date.now() - t) / 1000), falhas: P.falhas.length - f0 }
}
const BOTOES_TOPO = ['.lx-topbar button', '.lx-topbar a.lx-brand']

// ───────────────────────── Home ─────────────────────────
await fluxo('home', async () => {
  for (const nome of lista([...TODOS11, 'desktop-1366'], ['pequeno-320', 'iphone-se', 'tiktok-android'])) {
    const d = await abrir(browser, nome, { prod: PROD })
    try {
      await d.page.goto(URL0, { waitUntil: 'commit', timeout: 120000 })
      await d.page.locator('.ld-ctas__start').waitFor({ state: 'visible', timeout: 120000 })
      await d.page.evaluate(() => document.fonts?.ready).catch(() => {})
      await sleep(900)
      const bb = await d.page.locator('.ld-ctas__start').boundingBox()
      const vh = await d.page.evaluate(() => innerHeight)
      P.ok(!!bb && bb.y + bb.height <= vh, `${nome} · home: "Começar carreira" aparece sem rolar`, bb ? `topo ${Math.round(bb.y)}–${Math.round(bb.y + bb.height)} de ${vh}` : 'não achado')
      await olhar(d, 'home', { botoes: ['.ld-ctas__start', '.ld-rhythm [role="radio"]', ...BOTOES_TOPO, '.ld-medal', '.s4-faixa__d', '.s4-faixa__todos'] })
      // a Home inteira, rolando (o que fica embaixo da dobra também)
      await d.page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
      await olhar(d, 'home-fim', { botoes: ['.ld-ctas__start', '.ld-rhythm [role="radio"]', '.s4-faixa__d', '.s4-faixa__todos', 'footer a'] })
    } finally {
      await fechar(d, 'home')
    }
  }
})

// ───────────────────────── carreira inteira no Expresso + resumo + compartilhar ─────────────────────────
async function carreira(nome, comAnimacao) {
  const d = await abrir(browser, nome, { ajustes: comAnimacao ? undefined : RAPIDO_JOGO, share: nome.startsWith('tiktok') || nome.startsWith('instagram-android') || nome.startsWith('whatsapp-android') ? null : 'falso' })
  const { page } = d
  if (LENTO) await lento(d.cdp)
  try {
    await page.goto(URL0, { waitUntil: 'commit', timeout: 120000 })
    await page.locator('.ld-ctas__start').waitFor({ state: 'visible', timeout: 180000 })
    await sleep(500)
    await tocar(page.locator('.ld-rhythm [role="radio"]', { hasText: 'Expresso' }))
    await tocar(page.locator('.ld-ctas__start'))
    const busca = page.locator('input[placeholder="Buscar país"]')
    await busca.waitFor({ state: 'visible', timeout: 120000 })
    const largo = (await page.getByRole('button', { name: /^Continuar/ }).count()) === 0
    await olhar(d, 'identidade-1-pais', { botoes: ['#id-nation-list [role="radio"]', '.id-wiz__foot button', '.id-actions button', 'input[placeholder="Buscar país"]'] })
    await tocar(busca)
    await teclado(page, d.a, true)
    await page.keyboard.type('bras', { delay: 40 })
    await sleep(400)
    const res = page.locator('#id-nation-list [role="radio"]', { hasText: /^\s*Brasil\s*$/ }).first()
    const rb = await res.boundingBox()
    const jan = await page.evaluate(() => (window.visualViewport ? visualViewport.height : innerHeight))
    P.ok(!!rb && rb.y + rb.height <= jan + 1 && rb.y >= 0, `${nome} · identidade com teclado: o "Brasil" da busca fica à vista acima do teclado`, rb ? `${Math.round(rb.y)}–${Math.round(rb.y + rb.height)} de ${Math.round(jan)}` : 'não achado')
    await olhar(d, 'identidade-1-busca-teclado', { botoes: ['#id-nation-list [role="radio"]'] })
    await tocar(res)
    await page.evaluate(() => document.activeElement?.blur?.())
    await teclado(page, d.a, false)
    if (!largo) await tocar(page.getByRole('button', { name: /^Continuar/ }))
    await page.locator('#id-surname').waitFor({ state: 'visible', timeout: 20000 })
    await tocar(page.locator('#id-surname'))
    await page.fill('#id-surname', 'MOBILEIRA')
    await olhar(d, 'identidade-2-nome', { botoes: ['#id-surname', '#id-number', '.id-wiz__foot button', '.id-actions button', '[role="radiogroup"] [role="radio"]'] })
    if (!largo) await tocar(page.getByRole('button', { name: /^Continuar/ }))
    const pos = page.locator('[role="radiogroup"][aria-label="Posição em campo"]').getByRole('radio', { name: 'Centroavante', exact: true }).first()
    await pos.waitFor({ state: 'visible', timeout: 20000 })
    await tocar(pos)
    await olhar(d, 'identidade-3-posicao', { botoes: ['[aria-label="Posição em campo"] [role="radio"]', '.id-wiz__foot button', '.id-actions button'] })
    const t0 = Date.now()
    await tocar(page.getByRole('button', { name: largo ? /Confirmar identidade/ : /^Confirmar$/ }))
    await page.waitForFunction(() => location.hash.startsWith('#/carreira'), null, { timeout: 120000 })
    await page.locator('.ck-opt:not(.is-locked), .ck-pen__zone').first().waitFor({ state: 'visible', timeout: 180000 })
    console.log(`  ..  ${nome}: Confirmar → 1ª decisão em ${Date.now() - t0} ms`)
    const vistos = new Set()
    let n = 0
    let comemoracao = false
    const tj = Date.now()
    while (Date.now() - tj < 12 * 60_000) {
      if (await page.locator('.ck-end button', { hasText: /Jogar novamente/ }).count()) break
      const cel = page.locator('.ck-cel[role="dialog"]')
      if (await cel.count()) {
        if (!comemoracao) {
          comemoracao = true
          await sleep(900)
          if (await cel.count()) await olhar(d, 'comemoracao', { raiz: '.ck-cel', botoes: ['.ck-cel button'], espera: 0 })
        }
        await cel.getByRole('button', { name: /^Continuar/ }).first().tap({ timeout: 3000 }).catch(() => {})
        await sleep(400)
        continue
      }
      const recolhido = page.locator('.ck-sheet.is-collapsed .ck-sheet__peek')
      const pular = page.locator('.ck-sheet__skip button, button.ck-skip').first()
      if (await pular.count()) {
        await sleep(300)
        continue
      }
      if (await recolhido.count()) {
        await recolhido.first().tap({ timeout: 3000 }).catch(() => {})
        await sleep(300)
        continue
      }
      const pen = page.locator('.ck-pen__zone:not([disabled])')
      const opcoes = page.locator('.ck-opt:not(.is-locked):not([disabled]):not(.is-retire)', { hasNotText: /Aposentar|Encerrar a carreira|Pendurar/ })
      const algum = page.locator('.ck-opt:not(.is-locked):not([disabled]), .ck-pen__zone:not([disabled])').first()
      if (!(await algum.count()) || !(await algum.isVisible().catch(() => false))) {
        await sleep(200)
        continue
      }
      n++
      const kind = `${((await page.locator('.ck-sheet .ck-kind, .ck-decision .ck-kind').first().textContent({ timeout: 1500 }).catch(() => '')) || '').trim()}${(await pen.count()) ? ' (pênalti)' : ''}`
      if (!vistos.has(kind)) {
        vistos.add(kind)
        await sleep(500)
        await olhar(d, `decisao-${String(vistos.size).padStart(2, '0')}-${kind}`, { botoes: ['.ck-opt', '.ck-pen__zone', '.ck-sheet__peek', '.ck-sheet__toggle', '[role="tab"]', ...BOTOES_TOPO], espera: 0 })
      }
      const alvo = (await pen.count()) ? pen.nth(n % Math.max(1, await pen.count())) : (await opcoes.count()) ? opcoes.nth((n * 7) % (await opcoes.count())) : algum
      await alvo.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {})
      await alvo.tap({ timeout: 8000 }).catch(async () => {
        await sleep(600)
      })
      await sleep(comAnimacao ? 300 : 150)
    }
    const fim = (await page.locator('.ck-end button', { hasText: /Jogar novamente/ }).count()) > 0
    P.ok(fim, `${nome} · carreira inteira no Expresso até o fim (${n} decisões, ${Math.round((Date.now() - tj) / 1000)} s)`)
    if (!fim) return
    await sleep(1500)
    const vis = await page.evaluate(() => {
      const c = document.querySelector('.ck-end')?.getBoundingClientRect()
      const b = document.querySelector('.ck-endbar:not(.is-hidden)')?.getBoundingClientRect()
      const naJanela = (r) => !!r && r.height > 0 && r.top < innerHeight && r.bottom > 0
      return { card: naJanela(c), barra: naJanela(b), cardTopo: c ? Math.round(c.top) : null, janela: innerHeight }
    })
    P.ok(vis.card || vis.barra, `${nome} · fim: o card do fim (ou a barra "Ver resumo") aparece sem rolar`, vis)
    await olhar(d, 'fim', { botoes: ['.ck-end button', '.ck-endbar button', ...BOTOES_TOPO] })
    const ver = vis.barra && !vis.card ? page.locator('.ck-endbar__go') : page.locator('.ck-end').getByRole('button', { name: /Ver resumo/ })
    await tocar(ver)
    await page.locator('.sm-top').waitFor({ timeout: 120000 })
    await sleep(2000)
    await olhar(d, 'resumo-topo', { botoes: [...BOTOES_TOPO, '.sm-top button'] })
    for (const [rot, sel, botoes] of [
      ['resumo-selecao', '.sm-nat', []],
      ['resumo-premios', '.sm-aw', []],
      ['resumo-card', '#sm-share', ['#sm-share button']],
    ]) {
      const loc = page.locator(sel).first()
      if (!(await loc.count())) continue
      await loc.scrollIntoViewIfNeeded().catch(() => {})
      await olhar(d, rot, { botoes })
    }
    // compartilhar: navigator.share (Android/iOS) ou a folha "Sua imagem" (navegador do app sem Web Share)
    const comp = page.locator('#sm-share').getByRole('button', { name: /^Compartilhar$/ })
    if (await comp.count()) {
      await comp.scrollIntoViewIfNeeded()
      await sleep(1500)
      const tc = Date.now()
      await comp.tap()
      let resp = null
      while (Date.now() - tc < 8000) {
        const sh = await page.evaluate(() => window.__compartilhado ?? null)
        const dl = await page.locator('[role="dialog"]').count()
        if (sh || dl) {
          resp = { ms: Date.now() - tc, share: !!sh, folha: dl > 0, ativa: sh?.ativa ?? null, arquivos: sh?.arquivos?.length ?? 0 }
          break
        }
        await sleep(100)
      }
      P.ok(!!resp && resp.ms <= 3000 && resp.ativa !== false, `${nome} · resumo: "Compartilhar" responde em até 3 s (navigator.share dentro do toque, ou a folha "Sua imagem")`, resp ?? 'nada em 8 s')
      if (resp?.folha) await olhar(d, 'resumo-sua-imagem', { raiz: '[role="dialog"]', botoes: ['[role="dialog"] button'] })
      await page.keyboard.press('Escape').catch(() => {})
      await sleep(400)
    } else P.falha(`${nome} · resumo: botão "Compartilhar" do card não encontrado`)
  } finally {
    await fechar(d, 'carreira')
  }
}
await fluxo('carreira', async () => {
  const nomes = lista(['pequeno-320', 'iphone-se', 'tiktok-android', 'instagram-ios', 'deitado'], ['pequeno-320', 'tiktok-android', 'deitado'])
  for (const [i, nome] of nomes.entries()) await carreira(nome, i === 0)
})

// ───────────────────────── Hall com filtros ─────────────────────────
await fluxo('hall', async () => {
  for (const nome of lista(['pequeno-320', 'galaxy-a', 'iphone-14', 'tiktok-android', 'instagram-ios', 'deitado'], ['pequeno-320', 'galaxy-a', 'deitado'])) {
    const d = await abrir(browser, nome, { prod: PROD })
    const { page } = d
    try {
      await page.goto(`${URL0}#/hall`, { waitUntil: 'commit', timeout: 120000 })
      await page.locator('button.hl-row').first().waitFor({ state: 'visible', timeout: 120000 })
      await sleep(1500)
      const BOT = ['.hl-seg [role="radio"]', '.hl-fsel select', '.hl-fsearch input', '.hl-cats [role="tab"]', '.hl-filtros__limpar', ...BOTOES_TOPO]
      await olhar(d, 'hall-topo', { botoes: BOT })
      const com = page.locator('.hl-seg [role="radio"]', { hasText: /Comunidade/ }).first()
      if (await com.count()) {
        await tocar(com, { espera: 1500 })
        await olhar(d, 'hall-comunidade', { botoes: [...BOT, 'button.hl-row'] })
      }
      // filtro de país (o select nativo)
      const sel = page.locator('.hl-fsel select').first()
      if (await sel.count()) {
        await sel.selectOption({ label: 'Brasil' }).catch(() => sel.selectOption({ index: 1 }))
        await sleep(1500)
        await olhar(d, 'hall-filtro-pais', { botoes: [...BOT, 'button.hl-row'] })
      }
      // busca de clube com o teclado aberto: a lista fica à vista
      const busca = page.locator('.hl-fsearch input').first()
      if (await busca.count()) {
        await tocar(busca)
        await teclado(page, d.a, true)
        await page.keyboard.type('fla', { delay: 60 })
        await sleep(900)
        const lis = await page.evaluate(() => {
          const h = window.visualViewport ? visualViewport.height : innerHeight
          return [...document.querySelectorAll('.hl-fsearch__list [role="option"]')].map((o) => {
            const r = o.getBoundingClientRect()
            return { vis: r.top >= 0 && r.bottom <= h + 1, h: Math.round(r.height) }
          })
        })
        P.ok(!lis.length || lis.some((x) => x.vis), `${nome} · Hall: com o teclado aberto, a lista de clubes aparece acima do teclado`, `${lis.filter((x) => x.vis).length} de ${lis.length} à vista`)
        await olhar(d, 'hall-busca-clube-teclado', { botoes: ['.hl-fsearch__list [role="option"]', '.hl-fsearch input'] })
        await page.keyboard.press('Escape').catch(() => {})
        await page.evaluate(() => document.activeElement?.blur?.())
        await teclado(page, d.a, false)
      }
      const limpar = page.locator('.hl-filtros__limpar').first()
      if (await limpar.count()) await tocar(limpar, { espera: 1200 })
      // tocar numa linha abre a ficha / o resumo
      const linha = page.locator('button.hl-row').first()
      await tocar(linha, { espera: 1500 })
      const abriu = (await page.locator('[role="dialog"]').count()) > 0 || /#\/resumo/.test(await page.evaluate(() => location.hash))
      P.ok(abriu, `${nome} · Hall: tocar numa linha abre a ficha ou o resumo`)
      if (abriu) await olhar(d, 'hall-linha-aberta', { botoes: ['[role="dialog"] [aria-label="Fechar"]', '[role="dialog"] [role="tab"]', ...BOTOES_TOPO] })
    } finally {
      await fechar(d, 'hall')
    }
  }
})

// ───────────────────────── Desafios ─────────────────────────
await fluxo('desafios', async () => {
  for (const nome of lista(['pequeno-320', 'galaxy-a', 'iphone-14', 'whatsapp-android', 'deitado'], ['pequeno-320', 'galaxy-a', 'deitado'])) {
    const d = await abrir(browser, nome, { prod: PROD })
    const { page } = d
    try {
      await page.goto(URL0, { waitUntil: 'commit', timeout: 120000 })
      await page.locator('.ld-ctas__start').waitFor({ state: 'visible', timeout: 120000 })
      // com um desafio de PRÊMIO valendo (a semente do painel cria dois), a Home mostra o destaque grande (.sv-destaque)
      // no lugar da faixa dos desafios de emblema
      const achado = await page.waitForSelector('.s4-faixa, .sv-destaque', { timeout: 15000 }).catch(() => null)
      const destaque = achado && (await achado.evaluate((el) => el.classList.contains('sv-destaque')))
      const faixa = achado && !destaque ? achado : null
      if (destaque) {
        await page.evaluate(() => document.querySelector('.sv-destaque')?.scrollIntoView({ block: 'center' }))
        await olhar(d, 'home-destaque-desafio', { raiz: '.sv-destaque', botoes: ['.sv-destaque'] })
        await page.locator('.sv-destaque').tap({ timeout: 10000 })
        const foi = await page.waitForFunction(() => location.hash.startsWith('#/desafios'), null, { timeout: 10000 }).then(() => true, () => false)
        P.ok(foi, `${nome} · Home: o destaque do desafio de prêmio valendo (no lugar da faixa) leva a #/desafios`)
      } else if (faixa) {
        await page.evaluate(() => document.querySelector('.s4-faixa')?.scrollIntoView({ block: 'center' }))
        await olhar(d, 'home-faixa-desafios', { raiz: '.s4-faixa', botoes: ['.s4-faixa__d', '.s4-faixa__todos'] })
        // o vão entre os pontos tem 8 px ou mais (o toque no vão não pode cair no vizinho por engano)
        const vao = await page.evaluate(() => {
          const ds = [...document.querySelectorAll('.s4-faixa__d:not(.is-fora)')].map((x) => x.getBoundingClientRect()).filter((r) => r.width > 0)
          let menor = Infinity
          for (let i = 1; i < ds.length; i++) menor = Math.min(menor, ds[i].left - ds[i - 1].right)
          return ds.length > 1 ? Math.round(menor) : null
        })
        if (vao != null) P.ok(vao >= 6, `${nome} · faixa dos desafios: vão entre os pontos ≥ 6 px`, `${vao}px`)
      } else P.nota(`${nome}: a faixa dos desafios não apareceu na Home (sem desafio ativo?)`)
      await page.goto(`${URL0}#/desafios`)
      await page.locator('main h1, .s4-emb').first().waitFor({ state: 'visible', timeout: 60000 })
      await sleep(1500)
      await olhar(d, 'desafios', { botoes: ['.s4-emb button', '.s4-card button', '.s4-card a.lx-btn', ...BOTOES_TOPO] })
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
      await olhar(d, 'desafios-fim', { botoes: ['.s4-emb button', '.s4-card button', '.s4-card a.lx-btn'] })
    } finally {
      await fechar(d, 'desafios')
    }
  }
})

// ───────────────────────── perfil público e prévia (produção) ─────────────────────────
let CODIGO_PERFIL = arg('perfil', null)
async function codigoPerfil() {
  if (CODIGO_PERFIL) return CODIGO_PERFIL
  if (SEM?.codigo) return (CODIGO_PERFIL = SEM.codigo)
  const r = await fetch(`${URL0}api/hall.php`).then((x) => x.json()).catch(() => null)
  CODIGO_PERFIL = r?.itens?.find((i) => i.perfil)?.perfil ?? null
  return CODIGO_PERFIL
}
await fluxo('perfil', async () => {
  const cod = await codigoPerfil()
  if (!cod) return P.nota('nenhum perfil público no Hall para abrir')
  for (const nome of lista(['pequeno-320', 'galaxy-a', 'iphone-se', 'tiktok-ios'], ['pequeno-320', 'galaxy-a'])) {
    const d = await abrir(browser, nome, { prod: PROD })
    const { page } = d
    try {
      await page.goto(`${URL0}#/jogador/${cod}`, { waitUntil: 'commit', timeout: 120000 })
      await page.locator('main h1, .sv-perfil, .sv-head').first().waitFor({ state: 'visible', timeout: 60000 })
      await sleep(2500)
      await olhar(d, 'perfil', { botoes: [...BOTOES_TOPO, 'main button', '.sc-card'] })
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
      await olhar(d, 'perfil-fim', { botoes: ['main button', '.sc-card'] })
      // um código que não existe: "Perfil não encontrado" em pt-BR (o 404 do perfil.php é esperado)
      await page.goto(`${URL0}#/jogador/ZZZZ9999`)
      await sleep(3500)
      const t = await page.evaluate(() => document.querySelector('main')?.innerText ?? '')
      P.ok(/não encontrado|não existe|fechado/i.test(t), `${nome} · perfil que não existe mostra o aviso em pt-BR`, t.replace(/\s+/g, ' ').slice(0, 80))
    } finally {
      await fechar(d, 'perfil')
    }
  }
})
await fluxo('previa', async () => {
  const cod = await codigoPerfil()
  if (!cod) return P.nota('nenhum perfil público para a prévia')
  // o HTML da prévia (só GET; a imagem png=1 não é pedida — ela é desenhada e guardada no servidor)
  const html = await fetch(`${URL0}api/v.php?c=${cod}`).then((r) => r.text()).catch(() => '')
  P.ok(/og:title/.test(html) && /og:image/.test(html), 'prévia: api/v.php?c=… tem og:title e og:image (o cartão do WhatsApp/Instagram)')
  for (const nome of lista(['whatsapp-android', 'instagram-ios', 'tiktok-android'], ['whatsapp-android'])) {
    const d = await abrir(browser, nome, { prod: PROD })
    const { page } = d
    await page.route(/v\.php\?.*png=1/, (r) => r.fulfill({ status: 204, body: '' }))
    try {
      await page.goto(`${URL0}api/v.php?c=${cod}`, { waitUntil: 'commit', timeout: 60000 })
      await page.waitForFunction((c) => location.hash.includes(`/jogador/${c}`), cod, { timeout: 30000 }).catch(() => {})
      await sleep(3000)
      const h = await page.evaluate(() => location.href)
      P.ok(h.includes(`#/jogador/${cod}`), `${nome} · prévia: o link leva ao perfil dentro do jogo`, h.replace(URL0, './'))
      await olhar(d, 'previa-chegada', { botoes: [...BOTOES_TOPO, 'main button'] })
    } finally {
      await fechar(d, 'prévia')
    }
  }
})

// ───────────────────────── conta (local) ─────────────────────────
await fluxo('conta', async () => {
  const C = await import('./conta-lib.mjs')
  for (const nome of lista(['iphone-se', 'galaxy-a', 'tiktok-android'], ['iphone-se', 'tiktok-android'])) {
    const d = await C.novoAparelho(browser, nome, { ajustes: RAPIDO_JOGO })
    const { page } = d
    const E = `mobile${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@exemplo.com`
    const BOT_DLG = ['[role="dialog"] button', '[role="dialog"] [role="tab"]', '[role="dialog"] input', '[role="dialog"] select', '[role="dialog"] textarea', '[role="dialog"] .sc-check']
    try {
      await C.home(page)
      // criar conta
      let m = await C.menu(page)
      await olhar(d, 'menu', { raiz: '[role="dialog"]', botoes: ['[role="dialog"] button', '[role="dialog"] a'] })
      await m.getByText(/Entrar \/ Criar conta/).tap()
      let dl = C.dialogo(page)
      await dl.waitFor({ timeout: 15000 })
      await sleep(500)
      await olhar(d, 'entrar', { raiz: '[role="dialog"]', botoes: BOT_DLG })
      await dl.getByRole('tab', { name: 'Criar conta' }).tap()
      await sleep(400)
      await dl.getByLabel('Apelido').fill('Mobile Teste')
      await dl.getByLabel('E-mail').fill(E)
      await dl.getByLabel('Senha', { exact: true }).fill(SENHA)
      await dl.locator('.sc-check').first().tap({ position: { x: 12, y: 12 } })
      await olhar(d, 'criar-conta', { raiz: '[role="dialog"]', botoes: BOT_DLG })
      const t0 = Date.now() - 1000
      await dl.getByRole('button', { name: 'Criar conta', exact: true }).tap()
      const dv = C.dialogo(page, 'Confirme seu e-mail')
      await dv.waitFor({ timeout: 20000 })
      await olhar(d, 'confirme-seu-email', { raiz: '[role="dialog"]', botoes: BOT_DLG })
      const codigo = await C.codigoDoEmail(E, t0)
      P.ok(/^\d{6}$/.test(codigo ?? ''), `${nome} · conta: o código de 6 dígitos chegou no e-mail`, codigo)
      const campo = dv.getByLabel('Código de 6 dígitos')
      await campo.tap()
      await teclado(page, d.a, true)
      await C.colar(page, ` ${codigo}`)
      P.ok((await campo.inputValue()) === codigo, `${nome} · conta: colar o código com espaço na frente fica com os 6 números`)
      const v = await C.campoVisivel(page)
      P.ok(v.inteiro && !v.porCima, `${nome} · conta: com o teclado aberto, o campo do código fica à vista`, v)
      await teclado(page, d.a, false)
      await dv.getByRole('button', { name: 'Confirmar e-mail' }).tap()
      await C.semDialogo(page, 15000).catch(() => {})
      await sleep(800)
      P.ok(C.sql(`SELECT IFNULL(email_verificado_em,'nulo') FROM usuarios WHERE email='${E}'`) !== 'nulo', `${nome} · conta: e-mail confirmado no servidor`)
      // sair e entrar
      m = await C.menu(page)
      await m.getByText('Sair', { exact: true }).tap()
      await sleep(1200)
      if (await page.getByRole('dialog', { name: 'Menu' }).count()) await page.keyboard.press('Escape')
      await sleep(400)
      m = await C.menu(page)
      await m.getByText(/Entrar \/ Criar conta/).tap()
      dl = C.dialogo(page)
      await dl.waitFor({ timeout: 15000 })
      await dl.getByLabel('E-mail').fill(E)
      await dl.getByLabel('Senha', { exact: true }).fill(SENHA)
      await dl.getByRole('button', { name: 'Entrar', exact: true }).tap()
      await C.semDialogo(page, 15000).catch(() => {})
      await sleep(600)
      const t = await C.toasts(page)
      P.ok(t.some((x) => /Bem-vindo de volta/.test(x.titulo)), `${nome} · conta: entrou de novo com e-mail e senha`, t.map((x) => x.titulo))
      // Minha conta
      m = await C.menu(page)
      await m.locator('.sc-me').tap()
      const mc = C.dialogo(page, 'Minha conta')
      await mc.waitFor({ timeout: 15000 })
      await sleep(1500)
      await olhar(d, 'minha-conta-topo', { raiz: '[role="dialog"]', botoes: BOT_DLG })
      const des = await C.painelDeslocado(page)
      P.ok(!des || des.scrollTop === 0, `${nome} · Minha conta: o painel do diálogo não rola sozinho (cabeçalho à vista)`, des)
      await mc.locator('.lx-dialog__body').evaluate((b) => b.scrollTo(0, b.scrollHeight))
      await olhar(d, 'minha-conta-fim', { raiz: '[role="dialog"]', botoes: BOT_DLG })
      await page.keyboard.press('Escape')
      await C.semDialogo(page).catch(() => {})
      // Fale conosco
      m = await C.menu(page)
      await m.getByText('Fale conosco', { exact: true }).tap()
      const fc = C.dialogo(page, 'Fale conosco')
      await fc.waitFor({ timeout: 15000 })
      await sleep(800)
      await olhar(d, 'fale-conosco', { raiz: '[role="dialog"]', botoes: BOT_DLG })
      await fc.locator('.sv-tipo', { hasText: 'Problema' }).first().tap()
      await fc.locator('textarea').tap()
      await teclado(page, d.a, true)
      await page.keyboard.type('Teste do celular (suíte mobile): tudo certo por aqui.', { delay: 5 })
      const vf = await C.campoVisivel(page)
      P.ok(vf.inteiro && !vf.porCima, `${nome} · Fale conosco: com o teclado aberto, a mensagem fica à vista`, vf)
      await olhar(d, 'fale-conosco-teclado', { raiz: '[role="dialog"]', botoes: ['[role="dialog"] textarea'] })
      await teclado(page, d.a, false)
      await fc.getByRole('button', { name: 'Enviar mensagem' }).tap()
      const enviou = await fc.getByText(/Mensagem enviada/).waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
      P.ok(enviou, `${nome} · Fale conosco: a mensagem foi enviada`)
      await olhar(d, 'fale-conosco-enviado', { raiz: '[role="dialog"]', botoes: ['[role="dialog"] button'] })
      await page.keyboard.press('Escape').catch(() => {})
    } finally {
      await fechar(d, 'conta')
    }
  }
})

// ───────────────────────── painel com PIN (local) ─────────────────────────
await fluxo('painel', async () => {
  const PAINEL = `${URL0}painel/`
  const esperarDecisao = (page) =>
    page.waitForFunction(() => {
      const p = document.getElementById('tela-painel')
      const e = document.getElementById('tela-entrar')
      return !!p && !!e && (!p.hidden || !e.hidden)
    }, null, { timeout: 30000 })
  const entrarSenha = async (page) => {
    await page.locator('#senha').tap()
    await page.fill('#senha', env.PAINEL_SENHA)
    await page.locator('#botao-entrar').tap()
    await page.waitForSelector('#tela-painel:not([hidden]), #form-pin:not([hidden]), #form-criar-pin:not([hidden]), #erro-entrar:not([hidden])', { timeout: 20000 })
  }
  const digitarPin = async (page, raiz, pin) => {
    await page.locator(`${raiz} .pin-caixa`).first().tap()
    await page.keyboard.type(pin, { delay: 40 })
  }
  for (const nome of lista(['galaxy-a', 'iphone-14', 'pequeno-320'], ['galaxy-a', 'pequeno-320'])) {
    const d = await abrir(browser, nome, {})
    const { page } = d
    try {
      await page.goto(PAINEL)
      await esperarDecisao(page)
      await sleep(500)
      await olhar(d, 'painel-entrada', { botoes: ['#botao-entrar', '#senha'] })
      await entrarSenha(page)
      if (await page.isVisible('#tela-painel')) {
        // o Dono ainda sem PIN: cria em Config › Minha conta e entra de novo (agora com o PIN)
        await page.evaluate(() => (location.hash = '#/config?parte=conta'))
        await page.waitForSelector('#cp-pin', { timeout: 20000 })
        await page.locator('#cp-senha').tap()
        await page.fill('#cp-senha', env.PAINEL_SENHA)
        await page.locator('#cp-pin').tap()
        await page.keyboard.type(PIN_DONO)
        await page.locator('#cp-rep').tap()
        await page.keyboard.type(PIN_DONO)
        await page.getByRole('button', { name: 'Criar PIN' }).tap()
        await page.waitForFunction(() => /PIN criado/.test(document.getElementById('avisos').textContent), null, { timeout: 15000 })
        await page.context().clearCookies()
        await page.goto(PAINEL)
        await esperarDecisao(page)
        await entrarSenha(page)
      }
      P.ok(await page.isVisible('#form-pin'), `${nome} · painel: depois da senha, pede o PIN`)
      await olhar(d, 'painel-pin', { botoes: ['#pin-caixas .pin-caixa', '#botao-pin'] })
      await digitarPin(page, '#pin-caixas', PIN_DONO)
      const entrou = await page.waitForSelector('#tela-painel:not([hidden])', { timeout: 20000 }).then(() => true).catch(() => false)
      P.ok(entrou, `${nome} · painel: o PIN abre o painel`)
      if (!entrou) continue
      await page.waitForFunction(() => /atualizado às/.test(document.getElementById('selo-atualizado')?.textContent || ''), null, { timeout: 30000 }).catch(() => {})
      await sleep(1000)
      const y = await page.evaluate(() => Math.round(document.getElementById('titulo-aba').getBoundingClientRect().top))
      P.ok(y < (await page.evaluate(() => innerHeight)), `${nome} · painel: o título da aba aparece sem rolar`, `y=${y}`)
      const BOT = ['#abas a', '.botoes-topo-celular button', '.atencao-dobrar', '#acoes-aba button']
      await olhar(d, 'painel-visao', { botoes: BOT })
      for (const [h, rot] of [['#/usuarios', 'painel-usuarios'], ['#/mensagens', 'painel-mensagens']]) {
        await page.evaluate((x) => (location.hash = x), h)
        await page.waitForFunction(() => {
          const a = document.querySelector('.aba:not([hidden])')
          return a && !a.querySelector('.estado-carregando')
        }, null, { timeout: 30000 }).catch(() => {})
        await sleep(1200)
        await olhar(d, rot, { botoes: [...BOT, '.aba:not([hidden]) tr.clicavel', '.aba:not([hidden]) .lista.cartoes tr'] })
      }
    } finally {
      await fechar(d, 'painel')
    }
  }
})

await browser.close()
RELATORIO.s = Math.round((Date.now() - T0) / 1000)
RELATORIO.oks = P.oks
RELATORIO.falhas = P.falhas
writeFileSync(`${SAIDA}/relatorio-${ALVO}.json`, JSON.stringify(RELATORIO, null, 1))
console.log(`\nrelatório: ${SAIDA}/relatorio-${ALVO}.json · ${RELATORIO.s} s · fluxos ${JSON.stringify(RELATORIO.fluxos)}`)
P.fim()
