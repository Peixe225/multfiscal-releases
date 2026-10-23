#!/usr/bin/env node
// LENDA v3.5 · suíte mobile · TOQUE — confirmações com o dedo do que o toque-rotas.mjs mediu (pilha local ou produção).
//
//   LENDA_INTEG_BASE=/tmp/lenda-v35-toque node servidor/teste/mobile/toque-verificar.mjs [--aparelho galaxy-a] [--alvo prod]
//
// 1. campo de texto: tocar na borda de cima da caixa (o .lx-input tem 46 px, o <input> dentro dele ~23 px) foca o campo?
//    (Entrar, Buscar país da identidade, busca de país/clube do Hall)
// 2. linha da comunidade no Hall: tocar no meio da linha abre o resumo (o esperado) ou o perfil do dono?
// 3. switch do menu: tocar na descrição ("Efeitos sonoros sintetizados") liga/desliga?
// 4. a faixa dos avisos (toasts: conquista, emblema, erro) × o cabeçalho dos diálogos no celular: geometria
// 5. pontos dos desafios na Home: 40×40 com 8 px de vão (v3.5; antes 24×28 com 2 px) — o toque no vão abre o vizinho?
// Prints em <LENDA_PRINTS>/toque/verificar/ (ou $LENDA_PRINTS_TOQUE/verificar/). Na produção só lê (nada de POST, sem
// medição de visita, sem conta). Sai com código 1 se alguma confirmação falhou.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { abrirT, lancarT, sleep, PRINTS } from './toque-lib.mjs'
import { abrirEsperando } from './aparelhos.mjs'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i < 0 ? d : process.argv[i + 1]
}
const PROD = arg('alvo', 'local') === 'prod'
const BASE = process.env.LENDA_INTEG_BASE ?? '/tmp/lenda-v35-toque'
const ENV = !PROD && existsSync(`${BASE}/segredos.env`) ? Object.fromEntries(readFileSync(`${BASE}/segredos.env`, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const URL0 = PROD ? 'https://oprojeto.online/lenda/' : `http://127.0.0.1:${ENV.PORTA ?? 9150}/lenda/`
const SEM = !PROD && existsSync(`${BASE}/hall-semente.json`) ? JSON.parse(readFileSync(`${BASE}/hall-semente.json`, 'utf8')) : null
const AP = arg('aparelho', 'galaxy-a')
const DIR = `${PRINTS}/verificar`
mkdirSync(DIR, { recursive: true })
const R = []
const nota = (ok, area, msg, extra = {}) => {
  console.log(`  ${ok ? 'ok' : 'XX'}  ${area}: ${msg}`)
  R.push({ ok, area, msg, ...extra })
}

const browser = await lancarT()
const d = await abrirT(browser, AP, { prod: PROD, hall: SEM?.entradas })
const { page } = d
const pr = async (n) => {
  const f = `${DIR}/${AP}${PROD ? '-prod' : ''}_${n}.png`
  await page.screenshot({ path: f }).catch(() => {})
  return f
}
const fechar = async () => {
  for (let i = 0; i < 3 && (await page.locator('[role="dialog"]:visible').count()); i++) {
    await page.keyboard.press('Escape')
    await sleep(500)
  }
}
const ir = async (h, sel) => {
  await page.evaluate((h) => (location.hash = h), h)
  if (sel) await page.locator(sel).first().waitFor({ state: 'visible', timeout: 60000 })
  await sleep(900)
}
/** toca a 4 px da borda de cima da caixa visível do campo (fora do <input>) e diz se o campo ganhou foco */
async function bordaDoCampo(area, input, caixaSel) {
  const info = await input.evaluate((el, caixaSel) => {
    const caixa = (caixaSel && el.closest(caixaSel)) || el.parentElement
    const ri = el.getBoundingClientRect()
    const rc = caixa.getBoundingClientRect()
    return { ri: { y: ri.top, h: ri.height }, rc: { x: rc.left, y: rc.top, w: rc.width, h: rc.height }, fonte: parseFloat(getComputedStyle(el).fontSize), caixa: caixa.className }
  }, caixaSel)
  await page.evaluate(() => document.activeElement?.blur?.())
  const x = info.rc.x + Math.min(40, info.rc.w / 3)
  const y = info.rc.y + 4
  await page.touchscreen.tap(x, y)
  await sleep(350)
  const focou = await input.evaluate((el) => document.activeElement === el)
  const f = await pr(`campo-${area}`)
  nota(focou, `campo ${area}`, `caixa ${Math.round(info.rc.w)}×${Math.round(info.rc.h)} px, <input> ${Math.round(info.ri.h)} px de altura, fonte ${info.fonte}px; toque a 4 px da borda de cima da caixa ${focou ? 'foca o campo' : 'NÃO foca o campo (o toque cai no invólucro)'}`, { print: f, ...info })
  await page.evaluate(() => document.activeElement?.blur?.())
}
const passo = async (nome, fn) => {
  try {
    await fn()
  } catch (e) {
    nota(false, nome, `não deu para conferir: ${String(e.message).split('\n')[0]}`, { print: await pr(`${nome}-FALHOU`) })
    await fechar().catch(() => {})
  }
}

await abrirEsperando(page, URL0, '.ld-ctas__start', { prod: PROD })
await sleep(1500)

// 5. pontos dos desafios
await passo('pontos-desafios', async () => {
  const pts = page.locator('.s4-faixa__d')
  await pts.nth(1).waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
  await sleep(600)
  if ((await pts.count()) < 2) return nota(true, 'pontos dos desafios', 'menos de dois pontos na faixa')
  const b0 = await pts.nth(0).boundingBox()
  const b1 = await pts.nth(1).boundingBox()
  const gap = Math.round(b1.x - (b0.x + b0.width))
  await page.touchscreen.tap(b0.x + b0.width + gap / 2, b0.y + b0.height / 2)
  await sleep(900)
  const hash = await page.evaluate(() => location.hash)
  const dlg = await page.locator('[role="dialog"]:visible').count()
  const f = await pr('desafios-pontos-toque-no-vao')
  // v3.5: o certo é 40×40 com ≥ 8 px de vão e o toque no vão não abrir o desafio vizinho (fica na Home, sem diálogo)
  const bom = b0.width >= 40 && b0.height >= 40 && gap >= 8 && (!hash || hash === '#/') && !dlg
  nota(bom, 'pontos dos desafios', `${Math.round(b0.width)}×${Math.round(b0.height)} px com ${gap} px entre eles; tocando no meio do vão foi para ${hash || '#/'}${dlg ? ' (abriu diálogo)' : ''}`, { print: f })
  await fechar()
  await ir('#/', '.ld-ctas__start')
})

// 1. campo do Entrar
await passo('campo-entrar', async () => {
  await page.locator('button[aria-label="Menu"]').first().tap()
  await sleep(900)
  await page.locator('[role="dialog"] button').filter({ hasText: /Entrar/ }).first().tap()
  await sleep(1300)
  const email = page.locator('[role="dialog"] input[type="email"], [role="dialog"] input[autocomplete="email"]').first()
  if (await email.count()) await bordaDoCampo('entrar-email', email, '.lx-input')
  else nota(false, 'campo entrar-email', 'campo de e-mail não encontrado')
  await fechar()
})

// 3. switch: tocar na descrição
await passo('switch-som', async () => {
  await page.locator('button[aria-label="Menu"]').first().tap()
  await sleep(900)
  const desc = page.locator('[role="dialog"]').getByText('Efeitos sonoros sintetizados').first()
  const sw = page.locator('[role="dialog"] [role="switch"]').first()
  await desc.scrollIntoViewIfNeeded()
  const antes = await sw.getAttribute('aria-checked')
  await desc.tap()
  await sleep(400)
  const depois = await sw.getAttribute('aria-checked')
  const swb = await sw.boundingBox()
  const f = await pr('menu-switch-toque-na-descricao')
  nota(antes !== depois, 'switch Som', `o interruptor tem ${Math.round(swb.width)}×${Math.round(swb.height)} px; tocar na descrição "Efeitos sonoros sintetizados" ${antes !== depois ? 'liga/desliga' : 'não faz nada (só o rótulo de 20 px de altura e o interruptor de 28 px respondem)'}`, { print: f })
  if (antes !== depois) await desc.tap()
  await fechar()
})

// 4. a faixa dos avisos × o cabeçalho do sheet
await passo('avisos-cabecalho', async () => {
  await page.locator('button[aria-label="Menu"]').first().tap()
  await sleep(900)
  const fb = await page.locator('[role="dialog"] button[aria-label="Fechar"]').first().boundingBox()
  // v3.5: com um diálogo aberto, o Toaster (Toast.tsx) põe o aviso abaixo do cabeçalho dele — a posição de repouso do
  // .lx-toaster vazio (y=64) não diz nada. Confere o aviso DE VERDADE, se houver um na tela; sem aviso, só registra (o
  // carreira-dialogos.mjs confere com os avisos de conquista que aparecem durante a carreira).
  const g = await page.evaluate(() => {
    const dl = document.querySelector('[role="dialog"]')
    const ts = [...document.querySelectorAll('.lx-toast')].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0)
    return { dialogo: dl ? Math.round(dl.getBoundingClientRect().top) : null, avisos: ts.map((r) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom) })) }
  })
  const f = await pr('menu-cabecalho-e-faixa-dos-avisos')
  const cobre = !!fb && g.avisos.some((r) => r.top < fb.y + fb.height && r.bottom > fb.y)
  nota(!cobre, 'avisos × cabeçalho do diálogo', g.avisos.length ? `aviso em y=${g.avisos.map((r) => `${r.top}–${r.bottom}`).join(', ')}; o "Fechar" do sheet ocupa y=${fb ? Math.round(fb.y) : '?'}–${fb ? Math.round(fb.y + fb.height) : '?'}px${cobre ? ' → o aviso cobre o "Fechar"' : ''}` : `nenhum aviso na tela neste passo (o sheet começa em y=${g.dialogo}px; com diálogo aberto o aviso desce para baixo do cabeçalho — conferido no carreira-dialogos)`, { print: f })
  await fechar()
})

// identidade: Buscar país
if (!PROD)
  await passo('campo-buscar-pais', async () => {
    await page.locator('.ld-ctas__start').tap()
    await page.locator('input[placeholder="Buscar país"]').waitFor({ state: 'visible', timeout: 60000 })
    await sleep(800)
    await bordaDoCampo('identidade-buscar-pais', page.locator('input[placeholder="Buscar país"]'), '.lx-input, .id-search, label')
    await ir('#/', '.ld-ctas__start')
  })

// Hall: busca de clube/país (fonte 14 px)
await passo('campo-hall', async () => {
  await ir('#/hall', '.hl-filtros')
  const busca = page.locator('.hl-fsearch input').first()
  if (await busca.count()) {
    await busca.scrollIntoViewIfNeeded()
    await bordaDoCampo('hall-busca', busca, '.hl-fsearch')
  }
})

// 2. linha da comunidade
await passo('linha-comunidade', async () => {
  await ir('#/hall?seg=comunidade', '.hl-filtros')
  const row = page.locator('.hl-row.is-com').first()
  await row.waitFor({ state: 'visible', timeout: 20000 })
  await row.scrollIntoViewIfNeeded()
  await sleep(500)
  const b = await row.boundingBox()
  const meio = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return el ? `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}` : null
    },
    { x: b.x + b.width / 2, y: b.y + b.height / 2 },
  )
  const f0 = await pr('hall-comunidade-linha')
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
  await sleep(1500)
  const hash = await page.evaluate(() => location.hash)
  const f = await pr('hall-comunidade-linha-depois-do-toque')
  nota(hash.startsWith('#/resumo'), 'linha da comunidade', `tocar no meio da linha (${Math.round(b.width)}×${Math.round(b.height)} px; no ponto está ${meio}) foi para ${hash}`, { print: f, antes: f0 })
})

writeFileSync(`${DIR}/${AP}${PROD ? '-prod' : ''}.json`, JSON.stringify(R, null, 1))
if (d.bloqueados?.length) console.log(`  ..  produção: ${d.bloqueados.length} pedido(s) que escreveriam foram bloqueados`)
await browser.close()
const ruins = R.filter((x) => !x.ok)
console.log(`\ntoque-verificar (${AP}${PROD ? ', produção' : ''}): ${R.length - ruins.length} ok · ${ruins.length} falha(s)`)
for (const x of ruins) console.log(`   XX ${x.area}: ${x.msg}`)
process.exitCode = ruins.length ? 1 : 0
