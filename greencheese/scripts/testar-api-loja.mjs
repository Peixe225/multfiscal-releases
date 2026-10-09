// Testes da loja no servidor. Rodam dentro do scripts/testar-api.mjs (o php -S, o dono e os ajudantes de lá chegam em
// `t`): a semente em dia com src/dados, as listas repetidas no PHP e no TS iguais, o GET loja (o formato do API.md,
// ETag/304, Cache-Control), cada rota do painel (sessão, Origin, CSRF, validação, auditoria), o estoque que tira e põe
// do site sozinho, o "restam X", o story filtrado, prêmio só em acessório, a migração num banco de antes da loja e o
// "apagar dados de exemplo".
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { conferirSemente, montarSemente } from './gerar-semente-loja.mjs'

/** JSON com as chaves em ordem (compara objeto sem depender da ordem das chaves). */
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v)

/** As strings entre aspas simples de um trecho de .ts (a lista que começa em `inicio`, até o `]`). */
function listaTs(arquivo, inicio, fim = ']') {
  const txt = readFileSync(arquivo, 'utf8')
  const i = txt.indexOf(inicio)
  if (i < 0) return null
  const trecho = txt.slice(i + inicio.length, txt.indexOf(fim, i + inicio.length))
  return [...trecho.matchAll(/'([^']*)'/g)].map((m) => m[1])
}

/** Antes da instalação: a loja ainda não existe no servidor (o site segue com o que tem embutido). */
export async function lojaAntesDeInstalar(t) {
  t.parte('loja antes de instalar')
  t.erro(await t.site().get('loja'), 404, 'sem-loja', 'GET loja antes da instalação')
  t.erro(await t.site().get('admin-loja'), 401, 'sem-sessao', 'admin-loja sem sessão')
  const p = await t.site().post('loja', {})
  t.erro(p, 405, 'metodo', 'POST no GET loja')
  t.igual(p.headers.get('allow'), 'GET', 'Allow: GET')
}

/** Sem servidor: a semente em dia e as listas que o PHP e o TS repetem. */
export async function lojaSemServidor(t) {
  const { ok, igual, parte, raiz, PHP } = t
  parte('loja: semente e listas repetidas')
  igual(await conferirSemente(), null, 'semente-loja.json em dia com src/dados')
  const cli = execFileSync('node', [join(raiz, 'scripts', 'gerar-semente-loja.mjs'), '--conferir'], { encoding: 'utf8' })
  igual(cli.trim(), 'semente em dia', 'gerar-semente-loja.mjs --conferir')
  const php = JSON.parse(
    execFileSync(PHP, ['-r', 'define("GC_API", 1); require $argv[1] . "/validar.php"; require $argv[1] . "/loja.php"; require $argv[1] . "/loja-validar.php"; echo json_encode([GC_LOJA_PALAVRAS, GC_LOJA_ALCOOL, GC_LOJA_ARTES, GC_LOJA_ICONES, GC_LOJA_NOMES_UF, GC_LOJA_STORIES_MAX, GC_LOJA_PAGAMENTOS, GC_LOJA_EMBLEMAS, GC_LOJA_ARTES_BEBIDA, GC_LOJA_PALAVRAS_LOJA, GC_TERMOS_PROIBIDOS, GC_TERMOS_PALAVRA_INTEIRA]);', join(raiz, 'public', 'api', 'nucleo')], { encoding: 'utf8' }),
  )
  const [palavras, alcool, artes, icones, nomesUf, storiesMax, pagamentos, emblemas, artesBebida, palavrasLoja, tabaco, tabacoInteira] = php
  igual(palavras, listaTs(join(raiz, 'src/dados/sorte.ts'), 'PALAVRAS_PROIBIDAS = ['), 'PALAVRAS_PROIBIDAS: a mesma lista no PHP e no site, na mesma ordem')
  igual(alcool, listaTs(join(raiz, 'src/lib/alcool.ts'), 'export const ALCOOL = ['), 'nomes de bebida alcoólica: a mesma lista no servidor, no site e no painel')
  ok(alcool.length > 90 && ['jack daniels', 'smirnoff', 'heineken', 'brahma', 'chope', 'saque', 'skol', 'campari'].every((x) => alcool.includes(x)), 'a lista de bebida alcoólica tem as marcas comuns (Jack Daniels, Smirnoff, Heineken, Brahma, Skol, Campari) e o chope e o saquê')
  igual(artesBebida, listaTs(join(raiz, 'src/lib/alcool.ts'), 'export const ARTES_DE_BEBIDA = ['), 'desenhos de bebida: os mesmos no servidor e no site')
  ok(artesBebida.every((a) => artes.includes(a)) && !artesBebida.includes('lata'), 'desenhos de bebida: formatos que existem, sem a lata (o desenho de todo produto novo)')
  igual(palavrasLoja, listaTs(join(raiz, 'src/painel/loja/validar.ts'), 'const PALAVRAS_LOJA = ['), 'a gíria e a promessa do produto e do estado: a mesma lista no servidor e no painel')
  ok(palavrasLoja.every((x) => palavras.includes(x)), 'a gíria e a promessa do produto e do estado saem da PALAVRAS_PROIBIDAS')
  igual(tabaco, listaTs(join(raiz, 'src/painel/proibidos.ts'), 'const TERMOS = ['), 'tabaco e vape: a mesma lista no servidor e no painel')
  igual(tabacoInteira, listaTs(join(raiz, 'src/painel/proibidos.ts'), 'const PALAVRA_INTEIRA = ['), 'tabaco e vape (palavra inteira): a mesma lista no servidor e no painel')
  igual(artes, listaTs(join(raiz, 'src/lib/tipos.ts'), 'export type TipoArte =', '\n\n'), 'formatos da arte: os do TipoArte do site')
  igual(artes, listaTs(join(raiz, 'src/painel/loja/nomes.ts'), 'export const ARTES', '\n]').filter((_, i) => i % 2 === 0), 'formatos da arte: os do painel')
  igual(icones, listaTs(join(raiz, 'src/painel/loja/nomes.ts'), 'export const ICONES', '\n]').filter((_, i) => i % 2 === 0), 'ícones de categoria: os do painel')
  igual(pagamentos, listaTs(join(raiz, 'src/painel/loja/nomes.ts'), 'export const PAGAMENTOS', '\n]').filter((_, i) => i % 2 === 0), 'formas de pagamento: as do painel')
  igual(Object.keys(nomesUf).sort(), (listaTs(join(raiz, 'public/api/nucleo/validar.php'), 'const GC_UFS = [') ?? []).sort(), 'os 27 nomes de UF batem com as UFs do servidor')
  igual(Object.keys(nomesUf).length, 27, '27 UFs com nome')
  // o story do Início do site sai da loja (src/store/loja.ts, MAX_STORY): as barrinhas do topo
  const maxSite = Number(/export const MAX_STORY = (\d+)/.exec(readFileSync(join(raiz, 'src/store/loja.ts'), 'utf8'))?.[1])
  const maxPainel = Number(/const MAX = (\d+)/.exec(readFileSync(join(raiz, 'src/painel/loja/Stories.tsx'), 'utf8'))?.[1])
  ok(storiesMax === maxSite && storiesMax === maxPainel, `até ${storiesMax} produtos no story: o MAX_STORY do site (${maxSite}) e o do painel (${maxPainel})`)
  // o site confere o que chega do servidor com as mesmas listas (src/store/loja-ler.ts): o que o painel aceita, o site mostra
  const lojaTs = join(raiz, 'src/store/loja-ler.ts')
  igual(listaTs(lojaTs, 'const TIPOS_ARTE = new Set<TipoArte>(['), artes, 'formatos da arte: os que o site aceita do servidor')
  igual(listaTs(lojaTs, 'const ICONES = new Set(['), icones, 'ícones de categoria: os que o site aceita do servidor')
  igual(listaTs(lojaTs, 'const PAGAMENTOS = new Set<FormaPagamento>(['), pagamentos, 'formas de pagamento: as que o site aceita do servidor')
  igual(listaTs(lojaTs, 'const EMBLEMAS = new Set<Emblema>(['), emblemas, 'emblemas: os que o site desenha (com o pino do genérico)')
  igual(listaTs(join(raiz, 'src/dados/canais.ts'), 'export type Emblema =', '\n'), emblemas, 'emblemas: o tipo Emblema do site')
  return { nomesUf }
}

/** A loja inteira: GET loja e as rotas do painel. */
export async function loja(t, { nomesUf }) {
  const { ok, igual, erro, parte, dono, site, Cliente, base, ISO, chaves } = t
  const mesmo = (a, b, msg) => igual(canon(a), canon(b), msg)
  const s = await montarSemente()
  const pub = async () => (await site().get('loja')).json
  const adm = async () => (await dono.get('admin-loja')).json.loja
  const versao = async () => (await pub()).versao
  const eventos = async () => (await dono.get('admin-eventos')).json.eventos
  const temEvento = async (acao, texto, msg) => {
    const ev = await eventos()
    ok(ev.some((e) => e.acao === acao && e.texto === texto && e.usuario === 'dono'), `${msg}: "${texto}" na Atividade (veio ${JSON.stringify(ev.filter((e) => e.acao === acao).slice(0, 3).map((e) => e.texto))})`)
  }
  const prodPub = (l, id) => l.loja.produtos.find((p) => p.id === id)

  // ─── o site ───────────────────────────────────────────────────────────────────────────────────────────────────
  parte('loja: GET loja (o que o site lê)')
  const r0 = await site().get('loja')
  igual(r0.status, 200, 'GET loja depois da instalação')
  igual(r0.headers.get('content-type'), 'application/json; charset=utf-8', 'JSON UTF-8')
  igual(r0.headers.get('cache-control'), 'no-cache', 'Cache-Control: no-cache (o navegador pergunta de novo com o ETag)')
  igual(r0.headers.get('x-content-type-options'), 'nosniff', 'nosniff')
  const etag0 = r0.headers.get('etag')
  ok(/^"[0-9a-f]{32}"$/.test(etag0 ?? ''), `ETag forte de 32 hex (${etag0})`)
  igual(chaves(r0.json), ['atualizadoEm', 'loja', 'ok', 'versao'], '{ ok, versao, atualizadoEm, loja }')
  ok(r0.json.ok === true && Number.isInteger(r0.json.versao) && r0.json.versao >= 1 && ISO.test(r0.json.atualizadoEm), `versão inteira e data ISO (${r0.json.versao}, ${r0.json.atualizadoEm})`)
  const L = r0.json.loja
  igual(chaves(L), ['categorias', 'estados', 'produtos', 'restamAte', 'ruaNoStory', 'sorte', 'stories', 'textos', 'whatsapp'], 'as partes da loja')
  igual([L.whatsapp, L.restamAte], [s.ajustes.whatsapp, s.ajustes.restamAte], 'WhatsApp da loja e "restam X" da semente')
  igual(L.ruaNoStory, true, 'a rua do mercador no começo do Início do celular nasce ligada')
  mesmo(L.textos, s.textos, 'textos da loja = src/dados/textos-loja.ts')
  mesmo(L.categorias, s.categorias, 'categorias da semente, com o "bebida"')
  ok(r0.texto.includes('"stories":{}') && r0.texto.includes('"restam":{}'), 'mapa vazio sai como {} (nunca [])')
  const ufs0 = s.estados.map((e) => e.uf)
  igual(L.estados.map((e) => e.uf), ufs0, 'os estados da semente, na ordem')
  mesmo(
    L.estados,
    s.estados.map((e) => ({
      uf: e.uf, nome: nomesUf[e.uf], destaque: e.destaque, nomePerfil: e.nomePerfil, cidades: e.cidades, instagram: e.instagram, whatsapp: null,
      horario: e.horario, taxaEntrega: e.taxaEntrega,
      entregaGratis: e.entregaGratis ? { diaSemana: e.entregaGratis.dias[0], dias: e.entregaGratis.dias, texto: e.entregaGratis.texto, demo: e.entregaGratis.demo } : null,
      pagamento: e.pagamento, emblema: e.emblema,
    })),
    'cada estado no formato do Canal do site (WhatsApp null = o da loja; os "demo" da semente)',
  )
  igual(L.produtos.map((p) => p.id), s.produtos.map((p) => p.id), 'os produtos da semente, na ordem do catálogo')
  mesmo(
    L.produtos,
    s.produtos.map((p) => ({
      id: p.id, nome: p.nome, ...(p.tamanho ? { tamanho: p.tamanho } : {}), ...(p.detalhe ? { detalhe: p.detalhe } : {}), ...(p.descricao ? { descricao: p.descricao } : {}),
      categoria: p.categoria, preco: p.preco, ...(p.combos.length ? { combos: p.combos } : {}), ...(p.variacoes.length ? { variacoes: p.variacoes } : {}),
      disponivel: Object.fromEntries(ufs0.map((uf) => [uf, p.disponivel[uf] === true])), restam: {}, ...(p.combinaCom.length ? { combinaCom: p.combinaCom } : {}),
      demo: p.demo, foto: p.foto, cor: p.cor, arte: p.arte,
    })),
    'cada produto no formato do site (preço null = Consultar, os "demo" da semente, disponível por estado)',
  )
  mesmo(L.sorte, { ligado: s.sorte.ligado, regras: s.sorte.regras, premios: s.sorte.premios }, 'Teste minha sorte: regras e prêmios da semente')
  igual(L.stories, {}, 'stories: todos no automático')
  ok(!r0.texto.includes('"obs"') && !r0.texto.includes('"estoque"') && !r0.texto.includes('"ativo"'), 'nada que é só do dono (anotação, estoque, desativado)')
  ok((await eventos()).some((e) => e.acao === 'loja-semeada' && e.origem === 'sistema' && e.usuario === null && e.texto === `A loja entrou no servidor (${s.produtos.length} produtos)`), 'a semente na Atividade (pelo sistema, na instalação)')

  parte('loja: ETag e 304')
  const comEtag = (v) => fetch(`${base}/api/index.php?r=loja`, { headers: { 'If-None-Match': v } })
  {
    const a = await comEtag(etag0)
    igual([a.status, await a.text()], [304, ''], 'If-None-Match igual: 304 sem corpo')
    igual([a.headers.get('etag'), a.headers.get('cache-control')], [etag0, 'no-cache'], 'o 304 repete o ETag e o no-cache')
    igual((await comEtag(`W/${etag0}`)).status, 304, 'ETag fraco (W/) também vale')
    igual((await comEtag(etag0.replace(/"$/, '-gzip"'))).status, 304, 'com o "-gzip" que o Apache põe também vale')
    igual((await comEtag(`"abc", ${etag0}`)).status, 304, 'na lista também vale')
    const outro = await comEtag('"0000000000000000000000000000000f"')
    igual(outro.status, 200, 'ETag diferente: 200 com a loja')
    igual(outro.headers.get('etag'), etag0, 'mesmo conteúdo, mesmo ETag')
    igual((await site().get('loja')).headers.get('etag'), etag0, 'pedir de novo dá o mesmo ETag')
  }

  // ─── painel: leitura e guarda ─────────────────────────────────────────────────────────────────────────────────
  parte('loja: admin-loja e a guarda das rotas')
  const a0 = await adm()
  igual(chaves(a0), ['ajustes', 'atualizadoEm', 'categorias', 'estados', 'produtos', 'sorte', 'stories', 'textos', 'versao'], 'admin-loja: as partes')
  igual(a0.versao, r0.json.versao, 'a mesma versão do site')
  const ocb0 = a0.produtos.find((p) => p.id === 'seda-ocb-premium-slim')
  igual(chaves(ocb0), ['arte', 'ativo', 'atualizadoEm', 'categoria', 'combinaCom', 'combos', 'cor', 'criadoEm', 'demo', 'descricao', 'detalhe', 'estados', 'foto', 'id', 'nome', 'obs', 'ordem', 'podeApagar', 'preco', 'tamanho', 'uso', 'variacoes'], 'produto do painel: as chaves')
  igual([ocb0.podeApagar, ocb0.uso.premios.map((x) => x.id)], [false, ['ocb-4-por-3']], 'a OCB tem histórico (prêmio)')
  igual(a0.produtos.find((p) => p.id === 'arizona-green-tea').uso.rateios.map((x) => x.id), ['arizona-green-tea'], 'o Arizona tem histórico (rateio de exemplo)')
  igual(a0.categorias.find((c) => c.id === 'sedas').premios.map((x) => x.id), ['brinde-piteira-papel'], 'categoria mostra o prêmio que vale nela')
  ok(a0.sorte.premios.every((p) => p.noSite === true && p.ativo === true), 'prêmios da semente valendo no site')
  igual(a0.estados.find((e) => e.uf === 'mg').entregaGratis, { dias: [5], texto: 'Sextou com entrega grátis!', demo: false }, 'entrega grátis do painel: os dias e a frase')
  const guarda = {
    'admin-loja-salvar': { restamAte: 3 },
    'admin-loja-exemplos-apagar': {},
    'admin-produto-salvar': { id: 'seda-ocb-premium-slim', preco: 1 },
    'admin-produto-estado': { id: 'seda-ocb-premium-slim', uf: 'mg', disponivel: false },
    'admin-produto-apagar': { id: 'cuia-de-silicone-raw' },
    'admin-produtos-ordem': { ids: ['cuia-de-silicone-raw'] },
    'admin-categoria-salvar': { nome: 'Teste', curto: 'Teste', icone: 'estrela' },
    'admin-categoria-apagar': { id: 'acessorios' },
    'admin-categorias-ordem': { ids: ['acessorios'] },
    'admin-estado-salvar': { uf: 'mg', ativo: false },
    'admin-stories-salvar': { uf: 'mg', produtos: ['seda-ocb-premium-slim'] },
    'admin-sorte-salvar': { ligado: false },
    'admin-premio-salvar': { id: 'ocb-4-por-3', ativo: false },
    'admin-premio-apagar': { id: 'ocb-4-por-3' },
  }
  for (const [rota, corpo] of Object.entries(guarda)) {
    erro(await dono.post(rota, corpo, { csrf: null }), 403, 'csrf', `${rota} sem X-CSRF`)
    erro(await dono.post(rota, corpo, { origem: 'https://golpe.example' }), 403, 'origem', `${rota} com Origin de fora`)
    erro(await dono.post(rota, corpo, { origem: null }), 403, 'origem', `${rota} sem Origin`)
    const outra = new Cliente()
    outra.csrf = dono.csrf
    erro(await outra.post(rota, corpo), 401, 'sem-sessao', `${rota} sem sessão (com um CSRF qualquer)`)
    erro(await dono.get(rota), 405, 'metodo', `${rota} só aceita POST`)
  }
  erro(await new Cliente().get('admin-loja'), 401, 'sem-sessao', 'admin-loja sem sessão')
  igual(await versao(), r0.json.versao, 'nada recusado mexeu na loja (mesma versão)')
  erro(await dono.post('admin-produto-salvar', '{quebrado'), 400, 'invalido', 'JSON quebrado')
  erro(await dono.post('admin-produto-salvar', JSON.stringify({ nome: 'x' }), { cab: { 'Content-Type': 'text/plain' } }), 415, 'invalido', 'corpo que não é JSON')

  // ─── a semente passa nas regras do painel ─────────────────────────────────────────────────────────────────────
  parte('loja: a semente passa nas regras do painel (salvar tudo de novo não muda nada)')
  {
    const antes = await pub()
    // cada um salvo de novo: passa (200) e não muda nada (a versão não sobe); o que mudou vai pra lista
    let ultima = antes.versao
    const mudaram = []
    const conferir = (x, nome) => {
      ok(x.status === 200, `${nome} passa (${x.status} ${x.json?.mensagem ?? ''})`)
      if (x.json?.versao !== ultima) mudaram.push(nome)
      ultima = x.json?.versao ?? ultima
    }
    for (const p of a0.produtos) {
      const corpo = {
        id: p.id, nome: p.nome, tamanho: p.tamanho, detalhe: p.detalhe, descricao: p.descricao, categoria: p.categoria, preco: p.preco, combos: p.combos,
        variacoes: p.variacoes, combinaCom: p.combinaCom, foto: p.foto, cor: p.cor, arte: p.arte, obs: p.obs, demo: p.demo, ativo: p.ativo, estados: p.estados,
      }
      conferir(await dono.post('admin-produto-salvar', corpo), `produto ${p.id}`)
    }
    for (const e of a0.estados) {
      const corpo = {
        uf: e.uf, ativo: e.ativo, destaque: e.destaque, nomePerfil: e.nomePerfil, instagram: e.instagram, whatsapp: e.whatsapp, cidades: e.cidades.map((c) => ({ nome: c.nome })),
        horario: e.horario.semana, horarioDemo: e.horario.demo, taxa: e.taxaEntrega.valor, taxaDemo: e.taxaEntrega.demo,
        entregaGratis: e.entregaGratis ? { dias: e.entregaGratis.dias, texto: e.entregaGratis.texto } : null, entregaGratisDemo: e.entregaGratis?.demo ?? false,
        pagamentos: e.pagamento.opcoes, pagamentosDemo: e.pagamento.demo,
      }
      conferir(await dono.post('admin-estado-salvar', corpo), `estado ${e.uf}`)
    }
    for (const c of a0.categorias) {
      conferir(await dono.post('admin-categoria-salvar', { id: c.id, nome: c.nome, curto: c.curto, icone: c.icone, bebida: c.bebida }), `categoria ${c.id}`)
    }
    for (const p of a0.sorte.premios) {
      conferir(await dono.post('admin-premio-salvar', { id: p.id, tipo: p.tipo, valor: p.valor, titulo: p.titulo, descricao: p.descricao, regra: p.regra, aplicaA: p.aplicaA, comoUsar: p.comoUsar ?? '', peso: p.peso, validadeDias: p.validadeDias, ativo: p.ativo, demo: p.demo }), `prêmio ${p.id}`)
    }
    conferir(await dono.post('admin-loja-salvar', { whatsapp: a0.ajustes.whatsapp, mesmoWhatsappParaTodos: a0.ajustes.mesmoWhatsappParaTodos, restamAte: a0.ajustes.restamAte, textos: a0.textos }), 'ajustes e textos')
    conferir(await dono.post('admin-sorte-salvar', { ligado: a0.sorte.ligado, girosSemConta: a0.sorte.girosSemConta, girosPorDiaComConta: a0.sorte.girosPorDiaComConta, reservaSemContaHoras: a0.sorte.reservaSemContaHoras }), 'regras do Teste minha sorte')
    igual(mudaram, [], 'salvar de novo não muda nada (a semente já tá no formato que o painel grava)')
    mesmo((await pub()).loja, antes.loja, 'a loja continua igual (os "demo" da semente continuam)')
  }

  // ─── produtos ─────────────────────────────────────────────────────────────────────────────────────────────────
  parte('loja: produto (validação)')
  const novo = {
    nome: 'Isqueiro Bic Mini', detalhe: 'Pedra', descricao: 'O pequeno da Bic.', categoria: 'acessorios', preco: '6,50', cor: '#D8325F',
    arte: { tipo: 'isqueiro', corpo: '#d8325f' }, estados: { mg: { disponivel: true, estoque: null }, rj: { disponivel: true, estoque: 4 } },
  }
  {
    const v = await versao()
    const casos = [
      [{ nome: 'A' }, 'nome'], [{ nome: 'x'.repeat(61) }, 'nome'], [{ nome: ['x'] }, 'nome'], [{ tamanho: 'x'.repeat(21) }, 'tamanho'], [{ detalhe: 'x'.repeat(61) }, 'detalhe'],
      [{ descricao: 'x'.repeat(301) }, 'descricao'], [{ categoria: 'nao-existe' }, 'categoria'], [{ categoria: '../x' }, 'categoria'],
      [{ preco: 'abc' }, 'preco'], [{ preco: -1 }, 'preco'], [{ preco: 100000.01 }, 'preco'], [{ preco: '9,999' }, 'preco'],
      [{ preco: null, combos: [{ qtd: 2, total: 10 }] }, 'combos'], [{ combos: [{ qtd: 1, total: 5 }] }, 'combos'], [{ combos: [{ qtd: 2, total: 13 }] }, 'combos'],
      [{ combos: [{ qtd: 2, total: 12 }, { qtd: 2, total: 11 }] }, 'combos'], [{ combos: [{ qtd: 2, total: 12 }, { qtd: 3, total: 11 }] }, 'combos'],
      [{ combos: Array.from({ length: 6 }, (_, i) => ({ qtd: i + 2, total: i + 2 })) }, 'combos'], [{ combos: [{ qtd: 2 }] }, 'combos'], [{ combos: 'x' }, 'combos'],
      [{ variacoes: [{ nome: 'Azul' }, { nome: 'azul' }] }, 'variacoes'], [{ variacoes: [{ nome: 'Áçaí' }, { nome: 'acai' }] }, 'variacoes'], [{ variacoes: [{ nome: '' }] }, 'variacoes'],
      [{ variacoes: Array.from({ length: 13 }, (_, i) => ({ nome: `V${i}` })) }, 'variacoes'], [{ variacoes: [{ nome: 'Azul', preco: 'x' }] }, 'variacoes'],
      [{ combinaCom: ['nao-existe'] }, 'combinaCom'], [{ combinaCom: Array(9).fill('seda-ocb-premium-slim') }, 'combinaCom'],
      [{ foto: 'uploads/naoexiste123.webp' }, 'foto'], [{ foto: '../api/privado/loja.sqlite' }, 'foto'], [{ foto: 'https://golpe.example/a.png' }, 'foto'], [{ foto: 5 }, 'foto'],
      [{ cor: 'red' }, 'cor'], [{ cor: '#12345' }, 'cor'], [{ arte: { tipo: 'foguete', corpo: '#ffffff' } }, 'arte'], [{ arte: { tipo: 'lata' } }, 'arte'], [{ arte: { tipo: 'lata', corpo: '#fff', faixa: 'azul' } }, 'arte'],
      [{ obs: 'x'.repeat(301) }, 'obs'], [{ demo: 'sim' }, 'demo'], [{ ativo: 1 }, 'ativo'],
      [{ estados: { xx: { disponivel: true } } }, 'estados'], [{ estados: { ba: { disponivel: true } } }, 'estados'], [{ estados: { mg: { disponivel: 'sim' } } }, 'estados'],
      [{ estados: { mg: { disponivel: true, estoque: -1 } } }, 'estados'], [{ estados: { mg: { disponivel: true, estoque: 100000 } } }, 'estados'], [{ estados: [1] }, 'estados'],
    ]
    for (const [mudar, campo] of casos) {
      const x = await dono.post('admin-produto-salvar', { ...novo, ...mudar })
      erro(x, 400, 'invalido', `recusa ${JSON.stringify(mudar).slice(0, 70)}`)
      igual(x.json.campo, campo, `campo de ${JSON.stringify(mudar).slice(0, 70)}`)
    }
    for (const [mudar, campo, termo] of [
      [{ nome: 'Seda + Tabaco' }, 'nome', 'tabaco'], [{ descricao: 'Pra quem curte VAPE.' }, 'descricao', 'vape'], [{ detalhe: 'Essência de narguilé' }, 'detalhe', 'essencia de narguile'],
      [{ tamanho: 'Elf Bar 600' }, 'tamanho', 'elf bar'], [{ variacoes: [{ nome: 'Palheiro' }] }, 'variacoes', 'palheiro'], [{ nome: 'Dutch Masters' }, 'nome', 'dutch master'],
      // os nomes do dia a dia do vape, do tabaco aquecido e do narguilé, e a grafia com número
      [{ nome: 'Pod Oxbar 9500' }, 'nome', 'pod'], [{ nome: 'Essência Zomo 50g' }, 'nome', 'essencia'], [{ nome: 'Narguilé completo' }, 'nome', 'narguile'],
      [{ nome: 'IQOS Iluma' }, 'nome', 'iqos'], [{ nome: 'Nicotina líquida 30ml' }, 'nome', 'nicotina'], [{ nome: 'Lost Mary BM600' }, 'nome', 'lost mary'],
      [{ nome: 'Geek Bar Pulse' }, 'nome', 'geek bar'], [{ nome: 'Heets Amber' }, 'nome', 'heets'], [{ nome: 'V4PE' }, 'nome', 'vape'], [{ nome: 'Oxbar G8000' }, 'nome', 'oxbar'],
      [{ descricao: 'Pro teu hookah.' }, 'descricao', 'hookah'], [{ detalhe: 'Kit e-cig' }, 'detalhe', 'e cig'], [{ nome: 'C1GARRO de palha' }, 'nome', 'cigarro'], [{ nome: 'E1f Bar' }, 'nome', 'elf bar'],
    ]) {
      const x = await dono.post('admin-produto-salvar', { ...novo, ...mudar })
      erro(x, 422, 'proibido', `tabaco/vape: recusa ${JSON.stringify(mudar)}`)
      igual([x.json.campo, x.json.termo, x.json.lista], [campo, termo, 'tabaco'], `campo e termo de ${JSON.stringify(mudar)}`)
    }
    // a gíria e a promessa da PALAVRAS_PROIBIDAS também no produto (o nome, a linha de baixo e a descrição saem no site)
    for (const [mudar, campo, termo] of [
      [{ descricao: 'Mata a larica! Frete grátis e entrega no prazo. Brisa garantida.' }, 'descricao', 'brisa'], [{ nome: 'Seda 420' }, 'nome', '420'],
      [{ detalhe: 'Chega no prazo' }, 'detalhe', 'prazo'], [{ variacoes: [{ nome: 'Marofa' }] }, 'variacoes', 'marofa'], [{ tamanho: 'Frete incluso' }, 'tamanho', 'frete'],
    ]) {
      const x = await dono.post('admin-produto-salvar', { ...novo, ...mudar })
      erro(x, 422, 'proibido', `gíria/promessa: recusa ${JSON.stringify(mudar)}`)
      igual([x.json.campo, x.json.termo, x.json.lista], [campo, termo, 'palavras'], `campo, termo e lista de ${JSON.stringify(mudar)}`)
    }
    igual(await versao(), v, 'nada recusado entrou')
    // o que tem uso de verdade passa: Seda Smoking, erva-mate, folhas, floral, entrega, "4200", "Podium", "essencial"
    {
      const x = await dono.post('admin-produto-salvar', {
        ...novo, nome: 'Seda Smoking Podium 4200', detalhe: 'Essencial na cuia', descricao: 'Cuia pra erva-mate, aroma floral. Entrega com a seda de 50 folhas e um trago.',
      })
      igual(x.status, 201, 'produto com Smoking, erva-mate, folhas, floral, entrega, trago, 4200, Podium e essencial passa')
      igual((await dono.post('admin-produto-apagar', { id: x.json.produto.id })).status, 200, 'e sai de novo')
    }
    erro(await dono.post('admin-produto-salvar', { id: 'nao-existe', preco: 1 }), 404, 'nao-encontrado', 'editar produto que não existe')
  }

  parte('loja: produto (criar, editar, foto, combos, variações)')
  let isq
  {
    const v = await versao()
    const c = await dono.post('admin-produto-salvar', novo)
    igual(c.status, 201, 'criou')
    isq = c.json.produto
    igual([isq.id, isq.nome, isq.preco, isq.categoria, isq.cor, isq.ativo, isq.demo, isq.podeApagar, isq.tamanho, isq.foto], ['isqueiro-bic-mini', 'Isqueiro Bic Mini', 6.5, 'acessorios', '#d8325f', true, false, true, '', null], 'campos do produto novo (cor minúscula, "6,50" vira 6.5)')
    igual(isq.estados, { mg: { disponivel: true, estoque: null }, rj: { disponivel: true, estoque: 4 } }, 'disponível e estoque por estado')
    igual(c.json.versao, v + 1, 'a versão sobe')
    ok(ISO.test(c.json.atualizadoEm), 'carimbo com a hora')
    const l = await pub()
    const pp = prodPub(l, 'isqueiro-bic-mini')
    igual(l.loja.produtos.at(-1).id, 'isqueiro-bic-mini', 'entra no fim da grade')
    igual(pp.disponivel, { rj: true, mg: true, sp: false, es: false, sc: false }, 'disponível só onde foi ligado')
    igual(pp.restam, { rj: 4 }, '4 no estoque (restam até 5): "restam 4" no RJ')
    igual([pp.preco, pp.detalhe, pp.descricao, pp.demo, pp.foto, 'tamanho' in pp, 'combos' in pp], [6.5, 'Pedra', 'O pequeno da Bic.', false, null, false, false], 'no site: vazio fica de fora')
    igual((await dono.post('admin-produto-salvar', novo)).json.produto.id, 'isqueiro-bic-mini-2', 'mesmo nome: id com -2')
    const sem = await dono.post('admin-produto-salvar', { nome: 'Cuia de madeira', categoria: 'acessorios' })
    igual([sem.status, sem.json.produto.preco, sem.json.produto.arte, sem.json.produto.estados], [201, null, { tipo: 'lata', corpo: '#a8a8a8' }, {}], 'só o nome e a categoria: Consultar, a arte padrão e nenhum estado')
    igual(prodPub(await pub(), 'cuia-de-madeira').disponivel, { rj: false, mg: false, sp: false, es: false, sc: false }, 'produto sem estado ligado: indisponível em todos')

    const e = await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', preco: 7 })
    igual([e.status, e.json.produto.preco, e.json.produto.detalhe, e.json.produto.estados.rj], [200, 7, 'Pedra', { disponivel: true, estoque: 4 }], 'editar só o preço mantém o resto')
    igual(prodPub(await pub(), 'isqueiro-bic-mini').preco, 7, 'o site vê o preço novo')
    const r1 = await comEtag(etag0)
    igual(r1.status, 200, 'mudou a loja: o ETag de antes não vale (200 com a loja nova)')
    ok(r1.headers.get('etag') !== etag0, 'ETag novo')
    igual((await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', preco: 7 })).json.versao, e.json.versao, 'salvar sem mudar nada não sobe a versão')
    igual((await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', preco: '' })).json.produto.preco, null, 'preço vazio: Consultar')
    igual(prodPub(await pub(), 'isqueiro-bic-mini').preco, null, 'o site mostra Consultar (preço null)')
    igual((await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', preco: 0 })).json.produto.preco, 0, 'preço R$ 0,00 vale')
    const cb = await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', preco: 7, combos: [{ qtd: 3, total: 18 }, { qtd: 2, total: '12,90' }] })
    igual(cb.json.produto.combos, [{ qtd: 2, total: 12.9 }, { qtd: 3, total: 18 }], 'combos em ordem de quantidade')
    igual(prodPub(await pub(), 'isqueiro-bic-mini').combos, [{ qtd: 2, total: 12.9 }, { qtd: 3, total: 18 }], 'o site recebe os combos')
    const caro = await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', preco: 5 })
    erro(caro, 400, 'invalido', 'baixar o preço deixa o combo mais caro que avulso: recusa')
    igual(caro.json.campo, 'combos', 'campo combos (o combo é conferido de novo com o preço novo)')
    erro(await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', preco: null }), 400, 'invalido', 'combo sem preço da unidade: recusa')
    const va = await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', variacoes: [{ nome: 'Azul' }, { nome: 'Vermelho', preco: 7.5 }] })
    igual(va.json.produto.variacoes, [{ id: 'azul', nome: 'Azul', preco: null }, { id: 'vermelho', nome: 'Vermelho', preco: 7.5 }], 'variações com id do nome e preço próprio opcional')
    igual(prodPub(await pub(), 'isqueiro-bic-mini').variacoes, [{ id: 'azul', nome: 'Azul' }, { id: 'vermelho', nome: 'Vermelho', preco: 7.5 }], 'no site: sem preço próprio, sem a chave')
    const vb = await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', variacoes: [{ id: 'azul', nome: 'Azul claro' }, { id: 'vermelho', nome: 'Vermelho' }] })
    igual(vb.json.produto.variacoes.map((x) => x.id), ['azul', 'vermelho'], 'renomear mantém o id (a sacola guarda ele)')

    // foto: a enviada pelo painel (admin-upload) e a do build do site
    const f = new FormData()
    f.append('imagem', new Blob([t.png(600, 800, [30, 30, 30, 255])], { type: 'image/png' }), 'isqueiro.png')
    const up = await dono.post('admin-upload', f)
    igual(up.status, 201, 'foto enviada pelo admin-upload')
    const ft = await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', foto: up.json.imagem })
    igual([ft.status, ft.json.produto.foto], [200, up.json.imagem], 'produto com a foto enviada')
    igual(prodPub(await pub(), 'isqueiro-bic-mini').foto, up.json.imagem, 'o site recebe o caminho da foto')
    igual((await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', descricao: 'O pequeno da Bic.' })).json.produto.foto, up.json.imagem, 'editar outro campo mantém a foto')
    igual((await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', foto: 'produtos/isqueiro-bic.webp' })).status, 200, 'foto do build do site (produtos/…) vale')
    igual((await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', foto: null })).json.produto.foto, null, 'tirar a foto: o site volta pro desenho')

    // "combina com": só aponta pra produto no site
    await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', combinaCom: ['seda-ocb-premium-slim', 'cuia-de-madeira', 'isqueiro-bic-mini-2', 'seda-ocb-premium-slim'] })
    igual((await adm()).produtos.find((p) => p.id === 'isqueiro-bic-mini').combinaCom, ['seda-ocb-premium-slim', 'cuia-de-madeira', 'isqueiro-bic-mini-2'], '"Combina com" sem repetir')
    erro(await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', combinaCom: ['isqueiro-bic-mini'] }), 400, 'invalido', '"Combina com" ele mesmo: recusa')
    await dono.post('admin-produto-salvar', { id: 'cuia-de-madeira', ativo: false })
    igual(prodPub(await pub(), 'isqueiro-bic-mini').combinaCom, ['seda-ocb-premium-slim', 'isqueiro-bic-mini-2'], 'no site, o "Combina com" pula o que tá fora do site')
    ok(!prodPub(await pub(), 'cuia-de-madeira'), 'produto desativado some do site')
    igual((await adm()).produtos.find((p) => p.id === 'cuia-de-madeira').ativo, false, 'e fica no painel, desativado')
    await temEvento('produto-desativado', 'Tirou do site o produto "Cuia de madeira"', 'desativar')
    await dono.post('admin-produto-salvar', { id: 'cuia-de-madeira', ativo: true })
    await temEvento('produto-ativado', 'Pôs de volta no site o produto "Cuia de madeira"', 'reativar')
    await temEvento('produto-criado', 'Criou o produto "Isqueiro Bic Mini"', 'criar')
    await temEvento('produto-editado', 'Editou o produto "Isqueiro Bic Mini"', 'editar')
  }

  parte('loja: troca rápida (disponível e estoque por estado)')
  {
    const troca = (corpo) => dono.post('admin-produto-estado', { id: 'isqueiro-bic-mini', uf: 'mg', ...corpo })
    const noSite = async () => {
      const p = prodPub(await pub(), 'isqueiro-bic-mini')
      return [p.disponivel.mg, p.restam.mg ?? null]
    }
    let x = await troca({ disponivel: false })
    igual([x.status, x.json.produto.estados.mg], [200, { disponivel: false, estoque: null }], 'desligar em MG num toque')
    igual(await noSite(), [false, null], 'o site vê indisponível em MG')
    const v = x.json.versao
    igual((await troca({ disponivel: false })).json.versao, v, 'o mesmo toque de novo não muda nada (manda o valor, não "inverte")')
    x = await troca({ disponivel: true, estoque: 2 })
    igual(x.json.produto.estados.mg, { disponivel: true, estoque: 2 }, 'ligar contando 2')
    igual(await noSite(), [true, 2], 'no site: disponível e "restam 2"')
    x = await troca({ estoque: 0 })
    igual(x.json.produto.estados.mg, { disponivel: true, estoque: 0 }, 'estoque 0: continua ligado')
    igual(await noSite(), [false, null], 'estoque 0: indisponível no site sozinho (esgotado), sem "restam"')
    await temEvento('produto-estado', 'MG: "Isqueiro Bic Mini" esgotado (0 un.)', 'esgotar')
    x = await troca({ estoque: 9 })
    igual(await noSite(), [true, null], 'estoque volta (9): disponível de novo, sem "restam" (acima de 5)')
    await temEvento('produto-estado', 'MG: "Isqueiro Bic Mini" disponível, 9 un.', 'repor')
    await troca({ estoque: 5 })
    igual(await noSite(), [true, 5], 'estoque 5 (o limite do "restam X"): "restam 5"')
    await troca({ estoque: null })
    igual(await noSite(), [true, null], 'parar de contar: disponível, sem "restam"')
    await troca({ estoque: '3' })
    igual(await noSite(), [true, 3], 'estoque em texto ("3") vale')
    for (const [corpo, campo, msg] of [
      [{ uf: 'ba' }, 'uf', 'estado que a loja não atende'], [{ uf: 'xx' }, 'uf', 'UF que não existe'], [{ estoque: -1 }, 'estoque', 'estoque negativo'],
      [{ estoque: 100000 }, 'estoque', 'estoque acima de 99.999'], [{ estoque: 1.5 }, 'estoque', 'estoque quebrado'], [{ disponivel: 'sim' }, 'disponivel', 'disponível que não é sim/não'],
    ]) {
      const y = await troca(corpo)
      erro(y, 400, 'invalido', msg)
      igual(y.json.campo, campo, `campo (${msg})`)
    }
    erro(await dono.post('admin-produto-estado', { id: 'nao-existe', uf: 'mg', disponivel: true }), 404, 'nao-encontrado', 'produto que não existe')
    igual(await noSite(), [true, 3], 'o recusado não mexeu')
    // "restam X" desligado: nunca mostra
    let aj = await dono.post('admin-loja-salvar', { restamAte: null })
    igual([aj.status, aj.json.ajustes.restamAte], [200, null], '"restam X" desligado')
    const l = await pub()
    igual([l.loja.restamAte, prodPub(l, 'isqueiro-bic-mini').restam, prodPub(l, 'isqueiro-bic-mini').disponivel.mg], [null, {}, true], 'sem "restam X": nenhum produto mostra quanto resta')
    for (const n of [0, 100, 'muitos']) erro(await dono.post('admin-loja-salvar', { restamAte: n }), 400, 'invalido', `restamAte ${n}`)
    aj = await dono.post('admin-loja-salvar', { restamAte: 5 })
    igual(aj.json.ajustes.restamAte, 5, '"restam X" volta pra 5')
    igual(await noSite(), [true, 3], '"restam 3" de novo')
    await troca({ estoque: null })
  }

  parte('loja: a rua do mercador no começo do Início (Stories do Início)')
  {
    igual((await adm()).ajustes.ruaNoStory, true, 'admin-loja: a chave da rua nasce ligada')
    const v0 = await versao()
    let aj = await dono.post('admin-loja-salvar', { ruaNoStory: false })
    igual([aj.status, aj.json.ajustes.ruaNoStory], [200, false], 'desligou a rua')
    const l = await pub()
    igual([l.loja.ruaNoStory, l.versao], [false, v0 + 1], 'o site vê a rua desligada (e a versão sobe: o ETag muda)')
    await temEvento('loja-ajustes', 'Desligou a rua do mercador no começo do Início', 'rua desligada')
    const repetido = await dono.post('admin-loja-salvar', { ruaNoStory: false })
    igual([repetido.status, repetido.json.versao], [200, v0 + 1], 'salvar igual não sobe a versão')
    for (const v of ['nao', 0, null]) {
      const y = await dono.post('admin-loja-salvar', { ruaNoStory: v })
      erro(y, 400, 'invalido', `ruaNoStory ${JSON.stringify(v)}`)
      igual(y.json.campo, 'ruaNoStory', `campo (ruaNoStory ${JSON.stringify(v)})`)
    }
    aj = await dono.post('admin-loja-salvar', { ruaNoStory: true })
    igual([aj.json.ajustes.ruaNoStory, (await pub()).loja.ruaNoStory], [true, true], 'ligou de novo')
    await temEvento('loja-ajustes', 'Ligou a rua do mercador no começo do Início', 'rua ligada')
    aj = await dono.post('admin-loja-salvar', { ruaNoStory: false, restamAte: 4 })
    await temEvento('loja-ajustes', 'Mudou os ajustes da loja', 'a rua junto com outro ajuste: a frase de sempre')
    aj = await dono.post('admin-loja-salvar', { ruaNoStory: true, restamAte: 5 })
    igual([aj.json.ajustes.ruaNoStory, aj.json.ajustes.restamAte], [true, 5], 'volta como tava')
  }

  parte('loja: apagar e ordem dos produtos')
  {
    const oc = await dono.post('admin-produto-apagar', { id: 'seda-ocb-premium-slim' })
    erro(oc, 409, 'em-uso', 'produto que é prêmio não apaga')
    igual(oc.json.premios.map((x) => x.id), ['ocb-4-por-3'], 'diz o prêmio')
    ok(/Desativa/.test(oc.json.mensagem), 'e manda desativar')
    const az = await dono.post('admin-produto-apagar', { id: 'arizona-green-tea' })
    erro(az, 409, 'em-uso', 'produto com rateio não apaga')
    igual(az.json.rateios.map((x) => x.id), ['arizona-green-tea'], 'diz o rateio')
    const ap = await dono.post('admin-produto-apagar', { id: 'isqueiro-bic-mini-2' })
    igual(ap.status, 200, 'apaga produto sem histórico')
    ok(!(await adm()).produtos.some((p) => p.id === 'isqueiro-bic-mini-2') && !prodPub(await pub(), 'isqueiro-bic-mini-2'), 'sumiu do painel e do site')
    igual((await adm()).produtos.find((p) => p.id === 'isqueiro-bic-mini').combinaCom, ['seda-ocb-premium-slim', 'cuia-de-madeira'], 'e saiu do "Combina com" dos outros')
    erro(await dono.post('admin-produto-apagar', { id: 'isqueiro-bic-mini-2' }), 404, 'nao-encontrado', 'apagado não existe mais')
    await temEvento('produto-apagado', 'Apagou o produto "Isqueiro Bic Mini"', 'apagar')
    igual((await dono.post('admin-produto-apagar', { id: 'cuia-de-madeira' })).status, 200, 'apaga a cuia de madeira')

    const todos = (await adm()).produtos.map((p) => p.id)
    for (const [ids, msg] of [[[], 'lista vazia'], [['nao-existe'], 'id que não existe'], [['cuia-de-silicone-raw', 'cuia-de-silicone-raw'], 'id repetido'], ['x', 'não é lista'], [{ a: 1 }, 'objeto']]) {
      const y = await dono.post('admin-produtos-ordem', { ids })
      erro(y, 400, 'invalido', `ordem: ${msg}`)
      igual(y.json.campo, 'ids', `campo ids (${msg})`)
    }
    const o = await dono.post('admin-produtos-ordem', { ids: ['isqueiro-bic-mini', 'seda-ocb-premium-slim'] })
    igual(o.json.ordem, ['isqueiro-bic-mini', 'seda-ocb-premium-slim', ...todos.filter((id) => id !== 'isqueiro-bic-mini' && id !== 'seda-ocb-premium-slim')], 'os que vieram primeiro, o resto depois na ordem de antes')
    igual((await pub()).loja.produtos.slice(0, 2).map((p) => p.id), ['isqueiro-bic-mini', 'seda-ocb-premium-slim'], 'o site recebe na ordem nova')
    await temEvento('produtos-ordem', 'Mudou a ordem dos produtos', 'ordem')
    igual((await dono.post('admin-produtos-ordem', { ids: todos })).json.ordem, todos, 'volta a ordem de antes')
  }

  // ─── categorias ───────────────────────────────────────────────────────────────────────────────────────────────
  parte('loja: categorias')
  {
    for (const [corpo, campo] of [
      [{ nome: 'A', curto: 'Ab', icone: 'estrela' }, 'nome'], [{ nome: 'Tabuleiros', curto: 'x'.repeat(15), icone: 'estrela' }, 'curto'], [{ nome: 'Acessórios de viagem', icone: 'estrela' }, 'curto'],
      [{ nome: 'Tabuleiros', curto: 'Tab', icone: 'foguete' }, 'icone'], [{ nome: 'Tabuleiros', curto: 'Tab', icone: 'estrela', bebida: 'sim' }, 'bebida'],
    ]) {
      const x = await dono.post('admin-categoria-salvar', corpo)
      erro(x, 400, 'invalido', `categoria: recusa ${JSON.stringify(corpo).slice(0, 60)}`)
      igual(x.json.campo, campo, `campo (${JSON.stringify(corpo).slice(0, 60)})`)
    }
    const tb = await dono.post('admin-categoria-salvar', { nome: 'Tabaco e cia', curto: 'Tabaco', icone: 'estrela' })
    erro(tb, 422, 'proibido', 'categoria com tabaco')
    igual(tb.json.campo, 'nome', 'campo nome')
    const c = await dono.post('admin-categoria-salvar', { nome: 'Tabuleiros', curto: 'Tabuleiros', icone: 'estrela' })
    igual([c.status, c.json.categoria], [201, { id: 'tabuleiros', nome: 'Tabuleiros', curto: 'Tabuleiros', icone: 'estrela', bebida: true }], 'categoria nova nasce bebida (até o dono dizer que não)')
    const c2 = await dono.post('admin-categoria-salvar', { nome: 'Cuias e copos', icone: 'cuia', bebida: false })
    igual([c2.status, c2.json.categoria.curto, c2.json.categoria.bebida], [201, 'Cuias e copos', false], 'nome curto o bastante vira o curto')
    igual((await pub()).loja.categorias.slice(-2).map((x) => x.id), ['tabuleiros', 'cuias-e-copos'], 'o site vê as categorias novas no fim')
    igual((await dono.post('admin-categoria-salvar', { id: 'tabuleiros', bebida: false })).json.categoria.bebida, false, 'editar só o bebida')
    await temEvento('categoria-criada', 'Criou a categoria "Tabuleiros"', 'criar categoria')
    for (const id of ['sedas', 'acessorios']) {
      const x = await dono.post('admin-categoria-salvar', { id, bebida: true })
      erro(x, 400, 'invalido', `${id} com prêmio não vira bebida`)
      igual(x.json.campo, 'bebida', 'campo bebida')
    }
    erro(await dono.post('admin-categoria-salvar', { id: 'nao-existe', nome: 'X y' }), 404, 'nao-encontrado', 'editar categoria que não existe')
    const cs = await dono.post('admin-categoria-apagar', { id: 'sedas' })
    erro(cs, 409, 'em-uso', 'categoria com produto não apaga')
    igual(cs.json.produtos, 3, 'diz quantos produtos')
    igual((await dono.post('admin-categoria-apagar', { id: 'tabuleiros' })).status, 200, 'apaga categoria vazia')
    erro(await dono.post('admin-categoria-apagar', { id: 'tabuleiros' }), 404, 'nao-encontrado', 'apagada não existe mais')
    await temEvento('categoria-apagada', 'Apagou a categoria "Tabuleiros"', 'apagar categoria')
    // categoria sem produto, mas com prêmio: não apaga
    const pr = await dono.post('admin-premio-salvar', {
      tipo: 'desconto-percentual', valor: 5, titulo: 'Cinco nas cuias', descricao: 'Cuia mais em conta.', regra: '5% de desconto em cuias e copos',
      aplicaA: { categorias: ['cuias-e-copos'] }, peso: 1, validadeDias: 2,
    })
    igual(pr.status, 201, 'prêmio na categoria nova')
    const cp = await dono.post('admin-categoria-apagar', { id: 'cuias-e-copos' })
    erro(cp, 409, 'em-uso', 'categoria com prêmio não apaga')
    igual(cp.json.premios.map((x) => x.id), ['cinco-nas-cuias'], 'diz o prêmio')
    igual((await dono.post('admin-premio-apagar', { id: 'cinco-nas-cuias' })).status, 200, 'apaga o prêmio')
    igual((await dono.post('admin-categoria-apagar', { id: 'cuias-e-copos' })).status, 200, 'aí a categoria apaga')
    const todas = (await adm()).categorias.map((x) => x.id)
    const o = await dono.post('admin-categorias-ordem', { ids: ['sedas'] })
    igual(o.json.ordem, ['sedas', ...todas.filter((x) => x !== 'sedas')], 'sedas primeiro, o resto depois')
    igual((await pub()).loja.categorias[0].id, 'sedas', 'o site vê sedas primeiro')
    erro(await dono.post('admin-categorias-ordem', { ids: ['sedas', 'nao-existe'] }), 400, 'invalido', 'ordem com categoria que não existe')
    igual((await dono.post('admin-categorias-ordem', { ids: todas })).json.ordem, todas, 'volta a ordem')
  }

  // ─── estados ──────────────────────────────────────────────────────────────────────────────────────────────────
  parte('loja: estados')
  {
    const salvar = (corpo) => dono.post('admin-estado-salvar', corpo)
    const v = await versao()
    for (const [corpo, campo] of [
      [{ uf: 'mg', instagram: 'tem espaço no meio' }, 'instagram'], [{ uf: 'mg', instagram: '' }, 'instagram'], [{ uf: 'mg', destaque: 'X' }, 'destaque'],
      [{ uf: 'mg', destaque: 'x'.repeat(21) }, 'destaque'], [{ uf: 'mg', nomePerfil: 'A' }, 'nomePerfil'], [{ uf: 'mg', whatsapp: '123' }, 'whatsapp'],
      [{ uf: 'mg', cidades: ['Niterói', 'niteroi'] }, 'cidades'], [{ uf: 'mg', cidades: ['A'] }, 'cidades'], [{ uf: 'mg', cidades: Array.from({ length: 31 }, (_, i) => `Cidade ${i}`) }, 'cidades'],
      [{ uf: 'mg', horario: Array(6).fill(null) }, 'horario'], [{ uf: 'mg', horario: [['25:00', '02:00'], null, null, null, null, null, null] }, 'horario'],
      [{ uf: 'mg', horario: [null, ['14:00', '14:00'], null, null, null, null, null] }, 'horario'], [{ uf: 'mg', horario: [null, ['9:00', '18:00'], null, null, null, null, null] }, 'horario'],
      [{ uf: 'mg', taxa: 'x' }, 'taxa'], [{ uf: 'mg', taxa: -5 }, 'taxa'], [{ uf: 'mg', entregaGratis: { dias: [], texto: 'Oi oi' } }, 'entregaGratis'],
      [{ uf: 'mg', entregaGratis: { dias: [7], texto: 'Oi oi' } }, 'entregaGratis'], [{ uf: 'mg', entregaGratis: { dias: [5], texto: 'A' } }, 'entregaGratis'],
      [{ uf: 'mg', pagamentos: [] }, 'pagamentos'], [{ uf: 'mg', pagamentos: ['boleto'] }, 'pagamentos'], [{ uf: 'mg', ativo: 'nao' }, 'ativo'], [{ uf: 'mg', taxaDemo: 'sim', taxa: 5 }, 'taxaDemo'],
      [{ uf: 'xx' }, 'uf'], [{}, 'uf'],
    ]) {
      const x = await salvar(corpo)
      erro(x, 400, 'invalido', `estado: recusa ${JSON.stringify(corpo).slice(0, 70)}`)
      igual(x.json.campo, campo, `campo (${JSON.stringify(corpo).slice(0, 70)})`)
    }
    igual((await salvar({ uf: 'mg', horario: [['25:00', '02:00'], null, null, null, null, null, null] })).json.dia, 0, 'o erro do horário diz o dia')
    const tb = await salvar({ uf: 'mg', destaque: 'DELIVERY VAPE' })
    erro(tb, 422, 'proibido', 'destaque com vape')
    igual([tb.json.campo, tb.json.termo], ['destaque', 'vape'], 'campo e termo')
    // a gíria e a promessa também no nome do perfil (sai no cabeçalho), no destaque e na cidade
    for (const [corpo, campo, termo, lista] of [
      [{ uf: 'mg', nomePerfil: 'Brisa 420 Larica' }, 'nomePerfil', 'brisa', 'palavras'], [{ uf: 'mg', destaque: 'FRETE GRÁTIS' }, 'destaque', 'grátis', 'palavras'],
      [{ uf: 'mg', cidades: ['Teófilo Otoni', 'Larica City'] }, 'cidades', 'larica', 'palavras'], [{ uf: 'mg', cidades: ['Pod City'] }, 'cidades', 'pod', 'tabaco'],
    ]) {
      const x = await salvar(corpo)
      erro(x, 422, 'proibido', `estado: recusa ${JSON.stringify(corpo)}`)
      igual([x.json.campo, x.json.termo, x.json.lista], [campo, termo, lista], `campo, termo e lista (${JSON.stringify(corpo)})`)
    }
    igual(await versao(), v, 'nada recusado entrou')

    let x = await salvar({ uf: 'mg', instagram: ' @GreenCheese_ImportsMG ' })
    igual([x.status, x.json.estado.instagram], [200, 'greencheese_importsmg'], 'Instagram com @, maiúscula e espaço: limpo')
    x = await salvar({ uf: 'mg', instagram: 'https://www.instagram.com/greencheese_importsmg/' })
    igual(x.json.estado.instagram, 'greencheese_importsmg', 'link do perfil colado: vira o @')
    const semana = [null, ['14:00', '23:00'], ['14:00', '23:00'], ['14:00', '23:00'], ['14:00', '23:00'], ['18:00', '02:00'], ['18:00', '02:00']]
    x = await salvar({ uf: 'mg', horario: semana, taxa: '9,50', cidades: ['Teófilo Otoni', { nome: 'Governador Valadares' }] })
    igual([x.json.estado.horario, x.json.estado.taxaEntrega], [{ semana, demo: false }, { valor: 9.5, demo: false }], 'horário (com madrugada) e taxa salvos deixam de ser exemplo')
    igual(x.json.estado.cidades, [{ slug: 'teofilo-otoni', nome: 'Teófilo Otoni' }, { slug: 'governador-valadares', nome: 'Governador Valadares' }], 'cidades com slug')
    const mg = (await pub()).loja.estados.find((e) => e.uf === 'mg')
    igual([mg.horario.demo, mg.taxaEntrega, mg.pagamento.demo], [false, { valor: 9.5, demo: false }, true], 'o site vê horário e taxa de verdade; o pagamento segue de exemplo (ninguém mexeu)')
    igual((await salvar({ uf: 'mg', taxa: null })).json.estado.taxaEntrega, { valor: null, demo: false }, 'taxa "a confirmar" de verdade')
    igual((await salvar({ uf: 'mg', taxa: 8, taxaDemo: true })).json.estado.taxaEntrega, { valor: 8, demo: true }, 'taxa marcada como exemplo continua exemplo')
    x = await salvar({ uf: 'mg', entregaGratis: { dias: [6, 5, 5], texto: 'Sextou com entrega grátis!' } })
    igual(x.json.estado.entregaGratis, { dias: [5, 6], texto: 'Sextou com entrega grátis!', demo: false }, 'entrega grátis em mais de um dia (sem repetir, em ordem)')
    igual((await pub()).loja.estados.find((e) => e.uf === 'mg').entregaGratis, { diaSemana: 5, dias: [5, 6], texto: 'Sextou com entrega grátis!', demo: false }, 'no site: os dias e o diaSemana (o primeiro)')
    igual((await salvar({ uf: 'mg', entregaGratis: null })).json.estado.entregaGratis, null, 'sem entrega grátis')
    await salvar({ uf: 'mg', entregaGratis: { dias: [5], texto: 'Sextou com entrega grátis!' } })
    await temEvento('estado-editado', 'Editou o atendimento de MG', 'editar estado')

    // WhatsApp próprio e "o mesmo pra todos"
    x = await salvar({ uf: 'mg', whatsapp: '(31) 98888-7777' })
    igual(x.json.estado.whatsapp, '5531988887777', 'WhatsApp próprio de MG guardado')
    igual((await pub()).loja.estados.find((e) => e.uf === 'mg').whatsapp, null, 'com "o mesmo pra todos" ligado, o site recebe null (o da loja)')
    let aj = await dono.post('admin-loja-salvar', { mesmoWhatsappParaTodos: false })
    igual(aj.json.ajustes.mesmoWhatsappParaTodos, false, '"o mesmo pra todos" desligado')
    igual((await pub()).loja.estados.map((e) => [e.uf, e.whatsapp]), [['rj', null], ['mg', '5531988887777'], ['sp', null], ['es', null], ['sc', null]], 'aí MG fecha no dele e o resto no da loja')
    erro(await dono.post('admin-loja-salvar', { whatsapp: '123' }), 400, 'invalido', 'WhatsApp da loja inválido')
    erro(await dono.post('admin-loja-salvar', { mesmoWhatsappParaTodos: 'sim' }), 400, 'invalido', '"o mesmo pra todos" que não é sim/não')
    aj = await dono.post('admin-loja-salvar', { whatsapp: '(33) 99113-9036', mesmoWhatsappParaTodos: true })
    igual([aj.json.ajustes.whatsapp, aj.json.ajustes.mesmoWhatsappParaTodos], ['5533991139036', true], 'WhatsApp formatado vira só dígitos; "o mesmo pra todos" volta')
    await salvar({ uf: 'mg', whatsapp: null })

    // ativar um estado novo
    x = await salvar({ uf: 'ba', instagram: 'greencheese_importsba' })
    erro(x, 400, 'invalido', 'estado novo sem forma de pagamento')
    igual(x.json.campo, 'pagamentos', 'campo pagamentos')
    x = await salvar({ uf: 'ba', pagamentos: ['pix'] })
    erro(x, 400, 'invalido', 'estado novo sem Instagram')
    igual(x.json.campo, 'instagram', 'campo instagram')
    x = await salvar({ uf: 'BA', instagram: 'greencheese_importsba', pagamentos: ['dinheiro', 'pix'] })
    igual(x.status, 201, 'Bahia ativada')
    const ba = x.json.estado
    igual(
      [ba.uf, ba.nome, ba.ativo, ba.destaque, ba.emblema, ba.whatsapp, ba.nomePerfil, ba.cidades, ba.horario, ba.taxaEntrega, ba.entregaGratis, ba.pagamento],
      ['ba', 'Bahia', true, 'DELIVERY BA', 'generico', null, null, [], { semana: Array(7).fill(null), demo: true }, { valor: null, demo: false }, null, { opcoes: ['pix', 'dinheiro'], demo: false }],
      'estado novo: emblema genérico, horário a confirmar (o site não mostra), taxa a confirmar, pagamento na ordem da loja',
    )
    let l = await pub()
    igual(l.loja.estados.at(-1).uf, 'ba', 'o site vê a Bahia no fim')
    ok(l.loja.produtos.every((p) => p.disponivel.ba === false), 'nenhum produto disponível na Bahia ainda')
    await temEvento('estado-ativado', 'Ativou BA no site', 'ativar estado')
    x = await dono.post('admin-produto-estado', { id: 'seda-ocb-premium-slim', uf: 'ba', disponivel: true })
    igual(prodPub(await pub(), 'seda-ocb-premium-slim').disponivel.ba, true, 'liga a OCB na Bahia num toque')
    x = await salvar({ uf: 'ba', ativo: false })
    igual(x.json.estado.ativo, false, 'tira a Bahia do site')
    l = await pub()
    ok(!l.loja.estados.some((e) => e.uf === 'ba') && !('ba' in prodPub(l, 'seda-ocb-premium-slim').disponivel), 'o site não vê a Bahia (nem no disponível dos produtos)')
    await temEvento('estado-desativado', 'Tirou BA do site', 'desativar estado')
    igual((await adm()).estados.find((e) => e.uf === 'ba').instagram, 'greencheese_importsba', 'os dados da Bahia ficam guardados')
    await salvar({ uf: 'ba', ativo: true })
    await temEvento('estado-ativado', 'Pôs BA de volta no site', 'reativar estado')
    igual(prodPub(await pub(), 'seda-ocb-premium-slim').disponivel.ba, true, 'volta com o que tava ligado')
    // o último estado não sai
    for (const uf of ['ba', 'rj', 'sp', 'es', 'sc']) igual((await salvar({ uf, ativo: false })).status, 200, `tira ${uf}`)
    erro(await salvar({ uf: 'mg', ativo: false }), 409, 'ultimo-estado', 'o último estado do site não sai')
    igual((await pub()).loja.estados.map((e) => e.uf), ['mg'], 'só MG no site')
    for (const uf of ['rj', 'sp', 'es', 'sc']) await salvar({ uf, ativo: true })
    igual((await pub()).loja.estados.map((e) => e.uf), ['rj', 'mg', 'sp', 'es', 'sc'], 'os 5 de volta (a Bahia fica fora)')
  }

  // ─── stories do Início ────────────────────────────────────────────────────────────────────────────────────────
  parte('loja: stories do Início')
  {
    const salvar = (uf, produtos) => dono.post('admin-stories-salvar', { uf, produtos })
    let x = await salvar('mg', ['seda-ocb-premium-slim', 'hennessy-very-special', 'isqueiro-bic-mini'])
    igual([x.status, x.json.produtos], [200, ['seda-ocb-premium-slim', 'hennessy-very-special', 'isqueiro-bic-mini']], 'salva a lista do story de MG, na ordem')
    igual((await adm()).stories.mg, ['seda-ocb-premium-slim', 'hennessy-very-special', 'isqueiro-bic-mini'], 'o painel guarda a lista inteira')
    igual((await pub()).loja.stories, { mg: ['seda-ocb-premium-slim', 'isqueiro-bic-mini'] }, 'o site recebe só os à venda em MG (o Hennessy não tá)')
    await temEvento('stories-salvos', 'Escolheu o story do Início de MG (3 produtos)', 'story')
    const nove = (await adm()).produtos.slice(0, 9).map((p) => p.id)
    x = await salvar('mg', nove)
    erro(x, 400, 'invalido', '9 produtos no story')
    ok(x.json.campo === 'produtos' && /8/.test(x.json.mensagem), `até 8 (as barrinhas): "${x.json.mensagem}"`)
    for (const [uf, lista, campo, msg] of [
      ['mg', ['seda-ocb-premium-slim', 'seda-ocb-premium-slim'], 'produtos', 'repetido'], ['mg', ['nao-existe'], 'produtos', 'produto que não existe'], ['mg', 'x', 'produtos', 'não é lista'],
      ['pi', ['seda-ocb-premium-slim'], 'uf', 'estado que a loja não atende'], ['xx', [], 'uf', 'UF que não existe'],
    ]) {
      const y = await salvar(uf, lista)
      erro(y, 400, 'invalido', `story: ${msg}`)
      igual(y.json.campo, campo, `campo (${msg})`)
    }
    x = await salvar('es', ['coca-cola-vanilla'])
    igual((await pub()).loja.stories.es, undefined, 'nenhum da lista à venda no estado: o estado fica no automático (sem a chave)')
    await salvar('es', [])
    // esgotar e desligar tiram do story na hora
    await dono.post('admin-produto-estado', { id: 'isqueiro-bic-mini', uf: 'mg', estoque: 0 })
    igual((await pub()).loja.stories.mg, ['seda-ocb-premium-slim'], 'esgotou: sai do story')
    await dono.post('admin-produto-estado', { id: 'isqueiro-bic-mini', uf: 'mg', estoque: null })
    await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', ativo: false })
    igual((await pub()).loja.stories.mg, ['seda-ocb-premium-slim'], 'desativado: sai do story')
    await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', ativo: true })
    igual((await pub()).loja.stories.mg, ['seda-ocb-premium-slim', 'isqueiro-bic-mini'], 'voltou: entra de novo')
    // 8 à venda passam; a lista nunca passa de 8
    const aVendaMg = (await pub()).loja.produtos.filter((p) => p.disponivel.mg).map((p) => p.id).slice(0, 8)
    igual((await salvar('mg', aVendaMg)).json.produtos.length, 8, '8 produtos: o máximo')
    igual((await pub()).loja.stories.mg, aVendaMg, 'os 8 passam, na ordem')
    x = await salvar('mg', [])
    igual(x.json.produtos, [], 'lista vazia: automático')
    ok(!('mg' in (await adm()).stories) && !('mg' in (await pub()).loja.stories), 'sem a chave no painel e no site')
    await temEvento('stories-salvos', 'Story do Início de MG no automático', 'story automático')
  }

  // ─── ajustes e textos ─────────────────────────────────────────────────────────────────────────────────────────
  parte('loja: textos da loja')
  {
    const t0 = (await adm()).textos
    const v = await versao()
    for (const [textos, campo] of [
      ['x', 'textos'], [[1], 'textos'], [{ bio: ['a', 'b', 'c', 'd'] }, 'bio'], [{ bio: ['x'.repeat(81)] }, 'bio'], [{ bio: ['x'.repeat(76), 'y'.repeat(76)] }, 'bio'], [{ bio: [] }, 'bio'],
      [{ fraseStory: 'A' }, 'fraseStory'], [{ fraseStory: 'x'.repeat(29) }, 'fraseStory'], [{ sacolaVazia: 'x'.repeat(49) }, 'sacolaVazia'],
      [{ falasMercado: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'falasMercado'], [{ falasMercado: ['x'.repeat(33)] }, 'falasMercado'], [{ falasMercado: 'oi' }, 'falasMercado'],
    ]) {
      const x = await dono.post('admin-loja-salvar', { textos })
      erro(x, 400, 'invalido', `textos: recusa ${JSON.stringify(textos).slice(0, 60)}`)
      igual(x.json.campo, campo, `campo (${JSON.stringify(textos).slice(0, 60)})`)
    }
    for (const [textos, campo, termo, lista] of [
      [{ sacolaVazia: 'Frete por nossa conta' }, 'sacolaVazia', 'frete', 'palavras'], [{ fraseStory: 'Bora fumar' }, 'fraseStory', 'fumar', 'palavras'],
      [{ bio: ['Entrega grátis'] }, 'bio', 'grátis', 'palavras'], [{ falasMercado: ['Tem palheiro'] }, 'falasMercado', 'palheiro', 'tabaco'],
    ]) {
      const x = await dono.post('admin-loja-salvar', { textos })
      erro(x, 422, 'proibido', `textos: recusa ${JSON.stringify(textos)}`)
      igual([x.json.campo, x.json.termo, x.json.lista], [campo, termo, lista], `campo, termo e lista (${JSON.stringify(textos)})`)
    }
    igual(await versao(), v, 'nada recusado entrou')
    let x = await dono.post('admin-loja-salvar', { textos: { fraseStory: 'Etapa final' } })
    igual([x.status, x.json.textos.fraseStory], [200, 'Etapa final'], '"tapa" só no começo da palavra: "Etapa" passa')
    x = await dono.post('admin-loja-salvar', { textos: { fraseStory: 'Vem que tem!', bio: ['  Linha um ', '', 'Linha dois'] } })
    igual([x.json.textos.fraseStory, x.json.textos.bio, x.json.textos.sacolaVazia], ['Vem que tem!', ['Linha um', 'Linha dois'], t0.sacolaVazia], 'muda só o que veio; linha em branco some')
    igual((await pub()).loja.textos.fraseStory, 'Vem que tem!', 'o site recebe o texto novo')
    await temEvento('loja-ajustes', 'Mudou os ajustes da loja', 'ajustes')
    igual((await dono.post('admin-loja-salvar', { textos: t0 })).json.textos, t0, 'volta os textos de antes')
  }

  // ─── Teste minha sorte ────────────────────────────────────────────────────────────────────────────────────────
  parte('loja: regras do Teste minha sorte')
  {
    for (const [corpo, campo] of [
      [{ girosSemConta: 0 }, 'girosSemConta'], [{ girosSemConta: 4 }, 'girosSemConta'], [{ girosPorDiaComConta: 0 }, 'girosPorDiaComConta'], [{ girosPorDiaComConta: 6 }, 'girosPorDiaComConta'],
      [{ reservaSemContaHoras: 0 }, 'reservaSemContaHoras'], [{ reservaSemContaHoras: 73 }, 'reservaSemContaHoras'], [{ ligado: 'sim' }, 'ligado'],
    ]) {
      const x = await dono.post('admin-sorte-salvar', corpo)
      erro(x, 400, 'invalido', `regras: recusa ${JSON.stringify(corpo)}`)
      igual(x.json.campo, campo, `campo (${JSON.stringify(corpo)})`)
    }
    ok(/primeiro é sempre livre/.test((await dono.post('admin-sorte-salvar', { girosSemConta: 0 })).json.mensagem), 'sem conta: o primeiro giro é sempre livre (conta é incentivo, nunca pedágio)')
    const x = await dono.post('admin-sorte-salvar', { girosPorDiaComConta: 2, reservaSemContaHoras: 48 })
    igual(x.json.sorte, { ligado: true, girosSemConta: 1, girosPorDiaComConta: 2, reservaSemContaHoras: 48 }, 'regras novas')
    igual((await pub()).loja.sorte.regras, { girosSemConta: 1, girosPorDiaComConta: 2, reservaSemContaHoras: 48 }, 'o site recebe as regras')
    await temEvento('sorte-regras', 'Mudou as regras do Teste minha sorte', 'regras')
    igual((await dono.post('admin-sorte-salvar', { ligado: false })).json.sorte.ligado, false, 'desliga o jogo')
    igual((await pub()).loja.sorte.ligado, false, 'o site vê desligado')
    await dono.post('admin-sorte-salvar', { ligado: true, girosPorDiaComConta: 1, reservaSemContaHoras: 24 })
  }

  parte('loja: prêmios (as regras de src/lib/cupom.ts)')
  {
    const base1 = {
      tipo: 'desconto-percentual', valor: 20, titulo: 'Vinte na cuia', descricao: 'A cuia mais em conta.', regra: '20% de desconto na Cuia de silicone RAW',
      aplicaA: { produtos: ['cuia-de-silicone-raw'] }, comoUsar: 'Põe a cuia na sacola e usa o cupom.', peso: 10, validadeDias: 5,
    }
    // produto fora da categoria de bebida, mas com nome de bebida alcoólica: a rede pega
    igual((await dono.post('admin-produto-salvar', { nome: 'Copo de Whisky', categoria: 'acessorios', preco: 20 })).status, 201, 'copo com nome de bebida em acessórios')
    const v = await versao()
    for (const [mudar, campo] of [
      [{ tipo: 'x' }, 'tipo'], [{ valor: 0 }, 'valor'], [{ valor: 51 }, 'valor'], [{ valor: '10%' }, 'valor'], [{ valor: 12.5 }, 'valor'],
      [{ tipo: 'leve-x-pague-y', valor: { leve: 3, pague: 3 } }, 'valor'], [{ tipo: 'leve-x-pague-y', valor: { leve: 21, pague: 20 } }, 'valor'], [{ tipo: 'leve-x-pague-y', valor: { leve: 2 } }, 'valor'],
      [{ tipo: 'leve-x-pague-y', valor: 3 }, 'valor'], [{ tipo: 'brinde', valor: { produto: 'dr-pepper', qtd: 1 } }, 'valor'], [{ tipo: 'brinde', valor: { produto: 'nao-existe', qtd: 1 } }, 'valor'],
      [{ tipo: 'brinde', valor: { produto: 'isqueiro-clipper', qtd: 11 } }, 'valor'], [{ tipo: 'brinde', valor: { produto: 'copo-de-whisky', qtd: 1 } }, 'valor'],
      [{ aplicaA: {} }, 'aplicaA'], [{ aplicaA: [] }, 'aplicaA'], [{ aplicaA: { produtos: ['jack-daniels-old-no7-1l'] } }, 'aplicaA'], [{ aplicaA: { produtos: ['copo-de-whisky'] } }, 'aplicaA'],
      [{ aplicaA: { categorias: ['destilados'] } }, 'aplicaA'], [{ aplicaA: { categorias: ['nao-existe'] } }, 'aplicaA'], [{ aplicaA: { produtos: ['nao-existe'] } }, 'aplicaA'], [{ aplicaA: { produtos: 'x' } }, 'aplicaA'],
      [{ titulo: 'A' }, 'titulo'], [{ descricao: 'x'.repeat(41) }, 'descricao'], [{ regra: 'A' }, 'regra'], [{ comoUsar: 'x'.repeat(161) }, 'comoUsar'],
      [{ peso: 0 }, 'peso'], [{ peso: 1001 }, 'peso'], [{ validadeDias: 0 }, 'validadeDias'], [{ validadeDias: 31 }, 'validadeDias'], [{ ativo: 'sim' }, 'ativo'], [{ demo: 1 }, 'demo'],
    ]) {
      const x = await dono.post('admin-premio-salvar', { ...base1, ...mudar })
      erro(x, 400, 'invalido', `prêmio: recusa ${JSON.stringify(mudar).slice(0, 70)}`)
      igual(x.json.campo, campo, `campo (${JSON.stringify(mudar).slice(0, 70)})`)
    }
    for (const [mudar, campo, termo, lista] of [
      [{ regra: '20% e frete por nossa conta' }, 'regra', 'frete', 'palavras'], [{ descricao: 'Pra larica' }, 'descricao', 'larica', 'palavras'],
      [{ titulo: 'Sorteio da cuia' }, 'titulo', 'sorteio', 'palavras'], [{ comoUsar: 'Vale até o prazo' }, 'comoUsar', 'prazo', 'palavras'], [{ titulo: 'Cigarro de chocolate' }, 'titulo', 'cigarro', 'tabaco'],
    ]) {
      const x = await dono.post('admin-premio-salvar', { ...base1, ...mudar })
      erro(x, 422, 'proibido', `prêmio: recusa ${JSON.stringify(mudar)}`)
      igual([x.json.campo, x.json.termo, x.json.lista], [campo, termo, lista], `campo, termo e lista (${JSON.stringify(mudar)})`)
    }
    igual(await versao(), v, 'nada recusado entrou')

    let x = await dono.post('admin-premio-salvar', base1)
    igual(x.status, 201, 'prêmio criado')
    const p = x.json.premio
    igual([p.id, p.tipo, p.valor, p.aplicaA, p.peso, p.validadeDias, p.ativo, p.demo, p.noSite, p.comoUsar], ['vinte-na-cuia', 'desconto-percentual', 20, { produtos: ['cuia-de-silicone-raw'] }, 10, 5, true, false, true, 'Põe a cuia na sacola e usa o cupom.'], 'campos do prêmio novo')
    const noJogo = async () => (await pub()).loja.sorte.premios.map((x) => x.id)
    ok((await noJogo()).includes('vinte-na-cuia'), 'o site já sorteia o prêmio novo')
    mesmo((await pub()).loja.sorte.premios.find((x) => x.id === 'vinte-na-cuia'), { id: 'vinte-na-cuia', tipo: 'desconto-percentual', valor: 20, titulo: 'Vinte na cuia', descricao: 'A cuia mais em conta.', regra: '20% de desconto na Cuia de silicone RAW', aplicaA: { produtos: ['cuia-de-silicone-raw'] }, comoUsar: 'Põe a cuia na sacola e usa o cupom.', peso: 10, validadeDias: 5, demo: false }, 'no site: o Premio de src/dados/sorte.ts')
    await temEvento('premio-criado', 'Criou o prêmio "Vinte na cuia"', 'criar prêmio')
    x = await dono.post('admin-premio-salvar', { id: 'vinte-na-cuia', ativo: false })
    igual([x.json.premio.ativo, x.json.premio.noSite], [false, false], 'tira do jogo')
    ok(!(await noJogo()).includes('vinte-na-cuia'), 'o site não sorteia')
    await temEvento('premio-desativado', 'Tirou do jogo o prêmio "Vinte na cuia"', 'tirar do jogo')
    await dono.post('admin-premio-salvar', { id: 'vinte-na-cuia', ativo: true })
    await dono.post('admin-produto-salvar', { id: 'cuia-de-silicone-raw', ativo: false })
    igual((await adm()).sorte.premios.find((x) => x.id === 'vinte-na-cuia').noSite, false, 'produto do prêmio fora do site: o prêmio sai do jogo sozinho')
    ok(!(await noJogo()).includes('vinte-na-cuia'), 'e o site não sorteia')
    await dono.post('admin-produto-salvar', { id: 'cuia-de-silicone-raw', ativo: true })
    ok((await noJogo()).includes('vinte-na-cuia'), 'produto de volta: o prêmio volta')
    erro(await dono.post('admin-premio-salvar', { id: 'vinte-na-cuia', tipo: 'leve-x-pague-y' }), 400, 'invalido', 'trocar o tipo sem o valor novo')
    igual((await dono.post('admin-premio-salvar', { id: 'vinte-na-cuia', tipo: 'leve-x-pague-y', valor: { leve: 3, pague: 2 } })).json.premio.valor, { leve: 3, pague: 2 }, 'trocar o tipo com o valor novo')
    erro(await dono.post('admin-premio-salvar', { id: 'nao-existe', peso: 2 }), 404, 'nao-encontrado', 'editar prêmio que não existe')

    // brinde num acessório: o produto do brinde não vira bebida
    x = await dono.post('admin-premio-salvar', {
      tipo: 'brinde', valor: { produto: 'isqueiro-bic-mini', qtd: 2 }, titulo: 'Isqueiro de brinde', descricao: 'Vem junto com a seda.', regra: '2 Isqueiro Bic Mini de brinde no pedido com seda',
      aplicaA: { categorias: ['sedas'] }, peso: 5, validadeDias: 3,
    })
    igual([x.status, x.json.premio.valor, x.json.premio.noSite], [201, { produto: 'isqueiro-bic-mini', qtd: 2 }, true], 'brinde de 2 isqueiros em pedido com seda')
    let y = await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', categoria: 'bebidas' })
    erro(y, 400, 'invalido', 'produto do brinde não vai pra categoria de bebida')
    igual(y.json.campo, 'categoria', 'campo categoria')
    y = await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', nome: 'Isqueiro Rum' })
    erro(y, 400, 'invalido', 'produto do brinde não ganha nome de bebida alcoólica')
    igual(y.json.campo, 'nome', 'campo nome')
    y = await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', categoria: 'destilados' })
    erro(y, 400, 'invalido', 'a OCB (prêmio) não vai pra destilados')
    igual((await dono.post('admin-produto-salvar', { id: 'cuia-de-silicone-raw', nome: 'Cuia de silicone RAW' })).status, 200, 'produto de prêmio sem nada de bebida salva normal')
    igual((await dono.post('admin-premio-apagar', { id: 'isqueiro-de-brinde' })).status, 200, 'apaga o prêmio do brinde')
    igual((await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', categoria: 'bebidas' })).status, 200, 'sem prêmio, o isqueiro pode ir pra qualquer categoria')
    await dono.post('admin-produto-salvar', { id: 'isqueiro-bic-mini', categoria: 'acessorios' })
    igual((await dono.post('admin-premio-apagar', { id: 'vinte-na-cuia' })).status, 200, 'apaga o prêmio')
    erro(await dono.post('admin-premio-apagar', { id: 'vinte-na-cuia' }), 404, 'nao-encontrado', 'apagado não existe mais')
    await temEvento('premio-apagado', 'Apagou o prêmio "Vinte na cuia"', 'apagar prêmio')
    // um prêmio de verdade com brinde de produto de exemplo (fica pro "apagar dados de exemplo")
    x = await dono.post('admin-premio-salvar', {
      tipo: 'brinde', valor: { produto: 'isqueiro-clipper', qtd: 1 }, titulo: 'Clipper de brinde', descricao: 'Um Clipper junto com a OCB.', regra: '1 Isqueiro Clipper de brinde no pedido com Seda OCB',
      aplicaA: { produtos: ['seda-ocb-premium-slim'] }, peso: 5, validadeDias: 7,
    })
    igual(x.status, 201, 'prêmio de verdade com brinde de produto de exemplo')
    igual((await dono.post('admin-produto-apagar', { id: 'copo-de-whisky' })).status, 200, 'apaga o copo')

    // bebida de marca fora da categoria de bebida (o nome não diz "whisky") e desenho de garrafa: nem brinde, nem alvo
    const alcoolicos = []
    for (const [nome, arte] of [
      ['Jack Daniels Honey', null], ["Jack Daniel's Fire", null], ['Smirnoff Ice', null], ['Heineken long neck', null], ['Chope Brahma', null], ['Saquê Azuma', null],
      ['Skol Beats', null], ['Campari 900ml', null], ['Garrafinha da casa', { tipo: 'garrafa-gin', corpo: '#2a6b3c' }], ['Lata alta da casa', { tipo: 'lata-alta', corpo: '#2a6b3c' }],
    ]) {
      const r = await dono.post('admin-produto-salvar', { nome, categoria: 'acessorios', preco: 50, ...(arte ? { arte } : {}) })
      igual(r.status, 201, `"${nome}" entra em acessórios`)
      alcoolicos.push([nome, r.json.produto.id])
    }
    const v2 = await versao()
    for (const [nome, id] of alcoolicos) {
      const b = await dono.post('admin-premio-salvar', { ...base1, tipo: 'brinde', valor: { produto: id, qtd: 1 }, aplicaA: { categorias: ['acessorios'] }, titulo: `Brinde ${id}`.slice(0, 60) })
      erro(b, 400, 'invalido', `"${nome}" não vira brinde`)
      igual(b.json.campo, 'valor', `campo do brinde "${nome}"`)
      const a = await dono.post('admin-premio-salvar', { ...base1, aplicaA: { produtos: [id] }, titulo: `Vale ${id}`.slice(0, 60) })
      erro(a, 400, 'invalido', `"${nome}" não é alvo de prêmio`)
    }
    igual(await versao(), v2, 'nenhum prêmio com bebida entrou')
    for (const [, id] of alcoolicos) await dono.post('admin-produto-apagar', { id })
    // o produto de um prêmio não ganha desenho de bebida
    y = await dono.post('admin-produto-salvar', { id: 'isqueiro-clipper', arte: { tipo: 'garrafa-quadrada', corpo: '#ffffff' } })
    erro(y, 400, 'invalido', 'o brinde do prêmio não ganha desenho de garrafa')
    igual(y.json.campo, 'arte', 'campo arte')
  }

  parte('loja: Atividade')
  {
    const ev = await eventos()
    const daLoja = ev.filter((e) => /^(produto|categoria|estado|premio|stories|loja|sorte|produtos|categorias)-/.test(e.acao) && e.acao !== 'loja-semeada')
    ok(daLoja.length > 20 && daLoja.every((e) => e.usuario === 'dono' && e.texto.length > 0 && !e.texto.includes('undefined')), `cada mudança da loja na Atividade, com quem fez (${daLoja.length})`)
  }
}

/** Banco de antes da loja (só a migração 1 da base, no PRAGMA user_version): a migração por número põe a loja. */
export async function lojaMigracao(t) {
  const { ok, igual, parte, raiz, PHP, tmp } = t
  parte('loja: migração num banco de antes')
  const portaA = process.env.GC_TESTE_PORTA ? t.porta + 4 : await t.portaLivre()
  const portaB = process.env.GC_TESTE_PORTA ? t.porta + 5 : await t.portaLivre()
  const dirA = join(tmp, 'loja-legado')
  const dirB = join(tmp, 'loja-vazio')
  mkdirSync(dirA, { recursive: true })
  mkdirSync(dirB, { recursive: true })
  // o banco de antes: as tabelas da base, user_version = 1, sem a tabela migracoes, com o dono instalado
  execFileSync(PHP, [
    '-r',
    `define('GC_API', 1); require $argv[1] . '/nucleo/banco.php';
     $db = new PDO('sqlite:' . $argv[2]);
     $db->exec(gc_migracoes_base()[1]);
     $db->exec('PRAGMA user_version = 1');
     $t = time();
     $db->prepare("INSERT INTO usuarios (login, nome, senha_hash, papel, criado_em, senha_em) VALUES ('dono', 'Dono', ?, 'dono', ?, ?)")->execute([password_hash('senha-forte-123', PASSWORD_DEFAULT), $t, $t]);`,
    join(raiz, 'public', 'api'),
    join(dirA, 'loja.sqlite'),
  ])
  const banco = (arq) =>
    JSON.parse(
      execFileSync(PHP, ['-r', '$d = new PDO("sqlite:" . $argv[1]); echo json_encode([array_map("intval", $d->query("SELECT numero FROM migracoes ORDER BY numero")->fetchAll(PDO::FETCH_COLUMN)), (int) $d->query("PRAGMA user_version")->fetchColumn(), (int) $d->query("SELECT COUNT(*) FROM eventos WHERE acao = \'loja-semeada\'")->fetchColumn()]);', arq], { encoding: 'utf8' }),
    )
  const filhos = []
  try {
    filhos.push(await t.subirPhp(portaA, { GC_TESTE: '1', GC_DADOS: dirA, GC_UPLOADS: join(dirA, 'up') }, ['-t', join(raiz, 'public'), join(raiz, 'scripts', 'api-dev.php')]))
    const bA = `http://127.0.0.1:${portaA}`
    const r = await fetch(`${bA}/api/index.php?r=loja`)
    const j = await r.json()
    igual([r.status, j.versao, j.loja?.produtos?.length, j.loja?.estados?.length, j.loja?.sorte?.premios?.length], [200, 1, 17, 5, 5], 'banco já instalado: a migração 101 semeia a loja')
    igual(banco(join(dirA, 'loja.sqlite')), [[1, 100, 101], 1, 1], 'registro com 1 (a de antes), 100 e 101; user_version segue 1 (a base); semeou uma vez')
    await fetch(`${bA}/api/index.php?r=loja`).then((x) => x.text())
    igual(banco(join(dirA, 'loja.sqlite'))[2], 1, 'pedir de novo não semeia de novo')
    // banco novo, sem ninguém instalado: a 101 roda e não semeia; a instalação semeia
    filhos.push(await t.subirPhp(portaB, { GC_TESTE: '1', GC_DADOS: dirB, GC_UPLOADS: join(dirB, 'up') }, ['-t', join(raiz, 'public'), join(raiz, 'scripts', 'api-dev.php')]))
    const bB = `http://127.0.0.1:${portaB}`
    const s0 = await fetch(`${bB}/api/index.php?r=loja`)
    igual([s0.status, (await s0.json()).erro], [404, 'sem-loja'], 'banco novo sem instalação: 404 sem-loja')
    igual(banco(join(dirB, 'loja.sqlite')), [[1, 100, 101], 1, 0], 'banco novo: todas as migrações anotadas, nada semeado')
    const inst = await fetch(`${bB}/api/index.php?r=admin-instalar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: bB, 'X-GC-IP': '198.51.100.200' },
      body: JSON.stringify({ codigo: 'dev-instalar-greencheese', login: 'dono', nome: 'Dono', senha: 'senha-forte-123' }),
    })
    igual(inst.status, 201, 'instala')
    const s1 = await fetch(`${bB}/api/index.php?r=loja`)
    igual([s1.status, (await s1.json()).loja?.produtos?.length], [200, 17], 'a instalação semeia a loja')
    igual(banco(join(dirB, 'loja.sqlite'))[2], 1, 'uma vez')
    ok(readFileSync(join(raiz, 'public/api/nucleo/loja-migracoes.php'), 'utf8').includes('100 =>'), 'as migrações da loja ficam na faixa 100–199')
  } finally {
    filhos.forEach(t.derrubar)
  }
}

/**
 * No fim: "apagar dados de exemplo" (conferir primeiro, depois apagar de uma vez, só o que a prévia mostrou). Alguém
 * entra num rateio de exemplo entre a prévia e o toque: nada sai (409 mudou, com o plano novo). Rateio de exemplo em que
 * alguém pagou nunca apaga: fica, como rateio de verdade.
 */
export async function lojaExemplos(t) {
  const { ok, igual, erro, parte, dono, site } = t
  parte('loja: apagar dados de exemplo')
  const pub = async () => (await site().get('loja')).json
  const adm = async () => (await dono.get('admin-loja')).json.loja
  const conferir = async () => {
    const c = await dono.post('admin-loja-exemplos-apagar', { conferir: true })
    igual([c.status, c.json.apagou, typeof c.json.assinatura], [200, false, 'string'], 'conferir mostra o plano e a assinatura dele')
    return c.json
  }
  // story com um produto de exemplo: sai junto com ele
  await dono.post('admin-stories-salvar', { uf: 'sp', produtos: ['seda-raw-classic-king-size', 'seda-ocb-premium-slim'] })
  const antes = await pub()
  erro(await dono.post('admin-loja-exemplos-apagar', { conferir: 'sim' }), 400, 'invalido', 'conferir que não é sim/não')
  const c = await conferir()
  const plano = c.plano
  igual(Object.keys(plano).sort(), ['desativar', 'manter', 'premios', 'produtos', 'rateios'], 'o plano: prêmios, rateios, o que fica, produtos e o que só sai do site')
  const a0 = await adm()
  const demos = a0.produtos.filter((p) => p.demo)
  igual(plano.premios.map((p) => p.id).sort(), a0.sorte.premios.filter((p) => p.demo).map((p) => p.id).sort(), 'todos os prêmios de exemplo')
  ok(plano.produtos.every((p) => demos.some((d) => d.id === p.id)), 'só produto de exemplo sai')
  ok(plano.produtos.some((p) => p.id === 'seda-raw-classic-king-size') && plano.produtos.some((p) => p.id === 'arizona-green-tea'), 'sai produto de exemplo (até o do rateio de exemplo, que sai junto)')
  igual(plano.desativar.map((p) => p.id), ['isqueiro-clipper'], 'produto de exemplo que é brinde de um prêmio de verdade: só sai do site')
  ok(plano.rateios.every((r) => typeof r.pessoas === 'number'), 'rateios de exemplo com quantas pessoas entraram')
  igual(plano.manter, [], 'nenhum rateio de exemplo com gente que pagou (ainda)')
  igual((await pub()).versao, antes.versao, 'conferir não mexe em nada')
  // apagar sem a assinatura da prévia, ou com uma que não bate: nada sai
  const sem = await dono.post('admin-loja-exemplos-apagar', {})
  erro(sem, 400, 'invalido', 'apagar sem conferir antes')
  igual(sem.json.campo, 'assinatura', 'campo assinatura')
  const torta = await dono.post('admin-loja-exemplos-apagar', { assinatura: 'x'.repeat(24) })
  erro(torta, 409, 'mudou', 'assinatura que não bate')
  ok(torta.json.plano && typeof torta.json.assinatura === 'string', 'o 409 traz o plano novo e a assinatura dele')
  // corrida: alguém entra no rateio de exemplo (o site mostra como rateio de verdade) depois da prévia
  const alvo = plano.rateios.find((r) => r.id === 'arizona-green-tea')
  ok(!!alvo, 'o Arizona (rateio de exemplo) tá no plano')
  const e = await site().post('rateio-entrar', { rateio: 'arizona-green-tea', nome: 'Cliente Pagante', whatsapp: '(31) 98888-7766', uf: 'mg', quantidade: 1 })
  igual(e.status, 201, 'cliente entra no rateio de exemplo depois da prévia')
  const velha = await dono.post('admin-loja-exemplos-apagar', { assinatura: c.assinatura })
  erro(velha, 409, 'mudou', 'apagar com a prévia velha: mudou, nada sai')
  igual(velha.json.plano.rateios.find((r) => r.id === 'arizona-green-tea')?.pessoas, alvo.pessoas + 1, 'o plano novo mostra a pessoa que entrou')
  igual((await pub()).versao, antes.versao, 'nada saiu')
  igual((await dono.get('admin-participantes', { query: '&rateio=arizona-green-tea' })).status, 200, 'o rateio continua lá')
  // ela paga: o rateio de exemplo não apaga mais, fica (vira de verdade) com o histórico
  const pessoa = (await dono.get('admin-participantes', { query: '&rateio=arizona-green-tea' })).json.participantes.find((x) => x.nome === 'Cliente Pagante')
  igual((await dono.post('admin-participante-status', { id: pessoa.id, status: 'confirmado' })).status, 200, 'dono confirma o pagamento')
  const c2 = await conferir()
  igual(c2.plano.manter.map((r) => [r.id, r.pagas]), [['arizona-green-tea', 1]], 'rateio de exemplo com pagamento: fica')
  ok(!c2.plano.rateios.some((r) => r.id === 'arizona-green-tea'), 'e não está entre os que saem')
  ok(c2.plano.desativar.some((p) => p.id === 'arizona-green-tea') && !c2.plano.produtos.some((p) => p.id === 'arizona-green-tea'), 'o produto dele só sai do site (tem histórico de verdade)')
  const a = await dono.post('admin-loja-exemplos-apagar', { assinatura: c2.assinatura })
  igual([a.status, a.json.apagou], [200, true], 'apagou com a prévia certa')
  const fica = await dono.get('admin-participantes', { query: '&rateio=arizona-green-tea' })
  ok(fica.status === 200 && fica.json.participantes.some((x) => x.nome === 'Cliente Pagante' && x.status === 'confirmado'), 'quem pagou continua no rateio (o registro não se perde)')
  igual((await site().get('rateios')).json.rateios.find((r) => r.id === 'arizona-green-tea')?.demo, false, 'o rateio que ficou é de verdade agora')
  const l = await pub()
  ok(l.loja.produtos.length > 0 && l.loja.produtos.every((p) => p.demo === false), 'o site fica só com produto de verdade')
  ok(l.loja.sorte.premios.every((p) => p.demo === false), 'e só com prêmio de verdade')
  igual(l.loja.stories.sp, ['seda-ocb-premium-slim'], 'o produto de exemplo sai do story junto')
  ok(!(await site().get('rateios')).json.rateios.some((r) => r.demo), 'nenhum rateio de exemplo no site')
  const a1 = await adm()
  igual(a1.produtos.filter((p) => p.demo).map((p) => [p.id, p.ativo]).sort(), [['arizona-green-tea', false], ['isqueiro-clipper', false]], 'no painel ficam o Clipper e o Arizona (fora do site, com o histórico)')
  igual(a1.sorte.premios.map((p) => [p.id, p.noSite]), [['clipper-de-brinde', false]], 'o prêmio de verdade continua, fora do jogo enquanto o brinde dele tá fora do site')
  ok(!l.loja.sorte.premios.some((p) => p.id === 'clipper-de-brinde'), 'e o site não sorteia ele')
  const ev = (await dono.get('admin-eventos')).json.eventos
  const n = (k, um, varios) => (c2.plano[k].length === 0 ? null : `${c2.plano[k].length} ${c2.plano[k].length === 1 ? um : varios}`)
  const texto = `Apagou os dados de exemplo (${[n('produtos', 'produto', 'produtos'), n('premios', 'prêmio', 'prêmios'), n('rateios', 'rateio', 'rateios')].filter(Boolean).join(', ')}); 1 rateio com pagamento ficou`
  ok(ev.some((e) => e.acao === 'loja-exemplos-apagados' && e.texto === texto && e.usuario === 'dono'), `na Atividade: "${texto}"`)
  const c3 = await conferir()
  igual([c3.plano.produtos, c3.plano.premios, c3.plano.rateios, c3.plano.desativar, c3.plano.manter], [[], [], [], [], []], 'de novo: nada mais pra apagar')
  const de2 = await dono.post('admin-loja-exemplos-apagar', { assinatura: c3.assinatura })
  igual([de2.status, de2.json.versao], [200, a.json.versao], 'e a versão não sobe')
}
