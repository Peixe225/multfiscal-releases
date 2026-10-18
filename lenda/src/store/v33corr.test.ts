/**
 * Correções da v3.3 (servidor/CONTRATO-v33.md §E), lado do jogo: cada `it` é um achado confirmado e falhava antes.
 *
 *   - E.4: a verificação conta as taças com a MESMA regra do servidor (contagem negativa cancelava aqui e virava 0 lá) e
 *     confere os números que o servidor gravou;
 *   - E.5: o bônus de OVR do replay tem de ser o da carreira (e o do servidor);
 *   - E.6: a semente da carreira vem do servidor quando há conta (a do aparelho só sem resposta);
 *   - E.10: carreira de outra versão dos dados: "inconclusiva" (não "não bateu") quando só os números refeitos diferem, e a
 *     versão dela é carregada de dados/<versão>.json quando existe.
 *
 * Com carreiras REAIS das filas de gravação (scripts/gravar/filas), jogadas pelo store como no navegador.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { careerEngine } from '@/engine/career/default'
import { LEGACY_VERSION } from '@/engine/legacy/score'
import { hashSeed } from '@/engine/rng'
import { normalizarReplay, sementeDoPar, type CareerReplay } from '@/engine/replay'
import { compararCarreira, contagem, contagensInvalidas, numerosDoResumo, refazerCarreira, resultadoParaServidor, verificarCarreira, type NumerosServidor } from '@/engine/verificar'
import type { GameData, Pace, PlayerIdentity } from '@/engine/types'
import { DADOS_VERSAO } from '@/data/versao'
import { dadosParaVerificar } from '@/site/verificacao'
import { computeLegacy, randomSeed, useCareer, type HallEntry } from './career'
import { useData } from './data'
import { sementeDaCarreira, useSementeCarreira } from './sementeCarreira'

interface CarreiraFila {
  nome: string
  a0: number
  a1: number
  identity: PlayerIdentity
  pace: Pace
  picks: { id: string }[]
}

const raiz = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url))
const ler = <T,>(p: string) => JSON.parse(readFileSync(raiz(p), 'utf8')) as T
const FILAS: CarreiraFila[] = [...ler<CarreiraFila[]>('scripts/gravar/filas/classico.json'), ...ler<CarreiraFila[]>('scripts/gravar/filas/intenso.json')]
const fila = (nome: string) => FILAS.find((f) => f.nome === nome)!
const avaliar = (r: Parameters<typeof computeLegacy>[0]) => computeLegacy(r)
const copia = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T

let data: GameData
let txtDados: string

/** O jogo como no navegador: o store do Clássico, com o crypto.getRandomValues devolvendo a semente da fila. */
async function jogarNoStore(f: { a0: number; a1: number; identity: PlayerIdentity; pace: Pace; picks: { id: string }[] }, bonusOvr = 0): Promise<HallEntry> {
  useCareer.setState({ finishedCareers: [], lastFinished: null })
  const espia = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(arr: T): T => {
    if (arr instanceof Uint32Array && arr.length === 2) {
      arr[0] = f.a0
      arr[1] = f.a1
    }
    return arr
  })
  try {
    await useCareer.getState().start(f.identity, f.pace, { seed: randomSeed(), bonusOvr: bonusOvr || undefined })
  } finally {
    espia.mockRestore()
  }
  for (const p of f.picks) {
    expect(await useCareer.getState().choose(p.id), `a escolha ${p.id}`).not.toBeNull()
    useCareer.getState().ackReveal()
  }
  return useCareer.getState().lastFinished!
}

/** Os números que o servidor tira da carreira (o meta do admin.php?r=carreira), como o _carreiras.php lê. */
function servidorDe(h: HallEntry, troca: Partial<NumerosServidor> = {}): NumerosServidor {
  const n = numerosDoResumo(h.summary, null)
  return { copas: n.copas, libertadores: n.libertadores, titulos: n.titulos, bolasOuro: n.bolasOuro, pico: n.pico, gols: n.gols, temporadas: n.temporadas, bonusOvr: h.replay?.bonusOvr ?? 0, ...troca }
}

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => setTimeout(() => cb(0), 0))
  txtDados = readFileSync(raiz('src/data/generated/game-data.json'), 'utf8')
  data = JSON.parse(txtDados) as GameData
  useData.getState().setData(data, 'real')
  useCareer.setState({ data, engine: careerEngine, engineKind: 'real', status: 'ready', finishedCareers: [], isFixture: false })
})
afterAll(() => {
  vi.unstubAllGlobals()
})
afterEach(() => {
  useSementeCarreira.setState({ pedir: null })
})

describe('§E.4 · as taças contadas com a regra do servidor, e os números do servidor conferidos', () => {
  it('a contagem é a do servidor (inteiro de 0 a 10.000) e a fora do formato é apontada', () => {
    expect([contagem(3), contagem(-2), contagem(1.6), contagem('2'), contagem(20_000), contagem(Number.NaN)]).toEqual([3, 0, 2, 0, 10_000, 0])
    const s = { trophies: [{ trophyId: 'world-cup', count: 3, seasons: [] }, { trophyId: 'world-cup', count: -2, seasons: [] }], awards: [{ award: 'ballon_dor', count: 1.5, years: [] }] }
    // antes: a soma crua dava 1 Copa (3 - 2); o servidor gravava 3 (o -2 virava 0) e a verificação "batia"
    expect(numerosDoResumo(s as never, null).copas).toBe(3)
    expect(contagensInvalidas(s as never)).toEqual(['world-cup×-2', 'ballon_dor×1.5'])
  })

  it('Copa trocada por [3, -2] numa carreira real: não bate (contagem e servidor), com os números que o servidor gravou', async () => {
    const h = await jogarNoStore(fila('v-otima-04'))
    const ok = await verificarCarreira(careerEngine, data, copia(h), avaliar, { versaoNota: LEGACY_VERSION, servidor: servidorDe(h) })
    expect(ok.diferencas).toEqual([])
    expect(ok.conclusao).toBe('bateu')
    const e = copia(h)
    const wc = e.summary.trophies.find((t) => t.trophyId === 'world-cup')!
    expect(wc.count).toBe(1)
    e.summary.trophies = [...e.summary.trophies.filter((t) => t !== wc), { ...wc, count: 3 }, { ...wc, count: -2 }]
    // o que o servidor gravou dessa carreira: 3 Copas (cada contagem cortada em 0..10.000 e somada)
    const v = await verificarCarreira(careerEngine, data, e, avaliar, { versaoNota: LEGACY_VERSION, servidor: servidorDe(h, { copas: 3 }) })
    expect(v.ok).toBe(false)
    expect(v.conclusao).toBe('nao_bateu')
    const campos = v.diferencas.map((d) => d.campo)
    expect(campos).toContain('contagem')
    expect(campos).toContain('copas')
    expect(resultadoParaServidor(v).detalhes).toMatchObject({ conclusao: 'nao_bateu' })
    // e só o número do servidor diferente (a carreira guardada intacta): também não bate
    const s = compararCarreira(copia(h), await refazerCarreira(careerEngine, data, normalizarReplay(h.replay)!, avaliar), { versaoNota: LEGACY_VERSION, servidor: servidorDe(h, { libertadores: 5 }) })
    expect(s.ok).toBe(false)
    expect(s.diferencas.find((d) => d.campo === 'servidor')).toMatchObject({ rotulo: 'Libertadores no servidor', guardado: 5 })
  }, 120_000)
})

describe('§E.5 · o bônus de OVR do replay', () => {
  it('replay com +10 e o career.bonusOvr apagado: não bate (antes: batia consigo mesmo)', async () => {
    // a mesma semente da fila, com +10 de OVR: a carreira é outra (sempre a 1ª opção que não aposenta)
    const f = fila('v-otima-04')
    useCareer.setState({ finishedCareers: [], lastFinished: null })
    const espia = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(arr: T): T => {
      if (arr instanceof Uint32Array && arr.length === 2) {
        arr[0] = f.a0
        arr[1] = f.a1
      }
      return arr
    })
    try {
      await useCareer.getState().start(f.identity, f.pace, { seed: randomSeed(), bonusOvr: 10 })
    } finally {
      espia.mockRestore()
    }
    for (let i = 0; i < 60 && useCareer.getState().state?.pendingDecision; i++) {
      const d = useCareer.getState().state!.pendingDecision!
      const o = d.options.find((x) => !x.id.startsWith('retire-')) ?? d.options[0]
      await useCareer.getState().choose(o.id)
      useCareer.getState().ackReveal()
    }
    const h = useCareer.getState().lastFinished!
    expect(h.career.bonusOvr).toBe(10)
    expect(h.replay?.bonusOvr).toBe(10)
    const ok = await verificarCarreira(careerEngine, data, copia(h), avaliar, { versaoNota: LEGACY_VERSION, servidor: servidorDe(h) })
    expect(ok.ok).toBe(true)
    const e = copia(h)
    delete (e.career as { bonusOvr?: number }).bonusOvr
    const v = await verificarCarreira(careerEngine, data, e, avaliar, { versaoNota: LEGACY_VERSION, servidor: servidorDe(h, { bonusOvr: 0 }) })
    expect(v.ok).toBe(false)
    expect(v.conclusao).toBe('nao_bateu')
    expect(v.diferencas.map((d) => d.campo)).toContain('bonus')
    // o servidor que gravou outro bônus (o da tabela) também é acusado
    const w = await verificarCarreira(careerEngine, data, copia(h), avaliar, { versaoNota: LEGACY_VERSION, servidor: servidorDe(h, { bonusOvr: 3 }) })
    expect(w.diferencas.map((d) => d.campo)).toContain('bonus')
  }, 120_000)
})

describe('§E.6 · a semente da carreira sorteada pelo servidor', () => {
  it('com a ponte do site: a carreira começa com a semente do servidor (o replay leva o par dela)', async () => {
    const par: [number, number] = [3_000_000_001, 42]
    useSementeCarreira.setState({ pedir: async () => par })
    const seed = await sementeDaCarreira()
    expect(seed).toBe(sementeDoPar(par))
    const s = await useCareer.getState().start({ surname: 'SERVIDOR', number: 9, foot: 'right', nationality: 'BRA', position: 'CA' }, 'expressa', { seed })
    expect(s.id).toBe(`career-${sementeDoPar(par)}`)
    expect(s.replay?.seed).toEqual(par)
  })

  it('sem resposta a tempo, sem conta (null) ou com erro: a semente do aparelho', async () => {
    useSementeCarreira.setState({ pedir: () => new Promise(() => {}) })
    const t0 = Date.now()
    const a = await sementeDaCarreira(80)
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(a).toMatch(/^[0-9a-z]{2,14}$/)
    useSementeCarreira.setState({ pedir: async () => null })
    expect(await sementeDaCarreira()).toMatch(/^[0-9a-z]{2,14}$/)
    useSementeCarreira.setState({ pedir: async () => Promise.reject(new Error('rede')) })
    expect(await sementeDaCarreira()).toMatch(/^[0-9a-z]{2,14}$/)
    useSementeCarreira.setState({ pedir: async () => [-1, 2] as [number, number] })
    expect(await sementeDaCarreira()).toMatch(/^[0-9a-z]{2,14}$/)
  })
})

describe('§E.10 · carreira de outra versão dos dados do jogo', () => {
  it('só os números refeitos diferem e a carreira é de outra versão: inconclusiva (não recusa); com a mesma versão: não bateu', async () => {
    const h = await jogarNoStore(fila('v-otima-04'))
    // os dados "de hoje" mudaram uma rodada: o líder do Brasileirão com +1 vitória (+3 pontos)
    const mudados = copia(data)
    const lider = (mudados.standings as unknown as Record<string, { won: number; points: number; played: number }[]>)['bra.1'][0]
    lider.won += 1
    lider.points += 3
    lider.played += 1
    const e = copia(h)
    ;(e.replay as CareerReplay).dados = '2026-09-01.0badc0de'
    const v = await verificarCarreira(careerEngine, mudados, e, avaliar, { versaoNota: LEGACY_VERSION, servidor: servidorDe(h), dadosUsados: DADOS_VERSAO })
    expect(v.ok).toBe(false)
    expect(v.dados).toMatchObject({ carreira: '2026-09-01.0badc0de', usada: DADOS_VERSAO, exata: false })
    // antes: "não bateu" e o botão que recusa o candidato
    expect(v.conclusao).toBe('inconclusiva')
    expect(resultadoParaServidor(v).detalhes).toMatchObject({ conclusao: 'inconclusiva', dadosExatos: false })
    // a carreira jogada com a mesma versão com que o jogo refez: aí a diferença é prova
    const w = await verificarCarreira(careerEngine, mudados, copia(h), avaliar, { versaoNota: LEGACY_VERSION, servidor: servidorDe(h), dadosUsados: (h.replay as CareerReplay).dados })
    expect(w.ok).toBe(false)
    expect(w.conclusao).toBe('nao_bateu')
    // a diferença que não depende dos dados (a semente de outra carreira) não é inconclusiva nunca
    const x = copia(e)
    ;(x.replay as CareerReplay).seed = [((x.replay as CareerReplay).seed[0] ^ 1) >>> 0, (x.replay as CareerReplay).seed[1]]
    const y = await verificarCarreira(careerEngine, mudados, x, avaliar, { versaoNota: LEGACY_VERSION, dadosUsados: DADOS_VERSAO })
    expect(y.conclusao).toBe('nao_bateu')
  }, 180_000)

  it('dados/<versão>.json: a versão da carreira é carregada e conferida pelo hash do nome; sem ela, os de hoje', async () => {
    const versao = `${String((data as { generatedAt?: string }).generatedAt).slice(0, 10)}.${hashSeed(txtDados).toString(16).padStart(8, '0')}`
    expect(versao).toBe(DADOS_VERSAO)
    const hoje = { clubs: [{ id: 'hoje' }] } as unknown as GameData
    const pedidos: string[] = []
    const buscar = async (u: string) => {
      pedidos.push(u)
      return u.endsWith(`/dados/${versao}.json`) ? new Response(txtDados, { status: 200 }) : new Response('não', { status: 404 })
    }
    // a carreira é de uma versão "velha" que o build publicou (aqui, o mesmo arquivo com o nome dele)
    const a = await dadosParaVerificar(`${versao}`, hoje, buscar)
    expect(a.versao).toBe(DADOS_VERSAO) // a deste jogo: nem pede
    expect(pedidos).toEqual([])
    const outra = '2026-09-01.0badc0de'
    const b = await dadosParaVerificar(outra, hoje, buscar)
    expect(pedidos[0]).toMatch(/\/dados\/2026-09-01\.0badc0de\.json$/)
    expect(b).toEqual({ data: hoje, versao: DADOS_VERSAO }) // 404: os de hoje (e a verificação vai dizer que não é exata)
    // o arquivo existe mas o hash não bate com o nome: não usa
    const c = await dadosParaVerificar(outra, hoje, async () => new Response(txtDados, { status: 200 }))
    expect(c.data).toBe(hoje)
    // o arquivo da versão pedida, com o hash certo: usa
    const nomeCerto = versao.replace(/^\d{4}-\d{2}-\d{2}/, '2026-09-28')
    const txt2 = txtDados.replace(/"generatedAt":\s*"[^"]*"/, '"generatedAt": "2026-09-28T00:00:00.000Z"')
    const v2 = `2026-09-28.${hashSeed(txt2).toString(16).padStart(8, '0')}`
    const d = await dadosParaVerificar(v2, hoje, async (u) => (u.endsWith(`/dados/${v2}.json`) ? new Response(txt2, { status: 200 }) : new Response('', { status: 404 })))
    expect(d.versao).toBe(v2)
    expect(d.data).not.toBe(hoje)
    expect(Array.isArray(d.data.clubs) && d.data.clubs.length > 100).toBe(true)
    expect(nomeCerto).toMatch(/^2026-09-28\./)
    // nome que não é de uma versão (caminho estranho): nem pede
    pedidos.length = 0
    expect((await dadosParaVerificar('../../api/x', hoje, buscar)).data).toBe(hoje)
    expect(pedidos).toEqual([])
  })
})
