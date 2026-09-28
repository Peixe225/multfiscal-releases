import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { REAL_LEGENDS } from '../../../data/catalog/legends'
import { ACHIEVEMENTS, detectAchievements } from '../../career/achievements'
import { cloneState } from '../../career/engine'
import { data, engine, identity, playCareer } from '../../career/__fixtures__/play'
import type { AwardWin, CareerState, Confed, PlayerIdentity, Position, SeasonRecord, TrophyWin } from '../../types'
import {
  CATEGORY_IDS,
  compareRun,
  evaluateHall,
  evaluateLegends,
  evaluateRun,
  historicRecords,
  LEGACY_WEIGHTS,
  placeRun,
  runStats,
  scoreValues,
  emptyValues,
  type RunInput,
} from '..'

const ID: PlayerIdentity = { surname: 'RIBEIRO', number: 9, foot: 'right', nationality: 'BRA', position: 'CA' }

function rec(age: number, o: Partial<SeasonRecord> & { t?: Partial<TrophyWin>[]; a?: Partial<AwardWin>[] } = {}): SeasonRecord {
  const { t = [], a = [], ...rest } = o
  const season = 2026 + age - 16
  return {
    season,
    age,
    clubId: 'c1',
    leagueId: 'bra.1',
    tier: 1,
    loan: false,
    period: 1,
    role: 'starter',
    ovrStart: 80,
    ovrEnd: 81,
    marketValue: 1e7,
    stats: { apps: 40, goals: 20, assists: 8, rating: 7 },
    country: 'BRA',
    confed: 'CONMEBOL',
    nationality: 'BRA',
    trophies: t.map((x) => ({ trophyId: 'x', competitionId: 'x', season, teamId: rest.clubId ?? 'c1', scope: 'club', ...x }) as TrophyWin),
    awards: a.map((x) => ({ award: 'ballon_dor', year: season + 1, place: 1, ...x }) as AwardWin),
    ...rest,
  }
}
const league = (tier: 1 | 2 = 1, minor = false): Partial<TrophyWin> => ({ kind: 'league', tier, minor })
const primary = (confed: Confed): Partial<TrophyWin> => ({ kind: 'continental_primary', confed })
const wc = (): Partial<TrophyWin> => ({ kind: 'world_cup', scope: 'national', teamId: 'BRA' })
const bdo = (): Partial<AwardWin> => ({ award: 'ballon_dor', place: 1 })
const run = (seasons: SeasonRecord[], extra: Partial<RunInput> = {}): RunInput => ({ id: extra.id ?? 'r', identity: ID, seasons, ...extra })

describe('base de lendas reais', () => {
  it('50 lendas, ids únicos, campos coerentes', () => {
    expect(REAL_LEGENDS.length).toBe(50)
    expect(new Set(REAL_LEGENDS.map((l) => l.id)).size).toBe(50)
    const positions: Position[] = ['GOL', 'ZAG', 'LD', 'LE', 'VOL', 'MC', 'ME', 'MD', 'MEI', 'PE', 'PD', 'CA']
    for (const l of REAL_LEGENDS) {
      expect(positions).toContain(l.position)
      expect(l.nationality).toMatch(/^[A-Z]{3}$/)
      expect(l.clubs.length).toBeGreaterThan(0)
      expect(l.goals).toBeLessThanOrEqual(l.apps)
      expect(l.apps).toBeGreaterThan(300)
      for (const k of ['ballonDor', 'worldCups', 'goldenBoots', 'ucl', 'libertadores', 'leagueTitles', 'otherMajorTitles'] as const) expect(l[k]).toBeGreaterThanOrEqual(0)
      if (l.active) expect(l.years[1]).toBeNull()
    }
    const names = REAL_LEGENDS.map((l) => l.name)
    for (const n of ['Pelé', 'Maradona', 'Messi', 'Cristiano Ronaldo', 'Ronaldo Fenômeno', 'Zico', 'Cruyff', 'Yashin', 'Gerrard']) expect(names).toContain(n)
    // números-âncora (fatos)
    const by = Object.fromEntries(REAL_LEGENDS.map((l) => [l.id, l]))
    expect(by.messi.ballonDor).toBe(8)
    expect(by.pele.worldCups).toBe(3)
    expect(by['cristiano-ronaldo'].ucl).toBe(5)
    expect(by.modric.ucl).toBe(6)
    expect(by.riquelme.libertadores).toBe(3)
    expect(by.messi.goldenBoots).toBe(6)
    expect(by.yashin.ballonDor).toBe(1)
  })

  it('clubId aponta para clubes que existem no jogo (quando há dados gerados)', () => {
    const path = fileURLToPath(new URL('../../../data/generated/game-data.json', import.meta.url))
    if (!existsSync(path)) return
    const clubs = new Map((JSON.parse(readFileSync(path, 'utf8')).clubs as { id: string; name: string }[]).map((c) => [c.id, c.name]))
    for (const l of REAL_LEGENDS) for (const c of l.clubs) if (c.clubId) expect(clubs.has(c.clubId), `${l.name} → ${c.name} (${c.clubId})`).toBe(true)
  })
})

describe('Nota de Legado', () => {
  it('pesos somam 100 e a nota fica em 0–100', () => {
    expect(Object.values(LEGACY_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100)
    const zero = scoreValues({ values: emptyValues(), apps: 0, positionGroup: 'attacking' })
    expect(zero.score).toBe(0)
    const max = scoreValues({ values: { ...emptyValues(), ballonDor: 30, worldCups: 20, goldenBoots: 30, ucl: 30, libertadores: 30, leagueTitles: 99, clubs: 40, goals: 9999, assists: 9999, records: 99, goalsPerGame: 2 }, apps: 2000, positionGroup: 'attacking' })
    expect(max.score).toBe(100)
    expect(max.breakdown.reduce((a, b) => a + b.points, 0)).toBeCloseTo(max.raw, 6)
  })

  it('lendas: Messi no topo, Pelé e Cristiano no top 5, todas entre 0 e 100', () => {
    const L = evaluateLegends()
    expect(L).toHaveLength(50)
    expect(L[0].id).toBe('messi')
    const top5 = L.slice(0, 5).map((l) => l.id)
    expect(top5).toContain('pele')
    expect(top5).toContain('cristiano-ronaldo')
    for (const l of L) {
      expect(l.score).toBeGreaterThanOrEqual(0)
      expect(l.score).toBeLessThanOrEqual(100)
    }
    // mais títulos nunca diminuem a nota
    const base = scoreValues({ values: { ...emptyValues(), goals: 300, goalsPerGame: 0.5 }, apps: 600, positionGroup: 'attacking' })
    const more = scoreValues({ values: { ...emptyValues(), goals: 300, goalsPerGame: 0.5, ballonDor: 1 }, apps: 600, positionGroup: 'attacking' })
    expect(more.raw).toBeGreaterThan(base.raw)
  })
})

describe('números da run (SeasonRecord[])', () => {
  it('conta categorias e ignora taças menores e segunda divisão', () => {
    const seasons = [
      rec(20, { t: [league(), primary('CONMEBOL'), { kind: 'domestic_cup', minor: true }], a: [bdo()] }),
      rec(21, { clubId: 'c2', t: [league(2), primary('UEFA'), wc()], a: [{ award: 'golden_boot', place: 1 }, { award: 'ballon_dor', place: 2 }], national: { apps: 10, goals: 5, assists: 2 } }),
      rec(22, { clubId: 'c2', loan: true, t: [league(1, true)] }),
    ]
    const s = runStats(run(seasons))
    expect(s.values).toMatchObject({ ballonDor: 1, worldCups: 1, goldenBoots: 1, ucl: 1, libertadores: 1, leagueTitles: 1, clubs: 2 })
    expect(s.goals).toBe(65) // 3×20 + 5 da seleção (somados das temporadas: modo Imersivo)
    expect(s.apps).toBe(130)
    expect(s.titles).toBe(7)
    expect(s.values.goalsPerGame).toBeCloseTo(65 / 130)
    expect(s.youngestBallonDorAge).toBe(21)
    expect(s.mainClubId).toBe('c2')
    // totais explícitos da seleção (Clássico) substituem a soma por temporada
    expect(runStats(run(seasons, { national: { apps: 0, goals: 0, assists: 0 } })).goals).toBe(60)
  })

  it('sem temporadas, usa o CareerSummary', () => {
    const s = runStats(
      run([], {
        summary: {
          totals: { apps: 500, goals: 250, assists: 90 },
          clubs: [{ clubId: 'a', seasons: 10, apps: 300, goals: 150, assists: 50, trophies: 3, loan: false }, { clubId: 'b', seasons: 8, apps: 200, goals: 100, assists: 40, trophies: 1, loan: false }],
          awards: [{ award: 'ballon_dor', count: 2, years: [2031, 2032] }],
          trophies: [{ trophyId: 'libertadores', count: 2, seasons: [2030, 2031] }, { trophyId: 'world-cup', count: 1, seasons: [2033] }],
          peakOvr: 91,
        },
      }),
    )
    expect(s.values).toMatchObject({ ballonDor: 2, libertadores: 2, worldCups: 1, clubs: 2, goals: 250 })
    expect(s.ballonDorStreak).toBe(2)
  })
})

describe('recordes', () => {
  const monster = Array.from({ length: 20 }, (_, i) => rec(18 + i, { stats: { apps: 60, goals: 80, assists: 25, rating: 9 }, a: [bdo()], t: i < 7 ? [primary('CONMEBOL')] : [] }))

  it('históricos: supera (não iguala) a marca real', () => {
    const r = historicRecords(runStats(run(monster)))
    const ids = r.map((x) => x.metric)
    expect(ids).toEqual(expect.arrayContaining(['ballonDor', 'ballonDorStreak', 'libertadores', 'goals', 'seasonGoals', 'clubGoals', 'youngestBallonDor']))
    expect(r.find((x) => x.metric === 'ballonDor')!.text).toMatch(/20 Bolas de Ouro: recorde histórico \(antes: Messi, 8\)/)
    expect(r.find((x) => x.metric === 'youngestBallonDor')!.text).toMatch(/aos 19 anos: a mais jovem/)
    // 8 Bolas de Ouro iguala Messi: não é recorde
    const eight = Array.from({ length: 8 }, (_, i) => rec(24 + i, { a: [bdo()] }))
    expect(historicRecords(runStats(run(eight))).some((x) => x.metric === 'ballonDor')).toBe(false)
  })

  it('média de gols só vale com a carreira encerrada e 300+ jogos', () => {
    const st = runStats(run(monster))
    expect(historicRecords(st, { finished: false }).some((x) => x.metric === 'goalsPerGame')).toBe(false)
    expect(historicRecords(st, { finished: true }).some((x) => x.metric === 'goalsPerGame')).toBe(true)
  })

  it('pessoais: contra as runs anteriores, com o nº da run', () => {
    const r1 = run(Array.from({ length: 10 }, (_, i) => rec(20 + i)), { id: 'a', runNo: 1 })
    const r2 = run(Array.from({ length: 12 }, (_, i) => rec(20 + i, { t: i === 3 ? [primary('CONMEBOL')] : [] })), { id: 'b', runNo: 2 })
    const hall = evaluateHall([r2, r1])
    expect(hall.runs.map((r) => r.runNo)).toEqual([1, 2])
    expect(hall.runs[0].personal).toHaveLength(0)
    const p = hall.runs[1].personal
    expect(p.find((x) => x.metric === 'goals')!.text).toBe('240 gols: recorde das suas runs (antes: 200, run nº 1).')
    expect(p.find((x) => x.metric === 'libertadores')!.text).toMatch(/primeira vez nas suas runs/)
    expect(hall.runs[1].values.records).toBe(hall.runs[1].historic.length + p.length)
  })
})

describe('comparações e ranking', () => {
  it('"Sua run nº 3 tem mais Libertadores que Pelé"', () => {
    const seasons = Array.from({ length: 18 }, (_, i) => rec(18 + i, { t: i % 5 === 0 ? [primary('CONMEBOL')] : [] }))
    const r = evaluateRun(run(seasons, { runNo: 3 }))
    expect(r.values.libertadores).toBe(4)
    const texts = compareRun(r, evaluateLegends(), { max: 20 }).map((c) => c.text)
    expect(texts.some((t) => /^Sua run nº 3 tem mais Libertadores que Riquelme \(3\) — ninguém entre as lendas tem mais\.$/.test(t))).toBe(true)
    const r2 = evaluateRun(run(seasons.slice(0, 11), { runNo: 3 }))
    expect(r2.values.libertadores).toBe(3)
    expect(compareRun(r2, evaluateLegends(), { max: 20 }).map((c) => c.text)).toContain('Sua run nº 3 tem mais Libertadores que Pelé (2).')
  })

  it('evaluateHall mistura runs e lendas no geral e em todas as 11 categorias', () => {
    const { state } = playCareer('hall-1', 'normal')
    const { state: s2 } = playCareer('hall-2', 'normal')
    const toRun = (s: CareerState, n: number): RunInput => ({ id: s.id + n, runNo: n, identity: s.identity, seasons: s.seasons, national: s.national })
    const hall = evaluateHall([toRun(state, 1), toRun(s2, 2)])
    expect(hall.overall).toHaveLength(52)
    expect(hall.overall.filter((r) => r.entry.kind === 'run')).toHaveLength(2)
    for (let i = 1; i < hall.overall.length; i++) expect(hall.overall[i].value).toBeLessThanOrEqual(hall.overall[i - 1].value)
    expect(Object.keys(hall.categories).sort()).toEqual([...CATEGORY_IDS].sort())
    // média de gols: só quem tem 300+ jogos
    for (const row of hall.categories.goalsPerGame) expect(row.entry.kind === 'run' ? row.entry.stats.apps : row.entry.apps).toBeGreaterThanOrEqual(300)
    expect(hall.topLegend.id).toBe('messi')
    expect(hall.bestRun).not.toBeNull()
    // determinística
    expect(evaluateHall([toRun(state, 1), toRun(s2, 2)]).overall.map((r) => r.entry.id)).toEqual(hall.overall.map((r) => r.entry.id))
  })

  it('placeRun posiciona uma carreira recém-encerrada', () => {
    const { state } = playCareer('hall-3', 'normal')
    const p = placeRun({ id: state.id, identity: state.identity, seasons: state.seasons, national: state.national }, [])
    expect(p.run.runNo).toBe(1)
    expect(p.total).toBe(51)
    expect(p.rank).toBeGreaterThanOrEqual(1)
    expect(p.legendsBelow).toBe(50 - (p.rank - 1))
  })
})

describe('conquistas em níveis (Hall das Lendas)', () => {
  const base = engine.newCareer(data, identity('CA', 'BRA'), 'normal', 'legacy-ach')
  const withSeasons = (seasons: SeasonRecord[], extra: Partial<CareerState> = {}) => Object.assign(cloneState(base), { seasons }, extra)

  it('catálogo: níveis para todas as categorias, ids únicos', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ['ballon_5', 'ballon_8', 'world_cup_2', 'world_cup_3', 'golden_boot_3', 'ucl_3', 'libertadores_5', 'league_titles_5', 'league_titles_10', 'league_titles_20', 'clubs_3', 'clubs_6', 'clubs_10', 'goals_100', 'goals_1000', 'goals_1300', 'assists_100', 'assists_250', 'assists_400', 'gpg_05', 'gpg_07', 'gpg_09', 'records_1', 'records_5', 'records_10', 'legacy_60', 'legacy_80', 'legacy_95', 'beat_pele', 'legend_top10'])
      expect(ids).toContain(id)
  })

  it('detecção: contagens, média só ao fim, nota e "Maior que Pelé"', () => {
    const seasons = Array.from({ length: 20 }, (_, i) =>
      rec(18 + i, { clubId: `c${i % 11}`, stats: { apps: 55, goals: 60, assists: 22, rating: 9 }, a: [bdo(), { award: 'golden_boot', place: 1 }], t: [league(), ...(i < 6 ? [primary('UEFA'), primary('CONMEBOL')] : []), ...(i % 4 === 0 ? [wc()] : [])] }),
    )
    const running = detectAchievements(withSeasons(seasons))
    expect(running).toEqual(expect.arrayContaining(['goals_100', 'goals_1000', 'ballon_5', 'ballon_8', 'ballon_9', 'world_cup_3', 'world_cup_4', 'ucl_3', 'libertadores_5', 'league_titles_20', 'clubs_10', 'assists_400', 'records_1', 'records_5']))
    expect(running).not.toContain('gpg_09')
    expect(running).not.toContain('legacy_95')
    expect(running).not.toContain('beat_pele')
    const done = detectAchievements(withSeasons(seasons, { retired: true, phase: 'finished' }))
    expect(done).toEqual(expect.arrayContaining(['gpg_05', 'gpg_07', 'gpg_09', 'legacy_60', 'legacy_80', 'legacy_95', 'beat_pele', 'legend_top10', 'beat_all']))
    // uma carreira modesta não ganha as de legado
    const modest = detectAchievements(withSeasons(Array.from({ length: 15 }, (_, i) => rec(18 + i, { stats: { apps: 30, goals: 4, assists: 2, rating: 6.5 } })), { retired: true }))
    expect(modest).not.toContain('legacy_60')
    expect(modest).not.toContain('records_1')
  })
})
