// LENDA v3.5 · suíte mobile · HALL DAS LENDAS, DESAFIOS E CONQUISTAS pelo celular (emulação do Chromium).
//
//   # pilha local semeada (servidor/teste/integracao/subir.sh + hall-semear.mjs):
//   LENDA_INTEG_BASE=/tmp/lenda-v35-hall node servidor/teste/mobile/hall-mobile.mjs
//   # produção, só leitura (nenhum POST nem a medição de visitas sai do navegador):
//   node servidor/teste/mobile/hall-mobile.mjs --alvo prod --aparelhos iphone-se,galaxy-a
//   opções: --aparelhos a,b (padrão: todos) · --etapas faixa,desafios,hall,filtros,ficha,comunidade,suas,conquistas,ligas,
//           creditos,perfil,privacidade,girar,voltar,recarregar,rede,logado (padrão: todas as que cabem no alvo)
//
// Cada tela: rolagem lateral, alvos de toque < 40 px, texto cortado, campo com fonte < 16 px (zoom do iPhone), campo
// escondido pelo teclado (a janela encolhe, como no WebView dos apps), erros de console. Prints em
// $LENDA_PRINTS_HALL (padrão: <LENDA_PRINTS>/hall, com LENDA_PRINTS em ${TMPDIR:-/tmp}/lenda-mobile) e o relatório JSON no fim.
import { existsSync, readFileSync } from 'node:fs'
import { APARELHOS, abrirH, achados, errosDe, esperarTela, girar, lancar, nota, notas, offline, print, salvarRelatorio, sleep, teclado, tocar, ver, fimHall } from './hall-lib.mjs'

const arg = (k, def) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : def
}
const ALVO = arg('alvo', 'local')
const BASE = process.env.LENDA_INTEG_BASE ?? '/tmp/lenda-v35-hall'
const env = ALVO === 'local' ? Object.fromEntries(readFileSync(`${BASE}/segredos.env`, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const URL0 = ALVO === 'prod' ? 'https://oprojeto.online/lenda/' : (process.env.LENDA_URL ?? `http://127.0.0.1:${env.PORTA}/lenda/`)
const SEM = ALVO === 'local' && existsSync(`${BASE}/hall-semente.json`) ? JSON.parse(readFileSync(`${BASE}/hall-semente.json`, 'utf8')) : null
const TODAS = ['faixa', 'desafios', 'hall', 'filtros', 'ficha', 'comunidade', 'suas', 'conquistas', 'ligas', 'creditos', 'perfil', 'privacidade', 'girar', 'voltar', 'recarregar', 'rede', 'logado']
const ETAPAS = arg('etapas', TODAS.join(',')).split(',').filter(Boolean)
const NOMES = arg('aparelhos', Object.keys(APARELHOS).join(',')).split(',').filter(Boolean)
const tem = (e) => ETAPAS.includes(e)
const PROD = ALVO === 'prod'
console.log(`alvo ${ALVO} (${URL0}) · aparelhos ${NOMES.join(', ')} · etapas ${ETAPAS.join(', ')}`)

const browser = await lancar()
const hash = (d) => d.page.evaluate(() => location.hash)
const temDialogo = (d) => d.page.locator('[role="dialog"][aria-modal="true"]').count()
async function ir(d, h, sel, ms = 40000) {
  // o diálogo que acabou de fechar (Esc) devolve a entrada dele ao histórico com um history.back() assíncrono: um goto
  // logo depois (que a pessoa não consegue fazer: o jogo espera a volta no navigate) seria desfeito por ele. Confere o
  // endereço e navega de novo se a volta o desfez.
  const alvo = h.includes('#') ? h.slice(h.indexOf('#')) : null
  for (let i = 0; i < 3; i++) {
    await d.page.goto(`${URL0}${h}`, { waitUntil: 'domcontentloaded' })
    if (!alvo) break
    await sleep(350)
    const agora = await d.page.evaluate(() => location.hash).catch(() => null)
    if (agora === alvo || (alvo === '#/' && (agora === '' || agora === '#/'))) break
  }
  await esperarTela(d.page, sel, ms)
}
/** a rolagem do corpo do diálogo (lx-dialog__body): consegue chegar ao fim? e o botão Fechar está à vista? */
async function dialogo(d) {
  return d.page.evaluate(() => {
    const dl = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].pop()
    if (!dl) return null
    const r = dl.getBoundingClientRect()
    const body = dl.querySelector('.lx-dialog__body')
    const fechar = dl.querySelector('button[aria-label="Fechar"]')
    const rf = fechar?.getBoundingClientRect()
    const vv = window.visualViewport
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      h: Math.round(r.height),
      janela: Math.round(vv ? vv.height : innerHeight),
      rola: body ? body.scrollHeight > body.clientHeight + 2 : false,
      bodyH: body ? [body.clientHeight, body.scrollHeight] : null,
      fechar: rf ? { top: Math.round(rf.top), w: Math.round(rf.width), h: Math.round(rf.height), visivel: rf.top >= 0 && rf.bottom <= (vv ? vv.height : innerHeight) } : null,
      titulo: dl.querySelector('.lx-dialog__title')?.textContent?.trim().slice(0, 60) ?? null,
    }
  })
}
async function rolarDialogoAteOFim(d) {
  return d.page.evaluate(async () => {
    const dl = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].pop()
    const body = dl?.querySelector('.lx-dialog__body')
    if (!body) return null
    body.scrollTop = body.scrollHeight
    await new Promise((r) => setTimeout(r, 400))
    return { fim: Math.abs(body.scrollTop + body.clientHeight - body.scrollHeight) < 3, scrollTop: Math.round(body.scrollTop) }
  })
}
/** rola a página até o elemento ficar no meio da tela (como o dedo faria) */
const rolarAte = (d, sel) => d.page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center' }), sel)

for (const nome of NOMES) {
  const a = APARELHOS[nome]
  console.log(`\n═══ ${nome} (${a.w}×${a.h} @${a.dpr}) ═══`)
  const d = await abrirH(browser, nome, { prod: PROD, hall: SEM?.entradas })

  // ── faixa dos desafios na tela inicial ──
  if (tem('faixa')) {
    await ir(d, '#/', '.ld-modes', 60000)
    const faixa = await d.page.waitForSelector('.s4-faixa', { timeout: 12000 }).catch(() => null)
    nota(d, 'home', !!faixa, faixa ? 'faixa dos desafios de emblema apareceu na tela inicial' : 'a faixa dos desafios NÃO apareceu em 12 s')
    if (faixa) {
      await rolarAte(d, '.s4-faixa')
      await ver(d, 'home-faixa-desafios', { raiz: '.s4-faixa' })
      const info = await d.page.evaluate(() => {
        const nav = document.querySelector('.s4-faixa')
        const bs = [...nav.querySelectorAll('.s4-faixa__d')].map((b) => ({ fora: b.classList.contains('is-fora'), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height), n: b.getAttribute('title') }))
        return { curta: nav.classList.contains('is-curta'), bs, todos: Math.round(nav.querySelector('.s4-faixa__todos').getBoundingClientRect().height), larg: Math.round(nav.getBoundingClientRect().width), sw: nav.scrollWidth }
      })
      nota(d, 'home-faixa', info.sw <= info.larg + 1, `faixa: ${info.bs.filter((b) => !b.fora).length} emblemas à vista, ${info.bs.filter((b) => b.fora).length} escondidos · "Ver todos" ${info.todos}px de altura · "com emblema" ${info.curta ? 'escondido' : 'à vista'}`, info)
      const primeiro = d.page.locator('.s4-faixa__d:not(.is-fora)').first()
      const slug = await primeiro.evaluate((b) => b.getAttribute('title'))
      await tocar(d.page, primeiro, { espera: 1200 })
      const h1 = await hash(d)
      const alvoVisivel = await d.page.evaluate(() => {
        const m = /[?&]d=([^&]+)/.exec(location.hash)
        const el = m && document.getElementById(`d-${decodeURIComponent(m[1])}`)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), janela: innerHeight, visivel: r.top < innerHeight && r.bottom > 60 }
      })
      nota(d, 'faixa→desafios', /#\/desafios\?d=/.test(h1) && alvoVisivel?.visivel, `tocar no emblema "${slug}" leva a ${h1}; o cartão do desafio ${alvoVisivel ? (alvoVisivel.visivel ? `está à vista (top ${alvoVisivel.top})` : `fica FORA da tela (top ${alvoVisivel.top}, janela ${alvoVisivel.janela})`) : 'não existe na página'}`, { alvoVisivel })
      await ver(d, 'desafios-pelo-emblema')
      await d.page.goBack()
      await sleep(900)
      nota(d, 'voltar', (await hash(d)) === '#/' || (await hash(d)) === '', `voltar do Android em #/desafios?d=… → ${await hash(d)}`)
    }
  }

  // ── #/desafios ──
  if (tem('desafios')) {
    await ir(d, '#/desafios', '.sv-page:not([aria-busy="true"])')
    await ver(d, 'desafios-topo')
    await ver(d, 'desafios-inteira', { inteira: true, espera: 200 })
    const criar = d.page.getByRole('button', { name: 'Criar conta para ganhar' })
    if (!PROD && (await criar.count())) {
      await tocar(d.page, criar, { espera: 900 })
      const dl = await dialogo(d)
      nota(d, 'desafios→criar conta', !!dl, dl ? `"Criar conta para ganhar" abre "${dl.titulo}" (${dl.h}px de ${dl.janela})` : 'não abriu o diálogo')
      if (dl) {
        await ver(d, 'desafios-criar-conta', { raiz: '[role="dialog"]' })
        // o teclado: foco no 1º campo e a janela encolhe
        const campo = d.page.locator('[role="dialog"] input:not([type="checkbox"])').first()
        if (await campo.count()) {
          await tocar(d.page, campo, { espera: 300 })
          await teclado(d.page, a, true)
          await ver(d, 'desafios-criar-conta-teclado', { raiz: '[role="dialog"]' })
          // o último campo (senha) e o botão "Criar conta" com o teclado aberto
          const ultimo = d.page.locator('[role="dialog"] input:not([type="checkbox"])').last()
          await tocar(d.page, ultimo, { espera: 300 })
          await d.page.evaluate(() => document.activeElement?.scrollIntoView({ block: 'nearest' }))
          await ver(d, 'desafios-criar-conta-teclado-ultimo', { raiz: '[role="dialog"]' })
          await teclado(d.page, a, false)
        }
        await d.page.keyboard.press('Escape')
        await sleep(500)
      }
    }
    errosDe(d).forEach((e) => nota(d, 'desafios', false, `erro: ${e}`))
  }

  // ── #/hall: topo, inteira, categorias, segmentos ──
  if (tem('hall')) {
    await ir(d, '#/hall', '.hl-filtros')
    await d.page.waitForSelector('.hl-cstatus:not(:has(.is-busy))', { timeout: 15000 }).catch(() => {})
    await ver(d, 'hall-topo')
    await ver(d, 'hall-inteira', { inteira: true, espera: 200 })
    // ranking: a tabela no celular
    await rolarAte(d, '#hl-overall-h')
    await ver(d, 'hall-ranking')
    // abas das categorias (rolagem lateral dentro da faixa)
    await rolarAte(d, '#hl-cat-h')
    const cats = await d.page.evaluate(() => {
      const row = document.querySelector('.hl-cats')
      return row ? { w: Math.round(row.clientWidth), sw: row.scrollWidth, ox: getComputedStyle(row).overflowX } : null
    })
    nota(d, 'hall-categorias', true, `faixa das categorias ${cats?.w}px, conteúdo ${cats?.sw}px (overflow-x ${cats?.ox})`)
    const copa = d.page.locator('.hl-cat-tab', { hasText: 'Copas do Mundo' }).first()
    await tocar(d.page, copa, { espera: 700 })
    nota(d, 'hall-categorias', (await copa.getAttribute('aria-selected')) === 'true', 'tocar em "Copas do Mundo" troca a categoria')
    await ver(d, 'hall-categoria-copas')
    const ult = d.page.locator('.hl-cat-tab').last()
    await tocar(d.page, ult, { espera: 700 })
    await ver(d, 'hall-categoria-ultima')
    // segmentos do ranking
    for (const s of ['Lendas', 'Comunidade', 'Suas']) {
      const b = d.page.locator('.hl-panel__h [role="radiogroup"] [role="radio"], .hl-panel__h .lx-seg__item', { hasText: new RegExp(`^${s}`) }).first()
      if (!(await b.count())) {
        nota(d, 'hall-segmento', s === 'Suas' && !SEM, `segmento "${s}" não existe aqui`)
        continue
      }
      await rolarAte(d, '#hl-overall-h')
      await tocar(d.page, b, { espera: 900 })
      await ver(d, `hall-seg-${s.toLowerCase()}`)
    }
    // "Como a nota é calculada"
    await d.page.evaluate(() => scrollTo(0, 0))
    await tocar(d.page, d.page.getByRole('button', { name: 'Como a nota é calculada' }), { espera: 900 })
    const how = await dialogo(d)
    nota(d, 'hall-como', !!how && how.fechar?.visivel, how ? `"Como a nota é calculada": ${how.h}px de ${how.janela}, rola ${how.rola}, Fechar ${how.fechar?.w}×${how.fechar?.h} ${how.fechar?.visivel ? 'à vista' : 'FORA da tela'}` : 'não abriu')
    await ver(d, 'hall-como-nota', { raiz: '[role="dialog"]' })
    if (how) {
      const fim = await rolarDialogoAteOFim(d)
      nota(d, 'hall-como', fim?.fim, `o corpo rola até o fim: ${JSON.stringify(fim)}`)
      await print(d, 'hall-como-nota-fim')
      await tocar(d.page, d.page.locator('[role="dialog"] button[aria-label="Fechar"]'), { espera: 600 })
    }
    errosDe(d).forEach((e) => nota(d, 'hall', false, `erro: ${e}`))
  }

  // ── filtros de país e clube ──
  if (tem('filtros')) {
    await ir(d, '#/hall', '.hl-filtros')
    const sel = d.page.locator('.hl-fsel select')
    const fs = await sel.evaluate((el) => ({ fonte: parseFloat(getComputedStyle(el).fontSize), h: Math.round(el.getBoundingClientRect().height), n: el.options.length }))
    nota(d, 'filtro-país', fs.fonte >= 16, `<select> do país: fonte ${fs.fonte}px (o iPhone dá zoom abaixo de 16), altura ${fs.h}px, ${fs.n} opções`)
    await sel.selectOption('BRA')
    await sleep(900)
    nota(d, 'filtro-país', /pais=BRA/.test(await hash(d)), `escolher Brasil → ${await hash(d)}`)
    await ver(d, 'hall-filtro-brasil')
    // a busca de clube com o teclado aberto
    const busca = d.page.locator('.hl-fsearch input')
    await tocar(d.page, busca, { espera: 300 })
    await teclado(d.page, a, true)
    await d.page.keyboard.type('fla', { delay: 60 })
    await sleep(700)
    const lista = await d.page.evaluate(() => {
      const ul = document.querySelector('.hl-fsearch__list')
      if (!ul) return null
      const r = ul.getBoundingClientRect()
      const vv = window.visualViewport
      const h = vv ? vv.height : innerHeight
      const itens = [...ul.querySelectorAll('li[role="option"]')].map((li) => {
        const q = li.getBoundingClientRect()
        return { t: li.textContent.trim().slice(0, 30), top: Math.round(q.top), h: Math.round(q.height), visivel: q.top >= 0 && q.bottom <= h }
      })
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), janela: Math.round(h), itens, inteira: r.bottom <= h, campoTop: Math.round(document.querySelector('.hl-fsearch input').getBoundingClientRect().top) }
    })
    nota(d, 'filtro-clube-teclado', lista && lista.itens.length && lista.itens.filter((i) => i.visivel).length >= Math.min(3, lista.itens.length), lista ? `com o teclado aberto (janela ${lista.janela}px): campo em y=${lista.campoTop}, lista de ${lista.top} a ${lista.bottom} · ${lista.itens.filter((i) => i.visivel).length} de ${lista.itens.length} opções à vista · altura de cada opção ${[...new Set(lista.itens.map((i) => i.h))].join('/')}px` : 'a lista não abriu', { lista })
    await ver(d, 'hall-filtro-clube-teclado')
    // tocar numa opção (o dedo, não o mouse)
    const op = d.page.locator('.hl-fsearch__list li[role="option"]').first()
    if (await op.count()) {
      const nomeOp = (await op.innerText()).split('\n')[0]
      await op.tap()
      await sleep(900)
      const chip = await d.page.locator('.hl-fchip b').count()
      nota(d, 'filtro-clube-toque', chip > 0, `tocar em "${nomeOp}" ${chip ? 'escolhe o clube (chip)' : 'NÃO escolheu o clube'} → ${await hash(d)}`)
    }
    await teclado(d.page, a, false)
    await d.page.evaluate(() => document.activeElement?.blur())
    await sleep(400)
    await ver(d, 'hall-filtro-clube-escolhido')
    // o X do chip e "Limpar filtros"
    const x = d.page.locator('.hl-fchip button')
    if (await x.count()) {
      const bx = await x.boundingBox()
      nota(d, 'filtro-chip-x', bx && bx.width >= 40 && bx.height >= 40, `o X do chip do clube tem ${Math.round(bx?.width)}×${Math.round(bx?.height)}px`)
    }
    const limpar = d.page.locator('.hl-filtros__limpar')
    if (await limpar.count()) {
      const bl = await limpar.boundingBox()
      nota(d, 'filtro-limpar', bl && bl.height >= 40, `"Limpar filtros" tem ${Math.round(bl?.width)}×${Math.round(bl?.height)}px`)
      await tocar(d.page, limpar, { espera: 700 })
      nota(d, 'filtro-limpar', !/pais=|clube=/.test(await hash(d)), `"Limpar filtros" → ${await hash(d)}`)
    }
    // um filtro sem ninguém (clube pequeno): a mensagem cabe?
    await ir(d, '#/hall?pais=ISL', '.hl-filtros')
    await ver(d, 'hall-filtro-sem-ninguem')
    errosDe(d).forEach((e) => nota(d, 'filtros', false, `erro: ${e}`))
  }

  // ── ficha de uma lenda (diálogo/sheet) ──
  if (tem('ficha')) {
    await ir(d, '#/', '.ld-modes', 60000)
    await ir(d, '#/hall', '.hl-filtros')
    await rolarAte(d, '#hl-overall-h')
    const linha = d.page.locator('.hl-row.is-legend').first()
    const quem = (await linha.innerText()).split('\n').slice(0, 2).join(' ')
    await tocar(d.page, linha, { espera: 1200 })
    const dl = await dialogo(d)
    nota(d, 'ficha-lenda', !!dl && dl.fechar?.visivel && dl.top >= 0, dl ? `ficha de "${dl.titulo}" (${quem}): ${dl.top}→${dl.bottom} de ${dl.janela}px, corpo ${dl.bodyH?.join('/')} rola ${dl.rola}, Fechar ${dl.fechar?.w}×${dl.fechar?.h}` : 'não abriu', { dl })
    await ver(d, 'ficha-lenda', { raiz: '[role="dialog"]' })
    // abas da ficha
    const abas = d.page.locator('[role="dialog"] [role="tab"]')
    const nAbas = await abas.count()
    for (let i = 1; i < nAbas; i++) {
      await tocar(d.page, abas.nth(i), { espera: 600 })
      await ver(d, `ficha-lenda-aba${i + 1}`, { raiz: '[role="dialog"]' })
    }
    const fim = await rolarDialogoAteOFim(d)
    nota(d, 'ficha-lenda', fim?.fim, `o corpo da ficha rola até o fim: ${JSON.stringify(fim)}`)
    await print(d, 'ficha-lenda-fim')
    // voltar do Android com a ficha aberta
    if (tem('voltar')) {
      const antes = await hash(d)
      await d.page.goBack()
      await sleep(1200)
      const depois = await hash(d)
      const aberto = await temDialogo(d)
      nota(d, 'voltar-ficha', depois === antes && !aberto, `voltar do Android com a ficha aberta (em ${antes}): foi para ${depois || '(vazio)'} e o diálogo ${aberto ? 'continua aberto' : 'fechou'}`)
      await print(d, 'ficha-lenda-depois-do-voltar')
      if (depois !== antes) await ir(d, '#/hall', '.hl-filtros')
    }
    if (await temDialogo(d)) await d.page.keyboard.press('Escape')
    // ficha pelo pódio da categoria
    await rolarAte(d, '.hl-podium')
    await tocar(d.page, d.page.locator('.hl-step').first(), { espera: 1000 })
    await ver(d, 'ficha-pelo-podio', { raiz: '[role="dialog"]' })
    if (await temDialogo(d)) await d.page.keyboard.press('Escape')
    errosDe(d).forEach((e) => nota(d, 'ficha', false, `erro: ${e}`))
  }

  // ── comunidade: linha → resumo → voltar (posição); apelido → perfil ──
  if (tem('comunidade')) {
    await ir(d, '#/', '.ld-modes', 60000)
    await ir(d, '#/hall?seg=comunidade', '.hl-filtros')
    const row = await d.page.waitForSelector('.hl-row.is-com', { timeout: 15000 }).catch(() => null)
    nota(d, 'comunidade', !!row, row ? 'linhas da comunidade carregaram' : 'NENHUMA linha da comunidade em 15 s')
    if (row) {
      await rolarAte(d, '.hl-row.is-com:last-of-type')
      await ver(d, 'hall-comunidade-linhas')
      const dono = d.page.locator('.hl-com__dono.is-link').first()
      if (await dono.count()) {
        const bd = await dono.boundingBox()
        nota(d, 'comunidade-apelido', bd.height >= 40, `o apelido (leva ao perfil) é um alvo de ${Math.round(bd.width)}×${Math.round(bd.height)}px dentro da linha (o resto da linha abre o resumo)`)
      }
      // o dedo no MEIO de cada linha da comunidade: o que está embaixo dele (o resumo, ou o apelido que leva ao perfil)?
      const meio = await d.page.evaluate(() =>
        [...document.querySelectorAll('.hl-row.is-com')].map((row) => {
          const r = row.getBoundingClientRect()
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return { quem: row.querySelector('.hl-row__name b')?.firstChild?.textContent?.trim(), apelido: !!el?.closest('.hl-com__dono.is-link'), em: el?.className?.toString().slice(0, 40) ?? el?.tagName }
        }),
      )
      const roubam = meio.filter((m) => m.apelido)
      nota(d, 'comunidade-meio-da-linha', !roubam.length, `tocar no meio da linha: ${meio.map((m) => `${m.quem} → ${m.apelido ? 'PERFIL (o apelido ocupa o meio da linha)' : 'resumo'}`).join(' · ')}`, { meio })
      if (roubam.length) {
        await rolarAte(d, '.hl-row.is-com:last-of-type')
        const row = d.page.locator('.hl-row.is-com').filter({ hasText: roubam[0].quem }).first()
        const b = await row.boundingBox()
        await d.page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
        await sleep(1500)
        nota(d, 'comunidade-meio-da-linha', !/#\/jogador/.test(await hash(d)), `dedo no meio da linha de ${roubam[0].quem} → ${await hash(d)}`)
        await print(d, 'toque-no-meio-da-linha-abre-perfil')
        await d.page.goBack()
        await sleep(1500)
      }
      await rolarAte(d, '.hl-row.is-com:last-of-type')
      const yAntes = await d.page.evaluate(() => Math.round(scrollY))
      // o resumo pelo número da posição (canto esquerdo da linha: não pega o apelido)
      await tocar(d.page, d.page.locator('.hl-row.is-com .hl-row__pos').last(), { espera: 400 })
      await d.page.waitForFunction(() => location.hash.startsWith('#/resumo'), null, { timeout: 15000 }).catch(() => {})
      nota(d, 'comunidade→resumo', /#\/resumo/.test(await hash(d)), `tocar na linha (pela posição) → ${await hash(d)}`)
      await sleep(2500)
      await ver(d, 'resumo-comunidade')
      await ver(d, 'resumo-comunidade-inteira', { inteira: true, espera: 200 })
      await d.page.goBack()
      await sleep(1800)
      const yDepois = await d.page.evaluate(() => Math.round(scrollY))
      nota(d, 'voltar-resumo', /#\/hall/.test(await hash(d)) && Math.abs(yDepois - yAntes) < 200, `Hall → resumo de uma carreira da comunidade → voltar: ${await hash(d)}, rolagem ${yAntes} → ${yDepois} (a pessoa ${Math.abs(yDepois - yAntes) < 200 ? 'continua onde estava' : 'volta para o topo e perde o lugar na lista'})`)
      await print(d, 'hall-depois-de-voltar-do-resumo')
      // o apelido → perfil
      const dono2 = d.page.locator('.hl-com__dono.is-link').first()
      if (await dono2.count()) {
        await tocar(d.page, dono2, { espera: 400 })
        await d.page.waitForFunction(() => location.hash.startsWith('#/jogador') || location.hash.startsWith('#/resumo'), null, { timeout: 10000 }).catch(() => {})
        nota(d, 'comunidade-apelido', /#\/jogador\//.test(await hash(d)), `tocar no apelido → ${await hash(d)}`)
        await sleep(1500)
        await ver(d, 'perfil-pelo-apelido')
      }
    }
    errosDe(d).forEach((e) => nota(d, 'comunidade', false, `erro: ${e}`))
  }

  // ── suas carreiras (Hall do aparelho, semeado) ──
  if (tem('suas') && SEM) {
    await ir(d, '#/hall', '.hl-filtros')
    await ver(d, 'hall-com-suas-carreiras-topo')
    const card = d.page.locator('.hl-rcard').first()
    if (await card.count()) {
      await rolarAte(d, '.hl-rgrid')
      await ver(d, 'hall-suas-carreiras-cards')
      await tocar(d.page, card.getByRole('button', { name: 'Detalhes' }), { espera: 1200 })
      const dl = await dialogo(d)
      nota(d, 'ficha-carreira', !!dl && dl.fechar?.visivel, dl ? `detalhe da sua carreira "${dl.titulo}": ${dl.top}→${dl.bottom} de ${dl.janela}px, rola ${dl.rola}` : 'não abriu', { dl })
      await ver(d, 'ficha-sua-carreira', { raiz: '[role="dialog"]' })
      const fim = await rolarDialogoAteOFim(d)
      await ver(d, 'ficha-sua-carreira-fim', { raiz: '[role="dialog"]' })
      nota(d, 'ficha-carreira', fim?.fim, `o corpo rola até o fim: ${JSON.stringify(fim)}`)
      await d.page.keyboard.press('Escape')
      await sleep(500)
    } else nota(d, 'suas', false, 'o Hall não mostrou as carreiras semeadas no aparelho')
    // ?run= (link do Resumo) abre o detalhe direto; voltar fecha?
    const id = SEM.entradas[0].id
    await ir(d, `#/hall?run=${id}`, '.hl-filtros')
    await sleep(900)
    nota(d, 'hall-run-link', (await temDialogo(d)) > 0, `#/hall?run=${id} abre o detalhe da carreira direto`)
    errosDe(d).forEach((e) => nota(d, 'suas', false, `erro: ${e}`))
  }

  // ── conquistas (as 87) ──
  if (tem('conquistas')) {
    await ir(d, '#/', '.ld-modes', 60000)
    await tocar(d.page, d.page.locator('.ld-medal, button[aria-label^="Ver conquistas"]').first(), { espera: 1400 })
    let dl = await dialogo(d)
    nota(d, 'conquistas', !!dl, dl ? `diálogo de conquistas "${dl.titulo}": ${dl.top}→${dl.bottom} de ${dl.janela}px, corpo ${dl.bodyH?.join('/')}, Fechar ${dl.fechar?.w}×${dl.fechar?.h} ${dl.fechar?.visivel ? 'à vista' : 'FORA'}` : 'o botão de conquistas não abriu o diálogo', { dl })
    if (dl) {
      const n = await d.page.locator('[role="dialog"] .ac-item').count()
      nota(d, 'conquistas', n === 87, `${n} conquistas na lista`)
      await ver(d, 'conquistas-lista', { raiz: '[role="dialog"]' })
      // a barra de filtros cabe numa linha? os botões de ordenar/visualização
      const tb = await d.page.evaluate(() => {
        const t = document.querySelector('.ac-toolbar')
        const r = t.getBoundingClientRect()
        const bs = [...t.querySelectorAll('button')].map((b) => {
          const q = b.getBoundingClientRect()
          return `${(b.getAttribute('aria-label') || b.textContent).trim().slice(0, 22)} ${Math.round(q.width)}×${Math.round(q.height)}`
        })
        return { h: Math.round(r.height), bs }
      })
      nota(d, 'conquistas-barra', true, `barra de filtro/ordem: ${tb.h}px de altura · ${tb.bs.join(' · ')}`)
      await rolarDialogoAteOFim(d)
      await ver(d, 'conquistas-lista-fim', { raiz: '[role="dialog"]' })
      // grade
      await tocar(d.page, d.page.locator('[role="dialog"] button[aria-label="Visualização em grade"]'), { espera: 900 })
      await d.page.evaluate(() => {
        const b = [...document.querySelectorAll('[role="dialog"] .lx-dialog__body')].pop()
        if (b) b.scrollTop = 0
      })
      await ver(d, 'conquistas-grade', { raiz: '[role="dialog"]' })
      const cel = d.page.locator('[role="dialog"] .ac-cell').nth(5)
      await cel.tap()
      await sleep(700)
      const tip = await d.page.evaluate(() => {
        const t = document.querySelector('.lx-tip')
        if (!t) return null
        const r = t.getBoundingClientRect()
        return { texto: t.textContent.trim().slice(0, 80), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), w: innerWidth }
      })
      nota(d, 'conquistas-grade-toque', !!tip && tip.left >= 0 && tip.right <= tip.w, tip ? `tocar num quadrado da grade mostra "${tip.texto}" (${tip.left}→${tip.right} de ${tip.w})` : 'tocar num quadrado da grade NÃO mostra o nome da conquista')
      await print(d, 'conquistas-grade-toque')
      // volta para a lista (preferência fica salva)
      await tocar(d.page, d.page.locator('[role="dialog"] button[aria-label="Visualização em lista"]'), { espera: 500 })
      // voltar do Android com o diálogo aberto
      if (tem('voltar')) {
        const antes = await hash(d)
        await d.page.goBack()
        await sleep(1200)
        const depois = await hash(d)
        nota(d, 'voltar-conquistas', depois === antes && !(await temDialogo(d)), `voltar do Android com as conquistas abertas (em ${antes || '#/'}): foi para ${depois || '(a página de antes / fora do jogo)'}; diálogo ${(await temDialogo(d)) ? 'aberto' : 'fechado'}`)
        await print(d, 'conquistas-depois-do-voltar')
      }
    }
    // pelo menu
    await ir(d, '#/hall', '.hl-filtros')
    await tocar(d.page, d.page.locator('button[aria-label="Menu"]').first(), { espera: 900 })
    await ver(d, 'menu-no-hall', { raiz: '[role="dialog"]' })
    const lin = d.page.locator('[role="dialog"]').getByText('Conquistas', { exact: true }).first()
    if (await lin.count()) {
      await tocar(d.page, lin, { espera: 1200 })
      dl = await dialogo(d)
      nota(d, 'conquistas-menu', !!dl && /onquista/.test(dl.titulo ?? ''), `Menu → Conquistas abre "${dl?.titulo}"`)
      if (await temDialogo(d)) await d.page.keyboard.press('Escape')
    }
    errosDe(d).forEach((e) => nota(d, 'conquistas', false, `erro: ${e}`))
  }

  // ── Ligas ao vivo ──
  if (tem('ligas')) {
    await ir(d, '#/ligas', '.lv-wrap')
    await d.page.waitForSelector('.lv-wrap:not([aria-busy="true"])', { timeout: 30000 }).catch(() => {})
    await sleep(2500)
    await ver(d, 'ligas-topo')
    await ver(d, 'ligas-inteira', { inteira: true, espera: 200 })
    const abas = d.page.locator('.lv-wrap [role="tab"]')
    const n = await abas.count()
    if (n > 1) {
      await tocar(d.page, abas.nth(Math.min(3, n - 1)), { espera: 2500 })
      await ver(d, 'ligas-outra-liga')
    }
    errosDe(d).forEach((e) => nota(d, 'ligas', false, `erro: ${e}`))
  }

  // ── Créditos ──
  if (tem('creditos')) {
    await ir(d, '#/creditos', '.cr-wrap')
    await ver(d, 'creditos-topo')
    await ver(d, 'creditos-inteira', { inteira: true, espera: 200 })
    errosDe(d).forEach((e) => nota(d, 'creditos', false, `erro: ${e}`))
  }

  // ── perfil público ──
  if (tem('perfil')) {
    const cod = PROD ? arg('perfil', null) : SEM?.codigo
    if (cod) {
      await ir(d, `?c=${cod}#/jogador/${cod}`, 'main#conteudo:not([aria-busy="true"])')
      await ver(d, 'perfil-publico-topo')
      await ver(d, 'perfil-publico-inteira', { inteira: true, espera: 200 })
    }
    await ir(d, '#/jogador/ZZZZ9999', 'main#conteudo:not([aria-busy="true"])')
    await d.page.getByText(/Perfil não encontrado|não existe/).first().waitFor({ timeout: 15000 }).catch(() => {})
    await ver(d, 'perfil-que-nao-existe')
    errosDe(d).forEach((e) => nota(d, 'perfil', /404/.test(e), `console/rede: ${e}`))
  }

  // ── privacidade ──
  if (tem('privacidade')) {
    await d.page.goto(`${URL0}privacidade.html`, { waitUntil: 'load' })
    await sleep(600)
    const info = await d.page.evaluate(() => ({ vp: document.querySelector('meta[name=viewport]')?.content ?? null, fonte: parseFloat(getComputedStyle(document.body).fontSize), lateral: document.documentElement.scrollWidth - innerWidth, titulo: document.title }))
    nota(d, 'privacidade', info.vp && info.lateral <= 0 && info.fonte >= 14, `privacidade.html: viewport "${info.vp}", fonte do texto ${info.fonte}px, rolagem lateral ${info.lateral}px`)
    await ver(d, 'privacidade-topo')
    await ver(d, 'privacidade-inteira', { inteira: true, espera: 200 })
    // o link "voltar ao jogo"
    const volta = d.page.locator('a[href*="lenda"], a[href="./"], a[href="./#/"]').first()
    nota(d, 'privacidade', (await volta.count()) > 0, (await volta.count()) ? `link de volta ao jogo: ${await volta.getAttribute('href')}` : 'sem link de volta ao jogo (só o voltar do navegador)')
  }

  // ── girar com a ficha aberta ──
  if (tem('girar') && a.w < a.h) {
    await ir(d, '#/hall', '.hl-filtros')
    await rolarAte(d, '#hl-overall-h')
    await tocar(d.page, d.page.locator('.hl-row.is-legend').first(), { espera: 1200 })
    const desvirar = await girar(d.page, a)
    const dl = await dialogo(d)
    nota(d, 'girar', !!dl && dl.fechar?.visivel, dl ? `deitado com a ficha aberta: ${dl.top}→${dl.bottom} de ${dl.janela}px, Fechar ${dl.fechar?.visivel ? 'à vista' : 'FORA da tela'}, corpo ${dl.bodyH?.join('/')}` : 'a ficha fechou ao girar')
    await ver(d, 'girado-ficha-lenda', { raiz: '[role="dialog"]' })
    if (await temDialogo(d)) await d.page.keyboard.press('Escape')
    await sleep(400)
    await ver(d, 'girado-hall')
    await desvirar()
    await ver(d, 'desvirado-hall')
  }

  // ── recarregar no meio (filtro e segmento na URL) ──
  if (tem('recarregar')) {
    await ir(d, '#/hall?pais=ARG&seg=lendas', '.hl-filtros')
    await d.page.reload({ waitUntil: 'domcontentloaded' })
    await esperarTela(d.page, '.hl-filtros')
    const v = await d.page.evaluate(() => ({ h: location.hash, pais: document.querySelector('.hl-fsel select')?.value, seg: document.querySelector('.hl-panel__h [aria-checked="true"], .hl-panel__h [aria-pressed="true"]')?.textContent?.trim() }))
    nota(d, 'recarregar', v.pais === 'ARG' && /Lendas/.test(v.seg ?? ''), `recarregar em #/hall?pais=ARG&seg=lendas: país ${v.pais}, segmento "${v.seg}"`)
  }

  // ── rede: o Hall da comunidade sem servidor e sem internet ──
  if (tem('rede')) {
    await d.ctx.route('**/api/hall.php**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"erro":"indisponivel"}' }))
    await ir(d, '#/hall?seg=comunidade', '.hl-filtros')
    // o jogo tenta 3 vezes (~4 s) antes de dizer que não carregou
    const textos = async (re, ms = 12000) => {
      const t0 = Date.now()
      let m = []
      while (Date.now() - t0 < ms) {
        m = await d.page.locator('.hl-cstatus, .hl-cempty').allInnerTexts().catch(() => [])
        if (m.some((x) => re.test(x))) break
        await sleep(500)
      }
      return m
    }
    const msg = await textos(/não carregou|não respondeu|Tentar/i)
    nota(d, 'rede-503', msg.some((m) => /não carregou|não respondeu|Tentar/i.test(m)), `hall.php com 503: "${msg.join(' | ').replace(/\s+/g, ' ').slice(0, 160)}"`)
    await ver(d, 'hall-comunidade-servidor-fora')
    await d.ctx.unroute('**/api/hall.php**')
    await offline(d.cdp, true)
    await ir(d, '#/hall?seg=comunidade&pais=URU', '.hl-filtros').catch(() => {})
    const msg2 = await textos(/internet|conex/i)
    nota(d, 'rede-offline', msg2.some((m) => /internet|conex/i.test(m)), `sem internet: "${msg2.join(' | ').replace(/\s+/g, ' ').slice(0, 160)}"`)
    await ver(d, 'hall-comunidade-sem-internet')
    // desafios sem internet
    await d.page.evaluate(() => (location.hash = '#/desafios'))
    await sleep(3000)
    await ver(d, 'desafios-sem-internet')
    await offline(d.cdp, false)
    const ret = d.page.getByRole('button', { name: /Tentar de novo/ }).first()
    if (await ret.count()) {
      await tocar(d.page, ret, { espera: 2500 })
      await ver(d, 'desafios-depois-de-tentar-de-novo')
    }
    errosDe(d)
  }

  // ── com a conta aberta (a conta semeada com 4 emblemas): faixa, #/desafios, conquistas na conta ──
  if (tem('logado') && SEM && !PROD) {
    const c0 = SEM.contas[0]
    await ir(d, '#/', '.ld-modes', 60000)
    const st = await d.page.evaluate(async ({ email, senha }) => (await fetch('api/conta.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ acao: 'entrar', email, senha }) })).status, c0)
    nota(d, 'logado', st === 200, `entrar na conta ${c0.apelido}: ${st}`)
    // recarrega (o goto só com o # mudando não recarrega a página: o jogo não saberia da sessão nova)
    await d.page.reload({ waitUntil: 'domcontentloaded' })
    await esperarTela(d.page, '.ld-modes', 60000)
    await d.page.waitForSelector('.s4-faixa', { timeout: 12000 }).catch(() => {})
    await rolarAte(d, '.s4-faixa')
    await ver(d, 'logado-home-faixa', { raiz: '.s4-faixa' })
    await ir(d, '#/desafios', '.s4-emb')
    await sleep(1200)
    await ver(d, 'logado-desafios-topo')
    await ver(d, 'logado-desafios-inteira', { inteira: true, espera: 200 })
    await ir(d, '#/', '.ld-modes', 60000)
    await tocar(d.page, d.page.locator('.ld-medal, button[aria-label^="Ver conquistas"]').first(), { espera: 1800 })
    await ver(d, 'logado-conquistas', { raiz: '[role="dialog"]' })
    const q = d.page.locator('[role="dialog"] .ac-prova__q')
    if (await q.count()) {
      // a área do toque conta a parte invisível do ::before (inset negativo), como nas outras medidas da suíte
      const b = await q.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const s = getComputedStyle(el, '::before')
        const n = (v) => (String(v).endsWith('px') ? parseFloat(v) : 0)
        const extra = s && s.content !== 'none' && s.position === 'absolute' ? { x: -n(s.left) - n(s.right), y: -n(s.top) - n(s.bottom) } : { x: 0, y: 0 }
        return { width: r.width + Math.max(0, extra.x), height: r.height + Math.max(0, extra.y) }
      })
      await q.tap()
      await sleep(700)
      const tip = await d.page.evaluate(() => document.querySelector('.lx-tip')?.textContent?.trim().slice(0, 60) ?? null)
      nota(d, 'logado-conquistas-prova', b.width >= 40 && !!tip, `o "?" de "o que é conquista provada" tem ${Math.round(b.width)}×${Math.round(b.height)}px; tocar ${tip ? `mostra "${tip}…"` : 'NÃO mostra a explicação'}`)
      await print(d, 'logado-conquistas-o-que-e-provada')
    }
    await d.page.keyboard.press('Escape')
    await d.page.evaluate(async () => fetch('api/conta.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ acao: 'sair' }) }))
    errosDe(d).forEach((e) => nota(d, 'logado', false, `erro: ${e}`))
  }

  if (d.bloqueados.length) console.log(`  ..  ${d.bloqueados.length} pedidos de escrita/medição bloqueados (produção): ${[...new Set(d.bloqueados)].slice(0, 4).join(', ')}`)
  await d.ctx.close()
}

salvarRelatorio(`relatorio-${ALVO}-${NOMES.length === 1 ? NOMES[0] : 'todos'}`)
const ruins = achados.filter((x) => x.achados.length)
console.log(`\n${achados.length} telas medidas · ${ruins.length} com achado · ${notas.filter((n) => !n.ok).length} observações ruins`)
await browser.close()
fimHall({ telas: true })
