// A taxa de entrega por bairro no painel (pedido do Ian em 22/10), roda dentro do scripts/testar-painel-loja.mjs, com a
// página dele já logada num celular 390×844 e o servidor de verdade: Estado → Taxa de entrega → [Uma taxa pro estado |
// Por bairro] e "Como o cliente vê" [Aparece no site | O cliente consulta]; a lista (adicionar, editar, apagar, buscar,
// o repetido recusado); COLAR UMA LISTA com a prévia do que entendeu antes de aplicar ("Copacabana: 12", "Ipanema;
// 12,50", vários com a mesma taxa, linha sem valor = consultar, "grátis", o repetido que vale o de baixo, o que fica de
// fora) e o "trocar a lista toda"; salvar e o site ver (GET loja nos 3 modos); voltar pra uma taxa só guarda a lista;
// a lista de estados diz o modo; 320 px sem rolagem pro lado. axe e prints em cada tela.
// Da revisão de 22/10 (o corretor): o bairro digitado sem "Adicionar" (e a edição sem "Pronto") entra no Salvar, com
// as mesmas conferências, e sair com ele pergunta; o "Trocar a lista" travado sem linha boa e perguntando antes de
// tirar bairro; a linha de planilha com ";" no fim; tirar a cidade que tem bairro na lista (pergunta e tira os bairros
// dela junto); a cidade inteira no seletor em 360 px.

export async function fluxoBairros({ p, BASE, ok, print, axe }) {
  const loja = async () => (await (await fetch(`${BASE}/api/index.php?r=loja`)).json()).loja
  const rj = async () => (await loja()).estados.find((e) => e.uf === 'rj')
  const esperar = async (cond, ms = 10000) => {
    const fim = Date.now() + ms
    while (Date.now() < fim) {
      if (await cond().catch(() => false)) return true
      await new Promise((r) => setTimeout(r, 150))
    }
    return false
  }
  const linhas = async () => (await p.locator('.pn-bairros-lista:not(.pn-bairros-lista-previa) .pn-bairro-linha').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
  const salvar = async () => {
    await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
    await p.getByText('Rio de Janeiro: salvo. O site já mostra.').waitFor()
    await p.locator('#s-e-taxa').waitFor({ state: 'detached', timeout: 15000 })
  }
  const lateral = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 0.5)

  await p.goto(`${BASE}/painel/#/loja/estado/rj`)
  const porBairro = p.getByRole('radio', { name: /Por bairro/ })
  await porBairro.waitFor()
  ok(await p.getByRole('radio', { name: /Uma taxa pro estado/ }).isChecked(), 'taxa por bairro: o estado começa com uma taxa só (o padrão de sempre)')
  ok((await p.getByRole('radio', { name: /Um valor fixo/ }).count()) === 1, 'uma taxa só: a taxa do estado como sempre (A confirmar / Um valor fixo)')
  await porBairro.tap()
  ok(await p.getByRole('radio', { name: /Aparece no site/ }).isChecked(), 'por bairro: "Como o cliente vê" começa em "Aparece no site"')
  ok((await p.getByRole('radio', { name: /Um valor fixo/ }).count()) === 0, 'por bairro: a taxa única sai da tela (fica guardada)')
  ok(/Nenhum bairro ainda/.test(await p.locator('.pn-bairros-conta').innerText()) && (await p.getByText('Lista vazia: o site mostra').count()) === 1, 'lista vazia: diz que não tem bairro e que o site mostra "a consultar" pra todos (nada vem de fábrica)')

  // colar uma lista: a prévia antes de aplicar
  await p.getByRole('button', { name: 'Colar uma lista' }).tap()
  await p.locator('#e-bairros-colar').fill(
    ['Copacabana: 12', 'Ipanema; 12,50', 'Botafogo, Flamengo, Catete: 10', 'Recreio', 'Leblon R$ 15', 'Barra da Tijuca - 25', 'Lapa: grátis', 'Centro: 600', 'X: 5', 'copacabana: 13', '', '# comentário'].join('\n'),
  )
  await p.waitForTimeout(200)
  const resumo = (await p.locator('.pn-bairros-previa > .pn-rotulo').innerText()).trim()
  ok(resumo === 'O que eu entendi: 9 novos · 2 com problema', `a prévia conta o que entendeu antes de aplicar (${resumo})`)
  const previa = (await p.locator('.pn-bairros-lista-previa .pn-bairro-linha').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
  ok(previa.some((t) => /^Ipanema novo R\$ 12,50$/.test(t)), `"Ipanema; 12,50": R$ 12,50 (${previa.find((t) => t.startsWith('Ipanema'))})`)
  ok(['Botafogo', 'Flamengo', 'Catete'].every((n) => previa.some((t) => t === `${n} novo R$ 10,00`)), '"Botafogo, Flamengo, Catete: 10": três bairros com a mesma taxa')
  ok(previa.some((t) => t === 'Recreio novo consultar'), 'linha sem valor = consultar')
  ok(previa.some((t) => t === 'Leblon novo R$ 15,00') && previa.some((t) => t === 'Barra da Tijuca novo R$ 25,00'), '"Leblon R$ 15" e "Barra da Tijuca - 25" também entendem a taxa')
  ok(previa.some((t) => t === 'Lapa novo sem taxa'), '"Lapa: grátis" = sem taxa (R$ 0)')
  ok(previa.some((t) => /^Centro fica de fora: Taxa de R\$ 0,00 a R\$ 500,00/.test(t)) && previa.some((t) => /^X fica de fora: Nome do bairro de 2 a 60 letras/.test(t)), 'taxa acima de R$ 500 e nome de 1 letra ficam de fora, dizendo por quê')
  ok(previa.some((t) => t === 'Copacabana repetido: vale o de baixo R$ 12,00') && previa.some((t) => t === 'copacabana novo R$ 13,00'), 'o mesmo bairro duas vezes (sem contar maiúscula): vale o de baixo')
  await axe(p, 'estado: colar a lista de bairros')
  await p.locator('.pn-bairros-previa').scrollIntoViewIfNeeded()
  await print(p, 'loja-estado-bairros-previa')
  await p.setViewportSize({ width: 320, height: 700 })
  await p.waitForTimeout(200)
  await p.locator('.pn-bairros-previa').scrollIntoViewIfNeeded()
  ok(await lateral(), 'a prévia da lista colada cabe em 320 px (sem rolagem pro lado)')
  await print(p, 'loja-estado-bairros-previa-320')
  await p.setViewportSize({ width: 390, height: 844 })
  await p.getByRole('button', { name: 'Aplicar 9 bairros' }).tap()
  ok((await p.locator('#e-bairros-colar').count()) === 0, 'aplicou: a área de colar fecha')
  let l = await linhas()
  ok(l.length === 9 && l[0].startsWith('Barra da Tijuca') && l.includes('copacabana R$ 13,00') && l.includes('Recreio consultar') && l.includes('Lapa sem taxa'), `a lista em ordem, com os 9 (${l.join(' | ')})`)

  // editar, apagar, adicionar e o repetido recusado
  await p.getByRole('button', { name: 'Editar copacabana' }).tap()
  ok((await p.locator('#e-bairros').inputValue()) === 'copacabana', 'editar: o bairro vai pro formulário')
  await p.locator('#e-bairros').fill('Copacabana')
  await p.getByPlaceholder('consultar').fill('12')
  await p.getByRole('button', { name: 'Pronto' }).tap()
  await p.getByRole('button', { name: 'Apagar Catete' }).tap()
  await p.locator('#e-bairros').fill('Glória')
  await p.getByPlaceholder('consultar').fill('11,50')
  await p.getByRole('button', { name: 'Adicionar bairro', exact: true }).tap()
  await p.locator('#e-bairros').fill('ipanema')
  await p.getByRole('button', { name: 'Adicionar bairro', exact: true }).tap()
  ok(/“ipanema” já tá na lista/.test(await p.locator('#e-bairro-erro').innerText().catch(() => '')), 'o mesmo bairro de novo (outra maiúscula): "já tá na lista"')
  await p.locator('#e-bairros').fill('')
  l = await linhas()
  ok(l.includes('Copacabana R$ 12,00') && !l.some((t) => t.startsWith('Catete')) && l.includes('Glória R$ 11,50') && l.length === 9, `editou Copacabana, apagou Catete, entrou Glória (${l.join(' | ')})`)
  // buscar (com mais de 8)
  await p.getByLabel('Buscar bairro').fill('fla')
  l = await linhas()
  ok(l.length === 1 && l[0] === 'Flamengo R$ 10,00', `buscar "fla": só o Flamengo (${l.join(' | ')})`)
  await p.getByLabel('Buscar bairro').fill('')
  await axe(p, 'estado: a lista de bairros')
  await print(p, 'loja-estado-bairros-lista', true)
  await salvar()
  ok(
    await esperar(async () => {
      const e = await rj()
      return e.taxaPorBairro?.modo === 'site' && e.taxaPorBairro.bairros.length === 9 && e.taxaEntrega.valor === null && e.taxaPorBairro.bairros.some((b) => b.nome === 'Copacabana' && b.taxa === 12) && e.taxaPorBairro.bairros.some((b) => b.nome === 'Recreio' && b.taxa === null)
    }),
    'salvou: o site recebe a lista no GET loja (Copacabana R$ 12, Recreio consultar) e a taxa única "a confirmar"',
  )

  // o cliente consulta: o site só recebe o modo; a lista fica no painel
  await p.goto(`${BASE}/painel/#/loja/estado/rj`)
  await p.getByRole('radio', { name: /O cliente consulta/ }).tap()
  ok((await p.getByText('a lista não aparece no site').count()) === 1, 'o cliente consulta: o painel diz que a lista fica só no painel e no aviso do grupo')
  await print(p, 'loja-estado-bairros-consulta')
  await salvar()
  ok(await esperar(async () => JSON.stringify((await rj()).taxaPorBairro) === JSON.stringify({ modo: 'consulta' })), 'salvou "o cliente consulta": o site recebe só o modo, sem a lista')
  await p.goto(`${BASE}/painel/#/loja/estados`)
  await p.getByText(/taxa por bairro \(9 bairros, o cliente consulta\)/).first().waitFor({ timeout: 8000 }).catch(() => {})
  ok(/taxa por bairro \(9 bairros, o cliente consulta\)/.test(await p.locator('main').innerText()), 'a lista de estados diz o modo do RJ (taxa por bairro, 9 bairros, o cliente consulta)')

  // trocar a lista toda pela colada
  await p.goto(`${BASE}/painel/#/loja/estado/rj`)
  await p.getByRole('button', { name: 'Colar uma lista' }).tap()
  await p.locator('#e-bairros-colar').fill('Copacabana: 12\nIpanema: 13')
  await p.getByRole('radio', { name: /Trocar a lista toda/ }).tap()
  await p.getByRole('button', { name: 'Trocar a lista' }).tap()
  // tirando bairro da lista, pergunta antes (revisão de 22/10; sem a pergunta, a checagem de baixo diz)
  await p.getByRole('button', { name: 'Trocar pela lista colada (2 bairros)' }).tap({ timeout: 5000 }).catch(() => {})
  await p.waitForTimeout(300)
  l = await linhas()
  ok(l.length === 2 && l[0] === 'Copacabana R$ 12,00' && l[1] === 'Ipanema R$ 13,00', `trocar a lista toda: fica só a colada (${l.join(' | ')})`)

  // uma taxa pro estado de novo: o site volta à taxa única e a lista fica guardada
  await p.getByRole('radio', { name: /Uma taxa pro estado/ }).tap()
  await salvar()
  ok(
    await esperar(async () => {
      const e = await rj()
      return !('taxaPorBairro' in e) && e.taxaEntrega.valor !== null
    }),
    'uma taxa pro estado de novo: o site volta à taxa única de antes (sem taxaPorBairro)',
  )
  await p.goto(`${BASE}/painel/#/loja/estado/rj`)
  await p.getByRole('radio', { name: /Por bairro/ }).tap()
  l = await linhas()
  ok(l.length === 2, `a lista ficou guardada (por bairro de novo: ${l.join(' | ')})`)
  await p.getByRole('radio', { name: /Uma taxa pro estado/ }).tap()
  ok((await p.getByRole('button', { name: 'Salvar', exact: true }).isDisabled()) === true, 'voltou ao que tava salvo: nada pra salvar')

  // ─── revisão de 22/10 (o corretor) ──────────────────────────────────────────────────────────────────────────
  // Cada bloco começa na tela do estado; o que quebra (o código de antes, por exemplo) vira uma falha com o nome do
  // bloco, e os outros seguem. Toques com prazo curto (5 s): o que não existe na tela não segura o resto.
  const listaRj = async () => (await rj()).taxaPorBairro?.bairros ?? []
  const T = { timeout: 5000 }
  const bloco = async (nome, fn) => {
    try {
      await p.setViewportSize({ width: 390, height: 844 })
      await p.goto(`${BASE}/painel/#/loja/estado/rj`)
      await p.getByRole('radio', { name: /Por bairro/ }).waitFor(T)
      await fn()
    } catch (e) {
      ok(false, `taxa por bairro, ${nome}: quebrou (${e.message.split('\n')[0]})`)
      await p.keyboard.press('Escape').catch(() => {})
    }
  }
  await bloco('a linha com ";" no fim e o bairro só digitado', async () => {
    await p.getByRole('radio', { name: /Por bairro/ }).tap(T)
    // a lista no site (o GET loja traz a lista só no "Aparece no site")
    await p.getByRole('radio', { name: /Aparece no site/ }).tap(T)
    // a linha de planilha com o separador sobrando no fim
    await p.getByRole('button', { name: 'Colar uma lista' }).tap(T)
    await p.locator('#e-bairros-colar').fill('Laranjeiras;10;\nFlamengo: 9:')
    await p.waitForTimeout(200)
    const previa2 = (await p.locator('.pn-bairros-lista-previa .pn-bairro-linha').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
    ok(previa2.includes('Laranjeiras novo R$ 10,00') && previa2.includes('Flamengo novo R$ 9,00'), `"Laranjeiras;10;" (o ";" sobrando da planilha): Laranjeiras a R$ 10,00 (${previa2.join(' | ')})`)
    await p.getByRole('button', { name: 'Aplicar 2 bairros' }).tap(T)
    // o bairro digitado sem tocar em "Adicionar": o aviso embaixo e o Salvar leva ele
    await p.locator('#e-bairros').fill('Urca')
    await p.getByPlaceholder('consultar').fill('14')
    const pendente = (await p.locator('.pn-bairro-pendente').innerText(T).catch(() => '')).trim()
    ok(pendente === '“Urca” entra na lista quando tu salvar.', `o bairro digitado sem "Adicionar" avisa que entra ao salvar (${pendente})`)
    await p.locator('.pn-bairro-pendente').evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {})
    await print(p, 'loja-estado-bairros-rascunho')
    await salvar()
    const lr = await listaRj()
    ok(lr.some((b) => b.nome === 'Urca' && b.taxa === 14) && lr.some((b) => b.nome === 'Laranjeiras' && b.taxa === 10), `salvou com o bairro só digitado: a Urca (R$ 14) e a Laranjeiras (R$ 10) no site (${lr.map((b) => b.nome).join(', ')})`)
  })
  await bloco('o bairro digitado conta como mudança e o que não serve não salva', async () => {
    await p.locator('#e-bairros').waitFor(T)
    ok(await p.getByRole('button', { name: 'Salvar', exact: true }).isDisabled(), 'o formulário limpo: nada pra salvar')
    await p.locator('#e-bairros').fill('Gávea')
    ok(!(await p.getByRole('button', { name: 'Salvar', exact: true }).isDisabled()), 'só o bairro digitado já conta como mudança (o Salvar acende)')
    await p.getByRole('button', { name: 'Voltar' }).first().tap(T)
    const perguntou = await p.getByText('Tem mudança não salva').waitFor(T).then(() => true, () => false)
    ok(perguntou, 'sair com o bairro digitado pergunta antes (ele não some calado)')
    if (perguntou) await p.getByRole('button', { name: 'Continuar editando' }).tap(T)
    else await p.goto(`${BASE}/painel/#/loja/estado/rj`)
    await p.locator('#e-bairros').fill('X')
    await p.getByRole('button', { name: 'Salvar', exact: true }).tap(T)
    await p.waitForTimeout(600)
    const erroRasc = (await p.locator('#e-bairro-erro').innerText(T).catch(() => '')).trim()
    ok(/Nome do bairro de 2 a 60 letras/.test(erroRasc) && (await p.locator('#s-e-taxa').count()) === 1, `o bairro digitado que não serve: o erro aparece embaixo dele e a tela fica (${erroRasc})`)
    ok(!(await listaRj()).some((b) => b.nome === 'X'), 'e nada foi pro servidor')
  })
  await bloco('a edição sem o "Pronto"', async () => {
    await p.getByRole('button', { name: 'Editar Urca' }).tap(T)
    await p.getByPlaceholder('consultar').fill('15')
    await salvar()
    ok((await listaRj()).some((b) => b.nome === 'Urca' && b.taxa === 15), 'a edição da Urca (R$ 15) sem tocar em "Pronto": vale no Salvar')
  })
  await bloco('trocar a lista toda', async () => {
    await p.getByRole('button', { name: 'Colar uma lista' }).tap(T)
    await p.locator('#e-bairros-colar').fill('Méier: 8 reais\nX: 5')
    await p.getByRole('radio', { name: /Trocar a lista toda/ }).tap(T)
    await p.waitForTimeout(200)
    ok(await p.getByRole('button', { name: 'Trocar a lista' }).isDisabled(), 'trocar com todas as linhas de fora: o botão fica travado (a lista não esvazia)')
    await p.locator('.pn-bairros-previa').scrollIntoViewIfNeeded()
    await print(p, 'loja-estado-bairros-trocar-travado')
    const antesTroca = (await linhas()).length
    await p.locator('#e-bairros-colar').fill('Copacabana: 12\nUrca: 15')
    await p.getByRole('button', { name: 'Trocar a lista' }).tap(T)
    const dialogo = p.getByRole('alertdialog')
    await dialogo.waitFor(T).catch(() => {})
    const textoDialogo = (await dialogo.innerText(T).catch(() => '')).replace(/\s+/g, ' ')
    ok(/Trocar a lista toda\?/.test(textoDialogo) && textoDialogo.includes(`(${antesTroca} bairros) sai e fica só a colada (2 bairros)`), `trocar tirando bairro: pergunta antes, dizendo quantos saem (${textoDialogo.slice(0, 160)})`)
    await print(p, 'loja-estado-bairros-trocar-pergunta')
    await p.getByRole('button', { name: 'Deixa a lista como tá' }).tap(T)
    ok((await linhas()).length === antesTroca, 'desistiu: a lista fica como tava')
    await p.getByRole('button', { name: 'Trocar a lista' }).tap(T)
    await p.getByRole('button', { name: 'Trocar pela lista colada (2 bairros)' }).tap(T)
    await p.waitForTimeout(300)
    ok((await linhas()).join(' | ') === 'Copacabana R$ 12,00 | Urca R$ 15,00', `confirmou: fica só a colada (${(await linhas()).join(' | ')})`)
    await salvar()
  })
  await bloco('a cidade no seletor em 360 px e tirar a cidade que tem bairro', async () => {
    await p.locator('#e-cidade-nova').fill('Niterói')
    await p.locator('.pn-cidade-nova').getByRole('button', { name: 'Adicionar' }).tap(T)
    await p.locator('#e-bairros').fill('Icaraí')
    await p.locator('.pn-bairro-form select').selectOption('Niterói', T)
    await p.getByPlaceholder('consultar').fill('11')
    await p.getByRole('button', { name: 'Adicionar bairro', exact: true }).tap(T)
    // 360 px: a cidade inteira no seletor ("Qualquer cidade", sem cortar)
    await p.setViewportSize({ width: 360, height: 740 })
    await p.locator('#e-bairros').scrollIntoViewIfNeeded()
    await p.waitForTimeout(200)
    const cabe = await p.evaluate(() => {
      const s = document.querySelector('.pn-bairro-form select')
      if (!s) return null
      const cs = getComputedStyle(s)
      const c = document.createElement('canvas').getContext('2d')
      c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const texto = c.measureText('Qualquer cidade').width
      const livre = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      return { texto: Math.round(texto), livre: Math.round(livre) }
    })
    ok(!!cabe && cabe.texto <= cabe.livre, `360 px: "Qualquer cidade" cabe inteiro no seletor (${JSON.stringify(cabe)})`)
    ok(await lateral(), 'o formulário do bairro com a cidade cabe em 360 px (sem rolagem pro lado)')
    await print(p, 'loja-estado-bairros-cidade-360')
    await p.setViewportSize({ width: 390, height: 844 })
    await salvar()
    ok((await listaRj()).some((b) => b.nome === 'Icaraí' && b.cidade === 'Niterói'), 'salvou: Icaraí de Niterói no site')
    await p.goto(`${BASE}/painel/#/loja/estado/rj`)
    await p.getByRole('button', { name: 'Tirar Niterói' }).tap(T)
    const dialogoCidade = p.getByRole('alertdialog')
    await dialogoCidade.waitFor(T).catch(() => {})
    const textoCidade = (await dialogoCidade.innerText(T).catch(() => '')).replace(/\s+/g, ' ')
    ok(/Tirar Niterói\?/.test(textoCidade) && /O bairro Icaraí é de Niterói/.test(textoCidade), `tirar Niterói com Icaraí na lista: pergunta antes, dizendo qual bairro (${textoCidade.slice(0, 160)})`)
    await print(p, 'loja-estado-bairros-tirar-cidade')
    await p.getByRole('button', { name: 'Tirar Niterói e o bairro' }).tap(T)
    await p.waitForTimeout(300)
    ok(!(await linhas()).some((t) => t.startsWith('Icaraí')), 'o Icaraí saiu da lista junto com a cidade')
    await salvar()
    const rjDepois = await rj()
    ok(rjDepois.cidades.length === 1 && !(rjDepois.taxaPorBairro?.bairros ?? []).some((b) => b.cidade === 'Niterói'), 'salvou: o RJ sem Niterói e sem bairro de Niterói (nada de bairro órfão)')
  })
  await bloco('a lista depois de tirar a cidade', async () => {
    // o salvar seguinte da lista não trava num bairro que o dono nem mexeu
    await p.getByRole('button', { name: 'Editar Copacabana' }).tap(T)
    await p.getByPlaceholder('consultar').fill('13')
    await p.getByRole('button', { name: 'Pronto' }).tap(T)
    await salvar()
    ok((await listaRj()).some((b) => b.nome === 'Copacabana' && b.taxa === 13), 'depois de tirar a cidade, mudar a taxa da Copacabana salva normal')
  })
  // o RJ volta pra uma taxa só e só com a cidade de sempre (o resto do testar-painel segue como antes)
  await bloco('o RJ de volta como tava', async () => {
    const e = await rj()
    if (e.cidades.length > 1) for (const c of e.cidades.slice(1)) await p.getByRole('button', { name: `Tirar ${c.nome}` }).tap(T).then(() => p.getByRole('button', { name: new RegExp(`^Tirar ${c.nome}`) }).last().tap(T).catch(() => {}))
    await p.getByRole('radio', { name: /Uma taxa pro estado/ }).tap(T)
    await salvar()
  })
}
