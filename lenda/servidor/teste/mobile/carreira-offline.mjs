#!/usr/bin/env node
// LENDA v3.5 · suíte mobile — a internet cai no meio da carreira do Clássico (túnel, elevador, 4G oscilando).
//
//   LENDA_URL=http://127.0.0.1:9110/lenda/ node servidor/teste/mobile/carreira-offline.mjs [--aparelho galaxy-a]
//
// Começa uma carreira com rede, joga 2 decisões, DERRUBA a rede (CDP offline) e: escolhe opções, abre as abas
// Temporada/Prêmios/Mundo (código carregado sob demanda), a Sala de troféus, o Menu, termina a carreira, toca em
// "Ver resumo" e em "Compartilhar". Depois volta a rede e confere se a tela se recupera sem recarregar.
// Em cada passo: o que apareceu (texto de erro/aviso em pt-BR, tela em branco, nada) + print.
import { writeFileSync } from 'node:fs'
import { abrir, lancar, offline, print, sleep, URL0, PRINTS } from './carreira-lib.mjs'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  if (i < 0) return d
  const v = process.argv[i + 1]
  return !v || v.startsWith('--') ? true : v
}
const NOME = arg('aparelho', 'galaxy-a')
// --sem-abas: não abre as abas sem rede (para chegar ao fim da carreira e ao resumo sem a tela de erro no caminho)
const SEM_ABAS = !!arg('sem-abas', false)
const TAG = `${NOME}${SEM_ABAS ? '-sem-abas' : ''}`
const RAPIDO = JSON.stringify({ state: { settings: { sound: false, volume: 0, skipAnimations: true, reducedMotion: true, lowFx: false, engine: 'auto' } }, version: 1 })
const browser = await lancar()
const ap = await abrir(browser, NOME, { ajustes: RAPIDO })
const { page, cdp } = ap
const R = { aparelho: NOME, passos: [] }
const textoTela = async () => {
  const t = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight
    }
    const avisos = [...document.querySelectorAll('[role="alert"], [role="status"], .lx-toast, [role="dialog"]')].filter(vis).map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 160))
    const main = document.querySelector('main')
    return { avisos, hash: location.hash, mainVazio: !main || !main.textContent.trim(), corpo: document.body.innerText.replace(/\s+/g, ' ').slice(0, 200) }
  })
  return t
}
async function passo(rot, acao) {
  const e0 = ap.erros.length
  let falhou = null
  try {
    await acao()
  } catch (e) {
    falhou = String(e.message).split('\n')[0]
  }
  await sleep(2500)
  const t = await textoTela()
  const f = await print(page, TAG, `offline-${rot}`)
  const linha = { passo: rot, falhou, ...t, errosNovos: ap.erros.slice(e0).slice(0, 4), print: f }
  R.passos.push(linha)
  console.log(`  ${rot}: ${JSON.stringify({ falhou, avisos: t.avisos, hash: t.hash, mainVazio: t.mainVazio, errosNovos: linha.errosNovos.length })}`)
}

await page.goto(`${URL0}#/identidade?ritmo=normal`)
const busca = page.locator('input[placeholder="Buscar país"]')
await busca.waitFor({ timeout: 120000 })
await busca.fill('Brasil')
await busca.press('Enter')
await page.getByRole('button', { name: /^Continuar/ }).tap()
await page.locator('#id-surname').fill('SEMREDE')
await page.getByRole('button', { name: /^Continuar/ }).tap()
await page.locator('[role="radiogroup"][aria-label="Posição em campo"]').getByRole('radio', { name: 'Centroavante', exact: true }).tap()
await page.getByRole('button', { name: /^Confirmar$/ }).tap()
await page.locator('.ck-opt:not(.is-locked)').first().waitFor({ timeout: 120000 })
const escolher = async () => {
  await page.locator('.ck-opt:not(.is-locked)', { hasNotText: /Aposentar|Encerrar a carreira/ }).first().tap({ timeout: 10000 })
  await sleep(800)
  await page.locator('.ck-opt:not(.is-locked), .ck-end').first().waitFor({ timeout: 30000 })
}
await escolher()
await escolher()

await offline(cdp, true)
console.log('-- rede DERRUBADA --')
await passo('1-escolher-sem-rede', escolher)
if (!SEM_ABAS) {
  await passo('2-aba-temporada', () => page.getByRole('tab', { name: /^Temporada/ }).first().tap())
  // a tela de erro tomou o lugar da carreira? "Tentar de novo" ainda sem rede
  if (await page.getByRole('button', { name: /Tentar de novo/ }).count()) await passo('2b-tentar-de-novo-sem-rede', () => page.getByRole('button', { name: /Tentar de novo/ }).tap())
  await passo('3-aba-premios', () => page.getByRole('tab', { name: /^Prêmios/ }).first().tap({ timeout: 8000 }))
  await passo('4-aba-mundo', () => page.getByRole('tab', { name: /^Mundo/ }).first().tap({ timeout: 8000 }))
  await passo('5-aba-carreira', () => page.getByRole('tab', { name: /^Carreira/ }).first().tap({ timeout: 8000 }))
}
await passo('6-menu', async () => {
  await page.getByRole('button', { name: /^Menu$/ }).first().tap()
  await sleep(800)
})
await page.keyboard.press('Escape').catch(() => {})
await passo('7-terminar-a-carreira', async () => {
  for (let k = 0; k < 30 && !(await page.locator('.ck-end').count()); k++) await escolher()
  // o fim fica fora da tela no celular: rola até o card como a pessoa faria
  await page.locator('.ck-end').scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {})
})
await passo('8-ver-resumo', () => page.locator('.ck-end').getByRole('button', { name: /Ver resumo/ }).tap())
await passo('9-compartilhar', async () => {
  const b = page.locator('#sm-share').getByRole('button', { name: /^Compartilhar$/ })
  await b.scrollIntoViewIfNeeded({ timeout: 5000 })
  await sleep(2000)
  await b.tap({ timeout: 5000 })
  await sleep(4000)
})
await offline(cdp, false)
console.log('-- rede VOLTOU --')
await page.keyboard.press('Escape').catch(() => {})
await passo('10-rede-voltou', async () => {
  await sleep(3000)
})
if (await page.getByRole('button', { name: /Tentar de novo/ }).count())
  await passo('10b-tentar-de-novo-com-rede', async () => {
    await page.getByRole('button', { name: /Tentar de novo/ }).tap()
    await sleep(2000)
    R.recuperou = (await page.locator('.ck-panel, .ck-end, .sm-top').count()) > 0
  })
await passo('11-ver-resumo-de-novo', async () => {
  if (!(await page.locator('.sm-top').count())) {
    await page.goto(`${URL0}#/carreira`)
    await page.locator('.ck-end').getByRole('button', { name: /Ver resumo/ }).tap({ timeout: 20000 })
  }
})
R.erros = ap.erros
writeFileSync(`${PRINTS}/${TAG}_offline.json`, JSON.stringify(R, null, 2))
console.log(`erros no console (${ap.erros.length}): ${JSON.stringify([...new Set(ap.erros)].slice(0, 8))}`)
await browser.close()
