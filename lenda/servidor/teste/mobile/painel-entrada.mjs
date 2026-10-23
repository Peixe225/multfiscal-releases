// LENDA v3.5 · painel no celular — 1. ENTRADA: senha, PIN (teclado numérico), criar PIN, senha provisória da equipe.
//   LENDA_PAINEL_BASE=<pasta da pilha> node servidor/teste/mobile/painel-entrada.mjs
// Na pilha local (painel-rodar.sh). Deixa o PIN do Dono criado (LENDA_PIN_DONO, padrão 729153) e grava a sessão do Dono
// em $LENDA_PAINEL_BASE/estado-dono.json para os outros scripts do painel (painel-abas.mjs, painel-acoes.mjs).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { APARELHOS, BASE, PAINEL, PIN_DONO, abrir, agora, digitarPin, entrar, env, esperarDecisao, esperarPulso, lancar, medir, print, relatar, sleep, sql, teclado } from './painel-lib.mjs'

const achados = []
const anotar = (rot, lista) => { if (lista.length) achados.push(`${rot}: ${lista.join(' | ')}`) }
const S = JSON.parse(readFileSync(`${BASE}/semente.json`, 'utf8'))
sql("DELETE FROM tentativas WHERE chave LIKE 'painel:%'")
// o Dono do arquivo começa sem PIN (cada rodada do painel-rodar.sh tem banco novo; rodando de novo na mesma pilha, tira)
sql("UPDATE admin_contas SET pin_hash = NULL WHERE da_config = 1")

const browser = await lancar()
const D = (n) => APARELHOS[n]

// ── 1.1 a tela de entrada em cada aparelho (modo "contas": e-mail + senha, porque há equipe) ──
for (const nome of ['galaxy-a', 'iphone-14', 'pequeno-320', 'iphone-se', 'pixel-7', 'deitado', 'whatsapp-android']) {
  const ap = await abrir(browser, nome)
  const { page } = ap
  await page.goto(PAINEL)
  await esperarDecisao(page)
  await sleep(400)
  const m = await medir(page)
  anotar(`entrada ${nome}`, relatar(`entrada · ${nome}`, m, { fonte: true }))
  const tipos = await page.evaluate(() => ({
    email: [document.getElementById('email').type, document.getElementById('email').autocomplete, document.getElementById('email').getAttribute('autocapitalize'), getComputedStyle(document.getElementById('email')).fontSize],
    senha: [document.getElementById('senha').type, getComputedStyle(document.getElementById('senha')).fontSize],
    emailVisivel: !document.getElementById('campo-email').hidden,
    foco: document.activeElement?.id,
  }))
  console.log(`      campos: ${JSON.stringify(tipos)}`)
  await print(page, nome, 'entrada')
  // teclado aberto no campo de senha: o botão Entrar continua à vista?
  if (nome === 'galaxy-a' || nome === 'iphone-se' || nome === 'deitado') {
    await page.locator('#senha').tap()
    await teclado(page, ap.a, true, nome === 'deitado' ? 0.55 : 0.42)
    const vis = await page.evaluate(() => {
      const b = document.getElementById('botao-entrar').getBoundingClientRect()
      const s = document.getElementById('senha').getBoundingClientRect()
      return { senha: [Math.round(s.top), Math.round(s.bottom)], botao: [Math.round(b.top), Math.round(b.bottom)], janela: innerHeight, rola: document.documentElement.scrollHeight > innerHeight }
    })
    console.log(`      com teclado (${ap.a.w}×${Math.round(ap.a.h * (nome === 'deitado' ? 0.45 : 0.58))}): ${JSON.stringify(vis)}`)
    await print(page, nome, 'entrada-com-teclado')
    await teclado(page, ap.a, false)
  }
  await ap.ctx.close()
}

// ── 1.2 Dono pelo celular (galaxy-a): senha do arquivo, sem PIN → faixa "Cadastre o seu PIN" → Config › Minha conta ──
{
  const ap = await abrir(browser, 'galaxy-a')
  const { page } = ap
  const r = await entrar(page)
  console.log(`  ..  Dono sem PIN: ${r}`)
  await esperarPulso(page)
  await sleep(1200)
  await print(page, 'galaxy-a', 'dono-sem-pin-inicio')
  anotar('inicio dono galaxy-a', relatar('início (Dono sem PIN) · galaxy-a', await medir(page), { fonte: true }))
  // a faixa leva para Config › Minha conta
  await page.locator('#faixas a[href="#/config?parte=conta"]').first().tap()
  await page.waitForSelector('#cp-pin', { timeout: 20000 })
  await sleep(600)
  const campos = await page.evaluate(() => ['cp-senha', 'cp-pin', 'cp-rep'].map((id) => { const e = document.getElementById(id); return { id, type: e.type, inputmode: e.inputMode, fonte: getComputedStyle(e).fontSize, w: Math.round(e.getBoundingClientRect().width) } }))
  console.log(`      campos do PIN: ${JSON.stringify(campos)}`)
  await page.locator('#cp-pin').scrollIntoViewIfNeeded()
  await print(page, 'galaxy-a', 'config-minha-conta-criar-pin')
  anotar('config minha conta galaxy-a', relatar('Config › Minha conta · galaxy-a', await medir(page), { fonte: true }))
  await page.locator('#cp-senha').tap()
  await page.fill('#cp-senha', env.PAINEL_SENHA)
  await page.locator('#cp-pin').tap()
  await teclado(page, ap.a, true)
  const cob = await medir(page)
  relatar('criar PIN com teclado (campo PIN focado)', cob)
  await print(page, 'galaxy-a', 'config-criar-pin-com-teclado')
  await page.keyboard.type(PIN_DONO)
  await page.locator('#cp-rep').tap()
  await page.keyboard.type(PIN_DONO)
  await teclado(page, ap.a, false)
  await page.getByRole('button', { name: 'Criar PIN' }).tap()
  await page.waitForFunction(() => /PIN criado/.test(document.getElementById('avisos').textContent), null, { timeout: 15000 })
  console.log('  ok  PIN do Dono criado pelo celular')
  await sleep(500)
  // sair pelo botão do topo (celular)
  await page.locator('.botoes-topo-celular [data-acao="sair"]').tap()
  await page.waitForSelector('#form-entrar:not([hidden])', { timeout: 15000 })
  // entrar de novo: agora pede o PIN
  await page.locator('#senha').tap()
  await page.fill('#senha', env.PAINEL_SENHA)
  await page.locator('#botao-entrar').tap()
  await page.waitForSelector('#form-pin:not([hidden])', { timeout: 15000 })
  await sleep(300)
  const pinInfo = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('#pin-caixas .pin-caixa')]
    const r0 = cs[0].getBoundingClientRect()
    const r5 = cs[5].getBoundingClientRect()
    const c = document.getElementById('cartao-entrar').getBoundingClientRect()
    return { n: cs.length, inputmode: cs[0].inputMode, type: cs[0].type, autocomplete: cs[0].autocomplete, pattern: cs[0].pattern, w: Math.round(r0.width), h: Math.round(r0.height), fonte: getComputedStyle(cs[0]).fontSize,
      linha: [Math.round(r0.left), Math.round(r5.right)], cartao: [Math.round(c.left), Math.round(c.right)], foco: document.activeElement?.className }
  })
  console.log(`      caixas do PIN (360): ${JSON.stringify(pinInfo)}`)
  await print(page, 'galaxy-a', 'pin')
  for (const w of [320, 375, 390, 412]) {
    await page.setViewportSize({ width: w, height: 700 })
    await sleep(250)
    const lin = await page.evaluate(() => {
      const cs = [...document.querySelectorAll('#pin-caixas .pin-caixa')]
      const c = document.getElementById('cartao-entrar').getBoundingClientRect()
      return { primeira: Math.round(cs[0].getBoundingClientRect().left), ultima: Math.round(cs[5].getBoundingClientRect().right), cartao: [Math.round(c.left), Math.round(c.right)], lateral: document.documentElement.scrollWidth - document.documentElement.clientWidth }
    })
    const passa = lin.ultima > lin.cartao[1] - 1 || lin.primeira < lin.cartao[0] + 1
    console.log(`  ${passa || lin.lateral > 0 ? '!!' : 'ok'}  caixas do PIN em ${w}px: ${JSON.stringify(lin)}`)
    if (passa || lin.lateral > 0) achados.push(`PIN em ${w}px: as 6 caixas passam do cartão ${JSON.stringify(lin)}`)
    await print(page, `largura-${w}`, 'pin')
  }
  await page.setViewportSize({ width: ap.a.w, height: ap.a.h })
  // PIN errado: mensagem e "Restam N tentativas"; depois o certo
  await digitarPin(page, '#pin-caixas', '111222')
  await page.waitForSelector('#erro-pin:not([hidden])', { timeout: 15000 })
  await sleep(700)
  console.log(`      PIN errado: "${await page.textContent('#erro-pin')}" · "${await page.textContent('#pin-restam')}" · foco: ${await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))}`)
  await print(page, 'galaxy-a', 'pin-errado')
  await digitarPin(page, '#pin-caixas', PIN_DONO)
  await page.waitForSelector('#tela-painel:not([hidden])', { timeout: 20000 })
  await esperarPulso(page)
  console.log('  ok  entrou com senha + PIN pelo celular')
  writeFileSync(`${BASE}/estado-dono.json`, JSON.stringify(await ap.ctx.storageState()))
  await ap.ctx.close()
}

// ── 1.3 PIN colado / "código" do teclado (autocomplete one-time-code): colar 6 dígitos na 1ª caixa ──
{
  const ap = await abrir(browser, 'iphone-14')
  const { page } = ap
  await page.goto(PAINEL)
  await esperarDecisao(page)
  await page.locator('#senha').tap()
  await page.fill('#senha', env.PAINEL_SENHA)
  await page.locator('#botao-entrar').tap()
  await page.waitForSelector('#form-pin:not([hidden])', { timeout: 15000 })
  // o iOS preenche o "código" como se a pessoa digitasse tudo de uma vez na 1ª caixa (evento input com 6 dígitos)
  await page.locator('#pin-caixas .pin-caixa').first().tap()
  await page.evaluate((pin) => { const c = document.querySelector('#pin-caixas .pin-caixa'); c.value = pin; c.dispatchEvent(new Event('input', { bubbles: true })) }, PIN_DONO)
  const ok = await page.waitForSelector('#tela-painel:not([hidden])', { timeout: 15000 }).then(() => true).catch(() => false)
  console.log(`  ${ok ? 'ok' : '!!'}  PIN preenchido de uma vez (autopreencher do teclado) ${ok ? 'entra' : 'NÃO entra'}`)
  if (!ok) achados.push('PIN preenchido de uma vez na 1ª caixa não entra')
  await ap.ctx.close()
}

// ── 1.4 moderadora no celular pequeno (320): e-mail + senha provisória → senha nova → criar PIN (2 × 6 caixas) ──
// (rodando de novo na mesma pilha: a moderadora volta para a senha provisória, sem PIN)
{
  const PROVISORIA = 'provisoria-do-teste-mobile-1'
  const hash = execFileSync('php', ['-r', 'echo password_hash($argv[1], PASSWORD_DEFAULT);', PROVISORIA], { encoding: 'utf8' })
  sql(`UPDATE admin_contas SET senha_hash = '${hash}', trocar_senha = 1, pin_hash = NULL WHERE email = '${S.moderadora.email}'`)
  S.moderadora.senha = PROVISORIA
  const ap = await abrir(browser, 'pequeno-320')
  const { page } = ap
  await page.goto(PAINEL)
  await esperarDecisao(page)
  await page.locator('#email').tap()
  await page.fill('#email', S.moderadora.email)
  await page.locator('#senha').tap()
  await page.fill('#senha', S.moderadora.senha)
  await page.locator('#botao-entrar').tap()
  await page.waitForSelector('#form-trocar-senha:not([hidden])', { timeout: 15000 })
  await sleep(300)
  anotar('trocar senha 320', relatar('senha provisória → senha nova · 320', await medir(page), { fonte: true }))
  await print(page, 'pequeno-320', 'trocar-senha-provisoria')
  await page.locator('#nova-senha').tap()
  await page.keyboard.type('uma frase forte do painel 2026')
  await page.locator('#nova-senha-2').tap()
  await teclado(page, ap.a, true)
  const m = await medir(page)
  relatar('senha nova com teclado (2º campo)', m)
  const botao = await page.evaluate(() => { const b = document.getElementById('botao-trocar').getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom), innerHeight] })
  console.log(`      botão "Salvar e entrar" com teclado: ${JSON.stringify(botao)}`)
  await print(page, 'pequeno-320', 'trocar-senha-com-teclado')
  await page.keyboard.type('uma frase forte do painel 2026')
  await teclado(page, ap.a, false)
  await page.locator('#botao-trocar').tap()
  await page.waitForSelector('#form-criar-pin:not([hidden])', { timeout: 15000 })
  await sleep(400)
  const lin = await page.evaluate(() => {
    const c = document.getElementById('cartao-entrar').getBoundingClientRect()
    return ['#pin-novo', '#pin-repetir'].map((s) => { const cs = [...document.querySelectorAll(s + ' .pin-caixa')]; return { s, de: Math.round(cs[0].getBoundingClientRect().left), ate: Math.round(cs[5].getBoundingClientRect().right), w: Math.round(cs[0].getBoundingClientRect().width) } }).concat([{ cartao: [Math.round(c.left), Math.round(c.right)], lateral: document.documentElement.scrollWidth - document.documentElement.clientWidth }])
  })
  console.log(`      criar PIN em 320: ${JSON.stringify(lin)}`)
  anotar('criar PIN 320', relatar('criar PIN (primeiro acesso) · 320', await medir(page), { fonte: true }))
  await print(page, 'pequeno-320', 'criar-pin-primeiro-acesso')
  await print(page, 'pequeno-320', 'criar-pin-primeiro-acesso-inteira', { inteira: true })
  await digitarPin(page, '#pin-novo', '481620')
  await sleep(300)
  const focoRep = await page.evaluate(() => document.activeElement?.closest('#pin-repetir') ? 'repetir' : document.activeElement?.closest('#pin-novo') ? 'novo' : document.activeElement?.tagName)
  console.log(`      depois do 6º dígito o foco foi para: ${focoRep}`)
  await page.keyboard.type('481620', { delay: 40 })
  await page.locator('#botao-criar-pin').tap()
  const ok = await page.waitForSelector('#tela-painel:not([hidden])', { timeout: 20000 }).then(() => true).catch(() => false)
  console.log(`  ${ok ? 'ok' : '!!'}  moderadora entrou pelo celular de 320`)
  if (ok) {
    await esperarPulso(page).catch(() => {})
    await sleep(800)
    await print(page, 'pequeno-320', 'moderadora-inicio')
    anotar('moderadora inicio 320', relatar('início (moderadora) · 320', await medir(page)))
    writeFileSync(`${BASE}/estado-moderadora.json`, JSON.stringify(await ap.ctx.storageState()))
  }
  await ap.ctx.close()
}

// ── 1.5 tempo até dar para entrar no 4G lento + CPU 4× (sem cache) e até a 1ª aba aparecer depois do PIN ──
{
  const ap = await abrir(browser, 'galaxy-a', { lento: true })
  const { page } = ap
  const t0 = Date.now()
  await page.goto(PAINEL, { waitUntil: 'commit' })
  await esperarDecisao(page, 60000)
  const tEntrar = Date.now() - t0
  const pesos = await page.evaluate(() => performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || 0), 0) + (performance.getEntriesByType('navigation')[0]?.transferSize || 0))
  await page.locator('#senha').tap()
  await page.fill('#senha', env.PAINEL_SENHA)
  const t1 = Date.now()
  await page.locator('#botao-entrar').tap()
  await page.waitForSelector('#form-pin:not([hidden])', { timeout: 60000 })
  const tSenha = Date.now() - t1
  const t2 = Date.now()
  await digitarPin(page, '#pin-caixas', PIN_DONO)
  await page.waitForSelector('#tela-painel:not([hidden])', { timeout: 60000 })
  await page.waitForFunction(() => document.querySelectorAll('#ladrilhos .ladrilho').length > 0, null, { timeout: 90000 }).catch(() => {})
  const tPainel = Date.now() - t2
  await esperarPulso(page, 90000).catch(() => {})
  const tPulso = Date.now() - t2
  const longas = await page.evaluate(() => (window.__longas ?? []).map((l) => l.d))
  console.log(`  ..  4G lento + CPU 4×: tela de entrada em ${(tEntrar / 1000).toFixed(1)} s (${Math.round(pesos / 1024)} KB) · senha→PIN ${(tSenha / 1000).toFixed(1)} s · PIN→Visão geral desenhada ${(tPainel / 1000).toFixed(1)} s · pulso ${(tPulso / 1000).toFixed(1)} s · tarefas longas: ${longas.length} (maior ${Math.max(0, ...longas)} ms)`)
  await print(page, 'galaxy-a-4g-lento', 'visao-geral-depois-do-pin')
  console.log(`      erros: ${ap.erros.length ? ap.erros.join(' | ') : 'nenhum'} · rede: ${ap.rede.slice(0, 4).join(' | ') || 'ok'}`)
  await ap.ctx.close()
}

await browser.close()
console.log(`\nentrada no celular: ${achados.length} anotação(ões)`)
for (const a of achados) console.log(`  - ${a}`)
process.exitCode = achados.length ? 1 : 0
