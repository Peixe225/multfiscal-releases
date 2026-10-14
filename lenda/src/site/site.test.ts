import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HallEntry } from '@/store/career'
import {
  CORPO_MAX_BYTES,
  FILA_MAX,
  FilaEventos,
  SESSAO_OCIOSA_MS,
  UUID_V4,
  armazem,
  dispositivo,
  dominioDeOrigem,
  montarCorpos,
  obterVisitante,
  origemResumida,
  tocarSessao,
  utmDe,
  uuid4,
  type Armazem,
  type Contexto,
  type Evento,
} from './medicao'
import { REGRAS_PADRAO, deveAbrirConvite, erroApelido, erroEmail, erroSenha, lerInteiro, normalizarRegras, normalizarUsuario, proximoAposAdiar, useConta } from './conta'
import { momentoSeguro, type ContextoConvite } from './convite'
import {
  CARREIRA_MAX_BYTES,
  PICO_AUTO,
  CHAVE_ULTIMA,
  corpoParaSalvar,
  deveSalvarSozinha,
  escolherUltima,
  fimClassico,
  fimImersivo,
  hallEntryValido,
  lerIds,
  lerUltima,
  nesteAparelho,
  normalizarCarreira,
  paraSubirAoEntrar,
  resumoLocal,
  salvaSozinha,
  ultimaCarreira,
} from './carreiras'
import { ErroApi, apiUrl, mensagemDeErro } from './api'

/** Armazém só na memória (sem localStorage no node). */
const mem = (): Armazem & { dados: Map<string, string> } => {
  const dados = new Map<string, string>()
  return { dados, get: (k) => dados.get(k) ?? null, set: (k, v) => void dados.set(k, v) }
}

const ctx = (over: Partial<Contexto> = {}): Contexto => ({ ref: '', utm: { source: '', medium: '', campaign: '' }, dev: 'mobile', lang: 'pt-BR', tela: '390x844', ...over })

function hall(id: string, peakOvr: number, finishedAt: string, extra: Partial<HallEntry> = {}): HallEntry {
  return {
    id,
    finishedAt,
    identity: { surname: id.toUpperCase(), number: 10, foot: 'right', nationality: 'BRA', position: 'MEI' },
    pace: 'normal',
    mode: 'classic',
    summary: {
      identity: { surname: id.toUpperCase(), number: 10, foot: 'right', nationality: 'BRA', position: 'MEI' },
      seasons: 20,
      clubs: [],
      totals: { apps: 600, goals: 300, assists: 150 },
      national: {} as HallEntry['summary']['national'],
      trophies: [
        { trophyId: 'brasileirao', count: 3, seasons: [] },
        { trophyId: 'libertadores', count: 2, seasons: [] },
      ],
      awards: [{ award: 'ballon_dor', count: 2, years: [2030, 2031] }],
      peakOvr,
      peakOvrAge: 27,
      peakValue: 1,
      ballonDorPodiums: [],
      legacyScore: 61.4,
      headline: 'Lenda do Flamengo',
      comparisons: [],
    },
    career: { id, seasons: [{ position: 'PE' }], log: [] } as unknown as HallEntry['career'],
    engine: 'real',
    legacy: { score: 62, raw: 61.7, at: finishedAt },
    ...extra,
  }
}

// ───────────────────────────── medição ─────────────────────────────

describe('medição: visitante e sessão', () => {
  it('uuid4 tem o formato v4', () => {
    for (let i = 0; i < 20; i++) expect(uuid4()).toMatch(UUID_V4)
  })

  it('visitante: cria na primeira vez, mantém depois e troca um valor inválido', () => {
    const ls = mem()
    const v = obterVisitante(ls)
    expect(v).toMatch(UUID_V4)
    expect(obterVisitante(ls)).toBe(v)
    ls.set('lenda:vid', 'lixo')
    const novo = obterVisitante(ls)
    expect(novo).not.toBe('lixo')
    expect(novo).toMatch(UUID_V4)
  })

  it('sessão: a mesma com atividade, nova depois de 30 min parado (com o contexto de agora)', () => {
    const ss = mem()
    const t0 = 1_760_000_000_000
    const a = tocarSessao(ss, t0, () => ctx({ ref: 'tiktok.com' }))
    expect(a.nova).toBe(true)
    expect(a.sid).toMatch(UUID_V4)
    expect(ss.get('lenda:sid')).toBe(a.sid)
    // atividade a cada 29 min: segue a mesma (e o contexto da primeira visita)
    let t = t0
    for (let i = 0; i < 3; i++) {
      t += SESSAO_OCIOSA_MS - 60_000
      const b = tocarSessao(ss, t, () => ctx({ ref: 'google.com' }))
      expect(b.nova).toBe(false)
      expect(b.sid).toBe(a.sid)
      expect(b.ctx.ref).toBe('tiktok.com')
    }
    const c = tocarSessao(ss, t + SESSAO_OCIOSA_MS + 1, () => ctx({ ref: 'google.com' }))
    expect(c.nova).toBe(true)
    expect(c.sid).not.toBe(a.sid)
    expect(c.ctx.ref).toBe('google.com')
  })

  it('armazém com storage bloqueado não lança e guarda na memória', () => {
    const a = armazem(() => {
      throw new Error('SecurityError')
    })
    a.set('x', '1')
    expect(a.get('x')).toBe('1')
  })
})

describe('medição: fila e envio', () => {
  it('fila tem teto: passando de 200, saem os mais antigos', () => {
    const f = new FilaEventos()
    for (let i = 0; i < FILA_MAX + 25; i++) f.push({ t: 'view', d: { i }, ts: i })
    expect(f.tamanho).toBe(FILA_MAX)
    const todos = f.tirarTudo()
    expect(todos[0].d).toEqual({ i: 25 })
    expect(f.tamanho).toBe(0)
  })

  it('falhou o envio: o lote volta para a frente da fila (ordem preservada)', () => {
    const f = new FilaEventos(5)
    f.push({ t: 'view', ts: 1 })
    f.push({ t: 'view', ts: 2 })
    const lote = f.tirarTudo()
    f.push({ t: 'view', ts: 3 })
    f.devolver(lote)
    expect(f.tirarTudo().map((e) => e.ts)).toEqual([1, 2, 3])
    // devolvendo acima do teto, os mais antigos saem
    for (let i = 0; i < 4; i++) f.push({ t: 'view', ts: 10 + i })
    f.devolver([{ t: 'view', ts: 0 }, { t: 'view', ts: 1 }])
    expect(f.tirarTudo().map((e) => e.ts)).toEqual([1, 10, 11, 12, 13])
  })

  it('corpos: JSON válido no formato do contrato e cada um abaixo de 16 KB', () => {
    const cab = { v: uuid4(), s: uuid4(), bot: 0 as const, ctx: ctx({ utm: { source: 'tiktok', medium: 'bio', campaign: '' } }) }
    const eventos: Evento[] = Array.from({ length: 200 }, (_, i) => ({ t: 'view', m: null, d: { rota: '/hall', n: i, texto: 'x'.repeat(120) }, ts: 1_760_000_000_000 + i }))
    eventos.push({ t: 'hb', p: 1, m: 'classico' })
    const corpos = montarCorpos(cab, eventos)
    expect(corpos.length).toBeGreaterThan(1)
    let total = 0
    for (const c of corpos) {
      expect(new TextEncoder().encode(c).length).toBeLessThanOrEqual(CORPO_MAX_BYTES)
      const j = JSON.parse(c) as { v: string; s: string; bot: number; ctx: Contexto; ev: Evento[] }
      expect(j.v).toBe(cab.v)
      expect(j.s).toBe(cab.s)
      expect(j.ctx.utm.source).toBe('tiktok')
      expect(Array.isArray(j.ev)).toBe(true)
      total += j.ev.length
    }
    expect(total).toBe(201)
    expect(JSON.parse(corpos.at(-1)!).ev.at(-1)).toEqual({ t: 'hb', p: 1, m: 'classico' })
  })

  it('corpos: um evento maior que o limite sozinho é descartado (não trava a fila)', () => {
    const cab = { v: uuid4(), s: uuid4(), bot: 1 as const, ctx: ctx() }
    const corpos = montarCorpos(cab, [{ t: 'view', d: { x: 'y'.repeat(20_000) } }, { t: 'login' }])
    expect(corpos).toHaveLength(1)
    expect(JSON.parse(corpos[0]).ev).toEqual([{ t: 'login' }])
    expect(JSON.parse(corpos[0]).bot).toBe(1)
  })

  it('contexto: aparelho, origem e utm', () => {
    expect(dispositivo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 390)).toBe('mobile')
    expect(dispositivo('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari', 412)).toBe('mobile')
    expect(dispositivo('Mozilla/5.0 (Linux; Android 13; SM-X700) Safari', 1200)).toBe('tablet')
    expect(dispositivo('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 1024, 5)).toBe('tablet')
    expect(dispositivo('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome', 1440)).toBe('desktop')
    expect(dispositivo('Mozilla/5.0 (X11; Linux x86_64) Chrome', 500)).toBe('mobile')
    expect(dominioDeOrigem('https://www.tiktok.com/@lenda/video/1', 'oprojeto.online')).toBe('tiktok.com')
    expect(dominioDeOrigem('https://oprojeto.online/lenda/', 'oprojeto.online')).toBe('')
    expect(dominioDeOrigem('', 'oprojeto.online')).toBe('')
    expect(utmDe('?utm_source=tiktok&utm_medium=bio&x=1')).toEqual({ source: 'tiktok', medium: 'bio', campaign: '' })
    expect(origemResumida({ ref: 'vm.tiktok.com', utm: { source: '', medium: '', campaign: '' } })).toBe('tiktok')
    expect(origemResumida({ ref: 'm.youtube.com', utm: { source: '', medium: '', campaign: '' } })).toBe('youtube')
    expect(origemResumida({ ref: 'google.com.br', utm: { source: '', medium: '', campaign: '' } })).toBe('google')
    expect(origemResumida({ ref: '', utm: { source: '', medium: '', campaign: '' } })).toBe('direto')
    expect(origemResumida({ ref: 'google.com', utm: { source: 'TikTok', medium: '', campaign: '' } })).toBe('tiktok')
  })

  it('endereço da API é relativo à pasta do jogo', () => {
    expect(apiUrl('e.php')).toMatch(/\/api\/e\.php$/)
    expect(apiUrl('carreiras.php', { id: 'a b' })).toMatch(/\/api\/carreiras\.php\?id=a\+b$/)
  })
})

// ───────────────────────────── conta e convite ─────────────────────────────

describe('contador de partidas e convite', () => {
  it('contador do aparelho: +1 a cada partida, valor ruim vira 0', () => {
    const ls = mem()
    expect(lerInteiro(ls, 'lenda:partidas')).toBe(0)
    ls.set('lenda:partidas', 'abc')
    expect(lerInteiro(ls, 'lenda:partidas')).toBe(0)
    ls.set('lenda:partidas', '7')
    expect(lerInteiro(ls, 'lenda:partidas')).toBe(7)
    const antes = useConta.getState().partidas
    useConta.getState().contarPartida()
    useConta.getState().contarPartida()
    expect(useConta.getState().partidas).toBe(antes + 2)
  })

  it('abre só depois de 5 partidas e sem conta', () => {
    const r = REGRAS_PADRAO
    expect(deveAbrirConvite({ partidas: 4, regras: r, logado: false, proximoConvite: 0 })).toBe(false)
    expect(deveAbrirConvite({ partidas: 5, regras: r, logado: false, proximoConvite: 0 })).toBe(true)
    expect(deveAbrirConvite({ partidas: 50, regras: r, logado: true, proximoConvite: 0 })).toBe(false)
  })

  it('"Agora não" adia por mais lembrarACada partidas', () => {
    const r = REGRAS_PADRAO
    const prox = proximoAposAdiar(5, r)
    expect(prox).toBe(8)
    expect(deveAbrirConvite({ partidas: 6, regras: r, logado: false, proximoConvite: prox })).toBe(false)
    expect(deveAbrirConvite({ partidas: 7, regras: r, logado: false, proximoConvite: prox })).toBe(false)
    expect(deveAbrirConvite({ partidas: 8, regras: r, logado: false, proximoConvite: prox })).toBe(true)
  })

  it('obrigatório ignora o adiamento', () => {
    const r = { ...REGRAS_PADRAO, obrigatorio: true }
    expect(deveAbrirConvite({ partidas: 5, regras: r, logado: false, proximoConvite: 99 })).toBe(true)
    expect(deveAbrirConvite({ partidas: 4, regras: r, logado: false, proximoConvite: 0 })).toBe(false)
  })

  it('regras do servidor: aceita as válidas, cai no padrão nas ruins', () => {
    expect(normalizarRegras({ aposPartidas: 3, obrigatorio: true, lembrarACada: 2 })).toEqual({ aposPartidas: 3, obrigatorio: true, lembrarACada: 2 })
    expect(normalizarRegras(null)).toEqual(REGRAS_PADRAO)
    expect(normalizarRegras({ aposPartidas: '5', obrigatorio: 'sim', lembrarACada: 0 })).toEqual(REGRAS_PADRAO)
  })

  it('nunca no meio de uma partida, decisão, animação ou na Live', () => {
    const base: ContextoConvite = { rota: '/', liveLigada: false, revelando: false, classicoEmAndamento: false, partidaAoVivo: false, coletiva: false, outroDialogo: false }
    expect(momentoSeguro(base)).toBe(true)
    expect(momentoSeguro({ ...base, rota: '/live' })).toBe(false)
    expect(momentoSeguro({ ...base, rota: '/carreira', liveLigada: true })).toBe(false)
    expect(momentoSeguro({ ...base, rota: '/carreira', revelando: true })).toBe(false)
    expect(momentoSeguro({ ...base, rota: '/carreira', classicoEmAndamento: true })).toBe(false)
    // fim da carreira (tela final do Clássico, sem revelação) pode
    expect(momentoSeguro({ ...base, rota: '/carreira' })).toBe(true)
    expect(momentoSeguro({ ...base, rota: '/imersivo', partidaAoVivo: true })).toBe(false)
    expect(momentoSeguro({ ...base, rota: '/imersivo', coletiva: true })).toBe(false)
    expect(momentoSeguro({ ...base, rota: '/imersivo' })).toBe(true)
    expect(momentoSeguro({ ...base, outroDialogo: true })).toBe(false)
    // em outra tela, a carreira clássica em andamento não segura o convite (ex.: tentando começar outra)
    expect(momentoSeguro({ ...base, rota: '/identidade', classicoEmAndamento: true })).toBe(true)
  })

  it('validação no aparelho igual à do servidor', () => {
    expect(erroApelido('Foguete')).toBeNull()
    expect(erroApelido('João Pé-de_Pano.')).toBeNull()
    expect(erroApelido('A')).not.toBeNull()
    expect(erroApelido(' Foguete')).not.toBeNull()
    expect(erroApelido('x'.repeat(21))).not.toBeNull()
    expect(erroApelido('olá!')).not.toBeNull()
    expect(erroEmail('a@b.com')).toBeNull()
    expect(erroEmail('a@b')).not.toBeNull()
    expect(erroSenha('12345')).not.toBeNull()
    expect(erroSenha('123456')).toBeNull()
    expect(erroSenha('x'.repeat(73))).not.toBeNull()
  })

  it('usuário do servidor: campos ausentes viram valores seguros', () => {
    const u = normalizarUsuario({ id: 12, apelido: 'Foguete', email: 'a@b.com', criadoEm: '2026-10-14T12:00:00Z', timeCoracao: null, uf: 'PE', estatisticas: { partidas: 9, aparelhos: ['mobile', 3] } })
    expect(u?.estatisticas.partidas).toBe(9)
    expect(u?.estatisticas.gols).toBe(0)
    expect(u?.estatisticas.melhorNota).toBeNull()
    expect(u?.estatisticas.aparelhos).toEqual(['mobile'])
    expect(u?.uf).toBe('PE')
    expect(normalizarUsuario(null)).toBeNull()
    expect(normalizarUsuario({ id: 1 })).toBeNull()
  })

  it('erros: a mensagem do servidor vem como veio; sem ela, uma em pt-BR', () => {
    expect(mensagemDeErro(new ErroApi('credenciais', 401, 'E-mail ou senha incorretos.'))).toBe('E-mail ou senha incorretos.')
    expect(mensagemDeErro(new ErroApi('rede', 0))).toMatch(/conexão/)
    expect(mensagemDeErro(new ErroApi('cheio', 409))).toMatch(/limite/)
    expect(mensagemDeErro(new Error('x'))).toMatch(/servidor/)
  })
})

// ───────────────────────────── carreiras ─────────────────────────────

describe('carreiras na conta', () => {
  afterEach(() => vi.restoreAllMocks())

  it('salva sozinha só com pico acima de 89', () => {
    expect(PICO_AUTO).toBe(90)
    expect(salvaSozinha(hall('a', 89, '2026-10-01'))).toBe(false)
    expect(salvaSozinha(hall('a', 90, '2026-10-01'))).toBe(true)
    const p = { logado: true, naConta: new Set<string>(), apagadas: new Set<string>() }
    expect(deveSalvarSozinha(hall('a', 95, '2026-10-01'), p)).toBe(true)
    expect(deveSalvarSozinha(hall('a', 95, '2026-10-01'), { ...p, logado: false })).toBe(false)
    expect(deveSalvarSozinha(hall('a', 95, '2026-10-01'), { ...p, naConta: new Set(['a']) })).toBe(false)
    expect(deveSalvarSozinha(hall('a', 95, '2026-10-01'), { ...p, apagadas: new Set(['a']) })).toBe(false)
    expect(deveSalvarSozinha(hall('a', 89, '2026-10-01'), p)).toBe(false)
  })

  it('ao entrar sobem as 90+ do aparelho que não estão na conta (mais recentes primeiro)', () => {
    const l = [hall('a', 92, '2026-10-01'), hall('b', 85, '2026-10-05'), hall('c', 90, '2026-10-09'), hall('d', 99, '2026-10-03'), hall('e', 97, '2026-10-02')]
    const subir = paraSubirAoEntrar(l, new Set(['d']), new Set(['e']))
    expect(subir.map((h) => h.id)).toEqual(['c', 'a'])
  })

  it('"Neste aparelho": o Hall local que não está na conta, mais recentes primeiro', () => {
    const l = [hall('a', 92, '2026-10-01'), hall('b', 70, '2026-10-05'), hall('c', 90, '2026-10-09')]
    expect(nesteAparelho(l, new Set(['c'])).map((h) => h.id)).toEqual(['b', 'a'])
    expect(nesteAparelho(l, new Set()).map((h) => h.id)).toEqual(['c', 'b', 'a'])
    expect(nesteAparelho(l, new Set(['a', 'b', 'c']))).toEqual([])
    expect(ultimaCarreira(l)?.id).toBe('c')
    expect(ultimaCarreira([])).toBeNull()
  })

  it('resumo local tem os mesmos campos da lista da conta', () => {
    const c = resumoLocal(hall('batista', 93, '2026-10-01T10:00:00Z', { mode: 'immersive' }))
    expect(c).toMatchObject({
      id: 'batista',
      modo: 'imersivo',
      jogador: 'BATISTA',
      numero: 10,
      pais: 'BRA',
      posicao: 'PE',
      nota: 62,
      picoOvr: 93,
      temporadas: 20,
      gols: 300,
      titulos: 5,
      bolasOuro: 2,
      headline: 'Lenda do Flamengo',
      como: null,
      terminouEm: '2026-10-01T10:00:00Z',
    })
  })

  it('lista do servidor: normaliza e descarta o que não tem id', () => {
    expect(normalizarCarreira({ id: 'x', modo: 'imersivo', jogador: 'A', picoOvr: 91, como: 'manual' })).toMatchObject({ id: 'x', modo: 'imersivo', picoOvr: 91, como: 'manual', gols: 0 })
    expect(normalizarCarreira({ id: 'y', como: 'qualquer' })?.como).toBe('auto')
    expect(normalizarCarreira({ jogador: 'sem id' })).toBeNull()
  })

  it('carreira aberta da conta precisa do mínimo para o resumo', () => {
    expect(hallEntryValido(hall('a', 90, '2026-10-01'))).toBe(true)
    expect(hallEntryValido({ id: 'a', identity: {}, summary: {} })).toBe(false)
    expect(hallEntryValido(null)).toBe(false)
  })

  it('corpo para salvar: inteiro; grande demais, sem o diário; ainda grande, erro "grande"', () => {
    const h = hall('a', 90, '2026-10-01')
    const j = JSON.parse(corpoParaSalvar(h, 'auto'))
    expect(j).toMatchObject({ acao: 'salvar', como: 'auto', carreira: { id: 'a' } })
    const grande = hall('b', 90, '2026-10-01', { career: { id: 'b', seasons: [], log: Array.from({ length: 4000 }, (_, i) => ({ texto: 'x'.repeat(200), i })) } as unknown as HallEntry['career'] })
    const leve = JSON.parse(corpoParaSalvar(grande, 'manual'))
    expect(leve.carreira.career.log).toEqual([])
    const enorme = hall('c', 90, '2026-10-01', { career: { id: 'c', seasons: Array.from({ length: 4000 }, () => ({ x: 'y'.repeat(200) })), log: [] } as unknown as HallEntry['career'] })
    expect(() => corpoParaSalvar(enorme, 'manual')).toThrow(ErroApi)
  })

  it('corpo para salvar mede bytes (como o servidor), não caracteres: acento conta 2', () => {
    // ~420 mil caracteres, ~830 mil bytes: pelos caracteres caberia; pelos bytes passa dos 600 KB do servidor
    const log = Array.from({ length: 2000 }, (_, i) => ({ texto: 'ção'.repeat(70), i }))
    const h = hall('acentos', 90, '2026-10-01', { career: { id: 'acentos', seasons: [], log } as unknown as HallEntry['career'] })
    const inteiro = JSON.stringify({ acao: 'salvar', carreira: h, como: 'auto' })
    expect(inteiro.length).toBeLessThan(CARREIRA_MAX_BYTES)
    expect(new TextEncoder().encode(inteiro).length).toBeGreaterThan(600 * 1024)
    const corpo = corpoParaSalvar(h, 'auto')
    expect(JSON.parse(corpo).carreira.career.log).toEqual([])
    expect(new TextEncoder().encode(corpo).length).toBeLessThanOrEqual(CARREIRA_MAX_BYTES)
  })

  it('ids guardados no aparelho: lixo vira conjunto vazio', () => {
    const a = mem()
    expect(lerIds(a, 'k').size).toBe(0)
    a.set('k', '{quebrado')
    expect(lerIds(a, 'k').size).toBe(0)
    a.set('k', JSON.stringify(['a', 3, 'b']))
    expect([...lerIds(a, 'k')]).toEqual(['a', 'b'])
  })
})

describe('fim de carreira nesta janela (pela transição do estado)', () => {
  type St = { id: string; retired?: boolean; phase?: string } | null
  const cl = (state: St, o: { status?: 'idle' | 'restoring' | 'ready'; isFixture?: boolean; reveal?: unknown } = {}) => ({
    status: o.status ?? ('ready' as const),
    isFixture: o.isFixture ?? false,
    state,
    reveal: 'reveal' in o ? o.reveal : null,
  })
  const jogando = { id: 'c1', phase: 'deciding' }
  const acabou = { id: 'c1', retired: true, phase: 'finished' }
  const revelacao = { finished: true }

  it('Clássico: a jogada que encerra a carreira (com revelação) conta, uma vez só', () => {
    expect(fimClassico(cl(acabou, { reveal: revelacao }), cl(jogando))).toBe('c1')
    // depois: a revelação acaba, o Hall chega, outra coisa muda no store — nada conta de novo
    expect(fimClassico(cl(acabou), cl(acabou, { reveal: revelacao }))).toBeNull()
    expect(fimClassico(cl(acabou, { reveal: revelacao }), cl(acabou, { reveal: revelacao }))).toBeNull()
  })

  it('"Jogar novamente" antes de a carreira entrar no Hall não apaga o fim (ele já contou na jogada)', () => {
    expect(fimClassico(cl(acabou, { reveal: revelacao }), cl(jogando))).toBe('c1')
    expect(fimClassico(cl(null), cl(acabou, { reveal: revelacao }))).toBeNull()
  })

  it('abrir o jogo de novo (a carreira já vem encerrada no init) não conta', () => {
    expect(fimClassico(cl(acabou, { status: 'restoring' }), cl(null, { status: 'restoring' }))).toBeNull()
    expect(fimClassico(cl(acabou), cl(acabou, { status: 'restoring' }))).toBeNull()
  })

  it('estado relido de outra janela (sem revelação) ou de outra carreira não conta', () => {
    expect(fimClassico(cl(acabou), cl(jogando))).toBeNull()
    expect(fimClassico(cl({ id: 'c2', retired: true }, { reveal: revelacao }), cl(jogando))).toBeNull()
  })

  it('fixture nunca conta', () => {
    expect(fimClassico(cl(acabou, { reveal: revelacao, isFixture: true }), cl(jogando, { isFixture: true }))).toBeNull()
    expect(fimClassico(cl(acabou, { reveal: revelacao }), cl(jogando, { isFixture: true }))).toBeNull()
  })

  it('Imersivo: a mesma carreira passa a aposentada nesta janela; fixture e restauração nunca', () => {
    const im = (state: { id: string; retired?: boolean } | null, o: { status?: 'idle' | 'restoring' | 'ready'; isFixture?: boolean } = {}) => ({
      status: o.status ?? ('ready' as const),
      isFixture: o.isFixture ?? false,
      state,
    })
    expect(fimImersivo(im({ id: 'i1', retired: true }), im({ id: 'i1', retired: false }))).toBe('i1')
    expect(fimImersivo(im({ id: 'i1', retired: true }), im({ id: 'i1', retired: true }))).toBeNull()
    expect(fimImersivo(im({ id: 'i1', retired: true }), im(null, { status: 'restoring' }))).toBeNull()
    expect(fimImersivo(im({ id: 'i1', retired: true }, { isFixture: true }), im({ id: 'i1' }, { isFixture: true }))).toBeNull()
    expect(fimImersivo(im({ id: 'i2', retired: true }), im({ id: 'i1' }))).toBeNull()
  })
})

describe('"Salvar a última carreira" com a marca da última encerrada', () => {
  const a = hall('a', 80, '2026-10-10T10:00:00Z')
  const b = hall('b', 85, '2026-10-12T10:00:00Z')

  it('sem marca, ou com a marca de uma que está no Hall: a mais recente do Hall', () => {
    expect(escolherUltima([a, b], null)).toEqual({ h: b, perdida: false })
    expect(escolherUltima([a, b], { id: 'a', em: Date.parse('2026-10-13T00:00:00Z') })).toEqual({ h: b, perdida: false })
  })

  it('a última encerrada ficou fora do Hall (teto de 100): não salva outra no lugar dela', () => {
    expect(escolherUltima([a, b], { id: 'cortada', em: Date.parse('2026-10-13T00:00:00Z') })).toEqual({ h: null, perdida: true })
    expect(escolherUltima([], { id: 'cortada', em: 1 })).toEqual({ h: null, perdida: true })
  })

  it('uma mais nova que a marca está no Hall: é ela', () => {
    expect(escolherUltima([a, b], { id: 'velha', em: Date.parse('2026-10-11T00:00:00Z') })).toEqual({ h: b, perdida: false })
  })

  it('marca guardada no aparelho: lixo vira null', () => {
    const m = mem()
    expect(lerUltima(m)).toBeNull()
    m.set(CHAVE_ULTIMA, '{"id":"x","em":12}')
    expect(lerUltima(m)).toEqual({ id: 'x', em: 12 })
    for (const lixo of ['{', '[]', '{"id":1,"em":2}', '{"id":"x","em":"2"}', 'null']) {
      m.set(CHAVE_ULTIMA, lixo)
      expect(lerUltima(m)).toBeNull()
    }
  })
})
