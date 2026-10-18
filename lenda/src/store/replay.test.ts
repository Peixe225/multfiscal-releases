/**
 * v3.3 (servidor/CONTRATO-v33.md §B): o replay gravado pelo jogo durante a carreira do Clássico e a verificação por
 * replay (#/verificar). Joga carreiras REAIS das filas de gravação (scripts/gravar/filas/*.json — as mesmas que os
 * criativos repetiram no navegador) pelo store do jogo, com o motor e os dados reais:
 *
 *   - o replay gravado é exatamente o que a fila diz (semente, identidade, ritmo, escolhas: id, tipo, posição do
 *     cartão, canto do pênalti, número de opções), e a carreira dá os mesmos números do `esperado` da fila;
 *   - a verificação joga de novo e bate; um número adulterado no HallEntry (gols, Copas, Libertadores, Bolas de
 *     Ouro, pico, nota, títulos), uma taça trocada, uma escolha mudada ou a semente de outra carreira são acusados.
 *
 * Por padrão roda 6 carreiras que cobrem os três ritmos, empréstimo, volta de empréstimo, fim de ciclo, lesão e o
 * pênalti decisivo; LENDA_REPLAY_TODAS=1 roda as 45 das filas.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { careerEngine } from '@/engine/career/default'
import { LEGACY_VERSION } from '@/engine/legacy/score'
import { hashSeed, rng } from '@/engine/rng'
import { novoReplay, normalizarReplay, parDaSemente, sementeDoPar, type CareerReplay } from '@/engine/replay'
import { compararCarreira, numerosDoResumo, refazerCarreira, resultadoParaServidor, verificarCarreira } from '@/engine/verificar'
import type { GameData, Pace, PlayerIdentity } from '@/engine/types'
import { DADOS_VERSAO } from '@/data/versao'
import { computeLegacy, randomSeed, useCareer, type HallEntry } from './career'
import { useData } from './data'

interface PickFila {
  id: string
  kind: string
  idx: number
  pen: 'left' | 'center' | 'right' | null
  n: number
  title: string
}
interface CarreiraFila {
  nome: string
  a0: number
  a1: number
  identity: PlayerIdentity
  pace: Pace
  picks: PickFila[]
  esperado: { score: number; peak: number; ballonDor: number; trophies: number; goals: number; apps: number; age: number; reason: string }
}

const raiz = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url))
const ler = <T,>(p: string) => JSON.parse(readFileSync(raiz(p), 'utf8')) as T
const FILAS: CarreiraFila[] = [...ler<CarreiraFila[]>('scripts/gravar/filas/classico.json'), ...ler<CarreiraFila[]>('scripts/gravar/filas/intenso.json')]
const PADRAO = ['h-extraordinaria-02', 'v-extraordinaria-03', 'v-boa-03', 'h-ruim-01', 'v-pessima-01', 'v-intenso-06']
const ESCOLHIDAS = process.env.LENDA_REPLAY_TODAS === '1' ? FILAS : FILAS.filter((f) => PADRAO.includes(f.nome))

let data: GameData
const terminadas = new Map<string, HallEntry>()
const avaliar = (r: Parameters<typeof computeLegacy>[0]) => computeLegacy(r)

/** O jogo como no navegador: o store do Clássico, com o crypto.getRandomValues devolvendo a semente da fila. */
async function jogarNoStore(f: { a0: number; a1: number; identity: PlayerIdentity; pace: Pace; picks: { id: string }[] }, opts: { bonusOvr?: number } = {}): Promise<HallEntry> {
  // as filas têm a mesma carreira em dois formatos (vertical e horizontal): o Hall da memória começa vazio a cada uma
  useCareer.setState({ finishedCareers: [], lastFinished: null })
  const espia = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(arr: T): T => {
    if (arr instanceof Uint32Array && arr.length === 2) {
      arr[0] = f.a0
      arr[1] = f.a1
    }
    return arr
  })
  try {
    const seed = randomSeed()
    await useCareer.getState().start(f.identity, f.pace, { seed, bonusOvr: opts.bonusOvr })
  } finally {
    espia.mockRestore()
  }
  for (const p of f.picks) {
    const r = await useCareer.getState().choose(p.id)
    expect(r, `a escolha ${p.id} foi recusada`).not.toBeNull()
    useCareer.getState().ackReveal()
  }
  const fim = useCareer.getState().lastFinished
  expect(fim?.id).toBe(useCareer.getState().state?.id)
  return fim!
}

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => setTimeout(() => cb(0), 0))
  data = ler<GameData>('src/data/generated/game-data.json')
  useData.getState().setData(data, 'real')
  useCareer.setState({ data, engine: careerEngine, engineKind: 'real', status: 'ready', finishedCareers: [], isFixture: false })
})
afterAll(() => {
  vi.unstubAllGlobals()
})

describe('versão dos dados', () => {
  it('DADOS_VERSAO é a do game-data.json (mudou o arquivo: troque em src/data/versao.ts)', () => {
    const txt = readFileSync(raiz('src/data/generated/game-data.json'), 'utf8')
    const esperado = `${(JSON.parse(txt) as GameData).generatedAt.slice(0, 10)}.${hashSeed(txt).toString(16).padStart(8, '0')}`
    expect(DADOS_VERSAO, `ponha DADOS_VERSAO = '${esperado}' em src/data/versao.ts`).toBe(esperado)
  })
})

describe('semente do replay', () => {
  it('o par volta ao mesmo texto, qualquer que seja o corte', () => {
    const r = rng('pares')
    for (let i = 0; i < 2000; i++) {
      const p: [number, number] = [r.int(0, 0xffffffff), r.int(0, i % 3 ? 0xffffffff : 5000)]
      const s = sementeDoPar(p)
      const q = parDaSemente(s)
      expect(q).not.toBeNull()
      expect(sementeDoPar(q!)).toBe(s)
    }
    expect(parDaSemente('xyz')).not.toBeNull()
    expect(parDaSemente('')).toBeNull()
    expect(parDaSemente('a')).toBeNull()
    expect(parDaSemente('ABC')).toBeNull()
    expect(parDaSemente('zzzzzzzzzzzzzzz')).toBeNull()
  })
  it('novoReplay guarda o par original quando ele bate com a semente', () => {
    const id: PlayerIdentity = { surname: 'X', number: 9, foot: 'right', nationality: 'BRA', position: 'CA' }
    expect(novoReplay(sementeDoPar([10, 20]), id, 'normal', 0, [10, 20])?.seed).toEqual([10, 20])
    // par que não bate: tira da própria semente
    const r = novoReplay('a1b2', id, 'normal', 0, [1, 2])
    expect(r && sementeDoPar(r.seed)).toBe('a1b2')
    expect(novoReplay('A!', id, 'normal')).toBeNull()
  })
  it('normalizarReplay recusa o que não é um replay', () => {
    const bom = novoReplay(sementeDoPar([1, 2]), { surname: 'X', number: 9, foot: 'right', nationality: 'BRA', position: 'CA' }, 'normal')!
    expect(normalizarReplay(bom)).toEqual(bom)
    expect(normalizarReplay(null)).toBeNull()
    expect(normalizarReplay({ ...bom, v: 2 })).toBeNull()
    expect(normalizarReplay({ ...bom, seed: [1] })).toBeNull()
    expect(normalizarReplay({ ...bom, seed: [-1, 2] })).toBeNull()
    expect(normalizarReplay({ ...bom, seed: [2 ** 32, 2] })).toBeNull()
    expect(normalizarReplay({ ...bom, pace: 'rapida' })).toBeNull()
    expect(normalizarReplay({ ...bom, picks: 'x' })).toBeNull()
    expect(normalizarReplay({ ...bom, picks: [{ id: '' }] })).toBeNull()
    expect(normalizarReplay({ ...bom, picks: Array.from({ length: 121 }, () => ({ id: 'a' })) })).toBeNull()
    expect(normalizarReplay({ ...bom, identity: { ...bom.identity, foot: 'meio' } })).toBeNull()
  })
})

describe.each(ESCOLHIDAS.map((f) => [f.nome, f] as const))('carreira da fila %s', (_nome, f) => {
  it('o replay gravado é o da fila e a carreira dá os números esperados', async () => {
    const h = await jogarNoStore(f)
    terminadas.set(f.nome, h)
    expect(h.replay).toBeDefined()
    const r = h.replay!
    expect(r.v).toBe(1)
    expect(r.seed).toEqual([f.a0, f.a1])
    expect(r.identity).toEqual(f.identity)
    expect(r.pace).toBe(f.pace)
    expect(r.bonusOvr).toBe(0)
    expect(r.dados).toBe(DADOS_VERSAO)
    expect(r.picks).toEqual(f.picks.map(({ id, kind, idx, pen, n }) => ({ id, kind, idx, pen, n })))
    // o replay fica ao lado (não duplicado dentro de career) e o id é o da semente
    expect((h.career as { replay?: unknown }).replay).toBeUndefined()
    expect(h.id).toBe(`career-${sementeDoPar([f.a0, f.a1])}`)
    // a mesma carreira que a busca offline e o navegador jogaram (a nota da fila é da versão 1 dos pesos da Nota de
    // Legado, de antes do Hall v2: ela não entra; a gravada aqui é a dos pesos de agora)
    const nums = numerosDoResumo(h.summary, h.legacy?.score ?? null)
    expect(h.legacy?.v).toBe(LEGACY_VERSION)
    expect({ peak: nums.pico, ballonDor: nums.bolasOuro, trophies: nums.titulos, goals: nums.gols, apps: nums.jogos, age: h.career.age, reason: h.retiredReason }).toEqual({
      peak: f.esperado.peak,
      ballonDor: f.esperado.ballonDor,
      trophies: f.esperado.trophies,
      goals: f.esperado.goals,
      apps: f.esperado.apps,
      age: f.esperado.age,
      reason: f.esperado.reason,
    })
    // o HallEntry que sobe para a conta (JSON) leva o replay inteiro
    expect(normalizarReplay(JSON.parse(JSON.stringify(h)).replay)).toEqual(r)
  }, 120_000)

  it('a verificação repete a carreira e acusa número adulterado', async () => {
    const h = terminadas.get(f.nome)
    expect(h).toBeDefined()
    const entry = JSON.parse(JSON.stringify(h)) as HallEntry
    const v = await verificarCarreira(careerEngine, data, entry, avaliar, { versaoNota: LEGACY_VERSION })
    expect(v.motivo).toBeNull()
    expect(v.diferencas).toEqual([])
    expect(v.ok).toBe(true)
    expect(v.passos).toBe(f.picks.length)
    expect(v.refeito).toEqual(v.guardado)
    const srv = resultadoParaServidor(v)
    expect(srv.ok).toBe(true)
    expect(JSON.stringify(srv).length).toBeLessThan(4000)

    // um número mexido no resumo guardado (o que o servidor lê) é acusado no campo certo (a carreira refeita é a mesma:
    // joga uma vez só e compara cada adulteração)
    const refeita = await refazerCarreira(careerEngine, data, normalizarReplay(entry.replay)!, avaliar)
    const mexer = async (campo: string, fn: (e: HallEntry) => void, inteira = false) => {
      const e = JSON.parse(JSON.stringify(h)) as HallEntry
      fn(e)
      const x = inteira ? await verificarCarreira(careerEngine, data, e, avaliar, { versaoNota: LEGACY_VERSION }) : compararCarreira(e, refeita, { versaoNota: LEGACY_VERSION })
      expect(x.ok, campo).toBe(false)
      expect(x.diferencas.map((d) => d.campo), campo).toContain(campo)
      return x
    }
    await mexer('gols', (e) => (e.summary.totals.goals += 1))
    await mexer('pico', (e) => (e.summary.peakOvr = e.summary.peakOvr >= 99 ? 98 : e.summary.peakOvr + 1))
    await mexer('nota', (e) => (e.legacy = { ...e.legacy!, score: e.legacy!.score + 1 }))
    await mexer('copas', (e) => {
      const t = e.summary.trophies.find((x) => x.trophyId === 'world-cup')
      if (t) t.count += 1
      else e.summary.trophies.push({ trophyId: 'world-cup', count: 1, seasons: [2030] })
    })
    await mexer('libertadores', (e) => {
      const t = e.summary.trophies.find((x) => x.trophyId === 'libertadores')
      if (t) t.count += 2
      else e.summary.trophies.push({ trophyId: 'libertadores', count: 2, seasons: [2030, 2031] })
    })
    await mexer('bolasOuro', (e) => {
      const a = e.summary.awards.find((x) => x.award === 'ballon_dor')
      if (a) a.count += 1
      else e.summary.awards.push({ award: 'ballon_dor', count: 1, years: [2031] })
    })
    // trocar uma taça por outra deixa o total igual: acusa a troca
    if (h!.summary.trophies.some((x) => x.count > 0))
      await mexer('trofeus', (e) => {
        const t = e.summary.trophies.find((x) => x.count > 0)!
        t.count -= 1
        e.summary.trophies.push({ trophyId: 'taca-inventada', count: 1, seasons: [2030] })
      })
    // uma escolha trocada: a carreira refeita é outra (ou o replay nem anda)
    await mexer(
      'replay',
      (e) => {
        const r = e.replay as CareerReplay
        r.picks = r.picks.slice(0, -1)
      },
      true,
    )
    // o replay de outra carreira colado nesta
    await mexer(
      'id',
      (e) => {
        const r = e.replay as CareerReplay
        r.seed = [(r.seed[0] ^ 1) >>> 0, r.seed[1]]
      },
      true,
    )
  }, 240_000)
})

describe('verificação: casos sem replay', () => {
  it('sem replay, do Imersivo ou com replay estragado: não verifica (e diz por quê)', async () => {
    const base = { id: 'career-x', summary: { peakOvr: 90, trophies: [], awards: [], totals: { apps: 1, goals: 1, assists: 0 } } }
    const a = await verificarCarreira(careerEngine, data, base, avaliar)
    expect(a.ok).toBe(false)
    expect(a.motivo).toMatch(/sem replay/i)
    const b = await verificarCarreira(careerEngine, data, { ...base, mode: 'immersive' }, avaliar)
    expect(b.motivo).toMatch(/Imersivo/)
    const c = await verificarCarreira(careerEngine, data, { ...base, replay: { v: 1, seed: 'x' } }, avaliar)
    expect(c.motivo).toMatch(/estragado/)
  })

  it('carreira com bônus de OVR: o bônus vai no replay e a verificação bate; bônus mexido é acusado', async () => {
    const identity: PlayerIdentity = { surname: 'BONUS', number: 10, foot: 'left', nationality: 'ARG', position: 'MEI' }
    // escolhas sorteadas (sem aposentar antes): o store grava, o replay refaz
    const espia = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(arr: T): T => {
      if (arr instanceof Uint32Array && arr.length === 2) {
        arr[0] = 123456789
        arr[1] = 987654
      }
      return arr
    })
    try {
      await useCareer.getState().start(identity, 'expressa', { seed: randomSeed(), bonusOvr: 4 })
    } finally {
      espia.mockRestore()
    }
    const sorte = rng('bonus-picks')
    for (let i = 0; i < 40 && useCareer.getState().state?.pendingDecision; i++) {
      const d = useCareer.getState().state!.pendingDecision!
      const opts = d.options.filter((o) => !o.id.startsWith('retire-'))
      await useCareer.getState().choose(sorte.pick(opts.length ? opts : d.options).id)
      useCareer.getState().ackReveal()
    }
    const h = useCareer.getState().lastFinished!
    expect(h.career.bonusOvr).toBe(4)
    expect(h.replay?.bonusOvr).toBe(4)
    expect(h.replay?.seed).toEqual([123456789, 987654])
    const ok = await verificarCarreira(careerEngine, data, JSON.parse(JSON.stringify(h)), avaliar, { versaoNota: LEGACY_VERSION })
    expect(ok.diferencas).toEqual([])
    expect(ok.ok).toBe(true)
    const e = JSON.parse(JSON.stringify(h)) as HallEntry
    ;(e.replay as CareerReplay).bonusOvr = 10
    const mexido = await verificarCarreira(careerEngine, data, e, avaliar, { versaoNota: LEGACY_VERSION })
    expect(mexido.ok).toBe(false)
  }, 120_000)

  it('motor de exemplo e carreira de antes da v3.3 não ganham replay', async () => {
    useCareer.setState({ engineKind: 'mock' })
    try {
      const s = await useCareer.getState().start({ surname: 'MOCK', number: 7, foot: 'right', nationality: 'BRA', position: 'CA' }, 'expressa')
      expect(s.replay).toBeUndefined()
    } finally {
      useCareer.setState({ engineKind: 'real' })
    }
    // um estado salvo sem replay (começou antes da atualização) continua sem: nada de replay pela metade
    const s = await useCareer.getState().start({ surname: 'VELHA', number: 7, foot: 'right', nationality: 'BRA', position: 'CA' }, 'expressa')
    const { replay: _r, ...sem } = s
    useCareer.setState({ state: sem as typeof s })
    await useCareer.getState().choose(sem.pendingDecision!.options[0].id)
    expect(useCareer.getState().state?.replay).toBeUndefined()
  }, 60_000)
})
