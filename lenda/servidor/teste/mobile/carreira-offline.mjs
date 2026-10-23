#!/usr/bin/env node
// LENDA v3.5 · suíte mobile — a internet cai no meio da carreira do Clássico (túnel, elevador, 4G oscilando).
//
//   LENDA_URL=http://127.0.0.1:9110/lenda/ node servidor/teste/mobile/carreira-offline.mjs [--aparelho galaxy-a]
//
// Começa uma carreira com rede, joga 2 decisões, DERRUBA a rede (CDP offline) e: escolhe opções, abre as abas
// Temporada/Prêmios/Mundo (código carregado sob demanda), a Sala de troféus, o Menu, termina a carreira, toca em
// "Ver resumo" e em "Compartilhar". Depois volta a rede e confere se a tela se recupera sem recarregar.
// Em cada passo: o que apareceu (texto de erro/aviso em pt-BR, tela em branco, nada) + print.
// Falha (código 1) se a carreira some (tela de erro no lugar dela, tela vazia, texto técnico em inglês), se escolher sem
// rede não funciona, se o resumo não abre (o motor é local: com o pré-carregamento, dá para terminar e ver o resumo sem
// internet) ou se a tela não se recupera quando a rede volta.
import { writeFileSync } from 'node:fs'
import { abrir, lancar, offline, print, sleep, URL0, PRINTS, inesperados, placar } from './carreira-lib.mjs'

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
const P = placar(`carreira-offline (${TAG})`)
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
    // a tela da carreira tem <main>; o resumo (#/resumo) não tem: aí vale o conteúdo visível do #root
    const main = document.querySelector('main') ?? document.querySelector('#root')
    return { avisos, hash: location.hash, mainVazio: !main || !main.textContent.trim() || !vis(main), corpo: document.body.innerText.replace(/\s+/g, ' ').slice(0, 200) }
  })
  return t
}
// texto técnico/da tela de erro que nunca pode aparecer para a pessoa
const TECNICO = /Algo deu errado nesta tela|Failed to fetch|dynamically imported module|Unable to preload|Importing a module script failed|ChunkLoadError/i
async function passo(rot, acao, o = {}) {
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
  console.log(`  ..  ${rot}: ${JSON.stringify({ falhou, avisos: t.avisos, hash: t.hash, mainVazio: t.mainVazio, errosNovos: linha.errosNovos.length })}`)
  const tecnico = TECNICO.test(`${t.corpo} ${t.avisos.join(' ')}`)
  P.ok(!falhou && !t.mainVazio && !tecnico, `${rot}: a tela continua de pé${o.oque ? ` (${o.oque})` : ''}`, falhou ? `falhou: ${falhou}` : tecnico ? `texto técnico/tela de erro: ${t.corpo.slice(0, 120)}` : t.mainVazio ? 'tela vazia' : undefined)
  if (o.depois) await o.depois(t)
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
  const abaAbriu = (rot) => async () => P.ok((await page.locator('.ck-panel [role="tabpanel"]:not([hidden])').count()) > 0, `${rot}: abriu a aba (ou o aviso dela) sem derrubar a carreira`)
  await passo('2-aba-temporada', () => page.getByRole('tab', { name: /^Temporada/ }).first().tap(), { depois: abaAbriu('aba Temporada sem rede') })
  // a tela de erro tomou o lugar da carreira? "Tentar de novo" ainda sem rede
  if (await page.getByRole('button', { name: /Tentar de novo/ }).count()) await passo('2b-tentar-de-novo-sem-rede', () => page.getByRole('button', { name: /Tentar de novo/ }).tap())
  await passo('3-aba-premios', () => page.getByRole('tab', { name: /^Prêmios/ }).first().tap({ timeout: 8000 }), { depois: abaAbriu('aba Prêmios sem rede') })
  await passo('4-aba-mundo', () => page.getByRole('tab', { name: /^Mundo/ }).first().tap({ timeout: 8000 }), { depois: abaAbriu('aba Mundo sem rede') })
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
P.ok((await page.locator('.ck-end').count()) > 0, 'sem rede, a carreira chega ao fim (o motor é local)')
await passo('8-ver-resumo', () => page.locator('.ck-end').getByRole('button', { name: /Ver resumo/ }).tap(), {
  depois: async () => P.ok((await page.locator('.sm-top').count()) > 0 || /Sem conexão/.test(await page.locator('.ck-end').textContent().catch(() => '')), '"Ver resumo" sem rede abre o resumo (pré-carregado) ou avisa "Sem conexão" no próprio cartão'),
})
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
P.ok((await page.locator('.sm-top').count()) > 0, 'com a rede de volta, o resumo abre sem recarregar a página')
R.erros = ap.erros
writeFileSync(`${PRINTS}/${TAG}_offline.json`, JSON.stringify(R, null, 2))
// sem rede, os pedidos que falham (e o aviso deles no console) são esperados; o que não pode é erro de JavaScript
const js = inesperados(ap.erros.filter((e) => /^pageerror/.test(e) || /Uncaught|TypeError|ReferenceError/.test(e)))
P.ok(!js.length, 'sem erro de JavaScript (pageerror) com a rede caindo e voltando', js.slice(0, 5))
await browser.close()
P.fim()
