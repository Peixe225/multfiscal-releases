// LENDA · teste do painel: as correções da revisão 3 (lado do painel), pelo navegador contra a mesma pilha do rodar.sh,
// depois do painel.mjs (a conta Dono já tem o PIN 729153; LENDA_TESTE_PAINEL_PIN muda). Cada bloco reproduz o achado
// e falhava antes da correção:
//   fila ao vivo (aviso velho, redesenho de 4 s, "resolvido em outra aba" da própria ação, aviso único) · foco no pulso ·
//   "Está tudo certo" em grupo de 2 contas · trio de bônus em 360/320 px · botões travados no pedido · seletor de ordem ·
//   "N dispensados" aberto · recado fixo · coluna "Desde" dos testers · coluna fixa e rótulos em 1024 px · nomes do
//   Registro e das etapas, "Quem" sem código e Conquistas no hash. O bloco 8b confere que o painel acompanha as correções
//   do servidor (§E.7): "409 ja_decidida" no Manter/Ocultar, podeAssumir na Equipe, "Entra em breve" na ficha e o
//   geradoEm do Tempo de jogo.
const { chromium } = await import(process.env.LENDA_PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright/index.mjs')
import { readFileSync, readdirSync } from 'node:fs'
import { BASE, PAINEL, admin, env, esc, ok, pedido, resultado, sleep, sql, uuid } from './lib.mjs'

const EXE = process.env.LENDA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const PIN = process.env.LENDA_TESTE_PAINEL_PIN ?? '729153'
const API = new URL('../../api/', import.meta.url).pathname
const NUCLEO = new URL('../../painel/nucleo.js', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: EXE, args: ['--lang=pt-BR'] })
const t0 = performance.now()
let paginaAtual = null
process.on('uncaughtException', async (e) => {
  console.log(`  XX  o teste parou: ${String((e && e.message) || e).split('\n')[0]}`)
  try {
    if (paginaAtual) {
      console.log('      na tela: ' + (await paginaAtual.evaluate(() => location.hash)))
      await paginaAtual.screenshot({ path: `${BASE}/falha-correcoes.png` })
      console.log(`      print: ${BASE}/falha-correcoes.png`)
    }
  } catch { /* sem página */ }
  const r = resultado()
  console.log(`\ncorreções do painel: ${r.oks} ok, ${r.falhas + 1} falha(s)`)
  process.exit(1)
})

async function aparelho(largura, altura = 900) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura }, deviceScaleFactor: 1, isMobile: largura < 600, hasTouch: largura < 600, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  const page = await ctx.newPage()
  paginaAtual = page
  page.erros = []
  page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) page.erros.push(m.text()) })
  page.on('pageerror', (er) => page.erros.push('pageerror: ' + er.message))
  page.on('dialog', (d) => d.accept())
  return { ctx, page }
}
async function digitarPin(page, raiz, pin) {
  await page.locator(`${raiz} .pin-caixa`).first().click()
  await page.keyboard.type(pin, { delay: 30 })
}
async function entrar(page) {
  await page.goto(PAINEL)
  await page.waitForSelector('#form-entrar:not([hidden]), #tela-painel:not([hidden])', { timeout: 15000 })
  if (await page.isVisible('#tela-painel')) return
  await page.fill('#senha', env.PAINEL_SENHA)
  await page.click('#botao-entrar')
  await page.waitForSelector('#tela-painel:not([hidden]), #form-pin:not([hidden])', { timeout: 15000 })
  if (await page.isVisible('#form-pin')) await digitarPin(page, '#pin-caixas', PIN)
  await page.waitForSelector('#tela-painel:not([hidden])', { timeout: 15000 })
  await page.waitForFunction(() => /atualizado às/.test(document.getElementById('selo-atualizado').textContent), null, { timeout: 20000 })
}
const ir = async (page, hash, espera = 1300) => {
  await page.evaluate((x) => { location.hash = x }, hash)
  await page.waitForTimeout(espera)
}
const aba = (page) => page.locator('.aba:not([hidden])')
/** O pulso na hora (o mesmo que uma ação pede), sem esperar os 15 s. */
const pulso = async (page, espera = 1500) => {
  await page.evaluate(() => window.LP.depoisDeAgir())
  await page.waitForTimeout(espera)
}
const ativo = (page) => page.evaluate(() => {
  const a = document.activeElement
  return a ? { tag: a.tagName, valor: a.dataset ? a.dataset.valor || '' : '', texto: (a.textContent || '').trim().slice(0, 40) } : null
})
let nConta = 0
/** Conta de jogador nova (cada uma com o seu IP): {id, cookie, ip}. */
async function jogador(apelido) {
  const ip = `10.55.${(++nConta) >> 8}.${(nConta & 255) + 1}`
  const r = await pedido('api/conta.php', { ip, corpo: { acao: 'cadastrar', apelido, email: `corr-${Date.now().toString(36)}-${nConta}@exemplo.com`, senha: 'segredo-corr-1', aceite: true, vid: uuid() } })
  if (r.status !== 201) throw new Error(`cadastro de ${apelido}: ${r.status} ${r.txt.slice(0, 200)}`)
  return { id: r.json.usuario.id, cookie: r.cookie, ip }
}
const denunciar = (j, hid, texto) => pedido('api/hall.php', { ip: j.ip, cookie: j.cookie, corpo: { acao: 'denunciar', id: hid, motivo: 'outro', texto } })
const abertas = () => Number(sql("SELECT COUNT(*) FROM denuncias WHERE status = 'aberta'"))

/** Um bloco do teste: se um passo travar (seletor que não aparece), conta como falha e o teste segue para o próximo. */
async function secao(nome, fn) {
  try {
    await fn()
  } catch (e) {
    ok(false, `${nome}: o bloco parou — ${String((e && e.message) || e).split('\n')[0]}`)
    try {
      for (let i = 0; i < 3 && await page.locator('dialog[open]').count(); i++) await page.keyboard.press('Escape')
      await page.evaluate(() => document.querySelectorAll('.aba:not([hidden]) input[type=checkbox]:checked').forEach((x) => x.click()))
    } catch { /* segue */ }
  }
}

const { ctx, page } = await aparelho(1440)
await entrar(page)
ok(true, 'entrada: a conta Dono entra (senha do arquivo + PIN)')

// ═══ 1. fila ao vivo (Denúncias): aviso velho, aviso por origem, "resolvido em outra aba" da própria ação, 4 s ═══
exigirOk(await admin({ acao: 'atualizar_hall' }), 'atualizar_hall')
const comAberta = new Set(sql("SELECT DISTINCT carreira_pk FROM denuncias WHERE status = 'aberta'").split('\n').filter(Boolean).map(Number))
const livres = sql('SELECT carreira_pk, carreira_id FROM hall_foto ORDER BY id').split('\n').filter(Boolean).map((l) => l.split('\t'))
  .map(([pk, hid]) => ({ pk: Number(pk), hid })).filter((f) => !comAberta.has(f.pk))
ok(livres.length >= 6, `semente: 6 carreiras do Hall sem denúncia aberta (${livres.length})`)
const [A, B, E, C, D] = livres
const den = []
for (let k = 0; k < 5; k++) den.push(await jogador(`Corr Den ${k + 1}`))
const cartao = (pk) => aba(page).locator(`article.denuncia[data-id="${pk}"]`)
const fechar = (pks) => admin({ acao: 'resolver_denuncias_lote', carreiras: pks, resultado: 'ok', motivo: 'Teste: outra aba' })
await secao('1a. aviso da fila: velho e um por origem', async () => {
  ok((await denunciar(den[0], A.hid, 'Teste da fila: A')).status === 200, 'denúncia na carreira A')
  await ir(page, '#/denuncias', 1800)
  ok(await cartao(A.pk).count() === 1, 'Denúncias: a carreira A aberta na fila')
  // ocupado (A marcada) e chega a denúncia da B: o aviso
  await cartao(A.pk).locator('input[type=checkbox]').check()
  ok((await denunciar(den[1], B.hid, 'Teste da fila: B')).status === 200, 'outra conta denuncia a carreira B')
  await pulso(page)
  const aviso = page.locator('#novidade [data-origem="fila"] .novidade-botao, #novidade > .novidade-botao').first()
  ok(await aviso.isVisible() && /1 carreira denunciada nova/.test(await aviso.textContent()), 'ocupado: "1 carreira denunciada nova — clique para ver"')
  // um recado novo da equipe não troca o aviso da fila (um por origem)
  await page.evaluate(() => window.LP.novidade('Recado novo da equipe — clique para ver', () => {}, 'recados'))
  ok(await page.locator('#novidade .novidade-item').count() === 2 && /denunciada/.test(await page.textContent('#novidade')), 'aviso da fila e aviso de recado juntos (um não troca o outro)')
  if (await page.locator('#novidade [data-origem="recados"] .novidade-fechar').count()) await page.locator('#novidade [data-origem="recados"] .novidade-fechar').click()
  // outra aba resolve a A; o clique no aviso busca a lista de agora (antes: desenhava a resposta guardada, com a A aberta)
  exigirOk(await fechar([A.pk]), 'resolver A por fora')
  await page.locator('#novidade .novidade-botao').first().click()
  await page.waitForTimeout(1500)
  ok(await aba(page).locator(`article.denuncia[data-id="${A.pk}"]:not(.resolvido)`).count() === 0, 'clique no aviso: a A (resolvida agora em outra aba) não volta como aberta')
  ok(await cartao(B.pk).count() === 1, '…e a B nova aparece')
  const sub = (await page.textContent('#sub-aba')).trim()
  ok(sub === `${abertas()} abertas`, `…o subtítulo com o número de agora ("${sub}" = ${abertas()} no banco)`)
})
await secao('1b. a própria ação não é "resolvida em outra aba"', async () => {
  ok((await denunciar(den[2], E.hid, 'Teste da fila: E')).status === 200, 'denúncia na carreira E')
  await ir(page, '#/visao', 600)
  await ir(page, '#/denuncias', 1800)
  await page.evaluate(() => document.querySelectorAll('#avisos .aviso-flutuante').forEach((x) => x.remove()))
  await cartao(E.pk).locator('input[type=checkbox]').check()
  await aba(page).locator('.barra-lote-acoes button', { hasText: 'Manter' }).click()
  await page.waitForSelector('dialog[open]')
  await page.locator('dialog[open] button[type=submit]').click()
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#avisos .aviso-flutuante')).some((x) => /1 mantida/.test(x.textContent)), null, { timeout: 8000 })
  await page.waitForTimeout(3000)
  const toasts = await page.locator('#avisos .aviso-flutuante').allTextContents()
  ok(!toasts.some((t) => /outra aba/.test(t)), 'lote desta aba: só "1 mantida", sem "resolvido em outra aba" (' + toasts.join(' | ').replace(/\s+/g, ' ') + ')')
  ok(await page.locator('.selo-resolvido').count() === 0, '…e nenhuma linha com o selo "Resolvido em outra aba"')
})
await secao('1c. o redesenho de 4 s confere de novo se o admin ficou ocupado', async () => {
  ok((await denunciar(den[3], C.hid, 'Teste da fila: C')).status === 200 && (await denunciar(den[4], D.hid, 'Teste da fila: D')).status === 200, 'denúncias nas carreiras C e D')
  await ir(page, '#/visao', 600)
  await ir(page, '#/denuncias', 1800)
  ok(await cartao(C.pk).count() === 1 && await cartao(D.pk).count() === 1, 'C e D na fila')
  exigirOk(await fechar([C.pk]), 'resolver C por fora')
  await pulso(page, 200)
  ok(await page.waitForSelector(`.aba:not([hidden]) article.denuncia[data-id="${C.pk}"] > .selo-resolvido`, { timeout: 10000 }).then(() => true, () => false), 'a C (resolvida em outra aba) ganha o selo no cartão')
  const caixaD = cartao(D.pk).locator('input[type=checkbox]')
  await caixaD.check()
  await caixaD.evaluate((x) => { x.__marca = 1 })
  await page.waitForTimeout(5000)
  ok(await page.evaluate((pk) => { const x = document.querySelector(`.aba:not([hidden]) article.denuncia[data-id="${pk}"] input[type=checkbox]`); return !!x && x.__marca === 1 && x.checked }, D.pk),
    '4 s depois, com a D marcada: a lista não é redesenhada por cima (a caixa marcada continua a mesma)')
  await caixaD.uncheck()
})
await fechar([A.pk, B.pk, C.pk, D.pk, E.pk])

// ═══ 2. foco do teclado não se perde no pulso nem no clique do chip ════════════════════════════════════════════════
await secao('2. foco do teclado não se perde no pulso nem no clique do chip', async () => {
  await ir(page, '#/hall', 1800)
  await aba(page).locator('.segmentos button[data-valor="ocultas"]').focus()
  await pulso(page)
  await page.evaluate(() => window.LP.atualizarResumo())
  await page.waitForTimeout(1200)
  let a = await ativo(page)
  ok(a && a.valor === 'ocultas', `Hall: o foco fica no chip "Ocultas" depois do pulso e do resumo (${JSON.stringify(a)})`)
  await aba(page).locator('.segmentos button[data-valor="suspeitas"]').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1500)
  a = await ativo(page)
  ok(a && a.valor === 'suspeitas' && /filtro=suspeitas/.test(await page.evaluate(() => location.hash)), `Hall: Enter no chip "Suspeitas" filtra e o foco fica nele (${JSON.stringify(a)})`)
  await ir(page, '#/indicacoes', 1800)
  await aba(page).locator('.segmentos button[data-valor="valida"]').focus()
  await pulso(page)
  a = await ativo(page)
  ok(a && a.valor === 'valida', `Indicações: o foco fica no chip "Válidas" depois do pulso (${JSON.stringify(a)})`)
  await ir(page, '#/area', 1800)
  await aba(page).locator('.segmentos button[data-valor="conta"]').focus()
  await pulso(page, 2000)
  a = await ativo(page)
  ok(a && a.valor === 'conta', `Na área: o foco fica no chip "Com conta" depois do pulso (${JSON.stringify(a)})`)
  await ir(page, '#/usuarios', 1800)
  await aba(page).locator('.chip-filtro[data-valor="status=ativo"]').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1500)
  a = await ativo(page)
  ok(a && a.valor === 'status=ativo' && /status=ativo/.test(await page.evaluate(() => location.hash)), `Usuários: Enter no chip "Ativos" filtra e o foco fica nele (${JSON.stringify(a)})`)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
})

// ═══ 3. seletor "Ordem" acompanha o cabeçalho; "Anotar" e "Destacar" travados no pedido ═══════════════════════════
await secao('3. seletor "Ordem" acompanha o cabeçalho; "Anotar" e "Destacar"', async () => {
  await ir(page, '#/usuarios', 1500)
  await aba(page).locator('th button.ordenar', { hasText: 'Partidas' }).click()
  await page.waitForTimeout(1500)
  ok(await aba(page).locator('select[aria-label="Ordem"]').inputValue() === 'partidas' && /ordem=partidas/.test(await page.evaluate(() => location.hash)),
    'Usuários: ordenar por "Partidas" no cabeçalho muda também o seletor "Ordem"')
  // filtro mudado na própria aba (replaceState) e depois "#/usuarios" puro (o "Limpar filtros"): a aba volta sem filtro
  await aba(page).locator('.chip-filtro[data-valor="status=suspenso"]').click()
  await page.waitForTimeout(1200)
  await ir(page, '#/usuarios', 1500)
  ok(await aba(page).locator('.chip-filtro[data-valor="todos"]').getAttribute('aria-pressed') === 'true' && !/status=/.test(await page.evaluate(() => location.hash)),
    'Usuários: "Limpar filtros" (#/usuarios) depois de um filtro tira o filtro')
  await aba(page).locator('tbody tr').first().locator('button', { hasText: 'Anotar' }).dblclick()
  await page.waitForTimeout(1800)
  ok(await page.locator('dialog[open]').count() === 1, `"Anotar" com dois cliques: um diálogo só (${await page.locator('dialog[open]').count()})`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  const posts = []
  const ouvir = (r) => { if (r.method() === 'POST' && /destacar_carreira/.test(r.postData() || '')) posts.push(r.postData()) }
  page.on('request', ouvir)
  await ir(page, '#/hall', 1800)
  const destacar = aba(page).locator('tbody tr').first().locator('button', { hasText: /^(Destacar|Tirar destaque)$/ })
  ok(await destacar.count() === 1, 'Hall: "Destacar" na 1ª linha')
  await destacar.dblclick()
  await page.waitForTimeout(2000)
  page.off('request', ouvir)
  ok(posts.length === 1, `"Destacar" com dois cliques: um POST só (${posts.length})`)
})

// ═══ 4. "Está tudo certo" num grupo de 2 contas (Indicações → Mesmo aparelho) ════════════════════════════════════
await secao('4. "Está tudo certo" num grupo de 2 contas (Indicações → Mesmo ', async () => {
  const p1 = await jogador('Corr Par Um')
  const p2 = await jogador('Corr Par Dois')
  const vid = uuid()
  for (const p of [p1, p2]) sql(`INSERT INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, origem, bot) VALUES ('${uuid()}', '${vid}', ${p.id}, UTC_TIMESTAMP(), UTC_TIMESTAMP(), 60, 'direto', 0)`)
  const g = exigirOk(await admin(null, { r: 'multicontas', atualizar: '1' }), 'multicontas')
  const grupo = (g.itens || []).find((x) => (x.contas || []).map((c) => c.id).join(',') === [p1.id, p2.id].join(','))
  ok(!!grupo && grupo.dispensado === false, 'o grupo de 2 contas aparece em Mesmo aparelho')
  await ir(page, '#/indicacoes?status=aparelho', 1800)
  const cartao = aba(page).locator(`.cartao-grupo[data-id="${grupo.chave}"]`)
  await cartao.locator('button', { hasText: 'Está tudo certo' }).click()
  await page.waitForTimeout(1800)
  const toasts = await page.locator('#avisos .aviso-flutuante').allTextContents()
  ok(toasts.some((t) => /Grupo dispensado/.test(t)) && !toasts.some((t) => /não está mais na lista/.test(t)), 'grupo de 2 contas: "Está tudo certo" dispensa (antes: "Esse aviso não está mais na lista")')
  ok(await aba(page).locator(`.cartao-grupo[data-id="${grupo.chave}"]`, { hasText: 'Dispensado' }).count() === 1, '…e o cartão mostra "Dispensado"')
})

// ═══ 5. "Precisa de atenção": o "N dispensados" aberto e o foco ficam no redesenho ═══════════════════════════════
await secao('5. "Precisa de atenção": o "N dispensados" aberto e o foco fica', async () => {
  let at = exigirOk(await admin(null, { r: 'atencao', atualizar: '1' }), 'atencao')
  if (!(at.dispensados || []).length) {
    const d = (at.alertas || []).find((x) => x.dispensavel)
    if (d) exigirOk(await admin({ acao: 'alerta_dispensar', chave: d.chave }), 'dispensar um alerta')
    at = exigirOk(await admin(null, { r: 'atencao', atualizar: '1' }), 'atencao')
  }
  ok((at.dispensados || []).length >= 1, 'há alerta dispensado')
  await ir(page, '#/visao', 1500)
  await page.evaluate(() => window.LP.recarregarAtencao())
  await page.waitForTimeout(1500)
  await page.locator('#atencao details.atencao-dispensados summary').click()
  await page.locator('#atencao details.atencao-dispensados button', { hasText: 'Reabrir' }).first().focus()
  await page.evaluate(() => window.LP.recarregarAtencao())
  await page.waitForTimeout(1500)
  ok(await page.evaluate(() => !!document.querySelector('#atencao details.atencao-dispensados[open]')), 'atenção refeita (mesmo conteúdo): o "N dispensados" continua aberto')
  // conteúdo novo (3 contas no mesmo aparelho = alerta novo): redesenha, e o aberto e o foco voltam
  const tr = [await jogador('Corr Tri Um'), await jogador('Corr Tri Dois'), await jogador('Corr Tri Tres')]
  const vid = uuid()
  for (const p of tr) sql(`INSERT INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, origem, bot) VALUES ('${uuid()}', '${vid}', ${p.id}, UTC_TIMESTAMP(), UTC_TIMESTAMP(), 60, 'direto', 0)`)
  exigirOk(await admin(null, { r: 'multicontas', atualizar: '1' }), 'multicontas')
  await page.locator('#atencao details.atencao-dispensados button', { hasText: 'Reabrir' }).first().focus()
  await page.evaluate(() => window.LP.recarregarAtencao())
  await page.waitForFunction(() => /Corr Tri/.test(document.getElementById('atencao').textContent), null, { timeout: 8000 }).catch(() => {})
  ok(/Corr Tri/.test(await page.textContent('#atencao')), 'atenção com o alerta novo (redesenhada)')
  ok(await page.evaluate(() => !!document.querySelector('#atencao details.atencao-dispensados[open]')), '…o "N dispensados" continua aberto')
  const a = await ativo(page)
  ok(a && a.tag === 'BUTTON' && /Reabrir/.test(a.texto), `…e o foco volta para o "Reabrir" (${JSON.stringify(a)})`)
})

// ═══ 6. recado fixo: fica no topo depois de lido, sem o × ══════════════════════════════════════════════════════
await secao('6. recado fixo: fica no topo depois de lido, sem o ×', async () => {
  const dono = Number(sql('SELECT id FROM admin_contas WHERE da_config = 1 LIMIT 1'))
  const tituloFixo = 'Recado fixo do teste ' + uuid().slice(0, 6)
  // de outra pessoa da equipe (para quem escreve, o recado já nasce lido)
  const autor = Number(sql('SELECT id FROM admin_contas WHERE da_config = 0 ORDER BY id LIMIT 1'))
  sql(`INSERT INTO admin_recados (titulo, texto, tom, para, fixo, ate, criado_em, criado_por, lidos) VALUES ('${tituloFixo}', 'Fica no topo.', 'aviso', NULL, 1, NULL, UTC_TIMESTAMP(), ${autor}, '')`)
  await page.evaluate(() => window.LP.recarregarRecados())
  await page.waitForTimeout(1200)
  const fixo = page.locator('#recados .recado', { hasText: tituloFixo })
  ok(await fixo.count() === 1 && await fixo.locator('.recado-fechar').count() === 0, 'recado fixo no topo, sem o ×')
  await fixo.locator('button', { hasText: 'Marcar como lido' }).click()
  await page.waitForTimeout(1000)
  ok(await fixo.count() === 1, '"Marcar como lido" no fixo: ele continua no topo')
  await page.evaluate(() => window.LP.recarregarRecados())
  await page.waitForTimeout(1200)
  ok(await fixo.count() === 1 && await fixo.locator('button').count() === 0, '…lido (recarregado): continua no topo, sem botão')
  ok(sql(`SELECT lidos FROM admin_recados WHERE titulo = '${tituloFixo}'`) === String(dono), '…e a leitura ficou gravada')
})

// ═══ 6b. carreiras.php: o "porque" do "fora" (o jogo esconde a estrela que não muda nada) ═══════════════════════
await secao('6b. carreiras.php: o porque do fora', async () => {
  const S = JSON.parse(readFileSync(`${BASE}/semente.json`, 'utf8'))
  const c = S.contas['Camisa10']
  let cookie = c.cookie
  let r = await pedido('api/carreiras.php', { ip: c.ip, cookie })
  if (r.status !== 200) cookie = (await pedido('api/conta.php', { ip: c.ip, corpo: { acao: 'entrar', email: c.email, senha: 'segredo-123' } })).cookie
  sql("UPDATE carreiras SET modo = 'imersivo' WHERE carreira_id = 'career-painel-1-0'")
  r = await pedido('api/carreiras.php', { ip: c.ip, cookie })
  const h = ((r.json && r.json.carreiras) || []).find((x) => x.id === 'career-painel-1-0')
  sql("UPDATE carreiras SET modo = 'classico' WHERE carreira_id = 'career-painel-1-0'")
  ok(!!h && h.hall && h.hall.estado === 'fora' && h.hall.porque === 'imersivo', `Imersivo: hall {estado: fora, porque: imersivo} (${JSON.stringify(h && h.hall)})`)
})

// ═══ 7. Testes: a coluna "Desde" dos testers; Equipe: etapas com nome e botões travados ══════════════════════════
await secao('7. Testes: a coluna "Desde" dos testers; Equipe: etapas com nom', async () => {
  if (sql("SELECT COUNT(*) FROM usuarios WHERE tipo = 'tester'") === '0') {
    const t = await jogador('Corr Tester')
    exigirOk(await admin({ acao: 'mudar_tipo', id: t.id, tipo: 'tester' }), 'mudar_tipo tester')
  }
  await ir(page, '#/testes', 2000)
  const cab = await aba(page).locator('thead th').allTextContents()
  ok(cab.map((x) => x.trim().toLowerCase()).includes('desde'), 'Testers: coluna "Desde" (' + cab.join(', ') + ')')
  ok(/\d{2}\/\d{2}\/\d{4}/.test(await aba(page).locator('tbody td[data-rotulo="Desde"] .quando').first().getAttribute('title') || ''), '…com a data em que virou tester')
  ok(await aba(page).locator('tbody button[data-gerundio="Tirando…"]', { hasText: 'Tirar' }).count() >= 1, '"Tirar" tester travado no pedido ("Tirando…")')
  // uma entrada parada no PIN (outro aparelho)
  const { ctx: c2, page: p2 } = await aparelho(1280)
  await p2.goto(PAINEL)
  await p2.waitForSelector('#form-entrar:not([hidden])')
  await p2.fill('#senha', env.PAINEL_SENHA)
  await p2.click('#botao-entrar')
  await p2.waitForSelector('#form-pin:not([hidden])', { timeout: 15000 })
  paginaAtual = page
  await ir(page, '#/equipe?parte=sessoes', 1800)
  const etapas = await aba(page).locator('tbody td[data-rotulo="Etapa"]').allTextContents()
  ok(etapas.some((t) => /digitando o PIN/.test(t)) && !etapas.some((t) => /^(pin|criar_pin|trocar_senha)$/.test(t.trim())), 'Sessões: a etapa com nome ("digitando o PIN"), nunca o código cru (' + etapas.join(', ') + ')')
  ok(await aba(page).locator('tbody button[data-gerundio="Encerrando…"]').count() >= 1, '"Encerrar" sessão travado no pedido ("Encerrando…")')
  await c2.close()
  await ir(page, '#/equipe', 1800)
  const zerar = aba(page).locator('tbody button', { hasText: 'Zerar PIN' })
  if (await zerar.count()) ok(await zerar.first().getAttribute('data-gerundio') === 'Zerando…', '"Zerar PIN" travado no pedido ("Zerando…")')
  await ir(page, '#/equipe?parte=recados', 1800)
  const marcar = aba(page).locator('button', { hasText: 'Marcar como lido' })
  const apagar = aba(page).locator('.recado button', { hasText: 'Apagar' })
  ok((await apagar.count()) >= 1 && await apagar.first().getAttribute('data-gerundio') === 'Apagando…'
    && (!(await marcar.count()) || await marcar.first().getAttribute('data-gerundio') === 'Marcando…'), 'Recados: "Apagar" e "Marcar como lido" travados no pedido')
})

// ═══ 8. Registro: nomes de todas as ações; "Quem" pelo nome; Conquistas no hash ═════════════════════════════════
await secao('8. Registro: nomes de todas as ações; "Quem" pelo nome; Conquis', async () => {
  const acoes = new Set()
  for (const f of readdirSync(API).filter((x) => x.endsWith('.php'))) {
    for (const m of readFileSync(API + f, 'utf8').matchAll(/registrarAdmin\(\s*'([a-z_]+)'/g)) acoes.add(m[1])
  }
  const nomes = await page.evaluate(() => Object.keys(window.LP.NOMES_ACAO_LOG))
  const faltam = [...acoes].filter((a) => !nomes.includes(a))
  ok(faltam.length === 0 && acoes.size > 30, `Registro: toda ação gravada pelo servidor tem nome em pt-BR (${acoes.size} ações${faltam.length ? '; faltam: ' + faltam.join(', ') : ''})`)
  ok(readFileSync(NUCLEO, 'utf8').includes("copia_baixar: 'Baixou cópia do servidor'"), '…inclusive "copia_baixar" (Baixou cópia do servidor)')
  await ir(page, '#/registro', 2000)
  ok(await aba(page).locator('input[placeholder="a1 (pessoa) ou token"]').count() === 0, 'Registro: o filtro "Quem" não pede mais o código interno')
  const sel = aba(page).locator('select[aria-label="Quem"]')
  await page.waitForTimeout(800)
  const op = await sel.evaluate((s) => Array.from(s.options).map((o) => [o.value, o.textContent]))
  const dono = op.find(([v, t]) => /^a\d+$/.test(v) && /Dono/.test(t))
  ok(!!dono && op.some(([v]) => v === 'token'), 'Registro: "Quem" com as pessoas da equipe pelo nome e "Script (token)" (' + op.map((x) => x[1]).join(', ') + ')')
  await sel.selectOption(dono[0])
  await page.waitForTimeout(1500)
  ok(new RegExp(`quem=${dono[0]}`).test(await page.evaluate(() => location.hash)), '…escolher a pessoa filtra (quem= no hash)')
  const quemCel = await aba(page).locator('tbody td[data-rotulo="Quem"]').allTextContents()
  ok(quemCel.length > 0 && quemCel.every((t) => /Dono/.test(t)), '…e só as linhas dela')
  await ir(page, '#/registro', 1800)
  const link = aba(page).locator('tbody td[data-rotulo="Quem"] a').first()
  ok(await link.count() === 1, 'Registro: o nome em "Quem" é um link que filtra')
  await link.click()
  await page.waitForTimeout(1500)
  const q = (await page.evaluate(() => location.hash)).match(/quem=([^&]+)/)
  ok(!!q && await aba(page).locator('select[aria-label="Quem"]').inputValue() === decodeURIComponent(q[1]), '…e o seletor mostra a mesma pessoa')
  // Conquistas: busca, raridade e ordem no hash
  await ir(page, '#/conquistas', 2000)
  await aba(page).locator('input[type=search]').fill('gol')
  await page.waitForTimeout(800)
  await aba(page).locator('select[aria-label="Raridade no jogo"]').selectOption('comum')
  await aba(page).locator('th button.ordenar', { hasText: 'Conquista' }).click()
  await page.waitForTimeout(500)
  const h = await page.evaluate(() => location.hash)
  ok(/q=gol/.test(h) && /raridade=comum/.test(h) && /ordem=nome/.test(h), `Conquistas: busca, raridade e ordem no hash (${h})`)
  await page.reload()
  await page.waitForSelector('#tela-painel:not([hidden])', { timeout: 15000 })
  await page.waitForTimeout(2500)
  ok(await aba(page).locator('input[type=search]').inputValue() === 'gol' && await aba(page).locator('select[aria-label="Raridade no jogo"]').inputValue() === 'comum'
    && /Conquista/.test(await aba(page).locator('th[aria-sort="ascending"]').textContent().catch(() => '')), 'Conquistas: recarregar volta com a mesma busca, raridade e ordem')
})
// ═══ 8b. o painel acompanha as correções do servidor (§E.7): "ja_decidida", podeAssumir e "Entra em breve" ════════
await secao('8b. ja_decidida, podeAssumir e Entra em breve', async () => {
  // outra pessoa decide a denúncia com o diálogo "Manter" aberto nesta aba: 409 ja_decidida
  const F = livres[5]
  const j = await jogador('Corr Den 6')
  ok((await denunciar(j, F.hid, 'Teste: já decidida')).status === 200, 'denúncia na carreira F')
  await ir(page, '#/visao', 600)
  await ir(page, '#/denuncias', 1800)
  await page.evaluate(() => document.querySelectorAll('#avisos .aviso-flutuante').forEach((x) => x.remove()))
  await cartao(F.pk).locator('button', { hasText: 'Manter no Hall' }).click()
  await page.waitForSelector('dialog[open]')
  exigirOk(await fechar([F.pk]), 'outra pessoa decide a F')
  await page.locator('dialog[open] button[type=submit]').click()
  await page.waitForTimeout(2000)
  const toasts = await page.locator('#avisos .aviso-flutuante').allTextContents()
  ok(await page.locator('dialog[open]').count() === 0 && toasts.some((t) => /já foi decidida/.test(t) && /A lista foi atualizada/.test(t)),
    'já decidida em outro lugar: o diálogo fecha e o toast diz "já foi decidida… A lista foi atualizada." (' + toasts.join(' | ').replace(/\s+/g, ' ') + ')')
  ok(await aba(page).locator(`article.denuncia[data-id="${F.pk}"] button`, { hasText: 'Manter no Hall' }).count() === 0, '…e a lista refeita não mostra mais a F aberta')

  // podeAssumir: false → sem "Senha provisória", "Zerar PIN" e "Ativar" (o "Papel" continua)
  await page.route(/\/equipe\.php\?r=equipe(&|$)/, async (route) => {
    const resp = await route.fetch()
    const d = await resp.json()
    for (const x of d.itens || []) if (!x.daConfig && !x.eu) { x.podeAssumir = false; x.temPin = true; x.ativo = false }
    await route.fulfill({ response: resp, json: d })
  })
  await ir(page, '#/equipe', 2000)
  const linhas = aba(page).locator('tbody tr', { has: page.locator('button', { hasText: 'Papel' }) })
  const nLinhas = await linhas.count()
  const proibidos = await aba(page).locator('tbody button', { hasText: /^(Senha provisória|Zerar PIN|Ativar)$/ }).count()
  ok(nLinhas >= 1 && proibidos === 0, `Equipe: com podeAssumir = false, nada de "Senha provisória", "Zerar PIN" nem "Ativar" (${nLinhas} linha(s), ${proibidos} botão(ões))`)
  await page.unroute(/\/equipe\.php\?r=equipe(&|$)/)

  // a ficha da conta: o estado entra_na_proxima vira o chip "Entra em breve" (antes: o código cru)
  const S = JSON.parse(readFileSync(`${BASE}/semente.json`, 'utf8'))
  const id = S.contas['Camisa10'].id
  const motivo = 'Entra no Hall público na próxima atualização (por volta das 14:00).'
  await page.route(/\/admin\.php\?r=usuario&/, async (route) => {
    const resp = await route.fetch()
    const d = await resp.json()
    const cs = (d.usuario && d.usuario.carreiras) || d.carreiras || []
    if (cs[0]) cs[0].hall = { estado: 'entra_na_proxima', motivo }
    await route.fulfill({ response: resp, json: d })
  })
  await ir(page, '#/usuarios?conta=' + id, 2200)
  const chip = page.locator('#gaveta .chip', { hasText: 'Entra em breve' })
  ok(await chip.count() >= 1 && await chip.first().getAttribute('title') === motivo && !/entra_na_proxima/.test(await page.textContent('#gaveta')),
    'ficha: "Entra em breve" com a hora no title, nunca "entra_na_proxima" cru')
  await page.unroute(/\/admin\.php\?r=usuario&/)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // Tempo de jogo: o servidor guarda o "tudo" por até 10 min; o subtítulo diz de quando são os números (geradoEm)
  await ir(page, '#/tempo?jan=tudo', 2200)
  const subTempo = (await page.textContent('#sub-aba')).trim()
  ok(/números das \d{2}:\d{2}/.test(subTempo), `Tempo de jogo: o subtítulo diz de quando são os números ("${subTempo}")`)
})
ok(page.erros.length === 0, 'computador: nenhum erro de JavaScript' + (page.erros.length ? ': ' + page.erros.slice(0, 3).join(' | ') : ''))

// ═══ 9. 1024 px: coluna principal fixa na rolagem lateral; rótulos dos números sem reticências ═════════════════
// (a mesma sessão, com a janela de outro tamanho: entrar de novo várias vezes esbarra no limite de tentativas)
await secao('9. 1024 px: coluna principal fixa na rolagem lateral; rótulos d', async () => {
  const p = page
  await p.setViewportSize({ width: 1024, height: 900 })
  await ir(p, '#/visao', 1200)
  for (const [hash, nome] of [['#/usuarios', 'Usuários'], ['#/hall', 'Hall'], ['#/indicacoes', 'Indicações']]) {
    await ir(p, hash, 2000)
    const r = await p.evaluate(() => {
      const rol = document.querySelector('.aba:not([hidden]) .rolagem')
      const td = rol && rol.querySelector('tbody td.principal-celula')
      if (!rol || !td) return null
      const pos = getComputedStyle(td).position
      rol.scrollLeft = 400
      const esq = Math.round(td.getBoundingClientRect().left - rol.getBoundingClientRect().left)
      const sel = rol.querySelector('tbody td.selecao')
      return { pos, esq, larga: rol.scrollWidth > rol.clientWidth, deslocou: rol.scrollLeft > 0, sel: sel ? Math.round(sel.getBoundingClientRect().width) : 0 }
    })
    ok(!!r && r.pos === 'sticky' && (!r.deslocou || r.esq <= (r.sel || 0) + 1), `${nome} em 1024: a coluna principal fica parada ao rolar de lado (${JSON.stringify(r)})`)
  }
  const cortados = await p.evaluate(() => Array.from(document.querySelectorAll('#numeros-acao .numero-acao span')).filter((s) => s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent))
  ok(cortados.length === 0, 'números de ação em 1024: nenhum rótulo cortado' + (cortados.length ? ' (' + cortados.join(', ') + ')' : ''))
  ok(p.erros.length === 0, '1024: nenhum erro de JavaScript' + (p.erros.length ? ': ' + p.erros.slice(0, 3).join(' | ') : ''))
})

// ═══ 10. celular estreito: Configurações → Bônus de OVR sem rolagem lateral ═════════════════════════════════════
await ir(page, '#/visao', 600)
for (const largura of [360, 320]) {
  await page.setViewportSize({ width: largura, height: 760 })
  await ir(page, '#/config', 2200)
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth, document.querySelectorAll('.trio .campo').length])
  ok(w[2] >= 3 && w[0] <= w[1], `Configurações em ${largura} px: o trio "1º/2º/3º amigo" cabe, sem rolagem lateral (${w[0]} ≤ ${w[1]})`)
  await ir(page, '#/visao', 600)
}
ok(page.erros.length === 0, 'celular: nenhum erro de JavaScript' + (page.erros.length ? ': ' + page.erros.slice(0, 3).join(' | ') : ''))
await ctx.close()

await browser.close()
const r = resultado()
console.log(`\ncorreções do painel: ${r.oks} ok, ${r.falhas} falha(s) em ${((performance.now() - t0) / 1000).toFixed(0)} s`)
if (r.falhas) console.log('  ' + r.lista.join('\n  '))
process.exit(r.falhas ? 1 : 0)

function exigirOk(resp, oque) {
  if (resp.status < 200 || resp.status >= 300) throw new Error(`${oque}: ${resp.status} ${resp.txt.slice(0, 200)}`)
  return resp.json
}
