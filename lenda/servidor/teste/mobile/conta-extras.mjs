#!/usr/bin/env node
// LENDA v3.5 · revisão mobile — CONTA: o que sobra dos fluxos (pilha local).
//
// Etapas (--etapas=a,b; padrão: todas):
//   voltar     o voltar do Android (history.back) com o convite aberto (depois de ir ao Hall), com o "Confirme seu e-mail"
//              aberto, e com o "Entrar / Criar conta" aberto pelo menu numa tela interna.
//   link       quem chega pelo link de convite (?c=) no navegador do TikTok/Instagram: o convite fica guardado, o cadastro
//              mostra "Você veio pelo convite de um amigo" e a indicação entra no banco.
//   politica   tocar em "Política de Privacidade" no meio do cadastro: abre em outra aba e o que foi digitado fica.
//   safari15   o que o Safari 15.0–15.3 (iOS 15 sem atualizar) não tem: Array.prototype.at (apagado) em Minhas carreiras ·
//              Neste aparelho e no Convide amigos; e o sheet sem max-height (o dvh é ignorado: declaração inválida).
//   recarregar abrir pela conta, noutro aparelho, uma carreira que não está nele (Minhas carreiras → Abrir) e recarregar
//              a página no resumo dela: volta a mostrar a carreira?
//   toque      tocar na borda da caixa de um campo (fora do <input>, dentro da caixa de 48 px): o campo recebe o foco?
//
// Uso: LENDA_INTEG_BASE=/tmp/lenda-v35-conta node servidor/teste/mobile/conta-extras.mjs [--etapas=voltar,link]
import { AJUSTES_RAPIDOS, URL0, codigoDoEmail, contaPelaApi, dialogo, fim, home, jogarCelular, lancar, medirTela, menu, novoAparelho, nota, ok, print, semDialogo, sleep, sql, toasts } from './conta-lib.mjs'

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d
const ETAPAS = arg('etapas', 'voltar,link,politica,safari15,toque,recarregar').split(',')
const browser = await lancar()
const SUB = 'extras'
const SENHA = 'senha-forte-123'
const email = (p) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@exemplo.com`
const etapa = async (nome, fn) => {
  if (!ETAPAS.includes(nome)) return
  console.log(`\n── ${nome} ──`)
  try {
    await fn()
  } catch (e) {
    ok(false, `${nome}: travou — ${e.message.split('\n')[0]}`)
    console.log(e.stack?.split('\n').slice(0, 4).join('\n'))
  }
}
const rota = (page) => page.evaluate(() => location.href.replace(/^https?:\/\/[^/]+/, ''))
const abertos = (page) => page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute('aria-label') || d.querySelector('h2')?.textContent?.trim() || '?'))

// ───────────────────────── voltar ─────────────────────────
await etapa('voltar', async () => {
  const nome = 'galaxy-a'
  // 1) o convite aberto numa tela interna (o Hall): voltar
  {
    const ap = await novoAparelho(browser, nome, { partidas: 5 })
    const { page } = ap
    try {
      await home(page)
      await dialogo(page).waitFor({ timeout: 20000 })
      await page.getByRole('button', { name: 'Agora não' }).tap()
      await semDialogo(page)
      // o "Agora não" adia por 3 partidas: o convite volta com o contador em 8
      await page.evaluate(() => localStorage.setItem('lenda:partidas', '8'))
      await page.goto(`${URL0}#/hall`)
      await page.reload()
      await dialogo(page).waitFor({ timeout: 30000 })
      await sleep(700)
      const r0 = await rota(page)
      await page.goBack({ timeout: 5000 }).catch(() => {})
      await sleep(1500)
      const r1 = await rota(page)
      const ab = await abertos(page)
      const f = await print(page, nome, 'voltar-com-convite-aberto-no-hall', { sub: SUB })
      ok(ab.length === 0 || r1 === r0, `${nome}: voltar do Android com o convite aberto: ${r0} → ${r1}; diálogos depois: ${JSON.stringify(ab)} (o esperado: fechar o convite e ficar no Hall)`, { print: f })
    } finally {
      await ap.ctx.close()
    }
  }
  // 2) "Entrar / Criar conta" aberto pelo menu numa tela interna, com o e-mail digitado
  {
    const ap = await novoAparelho(browser, nome)
    const { page } = ap
    try {
      await home(page)
      await page.goto(`${URL0}#/hall`)
      await sleep(1500)
      const m = await menu(page)
      await m.getByText(/Entrar \/ Criar conta/).tap()
      const d = dialogo(page)
      await d.waitFor()
      await d.getByLabel('E-mail').fill('alguem@exemplo.com')
      const r0 = await rota(page)
      await page.goBack({ timeout: 5000 }).catch(() => {})
      await sleep(1500)
      const r1 = await rota(page)
      const ab = await abertos(page)
      const f = await print(page, nome, 'voltar-com-entrar-aberto-no-hall', { sub: SUB })
      ok(ab.length === 0 && r1 === r0, `${nome}: voltar do Android com "Entrar" aberto no Hall: ${r0} → ${r1}; diálogos depois: ${JSON.stringify(ab)} (o esperado: fechar o diálogo e ficar no Hall)`, { print: f })
    } finally {
      await ap.ctx.close()
    }
  }
  // 3) "Confirme seu e-mail" logo depois do cadastro, aberto na Home (a primeira página): voltar sai do site?
  {
    const ap = await novoAparelho(browser, nome, { partidas: 5 })
    const { page } = ap
    try {
      await home(page)
      const d = dialogo(page)
      await d.waitFor({ timeout: 20000 })
      const E = email('voltar')
      await d.getByLabel('Apelido').fill('Volta Atrás')
      await d.getByLabel('E-mail').fill(E)
      await d.getByLabel('Senha', { exact: true }).fill(SENHA)
      await d.getByRole('checkbox').first().check()
      await d.getByRole('button', { name: 'Criar conta', exact: true }).tap()
      await dialogo(page, 'Confirme seu e-mail').waitFor({ timeout: 20000 })
      const len = await page.evaluate(() => history.length)
      const r0 = await rota(page)
      await page.goBack({ timeout: 5000 }).catch(() => {})
      await sleep(1500)
      const r1 = page.url()
      const f = await print(page, nome, 'voltar-com-confirme-seu-email', { sub: SUB })
      ok(r1.startsWith(URL0), `${nome}: voltar do Android no "Confirme seu e-mail" (Home, history.length ${len}): ${r0} → ${r1.replace(/^https?:\/\/[^/]+/, '')} (sair do site aqui fecha o navegador do app e a pessoa nem vê o código)`, { print: f })
    } finally {
      await ap.ctx.close()
    }
  }
})

// ───────────────────────── link de convite nos navegadores dos apps ─────────────────────────
await etapa('link', async () => {
  // quem convida
  const ap0 = await novoAparelho(browser, 'pixel-7')
  let codigo, idIndicador
  try {
    await home(ap0.page)
    const c = await contaPelaApi(ap0.page, 'Quem Convida', email('indica'), SENHA)
    idIndicador = c.id
    codigo = sql(`SELECT codigo_convite FROM usuarios WHERE id=${c.id}`)
  } finally {
    await ap0.ctx.close()
  }
  for (const nome of ['tiktok-android', 'instagram-ios']) {
    const ap = await novoAparelho(browser, nome, { partidas: 0 })
    const { page } = ap
    try {
      await page.goto(`${URL0}?c=${codigo}`)
      await page.waitForSelector('.ld-modes', { timeout: 60000 })
      await sleep(2000)
      const g = await page.evaluate(() => JSON.parse(localStorage.getItem('lenda:convite') || 'null'))
      ok(g?.codigo === codigo, `${nome}: chegando pelo link ?c=${codigo}, o convite fica guardado (${JSON.stringify(g)})`)
      ok(!(await page.evaluate(() => location.search)).includes('c='), `${nome}: o ?c= sai da barra de endereço`)
      const m = await menu(page)
      await m.getByText(/Entrar \/ Criar conta/).tap()
      const d = dialogo(page)
      await d.waitFor()
      await d.getByRole('tab', { name: 'Criar conta' }).tap()
      await sleep(400)
      const E = email(nome.replace(/-/g, ''))
      await d.getByLabel('Apelido').fill(nome === 'tiktok-android' ? 'Veio do TikTok' : 'Veio do Insta')
      await d.getByLabel('E-mail').fill(E)
      await d.getByLabel('Senha', { exact: true }).fill(SENHA)
      await d.getByRole('checkbox').first().check()
      await d.locator('.sc-hint--convite').scrollIntoViewIfNeeded().catch(() => {})
      const f = await print(page, nome, 'cadastro-pelo-link-de-convite', { sub: SUB })
      ok(/convite de um amigo/.test(await d.innerText()), `${nome}: o cadastro mostra "Você veio pelo convite de um amigo"`, { print: f })
      await d.getByRole('button', { name: 'Criar conta', exact: true }).tap()
      await dialogo(page, 'Confirme seu e-mail').waitFor({ timeout: 20000 })
      const id = sql(`SELECT id FROM usuarios WHERE email='${E}'`)
      const ind = sql(`SELECT status FROM indicacoes WHERE indicado_id=${id} AND indicador_id=${idIndicador}`)
      ok(ind === 'pendente', `${nome}: a indicação entrou no banco (${ind || 'nenhuma'})`)
      const or = sql(`SELECT IFNULL(origem,'') FROM usuarios WHERE id=${id}`)
      const vis = sql(`SELECT CONCAT(IFNULL(origem,''),' bot=',bot,' ',IFNULL(dispositivo,'')) FROM visitas WHERE usuario_id=${id} ORDER BY inicio LIMIT 1`).split('\n')[0]
      nota(`${nome}: origem da conta "${or}"; 1ª visita ${vis || '(não achei)'}`)
      ok(!ap.erros.length, `${nome}: sem erro no console (link de convite)`, { erros: ap.erros.slice(0, 5) })
    } catch (e) {
      ok(false, `${nome}: link travou — ${e.message.split('\n')[0]}`)
    } finally {
      await ap.ctx.close()
    }
  }
})

// ───────────────────────── política de privacidade no meio do cadastro ─────────────────────────
await etapa('politica', async () => {
  const nome = 'iphone-14'
  const ap = await novoAparelho(browser, nome, { partidas: 5 })
  const { page, ctx } = ap
  try {
    await home(page)
    const d = dialogo(page)
    await d.waitFor({ timeout: 20000 })
    await d.getByLabel('Apelido').fill('Lendo Política')
    await d.getByLabel('E-mail').fill('lendo@exemplo.com')
    const nova = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null)
    await d.getByRole('link', { name: 'Política de Privacidade' }).tap()
    const p2 = await nova
    if (p2) {
      await p2.waitForLoadState().catch(() => {})
      await sleep(800)
      const f = await print(p2, nome, 'politica-de-privacidade', { sub: SUB })
      const { m } = await medirTela(p2, `${nome}: privacidade.html`, { raiz: 'body' })
      ok(m.lateral <= 0, `${nome}: a Política de Privacidade abre em outra aba e cabe no celular (lateral ${m.lateral}px)`, { print: f })
      const vp = await p2.evaluate(() => document.querySelector('meta[name="viewport"]')?.content ?? null)
      ok(!!vp, `${nome}: privacidade.html tem meta viewport (${vp})`, { print: f })
      await p2.close()
    } else ok(false, `${nome}: tocar em "Política de Privacidade" não abriu outra aba (url agora ${page.url()})`)
    const ainda = (await dialogo(page).count()) && (await d.getByLabel('Apelido').inputValue()) === 'Lendo Política'
    ok(ainda, `${nome}: voltando da política, o cadastro continua com o que foi digitado`)
  } finally {
    await ap.ctx.close()
  }
})

// ───────────────────────── Safari 15.0–15.3 ─────────────────────────
await etapa('safari15', async () => {
  const nome = 'iphone-se'
  // a) sem Array.prototype.at: Minhas carreiras · Neste aparelho (resumoLocal) e Convide amigos (degrausIndicacao)
  const ap = await novoAparelho(browser, nome, { ajustes: AJUSTES_RAPIDOS })
  const { page, ctx } = ap
  try {
    // sem conta: a carreira fica só neste aparelho (é a lista que o resumoLocal monta)
    await home(page)
    const r = await jogarCelular(page, 'SAFARI')
    ok(r.fim, `${nome}: uma carreira terminada (para a lista do aparelho)`)
    await ctx.addInitScript(() => {
      delete Array.prototype.at
      delete String.prototype.at
    })
    ap.erros.length = 0
    await home(page)
    await page.reload()
    await page.waitForSelector('.ld-modes', { timeout: 60000 })
    await sleep(1200)
    ok(await page.evaluate(() => typeof [].at === 'undefined'), `${nome}: Array.prototype.at apagado nesta página (como no Safari 15.3)`)
    // sem conta, Minhas carreiras abre pelo atalho do topo do Hall
    await page.goto(`${URL0}#/hall`)
    await sleep(1500)
    await page.getByRole('button', { name: 'Minhas carreiras na conta' }).first().tap()
    const d = dialogo(page, 'Minhas carreiras')
    await d.waitFor({ timeout: 15000 })
    await d.getByRole('tab', { name: /Neste aparelho/ }).tap()
    await sleep(1500)
    const f = await print(page, nome, 'safari15-sem-array-at-minhas-carreiras-neste-aparelho', { sub: SUB })
    const cartoes = await page.locator('.sc-card').count()
    ok(cartoes >= 1 && !ap.erros.length, `${nome} (Safari 15.0–15.3, sem Array.prototype.at): Minhas carreiras · Neste aparelho mostra a carreira (${cartoes} cartões; erros: ${JSON.stringify(ap.erros.slice(0, 3))})`, { print: f })
    await page.keyboard.press('Escape').catch(() => {})
    ap.erros.length = 0
    await home(page)
    await contaPelaApi(page, 'Safari Quinze', email('safari'), SENHA)
    await page.reload()
    await page.waitForSelector('.ld-modes', { timeout: 60000 })
    await sleep(1200)
    const m3 = await menu(page)
    await m3.locator('.sc-me').tap()
    await dialogo(page, 'Minha conta').waitFor({ timeout: 15000 }).catch(() => {})
    await sleep(2500)
    await page.locator('.sc-conv, .sc-conv__erro, #sc-convite-h').first().scrollIntoViewIfNeeded().catch(() => {})
    const f2 = await print(page, nome, 'safari15-sem-array-at-minha-conta', { sub: SUB })
    const conv = await page.locator('.sc-conv').count()
    ok(conv >= 1 && !ap.erros.length, `${nome} (sem Array.prototype.at): Minha conta e o Convide amigos abrem (${conv} cartões; erros: ${JSON.stringify(ap.erros.slice(0, 3))})`, { print: f2 })
  } finally {
    await ap.ctx.close()
  }
  // b) o sheet sem max-height (92dvh ignorado): o convite das 5 partidas no iPhone SE
  const ap2 = await novoAparelho(browser, nome, { partidas: 5 })
  try {
    await ap2.ctx.addInitScript(() => {
      const css = `.lx-sheet, .sc-modal.lx-sheet { max-height: none !important; }`
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style')
        s.textContent = css
        document.head.appendChild(s)
      })
    })
    await home(ap2.page)
    const d = dialogo(ap2.page)
    await d.waitFor({ timeout: 20000 })
    await sleep(800)
    const g = await ap2.page.evaluate(() => {
      const s = document.querySelector('[role="dialog"].sc-modal')
      const r = s.getBoundingClientRect()
      const b = s.querySelector('.lx-dialog__body')
      const x = s.querySelector('[aria-label="Fechar"]')?.getBoundingClientRect()
      return { top: Math.round(r.top), altura: Math.round(r.height), janela: innerHeight, corpoRola: b.scrollHeight > b.clientHeight + 2, fecharTop: x ? Math.round(x.top) : null }
    })
    const f = await print(ap2.page, nome, 'safari15-sem-dvh-convite', { sub: SUB })
    ok(g.top >= 0, `${nome} (Safari 15.0–15.3, sem dvh): o convite cabe na tela (${JSON.stringify(g)})`, { print: f })
  } finally {
    await ap2.ctx.close()
  }
})

// ───────────────────────── toque na borda da caixa do campo ─────────────────────────
await etapa('toque', async () => {
  const nome = 'iphone-se'
  const ap = await novoAparelho(browser, nome, { partidas: 5 })
  const { page } = ap
  try {
    await home(page)
    const d = dialogo(page)
    await d.waitFor({ timeout: 20000 })
    await sleep(500)
    const caixa = d.locator('.sc-field').filter({ hasText: 'E-mail' }).locator('.sc-input')
    const alvos = [
      ['topo da caixa (5 px abaixo da borda)', (b) => [b.x + b.width / 2, b.y + 5]],
      ['base da caixa (5 px acima da borda)', (b) => [b.x + b.width / 2, b.y + b.height - 5]],
      ['canto esquerdo (7 px da borda)', (b) => [b.x + 7, b.y + b.height / 2]],
      ['meio', (b) => [b.x + b.width / 2, b.y + b.height / 2]],
    ]
    const res = []
    let bb, inp
    for (const [rot, ponto] of alvos) {
      await page.evaluate(() => document.activeElement?.blur?.())
      await d.locator('.lx-dialog__body').evaluate((b) => b.scrollTo(0, 0))
      await sleep(900)
      bb = await caixa.boundingBox()
      inp = await d.getByLabel('E-mail').boundingBox()
      const [x, y] = ponto(bb)
      const quem = await page.evaluate(([x, y]) => {
        const e = document.elementFromPoint(x, y)
        return e ? `${e.tagName.toLowerCase()}.${e.className}`.slice(0, 40) : null
      }, [x, y])
      await page.touchscreen.tap(x, y)
      await sleep(200)
      const foco = await page.evaluate(() => document.activeElement?.getAttribute('type') ?? document.activeElement?.tagName)
      res.push(`${rot} (toque cai em ${quem}): ${foco === 'email' ? 'foca' : `não foca (${foco})`}`)
    }
    const f = await print(page, nome, 'toque-na-borda-do-campo', { sub: SUB })
    console.log(`      caixa ${Math.round(bb.width)}×${Math.round(bb.height)}, <input> ${Math.round(inp.width)}×${Math.round(inp.height)}: ${res.join(' · ')}`)
    ok(res.every((r) => r.includes(': foca')), `${nome}: tocar em qualquer ponto da caixa do campo (${Math.round(bb.width)}×${Math.round(bb.height)}) foca o campo — o <input> tem só ${Math.round(inp.height)} px de altura (${res.join(' · ')})`, { print: f })
  } finally {
    await ap.ctx.close()
  }
})

// ───────────────────────── recarregar no resumo de uma carreira da conta ─────────────────────────
await etapa('recarregar', async () => {
  const E = email('recarga')
  const a1 = await novoAparelho(browser, 'pixel-7', { ajustes: AJUSTES_RAPIDOS })
  try {
    await home(a1.page)
    await contaPelaApi(a1.page, 'Recarga', E, SENHA)
    await a1.page.reload()
    await a1.page.waitForSelector('.ld-modes', { timeout: 60000 })
    await jogarCelular(a1.page, 'RECARGA')
    await sleep(1500)
    const b = a1.page.getByRole('button', { name: 'Salvar na minha conta' })
    if (await b.count()) {
      await b.first().click()
      await a1.page.locator('.sc-saved').first().waitFor({ timeout: 15000 })
    }
  } finally {
    await a1.ctx.close()
  }
  const nome = 'iphone-14'
  const ap = await novoAparelho(browser, nome)
  const { page } = ap
  try {
    await home(page)
    const st = await page.evaluate(
      async ({ email, senha }) => (await fetch('api/conta.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'entrar', email, senha }) })).status,
      { email: E, senha: SENHA },
    )
    ok(st === 200, `${nome}: entrou na conta noutro aparelho`)
    await page.reload()
    await page.waitForSelector('.ld-modes', { timeout: 60000 })
    await sleep(1500)
    const m = await menu(page)
    await m.getByText('Minhas carreiras', { exact: true }).tap()
    const d = dialogo(page, 'Minhas carreiras')
    await d.locator('.sc-card').first().waitFor({ timeout: 15000 })
    await d.getByRole('button', { name: 'Abrir' }).first().tap()
    await page.waitForFunction(() => location.hash.startsWith('#/resumo'), null, { timeout: 20000 })
    await sleep(1500)
    const f1 = await print(page, nome, 'carreira-da-conta-noutro-aparelho-resumo', { sub: SUB })
    const antes = await page.evaluate(() => document.body.innerText.includes('RECARGA'))
    ok(antes, `${nome}: o resumo da carreira da conta abre (${await rota(page)})`, { print: f1 })
    await page.reload()
    await page.waitForSelector('.lx-topbar', { timeout: 60000 })
    let depois = false
    for (let i = 0; i < 20 && !depois; i++) {
      await sleep(500)
      depois = await page.evaluate(() => document.body.innerText.includes('RECARGA'))
    }
    const f2 = await print(page, nome, 'carreira-da-conta-noutro-aparelho-depois-de-recarregar', { sub: SUB })
    ok(depois, `${nome}: recarregando no resumo dessa carreira, ela volta a aparecer (${await rota(page)})`, { print: f2 })
    ok(!ap.erros.length, `${nome}: sem erro no console (recarregar)`, { erros: ap.erros.slice(0, 5) })
  } finally {
    await ap.ctx.close()
  }
})

await browser.close()
process.exit(fim('extras') ? 1 : 0)
