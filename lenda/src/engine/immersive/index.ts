/**
 * Motor do Modo Imersivo (implementa ImmersiveEngine).
 *
 *   import { createImmersiveEngine } from '@/engine/immersive'
 *   const engine = createImmersiveEngine(worldEngine)   // ou `immersiveEngine`
 *   let state = engine.newCareer(data, identity, seed)    // decisão pendente: oferta de base
 *   ({ state, effects } = engine.dispatch(data, state, { type: 'decision_choose', optionId }))
 *   ({ state, effects } = engine.dispatch(data, state, { type: 'advance' }))
 *
 * Tudo passa por `dispatch` (puro: clona o estado; o mundo só é trocado inteiro). Ações inválidas
 * no momento viram no-op com um toast. Ver `validActions(state)` e src/engine/immersive/CHANGES.md.
 *
 * CONDIÇÃO (0–100):
 *   energia  −0,13/min em campo (× físico), treino (leve −4 · normal −8 · intensa −13), +22/semana,
 *            descanso +16, recuperação +24. Um jogo por semana com treino normal se sustenta; dois
 *            jogos + treino intenso desgastam. Baixa energia derruba as chances e aumenta lesão.
 *   fase     média móvel das últimas notas (6,6 → 50; +22 por ponto).
 *   moral    resultados, gols, banco, eventos, compras; volta a 60 aos poucos.
 *   ritmo    +0,35/min jogado; −6 por semana sem jogar.
 * RELAÇÕES: técnico (notas, treino intenso/tático, coletivas, recusar banco), vestiário
 *   (assistências, vitórias, discussões), torcida (gols, vitórias, jogos grandes, posts),
 *   imprensa (coletivas, entrevistas); todas voltam devagar para 50.
 */
import type { WorldEngine } from '../api'
import { rng as subRng } from '../rng'
import type { Decision, GameData, PlayerIdentity, StandingRow } from '../types'
import { summarize } from '../career/summary'
import { NATIONAL_SLOTS, INJURIES } from '../career/constants'
import { callUpOvr, positionGroup } from '../career/util'
import { worldEngine } from '../world'
import { isScheduled } from '../world/national'
import { addResult, newRow, sortTable } from '../world/table'
import { END_WEEK, kindIsNational, matchdayOf, weekDate } from './calendar'
import type { Position } from '../types'
import type { AttributeKey, Attributes, CalendarItem, ImmersiveAction, ImmersiveEffect, ImmersiveEngine, ImmersiveState, TrainingFocus, TrainingPreviewInfo } from './types'
import { academyDecision, resolveDecision, storyDecision } from './events'
import { aiChoice, createLive, finalRating, kickoff, requestSub, resolveMoment, runToEnd, selectionPreview, setPosture, simulate } from './match'
import { mem, newMemory, type Fx } from './mem'
import { addInbox, addNews, answerPress, applyDeltas, buildPress, buyItem, clubStreak, matchReactions, userPost, type MatchSummary } from './media'
import { acceptChance, respondOffer, windowOffers, type CounterAsk, type CounterOdds } from './offers'
import {
  applyGrowth,
  attr,
  ATTR_NAME,
  FOCUS_SHARES,
  growthRate,
  INTENSITY,
  initialAttributes,
  isGK,
  ovrOf as ovrOfAttrs,
  potentialFactor,
  rollPotential,
  rollProfile,
  scoutPotential,
  WEEKS_PER_SEASON,
  WEIGHTS,
} from './player'
import { endSeason, rebuildCalendar, resim, retireNow, startNextSeason } from './season'
import { shadowCareer } from './shadow'
import { clamp, cloneState, clubOf, countryOf, deCountry, do_, ix, leagueById, nationStrength, r1, teamShort, trng, withArt } from './util'

export { POST_TEMPLATES, LIFESTYLE_ITEMS, OUTLETS } from './media'
export { acceptChance, counterOdds, type CounterAsk, type CounterOdds } from './offers'
export { penSide } from './match'
export { WEIGHTS, OUTFIELD_KEYS, GK_KEYS, attributesFor, marketValueOf } from './player'
export { GOAL_SCALE } from './match'

const TRAINING_FOCI: readonly TrainingFocus[] = Object.keys(FOCUS_SHARES) as TrainingFocus[]

const DEFAULT_FOCUS: Record<Position, TrainingFocus> = {
  CA: 'finishing', PE: 'dribbling', PD: 'dribbling', MEI: 'passing', ME: 'dribbling', MD: 'dribbling',
  MC: 'passing', VOL: 'defending', LD: 'physical', LE: 'physical', ZAG: 'defending', GOL: 'goalkeeping',
}

function current(s: ImmersiveState): CalendarItem | null {
  return s.calendar[s.cursor] ?? null
}

function toast(fx: ImmersiveEffect[], tone: 'info' | 'success' | 'gold' | 'danger', title: string, description?: string) {
  fx.push(description ? { type: 'toast', tone, title, description } : { type: 'toast', tone, title })
}

/**
 * Opção de menor risco de uma decisão: a com menos efeito negativo (pílulas negativas pesadas pela
 * probabilidade); empate → a com mais efeitos positivos; depois, a primeira. Determinística.
 */
export function safestOption(opts: Decision['options']): Decision['options'][number] {
  const score = (o: Decision['options'][number]) => {
    let neg = 0
    let pos = 0
    for (const e of o.effects ?? []) {
      if (e.kind === 'negative') neg += e.probability ?? 1
      else if (e.kind === 'positive') pos += e.probability ?? 1
    }
    return { neg, pos }
  }
  let best = opts[0]
  let bs = score(best)
  for (const o of opts.slice(1)) {
    const sc = score(o)
    if (sc.neg < bs.neg - 1e-9 || (Math.abs(sc.neg - bs.neg) < 1e-9 && sc.pos > bs.pos)) {
      best = o
      bs = sc
    }
  }
  return best
}

export function createImmersiveEngine(world: WorldEngine = worldEngine): ImmersiveEngine & {
  validActions(state: ImmersiveState): ImmersiveAction['type'][]
  summarize(data: GameData, state: ImmersiveState): ReturnType<typeof summarize>
  acceptChance(data: GameData, state: ImmersiveState, offerId: string, counter: CounterAsk): CounterOdds | null
  trainingPreview(data: GameData, state: ImmersiveState, focus: TrainingFocus, intensity: 'leve' | 'normal' | 'intensa'): TrainingPreviewInfo
} {
  const W = world

  // ───────────────────────── semana ─────────────────────────

  function weekTick(data: GameData, s: ImmersiveState, to: number, fx: ImmersiveEffect[]) {
    const m = mem(s)
    let guard = 0
    // salto para o encerramento (semana 62): só as 2 primeiras semanas contam como semanas sem jogo —
    // o resto é numeração do calendário, não pode zerar o ritmo nem a forma para a pré-temporada
    const toEnd = to >= END_WEEK
    let idle = 0
    while (s.week < to && guard++ < 80) {
      s.week++
      const C = s.condition
      const R = s.relationships
      // salário: 52 semanas por temporada (o contador de semanas vai até 62 no bloco de torneios)
      if ((m.paidWeeks ?? 0) < 52) {
        s.finance.balance += Math.round(s.finance.salary / 52)
        m.paidWeeks = (m.paidWeeks ?? 0) + 1
      }
      C.fitness = clamp(C.fitness + 22, 0, 100)
      const real = !toEnd || idle++ < 2
      if (real) {
        C.morale = r1(C.morale + (60 - C.morale) * 0.06)
        R.coach = r1(R.coach + (50 - R.coach) * 0.015)
        R.fans = r1(R.fans + (50 - R.fans) * 0.015)
        R.media = r1(R.media + (50 - R.media) * 0.02)
        R.teammates = r1(R.teammates + (50 - R.teammates) * 0.015)
      }
      const lastPlayed = m.lastMatchWeek ?? -1
      if (lastPlayed < s.week - 1 && real) {
        C.sharpness = clamp(C.sharpness - 6, 0, 100)
        C.form = r1(C.form + (50 - C.form) * 0.04)
      }
      if (C.injury) {
        C.injury.weeksLeft--
        if (C.injury.weeksLeft <= 0) {
          toast(fx, 'success', 'Liberado pelo departamento médico', `Recuperado: ${C.injury.name.toLowerCase()}.`)
          C.injury = undefined
        }
      }
      const expired = s.offers.filter((o) => o.expiresWeek < s.week)
      if (expired.length) {
        s.offers = s.offers.filter((o) => o.expiresWeek >= s.week)
        for (const o of expired) addInbox(s, 'Seu empresário', `Proposta ${do_(clubOf(data, o.clubId))} ${teamShort(data, o.clubId)} expirou`, 'Eles seguiram atrás de outro nome. Outras virão.')
      }
    }
  }

  // ───────────────────────── chegada em cada item ─────────────────────────

  function arrive(data: GameData, s: ImmersiveState, fx: ImmersiveEffect[]) {
    const m = mem(s)
    for (let guard = 0; guard < 50; guard++) {
      const it = current(s)
      if (!it || s.retired) return
      if (m.arrivedId === it.id) return
      m.arrivedId = it.id
      if (it.week > s.week) weekTick(data, s, it.week, fx)
      switch (it.kind) {
        case 'story': {
          const d = s.pendingDecision ? null : storyDecision(data, s)
          if (d) s.pendingDecision = d
          else {
            complete(data, s, fx, undefined, false)
            continue
          }
          return
        }
        case 'press': {
          // coletiva pré-jogo só para quem vai estar no jogo (titular ou banco): fora dos relacionados,
          // vira um recado dos bastidores (a escalação usa o mesmo sorteio da partida)
          const game = it.fixtureKey ? s.calendar.find((x) => x.fixtureKey === it.fixtureKey && (x.kind === 'match' || x.kind === 'national_match') && !x.done) : undefined
          if (!s.press && game && selectionPreview(data, s, game) === 'out') {
            const opp = withArt(data, game.opponentId)
            const why = s.condition.injury
              ? 'Em tratamento no departamento médico, você foi poupado da coletiva'
              : (s.condition.suspendedMatches ?? 0) > 0 && game.kind === 'match'
                ? 'Suspenso, você não participa da coletiva'
                : 'Você está fora dos relacionados: a coletiva fica com o técnico e os titulares'
            addInbox(s, 'Assessoria de imprensa', 'Coletiva sem você', `${why} antes do jogo contra ${opp}.`)
            complete(data, s, fx, undefined, false)
            continue
          }
          return
        }
        case 'transfer_window':
          windowOffers(data, s, fx)
          return
        case 'national_callup':
          callup(data, s, it, fx)
          return
        default:
          return
      }
    }
  }

  /** Conclui o item atual e avança (chegada automática). */
  function complete(data: GameData, s: ImmersiveState, fx: ImmersiveEffect[], result?: CalendarItem['result'], doArrive = true) {
    const it = current(s)
    if (it) {
      it.done = true
      if (result) it.result = result
    }
    s.cursor = Math.min(s.calendar.length, s.cursor + 1)
    while (s.calendar[s.cursor]?.done) s.cursor++
    if (doArrive) arrive(data, s, fx)
  }

  // ───────────────────────── seleção ─────────────────────────

  function natEligible(data: GameData, s: ImmersiveState): boolean {
    const m = mem(s)
    const country = countryOf(data, s.identity.nationality)
    const flag = m.nationalFlagSeason === s.season ? m.nationalFlag : undefined
    if (!country || s.age < 17 || m.nationalRetired || flag === 'skip') return false
    if (flag === 'force' && !s.condition.injury) return true
    // minutos no clube pesam: quem não joga perde espaço na seleção (até −8 de OVR "de vitrine")
    const share = m.clubMatches >= 5 ? s.seasonStats.minutes / Math.max(1, m.clubMatches * 90) : 0.5
    const lastMin = s.seasons.length ? (s.seasons[s.seasons.length - 1].stats.minutes ?? 0) : 1800
    const minutesPen = m.clubMatches >= 5 ? clamp((0.5 - share) * 16, 0, 8) : lastMin < 600 && s.seasons.length ? 4 : 0
    const eff = s.ovr + (m.tempOvr && m.tempOvr.untilSeason >= s.season ? m.tempOvr.delta : 0) + (s.condition.form - 50) / 12 - minutesPen
    const group = positionGroup(s.identity.position)
    const better = s.world.rivals.filter((r) => !r.retired && r.nationality === s.identity.nationality && positionGroup(r.position) === group && r.ovr > eff).length
    return eff >= callUpOvr(country) - 2 && better < NATIONAL_SLOTS[group] && !s.condition.injury
  }

  function callup(data: GameData, s: ImmersiveState, it: CalendarItem, fx: ImmersiveEffect[]) {
    const m = mem(s)
    const country = countryOf(data, s.identity.nationality)
    if (!country) return
    const called = natEligible(data, s)
    const tournament = it.id.startsWith('ct:')
    const compName = tournament ? (data.competitions.find((c) => c.id === it.competitionId)?.name ?? 'torneio') : ''
    if (called && s.national.firstCallUp === undefined) {
      s.national.firstCallUp = s.season
      s.log.push({ season: s.season, age: s.age, type: 'call_up', text: `Primeira convocação: seleção ${deCountry(country.name)}.` })
    }
    if (tournament) {
      m.natTournament = { competitionId: it.competitionId ?? '', called }
      if (called) {
        addInbox(s, `Seleção · ${country.name}`, `Convocado para a ${compName}!`, `Você está na lista final da seleção ${deCountry(country.name)} para a ${compName}. Apresentação logo após o fim da temporada.`)
        addNews(s, `${s.identity.surname} está na lista da seleção ${deCountry(country.name)} para a ${compName}`, 'positive', fx)
        toast(fx, 'gold', 'Convocado!', `${country.name} · ${compName}`)
        rebuildCalendar(data, s, it.week * 1000 + it.order)
      } else if (s.ovr >= callUpOvr(country) - 8) addInbox(s, `Seleção · ${country.name}`, 'Lista final divulgada', `Seu nome ficou fora da lista da ${compName}. A comissão técnica segue acompanhando.`)
      return
    }
    m.natCalled = called
    if (!called) {
      if (s.ovr >= callUpOvr(country) - 6 && s.age >= 17) addInbox(s, `Seleção · ${country.name}`, 'Lista divulgada', 'Seu nome ficou fora desta vez. A comissão acompanha seus jogos — continue somando minutos.')
      return
    }
    // eliminatórias (Copa no próximo ano ou no seguinte) ou amistosos
    const wc = data.competitions.find((c) => c.kind === 'world_cup')
    const qualifiers = !!wc && (isScheduled(wc, s.season + 1) || isScheduled(wc, s.season + 2))
    const r = subRng(s.seed, 'imm', 'natwin', s.season, it.week)
    const mine = nationStrength(s.world, data, country.code)
    const peers = data.countries.filter((c) => c.code !== country.code && (qualifiers ? c.confed === country.confed : true))
    const sorted = peers.slice().sort((a, b) => Math.abs(nationStrength(s.world, data, a.code) - mine) - Math.abs(nationStrength(s.world, data, b.code) - mine))
    const opps = r.sample(sorted.slice(0, Math.max(2, Math.min(10, sorted.length))), 2)
    const items: CalendarItem[] = opps.map((o, i) => {
      const d = weekDate(m.calKind, s.season, it.week)
      const ci: CalendarItem = {
        id: `n:${s.season}:${it.week}:${i}`,
        season: s.season,
        week: it.week,
        order: i ? 80 : 60,
        kind: 'national_match',
        title: `${country.name} · ${qualifiers ? 'Eliminatórias' : 'Amistoso'}`,
        competitionId: qualifiers ? 'qualifiers' : 'friendly',
        opponentId: o.code,
        home: r.chance(0.5),
        stage: qualifiers ? 'Eliminatórias da Copa' : 'Amistoso internacional',
        importance: qualifiers ? 0.6 : 0.3,
        done: false,
      }
      if (d.month) ci.month = d.month
      if (d.year) ci.year = d.year
      return ci
    })
    s.calendar.splice(s.cursor + 1, 0, ...items)
    s.calendar.sort((a, b) => a.week - b.week || a.order - b.order || (a.id < b.id ? -1 : 1))
    s.cursor = s.calendar.findIndex((x) => x.id === it.id)
    addInbox(s, `Seleção · ${country.name}`, 'Você foi convocado!', `A comissão técnica da seleção ${deCountry(country.name)} convocou você para ${qualifiers ? 'as Eliminatórias' : 'os amistosos'}: ${opps.map((o) => o.name).join(' e ')}.`)
    addNews(s, `${s.identity.surname} é convocado para a seleção ${deCountry(country.name)}`, 'positive', fx)
    toast(fx, 'gold', 'Convocado!', `${country.name} · ${opps.map((o) => o.name).join(' e ')}`)
  }

  // ───────────────────────── treino ─────────────────────────

  /**
   * Semana de treino. Ganho semanal = 70% do crescimento anual da idade ÷ semanas de treino do
   * calendário da temporada × intensidade × condição (≈1 com energia/moral normais). A parte extra da
   * intensa não sofre com a condição. Descanso/recuperação: energia, mas custam ritmo e (com energia
   * sobrando) confiança do técnico.
   */
  /** Pontos de OVR que a semana de treino rende (mesma conta no treino e na prévia). */
  function trainPoints(s: ImmersiveState, intensity: 'leve' | 'normal' | 'intensa'): number {
    const m = mem(s)
    const C = s.condition
    const I = INTENSITY[intensity] ?? INTENSITY.normal
    const condF = clamp(0.85 + (C.fitness - 60) / 250 + (C.morale - 60) / 400, 0.7, 1.1)
    const weeks = Math.max(30, m.seasonTrainingWeeks ?? WEEKS_PER_SEASON)
    const unit = ((growthRate(s.age, m.profile, isGK(s.identity.position)) * 0.7) / weeks) * potentialFactor(s.ovr, m.truePotential)
    return unit * (Math.min(1, I.gain) * condF + Math.max(0, I.gain - 1))
  }

  /** Prévia do treino: roda a mesma conta em cópias (atributos e XP), sem tocar no estado. */
  function trainingPreviewFor(s: ImmersiveState, focusIn: TrainingFocus, intensity: 'leve' | 'normal' | 'intensa'): TrainingPreviewInfo {
    const m = mem(s)
    const C = s.condition
    const pos = s.identity.position
    const gk = isGK(pos)
    const focus: TrainingFocus = C.injury && focusIn !== 'rest' ? 'recovery' : TRAINING_FOCI.includes(focusIn) ? focusIn : 'tactical'
    const I = INTENSITY[intensity] ?? INTENSITY.normal
    const fit = (d: number) => {
      const after = clamp(Math.round((C.fitness + d) * 10) / 10, 0, 100)
      return { fitnessAfter: Math.round(after), fitnessDelta: Math.round(after - C.fitness) }
    }
    if (focus === 'rest') return { focus, gains: [], ...fit(16), injuryRisk: 0 }
    if (focus === 'recovery') return { focus, gains: [], ...fit(24), injuryRisk: 0 }
    const a = { ...s.attributes } as Attributes
    const xp = { ...m.xp }
    applyGrowth(a, pos, focus, trainPoints(s, intensity), xp)
    const own = gk ? FOCUS_SHARES[focus].gk : FOCUS_SHARES[focus].outfield
    const shares: Partial<Record<AttributeKey, number>> = focus === 'tactical' || !Object.keys(own).length ? WEIGHTS[pos] : own
    const keys = (Object.entries(shares) as [AttributeKey, number][]).filter(([k, v]) => v > 0 && k in s.attributes).sort((x, y) => y[1] - x[1]).map(([k]) => k)
    const gains = keys.map((key) => ({ key, value: attr(s.attributes, key), to: attr(a, key), progressBefore: clamp(m.xp[key] ?? 0, 0, 1), progress: clamp(xp[key] ?? 0, 0, 1) }))
    // o risco usa a energia depois do treino (como no `train`)
    const injuryRisk = I.injury * (C.fitness + I.fitness < 45 ? 2.5 : 1) * (s.age >= 30 ? 1.3 : 1)
    return { focus, gains, ...fit(I.fitness), injuryRisk }
  }

  function train(data: GameData, s: ImmersiveState, focusIn: TrainingFocus, intensity: 'leve' | 'normal' | 'intensa', fx: ImmersiveEffect[], byUser = false) {
    const m = mem(s)
    const C = s.condition
    let focus = focusIn
    if (C.injury && focus !== 'rest') focus = 'recovery'
    const I = INTENSITY[intensity] ?? INTENSITY.normal
    const before = s.ovr
    const r = trng(s, 'train', s.week)
    const benched = s.calendar.slice(0, s.cursor).reverse().find((x) => x.kind === 'match' && x.done)?.result?.played === false
    let desc = ''
    if (focus === 'rest') {
      // folga sem precisar custa: o técnico nota (e o ritmo cai)
      applyDeltas(s, { fitness: 16, morale: 2, coach: C.fitness >= 70 ? -1.2 : -0.3 })
      C.sharpness = clamp(C.sharpness - 4, 0, 100)
      desc = 'Folga: energia e moral recarregadas (o ritmo cai um pouco).'
    } else if (focus === 'recovery') {
      applyDeltas(s, { fitness: 24, coach: C.injury || C.fitness < 60 ? 0 : -0.6 })
      C.sharpness = clamp(C.sharpness - 2, 0, 100)
      if (C.injury && r.chance(0.5)) C.injury.weeksLeft = Math.max(0, C.injury.weeksLeft - 1)
      desc = C.injury ? 'Fisioterapia intensiva: recuperação acelerada.' : 'Recuperação: gelo, sono e energia lá em cima.'
    } else {
      const pts = trainPoints(s, intensity)
      const ups = applyGrowth(s.attributes, s.identity.position, focus, pts, m.xp)
      for (const u of ups) fx.push({ type: 'attribute_up', key: u.key, from: u.from, to: u.to })
      // quem está fora do time e treina forte mostra serviço
      const show = benched && intensity !== 'leve' ? 0.5 : 0
      applyDeltas(s, { fitness: I.fitness, coach: (intensity === 'intensa' ? 1.2 : intensity === 'normal' ? 0.4 : -0.3) + show })
      if (focus === 'tactical') applyDeltas(s, { coach: 0.6 })
      C.sharpness = clamp(C.sharpness + I.sharp, 0, 100)
      if (focus === 'physical') m.physicalWeeks++
      const risk = I.injury * (C.fitness < 45 ? 2.5 : 1) * (s.age >= 30 ? 1.3 : 1)
      if (r.chance(risk)) {
        const weeks = r.int(1, 3)
        C.injury = { name: r.pick(['Estiramento muscular', 'Entorse no tornozelo', 'Pancada no joelho', 'Contratura na panturrilha']), weeksLeft: weeks }
        m.injuries++
        toast(fx, 'danger', 'Lesão no treino', `${C.injury.name}: ${weeks} ${weeks === 1 ? 'semana' : 'semanas'} fora.`)
        addNews(s, `${s.identity.surname} se machuca no treino e vira dúvida`, 'negative', fx)
      }
      desc = ups.length ? ups.map((u) => `+${u.to - u.from} ${ATTR_NAME[u.key] ?? u.key}`).join(' · ') : 'Semana de evolução silenciosa.'
    }
    m.trainingWeeks++
    if (byUser) {
      m.userFocus = focusIn
      m.userIntensity = intensity
    }
    m.lastFocus = focusIn
    m.lastIntensity = intensity
    s.ovr = ovrOfAttrs(s.attributes, s.identity.position)
    if (s.ovr !== before) fx.push({ type: 'ovr_change', from: before, to: s.ovr })
    toast(fx, 'info', 'Treino concluído', desc)
    complete(data, s, fx)
  }

  /**
   * Treino automático (avançar / IA): lesionado → recuperação; energia < 55 → descanso; senão o foco e a
   * intensidade que o JOGADOR escolheu por último (nunca herda o descanso da IA), limitados pela
   * energia (intensa só com ≥ 75; leve abaixo de 65); sem escolha do jogador → normal.
   */
  function autoFocus(s: ImmersiveState): { focus: TrainingFocus; intensity: 'leve' | 'normal' | 'intensa' } {
    const m = mem(s)
    const C = s.condition
    if (C.injury) return { focus: 'recovery', intensity: 'leve' }
    if (C.fitness < 55) return { focus: 'rest', intensity: 'leve' }
    const chosen = m.userFocus as TrainingFocus | undefined
    const base = chosen && chosen !== 'rest' && chosen !== 'recovery' ? chosen : DEFAULT_FOCUS[s.identity.position]
    const focus = !chosen && m.trainingWeeks % 4 === 3 ? (isGK(s.identity.position) ? 'goalkeeping' : s.age >= 29 ? 'physical' : 'tactical') : base
    let intensity: 'leve' | 'normal' | 'intensa' = m.userIntensity ?? 'normal'
    if (intensity === 'intensa' && C.fitness < 75) intensity = 'normal'
    if (C.fitness < 65) intensity = 'leve'
    return { focus, intensity }
  }

  // ───────────────────────── fim de partida ─────────────────────────

  function closeMatch(data: GameData, s: ImmersiveState, fx: ImmersiveEffect[]) {
    const live = s.live!
    const m = mem(s)
    const lm = m.live!
    const it = s.calendar.find((x) => x.id === live.itemId) ?? current(s)!
    const national = it.kind === 'national_match'
    if (live.userOnPitch) live.stats.minutes = Math.max(1, Math.min(120, live.minute) - lm.startMinute)
    const minutes = live.stats.minutes
    const played = minutes > 0
    if (played) finalRating(s)
    const ui = live.userSide === 'home' ? 0 : 1
    const us = live.score[ui]
    const them = live.score[1 - ui]
    const won = live.pens ? live.pens[ui] > live.pens[1 - ui] : us > them
    const lost = live.pens ? live.pens[ui] < live.pens[1 - ui] : us < them
    const aet = live.events.some((e) => e.minute > 90 && e.type !== 'full_time') || live.phase === 'full_time' && live.minute > 90
    // resultado fixo para o mundo
    if (it.fixtureKey) {
      const fixed: { score: [number, number]; pens?: [number, number]; aet?: boolean } = { score: [live.score[0], live.score[1]] }
      if (live.pens) fixed.pens = [live.pens[0], live.pens[1]]
      if (aet) fixed.aet = true
      m.fixed[it.fixtureKey] = fixed
    }
    const st = live.stats
    const ss = s.seasonStats
    const rating = played ? st.rating : 0
    if (national) {
      if (played) {
        m.natSeason.apps++
        m.natSeason.goals += st.goals
        m.natSeason.assists += st.assists
        if (it.fixtureKey) {
          m.natSeason.tournamentGoals += st.goals
          m.natSeason.tournamentApps = (m.natSeason.tournamentApps ?? 0) + 1
        }
        s.national.apps++
        s.national.goals += st.goals
        s.national.assists += st.assists
      }
    } else {
      m.clubMatches++
      const span = m.spans.find((x) => x.clubId === s.clubId)
      if (played) {
        ss.apps++
        if (live.userStatus === 'starter') ss.starts++
        ss.minutes += minutes
        ss.goals += st.goals
        ss.assists += st.assists
        ss.ratingSum = r1(ss.ratingSum + rating)
        if (isGK(s.identity.position)) {
          if (lm.goalsAgainst === 0 && minutes >= 60) ss.cleanSheets++
          m.seasonConceded = (m.seasonConceded ?? 0) + (st.conceded ?? 0)
        }
        if (rating >= 7.8 && (rating >= 8.4 || won)) ss.motm++
        if (span) {
          span.apps++
          span.goals = (span.goals ?? 0) + st.goals
          span.assists = (span.assists ?? 0) + st.assists
          span.minutes = (span.minutes ?? 0) + minutes
          if (it.competitionId && !span.comps.includes(it.competitionId)) span.comps.push(it.competitionId)
        }
      }
      if (played && it.competitionId && it.competitionId === s.leagueId) m.leagueGoals = (m.leagueGoals ?? 0) + st.goals
      if (lm.suspendedOut && (s.condition.suspendedMatches ?? 0) > 0) s.condition.suspendedMatches = Math.max(0, (s.condition.suspendedMatches ?? 0) - 1)
      if (st.red) s.condition.suspendedMatches = (s.condition.suspendedMatches ?? 0) + 1 + (trng(s, 'red', it.id).chance(0.3) ? 1 : 0)
      if (st.yellow && !st.red) {
        // amarelos por competição: 5 na liga, 3 nas copas → 1 jogo de suspensão
        const comp = it.competitionId ?? '-'
        const by = (m.yellowsBy ??= {})
        by[comp] = (by[comp] ?? 0) + 1
        m.yellows = (m.yellows ?? 0) + 1
        const limit = comp === s.leagueId ? 5 : 3
        if (by[comp] % limit === 0) {
          s.condition.suspendedMatches = (s.condition.suspendedMatches ?? 0) + 1
          toast(fx, 'danger', 'Suspenso', `${limit}º amarelo na competição: fora do próximo jogo.`)
        }
      }
      s.finance.balance += st.goals * (s.finance.bonuses?.perGoal ?? 0)
    }
    // condição e relações
    const C = s.condition
    const phys = isGK(s.identity.position) ? 70 : ((s.attributes as unknown as Record<string, number>).physical ?? 60)
    if (played) {
      m.lastMatchWeek = s.week
      C.fitness = clamp(Math.round(C.fitness - minutes * (isGK(s.identity.position) ? 0.08 : 0.16) * (1.3 - phys / 150)), 0, 100)
      C.sharpness = clamp(Math.round(C.sharpness + minutes * 0.35), 0, 100)
      m.ratings = [...m.ratings, rating].slice(-5)
      const mean = m.ratings.reduce((a, b) => a + b, 0) / m.ratings.length
      C.form = r1(clamp(50 + (mean - 6.6) * 22, 5, 99))
    }
    const imp = live.importance
    const league = leagueById(data, s.leagueId)
    applyDeltas(s, {
      morale: (won ? 3 : lost ? -3 : 0) * (0.6 + imp) + st.goals * 2 + (rating >= 8 ? 2 : 0) + (live.userStatus === 'out' && !s.condition.injury ? -2 : live.userStatus === 'bench' && !played ? -1 : 0),
      coach: played ? (rating - 6.5) * 2.5 : 0,
      fans: st.goals * 1.5 * (0.5 + imp) + (won ? 0.6 : lost ? -0.8 : 0) * (0.5 + imp * 2),
      teammates: st.assists * 1.5 + (won ? 0.5 : 0),
      reputation: st.goals * 0.12 * (league?.coefficient ?? 0.6) * (0.5 + imp) + (rating >= 8 ? 0.3 : 0) + (national && played ? 0.3 : 0),
    })
    // lesão em campo
    if (lm.injured) {
      const r = trng(s, 'match-injury', it.id)
      const def = r.weighted(INJURIES, (x) => x.weight)
      const severe = r.chance(0.12)
      const loss = severe ? -Math.max(1, Math.round(Math.abs(def.ovr) / 2)) : 0
      const weeks = severe ? clamp(Math.abs(def.ovr) * 3 + 1, 3, 30) : r.int(1, 4)
      C.injury = { name: severe ? def.name : 'Lesão muscular', weeksLeft: weeks, ovrDelta: severe ? loss : undefined }
      if (severe) {
        m.seasonInjury = { id: def.id, name: def.name, ovrDelta: loss }
        const before = s.ovr
        import_shift(s, loss)
        if (s.ovr !== before) fx.push({ type: 'ovr_change', from: before, to: s.ovr })
        s.log.push({ season: s.season, age: s.age, type: 'injury', text: `Lesão: ${def.name} (${weeks} semanas).` })
      }
      m.injuries++
      addNews(s, `${s.identity.surname} sai lesionado e ${severe ? `desfalca o time por ${weeks} semanas` : 'vira dúvida'}`, 'negative', fx)
    }
    const result: NonNullable<CalendarItem['result']> = { score: [live.score[0], live.score[1]], userGoals: st.goals, userAssists: st.assists, rating, played, minutes }
    if (live.pens) result.pens = [live.pens[0], live.pens[1]]
    if (aet) result.aet = true
    const scorers = live.events.filter((e) => (e.type === 'goal' || e.type === 'penalty_goal') && e.side === live.userSide && !e.shootout && e.player && e.player !== s.identity.surname).map((e) => e.player!)
    const ms: MatchSummary = { item: it, userGoals: st.goals, userAssists: st.assists, rating, minutes, won, lost, scoreFor: us, scoreAgainst: them, national, status: live.userStatus, scorers }
    matchReactions(data, s, ms, fx, trng(s, 'reactions', it.id))
    if (!national) tableNews(data, s, it, fx)
    const clubShort = live.userSide === 'home' ? live.home.shortName : live.away.shortName
    const oppShort = live.userSide === 'home' ? live.away.shortName : live.home.shortName
    toast(fx, won ? 'success' : lost ? 'danger' : 'info', `${won ? 'Vitória' : lost ? 'Derrota' : 'Empate'} · ${clubShort} ${us}–${them} ${oppShort}${live.pens ? ` (pên. ${live.pens[ui]}–${live.pens[1 - ui]})` : ''}`, played ? `Nota ${rating.toFixed(1).replace('.', ',')}${st.goals ? ` · ${st.goals} gol${st.goals > 1 ? 's' : ''}` : ''}${st.assists ? ` · ${st.assists} assist.` : ''}` : live.userStatus === 'out' ? 'Você não foi relacionado.' : 'Você não entrou em campo.')
    s.live = null
    m.live = undefined
    // item concluído antes da nova pré-simulação (o calendário refeito mantém o que já foi jogado)
    it.done = true
    it.result = result
    if (it.fixtureKey && stageComplete(m, it.fixtureKey)) {
      const need = needsResim(data, s, it.fixtureKey, result)
      if (need) resim(W, data, s, it.week * 1000 + it.order, need.withLeague)
    }
    const idx = s.calendar.findIndex((x) => !x.done)
    s.cursor = idx < 0 ? s.calendar.length : idx
    arrive(data, s, fx)
  }

  /**
   * Depois de cada rodada da liga (a partir da 5ª): notícia quando o clube assume a liderança, entra ou
   * sai da zona de rebaixamento ou do G-k (vagas continentais; na divisão de baixo, zona de acesso), ou
   * chega a uma sequência marcante — no máximo uma por jogo.
   */
  function tableNews(data: GameData, s: ImmersiveState, it: CalendarItem, fx: ImmersiveEffect[]) {
    const m = mem(s)
    const md = /(\d+)ª rodada/.exec(it.stage ?? '')
    if (!s.clubId || it.competitionId !== s.leagueId || !md) return
    const lg = leagueById(data, s.leagueId)
    const t = liveTableFor(data, s)
    const row = t.findIndex((r) => r.clubId === s.clubId)
    const prev = m.lastLeaguePos
    if (row < 0 || !lg) return
    const pos = row + 1
    m.lastLeaguePos = pos
    if ((t[row].played ?? 0) < 5) return
    const name = clubOf(data, s.clubId)?.shortName ?? 'Time'
    // tabela de mata-mata no fim ou de dois torneios: só a liderança vira notícia
    const zones = !lg.format.playoffTeams && (lg.tournamentsPerSeason ?? 1) === 1
    const k = lg.continentalSlots[0]
    const rel = (p: number) => zones && lg.relegation > 0 && p > t.length - lg.relegation
    const top = (p: number) => zones && (lg.tier === 1 ? k >= 2 && p <= k : lg.promotion > 0 && p <= lg.promotion)
    let head: [string, 'positive' | 'negative'] | null = null
    if (prev) {
      if (pos === 1 && prev > 1) head = [`${name} assume a liderança após a ${md[1]}ª rodada`, 'positive']
      else if (rel(pos) && !rel(prev)) head = [`${name} entra na zona de rebaixamento`, 'negative']
      else if (!rel(pos) && rel(prev)) head = [`${name} deixa a zona de rebaixamento`, 'positive']
      else if (top(pos) && !top(prev)) head = [lg.tier === 1 ? `${name} entra no G-${k} e sonha com a vaga continental` : `${name} entra na zona de acesso`, 'positive']
      else if (!top(pos) && top(prev)) head = [lg.tier === 1 ? `${name} perde o lugar no G-${k}` : `${name} sai da zona de acesso`, 'negative']
    }
    if (!head) {
      const n = clubStreak(s)
      if (n === 4 || n === 6 || n === 8 || n === 10) head = [`${name} chega a ${n} vitórias seguidas`, 'positive']
      else if (n === -4 || n === -6 || n === -8) head = [`${name} chega a ${-n} jogos sem vencer e a pressão aumenta`, 'negative']
    }
    // sobe-e-desce de uma rodada para a outra não vira manchete toda semana (a liderança sempre vira)
    const now = s.season * 100 + s.week
    if (head && (pos === 1 || now - (m.tableNewsWeek ?? -99) >= 3)) {
      addNews(s, head[0], head[1], fx, { aboutUser: false, clubId: s.clubId })
      m.tableNewsWeek = now
    }
  }

  function import_shift(s: ImmersiveState, delta: number) {
    const before = s.ovr
    const pos = s.identity.position
    // perda permanente distribuída pelos atributos da posição
    const a = s.attributes as unknown as Record<string, number>
    const keys = Object.keys(a)
    for (let g = 0; g < 60 && ovrOfAttrs(s.attributes, pos) > before + delta; g++) {
      const k = keys[g % keys.length]
      a[k] = Math.max(15, a[k] - 1)
    }
    s.ovr = ovrOfAttrs(s.attributes, pos)
  }

  /**
   * Fim de fase → nova pré-simulação (a agenda pode mudar): mata-mata decidido (venceu → próxima fase;
   * perdeu → fases seguintes e torneios que dependiam do título somem, copa de baixo pode aparecer),
   * fim de fase de grupos/liga, fim de cada torneio (Apertura/Clausura) da liga — com a liga rodada a
   * rodada atualizada — ou fim da fase regular de liga com play-offs/acesso. Liga de torneio único sem
   * play-off: nada muda. Devolve `null` (sem pré-simulação) ou se a liga deve ser recoletada.
   */
  function needsResim(data: GameData, s: ImmersiveState, key: string, res: NonNullable<CalendarItem['result']>): { withLeague: boolean } | null {
    const m = mem(s)
    const f = m.agenda.find((x) => x.key === key) ?? m.natAgenda.find((x) => x.key === key)
    if (!f) return null
    if (f.kind === 'league' && f.round && !f.leg) {
      const lg = leagueById(data, f.competitionId)
      if (!lg) return null
      const multi = (lg.tournamentsPerSeason ?? 1) > 1
      const po = lg.format.playoffTeams >= 2 || !!lg.promotionPlayoff || data.leagues.some((l) => l.upperLeagueId === lg.id && !!l.promotionPlayoff?.upperPosition)
      return multi || po ? { withLeague: multi } : null
    }
    const decider = !!f.knockout || (f.legs === 2 && f.leg === 2)
    if (decider && !tieWon(m, f, res)) m.eliminated = [...(m.eliminated ?? []), `${f.competitionId}|${f.stage}|${s.clubId ?? ''}`]
    return { withLeague: false }
  }

  /** O jogador venceu o confronto decidido neste jogo? (agregado, pênaltis, vantagem do empate) */
  function tieWon(m: ReturnType<typeof mem>, f: Fx, res: NonNullable<CalendarItem['result']>): boolean {
    const u = f.userHome ? res.score[0] : res.score[1]
    const o = f.userHome ? res.score[1] : res.score[0]
    const pu = f.userHome ? res.pens?.[0] : res.pens?.[1]
    const po = f.userHome ? res.pens?.[1] : res.pens?.[0]
    if (f.legs === 2) {
      const prior = f.prior ?? [0, 0]
      const list = kindIsNational(f.kind) ? m.natAgenda : m.agenda
      const first = list.find((x) => x.competitionId === f.competitionId && x.stage === f.stage && x.opponent === f.opponent && x.leg === 1)
      const fx1 = first ? m.fixed[first.key] : undefined
      const sc1 = fx1 ? (Array.isArray(fx1) ? [fx1[0], fx1[1]] : fx1.score) : undefined
      const agg = sc1 && first ? (first.userHome ? [sc1[0], sc1[1]] : [sc1[1], sc1[0]]) : prior
      const tu = u + agg[0]
      const to = o + agg[1]
      return tu !== to ? tu > to : pu !== undefined && po !== undefined ? pu > po : !!f.userSeed
    }
    return u !== o ? u > o : (pu ?? 0) > (po ?? 0)
  }

  /**
   * A fase (competição + fase; na liga, a fase regular de cada torneio) do jogo terminou para o
   * jogador? → nova pré-simulação.
   */
  function stageComplete(m: ReturnType<typeof mem>, key: string): boolean {
    const nat = m.natAgenda.find((x) => x.key === key)
    const list = nat ? m.natAgenda : m.agenda
    const f = nat ?? m.agenda.find((x) => x.key === key)
    if (!f) return false
    const regular = f.kind === 'league' && !!f.round && !f.leg
    const rest = list.filter((x) => x.competitionId === f.competitionId && x.stage === f.stage && (regular ? !!x.round && !x.leg : true) && !m.fixed[x.key])
    return rest.length === 0
  }

  // ───────────────────────── ações ─────────────────────────

  function startLive(data: GameData, s: ImmersiveState, it: CalendarItem, fx: ImmersiveEffect[]) {
    s.live = createLive(data, s, it)
    const m = mem(s)
    if (s.live.userStatus === 'out' && (s.condition.suspendedMatches ?? 0) > 0 && !s.condition.injury && it.kind === 'match') m.live!.suspendedOut = true
    const st = s.live.userStatus
    const why = s.live.selectionReason ?? (st === 'out' ? 'Fora dos relacionados' : st === 'bench' ? 'Começa no banco' : 'Titular')
    toast(fx, st === 'starter' ? 'success' : st === 'bench' ? 'info' : 'danger', st === 'starter' ? 'Titular' : st === 'bench' ? 'No banco' : 'Fora do jogo', `${why} · ${it.title}`)
  }

  function step(data: GameData, s: ImmersiveState, a: ImmersiveAction, fx: ImmersiveEffect[]): boolean {
    const m = mem(s)
    if (s.retired) {
      if (a.type === 'inbox_read') {
        const x = s.inbox.find((i) => i.id === a.messageId)
        if (x) x.read = true
        return !!x
      }
      return false
    }
    const it = current(s)
    switch (a.type) {
      case 'advance': {
        if (s.pendingDecision) return false
        if (s.live) {
          if (s.live.pendingMoment) return false
          if (s.live.phase === 'full_time') closeMatch(data, s, fx)
          else simulate(data, s, fx)
          return true
        }
        if (s.press) return false
        if (!it) return false
        switch (it.kind) {
          case 'training': {
            const f = autoFocus(s)
            train(data, s, f.focus, f.intensity, fx)
            return true
          }
          case 'match':
          case 'national_match':
            startLive(data, s, it, fx)
            return true
          case 'press': {
            const t = liveTableFor(data, s)
            s.press = buildPress(data, s, it, t.findIndex((r) => r.clubId === s.clubId) + 1, t.length)
            return true
          }
          case 'transfer_window': {
            if (!s.clubId) {
              // sem clube: assina com a melhor proposta disponível; sem nenhuma, a janela fecha e o
              // empresário tenta de novo na próxima (a partir da 2ª, garante um clube modesto)
              const best = s.offers.slice().sort((x, y) => (s.world.clubs[y.clubId]?.strength ?? 0) - (s.world.clubs[x.clubId]?.strength ?? 0))[0]
              if (best) {
                respondOffer(W, data, s, { type: 'offer_respond', offerId: best.id, response: 'accept' }, fx)
                arrive(data, s, fx)
                return true
              }
              if (s.age >= 33) {
                retireNow(s, 'no_offers', fx)
                return true
              }
              complete(data, s, fx)
              return true
            }
            complete(data, s, fx)
            return true
          }
          case 'season_end': {
            endSeason(W, data, s, fx)
            complete(data, s, fx)
            return true
          }
          case 'awards': {
            for (const aw of m.pendingAwards ?? []) fx.push({ type: 'award', award: aw })
            m.pendingAwards = undefined
            it.done = true
            startNextSeason(W, data, s, fx)
            m.arrivedId = undefined
            arrive(data, s, fx)
            return true
          }
          default:
            complete(data, s, fx)
            return true
        }
      }
      case 'train': {
        if (it?.kind !== 'training' || s.pendingDecision || s.live || s.press) return false
        if (!TRAINING_FOCI.includes(a.focus)) return false
        const intensity = a.intensity ?? 'normal'
        if (!(intensity in INTENSITY)) return false
        train(data, s, a.focus, intensity, fx, true)
        return true
      }
      case 'match_start': {
        if (!s.live && it && (it.kind === 'match' || it.kind === 'national_match') && !s.pendingDecision && !s.press) startLive(data, s, it, fx)
        if (!s.live || s.live.phase !== 'pre') return false
        if (a.accept === false && s.live.userStatus === 'bench') {
          applyDeltas(s, { coach: -6, teammates: -2 })
          m.live!.onAt = 999
          m.live!.plan = []
          s.live.userStatus = 'out'
          toast(fx, 'danger', 'Você se recusou a ficar no banco', 'O técnico não gostou.')
        }
        if (a.posture) setPosture(s, a.posture)
        kickoff(s, fx)
        return true
      }
      case 'match_posture':
        return setPosture(s, a.posture)
      case 'match_sim': {
        if (!s.live || s.live.pendingMoment) return false
        if (s.live.phase === 'full_time') return false
        simulate(data, s, fx)
        return true
      }
      case 'match_choose':
        if (typeof a.optionId !== 'string') return false
        return resolveMoment(data, s, a.optionId, a.minigame, fx, 'safe')
      case 'match_timeout': {
        // tempo esgotado: vale a jogada recomendada (maior valor esperado), não a de maior % bruto —
        // o passe "seguro" de 62% vira gol bem menos que a finalização de 28%
        const spec = m.live?.pending
        const ok = resolveMoment(data, s, spec ? (spec.suggested ?? aiChoice(spec, 'smart')) : null, undefined, fx, 'smart')
        if (ok) toast(fx, 'info', 'Tempo esgotado', 'Você hesitou e foi no instinto: valeu a jogada recomendada.')
        return ok
      }
      case 'match_sub_request': {
        if (!s.live || s.live.pendingMoment) return false
        const ok = requestSub(s, fx)
        if (ok && s.condition.fitness > 60 && (m.live?.fitness ?? 0) > 55) applyDeltas(s, { coach: -1.5 })
        return ok
      }
      case 'match_finish': {
        if (!s.live) return false
        if (s.live.phase !== 'full_time') runToEnd(data, s, fx, 'smart')
        closeMatch(data, s, fx)
        return true
      }
      case 'press_answer':
        if (!s.press) return false
        if (!answerPress(data, s, a.questionId, a.answerId, fx)) return false
        if (!s.press) {
          toast(fx, 'success', 'Coletiva encerrada', `Torcida ${Math.round(s.relationships.fans)} · Mídia ${Math.round(s.relationships.media)}`)
          complete(data, s, fx)
        }
        return true
      case 'press_skip': {
        if (s.live || s.pendingDecision || (!s.press && it?.kind !== 'press')) return false
        s.press = null
        s.pressLog = null
        m.press = undefined
        applyDeltas(s, { media: -4 })
        addNews(s, `${s.identity.surname} falta à coletiva e irrita a imprensa`, 'negative', fx)
        toast(fx, 'danger', 'Coletiva cancelada', 'Mídia −4')
        complete(data, s, fx)
        return true
      }
      case 'social_post':
        return userPost(data, s, a.templateId, fx)
      case 'offer_respond': {
        if (s.live) return false
        const ok = respondOffer(W, data, s, a, fx)
        if (ok) arrive(data, s, fx)
        return ok
      }
      case 'decision_choose': {
        if (!s.pendingDecision) return false
        const storyItem = current(s)?.kind === 'story'
        const academy = s.pendingDecision.kind === 'academy'
        const ok = resolveDecision(W, data, s, a.optionId, fx)
        if (!ok) return false
        if (s.retired) return true
        if (storyItem && !academy && current(s)?.kind === 'story') complete(data, s, fx)
        else arrive(data, s, fx)
        return true
      }
      case 'inbox_read': {
        const x = s.inbox.find((i) => i.id === a.messageId)
        if (x) x.read = true
        return !!x
      }
      case 'buy':
        return buyItem(s, a.itemId, fx)
      case 'retire': {
        if (s.age < 34 || s.live) return false
        s.pendingDecision = null
        s.press = null
        const played = s.calendar.some((x) => x.done && (x.kind === 'match' || x.kind === 'national_match'))
        if (played && !s.calendar.find((x) => x.kind === 'season_end')?.done) endSeason(W, data, s, fx)
        retireNow(s, 'voluntary', fx)
        return true
      }
      case 'auto':
        return false
    }
    return false
  }

  // ───────────────────────── IA ("simular até…") ─────────────────────────

  function autoRun(data: GameData, s: ImmersiveState, a: Extract<ImmersiveAction, { type: 'auto' }>, fx: ImmersiveEffect[]) {
    const until = a.until ?? 'decision'
    const max = a.maxSteps ?? (until === 'retirement' ? 200_000 : 5000)
    const m = mem(s)
    const startWeek = s.week
    const startSeasonN = s.season
    const offers0 = new Set(s.offers.map((o) => o.id))
    const pending0 = s.pendingDecision?.id
    const manual = until !== 'retirement'
    for (let i = 0; i < max && !s.retired; i++) {
      m.tick++
      if (s.pendingDecision) {
        // decisão que já estava aberta quando o jogador pediu "simular": a IA escolhe a opção mais segura
        // (a de menos risco, nunca uma aposta como a "mala preta"); decisões novas param a simulação.
        // Até a aposentadoria a carreira inteira é da IA: sorteio entre as opções.
        if (manual && s.pendingDecision.id !== pending0) return
        const d = s.pendingDecision
        const r = subRng(s.seed, 'imm', 'auto-dec', m.tick)
        const opts = d.options.filter((o) => !o.id.startsWith('retire'))
        const pick =
          d.kind === 'academy'
            ? d.options.slice().sort((x, y) => (s.world.clubs[y.clubId ?? '']?.strength ?? 0) - (s.world.clubs[x.clubId ?? '']?.strength ?? 0))[Math.min(1, d.options.length - 1)]
            : !opts.length
              ? d.options[0]
              : manual
                ? safestOption(opts)
                : r.pick(opts)
        step(data, s, { type: 'decision_choose', optionId: pick.id }, fx)
        continue
      }
      // propostas: as novas param a simulação; a que venceria no próximo passo também (avisando)
      if (manual && s.offers.some((o) => !offers0.has(o.id))) return
      if (manual && i > 0 && !s.live && !s.press) {
        const it = current(s)
        const next = s.calendar.slice(s.cursor + 1).find((x) => !x.done)
        const expiring = next ? s.offers.find((o) => o.expiresWeek < next.week) : undefined
        if (it?.kind === 'transfer_window' && s.offers.length) return
        if (expiring) {
          const c = clubOf(data, expiring.clubId)
          toast(fx, 'gold', 'Simulação pausada', `A proposta ${do_(c)} ${teamShort(data, expiring.clubId)} vence nesta semana: responda no Mercado.`)
          return
        }
      }
      if (until === 'retirement' && s.offers.length && !s.live) {
        const choice = pickOffer(data, s)
        if (choice) {
          step(data, s, { type: 'offer_respond', offerId: choice, response: 'accept' }, fx)
          continue
        }
      }
      if (s.live) {
        if (s.live.pendingMoment) {
          const lm = m.live!
          const opt = lm.pending ? aiChoice(lm.pending, 'smart', subRng(s.seed, 'imm', 'auto-ai', m.tick)) : null
          const mini = s.live.pendingMoment.minigame === 'timing' ? { timing: 0.5 + subRng(s.seed, 'imm', 'auto-t', m.tick).range(0, 0.25) } : undefined
          resolveMoment(data, s, opt, mini, fx, 'smart')
        } else if (s.live.phase === 'full_time') closeMatch(data, s, fx)
        else if (s.live.phase === 'pre') kickoff(s, fx)
        else simulate(data, s, fx)
        continue
      }
      if (s.press) {
        const q = s.press[0]
        const ans = q.answers.find((x) => x.tone === 'humilde') ?? q.answers[0]
        step(data, s, { type: 'press_answer', questionId: q.id, answerId: ans.id }, fx)
        continue
      }
      const it = current(s)
      if (!it) return
      if (until === 'next_match' && (it.kind === 'match' || it.kind === 'national_match')) return
      if (until === 'next_week' && s.week > startWeek) return
      if (until === 'season_end' && (it.kind === 'season_end' || s.season !== startSeasonN)) return
      if (it.kind === 'training') {
        const f = autoFocus(s)
        train(data, s, f.focus, f.intensity, fx)
        continue
      }
      if (!step(data, s, { type: 'advance' }, fx)) return
    }
  }

  function pickOffer(data: GameData, s: ImmersiveState): string | null {
    const ren = s.offers.find((o) => o.kind === 'renewal')
    if (ren) return ren.id
    const cur = s.clubId ? (s.world.clubs[s.clubId]?.strength ?? 60) : 0
    let best: string | null = null
    let bestV = cur + 2.5
    for (const o of s.offers) {
      const v = (s.world.clubs[o.clubId]?.strength ?? 60) + (o.role === 'Titular' ? 1 : o.role === 'Reserva' ? -3 : 0) - (o.kind === 'loan' ? 1 : 0)
      if (!s.clubId || v > bestV) {
        bestV = v
        best = o.id
      }
    }
    return best
  }

  // ───────────────────────── tabela ao vivo ─────────────────────────

  /**
   * Tabela ao vivo da liga do jogador: jogos dos outros clubes até a rodada que ele já disputou + os
   * resultados dele. Liga de dois torneios (Apertura/Clausura): a tabela é a do torneio atual (o do
   * último jogo de liga disputado; antes do 1º jogo, o do próximo) ou a de `tournament` (0/1, o
   * Balanço mostra as duas).
   */
  function liveTableFor(data: GameData, s: ImmersiveState, tournament?: number): StandingRow[] {
    const m = mem(s)
    const log = m.league
    if (!log) return []
    void data
    const club = s.clubId
    const mine = m.agenda.filter((f) => f.competitionId === log.leagueId && f.kind === 'league' && !!f.round && !f.leg)
    // torneio de cada jogo do clube (pelas partidas registradas rodada a rodada)
    const tOf = new Map<string, number>()
    for (const [h, a, , , round, t] of log.matches) if (h === club || a === club) tOf.set(`${h}|${a}|${round}`, t ?? 0)
    const tOfFx = (f: Fx) => tOf.get(`${f.home}|${f.away}|${f.round}`) ?? 0
    const played = mine.filter((f) => m.fixed[f.key])
    const T = tournament ?? (played.length ? tOfFx(played[played.length - 1]) : mine.length ? tOfFx(mine[0]) : 0)
    const startT = log.matches.length ? Math.min(...log.matches.map((x) => x[5] ?? 0)) : 0
    const rows = new Map<string, StandingRow>()
    if (T === startT) for (const r of log.start) rows.set(r.clubId, { ...r })
    for (const [h, a, , , , t] of log.matches) {
      if ((t ?? 0) !== T) continue
      if (!rows.has(h)) rows.set(h, newRow(h))
      if (!rows.has(a)) rows.set(a, newRow(a))
    }
    let cur = 0
    for (const f of played) if (tOfFx(f) === T) cur = Math.max(cur, matchdayOf(m, f.round))
    for (const [h, a, gh, ga, round, t] of log.matches) {
      if ((t ?? 0) !== T || h === club || a === club) continue
      if (matchdayOf(m, round) > cur) continue
      addResult(rows.get(h)!, rows.get(a)!, gh, ga)
    }
    for (const f of played) {
      if (tOfFx(f) !== T) continue
      const fx = m.fixed[f.key]
      const sc = Array.isArray(fx) ? [fx[0], fx[1]] : fx.score
      if (!rows.has(f.home)) rows.set(f.home, newRow(f.home))
      if (!rows.has(f.away)) rows.set(f.away, newRow(f.away))
      addResult(rows.get(f.home)!, rows.get(f.away)!, sc[0], sc[1])
    }
    return sortTable([...rows.values()])
  }

  // ───────────────────────── nova carreira ─────────────────────────

  function newCareer(data: GameData, identity: PlayerIdentity, seed: string): ImmersiveState {
    const id: PlayerIdentity = { ...identity, surname: identity.surname.trim().slice(0, 15), number: Math.max(1, Math.min(99, Math.round(identity.number))) }
    const r = subRng(seed, 'imm', 'new')
    const worldState = W.createWorld(data, seed)
    const m = newMemory()
    m.profile = rollProfile(r, id.position)
    m.truePotential = rollPotential(r)
    const cf = countryOf(data, id.nationality)?.confed
    if (cf) m.natConfeds[id.nationality] = cf
    const attributes: Attributes = initialAttributes(id.position, r, 50)
    const ovr = ovrOfAttrs(attributes, id.position)
    const season = ix(data).firstSeason
    const s: ImmersiveState = {
      version: 1,
      mode: 'immersive',
      id: `imm-${seed}`,
      seed,
      identity: id,
      createdAt: data.generatedAt,
      age: 16,
      season,
      week: 0,
      ovr,
      potential: scoutPotential(m.truePotential, ovr, 16, r),
      attributes,
      condition: { fitness: 90, form: 55, morale: 70, sharpness: 40 },
      relationships: { coach: 45, teammates: 50, fans: 40, media: 40, bonds: [] },
      finance: { salary: 0, balance: 5_000, contractUntil: season + 2, bonuses: { perGoal: 1_000, perTitle: 10_000 }, lifestyle: [] },
      clubId: null,
      squadNumber: id.number,
      captain: false,
      marketValue: 100_000,
      reputation: 3,
      calendar: [],
      cursor: 0,
      live: null,
      press: null,
      inbox: [],
      offers: [],
      news: [],
      social: [],
      pendingDecision: null,
      seasonStats: { apps: 0, starts: 0, minutes: 0, goals: 0, assists: 0, cleanSheets: 0, ratingSum: 0, motm: 0 },
      seasons: [],
      national: { apps: 0, goals: 0, assists: 0, trophies: [], tournaments: [] },
      trophies: [],
      awards: [],
      world: worldState,
      engine: m as unknown as Record<string, unknown>,
      log: [{ season, age: 16, type: 'decision', text: `Começa a jornada: 16 anos, OVR ${ovr}, sem clube.` }],
      achievements: [],
      retired: false,
      leagueId: null,
      followers: 800,
    }
    s.pendingDecision = academyDecision(data, s)
    return s
  }

  // ───────────────────────── API ─────────────────────────

  /**
   * Tipos de ação aceitos agora (mesmas guardas do `step`; o conteúdo — id de opção, proposta, item —
   * ainda é validado no dispatch). `auto` vale sempre (a IA resolve a decisão/lance pendente e segue).
   */
  function validActions(state: ImmersiveState): ImmersiveAction['type'][] {
    if (state.retired) return ['inbox_read']
    const always: ImmersiveAction['type'][] = ['inbox_read', 'buy', 'social_post', 'auto']
    const offers: ImmersiveAction['type'][] = state.offers.length && !state.live ? ['offer_respond'] : []
    const retire: ImmersiveAction['type'][] = state.age >= 34 && !state.live ? ['retire'] : []
    if (state.pendingDecision) return ['decision_choose', ...always, ...offers, ...retire]
    if (state.live) {
      const l = state.live
      if (l.pendingMoment) return ['match_choose', 'match_timeout', 'match_finish', ...always]
      if (l.phase === 'pre') return ['match_start', 'match_posture', 'match_sim', 'advance', 'match_finish', ...always]
      if (l.phase === 'full_time') return ['match_finish', 'advance', ...always]
      const out: ImmersiveAction['type'][] = ['match_sim', 'advance', 'match_finish']
      if (l.userOnPitch && l.phase !== 'penalties') out.push('match_sub_request')
      if (l.phase !== 'penalties') out.push('match_posture')
      return [...out, ...always]
    }
    if (state.press) return ['press_answer', 'press_skip', ...always, ...offers, ...retire]
    const it = state.calendar[state.cursor]
    const out: ImmersiveAction['type'][] = [...(it ? (['advance'] as const) : []), ...always]
    if (it?.kind === 'training') out.push('train')
    if (it?.kind === 'match' || it?.kind === 'national_match') out.push('match_start')
    if (it?.kind === 'press') out.push('press_skip')
    return [...out, ...offers, ...retire]
  }

  const engine = {
    newCareer,
    /**
     * Puro: clona o estado e aplica a ação. Ação inválida (fora de hora ou com dados inválidos) devolve
     * o MESMO objeto de estado recebido + um toast — nenhum contador muda, os sorteios futuros não
     * mudam. Erro inesperado: idem (estado intacto) com o toast "Erro interno".
     */
    dispatch(data: GameData, state: ImmersiveState, action: ImmersiveAction) {
      const reject = (title: string) => ({ state, effects: [{ type: 'toast', tone: 'danger', title, description: String((action as { type?: unknown })?.type ?? '?') } as ImmersiveEffect] })
      if (!action || typeof action !== 'object' || typeof action.type !== 'string') return reject('Ação indisponível agora')
      try {
        const s = cloneState(state)
        const fx: ImmersiveEffect[] = []
        const m = mem(s)
        let ok: boolean
        if (action.type === 'auto') {
          if (s.retired) ok = false
          else {
            autoRun(data, s, action, fx)
            ok = true
          }
        } else ok = step(data, s, action, fx)
        if (!ok) return reject('Ação indisponível agora')
        m.tick++
        if (!s.live && !s.press && !s.pendingDecision) arrive(data, s, fx)
        return { state: s, effects: fx }
      } catch (e) {
        if (typeof process !== 'undefined' && process.env?.LENDA_THROW) throw e
        return reject('Erro interno: ação ignorada')
      }
    },
    nextItem(state: ImmersiveState) {
      return state.calendar[state.cursor] ?? null
    },
    ovrOf(attributes: Attributes, position: Position) {
      return ovrOfAttrs(attributes, position)
    },
    liveTable(data: GameData, state: ImmersiveState, tournament?: number) {
      return liveTableFor(data, state, tournament)
    },
    validActions,
    /** Chances da contraproposta (mesma conta do `offer_respond`/counter). */
    acceptChance(data: GameData, state: ImmersiveState, offerId: string, counter: CounterAsk) {
      return acceptChance(state, offerId, counter, data)
    },
    summarize(data: GameData, state: ImmersiveState) {
      return summarize(data, shadowCareer(state))
    },
    /** Prévia exata do treino (não muda o estado). */
    trainingPreview(data: GameData, state: ImmersiveState, focus: TrainingFocus, intensity: 'leve' | 'normal' | 'intensa') {
      void data
      return trainingPreviewFor(state, focus, intensity)
    },
  }
  return engine
}

export const immersiveEngine = createImmersiveEngine(worldEngine)
export default immersiveEngine

// utilitários para testes/ferramentas
export { mem as immersiveMemory } from './mem'
export type { Fx as AgendaFixture }
