#!/usr/bin/env node
// LENDA v3.5 · conferência das correções da revisão mobile da carreira (grupo "carreira"), num celular emulado.
//
//   LENDA_URL=http://127.0.0.1:9160/lenda/ node src/ui/classic/e2e/carreira-mobile.mjs [--aparelho galaxy-a] [--so abas,resumo,…]
//
// Usa as utilidades da suíte mobile (servidor/teste/mobile/carreira-lib.mjs). Cada cenário diz OK/FALHOU e tira print
// em $LENDA_PRINTS (aparelho_cenario.png). Nada de conta: só o que o jogo grava no aparelho.
//   abas       uma aba da carreira (Temporada) que não chegou: o aviso fica só nela, a carreira continua; com a rede de
//              volta, "Tentar de novo" abre a aba sem recarregar a página
//   prefetch   sem rede depois que a carreira abriu: as 3 abas e o resumo abrem (foram baixados num momento ocioso)
//   resumo     "Ver resumo" sem o código do resumo: aviso "Sem conexão" em pt-BR e a pessoa fica na carreira
//   fim        o cartão do fim de carreira aparece na tela sozinho (celular), com a barra "Ver resumo" se a pessoa rolar
//   teclado    identidade com o teclado aberto (janela encolhida): nada fixo por cima do campo, "Brasil" à vista
//   fonte      campos com letra ≥ 16 px (zoom do iPhone), também o sobrenome longo e o "Outra liga"
//   voltar     voltar do Android: passo 3 → passo 2 → passo 1 do assistente; "Jogar novamente" → voltar não cai em "Nenhuma carreira"
//   foco       Tab com o sheet aberto: o foco que vai para trás dele recolhe o sheet
//   deitado    celular deitado: a decisão num painel ao lado da tabela; a barra do topo sem texto por baixo dos botões
//   ocupado    o toque numa opção mostra "Simulando…" e a faixa animada antes de a simulação ocupar a tela
//   desktop    1366×900: decisão, abas e fim como antes (sem rolagem lateral)
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const LIB = fileURLToPath(new URL('../../../../servidor/teste/mobile/carreira-lib.mjs', import.meta.url))
const { abrir, lancar, medir, teclado, girar, print, sleep, offline, URL0, PRINTS, lento } = await import(LIB)

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  if (i < 0) return d
  const v = process.argv[i + 1]
  return !v || v.startsWith('--') ? true : v
}
const NOME = arg('aparelho', 'galaxy-a')
const SO = arg('so', null)
const quer = (k) => !SO || String(SO).split(',').includes(k)
const RAPIDO = JSON.stringify({ state: { settings: { sound: false, volume: 0, skipAnimations: true, reducedMotion: true, lowFx: false, engine: 'auto' } }, version: 1 })
const R = { aparelho: NOME, url: URL0, cenarios: {} }
let falhas = 0
const ok = (cen, cond, msg, extra) => {
  const linha = `${cond ? 'ok' : 'FALHOU'}  [${cen}] ${msg}${extra !== undefined ? ` · ${JSON.stringify(extra)}` : ''}`
  console.log(`  ${linha}`)
  ;(R.cenarios[cen] = R.cenarios[cen] ?? []).push({ ok: !!cond, msg, extra })
  if (!cond) falhas++
}
mkdirSync(PRINTS, { recursive: true })
const browser = await lancar()

/** Identidade rápida (assistente do celular ou colunas) e primeira decisão. */
async function comecar(page, { ritmo = 'expressa', nome = 'TESTE' } = {}) {
  await page.goto(`${URL0}#/identidade?ritmo=${ritmo}`)
  const busca = page.locator('input[placeholder="Buscar país"]')
  await busca.waitFor({ timeout: 120000 })
  await busca.fill('Brasil')
  await busca.press('Enter')
  const assistente = await page.locator('.id-wiz').count()
  if (assistente) await page.getByRole('button', { name: /^Continuar/ }).tap()
  await page.locator('#id-surname').fill(nome)
  if (assistente) await page.getByRole('button', { name: /^Continuar/ }).tap()
  await page.locator('[role="radiogroup"][aria-label="Posição em campo"]').getByRole('radio', { name: 'Centroavante', exact: true }).click()
  await page.getByRole('button', { name: assistente ? /^Confirmar$/ : /Confirmar identidade/ }).click()
  await page.locator('.ck-opt:not(.is-locked), .ck-pen__zone').first().waitFor({ timeout: 120000 })
}
async function escolher(page) {
  const opt = page.locator('.ck-opt:not(.is-locked):not([disabled]), .ck-pen__zone:not([disabled])', { hasNotText: /Aposentar|Encerrar a carreira|Pendurar/ }).first()
  await opt.scrollIntoViewIfNeeded().catch(() => {})
  await opt.click({ timeout: 15000 })
  for (let i = 0; i < 80; i++) {
    await sleep(250)
    const c = page.locator('.ck-cel').getByRole('button', { name: /^Continuar/ })
    if (await c.count()) await c.click().catch(() => {})
    if ((await page.locator('.ck-end').count()) || ((await page.locator('.ck-opt:not(.is-locked), .ck-pen__zone:not([disabled])').count()) && !(await page.locator('.ck-sheet__skip, .ck-skip').count()))) return
  }
}
async function terminar(page) {
  for (let k = 0; k < 40 && !(await page.locator('.ck-end').count()); k++) await escolher(page)
}

// ───────────────────────── abas: a aba que não chegou ─────────────────────────
if (quer('abas')) {
  const ap = await abrir(browser, NOME, { ajustes: RAPIDO })
  const { page, ctx } = ap
  // o pedaço da aba Temporada não chega (nem a pré-carga): como um túnel logo depois de abrir a carreira
  let bloquear = true
  await ctx.route(/\/assets\/SeasonTab-[^/]+\.js/, (r) => (bloquear ? r.abort('internetdisconnected') : r.continue()))
  await comecar(page)
  await escolher(page)
  await page.getByRole('tab', { name: /^Temporada/ }).first().click()
  await page.locator('.ck-taberr').waitFor({ timeout: 20000 }).catch(() => {})
  const t = (await page.locator('.ck-taberr').textContent().catch(() => '')) || ''
  ok('abas', /Sem conexão: esta aba abre quando a internet voltar/.test(t), 'aba sem o código: aviso em pt-BR só nela', t.slice(0, 90))
  ok('abas', !(await page.getByText('Algo deu errado nesta tela').count()), 'a carreira não virou a tela de erro')
  await print(page, NOME, 'e2e-abas-1-sem-codigo')
  await page.getByRole('tab', { name: /^Carreira/ }).first().click()
  await sleep(400)
  const antes = await page.locator('.ck-row').count()
  await escolher(page)
  ok('abas', (await page.locator('.ck-row').count()) >= antes && (await page.locator('.ck-panel').count()) > 0, 'dá para continuar escolhendo com a aba quebrada')
  // a rede volta: "Tentar de novo" abre a aba (sem recarregar a página)
  bloquear = false
  await page.getByRole('tab', { name: /^Temporada/ }).first().click()
  await page.locator('.ck-taberr').waitFor({ timeout: 8000 }).catch(() => {})
  const marca = await page.evaluate(() => (window.__semRecarregar = Math.random()))
  if (await page.locator('.ck-taberr').count()) await page.locator('.ck-taberr').getByRole('button', { name: /Tentar de novo/ }).click()
  await page.locator('.tb').first().waitFor({ timeout: 20000 }).catch(() => {})
  ok('abas', (await page.locator('.tb').count()) > 0 && !(await page.locator('.ck-taberr').count()), 'com a rede de volta, a aba abre')
  ok('abas', (await page.evaluate(() => window.__semRecarregar)) === marca, 'sem recarregar a página')
  const estilo = await page.evaluate(() => {
    const el = document.querySelector('.tb')
    return el ? getComputedStyle(el).display : null
  })
  ok('abas', estilo === 'flex', 'o CSS da aba veio junto', estilo)
  await print(page, NOME, 'e2e-abas-2-de-volta')
  ok('abas', !ap.erros.some((e) => /pageerror/.test(e)), 'sem erro de página', ap.erros.filter((e) => /pageerror/.test(e)).slice(0, 2))
  await ctx.close()
}

// ───────────────────────── prefetch: sem rede depois da carreira aberta ─────────────────────────
if (quer('prefetch') || quer('resumo')) {
  const ap = await abrir(browser, NOME, { ajustes: RAPIDO })
  const { page, cdp, ctx } = ap
  await comecar(page)
  await escolher(page)
  await sleep(5500) // o ocioso (no máximo ~4,5 s) baixa as abas e o resumo
  await offline(cdp, true)
  if (quer('prefetch')) {
    for (const [rot, re] of [['Temporada', /^Temporada/], ['Prêmios', /^Prêmios/], ['Mundo', /^Mundo/]]) {
      await page.getByRole('tab', { name: re }).first().click()
      await page.locator('.tb, .ck-taberr').first().waitFor({ timeout: 15000 }).catch(() => {})
      ok('prefetch', (await page.locator('.tb').count()) > 0 && !(await page.locator('.ck-taberr').count()), `sem rede, a aba ${rot} abre (já baixada)`)
    }
    await print(page, NOME, 'e2e-prefetch-aba-mundo-sem-rede')
    await page.getByRole('tab', { name: /^Carreira/ }).first().click()
    await terminar(page)
    await page.locator('.ck-end').getByRole('button', { name: /Ver resumo/ }).click()
    await page.locator('.sm-top').waitFor({ timeout: 20000 }).catch(() => {})
    ok('prefetch', (await page.locator('.sm-top').count()) > 0, 'sem rede, "Ver resumo" abre o resumo (já baixado)')
    await print(page, NOME, 'e2e-prefetch-resumo-sem-rede')
  }
  await ctx.close()
}
if (quer('resumo')) {
  const ap = await abrir(browser, NOME, { ajustes: RAPIDO })
  const { page, ctx } = ap
  let bloquear = true
  await ctx.route(/\/assets\/SummaryScreen-[^/]+\.js/, (r) => (bloquear ? r.abort('internetdisconnected') : r.continue()))
  await comecar(page)
  await terminar(page)
  await page.locator('.ck-end').getByRole('button', { name: /Ver resumo/ }).click()
  await sleep(1500)
  const aviso = ((await page.locator('.ck-end__err').textContent().catch(() => '')) || '').trim()
  ok('resumo', /Sem conexão: o resumo abre quando a internet voltar/.test(aviso), '"Ver resumo" sem o código: aviso "Sem conexão" em pt-BR no cartão do fim', aviso.slice(0, 120))
  ok('resumo', (await page.evaluate(() => location.hash)).startsWith('#/carreira') && (await page.locator('.ck-end').count()) > 0, 'continua na carreira, com o cartão do fim')
  ok('resumo', !(await page.getByText('Algo deu errado nesta tela').count()), 'sem a tela de erro')
  await print(page, NOME, 'e2e-resumo-sem-codigo')
  bloquear = false
  await ctx.close()
}

// ───────────────────────── fim: o cartão aparece sozinho ─────────────────────────
if (quer('fim')) {
  const ap = await abrir(browser, NOME, { ajustes: RAPIDO })
  const { page, ctx } = ap
  await comecar(page)
  await terminar(page)
  await sleep(1500)
  const r = await page.evaluate(() => {
    const el = document.querySelector('.ck-end')
    const b = el?.getBoundingClientRect()
    const btn = [...document.querySelectorAll('.ck-end button')].find((x) => /Ver resumo/.test(x.textContent || ''))
    const rb = btn?.getBoundingClientRect()
    return { top: b && Math.round(b.top), bottom: b && Math.round(b.bottom), btnVisivel: !!rb && rb.top >= 0 && rb.bottom <= innerHeight, janela: innerHeight }
  })
  ok('fim', r.btnVisivel, 'o botão "Ver resumo" do cartão do fim está na tela sem rolar', r)
  await print(page, NOME, 'e2e-fim-cartao')
  // a pessoa rola até a tabela: a barra "Ver resumo" aparece embaixo
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await sleep(900)
  const barra = await page.evaluate(() => {
    const b = document.querySelector('.ck-endbar')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { visivel: !b.classList.contains('is-hidden') && r.bottom <= innerHeight + 1 && r.top < innerHeight, top: Math.round(r.top), janela: innerHeight }
  })
  ok('fim', barra?.visivel, 'rolando até a tabela, a barra fixa "Ver resumo" aparece', barra)
  await print(page, NOME, 'e2e-fim-barra')
  await page.locator('.ck-endbar').getByRole('button', { name: /Ver resumo/ }).click()
  await page.locator('.sm-top').waitFor({ timeout: 20000 }).catch(() => {})
  ok('fim', (await page.locator('.sm-top').count()) > 0, 'a barra leva ao resumo')
  await ctx.close()
}

// ───────────────────────── teclado e fonte (identidade) ─────────────────────────
if (quer('teclado') || quer('fonte')) {
  const ap = await abrir(browser, NOME, { ajustes: RAPIDO })
  const { page, a, ctx } = ap
  await page.goto(`${URL0}#/identidade?ritmo=normal`)
  const busca = page.locator('input[placeholder="Buscar país"]')
  await busca.waitFor({ timeout: 120000 })
  await busca.tap()
  await teclado(page, a, true)
  await page.keyboard.type('bra', { delay: 40 })
  await sleep(500)
  let m = await medir(page)
  const bra = await page.evaluate(() => {
    const el = [...document.querySelectorAll('#id-nation-list [role="radio"]')].find((x) => /^\s*Brasil\s*$/.test(x.textContent || ''))
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const topo = cy > 0 && cy < innerHeight ? document.elementFromPoint(cx, cy) : null
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), janela: innerHeight, porCima: topo && !el.contains(topo) ? topo.className : null }
  })
  if (quer('teclado')) {
    ok('teclado', !m.coberto?.fora && !m.coberto?.porCima, 'busca de país: o campo fica à vista e nada por cima', m.coberto)
    ok('teclado', bra && bra.bottom <= bra.janela && !bra.porCima, '"Brasil" à vista acima do teclado', bra)
  }
  await print(page, NOME, 'e2e-teclado-busca')
  await page.locator('#id-nation-list [role="radio"]', { hasText: /^\s*Brasil\s*$/ }).first().tap()
  await page.evaluate(() => document.activeElement?.blur?.())
  await teclado(page, a, false)
  const assistente = await page.locator('.id-wiz').count()
  if (assistente) await page.getByRole('button', { name: /^Continuar/ }).tap()
  for (const [rot, sel] of [['Sobrenome', '#id-surname'], ['Número', '#id-number']]) {
    await page.locator(sel).tap()
    await teclado(page, a, true)
    if (sel === '#id-surname') {
      await page.fill(sel, '')
      await page.keyboard.type('SCHWEINSTEIGER', { delay: 20 })
    }
    await sleep(400)
    m = await medir(page)
    if (quer('teclado')) ok('teclado', !m.coberto?.fora && !m.coberto?.porCima, `${rot} com o teclado aberto: à vista e nada por cima`, m.coberto)
    if (quer('fonte')) {
      const fs = await page.evaluate((s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize), sel)
      ok('fonte', fs >= 16, `${rot}: letra de ${fs}px (o iPhone dá zoom abaixo de 16)`)
    }
    await print(page, NOME, `e2e-teclado-${rot.toLowerCase()}`)
    await page.evaluate(() => document.activeElement?.blur?.())
    await teclado(page, a, false)
  }
  if (quer('fonte')) {
    const cabe = await page.evaluate(() => {
      const i = document.querySelector('#id-surname')
      return { sw: i.scrollWidth, cw: i.clientWidth }
    })
    ok('fonte', cabe.sw <= cabe.cw + 1, 'sobrenome de 14 letras cabe inteiro no campo', cabe)
  }
  // de volta ao começo: os campos todos
  m = await medir(page)
  if (quer('fonte')) ok('fonte', !m.fonteCampo.length, 'nenhum campo da identidade com letra < 16 px', m.fonteCampo)
  await ctx.close()
}

// ───────────────────────── voltar ─────────────────────────
if (quer('voltar')) {
  const ap = await abrir(browser, NOME, { ajustes: RAPIDO })
  const { page, ctx } = ap
  await page.goto(URL0)
  await page.locator('.ld-ctas__start').waitFor({ timeout: 120000 })
  await page.locator('.ld-ctas__start').tap()
  const busca = page.locator('input[placeholder="Buscar país"]')
  await busca.waitFor({ timeout: 60000 })
  if (await page.locator('.id-wiz').count()) {
    await busca.fill('Brasil')
    await busca.press('Enter')
    await page.getByRole('button', { name: /^Continuar/ }).tap()
    await page.locator('#id-surname').fill('VOLTAR')
    await page.getByRole('button', { name: /^Continuar/ }).tap()
    await sleep(500)
    const passo = async () => ((await page.locator('.id-wiz__head .lx-eyebrow').first().textContent().catch(() => '')) || '').trim()
    ok('voltar', /Passo 3 de 3/.test(await passo()), 'no passo 3', await passo())
    await page.goBack({ waitUntil: 'commit' }).catch(() => {})
    await sleep(800)
    ok('voltar', /#\/identidade/.test(await page.evaluate(() => location.hash)) && /Passo 2 de 3/.test(await passo()), 'voltar do passo 3 → passo 2', { hash: await page.evaluate(() => location.hash), passo: await passo() })
    ok('voltar', (await page.locator('#id-surname').inputValue().catch(() => '')) === 'VOLTAR', 'o nome continua preenchido')
    await page.goBack({ waitUntil: 'commit' }).catch(() => {})
    await sleep(800)
    ok('voltar', /Passo 1 de 3/.test(await passo()), 'voltar do passo 2 → passo 1', await passo())
    // "Voltar" do rodapé também anda pelo histórico (e o Continuar empilha de novo)
    await page.getByRole('button', { name: /^Continuar/ }).tap()
    await page.getByRole('button', { name: /^Continuar/ }).tap()
    await sleep(400)
    await page.getByRole('button', { name: /^Voltar$/ }).tap()
    await sleep(600)
    ok('voltar', /Passo 2 de 3/.test(await passo()), 'o "Voltar" do rodapé volta um passo', await passo())
    await page.getByRole('button', { name: /^Continuar/ }).tap()
    await sleep(400)
    await page.reload()
    await page.locator('.id-wiz').waitFor({ timeout: 60000 })
    await sleep(600)
    ok('voltar', /Passo 3 de 3/.test(await passo()), 'recarregar no passo 3 volta ao passo 3', await passo())
    await page.locator('[role="radiogroup"][aria-label="Posição em campo"]').getByRole('radio', { name: 'Centroavante', exact: true }).tap()
    await page.getByRole('button', { name: /^Confirmar$/ }).tap()
    await page.locator('.ck-opt:not(.is-locked)').first().waitFor({ timeout: 120000 })
    await escolher(page)
    // voltar no meio da carreira: a Home (com "Continuar carreira"), nunca o formulário
    await page.goBack({ waitUntil: 'commit' }).catch(() => {})
    await sleep(1200)
    const h = await page.evaluate(() => location.hash)
    ok('voltar', !/identidade/.test(h), 'voltar da carreira não reabre o assistente da identidade', h)
    await page.goForward({ waitUntil: 'commit' }).catch(() => {})
    await sleep(800)
    if (!/carreira/.test(await page.evaluate(() => location.hash))) {
      const cont = page.getByRole('button', { name: /Continuar carreira/ })
      if (await cont.count()) await cont.first().tap()
    }
    await page.locator('.ck-opt:not(.is-locked), .ck-end').first().waitFor({ timeout: 60000 }).catch(() => {})
  } else {
    await comecar(page)
  }
  await terminar(page)
  await page.locator('.ck-end').getByRole('button', { name: /Jogar novamente/ }).click()
  await page.waitForFunction(() => location.hash.startsWith('#/identidade'), null, { timeout: 20000 }).catch(() => {})
  await page.goBack({ waitUntil: 'commit' }).catch(() => {})
  await sleep(1200)
  const texto = ((await page.locator('main').first().textContent().catch(() => '')) || '').replace(/\s+/g, ' ')
  ok('voltar', !/Nenhuma carreira em andamento/.test(texto), '"Jogar novamente" → voltar não cai em "Nenhuma carreira em andamento"', { hash: await page.evaluate(() => location.hash), texto: texto.slice(0, 80) })
  await print(page, NOME, 'e2e-voltar-jogar-novamente')
  await ctx.close()
}

// ───────────────────────── foco: Tab com o sheet aberto ─────────────────────────
if (quer('foco')) {
  const ap = await abrir(browser, NOME, { ajustes: RAPIDO })
  const { page, ctx } = ap
  await comecar(page)
  if (await page.locator('.ck-sheet').count()) {
    // foco de teclado na aba "Prêmios" (atrás do sheet)
    await page.evaluate(() => document.querySelector('.ck-sheet__peek')?.focus())
    await page.keyboard.press('Shift+Tab')
    for (let i = 0; i < 40; i++) {
      const id = await page.evaluate(() => document.activeElement?.id || document.activeElement?.className || '')
      if (/ck-tab-/.test(id)) break
      await page.keyboard.press('Shift+Tab')
    }
    await sleep(500)
    const r = await page.evaluate(() => {
      const f = document.activeElement
      const s = document.querySelector('.ck-sheet')
      const rf = f.getBoundingClientRect()
      const rs = s.getBoundingClientRect()
      return { foco: f.id || f.className, recolhido: s.classList.contains('is-collapsed'), cobre: rf.bottom > rs.top && rf.top < rs.bottom }
    })
    ok('foco', r.recolhido && !r.cobre, 'Tab para o que está atrás do sheet: o sheet recolhe e o foco fica à vista', r)
    await print(page, NOME, 'e2e-foco-atras-do-sheet')
  } else ok('foco', true, 'sem sheet nesta tela (largo)')
  await ctx.close()
}

// ───────────────────────── deitado ─────────────────────────
if (quer('deitado')) {
  for (const [w, h] of [
    [844, 390],
    [667, 375],
    [640, 360],
  ]) {
    const ap = await abrir(browser, NOME, { ajustes: RAPIDO })
    const { page, ctx } = ap
    await comecar(page)
    await escolher(page)
    await page.setViewportSize({ width: w, height: h })
    await sleep(900)
    const m = await medir(page)
    const r = await page.evaluate(() => {
      const s = document.querySelector('.ck-sheet')
      const l = document.querySelector('.ck-layout')
      const rs = s?.getBoundingClientRect()
      const rl = l?.getBoundingClientRect()
      const t = document.querySelector('#ck-dtitle')?.getBoundingClientRect()
      const op = document.querySelector('.ck-sheet .ck-opt, .ck-sheet .ck-pen__zone')?.getBoundingClientRect()
      return { aoLado: !!rs && !!rl && rs.left >= rl.right - 1, tituloVisivel: !!t && t.top >= rs.top - 1 && t.bottom <= rs.bottom, opcaoVisivel: !!op && op.top < innerHeight && op.bottom > 0, sheet: rs && [Math.round(rs.left), Math.round(rs.top), Math.round(rs.width), Math.round(rs.height)] }
    })
    ok('deitado', r.aoLado && r.tituloVisivel && r.opcaoVisivel, `${w}×${h}: a decisão ao lado da tabela, título e opção à vista`, r)
    ok('deitado', m.lateral <= 0 && !m.sobrepostos.length, `${w}×${h}: sem rolagem lateral nem texto por baixo dos botões do topo`, { lateral: m.lateral, sobrepostos: m.sobrepostos })
    await print(page, NOME, `e2e-deitado-${w}x${h}`)
    await ctx.close()
  }
}

// ───────────────────────── ocupado: resposta no mesmo instante do toque (CPU 4×) ─────────────────────────
if (quer('ocupado')) {
  const ap = await abrir(browser, NOME, { ajustes: JSON.stringify({ state: { settings: { sound: false, volume: 0, skipAnimations: false, reducedMotion: null, lowFx: false, engine: 'auto' } }, version: 1 }) })
  const { page, cdp, ctx } = ap
  await comecar(page)
  await lento(cdp)
  // observa quando o "Simulando…" e a faixa entram (MutationObserver marca o tempo) e quando a thread trava
  await page.evaluate(() => {
    window.__marca = {}
    new MutationObserver(() => {
      if (!window.__marca.faixa && document.querySelector('.ck-sheet__busy, .ck-decision[aria-busy="true"]')) window.__marca.faixa = performance.now()
    }).observe(document.body, { subtree: true, childList: true, attributes: true })
    addEventListener('pointerup', () => (window.__marca.toque = performance.now()), true)
    const longas = []
    new PerformanceObserver((l) => l.getEntries().forEach((e) => longas.push([e.startTime, e.duration]))).observe({ type: 'longtask' })
    window.__marca.longas = longas
    // um quadro pintado depois do toque (rAF + rAF = já passou por uma pintura)
    addEventListener(
      'pointerup',
      () => requestAnimationFrame(() => requestAnimationFrame(() => (window.__marca.pintou = performance.now()))),
      true,
    )
  })
  const opt = page.locator('.ck-opt:not(.is-locked):not([disabled])', { hasNotText: /Aposentar/ }).first()
  await opt.tap()
  await sleep(6000)
  const r = await page.evaluate(() => {
    const m = window.__marca
    const grande = m.longas.filter(([s, d]) => d > 300).sort((a, b) => b[1] - a[1])[0]
    return { faixaMs: m.faixa && Math.round(m.faixa - m.toque), pintouMs: m.pintou && Math.round(m.pintou - m.toque), maiorTravaInicioMs: grande && Math.round(grande[0] - m.toque), maiorTravaMs: grande && Math.round(grande[1]) }
  })
  ok('ocupado', r.faixaMs != null && r.faixaMs < 150, '"Simulando…" e a faixa animada entram logo depois do toque', r)
  ok('ocupado', r.pintouMs != null && (r.maiorTravaInicioMs == null || r.pintouMs <= r.maiorTravaInicioMs + 5), 'a tela pinta o toque ANTES de a simulação travar a thread', r)
  await ctx.close()
}

// ───────────────────────── desktop 1366×900 ─────────────────────────
if (quer('desktop')) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1, locale: 'pt-BR' })
  await ctx.addInitScript((a) => localStorage.setItem('lenda:settings', a), RAPIDO)
  const page = await ctx.newPage()
  const erros = []
  page.on('pageerror', (e) => erros.push(e.message))
  await comecar(page)
  let m = await medir(page)
  const dec = await page.evaluate(() => {
    const d = document.querySelector('.ck-left .ck-decision')
    const r = d?.getBoundingClientRect()
    return { temPainel: !!r, sheet: document.querySelectorAll('.ck-sheet').length, topbar: !!document.querySelector('.ck-session__pace') && getComputedStyle(document.querySelector('.ck-session__pace')).display }
  })
  ok('desktop', dec.temPainel && dec.sheet === 0 && m.lateral <= 0, '1366×900: decisão no painel da esquerda, sem sheet, sem rolagem lateral', { ...dec, lateral: m.lateral })
  ok('desktop', dec.topbar === 'contents', '1366: o ritmo continua na barra do topo', dec.topbar)
  await print(page, 'desktop-1366', 'e2e-decisao')
  await escolher(page)
  await page.getByRole('tab', { name: /^Temporada/ }).first().click()
  await page.locator('.tb').first().waitFor({ timeout: 20000 }).catch(() => {})
  ok('desktop', (await page.locator('.tb').count()) > 0, '1366: a aba Temporada abre')
  await print(page, 'desktop-1366', 'e2e-aba-temporada')
  await page.getByRole('tab', { name: /^Carreira/ }).first().click()
  await terminar(page)
  await sleep(800)
  m = await medir(page)
  const fim = await page.evaluate(() => ({ fim: !!document.querySelector('.ck-left .ck-end'), barra: document.querySelectorAll('.ck-endbar').length }))
  ok('desktop', fim.fim && fim.barra === 0 && m.lateral <= 0, '1366: cartão do fim no lugar da decisão, sem barra de celular', fim)
  await print(page, 'desktop-1366', 'e2e-fim')
  ok('desktop', !erros.length, '1366: sem erro de página', erros.slice(0, 2))
  await ctx.close()
}

await browser.close()
writeFileSync(`${PRINTS}/${NOME}_e2e-carreira-mobile.json`, JSON.stringify(R, null, 2))
console.log(`\n${NOME}: ${falhas ? `${falhas} FALHA(S)` : 'tudo ok'} · relatório ${PRINTS}/${NOME}_e2e-carreira-mobile.json`)
process.exit(falhas ? 1 : 0)
