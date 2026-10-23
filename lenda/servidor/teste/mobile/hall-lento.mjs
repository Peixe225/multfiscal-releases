// LENDA v3.5 · suíte mobile · Hall/Desafios/Conquistas no celular intermediário: 4G lento (CDP ≈1,6 Mb/s, 150 ms) e
// processador 4× mais lento. Cada medida abre um aparelho NOVO (sem cache: a primeira visita de quem chega pelo link).
//
//   LENDA_INTEG_BASE=/tmp/lenda-v35-hall node servidor/teste/mobile/hall-lento.mjs [--aparelho galaxy-a] [--vezes 2]
//   node servidor/teste/mobile/hall-lento.mjs --alvo prod --perfil <código>      (produção: só leitura)
//
// Mede (ms desde o início da navegação): a tela pronta para usar, os bytes baixados, as tarefas longas (> 50 ms) e o
// maior "congelamento" (a soma das tarefas longas seguidas) ao abrir as conquistas, trocar de categoria e rolar o Hall.
import { existsSync, readFileSync } from 'node:fs'
import { abrirH, lancar, nota, salvarRelatorio, sleep, print, tocar, longasDesde, agora, fimHall } from './hall-lib.mjs'
import { abrirEsperando } from './aparelhos.mjs'

const arg = (k, def) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : def
}
const ALVO = arg('alvo', 'local')
const PROD = ALVO === 'prod'
const BASE = process.env.LENDA_INTEG_BASE ?? '/tmp/lenda-v35-hall'
const env = !PROD ? Object.fromEntries(readFileSync(`${BASE}/segredos.env`, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
// local: LENDA_URL troca o endereço (o rodar.sh aponta para o servidor HTTP/2 com brotli da área "carga": no php -S, sem
// compressão, a 1ª visita baixa ~2,5 MB e os números do 4G lento não dizem nada)
const URL0 = PROD ? 'https://oprojeto.online/lenda/' : (process.env.LENDA_URL ?? `http://127.0.0.1:${env.PORTA}/lenda/`).replace(/\/?$/, '/')
const SEM = !PROD && existsSync(`${BASE}/hall-semente.json`) ? JSON.parse(readFileSync(`${BASE}/hall-semente.json`, 'utf8')) : null
const CODIGO = PROD ? arg('perfil', null) : SEM?.codigo
const APARELHO = arg('aparelho', 'galaxy-a')
const VEZES = Number(arg('vezes', 1))
const browser = await lancar()

async function bytes(d) {
  let total = 0
  d.cdp.on('Network.loadingFinished', (e) => (total += e.encodedDataLength || 0))
  return () => total
}
const ms = (page) => page.evaluate(() => Math.round(performance.now()))

async function frio(nome, h, sel, extra) {
  for (let v = 0; v < VEZES; v++) {
    const d = await abrirH(browser, APARELHO, { prod: PROD, lento: true })
    await d.cdp.send('Network.enable')
    const lidos = await bytes(d)
    const t0 = Date.now()
    await d.page.goto(`${URL0}${h}`, { waitUntil: 'commit', timeout: 120000 })
    let pronto = null
    try {
      await d.page.waitForSelector(sel, { timeout: 90000 })
      pronto = await ms(d.page)
    } catch {}
    const r = { tela: nome, prontoMs: pronto, parede: Date.now() - t0, kb: Math.round(lidos() / 1024) }
    if (extra) Object.assign(r, await extra(d).catch((e) => ({ erro: e.message })))
    const longas = await longasDesde(d.page, 0)
    r.longas = longas.length
    r.maiorLonga = Math.max(0, ...longas)
    nota(d, nome, pronto != null && pronto < 8000, `frio no 4G lento + CPU 4×: pronto em ${pronto ?? '—'} ms (${r.kb} KB baixados) · ${longas.length} tarefas longas, a maior ${r.maiorLonga} ms${Object.keys(r).length > 6 ? ' · ' + JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !['tela', 'prontoMs', 'parede', 'kb', 'longas', 'maiorLonga'].includes(k)))) : ''}`, r)
    await print(d, `lento-${nome}${VEZES > 1 ? `-${v + 1}` : ''}`)
    await d.ctx.close()
  }
}

// 1. o link do perfil (o que vai na bio / no comentário): primeira visita
if (CODIGO) await frio('perfil-link', `?c=${CODIGO}#/jogador/${CODIGO}`, 'main#conteudo:not([aria-busy="true"]) h1, main#conteudo:not([aria-busy="true"]) .sv-head__t')
// 2. o Hall direto: o ranking aparece; e a comunidade
await frio('hall', '#/hall', '.hl-row.is-legend', async (d) => {
  const t = await d.page.waitForSelector('.hl-cstatus:not(:has(.is-busy))', { timeout: 60000 }).then(() => ms(d.page)).catch(() => null)
  return { comunidadeMs: t }
})
// 3. #/desafios direto
await frio('desafios', '#/desafios', '.s4-emb, .sv-desafio, .sv-page:not([aria-busy="true"]) .sv-head__t')
// 4. a faixa dos desafios na tela inicial
await frio('home-faixa', '#/', '.ld-modes', async (d) => {
  const t = await d.page.waitForSelector('.s4-faixa', { timeout: 30000 }).then(() => ms(d.page)).catch(() => null)
  return { faixaMs: t }
})

// 5. interações no Hall já aberto: conquistas, categoria, rolagem
{
  const d = await abrirH(browser, APARELHO, { prod: PROD, lento: true, hall: SEM?.entradas })
  await abrirEsperando(d.page, `${URL0}#/`, '.ld-modes', { prod: PROD, ms: 120000 })
  await sleep(4000)
  // conquistas: do toque ao diálogo com a lista
  let t1 = await agora(d.page)
  const tt = Date.now()
  await d.page.locator('.ld-medal, button[aria-label^="Ver conquistas"]').first().tap()
  await d.page.waitForSelector('[role="dialog"] .ac-item', { timeout: 30000 })
  const abriu = Date.now() - tt
  await sleep(1500)
  let l = await longasDesde(d.page, t1)
  nota(d, 'conquistas-abrir', abriu < 1500 && Math.max(0, ...l) < 300, `abrir as 87 conquistas: ${abriu} ms do toque à lista · tarefas longas ${l.join(', ') || 'nenhuma'} ms`, { abriu, longas: l })
  await print(d, 'lento-conquistas-aberto')
  // rolar a lista das 87
  t1 = await agora(d.page)
  for (let i = 0; i < 8; i++) {
    await d.page.mouse.wheel(0, 600).catch(() => {})
    await d.page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] .lx-dialog__body')].pop()
      if (b) b.scrollTop += 600
    })
    await sleep(120)
  }
  await sleep(800)
  l = await longasDesde(d.page, t1)
  nota(d, 'conquistas-rolar', Math.max(0, ...l) < 200, `rolar a lista: tarefas longas ${l.join(', ') || 'nenhuma'} ms`, { longas: l })
  // grade
  t1 = await agora(d.page)
  await d.page.locator('[role="dialog"] button[aria-label="Visualização em grade"]').tap()
  await sleep(1500)
  l = await longasDesde(d.page, t1)
  nota(d, 'conquistas-grade', Math.max(0, ...l) < 300, `trocar para a grade: tarefas longas ${l.join(', ') || 'nenhuma'} ms`, { longas: l })
  await d.page.locator('[role="dialog"] button[aria-label="Visualização em lista"]').tap()
  await sleep(500)
  await d.page.keyboard.press('Escape')
  await sleep(600)
  // o Hall pelo menu (navegação dentro do jogo, com o chunk já baixado ou não)
  t1 = await agora(d.page)
  const th = Date.now()
  await d.page.evaluate(() => (location.hash = '#/hall'))
  await d.page.waitForSelector('.hl-row.is-legend', { timeout: 60000 })
  const hallMs = Date.now() - th
  await sleep(1500)
  l = await longasDesde(d.page, t1)
  nota(d, 'hall-pelo-jogo', hallMs < 2500, `da tela inicial ao Hall (navegação interna): ${hallMs} ms até o ranking · tarefas longas ${l.join(', ') || 'nenhuma'} ms`, { hallMs, longas: l })
  // trocar de categoria 4 vezes
  await d.page.evaluate(() => document.querySelector('#hl-cat-h')?.scrollIntoView({ block: 'center' }))
  await sleep(600)
  t1 = await agora(d.page)
  const tabs = d.page.locator('.hl-cat-tab')
  const tempos = []
  for (const i of [3, 6, 10, 14]) {
    const tc = Date.now()
    await tabs.nth(i).tap()
    await d.page.waitForFunction((i) => document.querySelectorAll('.hl-cat-tab')[i]?.getAttribute('aria-selected') === 'true', i)
    tempos.push(Date.now() - tc)
    await sleep(700)
  }
  l = await longasDesde(d.page, t1)
  nota(d, 'hall-categorias', Math.max(0, ...l) < 200, `trocar de categoria (4×): ${tempos.join(', ')} ms até marcar · tarefas longas ${l.join(', ') || 'nenhuma'} ms`, { tempos, longas: l })
  // rolar o Hall inteiro (o dedo, em passos)
  await d.page.evaluate(() => scrollTo(0, 0))
  await sleep(500)
  t1 = await agora(d.page)
  const gap = await d.page.evaluate(async () => {
    let maior = 0
    let ant = performance.now()
    let fim = false
    const loop = (t) => {
      maior = Math.max(maior, t - ant)
      ant = t
      if (!fim) requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
    const H = document.documentElement.scrollHeight
    for (let y = 0; y < H; y += 300) {
      scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 60))
    }
    fim = true
    return Math.round(maior)
  })
  l = await longasDesde(d.page, t1)
  nota(d, 'hall-rolar', gap < 250, `rolar o Hall de cima a baixo: maior intervalo entre quadros ${gap} ms · tarefas longas ${l.join(', ') || 'nenhuma'} ms`, { gap, longas: l })
  // a ficha de uma lenda
  await d.page.evaluate(() => document.querySelector('#hl-overall-h')?.scrollIntoView({ block: 'center' }))
  await sleep(500)
  t1 = await agora(d.page)
  const tf = Date.now()
  await d.page.locator('.hl-row.is-legend').first().tap()
  await d.page.waitForSelector('[role="dialog"] .lx-dialog__body', { timeout: 30000 })
  const fichaMs = Date.now() - tf
  await sleep(1200)
  l = await longasDesde(d.page, t1)
  nota(d, 'ficha-lenda', fichaMs < 1200, `abrir a ficha de uma lenda: ${fichaMs} ms · tarefas longas ${l.join(', ') || 'nenhuma'} ms`, { fichaMs, longas: l })
  await print(d, 'lento-ficha-lenda')
  await d.ctx.close()
}

salvarRelatorio(`relatorio-lento-${ALVO}-${APARELHO}`)
await browser.close()
fimHall()
