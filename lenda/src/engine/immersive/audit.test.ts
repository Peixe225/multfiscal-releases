/**
 * Regressões da auditoria do Modo Imersivo (dados reais; pulado se o JSON não existir): calendário
 * íntegro (nenhum jogo órfão/só do mundo, ≤ 3 jogos por semana), mando alternado em todas as ligas,
 * ações inválidas = mesmo estado, validActions ≡ dispatch, pênalti respeita o lado, negociação limitada
 * e com chances expostas, garoto da base com minutos, posts/compras com retorno decrescente, cartões de
 * zagueiro, mudança de posição, títulos só com jogos, gols de liga, salário anual e transferência
 * entre calendários.
 */
import { describe, expect, it, vi } from 'vitest'
import type { GameData } from '../types'
import { worldEngine } from '../world'
import { careerAt, closeSeason, dispatch, E, hasRealData, realData, toSeasonEnd, tweak } from './__fixtures__/helpers'
import { acceptChance, attributesFor, immersiveMemory } from './index'
import { applyClassicEffects } from './events'
import { userCtx } from './season'
import type { ImmersiveAction, ImmersiveEffect, ImmersiveState } from './types'

vi.setConfig({ testTimeout: 180_000 })

const byName = (data: GameData, name: string) => data.clubs.find((c) => c.shortName === name || c.name === name)!
const rejected = (fx: ImmersiveEffect[]) => fx.some((e) => e.type === 'toast' && e.title === 'Ação indisponível agora')



/** Joga até o `season_end` item a item (partidas no atalho), recusando propostas de outros clubes. */
function playSeason(data: GameData, s0: ImmersiveState): ImmersiveState {
  let s = s0
  for (let i = 0; i < 5000 && !s.retired; i++) {
    if (s.pendingDecision) {
      const o = s.pendingDecision.options.find((x) => !x.id.startsWith('retire') && !x.clubId) ?? s.pendingDecision.options[0]
      s = dispatch(data, s, { type: 'decision_choose', optionId: o.id }).state
    } else if (s.offers.length) {
      for (const o of s.offers) s = dispatch(data, s, { type: 'offer_respond', offerId: o.id, response: o.kind === 'renewal' ? 'accept' : 'reject' }).state
    } else if (s.live) s = dispatch(data, s, { type: 'match_finish' }).state
    else if (s.press) s = dispatch(data, s, { type: 'press_skip' }).state
    else if (s.calendar[s.cursor]?.kind === 'season_end') break
    else s = dispatch(data, s, { type: 'advance' }).state
  }
  return s
}

/** Jogos fixados pelo jogador × agenda da simulação final (com os mesmos resultados fixos). */
function integrity(data: GameData, s: ImmersiveState) {
  const m = immersiveMemory(s)
  const fin = worldEngine.simulateSeason(data, s.world, { ...userCtx(s, true), agendaOnly: false }).result
  const keys = new Set([...(fin.userFixtures ?? []), ...(fin.userNationalFixtures ?? [])].map((f) => f.key))
  const orphan = Object.keys(m.fixed).filter((k) => !keys.has(k))
  const worldOnly = (fin.userFixtures ?? []).filter((f) => !m.fixed[f.key]).map((f) => f.key)
  const perWeek = new Map<number, number>()
  for (const it of s.calendar) if (it.kind === 'match') perWeek.set(it.week, (perWeek.get(it.week) ?? 0) + 1)
  return { orphan, worldOnly, maxPerWeek: Math.max(0, ...perWeek.values()), matches: s.calendar.filter((it) => it.kind === 'match').length }
}

describe.skipIf(!hasRealData)('auditoria do modo imersivo', () => {
  const data = hasRealData ? realData() : (null as unknown as GameData)

  it('calendário íntegro: toda partida jogada existe no mundo, nenhuma do mundo fica de fora, ≤ 3 por semana', { timeout: 300_000 }, () => {
    // eng.1 (copas no mesmo slot, Champions), uru.1 (preliminar → Sul-Americana), mex.1 (Apertura/Clausura + liguilla)
    for (const [lid, rank, seasons] of [['eng.1', 1, 2], ['uru.1', 0, 2], ['mex.1', 1, 2], ['bra.1', 3, 2]] as const) {
      const club = data.clubs.filter((c) => c.leagueId === lid).sort((a, b) => b.strength - a.strength)[rank]
      let s = careerAt(data, `integ-${lid}`, club.id)
      for (let k = 0; k < seasons; k++) {
        if (k) s = closeSeason(data, s).state
        s = playSeason(data, s)
        const r = integrity(data, s)
        expect({ lid, season: s.season, orphan: r.orphan, worldOnly: r.worldOnly }).toEqual({ lid, season: s.season, orphan: [], worldOnly: [] })
        expect(r.maxPerWeek).toBeLessThanOrEqual(3)
        expect(r.matches).toBeGreaterThan(0)
      }
    }
  })

  it('tabela ao vivo de liga com Apertura/Clausura mostra só o torneio atual', () => {
    const club = data.clubs.filter((c) => c.leagueId === 'mex.1').sort((a, b) => b.strength - a.strength)[1]
    let s = careerAt(data, 'lt-mex', club.id)
    s = playSeason(data, s)
    s = closeSeason(data, s).state
    let checks = 0
    for (let i = 0; i < 5000 && s.calendar[s.cursor]?.kind !== 'season_end'; i++) {
      const league = s.live?.competitionId === s.leagueId
      if (s.pendingDecision) s = dispatch(data, s, { type: 'decision_choose', optionId: s.pendingDecision.options.find((x) => !x.clubId && !x.id.startsWith('retire'))?.id ?? s.pendingDecision.options[0].id }).state
      else if (s.offers.length) s = dispatch(data, s, { type: 'offer_respond', offerId: s.offers[0].id, response: 'reject' }).state
      else if (s.live) {
        s = dispatch(data, s, { type: 'match_finish' }).state
        if (league) {
          const t = E.liveTable(data, s)
          const me = t.find((r) => r.clubId === s.clubId)!
          expect(Math.max(...t.map((r) => r.played))).toBeLessThanOrEqual(me.played + 1)
          checks++
        }
      } else if (s.press) s = dispatch(data, s, { type: 'press_skip' }).state
      else s = dispatch(data, s, { type: 'advance' }).state
    }
    expect(checks).toBeGreaterThan(25)
  })

  it('mando alternado: nenhum clube de nenhuma liga com mais de 3 jogos seguidos no mesmo mando', () => {
    for (const seed of ['runs-1', 'runs-2']) {
      let w = worldEngine.createWorld(data, seed)
      w = worldEngine.simulateSeason(data, w, { clubId: null, nationalTeam: null, clubStrengthBoost: 0, nationalStrengthBoost: 0 }).world
      for (const l of data.leagues) {
        const club = data.clubs.find((c) => w.clubs[c.id]?.leagueId === l.id)
        if (!club) continue
        const lg = worldEngine.simulateSeason(data, w, { clubId: club.id, nationalTeam: null, clubStrengthBoost: 0, nationalStrengthBoost: 0, collectUserFixtures: true, agendaOnly: true, immersiveRules: true }).result.userLeague
        if (!lg) continue
        const seq = new Map<string, { t: number; r: number; h: boolean }[]>()
        for (const [h, a, , , round, t] of lg.matches) {
          for (const [c, home] of [[h, true], [a, false]] as const) (seq.get(c) ?? seq.set(c, []).get(c)!).push({ t: t ?? 0, r: round, h: home })
        }
        for (const [c, list] of seq) {
          list.sort((x, y) => x.t - y.t || x.r - y.r)
          let run = 0
          let prev: boolean | null = null
          let max = 0
          for (const x of list) {
            run = x.h === prev ? run + 1 : 1
            prev = x.h
            max = Math.max(max, run)
          }
          expect({ league: l.id, club: c, max: Math.min(max, 4) }).toEqual({ league: l.id, club: c, max: Math.min(max, 3) })
        }
      }
    }
  })

  it('ação inválida devolve o MESMO objeto de estado; validActions concorda com o dispatch', () => {
    let s = careerAt(data, 'va-1', byName(data, 'Everton').id)
    s = tweak(s, (x) => {
      x.attributes = attributesFor('CA', 80)
      x.ovr = 80
      x.relationships.coach = 90
    })
    const payload = (st: ImmersiveState, t: ImmersiveAction['type']): ImmersiveAction | null => {
      const km = st.live?.pendingMoment
      switch (t) {
        case 'advance':
          return { type: 'advance' }
        case 'train':
          return { type: 'train', focus: 'finishing', intensity: 'normal' }
        case 'match_start':
          return { type: 'match_start' }
        case 'match_sim':
          return { type: 'match_sim' }
        case 'match_choose':
          return { type: 'match_choose', optionId: km?.options[0].id ?? 'x' }
        case 'match_timeout':
          return { type: 'match_timeout' }
        case 'match_sub_request':
          return { type: 'match_sub_request' }
        case 'match_finish':
          return { type: 'match_finish' }
        case 'press_answer':
          return { type: 'press_answer', questionId: st.press?.[0]?.id ?? 'x', answerId: st.press?.[0]?.answers[0].id ?? 'x' }
        case 'press_skip':
          return { type: 'press_skip' }
        case 'offer_respond':
          return st.offers[0] ? { type: 'offer_respond', offerId: st.offers[0].id, response: 'reject' } : { type: 'offer_respond', offerId: 'x', response: 'reject' }
        case 'decision_choose':
          return { type: 'decision_choose', optionId: st.pendingDecision?.options[0].id ?? 'x' }
        case 'social_post':
          return { type: 'social_post', templateId: 'familia' }
        case 'retire':
          return { type: 'retire' }
        case 'auto':
          return { type: 'auto', until: 'next_week', maxSteps: 3 }
        default:
          return null
      }
    }
    const types: ImmersiveAction['type'][] = ['advance', 'train', 'match_start', 'match_sim', 'match_choose', 'match_timeout', 'match_sub_request', 'match_finish', 'press_answer', 'press_skip', 'offer_respond', 'decision_choose', 'social_post', 'retire', 'auto']
    const seen = new Set<string>()
    let checked = 0
    for (let i = 0; i < 900 && checked < 70; i++) {
      const variants = i % 25 === 0 ? [s, tweak(s, (x) => (x.age = 34))] : [s]
      const kind = s.pendingDecision ? 'decision' : s.live?.pendingMoment ? 'moment' : s.live ? `live:${s.live.phase}` : s.press ? 'press' : `item:${s.calendar[s.cursor]?.kind}`
      if (!seen.has(kind) || i % 25 === 0) {
        seen.add(kind)
        for (const st of variants) {
          const valid = new Set(E.validActions!(st))
          for (const t of types) {
            const a = payload(st, t)!
            const r = dispatch(data, st, a)
            const ok = !rejected(r.effects)
            expect({ kind, t, age: st.age, ok }).toEqual({ kind, t, age: st.age, ok: valid.has(t) })
            if (!ok) {
              expect(r.state).toBe(st)
              expect(r.effects).toHaveLength(1)
            }
          }
          checked++
        }
      }
      // avança jogando "à mão"
      const km = s.live?.pendingMoment
      const a: ImmersiveAction = s.pendingDecision
        ? { type: 'decision_choose', optionId: s.pendingDecision.options.find((x) => !x.clubId)?.id ?? s.pendingDecision.options[0].id }
        : km
          ? { type: 'match_choose', optionId: km.options[0].id, minigame: { side: 'left', timing: 0.6 } }
          : s.live
            ? s.live.phase === 'full_time'
              ? { type: 'match_finish' }
              : { type: 'match_sim' }
            : s.press
              ? { type: 'press_answer', questionId: s.press[0].id, answerId: s.press[0].answers[0].id }
              : s.offers.length
                ? { type: 'offer_respond', offerId: s.offers[0].id, response: 'reject' }
                : { type: 'advance' }
      s = dispatch(data, s, a).state
    }
    expect(seen.size).toBeGreaterThanOrEqual(7)
    // lixo: estado intacto, sem exceção
    const junk = [{ type: 'bogus' }, null, { type: 'train', focus: 'bogus', intensity: 'normal' }, { type: 'offer_respond', offerId: 'x', response: 'maybe' }] as unknown as ImmersiveAction[]
    for (const a of junk) expect(dispatch(data, s, a).state).toBe(s)
  })

  it('pênalti: o lado do minijogo manda, o resultado diz os cantos e os três lados valem ≈ o mesmo', () => {
    let s = careerAt(data, 'pen-1', byName(data, 'Everton').id)
    s = tweak(s, (x) => {
      x.attributes = attributesFor('CA', 80)
      x.ovr = 80
      x.relationships.coach = 95
      x.condition.fitness = 95
    })
    for (let i = 0; i < 400 && !(s.calendar[s.cursor]?.kind === 'match'); i++) {
      s = s.pendingDecision ? dispatch(data, s, { type: 'decision_choose', optionId: s.pendingDecision.options.find((x) => !x.clubId)!.id }).state : s.press ? dispatch(data, s, { type: 'press_skip' }).state : dispatch(data, s, { type: 'advance' }).state
    }
    s = dispatch(data, s, { type: 'match_start' }).state
    expect(s.live?.selectionReason).toBeTruthy()
    const withPen = tweak(s, (x) => {
      immersiveMemory(x).live!.plan = [{ minute: 5, situation: 'penalty' }]
      immersiveMemory(x).live!.momentIdx = 0
    })
    const atPen = dispatch(data, withPen, { type: 'match_sim' }).state
    const km = atPen.live!.pendingMoment!
    expect(km.minigame).toBe('penalty_kick')
    const ch = km.options.map((o) => o.chance)
    expect(Math.max(...ch) - Math.min(...ch)).toBeLessThanOrEqual(0.04)
    for (const side of ['left', 'center', 'right'] as const) {
      // o id enviado é o da esquerda, mas o lado do minijogo vence
      const r = dispatch(data, atPen, { type: 'match_choose', optionId: 'pen_left', minigame: { side } })
      const res = r.effects.find((e) => e.type === 'moment_result')
      expect(res && res.type === 'moment_result' && res.optionId).toBe(`pen_${side}`)
      expect(res && res.type === 'moment_result' && res.penalty?.shot).toBe(side)
    }
    // sem lado: o id da opção manda; lado inválido: recusado
    const byId = dispatch(data, atPen, { type: 'match_choose', optionId: 'pen_right' }).effects.find((e) => e.type === 'moment_result')
    expect(byId && byId.type === 'moment_result' && byId.optionId).toBe('pen_right')
    expect(dispatch(data, atPen, { type: 'match_choose', optionId: 'pen_right', minigame: { side: 'up' as never } }).state).toBe(atPen)
    // substituição com lance pendente: recusada
    expect(dispatch(data, atPen, { type: 'match_sub_request' }).state).toBe(atPen)
  })

  it('negociação: pedidos absurdos recusados/limitados e acceptChance igual à conta do counter()', () => {
    let s = careerAt(data, 'neg-1', byName(data, 'Bahia').id)
    s = tweak(s, (x) => {
      x.offers = [{ id: 'of-a', clubId: byName(data, 'Palmeiras').id, kind: 'renewal', salary: 1_000_000, years: 3, role: 'Titular', expiresWeek: 99, roundsLeft: 2 }]
      immersiveMemory(x).offerBase = { 'of-a': 1_000_000 }
    })
    for (const counter of [{ years: 0 }, { years: -5 }, { years: 50 }, { salary: Number.NaN }, { salary: -1 }, { role: 'Craque' as never }]) {
      expect(dispatch(data, s, { type: 'offer_respond', offerId: 'of-a', response: 'counter', counter }).state).toBe(s)
      expect(acceptChance(s, 'of-a', counter, data)).toBeNull()
    }
    const huge = acceptChance(s, 'of-a', { salary: 1e12 }, data)!
    expect(huge.accept).toBe(0)
    expect(huge.improve).toBe(0)
    expect(huge.walk).toBe(1)
    // frequências empíricas batem com as chances expostas (ids diferentes = sorteios diferentes)
    for (const ask of [1_100_000, 1_300_000]) {
      const odds = acceptChance(s, 'of-a', { salary: ask }, data)!
      expect(odds.accept + odds.improve + odds.walk).toBeCloseTo(1, 5)
      let acc = 0
      let imp = 0
      const N = 160
      for (let i = 0; i < N; i++) {
        const id = `of-${ask}-${i}`
        const x = tweak(s, (y) => {
          y.offers = [{ ...y.offers[0], id }]
          immersiveMemory(y).offerBase = { [id]: 1_000_000 }
        })
        const r = dispatch(data, x, { type: 'offer_respond', offerId: id, response: 'counter', counter: { salary: ask } }).state
        const o = r.offers.find((z) => z.id === id)
        if (o && o.salary === ask && o.note?.startsWith('Aceitaram')) acc++
        else if (o) {
          imp++
          expect(o.salary).toBeLessThanOrEqual(odds.ceiling)
        }
      }
      expect(Math.abs(acc / N - odds.accept)).toBeLessThan(0.12)
      expect(Math.abs(imp / N - odds.improve)).toBeLessThan(0.12)
    }
  })

  it('garoto de 16 anos na base: minutos de verdade na 1ª temporada europeia (e o motivo no pré-jogo)', () => {
    let s = careerAt(data, 'youth-1', byName(data, 'Everton').id)
    let bench = 0
    let moments = 0
    let reasons = 0
    for (let i = 0; i < 6000 && s.calendar[s.cursor]?.kind !== 'season_end'; i++) {
      if (s.pendingDecision) s = dispatch(data, s, { type: 'decision_choose', optionId: s.pendingDecision.options.find((x) => !x.clubId && !x.id.startsWith('retire'))?.id ?? s.pendingDecision.options[0].id }).state
      else if (s.offers.length) s = dispatch(data, s, { type: 'offer_respond', offerId: s.offers[0].id, response: 'reject' }).state
      else if (s.live) {
        if (s.live.phase === 'pre') {
          if (s.live.selectionReason) reasons++
          if (s.live.userStatus === 'bench') bench++
        }
        if (s.live.pendingMoment) moments++
        s = dispatch(data, s, s.live.pendingMoment ? { type: 'match_timeout' } : s.live.phase === 'full_time' ? { type: 'match_finish' } : { type: 'match_sim' }).state
      } else if (s.press) s = dispatch(data, s, { type: 'press_skip' }).state
      else s = dispatch(data, s, { type: 'advance' }).state
    }
    expect(s.age).toBe(16)
    expect(s.seasonStats.apps).toBeGreaterThanOrEqual(8)
    expect(s.seasonStats.apps).toBeLessThanOrEqual(24)
    expect(bench).toBeGreaterThanOrEqual(12)
    expect(moments).toBeGreaterThan(3)
    expect(reasons).toBeGreaterThan(20)
  })

  it('posts e compras repetidos rendem cada vez menos; "foco no treino" não compra o técnico', () => {
    let s = careerAt(data, 'spam-1', byName(data, 'Bahia').id)
    const c0 = s.relationships.coach
    for (let i = 0; i < 20; i++) s = dispatch(data, s, { type: 'social_post', templateId: 'foco_treino' }).state
    expect(s.relationships.coach - c0).toBeLessThanOrEqual(1.6)
    const f0 = s.relationships.fans
    for (let i = 0; i < 20; i++) s = dispatch(data, s, { type: 'social_post', templateId: 'obrigado_torcida' }).state
    expect(s.relationships.fans - f0).toBeLessThan(6.5)
    let rich = tweak(s, (x) => (x.finance.balance = 30_000_000))
    const fans0 = rich.relationships.fans
    for (let i = 0; i < 10; i++) rich = dispatch(data, rich, { type: 'buy', itemId: 'instituto' }).state
    expect(rich.relationships.fans - fans0).toBeLessThan(12)
  })

  it('zagueiro que joga no "seguro" (tempo esgotado) não coleciona cartões', () => {
    let s = careerAt(data, 'cards-1', byName(data, 'Everton').id, 'ZAG')
    s = toSeasonEnd(data, s)
    s = closeSeason(data, s).state
    const str = s.world.clubs[s.clubId!].strength
    s = tweak(s, (x) => {
      x.age = 25
      x.attributes = attributesFor('ZAG', Math.round(str + 3))
      x.ovr = E.ovrOf(x.attributes, 'ZAG')
      x.relationships.coach = 75
    })
    let yellows = 0
    let reds = 0
    let played = 0
    for (let i = 0; i < 20000 && s.calendar[s.cursor]?.kind !== 'season_end'; i++) {
      if (s.pendingDecision) s = dispatch(data, s, { type: 'decision_choose', optionId: s.pendingDecision.options.find((x) => !x.clubId && !x.id.startsWith('retire'))?.id ?? s.pendingDecision.options[0].id }).state
      else if (s.offers.length) s = dispatch(data, s, { type: 'offer_respond', offerId: s.offers[0].id, response: 'reject' }).state
      else if (s.live) {
        if (s.live.phase === 'full_time' && s.live.stats.minutes + (s.live.userOnPitch ? 1 : 0) > 0 && !s.live.home.national) {
          yellows += s.live.stats.yellow ? 1 : 0
          reds += s.live.stats.red ? 1 : 0
          played++
        }
        s = dispatch(data, s, s.live.pendingMoment ? { type: 'match_timeout' } : s.live.phase === 'full_time' ? { type: 'match_finish' } : { type: 'match_sim' }).state
      } else if (s.press) s = dispatch(data, s, { type: 'press_skip' }).state
      else s = dispatch(data, s, { type: 'advance' }).state
    }
    expect(played).toBeGreaterThan(25)
    expect(yellows).toBeLessThanOrEqual(10)
    expect(reds).toBeLessThanOrEqual(2)
  })

  it('mudança de posição (evento do Clássico) custa só o OVR prometido', () => {
    const s = careerAt(data, 'pos-1', byName(data, 'Bahia').id)
    for (const [from, to] of [['CA', 'MEI'], ['PE', 'LE'], ['ZAG', 'VOL'], ['MEI', 'MC'], ['LD', 'ZAG']] as const) {
      const x = tweak(s, (y) => {
        y.identity = { ...y.identity, position: from }
        y.attributes = attributesFor(from, 83)
        y.ovr = 83
      })
      applyClassicEffects(data, x, { newPosition: to, ovr: -2, declineFactor: 0.5 }, [])
      expect(x.identity.position).toBe(to)
      expect(x.ovr).toBeGreaterThanOrEqual(80)
      expect(x.ovr).toBeLessThanOrEqual(82)
      expect(E.ovrOf(x.attributes, to)).toBe(x.ovr)
    }
  })

  it('fim de temporada: sem jogos não há título; gols de liga reais nos prêmios; salário = 1 ano', () => {
    let s = careerAt(data, 'end-1', byName(data, 'Palmeiras').id)
    s = toSeasonEnd(data, s)
    s = closeSeason(data, s).state
    // lesionado a temporada toda: 0 jogos → nenhum título do clube
    const hurt = tweak(s, (x) => (x.condition.injury = { name: 'Lesão longa', weeksLeft: 200 }))
    const h = closeSeason(data, toSeasonEnd(data, hurt)).state
    const rh = h.seasons[h.seasons.length - 1]
    expect(rh.stats.apps).toBe(0)
    expect(rh.trophies.filter((t) => t.scope === 'club')).toHaveLength(0)
    // titular: gols de liga contados jogo a jogo; salário pago uma vez por temporada
    const str = s.world.clubs[s.clubId!].strength
    let t = tweak(s, (x) => {
      x.age = 25
      x.attributes = attributesFor('CA', Math.round(str + 4))
      x.ovr = E.ovrOf(x.attributes, 'CA')
      x.relationships.coach = 80
      x.finance.salary = 520_000
      x.finance.balance = 0
      x.finance.contractUntil = x.season + 3
    })
    t = toSeasonEnd(data, t)
    const leagueGoals = t.calendar.filter((it) => it.kind === 'match' && it.done && it.competitionId === t.leagueId).reduce((a, it) => a + (it.result?.userGoals ?? 0), 0)
    expect(immersiveMemory(t).leagueGoals).toBe(leagueGoals)
    expect(immersiveMemory(t).paidWeeks).toBeLessThanOrEqual(52)
  })

  it('transferência em janeiro da Europa para um clube de ano civil fica para a pré-temporada seguinte', () => {
    let s = careerAt(data, 'xf-1', byName(data, 'Everton').id)
    s = toSeasonEnd(data, s)
    s = closeSeason(data, s).state
    for (let i = 0; i < 2000; i++) {
      const it = s.calendar[s.cursor]
      if (it?.kind === 'transfer_window' && it.week > 10) break
      if (s.pendingDecision) s = dispatch(data, s, { type: 'decision_choose', optionId: s.pendingDecision.options.find((x) => !x.clubId && !x.id.startsWith('retire'))?.id ?? s.pendingDecision.options[0].id }).state
      else if (s.offers.length) s = dispatch(data, s, { type: 'offer_respond', offerId: s.offers[0].id, response: 'reject' }).state
      else if (s.live) s = dispatch(data, s, { type: 'match_finish' }).state
      else if (s.press) s = dispatch(data, s, { type: 'press_skip' }).state
      else s = dispatch(data, s, { type: 'advance' }).state
    }
    const left = s.calendar.filter((it) => !it.done && it.kind === 'match').length
    const pal = byName(data, 'Palmeiras')
    s = tweak(s, (x) => (x.offers = [{ id: 'of-x', clubId: pal.id, kind: 'transfer', fee: 5_000_000, salary: 1_000_000, years: 3, role: 'Titular', expiresWeek: x.week + 5, roundsLeft: 2 }]))
    const a = dispatch(data, s, { type: 'offer_respond', offerId: 'of-x', response: 'accept' }).state
    expect(a.clubId).toBe(s.clubId)
    expect(a.calendar.filter((it) => !it.done && it.kind === 'match').length).toBe(left)
    expect(immersiveMemory(a).deferredJoin?.clubId).toBe(pal.id)
    const next = closeSeason(data, toSeasonEnd(data, a)).state
    expect(next.clubId).toBe(pal.id)
    expect(next.calendar.filter((it) => it.kind === 'match').length).toBeGreaterThan(30)
  })

  it('treino automático não fica preso no "leve" depois de uma semana de descanso da IA', () => {
    let s = careerAt(data, 'auto-train', byName(data, 'Bahia').id)
    s = toSeasonEnd(data, s)
    s = closeSeason(data, s).state
    s = tweak(s, (x) => (x.condition.fitness = 40)) // força um descanso logo de cara
    const seen: string[] = []
    for (let i = 0; i < 60 && s.calendar[s.cursor]?.kind !== 'season_end'; i++) {
      const w = s.week
      s = dispatch(data, s, { type: 'auto', until: 'next_week' }).state
      if (s.pendingDecision) s = dispatch(data, s, { type: 'decision_choose', optionId: s.pendingDecision.options.find((x) => !x.clubId && !x.id.startsWith('retire'))?.id ?? s.pendingDecision.options[0].id }).state
      if (s.week !== w) seen.push(immersiveMemory(s).lastIntensity ?? '?')
    }
    expect(seen.length).toBeGreaterThan(30)
    expect(seen.filter((x) => x === 'normal').length / seen.length).toBeGreaterThan(0.5)
  })
})
