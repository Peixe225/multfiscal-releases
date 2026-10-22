// A loja no painel, no navegador e contra o servidor de verdade (roda dentro do scripts/testar-painel.mjs, com a
// página dele já logada, num celular 390×844): o atalho do Resumo, "À venda em:" com o chip que diz o que é e o recado
// com Desfazer, desligar um produto num estado com 1 toque (1 pedido), contar estoque, − e + até esgotar e voltar, o
// produto com o básico em cima (o preço sem rolar, o resto em "Mais detalhes", o card no estado do filtro, sair sem
// salvar pergunta, a lista marca o que ficou só no aparelho), a foto pequena que avisa, o combo que deixa de ficar
// vermelho quando corrigido, o produto novo que já nasce à venda no estado da lista, a marca "Bebida alcoólica" das
// categorias, editar o preço, mandar a foto pelo Estúdio da foto (recorte,
// antes/depois, varinha, o arquivo 9:16 com transparência, a cor do halo, "Ajustar a foto") e ver ela no card do site,
// criar produto, a thumb animada (o Estúdio do vídeo grava no navegador; sem MediaRecorder, vai o MP4 original; a
// lista mostra a thumb pequena; a thumb já salva, vinda do servidor, aparece no produto e salvar o preço não perde ela;
// o formulário aberto antes de a mídia sair no servidor não manda ela de volta), ativar a Bahia, a hora com máscara, escolher e ordenar o story, criar prêmio com a conferência ao vivo (e
// bebida fora da lista) e mudar um texto da loja. Cada passo é conferido no GET loja (o que o site lê). axe e prints
// em cada tela. No fim, o site de verdade (siteVeLoja): o que o painel mudou aparece no site (preço, foto, "RESTA 1",
// produto novo, a thumb animada tocando no card, story na ordem do dono, Bahia), o WhatsApp próprio do estado e o "o mesmo pra todos", a rua do
// mercador no celular desligada e ligada de novo (na home, o 1º story; na Home 2, ?home=2, o fim do Início), o Teste
// minha sorte desligado, o estado tirado do site e o ETag (304 sem mudança). A taxa por bairro (o editor, colar a
// lista com a prévia, os modos) fica em scripts/testar-painel-bairros.mjs, chamado daqui.

import { readFileSync } from 'node:fs'
import { fluxoBairros } from './testar-painel-bairros.mjs'

/** As telas da loja (o testar-painel.mjs confere 320 px sem rolagem lateral em cada uma). */
export const ROTAS_LOJA = ['#/mais', '#/ajuda', '#/estoque', '#/produtos', '#/produto/seda-ocb-premium-slim', '#/produtos/novo', '#/loja', '#/loja/estados', '#/loja/estado/mg', '#/loja/estado/ba', '#/loja/stories/mg', '#/loja/categorias', '#/loja/sorte', '#/loja/sorte/novo', '#/loja/sorte/premio/ocb-4-por-3']

export async function fluxoLoja({ p, BASE, ok, print, axe, foto, fotoClara, videos, browser, sharp }) {
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

  // Início → Produtos pelo atalho do topo ("Preço e estoque") e pela barra
  await p.goto(`${BASE}/painel/#/`)
  await p.getByRole('heading', { name: 'Loja', exact: true }).waitFor()
  await axe(p, 'resumo com a loja')
  const atalhos = await p.locator('.pn-fazer a').allInnerTexts()
  ok(atalhos.map((x) => x.trim()).join(' · ') === 'Preço e estoque · Novo produto · Horário e taxa · Stories', `Início: os 4 atalhos no topo (${atalhos.join(' · ')})`)
  ok(await p.locator('.pn-fazer').evaluate((e) => e.getBoundingClientRect().bottom < innerHeight - 60), 'Início: os atalhos à vista sem rolar (antes ficavam depois dos pedidos e pagamentos)')
  const barra = await p.locator('.pn-barra-item .pn-barra-nome').allInnerTexts()
  ok(barra.map((x) => x.trim()).join(' · ') === 'Início · Pedidos · Criar · Produtos · Mais', `barra do dono com o nome embaixo de cada ícone (${barra.map((x) => x.trim()).join(' · ')})`)
  await p.locator('.pn-fazer').getByRole('link', { name: 'Preço e estoque' }).tap()
  await p.getByRole('heading', { name: 'Produtos', level: 1 }).waitFor()
  ok(p.url().endsWith('#/produtos'), 'Início → Produtos pelo atalho "Preço e estoque"')
  ok((await p.locator('.pn-barra-item.ativa').innerText()).trim() === 'Produtos', 'a barra acende Produtos')
  await axe(p, 'produtos')
  await print(p, 'loja-produtos')

  // em "Todos": "À venda em:" e o chip que diz o que é (com a legenda em cima); o toque deixa o recado com "Desfazer"
  await p.getByRole('button', { name: 'Todos', exact: true }).tap()
  const linha = p.locator('.pn-prod').filter({ hasText: 'Seda OCB Premium Slim' })
  ok((await linha.getByText('À venda em:').isVisible()) && (await p.locator('.pn-legenda-chips').isVisible()), 'Todos: "À venda em:" na linha e a legenda dos chips em cima (✓ à venda · riscado fora de venda · tracejado esgotado)')
  await linha.getByRole('button', { name: /^Seda OCB Premium Slim em Minas Gerais: à venda/ }).tap()
  ok(await esperar(async () => (await ocbEm('mg'))[0] === false), 'o chip de MG tira a OCB de MG no site')
  await p.locator('.pn-recados').getByText(/Seda OCB Premium Slim saiu de MG/).waitFor()
  ok(await linha.getByRole('button', { name: /^Seda OCB Premium Slim em Minas Gerais: fora de venda/ }).isVisible(), 'o chip passa a dizer "fora de venda" (MG riscado)')
  await print(p, 'loja-produtos-chips-recado')
  await p.locator('.pn-recados').getByRole('button', { name: 'Desfazer' }).tap()
  ok(await esperar(async () => (await ocbEm('mg'))[0] === true), '"Desfazer" no recado põe a OCB de volta em MG (antes, sem recado nem desfazer)')

  // desligar e ligar num estado: 1 toque, 1 pedido
  await p.getByRole('button', { name: 'Minas Gerais', exact: true }).tap()
  let pedidos = 0
  p.on('request', (r) => r.url().includes('admin-produto-estado') && r.method() === 'POST' && pedidos++)
  await linha.locator('label.pn-troca').tap()
  ok(await esperar(async () => (await ocbEm('mg'))[0] === false), 'um toque no interruptor: a OCB sai de MG no site')
  ok(pedidos === 1, `um toque, um pedido (${pedidos})`)
  ok(await linha.getByText(/^Indisponível/).isVisible(), 'a linha diz Indisponível')
  ok(await p.locator('.pn-recados').getByRole('button', { name: 'Desfazer' }).isVisible(), 'o interruptor também deixa o recado com "Desfazer"')
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

  // o produto com o básico em cima (UX-06): foto, nome e preço, onde tem e o Salvar; o resto em "Mais detalhes"
  await linha.getByRole('link', { name: 'Seda OCB Premium Slim: editar' }).tap()
  const preco = p.getByLabel('Preço da unidade')
  await preco.waitFor()
  ok((await p.locator('.pn-recado').count()) === 0, 'abriu o produto: o recado da troca (com Desfazer) fica na lista, não vem cobrir o Salvar')
  const secoesP = (await p.locator('.pn-editar-form h2').allInnerTexts()).map((x) => x.trim())
  ok(secoesP.join(' · ') === 'Foto · Nome e preço · Onde tem', `Produto: o básico em cima (${secoesP.join(' · ')})`)
  const maisDetalhes = p.getByRole('button', { name: /^Mais detalhes/ })
  ok((await maisDetalhes.getAttribute('aria-expanded')) === 'false' && (await p.locator('#p-descricao').count()) === 0 && (await p.getByLabel('Tamanho').isVisible()), 'o resto (linha de baixo, descrição, combos, variações, desenho, anotação) em "Mais detalhes", fechado; o tamanho do lado do nome')
  const precoNaTela = await preco.evaluate((e) => {
    const r = e.getBoundingClientRect()
    return r.top >= 0 && r.bottom <= document.querySelector('.pn-editar-pe').getBoundingClientRect().top
  })
  ok(precoNaTela, 'o preço à vista sem rolar no 390×844, acima do Salvar fixo (antes, a 1,5 tela de rolagem)')
  // PNL-09: o card do lado da foto mostra o estado do filtro da lista (MG) e diz qual é
  ok((await p.locator('.pn-previa-em-sel').inputValue()) === 'mg' && /Em MG/.test(await p.locator('.pn-previa-em-sel').innerText()), 'o card do lado da foto mostra MG, o estado do filtro, e diz "Em MG" (antes, o RJ calado)')
  await axe(p, 'produto: o básico')
  await print(p, 'loja-produto-basico')
  // PNL-20: o Tamanho sem placeholder que parece valor (era "350 ml", cinza, num isqueiro)
  ok(/^ex\.: /.test((await p.getByLabel('Tamanho').getAttribute('placeholder')) ?? ''), `Tamanho com o exemplo dito como exemplo ("${await p.getByLabel('Tamanho').getAttribute('placeholder')}", não "350 ml")`)
  // o tamanho é opcional (fica do lado do nome, decisão do Ian, mas vazio salva): o rótulo diz
  ok((await p.locator('label[for="p-tamanho"]').innerText()).replace(/\s+/g, ' ').trim() === 'Tamanho (opcional)' && (await p.getByLabel('Tamanho (opcional)').count()) === 1, `o rótulo diz que o tamanho é opcional ("${(await p.locator('label[for="p-tamanho"]').innerText()).replace(/\s+/g, ' ').trim()}")`)
  {
    // a caixa do tamanho alinhada com a do nome (o rótulo pode quebrar em 2 linhas no celular estreito)
    const [yn, yt] = await Promise.all(['#p-nome', '#p-tamanho'].map((sel) => p.locator(sel).evaluate((e) => Math.round(e.getBoundingClientRect().bottom))))
    ok(Math.abs(yn - yt) <= 1, `nome e tamanho com as caixas na mesma linha (${yn} × ${yt})`)
  }
  // PNL-08: voltar com mudança pergunta; descartar volta pro preço salvo e apaga o rascunho
  await preco.fill('10,99')
  await p.getByRole('button', { name: 'Voltar', exact: true }).tap()
  const perguntaP = p.getByRole('alertdialog', { name: 'Tem mudança não salva' })
  await perguntaP.waitFor()
  ok(true, 'Produto: voltar com o preço mudado pergunta antes de sair (antes, voltava calado)')
  await print(p, 'loja-produto-pergunta')
  await perguntaP.getByRole('button', { name: 'Descartar' }).tap()
  await p.getByRole('heading', { name: 'Produtos', level: 1 }).waitFor()
  ok(/R\$\s9,99/.test(await linha.innerText()) && (await linha.locator('.pn-carimbo-rascunho').count()) === 0, 'descartou: a lista com o preço salvo, sem selo')
  await linha.getByRole('link', { name: /^Seda OCB Premium Slim: editar/ }).tap()
  await preco.waitFor()
  ok((await preco.inputValue()) === '9,99' && (await p.getByText('Continuando de onde tu parou').count()) === 0, 'descartar apagou o rascunho do aparelho')
  // saiu sem passar pelo voltar (fechou a aba, o celular matou o navegador): a lista não mostra o preço velho como salvo
  await preco.fill('10,99')
  await p.waitForTimeout(600)
  const outra = await p.context().newPage()
  await outra.goto(`${BASE}/painel/#/produtos`)
  const selo = outra.locator('.pn-prod').filter({ hasText: 'Seda OCB Premium Slim' }).locator('.pn-carimbo-rascunho')
  await selo.waitFor({ timeout: 10000 }).catch(() => {})
  ok(/não salvo: R\$\s10,99/i.test((await selo.innerText().catch(() => '')) ?? ''), `a lista marca o produto com mudança só no aparelho ("${await selo.innerText().catch(() => '')}")`)
  await print(outra, 'loja-produtos-nao-salvo')
  await outra.close()

  // editar o preço e mandar a foto (o card do site na prévia)
  await preco.fill('10,49')
  const corAntes = prod(await loja(), 'seda-ocb-premium-slim').cor
  // PNL-12: a foto pequena (60×60) avisa no Estúdio e depois, do lado da foto (sem impedir)
  if (sharp) {
    const pequena = await sharp({ create: { width: 60, height: 60, channels: 3, background: '#d04020' } }).png().toBuffer()
    const [escP] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Enviar foto').tap()])
    await escP.setFiles({ name: 'pequena.png', mimeType: 'image/png', buffer: pequena })
    const estP = p.getByRole('dialog', { name: 'Estúdio da foto' })
    await estP.waitFor()
    await estP.getByText(/Essa foto é pequena \(60×60\)/).waitFor({ timeout: 10000 }).catch(() => {})
    ok(await estP.getByText(/Essa foto é pequena \(60×60\): no site vai ficar borrada/).isVisible(), 'foto de 60×60: o Estúdio avisa que no site vai ficar borrada (antes, entrava calada)')
    await print(p, 'loja-estudio-foto-pequena')
    await estP.getByRole('button', { name: 'Usar a foto original' }).tap()
    await estP.waitFor({ state: 'detached', timeout: 30000 })
    ok(await p.locator('.pn-foto-avisos').getByText(/Essa foto é pequena \(60×60\)/).isVisible(), 'o aviso da foto pequena fica do lado da foto depois de usar')
  }
  // a dica da foto em desenho (o Estúdio recorta: o que importa é luz, o produto inteiro e o fundo liso)
  ok((await p.locator('.pn-dica-foto li').allInnerTexts()).map((x) => x.trim()).join(' · ') === 'Bem iluminada · Produto inteiro · Fundo liso', 'a dica da foto: bem iluminada, produto inteiro, fundo liso')
  // a foto do celular (fundo claro, com sombra) abre o Estúdio da foto: recorta, enquadra e mostra como o site mostra
  const [escolha] = await Promise.all([p.waitForEvent('filechooser'), p.locator('label').filter({ hasText: /Enviar foto|Trocar foto/ }).tap()])
  await escolha.setFiles(fotoClara ?? foto)
  const estudio = p.getByRole('dialog', { name: 'Estúdio da foto' })
  await estudio.waitFor()
  await estudio.locator('.pn-est-vitrines').waitFor({ timeout: 30000 })
  ok(await estudio.getByRole('checkbox', { name: 'Tirar o fundo' }).isChecked(), 'Estúdio: fundo liso, o recorte já vem ligado')
  const amostra = () =>
    estudio.locator('.pn-est-grande canvas.pn-est-real').evaluate((c) => {
      const g = c.getContext('2d')
      const em = (x, y) => [...g.getImageData(Math.round(x * c.width), Math.round(y * c.height), 1, 1).data]
      return { canto: em(0.04, 0.04), lado: em(0.04, 0.5), sombra: em(0.5, 0.95), meio: em(0.5, 0.35), rotulo: em(0.5, 0.6) }
    })
  await p.waitForTimeout(600)
  const a1 = await amostra()
  ok(a1.canto[3] === 0 && a1.sombra[3] === 0 && a1.meio[3] === 255 && a1.meio[0] > a1.meio[2] + 60 && a1.rotulo[3] === 255, `Estúdio: o fundo e a sombra saíram (transparentes), o produto ficou no meio, com o rótulo claro inteiro (${JSON.stringify(a1)})`)
  ok((await estudio.locator('.pn-est-card .pn-sq-nome').textContent()) === 'Seda OCB Premium Slim', 'a prévia do card com o nome do produto')
  await axe(p, 'estúdio da foto')
  await print(p, 'loja-estudio-depois')
  await estudio.getByRole('button', { name: 'Antes' }).tap()
  await p.waitForTimeout(400)
  ok((await amostra()).lado[3] === 255, 'Antes: a foto como veio (o fundo claro aparece)')
  await print(p, 'loja-estudio-antes')
  await estudio.getByRole('button', { name: 'Depois' }).tap()
  // a varinha: "Apagar" num pedaço do produto some com ele; "Desfazer" devolve
  await estudio.getByRole('button', { name: 'Apagar', exact: true }).tap()
  await estudio.locator('.pn-est-grande').scrollIntoViewIfNeeded()
  const caixaGrande = await estudio.locator('.pn-est-grande').boundingBox()
  await p.touchscreen.tap(caixaGrande.x + caixaGrande.width * 0.5, caixaGrande.y + caixaGrande.height * 0.35)
  await p.waitForTimeout(500)
  ok((await amostra()).meio[3] === 0, 'Apagar: o toque tirou o pedaço tocado')
  await estudio.getByRole('button', { name: 'Desfazer' }).tap()
  await p.waitForTimeout(500)
  ok((await amostra()).meio[3] === 255, 'Desfazer: voltou')
  await estudio.getByRole('button', { name: 'Mexer' }).tap()
  // o quanto do fundo apagar, girar e o tamanho mexem na prévia sem quebrar
  await estudio.getByRole('button', { name: 'Maior' }).tap()
  await estudio.getByRole('button', { name: 'Menor' }).tap()
  await estudio.getByRole('button', { name: 'Centralizar' }).tap()
  await estudio.getByRole('button', { name: 'Usar assim' }).tap()
  await estudio.waitFor({ state: 'detached', timeout: 30000 })
  await p.getByText('Trocar foto').waitFor({ timeout: 20000 })
  ok(await p.locator('.pn-foto-card img.pn-arte-foto-loja').isVisible(), 'a foto tratada aparece no card do site, do lado dos botões')
  ok(await esperar(() => p.locator('.pn-foto-card img.pn-arte-foto-loja[data-alfa]').count().then((n) => n === 1)), 'a foto tratada tem transparência: cobre o halo como no site (sem lighten)')
  ok(await p.getByRole('button', { name: 'Ajustar a foto' }).isVisible(), '"Ajustar a foto" pra foto salva')
  ok((await p.locator('.pn-foto-avisos').getByText(/foto é pequena/).count()) === 0, 'trocou por uma foto boa: o aviso da pequena sai')
  await axe(p, 'produto')
  await print(p, 'loja-produto', true)
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  await p.getByText('Seda OCB Premium Slim: salvo. O site já mostra.').waitFor()
  ok(await esperar(async () => {
    const x = prod(await loja(), 'seda-ocb-premium-slim')
    return x.preco === 10.49 && /^uploads\/[0-9a-f]+\.\w+$/.test(x.foto ?? '')
  }), 'preço novo e a foto no site')
  const ocbSalva = prod(await loja(), 'seda-ocb-premium-slim')
  const fotoSite = ocbSalva.foto
  const img = await fetch(`${BASE}/${fotoSite}`)
  ok(img.ok && /^image\//.test(img.headers.get('content-type') ?? ''), 'a foto abre pelo endereço do site')
  if (sharp) {
    const buf = Buffer.from(await img.arrayBuffer())
    const meta = await sharp(buf).metadata()
    const cantoA = (await sharp(buf).extract({ left: 5, top: 5, width: 1, height: 1 }).ensureAlpha().raw().toBuffer())[3]
    ok(meta.width === 720 && meta.height === 1280 && meta.hasAlpha && cantoA === 0, `a foto do Estúdio: 9:16 (${meta.width}×${meta.height}), com transparência (canto alfa ${cantoA}), ${meta.format}`)
  }
  const [cr, cg, cb] = [1, 3, 5].map((i) => parseInt(ocbSalva.cor.slice(i, i + 2), 16))
  ok(ocbSalva.cor !== corAntes && cr > cb + 40, `a cor do brilho (o halo do site) veio da foto (${corAntes} → ${ocbSalva.cor})`)
  // "Ajustar a foto" abre a salva no Estúdio (já recortada: o recorte só confere a transparência)
  await p.goto(`${BASE}/painel/#/produto/seda-ocb-premium-slim`)
  await p.getByRole('button', { name: 'Ajustar a foto' }).waitFor()
  await p.getByRole('button', { name: 'Ajustar a foto' }).tap()
  await estudio.waitFor()
  await estudio.locator('.pn-est-vitrines').waitFor({ timeout: 30000 })
  ok(!(await estudio.getByRole('button', { name: 'Usar a foto original' }).count()), 'ajustando a salva: sem "Usar a foto original" (a original é a que já está)')
  await estudio.getByRole('button', { name: 'Cancelar' }).tap()
  await estudio.waitFor({ state: 'detached' })
  ok(JSON.stringify(await ocbEm('mg')) === '[true,1]', 'salvar o produto não mexeu no estoque contado')

  // produto novo pela lista em MG: já nasce à venda em MG e o botão diz onde
  await p.goto(`${BASE}/painel/#/produtos`)
  await p.getByRole('heading', { name: 'Produtos', level: 1 }).waitFor()
  await p.getByRole('link', { name: 'Novo produto' }).tap()
  await p.getByLabel('Nome', { exact: true }).waitFor()
  ok(p.url().endsWith('#/produtos/novo?uf=mg'), `o "Novo" da lista em MG leva o estado (${p.url().split('#')[1]})`)
  ok((await p.locator('#p-est-mg').isChecked()) && !(await p.locator('#p-est-rj').isChecked()), 'produto novo vindo da lista em MG: já nasce à venda em MG (antes, nascia fora de venda)')
  const criar = p.getByRole('button', { name: 'Criar e pôr à venda em MG' })
  ok(await criar.isVisible(), 'o botão diz onde vai à venda ("Criar e pôr à venda em MG")')
  await p.getByLabel('Nome', { exact: true }).fill('Isqueiro Bic Mini')
  await p.getByLabel('Categoria').selectOption('acessorios')
  await p.getByLabel('Preço da unidade').fill('6,50')
  // PNL-04: o combo errado fica vermelho; corrigido, o erro some na hora (e aparece a economia)
  await p.getByRole('button', { name: /^Mais detalhes/ }).tap()
  await p.getByRole('button', { name: 'Adicionar combo' }).tap()
  await p.getByLabel('Combo 1: preço').fill('20')
  await criar.tap()
  ok(/mais barato que 2 avulsos/.test(await p.locator('.pn-linha-combo').innerText()), 'combo de 2 por R$ 20 (mais caro que 2 avulsos): o erro aparece')
  await p.getByLabel('Combo 1: preço').fill('12')
  ok((await p.locator('.pn-linha-combo .pn-erro').count()) === 0 && (await p.getByText(/Economiza R\$\s1,00 no combo/).isVisible()), 'corrigiu o combo: o erro some na hora e aparece a economia (antes, ficava vermelho até salvar de novo)')
  await p.getByRole('button', { name: 'Tirar o combo 1' }).tap()
  await axe(p, 'produto novo')
  await print(p, 'loja-produto-novo', true)
  await criar.tap()
  await p.getByText(/Isqueiro Bic Mini criado e à venda em MG/).waitFor()
  ok(await esperar(async () => {
    const x = prod(await loja(), 'isqueiro-bic-mini')
    return x?.preco === 6.5 && x.disponivel.mg === true && x.disponivel.rj === false
  }), 'produto novo no site, à venda só em MG')
  ok(!('tamanho' in prod(await loja(), 'isqueiro-bic-mini')), 'criado com o tamanho vazio (é opcional): salvou, e o site recebe sem tamanho (nada de " · " sobrando)')
  {
    // tamanho preenchido e depois apagado: salva vazio de novo
    await p.goto(`${BASE}/painel/#/produto/isqueiro-bic-mini`)
    await p.getByRole('heading', { name: 'Editar produto' }).waitFor()
    await p.getByLabel('Tamanho (opcional)').fill('mini')
    await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
    await p.getByText('Isqueiro Bic Mini: salvo. O site já mostra.').waitFor()
    ok(prod(await loja(), 'isqueiro-bic-mini').tamanho === 'mini', 'tamanho preenchido vai pro site')
    // (salvar volta pra lista, pelo history.back(): espera chegar lá antes do próximo goto, senão o back chega depois
    // e desfaz o goto)
    await p.getByRole('heading', { name: 'Editar produto' }).waitFor({ state: 'detached' })
    await p.goto(`${BASE}/painel/#/produto/isqueiro-bic-mini`)
    await p.getByRole('heading', { name: 'Editar produto' }).waitFor()
    ok((await p.getByLabel('Tamanho (opcional)').inputValue()) === 'mini', 'o tamanho salvo volta no campo')
    await p.getByLabel('Tamanho (opcional)').fill('')
    await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
    await p.getByText('Isqueiro Bic Mini: salvo. O site já mostra.').waitFor()
    await p.getByRole('heading', { name: 'Editar produto' }).waitFor({ state: 'detached' })
    ok(await esperar(async () => !('tamanho' in prod(await loja(), 'isqueiro-bic-mini'))), 'apagou o tamanho: salva vazio (o servidor aceita) e o site volta a receber sem')
  }

  // a thumb animada: um vídeo do celular → o trecho → o mesmo estilo, gravado no navegador → no produto → no site
  if (videos) {
    await p.goto(`${BASE}/painel/#/produto/isqueiro-bic-mini`)
    await p.getByRole('heading', { name: 'Editar produto' }).waitFor()
    const [ev] = await Promise.all([p.waitForEvent('filechooser'), p.locator('label', { hasText: 'Escolher vídeo' }).tap()])
    await ev.setFiles(videos.webm)
    const ev2 = p.getByRole('dialog', { name: 'Thumb animada' })
    await ev2.waitFor()
    await ev2.getByText('No story', { exact: true }).waitFor({ timeout: 40000 })
    const dur = ev2.getByLabel('Duração')
    ok((await dur.inputValue()) === '4' && (await ev2.getByLabel('Começa em').inputValue()) === '0', `trecho: começa em 0 e o vídeo curto (4 s) vem inteiro marcado (${await dur.inputValue()})`)
    await dur.fill('3')
    ok((await ev2.locator('output[for="est-dur"]').textContent()) === '3,0 s', 'a duração muda pra 3 s')
    await p.waitForTimeout(1500)
    await ev2.getByText('No story', { exact: true }).waitFor({ timeout: 40000 })
    ok(await ev2.getByRole('checkbox', { name: 'Tirar o fundo' }).isChecked(), 'vídeo em fundo liso: tira o fundo')
    // fundo claro: nada de janela (não é gravação da tela) e nenhum aviso de moldura
    ok((await p.evaluate(() => window.__gcJanela)) === null && (await ev2.getByText(/gravação da tela|Usar o vídeo inteiro/).count()) === 0, 'vídeo de fundo claro: não acha moldura nem corta nada (o caso de sempre segue igual)')
    // a prévia: o 1º quadro tratado sobre preto (o canto escuro, o produto laranja no meio)
    const q = await ev2.locator('.pn-est-palco canvas').evaluate((c) => {
      const t = document.createElement('canvas')
      t.width = c.width
      t.height = c.height
      const g = t.getContext('2d')
      g.drawImage(c, 0, 0)
      const em = (x, y) => [...g.getImageData(Math.round(x * c.width), Math.round(y * c.height), 1, 1).data]
      return { canto: em(0.05, 0.05), meio: em(0.5, 0.5) }
    })
    ok(q.canto[0] < 20 && q.canto[1] < 20 && q.meio[0] > 150 && q.meio[2] < 120, `prévia do vídeo: fundo virou preto, produto no meio (${JSON.stringify(q)})`)
    await axe(p, 'estúdio do vídeo')
    await print(p, 'loja-estudio-video')
    await ev2.getByRole('button', { name: 'Usar assim' }).tap()
    await ev2.waitFor({ state: 'detached', timeout: 90000 })
    const grav = await p.evaluate(() => window.__gcGravacao)
    ok(!!grav && grav.quadros > 0 && grav.bytes > 1000 && grav.bytes < 3 * 1048576, `gravou no navegador: ${JSON.stringify(grav)}`)
    await p.getByText('Trocar vídeo').waitFor()
    ok(await p.locator('.pn-video-produto video.pn-arte-video').count() === 1, 'a thumb animada pequena aparece no produto')
    // a thumb animada sem o halo (como no site: o quadro não tem transparência e o halo vazava pelo escuro do produto)
    const haloThumb = await p.locator('.pn-video-produto .pn-foto-card .pn-arte').first().evaluate((el) => ({ classe: el.classList.contains('pn-arte-halo-site'), antes: getComputedStyle(el, '::before').backgroundImage }))
    ok(!haloThumb.classe && !/url\(/.test(haloThumb.antes), `a thumb animada que o dono gravou fica sem o halo pontilhado (${JSON.stringify(haloThumb).slice(0, 80)})`)
    await print(p, 'loja-produto-video', true)
    await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
    await p.getByText('Isqueiro Bic Mini: salvo. O site já mostra.').waitFor()
    // o recado do salvar de antes (o tamanho) pode ainda estar na tela: só sair do produto prova que este salvou (e o
    // history.back() chega antes do próximo goto)
    await p.getByRole('heading', { name: 'Editar produto' }).waitFor({ state: 'detached' })
    await esperar(async () => !!prod(await loja(), 'isqueiro-bic-mini').video)
    const comVideo = prod(await loja(), 'isqueiro-bic-mini')
    ok(/^uploads\/[0-9a-f]{24}\.(webm|mp4)$/.test(comVideo.video ?? '') && /^uploads\/[0-9a-f]{24}\.\w+$/.test(comVideo.capa ?? ''), `o GET loja leva o vídeo e a capa (${comVideo.video}, ${comVideo.capa})`)
    const arq = await fetch(`${BASE}/${comVideo.video}`)
    ok(arq.ok && /^video\/(webm|mp4)$/.test(arq.headers.get('content-type') ?? ''), `o vídeo abre pelo endereço do site (${arq.headers.get('content-type')})`)
    // a lista de produtos mostra a thumb animada pequena
    await p.goto(`${BASE}/painel/#/produtos`)
    await p.getByRole('heading', { name: 'Produtos', level: 1 }).waitFor()
    const linhaV = p.locator('.pn-prod').filter({ hasText: 'Isqueiro Bic Mini' })
    ok((await linhaV.locator('video.pn-arte-video').count()) === 1, 'a lista de produtos mostra a thumb animada pequena')
    await print(p, 'loja-produtos-thumb')

    // a gravação da tela (o reel dentro do story do Instagram, como a loja manda): a janela do vídeo é achada sozinha,
    // a interface (a barra do celular, o nome do perfil, o tempo do reel, "Enviar mensagem") fica de fora, o preto do
    // reel vira preto liso (nada do retângulo roxo) e o produto fica grande e no meio. Com GC_TESTE_REEL, também no
    // reel de verdade
    for (const [arquivo, rotulo, produto] of [[videos.tela, 'gravação da tela (sintética)', 'gin-tanqueray-london-dry'], ...(videos.reel ? [[videos.reel, 'o reel do Hennessy como veio (GC_TESTE_REEL)', 'jagermeister-700ml']] : [])]) {
      await p.goto(`${BASE}/painel/#/produto/${produto}`)
      await p.getByRole('heading', { name: 'Editar produto' }).waitFor()
      await p.evaluate(() => delete window.__gcJanela)
      const [evT] = await Promise.all([p.waitForEvent('filechooser'), p.locator('label', { hasText: /Escolher vídeo|Trocar vídeo/ }).tap()])
      await evT.setFiles(arquivo)
      const dT = p.getByRole('dialog', { name: 'Thumb animada' })
      await dT.waitFor()
      await p.waitForFunction(() => window.__gcJanela !== undefined, null, { timeout: 60000 })
      const jan = await p.evaluate(() => window.__gcJanela)
      ok(!!jan && jan.moldura === true, `${rotulo}: achou a moldura do Instagram (${JSON.stringify(jan)})`)
      if (arquivo === videos.tela)
        ok(!!jan && Math.abs(jan.x0 * 384 - 40) < 8 && Math.abs(jan.x1 * 384 - 344) < 8 && jan.y0 * 832 > 138 && jan.y0 * 832 < 230 && Math.abs(jan.y1 * 832 - 658) < 8, `${rotulo}: a janela é a do reel, sem o nome do perfil e o tempo de cima (em px: ${jan && [jan.x0 * 384, jan.y0 * 832, jan.x1 * 384, jan.y1 * 832].map(Math.round).join(', ')})`)
      await dT.getByText('cortei a moldura e o texto da tela', { exact: false }).waitFor({ timeout: 60000 })
      await dT.getByText('O fundo desse vídeo já é preto', { exact: false }).waitFor({ timeout: 60000 })
      ok(true, `${rotulo}: avisa que cortou a moldura e que o fundo já é preto`)
      await dT.getByText('No story', { exact: true }).waitFor({ timeout: 60000 })
      await p.waitForTimeout(1500)
      await dT.getByText('No story', { exact: true }).waitFor({ timeout: 60000 })
      const olhar = (sel) =>
        dT.locator(sel).first().evaluate((c) => {
          const t = document.createElement('canvas')
          t.width = c.width
          t.height = c.height
          const g = t.getContext('2d')
          g.drawImage(c, 0, 0)
          const d = g.getImageData(0, 0, c.width, c.height).data
          let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1, faixas = 0
          for (let y = 0; y < c.height; y++)
            for (let x = 0; x < c.width; x++) {
              const i = (y * c.width + x) * 4
              if (d[i] + d[i + 1] + d[i + 2] > 60) {
                if (x < x0) x0 = x
                if (x > x1) x1 = x
                if (y < y0) y0 = y
                if (y > y1) y1 = y
                if (y < c.height * 0.1 || y > c.height * 0.94) faixas++
              }
            }
          // o fundo: tudo fora da caixa do produto (com folga), o canal mais claro
          const m = Math.round(c.width * 0.04)
          let maxPreto = 0
          for (let y = 0; y < c.height; y++)
            for (let x = 0; x < c.width; x++) {
              if (x >= x0 - m && x <= x1 + m && y >= y0 - m && y <= y1 + m) continue
              const i = (y * c.width + x) * 4
              maxPreto = Math.max(maxPreto, d[i], d[i + 1], d[i + 2])
            }
          return { w: c.width, h: c.height, caixa: [x0, y0, x1, y1], faixas, maxPreto }
        })
      const q = await olhar('.pn-est-palco canvas')
      ok(q.faixas === 0, `${rotulo}: nada da interface na prévia (faixa de cima e de baixo pretas: ${q.faixas} pixels acesos)`)
      ok(q.maxPreto <= 3, `${rotulo}: o preto do reel vira preto liso, sem o retângulo roxo (o mais claro do fundo: ${q.maxPreto})`)
      const alt = (q.caixa[3] - q.caixa[1]) / q.h
      const meio = (q.caixa[0] + q.caixa[2]) / 2 / q.w
      ok(alt > 0.62 && Math.abs(meio - 0.5) < 0.06, `${rotulo}: o produto grande e no meio (${(alt * 100).toFixed(0)}% da altura, centro em ${(meio * 100).toFixed(0)}%)`)
      if (arquivo === videos.tela) {
        await print(p, 'loja-estudio-video-gravacao-tela')
        // o dono pode usar o vídeo inteiro (e voltar)
        await dT.getByRole('button', { name: 'Usar o vídeo inteiro' }).tap()
        await dT.getByText('Usando o vídeo inteiro, com a moldura do Instagram em volta.').waitFor()
        await dT.getByText('No story', { exact: true }).waitFor({ timeout: 60000 })
        await p.waitForTimeout(1500)
        const inteiro = await olhar('.pn-est-palco canvas')
        ok(inteiro.faixas > 0 || inteiro.maxPreto > 3, `"Usar o vídeo inteiro": a moldura volta pra prévia (${inteiro.faixas} acesos nas faixas, fundo até ${inteiro.maxPreto})`)
        await dT.getByRole('button', { name: 'Cortar a moldura' }).tap()
        await dT.getByText('cortei a moldura e o texto da tela', { exact: false }).waitFor()
        await dT.getByText('No story', { exact: true }).waitFor({ timeout: 60000 })
        await p.waitForTimeout(1500)
        const devolta = await olhar('.pn-est-palco canvas')
        ok(devolta.faixas === 0 && devolta.maxPreto <= 3, `"Cortar a moldura": volta a cortar (${devolta.faixas} acesos, fundo até ${devolta.maxPreto})`)
        await axe(p, 'estúdio do vídeo com a gravação da tela')
      }
      await dT.getByRole('button', { name: 'Usar assim' }).tap()
      await dT.waitFor({ state: 'detached', timeout: 120000 })
      await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
      await p.getByText(/: salvo\. O site já mostra\./).waitFor()
      await p.getByRole('heading', { name: 'Editar produto' }).waitFor({ state: 'detached' })
      const pr = prod(await loja(), produto)
      // a capa gravada (o 1º quadro tratado): sem a interface, o preto liso, o produto grande
      const capa = await p.evaluate(async (u) => {
        const img = new Image()
        img.src = `../${u}`
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0)
        const d = g.getImageData(0, 0, c.width, c.height).data
        let x0 = c.width, x1 = -1, y0 = c.height, y1 = -1, faixas = 0
        for (let y = 0; y < c.height; y++)
          for (let x = 0; x < c.width; x++) {
            const i = (y * c.width + x) * 4
            if (d[i] + d[i + 1] + d[i + 2] > 60) {
              x0 = Math.min(x0, x)
              x1 = Math.max(x1, x)
              y0 = Math.min(y0, y)
              y1 = Math.max(y1, y)
              if (y < c.height * 0.1 || y > c.height * 0.94) faixas++
            }
          }
        const m = Math.round(c.width * 0.04)
        let maxPreto = 0
        for (let y = 0; y < c.height; y++)
          for (let x = 0; x < c.width; x++) {
            if (x >= x0 - m && x <= x1 + m && y >= y0 - m && y <= y1 + m) continue
            const i = (y * c.width + x) * 4
            maxPreto = Math.max(maxPreto, d[i], d[i + 1], d[i + 2])
          }
        return { alt: (y1 - y0) / c.height, faixas, maxPreto }
      }, pr.capa)
      ok(/^uploads\//.test(pr.video ?? '') && capa.faixas === 0 && capa.maxPreto <= 6 && capa.alt > 0.62, `${rotulo}: a thumb gravada e a capa saem sem a interface, no preto liso e com o produto grande (${JSON.stringify(capa)})`)
    }

    // navegador sem MediaRecorder (iPhone antigo): manda o MP4 original pequeno, que o site só enquadra
    const semRec = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR', storageState: await p.context().storageState() })
    await semRec.addInitScript(() => {
      delete window.MediaRecorder
    })
    const r = await semRec.newPage()
    await r.goto(`${BASE}/painel/#/produto/dichavador-metal-4-partes`)
    await r.getByRole('heading', { name: 'Editar produto' }).waitFor()
    const [ev3] = await Promise.all([r.waitForEvent('filechooser'), r.locator('label', { hasText: 'Escolher vídeo' }).tap()])
    await ev3.setFiles(videos.mp4)
    const d3 = r.getByRole('dialog', { name: 'Thumb animada' })
    await d3.getByText(/no Chrome fica no estilo da loja/).waitFor({ timeout: 30000 })
    ok(true, 'sem MediaRecorder: avisa que no Chrome fica no estilo da loja')
    await print(r, 'loja-video-sem-gravar')
    await d3.getByRole('button', { name: 'Mandar o vídeo original' }).tap()
    await d3.waitFor({ state: 'detached', timeout: 60000 })
    await r.getByRole('button', { name: 'Salvar', exact: true }).tap()
    await r.getByText(/Dichavador.*salvo/).waitFor()
    const orig = prod(await loja(), 'dichavador-metal-4-partes')
    ok(/\.mp4$/.test(orig.video ?? '') && !!orig.capa, `o MP4 original foi pro produto, com a capa (${orig.video})`)
    const tam = (await (await fetch(`${BASE}/${orig.video}`)).arrayBuffer()).byteLength
    const { statSync } = await import('node:fs')
    ok(tam === statSync(videos.mp4).size, 'é o arquivo original, byte a byte')
    await semRec.close()
  } else ok(true, 'sem ffmpeg aqui: a thumb animada no painel fica de fora')

  // os 4 do material de 11/10 no desenho do site, como o resto do catálogo (pedido do Ian em 15/10: nada da foto nem da
  // thumb animada de fábrica). No painel, o card do produto mostra o desenho com o halo (a ilustração do site, onde o
  // produto tem uma, ou a arte em pixel), "Enviar foto" e a linha da thumb animada vazia; a foto ou o vídeo, se o dono
  // quiser, ele põe pelo Estúdio (o do vídeo foi testado logo acima, no Isqueiro, com o vídeo que o teste sobe)
  {
    const realistas = new Set([...readFileSync(new URL('../src/arte/realista/ids.ts', import.meta.url), 'utf8').matchAll(/^\s+'([a-z0-9-]+)',$/gm)].map((m) => m[1]))
    for (const id of ['hennessy-very-special', 'fanta-ghost-face-punch', 'jack-daniels-tennessee-apple', 'fanta-maca-china']) {
      const noSite = prod(await loja(), id)
      ok(noSite.foto === null && !noSite.video && !noSite.capa, `${id}: o GET loja sem foto e sem thumb animada`)
      await p.goto(`${BASE}/painel/#/produto/${id}`)
      await p.getByRole('heading', { name: 'Editar produto' }).waitFor()
      const arte = p.locator('.pn-foto-produto:not(.pn-video-produto) .pn-sq-arte .pn-arte').first()
      const ilustracao = realistas.has(id)
      const desenho = await arte
        .locator(ilustracao ? 'svg.pn-arte-svg' : 'img.pn-arte-pixel')
        .first()
        .waitFor({ timeout: 15000 })
        .then(() => true, () => false)
      const visto = await arte.evaluate((el) => ({ foto: !!el.querySelector('img.pn-arte-foto, video'), halo: el.classList.contains('pn-arte-halo-site') }))
      ok(desenho && !visto.foto && visto.halo, `${id}: o card do painel mostra ${ilustracao ? 'a ilustração do site' : 'o desenho em pixel'} com o halo, sem foto nem vídeo (${JSON.stringify(visto)})`)
      ok(await p.getByText(ilustracao ? 'Sem foto, vale a ilustração do site (a do card).' : 'Sem foto, vale o desenho em pixel (Mais detalhes › Desenho).').isVisible(), `${id}: o painel diz o que vale sem foto`)
      ok((await p.getByText('Enviar foto', { exact: true }).isVisible()) && (await p.getByText('Escolher vídeo', { exact: true }).isVisible()) && (await p.getByText('Trocar vídeo').count()) === 0 && (await p.locator('.pn-video-produto .pn-video-vazio').count()) === 1, `${id}: "Enviar foto" e "Escolher vídeo" (nada de fábrica no lugar)`)
      if (id === 'hennessy-very-special') await print(p, 'loja-produto-desenho-hennessy')
    }
    // a lista de produtos: os 4 com o desenho pequeno, sem foto e sem thumb
    await p.goto(`${BASE}/painel/#/produtos`)
    await p.getByRole('heading', { name: 'Produtos', level: 1 }).waitFor()
    await p.getByRole('button', { name: 'Todos', exact: true }).tap()
    for (const nome of ['Hennessy Very Special', 'Fanta Ghost Face Punch', "Jack Daniel's Tennessee Apple", 'Fanta Maçã da China']) {
      const l = p.locator('.pn-prod').filter({ hasText: nome }).first()
      const ok1 = await l.locator('.pn-arte svg.pn-arte-svg, .pn-arte img.pn-arte-pixel').first().waitFor({ timeout: 15000 }).then(() => true, () => false)
      ok(ok1 && (await l.locator('.pn-arte img.pn-arte-foto, .pn-arte video').count()) === 0, `lista de produtos: ${nome} com o desenho, sem foto nem thumb`)
    }
    await print(p, 'loja-produtos-desenho')
    // salvar outra coisa (o preço) não traz mídia nenhuma; depois volta pro "Consultar"
    for (const v of ['199,90', '']) {
      await p.goto(`${BASE}/painel/#/produto/hennessy-very-special`)
      await p.getByRole('heading', { name: 'Editar produto' }).waitFor()
      await p.getByLabel('Preço da unidade').fill(v)
      await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
      await p.getByText(/Hennessy Very Special: salvo/).waitFor()
      // salvar volta pra lista (history.back()): espera chegar lá, pro próximo goto não ser desfeito por ele
      await p.getByRole('heading', { name: 'Editar produto' }).waitFor({ state: 'detached' })
      const h = prod(await loja(), 'hennessy-very-special')
      ok(h.foto === null && !h.video && !h.capa && h.preco === (v ? 199.9 : null), `salvar o Hennessy (preço ${v || 'vazio = Consultar'}) continua no desenho, sem foto e sem vídeo`)
    }
  }

  // a thumb animada já salva, vinda do servidor: a de fábrica (está no build; o dono pode pôr pela API, testar-api-video)
  // num produto que não é dos 4, o Dr Pepper. O painel abre o produto com ela (o MP4 de fábrica é H.264: no Chromium
  // daqui, sem H.264, o vídeo dá erro e a miniatura cai na capa parada), "Trocar vídeo", sem o halo, e salvar outro campo
  // (o preço) não perde a thumb. Fora do `if (videos)`: roda também sem ffmpeg. No fim, sai (video: null)
  {
    const apiPainel = (rota, corpo) =>
      p.evaluate(
        async ([rota, corpo]) => {
          const csrf = (await (await fetch('../api/index.php?r=admin-sessao', { credentials: 'same-origin' })).json()).csrf
          const r = await fetch(`../api/index.php?r=${rota}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf }, body: JSON.stringify(corpo), credentials: 'same-origin' })
          return r.status
        },
        [rota, corpo],
      )
    const VIDEO = 'produtos/hennessy-very-special.mp4'
    const CAPA = 'produtos/hennessy-very-special-capa.webp'
    const antes = prod(await loja(), 'dr-pepper')
    ok((await apiPainel('admin-produto-salvar', { id: 'dr-pepper', video: VIDEO, capa: CAPA })) === 200, 'a thumb de fábrica no Dr Pepper, pela API (o vídeo e a capa que estão no build)')
    await p.goto(`${BASE}/painel/#/produto/dr-pepper`)
    await p.reload()
    await p.getByRole('heading', { name: 'Editar produto' }).waitFor()
    const h264 = await p.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"') !== '')
    const card = p.locator('.pn-video-produto .pn-foto-card')
    const esperado = h264 ? card.locator(`video.pn-arte-video[src="../${VIDEO}"][poster="../${CAPA}"]`) : card.locator(`img.pn-arte-foto[src="../${CAPA}"]`)
    ok(await esperado.waitFor({ timeout: 15000 }).then(() => true, () => false), h264 ? 'a thumb salva no produto, com a capa de pôster' : 'a thumb salva no produto (sem H.264 aqui, a miniatura fica na capa parada, sem cair num desenho qualquer)')
    ok(await p.getByText('Trocar vídeo').isVisible(), 'a linha da thumb animada sabe que tem vídeo ("Trocar vídeo")')
    const halo = await card.locator('.pn-arte').first().evaluate((el) => ({ classe: el.classList.contains('pn-arte-halo-site'), antes: getComputedStyle(el, '::before').backgroundImage }))
    ok(!halo.classe && !/url\(/.test(halo.antes), `a thumb salva fica sem o halo pontilhado (${JSON.stringify(halo).slice(0, 80)})`)
    await print(p, 'loja-produto-thumb-salva')
    for (const v of ['199,90', '']) {
      await p.goto(`${BASE}/painel/#/produto/dr-pepper`)
      await p.getByRole('heading', { name: 'Editar produto' }).waitFor()
      await p.getByLabel('Preço da unidade').fill(v)
      await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
      await p.getByText(/Dr Pepper: salvo/).waitFor()
      await p.getByRole('heading', { name: 'Editar produto' }).waitFor({ state: 'detached' })
      const d = prod(await loja(), 'dr-pepper')
      ok(d.video === VIDEO && d.capa === CAPA && d.preco === (v ? 199.9 : null), `salvar o produto (preço ${v || 'vazio = Consultar'}) mantém a thumb salva (${d.video}, ${d.capa})`)
    }
    // o formulário aberto antes de outra mudança no servidor (outro aparelho, ou a migração 106 tirando a mídia de
    // fábrica): salvar o preço nele não manda de volta a foto nem a thumb que saíram (o painel só manda a mídia que mudou
    // no formulário; antes mandava sempre, e a mídia de fábrica voltava)
    ok((await apiPainel('admin-produto-salvar', { id: 'dr-pepper', foto: 'produtos/fanta-ghost-face-punch.webp' })) === 200, 'uma foto de fábrica no Dr Pepper também, pela API')
    await p.goto(`${BASE}/painel/#/produto/dr-pepper`)
    await p.reload()
    await p.getByRole('heading', { name: 'Editar produto' }).waitFor()
    await p.getByLabel('Preço da unidade').waitFor()
    ok((await apiPainel('admin-produto-salvar', { id: 'dr-pepper', foto: null, video: null })) === 200, 'com o formulário aberto, a foto e a thumb saem no servidor (como a 106 faz)')
    await p.getByLabel('Preço da unidade').fill('9,90')
    await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
    await p.getByText(/Dr Pepper: salvo/).waitFor()
    await p.getByRole('heading', { name: 'Editar produto' }).waitFor({ state: 'detached' })
    const velho = prod(await loja(), 'dr-pepper')
    ok(velho.foto === null && !velho.video && !velho.capa && velho.preco === 9.9, `salvar o preço no formulário aberto antes não religa a foto nem a thumb que saíram (${JSON.stringify([velho.foto, velho.video ?? null, velho.capa ?? null, velho.preco])})`)
    ok((await apiPainel('admin-produto-salvar', { id: 'dr-pepper', foto: null, video: null, preco: antes.preco })) === 200, 'o Dr Pepper volta como estava (sem foto, sem thumb, o preço de antes)')
  }

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

  // Estado: horário em cima; sair com mudança pergunta; o rascunho volta depois de recarregar
  await p.goto(`${BASE}/painel/#/loja/estado/mg`)
  await p.getByLabel('Segunda: abre às').waitFor()
  const secoes = await p.locator('.pn-editar-form h2').allInnerTexts()
  ok(secoes.map((x) => x.trim()).join(' · ') === 'Horário de entrega · Taxa de entrega · Pedido mínimo pra entrega · Entrega grátis · Pagamento · Cidades · WhatsApp do pedido · Perfil · Tirar do site', `Estado na ordem nova, o "tirar do site" por último (${secoes.join(' · ')})`)
  ok((await p.locator('#e-ativo').count()) === 0, 'Estado: sem o interruptor "Aparece no site" no topo')
  await p.getByLabel('Segunda: abre às').fill('15:00')
  await p.getByRole('button', { name: 'Voltar', exact: true }).tap()
  const pergunta = p.getByRole('alertdialog', { name: 'Tem mudança não salva' })
  await pergunta.waitFor()
  const botoesPergunta = (await pergunta.getByRole('button').allInnerTexts()).map((x) => x.trim()).filter(Boolean).join(' · ')
  ok(botoesPergunta.endsWith('Salvar · Descartar · Continuar editando'), `voltar com mudança: pergunta antes de sair (${botoesPergunta})`)
  await axe(p, 'mudança não salva')
  await print(p, 'loja-estado-pergunta')
  await pergunta.getByRole('button', { name: 'Continuar editando' }).tap()
  await pergunta.waitFor({ state: 'detached' })
  ok(p.url().endsWith('#/loja/estado/mg') && (await p.getByLabel('Segunda: abre às').inputValue()) === '15:00', 'continuar editando: fica na tela, com o que tava digitado')
  await p.waitForTimeout(500)
  await p.reload()
  await p.getByText('Continuando de onde tu parou').waitFor()
  ok((await p.getByLabel('Segunda: abre às').inputValue()) === '15:00', 'Estado: recarregou e o rascunho voltou (antes, perdia)')
  await p.goBack()
  await pergunta.waitFor()
  ok(p.url().endsWith('#/loja/estado/mg'), 'voltar do Android com mudança: fica na tela e pergunta')
  await pergunta.getByRole('button', { name: 'Descartar' }).tap()
  await p.waitForFunction(() => !location.hash.includes('/estado/'), null, { timeout: 5000 }).catch(() => {})
  ok(!p.url().includes('/estado/mg'), `descartar: sai da tela (${p.url().split('#')[1]})`)
  await p.goto(`${BASE}/painel/#/loja/estado/mg`)
  await p.getByLabel('Segunda: abre às').waitFor()
  ok((await p.getByText('Continuando de onde tu parou').count()) === 0 && (await p.getByLabel('Segunda: abre às').inputValue()) !== '15:00', 'descartou: o rascunho saiu junto')
  // taxa 0: sugere entrega grátis e não salva como valor fixo
  await p.getByText('Um valor fixo').tap()
  await p.locator('#e-taxa').fill('0')
  ok(await p.getByText('Taxa R$ 0? Liga a “Entrega grátis”').isVisible(), 'taxa R$ 0: sugere ligar a entrega grátis')
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  ok(/Taxa R\$ 0,00: pra entregar sem taxa/.test(await p.locator('#e-taxa-erro').innerText().catch(() => '')), 'taxa R$ 0 não salva como valor fixo (antes, salvava {"valor":0})')
  await p.locator('#e-taxa').fill('8,00')
  // salvar um estado que já existe volta sozinho pra lista (voltar → history.back, quando a resposta chega): o p.goto
  // seguinte só vai depois disso, senão a volta chega atrasada e tira a tela que o teste abriu
  const saiuDoEstado = () => p.locator('#e-pedidoMinimo').waitFor({ state: 'detached', timeout: 15000 })
  // a cidade digitada sem tocar em "Adicionar" entra ao salvar
  await p.locator('#e-cidade-nova').fill('Nanuque')
  // a hora com máscara: "930" vira 09:30; salva e o horário deixa de ser exemplo
  const abre = p.getByLabel('Segunda: abre às')
  await abre.fill('930')
  ok((await abre.inputValue()) === '9:30', `digitando "930": 9:30 (${await abre.inputValue()})`)
  await abre.press('Tab')
  ok((await abre.inputValue()) === '09:30', `saindo do campo: 09:30 (${await abre.inputValue()})`)
  await axe(p, 'estado')
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  await p.getByText('Minas Gerais: salvo. O site já mostra.').waitFor()
  await saiuDoEstado()
  ok(await esperar(async () => {
    const e = (await loja()).estados.find((x) => x.uf === 'mg')
    return e.horario.demo === false && e.horario.semana[1]?.[0] === '09:30'
  }), 'horário salvo: o site mostra o de verdade (segunda abre 09:30)')
  ok(await esperar(async () => JSON.stringify((await loja()).estados.find((x) => x.uf === 'mg').cidades).includes('Nanuque')), 'a cidade digitada sem "Adicionar" entrou ao salvar (antes, sumia)')
  // tira a cidade de novo (o pedido no site, mais embaixo, conta com MG de uma cidade só)
  await p.goto(`${BASE}/painel/#/loja/estado/mg`)
  await p.getByRole('button', { name: 'Tirar Nanuque' }).tap()
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  await saiuDoEstado()
  ok(await esperar(async () => !JSON.stringify((await loja()).estados.find((x) => x.uf === 'mg').cidades).includes('Nanuque')), 'tirou a cidade e salvou: o site deixa de mostrar')

  // pedido mínimo pra entrega: vazio = sem; fora da faixa não salva; salvo, o site recebe no GET loja; tira de novo
  // (o pedido no site, mais embaixo, fecha com qualquer valor)
  await p.goto(`${BASE}/painel/#/loja/estado/mg`)
  const minimo = p.getByRole('textbox', { name: 'Valor mínimo' })
  await minimo.waitFor()
  ok((await minimo.inputValue()) === '' && /Sem mínimo: qualquer pedido fecha/.test(await p.locator('#e-pedidoMinimo-dica').innerText()), 'pedido mínimo: começa vazio (sem mínimo), e a dica diz isso')
  ok(!('pedidoMinimo' in (await loja()).estados.find((x) => x.uf === 'mg')), 'sem mínimo: o GET loja nem manda o campo')
  await minimo.fill('2000')
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  ok(/R\$ 0,01 a R\$ 1\.000,00/.test(await p.locator('#e-pedidoMinimo-erro').innerText().catch(() => '')), 'pedido mínimo de R$ 2.000: não salva, diz a faixa')
  await minimo.fill('20')
  ok(/fica travado até a sacola chegar em R\$ 20,00/.test(await p.locator('#e-pedidoMinimo-dica').innerText()), 'pedido mínimo de 20: a dica conta o que o site faz')
  await axe(p, 'estado com pedido mínimo')
  await print(p, 'loja-estado-minimo')
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  await p.getByText('Minas Gerais: salvo. O site já mostra.').waitFor()
  await saiuDoEstado()
  ok(await esperar(async () => (await loja()).estados.find((x) => x.uf === 'mg').pedidoMinimo === 20), 'salvou o mínimo de R$ 20: o site recebe pedidoMinimo 20 no GET loja')
  await p.goto(`${BASE}/painel/#/loja/estados`)
  await p.getByText(/mínimo R\$ 20,00/).first().waitFor({ timeout: 8000 }).catch(() => {})
  {
    const txt = await p.locator('main').innerText()
    const linhaMg = txt.split('\n').filter((l) => /Minas|MG/.test(l)).join(' | ').slice(0, 200)
    ok(/mínimo R\$ 20,00/.test(txt), `lista de estados: MG com "mínimo R$ 20,00" (${linhaMg})`)
  }
  await p.goto(`${BASE}/painel/#/loja/estado/mg`)
  await minimo.waitFor()
  ok((await minimo.inputValue()) === '20,00', `de volta no Estado: o campo com 20,00 (${await minimo.inputValue()})`)
  await minimo.fill('')
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  await p.getByText('Minas Gerais: salvo. O site já mostra.').waitFor()
  await saiuDoEstado()
  ok(await esperar(async () => !('pedidoMinimo' in (await loja()).estados.find((x) => x.uf === 'mg'))), 'apagou o mínimo: o site volta a fechar qualquer pedido (sem o campo no GET loja)')

  // a taxa de entrega por bairro (22/10): o modo, a lista, colar com a prévia, os 3 modos no GET loja
  // (scripts/testar-painel-bairros.mjs)
  await fluxoBairros({ p, BASE, ok, print, axe })

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
  await p.getByRole('heading', { name: 'Ajustes da loja', level: 1 }).waitFor()
  await p.getByLabel('Frase do story do Início').fill('Vem que tem!')
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  ok(await esperar(async () => (await loja()).textos.fraseStory === 'Vem que tem!'), 'frase do story salva: o site recebe')
  await p.getByText('Ajustes da loja salvos. O site já mostra.').waitFor()
  ok(await p.locator('.pn-recados').getByText('Ajustes da loja salvos').isVisible(), 'o recado aparece embaixo, no lugar de sempre')
  // trocar o WhatsApp de todos os pedidos pergunta antes
  const whatsDaLoja = () => p.evaluate(async () => (await (await fetch('../api/index.php?r=admin-loja')).json()).loja.ajustes.whatsapp)
  const whatsAntes = await whatsDaLoja()
  await p.getByLabel('WhatsApp da loja').fill('(21) 98888-7777')
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  const trocaWhats = p.getByRole('alertdialog', { name: 'Trocar o WhatsApp da loja?' })
  await trocaWhats.waitFor()
  ok(/\(21\) 98888-7777/.test(await trocaWhats.innerText()) && /antes: \(33\) 99113-9036/.test(await trocaWhats.innerText()), 'trocar o WhatsApp da loja: confirma antes, com o número novo e o de antes')
  await trocaWhats.getByRole('button', { name: 'Deixa como tá' }).tap()
  await trocaWhats.waitFor({ state: 'detached' })
  ok(whatsAntes === '5533991139036' && (await whatsDaLoja()) === whatsAntes, '"Deixa como tá": não troca')
  await p.locator('.pn-pe-fixo').getByRole('button', { name: 'Desfazer' }).tap()
  // a vitrine da rua: a chave "O mercador mostra produtos na rua" desliga e liga de novo (o site recebe as duas)
  const chaveVitrine = p.locator('label.pn-troca').filter({ hasText: 'O mercador mostra produtos na rua' })
  ok(await chaveVitrine.locator('input').isChecked(), 'a chave da vitrine da rua nasce ligada')
  await chaveVitrine.tap()
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  ok(await esperar(async () => (await loja()).vitrineNaRua === false), 'vitrine da rua desligada: o site recebe')
  await chaveVitrine.tap()
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  ok(await esperar(async () => (await loja()).vitrineNaRua === true), 'vitrine da rua ligada de novo')
  await axe(p, 'loja')
  await print(p, 'loja-ajustes', true)

  await p.goto(`${BASE}/painel/#/loja/categorias`)
  await p.getByRole('heading', { name: 'Categorias', level: 1 }).waitFor()
  await axe(p, 'categorias')
  await print(p, 'loja-categorias')
  // a marca "Bebida alcoólica": os Destilados vêm marcados (a semente); ligar a marca liga o "É bebida", desligar o
  // "É bebida" tira a marca (alcoólica é sempre bebida)
  ok(/Destilados[\s\S]*bebida alcoólica/.test(await p.locator('.pn-cat').filter({ hasText: 'Destilados' }).innerText()), 'Categorias: os Destilados com "bebida alcoólica" na linha')
  await p.getByRole('button', { name: 'Editar Destilados' }).tap()
  const folhaCat = p.getByRole('dialog', { name: 'Editar Destilados' })
  await folhaCat.waitFor()
  const marca = folhaCat.getByRole('checkbox', { name: 'Bebida alcoólica' })
  const ehBebida = folhaCat.getByRole('checkbox', { name: 'É bebida' })
  ok((await marca.isChecked()) && (await ehBebida.isChecked()), 'a folha dos Destilados com "Bebida alcoólica" e "É bebida" ligados')
  await folhaCat.locator('label.pn-troca').filter({ hasText: 'É bebida' }).tap()
  ok(!(await marca.isChecked()) && !(await ehBebida.isChecked()), 'desligar "É bebida" tira a marca de alcoólica junto')
  await folhaCat.locator('label.pn-troca').filter({ hasText: 'Bebida alcoólica' }).tap()
  ok((await marca.isChecked()) && (await ehBebida.isChecked()), 'ligar "Bebida alcoólica" liga o "É bebida" junto')
  await axe(p, 'categoria com a marca de alcoólica')
  await print(p, 'loja-categoria-alcoolica')
  await p.keyboard.press('Escape')
  await folhaCat.waitFor({ state: 'detached' })
  ok((await loja()).categorias.find((c) => c.id === 'destilados')?.alcool === true, 'o site recebe os Destilados como bebida alcoólica')

  if (browser) await siteVeLoja({ p, BASE, ok, print, axe, browser, loja, esperar, videos })
}

/**
 * O site de verdade lendo a loja que o painel acabou de mudar (celular 390×844, idade lembrada, sem a abertura). Entre
 * um passo e outro o painel muda e o site abre de novo (a loja do servidor chega no primeiro respiro).
 */
async function siteVeLoja({ p, BASE, ok, print, axe, browser, loja, esperar, videos }) {
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
  // a foto recortada no Estúdio (com transparência) cobre o halo como a ilustração: mistura normal, sem o lighten
  const mistura = await card.locator('img.pv-real').evaluate((i) => Promise.resolve(i.complete || new Promise((ok) => i.addEventListener('load', ok, { once: true }))).then(() => [i.hasAttribute('data-alfa'), getComputedStyle(i).mixBlendMode])).catch(() => null)
  ok(!!mistura && mistura[0] && mistura[1] === 'normal', `site: a foto recortada cobre o halo (mistura normal, não lighten: ${JSON.stringify(mistura)})`)
  ok(/R\$ 10,49/.test((await card.textContent()) ?? '') && (await card.locator('.sq-restam').textContent().catch(() => null)) === 'RESTA 1', 'site: o card com o preço novo (R$ 10,49) e "RESTA 1"')
  const novo = s.locator('.vista-inicio .card').filter({ hasText: 'Isqueiro Bic Mini' }).first()
  ok((await novo.count()) === 1 && /R\$ 6,50/.test((await novo.textContent()) ?? ''), 'site: o produto novo (Isqueiro Bic Mini, R$ 6,50) na grade de MG')
  if (videos) {
    // a thumb animada do Isqueiro: no card da grade, toca quando aparece (o story do Início fica na capa)
    ok((await s.locator('.hero video.pv-video').count()) === 0, 'site: o story do Início não toca vídeo (fica na capa: é a primeira tela)')
    await novo.scrollIntoViewIfNeeded()
    const tocou = await s
      .waitForFunction(() => {
        const v = [...document.querySelectorAll('.vista-inicio .card')].find((c) => c.textContent?.includes('Isqueiro Bic Mini'))?.querySelector('video.pv-video')
        return !!v && !v.paused && v.hasAttribute('data-tocando') && v.currentTime > 0
      }, null, { timeout: 20000 })
      .then(() => true, () => false)
    ok(tocou, 'site: o card do Isqueiro toca a thumb animada (sem som, em volta)')
    ok(await novo.locator('.pv[data-video]').count() === 1, 'site: com o vídeo na tela, a capa sai de baixo (sem fantasma no lighten)')
    await print(s, 'site-loja-thumb')
  }
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
    // os eventos "ExtraInfo" podem chegar antes do requestWillBeSent do mesmo pedido: guarda tudo por id e junta no fim
    const pedidos = new Map()
    const comInm = new Set()
    const status = new Map()
    cdp.on('Network.requestWillBeSent', (e) => e.request.url.includes('r=loja') && pedidos.set(e.requestId, true))
    cdp.on('Network.requestWillBeSentExtraInfo', (e) => {
      const h = Object.fromEntries(Object.entries(e.headers ?? {}).map(([a, b]) => [a.toLowerCase(), b]))
      if (h['if-none-match']) comInm.add(e.requestId)
    })
    cdp.on('Network.responseReceivedExtraInfo', (e) => status.set(e.requestId, e.statusCode))
    await q.goto(`${BASE}/?uf=mg`)
    await q.waitForFunction(() => !!localStorage.getItem('gc-loja'), null, { timeout: 8000 }).catch(() => {})
    await q.goto(`${BASE}/?uf=mg&de-novo=1`)
    await q.waitForTimeout(3000)
    const vistos = [...pedidos.keys()].flatMap((id) => [...(comInm.has(id) ? ['if-none-match'] : []), ...(status.has(id) ? [status.get(id)] : [])])
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
  await p.getByText('Ajustes da loja salvos. O site já mostra.').last().waitFor()
  ok(await esperar(async () => (await loja()).estados.find((e) => e.uf === 'mg').whatsapp === '5533988887777'), 'painel: MG com WhatsApp próprio e "o mesmo pra todos" desligado (o GET loja manda o de MG)')
  await abrir('uf=mg')
  let zap = await pedirNoSite()
  ok(zap?.startsWith('https://wa.me/5533988887777?text='), `site: o pedido de MG fecha no WhatsApp próprio de MG (${zap?.slice(0, 40)}…)`)
  await p.goto(`${BASE}/painel/#/loja`)
  await p.locator('label.pn-troca').filter({ hasText: 'O mesmo WhatsApp pra todos os estados' }).tap()
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  await p.getByText('Ajustes da loja salvos. O site já mostra.').last().waitFor()
  await esperar(async () => (await loja()).estados.find((e) => e.uf === 'mg').whatsapp == null)
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
  // tirar a Bahia do site: o botão fica no fim da tela e confirma antes (antes, um toque + Salvar tirava sem perguntar)
  await p.goto(`${BASE}/painel/#/loja/estado/ba`)
  await p.getByRole('button', { name: 'Tirar Bahia do site' }).tap()
  const tirar = p.getByRole('alertdialog', { name: 'Tirar Bahia do site?' })
  await tirar.waitFor()
  ok(/ainda não chegou aí/.test(await tirar.innerText()) && (await loja()).estados.some((x) => x.uf === 'ba'), 'tirar do site: confirma antes, dizendo o que o cliente vai ver (e ainda não tirou)')
  const botoesTirar = (await tirar.getByRole('button').allInnerTexts()).map((x) => x.trim()).filter(Boolean)
  ok(botoesTirar.includes('Tirar Bahia do site') && botoesTirar.includes('Deixa como tá') && new Set(botoesTirar).size === botoesTirar.length, `os botões com nomes diferentes, nada de "Voltar"/"Voltar" (${botoesTirar.join(' · ')})`)
  await axe(p, 'tirar do site')
  await print(p, 'loja-estado-tirar')
  await tirar.getByRole('button', { name: 'Tirar Bahia do site' }).tap()
  await p.getByText(/Bahia saiu do site/).waitFor()
  ok(await p.locator('.pn-recados').getByRole('button', { name: 'Desfazer' }).isVisible(), 'o recado de "saiu do site" tem Desfazer')
  ok(await esperar(async () => !(await loja()).estados.some((x) => x.uf === 'ba')), 'confirmou: a Bahia sai do site')
  ok(await p.getByRole('button', { name: 'Pôr de volta no site' }).isVisible(), 'estado fora do site: "Pôr de volta no site" em cima')
  await abrir('uf=ba')
  ok((await s.locator('.sem').count()) === 1, 'site: a Bahia tirada do site: quem está nela vê "ainda não chegou aí"')
  ok(!erros.length, `site: sem erro no console (${erros.join(' | ') || 'nenhum'})`)
  await ctx.close()
}
