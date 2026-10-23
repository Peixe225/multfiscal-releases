// LENDA v3.5 · suíte mobile · a rede cai (túnel, metrô, 4G fraco) no meio da visita e a pessoa abre uma tela da área
// Hall/Desafios/Conquistas que ainda não tinha sido baixada nesta visita. O que ela vê? E quando a rede volta, o
// "Tentar de novo" resolve, ou a tela fica quebrada até recarregar a página?
//
//   LENDA_INTEG_BASE=/tmp/lenda-v35-hall node servidor/teste/mobile/hall-rede.mjs [--aparelho galaxy-a]
//   node servidor/teste/mobile/hall-rede.mjs --alvo prod        (produção: só leitura)
import { existsSync, readFileSync } from 'node:fs'
import { abrirH, lancar, nota, offline, print, salvarRelatorio, sleep } from './hall-lib.mjs'

const arg = (k, def) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : def
}
const PROD = arg('alvo', 'local') === 'prod'
const BASE = process.env.LENDA_INTEG_BASE ?? '/tmp/lenda-v35-hall'
const env = !PROD ? Object.fromEntries(readFileSync(`${BASE}/segredos.env`, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const URL0 = PROD ? 'https://oprojeto.online/lenda/' : `http://127.0.0.1:${env.PORTA}/lenda/`
const SEM = !PROD && existsSync(`${BASE}/hall-semente.json`) ? JSON.parse(readFileSync(`${BASE}/hall-semente.json`, 'utf8')) : null
const APARELHO = arg('aparelho', 'galaxy-a')
const TELAS = [
  ['desafios', '#/desafios'],
  ['hall', '#/hall'],
  ['ligas', '#/ligas'],
  ['creditos', '#/creditos'],
  ['perfil', `#/jogador/${SEM?.codigo ?? arg('perfil', 'ZZZZ9999')}`],
]
const texto = (d) => d.page.evaluate(() => (document.querySelector('main')?.innerText ?? document.body.innerText).replace(/\s+/g, ' ').trim().slice(0, 170)).catch(() => '')
const quebrada = (t) => /Algo deu errado|dynamically imported|preload CSS|Importing a module/i.test(t)
const browser = await lancar()
for (const [nome, h] of TELAS) {
  const d = await abrirH(browser, APARELHO, { prod: PROD })
  await d.page.goto(`${URL0}#/`)
  await d.page.waitForSelector('.ld-modes', { timeout: 60000 })
  await sleep(2500)
  await offline(d.cdp, true)
  await d.page.evaluate((h) => (location.hash = h), h)
  await sleep(3500)
  const t1 = await texto(d)
  const ingles = /Failed to fetch|Unable to preload|dynamically imported|Importing a module/i.test(t1)
  nota(d, `${nome} sem rede`, !quebrada(t1) || !ingles, `abrir ${h} sem rede: "${t1.slice(0, 150)}"${ingles ? ' (mensagem técnica em inglês)' : ''}`)
  await print(d, `rede-${nome}-1-sem-rede`)
  await offline(d.cdp, false)
  await sleep(1200)
  const tentar = d.page.getByRole('button', { name: /Tentar de novo/ }).first()
  if (await tentar.count()) {
    await tentar.tap()
    await sleep(3500)
    const t2 = await texto(d)
    nota(d, `${nome} rede voltou`, !quebrada(t2), `a rede voltou e "Tentar de novo": ${quebrada(t2) ? `CONTINUA quebrada ("${t2.slice(0, 100)}")` : 'a tela abriu'}`)
    await print(d, `rede-${nome}-2-tentar-de-novo`)
  }
  // sai e volta (sem recarregar a página)
  await d.page.evaluate(() => (location.hash = '#/'))
  await sleep(1500)
  await d.page.evaluate((h) => (location.hash = h), h)
  await sleep(3500)
  const t3 = await texto(d)
  nota(d, `${nome} sair e voltar`, !quebrada(t3), `ir ao início e voltar a ${h} (com rede, sem recarregar): ${quebrada(t3) ? 'CONTINUA quebrada até recarregar a página' : 'abre'}`)
  await print(d, `rede-${nome}-3-sair-e-voltar`)
  await d.ctx.close()
}
// o diálogo das conquistas (chunk próprio, montado FORA do ErrorBoundary da tela) com a rede caída
{
  const d = await abrirH(browser, APARELHO, { prod: PROD })
  await d.page.goto(`${URL0}#/`)
  await d.page.waitForSelector('.ld-modes', { timeout: 60000 })
  await sleep(2500)
  await offline(d.cdp, true)
  await d.page.locator('.ld-medal, button[aria-label^="Ver conquistas"]').first().tap()
  await sleep(4000)
  const r = await d.page.evaluate(() => ({ root: document.getElementById('root')?.innerHTML.length ?? 0, dialogo: document.querySelectorAll('[role="dialog"]').length }))
  nota(d, 'conquistas sem rede', r.root > 0, r.root > 0 ? `tocar em conquistas sem rede: a página continua (${r.dialogo ? 'abriu o diálogo' : 'não abriu'})` : 'tocar em conquistas sem rede APAGA o jogo inteiro (#root vazio, tela preta)')
  await print(d, 'rede-conquistas-1-sem-rede')
  await offline(d.cdp, false)
  await sleep(3000)
  const r2 = await d.page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? 0)
  nota(d, 'conquistas rede voltou', r2 > 0, r2 > 0 ? 'com a rede de volta a página está viva' : 'com a rede de volta continua a tela preta (só recarregando)')
  await print(d, 'rede-conquistas-2-rede-voltou')
  await d.ctx.close()
}
salvarRelatorio(`relatorio-rede-${PROD ? 'prod' : 'local'}-${APARELHO}`)
await browser.close()
