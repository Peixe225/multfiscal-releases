// LENDA v3.5 · painel no celular — 3. O QUE O DONO FAZ PELO CELULAR: ficha em tela cheia, voltar do Android, recarregar,
// girar, diálogos de motivo com o teclado aberto, lote com a barra no rodapé (e o aviso de novidade junto), busca,
// Mensagens (responder), Configurações (barra de salvar, sair sem salvar), tema, gráfico por toque, "Precisa de atenção",
// sem rede e 4G lento.
//   LENDA_PAINEL_BASE=<pasta da pilha> node servidor/teste/mobile/painel-acoes.mjs [seção…]
// Seções: ficha hall lote novidade busca mensagens config tema grafico atencao girar rede lento (padrão: todas).
// Mexe só na pilha local (oculta carreiras, responde uma mensagem, marca lote): rode depois do painel-entrada.mjs.
import { readFileSync } from 'node:fs'
import { BASE, PAINEL, abrir, esperarDecisao, esperarPulso, irAba, lancar, lento, medir, offline, print, relatar, sleep, sql, teclado } from './painel-lib.mjs'
import { pedido } from '../painel/lib.mjs'

const ESTADO = JSON.parse(readFileSync(`${BASE}/estado-dono.json`, 'utf8'))
const S = JSON.parse(readFileSync(`${BASE}/semente.json`, 'utf8'))
const PEDIDAS = process.argv.slice(2)
const quer = (s) => !PEDIDAS.length || PEDIDAS.includes(s)
const achados = []
const nota = (txt) => { achados.push(txt); console.log(`  !!  ${txt}`) }
const ok = (c, txt) => { console.log(`  ${c ? 'ok' : '!!'}  ${txt}`); if (!c) achados.push(txt); return c }
const browser = await lancar()

async function aberto(nome = 'galaxy-a', o = {}) {
  const ap = await abrir(browser, nome, { estado: ESTADO, ...o })
  await ap.page.goto(PAINEL + (o.hash ?? '#/visao'))
  await esperarDecisao(ap.page)
  if (!(await ap.page.isVisible('#tela-painel'))) throw new Error('a sessão do Dono não abriu (rode o painel-entrada.mjs)')
  await esperarPulso(ap.page, 60000)
  await sleep(800)
  return ap
}
async function secao(nome, fn) {
  if (!quer(nome)) return
  console.log(`\n── ${nome} ──`)
  try { await fn() } catch (e) { nota(`${nome}: o bloco parou — ${String(e?.message ?? e).split('\n')[0]}`) }
}
const aba = '.aba:not([hidden])'
const estadoGaveta = (page) => page.evaluate(() => ({ hash: location.hash, gaveta: !document.getElementById('gaveta').hidden, dialogos: document.querySelectorAll('dialog[open]').length, titulo: document.getElementById('titulo-aba').textContent, y: Math.round(scrollY) }))
const caixa = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), w: Math.round(r.width), janela: [innerWidth, innerHeight] } }, sel)

// ═══ ficha da conta em tela cheia, voltar, recarregar ═══
await secao('ficha', async () => {
  const ap = await aberto('galaxy-a', { hash: '#/visao' })
  const { page } = ap
  await irAba(page, '#/usuarios')
  await page.locator(`${aba} tr.clicavel`).first().tap()
  await page.waitForSelector('#gaveta:not([hidden]) .gaveta-corpo .perfil', { timeout: 20000 })
  await sleep(800)
  const g = await caixa(page, '#gaveta')
  ok(g.left === 0 && g.right === g.janela[0] && g.top === 0 && g.bottom === g.janela[1], `ficha em tela cheia (${JSON.stringify(g)})`)
  const m = await medir(page, { raiz: '#gaveta' })
  relatar('ficha da conta (galaxy-a)', m, { fonte: true })
  if (m.pequenos.length) nota(`ficha da conta: ${m.pequenos.length} alvos < 40px: ${m.pequenos.slice(0, 8).map((p) => `"${p.nome}" ${p.w}×${p.h}`).join(' · ')}`)
  if (m.vazam.length) nota(`ficha da conta: conteúdo vaza: ${m.vazam.slice(0, 4).map((v) => `${v.rotulo ?? ''} "${v.texto}" ${v.w}<${v.sw}`).join(' · ')}`)
  await print(page, 'galaxy-a', 'ficha-conta')
  // rolagem: a ficha rola por dentro e a página de baixo fica parada
  const antes = await page.evaluate(() => scrollY)
  const corpo = page.locator('#gaveta .gaveta-corpo')
  const alt = await corpo.evaluate((e) => [e.scrollHeight, e.clientHeight])
  await corpo.evaluate((e) => e.scrollTo(0, e.scrollHeight))
  await page.mouse.move(180, 500)
  await page.mouse.wheel(0, 1200)
  await sleep(500)
  const depois = await page.evaluate(() => scrollY)
  ok(alt[0] > alt[1], `a ficha rola por dentro (${alt[0]} > ${alt[1]})`)
  ok(depois === antes, `rolando no fim da ficha a página de baixo não anda (scrollY ${antes} → ${depois})`)
  // o dedo arrastando no cabeçalho da ficha (Voltar · nome · ×): a lista de baixo rola escondida?
  const arrastar = async (x, y0, y1) => {
    await ap.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
    for (let k = 1; k <= 10; k++) { await ap.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * k) / 10 }] }); await sleep(16) }
    await ap.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(700)
  }
  const y0 = await page.evaluate(() => scrollY)
  await arrastar(250, 60, 320)
  const y1 = await page.evaluate(() => scrollY)
  ok(y1 === y0, `arrastar o dedo no cabeçalho da ficha não rola a lista escondida atrás (scrollY ${y0} → ${y1})`)
  await print(page, 'galaxy-a', 'ficha-conta-fim')
  await corpo.evaluate((e) => e.scrollTo(0, 0))
  // voltar do Android com a ficha aberta: fecha a ficha e fica em Usuários
  await page.evaluate(() => history.back())
  await sleep(1200)
  let e = await estadoGaveta(page)
  ok(!e.gaveta && /usuarios/.test(e.hash), `voltar com a ficha aberta fecha a ficha e fica na lista (${JSON.stringify(e)})`)
  // abrir de novo e fechar pelo botão "Voltar para Usuários"; depois o voltar do Android
  await page.locator(`${aba} tr.clicavel`).first().tap()
  await page.waitForSelector('#gaveta:not([hidden]) .gaveta-corpo .perfil', { timeout: 20000 })
  const rotVoltar = await page.textContent('#gaveta .gaveta-voltar')
  await page.locator('#gaveta .gaveta-voltar').tap()
  await sleep(800)
  e = await estadoGaveta(page)
  ok(!e.gaveta, `"${rotVoltar.trim()}" fecha a ficha`)
  await page.evaluate(() => history.back())
  await sleep(1500)
  e = await estadoGaveta(page)
  ok(!e.gaveta, `depois de fechar a ficha pelo botão, o voltar do Android não reabre a ficha (${JSON.stringify(e)})`)
  if (e.gaveta) await print(page, 'galaxy-a', 'voltar-reabre-ficha')
  if (e.gaveta) await page.locator('#gaveta .gaveta-voltar').tap().catch(() => {})
  // v3.5: fechar pelo botão já desfaz a entrada da ficha no histórico (history.back): o voltar seguinte vai para a aba
  // anterior. Volta para Usuários para seguir.
  if (!/usuarios/.test(e.hash)) await irAba(page, '#/usuarios')
  // recarregar com a ficha aberta: volta na mesma ficha
  await page.locator(`${aba} tr.clicavel`).nth(1).tap()
  await page.waitForSelector('#gaveta:not([hidden]) .gaveta-corpo .perfil', { timeout: 20000 })
  const h1 = await page.evaluate(() => location.hash)
  await page.reload()
  await esperarDecisao(page)
  const reabriu = await page.waitForSelector('#gaveta:not([hidden]) .gaveta-corpo .perfil', { timeout: 20000 }).then(() => true).catch(() => false)
  ok(reabriu && (await page.evaluate(() => location.hash)) === h1, `recarregar com a ficha aberta volta na mesma ficha (${h1})`)
  // diálogo aberto dentro da ficha + voltar do Android
  await page.locator('#gaveta button:has-text("Suspender")').first().tap()
  await page.waitForSelector('dialog[open]', { timeout: 10000 })
  await sleep(400)
  const d = await caixa(page, 'dialog[open]')
  const foco = await page.evaluate(() => ({ el: document.activeElement?.tagName + '#' + document.activeElement?.id, fonte: getComputedStyle(document.activeElement).fontSize }))
  console.log(`      diálogo Suspender: ${JSON.stringify(d)} · foco ao abrir: ${JSON.stringify(foco)}`)
  relatar('diálogo Suspender (galaxy-a)', await medir(page, { raiz: 'dialog[open]' }), { fonte: true })
  await print(page, 'galaxy-a', 'dialogo-suspender')
  await teclado(page, ap.a, true)
  const dT = await caixa(page, 'dialog[open]')
  const pe = await caixa(page, 'dialog[open] .dialogo-pe')
  const m2 = await medir(page, { raiz: 'dialog[open]' })
  ok(pe.bottom <= dT.janela[1] && pe.top >= 0, `com o teclado aberto o "Suspender conta" continua à vista (pé ${pe.top}..${pe.bottom}, janela ${dT.janela[1]})`)
  if (m2.coberto && (m2.coberto.fora || m2.coberto.porCima)) nota(`diálogo Suspender com teclado: campo focado escondido ${JSON.stringify(m2.coberto)}`)
  await print(page, 'galaxy-a', 'dialogo-suspender-com-teclado')
  await teclado(page, ap.a, false)
  await page.evaluate(() => history.back())
  await sleep(1200)
  e = await estadoGaveta(page)
  ok(!(e.dialogos > 0 && !e.gaveta), `voltar com o diálogo aberto por cima da ficha não deixa o diálogo solto sem a ficha (${JSON.stringify(e)})`)
  if (e.dialogos > 0) await print(page, 'galaxy-a', 'voltar-com-dialogo-na-ficha')
  for (let i = 0; i < 3 && (await page.locator('dialog[open]').count()); i++) await page.locator('dialog[open] button:has-text("Cancelar")').first().tap().catch(() => page.keyboard.press('Escape'))
  if (ap.erros.length) nota(`console (ficha): ${[...new Set(ap.erros)].slice(0, 4).join(' | ')}`)
  await ap.ctx.close()
})

// ═══ as três fichas (conta, carreira, mensagem) no celular pequeno e no de 360 ═══
await secao('fichas', async () => {
  const conta = S.contas['ReiDoDrible'].id
  const carreira = S.pkRevisao
  const msg = Number(sql('SELECT id FROM mensagens_suporte ORDER BY id LIMIT 1') || 0)
  for (const nome of ['pequeno-320', 'galaxy-a']) {
    const ap = await aberto(nome)
    const { page } = ap
    for (const [tipo, hash, pronto] of [['conta', `#/usuarios?conta=${conta}`, '.perfil'], ['carreira', `#/hall?carreira=${carreira}`, '.dialogo-carreira, .carreira-topo, .perfil'], ['mensagem', `#/mensagens?mensagem=${msg}`, '.ficha-msg']]) {
      await page.evaluate((x) => { location.hash = x }, hash)
      const abriu = await page.waitForSelector(`#gaveta:not([hidden]) .gaveta-corpo ${pronto.split(', ').join(`, #gaveta:not([hidden]) .gaveta-corpo `)}`, { timeout: 20000 }).then(() => true).catch(() => false)
      await sleep(900)
      if (!abriu) { nota(`${nome}: a ficha da ${tipo} não abriu (${hash})`); continue }
      const m = await medir(page, { raiz: '#gaveta' })
      const ach = relatar(`${nome}: ficha da ${tipo}`, m)
      const larga = await page.evaluate(() => { const c = document.querySelector('#gaveta .gaveta-corpo'); return [c.scrollWidth, c.clientWidth] })
      if (larga[0] > larga[1] + 1) nota(`${nome}: a ficha da ${tipo} rola de lado por dentro (${larga[0]} > ${larga[1]})`)
      if (m.vazam.length) nota(`${nome}: ficha da ${tipo}: conteúdo vaza (${m.vazam.slice(0, 3).map((v) => `${v.rotulo ?? v.onde.split('>').pop()} "${v.texto.slice(0, 24)}" ${v.w}<${v.sw}`).join(' · ')})`)
      await print(page, nome, `ficha-${tipo}`, { inteira: false })
      await page.locator('#gaveta .gaveta-corpo').evaluate((e) => e.scrollTo(0, 99999))
      await sleep(300)
      await print(page, nome, `ficha-${tipo}-fim`)
      void ach
    }
    await ap.ctx.close()
  }
})

// ═══ Hall: diálogo de motivo (Ocultar) com o teclado ═══
await secao('hall', async () => {
  for (const nome of ['galaxy-a', 'iphone-se']) {
    const ap = await aberto(nome)
    const { page } = ap
    await irAba(page, '#/hall')
    const b = page.locator(`${aba} tr.clicavel button:has-text("Ocultar")`).first()
    await b.scrollIntoViewIfNeeded()
    await b.tap()
    await page.waitForSelector('dialog[open]', { timeout: 10000 })
    await sleep(400)
    const d = await caixa(page, 'dialog[open]')
    const foco = await page.evaluate(() => ({ el: document.activeElement?.tagName, fonte: getComputedStyle(document.activeElement).fontSize }))
    console.log(`      ${nome}: diálogo Ocultar ${JSON.stringify(d)} · foco ${JSON.stringify(foco)}`)
    relatar(`diálogo Ocultar (${nome})`, await medir(page, { raiz: 'dialog[open]' }), { fonte: true })
    await print(page, nome, 'dialogo-ocultar')
    await teclado(page, ap.a, true)
    const pe = await caixa(page, 'dialog[open] .dialogo-pe')
    const dk = await caixa(page, 'dialog[open]')
    const m = await medir(page, { raiz: 'dialog[open]' })
    ok(pe.bottom <= dk.janela[1] && dk.top >= 0, `${nome}: diálogo Ocultar com teclado cabe (diálogo ${dk.top}..${dk.bottom}, pé ${pe.top}..${pe.bottom}, janela ${dk.janela[1]})`)
    if (m.coberto && (m.coberto.fora || m.coberto.porCima)) nota(`${nome}: Ocultar com teclado: o campo focado fica escondido ${JSON.stringify(m.coberto)}`)
    await print(page, nome, 'dialogo-ocultar-com-teclado')
    await teclado(page, ap.a, false)
    await page.locator('dialog[open] .chip-motivo').first().tap()
    await page.locator('dialog[open] button[type="submit"]').tap()
    const t = await page.waitForFunction(() => [...document.querySelectorAll('#avisos .aviso-flutuante')].map((x) => x.textContent).join(' | '), null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => '')
    const av = await caixa(page, '#avisos')
    console.log(`      ${nome}: aviso depois de ocultar: "${t}" ${JSON.stringify(av)}`)
    await print(page, nome, 'hall-depois-de-ocultar')
    await ap.ctx.close()
  }
})

// ═══ lote: barra fixa no rodapé, o último cartão, os avisos ═══
await secao('lote', async () => {
  for (const nome of ['galaxy-a', 'iphone-14']) {
    const ap = await aberto(nome)
    const { page } = ap
    await irAba(page, '#/hall')
    const caixas = page.locator(`${aba} td.selecao input:not([disabled])`)
    const n = await caixas.count()
    for (let i = 0; i < Math.min(3, n); i++) { await caixas.nth(i).scrollIntoViewIfNeeded(); await caixas.nth(i).tap(); await sleep(150) }
    await sleep(500)
    const barra = await caixa(page, `${aba} .barra-lote.com-marcados`)
    const pos = await page.evaluate((s) => getComputedStyle(document.querySelector(s)).position, `${aba} .barra-lote.com-marcados`)
    console.log(`      ${nome}: barra de lote ${pos} ${JSON.stringify(barra)}`)
    ok(barra && barra.bottom === barra.janela[1] && pos === 'fixed', `${nome}: com algo marcado a barra fica fixa no rodapé`)
    relatar(`barra de lote (${nome})`, await medir(page, { raiz: `${aba} .barra-lote` }))
    await print(page, nome, 'lote-barra-no-rodape')
    // no fim da lista: o último cartão (e a paginação) aparecem por cima da barra?
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await sleep(500)
    const fim = await page.evaluate((s) => {
      const b = document.querySelector(s).getBoundingClientRect()
      const linhas = [...document.querySelectorAll('.aba:not([hidden]) tr.clicavel')]
      const u = linhas[linhas.length - 1].getBoundingClientRect()
      const ub = [...linhas[linhas.length - 1].querySelectorAll('button')].map((x) => x.getBoundingClientRect()).reduce((a, r) => Math.max(a, r.bottom), 0)
      const pag = document.querySelector('.aba:not([hidden]) .paginacao')
      return { barraTopo: Math.round(b.top), ultimoCartao: [Math.round(u.top), Math.round(u.bottom)], ultimoBotao: Math.round(ub), paginacao: pag ? Math.round(pag.getBoundingClientRect().bottom) : null }
    }, `${aba} .barra-lote.com-marcados`)
    ok(fim.ultimoBotao <= fim.barraTopo, `${nome}: rolando até o fim, os botões do último cartão ficam acima da barra (${JSON.stringify(fim)})`)
    if (fim.paginacao !== null && fim.paginacao > fim.barraTopo) nota(`${nome}: a paginação fica por baixo da barra de lote no fim da lista (${JSON.stringify(fim)})`)
    await print(page, nome, 'lote-fim-da-lista')
    // ação em lote: o diálogo e o aviso por cima da barra
    await page.locator(`${aba} .barra-lote-acoes button`).first().tap()
    await page.waitForSelector('dialog[open]', { timeout: 10000 })
    await sleep(300)
    await print(page, nome, 'lote-dialogo')
    relatar(`diálogo do lote (${nome})`, await medir(page, { raiz: 'dialog[open]' }), { fonte: true })
    await page.locator('dialog[open] button:has-text("Cancelar")').tap()
    await sleep(300)
    // um aviso (toast) com a barra: fica acima dela?
    await page.evaluate(() => window.LP.avisar('Teste: aviso com a barra de lote aberta.', 'info', 6000))
    await sleep(400)
    const av = await caixa(page, '#avisos .aviso-flutuante')
    const br = await caixa(page, `${aba} .barra-lote.com-marcados`)
    ok(av.bottom <= br.top, `${nome}: o aviso flutuante fica acima da barra de lote (aviso ${av.top}..${av.bottom}, barra ${br.top}..${br.bottom})`)
    await print(page, nome, 'lote-com-aviso')
    // girar com a barra aberta
    await page.setViewportSize({ width: ap.a.h, height: ap.a.w })
    await sleep(700)
    const g = await caixa(page, `${aba} .barra-lote`)
    const gm = await medir(page)
    console.log(`      ${nome} deitado: barra ${JSON.stringify(g)} · lateral ${gm.lateral}`)
    ok(g.top >= 0 && g.bottom <= g.janela[1], `${nome} deitado (${ap.a.h}×${ap.a.w}), rolado até o fim da lista: a barra de lote (com 3 marcadas) continua à vista (${g.top}..${g.bottom} de ${g.janela[1]})`)
    await print(page, nome + '-deitado', 'lote')
    await page.setViewportSize({ width: ap.a.w, height: ap.a.h })
    await sleep(500)
    await page.locator(`${aba} .barra-lote button:has-text("Desmarcar")`).tap()
    await ap.ctx.close()
  }
})

// ═══ lote + aviso de novidade ("N denúncias novas"): um por cima do outro? ═══
await secao('novidade', async () => {
  const ap = await aberto('galaxy-a')
  const { page } = ap
  await irAba(page, '#/denuncias')
  const c = page.locator(`${aba} input[type="checkbox"]:not([disabled])`).first()
  await c.scrollIntoViewIfNeeded()
  const alvo = await c.evaluate((e) => { const r = (e.closest('label') || e).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] })
  console.log(`      caixa de marcar da denúncia: ${alvo.join('×')} px`)
  await c.tap()
  await sleep(400)
  // denúncia nova, como um jogador faria (conta com mais de 24 h e 3 partidas), numa carreira do Hall ainda sem denúncia
  const livre = sql("SELECT f.carreira_id FROM hall_foto f WHERE NOT EXISTS (SELECT 1 FROM denuncias d WHERE d.carreira_pk = f.carreira_pk) ORDER BY f.id LIMIT 1")
  const j = S.contas['Gabi Zaga'] ?? S.contas['Vito Lateral']
  const r = await pedido('api/hall.php', { ip: j.ip, cookie: j.cookie, corpo: { acao: 'denunciar', id: livre, motivo: 'nome', texto: 'Nome estranho (teste do celular)' } })
  console.log(`      denúncia nova pela API: ${r.status} ${r.txt.slice(0, 80)}`)
  const veio = await page.waitForSelector('#novidade:not([hidden]) .novidade-item', { timeout: 40000 }).then(() => true).catch(() => false)
  ok(veio, 'o aviso de novidade aparece com o lote marcado')
  if (veio) {
    const nv = await caixa(page, '#novidade')
    const br = await caixa(page, `${aba} .barra-lote.com-marcados`)
    const cruza = br && nv.bottom > br.top && nv.top < br.bottom
    ok(!cruza, `o aviso "${(await page.textContent('#novidade')).trim()}" não fica por cima da barra de lote (aviso ${nv.top}..${nv.bottom}, barra ${br?.top}..${br?.bottom})`)
    await print(page, 'galaxy-a', 'novidade-por-cima-do-lote')
  }
  await ap.ctx.close()
})

// ═══ busca (Usuários) com o teclado ═══
await secao('busca', async () => {
  const ap = await aberto('galaxy-a')
  const { page } = ap
  await irAba(page, '#/usuarios')
  const b = page.locator(`${aba} input[type="search"]`)
  await b.scrollIntoViewIfNeeded()
  await b.tap()
  await teclado(page, ap.a, true)
  await page.keyboard.type('Mesmo', { delay: 60 })
  await sleep(1500)
  const m = await medir(page)
  const info = await page.evaluate(() => { const i = document.activeElement; const r = i.getBoundingClientRect(); const lat = document.querySelector('.lateral').getBoundingClientRect(); return { campo: [Math.round(r.top), Math.round(r.bottom)], topoFixo: Math.round(lat.bottom), janela: innerHeight, fonte: getComputedStyle(i).fontSize, enterkeyhint: i.enterKeyHint, kbd: !!i.parentElement.querySelector('kbd') && getComputedStyle(i.parentElement.querySelector('kbd')).display !== 'none', estado: i.parentElement.querySelector('.busca-estado')?.textContent } })
  console.log(`      busca com teclado: ${JSON.stringify(info)}`)
  ok(info.campo[0] >= info.topoFixo, `o campo de busca não fica por baixo do topo fixo (campo ${info.campo[0]}, topo fixo até ${info.topoFixo})`)
  if (m.coberto && (m.coberto.fora || m.coberto.porCima)) nota(`busca com teclado: ${JSON.stringify(m.coberto)}`)
  if (info.kbd) nota('a dica de atalho "/" aparece dentro do campo de busca no celular (não há teclado físico)')
  await print(page, 'galaxy-a', 'busca-com-teclado')
  await page.keyboard.press('Enter')
  await sleep(1200)
  await teclado(page, ap.a, false)
  await print(page, 'galaxy-a', 'busca-resultado')
  const n = await page.locator(`${aba} tr.clicavel`).count()
  console.log(`      resultado: ${n} contas`)
  await ap.ctx.close()
})

// ═══ Mensagens: abrir, resposta pronta, teclado, prévia do e-mail, mandar ═══
await secao('mensagens', async () => {
  const ap = await aberto('iphone-14')
  const { page } = ap
  await irAba(page, '#/mensagens')
  await page.locator(`${aba} tr.clicavel`).first().tap()
  await page.waitForSelector('#gaveta:not([hidden]) textarea', { timeout: 20000 })
  await sleep(600)
  relatar('ficha da mensagem (iphone-14)', await medir(page, { raiz: '#gaveta' }), { fonte: true })
  await print(page, 'iphone-14', 'ficha-mensagem')
  const t = page.locator('#gaveta textarea')
  await t.scrollIntoViewIfNeeded()
  await page.locator('#gaveta .motivos-rapidos .chip-motivo').first().tap()
  await teclado(page, ap.a, true)
  const info = await page.evaluate(() => {
    const ta = document.querySelector('#gaveta textarea').getBoundingClientRect()
    const bt = [...document.querySelectorAll('#gaveta button')].find((b) => /Responder por e-mail|Mandar outra/.test(b.textContent)).getBoundingClientRect()
    return { textarea: [Math.round(ta.top), Math.round(ta.bottom)], botao: [Math.round(bt.top), Math.round(bt.bottom)], janela: innerHeight, foco: document.activeElement?.tagName, fonte: getComputedStyle(document.querySelector('#gaveta textarea')).fontSize }
  })
  console.log(`      resposta com teclado: ${JSON.stringify(info)}`)
  await print(page, 'iphone-14', 'ficha-mensagem-com-teclado')
  await teclado(page, ap.a, false)
  await page.locator('#gaveta button', { hasText: /Responder por e-mail|Mandar outra/ }).tap()
  await page.waitForSelector('dialog[open] .previa-email', { timeout: 10000 })
  await sleep(400)
  const d = await caixa(page, 'dialog[open]')
  const pre = await page.evaluate(() => { const p = document.querySelector('dialog[open] .previa-email'); return [p.clientHeight, p.scrollHeight] })
  console.log(`      diálogo da prévia: ${JSON.stringify(d)} · prévia ${pre[0]}/${pre[1]} px`)
  relatar('prévia do e-mail (iphone-14)', await medir(page, { raiz: 'dialog[open]' }))
  await print(page, 'iphone-14', 'dialogo-previa-email')
  await page.locator('dialog[open] button[type="submit"]').tap()
  const av = await page.waitForFunction(() => [...document.querySelectorAll('#avisos .aviso-flutuante')].map((x) => x.textContent).join(' | '), null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => '')
  console.log(`      depois de mandar: "${av}"`)
  await print(page, 'iphone-14', 'mensagem-respondida')
  await ap.ctx.close()
})

// ═══ Configurações: barra de salvar, campo com teclado, sair sem salvar pelo voltar ═══
await secao('config', async () => {
  const ap = await aberto('galaxy-a')
  const { page } = ap
  await irAba(page, '#/visao')
  await irAba(page, '#/config')
  const n = page.locator(`${aba} input[type="number"]:not([disabled])`).first()
  await n.scrollIntoViewIfNeeded()
  await n.tap()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.type('1')
  await sleep(500)
  await teclado(page, ap.a, true)
  const info = await page.evaluate(() => {
    const f = document.activeElement.getBoundingClientRect()
    const b = document.querySelector('.aba:not([hidden]) .barra-salvar')
    const rb = b ? b.getBoundingClientRect() : null
    return { campo: [Math.round(f.top), Math.round(f.bottom)], barra: rb ? [Math.round(rb.top), Math.round(rb.bottom), getComputedStyle(b).position] : null, janela: innerHeight, inputmode: document.activeElement.inputMode, fonte: getComputedStyle(document.activeElement).fontSize }
  })
  console.log(`      número com teclado: ${JSON.stringify(info)}`)
  if (info.barra && info.campo[1] > info.barra[0] && info.campo[0] < info.barra[1]) nota(`Configurações: a barra "Salvar" fica por cima do campo que está sendo digitado (${JSON.stringify(info)})`)
  await print(page, 'galaxy-a', 'config-numero-com-teclado')
  await teclado(page, ap.a, false)
  const barra = await caixa(page, `${aba} .barra-salvar`)
  relatar('barra de salvar (galaxy-a)', await medir(page, { raiz: `${aba} .barra-salvar` }))
  console.log(`      barra de salvar: ${JSON.stringify(barra)}`)
  await print(page, 'galaxy-a', 'config-barra-salvar')
  // voltar do Android com alteração não salva
  await page.evaluate(() => history.back())
  await sleep(1000)
  const st = await page.evaluate(() => ({ hash: location.hash, dialogo: document.querySelector('dialog[open] h2')?.textContent ?? null }))
  ok(!!st.dialogo, `voltar com alteração não salva pergunta antes de sair (${JSON.stringify(st)})`)
  await print(page, 'galaxy-a', 'config-voltar-sem-salvar')
  if (st.dialogo) await page.locator('dialog[open] button:has-text("Cancelar")').tap()
  await sleep(500)
  const st2 = await page.evaluate(() => ({ hash: location.hash, titulo: document.getElementById('titulo-aba').textContent }))
  console.log(`      depois de "Cancelar": ${JSON.stringify(st2)}`)
  // descartar pelo botão da barra (se tiver) e conferir que nada foi salvo
  const desc = page.locator(`${aba} .barra-salvar button`, { hasText: /Descartar|Desfazer/ })
  if (await desc.count()) await desc.first().tap()
  await ap.ctx.close()
})

// ═══ tema: claro, alto contraste, original (v3.5: pela Aparência do menu "⋯" do topo do celular) ═══
await secao('tema', async () => {
  const ap = await aberto('iphone-14', { hash: '#/hall' })
  const { page } = ap
  await irAba(page, '#/hall')
  const menu = async () => {
    await page.locator('.botoes-topo-celular [data-acao="menu"]').tap()
    await page.waitForSelector('dialog[open] .menu-celular', { timeout: 10000 })
    await sleep(300)
  }
  for (const v of ['claro', 'alto', 'original']) {
    await menu()
    await page.locator(`dialog[open] .menu-celular [data-valor="${v}"]`).first().tap()
    await sleep(500)
    const t = await page.evaluate(() => ({ tema: document.documentElement.getAttribute('data-tema') || 'original', meta: document.querySelector('meta[name="theme-color"]').content, fundo: getComputedStyle(document.body).backgroundColor }))
    console.log(`      aparência ${v}: ${JSON.stringify(t)}`)
    ok(t.tema === v, `o menu ⋯ › Aparência › ${v} troca o tema (${t.tema})`)
    await print(page, 'iphone-14', `tema-menu-${v}`)
    await page.keyboard.press('Escape')
    await sleep(400)
    await page.evaluate(() => window.scrollTo(0, 0))
    await print(page, 'iphone-14', `tema-${t.tema}`)
  }
  // a preferência fica no aparelho: recarregar mantém
  await menu()
  await page.locator('dialog[open] .menu-celular [data-valor="claro"]').first().tap()
  await sleep(300)
  await page.keyboard.press('Escape')
  await page.reload()
  await esperarDecisao(page)
  const t2 = await page.evaluate(() => document.documentElement.getAttribute('data-tema'))
  ok(t2 === 'claro', `recarregar mantém o tema claro (${t2})`)
  await ap.ctx.close()
})

// ═══ gráfico: tocar numa barra mostra a dica dentro da tela; tocar fora some ═══
await secao('grafico', async () => {
  const ap = await aberto('galaxy-a')
  const { page } = ap
  await irAba(page, '#/visao')
  const alvos = page.locator('#grafico-dias .alvo')
  const n = await alvos.count()
  for (const i of [0, n - 1]) {
    await alvos.nth(i).scrollIntoViewIfNeeded()
    await alvos.nth(i).tap()
    await sleep(400)
    const d = await caixa(page, '#dica')
    const vis = await page.isVisible('#dica')
    ok(vis && d.left >= 0 && d.right <= d.janela[0], `toque na barra ${i + 1}/${n}: dica ${vis ? 'aparece' : 'NÃO aparece'} dentro da tela ${JSON.stringify(d)}`)
  }
  await print(page, 'galaxy-a', 'grafico-dica')
  await page.locator('#t-funil').tap()
  await sleep(300)
  ok(!(await page.isVisible('#dica')), 'tocar fora esconde a dica')
  await ap.ctx.close()
})

// ═══ "Precisa de atenção": tocar num alerta leva para onde? o que aparece na tela? ═══
await secao('atencao', async () => {
  const ap = await aberto('galaxy-a')
  const { page } = ap
  await irAba(page, '#/visao')
  // v3.5: no celular a caixa vem recolhida numa linha ("⚠ N alertas · M graves ▸"); abre com um toque
  const dobrar = page.locator('#atencao .atencao-dobrar')
  if ((await dobrar.isVisible().catch(() => false)) && (await dobrar.getAttribute('aria-expanded')) === 'false') {
    const yAba = await page.evaluate(() => Math.round(document.getElementById('titulo-aba').getBoundingClientRect().top))
    ok(yAba < (await page.evaluate(() => innerHeight)), `com a atenção recolhida, o título da aba aparece sem rolar (y=${yAba})`)
    await dobrar.tap()
    await sleep(500)
    ok((await dobrar.getAttribute('aria-expanded')) === 'true', 'tocar na linha "⚠ alertas" abre a lista dos alertas')
    await print(page, 'galaxy-a', 'atencao-aberta')
  }
  const link = page.locator('#atencao a.atencao-texto', { hasText: 'denúncias abertas' }).first()
  await link.scrollIntoViewIfNeeded()
  await link.tap()
  await sleep(2000)
  const info = await page.evaluate(() => {
    const t = document.getElementById('titulo-aba').getBoundingClientRect()
    const prim = document.querySelector('.aba:not([hidden]) tr.clicavel, .aba:not([hidden]) .denuncia')
    return { hash: location.hash, titulo: document.getElementById('titulo-aba').textContent, tituloY: Math.round(t.top), primeiroItemY: prim ? Math.round(prim.getBoundingClientRect().top) : null, janela: innerHeight, scrollY }
  })
  console.log(`      depois do toque: ${JSON.stringify(info)}`)
  ok(info.tituloY < info.janela, `depois de tocar no alerta, a lista aparece na tela sem rolar (título em y=${info.tituloY}, 1º item em y=${info.primeiroItemY}, janela ${info.janela})`)
  await print(page, 'galaxy-a', 'atencao-toque-no-alerta')
  // os números do topo (8 caixinhas): também levam para a aba
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.locator('#na-mensagensNovas').tap()
  await sleep(1800)
  const i2 = await page.evaluate(() => ({ hash: location.hash, tituloY: Math.round(document.getElementById('titulo-aba').getBoundingClientRect().top), janela: innerHeight }))
  console.log(`      toque em "Mensagens" dos números: ${JSON.stringify(i2)}`)
  await print(page, 'galaxy-a', 'numeros-toque-mensagens')
  await ap.ctx.close()
})

// ═══ girar o celular com a ficha aberta e numa aba com tabela ═══
await secao('girar', async () => {
  const ap = await aberto('iphone-14')
  const { page } = ap
  await irAba(page, '#/usuarios')
  await page.locator(`${aba} tr.clicavel`).first().tap()
  await page.waitForSelector('#gaveta:not([hidden]) .gaveta-corpo .perfil', { timeout: 20000 })
  await sleep(500)
  await page.setViewportSize({ width: 844, height: 390 })
  await sleep(800)
  const g = await caixa(page, '#gaveta')
  const m = await medir(page)
  console.log(`      deitado com a ficha: ${JSON.stringify(g)} · lateral ${m.lateral}`)
  relatar('deitado com a ficha (844×390)', m)
  await print(page, 'iphone-14-deitado', 'ficha-conta')
  await page.locator('#gaveta .gaveta-voltar').tap()
  await sleep(500)
  const topo = await page.evaluate(() => ({ topoFixo: Math.round(document.querySelector('.lateral').getBoundingClientRect().height), janela: innerHeight }))
  console.log(`      deitado: topo fixo ${topo.topoFixo}px de ${topo.janela}px (${Math.round((100 * topo.topoFixo) / topo.janela)}% da tela)`)
  if (topo.topoFixo / topo.janela > 0.25) nota(`deitado (844×390): o topo fixo (marca + abas) ocupa ${topo.topoFixo}px de ${topo.janela}px (${Math.round((100 * topo.topoFixo) / topo.janela)}%) da tela o tempo todo`)
  await page.evaluate(() => window.scrollTo(0, 1800))
  await sleep(300)
  await print(page, 'iphone-14-deitado', 'usuarios-rolado')
  await page.setViewportSize({ width: 390, height: 844 })
  await sleep(800)
  const m2 = await medir(page)
  ok(m2.lateral <= 0, `voltando para em pé, sem rolagem lateral (${m2.lateral})`)
  await ap.ctx.close()
})

// ═══ sem rede: trocar de aba, agir, o selo do topo; e quando a rede volta ═══
await secao('rede', async () => {
  const ap = await aberto('galaxy-a')
  const { page, cdp } = ap
  await irAba(page, '#/visao')
  await offline(cdp, true)
  await page.evaluate(() => { location.hash = '#/mensagens' })
  await sleep(3000)
  const t = await page.evaluate(() => { const e = document.querySelector('.aba:not([hidden]) .estado-erro'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : document.querySelector('.aba:not([hidden])')?.textContent.slice(0, 160) })
  console.log(`      aba sem rede: "${t}"`)
  await page.evaluate(() => { const e = document.querySelector('.aba:not([hidden]) .estado-erro'); if (e) e.scrollIntoView({ block: 'center' }) })
  await print(page, 'galaxy-a-sem-rede', 'aba-mensagens')
  // uma ação: a ficha da conta pelo hash
  await page.evaluate(() => { location.hash = '#/usuarios' })
  await sleep(2500)
  const t2 = await page.evaluate(() => [...document.querySelectorAll('#avisos .aviso-flutuante')].map((x) => x.textContent).join(' | '))
  console.log(`      avisos sem rede: "${t2}"`)
  // o selo do topo depois de 3 pulsos sem resposta (15 s cada)
  await sleep(47000)
  const selo = await page.textContent('#selo-atualizado')
  ok(/sem conexão/.test(selo), `depois de ~45 s sem rede o topo avisa ("${selo}")`)
  await page.evaluate(() => window.scrollTo(0, 0))
  await print(page, 'galaxy-a-sem-rede', 'selo-do-topo')
  await offline(cdp, false)
  const voltou = await page.waitForFunction(() => /atualizado às/.test(document.getElementById('selo-atualizado').textContent), null, { timeout: 25000 }).then(() => true).catch(() => false)
  ok(voltou, 'a rede voltou: o selo volta a "atualizado às" sozinho')
  const tentar = page.locator(`${aba} .estado-erro button`)
  if (await tentar.count()) {
    await tentar.first().tap()
    await sleep(2000)
    ok(!(await page.locator(`${aba} .estado-erro`).count()), '"Tentar de novo" carrega a aba quando a rede volta')
  }
  await ap.ctx.close()
})

// ═══ 4G lento + processador 4×: trocar de aba, abrir a ficha ═══
await secao('lento', async () => {
  const ap = await aberto('galaxy-a')
  const { page, cdp } = ap
  await lento(cdp)
  for (const h of ['#/usuarios', '#/hall', '#/conquistas', '#/registro', '#/desafios', '#/visao']) {
    const t0 = Date.now()
    const l0 = await page.evaluate(() => performance.now())
    await page.evaluate((x) => { location.hash = x }, h)
    await page.waitForFunction((id) => { const a = document.getElementById('aba-' + id); return a && !a.hidden && !a.querySelector('.estado-carregando') && !a.classList.contains('esmaecido') && a.textContent.length > 200 }, h.replace('#/', ''), { timeout: 60000 }).catch(() => {})
    const dt = Date.now() - t0
    await sleep(600)
    const longas = await page.evaluate((d) => (window.__longas ?? []).filter((x) => x.t >= d).map((x) => x.d), l0)
    const altura = await page.evaluate(() => document.documentElement.scrollHeight)
    console.log(`  ..  ${h}: pronta em ${(dt / 1000).toFixed(1)} s · página de ${altura}px · tarefas longas ${longas.length} (maior ${Math.max(0, ...longas)} ms)`)
    if (Math.max(0, ...longas) > 400) nota(`4G lento + CPU 4×: ${h} trava a tela por ${Math.max(...longas)} ms (página de ${altura}px)`)
  }
  await irAba(page, '#/usuarios', 500)
  const t0 = Date.now()
  await page.locator(`${aba} tr.clicavel`).first().tap()
  await page.waitForSelector('#gaveta:not([hidden]) .gaveta-corpo .perfil', { timeout: 60000 })
  console.log(`  ..  ficha da conta aberta em ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  await ap.ctx.close()
})

await browser.close()
console.log(`\npainel no celular (ações): ${achados.length} anotação(ões)`)
for (const a of achados) console.log(`  - ${a}`)
process.exitCode = achados.length ? 1 : 0
