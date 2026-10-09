// Testes dos pedidos, dos avisos no WhatsApp e das falas do pedido guiado no servidor (chamados pelo
// scripts/testar-api.mjs): o registro de migrações por número (banco de antes do registro), o POST pedido (cada
// validação, armadilha, Origin, tabaco, a mesma entrada de novo, 10 envios juntos, o mesmo código em dois aparelhos, o
// pedido trocado depois de mandar, o limite por IP), o painel dos pedidos (lista, filtros, busca, páginas, detalhe,
// status com volta, WhatsApp do cliente, apagar dados), as falas (GET com ETag/304, troca, cada recusa, voltar ao
// padrão, a lista do servidor em dia) e os avisos contra servidores falsos dos três motores (Z-API, Evolution,
// webhook): o formato exato de cada requisição, o envio depois da resposta, segredo que nunca volta, falha registrada,
// nova tentativa sozinha, o "Reenviar" do painel e a porta pra mandar pra um número (o código de login das contas).
import { execFile, execFileSync } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
/** Agora no relógio do servidor (o AGORA do testar-api é do começo da rodada: já passaram minutos). */
const agoraJa = () => Math.floor(Date.now() / 1000)

const ALF = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
let seq = Math.floor(Math.random() * 1000)
/** Código GC-XXXXX que não repete dentro do teste. */
export function novoCodigo() {
  let n = seq++
  let s = ''
  for (let i = 0; i < 5; i++) {
    s += ALF[n % 31]
    n = Math.floor(n / 31)
  }
  return `GC-${s}`
}
export const novoToken = () => randomBytes(16).toString('hex')

/** Um pedido como o site manda (MG, Jack + 3 OCB no combo, Pix). A mensagem tem espaço duplo no nome (fica exata). */
export function pedidoValido(extra = {}) {
  const codigo = extra.codigo ?? novoCodigo()
  const mensagem = [
    'PEDIDO GREEN CHEESE — MG / Teófilo Otoni',
    `Código: ${codigo}`,
    "1x Jack Daniel's Old No. 7 1 L — R$ 149,90",
    '3x Seda OCB Premium Slim — R$ 19,99',
    'Subtotal: R$ 169,89',
    'Entrega: Rua Doutor Manoel Esteves, 120, apto 201, Centro (taxa a confirmar)',
    'Pagamento: Pix',
    'Nome: Ian  Teste',
    'Obs.: Portão azul',
  ].join('\n')
  return {
    codigo,
    token: novoToken(),
    tipo: 'pedido',
    uf: 'mg',
    cidade: 'Teófilo Otoni',
    nome: 'Ian Teste',
    whatsapp: '',
    itens: [
      { produtoId: 'jack-daniels-old-no7-1l', nome: "Jack Daniel's Old No. 7 1 L", variacao: null, qtd: 1, precoUnit: 149.9, total: 149.9, combo: null },
      { produtoId: 'seda-ocb-premium-slim', nome: 'Seda OCB Premium Slim', variacao: null, qtd: 3, precoUnit: 9.99, total: 19.99, combo: '3 por R$ 19,99' },
    ],
    subtotal: 169.89,
    subtotalTexto: 'R$ 169,89',
    cupom: null,
    entrega: { endereco: 'Rua Doutor Manoel Esteves, 120, apto 201, Centro', rua: 'Rua Doutor Manoel Esteves', numero: '120, apto 201', bairro: 'Centro', cep: '39800-000', cidade: 'Teófilo Otoni', uf: 'mg' },
    pagamento: 'pix',
    troco: null,
    obs: 'Portão azul',
    mensagem,
    site: '',
    ...extra,
  }
}

export function encomendaValida(extra = {}) {
  const codigo = extra.codigo ?? novoCodigo()
  return {
    codigo,
    token: novoToken(),
    tipo: 'encomenda',
    uf: 'rj',
    cidade: 'Rio de Janeiro',
    nome: 'Ana Souza',
    encomenda: { produto: 'Fanta de uva japonesa', quantidade: '2', referencia: 'https://exemplo.com/fanta' },
    mensagem: ['ENCOMENDA GREEN CHEESE — RJ / Rio de Janeiro', `Código: ${codigo}`, 'Produto: Fanta de uva japonesa', 'Quantidade: 2', 'Link/descrição: https://exemplo.com/fanta', 'Nome: Ana Souza'].join('\n'),
    site: '',
    ...extra,
  }
}

/** Cliente HTTP de um servidor (cookie do painel, csrf, Origin). */
class Cli {
  constructor(base, ip) {
    this.base = base
    this.ip = ip
    this.cookie = null
    this.csrf = null
  }
  async req(rota, { metodo = 'GET', corpo, cab = {}, origem = this.base, query = '', agora, csrf } = {}) {
    const headers = { 'X-GC-IP': this.ip, ...cab }
    if (origem) headers.Origin = origem
    if (this.cookie) headers.Cookie = `gc_painel=${this.cookie}`
    const token = csrf === undefined ? this.csrf : csrf
    if (token && metodo === 'POST') headers['X-CSRF'] = token
    if (agora) headers['X-GC-Agora'] = String(agora)
    let body
    if (corpo !== undefined) {
      body = typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
      headers['Content-Type'] ??= 'application/json'
    }
    const inicio = Date.now()
    const r = await fetch(`${this.base}/api/index.php?r=${rota}${query}`, { method: metodo, headers, body, redirect: 'manual' })
    for (const c of r.headers.getSetCookie()) {
      const m = /^gc_painel=([^;]*)/.exec(c)
      if (m) this.cookie = m[1] || null
    }
    const texto = await r.text()
    const ms = Date.now() - inicio
    let json = null
    try {
      json = JSON.parse(texto)
    } catch {
      /* 304 ou arquivo */
    }
    if (json?.csrf) this.csrf = json.csrf
    return { status: r.status, json, texto, headers: r.headers, ms }
  }
  get(rota, opts = {}) {
    return this.req(rota, opts)
  }
  post(rota, corpo, opts = {}) {
    return this.req(rota, { metodo: 'POST', corpo, ...opts })
  }
}

/** Servidor falso dos gateways: guarda cada requisição (método, caminho, cabeçalhos, corpo) e responde no modo da vez. */
async function gatewayFalso() {
  const recebidos = []
  const estado = { modo: 'ok', atraso: 0 }
  const srv = createServer((req, res) => {
    let corpo = ''
    req.on('data', (d) => (corpo += d))
    req.on('end', () => {
      recebidos.push({ metodo: req.method, url: req.url, cab: req.headers, corpo })
      const responder = () => {
        if (estado.modo === '500') return res.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"falhou no gateway"}')
        if (estado.modo === '401') return res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"Unauthorized"}')
        // o gateway que repete a URL (com o token) na resposta: o erro do painel não pode trazer o token
        if (estado.modo === '404-eco') return res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: `instance not found: ${req.url}` }))
        if (estado.modo === 'zapi-erro-200') return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"error":"You are not connected"}')
        if (req.url.startsWith('/zapi/')) return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"zaapId":"3999","messageId":"3EB0","id":"3EB0"}')
        if (req.url.startsWith('/evo/')) return res.writeHead(201, { 'Content-Type': 'application/json' }).end('{"key":{"id":"BAE5"},"status":"PENDING"}')
        return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}')
      }
      if (estado.atraso) setTimeout(responder, estado.atraso)
      else responder()
    })
  })
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok))
  return { srv, porta: srv.address().port, recebidos, estado }
}

/** Espera até a função dar verdadeiro (o envio sai depois da resposta). */
async function esperar(f, ms = 6000) {
  const fim = Date.now() + ms
  while (Date.now() < fim) {
    if (await f()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

export async function testarPedidos(t) {
  const { parte, ok, igual, erro, Cliente, base, dono, tmp, raiz, PHP, subirPhp, portaLivre, derrubar, portaPrincipal } = t
  const site = () => new Cliente()
  const chaves = (o) => Object.keys(o ?? {}).sort()

  // ─── migrações ────────────────────────────────────────────────────────────────────────────────────────────────
  parte('migrações por número')
  {
    const d = join(tmp, 'banco-antigo')
    mkdirSync(d, { recursive: true })
    const arq = join(d, 'loja.sqlite')
    // o banco como estava no ar: só a migração 1, marcada pelo PRAGMA user_version (sem a tabela migracoes)
    const base1 = `define('GC_API', '1'); require '${raiz}public/api/nucleo/base.php'; require '${raiz}public/api/nucleo/banco.php'; require '${raiz}public/api/nucleo/pedido-migracoes.php';`
    execFileSync(PHP, ['-r', `${base1} $d = new PDO('sqlite:${arq}'); $d->exec(gc_migracoes_base()[1]); $d->exec('PRAGMA user_version = 1'); $d->exec("INSERT INTO ajustes (chave, valor) VALUES ('sal', 'velho')");`])
    const ler = () => JSON.parse(execFileSync(PHP, ['-r', `${base1} $db = gc_db(); echo json_encode(['m' => $db->query('SELECT numero, aplicada_em FROM migracoes ORDER BY numero')->fetchAll(PDO::FETCH_ASSOC), 'v' => (int) $db->query('PRAGMA user_version')->fetchColumn(), 'versao' => gc_versao_banco(), 'sal' => gc_ajuste('sal'), 'tabelas' => $db->query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")->fetchAll(PDO::FETCH_COLUMN)]);`], { env: { ...process.env, GC_DADOS: d }, encoding: 'utf8' }))
    const a = ler()
    igual(a.m.map((x) => Number(x.numero)), [1, 200, 201, 202], 'banco antigo: a 1 entra anotada e as dos pedidos (200–202) rodam')
    igual([a.v, a.versao, a.sal], [1, 202, 'velho'], 'user_version segue contando só a base (código de antes não recria nada), o Diagnóstico mostra a 202 e os dados de antes ficam')
    ok(['avisos_envios', 'avisos_tentativas', 'migracoes', 'pedidos', 'textos_pedido', 'usuarios'].every((x) => a.tabelas.includes(x)), `tabelas novas criadas (${a.tabelas.join(', ')})`)
    const b = ler()
    igual(b.m, a.m, 'de novo: nada roda nem muda (aplicada_em igual)')
    const novo = join(tmp, 'banco-novo')
    mkdirSync(novo, { recursive: true })
    const c = JSON.parse(execFileSync(PHP, ['-r', `${base1} $db = gc_db(); echo json_encode($db->query('SELECT numero FROM migracoes ORDER BY numero')->fetchAll(PDO::FETCH_COLUMN));`], { env: { ...process.env, GC_DADOS: novo }, encoding: 'utf8' }))
    igual(c.map(Number), [1, 200, 201, 202], 'banco novo: todas, na ordem')
    // o index.php de antes (sem o módulo dos pedidos) com o banco.php novo, no meio da publicação: só a base, sem erro
    const meio = join(tmp, 'banco-meio')
    mkdirSync(meio, { recursive: true })
    const so = JSON.parse(execFileSync(PHP, ['-r', `define('GC_API', '1'); require '${raiz}public/api/nucleo/base.php'; require '${raiz}public/api/nucleo/banco.php'; $db = gc_db(); echo json_encode($db->query('SELECT numero FROM migracoes ORDER BY numero')->fetchAll(PDO::FETCH_COLUMN));`], { env: { ...process.env, GC_DADOS: meio }, encoding: 'utf8' }))
    igual(so.map(Number), [1], 'sem o módulo carregado (publicação no meio): só a base, e as dos pedidos esperam a próxima chamada')
    const depois = JSON.parse(execFileSync(PHP, ['-r', `${base1} $db = gc_db(); echo json_encode($db->query('SELECT numero FROM migracoes ORDER BY numero')->fetchAll(PDO::FETCH_COLUMN));`], { env: { ...process.env, GC_DADOS: meio }, encoding: 'utf8' }))
    igual(depois.map(Number), [1, 200, 201, 202], 'com o módulo de volta: as que faltavam rodam')
  }

  // ─── pedido ───────────────────────────────────────────────────────────────────────────────────────────────────
  parte('pedido: validação')
  {
    const c = site()
    erro(await c.post('pedido', pedidoValido(), { origem: null }), 403, 'origem', 'sem Origin')
    erro(await c.post('pedido', pedidoValido(), { origem: 'https://golpe.example' }), 403, 'origem', 'Origin de fora')
    erro(await c.post('pedido', 'codigo=GC-AAAAA', { cab: { 'Content-Type': 'text/plain' } }), 415, 'invalido', 'corpo que não é JSON')
    const casos = [
      [{ codigo: 'GC-0O1IL' }, 'codigo', 'código com letra ambígua'],
      [{ codigo: 'RAT-K8EA' }, 'codigo', 'código de outro tipo'],
      [{ token: 'curto' }, 'token', 'token mal formado'],
      [{ site: 'http://spam' }, 'site', 'armadilha cheia'],
      [{ tipo: 'outro' }, 'tipo', 'tipo desconhecido'],
      [{ uf: 'xx' }, 'uf', 'estado inválido'],
      [{ nome: 'I' }, 'nome', 'nome curto'],
      [{ itens: [] }, 'itens', 'pedido sem itens'],
      [{ itens: [{ nome: 'X', qtd: 0, precoUnit: 1, total: 1 }] }, 'itens', 'quantidade 0'],
      [{ itens: [{ nome: 'X', qtd: 1, precoUnit: 1.999, total: 1.999 }], subtotal: 1.999 }, 'itens', 'preço com 3 casas'],
      [{ itens: [{ nome: 'X', qtd: 1, precoUnit: null, total: 5 }] }, 'itens', 'total sem preço unitário'],
      [{ subtotal: 170 }, 'subtotal', 'subtotal que não bate com os itens'],
      [{ cupom: { codigo: 'x', regra: 'r', origem: 'o' } }, 'cupom', 'cupom mal formado'],
      [{ cupom: 'SORTE-AB12' }, 'cupom', 'cupom que não é objeto'],
      [{ pagamento: 'boleto' }, 'pagamento', 'pagamento desconhecido'],
      [{ mensagem: 'PEDIDO GREEN CHEESE — MG\n1x Jack' }, 'mensagem', 'mensagem sem a linha do código'],
    ]
    for (const [extra, campo, msg] of casos) {
      const r = await c.post('pedido', pedidoValido(extra))
      erro(r, 400, 'invalido', msg)
      igual(r.json?.campo, campo, `${msg}: campo`)
    }
    const semCodigo = pedidoValido()
    const outra = pedidoValido({ mensagem: semCodigo.mensagem })
    igual((await c.post('pedido', outra)).json?.campo, 'mensagem', 'mensagem com o código de outro pedido')
    const enc = encomendaValida({ mensagem: pedidoValido().mensagem })
    igual((await c.post('pedido', enc)).json?.campo, 'mensagem', 'encomenda com mensagem de pedido')
    // as de cima já gastaram quase todas as 20 tentativas da hora deste IP (as erradas contam): as próximas vêm de outros
    const fumo = await site().post('pedido', pedidoValido({ itens: [{ nome: 'Backwoods Honey', qtd: 1, precoUnit: 90, total: 90 }], subtotal: 90 }))
    erro(fumo, 422, 'proibido', 'item com tabaco')
    igual([fumo.json?.campo, fumo.json?.termo], ['itens', 'backwoods'], 'tabaco: campo e termo')
    const vape = await site().post('pedido', encomendaValida({ encomenda: { produto: 'Vape descartável', quantidade: '1', referencia: '' } }))
    erro(vape, 422, 'proibido', 'encomenda de vape')
    erro(await site().post('pedido', encomendaValida({ encomenda: { produto: 'X', quantidade: '1' } })), 400, 'invalido', 'encomenda sem produto')
    const contagem = Number(execFileSync(PHP, ['-r', `$d = new PDO('sqlite:${join(t.dados, 'loja.sqlite')}'); echo $d->query('SELECT COUNT(*) FROM pedidos')->fetchColumn();`], { encoding: 'utf8' }))
    igual(contagem, 0, 'nada recusado foi gravado')
  }

  parte('pedido: grava uma vez só')
  let primeiro
  {
    const c = site()
    const p = pedidoValido()
    const r = await c.post('pedido', p)
    igual(r.status, 201, 'pedido novo: 201')
    igual(chaves(r.json?.pedido), ['codigo', 'criadoEm', 'status', 'tipo'], 'a resposta não devolve nada pessoal')
    igual([r.json?.pedido?.codigo, r.json?.pedido?.status, r.json?.pedido?.tipo], [p.codigo, 'novo', 'pedido'], 'código, novo e tipo')
    const de2 = await c.post('pedido', p)
    igual([de2.status, de2.json?.repetido, de2.json?.pedido?.codigo], [200, true, p.codigo], 'a mesma entrada de novo: 200 repetido, a mesma')
    const juntos = await Promise.all(Array.from({ length: 10 }, () => site().post('pedido', { ...p, token: p.token })))
    ok(juntos.every((x) => x.status === 200 && x.json?.repetido === true), '10 envios iguais juntos: todos repetidos')
    const p2 = pedidoValido()
    const juntos2 = await Promise.all(Array.from({ length: 8 }, () => site().post('pedido', p2)))
    igual(juntos2.filter((x) => x.status === 201).length, 1, '8 envios novos iguais juntos: 1 cria, os outros repetem')
    const lista = await dono.get('admin-pedidos', { query: `&busca=${p.codigo}` })
    igual(lista.json?.pedidos?.length, 1, 'no painel, um pedido só com aquele código')
    primeiro = lista.json?.pedidos?.[0]
    // o mesmo código sorteado por outro aparelho (outro token) é outro pedido
    const mesmo = await site().post('pedido', pedidoValido({ codigo: p.codigo }))
    igual(mesmo.status, 201, 'o mesmo código com outro token: outro pedido')
    const det = await dono.get('admin-pedido', { query: `&id=${primeiro.id}` })
    igual(det.json?.mesmoCodigo?.length, 1, 'o detalhe mostra o outro com o mesmo código')
    // o token de um pedido com outro código: aparelho adulterado
    const roubo = await site().post('pedido', pedidoValido({ token: p.token }))
    erro(roubo, 400, 'invalido', 'token de outro código')
    igual(roubo.json?.campo, 'token', 'token de outro código: campo token')

    const d = det.json?.pedido
    igual(
      [d.tipo, d.status, d.uf, d.cidade, d.nome, d.whatsapp, d.subtotal, d.subtotalTexto, d.pagamento, d.troco, d.observacao, d.unidades],
      ['pedido', 'novo', 'mg', 'Teófilo Otoni', 'Ian Teste', '', 169.89, 'R$ 169,89', 'pix', null, 'Portão azul', 4],
      'o que o site mostrou, guardado',
    )
    igual(d.itens, p.itens, 'itens com preço unitário, total e combo como o site mostrou')
    igual(d.entrega, { endereco: p.entrega.endereco, rua: p.entrega.rua, numero: p.entrega.numero, bairro: 'Centro', cep: '39800000', cidade: 'Teófilo Otoni', uf: 'mg' }, 'entrega com CEP e bairro')
    igual(d.mensagem, p.mensagem, 'a mensagem exata (o espaço duplo fica)')
    igual(d.resumo, "1x Jack Daniel's Old No. 7 1 L, 3x Seda OCB Premium Slim", 'resumo dos itens pra lista')
    igual(d.proximos, ['confirmado', 'cancelado'], 'de novo: confirmar ou cancelar')

    // dinheiro com troco, cupom e item a consultar
    const comTroco = pedidoValido({
      pagamento: 'dinheiro',
      troco: 200,
      cupom: { codigo: 'SORTE-AB12', regra: 'Leva 4 Seda OCB Premium Slim e paga 3', origem: 'Teste minha sorte' },
      itens: [...pedidoValido().itens, { produtoId: 'hennessy-very-special', nome: 'Hennessy Very Special', variacao: null, qtd: 1, precoUnit: null, total: null, combo: null }],
      subtotalTexto: 'R$ 169,89 + itens a consultar',
    })
    const rt = await site().post('pedido', comTroco)
    igual(rt.status, 201, 'com troco, cupom e item a consultar')
    const lt = (await dono.get('admin-pedidos', { query: `&busca=${comTroco.codigo}` })).json.pedidos[0]
    const dt = (await dono.get('admin-pedido', { query: `&id=${lt.id}` })).json.pedido
    igual([dt.troco, dt.cupom?.codigo, dt.itens[2].precoUnit, dt.subtotal], [200, 'SORTE-AB12', null, 169.89], 'troco, cupom e o "a consultar" guardados')
    const pix = await site().post('pedido', pedidoValido({ pagamento: 'pix', troco: 50 }))
    const dp = (await dono.get('admin-pedido', { query: `&id=${(await dono.get('admin-pedidos', { query: '&limite=1' })).json.pedidos[0].id}` })).json.pedido
    ok(pix.status === 201 && dp.troco === null, 'troco só no dinheiro')

    // encomenda
    const e = encomendaValida()
    igual((await site().post('pedido', e)).status, 201, 'encomenda: 201')
    const le = (await dono.get('admin-pedidos', { query: `&busca=${e.codigo}` })).json.pedidos[0]
    const de = (await dono.get('admin-pedido', { query: `&id=${le.id}` })).json.pedido
    igual([de.tipo, de.encomenda, de.itens, de.resumo], ['encomenda', e.encomenda, [], 'Encomenda: Fanta de uva japonesa (2)'], 'encomenda guardada com produto, quantidade e link')
  }

  parte('pedido: mudou depois de mandar')
  {
    const c = site()
    const a = pedidoValido()
    await c.post('pedido', a)
    // o aparelho mudou o pedido (endereço novo): código novo, com o de antes e o token dele
    const b = pedidoValido({ substitui: { codigo: a.codigo, token: a.token } })
    igual((await c.post('pedido', b)).status, 201, 'o pedido mudado entra')
    const la = (await dono.get('admin-pedidos', { query: `&busca=${a.codigo}` })).json.pedidos.find((x) => x.codigo === a.codigo)
    const lb = (await dono.get('admin-pedidos', { query: `&busca=${b.codigo}` })).json.pedidos[0]
    igual([la.status, la.substituidoPor, lb.status, lb.substitui], ['cancelado', { id: lb.id, codigo: b.codigo }, 'novo', { id: la.id, codigo: a.codigo }], 'o de antes sai da lista (cancelado, trocado pelo novo), com id e código dos dois')
    const da = (await dono.get('admin-pedido', { query: `&id=${la.id}` })).json.pedido
    igual(da.proximos, [], 'o trocado não muda mais de status')
    const reabrir = await dono.post('admin-pedido-status', { id: la.id, status: 'novo' })
    erro(reabrir, 409, 'substituido', 'reabrir o trocado')
    igual([reabrir.json?.por, reabrir.json?.porId], [b.codigo, lb.id], 'diz qual pedido vale (código e id)')
    // sem o token certo, o de antes não sai
    const x = pedidoValido()
    await c.post('pedido', x)
    await c.post('pedido', pedidoValido({ substitui: { codigo: x.codigo, token: novoToken() } }))
    igual((await dono.get('admin-pedidos', { query: `&busca=${x.codigo}` })).json.pedidos[0].status, 'novo', 'substitui com outro token: o de antes fica')
    // passou da janela (2 h depois do de antes): é outro pedido; o de antes fica novo e o novo só lembra dele
    const velho = pedidoValido()
    await c.post('pedido', velho)
    const tarde = pedidoValido({ substitui: { codigo: velho.codigo, token: velho.token } })
    igual((await c.post('pedido', tarde, { agora: agoraJa() + 7300 })).status, 201, 'mudado 2 h depois: entra')
    const lv = (await dono.get('admin-pedidos', { query: `&busca=${velho.codigo}` })).json.pedidos.find((p) => p.codigo === velho.codigo)
    const lt = (await dono.get('admin-pedidos', { query: `&busca=${tarde.codigo}` })).json.pedidos[0]
    igual([lv.status, lv.substituidoPor, lt.substitui], ['novo', null, { id: lv.id, codigo: velho.codigo }], 'passou de 2 h: o de antes continua novo (os dois ficam, ligados)')
    // o de antes já confirmado: os dois ficam (o painel avisa no grupo pra conferir)
    const y = pedidoValido()
    await c.post('pedido', y)
    const ly = (await dono.get('admin-pedidos', { query: `&busca=${y.codigo}` })).json.pedidos[0]
    await dono.post('admin-pedido-status', { id: ly.id, status: 'confirmado' })
    const z = pedidoValido({ substitui: { codigo: y.codigo, token: y.token } })
    await c.post('pedido', z)
    const lz = (await dono.get('admin-pedidos', { query: `&busca=${z.codigo}` })).json.pedidos[0]
    igual([(await dono.get('admin-pedido', { query: `&id=${ly.id}` })).json.pedido.status, lz.substitui], ['confirmado', { id: ly.id, codigo: y.codigo }], 'o de antes confirmado fica; o novo lembra dele')
  }

  parte('pedido: limite por IP')
  {
    const c = new Cliente('192.0.2.150')
    const enviados = []
    for (let i = 0; i < 20; i++) {
      const p = pedidoValido()
      enviados.push(p)
      if ((await c.post('pedido', p)).status !== 201) ok(false, `pedido ${i + 1} do mesmo IP`)
    }
    const r = await c.post('pedido', pedidoValido())
    erro(r, 429, 'muitas-tentativas', '21º pedido novo na hora')
    ok(Number(r.headers.get('retry-after')) > 0, 'Retry-After')
    igual((await c.post('pedido', enviados[3])).json?.repetido, true, 'repetir um que já foi não esbarra no limite')
    igual((await c.post('pedido', pedidoValido(), { agora: agoraJa() + 3700 })).status, 201, 'passou a hora: libera')
  }

  // ─── painel dos pedidos ───────────────────────────────────────────────────────────────────────────────────────
  parte('painel: lista de pedidos')
  {
    erro(await site().get('admin-pedidos'), 401, 'sem-sessao', 'lista sem sessão')
    const todos = (await dono.get('admin-pedidos', { query: '&status=todos&limite=100' })).json
    ok(todos.pedidos.length > 20 && todos.pedidos.every((x, i, a) => i === 0 || a[i - 1].id > x.id), 'o mais novo primeiro')
    igual(chaves(todos.pedidos[0]), ['atualizadoEm', 'cidade', 'codigo', 'criadoEm', 'dadosApagados', 'id', 'nome', 'resumo', 'status', 'substitui', 'substituidoPor', 'subtotal', 'subtotalTexto', 'tipo', 'uf', 'unidades', 'whatsapp'], 'chaves da linha')
    igual(todos.contagem.todos, todos.pedidos.length, 'contagem de todos')
    ok(todos.contagem.novo > 0 && todos.contagem.cancelado > 0 && todos.contagem.confirmado > 0, `contagem por status (${JSON.stringify(todos.contagem)})`)
    igual(todos.ufs, ['mg', 'rj'], 'estados que já tiveram pedido')
    const novos = (await dono.get('admin-pedidos', { query: '&status=novo&limite=100' })).json
    ok(novos.pedidos.length === todos.contagem.novo && novos.pedidos.every((x) => x.status === 'novo'), 'filtro por status')
    const abertos = (await dono.get('admin-pedidos', { query: '&status=abertos&limite=100' })).json
    igual(todos.contagem.abertos, todos.contagem.novo + todos.contagem.confirmado + todos.contagem.saiu, 'em aberto = novo + confirmado + saiu')
    ok(abertos.pedidos.length === todos.contagem.abertos && abertos.pedidos.every((x) => ['novo', 'confirmado', 'saiu'].includes(x.status)), 'filtro "em aberto"')
    const rj = (await dono.get('admin-pedidos', { query: '&uf=rj&limite=100' })).json
    ok(rj.pedidos.length > 0 && rj.pedidos.every((x) => x.uf === 'rj') && rj.contagem.todos === rj.pedidos.length, 'filtro por estado (e a contagem dele)')
    const p1 = (await dono.get('admin-pedidos', { query: '&limite=2' })).json
    const p2 = (await dono.get('admin-pedidos', { query: `&limite=2&antes=${p1.pedidos[1].id}` })).json
    ok(p1.mais && p2.pedidos.length === 2 && p2.pedidos[0].id < p1.pedidos[1].id, 'páginas (antes=<id>, mais)')
    const busca = (await dono.get('admin-pedidos', { query: `&busca=${encodeURIComponent(primeiro.codigo.slice(3).toLowerCase())}` })).json
    ok(busca.pedidos.some((x) => x.codigo === primeiro.codigo), 'busca pelo código sem o GC- e em minúscula')
    const nome = (await dono.get('admin-pedidos', { query: `&busca=${encodeURIComponent('ANA SOUZA')}` })).json
    ok(nome.pedidos.length > 0 && nome.pedidos.every((x) => x.nome === 'Ana Souza'), 'busca pelo nome, sem caixa')
    const acento = await site().post('pedido', pedidoValido({ nome: 'Ícaro Júnior' }))
    const semAcento = (await dono.get('admin-pedidos', { query: `&busca=${encodeURIComponent('icaro jun')}` })).json
    ok(acento.status === 201 && semAcento.pedidos.length === 1, 'busca sem acento acha "Ícaro Júnior"')
    const resumo = (await dono.get('admin-pedidos-resumo')).json
    ok(resumo.novos === novos.pedidos.length + 1 && resumo.ultimos.length === 5 && resumo.ultimos[0].nome === 'Ícaro Júnior', `resumo: novos e os 5 últimos (${resumo.novos})`)
    igual(chaves(resumo.avisos), ['falhas', 'ligado', 'motor', 'naFila', 'ultimoEnviado'], 'resumo: a situação dos avisos')
  }

  parte('painel: status do pedido')
  {
    const p = pedidoValido()
    await site().post('pedido', p)
    const id = (await dono.get('admin-pedidos', { query: `&busca=${p.codigo}` })).json.pedidos[0].id
    erro(await dono.post('admin-pedido-status', { id, status: 'confirmado' }, { csrf: null }), 403, 'csrf', 'sem o X-CSRF')
    const passo = async (status) => (await dono.post('admin-pedido-status', { id, status })).json
    const c1 = await passo('confirmado')
    ok(c1.pedido.status === 'confirmado' && c1.pedido.confirmadoEm && c1.pedido.statusPor === 'painel:dono', 'confirmado, com a data e quem fez')
    igual(c1.pedido.proximos, ['saiu', 'cancelado', 'novo'], 'de confirmado: saiu, cancelado ou voltar')
    igual((await passo('confirmado')).jaEstava, true, 'o mesmo status de novo: jaEstava')
    const s1 = await passo('saiu')
    const e1 = await passo('entregue')
    ok(s1.pedido.saiuEm && e1.pedido.entregueEm && e1.pedido.status === 'entregue', 'saiu pra entrega → entregue, com as datas')
    const can = await dono.post('admin-pedido-status', { id, status: 'cancelado' })
    erro(can, 409, 'transicao-invalida', 'entregue não cancela')
    igual(can.json?.permitidos, ['saiu'], 'entregue só volta pra saiu')
    const volta = await passo('saiu')
    ok(volta.pedido.status === 'saiu' && volta.pedido.entregueEm === null && volta.pedido.saiuEm, 'desfez a entrega: a data da entrega sai')
    const v2 = await passo('confirmado')
    ok(v2.pedido.saiuEm === null && v2.pedido.confirmadoEm, 'voltou pra confirmado: a data de saída sai')
    const cx = await passo('cancelado')
    const re = await passo('novo')
    ok(cx.pedido.canceladoEm && re.pedido.status === 'novo' && re.pedido.confirmadoEm === null && re.pedido.canceladoEm === null, 'cancelou e reabriu: volta pra novo sem as datas')
    erro(await dono.post('admin-pedido-status', { id, status: 'pago' }), 400, 'invalido', 'status desconhecido')
    erro(await dono.post('admin-pedido-status', { id: 999999, status: 'novo' }), 404, 'nao-encontrado', 'pedido que não existe')
    const ev = (await dono.get('admin-eventos')).json.eventos
    ok(ev.some((x) => x.acao === 'pedido-status' && x.texto === `Confirmou o pedido ${p.codigo}`), 'status na Atividade, com frase pronta')
    ok(ev.some((x) => x.acao === 'pedido-recebido' && /^Pedido GC-\w{5} de .+ pelo site \(MG\)$/.test(x.texto)), 'pedido recebido na Atividade')
  }

  parte('painel: WhatsApp do cliente, anotação e apagar dados')
  {
    const p = pedidoValido()
    await site().post('pedido', p)
    const id = (await dono.get('admin-pedidos', { query: `&busca=${p.codigo}` })).json.pedidos[0].id
    erro(await dono.post('admin-pedido-salvar', { id, whatsapp: '123' }), 400, 'invalido', 'WhatsApp que não fecha')
    const s = (await dono.post('admin-pedido-salvar', { id, whatsapp: '(33) 98888-7777', nota: 'Paga na entrega' })).json.pedido
    igual([s.whatsapp, s.nota], ['5533988887777', 'Paga na entrega'], 'WhatsApp e anotação guardados')
    ok((await dono.get('admin-pedidos', { query: '&busca=98888' })).json.pedidos.some((x) => x.id === id), 'busca pelo WhatsApp')
    erro(await dono.post('admin-pedido-apagar-dados', { id }), 409, 'pedido-ativo', 'apagar os dados de pedido em andamento')
    await dono.post('admin-pedido-status', { id, status: 'cancelado' })
    const a = (await dono.post('admin-pedido-apagar-dados', { id })).json.pedido
    igual([a.nome, a.whatsapp, a.entrega.rua, a.entrega.cep, a.observacao, a.mensagem, a.nota, a.dadosApagados, a.subtotal, a.itens.length], ['Dados apagados', '', '', '', '', '', '', true, 169.89, 2], 'dados apagados; itens e valores ficam')
    erro(await dono.post('admin-pedido-salvar', { id, nota: 'x' }), 409, 'dados-apagados', 'não edita depois de apagar')
    const linha = (await dono.get('admin-pedidos', { query: `&busca=${p.codigo}` })).json.pedidos.find((x) => x.id === id)
    igual([linha?.nome, linha?.whatsapp, linha?.dadosApagados], ['Dados apagados', '', true], 'na lista, a linha diz que os dados foram apagados')
    ok(!(await dono.get('admin-pedidos', { query: `&busca=${encodeURIComponent('98888')}` })).json.pedidos.some((x) => x.id === id), 'a busca não acha mais pelo WhatsApp')
    const ev = (await dono.get('admin-eventos')).json.eventos.filter((x) => x.alvo === `pedido:${p.codigo}` && x.detalhe?.id === id)
    ok(ev.length >= 3 && ev.every((x) => !('nome' in x.detalhe) && !x.texto.includes('Ian Teste')), `a Atividade desse pedido fica sem o nome (${ev.map((x) => x.texto).join(' | ')})`)
    ok(ev.some((x) => x.acao === 'pedido-dados-apagados' && x.texto === `Apagou os dados do pedido ${p.codigo} (LGPD)`), 'e diz que apagou')
  }

  // ─── falas do pedido guiado ───────────────────────────────────────────────────────────────────────────────────
  parte('textos do pedido')
  {
    try {
      execFileSync('node', [join(raiz, 'scripts', 'gerar-textos-pedido.mjs'), '--conferir'], { stdio: 'pipe' })
      ok(true, 'a lista do servidor (textos-pedido.json) está em dia com src/dados/textos-pedido.ts')
    } catch (e) {
      ok(false, `textos-pedido.json velho: ${e.stderr ?? e.message}`)
    }
    const info = JSON.parse(readFileSync(join(raiz, 'public/api/nucleo/textos-pedido.json'), 'utf8'))
    const g0 = await site().get('pedido-textos')
    igual([g0.status, g0.json?.textos], [200, {}], 'sem troca: textos vazio (o site usa o padrão)')
    const etag0 = g0.headers.get('etag')
    ok(/^"t[0-9a-f]{20}"$/.test(etag0 ?? '') && g0.json?.versao === etag0, `ETag (${etag0})`)
    const n304 = await site().get('pedido-textos', { cab: { 'If-None-Match': etag0 } })
    igual([n304.status, n304.texto], [304, ''], 'If-None-Match igual: 304 sem corpo')
    const proxy = await site().get('pedido-textos', { cab: { 'If-None-Match': `"t-velha", W/${etag0.replace(/"$/, '-gzip"')}` } })
    igual(proxy.status, 304, 'a versão que um proxy marcou (W/ e -gzip), no meio de outras: 304 também')
    erro(await site().post('admin-texto-pedido-salvar', { chave: 'nome.pergunta', texto: 'Oi' }), 401, 'sem-sessao', 'trocar fala sem sessão')
    const sal = await dono.post('admin-texto-pedido-salvar', { chave: 'nome.pergunta', texto: '  Como te chamo?  ' })
    igual(sal.json?.textos?.['nome.pergunta']?.texto, 'Como te chamo?', 'trocou (sem os espaços das pontas)')
    ok(sal.json.textos['nome.pergunta'].por === 'painel:dono' && sal.json.textos['nome.pergunta'].atualizadoEm, 'com quem e quando')
    const g1 = await site().get('pedido-textos', { cab: { 'If-None-Match': etag0 } })
    igual([g1.status, g1.json?.textos], [200, { 'nome.pergunta': 'Como te chamo?' }], 'a versão velha recebe a troca')
    ok(g1.headers.get('etag') !== etag0, 'ETag nova')
    const m = await dono.post('admin-texto-pedido-salvar', { chave: 'local.confirmar', texto: 'Vai pra {lugar} ({uf}), {nome}?' })
    erro(m, 400, 'invalido', 'marcador que não existe naquela fala')
    ok(m.json?.marcador === 'nome' && /\{nome\} não existe aqui\. Dá pra usar: \{lugar\}, \{cidade\}, \{uf\}, \{estado\}\./.test(m.json?.mensagem ?? ''), `diz quais valem (${m.json?.mensagem})`)
    erro(await dono.post('admin-texto-pedido-salvar', { chave: 'nome.pergunta', texto: 'Teu {nome?' }), 400, 'invalido', 'chave sobrando')
    erro(await dono.post('admin-texto-pedido-salvar', { chave: 'sacola.vazia', texto: 'x {uf}' }), 400, 'invalido', 'marcador em fala que não tem nenhum')
    const longo = await dono.post('admin-texto-pedido-salvar', { chave: 'local.sim', texto: 'x'.repeat(41) })
    erro(longo, 400, 'invalido', 'botão passa de 40')
    igual(longo.json?.maximo, 40, 'diz o máximo')
    erro(await dono.post('admin-texto-pedido-salvar', { chave: 'resumo.fechar', texto: 'Fecha no WhatsApp que tem frete grátis!' }), 400, 'invalido', 'promessa de frete')
    erro(await dono.post('admin-texto-pedido-salvar', { chave: 'resumo.fechar', texto: 'Chega em 30 minutos.' }), 400, 'invalido', 'promessa de prazo')
    erro(await dono.post('admin-texto-pedido-salvar', { chave: 'enc.produto', texto: 'Qual cigarro você quer?' }), 422, 'proibido', 'tabaco')
    erro(await dono.post('admin-texto-pedido-salvar', { chave: 'nao.existe', texto: 'x' }), 400, 'invalido', 'chave que não existe')
    const ok2 = await dono.post('admin-texto-pedido-salvar', { chave: 'local.confirmar', texto: 'Vai pra {cidade} ({uf}), beleza?' })
    igual(ok2.json?.textos?.['local.confirmar']?.texto, 'Vai pra {cidade} ({uf}), beleza?', 'marcadores da lista valem')
    const igualPadrao = await dono.post('admin-texto-pedido-salvar', { chave: 'local.confirmar', texto: info.textos['local.confirmar'].padrao })
    ok(!('local.confirmar' in igualPadrao.json.textos), 'igual ao padrão: a troca sai')
    const volta = await dono.post('admin-texto-pedido-salvar', { chave: 'nome.pergunta', texto: null })
    igual(volta.json?.textos, {}, 'null: volta ao padrão')
    const g2 = await site().get('pedido-textos')
    igual([g2.json?.textos, g2.headers.get('etag')], [{}, etag0], 'sem troca de novo: a ETag volta a ser a do começo')
    const ev = (await dono.get('admin-eventos')).json.eventos
    ok(ev.some((x) => x.acao === 'texto-pedido-trocado' && x.texto === 'Trocou a fala "Teu nome?" do pedido guiado'), 'troca na Atividade, pela fala (sem a chave técnica)')
    ok(ev.some((x) => x.acao === 'texto-pedido-padrao' && x.texto === 'Voltou ao texto de sempre a fala "Teu nome?" do pedido guiado'), 'volta ao padrão na Atividade')
  }

  // ─── avisos no WhatsApp: servidor próprio, com os gateways falsos ─────────────────────────────────────────────
  const falso = await gatewayFalso()
  const pA = process.env.GC_TESTE_PORTA ? portaPrincipal + 5 : await portaLivre()
  const dA = join(tmp, 'avisos')
  const filho = await subirPhp(pA, { GC_TESTE: '1', GC_DADOS: dA, GC_UPLOADS: join(dA, 'up'), GC_ZAPI_BASE: `http://127.0.0.1:${falso.porta}/zapi` }, ['-t', join(raiz, 'public'), join(raiz, 'scripts', 'api-dev.php')])
  const bA = `http://127.0.0.1:${pA}`
  let ipN = 0
  const cli = () => new Cli(bA, `198.18.7.${++ipN}`)
  const loja = new Cli(bA, '198.18.9.1')
  try {
    await loja.post('admin-instalar', { codigo: 'dev-instalar-greencheese', login: 'dono', nome: 'Dono', senha: 'senha-forte-123' })
    const SEG = { token: 'TOKENZAPI0123456789', clientToken: 'CLIENTETOKEN987654', apikey: 'APIKEY-EVOLUTION-55555', segredo: 'segredo-do-webhook-123456' }
    const nadaVaza = (texto, msg) => ok(!Object.values(SEG).some((s) => texto.includes(s)), `${msg}: nenhum segredo na resposta`)

    parte('avisos: ajustes')
    {
      const a0 = await loja.get('admin-avisos')
      igual([a0.json?.config?.motor, a0.json?.situacao?.ligado, a0.json?.envios], ['nenhum', false, []], 'começa desligado')
      // desligado: o pedido entra e nada vai pra fila
      await cli().post('pedido', pedidoValido())
      igual((await loja.get('admin-avisos')).json.envios, [], 'desligado: pedido não gera aviso')
      erro(await loja.post('admin-avisos-testar', {}), 409, 'avisos-desligados', 'testar desligado')
      const falta = await loja.post('admin-avisos-salvar', { motor: 'zapi', zapi: { instancia: '3C5A0B1D2E3F' }, destino: { tipo: 'grupo', valor: '120363012345678901@g.us' } })
      erro(falta, 400, 'invalido', 'Z-API sem token')
      igual(falta.json?.campo, 'zapi.token', 'diz que falta o token')
      erro(await loja.post('admin-avisos-salvar', { motor: 'zapi', zapi: { instancia: '3C5A0B1D2E3F', token: SEG.token }, destino: { tipo: 'grupo', valor: 'grupo da loja' } }), 400, 'invalido', 'ID de grupo que não é número')
      erro(await loja.post('admin-avisos-salvar', { motor: 'zapi', zapi: { instancia: '3C5A0B1D2E3F', token: SEG.token }, destino: { tipo: 'numero', valor: '123' } }), 400, 'invalido', 'número que não fecha')
      erro(await loja.post('admin-avisos-salvar', { motor: 'pombo' }), 400, 'invalido', 'motor desconhecido')
      const s = await loja.post('admin-avisos-salvar', { motor: 'zapi', zapi: { instancia: '3C5A0B1D2E3F', token: SEG.token, clientToken: SEG.clientToken }, destino: { tipo: 'grupo', valor: '120363012345678901-group' } })
      igual(s.status, 200, 'Z-API completo salva')
      igual(s.json?.config?.zapi, { instancia: '3C5A0B1D2E3F', token: '6789', clientToken: '7654' }, 'segredos só com o final')
      igual(s.json?.config?.destino, { tipo: 'grupo', valor: '120363012345678901' }, 'o ID do grupo sem o "-group" (e sem o "@g.us")')
      nadaVaza(s.texto, 'salvar')
      // salvar de novo sem mandar o token (o painel nunca tem ele): continua o de antes
      const s2 = await loja.post('admin-avisos-salvar', { motor: 'zapi', zapi: { instancia: '3C5A0B1D2E3F', token: '' }, eventos: { 'rateio-reserva': true } })
      igual(s2.json?.config?.zapi?.token, '6789', 'token vazio: fica o de antes')
      nadaVaza((await loja.get('admin-avisos')).texto, 'GET admin-avisos')
    }

    parte('avisos: Z-API (formato exato e depois da resposta)')
    let idPedidoZ
    {
      falso.recebidos.length = 0
      falso.estado.atraso = 1500
      const p = pedidoValido({ whatsapp: '33 99123-4567', cupom: { codigo: 'SORTE-AB12', regra: 'Leva 4 Seda OCB Premium Slim e paga 3', origem: 'Teste minha sorte' } })
      const r = await cli().post('pedido', p)
      igual(r.status, 201, 'pedido entra com o Z-API ligado')
      ok(r.ms < 1200, `a resposta não espera o gateway (${r.ms} ms com o gateway demorando 1,5 s)`)
      ok(await esperar(() => falso.recebidos.length === 1), 'o gateway recebeu 1 requisição')
      falso.estado.atraso = 0
      const q = falso.recebidos[0]
      igual([q.metodo, q.url], ['POST', `/zapi/instances/3C5A0B1D2E3F/token/${SEG.token}/send-text`], 'POST /instances/{instancia}/token/{token}/send-text')
      igual([q.cab['client-token'], q.cab['content-type']], [SEG.clientToken, 'application/json'], 'cabeçalhos Client-Token e JSON')
      const corpo = JSON.parse(q.corpo)
      igual(chaves(corpo), ['message', 'phone'], 'corpo só com phone e message')
      igual(corpo.phone, '120363012345678901-group', 'phone = <id-do-grupo>-group')
      const linhas = corpo.message.split('\n')
      igual(linhas[0], `*NOVO PEDIDO* · #${p.codigo}`, 'abre com *NOVO PEDIDO* e o código')
      ok(/^MG \/ Teófilo Otoni · (dom|seg|ter|qua|qui|sex|sáb)\., \d{2}\/\d{2} às \d{2}:\d{2}$/.test(linhas[1]), `estado, cidade e hora de Brasília (${linhas[1]})`)
      const esperado = [
        '*Itens*',
        "1x Jack Daniel's Old No. 7 1 L — R$ 149,90",
        '3x Seda OCB Premium Slim — R$ 19,99 _(combo 3 por R$ 19,99)_',
        'Subtotal: *R$ 169,89*',
        'Cupom: SORTE-AB12 — Leva 4 Seda OCB Premium Slim e paga 3 _(a loja confirma)_',
        '',
        '*Entrega:* Rua Doutor Manoel Esteves, 120, apto 201 — Centro · CEP 39800-000 _(taxa a confirmar)_',
        '*Pagamento:* Pix',
        '*Cliente:* Ian Teste · wa.me/5533991234567',
        '*Obs.:* Portão azul',
        '',
      ]
      igual(linhas.slice(3, 3 + esperado.length), esperado, 'itens, combo, subtotal, cupom, entrega, pagamento, cliente e obs.')
      idPedidoZ = (await loja.get('admin-pedidos', { query: `&busca=${p.codigo}` })).json.pedidos[0].id
      igual(linhas.at(-1), `Painel: ${bA}/painel/#/pedido/${idPedidoZ}`, 'termina com o link do pedido no painel')
      ok(!corpo.message.includes('**') && (corpo.message.match(/\p{Extended_Pictographic}/gu) ?? []).length === 0, 'sem emoji e sem negrito quebrado')
      let env
      await esperar(async () => {
        env = (await loja.get('admin-avisos')).json.envios[0]
        return env?.status === 'enviado'
      })
      igual([env.tipo, env.alvo, env.status, env.motor, env.tentativas, env.erro], ['pedido', `pedido:${idPedidoZ}`, 'enviado', 'zapi', 1, ''], 'no histórico: enviado na 1ª')
      ok(env.ultimas.length === 1 && env.ultimas[0].ok && env.ultimas[0].http === 200 && env.ultimas[0].por === 'sistema', 'a tentativa registrada (200, pelo sistema)')
      igual(env.texto, corpo.message, 'o histórico guarda o texto que saiu')
      const det = (await loja.get('admin-pedido', { query: `&id=${idPedidoZ}` })).json
      igual(det.avisos?.[0]?.id, env.id, 'o detalhe do pedido mostra o aviso dele')
      // a repetição do mesmo pedido não avisa de novo
      falso.recebidos.length = 0
      await cli().post('pedido', p)
      await new Promise((r) => setTimeout(r, 400))
      igual(falso.recebidos.length, 0, 'a mesma entrada de novo não avisa de novo')
      // encomenda e pedido trocado têm o título deles
      const e = encomendaValida()
      await cli().post('pedido', e)
      ok(await esperar(() => falso.recebidos.length === 1), 'encomenda avisa')
      const me = JSON.parse(falso.recebidos[0].corpo).message.split('\n')
      igual([me[0], me[3], me[4], me[5], me[6]], [`*NOVA ENCOMENDA* · #${e.codigo}`, '*Produto:* Fanta de uva japonesa', '*Quantidade:* 2', '*Link/descrição:* https://exemplo.com/fanta', '*Cliente:* Ana Souza'], 'encomenda: produto, quantidade, link e cliente')
      falso.recebidos.length = 0
      const a = pedidoValido()
      const c = cli()
      await c.post('pedido', a)
      await esperar(() => falso.recebidos.length === 1)
      const b = pedidoValido({ substitui: { codigo: a.codigo, token: a.token }, pagamento: 'dinheiro', troco: 100 })
      await c.post('pedido', b)
      ok(await esperar(() => falso.recebidos.length === 2), 'pedido trocado avisa')
      const mb = JSON.parse(falso.recebidos[1].corpo).message
      ok(mb.startsWith(`*PEDIDO ATUALIZADO* · #${b.codigo}`) && mb.includes(`_Entra no lugar do #${a.codigo}, que saiu da lista._`) && mb.includes('*Pagamento:* Dinheiro (troco pra R$ 100,00)'), 'pedido atualizado: diz qual saiu e o troco')
    }

    parte('avisos: falha, nova tentativa e reenviar')
    {
      falso.recebidos.length = 0
      falso.estado.modo = '500'
      const p = pedidoValido()
      await cli().post('pedido', p)
      const id = (await loja.get('admin-pedidos', { query: `&busca=${p.codigo}` })).json.pedidos[0].id
      let env
      ok(await esperar(async () => {
        env = (await loja.get('admin-avisos')).json.envios.find((x) => x.alvo === `pedido:${id}`)
        return env?.status === 'falhou'
      }), 'gateway com erro: o aviso fica como falhou')
      ok(/HTTP 500/.test(env.erro) && env.tentarEm && env.tentativas === 1, `erro em português e nova tentativa marcada (${env.erro})`)
      igual((await loja.get('admin-pedidos-resumo')).json.avisos.falhas, 1, 'o Resumo conta a falha')
      // ainda não deu o tempo: ninguém tenta de novo
      falso.recebidos.length = 0
      await loja.get('admin-pedidos')
      await new Promise((r) => setTimeout(r, 300))
      igual(falso.recebidos.length, 0, 'antes de 1 min, não tenta de novo')
      // passou 1 min: o painel abrindo dispara a nova tentativa (ainda com erro, marca a de 5 min)
      await loja.get('admin-pedidos', { agora: agoraJa() + 70 })
      ok(await esperar(() => falso.recebidos.length === 1), 'passou 1 min: tenta de novo sozinho')
      falso.estado.modo = 'ok'
      await loja.get('admin-avisos', { agora: agoraJa() + 400 })
      ok(await esperar(async () => (await loja.get('admin-avisos')).json.envios.find((x) => x.alvo === `pedido:${id}`)?.status === 'enviado'), 'passou 5 min: a 3ª vai')
      const final = (await loja.get('admin-avisos')).json.envios.find((x) => x.alvo === `pedido:${id}`)
      ok(final.tentativas === 3 && final.ultimas.length === 3 && final.ultimas[0].ok && !final.ultimas[1].ok && final.tentarEm === null, 'três tentativas registradas, a última ok')

      // falhou de vez (401): o Reenviar do painel manda na hora e responde o resultado
      falso.estado.modo = '401'
      const q = pedidoValido()
      await cli().post('pedido', q)
      const idq = (await loja.get('admin-pedidos', { query: `&busca=${q.codigo}` })).json.pedidos[0].id
      let eq
      await esperar(async () => {
        eq = (await loja.get('admin-avisos')).json.envios.find((x) => x.alvo === `pedido:${idq}`)
        return eq?.status === 'falhou'
      })
      ok(/recusou a chave/.test(eq.erro), `401: "recusou a chave" (${eq.erro})`)
      falso.estado.modo = '404-eco'
      const r404 = await loja.post('admin-aviso-reenviar', { id: eq.id })
      ok(r404.json?.envio?.status === 'falhou' && /não achou a instância/.test(r404.json.envio.erro), `404: "não achou a instância" (${r404.json?.envio?.erro})`)
      nadaVaza(r404.texto, 'erro que repete a URL do gateway')
      falso.estado.modo = 'zapi-erro-200'
      const r200 = await loja.post('admin-aviso-reenviar', { id: eq.id })
      ok(r200.json?.envio?.status === 'falhou' && /não confirmou|not connected/i.test(r200.json.envio.erro), `Z-API 200 com "error": falhou (${r200.json?.envio?.erro})`)
      falso.estado.modo = 'ok'
      const rok = await loja.post('admin-aviso-reenviar', { id: eq.id })
      ok(rok.json?.envio?.status === 'enviado' && rok.json.envio.ultimas[0].por === 'painel:dono', 'Reenviar: enviado, pelo painel')
      const rde = await loja.post('admin-aviso-reenviar', { id: eq.id })
      ok(rde.json?.envio?.status === 'enviado' && rde.json.envio.tentativas === rok.json.envio.tentativas + 1, 'Reenviar o que já foi: manda de novo')
      erro(await loja.post('admin-aviso-reenviar', { id: 999999 }), 404, 'nao-encontrado', 'reenviar aviso que não existe')
      erro(await loja.post('admin-aviso-reenviar', { id: eq.id }, { csrf: null }), 403, 'csrf', 'reenviar sem o X-CSRF')
      falso.estado.modo = 'ok'
    }

    parte('avisos: Evolution')
    {
      erro(await loja.post('admin-avisos-salvar', { motor: 'evolution', evolution: { url: 'ftp://evo.exemplo.com', instancia: 'loja', apikey: SEG.apikey } }), 400, 'invalido', 'URL que não é http(s)')
      const s = await loja.post('admin-avisos-salvar', { motor: 'evolution', evolution: { url: `http://127.0.0.1:${falso.porta}/evo/`, instancia: 'loja gc', apikey: SEG.apikey }, destino: { tipo: 'grupo', valor: '120363012345678901' } })
      igual([s.status, s.json?.config?.evolution?.apikey, s.json?.config?.evolution?.url], [200, '5555', `http://127.0.0.1:${falso.porta}/evo`], 'Evolution salva (apikey só com o final, URL sem a barra do fim)')
      falso.recebidos.length = 0
      const t2 = await loja.post('admin-avisos-testar', {})
      igual(t2.json?.envio?.status, 'enviado', '"Enviar teste": enviado na hora')
      const q = falso.recebidos[0]
      igual([q?.metodo, q?.url, q?.cab?.apikey], ['POST', '/evo/message/sendText/loja%20gc', SEG.apikey], 'POST {url}/message/sendText/{instancia} com apikey')
      const corpo = JSON.parse(q.corpo)
      igual(chaves(corpo), ['number', 'text'], 'corpo só com number e text')
      igual(corpo.number, '120363012345678901@g.us', 'number = <id>@g.us')
      ok(corpo.text.startsWith('*TESTE DE AVISO* · Green Cheese\nSe chegou aqui, os avisos tão funcionando ✅\n_Evolution API · '), `texto do teste (${corpo.text.split('\n')[0]})`)
      // número em vez de grupo
      await loja.post('admin-avisos-salvar', { motor: 'evolution', destino: { tipo: 'numero', valor: '(33) 99113-9036' } })
      falso.recebidos.length = 0
      await loja.post('admin-avisos-testar', {})
      igual(JSON.parse(falso.recebidos[0].corpo).number, '5533991139036', 'número: 55 + DDD + 9 dígitos')
      await loja.post('admin-avisos-salvar', { motor: 'evolution', destino: { tipo: 'grupo', valor: '120363012345678901' } })
      // o pagamento de rateio confirmado no painel avisa
      falso.recebidos.length = 0
      const ent = await cli().post('rateio-entrar', { rateio: 'arizona-green-tea', nome: 'Bruno Lima', whatsapp: '(33) 98765-4321', uf: 'mg', cidade: 'Teófilo Otoni', quantidade: 2 })
      igual(ent.status, 201, 'alguém entra num rateio pelo site')
      ok(await esperar(() => falso.recebidos.length === 1), 'a reserva avisa no grupo')
      const mr = JSON.parse(falso.recebidos[0].corpo).text.split('\n')
      igual(mr.slice(0, 3), [`*RATEIO · NOVA RESERVA* · ${ent.json.participacao.codigo}`, 'Arizona Green Tea 680 ml', '2 vagas × R$ 14,90 = *R$ 29,80*'], 'reserva: código, rateio e a conta')
      ok(mr.includes('*Cliente:* Bruno Lima · wa.me/5533987654321') && mr.includes('*De:* MG / Teófilo Otoni') && mr.includes('*Placar:* 0/24 pagas · +2 reservadas') && mr.some((l) => /^\*Guardada até:\* .+ _\(esperando o pagamento\)_$/.test(l)), 'reserva: cliente, estado, prazo e placar')
      igual(mr.at(-1), `Painel: ${bA}/painel/#/rateio/arizona-green-tea`, 'reserva: link do rateio no painel')
      const parts = (await loja.get('admin-participantes', { query: '&rateio=arizona-green-tea' })).json.participantes
      falso.recebidos.length = 0
      const conf = await loja.post('admin-participante-status', { id: parts.find((x) => x.nome === 'Bruno Lima').id, status: 'confirmado' })
      igual(conf.status, 200, 'o dono confirma o pagamento')
      ok(await esperar(() => falso.recebidos.length === 1), 'o pagamento confirmado avisa no grupo')
      const mp = JSON.parse(falso.recebidos[0].corpo).text.split('\n')
      ok(mp[0] === `*RATEIO · PAGAMENTO CONFIRMADO* ✅ · ${ent.json.participacao.codigo}` && mp.includes('*Placar:* 2/24 pagas') && mp.includes('_Confirmado no painel (dono)._'), `pagamento: ✅, placar e quem confirmou (${mp.join(' | ')})`)
      // o mesmo status de novo não avisa de novo
      falso.recebidos.length = 0
      await loja.post('admin-participante-status', { id: parts.find((x) => x.nome === 'Bruno Lima').id, status: 'confirmado' })
      await new Promise((r) => setTimeout(r, 300))
      igual(falso.recebidos.length, 0, 'confirmar de novo não avisa de novo')
      // apagar os dados da vaga (LGPD) também limpa os avisos dela (o nome e o WhatsApp estavam no texto)
      const idBruno = parts.find((x) => x.nome === 'Bruno Lima').id
      await loja.post('admin-participante-status', { id: idBruno, status: 'cancelado' })
      igual((await loja.post('admin-participante-apagar', { id: idBruno })).status, 200, 'apagar os dados da vaga do Bruno')
      const dele = (await loja.get('admin-avisos')).json.envios.filter((x) => x.alvo === `participacao:${ent.json.participacao.codigo}`)
      ok(dele.length === 2 && dele.every((x) => x.texto === 'Dados apagados (LGPD).' && !x.reenvia) && !JSON.stringify(dele).includes('Bruno') && !JSON.stringify(dele).includes('98765'), `os 2 avisos da vaga sem nome nem WhatsApp, e sem reenviar (${dele.map((x) => x.texto).join(' | ')})`)
    }

    parte('avisos: webhook (assinatura)')
    {
      erro(await loja.post('admin-avisos-salvar', { motor: 'webhook', webhook: { url: `http://127.0.0.1:${falso.porta}/hook`, segredo: 'curto' } }), 400, 'invalido', 'segredo curto')
      const s = await loja.post('admin-avisos-salvar', { motor: 'webhook', webhook: { url: `http://127.0.0.1:${falso.porta}/hook/abc123?origem=gc`, segredo: SEG.segredo } })
      igual([s.status, s.json?.config?.webhook?.segredo, s.json?.config?.webhook?.temUrl], [200, '3456', true], 'webhook salvo (segredo só com o final)')
      ok(s.json.config.webhook.url.startsWith(`http://127.0.0.1:${falso.porta}/•••`) && !s.json.config.webhook.url.includes('abc123'), `a URL volta mascarada (${s.json.config.webhook.url})`)
      falso.recebidos.length = 0
      await loja.post('admin-avisos-testar', {})
      const q = falso.recebidos[0]
      igual([q?.metodo, q?.url], ['POST', '/hook/abc123?origem=gc'], 'POST na URL do webhook')
      igual(q.cab['x-gc-assinatura'], createHmac('sha256', SEG.segredo).update(q.corpo).digest('hex'), 'X-GC-Assinatura = HMAC-SHA256 do corpo')
      const corpo = JSON.parse(q.corpo)
      igual(chaves(corpo), ['dados', 'texto', 'tipo'], 'corpo {tipo, texto, dados}')
      igual([corpo.tipo, corpo.dados], ['teste', {}], 'tipo teste')
      falso.recebidos.length = 0
      const p = pedidoValido()
      await cli().post('pedido', p)
      ok(await esperar(() => falso.recebidos.length === 1), 'pedido vai pro webhook')
      const cp = JSON.parse(falso.recebidos[0].corpo)
      ok(cp.tipo === 'pedido' && cp.texto.startsWith(`*NOVO PEDIDO* · #${p.codigo}`) && cp.dados.pedido.codigo === p.codigo && cp.dados.pedido.itens.length === 2 && cp.dados.pedido.mensagem === p.mensagem, 'webhook do pedido: tipo, texto e o pedido inteiro nos dados')
      // salvar sem mandar a URL de novo (o painel só tem a mascarada): fica a de antes
      await loja.post('admin-avisos-salvar', { motor: 'webhook', webhook: { url: '', segredo: '' } })
      falso.recebidos.length = 0
      await loja.post('admin-avisos-testar', {})
      igual(falso.recebidos[0]?.url, '/hook/abc123?origem=gc', 'URL vazia ao salvar: fica a de antes')
      // eventos desligados: o pedido não avisa, a encomenda sim
      await loja.post('admin-avisos-salvar', { motor: 'webhook', eventos: { pedido: false } })
      falso.recebidos.length = 0
      await cli().post('pedido', pedidoValido())
      await cli().post('pedido', encomendaValida())
      ok(await esperar(() => falso.recebidos.length === 1), 'encomenda ainda avisa')
      await new Promise((r) => setTimeout(r, 300))
      igual(falso.recebidos.map((x) => JSON.parse(x.corpo).tipo), ['encomenda'], 'com "pedido" desligado, só a encomenda avisou')
      const ev = (await loja.get('admin-eventos')).json.eventos
      ok(ev.some((x) => x.acao === 'avisos-ajustados' && x.texto === 'Ajustou os avisos no WhatsApp (Webhook)'), 'ajuste dos avisos na Atividade')
      ok(!JSON.stringify(ev).includes(SEG.segredo) && !JSON.stringify(ev).includes(SEG.token), 'a Atividade não guarda segredo')
      // desligar volta pro silêncio
      await loja.post('admin-avisos-salvar', { motor: 'nenhum' })
      falso.recebidos.length = 0
      await cli().post('pedido', encomendaValida())
      await new Promise((r) => setTimeout(r, 300))
      igual(falso.recebidos.length, 0, 'desligado: nada sai')
    }

    // a porta pra mandar pra um número ou grupo sem fila (o código de login das contas vai usar): roda no PHP de linha
    // de comando, com o mesmo banco do servidor de teste e o Z-API falso
    const modulos = ['base', 'banco', 'validar', 'limite', 'sessao', 'rateio', 'pedido-migracoes', 'pedido', 'avisos', 'textos'].map((m) => `require '${raiz}public/api/nucleo/${m}.php';`).join(' ')
    const php = async (codigo, env) => JSON.parse((await execFileAsync(PHP, ['-r', `define('GC_API', '1'); ${modulos} ${codigo}`], { env: { ...process.env, ...env }, encoding: 'utf8' })).stdout)
    const comTeste = { GC_TESTE: '1', GC_DADOS: dA, GC_ZAPI_BASE: `http://127.0.0.1:${falso.porta}/zapi` }

    parte('avisos: mandar pra um número (o código de login das contas)')
    {
      await loja.post('admin-avisos-salvar', { motor: 'zapi', destino: { tipo: 'grupo', valor: '120363012345678901' } })
      falso.recebidos.length = 0
      const r = await php(`echo json_encode(gc_whatsapp_mandar('Teu código de entrada: 482913', ['tipo' => 'numero', 'valor' => '(33) 99123-4567'], 'codigo-login', 'conta:5533991234567', 'Código de login pra (33) 9••••-4567'));`, comTeste)
      ok(r.ok === true && r.motor === 'zapi' && Number.isInteger(r.envio), `mandou na hora e devolveu o resultado (${JSON.stringify(r)})`)
      const q = JSON.parse(falso.recebidos[0]?.corpo ?? '{}')
      igual([falso.recebidos.length, q.phone, q.message], [1, '5533991234567', 'Teu código de entrada: 482913'], 'Z-API: phone = o número (55 + DDD + 9 dígitos) e a mensagem de verdade')
      const h = (await loja.get('admin-avisos')).json.envios.find((x) => x.id === r.envio)
      igual(
        [h?.tipo, h?.alvo, h?.para, h?.reenvia, h?.status, h?.texto, h?.ultimas?.length],
        ['codigo-login', 'conta:5533991234567', { tipo: 'numero', valor: '5533991234567' }, false, 'enviado', 'Código de login pra (33) 9••••-4567', 1],
        'no histórico: o destino, enviado e só o registro (o código nunca fica guardado)',
      )
      const noBanco = ['loja.sqlite', 'loja.sqlite-wal'].map((n) => join(dA, n)).filter((f) => existsSync(f)).map((f) => readFileSync(f).toString('utf8')).join('')
      ok(!noBanco.includes('482913'), 'o código não está no banco')
      erro(await loja.post('admin-aviso-reenviar', { id: r.envio }), 409, 'nao-reenvia', 'o painel não reenvia o que não guardou')
      const ruim = await php(`echo json_encode(gc_whatsapp_mandar('x', ['tipo' => 'numero', 'valor' => '123'], 'codigo-login'));`, comTeste)
      ok(ruim.ok === false && ruim.envio === null && falso.recebidos.length === 1, 'número que não fecha: nem tenta')
      // pra um grupo também (o mesmo formato dos avisos), e com o gateway fora: falhou, registrado, sem nova tentativa sozinha
      falso.estado.modo = '500'
      const g = await php(`echo json_encode(gc_whatsapp_mandar('Oi grupo', ['tipo' => 'grupo', 'valor' => '120363099999999999@g.us'], 'aviso-avulso'));`, comTeste)
      falso.estado.modo = 'ok'
      igual([g.ok, JSON.parse(falso.recebidos[1]?.corpo ?? '{}').phone], [false, '120363099999999999-group'], 'grupo: phone = <id>-group; gateway com erro: ok false')
      const hg = (await loja.get('admin-avisos')).json.envios.find((x) => x.id === g.envio)
      igual([hg?.status, hg?.tentarEm, hg?.reenvia, hg?.texto], ['falhou', null, true, 'Oi grupo'], 'falhou e fica pro "Reenviar" do painel (sem registro, o texto fica)')
      igual((await loja.post('admin-aviso-reenviar', { id: g.envio })).json?.envio?.status, 'enviado', 'Reenviar manda pro mesmo grupo')
      igual(JSON.parse(falso.recebidos.at(-1)?.corpo ?? '{}').phone, '120363099999999999-group', 'o reenvio vai pro destino guardado (não o do painel)')
    }

    parte('avisos: endereço de envio no ar')
    {
      // sem GC_TESTE nem GC_DADOS (como no ar): só https, e nada de endereço da rede de dentro da hospedagem
      const r = await php(
        `$s = static function (string $h): string { try { return (string) gc_ip_do_envio($h); } catch (RuntimeException $e) { return 'recusado: ' . $e->getMessage(); } };
         echo json_encode(['local' => $s('127.0.0.1'), 'interno' => $s('10.1.2.3'), 'v6' => $s('[::1]'), 'nome' => $s('localhost'), 'publico' => $s('8.8.8.8'),
           'http' => gc_url_envio('http://n8n.exemplo.com/x', true), 'https' => gc_url_envio('https://n8n.exemplo.com/x?a=1', true),
           'senha' => gc_url_envio('https://a:b@n8n.exemplo.com/x', true), 'ancora' => gc_url_envio('https://n8n.exemplo.com/x#y', true), 'evoBusca' => gc_url_envio('https://evo.exemplo.com/?a=1', false)]);`,
        { GC_TESTE: '', GC_DADOS: '' },
      )
      igual([r.local, r.interno, r.v6, r.nome], ['recusado: endereço interno', 'recusado: endereço interno', 'recusado: endereço interno', 'recusado: endereço interno'], 'loopback, rede interna, IPv6 local e nome que aponta pra dentro: recusados')
      igual(r.publico, '8.8.8.8', 'IP público passa (e a conexão fica presa nele)')
      igual([r.http, r.https, r.senha, r.ancora, r.evoBusca], [null, 'https://n8n.exemplo.com/x?a=1', null, null, null], 'só https, sem usuário/senha nem âncora; a Evolution sem parâmetros')
    }

    parte('avisos: segredos e limites')
    {
      const banco = readFileSync(join(dA, 'loja.sqlite'))
      ok(banco.length > 0, 'o banco guarda os ajustes (no privado, fechado pela web)')
      for (const r of [await loja.get('admin-avisos'), await loja.get('admin-pedidos-resumo'), await loja.get('admin-sessao')]) nadaVaza(r.texto, `GET ${r.json ? 'painel' : '?'}`)
      erro(await new Cli(bA, '198.18.9.99').get('admin-avisos'), 401, 'sem-sessao', 'avisos sem sessão')
      erro(await new Cli(bA, '198.18.9.98').post('admin-avisos-salvar', { motor: 'zapi' }), 401, 'sem-sessao', 'salvar avisos sem sessão')
      await loja.post('admin-avisos-salvar', { motor: 'zapi' })
      let ultimo
      for (let i = 0; i < 25; i++) {
        ultimo = await loja.post('admin-avisos-testar', {})
        if (ultimo.status === 429) break
      }
      erro(ultimo, 429, 'muitas-tentativas', 'teste: no máximo 20 em 10 min')
    }
  } finally {
    derrubar(filho)
    falso.srv.close()
  }
}
