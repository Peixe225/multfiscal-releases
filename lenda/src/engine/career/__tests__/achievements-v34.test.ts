/**
 * v3.4 (servidor/CONTRATO-v34.md §K.2 e §B): os limites novos das 7 conquistas que quase nunca saíam, conferidos na beira
 * de cada regra, e as regras de antes (versão 1), que só a verificação por replay usa para uma carreira jogada antes.
 */
import { describe, expect, it } from 'vitest'
import type { AwardWin, CareerState, SeasonRecord, TrophyWin } from '../../types'
import { data, engine, identity } from '../__fixtures__/play'
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, CONQUISTAS_MUDARAM, CONQUISTAS_REGRAS_V, conquistasMudaramDesde, detectAchievements } from '../achievements'
import { cloneState } from '../engine'

const base = engine.newCareer(data, identity('CA', 'BRA'), 'normal', 'ach-v34')

function rec(age: number, o: Partial<SeasonRecord> & { t?: Partial<TrophyWin>[]; a?: Partial<AwardWin>[] } = {}): SeasonRecord {
  const { t = [], a = [], ...rest } = o
  return {
    season: 2026 + age - 16,
    age,
    clubId: 'bra.1-1',
    leagueId: 'bra.1',
    tier: 1,
    loan: false,
    period: 1,
    role: 'starter',
    ovrStart: 80,
    ovrEnd: 80,
    marketValue: 1e7,
    stats: { apps: 40, goals: 10, assists: 5, rating: 7 },
    country: 'BRA',
    confed: 'CONMEBOL',
    nationality: 'BRA',
    trophies: t.map((x) => ({ trophyId: 'x', competitionId: 'x', season: 2026 + age - 16, teamId: rest.clubId ?? 'bra.1-1', scope: 'club', ...x }) as TrophyWin),
    awards: a.map((x) => ({ award: 'ballon_dor', year: 2027 + age - 16, place: 1, ...x }) as AwardWin),
    ...rest,
  }
}
const withSeasons = (seasons: SeasonRecord[], extra: Partial<CareerState> = {}): CareerState => Object.assign(cloneState(base), { seasons }, extra)
const wc = (): Partial<TrophyWin> => ({ kind: 'world_cup', trophyId: 'world-cup', scope: 'national', teamId: 'BRA', confed: 'CONMEBOL' })
/** n temporadas com `gols` no total (dividido igual) e Copas nas primeiras `copas`. */
function carreira(n: number, gols: number, copas: number, o: Partial<SeasonRecord> = {}): SeasonRecord[] {
  return Array.from({ length: n }, (_, i) => rec(17 + i, { stats: { apps: 45, goals: Math.floor(gols / n) + (i < gols % n ? 1 : 0), assists: 3, rating: 7 }, t: i < copas ? [wc()] : [], ...o }))
}
const SA = ['BRA', 'ARG', 'URU', 'COL', 'CHI', 'PAR', 'PER', 'ECU', 'BOL', 'VEN']

describe('v3.4 · versão das regras', () => {
  it('CONQUISTAS_REGRAS_V = 2 e as 7 que mudaram são do catálogo', () => {
    expect(CONQUISTAS_REGRAS_V).toBe(2)
    expect([...CONQUISTAS_MUDARAM[2]].sort()).toEqual(['baldosero', 'goals_1300', 'legacy_95', 'only_pele', 'records_10', 'ushuaia_to_darien', 'world_cup_4'])
    for (const id of CONQUISTAS_MUDARAM[2]) expect(ACHIEVEMENT_BY_ID[id], id).toBeDefined()
    expect(conquistasMudaramDesde(1).size).toBe(7)
    expect(conquistasMudaramDesde(2).size).toBe(0)
    // os ids continuam os mesmos (as 87; o servidor confere a lista)
    expect(ACHIEVEMENTS.length).toBe(87)
  })
  it('as descrições dizem os números novos (pt-BR)', () => {
    expect(ACHIEVEMENT_BY_ID.only_pele.description).toMatch(/duas Copas do Mundo e marque mais de 800 gols/)
    expect(ACHIEVEMENT_BY_ID.ushuaia_to_darien.description).toMatch(/nove países/)
    expect(ACHIEVEMENT_BY_ID.baldosero.description).toMatch(/23 clubes/)
    expect(ACHIEVEMENT_BY_ID.world_cup_4.description).toMatch(/duas Copas do Mundo e encerre a carreira com Nota de Legado maior que a de Pelé/)
    expect(ACHIEVEMENT_BY_ID.goals_1300.description).toMatch(/1\.050 gols/)
    expect(ACHIEVEMENT_BY_ID.records_10.description).toMatch(/seis recordes/)
    expect(ACHIEVEMENT_BY_ID.legacy_95.description).toMatch(/94 ou mais/)
  })
})

describe('v3.4 · os limites novos, na beira', () => {
  it('Só o Pelé: 2 Copas e MAIS de 800 gols', () => {
    expect(detectAchievements(withSeasons(carreira(20, 801, 2)))).toContain('only_pele')
    expect(detectAchievements(withSeasons(carreira(20, 800, 2)))).not.toContain('only_pele')
    expect(detectAchievements(withSeasons(carreira(20, 1200, 1)))).not.toContain('only_pele')
  })
  it('De Ushuaia a Darién: 9 países da América do Sul', () => {
    const nove = SA.slice(0, 9).map((p, i) => rec(18 + i, { country: p, clubId: `${p.toLowerCase()}.1-1`, confed: 'CONMEBOL' }))
    expect(detectAchievements(withSeasons(nove))).toContain('ushuaia_to_darien')
    expect(detectAchievements(withSeasons(nove.slice(0, 8)))).not.toContain('ushuaia_to_darien')
    // país de fora da CONMEBOL não conta
    const comMex = [...nove.slice(0, 8), rec(30, { country: 'MEX', clubId: 'mex.1-1', confed: 'CONCACAF' })]
    expect(detectAchievements(withSeasons(comMex))).not.toContain('ushuaia_to_darien')
  })
  it('Mochileiro: 23 clubes', () => {
    expect(detectAchievements(withSeasons(Array.from({ length: 23 }, (_, i) => rec(16 + i, { clubId: `c-${i}` }))))).toContain('baldosero')
    expect(detectAchievements(withSeasons(Array.from({ length: 23 }, (_, i) => rec(16 + i, { clubId: `c-${i % 22}` }))))).not.toContain('baldosero')
  })
  it('Fora da curva: 1.050 gols', () => {
    expect(detectAchievements(withSeasons(carreira(22, 1050, 0)))).toContain('goals_1300')
    expect(detectAchievements(withSeasons(carreira(22, 1049, 0)))).not.toContain('goals_1300')
  })
  it('Além do Rei: 2 Copas + nota maior que a de Pelé, só com a carreira encerrada', () => {
    // a carreira-monstro (como a do teste do Hall): 60 gols por temporada, Bola de Ouro todo ano, Copas de 4 em 4 anos
    const monstro = Array.from({ length: 20 }, (_, i) =>
      rec(18 + i, {
        clubId: `c${i % 11}`,
        stats: { apps: 55, goals: 60, assists: 22, rating: 9 },
        a: [{ award: 'ballon_dor', place: 1 }, { award: 'golden_boot', place: 1 }, { award: 'the_best', place: 1 }, { award: 'league_top_scorer', place: 1 }],
        t: [{ kind: 'league', tier: 1 }, ...(i < 6 ? [{ kind: 'continental_primary' as const, confed: 'UEFA' as const }, { kind: 'continental_primary' as const, confed: 'CONMEBOL' as const }] : []), ...(i === 2 || i === 6 ? [wc()] : [])],
      }),
    )
    const fim = { retired: true, phase: 'finished' as const }
    const done = detectAchievements(withSeasons(monstro, fim))
    expect(done).toContain('beat_pele')
    expect(done).toContain('world_cup_4')
    // ainda jogando: não
    expect(detectAchievements(withSeasons(monstro))).not.toContain('world_cup_4')
    // uma Copa só: não (mesmo com a nota)
    const umaCopa = monstro.map((r, i) => (i === 6 ? { ...r, trophies: r.trophies.filter((t) => t.kind !== 'world_cup') } : r))
    expect(detectAchievements(withSeasons(umaCopa, fim))).not.toContain('world_cup_4')
    // a mesma carreira-monstro também passa dos 6 recordes e da nota 94
    expect(done).toContain('records_10')
    expect(done).toContain('legacy_95')
  })
})

describe('v3.4 · as regras de antes (versão 1), para a verificação de carreira antiga', () => {
  it('detectAchievements(s, {regras: 1}) usa a regra antiga só nas 7 que mudaram', () => {
    const s = withSeasons(carreira(20, 801, 2))
    expect(detectAchievements(s)).toContain('only_pele')
    expect(detectAchievements(s, { regras: 1 })).not.toContain('only_pele')
    const tri = withSeasons(carreira(20, 1001, 3))
    expect(detectAchievements(tri, { regras: 1 })).toContain('only_pele')
    // 4 Copas: "Além do Rei" da versão 1 (mesmo sem a nota e sem encerrar)
    const quatro = withSeasons(carreira(20, 100, 4))
    expect(detectAchievements(quatro, { regras: 1 })).toContain('world_cup_4')
    expect(detectAchievements(quatro)).not.toContain('world_cup_4')
    // 23 clubes: v2 sim, v1 não; 24: as duas
    const c23 = withSeasons(Array.from({ length: 23 }, (_, i) => rec(16 + i, { clubId: `c-${i}` })))
    expect(detectAchievements(c23, { regras: 1 })).not.toContain('baldosero')
    const c24 = withSeasons(Array.from({ length: 24 }, (_, i) => rec(16 + i, { clubId: `c-${i}` })))
    expect(detectAchievements(c24, { regras: 1 })).toContain('baldosero')
    // as que não mudaram são iguais nas duas versões
    for (const st of [s, tri, quatro, c23]) {
      const a = detectAchievements(st).filter((id) => !CONQUISTAS_MUDARAM[2].includes(id))
      const b = detectAchievements(st, { regras: 1 }).filter((id) => !CONQUISTAS_MUDARAM[2].includes(id))
      expect(b).toEqual(a)
    }
  })
  it('sem a opção, é a regra de agora (o motor chama assim) e não muta o estado', () => {
    const s = withSeasons(carreira(20, 801, 2))
    const antes = JSON.stringify(s)
    expect(detectAchievements(s)).toEqual(detectAchievements(s, { regras: CONQUISTAS_REGRAS_V }))
    detectAchievements(s, { regras: 1 })
    expect(JSON.stringify(s)).toBe(antes)
  })
})
