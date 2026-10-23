#!/usr/bin/env node
// LENDA v3.5 · suíte mobile — os diálogos da carreira do Clássico cabem e rolam no celular pequeno?
//
//   LENDA_URL=http://127.0.0.1:9110/lenda/ node servidor/teste/mobile/carreira-dialogos.mjs [--aparelho pequeno-320] [--altura 568]
//
// Com uma carreira em andamento: "Começar carreira" na Home (confirmação de nova carreira), Conquistas, Sala de
// troféus, Menu e, no resumo, "Ver imagem". Para cada um: cabe na janela? o botão principal está à vista? o conteúdo
// rola por dentro (e a página de trás não rola junto)? + print.
import { writeFileSync } from 'node:fs'
import { abrir, lancar, medir, print, sleep, URL0, PRINTS } from './carreira-lib.mjs'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  if (i < 0) return d
  const v = process.argv[i + 1]
  return !v || v.startsWith('--') ? true : v
}
const NOME = arg('aparelho', 'pequeno-320')
const ALTURA = arg('altura', null)
const RAPIDO = JSON.stringify({ state: { settings: { sound: false, volume: 0, skipAnimations: true, reducedMotion: true, lowFx: false, engine: 'auto' } }, version: 1 })
const browser = await lancar()
const ap = await abrir(browser, NOME, { ajustes: RAPIDO })
const { page, a } = ap
if (ALTURA) await page.setViewportSize({ width: a.w, height: Number(ALTURA) })
const TAG = `${NOME}${ALTURA ? `-${ALTURA}` : ''}`
const R = []
async function dialogo(rot) {
  await sleep(900)
  const d = await page.evaluate(() => {
    const dl = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((x) => x.getBoundingClientRect().height > 0).pop()
    if (!dl) return null
    const r = dl.getBoundingClientRect()
    const bts = [...dl.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => ({ t: (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 30), top: Math.round(b.getBoundingClientRect().top), bottom: Math.round(b.getBoundingClientRect().bottom) }))
    const rolavel = [...dl.querySelectorAll('*')].some((x) => /auto|scroll/.test(getComputedStyle(x).overflowY) && x.scrollHeight > x.clientHeight + 4)
    return { topo: Math.round(r.top), base: Math.round(r.bottom), janela: innerHeight, cabe: r.top >= -1 && r.bottom <= innerHeight + 1, rolaPorDentro: rolavel, botoesForaDaTela: bts.filter((b) => b.bottom > innerHeight || b.top < 0).map((b) => b.t), botoes: bts.length }
  })
  const m = await medir(page, { raiz: '[role="dialog"]' })
  const f = await print(page, TAG, `dialogo-${rot}`)
  // a página de trás rola junto quando se arrasta o diálogo? (rola a janela e vê se o scrollY mudou)
  const y0 = await page.evaluate(() => scrollY)
  await page.mouse.wheel(0, 400).catch(() => {})
  await sleep(300)
  const y1 = await page.evaluate(() => scrollY)
  const linha = { dialogo: rot, ...d, paginaRolouAtras: y1 !== y0, pequenos: m.pequenos.map((p) => `${p.nome} ${p.w}×${p.h}`).slice(0, 6), print: f }
  R.push(linha)
  console.log(`  ${d && (!d.cabe || d.botoesForaDaTela.length) ? '!!' : 'ok'}  ${rot}: ${JSON.stringify(linha)}`)
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(500)
}

await page.goto(`${URL0}#/identidade?ritmo=expressa`)
const busca = page.locator('input[placeholder="Buscar país"]')
await busca.waitFor({ timeout: 120000 })
await busca.fill('Brasil')
await busca.press('Enter')
await page.getByRole('button', { name: /^Continuar/ }).tap()
await page.locator('#id-surname').fill('DIALOGO')
await page.getByRole('button', { name: /^Continuar/ }).tap()
await page.locator('[role="radiogroup"][aria-label="Posição em campo"]').getByRole('radio', { name: 'Centroavante', exact: true }).tap()
await page.getByRole('button', { name: /^Confirmar$/ }).tap()
await page.locator('.ck-opt:not(.is-locked)').first().waitFor({ timeout: 120000 })
for (let k = 0; k < 4; k++) {
  await page.locator('.ck-opt:not(.is-locked)', { hasNotText: /Aposentar/ }).first().tap()
  await sleep(500)
  await page.locator('.ck-opt:not(.is-locked)').first().waitFor({ timeout: 60000 })
}
const verTodas = page.getByRole('button', { name: /Ver todas/ }).first()
if (await verTodas.count()) {
  await verTodas.scrollIntoViewIfNeeded()
  await verTodas.tap({ force: true })
  await dialogo('sala-de-trofeus')
}
await page.getByRole('button', { name: /^Menu$/ }).first().tap()
await dialogo('menu')
const conq = page.getByRole('button', { name: /^Conquistas/ }).first()
if (await conq.count()) {
  await conq.tap()
  await dialogo('conquistas')
}
await page.goto(URL0)
await page.locator('.ld-ctas__start').waitFor({ timeout: 60000 })
await page.locator('.ld-ctas__start').tap()
await dialogo('nova-carreira-confirmar')
await page.goto(`${URL0}#/identidade?ritmo=expressa`)
await busca.waitFor({ timeout: 60000 })
await page.getByRole('button', { name: /^Continuar/ }).tap()
await page.getByRole('button', { name: /^Continuar/ }).tap()
await page.getByRole('button', { name: /^Confirmar$/ }).tap()
await dialogo('substituir-carreira')
writeFileSync(`${PRINTS}/${TAG}_dialogos.json`, JSON.stringify(R, null, 2))
console.log(`erros: ${JSON.stringify(ap.erros)}`)
await browser.close()
