#!/usr/bin/env node
// LENDA v3.5 · suíte mobile — simulação do Safari antigo (iOS 15.x) nas telas da carreira do Clássico.
//
//   LENDA_URL=http://127.0.0.1:9110/lenda/ node servidor/teste/mobile/carreira-ios15.mjs [--aparelho iphone-se]
//
// Só há Chromium aqui; o que dá para imitar do Safari 15:
//   · `overflow: clip` não existe no Safari < 16 → vira `visible`: tudo o que o site corta com clip passa a vazar
//     (rolagem lateral?). Medido em cada tela trocando o clip por visible no estilo computado.
//   · `100dvh/100svh` não existem no Safari < 15.4 → a declaração inteira é ignorada (vale o valor anterior/inicial).
//   · `@container`/`cqi` (Safari 16), `color-mix()` (16.2), `:has()` (15.4): lista as regras do CSS do build que
//     dependem deles (o que muda de aparência no iPhone com iOS 15).
// E a busca no JS do build por APIs que o Safari 15.0–15.3 não tem (structuredClone, Array.at, Object.hasOwn…), e uma
// carreira jogada num aparelho SEM essas três APIs (apagadas antes do jogo carregar, como no Safari 15.0–15.3): os
// polyfills da v3.5 (src/polyfills.ts) têm de cobrir a carreira, o resumo e o Hall.
// Falha (código 1) com rolagem lateral sem o clip, erro de JavaScript sem as APIs, ou erro no console.
import { readdirSync, readFileSync } from 'node:fs'
import { abrir, lancar, print, sleep, URL0, inesperados, placar } from './carreira-lib.mjs'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  if (i < 0) return d
  const v = process.argv[i + 1]
  return !v || v.startsWith('--') ? true : v
}
const NOME = arg('aparelho', 'iphone-se')
const P = placar(`carreira-ios15 (${NOME})`)
const DIST = arg('dist', new URL('../../../dist-site/assets/', import.meta.url).pathname)
const RAPIDO = JSON.stringify({ state: { settings: { sound: false, volume: 0, skipAnimations: true, reducedMotion: true, lowFx: false, engine: 'auto' } }, version: 1 })
const browser = await lancar()
const ap = await abrir(browser, NOME, { ajustes: RAPIDO })
const { page } = ap

const semClip = () =>
  page.evaluate(() => {
    const antes = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth
    let n = 0
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el)
      if (cs.overflowX === 'clip' || cs.overflowY === 'clip') {
        ;(window.__clipados = window.__clipados ?? []).push(el)
        if (cs.overflowX === 'clip') el.style.overflowX = 'visible'
        if (cs.overflowY === 'clip') el.style.overflowY = 'visible'
        n++
      }
    }
    const depois = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth
    // quem passa da borda direita
    const fora = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > innerWidth + 2 && getComputedStyle(el).position !== 'fixed') fora.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')} → ${Math.round(r.right)}`)
    }
    return { clips: n, lateralAntes: antes, lateralSemClip: depois, fora: fora.slice(0, 6) }
  })

async function tela(rot) {
  await sleep(800)
  const r = await semClip()
  await print(page, NOME, `ios15-${rot}`)
  P.ok(r.lateralSemClip <= 0, `${rot}: sem rolagem lateral com o overflow:clip desligado (Safari < 16)`, r.lateralSemClip > 0 ? r : undefined)
  await page.evaluate(() => {
    for (const el of window.__clipados ?? []) el.style.overflowX = el.style.overflowY = ''
    window.__clipados = []
  })
  return r
}

await page.goto(URL0)
await page.locator('.ld-ctas__start').waitFor({ timeout: 120000 })
await tela('home')
await page.locator('.ld-ctas__start').waitFor({ timeout: 120000 })
await page.locator('.ld-ctas__start').tap()
const busca = page.locator('input[placeholder="Buscar país"]')
await busca.waitFor({ timeout: 60000 })
await busca.fill('Brasil')
await busca.press('Enter')
await page.getByRole('button', { name: /^Continuar/ }).tap()
await page.locator('#id-surname').fill('SAFARIQUINZE')
await tela('identidade')
await page.getByRole('button', { name: /^Continuar/ }).tap()
await page.locator('[role="radiogroup"][aria-label="Posição em campo"]').getByRole('radio', { name: 'Centroavante', exact: true }).tap()
await page.getByRole('button', { name: /^Confirmar$/ }).tap()
await page.locator('.ck-opt:not(.is-locked)').first().waitFor({ timeout: 120000 })
for (let k = 0; k < 3; k++) {
  await page.locator('.ck-opt:not(.is-locked)', { hasNotText: /Aposentar/ }).first().tap()
  await page.locator('.ck-opt:not(.is-locked), .ck-end').first().waitFor({ timeout: 60000 })
  await sleep(400)
}
await tela('carreira')
for (let k = 0; k < 30 && !(await page.locator('.ck-end').count()); k++) {
  await page.locator('.ck-opt:not(.is-locked)', { hasNotText: /Aposentar/ }).first().tap().catch(() => {})
  await page.locator('.ck-opt:not(.is-locked), .ck-end').first().waitFor({ timeout: 60000 }).catch(() => {})
  await sleep(300)
}
await tela('fim')
await page.goto(`${URL0}#/resumo`)
await page.locator('.sm-top').waitFor({ timeout: 60000 })
await tela('resumo')

// CSS do build: regras que dependem do que o Safari 15 não tem
const css = readdirSync(DIST).filter((f) => f.endsWith('.css'))
const conta = {}
for (const f of css) {
  const t = readFileSync(DIST + f, 'utf8')
  for (const [k, re] of Object.entries({ 'overflow:clip': /overflow(-x|-y)?:\s*clip/g, '@container': /@container/g, cqi: /\d+cqi/g, 'color-mix()': /color-mix\(/g, ':has()': /:has\(/g, dvh: /\d+dvh/g, svh: /\d+svh/g }))
    conta[k] = (conta[k] ?? 0) + (t.match(re)?.length ?? 0)
}
console.log('CSS do build (ocorrências):', JSON.stringify(conta))
const js = readdirSync(DIST).filter((f) => f.endsWith('.js'))
const apis = {}
for (const f of js) {
  const t = readFileSync(DIST + f, 'utf8')
  for (const [k, re] of Object.entries({ structuredClone: /structuredClone\(/g, 'Array.at(-n)': /\.at\(-\d/g, 'Object.hasOwn': /Object\.hasOwn\(/g, 'crypto.randomUUID': /randomUUID\(/g, lookbehind: /\(\?<[=!]/g }))
    if (re.test(t)) (apis[k] = apis[k] ?? []).push(f)
}
console.log('JS do build (Safari < 15.4 não tem):', JSON.stringify(apis))
P.ok(!inesperados([...ap.erros, ...ap.s5xx]).length, 'sem erro no console nem 5xx', inesperados([...ap.erros, ...ap.s5xx]).slice(0, 5))
await ap.ctx.close()

// ── o aparelho sem structuredClone, Array.prototype.at e Object.hasOwn (Safari 15.0–15.3) ──
const v = await abrir(browser, NOME, { ajustes: RAPIDO })
await v.ctx.addInitScript(() => {
  try {
    delete Array.prototype.at
    delete String.prototype.at
    for (const T of [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array]) delete Object.getPrototypeOf(T.prototype).at
    delete Object.hasOwn
    delete window.structuredClone
  } catch {}
})
await v.page.goto(URL0)
await v.page.locator('.ld-ctas__start').waitFor({ timeout: 120000 })
P.ok(await v.page.evaluate(() => typeof [].at === 'function' && typeof structuredClone === 'function' && typeof Object.hasOwn === 'function'), 'sem as APIs do Safari 15.4: os polyfills do jogo as repõem')
await v.page.goto(`${URL0}#/identidade?ritmo=expressa`)
await v.page.locator('input[placeholder="Buscar país"]').waitFor({ timeout: 60000 })
await v.page.locator('input[placeholder="Buscar país"]').fill('Brasil')
await v.page.locator('input[placeholder="Buscar país"]').press('Enter')
await v.page.getByRole('button', { name: /^Continuar/ }).tap()
await v.page.locator('#id-surname').fill('POLYFILL')
await v.page.getByRole('button', { name: /^Continuar/ }).tap()
await v.page.locator('[role="radiogroup"][aria-label="Posição em campo"]').getByRole('radio', { name: 'Centroavante', exact: true }).tap()
await v.page.getByRole('button', { name: /^Confirmar$/ }).tap()
let decisoes = 0
for (let k = 0; k < 40 && !(await v.page.locator('.ck-end').count()); k++) {
  const ok = await v.page.locator('.ck-opt:not(.is-locked), .ck-end').first().waitFor({ timeout: 60000 }).then(() => true).catch(() => false)
  if (!ok || (await v.page.locator('.ck-end').count())) break
  await v.page.locator('.ck-opt:not(.is-locked)', { hasNotText: /Aposentar/ }).first().tap().catch(() => {})
  decisoes++
  await sleep(300)
}
P.ok((await v.page.locator('.ck-end').count()) > 0, `sem as APIs: a carreira inteira roda (${decisoes} decisões) até o fim`)
await v.page.goto(`${URL0}#/resumo`)
P.ok(await v.page.locator('.sm-top').waitFor({ timeout: 60000 }).then(() => true).catch(() => false), 'sem as APIs: o resumo abre')
await v.page.goto(`${URL0}#/hall`)
await sleep(4000)
await print(v.page, NOME, 'ios15-sem-apis-hall')
P.ok((await v.page.locator('.hl-row, .hl-table').count()) > 0 && !(await v.page.getByText(/Algo deu errado/).count()), 'sem as APIs: o Hall abre')
const errV = inesperados([...v.erros, ...v.s5xx])
P.ok(!errV.length, 'sem as APIs: nenhum erro de JavaScript', errV.slice(0, 5))
await browser.close()
P.fim()
