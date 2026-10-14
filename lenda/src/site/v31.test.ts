/**
 * Site v3.1 (servidor/CONTRATO-v3.md §12.11): o que o jogo faz quando o servidor falha na hora errada — carreira 90+
 * que não subiu ao entrar, conta que não respondeu na abertura, bônus de OVR sem resposta — e o Hall da comunidade
 * com a próxima atualização no passado. A rede é um fetch de mentira.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEGACY_VERSION } from '@/engine/legacy/score'
import { FalhaBonus } from '@/store/bonusCarreira'
import { useCareer, type HallEntry } from '@/store/career'
import { proximaVencida } from '@/store/comunidade'
import { ErroApi } from './api'
import { usarBonus } from './bonus'
import { pendentesManuais, pendentesNoAparelho, useCarreiras } from './carreiras'
import { normalizarUsuario, useConta } from './conta'
import { sincronizarAoEntrar } from './vigias'

function hall(id: string, peakOvr: number, finishedAt: string): HallEntry {
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
      trophies: [],
      awards: [],
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
    legacy: { score: 62, raw: 61.7, at: finishedAt, v: LEGACY_VERSION },
  } as HallEntry
}

const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
/** fetch de mentira: cada pedido passa por `responder(url, metodo)`. */
function rede(responder: (url: string, metodo: string) => Response | Promise<Response>) {
  const f = vi.fn(async (u: string | URL | Request, init?: RequestInit) => responder(String(u), init?.method ?? 'GET'))
  vi.stubGlobal('fetch', f)
  return f
}

/** localStorage de mentira, novo a cada teste (as filas do aparelho começam vazias). */
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

beforeEach(() => {
  vi.useFakeTimers()
  // "window" mínimo: o armazenamento e os timers (os de mentira do vitest)
  vi.stubGlobal('window', {
    localStorage: armazenamento(),
    setTimeout: (...a: Parameters<typeof setTimeout>) => setTimeout(...a),
    clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
  })
  useCarreiras.getState().limpar()
  useConta.setState({ usuario: normalizarUsuario({ id: 7, apelido: 'Teste' }), lembrado: 'Teste', status: 'pronto' })
  useCareer.setState({ finishedCareers: [hall('noventa', 95, '2026-10-10'), hall('oitenta', 80, '2026-10-12')], lastFinished: null })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('carreira 90+ que não subiu ao entrar (servidor fora na hora)', () => {
  it('GET carreiras.php com 503 logo depois de entrar: a 90+ do aparelho e a do botão vão para a fila', async () => {
    rede(() => resposta(503, { erro: 'servidor' }))
    await sincronizarAoEntrar('oitenta')
    expect(pendentesNoAparelho().has('noventa')).toBe(true)
    expect(pendentesManuais().has('oitenta')).toBe(true)
  })

  it('o salvar da 90+ falha por rede no meio: ela fica na fila; um 409 de regra não fica', async () => {
    expect(pendentesNoAparelho().size).toBe(0)
    rede((_url, metodo) => (metodo === 'GET' ? resposta(200, { carreiras: [], limite: 200, hallPublico: 'auto' }) : resposta(503, { erro: 'servidor' })))
    await sincronizarAoEntrar()
    expect(pendentesNoAparelho().has('noventa')).toBe(true)
    window.localStorage.clear()
    rede((_url, metodo) => (metodo === 'GET' ? resposta(200, { carreiras: [], limite: 200, hallPublico: 'auto' }) : resposta(409, { erro: 'cheio' })))
    await sincronizarAoEntrar()
    expect(pendentesNoAparelho().size).toBe(0)
  })

  it('a fila tenta de novo sozinha na mesma sessão (um 503 não dispara o evento "online")', async () => {
    let falhar = true
    const f = rede((_url, metodo) => (falhar ? resposta(503, { erro: 'servidor' }) : metodo === 'GET' ? resposta(200, { carreiras: [], limite: 200 }) : resposta(200, { carreira: { id: 'noventa' } })))
    await sincronizarAoEntrar()
    expect(pendentesNoAparelho().has('noventa')).toBe(true)
    falhar = false
    const antes = f.mock.calls.length
    await vi.advanceTimersByTimeAsync(310_000) // 30 s, 1 min, 2 min… (a espera cresce a cada falha da sessão)
    expect(f.mock.calls.length).toBeGreaterThan(antes)
    expect(pendentesNoAparelho().has('noventa')).toBe(false)
  })
})

describe('conta que não respondeu na abertura', () => {
  it('quem já entrou neste aparelho pergunta de novo sozinho, com espera crescente, até a conta responder', async () => {
    useConta.setState({ usuario: null, lembrado: 'Teste' })
    let n = 0
    const f = rede(() => (++n < 3 ? resposta(503, { erro: 'servidor' }) : resposta(200, { usuario: { id: 7, apelido: 'Teste' }, regras: {}, site: {} })))
    await useConta.getState().carregar()
    expect(useConta.getState().usuario).toBeNull()
    expect(useConta.getState().status).toBe('pronto')
    await vi.advanceTimersByTimeAsync(3_000) // 2ª tentativa (~2 s)
    expect(f).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(6_000) // 3ª (~4 s)
    expect(f).toHaveBeenCalledTimes(3)
    expect(useConta.getState().usuario?.apelido).toBe('Teste')
  })

  it('quem nunca entrou neste aparelho não fica perguntando', async () => {
    useConta.setState({ usuario: null, lembrado: null })
    const f = rede(() => resposta(503, { erro: 'servidor' }))
    await useConta.getState().carregar()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('bônus de OVR sem resposta', () => {
  it('o "usar" tenta 2 vezes e desiste com o erro de rede (a tela pergunta o que fazer)', async () => {
    const f = rede(() => resposta(503, { erro: 'servidor' }))
    const p = usarBonus('career-abc').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5_000)
    const err = await p
    expect(err).toBeInstanceOf(ErroApi)
    expect((err as ErroApi).status).toBe(503)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('FalhaBonus diz por que não deu (rede, sessão ou recusado antes de usar)', () => {
    expect(new FalhaBonus('rede').tipo).toBe('rede')
    expect(new FalhaBonus('sessao')).toBeInstanceOf(Error)
    expect(new FalhaBonus('outro', 'limite').message).toBe('limite')
  })
})

describe('Hall da comunidade: próxima atualização no passado', () => {
  it('"atualizando agora" quando a hora da próxima já passou', () => {
    const agora = Date.parse('2026-10-14T14:30:00Z')
    expect(proximaVencida('2026-10-14T14:05:00Z', agora)).toBe(true)
    expect(proximaVencida('2026-10-14T14:30:00Z', agora)).toBe(true)
    expect(proximaVencida('2026-10-14T15:05:00Z', agora)).toBe(false)
    expect(proximaVencida(null, agora)).toBe(false)
    expect(proximaVencida('lixo', agora)).toBe(false)
  })
})
