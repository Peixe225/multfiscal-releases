// LENDA · teste funcional do painel do administrador pelo navegador (Playwright + Chromium) contra a pilha real que o
// rodar.sh montou (php -S + MariaDB + a semente). Confere o que o MAPA pede na tela: entrada com PIN, números de ação ao
// vivo, "Precisa de atenção", busca ao vivo, filtros, ficha no painel lateral, motivo obrigatório, confirmação digitada
// conferida no servidor, lote com sinais, lixeira, fila ao vivo, Na área, relatórios e CSV, registro, equipe e senha
// provisória, papéis e poderes, X1 (revisão do Hall), X4 (abrir no jogo), X5 (bônus), temas, modo discreto, CSP e
// celular sem rolagem lateral. Com LENDA_PRINTS=<pasta>, tira os prints de cada aba em 1440 e 390 antes de mexer.
const { chromium } = await import(process.env.LENDA_PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright/index.mjs')
import { readFileSync, mkdirSync } from 'node:fs'
import { BASE, PAINEL, ORIGEM, env, esc, ok, pedido, resultado, sleep, sql, uuid } from './lib.mjs'

const EXE = process.env.LENDA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const PRINTS = process.env.LENDA_PRINTS || ''
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const S = JSON.parse(readFileSync(`${BASE}/semente.json`, 'utf8'))
const browser = await chromium.launch({ executablePath: EXE, args: ['--lang=pt-BR'] })
const t0 = performance.now()
// se um passo travar (seletor que não aparece), o resumo sai assim mesmo, com o hash e um print da tela daquela hora
let paginaAtual = null
process.on('uncaughtException', async (e) => {
  console.log(`  XX  o teste parou: ${String(e && e.message || e).split('\n')[0]}`)
  try {
    if (paginaAtual) {
      console.log('      na tela: ' + await paginaAtual.evaluate(() => location.hash + ' · ' + (document.querySelector('.aba:not([hidden]) .barra-lote')?.innerText || '').replace(/\n/g, ' | ')))
      await paginaAtual.screenshot({ path: `${BASE}/falha.png` })
      console.log(`      print: ${BASE}/falha.png`)
    }
  } catch { /* sem página */ }
  const r = resultado()
  console.log(`\npainel: ${r.oks} ok, ${r.falhas + 1} falha(s)`)
  process.exit(1)
})

// v3.3: Mensagens (Fale conosco) depois de Usuários e Desafios depois de Indicações (sem tecla: as de sempre não mudam)
const ABAS = ['visao', 'area', 'usuarios', 'mensagens', 'hall', 'denuncias', 'indicacoes', 'desafios', 'conquistas', 'relatorios', 'tempo', 'registro', 'saude', 'equipe', 'config', 'testes']
const PRINTS_EXTRAS = ['hall?filtro=suspeitas', 'hall?filtro=denunciadas', 'hall?filtro=lixeira', 'indicacoes?status=aparelho', 'indicacoes?status=bonus',
  'registro?parte=seguranca', 'registro?parte=emails', 'registro?parte=jogadores', 'config?parte=conta', 'config?parte=backup', 'equipe?parte=papeis', 'equipe?parte=recados']

async function novoAparelho(largura, extra = {}) {
  const celular = largura < 600
  const ctx = await browser.newContext({
    viewport: { width: largura, height: celular ? 844 : 900 }, deviceScaleFactor: 1, isMobile: celular, hasTouch: celular,
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'], ...extra,
  })
  const page = await ctx.newPage()
  paginaAtual = page
  page.erros = []
  // "Failed to load resource" de 4xx são respostas esperadas (401 antes de entrar, 400 do PIN fraco/errado, 403 sem
  // poder): cada resposta 5xx entra como erro, e qualquer outro erro do console também
  page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) page.erros.push(m.text()) })
  page.on('response', (r) => { if (r.status() >= 500) page.erros.push(`HTTP ${r.status()} em ${r.url()}`) })
  page.on('pageerror', (e) => page.erros.push('pageerror: ' + e.message))
  await page.addInitScript(() => {
    window.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI))
  })
  page.confirmar = true
  page.on('dialog', (d) => (page.confirmar ? d.accept() : d.dismiss()))
  return { ctx, page }
}
const ir = async (page, hash, espera = 1200) => {
  await page.evaluate((x) => { location.hash = x }, hash)
  await page.waitForTimeout(espera)
}
const aba = (page) => page.locator('.aba:not([hidden])')
const toast = (page) => page.locator('#avisos .aviso-flutuante').last()
async function esperarToast(page, re, ms = 8000) {
  try {
    await page.waitForFunction((r) => Array.from(document.querySelectorAll('#avisos .aviso-flutuante')).some((x) => new RegExp(r, 'i').test(x.textContent)), re.source, { timeout: ms })
    return true
  } catch { return false }
}
async function entrar(page, { email = '', senha = env.PAINEL_SENHA } = {}) {
  await page.goto(PAINEL)
  await page.waitForSelector('#form-entrar:not([hidden]), #tela-painel:not([hidden])', { timeout: 15000 })
  if (await page.isVisible('#tela-painel')) return
  if (email) await page.fill('#email', email)
  await page.fill('#senha', senha)
  await page.click('#botao-entrar')
}
async function digitarPin(page, raiz, pin) {
  await page.locator(`${raiz} .pin-caixa`).first().click()
  await page.keyboard.type(pin, { delay: 30 })
}
async function semRolagemLateral(page, nome) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
  return ok(w[0] <= w[1], `${nome}: sem rolagem lateral no celular (${w[0]} ≤ ${w[1]})`)
}
/** Visitas "ao vivo" de jogadores (batimentos agora), para a Na área ter gente. */
async function batimentos() {
  for (const [nome, rota, m] of [['ReiDoDrible', '/carreira', 'classico'], ['Camisa10', '/hall', null], ['Lobo_Azul', '/imersivo', 'imersivo']]) {
    const c = S.contas[nome]
    const s = uuid()
    await pedido('api/e.php', { texto: true, ip: c.ip, cookie: c.cookie, corpo: { v: c.v, s, bot: 0, ctx: { dev: 'mobile', lang: 'pt-BR' }, ev: [{ t: 'view', m: null, d: { rota } }, { t: 'hb', p: m ? 1 : 0, m: m ?? undefined }] } })
  }
  await pedido('api/e.php', { texto: true, ip: '10.66.0.9', corpo: { v: uuid(), s: uuid(), bot: 0, ctx: { dev: 'desktop', lang: 'pt-BR' }, ev: [{ t: 'view', m: null, d: { rota: '/' } }, { t: 'hb', p: 0 }] } })
}

// ═══ 0. prints (antes de mexer nos dados) ═══════════════════════════════════════════════════
if (PRINTS) {
  await batimentos()
  for (const largura of [1440, 390]) {
    const { ctx, page } = await novoAparelho(largura)
    await page.goto(PAINEL)
    await page.waitForSelector('#form-entrar:not([hidden])')
    await page.screenshot({ path: `${PRINTS}/${largura}-00-entrada.png` })
    await entrar(page)
    await page.waitForSelector('#tela-painel:not([hidden])')
    await page.waitForTimeout(1500)
    let k = 1
    for (const a of ABAS.concat(PRINTS_EXTRAS)) {
      await ir(page, '#/' + a, 1800)
      await page.screenshot({ path: `${PRINTS}/${largura}-${String(k++).padStart(2, '0')}-${a.replace(/[^a-z0-9]+/gi, '-')}.png`, fullPage: true })
    }
    await ir(page, '#/usuarios?conta=' + S.contas['Fera.Gol'].id, 1800)
    await page.screenshot({ path: `${PRINTS}/${largura}-${k++}-ficha-conta.png` })
    await page.locator('#gaveta .gaveta-corpo').evaluate((e) => { e.scrollTop = 900 })
    await page.screenshot({ path: `${PRINTS}/${largura}-${k++}-ficha-conta-baixo.png` })
    await ir(page, '#/hall?filtro=suspeitas&carreira=' + S.pkGols, 1800)
    await page.screenshot({ path: `${PRINTS}/${largura}-${k++}-ficha-carreira.png` })
    await ir(page, '#/hall?filtro=suspeitas', 1500)
    await aba(page).locator('tbody input[type=checkbox]').first().check()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${PRINTS}/${largura}-${k++}-lote-marcado.png` })
    await aba(page).locator('.barra-lote-acoes button').first().click()
    await page.waitForSelector('dialog[open]')
    await page.locator('dialog[open] .chip-motivo').first().click()
    await page.screenshot({ path: `${PRINTS}/${largura}-${k++}-dialogo-motivo.png` })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    for (const tema of ['claro', 'alto']) {
      await page.keyboard.press('t')
      await ir(page, '#/visao', 1500)
      await page.screenshot({ path: `${PRINTS}/${largura}-${k++}-tema-${tema}.png` })
    }
    await page.keyboard.press('t')
    await ctx.close()
  }
  console.log(`· prints em ${PRINTS}`)
}

// ═══ 1. entrada, sessão, Visão geral, pulso, atenção ════════════════════════════════════════
const { ctx, page } = await novoAparelho(1440)
await page.goto(PAINEL)
await page.waitForSelector('#form-entrar:not([hidden])')
ok(await page.isVisible('#campo-email'), 'entrada: com conta pessoal na equipe, o campo E-mail aparece (modo contas)')
await page.fill('#senha', 'senha-errada-de-teste')
await page.click('#botao-entrar')
await page.waitForSelector('#erro-entrar:not([hidden])')
ok(/não conferem|incorreta/i.test(await page.textContent('#erro-entrar')), 'entrada: senha errada mostra a mensagem genérica do servidor')
await entrar(page)
await page.waitForSelector('#tela-painel:not([hidden])', { timeout: 15000 })
ok(true, 'entrada: a senha do arquivo (sem e-mail) entra na conta Dono')
await page.waitForFunction(() => /atualizado às/.test(document.getElementById('selo-atualizado').textContent), null, { timeout: 20000 })
ok(true, 'pulso: o selo "atualizado às HH:MM:SS" aparece')
ok(await page.locator('#numeros-acao .numero-acao').count() === 8, 'números de ação: os 8 (online, jogando, denúncias, suspeitas, indicações, mensagens novas, candidatos a desafio, contas hoje)')
ok(/^\d+$/.test((await page.textContent('#nav-denunciasAbertas')).trim()), 'números de ação: denúncias abertas com número')
ok(await page.locator('#na-denunciasAbertas.na-perigo').count() === 1, 'números de ação: denúncias em vermelho quando há carreira escondida por denúncia')
await page.waitForSelector('#atencao:not([hidden])')
const atencao = await page.textContent('#atencao')
ok(/escondida por denúncias/.test(atencao) && /indicou 6 contas/.test(atencao) && /mesmo aparelho/.test(atencao), 'atenção: os alertas da semente (escondida, série de indicações, mesmo aparelho)')
ok(Number(await page.textContent('#cont-visao')) >= 1, 'pílula da Visão geral com o número de graves')
ok(await page.isVisible('.faixa-ouro >> text=Cadastre o seu PIN'), 'faixa "Cadastre o seu PIN" na conta Dono sem PIN')
await page.waitForFunction(() => document.querySelectorAll('#ladrilhos .ladrilho').length === 12, null, { timeout: 10000 })
ok(true, 'Visão geral: os 12 ladrilhos do período continuam')
ok(await page.locator('#grafico-dias svg').count() === 1 && await page.locator('#funil .barra-linha').count() === 5, 'Visão geral: gráfico por dia e funil')
ok(await page.locator('#campanhas .barra-linha').count() > 0, 'Visão geral: campanhas por campo do link (A4)')
ok(await page.locator('#ladrilhos-contas .ladrilho-resumo').count() === 3, 'Visão geral: ativas em 7 e 30 dias e nunca jogaram (P1-11)')
ok(await page.locator('#visao-base a.ladrilho').count() === 8, 'Visão geral: saúde da base com 8 números clicáveis (A10)')
ok(await page.locator('#visao-resposta .ladrilho').count() === 6, 'Visão geral: tempo de resposta de denúncias e indicações (H14/A8)')
ok((await page.locator('.abas a[data-aba]').evaluateAll((as) => as.map((a) => a.dataset.aba))).join(',') === ABAS.join(','), 'navegação: as 16 abas na ordem fixa (v3.3: Mensagens e Desafios)')
await ir(page, '#/nao-existe')
ok(await page.locator('#aba-visao:not([hidden])').count() === 1, 'navegação: aba desconhecida cai na Visão geral')
ok(await page.getAttribute('.abas a[data-aba="visao"]', 'aria-current') === 'page', 'navegação: aria-current na aba aberta')

// ═══ 2. Usuários: busca ao vivo, filtros, ficha, nota, tipo, discreto ════════════════════════
await ir(page, '#/usuarios')
const busca = aba(page).locator('input[type=search]')
await busca.fill('R')
await page.waitForTimeout(500)
ok(/digite 2\+ letras/i.test(await aba(page).locator('.busca-estado').textContent()), 'busca: com 1 letra pede "DIGITE 2+ LETRAS"')
await busca.fill('ReiDo')
await page.waitForFunction(() => /1 encontrada/i.test(document.querySelector('.aba:not([hidden]) .busca-estado').textContent), null, { timeout: 8000 })
ok(true, 'busca ao vivo: "1 encontrada" (o total da API)')
ok(await page.evaluate(() => document.activeElement && document.activeElement.type === 'search'), 'busca: o campo não perde o foco')
ok(/q=ReiDo/.test(await page.evaluate(() => location.hash)), 'estado no hash: q=')
await busca.fill('')
await page.waitForTimeout(700)
await aba(page).locator('.chip-filtro', { hasText: 'Suspensos' }).click()
await page.waitForTimeout(900)
ok(await aba(page).locator('tbody tr').count() === 2, 'filtro Suspensos: as 2 contas suspensas')
ok(/status=suspenso/.test(await page.evaluate(() => location.hash)), 'estado no hash: status=suspenso')
await aba(page).locator('.chip-filtro', { hasText: 'Todos' }).click()
await page.waitForTimeout(900)
ok(await aba(page).locator('.email-mascara').first().isVisible() && !(await aba(page).locator('.email-real').first().isVisible()), 'modo discreto (padrão): e-mail mascarado')
await page.keyboard.press('m')
ok(await aba(page).locator('.email-real').first().isVisible(), 'atalho M: mostra os e-mails inteiros')
await page.keyboard.press('m')
const fera = S.contas['Fera.Gol']
await aba(page).locator('tbody tr', { hasText: 'Fera.Gol' }).first().click()
await page.waitForSelector('#gaveta:not([hidden]) .perfil')
ok(new RegExp(`conta=${fera.id}`).test(await page.evaluate(() => location.hash)), 'ficha: painel lateral aberto pelo hash (conta=)')
ok(await page.isVisible('#gaveta .gaveta-voltar >> text=Voltar para Usuários'), 'ficha: "← Voltar para Usuários"')
await page.fill('#gaveta .nota-interna textarea', 'Anotação do teste do painel.\nSegunda linha.')
await page.locator('#gaveta .nota-interna button', { hasText: 'Salvar' }).click()
ok(await esperarToast(page, /Anotação salva/), 'anotação interna: salva com toast')
ok(sql(`SELECT nota_admin FROM usuarios WHERE id = ${fera.id}`).includes('Segunda linha'), 'anotação interna: a quebra de linha fica no banco')
await page.waitForTimeout(800)
await page.selectOption('#gaveta .tipo-conta select', 'criador')
ok(await esperarToast(page, /agora é criador/), 'tipo de conta: muda com confirm()')
ok(sql(`SELECT tipo FROM usuarios WHERE id = ${fera.id}`) === 'criador', 'tipo de conta: gravado')
page.confirmar = false
await page.waitForTimeout(800)
await page.selectOption('#gaveta .tipo-conta select', 'tester')
await page.waitForTimeout(500)
ok(await page.inputValue('#gaveta .tipo-conta select') === 'criador', 'tipo de conta: cancelar o confirm() volta ao valor anterior')
page.confirmar = true
const linkJogo = await page.locator('#gaveta a', { hasText: 'Abrir no jogo' }).first().getAttribute('href')
ok(/^\.\.\/#\/resumo\?id=\d+&de=admin$/.test(linkJogo || ''), 'X4: "Abrir no jogo" → ../#/resumo?id=<pk>&de=admin')
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
ok(await page.locator('#gaveta[hidden]').count() === 1 && !/conta=/.test(await page.evaluate(() => location.hash)), 'ficha: Esc fecha e tira conta= do hash')

// suspender: motivo obrigatório; excluir: o apelido digitado
const zeca = S.contas['Zeca Pé']
await ir(page, '#/usuarios?conta=' + zeca.id, 1500)
await page.locator('#gaveta button', { hasText: 'Suspender' }).click()
await page.waitForSelector('dialog[open]')
await page.locator('dialog[open] textarea').fill('')
await page.locator('dialog[open] button[type=submit]').click()
ok(await page.locator('dialog[open] .erro-campo:not([hidden])', { hasText: 'motivo' }).count() === 1, 'suspender: sem motivo não envia ("Escreva o motivo")')
await page.locator('dialog[open] .chip-motivo', { hasText: 'Apelido ofensivo' }).click()
await page.locator('dialog[open] .atalhos-dias button', { hasText: '3 dias' }).click()
await page.locator('dialog[open] button[type=submit]').click()
ok(await esperarToast(page, /suspenso até/), 'suspender: com motivo e prazo em chips')
ok(sql(`SELECT motivo_suspensao FROM usuarios WHERE id = ${zeca.id}`) === 'Apelido ofensivo', 'suspender: o motivo do chip foi gravado')
await page.waitForTimeout(800)
await page.locator('#gaveta button', { hasText: 'Mandar código' }).click()
ok(await esperarToast(page, /suspensa: reative/), 'código de troca de senha: conta suspensa avisa')
const erroToast = page.locator('#avisos .aviso-flutuante.erro')
await page.locator('#gaveta button', { hasText: 'Reativar' }).click()
await page.waitForSelector('dialog[open]')
await page.locator('dialog[open] button[type=submit]').click()
ok(await esperarToast(page, /reativado/), 'reativar: motivo opcional')
const kiko = S.contas['Kiko Banco']
await ir(page, '#/usuarios?conta=' + kiko.id, 1500)
await page.locator('#gaveta button', { hasText: 'Excluir conta' }).click()
await page.waitForSelector('dialog[open].dialogo-perigo')
const btnExcluir = page.locator('dialog[open] button[type=submit]')
ok(await btnExcluir.isDisabled(), 'excluir: o botão só libera com o apelido digitado')
await page.locator('dialog[open] .confirmar-digitando input').fill('kiko banco')
ok(!(await btnExcluir.isDisabled()), 'excluir: sem diferenciar maiúsculas (como o servidor)')
await btnExcluir.click()
ok(await esperarToast(page, /excluída/), 'excluir: conta excluída')
ok(sql(`SELECT COUNT(*) FROM usuarios WHERE id = ${kiko.id}`) === '0', 'excluir: a conta saiu do banco')
ok(sql(`SELECT detalhes FROM admin_log WHERE acao = 'excluir_usuario' ORDER BY id DESC LIMIT 1`).includes('pedido_titular'), 'excluir: só o motivo da lista no registro')
const r409 = await pedido('api/admin.php', { bearer: true, ip: '127.0.0.1', corpo: { acao: 'excluir_usuario', id: S.contas['Tati Garra'].id, confirma: 'outro nome' } })
ok(r409.status === 400 && r409.json?.erro === 'confirma', 'excluir: o servidor confere o apelido (400 confirma)')
ok(await erroToast.count() >= 1, 'toast de erro continua na tela (sem sumir sozinho) até o ×')

// ═══ 3. Hall: lote com sinais, ocultar com motivo e aviso ao autor, lixeira ═════════════════
await ir(page, '#/hall?filtro=suspeitas', 1500)
const nSusp = await aba(page).locator('tbody tr').count()
ok(nSusp >= 2, `Hall · suspeitas: ${nSusp} carreiras`)
const nGraves = await aba(page).locator('tbody tr:has(.sinal-grave)').count()
ok(nGraves >= 2, `sinais: graves à vista em vermelho (${nGraves} carreiras com alerta grave)`)
const barra = aba(page).locator('.barra-lote')
ok(new RegExp(`Marcar as ${nSusp - nGraves} sem alerta`).test(await barra.textContent()), `lote: "Marcar as ${nSusp - nGraves} sem alerta" (só as sem sinal grave)`)
await barra.locator('button', { hasText: 'sem alerta' }).click()
await page.waitForTimeout(300)
ok(await aba(page).locator('tbody tr.marcada').count() === nSusp - nGraves && await aba(page).locator('tbody tr.marcada:has(.sinal-grave)').count() === 0, 'lote: "marcar só os sem alerta" não marca as com alerta grave')
await barra.locator('button', { hasText: 'Marcar todas, inclusive' }).click()
await page.waitForTimeout(300)
ok(await aba(page).locator('tbody tr.marcada').count() === nSusp, 'lote: "Marcar todas, inclusive as N com alerta" (com confirm que lista os sinais)')
await barra.locator('button', { hasText: /^Liberar/ }).click()
await page.waitForSelector('dialog[open]')
ok(new RegExp(`Liberar ${nSusp} carreiras`).test(await page.locator('dialog[open] button[type=submit]').textContent()), 'lote: o botão do diálogo tem o verbo e o número')
await page.locator('dialog[open] button[type=submit]').click()
ok(await esperarToast(page, new RegExp(`${nSusp} liberadas`)), 'lote: toast "N liberadas"')
ok(sql('SELECT COUNT(*) FROM carreiras WHERE suspeita IS NOT NULL AND oculta = 0') === '0', 'lote: as suspeitas foram liberadas no banco')
await page.waitForTimeout(1200)
await ir(page, '#/hall', 1500)
const linha = aba(page).locator('tbody tr').nth(3)
const pkOcultar = Number(await linha.getAttribute('data-id'))
await linha.locator('button[title^="Ocultar"]').click()
await page.waitForSelector('dialog[open]')
await page.locator('dialog[open] .chip-motivo', { hasText: 'Nome ofensivo' }).click()
await page.locator('dialog[open] input[type=checkbox]').check()
await page.locator('dialog[open] button[type=submit]').click()
ok(await esperarToast(page, /ocultada/), 'ocultar: com motivo rápido')
ok(sql(`SELECT motivo_admin FROM carreiras WHERE id = ${pkOcultar}`) === 'Nome ofensivo', 'ocultar: motivo guardado na carreira (P0-4)')
ok(/nome ofensivo/i.test(sql(`SELECT u.aviso_conta FROM carreiras c JOIN usuarios u ON u.id = c.usuario_id WHERE c.id = ${pkOcultar}`)), 'avisar o autor (H11): o texto padrão foi para a conta')
await page.waitForTimeout(800)
await ir(page, `#/hall?filtro=ocultas&carreira=${pkOcultar}`, 1500)
await page.waitForSelector('#gaveta:not([hidden]) .carreira-topo')
ok(/Última decisão: Nome ofensivo/.test(await page.textContent('#gaveta')), 'ficha da carreira: a última decisão com o motivo')
await page.locator('#gaveta button', { hasText: 'Apagar' }).click()
await page.waitForSelector('dialog[open]')
ok(/Prefira Ocultar/.test(await page.textContent('dialog[open]')), 'apagar: "Prefira Ocultar" antes')
await page.locator('dialog[open] textarea').fill('Teste: apagar e restaurar')
await page.locator('dialog[open] button[type=submit]').click()
ok(await esperarToast(page, /lixeira/), 'apagar: vai para a lixeira')
await page.waitForTimeout(800)
await ir(page, '#/hall?filtro=lixeira', 1500)
const linhaLix = aba(page).locator('tbody tr', { hasText: 'Teste: apagar e restaurar' })
ok(await linhaLix.count() === 1, 'lixeira: a carreira apagada com o motivo')
await linhaLix.locator('button', { hasText: 'Restaurar' }).click()
ok(await esperarToast(page, /restaurada/), 'lixeira: restaurar (volta oculta)')
ok(sql(`SELECT oculta FROM carreiras WHERE id = ${pkOcultar}`) === '1', 'lixeira: voltou como oculta = 1')

// ═══ 4. Denúncias: fila ao vivo (P1-13) e lote ═══════════════════════════════════════════════
await page.keyboard.press('Escape')
await ir(page, '#/denuncias', 1500)
const antes = await aba(page).locator('article.denuncia').count()
// uma denúncia nova noutro lugar (o pulso de 15 s traz a fila mudada)
const naFoto = sql("SELECT f.carreira_id FROM hall_foto f WHERE NOT EXISTS (SELECT 1 FROM denuncias d WHERE d.carreira_pk = f.carreira_pk) ORDER BY f.id DESC LIMIT 1")
const denunciante = S.contas['Gabi Zaga']
const rd = await pedido('api/hall.php', { ip: denunciante.ip, cookie: denunciante.cookie, corpo: { acao: 'denunciar', id: naFoto, motivo: 'outro', texto: 'Denúncia nova no meio do teste' } })
ok(rd.status === 200, 'fila ao vivo: denúncia nova feita por outra conta')
await page.waitForFunction((n) => document.querySelectorAll('.aba:not([hidden]) article.denuncia').length > n || !document.getElementById('novidade').hidden, antes, { timeout: 40000 }).catch(() => {})
ok(await aba(page).locator('article.denuncia').count() > antes || await page.isVisible('#novidade'), 'fila ao vivo: a denúncia nova aparece sozinha (ou o aviso "N novas — clique para ver")')
const card = aba(page).locator('article.denuncia', { hasText: 'Denúncia nova no meio do teste' })
await card.locator('input[type=checkbox]').check()
await aba(page).locator('.barra-lote button', { hasText: 'Manter: improcedente' }).click()
await page.waitForSelector('dialog[open]')
await page.locator('dialog[open] button[type=submit]').click()
ok(await esperarToast(page, /1 mantida/), 'denúncias em lote: "Manter: denúncia improcedente"')

// ═══ 5. Indicações: suspeitas, lote, mesmo aparelho; bônus (X5) ══════════════════════════════
await ir(page, '#/indicacoes?status=pendente', 1500)
ok(await aba(page).locator('.sinal-grave', { hasText: 'indicações em 24 h' }).count() >= 1, 'indicações: sinal grave da série de 24 h')
const marcadas = aba(page).locator('tbody input[type=checkbox]:not(:disabled)')
await marcadas.nth(0).check()
await marcadas.nth(1).check()
await aba(page).locator('.barra-lote button', { hasText: 'Recusar 2 indicações' }).click()
await page.waitForSelector('dialog[open]')
await page.locator('dialog[open] .chip-motivo', { hasText: 'Série suspeita' }).click()
await page.locator('dialog[open] button[type=submit]').click()
ok(await esperarToast(page, /2 recusadas/), 'indicações em lote: recusar 2 com motivo')
await page.waitForTimeout(800)
await ir(page, '#/indicacoes?status=aparelho', 1500)
ok(await aba(page).locator('.cartao-grupo.se-indicaram').count() === 1, 'mesmo aparelho: o grupo que se indicou em vermelho')
await aba(page).locator('.cartao-grupo button', { hasText: 'Está tudo certo' }).click()
ok(await esperarToast(page, /dispensado/), 'mesmo aparelho: "Está tudo certo" dispensa o alerta')
await ir(page, '#/indicacoes?status=bonus', 1500)
const nBonus = await aba(page).locator('tbody tr').count()
await aba(page).locator('tbody input[type=checkbox]').first().check()
await aba(page).locator('.barra-lote button', { hasText: 'Tirar 1 bônus' }).click()
await page.waitForSelector('dialog[open]')
await page.locator('dialog[open] .chip-motivo', { hasText: 'Dado por engano' }).click()
await page.locator('dialog[open] button[type=submit]').click()
ok(await esperarToast(page, /bônus tirado/), `bônus (X5): tirar em lote (${nBonus} na lista)`)

// ═══ 6. Na área, relatórios e CSV, tempo, registro, saúde ═══════════════════════════════════
await batimentos()
await ir(page, '#/area', 2000)
ok(await aba(page).locator('tbody tr').count() >= 3, 'Na área: as visitas com o jogo aberto agora')
ok(await aba(page).locator('.selo-jogando').count() >= 1 && /Clássico/.test(await aba(page).textContent()), 'Na área: "jogando" e a tela/modo (Clássico)')
// a pílula vem do pulso (15 s): espera o próximo
ok(await page.locator('#cont-area').waitFor({ state: 'visible', timeout: 17000 }).then(() => true, () => false), 'pílula verde da Na área com o online (no pulso seguinte)')
await ir(page, '#/relatorios?tipo=sumidos30', 1500)
ok(await aba(page).locator('tbody tr').count() >= 1, 'relatório "sumidos há 30 dias" com linhas')
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), aba(page).locator('button', { hasText: 'Baixar CSV' }).click()])
const csv = readFileSync(await download.path(), 'utf8')
ok(csv.charCodeAt(0) === 0xfeff && csv.includes(';'), 'relatório: CSV com BOM e ";"')
await ir(page, '#/tempo', 1500)
ok(await aba(page).locator('.ladrilho').count() === 6 && await aba(page).locator('.grafico svg').count() === 1, 'tempo de jogo: total, por dia e ranking')
await ir(page, '#/registro?acao=suspender', 1500)
ok(await aba(page).locator('tbody tr').count() >= 1, 'registro: filtro por ação')
ok(await aba(page).locator('.detalhes-log', { hasText: 'motivo:' }).count() >= 1, 'registro: detalhes como "chave: valor"')
await ir(page, '#/registro?parte=seguranca', 1500)
ok(await aba(page).locator('.chip-perigo', { hasText: 'Errou a senha' }).count() >= 1, 'segurança: as senhas erradas em vermelho')
await ir(page, '#/registro?parte=emails', 1500)
ok(await aba(page).locator('tbody tr').count() >= 1, 'e-mails: o código mandado pela equipe aparece')
await ir(page, '#/saude', 2000)
ok(await aba(page).locator('.saude-caixa').count() === 1, 'Saúde: a caixa "Tudo no lugar" / problemas')

// ═══ 7. Configurações: X1 e avisos; equipe; recado; papéis e poderes ═════════════════════════
await ir(page, '#/config', 1800)
await page.fill('#cfg-hall_revisao_nota', '95')
await page.waitForSelector('.barra-salvar:not([hidden])')
await page.locator('.barra-salvar button', { hasText: 'Salvar' }).click()
await page.waitForSelector('dialog[open]')
await page.locator('dialog[open] button[type=submit]').click()
ok(await esperarToast(page, /Configurações salvas/), 'X1: revisão do Hall salva pelo painel')
ok(sql("SELECT valor FROM site_config WHERE chave = 'hall_revisao_nota'") === '95', 'X1: hall_revisao_nota = 95 no banco')
await ir(page, '#/equipe', 1500)
await page.locator('#acoes-aba button', { hasText: 'Pôr alguém' }).click()
await page.waitForSelector('dialog[open]')
const camposEq = page.locator('dialog[open] input')
await camposEq.nth(0).fill('Suporte Ana')
await camposEq.nth(1).fill('suporte.ana@exemplo.com')
await page.selectOption('dialog[open] select', 'suporte')
await page.locator('dialog[open] button[type=submit]').click()
await page.waitForSelector('dialog[open] .caixa-segredo')
const provisoria = (await page.textContent('dialog[open] .caixa-segredo code')).trim()
ok(provisoria.length === 14 && !/[0O1lI]/.test(provisoria), 'equipe: senha provisória sorteada (14, sem 0/O/1/l/I), mostrada uma vez')
await page.locator('dialog[open] .caixa-segredo button', { hasText: 'Copiar' }).click()
ok(await page.locator('dialog[open] .caixa-segredo button', { hasText: 'Copiado' }).waitFor({ timeout: 4000 }).then(() => true, () => false), 'equipe: "Copiar" vira "Copiado"')
await page.keyboard.press('Escape')
await ir(page, '#/equipe?parte=recados', 1500)
await page.locator('#acoes-aba button', { hasText: 'Escrever recado' }).click()
await page.waitForSelector('dialog[open]')
await page.locator('dialog[open] input').first().fill('Live hoje às 20h: olho nas denúncias')
await page.locator('dialog[open] button[type=submit]').click()
ok(await esperarToast(page, /Recado publicado/), 'recado interno publicado')
const eqIds = sql("SELECT id FROM admin_contas WHERE email = 'suporte.ana@exemplo.com'")
ok(Number(eqIds) > 0, 'equipe: a pessoa nova está no banco')

// ═══ 8. PIN: a conta Dono cria o PIN; a entrada seguinte pede o PIN ══════════════════════════
await ir(page, '#/config?parte=conta', 1800)
await page.fill('#cp-senha', env.PAINEL_SENHA)
await page.fill('#cp-pin', '123456')
await page.fill('#cp-rep', '123456')
await aba(page).locator('button', { hasText: 'Criar PIN' }).click()
await page.waitForTimeout(800)
ok(/fácil de adivinhar/.test(await page.textContent('.aba:not([hidden])')), 'PIN: sequência recusada (pin_fraco)')
await page.fill('#cp-pin', '729153')
await page.fill('#cp-rep', '729153')
await aba(page).locator('button', { hasText: 'Criar PIN' }).click()
ok(await esperarToast(page, /PIN criado/), 'PIN: criado pela Minha conta (com a senha do arquivo de novo)')
await page.locator('.lateral-pe button[data-acao="sair"]').click()
await page.waitForSelector('#form-entrar:not([hidden])')
await entrar(page)
await page.waitForSelector('#form-pin:not([hidden])')
ok(true, 'PIN: a entrada seguinte pede o PIN (segunda etapa)')
await digitarPin(page, '#pin-caixas', '111222')
await page.waitForSelector('#erro-pin:not([hidden])')
ok(/Restam 2/.test(await page.textContent('#erro-pin')), 'PIN: errado mostra "Restam 2 tentativas"')
await digitarPin(page, '#pin-caixas', '729153')
await page.waitForSelector('#tela-painel:not([hidden])', { timeout: 10000 })
ok(true, 'PIN: certo entra no painel')
const csp = await page.evaluate(() => window.__csp)
ok(csp.length === 0, 'CSP: nenhuma violação (script-src/style-src self)' + (csp.length ? ': ' + csp.slice(0, 3).join(' | ') : ''))
ok(page.erros.length === 0, 'nenhum erro de JavaScript no painel' + (page.erros.length ? ': ' + page.erros.slice(0, 3).join(' | ') : ''))
// temas e modo discreto
await page.keyboard.press('t')
ok(await page.getAttribute('html', 'data-tema') === 'claro', 'atalho T: tema Claro')
await page.keyboard.press('t')
ok(await page.getAttribute('html', 'data-tema') === 'alto', 'atalho T: Alto contraste')
await page.keyboard.press('t')
ok(await page.getAttribute('html', 'data-tema') === null, 'atalho T: volta ao Original')
await page.reload()
await page.waitForSelector('#tela-painel:not([hidden])')
ok(await page.getAttribute('html', 'data-discreto') === '1', 'modo discreto ligado por padrão (tema.js antes do primeiro desenho)')
await ctx.close()

// ═══ 9. a moderadora: senha provisória → senha nova → PIN; poderes escondidos ═════════════════
{
  const { ctx: c2, page: p2 } = await novoAparelho(1440)
  await entrar(p2, { email: S.moderadora.email, senha: S.moderadora.senha })
  await p2.waitForSelector('#form-trocar-senha:not([hidden])')
  ok(true, 'moderadora: a senha provisória pede a troca antes de qualquer tela')
  await p2.fill('#nova-senha', 'moderadora-senha-nova-2026')
  await p2.fill('#nova-senha-2', 'moderadora-senha-nova-2026')
  await p2.click('#botao-trocar')
  await p2.waitForSelector('#form-criar-pin:not([hidden])')
  ok(true, 'moderadora: depois da senha, cria o PIN')
  await digitarPin(p2, '#pin-novo', '481620')
  await digitarPin(p2, '#pin-repetir', '481620')
  await p2.click('#botao-criar-pin')
  await p2.waitForSelector('#tela-painel:not([hidden])', { timeout: 10000 })
  ok(await p2.locator('.abas a.trancada[data-aba="equipe"]').count() === 1 && await p2.locator('.abas a.trancada[data-aba="saude"]').count() === 1, 'moderadora: Equipe e Saúde com cadeado')
  await ir(p2, '#/usuarios?conta=' + S.contas['ReiDoDrible'].id, 1500)
  ok(await p2.locator('#gaveta button', { hasText: 'Excluir conta' }).count() === 0 && await p2.locator('#gaveta button', { hasText: 'Suspender' }).count() === 0, 'moderadora: sem "Excluir" nem "Suspender" na ficha')
  ok(await p2.locator('#gaveta button', { hasText: 'Tirar do Hall' }).count() === 1, 'moderadora: "Tirar do Hall" (moderar) aparece')
  const negado = await p2.evaluate(async (id) => (await fetch('../api/admin.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'suspender', id, motivo: 'x' }) })).status, S.contas['ReiDoDrible'].id)
  ok(negado === 403, 'moderadora: o servidor barra a ação sem poder (403)')
  ok(await p2.isVisible('#recados .recado'), 'moderadora: o recado da equipe aparece no topo')
  await p2.locator('#recados .recado-fechar').first().click()
  await p2.waitForTimeout(600)
  ok(await p2.locator('#recados .recado').count() === 0, 'recado: o × marca como lido só para ela')
  await c2.close()
}

// ═══ 10. celular: sem rolagem lateral em nenhuma aba; números em 3 × 2 ═══════════════════════
{
  const { ctx: c3, page: p3 } = await novoAparelho(390)
  await entrar(p3)
  await p3.waitForSelector('#form-pin:not([hidden])')
  await digitarPin(p3, '#pin-caixas', '729153')
  await p3.waitForSelector('#tela-painel:not([hidden])', { timeout: 10000 })
  // v3.5 (revisão mobile): no celular os 8 números viram uma faixa de uma linha que rola de lado, com o rótulo curto
  const faixa = await p3.evaluate(() => {
    const n = document.getElementById('numeros-acao')
    const tops = new Set(Array.from(n.children).map((c) => Math.round(c.getBoundingClientRect().top)))
    const curto = n.querySelector('.na-curto')
    return { display: getComputedStyle(n).display, linhas: tops.size, rola: n.scrollWidth > n.clientWidth, curto: !!curto && getComputedStyle(curto).display !== 'none' }
  })
  ok(faixa.display === 'flex' && faixa.linhas === 1 && faixa.rola && faixa.curto, 'celular: os 8 números de ação numa faixa de uma linha que rola de lado, com o rótulo curto (' + JSON.stringify(faixa) + ')')
  for (const a of ABAS) {
    await ir(p3, '#/' + a, 1200)
    await semRolagemLateral(p3, a)
  }
  await ir(p3, '#/usuarios?conta=' + S.contas['ReiDoDrible'].id, 1500)
  const g = await p3.evaluate(() => document.getElementById('gaveta').getBoundingClientRect().width)
  ok(g >= 389, 'celular: a ficha ocupa a tela toda')
  const alvos = await p3.evaluate(() => Array.from(document.querySelectorAll('#gaveta button')).filter((b) => b.offsetParent && b.getBoundingClientRect().height < 39).map((b) => b.textContent.trim()).slice(0, 5))
  ok(alvos.length === 0, 'celular: botões da ficha com 40 px ou mais' + (alvos.length ? ': ' + alvos.join(', ') : ''))
  ok(p3.erros.length === 0, 'celular: nenhum erro de JavaScript' + (p3.erros.length ? ': ' + p3.erros.slice(0, 3).join(' | ') : ''))
  await c3.close()
}

await browser.close()
const r = resultado()
console.log(`\npainel: ${r.oks} ok, ${r.falhas} falha(s) em ${((performance.now() - t0) / 1000).toFixed(0)} s`)
if (r.falhas) console.log('  ' + r.lista.join('\n  '))
process.exit(r.falhas ? 1 : 0)
