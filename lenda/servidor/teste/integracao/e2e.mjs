// LENDA v3/v3.2 · integração de ponta a ponta: jogo (dist-site) + servidor PHP + MariaDB + painel, com vários
// aparelhos ao mesmo tempo. Pilha: bash subir.sh (porta 8752; antes, npm run build:site). Uso: node e2e.mjs
// v3.2: o painel novo (conta Dono, PIN, sessões, motivo, lote, atenção, lixeira, equipe, backup) e o que o jogo mostra
// disso (Em revisão, Fora do Hall, aviso da moderação, Convide amigos, tester, Abrir no jogo).
// v3.3 (etapas g): e-mail confirmado com o código do cadastro, Fale conosco com e sem conta (e a resposta do painel),
// desafio de teste criado e ativado no painel, uma carreira REAL de fila jogada pela tela que cumpre o critério e vira
// candidata, "Verificar no jogo" que bate, HallEntry adulterada pela API (sem replay: não vira candidata; com replay e
// taças a mais: reprovada pela verificação), limite de partidas por dia, vencedor declarado, perfil público.
// v3.4 (etapas h, e o que mudou nas de antes): os 10 desafios de emblema de fábrica valendo (a faixa da tela inicial, que
// some sem desafio), a carreira-prova (semente do servidor + replay) que sobe sozinha quando prova conquista nova da conta,
// uma carreira REAL de fila (v-otima-01, pico 89) que cumpre dois desafios de emblema fáceis e dá os emblemas sozinha
// (Minha conta, perfil, Hall), HallEntry adulterada (sem replay e com semente que o servidor não sorteou: nem prova nem
// emblema; com replay e taças a mais: ganha na hora e perde na verificação em lote do admin), o link de compartilhar pela
// prévia (api/v.php: Open Graph, PNG 1200×630, leva ao resumo) e o SEO do build (sitemap.xml e a chave do IndexNow).
// As carreiras são jogadas pela tela (ritmo Expresso, sempre a 1ª opção) com sementes fixas: as mesmas sementes
// dão as mesmas carreiras (a 1004 é um goleiro boliviano que passa pelo Cruzeiro; a 1011 e a 1001 passam de 90).
//   C = visitante sem conta · A = Ian (cria conta depois de 5 partidas, joga, salva, convida, compartilha)
//   B = amigo convidado pelo link ?c= · A2 = segundo aparelho do Ian · ADM = painel do admin
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { lancar, aparelho, jogarCarreira, jogarFila, codigoDoEmail, emailsPara, ultimaTerminada, lerKv, sql, esperarSql, admin, ok, resultado, sleep, URL0, ORIGEM, PRINTS, env, BASE } from './lib.mjs'

const T0 = Date.now()
const browser = await lancar()
const aparelhos = []
const novo = async (nome, o) => {
  const a = await aparelho(browser, nome, o)
  aparelhos.push(a)
  return a
}
const print = (page, nome, o) => page.screenshot({ path: `${PRINTS}/${nome}.png`, ...o }).catch(() => {})
const estado = {}
async function etapa(nome, fn) {
  console.log(`\n── ${nome} ── (${Math.round((Date.now() - T0) / 1000)} s)`)
  try {
    await fn()
  } catch (e) {
    ok(false, `${nome}: erro ${String(e?.message ?? e).split('\n')[0]}`)
    for (const a of aparelhos) {
      await print(a.page, `ERRO-${nome.replace(/\W+/g, '_').slice(0, 30)}-${a.nome}`)
      console.log(`      [${a.nome}] ${a.page.url()}`) // onde cada aparelho estava quando a etapa falhou
    }
  }
  writeFileSync(`${BASE}/estado.json`, JSON.stringify(estado, null, 2))
}
const menu = async (page) => {
  await page.getByRole('button', { name: 'Menu' }).click()
  const m = page.getByRole('dialog', { name: 'Menu' })
  await m.waitFor()
  return m
}
const fecharMenu = (page) => page.keyboard.press('Escape')
const idUsuario = (email) => sql(`SELECT id FROM usuarios WHERE email='${email}'`)
const esperarTexto = (page, re, ms = 20000) => page.getByText(re).first().waitFor({ timeout: ms })
const hallApi = async (q = '') => (await fetch(`${URL0}api/hall.php${q}`)).json()
const conquistasDoAparelho = async (page) => Object.keys((await lerKv(page, 'achievements'))?.unlocked ?? {}).sort()
const conquistasDaConta = (uid) => sql(`SELECT conquista_id FROM conquistas_usuario WHERE usuario_id=${uid} ORDER BY conquista_id`).split('\n').filter(Boolean)
/** v3.4: as conquistas PROVADAS da conta (as que têm uma carreira-prova). */
const provadasDaConta = (uid) => new Set(sql(`SELECT conquista_id FROM conquistas_usuario WHERE usuario_id=${uid} AND prova_pk IS NOT NULL`).split('\n').filter(Boolean))
const conquistasDe = (h) => [...new Set(h?.career?.achievements ?? [])].sort()
/**
 * v3.4 (CONTRATO-v34 §B.3): no fim, a carreira sobe sozinha para a conta quando é 90+ ou quando é carreira-prova (Clássico,
 * replay, a semente que o servidor sorteou lembrada no aparelho) com alguma conquista que a conta ainda não tem provada. As
 * sementes são fixas, então o teste sabe o que esperar: sobe sozinha → espera; senão → "Salvar na minha conta".
 * `provadasAntes` = provadasDaConta() antes da carreira; `lembrada` = o aparelho ainda lembra a semente do servidor.
 */
async function fimDaCarreira(page, h, uid, provadasAntes, { lembrada = true } = {}) {
  const novas = conquistasDe(h).filter((x) => !provadasAntes.has(x))
  const auto = h.summary.peakOvr >= 90 || (lembrada && novas.length > 0)
  if (!auto) await page.locator('.ck-end').getByRole('button', { name: 'Salvar na minha conta' }).click()
  await esperarTexto(page, 'Salva na sua conta', 30000)
  const como = await esperarSql(`SELECT como FROM carreiras WHERE carreira_id='${h.id}' AND usuario_id=${uid}`, (x) => x !== '', 20000)
  return { auto, novas, como }
}
/**
 * Preenche o diálogo de conta do jogo. O diálogo põe o foco no 1º campo um quadro depois de aparecer (~30 ms); um robô
 * que digita nesse meio-tempo perde o texto para o campo que ganhou o foco. Espera o foco chegar e confere cada valor.
 * campos: [[rótulo, valor, exato?], ...]
 */
async function preencherConta(page, d, campos) {
  await page.waitForFunction(() => {
    const a = document.activeElement
    return !!a && !!a.closest('[role="dialog"].sc-modal') && (a.tagName === 'INPUT' || a.getAttribute('role') === 'tab' || a.tagName === 'BUTTON')
  }, null, { timeout: 5000 }).catch(() => {})
  await sleep(150)
  for (let i = 0; i < 4; i++) {
    for (const [rotulo, valor, exato] of campos) await d.getByLabel(rotulo, { exact: !!exato }).fill(valor)
    let certo = true
    for (const [rotulo, valor, exato] of campos) if ((await d.getByLabel(rotulo, { exact: !!exato }).inputValue()) !== valor) certo = false
    if (certo) return
    console.log('  ..  o diálogo de conta mexeu no foco no meio do preenchimento; preenchendo de novo')
    await sleep(300)
  }
  throw new Error('o diálogo de conta não guardou o que foi digitado')
}

const EMAIL_A = `ian${Date.now()}@exemplo.com`
const EMAIL_B = `bruno${Date.now()}@exemplo.com`
const SENHA = 'segredo-forte-123'
const SEM = { primeira: [1000, 777], cruzeiro: [1004, 777], fenomeno: [1011, 777], muralha: [1001, 777], amigo: [1002, 777], bonus: [1004, 778] }

// ───────────────────────── a. público ─────────────────────────
const C = await novo('C', { partidas: 0 })
await etapa('a. público (C, sem conta)', async () => {
  const { page } = C
  const pedidosAdmin = []
  page.on('request', (r) => r.url().includes('painel.php') && pedidosAdmin.push(r.url()))
  await page.goto(`${URL0}#/`)
  await page.waitForSelector('.ld-modes', { timeout: 60000 })
  await sleep(2500)
  const imm = page.locator('.ld-mode').nth(1)
  ok((await imm.getAttribute('aria-disabled')) === 'true' && /Em desenvolvimento/.test(await imm.innerText()), 'tela inicial: Modo Imersivo "Em desenvolvimento" (cartão desabilitado)')
  const corpo = await page.evaluate(() => document.body.innerText)
  ok(!/Live interativa|Live do TikTok/i.test(corpo), 'tela inicial: nada de Live')
  ok((await page.locator('a[href*="#/live"], a[href*="#/imersivo"], a[href*="#/kit"]').count()) === 0, 'nenhum link para #/live, #/imersivo ou #/kit')
  await print(page, 'a1-publico-inicio')
  const m = await menu(page)
  const t = await m.innerText()
  ok(!/Live/i.test(t) && !/Painel do admin|Modo Imersivo \(teste\)/.test(t), 'menu: sem Live e sem atalhos do admin')
  await print(page, 'a2-publico-menu')
  await fecharMenu(page)
  await page.goto(`${URL0}#/live`)
  await esperarTexto(page, 'Página não encontrada', 15000)
  ok(true, '#/live: "Página não encontrada"')
  await print(page, 'a3-publico-live-404')
  await page.goto(`${URL0}#/kit`)
  await esperarTexto(page, 'Página não encontrada', 15000)
  ok(true, '#/kit: "Página não encontrada"')
  await page.goto(`${URL0}#/imersivo`)
  await esperarTexto(page, 'Partida a partida,', 15000)
  ok(/em desenvolvimento/i.test(await page.locator('.pt-pill').innerText()), '#/imersivo: tela "Em breve · em desenvolvimento"')
  await print(page, 'a4-publico-imersivo')
  await page.goto(`${URL0}#/hall`)
  await page.locator('.hl-filtros').waitFor({ timeout: 20000 })
  ok(true, 'Hall das Lendas abre (com os filtros de país e clube)')
  await page.goto(`${URL0}#/`)
  await page.waitForSelector('.ld-modes')
  // o código do jogo público não carrega nada de Live/Imersivo de teste para quem não é admin
  ok(pedidosAdmin.length <= 6, `painel.php?so=eu só nas rotas fechadas (${pedidosAdmin.length} pedidos)`)
  const htmlPainel = await (await fetch(`${URL0}api/admin.php?r=resumo`)).status
  ok(htmlPainel === 401, `admin.php sem admin: 401 (${htmlPainel})`)
})

// ───────────────────────── b. A: 5 partidas → conta → carreiras salvas ─────────────────────────
const A = await novo('A', { partidas: 4, share: true })
await etapa('b1. A joga a 5ª partida e cria a conta pelo convite', async () => {
  const { page } = A
  await page.goto(URL0)
  await page.waitForSelector('.ld-modes', { timeout: 60000 })
  const r = await jogarCarreira(page, { semente: SEM.primeira, nacao: 'Bolívia', sobrenome: 'PRIMEIRO' })
  ok(r.fim, `A: 1ª carreira jogada pela tela até o fim (${Math.round(r.ms / 1000)} s)`)
  const d = page.locator('[role="dialog"].sc-modal')
  await d.waitFor({ timeout: 30000 })
  ok((await page.evaluate(() => localStorage.getItem('lenda:partidas'))) === '5', 'contador do aparelho: 5 partidas')
  ok((await d.getByRole('tab', { name: 'Criar conta' }).getAttribute('aria-selected')) === 'true', 'depois da 5ª partida o convite de conta abre em "Criar conta"')
  await print(page, 'b1-A-convite-conta')
  await preencherConta(page, d, [['Apelido', 'Ian Cruzeiro'], ['E-mail', EMAIL_A], ['Senha', SENHA, true]])
  await d.getByRole('checkbox').first().check()
  const t0email = Date.now() - 2000
  await d.getByRole('button', { name: 'Criar conta', exact: true }).click()
  // v3.3: conta nova → "Confirme seu e-mail" com o código de 6 dígitos que o servidor mandou (lido do arquivo do teste)
  const dv = page.locator('[role="dialog"].sc-modal', { hasText: 'Confirme seu e-mail' })
  await dv.waitFor({ timeout: 20000 })
  estado.idA = idUsuario(EMAIL_A)
  ok(sql(`SELECT IFNULL(email_verificado_em, 'nulo') FROM usuarios WHERE id=${estado.idA}`) === 'nulo', 'v3.3: depois do cadastro abre "Confirme seu e-mail" e a conta começa sem o e-mail confirmado')
  const codigoA = await codigoDoEmail(EMAIL_A, t0email)
  ok(/^\d{6}$/.test(codigoA ?? '') && sql(`SELECT COUNT(*) FROM email_log WHERE tipo = 'verificacao'`) === '1', `v3.3: o cadastro mandou o código pelo enviarEmail (arquivo do teste e email_log tipo verificacao) (${codigoA})`)
  await print(page, 'g0-A-confirme-seu-email')
  const errosAntesCodigo = A.erros.length
  await dv.getByLabel('Código de 6 dígitos').fill(codigoA === '000000' ? '111111' : '000000')
  await dv.getByRole('button', { name: 'Confirmar e-mail' }).click()
  await dv.locator('.sc-err').waitFor({ timeout: 10000 })
  ok(/código/i.test(await dv.locator('.sc-err').innerText()), `v3.3: código errado → erro em pt-BR ("${(await dv.locator('.sc-err').innerText()).trim()}")`)
  A.erros.splice(errosAntesCodigo, A.erros.length - errosAntesCodigo, ...A.erros.slice(errosAntesCodigo).filter((x) => !/status of 400/.test(x)))
  await dv.getByLabel('Código de 6 dígitos').fill(codigoA ?? '')
  await dv.getByRole('button', { name: 'Confirmar e-mail' }).click()
  await page.getByText('E-mail confirmado', { exact: true }).first().waitFor({ timeout: 15000 })
  ok(sql(`SELECT email_verificado_em IS NOT NULL FROM usuarios WHERE id=${estado.idA}`) === '1', 'v3.3: código certo → e-mail confirmado no banco (email_verificado_em)')
  ok((await page.evaluate(async () => (await (await fetch('api/conta.php', { credentials: 'same-origin' })).json()).usuario?.emailVerificado)) === true, 'v3.3: conta.php → U.emailVerificado = true')
  await page.waitForFunction(() => !document.querySelector('[role="dialog"].sc-modal'), null, { timeout: 20000 })
  ok(/^\d+$/.test(estado.idA), `conta do A criada (id ${estado.idA})`)
  ok(sql(`SELECT partidas FROM usuarios WHERE id=${estado.idA}`) === '5', 'servidor: partidas do aparelho = 5')
  ok(sql(`SELECT partidas_conta FROM usuarios WHERE id=${estado.idA}`) === '0', 'servidor: 0 partidas com a conta (a do cadastro foi antes)')
  // conquistas da 1ª carreira sobem no cadastro (sincronizar)
  const doAparelho = await conquistasDoAparelho(page)
  const v = await esperarSql(`SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id=${estado.idA}`, (x) => Number(x) >= doAparelho.length && doAparelho.length > 0)
  ok(doAparelho.length > 0 && JSON.stringify(conquistasDaConta(estado.idA)) === JSON.stringify(doAparelho), `conquistas do aparelho subiram no cadastro (${v} de ${doAparelho.length})`)
  ok(sql(`SELECT COUNT(*) FROM carreiras WHERE usuario_id=${estado.idA}`) === '0', 'carreira de pico < 90 não sobe sozinha')
})

await etapa('b2. A: Convide amigos (link com código, faltam 3 partidas)', async () => {
  const { page } = A
  await page.goto(`${URL0}#/`)
  await page.waitForSelector('.ld-modes')
  const m = await menu(page)
  await m.getByText('Minha conta').click()
  const mc = page.getByRole('dialog', { name: 'Minha conta' })
  await mc.locator('.sc-conv').waitFor({ timeout: 15000 })
  await sleep(800)
  estado.linkA = await mc.locator('.sc-conv input').inputValue()
  estado.codigoA = sql(`SELECT codigo_convite FROM usuarios WHERE id=${estado.idA}`)
  const conv = await mc.locator('.sc-conv').innerText()
  ok(estado.linkA.endsWith(`?c=${estado.codigoA}`), `link de convite com o código (${estado.linkA})`)
  ok(/0\/3/.test(conv) && /faltam 3 partidas/.test(conv), 'Convide amigos: 0/3 e "faltam 3 partidas"')
  await mc.locator('.sc-conv').screenshot({ path: `${PRINTS}/b2-A-convide-amigos.png` })
  await page.keyboard.press('Escape')
})

await etapa('b3. A joga (Bolívia, passa pelo Cruzeiro) e salva pelo botão', async () => {
  const { page } = A
  // v3.4 (CONTRATO-v34 §B.9 #3): o aparelho que perdeu a lembrança da semente do servidor não manda sozinho a carreira-prova
  // (pico < 90): o botão de salvar continua, e quem decide se ela prova é o servidor (a semente foi sorteada por ele)
  const r = await jogarCarreira(page, {
    semente: SEM.cruzeiro,
    nacao: 'Bolívia',
    sobrenome: 'DANTAS',
    aoComecar: (p) => p.evaluate(() => localStorage.removeItem('lenda:sementes-servidor')),
  })
  ok(r.fim, `A: carreira DANTAS até o fim (${Math.round(r.ms / 1000)} s)`)
  await sleep(1500)
  const h = await ultimaTerminada(page)
  estado.idDantas = h.id
  ok(h.identity.nationality === 'BOL' && (h.summary.clubs ?? []).some((c) => c.clubId === 'e2022'), `DANTAS é boliviano e passou pelo Cruzeiro (${(h.summary.clubs ?? []).map((c) => c.clubId).join(',')})`)
  ok(h.summary.peakOvr < 90, `pico ${h.summary.peakOvr} (< 90: não salva sozinha)`)
  ok(sql(`SELECT COUNT(*) FROM carreiras WHERE carreira_id='${h.id}'`) === '0', 'v3.4: sem a lembrança da semente no aparelho, a carreira-prova não subiu sozinha')
  await page.locator('.ck-end').getByRole('button', { name: 'Salvar na minha conta' }).click()
  await esperarTexto(page, 'Salva na sua conta')
  await print(page, 'b3-A-salvar-botao')
  const linha = sql(`SELECT CONCAT_WS('|', como, nota_v, pais, clubes LIKE '%e2022%', suspeita IS NULL) FROM carreiras WHERE carreira_id='${h.id}'`)
  ok(linha === 'manual|2|BOL|1|1', `servidor: manual, nota v2, BOL, Cruzeiro, sem suspeita (${linha})`)
  const pc = await esperarSql(`SELECT partidas_conta FROM usuarios WHERE id=${estado.idA}`, (x) => x === '1')
  ok(pc === '1', `servidor: 1 partida com a conta (${pc})`)
  // v3.4: o servidor guardou a lista de conquistas da carreira (a do HallEntry) e ela prova as conquistas na conta
  const pk = sql(`SELECT id FROM carreiras WHERE carreira_id='${h.id}'`)
  const ach = conquistasDe(h)
  const lista = JSON.parse(sql(`SELECT IFNULL(conquistas, 'null') FROM carreiras WHERE id=${pk}`))
  ok(Array.isArray(lista) && JSON.stringify([...lista].sort()) === JSON.stringify(ach) && sql(`SELECT CONCAT_WS('|', conquistas_v, IFNULL(prova_ok, '-')) FROM carreiras WHERE id=${pk}`) === '2|-',
    `v3.4: a lista de conquistas guardada no servidor é a do HallEntry (${ach.length}), conquistas_v = 2, ainda não verificada`)
  const provadas = Number(sql(`SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id=${estado.idA} AND prova_pk=${pk}`))
  ok(ach.length > 0 && provadas === ach.length, `v3.4: salva pelo botão, a carreira prova as ${ach.length} conquistas dela na conta (${provadas} com prova_pk = ela)`)
})

// ───────────────────────── c. B pelo convite ─────────────────────────
const B = await novo('B', { partidas: 0, viewport: { width: 1280, height: 860 } })
await etapa('c1. B abre o link ?c= e cria a conta', async () => {
  const { page } = B
  await page.goto(estado.linkA.replace('https://oprojeto.online/lenda/', URL0))
  await page.waitForSelector('.ld-modes', { timeout: 60000 })
  await sleep(2000)
  ok((await page.evaluate(() => JSON.parse(localStorage.getItem('lenda:convite') || 'null')?.codigo)) === estado.codigoA, 'convite guardado no aparelho do B')
  ok(!(await page.evaluate(() => location.search)).includes('c='), 'o ?c= sai da barra de endereço')
  const m = await menu(page)
  await m.getByText('Entrar / Criar conta').click()
  const d = page.locator('[role="dialog"].sc-modal')
  await d.waitFor()
  await d.getByRole('tab', { name: 'Criar conta' }).click()
  ok((await d.innerText()).includes('convite de um amigo'), 'cadastro mostra o convite do amigo')
  await preencherConta(page, d, [['Apelido', 'Bruno Amigo'], ['E-mail', EMAIL_B], ['Senha', SENHA, true]])
  await d.getByRole('checkbox').first().check()
  await print(page, 'c1-B-cadastro-convite')
  await d.getByRole('button', { name: 'Criar conta', exact: true }).click()
  // v3.3: o B deixa a confirmação do e-mail para depois (confirma na etapa g, pela faixa de Minha conta)
  const dv = page.locator('[role="dialog"].sc-modal', { hasText: 'Confirme seu e-mail' })
  await dv.waitFor({ timeout: 20000 })
  await dv.getByRole('button', { name: 'Depois', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[role="dialog"].sc-modal'), null, { timeout: 20000 })
  estado.idB = idUsuario(EMAIL_B)
  ok(sql(`SELECT IFNULL(email_verificado_em, 'nulo') FROM usuarios WHERE id=${estado.idB}`) === 'nulo' && (await codigoDoEmail(EMAIL_B)) !== null, 'v3.3: B fecha o "Confirme seu e-mail" com "Depois" (o código já foi para o e-mail; a conta segue sem confirmar)')
  ok(sql(`SELECT status FROM indicacoes WHERE indicado_id=${estado.idB} AND indicador_id=${estado.idA}`) === 'pendente', 'indicação A → B pendente')
})

await etapa('c2. B termina 1 partida e joga 3 min → indicação válida; bônus do A guardado', async () => {
  const { page } = B
  const provB0 = provadasDaConta(estado.idB)
  const r = await jogarCarreira(page, { semente: SEM.amigo, nacao: 'Brasil', sobrenome: 'AMIGAO' })
  ok(r.fim, `B: carreira até o fim (${Math.round(r.ms / 1000)} s)`)
  // a partida conta para a conta do B: o início chegou ao servidor pelo menos 20 s antes do fim, no mesmo aparelho
  const pcB = await esperarSql(`SELECT partidas_conta FROM usuarios WHERE id=${estado.idB}`, (x) => x === '1')
  ok(pcB === '1', `servidor: a partida do B conta (início e fim do mesmo aparelho, ${pcB})`)
  const ativoB = () => Number(sql(`SELECT COALESCE(SUM(ativo_s), 0) FROM visitas WHERE usuario_id=${estado.idB}`))
  const st0 = sql(`SELECT status FROM indicacoes WHERE indicado_id=${estado.idB}`)
  const a0 = ativoB()
  ok(a0 >= 180 ? st0 === 'valida' : st0 === 'pendente', `com ${a0} s de jogo no site: indicação ${st0} (vale a partir de 3 min)`)
  // o B continua com o jogo aberto: a cada minuto a mais de jogo (batimentos de 15 s) o servidor confere de novo
  const st = await esperarSql(`SELECT status FROM indicacoes WHERE indicado_id=${estado.idB}`, (x) => x === 'valida', 240000)
  ok(st === 'valida', `indicação válida depois da 1ª partida e de 3 min de jogo do B (${st}, ${ativoB()} s)`)
  await sleep(1000)
  const h = await ultimaTerminada(page)
  estado.idAmigao = h.id
  // v3.4: a 1ª carreira do B com a conta é carreira-prova (semente do servidor) e prova conquistas que a conta não tem: sobe
  // sozinha ("auto"); sem conquista nova, o botão
  const fimB = await fimDaCarreira(page, h, estado.idB, provB0)
  ok(fimB.como === (fimB.auto ? 'auto' : 'manual'), `B: ${fimB.auto ? `a carreira-prova subiu sozinha (${fimB.novas.length} conquistas novas na conta)` : 'salvou pelo botão (nenhuma conquista nova para provar)'} (${fimB.como})`)
  ok(fimB.novas.every((x) => provadasDaConta(estado.idB).has(x)), `v3.4: as ${fimB.novas.length} conquistas da carreira ficaram provadas na conta do B`)
  const bon = sql(`SELECT CONCAT_WS('|', valor, origem, usado_em IS NULL) FROM bonus WHERE usuario_id=${estado.idA}`)
  ok(bon === '2|indicacao|1', `bônus +2 de indicação criado para o A (${bon})`)
  // A ainda tem 1 partida com a conta: o bônus fica guardado
  const { page: pa } = A
  const g = await pa.evaluate(async () => (await fetch('api/bonus.php', { credentials: 'same-origin' })).json())
  ok(g.liberado === false && g.faltamPartidas === 2 && g.disponiveis.length === 0 && g.guardados.length === 1 && g.guardados[0].valor === 2, `bonus.php do A: guardado +2, faltam 2 (${JSON.stringify({ l: g.liberado, f: g.faltamPartidas, d: g.disponiveis.length, g: g.guardados.length })})`)
  await pa.goto(`${URL0}#/identidade?ritmo=expressa`)
  await pa.waitForSelector('#id-surname', { timeout: 30000 })
  await sleep(2500)
  ok((await pa.locator('.id-bonus').count()) === 0, 'criação da carreira do A: sem bônus antes de 3 partidas com a conta')
})

await etapa('b4. A joga (pico 90+) → salva sozinha; compartilhar ainda bloqueado', async () => {
  const { page } = A
  const r = await jogarCarreira(page, { semente: SEM.fenomeno, nacao: 'Bolívia', sobrenome: 'FENOMENO' })
  ok(r.fim, `A: carreira FENOMENO até o fim (${Math.round(r.ms / 1000)} s)`)
  await esperarTexto(page, 'Salva na sua conta', 30000)
  await sleep(800)
  const h = await ultimaTerminada(page)
  estado.idFenomeno = h.id
  ok(h.summary.peakOvr >= 90, `pico ${h.summary.peakOvr}`)
  ok(sql(`SELECT como FROM carreiras WHERE carreira_id='${h.id}'`) === 'auto', 'servidor: salva sozinha como "auto"')
  await print(page, 'b4-A-salva-sozinha')
  ok((await esperarSql(`SELECT partidas_conta FROM usuarios WHERE id=${estado.idA}`, (x) => x === '2')) === '2', 'servidor: 2 partidas com a conta')
  // compartilhar o card antes de liberar: não dá bônus
  await page.goto(`${URL0}#/resumo?id=${h.id}`)
  await page.waitForSelector('#sm-share', { timeout: 20000 })
  await page.locator('#sm-share').scrollIntoViewIfNeeded()
  await sleep(1200)
  await page.locator('.sm-share__primary').click()
  await esperarTexto(page, 'Bônus de compartilhar ainda bloqueado')
  ok(true, 'compartilhar antes de 3 partidas: "ainda bloqueado"')
  // v3.4: com a conta, o link é o da prévia (api/v.php: o cartão da carreira nas redes), com o código de convite — §E.9: só
  // quando a carreira já está no Hall público (o v.php só conhece a fotografia); a que acabou de entrar na conta leva o convite
  const textoComp = await page.evaluate(() => window.__textoCompartilhado)
  const noHallB4 = (await fetch(`${URL0}api/hall.php?id=${encodeURIComponent(h.id)}`)).status === 200
  ok(noHallB4 ? textoComp.includes(`api/v.php?id=${h.id}&c=${estado.codigoA}`) : !textoComp.includes('api/v.php') && textoComp.includes(`?c=${estado.codigoA}`),
    `o texto compartilhado leva ${noHallB4 ? 'o link da prévia com a carreira' : 'o link de convite (a carreira ainda não está no Hall público, §E.9)'} e o código de convite (${textoComp.slice(-90)})`)
  ok(sql(`SELECT COUNT(*) FROM bonus WHERE usuario_id=${estado.idA} AND origem='compartilhar'`) === '0', 'servidor: nenhum bônus de compartilhar')
  await print(page, 'b4-A-compartilhar-bloqueado')
})

await etapa('b5. A joga a 3ª partida com a conta → bônus liberado; compartilhar dá +2 (1x por dia)', async () => {
  const { page } = A
  const r = await jogarCarreira(page, { semente: SEM.muralha, nacao: 'Bolívia', sobrenome: 'MURALHA' })
  ok(r.fim, `A: carreira MURALHA até o fim (${Math.round(r.ms / 1000)} s)`)
  await esperarTexto(page, 'Salva na sua conta', 30000)
  await sleep(800)
  const h = await ultimaTerminada(page)
  estado.idMuralha = h.id
  ok(h.summary.peakOvr >= 90 && sql(`SELECT como FROM carreiras WHERE carreira_id='${h.id}'`) === 'auto', `MURALHA (pico ${h.summary.peakOvr}) salva sozinha`)
  ok((await esperarSql(`SELECT partidas_conta FROM usuarios WHERE id=${estado.idA}`, (x) => x === '3')) === '3', 'servidor: 3 partidas com a conta')
  const g = await page.evaluate(async () => (await fetch('api/bonus.php', { credentials: 'same-origin' })).json())
  ok(g.liberado === true && g.disponiveis.length === 1 && g.disponiveis[0].valor === 2 && g.disponiveis[0].origem === 'indicacao' && g.compartilharHoje === true, `bonus.php: liberado, +2 de indicação disponível (${JSON.stringify(g.disponiveis)})`)
  await page.goto(`${URL0}#/resumo?id=${h.id}`)
  await page.waitForSelector('#sm-share', { timeout: 20000 })
  await page.locator('#sm-share').scrollIntoViewIfNeeded()
  await sleep(1200)
  await page.locator('.sm-share__primary').click()
  await esperarTexto(page, '+2 de OVR na próxima carreira!')
  ok(sql(`SELECT CONCAT_WS('|', valor, ref LIKE 'dia:%') FROM bonus WHERE usuario_id=${estado.idA} AND origem='compartilhar'`) === '2|1', 'compartilhar: +2 de OVR (bônus do dia)')
  await print(page, 'b5-A-compartilhar-ganhou')
  await sleep(1500)
  await page.locator('.sm-share__primary').click()
  await esperarTexto(page, 'O bônus de hoje já é seu')
  ok(sql(`SELECT COUNT(*) FROM bonus WHERE usuario_id=${estado.idA} AND origem='compartilhar'`) === '1', 'compartilhar de novo no mesmo dia: não dá outro')
  await print(page, 'b5-A-compartilhar-ja-hoje')
})

await etapa('b6. A começa uma carreira com +2 de OVR (indicação)', async () => {
  const { page } = A
  let antes = {}
  const provA0 = provadasDaConta(estado.idA)
  const r = await jogarCarreira(page, {
    semente: SEM.bonus,
    nacao: 'Bolívia',
    sobrenome: 'BONIFICADO',
    antesDeConfirmar: async (p) => {
      await p.locator('.id-bonus').waitFor({ timeout: 15000 })
      antes.texto = await p.locator('.id-bonus').innerText()
      antes.ligado = await p.locator('.id-bonus [role="switch"]').getAttribute('aria-checked')
      antes.ovr = await p.locator('.id-jersey__ovr').innerText()
      await print(p, 'b6-A-identidade-bonus')
    },
    aoComecar: async (p) => {
      await esperarTexto(p, '+2 de OVR nesta carreira!', 15000)
      const c = await lerKv(p, 'career:current')
      antes.atual = { ovr: c?.ovr, bonusOvr: c?.bonusOvr, id: c?.id }
      await print(p, 'b6-A-carreira-com-bonus')
    },
  })
  ok(/Bônus de OVR: \+2/.test(antes.texto) && /indicação/.test(antes.texto), `criação: "${antes.texto?.replace(/\s+/g, ' ').slice(0, 60)}"`)
  ok(antes.ligado === 'true', 'usar o bônus: ligado por padrão')
  ok(antes.ovr?.includes('52'), `OVR inicial mostrado: ${antes.ovr}`)
  ok(antes.atual.ovr === 52 && antes.atual.bonusOvr === 2, `carreira começa com OVR ${antes.atual.ovr} (50 + 2) e bonusOvr ${antes.atual.bonusOvr}`)
  ok(sql(`SELECT CONCAT_WS('|', valor, origem, carreira_id) FROM bonus WHERE usuario_id=${estado.idA} AND usado_em IS NOT NULL`) === `2|indicacao|${antes.atual.id}`, 'servidor: o +2 da indicação foi usado nesta carreira')
  ok(r.fim, `A: carreira BONIFICADO até o fim (${Math.round(r.ms / 1000)} s)`)
  await sleep(1500)
  const h = await ultimaTerminada(page)
  estado.idBonificado = h.id
  const sem = (await lerKv(page, 'hall')).find((x) => x.id === estado.idDantas)
  const s0 = h.career.seasons[0]
  const z0 = sem.career.seasons[0]
  ok(s0.ovrStart === z0.ovrStart + 2 && s0.ovrEnd === z0.ovrEnd + 2, `1ª temporada: OVR ${s0.ovrStart}→${s0.ovrEnd} com bônus × ${z0.ovrStart}→${z0.ovrEnd} sem (mesmo mundo e mesmas escolhas)`)
  ok(h.career.bonusOvr === 2 && h.summary.peakOvr >= 40, `HallEntry com career.bonusOvr = ${h.career.bonusOvr}`)
  // v3.4: 90+, ou carreira-prova com conquista nova para a conta → sobe sozinha; senão, o botão
  const fimA = await fimDaCarreira(page, h, estado.idA, provA0)
  ok(fimA.como === (fimA.auto ? 'auto' : 'manual'), `BONIFICADO: ${fimA.auto ? `subiu sozinha (pico ${h.summary.peakOvr}, ${fimA.novas.length} conquistas novas para provar)` : 'salva pelo botão'} (${fimA.como})`)
  const linha = await esperarSql(`SELECT CONCAT_WS('|', bonus_ovr, IFNULL(suspeita,'-')) FROM carreiras WHERE carreira_id='${h.id}'`, (x) => x !== '')
  ok(linha === '2|-', `servidor: carreira com bônus salva e não suspeita (${linha})`)
  await page.goto(`${URL0}#/resumo?id=${h.id}`)
  await page.locator('.sm-chip--bonus').waitFor({ timeout: 15000 })
  ok(/\+2/.test(await page.locator('.sm-chip--bonus').innerText()), 'resumo: "+2 de bônus"')
  await print(page, 'b6-A-resumo-bonus')
})

await etapa('b7. conquistas do A na conta = as do aparelho', async () => {
  const { page } = A
  await sleep(4500) // a fila junta por 3 s
  const ap = await conquistasDoAparelho(page)
  const v = await esperarSql(`SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id=${estado.idA}`, (x) => Number(x) >= ap.length)
  const conta = conquistasDaConta(estado.idA)
  ok(ap.length > 0 && JSON.stringify(conta) === JSON.stringify(ap), `conquistas: ${ap.length} no aparelho, ${v} na conta (iguais)`)
  estado.conquistasA = conta
})

// ───────────────────────── b8. segundo aparelho do A ─────────────────────────
const A2 = await novo('A2', { partidas: 0, viewport: { width: 390, height: 844 }, celular: true })
await etapa('b8. A entra num segundo aparelho: mesmas carreiras e conquistas', async () => {
  const { page } = A2
  await page.goto(URL0)
  await page.waitForSelector('.ld-modes', { timeout: 60000 })
  const m = await menu(page)
  await m.getByText('Entrar / Criar conta').click()
  const d = page.locator('[role="dialog"].sc-modal')
  await d.waitFor()
  await preencherConta(page, d, [['E-mail', EMAIL_A], ['Senha', SENHA, true]])
  await d.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[role="dialog"].sc-modal'), null, { timeout: 20000 })
  await sleep(3000)
  const m2 = await menu(page)
  await m2.getByText('Minhas carreiras').click()
  const dlg = page.getByRole('dialog', { name: 'Minhas carreiras' })
  await dlg.waitFor()
  await dlg.locator('.sc-card').first().waitFor({ timeout: 15000 })
  const nomes = (await dlg.locator('.sc-card').allInnerTexts()).join(' ')
  const naConta = Number(sql(`SELECT COUNT(*) FROM carreiras WHERE usuario_id=${estado.idA}`))
  ok((await dlg.locator('.sc-card').count()) === naConta && ['DANTAS', 'FENOMENO', 'MURALHA', 'BONIFICADO'].every((n) => nomes.includes(n)), `Minhas carreiras no 2º aparelho: as ${naConta} da conta`)
  await print(page, 'b8-A2-minhas-carreiras')
  await page.keyboard.press('Escape')
  const ap2 = await conquistasDoAparelho(page)
  ok(JSON.stringify(ap2) === JSON.stringify(estado.conquistasA), `conquistas desceram para o 2º aparelho (${ap2.length})`)
  await page.goto(`${URL0}#/?conquistas=1`)
  const ach = page.getByRole('dialog', { name: /Conquistas da carreira/ })
  await ach.waitFor({ timeout: 15000 })
  await sleep(1500)
  ok((await ach.innerText()).includes('salvas na sua conta'), 'tela de conquistas: "salvas na sua conta"')
  await print(page, 'b8-A2-conquistas')
  await page.keyboard.press('Escape')
  // abrir uma carreira da conta (que não está neste aparelho) mostra o resumo completo
  await page.goto(`${URL0}#/resumo?id=${estado.idDantas}`)
  await page.getByText('DANTAS').first().waitFor({ timeout: 20000 })
  await page.waitForSelector('#sm-share', { timeout: 20000 })
  ok(true, '2º aparelho: o resumo da DANTAS abre pela conta')
})

// ───────────────────────── d. Hall público ─────────────────────────
await etapa('d1. A escolhe o que vai para o Hall público', async () => {
  const { page } = A
  await page.goto(`${URL0}#/`)
  await page.waitForSelector('.ld-modes')
  const m = await menu(page)
  await m.getByText('Minhas carreiras').click()
  const dlg = page.getByRole('dialog', { name: 'Minhas carreiras' })
  await dlg.waitFor()
  await dlg.getByRole('tab', { name: /Na conta/ }).click()
  await dlg.locator('.sc-hp').waitFor({ timeout: 15000 })
  ok(/3\/3/.test(await dlg.locator('.sc-hp').innerText()), 'automático: 3/3 no Hall (as 3 de maior nota)')
  await print(page, 'd1-A-hall-auto')
  const card = (n) => dlg.locator('.sc-card', { hasText: n })
  const dentro = async (n) => (await card(n).getByText('No Hall público').count()) > 0
  estado.autoA = []
  for (const n of ['DANTAS', 'FENOMENO', 'MURALHA', 'BONIFICADO']) if (await dentro(n)) estado.autoA.push(n)
  ok(estado.autoA.length === 3, `automático: ${estado.autoA.join(', ')}`)
  // "Eu escolho": o servidor mantém as 3 que estavam no Hall
  await dlg.getByRole('radio', { name: 'Eu escolho' }).click()
  await esperarTexto(page, 'Você escolhe quais vão para o Hall')
  await sleep(1200)
  ok(/3\/3/.test(await dlg.locator('.sc-hp').innerText()), '"Eu escolho": continua com as 3 que estavam no Hall')
  // troca: tira a FENOMENO e põe a que estava fora (as sementes são fixas: a DANTAS já está entre as 3)
  const fora = ['DANTAS', 'FENOMENO', 'MURALHA', 'BONIFICADO'].find((n) => !estado.autoA.includes(n))
  await card('FENOMENO').getByRole('button', { name: 'Tirar do Hall' }).click()
  await esperarTexto(page, 'FENOMENO saiu do Hall público')
  await sleep(800)
  const pôr = fora
  if (!(await dentro(pôr))) {
    await card(pôr).getByRole('button', { name: 'Pôr no Hall' }).click()
    await esperarTexto(page, `${pôr} vai para o Hall público`)
    await sleep(800)
  }
  ok(!(await dentro('FENOMENO')) && (await dentro(pôr)), `troca no "Eu escolho": FENOMENO saiu, ${pôr} entrou`)
  // a 4ª: o jogo avisa antes de pedir, e o servidor recusa com 409 limite_hall
  await card('FENOMENO').getByRole('button', { name: 'Pôr no Hall' }).click()
  await esperarTexto(page, 'Até 3 carreiras no Hall público')
  const errosAntes = A.erros.length
  const r409 = await page.evaluate(async (id) => {
    const r = await fetch('api/carreiras.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ acao: 'publicar', id, sim: true }) })
    return `${r.status}:${(await r.json()).erro}`
  }, estado.idFenomeno)
  ok(r409 === '409:limite_hall', `4ª carreira no Hall: aviso no jogo e 409 limite_hall no servidor (${r409})`)
  // o 409 desse pedido feito pelo teste é o esperado (o navegador registra no console)
  A.erros.splice(errosAntes, A.erros.length - errosAntes, ...A.erros.slice(errosAntes).filter((x) => !/status of 409/.test(x)))
  estado.foraDoHallA = 'FENOMENO'
  ok(await dentro('DANTAS'), 'DANTAS (Bolívia · Cruzeiro) marcada "No Hall público"')
  ok(Number(sql(`SELECT COUNT(*) FROM carreiras WHERE usuario_id=${estado.idA} AND publica=1`)) <= 3, 'no máximo 3 carreiras do A no Hall')
  await print(page, 'd1-A-hall-eu-escolho')
  await page.keyboard.press('Escape')
})

// ───────────────────────── painel do admin (v3.2) ─────────────────────────
// O painel novo: entrada com a senha de sempre (cria a conta "Dono"), PIN, ficha lateral, motivo obrigatório, lote,
// "Precisa de atenção", lixeira, equipe. Os aparelhos do painel aceitam os confirm() e anotam violações de CSP.
const PIN_DONO = '482916'
const PIN_MOD = '613704'
const SENHA_MOD = 'moderadora-senha-nova-2026'
const RE_4XX = /Failed to load resource: the server responded with a status of 4\d\d/
async function novoPainel(nome, o = {}) {
  const a = await novo(nome, { partidas: 0, viewport: o.viewport ?? { width: 1440, height: 900 }, celular: o.celular, ignorarConsole: RE_4XX })
  await a.ctx.addInitScript(() => {
    window.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI))
  })
  a.confirmar = true
  a.page.on('dialog', (d) => (a.confirmar ? d.accept() : d.dismiss()))
  return a
}
const ADM = await novoPainel('ADM')
const painel = ADM.page
const PAINEL = `${URL0}painel/`
const dialogo = (p = painel) => p.locator('dialog[open]').last()
const confirmar = (p = painel) => dialogo(p).locator('button[type="submit"]').click()
const abaP = (p = painel) => p.locator('.aba:not([hidden])')
async function avisoPainel(re, ms = 12000, p = painel) {
  try {
    await p.waitForFunction((src) => [...document.querySelectorAll('#avisos .aviso-flutuante')].some((a) => new RegExp(src, 'i').test(a.textContent)), re.source, { timeout: ms })
    return true
  } catch {
    return false
  }
}
const limparAvisos = (p = painel) => p.evaluate(() => document.querySelectorAll('#avisos .aviso-flutuante').forEach((a) => a.remove()))
const irP = async (hash, ms = 1500, p = painel) => {
  await p.evaluate((x) => {
    location.hash = x
  }, hash)
  await sleep(ms)
}
async function digitarPin(p, raiz, pin) {
  await p.locator(`${raiz} .pin-caixa`).first().click()
  await p.keyboard.type(pin, { delay: 30 })
}
/** Entra no painel: e-mail (vazio = senha do arquivo), senha e, se o painel pedir, o PIN. */
async function entrarPainel(p, { email = '', senha = env.PAINEL_SENHA, pin = null } = {}) {
  await p.goto(PAINEL)
  await p.waitForSelector('#form-entrar:not([hidden]), #tela-painel:not([hidden])', { timeout: 20000 })
  if (await p.isVisible('#tela-painel')) return
  if (email) await p.fill('#email', email)
  await p.fill('#senha', senha)
  await p.click('#botao-entrar')
  await p.waitForSelector('#form-pin:not([hidden]), #tela-painel:not([hidden]), #form-trocar-senha:not([hidden]), #form-criar-pin:not([hidden])', { timeout: 15000 })
  if (pin && (await p.isVisible('#form-pin'))) {
    await digitarPin(p, '#pin-caixas', pin)
    await p.waitForSelector('#tela-painel:not([hidden])', { timeout: 15000 })
  }
}
const naFicha = (p, texto) => p.locator('#gaveta button', { hasText: texto })
const semRolagem = async (p) => p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
const AMOSTRA = (() => {
  const j = JSON.parse(readFileSync(new URL('../amostras/v-intenso-01.json', import.meta.url), 'utf8'))
  return j?.hall?.[0] ?? j
})()
/** Uma carreira de nota alta (o HallEntry real v-intenso-01, nota 93) salva pela conta logada no aparelho. */
const salvarNotaAlta = (page, id, sobrenome) =>
  page.evaluate(
    async ({ h, id, sobrenome }) => {
      h.id = id
      h.career.id = id
      h.summary.e2e = id // cada uma com o seu resumo (o mesmo resumo em outra conta é "cópia")
      h.identity.surname = sobrenome
      if (h.career.identity) h.career.identity.surname = sobrenome
      h.legacy = { ...(h.legacy ?? {}), score: 93, raw: 93, v: 2 }
      const r = await fetch('api/carreiras.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ acao: 'salvar', carreira: h, como: 'manual' }) })
      return { status: r.status, json: await r.json().catch(() => null) }
    },
    { h: structuredClone(AMOSTRA), id, sobrenome },
  )
const minhasCarreiras = async (page) => {
  await page.goto(`${URL0}#/`)
  await page.waitForSelector('.ld-modes', { timeout: 30000 })
  const m = await menu(page)
  await m.getByText('Minhas carreiras').click()
  const dlg = page.getByRole('dialog', { name: 'Minhas carreiras' })
  await dlg.waitFor()
  await dlg.getByRole('tab', { name: /Na conta/ }).click()
  await dlg.locator('.sc-card').first().waitFor({ timeout: 15000 })
  await sleep(800)
  return dlg
}

await etapa('d2. painel: entra com a senha de sempre (cria o Dono) e força "Atualizar Hall agora"', async () => {
  await painel.goto(PAINEL)
  await painel.waitForSelector('#form-entrar:not([hidden])', { timeout: 20000 })
  ok(!(await painel.isVisible('#campo-email')), 'entrada: sem conta pessoal ainda, só a senha (modo senha, sem o campo E-mail)')
  await print(painel, 'v32-d2-painel-entrada')
  await painel.fill('#senha', 'errada-de-proposito')
  await painel.click('#botao-entrar')
  await painel.waitForSelector('#erro-entrar:not([hidden])', { timeout: 8000 })
  ok(/Senha incorreta/.test(await painel.textContent('#erro-entrar')), 'painel: senha errada recusada ("Senha incorreta.")')
  await painel.fill('#senha', env.PAINEL_SENHA)
  await painel.click('#botao-entrar')
  await painel.waitForSelector('#tela-painel:not([hidden])', { timeout: 15000 })
  ok(true, 'painel: entrou com a senha do arquivo de config')
  const dono = sql(`SELECT CONCAT_WS('|', nome, papel, da_config, ativo, pin_hash IS NULL, email) FROM admin_contas`)
  ok(dono === 'Dono|dono|1|1|1|', `a 1ª entrada criou a conta "Dono" de emergência, sem PIN e sem e-mail (${dono})`)
  ok(sql(`SELECT COUNT(*) FROM admin_sessoes WHERE etapa = 'pronto'`) === '1', 'sessão do painel registrada no servidor (admin_sessoes)')
  await painel.waitForSelector('.faixa-ouro >> text=Cadastre o seu PIN', { timeout: 10000 })
  ok(true, 'faixa "Cadastre o seu PIN" na conta Dono sem PIN')
  await painel.waitForFunction(() => /atualizado às/.test(document.getElementById('selo-atualizado')?.textContent ?? ''), null, { timeout: 25000 })
  ok((await painel.locator('#numeros-acao .numero-acao').count()) === 8, 'pulso: selo "atualizado às" e os 8 números de ação (v3.3: + Mensagens novas e Candidatos a desafio)')
  await print(painel, 'v32-d2-painel-visao')
  await irP('#/hall', 1800)
  await limparAvisos()
  await abaP().locator('button', { hasText: 'Atualizar Hall agora' }).click()
  ok(await avisoPainel(/Hall atualizado: \d+ carreiras?/), 'painel: "Atualizar Hall agora"')
  ok((await abaP().locator('.segmentos button', { hasText: 'Em revisão' }).count()) === 1, 'painel: Hall público com o filtro "Em revisão"')
  await sleep(800)
  const hall = await hallApi()
  estado.hall1 = hall.itens.map((i) => `${i.posicao}:${i.jogador}:${i.apelido}`)
  ok(hall.itens.some((i) => i.id === estado.idDantas && i.apelido === 'Ian Cruzeiro') && hall.itens.some((i) => i.id === estado.idAmigao && i.apelido === 'Bruno Amigo'), `hall.php: ${estado.hall1.join(' · ')}`)
  ok(hall.itens.filter((i) => i.apelido === 'Ian Cruzeiro').length <= 3, 'A tem no máximo 3 no Hall público')
  await print(painel, 'v32-d2-painel-hall', { fullPage: true })
})

await etapa('d2b. painel: cadastra o PIN (Configurações → Minha conta), sai e entra com o PIN', async () => {
  await irP('#/config?parte=conta', 1800)
  await painel.fill('#cp-senha', env.PAINEL_SENHA)
  await painel.fill('#cp-pin', '123456')
  await painel.fill('#cp-rep', '123456')
  await abaP().locator('button', { hasText: 'Criar PIN' }).click()
  await sleep(900)
  ok(/fácil de adivinhar/.test(await abaP().textContent()), 'PIN em sequência recusado (pin_fraco)')
  await painel.fill('#cp-pin', PIN_DONO)
  await painel.fill('#cp-rep', PIN_DONO)
  await limparAvisos()
  await abaP().locator('button', { hasText: 'Criar PIN' }).click()
  ok(await avisoPainel(/PIN criado/), 'PIN criado pela Minha conta (pede a senha do arquivo de novo)')
  ok(sql(`SELECT pin_hash IS NOT NULL FROM admin_contas WHERE da_config = 1`) === '1', 'servidor: a conta Dono agora tem PIN')
  await print(painel, 'v32-d2b-minha-conta')
  await painel.locator('.lateral-pe button[data-acao="sair"]').click()
  await painel.waitForSelector('#form-entrar:not([hidden])', { timeout: 10000 })
  ok(sql(`SELECT COUNT(*) FROM admin_sessoes`) === '0', 'sair: a sessão sai do servidor')
  await painel.fill('#senha', env.PAINEL_SENHA)
  await painel.click('#botao-entrar')
  await painel.waitForSelector('#form-pin:not([hidden])', { timeout: 10000 })
  ok(true, 'a entrada seguinte pede o PIN (segunda etapa)')
  await print(painel, 'v32-d2b-pin')
  await digitarPin(painel, '#pin-caixas', '000111')
  await painel.waitForSelector('#erro-pin:not([hidden])', { timeout: 8000 })
  ok(/Restam 2/.test(await painel.textContent('#erro-pin')), 'PIN errado: "Restam 2 tentativas"')
  await digitarPin(painel, '#pin-caixas', PIN_DONO)
  await painel.waitForSelector('#tela-painel:not([hidden])', { timeout: 15000 })
  ok(true, 'PIN certo: entrou no painel')
  ok(!(await painel.isVisible('.faixa-ouro >> text=Cadastre o seu PIN')), 'a faixa "Cadastre o seu PIN" sumiu')
})

await etapa('d3. C (sem conta) filtra Bolívia / Cruzeiro e vê a carreira do A', async () => {
  const { page } = C
  await page.goto(`${URL0}#/hall?pais=BOL&clube=e2022`)
  const linha = page.locator('.hl-row.is-com', { hasText: 'DANTAS' })
  await linha.first().waitFor({ timeout: 30000 })
  const t = await linha.first().innerText()
  ok(/comunidade/i.test(t) && t.includes('Ian Cruzeiro'), 'Hall ?pais=BOL&clube=e2022: DANTAS com o selo Comunidade e o apelido do dono')
  ok(/Bolívia/.test(await page.locator('.hl-fhero').innerText()) && /Cruzeiro/.test(await page.locator('.hl-fhero').innerText()), 'herói do filtro: Bolívia · Cruzeiro')
  ok(/Atualizado às \d\d:\d\d · próxima atualização às \d\d:\d\d/.test(await page.locator('.hl-cstatus').innerText()), '"Atualizado às HH:MM · próxima atualização às HH:MM"')
  await print(page, 'd3-C-hall-bolivia-cruzeiro')
  // só pelo clube
  await page.goto(`${URL0}#/hall?clube=e2022`)
  await page.locator('.hl-row.is-com', { hasText: 'DANTAS' }).first().waitFor({ timeout: 30000 })
  ok(true, 'só Cruzeiro: a DANTAS aparece')
  // pela tela: país e clube
  await page.goto(`${URL0}#/hall`)
  await page.locator('.hl-filtros').waitFor({ timeout: 20000 })
  await page.locator('.hl-fsel select').selectOption('BOL')
  await page.waitForFunction(() => location.hash.includes('pais=BOL'))
  await page.locator('.hl-row.is-com', { hasText: 'DANTAS' }).first().waitFor({ timeout: 20000 })
  const bol = await page.locator('.hl-row.is-com').allInnerTexts()
  ok(bol.length >= 1 && bol.every((x) => /Ian Cruzeiro/.test(x)), `só Bolívia (pela tela): ${bol.length} da comunidade, todas do A`)
  await page.getByRole('combobox', { name: 'Clube' }).fill('Cruz')
  await page.getByRole('option', { name: /Cruzeiro/ }).first().click()
  await page.waitForFunction(() => location.hash.includes('clube=e2022'))
  await page.locator('.hl-row.is-com', { hasText: 'DANTAS' }).first().waitFor({ timeout: 20000 })
  ok(true, 'pela tela: Bolívia + busca "Cruz" → Cruzeiro → DANTAS')
  await print(page, 'd3-C-hall-filtro-tela')
  await page.locator('.hl-row.is-com', { hasText: 'DANTAS' }).first().click()
  await page.waitForFunction(() => location.hash.includes('de=comunidade'))
  await page.locator('.sm-chip--com').waitFor({ timeout: 20000 })
  ok((await page.locator('.sm-chip--com').innerText()).includes('Ian Cruzeiro'), 'resumo completo: "Carreira de Ian Cruzeiro"')
  // o "Denunciar" é um pedaço à parte do site (chega logo depois do resumo)
  await page.getByRole('button', { name: 'Denunciar' }).waitFor({ timeout: 15000 }).catch(() => {})
  ok((await page.getByRole('button', { name: 'Salvar na minha conta' }).count()) === 0 && (await page.getByRole('button', { name: 'Denunciar' }).count()) === 1, 'resumo da comunidade: sem salvar, com "Denunciar"')
  ok(((await lerKv(page, 'hall')) ?? []).length === 0, 'Hall do aparelho do C continua vazio')
  await print(page, 'd3-C-resumo-comunidade', { fullPage: false })
  // celular: o Hall com filtro não rola para o lado
  const cel = await novo('C-celular', { partidas: 0, viewport: { width: 390, height: 844 }, celular: true })
  await cel.page.goto(`${URL0}#/hall?pais=BOL&clube=e2022`)
  await cel.page.locator('.hl-row.is-com').first().waitFor({ timeout: 30000 })
  await sleep(600)
  ok((await cel.page.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'celular: Hall com filtro sem rolagem lateral')
  await print(cel.page, 'd3-C-celular-hall')
})

await etapa('d4. B denuncia a carreira DANTAS', async () => {
  const { page } = B
  await page.goto(`${URL0}#/resumo?id=${estado.idDantas}&de=comunidade`)
  await page.locator('.sm-chip--com').waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: 'Denunciar' }).click()
  const d = page.getByRole('dialog', { name: 'Denunciar carreira' })
  await d.waitFor()
  await d.getByText('Trapaça').click()
  await d.locator('textarea').fill('Números estranhos <b>teste</b>')
  await print(page, 'd4-B-denunciar')
  await d.getByRole('button', { name: 'Enviar denúncia' }).click()
  await page.getByRole('button', { name: 'Denunciada' }).waitFor({ timeout: 15000 })
  ok(sql(`SELECT CONCAT_WS('|', d.motivo, d.status) FROM denuncias d JOIN carreiras c ON c.id=d.carreira_pk WHERE c.carreira_id='${estado.idDantas}' AND d.usuario_id=${estado.idB}`) === 'trapaca|aberta', 'denúncia do B registrada (trapaça, aberta)')
})

// ───────────────────────── f. v3.2 no jogo e no painel ─────────────────────────
await etapa('f1. A: atalho "Convide amigos" no menu (com a promessa do bônus) abre a Minha conta em "Convide amigos"', async () => {
  const { page } = A
  await page.goto(`${URL0}#/`)
  await page.waitForSelector('.ld-modes', { timeout: 30000 })
  const m = await menu(page)
  const linha = m.getByRole('button', { name: /Convide amigos/ })
  await linha.waitFor({ timeout: 10000 })
  const t = (await linha.innerText()).replace(/\s+/g, ' ')
  ok(/\+2, \+3 e \+5 de OVR/.test(t), `menu logado: "Convide amigos" com a promessa (${t.slice(0, 80)})`)
  await print(page, 'v32-f1-menu-convide')
  await linha.click()
  const mc = page.getByRole('dialog', { name: 'Minha conta' })
  await mc.waitFor({ timeout: 15000 })
  await page.waitForFunction(() => document.activeElement?.id === 'sc-convite-h', null, { timeout: 10000 }).catch(() => {})
  const foco = await page.evaluate(() => document.activeElement?.id ?? '')
  const visivel = await page.evaluate(() => {
    const e = document.getElementById('sc-convite-h')
    if (!e) return false
    const r = e.getBoundingClientRect()
    return r.top >= 0 && r.top < innerHeight
  })
  ok(foco === 'sc-convite-h' && visivel, `a Minha conta abre rolada até "Indicações e bônus de OVR", com o foco nela (${foco})`)
  await print(page, 'v32-f1-minha-conta-convite')
  await page.keyboard.press('Escape')
})

await etapa('f2. carreiras de nota alta (93) vão para a revisão: o jogador vê "Em revisão" em Minhas carreiras', async () => {
  estado.idRevA = `career-e2e-revisao-a-${Date.now()}`
  estado.idRevB = `career-e2e-revisao-b-${Date.now()}`
  const ra = await salvarNotaAlta(A2.page, estado.idRevA, 'ALTAVISTA')
  const rb = await salvarNotaAlta(B.page, estado.idRevB, 'ALTAMIRA')
  ok(ra.status === 200 && ra.json?.carreira?.hall?.estado === 'revisao' && rb.status === 200 && rb.json?.carreira?.hall?.estado === 'revisao',
    `salvar nota 93: C.hall = revisao no salvar (${ra.status} ${JSON.stringify(ra.json?.carreira?.hall)} · ${rb.status})`)
  ok(sql(`SELECT GROUP_CONCAT(suspeita ORDER BY id) FROM carreiras WHERE carreira_id IN ('${estado.idRevA}', '${estado.idRevB}')`) === 'revisao,revisao', 'servidor: as duas com suspeita = revisao (fora do Hall até a conferência)')
  // rev3 (§E.7 #15): a promessa "entra no Hall assim que for conferida" só vale para a carreira que, conferida, estaria
  // entre as que a conta mostra. O A está no "Eu escolho" com as 3 já escolhidas (d1): a dele fica em revisão sem
  // promessa. O B está no automático com 1 carreira: a dele entraria, com a promessa.
  const carreiraDe = async (page, id) => {
    const g = await page.evaluate(async () => (await fetch('api/carreiras.php', { credentials: 'same-origin' })).json())
    return (g.carreiras ?? g.itens ?? []).find((x) => x.id === id) ?? null
  }
  const c = await carreiraDe(A2.page, estado.idRevA)
  ok(c?.hall?.estado === 'revisao' && c?.hall?.motivo === 'Em revisão: a moderação confere as notas altas antes do Hall.',
    `GET carreiras.php (A, "Eu escolho" com 3 escolhidas): hall {estado: revisao} sem prometer a entrada (${JSON.stringify(c?.hall)})`)
  const cb = await carreiraDe(B.page, estado.idRevB)
  ok(cb?.hall?.estado === 'revisao' && cb?.hall?.motivo === 'Em revisão: entra no Hall assim que for conferida.',
    `GET carreiras.php (B, automático): hall {estado: revisao, motivo: "Em revisão: entra no Hall assim que for conferida."} (${JSON.stringify(cb?.hall)})`)
  const dlg = await minhasCarreiras(A2.page)
  const card = dlg.locator('.sc-card', { hasText: 'ALTAVISTA' })
  await card.waitFor({ timeout: 15000 })
  const tc = await card.innerText()
  ok(/Em revisão/.test(tc) && /Em revisão: a moderação confere as notas altas antes do Hall/.test(tc) && !/assim que for conferida/.test(tc),
    `Minhas carreiras (celular, A): selo "Em revisão" e a frase sem a promessa (${tc.replace(/\s+/g, ' ').slice(-120)})`)
  await card.scrollIntoViewIfNeeded()
  await print(A2.page, 'v32-f2-minhas-carreiras-em-revisao')
  const w = await semRolagem(A2.page)
  ok(w[0] <= w[1], `celular: Minhas carreiras sem rolagem lateral (${w[0]} ≤ ${w[1]})`)
  await A2.page.keyboard.press('Escape')
  const dlgB = await minhasCarreiras(B.page)
  const cardB = dlgB.locator('.sc-card', { hasText: 'ALTAMIRA' })
  await cardB.waitFor({ timeout: 15000 })
  const tb = await cardB.innerText()
  ok(/Em revisão/.test(tb) && /Em revisão: entra no Hall assim que for conferida/.test(tb), `Minhas carreiras (B): selo "Em revisão" e "Em revisão: entra no Hall assim que for conferida" (${tb.replace(/\s+/g, ' ').slice(-120)})`)
  await cardB.scrollIntoViewIfNeeded()
  await print(B.page, 'v32-f2-B-minhas-carreiras-em-revisao')
  await B.page.keyboard.press('Escape')
})

await etapa('f3. painel: "Precisa de atenção" com a denúncia e as carreiras em revisão; números ao vivo', async () => {
  await irP('#/visao', 800)
  await painel.reload()
  await painel.waitForSelector('#tela-painel:not([hidden])', { timeout: 15000 })
  await painel.waitForFunction(() => /denúncia aberta/.test(document.getElementById('atencao')?.textContent ?? '') && /revisão para entrar no Hall/.test(document.getElementById('atencao')?.textContent ?? ''), null, { timeout: 80000 }).catch(() => {})
  const at = (await painel.textContent('#atencao')) ?? ''
  ok(/1 denúncia aberta \(a mais antiga há/.test(at), `atenção: "1 denúncia aberta (a mais antiga há …)" (${at.replace(/\s+/g, ' ').slice(0, 200)})`)
  ok(/2 carreiras de nota alta esperam a sua revisão para entrar no Hall/.test(at), 'atenção: "2 carreiras de nota alta esperam a sua revisão para entrar no Hall"')
  await painel.waitForFunction(() => (document.getElementById('nav-denunciasAbertas')?.textContent ?? '').trim() === '1', null, { timeout: 20000 }).catch(() => {})
  ok((await painel.textContent('#nav-denunciasAbertas')).trim() === '1' && Number((await painel.textContent('#nav-suspeitas')).trim()) >= 2, 'números ao vivo: 1 denúncia aberta, 2+ suspeitas/revisão')
  await print(painel, 'v32-f3-precisa-de-atencao')
  await painel.locator('#atencao a', { hasText: 'revisão para entrar no Hall' }).click()
  await painel.waitForFunction(() => location.hash.startsWith('#/hall') && location.hash.includes('filtro=revisao'), null, { timeout: 10000 })
  await sleep(1500)
  ok((await abaP().locator('tbody tr').count()) === 2, 'o link do alerta abre o Hall em "Em revisão" com as 2')
})

await etapa('f4. painel: liberar em lote as carreiras em revisão', async () => {
  const linhas = abaP().locator('tbody tr')
  ok((await linhas.filter({ hasText: 'ALTAVISTA' }).count()) === 1 && (await linhas.filter({ hasText: 'ALTAMIRA' }).count()) === 1, 'as duas na lista')
  for (const c of await abaP().locator('tbody input[type=checkbox]').all()) await c.check()
  await sleep(300)
  const barra = abaP().locator('.barra-lote')
  await print(painel, 'v32-f4-lote-marcado')
  await limparAvisos()
  await barra.locator('button', { hasText: /^Liberar/ }).click()
  await dialogo().waitFor()
  ok(/Liberar 2 carreiras/.test(await dialogo().locator('button[type=submit]').textContent()), 'diálogo do lote: "Liberar 2 carreiras"')
  await print(painel, 'v32-f4-lote-dialogo')
  await confirmar()
  ok(await avisoPainel(/2 liberadas/), 'toast: "2 liberadas"')
  ok(sql(`SELECT COUNT(*) FROM carreiras WHERE carreira_id IN ('${estado.idRevA}', '${estado.idRevB}') AND suspeita IS NULL`) === '2', 'servidor: as duas liberadas (sem suspeita)')
  ok(sql(`SELECT COUNT(*) FROM admin_log WHERE acao = 'mostrar_carreira' AND detalhes LIKE '%"lote":true%'`) === '2' && sql(`SELECT COUNT(*) FROM admin_log WHERE acao = 'carreiras_lote'`) === '1', 'registro: uma linha por carreira + a do lote')
  const r = await admin({ acao: 'atualizar_hall' })
  ok(r.status === 200 && (await hallApi()).itens.some((i) => i.id === estado.idRevB), 'depois de atualizar: a do B (Hall automático) entra no Hall público')
  const g = await A2.page.evaluate(async () => (await fetch('api/carreiras.php', { credentials: 'same-origin' })).json())
  const c = (g.carreiras ?? []).find((x) => x.id === estado.idRevA)
  ok(c?.hall?.estado === 'fora' && /escolheu outras carreiras/.test(c?.hall?.motivo ?? ''), `a do A ("Eu escolho") sai da revisão para "fora: você escolheu outras carreiras" (${JSON.stringify(c?.hall)})`)
})

// ───────────────────────── e. admin no painel (v3 + v3.2) ─────────────────────────
await etapa('e1. painel: visão geral e usuários', async () => {
  await irP('#/visao', 1500)
  await painel.waitForFunction(() => document.querySelectorAll('#ladrilhos .ladrilho').length === 12, null, { timeout: 20000 })
  const vis = await painel.textContent('#ladrilhos')
  ok(/Visitantes/i.test(vis), 'visão geral: os 12 números do período')
  const p = await admin(null, { r: 'resumo' })
  ok(p.json?.usuarios?.total === 2 && p.json?.denunciasAbertas === 1, `resumo: 2 contas, 1 denúncia aberta (${JSON.stringify(p.json?.usuarios)})`)
  const pn = await (await fetch(`${URL0}api/painel.php`, { headers: { Authorization: `Bearer ${env.PAINEL_TOKEN}` } })).json()
  ok(pn.periodo.visitantes >= 4 && pn.periodo.cadastros === 2, `painel.php: ${pn.periodo.visitantes} visitantes (A, A2, B, C…), ${pn.periodo.cadastros} cadastros, ${pn.periodo.jogaram} jogaram`)
  ok(typeof pn.geradoEm === 'string' && Date.now() - Date.parse(pn.geradoEm) < 120_000, `painel.php: números guardados por até 90 s (geradoEm ${pn.geradoEm})`)
  await print(painel, 'v32-e1-visao-geral', { fullPage: true })
  await irP('#/usuarios', 1800)
  await abaP().locator('tbody tr').first().waitFor({ timeout: 10000 })
  const linhas = (await abaP().locator('tbody tr').allInnerTexts()).join(' | ')
  ok(/Ian Cruzeiro/.test(linhas) && /Bruno Amigo/.test(linhas), 'usuários: A e B na lista')
  ok((await abaP().locator('.email-mascara').first().isVisible()) && !linhas.includes(EMAIL_A), 'modo discreto (padrão): e-mails mascarados na lista')
  await print(painel, 'v32-e1-usuarios')
})

await etapa('e2. painel: suspender B (motivo obrigatório) → B deslogado e fora do Hall; reativar', async () => {
  await irP(`#/usuarios?conta=${estado.idB}`, 1800)
  await painel.waitForSelector('#gaveta:not([hidden]) .perfil-nome h2', { timeout: 10000 })
  ok((await painel.textContent('#gaveta .perfil-nome h2')) === 'Bruno Amigo', 'ficha do B no painel lateral (conta= no hash)')
  ok(/AMIGAO/.test(await painel.textContent('#gaveta')), 'ficha do B: a carreira AMIGAO')
  await print(painel, 'v32-e2-ficha-B')
  await limparAvisos()
  await naFicha(painel, 'Suspender').click()
  await dialogo().waitFor()
  await dialogo().locator('textarea').fill('')
  await confirmar()
  ok((await dialogo().locator('.erro-campo:not([hidden])', { hasText: 'motivo' }).count()) === 1, 'suspender sem motivo: o diálogo pede o motivo (não envia)')
  await dialogo().locator('textarea').fill('Teste de moderação')
  await confirmar()
  ok(await avisoPainel(/suspens/), 'suspender B com motivo')
  ok(sql(`SELECT motivo_suspensao FROM usuarios WHERE id=${estado.idB}`) === 'Teste de moderação', 'servidor: motivo da suspensão gravado')
  ok(sql(`SELECT COUNT(*) FROM sessoes_login WHERE usuario_id=${estado.idB}`) === '0', 'sessões do B encerradas')
  const h = await hallApi()
  ok(!h.itens.some((i) => i.id === estado.idAmigao), 'hall.php: a carreira do B saiu do Hall na hora')
  const { page } = B
  await page.goto(`${URL0}#/`)
  await page.reload()
  await page.waitForSelector('.ld-modes', { timeout: 30000 })
  await sleep(2000)
  const m = await menu(page)
  await m.getByText(/Entrar \/ Criar conta|Minha conta/).first().waitFor({ timeout: 10000 })
  ok((await m.innerText()).includes('Entrar / Criar conta') && !(await m.innerText()).includes('Bruno Amigo'), 'B: deslogado no aparelho (o menu volta a "Entrar / Criar conta")')
  const errosAntes = B.erros.length
  await m.getByText('Entrar / Criar conta').click()
  const d = page.locator('[role="dialog"].sc-modal')
  await d.waitFor()
  await d.getByRole('tab', { name: /Já tenho conta|Entrar/ }).first().click().catch(() => {})
  await preencherConta(page, d, [['E-mail', EMAIL_B], ['Senha', SENHA, true]])
  await d.getByRole('button', { name: 'Entrar', exact: true }).click()
  await d.getByText(/suspensa/i).first().waitFor({ timeout: 10000 })
  ok(true, 'B: entrar com a conta suspensa mostra "suspensa"')
  B.erros.splice(errosAntes, B.erros.length - errosAntes, ...B.erros.slice(errosAntes).filter((x) => !/status of 403/.test(x)))
  await page.keyboard.press('Escape')
  await limparAvisos()
  await naFicha(painel, 'Reativar').click()
  await dialogo().waitFor()
  await confirmar()
  ok(await avisoPainel(/reativad/), 'reativar B (motivo opcional)')
  const m2 = await menu(page)
  await m2.getByText('Entrar / Criar conta').click()
  const d2 = page.locator('[role="dialog"].sc-modal')
  await d2.waitFor()
  await preencherConta(page, d2, [['E-mail', EMAIL_B], ['Senha', SENHA, true]])
  await d2.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[role="dialog"].sc-modal'), null, { timeout: 15000 })
  ok(true, 'B: entra de novo depois de reativado')
  const r = await admin({ acao: 'atualizar_hall' })
  ok(r.status === 200 && (await hallApi()).itens.some((i) => i.id === estado.idAmigao), 'depois de reativar + atualizar: a carreira do B volta ao Hall')
})

await etapa('e3. painel: renomear e dar bônus ao B; nota interna (P1-5)', async () => {
  await irP(`#/usuarios?conta=${estado.idB}`, 1800)
  await painel.waitForSelector('#gaveta:not([hidden]) .perfil-nome h2', { timeout: 10000 })
  await limparAvisos()
  await naFicha(painel, 'Renomear').click()
  await dialogo().locator('input').fill('Bruno Moderado')
  await confirmar()
  ok(await avisoPainel(/trocado para Bruno Moderado/), 'renomear B')
  const it = (await hallApi()).itens.find((i) => i.id === estado.idAmigao)
  ok(it?.apelido === 'Bruno Moderado', `hall.php já mostra o apelido novo (${it?.apelido})`)
  await limparAvisos()
  await painel.locator('#gaveta .perfil-acoes button', { hasText: 'Dar bônus' }).first().click()
  await dialogo().locator('button[role="radio"]', { hasText: '+1' }).click()
  await dialogo().locator('input').fill('Presente da moderação')
  await confirmar()
  ok(await avisoPainel(/Bônus dado/), 'dar bônus +1 ao B')
  await sleep(600)
  await painel.fill('#gaveta .nota-interna textarea', 'Conta do amigo do Ian.\nVeio pelo convite; conferido na live.')
  await limparAvisos()
  await painel.locator('#gaveta .nota-interna button', { hasText: 'Salvar' }).click()
  ok(await avisoPainel(/Anotação salva/), 'anotação interna salva (só a equipe vê)')
  ok(sql(`SELECT nota_admin LIKE '%\\nVeio%' FROM usuarios WHERE id=${estado.idB}`) === '1', 'servidor: a anotação guarda a quebra de linha')
  ok(sql(`SELECT detalhes FROM admin_log WHERE acao = 'nota' ORDER BY id DESC LIMIT 1`).includes('tamanho') && !sql(`SELECT detalhes FROM admin_log WHERE acao = 'nota' ORDER BY id DESC LIMIT 1`).includes('amigo'), 'registro: só o tamanho da anotação (nunca o texto)')
  const c = await B.page.evaluate(async () => (await fetch('api/conta.php', { credentials: 'same-origin' })).text())
  ok(!c.includes('Veio pelo convite') && !c.includes('nota_admin'), 'conta.php do B: a anotação nunca vai para o jogador')
  await print(painel, 'v32-e3-ficha-nota', { fullPage: false })
  const { page } = B
  await page.goto(`${URL0}#/identidade?ritmo=expressa`)
  await page.locator('.id-bonus').waitFor({ timeout: 20000 })
  const t = await page.locator('.id-bonus').innerText()
  ok(/\+1/.test(t) && /presente do LENDA/.test(t), `B vê o bônus na criação da carreira ("${t.replace(/\s+/g, ' ').slice(0, 50)}")`)
})

await etapa('e4. painel: ocultar com motivo (e avisar o autor) → A vê "Fora do Hall: …"; resolver a denúncia', async () => {
  await irP('#/hall', 1800)
  await abaP().locator('tbody tr').first().waitFor({ timeout: 10000 })
  const alvo = estado.foraDoHallA === 'FENOMENO' ? 'MURALHA' : 'FENOMENO'
  const idAlvo = alvo === 'FENOMENO' ? estado.idFenomeno : estado.idMuralha
  estado.alvoOculta = alvo
  estado.idAlvoOculta = idAlvo
  ok((await hallApi()).itens.some((i) => i.id === idAlvo), `${alvo} está no Hall antes`)
  await limparAvisos()
  await abaP().locator('tbody tr', { hasText: alvo }).first().locator('button[title^="Ocultar"]').click()
  await dialogo().waitFor()
  await confirmar()
  ok((await dialogo().locator('.erro-campo:not([hidden])', { hasText: 'motivo' }).count()) === 1, 'ocultar sem motivo: não envia (P0-4)')
  await dialogo().locator('.chip-motivo', { hasText: 'Nome ofensivo' }).click()
  await dialogo().locator('input[type=checkbox]').check()
  await print(painel, 'v32-e4-ocultar-motivo')
  await confirmar()
  ok(await avisoPainel(/ocultada/), `ocultar ${alvo} com o motivo e "Avisar o autor"`)
  ok(!(await hallApi()).itens.some((i) => i.id === idAlvo), `hall.php: ${alvo} saiu na hora`)
  ok(sql(`SELECT CONCAT_WS('|', oculta, motivo_admin, moderada_em IS NOT NULL) FROM carreiras WHERE carreira_id='${idAlvo}'`) === '1|Nome ofensivo|1', 'servidor: oculta = 1, motivo_admin e moderada_em gravados')
  ok(/^Uma carreira sua \(.+\) saiu do Hall público por: nome ofensivo\./.test(sql(`SELECT aviso_conta FROM usuarios WHERE id=${estado.idA}`)), 'servidor: aviso padrão para o autor (H11), sem o motivo escrito')
  estado.pkOculta = sql(`SELECT id FROM carreiras WHERE carreira_id='${idAlvo}'`)
  // o jogador
  const { page } = A
  const dlg = await minhasCarreiras(page)
  const card = dlg.locator('.sc-card', { hasText: alvo })
  const tc = await card.innerText()
  ok(/Fora do Hall/.test(tc) && /Fora do Hall: a moderação tirou esta carreira do Hall público\./.test(tc), `A em Minhas carreiras: "Fora do Hall: a moderação tirou esta carreira do Hall público." (${tc.replace(/\s+/g, ' ').slice(0, 160)})`)
  await card.scrollIntoViewIfNeeded()
  await print(page, 'v32-e4-A-fora-do-hall')
  await page.keyboard.press('Escape')
  // o aviso chega na próxima abertura do jogo (o GET conta.php de sempre): lembrete em toast e o ponto no menu
  await page.reload()
  await page.waitForSelector('.ld-modes', { timeout: 30000 })
  ok(await page.getByText('Um aviso sobre o Hall público').first().waitFor({ timeout: 15000 }).then(() => true, () => false), 'ao abrir o jogo: lembrete "Um aviso sobre o Hall público"')
  await print(page, 'v32-e4-A-lembrete-aviso')
  const m = await menu(page)
  await m.getByText(/1 aviso da moderação/).first().waitFor({ timeout: 10000 }).catch(() => {})
  ok(/1 aviso da moderação/.test(await m.innerText()), 'menu do A: "Minha conta · 1 aviso da moderação"')
  await m.getByText(/Minha conta/).first().click()
  const mc = page.getByRole('dialog', { name: 'Minha conta' })
  await mc.waitFor({ timeout: 15000 })
  await mc.getByText('Aviso da moderação').waitFor({ timeout: 10000 })
  ok(/saiu do Hall público por: nome ofensivo/.test(await mc.innerText()), 'Minha conta: cartão "Aviso da moderação" com o texto padrão')
  await print(page, 'v32-e4-A-aviso-moderacao')
  const lido = await esperarSql(`SELECT aviso_conta IS NULL FROM usuarios WHERE id=${estado.idA}`, (x) => x === '1', 10000)
  ok(lido === '1', 'o aviso aparece uma vez (aviso_lido apaga no servidor)')
  await page.keyboard.press('Escape')
  // a denúncia do B sobre a DANTAS
  await irP('#/denuncias', 1800)
  await abaP().locator('article.denuncia').first().waitFor({ timeout: 10000 })
  const den = await abaP().textContent()
  ok(/DANTAS/.test(den) && /Números estranhos <b>teste<\/b>/.test(den) && (await abaP().locator('article.denuncia b', { hasText: /^teste$/ }).count()) === 0, 'denúncias: a do B sobre a DANTAS, texto escapado')
  await print(painel, 'v32-e4-denuncias')
  await limparAvisos()
  await abaP().locator('article.denuncia', { hasText: 'DANTAS' }).locator('button', { hasText: 'Manter no Hall' }).click()
  await dialogo().waitFor()
  await confirmar()
  ok(await avisoPainel(/mantida/), 'denúncia resolvida: manter no Hall (motivo opcional)')
  ok(sql(`SELECT COUNT(*) FROM denuncias WHERE status='aberta'`) === '0' && (await hallApi()).itens.some((i) => i.id === estado.idDantas), 'DANTAS continua no Hall, nenhuma denúncia aberta')
})

await etapa('f5. X4: o admin abre no jogo a carreira oculta (o público não)', async () => {
  const pk = estado.pkOculta
  await irP(`#/hall?filtro=ocultas&carreira=${pk}`, 1800)
  await painel.waitForSelector('#gaveta:not([hidden]) .carreira-topo', { timeout: 10000 })
  ok(/Última decisão: Nome ofensivo/.test(await painel.textContent('#gaveta')), 'ficha da carreira: "Última decisão" com o motivo')
  const link = painel.locator('#gaveta a', { hasText: 'Abrir no jogo' }).first()
  ok((await link.getAttribute('href')) === `../#/resumo?id=${pk}&de=admin`, 'ficha: "Abrir no jogo" → ../#/resumo?id=<pk>&de=admin')
  await print(painel, 'v32-f5-ficha-carreira')
  const [aba] = await Promise.all([ADM.ctx.waitForEvent('page'), link.click()])
  await aba.locator('.sm-admin').waitFor({ timeout: 30000 })
  const t = await aba.locator('.sm-admin').innerText()
  ok(/Visão do admin/i.test(t) && /Oculta pela moderação/i.test(t) && /Nome ofensivo/.test(t), `jogo, como admin: faixa "Visão do admin" com o estado e o motivo (${t.replace(/\s+/g, ' ').slice(0, 160)})`)
  ok((await aba.getByText(estado.alvoOculta).count()) > 0 && (await aba.getByRole('button', { name: 'Salvar na minha conta' }).count()) === 0 && (await aba.getByRole('button', { name: 'Denunciar' }).count()) === 0, 'resumo completo, sem Salvar nem Denunciar')
  await print(aba, 'v32-f5-jogo-visao-do-admin')
  await aba.close()
  const { page } = C
  await page.goto(`${URL0}#/resumo?id=${pk}&de=admin`)
  await page.getByText('Carreira não encontrada').first().waitFor({ timeout: 20000 })
  ok((await page.locator('.sm-admin').count()) === 0, 'público no mesmo endereço: "Carreira não encontrada" (sem a faixa do admin)')
  const st = await page.evaluate(async (id) => (await fetch(`api/admin.php?r=carreira&id=${id}`, { credentials: 'same-origin' })).status, pk)
  ok(st === 401, `público: admin.php?r=carreira → ${st}`)
  await print(page, 'v32-f5-publico-nao-encontrada')
})

await etapa('f6. lixeira: apagar (motivo) → o aparelho não sobe de novo (409) → restaurar oculta', async () => {
  const pk = estado.pkOculta
  await irP(`#/hall?filtro=ocultas&carreira=${pk}`, 1800)
  await painel.waitForSelector('#gaveta:not([hidden]) .carreira-topo', { timeout: 10000 })
  await limparAvisos()
  await naFicha(painel, 'Apagar').click()
  await dialogo().waitFor()
  ok(/Prefira Ocultar/.test(await dialogo().textContent()), 'apagar: "Prefira Ocultar" antes')
  await dialogo().locator('textarea').fill('Teste da lixeira (integração)')
  await confirmar()
  ok(await avisoPainel(/lixeira/), 'apagar: vai para a lixeira')
  ok(sql(`SELECT CONCAT_WS('|', motivo, dados IS NOT NULL) FROM lixeira_carreiras WHERE carreira_id='${estado.idAlvoOculta}'`) === 'Teste da lixeira (integração)|1', 'servidor: cópia na lixeira com o motivo')
  const h = (await lerKv(A.page, 'hall')).find((x) => x.id === estado.idAlvoOculta)
  const r409 = await A.page.evaluate(async (h) => {
    const r = await fetch('api/carreiras.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ acao: 'salvar', carreira: h, como: 'auto' }) })
    return `${r.status}:${(await r.json()).erro}`
  }, h)
  ok(r409 === '409:apagada', `o aparelho do A salvando a mesma carreira de novo: ${r409}`)
  A.erros.splice(0, A.erros.length, ...A.erros.filter((x) => !/status of 409/.test(x)))
  await irP('#/hall?filtro=lixeira', 1800)
  const linhaLix = abaP().locator('tbody tr', { hasText: 'Teste da lixeira (integração)' })
  ok((await linhaLix.count()) === 1, 'lixeira: a carreira apagada com o motivo, quem e quando vence')
  await print(painel, 'v32-f6-lixeira')
  await limparAvisos()
  await linhaLix.locator('button', { hasText: 'Restaurar' }).click()
  ok(await avisoPainel(/restaurada/), 'lixeira: restaurar (confirm)')
  ok(sql(`SELECT CONCAT_WS('|', id, oculta) FROM carreiras WHERE carreira_id='${estado.idAlvoOculta}'`) === `${pk}|1`, 'voltou com o mesmo id e oculta = 1')
  await painel.keyboard.press('Escape')
})

await etapa('f7. tester: a conta do B vira tester → abre a Live e o Imersivo com o selo de teste', async () => {
  await irP(`#/usuarios?conta=${estado.idB}`, 1800)
  await painel.waitForSelector('#gaveta:not([hidden]) .tipo-conta select', { timeout: 10000 })
  await limparAvisos()
  await painel.selectOption('#gaveta .tipo-conta select', 'tester')
  ok(await avisoPainel(/agora é tester/), 'tipo de conta: tester (com confirm)')
  ok(sql(`SELECT tipo FROM usuarios WHERE id=${estado.idB}`) === 'tester', 'servidor: tipo = tester')
  const { page } = B
  await page.goto(`${URL0}#/`)
  await page.reload()
  await page.waitForSelector('.ld-modes', { timeout: 30000 })
  await sleep(2500)
  const u = await page.evaluate(async () => (await fetch('api/conta.php', { credentials: 'same-origin' })).json())
  ok(u.usuario?.tester === true, 'conta.php: U.tester = true')
  const m = await menu(page)
  ok(/liberado para a sua conta de testes/.test(await m.innerText()) && !/Painel do admin/.test(await m.innerText()), 'menu do tester: "liberado para a sua conta de testes", sem "Painel do admin"')
  await print(page, 'v32-f7-tester-menu')
  await fecharMenu(page)
  await page.goto(`${URL0}#/identidade?modo=imersivo`)
  await page.locator('.pt-selo').waitFor({ timeout: 20000 })
  ok(/Teste · conta de testes/.test(await page.locator('.pt-selo').innerText()), 'Imersivo aberto para o tester, com o selo "Teste · conta de testes"')
  await page.goto(`${URL0}#/kit`)
  await esperarTexto(page, 'Página não encontrada', 15000)
  ok(true, 'tester: #/kit continua fechado')
})

await etapa('e5. painel: configurações (aviso no jogo; Imersivo aberto e fechado ao público; revisão do Hall)', async () => {
  await irP('#/config', 2000)
  await painel.waitForSelector('.config-grade', { timeout: 10000 })
  await painel.locator('[data-chave="aviso"] .interruptor').click()
  await painel.fill('#cfg-aviso-texto', 'Hall das Lendas atualizado a cada hora!')
  await painel.locator('[data-chave="imersivo_publico"] .interruptor').click()
  await painel.fill('#cfg-hall_revisao_nota', '95')
  await limparAvisos()
  await painel.locator('.barra-salvar button', { hasText: 'Salvar' }).click()
  await dialogo().waitFor()
  ok(/Abrir o Modo Imersivo para todo mundo/.test(await dialogo().textContent()), 'salvar: o diálogo avisa o que todo mundo vê')
  await print(painel, 'v32-e5-config-confirmar')
  await confirmar()
  ok(await avisoPainel(/Configurações salvas/), 'config salva: aviso + Imersivo aberto + revisão em 95')
  ok(sql("SELECT valor FROM site_config WHERE chave = 'hall_revisao_nota'") === '95', 'X1: hall_revisao_nota = 95 no banco')
  const { page } = C
  await page.goto(`${URL0}#/`)
  await page.reload()
  await page.locator('.lx-aviso').first().waitFor({ timeout: 20000 })
  ok((await page.locator('.lx-aviso').first().innerText()).includes('Hall das Lendas atualizado a cada hora!'), 'C vê o aviso no topo do jogo')
  await page.waitForSelector('.ld-modes')
  await sleep(1500)
  const imm = page.locator('.ld-mode').nth(1)
  ok((await imm.getAttribute('aria-disabled')) === null && !/Em desenvolvimento/.test(await imm.innerText()), 'C (público): cartão do Imersivo liberado')
  await page.goto(`${URL0}#/identidade?modo=imersivo`)
  await page.waitForSelector('#id-surname', { timeout: 30000 })
  ok((await page.getByText('Partida a partida,').count()) === 0 && (await page.locator('.pt-selo').count()) === 0, 'C: o Imersivo abre para o público (sem "Em breve" e sem selo)')
  await irP('#/config', 2000)
  await painel.waitForSelector('.config-grade', { timeout: 10000 })
  await painel.locator('[data-chave="imersivo_publico"] .interruptor').click()
  await painel.locator('[data-chave="aviso"] .interruptor').click()
  await painel.fill('#cfg-hall_revisao_nota', '90')
  await limparAvisos()
  await painel.locator('.barra-salvar button', { hasText: 'Salvar' }).click()
  await confirmar()
  ok(await avisoPainel(/Configurações salvas/), 'config salva: Imersivo fechado de novo, sem aviso, revisão em 90')
  await page.goto(`${URL0}#/imersivo`)
  await page.reload()
  await esperarTexto(page, 'Partida a partida,', 20000)
  ok((await page.locator('.lx-aviso').count()) === 0, 'C: Imersivo volta a "Em breve" e o aviso some')
  const cfg = await (await fetch(`${URL0}api/conta.php`)).json()
  ok(cfg.site.imersivoPublico === false && cfg.site.livePublica === false && cfg.site.aviso === null, 'conta.php: Imersivo e Live fechados ao público')
})

await etapa('e6. painel: Testes → Imersivo e Live em outra aba (só a equipe)', async () => {
  await irP('#/testes', 1800)
  await painel.waitForSelector('.grade-testes', { timeout: 10000 })
  await print(painel, 'v32-e6-testes')
  const [imm] = await Promise.all([ADM.ctx.waitForEvent('page'), painel.click('a:has-text("Nova carreira no Imersivo")')])
  await imm.waitForSelector('#id-surname', { timeout: 30000 })
  await imm.locator('.pt-selo').waitFor({ timeout: 20000 })
  ok((await imm.locator('.pt-selo').innerText()).includes('Teste · só admin'), 'outra aba: Imersivo (nova carreira) com o selo "Teste · só admin"')
  await imm.close()
  const [live] = await Promise.all([ADM.ctx.waitForEvent('page'), painel.click('a:has-text("Abrir a Live")')])
  await live.waitForLoadState()
  await sleep(4000)
  ok((await live.getByText('Página não encontrada').count()) === 0, 'outra aba: a Live abre para o admin')
  await live.close()
  await C.page.goto(`${URL0}#/live`)
  await esperarTexto(C.page, 'Página não encontrada', 15000)
  ok(true, 'C (público) no mesmo endereço: "Página não encontrada"')
})

await etapa('e7. painel: exportar CSV, relatório em CSV e o Registro', async () => {
  await irP('#/usuarios', 1800)
  await abaP().locator('tbody tr').first().waitFor({ timeout: 10000 })
  const [csv] = await Promise.all([painel.waitForEvent('download', { timeout: 15000 }), painel.click('#acoes-aba button:has-text("Exportar CSV")')])
  const conteudo = readFileSync(await csv.path()).toString('utf8')
  const linhas = conteudo.replace(/^﻿/, '').trim().split(/\r?\n/)
  ok(conteudo.charCodeAt(0) === 0xfeff && linhas.length === 3 && conteudo.includes(EMAIL_A) && conteudo.includes(EMAIL_B) && /Bruno Moderado/.test(conteudo), `CSV de contas: BOM + cabeçalho + 2 contas (${csv.suggestedFilename()})`)
  await irP('#/relatorios?tipo=engajados', 2000)
  await abaP().locator('tbody tr').first().waitFor({ timeout: 10000 })
  await print(painel, 'v32-e7-relatorios')
  const [rel] = await Promise.all([painel.waitForEvent('download', { timeout: 15000 }), abaP().locator('button', { hasText: 'Baixar CSV' }).click()])
  const tr = readFileSync(await rel.path()).toString('utf8')
  const lr = tr.replace(/^﻿/, '').trim().split(/\r?\n/)
  ok(tr.charCodeAt(0) === 0xfeff && lr[0].includes(';') && lr.length === 3 && /^lenda-engajados-\d{4}-\d\d-\d\d\.csv$/.test(rel.suggestedFilename()), `relatório "engajados" em CSV: BOM, ";" e as 2 contas (${rel.suggestedFilename()})`)
  ok(sql(`SELECT COUNT(*) FROM admin_log WHERE acao = 'exportar' AND detalhes LIKE '%relatorio:engajados%'`) === '1', 'o CSV do relatório fica no registro')
  await irP('#/registro', 2000)
  await abaP().locator('tbody tr').first().waitFor({ timeout: 10000 })
  const reg = await abaP().locator('tbody').textContent()
  const faltam = ['Exportou', 'Suspendeu conta', 'Reativou conta', 'Renomeou', 'Deu bônus', 'Ocultou carreira', 'Resolveu denúncia', 'Mudou configurações', 'Atualizou o Hall', 'Carreiras em lote', 'Anotou na conta', 'Mudou o tipo de conta', 'Apagou carreira', 'Restaurou carreira'].filter((a) => !reg.includes(a))
  ok(faltam.length === 0, `Registro com as ações${faltam.length ? ` (faltam: ${faltam.join(', ')})` : ''}`)
  ok(/Dono/.test(reg), 'Registro: "quem" é a conta Dono (não "painel")')
  await print(painel, 'v32-e7-registro')
  await irP('#/registro?parte=seguranca', 2000)
  const seg = await abaP().textContent()
  ok(/Errou a senha do painel/.test(seg) && /Errou o PIN/.test(seg) && /Criou o PIN/.test(seg), 'Registro → Segurança: senha errada, PIN errado e PIN criado')
  await print(painel, 'v32-e7-seguranca')
})

await etapa('f8. backup: baixar, guardar no servidor e restaurar o baixado (completar)', async () => {
  await irP('#/config?parte=backup', 2200)
  const [bk] = await Promise.all([painel.waitForEvent('download', { timeout: 30000 }), abaP().locator('button', { hasText: 'Baixar backup' }).click()])
  const nome = bk.suggestedFilename()
  const bruto = readFileSync(await bk.path())
  const json = JSON.parse(gunzipSync(bruto).toString('utf8'))
  const tab = json.tabelas ?? {}
  ok(/^lenda-backup-\d{4}-\d\d-\d\d_\d{4}\.json\.gz$/.test(nome) && json.versao === 1 && (tab.usuarios ?? []).length === 2 && (tab.carreiras ?? []).length >= 6,
    `backup baixado (${nome}): JSON em gzip, ${(tab.usuarios ?? []).length} contas, ${(tab.carreiras ?? []).length} carreiras`)
  const semSegredo = (tab.admin_contas ?? []).length >= 1 && (tab.admin_contas ?? []).every((x) => !('senha_hash' in x) && !('pin_hash' in x)) && !('admin_sessoes' in tab) && !('sessoes_login' in tab)
  ok(semSegredo, 'backup: a equipe sem senha nem PIN; sem sessões')
  ok(sql(`SELECT COUNT(*) FROM admin_log WHERE acao = 'backup'`) === '1', 'o download fica no registro')
  await limparAvisos()
  await abaP().locator('button', { hasText: 'Guardar cópia agora' }).click()
  ok(await avisoPainel(/Cópia guardada/, 30000), '"Guardar cópia agora": cópia no servidor (fora do public_html)')
  // o backup baixado vai para a pasta das cópias (como pelo Gerenciador de Arquivos) e a carreira AMIGAO some da conta do B
  const pasta = `${BASE}/lenda-copias`
  writeFileSync(`${pasta}/${nome}`, bruto, { mode: 0o600 })
  const antes = sql(`SELECT COUNT(*) FROM carreiras WHERE usuario_id=${estado.idB}`)
  // v3.4: as conquistas que a AMIGAO prova na conta do B (apagar tira a prova; restaurar pela cópia devolve)
  const provAmigao = sql(`SELECT GROUP_CONCAT(cu.conquista_id ORDER BY cu.conquista_id) FROM conquistas_usuario cu JOIN carreiras c ON c.id = cu.prova_pk WHERE c.carreira_id='${estado.idAmigao}' AND cu.usuario_id=${estado.idB}`)
  const ap = await B.page.evaluate(async (id) => (await fetch('api/carreiras.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ acao: 'apagar', id }) })).status, estado.idAmigao)
  ok(ap === 200 && sql(`SELECT COUNT(*) FROM carreiras WHERE carreira_id='${estado.idAmigao}'`) === '0', 'B apagou a AMIGAO da conta')
  const provBdepois = provadasDaConta(estado.idB)
  ok(provAmigao === 'NULL' || (Number(sql(`SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id=${estado.idB}`)) >= provAmigao.split(',').length && provAmigao.split(',').every((x) => !provBdepois.has(x))),
    `v3.4: apagada pelo dono, as conquistas ficam na conta, mas sem prova (${provAmigao})`)
  await irP('#/config?parte=backup', 2200)
  const linha = abaP().locator('tbody tr', { hasText: nome })
  await linha.waitFor({ timeout: 10000 })
  await print(painel, 'v32-f8-backup')
  await linha.locator('button', { hasText: 'Restaurar' }).click()
  await dialogo().waitFor()
  ok(/Contas que o próprio jogador excluiu depois desta cópia voltam/.test(await dialogo().textContent()), 'restaurar: o aviso de LGPD')
  ok(await dialogo().locator('button[type=submit]').isDisabled(), 'restaurar: o botão só libera com RESTAURAR digitado')
  await dialogo().locator('.confirmar-digitando input').fill('RESTAURAR')
  await print(painel, 'v32-f8-restaurar-dialogo')
  await limparAvisos()
  await confirmar()
  ok(await avisoPainel(/Cópia restaurada \(completar\): 1 linha gravada \(carreiras 1\)/, 60000), 'restaurar (completar): toast "1 linha gravada (carreiras 1)" e a cópia de antes')
  ok(sql(`SELECT COUNT(*) FROM carreiras WHERE usuario_id=${estado.idB}`) === antes && sql(`SELECT COUNT(*) FROM carreiras WHERE carreira_id='${estado.idAmigao}'`) === '1', 'a AMIGAO voltou pela cópia baixada')
  const provDepois = sql(`SELECT GROUP_CONCAT(cu.conquista_id ORDER BY cu.conquista_id) FROM conquistas_usuario cu JOIN carreiras c ON c.id = cu.prova_pk WHERE c.carreira_id='${estado.idAmigao}' AND cu.usuario_id=${estado.idB}`)
  ok(provDepois === provAmigao, `v3.4: de volta pela cópia, a carreira-prova volta a provar as conquistas da conta (${provDepois})`)
  ok(sql(`SELECT COUNT(*) FROM admin_log WHERE acao = 'backup_restaurar'`) === '1', 'restaurar fica no registro')
})

let MODp = null
await etapa('f9. equipe: moderadora (senha provisória → senha → PIN) e o papel negado em excluir', async () => {
  await irP('#/equipe', 1800)
  await painel.locator('#acoes-aba button', { hasText: 'Pôr alguém' }).click()
  await dialogo().waitFor()
  const campos = dialogo().locator('input')
  await campos.nth(0).fill('Moderadora Bia')
  await campos.nth(1).fill('bia.moderadora@exemplo.com')
  await dialogo().locator('select').selectOption('moderador')
  await confirmar()
  await painel.waitForSelector('dialog[open] .caixa-segredo', { timeout: 10000 })
  const provisoria = (await painel.textContent('dialog[open] .caixa-segredo code')).trim()
  ok(provisoria.length === 14 && !/[0O1lI]/.test(provisoria), 'senha provisória (14, sem 0/O/1/l/I) mostrada uma vez')
  await print(painel, 'v32-f9-senha-provisoria')
  await painel.keyboard.press('Escape')
  const MOD = await novoPainel('MOD')
  estado.idMod = sql("SELECT id FROM admin_contas WHERE email = 'bia.moderadora@exemplo.com'")
  await MOD.page.goto(PAINEL)
  await MOD.page.waitForSelector('#form-entrar:not([hidden])')
  ok(await MOD.page.isVisible('#campo-email'), 'com conta pessoal na equipe, a entrada mostra o campo E-mail (modo contas)')
  await entrarPainel(MOD.page, { email: 'bia.moderadora@exemplo.com', senha: provisoria })
  await MOD.page.waitForSelector('#form-trocar-senha:not([hidden])', { timeout: 10000 })
  await MOD.page.fill('#nova-senha', SENHA_MOD)
  await MOD.page.fill('#nova-senha-2', SENHA_MOD)
  await MOD.page.click('#botao-trocar')
  await MOD.page.waitForSelector('#form-criar-pin:not([hidden])', { timeout: 10000 })
  await digitarPin(MOD.page, '#pin-novo', PIN_MOD)
  await digitarPin(MOD.page, '#pin-repetir', PIN_MOD)
  await MOD.page.click('#botao-criar-pin')
  await MOD.page.waitForSelector('#tela-painel:not([hidden])', { timeout: 15000 })
  ok(true, 'moderadora: provisória → senha nova → PIN → painel')
  await irP(`#/usuarios?conta=${estado.idA}`, 1800, MOD.page)
  await MOD.page.waitForSelector('#gaveta:not([hidden]) .perfil-nome h2', { timeout: 10000 })
  ok((await naFicha(MOD.page, 'Excluir conta').count()) === 0 && (await naFicha(MOD.page, 'Suspender').count()) === 0, 'moderadora: sem "Excluir conta" nem "Suspender" na ficha')
  const neg = await MOD.page.evaluate(async (id) => {
    const r = await fetch('../api/admin.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'excluir_usuario', id, confirma: 'Ian Cruzeiro', motivo: 'outro' }) })
    return `${r.status}:${(await r.json()).erro}`
  }, Number(estado.idA))
  ok(neg === '403:sem_poder', `moderadora: excluir_usuario → ${neg}`)
  ok(sql(`SELECT COUNT(*) FROM usuarios WHERE id=${estado.idA}`) === '1' && sql(`SELECT COUNT(*) FROM admin_log WHERE acao = 'negado' AND alvo = 'excluir_usuario' AND quem = 'a${estado.idMod}'`) === '1', 'a conta continua e o "negado" fica no registro com quem tentou')
  ok((await MOD.page.locator('.abas a.trancada[data-aba="equipe"]').count()) === 1, 'moderadora: Equipe com cadeado')
  await print(MOD.page, 'v32-f9-moderadora-ficha')
  MOD.erros.splice(0, MOD.erros.length, ...MOD.erros.filter((x) => !/status of 403/.test(x)))
  MODp = MOD.page
})

await etapa('f10. celular: o painel sem rolagem lateral em todas as abas; a sessão revogada para de valer', async () => {
  const CEL = await novoPainel('ADM-celular', { viewport: { width: 390, height: 844 }, celular: true })
  await entrarPainel(CEL.page, { senha: env.PAINEL_SENHA, pin: PIN_DONO })
  await CEL.page.waitForSelector('#tela-painel:not([hidden])', { timeout: 15000 })
  const ABAS = ['visao', 'area', 'usuarios', 'mensagens', 'hall', 'denuncias', 'indicacoes', 'desafios', 'conquistas', 'relatorios', 'tempo', 'registro', 'saude', 'equipe', 'config', 'testes']
  const largas = []
  for (const a of ABAS) {
    await irP(`#/${a}`, 1500, CEL.page)
    const w = await semRolagem(CEL.page)
    if (w[0] > w[1]) largas.push(`${a} ${w[0]}>${w[1]}`)
    if (['visao', 'hall', 'usuarios', 'registro', 'config'].includes(a)) await print(CEL.page, `v32-f10-celular-${a}`)
  }
  ok(largas.length === 0, `celular: nenhuma das ${ABAS.length} abas rola para o lado${largas.length ? ` (${largas.join(', ')})` : ''}`)
  await irP(`#/usuarios?conta=${estado.idB}`, 1800, CEL.page)
  ok((await CEL.page.evaluate(() => document.getElementById('gaveta').getBoundingClientRect().width)) >= 389, 'celular: a ficha ocupa a tela toda')
  await print(CEL.page, 'v32-f10-celular-ficha')
  // a sessão do celular é encerrada pela Minha conta do computador ("Sair de todos os outros")
  await irP('#/config?parte=conta', 1800)
  await limparAvisos()
  await abaP().locator('button', { hasText: 'Sair de todos os outros' }).click()
  ok(await avisoPainel(/sess(ão|ões) encerrada/), 'Minha conta: "Sair de todos os outros"')
  const st = await CEL.page.evaluate(async () => (await fetch('../api/admin.php?r=resumo', { credentials: 'same-origin' })).status)
  ok(st === 401, `o celular revogado: admin.php → ${st}`)
  await irP('#/hall', 2000, CEL.page)
  await CEL.page.waitForSelector('#form-entrar:not([hidden])', { timeout: 20000 }).catch(() => {})
  ok(await CEL.page.isVisible('#form-entrar'), 'o celular revogado volta para a entrada')
  ok((await admin(null, { r: 'resumo' })).status === 200 && (await painel.evaluate(async () => (await fetch('../api/admin.php?r=resumo', { credentials: 'same-origin' })).status)) === 200, 'o computador (a sessão que pediu) continua valendo')
  await CEL.ctx.close()
})

await etapa('f11. aparência: tema claro (e de volta ao original)', async () => {
  await irP('#/visao', 1200)
  await painel.keyboard.press('t')
  ok((await painel.getAttribute('html', 'data-tema')) === 'claro', 'atalho T: tema Claro')
  await sleep(600)
  await print(painel, 'v32-f11-tema-claro-visao', { fullPage: true })
  await irP(`#/usuarios?conta=${estado.idA}`, 1800)
  await print(painel, 'v32-f11-tema-claro-ficha')
  await painel.reload()
  await painel.waitForSelector('#tela-painel:not([hidden])', { timeout: 15000 })
  ok((await painel.getAttribute('html', 'data-tema')) === 'claro', 'o tema fica depois de recarregar')
  await painel.keyboard.press('Escape')
  await painel.keyboard.press('t')
  await painel.keyboard.press('t')
  ok((await painel.getAttribute('html', 'data-tema')) === null, 'T de novo: Alto contraste → Original')
})

// ───────────────────────── g. v3.3: Fale conosco, desafios, verificação por replay, perfil público ─────────────────────────
// Uma carreira REAL de fila (scripts/gravar/filas/classico.json, v-otima-04: Normal, brasileiro centroavante, 12
// decisões) jogada pela tela com a semente da fila: 1 Copa do Mundo e 2 Libertadores. O desafio de teste pede isso.
const FILA = JSON.parse(readFileSync(new URL('../../../scripts/gravar/filas/classico.json', import.meta.url), 'utf8')).find((f) => f.nome === 'v-otima-04')
const EMAIL_R = `rei${Date.now()}@exemplo.com`
const EMAIL_VIS = `visitante${Date.now()}@exemplo.com`
const APELIDO_R = 'Rei do Teste'
const PREMIO = 'Camisa oficial do LENDA autografada (prêmio de teste)'
const TITULO_D = 'Taças do Rei (teste)'
const desafiosApi = async (q = '') => (await fetch(`${URL0}api/desafios.php${q}`)).json()
const meuDesafio = (page) => page.evaluate(async () => (await (await fetch('api/desafios.php?eu=1', { credentials: 'same-origin' })).json()).desafios ?? [])
const tacas = (h, id) => (h?.summary?.trophies ?? []).find((t) => t.trophyId === id)?.count ?? 0
const salvarPelaApi = (page, h) =>
  page.evaluate(async (h) => {
    const r = await fetch('api/carreiras.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ acao: 'salvar', carreira: h, como: 'manual' }) })
    return { status: r.status, json: await r.json().catch(() => null) }
  }, h)
/**
 * HallEntry com taças a mais: +1 Copa do Mundo e +2 Libertadores sobre o que a carreira teve (cumpre o critério do
 * desafio de teste e sempre difere do que o replay refaz); o replay continua o da carreira de verdade.
 */
function comTacasAMais(h) {
  const x = structuredClone(h)
  const c = tacas(h, 'world-cup') + 1
  const l = tacas(h, 'libertadores') + 2
  x.summary.trophies = (x.summary.trophies ?? []).filter((t) => t.trophyId !== 'world-cup' && t.trophyId !== 'libertadores')
  x.summary.trophies.push({ trophyId: 'world-cup', count: c, seasons: [2034, 2038, 2042].slice(0, c) }, { trophyId: 'libertadores', count: l, seasons: [2029, 2031, 2033, 2035, 2037].slice(0, l) })
  return x
}
const pkDe = (carreiraId, uid) => sql(`SELECT id FROM carreiras WHERE carreira_id='${carreiraId}' AND usuario_id=${uid}`)

const SLUGS_EMBLEMA = ['noite-de-gala', 'andarilho-campeao', 'bandeira-do-clube', 'hexa-e-gloria-eterna', 'era-de-ouro', 'artilheiro-do-mundo', 'bi-do-mundo-bi-da-america', 'imortal', 'tacas-do-rei-emblema', 'mil-gols-e-o-tri']
const desafiosDePremio = (lista) => (lista ?? []).filter((d) => d.modo !== 'emblema')
await etapa('g1. v3.3/v3.4: os 3 desafios de prêmio desativados; os 10 de emblema valendo (a faixa da tela inicial); sem desafio, a faixa some', async () => {
  const r = await desafiosApi()
  ok(Array.isArray(r.desafios) && desafiosDePremio(r.desafios).length === 0, `desafios.php: nenhum desafio de prêmio (${JSON.stringify(desafiosDePremio(r.desafios)).slice(0, 120)})`)
  ok(sql("SELECT GROUP_CONCAT(CONCAT(slug, ':', ativo, ':', premio = '') ORDER BY ordem) FROM desafios WHERE modo = 'primeiro'") === 'tacas-do-rei:0:1,tacas-do-rei-copas:0:1,todas-as-conquistas:0:1',
    'banco: tacas-do-rei, tacas-do-rei-copas e todas-as-conquistas desativados e com o prêmio vazio')
  ok(sql("SELECT CONCAT_WS('|', criterio, requisitos) FROM desafios WHERE slug='tacas-do-rei'") === '{"copas":3,"libertadores":2}|{"partidasMin":30,"emailVerificado":true,"publicadoNoHall":true,"top3Perfil":true}',
    'tacas-do-rei: 3 Copas + 2 Libertadores, 30 partidas, e-mail confirmado, no Hall e entre as 3 do perfil')
  // v3.4: os 10 de emblema de fábrica, ativos, com a dificuldade, o emblema e os 3 da faixa
  const emb = r.desafios.filter((d) => d.modo === 'emblema')
  ok(emb.length === 10 && SLUGS_EMBLEMA.every((s) => emb.some((d) => d.slug === s)) && emb.every((d) => d.ativo && d.vencedor === null && d.emblema?.icone && /^#[0-9a-f]{6}$/.test(d.emblema?.cor ?? '')),
    `v3.4: desafios.php com os 10 de emblema valendo (${emb.map((d) => `${d.slug}:${d.dificuldade}`).join(', ')})`)
  ok(JSON.stringify(emb.filter((d) => d.home).map((d) => d.slug).sort()) === JSON.stringify(['hexa-e-gloria-eterna', 'noite-de-gala', 'tacas-do-rei-emblema'])
    && ['facil', 'medio', 'dificil', 'lendario'].every((x) => emb.some((d) => d.dificuldade === x)), 'v3.4: os 3 da faixa (home) e as 4 dificuldades')
  ok(sql("SELECT CONCAT_WS('|', COUNT(*), SUM(ativo), SUM(requisitos = '{\"partidasMin\":0,\"emailVerificado\":false,\"publicadoNoHall\":false,\"top3Perfil\":false}')) FROM desafios WHERE modo = 'emblema'") === '10|10|10',
    'v3.4: banco: 10 de emblema, ativos, sem requisito de conta')
  // a faixa (aparelho novo: sem o cache de 60 s da lista)
  const F = await novo('F', { partidas: 0 })
  await F.page.goto(`${URL0}#/`)
  await F.page.waitForSelector('.ld-modes', { timeout: 30000 })
  const faixa = F.page.locator('.s4-faixa')
  await faixa.waitFor({ timeout: 20000 }) // pedida depois de a tela pintar (1,8 s + ocioso)
  const inteiros = await faixa.locator('.s4-faixa__d').evaluateAll((l) => {
    const caixa = l[0]?.parentElement?.getBoundingClientRect()
    return caixa ? l.filter((e) => e.getBoundingClientRect().bottom <= caixa.bottom + 1).map((e) => e.getAttribute('title')) : []
  })
  const alt = (await faixa.boundingBox())?.height ?? 0
  ok(inteiros.length >= 2 && inteiros.length <= 3 && inteiros[0] === 'Noite de gala' && alt <= 48, `v3.4: tela inicial com a faixa discreta (uma linha de ${Math.round(alt)} px): ${inteiros.join(' · ')} · Ver todos`)
  ok((await F.page.locator('.sv-destaque').count()) === 0, 'v3.4: sem desafio de prêmio valendo: nada do destaque grande')
  ok(!(await faixa.locator('.s4-faixa__n').evaluateAll((l) => l.some((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1))), 'v3.4: nenhum nome cortado na faixa')
  await print(F.page, 'g1-F-home-faixa')
  const m = await menu(F.page)
  await m.getByRole('button', { name: /Fale conosco/ }).waitFor({ timeout: 10000 }) // as linhas da v3.3 chegam num pedaço à parte
  await m.getByText(/10 desafios valendo/).first().waitFor({ timeout: 10000 }).catch(() => {})
  ok((await m.locator('.sc-row--cta', { hasText: 'Desafio valendo' }).count()) === 0 && /10 desafios valendo/.test(await m.innerText()), 'menu: sem a linha do desafio de prêmio; a linha discreta "Desafios · 10 desafios valendo"')
  await fecharMenu(F.page)
  await faixa.locator('.s4-faixa__todos').click()
  await F.page.waitForFunction(() => location.hash.startsWith('#/desafios'), null, { timeout: 10000 })
  await F.page.locator('.s4-emb').first().waitFor({ timeout: 15000 })
  const tx = await F.page.locator('.s4-embs').innerText()
  ok((await F.page.locator('.s4-emb').count()) === 10 && /Fácil/i.test(tx) && /Lendário/i.test(tx) && /~1 em 12 carreiras/.test(tx), '"Ver todos" → #/desafios: os 10 de emblema, com a dificuldade e a chance')
  ok((await F.page.getByRole('button', { name: 'Criar conta para ganhar' }).count()) === 1 && (await F.page.locator('.sv-desafio').count()) === 0, 'sem conta: "Criar conta para ganhar"; nenhum desafio de prêmio')
  await print(F.page, 'g1-F-desafios-emblemas', { fullPage: true })
  // sem desafio nenhum valendo, a faixa some (o admin desliga os 10 e depois religa)
  const ids = sql("SELECT GROUP_CONCAT(id) FROM desafios WHERE modo = 'emblema' AND ativo = 1").split(',').map(Number)
  for (const id of ids) await admin({ acao: 'desafio_ativar', id, ativo: false })
  ok(desafiosDePremio((await desafiosApi()).desafios).length === 0 && (await desafiosApi()).desafios.length === 0, 'desligados os 10: desafios.php vazio')
  const { page } = await novo('F2', { partidas: 0 })
  await page.goto(`${URL0}#/`)
  await page.waitForSelector('.ld-modes', { timeout: 30000 })
  await sleep(4500) // a faixa e o destaque só são pedidos depois de a tela pintar (1,8 s + ocioso)
  ok((await page.locator('.s4-faixa').count()) === 0 && (await page.locator('.sv-destaque').count()) === 0, 'tela inicial sem desafio: sem a faixa e sem o destaque')
  const m2 = await menu(page)
  await m2.getByRole('button', { name: /Fale conosco/ }).waitFor({ timeout: 10000 })
  await sleep(500)
  ok(!/desafios? valendo/i.test(await m2.innerText()) && (await m2.getByRole('button', { name: /Fale conosco/ }).count()) === 1, 'menu: sem a linha de desafio, com "Fale conosco"')
  await fecharMenu(page)
  await page.goto(`${URL0}#/desafios`)
  await esperarTexto(page, 'Nenhum desafio valendo agora', 20000)
  ok(true, '#/desafios: "Nenhum desafio valendo agora"')
  await print(page, 'g1-C-desafios-vazio')
  let novos = 0
  for (const id of ids) novos += (await admin({ acao: 'desafio_ativar', id, ativo: true })).json?.emblemasNovos ?? 0
  estado.emblemasReativar = novos
  ok((await desafiosApi()).desafios.filter((d) => d.modo === 'emblema').length === 10, `religados os 10 (o lote deu ${novos} emblemas às contas que já cumpriam)`)
})

await etapa('g2. v3.3: Fale conosco sem conta (C) e com conta (A)', async () => {
  const { page } = C
  await page.goto(`${URL0}#/hall`)
  await page.locator('.hl-filtros').waitFor({ timeout: 20000 })
  const m = await menu(page)
  await m.getByRole('button', { name: /Fale conosco/ }).click()
  const d = page.getByRole('dialog', { name: 'Fale conosco' })
  await d.waitFor({ timeout: 10000 })
  ok(await d.locator('a[href="mailto:contato@lenda.portalmultipla.online"]').isVisible(), 'Fale conosco: o e-mail contato@oprojeto.online aparece')
  await d.locator('.sv-tipo', { hasText: 'Ideia' }).click()
  await d.locator('textarea').fill('Coloquem a Série C do Brasileirão, por favor! <b>obrigado</b>')
  await d.getByRole('button', { name: 'Enviar mensagem' }).click()
  ok(await d.getByText('Confira o seu e-mail').first().isVisible().catch(() => false), 'sem conta: o e-mail é obrigatório (erro no campo, nada enviado)')
  await d.getByLabel('Seu e-mail').fill(EMAIL_VIS)
  await print(page, 'g2-C-fale-conosco')
  await d.getByRole('button', { name: 'Enviar mensagem' }).click()
  await d.getByText('Mensagem enviada').first().waitFor({ timeout: 15000 })
  estado.protC = (await d.locator('.sv-protocolo').innerText()).trim()
  const lc = sql(`SELECT CONCAT_WS('|', tipo, IFNULL(usuario_id, '-'), email, pagina, status) FROM mensagens_suporte WHERE protocolo='${estado.protC}'`)
  ok(lc === `ideia|-|${EMAIL_VIS}|/hall|nova`, `sem conta: gravada com o e-mail deixado e a tela de onde veio (${estado.protC}: ${lc})`)
  await print(page, 'g2-C-fale-conosco-enviada')
  await page.keyboard.press('Escape')
  // com conta: Minha conta → "Mandar dúvida, ideia ou problema" (o e-mail é o da conta)
  const { page: pa } = A
  await pa.goto(`${URL0}#/`)
  await pa.waitForSelector('.ld-modes', { timeout: 30000 })
  const ma = await menu(pa)
  await ma.getByText(/Minha conta/).first().click()
  const mc = pa.getByRole('dialog', { name: 'Minha conta' })
  await mc.waitFor({ timeout: 15000 })
  await mc.getByRole('button', { name: 'Mandar dúvida, ideia ou problema' }).click()
  const da = pa.getByRole('dialog', { name: 'Fale conosco' })
  await da.waitFor({ timeout: 10000 })
  ok((await da.getByLabel('Seu e-mail').count()) === 0, 'com conta: o formulário não pede o e-mail')
  await da.locator('.sv-tipo', { hasText: 'Dúvida' }).click()
  await da.locator('textarea').fill('Como faço para a minha carreira aparecer no meu perfil público?')
  await da.getByRole('button', { name: 'Enviar mensagem' }).click()
  await da.getByText('Mensagem enviada').first().waitFor({ timeout: 15000 })
  estado.protA = (await da.locator('.sv-protocolo').innerText()).trim()
  const la = sql(`SELECT CONCAT_WS('|', tipo, usuario_id, IFNULL(email, '-'), status) FROM mensagens_suporte WHERE protocolo='${estado.protA}'`)
  ok(la === `duvida|${estado.idA}|-|nova`, `com conta: gravada na conta do A, sem e-mail na linha (${la})`)
  await print(pa, 'g2-A-fale-conosco-enviada')
  await pa.keyboard.press('Escape')
})

await etapa('g3. v3.3: painel → Mensagens: as duas chegam; abrir marca como lida; responder manda o e-mail', async () => {
  await irP('#/visao', 800)
  await painel.waitForFunction(() => Number((document.getElementById('nav-mensagensNovas')?.textContent ?? '').trim()) >= 2, null, { timeout: 30000 }).catch(() => {})
  ok(Number((await painel.textContent('#nav-mensagensNovas')).trim()) >= 2, `pulso: "Mensagens novas" = ${(await painel.textContent('#nav-mensagensNovas')).trim()}`)
  await irP('#/mensagens', 2000)
  await abaP().locator('tbody tr').first().waitFor({ timeout: 10000 })
  const lista = await abaP().locator('tbody').innerText()
  ok(lista.includes(estado.protC) && lista.includes(estado.protA) && /Ian Cruzeiro/.test(lista), 'Mensagens: a do visitante (sem conta) e a do A (com o apelido)')
  ok((await abaP().locator('tbody b', { hasText: /^obrigado$/ }).count()) === 0, 'o HTML do jogador aparece como texto')
  await print(painel, 'g3-painel-mensagens')
  const idC = sql(`SELECT id FROM mensagens_suporte WHERE protocolo='${estado.protC}'`)
  await abaP().locator(`tbody tr[data-id="${idC}"]`).click()
  await painel.waitForSelector('#gaveta:not([hidden]) .msg-texto', { timeout: 10000 })
  ok((await esperarSql(`SELECT status FROM mensagens_suporte WHERE id=${idC}`, (x) => x === 'lida')) === 'lida', 'abrir a mensagem nova marca como lida')
  const antes = emailsPara(EMAIL_VIS).length
  await painel.fill('#gaveta textarea', 'Oi! Anotamos a sua ideia da Série C. Obrigado por jogar o LENDA.')
  await painel.locator('#gaveta button', { hasText: 'Responder por e-mail' }).click()
  await painel.waitForSelector('dialog[open] .previa-email', { timeout: 10000 })
  ok((await painel.textContent('dialog[open] .previa-email')).includes(estado.protC), 'prévia do e-mail com o protocolo e a mensagem citada')
  await print(painel, 'g3-painel-resposta-previa')
  await limparAvisos()
  await confirmar()
  ok(await avisoPainel(/Resposta mandada/), 'resposta mandada (toast)')
  const r = await esperarSql(`SELECT CONCAT_WS('|', status, resposta LIKE '%Série C%', respondida_em IS NOT NULL) FROM mensagens_suporte WHERE id=${idC}`, (x) => x.startsWith('respondida'))
  ok(r === 'respondida|1|1', `no banco: respondida, com a resposta guardada (${r})`)
  const em = emailsPara(EMAIL_VIS)
  ok(em.length === antes + 1 && em[0].txt.includes('Série C') && em[0].txt.includes(estado.protC), 'o e-mail foi para o endereço que o visitante deixou, com a resposta e o protocolo')
  ok(sql("SELECT COUNT(*) FROM email_log WHERE tipo='suporte'") === '1' && !sql("SELECT detalhes FROM admin_log WHERE acao='suporte_responder' ORDER BY id DESC LIMIT 1").includes('Série C'), 'email_log tipo suporte; o Registro sem o texto da resposta')
  await painel.keyboard.press('Escape')
})

await etapa('g4. v3.3: painel → Desafios: cria o desafio de teste (1 Copa + 2 Libertadores, 2 partidas) e ativa', async () => {
  await irP('#/desafios', 2000)
  // v3.4 (CONTRATO-v34 §A.14 e §C.6 #2): 13 cartões — os 3 de prêmio de fábrica (desativados) e os 10 de emblema (valendo)
  ok((await abaP().locator('article.cartao-desafio').count()) === 13 && (await abaP().locator('article.cartao-desafio[data-modo="primeiro"]').count()) === 3,
    'Desafios: os 3 de prêmio de fábrica (desativados) e os 10 de emblema (v3.4)')
  await irP('#/desafios?parte=novo', 1800)
  await painel.fill('#dz-titulo', TITULO_D)
  ok((await painel.inputValue('#dz-slug')) === 'tacas-do-rei-teste', 'o endereço sai do título (tacas-do-rei-teste)')
  await painel.fill('#dz-descricao', 'O primeiro a terminar uma carreira com 1 Copa do Mundo e 2 Libertadores (desafio de teste).')
  await painel.fill('#dz-copas', '1')
  await painel.fill('#dz-libertadores', '2')
  await painel.fill('#dz-partidasMin', '2')
  await painel.fill('#dz-premio', PREMIO)
  await sleep(400)
  ok(/1 Copa do Mundo/.test(await painel.textContent('.previa-desafio')) && /2 Libertadores/.test(await painel.textContent('.previa-desafio')), 'prévia com o critério')
  await print(painel, 'g4-painel-desafio-novo')
  await abaP().locator('.barra-salvar button', { hasText: 'Criar desafio' }).click()
  await dialogo().waitFor()
  await limparAvisos()
  await confirmar()
  ok(await avisoPainel(/criado/), 'desafio criado (toast)')
  await sleep(1200)
  estado.idDesafio = sql("SELECT id FROM desafios WHERE slug='tacas-do-rei-teste'")
  const l = sql(`SELECT CONCAT_WS('|', ativo, criterio, requisitos, premio, regulamento LIKE '1. Vale a primeira conta%') FROM desafios WHERE id=${estado.idDesafio}`)
  ok(l === `0|{"copas":1,"libertadores":2}|{"partidasMin":2,"emailVerificado":true,"publicadoNoHall":true,"top3Perfil":true}|${PREMIO}|1`, `no banco: desativado, o critério, os requisitos, o prêmio (texto do admin) e o regulamento de partida (${l})`)
  ok(!(await desafiosApi()).desafios.some((d) => d.slug === 'tacas-do-rei-teste'), 'desativado: o público ainda não vê')
  await irP('#/desafios', 2000)
  await abaP().locator(`article.cartao-desafio[data-id="${estado.idDesafio}"] button`, { hasText: 'Ativar' }).click()
  await dialogo().waitFor()
  ok(/começa agora/.test(await dialogo().textContent()), 'ativar: avisa que começa agora')
  await limparAvisos()
  await confirmar()
  ok(await avisoPainel(/ativado/), 'ativado (toast)')
  ok(sql(`SELECT CONCAT(ativo, IF(inicio IS NULL, '-', '+')) FROM desafios WHERE id=${estado.idDesafio}`) === '1+', 'no banco: ativo, com o início gravado na ativação')
  const pub = desafiosDePremio((await desafiosApi()).desafios)
  ok(pub.length === 1 && pub[0].slug === 'tacas-do-rei-teste' && pub[0].modo === 'primeiro' && pub[0].premio === PREMIO && pub[0].vencedor === null && pub[0].ativo === true, `desafios.php: de prêmio, só o de teste (os 3 de fábrica continuam fora) (${pub.map((x) => x.slug).join(',')})`)
  await print(painel, 'g4-painel-desafios-ativo')
})

const V = await novo('V', { partidas: 0 })
await etapa('g5. v3.3: público com desafio valendo: destaque, menu e #/desafios (regras, prêmio, regulamento)', async () => {
  const { page } = V
  await page.goto(`${URL0}#/`)
  await page.waitForSelector('.sv-destaque', { timeout: 30000 })
  const t = await page.locator('.sv-destaque').innerText()
  ok(t.includes(TITULO_D) && t.includes(PREMIO), `tela inicial: o destaque com o título e o prêmio (${t.replace(/\s+/g, ' ').slice(0, 140)})`)
  await sleep(800)
  ok((await page.locator('.s4-faixa').count()) === 0, 'v3.4: com um desafio de prêmio valendo, o destaque dele no lugar da faixa dos emblemas (nunca os dois)')
  await print(page, 'g5-V-destaque')
  const m = await menu(page)
  ok(await m.locator('.sc-row--cta', { hasText: TITULO_D }).waitFor({ timeout: 10000 }).then(() => true, () => false), 'menu: a linha do desafio valendo')
  await fecharMenu(page)
  await page.locator('.sv-destaque').click()
  await page.waitForSelector('.sv-desafio', { timeout: 15000 })
  const card = await page.locator('.sv-desafio').first().innerText()
  ok(/Valendo/.test(card) && card.includes(PREMIO) && card.includes('1 Copa do Mundo e 2 Libertadores numa mesma carreira'), '#/desafios: selo "Valendo", prêmio e critério')
  ok(card.includes('2 partidas jogadas com a conta') && /e-mail confirmado/.test(card) && /Hall das Lendas/.test(card) && /3 do seu perfil/.test(card), '#/desafios sem conta: os 4 requisitos')
  await page.locator('.sv-regul summary').click()
  ok((await page.locator('.sv-regul__t').innerText()).includes('Vale a primeira conta'), 'regulamento (o de partida que o servidor escreveu) abre')
  ok(await page.getByRole('button', { name: 'Criar conta para participar' }).isVisible(), '"Criar conta para participar"')
  await print(page, 'g5-V-desafios', { fullPage: true })
})

const R = await novo('R', { partidas: 0 })
await etapa('g6. v3.3: R cria a conta pelo desafio ("Depois" no código) e joga pela tela a carreira real da fila', async () => {
  const { page } = R
  await page.goto(`${URL0}#/desafios`)
  await page.getByRole('button', { name: 'Criar conta para participar' }).click()
  const d = page.locator('[role="dialog"].sc-modal')
  await d.waitFor()
  await preencherConta(page, d, [['Apelido', APELIDO_R], ['E-mail', EMAIL_R], ['Senha', SENHA, true]])
  await d.getByRole('checkbox').first().check()
  await d.getByRole('button', { name: 'Criar conta', exact: true }).click()
  const dv = page.locator('[role="dialog"].sc-modal', { hasText: 'Confirme seu e-mail' })
  await dv.waitFor({ timeout: 20000 })
  await dv.getByRole('button', { name: 'Depois', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[role="dialog"].sc-modal'), null, { timeout: 20000 })
  estado.idR = idUsuario(EMAIL_R)
  estado.codigoR = sql(`SELECT codigo_convite FROM usuarios WHERE id=${estado.idR}`)
  ok(/^\d+$/.test(estado.idR), `conta do R criada (${estado.idR}), e-mail ainda sem confirmar`)
  // 1ª partida com a conta (uma carreira qualquer, a 1ª opção sempre)
  const provR0 = provadasDaConta(estado.idR)
  const r1 = await jogarCarreira(page, { semente: [2001, 333], nacao: 'Brasil', sobrenome: 'REIZINHO' })
  ok(r1.fim, `R: 1ª carreira até o fim (${Math.round(r1.ms / 1000)} s)`)
  ok((await esperarSql(`SELECT partidas_conta FROM usuarios WHERE id=${estado.idR}`, (x) => x === '1', 30000)) === '1', 'servidor: 1 partida com a conta')
  await sleep(1000)
  estado.hallQ = await ultimaTerminada(page)
  ok(!!estado.hallQ?.replay && estado.hallQ.replay.seed[0] === 2001 && estado.hallQ.replay.seed[1] === 333, 'a carreira jogada pela tela tem o replay com a semente [a0, a1]')
  // v3.4: carreira-prova com conquistas que a conta ainda não tem provadas → sobe sozinha (sem nenhuma, fica no aparelho)
  const novasQ = conquistasDe(estado.hallQ).filter((x) => !provR0.has(x))
  if (novasQ.length || estado.hallQ.summary.peakOvr >= 90) {
    const como = await esperarSql(`SELECT como FROM carreiras WHERE carreira_id='${estado.hallQ.id}' AND usuario_id=${estado.idR}`, (x) => x !== '', 30000)
    ok(como === 'auto', `v3.4: a 1ª carreira do R (pico ${estado.hallQ.summary.peakOvr}) subiu sozinha como prova de ${novasQ.length} conquistas (${como})`)
  }
  // a carreira REAL da fila, pelos cliques (o mesmo cartão de cada decisão)
  const provR1 = provadasDaConta(estado.idR)
  const r2 = await jogarFila(page, FILA, { nacao: 'Brasil' })
  ok(r2.fim && r2.escolhas === FILA.picks.length, `R: a carreira da fila ${FILA.nome} jogada pela tela até o fim (${r2.escolhas} de ${FILA.picks.length} escolhas, ${Math.round(r2.ms / 1000)} s)`)
  await sleep(1200)
  const h = await ultimaTerminada(page)
  estado.hallG = h
  const sem36 = `career-${FILA.a0.toString(36)}${FILA.a1.toString(36)}`
  ok(h.id === sem36 && h.replay?.seed?.[0] === FILA.a0 && h.replay?.seed?.[1] === FILA.a1, `HallEntry career-<semente da fila> com o replay da semente (${h.id})`)
  ok(JSON.stringify(h.replay.picks.map((p) => [p.id, p.idx, p.n])) === JSON.stringify(FILA.picks.map((p) => [p.id, p.idx, p.n])), 'o replay gravado tem as mesmas escolhas da fila (id, cartão e nº de opções)')
  ok(tacas(h, 'world-cup') === 1 && tacas(h, 'libertadores') === 2 && h.summary.peakOvr === 86, `a carreira cumpre o critério: ${tacas(h, 'world-cup')} Copa, ${tacas(h, 'libertadores')} Libertadores, pico ${h.summary.peakOvr}`)
  ok((await esperarSql(`SELECT partidas_conta FROM usuarios WHERE id=${estado.idR}`, (x) => x === '2', 30000)) === '2', 'servidor: 2 partidas com a conta (o mínimo do desafio de teste)')
  await print(page, 'g6-R-fim-da-fila')
  // v3.4: prova conquista nova da conta → sobe sozinha; senão o botão
  const fimG = await fimDaCarreira(page, h, estado.idR, provR1)
  ok(fimG.como === (fimG.auto ? 'auto' : 'manual'), `a carreira da fila foi para a conta: ${fimG.auto ? `sozinha, como prova de ${fimG.novas.length} conquistas novas` : 'pelo botão'} (${fimG.como})`)
  estado.pkG = pkDe(h.id, estado.idR)
  const l = sql(`SELECT CONCAT_WS('|', tem_replay, copas, libertadores, IFNULL(fora_desafio, '-'), primeira_em >= (SELECT inicio FROM desafios WHERE id=${estado.idDesafio})) FROM carreiras WHERE id=${estado.pkG}`)
  ok(l === '1|1|2|-|1', `servidor: tem_replay, 1 Copa, 2 Libertadores, dentro do limite do dia, salva depois do início (${l})`)
  ok(sql(`SELECT COUNT(*) FROM desafio_candidatos WHERE usuario_id=${estado.idR}`) === '0', 'sem o e-mail confirmado: ainda não é candidato')
})

await etapa('g7. v3.3: checklist em #/desafios (falta o e-mail) → "Confirmar" com o código → candidato "Em verificação"', async () => {
  const { page } = R
  await page.goto(`${URL0}#/desafios`)
  await page.reload()
  await page.locator('.sv-item.is-falta', { hasText: 'E-mail da conta confirmado' }).waitFor({ timeout: 20000 })
  const t = await page.locator('.sv-desafio').first().innerText()
  ok(t.includes(FILA.identity.surname) && /Partidas com a conta: 2 de 2/.test(t), `checklist: a carreira ${FILA.identity.surname} cumpre o critério e 2 de 2 partidas`)
  ok((await page.locator('.sv-desafio .sv-item.is-ok').count()) >= 4 && (await page.locator('.sv-cand-meu').count()) === 0, 'checklist: critério, partidas, Hall e perfil ok; falta só o e-mail; sem candidatura')
  await print(page, 'g7-R-checklist-falta-email', { fullPage: true })
  const t0 = Date.now() - 1000
  await page.locator('.sv-item.is-falta', { hasText: 'E-mail da conta confirmado' }).getByRole('button', { name: 'Confirmar' }).click()
  const dv = page.locator('[role="dialog"].sc-modal', { hasText: 'Confirme seu e-mail' })
  await dv.waitFor({ timeout: 10000 })
  const codigo = await codigoDoEmail(EMAIL_R, 0)
  ok(/^\d{6}$/.test(codigo ?? ''), `o código do cadastro, lido do e-mail (${codigo})`)
  await dv.getByLabel('Código de 6 dígitos').fill(codigo ?? '')
  await dv.getByRole('button', { name: 'Confirmar e-mail' }).click()
  await page.getByText('E-mail confirmado', { exact: true }).first().waitFor({ timeout: 15000 })
  ok(true, 'toast "E-mail confirmado"')
  const k = await esperarSql(`SELECT CONCAT_WS('|', id, estado, carreira_pk) FROM desafio_candidatos WHERE desafio_id=${estado.idDesafio} AND usuario_id=${estado.idR}`, (x) => x !== '', 15000)
  const [kid, kest, kpk] = k.split('|')
  estado.candG = kid
  ok(kest === 'pendente' && kpk === estado.pkG, `confirmar o e-mail avaliou a conta: candidato pendente da carreira ${FILA.identity.surname} (${k})`)
  ok(/\.\d{3}$/.test(sql(`SELECT em FROM desafio_candidatos WHERE id=${kid}`)) && Date.now() - t0 < 120000, 'o "em" do candidato (hora do servidor) tem milésimos')
  // o checklist vem de novo sozinho depois de confirmar (sem recarregar a tela)
  await page.locator('.sv-cand-meu.is-pendente').waitFor({ timeout: 15000 })
  ok(/Em verificação/.test(await page.locator('.sv-cand-meu').innerText()), 'checklist: "Em verificação" logo depois de confirmar, sem recarregar')
  await print(page, 'g7-R-em-verificacao', { fullPage: true })
})

await etapa('g8. v3.3: HallEntry adulterada pela API: sem replay não vira candidata; com replay e taças a mais vira (e vai ser reprovada)', async () => {
  const { page } = R
  // (a) a carreira da fila com outro id e sem o replay
  const a = structuredClone(estado.hallG)
  a.id = `career-forjada-sem-replay-${Date.now()}`
  if (a.career) a.career.id = a.id
  a.summary.e2e = a.id
  delete a.replay
  const ra = await salvarPelaApi(page, a)
  const pkA = pkDe(a.id, estado.idR)
  ok(ra.status === 200 && ra.json?.carreira?.temReplay === false && sql(`SELECT CONCAT_WS('|', tem_replay, copas, libertadores) FROM carreiras WHERE id=${pkA}`) === '0|1|2', `sem replay: salva (C.temReplay = false), 1 Copa e 2 Libertadores no resumo (${ra.status})`)
  ok(sql(`SELECT COUNT(*) FROM desafio_candidatos WHERE carreira_pk=${pkA}`) === '0', 'sem replay: não vira candidata')
  const eu = (await meuDesafio(page)).find((x) => x.slug === 'tacas-do-rei-teste')?.eu
  const ca = eu?.carreirasQueCumprem?.find((c) => c.carreiraId === a.id)
  ok(ca?.vale === false && ca?.motivo === 'sem_replay' && /replay/.test(ca?.motivoTexto ?? ''), `desafios.php?eu=1: a forjada aparece com motivo sem_replay (${JSON.stringify(ca)})`)
  // (b) a 1ª carreira do R (de verdade, com o replay dela) com 1 Copa e 2 Libertadores a mais no resumo
  const b = comTacasAMais(estado.hallQ)
  const rb = await salvarPelaApi(page, b)
  estado.pkF = pkDe(b.id, estado.idR)
  const esperadoF = `1|${tacas(b, 'world-cup')}|${tacas(b, 'libertadores')}|-`
  ok(rb.status === 200 && sql(`SELECT CONCAT_WS('|', tem_replay, copas, libertadores, IFNULL(suspeita, '-')) FROM carreiras WHERE id=${estado.pkF}`) === esperadoF, `com replay e taças a mais: o servidor não refaz a carreira, salva com o replay (${rb.status}, ${esperadoF})`)
  const kf = await esperarSql(`SELECT CONCAT_WS('|', id, estado) FROM desafio_candidatos WHERE carreira_pk=${estado.pkF}`, (x) => x !== '', 15000)
  estado.candF = kf.split('|')[0]
  ok(kf.endsWith('|pendente'), `…e vira candidata pendente, depois da verdadeira (${kf}) — quem decide é a verificação pelo jogo`)
  ok(sql(`SELECT id FROM desafio_candidatos WHERE desafio_id=${estado.idDesafio} AND estado IN ('pendente','verificada') ORDER BY em, id LIMIT 1`) === estado.candG, 'o primeiro (menor "em") é o candidato da carreira de verdade')
})

await etapa('g9. v3.3: painel → "Verificar no jogo": a de verdade bate; a adulterada não bate e é recusada', async () => {
  await irP(`#/desafios?id=${estado.idDesafio}`, 2000)
  const cG = abaP().locator(`article.candidato[data-id="${estado.candG}"]`)
  await cG.waitFor({ timeout: 15000 })
  ok((await abaP().locator('article.candidato').count()) === 2 && (await cG.getAttribute('class')).includes('primeiro'), 'painel: 2 candidatos na ordem do "em", a de verdade marcada como a primeira')
  const href = await cG.locator('a', { hasText: 'Verificar no jogo' }).getAttribute('href')
  ok(href === `/lenda/#/verificar?id=${estado.pkG}&candidato=${estado.candG}`, `"Verificar no jogo" → ${href}`)
  await abaP().locator('article.candidato').first().scrollIntoViewIfNeeded().catch(() => {})
  await print(painel, 'g9-painel-candidatos-pendentes')
  const [aba] = await Promise.all([ADM.ctx.waitForEvent('page'), cG.locator('a', { hasText: 'Verificar no jogo' }).click()])
  await aba.waitForFunction(() => /Bateu|Não bateu|Não dá/.test(document.querySelector('.sv-veredito')?.textContent ?? ''), null, { timeout: 120000 })
  ok(/Bateu/.test(await aba.locator('.sv-veredito').innerText()) && !/Não bateu/.test(await aba.locator('.sv-veredito').innerText()), `jogo (#/verificar): "${(await aba.locator('.sv-veredito').innerText()).replace(/\s+/g, ' ').slice(0, 80)}"`)
  await aba.getByText('Registrado no painel').first().waitFor({ timeout: 20000 })
  ok((await aba.locator('.sv-tr.is-dif').count()) === 0, 'tabela guardado × refeito: nenhum número diferente')
  await print(aba, 'g9-jogo-verificar-bateu', { fullPage: true })
  await aba.close()
  ok(sql(`SELECT CONCAT_WS('|', estado, JSON_EXTRACT(verificacao, '$.ok')) FROM desafio_candidatos WHERE id=${estado.candG}`) === 'verificada|true', 'banco: a de verdade "verificada" (verificacao.ok = true)')
  // a adulterada
  await irP(`#/desafios?id=${estado.idDesafio}`, 2000)
  const cF = abaP().locator(`article.candidato[data-id="${estado.candF}"]`)
  await cF.waitFor({ timeout: 15000 })
  const [aba2] = await Promise.all([ADM.ctx.waitForEvent('page'), cF.locator('a', { hasText: 'Verificar no jogo' }).click()])
  await aba2.waitForFunction(() => /Bateu|Não bateu|Não dá/.test(document.querySelector('.sv-veredito')?.textContent ?? ''), null, { timeout: 120000 })
  ok(/Não bateu/.test(await aba2.locator('.sv-veredito').innerText()), 'jogo: a adulterada "Não bateu"')
  ok((await aba2.locator('.sv-tr.is-dif', { hasText: 'Copas do Mundo' }).count()) === 1 && (await aba2.locator('.sv-tr.is-dif', { hasText: 'Libertadores' }).count()) === 1, 'tabela: as linhas de Copas do Mundo e Libertadores marcadas')
  ok(sql(`SELECT estado FROM desafio_candidatos WHERE id=${estado.candF}`) === 'pendente', 'não bateu: nada é mandado sem o clique do admin')
  await print(aba2, 'g9-jogo-verificar-nao-bateu', { fullPage: true })
  await aba2.getByRole('button', { name: /Registrar: não bateu/ }).click()
  await aba2.getByText(/candidato foi recusado/).first().waitFor({ timeout: 20000 })
  await aba2.close()
  const kr = sql(`SELECT CONCAT_WS('|', estado, motivo) FROM desafio_candidatos WHERE id=${estado.candF}`)
  ok(kr.startsWith('recusada|') && /Copas do Mundo/.test(kr), `banco: recusada com o motivo do que não bateu (${kr})`)
  // o painel volta atualizado (a aba do jogo registrou)
  await irP('#/visao', 600)
  await irP(`#/desafios?id=${estado.idDesafio}`, 2200)
  ok((await abaP().locator(`article.candidato[data-id="${estado.candG}"]`).innerText()).match(/Bateu/) && (await abaP().locator(`article.candidato[data-id="${estado.candF}"]`).innerText()).match(/Não bateu/), 'painel: "Bateu" na de verdade e "Não bateu" na adulterada')
  await abaP().locator('article.candidato').first().scrollIntoViewIfNeeded().catch(() => {})
  await print(painel, 'g9-painel-candidatos-verificados')
  const { page } = R
  await page.goto(`${URL0}#/desafios`)
  await page.reload()
  await page.locator('.sv-cand-meu.is-verificada').waitFor({ timeout: 20000 })
  ok(true, 'R: o checklist mostra "Verificada" (a melhor candidatura da conta)')
})

await etapa('g10. v3.3: limite de partidas por dia (Configurações): passou do limite, a partida não soma e a carreira não vale', async () => {
  await irP('#/config', 2000)
  await painel.waitForSelector('#cfg-partidas_dia_max', { timeout: 10000 })
  ok((await painel.inputValue('#cfg-partidas_dia_max')) === '100', 'Configurações: "Partidas por dia que contam" = 100 (o padrão)')
  await painel.fill('#cfg-partidas_dia_max', '10')
  await limparAvisos()
  await painel.locator('.barra-salvar button', { hasText: 'Salvar' }).click()
  await dialogo().waitFor()
  await confirmar()
  ok(await avisoPainel(/Configurações salvas/), 'partidas_dia_max = 10 salvo pelo painel')
  ok(sql("SELECT valor FROM site_config WHERE chave='partidas_dia_max'") === '10', 'banco: partidas_dia_max = 10')
  // o R já jogou as 10 de hoje (o contador do dia de Brasília, como se fossem partidas de antes)
  sql(`INSERT INTO partidas_dia (usuario_id, dia, n) VALUES (${estado.idR}, DATE(UTC_TIMESTAMP() - INTERVAL 3 HOUR), 10) ON DUPLICATE KEY UPDATE n = 10`)
  const { page } = R
  const provR2 = provadasDaConta(estado.idR)
  const r = await jogarCarreira(page, { semente: [2003, 333], nacao: 'Brasil', sobrenome: 'PASSOU' })
  ok(r.fim, `R: a 11ª partida do dia jogada pela tela (${Math.round(r.ms / 1000)} s)`)
  const n = await esperarSql(`SELECT n FROM partidas_dia WHERE usuario_id=${estado.idR} AND dia = DATE(UTC_TIMESTAMP() - INTERVAL 3 HOUR)`, (x) => x === '11', 30000)
  ok(n === '11' && sql(`SELECT partidas_conta FROM usuarios WHERE id=${estado.idR}`) === '2', `a partida conta no dia (${n}) mas não soma na conta (partidas_conta continua 2)`)
  await sleep(1000)
  const hPassou = await ultimaTerminada(page)
  // v3.4: o aparelho manda sozinha a carreira com conquista nova para provar (o servidor é quem diz que, acima do limite do
  // dia, ela não prova nada): espera esse salvar antes de mandar a versão adulterada por cima
  if (conquistasDe(hPassou).some((x) => !provR2.has(x))) {
    await esperarSql(`SELECT COUNT(*) FROM carreiras WHERE carreira_id='${hPassou.id}' AND usuario_id=${estado.idR}`, (x) => x === '1', 30000)
    const pkP = pkDe(hPassou.id, estado.idR)
    const lp = sql(`SELECT CONCAT_WS('|', c.como, IFNULL(c.fora_desafio, '-'), (SELECT COUNT(*) FROM conquistas_usuario cu WHERE cu.prova_pk = c.id)) FROM carreiras c WHERE c.id=${pkP}`)
    ok(lp === 'auto|limite_diario|0', `v3.4: acima do limite do dia, a carreira que subiu sozinha não prova nada (como|fora_desafio|provas = ${lp})`)
  }
  const c = comTacasAMais(hPassou)
  const rc = await salvarPelaApi(page, c)
  const pkC = pkDe(c.id, estado.idR)
  ok(rc.status === 200 && sql(`SELECT IFNULL(fora_desafio, '-') FROM carreiras WHERE id=${pkC}`) === 'limite_diario' && sql(`SELECT COUNT(*) FROM desafio_candidatos WHERE carreira_pk=${pkC}`) === '0',
    'carreira salva num dia acima do limite (mesmo cumprindo o critério): fora_desafio = limite_diario e não vira candidata')
  const eu = (await meuDesafio(page)).find((x) => x.slug === 'tacas-do-rei-teste')?.eu
  const cc = eu?.carreirasQueCumprem?.find((x) => x.carreiraId === c.id)
  ok(cc?.motivo === 'limite_diario' && eu?.partidasHoje === 11 && eu?.partidasDiaMax === 10, `?eu=1: motivo limite_diario, hoje 11 de 10 (${JSON.stringify({ m: cc?.motivo, h: eu?.partidasHoje, x: eu?.partidasDiaMax })})`)
  await page.goto(`${URL0}#/desafios`)
  await page.reload()
  await page.locator('.sv-cumpre').waitFor({ timeout: 20000 })
  const t = await page.locator('.sv-desafio').first().innerText()
  ok(/valem até 10 por dia \(hoje: 11\)/.test(t) && /passou do limite de partidas por dia/.test(t), 'checklist: "valem até 10 por dia (hoje: 11)" e o motivo na carreira')
  await print(page, 'g10-R-limite-diario', { fullPage: true })
  const v = await admin({ acao: 'config', valores: { partidas_dia_max: 100 } })
  ok(v.status === 200 && sql("SELECT valor FROM site_config WHERE chave='partidas_dia_max'") === '100', 'partidas_dia_max de volta a 100')
})

await etapa('g11. v3.3: declarar o vencedor (confirmação forte) → o jogo mostra o vencedor; o destaque some', async () => {
  await irP(`#/desafios?id=${estado.idDesafio}`, 2000)
  await abaP().locator(`article.candidato[data-id="${estado.candG}"] button`, { hasText: 'Declarar vencedor' }).click()
  await dialogo().waitFor()
  const btn = dialogo().locator('button[type="submit"]')
  ok(/Verificado no jogo/.test(await dialogo().textContent()) && (await btn.isDisabled()), 'diálogo: confere tudo e só libera com o apelido digitado')
  await dialogo().locator('.confirmar-digitando input').fill(APELIDO_R)
  await print(painel, 'g11-painel-declarar')
  await limparAvisos()
  await btn.click()
  ok(await avisoPainel(/é o vencedor/), 'vencedor declarado (toast)')
  const d = sql(`SELECT CONCAT_WS('|', vencedor_usuario_id, vencedor_candidato, vencido_em IS NOT NULL) FROM desafios WHERE id=${estado.idDesafio}`)
  ok(d === `${estado.idR}|${estado.candG}|1` && sql(`SELECT estado FROM desafio_candidatos WHERE id=${estado.candG}`) === 'vencedora', `banco: o desafio com o vencedor e o candidato "vencedora" (${d})`)
  ok(sql(`SELECT aviso_conta FROM usuarios WHERE id=${estado.idR}`).startsWith(`Parabéns! Você venceu o desafio “${TITULO_D}”`), 'a conta do R recebe o recado de vencedor')
  ok(sql(`SELECT COUNT(*) FROM admin_log WHERE acao='desafio_vencedor' AND alvo='desafio:${estado.idDesafio}'`) === '1', 'registro: desafio_vencedor')
  await sleep(1200)
  await print(painel, 'g11-painel-vencedor')
  // o jogador: o recado é de vitória (não "aviso da moderação")
  const { page } = R
  await page.goto(`${URL0}#/`)
  await page.reload()
  await page.waitForSelector('.ld-modes', { timeout: 30000 })
  ok(await page.getByText('Você venceu um desafio!', { exact: true }).first().waitFor({ timeout: 15000 }).then(() => true, () => false), 'R: o lembrete "Você venceu um desafio!" ao abrir o jogo')
  await print(page, 'g11-R-lembrete-vencedor')
  const m = await menu(page)
  // a parte da conta no menu chega num pedaço à parte
  ok(await m.getByText('Minha conta · você venceu um desafio!').first().waitFor({ timeout: 10000 }).then(() => true, () => false) && !/aviso da moderação/.test(await m.innerText()), 'menu do R: "Minha conta · você venceu um desafio!" (e não "aviso da moderação")')
  await m.getByText(/Minha conta/).first().click()
  const mc = page.getByRole('dialog', { name: 'Minha conta' })
  await mc.waitFor({ timeout: 15000 })
  await mc.locator('.sc-avisoconta.is-desafio').waitFor({ timeout: 10000 })
  ok(/Você venceu um desafio!/.test(await mc.locator('.sc-avisoconta').innerText()) && !/Aviso da moderação/.test(await mc.innerText()), 'Minha conta: "Você venceu um desafio!" (e não "Aviso da moderação")')
  await print(page, 'g11-R-minha-conta-vencedor')
  await page.keyboard.press('Escape')
  // o público (aparelho novo: sem o cache de 60 s da lista)
  const W = await novo('W', { partidas: 0, viewport: { width: 390, height: 844 }, celular: true })
  await W.page.goto(`${URL0}#/`)
  await W.page.waitForSelector('.ld-modes', { timeout: 30000 })
  await W.page.locator('.s4-faixa').waitFor({ timeout: 20000 }).catch(() => {})
  ok((await W.page.locator('.sv-destaque').count()) === 0 && (await W.page.locator('.s4-faixa').count()) === 1, 'público: com vencedor, o destaque some da tela inicial (e a faixa dos emblemas volta, v3.4)')
  await W.page.goto(`${URL0}#/desafios`)
  await W.page.locator('.sv-vencedor').waitFor({ timeout: 20000 })
  const t = await W.page.locator('.sv-desafio').first().innerText()
  ok(/Tem vencedor/.test(t) && (await W.page.locator('.sv-vencedor a', { hasText: APELIDO_R }).count()) === 1 && t.includes(FILA.identity.surname), `#/desafios: "Tem vencedor", ${APELIDO_R} (link ao perfil) com ${FILA.identity.surname}`)
  const w = await semRolagem(W.page)
  ok(w[0] <= w[1], `celular: #/desafios sem rolagem lateral (${w[0]} ≤ ${w[1]})`)
  await print(W.page, 'g11-W-desafios-vencedor', { fullPage: true })
  await W.page.locator('.sv-vencedor a', { hasText: APELIDO_R }).click()
  await W.page.waitForSelector('.sv-perfil', { timeout: 20000 })
  ok(W.page.url().endsWith(`#/jogador/${estado.codigoR}`) && /Venceu:/.test(await W.page.locator('.sv-vencidos').innerText()), 'o apelido do vencedor abre o perfil, com "Venceu: …"')
  ok((await desafiosApi()).desafios.find((d) => d.slug === 'tacas-do-rei-teste')?.vencedor?.apelido === APELIDO_R, 'desafios.php: vencedor com o apelido')
})

await etapa('g12. v3.3: perfil público pelo link do código (quem abre chega como convidado) e o apelido no Hall leva ao perfil', async () => {
  const h = await admin({ acao: 'atualizar_hall' })
  ok(h.status === 200, 'atualizar o Hall (a fotografia que o perfil mostra)')
  const { page } = R
  await page.goto(`${URL0}#/`)
  await page.waitForSelector('.ld-modes', { timeout: 30000 })
  const m = await menu(page)
  await m.getByText(/Minha conta/).first().click()
  const mc = page.getByRole('dialog', { name: 'Minha conta' })
  await mc.waitFor({ timeout: 15000 })
  const link = await mc.getByLabel('Link do seu perfil público').inputValue()
  ok(link === `${URL0}?c=${estado.codigoR}#/jogador/${estado.codigoR}`, `Minha conta: o link do perfil (${link})`)
  await mc.getByRole('button', { name: 'Copiar o link' }).click()
  ok((await page.evaluate(() => navigator.clipboard.readText())) === link, '"Copiar o link" copia o link do perfil')
  await page.keyboard.press('Escape')
  const P = await novo('P', { partidas: 0, viewport: { width: 390, height: 844 }, celular: true })
  await P.page.goto(link)
  await P.page.waitForSelector('.sv-perfil h1', { timeout: 20000 })
  ok((await P.page.locator('.sv-perfil h1').innerText()).trim() === APELIDO_R, 'perfil público: o apelido')
  const nc = await P.page.locator('.sv-carreira').count()
  const pfApi = await (await fetch(`${URL0}api/perfil.php?c=${estado.codigoR}`)).json()
  ok(nc >= 1 && nc <= 3 && nc === pfApi.carreiras.length, `perfil: as carreiras do Hall do R (até 3; ${nc})`)
  ok((await P.page.evaluate(() => JSON.parse(localStorage.getItem('lenda:convite') || 'null')?.codigo)) === estado.codigoR, 'quem abre o perfil chega como convidado (o código fica guardado)')
  const w = await semRolagem(P.page)
  ok(w[0] <= w[1], 'celular: perfil sem rolagem lateral')
  await print(P.page, 'g12-P-perfil-publico', { fullPage: true })
  await P.page.locator('.sv-carreira').first().click()
  await P.page.locator('.sm-chip--com').waitFor({ timeout: 20000 })
  ok(P.page.url().includes('de=comunidade') && (await P.page.locator('a.sm-chip--link').getAttribute('href')) === `#/jogador/${estado.codigoR}`, 'a carreira abre o resumo da comunidade; "Carreira de Rei do Teste" leva ao perfil')
  await P.page.goto(`${URL0}#/hall?seg=comunidade`)
  // v3.5 (revisão mobile): o apelido deixou de ser um link dentro da linha (no celular o dedo no meio da linha caía nele e
  // ia para o perfil em vez do resumo). A linha abre o resumo, e o "Carreira de <apelido>" de lá leva ao perfil.
  const linha = P.page.locator('.hl-row.is-com', { hasText: APELIDO_R }).first()
  await linha.waitFor({ timeout: 20000 })
  ok((await P.page.locator('.hl-row.is-com .hl-com__dono.is-link, .hl-row.is-com a.hl-com__dono').count()) === 0, 'Hall da comunidade: o apelido não é um link dentro da linha (v3.5)')
  await linha.click()
  await P.page.locator('a.sm-chip--link').waitFor({ timeout: 20000 })
  await P.page.locator('a.sm-chip--link').click()
  await P.page.waitForSelector('.sv-perfil h1', { timeout: 15000 })
  ok(P.page.url().endsWith(`#/jogador/${estado.codigoR}`), 'Hall da comunidade: a linha abre o resumo e "Carreira de <apelido>" abre o perfil')
  const pf = await (await fetch(`${URL0}api/perfil.php?c=${estado.codigoR}`)).json()
  ok(pf.apelido === APELIDO_R && pf.desafiosVencidos?.includes('tacas-do-rei-teste') && pf.carreiras.length >= 1, `perfil.php: apelido, carreiras e desafiosVencidos (${JSON.stringify(pf.desafiosVencidos)})`)
  // perfil fechado (o B põe o Hall em "Não mostrar") = 404 no servidor e "Perfil não encontrado" no jogo
  const codigoB = sql(`SELECT codigo_convite FROM usuarios WHERE id=${estado.idB}`)
  const st = await B.page.evaluate(async () => (await fetch('api/conta.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ acao: 'perfil', hallPublico: 'nao' }) })).status)
  const r404 = await fetch(`${URL0}api/perfil.php?c=${codigoB}`)
  ok(st === 200 && r404.status === 404, `perfil de quem fechou o Hall → 404 (${r404.status})`)
  await P.page.goto(`${URL0}#/jogador/${codigoB}`)
  await esperarTexto(P.page, 'Perfil não encontrado', 15000)
  ok(true, 'jogo: "Perfil não encontrado"')
  P.erros.splice(0, P.erros.length, ...P.erros.filter((x) => !/status of 404/.test(x)))
  await B.page.evaluate(async () => fetch('api/conta.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ acao: 'perfil', hallPublico: 'auto' }) }))
})

await etapa('g13. v3.3: painel → Usuários "e-mail não confirmado": reenviar a confirmação ao B; o B confirma pela faixa de Minha conta', async () => {
  await irP('#/usuarios?verificado=0', 2000)
  await abaP().locator('tbody tr').first().waitFor({ timeout: 10000 })
  const linhas = await abaP().locator('tbody tr').allInnerTexts()
  ok(linhas.length === 1 && /Bruno Moderado/.test(linhas[0]), `filtro "E-mail não confirmado": só o B (${linhas.length})`)
  await print(painel, 'g13-painel-usuarios-nao-confirmados')
  const antes = emailsPara(EMAIL_B).length
  await limparAvisos()
  await abaP().locator('tbody tr', { hasText: 'Bruno Moderado' }).locator('button[title^="Manda um código novo de confirmação"]').click()
  ok(await avisoPainel(/Confirmação mandada/), 'reenviar a confirmação (toast com o e-mail mascarado)')
  ok(emailsPara(EMAIL_B).length === antes + 1 && sql("SELECT COUNT(*) FROM email_log WHERE tipo='admin_verif'") === '1', 'um e-mail novo para o B (email_log tipo admin_verif)')
  const { page } = B
  await page.goto(`${URL0}#/`)
  await page.waitForSelector('.ld-modes', { timeout: 30000 })
  const m = await menu(page)
  await m.getByText(/Minha conta/).first().click()
  const mc = page.getByRole('dialog', { name: 'Minha conta' })
  await mc.waitFor({ timeout: 15000 })
  await mc.locator('.sv-faixa').waitFor({ timeout: 10000 })
  await print(page, 'g13-B-faixa-confirmar')
  const codigo = await codigoDoEmail(EMAIL_B)
  await mc.locator('.sv-faixa').getByLabel('Código de 6 dígitos').fill(codigo ?? '')
  await mc.locator('.sv-faixa').getByRole('button', { name: 'Confirmar e-mail' }).click()
  await mc.locator('.sv-faixa').waitFor({ state: 'detached', timeout: 15000 })
  ok(sql(`SELECT email_verificado_em IS NOT NULL FROM usuarios WHERE id=${estado.idB}`) === '1', 'B confirmou com o código novo (o do cadastro deixou de valer) e a faixa some')
  await page.keyboard.press('Escape')
})

await etapa('g14. v3.3: o Registro mostra as ações novas em pt-BR', async () => {
  await irP('#/registro', 2200)
  await abaP().locator('tbody tr').first().waitFor({ timeout: 10000 })
  const reg = await abaP().locator('tbody').textContent()
  const nomes = await painel.evaluate(() => ['desafio_salvar', 'desafio_ativar', 'candidato_verificar', 'desafio_vencedor', 'suporte_responder', 'suporte_status', 'reenviar_verificacao'].map((a) => window.LP?.NOMES_ACAO_LOG?.[a] ?? a))
  const faltam = nomes.filter((n) => !reg.includes(n))
  ok(faltam.length === 0 && !/desafio_salvar|candidato_verificar|suporte_responder/.test(reg), `Registro: ${nomes.join(' · ')}${faltam.length ? ` (faltam: ${faltam.join(', ')})` : ''}`)
  await print(painel, 'g14-painel-registro')
})

// ───────────────────────── h. v3.4: conquistas provadas, desafios de emblema, prévia de link, SEO ─────────────────────────
// Uma carreira REAL de fila (v-otima-01: Expresso, centroavante italiano, 8 decisões; pico 89, 2 Bolas de Ouro, 5 Champions,
// 18 temporadas no mesmo clube e 34 títulos) jogada pela tela com a conta: não é 90+, mas é carreira-prova com conquistas
// novas — sobe sozinha e cumpre dois desafios de emblema fáceis (Noite de gala e Bandeira do clube).
const FILA_E = JSON.parse(readFileSync(new URL('../../../scripts/gravar/filas/classico.json', import.meta.url), 'utf8')).find((f) => f.nome === 'v-otima-01')
const EMAIL_E = `emblema${Date.now()}@exemplo.com`
const APELIDO_E = 'Craque do Emblema'
const emblemasDe = (uid, estadoE = 'ativo') => sql(`SELECT GROUP_CONCAT(d.slug ORDER BY d.slug) FROM emblemas_usuario e JOIN desafios d ON d.id = e.desafio_id WHERE e.usuario_id=${uid} AND e.estado='${estadoE}'`)
const meta = (html, chave) => {
  const m = new RegExp(`<meta (?:property|name)="${chave.replace(/[.:]/g, (x) => `\\${x}`)}" content="([^"]*)"`).exec(html)
  return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null
}
const tamanhoPng = (b) => (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null)
const E = await novo('E', { partidas: 0, viewport: { width: 1440, height: 900 } })

await etapa('h1. v3.4: E cria a conta e joga pela tela a carreira real da fila → sobe sozinha como prova e ganha 2 emblemas', async () => {
  const { page } = E
  await page.goto(URL0)
  await page.waitForSelector('.ld-modes', { timeout: 60000 })
  const m = await menu(page)
  await m.getByText('Entrar / Criar conta').click()
  const d = page.locator('[role="dialog"].sc-modal')
  await d.waitFor()
  await d.getByRole('tab', { name: 'Criar conta' }).click()
  await preencherConta(page, d, [['Apelido', APELIDO_E], ['E-mail', EMAIL_E], ['Senha', SENHA, true]])
  await d.getByRole('checkbox').first().check()
  await d.getByRole('button', { name: 'Criar conta', exact: true }).click()
  const dv = page.locator('[role="dialog"].sc-modal', { hasText: 'Confirme seu e-mail' })
  await dv.waitFor({ timeout: 20000 })
  await dv.getByRole('button', { name: 'Depois', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[role="dialog"].sc-modal'), null, { timeout: 20000 })
  estado.idE = idUsuario(EMAIL_E)
  estado.codigoE = sql(`SELECT codigo_convite FROM usuarios WHERE id=${estado.idE}`)
  ok(/^\d+$/.test(estado.idE) && provadasDaConta(estado.idE).size === 0 && emblemasDe(estado.idE) === 'NULL', `conta do E criada (${estado.idE}), sem conquista provada e sem emblema`)
  const r = await jogarFila(page, FILA_E, { nacao: 'Itália' })
  ok(r.fim && r.escolhas === FILA_E.picks.length, `E: a carreira da fila ${FILA_E.nome} jogada pela tela (${r.escolhas} de ${FILA_E.picks.length} escolhas, ${Math.round(r.ms / 1000)} s)`)
  await sleep(1200)
  const h = await ultimaTerminada(page)
  estado.hallE = h
  const seed36 = `${FILA_E.a0.toString(36)}${FILA_E.a1.toString(36)}`
  ok(h.id === `career-${seed36}` && h.summary.peakOvr === 89, `HallEntry career-<semente da fila>, pico ${h.summary.peakOvr} (não é 90+)`)
  const lembradas = await page.evaluate(() => JSON.parse(localStorage.getItem('lenda:sementes-servidor') || 'null'))
  ok(lembradas?.uid === Number(estado.idE) && lembradas.s.includes(seed36), 'o aparelho lembra que a semente desta carreira veio do servidor para a conta')
  // sobe sozinha só como prova (não é 90+): conquistas que a conta não tem provadas
  const como = await esperarSql(`SELECT como FROM carreiras WHERE carreira_id='${h.id}' AND usuario_id=${estado.idE}`, (x) => x !== '', 30000)
  ok(como === 'auto', `a carreira-prova subiu sozinha para a conta ("auto", pico 89: só pela prova) (${como})`)
  estado.pkE = pkDe(h.id, estado.idE)
  const ach = conquistasDe(h)
  const lista = JSON.parse(sql(`SELECT IFNULL(conquistas, 'null') FROM carreiras WHERE id=${estado.pkE}`))
  ok(Array.isArray(lista) && JSON.stringify([...lista].sort()) === JSON.stringify(ach) && sql(`SELECT CONCAT_WS('|', conquistas_v, tem_replay, IFNULL(prova_ok, '-'), IFNULL(fora_desafio, '-'), IFNULL(suspeita, '-')) FROM carreiras WHERE id=${estado.pkE}`) === '2|1|-|-|-',
    `servidor: a lista de conquistas da carreira (${ach.length}) igual à do HallEntry, conquistas_v 2, com replay, sem verificação ainda, sem suspeita`)
  const prov = provadasDaConta(estado.idE)
  ok(ach.length >= 10 && ach.every((x) => prov.has(x)) && sql(`SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id=${estado.idE} AND prova_pk <> ${estado.pkE}`) === '0', `as ${ach.length} conquistas da carreira estão provadas na conta (prova_pk = ela)`)
  const emb = await esperarSql(`SELECT GROUP_CONCAT(d.slug ORDER BY d.slug) FROM emblemas_usuario e JOIN desafios d ON d.id = e.desafio_id WHERE e.usuario_id=${estado.idE} AND e.estado='ativo'`, (x) => x !== 'NULL', 15000)
  ok(emb === 'bandeira-do-clube,noite-de-gala' && sql(`SELECT COUNT(*) FROM emblemas_usuario WHERE usuario_id=${estado.idE} AND carreira_pk=${estado.pkE}`) === '2',
    `o servidor deu sozinho os 2 emblemas fáceis que a carreira cumpre (Bandeira do clube: 18 temporadas no mesmo clube + 20 títulos; Noite de gala: Bola de Ouro + Champions) (${emb})`)
  const avisou = await page.getByText(/2 emblemas novos|Emblema novo/).first().waitFor({ timeout: 15000 }).then(() => true, () => false)
  ok(avisou, 'o aviso dourado dos emblemas novos (pelo emblemasNovos do salvar)')
  // no máximo 2 avisos à vista: se o "Você desbloqueou N conquistas" da última decisão chegou antes, o discreto fica na
  // fila e aparece quando um dos dois sai (o de conquistas dura 4 s)
  const discreto = await page.getByText(/conquistas? provadas? na conta/).first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)
  ok(discreto, 'o aviso discreto: "N conquistas provadas na conta"')
  await print(page, 'h1-E-fim-carreira-prova-emblemas')
  ok((await page.locator('.ck-end .sc-saved').count()) === 1 && (await page.locator('.ck-end').getByRole('button', { name: 'Salvar na minha conta' }).count()) === 0, 'o fim da carreira mostra "Salva na sua conta" (sem o botão)')
})

await etapa('h2. v3.4: os emblemas e as provadas na tela: #/desafios "Você já tem", a faixa com ✓, Minha conta, a tela de conquistas', async () => {
  const { page } = E
  await page.goto(`${URL0}#/desafios`)
  await page.locator('.s4-emb.is-tem').first().waitFor({ timeout: 20000 })
  const tem = (await page.locator('.s4-emb.is-tem h3').allInnerTexts()).map((x) => x.trim()).sort()
  ok(JSON.stringify(tem) === JSON.stringify(['Bandeira do clube', 'Noite de gala']), `#/desafios: "Você já tem" em ${tem.join(' e ')}`)
  ok(/Você tem 2 de 10/.test(await page.locator('.s4-emb-meus').innerText()), '"Você tem 2 de 10"')
  const ng = await page.locator('#d-noite-de-gala').innerText()
  ok(/Você já tem/.test(ng) && ng.includes(FILA_E.identity.surname), `o cartão diz com qual jogador ganhou (${ng.replace(/\s+/g, ' ').slice(0, 140)})`)
  await print(page, 'h2-E-desafios-voce-ja-tem', { fullPage: true })
  // de volta à tela inicial na mesma sessão (sem recarregar: os emblemas da conta já foram lidos pelo ?eu=1 do #/desafios)
  await page.evaluate(() => (location.hash = '#/'))
  await page.locator('.s4-faixa').waitFor({ timeout: 20000 })
  await page.locator('.s4-faixa__d.is-tem').first().waitFor({ timeout: 10000 }).catch(() => {})
  ok((await page.locator('.s4-faixa__d.is-tem[title="Noite de gala"]').count()) === 1 && /você já tem o emblema/.test((await page.locator('.s4-faixa__d[title="Noite de gala"]').getAttribute('aria-label')) ?? ''),
    'tela inicial: a faixa marca o desafio que a conta já tem (✓; "você já tem o emblema" no aria-label)')
  await print(page, 'h2-E-home-faixa-com-emblema')
  const m = await menu(page)
  await m.getByText(/Minha conta/).first().click()
  const mc = page.getByRole('dialog', { name: 'Minha conta' })
  await mc.waitFor({ timeout: 15000 })
  await mc.locator('.s4-meus').waitFor({ timeout: 15000 })
  ok((await mc.locator('.s4-meus li').count()) === 2, 'Minha conta: "Seus emblemas" com os 2')
  await mc.locator('.s4-meus').scrollIntoViewIfNeeded()
  await print(page, 'h2-E-minha-conta-emblemas')
  await page.keyboard.press('Escape')
  await page.goto(`${URL0}#/?conquistas=1`)
  const ach = page.getByRole('dialog', { name: /Conquistas da carreira/ })
  await ach.waitFor({ timeout: 15000 })
  await ach.locator('.ac-prova').waitFor({ timeout: 15000 })
  const n = provadasDaConta(estado.idE).size
  const linha = (await ach.locator('.ac-prova').innerText()).replace(/\s+/g, ' ')
  ok(new RegExp(`${n} provadas na conta`).test(linha), `tela de conquistas: "${linha}" (${n} no banco)`)
  ok((await ach.locator('.ac-ppill.is-ok').count()) > 0 && (await ach.locator('.ac-ppill.is-ok').first().innerText()).includes('Provada'), 'as conquistas da carreira aparecem com o selo "Provada"')
  await print(page, 'h2-E-conquistas-provadas')
  await page.keyboard.press('Escape')
  const eu = await page.evaluate(async () => (await (await fetch('api/desafios.php?eu=1', { credentials: 'same-origin' })).json()))
  ok(JSON.stringify((eu.emblemas ?? []).map((x) => x.slug).sort()) === JSON.stringify(['bandeira-do-clube', 'noite-de-gala']) && eu.desafios.find((x) => x.slug === 'noite-de-gala')?.eu?.emblema?.estado === 'ativo',
    'desafios.php?eu=1: a lista "emblemas" no topo e eu.emblema ativo')
  const cq = await page.evaluate(async () => (await (await fetch('api/conquistas.php', { credentials: 'same-origin' })).json()))
  ok(cq.provadas === n && cq.total === 87 && cq.conquistas.filter((x) => x.provada).every((x) => x.carreira === estado.hallE.id), `conquistas.php: provadas ${cq.provadas} de ${cq.total}, cada uma com a carreira que prova`)
})

await etapa('h3. v3.4: o emblema no Hall da comunidade (ao lado do apelido) e no perfil público', async () => {
  const at = await admin({ acao: 'atualizar_hall' })
  ok(at.status === 200, 'atualizar o Hall (a fotografia)')
  const it = (await hallApi()).itens.find((i) => i.id === estado.hallE.id)
  ok(it?.apelido === APELIDO_E && it.emblemasTotal === 2 && (it.emblemas ?? []).length === 2 && it.emblemas.every((x) => x.slug && x.icone && x.cor), `hall.php: o item com os emblemas (${(it?.emblemas ?? []).map((x) => x.slug).join(', ')}) e emblemasTotal ${it?.emblemasTotal}`)
  const C2 = await novo('C2', { partidas: 0 })
  await C2.page.goto(`${URL0}#/hall?seg=comunidade`)
  const linha = C2.page.locator('.hl-row.is-com', { hasText: FILA_E.identity.surname }).first()
  await linha.waitFor({ timeout: 30000 })
  ok((await linha.locator('.lx-emblema').count()) === 2, 'Hall da comunidade: os 2 emblemas pequenos ao lado do apelido')
  await linha.scrollIntoViewIfNeeded()
  await print(C2.page, 'h3-C2-hall-emblemas')
  await C2.page.goto(`${URL0}#/jogador/${estado.codigoE}`)
  await C2.page.locator('.sv-perfil').waitFor({ timeout: 20000 })
  await C2.page.locator('.s4-meus').waitFor({ timeout: 15000 })
  ok((await C2.page.locator('.s4-meus li').count()) === 2, 'perfil público: "Emblemas dos desafios" com os 2')
  ok(new RegExp(`${provadasDaConta(estado.idE).size} provadas`, 'i').test(await C2.page.locator('.sv-perfil__nums').innerText()), 'perfil público: "N provadas" embaixo do número de conquistas')
  await print(C2.page, 'h3-C2-perfil-emblemas', { fullPage: true })
  const pf = await (await fetch(`${URL0}api/perfil.php?c=${estado.codigoE}`)).json()
  ok((pf.emblemas ?? []).length === 2 && pf.conquistasProvadas === provadasDaConta(estado.idE).size, `perfil.php: emblemas ${(pf.emblemas ?? []).map((x) => x.slug).join(', ')} e conquistasProvadas ${pf.conquistasProvadas}`)
})

await etapa('h4. v3.4: o link de compartilhar é a prévia (api/v.php): Open Graph, a imagem PNG 1200×630 e o caminho até o resumo', async () => {
  const { page } = E
  await page.goto(`${URL0}#/resumo?id=${estado.hallE.id}`)
  await page.locator('.sm-share__link').first().waitFor({ timeout: 30000 })
  await page.locator('.sm-share__link').first().scrollIntoViewIfNeeded()
  await sleep(1200)
  await page.locator('.sm-share__link').first().click()
  await sleep(800)
  const copiado = await page.evaluate(() => navigator.clipboard.readText())
  const link = (/(https?:\/\/\S+\/api\/v\.php\?\S+)/.exec(copiado) ?? [])[1] ?? ''
  ok(link === `${URL0}api/v.php?id=${estado.hallE.id}&c=${estado.codigoE}`, `"Copiar link": o link da prévia, com a carreira e o convite (${link})`)
  estado.linkPrevia = link
  const r = await fetch(link)
  const html = await r.text()
  ok(r.status === 200 && /^text\/html/.test(r.headers.get('content-type') ?? '') && /max-age=300/.test(r.headers.get('cache-control') ?? '') && /noindex/.test(r.headers.get('x-robots-tag') ?? ''),
    `v.php: 200 HTML, cache de 5 min, X-Robots-Tag noindex (${r.status} ${r.headers.get('content-type')})`)
  const ogT = meta(html, 'og:title')
  const ogD = meta(html, 'og:description') ?? ''
  const nota = Math.round(estado.hallE.legacy?.score ?? 0)
  ok(ogT === `${FILA_E.identity.surname} · Nota de Legado ${nota} · LENDA`, `og:title "${ogT}"`)
  ok(/2 Bolas de Ouro/.test(ogD) && /títulos em 24 temporadas/.test(ogD) && ogD.includes(`Carreira de ${APELIDO_E}`) && !ogD.includes(EMAIL_E), `og:description "${ogD.slice(0, 160)}"`)
  ok(meta(html, 'twitter:card') === 'summary_large_image' && meta(html, 'og:image:width') === '1200' && meta(html, 'og:image:height') === '630' && meta(html, 'og:type') === 'website' && meta(html, 'og:locale') === 'pt_BR',
    'Twitter summary_large_image; og:image 1200×630; type website; locale pt_BR')
  const destino = (/http-equiv="refresh" content="0; url=([^"]+)"/.exec(html) ?? [])[1]?.replace(/&amp;/g, '&')
  ok(destino === `${ORIGEM}/lenda/?c=${estado.codigoE}#/resumo?id=${estado.hallE.id}&de=comunidade` && !/<script/i.test(html) && /<meta name="robots" content="noindex, follow">/.test(html)
    && html.includes(`<link rel="icon" type="image/svg+xml" href="${URL0}favicon.svg">`), `refresh para o resumo da comunidade com o convite (${destino}); sem script; robots noindex; o ícone do LENDA`)
  const img = meta(html, 'og:image') ?? ''
  ok(img.startsWith(`${ORIGEM}/lenda/api/v.php?`) && img.includes('png=1') && img.includes(`id=${estado.hallE.id}`), `og:image absoluta (${img.slice(0, 120)})`)
  const ri = await fetch(img)
  const b = Buffer.from(await ri.arrayBuffer())
  const tam = tamanhoPng(b)
  ok(ri.status === 200 && ri.headers.get('content-type') === 'image/png' && tam?.[0] === 1200 && tam?.[1] === 630 && /max-age=86400/.test(ri.headers.get('cache-control') ?? ''), `a imagem: PNG ${tam?.join('×')} (${b.length} bytes), cache de 1 dia`)
  writeFileSync(`${PRINTS}/h4-previa-carreira.png`, b)
  const pasta = `${BASE}/lenda-cache/previas`
  const arqs = existsSync(pasta) ? readdirSync(pasta).filter((f) => f.startsWith(`c${estado.idE}-`) && f.endsWith('.png')) : []
  ok(arqs.length === 1 && !pasta.startsWith(`${BASE}/public_html`), `guardada em disco fora do public_html, com o número da conta no nome (${arqs.join(', ')})`)
  const b2 = Buffer.from(await (await fetch(img)).arrayBuffer())
  ok(b2.equals(b), 'a segunda vez vem a mesma imagem (do disco)')
  // quem abre o link vai para o resumo, já como convidado de quem compartilhou
  const Q = await novo('Q', { partidas: 0, viewport: { width: 390, height: 844 }, celular: true })
  await Q.page.goto(link)
  await Q.page.waitForFunction(() => location.hash.startsWith('#/resumo'), null, { timeout: 30000 })
  await Q.page.locator('.sm-chip--com').waitFor({ timeout: 30000 })
  ok((await Q.page.locator('.sm-chip--com').innerText()).includes(APELIDO_E) && Q.page.url().includes('de=comunidade'), `quem abre o link chega no resumo da comunidade ("Carreira de ${APELIDO_E}")`)
  ok((await Q.page.evaluate(() => JSON.parse(localStorage.getItem('lenda:convite') || 'null')?.codigo)) === estado.codigoE, '…já como convidado de quem compartilhou (o código fica guardado)')
  await print(Q.page, 'h4-Q-link-abre-o-resumo')
  // o perfil e o link que não existe
  const hp = await (await fetch(`${URL0}api/v.php?c=${estado.codigoE}`)).text()
  ok((meta(hp, 'og:title') ?? '').startsWith(`${APELIDO_E} no LENDA · melhor nota ${nota}`) && /2 emblemas/.test(meta(hp, 'og:description') ?? ''), `prévia do perfil: "${meta(hp, 'og:title')}" · "${(meta(hp, 'og:description') ?? '').slice(0, 100)}"`)
  const rg = await fetch(`${URL0}api/v.php?id=career-nao-existe-${Date.now()}`)
  const hg = await rg.text()
  ok(rg.status === 200 && meta(hg, 'og:title') === 'LENDA · jogo de carreira de futebol online grátis' && !hg.includes(APELIDO_E), 'link de carreira que não existe: a prévia genérica (200), sem dado de ninguém')
  ok((await fetch(link, { method: 'POST' })).status === 405, 'v.php só aceita GET/HEAD (POST → 405)')
})

/** HallEntry da conta mandada direto pela API (o jogo não manda isso: é o teste fazendo o papel de quem adultera). */
const salvarComo = (page, h) =>
  page.evaluate(async (h) => {
    const r = await fetch('api/carreiras.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ acao: 'salvar', carreira: h, como: 'manual' }) })
    return { status: r.status, json: await r.json().catch(() => null) }
  }, h)
/** Bolas de Ouro e Champions a mais no resumo (cumpre o Era de ouro: 5 Bolas + 3 Champions). */
function comBolasAMais(h) {
  const x = structuredClone(h)
  x.summary.awards = (x.summary.awards ?? []).filter((a) => a.award !== 'ballon_dor')
  x.summary.awards.push({ award: 'ballon_dor', count: 5, seasons: [2030, 2031, 2032, 2033, 2034] })
  const ucl = (x.summary.trophies ?? []).find((t) => t.trophyId === 'champions-league')
  if (ucl) ucl.count = Math.max(ucl.count, 3)
  else x.summary.trophies.push({ trophyId: 'champions-league', count: 3, seasons: [2030, 2031, 2032] })
  return x
}

await etapa('h5. v3.4: HallEntry adulterada — sem replay e com semente que o servidor não sorteou: nem prova nem emblema', async () => {
  const { page } = E
  const provAntes = provadasDaConta(estado.idE).size
  // (a) a carreira da fila com outro id, sem o replay e com Bolas de Ouro a mais
  const a = comBolasAMais(estado.hallE)
  a.id = `career-forjada-sem-replay-e-${Date.now()}`
  if (a.career) a.career.id = a.id
  a.summary.e2e = a.id
  delete a.replay
  const ra = await salvarComo(page, a)
  const pkA = pkDe(a.id, estado.idE)
  ok(ra.status === 200 && ra.json?.carreira?.prova === null && (ra.json?.emblemasNovos ?? []).length === 0 && (ra.json?.provasNovas ?? []).length === 0
    && sql(`SELECT CONCAT_WS('|', tem_replay, IFNULL(conquistas, '-'), bolas_ouro) FROM carreiras WHERE id=${pkA}`) === '0|-|5',
    `sem replay: salva (5 Bolas de Ouro no resumo), mas C.prova = null, nenhuma prova e nenhum emblema (${ra.status})`)
  // (b) o replay de verdade com a semente trocada por uma que o servidor não sorteou para a conta
  const b = comBolasAMais(estado.hallE)
  b.replay.seed = [123456789, 987654321]
  b.id = `career-${(123456789).toString(36)}${(987654321).toString(36)}`
  if (b.career) b.career.id = b.id
  b.summary.e2e = b.id
  const rb = await salvarComo(page, b)
  const pkB = pkDe(b.id, estado.idE)
  ok(rb.status === 200 && rb.json?.carreira?.prova === null && (rb.json?.emblemasNovos ?? []).length === 0 && sql(`SELECT CONCAT_WS('|', tem_replay, IFNULL(conquistas, '-')) FROM carreiras WHERE id=${pkB}`) === '1|-',
    `semente que não veio do servidor: salva com o replay, mas não prova nada nem dá emblema (${rb.status})`)
  ok(emblemasDe(estado.idE) === 'bandeira-do-clube,noite-de-gala' && provadasDaConta(estado.idE).size === provAntes && sql(`SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id=${estado.idE} AND prova_pk IN (${pkA}, ${pkB})`) === '0',
    'a conta continua com os mesmos 2 emblemas e as mesmas provadas (Era de ouro não veio)')
  const eu = (await meuDesafio(page)).find((x) => x.slug === 'era-de-ouro')?.eu
  const mA = eu?.carreirasQueCumprem?.find((c) => c.carreiraId === a.id)
  const mB = eu?.carreirasQueCumprem?.find((c) => c.carreiraId === b.id)
  ok(mA?.motivo === 'sem_replay' && mB?.motivo === 'sem_semente' && eu?.emblema === null, `desafios.php?eu=1 (Era de ouro): cumprem, mas não valem — ${mA?.motivo} e ${mB?.motivo} (${JSON.stringify([mA?.motivoTexto, mB?.motivoTexto]).slice(0, 160)})`)
  await page.goto(`${URL0}#/desafios?d=era-de-ouro`)
  await page.locator('#d-era-de-ouro').waitFor({ timeout: 20000 })
  await sleep(1200)
  const t = await page.locator('#d-era-de-ouro').innerText()
  ok(/cumpre, mas não vale/.test(t) && !/Você já tem/.test(t), `#/desafios: "${FILA_E.identity.surname} cumpre, mas não vale: …" (${t.replace(/\s+/g, ' ').slice(0, 200)})`)
  await print(page, 'h5-E-adulterada-nao-vale')
})

await etapa('h6. v3.4: replay e semente do servidor com taças a mais ganha na hora (o servidor não refaz a carreira) e perde na verificação em lote do admin', async () => {
  const { page } = E
  // uma 2ª carreira de verdade com a conta (semente fixa, a 1ª opção sempre)
  const prov0 = provadasDaConta(estado.idE)
  const r = await jogarCarreira(page, { semente: [3001, 333], nacao: 'Itália', sobrenome: 'SEGUNDO' })
  ok(r.fim, `E: 2ª carreira até o fim (${Math.round(r.ms / 1000)} s)`)
  await sleep(1200)
  const h2 = await ultimaTerminada(page)
  const fim2 = await fimDaCarreira(page, h2, estado.idE, prov0)
  ok(fim2.como === (fim2.auto ? 'auto' : 'manual'), `a 2ª carreira foi para a conta (${fim2.auto ? `sozinha, prova de ${fim2.novas.length} novas` : 'pelo botão'})`)
  estado.pkE2 = pkDe(h2.id, estado.idE)
  // a mesma carreira, agora com 5 Bolas de Ouro e 3 Champions no resumo (o replay e a semente são os de verdade)
  const f = comBolasAMais(h2)
  const rf = await salvarComo(page, f)
  ok(rf.status === 200 && (rf.json?.emblemasNovos ?? []).some((x) => x.slug === 'era-de-ouro') && pkDe(h2.id, estado.idE) === estado.pkE2,
    `com o replay e a semente do servidor, o resumo adulterado dá o Era de ouro na hora (CONTRATO-v34 §A.13 #4: a proteção é a verificação) (${JSON.stringify((rf.json?.emblemasNovos ?? []).map((x) => x.slug))})`)
  ok(emblemasDe(estado.idE) === 'bandeira-do-clube,era-de-ouro,noite-de-gala', `emblemas da conta agora: ${emblemasDe(estado.idE)}`)
  // o admin: a ficha da conta → "Verificar as provas no jogo" (o lote #/verificar?conta=)
  await irP(`#/usuarios?conta=${estado.idE}`, 1800)
  await painel.waitForSelector('#gaveta:not([hidden]) .perfil-nome h2', { timeout: 10000 })
  const btLote = painel.locator('#gaveta a', { hasText: 'Verificar as provas no jogo' }).first()
  await btLote.waitFor({ timeout: 15000 })
  ok((await btLote.getAttribute('href')) === `../#/verificar?conta=${estado.idE}`, `ficha da conta: "Verificar as provas no jogo" → ${await btLote.getAttribute('href')}`)
  await print(painel, 'h6-painel-ficha-provas')
  const [aba] = await Promise.all([ADM.ctx.waitForEvent('page'), btLote.click()])
  await aba.locator('.s4-lote__i').first().waitFor({ timeout: 60000 })
  // ao abrir, verifica as essenciais; depois "Todas"
  await aba.waitForFunction(() => !document.querySelector('.sv-prog') && document.querySelectorAll('.s4-lote__i.is-bateu, .s4-lote__i.is-nao_bateu').length > 0, null, { timeout: 180000 })
  await sleep(1500)
  await aba.getByRole('radio', { name: 'Todas' }).click()
  await aba.getByRole('button', { name: /^Verificar \d+ carreiras?$/ }).click()
  await aba.waitForFunction(() => !document.querySelector('.sv-prog'), null, { timeout: 180000 })
  await aba.locator('.s4-lote__i.is-nao_bateu').first().waitFor({ timeout: 30000 })
  await sleep(1500)
  const itens = await aba.locator('.s4-lote__i').allInnerTexts()
  ok((await aba.locator('.s4-lote__i.is-bateu').count()) === itens.length - 1 && (await aba.locator('.s4-lote__i.is-nao_bateu').count()) === 1, `lote: ${itens.length} carreiras-prova, ${itens.length - 1} bateram e 1 não bateu (a adulterada)`)
  ok(sql(`SELECT prova_ok FROM carreiras WHERE id=${estado.pkE}`) === '1' && sql(`SELECT IFNULL(prova_ok, '-') FROM carreiras WHERE id=${estado.pkE2}`) === '-', 'as que bateram foram registradas sozinhas (prova_ok = 1); a que não bateu espera o clique')
  await print(aba, 'h6-jogo-lote-nao-bateu', { fullPage: true })
  await aba.getByRole('button', { name: 'Registrar as que não bateram' }).click()
  await esperarSql(`SELECT IFNULL(prova_ok, '-') FROM carreiras WHERE id=${estado.pkE2}`, (x) => x === '0', 20000)
  await sleep(1000)
  await aba.close()
  const e = sql(`SELECT CONCAT_WS('|', e.estado, e.motivo IS NOT NULL, e.quem) FROM emblemas_usuario e JOIN desafios d ON d.id = e.desafio_id WHERE e.usuario_id=${estado.idE} AND d.slug='era-de-ouro'`)
  ok(sql(`SELECT prova_ok FROM carreiras WHERE id=${estado.pkE2}`) === '0' && e.startsWith('retirado|1|'), `"Registrar as que não bateram": a adulterada deixou de ser prova e o Era de ouro foi retirado (${e})`)
  ok(emblemasDe(estado.idE) === 'bandeira-do-clube,noite-de-gala' && sql(`SELECT COUNT(*) FROM conquistas_usuario WHERE usuario_id=${estado.idE} AND prova_pk=${estado.pkE2}`) === '0',
    'a conta fica com os 2 emblemas de verdade; a adulterada não prova mais nenhuma conquista')
  const ach = conquistasDe(estado.hallE)
  ok(ach.every((x) => provadasDaConta(estado.idE).has(x)) && Number(sql(`SELECT COUNT(*) FROM conquistas_usuario cu JOIN carreiras c ON c.id = cu.prova_pk WHERE cu.usuario_id=${estado.idE} AND c.prova_ok = 1`)) >= ach.length,
    `as ${ach.length} conquistas da carreira de verdade continuam provadas e agora conferidas`)
  ok(Number(sql(`SELECT COUNT(*) FROM admin_log WHERE acao='prova_verificar'`)) >= 2, 'registro: prova_verificar (as que bateram e a que não bateu)')
  const pf = await (await fetch(`${URL0}api/perfil.php?c=${estado.codigoE}`)).json()
  ok(JSON.stringify((pf.emblemas ?? []).map((x) => x.slug).sort()) === JSON.stringify(['bandeira-do-clube', 'noite-de-gala']), 'perfil público: o emblema retirado some')
  const eu = (await meuDesafio(page)).find((x) => x.slug === 'era-de-ouro')?.eu
  ok(eu?.emblema?.estado === 'retirado' && !!eu.emblema.motivo, `?eu=1: o jogador vê o emblema retirado com o motivo ("${eu?.emblema?.motivo}")`)
  // o painel: de volta à aba dele (visibilitychange; o navegador sem tela não troca de aba sozinho), a ficha se refaz com as
  // provas conferidas; e o Registro dá nome às ações novas
  const nP = provadasDaConta(estado.idE).size
  await painel.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  const refez = await painel.waitForFunction((n) => new RegExp(`${n} provadas de 87 · ${n} conferidas`).test(document.getElementById('gaveta')?.textContent ?? ''), nP, { timeout: 20000 }).then(() => true, () => false)
  const ficha = (await painel.textContent('#gaveta')) ?? ''
  ok(refez && /Emblemas/.test(ficha), `painel: de volta do lote, a ficha se refaz sozinha: "${nP} provadas de 87 · ${nP} conferidas" (${(/\d+ provadas de 87[^·]*·[^·]*conferidas/.exec(ficha) ?? [''])[0]})`)
  await print(painel, 'h6-painel-ficha-depois-do-lote')
  await irP('#/registro', 2200)
  await abaP().locator('tbody tr').first().waitFor({ timeout: 10000 })
  const reg = await abaP().locator('tbody').textContent()
  const nome = await painel.evaluate(() => window.LP?.NOMES_ACAO_LOG?.prova_verificar ?? 'prova_verificar')
  ok(reg.includes(nome) && nome !== 'prova_verificar', `Registro: "${nome}"`)
})

await etapa('h7. v3.4: SEO do build — título e JSON-LD, sitemap.xml só com as páginas de /lenda/, a chave do IndexNow e o indexnow.mjs --seco', async () => {
  const html = await (await fetch(URL0)).text()
  ok(/<title>LENDA · Jogo de carreira de futebol online grátis<\/title>/.test(html) && /<script type="application\/ld\+json">\{[^<]*"@type":\s*"VideoGame"/.test(html) && /<meta name="description" content="[^"]{120,170}"\s*\/?>/.test(html),
    'index.html: o título pensado para busca, a descrição (120 a 170 letras) e o JSON-LD de VideoGame')
  const rs = await fetch(`${URL0}sitemap.xml`)
  const xml = await rs.text()
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  ok(rs.status === 200 && JSON.stringify(locs) === JSON.stringify(['https://oprojeto.online/lenda/', 'https://oprojeto.online/lenda/privacidade.html']), `sitemap.xml: só as páginas públicas de /lenda/ (${locs.join(', ')})`)
  const chave = (/export const CHAVE_INDEXNOW = '([0-9a-f]+)'/.exec(readFileSync(new URL('../../../scripts/indexnow.mjs', import.meta.url), 'utf8')) ?? [])[1]
  const rk = await fetch(`${URL0}${chave}.txt`)
  ok(rk.status === 200 && (await rk.text()).trim() === chave, `a chave do IndexNow publicada em /lenda/${chave}.txt`)
  // (o php -S responde o index.html para arquivo que não existe: confere a pasta publicada)
  ok(!existsSync(`${BASE}/public_html/lenda/robots.txt`) && !existsSync(new URL('../../../dist-site/robots.txt', import.meta.url)), 'nenhum robots.txt no build (o da raiz do domínio é de outro site)')
  const seco = execFileSync('node', [new URL('../../../scripts/indexnow.mjs', import.meta.url).pathname, '--seco'], { encoding: 'utf8' })
  const pedido = JSON.parse(seco.slice(seco.indexOf('{')))
  ok(pedido.keyLocation === `https://oprojeto.online/lenda/${chave}.txt` && pedido.key === chave && pedido.host === 'oprojeto.online' && JSON.stringify(pedido.urlList) === JSON.stringify(locs) && /nada foi mandado/.test(seco),
    `indexnow.mjs --seco: o pedido com o keyLocation em /lenda/ e as URLs do sitemap, nada mandado (${pedido.urlList?.length} URLs)`)
})

// ───────────────────────── fim ─────────────────────────
await etapa('z. sem erro de console, sem 5xx, sem violação de CSP no painel', async () => {
  for (const p of [painel, MODp].filter(Boolean)) {
    const csp = await p.evaluate(() => window.__csp ?? []).catch(() => [])
    ok(csp.length === 0, `CSP do painel sem violação${csp.length ? `: ${csp.slice(0, 3).join(' | ')}` : ''}`)
  }
  const erros = aparelhos.flatMap((a) => a.erros)
  const r5 = aparelhos.flatMap((a) => a.respostas5xx)
  ok(erros.length === 0, `console sem erro${erros.length ? `:\n      ${erros.slice(0, 12).join('\n      ')}` : ''}`)
  ok(r5.length === 0, `nenhuma resposta 5xx${r5.length ? `: ${r5.join(', ')}` : ''}`)
  let log = ''
  try {
    log = readFileSync(`${BASE}/php-erros.log`, 'utf8').trim()
  } catch {}
  ok(!log, `log de erros do PHP vazio${log ? `:\n${log.slice(0, 800)}` : ''}`)
  estado.pinDono = PIN_DONO
})

await browser.close()
const r = resultado()
console.log(`\n${r.falhas ? 'FALHOU' : 'PASSOU'}: ${r.oks} ok, ${r.falhas} falhas (${Math.round((Date.now() - T0) / 1000)} s)`)
if (r.falhas) console.log(r.lista.map((f) => ' - ' + f).join('\n'))
process.exit(r.falhas ? 1 : 0)
