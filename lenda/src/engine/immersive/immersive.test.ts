/** Motor do Modo Imersivo com os dados reais (pulado se o JSON não existir). */
import { describe, expect, it, vi } from 'vitest'
import type { GameData } from '../types'
import { addResult, newRow, sortTable } from '../world/table'
import { advanceUntil, careerAt, closeSeason, dispatch, E, hasRealData, identity, realData, toSeasonEnd, tweak } from './__fixtures__/helpers'
import { attributesFor, immersiveMemory } from './index'
import { windowOffers, renewalOffer } from './offers'
import type { CalendarItem, ImmersiveState } from './types'

// simulações pesadas: margem para máquinas carregadas (CI, vários agentes)
vi.setConfig({ testTimeout: 120_000 })

const byName = (data: GameData, name: string) => data.clubs.find((c) => c.shortName === name || c.name === name)!

describe.skipIf(!hasRealData)('modo imersivo (dados reais)', () => {
  const data = hasRealData ? realData() : (null as unknown as GameData)

  it('nova carreira: oferta de base, JSON, pureza e determinismo', () => {
    const s0 = E.newCareer(data, identity('CA'), 'det-1')
    expect(s0.pendingDecision?.kind).toBe('academy')
    expect(s0.pendingDecision!.options).toHaveLength(3)
    expect(s0.calendar).toHaveLength(0)
    expect(E.validActions!(s0)).toContain('decision_choose')
    expect(JSON.parse(JSON.stringify(s0))).toEqual(s0)
    expect(s0.ovr).toBeGreaterThanOrEqual(48)
    expect(s0.ovr).toBeLessThanOrEqual(52)

    const play = () => {
      let s = s0
      const log: string[] = []
      s = dispatch(data, s, { type: 'decision_choose', optionId: s.pendingDecision!.options[1].id }).state
      s = dispatch(data, s, { type: 'auto', until: 'next_match' }).state
      s = dispatch(data, s, { type: 'advance' }).state
      s = dispatch(data, s, { type: 'match_start' }).state
      for (let i = 0; i < 80 && s.live && s.live.phase !== 'full_time'; i++) {
        const km = s.live.pendingMoment
        const r = km ? dispatch(data, s, { type: 'match_choose', optionId: km.options[i % km.options.length].id, minigame: { side: 'right', timing: 0.6 } }) : dispatch(data, s, { type: 'match_sim' })
        log.push(...r.effects.map((e) => e.type))
        s = r.state
      }
      s = dispatch(data, s, { type: 'match_finish' }).state
      s = dispatch(data, s, { type: 'auto', until: 'next_week' }).state
      return { s, log }
    }
    const a = play()
    const b = play()
    expect(JSON.stringify(a.s)).toBe(JSON.stringify(b.s))
    expect(a.log).toEqual(b.log)
    // dispatch não muta a entrada
    const before = JSON.stringify(a.s)
    dispatch(data, a.s, { type: 'advance' })
    expect(JSON.stringify(a.s)).toBe(before)
  })

  it('calendário: ordem, rodadas, ida/volta, uma semana de treino e encerramento', () => {
    let s = careerAt(data, 'cal-1', byName(data, 'Bahia').id)
    s = toSeasonEnd(data, s)
    s = closeSeason(data, s).state
    expect(s.season).toBe(2027)
    const cal = s.calendar
    for (let i = 1; i < cal.length; i++) {
      const a = cal[i - 1]
      const b = cal[i]
      expect(a.week * 1000 + a.order <= b.week * 1000 + b.order).toBe(true)
    }
    const league = cal.filter((it) => it.kind === 'match' && it.competitionId === s.leagueId)
    expect(league.length).toBe(38)
    const md = league.map((it) => Number(/(\d+)ª rodada/.exec(it.stage ?? '')?.[1]))
    expect(md).toEqual([...md].sort((x, y) => x - y))
    expect(new Set(md).size).toBe(38)
    // mando alternado (sem sequências longas do mesmo lado)
    let run = 1
    let maxRun = 1
    for (let i = 1; i < league.length; i++) {
      run = league[i].home === league[i - 1].home ? run + 1 : 1
      maxRun = Math.max(maxRun, run)
    }
    expect(maxRun).toBeLessThanOrEqual(4)
    // estadual antes da liga (ano civil brasileiro)
    const regional = cal.filter((it) => it.kind === 'match' && /bra\.camp\./.test(it.competitionId ?? ''))
    if (regional.length) expect(regional[0].week).toBeLessThan(league[0].week)
    const weeks = cal.filter((it) => it.kind === 'training').map((it) => it.week)
    expect(new Set(weeks).size).toBe(weeks.length)
    for (const it of cal.filter((x) => x.kind === 'press')) {
      const m = cal.find((x) => x.kind === 'match' && x.fixtureKey === it.fixtureKey)
      if (m) expect(m.week === it.week && m.order > it.order).toBe(true)
    }
    expect(cal[cal.length - 2].kind).toBe('season_end')
    expect(cal[cal.length - 1].kind).toBe('awards')
    expect(cal.every((it) => !it.done)).toBe(true)
    expect(cal.filter((it) => it.kind === 'transfer_window').map((it) => it.week)).toEqual([0, 27])
    expect(league[0].month).toBeGreaterThanOrEqual(3)
  })

  it('temporada inteira no automático: centroavante titular num clube médio da Série A', { timeout: 60000 }, () => {
    let s = careerAt(data, 'season-ca', byName(data, 'Bahia').id)
    s = toSeasonEnd(data, s)
    s = dispatch(data, s, { type: 'advance' }).state // season_end 2026
    // clube médio da Série A sem continental em 2027
    const cont = new Set(Object.entries(s.world.qualified).flatMap(([, ids]) => ids))
    const club = data.clubs
      .filter((c) => s.world.clubs[c.id]?.leagueId === 'bra.1' && !cont.has(c.id))
      .sort((a, b) => Math.abs(s.world.clubs[a.id].strength - 73.5) - Math.abs(s.world.clubs[b.id].strength - 73.5))[0]
    s = tweak(s, (x) => {
      x.clubId = club.id
      x.finance.contractUntil = 2030
    })
    s = dispatch(data, s, { type: 'advance' }).state // awards → 2027
    expect(s.season).toBe(2027)
    const str = s.world.clubs[club.id].strength
    s = tweak(s, (x) => {
      x.age = 24
      x.attributes = attributesFor('CA', Math.round(str + 3))
      x.ovr = E.ovrOf(x.attributes, 'CA')
      x.relationships.coach = 70
      immersiveMemory(x).truePotential = x.ovr + 1
    })
    s = toSeasonEnd(data, s)
    const ss = s.seasonStats
    const clubMatches = immersiveMemory(s).clubMatches
    console.log(`CA ${club.shortName} (força ${str.toFixed(1)}, OVR ${s.ovr}): ${ss.apps}/${clubMatches} jogos (${ss.starts} titular), ${ss.goals} gols, ${ss.assists} assist., nota ${(ss.ratingSum / ss.apps).toFixed(2)}`)
    expect(ss.apps).toBeGreaterThanOrEqual(34)
    expect(ss.apps).toBeLessThanOrEqual(56)
    expect(ss.apps / clubMatches).toBeGreaterThanOrEqual(0.8)
    expect(ss.goals).toBeGreaterThanOrEqual(10)
    expect(ss.goals).toBeLessThanOrEqual(25)
    const avg = ss.ratingSum / ss.apps
    expect(avg).toBeGreaterThan(6)
    expect(avg).toBeLessThan(7.6)

    // fim de temporada: o mundo consolidado reflete exatamente os jogos do jogador
    const done = s.calendar.filter((it) => it.kind === 'match' && it.done)
    const r = dispatch(data, s, { type: 'advance' })
    s = r.state
    const res = s.world.seasons[2027]
    const lg = res.leagues['bra.1']
    const row = lg.table.find((x) => x.clubId === club.id)!
    const mine = newRow(club.id)
    const other = newRow('x')
    for (const it of done.filter((x) => x.competitionId === 'bra.1')) {
      const [h, a] = it.result!.score
      if (it.home) addResult(mine, other, h, a)
      else addResult(other, mine, h, a)
    }
    expect({ p: row.played, w: row.won, d: row.drawn, l: row.lost, gf: row.gf, ga: row.ga }).toEqual({ p: mine.played, w: mine.won, d: mine.drawn, l: mine.lost, gf: mine.gf, ga: mine.ga })
    for (const it of done.filter((x) => x.competitionId !== 'bra.1')) {
      const cup = res.cups[it.competitionId!]
      if (!cup) continue
      const legs = cup.knockout.flatMap((st) => st.ties.flatMap((t) => t.legs))
      const home = it.home ? club.id : it.opponentId
      const leg = legs.find((l) => l.home === home && (l.away === (it.home ? it.opponentId : club.id)))
      if (leg) expect(leg.score).toEqual(it.result!.score)
    }
    const rec = s.seasons[s.seasons.length - 1]
    expect(rec.season).toBe(2027)
    expect(rec.clubId).toBe(club.id)
    expect(rec.stats.apps).toBe(ss.apps)
    expect(rec.stats.goals).toBe(ss.goals)
    expect(rec.leaguePosition).toBe(lg.table.findIndex((x) => x.clubId === club.id) + 1)
    expect(rec.role).toBe('starter')
    expect(r.effects.some((e) => e.type === 'season_end')).toBe(true)
    if (lg.champion === club.id) expect(rec.trophies.some((t) => t.competitionId === 'bra.1')).toBe(true)
    expect(rec.marketValue).toBeGreaterThan(0)
  })

  it('tabela ao vivo acompanha os resultados do jogador rodada a rodada', () => {
    let s = careerAt(data, 'table-1', byName(data, 'Bahia').id)
    s = advanceUntil(data, s, 'match')
    const it0 = s.calendar[s.cursor]
    const before = E.liveTable(data, s)
    s = dispatch(data, s, { type: 'advance' }).state
    s = dispatch(data, s, { type: 'match_finish' }).state
    const after = E.liveTable(data, s)
    const club = s.clubId!
    const b = before.find((r) => r.clubId === club)!
    const a = after.find((r) => r.clubId === club)!
    if (it0.competitionId === s.leagueId) expect(a.played).toBe(b.played + 1)
    expect(sortTable(after.map((r) => ({ ...r })))[0].points).toBe(after[0].points)
  })

  it('propostas, contraproposta, transferência e renovação', () => {
    let s = careerAt(data, 'offers-1', byName(data, 'Bahia').id)
    s = advanceUntil(data, s, 'match')
    s = tweak(s, (x) => {
      x.reputation = 70
      x.condition.form = 80
      x.attributes = attributesFor('CA', 78)
      x.ovr = 78
      x.marketValue = 20_000_000
    })
    const fx: never[] = []
    const withOffers = tweak(s, (x) => {
      windowOffers(data, x, fx)
    })
    const transfers = withOffers.offers.filter((o) => o.kind === 'transfer')
    expect(transfers.length).toBeGreaterThan(0)
    const o = transfers[0]
    expect(o.salary).toBeGreaterThan(0)
    expect(o.fee).toBeGreaterThan(0)
    expect(withOffers.inbox.some((m) => m.offerId === o.id)).toBe(true)
    // pedir 10× o salário nunca é aceito de cara
    const greedy = dispatch(data, withOffers, { type: 'offer_respond', offerId: o.id, response: 'counter', counter: { salary: o.salary * 10 } }).state
    const g = greedy.offers.find((x) => x.id === o.id)
    if (g) {
      expect(g.salary).toBeLessThan(o.salary * 10)
      expect(g.roundsLeft).toBe(o.roundsLeft - 1)
    }
    // aceitar: troca de clube, calendário refeito para o clube novo
    const r = dispatch(data, withOffers, { type: 'offer_respond', offerId: o.id, response: 'accept' })
    const t = r.state
    expect(t.clubId).toBe(o.clubId)
    expect(r.effects.some((e) => e.type === 'transfer')).toBe(true)
    expect(t.finance.salary).toBe(o.salary)
    const next = t.calendar.slice(t.cursor).find((it) => it.kind === 'match')!
    expect(next.fixtureKey).toContain(o.clubId)
    expect(t.calendar.filter((it) => it.done && it.kind === 'match').length).toBe(s.calendar.filter((it) => it.done && it.kind === 'match').length)
    // renovação no último ano de contrato
    const last = tweak(s, (x) => {
      x.finance.contractUntil = x.season
      x.relationships.coach = 70
    })
    const ren = renewalOffer(data, last)
    expect(ren?.kind).toBe('renewal')
    const withRen = tweak(last, (x) => {
      x.offers = [ren!]
    })
    const rr = dispatch(data, withRen, { type: 'offer_respond', offerId: ren!.id, response: 'accept' }).state
    expect(rr.finance.contractUntil).toBe(last.season + ren!.years)
    expect(rr.clubId).toBe(last.clubId)
  })

  it('coletiva e redes sociais mexem em torcida, mídia e técnico', () => {
    let s = careerAt(data, 'press-1', byName(data, 'Bahia').id)
    s = advanceUntil(data, s, 'press')
    expect(s.calendar[s.cursor].kind).toBe('press')
    s = dispatch(data, s, { type: 'advance' }).state
    expect(s.press?.length).toBeGreaterThanOrEqual(2)
    expect(E.validActions!(s)).toEqual(expect.arrayContaining(['press_answer', 'press_skip']))
    const q = s.press![0]
    const prov = q.answers.find((a) => a.tone === 'provocador')!
    expect(prov.effects.length).toBeGreaterThan(0)
    const r = dispatch(data, s, { type: 'press_answer', questionId: q.id, answerId: prov.id })
    expect(r.state.relationships.fans).toBeGreaterThan(s.relationships.fans)
    expect(r.state.relationships.media).toBeLessThan(s.relationships.media)
    expect(r.effects.some((e) => e.type === 'news')).toBe(true)
    const h = s.press![0].answers.find((a) => a.tone === 'humilde')!
    const hr = dispatch(data, s, { type: 'press_answer', questionId: q.id, answerId: h.id }).state
    expect(hr.relationships.media).toBeGreaterThan(s.relationships.media)
    // pular a coletiva inteira: mídia −4 e item concluído
    const sk = dispatch(data, s, { type: 'press_skip' }).state
    expect(sk.relationships.media).toBeCloseTo(s.relationships.media - 4, 0)
    expect(sk.press).toBeNull()
    // post provocador: torcida ↑, mídia ↓, seguidores ↑; repetir na mesma semana rende metade
    const p1 = dispatch(data, sk, { type: 'social_post', templateId: 'provocar_rival' }).state
    expect(p1.relationships.fans).toBeGreaterThan(sk.relationships.fans)
    expect(p1.relationships.media).toBeLessThan(sk.relationships.media)
    expect(p1.followers!).toBeGreaterThan(sk.followers!)
    expect(p1.social[1].byUser).toBe(true)
    const p2 = dispatch(data, p1, { type: 'social_post', templateId: 'provocar_rival' }).state
    expect(p2.relationships.fans - p1.relationships.fans).toBeLessThan(p1.relationships.fans - sk.relationships.fans)
  })

  it('treino, compras e ações inválidas', () => {
    let s = careerAt(data, 'train-1', byName(data, 'Bahia').id)
    expect(s.calendar[s.cursor].kind).toBe('training')
    expect(E.validActions!(s)).toContain('train')
    const xp = (x: ImmersiveState) => JSON.stringify(x.attributes) + JSON.stringify(immersiveMemory(x).xp)
    const r = dispatch(data, s, { type: 'train', focus: 'finishing', intensity: 'intensa' })
    expect(xp(r.state)).not.toBe(xp(s))
    const tired = tweak(s, (x) => (x.condition.fitness = 60))
    const hard = dispatch(data, tired, { type: 'train', focus: 'finishing', intensity: 'intensa' }).state
    const rest = dispatch(data, tired, { type: 'train', focus: 'rest', intensity: 'leve' }).state
    expect(hard.condition.fitness).toBeLessThan(rest.condition.fitness)
    expect(rest.condition.fitness).toBeGreaterThan(tired.condition.fitness)
    s = r.state
    // ação fora de hora: no-op com toast de aviso
    const bad = dispatch(data, s, { type: 'match_choose', optionId: 'x' })
    expect(bad.effects[0]).toMatchObject({ type: 'toast', tone: 'danger' })
    expect(bad.state.calendar).toEqual(s.calendar)
    const poor = dispatch(data, s, { type: 'buy', itemId: 'jatinho' })
    expect(poor.state.finance.balance).toBe(s.finance.balance)
    const rich = tweak(s, (x) => (x.finance.balance = 200_000))
    const bought = dispatch(data, rich, { type: 'buy', itemId: 'carro' }).state
    expect(bought.finance.balance).toBe(60_000)
    expect(bought.finance.lifestyle!.map((l) => l.id)).toContain('carro')
    expect(bought.condition.morale).toBeGreaterThan(rich.condition.morale)
    const retire = dispatch(data, s, { type: 'retire' })
    expect(retire.state.retired).toBe(false)
  })

  it('partida ao vivo: lances por posição, minijogos, nota e resultado fixo', () => {
    for (const pos of ['GOL', 'ZAG', 'MC', 'CA'] as const) {
      let s = careerAt(data, `live-${pos}`, byName(data, 'Bahia').id, pos)
      s = tweak(s, (x) => {
        x.attributes = attributesFor(pos, 76)
        x.ovr = 76
        x.relationships.coach = 90
      })
      s = advanceUntil(data, s, 'match')
      const item = s.calendar[s.cursor] as CalendarItem
      s = dispatch(data, s, { type: 'advance' }).state
      expect(s.live?.phase).toBe('pre')
      expect(s.live?.userStatus).toBe('starter')
      s = dispatch(data, s, { type: 'match_start' }).state
      const situations = new Set<string>()
      let moments = 0
      for (let i = 0; i < 120 && s.live && s.live.phase !== 'full_time'; i++) {
        const km = s.live.pendingMoment
        if (km) {
          moments++
          situations.add(km.situation)
          expect(km.options.length).toBeGreaterThanOrEqual(2)
          expect(km.options.length).toBeLessThanOrEqual(3)
          for (const o of km.options) {
          expect(o.chance).toBeGreaterThan(0)
          expect(o.chance).toBeLessThan(1)
        }
          s = dispatch(data, s, { type: 'match_choose', optionId: km.options[0].id, minigame: km.minigame === 'timing' ? { timing: 0.62 } : { side: 'left' } }).state
        } else s = dispatch(data, s, { type: 'match_sim' }).state
      }
      expect(moments).toBeGreaterThanOrEqual(3)
      if (pos === 'GOL') expect([...situations].every((x) => x === 'save' || x === 'penalty_save')).toBe(true)
      if (pos === 'ZAG') expect([...situations].some((x) => ['tackle', 'interception', 'block', 'header', 'pass'].includes(x))).toBe(true)
      const live = s.live!
      expect(live.phase).toBe('full_time')
      expect(live.events.filter((e) => e.type === 'goal' || e.type === 'penalty_goal').length).toBeGreaterThanOrEqual(live.score[0] + live.score[1] - (live.pens ? 0 : 0))
      const fin = dispatch(data, s, { type: 'match_finish' }).state
      const done = fin.calendar.find((x) => x.id === item.id)!
      expect(done.done).toBe(true)
      expect(done.result!.played).toBe(true)
      expect(done.result!.rating).toBeGreaterThanOrEqual(3)
      expect(done.result!.rating).toBeLessThanOrEqual(10)
      expect(immersiveMemory(fin).fixed[item.fixtureKey!]).toBeDefined()
      expect(fin.live).toBeNull()
    }
  })
})
