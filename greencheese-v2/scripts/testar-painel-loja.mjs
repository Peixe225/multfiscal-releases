// A loja no painel, no navegador e contra o servidor de verdade (roda dentro do scripts/testar-painel.mjs, com a
// página dele já logada, num celular 390×844): o atalho do Resumo, desligar um produto num estado com 1 toque (1
// pedido), contar estoque, − e + até esgotar e voltar, editar o preço, mandar a foto e ver ela no card do site, criar
// produto, ativar a Bahia, a hora com máscara, escolher e ordenar o story, criar prêmio com a conferência ao vivo (e
// bebida fora da lista) e mudar um texto da loja. Cada passo é conferido no GET loja (o que o site lê). axe e prints
// em cada tela. No fim, o site de verdade (siteVeLoja): o que o painel mudou aparece no site (preço, foto, "RESTA 1",
// produto novo, story na ordem do dono, Bahia), o WhatsApp próprio do estado e o "o mesmo pra todos", a rua do
// mercador no celular desligada e ligada de novo (na home, o 1º story; na Home 2, ?home=2, o fim do Início), o Teste
// minha sorte desligado, o estado tirado do site e o ETag (304 sem mudança).

/** As telas da loja (o testar-painel.mjs confere 320 px sem rolagem lateral em cada uma). */
export const ROTAS_LOJA = ['#/produtos', '#/produto/seda-ocb-premium-slim', '#/produtos/novo', '#/loja', '#/loja/estados', '#/loja/estado/mg', '#/loja/estado/ba', '#/loja/stories/mg', '#/loja/categorias', '#/loja/sorte', '#/loja/sorte/novo', '#/loja/sorte/premio/ocb-4-por-3']

export async function fluxoLoja({ p, BASE, ok, print, axe, foto, browser }) {
  const loja = async () => (await (await fetch(`${BASE}/api/index.php?r=loja`)).json()).loja
  const prod = (l, id) => l.produtos.find((x) => x.id === id)
  // espera o site ver a mudança (as trocas rápidas vão em fila, depois do toque)
  const esperar = async (cond, ms = 10000) => {
    const fim = Date.now() + ms
    while (Date.now() < fim) {
      if (await cond().catch(() => false)) return true
      await new Promise((r) => setTimeout(r, 150))
    }
    return false
  }
  const ocbEm = async (uf) => {
    const x = prod(await loja(), 'seda-ocb-premium-slim')
    return [x.disponivel[uf], x.restam[uf] ?? null]
  }

  // Resumo → Produtos pelo atalho do bloco da loja
  await p.goto(`${BASE}/painel/#/`)
  await p.getByRole('heading', { name: 'Loja', exact: true }).waitFor()
  await axe(p, 'resumo com a loja')
  await p.locator('.pn-atalhos').getByRole('link', { name: 'Produtos' }).tap()
  await p.getByRole('heading', { name: 'Produtos', level: 1 }).waitFor()
  ok(p.url().endsWith('#/produtos'), 'Resumo → Produtos pelo atalho da loja')
  await axe(p, 'produtos')
  await print(p, 'loja-produtos')

  // desligar e ligar num estado: 1 toque, 1 pedido
  await p.getByRole('button', { name: 'Minas Gerais', exact: true }).tap()
  const linha = p.locator('.pn-prod').filter({ hasText: 'Seda OCB Premium Slim' })
  let pedidos = 0
  p.on('request', (r) => r.url().includes('admin-produto-estado') && r.method() === 'POST' && pedidos++)
  await linha.locator('label.pn-troca').tap()
  ok(await esperar(async () => (await ocbEm('mg'))[0] === false), 'um toque no interruptor: a OCB sai de MG no site')
  ok(pedidos === 1, `um toque, um pedido (${pedidos})`)
  ok(await linha.getByText(/^Indisponível/).isVisible(), 'a linha diz Indisponível')
  await linha.locator('label.pn-troca').tap()
  ok(await esperar(async () => (await ocbEm('mg'))[0] === true), 'outro toque: volta pro site')

  // contar estoque, − e + (chega a 0: esgota sozinho; volta com +)
  await linha.getByRole('button', { name: 'Contar o estoque de Seda OCB Premium Slim em Minas Gerais' }).tap()
  const folha = p.getByRole('dialog', { name: 'Estoque em Minas Gerais' })
  await folha.getByLabel('Unidades').fill('3')
  await axe(p, 'estoque')
  await folha.getByRole('button', { name: 'Salvar o estoque' }).tap()
  await folha.waitFor({ state: 'detached' })
  ok(await esperar(async () => JSON.stringify(await ocbEm('mg')) === '[true,3]'), 'estoque 3: no site, à venda com "restam 3"')
  const menos = linha.getByRole('button', { name: 'Menos um no estoque de Seda OCB Premium Slim' })
  await menos.tap()
  ok(await esperar(async () => JSON.stringify(await ocbEm('mg')) === '[true,2]'), '−: "restam 2"')
  await menos.tap()
  await menos.tap()
  ok(await esperar(async () => JSON.stringify(await ocbEm('mg')) === '[false,null]'), 'chegou a 0: esgotado, sai do site sozinho')
  ok(await linha.getByText(/^Esgotado/).isVisible(), 'a linha diz Esgotado')
  await linha.getByRole('button', { name: 'Mais um no estoque de Seda OCB Premium Slim' }).tap()
  ok(await esperar(async () => JSON.stringify(await ocbEm('mg')) === '[true,1]'), '+: volta pro site com "restam 1"')
  await print(p, 'loja-produtos-mg')

  // editar o preço e mandar a foto (o card do site na prévia)
  await linha.getByRole('link', { name: 'Seda OCB Premium Slim: editar' }).tap()
  const preco = p.getByLabel('Preço da unidade')
  await preco.waitFor()
  await preco.fill('10,49')
  const [escolha] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Enviar foto').tap()])
  await escolha.setFiles(foto)
  await p.getByText('Trocar foto').waitFor({ timeout: 20000 })
  ok(await p.locator('.pn-foto-card img.pn-arte-foto-loja').isVisible(), 'a foto aparece no card do site, do lado dos botões')
  await axe(p, 'produto')
  await print(p, 'loja-produto', true)
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  await p.getByText('Seda OCB Premium Slim: salvo. O site já mostra.').waitFor()
  ok(await esperar(async () => {
    const x = prod(await loja(), 'seda-ocb-premium-slim')
    return x.preco === 10.49 && /^uploads\/[0-9a-f]+\.\w+$/.test(x.foto ?? '')
  }), 'preço novo e a foto no site')
  const fotoSite = prod(await loja(), 'seda-ocb-premium-slim').foto
  const img = await fetch(`${BASE}/${fotoSite}`)
  ok(img.ok && /^image\//.test(img.headers.get('content-type') ?? ''), 'a foto abre pelo endereço do site')
  ok(JSON.stringify(await ocbEm('mg')) === '[true,1]', 'salvar o produto não mexeu no estoque contado')

  // produto novo, à venda em MG
  await p.goto(`${BASE}/painel/#/produtos/novo`)
  await p.getByLabel('Nome', { exact: true }).fill('Isqueiro Bic Mini')
  await p.getByLabel('Categoria').selectOption('acessorios')
  await p.getByLabel('Preço da unidade').fill('6,50')
  await p.locator('label[for="p-est-mg"]').tap()
  await axe(p, 'produto novo')
  await p.getByRole('button', { name: 'Criar produto' }).tap()
  await p.getByText(/Isqueiro Bic Mini criado/).waitFor()
  ok(await esperar(async () => {
    const x = prod(await loja(), 'isqueiro-bic-mini')
    return x?.preco === 6.5 && x.disponivel.mg === true && x.disponivel.rj === false
  }), 'produto novo no site, à venda só em MG')

  // ativar a Bahia
  await p.goto(`${BASE}/painel/#/loja/estados`)
  await p.getByLabel('Estado', { exact: true }).selectOption('ba')
  await axe(p, 'estados')
  await p.getByRole('button', { name: 'Continuar' }).tap()
  await p.getByLabel('Instagram do estado').fill('@greencheese_importsba')
  await axe(p, 'estado novo')
  await print(p, 'loja-estado-ba', true)
  await p.getByRole('button', { name: 'Ativar Bahia' }).tap()
  await p.getByText(/Bahia ativado no site/).waitFor()
  ok(await esperar(async () => {
    const e = (await loja()).estados.find((x) => x.uf === 'ba')
    return e?.instagram === 'greencheese_importsba' && e.emblema === 'generico' && e.horario.demo === true
  }), 'Bahia ativada: o site já vê (emblema genérico, horário a confirmar)')

  // a hora com máscara: "930" vira 09:30; salva e o horário deixa de ser exemplo
  await p.goto(`${BASE}/painel/#/loja/estado/mg`)
  const abre = p.getByLabel('Segunda: abre às')
  await abre.fill('930')
  ok((await abre.inputValue()) === '9:30', `digitando "930": 9:30 (${await abre.inputValue()})`)
  await abre.press('Tab')
  ok((await abre.inputValue()) === '09:30', `saindo do campo: 09:30 (${await abre.inputValue()})`)
  await axe(p, 'estado')
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  await p.getByText('Minas Gerais: salvo. O site já mostra.').waitFor()
  ok(await esperar(async () => {
    const e = (await loja()).estados.find((x) => x.uf === 'mg')
    return e.horario.demo === false && e.horario.semana[1]?.[0] === '09:30'
  }), 'horário salvo: o site mostra o de verdade (segunda abre 09:30)')

  // story de MG: escolher dois e subir o segundo
  await p.goto(`${BASE}/painel/#/loja/stories/mg`)
  await p.getByRole('button', { name: 'Pôr Seda OCB Premium Slim no story' }).tap()
  await p.getByRole('button', { name: 'Pôr Isqueiro Bic Mini no story' }).tap()
  await p.getByRole('button', { name: 'Subir Isqueiro Bic Mini' }).tap()
  ok(await p.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Subir Isqueiro Bic Mini'), 'subir: o foco segue o produto')
  await axe(p, 'stories')
  await print(p, 'loja-stories', true)
  await p.getByRole('button', { name: 'Salvar o story' }).tap()
  await p.getByText(/Story de Minas Gerais salvo/).waitFor()
  ok(await esperar(async () => JSON.stringify((await loja()).stories.mg) === '["isqueiro-bic-mini","seda-ocb-premium-slim"]'), 'o site passa o story de MG na ordem escolhida')

  // prêmio: brinde de acessório, com a conferência ao vivo (bebida nem aparece pra escolher)
  await p.goto(`${BASE}/painel/#/loja/sorte/novo`)
  await p.locator('label.pn-opcao').filter({ hasText: 'Um produto de presente no pedido' }).tap()
  const brindes = await p.getByLabel('Vai de brinde').locator('option').allInnerTexts()
  ok(brindes.some((o) => /Isqueiro Bic Mini/.test(o)) && !brindes.some((o) => /Dr Pepper|Coca-Cola|Jack Daniel|Tanqueray|Hennessy|Jägermeister|Arizona|Fanta/.test(o)), 'brinde: só acessório na lista (bebida nem aparece)')
  await p.getByLabel('Vai de brinde').selectOption('isqueiro-bic-mini')
  const vale = await p.locator('.pn-lista-marcar').innerText()
  ok(/Seda OCB/.test(vale) && !/Jack Daniel|Tanqueray|Dr Pepper|Coca-Cola/.test(vale), '"Vale em": só acessório também')
  await p.locator('label.pn-marcar').filter({ hasText: 'Seda OCB Premium Slim' }).tap()
  await p.getByLabel('Linha de apoio').fill('Vem junto com a OCB.')
  await p.getByLabel('Regra').fill('Frete grátis com a OCB')
  ok(await p.getByText(/Tira o “(grátis|frete)”/).first().isVisible(), 'conferência ao vivo: a palavra que o site não usa aparece enquanto digita')
  await p.getByLabel('Regra').fill('1 Isqueiro Bic Mini de brinde no pedido com a OCB')
  ok(!(await p.getByText(/Tira o “/).first().isVisible().catch(() => false)), 'arrumou: o aviso some')
  await p.getByLabel('Nome interno').fill('Bic de brinde')
  const vivo = await p.locator('.pn-destaque-vivo').innerText()
  ok(/BRINDE/.test(vivo) && /Isqueiro Bic Mini/.test(vivo), `o prêmio ao vivo no topo (${vivo.replace(/\s+/g, ' ')})`)
  await axe(p, 'prêmio')
  await print(p, 'loja-premio', true)
  await p.getByRole('button', { name: 'Criar prêmio' }).tap()
  await p.getByText(/Prêmio criado/).waitFor()
  ok(await esperar(async () => (await loja()).sorte.premios.some((x) => x.id === 'bic-de-brinde' && x.valor.produto === 'isqueiro-bic-mini')), 'o prêmio novo já tá no jogo do site')
  await axe(p, 'teste minha sorte')
  await print(p, 'loja-sorte')

  // um texto da loja
  await p.goto(`${BASE}/painel/#/loja`)
  await p.getByLabel('Frase do story do Início').fill('Vem que tem!')
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  ok(await esperar(async () => (await loja()).textos.fraseStory === 'Vem que tem!'), 'frase do story salva: o site recebe')
  await axe(p, 'loja')
  await print(p, 'loja-ajustes', true)

  await p.goto(`${BASE}/painel/#/loja/categorias`)
  await p.getByRole('heading', { name: 'Categorias', level: 1 }).waitFor()
  await axe(p, 'categorias')
  await print(p, 'loja-categorias')

  if (browser) await siteVeLoja({ p, BASE, ok, print, axe, browser, loja, esperar })
}

/**
 * O site de verdade lendo a loja que o painel acabou de mudar (celular 390×844, idade lembrada, sem a abertura). Entre
 * um passo e outro o painel muda e o site abre de novo (a loja do servidor chega no primeiro respiro).
 */
async function siteVeLoja({ p, BASE, ok, print, axe, browser, loja, esperar }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
      sessionStorage.setItem('gc-abertura', '1')
      sessionStorage.setItem('gc-dica-hero', '1')
    } catch {
      /* ignora */
    }
  })
  await ctx.route(/ipwho|geojs/, (r) => r.fulfill({ json: { success: true, country_code: 'BR', region: 'Minas Gerais', region_code: 'MG' } }))
  await ctx.route(/brasilapi\.com\.br\/api\/cep/, (r) => r.fulfill({ json: { cep: '39800000', state: 'MG', city: 'Teófilo Otoni', neighborhood: 'Centro', street: 'Rua Doutor Manoel Esteves' } }))
  await ctx.route(/viacep\.com\.br/, (r) => r.fulfill({ json: { erro: true } }))
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ body: 'whatsapp' }))
  const s = await ctx.newPage()
  const erros = []
  s.on('pageerror', (e) => erros.push(e.message))
  s.on('console', (m) => m.type() === 'error' && erros.push(m.text()))
  /** Abre o site e espera a loja do servidor (a versão de agora) entrar no lugar da guardada. */
  const abrir = async (q) => {
    const v = (await (await fetch(`${BASE}/api/index.php?r=loja`)).json()).versao
    await s.goto(`${BASE}/?${q}`)
    await s.waitForFunction((v) => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.versao === v, v, { timeout: 8000 }).catch(() => {})
    await s.waitForTimeout(900)
  }
  const nomeNoStory = () => s.evaluate(() => (document.querySelector('.hero-story.na-rua') ? 'rua' : (document.querySelector('.hero-palco .sq-nome')?.textContent ?? '?')))
  /** Home 2: a rua no fim do Início do celular, depois da grade e antes do rodapé (null: não tem rua no Início). */
  const ruaNoFim = () =>
    s.evaluate(() => {
      const v = document.querySelector('.vista-inicio')
      const vaga = v?.querySelector('.rua-fim .rua-vaga')
      if (!vaga) return null
      const grade = v.querySelector('.catalogo-inicio')?.getBoundingClientRect()
      const rodape = document.querySelector('.rodape')?.getBoundingClientRect()
      const b = vaga.getBoundingClientRect()
      return { depoisDaGrade: !!grade && b.top >= grade.bottom - 1, antesDoRodape: !!rodape && b.bottom <= rodape.top + 1, noHero: !!v.querySelector('.hero .rua, .hero .rua-vaga, .rua-story') }
    })
  const passar = async () => {
    await s.locator('.hero-quadro').first().click({ position: { x: 370, y: 300 } })
    await s.waitForTimeout(700)
  }

  // MG: o story na ordem do dono depois da rua; a OCB com o preço novo, a foto e "RESTA 1"; o produto novo na grade
  await abrir('uf=mg')
  const ordem = []
  for (let i = 0; i < 3; i++) {
    ordem.push(await nomeNoStory())
    await passar()
  }
  ok(JSON.stringify(ordem) === JSON.stringify(['rua', 'Isqueiro Bic Mini', 'Seda OCB Premium Slim']), `site: o story de MG na ordem do painel, depois da rua (${ordem.join(' → ')})`)
  {
    // a Home 2: o story só com os do dono (a rua fica no fim do Início, depois da grade e antes do rodapé)
    await abrir('home=2&uf=mg')
    const ordemH2 = []
    for (let i = 0; i < 3; i++) {
      ordemH2.push(await nomeNoStory())
      await passar()
    }
    ok(
      JSON.stringify(ordemH2) === JSON.stringify(['Isqueiro Bic Mini', 'Seda OCB Premium Slim', 'Isqueiro Bic Mini']) && (await s.locator('.hero-barras .story-barra').count()) === 2,
      `site: Home 2, o story de MG na ordem do painel, dando a volta (2 barrinhas: ${ordemH2.join(' → ')})`,
    )
    const r = await ruaNoFim()
    ok(!!r && r.depoisDaGrade && r.antesDoRodape && !r.noHero, `site: Home 2, a rua do mercador no fim do Início do celular, depois da grade e antes do rodapé (${JSON.stringify(r)})`)
    await abrir('uf=mg')
  }
  await passar()
  await passar()
  ok((await nomeNoStory()) === 'Seda OCB Premium Slim' && (await s.locator('.hero-palco .sq-restam').textContent().catch(() => null)) === 'RESTA 1', 'site: "RESTA 1" na OCB do story (estoque 1 em MG)')
  const card = s.locator('.vista-inicio .card').filter({ hasText: 'Seda OCB Premium Slim' }).first()
  await card.scrollIntoViewIfNeeded()
  await s.waitForTimeout(800)
  const src = await card.locator('img.pv-real').getAttribute('src').catch(() => null)
  ok(/uploads\/[0-9a-f]+\.\w+$/.test(src ?? ''), `site: o card da OCB com a foto que o dono mandou (${src})`)
  ok(/R\$ 10,49/.test((await card.textContent()) ?? '') && (await card.locator('.sq-restam').textContent().catch(() => null)) === 'RESTA 1', 'site: o card com o preço novo (R$ 10,49) e "RESTA 1"')
  const novo = s.locator('.vista-inicio .card').filter({ hasText: 'Isqueiro Bic Mini' }).first()
  ok((await novo.count()) === 1 && /R\$ 6,50/.test((await novo.textContent()) ?? ''), 'site: o produto novo (Isqueiro Bic Mini, R$ 6,50) na grade de MG')
  await print(s, 'site-loja-mg')
  await axe(s, 'site com a loja do servidor')

  // o ETag: aberto de novo sem mudança, o navegador pergunta com If-None-Match e o servidor responde 304 vazio
  {
    const k = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' })
    await k.addInitScript(() => {
      try {
        localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
        sessionStorage.setItem('gc-abertura', '1')
      } catch {
        /* ignora */
      }
    })
    // sem page.route aqui: com interceptação o Playwright desliga o cache do navegador
    const q = await k.newPage()
    const cdp = await k.newCDPSession(q)
    await cdp.send('Network.enable')
    const pedidos = new Map()
    const vistos = []
    cdp.on('Network.requestWillBeSent', (e) => e.request.url.includes('r=loja') && pedidos.set(e.requestId, true))
    cdp.on('Network.requestWillBeSentExtraInfo', (e) => {
      const h = Object.fromEntries(Object.entries(e.headers ?? {}).map(([a, b]) => [a.toLowerCase(), b]))
      if (pedidos.has(e.requestId) && h['if-none-match']) vistos.push('if-none-match')
    })
    cdp.on('Network.responseReceivedExtraInfo', (e) => pedidos.has(e.requestId) && vistos.push(e.statusCode))
    await q.goto(`${BASE}/?uf=mg`)
    await q.waitForFunction(() => !!localStorage.getItem('gc-loja'), null, { timeout: 8000 }).catch(() => {})
    await q.goto(`${BASE}/?uf=mg&de-novo=1`)
    await q.waitForTimeout(3000)
    ok(vistos.includes('if-none-match') && vistos.includes(304), `site: aberto de novo sem mudança, o navegador pergunta com If-None-Match e recebe 304 (${vistos.join(', ')})`)
    ok((await q.locator('.hero .story-cab-nome').textContent().catch(() => '')) === 'greencheese_importsmg', 'site: com o 304, a loja continua a mesma na tela')
    await k.close()
  }

  // WhatsApp próprio de MG (número de teste) com "o mesmo pra todos" desligado; depois ligado de novo
  const pedirNoSite = async () => {
    await s.goto(`${BASE}/?uf=mg&produto=isqueiro-bic-mini`)
    await s.getByRole('button', { name: 'Pedir este item' }).click()
    await s.waitForTimeout(700)
    for (const b of ['Isso', 'Tá certo']) {
      await s.getByRole('button', { name: b, exact: true }).last().click()
      await s.waitForTimeout(250)
    }
    for (const t of ['Ian Teste', '39800000', '120']) {
      await s.locator('.dm-entrada input').fill(t)
      await s.locator('.dm-entrada').evaluate((f) => f.requestSubmit())
      await s.waitForTimeout(400)
    }
    await s.getByRole('button', { name: 'Pix', exact: true }).last().click()
    await s.waitForTimeout(250)
    await s.locator('.dm-entrada input').fill('Portão azul')
    await s.locator('.dm-entrada').evaluate((f) => f.requestSubmit())
    await s.waitForTimeout(500)
    return s.getByRole('link', { name: 'Fechar pedido no WhatsApp' }).getAttribute('href')
  }
  await p.goto(`${BASE}/painel/#/loja/estado/mg`)
  await p.locator('label.pn-opcao').filter({ hasText: 'Um próprio pra Minas Gerais' }).tap()
  await p.getByLabel('WhatsApp de Minas Gerais').fill('33 98888-7777')
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  await p.getByText('Minas Gerais: salvo. O site já mostra.').waitFor()
  await p.goto(`${BASE}/painel/#/loja`)
  await p.locator('label.pn-troca').filter({ hasText: 'O mesmo WhatsApp pra todos os estados' }).tap()
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  await p.getByText('Salvo. O site já mostra.').waitFor()
  ok(await esperar(async () => (await loja()).estados.find((e) => e.uf === 'mg').whatsapp === '5533988887777'), 'painel: MG com WhatsApp próprio e "o mesmo pra todos" desligado (o GET loja manda o de MG)')
  await abrir('uf=mg')
  let zap = await pedirNoSite()
  ok(zap?.startsWith('https://wa.me/5533988887777?text='), `site: o pedido de MG fecha no WhatsApp próprio de MG (${zap?.slice(0, 40)}…)`)
  await p.goto(`${BASE}/painel/#/loja`)
  await p.locator('label.pn-troca').filter({ hasText: 'O mesmo WhatsApp pra todos os estados' }).tap()
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  await p.getByText('Salvo. O site já mostra.').waitFor()
  await abrir('uf=mg')
  zap = await pedirNoSite()
  ok(zap?.startsWith('https://wa.me/5533991139036?text='), `site: "o mesmo pra todos" ligado: o pedido de MG volta pro WhatsApp da loja (${zap?.slice(0, 40)}…)`)
  await s.keyboard.press('Escape')

  // a rua do mercador no celular desligada no painel: na home, o Início do celular começa no 1º produto do story; na
  // Home 2, o fim do Início fica sem ela (o story não muda); ligada de novo, ela volta pro fim da Home 2
  await p.goto(`${BASE}/painel/#/loja/stories/mg`)
  await p.locator('label.pn-troca').filter({ hasText: 'Rua do mercador no celular' }).tap()
  await p.getByText('O celular fica sem a rua (na home e na Home 2).').waitFor()
  await abrir('uf=mg')
  ok((await nomeNoStory()) === 'Isqueiro Bic Mini' && (await s.locator('.hero-barras .story-barra').count()) === 2 && !(await s.locator('.vista-inicio .rua-story').count()), 'site: rua desligada no painel: o story do celular começa no 1º produto (2 barrinhas)')
  await print(s, 'site-loja-sem-rua')
  await abrir('home=2&uf=mg')
  ok((await ruaNoFim()) === null && (await s.locator('.vista-inicio .rua').count()) === 0, 'site: rua desligada no painel: o Início do celular da Home 2 fica sem a rua')
  ok((await nomeNoStory()) === 'Isqueiro Bic Mini' && (await s.locator('.hero-barras .story-barra').count()) === 2, 'site: rua desligada: o story do celular da Home 2 não muda (1º produto, 2 barrinhas)')
  await s.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  await s.waitForTimeout(500)
  await print(s, 'site-loja-sem-rua-home2')
  await p.locator('label.pn-troca').filter({ hasText: 'Rua do mercador no celular' }).tap()
  await p.getByText('A rua tá no celular: o 1º story do Início (na Home 2, no fim).').waitFor()
  await abrir('home=2&uf=mg')
  {
    const r = await ruaNoFim()
    ok(!!r && r.depoisDaGrade && r.antesDoRodape, `site: rua ligada de novo: ela volta pro fim do Início do celular da Home 2 (${JSON.stringify(r)})`)
  }

  // o Teste minha sorte desligado: some da barra do site
  await p.goto(`${BASE}/painel/#/loja/sorte`)
  await p.locator('label.pn-troca').filter({ hasText: 'Teste minha sorte no site' }).tap()
  await p.getByText('Teste minha sorte desligado: some do site inteiro.').waitFor()
  await abrir('uf=mg')
  // a rua volta pra conta do story (3 barrinhas) sem trocar o produto que já tava na tela
  ok((await s.locator('.barra-abas [data-aba="sorte"]').count()) === 0 && (await s.locator('.hero-barras .story-barra').count()) === 3, 'site: Teste minha sorte desligado some da barra (e a rua voltou pro story)')
  await p.locator('label.pn-troca').filter({ hasText: 'Teste minha sorte no site' }).tap()
  await p.getByText('Teste minha sorte ligado no site.').waitFor()
  await abrir('uf=mg')
  ok((await s.locator('.barra-abas [data-aba="sorte"]').count()) === 1, 'site: ligado de novo, a Sorte volta')

  // a Bahia (ativada no painel, sem produto à venda ainda): o site atende, com o story só da rua; tirada, a tela de
  // sem atendimento
  await abrir('uf=ba')
  ok((await s.locator('.sem').count()) === 0 && (await s.locator('.hero .story-cab-nome').textContent().catch(() => '')) === 'greencheese_importsba', 'site: a Bahia ativada no painel atende (story com o @ dela)')
  ok((await s.locator('.hero-barras .story-barra').count()) === 1 && (await nomeNoStory()) === 'rua', 'site: sem produto à venda na Bahia, a rua é o story inteiro')
  await print(s, 'site-loja-ba')
  {
    // na Home 2 (sem a rua no story): o quadro do story fica, com o @ e o local no cabeçalho, o aviso "nada à venda" no
    // meio e a linha de mensagem no pé; a rua no fim do Início
    await abrir('home=2&uf=ba')
    const vazio = await s.evaluate(() => {
      const h = document.querySelector('.vista-inicio .hero.hero-vazio')
      return h
        ? {
            nome: h.querySelector('.story-cab-nome')?.textContent ?? null,
            local: h.querySelector('.hero-cab-local')?.textContent ?? null,
            titulo: h.querySelector('.hero-vazio-titulo')?.textContent ?? null,
            pe: !!h.querySelector('.hero-resposta'),
            produto: !!h.querySelector('.hero-palco, .sq'),
          }
        : null
    })
    ok(
      !!vazio && vazio.nome === 'greencheese_importsba' && /Bahia/.test(vazio.local ?? '') && vazio.titulo === 'Nada à venda na Bahia agora' && vazio.pe && !vazio.produto && !!(await ruaNoFim()),
      `site: Home 2, sem produto à venda na Bahia, o celular mantém o quadro do story (@, local, "nada à venda", linha de mensagem) e a rua no fim do Início (${JSON.stringify(vazio)})`,
    )
    await print(s, 'site-loja-ba-home2')
  }
  await p.goto(`${BASE}/painel/#/loja/estado/ba`)
  await p.locator('label.pn-troca').filter({ hasText: 'Aparece no site' }).tap()
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  await p.getByText('Bahia: salvo. O site já mostra.').waitFor()
  await abrir('uf=ba')
  ok((await s.locator('.sem').count()) === 1, 'site: a Bahia tirada do site: quem está nela vê "ainda não chegou aí"')
  ok(!erros.length, `site: sem erro no console (${erros.join(' | ') || 'nenhum'})`)
  await ctx.close()
}
