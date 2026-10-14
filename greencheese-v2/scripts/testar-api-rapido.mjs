// O pedido rápido no servidor (pedido do Ian em 14/10), chamado do scripts/testar-api.mjs depois dos pedidos:
// - o pedido da SACOLA (origem 'sacola'): um toque, sem nome, sem endereço e sem pagamento, entra inteiro; o nome da
//   conta vai quando vem; o resto da conferência continua igual (Origin, armadilha, itens, subtotal, tabaco, o limite
//   por IP, a mesma entrada de novo); o pedido guiado continua pedindo o nome; encomenda nunca é da sacola;
// - o painel com a origem e o "ao vivo": admin-pedidos e admin-pedidos-resumo com ETag (304 sem corpo quando nada mudou,
//   outro ETag quando chega pedido ou muda status; o gerente tem o dele, só com os estados dele) e o ultimoId;
// - o pedido mínimo pra entrega por estado: salvo, conferido (centavos, R$ 0 = sem mínimo, teto de R$ 1.000), no GET
//   loja só quando existe (o ETag muda), na Atividade com o valor, e o resto do estado intacto;
// - as migrações 105 (o mínimo) e 209 (a origem) num banco que já está no ar, com dado dentro: nada se perde.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Cli, novoCodigo, novoToken, pedidoValido } from './testar-api-pedidos.mjs'

/** O pedido como a sacola manda: sem nome, sem endereço e sem pagamento; a mensagem fecha com o endereço na conversa. */
export function pedidoSacola(extra = {}) {
  const codigo = extra.codigo ?? novoCodigo()
  const mensagem = [
    'PEDIDO GREEN CHEESE — MG / Teófilo Otoni',
    `Código: ${codigo}`,
    "1x Jack Daniel's Old No. 7 1 L — R$ 149,90",
    '3x Seda OCB Premium Slim — R$ 19,99 (combo 3 por R$ 19,99)',
    'Subtotal: R$ 169,89',
    'Entrega: taxa a confirmar',
    'Endereço: mando aqui na conversa',
  ].join('\n')
  return {
    codigo,
    token: novoToken(),
    tipo: 'pedido',
    origem: 'sacola',
    uf: 'mg',
    cidade: 'Teófilo Otoni',
    nome: '',
    whatsapp: '',
    itens: [
      { produtoId: 'jack-daniels-old-no7-1l', nome: "Jack Daniel's Old No. 7 1 L", variacao: null, qtd: 1, precoUnit: 149.9, total: 149.9, combo: null },
      { produtoId: 'seda-ocb-premium-slim', nome: 'Seda OCB Premium Slim', variacao: null, qtd: 3, precoUnit: 9.99, total: 19.99, combo: '3 por R$ 19,99' },
    ],
    subtotal: 169.89,
    subtotalTexto: 'R$ 169,89',
    cupom: null,
    mensagem,
    site: '',
    substitui: null,
    ...extra,
  }
}

export async function testarPedidoRapido(t) {
  const { parte, ok, igual, erro, Cliente, dono, tmp, raiz, PHP, subirPhp, portaLivre, derrubar, portaPrincipal } = t
  const site = () => new Cliente()
  const detalhe = async (codigo) => {
    const l = (await dono.get('admin-pedidos', { query: `&status=todos&busca=${codigo}` })).json?.pedidos?.find((x) => x.codigo === codigo)
    return l ? { linha: l, pedido: (await dono.get('admin-pedido', { query: `&id=${l.id}` })).json?.pedido } : { linha: null, pedido: null }
  }
  const semLinhaDoCodigo = (p) => ({ ...p, mensagem: p.mensagem.split('\n').filter((l) => !l.startsWith('Código: ')).join('\n') })

  // ─── o pedido da sacola ───────────────────────────────────────────────────────────────────────────────────────
  parte('pedido rápido: a sacola manda sem nome, sem endereço e sem pagamento')
  {
    const p = pedidoSacola()
    const r = await site().post('pedido', p)
    igual([r.status, r.json?.pedido?.codigo, r.json?.pedido?.status], [201, p.codigo, 'novo'], 'pedido da sacola sem nome nem endereço: 201, novo')
    const { linha, pedido } = await detalhe(p.codigo)
    igual([linha?.origem, linha?.nome, linha?.subtotal, linha?.unidades], ['sacola', '', 169.89, 4], 'na lista: origem sacola, sem nome, o subtotal e as unidades')
    igual([pedido?.itens?.length, pedido?.entrega?.endereco, pedido?.pagamento, pedido?.nota, pedido?.mensagem === p.mensagem], [2, '', null, '', true], 'por dentro: os itens com o combo, sem endereço, sem pagamento, sem anotação de cópia torta e a mensagem exata')
    igual(pedido?.itens?.[1]?.combo, '3 por R$ 19,99', 'o combo da linha como a sacola mostrou')
    const de2 = await site().post('pedido', p)
    igual([de2.status, de2.json?.repetido], [200, true], 'a mesma entrada de novo (a volta do WhatsApp manda a fila): 200 repetido, sem pedido a mais')
    // o nome da conta vai quando o aparelho sabe; o que não fecha fica de fora (só informa)
    const comNome = pedidoSacola({ nome: 'Ana Souza' })
    igual((await site().post('pedido', comNome)).status, 201, 'com o nome da conta: entra')
    igual((await detalhe(comNome.codigo)).linha?.nome, 'Ana Souza', 'e o nome aparece no painel')
    for (const [nome, rotulo] of [['A', 'nome de 1 letra'], ['x'.repeat(61), 'nome longo demais'], [42, 'nome que não é texto']]) {
      const q = pedidoSacola({ nome })
      igual((await site().post('pedido', q)).status, 201, `sacola com ${rotulo}: entra (o nome só informa)`)
      const d = await detalhe(q.codigo)
      igual([d.linha?.nome, d.pedido?.nota, d.pedido?.itens?.length], ['', '', 2], `${rotulo}: fica sem nome, o pedido inteiro`)
    }
    // o endereço que vier (o site novo não manda) entra como veio: só informa
    const comEntrega = pedidoSacola({ entrega: { endereco: 'Rua A, 10', rua: '', numero: '', bairro: '', cep: '', cidade: '', uf: '' } })
    igual((await site().post('pedido', comEntrega)).status, 201, 'sacola com endereço: entra')
    igual((await detalhe(comEntrega.codigo)).pedido?.entrega?.endereco, 'Rua A, 10', 'com o endereço que veio')
  }

  parte('pedido rápido: o resto da conferência não afrouxa')
  {
    erro(await site().post('pedido', pedidoSacola(), { origem: null }), 403, 'origem', 'sacola sem Origin')
    erro(await site().post('pedido', pedidoSacola(), { origem: 'https://golpe.example' }), 403, 'origem', 'sacola com Origin de fora')
    for (const [extra, campo, msg] of [
      [{ site: 'http://spam' }, 'site', 'armadilha cheia'],
      [{ codigo: 'GC-0O1IL' }, 'codigo', 'código com letra ambígua'],
      [{ token: 'curto' }, 'token', 'token mal formado'],
      [{ itens: [] }, 'itens', 'sem itens'],
      [{ itens: [{ nome: 'X', qtd: 0, precoUnit: 1, total: 1 }] }, 'itens', 'quantidade 0'],
      [{ subtotal: 170 }, 'subtotal', 'subtotal que não bate com os itens'],
      [{ uf: 'xx' }, 'uf', 'estado inválido'],
    ]) {
      const r = await site().post('pedido', semLinhaDoCodigo(pedidoSacola(extra)))
      erro(r, 400, 'invalido', `sacola: ${msg}`)
      igual(r.json?.campo, campo, `sacola: ${msg} (campo)`)
    }
    const fumo = await site().post('pedido', pedidoSacola({ itens: [{ nome: 'Backwoods Honey', qtd: 1, precoUnit: 90, total: 90 }], subtotal: 90 }))
    erro(fumo, 422, 'proibido', 'sacola com tabaco')
    // estrutural torto com a mensagem certa: como no guiado, entra só com a mensagem (e continua da sacola, sem nome)
    const torto = pedidoSacola({ subtotal: 170 })
    igual((await site().post('pedido', torto)).status, 201, 'sacola com o subtotal torto e a mensagem certa: entra só com a mensagem')
    const d = await detalhe(torto.codigo)
    igual([d.linha?.origem, d.linha?.nome, d.pedido?.itens?.length], ['sacola', '', 0], 'só com a mensagem: da sacola, sem nome (o painel mostra "Sem nome")')
    ok(d.pedido?.nota?.includes('(campo subtotal)'), `e a anotação diz o campo (${d.pedido?.nota})`)
    // o mesmo IP: 20 pedidos novos por hora, a sacola também conta
    const mesmo = site()
    let ultimo = null
    for (let i = 0; i < 21; i++) ultimo = await mesmo.post('pedido', pedidoSacola())
    erro(ultimo, 429, 'muitas-tentativas', 'sacola: o 21º pedido novo do mesmo IP na hora')
  }

  parte('pedido rápido: o guiado continua pedindo o nome; encomenda nunca é da sacola')
  {
    // sem a mensagem certa, o nome em branco do guiado é recusado (com ela, entra só com a mensagem, como sempre)
    const g = await site().post('pedido', semLinhaDoCodigo(pedidoValido({ nome: '' })))
    erro(g, 400, 'invalido', 'guiado sem nome')
    igual(g.json?.campo, 'nome', 'guiado sem nome: campo nome')
    const g2 = pedidoValido({ nome: '' })
    igual((await site().post('pedido', g2)).status, 201, 'guiado sem nome com a mensagem certa: entra só com a mensagem')
    const dg = await detalhe(g2.codigo)
    igual([dg.linha?.origem, dg.linha?.nome, dg.pedido?.itens?.length], ['guiado', 'Ian Teste', 0], 'é do guiado e vale o "Nome:" da mensagem (sem a cópia estruturada)')
    // sem o campo origem (o site de antes, a cópia velha na fila do aparelho): guiado
    const velho = pedidoValido()
    delete velho.origem
    igual((await site().post('pedido', velho)).status, 201, 'pedido sem o campo origem entra')
    igual((await detalhe(velho.codigo)).linha?.origem, 'guiado', 'sem o campo: guiado')
    const outro = pedidoValido({ origem: 'qualquer' })
    igual((await site().post('pedido', outro)).status, 201, 'origem desconhecida entra')
    igual((await detalhe(outro.codigo)).linha?.origem, 'guiado', 'origem desconhecida: guiado (o que confere mais)')
    const enc = {
      codigo: novoCodigo(), token: novoToken(), tipo: 'encomenda', origem: 'sacola', uf: 'rj', cidade: 'Rio de Janeiro', nome: '', site: '',
      encomenda: { produto: 'Fanta de uva japonesa', quantidade: '2', referencia: '' },
    }
    enc.mensagem = ['ENCOMENDA GREEN CHEESE — RJ / Rio de Janeiro', `Código: ${enc.codigo}`, 'Produto: Fanta de uva japonesa', 'Quantidade: 2'].join('\n')
    const re = await site().post('pedido', semLinhaDoCodigo(enc))
    erro(re, 400, 'invalido', 'encomenda "da sacola" sem nome: vale a regra do guiado')
    igual(re.json?.campo, 'nome', 'encomenda sem nome: campo nome')
  }

  // ─── o painel ao vivo: ETag e o ultimoId ──────────────────────────────────────────────────────────────────────
  parte('pedido rápido: o painel pergunta de novo sem baixar nada (ETag/304)')
  {
    const r1 = await dono.get('admin-pedidos-resumo')
    const e1 = r1.headers.get('etag')
    ok(r1.status === 200 && /^"[0-9a-f]{32}"$/.test(e1 ?? ''), `resumo com ETag (${e1})`)
    ok(Number.isInteger(r1.json?.ultimoId) && r1.json.ultimoId > 0, `resumo com o ultimoId (${r1.json?.ultimoId})`)
    const r2 = await dono.get('admin-pedidos-resumo', { cab: { 'If-None-Match': e1 } })
    igual([r2.status, r2.texto, r2.headers.get('etag')], [304, '', e1], 'nada mudou: 304 sem corpo, o mesmo ETag')
    igual((await dono.get('admin-pedidos-resumo', { cab: { 'If-None-Match': `W/${e1}` } })).status, 304, 'o W/ (ETag fraco, de proxy) também vale')
    igual((await dono.get('admin-pedidos-resumo', { cab: { 'If-None-Match': e1.replace(/"$/, '-gzip"') } })).status, 304, 'o sufixo do compressor ("…-gzip") também vale')
    const l1 = await dono.get('admin-pedidos', { query: '&status=abertos' })
    const el = l1.headers.get('etag')
    ok(/^"[0-9a-f]{32}"$/.test(el ?? '') && el !== e1, 'a lista tem o ETag dela')
    igual((await dono.get('admin-pedidos', { query: '&status=abertos', cab: { 'If-None-Match': el } })).status, 304, 'lista sem mudança: 304')
    const outroFiltro = await dono.get('admin-pedidos', { query: '&status=entregue', cab: { 'If-None-Match': el } })
    igual(outroFiltro.status, 200, 'outro filtro, outro conteúdo: 200 (o ETag é do que vai na resposta)')
    // chega um pedido novo pela sacola: os dois mudam e o ultimoId sobe
    const novo = pedidoSacola()
    await site().post('pedido', novo)
    const r3 = await dono.get('admin-pedidos-resumo', { cab: { 'If-None-Match': e1 } })
    ok(r3.status === 200 && r3.headers.get('etag') !== e1 && r3.json?.ultimoId > r1.json.ultimoId && r3.json?.ultimos?.[0]?.codigo === novo.codigo, `pedido novo: o resumo responde inteiro, com outro ETag, o ultimoId maior e o pedido no topo (${r3.status}, ${r1.json.ultimoId} → ${r3.json?.ultimoId})`)
    igual(r3.json?.ultimos?.[0]?.origem, 'sacola', 'com a origem')
    const l2 = await dono.get('admin-pedidos', { query: '&status=abertos', cab: { 'If-None-Match': el } })
    ok(l2.status === 200 && l2.json?.pedidos?.[0]?.codigo === novo.codigo, 'a lista também: 200 com o novo em cima')
    // o status mudou em outro aparelho: a lista muda (o resumo também, que o novo saiu dos novos)
    const el2 = l2.headers.get('etag')
    const e3 = r3.headers.get('etag')
    await dono.post('admin-pedido-status', { id: l2.json.pedidos[0].id, status: 'confirmado' })
    igual((await dono.get('admin-pedidos', { query: '&status=abertos', cab: { 'If-None-Match': el2 } })).status, 200, 'status mudou: a lista vem de novo')
    igual((await dono.get('admin-pedidos-resumo', { cab: { 'If-None-Match': e3 } })).status, 200, 'e o resumo também')
    // o gerente de RJ: só os estados dele (o ETag é dele, o ultimoId também)
    const g = await dono.post('admin-usuario-salvar', { novo: true, login: 'ao.vivo.rj', nome: 'Ao Vivo RJ', papel: 'gerente', ufs: ['rj'] })
    igual(g.status, 201, 'criou um gerente de RJ')
    const ger = new Cliente()
    await ger.post('admin-entrar', { login: 'ao.vivo.rj', senha: g.json.senhaProvisoria })
    igual((await ger.post('admin-senha', { atual: g.json.senhaProvisoria, nova: 'senha-ao-vivo-rj-1' })).status, 200, 'o gerente trocou a provisória')
    const gr = await ger.get('admin-pedidos-resumo')
    const doDono = (await dono.get('admin-pedidos-resumo')).headers.get('etag')
    ok(gr.status === 200 && gr.headers.get('etag') !== doDono, 'o gerente tem o ETag dele (vê outra coisa)')
    igual(gr.json?.ultimos?.every((x) => x.uf === 'rj'), true, 'e só os pedidos de RJ')
    igual((await ger.get('admin-pedidos-resumo', { cab: { 'If-None-Match': doDono } })).status, 200, 'o ETag do dono não serve pro gerente (nunca recebe 304 com o conteúdo do outro)')
    const grE = gr.headers.get('etag')
    await site().post('pedido', pedidoSacola())
    igual((await ger.get('admin-pedidos-resumo', { cab: { 'If-None-Match': grE } })).status, 304, 'pedido novo em MG: pro gerente de RJ, nada mudou (304)')
    const rj = pedidoSacola({ uf: 'rj', cidade: 'Rio de Janeiro' })
    rj.mensagem = rj.mensagem.replace('MG / Teófilo Otoni', 'RJ / Rio de Janeiro')
    await site().post('pedido', rj)
    const gr2 = await ger.get('admin-pedidos-resumo', { cab: { 'If-None-Match': grE } })
    ok(gr2.status === 200 && gr2.json?.ultimos?.[0]?.codigo === rj.codigo && gr2.json.ultimoId > gr.json.ultimoId, 'pedido novo em RJ: o gerente de RJ recebe')
    erro(await ger.post('admin-estado-salvar', { uf: 'rj', pedidoMinimo: 20 }), 403, 'sem-permissao', 'o gerente não mexe no pedido mínimo (é ajuste do dono)')
    // sem sessão: nada de 304 (o 401 de sempre)
    igual((await site().get('admin-pedidos-resumo', { cab: { 'If-None-Match': doDono } })).status, 401, 'sem sessão: 401, nunca um 304')
  }

  // ─── o pedido mínimo pra entrega ──────────────────────────────────────────────────────────────────────────────
  parte('pedido rápido: o pedido mínimo pra entrega de cada estado')
  {
    const pub = async () => {
      const r = await site().get('loja')
      return { etag: r.headers.get('etag'), loja: r.json?.loja, versao: r.json?.versao }
    }
    const salvar = (corpo) => dono.post('admin-estado-salvar', corpo)
    const antes = await pub()
    igual(antes.loja.estados.filter((e) => 'pedidoMinimo' in e).length, 0, 'sem mínimo em nenhum estado: o campo nem vai no GET loja')
    const mgAntes = (await dono.get('admin-loja')).json.loja.estados.find((e) => e.uf === 'mg')
    igual(mgAntes.pedidoMinimo, null, 'no painel: null = sem mínimo')
    for (const [v, msg] of [[-5, 'negativo'], ['abc', 'texto que não é valor'], [1000.01, 'acima de R$ 1.000,00'], ['20,999', 'mais de 2 casas'], [true, 'sim/não'], [{ valor: 20 }, 'objeto'], [[20], 'lista']]) {
      const x = await salvar({ uf: 'mg', pedidoMinimo: v })
      erro(x, 400, 'invalido', `mínimo ${msg}`)
      igual(x.json?.campo, 'pedidoMinimo', `mínimo ${msg}: campo`)
    }
    igual((await pub()).versao, antes.versao, 'nada recusado entrou (a versão da loja não mudou)')
    let x = await salvar({ uf: 'mg', pedidoMinimo: 20 })
    igual([x.status, x.json?.estado?.pedidoMinimo], [200, 20], 'R$ 20 salvo')
    const com = await pub()
    const mg = com.loja.estados.find((e) => e.uf === 'mg')
    igual([mg.pedidoMinimo, com.loja.estados.filter((e) => 'pedidoMinimo' in e).map((e) => e.uf)], [20, ['mg']], 'no GET loja: o mínimo de MG, e só nele')
    ok(com.etag !== antes.etag && com.versao > antes.versao, `o ETag e a versão da loja mudam (o site lê de novo) (${antes.versao} → ${com.versao})`)
    igual([mg.taxaEntrega, mg.horario, mg.pagamento, mg.cidades], [mgAntes.taxaEntrega, mgAntes.horario, mgAntes.pagamento, mgAntes.cidades], 'o resto do estado intacto')
    const ev = async () => (await dono.get('admin-eventos')).json.eventos.find((e) => e.acao === 'estado-editado')
    igual((await ev())?.texto, 'Pôs o pedido mínimo pra entrega de MG em R$ 20,00', 'na Atividade, com o valor')
    x = await salvar({ uf: 'mg', pedidoMinimo: '25,50' })
    igual(x.json?.estado?.pedidoMinimo, 25.5, 'com vírgula: R$ 25,50')
    x = await salvar({ uf: 'mg', taxa: 7 })
    igual([x.json?.estado?.pedidoMinimo, x.json?.estado?.taxaEntrega?.valor], [25.5, 7], 'mexer na taxa não mexe no mínimo')
    igual((await ev())?.texto, 'Editou o atendimento de MG', 'e a Atividade da taxa é a de sempre')
    x = await salvar({ uf: 'mg', taxa: 8, pedidoMinimo: 1000 })
    igual(x.json?.estado?.pedidoMinimo, 1000, 'R$ 1.000,00 (o teto) vale')
    igual((await ev())?.texto, 'Editou o atendimento de MG (pedido mínimo: R$ 1.000,00)', 'mínimo com outra coisa junto: a frase de sempre com o mínimo')
    for (const [v, msg] of [[0, 'R$ 0'], ['0,00', '"0,00"'], ['', 'vazio'], [null, 'null']]) {
      await salvar({ uf: 'mg', pedidoMinimo: 15 })
      x = await salvar({ uf: 'mg', pedidoMinimo: v })
      igual([x.status, x.json?.estado?.pedidoMinimo], [200, null], `${msg} = sem mínimo`)
    }
    igual((await ev())?.texto, 'Tirou o pedido mínimo pra entrega de MG', 'tirar fica na Atividade')
    const sem = await pub()
    igual(sem.loja.estados.filter((e) => 'pedidoMinimo' in e).length, 0, 'sem mínimo de novo: o campo some do GET loja')
    ok(sem.etag !== com.etag, 'e o ETag muda de novo')
    // estado novo nasce sem mínimo; com ele no corpo, já nasce com
    x = await salvar({ uf: 'pe', instagram: 'greencheese_importspe', pagamentos: ['pix'], pedidoMinimo: 30 })
    igual([x.status, x.json?.estado?.pedidoMinimo], [201, 30], 'estado novo ativado já com o mínimo')
    igual((await salvar({ uf: 'pe', ativo: false })).status, 200, 'e sai do site (limpeza)')
    await salvar({ uf: 'mg', taxa: mgAntes.taxaEntrega.valor, taxaDemo: mgAntes.taxaEntrega.demo })
  }

  // ─── o valor que não bate com o catálogo (ou abaixo do mínimo): entra marcado, nunca recusado ──────────────────
  // (a revisão de 14/10: a cópia com o preço adulterado entrava sem marca nenhuma, e o grupo recebia "Subtotal: R$ 0,10")
  parte('pedido rápido: preço adulterado ou abaixo do mínimo entra marcado pra conferir na conversa')
  {
    const nota = async (p) => (await detalhe(p.codigo)).pedido?.nota
    const jack = (qtd, unit) => ({ produtoId: 'jack-daniels-old-no7-1l', nome: "Jack Daniel's Old No. 7 1 L", variacao: null, qtd, precoUnit: unit, total: Math.round(qtd * unit * 100) / 100, combo: null })
    const forjado = pedidoSacola({ itens: [jack(10, 0.01)], subtotal: 0.1, subtotalTexto: 'R$ 0,10' })
    igual((await site().post('pedido', forjado)).status, 201, 'preço adulterado (10 Jack a R$ 0,01): entra, a loja confere na conversa')
    igual(await nota(forjado), "Confere o valor na conversa: 10x Jack Daniel's Old No. 7 1 L: R$ 0,10 no site, R$ 1.499,00 no catálogo.", 'e a anotação do pedido diz o que não bateu (o preço do catálogo de agora)')
    // o combo é a mesma conta do site (4 OCB = 3 por R$ 19,99 + 1): bate, não marca; o combo inventado, marca
    const ocb = (qtd, total) => ({ produtoId: 'seda-ocb-premium-slim', nome: 'Seda OCB Premium Slim', variacao: null, qtd, precoUnit: 9.99, total, combo: null })
    const certo = pedidoSacola({ itens: [ocb(4, 29.98)], subtotal: 29.98, subtotalTexto: 'R$ 29,98' })
    igual((await site().post('pedido', certo)).status, 201, '4 OCB com o combo certo: entra')
    igual(await nota(certo), '', 'com o combo certo: sem anotação')
    const combo = pedidoSacola({ itens: [ocb(4, 9.99)], subtotal: 9.99, subtotalTexto: 'R$ 9,99' })
    await site().post('pedido', combo)
    igual(await nota(combo), 'Confere o valor na conversa: 4x Seda OCB Premium Slim: R$ 9,99 no site, R$ 29,98 no catálogo.', 'o total da linha menor que o melhor combo: marca')
    // produto que não tá no catálogo com preço: marca; a consultar sem produto: nada a conferir
    const fora = pedidoSacola({ itens: [{ produtoId: 'produto-que-nao-existe', nome: 'Coisa', variacao: null, qtd: 1, precoUnit: 10, total: 10, combo: null }], subtotal: 10, subtotalTexto: 'R$ 10,00' })
    await site().post('pedido', fora)
    igual(await nota(fora), 'Confere o valor na conversa: 1x Coisa: não tá no catálogo agora.', 'produto fora do catálogo com preço: marca')
    // abaixo do mínimo do estado (o site trava; a cópia forjada não): marca. Com item a consultar, não (a loja confere)
    igual((await dono.post('admin-estado-salvar', { uf: 'mg', pedidoMinimo: 200 })).status, 200, 'MG com mínimo de R$ 200')
    const abaixo = pedidoSacola()
    await site().post('pedido', abaixo)
    igual(await nota(abaixo), 'Confere o valor na conversa: abaixo do pedido mínimo de R$ 200,00 pra entrega.', 'R$ 169,89 com o mínimo de R$ 200: marca')
    const consultar = pedidoSacola({ itens: [...pedidoSacola().itens, { produtoId: 'cuia-de-silicone-raw', nome: 'Cuia de silicone RAW', variacao: null, qtd: 1, precoUnit: null, total: null, combo: null }], subtotalTexto: 'R$ 169,89 + itens a consultar' })
    await site().post('pedido', consultar)
    igual(await nota(consultar), '', 'abaixo do mínimo com item a consultar: não marca (o site também não trava; a loja confere)')
    igual((await dono.post('admin-estado-salvar', { uf: 'mg', pedidoMinimo: null })).status, 200, 'MG sem mínimo de novo')
    const semMinimo = pedidoSacola()
    await site().post('pedido', semMinimo)
    igual(await nota(semMinimo), '', 'sem mínimo e tudo certo: sem anotação')
  }

  // ─── as migrações 105 e 209 num banco que já está no ar ─────────────────────────────────────────────────────
  parte('pedido rápido: as migrações 105 (mínimo) e 209 (origem) num banco de antes, com dados')
  {
    const dir = join(tmp, 'rapido-antes')
    mkdirSync(dir, { recursive: true })
    const arq = join(dir, 'loja.sqlite')
    const api = join(raiz, 'public', 'api')
    // os módulos na ordem do index.php (sem atender rota nenhuma): a primeira abertura roda as migrações e semeia a loja
    const modulos = `define('GC_API', 1); foreach (['base', 'banco', 'validar', 'limite', 'sessao', 'rateio', 'exemplos', 'publico', 'painel', 'upload', 'diagnostico', 'loja-migracoes', 'loja', 'loja-validar', 'loja-painel', 'pedido-migracoes', 'pedido', 'avisos', 'textos', 'contas-migracoes', 'equipe', 'clientes', 'sorte', 'painel-dono'] as $m) require $argv[1] . "/nucleo/$m.php";`
    // o banco no ar antes desta entrega: com o dono, a loja semeada (101) e um pedido; as colunas novas tiradas e as duas
    // migrações fora do registro, como era (o PHP de antes nunca criou nada disso)
    execFileSync(PHP, ['-r', `define('GC_API', 1); require $argv[1] . '/nucleo/banco.php'; $db = new PDO('sqlite:' . $argv[2]); $db->exec(gc_migracoes_base()[1]); $db->exec('PRAGMA user_version = 1'); $t = time(); $db->prepare("INSERT INTO usuarios (login, nome, senha_hash, papel, criado_em, senha_em) VALUES ('dono', 'Dono', ?, 'dono', ?, ?)")->execute([password_hash('senha-forte-123', PASSWORD_DEFAULT), $t, $t]);`, api, arq])
    execFileSync(PHP, ['-r', `${modulos} gc_db();`, api], { env: { ...process.env, GC_DADOS: dir } })
    execFileSync(PHP, ['-r', `$d = new PDO('sqlite:' . $argv[1]); $t = time();
      $d->exec("UPDATE loja_estados SET taxa = 950, taxa_demo = 0 WHERE uf = 'mg'");
      $d->prepare("INSERT INTO pedidos (codigo, token_hash, tipo, status, uf, cidade, nome, itens, subtotal, mensagem, criado_em, atualizado_em) VALUES ('GC-ANT22', ?, 'pedido', 'novo', 'mg', 'Teófilo Otoni', 'Cliente de Antes', '[]', 1000, 'PEDIDO GREEN CHEESE — MG\nCódigo: GC-ANT22', ?, ?)")->execute([hash('sha256', 'x'), $t, $t]);
      $d->exec('ALTER TABLE loja_estados DROP COLUMN pedido_minimo');
      $d->exec('ALTER TABLE pedidos DROP COLUMN origem');
      $d->exec('DELETE FROM migracoes WHERE numero IN (105, 209)');`, arq])
    const colunas = () =>
      JSON.parse(
        execFileSync(PHP, ['-r', `$d = new PDO('sqlite:' . $argv[1]); $c = fn ($t) => array_column($d->query("PRAGMA table_info($t)")->fetchAll(PDO::FETCH_ASSOC), 'name'); echo json_encode(['estados' => in_array('pedido_minimo', $c('loja_estados')), 'pedidos' => in_array('origem', $c('pedidos')), 'm' => array_map('intval', $d->query('SELECT numero FROM migracoes WHERE numero IN (105, 209) ORDER BY numero')->fetchAll(PDO::FETCH_COLUMN)), 'n' => (int) $d->query('SELECT COUNT(*) FROM loja_estados')->fetchColumn()]);`, arq], { encoding: 'utf8' }),
      )
    igual(colunas(), { estados: false, pedidos: false, m: [], n: 5 }, 'o banco de antes: sem as colunas novas, sem a 105 e a 209 no registro')
    const porta = process.env.GC_TESTE_PORTA ? portaPrincipal + 6 : await portaLivre()
    const filho = await subirPhp(porta, { GC_TESTE: '1', GC_DADOS: dir, GC_UPLOADS: join(dir, 'up') }, ['-t', join(raiz, 'public'), join(raiz, 'scripts', 'api-dev.php')])
    try {
      const b = `http://127.0.0.1:${porta}`
      const r = await fetch(`${b}/api/index.php?r=loja`)
      const j = await r.json()
      igual(r.status, 200, 'a primeira chamada depois de publicar responde')
      igual(colunas(), { estados: true, pedidos: true, m: [105, 209], n: 5 }, 'as duas migrações rodaram sozinhas e ficaram no registro')
      const mg = j.loja.estados.find((e) => e.uf === 'mg')
      igual([mg.taxaEntrega.valor, 'pedidoMinimo' in mg, j.loja.estados.length], [9.5, false, 5], 'os estados ficam como estavam (a taxa de MG), todos sem mínimo')
      const cli = new Cli(b, '198.18.40.1')
      igual((await cli.post('admin-entrar', { login: 'dono', senha: 'senha-forte-123' })).status, 200, 'o dono entra no banco de antes')
      const l = (await cli.get('admin-pedidos', { query: '&status=todos' })).json?.pedidos ?? []
      igual(l.map((x) => [x.codigo, x.nome, x.origem]), [['GC-ANT22', 'Cliente de Antes', 'guiado']], 'o pedido de antes fica, com a origem guiado (todo pedido de antes veio do guiado)')
      igual((await cli.post('admin-estado-salvar', { uf: 'mg', pedidoMinimo: 20 })).json?.estado?.pedidoMinimo, 20, 'e o mínimo já salva nele')
      const sacola = pedidoSacola()
      igual((await new Cli(b, '198.18.40.2').post('pedido', sacola)).status, 201, 'e o pedido da sacola entra nele')
    } finally {
      derrubar(filho)
    }
  }
}
