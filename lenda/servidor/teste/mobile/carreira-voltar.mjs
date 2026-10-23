#!/usr/bin/env node
// LENDA v3.5 · suíte mobile — o "voltar" do Android (history.back) em cada ponto da carreira do Clássico.
//
//   LENDA_URL=http://127.0.0.1:9110/lenda/ node servidor/teste/mobile/carreira-voltar.mjs [--aparelho galaxy-a]
//
// Cenários (cada um diz onde a pessoa foi parar e se a carreira continua lá):
//   A. assistente da identidade no passo 3 → voltar          (esperado: passo 2, com o que já foi preenchido)
//   B. carreira com a "Sala de troféus" (Ver todas) aberta → voltar   (esperado: fecha o diálogo, fica na carreira)
//   C. carreira com o Menu aberto → voltar                     (esperado: fecha o menu)
//   D. carreira durante a revelação (logo depois de escolher) → voltar → Continuar (a escolha ficou?)
//   E. resumo com "Sua imagem" (Compartilhar sem Web Share) aberto → voltar  (esperado: fecha a folha)
//   F. "Jogar novamente" → identidade → voltar                 (o que aparece?)
// Prints em $LENDA_PRINTS/<aparelho>_voltar-*.png. Sem conta.
import { writeFileSync } from 'node:fs'
import { abrir, lancar, print, lerKv, sleep, URL0, PRINTS } from './carreira-lib.mjs'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  if (i < 0) return d
  const v = process.argv[i + 1]
  return !v || v.startsWith('--') ? true : v
}
const NOME = arg('aparelho', 'galaxy-a')
const RAPIDO = JSON.stringify({ state: { settings: { sound: false, volume: 0, skipAnimations: true, reducedMotion: true, lowFx: false, engine: 'auto' } }, version: 1 })
const browser = await lancar()
const ap = await abrir(browser, NOME, { ajustes: RAPIDO })
const { page } = ap
const R = { aparelho: NOME, cenarios: {} }
const onde = async () => ({
  hash: await page.evaluate(() => location.hash),
  dialogo: await page.locator('[role="dialog"]').count(),
  passo: ((await page.locator('.id-wiz__head .lx-eyebrow').first().textContent({ timeout: 500 }).catch(() => '')) || '').trim(),
  picks: (await lerKv(page, 'career:current'))?.replay?.picks?.length ?? null,
})
const voltar = async () => {
  await page.goBack({ waitUntil: 'commit', timeout: 15000 }).catch(() => {})
  await sleep(1200)
}
const log = (k, v) => {
  R.cenarios[k] = v
  console.log(`  ${k}: ${JSON.stringify(v)}`)
}

// A — assistente
await page.goto(URL0)
await page.locator('.ld-ctas__start').waitFor({ timeout: 120000 })
await page.locator('.ld-ctas__start').tap()
const busca = page.locator('input[placeholder="Buscar país"]')
await busca.waitFor({ timeout: 60000 })
await busca.fill('Brasil')
await busca.press('Enter')
await page.getByRole('button', { name: /^Continuar/ }).tap()
await page.locator('#id-surname').fill('VOLTAR')
await page.getByRole('button', { name: /^Continuar/ }).tap()
await sleep(500)
const antesA = await onde()
await voltar()
const depoisA = await onde()
await print(page, NOME, 'voltar-A-assistente-passo3')
log('A_assistente_passo3', { antes: antesA, depois: depoisA, ficouNoAssistente: /identidade/.test(depoisA.hash) })
// de volta ao passo 3 para começar a carreira
if (!/identidade/.test(depoisA.hash)) {
  await page.goto(`${URL0}#/identidade?ritmo=expressa`)
  await busca.waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: /^Continuar/ }).tap()
  await page.getByRole('button', { name: /^Continuar/ }).tap()
}
await page.locator('[role="radiogroup"][aria-label="Posição em campo"]').getByRole('radio', { name: 'Centroavante', exact: true }).tap()
await page.getByRole('button', { name: /^Confirmar$/ }).tap()
await page.locator('.ck-opt:not(.is-locked)').first().waitFor({ timeout: 120000 })

const escolher = async () => {
  const o = page.locator('.ck-opt:not(.is-locked):not([disabled])', { hasNotText: /Aposentar|Encerrar a carreira/ }).first()
  await o.tap()
  await sleep(600)
  for (let i = 0; i < 40 && !(await page.locator('.ck-opt:not(.is-locked), .ck-end').count()); i++) {
    const c = page.locator('.ck-cel').getByRole('button', { name: /^Continuar/ })
    if (await c.count()) await c.tap().catch(() => {})
    await sleep(300)
  }
}
// até ter um troféu na vitrine (o "Ver todas" aparece com taças) ou umas decisões
for (let k = 0; k < 12 && (k < 4 || !(await page.getByRole('button', { name: /Ver todas/ }).count())); k++) {
  if (await page.locator('.ck-end').count()) break
  await escolher()
}

// B — Sala de troféus aberta
const verTodas = page.getByRole('button', { name: /Ver todas/ }).first()
if (await verTodas.count()) {
  await verTodas.tap()
  await sleep(800)
  const antesB = await onde()
  await print(page, NOME, 'voltar-B-sala-trofeus-aberta')
  await voltar()
  const depoisB = await onde()
  await print(page, NOME, 'voltar-B-depois')
  log('B_sala_de_trofeus', { antes: antesB, depois: depoisB, saiuDaCarreira: !/carreira/.test(depoisB.hash) })
  if (!/carreira/.test(depoisB.hash)) {
    await page.goForward({ waitUntil: 'commit' }).catch(() => {})
    await sleep(1000)
  }
  if (await page.locator('[role="dialog"]').count()) await page.keyboard.press('Escape')
} else log('B_sala_de_trofeus', { pulado: 'sem "Ver todas" na vitrine' })

// C — Menu aberto
const menu = page.getByRole('button', { name: /^Menu$/ }).first()
if (await menu.count()) {
  await menu.tap()
  await sleep(700)
  const antesC = await onde()
  await print(page, NOME, 'voltar-C-menu-aberto')
  await voltar()
  const depoisC = await onde()
  log('C_menu', { antes: antesC, depois: depoisC, saiuDaCarreira: !/carreira/.test(depoisC.hash) })
  if (!/carreira/.test(depoisC.hash)) {
    await page.goForward({ waitUntil: 'commit' }).catch(() => {})
    await sleep(1000)
  }
  if (await page.locator('[role="dialog"]').count()) await page.keyboard.press('Escape')
}

// D — durante a revelação (com animação: liga as animações de novo)
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('lenda:settings'))
  s.state.settings.skipAnimations = false
  s.state.settings.reducedMotion = null
  localStorage.setItem('lenda:settings', JSON.stringify(s))
})
await page.reload()
await page.locator('.ck-opt:not(.is-locked)').first().waitFor({ timeout: 120000 })
const pD0 = (await lerKv(page, 'career:current'))?.replay?.picks?.length
await page.locator('.ck-opt:not(.is-locked):not([disabled])', { hasNotText: /Aposentar|Encerrar a carreira/ }).first().tap()
await sleep(400)
await voltar()
const depoisD = await onde()
await print(page, NOME, 'voltar-D-durante-revelacao')
const cont = page.getByRole('button', { name: /Continuar carreira/ })
if (await cont.count()) await cont.first().tap()
await page.locator('.ck-opt:not(.is-locked), .ck-end').first().waitFor({ timeout: 60000 }).catch(() => {})
log('D_durante_revelacao', { picksAntes: pD0, depois: depoisD, picksAoVoltar: (await lerKv(page, 'career:current'))?.replay?.picks?.length })

// termina a carreira rápido
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('lenda:settings'))
  s.state.settings.skipAnimations = true
  localStorage.setItem('lenda:settings', JSON.stringify(s))
})
await page.reload()
for (let k = 0; k < 40 && !(await page.locator('.ck-end').count()); k++) {
  await page.locator('.ck-opt:not(.is-locked), .ck-end').first().waitFor({ timeout: 60000 }).catch(() => {})
  if (await page.locator('.ck-end').count()) break
  await escolher()
}

// E — resumo com a folha "Sua imagem"
await page.locator('.ck-end').getByRole('button', { name: /Ver resumo/ }).tap()
await page.locator('#sm-share').waitFor({ timeout: 60000 })
await page.locator('#sm-share').scrollIntoViewIfNeeded()
await sleep(2500)
await page.locator('#sm-share').getByRole('button', { name: /^Compartilhar$/ }).tap()
await page.locator('[role="dialog"]').first().waitFor({ timeout: 20000 }).catch(() => {})
const antesE = await onde()
await print(page, NOME, 'voltar-E-sua-imagem-aberta')
await voltar()
const depoisE = await onde()
await print(page, NOME, 'voltar-E-depois')
log('E_resumo_sua_imagem', { antes: antesE, depois: depoisE, saiuDoResumo: !/resumo/.test(depoisE.hash) })

// F — Jogar novamente → identidade → voltar
await page.goto(`${URL0}#/carreira`)
await page.locator('.ck-end').waitFor({ timeout: 60000 }).catch(() => {})
await page.locator('.ck-end').getByRole('button', { name: /Jogar novamente/ }).tap()
await page.waitForFunction(() => location.hash.startsWith('#/identidade'), null, { timeout: 20000 }).catch(() => {})
await voltar()
const depoisF = await onde()
await print(page, NOME, 'voltar-F-jogar-novamente-voltar')
const textoF = ((await page.locator('main').first().textContent().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 160)
log('F_jogar_novamente_voltar', { depois: depoisF, texto: textoF })

R.erros = ap.erros
writeFileSync(`${PRINTS}/${NOME}_voltar.json`, JSON.stringify(R, null, 2))
console.log(`erros no console: ${JSON.stringify(ap.erros)}`)
await browser.close()
