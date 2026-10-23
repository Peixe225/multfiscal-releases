#!/usr/bin/env node
// LENDA v3.5 · revisão mobile — CONTA: o convite depois de 5 partidas, criar conta, o código de 6 dígitos (pilha local).
//
// Etapas (--etapas=a,b; padrão: todas):
//   convite   o convite das 5 partidas em cada aparelho (Home com o contador em 5): cabe? rola? "Agora não" à vista? alvos
//             de toque < 40 px, texto cortado, rolagem lateral; girar com ele aberto.
//   fim5      a 5ª partida jogada pela tela no celular (Galaxy A): o convite aparece por cima do card de fim?
//   campos    o tipo de teclado e o autocompletar de cada campo (Criar conta, Já tenho conta, Esqueci, código).
//   teclado   o teclado virtual abrindo em cada campo do Criar conta (a janela encolhe, como no Android/WebView; e a janela
//             visual do iPhone, simulada): o campo fica à vista? o botão "Criar conta" dá para alcançar?
//   enter     o "Próximo"/"Ir" do teclado (Enter) em cada campo do Criar conta.
//   cadastro  criar a conta de verdade no celular (iPhone SE) → "Confirme seu e-mail": colar o código (com espaço, com texto),
//             errar, acertar; "Depois"; a faixa de Minha conta.
//   lento     4G lento + CPU 4×, cache vazio: tocar em "Entrar / Criar conta" assim que o menu aparece — quanto demora o
//             diálogo (o pedaço dele ainda não veio) e o que a pessoa vê enquanto isso.
//   rede      criar conta sem internet e no 4G lento + CPU 4× (mensagem, botão carregando).
//
// Uso: LENDA_INTEG_BASE=/tmp/lenda-v35-conta node servidor/teste/mobile/conta-cadastro.mjs [--etapas=convite,campos]
//      [--aparelhos=iphone-se,galaxy-a]   (a pilha: LENDA_INTEG_BASE=... PORTA=9130 BANCO=lenda_v35_conta bash servidor/teste/integracao/subir.sh)
// Prints em $LENDA_PRINTS (padrão: scratchpad/v35-mobile/conta). Sai com 1 se alguma conferência falhou.
import {
  APARELHOS, URL0, painelDeslocado, atributos, botaoVisivel, campoVisivel, codigoDoEmail, colar, dialogo, fim, girar, home, lancar, lento, medirTela, menu, novoAparelho, nota, offline, ok, print, semDialogo, semLentidao, sleep, sql, teclado,
} from './conta-lib.mjs'

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d
const TODAS = ['convite', 'fim5', 'campos', 'teclado', 'enter', 'cadastro', 'rede', 'lento']
const ETAPAS = arg('etapas', TODAS.join(',')).split(',')
const LISTA = arg('aparelhos', Object.keys(APARELHOS).filter((n) => n !== 'galaxy-a-deitado').join(',')).split(',')
const LISTA_TECLADO = arg('aparelhos', 'iphone-se,galaxy-a,pequeno-320,deitado,galaxy-a-deitado,tiktok-android,instagram-ios').split(',')
const browser = await lancar()
const SUB = 'cadastro'
const etapa = async (nome, fn) => {
  if (!ETAPAS.includes(nome)) return
  console.log(`\n── ${nome} ──`)
  try {
    await fn()
  } catch (e) {
    ok(false, `${nome}: travou — ${e.message.split('\n')[0]}`)
  }
}
const SENHA = 'senha-forte-123'
const email = (p) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@exemplo.com`

/** Abre o convite (contador em 5 na Home) e devolve o diálogo. */
async function abrirConvite(ap) {
  await home(ap.page)
  const d = dialogo(ap.page)
  await d.waitFor({ timeout: 20000 })
  await sleep(700)
  return d
}

/** A altura do sheet e da área que rola, e se o "Agora não" está à vista sem rolar. */
const geometria = (page) =>
  page.evaluate(() => {
    const s = document.querySelector('[role="dialog"].sc-modal')
    if (!s) return null
    const r = s.getBoundingClientRect()
    const b = s.querySelector('.lx-dialog__body')
    const pe = s.querySelector('.lx-dialog__foot')
    const rp = pe?.getBoundingClientRect()
    const botao = [...s.querySelectorAll('button')].find((x) => /^(Criar conta|Entrar)$/.test(x.textContent.trim()) && x.type === 'submit')
    const rb = botao?.getBoundingClientRect()
    return {
      sheet: s.classList.contains('lx-sheet'),
      top: Math.round(r.top),
      altura: Math.round(r.height),
      janela: innerHeight,
      rola: b ? b.scrollHeight > b.clientHeight + 2 : null,
      corpo: b ? [b.clientHeight, b.scrollHeight] : null,
      rodape: rp ? { top: Math.round(rp.top), bottom: Math.round(rp.bottom), visivel: rp.bottom <= innerHeight && rp.top >= 0 } : null,
      botao: rb ? { top: Math.round(rb.top), bottom: Math.round(rb.bottom), visivel: rb.bottom <= innerHeight && rb.top >= r.top } : null,
    }
  })

// ───────────────────────── convite ─────────────────────────
await etapa('convite', async () => {
  for (const nome of LISTA) {
    const ap = await novoAparelho(browser, nome, { partidas: 5 })
    try {
      const d = await abrirConvite(ap)
      const tit = (await d.locator('.sc-hero__t').innerText()).trim()
      ok(/5 partidas/.test(tit), `${nome}: o convite abre na Home com 5 partidas ("${tit}")`)
      const g = await geometria(ap.page)
      const f = await print(ap.page, nome, 'convite-5-partidas', { sub: SUB })
      const { m, ach } = await medirTela(ap.page, `${nome}: convite`)
      ok(m.lateral <= 0, `${nome}: convite sem rolagem lateral (${m.lateral}px)`, { print: f })
      ok(!m.cortados.filter((c) => !c.reticencias).length, `${nome}: convite sem texto cortado`, { print: f, cortados: m.cortados })
      if (m.pequenos.length) ok(false, `${nome}: convite com alvos de toque < 40 px: ${m.pequenos.map((p) => `"${p.nome}" ${p.w}×${p.h}`).join(' · ')}`, { print: f, pequenos: m.pequenos })
      console.log(`      geometria: ${JSON.stringify(g)}`)
      ok(g.top >= 0, `${nome}: o sheet do convite cabe na janela (topo em ${g.top}px de ${g.janela}px)`, { print: f })
      // rola até o fim: "Criar conta" e "Agora não" alcançáveis
      await d.locator('.lx-dialog__body').evaluate((b) => b.scrollTo(0, b.scrollHeight))
      await sleep(300)
      const g2 = await geometria(ap.page)
      ok(g2.botao?.visivel !== false, `${nome}: rolando o convite, o botão "Criar conta" aparece (${JSON.stringify(g2.botao)})`)
      ok(g2.rodape?.visivel !== false, `${nome}: o "Agora não" fica à vista (${JSON.stringify(g2.rodape)})`)
      await print(ap.page, nome, 'convite-rolado-ate-o-fim', { sub: SUB })
      // girar com ele aberto
      if (nome === 'iphone-se' || nome === 'galaxy-a') {
        const desvirar = await girar(ap.page, ap.a)
        const g3 = await geometria(ap.page)
        const f3 = await print(ap.page, nome, 'convite-girado-deitado', { sub: SUB })
        const { m: m3 } = await medirTela(ap.page, `${nome}: convite deitado`)
        ok(g3 && g3.top >= 0 && m3.lateral <= 0, `${nome}: girando com o convite aberto ele continua inteiro (${JSON.stringify(g3)})`, { print: f3 })
        await desvirar()
        ok((await dialogo(ap.page).count()) === 1, `${nome}: desvirando, o convite continua aberto`)
      }
      ok(!ap.erros.length, `${nome}: sem erro no console no convite`, { erros: ap.erros.slice(0, 5) })
    } finally {
      await ap.ctx.close()
    }
  }
})

// ───────────────────────── fim5: a 5ª partida pela tela ─────────────────────────
await etapa('fim5', async () => {
  const nome = 'galaxy-a'
  const ap = await novoAparelho(browser, nome, { partidas: 4, ajustes: JSON.stringify({ state: { settings: { sound: false, volume: 0, skipAnimations: true, reducedMotion: true, lowFx: true, engine: 'auto' } }, version: 1 }) })
  try {
    const { page } = ap
    await home(page)
    await page.goto(`${URL0}#/identidade?ritmo=expressa`)
    // no celular a identidade é um assistente de 3 passos (país → nome/número/perna → posição)
    const busca = page.locator('input[placeholder="Buscar país"]')
    await busca.waitFor({ state: 'visible', timeout: 60000 })
    await busca.fill('bras')
    await page.locator('#id-nation-list [role="radio"]', { hasText: /^\s*Brasil\s*$/ }).first().click()
    await page.getByRole('button', { name: /^Continuar/ }).click()
    await page.locator('#id-surname').waitFor({ state: 'visible', timeout: 20000 })
    await page.fill('#id-surname', 'QUINTA')
    await page.getByRole('button', { name: /^Continuar/ }).click()
    await sleep(500)
    await page.locator('[role="radiogroup"][aria-label="Posição em campo"] [role="radio"]').last().click()
    await sleep(300)
    await page.getByRole('button', { name: /^Confirmar$|Confirmar identidade/ }).click()
    await page.waitForFunction(() => location.hash.startsWith('#/carreira'), null, { timeout: 30000 })
    const t0 = Date.now()
    let conviteNoMeio = false
    while (Date.now() - t0 < 300000) {
      if (await page.locator('.ck-end button', { hasText: /Jogar novamente/ }).count()) break
      if (await dialogo(page).count()) conviteNoMeio = true
      const opt = page.locator('.ck-opt:not(.is-locked):not([disabled])').first()
      const pen = page.locator('.ck-pen__goal button:not([disabled])').first()
      const pular = page.getByRole('button', { name: /^Pular/ })
      try {
        if (await opt.count()) await opt.click({ timeout: 3000 })
        else if (await pen.count()) await pen.click({ timeout: 3000 })
        else if (await pular.count()) await pular.first().click({ timeout: 3000 })
      } catch {}
      await sleep(150)
    }
    ok(!conviteNoMeio, `${nome}: o convite não abre no meio da 5ª carreira`)
    const d = dialogo(page)
    await d.waitFor({ timeout: 30000 })
    await sleep(800)
    const f = await print(page, nome, 'fim-da-5a-partida-convite', { sub: SUB })
    ok((await page.evaluate(() => localStorage.getItem('lenda:partidas'))) === '5', `${nome}: contador em 5 depois da carreira`)
    const g = await geometria(page)
    ok(g && g.top >= 0, `${nome}: o convite por cima do card de fim cabe (${JSON.stringify(g)})`, { print: f })
    // "Agora não" → volta para o card de fim, que continua usável
    await d.getByRole('button', { name: 'Agora não' }).click()
    await semDialogo(page)
    await sleep(500)
    const f2 = await print(page, nome, 'fim-da-5a-depois-de-agora-nao', { sub: SUB })
    ok(await page.locator('.ck-end button', { hasText: /Jogar novamente/ }).isVisible(), `${nome}: depois do "Agora não", o card de fim continua lá`, { print: f2 })
    ok(!ap.erros.length, `${nome}: sem erro no console na 5ª partida`, { erros: ap.erros.slice(0, 5) })
  } finally {
    await ap.ctx.close()
  }
})

// ───────────────────────── campos: teclado e autocompletar ─────────────────────────
await etapa('campos', async () => {
  const nome = 'iphone-14'
  const ap = await novoAparelho(browser, nome, { partidas: 5 })
  try {
    const { page } = ap
    const d = await abrirConvite(ap)
    const ap1 = await atributos(d.getByLabel('Apelido'))
    const em = await atributos(d.getByLabel('E-mail'))
    const se = await atributos(d.getByLabel('Senha', { exact: true }))
    console.log('      criar:', JSON.stringify({ ap1, em, se }))
    ok(em.type === 'email' && em.inputmode === 'email' && em.autocomplete === 'email' && em.autocapitalize === 'none', `Criar conta · E-mail: type=email, inputmode=email, autocomplete=email, sem maiúscula (${JSON.stringify(em)})`)
    ok(se.type === 'password' && se.autocomplete === 'new-password', `Criar conta · Senha: type=password, autocomplete=new-password (${JSON.stringify(se)})`)
    ok(ap1.autocomplete === 'nickname', `Criar conta · Apelido: autocomplete=nickname (${JSON.stringify(ap1)})`)
    for (const [k, a] of Object.entries({ apelido: ap1, email: em, senha: se })) ok(a.fonte >= 16, `Criar conta · ${k}: fonte ${a.fonte}px (≥ 16: o iPhone não dá zoom)`)
    // o "Mostrar" da senha
    const mostrar = d.getByRole('button', { name: /Mostrar/ })
    const bb = await mostrar.boundingBox()
    ok(bb && bb.height >= 40 && bb.width >= 40, `Criar conta · botão "Mostrar a senha": ${bb ? `${Math.round(bb.width)}×${Math.round(bb.height)}` : '?'} px (≥ 40)`)
    await d.getByRole('tab', { name: 'Já tenho conta' }).click()
    await sleep(300)
    const le = await atributos(d.getByLabel('E-mail'))
    const ls = await atributos(d.getByLabel('Senha', { exact: true }))
    console.log('      entrar:', JSON.stringify({ le, ls }))
    ok(le.type === 'email' && ['email', 'username', 'username email', 'email username'].includes(le.autocomplete), `Entrar · E-mail: ${JSON.stringify(le)}`)
    ok(ls.autocomplete === 'current-password', `Entrar · Senha: autocomplete=current-password (${ls.autocomplete})`)
    await d.getByRole('button', { name: 'Esqueci a senha' }).click()
    await sleep(300)
    const ee = await atributos(d.getByLabel('E-mail'))
    ok(ee.type === 'email' && ee.inputmode === 'email', `Esqueci · E-mail: ${JSON.stringify(ee)}`)
    await d.getByLabel('E-mail').fill('ninguem@exemplo.com')
    await d.getByRole('button', { name: 'Já recebi um código' }).click()
    await sleep(300)
    const co = await atributos(d.getByLabel('Código de 6 dígitos'))
    const ns = await atributos(d.getByLabel('Nova senha'))
    console.log('      código:', JSON.stringify({ co, ns }))
    ok(co.inputmode === 'numeric' && co.autocomplete === 'one-time-code' && co.fonte >= 16, `Esqueci · Código: inputmode=numeric, autocomplete=one-time-code, fonte ${co.fonte}px (${JSON.stringify(co)})`)
    ok(ns.autocomplete === 'new-password', `Esqueci · Nova senha: autocomplete=new-password (${ns.autocomplete})`)
    const f = await print(page, nome, 'esqueci-codigo-e-nova-senha', { sub: SUB })
    const { m } = await medirTela(page, `${nome}: código + nova senha`)
    if (m.pequenos.length) ok(false, `${nome}: tela do código com alvos < 40 px: ${m.pequenos.map((p) => `"${p.nome}" ${p.w}×${p.h}`).join(' · ')}`, { print: f, pequenos: m.pequenos })
  } finally {
    await ap.ctx.close()
  }
})

// ───────────────────────── teclado ─────────────────────────
await etapa('teclado', async () => {
  for (const nome of LISTA_TECLADO) {
    const ap = await novoAparelho(browser, nome, { partidas: 5 })
    try {
      const { page, a } = ap
      const d = await abrirConvite(ap)
      // abre os opcionais também (Time e Estado)
      await d.getByRole('button', { name: /Time do coração e estado/ }).click()
      await sleep(250)
      const campos = [
        ['Apelido', 'Apelido', false],
        ['E-mail', 'E-mail', false],
        ['Senha', 'Senha', true],
        ['Time do coração', 'Time do coração', false],
      ]
      for (const [rot, tela, exato] of campos) {
        const el = d.getByLabel(rot, { exact: exato })
        await el.scrollIntoViewIfNeeded()
        await el.tap({ timeout: 8000 })
        await sleep(150)
        // Android / navegadores dos apps: a janela encolhe (o teclado ocupa ~42% da tela; deitado, ~60%)
        await teclado(page, a, true, a.w > a.h ? 0.6 : 0.42)
        await sleep(450) // o aoFocarRolar do campo roda com 280 ms
        const v = await campoVisivel(page)
        const b = await botaoVisivel(page, '[role="dialog"].sc-modal button[type="submit"]')
        const f = await print(page, nome, `teclado-aberto-${tela}`, { sub: `${SUB}/teclado` })
        ok(v.inteiro && !v.porCima, `${nome}: com o teclado aberto, o campo "${rot}" fica à vista (${JSON.stringify(v)})`, { print: f })
        const dx = await painelDeslocado(page)
        ok(!dx || dx.scrollTop === 0, `${nome}: com o teclado aberto no campo "${rot}", o painel do convite não rola junto (scrollTop ${dx?.scrollTop}px, ${dx?.vazioEmbaixo}px vazios embaixo)`, { print: f })
        if (rot === 'Senha') ok(true, `${nome}: botão "Criar conta" com o teclado aberto no campo Senha: ${JSON.stringify(b)}`)
        await teclado(page, a, false)
      }
      // o botão dá para alcançar rolando com o teclado aberto (foco na senha)
      await d.getByLabel('Senha', { exact: true }).tap()
      await teclado(page, a, true, a.w > a.h ? 0.6 : 0.42)
      await sleep(400)
      await d.locator('.lx-dialog__body').evaluate((b) => b.scrollTo(0, b.scrollHeight))
      await sleep(300)
      const b = await botaoVisivel(page, '[role="dialog"].sc-modal button[type="submit"]')
      const g = await geometria(page)
      const f = await print(page, nome, 'teclado-aberto-rolado-ate-criar-conta', { sub: `${SUB}/teclado` })
      ok(b?.visivel && g.top >= 0, `${nome}: com o teclado aberto, rolando, o "Criar conta" aparece (${JSON.stringify(b)}; sheet ${JSON.stringify({ top: g.top, altura: g.altura, janela: g.janela })})`, { print: f })
      await teclado(page, a, false)

      // iPhone: o teclado não encolhe a janela, só a janela visual (visualViewport). Simulado: a vv passa a ter a altura
      // de cima do teclado e o jogo põe a altura do teclado em --sc-kb (o sheet sobe).
      if (APARELHOS[nome].ios) {
        await d.getByLabel('E-mail').tap()
        const kb = Math.round(a.h * (a.w > a.h ? 0.55 : 0.4))
        await page.evaluate((kb) => {
          const vv = window.visualViewport
          const h0 = innerHeight
          Object.defineProperty(vv, 'height', { get: () => h0 - kb, configurable: true })
          vv.dispatchEvent(new Event('resize'))
        }, kb)
        await sleep(700)
        const r = await page.evaluate((kb) => {
          const s = document.querySelector('[role="dialog"].sc-modal')
          const f = document.activeElement
          const rs = s.getBoundingClientRect()
          const rf = f.getBoundingClientRect()
          const limite = innerHeight - kb
          return { kb: getComputedStyle(document.documentElement).getPropertyValue('--sc-kb'), sheetBottom: Math.round(rs.bottom), sheetTop: Math.round(rs.top), campoBottom: Math.round(rf.bottom), limite, acimaDoTeclado: rf.bottom <= limite && rf.top >= 0 }
        }, kb)
        const f2 = await print(page, nome, 'iphone-janela-visual-teclado-email', { sub: `${SUB}/teclado` })
        ok(r.acimaDoTeclado, `${nome} (janela visual simulada, teclado ${kb}px): o campo E-mail fica acima do teclado (${JSON.stringify(r)})`, { print: f2 })
      }
      ok(!ap.erros.length, `${nome}: sem erro no console (teclado)`, { erros: ap.erros.slice(0, 5) })
    } finally {
      await ap.ctx.close()
    }
  }
})

// ───────────────────────── enter: "Próximo" / "Ir" do teclado ─────────────────────────
await etapa('enter', async () => {
  const nome = 'iphone-se'
  const ap = await novoAparelho(browser, nome, { partidas: 5 })
  try {
    const { page } = ap
    const d = await abrirConvite(ap)
    await d.getByLabel('Apelido').tap()
    await page.keyboard.type('Zé Mobile')
    await page.keyboard.press('Enter')
    await sleep(500)
    const foco = await page.evaluate(() => document.activeElement?.closest('.sc-field')?.querySelector('label')?.textContent?.trim() ?? document.activeElement?.tagName)
    const erros = await d.locator('[aria-invalid="true"]').count()
    const textos = await d.locator('.sc-hint').allInnerTexts()
    const f = await print(page, nome, 'enter-no-apelido', { sub: SUB })
    console.log(`      depois do Enter no Apelido: foco em ${foco}; ${erros} campos marcados com erro; dicas: ${JSON.stringify(textos)}`)
    ok(erros <= 1, `${nome}: "Próximo" (Enter) no Apelido vai para o E-mail sem acusar erro nos campos que a pessoa ainda nem viu (${erros} campos em vermelho, foco em "${foco}")`, { print: f })
  } finally {
    await ap.ctx.close()
  }
})

// ───────────────────────── cadastro + código ─────────────────────────
await etapa('cadastro', async () => {
  const nome = 'iphone-se'
  const ap = await novoAparelho(browser, nome, { partidas: 5 })
  try {
    const { page } = ap
    const d = await abrirConvite(ap)
    const E = email('mob')
    await d.getByLabel('Apelido').fill('Zé Mobile')
    await d.getByLabel('E-mail').fill(E)
    await d.getByLabel('Senha', { exact: true }).fill(SENHA)
    // o aceite: o toque no texto do rótulo marca a caixa
    await d.locator('.sc-check span').first().tap({ position: { x: 4, y: 6 } })
    ok(await d.getByRole('checkbox').first().isChecked(), `${nome}: tocar no texto "Li e aceito" marca a caixa`)
    const bb = await d.locator('.sc-check').boundingBox()
    ok(bb.height >= 40, `${nome}: a linha do aceite tem ${Math.round(bb.height)}px de altura para o toque`)
    await print(page, nome, 'criar-conta-preenchido', { sub: SUB })
    const t0 = Date.now() - 1000
    await d.getByRole('button', { name: 'Criar conta', exact: true }).tap()
    const dv = dialogo(page, 'Confirme seu e-mail')
    await dv.waitFor({ timeout: 20000 })
    await sleep(800)
    const fv = await print(page, nome, 'confirme-seu-email', { sub: SUB })
    const { m } = await medirTela(page, `${nome}: confirme seu e-mail`)
    ok(m.lateral <= 0 && !m.cortados.filter((c) => !c.reticencias).length, `${nome}: "Confirme seu e-mail" sem rolagem lateral nem texto cortado`, { print: fv })
    if (m.pequenos.length) ok(false, `${nome}: "Confirme seu e-mail" com alvos < 40 px: ${m.pequenos.map((p) => `"${p.nome}" ${p.w}×${p.h}`).join(' · ')}`, { print: fv, pequenos: m.pequenos })
    const ativo = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.id || document.activeElement?.tagName)
    console.log(`      foco ao abrir: ${ativo}`)
    const campo = dv.getByLabel('Código de 6 dígitos')
    const at = await atributos(campo)
    ok(at.inputmode === 'numeric' && at.autocomplete === 'one-time-code' && at.fonte >= 16, `${nome}: campo do código com teclado numérico e "one-time-code" (${JSON.stringify(at)})`)
    const codigo = await codigoDoEmail(E, t0)
    ok(/^\d{6}$/.test(codigo ?? ''), `${nome}: o código chegou no e-mail (${codigo})`)
    // colar, do jeito que vem do app de e-mail
    const casos = [
      ['só os 6 números', codigo, codigo],
      ['com espaço na frente', ` ${codigo}`, codigo],
      ['com quebra de linha no fim', `${codigo}\n`, codigo],
      ['separado 3 + 3', `${codigo.slice(0, 3)} ${codigo.slice(3)}`, codigo],
      ['com texto antes', `Seu código: ${codigo}`, codigo],
    ]
    const resultados = []
    for (const [rot, texto, esperado] of casos) {
      await campo.fill('')
      await campo.focus()
      await colar(page, texto)
      const v = await campo.inputValue()
      resultados.push(`${rot}: "${v}"`)
      ok(v === esperado, `${nome}: colar o código ${rot} (${JSON.stringify(texto)}) → o campo fica com "${v}" (esperado "${esperado}")`)
    }
    console.log(`      colar: ${resultados.join(' · ')}`)
    // digitar com o teclado numérico
    await campo.fill('')
    await campo.focus()
    await page.keyboard.type('12a3456')
    ok((await campo.inputValue()) === '123456', `${nome}: digitar com letra no meio fica só com os números (${await campo.inputValue()})`)
    // código errado
    await campo.fill(codigo === '000000' ? '111111' : '000000')
    await dv.getByRole('button', { name: 'Confirmar e-mail' }).tap()
    await dv.locator('.sc-err').waitFor({ timeout: 10000 })
    const msg = (await dv.locator('.sc-err').innerText()).trim()
    const fe = await print(page, nome, 'codigo-errado', { sub: SUB })
    ok(/código/i.test(msg), `${nome}: código errado → "${msg}"`, { print: fe })
    ap.ignorar(/status of 400/)
    // teclado aberto no campo do código: botão "Confirmar e-mail" à vista?
    await campo.tap()
    await teclado(page, ap.a, true)
    await sleep(450)
    const v = await campoVisivel(page)
    const b = await botaoVisivel(page, '[role="dialog"].sc-modal button[type="submit"]')
    const fk = await print(page, nome, 'codigo-com-teclado', { sub: SUB })
    ok(v.inteiro, `${nome}: teclado aberto no código: o campo fica à vista (${JSON.stringify(v)})`, { print: fk })
    ok(b?.visivel, `${nome}: teclado aberto no código: "Confirmar e-mail" à vista (${JSON.stringify(b)})`, { print: fk })
    await teclado(page, ap.a, false)
    // certo (colado com espaço, como vem do e-mail às vezes)
    await campo.fill('')
    await campo.focus()
    await colar(page, codigo)
    await dv.getByRole('button', { name: 'Confirmar e-mail' }).tap()
    await semDialogo(page, 15000).catch(() => {})
    await sleep(600)
    const fo = await print(page, nome, 'email-confirmado', { sub: SUB })
    const conf = sql(`SELECT IFNULL(email_verificado_em,'nulo') FROM usuarios WHERE email='${E}'`)
    ok(conf !== 'nulo', `${nome}: e-mail confirmado no servidor (${conf})`, { print: fo })
    ok(!ap.erros.length, `${nome}: sem erro no console (cadastro)`, { erros: ap.erros.slice(0, 5) })
  } finally {
    await ap.ctx.close()
  }
})

// ───────────────────────── rede ─────────────────────────
await etapa('rede', async () => {
  const nome = 'galaxy-a'
  const ap = await novoAparelho(browser, nome, { partidas: 5 })
  try {
    const { page, cdp } = ap
    const d = await abrirConvite(ap)
    const E = email('rede')
    await d.getByLabel('Apelido').fill('Sem Rede')
    await d.getByLabel('E-mail').fill(E)
    await d.getByLabel('Senha', { exact: true }).fill(SENHA)
    await d.getByRole('checkbox').first().check()
    await offline(cdp, true)
    await d.getByRole('button', { name: 'Criar conta', exact: true }).tap()
    await d.locator('.sc-err').waitFor({ timeout: 20000 })
    const msg = (await d.locator('.sc-err').innerText()).trim()
    const f = await print(page, nome, 'criar-conta-sem-internet', { sub: SUB })
    ok(/conexão|internet/i.test(msg), `${nome}: criar conta sem internet → "${msg}"`, { print: f })
    await offline(cdp, false)
    ap.ignorar(/ERR_INTERNET_DISCONNECTED|Failed to load resource/)
    // 4G lento + CPU 4×: o botão mostra que está criando e a conta sai
    await lento(cdp)
    const t0 = Date.now()
    await d.getByRole('button', { name: 'Criar conta', exact: true }).tap()
    await sleep(250)
    const rot = (await d.locator('button[type="submit"]').innerText()).trim()
    const f2 = await print(page, nome, 'criar-conta-4g-lento-carregando', { sub: SUB })
    ok(/Criando/.test(rot), `${nome}: no 4G lento o botão vira "${rot}"`, { print: f2 })
    await dialogo(page, 'Confirme seu e-mail').waitFor({ timeout: 30000 })
    ok(true, `${nome}: conta criada no 4G lento + CPU 4× em ${((Date.now() - t0) / 1000).toFixed(1)} s`)
    await semLentidao(cdp)
    ok(!ap.erros.length, `${nome}: sem erro no console (rede)`, { erros: ap.erros.slice(0, 5) })
  } finally {
    await ap.ctx.close()
  }
})

// ───────────────────────── lento: o diálogo de conta no 4G lento, logo que a Home abre ─────────────────────────
await etapa('lento', async () => {
  for (const nome of ['galaxy-a', 'tiktok-android']) {
    const ap = await novoAparelho(browser, nome, { lento: true })
    const { page } = ap
    try {
      const t0 = Date.now()
      await page.goto(URL0, { waitUntil: 'commit', timeout: 120000 })
      await page.getByRole('button', { name: 'Menu' }).first().waitFor({ state: 'visible', timeout: 180000 })
      const tMenu = Date.now() - t0
      await page.getByRole('button', { name: 'Menu' }).first().tap()
      const m = page.getByRole('dialog', { name: 'Menu' })
      await m.waitFor({ timeout: 60000 })
      const linha = m.getByText(/Entrar \/ Criar conta|^Entrar$/)
      const tL0 = Date.now()
      await linha.waitFor({ timeout: 60000 })
      const tLinha = Date.now() - tL0
      await linha.tap()
      const t1 = Date.now()
      const fotos = []
      let visto = false
      for (let i = 0; i < 40 && !visto; i++) {
        await sleep(250)
        visto = (await dialogo(page).count()) > 0 && (await dialogo(page).isVisible().catch(() => false))
        if (i === 3) fotos.push(await print(page, nome, '4g-lento-1s-depois-de-tocar-entrar', { sub: SUB }))
      }
      const tDialogo = Date.now() - t1
      const f = await print(page, nome, '4g-lento-dialogo-de-conta', { sub: SUB })
      console.log(`      ${nome}: menu à vista em ${(tMenu / 1000).toFixed(1)} s; linha da conta no menu +${(tLinha / 1000).toFixed(1)} s; diálogo ${(tDialogo / 1000).toFixed(1)} s depois do toque`)
      ok(visto && tDialogo <= 1500, `${nome} (4G lento + CPU 4×, logo depois de abrir): "Entrar / Criar conta" abre o diálogo em ${(tDialogo / 1000).toFixed(1)} s (o menu fecha na hora e, até lá, nada na tela diz que está carregando)`, { print: f, antes: fotos[0] })
      ok(!ap.erros.length, `${nome}: sem erro no console (lento)`, { erros: ap.erros.slice(0, 5) })
    } finally {
      await ap.ctx.close()
    }
  }
})

await browser.close()
process.exit(fim('cadastro') ? 1 : 0)
