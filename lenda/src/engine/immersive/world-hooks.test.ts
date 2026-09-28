/**
 * Ganchos do mundo para o Modo Imersivo: chaves de partida, agenda coletada e resultados fixos.
 * Roda com o GameData sintético do mundo (sempre) e com os dados reais (quando existirem).
 */
import { describe, expect, it, vi } from 'vitest'
import type { FixedResult, UserSeasonContext } from '../api'
import type { GameData, SeasonWorldResult, UserFixture, WorldState } from '../types'
import { worldEngine } from '../world'
import { fixture } from '../world/__fixtures__/gameData'
import { hasRealData, realData } from './__fixtures__/helpers'

// simulações pesadas: margem para máquinas carregadas (CI, vários agentes)
vi.setConfig({ testTimeout: 120_000 })

function strip(r: SeasonWorldResult): SeasonWorldResult {
  const { userFixtures: _a, userNationalFixtures: _b, userLeague: _c, ...rest } = r
  return rest as SeasonWorldResult
}
function stripWorld(w: WorldState): unknown {
  const seasons: Record<number, SeasonWorldResult> = {}
  for (const [k, v] of Object.entries(w.seasons)) seasons[Number(k)] = strip(v)
  return { ...w, seasons }
}

const ctxFor = (clubId: string, nation: string | null, extra: Partial<UserSeasonContext> = {}): UserSeasonContext => ({
  clubId,
  nationalTeam: nation,
  clubStrengthBoost: 0,
  nationalStrengthBoost: 0,
  ...extra,
})

function fixedFrom(list: UserFixture[]): Record<string, FixedResult> {
  const out: Record<string, FixedResult> = {}
  for (const f of list) out[f.key] = { score: [f.score[0], f.score[1]], pens: f.pens, aet: f.aet }
  return out
}

/** Um clube cuja agenda prevista chega à final da copa nacional. */
function clubWithFinal(data: GameData, world: WorldState): { clubId: string; agenda: UserFixture[]; cupId: string } | null {
  const leagues = data.leagues.filter((l) => l.domesticCupId && l.tier === 1)
  for (const l of leagues) {
    const clubs = data.clubs.filter((c) => world.clubs[c.id]?.leagueId === l.id).sort((a, b) => b.strength - a.strength)
    for (const c of clubs.slice(0, 6)) {
      const { result } = worldEngine.simulateSeason(data, world, ctxFor(c.id, null, { collectUserFixtures: true }))
      const ag = result.userFixtures ?? []
      if (ag.some((f) => f.competitionId === l.domesticCupId && f.stage === 'Final')) return { clubId: c.id, agenda: ag, cupId: l.domesticCupId! }
    }
  }
  return null
}

function suite(name: string, getData: () => GameData, userClub: (d: GameData) => string, nation: string) {
  describe(name, () => {
    it('coletar a agenda e resultados fixos vazios não mudam o mundo (Clássico idêntico)', () => {
      const data = getData()
      const w0 = worldEngine.createWorld(data, 'hooks-a')
      const club = userClub(data)
      const a = worldEngine.simulateSeason(data, w0, ctxFor(club, nation))
      const b = worldEngine.simulateSeason(data, w0, ctxFor(club, nation, { collectUserFixtures: true }))
      const c = worldEngine.simulateSeason(data, w0, ctxFor(club, nation, { fixedResults: {} }))
      expect(JSON.stringify(strip(b.result))).toBe(JSON.stringify(a.result))
      expect(JSON.stringify(stripWorld(b.world))).toBe(JSON.stringify(a.world))
      expect(JSON.stringify(c.result)).toBe(JSON.stringify(a.result))
      expect(b.result.userFixtures!.length).toBeGreaterThan(0)
    })

    it('chaves únicas e estáveis; liga em ordem de rodada; jogo de volta traz o agregado', () => {
      const data = getData()
      const w0 = worldEngine.createWorld(data, 'hooks-b')
      const club = userClub(data)
      const ctx = ctxFor(club, nation, { collectUserFixtures: true })
      const r1 = worldEngine.simulateSeason(data, w0, ctx).result
      const r2 = worldEngine.simulateSeason(data, w0, ctx).result
      const keys = r1.userFixtures!.map((f) => f.key)
      expect(new Set(keys).size).toBe(keys.length)
      expect(r2.userFixtures!.map((f) => f.key)).toEqual(keys)
      const league = r1.userFixtures!.filter((f) => f.kind === 'league' && f.round && !f.leg)
      for (let i = 1; i < league.length; i++) expect(league[i].round!).toBeGreaterThanOrEqual(league[i - 1].round!)
      for (const f of r1.userFixtures!) {
        expect(f.home === club || f.away === club).toBe(true)
        if (f.legs === 2 && f.leg === 2) expect(f.prior).toBeDefined()
      }
      expect(r1.userLeague!.matches.length).toBeGreaterThan(league.length)
    })

    it('fixar cada jogo no próprio placar previsto deixa o mundo igual', () => {
      const data = getData()
      let w = worldEngine.createWorld(data, 'hooks-c')
      w = worldEngine.simulateSeason(data, w, ctxFor(userClub(data), null)).world // 2ª temporada: calendário completo
      const club = userClub(data)
      const base = worldEngine.simulateSeason(data, w, ctxFor(club, nation, { collectUserFixtures: true }))
      const fixed = fixedFrom([...base.result.userFixtures!, ...base.result.userNationalFixtures!])
      const again = worldEngine.simulateSeason(data, w, ctxFor(club, nation, { fixedResults: fixed }))
      expect(JSON.stringify(strip(again.result))).toBe(JSON.stringify(strip(base.result)))
    })

    it('pré-simulação só da agenda (agendaOnly) traz a mesma agenda que a completa', () => {
      const data = getData()
      let w = worldEngine.createWorld(data, 'hooks-g')
      for (let season = 0; season < 2; season++) {
        const clubs = data.clubs.filter((c) => !!data.leagues.find((l) => l.id === w.clubs[c.id]?.leagueId)).filter((_, i) => i % 53 === 0).slice(0, 4)
        for (const c of clubs) {
          const full = worldEngine.simulateSeason(data, w, ctxFor(c.id, nation, { collectUserFixtures: true })).result
          const fixed = fixedFrom(full.userFixtures!.filter((_, i) => i % 3 === 0).map((f) => ({ ...f, score: [f.score[1], f.score[0]] as [number, number] })))
          const a = worldEngine.simulateSeason(data, w, ctxFor(c.id, nation, { collectUserFixtures: true, fixedResults: fixed })).result
          const b = worldEngine.simulateSeason(data, w, ctxFor(c.id, nation, { collectUserFixtures: true, agendaOnly: true, fixedResults: fixed })).result
          expect(JSON.stringify(b.userFixtures)).toBe(JSON.stringify(a.userFixtures))
          expect(JSON.stringify(b.userNationalFixtures)).toBe(JSON.stringify(a.userNationalFixtures))
          expect(JSON.stringify(b.userLeague)).toBe(JSON.stringify(a.userLeague))
        }
        w = worldEngine.simulateSeason(data, w, ctxFor(userClub(data), null)).world
      }
    })

    it('resultados fixos da liga entram na tabela', () => {
      const data = getData()
      let w = worldEngine.createWorld(data, 'hooks-d')
      w = worldEngine.simulateSeason(data, w, ctxFor(userClub(data), null)).world
      const club = userClub(data)
      const pre = worldEngine.simulateSeason(data, w, ctxFor(club, null, { collectUserFixtures: true })).result
      const league = pre.userFixtures!.filter((f) => f.kind === 'league' && f.round && !f.leg)
      const fixed: Record<string, FixedResult> = {}
      for (const f of league) fixed[f.key] = f.userHome ? [3, 0] : [0, 3]
      const { result } = worldEngine.simulateSeason(data, w, ctxFor(club, null, { fixedResults: fixed }))
      const lg = result.leagues[pre.userLeague!.leagueId]
      const row = lg.table.find((r) => r.clubId === club)!
      expect(row.won).toBeGreaterThanOrEqual(league.length)
      expect(row.gf).toBeGreaterThanOrEqual(3 * league.length)
      expect(lg.table[0].clubId).toBe(club)
    })

    it('perder a final dá o título ao adversário; vencer dá ao clube do jogador', () => {
      const data = getData()
      let w = worldEngine.createWorld(data, 'hooks-e')
      w = worldEngine.simulateSeason(data, w, ctxFor(userClub(data), null)).world
      const found = clubWithFinal(data, w)
      expect(found).not.toBeNull()
      const { clubId, agenda, cupId } = found!
      const cup = agenda.filter((f) => f.competitionId === cupId)
      const finals = cup.filter((f) => f.stage === 'Final')
      const before = cup.filter((f) => f.stage !== 'Final')
      const opp = finals[0].opponent
      for (const win of [false, true]) {
        const fixed = fixedFrom(before)
        for (const f of finals) {
          const [u, o] = win ? [2, 0] : [0, 2]
          fixed[f.key] = f.userHome ? [u, o] : [o, u]
        }
        const { result } = worldEngine.simulateSeason(data, w, ctxFor(clubId, null, { fixedResults: fixed }))
        expect(result.cups[cupId].winner).toBe(win ? clubId : opp)
        expect(result.cups[cupId].runnerUp).toBe(win ? opp : clubId)
      }
    })

    it('mata-mata de jogo único empatado usa os pênaltis do resultado fixo', () => {
      const data = getData()
      let w = worldEngine.createWorld(data, 'hooks-f')
      w = worldEngine.simulateSeason(data, w, ctxFor(userClub(data), null)).world
      // procura um clube com jogo único de mata-mata na agenda
      for (const c of data.clubs.slice(0, 200)) {
        const pre = worldEngine.simulateSeason(data, w, ctxFor(c.id, null, { collectUserFixtures: true })).result
        const ko = pre.userFixtures!.find((f) => f.knockout)
        if (!ko) continue
        const fixed = fixedFrom(pre.userFixtures!.filter((f) => f.seq < ko.seq))
        fixed[ko.key] = { score: [1, 1], pens: ko.userHome ? [3, 5] : [5, 3], aet: true }
        const { result } = worldEngine.simulateSeason(data, w, ctxFor(c.id, null, { fixedResults: fixed }))
        const cup = result.cups[ko.competitionId]
        // o jogador perdeu nos pênaltis: foi eliminado naquela fase (ou vice, se era a final)
        expect(cup.winner).not.toBe(c.id)
        return
      }
      throw new Error('nenhum mata-mata de jogo único encontrado')
    })
  })
}

suite('ganchos do mundo (dados sintéticos)', fixture, (d) => d.clubs.find((c) => d.leagues.find((l) => l.id === c.leagueId)?.domesticCupId && d.leagues.find((l) => l.id === c.leagueId)?.tier === 1)!.id, 'BRA')

describe.skipIf(!hasRealData)('ganchos do mundo (dados reais)', () => {
  it('Palmeiras: coleta, chaves e resultado fixo coerentes', () => {
    const data = realData()
    const pal = data.clubs.find((c) => c.name === 'Palmeiras')!
    const w0 = worldEngine.createWorld(data, 'hooks-real')
    const a = worldEngine.simulateSeason(data, w0, ctxFor(pal.id, 'BRA'))
    const b = worldEngine.simulateSeason(data, w0, ctxFor(pal.id, 'BRA', { collectUserFixtures: true }))
    expect(JSON.stringify(strip(b.result))).toBe(JSON.stringify(a.result))
    // 1ª temporada: continua da tabela real (rodadas a partir da real) e só jogos restantes
    const lg = b.result.userFixtures!.filter((f) => f.kind === 'league')
    expect(lg[0].round).toBeGreaterThan(1)
    expect(b.result.userLeague!.start.length).toBe(20)
    const fixed = fixedFrom(b.result.userFixtures!)
    const c = worldEngine.simulateSeason(data, w0, ctxFor(pal.id, 'BRA', { fixedResults: fixed }))
    expect(JSON.stringify(strip(c.result))).toBe(JSON.stringify(a.result))
  })

  it('agendaOnly: mesma agenda da simulação completa (1ª e 2ª temporadas, vários países)', () => {
    const data = realData()
    let w = worldEngine.createWorld(data, 'hooks-real-2')
    for (let season = 0; season < 2; season++) {
      for (const [name, nat] of [['Palmeiras', 'BRA'], ['Arsenal', 'ENG'], ['Boca Juniors', 'ARG'], ['Real Madrid', 'ESP'], ['Bahia', 'BRA']] as const) {
        const club = data.clubs.find((c) => c.name === name || c.shortName === name)
        if (!club) continue
        const full = worldEngine.simulateSeason(data, w, ctxFor(club.id, nat, { collectUserFixtures: true })).result
        const fast = worldEngine.simulateSeason(data, w, ctxFor(club.id, nat, { collectUserFixtures: true, agendaOnly: true })).result
        expect(JSON.stringify(fast.userFixtures)).toBe(JSON.stringify(full.userFixtures))
        expect(JSON.stringify(fast.userNationalFixtures)).toBe(JSON.stringify(full.userNationalFixtures))
        expect(JSON.stringify(fast.userLeague)).toBe(JSON.stringify(full.userLeague))
      }
      w = worldEngine.simulateSeason(data, w, ctxFor(data.clubs[0].id, null)).world
    }
  })
})
