/**
 * Site v3.4 (servidor/CONTRATO-v34.md §A.0 e §B): conquistas provadas (a resposta do conquistas.php, a semente do servidor
 * lembrada no aparelho, a carreira-prova), os desafios de emblema (normalização, a faixa da tela inicial, o ?eu=1 com os
 * emblemas da conta e o aviso), os emblemas no Hall e no perfil, a prévia de link (api/v.php), a verificação em lote
 * (admin.php?r=provas e prova_verificar) e o script do IndexNow (sem sair para a internet). A rede é um fetch de mentira.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sementeDoPar } from '@/engine/replay'
import { pontes } from '@/store/compartilhar'
import { useConquistasSite } from '@/store/conquistasSite'
import type { HallEntry } from '@/store/career'
import { useToasts } from '@/ui/primitives'
import { carregarProvadas } from './conquistas'
import { normalizarCarreira, normalizarProvaDaCarreira, useCarreiras } from './carreiras'
import { normalizarUsuario, useConta } from './conta'
import { CHANCE_EMBLEMA, desafiosDaFaixa, emblemasDoEu, emblemasValendo, normalizarCriterio, normalizarDesafio, normalizarLista, normalizarMeus, temDesafioAtivo, textoChance, textoCriterio, useDesafios } from './desafios'
import { AVISO_RECENTE_MS, emblemasParaAvisar, normalizarEmblema, normalizarEmblemas, ordenarEmblemas, useEmblemas } from './emblemas'
import { normalizarCarreiraPublica } from './hallPublico'
import { linkPrevia } from './indicacao'
import { normalizarPerfil } from './perfil'
import { conferirNoHall, iniciarPontes } from './pontes'
import { conquistasDaCarreira, conquistasNovasParaProvar, ehCarreiraProva, lembrarSementeDoServidor, normalizarProvas, sementeDoServidor, somarProvasNovas, uidDasSementes } from './provas'
import { carreirasDoLote, mandarProvas, normalizarProvasConta, provaDoMeta, numerosDoServidor } from './verificacao'
import type { Armazem } from './medicao'

const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
function rede(responder: (url: string, metodo: string, corpo: string) => Response | Promise<Response>) {
  const f = vi.fn(async (u: string | URL | Request, init?: RequestInit) => responder(String(u), init?.method ?? 'GET', typeof init?.body === 'string' ? init.body : ''))
  vi.stubGlobal('fetch', f)
  return f
}
const memoria = (): Armazem => {
  const m = new Map<string, string>()
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) }
}
const logar = (id = 7) => useConta.setState({ usuario: normalizarUsuario({ id, apelido: 'Teste', email: 'a@b.com', codigoConvite: 'ABCD2345', emailVerificado: true }), lembrado: 'Teste', status: 'pronto' })

/** Os 10 desafios de emblema de fábrica (v34-desafios-emblema.json), como o desafios.php manda. */
const EMBLEMAS_FABRICA = [
  ['noite-de-gala', 'Noite de gala', 'facil', { bolasOuro: 1, champions: 1 }, 'star', '#b98652', true],
  ['andarilho-campeao', 'Andarilho campeão', 'facil', { clubes: 12, titulos: 20 }, 'plane', '#b98652', false],
  ['bandeira-do-clube', 'Bandeira do clube', 'facil', { temporadasMesmoClube: 18, titulos: 20 }, 'shield', '#b98652', false],
  ['hexa-e-gloria-eterna', 'Hexa e Glória Eterna', 'medio', { copas: 1, libertadores: 2, bolasOuro: 1, nacionalidade: ['BRA'], copasPelaSelecao: 1 }, 'flag', '#c8d0dc', true],
  ['era-de-ouro', 'Era de ouro', 'medio', { bolasOuro: 5, champions: 3 }, 'circle-dot', '#c8d0dc', false],
  ['artilheiro-do-mundo', 'Artilheiro do mundo', 'medio', { gols: 800, copas: 1 }, 'goal', '#c8d0dc', false],
  ['bi-do-mundo-bi-da-america', 'Bi do mundo, bi da América', 'dificil', { copas: 2, libertadores: 2 }, 'globe', '#f2c75a', false],
  ['imortal', 'Imortal', 'dificil', { copas: 2, nota: 92 }, 'sparkles', '#f2c75a', false],
  ['tacas-do-rei-emblema', 'As Taças do Rei', 'lendario', { copas: 3, libertadores: 2 }, 'crown', '#c9b8ff', true],
  ['mil-gols-e-o-tri', 'Mil gols e o tri', 'lendario', { copas: 3, gols: 1001 }, 'gem', '#c9b8ff', false],
] as const
const desafioEmblema = (i: number, o: Record<string, unknown> = {}) => {
  const [slug, titulo, dificuldade, criterio, icone, cor, home] = EMBLEMAS_FABRICA[i]
  return { slug, titulo, descricao: `Desafio ${titulo}.`, regulamento: '', premio: '', criterio, requisitos: { partidasMin: 0, emailVerificado: false, publicadoNoHall: false, top3Perfil: false }, ativo: true, inicio: '2026-10-20T00:00:00Z', fim: null, encerrado: false, vencedor: null, pendentes: 0, modo: 'emblema', dificuldade, emblema: { icone, cor }, home, ganharam: 3, ...o }
}

beforeEach(() => {
  useConquistasSite.setState({ provadas: null, contagemProva: null })
  useEmblemas.setState({ meus: null, uid: null })
  useToasts.setState({ items: [], queue: [] })
})
afterEach(() => {
  vi.unstubAllGlobals()
  useConta.setState({ usuario: null, lembrado: null })
})

// ───────────────────────────── conquistas provadas ─────────────────────────────

describe('conquistas provadas (conquistas.php)', () => {
  it('normalizarProvas: provada/verificada/carreira e as contagens; servidor antigo (sem `provada`) = null', () => {
    const r = { conquistas: [{ id: 'first_title', em: '2026-10-01T00:00:00Z', provada: true, verificada: true, carreira: 'career-abc' }, { id: 'goat', em: '2026-10-02T00:00:00Z', provada: false, verificada: false, carreira: null }, { id: 'BAD ID', provada: true }], provadas: 1, verificadas: 1, naoProvadas: 1, total: 87 }
    const n = normalizarProvas(r)!
    expect(n.provadas).toEqual({ first_title: { verificada: true, carreira: 'career-abc' } })
    expect(n.contagem).toEqual({ provadas: 1, verificadas: 1, naoProvadas: 1, total: 87 })
    expect(normalizarProvas({ conquistas: [{ id: 'first_title', em: '2026-10-01T00:00:00Z' }] })).toBeNull()
    expect(normalizarProvas(null)).toBeNull()
  })
  it('carregarProvadas lê a conta e guarda no store (uma vez por minuto); sem conta, nada', async () => {
    expect(await carregarProvadas()).toBe(false)
    logar()
    const f = rede((u) => (u.includes('conquistas.php') ? resposta(200, { conquistas: [{ id: 'hexa', em: '2026-10-01T00:00:00Z', provada: true, verificada: false, carreira: 'career-x' }], provadas: 1, verificadas: 0, naoProvadas: 0, total: 87 }) : resposta(404, {})))
    expect(await carregarProvadas(true)).toBe(true)
    expect(useConquistasSite.getState().provadas).toEqual({ hexa: { verificada: false, carreira: 'career-x' } })
    expect(await carregarProvadas()).toBe(true)
    expect(f).toHaveBeenCalledTimes(1)
    // trocou de conta: as provadas eram da outra
    logar(8)
    expect(useConquistasSite.getState().provadas).toBeNull()
  })
  it('somarProvasNovas (a resposta do salvar) acrescenta e acerta as contagens', () => {
    useConquistasSite.setState({ provadas: { hexa: { verificada: true, carreira: 'a' } }, contagemProva: { provadas: 1, verificadas: 1, naoProvadas: 3, total: 87 } })
    expect(somarProvasNovas(['hexa', 'goat', 'x y'], 'career-b')).toEqual(['hexa', 'goat'])
    expect(useConquistasSite.getState().provadas?.goat).toEqual({ verificada: false, carreira: 'career-b' })
    expect(useConquistasSite.getState().contagemProva).toEqual({ provadas: 2, verificadas: 1, naoProvadas: 2, total: 87 })
  })
})

describe('carreira-prova: a semente do servidor lembrada no aparelho', () => {
  const par: [number, number] = [123456, 654321]
  const seed = sementeDoPar(par)
  const h = (o: Partial<HallEntry> = {}) => ({ id: `career-${seed}`, mode: 'classic', engine: 'real', replay: { v: 1, seed: par, identity: {}, pace: 'normal', picks: [], bonusOvr: 0, dados: '' }, career: { achievements: ['first_title', 'hexa', 'goat'] }, ...o }) as unknown as HallEntry
  it('só a conta para quem o servidor sorteou; outra conta no aparelho começa outra lista', () => {
    const a = memoria()
    expect(uidDasSementes(a)).toBeNull()
    lembrarSementeDoServidor(7, seed, a)
    expect(sementeDoServidor(7, seed, a)).toBe(true)
    expect(sementeDoServidor(8, seed, a)).toBe(false)
    expect(ehCarreiraProva(h(), 7, a)).toBe(true)
    expect(ehCarreiraProva(h(), 8, a)).toBe(false)
    // sem replay, do Imersivo, do motor de exemplo, com o id de outra semente: não
    expect(ehCarreiraProva(h({ replay: undefined }), 7, a)).toBe(false)
    expect(ehCarreiraProva(h({ mode: 'immersive' }), 7, a)).toBe(false)
    expect(ehCarreiraProva(h({ engine: 'mock' }), 7, a)).toBe(false)
    expect(ehCarreiraProva(h({ id: 'career-outra' }), 7, a)).toBe(false)
    lembrarSementeDoServidor(8, 'abc123', a)
    expect(uidDasSementes(a)).toBe(8)
    expect(sementeDoServidor(7, seed, a)).toBe(false)
  })
  it('conquistasNovasParaProvar: as da carreira que a conta ainda não tem provadas (sem saber: nenhuma)', () => {
    expect(conquistasDaCarreira(h())).toEqual(['first_title', 'hexa', 'goat'])
    expect(conquistasNovasParaProvar(h(), null)).toEqual([])
    expect(conquistasNovasParaProvar(h(), { first_title: {} })).toEqual(['hexa', 'goat'])
    expect(conquistasNovasParaProvar(h(), { first_title: {} }, new Set(['first_title', 'hexa']))).toEqual(['hexa'])
    expect(conquistasNovasParaProvar(h(), { first_title: {}, hexa: {}, goat: {} })).toEqual([])
  })
  it('o salvar responde provasNovas e emblemasNovos: as provadas sobem e o aviso do emblema sai', async () => {
    logar()
    useCarreiras.setState({ lista: [] })
    rede((u, m, corpo) => {
      if (u.includes('carreiras.php') && m === 'POST' && corpo.includes('"salvar"'))
        return resposta(200, { carreira: { id: `career-${seed}`, jogador: 'SILVA', como: 'auto', prova: { conquistas: 3, unicas: 2, verificada: null } }, provasNovas: ['hexa', 'goat'], emblemasNovos: [{ slug: 'noite-de-gala', titulo: 'Noite de gala', icone: 'star', cor: '#b98652', dificuldade: 'facil' }] })
      return resposta(404, {})
    })
    const entry = { ...h(), identity: { surname: 'SILVA' }, summary: { peakOvr: 80, trophies: [], awards: [], totals: { goals: 1, apps: 1 } }, finishedAt: '2026-10-20T10:00:00Z' } as unknown as HallEntry
    const c = await useCarreiras.getState().salvar(entry, 'auto')
    expect(c.provasNovas).toEqual(['hexa', 'goat'])
    expect(c.prova).toEqual({ conquistas: 3, unicas: 2, verificada: null })
    expect(Object.keys(useConquistasSite.getState().provadas ?? {})).toEqual(['hexa', 'goat'])
    expect(useEmblemas.getState().meus?.map((e) => e.slug)).toEqual(['noite-de-gala'])
    const t = [...useToasts.getState().items, ...useToasts.getState().queue]
    expect(t.some((x) => x.tone === 'gold' && String(x.title).includes('Noite de gala'))).toBe(true)
  })
  it('o C sem `prova` (servidor antigo) fica null', () => {
    expect(normalizarCarreira({ id: 'career-x' })?.prova).toBeNull()
    expect(normalizarProvaDaCarreira({ conquistas: 2, unicas: -1, verificada: 'x' })).toEqual({ conquistas: 2, unicas: 0, verificada: null })
  })
})

// ───────────────────────────── desafios de emblema ─────────────────────────────

describe('desafios de emblema', () => {
  it('normalizarDesafio: modo, dificuldade, emblema, home, ganharam (e o servidor antigo = "primeiro")', () => {
    const d = normalizarDesafio(desafioEmblema(0))!
    expect(d.modo).toBe('emblema')
    expect(d.dificuldade).toBe('facil')
    expect(d.emblema).toEqual({ icone: 'star', cor: '#b98652' })
    expect(d.home).toBe(true)
    expect(d.ganharam).toBe(3)
    // o de emblema não tem vencedor, mesmo que venha um
    expect(normalizarDesafio(desafioEmblema(0, { vencedor: { apelido: 'X' } }))!.vencedor).toBeNull()
    // cor e ícone fora do formato: os do jogo
    expect(normalizarDesafio(desafioEmblema(0, { emblema: { icone: '<script>', cor: 'red' } }))!.emblema).toEqual({ icone: 'medal', cor: '#b98652' })
    const antigo = normalizarDesafio({ slug: 'tacas-do-rei', titulo: 'As Taças do Rei', criterio: { copas: 3 }, ativo: true })!
    expect(antigo.modo).toBe('primeiro')
    expect(antigo.emblema).toBeNull()
    expect(antigo.ganharam).toBeNull()
  })
  it('critérios novos: tetos, nacionalidade e a frase de cada um dos 10 de fábrica', () => {
    expect(normalizarCriterio({ gols: 9999, nota: 300, clubes: 99, temporadasMesmoClube: 99, titulos: 900, nacionalidade: ['BRA', 'bra', 'XX', 'BRA'], copasPelaSelecao: 0 })).toEqual({ gols: 5000, nota: 100, clubes: 40, temporadasMesmoClube: 30, titulos: 500, nacionalidade: ['BRA'] })
    const frases = EMBLEMAS_FABRICA.map((e) => textoCriterio(normalizarCriterio(e[3])))
    expect(frases).toEqual([
      '1 Champions League e 1 Bola de Ouro numa mesma carreira',
      '20 títulos e 12 clubes diferentes numa mesma carreira',
      '20 títulos e 18 temporadas no mesmo clube numa mesma carreira',
      'jogador brasileiro, a Copa pela própria seleção, 2 Libertadores e 1 Bola de Ouro numa mesma carreira',
      '3 Champions League e 5 Bolas de Ouro numa mesma carreira',
      '1 Copa do Mundo e 800 gols numa mesma carreira',
      '2 Copas do Mundo e 2 Libertadores numa mesma carreira',
      '2 Copas do Mundo e Nota de Legado 92 ou mais numa mesma carreira',
      '3 Copas do Mundo e 2 Libertadores numa mesma carreira',
      '3 Copas do Mundo e mais de 1.000 gols numa mesma carreira',
    ])
    // os de antes continuam com a mesma frase
    expect(textoCriterio({ copas: 3, libertadores: 2 })).toBe('3 Copas do Mundo e 2 Libertadores numa mesma carreira')
  })
  it('a chance aproximada (calibração §K.4) dos 10 de fábrica; criado pelo admin: sem número', () => {
    for (const e of EMBLEMAS_FABRICA) expect(CHANCE_EMBLEMA[e[0]], e[0]).toBeDefined()
    expect(textoChance('noite-de-gala')).toBe('~1 em 12 carreiras')
    expect(textoChance('tacas-do-rei-emblema')).toBe('~1 em 9.577 carreiras')
    expect(textoChance('um-desafio-novo')).toBeNull()
  })
  it('o destaque grande e a linha do menu são só do desafio de PRÊMIO; a faixa mostra os de emblema (home primeiro, até 3)', () => {
    const lista = normalizarLista({ desafios: EMBLEMAS_FABRICA.map((_, i) => desafioEmblema(i)) })
    expect(temDesafioAtivo({ lista })).toBe(false)
    expect(emblemasValendo(lista)).toHaveLength(10)
    expect(desafiosDaFaixa(lista).map((d) => d.slug)).toEqual(['noite-de-gala', 'hexa-e-gloria-eterna', 'tacas-do-rei-emblema'])
    // sem os marcados para a Home: os mais fáceis
    const semHome = normalizarLista({ desafios: EMBLEMAS_FABRICA.map((_, i) => desafioEmblema(i, { home: false })) })
    expect(desafiosDaFaixa(semHome, 2).map((d) => d.dificuldade)).toEqual(['facil', 'facil'])
    // desativado ou acabado: some da faixa
    expect(desafiosDaFaixa(normalizarLista({ desafios: [desafioEmblema(0, { ativo: false }), desafioEmblema(3, { fim: '2026-01-01T00:00:00Z' })] }))).toEqual([])
    // com um de prêmio valendo, o destaque é dele
    const comPremio = normalizarLista({ desafios: [{ slug: 'tacas-do-rei', titulo: 'As Taças do Rei', criterio: { copas: 3, libertadores: 2 }, ativo: true, inicio: '2026-10-01T00:00:00Z' }, desafioEmblema(0)] })
    expect(temDesafioAtivo({ lista: comPremio })).toBe(true)
  })
  it('?eu=1: eu.emblema em cada um e os emblemas da conta no topo (com o aviso dos novos)', async () => {
    // outra conta (a 7 já viu a "Noite de gala" no teste do salvar, neste mesmo aparelho)
    logar(9)
    const r = {
      desafios: [
        { ...desafioEmblema(0), eu: { partidas: 3, partidasMin: 0, emailVerificado: true, carreirasQueCumprem: [], candidato: null, emblema: { estado: 'ativo', em: new Date().toISOString(), carreiraId: 'career-a', jogador: 'SILVA', motivo: null } } },
        { ...desafioEmblema(1), eu: { partidas: 3, partidasMin: 0, emailVerificado: true, carreirasQueCumprem: [{ carreiraId: 'career-b', jogador: 'SOUZA', vale: false, motivo: 'sem_semente', motivoTexto: 'A carreira não foi começada com a conta.' }], candidato: null, emblema: null } },
      ],
      emblemas: [{ slug: 'noite-de-gala', titulo: 'Noite de gala', icone: 'star', cor: '#b98652', dificuldade: 'facil', em: new Date().toISOString(), carreiraId: 'career-a', jogador: 'SILVA' }],
    }
    const meus = normalizarMeus(r)
    expect(meus['noite-de-gala'].emblema).toEqual({ estado: 'ativo', em: r.desafios[0].eu.emblema!.em, carreiraId: 'career-a', jogador: 'SILVA', motivo: null })
    expect(meus['andarilho-campeao'].emblema).toBeNull()
    expect(meus['andarilho-campeao'].carreirasQueCumprem[0]).toMatchObject({ vale: false, motivoCodigo: 'sem_semente', motivo: 'A carreira não foi começada com a conta.' })
    rede(() => resposta(200, r))
    await useDesafios.getState().carregarMeu(true)
    expect(useEmblemas.getState().meus?.map((e) => e.slug)).toEqual(['noite-de-gala'])
    const avisos = () => [...useToasts.getState().items, ...useToasts.getState().queue].filter((x) => x.tone === 'gold')
    expect(avisos()).toHaveLength(1)
    // a segunda leitura não avisa de novo
    useToasts.setState({ items: [], queue: [] })
    await useDesafios.getState().carregarMeu(true)
    expect(avisos()).toHaveLength(0)
  })
  it('servidor sem a lista `emblemas` no topo do ?eu=1: os da conta saem dos `eu.emblema` ativos (sem emblema na lista: null)', async () => {
    logar(10)
    const r = {
      desafios: [
        { ...desafioEmblema(4), eu: { partidas: 1, partidasMin: 0, emailVerificado: true, carreirasQueCumprem: [], candidato: null, emblema: { estado: 'ativo', em: '2026-10-20T10:00:00.000Z', carreiraId: 'career-a', jogador: 'SILVA', motivo: null } } },
        { ...desafioEmblema(0), eu: { partidas: 1, partidasMin: 0, emailVerificado: true, carreirasQueCumprem: [], candidato: null, emblema: { estado: 'retirado', em: '2026-10-20T10:00:00.000Z', carreiraId: 'career-b', jogador: 'SOUZA', motivo: 'Não bateu' } } },
      ],
    }
    rede(() => resposta(200, r))
    await useDesafios.getState().carregarMeu(true)
    expect(useEmblemas.getState().meus).toEqual([{ slug: 'era-de-ouro', titulo: 'Era de ouro', icone: 'circle-dot', cor: '#c8d0dc', dificuldade: 'medio', em: '2026-10-20T10:00:00.000Z', carreiraId: 'career-a', jogador: 'SILVA' }])
    expect(emblemasDoEu(normalizarLista({ desafios: [{ slug: 'tacas-do-rei', titulo: 'As Taças do Rei', criterio: { copas: 3 }, ativo: true }] }), {})).toBeNull()
  })
  it('emblemas: normalização, ordem (mais difícil primeiro) e o aviso só uma vez por aparelho (e só dos recentes)', () => {
    expect(normalizarEmblema({ slug: 'x', icone: 'javascript:1', cor: '#zzz' })).toMatchObject({ slug: 'x', icone: 'medal', cor: '#b98652', titulo: '', dificuldade: null })
    expect(normalizarEmblemas([{ slug: 'a' }, { slug: 'a' }, { slug: '' }, null])).toHaveLength(1)
    const l = normalizarEmblemas([
      { slug: 'f', dificuldade: 'facil', em: '2026-10-01T00:00:00Z' },
      { slug: 'l', dificuldade: 'lendario', em: '2026-09-01T00:00:00Z' },
      { slug: 'm', dificuldade: 'medio', em: '2026-10-05T00:00:00Z' },
    ])
    expect(ordenarEmblemas(l).map((e) => e.slug)).toEqual(['l', 'm', 'f'])
    const a = memoria()
    const agora = Date.parse('2026-10-06T00:00:00Z')
    expect(emblemasParaAvisar(l, 7, a, agora).map((e) => e.slug)).toEqual(['f', 'm'])
    expect(emblemasParaAvisar(l, 7, a, agora)).toEqual([])
    // outra conta no mesmo aparelho: a lista é outra
    expect(emblemasParaAvisar(l, 8, a, agora + AVISO_RECENTE_MS * 10)).toEqual([])
  })
})

// ───────────────────────────── Hall, perfil e prévia ─────────────────────────────

describe('emblemas no Hall e no perfil; prévia de link', () => {
  it('item do hall.php com emblemas (até 3) e emblemasTotal; servidor antigo: nada', () => {
    const c = normalizarCarreiraPublica({ id: 'career-x', apelido: 'Ana', emblemas: [{ slug: 'a', icone: 'star', cor: '#b98652' }, { slug: 'b', icone: 'crown', cor: '#c9b8ff' }, { slug: 'c', icone: 'gem', cor: '#c9b8ff' }, { slug: 'd', icone: 'flag', cor: '#c8d0dc' }], emblemasTotal: 6 })!
    expect(c.emblemas?.map((e) => e.slug)).toEqual(['a', 'b', 'c'])
    expect(c.emblemasTotal).toBe(6)
    const antigo = normalizarCarreiraPublica({ id: 'career-x', apelido: 'Ana' })!
    expect(antigo.emblemas).toBeUndefined()
  })
  it('perfil.php com emblemas e conquistasProvadas', () => {
    const p = normalizarPerfil({ apelido: 'Ana', emblemas: [{ slug: 'noite-de-gala', titulo: 'Noite de gala', icone: 'star', cor: '#b98652', dificuldade: 'facil' }, { slug: 'imortal', titulo: 'Imortal', icone: 'sparkles', cor: '#f2c75a', dificuldade: 'dificil' }], conquistasProvadas: 40 }, 'ABCD2345')!
    expect(p.emblemas.map((e) => e.slug)).toEqual(['imortal', 'noite-de-gala'])
    expect(p.conquistasProvadas).toBe(40)
    expect(normalizarPerfil({ apelido: 'Ana' }, 'ABCD2345')!.emblemas).toEqual([])
  })
  it('linkPrevia: a carreira (com o convite de quem compartilha) e o perfil', () => {
    const base = 'https://oprojeto.online/lenda/'
    expect(linkPrevia({ id: 'career-1a2b', codigo: 'ABCD2345' }, base)).toBe('https://oprojeto.online/lenda/api/v.php?id=career-1a2b&c=ABCD2345')
    expect(linkPrevia({ id: 'career-1a2b' }, base)).toBe('https://oprojeto.online/lenda/api/v.php?id=career-1a2b')
    expect(linkPrevia({ codigo: 'ABCD2345' }, base)).toBe('https://oprojeto.online/lenda/api/v.php?c=ABCD2345')
    // nada que sirva: o link do jogo
    expect(linkPrevia({ id: 'id com espaço', codigo: 'x' }, base)).toBe(base)
  })
  it('o Compartilhar do card usa a prévia com a conta e a carreira no Hall público (§E.9); sem conta ou fora do Hall, o link de sempre', async () => {
    // as pontes só ligam no navegador: um window e um location mínimos
    vi.stubGlobal('window', { addEventListener: () => {}, setTimeout, clearTimeout })
    vi.stubGlobal('location', { search: '', origin: 'https://oprojeto.online', pathname: '/lenda/', href: 'https://oprojeto.online/lenda/' })
    iniciarPontes()
    expect(pontes.compartilhar).not.toBeNull()
    expect(pontes.compartilhar!.link('career-1a2b')).not.toMatch(/v\.php/)
    logar()
    // §E.9: a carreira que ainda não está no Hall público leva o link de sempre (o v.php só conhece a fotografia do Hall)
    expect(pontes.compartilhar!.link('career-1a2b')).not.toMatch(/v\.php/)
    useCarreiras.setState({ lista: [normalizarCarreira({ id: 'career-1a2b', hall: { estado: 'no_hall' } })!] })
    await conferirNoHall('career-1a2b', true)
    expect(pontes.compartilhar!.link('career-1a2b')).toMatch(/api\/v\.php\?id=career-1a2b&c=ABCD2345$/)
    useCarreiras.setState({ lista: null })
    // sem a carreira (outro botão): o link do convite
    expect(pontes.compartilhar!.link()).toMatch(/\?c=ABCD2345$/)
  })
})

// ───────────────────────────── verificação em lote (admin) ─────────────────────────────

describe('verificação em lote das carreiras-prova', () => {
  const provas = {
    usuario: { id: 7, apelido: 'Ana', status: 'ativo' },
    conquistas: { total: 87, provadas: 30, verificadas: 10, naoProvadas: 5, faltamProvar: ['goat'], faltamVerificar: ['hexa'] },
    carreiras: [
      { pk: 11, carreiraId: 'career-a', jogador: 'SILVA', conquistas: ['hexa', 'first_title'], unicas: ['hexa'], essencial: true, vale: true, provaOk: null },
      { pk: 12, carreiraId: 'career-b', jogador: 'SOUZA', conquistas: ['first_title'], unicas: [], essencial: false, vale: true, provaOk: null },
      { pk: 13, carreiraId: 'career-c', jogador: 'LIMA', conquistas: ['goat'], unicas: ['goat'], essencial: true, vale: true, provaOk: true },
      { pk: 14, carreiraId: 'career-d', jogador: 'COSTA', conquistas: ['x'], unicas: [], essencial: false, vale: false, motivo: 'sem semente', provaOk: null },
      { pk: 'x' },
    ],
  }
  it('normalizarProvasConta e quais o lote verifica (essenciais que faltam · não verificadas · todas que valem)', () => {
    const p = normalizarProvasConta(provas)!
    expect(p.carreiras.map((c) => c.pk)).toEqual([11, 12, 13, 14])
    expect(carreirasDoLote(p, 'essenciais').map((c) => c.pk)).toEqual([11])
    expect(carreirasDoLote(p, 'faltam').map((c) => c.pk)).toEqual([11, 12])
    expect(carreirasDoLote(p, 'todas').map((c) => c.pk)).toEqual([11, 12, 13])
    expect(normalizarProvasConta({})).toBeNull()
  })
  it('mandarProvas manda prova_verificar em pedidos de até 50 e devolve o que o servidor gravou', async () => {
    const corpos: unknown[] = []
    rede((_u, _m, corpo) => {
      const j = JSON.parse(corpo) as { resultados: { carreira: number; ok: boolean }[] }
      corpos.push(j)
      return resposta(200, { ok: true, carreiras: j.resultados.map((r) => ({ pk: r.carreira, provaOk: r.ok })), pulados: [], contas: { 7: { provadas: 30, verificadas: 12, total: 87 } } })
    })
    const resultados = Array.from({ length: 60 }, (_, i) => ({ carreira: 100 + i, ok: i !== 3, detalhes: { v: 1 } }))
    const r = await mandarProvas(resultados, 7)
    expect(corpos).toHaveLength(2)
    expect((corpos[0] as { acao: string; resultados: unknown[] }).acao).toBe('prova_verificar')
    expect((corpos[0] as { resultados: unknown[] }).resultados).toHaveLength(50)
    expect(r.carreiras).toHaveLength(60)
    expect(r.carreiras.find((k) => k.pk === 103)?.provaOk).toBe(false)
    expect(r.conta).toEqual({ provadas: 30, verificadas: 12, total: 87 })
  })
  it('o meta do ?r=carreira diz se a carreira é prova (e os números novos vão para a verificação)', () => {
    expect(provaDoMeta({ prova: true, provaOk: null, conquistas: ['hexa'] })).toEqual({ ehProva: true, provaOk: null, conquistas: ['hexa'] })
    expect(provaDoMeta({ conquistas: ['hexa'] }).ehProva).toBe(true)
    expect(provaDoMeta({ prova: null, conquistas: null }).ehProva).toBe(false)
    expect(provaDoMeta({}).ehProva).toBe(false)
    expect(numerosDoServidor({ champions: 2, nClubes: 9, mesmoClube: 12, copasSelecao: 1, conquistas: ['hexa', 'hexa', 'NÃO'] })).toMatchObject({ champions: 2, clubes: 9, mesmoClube: 12, copasSelecao: 1, conquistas: ['hexa'] })
  })
})

// ───────────────────────────── IndexNow (sem internet) ─────────────────────────────

describe('scripts/indexnow.mjs', () => {
  const caminho = fileURLToPath(new URL('../../scripts/indexnow.mjs', import.meta.url))
  const carregar = () => import(/* @vite-ignore */ caminho) as Promise<Record<string, (...a: never[]) => unknown> & { CHAVE_INDEXNOW: string; MOTORES: Record<string, string> }>
  it('o pedido fica só com os endereços da pasta /lenda/ (o keyLocation está lá) e sem o #', async () => {
    const m = await carregar()
    const montar = m.montarPedido as (o: { site: string; urls: string[]; chave: string }) => { pedido: { host: string; key: string; keyLocation: string; urlList: string[] }; fora: { url: string; motivo: string }[] }
    const { pedido, fora } = montar({
      site: 'https://oprojeto.online/lenda',
      chave: 'abcdef0123456789',
      urls: ['https://oprojeto.online/lenda/', 'https://oprojeto.online/lenda/#/hall', 'https://oprojeto.online/', 'https://outro.site/lenda/', 'privacidade.html', 'http://[ruim'],
    })
    expect(pedido.host).toBe('oprojeto.online')
    expect(pedido.keyLocation).toBe('https://oprojeto.online/lenda/abcdef0123456789.txt')
    expect(pedido.urlList).toEqual(['https://oprojeto.online/lenda/', 'https://oprojeto.online/lenda/privacidade.html'])
    expect(fora.map((x) => x.motivo)).toEqual(['fora de /lenda/', 'outro site', 'endereço inválido'])
  })
  it('a chave: a do repositório (pública) ou LENDA_INDEXNOW_KEY no formato; o sitemap vira lista', async () => {
    const m = await carregar()
    const chave = m.chaveIndexNow as (env: Record<string, string>) => string
    expect(chave({})).toBe(m.CHAVE_INDEXNOW)
    expect(m.CHAVE_INDEXNOW).toMatch(/^[a-f0-9]{32}$/)
    expect(chave({ LENDA_INDEXNOW_KEY: 'outra-chave-123' })).toBe('outra-chave-123')
    expect(() => chave({ LENDA_INDEXNOW_KEY: 'curta' })).toThrow()
    const urls = (m.urlsDoSitemap as (x: string) => string[])('<urlset><url><loc>https://oprojeto.online/lenda/</loc></url><url><loc> https://oprojeto.online/lenda/privacidade.html </loc></url><url><loc>https://oprojeto.online/lenda/</loc></url></urlset>')
    expect(urls).toEqual(['https://oprojeto.online/lenda/', 'https://oprojeto.online/lenda/privacidade.html'])
  })
  it('avisar manda o mesmo pedido a cada buscador pelo fetch dado (aqui, de mentira) e lê o status', async () => {
    const m = await carregar()
    const chamadas: { url: string; corpo: unknown }[] = []
    const f = async (url: string, init: { body: string }) => {
      chamadas.push({ url, corpo: JSON.parse(init.body) })
      return { status: url.includes('bing') ? 202 : 403 } as Response
    }
    const pedido = { host: 'oprojeto.online', key: 'k1234567', keyLocation: 'https://oprojeto.online/lenda/k1234567.txt', urlList: ['https://oprojeto.online/lenda/'] }
    const r = (await (m.avisar as (p: unknown, o: unknown) => Promise<{ motor: string; ok: boolean; status: number; texto: string }[]>)(pedido, { motores: ['bing', 'yandex', 'nenhum'], fetch: f })) as { motor: string; ok: boolean; status: number; texto: string }[]
    expect(chamadas.map((c) => c.url)).toEqual([m.MOTORES.bing, m.MOTORES.yandex])
    expect(chamadas[0].corpo).toEqual(pedido)
    expect(r.map((x) => [x.motor, x.ok])).toEqual([
      ['bing', true],
      ['yandex', false],
      ['nenhum', false],
    ])
    expect(r[1].texto).toMatch(/chave/)
    await expect((m.avisar as (p: unknown, o: unknown) => Promise<unknown>)({ ...pedido, urlList: [] }, { fetch: f })).rejects.toThrow()
  })
})

describe('textos', () => {
  it('nada nos arquivos novos promete dinheiro', () => {
    for (const arq of ['provas.ts', 'emblemas.ts', 'VerificarConta.tsx', 'DesafiosTela.tsx', 'DestaqueDesafio.tsx', 'desafios.ts', 'MinhaConta.tsx', 'PerfilPublico.tsx']) {
      const txt = readFileSync(fileURLToPath(new URL(`./${arq}`, import.meta.url)), 'utf8').toLowerCase()
      expect(txt, arq).not.toMatch(/dinheiro|r\$ ?\d|\d ?reais\b|\bpix\b/)
    }
  })
})
