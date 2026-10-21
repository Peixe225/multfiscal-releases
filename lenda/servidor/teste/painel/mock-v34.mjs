// LENDA · teste do painel (v3.4) CONTRA MOCK: as respostas do admin.php das telas novas (desafios, desafio, usuario, provas,
// carreira) são trocadas no navegador (page.route) por dados montados aqui pelo CONTRATO-v34 §A, e as ações (desafio_salvar,
// emblema_retirar, emblema_devolver) são respondidas sem chegar ao servidor — nada no banco muda. O login, o pulso e o resto
// do painel são os da pilha de verdade do rodar.sh. Confere o que o banco do teste não tem fácil: (1) o servidor de ANTES da
// v3.4 (sem `modo`, sem provas, sem emblemas): o painel fica como na v3.3; (2) os casos de borda da v3.4: ícone fora do mapa
// e cor estragada, 120 emblemas em páginas, conta suspensa, carreira apagada, retirado pelo sistema, 409 do servidor no
// diálogo, a ficha com as três situações das conquistas e as carreiras-prova que não valem; (3) o editor do emblema: o que
// ele manda no desafio_salvar (só o que precisa), a validação dos números e da seleção, a cor que acompanha a dificuldade.
// Roda depois do painel.mjs (a conta Dono já tem o PIN 729153; LENDA_TESTE_PAINEL_PIN muda) e antes do v34.mjs.
const { chromium } = await import(process.env.LENDA_PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright/index.mjs')
import { BASE, PAINEL, env, ok, resultado, sql } from './lib.mjs'

const EXE = process.env.LENDA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const PIN = process.env.LENDA_TESTE_PAINEL_PIN ?? '729153'
const t0 = performance.now()
sql("DELETE FROM tentativas WHERE chave LIKE 'painel:%'")
const browser = await chromium.launch({ executablePath: EXE, args: ['--lang=pt-BR'] })
let paginaAtual = null
process.on('uncaughtException', async (e) => {
  console.log(`  XX  o teste parou: ${String((e && e.message) || e).split('\n')[0]}`)
  try { if (paginaAtual) await paginaAtual.screenshot({ path: `${BASE}/falha-mock-v34.png` }) } catch { /* sem página */ }
  const r = resultado()
  console.log(`\npainel v3.4 (mock): ${r.oks} ok, ${r.falhas + 1} falha(s)`)
  process.exit(1)
})

// ═══ os dados de mentira (CONTRATO-v34 A.0/A.9) ═══════════════════════════════════════════════
const agora = new Date()
const iso = (dias = 0) => new Date(agora.getTime() - dias * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z')
const isoMs = (dias = 0) => new Date(agora.getTime() - dias * 86400000).toISOString()
const REQ_E = { partidasMin: 0, emailVerificado: false, publicadoNoHall: false, top3Perfil: false }
const REQ_P = { partidasMin: 30, emailVerificado: true, publicadoNoHall: true, top3Perfil: true }
const cand0 = { pendente: 0, verificada: 0, recusada: 0, vencedora: 0, total: 0 }
const TITULO_LONGO = 'Um desafio com o título bem comprido para ver se a linha quebra no celular sem rolar de lado!'.slice(0, 80)
function D(o) {
  return Object.assign({ descricao: 'Descrição do desafio de mentira.', regulamento: '1. Regulamento de mentira.', premio: '', requisitos: REQ_E, ativo: true, inicio: iso(3), fim: null,
    criadoEm: iso(3), atualizadoEm: iso(1), ordem: 10, valendo: true, encerrado: false, vencedor: null, candidatos: cand0, modo: 'emblema', dificuldade: 'facil',
    emblema: { icone: 'star', cor: '#b98652' }, home: false, emblemas: { ativos: 0, retirados: 0 } }, o)
}
const V34 = [
  D({ id: 950, slug: 'noite-de-gala', titulo: 'Noite de gala', criterio: { bolasOuro: 1, champions: 1 }, home: true, emblemas: { ativos: 118, retirados: 2 } }),
  D({ id: 951, slug: 'icone-estranho', titulo: 'Ícone estranho', criterio: { gols: 1001, copas: 3 }, dificuldade: null, emblema: { icone: 'nao-existe-no-mapa', cor: 'vermelho' }, ordem: 20 }),
  D({ id: 952, slug: 'titulo-longo', titulo: TITULO_LONGO, criterio: { nacionalidade: ['BRA', 'ARG'], copasPelaSelecao: 1, copas: 2, nota: 92 }, dificuldade: 'lendario', emblema: { icone: 'crown', cor: '#c9b8ff' }, home: true, ordem: 30, ativo: false, valendo: false }),
  D({ id: 953, slug: 'tacas-do-rei', titulo: 'As Taças do Rei', criterio: { copas: 3, libertadores: 2 }, modo: 'primeiro', dificuldade: null, emblema: null, requisitos: REQ_P, premio: 'Prêmio de mentira.', ativo: false, valendo: false, inicio: null, ordem: 1 }),
  D({ id: 954, slug: 'todas-as-conquistas', titulo: 'Todas as conquistas', criterio: { todasConquistas: true }, modo: 'primeiro', dificuldade: null, emblema: null, requisitos: { ...REQ_P, publicadoNoHall: false, top3Perfil: false }, ativo: false, valendo: false, inicio: null, ordem: 3 }),
]
// o servidor de antes (v3.3): sem modo, dificuldade, emblema, home nem emblemas
const V33 = V34.filter((x) => x.modo === 'primeiro').map((x) => { const y = { ...x }; ['modo', 'dificuldade', 'emblema', 'home', 'emblemas'].forEach((k) => delete y[k]); return y })
const usuarioE = (i) => ({ id: 3000 + i, apelido: 'Ganhador ' + i, status: i === 3 ? 'suspenso' : 'ativo' })
function E(i) {
  const retirado = i === 1 || i === 2
  const apagada = i === 4
  return { id: 7000 + i, estado: retirado ? 'retirado' : 'ativo', em: isoMs(i / 10), motivo: i === 1 ? 'Esta carreira não bateu na verificação por replay.' : i === 2 ? 'Trapaça: números que o jogo não dá.' : null,
    retiradoEm: retirado ? iso(0) : null, quem: retirado ? (i === 1 ? { codigo: 'sistema', nome: 'Sistema' } : { codigo: 'a1', nome: 'Dono' }) : null,
    usuario: usuarioE(i), carreira: { pk: 9000 + i, carreiraId: 'career-mock-' + i, jogador: 'JOGADOR' + i, existe: !apagada },
    links: apagada ? null : { resumo: '/lenda/#/resumo?id=' + (9000 + i) + '&de=admin', verificar: '/lenda/#/verificar?id=' + (9000 + i) + '&prova=1' } }
}
const paginado = (total, pagina, itens) => ({ total, pagina, porPagina: 50, itens })
const NOMES = JSON.parse((await import('node:fs')).readFileSync(new URL('../../painel/nomes.json', import.meta.url), 'utf8'))
const TODAS = Object.keys(NOMES.conquistas)
const UID = 4242
function usuario(v34) {
  // 60 conquistas: 20 conferidas, 30 provadas sem conferir, 10 só do aparelho
  const conq = TODAS.slice(0, 60).map((id, i) => (v34 ? { id, em: iso(60 - i), provada: i < 50, verificada: i < 20, provaPk: i < 20 ? 501 : i < 50 ? 502 : null, origem: i === 49 ? 'carreira' : 'aparelho' } : { id, em: iso(60 - i) }))
  const u = {
    id: UID, apelido: 'Fulano Mock', email: 'fulano.mock@exemplo.com', status: 'ativo', criadoEm: iso(90), origem: 'direto', tipo: 'jogador', partidasConta: 120, bonusLiberado: true,
    estatisticas: { partidas: 150, carreirasSalvas: 2, melhorNota: 88, melhorJogador: 'MOCK', aparelhos: ['desktop'] }, emailVerificado: true, emailVerificadoEm: iso(80), hallPublico: 'auto',
    carreiras: [
      { pk: 501, id: 'career-mock-501', jogador: 'MOCKUM', numero: 9, pais: 'BRA', posicao: 'CA', modo: 'classico', nota: 88, picoOvr: 93, temporadas: 20, gols: 700, bonusOvr: 0, noHall: true, hall: { estado: 'no_hall' }, oculta: 0, suspeita: null, copas: 2, destaque: false, moderacao: null, como: 'manual', salvaEm: iso(20) },
      { pk: 502, id: 'career-mock-502', jogador: 'MOCKDOIS', numero: 10, pais: 'BRA', posicao: 'MEI', modo: 'classico', nota: 80, picoOvr: 90, temporadas: 18, gols: 300, bonusOvr: 0, noHall: false, hall: { estado: 'fora' }, oculta: 0, suspeita: null, copas: 0, destaque: false, moderacao: null, como: 'auto', salvaEm: iso(10) },
    ],
    conquistas: conq, indicacoes: { feitas: [], recebida: null }, bonus: [], sessoes: [], visitas: [], eventos: [], denuncias: { feitas: 0, recebidas: 0 },
    tipoEm: null, hallBloqueado: false, notaAdmin: null, avisoPendente: null, mesmoAparelho: [], tempo: { semana: 0, semanaPassada: 0, total: 0, porModo: {} },
    acesso: { status: 'ativo', sessoes: 0, bloqueioEntrar: { tentativas: 0, limite: 5, bloqueado: false } }, lixeira: [], desafios: [], mensagens: [],
  }
  if (v34) {
    u.conquistasProva = { provadas: 50, verificadas: 20, naoProvadas: 10, total: 87 }
    u.emblemas = [
      { ...E(5), usuario: { id: UID, apelido: 'Fulano Mock', status: 'ativo' }, desafio: { id: 950, slug: 'noite-de-gala', titulo: 'Noite de gala' } },
      { ...E(2), usuario: { id: UID, apelido: 'Fulano Mock', status: 'ativo' }, desafio: { id: 952, slug: 'titulo-longo', titulo: TITULO_LONGO } },
    ]
  }
  return u
}
const PROVAS = {
  usuario: { id: UID, apelido: 'Fulano Mock', status: 'ativo' },
  conquistas: { total: 87, provadas: 50, verificadas: 20, naoProvadas: 10, faltamProvar: TODAS.slice(50), faltamVerificar: TODAS.slice(20) },
  carreiras: [
    { pk: 501, carreiraId: 'career-mock-501', jogador: 'MOCKUM', primeiraEm: iso(20), conquistas: TODAS.slice(0, 20), conquistasV: 2, unicas: TODAS.slice(0, 20), essencial: true, vale: true, motivo: null, motivoTexto: null, provaOk: true, verificacao: { ok: true, em: iso(1), quem: 'a1' }, links: { resumo: '/lenda/#/resumo?id=501&de=admin', verificar: '/lenda/#/verificar?id=501&prova=1' } },
    { pk: 502, carreiraId: 'career-mock-502', jogador: 'MOCKDOIS', primeiraEm: iso(10), conquistas: TODAS.slice(10, 50), conquistasV: 1, unicas: TODAS.slice(20, 50), essencial: true, vale: true, motivo: null, motivoTexto: null, provaOk: null, verificacao: null, links: { resumo: '/lenda/#/resumo?id=502&de=admin', verificar: '/lenda/#/verificar?id=502&prova=1' } },
    { pk: 503, carreiraId: 'career-mock-503', jogador: 'SEMSEMENTE', primeiraEm: iso(5), conquistas: TODAS.slice(0, 5), conquistasV: 2, unicas: [], essencial: false, vale: false, motivo: 'sem_semente', motivoTexto: 'Esta carreira não começou com uma semente sorteada pelo servidor.', provaOk: null, verificacao: null, links: { resumo: '/lenda/#/resumo?id=503&de=admin', verificar: '/lenda/#/verificar?id=503&prova=1' } },
    { pk: 504, carreiraId: 'career-mock-504', jogador: 'NAOBATEU', primeiraEm: iso(4), conquistas: TODAS.slice(0, 8), conquistasV: 2, unicas: [], essencial: false, vale: false, motivo: 'nao_bateu', motivoTexto: 'Esta carreira não bateu na verificação por replay.', provaOk: false, verificacao: { ok: false, motivo: 'Não bateu: Conquistas.', em: iso(2) }, links: { resumo: '/lenda/#/resumo?id=504&de=admin', verificar: '/lenda/#/verificar?id=504&prova=1' } },
  ],
  links: { lote: '/lenda/#/verificar?conta=' + UID },
}

// ═══ o navegador e o mock ════════════════════════════════════════════════════════════════════
let sessao = null
async function aparelho(largura, modo) {
  const celular = largura < 600
  const ctx = await browser.newContext({ viewport: { width: largura, height: celular ? 844 : 900 }, deviceScaleFactor: 1, isMobile: celular, hasTouch: celular, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', storageState: sessao ?? undefined })
  const page = await ctx.newPage()
  paginaAtual = page
  page.erros = []
  page.pedidos = []
  page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) page.erros.push(m.text()) })
  page.on('pageerror', (er) => page.erros.push('pageerror: ' + er.message))
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)) })
  page.on('dialog', (d) => d.accept())
  page.modo = modo
  await page.route(/\/api\/admin\.php/, (route) => responder(page, route))
  return { ctx, page }
}
const json = (route, status, corpo) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(corpo) })
async function responder(page, route) {
  const req = route.request()
  const u = new URL(req.url())
  const r = u.searchParams.get('r')
  const v34 = page.modo === 'v34'
  if (req.method() === 'POST') {
    const corpo = JSON.parse(req.postData() || '{}')
    if (!['desafio_salvar', 'emblema_retirar', 'emblema_devolver', 'desafio_ativar'].includes(corpo.acao)) return route.continue()
    page.pedidos.push(corpo)
    if (corpo.acao === 'emblema_retirar') return json(route, 409, { erro: 'ja_retirado', mensagem: 'Esse emblema já foi retirado.' })
    if (corpo.acao === 'emblema_devolver') return json(route, 200, { ok: true, emblema: { ...E(2), estado: 'ativo', motivo: corpo.motivo || null, retiradoEm: null } })
    if (corpo.acao === 'desafio_salvar') return json(route, 201, { ok: true, desafio: D({ id: 777, slug: corpo.slug, titulo: corpo.titulo, criterio: corpo.criterio, ativo: false, valendo: false, inicio: null, emblema: corpo.emblema, dificuldade: corpo.dificuldade ?? null, home: !!corpo.home }), candidatosNovos: 0, candidatosRecusados: 0 })
    return json(route, 200, { ok: true, desafio: V34[0], candidatosNovos: 3, emblemasNovos: 3 })
  }
  if (r === 'desafios') return json(route, 200, { itens: v34 ? V34 : V33, partidasDiaMax: 100, conquistasTotal: 87 })
  if (r === 'desafio') {
    page.pedidos.push({ r, id: u.searchParams.get('id'), estado: u.searchParams.get('estado') || '', pagina: u.searchParams.get('pagina') || '1' })
    const id = Number(u.searchParams.get('id'))
    if (id === 777) return json(route, 200, { desafio: D({ id: 777, slug: 'criado-no-mock', titulo: 'Criado no mock', criterio: { gols: 500 }, ativo: false, valendo: false }), candidatos: paginado(0, 1, []), emblemas: paginado(0, 1, []) })
    const d = (v34 ? V34 : V33).find((x) => x.id === id)
    if (!d) return json(route, 404, { erro: 'nao_encontrado', mensagem: 'Desafio não encontrado.' })
    if (d.modo !== 'emblema') return json(route, 200, { desafio: d, candidatos: paginado(0, 1, []) })
    const estado = u.searchParams.get('estado') || ''
    const pagina = Number(u.searchParams.get('pagina') || 1)
    let todos = Array.from({ length: 120 }, (_, i) => E(i + 1))
    if (estado) todos = todos.filter((x) => x.estado === estado)
    return json(route, 200, { desafio: d, candidatos: paginado(0, 1, []), emblemas: paginado(todos.length, pagina, todos.slice((pagina - 1) * 50, pagina * 50)) })
  }
  if (r === 'usuario' && Number(u.searchParams.get('id')) === UID) return json(route, 200, { usuario: usuario(v34) })
  if (r === 'provas') { page.pedidos.push({ r }); return v34 ? json(route, 200, PROVAS) : json(route, 503, { erro: 'instalar', mensagem: 'Falta rodar o instalar.php.' }) }
  return route.continue()
}
async function entrar(page) {
  await page.goto(PAINEL)
  await page.waitForFunction(() => !document.getElementById('tela-painel').hidden || !document.getElementById('tela-entrar').hidden, null, { timeout: 15000 })
  if (!(await page.isVisible('#tela-painel'))) {
    await page.fill('#senha', env.PAINEL_SENHA)
    await page.click('#botao-entrar')
    await page.waitForSelector('#tela-painel:not([hidden]), #form-pin:not([hidden])', { timeout: 15000 })
    if (await page.isVisible('#form-pin')) { await page.locator('#pin-caixas .pin-caixa').first().click(); await page.keyboard.type(PIN, { delay: 30 }) }
    await page.waitForSelector('#tela-painel:not([hidden])', { timeout: 15000 })
  }
  await page.waitForFunction(() => /atualizado às/.test(document.getElementById('selo-atualizado').textContent), null, { timeout: 20000 })
  if (!sessao) sessao = await page.context().storageState()
}
const ir = async (page, hash, espera = 1500) => { await page.evaluate((x) => { location.hash = x }, hash); await page.waitForTimeout(espera) }
const sair = async (page) => ir(page, '#/visao', 600)
const aba = (page) => page.locator('.aba:not([hidden])')
async function esperarToast(page, re, ms = 8000) {
  try {
    await page.waitForFunction((r) => Array.from(document.querySelectorAll('#avisos .aviso-flutuante')).some((x) => new RegExp(r, 'i').test(x.textContent)), re.source, { timeout: ms })
    return true
  } catch { return false }
}
async function secao(page, nome, fn) {
  try { await fn() } catch (e) {
    ok(false, `${nome}: o bloco parou — ${String((e && e.message) || e).split('\n')[0]}`)
    try { for (let i = 0; i < 3 && await page.locator('dialog[open]').count(); i++) await page.keyboard.press('Escape') } catch { /* segue */ }
  }
}
const semRolagem = async (page, nome) => {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
  return ok(w[0] <= w[1], `${nome}: sem rolagem lateral (${w[0]} ≤ ${w[1]})`)
}

// ═══ 1. o servidor de antes da v3.4: tudo como na v3.3 ═══════════════════════════════════════
{
  const { ctx, page } = await aparelho(1440, 'v33')
  await entrar(page)
  await secao(page, '1. servidor de antes', async () => {
    await ir(page, '#/desafios', 2000)
    ok(await aba(page).locator('article.cartao-desafio').count() === 2 && await aba(page).locator('.grupo-desafios').count() === 0 && await aba(page).locator('.emblema').count() === 0,
      'servidor antigo: a lista de sempre (sem grupos, sem emblemas)')
    ok(await page.locator('#acoes-aba button').allTextContents().then((t) => t.join('|') === 'Criar desafio'), 'servidor antigo: um botão só, "Criar desafio"')
    const b = aba(page).locator('article.cartao-desafio[data-id="954"] button', { hasText: 'Ativar' })
    ok(await b.isDisabled() && /não pode ser ativado/.test(await b.getAttribute('title')), 'servidor antigo: o de todas as conquistas continua com o "Ativar" travado (§E da v3.3)')
    await ir(page, '#/desafios?parte=novo', 2000)
    ok(await page.locator('.segmentos[aria-label="Tipo do desafio"]').count() === 0 && await page.locator('.cartao-editor-emblema').count() === 0, 'servidor antigo: o editor sem o tipo nem o emblema')
    ok(await page.locator('#dz-copas').count() === 1 && await page.locator('#dz-libertadores').count() === 1 && await page.locator('#dz-champions').count() === 0 && await page.locator('#dz-nacionalidade').count() === 0,
      'servidor antigo: só Copas e Libertadores no critério')
    await aba(page).locator('.barra-salvar button', { hasText: 'Cancelar' }).click()
    await page.waitForTimeout(600)
    if (await page.locator('dialog[open]').count()) await page.locator('dialog[open] button[type=submit]').click()
    await ir(page, `#/usuarios?conta=${UID}`, 2500)
    ok(await page.locator('#gaveta #u-conquistas').count() === 0 && await page.locator('#gaveta #u-emblemas').count() === 0
      && await page.locator('#gaveta details.cartao-secundario summary', { hasText: 'Conquistas' }).count() === 1, 'servidor antigo: a ficha com as conquistas de sempre (sem provas nem emblemas)')
    ok(await page.locator('#gaveta .ladrilho', { hasText: 'Emblemas' }).count() === 0 && /na conta/.test(await page.locator('#gaveta .ladrilho', { hasText: 'Conquistas' }).textContent()), 'servidor antigo: o número de conquistas "na conta"')
    ok(page.erros.length === 0, 'servidor antigo: nenhum erro de JavaScript' + (page.erros.length ? ': ' + page.erros.slice(0, 3).join(' | ') : ''))
  })
  await ctx.close()
}

// ═══ 2. v3.4: casos de borda da lista, de quem ganhou e da ficha ══════════════════════════════
{
  const { ctx, page } = await aparelho(1440, 'v34')
  await entrar(page)
  await secao(page, '2a. lista com casos de borda', async () => {
    await ir(page, '#/desafios', 2000)
    ok(await aba(page).locator('.grupo-desafios').count() === 2 && await aba(page).locator('#dz-g-emblema').count() === 1, 'dois grupos: com emblema e com prêmio')
    ok(await aba(page).locator('article.cartao-emblema').count() === 3 && await aba(page).locator('article.cartao-emblema .emblema svg').count() === 3, 'cada desafio de emblema com a moeda (o ícone em SVG)')
    const estranho = aba(page).locator('article.cartao-desafio[data-id="951"] .emblema')
    const cor = await estranho.evaluate((e) => getComputedStyle(e).getPropertyValue('--emb').trim())
    const paths = await estranho.locator('svg > *').count()
    const medalha = await page.evaluate(() => window.LP.iconeEmblema('medal').childElementCount)
    ok(cor === '#b98652' && paths === medalha && medalha > 0, `ícone fora do mapa = a medalha (${paths} traços = ${medalha}) e cor estragada = bronze (${cor})`)
    ok(await aba(page).locator('article.cartao-desafio[data-id="951"]', { hasText: 'mais de 1.000 gols' }).count() === 1, '"gols: 1001" aparece como "mais de 1.000 gols"')
    ok(await aba(page).locator('article.cartao-desafio[data-id="952"]', { hasText: 'seleções: Brasil, Argentina (a mesma do começo ao fim)' }).count() === 1
      && await aba(page).locator('article.cartao-desafio[data-id="952"]', { hasText: '2 Copas do Mundo (1 pela própria seleção)' }).count() === 1, 'seleções pelo nome e as Copas pela própria seleção juntas com as Copas')
    ok(await aba(page).locator('article.cartao-desafio[data-id="952"] .chip-dif-lendario').count() === 1 && await aba(page).locator('article.cartao-desafio[data-id="951"] .chip-dif').count() === 0, 'dificuldade em pílula (sem dificuldade = sem pílula)')
    ok(await aba(page).locator('article.cartao-desafio[data-id="950"]', { hasText: '~1 em 12 carreiras' }).count() === 1 && await aba(page).locator('article.cartao-desafio[data-id="951"]', { hasText: 'Calibração' }).count() === 0,
      'a chance da calibração só no de fábrica com o critério de fábrica')
    const tl = await page.locator('#acoes-aba button').allTextContents()
    ok(tl.includes('Criar desafio de emblema') && tl.includes('Criar com prêmio'), 'v3.4: "Criar desafio de emblema" e "Criar com prêmio"')
    const b = aba(page).locator('article.cartao-desafio[data-id="954"] button', { hasText: 'Ativar' })
    ok(!(await b.isDisabled()), 'v3.4: o de todas as conquistas pode ser ativado')
    ok(/118/.test(await aba(page).locator('.ladrilho', { hasText: 'Emblemas dados' }).textContent()), 'ladrilho "Emblemas dados" soma os ativos')
  })
  await secao(page, '2b. quem ganhou: páginas, filtro, borda e erros', async () => {
    await sair(page)
    await ir(page, '#/desafios?id=950', 2200)
    ok(await aba(page).locator('.cartao-ganharam tbody tr').count() === 50 && await aba(page).locator('.cartao-ganharam .paginacao .pagina').count() >= 3, '120 emblemas: 50 na página e a paginação')
    ok(await aba(page).locator('.cartao-ganharam tbody tr[data-id="7004"]', { hasText: 'Carreira apagada' }).count() === 1 && await aba(page).locator('.cartao-ganharam tbody tr[data-id="7004"] a', { hasText: 'Abrir a carreira' }).count() === 0,
      'carreira apagada: a pílula e sem os links do jogo')
    ok(await aba(page).locator('.cartao-ganharam tbody tr[data-id="7003"] .chip', { hasText: 'Conta suspensa' }).count() === 1, 'conta suspensa marcada')
    ok(await aba(page).locator('.cartao-ganharam tbody tr[data-id="7001"]', { hasText: 'Sistema' }).count() === 1 && await aba(page).locator('.cartao-ganharam tbody tr.emblema-retirado').count() === 2, 'retirado pelo sistema, com quem tirou; as linhas retiradas apagadas')
    await aba(page).locator('.cartao-ganharam .paginacao .pagina', { hasText: '2' }).first().click()
    await page.waitForTimeout(1500)
    ok(page.pedidos.some((p) => p.r === 'desafio' && p.pagina === '2') && /pagina=2/.test(await page.evaluate(() => location.hash)), 'página 2 pedida ao servidor (e no endereço)')
    await aba(page).locator('.segmentos[aria-label="Situação do emblema"] button', { hasText: 'Retirados' }).click()
    await page.waitForTimeout(1500)
    ok(page.pedidos.some((p) => p.r === 'desafio' && p.estado === 'retirado' && p.pagina === '1') && await aba(page).locator('.cartao-ganharam tbody tr').count() === 2, 'filtro "Retirados": estado=retirado, de volta à página 1')
    // o servidor diz 409 (outra pessoa tirou antes): o erro aparece no diálogo e nada muda
    await aba(page).locator('.segmentos[aria-label="Situação do emblema"] button', { hasText: 'Todos' }).click()
    await page.waitForTimeout(1500)
    await aba(page).locator('.cartao-ganharam tbody tr[data-id="7005"] button', { hasText: 'Tirar' }).click()
    await page.waitForSelector('dialog[open].dialogo-perigo')
    await page.locator('dialog[open] button[type=submit]').click()
    ok(await page.locator('dialog[open] .erro-campo:not([hidden])').count() === 1 && !page.pedidos.some((p) => p.acao === 'emblema_retirar'), 'tirar sem motivo não manda nada')
    await page.locator('dialog[open] .chip-motivo', { hasText: 'Trapaça' }).click()
    await page.locator('dialog[open] button[type=submit]').click()
    await page.waitForSelector('dialog[open] .dialogo-erro:not([hidden])', { timeout: 5000 })
    ok(/já foi retirado/.test(await page.textContent('dialog[open] .dialogo-erro')), '409 ja_retirado: a frase do servidor no diálogo')
    const p = page.pedidos.find((x) => x.acao === 'emblema_retirar')
    ok(p && p.id === 7005 && p.motivo === 'Trapaça: números que o jogo não dá.', 'emblema_retirar {id, motivo} com o motivo do chip')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await aba(page).locator('.cartao-ganharam tbody tr[data-id="7002"] button', { hasText: 'Devolver' }).click()
    await page.waitForSelector('dialog[open]')
    ok(/Tinha saído por: “Trapaça/.test(await page.textContent('dialog[open]')), 'devolver: o diálogo lembra o motivo da retirada')
    await page.locator('dialog[open] button[type=submit]').click()
    ok(await esperarToast(page, /Emblema devolvido/) && page.pedidos.some((x) => x.acao === 'emblema_devolver' && x.id === 7002 && !('motivo' in x)), 'devolver sem motivo (é opcional): emblema_devolver {id}')
  })
  await secao(page, '2c. ficha: as três situações das conquistas e as carreiras-prova', async () => {
    await ir(page, `#/usuarios?conta=${UID}`, 2500)
    const cab = await page.locator('#gaveta #u-conquistas .cartao-cabeca').textContent()
    ok(/50 provadas de 87/.test(cab) && /20 conferidas/.test(cab) && /10 só do aparelho/.test(cab), 'Conquistas: 50 provadas de 87 · 20 conferidas · 10 só do aparelho')
    const larg = await page.locator('#gaveta .barra-provas i').evaluateAll((is) => is.map((i) => [i.className, Math.round(parseFloat(i.style.width) * 10) / 10]))
    ok(larg.length === 3 && Math.abs(larg[0][1] - 23) < 0.2 && Math.abs(larg[1][1] - 34.5) < 0.2 && Math.abs(larg[2][1] - 11.5) < 0.2, 'a barra das 87 com as três partes (' + JSON.stringify(larg) + ')')
    await page.locator('#gaveta .detalhes-conquistas summary').click()
    const grupos = await page.locator('#gaveta .grupo-conquistas h3').allTextContents()
    ok(/conferidas no replay · 20/.test(grupos[0]) && /ainda não conferidas · 30/.test(grupos[1]) && /Só do aparelho \(não provadas\) · 10/.test(grupos[2]) && /Faltam provar para as 87 · 37/.test(grupos[3]), 'os grupos: 20, 30, 10 e as 37 que faltam provar (' + grupos.join(' | ') + ')')
    ok(await page.locator('#gaveta .grupo-conquistas a.chip-link[href*="carreira=501"]').count() === 20, 'a conquista provada leva à carreira que prova')
    ok(await page.locator('#gaveta #u-conquistas a', { hasText: 'Verificar as provas no jogo' }).getAttribute('href') === `../#/verificar?conta=${UID}`, '"Verificar as provas no jogo" → o #/verificar?conta= do jogo (lote)')
    ok(!page.pedidos.some((x) => x.r === 'provas'), 'as carreiras-prova só são pedidas quando o bloco abre')
    await page.locator('#gaveta .detalhes-provas summary').click()
    await page.waitForSelector('#gaveta .provas-carreiras tbody tr')
    ok(await page.locator('#gaveta .provas-carreiras tbody tr').count() === 4 && await page.locator('#gaveta .provas-carreiras tr[data-id="503"]', { hasText: 'Não vale: Esta carreira não começou com uma semente' }).count() === 1
      && await page.locator('#gaveta .provas-carreiras tr[data-id="504"] .chip-perigo', { hasText: 'Não bateu' }).count() === 1 && await page.locator('#gaveta .provas-carreiras .chip', { hasText: 'Essencial' }).count() === 2,
      'carreiras-prova: as que não valem com o motivo, a que não bateu, as essenciais')
    ok(await page.locator('#gaveta .provas-carreiras tr[data-id="502"]', { hasText: 'regras de antes da v3.4' }).count() === 1 && await page.locator('#gaveta .provas-carreiras tr[data-id="503"] a', { hasText: 'Verificar no jogo' }).count() === 0,
      'a jogada com as regras de antes marcada; a que não vale sem "Verificar no jogo"')
    ok(await page.locator('#gaveta #u-emblemas tbody tr').count() === 2 && await page.locator('#gaveta #u-emblemas tr.emblema-retirado .emblema-apagado').count() === 1, 'Emblemas: os 2, o retirado com a moeda apagada')
    ok(await page.locator('#gaveta #u-carreiras .chip', { hasText: 'Prova de 20 conquistas' }).count() === 1 && await page.locator('#gaveta #u-carreiras .chip', { hasText: 'Prova de 30 conquistas' }).count() === 1, 'Carreiras: "Prova de N conquistas" em cada carreira que prova')
    ok(/50 provadas · 20 conferidas/.test(await page.locator('#gaveta .ladrilho', { hasText: 'Conquistas' }).textContent()) && /1/.test(await page.locator('#gaveta .ladrilho', { hasText: 'Emblemas' }).textContent()), 'os números: conquistas provadas e conferidas; 1 emblema (o outro retirado)')
  })
  await secao(page, '2d. editor de emblema: o que vai no desafio_salvar', async () => {
    await page.keyboard.press('Escape')
    await ir(page, '#/desafios?parte=novo&modo=emblema', 2200)
    ok(await page.locator('.segmentos[aria-label="Tipo do desafio"] button[aria-pressed="true"]').textContent().then((t) => /^Emblema/.test(t)) && await page.locator('#dz-premio').isHidden(), 'modo=emblema: abre no tipo emblema, sem o prêmio')
    ok(await page.locator('.emblema-icones button').count() === 38 && await page.locator('.emblema-cores .emblema-cor').count() === 8, 'os 38 ícones do mapa das conquistas e as 8 cores prontas')
    ok(await page.inputValue('#dz-partidasMin') === '0' && !(await page.isChecked('#dz-emailVerificado')), 'os requisitos de partida do emblema: nenhum')
    await page.fill('#dz-titulo', 'Matador do mock')
    await page.fill('#dz-copas', '0')
    await page.fill('#dz-gols', '6000')
    await page.waitForTimeout(200)
    ok(/De 0 a 5\.000/.test(await page.textContent('.editor-desafio')), 'gols acima do teto: "De 0 a 5.000."')
    await page.fill('#dz-gols', '500')
    await page.fill('#dz-clubes', '3')
    await page.fill('#dz-nacionalidade-codigo', 'X1')
    await page.locator('.campo-selecao button', { hasText: 'Pôr' }).click()
    ok(/2 a 4 letras/.test(await page.textContent('.campo-selecao')), 'código de seleção estranho: o aviso no campo')
    await page.fill('#dz-nacionalidade-codigo', 'bra')
    await page.keyboard.press('Enter')
    await page.selectOption('#dz-nacionalidade', 'ARG')
    ok(await page.locator('.selecoes-escolhidas .chip').count() === 2 && /Brasil · BRA/.test(await page.textContent('.selecoes-escolhidas')), 'seleções escolhidas em pílulas (código digitado e da lista)')
    await page.locator('.selecoes-escolhidas .chip-x').last().click()
    ok(await page.locator('.selecoes-escolhidas .chip').count() === 1, '× tira a seleção')
    await page.locator('.emblema-icones button[data-icone="crown"]').click()
    await page.locator('.segmentos[aria-label="Dificuldade"] button', { hasText: 'Lendário' }).click()
    ok(await page.locator('.emblema-cores button[aria-pressed="true"]').getAttribute('data-cor') === '#c9b8ff', 'escolher a dificuldade troca a cor de partida pela dela (lilás)')
    ok(await page.locator('.previa-desafio .emblema').count() === 1 && await page.locator('.previa-desafio .chip-dif-lendario').count() === 1 && /mais de|500 gols/.test(await page.textContent('.previa-desafio')), 'a prévia com a moeda, a dificuldade e o critério')
    await page.locator('[data-campo="home"] .interruptor').click()
    ok(await page.isChecked('#dz-home'), '"Na faixa da tela inicial" ligado')
    await aba(page).locator('.barra-salvar button', { hasText: 'Criar desafio' }).click()
    await page.waitForSelector('dialog[open]')
    ok(/nem dá o emblema até você ativar/.test(await page.textContent('dialog[open]')), 'criar: "nasce desativado … ao ativar, as contas que já cumprem ganham"')
    await page.locator('dialog[open] button[type=submit]').click()
    ok(await esperarToast(page, /criado/), 'criado (toast)')
    const s = page.pedidos.find((x) => x.acao === 'desafio_salvar')
    ok(s && s.modo === 'emblema' && s.slug === 'matador-do-mock' && JSON.stringify(s.criterio) === '{"gols":500,"clubes":3,"nacionalidade":["BRA"]}' && JSON.stringify(s.emblema) === '{"icone":"crown","cor":"#c9b8ff"}'
      && s.dificuldade === 'lendario' && s.home === true && JSON.stringify(s.requisitos) === JSON.stringify(REQ_E) && !('premio' in s), 'desafio_salvar: modo, critério novo, emblema, dificuldade, faixa e requisitos (sem prêmio) — ' + JSON.stringify(s))
    await page.waitForTimeout(1500)
    ok(/#\/desafios\?id=777$/.test(await page.evaluate(() => location.hash)), 'depois de criar, abre o desafio')
  })
  ok((await page.evaluate(() => window.__csp)).length === 0, 'CSP: nenhuma violação (a cor do emblema entra pelo CSSOM)')
  ok(page.erros.length === 0, 'nenhum erro de JavaScript' + (page.erros.length ? ': ' + page.erros.slice(0, 3).join(' | ') : ''))
  await ctx.close()
}

// ═══ 3. celular: os casos de borda sem rolagem lateral ══════════════════════════════════════
{
  const { ctx, page } = await aparelho(390, 'v34')
  await entrar(page)
  await secao(page, '3. celular', async () => {
    for (const [hash, nome] of [['#/desafios', 'lista com o título comprido'], ['#/desafios?id=950', 'quem ganhou (120)'], ['#/desafios?id=952&parte=editar', 'editor do emblema'], ['#/desafios?parte=novo&modo=emblema', 'emblema novo'], [`#/usuarios?conta=${UID}`, 'ficha com provas e emblemas']]) {
      await ir(page, hash, 2000)
      await semRolagem(page, 'celular · ' + nome)
      if (/parte=/.test(hash)) await aba(page).locator('.barra-salvar button', { hasText: /Descartar|Cancelar/ }).click().catch(() => {})
      if (await page.locator('dialog[open]').count()) await page.locator('dialog[open] button[type=submit]').click()
    }
    await ir(page, '#/desafios?parte=novo&modo=emblema', 2000)
    const peq = await page.evaluate(() => Array.from(document.querySelectorAll('.emblema-icones button, .emblema-cores button')).filter((b) => b.getBoundingClientRect().height < 36).length)
    ok(peq === 0, 'celular: os botões de ícone e de cor com 36 px ou mais')
    ok(page.erros.length === 0, 'celular: nenhum erro de JavaScript' + (page.erros.length ? ': ' + page.erros.slice(0, 3).join(' | ') : ''))
  })
  await ctx.close()
}

await browser.close()
const r = resultado()
console.log(`\npainel v3.4 (mock): ${r.oks} ok, ${r.falhas} falha(s) em ${((performance.now() - t0) / 1000).toFixed(0)} s`)
if (r.falhas) console.log('  ' + r.lista.join('\n  '))
process.exit(r.falhas ? 1 : 0)
