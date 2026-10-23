// LENDA v3.5 · painel no celular — 4. O QUE SÓ EXISTE NO COMPUTADOR? recado da equipe (o × e o aviso), modo discreto,
// "Abrir o jogo", estado do site, o topo do editor de desafio; e o painel aberto pelo navegador de dentro do WhatsApp
// e do Instagram (entrar, abrir a ficha).
//   LENDA_PAINEL_BASE=<pasta da pilha> node servidor/teste/mobile/painel-extras.mjs
// Precisa das sessões que o painel-entrada.mjs grava (estado-dono.json e estado-moderadora.json). Só pilha local.
import { readFileSync } from 'node:fs'
import { BASE, PAINEL, PIN_DONO, abrir, entrar, env, esperarDecisao, esperarPulso, irAba, lancar, medir, print, relatar, sleep } from './painel-lib.mjs'

const DONO = JSON.parse(readFileSync(`${BASE}/estado-dono.json`, 'utf8'))
const MOD = JSON.parse(readFileSync(`${BASE}/estado-moderadora.json`, 'utf8'))
const achados = []
const ok = (c, txt) => { console.log(`  ${c ? 'ok' : '!!'}  ${txt}`); if (!c) achados.push(txt); return c }
const browser = await lancar()
const aba = '.aba:not([hidden])'

// ── recado do Dono chegando no celular da moderadora (320) ──
{
  const mod = await abrir(browser, 'pequeno-320', { estado: MOD })
  await mod.page.goto(PAINEL + '#/hall')
  await esperarDecisao(mod.page)
  await esperarPulso(mod.page)
  await sleep(1000)
  const dono0 = await abrir(browser, 'galaxy-a', { estado: DONO })
  await dono0.page.goto(PAINEL + '#/visao')
  await esperarDecisao(dono0.page)
  const r = await dono0.page.evaluate(() => window.LP.equipePost({ acao: 'recado_criar', titulo: 'Live hoje às 20h', texto: 'Fiquem de olho nas denúncias durante a live: muita gente nova entrando.', tom: 'urgente' }).then((x) => x, (e) => ({ erro: String(e && e.message) })))
  console.log(`      recado criado pelo Dono: ${JSON.stringify(r)}`)
  await dono0.ctx.close()
  const veio = await mod.page.waitForSelector('#recados .recado', { timeout: 40000 }).then(() => true).catch(() => false)
  ok(veio, 'o recado do Dono aparece no celular da moderadora (pulso de 15 s)')
  if (veio) {
    await sleep(600)
    const x = await mod.page.evaluate(() => { const b = document.querySelector('#recados .recado-fechar, #recados .recado-ciente'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), rot: b.getAttribute('aria-label') || b.textContent } })
    ok(x && x.w >= 40 && x.h >= 40, `o × do recado tem 40 px ou mais (${JSON.stringify(x)})`)
    const nv = await mod.page.evaluate(() => { const n = document.getElementById('novidade'); return n.hidden ? null : n.textContent })
    const pos = await mod.page.evaluate(() => { const r = document.getElementById('recados').getBoundingClientRect(); return { top: Math.round(r.top + scrollY), janela: innerHeight } })
    console.log(`      aviso de novidade: ${JSON.stringify(nv)} · o recado fica em y=${pos.top} (janela ${pos.janela})`)
    await print(mod.page, 'pequeno-320', 'recado-aviso-de-novidade')
    if (nv) {
      await mod.page.locator('#novidade .novidade-botao').first().tap()
      await sleep(1200)
      const vis = await mod.page.evaluate(() => { const r = document.querySelector('#recados .recado').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), janela: innerHeight } })
      ok(vis.top >= 0 && vis.top < vis.janela, `tocar no aviso do recado rola até ele (${JSON.stringify(vis)})`)
    }
    await mod.page.evaluate(() => document.getElementById('recados').scrollIntoView({ block: 'center' }))
    await sleep(300)
    await print(mod.page, 'pequeno-320', 'recado-da-equipe')
  }
  await mod.ctx.close()
}
{
  const dono = await abrir(browser, 'galaxy-a', { estado: DONO })
  await dono.page.goto(PAINEL + '#/hall')
  await esperarDecisao(dono.page)
  await esperarPulso(dono.page)
  await sleep(800)
  // ── o que no computador fica no pé da lateral: no celular (v3.5) está no menu "⋯" do topo ──
  await dono.page.locator('.botoes-topo-celular [data-acao="menu"]').tap()
  await dono.page.waitForSelector('dialog[open] .menu-celular', { timeout: 10000 })
  await sleep(500)
  const so = await dono.page.evaluate(() => {
    const visivel = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' }
    const m = document.querySelector('dialog[open] .menu-celular')
    return {
      discreto: visivel(m?.querySelector('input[role="switch"]')),
      abrirJogo: visivel(m?.querySelector('a[href="../"]')),
      estadoSite: visivel(m?.querySelector('.menu-estado')),
      chipsEstado: [...(m?.querySelectorAll('.menu-estado .chip') ?? [])].map((c) => c.textContent),
      tema: visivel(m?.querySelector('[data-valor="claro"]')),
      sair: [...(m?.querySelectorAll('button') ?? [])].some((b) => /Sair do painel/.test(b.textContent) && visivel(b)),
    }
  })
  console.log(`      no celular (menu ⋯): ${JSON.stringify(so)}`)
  await print(dono.page, 'galaxy-a', 'menu-celular')
  ok(so.discreto, 'o menu ⋯ tem o interruptor do modo discreto')
  ok(so.abrirJogo, 'o menu ⋯ tem o link "Abrir o jogo"')
  ok(so.estadoSite, `o menu ⋯ mostra o estado do site (${so.chipsEstado.join(' · ')})`)
  ok(so.tema && so.sair, 'o menu ⋯ tem a Aparência e o "Sair do painel"')
  // Sair pergunta antes (entrar de novo pede senha e PIN)
  await dono.page.locator('dialog[open] .menu-celular button', { hasText: 'Sair do painel' }).tap()
  await sleep(600)
  const pergunta = await dono.page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map((d) => d.textContent.replace(/\s+/g, ' ').slice(0, 80)).join(' | '))
  ok(/Sair do painel\?/.test(pergunta), `"Sair do painel" pergunta antes de sair (${pergunta.slice(0, 80)})`)
  for (let i = 0; i < 3 && (await dono.page.locator('dialog[open]').count()); i++) {
    await dono.page.keyboard.press('Escape')
    await sleep(400)
  }
  ok(await dono.page.isVisible('#tela-painel'), 'cancelar o "Sair?" mantém o painel aberto')
  // ── editor de desafio: o topo (barra "Desafio novo" + "Todos os desafios") ──
  await irAba(dono.page, '#/desafios?parte=novo')
  await dono.page.evaluate(() => document.getElementById('titulo-aba').scrollIntoView({ block: 'start' }))
  await dono.page.evaluate(() => window.scrollBy(0, -110))
  await sleep(400)
  const sobre = await dono.page.evaluate(() => {
    const l = [...document.querySelectorAll('.aba:not([hidden]) a, .aba:not([hidden]) button')].find((x) => /Todos os desafios/.test(x.textContent))
    const b = document.querySelector('.aba:not([hidden]) .barra-salvar')
    if (!l || !b) return null
    const rl = l.getBoundingClientRect()
    const rb = b.getBoundingClientRect()
    const meio = document.elementFromPoint(rl.left + rl.width / 2, rl.top + rl.height / 2)
    return { link: [Math.round(rl.top), Math.round(rl.bottom)], barra: [Math.round(rb.top), Math.round(rb.bottom), getComputedStyle(b).position], tocaNoLink: !!meio && (meio === l || l.contains(meio)) }
  })
  console.log(`      editor de desafio, topo: ${JSON.stringify(sobre)}`)
  if (sobre) ok(sobre.tocaNoLink, `"← Todos os desafios" pode ser tocado (não fica por baixo da barra do editor) ${JSON.stringify(sobre)}`)
  await print(dono.page, 'galaxy-a', 'editor-desafio-topo')
  await dono.ctx.close()
}

// ── navegador de dentro do WhatsApp e do Instagram: entrar e abrir uma ficha ──
for (const nome of ['whatsapp-android', 'instagram-ios']) {
  const ap = await abrir(browser, nome)
  const { page } = ap
  const r = await entrar(page, { pin: PIN_DONO })
  ok(r === 'entrou', `${nome}: entra com senha + PIN (${r})`)
  if (r === 'entrou') {
    await esperarPulso(page).catch(() => {})
    await irAba(page, '#/usuarios')
    await page.locator(`${aba} tr.clicavel`).first().tap()
    const f = await page.waitForSelector('#gaveta:not([hidden]) .gaveta-corpo .perfil', { timeout: 20000 }).then(() => true).catch(() => false)
    ok(f, `${nome}: a ficha da conta abre`)
    const m = await medir(page)
    relatar(`${nome}: ficha`, m)
    await print(page, nome, 'ficha-conta')
    // o "Copiar" (código de convite): no navegador de dentro do app a área de transferência pode não existir
    const copiar = page.locator('#gaveta button[aria-label*="Copiar"], #gaveta button[title*="Copiar"]').first()
    if (await copiar.count()) {
      await copiar.tap()
      await sleep(700)
      const av = await page.evaluate(() => [...document.querySelectorAll('#avisos .aviso-flutuante')].map((x) => x.textContent).join(' | '))
      console.log(`      ${nome}: tocar em Copiar → "${av}"`)
    }
  }
  console.log(`      ${nome}: erros ${ap.erros.length ? ap.erros.join(' | ') : 'nenhum'}`)
  await ap.ctx.close()
}

// ── Safari do iOS 15 não tem form.requestSubmit() (chegou no 16): o PIN entra sozinho no 6º dígito? ──
{
  const ap = await abrir(browser, 'iphone-se')
  await ap.ctx.addInitScript(() => { try { delete HTMLFormElement.prototype.requestSubmit } catch {} })
  const { page } = ap
  await page.goto(PAINEL)
  await esperarDecisao(page)
  await page.locator('#senha').tap()
  await page.fill('#senha', env.PAINEL_SENHA)
  await page.locator('#botao-entrar').tap()
  await page.waitForSelector('#form-pin:not([hidden])', { timeout: 15000 })
  await page.locator('#pin-caixas .pin-caixa').first().tap()
  await page.keyboard.type(PIN_DONO, { delay: 40 })
  const entrou = await page.waitForSelector('#tela-painel:not([hidden])', { timeout: 6000 }).then(() => true).catch(() => false)
  console.log(`      sem requestSubmit (como no iOS 15): ${entrou ? 'entrou sozinho' : 'ficou parado no PIN'} · erros: ${ap.erros.join(' | ') || 'nenhum'}`)
  ok(entrou, 'sem form.requestSubmit (Safari do iOS 15), o 6º dígito do PIN entra sozinho')
  await print(page, 'iphone-se-sem-requestSubmit', 'pin-completo')
  if (!entrou) {
    await page.locator('#botao-pin').tap()
    const e2 = await page.waitForSelector('#tela-painel:not([hidden])', { timeout: 15000 }).then(() => true).catch(() => false)
    console.log(`      tocando em "Entrar": ${e2 ? 'entra' : 'não entra'}`)
  }
  await ap.ctx.close()
}

await browser.close()
console.log(`\npainel no celular (extras): ${achados.length} anotação(ões)`)
for (const a of achados) console.log(`  - ${a}`)
process.exitCode = achados.length ? 1 : 0
