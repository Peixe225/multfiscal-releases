#!/usr/bin/env node
// LENDA v3.5 · suíte mobile — a carreira do Modo Clássico do começo ao fim, jogada com o dedo (tap) num celular emulado.
//
//   LENDA_URL=http://127.0.0.1:9110/lenda/ node servidor/teste/mobile/carreira-classico.mjs --aparelho pequeno-320 --ritmo intensa --lento
//
// Opções: --aparelho <nome> (APARELHOS em carreira-lib.mjs) · --ritmo intensa|normal|expressa · --lento (4G lento + CPU 4×)
//         --pular (toca "Pular" nas revelações; sem ele a animação roda inteira) · --share falso (navigator.share que aceita
//         arquivo, como no Android/iOS; sem ele, o do Chromium do Linux = não existe, como num WebView de app)
//         --sem-extras (só joga: sem abas, recarregar, voltar, girar) · --limite-min N (padrão 25)
//         --posicao "Centroavante" (o nome da posição como no campo: Goleiro, Zagueiro, Meia-atacante…)
// Faz, na ordem: Home → identidade (teclado virtual simulado encolhendo a janela, busca de país, posição) → cada tipo de
// decisão (print do 1º de cada tipo) → comemorações/gala → aba Temporada/Prêmios/Mundo → som → recarregar no meio →
// voltar do Android no meio → girar → recarregar DURANTE a revelação → fim (card) → voltar no fim → resumo (card, gráfico,
// sala de troféus, lendas, Nota de Legado) → Compartilhar → voltar do resumo.
// Saída: prints em $LENDA_PRINTS (aparelho_tela.png) e o relatório JSON <aparelho>_<ritmo>.json na mesma pasta.
// Não escreve nada no servidor além do que o jogo manda sozinho (medição de visitas); sem conta.
// Sai com código 1 se houver algum achado (rolagem lateral, sobreposição, campo escondido pelo teclado, card do fim fora
// da tela, trava > 2 s, compartilhar lento, erro no console…). Trava entre 1 e 2 s com --lento fica como nota: a
// simulação da temporada ainda roda na thread principal (o "Simulando…" aparece antes; ver naoFeito da v3.5).
import { readFileSync, writeFileSync } from 'node:fs'
import { abrir, lancar, print, medir, relatar, teclado, girar, lerKv, sleep, URL0, PRINTS, longasDesde, agora, inesperados } from './carreira-lib.mjs'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  if (i < 0) return d
  const v = process.argv[i + 1]
  return !v || v.startsWith('--') ? true : v
}
const NOME = arg('aparelho', 'iphone-se')
const RITMO_ARG = arg('ritmo', 'expressa')
const LENTO = !!arg('lento', false)
const PULAR = !!arg('pular', false)
const SHARE = arg('share', null)
const EXTRAS = !arg('sem-extras', false)
const LIMITE = Number(arg('limite-min', 25)) * 60_000
// --fila scripts/gravar/filas/intenso.json:v-intenso-01 → refaz pela tela uma carreira gravada (semente, identidade, ritmo e
// as escolhas): serve para chegar às telas raras (Bola de Ouro/gala, seleção, pênalti, aposentadoria) de propósito
const FILA = (() => {
  const v = arg('fila', null)
  if (!v) return null
  const [arq, nome] = String(v).split(':')
  const lista = JSON.parse(readFileSync(new URL(`../../../${arq}`, import.meta.url), 'utf8'))
  const f = lista.find((x) => x.nome === nome)
  if (!f) throw new Error(`fila ${nome} não está em ${arq}`)
  return f
})()
const POS_NOME = { GOL: 'Goleiro', ZAG: 'Zagueiro', LD: 'Lateral-direito', LE: 'Lateral-esquerdo', VOL: 'Volante', MC: 'Meio-campista', ME: 'Meia-esquerda', MD: 'Meia-direita', MEI: 'Meia-atacante', PE: 'Ponta-esquerda', PD: 'Ponta-direita', CA: 'Centroavante' }
const POSICAO = FILA ? POS_NOME[FILA.identity.position] : arg('posicao', 'Centroavante')
const RITMO = FILA ? FILA.pace : RITMO_ARG
const TAG = `${NOME}_${FILA ? FILA.nome : RITMO}${LENTO ? '_lento' : ''}`
const PACE_LABEL = { intensa: 'Intenso', normal: 'Normal', expressa: 'Expresso' }

const R = { aparelho: NOME, ritmo: RITMO, lento: LENTO, pular: PULAR, url: URL0, tempos: {}, telas: {}, achados: [], decisoes: [], comemoracoes: [], extras: {}, erros: [], rede: [] }
const achado = (m) => {
  console.log(`  XX  ${m}`)
  R.achados.push(m)
}
const browser = await lancar()
const ap = await abrir(browser, NOME, { lento: LENTO, share: SHARE })
const { page, a } = ap
const wide = () => page.evaluate(() => matchMedia('(min-width: 45rem)').matches)
const telaPrint = (tela, o) => print(page, TAG, tela, o)
async function olhar(tela, o = {}) {
  // printAntes: telas que somem sozinhas (a comemoração sai 1,8 s depois de entrar) — o print vem antes das medidas
  const pr = o.printAntes ? await telaPrint(tela) : null
  const m = await medir(page, o)
  const ach = relatar(`[${TAG}] ${tela}`, m, { fonte: o.fonte })
  R.telas[tela] = { ...m, achados: ach }
  if (m.lateral > 0) achado(`${tela}: rolagem lateral de ${m.lateral}px`)
  for (const s of m.sobrepostos ?? []) achado(`${tela}: ${s}`)
  if (pr) R.telas[tela].print = pr
  else if (o.print !== false) R.telas[tela].print = await telaPrint(tela, { inteira: o.inteira })
  return m
}
/** tap com o dedo; se o elemento estiver coberto, conta e tenta pelo centro (o que a pessoa faria) */
async function tocar(loc, rot, o = {}) {
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {})
    await loc.tap({ timeout: o.timeout ?? 8000 })
    return true
  } catch (e) {
    if (o.opcional) return false
    achado(`não deu para tocar em "${rot}": ${String(e.message).split('\n')[0]}`)
    return false
  }
}
const quadros = () =>
  page.evaluate(() => {
    const q = (window.__q = { max: 0, n: 0, lentos: 0, ini: performance.now() })
    let ult = performance.now()
    const loop = (t) => {
      const d = t - ult
      ult = t
      q.n++
      if (d > q.max) q.max = d
      if (d > 100) q.lentos++
      if (!q.parar) requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
const lerQuadros = () =>
  page.evaluate(() => {
    const q = window.__q
    if (!q) return null
    q.parar = true
    const s = (performance.now() - q.ini) / 1000
    return { fps: Math.round(q.n / s), maiorIntervaloMs: Math.round(q.max), quadrosLentos: q.lentos, s: Math.round(s * 10) / 10 }
  })

// ───────────────────────── 1. Home ─────────────────────────
const t0 = Date.now()
await page.goto(URL0, { waitUntil: 'commit', timeout: 120000 })
await page.locator('.ld-ctas__start').waitFor({ state: 'visible', timeout: 180000 })
R.tempos.homeComBotaoMs = Date.now() - t0
await sleep(800)
{
  const r = await page.locator('.ld-ctas__start').boundingBox()
  R.extras.homeBotaoComecar = r ? { top: Math.round(r.y), bottom: Math.round(r.y + r.height), janela: a.h, visivelSemRolar: r.y + r.height <= a.h } : null
  if (r && r.y + r.height > a.h) achado(`Home: o botão "Começar carreira" fica abaixo da dobra (topo em ${Math.round(r.y)} px numa janela de ${a.h} px) — é preciso rolar para achar`)
}
await olhar('01-home')
await tocar(page.locator('.ld-rhythm [role="radio"]', { hasText: PACE_LABEL[RITMO] }), `ritmo ${PACE_LABEL[RITMO]}`)
const tId = Date.now()
await tocar(page.locator('.ld-ctas__start'), 'Começar carreira')
await page.locator('input[placeholder="Buscar país"]').waitFor({ state: 'visible', timeout: 120000 })
R.tempos.identidadeMs = Date.now() - tId
await sleep(600)

// ───────────────────────── 2. Identidade ─────────────────────────
const assistente = !(await wide())
R.extras.identidadeModo = assistente ? 'assistente de 3 passos (celular)' : 'colunas (tela larga)'
await olhar('02-identidade-nacionalidade', { fonte: true })
// busca de país com o teclado aberto
const busca = page.locator('input[placeholder="Buscar país"]')
await tocar(busca, 'Buscar país')
await teclado(page, a, true)
let m = await medir(page)
if (m.coberto?.fora || m.coberto?.porCima) achado(`teclado aberto: o campo "Buscar país" fica escondido (${JSON.stringify(m.coberto)})`)
await page.keyboard.type(FILA ? FILA.identity.nationality : 'bras', { delay: 80 })
await sleep(500)
await olhar('03-identidade-busca-teclado', { fonte: true })
{
  // o 1º resultado à vista acima do teclado?
  const res = page.locator('#id-nation-list [role="radio"]').first()
  const bb = await res.boundingBox()
  const vh = await page.evaluate(() => innerHeight)
  R.extras.buscaPrimeiroResultado = bb ? { top: Math.round(bb.y), bottom: Math.round(bb.y + bb.height), janela: vh } : null
  if (bb && bb.y + bb.height > vh) achado(`teclado aberto: o resultado "Brasil" da busca fica atrás do teclado (topo ${Math.round(bb.y)} px, janela ${vh} px)`)
}
await tocar(FILA ? page.locator('#id-nation-list [role="radio"]').first() : page.locator('#id-nation-list [role="radio"]', { hasText: /^\s*Brasil\s*$/ }).first(), 'país (resultado da busca)')
await page.evaluate(() => document.activeElement?.blur?.())
await teclado(page, a, false)
await sleep(400)
await olhar('04-identidade-pais-escolhido')
if (assistente) {
  await tocar(page.getByRole('button', { name: /^Continuar/ }), 'Continuar (passo 1)')
  await page.locator('#id-surname').waitFor({ state: 'visible', timeout: 20000 })
  await sleep(500)
}
await olhar('05-identidade-nome', { fonte: true })
const nome = page.locator('#id-surname')
await tocar(nome, 'Sobrenome')
await teclado(page, a, true)
await page.fill('#id-surname', '')
await page.keyboard.type(FILA ? FILA.identity.surname : 'Albuquerque', { delay: 60 })
await sleep(400)
m = await olhar('06-identidade-nome-teclado', { fonte: true })
if (m.coberto?.fora || m.coberto?.porCima) achado(`teclado aberto: o campo Sobrenome fica escondido (${JSON.stringify(m.coberto)})`)
{
  // os botões do rodapé (Voltar/Continuar) com o teclado aberto
  const cont = page.getByRole('button', { name: assistente ? /^Continuar/ : /Confirmar identidade/ })
  const bb = await cont.boundingBox().catch(() => null)
  const sur = await nome.boundingBox()
  if (bb && sur && bb.y < sur.y + sur.height && bb.y + bb.height > sur.y) achado('teclado aberto: o botão do rodapé fica por cima do campo Sobrenome')
}
await page.evaluate(() => document.activeElement?.blur?.())
await teclado(page, a, false)
await tocar(page.getByRole('button', { name: 'Aumentar número' }), 'Aumentar número')
await tocar(page.locator('#id-number'), 'Número')
await teclado(page, a, true)
m = await medir(page)
if (m.coberto?.fora || m.coberto?.porCima) achado(`teclado aberto: o campo Número fica escondido (${JSON.stringify(m.coberto)})`)
await telaPrint('07-identidade-numero-teclado')
await page.evaluate(() => document.activeElement?.blur?.())
await teclado(page, a, false)
if (FILA) {
  await tocar(page.locator('#id-number'), 'Número')
  await page.fill('#id-number', String(FILA.identity.number))
  await page.evaluate(() => document.activeElement?.blur?.())
}
await tocar(page.getByRole('radio', { name: FILA && FILA.identity.foot === 'right' ? 'Direita' : 'Esquerda', exact: true }), 'Perna')
await olhar('08-identidade-pronta')
if (assistente) {
  await tocar(page.getByRole('button', { name: /^Continuar/ }), 'Continuar (passo 2)')
  await sleep(600)
}
const chip = page.locator('[role="radiogroup"][aria-label="Posição em campo"]').getByRole('radio', { name: POSICAO, exact: true }).first()
await chip.waitFor({ state: 'visible', timeout: 20000 })
await olhar('09-identidade-posicao')
await tocar(chip, 'Posição')
await sleep(400)
await olhar('10-identidade-posicao-escolhida')
if (FILA)
  await page.evaluate((sem) => {
    sessionStorage.setItem('teste:sementes', JSON.stringify([sem]))
    sessionStorage.setItem('teste:armado', '1')
  }, [FILA.a0, FILA.a1])
const tCarreira = Date.now()
await tocar(page.getByRole('button', { name: assistente ? /^Confirmar$/ : /Confirmar identidade/ }), 'Confirmar')
await page.waitForFunction(() => location.hash.startsWith('#/carreira'), null, { timeout: 120000 })
await page.locator('.ck-opt:not(.is-locked), .ck-pen__zone').first().waitFor({ state: 'visible', timeout: 180000 })
R.tempos.confirmarAtePrimeiraDecisaoMs = Date.now() - tCarreira
R.tempos.totalComPausasDoTesteMs = Date.now() - t0
console.log(`  ..  tempos: ${JSON.stringify(R.tempos)}`)
await sleep(900)
await olhar('11-carreira-primeira-decisao')
await telaPrint('11b-carreira-primeira-decisao-inteira', { inteira: true })

// ───────────────────────── 3. A carreira ─────────────────────────
const tiposVistos = new Set()
const comemoradas = new Set()
let n = 0
let fez = { abas: false, som: false, recarregar: false, voltar: false, girar: false, recarregarRevelando: false, recolher: false }
const tJogo = Date.now()
const kindAtual = async () => ((await page.locator(assistente ? '.ck-sheet .ck-kind' : '.ck-decision .ck-kind').first().textContent({ timeout: 2000 }).catch(() => '')) || '').trim()
const tituloAtual = async () => ((await page.locator('#ck-dtitle').first().textContent({ timeout: 2000 }).catch(() => '')) || '').trim()
const fimNaTela = async () => (await page.locator('.ck-end button', { hasText: /Jogar novamente/ }).count()) > 0
const picks = async () => (await lerKv(page, 'career:current'))?.replay?.picks?.length ?? -1

async function tratarComemoracao() {
  const cel = page.locator('.ck-cel[role="dialog"]')
  if (!(await cel.count())) return false
  const rotulo = ((await cel.getAttribute('aria-label').catch(() => '')) || '').slice(0, 80)
  const base = await cel.evaluate((el) => (el.classList.contains('is-rel') ? 'rebaixamento' : el.querySelector('.ck-cel__word')?.textContent?.trim() === 'LENDA' ? 'gala-premio' : 'titulo')).catch(() => 'titulo')
  // a Bola de Ouro (gala) e as comemorações com várias taças juntas (o layout que mais aperta no celular) têm print próprio
  const tipo = /Bola de Ouro/i.test(rotulo) ? `${base}-bola-de-ouro` : rotulo.split(',').length >= 3 ? `${base}-varias-tacas` : base
  if (!comemoradas.has(tipo)) {
    comemoradas.add(tipo)
    const tc0 = Date.now()
    await sleep(1000) // a entrada (900 ms)
    // o botão é conferido antes do print: a comemoração some sozinha 1,8 s depois de entrar
    const cont = cel.getByRole('button', { name: /^Continuar/ })
    const bb = (await cel.count()) ? await cont.boundingBox().catch(() => null) : null
    const vh = await page.evaluate(() => innerHeight)
    const aberta = (await cel.count()) > 0
    if (aberta && !bb) achado(`comemoração (${tipo}, ${rotulo}): o botão Continuar não aparece`)
    else if (bb && (bb.y + bb.height > vh || bb.y < 0)) achado(`comemoração (${tipo}, ${rotulo}): o botão Continuar fica fora da tela (topo ${Math.round(bb.y)}, janela ${vh})`)
    const mm = aberta ? await olhar(`20-comemoracao-${tipo}`, { raiz: '.ck-cel', printAntes: true }) : { pequenos: [] }
    R.comemoracoes.push({ tipo, rotulo, decisao: n, pequenos: mm.pequenos.length, continuar: bb ? { top: Math.round(bb.y), bottom: Math.round(bb.y + bb.height), janela: vh } : null, sumiuSozinhaAntesDe: aberta ? null : Date.now() - tc0 })
    if (await cel.count()) await tocar(cont, `Continuar da comemoração (${tipo})`, { opcional: true })
  } else {
    if (!R.comemoracoes.some((c) => c.decisao === n && c.rotulo === rotulo)) R.comemoracoes.push({ tipo, rotulo, decisao: n })
    // nas próximas: às vezes deixa sumir sozinha (1,8 s), às vezes toca fora (no véu)
    if (n % 2) await page.mouse.click(10, 200).catch(() => {})
  }
  await sleep(500)
  return true
}

async function esperarDecisaoOuFim(ms = 120000) {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if (await fimNaTela()) return 'fim'
    if (await tratarComemoracao()) continue
    const opt = page.locator('.ck-opt:not(.is-locked):not([disabled]), .ck-pen__zone:not([disabled])').first()
    if ((await opt.count()) && (await opt.isVisible().catch(() => false))) {
      // o sheet do celular precisa estar aberto e a revelação acabada
      const revelando = await page.locator('.ck-skip, .ck-sheet__skip').count()
      if (!revelando) return 'decisao'
    }
    // sheet recolhido sem revelação (a pessoa recolheu): abre
    const recolhido = page.locator('.ck-sheet.is-collapsed .ck-sheet__peek')
    if ((await recolhido.count()) && !(await page.locator('.ck-sheet__skip').count())) {
      await tocar(recolhido, 'abrir o sheet da decisão', { opcional: true })
    }
    if (PULAR) {
      const pular = page.locator('.ck-sheet__skip button, button.ck-skip').first()
      if (await pular.count()) await tocar(pular, 'Pular', { opcional: true, timeout: 2000 })
    }
    await sleep(150)
  }
  return 'tempo'
}

while (Date.now() - tJogo < LIMITE) {
  const st = await esperarDecisaoOuFim()
  if (st === 'fim') break
  if (st === 'tempo') {
    achado(`a carreira ficou parada mais de 2 min sem decisão nem fim (decisão ${n + 1})`)
    await telaPrint(`99-parada-${n + 1}`)
    break
  }
  n++
  // o pênalti vem como "Evento da carreira": conta como tipo próprio para ter print e medidas
  const kind = `${await kindAtual()}${(await page.locator('.ck-pen__zone').count()) ? ' (pênalti)' : ''}`
  const titulo = await tituloAtual()
  const d = { n, kind, titulo }
  // 1º de cada tipo: print e medidas do sheet/painel
  if (!tiposVistos.has(kind)) {
    tiposVistos.add(kind)
    await sleep(700)
    const mm = await olhar(`12-decisao-${String(tiposVistos.size).padStart(2, '0')}-${kind}`, { raiz: assistente ? '.ck-sheet' : '.ck-decision' })
    d.medidas = { pequenos: mm.pequenos.length, cortados: mm.cortados.filter((c) => !c.reticencias).length }
    if (assistente) {
      const sh = await page.evaluate(() => {
        const s = document.querySelector('.ck-sheet')
        const inner = document.querySelector('.ck-sheet__inner')
        const r = s?.getBoundingClientRect()
        const opts = [...document.querySelectorAll('.ck-sheet .ck-opt, .ck-sheet .ck-pen__zone')].map((o) => o.getBoundingClientRect())
        return { top: r ? Math.round(r.top) : null, altura: r ? Math.round(r.height) : null, janela: innerHeight, rolaDentro: inner ? inner.scrollHeight > inner.clientHeight + 2 : false, opcoesForaDaTela: opts.filter((o) => o.bottom > innerHeight + 1 || o.top < 0).length, nOpcoes: opts.length }
      })
      d.sheet = sh
      if (sh.top != null && sh.top < 60) achado(`decisão "${kind}" (${titulo}): o sheet ocupa a tela quase toda (topo em ${sh.top} px de ${sh.janela}) — a tabela da carreira some atrás dele`)
      if (sh.opcoesForaDaTela && !sh.rolaDentro) achado(`decisão "${kind}" (${titulo}): ${sh.opcoesForaDaTela} de ${sh.nOpcoes} opções ficam fora da tela e o sheet NÃO rola`)
      else if (sh.opcoesForaDaTela) console.log(`  ..  decisão "${kind}": ${sh.opcoesForaDaTela} de ${sh.nOpcoes} opções abaixo da dobra (o sheet rola)`)
    }
  }

  // extras no meio da carreira (uma vez cada)
  if (EXTRAS && n === 2 && !fez.abas) {
    fez.abas = true
    for (const [rot, re] of [['temporada', /^Temporada/], ['premios', /^Prêmios/], ['mundo', /^Mundo/]]) {
      const tab = page.getByRole('tab', { name: re }).first()
      if (!(await tab.count())) {
        achado(`aba ${rot} não encontrada`)
        continue
      }
      await tocar(tab, `aba ${rot}`)
      await sleep(1500)
      await olhar(`13-aba-${rot}`)
      await telaPrint(`13-aba-${rot}-inteira`, { inteira: true })
    }
    await tocar(page.getByRole('tab', { name: /^Carreira/ }).first(), 'aba Carreira')
    await sleep(800)
    const aberto = assistente ? await page.locator('.ck-sheet:not(.is-collapsed) .ck-opt, .ck-sheet:not(.is-collapsed) .ck-pen__zone').first().isVisible().catch(() => false) : true
    R.extras.abasVoltaCarreiraSheetAberto = aberto
    if (!aberto) achado('depois de ver as abas e voltar para "Carreira", o sheet da decisão continua recolhido')
    await telaPrint('13-aba-carreira-de-volta')
  }
  if (EXTRAS && n === 3 && !fez.som) {
    fez.som = true
    R.extras.som = await page.evaluate(() => ({ ...window.__sons, estado: window.__sonsCtx?.state ?? null }))
    console.log(`  ..  som: ${JSON.stringify(R.extras.som)}`)
    if (!R.extras.som?.ctx) achado('som: nenhum AudioContext criado depois de vários toques (o jogo fica mudo)')
    else if (R.extras.som.estado !== 'running') achado(`som: o AudioContext ficou "${R.extras.som.estado}" depois dos toques`)
  }
  if (EXTRAS && n === 4 && !fez.recarregar) {
    fez.recarregar = true
    const antes = { titulo: await tituloAtual(), picks: await picks() }
    const tr = Date.now()
    await page.reload({ waitUntil: 'commit' })
    const st2 = await esperarDecisaoOuFim(180000)
    const depois = { titulo: await tituloAtual(), picks: await picks(), hash: await page.evaluate(() => location.hash), ms: Date.now() - tr }
    R.extras.recarregar = { antes, depois }
    console.log(`  ..  recarregar: ${JSON.stringify(R.extras.recarregar)}`)
    if (st2 !== 'decisao' || depois.titulo !== antes.titulo || depois.picks !== antes.picks) achado(`recarregar no meio da carreira não voltou para a mesma decisão: ${JSON.stringify(R.extras.recarregar)}`)
    await olhar('14-recarregou-no-meio')
  }
  if (EXTRAS && n === 5 && !fez.voltar) {
    fez.voltar = true
    const antes = { titulo: await tituloAtual(), picks: await picks(), hash: await page.evaluate(() => location.hash) }
    await page.goBack({ waitUntil: 'commit' }).catch(() => {})
    await sleep(1500)
    const h1 = await page.evaluate(() => ({ hash: location.hash, href: location.href }))
    await telaPrint('15-voltar-android-no-meio')
    const cont = page.getByRole('button', { name: /Continuar carreira/ })
    const temContinuar = (await cont.count()) > 0
    const desistiu = await page.locator('[role="dialog"]').count()
    R.extras.voltarNoMeio = { antes, depois: h1, temContinuar, dialogo: desistiu }
    console.log(`  ..  voltar no meio: ${JSON.stringify(R.extras.voltarNoMeio)}`)
    if (/identidade/.test(h1.hash)) achado(`voltar do Android no meio da carreira abre o formulário de identidade (${h1.hash})`)
    // volta para a carreira como a pessoa faria: "Continuar" na Home, ou o avançar
    if (temContinuar) await tocar(cont.first(), 'Continuar carreira (Home)')
    else await page.goForward({ waitUntil: 'commit' }).catch(() => {})
    const st3 = await esperarDecisaoOuFim(120000)
    const depois2 = { titulo: await tituloAtual(), picks: await picks() }
    R.extras.voltarNoMeio.retomou = depois2
    if (st3 !== 'decisao' || depois2.picks !== antes.picks) achado(`depois do voltar do Android, a carreira não retomou do mesmo ponto: ${JSON.stringify({ antes, depois2 })}`)
  }
  if (EXTRAS && n === 6 && !fez.girar) {
    fez.girar = true
    const desvirar = await girar(page, a)
    await sleep(800)
    const mg = await olhar('16-girado-deitado')
    R.extras.girar = { deitado: { lateral: mg.lateral } }
    await telaPrint('16-girado-deitado-inteira', { inteira: true })
    const optVis = await page.locator('.ck-opt:not(.is-locked), .ck-pen__zone').first().isVisible().catch(() => false)
    if (!optVis) achado('girando o celular, as opções da decisão somem da tela')
    await desvirar()
    await sleep(600)
    const md = await olhar('17-desvirado')
    R.extras.girar.depois = { lateral: md.lateral }
  }

  // escolher: prefere continuar jogando (não a aposentadoria) e varia as opções
  const opcoes = page.locator('.ck-opt:not(.is-locked):not([disabled]):not(.is-retire)', { hasNotText: /Aposentar|Encerrar a carreira|Pendurar/ })
  const pen = page.locator('.ck-pen__zone:not([disabled])')
  let alvo
  if (FILA && FILA.picks[n - 1]) {
    const p = FILA.picks[n - 1]
    const feitas = await picks()
    if (feitas !== n - 1) achado(`fila ${FILA.nome}: na decisão ${n} o replay tinha ${feitas} escolhas (esperado ${n - 1})`)
    if (p.title && !titulo.includes(p.title) && !(await page.locator(`#ck-opt-${p.idx}`).textContent().catch(() => '')).includes(p.title)) console.log(`  ..  fila: decisão ${n} esperava "${p.title}" (tela: "${titulo}")`)
    alvo = page.locator(`#ck-opt-${p.idx}`)
  } else if (await pen.count()) alvo = pen.nth(n % Math.max(1, await pen.count()))
  else if (await opcoes.count()) alvo = opcoes.nth((n * 7) % (await opcoes.count()))
  else alvo = page.locator('.ck-opt:not(.is-locked):not([disabled])').first()
  d.escolha = ((await alvo.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!PULAR) await quadros()
  const tl0 = await agora(page)
  const printsAntes = await page.evaluate(() => (window.__prints ?? []).length).catch(() => 0)
  const tp = Date.now()
  const ok = await tocar(alvo, `opção da decisão ${n}`)
  if (!ok) {
    await telaPrint(`99-opcao-nao-tocou-${n}`)
    break
  }
  // resposta do motor: a revelação começa (sheet recolhe / "Pular" aparece) ou o fim
  const tr0 = Date.now()
  while (Date.now() - tr0 < 60000) {
    if ((await page.locator('.ck-sheet.is-collapsed, .ck-skip, .ck-sheet__skip, .ck-cel').count()) || (await fimNaTela())) break
    await sleep(50)
  }
  d.motorMs = Date.now() - tp
  // recarregar DURANTE a revelação (a escolha já foi gravada?)
  if (EXTRAS && n === 7 && !fez.recarregarRevelando) {
    fez.recarregarRevelando = true
    const p0 = await picks()
    await page.reload({ waitUntil: 'commit' })
    const st4 = await esperarDecisaoOuFim(180000)
    const p1 = await picks()
    R.extras.recarregarRevelando = { picksAntes: p0, picksDepois: p1, estado: st4 }
    console.log(`  ..  recarregar revelando: ${JSON.stringify(R.extras.recarregarRevelando)}`)
    await olhar('18-recarregou-revelando')
    if (p1 < p0) achado(`recarregar durante a revelação perdeu a escolha (${p0} → ${p1})`)
    R.decisoes.push(d)
    continue
  }
  const st5 = await esperarDecisaoOuFim(180000)
  d.cicloMs = Date.now() - tp
  if (!PULAR) d.quadros = await lerQuadros()
  {
    const ls = await longasDesde(page, tl0)
    d.longas = { n: ls.length, maiorMs: Math.max(0, ...ls), somaMs: ls.reduce((x, y) => x + y, 0) }
    d.teveprint = (await page.evaluate(() => (window.__prints ?? []).length).catch(() => 0)) > printsAntes
    if (d.longas.maiorMs > 2000) achado(`decisão ${n} (${kind}): a tela travou ${d.longas.maiorMs} ms seguidos (tarefa longa) no ciclo escolha→próxima decisão`)
    else if (d.longas.maiorMs > 1000) console.log(`  ..  decisão ${n} (${kind}): tarefa longa de ${d.longas.maiorMs} ms (o "Simulando…" já está na tela)`)
  }
  R.decisoes.push(d)
  console.log(`  ..  #${n} ${kind} · "${titulo.slice(0, 40)}" → ${d.escolha.slice(0, 30)} · motor ${d.motorMs} ms · ciclo ${d.cicloMs} ms${d.quadros ? ` · ${d.quadros.fps} fps, maior intervalo ${d.quadros.maiorIntervaloMs} ms` : ''} · longas ${d.longas.n} (maior ${d.longas.maiorMs} ms)${d.teveprint ? ' [com print]' : ''}`)
  if (d.motorMs > 5000) achado(`decisão ${n} (${kind}): o toque demorou ${d.motorMs} ms para responder (simulação travando a tela)`)
  if (st5 === 'fim') break
}
R.tempos.carreiraMs = Date.now() - tJogo
R.tempos.decisoes = n
const fim = await fimNaTela()
if (!fim) achado(`a carreira não chegou ao fim em ${Math.round(LIMITE / 60000)} min (${n} decisões)`)

// ───────────────────────── 4. Fim e resumo ─────────────────────────
if (fim) {
  await sleep(1200)
  await olhar('30-fim-card')
  await telaPrint('30-fim-card-inteira', { inteira: true })
  {
    const bb = await page.locator('.ck-end').boundingBox()
    const vh = await page.evaluate(() => innerHeight)
    const sy = await page.evaluate(() => scrollY)
    R.extras.fimCard = bb ? { top: Math.round(bb.y), janela: vh, scrollY: sy, visivel: bb.y < vh && bb.y + bb.height > 0 } : null
    if (bb && (bb.y >= vh || bb.y + bb.height <= 0)) achado(`fim da carreira: o card "Sua carreira chegou ao fim" fica fora da tela (topo em ${Math.round(bb.y)} px; janela ${vh}) — a pessoa precisa rolar para achar`)
  }
  // voltar do Android no fim
  if (EXTRAS) {
    await page.goBack({ waitUntil: 'commit' }).catch(() => {})
    await sleep(1500)
    const h = await page.evaluate(() => location.hash)
    await telaPrint('31-voltar-android-no-fim')
    const verResumo = page.getByRole('button', { name: /Ver resumo/ })
    R.extras.voltarNoFim = { hash: h, temVerResumo: (await verResumo.count()) > 0 }
    console.log(`  ..  voltar no fim: ${JSON.stringify(R.extras.voltarNoFim)}`)
    if (/identidade/.test(h)) achado(`voltar do Android no fim da carreira abre o formulário de identidade (${h})`)
    await page.goForward({ waitUntil: 'commit' }).catch(() => {})
    await sleep(1200)
    if (!(await page.locator('.ck-end').count())) {
      await page.goto(`${URL0}#/carreira`)
      await page.locator('.ck-end').waitFor({ timeout: 60000 }).catch(() => {})
    }
  }
  const tR = Date.now()
  await tocar(page.locator('.ck-end').getByRole('button', { name: /Ver resumo/ }), 'Ver resumo')
  await page.locator('.sm-top').waitFor({ timeout: 120000 }).catch(() => achado('o resumo não abriu em 2 min'))
  R.tempos.resumoMs = Date.now() - tR
  await sleep(2500)
  await olhar('40-resumo-topo')
  await telaPrint('41-resumo-inteiro', { inteira: true })
  // cada seção, como a pessoa rola
  for (const [rot, sel] of [
    ['grafico-ovr', '.sm-chartpanel'],
    ['sala-trofeus', '.sm-cabinet'],
    ['por-clube', '.sm-clubs'],
    ['premios', '.sm-awards'],
    ['lendas', '.sm-legends'],
    ['nota-legado', '.hl-lrc'],
    ['card-compartilhar', '#sm-share'],
  ]) {
    const loc = page.locator(sel).first()
    if (!(await loc.count())) {
      R.telas[`42-resumo-${rot}`] = { ausente: true }
      console.log(`  ..  resumo: seção ${rot} (${sel}) não encontrada`)
      continue
    }
    await loc.scrollIntoViewIfNeeded().catch(() => {})
    await sleep(700)
    await olhar(`42-resumo-${rot}`)
  }
  // gráfico do OVR: toque num ponto
  const graf = page.locator('.sm-chartpanel svg').first()
  if (await graf.count()) {
    const bb = await graf.boundingBox()
    if (bb) {
      await page.touchscreen.tap(bb.x + bb.width * 0.6, bb.y + bb.height * 0.5)
      await sleep(600)
      await telaPrint('43-resumo-grafico-toque')
    }
  }
  // compartilhar
  const comp = page.locator('#sm-share').getByRole('button', { name: /^Compartilhar$/ })
  if (await comp.count()) {
    await comp.scrollIntoViewIfNeeded()
    await sleep(2500) // o PNG é gerado quando o painel aparece
    const tc = Date.now()
    await tocar(comp, 'Compartilhar (card)')
    // espera a resposta: o navigator.share chamado ou a folha "Sua imagem" (até 30 s)
    let r = null
    let dlg = 0
    let respostaMs = null
    while (Date.now() - tc < 30000) {
      r = await page.evaluate(() => window.__compartilhado ?? null)
      dlg = await page.locator('[role="dialog"]').count()
      if (r || dlg) {
        respostaMs = Date.now() - tc
        break
      }
      await sleep(200)
    }
    await sleep(800)
    if (respostaMs == null) achado('Compartilhar: nada aconteceu em 30 s depois do toque')
    else if (respostaMs > 3000) achado(`Compartilhar: ${respostaMs} ms entre o toque e a resposta (o botão fica girando)`)
    if (r && r.ativa === false) achado(`Compartilhar: o navigator.share foi chamado ${r.aposToqueMs} ms depois do toque, fora da "ativação do usuário" — num celular de verdade ele seria recusado (NotAllowedError)`)
    const toast = ((await page.locator('[role="status"], [role="alert"], .lx-toast').allTextContents().catch(() => [])) || []).join(' | ').slice(0, 200)
    R.extras.compartilhar = { share: SHARE ?? 'nativo-do-chromium-linux (sem navigator.share)', chamado: r, dialogo: dlg, aviso: toast, respostaMs }
    console.log(`  ..  compartilhar: ${JSON.stringify(R.extras.compartilhar)}`)
    await olhar('44-resumo-compartilhar')
    if (SHARE === 'falso' && !r) achado('Compartilhar: o navigator.share (que aceita arquivo) não foi chamado')
    if (SHARE === 'falso' && r && !r.arquivos?.length) achado('Compartilhar: o card foi sem a imagem (nenhum arquivo no navigator.share)')
    // fecha o que abriu
    if (dlg) await page.keyboard.press('Escape').catch(() => {})
    await sleep(500)
  } else achado('resumo: botão Compartilhar do card não encontrado')
  // o ícone "Compartilhar card" do topo
  const topo = page.getByRole('button', { name: 'Compartilhar card' }).first()
  if (await topo.count()) {
    await page.evaluate(() => scrollTo(0, 0))
    await sleep(400)
    await tocar(topo, 'Compartilhar card (topo)', { opcional: true })
    await sleep(1200)
    await telaPrint('45-resumo-compartilhar-topo')
  }
  // voltar do Android no resumo
  if (EXTRAS) {
    await page.goBack({ waitUntil: 'commit' }).catch(() => {})
    await sleep(1500)
    R.extras.voltarDoResumo = { hash: await page.evaluate(() => location.hash) }
    console.log(`  ..  voltar do resumo: ${JSON.stringify(R.extras.voltarDoResumo)}`)
    await telaPrint('46-voltar-android-do-resumo')
  }
}

// tarefas longas do último documento (desde o último recarregar), sem as que cruzam um print do teste
R.longas = await page
  .evaluate(() => {
    const pr = window.__prints ?? []
    return (window.__longas ?? []).filter((l) => !pr.some(([a, b]) => l.t < b + 50 && l.t + l.d > a - 50))
  })
  .catch(() => [])
const longas = [...R.longas].sort((x, y) => y.d - x.d)
R.extras.tarefasLongas = { n: R.longas.length, maiores: longas.slice(0, 8), acimaDe1s: R.longas.filter((l) => l.d > 1000).length, somaMs: R.longas.reduce((s, l) => s + l.d, 0) }
console.log(`  ..  tarefas longas: ${JSON.stringify(R.extras.tarefasLongas)}`)
R.erros = inesperados(ap.erros)
R.avisos = ap.avisos.slice(0, 30)
R.rede = ap.rede.filter((x) => !/e\.php/.test(x) || !/ERR_ABORTED/.test(x))
if (R.erros.length) achado(`erros no console: ${[...new Set(R.erros)].slice(0, 6).join(' || ')}`)
if (ap.s5xx.length) achado(`respostas 5xx do servidor: ${[...new Set(ap.s5xx)].slice(0, 4).join(' || ')}`)
writeFileSync(`${PRINTS}/${TAG}.json`, JSON.stringify(R, null, 2))
console.log(`\n${TAG}: ${n} decisões, fim=${fim}, ${R.achados.length} achados · tempos ${JSON.stringify(R.tempos)}\nrelatório: ${PRINTS}/${TAG}.json`)
for (const x of R.achados) console.log(`   XX ${x}`)
await browser.close()
process.exitCode = R.achados.length ? 1 : 0
