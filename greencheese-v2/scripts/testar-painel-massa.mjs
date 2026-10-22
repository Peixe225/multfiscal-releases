// Classificar em massa por estado (pedido do Ian em 22/10), no navegador e contra o servidor de verdade (roda dentro do
// scripts/testar-painel.mjs, com a página dele já logada como dono, num celular 390×844): Produtos → "Selecionar
// vários" vira a lista em caixas de marcar (o toque marca, não abre o produto), "Marcar todos os N da lista" respeita o
// filtro (categoria, busca), "Mudar nos estados" abre a folha (estados, o que fazer), a confirmação curta com o resumo
// ("4 produtos · RJ e SP · tirar de venda"), um pedido só pro servidor, o recado com "Desfazer" (volta exatamente como
// estava), contar o estoque, copiar de outro estado, as conferências da folha (sem estado, sem número), o teclado (Tab,
// Espaço e Enter, sem mouse) no computador e o celular de 360×740 (sem rolagem lateral, a barra e a folha cabem). Cada
// passo é conferido no admin-loja (o que o painel guarda) e no GET loja (o que o site lê).
// Revisão de 22/10: o teclado vai só por Tab, setas e Enter (sem .focus() em cada botão) e confere onde o foco cai
// (entrar e sair da seleção, o "Confere antes" e o "Voltar e mudar"; dois Enter não ficam indo e voltando); o produto
// apagado noutro aparelho com a confirmação aberta (a lista é relida e a nova tentativa passa) e antes do Desfazer (o
// resto volta e o recado diz); a caixa de cada produto lida uma vez só pelo leitor de tela.

export async function fluxoMassa({ p, BASE, ok, print, axe, novoContexto, entrar }) {
  const admin = async (pg = p) => (await pg.evaluate(async () => (await (await fetch('../api/index.php?r=admin-loja', { credentials: 'same-origin' })).json()).loja))
  const site = async () => (await (await fetch(`${BASE}/api/index.php?r=loja`)).json()).loja
  const esperar = async (cond, ms = 10000) => {
    const fim = Date.now() + ms
    while (Date.now() < fim) {
      if (await cond().catch(() => false)) return true
      await new Promise((r) => setTimeout(r, 150))
    }
    return false
  }
  const estadosDe = (l, ids, ufs) => Object.fromEntries(ids.map((id) => [id, Object.fromEntries(ufs.map((u) => [u, l.produtos.find((x) => x.id === id)?.estados[u] ?? { disponivel: false, estoque: null }]))]))
  let pedidos = 0
  p.on('request', (r) => r.url().includes('admin-produtos-em-massa') && r.method() === 'POST' && pedidos++)

  await p.goto(`${BASE}/painel/#/produtos`)
  await p.getByRole('heading', { name: 'Produtos', level: 1 }).waitFor()
  await p.getByRole('button', { name: 'Todos', exact: true }).first().tap()
  const entrarSel = p.getByRole('button', { name: 'Selecionar vários' })
  ok((await entrarSel.count()) === 1, 'Produtos: o "Selecionar vários" em cima da lista')
  await entrarSel.tap()
  const caixas = p.locator('.pn-lista-prod input[type="checkbox"]')
  await caixas.first().waitFor()
  const nLista = await p.locator('.pn-lista-prod > li').count()
  ok((await caixas.count()) === nLista && (await p.locator('.pn-lista-prod .pn-chip-est:is(button)').count()) === 0, `Selecionar: cada linha vira uma caixa de marcar e os chips só mostram como está (${nLista} linhas)`)
  // o leitor de tela lê o como está em cada estado uma vez: no nome da caixa, sem repetir na descrição (revisão de 22/10)
  const leitura = await caixas.evaluateAll((xs) => xs.map((x) => ({ desc: x.getAttribute('aria-describedby'), nome: x.closest('label')?.textContent?.replace(/\s+/g, ' ') ?? '' })))
  ok(leitura.every((x) => !x.desc && (x.nome.match(/RJ: /g) ?? []).length === 1), `Selecionar: a caixa diz os estados uma vez só, no nome (sem aria-describedby repetindo) (${JSON.stringify(leitura[0])})`)
  // o toque na linha marca (não abre o produto)
  const url0 = p.url()
  await p.locator('.pn-lista-prod > li').first().locator('label').tap()
  ok(p.url() === url0 && (await caixas.first().isChecked()), 'Selecionar: tocar na linha marca, sem abrir o produto')
  ok(/1 marcado/.test(await p.locator('.pn-sel-conta').innerText()), 'a barra de baixo conta 1 marcado')
  await p.locator('.pn-lista-prod > li').first().locator('label').tap()
  ok(!(await caixas.first().isChecked()) && /Nenhum marcado/.test(await p.locator('.pn-sel-conta').innerText()), 'tocar de novo desmarca (e "Mudar nos estados" fica sem nada)')
  ok(await p.getByRole('button', { name: 'Mudar nos estados' }).isDisabled(), '"Mudar nos estados" desligado sem nada marcado')

  // o filtro: só as sedas; "Marcar todos os N da lista" marca as N (e só elas)
  await p.locator('.pn-filtros-cat').getByRole('button', { name: /^Sedas/ }).tap()
  await p.waitForTimeout(300)
  const nSedas = await p.locator('.pn-lista-prod > li').count()
  const todos = p.getByRole('button', { name: `Marcar todos os ${nSedas} da lista` })
  ok((await todos.count()) === 1, `com o filtro, "Marcar todos os ${nSedas} da lista"`)
  await todos.tap()
  ok((await p.locator('.pn-lista-prod input[type="checkbox"]:checked').count()) === nSedas && new RegExp(`${nSedas} marcados`).test(await p.locator('.pn-sel-conta').innerText()), `marcou as ${nSedas} sedas`)
  await axe(p, 'produtos selecionando')
  await print(p, 'massa-390-selecionando')
  // o id de cada caixa: o data-id (desde a revisão de 22/10; antes ele vinha no aria-describedby, que lia os estados duas
  // vezes) — os dois, pra que este teste rode igual no código de antes e mostre lá só as falhas que são dele
  const idsMarcados = () => p.locator('.pn-lista-prod > li input[type="checkbox"]:checked').evaluateAll((xs) => xs.map((x) => x.dataset.id || x.getAttribute('aria-describedby')?.replace(/^sel-/, '')))
  const ids = await idsMarcados()
  const ufs = ['rj', 'sp']
  const antes = estadosDe(await admin(), ids, ufs)

  // a folha: sem estado, avisa; escolhe RJ e SP e "Tirar de venda"; a confirmação curta com o resumo
  await p.getByRole('button', { name: 'Mudar nos estados' }).tap()
  const folha = p.getByRole('dialog', { name: `Mudar ${nSedas} produtos` })
  await folha.waitFor()
  await folha.getByRole('button', { name: 'Continuar' }).tap()
  ok(/Escolhe pelo menos um estado/.test(await folha.innerText()), 'folha: sem estado, pede o estado')
  await folha.getByRole('button', { name: 'Rio de Janeiro' }).tap()
  await folha.getByRole('button', { name: 'São Paulo' }).tap()
  await folha.getByRole('button', { name: 'Continuar' }).tap()
  ok(/Escolhe o que fazer/.test(await folha.innerText()), 'folha: sem ação, pede o que fazer')
  await folha.getByText('Tirar de venda', { exact: true }).tap()
  await axe(p, 'folha em massa')
  await print(p, 'massa-390-folha')
  await folha.getByRole('button', { name: 'Continuar' }).tap()
  const conf = p.getByRole('alertdialog', { name: 'Confere antes' })
  await conf.waitFor()
  const resumo = (await conf.locator('.pn-massa-resumo').innerText()).trim()
  ok(resumo === `${nSedas} produtos · RJ e SP · tirar de venda`, `confirmação curta com o resumo ("${resumo}")`)
  await print(p, 'massa-390-confirmar')
  const n0 = pedidos
  await conf.getByRole('button', { name: 'Tirar de venda', exact: true }).tap()
  await conf.waitFor({ state: 'detached' })
  const r1 = p.locator('.pn-recados')
  await r1.getByText(new RegExp(`fora de venda em RJ e SP`)).waitFor()
  ok(pedidos - n0 === 1, `um pedido só pro servidor (${pedidos - n0})`)
  ok(await esperar(async () => {
    const s = await site()
    return ids.every((id) => s.produtos.find((x) => x.id === id)?.disponivel.rj === false && s.produtos.find((x) => x.id === id)?.disponivel.sp === false)
  }), 'o site vê as sedas fora de venda em RJ e SP')
  ok(/RJ/.test(await p.locator('.pn-lista-prod').innerText()) && (await p.locator('.pn-lista-prod input[type="checkbox"]:checked').count()) === nSedas, 'a lista atualiza e os marcados continuam marcados (dá pra fazer a próxima)')
  const cobre = async (pg) => {
    const a = await pg.locator('.pn-recado').boundingBox()
    const b = await pg.locator('.pn-sel-pe').boundingBox()
    return !a || !b ? 'sem caixa' : a.y + a.height <= b.y + 1 ? '' : `recado até ${Math.round(a.y + a.height)}, barra a partir de ${Math.round(b.y)}`
  }
  const c390 = await cobre(p)
  ok(c390 === '', `390: o recado fica em cima da barra dos marcados, sem cobrir o "Mudar nos estados" ${c390}`)
  await print(p, 'massa-390-recado')
  await r1.getByRole('button', { name: 'Desfazer' }).tap()
  await r1.getByText(/Desfeito/).waitFor()
  ok(await esperar(async () => JSON.stringify(estadosDe(await admin(), ids, ufs)) === JSON.stringify(antes)), '"Desfazer": cada seda volta exatamente como estava em RJ e SP')

  // contar o estoque: o número é pedido; 12 em ES
  await p.getByRole('button', { name: 'Mudar nos estados' }).tap()
  await folha.waitFor()
  await folha.getByRole('button', { name: 'Espírito Santo' }).tap()
  await folha.getByText('Contar o estoque', { exact: true }).tap()
  await folha.getByRole('button', { name: 'Continuar' }).tap()
  ok(/Põe quantas unidades/.test(await folha.innerText()), 'contar sem número: pede o número')
  await folha.getByLabel('Unidades').fill('12')
  await folha.getByRole('button', { name: 'Continuar' }).tap()
  await conf.waitFor()
  ok((await conf.locator('.pn-massa-resumo').innerText()).trim() === `${nSedas} produtos · ES · 12 no estoque`, 'contar: o resumo diz o número')
  await conf.getByRole('button', { name: 'Contar 12', exact: true }).tap()
  await conf.waitFor({ state: 'detached' })
  ok(await esperar(async () => {
    const e = estadosDe(await admin(), ids, ['es'])
    return ids.every((id) => e[id].es.estoque === 12)
  }), 'contar: 12 no estoque de ES em cada seda')

  // copiar de MG pra ES
  await p.getByRole('button', { name: 'Mudar nos estados' }).tap()
  await folha.waitFor()
  await folha.getByRole('button', { name: 'Espírito Santo' }).tap()
  await folha.getByText('Copiar de outro estado', { exact: true }).tap()
  await folha.getByRole('button', { name: 'Copiar de Minas Gerais' }).tap()
  await folha.getByRole('button', { name: 'Continuar' }).tap()
  await conf.waitFor()
  await conf.getByRole('button', { name: 'Copiar de MG', exact: true }).tap()
  await conf.waitFor({ state: 'detached' })
  ok(await esperar(async () => {
    const e = estadosDe(await admin(), ids, ['mg', 'es'])
    return ids.every((id) => JSON.stringify(e[id].es) === JSON.stringify(e[id].mg))
  }), 'copiar: ES fica igual a MG em cada seda')
  // a Atividade diz o que foi feito
  const ev = await p.evaluate(async () => (await (await fetch('../api/index.php?r=admin-eventos', { credentials: 'same-origin' })).json()).eventos)
  ok(ev.some((e) => e.acao === 'produtos-em-massa' && /^Em massa: copiou MG pra ES/.test(e.texto)), 'a Atividade: "Em massa: copiou MG pra ES (…)"')

  // revisão de 22/10: produto apagado noutro aparelho. Com a confirmação aberta: o erro relê a lista (ele sai dos
  // marcados, o resumo conta sem ele) e a nova tentativa passa. Entre a mudança e o Desfazer: o resto volta e o recado diz.
  {
    const post = (rota, corpo) =>
      p.evaluate(
        async ([r, c]) => {
          const csrf = (await (await fetch('../api/index.php?r=admin-sessao', { credentials: 'same-origin' })).json()).csrf
          const x = await fetch(`../api/index.php?r=${r}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf }, body: JSON.stringify(c), credentials: 'same-origin' })
          return { status: x.status, json: await x.json().catch(() => null) }
        },
        [rota, corpo],
      )
    const novo = async (nome) => (await post('admin-produto-salvar', { nome, tamanho: '', categoria: 'sedas', preco: 10, ativo: true, arte: { tipo: 'lata', corpo: '#00aa55' }, cor: '#00aa55' })).json?.produto?.id ?? null
    const idA = await novo('Seda apagada no meio')
    const idB = await novo('Seda apagada antes do desfazer')
    // à venda no RJ (o produto novo nasce fora de venda): o "tirar de venda" muda os dois, e o Desfazer tem o que pular
    const noRj = [await post('admin-produto-estado', { id: idA, uf: 'rj', disponivel: true }), await post('admin-produto-estado', { id: idB, uf: 'rj', disponivel: true })]
    ok(!!idA && !!idB && noRj.every((r) => r.status === 200 && r.json?.produto?.estados?.rj?.disponivel === true), `dois produtos novos nas sedas, à venda no RJ, pra apagar no meio (${idA}, ${idB})`)
    // a lista relê a loja de minuto em minuto: recarrega pra ver os dois (a seleção começa de novo)
    await p.reload()
    await p.getByRole('heading', { name: 'Produtos', level: 1 }).waitFor()
    await p.getByRole('button', { name: 'Selecionar vários' }).tap()
    await caixas.first().waitFor()
    await p.locator('.pn-filtros-cat').getByRole('button', { name: /^Sedas/ }).tap()
    await p.waitForTimeout(300)
    const n2 = await p.locator('.pn-lista-prod > li').count()
    await p.getByRole('button', { name: `Marcar todos os ${n2} da lista` }).tap()
    const ids2 = await idsMarcados()
    ok(ids2.includes(idA) && ids2.includes(idB), `os ${n2} marcados têm os dois novos`)
    const antes2 = estadosDe(await admin(), ids2, ['rj'])
    await p.getByRole('button', { name: 'Mudar nos estados' }).tap()
    const f2 = p.getByRole('dialog', { name: `Mudar ${n2} produtos` })
    await f2.waitFor()
    await f2.getByRole('button', { name: 'Rio de Janeiro' }).tap()
    await f2.getByText('Tirar de venda', { exact: true }).tap()
    await f2.getByRole('button', { name: 'Continuar' }).tap()
    await conf.waitFor()
    ok((await post('admin-produto-apagar', { id: idA })).status === 200, 'apagou um deles noutro aparelho, com a confirmação aberta')
    await conf.getByRole('button', { name: 'Tirar de venda', exact: true }).tap()
    await conf.getByText(/apagado noutro aparelho/).waitFor().catch(() => {})
    const leu = await esperar(async () => (await conf.locator('.pn-massa-resumo').innerText()).trim() === `${n2 - 1} produtos · RJ · tirar de venda`, 6000)
    ok(leu && /apagado noutro aparelho/.test(await conf.innerText()), `apagado com a confirmação aberta: o aviso diz e o resumo já conta sem ele (a lista foi relida) ("${(await conf.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}")`)
    await print(p, 'massa-390-apagado-no-meio')
    await conf.getByRole('button', { name: 'Tirar de venda', exact: true }).tap()
    const passou = await conf.waitFor({ state: 'detached', timeout: 6000 }).then(() => true).catch(() => false)
    ok(passou && (await r1.getByText(/fora de venda em RJ/).count()) > 0, 'a nova tentativa passa (sem recarregar a página)')
    ok((await p.locator('.pn-lista-prod').getByText('Seda apagada no meio').count()) === 0 && (await p.locator('.pn-lista-prod input[type="checkbox"]:checked').count()) === n2 - 1, 'o apagado saiu da lista e dos marcados; os outros seguem marcados')
    if (!passou) await p.keyboard.press('Escape')
    // o Desfazer com outro apagado no meio: os outros voltam, e o recado conta o que foi apagado
    ok((await post('admin-produto-apagar', { id: idB })).status === 200, 'apagou outro noutro aparelho, antes do Desfazer')
    const desf = r1.getByRole('button', { name: 'Desfazer' })
    if (await desf.count()) await desf.last().tap()
    const txtD = await r1
      .getByText(/Desfeito|Não deu pra desfazer/)
      .last()
      .innerText()
      .catch(() => '')
    ok(/^Desfeito: .*\(1 foi apagado noutro aparelho\)\.$/.test(txtD.trim()), `Desfazer com um apagado no meio: o recado diz ("${txtD.trim()}")`)
    const resto = ids2.filter((id) => id !== idA && id !== idB)
    ok(await esperar(async () => {
      const e = estadosDe(await admin(), resto, ['rj'])
      return resto.every((id) => JSON.stringify(e[id].rj) === JSON.stringify(antes2[id].rj))
    }), `Desfazer com um apagado no meio: os outros ${resto.length} voltam como estavam em RJ`)
    await print(p, 'massa-390-desfeito-apagado')
  }

  // volta ES como estava antes (Desfazer do copiar e do contar, pela API, pra não mexer no resto do teste)
  await p.getByRole('button', { name: 'Sair da seleção' }).tap()
  ok((await p.locator('.pn-lista-prod input[type="checkbox"]').count()) === 0 && (await p.getByRole('button', { name: 'Selecionar vários' }).count()) === 1, 'Sair da seleção: a lista volta com a troca rápida')

  // teclado, no computador: Tab, setas, Espaço e Enter, sem mouse e sem .focus() no meio do caminho (só no começo); onde
  // o foco cai depois de cada Enter (revisão de 22/10: caía no <body> ao entrar e sair da seleção, e no "Voltar e mudar"
  // depois do "Continuar", e dois Enter ficavam indo e voltando)
  {
    const c = await novoContexto(1280, 800, false)
    const t = await c.newPage()
    await entrar(t)
    await t.goto(`${BASE}/painel/#/produtos`)
    await t.getByRole('heading', { name: 'Produtos', level: 1 }).waitFor()
    const foco = () =>
      t.evaluate(() => {
        const a = document.activeElement
        const d = a?.closest('[role="dialog"], [role="alertdialog"]')
        return {
          tag: a?.tagName.toLowerCase() ?? '',
          tipo: a?.getAttribute('type') ?? '',
          nome: (a?.getAttribute('aria-label') || a?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          dialogo: d ? `${d.getAttribute('role')}: ${d.querySelector('.pn-folha-titulo')?.textContent?.trim()}` : '',
        }
      })
    /** Tab (ou Shift+Tab) até o foco chegar no que `achou` quer, no máximo `max` vezes. */
    const tabAte = async (achou, max = 60, tecla = 'Tab') => {
      for (let i = 0; i < max; i++) {
        const f = await foco()
        if (achou(f)) return f
        await t.keyboard.press(tecla)
      }
      return foco()
    }
    await t.getByRole('button', { name: 'Selecionar vários' }).focus()
    await t.keyboard.press('Enter')
    const primeira = t.locator('.pn-lista-prod input[type="checkbox"]').first()
    await primeira.waitFor()
    let f = await foco()
    ok(/^Marcar todos os \d+ da lista$/.test(f.nome), `teclado: Enter no "Selecionar vários" leva o foco pro "Marcar todos" (${JSON.stringify(f)})`)
    f = await tabAte((x) => x.tipo === 'checkbox')
    await t.keyboard.press('Space')
    ok(f.tipo === 'checkbox' && (await primeira.isChecked()), 'teclado: Tab chega na primeira caixa e o Espaço marca')
    const id1 = (await primeira.getAttribute('data-id')) || (await primeira.getAttribute('aria-describedby'))?.replace(/^sel-/, '')
    const antesT = estadosDe(await admin(t), [id1], ['sc'])
    f = await tabAte((x) => x.nome === 'Mudar nos estados')
    await t.keyboard.press('Enter')
    const fo = t.getByRole('dialog', { name: 'Mudar 1 produto' })
    await fo.waitFor()
    f = await tabAte((x) => x.nome === 'Santa Catarina')
    await t.keyboard.press('Enter')
    // o grupo de opções: Tab entra no primeiro, as setas escolhem (Pôr à venda → Tirar de venda → Esgotado)
    f = await tabAte((x) => x.tipo === 'radio')
    await t.keyboard.press('ArrowDown')
    await t.keyboard.press('ArrowDown')
    ok(await fo.getByRole('radio', { name: /Esgotado/ }).isChecked(), 'teclado: Tab chega nas opções e as setas escolhem "Esgotado"')
    f = await tabAte((x) => x.nome === 'Continuar')
    await t.keyboard.press('Enter')
    const cf = t.getByRole('alertdialog', { name: 'Confere antes' })
    await cf.waitFor()
    f = await foco()
    ok(f.tag === 'h2' && f.dialogo === 'alertdialog: Confere antes', `teclado: depois do "Continuar", o foco vai pro título "Confere antes" (o leitor de tela lê o passo novo) (${JSON.stringify(f)})`)
    await print(t, 'massa-1280-confere-foco')
    // um segundo Enter não volta pra escolha (antes caía no "Voltar e mudar")
    await t.keyboard.press('Enter')
    await t.waitForTimeout(300)
    ok((await cf.count()) === 1, `teclado: um segundo Enter não volta pra escolha (${JSON.stringify(await foco())})`)
    f = await tabAte((x) => x.nome === 'Voltar e mudar')
    await t.keyboard.press('Enter')
    await fo.waitFor()
    f = await foco()
    ok(f.nome === 'Continuar' && f.dialogo === 'dialog: Mudar 1 produto', `teclado: "Voltar e mudar" volta com o foco no "Continuar" (${JSON.stringify(f)})`)
    await t.keyboard.press('Enter')
    await cf.waitFor()
    f = await tabAte((x) => x.nome === 'Marcar esgotado')
    await t.keyboard.press('Enter')
    await cf.waitFor({ state: 'detached' })
    ok(await esperar(async () => {
      const e = estadosDe(await admin(t), [id1], ['sc'])[id1].sc
      return e.disponivel === true && e.estoque === 0
    }), 'teclado: Tab/setas/Espaço/Enter fazem o caminho inteiro (esgotado em SC)')
    const txt1280 = await t.locator('.pn-recado').innerText()
    ok(/1 produto esgotado em SC/.test(txt1280), `1280: o recado no singular com 1 produto ("${txt1280.replace(/\s+/g, ' ')}")`)
    const c1280 = await cobre(t)
    ok(c1280 === '', `1280: o recado fica em cima da barra dos marcados ${c1280}`)
    await print(t, 'massa-1280-recado')
    await t.locator('.pn-recados').getByRole('button', { name: 'Desfazer' }).focus()
    await t.keyboard.press('Enter')
    ok(await esperar(async () => JSON.stringify(estadosDe(await admin(t), [id1], ['sc'])) === JSON.stringify(antesT)), 'teclado: o Desfazer pelo Enter volta como estava')
    // sair da seleção: o foco volta pro "Selecionar vários"
    f = await tabAte((x) => x.nome === 'Sair da seleção', 80, 'Shift+Tab')
    await t.keyboard.press('Enter')
    await primeira.waitFor({ state: 'detached' })
    f = await foco()
    ok(f.nome === 'Selecionar vários', `teclado: Enter no "Sair da seleção" volta o foco pro "Selecionar vários" (${JSON.stringify(f)})`)
    await c.close()
  }

  // 360×740: sem rolagem lateral, a barra de baixo e a folha cabem, os alvos de 44 px
  {
    const c = await novoContexto(360, 740)
    const q = await c.newPage()
    await entrar(q)
    await q.goto(`${BASE}/painel/#/produtos`)
    await q.getByRole('heading', { name: 'Produtos', level: 1 }).waitFor()
    await q.getByRole('button', { name: 'Selecionar vários' }).tap()
    await q.locator('.pn-lista-prod input[type="checkbox"]').first().waitFor()
    await q.locator('.pn-lista-prod > li').nth(1).locator('label').tap()
    await q.locator('.pn-lista-prod > li').nth(2).locator('label').tap()
    const g = await q.evaluate(() => {
      const pe = document.querySelector('.pn-sel-pe')?.getBoundingClientRect()
      // a barra de baixo do painel não cobre o "Mudar nos estados"
      const barra = document.querySelector('.pn-barra')?.getBoundingClientRect()
      const linhas = [...document.querySelectorAll('.pn-sel-linha')].slice(0, 5).map((l) => Math.round(l.getBoundingClientRect().height))
      const botao = [...document.querySelectorAll('.pn-sel-pe button')].map((b) => Math.round(b.getBoundingClientRect().height))
      return { lateral: document.documentElement.scrollWidth > innerWidth + 0.5, pe: pe ? { b: Math.round(pe.bottom), l: pe.left, r: pe.right } : null, barra: barra ? Math.round(barra.top) : null, h: innerHeight, w: innerWidth, linhas, botao }
    })
    ok(!g.lateral && !!g.pe && g.pe.r <= g.w + 0.5 && g.pe.l >= -0.5 && (g.barra == null || g.pe.b <= g.barra + 1) && g.linhas.every((x) => x >= 44) && g.botao.every((x) => x >= 44), `360: sem rolagem lateral, a barra do "Mudar nos estados" cabe acima da barra do painel e as linhas e o botão têm 44 px ou mais (${JSON.stringify(g)})`)
    await print(q, 'massa-360-selecionando')
    await q.getByRole('button', { name: 'Mudar nos estados' }).tap()
    const f = q.getByRole('dialog', { name: 'Mudar 2 produtos' })
    await f.waitFor()
    await f.getByRole('button', { name: 'Todos', exact: true }).tap()
    await f.getByText('Copiar de outro estado', { exact: true }).tap()
    const semLado = await q.evaluate(() => {
      const c = document.querySelector('.pn-folha-corpo')
      return !!c && c.scrollWidth <= c.clientWidth + 0.5
    })
    ok(semLado && /Deixa de fora, lá em cima, o estado de onde copiar/.test(await f.innerText()), '360: a folha não rola pro lado; com todos os estados marcados, copiar diz pra deixar um de fora')
    await print(q, 'massa-360-folha')
    await q.keyboard.press('Escape')
    await f.waitFor({ state: 'detached' })
    await c.close()
  }
}
