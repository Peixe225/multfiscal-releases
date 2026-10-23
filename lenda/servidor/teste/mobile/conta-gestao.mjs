#!/usr/bin/env node
// LENDA v3.5 · revisão mobile — CONTA E COMPARTILHAMENTO com a conta aberta (pilha local): Minhas carreiras (salvar,
// abrir, publicar, apagar), Minha conta, Convide amigos (copiar, compartilhar, nos navegadores dos apps), Fale conosco,
// o aviso de emblema ganho, o voltar do Android e o recarregar com diálogo aberto, sair, entrar, esqueci a senha e
// excluir a conta.
//
// Etapas (--etapas=a,b; padrão: todas, na ordem):
//   fluxo     um aparelho (Galaxy A, navigator.share de mentira) do começo ao fim: conta → 2 carreiras pela tela → salvar →
//             Minhas carreiras → Minha conta → Convide amigos → emblema → Fale conosco → voltar → recarregar → sair →
//             entrar → esqueci a senha → excluir.
//   telas     com uma conta que já tem carreiras, em cada aparelho: menu, Minha conta (topo e fim), Minhas carreiras e
//             Fale conosco: print + rolagem lateral, alvos < 40 px, texto cortado.
//   apps      TikTok / Instagram / WhatsApp (sem navigator.share, como o WebView do Android): "Compartilhar" e "Copiar" do
//             convite, com o clipboard funcionando e negado.
//
// Uso: LENDA_INTEG_BASE=/tmp/lenda-v35-conta node servidor/teste/mobile/conta-gestao.mjs [--etapas=fluxo] [--aparelhos=...]
import {
  APARELHOS, AJUSTES_RAPIDOS, URL0, fecharTudo, painelDeslocado, atributos, campoVisivel, botaoVisivel, codigoDoEmail, colar, contaPelaApi, dialogo, fim, home, jogarCelular, lancar, medirTela, menu, novoAparelho, nota, ok, print, semDialogo, sleep, sql, teclado, toasts,
} from './conta-lib.mjs'

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d
const ETAPAS = arg('etapas', 'fluxo,telas,apps').split(',')
const LISTA = arg('aparelhos', Object.keys(APARELHOS).filter((n) => n !== 'galaxy-a-deitado').join(',')).split(',')
const browser = await lancar()
const SUB = 'gestao'
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
const passo = async (rot, fn) => {
  console.log(`   · ${rot}`)
  try {
    await fn()
  } catch (e) {
    ok(false, `${rot}: travou — ${e.message.split('\n')[0]}`)
  }
}
const pequenos = (nome, tela, m, f) => {
  if (m.pequenos.length) ok(false, `${nome}: ${tela} com alvos de toque < 40 px: ${m.pequenos.map((p) => `"${p.nome}" ${p.w}×${p.h}`).join(' · ')}`, { print: f, pequenos: m.pequenos })
}
const entrarPelaApi = (page, email, senha = SENHA) =>
  page.evaluate(
    async ({ email, senha }) => {
      const r = await fetch('api/conta.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'entrar', email, senha }) })
      return r.status
    },
    { email, senha },
  )
const rota = (page) => page.evaluate(() => location.hash)
const abertos = (page) => page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute('aria-label') || d.querySelector('h2')?.textContent?.trim() || '?'))

// a conta que as etapas "telas" e "apps" usam (criada no fluxo; sem o fluxo, uma nova com 1 carreira jogada)
let CONTA = null

// ───────────────────────── fluxo ─────────────────────────
await etapa('fluxo', async () => {
  const nome = 'galaxy-a'
  const ap = await novoAparelho(browser, nome, { share: 'falso', ajustes: AJUSTES_RAPIDOS })
  const { page, a } = ap
  try {
    await home(page)
    const E = email('fluxo')
    CONTA = await contaPelaApi(page, 'Ana Celular', E, SENHA)
    await page.reload()
    await page.waitForSelector('.ld-modes', { timeout: 60000 })
    await sleep(1500)
    // o "Confirme seu e-mail" não abre sozinho (a conta veio da API) — ok

    await passo('2 carreiras pela tela, com a conta', async () => {
      for (const s of ['PRIMEIRA', 'SEGUNDA']) {
        const r = await jogarCelular(page, s)
        ok(r.fim, `${nome}: carreira ${s} jogada até o fim (${Math.round(r.ms / 1000)} s)`)
        await sleep(1200)
        const f = await print(page, nome, `fim-de-carreira-com-conta-${s}`, { sub: SUB })
        const salvar = page.getByRole('button', { name: 'Salvar na minha conta' })
        const salva = page.locator('.sc-saved')
        if (await salvar.count()) {
          const bb = await salvar.first().boundingBox()
          ok(bb && bb.height >= 40, `${nome}: "Salvar na minha conta" no fim da carreira: ${bb ? `${Math.round(bb.width)}×${Math.round(bb.height)}` : 'fora da tela'}`, { print: f })
          if (s === 'PRIMEIRA') {
            await salvar.first().tap()
            await salva.first().waitFor({ timeout: 15000 })
            await sleep(500)
            const fs = await print(page, nome, 'fim-de-carreira-salva-na-conta', { sub: SUB })
            const t = await toasts(page)
            console.log(`      toasts: ${JSON.stringify(t)}`)
            ok(true, `${nome}: salva pelo botão do fim (selo "Salva na sua conta")`, { print: fs })
          }
        } else if (await salva.count()) nota(`${nome}: a carreira ${s} subiu sozinha para a conta`)
      }
    })

    await passo('menu com a conta', async () => {
      await home(page)
      const m = await menu(page)
      const f = await print(page, nome, 'menu-com-conta', { sub: SUB })
      const { m: md } = await medirTela(page, `${nome}: menu com a conta`, { raiz: '[role="dialog"]' })
      ok(md.lateral <= 0, `${nome}: menu sem rolagem lateral`, { print: f })
      pequenos(nome, 'menu com a conta', md, f)
      await m.getByText('Minhas carreiras', { exact: true }).tap()
    })

    await passo('Minhas carreiras', async () => {
      const d = dialogo(page, 'Minhas carreiras')
      await d.waitFor({ timeout: 15000 })
      await sleep(1200)
      let f = await print(page, nome, 'minhas-carreiras-na-conta', { sub: SUB })
      let { m } = await medirTela(page, `${nome}: Minhas carreiras · Na conta`)
      ok(m.lateral <= 0 && !m.cortados.filter((c) => !c.reticencias).length, `${nome}: Minhas carreiras · Na conta sem rolagem lateral nem texto cortado`, { print: f, cortados: m.cortados })
      pequenos(nome, 'Minhas carreiras · Na conta', m, f)
      const cartoes = await d.locator('.sc-card').count()
      ok(cartoes >= 1, `${nome}: ${cartoes} carreira(s) na conta`)
      // Neste aparelho: a 2ª carreira (não salva) → Salvar na conta
      await d.getByRole('tab', { name: /Neste aparelho/ }).tap()
      await sleep(600)
      f = await print(page, nome, 'minhas-carreiras-neste-aparelho', { sub: SUB })
      ;({ m } = await medirTela(page, `${nome}: Minhas carreiras · Neste aparelho`))
      pequenos(nome, 'Minhas carreiras · Neste aparelho', m, f)
      const salvarBtn = d.getByRole('button', { name: 'Salvar na conta' })
      if (await salvarBtn.count()) {
        await salvarBtn.first().tap()
        await sleep(2500)
        const t = await toasts(page)
        const fs = await print(page, nome, 'minhas-carreiras-salvou-neste-aparelho', { sub: SUB })
        ok(t.length > 0, `${nome}: "Salvar na conta" (Neste aparelho) mostra o aviso ${JSON.stringify(t)}`, { print: fs })
      }
      await d.getByRole('tab', { name: /Na conta/ }).tap()
      await sleep(800)
      // Pôr no Hall (publicar): no "automático", mexer em uma passa para "eu escolho"
      const por = d.getByRole('button', { name: /Pôr no Hall|Tirar do Hall/ }).first()
      if (await por.count()) {
        const antes = (await por.innerText()).trim()
        await por.tap()
        await sleep(1500)
        const t = await toasts(page)
        const fp = await print(page, nome, 'minhas-carreiras-por-no-hall', { sub: SUB })
        ok(t.length > 0, `${nome}: "${antes}" responde com aviso: ${JSON.stringify(t.map((x) => x.titulo))}`, { print: fp })
        for (const x of t) if (x.descCortada) ok(false, `${nome}: o aviso de "${antes}" corta o texto no celular ("${x.titulo}" — "${x.desc}")`, { print: fp })
      } else nota(`${nome}: nenhuma carreira com "Pôr no Hall" (todas fora do Hall por regra)`)
      // o seletor do Hall público (3 opções) cabe?
      const seg = d.locator('.sc-hp [role="radiogroup"]')
      if (await seg.count()) {
        const r = await seg.evaluate((el) => ({ w: el.scrollWidth, cw: el.clientWidth, itens: [...el.children].map((c) => [c.textContent.trim(), Math.round(c.getBoundingClientRect().height)]) }))
        ok(r.w <= r.cw + 1, `${nome}: o seletor "As 3 melhores / Eu escolho / Nenhuma" cabe (${JSON.stringify(r)})`)
      }
      // Abrir → resumo da carreira; e o voltar do Android
      const rAntes = await rota(page)
      await d.getByRole('button', { name: 'Abrir' }).first().tap()
      await page.waitForFunction(() => location.hash.startsWith('#/resumo'), null, { timeout: 20000 })
      await sleep(1500)
      const fr = await print(page, nome, 'carreira-da-conta-aberta-resumo', { sub: SUB })
      ok((await dialogo(page).count()) === 0, `${nome}: "Abrir" fecha Minhas carreiras e mostra o resumo (${await rota(page)})`, { print: fr })
      await page.goBack()
      await sleep(1200)
      const rDepois = await rota(page)
      const fb = await print(page, nome, 'voltar-depois-de-abrir-carreira', { sub: SUB })
      nota(`${nome}: voltar do Android depois de "Abrir": de ${rAntes} → resumo → ${rDepois}; diálogos abertos: ${JSON.stringify(await abertos(page))}`, { print: fb })
      // Apagar (com confirmação)
      const m2 = await menu(page)
      await m2.getByText('Minhas carreiras', { exact: true }).tap()
      const d2 = dialogo(page, 'Minhas carreiras')
      await d2.waitFor()
      await sleep(1200)
      const n0 = await d2.locator('.sc-card').count()
      await d2.getByRole('button', { name: /^Apagar .* da conta$/ }).first().tap()
      await sleep(400)
      const fc = await print(page, nome, 'minhas-carreiras-confirmar-apagar', { sub: SUB })
      const conf = d2.locator('.sc-confirm')
      ok(await conf.isVisible(), `${nome}: "Apagar" pede confirmação no próprio cartão`, { print: fc })
      const bbC = await conf.boundingBox()
      ok(bbC && bbC.y >= 0 && bbC.y + bbC.height <= a.h, `${nome}: a confirmação de apagar fica à vista (${bbC ? `${Math.round(bbC.y)}–${Math.round(bbC.y + bbC.height)} de ${a.h}` : '?'})`, { print: fc })
      await conf.getByRole('button', { name: 'Apagar', exact: true }).tap()
      await sleep(2000)
      const n1 = await d2.locator('.sc-card').count()
      const fa = await print(page, nome, 'minhas-carreiras-depois-de-apagar', { sub: SUB })
      ok(n1 === n0 - 1, `${nome}: apagou (${n0} → ${n1} cartões)`, { print: fa })
      await page.keyboard.press('Escape')
      await semDialogo(page).catch(() => {})
    })

    await passo('Minha conta (faixa do e-mail, convite, perfil)', async () => {
      const m = await menu(page)
      await m.locator('.sc-me').tap()
      const d = dialogo(page, 'Minha conta')
      await d.waitFor({ timeout: 15000 })
      await sleep(1500)
      const f = await print(page, nome, 'minha-conta-topo', { sub: SUB })
      const { m: md } = await medirTela(page, `${nome}: Minha conta (topo)`)
      ok(md.lateral <= 0, `${nome}: Minha conta sem rolagem lateral`, { print: f })
      pequenos(nome, 'Minha conta (topo)', md, f)
      // a faixa do e-mail (código) com o teclado aberto
      const cod = d.getByLabel('Código de 6 dígitos')
      if (await cod.count()) {
        await cod.tap()
        await teclado(page, a, true)
        await sleep(450)
        const v = await campoVisivel(page)
        const fk = await print(page, nome, 'minha-conta-faixa-codigo-teclado', { sub: SUB })
        ok(v.inteiro && !v.porCima, `${nome}: o código na faixa de Minha conta fica à vista com o teclado (${JSON.stringify(v)})`, { print: fk })
        const codigo = await codigoDoEmail(CONTA.email, 0, 3000)
        if (codigo) {
          await colar(page, codigo)
          await d.getByRole('button', { name: 'Confirmar e-mail' }).tap()
          await sleep(1500)
        }
        await teclado(page, a, false)
        ok(sql(`SELECT IFNULL(email_verificado_em,'nulo') FROM usuarios WHERE id=${CONTA.id}`) !== 'nulo', `${nome}: e-mail confirmado pela faixa de Minha conta`)
      }
      // Convide amigos
      const conv = d.locator('.sc-conv')
      await conv.scrollIntoViewIfNeeded()
      await conv.locator('input').waitFor({ timeout: 10000 })
      await sleep(400)
      const fc = await print(page, nome, 'minha-conta-convide-amigos', { sub: SUB })
      const link = await conv.locator('input').inputValue()
      ok(/\?c=[A-Za-z0-9]{4,16}$/.test(link), `${nome}: link do convite "${link}"`, { print: fc })
      await conv.getByRole('button', { name: 'Copiar' }).tap()
      await sleep(400)
      const copiado = await page.evaluate(() => window.__copiado.at(-1)?.t)
      const rot = (await conv.getByRole('button', { name: /Copiar|Copiado/ }).innerText()).trim()
      ok(copiado === link && rot === 'Copiado', `${nome}: "Copiar" põe o link no clipboard ("${copiado}") e o botão vira "${rot}"`)
      await conv.getByRole('button', { name: 'Compartilhar' }).tap()
      await sleep(500)
      const sh = await page.evaluate(() => window.__compartilhado ?? null)
      ok(sh && sh.url === link && sh.ativa !== false, `${nome}: "Compartilhar" abre o compartilhar do celular com o link (${JSON.stringify(sh)})`)
      // o link do perfil público
      const perfilInput = d.getByLabel('Link do seu perfil público')
      await perfilInput.scrollIntoViewIfNeeded()
      const fp = await print(page, nome, 'minha-conta-perfil-publico', { sub: SUB })
      await d.getByRole('button', { name: 'Copiar o link' }).tap()
      await sleep(500)
      const t = await toasts(page)
      ok(t.some((x) => /copiado/i.test(x.titulo)), `${nome}: "Copiar o link" do perfil avisa (${JSON.stringify(t)})`, { print: fp })
      for (const x of t) if (x.descCortada) nota(`${nome}: o aviso "${x.titulo}" corta o texto no celular ("${x.desc}")`, { print: fp })
      // rola até o fim
      await d.locator('.lx-dialog__body').evaluate((b) => b.scrollTo(0, b.scrollHeight))
      await sleep(500)
      const ff = await print(page, nome, 'minha-conta-fim', { sub: SUB })
      const { m: mf } = await medirTela(page, `${nome}: Minha conta (fim)`)
      pequenos(nome, 'Minha conta (fim)', mf, ff)
      // editar o perfil com o teclado aberto: Apelido e "Salvar alterações"
      const ap1 = d.locator('form').filter({ has: page.getByRole('button', { name: 'Salvar alterações' }) }).getByLabel('Apelido')
      await ap1.scrollIntoViewIfNeeded()
      await ap1.tap()
      await teclado(page, a, true)
      await sleep(450)
      await page.keyboard.press('End')
      await page.keyboard.type(' 2')
      const v = await campoVisivel(page)
      const b = await botaoVisivel(page, '[role="dialog"].sc-modal form button[type="submit"]:not([disabled])')
      const fe = await print(page, nome, 'minha-conta-editar-apelido-teclado', { sub: SUB })
      ok(v.inteiro, `${nome}: editar o apelido com o teclado aberto: o campo à vista (${JSON.stringify(v)})`, { print: fe })
      await teclado(page, a, false)
      await d.getByRole('button', { name: 'Salvar alterações' }).tap()
      await sleep(1500)
      ok(sql(`SELECT apelido FROM usuarios WHERE id=${CONTA.id}`) === 'Ana Celular 2', `${nome}: apelido salvo (${sql(`SELECT apelido FROM usuarios WHERE id=${CONTA.id}`)})`)
    })

    await passo('voltar do Android com Minha conta aberta', async () => {
      const r0 = await rota(page)
      const len0 = await page.evaluate(() => history.length)
      await page.goBack({ timeout: 5000 }).catch(() => {})
      await sleep(1500)
      const r1 = await rota(page)
      const abertosDepois = await abertos(page)
      const f = await print(page, nome, 'voltar-com-minha-conta-aberta', { sub: SUB })
      ok(abertosDepois.length === 0 && r1 === r0, `${nome}: voltar do Android com Minha conta aberta fecha o diálogo e fica na mesma tela (rota ${r0} → ${r1}; diálogos depois: ${JSON.stringify(abertosDepois)}; history.length ${len0})`, { print: f })
      if (abertosDepois.length) {
        // o diálogo ficou: o que tem por baixo dele agora
        await fecharTudo(page)
        await sleep(600)
        const fb = await print(page, nome, 'voltar-com-minha-conta-fechou-e-esta-em', { sub: SUB })
        nota(`${nome}: fechando o Minha conta que ficou aberto depois do voltar, a pessoa está em ${await rota(page)}`, { print: fb })
      }
    })

    await passo('emblema ganho (aviso)', async () => {
      sql(`INSERT INTO emblemas_usuario (usuario_id, desafio_id, jogador, em, estado) VALUES (${CONTA.id}, 4, 'PRIMEIRA', NOW(3), 'ativo')`)
      // os emblemas da conta já lidos nesta aba ficam em memória: a página nova (outro dia, outra visita) lê de novo
      await home(page)
      await page.reload()
      await page.waitForSelector('.ld-modes', { timeout: 60000 })
      await sleep(1500)
      // os emblemas da conta vêm ao abrir Minha conta (ou a lista de desafios)
      const m = await menu(page)
      await m.locator('.sc-me').tap()
      const d = dialogo(page, 'Minha conta')
      await d.waitFor()
      let t = []
      for (let i = 0; i < 20 && !t.some((x) => /emblema/i.test(x.titulo)); i++) {
        await sleep(300)
        t = await toasts(page)
      }
      const f = await print(page, nome, 'aviso-emblema-ganho', { sub: SUB })
      const e = t.find((x) => /emblema/i.test(x.titulo))
      ok(!!e, `${nome}: aviso de emblema novo aparece (${JSON.stringify(t)})`, { print: f })
      if (e) {
        ok(!e.tituloCortado, `${nome}: o título do aviso do emblema cabe ("${e.titulo}")`, { print: f })
        ok(!e.descCortada, `${nome}: o texto do aviso do emblema cabe ("${e.desc}")`, { print: f })
        const acao = page.locator('.lx-toast__action').first()
        if (await acao.count()) {
          const bb = await acao.boundingBox()
          ok(bb.width >= 40 && bb.height >= 40, `${nome}: botão "Ver desafios" do aviso: ${Math.round(bb.width)}×${Math.round(bb.height)} px`, { print: f })
          const x = page.locator('.lx-toast__x').first()
          const bx = await x.boundingBox().catch(() => null)
          if (bx) ok(bx.width >= 40 && bx.height >= 40, `${nome}: o "fechar" do aviso: ${Math.round(bx.width)}×${Math.round(bx.height)} px`, { print: f })
          // o aviso por cima do diálogo: dá para tocar?
          const topo = await acao.evaluate((el) => {
            const r = el.getBoundingClientRect()
            const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
            return t === el || el.contains(t)
          })
          ok(topo, `${nome}: o botão do aviso do emblema está por cima do diálogo e recebe o toque`, { print: f })
        }
      }
      const emb = d.locator('.s4-meus li')
      await d.getByText('Seus emblemas').scrollIntoViewIfNeeded().catch(() => {})
      const fe = await print(page, nome, 'minha-conta-seus-emblemas', { sub: SUB })
      ok((await emb.count()) >= 1, `${nome}: "Seus emblemas" mostra o emblema novo`, { print: fe })
      await page.keyboard.press('Escape')
      await semDialogo(page).catch(() => {})
    })

    await passo('Fale conosco', async () => {
      const m = await menu(page)
      await m.getByText('Fale conosco', { exact: true }).tap()
      const d = dialogo(page, 'Fale conosco')
      await d.waitFor()
      await sleep(900)
      const foco = await page.evaluate(() => document.activeElement?.tagName)
      const f = await print(page, nome, 'fale-conosco', { sub: SUB })
      const { m: md } = await medirTela(page, `${nome}: Fale conosco`)
      ok(md.lateral <= 0, `${nome}: Fale conosco sem rolagem lateral`, { print: f })
      pequenos(nome, 'Fale conosco', md, f)
      nota(`${nome}: Fale conosco abre com o foco em ${foco} (no celular, foco num campo abre o teclado e esconde o resto do formulário)`, { print: f })
      await d.locator('.sv-tipo', { hasText: 'Problema' }).tap()
      const ta = d.locator('textarea')
      await ta.tap()
      await teclado(page, a, true)
      await sleep(450)
      await page.keyboard.type('Testando pelo celular: o botão de compartilhar não abriu nada no TikTok.')
      const v = await campoVisivel(page)
      const b = await botaoVisivel(page, '[role="dialog"].sc-modal button[type="submit"]')
      const fk = await print(page, nome, 'fale-conosco-teclado', { sub: SUB })
      ok(v.inteiro && !v.porCima, `${nome}: Fale conosco com o teclado aberto: a mensagem à vista (${JSON.stringify(v)})`, { print: fk })
      nota(`${nome}: Fale conosco com o teclado: "Enviar mensagem" em ${JSON.stringify(b)}`, { print: fk })
      // voltar do Android com a mensagem escrita
      const r0 = await rota(page)
      await page.goBack({ timeout: 5000 }).catch(() => {})
      await sleep(1200)
      const ab = await abertos(page)
      const fv = await print(page, nome, 'fale-conosco-voltar-com-mensagem', { sub: SUB })
      nota(`${nome}: voltar do Android com a mensagem do Fale conosco escrita: rota ${r0} → ${await rota(page)}; diálogos: ${JSON.stringify(ab)}`, { print: fv })
      await teclado(page, a, false)
      if (!(await dialogo(page, 'Fale conosco').count())) {
        const m2 = await menu(page)
        await m2.getByText('Fale conosco', { exact: true }).tap()
        await dialogo(page, 'Fale conosco').waitFor()
        await sleep(600)
        const txt = await dialogo(page, 'Fale conosco').locator('textarea').inputValue()
        ok(txt.length > 0, `${nome}: reabrindo o Fale conosco depois do voltar, a mensagem escrita continua lá ("${txt.slice(0, 30)}")`)
        await dialogo(page, 'Fale conosco').locator('textarea').fill('Testando pelo celular: o botão de compartilhar não abriu nada no TikTok.')
      }
      const d2 = dialogo(page, 'Fale conosco')
      await d2.getByRole('button', { name: 'Enviar mensagem' }).tap()
      await d2.getByText(/Mensagem enviada/).waitFor({ timeout: 15000 })
      const fo = await print(page, nome, 'fale-conosco-enviado', { sub: SUB })
      ok(true, `${nome}: mensagem enviada (${(await d2.locator('.sc-ok').innerText()).replace(/\s+/g, ' ').slice(0, 120)})`, { print: fo })
      await d2.getByRole('button', { name: 'Fechar' }).first().tap()
      await semDialogo(page).catch(() => {})
    })

    await passo('recarregar com Minha conta aberta', async () => {
      const m = await menu(page)
      await m.locator('.sc-me').tap()
      await dialogo(page, 'Minha conta').waitFor()
      await page.reload()
      await page.waitForSelector('.ld-modes, .lx-topbar', { timeout: 60000 })
      await sleep(2000)
      const m2 = await menu(page)
      const txt = await m2.innerText()
      const f = await print(page, nome, 'recarregou-menu-ainda-logado', { sub: SUB })
      ok(/Ana Celular/.test(txt), `${nome}: depois de recarregar, a conta continua aberta`, { print: f })
      await page.keyboard.press('Escape')
    })

    await passo('sair', async () => {
      const m = await menu(page)
      await m.getByText('Sair', { exact: true }).tap()
      await sleep(1500)
      const t = await toasts(page)
      const f = await print(page, nome, 'saiu-da-conta', { sub: SUB })
      ok(t.some((x) => /saiu/i.test(x.titulo)), `${nome}: "Sair" avisa (${JSON.stringify(t.map((x) => x.titulo))})`, { print: f })
      const fechouMenu = (await page.getByRole('dialog', { name: 'Menu' }).count()) === 0
      nota(`${nome}: depois de "Sair" pelo menu, o menu ${fechouMenu ? 'fechou' : 'continua aberto (mostrando "Entrar / Criar conta")'}`, { print: f })
      if (!fechouMenu) await page.keyboard.press('Escape')
      await sleep(400)
    })

    await passo('entrar (senha errada e certa)', async () => {
      const m = await menu(page)
      await m.getByText(/Entrar \/ Criar conta/).tap()
      const d = dialogo(page)
      await d.waitFor()
      await sleep(500)
      ok((await d.getByRole('tab', { name: 'Já tenho conta' }).getAttribute('aria-selected')) === 'true', `${nome}: pelo menu, abre em "Já tenho conta"`)
      await d.getByLabel('E-mail').fill(CONTA.email)
      await d.getByLabel('Senha', { exact: true }).fill('errada-123')
      await d.getByRole('button', { name: 'Entrar', exact: true }).tap()
      await d.locator('.sc-err').waitFor({ timeout: 10000 })
      const msg = (await d.locator('.sc-err').innerText()).trim()
      const f = await print(page, nome, 'entrar-senha-errada', { sub: SUB })
      ok(/senha/i.test(msg), `${nome}: senha errada → "${msg}"`, { print: f })
      ap.ignorar(/status of 401|status of 400/)
      await d.getByLabel('Senha', { exact: true }).fill(SENHA)
      await d.getByRole('button', { name: 'Entrar', exact: true }).tap()
      await semDialogo(page)
      await sleep(600)
      const t = await toasts(page)
      const fo = await print(page, nome, 'entrou', { sub: SUB })
      ok(t.some((x) => /Bem-vindo de volta/.test(x.titulo)), `${nome}: entrou (${JSON.stringify(t.map((x) => x.titulo))})`, { print: fo })
    })

    await passo('esqueci a senha (código colado + senha nova)', async () => {
      const m = await menu(page)
      await m.getByText('Sair', { exact: true }).tap()
      await sleep(1200)
      if (await page.getByRole('dialog', { name: 'Menu' }).count()) await page.keyboard.press('Escape')
      await sleep(400)
      const m2 = await menu(page)
      await m2.getByText(/Entrar \/ Criar conta/).tap()
      const d = dialogo(page)
      await d.waitFor()
      await d.getByRole('button', { name: 'Esqueci a senha' }).tap()
      await sleep(400)
      const fe = await print(page, nome, 'esqueci-a-senha', { sub: SUB })
      const { m: md } = await medirTela(page, `${nome}: Esqueci a senha`)
      pequenos(nome, 'Esqueci a senha', md, fe)
      const t0 = Date.now() - 1000
      await d.getByLabel('E-mail').fill(CONTA.email)
      await d.getByRole('button', { name: 'Enviar código' }).tap()
      await d.getByLabel('Código de 6 dígitos').waitFor({ timeout: 15000 })
      await sleep(500)
      const fc = await print(page, nome, 'esqueci-codigo-enviado', { sub: SUB })
      const codigo = await codigoDoEmail(CONTA.email, t0)
      ok(/^\d{6}$/.test(codigo ?? ''), `${nome}: o código de trocar a senha chegou (${codigo})`, { print: fc })
      const campo = d.getByLabel('Código de 6 dígitos')
      await campo.tap()
      await teclado(page, a, true)
      await sleep(450)
      const v = await campoVisivel(page)
      const fk = await print(page, nome, 'esqueci-codigo-teclado', { sub: SUB })
      ok(v.inteiro && !v.porCima, `${nome}: o código (trocar a senha) à vista com o teclado (${JSON.stringify(v)})`, { print: fk })
      await colar(page, codigo)
      await d.getByLabel('Nova senha').tap()
      await sleep(300)
      await page.keyboard.type('nova-senha-456')
      const vs = await campoVisivel(page)
      const b = await botaoVisivel(page, '[role="dialog"].sc-modal button[type="submit"]')
      const fs = await print(page, nome, 'esqueci-nova-senha-teclado', { sub: SUB })
      ok(vs.inteiro && !vs.porCima, `${nome}: "Nova senha" à vista com o teclado (${JSON.stringify(vs)})`, { print: fs })
      nota(`${nome}: "Trocar a senha e entrar" com o teclado aberto: ${JSON.stringify(b)}`, { print: fs })
      await teclado(page, a, false)
      await d.getByRole('button', { name: 'Trocar a senha e entrar' }).tap()
      await semDialogo(page)
      await sleep(600)
      const t = await toasts(page)
      const fo = await print(page, nome, 'esqueci-trocou-e-entrou', { sub: SUB })
      ok(t.some((x) => /Bem-vindo de volta/.test(x.titulo)), `${nome}: trocou a senha e entrou (${JSON.stringify(t.map((x) => x.titulo))})`, { print: fo })
      CONTA.senha = 'nova-senha-456'
    })

    await passo('excluir a conta', async () => {
      const m = await menu(page)
      await m.getByText('Excluir conta', { exact: true }).tap()
      const d = dialogo(page, 'Minha conta')
      await d.waitFor()
      await sleep(1500)
      const campo = d.getByLabel('Sua senha')
      const dx = await painelDeslocado(page)
      ok(dx.scrollTop === 0, `${nome}: "Excluir conta" do menu abre Minha conta com o cabeçalho (título e Fechar) à vista — o painel rolou ${dx.scrollTop}px e sobram ${dx.vazioEmbaixo}px vazios embaixo`)
      const foco = await page.evaluate(() => document.activeElement?.id)
      const idCampo = await campo.getAttribute('id')
      const f = await print(page, nome, 'excluir-conta-aberto', { sub: SUB })
      const bb = await campo.boundingBox()
      ok(bb && bb.y >= 0 && bb.y + bb.height <= a.h, `${nome}: "Excluir conta" do menu abre Minha conta já na senha (campo em ${bb ? Math.round(bb.y) : '?'} de ${a.h}; foco no campo: ${foco === idCampo})`, { print: f })
      await campo.tap()
      await teclado(page, a, true)
      await sleep(450)
      const v = await campoVisivel(page)
      const b = await botaoVisivel(page, '[role="dialog"].sc-modal .sc-confirm button[type="submit"]')
      const fk = await print(page, nome, 'excluir-conta-teclado', { sub: SUB })
      ok(v.inteiro && !v.porCima, `${nome}: senha do excluir à vista com o teclado (${JSON.stringify(v)})`, { print: fk })
      ok(b?.visivel, `${nome}: "Excluir para sempre" à vista com o teclado (${JSON.stringify(b)})`, { print: fk })
      await page.keyboard.type('errada-000')
      await teclado(page, a, false)
      await d.getByRole('button', { name: 'Excluir para sempre' }).tap()
      await d.locator('.sc-confirm .sc-err').waitFor({ timeout: 10000 })
      const msg = (await d.locator('.sc-confirm .sc-err').innerText()).trim()
      const fe = await print(page, nome, 'excluir-conta-senha-errada', { sub: SUB })
      ok(/senha/i.test(msg), `${nome}: excluir com senha errada → "${msg}"`, { print: fe })
      ap.ignorar(/status of 401|status of 400|status of 403/)
      await campo.fill(CONTA.senha)
      await d.getByRole('button', { name: 'Excluir para sempre' }).tap()
      await semDialogo(page)
      await sleep(800)
      const t = await toasts(page)
      const fo = await print(page, nome, 'conta-excluida', { sub: SUB })
      ok(t.some((x) => /excluída/i.test(x.titulo)) && sql(`SELECT COUNT(*) FROM usuarios WHERE id=${CONTA.id}`) === '0', `${nome}: conta excluída (${JSON.stringify(t.map((x) => x.titulo))}; rota ${await rota(page)})`, { print: fo })
      const hall = await page.evaluate(() => document.querySelectorAll('.ld-modes').length)
      void hall
    })
    ok(!ap.erros.length, `${nome}: sem erro no console no fluxo inteiro`, { erros: ap.erros.slice(0, 8) })
    if (ap.erros.length) console.log(ap.erros.slice(0, 8))
  } finally {
    await ap.ctx.close()
  }
})

/** Uma conta com 2 carreiras salvas (para as telas): criada e jogada no Pixel 7 (rápido, sem animações). */
async function contaComCarreiras() {
  const ap = await novoAparelho(browser, 'pixel-7', { ajustes: AJUSTES_RAPIDOS })
  try {
    await home(ap.page)
    const c = await contaPelaApi(ap.page, 'Bia Telas', email('telas'), SENHA)
    await ap.page.reload()
    await ap.page.waitForSelector('.ld-modes', { timeout: 60000 })
    for (const s of ['TELAUM', 'TELADOIS']) {
      await jogarCelular(ap.page, s)
      await sleep(1000)
      const b = ap.page.getByRole('button', { name: 'Salvar na minha conta' })
      if (await b.count()) {
        await b.first().click()
        await ap.page.locator('.sc-saved').first().waitFor({ timeout: 15000 })
      }
    }
    // o cookie da sessão: os outros aparelhos entram com ele (o servidor aceita 5 "entrar" por e-mail a cada 10 min)
    c.cookies = await ap.ctx.cookies()
    return c
  } finally {
    await ap.ctx.close()
  }
}

// ───────────────────────── telas ─────────────────────────
await etapa('telas', async () => {
  const c = await contaComCarreiras()
  console.log(`      conta ${c.email} com ${sql(`SELECT COUNT(*) FROM carreiras WHERE usuario_id=${c.id}`)} carreiras`)
  for (const nome of LISTA) {
    const ap = await novoAparelho(browser, nome)
    const { page } = ap
    try {
      await ap.ctx.addCookies(c.cookies)
      await home(page)
      await page.reload()
      await page.waitForSelector('.ld-modes, .lx-topbar', { timeout: 60000 })
      await sleep(1500)
      const telas = [
        ['menu', async () => menu(page), '[role="dialog"]'],
        ['minha-conta-topo', async () => (await menu(page)).locator('.sc-me').tap(), null],
        ['minha-conta-fim', async () => {
          await dialogo(page, 'Minha conta').locator('.lx-dialog__body').evaluate((b) => b.scrollTo(0, b.scrollHeight))
          await sleep(500)
        }, null],
        ['minhas-carreiras', async () => {
          await page.keyboard.press('Escape')
          await semDialogo(page).catch(() => {})
          await (await menu(page)).getByText('Minhas carreiras', { exact: true }).tap()
          await dialogo(page, 'Minhas carreiras').locator('.sc-card').first().waitFor({ timeout: 15000 })
        }, null],
        ['fale-conosco', async () => {
          await page.keyboard.press('Escape')
          await semDialogo(page).catch(() => {})
          await (await menu(page)).getByText('Fale conosco', { exact: true }).tap()
          await dialogo(page, 'Fale conosco').waitFor()
          await page.evaluate(() => document.activeElement?.blur?.())
        }, null],
      ]
      for (const [tela, abrirTela, raiz] of telas) {
        await abrirTela()
        await sleep(1000)
        const f = await print(page, nome, tela, { sub: `${SUB}/telas` })
        const { m, desloc } = await medirTela(page, `${nome}: ${tela}`, raiz ? { raiz } : {})
        ok(m.lateral <= 0, `${nome}: ${tela} sem rolagem lateral (${m.lateral}px)`, { print: f })
        // abas e seletores que não cabem: a lista de abas rola de lado (sem barra) e a última aparece cortada
        const abas = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] .lx-tabs, [role="dialog"] [role="radiogroup"]')].map((t) => ({ rot: t.getAttribute('aria-label'), sw: t.scrollWidth, cw: t.clientWidth, duasLinhas: [...t.querySelectorAll('.lx-seg__label, .lx-tabs__label')].filter((l) => l.getBoundingClientRect().height > parseFloat(getComputedStyle(l).lineHeight || '20') * 1.5).map((l) => l.textContent.trim()) })))
        for (const t of abas) {
          if (t.sw > t.cw + 1) ok(false, `${nome}: ${tela}: as abas "${t.rot}" não cabem (${t.sw}px numa faixa de ${t.cw}px) — a última aparece cortada`, { print: f })
          if (t.duasLinhas.length) ok(false, `${nome}: ${tela}: no seletor "${t.rot}" o texto quebra em duas linhas: ${t.duasLinhas.join(', ')}`, { print: f })
        }
        if (desloc) ok(desloc.scrollTop === 0, `${nome}: ${tela}: o painel do diálogo não rola junto (cabeçalho com o Fechar à vista) — scrollTop ${desloc.scrollTop}px, ${desloc.vazioEmbaixo}px vazios embaixo`, { print: f })
        const cort = m.cortados.filter((x) => !x.reticencias)
        ok(!cort.length, `${nome}: ${tela} sem texto cortado${cort.length ? `: ${cort.map((x) => `"${x.texto}"`).join(', ')}` : ''}`, { print: f, cortados: cort })
        pequenos(nome, tela, m, f)
        if (tela === 'menu') await page.keyboard.press('Escape')
      }
      ok(!ap.erros.length, `${nome}: sem erro no console nas telas da conta`, { erros: ap.erros.slice(0, 5) })
    } catch (e) {
      ok(false, `${nome}: telas travou — ${e.message.split('\n')[0]}`)
    } finally {
      await ap.ctx.close()
    }
  }
  CONTA = CONTA ?? c
  CONTA.telas = c
})

// ───────────────────────── apps ─────────────────────────
await etapa('apps', async () => {
  for (const [nome, clipboard] of [
    ['tiktok-android', 'ok'],
    ['instagram-android', 'negado'],
    ['whatsapp-android', 'ok'],
    ['tiktok-ios', 'negado'],
    ['instagram-ios', 'ok'],
  ]) {
    const ap = await novoAparelho(browser, nome, { clipboard })
    const { page } = ap
    try {
      await home(page)
      await contaPelaApi(page, `App ${nome.split('-')[0]}`, email(nome.replace(/-/g, '')), SENHA)
      await page.reload()
      await page.waitForSelector('.ld-modes, .lx-topbar', { timeout: 60000 })
      await sleep(1200)
      const temShare = await page.evaluate(() => typeof navigator.share === 'function')
      const m = await menu(page)
      const convidar = m.getByText('Convide amigos', { exact: true })
      if (await convidar.count()) await convidar.tap()
      else await m.locator('.sc-me').tap()
      const d = dialogo(page, 'Minha conta')
      await d.waitFor()
      const conv = d.locator('.sc-conv')
      await conv.locator('input').waitFor({ timeout: 10000 })
      await sleep(1500)
      const link = await conv.locator('input').inputValue()
      const f0 = await print(page, nome, `convide-amigos-clipboard-${clipboard}`, { sub: `${SUB}/apps` })
      const vis = await conv.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return { top: Math.round(r.top), janela: innerHeight }
      })
      ok(vis.top >= 0 && vis.top < vis.janela, `${nome}: o atalho "Convide amigos" abre Minha conta já no cartão do convite (topo em ${vis.top}px)`, { print: f0 })
      const dx = await painelDeslocado(page)
      ok(dx.scrollTop === 0, `${nome}: o atalho "Convide amigos" não rola o painel (cabeçalho e Fechar à vista) — scrollTop ${dx.scrollTop}px, ${dx.vazioEmbaixo}px vazios embaixo`, { print: f0 })
      // Compartilhar
      await conv.getByRole('button', { name: 'Compartilhar' }).tap()
      await sleep(700)
      const rotCopiar = (await conv.getByRole('button', { name: /^(Copiar|Copiado)$/ }).innerText()).trim()
      const t1 = await toasts(page)
      const f1 = await print(page, nome, `convide-amigos-tocou-compartilhar-clipboard-${clipboard}`, { sub: `${SUB}/apps` })
      const copiou = await page.evaluate(() => window.__copiado ?? [])
      console.log(`      ${nome} (share: ${temShare}, clipboard ${clipboard}): botão Copiar = "${rotCopiar}", toasts ${JSON.stringify(t1)}, clipboard ${JSON.stringify(copiou)}`)
      if (!temShare) {
        const toastNoCompartilhar = t1.find((x) => /link|copiad|compartilh/i.test(`${x.titulo} ${x.desc}`))
        ok(!!toastNoCompartilhar, `${nome}: sem o compartilhar do sistema (WebView), tocar em "Compartilhar" avisa o que aconteceu na própria tela (o link foi copiado / copie o link) — hoje: botão "Copiar" vira "${rotCopiar}", avisos ${JSON.stringify(t1.map((x) => x.titulo))}`, { print: f1 })
      }
      for (const x of t1) if (x.descCortada) ok(false, `${nome}: o aviso "${x.titulo}" corta o link no celular ("${x.desc}") — a pessoa não consegue ler nem copiar o link inteiro dele`, { print: f1 })
      // Copiar
      await sleep(2500)
      await conv.getByRole('button', { name: /^(Copiar|Copiado)$/ }).tap()
      await sleep(600)
      const t2 = await toasts(page)
      const f2 = await print(page, nome, `convide-amigos-tocou-copiar-clipboard-${clipboard}`, { sub: `${SUB}/apps` })
      if (clipboard === 'negado') {
        const aviso = t2.find((x) => /Copie o link/.test(x.titulo))
        ok(!!aviso && !aviso.descCortada, `${nome}: com o clipboard negado, "Copiar" mostra o link para copiar à mão, inteiro (${JSON.stringify(aviso)})`, { print: f2 })
        // o campo do link: tocar seleciona tudo?
        await conv.locator('input').tap()
        await sleep(300)
        const sel = await conv.locator('input').evaluate((el) => [el.selectionStart, el.selectionEnd, el.value.length])
        nota(`${nome}: tocar no campo do link seleciona ${sel[1] - sel[0]} de ${sel[2]} letras (o menu "Copiar" do sistema aparece por cima)`, { print: f2 })
      } else ok((await page.evaluate(() => window.__copiado.at(-1)?.t)) === link, `${nome}: "Copiar" copia o link (${link})`, { print: f2 })
      ok(!ap.erros.length, `${nome}: sem erro no console (convite)`, { erros: ap.erros.slice(0, 5) })
    } catch (e) {
      ok(false, `${nome}: apps travou — ${e.message.split('\n')[0]}`)
    } finally {
      await ap.ctx.close()
    }
  }
})

await browser.close()
process.exit(fim('gestao') ? 1 : 0)
