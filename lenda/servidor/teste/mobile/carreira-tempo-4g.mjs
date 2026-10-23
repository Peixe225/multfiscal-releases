#!/usr/bin/env node
// LENDA v3.5 · suíte mobile — quanto tempo até dar para jogar no 4G lento (≈1,6 Mb/s, 150 ms) + CPU 4×, primeira visita
// (cache vazio) e segunda visita (cache cheio).
//
//   LENDA_URL=https://oprojeto.online/lenda/ node servidor/teste/mobile/carreira-tempo-4g.mjs [--aparelho galaxy-a] [--vezes 2] [--sem-filme]
//
// SÓ LEITURA: todo pedido a /api/ é abortado antes de sair (nem a medição de visitas chega ao servidor; nada de conta,
// carreira salva no servidor ou Fale conosco). A carreira começada fica só no IndexedDB deste navegador descartável.
// Mede: Home com o botão "Começar carreira" · toque → tela da identidade · Confirmar → 1ª decisão tocável · bytes
// baixados (o que o CDP viu) e os maiores arquivos.
import { abrir, lancar, print, sleep, URL0, PRINTS } from './carreira-lib.mjs'
import { writeFileSync } from 'node:fs'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  if (i < 0) return d
  const v = process.argv[i + 1]
  return !v || v.startsWith('--') ? true : v
}
const NOME = arg('aparelho', 'galaxy-a')
const VEZES = Number(arg('vezes', 2))
const SEM_FILME = !!arg('sem-filme', false)
const browser = await lancar()
const ap = await abrir(browser, NOME, { lento: true, bloquearApi: true })
const { page, cdp } = ap
const bytes = new Map()
let tNav = 0
cdp.on('Network.loadingFinished', (e) => bytes.set(e.requestId, { ...(bytes.get(e.requestId) ?? {}), b: e.encodedDataLength, fim: Date.now() - tNav }))
cdp.on('Network.requestWillBeSent', (e) => bytes.set(e.requestId, { ...(bytes.get(e.requestId) ?? {}), ini: Date.now() - tNav, url: e.request.url }))
cdp.on('Network.responseReceived', (e) => bytes.set(e.requestId, { ...(bytes.get(e.requestId) ?? {}), url: e.response.url, cache: e.response.fromDiskCache || e.response.fromServiceWorker }))
const host = new URL(URL0).host
const tag = `${NOME}_${host.replace(/[^a-z0-9]+/gi, '-')}`
const R = { url: URL0, aparelho: NOME, rodadas: [] }
for (let v = 1; v <= VEZES; v++) {
  bytes.clear()
  const r = { visita: v }
  const t0 = Date.now()
  // a 2ª visita começa da Home sem carreira (a da 1ª é abandonada antes) para medir o mesmo caminho
  if (v > 1) {
    await page.evaluate(() => new Promise((res) => { const q = indexedDB.deleteDatabase('lenda'); q.onsuccess = q.onerror = q.onblocked = () => res() }))
    await page.goto('about:blank')
  }
  const t1 = Date.now()
  tNav = t1
  await page.goto(URL0, { waitUntil: 'commit', timeout: 180000 })
  // filme: um print a cada ~1,5 s até o botão aparecer (o que a pessoa vê enquanto espera)
  let k = 0
  while (!(await page.locator('.ld-ctas__start').isVisible().catch(() => false)) && Date.now() - t1 < 180000) {
    if (v === 1 && k < 12 && !SEM_FILME) await print(page, tag, `v${v}-carregando-${String(++k).padStart(2, '0')}-${Math.round((Date.now() - t1) / 100) / 10}s`)
    await sleep(1500)
  }
  r.homeComBotaoMs = Date.now() - t1
  r.antesDoBotao = [...bytes.values()].filter((x) => x.url && x.fim != null && x.fim <= r.homeComBotaoMs).sort((a, b) => b.b - a.b).slice(0, 14).map((x) => `${Math.round(x.b / 1024)} KB @${(x.fim / 1000).toFixed(1)}s ${x.url.replace(URL0, '')}`)
  // a cascata: cada pedido até o botão aparecer, na ordem em que começou (início → fim, tamanho)
  r.cascata = [...bytes.values()].filter((x) => x.url && x.ini != null && x.ini <= r.homeComBotaoMs).sort((a, b) => a.ini - b.ini).map((x) => `${(x.ini / 1000).toFixed(1)}→${x.fim != null ? (x.fim / 1000).toFixed(1) : '?'}s ${Math.round((x.b || 0) / 1024)}KB ${x.url.replace(URL0, '') || '(página)'}`)
  r.kbAntesDoBotao = Math.round([...bytes.values()].filter((x) => x.url && x.fim != null && x.fim <= r.homeComBotaoMs).reduce((s, x) => s + (x.b || 0), 0) / 1024)
  await print(page, tag, `v${v}-home`)
  const t2 = Date.now()
  await page.locator('.ld-ctas__start').tap()
  await page.locator('input[placeholder="Buscar país"]').waitFor({ state: 'visible', timeout: 180000 })
  r.toqueAteIdentidadeMs = Date.now() - t2
  await page.locator('input[placeholder="Buscar país"]').fill('Brasil')
  await page.locator('input[placeholder="Buscar país"]').press('Enter')
  const wide = await page.evaluate(() => matchMedia('(min-width: 45rem)').matches)
  if (!wide) await page.getByRole('button', { name: /^Continuar/ }).tap()
  await page.locator('#id-surname').fill('TEMPO')
  if (!wide) await page.getByRole('button', { name: /^Continuar/ }).tap()
  await page.locator('[role="radiogroup"][aria-label="Posição em campo"]').getByRole('radio', { name: 'Centroavante', exact: true }).tap()
  const t3 = Date.now()
  await page.getByRole('button', { name: wide ? /Confirmar identidade/ : /^Confirmar$/ }).tap()
  await page.locator('.ck-opt:not(.is-locked), .ck-pen__zone').first().waitFor({ state: 'visible', timeout: 300000 })
  r.confirmarAtePrimeiraDecisaoMs = Date.now() - t3
  await print(page, tag, `v${v}-primeira-decisao`)
  // reabrir a carreira (recarregar em #/carreira, cache cheio): até a decisão voltar a ser tocável + o que travou
  await sleep(1500)
  await page.evaluate(() => (window.__longas = []))
  const t4 = Date.now()
  await page.reload({ waitUntil: 'commit' })
  await page.locator('.ck-opt:not(.is-locked), .ck-pen__zone').first().waitFor({ state: 'visible', timeout: 300000 })
  r.recarregarCarreiraMs = Date.now() - t4
  await sleep(4000)
  const ls = await page.evaluate(() => (window.__longas ?? []).map((l) => l.d))
  r.recarregarTarefasLongas = { n: ls.length, maiorMs: Math.max(0, ...ls), somaMs: ls.reduce((a, b) => a + b, 0) }
  const lista = [...bytes.values()].filter((x) => x.url && x.b != null)
  r.baixadoKB = Math.round(lista.reduce((s, x) => s + (x.b || 0), 0) / 1024)
  r.pedidos = lista.length
  r.maiores = lista.sort((a, b) => b.b - a.b).slice(0, 8).map((x) => `${Math.round(x.b / 1024)} KB ${x.url.replace(URL0, '')}`)
  r.totalMs = Date.now() - t0
  console.log(`visita ${v}: ${JSON.stringify(r, null, 1)}`)
  R.rodadas.push(r)
  await sleep(1500)
}
R.erros = ap.erros.filter((e) => !/api\/|Failed to fetch|ERR_FAILED|net::/.test(e))
R.errosDeRedeBloqueadaDeProposito = ap.erros.length - R.erros.length
writeFileSync(`${PRINTS}/tempo-4g_${tag}.json`, JSON.stringify(R, null, 2))
console.log(`erros (fora os da /api/ bloqueada): ${JSON.stringify(R.erros)}`)
await browser.close()
