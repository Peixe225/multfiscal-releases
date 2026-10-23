#!/usr/bin/env node
// LENDA v3.5 · suíte mobile · TOQUE E LEGIBILIDADE EM TODAS AS ROTAS.
//
//   pilha local (subida com servidor/teste/integracao/subir.sh e semeada com hall-semear.mjs):
//     LENDA_INTEG_BASE=/tmp/lenda-v35-toque node servidor/teste/mobile/toque-rotas.mjs
//   produção, só leitura (sem conta, sem carreira, sem POST, sem medição de visita):
//     node servidor/teste/mobile/toque-rotas.mjs --alvo prod --larguras 320,360
//
// Opções: --larguras 320,360,390,412 (padrão as quatro) · --etapas home,menu,… (padrão todas; ver ETAPAS abaixo)
//         --foco 390 (larguras com o teste de foco visível pelo Tab; "todas" ou "nenhuma") · --movimento (passa extra em
//         390 com prefers-reduced-motion: reduce, comparando as animações de cada tela) · --fim (joga a carreira até o
//         card de fim e mede o card) · --saida <arquivo.json>
// Para cada largura abre o aparelho dessa largura (carreira-lib: 320 = pequeno-320, 360 = galaxy-a, 390 = iphone-14,
// 412 = pixel-7), passa pelas rotas e diálogos e chama auditar() (toque-lib.mjs) em cada um. No fim grava o relatório
// JSON (todas as medidas) e o toque-piores.md (os piores casos, agrupados por seletor, com o print).
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { auditar, focoVisivel, movimento, abrirT, lancarT, dialogoAberto, assentar, sleep, LARGURAS, PRINTS } from './toque-lib.mjs'
import { piores } from './toque-relatorio.mjs'
import { abrirEsperando } from './aparelhos.mjs'

const arg = (k, dflt) => {
  const i = process.argv.indexOf(`--${k}`)
  if (i < 0) return dflt
  const v = process.argv[i + 1]
  return !v || v.startsWith('--') ? true : v
}
const ALVO = arg('alvo', 'local')
const PROD = ALVO === 'prod'
const BASE = process.env.LENDA_INTEG_BASE ?? '/tmp/lenda-v35-toque'
const ENV = !PROD && existsSync(`${BASE}/segredos.env`) ? Object.fromEntries(readFileSync(`${BASE}/segredos.env`, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const URL0 = PROD ? 'https://oprojeto.online/lenda/' : (process.env.LENDA_URL ?? `http://127.0.0.1:${ENV.PORTA ?? 9150}/lenda/`).replace(/\/?$/, '/')
const SEM = !PROD && existsSync(`${BASE}/hall-semente.json`) ? JSON.parse(readFileSync(`${BASE}/hall-semente.json`, 'utf8')) : null
const LARG = String(arg('larguras', '320,360,390,412')).split(',').map(Number)
const FOCO = String(arg('foco', '390'))
const focoEm = (w) => FOCO === 'todas' || (FOCO !== 'nenhuma' && FOCO.split(',').map(Number).includes(w))
const MOV = !!arg('movimento', false)
const FIM = !!arg('fim', false)
const SAIDA = arg('saida', `${PRINTS}/toque-${PROD ? 'prod' : 'local'}.json`)
const ETAPAS_LOCAL = ['home', 'menu', 'conquistas', 'entrar', 'fale', 'hall', 'desafios', 'ligas', 'creditos', 'jogador', 'resumo', 'identidade', 'carreira', 'conta']
const ETAPAS_PROD = ['home', 'menu', 'conquistas', 'entrar', 'fale', 'hall', 'desafios', 'ligas', 'creditos', 'jogador']
const ET = arg('etapas', null)
const ETAPAS = ET ? String(ET).split(',') : PROD ? ETAPAS_PROD : ETAPAS_LOCAL
const tem = (e) => ETAPAS.includes(e)
if (PROD) for (const e of ETAPAS) if (!ETAPAS_PROD.includes(e)) throw new Error(`etapa "${e}" escreve no servidor ou cria carreira: não roda na produção`)

const sql = (q) => execFileSync('mariadb', [`--socket=${ENV.SOCK || '/run/mysqld/mysqld.sock'}`, '-uroot', '-N', '-B', ENV.BANCO || 'lenda_v35_toque', '-e', q], { encoding: 'utf8' }).trim()

const RELATORIO = { alvo: ALVO, url: URL0, quando: new Date().toISOString(), larguras: LARG, telas: [], foco: [], movimento: [], falhas: [] }

/** Um aparelho: navega e mede. */
async function rodarLargura(browser, w, o = {}) {
  const nome = LARGURAS[w]
  const d = await abrirT(browser, nome, { hall: SEM?.entradas, prod: PROD, reduzir: o.reduzir })
  const { page } = d
  const rot = o.reduzir ? `${w}-reduzir` : String(w)
  console.log(`\n── ${w}px · ${nome}${o.reduzir ? ' · prefers-reduced-motion: reduce' : ''} ──`)
  const so = o.soMovimento
  const tocar = async (loc, espera = 500) => {
    const l = typeof loc === 'string' ? page.locator(loc).first() : loc
    await l.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {})
    await l.tap({ timeout: 10000 })
    await sleep(espera)
  }
  const ir = async (hash, esperar, ms = 60000) => {
    await page.evaluate((h) => (location.hash = h), hash).catch(() => {})
    if (esperar) await page.locator(esperar).first().waitFor({ state: 'visible', timeout: ms })
    await sleep(700)
  }
  const fecharDialogos = async () => {
    for (let i = 0; i < 3; i++) {
      const n = await page.locator('[role="dialog"]:visible').count()
      if (!n) return
      await page.keyboard.press('Escape')
      await sleep(500)
    }
  }
  /** mede a tela (ou o diálogo aberto, com o.dialogo) e, nesta largura, o foco. */
  async function medir(tela, o2 = {}) {
    try {
      const raiz = o2.dialogo ? await dialogoAberto(page) : null
      if (o2.dialogo && !raiz) throw new Error('o diálogo não abriu')
      if (so) {
        await assentar(page)
        const mv = await movimento(d, { espera: 800 })
        const f = `${PRINTS}/${nome}-reduzir_${tela}.png`
        await page.screenshot({ path: f }).catch(() => {})
        RELATORIO.movimento.push({ largura: rot, tela, ...mv, print: f })
        console.log(`  ..  ${tela}: data-motion=${mv.dataMotion} · ${mv.rodando} animações rodando (${mv.infinitas} infinitas) · rAF ${mv.rafPorSegundo}/s`)
        return
      }
      const r = await auditar(d, tela, { raiz, maxPassos: o2.maxPassos })
      r.largura = w
      r.dialogo = !!raiz
      RELATORIO.telas.push(r)
      if (focoEm(w) && !o2.semFoco) {
        const f = await focoVisivel(d, tela, { raiz, max: o2.focoMax ?? 30 })
        f.largura = w
        RELATORIO.foco.push(f)
        // o Tab pode ter rolado a página e mexido no foco: volta ao topo e tira o foco
        await page.evaluate(() => {
          document.activeElement?.blur?.()
          scrollTo({ top: 0, behavior: 'instant' })
        })
      }
      if (MOV && w === 390 && !o.reduzir) RELATORIO.movimento.push({ largura: rot, tela, ...r.animacoes })
    } catch (e) {
      const f = `${PRINTS}/${nome}_${tela}_FALHOU.png`
      await page.screenshot({ path: f }).catch(() => {})
      RELATORIO.falhas.push({ largura: w, tela, erro: String(e.message).split('\n')[0], print: f })
      console.log(`  XX  ${nome} · ${tela}: ${String(e.message).split('\n')[0]}`)
    }
  }
  const etapa = async (nomeEtapa, fn) => {
    if (!tem(nomeEtapa)) return
    try {
      await fn()
    } catch (e) {
      const f = `${PRINTS}/${nome}_etapa-${nomeEtapa}_FALHOU.png`
      await page.screenshot({ path: f }).catch(() => {})
      RELATORIO.falhas.push({ largura: w, tela: `etapa ${nomeEtapa}`, erro: String(e.message).split('\n')[0], print: f })
      console.log(`  XX  ${nome} · etapa ${nomeEtapa}: ${String(e.message).split('\n')[0]}`)
      await fecharDialogos().catch(() => {})
    }
  }
  const abrirMenu = async () => {
    await fecharDialogos()
    await tocar(page.locator('button[aria-label="Menu"]').first(), 900)
    await page.locator('[role="dialog"]').first().waitFor({ state: 'visible', timeout: 10000 })
  }
  const linhaMenu = (re) => page.locator('[role="dialog"] button, [role="dialog"] a').filter({ hasText: re }).first()

  await abrirEsperando(page, URL0, '.ld-ctas__start', { prod: PROD })
  await sleep(1500)

  await etapa('home', async () => {
    await medir('01-home')
  })
  await etapa('menu', async () => {
    await abrirMenu()
    await medir('02-menu-sem-conta', { dialogo: true })
    await fecharDialogos()
  })
  await etapa('conquistas', async () => {
    await ir('#/', '.ld-ctas__start')
    await tocar(page.locator('.ld-medal, button[aria-label^="Ver conquistas"]').first(), 1400)
    await medir('03-conquistas', { dialogo: true })
    // a outra visualização (grade × lista)
    const grade = page.locator('[role="dialog"] button[aria-label="Visualização em grade"]')
    if (await grade.count()) {
      await tocar(grade, 900)
      await medir('03b-conquistas-grade', { dialogo: true, semFoco: true })
    }
    await fecharDialogos()
  })
  await etapa('entrar', async () => {
    await abrirMenu()
    await tocar(linhaMenu(/Entrar/), 1300)
    await medir('04-entrar', { dialogo: true })
    // a outra aba (Criar conta / Entrar)
    const aba = page.locator('[role="dialog"] [role="tab"]:not([aria-selected="true"])').first()
    if (await aba.count()) {
      await tocar(aba, 800)
      await medir('04b-entrar-outra-aba', { dialogo: true })
    }
    await fecharDialogos()
  })
  await etapa('fale', async () => {
    await abrirMenu()
    await tocar(linhaMenu(/Fale conosco/), 1300)
    await medir('05-fale-conosco', { dialogo: true })
    await fecharDialogos()
  })
  await etapa('hall', async () => {
    await ir('#/hall', '.hl-filtros')
    await sleep(1500)
    await medir('06-hall', { maxPassos: 18 })
    await tocar(page.getByRole('button', { name: 'Como a nota é calculada' }).first(), 1000)
    await medir('06b-hall-como-a-nota', { dialogo: true })
    await fecharDialogos()
    const lenda = page.locator('.hl-row.is-legend').first()
    if (await lenda.count()) {
      await tocar(lenda, 1300)
      await medir('06c-hall-ficha-lenda', { dialogo: true })
      await fecharDialogos()
    }
    const card = page.locator('.hl-rcard').first()
    if (await card.count()) {
      await tocar(card.getByRole('button', { name: 'Detalhes' }), 1300)
      await medir('06d-hall-sua-carreira', { dialogo: true })
      await fecharDialogos()
    }
    await ir('#/hall?seg=comunidade', '.hl-filtros')
    await page.locator('.hl-row.is-com').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
    const com = page.locator('.hl-row.is-com').first()
    if (await com.count()) {
      await com.scrollIntoViewIfNeeded()
      await medir('06e-hall-comunidade', { maxPassos: 18, semFoco: true })
      // a posição (o nº da linha) abre o resumo; o apelido do dono abre o perfil
      await tocar(com.locator('.hl-row__pos'), 1600)
      await page.waitForFunction(() => location.hash.startsWith('#/resumo'), null, { timeout: 15000 }).catch(() => {})
      await sleep(1500)
      await medir('06f-resumo-da-comunidade', { maxPassos: 18 })
    }
  })
  await etapa('desafios', async () => {
    await ir('#/desafios')
    await page.locator('main, .lx-page, [class*="ds-"], h1').first().waitFor({ state: 'visible', timeout: 30000 })
    await sleep(2500)
    await medir('07-desafios', { maxPassos: 18 })
  })
  await etapa('ligas', async () => {
    await ir('#/ligas', '.lv-wrap', 60000)
    await sleep(3500)
    await medir('08-ligas', { maxPassos: 18 })
    // a 2ª liga (as abas no topo)
    const abas = page.locator('.lv-wrap [role="tab"]')
    if ((await abas.count()) > 1) {
      await tocar(abas.nth(1), 2500)
      await medir('08b-ligas-outra', { maxPassos: 10, semFoco: true })
    }
  })
  await etapa('creditos', async () => {
    await ir('#/creditos')
    await sleep(2000)
    await medir('09-creditos', { maxPassos: 18 })
  })
  await etapa('jogador', async () => {
    let codigo = SEM?.codigo
    if (PROD) {
      // um perfil público de verdade, lido do Hall (só GET)
      codigo = await page.evaluate(async () => {
        try {
          const j = await (await fetch('api/hall.php')).json()
          return (j.itens ?? []).map((i) => i.perfil).find(Boolean) ?? null
        } catch {
          return null
        }
      })
    }
    if (!codigo) throw new Error('sem código de perfil público (semeie com hall-semear.mjs)')
    await ir(`#/jogador/${codigo}`)
    await sleep(3000)
    await medir('10-perfil-publico', { maxPassos: 14 })
  })
  await etapa('resumo', async () => {
    if (!SEM?.entradas?.length) throw new Error('sem carreira terminada semeada')
    // a de mais títulos: a tela mais cheia
    const e = [...SEM.entradas].sort((a, b) => (b.summary?.titles?.length ?? 0) - (a.summary?.titles?.length ?? 0))[0]
    await ir(`#/resumo?id=${e.id}`)
    await sleep(3500)
    await medir('11-resumo', { maxPassos: 20 })
  })
  await etapa('identidade', async () => {
    await ir('#/', '.ld-ctas__start')
    await tocar(page.locator('.ld-ctas__start'), 800)
    await page.locator('input[placeholder="Buscar país"]').waitFor({ state: 'visible', timeout: 60000 })
    await sleep(800)
    await medir('12-identidade-1-pais')
    const busca = page.locator('input[placeholder="Buscar país"]')
    await tocar(busca, 300)
    await busca.fill('Brasil')
    await sleep(500)
    await tocar(page.locator('#id-nation-list [role="radio"]', { hasText: /^\s*Brasil\s*$/ }).first(), 500)
    await page.evaluate(() => document.activeElement?.blur?.())
    await tocar(page.getByRole('button', { name: /^Continuar/ }), 700)
    await page.locator('#id-surname').waitFor({ state: 'visible', timeout: 20000 })
    await page.fill('#id-surname', 'Albuquerque')
    await page.evaluate(() => document.activeElement?.blur?.())
    await sleep(400)
    await medir('13-identidade-2-nome')
    await tocar(page.getByRole('button', { name: /^Continuar/ }), 800)
    const chip = page.locator('[role="radiogroup"][aria-label="Posição em campo"]').getByRole('radio', { name: 'Centroavante', exact: true }).first()
    await chip.waitFor({ state: 'visible', timeout: 20000 })
    await tocar(chip, 500)
    await medir('14-identidade-3-posicao')
  })
  await etapa('carreira', async () => {
    if (!(await page.evaluate(() => location.hash.startsWith('#/identidade')))) throw new Error('a carreira precisa da etapa identidade antes')
    await tocar(page.getByRole('button', { name: /^Confirmar$/ }), 800)
    await page.waitForFunction(() => location.hash.startsWith('#/carreira'), null, { timeout: 60000 })
    const pronta = async (ms = 90000) => {
      const t = Date.now()
      while (Date.now() - t < ms) {
        const cel = page.locator('.ck-cel[role="dialog"]')
        if (await cel.count()) {
          await cel.getByRole('button', { name: /^Continuar/ }).tap({ timeout: 3000 }).catch(() => {})
          await sleep(500)
          continue
        }
        if (await page.locator('.ck-end').count()) return 'fim'
        const pular = page.locator('.ck-sheet__skip button, button.ck-skip').first()
        if (await pular.count()) await pular.tap({ timeout: 2000 }).catch(() => {})
        const rec = page.locator('.ck-sheet.is-collapsed .ck-sheet__peek')
        if ((await rec.count()) && !(await page.locator('.ck-sheet__skip').count())) await rec.tap({ timeout: 2000 }).catch(() => {})
        const opt = page.locator('.ck-opt:not(.is-locked):not([disabled]), .ck-pen__zone:not([disabled])').first()
        if ((await opt.count()) && (await opt.isVisible().catch(() => false)) && !(await page.locator('.ck-skip, .ck-sheet__skip').count())) return 'decisao'
        await sleep(200)
      }
      return 'tempo'
    }
    const escolher = async (i) => {
      const pen = page.locator('.ck-pen__zone:not([disabled])')
      const op = page.locator('.ck-opt:not(.is-locked):not([disabled]):not(.is-retire)', { hasNotText: /Aposentar|Encerrar a carreira|Pendurar/ })
      const alvo = (await pen.count()) ? pen.first() : (await op.count()) ? op.nth(i % (await op.count())) : page.locator('.ck-opt:not(.is-locked)').first()
      await tocar(alvo, 600)
    }
    if ((await pronta()) !== 'decisao') throw new Error('a primeira decisão não apareceu')
    await sleep(800)
    await medir('15-carreira-1a-decisao', { maxPassos: 10 })
    // o teste de foco (na largura com --foco) passa pelo Tab nas abas atrás do sheet, e o jogo recolhe o sheet para o
    // foco aparecer (useFoldOnFocusBehind): reabre pelo puxador antes de escolher
    if ((await pronta(20000)) !== 'decisao') throw new Error('a decisão não voltou depois do teste de foco')
    // três decisões: a tabela e as abas ganham conteúdo
    for (let i = 0; i < 3; i++) {
      await escolher(i)
      if ((await pronta()) !== 'decisao') break
    }
    await sleep(600)
    await medir('16-carreira-decisao-4', { maxPassos: 10, semFoco: true })
    // o sheet recolhido (a pessoa toca no puxador para ver a tabela)
    const puxador = page.locator('.ck-sheet:not(.is-collapsed) .ck-sheet__peek, .ck-sheet:not(.is-collapsed) [aria-label*="Recolher"], .ck-sheet:not(.is-collapsed) .ck-sheet__grab').first()
    if (await puxador.count()) {
      await tocar(puxador, 900)
      if (await page.locator('.ck-sheet.is-collapsed').count()) {
        await medir('17-carreira-sheet-recolhido', { maxPassos: 10, semFoco: true })
        await tocar(page.locator('.ck-sheet.is-collapsed .ck-sheet__peek'), 900).catch(() => {})
      }
    }
    for (const [rotulo, re] of [
      ['temporada', /^Temporada/],
      ['premios', /^Prêmios/],
      ['mundo', /^Mundo/],
    ]) {
      const tab = page.getByRole('tab', { name: re }).first()
      if (!(await tab.count())) continue
      await tocar(tab, 1600)
      await medir(`18-carreira-aba-${rotulo}`, { maxPassos: 14, semFoco: rotulo !== 'temporada' })
    }
    await tocar(page.getByRole('tab', { name: /^Carreira/ }).first(), 900).catch(() => {})
    await abrirMenu()
    await medir('19-menu-com-carreira', { dialogo: true })
    // a confirmação de abandonar (dentro do menu)
    const ab = linhaMenu(/Abandonar/)
    if (await ab.count()) {
      await tocar(ab, 700)
      await medir('19b-menu-abandonar-confirmar', { dialogo: true, semFoco: true })
    }
    await fecharDialogos()
    await ir('#/', '.ld-ctas__start')
    await sleep(800)
    await medir('20-home-com-carreira', { semFoco: true })
    if (FIM) {
      await ir('#/carreira')
      for (let i = 0; i < 60; i++) {
        const st = await pronta(60000)
        if (st !== 'decisao') break
        await escolher(i)
      }
      if (await page.locator('.ck-end').count()) {
        await sleep(1500)
        await medir('21-carreira-fim', { maxPassos: 10 })
      }
    }
  })
  await etapa('conta', async () => {
    if (PROD) throw new Error('conta só na pilha local')
    const c = SEM?.contas?.[LARG.indexOf(w) % (SEM?.contas?.length || 1)]
    if (!c) throw new Error('sem conta semeada')
    try {
      sql('DELETE FROM tentativas')
    } catch {}
    const r = await page.evaluate(async ({ email, senha }) => {
      const x = await fetch('api/conta.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ acao: 'entrar', email, senha }) })
      return x.status
    }, c)
    if (r !== 200) throw new Error(`entrar respondeu ${r}`)
    await page.goto(URL0, { waitUntil: 'domcontentloaded' })
    await page.locator('.ld-ctas__start').waitFor({ state: 'visible', timeout: 60000 })
    await sleep(2000)
    await abrirMenu()
    await sleep(800)
    await medir('22-menu-com-conta', { dialogo: true })
    await tocar(page.locator('[role="dialog"] .sc-me').first(), 1500)
    await medir('23-minha-conta', { dialogo: true, maxPassos: 16 })
    await fecharDialogos()
    await abrirMenu()
    await tocar(linhaMenu(/Minhas carreiras/), 1500)
    await sleep(1000)
    await medir('24-minhas-carreiras', { dialogo: true, maxPassos: 16 })
    await fecharDialogos()
    await abrirMenu()
    const conv = linhaMenu(/Convide amigos/)
    if (await conv.count()) {
      await tocar(conv, 1500)
      await medir('25-convide-amigos', { dialogo: true, maxPassos: 16 })
      await fecharDialogos()
    } else await fecharDialogos()
    // denunciar uma carreira da comunidade (sem mandar)
    await ir('#/hall?seg=comunidade', '.hl-filtros')
    const outra = page.locator('.hl-row.is-com').filter({ hasNotText: c.apelido }).first()
    await outra.waitFor({ state: 'visible', timeout: 20000 })
    await tocar(outra.locator('.hl-row__pos'), 1600)
    await page.waitForFunction(() => location.hash.startsWith('#/resumo'), null, { timeout: 15000 })
    await sleep(1500)
    const den = page.getByRole('button', { name: /^Denunciar/ }).first()
    await tocar(den, 1200)
    await medir('26-denunciar', { dialogo: true })
    await fecharDialogos()
  })
  if (d.bloqueados?.length) console.log(`  ..  produção: ${d.bloqueados.length} pedido(s) que escreveriam foram bloqueados: ${[...new Set(d.bloqueados)].slice(0, 6).join(' · ')}`)
  await d.ctx.close()
}

const browser = await lancarT()
for (const w of LARG) await rodarLargura(browser, w)
if (MOV) await rodarLargura(browser, 390, { reduzir: true, soMovimento: true })
await browser.close()
writeFileSync(SAIDA, JSON.stringify(RELATORIO, null, 1))
console.log(`\nrelatório: ${SAIDA}`)

// ───────────────────────── os piores casos ─────────────────────────
const MD = SAIDA.replace(/\.json$/, '-piores.md')
writeFileSync(MD, piores([RELATORIO]))
console.log(`piores casos: ${MD}`)
