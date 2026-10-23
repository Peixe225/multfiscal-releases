#!/usr/bin/env node
// LENDA v3.5 · suíte mobile — o que trava o celular ao abrir/recarregar a carreira do Clássico.
//
//   LENDA_URL=http://127.0.0.1:9110/lenda/ node servidor/teste/mobile/carreira-perfil-boot.mjs [--aparelho galaxy-a] [--lento]
//
// Cria uma carreira pela tela (assistente do celular), depois recarrega a página em #/carreira com o Profiler do CDP
// ligado e mede: tempo até a 1ª decisão ficar tocável, tarefas longas (> 50 ms) e as funções que mais gastaram CPU
// (tempo próprio, agrupado por função e arquivo). Repete na Home (#/) e no resumo de uma carreira terminada não.
import { abrir, lancar, sleep, URL0 } from './carreira-lib.mjs'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  if (i < 0) return d
  const v = process.argv[i + 1]
  return !v || v.startsWith('--') ? true : v
}
const NOME = arg('aparelho', 'galaxy-a')
const LENTO = !!arg('lento', false)
const browser = await lancar()
const ap = await abrir(browser, NOME, { lento: false })
const { page, cdp } = ap

// uma carreira começada, pelo assistente
await page.goto(`${URL0}#/identidade?ritmo=expressa`)
await page.locator('input[placeholder="Buscar país"]').waitFor({ timeout: 120000 })
await page.locator('input[placeholder="Buscar país"]').fill('Brasil')
await page.locator('input[placeholder="Buscar país"]').press('Enter')
await page.getByRole('button', { name: /^Continuar/ }).tap()
await page.locator('#id-surname').fill('PERFIL')
await page.getByRole('button', { name: /^Continuar/ }).tap()
await page.locator('[role="radiogroup"][aria-label="Posição em campo"]').getByRole('radio', { name: 'Centroavante', exact: true }).tap()
await page.getByRole('button', { name: /^Confirmar$/ }).tap()
await page.locator('.ck-opt:not(.is-locked)').first().waitFor({ timeout: 120000 })
console.log('carreira criada')

if (LENTO) {
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750 })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
}

async function perfil(rot, acao, pronto) {
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 })
  await cdp.send('Profiler.start')
  const t0 = Date.now()
  await acao()
  await pronto()
  const ms = Date.now() - t0
  const { profile } = await cdp.send('Profiler.stop')
  // tempo próprio por nó = amostras × intervalo
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  const self = new Map()
  const dt = profile.timeDeltas
  for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + (dt[i] ?? 0))
  const agg = new Map()
  for (const [id, us] of self) {
    const cf = byId.get(id).callFrame
    const k = `${cf.functionName || '(anônima)'} @ ${cf.url.split('/').pop() || cf.url || '(nativo)'}:${cf.lineNumber + 1}`
    agg.set(k, (agg.get(k) ?? 0) + us)
  }
  const porArquivo = new Map()
  for (const [id, us] of self) {
    const cf = byId.get(id).callFrame
    const k = cf.url.split('/').pop() || `(${cf.functionName || 'nativo'})`
    porArquivo.set(k, (porArquivo.get(k) ?? 0) + us)
  }
  const longas = await page.evaluate(() => (window.__longas ?? []).map((l) => l.d)).catch(() => [])
  console.log(`\n== ${rot}: ${ms} ms até pronto · tarefas longas: ${longas.length} (maior ${Math.max(0, ...longas)} ms, soma ${longas.reduce((a, b) => a + b, 0)} ms)`)
  console.log('  por arquivo (ms de CPU):', [...porArquivo].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${Math.round(v / 1000)}`).join(' · '))
  for (const [k, v] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`   ${String(Math.round(v / 1000)).padStart(6)} ms  ${k}`)
  return { ms, longas }
}

await perfil(
  `recarregar em #/carreira (${NOME}${LENTO ? ', 4G lento + CPU 4×' : ''})`,
  () => page.reload({ waitUntil: 'commit' }),
  () => page.locator('.ck-opt:not(.is-locked)').first().waitFor({ timeout: 300000 }),
)
await sleep(3000)
// recarregar logo depois de escolher (no meio da revelação): é quando a pessoa fecha/recarrega sem esperar
for (let k = 0; k < 2; k++) {
  await page.locator('.ck-opt:not(.is-locked)').first().waitFor({ timeout: 300000 })
  await page.locator('.ck-opt:not(.is-locked)').first().tap()
  await page.locator('.ck-sheet.is-collapsed, .ck-skip').first().waitFor({ timeout: 60000 }).catch(() => {})
  await perfil(
    `recarregar NO MEIO da revelação (${k + 1})`,
    () => page.reload({ waitUntil: 'commit' }),
    () => page.locator('.ck-opt:not(.is-locked), .ck-end').first().waitFor({ timeout: 300000 }),
  )
  await sleep(6000)
  const l = await page.evaluate(() => (window.__longas ?? []).map((x) => `${x.t}:${x.d}`))
  console.log('  tarefas longas até 6 s depois:', l.join(' '))
}
await perfil(
  'abrir a Home (#/) do zero',
  () => page.goto(`${URL0}#/`, { waitUntil: 'commit' }).then(() => page.reload({ waitUntil: 'commit' })),
  () => page.locator('.ld-ctas__start').waitFor({ timeout: 300000 }),
)
await sleep(4000)
const l2 = await page.evaluate(() => (window.__longas ?? []).map((l) => `${l.t}:${l.d}`))
console.log('  tarefas longas na Home até 4 s depois:', l2.join(' '))

// o toque numa opção (o motor simula a temporada na thread principal): CPU 4× como num celular intermediário
await page.goto(`${URL0}#/carreira`)
await page.locator('.ck-opt:not(.is-locked)').first().waitFor({ timeout: 120000 })
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
for (let k = 0; k < 3; k++) {
  await page.locator('.ck-opt:not(.is-locked)').first().waitFor({ timeout: 300000 })
  await sleep(1500)
  const opt = page.locator('.ck-opt:not(.is-locked)', { hasNotText: /Aposentar/ }).first()
  await perfil(
    `tocar numa opção → começar a revelação (CPU 4×, decisão ${k + 1})`,
    () => opt.tap(),
    () => page.locator('.ck-sheet.is-collapsed, .ck-skip').first().waitFor({ timeout: 120000 }),
  )
}
await browser.close()
