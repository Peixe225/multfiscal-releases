// Testes das contas no servidor (chamados pelo scripts/testar-api.mjs, num php -S próprio com o Z-API falso):
// - equipe: o mapa rota → permissão cobre toda rota admin-*; papéis dono/gerente/atendente em TODAS as rotas do mapa
//   (403 sem-permissao no que o papel não pode); senha provisória com troca obrigatória; só os estados de cada um
//   (pedidos, rateios, participantes, resumo); desativar, redefinir a senha, sempre um dono; quem fez o quê;
// - clientes: o código pelo WhatsApp (formato, limites por número e por IP, 1 por minuto, expiração em 10 min, 5
//   tentativas, sem revelar se o número tem conta), criar e entrar, a sessão gc_cliente (cookie, 90 dias), atualizar
//   (promoções com data, trocar o WhatsApp com código), endereços, pedidos e vagas da conta, exportar, sair, apagar;
// - a conta do aparelho migrando no primeiro login (nome, cupons que valem, prêmio reservado, dias de giro);
// - Teste minha sorte no servidor: giro sem conta (reserva do aparelho), com conta (cupom com código), 1 por dia por
//   conta/WhatsApp/aparelho, prêmios do estado, álcool nunca, usar cupom, limite por IP;
// - o painel Clientes (lista, busca, promoções, CSV, apagar, ligar/desligar o código, baixa de cupom).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { encomendaValida, esperar, gatewayFalso, novoToken, pedidoValido } from './testar-api-pedidos.mjs'

/** Cliente HTTP com os dois cookies (painel e conta do site), o csrf do painel e o relógio de teste. */
class Cli {
  constructor(base, ip) {
    this.base = base
    this.ip = ip
    this.painel = null
    this.cliente = null
    this.csrf = null
  }
  async req(rota, { metodo = 'GET', corpo, cab = {}, origem = this.base, query = '', agora, csrf } = {}) {
    const headers = { 'X-GC-IP': this.ip, ...cab }
    if (origem) headers.Origin = origem
    const cookies = [this.painel && `gc_painel=${this.painel}`, this.cliente && `gc_cliente=${this.cliente}`].filter(Boolean)
    if (cookies.length) headers.Cookie = cookies.join('; ')
    const token = csrf === undefined ? this.csrf : csrf
    if (token && metodo === 'POST') headers['X-CSRF'] = token
    if (agora) headers['X-GC-Agora'] = String(agora)
    let body
    if (corpo !== undefined) {
      body = typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
      headers['Content-Type'] ??= 'application/json'
    }
    const r = await fetch(`${this.base}/api/index.php?r=${rota}${query}`, { method: metodo, headers, body, redirect: 'manual' })
    const setados = r.headers.getSetCookie()
    for (const c of setados) {
      const a = /^gc_painel=([^;]*)/.exec(c)
      if (a) this.painel = a[1] || null
      const b = /^gc_cliente=([^;]*)/.exec(c)
      if (b) this.cliente = b[1] && b[1] !== 'deleted' ? b[1] : null
    }
    // os bytes como vieram (o r.text() tira o BOM do começo, e o CSV tem que ter)
    const texto = Buffer.from(await r.arrayBuffer()).toString('utf8')
    let json = null
    try {
      json = JSON.parse(texto)
    } catch {
      /* arquivo */
    }
    if (json?.csrf) this.csrf = json.csrf
    return { status: r.status, json, texto, headers: r.headers, cookies: setados }
  }
  get(rota, opts = {}) {
    return this.req(rota, opts)
  }
  post(rota, corpo, opts = {}) {
    return this.req(rota, { metodo: 'POST', corpo, ...opts })
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const chaves = (o) => Object.keys(o ?? {}).sort()
const SEM_PERMISSAO = (r) => r.status === 403 && r.json?.erro === 'sem-permissao'

export async function testarContas(t) {
  const { parte, ok, igual, erro, raiz, tmp, PHP, subirPhp, portaLivre, derrubar, portaPrincipal } = t
  const falso = await gatewayFalso()
  const porta = process.env.GC_TESTE_PORTA ? portaPrincipal + 7 : await portaLivre()
  const dados = join(tmp, 'contas')
  const filho = await subirPhp(porta, { GC_TESTE: '1', GC_DADOS: dados, GC_UPLOADS: join(dados, 'up'), GC_ZAPI_BASE: `http://127.0.0.1:${falso.porta}/zapi` }, [
    '-t', join(raiz, 'public'), join(raiz, 'scripts', 'api-dev.php'),
  ])
  const base = `http://127.0.0.1:${porta}`
  let ipN = 0
  const novo = () => new Cli(base, `198.19.${Math.floor(ipN / 200)}.${(ipN++ % 200) + 1}`)
  const AGORA = Math.floor(Date.now() / 1000)
  let numero = 0
  const whats = () => `(31) 9${String(70000000 + numero++).padStart(8, '0')}`
  const guardado = (w) => `55${w.replace(/\D/g, '')}`
  /** O último código que o gateway falso recebeu pra esse número (o *482913* da mensagem). */
  const ultimoCodigo = (w) => {
    const q = [...falso.recebidos].reverse().find((x) => JSON.parse(x.corpo || '{}').phone === guardado(w))
    return /\*(\d{6})\*/.exec(JSON.parse(q?.corpo ?? '{}').message ?? '')?.[1] ?? null
  }

  try {
    const dono = novo()
    await dono.post('admin-instalar', { codigo: 'dev-instalar-greencheese', login: 'dono', nome: 'Dono da Loja', senha: 'senha-forte-123' })

    // ─── equipe ─────────────────────────────────────────────────────────────────────────────────────────────────
    parte('equipe: o mapa de permissões')
    const indice = readFileSync(join(raiz, 'public/api/index.php'), 'utf8')
    const equipe = readFileSync(join(raiz, 'public/api/nucleo/equipe.php'), 'utf8')
    const rotas = [...indice.matchAll(/'(admin-[a-z-]+)' => \['(GET|POST)'/g)].map((m) => ({ rota: m[1], metodo: m[2] }))
    const mapa = Object.fromEntries([...(/const GC_PERMISSAO_ROTA = \[([\s\S]*?)\];/.exec(equipe)?.[1] ?? '').matchAll(/'(admin-[a-z-]+)' => '([a-z-]+)'/g)].map((m) => [m[1], m[2]]))
    const abertas = ['admin-sessao', 'admin-instalar', 'admin-entrar', 'admin-recuperar']
    const semMapa = rotas.filter((r) => !abertas.includes(r.rota) && !mapa[r.rota]).map((r) => r.rota)
    igual(semMapa, [], 'toda rota admin-* do index.php está no mapa (rota nova: põe no GC_PERMISSAO_ROTA)')
    igual(Object.keys(mapa).filter((r) => !rotas.some((x) => x.rota === r)), [], 'nada no mapa que não existe no index.php')
    const todas = [...(/const GC_PERMISSOES = \[([\s\S]*?)\];/.exec(equipe)?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
    igual([...new Set(Object.values(mapa))].filter((p) => !todas.includes(p)), [], 'toda permissão do mapa existe na lista')
    ok(rotas.length >= 40, `achou as rotas do painel (${rotas.length})`)
    // rota que ainda não está no mapa (a de outra frente, antes da integração): só o dono passa
    const modulos = ['base', 'banco', 'validar', 'limite', 'sessao', 'equipe'].map((m) => `require '${raiz}public/api/nucleo/${m}.php';`).join(' ')
    const fora = execFileSync(PHP, ['-r', `define('GC_API', '1'); ${modulos}
      $r = [];
      foreach (['dono', 'gerente', 'atendente'] as $papel) {
        $_GET['r'] = 'admin-rota-da-loja-nova';
        gc_usuario_atual(['id' => 1, 'login' => 'x', 'nome' => 'X', 'papel' => $papel, 'ufs' => ['mg'], 'trocarSenha' => false]);
        try { gc_conferir_permissao(); $r[$papel] = 'passa'; } catch (ErroApi $e) { $r[$papel] = $e->codigo; }
      }
      echo json_encode($r);`], { encoding: 'utf8', env: { ...process.env, GC_DADOS: join(tmp, 'contas-cli') } })
    igual(JSON.parse(fora), { dono: 'passa', gerente: 'sem-permissao', atendente: 'sem-permissao' }, 'rota fora do mapa: só o dono passa')

    parte('equipe: criar os acessos')
    let senhaGerente
    let senhaAtendente
    {
      const s = await dono.get('admin-sessao')
      igual([s.json.usuario.papel, s.json.usuario.ufs, s.json.usuario.trocarSenha, s.json.usuario.permissoes.includes('equipe')], ['dono', [], false, true], 'o dono: todos os estados e todas as permissões')
      erro(await dono.post('admin-usuario-salvar', { novo: true, login: 'gerente.mg', nome: 'Gerente MG', papel: 'gerente', ufs: [] }), 400, 'invalido', 'gerente sem estado')
      erro(await dono.post('admin-usuario-salvar', { novo: true, login: 'gerente.mg', nome: 'Gerente MG', papel: 'chefe', ufs: ['mg'] }), 400, 'invalido', 'papel que não existe')
      erro(await dono.post('admin-usuario-salvar', { novo: true, login: 'gerente.mg', nome: 'Gerente MG', papel: 'gerente', ufs: ['xx'] }), 400, 'invalido', 'estado que não existe')
      erro(await dono.post('admin-usuario-salvar', { novo: true, login: 'G', nome: 'Gerente MG', papel: 'gerente', ufs: ['mg'] }), 400, 'invalido', 'login curto')
      const g = await dono.post('admin-usuario-salvar', { novo: true, login: 'Gerente.MG', nome: 'Gerente MG', papel: 'gerente', ufs: ['mg', 'mg'] })
      igual(g.status, 201, 'criou o gerente')
      senhaGerente = g.json?.senhaProvisoria
      ok(/^[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}$/.test(senhaGerente ?? ''), `senha provisória legível, sem letra que confunde (${senhaGerente})`)
      igual([g.json?.usuario?.login, g.json?.usuario?.papel, g.json?.usuario?.ufs, g.json?.usuario?.trocarSenha, g.json?.usuario?.ativo, g.json?.usuario?.criadoPor], ['gerente.mg', 'gerente', ['mg'], true, true, 'dono'], 'gerente de MG, troca a senha no primeiro acesso')
      erro(await dono.post('admin-usuario-salvar', { novo: true, login: 'gerente.mg', nome: 'Outro', papel: 'gerente', ufs: ['mg'] }), 400, 'invalido', 'login repetido')
      const a = await dono.post('admin-usuario-salvar', { novo: true, login: 'atende.rj', nome: 'Atendente RJ', papel: 'atendente', ufs: ['rj'] })
      igual(a.status, 201, 'criou a atendente')
      senhaAtendente = a.json?.senhaProvisoria
      const banco = readFileSync(join(dados, 'loja.sqlite')).toString('latin1') + (existsSync(join(dados, 'loja.sqlite-wal')) ? readFileSync(join(dados, 'loja.sqlite-wal')).toString('latin1') : '')
      ok(!banco.includes(senhaGerente) && !banco.includes(senhaAtendente), 'a senha provisória não fica no banco (só o hash)')
      const l = await dono.get('admin-usuarios')
      igual(l.json?.usuarios?.map((u) => `${u.login}:${u.papel}`), ['dono:dono', 'gerente.mg:gerente', 'atende.rj:atendente'], 'a lista: o dono, depois gerente e atendente')
      igual(chaves(l.json?.usuarios?.[0]), ['acessoEm', 'ativo', 'criadoEm', 'criadoPor', 'desativadoEm', 'eu', 'login', 'nome', 'papel', 'senhaEm', 'sessoes', 'trocarSenha', 'ufs'], 'UsuarioAdmin com as chaves do contrato')
      igual([l.json.usuarios[0].eu, l.json.usuarios[1].eu], [true, false], 'marca quem é o próprio dono')
    }

    parte('equipe: senha provisória')
    const gerente = novo()
    const atendente = novo()
    {
      const e = await gerente.post('admin-entrar', { login: 'gerente.mg', senha: senhaGerente })
      igual([e.status, e.json?.usuario?.trocarSenha, e.json?.usuario?.papel, e.json?.usuario?.ufs], [200, true, 'gerente', ['mg']], 'entra com a provisória e o servidor pede a troca')
      igual(e.json?.usuario?.permissoes, ['conta', 'resumo', 'atividade', 'pedidos', 'pedidos-dados', 'rateios-ver', 'rateios', 'participantes', 'participantes-dados', 'imagens', 'produtos'], 'permissões do gerente')
      erro(await gerente.get('admin-resumo'), 403, 'trocar-senha', 'antes de trocar: nada além de trocar a senha')
      erro(await gerente.get('admin-pedidos'), 403, 'trocar-senha', 'nem os pedidos')
      igual((await gerente.get('admin-sessao')).json?.usuario?.trocarSenha, true, 'a sessão diz que falta trocar')
      erro(await gerente.post('admin-senha', { atual: senhaGerente, nova: 'curta' }), 400, 'invalido', 'senha nova curta')
      const t2 = await gerente.post('admin-senha', { atual: senhaGerente, nova: 'senha-do-gerente-1' })
      igual([t2.status, t2.json?.usuario?.trocarSenha], [200, false], 'trocou: a resposta já vem sem a troca pendente')
      igual((await gerente.get('admin-resumo')).status, 200, 'agora entra no painel')
      await atendente.post('admin-entrar', { login: 'atende.rj', senha: senhaAtendente })
      await atendente.post('admin-senha', { atual: senhaAtendente, nova: 'senha-da-atendente-1' })
      igual((await atendente.get('admin-sessao')).json?.usuario?.permissoes, ['conta', 'resumo', 'atividade', 'pedidos', 'rateios-ver', 'participantes'], 'permissões da atendente')
      const ev = (await dono.get('admin-eventos')).json.eventos
      ok(ev.some((x) => x.acao === 'senha-provisoria-trocada' && x.usuario === 'gerente.mg' && x.texto === 'Trocou a senha provisória'), 'a troca da provisória na Atividade')
      ok(ev.some((x) => x.acao === 'usuario-criado' && x.texto === 'Criou o acesso de Gerente MG (@gerente.mg), gerente de MG'), 'criar acesso na Atividade, com o papel e o estado')
    }

    parte('equipe: cada papel em cada rota')
    {
      const pode = {
        gerente: new Set((await gerente.get('admin-sessao')).json.usuario.permissoes),
        atendente: new Set((await atendente.get('admin-sessao')).json.usuario.permissoes),
      }
      const porPapel = { gerente, atendente }
      for (const { rota, metodo } of rotas) {
        if (abertas.includes(rota) || rota === 'admin-sair' || rota === 'admin-senha') continue
        for (const papel of ['gerente', 'atendente']) {
          const cli = porPapel[papel]
          const r = metodo === 'GET' ? await cli.get(rota) : await cli.post(rota, {})
          const deve = pode[papel].has(mapa[rota])
          ok(deve ? !SEM_PERMISSAO(r) : SEM_PERMISSAO(r), `${papel} em ${rota}: ${deve ? 'passa da permissão' : '403 sem-permissao'} (veio ${r.status} ${r.json?.erro ?? ''})`)
        }
      }
      ok(pode.atendente.has('pedidos') && !pode.atendente.has('rateios') && !pode.gerente.has('equipe') && !pode.gerente.has('avisos') && !pode.gerente.has('clientes'), 'gerente sem equipe/avisos/clientes; atendente sem mexer em rateio')
    }

    parte('equipe: só os estados de cada um (pedidos)')
    const site = () => novo()
    {
      const mg = await site().post('pedido', pedidoValido())
      const rj = await site().post('pedido', encomendaValida())
      igual([mg.status, rj.status], [201, 201], 'um pedido de MG e uma encomenda do RJ')
      const lista = (await dono.get('admin-pedidos')).json
      const idMg = lista.pedidos.find((p) => p.uf === 'mg').id
      const idRj = lista.pedidos.find((p) => p.uf === 'rj').id
      const lg = (await gerente.get('admin-pedidos')).json
      igual([lg.pedidos.map((p) => p.uf), lg.contagem.todos, lg.ufs], [['mg'], 1, ['mg']], 'gerente de MG: só MG na lista, na contagem e nos filtros')
      igual((await gerente.get('admin-pedidos', { query: '&uf=rj' })).json?.pedidos, [], 'pedir RJ no filtro não fura')
      const la = (await atendente.get('admin-pedidos')).json
      igual(la.pedidos.map((p) => p.uf), ['rj'], 'atendente do RJ: só RJ')
      const x = await gerente.get('admin-pedido', { query: `&id=${idRj}` })
      erro(x, 403, 'sem-permissao', 'gerente de MG abrindo pedido do RJ')
      igual(x.json?.motivo, 'estado', 'o motivo é o estado')
      erro(await gerente.post('admin-pedido-status', { id: idRj, status: 'confirmado' }), 403, 'sem-permissao', 'nem muda o status')
      erro(await atendente.post('admin-pedido-salvar', { id: idMg, nota: 'oi' }), 403, 'sem-permissao', 'atendente do RJ anotando pedido de MG')
      igual((await gerente.post('admin-pedido-status', { id: idMg, status: 'confirmado' })).status, 200, 'gerente confirma pedido de MG')
      const d = await gerente.get('admin-pedido', { query: `&id=${idMg}` })
      igual([d.status, d.json?.avisos], [200, []], 'detalhe sem o histórico dos avisos (é do dono)')
      const rs = (await atendente.get('admin-pedidos-resumo')).json
      igual([rs.novos, rs.avisos], [1, null], 'resumo dos pedidos da atendente: só os do RJ, sem os avisos no WhatsApp')
      ok((await dono.get('admin-pedidos-resumo')).json?.avisos?.motor === 'nenhum', 'o dono vê a situação dos avisos')
      erro(await atendente.post('admin-pedido-apagar-dados', { id: idRj }), 403, 'sem-permissao', 'atendente não apaga dados (LGPD é do dono e do gerente)')
    }

    parte('equipe: só os estados de cada um (rateios e participantes)')
    {
      const criar = async (titulo, ufs) => (await dono.post('admin-rateio-salvar', { titulo, precoRateio: 10, vagas: 10, ufs, status: 'aberto', limitePorPessoa: 2 })).json.rateio
      const soMg = await criar('Rateio só de MG', ['mg'])
      const soRj = await criar('Rateio só do RJ', ['rj'])
      const os2 = await criar('Rateio de MG e RJ', ['mg', 'rj'])
      const ids = (cli) => cli.get('admin-rateios').then((r) => r.json.rateios.map((x) => x.id).filter((id) => [soMg.id, soRj.id, os2.id].includes(id)).sort())
      igual(await ids(gerente), [os2.id, soMg.id].sort(), 'gerente de MG vê os rateios que valem em MG')
      igual(await ids(atendente), [os2.id, soRj.id].sort(), 'atendente do RJ vê os que valem no RJ')
      erro(await gerente.get('admin-rateio', { query: `&id=${soRj.id}` }), 404, 'nao-encontrado', 'rateio de outro estado: não existe pra ele')
      erro(await gerente.post('admin-rateio-salvar', { id: os2.id, titulo: 'Mudou' }), 403, 'sem-permissao', 'gerente não edita rateio que vale em outro estado também')
      erro(await gerente.post('admin-rateio-status', { id: os2.id, status: 'fechado' }), 403, 'sem-permissao', 'nem fecha')
      igual((await gerente.post('admin-rateio-salvar', { id: soMg.id, titulo: 'Rateio só de MG (editado)' })).status, 200, 'edita o que é só de MG')
      erro(await gerente.post('admin-rateio-salvar', { id: soMg.id, ufs: ['mg', 'sp'] }), 403, 'sem-permissao', 'não leva o rateio pra outro estado')
      erro(await gerente.post('admin-rateio-salvar', { titulo: 'Novo do RJ', precoRateio: 5, vagas: 3, ufs: ['rj'] }), 403, 'sem-permissao', 'não cria em outro estado')
      igual((await gerente.post('admin-rateio-salvar', { titulo: 'Novo de MG', precoRateio: 5, vagas: 3, ufs: ['mg'] })).status, 201, 'cria em MG')
      erro(await atendente.post('admin-rateio-salvar', { id: soRj.id, titulo: 'X' }), 403, 'sem-permissao', 'atendente não mexe em rateio')
      // gente dos dois estados no rateio de MG e RJ
      const pMg = await site().post('rateio-entrar', { rateio: os2.id, nome: 'Fulano MG', whatsapp: whats(), uf: 'mg', quantidade: 1 })
      const pRj = await site().post('rateio-entrar', { rateio: os2.id, nome: 'Ciclana RJ', whatsapp: whats(), uf: 'rj', quantidade: 1 })
      igual([pMg.status, pRj.status], [201, 201], 'uma pessoa de MG e uma do RJ')
      const pa = (await atendente.get('admin-participantes', { query: `&rateio=${os2.id}` })).json
      igual(pa.participantes.map((p) => p.uf), ['rj'], 'a atendente do RJ vê só a gente do RJ')
      igual(pa.rateio.confirmadas + pa.rateio.reservadas, 2, 'o contador do rateio continua o de todo mundo')
      const todos = (await dono.get('admin-participantes', { query: `&rateio=${os2.id}` })).json.participantes
      const idMg = todos.find((p) => p.uf === 'mg').id
      const idRj = todos.find((p) => p.uf === 'rj').id
      erro(await atendente.post('admin-participante-status', { id: idMg, status: 'confirmado' }), 403, 'sem-permissao', 'atendente do RJ não confirma vaga de MG')
      igual((await atendente.post('admin-participante-status', { id: idRj, status: 'confirmado' })).status, 200, 'confirma a do RJ')
      erro(await atendente.post('admin-participante-salvar', { rateio: os2.id, nome: 'Outro MG', whatsapp: whats(), uf: 'mg' }), 400, 'invalido', 'atendente do RJ não inclui gente de MG')
      igual((await atendente.post('admin-participante-salvar', { rateio: os2.id, nome: 'Outra RJ', whatsapp: whats(), uf: 'rj' })).status, 201, 'inclui gente do RJ')
      erro(await atendente.post('admin-participante-salvar', { id: idRj, uf: 'mg' }), 400, 'invalido', 'nem passa alguém pro outro estado')
      const csv = await atendente.get('admin-participantes-csv', { query: `&rateio=${os2.id}` })
      ok(csv.texto.includes('Ciclana RJ') && !csv.texto.includes('Fulano MG'), 'a planilha da atendente: só o RJ')
      const r = (await gerente.get('admin-resumo')).json
      ok(r.ultimasEntradas.every((p) => p.uf === 'mg') && r.ultimasEntradas.length >= 1, 'resumo do gerente: só as entradas de MG')
      const rd = (await dono.get('admin-resumo')).json
      ok(rd.ultimasEntradas.some((p) => p.uf === 'rj') && rd.ultimasEntradas.some((p) => p.uf === 'mg'), 'o dono vê todo mundo')
    }

    parte('equipe: quem fez o quê')
    {
      const ea = (await atendente.get('admin-eventos')).json.eventos
      ok(ea.length > 0 && ea.every((e) => e.usuario === 'atende.rj'), 'a atendente vê só o que ela fez')
      const eg = (await dono.get('admin-eventos', { query: '&usuario=gerente.mg' })).json.eventos
      ok(eg.length > 0 && eg.every((e) => e.usuario === 'gerente.mg'), 'o dono filtra pelo login')
      ok(eg.some((e) => e.acao === 'pedido-status'), 'o passo do pedido que o gerente deu está lá')
    }

    parte('equipe: editar, redefinir, desativar')
    const atendente2 = novo()
    {
      erro(await dono.post('admin-usuario-salvar', { login: 'dono', nome: 'Dono', papel: 'gerente', ufs: ['mg'] }), 400, 'invalido', 'o dono não tira o próprio papel')
      erro(await dono.post('admin-usuario-status', { login: 'dono', ativo: false }), 400, 'invalido', 'nem se desativa')
      erro(await dono.post('admin-usuario-senha', { login: 'dono' }), 400, 'invalido', 'a própria senha é em Conta')
      const e = await dono.post('admin-usuario-salvar', { login: 'atende.rj', nome: 'Atendente RJ e ES', papel: 'atendente', ufs: ['rj', 'es'] })
      igual([e.status, e.json?.usuario?.ufs], [200, ['es', 'rj']], 'mudou os estados da atendente')
      igual((await atendente.get('admin-sessao')).json?.usuario?.ufs, ['es', 'rj'], 'vale na hora, na sessão aberta')
      const rs = await dono.post('admin-usuario-senha', { login: 'gerente.mg' })
      ok(rs.status === 200 && /^[a-z2-9]{4}-/.test(rs.json?.senhaProvisoria ?? '') && rs.json?.usuario?.trocarSenha === true, 'senha provisória nova')
      erro(await gerente.get('admin-resumo'), 401, 'sem-sessao', 'as sessões do gerente caíram')
      const de = await dono.post('admin-usuario-status', { login: 'atende.rj', ativo: false })
      igual([de.status, de.json?.usuario?.ativo], [200, false], 'desativou a atendente')
      erro(await atendente.get('admin-resumo'), 401, 'sem-sessao', 'a sessão dela caiu na hora')
      erro(await novo().post('admin-entrar', { login: 'atende.rj', senha: 'errada-errada-1' }), 401, 'credenciais', 'senha errada de acesso desativado: a mesma mensagem de sempre')
      erro(await novo().post('admin-entrar', { login: 'atende.rj', senha: 'senha-da-atendente-1' }), 403, 'desativado', 'senha certa de acesso desativado: avisa')
      igual((await dono.post('admin-usuario-status', { login: 'atende.rj', ativo: false })).json?.jaEstava, true, 'desativar de novo: já estava')
      igual((await dono.post('admin-usuario-status', { login: 'atende.rj', ativo: true })).json?.usuario?.ativo, true, 'reativou')
      igual((await atendente2.post('admin-entrar', { login: 'atende.rj', senha: 'senha-da-atendente-1' })).status, 200, 'entra de novo')
      // um segundo dono: aí o primeiro pode deixar de ser dono, e sempre sobra um
      const d2 = await dono.post('admin-usuario-salvar', { novo: true, login: 'socio', nome: 'Sócio', papel: 'dono' })
      igual([d2.status, d2.json?.usuario?.ufs], [201, []], 'outro dono (sem estado: todos)')
      const socio = novo()
      await socio.post('admin-entrar', { login: 'socio', senha: d2.json.senhaProvisoria })
      await socio.post('admin-senha', { atual: d2.json.senhaProvisoria, nova: 'senha-do-socio-12' })
      igual((await socio.post('admin-usuario-status', { login: 'dono', ativo: false })).status, 200, 'o sócio desativa o primeiro dono')
      erro(await socio.post('admin-usuario-salvar', { login: 'socio', nome: 'Sócio', papel: 'gerente', ufs: ['mg'] }), 400, 'invalido', 'o dono que sobrou não deixa de ser dono')
      await socio.post('admin-usuario-status', { login: 'dono', ativo: true })
      igual((await dono.post('admin-entrar', { login: 'dono', senha: 'senha-forte-123' })).status, 200, 'o primeiro dono volta')
      const ev = (await dono.get('admin-eventos')).json.eventos
      ok(ev.some((x) => x.acao === 'usuario-desativado' && x.texto === 'Desativou o acesso de Atendente RJ e ES (@atende.rj)'), 'desativar na Atividade')
      ok(ev.some((x) => x.acao === 'entrar-desativado'), 'a tentativa com o acesso desativado também')
    }

    // ─── clientes ───────────────────────────────────────────────────────────────────────────────────────────────
    parte('clientes: sem motor de aviso')
    {
      igual((await novo().get('recursos')).json?.contas, { codigo: false, sessao: false }, 'sem motor: a conta fica no aparelho')
      erro(await novo().post('cliente-codigo', { whatsapp: whats() }), 409, 'sem-codigo', 'pedir código sem motor')
      await dono.post('admin-avisos-salvar', { motor: 'zapi', zapi: { instancia: '3C5A0B1D2E3F', token: 'TOKENZAPI0123456789' }, destino: { tipo: 'grupo', valor: '120363012345678901' } })
      igual((await novo().get('recursos')).json?.contas, { codigo: true, sessao: false }, 'com o Z-API: entrar por código ligado')
    }

    parte('clientes: o código pelo WhatsApp')
    const ana = novo()
    const zapAna = whats()
    {
      erro(await ana.post('cliente-codigo', { whatsapp: '123' }), 400, 'invalido', 'número que não fecha')
      erro(await ana.post('cliente-codigo', { whatsapp: zapAna, site: 'robo' }), 400, 'invalido', 'armadilha de robô')
      erro(await ana.post('cliente-codigo', { whatsapp: zapAna }, { origem: 'https://golpe.example' }), 403, 'origem', 'de outro site')
      falso.recebidos.length = 0
      const c = await ana.post('cliente-codigo', { whatsapp: zapAna })
      igual([c.status, c.json?.enviado, c.json?.para], [200, true, `(31) 9••••-${zapAna.slice(-4)}`], 'mandou (a tela mostra o número mascarado)')
      ok(ISO.test(c.json?.expiraEm) && Date.parse(c.json.expiraEm) - Date.parse(c.json.reenviarEm) === 540000, '10 min de validade, outro em 1 min')
      const q = JSON.parse(falso.recebidos[0]?.corpo ?? '{}')
      igual(q.phone, guardado(zapAna), 'Z-API: pro número do cliente (55 + DDD + 9 dígitos)')
      ok(/^\*\d{6}\* é teu código pra entrar na Green Cheese\. Vale por 10 minutos\.\n\nNão passa ele pra ninguém: a loja nunca pede esse código\.$/.test(q.message ?? ''), `a mensagem do código (${q.message})`)
      const codigo = ultimoCodigo(zapAna)
      const hist = (await dono.get('admin-avisos')).json.envios.find((x) => x.tipo === 'codigo-login')
      igual([hist?.texto, hist?.reenvia, hist?.status], [`Código de entrada pra (31) 9••••-${zapAna.slice(-4)}`, false, 'enviado'], 'no histórico do painel: só o número mascarado, sem reenvio')
      const banco = ['loja.sqlite', 'loja.sqlite-wal'].map((n) => join(dados, n)).filter((f) => existsSync(f)).map((f) => readFileSync(f).toString('latin1')).join('')
      ok(codigo && !banco.includes(codigo), 'o código não fica no banco (só o hash)')
      erro(await ana.post('cliente-codigo', { whatsapp: zapAna }), 429, 'muitas-tentativas', 'outro código pro mesmo número antes de 1 min')
      // sem revelar se o número tem conta: o mesmo pedido de código, com conta e sem conta, responde igual (até a forma)
      const semConta = await novo().post('cliente-codigo', { whatsapp: whats() })
      igual([semConta.status, chaves(semConta.json)], [c.status, chaves(c.json)], 'número sem conta: a mesma resposta')
    }

    parte('clientes: entrar e criar a conta')
    {
      const codigo = ultimoCodigo(zapAna)
      erro(await ana.post('cliente-entrar', { whatsapp: zapAna, codigo: '12345' }), 400, 'invalido', 'código com 5 números')
      const errado = codigo === '000000' ? '111111' : '000000'
      const e1 = await ana.post('cliente-entrar', { whatsapp: zapAna, codigo: errado })
      erro(e1, 403, 'codigo-errado', 'código errado')
      igual(e1.json?.restam, 4, 'restam 4 tentativas')
      const p = await ana.post('cliente-entrar', { whatsapp: zapAna, codigo: ` ${codigo.slice(0, 3)} ${codigo.slice(3)} ` })
      erro(p, 409, 'precisa-nome', 'código certo, sem conta e sem nome: pede o nome')
      igual(p.json?.campo, 'nome', 'o campo é o nome')
      ok(!ana.cliente, 'ainda sem sessão')
      const c = await ana.post('cliente-entrar', { whatsapp: zapAna, codigo, nome: '  Ana   Souza ', aceitaPromo: true })
      igual([c.status, c.json?.criada, c.json?.conta?.nome, c.json?.conta?.whatsapp, c.json?.conta?.aceitaPromo], [201, true, 'Ana Souza', guardado(zapAna), true], 'conta criada com o mesmo código (que continuou valendo)')
      ok(ISO.test(c.json?.conta?.aceitaPromoEm ?? '') && ISO.test(c.json?.conta?.confirmou18Em ?? ''), 'promoções e +18 gravados com a data')
      igual(chaves(c.json), ['conta', 'criada', 'cupomGuardado', 'cupons', 'dias', 'enderecos', 'migrados', 'ok', 'pendente'], 'resposta do entrar com as chaves do contrato')
      igual(chaves(c.json?.conta), ['aceitaPromo', 'aceitaPromoEm', 'confirmou18Em', 'criadaEm', 'id', 'nome', 'whatsapp'], 'ContaCliente com as chaves do contrato')
      const ck = c.cookies.find((x) => x.startsWith('gc_cliente=')) ?? ''
      ok(/gc_cliente=[0-9a-f]{64};/.test(ck) && /HttpOnly/i.test(ck) && /SameSite=Lax/i.test(ck) && /path=\/;/i.test(ck) && /Max-Age=7776000/i.test(ck) && !/Secure/i.test(ck), `cookie gc_cliente: HttpOnly, SameSite=Lax, 90 dias, sem Secure no http (${ck})`)
      erro(await ana.post('cliente-entrar', { whatsapp: zapAna, codigo }), 403, 'codigo-vencido', 'o código usado não vale de novo')
      igual((await ana.get('recursos')).json?.contas?.sessao, true, 'recursos diz que tem sessão')
      const eu = await ana.get('cliente-eu')
      igual([eu.status, eu.json?.conta?.nome, eu.json?.cupons, eu.json?.enderecos, eu.json?.dias], [200, 'Ana Souza', [], [], { sorte: [] }], 'cliente-eu')
      erro(await novo().get('cliente-eu'), 401, 'sem-sessao', 'sem cookie: sem sessão')
      // entrar de novo (outro aparelho): login, sem pedir nome
      const b = novo()
      await new Promise((r) => setTimeout(r, 10))
      const cod2 = await b.post('cliente-codigo', { whatsapp: zapAna }, { agora: AGORA + 120 })
      igual(cod2.status, 200, 'outro aparelho pede código (depois de 1 min)')
      const l2 = await b.post('cliente-entrar', { whatsapp: zapAna, codigo: ultimoCodigo(zapAna), nome: 'Outro Nome' }, { agora: AGORA + 130 })
      igual([l2.status, l2.json?.criada, l2.json?.conta?.nome], [200, false, 'Ana Souza'], 'conta que já existe: entra (o nome digitado não troca o da conta)')
      igual((await ana.get('cliente-eu')).status, 200, 'a sessão do primeiro aparelho continua')
    }

    parte('clientes: código vence, tentativas e limites')
    {
      const z = whats()
      const cli = novo()
      const T = Math.floor(Date.now() / 1000)
      await cli.post('cliente-codigo', { whatsapp: z }, { agora: T })
      const cod = ultimoCodigo(z)
      erro(await cli.post('cliente-entrar', { whatsapp: z, codigo: cod, nome: 'Fulano' }, { agora: T + 601 }), 403, 'codigo-vencido', 'depois de 10 min o código vence')
      const z2 = whats()
      await cli.post('cliente-codigo', { whatsapp: z2 })
      const certo = ultimoCodigo(z2)
      const errado = certo === '000000' ? '111111' : '000000'
      for (let i = 0; i < 4; i++) await cli.post('cliente-entrar', { whatsapp: z2, codigo: errado })
      erro(await cli.post('cliente-entrar', { whatsapp: z2, codigo: errado }), 403, 'codigo-vencido', '5º erro: o código para de valer')
      erro(await cli.post('cliente-entrar', { whatsapp: z2, codigo: certo, nome: 'Fulano' }), 403, 'codigo-vencido', 'nem o certo vale depois de 5 erros')
      // por número: 3 em 15 min (com 1 min entre eles)
      const z3 = whats()
      for (let i = 0; i < 3; i++) igual((await novo().post('cliente-codigo', { whatsapp: z3 }, { agora: AGORA + i * 61 })).status, 200, `código ${i + 1} pro mesmo número`)
      erro(await novo().post('cliente-codigo', { whatsapp: z3 }, { agora: AGORA + 3 * 61 }), 429, 'muitas-tentativas', '4º código pro mesmo número em 15 min')
      // o novo código desliga o de antes
      const z4 = whats()
      const c4 = novo()
      await c4.post('cliente-codigo', { whatsapp: z4 }, { agora: AGORA })
      const velho = ultimoCodigo(z4)
      await c4.post('cliente-codigo', { whatsapp: z4 }, { agora: AGORA + 61 })
      const atual = ultimoCodigo(z4)
      if (velho !== atual) erro(await c4.post('cliente-entrar', { whatsapp: z4, codigo: velho, nome: 'Fulano' }, { agora: AGORA + 62 }), 403, 'codigo-errado', 'o código de antes não vale mais')
      igual((await c4.post('cliente-entrar', { whatsapp: z4, codigo: atual, nome: 'Fulano Quatro' }, { agora: AGORA + 63 })).status, 201, 'o mais novo vale')
      // por IP: 10 por hora
      const mesmoIp = novo()
      let ultimo
      for (let i = 0; i < 11; i++) ultimo = await mesmoIp.post('cliente-codigo', { whatsapp: whats() })
      erro(ultimo, 429, 'muitas-tentativas', '11º código do mesmo IP em 1 hora')
      ok(ultimo.json?.esperaSegundos > 0 && ultimo.headers.get('retry-after'), 'com esperaSegundos e Retry-After')
      // gateway fora: o código não vale e a tela diz que não deu
      falso.estado.modo = '500'
      const z5 = whats()
      const f = await novo().post('cliente-codigo', { whatsapp: z5 })
      falso.estado.modo = 'ok'
      erro(f, 503, 'sem-envio', 'gateway fora: não deu pra mandar')
      const cod5 = ultimoCodigo(z5)
      erro(await novo().post('cliente-entrar', { whatsapp: z5, codigo: cod5 ?? '123456', nome: 'Fulano' }), 403, 'codigo-vencido', 'o código que não saiu não vale')
    }

    parte('clientes: atualizar, promoções e trocar o WhatsApp')
    {
      const a = await ana.post('cliente-atualizar', { nome: 'Ana S.', aceitaPromo: false })
      igual([a.status, a.json?.conta?.nome, a.json?.conta?.aceitaPromo, a.json?.conta?.aceitaPromoEm], [200, 'Ana S.', false, null], 'desligou as promoções (a data sai)')
      const b = await ana.post('cliente-atualizar', { aceitaPromo: true })
      ok(b.json?.conta?.aceitaPromo === true && ISO.test(b.json?.conta?.aceitaPromoEm ?? ''), 'ligou de novo: data nova')
      erro(await ana.post('cliente-atualizar', { nome: 'A' }), 400, 'invalido', 'nome curto')
      erro(await ana.post('cliente-atualizar', { whatsapp: whats() }), 400, 'invalido', 'trocar o WhatsApp sem código')
      erro(await ana.post('cliente-codigo', { whatsapp: zapAna, motivo: 'trocar' }, { agora: AGORA + 400 }), 400, 'invalido', 'código de troca pro mesmo número')
      erro(await novo().post('cliente-codigo', { whatsapp: whats(), motivo: 'trocar' }), 401, 'sem-sessao', 'código de troca sem sessão')
      const novoZap = whats()
      falso.recebidos.length = 0
      igual((await ana.post('cliente-codigo', { whatsapp: novoZap, motivo: 'trocar' })).status, 200, 'código pro número novo')
      ok(/pra trocar o WhatsApp da tua conta/.test(JSON.parse(falso.recebidos[0]?.corpo ?? '{}').message ?? ''), 'a mensagem diz que é pra trocar')
      const t1 = await ana.post('cliente-atualizar', { whatsapp: novoZap, codigo: ultimoCodigo(novoZap) })
      igual([t1.status, t1.json?.conta?.whatsapp], [200, guardado(novoZap)], 'trocou o WhatsApp da conta')
      // o número de outra conta (a do Fulano Quatro): não dá
      const outra = await ana.post('cliente-codigo', { whatsapp: zapAna, motivo: 'trocar' }, { agora: AGORA + 500 })
      igual(outra.status, 200, 'código pro número de antes (agora sem conta)')
      igual((await ana.post('cliente-atualizar', { whatsapp: zapAna, codigo: ultimoCodigo(zapAna) }, { agora: AGORA + 501 })).status, 200, 'volta pro número de antes')
    }

    parte('clientes: endereços')
    {
      const e = await ana.post('cliente-endereco-salvar', { apelido: 'Casa', cep: '39800-000', rua: 'Rua Doutor Manoel Esteves', numero: '120, apto 201', bairro: 'Centro', cidade: 'Teófilo Otoni', uf: 'mg' })
      igual([e.status, e.json?.enderecos?.length, e.json?.enderecos?.[0]?.cep, e.json?.enderecos?.[0]?.apelido], [201, 1, '39800000', 'Casa'], 'guardou o endereço com CEP')
      igual(chaves(e.json?.enderecos?.[0]), ['apelido', 'bairro', 'cep', 'cidade', 'id', 'livre', 'numero', 'rua', 'uf', 'usadoEm'], 'Endereco com as chaves do contrato')
      erro(await ana.post('cliente-endereco-salvar', { cep: '123', rua: 'Rua X', numero: '1', uf: 'mg' }), 400, 'invalido', 'CEP com 3 números')
      erro(await ana.post('cliente-endereco-salvar', { cep: '39800000', rua: 'Rua X', numero: '', uf: 'mg' }), 400, 'invalido', 'sem número')
      erro(await ana.post('cliente-endereco-salvar', { livre: 'Rua', uf: 'mg' }), 400, 'invalido', 'endereço sem CEP curto demais')
      erro(await ana.post('cliente-endereco-salvar', { livre: 'Rua das Flores, 10, Centro', uf: 'zz' }), 400, 'invalido', 'estado inválido')
      const l = await ana.post('cliente-endereco-salvar', { livre: 'Rua das Flores, 10, Centro', uf: 'mg', cidade: 'Teófilo Otoni' })
      igual([l.status, l.json?.enderecos?.length], [201, 2], 'endereço sem CEP')
      const id = l.json.endereco
      igual((await ana.post('cliente-endereco-salvar', { id, apelido: 'Trabalho', livre: 'Rua das Flores, 10, Centro', uf: 'mg' })).json?.enderecos?.find((x) => x.id === id)?.apelido, 'Trabalho', 'editou o apelido')
      for (let i = 0; i < 3; i++) await ana.post('cliente-endereco-salvar', { livre: `Rua Teste ${i}, 1, Centro`, uf: 'mg' })
      erro(await ana.post('cliente-endereco-salvar', { livre: 'Rua Sexta, 6, Centro', uf: 'mg' }), 409, 'limite-enderecos', 'cabem 5')
      erro(await novo().post('cliente-endereco-apagar', { id }), 401, 'sem-sessao', 'apagar sem sessão')
      const ap = await ana.post('cliente-endereco-apagar', { id })
      igual([ap.status, ap.json?.enderecos?.length], [200, 4], 'apagou um')
      erro(await ana.post('cliente-endereco-apagar', { id }), 404, 'nao-encontrado', 'apagar de novo')
      for (const x of (await ana.get('cliente-eu')).json.enderecos.filter((x) => x.livre.startsWith('Rua Teste'))) await ana.post('cliente-endereco-apagar', { id: x.id })
    }

    parte('clientes: pedidos e vagas da conta')
    {
      const p = pedidoValido({ entrega: { endereco: 'Rua Nova, 55, Bela Vista', rua: 'Rua Nova', numero: '55', bairro: 'Bela Vista', cep: '39801-000', cidade: 'Teófilo Otoni', uf: 'mg' } })
      const r = await ana.post('pedido', p)
      igual(r.status, 201, 'pedido com a conta logada')
      const lista = (await ana.get('cliente-pedidos')).json
      igual(lista.pedidos.map((x) => x.codigo), [p.codigo], 'aparece em Meus pedidos')
      igual(chaves(lista.pedidos[0]), ['atualizadoEm', 'canceladoEm', 'cidade', 'codigo', 'confirmadoEm', 'criadoEm', 'entregueEm', 'resumo', 'saiuEm', 'status', 'subtotalTexto', 'tipo', 'uf', 'unidades'], 'PedidoDoCliente com as chaves do contrato (sem anotação da loja)')
      const id = (await dono.get('admin-pedidos', { query: `&busca=${p.codigo}` })).json.pedidos[0].id
      const det = (await dono.get('admin-pedido', { query: `&id=${id}` })).json.pedido
      igual(det.whatsapp, guardado(zapAna), 'o WhatsApp da conta foi junto (o aparelho mandou vazio)')
      igual((await ana.get('cliente-eu')).json.enderecos.some((x) => x.cep === '39801000' && x.numero === '55'), true, 'o endereço do pedido ficou guardado pra próxima')
      await dono.post('admin-pedido-status', { id, status: 'confirmado' })
      igual((await ana.get('cliente-pedidos')).json.pedidos[0].status, 'confirmado', 'o status que a loja deu aparece pro cliente')
      // um pedido de antes da conta, com o mesmo WhatsApp, também aparece
      const antes = pedidoValido({ whatsapp: zapAna })
      await novo().post('pedido', antes)
      igual((await ana.get('cliente-pedidos')).json.pedidos.map((x) => x.codigo), [antes.codigo, p.codigo], 'os pedidos do mesmo WhatsApp também')
      erro(await novo().get('cliente-pedidos'), 401, 'sem-sessao', 'sem sessão')
      const rat = (await dono.get('admin-rateios')).json.rateios.find((x) => x.status === 'aberto' && x.ufs.includes('mg'))
      await novo().post('rateio-entrar', { rateio: rat.id, nome: 'Ana', whatsapp: zapAna, uf: 'mg', quantidade: 1 })
      const v = (await ana.get('cliente-vagas')).json.vagas
      igual([v.length, v[0]?.rateio, v[0]?.status, v[0]?.token], [1, rat.id, 'reservado', ''], 'a vaga do WhatsApp da conta (sem o token de aparelho)')
      // LGPD do pedido no painel: sai dos Meus pedidos
      await dono.post('admin-pedido-status', { id, status: 'cancelado' })
      await dono.post('admin-pedido-apagar-dados', { id })
      igual((await ana.get('cliente-pedidos')).json.pedidos.map((x) => x.codigo), [antes.codigo], 'pedido com os dados apagados sai da conta')
    }

    parte('clientes: exportar os dados (LGPD)')
    {
      const x = await ana.get('cliente-exportar')
      igual([x.status, x.headers.get('content-type')], [200, 'application/json; charset=utf-8'], 'arquivo JSON')
      ok(/attachment; filename="greencheese-meus-dados-\d{4}-\d{2}-\d{2}\.json"/.test(x.headers.get('content-disposition') ?? ''), 'baixa com nome e data')
      const j = x.json
      igual([j?.conta?.nome, j?.pedidos?.length, j?.vagasEmRateios?.length, j?.enderecos?.length], ['Ana S.', 1, 1, 2], 'tem a conta, os pedidos, as vagas e os endereços')
      ok(j?.pedidos?.[0] && !('nota' in j.pedidos[0]) && !('statusPor' in j.pedidos[0]), 'sem a anotação interna da loja')
      erro(await novo().get('cliente-exportar'), 401, 'sem-sessao', 'sem sessão')
    }

    // ─── Teste minha sorte no servidor ──────────────────────────────────────────────────────────────────────────
    parte('sorte: prêmios (semente e álcool fora)')
    {
      const semente = JSON.parse(readFileSync(join(raiz, 'public/api/nucleo/premios-sorte.json'), 'utf8'))
      const cat = JSON.parse(readFileSync(join(raiz, 'src/dados/catalogo.json'), 'utf8'))
      const alcool = (id) => ['bebidas', 'destilados'].includes(cat.produtos.find((x) => x.id === id)?.categoria)
      ok(semente.premios.length >= 1 && semente.premios.every((p) => !(p.aplicaA.produtos ?? []).some(alcool) && !(p.aplicaA.categorias ?? []).some((c) => ['bebidas', 'destilados'].includes(c)) && !(p.tipo === 'brinde' && alcool(p.valor.produto))), 'nenhum prêmio em bebida ou destilado')
      try {
        execFileSync(process.execPath, [join(raiz, 'scripts/gerar-premios-sorte.mjs'), '--conferir'], { stdio: 'pipe' })
        ok(true, 'a semente está em dia com src/dados/sorte.ts')
      } catch (e) {
        ok(false, `semente velha: ${e.stderr}`)
      }
      const mods = ['base', 'banco', 'validar', 'limite', 'sessao', 'rateio', 'pedido-migracoes', 'pedido', 'avisos', 'textos', 'contas-migracoes', 'equipe', 'clientes', 'sorte'].map((m) => `require '${raiz}public/api/nucleo/${m}.php';`).join(' ')
      const ids = JSON.parse(execFileSync(PHP, ['-r', `define('GC_API', '1'); ${mods} echo json_encode(['rj' => array_column(gc_premios_do_giro('rj'), 'id'), 'todos' => array_column(gc_premios_do_giro(null), 'id'), 'ba' => array_column(gc_premios_do_giro('ba'), 'id')]);`], { encoding: 'utf8', env: { ...process.env, GC_DADOS: join(tmp, 'contas-cli') } }))
      const noRj = semente.premios.filter((p) => p.ufs.includes('rj')).map((p) => p.id)
      igual(ids.rj, noRj, 'no RJ, só os prêmios com produto disponível lá')
      ok(!ids.rj.includes('dichavador-10') && ids.todos.includes('dichavador-10'), 'o dichavador (fora do RJ) não sai pra quem é do RJ')
      igual(ids.ba, ids.todos, 'estado sem prêmio: todos os que valem (como o site)')
    }

    parte('sorte: giro sem conta (reserva do aparelho)')
    const aparelho = novoToken()
    const anonimo = novo()
    let premioReservado
    {
      erro(await anonimo.post('cliente-girar', { interativo: 'sorte', uf: 'mg' }), 400, 'invalido', 'sem o aparelho')
      erro(await anonimo.post('cliente-girar', { interativo: 'roleta', uf: 'mg', aparelho }), 400, 'invalido', 'interativo que não existe')
      const g0 = await anonimo.get('cliente-giro', { query: `&interativo=sorte&aparelho=${aparelho}` })
      igual([g0.json?.giro, g0.json?.pendente, g0.json?.dias], [{ disponivel: true }, null, []], 'aparelho novo: giro liberado')
      const g = await anonimo.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho })
      igual([g.status, g.json?.cupom], [200, null], 'girou sem conta: sem cupom (o código só nasce ao guardar)')
      premioReservado = g.json?.premioId
      const semente = JSON.parse(readFileSync(join(raiz, 'public/api/nucleo/premios-sorte.json'), 'utf8'))
      ok(semente.premios.some((p) => p.id === premioReservado && p.ufs.includes('mg')), `prêmio da semente que vale em MG (${premioReservado})`)
      ok(g.json?.pendente?.premioId === premioReservado && Date.parse(g.json.pendente.expiraEm) - Date.parse(g.json.pendente.sorteadoEm) === 86400000, 'reservado por 24 h')
      igual(g.json?.dias?.length, 1, 'o dia do giro')
      const g2 = await anonimo.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho })
      erro(g2, 409, 'sem-giro', 'segundo giro do mesmo aparelho sem conta')
      igual([g2.json?.giro?.motivo, g2.json?.giro?.girouHoje], ['sem-conta-ja-girou', true], 'motivo: o giro sem conta já foi')
      const g3 = await anonimo.get('cliente-giro', { query: `&interativo=sorte&aparelho=${aparelho}` })
      igual([g3.json?.giro?.disponivel, g3.json?.pendente?.premioId], [false, premioReservado], 'o GET mostra o prêmio reservado')
      erro(await anonimo.post('cliente-guardar', { interativo: 'sorte', aparelho }), 401, 'sem-sessao', 'guardar sem conta')
    }

    parte('sorte: entrar guarda o prêmio reservado; com conta, 1 por dia')
    {
      const z = whats()
      await anonimo.post('cliente-codigo', { whatsapp: z })
      const e = await anonimo.post('cliente-entrar', { whatsapp: z, codigo: ultimoCodigo(z), nome: 'Beto Giro', aparelho })
      igual([e.status, e.json?.cupomGuardado?.premioId], [201, premioReservado], 'criou a conta e o prêmio reservado virou cupom')
      ok(/^SORTE-[ABCDEFGHJKMNPQRTUVWXY346789]{4}$/.test(e.json?.cupomGuardado?.codigo ?? ''), `código no alfabeto do site (${e.json?.cupomGuardado?.codigo})`)
      igual(e.json?.cupons?.length, 1, 'o cupom já está na conta')
      igual((await anonimo.get('cliente-giro', { query: `&interativo=sorte&aparelho=${aparelho}` })).json?.pendente, null, 'a reserva foi consumida')
      const g = await anonimo.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho })
      erro(g, 409, 'sem-giro', 'girou sem conta hoje e criou a conta hoje: o giro de hoje já foi')
      igual(g.json?.giro?.motivo, 'ja-girou-hoje', 'motivo: já girou hoje')
      const amanha = AGORA + 86400
      const g2 = await anonimo.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho }, { agora: amanha })
      igual([g2.status, g2.json?.pendente], [200, null], 'no dia seguinte, com conta: gira')
      const k = g2.json?.cupom
      ok(/^SORTE-/.test(k?.codigo ?? '') && k?.premioId === g2.json?.premioId, 'com conta o cupom já nasce com código')
      const premio = JSON.parse(readFileSync(join(raiz, 'public/api/nucleo/premios-sorte.json'), 'utf8')).premios.find((p) => p.id === k.premioId)
      const fim = new Date(Date.parse(k.validoAte))
      const sp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(fim)
      igual(sp, '23:59:59', 'vale até 23:59:59 de Brasília')
      const dias = Math.round((Date.parse(k.validoAte) - Date.parse(k.ganhoEm)) / 86400000)
      ok(dias === premio.validadeDias || dias === premio.validadeDias + 1, `validade de ${premio.validadeDias} dias a partir do dia do giro (${dias})`)
      erro(await anonimo.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho }, { agora: amanha + 60 }), 409, 'sem-giro', '2º giro no mesmo dia com conta')
      // outra conta no mesmo aparelho, no mesmo dia: não gira
      const outra = novo()
      const z2 = whats()
      await outra.post('cliente-codigo', { whatsapp: z2 }, { agora: amanha })
      await outra.post('cliente-entrar', { whatsapp: z2, codigo: ultimoCodigo(z2), nome: 'Cida Giro' }, { agora: amanha })
      erro(await outra.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho }, { agora: amanha + 120 }), 409, 'sem-giro', 'outra conta no mesmo aparelho, no mesmo dia')
      igual((await outra.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho: novoToken() }, { agora: amanha + 120 })).status, 200, 'a outra conta, no aparelho dela, gira')
      // a mesma conta em outro aparelho, no mesmo dia: não gira (limite por conta e por WhatsApp)
      erro(await anonimo.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho: novoToken() }, { agora: amanha + 180 }), 409, 'sem-giro', 'a mesma conta em outro aparelho')
      // usar o cupom
      const u = await anonimo.post('cliente-cupom-usar', { codigo: k.codigo.toLowerCase() }, { agora: amanha + 200 })
      ok(u.status === 200 && ISO.test(u.json?.cupom?.usadoEm ?? ''), 'usou o cupom')
      erro(await anonimo.post('cliente-cupom-usar', { codigo: k.codigo }, { agora: amanha + 201 }), 409, 'ja-usado', 'usar de novo')
      erro(await outra.post('cliente-cupom-usar', { codigo: e.json.cupomGuardado.codigo }), 404, 'nao-encontrado', 'cupom de outra conta')
      erro(await anonimo.post('cliente-cupom-usar', { codigo: e.json.cupomGuardado.codigo }, { agora: AGORA + 40 * 86400 }), 409, 'vencido', 'cupom vencido')
      erro(await anonimo.post('cliente-guardar', { interativo: 'sorte', aparelho }), 409, 'sem-pendente', 'guardar sem prêmio reservado')
      // limite por IP (quem inventa aparelho novo a cada giro)
      const ip = novo()
      let ultimo
      for (let i = 0; i < 31; i++) ultimo = await ip.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho: novoToken() })
      erro(ultimo, 429, 'muitas-tentativas', '31º giro do mesmo IP no dia')
    }

    parte('clientes: a conta do aparelho vem junto no primeiro login')
    {
      const z = whats()
      const cli = novo()
      const ap = novoToken()
      await cli.post('cliente-codigo', { whatsapp: z })
      const agoraMs = Date.now()
      const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
      const migrar = {
        nome: 'Dani do Aparelho',
        aceitaPromo: true,
        aceitaPromoEm: agoraMs - 5 * 86400000,
        cupons: [
          { codigo: 'SORTE-AB34', interativo: 'sorte', premioId: 'ocb-4-por-3', ganhoEm: agoraMs - 86400000, validoAte: agoraMs + 3 * 86400000 },
          { codigo: 'SORTE-CD67', interativo: 'sorte', premioId: 'piteira-vidro-15', ganhoEm: agoraMs - 20 * 86400000, validoAte: agoraMs - 86400000 },
          { codigo: 'SORTE-EF89', interativo: 'sorte', premioId: 'premio-inventado', ganhoEm: agoraMs, validoAte: agoraMs + 86400000 },
          { codigo: 'SORTE-GH34', interativo: 'sorte', premioId: 'bandeja-10', ganhoEm: agoraMs, validoAte: agoraMs + 365 * 86400000 },
          { codigo: 'SORTE-JK34', interativo: 'sorte', premioId: 'bandeja-10', ganhoEm: agoraMs, validoAte: agoraMs + 86400000, usadoEm: agoraMs },
        ],
        pendente: { interativo: 'sorte', premioId: 'dichavador-10', sorteadoEm: agoraMs - 3600000, expiraEm: agoraMs + 20 * 3600000 },
        giros: { sorte: [hoje, '2020-01-01', 'lixo'] },
      }
      const e = await cli.post('cliente-entrar', { whatsapp: z, codigo: ultimoCodigo(z), aparelho: ap, migrar })
      igual([e.status, e.json?.criada, e.json?.conta?.nome, e.json?.conta?.aceitaPromo], [201, true, 'Dani do Aparelho', true], 'a conta nasceu com o nome do aparelho (sem pedir de novo)')
      ok(Math.abs(Date.parse(e.json.conta.aceitaPromoEm) - (agoraMs - 5 * 86400000)) < 2000, 'a data das promoções é a de quando ela marcou no aparelho')
      igual(e.json?.migrados, 3, 'entraram 3: o cupom que vale, o de validade longa (ajustada) e o prêmio reservado')
      const k = Object.fromEntries(e.json.cupons.map((x) => [x.premioId, x]))
      ok(k['ocb-4-por-3']?.codigo === 'SORTE-AB34', 'o código do aparelho fica quando está livre')
      ok(!k['piteira-vidro-15'] && !k['premio-inventado'], 'vencido e prêmio que não existe ficam de fora')
      const max = Date.now() + 8 * 86400000
      ok(k['bandeja-10'] && Date.parse(k['bandeja-10'].validoAte) <= max, 'validade além da do prêmio é cortada')
      ok(k['dichavador-10'] && k['dichavador-10'].origem === 'aparelho', 'o prêmio reservado no aparelho virou cupom')
      ok(e.json.cupons.every((x) => x.origem === 'aparelho'), 'marcados como vindos do aparelho')
      const g = await cli.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho: ap })
      erro(g, 409, 'sem-giro', 'o giro de hoje do aparelho veio junto: não gira de novo hoje')
      ok(e.json?.dias?.sorte?.includes(hoje) && !e.json.dias.sorte.includes('2020-01-01'), 'só os dias dos últimos 30 entram')
      // o mesmo código de cupom numa outra conta: ganha código novo
      const z2 = whats()
      const c2 = novo()
      await c2.post('cliente-codigo', { whatsapp: z2 })
      const e2 = await c2.post('cliente-entrar', { whatsapp: z2, codigo: ultimoCodigo(z2), migrar: { nome: 'Edu', cupons: [migrar.cupons[0]] } })
      ok(e2.json?.cupons?.[0]?.codigo && e2.json.cupons[0].codigo !== 'SORTE-AB34', 'código já usado por outra conta: troca')
    }

    parte('clientes: sair e apagar a conta')
    {
      const s = await ana.post('cliente-sair', {})
      igual(s.status, 200, 'saiu')
      ok(s.cookies.some((c) => /^gc_cliente=;/.test(c) || /gc_cliente=deleted/.test(c)), 'o cookie foi apagado')
      erro(await ana.get('cliente-eu'), 401, 'sem-sessao', 'sem sessão depois de sair')
      igual((await ana.post('cliente-sair', {})).status, 200, 'sair de novo também responde 200')
      // entra de novo e apaga
      await ana.post('cliente-codigo', { whatsapp: zapAna }, { agora: AGORA + 1200 })
      await ana.post('cliente-entrar', { whatsapp: zapAna, codigo: ultimoCodigo(zapAna) }, { agora: AGORA + 1201 })
      erro(await ana.post('cliente-apagar', {}), 400, 'invalido', 'apagar sem confirmar')
      const ap = await ana.post('cliente-apagar', { confirmar: true })
      igual(ap.status, 200, 'apagou a conta')
      erro(await ana.get('cliente-eu'), 401, 'sem-sessao', 'a sessão foi junto')
      const av = (await dono.get('admin-avisos')).json.envios.filter((x) => x.alvo === `conta:${guardado(zapAna)}`)
      igual(av, [], 'os registros dos códigos dela saíram do histórico')
      const pedidos = (await dono.get('admin-pedidos', { query: `&busca=${guardado(zapAna).slice(2)}` })).json.pedidos
      ok(pedidos.length >= 1, 'os pedidos ficam com a loja')
      // criar de novo pede o nome (a conta não existe mais)
      const novaAna = novo()
      await novaAna.post('cliente-codigo', { whatsapp: zapAna }, { agora: AGORA + 1300 })
      erro(await novaAna.post('cliente-entrar', { whatsapp: zapAna, codigo: ultimoCodigo(zapAna) }, { agora: AGORA + 1301 }), 409, 'precisa-nome', 'a conta apagada não existe mais')
      const ev = (await dono.get('admin-eventos')).json.eventos
      ok(ev.some((x) => x.acao === 'cliente-conta-apagada' && x.texto === 'Conta de cliente apagada (LGPD)') && !JSON.stringify(ev).includes('Ana S.'), 'na Atividade, sem o nome')
    }

    // ─── painel: Clientes ───────────────────────────────────────────────────────────────────────────────────────
    parte('painel: clientes')
    {
      const l = await dono.get('admin-clientes')
      igual(l.status, 200, 'lista')
      ok(l.json.total >= 5 && l.json.clientes.length === l.json.total, `todos os clientes (${l.json.total})`)
      igual(chaves(l.json.clientes[0]), ['aceitaPromo', 'aceitaPromoEm', 'acessoEm', 'criadoEm', 'cuponsAtivos', 'id', 'nome', 'origem', 'pedidos', 'uf', 'whatsapp'], 'ClienteLinha com as chaves do contrato')
      igual(l.json.codigo, { ligado: true, motor: true, desligadoPeloDono: false }, 'a situação do entrar com código')
      const b = await dono.get('admin-clientes', { query: '&busca=dani' })
      igual(b.json.clientes.map((c) => c.nome), ['Dani do Aparelho'], 'busca pelo nome, sem acento e sem caixa')
      const p = await dono.get('admin-clientes', { query: '&promo=1' })
      ok(p.json.clientes.length === p.json.comPromo && p.json.clientes.every((c) => c.aceitaPromo), 'só quem aceitou promoções')
      const dani = b.json.clientes[0]
      const d = await dono.get('admin-cliente', { query: `&id=${dani.id}` })
      igual([d.status, d.json?.cupons?.length, chaves(d.json)], [200, 3, ['agora', 'cliente', 'cupons', 'enderecos', 'giros', 'ok', 'pedidos', 'vagas']], 'detalhe com cupons, pedidos e vagas')
      const k = d.json.cupons[0].codigo
      const u = await dono.post('admin-cupom-usado', { codigo: k, usado: true })
      ok(u.status === 200 && ISO.test(u.json?.cupom?.usadoEm ?? ''), 'a loja deu baixa no cupom')
      igual((await dono.post('admin-cupom-usado', { codigo: k, usado: false })).json?.cupom?.usadoEm, null, 'e desfez')
      erro(await dono.post('admin-cupom-usado', { codigo: 'SORTE-XXXX', usado: true }), 404, 'nao-encontrado', 'cupom que não existe')
      const csv = await dono.get('admin-clientes-csv')
      igual(csv.headers.get('content-type'), 'text/csv; charset=utf-8', 'CSV')
      ok(csv.texto.startsWith('﻿Nome;WhatsApp;Estado;Aceitou promoções em;Conta criada em\r\n'), 'BOM e o cabeçalho')
      ok(csv.texto.includes('Dani do Aparelho') && !csv.texto.includes('Cida Giro'), 'só quem aceitou promoções')
      ok(/attachment; filename="clientes-promocoes-\d{4}-\d{2}-\d{2}\.csv"/.test(csv.headers.get('content-disposition') ?? ''), 'nome do arquivo com a data')
      const des = await dono.post('admin-clientes-ajustes', { codigo: false })
      igual(des.json?.codigo, { ligado: false, motor: true, desligadoPeloDono: true }, 'desligou o entrar com código')
      igual((await novo().get('recursos')).json?.contas?.codigo, false, 'o site volta pra conta no aparelho')
      erro(await novo().post('cliente-codigo', { whatsapp: whats() }), 409, 'sem-codigo', 'e o código não sai')
      await dono.post('admin-clientes-ajustes', { codigo: true })
      igual((await dono.post('admin-cliente-apagar', { id: dani.id })).status, 200, 'o dono apaga a conta (pedido de exclusão pela conversa)')
      erro(await dono.get('admin-cliente', { query: `&id=${dani.id}` }), 404, 'nao-encontrado', 'não existe mais')
      erro(await atendente2.get('admin-clientes'), 403, 'sem-permissao', 'clientes é só do dono')
    }
  } catch (e) {
    ok(false, `exceção nas contas: ${e.stack}`)
  } finally {
    derrubar(filho)
    falso.srv.close()
  }
  void esperar
}
