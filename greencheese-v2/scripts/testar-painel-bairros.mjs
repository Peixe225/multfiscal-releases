// A taxa de entrega por bairro no painel (pedido do Ian em 22/10), roda dentro do scripts/testar-painel-loja.mjs, com a
// página dele já logada num celular 390×844 e o servidor de verdade: Estado → Taxa de entrega → [Uma taxa pro estado |
// Por bairro] e "Como o cliente vê" [Aparece no site | O cliente consulta]; a lista (adicionar, editar, apagar, buscar,
// o repetido recusado); COLAR UMA LISTA com a prévia do que entendeu antes de aplicar ("Copacabana: 12", "Ipanema;
// 12,50", vários com a mesma taxa, linha sem valor = consultar, "grátis", o repetido que vale o de baixo, o que fica de
// fora) e o "trocar a lista toda"; salvar e o site ver (GET loja nos 3 modos); voltar pra uma taxa só guarda a lista;
// a lista de estados diz o modo; 320 px sem rolagem pro lado. axe e prints em cada tela.

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
}
