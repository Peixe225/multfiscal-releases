import { describe, expect, it } from 'vitest'
import type { UserSeasonContext } from '../api'
import type { GameData, WorldState } from '../types'
import { fixture, FIXTURE_FIRST_SEASON } from './__fixtures__/gameData'
import { worldEngine } from './index'

const NO_USER: UserSeasonContext = { clubId: null, nationalTeam: null, clubStrengthBoost: 0, nationalStrengthBoost: 0 }

function run(data: GameData, seed: string, seasons: number, ctx: (s: number) => UserSeasonContext = () => NO_USER) {
  let w = worldEngine.createWorld(data, seed)
  const results = []
  for (let i = 0; i < seasons; i++) {
    const r = worldEngine.simulateSeason(data, w, ctx(w.nextSeason))
    w = worldEngine.computeAwards(data, r.world, r.result.season, null).world
    results.push(r.result)
  }
  return { world: w, results }
}

function leagueSizes(data: GameData, w: WorldState): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of data.clubs) {
    const l = w.clubs[c.id].leagueId
    out[l] = (out[l] ?? 0) + 1
  }
  return out
}

describe('motor do mundo — fixture sintético', () => {
  const data = fixture()

  it('determinismo: mesma semente ⇒ resultados idênticos; semente diferente ⇒ outro mundo', () => {
    const a = run(data, 'seed-A', 2)
    const b = run(data, 'seed-A', 2)
    expect(JSON.stringify(a.world)).toBe(JSON.stringify(b.world))
    const c = run(data, 'seed-B', 1)
    expect(JSON.stringify(c.results[0].leagues)).not.toBe(JSON.stringify(a.results[0].leagues))
  })

  it('não muta o mundo de entrada', () => {
    const w = worldEngine.createWorld(data, 'pure')
    const before = JSON.stringify(w)
    worldEngine.simulateSeason(data, w, NO_USER)
    expect(JSON.stringify(w)).toBe(before)
  })

  it('1ª temporada continua a tabela real e os jogos restantes', () => {
    const { results } = run(data, 'first', 1)
    const bra = results[0].leagues['bra.1']
    expect(bra.table).toHaveLength(20)
    for (const r of bra.table) expect(r.played).toBe(38)
    // quem liderava com folga continua com os pontos reais somados
    const real = new Map(data.standings['bra.1'].map((r) => [r.clubId, r] as const))
    for (const r of bra.table) expect(r.points).toBeGreaterThanOrEqual(real.get(r.clubId)!.points)
    // Série B sem calendário completo: o motor completa até 38
    for (const r of results[0].leagues['bra.2'].table) expect(r.played).toBe(38)
    // liga desatualizada (stale) simulada do zero
    for (const r of results[0].leagues['sco.1'].table) expect(r.played).toBe(33)
    // Argentina: Apertura do histórico + Clausura simulada (zonas + play-off)
    const arg = results[0].leagues['arg.1']
    expect(arg.champions?.map((c) => c.name)).toEqual([`Apertura ${FIXTURE_FIRST_SEASON}`, `Clausura ${FIXTURE_FIRST_SEASON}`])
    for (const r of arg.table) expect(r.played).toBe(16)
  })

  it('acesso e rebaixamento: contagens e tamanhos das ligas preservados', () => {
    const { world, results } = run(data, 'promo', 3)
    const start = leagueSizes(data, worldEngine.createWorld(data, 'promo'))
    expect(leagueSizes(data, world)).toEqual(start)
    for (const res of results) {
      const L = res.leagues
      expect(L['bra.1'].relegated).toHaveLength(4)
      expect(L['bra.2'].promoted).toHaveLength(4)
      expect(L['eng.1'].relegated).toHaveLength(3)
      expect(L['eng.2'].promoted).toHaveLength(3)
      // 2 diretos + vencedor do play-off (3º–6º)
      expect(L['eng.2'].promoted.slice(0, 2)).toEqual(L['eng.2'].table.slice(0, 2).map((r) => r.clubId))
      const pos = L['eng.2'].table.findIndex((r) => r.clubId === L['eng.2'].promoted[2])
      expect(pos).toBeGreaterThanOrEqual(2)
      expect(pos).toBeLessThanOrEqual(5)
      // Alemanha: 16º da Bundesliga × 3º da 2. Bundesliga → 2 ou 3 trocas
      expect([2, 3]).toContain(L['ger.2'].promoted.length)
      expect(L['ger.1'].relegated.length).toBe(L['ger.2'].promoted.length)
      expect(L['arg.1'].relegated).toHaveLength(2)
      expect(L['arg.2'].promoted).toHaveLength(2)
      for (const c of L['bra.1'].relegated) expect(L['bra.1'].table.slice(-4).map((r) => r.clubId)).toContain(c)
    }
    // quem subiu está na liga de cima na temporada seguinte
    const r1 = results[0]
    for (const c of r1.leagues['bra.2'].promoted) expect(results[1].leagues['bra.1'].table.some((r) => r.clubId === c)).toBe(true)
  })

  it('Apertura/Clausura: dois campeões por temporada e tabela anual', () => {
    const { results } = run(data, 'ac', 2)
    const mex = results[1].leagues['mex.1']
    expect(mex.champions).toHaveLength(2)
    for (const r of mex.table) expect(r.played).toBe(34)
    const s = worldEngine.clubSeason(results[1], data, mex.champions![0].clubId)
    expect(s.leagueChampion).toBe(true)
    expect(s.titles.filter((t) => t.kind === 'league').length).toBeGreaterThanOrEqual(1)
  })

  it('continentais: tamanhos e formatos', () => {
    const { results } = run(data, 'cont', 2)
    const s0 = results[0]
    // 1ª temporada: Champions continua da fase de liga real (36), Libertadores da semifinal real
    expect(s0.cups['uefa.champions'].groups![0].table).toHaveLength(36)
    for (const r of s0.cups['uefa.champions'].groups![0].table) expect(r.played).toBe(8)
    expect(data.cupsInProgress['conmebol.libertadores'].alive).toContain(s0.cups['conmebol.libertadores'].winner)
    expect(data.cupsInProgress['bra.copa'].alive).toContain(s0.cups['bra.copa'].winner)
    const s1 = results[1]
    const lib = s1.cups['conmebol.libertadores']
    expect(lib.groups).toHaveLength(8)
    for (const g of lib.groups!) expect(g.table).toHaveLength(4)
    expect(s1.cups['conmebol.sudamericana'].groups).toHaveLength(8)
    for (const id of ['uefa.champions', 'uefa.europa', 'uefa.europa.conf']) {
      expect(s1.cups[id].groups![0].table).toHaveLength(36)
      expect(new Set(s1.cups[id].groups![0].table.map((r) => r.played))).toEqual(new Set([id === 'uefa.europa.conf' ? 6 : 8]))
    }
    // ninguém disputa duas continentais da mesma confederação
    const seen = new Set<string>()
    for (const id of ['uefa.champions', 'uefa.europa', 'uefa.europa.conf']) {
      for (const r of s1.cups[id].groups![0].table) {
        expect(seen.has(r.clubId)).toBe(false)
        seen.add(r.clubId)
      }
    }
    // final guardada, detentores e supercopas na temporada seguinte
    expect(lib.knockout.at(-1)!.name).toBe('Final')
    expect(s1.cups['uefa.super_cup']).toBeDefined()
    expect(s1.cups['conmebol.recopa']).toBeDefined()
    expect(s1.cups['uefa.super_cup'].reached[s0.cups['uefa.champions'].winner]).toBeDefined()
    expect(s0.cups['fifa.intercontinental_cup']).toBeDefined()
    for (const id of ['concacaf.champions', 'afc.champions', 'caf.champions']) expect(s1.cups[id]?.winner).toBeTruthy()
  })

  it('calendário de seleções e Mundial de Clubes', () => {
    const { results } = run(data, 'cal', 8)
    const bySeason = new Map(results.map((r) => [r.season, r] as const))
    // Copa do Mundo 2030 → temporada 2029; Euro/Copa América 2028 → 2027; Copa Ouro 2027/2029/2031 → 2026/2028/2030
    for (const [season, r] of bySeason) {
      expect(!!r.national['fifa.world']).toBe(season === 2029 || season === 2033)
      expect(!!r.national['uefa.euro']).toBe(season === 2027 || season === 2031)
      expect(!!r.national['conmebol.america']).toBe(season === 2027 || season === 2031)
      expect(!!r.national['concacaf.gold']).toBe(season % 2 === 0)
      expect(!!r.cups['fifa.cwc']).toBe(season === 2028 || season === 2032)
    }
    const wc = bySeason.get(2029)!.national['fifa.world']
    expect(Object.keys(wc.reached)).toHaveLength(48)
    expect(wc.groups).toHaveLength(12)
    expect(wc.knockout[0].ties).toHaveLength(16)
    for (const h of ['ESP', 'POR', 'MAR', 'URU', 'ARG', 'PAR']) expect(wc.reached[h]).toBeDefined()
    expect(wc.trophyId).toBe('t-fifa.world')
    const cwc = bySeason.get(2028)!.cups['fifa.cwc']
    expect(Object.keys(cwc.reached)).toHaveLength(32)
    expect(cwc.groups).toHaveLength(8)
    const euro = bySeason.get(2027)!.national['uefa.euro']
    expect(Object.keys(euro.reached)).toHaveLength(24)
    const ns = worldEngine.nationSeason(bySeason.get(2029)!, 'ESP')
    expect(ns.tournament?.competitionId).toBe('fifa.world')
    expect(ns.matches).toBeGreaterThanOrEqual(8)
  })

  it('resumo do clube soma todos os jogos oficiais e títulos com trophyId', () => {
    const { results } = run(data, 'sum', 2)
    const r = results[1]
    const champ = r.leagues['eng.1'].champion
    const s = worldEngine.clubSeason(r, data, champ)
    expect(s.leagueChampion).toBe(true)
    expect(s.position).toBe(1)
    expect(s.matches).toBeGreaterThan(38)
    expect(s.titles.some((t) => t.trophyId === 't-eng.1' && t.kind === 'league')).toBe(true)
    const ucl = r.cups['uefa.champions'].winner
    const su = worldEngine.clubSeason(r, data, ucl)
    expect(su.reached['uefa.champions']).toBe('Campeão')
    expect(su.titles.some((t) => t.kind === 'continental_primary' && t.trophyId === 't-uefa.champions')).toBe(true)
    expect(su.matches).toBeGreaterThan(50)
    const rel = worldEngine.clubSeason(r, data, r.leagues['bra.1'].relegated[0])
    expect(rel.relegated).toBe(true)
    expect(rel.tier).toBe(1)
  })

  it('30 temporadas sem erro, elite de rivais povoada e mundo compacto', () => {
    const t0 = performance.now()
    const { world, results } = run(data, 'long', 30)
    const ms = (performance.now() - t0) / 30
    expect(results).toHaveLength(30)
    expect(world.nextSeason).toBe(FIXTURE_FIRST_SEASON + 30)
    for (const r of results) {
      for (const l of Object.values(r.leagues)) expect(l.champion).toBeTruthy()
      expect(world.seasons[r.season].awards.find((a) => a.award === 'ballon_dor')).toBeDefined()
    }
    const active = world.rivals.filter((r) => !r.retired)
    expect(active.filter((r) => r.ovr >= 85).length).toBeGreaterThanOrEqual(10)
    expect(active.some((r) => r.generated && r.ovr >= 85)).toBe(true)
    expect(active.every((r) => world.nextSeason - r.birthYear <= 41)).toBe(true)
    for (const s of Object.values(world.clubs)) {
      expect(s.strength).toBeGreaterThanOrEqual(40)
      expect(s.strength).toBeLessThanOrEqual(92)
    }
    const perSeasonKB = JSON.stringify(results[29]).length / 1024
    expect(perSeasonKB).toBeLessThan(150)
    expect(ms).toBeLessThan(250)
  })
})

describe('jogador do usuário', () => {
  const data = fixture()
  const bestClub = data.clubs.filter((c) => c.leagueId === 'bra.1').sort((a, b) => b.strength - a.strength)[0].id

  it('forceTrophy: chance 1 garante o título da continental; −1 impede', () => {
    const w0 = worldEngine.createWorld(data, 'force')
    const w1 = worldEngine.simulateSeason(data, w0, NO_USER).world
    const quals = w1.qualified['conmebol.libertadores']
    const club = quals[quals.length - 1]
    const win = worldEngine.simulateSeason(data, w1, { ...NO_USER, clubId: club, forceTrophy: { kind: 'continental_primary', chance: 1 } })
    expect(win.result.cups['conmebol.libertadores'].winner).toBe(club)
    const favorite = worldEngine.simulateSeason(data, w1, NO_USER).result.cups['conmebol.libertadores'].winner
    const lose = worldEngine.simulateSeason(data, w1, { ...NO_USER, clubId: favorite, forceTrophy: { kind: 'continental_primary', chance: -1 } })
    expect(lose.result.cups['conmebol.libertadores'].winner).not.toBe(favorite)
  })

  it('reforço do jogador e prioridade mudam o desempenho do clube', () => {
    const w0 = worldEngine.createWorld(data, 'boost')
    const w1 = worldEngine.simulateSeason(data, w0, NO_USER).world
    const weak = data.clubs.filter((c) => w1.clubs[c.id].leagueId === 'bra.1').sort((a, b) => a.strength - b.strength)[0].id
    const pts = (ctx: UserSeasonContext) =>
      worldEngine.simulateSeason(data, w1, ctx).result.leagues['bra.1'].table.find((r) => r.clubId === weak)!.points
    const base = pts(NO_USER)
    const boosted = pts({ ...NO_USER, clubId: weak, clubStrengthBoost: 8 })
    const suspended = pts({ ...NO_USER, clubId: weak, clubStrengthBoost: 8, suspended: true })
    expect(boosted).toBeGreaterThan(base)
    expect(suspended).toBe(base)
    const league = pts({ ...NO_USER, clubId: weak, priority: 'league' })
    const cont = pts({ ...NO_USER, clubId: weak, priority: 'continental' })
    expect(league).toBeGreaterThan(cont)
  })

  it('Bola de Ouro: o usuário entra no ranking (e vence) quando é o melhor', () => {
    const w0 = worldEngine.createWorld(data, 'bdo')
    const r = worldEngine.simulateSeason(data, w0, { ...NO_USER, clubId: bestClub, nationalTeam: 'BRA', clubStrengthBoost: 5 })
    const club = worldEngine.clubSeason(r.result, data, bestClub)
    const { awards, world } = worldEngine.computeAwards(data, r.world, r.result.season, {
      name: 'Usuário Lenda',
      nationality: 'BRA',
      position: 'CA',
      clubId: bestClub,
      leagueId: 'bra.1',
      ovr: 96,
      age: 22,
      role: 'starter',
      apps: 60,
      goals: 58,
      assists: 20,
      titles: [...club.titles.map((t) => t.competitionId), 'conmebol.libertadores'],
    })
    const bdo = awards.find((a) => a.award === 'ballon_dor')!
    expect(bdo.ranking).toHaveLength(10)
    expect(bdo.winner.isUser).toBe(true)
    expect(bdo.year).toBe(r.result.season + 1)
    expect(world.seasons[r.result.season].awards).toEqual(awards)
    const scorers = world.seasons[r.result.season].leagues['bra.1'].topScorers
    expect(scorers[0].isUser).toBe(true)
    const lts = awards.find((a) => a.award === 'league_top_scorer' && a.leagueId === 'bra.1')!
    expect(lts.winner.isUser).toBe(true)
    // Chuteira de Ouro é só para ligas da UEFA
    const shoe = awards.find((a) => a.award === 'golden_boot')!
    expect(shoe.ranking.every((e) => !e.isUser)).toBe(true)
    // um usuário comum não entra no top 10
    const weak = worldEngine.computeAwards(data, r.world, r.result.season, {
      name: 'Reserva',
      nationality: 'BRA',
      position: 'ZAG',
      clubId: bestClub,
      leagueId: 'bra.1',
      ovr: 62,
      age: 17,
      role: 'substitute',
      apps: 4,
      goals: 0,
      assists: 0,
      titles: [],
    })
    expect(weak.awards.find((a) => a.award === 'ballon_dor')!.ranking.some((e) => e.isUser)).toBe(false)
    // prêmios por liga para toda 1ª divisão simulada
    const tier1 = data.leagues.filter((l) => l.tier === 1).map((l) => l.id)
    for (const id of tier1) expect(awards.some((a) => a.award === 'league_best_player' && a.leagueId === id)).toBe(true)
  })
})
