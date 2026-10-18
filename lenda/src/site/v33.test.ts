/**
 * Site v3.3 (servidor/CONTRATO-v33.md §B): desafios ("As Taças do Rei"), e-mail verificado, Fale conosco, perfil público,
 * as rotas novas e a verificação por replay pelo admin (#/verificar). A rede é um fetch de mentira; a verificação joga
 * uma carreira real de uma fila de gravação pelo motor e manda o resultado como a tela manda.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { careerEngine } from '@/engine/career/default'
import { LEGACY_VERSION } from '@/engine/legacy/score'
import { motivoCurto, resultadoParaServidor, verificarCarreira } from '@/engine/verificar'
import type { GameData, Pace, PlayerIdentity } from '@/engine/types'
import { portaoDaRota, rotaDeAdmin, rotaFechada, type Acesso } from '@/store/acesso'
import { BASE_ROUTES, buildHash, parseHash, SITE_ROUTES } from '@/store/app'
import { computeLegacy, randomSeed, useCareer, type HallEntry } from '@/store/career'
import { useData } from '@/store/data'
import { mensagemDeErro } from './api'
import { normalizarUsuario, useConta } from './conta'
import { criterioEmFrase, itensRequisitos, normalizarCriterio, normalizarDesafio, normalizarLista, normalizarMeus, normalizarRequisitos, REQUISITOS_PADRAO, temDesafioAtivo, textoCriterio, useDesafios, valendo } from './desafios'
import { normalizarCarreiraPublica } from './hallPublico'
import { linkPerfil } from './indicacao'
import { normalizarPerfil, usePerfis } from './perfil'
import { corpoSuporte, EMAIL_CONTATO, erroMensagem, erroPedido, enviarSuporte } from './suporte'
import { abrirSuporte, abrirVerificarEmail, useSiteUi } from './ui'
import { paginaAtual } from './FaleConosco'
import { useApp } from '@/store/app'
import { alvoDoResultado, buscarCarreiraAdmin, mandarResultado, normalizarCandidatos } from './verificacao'
import { telaAtual } from './vigias'

const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
function rede(responder: (url: string, metodo: string, corpo: string) => Response | Promise<Response>) {
  const f = vi.fn(async (u: string | URL | Request, init?: RequestInit) => responder(String(u), init?.method ?? 'GET', typeof init?.body === 'string' ? init.body : ''))
  vi.stubGlobal('fetch', f)
  return f
}
const acesso = (o: Partial<Acesso> = {}): Acesso => ({
  admin: false,
  adminStatus: 'nao',
  configPronta: true,
  livePublica: false,
  imersivoPublico: false,
  manutencao: false,
  cadastroAberto: true,
  aviso: null,
  avisos: [],
  logado: false,
  tester: false,
  verificarAdmin: null,
  ...o,
})
const DIA = 86_400_000
const desafioBase = {
  slug: 'tacas-do-rei',
  titulo: 'As Taças do Rei',
  descricao: 'O primeiro a juntar 3 Copas do Mundo e 2 Libertadores numa carreira.',
  regulamento: '1. Vale uma conta por pessoa.',
  premio: 'A definir pelo admin',
  criterio: { copas: 3, libertadores: 2 },
  requisitos: { partidasMin: 30, emailVerificado: true, publicadoNoHall: true, top3Perfil: true },
  ativo: true,
  inicio: '2026-10-01T00:00:00Z',
  fim: null,
  vencedor: null,
  pendentes: 2,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ───────────────────────────── rotas ─────────────────────────────

describe('rotas novas (#/desafios, #/jogador/<código>, #/verificar)', () => {
  const site = [...BASE_ROUTES, ...SITE_ROUTES]
  it('#/jogador/<código> vira /jogador com o código na query; o resto da query fica', () => {
    expect(parseHash('#/jogador/ABCD2345', site)).toEqual({ path: '/jogador', query: { codigo: 'ABCD2345' } })
    expect(parseHash('#/jogador/ABCD2345?x=1', site)).toEqual({ path: '/jogador', query: { x: '1', codigo: 'ABCD2345' } })
    expect(parseHash('#/jogador?codigo=ZZ99', site)).toEqual({ path: '/jogador', query: { codigo: 'ZZ99' } })
    expect(parseHash('#/desafios', site).path).toBe('/desafios')
    expect(parseHash('#/verificar?id=12&candidato=3', site)).toEqual({ path: '/verificar', query: { id: '12', candidato: '3' } })
    // código estranho chega como veio (a tela confere e diz "não encontrado"); % quebrado não derruba
    expect(parseHash('#/jogador/%E0%A4%A', site).query.codigo).toBe('%E0%A4%A')
  })
  it('fora do site as rotas novas não existem (viram "/")', () => {
    expect(parseHash('#/desafios', BASE_ROUTES).path).toBe('/')
    expect(parseHash('#/jogador/ABCD2345', BASE_ROUTES).path).toBe('/')
    expect(parseHash('#/verificar?id=1', BASE_ROUTES).path).toBe('/')
  })
  it('buildHash do perfil é o endereço curto, e volta igual', () => {
    expect(buildHash('/jogador', { codigo: 'ABCD2345' })).toBe('#/jogador/ABCD2345')
    expect(buildHash('/jogador', { codigo: 'ABCD2345', de: 'hall' })).toBe('#/jogador/ABCD2345?de=hall')
    expect(parseHash(buildHash('/jogador', { codigo: 'ABCD2345' }), site)).toEqual({ path: '/jogador', query: { codigo: 'ABCD2345' } })
    expect(buildHash('/desafios')).toBe('#/desafios')
  })
  it('#/verificar só abre para o admin (nem a conta de testes); conta como rota de admin para perguntar ao servidor', () => {
    const r = { path: '/verificar' as const, query: { id: '5' } }
    expect(rotaFechada(r, acesso(), true)).toBe(true)
    expect(rotaFechada(r, acesso({ tester: true }), true)).toBe(true)
    expect(rotaFechada(r, acesso({ admin: true, adminStatus: 'sim' }), true)).toBe(false)
    expect(portaoDaRota(r, acesso(), true)).toBe('nao-encontrada')
    expect(portaoDaRota(r, acesso({ adminStatus: 'verificando' }), true)).toBe('verificar')
    expect(portaoDaRota(r, acesso({ admin: true, adminStatus: 'sim' }), true)).toBe('ok')
    expect(rotaDeAdmin(r)).toBe(true)
    // desafios e perfil são públicos
    expect(portaoDaRota({ path: '/desafios', query: {} }, acesso(), true)).toBe('ok')
    expect(portaoDaRota({ path: '/jogador', query: { codigo: 'X1Y2' } }, acesso(), true)).toBe('ok')
    // fora do site, tudo como sempre
    expect(rotaFechada(r, acesso(), false)).toBe(false)
  })
  it('a tela de agora na medição: Fale conosco e confirmar e-mail (no formato que o e.php aceita)', () => {
    abrirSuporte('ideia')
    expect(telaAtual()).toBe('/fale-conosco')
    abrirVerificarEmail(true)
    expect(telaAtual()).toBe('/conta/verificar')
    expect(useSiteUi.getState().dialogo).toEqual({ tipo: 'verificar', depoisDoCadastro: true })
    useSiteUi.getState().fechar()
    for (const t of ['/fale-conosco', '/conta/verificar', '/desafios', '/jogador', '/verificar']) expect(t).toMatch(/^\/[a-z0-9/_-]{0,23}$/)
  })
})

// ───────────────────────────── e-mail verificado ─────────────────────────────

describe('e-mail verificado', () => {
  beforeEach(() => {
    useConta.setState({ usuario: normalizarUsuario({ id: 7, apelido: 'Teste', email: 'a@b.com', emailVerificado: false }), lembrado: 'Teste', status: 'pronto' })
  })
  it('U.emailVerificado: false só quando o servidor diz false (servidor antigo, sem o campo = confirmado)', () => {
    expect(normalizarUsuario({ apelido: 'X' })?.emailVerificado).toBe(true)
    expect(normalizarUsuario({ apelido: 'X', emailVerificado: false })?.emailVerificado).toBe(false)
    expect(normalizarUsuario({ apelido: 'X', emailVerificado: true })?.emailVerificado).toBe(true)
    expect(normalizarUsuario({ apelido: 'X', emailVerificado: 0 })?.emailVerificado).toBe(true)
  })
  it('verificar_email manda só os 6 dígitos e a conta fica confirmada', async () => {
    const f = rede((_u, _m, corpo) => {
      expect(JSON.parse(corpo)).toEqual({ acao: 'verificar_email', codigo: '123456' })
      return resposta(200, { usuario: { id: 7, apelido: 'Teste', email: 'a@b.com' } })
    })
    const u = await useConta.getState().verificarEmail(' 12-34-56 ')
    expect(f).toHaveBeenCalledTimes(1)
    expect(u.emailVerificado).toBe(true)
    expect(useConta.getState().usuario?.emailVerificado).toBe(true)
  })
  it('código errado: 400 codigo_invalido com mensagem pt-BR; a conta continua não confirmada', async () => {
    rede(() => resposta(400, { erro: 'codigo_invalido' }))
    await expect(useConta.getState().verificarEmail('000000')).rejects.toMatchObject({ codigo: 'codigo_invalido' })
    expect(useConta.getState().usuario?.emailVerificado).toBe(false)
    expect(mensagemDeErro(await useConta.getState().verificarEmail('000000').catch((e) => e))).toMatch(/Código errado ou vencido/)
  })
  it('reenviar: {ok:true} manda outro código; jaVerificado marca a conta; 429 vira erro de limite', async () => {
    rede(() => resposta(200, { ok: true }))
    expect(await useConta.getState().reenviarVerificacao()).toBe(false)
    rede(() => resposta(200, { ok: true, jaVerificado: true }))
    expect(await useConta.getState().reenviarVerificacao()).toBe(true)
    expect(useConta.getState().usuario?.emailVerificado).toBe(true)
    rede(() => resposta(429, { erro: 'limite' }))
    await expect(useConta.getState().reenviarVerificacao()).rejects.toMatchObject({ codigo: 'limite', status: 429 })
  })
})

// ───────────────────────────── Fale conosco ─────────────────────────────

describe('Fale conosco', () => {
  it('confere tipo, mensagem (10 a 2000) e o e-mail obrigatório sem conta', () => {
    expect(erroMensagem('curta')).toMatch(/pelo menos 10/)
    expect(erroMensagem('x'.repeat(2001))).toMatch(/2000/)
    expect(erroMensagem('  uma mensagem boa  ')).toBeNull()
    const p = { tipo: 'ideia' as const, mensagem: 'Pôr a Série C do Brasil', email: '' }
    expect(erroPedido(p, false)).toMatch(/e-mail/)
    expect(erroPedido({ ...p, email: 'eu@x.com' }, false)).toBeNull()
    expect(erroPedido(p, true)).toBeNull()
    expect(erroPedido({ ...p, tipo: 'spam' as never }, true)).toMatch(/assunto/)
  })
  it('a página que vai junto é a rota do jogo por baixo do diálogo (não o próprio Fale conosco)', () => {
    useApp.getState()._setRoute({ path: '/resumo', query: { id: 'career-abc', de: 'comunidade' } })
    abrirSuporte()
    expect(paginaAtual()).toBe('/resumo?id=career-abc&de=comunidade')
    useApp.getState()._setRoute({ path: '/jogador', query: { codigo: 'ABCD2345' } })
    expect(paginaAtual()).toBe('/jogador/ABCD2345')
    useApp.getState()._setRoute({ path: '/resumo', query: { id: 'x'.repeat(300) } })
    expect(paginaAtual().length).toBe(120)
    useSiteUi.getState().fechar()
    useApp.getState()._setRoute({ path: '/', query: {} })
  })
  it('o corpo: sem e-mail quando logado; a isca vai como veio; pagina cortada', () => {
    expect(corpoSuporte({ tipo: 'duvida', mensagem: '  Como salvo?  ', email: 'eu@x.com', pagina: '/hall' }, true)).toEqual({ tipo: 'duvida', mensagem: 'Como salvo?', pagina: '/hall' })
    expect(corpoSuporte({ tipo: 'outro', mensagem: 'Oi, tudo bem por aí?', email: ' eu@x.com ', site: 'http://spam' }, false)).toEqual({ tipo: 'outro', mensagem: 'Oi, tudo bem por aí?', email: 'eu@x.com', site: 'http://spam' })
    expect(EMAIL_CONTATO).toBe('contato@oprojeto.online')
  })
  it('201 {ok, protocolo} → o protocolo; protocolo estranho fica de fora; 429 é limite', async () => {
    const f = rede((u, m, corpo) => {
      expect(u).toMatch(/\/api\/suporte\.php$/)
      expect(m).toBe('POST')
      expect(JSON.parse(corpo).tipo).toBe('problema')
      return resposta(201, { ok: true, protocolo: 'ABCD2345' })
    })
    expect(await enviarSuporte({ tipo: 'problema', mensagem: 'A tela travou no fim da carreira' }, true)).toEqual({ protocolo: 'ABCD2345' })
    expect(f).toHaveBeenCalledTimes(1)
    rede(() => resposta(201, { ok: true, protocolo: '<b>x</b>' }))
    expect(await enviarSuporte({ tipo: 'problema', mensagem: 'A tela travou no fim da carreira' }, true)).toEqual({ protocolo: null })
    rede(() => resposta(429, { erro: 'limite' }))
    await expect(enviarSuporte({ tipo: 'problema', mensagem: 'A tela travou no fim da carreira' }, true)).rejects.toMatchObject({ codigo: 'limite' })
  })
})

// ───────────────────────────── desafios ─────────────────────────────

describe('desafios', () => {
  const agora = Date.parse('2026-10-18T12:00:00Z')
  it('o desafio é conferido campo a campo (critério e requisitos também em texto JSON)', () => {
    const d = normalizarDesafio(desafioBase, agora)!
    expect(d).toMatchObject({ slug: 'tacas-do-rei', titulo: 'As Taças do Rei', criterio: { copas: 3, libertadores: 2 }, requisitos: REQUISITOS_PADRAO, ativo: true, encerrado: false, pendentes: 2, premio: 'A definir pelo admin' })
    expect(normalizarDesafio({ ...desafioBase, criterio: '{"copas":3}', requisitos: '{"partidasMin":10,"top3Perfil":false}' }, agora)).toMatchObject({ criterio: { copas: 3 }, requisitos: { partidasMin: 10, top3Perfil: false, emailVerificado: true } })
    expect(normalizarCriterio({ copas: 0, libertadores: -1, todasConquistas: 'sim' })).toEqual({})
    expect(normalizarCriterio({ todasConquistas: true })).toEqual({ todasConquistas: true })
    expect(normalizarRequisitos(null)).toEqual(REQUISITOS_PADRAO)
    expect(normalizarDesafio({ ...desafioBase, slug: 'Tacas Do Rei' })).toBeNull()
    expect(normalizarDesafio({ ...desafioBase, titulo: '   ' })).toBeNull()
    expect(normalizarDesafio({ ...desafioBase, premio: null })?.premio).toBe('')
  })
  it('valendo: ativo, já começou, sem vencedor e dentro do prazo', () => {
    const d = normalizarDesafio(desafioBase, agora)!
    expect(valendo(d, agora)).toBe(true)
    expect(valendo({ ...d, ativo: false }, agora)).toBe(false)
    expect(valendo({ ...d, inicio: new Date(agora + DIA).toISOString() }, agora)).toBe(false)
    expect(valendo({ ...d, fim: new Date(agora - 1000).toISOString() }, agora)).toBe(false)
    const comVencedor = normalizarDesafio({ ...desafioBase, vencedor: { apelido: 'Rei', jogador: 'PELEZINHO', carreiraId: 'career-x', perfil: 'ABCD2345', em: '2026-10-17T10:00:00Z' } }, agora)!
    expect(comVencedor.encerrado).toBe(true)
    expect(comVencedor.vencedor).toEqual({ apelido: 'Rei', jogador: 'PELEZINHO', carreiraId: 'career-x', perfil: 'ABCD2345', em: '2026-10-17T10:00:00Z' })
    expect(valendo(comVencedor, agora)).toBe(false)
    // conta do vencedor excluída (LGPD): continua vencido, sem nome nem link
    const excluido = normalizarDesafio({ ...desafioBase, encerrado: true, vencedor: { apelido: null, jogador: null, carreiraId: null, perfil: null, em: null, declaradoEm: '2026-10-17T12:00:00Z', excluido: true } }, agora)!
    expect(excluido.vencedor).toEqual({ apelido: 'Conta excluída', jogador: null, carreiraId: null, perfil: null, em: '2026-10-17T12:00:00Z' })
    expect(valendo(excluido, agora)).toBe(false)
    // prazo vencido sem vencedor: encerrado (o servidor diz; sem o campo, a conta é feita aqui)
    expect(normalizarDesafio({ ...desafioBase, fim: '2026-10-10T00:00:00Z' }, agora)?.encerrado).toBe(true)
    expect(normalizarDesafio({ ...desafioBase, encerrado: true }, agora)?.encerrado).toBe(true)
    // perfil estranho no vencedor: sem link
    expect(normalizarDesafio({ ...desafioBase, vencedor: { apelido: 'Rei', perfil: '../x' } }, agora)?.vencedor?.perfil).toBeNull()
    expect(temDesafioAtivo({ lista: [d] })).toBe(true)
    expect(temDesafioAtivo({ lista: [{ ...d, ativo: false }] })).toBe(false)
  })
  it('textos: o critério numa frase e os requisitos do checklist', () => {
    expect(textoCriterio({ copas: 3, libertadores: 2 })).toBe('3 Copas do Mundo e 2 Libertadores numa mesma carreira')
    expect(textoCriterio({ copas: 1 })).toBe('1 Copa do Mundo numa mesma carreira')
    expect(textoCriterio({ todasConquistas: true })).toBe('Desbloquear todas as conquistas do jogo')
    // no meio da frase: só a 1ª letra muda (nunca "copas do mundo")
    expect(criterioEmFrase({ todasConquistas: true })).toBe('desbloquear todas as conquistas do jogo')
    expect(criterioEmFrase({ copas: 3, libertadores: 2 })).toBe('3 Copas do Mundo e 2 Libertadores numa mesma carreira')
    expect(itensRequisitos(REQUISITOS_PADRAO).map((r) => r.chave)).toEqual(['partidasMin', 'emailVerificado', 'publicadoNoHall', 'top3Perfil'])
    expect(itensRequisitos({ ...REQUISITOS_PADRAO, partidasMin: 0, top3Perfil: false }).map((r) => r.chave)).toEqual(['emailVerificado', 'publicadoNoHall'])
  })
  it('?eu=1: aceita o checklist em `eu` (servidor desta rodada) ou direto no item (contrato mínimo)', () => {
    const eu = { partidas: 31, partidasMin: 30, emailVerificado: true, partidasHoje: 4, partidasDiaMax: 100, carreirasQueCumprem: [{ carreiraId: 'career-a', jogador: 'REI', publicada: true, noTop3: false, temReplay: true, vale: false, motivo: 'fora_do_top3', motivoTexto: 'Fora das 3 do perfil' }, { jogador: 'sem id' }], candidato: { estado: 'pendente', motivo: null, em: '2026-10-18T10:00:00Z', carreiraId: 'career-a' } }
    const m = normalizarMeus({ desafios: [{ ...desafioBase, eu }, { slug: 'todas-as-conquistas', partidas: 2, partidasMin: 30, emailVerificado: false, conquistas: 50, conquistasTotal: 87, carreirasQueCumprem: [], candidato: null }] })
    expect(m['tacas-do-rei']).toMatchObject({ partidas: 31, partidasHoje: 4, partidasDiaMax: 100, candidato: { estado: 'pendente', carreiraId: 'career-a' } })
    expect(m['tacas-do-rei'].carreirasQueCumprem).toEqual([{ carreiraId: 'career-a', jogador: 'REI', publicada: true, noTop3: false, temReplay: true, vale: false, motivo: 'Fora das 3 do perfil' }])
    expect(m['todas-as-conquistas']).toMatchObject({ partidas: 2, emailVerificado: false, conquistas: 50, conquistasTotal: 87, candidato: null })
    expect(normalizarMeus({ desafios: [{ slug: 'x', eu: { candidato: { estado: 'pendente' } } }] })).toEqual({})
  })
  it('a lista fica em memória por 60 s; servidor antigo (404) = sem desafios; sem rede, o que já veio continua', async () => {
    useDesafios.setState({ status: 'idle', lista: [], buscadoEm: 0 })
    let n = 0
    rede((u) => {
      n++
      expect(u).toMatch(/\/api\/desafios\.php$/)
      return resposta(200, { desafios: [desafioBase, { slug: 'rascunho' }] })
    })
    expect((await useDesafios.getState().carregar()).map((d) => d.slug)).toEqual(['tacas-do-rei'])
    await useDesafios.getState().carregar()
    expect(n).toBe(1)
    rede(() => Promise.reject(new TypeError('Failed to fetch')))
    expect((await useDesafios.getState().carregar(true)).length).toBe(1)
    useDesafios.setState({ status: 'idle', lista: [], buscadoEm: 0 })
    rede(() => resposta(404, { erro: 'nao_encontrado' }))
    expect(await useDesafios.getState().carregar()).toEqual([])
    expect(useDesafios.getState().status).toBe('pronto')
  })
  it('o checklist é da conta logada: sem conta não pede; ao trocar de conta, some', async () => {
    useConta.setState({ usuario: null, lembrado: null })
    const f = rede(() => resposta(200, { desafios: [] }))
    expect(await useDesafios.getState().carregarMeu()).toBeNull()
    expect(f).not.toHaveBeenCalled()
    useConta.setState({ usuario: normalizarUsuario({ id: 9, apelido: 'Nove' }) })
    rede((u) => {
      expect(u).toMatch(/desafios\.php\?eu=1$/)
      return resposta(200, { desafios: [{ ...desafioBase, eu: { partidas: 5, partidasMin: 30, emailVerificado: true, carreirasQueCumprem: [], candidato: null } }] })
    })
    expect(Object.keys((await useDesafios.getState().carregarMeu())!)).toEqual(['tacas-do-rei'])
    useConta.setState({ usuario: normalizarUsuario({ id: 10, apelido: 'Dez' }) })
    expect(useDesafios.getState().meu).toBeNull()
  })
  it('nenhum texto do jogo diz o que é o prêmio: ele vem do admin', () => {
    const lista = normalizarLista({ desafios: [{ ...desafioBase, premio: '' }] })
    expect(lista[0].premio).toBe('')
    for (const arq of ['DesafiosTela.tsx', 'DestaqueDesafio.tsx', 'desafios.ts', 'ContaMenu.tsx']) {
      const txt = readFileSync(fileURLToPath(new URL(`./${arq}`, import.meta.url)), 'utf8').toLowerCase()
      expect(txt, arq).not.toMatch(/dinheiro|r\$|reais\b|pix\b/)
    }
  })
})

// ───────────────────────────── perfil público ─────────────────────────────

describe('perfil público', () => {
  const carreira = { id: 'career-abc', posicao: 3, apelido: 'Rei', jogador: 'PELEZINHO', numero: 10, pais: 'BRA', posicaoCampo: 'CA', nota: 88, picoOvr: 95, temporadas: 24, gols: 900, titulos: 40, bolasOuro: 6, copas: 3, headline: 'Rei', clubes: ['e1'], bonusOvr: 0, terminouEm: null, destaque: false, perfil: 'ABCD2345' }
  it('o link é o do convite com o hash do perfil', () => {
    expect(linkPerfil('ABCD2345', 'https://oprojeto.online/lenda/')).toBe('https://oprojeto.online/lenda/?c=ABCD2345#/jogador/ABCD2345')
    expect(linkPerfil('../x', 'https://oprojeto.online/lenda/')).toBeNull()
    expect(linkPerfil(null)).toBeNull()
  })
  it('a carreira do Hall traz o código do perfil do dono (servidor antigo: sem)', () => {
    expect(normalizarCarreiraPublica(carreira)?.perfil).toBe('ABCD2345')
    expect(normalizarCarreiraPublica({ ...carreira, perfil: 'x y' })?.perfil).toBeNull()
    expect(normalizarCarreiraPublica({ ...carreira, perfil: undefined })?.perfil).toBeNull()
  })
  it('normalizarPerfil: até 3 carreiras, desafios vencidos só com slug válido', () => {
    const p = normalizarPerfil({ codigo: 'ABCD2345', apelido: 'Rei', desde: '2026-10-01T00:00:00Z', conquistas: 40.4, carreiras: [carreira, carreira, carreira, carreira, { id: '' }], desafiosVencidos: ['tacas-do-rei', '<x>'] }, 'ABCD2345')!
    expect(p).toMatchObject({ codigo: 'ABCD2345', apelido: 'Rei', conquistas: 40, desafiosVencidos: ['tacas-do-rei'] })
    expect(p.carreiras).toHaveLength(3)
    expect(normalizarPerfil({ apelido: '' }, 'X')).toBeNull()
  })
  it('abrir: 404 = não encontrado; código inválido nem chega ao servidor; o perfil fica 2 min em memória', async () => {
    usePerfis.setState({ perfis: {} })
    const f = rede(() => resposta(404, { erro: 'nao_encontrado' }))
    await usePerfis.getState().abrir('ZZZZ9999')
    expect(usePerfis.getState().perfis.ZZZZ9999).toEqual({ status: 'erro', naoEncontrado: true, semRede: false })
    await usePerfis.getState().abrir('a/b')
    expect(f).toHaveBeenCalledTimes(1)
    expect(usePerfis.getState().perfis['a/b']).toMatchObject({ status: 'erro', naoEncontrado: true })
    const g = rede((u) => {
      expect(u).toMatch(/perfil\.php\?c=ABCD2345$/)
      return resposta(200, { codigo: 'ABCD2345', apelido: 'Rei', conquistas: 3, carreiras: [carreira], desafiosVencidos: [] })
    })
    await usePerfis.getState().abrir('ABCD2345')
    await usePerfis.getState().abrir('ABCD2345')
    expect(g).toHaveBeenCalledTimes(1)
    expect(usePerfis.getState().perfis.ABCD2345).toMatchObject({ status: 'pronto', perfil: { apelido: 'Rei' } })
    // sem rede depois: o que estava na tela continua
    rede(() => Promise.reject(new TypeError('Failed to fetch')))
    await usePerfis.getState().abrir('ABCD2345', true)
    expect(usePerfis.getState().perfis.ABCD2345.status).toBe('pronto')
  })
})

// ───────────────────────────── verificação pelo admin (#/verificar) ─────────────────────────────

describe('verificação por replay: o fluxo da tela', () => {
  interface Fila {
    nome: string
    a0: number
    a1: number
    identity: PlayerIdentity
    pace: Pace
    picks: { id: string }[]
  }
  let data: GameData
  let entry: HallEntry
  beforeAll(async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => setTimeout(() => cb(0), 0))
    data = JSON.parse(readFileSync(fileURLToPath(new URL('../data/generated/game-data.json', import.meta.url)), 'utf8')) as GameData
    useData.getState().setData(data, 'real')
    useCareer.setState({ data, engine: careerEngine, engineKind: 'real', status: 'ready', finishedCareers: [], lastFinished: null, isFixture: false })
    // uma carreira real de uma fila de gravação (Expresso, com 1 Copa do Mundo), jogada pelo store como no navegador
    const filas = JSON.parse(readFileSync(fileURLToPath(new URL('../../scripts/gravar/filas/classico.json', import.meta.url)), 'utf8')) as Fila[]
    const f = filas.find((x) => x.nome === 'v-extraordinaria-01')!
    const espia = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(arr: T): T => {
      if (arr instanceof Uint32Array && arr.length === 2) {
        arr[0] = f.a0
        arr[1] = f.a1
      }
      return arr
    })
    try {
      await useCareer.getState().start(f.identity, f.pace, { seed: randomSeed() })
    } finally {
      espia.mockRestore()
    }
    for (const p of f.picks) {
      await useCareer.getState().choose(p.id)
      useCareer.getState().ackReveal()
    }
    entry = JSON.parse(JSON.stringify(useCareer.getState().lastFinished)) as HallEntry
    vi.unstubAllGlobals()
  }, 120_000)

  const meta = { id: 41, usuario: { id: 3, apelido: 'Rei', status: 'ativo' }, modo: 'classico', nota: 92, oculta: 0, suspeita: null, denuncias: 0, posicaoHall: 1, destaque: false, publica: true, sinais: [], temReplay: true, libertadores: 0 }
  const candidatos = [
    { id: 7, estado: 'pendente', em: '2026-10-18T10:00:00Z', desafio: { id: 1, slug: 'tacas-do-rei-copas', titulo: 'As Taças do Rei: 3 Copas' } },
    { id: 8, estado: 'vencedora', em: '2026-10-18T10:00:00Z', desafio: { id: 2, slug: 'x', titulo: 'X' } },
    { id: 0, estado: 'pendente' },
    { id: 9, estado: 'rascunho' },
  ]

  it('busca a carreira pelo admin.php, joga de novo, bate e manda candidato_verificar {id, resultado}', async () => {
    const pedidos: { url: string; metodo: string; corpo: unknown }[] = []
    rede((url, metodo, corpo) => {
      pedidos.push({ url, metodo, corpo: corpo ? JSON.parse(corpo) : null })
      if (metodo === 'GET') return resposta(200, { meta, denuncias: [], candidatos, carreira: entry })
      return resposta(200, { ok: true, feitos: [7] })
    })
    const c = await buscarCarreiraAdmin('41')
    expect(pedidos[0].url).toMatch(/admin\.php\?r=carreira&id=41$/)
    expect(c.temReplay).toBe(true)
    expect(c.candidatos.map((k) => k.id)).toEqual([7, 8])
    const v = await verificarCarreira(careerEngine, data, c.entry, computeLegacy, { versaoNota: LEGACY_VERSION })
    expect(v.diferencas).toEqual([])
    expect(v.ok).toBe(true)
    expect(v.refeito?.copas).toBe(v.guardado?.copas)
    const alvo = alvoDoResultado(c.candidatos, '7', c.meta.pk)
    expect(alvo).toEqual({ id: 7 })
    await mandarResultado(alvo!, resultadoParaServidor(v))
    const post = pedidos[1]
    expect(post.metodo).toBe('POST')
    expect(post.url).toMatch(/admin\.php$/)
    expect(post.corpo).toMatchObject({ acao: 'candidato_verificar', id: 7, resultado: { ok: true, detalhes: { motivo: null, diferencas: [], passos: entry.replay!.picks.length } } })
    expect(JSON.stringify(post.corpo).length).toBeLessThan(8000)
  }, 60_000)

  it('Copas adulteradas no HallEntry: não bate, e o motivo curto diz qual número mudou', async () => {
    const e = JSON.parse(JSON.stringify(entry)) as HallEntry
    const wc = e.summary.trophies.find((t) => t.trophyId === 'world-cup')
    if (wc) wc.count += 2
    else e.summary.trophies.push({ trophyId: 'world-cup', count: 3, seasons: [2030, 2034, 2038] })
    const v = await verificarCarreira(careerEngine, data, e, computeLegacy, { versaoNota: LEGACY_VERSION })
    expect(v.ok).toBe(false)
    expect(v.diferencas.map((d) => d.campo)).toContain('copas')
    const m = motivoCurto(v)!
    expect(m).toMatch(/Copas do Mundo/)
    expect(m.length).toBeLessThanOrEqual(200)
    expect(resultadoParaServidor(v)).toMatchObject({ ok: false, detalhes: { motivo: m } })
  }, 60_000)

  it('sem candidato no link: manda pela carreira (todos os que não venceram); sem candidatos, não manda nada', () => {
    const ks = normalizarCandidatos(candidatos)
    expect(alvoDoResultado(ks, undefined, 41)).toEqual({ carreira: 41 })
    expect(alvoDoResultado(ks, 'abc', 41)).toEqual({ carreira: 41 })
    expect(alvoDoResultado(ks.filter((k) => k.estado === 'vencedora'), undefined, 41)).toBeNull()
    expect(alvoDoResultado([], undefined, 41)).toBeNull()
  })

  it('a sessão do painel acabou: 401 sai como erro (a tela pede para entrar no painel de novo)', async () => {
    rede(() => resposta(401, { erro: 'nao_logado' }))
    await expect(buscarCarreiraAdmin('41')).rejects.toMatchObject({ status: 401 })
  })
})
