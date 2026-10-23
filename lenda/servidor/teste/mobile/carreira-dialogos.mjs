#!/usr/bin/env node
// LENDA v3.5 · suíte mobile — os diálogos da carreira do Clássico cabem e rolam no celular pequeno?
//
//   LENDA_URL=http://127.0.0.1:9110/lenda/ node servidor/teste/mobile/carreira-dialogos.mjs [--aparelho pequeno-320] [--altura 568]
//
// Com uma carreira em andamento: "Começar carreira" na Home (confirmação de nova carreira), Conquistas, Sala de
// troféus, Menu e, no resumo, "Ver imagem". Para cada um: cabe na janela? o botão principal está à vista? o conteúdo
// rola por dentro (e a página de trás não rola junto)? + print. Falha (código 1) se um diálogo não cabe, deixa o botão
// principal fora da tela, rola a página de trás, ou se houver erro no console.
import { writeFileSync } from 'node:fs'
import { abrir, lancar, medir, print, sleep, URL0, PRINTS, inesperados, placar } from './carreira-lib.mjs'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  if (i < 0) return d
  const v = process.argv[i + 1]
  return !v || v.startsWith('--') ? true : v
}
const NOME = arg('aparelho', 'pequeno-320')
const ALTURA = arg('altura', null)
const P = placar(`carreira-dialogos (${NOME}${ALTURA ? `, ${ALTURA} de altura` : ''})`)
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
    const rolaveis = [...dl.querySelectorAll('*')].filter((x) => /auto|scroll/.test(getComputedStyle(x).overflowY) && x.scrollHeight > x.clientHeight + 4)
    // um botão abaixo da dobra DENTRO de uma área que rola por dentro do diálogo (que cabe na janela) é alcançável rolando
    // (a lista do menu); fora da tela de verdade é o que não dá para alcançar (o diálogo maior que a janela, sem rolagem)
    const alcancavel = (b) => rolaveis.some((x) => x.contains(b) && x.getBoundingClientRect().bottom <= innerHeight + 1 && x.getBoundingClientRect().top >= -1)
    const bts = [...dl.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => ({ t: (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 30), top: Math.round(b.getBoundingClientRect().top), bottom: Math.round(b.getBoundingClientRect().bottom), rolando: alcancavel(b) }))
    const fora = bts.filter((b) => b.bottom > innerHeight || b.top < 0)
    // um aviso (toast) de verdade na tela não pode ficar por cima do cabeçalho do diálogo (título e Fechar)
    const cab = dl.querySelector('.lx-dialog__head')?.getBoundingClientRect()
    const avisos = [...document.querySelectorAll('.lx-toast')].map((e) => e.getBoundingClientRect()).filter((x) => x.height > 0)
    const avisoNoCabecalho = !!cab && avisos.some((x) => x.top < cab.bottom - 2 && x.bottom > cab.top + 2 && x.left < cab.right && x.right > cab.left)
    return { avisos: avisos.length, avisoNoCabecalho, topo: Math.round(r.top), base: Math.round(r.bottom), janela: innerHeight, cabe: r.top >= -1 && r.bottom <= innerHeight + 1, rolaPorDentro: rolaveis.length > 0, botoesForaDaTela: fora.filter((b) => !b.rolando).map((b) => b.t), abaixoRolando: fora.filter((b) => b.rolando).length, botoes: bts.length }
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
  P.ok(!!d && d.cabe && !d.botoesForaDaTela.length, `${rot}: o diálogo cabe na janela e os botões estão à vista (ou rolando por dentro)`, d ? { topo: d.topo, base: d.base, janela: d.janela, fora: d.botoesForaDaTela, abaixoRolando: d.abaixoRolando } : 'não abriu')
  P.ok(!linha.paginaRolouAtras, `${rot}: a página de trás não rola junto com o diálogo`)
  if (d?.avisos) P.ok(!d.avisoNoCabecalho, `${rot}: o aviso na tela (${d.avisos}) não cobre o cabeçalho nem o Fechar do diálogo`)
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
  // o "Ver todas" (sala de troféus) fica atrás do sheet da decisão: primeiro recolhe o sheet, como a pessoa faria
  await page.locator('.ck-sheet__peek[aria-expanded="true"]').tap().catch(() => {})
  await sleep(600)
  await verTodas.scrollIntoViewIfNeeded()
  await verTodas.tap()
  await dialogo('sala-de-trofeus')
}
await page.getByRole('button', { name: /^Menu$/ }).first().tap()
await dialogo('menu')
// Conquistas: pelo menu (o diálogo do menu fechou com o Esc acima)
await page.getByRole('button', { name: /^Menu$/ }).first().tap()
await sleep(600)
const conq = page.locator('[role="dialog"]').getByRole('button', { name: /^Conquistas/ }).first()
if (await conq.count()) {
  await conq.scrollIntoViewIfNeeded()
  await conq.tap()
  await dialogo('conquistas')
} else P.ok(false, 'conquistas: o menu tem o botão "Conquistas"')
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
P.ok(!inesperados([...ap.erros, ...ap.s5xx]).length, 'sem erro no console nem 5xx', inesperados([...ap.erros, ...ap.s5xx]).slice(0, 5))
await browser.close()
P.fim()
