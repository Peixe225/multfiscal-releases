/**
 * v3.4 (servidor/CONTRATO-v34.md §B): a lista de conquistas de cada carreira (HallEntry.career.achievements — é ela que
 * prova as conquistas na conta) conferida pela verificação por replay, e os números dos critérios novos dos desafios de
 * emblema (Champions, clubes, temporadas no mesmo clube, Copas pela seleção da criação). Joga carreiras REAIS das filas de
 * gravação pelo store, como o navegador.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { careerEngine } from '@/engine/career/default'
import { cloneState } from '@/engine/career/engine'
import { LEGACY_VERSION } from '@/engine/legacy/score'
import { compararCarreira, compararConquistas, conquistasDaCarreira, numerosDoResumo, refazerCarreira, resultadoParaServidor, verificarCarreira } from '@/engine/verificar'
import { normalizarReplay } from '@/engine/replay'
import type { CareerState, GameData, Pace, PlayerIdentity, TrophyWin } from '@/engine/types'
import { computeLegacy, randomSeed, useCareer, type HallEntry } from './career'
import { useData } from './data'

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
let data: GameData
const avaliar = (r: Parameters<typeof computeLegacy>[0]) => computeLegacy(r)

async function jogarNoStore(f: CarreiraFila): Promise<HallEntry> {
  useCareer.setState({ finishedCareers: [], lastFinished: null })
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
    expect(await useCareer.getState().choose(p.id)).not.toBeNull()
    useCareer.getState().ackReveal()
  }
  return useCareer.getState().lastFinished!
}

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => setTimeout(() => cb(0), 0))
  data = ler<GameData>('src/data/generated/game-data.json')
  useData.getState().setData(data, 'real')
  useCareer.setState({ data, engine: careerEngine, engineKind: 'real', status: 'ready', finishedCareers: [], isFixture: false })
})
afterAll(() => vi.unstubAllGlobals())

describe.each(['h-extraordinaria-02', 'v-intenso-06'].map((n) => [n, FILAS.find((f) => f.nome === n)!] as const))('carreira da fila %s', (_n, f) => {
  let h: HallEntry
  it('o HallEntry leva a lista de conquistas da carreira e a verificação confere (bate)', async () => {
    h = await jogarNoStore(f)
    const lista = conquistasDaCarreira(h)
    expect(lista.length).toBeGreaterThan(3)
    // a lista é o career.achievements que o motor juntou (o mesmo que o aparelho desbloqueou nesta carreira)
    expect(lista).toEqual([...new Set(h.career.achievements ?? [])])
    const v = await verificarCarreira(careerEngine, data, JSON.parse(JSON.stringify(h)), avaliar, { versaoNota: LEGACY_VERSION })
    expect(v.ok).toBe(true)
    expect(v.conquistas?.faltam).toEqual([])
    expect(v.conquistas?.aceitas.sort()).toEqual([...lista].sort())
    expect(v.conquistas?.sobram).toEqual([])
    // os números novos saem iguais (guardado × refeito) e vão no resultado
    expect(v.refeito).toEqual(v.guardado)
    const srv = resultadoParaServidor(v)
    expect((srv.detalhes.conquistas as { aceitas: string[] }).aceitas.length).toBe(lista.length)
    expect(JSON.stringify(srv).length).toBeLessThan(8000)
  }, 120_000)

  it('conquista a mais na lista (forjada) não bate; uma a menos só avisa; o servidor com outra lista não bate', async () => {
    const refeita = await refazerCarreira(careerEngine, data, normalizarReplay(h.replay)!, avaliar)
    const lista = conquistasDaCarreira(h)
    const forjada = ['goat', 'beat_all', 'only_pele'].find((id) => !lista.includes(id))!
    const e1 = JSON.parse(JSON.stringify(h)) as HallEntry
    e1.career.achievements = [...lista, forjada]
    const x1 = compararCarreira(e1, refeita, { versaoNota: LEGACY_VERSION })
    expect(x1.ok).toBe(false)
    expect(x1.conclusao).toBe('nao_bateu')
    expect(x1.diferencas.map((d) => d.campo)).toContain('conquistas')
    expect(x1.conquistas?.faltam).toEqual([forjada])
    // tirar uma da lista não é trapaça (a carreira só prova menos): bate, com aviso
    const e2 = JSON.parse(JSON.stringify(h)) as HallEntry
    e2.career.achievements = lista.slice(1)
    const x2 = compararCarreira(e2, refeita, { versaoNota: LEGACY_VERSION })
    expect(x2.ok).toBe(true)
    expect(x2.conquistas?.sobram).toEqual([lista[0]])
    expect(x2.avisos.join(' ')).toMatch(/também dá/)
    // id que o jogo não conhece: o servidor ignora; aqui só aviso
    const e3 = JSON.parse(JSON.stringify(h)) as HallEntry
    e3.career.achievements = [...lista, 'conquista_inventada']
    const x3 = compararCarreira(e3, refeita, { versaoNota: LEGACY_VERSION })
    expect(x3.ok).toBe(true)
    expect(x3.avisos.join(' ')).toMatch(/não conhece/)
    // o servidor guardou uma lista com uma conquista que a carreira não tem: não bate (definitivo)
    const x4 = compararCarreira(JSON.parse(JSON.stringify(h)), refeita, { versaoNota: LEGACY_VERSION, servidor: { copas: null, libertadores: null, titulos: null, bolasOuro: null, pico: null, gols: null, temporadas: null, bonusOvr: null, conquistas: [...lista, forjada] } })
    expect(x4.ok).toBe(false)
    expect(x4.diferencas.find((d) => d.campo === 'servidor')?.rotulo).toMatch(/Conquistas no servidor/)
  }, 120_000)

  it('os números dos critérios de emblema: o resumo mexido é acusado no campo certo', async () => {
    const refeita = await refazerCarreira(careerEngine, data, normalizarReplay(h.replay)!, avaliar)
    const g = numerosDoResumo(h.summary, null, h.replay!.identity.nationality)
    expect(g.clubes).toBe(new Set(h.summary.clubs.map((c) => c.clubId)).size)
    expect(g.mesmoClube).toBeGreaterThanOrEqual(1)
    const mexer = (campo: string, fn: (e: HallEntry) => void) => {
      const e = JSON.parse(JSON.stringify(h)) as HallEntry
      fn(e)
      const x = compararCarreira(e, refeita, { versaoNota: LEGACY_VERSION })
      expect(x.ok, campo).toBe(false)
      expect(x.diferencas.map((d) => d.campo), campo).toContain(campo)
    }
    mexer('clubes', (e) => e.summary.clubs.push({ clubId: 'zzz-1', seasons: 1, apps: 1, goals: 0, assists: 0, trophies: 0, loan: false }))
    mexer('mesmoClube', (e) => (e.summary.clubs[0].seasons += 30))
    mexer('champions', (e) => {
      const t = e.summary.trophies.find((x) => x.trophyId === 'champions-league')
      if (t) t.count += 1
      else e.summary.trophies.push({ trophyId: 'champions-league', count: 1, seasons: [2031] })
    })
    mexer('copasSelecao', (e) => e.summary.national.trophies.push({ trophyId: 'world-cup', competitionId: 'wc', season: 2034, teamId: h.replay!.identity.nationality, scope: 'national', kind: 'world_cup' } as TrophyWin))
  }, 120_000)
})

describe('carreira jogada com as regras de antes (v1)', () => {
  it('uma conquista que só a regra de antes dava vale (4 Copas = "Além do Rei" da v3.3)', () => {
    const f = FILAS[0]
    const s0 = careerEngine.newCareer(data, f.identity, f.pace, 'v34-antiga') as CareerState
    const s = cloneState(s0)
    const wc: TrophyWin = { trophyId: 'world-cup', competitionId: 'wc', season: 2030, teamId: f.identity.nationality, scope: 'national', kind: 'world_cup' }
    s.seasons = Array.from({ length: 4 }, (_, i) => ({
      season: 2030 + i * 4,
      age: 20 + i * 4,
      clubId: 'bra.1-1',
      leagueId: 'bra.1',
      tier: 1,
      loan: false,
      period: 1,
      role: 'starter',
      ovrStart: 80,
      ovrEnd: 80,
      marketValue: 1e7,
      stats: { apps: 30, goals: 5, assists: 2, rating: 7 },
      country: 'BRA',
      confed: 'CONMEBOL',
      nationality: f.identity.nationality,
      trophies: [{ ...wc, season: 2030 + i * 4 }],
      awards: [],
    })) as CareerState['seasons']
    s.achievements = []
    // a lista guardada (de quando a regra era 4 Copas) tem world_cup_4; a regra de agora não dá (não encerrou, sem a nota)
    // (a refeita aqui é o estado final; world_champion sai nas duas versões, goat em nenhuma)
    const c = compararConquistas({ id: s.id, career: { achievements: ['world_cup_4', 'world_champion', 'goat'] } }, s)
    expect(c.aceitas).toEqual(['world_cup_4', 'world_champion'])
    expect(c.faltam).toEqual(['goat'])
  })
})
