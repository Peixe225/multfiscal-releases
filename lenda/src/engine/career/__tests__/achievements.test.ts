import { describe, expect, it } from 'vitest'
import type { AwardWin, CareerState, Confed, SeasonRecord, TrophyWin } from '../../types'
import { data, engine, identity, playCareer } from '../__fixtures__/play'
import { ACHIEVEMENTS, detectAchievements } from '../achievements'
import { cloneState } from '../engine'

const base = engine.newCareer(data, identity('CA', 'BRA'), 'normal', 'ach')

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

function withSeasons(seasons: SeasonRecord[], extra: Partial<CareerState> = {}): CareerState {
  const s = cloneState(base)
  s.seasons = seasons
  Object.assign(s, extra)
  return s
}

const league = (confed: Confed = 'CONMEBOL', tier: 1 | 2 = 1): Partial<TrophyWin> => ({ kind: 'league', confed, tier })
const cup = (confed: Confed = 'CONMEBOL'): Partial<TrophyWin> => ({ kind: 'domestic_cup', confed })
const primary = (confed: Confed): Partial<TrophyWin> => ({ kind: 'continental_primary', confed })
const wc = (team = 'BRA'): Partial<TrophyWin> => ({ kind: 'world_cup', scope: 'national', teamId: team, confed: 'CONMEBOL' })

describe('catálogo de conquistas', () => {
  it('20 do Copero + 30 novas, ids únicos, raridades válidas, pt-BR', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(40)
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length)
    for (const a of ACHIEVEMENTS) {
      expect(['comum', 'rara', 'epica', 'lendaria']).toContain(a.rarity)
      expect(a.title.length).toBeGreaterThan(2)
      expect(a.description.length).toBeGreaterThan(10)
      expect(a.description).not.toMatch(/madurez|Ganhe una|salida/)
    }
    const copero = ['king_of_america', 'one_club_legend', 'europe_owner', 'mr_champions', 'goat', 'only_pele', 'black_spider', 'net_terror', 'complete_football', 'most_decorated', 'ringless', 'national_hero', 'the_world_is_yours', 'from_the_periphery', 'ushuaia_to_darien', 'nomad', 'from_the_bottom', 'matagigantes', 'the_treble', 'baldosero']
    for (const id of copero) expect(ACHIEVEMENTS.some((a) => a.id === id)).toBe(true)
  })
})

describe('detecção (pura: estado → ids)', () => {
  it('tríplice coroa exige liga + copa + continental na MESMA temporada (estaduais não contam)', () => {
    expect(detectAchievements(withSeasons([rec(25, { t: [league(), cup(), primary('CONMEBOL')] })]))).toContain('the_treble')
    expect(detectAchievements(withSeasons([rec(25, { t: [league(), cup()] }), rec(26, { t: [primary('CONMEBOL')] })]))).not.toContain('the_treble')
    expect(detectAchievements(withSeasons([rec(25, { t: [league(), { kind: 'domestic_cup', minor: true }, primary('CONMEBOL')] })]))).not.toContain('the_treble')
  })

  it('Libertadores, Rei da América (3), Orelhuda, Mr. Champions (5)', () => {
    const three = withSeasons([20, 21, 22].map((a) => rec(a, { t: [primary('CONMEBOL')] })))
    expect(detectAchievements(three)).toEqual(expect.arrayContaining(['libertadores', 'tri_libertadores', 'first_title']))
    const five = withSeasons([25, 26, 27, 28, 29].map((a) => rec(a, { confed: 'UEFA', t: [primary('UEFA')] })))
    expect(detectAchievements(five)).toEqual(expect.arrayContaining(['orelhuda', 'mr_champions']))
  })

  it('Hexa, campeão do mundo, herói nacional e "O mundo é seu"', () => {
    const bra = detectAchievements(withSeasons([rec(27, { t: [wc('BRA'), { kind: 'club_world_cup' }] })]))
    expect(bra).toEqual(expect.arrayContaining(['hexa', 'world_champion', 'the_world_is_yours']))
    expect(bra).not.toContain('national_hero')
    expect(detectAchievements(withSeasons([rec(27, { t: [wc('MAR')] })]))).toContain('national_hero')
  })

  it('Bola de Ouro (1, tri), só vitórias contam; Da periferia ao topo', () => {
    const podium = withSeasons([rec(26, { a: [{ award: 'ballon_dor', place: 2 }] })])
    expect(detectAchievements(podium)).not.toContain('ballon_dor')
    const tri = withSeasons([26, 27, 28].map((a) => rec(a, { a: [{ award: 'ballon_dor' }] })))
    expect(detectAchievements(tri)).toEqual(expect.arrayContaining(['ballon_dor', 'ballon_tri']))
    expect(detectAchievements(tri)).not.toContain('from_the_periphery')
    const jap = cloneState(tri)
    jap.identity = { ...jap.identity, nationality: 'JPN' }
    jap.seasons = jap.seasons.map((r) => ({ ...r, nationality: 'JPN' }))
    expect(detectAchievements(jap)).toContain('from_the_periphery')
  })

  it('Dono da Europa: as cinco grandes ligas', () => {
    const big = ['ESP', 'ENG', 'ITA', 'GER', 'FRA'].map((c, i) => rec(24 + i, { country: c, confed: 'UEFA', t: [league('UEFA')] }))
    expect(detectAchievements(withSeasons(big))).toContain('europe_owner')
    expect(detectAchievements(withSeasons(big.slice(0, 4)))).not.toContain('europe_owner')
  })

  it('gols, jogos, assistências e goleiro', () => {
    const many = withSeasons(Array.from({ length: 20 }, (_, i) => rec(16 + i, { stats: { apps: 52, goals: 42, assists: 9, cleanSheets: 14, rating: 7 } })))
    const ids = detectAchievements(many)
    expect(ids).toEqual(expect.arrayContaining(['goals_300', 'goals_500', 'goals_800', 'apps_500', 'apps_1000', 'playmaker', 'wall', 'idol']))
  })

  it('conquistas de resumo só com a carreira encerrada', () => {
    const seasons = Array.from({ length: 24 }, (_, i) => rec(16 + i))
    const running = withSeasons(seasons)
    expect(detectAchievements(running)).not.toContain('one_club_only')
    expect(detectAchievements(running)).not.toContain('ringless')
    const done = withSeasons(seasons, { retired: true, phase: 'finished' })
    expect(detectAchievements(done)).toEqual(expect.arrayContaining(['one_club_only', 'ringless', 'never_relegated']))
    const legend = withSeasons(
      seasons.map((r, i) => (i === 5 ? { ...r, trophies: [league(), cup(), primary('CONMEBOL')].map((t) => ({ trophyId: 'x', competitionId: 'x', season: r.season, teamId: r.clubId, scope: 'club', ...t }) as TrophyWin) } : r)),
      { retired: true },
    )
    expect(detectAchievements(legend)).toContain('one_club_legend')
  })

  it('do acesso ao título, lá de baixo e matador de gigantes', () => {
    const s = withSeasons([
      rec(16, { clubId: 'bra.2-3', tier: 2, leagueId: 'bra.2', promoted: true }),
      rec(17, { clubId: 'bra.2-3', t: [league()] }),
    ])
    expect(detectAchievements(s)).toEqual(expect.arrayContaining(['promotion_to_title', 'from_the_bottom']))
    expect(detectAchievements(withSeasons([rec(25, { clubPrestige: 1, t: [primary('CONMEBOL')] })]))).toContain('matagigantes')
    expect(detectAchievements(withSeasons([rec(25, { clubPrestige: 5, t: [primary('CONMEBOL')] })]))).not.toContain('matagigantes')
  })

  it('nômade, globetrotter e mochileiro', () => {
    const confeds: Confed[] = ['UEFA', 'CONMEBOL', 'CONCACAF', 'CAF', 'AFC', 'OFC']
    const s = withSeasons(confeds.map((c, i) => rec(20 + i, { confed: c, country: `C${i}`, clubId: `club-${i}` })))
    expect(detectAchievements(s)).toEqual(expect.arrayContaining(['nomad', 'globetrotter']))
    const s24 = withSeasons(Array.from({ length: 24 }, (_, i) => rec(16 + i, { clubId: `c-${i}` })))
    expect(detectAchievements(s24)).toContain('baldosero')
  })

  it('não muta o estado e é determinística', () => {
    const { state } = playCareer('ach-pure', 'normal')
    const before = JSON.stringify(state)
    const a = detectAchievements(state)
    const b = detectAchievements(state)
    expect(a).toEqual(b)
    expect(JSON.stringify(state)).toBe(before)
    // o que o motor registrou bate com a detecção
    expect([...(state.achievements ?? [])].sort()).toEqual([...a].sort())
  })

  it('RevealScript.achievements lista só as desbloqueadas naquele passo', () => {
    let s = engine.newCareer(data, identity(), 'intensa', 'ach-steps')
    const all: string[] = []
    while (!s.retired) {
      const out = engine.choose(data, s, s.pendingDecision!.options.find((o) => o.title !== 'Aposentar-se')?.id ?? s.pendingDecision!.options[0].id)
      for (const id of out.reveal.achievements) {
        expect(all).not.toContain(id)
        all.push(id)
      }
      s = out.state
    }
    expect(all.sort()).toEqual([...(s.achievements ?? [])].sort())
  })
})
