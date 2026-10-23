// LENDA v3.5 · painel no celular — 5. AS CORREÇÕES do grupo "painel" da revisão mobile, conferidas uma a uma (e o
// computador em 1366×900, que não pode mudar):
//   · a aba começa logo abaixo do topo (o "Precisa de atenção" recolhido numa linha, os números numa faixa) e trocar de
//     aba (ou tocar num alerta) leva até o título; a aba ativa fica no meio da barra de abas;
//   · voltar do Android: fechar a ficha pelo botão não deixa a ficha para o próximo "voltar"; com um diálogo aberto por
//     cima da ficha, o voltar fecha os dois; arrastar o cabeçalho da ficha não rola a lista de trás;
//   · campos com 16 px (sem zoom do iPhone), também deitado; alvos de 40 px nos que a revisão apontou;
//   · cartões sem valor cortado e sem rolagem lateral em 320 px (Conquistas, Usuários, Desafios, Registro, PIN);
//   · pílula de novidade numa linha e acima da barra de lote; barra de salvar solta com o teclado aberto;
//   · deitado: barra de lote fixa à vista e o topo com menos de 20% da altura;
//   · menu "⋯" (Aparência, Discreto, Abrir o jogo, estado do site, Sair com confirmação); dica "/" escondida;
//   · Safari antigo: PIN sem requestSubmit entra sozinho; diálogo sem showModal abre com véu e fecha no Esc.
//   LENDA_PAINEL_BASE=<pasta da pilha> node servidor/teste/mobile/painel-correcoes.mjs
// Precisa da pilha local do painel-rodar.sh (com LENDA_PAINEL_MOBILE_MANTER=1) e da sessão do Dono que o
// painel-entrada.mjs grava. Só mexe na pilha local (marca e desmarca, abre e cancela diálogos; entra de novo com o PIN).
import { readFileSync } from 'node:fs'
import { BASE, PAINEL, PIN_DONO, abrir, env, esperarDecisao, esperarPulso, irAba, lancar, medir, print, sleep, teclado } from './painel-lib.mjs'

const ESTADO = JSON.parse(readFileSync(`${BASE}/estado-dono.json`, 'utf8'))
const PEDIDAS = process.argv.slice(2)
const quer = (s) => !PEDIDAS.length || PEDIDAS.includes(s)
const falhas = []
let oks = 0
const ok = (c, txt) => { console.log(`  ${c ? 'ok' : 'XX'}  ${txt}`); if (c) oks++; else falhas.push(txt); return c }
const browser = await lancar()
const aba = '.aba:not([hidden])'
const erros = []

async function aberto(nome, o = {}) {
  const ap = o.desktop
    ? await (async () => {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', storageState: ESTADO })
      const page = await ctx.newPage()
      const e = []
      page.on('pageerror', (x) => e.push(`pageerror: ${x.message}`))
      page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) e.push(m.text()) })
      return { ctx, page, erros: e, nome: 'desktop-1366', a: { w: 1366, h: 900 }, cdp: await ctx.newCDPSession(page) }
    })()
    : await abrir(browser, nome, { estado: ESTADO, ...o })
  await ap.page.goto(PAINEL + (o.hash ?? '#/visao'))
  await esperarDecisao(ap.page)
  if (!(await ap.page.isVisible('#tela-painel'))) throw new Error('a sessão do Dono não abriu (rode o painel-entrada.mjs)')
  await esperarPulso(ap.page, 60000)
  await ap.page.waitForSelector('#atencao:not([hidden])', { timeout: 20000 }).catch(() => {})
  await sleep(600)
  return ap
}
async function fechar(ap) { erros.push(...ap.erros.map((e) => `${ap.nome}: ${e}`)); await ap.ctx.close() }
async function secao(nome, fn) {
  if (!quer(nome)) return
  console.log(`\n── ${nome} ──`)
  try { await fn() } catch (e) { ok(false, `${nome}: o bloco parou — ${String(e?.message ?? e).split('\n')[0]}`) }
}
const geo = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), jw: innerWidth, jh: innerHeight } }, sel)
const estadoFicha = (page) => page.evaluate(() => ({ hash: location.hash, ficha: !document.getElementById('gaveta').hidden, dialogos: document.querySelectorAll('dialog[open], .dialogo-sem-modal').length }))

// ═══ 1. onde a aba começa; tocar num alerta; trocar de aba rolado; a aba ativa na barra ═══
await secao('topo', async () => {
  for (const nome of ['galaxy-a', 'pequeno-320', 'deitado']) {
    const ap = await aberto(nome)
    const { page } = ap
    const t = await page.evaluate(() => ({ y: Math.round(document.getElementById('titulo-aba').getBoundingClientRect().top + scrollY), at: Math.round(document.getElementById('atencao').getBoundingClientRect().height), nums: Math.round(document.getElementById('numeros-acao').getBoundingClientRect().height), jh: innerHeight }))
    ok(t.y < t.jh * 0.5 || (nome === 'deitado' && t.y < t.jh), `${nome}: a aba começa em y=${t.y} (janela ${t.jh}) · atenção ${t.at}px · números ${t.nums}px`)
    ok(t.at <= 60 && t.nums <= 72, `${nome}: "Precisa de atenção" recolhido numa linha e os números numa faixa (${t.at}px, ${t.nums}px)`)
    // abrir a caixa, tocar no alerta das denúncias: a caixa recolhe e a lista aparece
    await page.locator('#atencao .atencao-dobrar').tap()
    await sleep(300)
    ok(await page.isVisible('#atencao .atencao-lista'), `${nome}: tocar em "${(await page.textContent('#atencao .atencao-dobrar')).trim()}" abre a lista de alertas`)
    const link = page.locator('#atencao a.atencao-texto', { hasText: /denúncia/ }).first()
    if (await link.count()) {
      await link.tap()
      await sleep(1800)
      const d = await page.evaluate(() => ({ hash: location.hash, titulo: Math.round(document.getElementById('titulo-aba').getBoundingClientRect().top), jh: innerHeight, recolhida: !document.getElementById('atencao').classList.contains('aberta') }))
      ok(d.titulo >= 0 && d.titulo < d.jh * 0.6 && d.recolhida, `${nome}: depois do toque no alerta (${d.hash}) o título da aba está à vista (y=${d.titulo} de ${d.jh}) e a caixa recolheu`)
      await print(page, nome, 'corr-depois-do-alerta', { dir: process.env.LENDA_PRINTS_CORR })
    }
    // rolado lá embaixo, troca de aba pelo link do número "Mensagens": o título aparece
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await sleep(200)
    await page.evaluate(() => { location.hash = '#/testes' })
    await sleep(1500)
    const t2 = await page.evaluate(() => {
      const nav = document.getElementById('abas'); const a = nav.querySelector('a[aria-current="page"]')
      const ra = a.getBoundingClientRect(); const rn = nav.getBoundingClientRect()
      return { titulo: Math.round(document.getElementById('titulo-aba').getBoundingClientRect().top), jh: innerHeight, ativa: [Math.round(ra.left), Math.round(ra.right)], barra: [Math.round(rn.left), Math.round(rn.right)] }
    })
    ok(t2.titulo >= 0 && t2.titulo < t2.jh * 0.6, `${nome}: trocar de aba com a página rolada mostra o título (y=${t2.titulo} de ${t2.jh})`)
    ok(t2.ativa[0] >= t2.barra[0] - 1 && t2.ativa[1] <= t2.barra[1] + 1, `${nome}: a aba ativa (Testes, a última) aparece inteira na barra (${t2.ativa} em ${t2.barra})`)
    const m = await medir(page)
    ok(m.lateral <= 0, `${nome}: sem rolagem lateral (${m.lateral})`)
    await fechar(ap)
  }
})

// ═══ 2. ficha: voltar do Android, diálogo por cima, cabeçalho arrastado, Voltar só com a seta ═══
await secao('ficha', async () => {
  // começa na Visão geral: a lista de Usuários é uma entrada do histórico (o "voltar" de lá sai do painel)
  const ap = await aberto('galaxy-a', { hash: '#/visao' })
  const { page, cdp } = ap
  await irAba(page, '#/usuarios')
  const abrirFicha = async (i = 0) => {
    await page.locator(`${aba} tr.clicavel`).nth(i).tap()
    await page.waitForSelector('#gaveta:not([hidden]) .gaveta-corpo .perfil', { timeout: 20000 })
    await sleep(400)
  }
  await abrirFicha()
  const v = await page.evaluate(() => { const b = document.querySelector('#gaveta .gaveta-voltar'); const r = b.getBoundingClientRect(); const t = document.getElementById('gaveta-titulo'); return { w: Math.round(r.width), h: Math.round(r.height), nome: b.getAttribute('aria-label'), titulo: [t.clientWidth, t.scrollWidth] } })
  ok(v.w <= 44 && v.h >= 40 && /Voltar para Usuários/.test(v.nome), `"Voltar" só com a seta em 360 (${v.w}×${v.h}, aria-label "${v.nome}")`)
  ok(v.titulo[1] <= v.titulo[0], `o nome da ficha cabe no cabeçalho (${v.titulo[1]} ≤ ${v.titulo[0]})`)
  // arrastar o dedo no cabeçalho da ficha não rola a lista de trás
  const y0 = await page.evaluate(() => scrollY)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 30 }] })
  for (let k = 1; k <= 10; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 30 + k * 30 }] }); await sleep(16) }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.mouse.move(180, 500)
  await page.mouse.wheel(0, 900)
  await sleep(600)
  ok((await page.evaluate(() => scrollY)) === y0, `arrastar o cabeçalho (e a roda) com a ficha aberta não rola a lista de trás (scrollY ${y0})`)
  // fechar pelo botão e "voltar": não reabre
  await page.locator('#gaveta .gaveta-voltar').tap()
  await sleep(700)
  let e = await estadoFicha(page)
  ok(!e.ficha && /usuarios/.test(e.hash), `"Voltar" fecha a ficha (${e.hash})`)
  await page.evaluate(() => history.back())
  await sleep(1200)
  e = await estadoFicha(page)
  ok(!e.ficha, `depois de fechar pelo botão, o voltar do Android não reabre a ficha (${JSON.stringify(e)})`)
  if (!/usuarios/.test(e.hash)) { await page.evaluate(() => { location.hash = '#/usuarios' }); await sleep(1500) }
  // Esc também fecha voltando
  await abrirFicha(1)
  await page.keyboard.press('Escape')
  await sleep(700)
  await page.evaluate(() => history.back())
  await sleep(1200)
  e = await estadoFicha(page)
  ok(!e.ficha, `Esc fecha a ficha e o voltar seguinte não a reabre (${JSON.stringify(e)})`)
  if (!/usuarios/.test(e.hash)) { await page.evaluate(() => { location.hash = '#/usuarios' }); await sleep(1500) }
  // Esc e, no mesmo instante, outra navegação (um atalho, um toque): a volta do Esc chega depois e não a desfaz
  await abrirFicha()
  await page.evaluate(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); location.hash = '#/denuncias' })
  await sleep(1500)
  e = await estadoFicha(page)
  ok(e.hash === '#/denuncias' && !e.ficha, `Esc fecha a ficha e uma navegação feita no mesmo instante vale (${JSON.stringify(e)})`)
  await page.evaluate(() => { location.hash = '#/usuarios' })
  await sleep(1500)
  // diálogo por cima da ficha + voltar: os dois fecham
  await abrirFicha()
  await page.locator('#gaveta button:has-text("Suspender")').first().tap()
  await page.waitForSelector('dialog[open]', { timeout: 10000 })
  await page.evaluate(() => history.back())
  await sleep(1200)
  e = await estadoFicha(page)
  ok(!e.ficha && e.dialogos === 0, `voltar com o diálogo "Suspender" aberto por cima da ficha fecha os dois (${JSON.stringify(e)})`)
  // recarregar com a ficha aberta (sem a lista antes no histórico desta página): fechar não sai do painel
  await abrirFicha()
  await page.reload()
  await esperarDecisao(page)
  await page.waitForSelector('#gaveta:not([hidden]) .gaveta-corpo .perfil', { timeout: 20000 })
  await page.locator('#gaveta .gaveta-voltar').tap()
  await sleep(800)
  e = await estadoFicha(page)
  ok(!e.ficha && /usuarios/.test(e.hash) && !/conta=/.test(e.hash), `ficha aberta pelo endereço (recarregar): "Voltar" fecha e fica na lista (${e.hash})`)
  await fechar(ap)
})

// ═══ 3. campos de 16 px e alvos de 40 px ═══
await secao('campos', async () => {
  for (const nome of ['iphone-14', 'deitado']) {
    const ap = await aberto(nome, { hash: '#/registro' })
    const { page } = ap
    await irAba(page, '#/registro')
    let m = await medir(page)
    ok(!m.fonteCampo.length, `${nome}: Registro sem campo < 16 px (${m.fonteCampo.map((f) => f.campo + ' ' + f.fonte).join(', ') || 'nenhum'})`)
    await irAba(page, '#/usuarios')
    await page.locator(`${aba} tr.clicavel`).first().tap()
    await page.waitForSelector('#gaveta:not([hidden]) .perfil', { timeout: 20000 })
    await page.locator('#gaveta button:has-text("Suspender")').first().tap()
    await page.waitForSelector('dialog[open]', { timeout: 10000 })
    m = await medir(page, { raiz: 'dialog[open]' })
    ok(!m.fonteCampo.length, `${nome}: diálogo "Suspender" sem campo < 16 px (${m.fonteCampo.map((f) => f.campo + ' ' + f.fonte).join(', ') || 'nenhum'})`)
    await page.locator('dialog[open] button:has-text("Cancelar")').tap()
    await fechar(ap)
  }
  // a entrada (sem sessão)
  const ctx = await abrir(browser, 'iphone-se')
  await ctx.page.goto(PAINEL)
  await esperarDecisao(ctx.page)
  const fs = await ctx.page.evaluate(() => ['email', 'senha'].map((id) => parseFloat(getComputedStyle(document.getElementById(id)).fontSize)))
  ok(fs.every((x) => x >= 16), `entrada: e-mail e senha com 16 px (${fs.join(', ')})`)
  await ctx.ctx.close()
  // alvos que a revisão apontou
  const ap = await aberto('galaxy-a', { hash: '#/denuncias' })
  const { page } = ap
  await irAba(page, '#/denuncias')
  const cx = await geo(page, `${aba} .denuncia-topo .alvo-caixa`)
  ok(!cx || (cx.w >= 40 && cx.h >= 40), `caixa de marcar das Denúncias com 40 px (${cx ? cx.w + '×' + cx.h : 'sem caixa'})`)
  await irAba(page, '#/visao')
  const alvos = await page.evaluate(() => [['Ver tabela', '.tabela-detalhe summary'], ['incluir robôs/testes', 'label.caixa'], ['logo', '.lateral .marca'], ['⋯', '.botao-menu']].map(([n, s]) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return [n, Math.round(r.width), Math.round(r.height)] }))
  ok(alvos.every(([, w, h]) => w >= 40 && h >= 40), `alvos da Visão geral com 40 px: ${alvos.map((a) => a.join(' ')).join(' · ')}`)
  await page.locator('#atencao .atencao-dobrar').tap()
  const lk = await geo(page, '#atencao a.atencao-texto')
  ok(lk && lk.h >= 40, `links dos alertas com 40 px de altura (${lk && lk.h})`)
  await fechar(ap)
})

// ═══ 4. 320 px: cartões sem corte, sem rolagem lateral; PIN cabe ═══
await secao('320', async () => {
  const ap = await aberto('pequeno-320')
  const { page } = ap
  for (const h of ['#/usuarios', '#/conquistas', '#/desafios', '#/desafios?parte=novo', '#/registro', '#/mensagens', '#/equipe', '#/testes']) {
    await irAba(page, h, 1000)
    const r = await page.evaluate(() => {
      const de = document.documentElement
      const sec = document.querySelector('.aba:not([hidden])')
      const rolam = [...sec.querySelectorAll('.rolagem')].filter((x) => x.querySelector('.lista.cartoes') && x.scrollWidth > x.clientWidth + 1).length
      const vazam = [...sec.querySelectorAll('.lista.cartoes td')].filter((td) => td.scrollWidth > td.clientWidth + 2).map((td) => td.dataset.rotulo + ': ' + td.textContent.trim().slice(0, 20))
      return { lateral: de.scrollWidth - de.clientWidth, rolam, vazam: vazam.slice(0, 4) }
    })
    ok(r.lateral <= 0 && !r.rolam && !r.vazam.length, `320 ${h}: sem rolagem lateral (${r.lateral}), lista sem rolar de lado (${r.rolam}), nenhum valor vazando da célula (${r.vazam.join(' · ') || 'nenhum'})`)
  }
  await fechar(ap)
  // PIN: entra com a senha, para no PIN e mede as 6 caixas (não confirma)
  const p = await abrir(browser, 'pequeno-320')
  await p.page.goto(PAINEL)
  await esperarDecisao(p.page)
  await p.page.fill('#senha', env.PAINEL_SENHA)
  await p.page.locator('#botao-entrar').tap()
  await p.page.waitForSelector('#form-pin:not([hidden])', { timeout: 15000 })
  const pin = await p.page.evaluate(() => { const cs = [...document.querySelectorAll('#pin-caixas .pin-caixa')].map((c) => c.getBoundingClientRect()); const c = document.getElementById('cartao-entrar').getBoundingClientRect(); return { de: Math.round(cs[0].left), ate: Math.round(cs[5].right), cartao: [Math.round(c.left), Math.round(c.right)], lateral: document.documentElement.scrollWidth - innerWidth } })
  ok(pin.de >= pin.cartao[0] && pin.ate <= pin.cartao[1] && pin.lateral <= 0, `320: as 6 caixas do PIN cabem no cartão (${pin.de}..${pin.ate} em ${pin.cartao}, lateral ${pin.lateral})`)
  await p.ctx.close()
})

// ═══ 5. lote + novidade + aviso; barra de salvar com o teclado ═══
await secao('lote', async () => {
  const ap = await aberto('galaxy-a', { hash: '#/denuncias' })
  const { page } = ap
  await irAba(page, '#/denuncias')
  const c = page.locator(`${aba} input[type="checkbox"]:not([disabled])`).first()
  await c.scrollIntoViewIfNeeded()
  await c.tap()
  await sleep(400)
  await page.evaluate(() => window.LP.novidade('1 carreira denunciada nova — clique para ver', () => {}))
  await sleep(300)
  const nv = await geo(page, '#novidade')
  const it = await geo(page, '#novidade .novidade-item')
  const br = await geo(page, `${aba} .barra-lote.com-marcados`)
  ok(br && br.bottom === br.jh, `com algo marcado a barra de lote fica fixa no rodapé (${br && br.top}..${br && br.bottom})`)
  ok(nv.bottom <= br.top, `a pílula de novidade fica acima da barra de lote (pílula ${nv.top}..${nv.bottom}, barra ${br.top}..${br.bottom})`)
  ok(it.h <= 48 && it.right <= it.jw && it.left >= 0, `a pílula fica numa linha só, dentro da tela (${it.w}×${it.h}: "${(await page.textContent('#novidade .novidade-botao')).trim()}")`)
  await page.evaluate(() => window.LP.avisar('Teste: aviso com a barra de lote e a novidade.', 'info', 5000))
  await sleep(300)
  const av = await geo(page, '#avisos .aviso-flutuante')
  const nv2 = await geo(page, '#novidade')
  ok(av.bottom <= br.top && (nv2.bottom <= av.top || av.bottom <= nv2.top), `o aviso fica acima da barra e não cruza a pílula (aviso ${av.top}..${av.bottom}, pílula ${nv2.top}..${nv2.bottom}, barra ${br.top})`)
  await print(page, 'galaxy-a', 'corr-lote-novidade-aviso', { dir: process.env.LENDA_PRINTS_CORR })
  await page.evaluate(() => window.LP.esconderNovidade('todas'))
  await page.locator(`${aba} .barra-lote button:has-text("Desmarcar")`).tap()
  // Configurações: número com o teclado aberto
  await irAba(page, '#/config')
  const n = page.locator(`${aba} input[type="number"]:not([disabled])`).first()
  await n.scrollIntoViewIfNeeded()
  await n.tap()
  await page.keyboard.press('ArrowUp')
  await sleep(300)
  await teclado(page, ap.a, true)
  const info = await page.evaluate(() => {
    const f = document.activeElement.getBoundingClientRect()
    const b = document.querySelector('.aba:not([hidden]) .barra-salvar')
    const rb = b && !b.hidden ? b.getBoundingClientRect() : null
    return { campo: [Math.round(f.top), Math.round(f.bottom)], barra: rb ? [Math.round(rb.top), Math.round(rb.bottom)] : null, jh: innerHeight }
  })
  ok(info.barra && !(info.campo[1] > info.barra[0] && info.campo[0] < info.barra[1]) && info.campo[1] <= info.jh, `Configurações com o teclado aberto: a barra "não salva" não cobre o campo (${JSON.stringify(info)})`)
  await teclado(page, ap.a, false)
  await page.locator('#titulo-aba').tap()
  await sleep(300)
  const b2 = await page.evaluate(() => { const b = document.querySelector('.aba:not([hidden]) .barra-salvar'); return getComputedStyle(b).position })
  ok(b2 === 'sticky', `teclado fechado: a barra de salvar volta a ficar presa no rodapé (${b2})`)
  const desc = page.locator(`${aba} .barra-salvar button`, { hasText: 'Descartar' })
  if (await desc.count()) await desc.first().tap()
  await fechar(ap)
})

// ═══ 6. deitado: barra de lote à vista no fim da lista; topo baixo ═══
await secao('deitado', async () => {
  const ap = await aberto('deitado', { hash: '#/hall' })
  const { page } = ap
  await irAba(page, '#/hall')
  const caixas = page.locator(`${aba} td.selecao input:not([disabled])`)
  for (let i = 0; i < 2; i++) { await caixas.nth(i).scrollIntoViewIfNeeded(); await caixas.nth(i).tap(); await sleep(150) }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await sleep(500)
  const g = await geo(page, `${aba} .barra-lote.com-marcados`)
  ok(g && g.top >= 0 && g.bottom <= g.jh, `deitado, rolado até o fim: a barra de lote continua à vista (${g && g.top}..${g && g.bottom} de ${g && g.jh})`)
  const topo = await geo(page, '.lateral')
  ok(topo.h / topo.jh <= 0.2, `deitado: o topo fixo ocupa ${topo.h}px de ${topo.jh}px (${Math.round((100 * topo.h) / topo.jh)}%)`)
  await print(page, 'deitado', 'corr-lote-no-fim', { dir: process.env.LENDA_PRINTS_CORR })
  await page.locator(`${aba} .barra-lote button:has-text("Desmarcar")`).tap()
  await fechar(ap)
})

// ═══ 7. menu "⋯", dica "/" e o que só existia no computador ═══
await secao('menu', async () => {
  const ap = await aberto('galaxy-a', { hash: '#/usuarios' })
  const { page } = ap
  await irAba(page, '#/usuarios')
  const kbd = await page.evaluate(() => { const k = document.querySelector('.aba:not([hidden]) .busca kbd'); return k ? getComputedStyle(k).display : 'sem' })
  ok(kbd === 'none' || kbd === 'sem', `a dica "/" não aparece na busca do celular (${kbd})`)
  await page.locator('.botoes-topo-celular [data-acao="menu"]').tap()
  await page.waitForSelector('dialog[open] .menu-celular', { timeout: 5000 })
  const menu = await page.evaluate(() => {
    const d = document.querySelector('dialog[open]')
    return { chips: [...d.querySelectorAll('.menu-estado .chip')].map((c) => c.textContent), temas: d.querySelectorAll('.segmentos button').length, discreto: !!d.querySelector('input[role="switch"]'), jogo: !!d.querySelector('a[href="../"]'), sair: !!d.querySelector('.botao-perigo') }
  })
  ok(menu.chips.length && menu.temas === 3 && menu.discreto && menu.jogo && menu.sair, `menu "⋯": estado do site (${menu.chips.join(' · ')}), 3 aparências, Discreto, Abrir o jogo e Sair`)
  await page.locator('dialog[open] .segmentos button', { hasText: 'Claro' }).tap()
  await sleep(300)
  ok((await page.evaluate(() => document.documentElement.getAttribute('data-tema'))) === 'claro', 'menu "⋯": tocar em "Claro" troca a aparência')
  await page.locator('dialog[open] .segmentos button', { hasText: 'Original' }).tap()
  const antes = await page.evaluate(() => document.documentElement.getAttribute('data-discreto'))
  await page.locator('dialog[open] label.interruptor').tap()
  await sleep(200)
  ok((await page.evaluate(() => document.documentElement.getAttribute('data-discreto'))) !== antes, 'menu "⋯": o interruptor liga/desliga o modo discreto')
  await page.locator('dialog[open] label.interruptor').tap()
  await page.locator('dialog[open] .botao-perigo', { hasText: 'Sair' }).tap()
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 2, null, { timeout: 5000 })
  ok(/Sair do painel\?/.test(await page.textContent('dialog[open]:last-of-type h2')), 'Sair pergunta antes ("Sair do painel?")')
  await page.locator('dialog[open]:last-of-type button:has-text("Cancelar")').tap()
  await sleep(300)
  await page.keyboard.press('Escape')
  await sleep(300)
  ok(await page.isVisible('#tela-painel'), 'cancelar o "Sair" mantém o painel aberto')
  await fechar(ap)
})

// ═══ 8. Safari antigo: PIN sem requestSubmit; diálogo sem showModal ═══
await secao('safari', async () => {
  const ap = await abrir(browser, 'iphone-se')
  await ap.ctx.addInitScript(() => { try { delete HTMLFormElement.prototype.requestSubmit } catch {} })
  const { page } = ap
  await page.goto(PAINEL)
  await esperarDecisao(page)
  await page.fill('#senha', env.PAINEL_SENHA)
  await page.locator('#botao-entrar').tap()
  await page.waitForSelector('#form-pin:not([hidden])', { timeout: 15000 })
  await page.locator('#pin-caixas .pin-caixa').first().tap()
  await page.keyboard.type(PIN_DONO, { delay: 40 })
  const entrou = await page.waitForSelector('#tela-painel:not([hidden])', { timeout: 10000 }).then(() => true).catch(() => false)
  ok(entrou && !ap.erros.some((e) => /requestSubmit/.test(e)), `sem form.requestSubmit (iOS 15), o 6º dígito do PIN entra sozinho (${ap.erros.join(' | ') || 'sem erro'})`)
  await ap.ctx.close()
  const d = await abrir(browser, 'iphone-se', { estado: ESTADO })
  await d.ctx.addInitScript(() => { try { delete HTMLDialogElement.prototype.showModal } catch {} })
  await d.page.goto(PAINEL + '#/visao')
  await esperarDecisao(d.page)
  await esperarPulso(d.page)
  await d.page.locator('.botoes-topo-celular [data-acao="menu"]').tap()
  await sleep(400)
  const g = await geo(d.page, '.dialogo-sem-modal')
  const veu = await d.page.evaluate(() => !!document.querySelector('.dialogo-veu'))
  ok(g && veu && g.top >= 0 && g.bottom <= g.jh && g.left >= 0 && g.right <= g.jw, `sem showModal (Safari < 15.4): o diálogo abre no meio, por cima de um véu (${JSON.stringify(g)})`)
  await d.page.keyboard.press('Escape')
  await sleep(300)
  ok(!(await d.page.evaluate(() => !!document.querySelector('.dialogo-sem-modal, .dialogo-veu'))), 'Esc fecha o diálogo (e o véu)')
  erros.push(...d.erros.map((e) => `iphone-se sem showModal: ${e}`))
  await d.ctx.close()
})

// ═══ 9. o computador (1366×900) continua como era ═══
await secao('computador', async () => {
  const ap = await aberto(null, { desktop: true })
  const { page } = ap
  const r = await page.evaluate(() => ({
    lista: getComputedStyle(document.querySelector('#atencao .atencao-lista')).display !== 'none',
    botao: getComputedStyle(document.querySelector('#atencao .atencao-dobrar')).display,
    numeros: getComputedStyle(document.getElementById('numeros-acao')).display,
    lateral: getComputedStyle(document.querySelector('.lateral-pe')).display,
    menu: getComputedStyle(document.querySelector('.botoes-topo-celular')).display,
    rolagem: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    fonte: getComputedStyle(document.body).fontSize,
  }))
  ok(r.lista && r.botao === 'none' && r.numeros === 'grid' && r.lateral !== 'none' && r.menu === 'none' && r.rolagem <= 0 && r.fonte === '14.5px', `1366: atenção aberta, números em grade, pé da lateral à vista, sem "⋯", sem rolagem lateral (${JSON.stringify(r)})`)
  await page.evaluate(() => window.scrollTo(0, 900))
  await page.evaluate(() => { location.hash = '#/usuarios' })
  await sleep(1500)
  ok((await page.evaluate(() => scrollY)) === 0, '1366: trocar de aba volta ao topo, como antes')
  const kbd = await page.evaluate(() => getComputedStyle(document.querySelector('.aba:not([hidden]) .busca kbd')).display)
  ok(kbd !== 'none', '1366: a dica "/" continua na busca')
  await page.locator(`${aba} tr.clicavel`).first().click()
  await page.waitForSelector('#gaveta:not([hidden]) .perfil', { timeout: 20000 })
  const gv = await geo(page, '#gaveta')
  const txt = await page.isVisible('#gaveta .gaveta-voltar-texto')
  ok(gv.w <= 560 && gv.right >= (await page.evaluate(() => document.documentElement.clientWidth)) - 1 && txt, `1366: a ficha abre ao lado (${gv.w}px) com "Voltar para Usuários" escrito`)
  await page.locator('#gaveta .gaveta-voltar').click()
  await sleep(600)
  await page.goBack()
  await sleep(1000)
  ok(!(await estadoFicha(page)).ficha, '1366: fechar a ficha e voltar não reabre a ficha')
  await print(page, 'desktop-1366', 'corr-visao', { dir: process.env.LENDA_PRINTS_CORR })
  await fechar(ap)
})

await browser.close()
if (erros.length) { console.log(`\n  XX  erros no console: ${[...new Set(erros)].slice(0, 8).join(' | ')}`); falhas.push('erros no console') }
console.log(`\npainel no celular (correções): ${oks} ok, ${falhas.length} falha(s)`)
for (const f of falhas) console.log(`  - ${f}`)
process.exitCode = falhas.length ? 1 : 0
