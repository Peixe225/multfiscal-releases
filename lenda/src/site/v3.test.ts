/** Site v3: público × admin, Hall público, conquistas na conta, convite de amigos e bônus de OVR. */
import { describe, expect, it } from 'vitest'
import { portaoDaRota, podeDebug, podeImersivo, podeLive, rotaFechada, rotaImersiva, soAdmin, type Acesso } from '@/store/acesso'
import { useCareer } from '@/store/career'
import { textoRaridade } from '@/store/conquistasSite'
import { assinaturaAviso } from '@/ui/shell/AvisoFaixa'
import { BONUS_PADRAO, SITE_PADRAO, normalizarBonus, normalizarSite } from './acesso'
import { comReintento, ErroApi, esperaReintento, valeTentar } from './api'
import { degrausIndicacao, normalizarBonusInfo, proximoBonus, textoFaltam } from './bonus'
import { HALL_PUBLICO_MAX, idsNoHallPublico, normalizarCarreira, type CarreiraConta } from './carreiras'
import { CHAVE_FILA, doAparelho, lerFila, mesclarConquistas, normalizarConquistas, normalizarRaridade, porNaFila, tirarDaFila } from './conquistas'
import { CHAVE_CONVITE, capturarConvite, codigoValido, conviteGuardado, esquecerConvite, linkConvite } from './indicacao'
import { aindaVale, juntarPaginas, normalizarCarreiraPublica, normalizarPaginaHall, VALIDADE_MS } from './hallPublico'
import { normalizarUsuario } from './conta'
import { ENVIAR_JA, enviarAgora, type Armazem } from './medicao'

const mem = (): Armazem & { dados: Map<string, string> } => {
  const dados = new Map<string, string>()
  return { dados, get: (k) => dados.get(k) ?? null, set: (k, v) => void dados.set(k, v) }
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
  verificarAdmin: null,
  ...o,
})
const rota = (path: string, query: Record<string, string> = {}) => ({ path: path as never, query })

// ───────────────────────────── público × admin ─────────────────────────────

describe('público × admin (site)', () => {
  it('Live e Imersivo fechados para o público; o admin vê tudo', () => {
    const pub = acesso()
    expect(podeLive(pub)).toBe(false)
    expect(podeImersivo(pub)).toBe(false)
    expect(podeDebug(pub, true)).toBe(false)
    const adm = acesso({ admin: true, adminStatus: 'sim' })
    expect(podeLive(adm)).toBe(true)
    expect(podeImersivo(adm)).toBe(true)
    expect(podeDebug(adm, true)).toBe(true)
    expect(soAdmin(adm, adm.imersivoPublico, true)).toBe(true)
    // aberto ao público pelo painel: sem selo de teste
    expect(soAdmin(acesso({ admin: true, imersivoPublico: true }), true, true)).toBe(false)
    expect(podeLive(acesso({ livePublica: true }))).toBe(true)
  })

  it('rotas: #/live e #/kit → "não encontrada"; Imersivo (e a identidade dele) → "em breve"; o resto passa', () => {
    const pub = acesso()
    expect(portaoDaRota(rota('/live'), pub, true)).toBe('nao-encontrada')
    expect(portaoDaRota(rota('/kit'), pub, true)).toBe('nao-encontrada')
    expect(portaoDaRota(rota('/imersivo'), pub, true)).toBe('em-breve')
    expect(portaoDaRota(rota('/identidade', { modo: 'imersivo' }), pub, true)).toBe('em-breve')
    expect(portaoDaRota(rota('/identidade'), pub, true)).toBe('ok')
    expect(portaoDaRota(rota('/hall'), pub, true)).toBe('ok')
    expect(portaoDaRota(rota('/'), pub, true)).toBe('ok')
    expect(rotaImersiva(rota('/identidade', { modo: 'imersivo' }))).toBe(true)
    const adm = acesso({ admin: true, adminStatus: 'sim' })
    for (const p of ['/live', '/kit', '/imersivo']) expect(portaoDaRota(rota(p), adm, true)).toBe('ok')
  })

  it('sem saber ainda (config ou admin no ar): espera em vez de dizer "não"', () => {
    expect(portaoDaRota(rota('/imersivo'), acesso({ adminStatus: 'desconhecido' }), true)).toBe('verificar')
    expect(portaoDaRota(rota('/live'), acesso({ adminStatus: 'verificando' }), true)).toBe('verificar')
    expect(portaoDaRota(rota('/live'), acesso({ configPronta: false }), true)).toBe('verificar')
    // rota aberta não espera nada
    expect(portaoDaRota(rota('/hall'), acesso({ adminStatus: 'desconhecido', configPronta: false }), true)).toBe('ok')
  })

  it('manutenção: tudo fechado para quem não é admin (e o admin joga normalmente)', () => {
    expect(portaoDaRota(rota('/'), acesso({ manutencao: true }), true)).toBe('manutencao')
    expect(portaoDaRota(rota('/hall'), acesso({ manutencao: true, adminStatus: 'desconhecido' }), true)).toBe('verificar')
    expect(portaoDaRota(rota('/'), acesso({ manutencao: true, admin: true, adminStatus: 'sim' }), true)).toBe('ok')
    expect(rotaFechada(rota('/'), acesso({ manutencao: true }), true)).toBe(true)
  })

  it('fora do site (build local / claude.ai) nada muda: tudo aberto', () => {
    expect(portaoDaRota(rota('/live'), acesso(), false)).toBe('ok')
    expect(portaoDaRota(rota('/imersivo'), acesso({ manutencao: true }), false)).toBe('ok')
    expect(podeDebug(acesso(), false)).toBe(true)
    expect(soAdmin(acesso({ admin: true }), false, false)).toBe(false)
  })

  it('config do site: o que vier estranho fica no padrão fechado', () => {
    expect(normalizarSite(null)).toEqual(SITE_PADRAO)
    expect(normalizarSite('lixo')).toEqual(SITE_PADRAO)
    const c = normalizarSite({ imersivoPublico: 1, livePublica: true, manutencao: 'sim', cadastroAberto: false, aviso: { texto: '  Manutenção às 23h  ', tipo: 'alerta' }, bonus: { indicacao: [2, 3, 5, 99], compartilhar: 2 } })
    expect(c.imersivoPublico).toBe(false)
    expect(c.livePublica).toBe(true)
    expect(c.manutencao).toBe(false)
    expect(c.cadastroAberto).toBe(false)
    expect(c.aviso).toEqual({ texto: 'Manutenção às 23h', tipo: 'alerta' })
    expect(c.bonus.indicacao).toEqual([2, 3, 5, 10])
    expect(normalizarSite({ aviso: { texto: '   ' } }).aviso).toBeNull()
    expect(normalizarSite({ aviso: { texto: 'oi', tipo: 'outro' } }).aviso?.tipo).toBe('info')
    expect(normalizarBonus(undefined)).toEqual(BONUS_PADRAO)
    expect(normalizarBonus({ liberaAposPartidas: 4, maxIndicacoes: 3 }).liberaAposPartidas).toBe(4)
  })

  it('aviso: a mesma assinatura para o mesmo texto (fechar não volta), outra para um aviso novo', () => {
    expect(assinaturaAviso('info:Olá')).toBe(assinaturaAviso('info:Olá'))
    expect(assinaturaAviso('info:Olá')).not.toBe(assinaturaAviso('info:Olá!'))
  })
})

// ───────────────────────────── convite de amigos ─────────────────────────────

describe('convite de amigos (?c=)', () => {
  const t0 = Date.parse('2026-10-14T12:00:00Z')
  it('guarda o código da primeira visita por 30 dias; outro link não troca o primeiro', () => {
    const ls = mem()
    expect(capturarConvite('?utm_source=tiktok&c=ABCD2345', ls, t0)).toBe('ABCD2345')
    expect(conviteGuardado(ls, t0 + 1000)).toBe('ABCD2345')
    capturarConvite('?c=ZZZZ9999', ls, t0 + 2000)
    expect(conviteGuardado(ls, t0 + 3000)).toBe('ABCD2345')
    expect(conviteGuardado(ls, t0 + 29 * 86_400_000)).toBe('ABCD2345')
    // venceu: some, e um link novo passa a valer
    expect(conviteGuardado(ls, t0 + 31 * 86_400_000)).toBeNull()
    capturarConvite('?c=ZZZZ9999', ls, t0 + 31 * 86_400_000)
    expect(conviteGuardado(ls, t0 + 31 * 86_400_000 + 1)).toBe('ZZZZ9999')
    esquecerConvite(ls)
    expect(conviteGuardado(ls, t0 + 31 * 86_400_000 + 2)).toBeNull()
  })
  it('código inválido não é guardado; JSON estragado não quebra', () => {
    const ls = mem()
    expect(capturarConvite('?c=<script>', ls, t0)).toBeNull()
    expect(capturarConvite('?c=ab', ls, t0)).toBeNull()
    expect(capturarConvite('', ls, t0)).toBeNull()
    expect(ls.dados.has(CHAVE_CONVITE)).toBe(false)
    ls.set(CHAVE_CONVITE, '{lixo')
    expect(conviteGuardado(ls, t0)).toBeNull()
    expect(codigoValido('ABCD2345')).toBe(true)
    expect(codigoValido('ABCD 2345')).toBe(false)
  })
  it('link de convite', () => {
    expect(linkConvite('ABCD2345', 'https://oprojeto.online/lenda/')).toBe('https://oprojeto.online/lenda/?c=ABCD2345')
    expect(linkConvite(null, 'https://oprojeto.online/lenda/')).toBe('https://oprojeto.online/lenda/')
  })
})

// ───────────────────────────── bônus de OVR ─────────────────────────────

describe('bônus de OVR (bonus.php)', () => {
  const info = {
    liberado: true,
    faltamPartidas: 0,
    disponiveis: [
      { id: 7, valor: 2, origem: 'compartilhar', criadoEm: '2026-10-14T15:00:00Z' },
      { id: 3, valor: 3, origem: 'indicacao', criadoEm: '2026-10-13T15:00:00Z' },
      { id: 9, valor: 0, origem: 'admin', criadoEm: '2026-10-12T15:00:00Z' },
    ],
    usados: 1,
    indicacoes: { validas: 1, pendentes: 1, limite: 3, proximoValor: 3 },
    compartilharHoje: true,
    codigoConvite: 'ABCD2345',
    linkConvite: 'https://oprojeto.online/lenda/?c=ABCD2345',
  }
  it('normaliza e usa primeiro o mais antigo (como o servidor)', () => {
    const b = normalizarBonusInfo(info)!
    expect(b.disponiveis.map((d) => d.id)).toEqual([3, 7])
    expect(proximoBonus(b)).toMatchObject({ valor: 3, origem: 'indicacao' })
    expect(b.linkConvite).toBe('https://oprojeto.online/lenda/?c=ABCD2345')
    expect(normalizarBonusInfo(null)).toBeNull()
    expect(proximoBonus(normalizarBonusInfo({ ...info, disponiveis: [] }))).toBeNull()
    // valor acima do teto do motor é limitado
    expect(normalizarBonusInfo({ ...info, disponiveis: [{ id: 1, valor: 50, origem: 'admin', criadoEm: '' }] })!.disponiveis[0].valor).toBe(10)
    // link que não é http(s) não passa (monta pelo código)
    expect(normalizarBonusInfo({ ...info, linkConvite: 'javascript:alert(1)' })!.linkConvite).toMatch(/\?c=ABCD2345$/)
  })
  it('degraus das indicações: +2 ganho, +3 esperando a 1ª partida do amigo, +5 livre', () => {
    const d = degrausIndicacao(normalizarBonusInfo(info), [2, 3, 5], 3)
    expect(d).toEqual([
      { valor: 2, estado: 'ganho' },
      { valor: 3, estado: 'esperando' },
      { valor: 5, estado: 'livre' },
    ])
    expect(degrausIndicacao(null, [2, 3, 5], 3).every((x) => x.estado === 'livre')).toBe(true)
    // nunca passa do limite (3 amigos), mesmo com o servidor dizendo mais
    const cheio = degrausIndicacao(normalizarBonusInfo({ ...info, indicacoes: { validas: 5, pendentes: 2, limite: 3, proximoValor: null } }), [2, 3, 5], 3)
    expect(cheio).toHaveLength(3)
    expect(cheio.every((x) => x.estado === 'ganho')).toBe(true)
  })
  it('o que falta para liberar', () => {
    expect(textoFaltam(1)).toBe('falta 1 partida')
    expect(textoFaltam(3)).toBe('faltam 3 partidas')
  })
})

// ───────────────────────────── Hall público ─────────────────────────────

describe('Hall público (hall.php)', () => {
  const item = { id: 'career-1', posicao: 1, apelido: 'Foguete', jogador: 'BATISTA', numero: 10, pais: 'BOL', posicaoCampo: 'MEI', nota: 88, picoOvr: 95, temporadas: 21, gols: 500, titulos: 40, bolasOuro: 3, copas: 1, headline: 'Lenda do Cruzeiro', clubes: ['e2022', 7, 'e1'], bonusOvr: 3, terminouEm: '2026-10-14T12:00:00Z' }
  it('normaliza cada carreira (campos fora do formato saem ou ficam no limite)', () => {
    const c = normalizarCarreiraPublica(item)!
    expect(c.clubes).toEqual(['e2022', 'e1'])
    expect(c.bonusOvr).toBe(3)
    expect(normalizarCarreiraPublica({ ...item, nota: 140, pais: 'bolivia', bonusOvr: 40 })).toMatchObject({ nota: 100, pais: '', bonusOvr: 10 })
    expect(normalizarCarreiraPublica({ ...item, id: '' })).toBeNull()
    expect(normalizarCarreiraPublica(null)).toBeNull()
    const p = normalizarPaginaHall({ atualizadoEm: '2026-10-14T15:00:00Z', proximaEm: '2026-10-14T16:00:00Z', total: 120, porPagina: 50, itens: [item, { lixo: 1 }] })
    expect(p.itens).toHaveLength(1)
    expect(p.total).toBe(120)
    expect(normalizarPaginaHall(undefined)).toMatchObject({ itens: [], total: 0 })
  })
  it('páginas sem repetir; cache vale 5 min e nunca depois da próxima atualização do servidor', () => {
    const a = normalizarCarreiraPublica(item)!
    const b = normalizarCarreiraPublica({ ...item, id: 'career-2' })!
    expect(juntarPaginas([a], [a, b]).map((c) => c.id)).toEqual(['career-1', 'career-2'])
    const t = Date.parse('2026-10-14T15:10:00Z')
    expect(aindaVale(t, '2026-10-14T16:00:00Z', t + 60_000)).toBe(true)
    expect(aindaVale(t, '2026-10-14T16:00:00Z', t + VALIDADE_MS)).toBe(false)
    expect(aindaVale(t, '2026-10-14T15:11:00Z', t + 120_000)).toBe(false)
    expect(aindaVale(t, null, t + 1000)).toBe(true)
  })
})

describe('Minhas carreiras: até 3 no Hall público', () => {
  const c = (id: string, nota: number, o: Partial<CarreiraConta> = {}) => normalizarCarreira({ id, nota, notaV: 2, terminouEm: `2026-10-1${id.length}T00:00:00Z`, ...o })!
  const lista = [c('a', 40), c('b', 90), c('c', 70), c('d', 85, { suspeita: 'pico' as unknown as boolean }), c('e', 60, { publica: true }), c('f', 99, { notaV: 1 })]
  it('automático: as 3 de maior nota na versão atual (fora as em análise e as de nota velha)', () => {
    expect([...idsNoHallPublico(lista, 'auto', 2)].sort()).toEqual(['b', 'c', 'e'])
  })
  it('manual: só as marcadas; nenhuma: nenhuma; o que o servidor disser (noHall) vale', () => {
    expect([...idsNoHallPublico(lista, 'manual', 2)]).toEqual(['e'])
    expect(idsNoHallPublico(lista, 'nao', 2).size).toBe(0)
    const doServidor = lista.map((x) => ({ ...x, noHall: x.id === 'a' }))
    expect([...idsNoHallPublico(doServidor, 'auto', 2)]).toEqual(['a'])
    expect(HALL_PUBLICO_MAX).toBe(3)
  })
  it('o perfil vem com o modo do Hall público (padrão: automático)', () => {
    expect(normalizarUsuario({ apelido: 'X' })?.hallPublico).toBe('auto')
    expect(normalizarUsuario({ apelido: 'X', hallPublico: 'manual' })?.hallPublico).toBe('manual')
    expect(normalizarUsuario({ apelido: 'X', hallPublico: 'lixo' })?.hallPublico).toBe('auto')
  })
})

// ───────────────────────────── conquistas na conta ─────────────────────────────

describe('conquistas na conta', () => {
  it('mescla = união, fica a data mais antiga; diz o que desce e o que sobe', () => {
    const local = [
      { id: 'primeiro-gol', em: '2026-10-10T10:00:00.000Z' },
      { id: 'bola-de-ouro', em: '2026-10-12T10:00:00.000Z' },
    ]
    const conta = [
      { id: 'bola-de-ouro', em: '2026-10-11T10:00:00.000Z' },
      { id: 'copa', em: '2026-10-09T10:00:00.000Z' },
    ]
    const m = mesclarConquistas(local, conta)
    expect(Object.fromEntries(m.uniao.map((c) => [c.id, c.em]))).toEqual({ 'primeiro-gol': '2026-10-10T10:00:00.000Z', 'bola-de-ouro': '2026-10-11T10:00:00.000Z', copa: '2026-10-09T10:00:00.000Z' })
    expect(m.descer.map((c) => c.id).sort()).toEqual(['bola-de-ouro', 'copa'])
    expect(m.subir.map((c) => c.id)).toEqual(['primeiro-gol'])
    expect(mesclarConquistas([], []).uniao).toEqual([])
  })
  it('o que vem do servidor é conferido: id válido, data válida (futura vira agora), sem repetir', () => {
    const agora = Date.parse('2026-10-14T12:00:00Z')
    const l = normalizarConquistas(
      {
        conquistas: [
          { id: 'ok_1', em: '2026-10-01T00:00:00Z' },
          { id: 'ok_1', em: '2026-09-01T00:00:00Z' },
          { id: 'Maiúscula', em: '2026-10-01T00:00:00Z' },
          { id: 'futura', em: '2030-01-01T00:00:00Z' },
          { id: 'sem-data' },
          null,
        ],
      },
      agora,
    )
    expect(l).toEqual([
      { id: 'ok_1', em: '2026-09-01T00:00:00.000Z' },
      { id: 'futura', em: '2026-10-14T12:00:00.000Z' },
    ])
    expect(normalizarConquistas({})).toEqual([])
  })
  it('do aparelho: o formato da conta (ids aceitos pelo servidor)', () => {
    const out = doAparelho({ a: { id: 'a', unlockedAt: '2026-10-01T00:00:00Z', careerId: null }, b: { id: 'B!', unlockedAt: '2026-10-01T00:00:00Z', careerId: null } })
    expect(out).toEqual([{ id: 'a', em: '2026-10-01T00:00:00.000Z' }])
  })
  it('fila no aparelho: sobrevive a recarregar, é de uma conta só e sai só o que subiu', () => {
    const ls = mem()
    porNaFila(ls, 7, [{ id: 'a', em: '2026-10-01T00:00:00.000Z' }])
    porNaFila(ls, 7, [{ id: 'b', em: '2026-10-02T00:00:00.000Z' }])
    expect(lerFila(ls)?.itens.map((c) => c.id).sort()).toEqual(['a', 'b'])
    // outra conta no aparelho: a fila da anterior não vai para ela
    porNaFila(ls, 8, [{ id: 'c', em: '2026-10-03T00:00:00.000Z' }])
    expect(lerFila(ls)).toMatchObject({ uid: 8, itens: [{ id: 'c' }] })
    tirarDaFila(ls, 8, [{ id: 'c', em: '2026-10-03T00:00:00.000Z' }])
    expect(lerFila(ls)).toBeNull()
    ls.set(CHAVE_FILA, 'lixo')
    expect(lerFila(ls)).toBeNull()
  })
  it('raridade: "12% dos jogadores" (com poucos jogadores, nada)', () => {
    const r = normalizarRaridade({ jogadores: 200, porConquista: { a: 24, b: 1, c: 0, 'X!': 5 } })!
    expect(r.porConquista).toEqual({ a: 24, b: 1, c: 0 })
    expect(textoRaridade(r, 'a')).toBe('12% dos jogadores')
    expect(textoRaridade(r, 'b')).toBe('Menos de 1% dos jogadores')
    expect(textoRaridade(r, 'c')).toBe('Ninguém ainda')
    expect(textoRaridade({ jogadores: 3, porConquista: { a: 1 } }, 'a')).toBeNull()
    expect(normalizarRaridade({ jogadores: 'x' })).toBeNull()
  })
  it('as que vêm da conta entram no aparelho sem "nova" e ficam com a data mais antiga', () => {
    useCareer.setState({ achievements: { a: { id: 'a', unlockedAt: '2026-10-12T00:00:00.000Z', careerId: 'x' } }, unseenAchievements: [], isFixture: false })
    const novas = useCareer.getState().importAchievements([
      { id: 'a', em: '2026-10-10T00:00:00.000Z' },
      { id: 'b', em: '2026-10-11T00:00:00.000Z' },
    ])
    expect(novas).toEqual(['b'])
    const s = useCareer.getState()
    expect(s.achievements.a.unlockedAt).toBe('2026-10-10T00:00:00.000Z')
    expect(s.achievements.a.careerId).toBe('x')
    expect(s.achievements.b).toMatchObject({ careerId: null, context: 'Da sua conta' })
    expect(s.unseenAchievements).toEqual([])
    expect(s.lastUnlocked).toEqual([])
    expect(useCareer.getState().importAchievements([{ id: 'b', em: '2026-10-11T00:00:00.000Z' }])).toEqual([])
  })
})

// ───────────────────────────── robustez ─────────────────────────────

describe('reintentos com espera crescente', () => {
  it('só tenta de novo falha de rede/servidor; erro de regra sai na hora', async () => {
    const esperas: number[] = []
    const dormir = async (ms: number) => void esperas.push(ms)
    let n = 0
    const r = await comReintento(
      async () => {
        if (++n < 3) throw new ErroApi('rede', 0)
        return 'ok'
      },
      { tentativas: 3, dormir },
    )
    expect(r).toBe('ok')
    expect(esperas).toHaveLength(2)
    expect(esperas[1]).toBeGreaterThan(esperas[0] * 1.2)
    n = 0
    await expect(comReintento(async () => (n++, Promise.reject(new ErroApi('limite', 429))), { dormir })).rejects.toThrow()
    expect(n).toBe(1)
    n = 0
    await expect(comReintento(async () => (n++, Promise.reject(new ErroApi('servidor', 503))), { tentativas: 2, dormir })).rejects.toThrow()
    expect(n).toBe(2)
    expect(valeTentar(new ErroApi('tempo', 0))).toBe(true)
    expect(valeTentar(new ErroApi('nao_logado', 401))).toBe(false)
    expect(valeTentar(new Error('x'))).toBe(false)
  })
  it('espera: 1 s, 2 s, 4 s… com sorteio de ±25% e teto', () => {
    expect(esperaReintento(0, 1000, 30_000, () => 0.5)).toBe(1000)
    expect(esperaReintento(2, 1000, 30_000, () => 0.5)).toBe(4000)
    expect(esperaReintento(10, 1000, 30_000, () => 0.5)).toBe(30_000)
    expect(esperaReintento(0, 1000, 30_000, () => 0)).toBe(750)
    expect(esperaReintento(0, 1000, 30_000, () => 1)).toBe(1250)
  })
})

describe('medição: partidas terminadas vão logo para o servidor (bônus e indicação)', () => {
  it('início e fim de partida saem sem esperar o envio de 10 s (o servidor pareia início e fim); o resto espera', () => {
    expect(ENVIAR_JA.has('jogo_inicio')).toBe(true)
    expect(ENVIAR_JA.has('jogo_fim')).toBe(true)
    expect(ENVIAR_JA.has('partida_fim')).toBe(true)
    for (const t of ['view', 'gate_ver', 'compartilhar', 'cadastro'] as const) expect(ENVIAR_JA.has(t)).toBe(false)
  })
  it('enviarAgora antes de iniciar a medição (fora do site) não espera nada', async () => {
    const t0 = Date.now()
    await enviarAgora()
    expect(Date.now() - t0).toBeLessThan(50)
  })
})
