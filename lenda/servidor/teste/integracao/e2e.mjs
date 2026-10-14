// LENDA v3 · integração de ponta a ponta: jogo (dist-site) + servidor PHP + MariaDB + painel, com vários
// aparelhos ao mesmo tempo. Pilha: bash subir.sh (porta 8752; antes, npm run build:site). Uso: node e2e.mjs
// As carreiras são jogadas pela tela (ritmo Expresso, sempre a 1ª opção) com sementes fixas: as mesmas sementes
// dão as mesmas carreiras (a 1004 é um goleiro boliviano que passa pelo Cruzeiro; a 1011 e a 1001 passam de 90).
//   C = visitante sem conta · A = Ian (cria conta depois de 5 partidas, joga, salva, convida, compartilha)
//   B = amigo convidado pelo link ?c= · A2 = segundo aparelho do Ian · ADM = painel do admin
import { readFileSync, writeFileSync } from 'node:fs'
import { lancar, aparelho, jogarCarreira, ultimaTerminada, lerKv, sql, esperarSql, admin, ok, resultado, sleep, URL0, ORIGEM, PRINTS, env, BASE } from './lib.mjs'

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
    for (const a of aparelhos) await print(a.page, `ERRO-${nome.replace(/\W+/g, '_').slice(0, 30)}-${a.nome}`)
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
  await d.getByLabel('Apelido').fill('Ian Cruzeiro')
  await d.getByLabel('E-mail').fill(EMAIL_A)
  await d.getByLabel('Senha', { exact: true }).fill(SENHA)
  await d.getByRole('checkbox').first().check()
  await d.getByRole('button', { name: 'Criar conta', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[role="dialog"].sc-modal'), null, { timeout: 20000 })
  estado.idA = idUsuario(EMAIL_A)
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
  const r = await jogarCarreira(page, { semente: SEM.cruzeiro, nacao: 'Bolívia', sobrenome: 'DANTAS' })
  ok(r.fim, `A: carreira DANTAS até o fim (${Math.round(r.ms / 1000)} s)`)
  await sleep(1500)
  const h = await ultimaTerminada(page)
  estado.idDantas = h.id
  ok(h.identity.nationality === 'BOL' && (h.summary.clubs ?? []).some((c) => c.clubId === 'e2022'), `DANTAS é boliviano e passou pelo Cruzeiro (${(h.summary.clubs ?? []).map((c) => c.clubId).join(',')})`)
  ok(h.summary.peakOvr < 90, `pico ${h.summary.peakOvr} (< 90: não salva sozinha)`)
  await page.locator('.ck-end').getByRole('button', { name: 'Salvar na minha conta' }).click()
  await esperarTexto(page, 'Salva na sua conta')
  await print(page, 'b3-A-salvar-botao')
  const linha = sql(`SELECT CONCAT_WS('|', como, nota_v, pais, clubes LIKE '%e2022%', suspeita IS NULL) FROM carreiras WHERE carreira_id='${h.id}'`)
  ok(linha === 'manual|2|BOL|1|1', `servidor: manual, nota v2, BOL, Cruzeiro, sem suspeita (${linha})`)
  const pc = await esperarSql(`SELECT partidas_conta FROM usuarios WHERE id=${estado.idA}`, (x) => x === '1')
  ok(pc === '1', `servidor: 1 partida com a conta (${pc})`)
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
  await d.getByLabel('Apelido').fill('Bruno Amigo')
  await d.getByLabel('E-mail').fill(EMAIL_B)
  await d.getByLabel('Senha', { exact: true }).fill(SENHA)
  await d.getByRole('checkbox').first().check()
  await print(page, 'c1-B-cadastro-convite')
  await d.getByRole('button', { name: 'Criar conta', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[role="dialog"].sc-modal'), null, { timeout: 20000 })
  estado.idB = idUsuario(EMAIL_B)
  ok(sql(`SELECT status FROM indicacoes WHERE indicado_id=${estado.idB} AND indicador_id=${estado.idA}`) === 'pendente', 'indicação A → B pendente')
})

await etapa('c2. B termina 1 partida e joga 3 min → indicação válida; bônus do A guardado', async () => {
  const { page } = B
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
  await page.locator('.ck-end').getByRole('button', { name: 'Salvar na minha conta' }).click()
  await esperarTexto(page, 'Salva na sua conta')
  ok(sql(`SELECT como FROM carreiras WHERE carreira_id='${h.id}' AND usuario_id=${estado.idB}`) === 'manual', 'B salvou a carreira pelo botão')
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
  ok((await page.evaluate(() => window.__textoCompartilhado)).includes(`?c=${estado.codigoA}`), 'o texto compartilhado leva o link com o código de convite')
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
  if (h.summary.peakOvr < 90) {
    await page.locator('.ck-end').getByRole('button', { name: 'Salvar na minha conta' }).click()
  }
  await esperarTexto(page, 'Salva na sua conta', 30000)
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
  await d.getByLabel('E-mail').fill(EMAIL_A)
  await d.getByLabel('Senha', { exact: true }).fill(SENHA)
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

const ADM = await novo('ADM', { partidas: 0, viewport: { width: 1440, height: 900 } })
const painel = ADM.page
const dialogo = () => painel.locator('dialog[open]').last()
const confirmar = () => dialogo().locator('button[type="submit"]').click()
const avisoPainel = async (re, ms = 10000) => {
  try {
    await painel.waitForFunction((src) => [...document.querySelectorAll('.aviso-flutuante')].some((a) => new RegExp(src, 'i').test(a.textContent)), re.source, { timeout: ms })
    return true
  } catch {
    return false
  }
}
const limparAvisos = () => painel.evaluate(() => document.querySelectorAll('.aviso-flutuante').forEach((a) => a.remove()))

await etapa('d2. admin entra no painel e força "Atualizar Hall agora"', async () => {
  await painel.goto(`${URL0}painel/`)
  await painel.fill('#senha', 'errada-de-proposito')
  await painel.click('#botao-entrar')
  await painel.waitForFunction(() => (document.querySelector('#erro-entrar')?.textContent ?? '').trim().length > 0, null, { timeout: 8000 })
  ok(true, 'painel: senha errada recusada')
  await painel.fill('#senha', env.PAINEL_SENHA)
  await painel.click('#botao-entrar')
  await painel.waitForSelector('#tela-painel:not([hidden])', { timeout: 10000 })
  ok(true, 'painel: entrou com a senha')
  await painel.click('.abas a[data-aba="hall"]')
  await painel.waitForSelector('#aba-hall .cartao', { timeout: 10000 })
  await limparAvisos()
  await painel.click('#aba-hall button:has-text("Atualizar Hall agora")')
  ok(await avisoPainel(/Hall atualizado: \d+ carreiras/), 'painel: "Atualizar Hall agora"')
  ok((await painel.locator('#aba-hall button', { hasText: 'Esperando revisão' }).count()) === 1, 'painel: Hall público com a aba "Esperando revisão" (nota 90+)')
  await sleep(800)
  const hall = await hallApi()
  estado.hall1 = hall.itens.map((i) => `${i.posicao}:${i.jogador}:${i.apelido}`)
  ok(hall.itens.some((i) => i.id === estado.idDantas && i.apelido === 'Ian Cruzeiro') && hall.itens.some((i) => i.id === estado.idAmigao && i.apelido === 'Bruno Amigo'), `hall.php: ${estado.hall1.join(' · ')}`)
  ok(hall.itens.filter((i) => i.apelido === 'Ian Cruzeiro').length <= 3, 'A tem no máximo 3 no Hall público')
  await print(painel, 'd2-painel-hall')
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

// ───────────────────────── e. admin no painel ─────────────────────────
await etapa('e1. painel: visão geral e usuários', async () => {
  await painel.click('.abas a[data-aba="visao"]')
  await painel.waitForSelector('#ladrilhos .ladrilho', { timeout: 15000 })
  await painel.waitForSelector('#ladrilhos-plataforma .ladrilho', { timeout: 15000 })
  await sleep(1000)
  const vis = await painel.textContent('#ladrilhos')
  ok(/Visitantes/i.test(vis), 'visão geral: números do período')
  const p = await admin(null, { r: 'resumo' })
  ok(p.json?.usuarios?.total === 2 && p.json?.denunciasAbertas === 1, `resumo: 2 contas, 1 denúncia aberta (${JSON.stringify(p.json?.usuarios)})`)
  const pn = await (await fetch(`${URL0}api/painel.php`, { headers: { Authorization: `Bearer ${env.PAINEL_TOKEN}` } })).json()
  ok(pn.periodo.visitantes >= 4 && pn.periodo.cadastros === 2, `painel.php: ${pn.periodo.visitantes} visitantes (A, A2, B, C…), ${pn.periodo.cadastros} cadastros, ${pn.periodo.jogaram} jogaram`)
  ok(typeof pn.geradoEm === 'string' && Date.now() - Date.parse(pn.geradoEm) < 120_000, `painel.php: números guardados por até 90 s (geradoEm ${pn.geradoEm})`)
  await print(painel, 'e1-painel-visao-geral', { fullPage: true })
  await painel.click('.abas a[data-aba="usuarios"]')
  await painel.waitForSelector('#aba-usuarios .lista tbody tr', { timeout: 10000 })
  const linhas = (await painel.locator('#aba-usuarios tbody tr').allInnerTexts()).join(' | ')
  ok(/Ian Cruzeiro/.test(linhas) && /Bruno Amigo/.test(linhas), 'usuários: A e B na lista')
  await print(painel, 'e1-painel-usuarios')
})

await etapa('e2. painel: suspender B → B deslogado e fora do Hall; reativar', async () => {
  await painel.goto(`${URL0}painel/#/usuario/${estado.idB}`)
  await painel.waitForSelector('#aba-usuario .perfil-nome h2', { timeout: 10000 })
  ok((await painel.textContent('#aba-usuario .perfil-nome h2')) === 'Bruno Amigo', 'detalhe do B')
  const det = await painel.textContent('#aba-usuario')
  ok(/AMIGAO/.test(det), 'detalhe do B: a carreira AMIGAO')
  await print(painel, 'e2-painel-detalhe-B', { fullPage: true })
  await limparAvisos()
  await painel.click('#aba-usuario button:has-text("Suspender")')
  await dialogo().locator('textarea').fill('Teste de moderação')
  await confirmar()
  ok(await avisoPainel(/suspens/), 'suspender B')
  await painel.waitForSelector('#aba-usuario .faixa-perigo', { timeout: 10000 })
  ok(sql(`SELECT COUNT(*) FROM sessoes_login WHERE usuario_id=${estado.idB}`) === '0', 'sessões do B encerradas')
  const h = await hallApi()
  ok(!h.itens.some((i) => i.id === estado.idAmigao), 'hall.php: a carreira do B saiu do Hall na hora')
  // B no aparelho dele: deslogado
  const { page } = B
  await page.goto(`${URL0}#/`)
  await page.reload()
  await page.waitForSelector('.ld-modes', { timeout: 30000 })
  await sleep(2000)
  const m = await menu(page)
  // o bloco de conta do menu é um pedaço à parte (chega logo depois de abrir, se ainda não veio)
  await m.getByText(/Entrar \/ Criar conta|Minha conta/).first().waitFor({ timeout: 10000 })
  ok((await m.innerText()).includes('Entrar / Criar conta') && !(await m.innerText()).includes('Bruno Amigo'), 'B: deslogado no aparelho (o menu volta a "Entrar / Criar conta")')
  const errosAntes = B.erros.length
  await m.getByText('Entrar / Criar conta').click()
  const d = page.locator('[role="dialog"].sc-modal')
  await d.waitFor()
  await d.getByRole('tab', { name: /Já tenho conta|Entrar/ }).first().click().catch(() => {})
  await d.getByLabel('E-mail').fill(EMAIL_B)
  await d.getByLabel('Senha', { exact: true }).fill(SENHA)
  await d.getByRole('button', { name: 'Entrar', exact: true }).click()
  await d.getByText(/suspensa/i).first().waitFor({ timeout: 10000 })
  ok(true, 'B: entrar com a conta suspensa mostra "suspensa"')
  // o 403 do "entrar" suspenso é a resposta esperada (o navegador registra no console)
  B.erros.splice(errosAntes, B.erros.length - errosAntes, ...B.erros.slice(errosAntes).filter((x) => !/status of 403/.test(x)))
  await print(page, 'e2-B-suspenso')
  await page.keyboard.press('Escape')
  // reativar
  await limparAvisos()
  await painel.click('#aba-usuario button:has-text("Reativar")')
  await confirmar()
  ok(await avisoPainel(/reativad/), 'reativar B')
  const m2 = await menu(page)
  await m2.getByText('Entrar / Criar conta').click()
  const d2 = page.locator('[role="dialog"].sc-modal')
  await d2.waitFor()
  await d2.getByLabel('E-mail').fill(EMAIL_B)
  await d2.getByLabel('Senha', { exact: true }).fill(SENHA)
  await d2.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[role="dialog"].sc-modal'), null, { timeout: 15000 })
  ok(true, 'B: entra de novo depois de reativado')
  const r = await admin({ acao: 'atualizar_hall' })
  ok(r.status === 200 && (await hallApi()).itens.some((i) => i.id === estado.idAmigao), 'depois de reativar + atualizar: a carreira do B volta ao Hall')
})

await etapa('e3. painel: renomear e dar bônus ao B', async () => {
  await painel.goto(`${URL0}painel/#/usuario/${estado.idB}`)
  await painel.waitForSelector('#aba-usuario .perfil-nome h2', { timeout: 10000 })
  await limparAvisos()
  await painel.click('#aba-usuario button:has-text("Renomear")')
  await dialogo().locator('input').fill('Bruno Moderado')
  await confirmar()
  ok(await avisoPainel(/trocado para Bruno Moderado/), 'renomear B')
  const it = (await hallApi()).itens.find((i) => i.id === estado.idAmigao)
  ok(it?.apelido === 'Bruno Moderado', `hall.php já mostra o apelido novo (${it?.apelido})`)
  await limparAvisos()
  await painel.click('#aba-usuario .perfil-acoes button:has-text("Dar bônus")')
  await dialogo().locator('button[role="radio"]:has-text("+1")').click()
  await dialogo().locator('input').fill('Presente da moderação')
  await confirmar()
  ok(await avisoPainel(/Bônus dado/), 'dar bônus +1 ao B')
  await print(painel, 'e3-painel-B-renomeado-bonus', { fullPage: true })
  const { page } = B
  // a criação da carreira pergunta o bonus.php na hora: o presente aparece sem recarregar o jogo
  await page.goto(`${URL0}#/identidade?ritmo=expressa`)
  await page.locator('.id-bonus').waitFor({ timeout: 20000 })
  const t = await page.locator('.id-bonus').innerText()
  ok(/\+1/.test(t) && /presente do LENDA/.test(t), `B vê o bônus na criação da carreira ("${t.replace(/\s+/g, ' ').slice(0, 50)}")`)
  await print(page, 'e3-B-bonus-admin')
})

await etapa('e4. painel: ocultar carreira do Hall e resolver a denúncia', async () => {
  await painel.click('.abas a[data-aba="hall"]')
  await painel.waitForSelector('#aba-hall .lista tbody tr', { timeout: 10000 })
  await painel.click('#aba-hall .segmentos button:has-text("No Hall")')
  await sleep(800)
  const alvo = estado.foraDoHallA === 'FENOMENO' ? 'MURALHA' : 'FENOMENO'
  const idAlvo = alvo === 'FENOMENO' ? estado.idFenomeno : estado.idMuralha
  ok((await hallApi()).itens.some((i) => i.id === idAlvo), `${alvo} está no Hall antes`)
  await limparAvisos()
  await painel.locator('#aba-hall tbody tr', { hasText: alvo }).first().locator('button:has-text("Ocultar")').click()
  await confirmar()
  ok(await avisoPainel(/Carreira oculta/), `ocultar ${alvo}`)
  ok(!(await hallApi()).itens.some((i) => i.id === idAlvo), `hall.php: ${alvo} saiu na hora`)
  await print(painel, 'e4-painel-hall-ocultar')
  await painel.click('.abas a[data-aba="denuncias"]')
  await painel.waitForSelector('#aba-denuncias .denuncia', { timeout: 10000 })
  const den = await painel.textContent('#aba-denuncias')
  ok(/DANTAS/.test(den) && /Números estranhos <b>teste<\/b>/.test(den) && (await painel.locator('#aba-denuncias .denuncia b:has-text("teste")').count()) === 0, 'denúncias: a do B sobre a DANTAS, texto escapado')
  await print(painel, 'e4-painel-denuncias')
  await limparAvisos()
  await painel.locator('#aba-denuncias .denuncia', { hasText: 'DANTAS' }).locator('button:has-text("Manter no Hall")').click()
  await confirmar()
  ok(await avisoPainel(/fechad/), 'denúncia resolvida: manter no Hall')
  ok(sql(`SELECT COUNT(*) FROM denuncias WHERE status='aberta'`) === '0' && (await hallApi()).itens.some((i) => i.id === estado.idDantas), 'DANTAS continua no Hall, nenhuma denúncia aberta')
})

await etapa('e5. painel: configurações (aviso no jogo; Imersivo aberto e fechado ao público)', async () => {
  await painel.click('.abas a[data-aba="config"]')
  await painel.waitForSelector('#aba-config .config-grade', { timeout: 10000 })
  await painel.locator('[data-chave="aviso"] .interruptor').click()
  await painel.fill('#cfg-aviso-texto', 'Hall das Lendas atualizado a cada hora!')
  await painel.locator('[data-chave="imersivo_publico"] .interruptor').click()
  await limparAvisos()
  await painel.click('#aba-config .barra-salvar button:has-text("Salvar")')
  await dialogo().waitFor()
  await print(painel, 'e5-painel-config-confirmar')
  await confirmar()
  ok(await avisoPainel(/Configurações salvas/), 'config salva: aviso + Imersivo aberto')
  const { page } = C
  await page.goto(`${URL0}#/`)
  await page.reload()
  await page.locator('.lx-aviso').waitFor({ timeout: 20000 })
  ok((await page.locator('.lx-aviso').innerText()).includes('Hall das Lendas atualizado a cada hora!'), 'C vê o aviso no topo do jogo')
  await page.waitForSelector('.ld-modes')
  await sleep(1500)
  const imm = page.locator('.ld-mode').nth(1)
  ok((await imm.getAttribute('aria-disabled')) === null && !/Em desenvolvimento/.test(await imm.innerText()), 'C (público): cartão do Imersivo liberado')
  await print(page, 'e5-C-aviso-imersivo-aberto')
  await page.goto(`${URL0}#/identidade?modo=imersivo`)
  await page.waitForSelector('#id-surname', { timeout: 30000 })
  ok((await page.getByText('Partida a partida,').count()) === 0 && (await page.locator('.pt-selo').count()) === 0, 'C: o Imersivo abre para o público (sem "Em breve" e sem selo de admin)')
  await print(page, 'e5-C-imersivo-publico')
  // volta a fechar
  await painel.locator('[data-chave="imersivo_publico"] .interruptor').click()
  await painel.locator('[data-chave="aviso"] .interruptor').click()
  await limparAvisos()
  await painel.click('#aba-config .barra-salvar button:has-text("Salvar")')
  await confirmar()
  ok(await avisoPainel(/Configurações salvas/), 'config salva: Imersivo fechado de novo, sem aviso')
  await page.goto(`${URL0}#/imersivo`)
  await page.reload()
  await esperarTexto(page, 'Partida a partida,', 20000)
  ok((await page.locator('.lx-aviso').count()) === 0, 'C: Imersivo volta a "Em breve" e o aviso some')
  const cfg = await (await fetch(`${URL0}api/conta.php`)).json()
  ok(cfg.site.imersivoPublico === false && cfg.site.livePublica === false && cfg.site.aviso === null, 'conta.php: Imersivo e Live fechados ao público')
})

await etapa('e6. painel: Testes → Imersivo e Live em outra aba (só o admin)', async () => {
  await painel.click('.abas a[data-aba="testes"]')
  await painel.waitForSelector('.grade-testes', { timeout: 10000 })
  await print(painel, 'e6-painel-testes')
  const [imm] = await Promise.all([ADM.ctx.waitForEvent('page'), painel.click('a:has-text("Nova carreira no Imersivo")')])
  await imm.waitForSelector('#id-surname', { timeout: 30000 })
  await imm.locator('.pt-selo').waitFor({ timeout: 20000 })
  ok((await imm.locator('.pt-selo').innerText()).includes('Teste · só admin'), 'outra aba: Imersivo (nova carreira) com o selo "Teste · só admin"')
  await print(imm, 'e6-admin-imersivo-teste')
  await imm.close()
  const [live] = await Promise.all([ADM.ctx.waitForEvent('page'), painel.click('a:has-text("Abrir a Live")')])
  await live.waitForLoadState()
  await sleep(4000)
  ok((await live.getByText('Página não encontrada').count()) === 0, 'outra aba: a Live abre para o admin')
  await print(live, 'e6-admin-live')
  await live.close()
  // o mesmo endereço, sem o cookie do painel, continua fechado
  await C.page.goto(`${URL0}#/live`)
  await esperarTexto(C.page, 'Página não encontrada', 15000)
  ok(true, 'C (público) no mesmo endereço: "Página não encontrada"')
})

await etapa('e7. painel: exportar CSV e Registro', async () => {
  await painel.click('.abas a[data-aba="usuarios"]')
  await painel.waitForSelector('#aba-usuarios .lista tbody tr', { timeout: 10000 })
  const [csv] = await Promise.all([painel.waitForEvent('download', { timeout: 15000 }), painel.click('#acoes-aba button:has-text("Exportar CSV")')])
  const conteudo = readFileSync(await csv.path()).toString('utf8')
  const linhas = conteudo.replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  ok(conteudo.charCodeAt(0) === 0xfeff && linhas.length === 3 && conteudo.includes(EMAIL_A) && conteudo.includes(EMAIL_B) && /Bruno Moderado/.test(conteudo), `CSV: BOM + cabeçalho + 2 contas (${csv.suggestedFilename()})`)
  await painel.click('.abas a[data-aba="registro"]')
  await painel.waitForSelector('#aba-registro .lista tbody tr', { timeout: 10000 })
  const reg = await painel.textContent('#aba-registro tbody')
  const faltam = ['Exportou usuários', 'Suspendeu conta', 'Reativou conta', 'Renomeou', 'Deu bônus', 'Ocultou carreira', 'Resolveu denúncia', 'Mudou configurações', 'Atualizou o Hall'].filter((a) => !reg.includes(a))
  ok(faltam.length === 0, `Registro com todas as ações${faltam.length ? ` (faltam: ${faltam.join(', ')})` : ''}`)
  await print(painel, 'e7-painel-registro')
})

// ───────────────────────── fim ─────────────────────────
await etapa('z. sem erro de console nem 5xx', async () => {
  const erros = aparelhos.flatMap((a) => a.erros)
  const r5 = aparelhos.flatMap((a) => a.respostas5xx)
  ok(erros.length === 0, `console sem erro${erros.length ? `:\n      ${erros.slice(0, 12).join('\n      ')}` : ''}`)
  ok(r5.length === 0, `nenhuma resposta 5xx${r5.length ? `: ${r5.join(', ')}` : ''}`)
  let log = ''
  try {
    log = readFileSync(`${BASE}/php-erros.log`, 'utf8').trim()
  } catch {}
  ok(!log, `log de erros do PHP vazio${log ? `:\n${log.slice(0, 800)}` : ''}`)
})

await browser.close()
const r = resultado()
console.log(`\n${r.falhas ? 'FALHOU' : 'PASSOU'}: ${r.oks} ok, ${r.falhas} falhas (${Math.round((Date.now() - T0) / 1000)} s)`)
if (r.falhas) console.log(r.lista.map((f) => ' - ' + f).join('\n'))
process.exit(r.falhas ? 1 : 0)
