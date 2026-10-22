// A taxa de entrega por bairro no servidor (pedido do Ian em 22/10), chamado do scripts/testar-api.mjs depois do pedido
// rápido, num servidor próprio (com o gateway falso do WhatsApp, pra ler o aviso do grupo):
// - a migração 107 (loja) e a 210 (pedidos) num banco como o do ar, com estados configurados e um pedido: só acrescentam,
//   nada do que o dono pôs muda, a versão da loja não sobe e o GET loja sai byte a byte igual (o mesmo ETag); e numa
//   instalação nova: os estados nascem com uma taxa só, sem nenhum bairro de fábrica;
// - a conferência da lista (nome de 2 a 60 letras, sem repetir depois de tirar acento/maiúscula/espaço/pontuação, a
//   cidade do estado, taxa de R$ 0 a R$ 500 ou "consultar", até 400, as palavras e o tabaco) com o índice no erro;
// - o corpo de antes (o painel aberto no celular do dono, sem os campos novos) não mexe no modo nem na lista;
// - o GET loja nos 3 modos (uma taxa: nada novo; aparece no site: a lista; o cliente consulta: só o modo), o ETag que
//   muda quando muda (e não muda quando salva igual);
// - o pedido guarda o bairro e a taxa que o site mostrou; o aviso do grupo diz a taxa pela tabela do SERVIDOR (nunca o
//   número do site: o que não bate vira "Confere o valor na conversa") ou "a consultar"; o dia de entrega grátis;
// - a comparação do bairro é a mesma no site (src/lib/bairros.ts) e no servidor (gc_loja_chave_bairro).
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rolldown } from 'rolldown'
import { Cli, esperar, gatewayFalso, novoCodigo, novoToken } from './testar-api-pedidos.mjs'

/** O pedido da sacola do RJ (um toque), com o bairro e a taxa que o site mostrou. */
function pedidoRj({ bairro = null, taxa = null, agora } = {}) {
  const codigo = novoCodigo()
  const mensagem = [
    'PEDIDO GREEN CHEESE — RJ / Rio de Janeiro',
    `Código: ${codigo}`,
    "1x Jack Daniel's Old No. 7 1 L — R$ 149,90",
    'Subtotal: R$ 149,90',
    `Entrega: ${bairro ? `${bairro} (${taxa?.texto ?? 'taxa do bairro a consultar'})` : (taxa?.texto ?? 'taxa do bairro a consultar')}`,
    'Endereço: mando aqui na conversa',
  ].join('\n')
  return {
    corpo: {
      codigo,
      token: novoToken(),
      tipo: 'pedido',
      origem: 'sacola',
      uf: 'rj',
      cidade: 'Rio de Janeiro',
      nome: '',
      whatsapp: '',
      itens: [{ produtoId: 'jack-daniels-old-no7-1l', nome: "Jack Daniel's Old No. 7 1 L", variacao: null, qtd: 1, precoUnit: 149.9, total: 149.9, combo: null }],
      subtotal: 149.9,
      subtotalTexto: 'R$ 149,90',
      cupom: null,
      ...(bairro ? { entrega: { endereco: '', rua: '', numero: '', bairro, cep: '', cidade: '', uf: '' } } : {}),
      ...(taxa ? { taxa } : {}),
      mensagem,
      site: '',
      substitui: null,
    },
    agora,
  }
}

/** O dia da semana (0 = domingo) de um instante, no horário de Brasília. */
const diaEmBrasilia = (seg) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].indexOf(new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(seg * 1000)).replace('.', ''))

export async function testarBairros(t) {
  const { parte, ok, igual, erro, raiz, tmp, PHP, subirPhp, portaLivre, derrubar, portaPrincipal } = t
  const api = join(raiz, 'public', 'api')
  const roteador = ['-t', join(raiz, 'public'), join(raiz, 'scripts', 'api-dev.php')]
  const php = (codigo, args, env) => execFileSync(PHP, ['-r', codigo, ...args], { encoding: 'utf8', ...(env ? { env: { ...process.env, ...env } } : {}) })
  /** Uma seção que quebra (no código de antes, por exemplo) vira uma falha com o nome dela, e as outras seguem. */
  const secao = async (nome, fn) => {
    parte(nome)
    try {
      await fn()
    } catch (e) {
      ok(false, `${nome}: quebrou (${e.message.split('\n')[0]})`)
    }
  }
  const modulos = `define('GC_API', 1); foreach (['base', 'banco', 'validar', 'limite', 'sessao', 'rateio', 'exemplos', 'publico', 'painel', 'upload', 'diagnostico', 'loja-migracoes', 'loja', 'loja-validar', 'loja-painel', 'pedido-migracoes', 'pedido', 'avisos', 'textos', 'contas-migracoes', 'equipe', 'clientes', 'sorte', 'painel-dono'] as $m) require $argv[1] . "/nucleo/$m.php";`

  // ─── a comparação do bairro: a mesma no site e no servidor ───────────────────────────────────────────────────
  await secao('taxa por bairro: a comparação do bairro é a mesma no site e no servidor', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'gc-bairros-'))
    const saida = join(pasta, 'b.mjs')
    const pacote = await rolldown({ input: join(raiz, 'src/lib/bairros.ts'), logLevel: 'silent' })
    await pacote.write({ file: saida, format: 'esm' })
    await pacote.close()
    const b = await import(pathToFileURL(saida).href)
    rmSync(pasta, { recursive: true, force: true })
    const nomes = ['Copacabana', ' COPACABANA. ', 'Jardim  da Penha', 'Jardim-da-Penha', 'Itapuã', 'ITAPUA', 'Praia da Costa', 'São Conrado', "Olaria D'Água", 'Glória', 'Barra/Tijuca', 'Ilha do Boi (VV)', 'Coqueiral de Itaparica', 'Jabaquara', 'Moema', 'Penha Circular', 'Ñandu', 'Øster', 'Nª Sª da Penha']
    const js = nomes.map((n) => b.chaveBairro(n))
    const doPhp = JSON.parse(php(`${modulos} echo json_encode(array_map('gc_loja_chave_bairro', json_decode($argv[2], true)));`, [api, JSON.stringify(nomes)]))
    igual(js, doPhp, 'chaveBairro (site) e gc_loja_chave_bairro (servidor) dão a mesma chave pros mesmos nomes')
    igual([js[0], js[1], js[2] === js[3], js[4] === js[5]], ['copacabana', 'copacabana', true, true], 'sem acento, sem maiúscula, espaço e pontuação iguais')
    const lista = [
      { nome: 'Copacabana', taxa: 12 },
      { nome: 'Centro', cidade: 'Vila Velha', taxa: 8 },
      { nome: 'Centro', cidade: 'Vitória', taxa: 10 },
      { nome: 'Centro', taxa: 15 },
      { nome: 'Ipanema', taxa: null },
    ]
    const canal = (modo) => ({ uf: 'es', taxaPorBairro: modo === 'consulta' ? { modo } : { modo: 'site', bairros: lista } })
    igual(b.taxaDoBairro(canal('site'), 'copacabana', null), { tipo: 'valor', bairro: 'Copacabana', valor: 12 }, 'o "copacabana" que o cliente digita (ou o CEP preenche) acha o "Copacabana" da lista, com o nome do dono')
    igual(b.taxaDoBairro(canal('site'), 'Centro', 'Vitória'), { tipo: 'valor', bairro: 'Centro', valor: 10 }, 'o bairro com cidade vale na cidade dele')
    igual(b.taxaDoBairro(canal('site'), 'Centro', 'Serra'), { tipo: 'valor', bairro: 'Centro', valor: 15 }, 'outra cidade: o sem cidade (vale pra qualquer uma)')
    igual(b.taxaDoBairro(canal('site'), 'Ipanema', null), { tipo: 'consultar', bairro: 'Ipanema', fora: false }, 'marcado "consultar": a consultar')
    igual(b.taxaDoBairro(canal('site'), 'Tijuca', null), { tipo: 'consultar', bairro: 'Tijuca', fora: true }, 'fora da lista: a consultar (nunca um valor inventado)')
    igual(b.taxaDoBairro(canal('site'), '  ', null), { tipo: 'consultar', bairro: null, fora: false }, 'sem bairro: a consultar')
    igual(b.taxaDoBairro(canal('consulta'), 'Copacabana', null), { tipo: 'consulta', bairro: 'Copacabana' }, 'o cliente consulta: sem valor nenhum')
    igual(b.taxaDoBairro({ uf: 'mg' }, 'Centro', null), { tipo: 'estado' }, 'estado sem taxa por bairro: o de sempre')
    igual(b.fraseConsultaBairro(' Praia  da Costa '), 'Oi! Quanto fica a entrega pro bairro Praia da Costa?', 'a frase pronta do "Perguntar" com o bairro digitado')
    igual(b.fraseConsultaBairro(''), 'Oi! Quanto fica a entrega pro meu bairro?', 'e sem bairro')
    igual(b.sugestoesDeBairro(lista, 'cop', null).map((x) => x.nome), ['Copacabana'], 'a sugestão enquanto digita')
  })

  // ─── a 107 e a 210 num banco como o do ar ────────────────────────────────────────────────────────────────────
  parte('taxa por bairro: as migrações 107 e 210 num banco como o do ar, com estados configurados')
  const dir = join(tmp, 'bairros-ar')
  mkdirSync(dir, { recursive: true })
  const arq = join(dir, 'loja.sqlite')
  php(`define('GC_API', 1); require $argv[1] . '/nucleo/banco.php'; $db = new PDO('sqlite:' . $argv[2]); $db->exec(gc_migracoes_base()[1]); $db->exec('PRAGMA user_version = 1'); $t = time(); $db->prepare("INSERT INTO usuarios (login, nome, senha_hash, papel, criado_em, senha_em) VALUES ('dono', 'Dono', ?, 'dono', ?, ?)")->execute([password_hash('senha-forte-123', PASSWORD_DEFAULT), $t, $t]);`, [api, arq])
  php(`${modulos} gc_db();`, [api], { GC_DADOS: dir })
  // como o banco do ar antes desta entrega (15/10): sem as colunas da 107 e da 210, com o dono configurando os estados
  // (taxa de MG, as cidades do ES, o pedido mínimo do RJ, horário de verdade) e um pedido
  php(`$d = new PDO('sqlite:' . $argv[1]); $t = time();
    $d->exec("UPDATE loja_estados SET taxa = 950, taxa_demo = 0 WHERE uf = 'mg'");
    $d->exec("UPDATE loja_estados SET cidades = '[{\\"slug\\":\\"vila-velha\\",\\"nome\\":\\"Vila Velha\\"},{\\"slug\\":\\"vitoria\\",\\"nome\\":\\"Vitória\\"}]', taxa = 1000, taxa_demo = 0 WHERE uf = 'es'");
    $d->exec("UPDATE loja_estados SET pedido_minimo = 2000, taxa = 1200, taxa_demo = 0, horario_demo = 0 WHERE uf = 'rj'");
    $d->prepare("INSERT INTO pedidos (codigo, token_hash, tipo, status, uf, cidade, nome, itens, subtotal, bairro, mensagem, criado_em, atualizado_em) VALUES ('GC-ANT33', ?, 'pedido', 'novo', 'rj', 'Rio de Janeiro', 'Cliente de Antes', '[]', 1000, 'Tijuca', 'PEDIDO GREEN CHEESE — RJ\\nCódigo: GC-ANT33', ?, ?)")->execute([hash('sha256', 'antes'), $t, $t]);
    foreach (['loja_estados' => ['taxa_por', 'bairros_ver', 'bairros'], 'pedidos' => ['taxa_site', 'taxa_site_texto']] as $tab => $cols) foreach ($cols as $col) try { $d->exec("ALTER TABLE $tab DROP COLUMN $col"); } catch (Throwable $e) {}
    $d->exec('DELETE FROM migracoes WHERE numero IN (107, 210)');`, [arq])
  const colunas = (a) =>
    JSON.parse(
      php(`$d = new PDO('sqlite:' . $argv[1]); $c = fn ($t) => array_column($d->query("PRAGMA table_info($t)")->fetchAll(PDO::FETCH_ASSOC), 'name'); $e = $d->query("SELECT uf, taxa, taxa_demo, cidades, pedido_minimo FROM loja_estados ORDER BY uf")->fetchAll(PDO::FETCH_ASSOC); echo json_encode(['estados' => array_values(array_intersect(['taxa_por', 'bairros_ver', 'bairros'], $c('loja_estados'))), 'pedidos' => array_values(array_intersect(['taxa_site', 'taxa_site_texto'], $c('pedidos'))), 'm' => array_map('intval', $d->query('SELECT numero FROM migracoes WHERE numero IN (107, 210) ORDER BY numero')->fetchAll(PDO::FETCH_COLUMN)), 'versao' => $d->query("SELECT valor FROM ajustes WHERE chave = 'loja.versao'")->fetchColumn(), 'em' => $d->query("SELECT valor FROM ajustes WHERE chave = 'loja.atualizado_em'")->fetchColumn(), 'cfg' => $e]);`, [a]),
    )
  const antes = colunas(arq)
  igual([antes.estados, antes.pedidos, antes.m], [[], [], []], 'o banco de antes: sem as colunas novas, sem a 107 e a 210 no registro')
  // a mesma loja, servida sem a 107 (o registro diz que rodou, mas as colunas não existem: o caminho de antes), pra
  // comparar o GET loja de antes e de depois
  const dirAntes = join(tmp, 'bairros-ar-copia')
  mkdirSync(dirAntes, { recursive: true })
  copyFileSync(arq, join(dirAntes, 'loja.sqlite'))
  php(`$d = new PDO('sqlite:' . $argv[1]); $d->exec("INSERT INTO migracoes (numero, aplicada_em) VALUES (107, 0)");`, [join(dirAntes, 'loja.sqlite')])
  // três servidores, cada um na sua porta: a cópia "de antes", o banco do ar e a instalação nova
  const portaCopia = process.env.GC_TESTE_PORTA ? portaPrincipal + 9 : await portaLivre()
  const porta = process.env.GC_TESTE_PORTA ? portaPrincipal + 10 : await portaLivre()
  const portaNova = process.env.GC_TESTE_PORTA ? portaPrincipal + 11 : await portaLivre()
  let lojaAntes
  {
    const filho = await subirPhp(portaCopia, { GC_TESTE: '1', GC_DADOS: dirAntes, GC_UPLOADS: join(dirAntes, 'up') }, roteador)
    try {
      const r = await fetch(`http://127.0.0.1:${portaCopia}/api/index.php?r=loja`)
      lojaAntes = { etag: r.headers.get('etag'), texto: await r.text() }
    } finally {
      derrubar(filho)
    }
  }
  const falso = await gatewayFalso()
  const filho = await subirPhp(porta, { GC_TESTE: '1', GC_DADOS: dir, GC_UPLOADS: join(dir, 'up'), GC_ZAPI_BASE: `http://127.0.0.1:${falso.porta}/zapi` }, roteador)
  const b = `http://127.0.0.1:${porta}`
  let ip = 0
  const site = () => new Cli(b, `198.18.60.${++ip}`)
  const dono = new Cli(b, '198.18.61.1')
  const salvar = (corpo) => dono.post('admin-estado-salvar', corpo)
  const campoIndice = (x) => [x.json?.campo, x.json?.indice]
  const loja = async (etag) => {
    const res = await fetch(`${b}/api/index.php?r=loja`, etag ? { headers: { 'If-None-Match': etag } } : {})
    const t = await res.text()
    return { status: res.status, etag: res.headers.get('etag'), texto: t, rj: res.status === 200 ? JSON.parse(t).loja.estados.find((e) => e.uf === 'rj') : null }
  }
  let x
  let a
  try {
    await secao('taxa por bairro: a 107 e a 210 no banco do ar, o GET loja igual', async () => {
      const r = await fetch(`${b}/api/index.php?r=loja`)
      const texto = await r.text()
      const depois = colunas(arq)
      igual([depois.estados, depois.pedidos, depois.m], [['taxa_por', 'bairros_ver', 'bairros'], ['taxa_site', 'taxa_site_texto'], [107, 210]], 'a primeira chamada depois de publicar roda a 107 e a 210 (as colunas novas e o registro)')
      igual([depois.versao, depois.em, depois.cfg], [antes.versao, antes.em, antes.cfg], 'nada do que o dono pôs muda (taxas, cidades, mínimo) e a versão da loja não sobe')
      igual([r.headers.get('etag'), texto === lojaAntes.texto], [lojaAntes.etag, true], 'o GET loja sai byte a byte igual ao de antes da 107 (o mesmo ETag: o celular do cliente recebe 304)')
      const j = JSON.parse(texto)
      ok(j.loja.estados.every((e) => !('taxaPorBairro' in e)), 'nenhum estado com taxa por bairro (o padrão: uma taxa pro estado)')
      igual(j.loja.estados.find((e) => e.uf === 'mg').taxaEntrega, { valor: 9.5, demo: false }, 'a taxa de MG como o dono pôs')
      igual((await dono.post('admin-entrar', { login: 'dono', senha: 'senha-forte-123' })).status, 200, 'o dono entra no banco de antes')
      const adm = (await dono.get('admin-loja')).json.loja.estados
      igual(adm.map((e) => [e.uf, e.taxaPor, e.bairrosVer, e.bairros?.length]), adm.map((e) => [e.uf, 'estado', 'site', 0]), 'no painel: todo estado com uma taxa só, nenhum bairro (nada vem de fábrica)')
      const ant = (await dono.get('admin-pedidos', { query: '&status=todos' })).json.pedidos.find((x) => x.codigo === 'GC-ANT33')
      igual((await dono.get('admin-pedido', { query: `&id=${ant.id}` })).json.pedido.taxaSite, null, 'o pedido de antes fica, sem taxa do site')
    })

    // ─── a conferência da lista ──────────────────────────────────────────────────────────────────────────────
    await secao('taxa por bairro: a conferência da lista', async () => {
      erro(await salvar({ uf: 'rj', taxaPor: 'bairros' }), 400, 'invalido', 'modo que não existe')
      erro(await salvar({ uf: 'rj', bairrosVer: 'whatsapp' }), 400, 'invalido', 'como o cliente vê, que não existe')
      erro(await salvar({ uf: 'rj', bairros: 'Copacabana: 12' }), 400, 'invalido', 'lista que não é lista')
      x = await salvar({ uf: 'rj', bairros: [{ nome: 'Copacabana', taxa: 12 }, { nome: 'X', taxa: 5 }] })
      erro(x, 400, 'invalido', 'nome de 1 letra')
      igual(campoIndice(x), ['bairros', 1], 'o erro diz o campo e qual bairro (o índice)')
      erro(await salvar({ uf: 'rj', bairros: [{ nome: 'B'.repeat(61), taxa: 5 }] }), 400, 'invalido', 'nome de 61 letras')
      erro(await salvar({ uf: 'rj', bairros: [{ nome: '...', taxa: 5 }] }), 400, 'invalido', 'nome só de pontuação')
      x = await salvar({ uf: 'rj', bairros: [{ nome: 'Copacabana', taxa: 12 }, { nome: ' COPACABANA. ', taxa: 10 }] })
      erro(x, 400, 'invalido', 'o mesmo bairro duas vezes (maiúscula, espaço e ponto não contam)')
      igual([x.json?.indice, x.json?.mensagem], [1, '“COPACABANA.” tá duas vezes.'], 'diz qual repetiu')
      erro(await salvar({ uf: 'rj', bairros: [{ nome: 'Itapuã', taxa: 5 }, { nome: 'itapua', taxa: 6 }] }), 400, 'invalido', 'o acento também não conta')
      erro(await salvar({ uf: 'rj', bairros: [{ nome: 'Leblon', taxa: 500.01 }] }), 400, 'invalido', 'taxa acima de R$ 500')
      erro(await salvar({ uf: 'rj', bairros: [{ nome: 'Leblon', taxa: -1 }] }), 400, 'invalido', 'taxa negativa')
      erro(await salvar({ uf: 'rj', bairros: [{ nome: 'Leblon', taxa: 'doze' }] }), 400, 'invalido', 'taxa que não é número')
      erro(await salvar({ uf: 'rj', bairros: [{ nome: 'Centro', cidade: 'Niterói', taxa: 5 }] }), 400, 'invalido', 'cidade que o estado não atende')
      erro(await salvar({ uf: 'rj', bairros: [{ nome: 'Brisamar', taxa: 5 }] }), 422, 'proibido', 'palavra que o site não usa (a mesma regra da cidade)')
      erro(await salvar({ uf: 'rj', bairros: [{ nome: 'Vila Tabaco', taxa: 5 }] }), 422, 'proibido', 'tabaco não entra em campo nenhum')
      const muitos = Array.from({ length: 401 }, (_, i) => ({ nome: `Bairro ${i}`, taxa: 5 }))
      erro(await salvar({ uf: 'rj', bairros: muitos }), 400, 'invalido', '401 bairros: passa do máximo')
      // 400 bairros no pior caso de tamanho (60 letras com acento, cada uma 2 bytes, a cidade e a taxa escrita "R$ 12,50"):
      // passa dos 64 KB de sempre e entra (a rota aceita até 256 KB)
      const longos = Array.from({ length: 400 }, (_, i) => ({ nome: `${'ç'.repeat(56)} ${String(i).padStart(3, '0')}`, cidade: i % 2 ? 'Vila Velha' : 'Vitória', taxa: `R$ ${i % 50},50` }))
      ok(Buffer.byteLength(JSON.stringify({ uf: 'es', taxaPor: 'bairro', bairros: longos })) > 65536, 'a lista de 400 com cidade passa dos 64 KB')
      x = await salvar({ uf: 'es', taxaPor: 'bairro', bairros: longos })
      igual([x.status, x.json?.estado?.bairros?.length, x.json?.estado?.taxaPor], [200, 400, 'bairro'], '400 bairros (o máximo) entram')
      // a mesma lista no outro jeito: cidade escrita sem acento vira a do estado; o mesmo nome em cidades diferentes vale
      x = await salvar({ uf: 'es', bairros: [{ nome: 'Centro', cidade: 'vitoria', taxa: '12,50' }, { nome: 'Centro', cidade: 'Vila Velha', taxa: 8 }, { nome: 'Praia da Costa', taxa: 0 }, { nome: 'Itapuã', taxa: null }] })
      igual(x.json?.estado?.bairros, [{ nome: 'Centro', cidade: 'Vitória', taxa: 12.5 }, { nome: 'Centro', cidade: 'Vila Velha', taxa: 8 }, { nome: 'Praia da Costa', taxa: 0 }, { nome: 'Itapuã', taxa: null }], 'centavos ("12,50"), R$ 0 (sem taxa), consultar (null), a cidade como o estado escreve e o mesmo bairro em duas cidades')
    })

    // ─── os 3 modos no GET loja e o ETag ─────────────────────────────────────────────────────────────────────
    await secao('taxa por bairro: o GET loja nos 3 modos e o ETag', async () => {
      const l0 = await loja()
      igual([l0.rj.taxaEntrega, 'taxaPorBairro' in l0.rj], [{ valor: 12, demo: false }, false], 'uma taxa pro estado: a taxa de sempre, nada novo no JSON')
      x = await salvar({ uf: 'rj', taxaPor: 'bairro', bairrosVer: 'site', bairros: [{ nome: 'Copacabana', taxa: 12 }, { nome: 'Ipanema', taxa: null }, { nome: 'Leblon', taxa: 0 }] })
      igual([x.status, x.json?.estado?.taxaPor, x.json?.estado?.taxaEntrega], [200, 'bairro', { valor: 12, demo: false }], 'RJ por bairro (o painel continua vendo a taxa única guardada)')
      const l1 = await loja(l0.etag)
      igual(l1.status, 200, 'mudou: o ETag de antes não serve (200 com a loja nova)')
      ok(l1.etag !== l0.etag, 'outro ETag')
      igual(l1.rj.taxaPorBairro, { modo: 'site', bairros: [{ nome: 'Copacabana', taxa: 12 }, { nome: 'Ipanema', taxa: null }, { nome: 'Leblon', taxa: 0 }] }, 'aparece no site: a lista vai no GET loja (taxa em reais, null = consultar)')
      igual(l1.rj.taxaEntrega, { valor: null, demo: false }, 'e a taxa única sai "a confirmar" (o site de antes, guardado no celular, não mostra ela no lugar da do bairro)')
      igual(l1.rj.pedidoMinimo, 20, 'o pedido mínimo continua como estava')
      igual((await loja(l1.etag)).status, 304, 'nada mudou: 304')
      x = await salvar({ uf: 'rj', bairros: [{ nome: 'Copacabana', taxa: 12 }, { nome: 'Ipanema', taxa: null }, { nome: 'Leblon', taxa: 0 }] })
      igual([x.status, (await loja(l1.etag)).status], [200, 304], 'salvar a mesma lista: nada muda, nem o ETag')
      x = await salvar({ uf: 'rj', bairrosVer: 'consulta' })
      const l2 = await loja(l1.etag)
      igual([l2.status, l2.rj?.taxaPorBairro], [200, { modo: 'consulta' }], 'o cliente consulta: só o modo, sem a lista')
      ok(!l2.texto.includes('Copacabana') && !l2.texto.includes('Ipanema'), 'nenhum nome da lista no GET loja do modo consulta')
      igual((await dono.get('admin-loja')).json.loja.estados.find((e) => e.uf === 'rj').bairros?.length, 3, 'e o painel continua com a lista inteira')
    })

    // ─── o corpo de antes não mexe ───────────────────────────────────────────────────────────────────────────
    await secao('taxa por bairro: o painel de antes (sem os campos novos) não mexe no modo nem na lista', async () => {
      x = await salvar({ uf: 'rj', taxa: 9, taxaDemo: false })
      igual([x.json?.estado?.taxaPor, x.json?.estado?.bairrosVer, x.json?.estado?.bairros?.length, x.json?.estado?.taxaEntrega?.valor], ['bairro', 'consulta', 3, 9], 'só a taxa única (o painel de antes): o modo, como o cliente vê e a lista ficam')
      x = await salvar({ uf: 'rj', destaque: 'DELIVERY RJ', instagram: 'greencheese_importsrj', whatsapp: null, cidades: [{ nome: 'Rio de Janeiro' }], pagamentos: ['pix', 'dinheiro'], pedidoMinimo: 20, entregaGratis: null })
      igual([x.status, x.json?.estado?.taxaPor, x.json?.estado?.bairros?.length], [200, 'bairro', 3], 'o formulário inteiro de antes: nada da taxa por bairro muda')
      igual((await loja()).rj.taxaPorBairro, { modo: 'consulta' }, 'e o site continua no modo consulta')
      x = await salvar({ uf: 'rj', ativo: false })
      x = await salvar({ uf: 'rj', ativo: true })
      igual([x.json?.estado?.taxaPor, x.json?.estado?.bairros?.length], ['bairro', 3], 'tirar do site e pôr de volta: a lista fica')
      const ev = (await dono.get('admin-eventos')).json.eventos
      ok(ev.some((e) => e.acao === 'estado-editado' && e.texto === 'Taxa de entrega de RJ por bairro (3 bairros, o cliente consulta)'), 'a Atividade diz o modo e quantos bairros')
    })

    // ─── o pedido e o aviso do grupo ─────────────────────────────────────────────────────────────────────────
    await secao('taxa por bairro: o pedido guarda o que o site mostrou; o aviso diz a taxa da tabela do servidor', async () => {
      igual((await dono.post('admin-avisos-salvar', { motor: 'zapi', zapi: { instancia: '3C5A0B1D2E3F', token: 'TOKENZAPI0123456789' }, destino: { tipo: 'grupo', valor: '120363012345678901' } })).status, 200, 'avisos no WhatsApp ligados (gateway falso)')
      igual((await salvar({ uf: 'rj', bairrosVer: 'site' })).status, 200, 'RJ de volta pro "aparece no site"')
      const avisoDe = async (codigo) => {
        const l = (await dono.get('admin-pedidos', { query: `&status=todos&busca=${codigo}` })).json.pedidos.find((p) => p.codigo === codigo)
        let env
        await esperar(async () => {
          env = (await dono.get('admin-avisos')).json.envios.find((e) => e.alvo === `pedido:${l?.id}`)
          return !!env
        })
        const det = (await dono.get('admin-pedido', { query: `&id=${l?.id}` })).json.pedido
        return { entrega: (env?.texto ?? '').split('\n').find((linha) => linha.startsWith('*Entrega:*')), pedido: det }
      }
      const manda = async (o) => {
        const p = pedidoRj(o)
        const r = await site().post('pedido', p.corpo, o.agora ? { agora: o.agora } : {})
        igual(r.status, 201, `pedido com ${o.bairro ?? 'sem bairro'} entra`)
        return avisoDe(p.corpo.codigo)
      }
      a = await manda({ bairro: 'copacabana', taxa: { valor: 12, texto: 'taxa R$ 12,00' } })
      igual([a.pedido?.entrega?.bairro, a.pedido?.taxaSite, a.pedido?.nota], ['copacabana', { valor: 12, texto: 'taxa R$ 12,00' }, ''], 'o pedido guarda o bairro e a taxa que o site mostrou (e bateu: sem anotação)')
      igual(a.entrega, '*Entrega:* na conversa · bairro copacabana _(taxa do bairro R$ 12,00, pela tabela)_', 'o aviso: o bairro e a taxa da tabela')
      a = await manda({ bairro: 'Copacabana', taxa: { valor: 1, texto: 'taxa R$ 1,00' } })
      igual(a.entrega, '*Entrega:* na conversa · bairro Copacabana _(taxa do bairro R$ 12,00, pela tabela)_', 'a cópia forjada com R$ 1: o aviso diz a da tabela (não confia no número do site)')
      igual(a.pedido?.nota, 'Confere o valor na conversa: taxa do bairro Copacabana: R$ 1,00 no site, R$ 12,00 na tabela.', 'e a anotação do pedido diz o que não bateu')
      a = await manda({ bairro: 'Ipanema', taxa: { valor: null, texto: 'taxa do bairro a consultar' } })
      igual([a.entrega, a.pedido?.nota], ['*Entrega:* na conversa · bairro Ipanema _(taxa do bairro a consultar)_', ''], 'bairro marcado "consultar": a consultar')
      a = await manda({ bairro: 'Tijuca', taxa: { valor: null, texto: 'taxa do bairro a consultar' } })
      igual(a.entrega, '*Entrega:* na conversa · bairro Tijuca _(taxa do bairro a consultar: fora da lista)_', 'fora da lista: a consultar')
      a = await manda({ bairro: 'Tijuca', taxa: { valor: 15, texto: 'taxa R$ 15,00' } })
      igual(a.pedido?.nota, 'Confere o valor na conversa: taxa do bairro Tijuca: R$ 15,00 no site, a consultar na tabela.', 'valor no site pra bairro fora da lista: anota')
      a = await manda({ bairro: 'Leblon', taxa: { valor: 0, texto: 'grátis' } })
      igual([a.entrega, a.pedido?.taxaSite], ['*Entrega:* na conversa · bairro Leblon _(bairro sem taxa, pela tabela)_', { valor: 0, texto: 'grátis' }], 'bairro com R$ 0 na tabela: sem taxa')
      a = await manda({ taxa: { valor: null, texto: 'taxa do bairro a consultar' } })
      igual(a.entrega, '*Entrega:* na conversa _(taxa do bairro a consultar: o cliente não disse o bairro)_', 'sem bairro: a consultar')
      // o pedido guiado, com o endereço do CEP (o bairro já tá no endereço)
      {
        const codigo = novoCodigo()
        const corpo = {
          ...pedidoRj({ bairro: 'Copacabana', taxa: { valor: 12, texto: 'taxa R$ 12,00' } }).corpo,
          codigo,
          origem: 'guiado',
          nome: 'Ana Souza',
          entrega: { endereco: 'Rua Barata Ribeiro, 10, Copacabana', rua: 'Rua Barata Ribeiro', numero: '10', bairro: 'Copacabana', cep: '22040-000', cidade: 'Rio de Janeiro', uf: 'rj' },
          pagamento: 'pix',
          mensagem: `PEDIDO GREEN CHEESE — RJ / Rio de Janeiro\nCódigo: ${codigo}\n1x Jack Daniel's Old No. 7 1 L — R$ 149,90\nSubtotal: R$ 149,90\nEntrega: Rua Barata Ribeiro, 10, Copacabana (taxa do bairro: R$ 12,00)\nPagamento: Pix\nNome: Ana Souza`,
        }
        igual((await site().post('pedido', corpo)).status, 201, 'o pedido guiado entra')
        a = await avisoDe(codigo)
        igual(a.entrega, '*Entrega:* Rua Barata Ribeiro, 10 — Copacabana · CEP 22040-000 _(taxa do bairro R$ 12,00, pela tabela)_', 'no guiado: o endereço (com o bairro do CEP) e a taxa da tabela')
      }
      // o dia de entrega grátis vale por cima de tudo
      const sexta = Date.UTC(2026, 9, 16, 21) / 1000 // 16/10/2026, sexta, às 18h em Brasília
      igual(diaEmBrasilia(sexta), 5, 'o instante de teste é sexta em Brasília')
      igual((await salvar({ uf: 'rj', entregaGratis: { dias: [5], texto: 'Sextou com entrega grátis!' } })).status, 200, 'RJ com entrega grátis às sextas')
      a = await manda({ bairro: 'Copacabana', taxa: { valor: null, texto: 'grátis hoje' }, agora: sexta })
      igual([a.entrega, a.pedido?.nota], ['*Entrega:* na conversa · bairro Copacabana _(entrega grátis hoje)_', ''], 'na sexta, o "grátis hoje" do site vale (o dia é de entrega grátis)')
      a = await manda({ bairro: 'Copacabana', taxa: { valor: null, texto: 'grátis hoje' }, agora: sexta - 86400 })
      igual(a.entrega, '*Entrega:* na conversa · bairro Copacabana _(taxa do bairro R$ 12,00, pela tabela)_', 'na quinta, o "grátis hoje" do site não vale: a taxa da tabela')
      igual(a.pedido?.nota, 'Confere o valor na conversa: entrega grátis hoje no site, mas hoje não é dia de entrega grátis.', 'e anota')
      a = await manda({ bairro: 'Copacabana', taxa: { valor: 12, texto: 'taxa R$ 12,00' }, agora: sexta })
      igual(a.entrega, '*Entrega:* na conversa · bairro Copacabana _(taxa do bairro R$ 12,00, pela tabela)_', 'na sexta com a loja fechada até amanhã (o site não prometeu o grátis): a taxa da tabela')
      igual((await salvar({ uf: 'rj', entregaGratis: null })).status, 200, 'RJ sem entrega grátis de novo')
      // o modo consulta: o site não mostra valor; o aviso continua com a tabela (é a loja que lê)
      igual((await salvar({ uf: 'rj', bairrosVer: 'consulta' })).status, 200, 'RJ no "o cliente consulta"')
      a = await manda({ bairro: 'Copacabana', taxa: { valor: null, texto: 'taxa a consultar' } })
      igual([a.entrega, a.pedido?.taxaSite, a.pedido?.nota], ['*Entrega:* na conversa · bairro Copacabana _(taxa do bairro R$ 12,00, pela tabela)_', { valor: null, texto: 'taxa a consultar' }, ''], 'o cliente consulta: o aviso mostra pra loja a taxa da tabela, sem anotação')
      // uma taxa pro estado: o aviso de sempre
      igual((await salvar({ uf: 'rj', taxaPor: 'estado' })).status, 200, 'RJ de volta pra uma taxa só')
      a = await manda({ bairro: 'Copacabana', taxa: { valor: 9, texto: 'taxa R$ 9,00' } })
      igual([a.entrega, a.pedido?.nota], ['*Entrega:* na conversa _(taxa a confirmar)_', ''], 'uma taxa pro estado: o aviso de sempre ("taxa a confirmar"), sem conferir a do bairro')
      igual((await loja()).rj.taxaEntrega, { valor: 9, demo: false }, 'e o site volta a ver a taxa única')
      // a cópia velha (sem a taxa e sem o bairro): entra como sempre
      const velho = pedidoRj({}).corpo
      delete velho.taxa
      igual((await site().post('pedido', velho)).status, 201, 'a cópia do site de antes (sem a taxa) entra')
      igual((await avisoDe(velho.codigo)).pedido?.taxaSite, null, 'sem taxa do site no pedido')
      // taxa torta na cópia: só informa, nunca derruba
      const torto = pedidoRj({ bairro: 'Copacabana', taxa: { valor: 'muito', texto: 42 } }).corpo
      igual((await site().post('pedido', torto)).status, 201, 'taxa torta na cópia: o pedido entra igual')
      igual((await avisoDe(torto.codigo)).pedido?.taxaSite, { valor: null, texto: '42' }, 'e o que não fecha fica de fora')
    })
  } finally {
    derrubar(filho)
    falso.srv.close()
  }

  // ─── instalação nova ─────────────────────────────────────────────────────────────────────────────────────────
  await secao('taxa por bairro: numa instalação nova, os estados nascem com uma taxa só e nenhum bairro', async () => {
    const dn = join(tmp, 'bairros-novo')
    mkdirSync(dn, { recursive: true })
    const filhoN = await subirPhp(portaNova, { GC_TESTE: '1', GC_DADOS: dn, GC_UPLOADS: join(dn, 'up') }, roteador)
    try {
      const cli = new Cli(`http://127.0.0.1:${portaNova}`, '198.18.62.1')
      igual((await cli.post('admin-instalar', { codigo: 'dev-instalar-greencheese', login: 'dono', nome: 'Dono', senha: 'senha-forte-123' })).status, 201, 'instala')
      const est = (await cli.get('admin-loja')).json.loja.estados
      igual(est.map((e) => [e.taxaPor, e.bairrosVer, e.bairros]), est.map(() => ['estado', 'site', []]), 'todo estado com uma taxa só e a lista vazia (nada de bairro nem de valor de fábrica)')
      const j = await (await fetch(`http://127.0.0.1:${portaNova}/api/index.php?r=loja`)).json()
      ok(j.loja.estados.every((e) => !('taxaPorBairro' in e)), 'o GET loja sem taxa por bairro')
      igual(colunas(join(dn, 'loja.sqlite')).m, [107, 210], 'a 107 e a 210 no registro')
      const novo = await cli.post('admin-estado-salvar', { uf: 'ba', instagram: 'greencheese_ba', pagamentos: ['pix'] })
      igual([novo.status, novo.json?.estado?.taxaPor, novo.json?.estado?.bairros], [201, 'estado', []], 'estado ativado no painel nasce com uma taxa só')
      const comBairro = await cli.post('admin-estado-salvar', { uf: 'pe', instagram: 'greencheese_pe', pagamentos: ['pix'], taxaPor: 'bairro', bairros: [{ nome: 'Boa Viagem', taxa: 10 }] })
      igual([comBairro.status, comBairro.json?.estado?.taxaPor, comBairro.json?.estado?.bairros], [201, 'bairro', [{ nome: 'Boa Viagem', taxa: 10 }]], 'ou já por bairro, se o painel mandar')
    } finally {
      derrubar(filhoN)
    }
  })
}
