// LENDA · teste do painel (v3.3): as abas Mensagens (Fale conosco) e Desafios, o e-mail confirmado em Usuários e o
// limite de partidas por dia nas Configurações, pelo navegador contra a mesma pilha do rodar.sh, depois do painel.mjs e
// do correcoes.mjs (a conta Dono já tem o PIN 729153; LENDA_TESTE_PAINEL_PIN muda). Planta o que precisa
// (semente-v33.mjs: mensagens com e sem conta, contas confirmadas, carreiras com 3 Copas, 2 Libertadores e o replay real
// que viram candidatas) e confere: números do pulso e pílulas, "Precisa de atenção", filtros, ficha lateral da mensagem
// (lida ao abrir, resposta por e-mail com prévia, situação), lote, fila ao vivo, texto do jogador como texto, desafios
// (ativar, candidatos na ordem do "em", verificação, "Verificar no jogo", recusar, declarar o vencedor com o apelido
// digitado, reabrir, criar e editar mandando só o que mudou, "sair sem salvar"), papéis, Registro, CSP e celular. Com
// LENDA_PRINTS=<pasta>, tira os prints das telas novas em 1440 e 390 (em <pasta>/v33) antes de mexer.
const { chromium } = await import(process.env.LENDA_PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright/index.mjs')
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { BASE, PAINEL, admin, env, esc, ok, pedido, resultado, sql, uuid } from './lib.mjs'
import { PREMIO_TESTE, semearV33 } from './semente-v33.mjs'

const EXE = process.env.LENDA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const PIN = process.env.LENDA_TESTE_PAINEL_PIN ?? '729153'
const PRINTS = process.env.LENDA_PRINTS ? process.env.LENDA_PRINTS.replace(/\/$/, '') + '/v33' : ''
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const t0 = performance.now()
const V = await semearV33()
// a pilha de teste já fez muitas entradas no painel pelo mesmo IP (painel.mjs, correcoes.mjs): o contador de entradas
// por IP (10 a cada 10 min) recomeça, e a conta Dono entra uma vez só (a sessão é reaproveitada nos outros aparelhos)
sql("DELETE FROM tentativas WHERE chave LIKE 'painel:%'")
let sessaoDono = null
const browser = await chromium.launch({ executablePath: EXE, args: ['--lang=pt-BR'] })
let paginaAtual = null
process.on('uncaughtException', async (e) => {
  console.log(`  XX  o teste parou: ${String((e && e.message) || e).split('\n')[0]}`)
  try {
    if (paginaAtual) {
      console.log('      na tela: ' + (await paginaAtual.evaluate(() => location.hash)))
      await paginaAtual.screenshot({ path: `${BASE}/falha-v33.png` })
      console.log(`      print: ${BASE}/falha-v33.png`)
    }
  } catch { /* sem página */ }
  const r = resultado()
  console.log(`\npainel v3.3: ${r.oks} ok, ${r.falhas + 1} falha(s)`)
  process.exit(1)
})

async function aparelho(largura, o = {}) {
  const celular = largura < 600
  const ctx = await browser.newContext({ viewport: { width: largura, height: o.altura ?? (celular ? 844 : 900) }, deviceScaleFactor: 1, isMobile: celular, hasTouch: celular,
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', permissions: ['clipboard-read', 'clipboard-write'], storageState: o.outro ? undefined : sessaoDono ?? undefined })
  const page = await ctx.newPage()
  paginaAtual = page
  page.erros = []
  page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) page.erros.push(m.text()) })
  page.on('response', (r) => { if (r.status() >= 500) page.erros.push(`HTTP ${r.status()} em ${r.url()}`) })
  page.on('pageerror', (er) => page.erros.push('pageerror: ' + er.message))
  await page.addInitScript(() => {
    window.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI))
  })
  page.confirmar = true
  page.on('dialog', (d) => (page.confirmar ? d.accept() : d.dismiss()))
  return { ctx, page }
}
async function digitarPin(page, raiz, pin) {
  await page.locator(`${raiz} .pin-caixa`).first().click()
  await page.keyboard.type(pin, { delay: 30 })
}
async function entrar(page, o = {}) {
  await page.goto(PAINEL)
  // com a sessão reaproveitada, o formulário (dentro da tela de entrada escondida) não fica visível: espera uma das telas
  await page.waitForFunction(() => !document.getElementById('tela-painel').hidden || !document.getElementById('tela-entrar').hidden, null, { timeout: 15000 })
  if (!(await page.isVisible('#tela-painel'))) {
    if (o.email) await page.fill('#email', o.email)
    await page.fill('#senha', o.senha ?? env.PAINEL_SENHA)
    await page.click('#botao-entrar')
    await page.waitForSelector('#tela-painel:not([hidden]), #form-pin:not([hidden])', { timeout: 15000 })
    if (await page.isVisible('#form-pin')) await digitarPin(page, '#pin-caixas', o.pin ?? PIN)
    await page.waitForSelector('#tela-painel:not([hidden])', { timeout: 15000 })
  }
  await page.waitForFunction(() => /atualizado às/.test(document.getElementById('selo-atualizado').textContent), null, { timeout: 20000 })
  if (!o.email && !sessaoDono) sessaoDono = await page.context().storageState()
}
const ir = async (page, hash, espera = 1500) => {
  await page.evaluate((x) => { location.hash = x }, hash)
  await page.waitForTimeout(espera)
}
const aba = (page) => page.locator('.aba:not([hidden])')
const pulso = async (page, espera = 1500) => {
  await page.evaluate(() => window.LP.depoisDeAgir())
  await page.waitForTimeout(espera)
}
async function esperarToast(page, re, ms = 8000) {
  try {
    await page.waitForFunction((r) => Array.from(document.querySelectorAll('#avisos .aviso-flutuante')).some((x) => new RegExp(r, 'i').test(x.textContent)), re.source, { timeout: ms })
    return true
  } catch { return false }
}
/** Tira os toasts da tela (o próximo esperarToast não acha um velho igual). */
const limparToasts = (page) => page.evaluate(() => document.querySelectorAll('#avisos .aviso-flutuante').forEach((x) => x.remove()))
async function semRolagemLateral(page, nome) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
  return ok(w[0] <= w[1], `${nome}: sem rolagem lateral (${w[0]} ≤ ${w[1]})`)
}
/** Um bloco: se um passo travar, conta como falha e o teste segue. */
async function secao(page, nome, fn) {
  try {
    await fn()
  } catch (e) {
    ok(false, `${nome}: o bloco parou — ${String((e && e.message) || e).split('\n')[0]}`)
    try {
      for (let i = 0; i < 3 && await page.locator('dialog[open]').count(); i++) await page.keyboard.press('Escape')
    } catch { /* segue */ }
  }
}
const valor = (q) => sql(q)
const nNovas = () => Number(sql("SELECT COUNT(*) FROM mensagens_suporte WHERE status = 'nova'"))
const nCand = () => Number(sql("SELECT COUNT(*) FROM desafio_candidatos WHERE estado IN ('pendente', 'verificada')"))
const arquivosEmail = () => { try { return readdirSync(`${BASE}/emails`).length } catch { return 0 } }
const M = V.mensagens
const D = V.desafios
const K = V.candidatos

// ═══ 0. prints (antes de mexer) ═════════════════════════════════════════════════════════════
if (PRINTS) {
  for (const largura of [1440, 390]) {
    const { ctx, page } = await aparelho(largura)
    await entrar(page)
    await page.waitForTimeout(1200)
    let k = 0
    const foto = async (nome, cheia = true) => page.screenshot({ path: `${PRINTS}/${largura}-${String(++k).padStart(2, '0')}-${nome}.png`, fullPage: cheia })
    for (const [hash, nome] of [['#/mensagens', 'mensagens'], ['#/mensagens?status=todas', 'mensagens-todas'], ['#/desafios', 'desafios'], [`#/desafios?id=${D.tacas}`, 'desafio-tacas'],
      [`#/desafios?id=${D.copas}`, 'desafio-copas'], [`#/desafios?id=${D.tacas}&parte=editar`, 'desafio-editar'], ['#/desafios?parte=novo', 'desafio-novo'], ['#/usuarios?verificado=0', 'usuarios-nao-confirmados']]) {
      await ir(page, hash, 2000)
      await foto(nome)
    }
    // a ficha da mensagem já respondida (abrir uma nova a marcaria como lida) e o diálogo da resposta
    await ir(page, `#/mensagens?status=respondida&mensagem=${M.respondida.id}`, 2000)
    await foto('ficha-mensagem', false)
    await page.locator('#gaveta textarea').fill('Obrigado! Respondemos aqui no teste (o diálogo é fechado sem mandar).')
    await page.locator('#gaveta button', { hasText: /Mandar outra resposta|Responder por e-mail/ }).click()
    await page.waitForSelector('dialog[open] .previa-email')
    await foto('dialogo-resposta', false)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await ir(page, `#/usuarios?conta=${V.contas.A.id}`, 2000)
    await page.locator('#gaveta #u-desafios').scrollIntoViewIfNeeded().catch(() => {})
    await foto('ficha-conta-desafios', false)
    await ir(page, '#/config', 2000)
    await page.locator('[data-chave="partidas_dia_max"]').scrollIntoViewIfNeeded()
    await foto('config-partidas-dia', false)
    // o diálogo de declarar o vencedor (fechado sem declarar) e os temas
    await ir(page, `#/desafios?id=${D.tacas}`, 2000)
    await aba(page).locator(`article.candidato[data-id="${K.A}"] button`, { hasText: 'Declarar vencedor' }).click()
    await page.waitForSelector('dialog[open]')
    await foto('dialogo-vencedor', false)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    for (const tema of ['claro', 'alto']) {
      await page.keyboard.press('t')
      await page.waitForTimeout(500)
      await ir(page, `#/desafios?id=${D.tacas}`, 1500)
      await foto('tema-' + tema + '-desafio')
      await ir(page, '#/mensagens', 1500)
      await foto('tema-' + tema + '-mensagens')
    }
    await page.keyboard.press('t')
    await ctx.close()
  }
  console.log(`· prints v3.3 em ${PRINTS}`)
}

const { ctx, page } = await aparelho(1440)
await entrar(page)
ok(true, 'v3.3: a conta Dono entra (senha do arquivo + PIN)')

// ═══ 1. pulso, pílulas e "Precisa de atenção" ═══════════════════════════════════════════════
await secao(page, '1. pulso e atenção', async () => {
  await ir(page, '#/visao', 1500)
  await pulso(page, 2500)
  const novas = nNovas()
  const cand = nCand()
  ok((await page.textContent('#nav-mensagensNovas')).trim() === String(novas), `número de ação "Mensagens novas" = ${novas} (o do banco)`)
  ok((await page.textContent('#nav-candidatosPendentes')).trim() === String(cand), `número de ação "Candidatos a desafio" = ${cand}`)
  ok(await page.locator('#na-mensagensNovas.na-alerta').count() === 1 && await page.getAttribute('#na-mensagensNovas', 'href') === '#/mensagens?status=nova', '"Mensagens novas" em ouro, levando às novas')
  ok((await page.textContent('#cont-mensagens')).trim() === String(novas) && (await page.textContent('#cont-desafios')).trim() === String(cand), 'pílulas das abas Mensagens e Desafios com os números do pulso')
  await page.evaluate(() => window.LP.recarregarAtencao())
  await page.waitForTimeout(1500)
  const linkMsg = page.locator('#atencao a.atencao-texto', { hasText: 'Fale conosco há mais de 24 h' })
  ok(await linkMsg.count() === 1 && await linkMsg.getAttribute('href') === '#/mensagens?status=nova', '"Precisa de atenção": mensagens novas há mais de 24 h, com o link para as novas')
  const linkCand = page.locator('#atencao a.atencao-texto', { hasText: 'candidato' })
  ok(await linkCand.count() === 1 && await linkCand.getAttribute('href') === '#/desafios', '"Precisa de atenção": candidatos a desafio, com o link para Desafios')
  ok(await page.locator('.abas a[data-aba="mensagens"] kbd').count() === 0 && await page.getAttribute('.abas a[data-aba="registro"] kbd', 'aria-hidden') === 'true'
    && (await page.textContent('.abas a[data-aba="registro"] kbd')).trim() === '0', 'as abas novas não têm tecla: as de sempre continuam com o mesmo número (Registro = 0)')
})

// ═══ 2. Mensagens: lista, filtros, texto do jogador, ficha, lida ao abrir, resposta, lote, fila ═══
await secao(page, '2a. Mensagens: lista e filtros', async () => {
  await ir(page, '#/mensagens', 2000)
  const novas = nNovas()
  ok(await aba(page).locator('tbody tr').count() === novas, `Mensagens: abre nas novas (${novas} linhas)`)
  const chips = await aba(page).locator('.segmentos[aria-label="Situação"] button').allTextContents()
  ok(/Novas\s*5/.test(chips[0]) && /Lidas\s*1/.test(chips[1]) && /Respondidas\s*1/.test(chips[2]) && /Arquivadas\s*1/.test(chips[3]), 'filtros por situação com as contagens (' + chips.join(' | ') + ')')
  ok(await page.evaluate(() => window.__xss === undefined) && await aba(page).locator('img').count() === 0 && (await aba(page).textContent()).includes('<img src=x'), 'o texto do jogador entra como texto (o <img> aparece escrito e não roda)')
  ok(await aba(page).locator('tr.msg-nova').count() === novas, 'as novas em destaque (negrito)')
  ok(await aba(page).locator('.msg-contato .mono', { hasText: 'contato@oprojeto.online' }).count() === 1, 'o e-mail de contato do site aparece (com "Copiar")')
  ok(await aba(page).locator('tbody tr', { hasText: 'sem conta' }).count() >= 1 && await aba(page).locator('tbody tr .email-mascara').first().isVisible(), 'quem mandou sem conta: "sem conta" e o e-mail mascarado (modo discreto)')
  await aba(page).locator('.segmentos[aria-label="Assunto"] button', { hasText: 'Problema' }).click()
  await page.waitForTimeout(1200)
  ok(await aba(page).locator('tbody tr').count() === 1 && /tipo=problema/.test(await page.evaluate(() => location.hash)), 'filtro por assunto (Problema): 1 linha e tipo= no hash')
  await aba(page).locator('.segmentos[aria-label="Assunto"] button', { hasText: 'Todos os assuntos' }).click()
  await page.waitForTimeout(800)
  await aba(page).locator('input[type=search]').fill(M.ideia.protocolo)
  await page.waitForFunction(() => /1 encontrada/.test(document.querySelector('.aba:not([hidden]) .busca-estado').textContent), null, { timeout: 8000 })
  ok(true, 'busca pelo protocolo: "1 encontrada"')
  await aba(page).locator('input[type=search]').fill('')
  await page.waitForTimeout(900)
  await aba(page).locator('.segmentos[aria-label="Situação"] button', { hasText: 'Todas' }).click()
  await page.waitForTimeout(1200)
  ok(await aba(page).locator('tbody tr').count() === 8 && /status=todas/.test(await page.evaluate(() => location.hash)), 'Todas: as 8 mensagens (status=todas no hash)')
})

await secao(page, '2b. ficha: lida ao abrir, voltar para nova, resposta', async () => {
  await ir(page, '#/mensagens', 1800)
  await aba(page).locator(`tbody tr[data-id="${M.duvida.id}"] td.principal-celula`).click()
  await page.waitForSelector('#gaveta:not([hidden]) .msg-texto')
  ok(new RegExp(`mensagem=${M.duvida.id}`).test(await page.evaluate(() => location.hash)), 'ficha da mensagem no painel lateral (mensagem= no hash)')
  ok((await page.locator('#gaveta .msg-texto').first().evaluate((e) => e.textContent)).includes('Hall das Lendas?\nJá salvei'), 'a mensagem inteira, com a quebra de linha')
  await page.waitForFunction(() => /ficou como lida ao abrir/.test(document.getElementById('gaveta').textContent), null, { timeout: 8000 })
  ok(valor(`SELECT status FROM mensagens_suporte WHERE id = ${M.duvida.id}`) === 'lida', 'abrir uma nova marca como lida (no banco) e a ficha avisa')
  ok(await aba(page).locator(`tbody tr[data-id="${M.duvida.id}"] td.situacao`, { hasText: 'Lida' }).count() === 1, 'a linha da lista muda para "Lida" no lugar')
  await limparToasts(page)
  await page.locator('#gaveta .faixa button', { hasText: 'Voltar para nova' }).click()
  ok(await esperarToast(page, /de volta para as novas/), '"Voltar para nova" (na faixa)')
  ok(valor(`SELECT status FROM mensagens_suporte WHERE id = ${M.duvida.id}`) === 'nova', '…e ela volta a nova no banco')
  await page.waitForTimeout(1200)
  // responder com a resposta pronta + texto, prévia do e-mail, e o registro sem o texto
  const antesArq = arquivosEmail()
  const antesLog = Number(valor("SELECT COUNT(*) FROM email_log WHERE tipo = 'suporte'"))
  await page.locator('#gaveta .motivos-rapidos button', { hasText: 'Pedir mais detalhes' }).click()
  const txt = page.locator('#gaveta textarea')
  ok(/conte um pouco mais/.test(await txt.inputValue()), 'resposta pronta entra no campo')
  await txt.fill((await txt.inputValue()) + '\n\nResposta única do teste v33 do painel.')
  await page.locator('#gaveta button', { hasText: 'Responder por e-mail' }).click()
  await page.waitForSelector('dialog[open] .previa-email')
  const previa = await page.textContent('dialog[open] .previa-email')
  ok(previa.includes(M.duvida.protocolo) && previa.includes('> Como faço para a minha carreira') && previa.includes('Olá, Fala Muito!'), 'prévia do e-mail: olá com o apelido, a resposta e a mensagem original citada com o protocolo')
  await limparToasts(page)
  await page.locator('dialog[open] button[type=submit]').click()
  ok(await esperarToast(page, /Resposta mandada/), 'resposta mandada (toast com o e-mail mascarado)')
  ok(valor(`SELECT status FROM mensagens_suporte WHERE id = ${M.duvida.id}`) === 'respondida' && valor(`SELECT resposta FROM mensagens_suporte WHERE id = ${M.duvida.id}`).includes('Resposta única do teste v33'), 'no banco: respondida, com a resposta guardada')
  ok(arquivosEmail() === antesArq + 1 && Number(valor("SELECT COUNT(*) FROM email_log WHERE tipo = 'suporte'")) === antesLog + 1, 'o e-mail saiu pelo enviarEmail (arquivo do teste) e ficou no email_log (tipo suporte)')
  const det = valor("SELECT detalhes FROM admin_log WHERE acao = 'suporte_responder' ORDER BY id DESC LIMIT 1")
  ok(!det.includes('Resposta única') && !det.includes('@exemplo.com'), 'no Registro, nem o texto da resposta nem o e-mail')
  await page.waitForTimeout(1200)
  ok(await page.locator('#gaveta .msg-resposta', { hasText: 'Resposta única do teste v33' }).count() === 1, 'a ficha mostra a resposta mandada')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  ok(!/mensagem=/.test(await page.evaluate(() => location.hash)), 'Esc fecha a ficha e tira mensagem= do hash')
})

await secao(page, '2c. lote e fila ao vivo', async () => {
  await ir(page, '#/mensagens', 1800)
  const caixas = aba(page).locator('tbody input[type=checkbox]')
  const ids = [await caixas.nth(0).getAttribute('data-id'), await caixas.nth(1).getAttribute('data-id')]
  await caixas.nth(0).check()
  await caixas.nth(1).check()
  ok(/Marcar as \d+ desta página/.test(await aba(page).locator('.barra-lote').textContent()), 'barra de lote com "Marcar as N desta página" (sem a conversa de "alerta")')
  await limparToasts(page)
  await aba(page).locator('.barra-lote-acoes button', { hasText: 'Arquivar (2)' }).click()
  ok(await esperarToast(page, /2 arquivadas/), 'lote: "Arquivar (2)" → "2 arquivadas"')
  ok(valor(`SELECT COUNT(*) FROM mensagens_suporte WHERE status = 'arquivada' AND id IN (${ids.join(',')})`) === '2', 'lote: as duas arquivadas no banco')
  await page.waitForTimeout(1500)
  // uma mensagem nova chega (sem conta): a fila das novas traz sozinha (ou o aviso "N novas")
  const antes = await aba(page).locator('tbody tr').count()
  const r = await pedido('api/suporte.php', { ip: '10.35.0.9', corpo: { tipo: 'ideia', mensagem: 'Mensagem nova no meio do teste da fila ao vivo.', email: 'fila.viva@exemplo.com', pagina: '/' } })
  ok(r.status === 201, 'uma mensagem nova chega pelo Fale conosco')
  await page.waitForTimeout(5500) // o pulso da v3.3 pode vir de um cache de 5 s (APCu)
  await pulso(page, 2500)
  ok(await aba(page).locator('tbody tr', { hasText: 'fila ao vivo' }).count() === 1 || await page.isVisible('#novidade'), 'fila ao vivo: a nova aparece sozinha (ou "1 mensagem nova — clique para ver")')
  ok(await aba(page).locator('tbody tr').count() >= antes, '…sem sumir com as outras')
})

// ═══ 3. Usuários: e-mail confirmado ═════════════════════════════════════════════════════════
await secao(page, '3. Usuários: e-mail confirmado', async () => {
  await ir(page, '#/usuarios', 2000)
  const sim = valor('SELECT COUNT(*) FROM usuarios WHERE email_verificado_em IS NOT NULL')
  const chipSim = aba(page).locator('.chip-filtro', { hasText: 'E-mail confirmado' })
  ok((await chipSim.textContent()).includes(sim), `filtro "E-mail confirmado" com a contagem (${sim})`)
  ok(await aba(page).locator('th', { hasText: 'E-mail' }).count() === 1 && await aba(page).locator('td[data-rotulo="E-mail"] .chip').count() > 0, 'coluna "E-mail" com Confirmado / Não confirmado')
  await aba(page).locator('.chip-filtro', { hasText: 'E-mail não confirmado' }).click()
  await page.waitForTimeout(1200)
  const cel = await aba(page).locator('td[data-rotulo="E-mail"]').allTextContents()
  ok(/verificado=0/.test(await page.evaluate(() => location.hash)) && cel.length > 0 && cel.every((t) => /Não confirmado/.test(t)), `filtro "não confirmado": só as não confirmadas (${cel.length}) e verificado=0 no hash`)
  ok(await aba(page).locator('tbody button[title^="Manda um código novo de confirmação"]').count() > 0, 'na lista, "Reenviar confirmação" nas não confirmadas')
  // ficha: chip e reenviar a confirmação
  const sc = V.contas.semCodigo
  await ir(page, `#/usuarios?conta=${sc.id}`, 1800)
  ok(await page.locator('#gaveta .perfil-nome .chip', { hasText: 'E-mail não confirmado' }).count() === 1, 'ficha: "E-mail não confirmado"')
  const antes = Number(valor("SELECT COUNT(*) FROM email_log WHERE tipo = 'admin_verif'"))
  await limparToasts(page)
  await page.locator('#gaveta button', { hasText: 'Reenviar a confirmação do e-mail' }).click()
  ok(await esperarToast(page, /Confirmação mandada para/), '"Reenviar a confirmação do e-mail" (com confirm) → toast com o e-mail mascarado')
  ok(Number(valor("SELECT COUNT(*) FROM email_log WHERE tipo = 'admin_verif'")) === antes + 1 && valor("SELECT alvo FROM admin_log WHERE acao = 'reenviar_verificacao' ORDER BY id DESC LIMIT 1") === `usuario:${sc.id}`,
    'o código saiu (email_log admin_verif) e o Registro anotou reenviar_verificacao na conta')
  // a conta A: candidaturas e a mensagem dela
  await ir(page, `#/usuarios?conta=${V.contas.A.id}`, 1800)
  ok(await page.locator('#gaveta .perfil-nome .chip', { hasText: 'E-mail confirmado' }).count() === 1, 'ficha da conta confirmada: "E-mail confirmado" (e a data)')
  ok(await page.locator('#gaveta #u-desafios tbody tr').count() === 2, 'ficha: as 2 candidaturas aos desafios')
  const fale = page.locator('#gaveta details', { hasText: 'Fale conosco' })
  ok(await fale.count() === 1, 'ficha: as mensagens do Fale conosco da conta')
  if (!(await fale.evaluate((d) => d.open))) await fale.locator('summary').click()
  await fale.locator('tbody tr td.principal-celula').first().click()
  await page.waitForSelector('#gaveta .msg-texto')
  ok(/^#\/mensagens\?/.test(await page.evaluate(() => location.hash)) && await page.isVisible('#gaveta .msg-texto'), '…clicar abre a mensagem por cima da aba Mensagens')
})

// ═══ 4. Configurações: partidas por dia ═════════════════════════════════════════════════════
await secao(page, '4. Configurações: partidas_dia_max', async () => {
  await ir(page, '#/config', 2000)
  const campo = page.locator('#cfg-partidas_dia_max')
  ok(await campo.inputValue() === '100', 'Configurações: "Partidas por dia que contam na conta" = 100 (o padrão)')
  await campo.fill('5')
  await page.waitForTimeout(300)
  ok(/De 10 a 10\.000/.test(await page.locator('[data-chave="partidas_dia_max"] .erro-campo').textContent()), 'fora da faixa (5): "De 10 a 10.000 partidas."')
  await campo.fill('150')
  await aba(page).locator('.barra-salvar button', { hasText: 'Salvar' }).click()
  await page.waitForSelector('dialog[open]')
  ok(/Partidas por dia/.test(await page.textContent('dialog[open]')), 'o diálogo de salvar lista "Partidas por dia: 100 → 150"')
  await limparToasts(page)
  await page.locator('dialog[open] button[type=submit]').click()
  ok(await esperarToast(page, /Configurações salvas/), 'salvo')
  ok(valor("SELECT valor FROM site_config WHERE chave = 'partidas_dia_max'") === '150', 'partidas_dia_max = 150 no banco')
  await page.waitForTimeout(800)
  await page.locator('#cfg-partidas_dia_max').fill('80')
  await aba(page).locator('.barra-salvar button', { hasText: 'Salvar' }).click()
  await page.waitForSelector('dialog[open]')
  ok(/Baixar o limite de partidas por dia/.test(await page.textContent('dialog[open]')), 'baixar o limite pede atenção (quem passou do novo limite hoje para de somar)')
  await limparToasts(page)
  await limparToasts(page)
  await page.locator('dialog[open] button[type=submit]').click()
  ok(await esperarToast(page, /Configurações salvas/) && valor("SELECT valor FROM site_config WHERE chave = 'partidas_dia_max'") === '80', 'baixado para 80')
  await admin({ acao: 'config', valores: { partidas_dia_max: 100 } })
})

// ═══ 5. Desafios: lista, ativar, candidatos, verificação, vencedor, reabrir, recusar ═════════
await secao(page, '5a. Desafios: lista e ativar', async () => {
  await ir(page, '#/desafios', 2000)
  ok(await aba(page).locator('article.cartao-desafio').count() === 3, 'Desafios: os 3 de fábrica')
  ok(await aba(page).locator('article.cartao-desafio .chip', { hasText: 'Valendo' }).count() === 2 && await aba(page).locator('article.cartao-desafio .chip', { hasText: 'Desativado' }).count() === 1, '2 valendo e 1 desativado')
  ok(await aba(page).locator(`article.cartao-desafio[data-id="${D.tacas}"] .desafio-premio`, { hasText: PREMIO_TESTE.slice(0, 20) }).count() === 1, 'o prêmio é o texto do admin')
  ok(await aba(page).locator(`article.cartao-desafio[data-id="${D.conquistas}"]`, { hasText: 'O prêmio deste desafio será anunciado aqui' }).count() === 1, 'prêmio vazio: o texto que o jogo mostra')
  ok(await page.locator('#acoes-aba a[href="../#/desafios"]').count() === 1, '"Ver no jogo" leva à tela Desafios do jogo')
  // CONTRATO-v33 §E: o de todas as conquistas não tem prova (as conquistas vêm do aparelho): "Ativar" travado e o servidor recusa
  const bConq = aba(page).locator(`article.cartao-desafio[data-id="${D.conquistas}"] button`, { hasText: 'Ativar' })
  ok(await bConq.count() === 1 && await bConq.isDisabled() && /não pode ser ativado/.test((await bConq.getAttribute('title')) || ''), 'todas as conquistas: "Ativar" travado, com o porquê (sem prova)')
  const rConq = await admin({ acao: 'desafio_ativar', id: D.conquistas, ativo: true })
  ok(rConq.status === 409 && rConq.json?.erro === 'sem_prova' && valor(`SELECT ativo FROM desafios WHERE id = ${D.conquistas}`) === '0', `…e o servidor também não ativa (409 sem_prova: ${rConq.status})`)
  // o diálogo de ativar, num desafio de teste sem prêmio e sem início (some no fim)
  const novo = await admin({ acao: 'desafio_salvar', slug: 'teste-painel-ativar', titulo: 'Teste de ativar', criterio: { copas: 1 } })
  const idNovo = novo.json?.desafio?.id
  ok(novo.status === 201 && !!idNovo, 'desafio de teste criado (desativado)')
  // o mesmo hash não recarrega a aba: sai e volta para a lista trazer o novo
  await ir(page, '#/visao', 800)
  await ir(page, '#/desafios', 2000)
  await aba(page).locator(`article.cartao-desafio[data-id="${idNovo}"] button`, { hasText: 'Ativar' }).click()
  await page.waitForSelector('dialog[open]')
  const txt = await page.textContent('dialog[open]')
  ok(/prêmio está vazio/.test(txt) && /começa agora/.test(txt), 'ativar: avisa do prêmio vazio e de que começa agora')
  await limparToasts(page)
  await page.locator('dialog[open] button[type=submit]').click()
  ok(await esperarToast(page, /ativado/), 'ativado (toast)')
  ok(valor(`SELECT CONCAT(ativo, IF(inicio IS NULL, '-', '+')) FROM desafios WHERE id = ${idNovo}`) === '1+', 'no banco: ativo e com o início gravado')
  await page.waitForTimeout(1200)
  await aba(page).locator(`article.cartao-desafio[data-id="${idNovo}"] button`, { hasText: 'Desativar' }).click()
  await page.waitForSelector('dialog[open]')
  await limparToasts(page)
  await page.locator('dialog[open] button[type=submit]').click()
  ok(await esperarToast(page, /desativado/) && valor(`SELECT ativo FROM desafios WHERE id = ${idNovo}`) === '0', 'desativar de novo')
  sql(`DELETE FROM desafios WHERE id = ${idNovo}`)
  await ir(page, '#/visao', 800)
  await ir(page, '#/desafios', 2000)
})

await secao(page, '5b. candidatos, verificação e "Verificar no jogo"', async () => {
  await ir(page, `#/desafios?id=${D.tacas}`, 2000)
  const ordem = await aba(page).locator('article.candidato').evaluateAll((as) => as.map((a) => a.dataset.id))
  ok(ordem[0] === String(K.A) && ordem[1] === String(K.B), `candidatos na ordem do "em" (${ordem.join(', ')})`)
  const cA = aba(page).locator(`article.candidato[data-id="${K.A}"]`)
  const cB = aba(page).locator(`article.candidato[data-id="${K.B}"]`)
  ok(await cA.locator('.chip', { hasText: 'O primeiro que ainda conta' }).count() === 1, 'o primeiro tem a marca "O primeiro que ainda conta"')
  ok(/\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d,\d{3}/.test(await cA.textContent()), 'a hora em que cumpriu, com milésimos (Brasília)')
  ok(await cA.locator('.verificacao-ok', { hasText: 'Bateu na verificação pelo jogo' }).count() === 1, 'A: "Bateu na verificação pelo jogo"')
  ok(await cB.locator('.verificacao-nao', { hasText: 'Não bateu' }).count() === 1 && await cB.locator('.tabela-verif tr.diferente', { hasText: 'Copas do Mundo' }).count() === 1
    && await cB.locator('.tabela-verif tr.diferente').count() === 1, 'B: "Não bateu", com a linha das Copas (3 × 2) marcada na tabela guardado × refeito')
  ok(await cB.locator('.moderacao-nota', { hasText: 'Motivo (o jogador vê)' }).count() === 1, 'B: o motivo que o jogador vê')
  const href = await cA.locator('a', { hasText: 'Verificar de novo' }).getAttribute('href')
  ok(href === `/lenda/#/verificar?id=${V.carreiras.A}&candidato=${K.A}` && await cA.locator('a', { hasText: 'Verificar de novo' }).getAttribute('target') === '_blank', `"Verificar no jogo" abre o #/verificar do jogo em outra aba (${href})`)
  ok(await cA.locator('a', { hasText: 'Abrir a carreira' }).getAttribute('href') === `/lenda/#/resumo?id=${V.carreiras.A}&de=admin`, '"Abrir a carreira" → o resumo do jogo (de=admin)')
  // as 3 Copas: A pendente com "Verificar no jogo" em ouro; C verificado depois, mas não é o primeiro
  exigirOk(await admin({ acao: 'candidato_verificar', id: K.Cc, resultado: { ok: true, detalhes: { v: 1, diferencas: [] } } }), 'verificar C')
  await ir(page, `#/desafios?id=${D.copas}`, 2000)
  const cAc = aba(page).locator(`article.candidato[data-id="${K.Ac}"]`)
  ok(await cAc.locator('a.botao-ouro', { hasText: 'Verificar no jogo' }).count() === 1, 'pendente: "Verificar no jogo" em destaque')
  const vC = aba(page).locator(`article.candidato[data-id="${K.Cc}"] button`, { hasText: 'Declarar vencedor' })
  ok(await vC.count() === 1 && await vC.isDisabled() && /cumpriu antes/.test(await vC.getAttribute('title')), 'verificado que não é o primeiro: "Declarar vencedor" travado ("há um candidato que cumpriu antes")')
})

await secao(page, '5c. recusar com motivo', async () => {
  await ir(page, `#/desafios?id=${D.copas}`, 1800)
  await aba(page).locator(`article.candidato[data-id="${K.Bc}"] button`, { hasText: 'Recusar' }).click()
  await page.waitForSelector('dialog[open].dialogo-perigo')
  await page.locator('dialog[open] button[type=submit]').click()
  ok(await page.locator('dialog[open] .erro-campo:not([hidden])').count() === 1, 'recusar sem motivo não envia')
  await page.locator('dialog[open] .chip-motivo', { hasText: 'Trapaça' }).click()
  await limparToasts(page)
  await page.locator('dialog[open] button[type=submit]').click()
  ok(await esperarToast(page, /recusado/), 'candidato recusado (o jogador vê o motivo)')
  ok(valor(`SELECT CONCAT(estado, '|', motivo) FROM desafio_candidatos WHERE id = ${K.Bc}`).startsWith('recusada|Trapaça'), 'no banco: recusada com o motivo do chip')
})

await secao(page, '5d. declarar o vencedor e reabrir', async () => {
  await ir(page, `#/desafios?id=${D.tacas}`, 2000)
  await aba(page).locator(`article.candidato[data-id="${K.A}"] button`, { hasText: 'Declarar vencedor' }).click()
  await page.waitForSelector('dialog[open]')
  const dlg = await page.textContent('dialog[open]')
  ok(/Verificado no jogo/.test(dlg) && /É o primeiro que cumpriu tudo/.test(dlg) && /E-mail confirmado/.test(dlg), 'o diálogo confere: verificado, o primeiro, conta ativa, e-mail confirmado, carreira na conta')
  const btn = page.locator('dialog[open] button[type=submit]')
  ok(await btn.isDisabled(), 'confirmação forte: o botão só libera com o apelido digitado')
  await page.locator('dialog[open] .confirmar-digitando input').fill('taça um')
  ok(!(await btn.isDisabled()), '…sem diferenciar maiúsculas')
  await limparToasts(page)
  await btn.click()
  ok(await esperarToast(page, /é o vencedor/), 'vencedor declarado (toast)')
  ok(valor(`SELECT vencedor_candidato FROM desafios WHERE id = ${D.tacas}`) === String(K.A) && valor(`SELECT estado FROM desafio_candidatos WHERE id = ${K.A}`) === 'vencedora', 'no banco: o desafio com o vencedor e o candidato "vencedora"')
  ok(/Parabéns/.test(valor(`SELECT aviso_conta FROM usuarios WHERE id = ${V.contas.A.id}`)), 'a conta do vencedor recebeu o aviso em Minha conta')
  await page.waitForTimeout(1500)
  ok(await aba(page).locator('.cartao-vencedor', { hasText: 'Taça Um' }).count() === 1 && await aba(page).locator('.chip', { hasText: 'Tem vencedor' }).count() >= 1, 'a tela mostra o vencedor (e "Tem vencedor")')
  ok(await aba(page).locator('button', { hasText: 'Declarar vencedor' }).count() === 0, 'com vencedor, ninguém mais tem "Declarar vencedor"')
  await aba(page).locator('button', { hasText: 'Reabrir' }).click()
  await page.waitForSelector('dialog[open]')
  await page.locator('dialog[open] .chip-motivo', { hasText: 'Declarado por engano' }).click()
  await limparToasts(page)
  await page.locator('dialog[open] button[type=submit]').click()
  ok(await esperarToast(page, /reaberto/), 'reabrir (com motivo)')
  ok(valor(`SELECT IFNULL(vencido_em, 'nulo') FROM desafios WHERE id = ${D.tacas}`) === 'nulo' && valor(`SELECT estado FROM desafio_candidatos WHERE id = ${K.A}`) === 'verificada'
    && valor(`SELECT IFNULL(aviso_conta, 'nulo') FROM usuarios WHERE id = ${V.contas.A.id}`) === 'nulo', 'no banco: sem vencedor, o candidato volta a verificado e o aviso não lido some')
})

// ═══ 6. Desafios: criar, editar (só o que mudou), sair sem salvar, slug repetido ═════════════
await secao(page, '6. editor de desafio', async () => {
  // a recarga do desafio que o pulso pede (resposta lenta) não pode desenhar por cima do editor aberto depois dela
  await ir(page, `#/desafios?id=${D.tacas}`, 1800)
  await page.route(/admin\.php\?r=desafio&/, async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue().catch(() => {}) })
  await page.evaluate(() => { window.LP.abas.desafios.recarregar(); location.hash = '#/desafios?parte=novo' })
  await page.waitForTimeout(3000)
  await page.unroute(/admin\.php\?r=desafio&/)
  ok(await page.locator('#dz-titulo').count() === 1 && /parte=novo/.test(await page.evaluate(() => location.hash)), 'a recarga atrasada da tela anterior não desenha por cima do editor')
  ok(await page.locator('.erro-campo:not([hidden])').count() === 0, 'formulário novo sem erro antes de mexer')
  await page.fill('#dz-titulo', 'Artilheiro do Teste')
  ok(await page.inputValue('#dz-slug') === 'artilheiro-do-teste', 'o endereço (slug) sai do título')
  await page.fill('#dz-copas', '2')
  await page.fill('#dz-premio', 'Camisa do teste (texto livre do admin).')
  await page.fill('#dz-fim', '2026-12-31')
  await page.dispatchEvent('#dz-fim', 'change')
  await page.waitForTimeout(300)
  ok(/Artilheiro do Teste/.test(await page.textContent('.previa-desafio')) && /2 Copas do Mundo/.test(await page.textContent('.previa-desafio')) && /31\/12\/2026/.test(await page.textContent('.previa-desafio')), 'a prévia acompanha (título, critério, prazo)')
  await aba(page).locator('.barra-salvar button', { hasText: 'Criar desafio' }).click()
  await page.waitForSelector('dialog[open]')
  ok(/nasce desativado/.test(await page.textContent('dialog[open]')), 'criar: "nasce desativado"')
  await limparToasts(page)
  await page.locator('dialog[open] button[type=submit]').click()
  ok(await esperarToast(page, /criado/), 'desafio criado (toast)')
  await page.waitForTimeout(1500)
  const novo = valor("SELECT CONCAT(id, '|', ativo, '|', criterio, '|', IF(regulamento IS NULL OR regulamento = '', '-', '+'), '|', premio) FROM desafios WHERE slug = 'artilheiro-do-teste'").split('|')
  ok(novo[1] === '0' && novo[2] === '{"copas":2}' && novo[3] === '+' && novo[4].startsWith('Camisa do teste'), 'no banco: desativado, {"copas":2}, o regulamento de partida escrito pelo servidor e o prêmio')
  ok(new RegExp(`#/desafios\\?id=${novo[0]}$`).test(await page.evaluate(() => location.hash)), 'depois de criar, abre o desafio')
  // editar: só o prêmio vai (o início gravado na ativação nunca é trocado sem querer)
  await ir(page, `#/desafios?id=${D.tacas}&parte=editar`, 1800)
  await page.fill('#dz-premio', PREMIO_TESTE + ' Editado.')
  await page.waitForTimeout(300)
  ok(/1 alteração não salva: prêmio/.test(await page.textContent('#dz-resumo')), 'a barra diz o que mudou ("1 alteração não salva: prêmio")')
  const iniAntes = valor(`SELECT inicio FROM desafios WHERE id = ${D.tacas}`)
  await aba(page).locator('.barra-salvar button', { hasText: 'Salvar' }).click()
  await page.waitForSelector('dialog[open]')
  ok(/prêmio novo aparece no jogo/.test(await page.textContent('dialog[open]')), 'salvar um desafio ativo avisa que o prêmio novo aparece no jogo')
  await limparToasts(page)
  await page.locator('dialog[open] button[type=submit]').click()
  ok(await esperarToast(page, /Desafio salvo/), 'salvo')
  ok(/Editado\.$/.test(valor(`SELECT premio FROM desafios WHERE id = ${D.tacas}`)) && valor(`SELECT inicio FROM desafios WHERE id = ${D.tacas}`) === iniAntes, 'no banco: o prêmio novo e o mesmo início')
  ok(JSON.parse(valor("SELECT detalhes FROM admin_log WHERE acao = 'desafio_salvar' ORDER BY id DESC LIMIT 1")).campos.join(',') === 'premio', 'só o campo que mudou foi mandado (registro: campos = premio)')
  // com o desafio ativo, o início não fica vazio
  await ir(page, `#/desafios?id=${D.tacas}&parte=editar`, 1800)
  await page.locator('#dz-inicio').locator('xpath=..').locator('button', { hasText: 'Limpar' }).click()
  await page.waitForTimeout(300)
  ok(/não fica vazio/.test(await page.textContent('.editor-desafio')), 'desafio ativo: limpar o início mostra "o início não fica vazio"')
  // sair sem salvar
  await page.fill('#dz-titulo', 'As Taças do Rei (mexido)')
  await page.evaluate(() => { location.hash = '#/visao' })
  await page.waitForSelector('dialog[open]')
  ok(/alterações não salvas no desafio/.test(await page.textContent('dialog[open]')), 'sair com alteração: "Sair sem salvar?" fala do desafio')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  ok(/parte=editar/.test(await page.evaluate(() => location.hash)) && await page.inputValue('#dz-titulo') === 'As Taças do Rei (mexido)', 'cancelar fica no editor com o que foi digitado')
  await aba(page).locator('.barra-salvar button', { hasText: 'Descartar' }).click()
  await page.waitForTimeout(1500)
  ok(new RegExp(`#/desafios\\?id=${D.tacas}$`).test(await page.evaluate(() => location.hash)) && valor(`SELECT titulo FROM desafios WHERE id = ${D.tacas}`) === 'As Taças do Rei', '"Descartar" volta ao desafio sem mudar nada')
  // endereço repetido: o erro do servidor aparece
  await ir(page, '#/desafios?parte=novo', 1800)
  await page.fill('#dz-titulo', 'Repetido')
  await page.fill('#dz-slug', 'tacas-do-rei')
  await aba(page).locator('.barra-salvar button', { hasText: 'Criar desafio' }).click()
  await page.waitForSelector('dialog[open]')
  await page.locator('dialog[open] button[type=submit]').click()
  await page.waitForSelector('dialog[open] .dialogo-erro:not([hidden])')
  ok(/Já existe um desafio com esse endereço/.test(await page.textContent('dialog[open] .dialogo-erro')), 'endereço repetido: "Já existe um desafio com esse endereço (slug)."')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  ok(/Já existe um desafio/.test(await page.textContent('.editor-desafio')), '…e o erro fica no campo do endereço')
  await aba(page).locator('.barra-salvar button', { hasText: 'Cancelar' }).click()
  await page.waitForTimeout(800)
  if (await page.locator('dialog[open]').count()) await page.locator('dialog[open] button[type=submit]').click()
  await page.waitForTimeout(800)
})

// ═══ 7. Registro: as ações novas com nome e alvo ════════════════════════════════════════════
await secao(page, '7. Registro', async () => {
  await ir(page, '#/registro?acao=desafio_vencedor', 2000)
  ok(await aba(page).locator('tbody tr', { hasText: 'Declarou o vencedor' }).count() >= 1, 'Registro: "Declarou o vencedor" (desafio_vencedor) com nome em pt-BR')
  ok(await aba(page).locator(`tbody a[href="#/desafios?id=${D.tacas}"]`).count() >= 1, 'o alvo desafio:<id> leva ao desafio')
  await ir(page, '#/registro?acao=suporte_responder', 2000)
  ok(await aba(page).locator('tbody tr', { hasText: 'Respondeu mensagem' }).count() >= 1 && await aba(page).locator('tbody a', { hasText: /^mensagem #\d+$/ }).count() >= 1, '"Respondeu mensagem" com o alvo levando à mensagem')
  await ir(page, '#/registro?parte=emails', 2000)
  const tipos = await aba(page).locator('tbody td[data-rotulo="Tipo"]').allTextContents()
  ok(tipos.includes('Resposta do Fale conosco') && tipos.includes('Confirmação mandada pela equipe'), 'E-mails: "Resposta do Fale conosco" e "Confirmação mandada pela equipe"')
  ok(await page.evaluate(() => ['reenviar_verificacao', 'desafio_salvar', 'desafio_ativar', 'candidato_verificar', 'candidato_recusar', 'desafio_vencedor', 'desafio_reabrir', 'suporte_status', 'suporte_lote', 'suporte_responder'].every((a) => !!window.LP.NOMES_ACAO_LOG[a])), 'as 10 ações novas do registro têm nome')
})

const csp = await page.evaluate(() => window.__csp)
ok(csp.length === 0, 'CSP: nenhuma violação nas telas novas' + (csp.length ? ': ' + csp.slice(0, 3).join(' | ') : ''))
ok(page.erros.length === 0, 'nenhum erro de JavaScript' + (page.erros.length ? ': ' + page.erros.slice(0, 3).join(' | ') : ''))
await ctx.close()

// ═══ 8. papel Moderador: lê as mensagens; recusa candidato; não cria nem declara ═════════════
{
  const { ctx: c2, page: p2 } = await aparelho(1440, { outro: true })
  await secao(p2, '8. moderadora', async () => {
    await entrar(p2, { email: 'moderadora@exemplo.com', senha: 'moderadora-senha-nova-2026', pin: '481620' })
    const nova = Number(valor("SELECT id FROM mensagens_suporte WHERE status = 'nova' ORDER BY id DESC LIMIT 1"))
    await ir(p2, `#/mensagens?status=todas&mensagem=${nova}`, 2000)
    ok(await p2.locator('#gaveta .msg-texto').count() >= 1 && await p2.locator('#gaveta button', { hasText: /Responder por e-mail/ }).count() === 0
      && /só lê as mensagens/.test(await p2.textContent('#gaveta')), 'moderadora: lê a mensagem, sem "Responder" (pede o poder Contas)')
    ok(valor(`SELECT status FROM mensagens_suporte WHERE id = ${nova}`) === 'nova', '…e abrir não marca como lida (sem o poder)')
    ok(await aba(p2).locator('.barra-lote').count() === 0, '…sem lote')
    await ir(p2, '#/desafios', 2000)
    ok(await p2.locator('#acoes-aba button', { hasText: 'Criar desafio' }).count() === 0 && await aba(p2).locator('button', { hasText: /^Ativar$|^Desativar$/ }).count() === 0, 'moderadora: sem "Criar desafio" nem ativar (pedem Configurações)')
    await ir(p2, `#/desafios?id=${D.tacas}`, 2000)
    ok(await aba(p2).locator('button', { hasText: 'Declarar vencedor' }).count() === 0 && await aba(p2).locator('a', { hasText: 'Verificar de novo' }).count() >= 1, 'moderadora: verifica no jogo, mas não declara o vencedor')
    ok(p2.erros.length === 0, 'moderadora: nenhum erro de JavaScript' + (p2.erros.length ? ': ' + p2.erros.slice(0, 3).join(' | ') : ''))
  })
  await c2.close()
}

// ═══ 9. celular: sem rolagem lateral nas telas novas; alvos de 40 px ═════════════════════════
{
  const { ctx: c3, page: p3 } = await aparelho(390)
  await secao(p3, '9. celular', async () => {
    await entrar(p3)
    const g = await p3.evaluate(() => getComputedStyle(document.getElementById('numeros-acao')).gridTemplateColumns.split(' ').length)
    ok(g === 4 && await p3.locator('#na-mensagensNovas .na-curto').isVisible() && !(await p3.locator('#na-mensagensNovas .na-longo').isVisible()), 'celular: 8 números em 4 colunas, com o rótulo curto')
    for (const [hash, nome] of [['#/mensagens', 'Mensagens'], ['#/mensagens?status=todas', 'Mensagens (todas)'], [`#/mensagens?status=todas&mensagem=${M.recomendacao.id}`, 'ficha da mensagem'],
      ['#/desafios', 'Desafios'], [`#/desafios?id=${D.tacas}`, 'desafio com candidatos'], [`#/desafios?id=${D.tacas}&parte=editar`, 'editor de desafio'], ['#/desafios?parte=novo', 'desafio novo'],
      ['#/usuarios?verificado=0', 'Usuários não confirmados'], ['#/config', 'Configurações']]) {
      await ir(p3, hash, 1800)
      await semRolagemLateral(p3, 'celular · ' + nome)
      if (/parte=/.test(hash)) await aba(p3).locator('.barra-salvar button', { hasText: /Descartar|Cancelar/ }).click().catch(() => {})
      if (await p3.locator('dialog[open]').count()) await p3.locator('dialog[open] button[type=submit]').click()
    }
    await ir(p3, `#/desafios?id=${D.tacas}`, 1800)
    const pequenos = await p3.evaluate(() => Array.from(document.querySelectorAll('.aba:not([hidden]) .candidato .botoes > *')).filter((b) => b.offsetParent && b.getBoundingClientRect().height < 39).map((b) => b.textContent.trim()))
    ok(pequenos.length === 0, 'celular: botões dos candidatos com 40 px ou mais' + (pequenos.length ? ': ' + pequenos.join(', ') : ''))
    await ir(p3, `#/mensagens?status=todas&mensagem=${M.recomendacao.id}`, 1800)
    ok(await p3.evaluate(() => document.getElementById('gaveta').getBoundingClientRect().width) >= 389, 'celular: a ficha da mensagem ocupa a tela toda')
    ok(p3.erros.length === 0, 'celular: nenhum erro de JavaScript' + (p3.erros.length ? ': ' + p3.erros.slice(0, 3).join(' | ') : ''))
  })
  await c3.close()
}

await browser.close()
function exigirOk(r, oque) { if (r.status !== 200) throw new Error(`${oque}: ${r.status} ${r.txt.slice(0, 200)}`) }
const r = resultado()
console.log(`\npainel v3.3: ${r.oks} ok, ${r.falhas} falha(s) em ${((performance.now() - t0) / 1000).toFixed(0)} s`)
if (r.falhas) console.log('  ' + r.lista.join('\n  '))
process.exit(r.falhas ? 1 : 0)
