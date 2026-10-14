/**
 * Hall das Lendas v2: títulos e prêmios completos das 50 lendas, as categorias novas (Títulos,
 * Melhor jogador, Artilharias, Puskás, Luvas, Prêmios individuais) e a cadeia de desempate.
 */
import { describe, expect, it } from 'vitest'
import { HISTORIC_RECORDS, LEGEND_BY_ID, REAL_LEGENDS, type HonourKind, type LegendAwardKey } from '../../../data/catalog/legends'
import type { AwardWin, PlayerIdentity, SeasonRecord, TrophyWin } from '../../types'
import {
  CATEGORIES,
  CATEGORY_IDS,
  CATEGORY_TIEBREAK,
  HALL_AWARDS,
  OVERALL_TIEBREAK,
  SCORED_CATEGORY_IDS,
  categoryRanking,
  compareRun,
  evaluateHall,
  evaluateLegends,
  evaluateRun,
  historicRecords,
  legendAwardCounts,
  overallRanking,
  runStats,
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
const run = (seasons: SeasonRecord[], extra: Partial<RunInput> = {}): RunInput => ({ id: extra.id ?? 'r', identity: ID, seasons, ...extra })
const KINDS: HonourKind[] = ['national', 'world', 'continental', 'league', 'cup', 'supercup', 'state', 'other']
const KEYS: LegendAwardKey[] = [...(HALL_AWARDS as LegendAwardKey[]), 'continental_best', 'continental_top_scorer', 'tournament_best', 'tournament_top_scorer', 'other']

describe('títulos e prêmios das 50 lendas (dados conferidos)', () => {
  it('cada lenda tem títulos, prêmios, feitos e fontes, e as contas fecham', () => {
    for (const l of REAL_LEGENDS) {
      const tag = l.name
      expect(l.honours.length, tag).toBeGreaterThan(0)
      expect(l.feats.length, tag).toBeGreaterThanOrEqual(9)
      expect(l.sources.length, tag).toBeGreaterThan(0)
      for (const s of l.sources) expect(s, tag).toMatch(/^https:\/\//)
      for (const h of l.honours) {
        expect(KINDS, `${tag}: ${h.name}`).toContain(h.kind)
        expect(h.n, `${tag}: ${h.name}`).toBeGreaterThan(0)
      }
      for (const a of l.awards) {
        expect(KEYS, `${tag}: ${a.name}`).toContain(a.key)
        expect(a.n, `${tag}: ${a.name}`).toBeGreaterThan(0)
      }
      const sum = (k: HonourKind) => l.honours.filter((h) => h.kind === k).reduce((s, h) => s + h.n, 0)
      const named = (re: RegExp) => l.honours.filter((h) => re.test(h.name)).reduce((s, h) => s + h.n, 0)
      // a soma dos títulos é o total; as ligas somam os títulos nacionais; Champions, Libertadores e Copas batem
      expect(l.honours.reduce((s, h) => s + h.n, 0), tag).toBe(l.totalTitles)
      expect(sum('league'), tag).toBe(l.leagueTitles)
      expect(named(/^Copa do Mundo/), tag).toBe(l.worldCups)
      expect(named(/^Copa Libertadores/), tag).toBe(l.libertadores)
      // as listas de prêmios batem com os campos numéricos de Bola de Ouro e Chuteira de Ouro
      const c = legendAwardCounts(l)
      expect(c.ballon_dor ?? 0, tag).toBe(l.ballonDor)
      expect(c.golden_boot ?? 0, tag).toBe(l.goldenBoots)
      for (const k of l.uncertainAwards ?? []) expect(c[k], `${tag}: ${k}`).toBeGreaterThan(0)
      if (l.active) expect(l.asOf, tag).toBe('2026-10')
    }
  })

  it('no máximo uma artilharia de liga por temporada (como numa carreira do jogo)', () => {
    // temporadas com ano simples ("1961", "2009/10 (34 gols)"); campeonatos divididos ("Metropolitano 1979") contam separados
    for (const l of REAL_LEGENDS) {
      const seen = new Map<string, string>()
      for (const a of l.awards.filter((x) => x.key === 'league_top_scorer'))
        for (const tok of a.years.split(',').map((t) => t.trim())) {
          const season = tok.match(/^(\d{4}(?:\/\d{2,4})?)\b/)?.[1]
          if (!season) continue
          expect(seen.get(season), `${l.name}: ${season} em "${seen.get(season)}" e "${a.name}"`).toBeUndefined()
          seen.set(season, a.name)
        }
    }
  })

  it('números-âncora de out/2026', () => {
    const L = LEGEND_BY_ID
    expect([L.messi.apps, L.messi.goals, L.messi.assists, L.messi.totalTitles]).toEqual([1179, 934, 426, 46])
    expect([L['cristiano-ronaldo'].apps, L['cristiano-ronaldo'].goals, L['cristiano-ronaldo'].totalTitles, L['cristiano-ronaldo'].leagueTitles]).toEqual([1340, 981, 35, 8])
    expect([L.pele.goals, L.pele.totalTitles, L.pele.worldCups]).toEqual([757, 28, 3])
    const v = Object.fromEntries(evaluateLegends().map((l) => [l.id, l.values]))
    // Puskás: Cristiano (2009), Neymar (2011) e Ibrahimović (2013); Messi não ganhou
    expect(REAL_LEGENDS.filter((l) => v[l.id].puskas > 0).map((l) => l.id).sort()).toEqual(['cristiano-ronaldo', 'ibrahimovic', 'neymar'])
    expect(v.messi.puskas).toBe(0)
    // Melhor jogador = The Best + craque da liga + Bola de Ouro da Copa
    expect(v.messi.bestPlayer).toBe(4 + 8 + 2)
    expect(v['cristiano-ronaldo'].bestPlayer).toBe(3 + 5)
    // Artilharias = artilheiro de liga + Chuteira de Ouro da Copa (Pelé: Paulistão até 1970, uma por temporada;
    // a Taça Brasil 1961, no mesmo ano, fica como artilharia de torneio)
    expect(v.messi.topScorer).toBe(9)
    expect(v.pele.topScorer).toBe(10)
    expect(v.mbappe.topScorer).toBe(8 + 2)
    expect(v.messi.titles).toBe(46)
    // Luvas de Ouro: melhor goleiro do mundo no ano (Casillas e Buffon 5 cada; Yashin é anterior ao prêmio)
    expect([v.casillas.goldenGloves, v.buffon.goldenGloves, v.yashin.goldenGloves]).toEqual([5, 5, 0])
    // prêmios que o jogo não dá (artilharia da Champions, Copa América…) não contam nas categorias
    expect(v.messi.awards).toBe(8 + 4 + 2 + 8 + 6 + 9 + 1)
  })

  it('recordes estruturados acompanham os números e incluem as marcas novas', () => {
    const goals = HISTORIC_RECORDS.find((r) => r.metric === 'goals')!
    expect(goals.value).toBe(981)
    const byId = Object.fromEntries(evaluateLegends().map((l) => [l.id, l]))
    expect(byId.messi.worldRecords.map((r) => r.metric)).toEqual(expect.arrayContaining(['wcGoldenBalls', 'titles', 'assists']))
    // ninguém ganhou dois Puskás: a marca não dá recorde a nenhuma lenda, mas uma run pode quebrá-la
    expect(Object.values(byId).some((l) => l.worldRecords.some((r) => r.metric === 'puskas'))).toBe(false)
    const two = runStats(run([rec(20, { a: [{ award: 'puskas' }] }), rec(21, { a: [{ award: 'puskas' }] })]))
    const r = historicRecords(two).find((x) => x.metric === 'puskas')!
    expect(r.text).toBe('2 Prêmios Puskás: recorde histórico (antes: Cristiano Ronaldo, Neymar, Ibrahimović e outros, 1).')
  })
})

describe('categorias novas valem igual para runs e lendas', () => {
  it('17 categorias em três grupos; Prêmios individuais não entra na nota', () => {
    expect(CATEGORY_IDS).toHaveLength(17)
    expect(new Set(CATEGORY_IDS.map((id) => CATEGORIES[id].group))).toEqual(new Set(['premios', 'titulos', 'numeros']))
    expect(SCORED_CATEGORY_IDS).not.toContain('awards')
    expect(SCORED_CATEGORY_IDS).toHaveLength(16)
  })

  it('a run soma títulos, Puskás, artilharias, prêmios de melhor jogador e Luvas a partir das temporadas', () => {
    const seasons = [
      rec(20, { t: [{ kind: 'league', tier: 1 }, { kind: 'domestic_cup', minor: true }], a: [{ award: 'puskas' }, { award: 'league_top_scorer' }, { award: 'league_best_player' }] }),
      rec(21, { t: [{ kind: 'domestic_cup' }], a: [{ award: 'the_best' }, { award: 'wc_golden_ball' }, { award: 'wc_golden_boot' }, { award: 'kopa' }, { award: 'team_of_the_year' }, { award: 'ballon_dor', place: 2 }] }),
      rec(22, { a: [{ award: 'golden_glove' }] }),
    ]
    const v = runStats(run(seasons)).values
    expect(v).toMatchObject({ titles: 3, puskas: 1, topScorer: 2, bestPlayer: 3, goldenGloves: 1, ballonDor: 0 })
    // Seleção do Ano e 2º lugar na Bola de Ouro não contam; Kopa conta só no total de prêmios
    expect(v.awards).toBe(1 + 2 + 3 + 1 + 1)
    // sem temporadas: o resumo antigo (CareerSummary) também alimenta as categorias novas
    const s = runStats(run([], { summary: { totals: { apps: 300, goals: 100, assists: 20 }, clubs: [], awards: [{ award: 'puskas', count: 2, years: [2030, 2031] }, { award: 'league_top_scorer', count: 3, years: [1, 2, 3] }], trophies: [{ trophyId: 'paulista', count: 4, seasons: [] }], peakOvr: 80 } }))
    expect(s.values).toMatchObject({ puskas: 2, topScorer: 3, titles: 4, awards: 5 })
  })

  it('comparações com as categorias novas', () => {
    const seasons = Array.from({ length: 16 }, (_, i) => rec(18 + i, { a: i < 2 ? [{ award: 'puskas' }] : [] }))
    const r = evaluateRun(run(seasons, { runNo: 2 }))
    const texts = compareRun(r, evaluateLegends(), { max: 30 }).map((c) => c.text)
    expect(texts.some((t) => /^Sua carreira nº 2 tem mais Prêmios Puskás que .+ \(1\) — ninguém entre as lendas tem mais\.$/.test(t))).toBe(true)
  })
})

describe('desempate', () => {
  it('ranking geral: nota → nota bruta → Bolas de Ouro → Copas → títulos → prêmios → gols → jogos → nome', () => {
    expect(OVERALL_TIEBREAK.map((c) => c.id)).toEqual(['raw', 'ballonDor', 'worldCups', 'titles', 'awards', 'goals', 'apps'])
    const base = evaluateRun(run(Array.from({ length: 10 }, (_, i) => rec(20 + i)), { id: 'a', identity: { ...ID, surname: 'ZETA' } }))
    // mesmas nota e nota bruta, uma Bola de Ouro a mais: fica à frente, e a linha mostra o porquê
    const more = { ...base, id: 'b', input: { ...base.input, id: 'b', identity: { ...ID, surname: 'ALFA' } }, values: { ...base.values, ballonDor: base.values.ballonDor + 1 } }
    const rows = overallRanking([base, more], [])
    expect(rows.map((r) => r.entry.id)).toEqual(['b', 'a'])
    expect(rows.map((r) => r.rank)).toEqual([1, 2])
    expect(rows[0].tieBreak).toMatchObject({ criterion: 'ballonDor', label: 'Bolas de Ouro', mine: '1', theirs: '0', against: 'ZETA' })
    expect(rows[1].behind).toMatchObject({ criterion: 'ballonDor', mine: '0', theirs: '1', against: 'ALFA' })
    // tudo igual: posição dividida e ordem pelo nome
    const twin = { ...base, id: 'c', input: { ...base.input, id: 'c', identity: { ...ID, surname: 'ALFA' } } }
    const tied = overallRanking([base, twin], [])
    expect(tied.map((r) => r.entry.id)).toEqual(['c', 'a'])
    expect(tied.map((r) => r.rank)).toEqual([1, 1])
    expect(tied[0].tieBreak).toBeUndefined()
  })

  it('lendas empatadas na nota arredondada mostram o desempate pela nota bruta', () => {
    const hall = evaluateHall([])
    const rows = hall.overall
    for (let i = 0; i < rows.length - 1; i++) {
      if (rows[i].value === rows[i + 1].value) {
        expect(rows[i].tieBreak?.criterion).toBe('raw')
        expect(rows[i].entry.raw).toBeGreaterThan(rows[i + 1].entry.raw)
      } else expect(rows[i].tieBreak).toBeUndefined()
      expect(rows[i + 1].rank).toBe(i + 2)
    }
  })

  it('categorias: valor da categoria e depois critérios parecidos (Copas → Bolas de Ouro → títulos)', () => {
    for (const id of CATEGORY_IDS) expect(CATEGORY_TIEBREAK[id].at(-1)!.id).toBe('raw')
    const L = evaluateLegends()
    const wc = categoryRanking('worldCups', [], L)
    expect(wc[0].entry.id).toBe('pele')
    // entre os bicampeões, quem tem mais Bolas de Ouro vem antes (Ronaldo: 2)
    const two = wc.filter((r) => r.value === 2)
    expect(two[0].entry.id).toBe('ronaldo')
    expect(two[0].tieBreak?.criterion).toBe('ballonDor')
    // gols iguais: menos jogos vence
    const a = evaluateRun(run(Array.from({ length: 10 }, (_, i) => rec(20 + i)), { id: 'a' }))
    const b = evaluateRun(run(Array.from({ length: 10 }, (_, i) => rec(20 + i, { stats: { apps: i === 0 ? 30 : 40, goals: 20, assists: 8, rating: 7 } })), { id: 'b' }))
    const g = categoryRanking('goals', [a, b], [])
    expect(g.map((r) => r.entry.id)).toEqual(['b', 'a'])
    expect(g[0].tieBreak).toMatchObject({ criterion: 'fewerApps', label: 'menos jogos' })
  })
})
