/**
 * Site v3.2 (servidor/CONTRATO-v32.md §A.7 e §D): o lado do jogo do painel completo — onde cada carreira está no Hall
 * público (X2), a carreira removida pela moderação (409 apagada), a conta de testes, o aviso da moderação (H11), os
 * avisos por público e prazo (N14), o selo Destaque (H12), o atalho "Convide amigos" (X3), o "Abrir no jogo" do painel
 * (X4) e a tela de agora na medição (P1-4). A rede é um fetch de mentira.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEGACY_VERSION } from '@/engine/legacy/score'
import { avisosVisiveis, emTeste, podeDebug, podeImersivo, podeLive, portaoDaRota, proximoVencimento, rotaDeAdmin, rotaFechada, useAcesso, type Acesso, type AvisoLista } from '@/store/acesso'
import { useApp } from '@/store/app'
import { useCareer, type HallEntry } from '@/store/career'
import { estadoAdmin, useResumoAdmin } from '@/store/resumoAdmin'
import { comFechado, lerFechados } from '@/ui/shell/AvisoFaixa'
import { AVISOS_MAX, normalizarAvisos, normalizarSite, SITE_PADRAO } from './acesso'
import { mensagemDeErro, ErroApi } from './api'
import { promessaIndicacao } from './bonus'
import {
  apagadasNoAparelho,
  avisoAoPublicar,
  avisoAoSalvar,
  estrelaDoHall,
  CHAVE_PENDENTES,
  idsNoHallPublico,
  marcarPendente,
  marcarRemovida,
  normalizarCarreira,
  normalizarHall,
  pendentesManuais,
  pendentesNoAparelho,
  removidasNoAparelho,
  revisaoNoLote,
  seloHall,
  useCarreiras,
  type CarreiraConta,
} from './carreiras'
import { normalizarAvisoConta, normalizarUsuario, useConta } from './conta'
import { normalizarCarreiraPublica } from './hallPublico'
import { comTelaDaSessao, ROTA_RE, utmDaVisita, type Armazem, type Evento } from './medicao'
import { iniciarResumoAdmin, normalizarMetaAdmin, queryResumoAdmin } from './resumoAdmin'
import { useSiteUi } from './ui'
import { sincronizarAoEntrar, telaAtual } from './vigias'

const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
function rede(responder: (url: string, metodo: string, corpo: string) => Response | Promise<Response>) {
  const f = vi.fn(async (u: string | URL | Request, init?: RequestInit) => responder(String(u), init?.method ?? 'GET', typeof init?.body === 'string' ? init.body : ''))
  vi.stubGlobal('fetch', f)
  return f
}
function armazenamento(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  }
}
const mem = (): Armazem => {
  const d = new Map<string, string>()
  return { get: (k) => d.get(k) ?? null, set: (k, v) => void d.set(k, v) }
}

function hall(id: string, peakOvr: number, finishedAt: string): HallEntry {
  const identity = { surname: id.toUpperCase(), number: 10, foot: 'right', nationality: 'BRA', position: 'MEI' }
  return {
    id,
    finishedAt,
    identity,
    pace: 'normal',
    mode: 'classic',
    summary: { identity, seasons: 20, clubs: [], totals: { apps: 600, goals: 300, assists: 150 }, national: {}, trophies: [], awards: [], peakOvr, peakOvrAge: 27, peakValue: 1, ballonDorPodiums: [], legacyScore: 61.4, headline: 'Lenda', comparisons: [] },
    career: { id, seasons: [{ position: 'PE' }], log: [] },
    engine: 'real',
    legacy: { score: 62, raw: 61.7, at: finishedAt, v: LEGACY_VERSION },
  } as unknown as HallEntry
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
const rota = (path: string, query: Record<string, string> = {}) => ({ path: path as never, query })
const carreira = (o: Partial<CarreiraConta> & { id: string }): CarreiraConta => normalizarCarreira({ jogador: 'X', nota: 80, notaV: LEGACY_VERSION, ...o })!

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', {
    localStorage: armazenamento(),
    setTimeout: (...a: Parameters<typeof setTimeout>) => setTimeout(...a),
    clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
  })
  useCarreiras.getState().limpar()
  useConta.setState({ usuario: normalizarUsuario({ id: 7, apelido: 'Teste' }), lembrado: 'Teste', status: 'pronto' })
  useCareer.setState({ finishedCareers: [], lastFinished: null })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ───────────────────────────── X2: onde a carreira está no Hall público ─────────────────────────────

describe('Hall público por carreira (X2)', () => {
  it('o `hall` do C é conferido: estado desconhecido ou sem texto vira null; o motivo é cortado e limpo', () => {
    expect(normalizarHall({ estado: 'no_hall' })).toEqual({ estado: 'no_hall', motivo: null })
    expect(normalizarHall({ estado: 'revisao', motivo: '  Em revisão:\n entra no Hall assim que for conferida. ' })).toEqual({ estado: 'revisao', motivo: 'Em revisão: entra no Hall assim que for conferida.' })
    expect(normalizarHall({ estado: 'banida' })).toBeNull()
    expect(normalizarHall(null)).toBeNull()
    expect(normalizarHall('no_hall')).toBeNull()
    expect(normalizarHall({ estado: 'fora', motivo: 'x'.repeat(400) })?.motivo?.length).toBe(160)
    // servidor antigo (sem `hall`): sem selo
    expect(normalizarCarreira({ id: 'a' })?.hall).toBeNull()
    expect(normalizarCarreira({ id: 'a', hall: { estado: 'oculta', motivo: 'A moderação tirou esta carreira do Hall público.' } })?.hall?.estado).toBe('oculta')
  })

  it('selos: No Hall público · Em revisão · Fora do Hall: <motivo> · Privada', () => {
    expect(seloHall({ estado: 'no_hall', motivo: null })).toMatchObject({ rotulo: 'No Hall público', texto: null, tom: 'ok' })
    expect(seloHall({ estado: 'revisao', motivo: 'Em revisão: entra no Hall assim que for conferida.' })).toMatchObject({ rotulo: 'Em revisão', texto: 'Em revisão: entra no Hall assim que for conferida.', tom: 'revisao' })
    expect(seloHall({ estado: 'revisao', motivo: null })?.texto).toBe('Em revisão: entra no Hall assim que for conferida.')
    expect(seloHall({ estado: 'oculta', motivo: 'A moderação tirou esta carreira do Hall público.' })).toMatchObject({ rotulo: 'Fora do Hall', texto: 'Fora do Hall: a moderação tirou esta carreira do Hall público.', tom: 'aviso' })
    expect(seloHall({ estado: 'suspeita', motivo: 'Esta carreira já foi salva por outra conta.' })?.texto).toBe('Fora do Hall: esta carreira já foi salva por outra conta.')
    // escolha do jogador / regra do Hall: neutro (não é castigo)
    expect(seloHall({ estado: 'fora', motivo: 'Você escolheu outras carreiras para o Hall.' })).toMatchObject({ tom: 'neutro', texto: 'Fora do Hall: você escolheu outras carreiras para o Hall.' })
    expect(seloHall({ estado: 'fora', motivo: 'LENDA mudou' })?.texto).toBe('Fora do Hall: LENDA mudou')
    expect(seloHall({ estado: 'fora', motivo: null })?.texto).toBe('Fora do Hall: esta carreira não aparece no Hall público agora.')
    expect(seloHall({ estado: 'privada', motivo: null })).toMatchObject({ rotulo: 'Privada', tom: 'neutro', texto: 'Você escolheu não aparecer no Hall público.' })
    expect(seloHall(null)).toBeNull()
  })

  it('quem está no Hall: com `hall`, vale o estado no_hall (e não a conta antiga do aparelho)', () => {
    const lista = [
      carreira({ id: 'a', nota: 99, hall: { estado: 'revisao', motivo: null } }),
      carreira({ id: 'b', nota: 90, hall: { estado: 'no_hall', motivo: null } }),
      carreira({ id: 'c', nota: 70, hall: { estado: 'fora', motivo: 'Só as 3 melhores…' } }),
    ]
    expect([...idsNoHallPublico(lista, 'auto')]).toEqual(['b'])
    expect(idsNoHallPublico(lista, 'nao').size).toBe(0)
    // servidor antigo: as 3 de maior nota (como na v3)
    expect(idsNoHallPublico([carreira({ id: 'a', nota: 99 }), carreira({ id: 'b', nota: 50 })], 'auto').size).toBe(2)
  })

  it('o aviso discreto de quando a carreira acabou de ir para a revisão', () => {
    expect(avisoAoSalvar({ hall: { estado: 'revisao', motivo: null } })).toBe('Em revisão: entra no Hall público assim que for conferida.')
    expect(avisoAoSalvar({ hall: { estado: 'no_hall', motivo: null } })).toBeNull()
    expect(avisoAoSalvar({ hall: null })).toBeNull()
    expect(avisoAoSalvar(null)).toBeNull()
    expect(revisaoNoLote(3, 0)).toBeNull()
    expect(revisaoNoLote(1, 1)).toBe('Ela está em revisão: entra no Hall público assim que for conferida.')
    expect(revisaoNoLote(3, 1)).toBe('Uma delas está em revisão: entra no Hall público assim que for conferida.')
    expect(revisaoNoLote(3, 2)).toBe('2 delas estão em revisão: entram no Hall público assim que forem conferidas.')
    expect(revisaoNoLote(2, 2)).toBe('Elas estão em revisão: entram no Hall público assim que forem conferidas.')
  })

  it('revisão 3: o `porque` do "fora" esconde a estrela que não muda nada (Imersivo, nota antiga…), e o toast não promete o Hall', () => {
    expect(normalizarHall({ estado: 'fora', porque: 'imersivo', motivo: 'As carreiras do Imersivo ainda não entram no Hall público.' })).toEqual({
      estado: 'fora', porque: 'imersivo', motivo: 'As carreiras do Imersivo ainda não entram no Hall público.',
    })
    expect(normalizarHall({ estado: 'fora', porque: 'qualquer', motivo: 'x' })).toEqual({ estado: 'fora', motivo: 'x' })
    const imersivo = { estado: 'fora', porque: 'imersivo', motivo: 'As carreiras do Imersivo ainda não entram no Hall público.' } as const
    // antes a estrela aparecia para todo "fora": agora só quando muda alguma coisa (ou para tirar uma já marcada)
    expect(estrelaDoHall(imersivo, false)).toBe(false)
    expect(estrelaDoHall(imersivo, true)).toBe(true)
    for (const porque of ['versao', 'bloqueada', 'duplicada'] as const) expect(estrelaDoHall({ estado: 'fora', porque, motivo: null }, false)).toBe(false)
    for (const porque of ['escolha', 'limite'] as const) expect(estrelaDoHall({ estado: 'fora', porque, motivo: null }, false)).toBe(true)
    expect(estrelaDoHall({ estado: 'fora', motivo: 'servidor sem porque' }, false)).toBe(true)
    expect(estrelaDoHall({ estado: 'no_hall', motivo: null }, true)).toBe(true)
    expect(estrelaDoHall({ estado: 'revisao', motivo: null }, false)).toBe(true)
    expect(estrelaDoHall({ estado: 'oculta', motivo: null }, true)).toBe(false)
    expect(estrelaDoHall({ estado: 'suspeita', motivo: null }, false)).toBe(false)
    expect(estrelaDoHall(null, false)).toBe(true)
    // o toast: o motivo do servidor no lugar de "Aparece na próxima atualização do Hall"
    expect(avisoAoPublicar('VIEIRA', true, imersivo)).toEqual({ tipo: 'info', titulo: 'VIEIRA marcada para o Hall', texto: 'Fora do Hall: as carreiras do Imersivo ainda não entram no Hall público.' })
    expect(avisoAoPublicar('VIEIRA', true, { estado: 'no_hall', motivo: null })).toEqual({ tipo: 'success', titulo: 'VIEIRA vai para o Hall público', texto: 'Aparece na próxima atualização do Hall, em até 3 h.' })
    expect(avisoAoPublicar('VIEIRA', true, { estado: 'revisao', motivo: null }).texto).toBe('Está em revisão: entra no Hall assim que for conferida.')
    expect(avisoAoPublicar('VIEIRA', true, { estado: 'revisao', motivo: 'Em revisão: a moderação confere as notas altas antes do Hall.' }).texto).toBe('Em revisão: a moderação confere as notas altas antes do Hall.')
    expect(avisoAoPublicar('VIEIRA', false, imersivo)).toEqual({ tipo: 'success', titulo: 'VIEIRA saiu do Hall público', texto: 'Sai do Hall da comunidade em poucos minutos.' })
  })

  it('publicar devolve a carreira como o servidor a deixou (o `hall` de agora, para o toast)', async () => {
    useCarreiras.setState({ lista: [carreira({ id: 'imer', hall: { estado: 'fora', porque: 'imersivo', motivo: 'As carreiras do Imersivo ainda não entram no Hall público.' } })] })
    rede((_u, metodo) => (metodo === 'GET' ? resposta(200, { carreiras: [], limite: 200, hallPublico: 'manual' })
      : resposta(200, { carreira: { id: 'imer', jogador: 'IMER', publica: true, hall: { estado: 'fora', porque: 'imersivo', motivo: 'As carreiras do Imersivo ainda não entram no Hall público.' } }, hallPublico: 'manual' })))
    const c = await useCarreiras.getState().publicar('imer', true)
    expect(c?.hall).toEqual({ estado: 'fora', porque: 'imersivo', motivo: 'As carreiras do Imersivo ainda não entram no Hall público.' })
    expect(c?.publica).toBe(true)
  })

  it('a 90+ salva ao entrar que foi para a revisão: o toast conta, e a lista guarda o estado', async () => {
    useCareer.setState({ finishedCareers: [hall('noventa', 95, '2026-10-10')] })
    rede((_u, metodo) => (metodo === 'GET' ? resposta(200, { carreiras: [], limite: 200, hallPublico: 'auto' }) : resposta(200, { carreira: { id: 'noventa', jogador: 'NOVENTA', nota: 93, hall: { estado: 'revisao', motivo: 'Em revisão: entra no Hall assim que for conferida.' } } })))
    await sincronizarAoEntrar()
    expect(useCarreiras.getState().lista?.[0]?.hall?.estado).toBe('revisao')
  })
})

// ───────────────────────────── 409 apagada (lixeira da moderação) ─────────────────────────────

describe('carreira removida pela moderação (409 apagada)', () => {
  it('marcarRemovida tira das duas filas e guarda; apagadasNoAparelho inclui as removidas', () => {
    marcarPendente('x')
    marcarPendente('x', 'manual')
    marcarRemovida('x')
    expect(pendentesNoAparelho().has('x')).toBe(false)
    expect(pendentesManuais().has('x')).toBe(false)
    expect(removidasNoAparelho().has('x')).toBe(true)
    expect(apagadasNoAparelho().has('x')).toBe(true)
    marcarRemovida('x')
    expect(JSON.parse(window.localStorage.getItem('lenda:carreiras-removidas') ?? '[]')).toEqual(['x'])
    // armazém próprio (puro)
    const a = mem()
    a.set(CHAVE_PENDENTES, JSON.stringify(['y']))
    marcarRemovida('y', a)
    expect(a.get(CHAVE_PENDENTES)).toBe('[]')
  })

  it('ao entrar: a removida sai da fila, não vira erro, e a próxima 90+ sobe', async () => {
    useCareer.setState({ finishedCareers: [hall('apagada', 95, '2026-10-12'), hall('boa', 92, '2026-10-10')] })
    const salvas: string[] = []
    rede((_u, metodo, corpo) => {
      if (metodo === 'GET') return resposta(200, { carreiras: [], limite: 200, hallPublico: 'auto' })
      const id = (JSON.parse(corpo) as { carreira: { id: string } }).carreira.id
      if (id === 'apagada') return resposta(409, { erro: 'apagada', mensagem: 'Esta carreira foi removida pela moderação.' })
      salvas.push(id)
      return resposta(200, { carreira: { id, hall: { estado: 'no_hall' } } })
    })
    await sincronizarAoEntrar()
    expect(salvas).toEqual(['boa'])
    expect(removidasNoAparelho().has('apagada')).toBe(true)
    expect(pendentesNoAparelho().size).toBe(0)
    // na próxima abertura ela nem tenta (removida conta como apagada para o "sobe sozinha")
    salvas.length = 0
    useCarreiras.getState().limpar()
    await sincronizarAoEntrar()
    expect(salvas).toEqual(['boa'])
  })

  it('salvar de novo com sucesso (o admin liberou o reenvio) tira a marca de removida', async () => {
    marcarRemovida('volta')
    rede(() => resposta(200, { carreira: { id: 'volta' } }))
    await useCarreiras.getState().salvar(hall('volta', 80, '2026-10-10'), 'manual')
    expect(removidasNoAparelho().has('volta')).toBe(false)
  })

  it('as mensagens novas têm texto em pt-BR mesmo sem corpo do servidor', () => {
    expect(mensagemDeErro(new ErroApi('apagada', 409))).toBe('Esta carreira foi removida pela moderação.')
    expect(mensagemDeErro(new ErroApi('hall_bloqueado', 403))).toBe('Sua conta não pode publicar no Hall público.')
  })
})

// ───────────────────────────── conta de testes (P1-6) ─────────────────────────────

describe('conta de testes (U.tester)', () => {
  it('abre o Imersivo e a Live (selo "Teste"), mas não o #/kit, o painel nem a manutenção', () => {
    const t = acesso({ tester: true })
    expect(podeLive(t)).toBe(true)
    expect(podeImersivo(t)).toBe(true)
    expect(podeDebug(t, true)).toBe(false)
    expect(emTeste(t, false, true)).toBe('tester')
    expect(emTeste(t, true, true)).toBeNull()
    expect(emTeste(acesso({ tester: true, admin: true }), false, true)).toBe('admin')
    expect(emTeste(t, false, false)).toBeNull()
    expect(portaoDaRota(rota('/live'), t, true)).toBe('ok')
    expect(portaoDaRota(rota('/imersivo'), t, true)).toBe('ok')
    expect(portaoDaRota(rota('/identidade', { modo: 'imersivo' }), t, true)).toBe('ok')
    expect(portaoDaRota(rota('/kit'), t, true)).toBe('nao-encontrada')
    expect(rotaFechada(rota('/'), acesso({ tester: true, manutencao: true }), true)).toBe(true)
    expect(portaoDaRota(rota('/live'), acesso({ tester: true, manutencao: true }), true)).toBe('manutencao')
    // o público continua fechado
    expect(podeLive(acesso())).toBe(false)
  })

  it('U.tester e U.aviso vêm do servidor conferidos; servidor antigo = false/null', () => {
    expect(normalizarUsuario({ id: 1, apelido: 'A' })?.tester).toBe(false)
    expect(normalizarUsuario({ id: 1, apelido: 'A', tester: 1 })?.tester).toBe(false)
    expect(normalizarUsuario({ id: 1, apelido: 'A', tester: true })?.tester).toBe(true)
    expect(normalizarUsuario({ id: 1, apelido: 'A' })?.aviso).toBeNull()
    expect(normalizarAvisoConta({ texto: '  Uma carreira sua saiu do Hall por: nome ofensivo. ', em: '2026-10-14T12:00:00Z' })).toEqual({ texto: 'Uma carreira sua saiu do Hall por: nome ofensivo.', em: '2026-10-14T12:00:00Z' })
    expect(normalizarAvisoConta({ texto: '' })).toBeNull()
    expect(normalizarAvisoConta({ texto: 5 })).toBeNull()
    expect(normalizarAvisoConta({ texto: 'x'.repeat(900) })?.texto.length).toBe(300)
  })

  it('a conta entrou/saiu: o store de acesso acompanha (tester e logado)', () => {
    useConta.setState({ usuario: normalizarUsuario({ id: 9, apelido: 'Teste', tester: true }) })
    expect(useAcesso.getState().tester).toBe(true)
    expect(useAcesso.getState().logado).toBe(true)
    useConta.setState({ usuario: null })
    expect(useAcesso.getState().tester).toBe(false)
    expect(useAcesso.getState().logado).toBe(false)
  })

  it('o GET conta.php põe a conta de testes antes da config (a rota que ela abre não pisca "não encontrada")', async () => {
    useConta.setState({ usuario: null })
    const visto: boolean[] = []
    const un = useAcesso.subscribe((s, p) => {
      if (s.configPronta && !p.configPronta) visto.push(s.tester)
    })
    useAcesso.setState({ configPronta: false, tester: false })
    rede(() => resposta(200, { usuario: { id: 3, apelido: 'T', tester: true }, regras: {}, site: { livePublica: false } }))
    await useConta.getState().carregar()
    un()
    expect(visto).toEqual([true])
    expect(useAcesso.getState().tester).toBe(true)
  })
})

// ───────────────────────────── H11: aviso da moderação ─────────────────────────────

describe('aviso da moderação para o dono (H11)', () => {
  it('avisoLido: some na hora e manda aviso_lido; sem rede, fica só para a próxima abertura', async () => {
    useConta.setState({ usuario: normalizarUsuario({ id: 7, apelido: 'Teste', aviso: { texto: 'Uma carreira sua saiu do Hall por: nome ofensivo.', em: null } }) })
    const f = rede(() => resposta(200, { ok: true }))
    await useConta.getState().avisoLido()
    expect(useConta.getState().usuario?.aviso).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
    expect(String(f.mock.calls[0][1]?.body)).toContain('"aviso_lido"')
    // sem aviso: nada a mandar
    await useConta.getState().avisoLido()
    expect(f).toHaveBeenCalledTimes(1)
    // sem rede: não lança
    useConta.setState({ usuario: normalizarUsuario({ id: 7, apelido: 'Teste', aviso: { texto: 'x' } }) })
    rede(() => Promise.reject(new TypeError('Failed to fetch')))
    await expect(useConta.getState().avisoLido()).resolves.toBeUndefined()
  })
})

// ───────────────────────────── N14: vários avisos ─────────────────────────────

describe('avisos por público e prazo (N14)', () => {
  const agora = Date.parse('2026-10-14T15:00:00Z')
  const a = (o: Partial<AvisoLista>): AvisoLista => ({ texto: 'Oi', tipo: 'info', publico: 'todos', ate: null, ...o })

  it('normalizarAvisos: só os bons, até 5; servidor antigo = []', () => {
    expect(normalizarAvisos(undefined)).toEqual([])
    expect(normalizarAvisos('x')).toEqual([])
    const l = normalizarAvisos([
      { texto: '  Manutenção às 22h  ', tipo: 'alerta', publico: 'todos', ate: '2026-10-15T02:59:59Z' },
      { texto: '', tipo: 'info' },
      { texto: 'Só logados', publico: 'logados' },
      { texto: 'Público estranho', publico: 'admins' },
      { texto: 'Data ruim', ate: 'amanhã' },
      null,
      { texto: 7 },
    ])
    expect(l).toEqual([
      { texto: 'Manutenção às 22h', tipo: 'alerta', publico: 'todos', ate: '2026-10-15T02:59:59Z' },
      { texto: 'Só logados', tipo: 'info', publico: 'logados', ate: null },
      { texto: 'Data ruim', tipo: 'info', publico: 'todos', ate: null },
    ])
    expect(normalizarAvisos(Array.from({ length: 9 }, (_, i) => ({ texto: `A${i}` }))).length).toBe(AVISOS_MAX)
    expect(normalizarSite({ avisos: [{ texto: 'x' }] }).avisos).toHaveLength(1)
    expect(normalizarSite({}).avisos).toEqual([])
    expect(SITE_PADRAO.avisos).toEqual([])
  })

  it('a faixa mostra os do público de quem está aqui, os que não venceram, sem repetir, alerta primeiro', () => {
    const avisos = [a({ texto: 'Bem-vindo, visitante', publico: 'visitantes' }), a({ texto: 'Bônus em dobro', publico: 'logados' }), a({ texto: 'Venceu', ate: '2026-10-14T14:59:59Z' }), a({ texto: 'Manutenção', tipo: 'alerta', ate: '2026-10-15T02:59:59Z' }), a({ texto: 'Antigo' })]
    const vis = (logado: boolean) => avisosVisiveis({ aviso: { texto: 'Antigo', tipo: 'info' }, avisos, logado }, agora).map((x) => x.texto)
    expect(vis(false)).toEqual(['Manutenção', 'Antigo', 'Bem-vindo, visitante'])
    expect(vis(true)).toEqual(['Manutenção', 'Antigo', 'Bônus em dobro'])
    expect(avisosVisiveis({ aviso: null, avisos: [], logado: false }, agora)).toEqual([])
    expect(proximoVencimento(avisos, agora)).toBe(Date.parse('2026-10-15T02:59:59Z'))
    expect(proximoVencimento([a({})], agora)).toBeNull()
  })

  it('fechados: lê a assinatura única da v3 e a lista da v3.2; guarda sem repetir e com teto', () => {
    expect(lerFechados(null)).toEqual([])
    expect(lerFechados('abc')).toEqual(['abc'])
    expect(lerFechados('["a","b",3]')).toEqual(['a', 'b'])
    expect(lerFechados('[quebrado')).toEqual([])
    expect(comFechado(['a', 'b'], 'a')).toEqual(['b', 'a'])
    let l: string[] = []
    for (let i = 0; i < 40; i++) l = comFechado(l, `s${i}`)
    expect(l).toHaveLength(30)
    expect(l.at(-1)).toBe('s39')
  })
})

// ───────────────────────────── H12, X3, X6 ─────────────────────────────

describe('Destaque e Convide amigos', () => {
  it('destaque do Hall público: só true vale (servidor antigo = sem selo)', () => {
    const base = { id: 'h1', apelido: 'Ana', jogador: 'SILVA', nota: 90, picoOvr: 95 }
    expect(normalizarCarreiraPublica({ ...base, destaque: true })?.destaque).toBe(true)
    expect(normalizarCarreiraPublica({ ...base, destaque: 1 })?.destaque).toBe(false)
    expect(normalizarCarreiraPublica(base)?.destaque).toBe(false)
  })

  it('a promessa do atalho "Convide amigos" sai das regras do painel', () => {
    expect(promessaIndicacao({ indicacao: [2, 3, 5], maxIndicacoes: 3 })).toBe('+2, +3 e +5 de OVR na sua próxima carreira')
    expect(promessaIndicacao({ indicacao: [2, 3, 5], maxIndicacoes: 1 })).toBe('+2 de OVR na sua próxima carreira')
    expect(promessaIndicacao({ indicacao: [4, 4], maxIndicacoes: 5 })).toBe('+4 e +4 de OVR na sua próxima carreira')
    expect(promessaIndicacao({ indicacao: [2, 3, 5], maxIndicacoes: 0 })).toBeNull()
    expect(promessaIndicacao({ indicacao: [0], maxIndicacoes: 3 })).toBeNull()
  })
})

// ───────────────────────────── X4: "Abrir no jogo" do painel ─────────────────────────────

describe('"Abrir no jogo" do painel (X4)', () => {
  it('a rota de admin é só #/resumo com id e de=admin', () => {
    expect(rotaDeAdmin(rota('/resumo', { id: '12', de: 'admin' }))).toBe(true)
    expect(rotaDeAdmin(rota('/resumo', { id: '12' }))).toBe(false)
    expect(rotaDeAdmin(rota('/resumo', { de: 'admin' }))).toBe(false)
    expect(rotaDeAdmin(rota('/hall', { id: '12', de: 'admin' }))).toBe(false)
    // para o público a rota não fecha: segue o resumo de sempre
    expect(portaoDaRota(rota('/resumo', { id: '12', de: 'admin' }), acesso(), true)).toBe('ok')
  })

  it('pede pelo carreiras.id (só dígitos) ou pelo HallEntry.id', () => {
    expect(queryResumoAdmin('123')).toEqual({ r: 'carreira', id: '123' })
    expect(queryResumoAdmin('career-abc')).toEqual({ r: 'carreira', carreiraId: 'career-abc' })
    expect(queryResumoAdmin('x'.repeat(90)).carreiraId).toHaveLength(64)
  })

  it('o meta do admin vem conferido; o estado vira uma frase', () => {
    const m = normalizarMetaAdmin({ id: 5, usuario: { id: 2, apelido: 'Ana', status: 'suspenso', hallBloqueado: true }, nota: 140, oculta: 2, suspeita: 'gols', denuncias: 3, posicaoHall: null, destaque: 1, sinais: [{ nivel: 'grave', codigo: 'x', texto: 'Gols demais' }, { nivel: 'outro', texto: 'leve' }, { texto: '' }], moderacao: { em: '2026-10-14T12:00:00Z', motivo: 'nome' } })!
    expect(m).toMatchObject({ pk: 5, apelido: 'Ana', contaSuspensa: true, hallBloqueado: true, nota: 100, oculta: 2, suspeita: 'gols', denunciasAbertas: 3, destaque: false, moderacao: { motivo: 'nome' } })
    expect(m.sinais).toEqual([
      { nivel: 'grave', codigo: 'x', texto: 'Gols demais' },
      { nivel: 'leve', codigo: '', texto: 'leve' },
    ])
    expect(normalizarMetaAdmin(null)).toBeNull()
    expect(estadoAdmin({ ...m, oculta: 1 }).texto).toBe('Oculta pela moderação')
    expect(estadoAdmin(m).texto).toBe('Escondida por denúncias (esperando a decisão)')
    expect(estadoAdmin({ ...m, oculta: 0, suspeita: 'revisao' }).tom).toBe('aviso')
    expect(estadoAdmin({ oculta: 0, suspeita: null, contaSuspensa: false, hallBloqueado: false, posicaoHall: 4 })).toEqual({ texto: '4º no Hall público', tom: 'ok' })
    expect(estadoAdmin({ oculta: 0, suspeita: null, contaSuspensa: false, hallBloqueado: false, posicaoHall: null }).tom).toBe('neutro')
  })

  it('busca no admin.php: pronta, sessão do painel vencida (401) e carreira que não existe (404)', async () => {
    iniciarResumoAdmin()
    const entry = hall('h-admin', 93, '2026-10-10')
    const f = rede((url) => {
      if (url.includes('id=1&') || url.endsWith('id=1')) return resposta(200, { meta: { id: 1, usuario: { id: 2, apelido: 'Ana' }, oculta: 1 }, denuncias: [], carreira: entry })
      if (url.includes('id=2')) return resposta(401, { erro: 'nao_logado', mensagem: 'Entre com a senha do painel.' })
      return resposta(404, { erro: 'nao_encontrada' })
    })
    const abrir = useResumoAdmin.getState().abrir!
    abrir('1')
    abrir('2')
    abrir('3')
    await vi.waitFor(() => expect(Object.values(useResumoAdmin.getState().abertas).every((a) => a.status !== 'carregando')).toBe(true))
    const ab = useResumoAdmin.getState().abertas
    expect(ab['1']).toMatchObject({ status: 'pronta', meta: { pk: 1, oculta: 1, apelido: 'Ana' } })
    expect(ab['2']).toMatchObject({ status: 'erro', motivo: 'sessao' })
    expect(ab['3']).toMatchObject({ status: 'erro', motivo: 'nao_encontrada' })
    expect(String(f.mock.calls[0][0])).toContain('admin.php?r=carreira&id=1')
    // pronta não pede de novo
    abrir('1')
    expect(f).toHaveBeenCalledTimes(3)
  })
})

// ───────────────────────────── P1-4: a tela de agora na medição ─────────────────────────────

describe('tela de agora na medição (P1-4)', () => {
  it('sessão nova sem view: um view da tela de agora vai na frente (um por sessão)', () => {
    const hb: Evento = { t: 'hb', p: 1, m: 'classico' }
    expect(comTelaDaSessao([hb], true, '/carreira', 1)).toEqual([{ t: 'view', m: null, ts: 1, d: { rota: '/carreira' } }, hb])
    expect(comTelaDaSessao([hb], false, '/carreira')).toEqual([hb])
    const v: Evento = { t: 'view', d: { rota: '/hall' } }
    expect(comTelaDaSessao([v, hb], true, '/carreira')).toEqual([v, hb])
    expect(comTelaDaSessao([hb], true, null)).toEqual([hb])
    expect(comTelaDaSessao([hb], true, 'https://x')).toEqual([hb])
  })

  it('as telas que o servidor aceita (visitas.rota)', () => {
    for (const t of ['/', '/carreira', '/imersivo', '/hall', '/resumo', '/conta', '/conta/carreiras', '/conta/entrar', '/conquistas', '/live']) expect(ROTA_RE.test(t)).toBe(true)
    expect(ROTA_RE.test('/Conta')).toBe(false)
    expect(ROTA_RE.test('/' + 'a'.repeat(24))).toBe(false)
  })

  it('a tela de agora: a rota do jogo, ou o diálogo de tela cheia aberto por cima', () => {
    useApp.setState({ route: { path: '/hall', query: {} }, dialog: null })
    useSiteUi.setState({ dialogo: null })
    expect(telaAtual()).toBe('/hall')
    useApp.setState({ dialog: 'achievements' })
    expect(telaAtual()).toBe('/conquistas')
    useSiteUi.setState({ dialogo: { tipo: 'perfil' } })
    expect(telaAtual()).toBe('/conta')
    useSiteUi.setState({ dialogo: { tipo: 'carreiras' } })
    expect(telaAtual()).toBe('/conta/carreiras')
    useSiteUi.setState({ dialogo: { tipo: 'conta', modo: 'manual' } })
    expect(telaAtual()).toBe('/conta/entrar')
    useSiteUi.setState({ dialogo: null })
    useApp.setState({ dialog: null })
  })

  it('quem chega pelo link de convite (?c=) sem utm vira a origem "convite"', () => {
    expect(utmDaVisita('?c=ABCD2345')).toEqual({ source: 'convite', medium: 'indicacao', campaign: '' })
    expect(utmDaVisita('?c=ABCD2345&utm_source=tiktok')).toEqual({ source: 'tiktok', medium: '', campaign: '' })
    expect(utmDaVisita('?c=AB')).toEqual({ source: '', medium: '', campaign: '' })
    expect(utmDaVisita('')).toEqual({ source: '', medium: '', campaign: '' })
  })
})
