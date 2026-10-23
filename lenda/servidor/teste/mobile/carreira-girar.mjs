#!/usr/bin/env node
// LENDA v3.5 · suíte mobile — a carreira do Clássico em várias larguras, em pé e deitado (girar o celular).
//
//   LENDA_URL=http://127.0.0.1:9110/lenda/ node servidor/teste/mobile/carreira-girar.mjs
//
// Cria uma carreira (sem animação, para ir rápido), joga 3 decisões e passa a mesma tela por uma lista de tamanhos de
// celular de verdade (em pé e deitado). Em cada um: rolagem lateral, sobreposição na barra do topo (o "Temporada ·
// Ritmo" passando por baixo dos botões), o sheet da decisão (quanto da tela ele toma, se as opções cabem) e um print.
// Falha (código 1) com rolagem lateral, sobreposição, opções da decisão inalcançáveis ou erro no console.
import { writeFileSync } from 'node:fs'
import { abrir, lancar, medir, print, sleep, URL0, PRINTS, inesperados, placar } from './carreira-lib.mjs'

const P = placar('carreira-girar')

const RAPIDO = JSON.stringify({ state: { settings: { sound: false, volume: 0, skipAnimations: true, reducedMotion: true, lowFx: false, engine: 'auto' } }, version: 1 })
const TAMANHOS = [
  [320, 568], [360, 640], [360, 780], [375, 667], [390, 844], [412, 915], [430, 932],
  [568, 320], [640, 360], [667, 375], [720, 360], [740, 360], [780, 360], [800, 360], [844, 390], [915, 412], [932, 430],
]
const browser = await lancar()
const ap = await abrir(browser, 'iphone-14', { ajustes: RAPIDO })
const { page } = ap
await page.goto(`${URL0}#/identidade?ritmo=intensa`)
const busca = page.locator('input[placeholder="Buscar país"]')
await busca.waitFor({ timeout: 120000 })
await busca.fill('Brasil')
await busca.press('Enter')
await page.getByRole('button', { name: /^Continuar/ }).tap()
await page.locator('#id-surname').fill('SCHWEINSTEIGER')
await page.getByRole('button', { name: /^Continuar/ }).tap()
await page.locator('[role="radiogroup"][aria-label="Posição em campo"]').getByRole('radio', { name: 'Centroavante', exact: true }).tap()
await page.getByRole('button', { name: /^Confirmar$/ }).tap()
await page.locator('.ck-opt:not(.is-locked)').first().waitFor({ timeout: 120000 })
for (let k = 0; k < 3; k++) {
  await page.locator('.ck-opt:not(.is-locked)', { hasNotText: /Aposentar/ }).first().tap()
  await sleep(500)
  await page.locator('.ck-opt:not(.is-locked)').first().waitFor({ timeout: 60000 })
  for (const b of await page.locator('.lx-toast button[aria-label*="echar"], .lx-toast button[aria-label*="ispensar"]').all()) await b.tap().catch(() => {})
}
const R = []
for (const [w, h] of TAMANHOS) {
  await page.setViewportSize({ width: w, height: h })
  await sleep(700)
  await page.evaluate(() => scrollTo(0, 0))
  await sleep(200)
  const m = await medir(page)
  const sheet = await page.evaluate(() => {
    const s = document.querySelector('.ck-sheet')
    if (!s) return null
    const r = s.getBoundingClientRect()
    const opts = [...document.querySelectorAll('.ck-sheet .ck-opt')].map((o) => o.getBoundingClientRect())
    return { topo: Math.round(r.top), fracaoDaTela: Math.round((Math.min(innerHeight, r.bottom) - Math.max(0, r.top)) / innerHeight * 100), opcoesInteirasVisiveis: opts.filter((o) => o.top >= r.top && o.bottom <= innerHeight).length, nOpcoes: opts.length }
  })
  const f = await print(page, `${w}x${h}`, 'girar-carreira')
  const linha = { tamanho: `${w}x${h}`, deitado: w > h, lateral: m.lateral, sobrepostos: m.sobrepostos, sheet, print: f }
  R.push(linha)
  P.ok(m.lateral <= 0 && !m.sobrepostos.length, `${w}x${h}: sem rolagem lateral nem sobreposição`, `lateral ${m.lateral} · ${m.sobrepostos.join(' | ') || 'sem sobreposição'} · sheet ${JSON.stringify(sheet)}`)
  // as opções: ou cabem, ou o sheet/painel rola por dentro (a 1ª opção tem de dar para alcançar)
  const alcanca = await page.evaluate(() => {
    const o = document.querySelector('.ck-opt:not(.is-locked)')
    if (!o) return false
    o.scrollIntoView({ block: 'nearest' })
    const r = o.getBoundingClientRect()
    return r.top >= 0 && r.bottom <= innerHeight + 1
  })
  P.ok(alcanca, `${w}x${h}: a 1ª opção da decisão dá para alcançar (rolando o sheet ou a página)`)
}
writeFileSync(`${PRINTS}/girar.json`, JSON.stringify(R, null, 2))
P.ok(!inesperados([...ap.erros, ...ap.s5xx]).length, 'sem erro no console nem 5xx', inesperados([...ap.erros, ...ap.s5xx]).slice(0, 5))
await browser.close()
P.fim()
