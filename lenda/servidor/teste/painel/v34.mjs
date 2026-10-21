// LENDA · teste do painel (v3.4) CONTRA A PILHA REAL: a aba Desafios com os desafios de emblema (a lista, quem ganhou com
// "Tirar"/"Devolver", o editor com os critérios novos, o ícone, a cor, a dificuldade e a faixa da tela inicial, ativar), o
// de todas as conquistas que agora ativa (o candidato pelas conquistas provadas, "Verificar as provas no jogo"), a ficha da
// conta (os emblemas, as conquistas provadas, conferidas e só do aparelho, as carreiras-prova e o lote do #/verificar), a
// ficha da carreira (a prova e os emblemas que ela deu), a coluna "Provadas" em Conquistas, o Registro, o papel Moderador e
// o celular. Roda pelo rodar.sh depois do v33.mjs e do mock-v34.mjs, na mesma pilha; planta o que precisa com o
// semente-v34.mjs (o servidor dá os emblemas sozinho: o banco é a régua). Com LENDA_PRINTS=<pasta>, tira os prints das
// telas da v3.4 em 1440 e 390 (em <pasta>/v34, ou em LENDA_PRINTS_V34) antes de mexer.
const { chromium } = await import(process.env.LENDA_PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright/index.mjs')
import { mkdirSync } from 'node:fs'
import { BASE, PAINEL, admin, env, ok, resultado, sql } from './lib.mjs'
import { MOTIVO_RETIRADA, semearV34 } from './semente-v34.mjs'

const EXE = process.env.LENDA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const PIN = process.env.LENDA_TESTE_PAINEL_PIN ?? '729153'
const PRINTS = process.env.LENDA_PRINTS_V34 ? process.env.LENDA_PRINTS_V34.replace(/\/$/, '') : process.env.LENDA_PRINTS ? process.env.LENDA_PRINTS.replace(/\/$/, '') + '/v34' : ''
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const t0 = performance.now()
const V = await semearV34()
sql("DELETE FROM tentativas WHERE chave LIKE 'painel:%'")
let sessaoDono = null
const browser = await chromium.launch({ executablePath: EXE, args: ['--lang=pt-BR'] })
let paginaAtual = null
process.on('uncaughtException', async (e) => {
  console.log(`  XX  o teste parou: ${String((e && e.message) || e).split('\n')[0]}`)
  try {
    if (paginaAtual) {
      console.log('      na tela: ' + (await paginaAtual.evaluate(() => location.hash)))
      await paginaAtual.screenshot({ path: `${BASE}/falha-v34.png` })
    }
  } catch { /* sem página */ }
  const r = resultado()
  console.log(`\npainel v3.4: ${r.oks} ok, ${r.falhas + 1} falha(s)`)
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
  page.on('dialog', (d) => d.accept())
  return { ctx, page }
}
async function entrar(page, o = {}) {
  await page.goto(PAINEL)
  await page.waitForFunction(() => !document.getElementById('tela-painel').hidden || !document.getElementById('tela-entrar').hidden, null, { timeout: 15000 })
  if (!(await page.isVisible('#tela-painel'))) {
    if (o.email) await page.fill('#email', o.email)
    await page.fill('#senha', o.senha ?? env.PAINEL_SENHA)
    await page.click('#botao-entrar')
    await page.waitForSelector('#tela-painel:not([hidden]), #form-pin:not([hidden])', { timeout: 15000 })
    if (await page.isVisible('#form-pin')) {
      await page.locator('#pin-caixas .pin-caixa').first().click()
      await page.keyboard.type(o.pin ?? PIN, { delay: 30 })
    }
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
async function esperarToast(page, re, ms = 8000) {
  try {
    await page.waitForFunction((r) => Array.from(document.querySelectorAll('#avisos .aviso-flutuante')).some((x) => new RegExp(r, 'i').test(x.textContent)), re.source, { timeout: ms })
    return true
  } catch { return false }
}
const limparToasts = (page) => page.evaluate(() => document.querySelectorAll('#avisos .aviso-flutuante').forEach((x) => x.remove()))
async function semRolagemLateral(page, nome) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
  return ok(w[0] <= w[1], `${nome}: sem rolagem lateral (${w[0]} ≤ ${w[1]})`)
}
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
const num = (q) => Number(sql(q) || 0)
const D = V.desafios
const C = V.contas
const P = V.carreiras
const ativosDe = (id) => num(`SELECT COUNT(*) FROM emblemas_usuario e JOIN usuarios u ON u.id = e.usuario_id WHERE e.desafio_id = ${id} AND e.estado = 'ativo' AND u.status = 'ativo'`)
const provasDe = (uid) => ({
  provadas: num(`SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id = ${uid} AND prova_pk IS NOT NULL`),
  verificadas: num(`SELECT COUNT(*) FROM conquistas_usuario cu JOIN carreiras c ON c.id = cu.prova_pk WHERE cu.usuario_id = ${uid} AND c.prova_ok = 1`),
  todas: num(`SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id = ${uid}`),
})

// ═══ 0. prints (antes de mexer) ═════════════════════════════════════════════════════════════
if (PRINTS) {
  for (const largura of [1440, 390]) {
    const { ctx, page } = await aparelho(largura)
    await entrar(page)
    await page.waitForTimeout(1000)
    let k = 0
    const foto = async (nome, cheia = true) => page.screenshot({ path: `${PRINTS}/${largura}-${String(++k).padStart(2, '0')}-${nome}.png`, fullPage: cheia })
    const fotoDe = async (nome, sel) => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await l.screenshot({ path: `${PRINTS}/${largura}-${String(++k).padStart(2, '0')}-${nome}.png` }) }
    for (const [hash, nome] of [['#/desafios', 'desafios'], [`#/desafios?id=${D['noite-de-gala']}`, 'emblema-noite-de-gala'], [`#/desafios?id=${D['hexa-e-gloria-eterna']}`, 'emblema-hexa-com-retirado'],
      [`#/desafios?id=${D['hexa-e-gloria-eterna']}&estado=retirado`, 'emblema-hexa-retirados'], [`#/desafios?id=${D['noite-de-gala']}&parte=editar`, 'emblema-editar'], ['#/desafios?parte=novo&modo=emblema', 'emblema-novo'],
      ['#/conquistas', 'conquistas-provadas']]) {
      await ir(page, hash, 2200)
      await foto(nome)
    }
    // o diálogo de tirar (fechado sem tirar)
    await ir(page, `#/desafios?id=${D['noite-de-gala']}`, 2000)
    await aba(page).locator(`.cartao-ganharam tbody tr:has-text("Galáctico") button`, { hasText: 'Tirar' }).click()
    await page.waitForSelector('dialog[open]')
    await foto('dialogo-tirar', false)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    // a ficha da conta: os emblemas, as conquistas (abertas) e as carreiras-prova; a ficha da carreira
    await ir(page, `#/usuarios?conta=${C.G.id}`, 2500)
    await page.locator('#gaveta .detalhes-conquistas summary').click()
    await page.locator('#gaveta .detalhes-provas summary').click()
    await page.waitForSelector('#gaveta .provas-carreiras tbody tr', { timeout: 8000 }).catch(() => {})
    await fotoDe('ficha-emblemas', '#gaveta #u-emblemas')
    await fotoDe('ficha-conquistas-provadas', '#gaveta #u-conquistas')
    await ir(page, `#/hall?carreira=${P.G}`, 2500)
    await fotoDe('ficha-carreira-prova', '#gaveta .cartao-prova-carreira')
    await ir(page, `#/hall?carreira=${P.A}`, 2500)
    await fotoDe('ficha-carreira-nao-bateu', '#gaveta .cartao-prova-carreira')
    await page.keyboard.press('Escape')
    for (const tema of ['claro', 'alto']) {
      await page.keyboard.press('t')
      await page.waitForTimeout(500)
      await ir(page, '#/desafios', 1800)
      await foto('tema-' + tema + '-desafios')
      await ir(page, `#/desafios?id=${D['noite-de-gala']}&parte=editar`, 1800)
      await foto('tema-' + tema + '-emblema-editar')
      await ir(page, `#/usuarios?conta=${C.G.id}`, 2200)
      await fotoDe('tema-' + tema + '-ficha-conquistas', '#gaveta #u-conquistas')
      await page.keyboard.press('Escape')
    }
    await page.keyboard.press('t')
    await ctx.close()
  }
  console.log(`· prints v3.4 em ${PRINTS}`)
}

const { ctx, page } = await aparelho(1440)
await entrar(page)
ok(true, 'v3.4: a conta Dono entra (senha do arquivo + PIN)')

// ═══ 1. a lista: os 10 de emblema e os 3 com prêmio ═══════════════════════════════════════════
await secao(page, '1. lista', async () => {
  await ir(page, '#/desafios', 2200)
  const emb = 'article.cartao-desafio[data-modo="emblema"]'
  // com prêmio: os 3 de fábrica e o que o v33.mjs criou no editor (o banco é a régua)
  const nPremio = num("SELECT COUNT(*) FROM desafios WHERE modo = 'primeiro'")
  ok(await aba(page).locator(emb).count() === 10 && await aba(page).locator('article.cartao-desafio[data-modo="primeiro"]').count() === nPremio && nPremio >= 3, `Desafios: os 10 de emblema e os ${nPremio} com prêmio`)
  ok(await aba(page).locator('#dz-g-emblema').count() === 1 && await aba(page).locator('#dz-g-premio').count() === 1, 'em dois grupos: "Desafios com emblema" e "Desafios com prêmio"')
  ok(await aba(page).locator(`${emb} .chip`, { hasText: 'Valendo' }).count() === 10, 'os 10 de emblema de fábrica valendo')
  ok(await aba(page).locator(`${emb} .emblema svg`).count() === 10, 'cada um com a moeda do emblema')
  const home = await aba(page).locator(`${emb}:has(.chip:has-text("Na faixa da tela inicial"))`).evaluateAll((as) => as.map((a) => a.dataset.id).sort())
  ok(JSON.stringify(home) === JSON.stringify([D['noite-de-gala'], D['hexa-e-gloria-eterna'], D['tacas-do-rei-emblema']].map(String).sort()), 'os 3 da faixa da tela inicial marcados (noite-de-gala, hexa, Taças do Rei)')
  const difs = await aba(page).locator(`${emb} .chip-dif`).allTextContents()
  ok(difs.filter((x) => x === 'Fácil').length === 3 && difs.filter((x) => x === 'Médio').length === 3 && difs.filter((x) => x === 'Difícil').length === 2 && difs.filter((x) => x === 'Lendário').length === 2, 'as dificuldades: 3 fáceis, 3 médios, 2 difíceis, 2 lendários')
  const dados = num("SELECT COUNT(*) FROM emblemas_usuario e JOIN desafios d ON d.id = e.desafio_id WHERE e.estado = 'ativo' AND d.modo = 'emblema'")
  ok((await aba(page).locator('.ladrilho', { hasText: 'Emblemas dados' }).locator('.ladrilho-valor').textContent()).trim() === String(dados), `ladrilho "Emblemas dados" = ${dados} (o banco)`)
  const n = ativosDe(D['hexa-e-gloria-eterna'])
  ok(await aba(page).locator(`article.cartao-desafio[data-id="${D['hexa-e-gloria-eterna']}"] .chip`, { hasText: `${n} contas com o emblema` }).count() === 1
    && await aba(page).locator(`article.cartao-desafio[data-id="${D['hexa-e-gloria-eterna']}"] .chip`, { hasText: '1 retirado' }).count() === 1, `Hexa: "${n} contas com o emblema" e "1 retirado" (o banco)`)
  ok(await aba(page).locator(`article.cartao-desafio[data-id="${D['noite-de-gala']}"]`, { hasText: '~1 em 12 carreiras de quem joga para isso · 1 em 24 ao acaso' }).count() === 1, 'a chance da calibração no cartão de fábrica')
  ok(await aba(page).locator(`article.cartao-desafio[data-id="${D['hexa-e-gloria-eterna']}"]`, { hasText: 'seleção: Brasil (a mesma do começo ao fim)' }).count() === 1, 'o critério com a seleção pelo nome')
})

// ═══ 2. quem ganhou: a lista, tirar e devolver ═════════════════════════════════════════════════
await secao(page, '2. quem ganhou, tirar e devolver', async () => {
  const id = D['noite-de-gala']
  await ir(page, `#/desafios?id=${id}`, 2200)
  const linhas = aba(page).locator('.cartao-ganharam tbody tr')
  ok(await linhas.count() === num(`SELECT COUNT(*) FROM emblemas_usuario WHERE desafio_id = ${id}`) && await linhas.count() >= 1, `Noite de gala: quem ganhou (${await linhas.count()}, como no banco)`)
  const g = aba(page).locator('.cartao-ganharam tbody tr:has-text("Galáctico")')
  ok(await g.locator('.chip', { hasText: 'Com o emblema' }).count() === 1, 'Galáctico com o emblema (a carreira-prova com Bola de Ouro + Champions)')
  ok(await g.locator('a', { hasText: 'Verificar no jogo' }).getAttribute('href') === `/lenda/#/verificar?id=${P.G}&prova=1` && await g.locator('a', { hasText: 'Abrir a carreira' }).getAttribute('href') === `/lenda/#/resumo?id=${P.G}&de=admin`,
    'os links do jogo: "Verificar no jogo" (&prova=1) e "Abrir a carreira"')
  ok(await aba(page).locator('.cartao-ganharam tbody tr:has-text("Sem Semente")').count() === 0, 'a carreira sem a semente do servidor não deu emblema')
  // tirar com o motivo (o jogador vê)
  await g.locator('button', { hasText: 'Tirar' }).click()
  await page.waitForSelector('dialog[open].dialogo-perigo')
  ok(/não volta sozinho/.test(await page.textContent('dialog[open]')), 'tirar: o diálogo diz que não volta sozinho')
  await page.locator('dialog[open] .chip-motivo', { hasText: 'Trapaça' }).click()
  await limparToasts(page)
  await page.locator('dialog[open] button[type=submit]').click()
  ok(await esperarToast(page, /Emblema retirado de @Galáctico/), 'emblema retirado (toast)')
  const eid = num(`SELECT id FROM emblemas_usuario WHERE desafio_id = ${id} AND usuario_id = ${C.G.id}`)
  ok(valor(`SELECT CONCAT(estado, '|', motivo) FROM emblemas_usuario WHERE id = ${eid}`) === 'retirado|Trapaça: números que o jogo não dá.', 'no banco: retirado com o motivo do chip')
  await page.waitForTimeout(1200)
  ok(await aba(page).locator(`.cartao-ganharam tbody tr[data-id="${eid}"].emblema-retirado`).count() === 1, 'a linha volta "Retirado" (a lista se refaz)')
  await aba(page).locator('.segmentos[aria-label="Situação do emblema"] button', { hasText: 'Retirados' }).click()
  await page.waitForTimeout(1500)
  ok(await aba(page).locator('.cartao-ganharam tbody tr').count() === num(`SELECT COUNT(*) FROM emblemas_usuario WHERE desafio_id = ${id} AND estado = 'retirado'`) && /estado=retirado/.test(await page.evaluate(() => location.hash)), 'filtro "Retirados" (no endereço)')
  await aba(page).locator(`.cartao-ganharam tbody tr[data-id="${eid}"] button`, { hasText: 'Devolver' }).click()
  await page.waitForSelector('dialog[open]')
  await limparToasts(page)
  await page.locator('dialog[open] button[type=submit]').click()
  ok(await esperarToast(page, /Emblema devolvido/) && valor(`SELECT CONCAT(estado, '|', IFNULL(motivo, '-')) FROM emblemas_usuario WHERE id = ${eid}`) === 'ativo|-', 'devolver sem motivo: de novo ativo')
  ok(num(`SELECT COUNT(*) FROM admin_log WHERE acao = 'emblema_retirar' AND alvo = 'desafio:${id}'`) >= 1 && num(`SELECT COUNT(*) FROM admin_log WHERE acao = 'emblema_devolver' AND alvo = 'desafio:${id}'`) >= 1, 'registro: emblema_retirar e emblema_devolver no desafio')
  // o retirado pelo "não bateu" (prova_verificar) e o retirado pela equipe (semente)
  await ir(page, `#/desafios?id=${D['andarilho-campeao']}`, 2200)
  ok(await aba(page).locator('.cartao-ganharam tbody tr:has-text("Andarilho")', { hasText: 'Não bateu na verificação por replay' }).count() === 1, 'Andarilho campeão: o emblema saiu sozinho com o "não bateu" (o motivo aparece)')
  await ir(page, `#/desafios?id=${D['tacas-do-rei-emblema']}&estado=retirado`, 2200)
  ok(await aba(page).locator('.cartao-ganharam tbody tr', { hasText: MOTIVO_RETIRADA }).count() === 1, 'As Taças do Rei (emblema): o retirado pela equipe, com o motivo')
})

// ═══ 3. editor: criar um de emblema, ativar (as contas que já cumprem ganham), mudar só o ícone ══
await secao(page, '3. editor de emblema', async () => {
  await ir(page, '#/desafios', 1500)
  await page.locator('#acoes-aba button', { hasText: 'Criar desafio de emblema' }).click()
  await page.waitForTimeout(1800)
  ok(/parte=novo&modo=emblema/.test(await page.evaluate(() => location.hash)) && await page.locator('#dz-premio').isHidden(), '"Criar desafio de emblema" abre o editor no tipo emblema (sem prêmio)')
  await page.fill('#dz-titulo', 'Emblema do teste do painel')
  ok(await page.inputValue('#dz-slug') === 'emblema-do-teste-do-painel', 'o endereço sai do título')
  await page.fill('#dz-copas', '0')
  await page.fill('#dz-gols', '500')
  await page.fill('#dz-clubes', '3')
  await page.selectOption('#dz-nacionalidade', 'BRA')
  await page.locator('.emblema-icones button[data-icone="crown"]').click()
  await page.locator('.segmentos[aria-label="Dificuldade"] button', { hasText: 'Médio' }).click()
  await page.locator('[data-campo="home"] .interruptor').click()
  ok(/500 gols \+ 3 clubes diferentes numa carreira do Clássico · seleção: Brasil/.test(await page.textContent('.previa-desafio')), 'a prévia com o critério novo')
  await aba(page).locator('.barra-salvar button', { hasText: 'Criar desafio' }).click()
  await page.waitForSelector('dialog[open]')
  await limparToasts(page)
  await page.locator('dialog[open] button[type=submit]').click()
  ok(await esperarToast(page, /criado/), 'criado (toast)')
  await page.waitForTimeout(1500)
  const l = valor("SELECT CONCAT_WS('|', id, ativo, modo, criterio, emblema, dificuldade, home, requisitos, regulamento IS NOT NULL, premio) FROM desafios WHERE slug = 'emblema-do-teste-do-painel'").split('|')
  const idNovo = Number(l[0])
  ok(l[1] === '0' && l[2] === 'emblema' && l[3] === '{"gols":500,"clubes":3,"nacionalidade":["BRA"]}' && l[4] === '{"icone":"crown","cor":"#c8d0dc"}' && l[5] === 'medio' && l[6] === '1'
    && l[7] === '{"partidasMin":0,"emailVerificado":false,"publicadoNoHall":false,"top3Perfil":false}' && l[8] === '1' && l[9] === '', 'no banco: desativado, modo emblema, o critério, o emblema (a prata do médio), a dificuldade, a faixa, sem requisito, o regulamento de partida, sem prêmio (' + l.join(' | ') + ')')
  ok(new RegExp(`#/desafios\\?id=${idNovo}$`).test(await page.evaluate(() => location.hash)), 'depois de criar, abre o desafio')
  // ativar: as carreiras-prova que já cumprem ganham o emblema agora
  await aba(page).locator('.perfil-acoes button', { hasText: 'Ativar' }).click()
  await page.waitForSelector('dialog[open]')
  ok(/dá o emblema a toda conta com uma carreira-prova/.test(await page.textContent('dialog[open]')), 'ativar: o diálogo explica que todo mundo que já cumpre ganha')
  await limparToasts(page)
  await page.locator('dialog[open] button[type=submit]').click()
  const ganharam = await page.waitForFunction(() => { const t = Array.from(document.querySelectorAll('#avisos .aviso-flutuante')).map((x) => x.textContent).join(' '); const m = /(\d+) contas? ganha/.exec(t); return m ? Number(m[1]) : null }, null, { timeout: 8000 }).then((h) => h.jsonValue()).catch(() => null)
  const noBanco = num(`SELECT COUNT(*) FROM emblemas_usuario WHERE desafio_id = ${idNovo} AND estado = 'ativo'`)
  ok(ganharam !== null && ganharam === noBanco && noBanco >= 3, `ativado: "${ganharam} contas ganharam o emblema" (no banco: ${noBanco})`)
  await page.waitForTimeout(1500)
  ok(await aba(page).locator('.cartao-ganharam tbody tr').count() === noBanco, 'quem ganhou aparece na hora')
  // mudar só o ícone: só o emblema vai no desafio_salvar
  await ir(page, `#/desafios?id=${idNovo}&parte=editar`, 2000)
  await page.locator('.emblema-icones button[data-icone="trophy"]').click()
  ok(/1 alteração não salva: emblema/.test(await page.textContent('#dz-resumo')), 'a barra: "1 alteração não salva: emblema"')
  await aba(page).locator('.barra-salvar button', { hasText: 'Salvar' }).click()
  await page.waitForSelector('dialog[open]')
  ok(/O emblema muda no jogo para todo mundo que já tem/.test(await page.textContent('dialog[open]')), 'salvar um ativo avisa que o emblema muda para quem já tem')
  await limparToasts(page)
  await page.locator('dialog[open] button[type=submit]').click()
  ok(await esperarToast(page, /Desafio salvo/), 'salvo')
  ok(valor(`SELECT emblema FROM desafios WHERE id = ${idNovo}`) === '{"icone":"trophy","cor":"#c8d0dc"}' && JSON.parse(valor("SELECT detalhes FROM admin_log WHERE acao = 'desafio_salvar' ORDER BY id DESC LIMIT 1")).campos.join(',') === 'emblema',
    'no banco o ícone novo; no registro, campos = emblema')
  // o tipo não muda depois que alguém ganhou
  await ir(page, `#/desafios?id=${D['noite-de-gala']}&parte=editar`, 2000)
  ok(await page.locator('.segmentos[aria-label="Tipo do desafio"] button:disabled').count() === 2 && /O tipo não muda depois/.test(await page.textContent('.editor-desafio')), 'com quem ganhou, o tipo fica travado (com o porquê)')
  await aba(page).locator('.barra-salvar button', { hasText: 'Descartar' }).click().catch(() => {})
  // limpa: o desafio de teste e os emblemas dele saem (o resto do teste não conta com ele)
  sql(`DELETE FROM emblemas_usuario WHERE desafio_id = ${idNovo}`)
  sql(`DELETE FROM desafios WHERE id = ${idNovo}`)
})

// ═══ 4. o de todas as conquistas: ativa, o candidato pelas conquistas provadas, o lote ═════════
await secao(page, '4. todas as conquistas pela prova', async () => {
  const id = D['todas-as-conquistas']
  await ir(page, '#/visao', 600)
  await ir(page, '#/desafios', 2000)
  const b = aba(page).locator(`article.cartao-desafio[data-id="${id}"] button`, { hasText: 'Ativar' })
  ok(await b.count() === 1 && !(await b.isDisabled()), 'o "Ativar" do de todas as conquistas liberado')
  await b.click()
  await page.waitForSelector('dialog[open]')
  ok(/provadas por carreiras/.test(await page.textContent('dialog[open]')), 'ativar: o diálogo fala das conquistas provadas')
  await limparToasts(page)
  await page.locator('dialog[open] button[type=submit]').click()
  ok(await esperarToast(page, /ativado/), 'ativado (toast)')
  const k = valor(`SELECT CONCAT(id, '|', estado) FROM desafio_candidatos WHERE desafio_id = ${id} AND usuario_id = ${C.K.id}`).split('|')
  ok(k[1] === 'pendente', 'o Colecionador (as 87 provadas) virou candidato, pendente')
  await ir(page, `#/desafios?id=${id}`, 2200)
  const c = aba(page).locator(`article.candidato[data-id="${k[0]}"]`)
  ok(await c.locator('a', { hasText: 'Verificar as provas no jogo' }).getAttribute('href') === `/lenda/#/verificar?conta=${C.K.id}&candidato=${k[0]}`, '"Verificar as provas no jogo" → o lote do #/verificar com o candidato')
  ok(/carreiras-prova da conta \(em lote\)/.test(await c.textContent()) && await c.locator('button', { hasText: 'Declarar vencedor' }).count() === 0, 'a explicação do lote; pendente não tem "Declarar vencedor"')
  ok(!/não pode ser ativado/.test(await aba(page).textContent()), 'nada do "sem prova" da v3.3')
})

// ═══ 5. a ficha da conta: emblemas e conquistas provadas ══════════════════════════════════════
await secao(page, '5. ficha da conta', async () => {
  await ir(page, `#/usuarios?conta=${C.G.id}`, 2600)
  const nEmb = num(`SELECT COUNT(*) FROM emblemas_usuario WHERE usuario_id = ${C.G.id}`)
  ok(await page.locator('#gaveta #u-emblemas tbody tr').count() === nEmb && nEmb === 3, `Emblemas: os ${nEmb} do Galáctico`)
  ok(await page.locator('#gaveta #u-emblemas tbody tr .emblema svg').count() === nEmb, 'cada um com a moeda do desafio')
  const p = provasDe(C.G.id)
  const cab = await page.locator('#gaveta #u-conquistas .cartao-cabeca').textContent()
  ok(cab.includes(`${p.provadas} provadas de 87`) && cab.includes(`${p.verificadas} conferidas`) && cab.includes(`${p.todas - p.provadas} só do aparelho`), `Conquistas: ${p.provadas} provadas · ${p.verificadas} conferidas · ${p.todas - p.provadas} só do aparelho (o banco) — ${cab.trim()}`)
  ok(await page.locator('#gaveta #u-conquistas a', { hasText: 'Verificar as provas no jogo' }).getAttribute('href') === `../#/verificar?conta=${C.G.id}`, '"Verificar as provas no jogo" → o #/verificar?conta= do jogo')
  await page.locator('#gaveta .detalhes-conquistas summary').click()
  const grupos = await page.locator('#gaveta .grupo-conquistas h3').allTextContents()
  ok(grupos[0].endsWith('· ' + p.verificadas) && grupos[2].endsWith('· ' + V.doAparelho.length), 'os grupos: conferidas e as 3 só do aparelho (' + grupos.slice(0, 3).join(' | ') + ')')
  const nomes = await page.evaluate(() => window.LP.nomes())
  ok(V.doAparelho.every((x) => nomes.conquistas[x]) && await page.locator('#gaveta .grupo-conquistas .chip-aparelho').count() === V.doAparelho.length, 'as do aparelho com o nome e tracejadas')
  await page.locator('#gaveta .detalhes-provas summary').click()
  await page.waitForSelector('#gaveta .provas-carreiras tbody tr', { timeout: 8000 })
  const linha = page.locator(`#gaveta .provas-carreiras tbody tr[data-id="${P.G}"]`)
  ok(await linha.count() === 1 && await linha.locator('.chip', { hasText: 'Bateu' }).count() === 1 && await linha.locator('.chip', { hasText: 'Essencial' }).count() === 1, 'carreiras-prova: a do Galáctico, essencial e "Bateu" (o prova_verificar da semente)')
  const nProva = num(`SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id = ${C.G.id} AND prova_pk = ${P.G}`)
  ok(await page.locator('#gaveta #u-carreiras .chip', { hasText: `Prova de ${nProva} conquistas` }).count() === 1, `Carreiras: "Prova de ${nProva} conquistas"`)
  // tirar pela ficha (Era de ouro) e devolver
  const era = page.locator('#gaveta #u-emblemas tbody tr:has-text("Era de ouro")')
  await era.locator('button', { hasText: 'Tirar' }).click()
  await page.waitForSelector('dialog[open]')
  await page.locator('dialog[open] textarea').fill('Teste da ficha: tirado e devolvido.')
  await limparToasts(page)
  await page.locator('dialog[open] button[type=submit]').click()
  ok(await esperarToast(page, /Emblema retirado/), 'tirar pela ficha (toast)')
  await page.waitForTimeout(1500)
  ok(await page.locator('#gaveta #u-emblemas tbody tr.emblema-retirado:has-text("Era de ouro")').count() === 1, 'a ficha se refaz com o emblema retirado (a moeda apagada)')
  await page.locator('#gaveta #u-emblemas tbody tr:has-text("Era de ouro") button', { hasText: 'Devolver' }).click()
  await page.waitForSelector('dialog[open]')
  await page.locator('dialog[open] button[type=submit]').click()
  ok(await esperarToast(page, /Emblema devolvido/) && valor(`SELECT e.estado FROM emblemas_usuario e JOIN desafios d ON d.id = e.desafio_id WHERE e.usuario_id = ${C.G.id} AND d.slug = 'era-de-ouro'`) === 'ativo', 'devolver pela ficha')
  // a conta sem semente do servidor: nada provado, nenhum emblema
  await ir(page, `#/usuarios?conta=${C.S.id}`, 2600)
  ok(/0 provadas de 87/.test(await page.locator('#gaveta #u-conquistas .cartao-cabeca').textContent()) && await page.locator('#gaveta #u-emblemas', { hasText: 'Nenhum emblema ainda' }).count() === 1, 'Sem Semente: 0 provadas e nenhum emblema')
  await page.locator('#gaveta .detalhes-provas summary').click()
  await page.waitForTimeout(1500)
  ok(await page.locator('#gaveta .provas-carreiras', { hasText: 'Nenhuma carreira-prova' }).count() === 1, 'Sem Semente: nenhuma carreira-prova')
  await page.keyboard.press('Escape')
})

// ═══ 6. a ficha da carreira, a aba Conquistas e o Registro ═══════════════════════════════════
await secao(page, '6. carreira, Conquistas e Registro', async () => {
  await ir(page, `#/hall?carreira=${P.G}`, 2600)
  const card = page.locator('#gaveta .cartao-prova-carreira')
  ok(await card.locator('.chip', { hasText: 'Prova das conquistas' }).count() === 1 && await card.locator('.chip', { hasText: 'Bateu no replay' }).count() === 1, 'carreira: "Prova das conquistas" e "Bateu no replay"')
  ok(/Champions League\s*3/.test(await card.textContent()) && await card.locator('.chip-link').count() === 3, 'os números novos (3 Champions) e os 3 emblemas que ela deu')
  ok(await card.locator('a', { hasText: 'Verificar no jogo' }).getAttribute('href') === `../#/verificar?id=${P.G}&prova=1`, '"Verificar no jogo" com &prova=1')
  await ir(page, `#/hall?carreira=${P.A}`, 2600)
  ok(await page.locator('#gaveta .cartao-prova-carreira .chip', { hasText: 'Não bateu no replay' }).count() === 1 && /Clubes diferentes: 12/.test(await page.locator('#gaveta .cartao-prova-carreira').textContent()), 'a do Andarilho: "Não bateu no replay" com o motivo')
  await page.keyboard.press('Escape')
  await ir(page, '#/conquistas', 2200)
  const th = await aba(page).locator('thead th').allTextContents()
  ok(th.some((x) => /Provadas/.test(x)), 'Conquistas: a coluna "Provadas"')
  const prov = num("SELECT COUNT(*) FROM conquistas_usuario cu JOIN usuarios u ON u.id = cu.usuario_id WHERE cu.conquista_id = 'ballon_dor' AND cu.prova_pk IS NOT NULL")
  const nomes = await page.evaluate(() => window.LP.nomes())
  const linhaBola = aba(page).locator('tbody tr', { hasText: nomes.conquistas.ballon_dor.t }).first()
  ok((await linhaBola.locator('td[data-rotulo="Provadas"]').textContent()).trim() === String(prov), `Bola de Ouro: ${prov} provadas (o banco)`)
  for (const [a, nome] of [['prova_verificar', 'Verificou provas'], ['emblema_retirar', 'Retirou emblema'], ['emblema_devolver', 'Devolveu emblema']]) {
    await ir(page, `#/registro?acao=${a}`, 1800)
    ok(await aba(page).locator('tbody tr', { hasText: nome }).count() >= 1, `Registro: "${nome}" (${a})`)
  }
})

const csp = await page.evaluate(() => window.__csp)
ok(csp.length === 0, 'CSP: nenhuma violação nas telas da v3.4' + (csp.length ? ': ' + csp.slice(0, 3).join(' | ') : ''))
ok(page.erros.length === 0, 'nenhum erro de JavaScript nem 5xx' + (page.erros.length ? ': ' + page.erros.slice(0, 3).join(' | ') : ''))
await ctx.close()

// ═══ 7. papel Moderador: tira e devolve emblemas e verifica no jogo; não cria nem muda desafio ════
{
  const { ctx: c2, page: p2 } = await aparelho(1440, { outro: true })
  await secao(p2, '7. moderadora', async () => {
    await entrar(p2, { email: 'moderadora@exemplo.com', senha: 'moderadora-senha-nova-2026', pin: '481620' })
    await ir(p2, `#/desafios?id=${D['noite-de-gala']}`, 2200)
    ok(await aba(p2).locator('.cartao-ganharam button', { hasText: 'Tirar' }).count() >= 1 && await aba(p2).locator('.cartao-ganharam a', { hasText: 'Verificar no jogo' }).count() >= 1, 'moderadora: "Tirar" e "Verificar no jogo" (poder moderar)')
    ok(await aba(p2).locator('.perfil-acoes button', { hasText: /Editar|Ativar|Desativar/ }).count() === 0, 'moderadora: sem Editar nem Ativar (pedem Configurações)')
    await ir(p2, '#/desafios', 2000)
    ok(await p2.locator('#acoes-aba button').count() === 0, 'moderadora: sem "Criar desafio de emblema" nem "Criar com prêmio"')
    await ir(p2, `#/usuarios?conta=${C.G.id}`, 2600)
    ok(await p2.locator('#gaveta #u-conquistas a', { hasText: 'Verificar as provas no jogo' }).count() === 1, 'moderadora: "Verificar as provas no jogo" na ficha')
    ok(p2.erros.length === 0, 'moderadora: nenhum erro de JavaScript' + (p2.erros.length ? ': ' + p2.erros.slice(0, 3).join(' | ') : ''))
  })
  await c2.close()
}

// ═══ 8. celular ══════════════════════════════════════════════════════════════════════════════
{
  const { ctx: c3, page: p3 } = await aparelho(390)
  await secao(p3, '8. celular', async () => {
    await entrar(p3)
    for (const [hash, nome] of [['#/desafios', 'Desafios'], [`#/desafios?id=${D['hexa-e-gloria-eterna']}`, 'quem ganhou'], [`#/desafios?id=${D['noite-de-gala']}&parte=editar`, 'editor do emblema'],
      ['#/desafios?parte=novo&modo=emblema', 'emblema novo'], [`#/desafios?id=${D['todas-as-conquistas']}`, 'todas as conquistas'], [`#/usuarios?conta=${C.G.id}`, 'ficha da conta'], [`#/hall?carreira=${P.G}`, 'ficha da carreira'], ['#/conquistas', 'Conquistas']]) {
      await ir(p3, hash, 2000)
      await semRolagemLateral(p3, 'celular · ' + nome)
      if (/parte=/.test(hash)) await aba(p3).locator('.barra-salvar button', { hasText: /Descartar|Cancelar/ }).click().catch(() => {})
      if (await p3.locator('dialog[open]').count()) await p3.locator('dialog[open] button[type=submit]').click()
      await p3.keyboard.press('Escape')
    }
    await ir(p3, `#/desafios?id=${D['hexa-e-gloria-eterna']}`, 2000)
    const pequenos = await p3.evaluate(() => Array.from(document.querySelectorAll('.aba:not([hidden]) .cartao-ganharam .botoes > *')).filter((b) => b.offsetParent && b.getBoundingClientRect().height < 39).map((b) => b.textContent.trim()))
    ok(pequenos.length === 0, 'celular: os botões de quem ganhou com 40 px ou mais' + (pequenos.length ? ': ' + pequenos.join(', ') : ''))
    ok(p3.erros.length === 0, 'celular: nenhum erro de JavaScript' + (p3.erros.length ? ': ' + p3.erros.slice(0, 3).join(' | ') : ''))
  })
  await c3.close()
}

await browser.close()
// admin.php pelo Bearer: o que o painel lê confere com o banco (o mesmo D/E que a tela desenhou)
{
  const r = await admin(null, { r: 'desafio', id: D['noite-de-gala'] })
  ok(r.status === 200 && r.json.desafio.modo === 'emblema' && r.json.emblemas.total === num(`SELECT COUNT(*) FROM emblemas_usuario WHERE desafio_id = ${D['noite-de-gala']}`), '?r=desafio de emblema: D.modo e o paginado de E (o que a tela usa)')
}
const r = resultado()
console.log(`\npainel v3.4: ${r.oks} ok, ${r.falhas} falha(s) em ${((performance.now() - t0) / 1000).toFixed(0)} s`)
if (r.falhas) console.log('  ' + r.lista.join('\n  '))
process.exit(r.falhas ? 1 : 0)
