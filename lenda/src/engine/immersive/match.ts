/**
 * Partida ao vivo (minuto a minuto) no Modo Imersivo.
 *
 * MODELO (coerente com o mundo, src/engine/world/match.ts): λ de cada time vem de
 * `expectedGoals(forçaMandante, forçaVisitante, neutro)` com as forças efetivas que o mundo usou na
 * pré-simulação. O jogador soma `impacto` à força do time pelos minutos em campo. Os LANCES-CHAVE
 * dele (3–7 para titular, menos saindo do banco) são descontados do λ de fundo pelo valor esperado
 * de cada um — assim o total de gols do time continua ≈ λ do mundo, e a variação vem das escolhas.
 *
 * Cada minuto usa um sub-stream próprio (seed, item, fase, minuto): o resultado não depende de como
 * a UI fatia o `match_sim`. A chance de cada opção = base + atributo + condição (energia ao vivo,
 * fase, ritmo, moral) − força do adversário − pressão (importância × falta de experiência).
 * Minijogos: pênalti (canto; o goleiro escolhe o lado — e se adapta ao histórico) e timing (0–1, ideal 0,62).
 *
 * Nota 0–10: começa em 6,0 ao entrar; gol +1,0 (+0,2 em jogo grande), assistência +0,7, desarme
 * +0,25, defesa +0,35, erros −0,1…−0,4, gol sofrido em campo (defensores −0,15, demais −0,05),
 * gol do time em campo +0,08; fim: vitória +0,25, derrota −0,25, sem sofrer gol (GOL +0,6, defesa +0,35).
 */
import { clamp, type Rng } from '../rng'
import type { GameData, Position } from '../types'
import { stageDepth } from '../world/knockout'
import { expectedGoals, MATCH } from '../world/match'
import type {
  CalendarItem,
  ImmersiveEffect,
  ImmersiveState,
  KeyMoment,
  KeyMomentOption,
  KeyMomentSituation,
  LiveMatch,
  MatchEvent,
  MatchEventType,
  MatchPosture,
  TeamSide,
  UserMatchStats,
} from './types'
import { mem, type Fx, type LiveMem, type MomentOptionSpec, type MomentSpec, type PlannedMoment } from './mem'
import { ASSIST_TEXT, CROSS_OPTIONS, MOMENT_DESC, RESULT_TEXT, SHOT_KIND, SHOT_TEXT, T, fill, say } from './narration'
import { attr, isGK } from './player'
import { namesFor, squadOf } from './squad'
import { artigo, clubOf, countryArt, countryOf, irng, nationStrength, r1, type Art } from './util'

type Side = 'home' | 'away'

// ───────────────────────── calibragem ─────────────────────────

/** Escala das opções de finalização (calibrada para ~0,4 gol/jogo de um centroavante titular médio). */
export const GOAL_SCALE = 0.31

const N_MOMENTS: Record<Position, [number, number]> = {
  CA: [3, 5], PE: [3, 5], PD: [3, 5], MEI: [3, 5],
  ME: [3, 5], MD: [3, 5], MC: [3, 5], VOL: [3, 5], LD: [3, 5], LE: [3, 5], ZAG: [3, 5], GOL: [3, 5],
}

// cara a cara é raro (e vale muito: ~35–50% de gol); chute de fora/da entrada da área, comum e difícil
const MIX: Record<Position, Partial<Record<KeyMomentSituation, number>>> = {
  CA: { shot: 1.4, header: 1.2, one_on_one: 0.6, dribble: 1.5, pass: 2.4, tackle: 0.6, free_kick: 0.3, penalty: 0.25 },
  PE: { dribble: 3, shot: 1.8, cross: 2, one_on_one: 0.4, through_ball: 1, pass: 1.2, free_kick: 0.3, penalty: 0.15 },
  PD: { dribble: 3, shot: 1.8, cross: 2, one_on_one: 0.4, through_ball: 1, pass: 1.2, free_kick: 0.3, penalty: 0.15 },
  MEI: { through_ball: 2.4, pass: 2, shot: 2.1, dribble: 1.4, free_kick: 0.8, one_on_one: 0.2, penalty: 0.15 },
  ME: { cross: 2.4, dribble: 2, pass: 2, shot: 1, through_ball: 1, tackle: 0.8, interception: 0.5 },
  MD: { cross: 2.4, dribble: 2, pass: 2, shot: 1, through_ball: 1, tackle: 0.8, interception: 0.5 },
  MC: { pass: 3, through_ball: 1.8, shot: 1, tackle: 1.5, interception: 1.3, free_kick: 0.4 },
  VOL: { tackle: 3, interception: 3, pass: 2, block: 1, shot: 0.4, header: 0.4 },
  LD: { tackle: 2.5, interception: 2, cross: 2.2, block: 1, dribble: 0.8 },
  LE: { tackle: 2.5, interception: 2, cross: 2.2, block: 1, dribble: 0.8 },
  ZAG: { tackle: 2.5, interception: 2, block: 2.5, header: 1.2, pass: 0.5 },
  GOL: { save: 5, penalty_save: 0.3 },
}

const DEFENSIVE = new Set<KeyMomentSituation>(['tackle', 'interception', 'block', 'save', 'penalty_save'])

// ───────────────────────── helpers ─────────────────────────

const opp = (s: Side): Side => (s === 'home' ? 'away' : 'home')
const idx = (s: Side) => (s === 'home' ? 0 : 1)

function effOvr(s: ImmersiveState): number {
  const m = mem(s)
  const t = m.tempOvr && m.tempOvr.untilSeason >= s.season ? m.tempOvr.delta : 0
  return s.ovr + t
}

function teamSide(data: GameData, s: ImmersiveState, id: string, national: boolean, strength: number): TeamSide {
  if (national) {
    const c = countryOf(data, id)
    return { id, name: c?.name ?? id, shortName: c?.name ?? id, strength: Math.round(strength), national: true }
  }
  const c = clubOf(data, id)
  return { id, name: c?.name ?? id, shortName: c?.shortName || c?.name || id, strength: Math.round(strength), national: false }
}

function emptyStats(): UserMatchStats {
  return { minutes: 0, goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, keyPasses: 0, dribbles: 0, tackles: 0, rating: 6 }
}

function composure(s: ImmersiveState): number {
  return clamp((s.age - 17) / 14, 0, 1) * 0.6 + clamp(s.reputation / 100, 0, 1) * 0.4
}

export function agendaFixture(s: ImmersiveState, item: CalendarItem): Fx | undefined {
  if (!item.fixtureKey) return undefined
  const m = mem(s)
  return m.agenda.find((f) => f.key === item.fixtureKey) ?? m.natAgenda.find((f) => f.key === item.fixtureKey)
}

/** Placar agregado antes do jogo de volta, do ponto de vista do jogador. */
function priorAggregate(s: ImmersiveState, f: Fx): [number, number] | undefined {
  if (!(f.legs === 2 && f.leg === 2)) return undefined
  const m = mem(s)
  const list = f.kind === 'world_cup' || f.kind === 'national_continental' ? m.natAgenda : m.agenda
  const first = list.find((x) => x.competitionId === f.competitionId && x.stage === f.stage && x.opponent === f.opponent && x.leg === 1)
  if (first) {
    const fixed = m.fixed[first.key]
    const sc = fixed ? (Array.isArray(fixed) ? [fixed[0], fixed[1]] : fixed.score) : first.score
    return first.userHome ? [sc[0], sc[1]] : [sc[1], sc[0]]
  }
  return f.prior
}

// ───────────────────────── criação ─────────────────────────

/** Forças (mandante, visitante), mando e neutro da partida do item. */
function sides(data: GameData, s: ImmersiveState, item: CalendarItem) {
  const national = item.kind === 'national_match'
  const f = agendaFixture(s, item)
  const userTeam = national ? s.identity.nationality : s.clubId!
  const oppId = item.opponentId ?? f?.opponent ?? '?'
  const userHome = item.home ?? f?.userHome ?? true
  let sh: number
  let sa: number
  let neutral = false
  if (f) {
    ;[sh, sa] = f.strength
    neutral = !!f.neutral
  } else {
    const us = nationStrength(s.world, data, userTeam)
    const them = national ? nationStrength(s.world, data, oppId) : (s.world.clubs[oppId]?.strength ?? 65)
    sh = userHome ? us : them
    sa = userHome ? them : us
  }
  return { national, f, userTeam, oppId, userHome, sh, sa, neutral }
}

/** Fase de mata-mata do item ("Quartas de final · ida", "Clausura — Final") → profundidade (7 = quartas). */
const koDepth = (stage: string | undefined) => stageDepth(stage?.split(' — ').pop()?.replace(/ · (ida|volta)$/, ''))

interface Selection {
  status: LiveMatch['userStatus']
  sel: number
  reason: string
  youthPlan: boolean
  rotationPlan: boolean
  debut: boolean
}

/**
 * Escalação (titular/banco/fora + motivo). Consome o `r` do setup da partida na mesma ordem sempre:
 * a prévia (`selectionPreview`) e o `createLive` chegam ao mesmo resultado.
 */
function selection(s: ImmersiveState, item: CalendarItem, national: boolean, teamStr: number, r: Rng): Selection {
  const m = mem(s)
  const importance = item.importance ?? 0.4
  const pos = s.identity.position
  const gk = isGK(pos)
  const ovr = effOvr(s)
  let status: LiveMatch['userStatus']
  let sel = 0
  let reason = ''
  const injured = !!s.condition.injury
  const suspended = !national && (s.condition.suspendedMatches ?? 0) > 0
  const cup = !national && item.competitionId !== s.leagueId
  // jogo grande (decisão, clássico, quartas em diante): o plano de minutos da base não vale
  const bigGame = importance >= 0.7 || koDepth(item.stage) >= 7
  // 1ª temporada no clube da base: o garoto viaja com o elenco (banco) desde a 1ª rodada
  const academySeason = !national && s.seasons.length === 0 && s.age <= 17 && !!s.clubId && s.clubId === m.firstClubId
  let youthPlan = false
  let rotationPlan = false
  let debut = false
  if (injured) {
    status = 'out'
    reason = `Lesionado: ${s.condition.injury!.name.toLowerCase()} (${s.condition.injury!.weeksLeft} sem.)`
  } else if (suspended) {
    status = 'out'
    reason = `Suspenso (${s.condition.suspendedMatches} ${s.condition.suspendedMatches === 1 ? 'jogo' : 'jogos'})`
  } else if (national) {
    sel = (ovr - teamStr) * 3 + (s.condition.form - 50) * 0.25 + (s.condition.fitness - 70) * 0.2 + (s.condition.sharpness - 50) * 0.15 + r.normal(0, 5) + 6
    status = sel >= 0 ? 'starter' : 'bench'
    reason = status === 'starter' ? 'Titular na seleção' : 'Opção no banco da seleção'
  } else {
    const c = s.condition
    const rotation = importance < 0.5 && c.fitness < 72 ? -8 : 0
    const youth = s.age <= 17 ? -5 : 0
    sel =
      (ovr - teamStr) * 3.2 +
      (s.relationships.coach - 50) * 0.45 +
      (c.form - 50) * 0.25 +
      (c.fitness - 75) * 0.35 +
      (c.sharpness - 50) * 0.08 +
      rotation +
      youth +
      r.normal(0, 5)
    status = sel >= 0 ? 'starter' : sel >= (gk ? -30 : -22) ? 'bench' : 'out'
    // goleiro da base: estreia em jogos menores de copa, banco de vez em quando no resto
    if (status !== 'starter' && gk && s.age <= 19) {
      const behind = 0.12 * m.clubMatches - s.seasonStats.apps
      if (cup && importance < 0.55 && r.chance(clamp(0.3 + behind * 0.2, 0.1, 0.8))) {
        status = 'starter'
        youthPlan = true
      } else if (status === 'out' && r.chance(0.35)) status = 'bench'
    }
    if (status === 'out' && !gk) {
      // garoto da base: plano de minutos do técnico (banco em ~70% dos jogos menores, entra em ~metade);
      // atrasado em relação à meta (≈ 1/3 dos jogos na 1ª temporada) → mais chances
      const target = s.age <= 17 ? 0.42 : s.age <= 19 ? 0.3 : 0
      if (target > 0) {
        const behind = target * m.clubMatches - s.seasonStats.apps
        const p = clamp(0.7 - importance * 0.45 + behind * 0.15 + (s.relationships.coach - 50) / 150, 0.15, 0.95)
        if (r.chance(p) && !bigGame) {
          status = 'bench'
          youthPlan = true
        }
      }
      // rodízio: jogo menor de copa → quem está fora do time vai para o banco
      if (!youthPlan && cup && importance < 0.5 && r.chance(0.6)) {
        status = 'bench'
        rotationPlan = true
      }
      if (status === 'out' && academySeason && !bigGame) status = 'bench'
    }
    // garoto da base já no banco: segue o mesmo plano de minutos (não o critério de briga por posição)
    if (status === 'bench' && !gk && s.age <= 19 && !rotationPlan) youthPlan = true
    // estreia garantida: sem jogos na temporada e já passou ao menos um jogo do clube (na 1ª temporada da
    // base, já no 1º) → relacionado e entra; nunca num jogo grande
    if (!gk && s.age <= 19 && status !== 'starter' && s.seasonStats.apps === 0 && !bigGame) {
      const seen = s.calendar.filter((i) => i.kind === 'match' && i.season === s.season && i.done).length
      if (seen >= 1 || academySeason) {
        status = 'bench'
        youthPlan = true
        debut = true
      }
    }
    const coachTxt = s.relationships.coach >= 65 ? 'o técnico confia em você' : s.relationships.coach < 38 ? 'o técnico anda desconfiado' : ''
    const gap = ovr - teamStr
    reason =
      status === 'starter'
        ? youthPlan
          ? 'Titular: o técnico dá a chance ao goleiro da base no jogo de copa'
          : gap >= 4
          ? 'Titular: peça-chave do time'
          : `Titular${coachTxt ? `: ${coachTxt}` : c.form >= 62 ? ': boa fase' : ''}`
        : status === 'bench'
          ? debut
            ? 'No banco: o técnico prometeu a sua estreia hoje'
            : youthPlan
            ? 'No banco: o técnico quer dar minutos ao garoto da base'
            : rotationPlan
              ? 'No banco: rodízio para o jogo de copa'
              : c.fitness < 60
                ? 'No banco: poupado pelo cansaço'
                : gap < -4
                  ? 'No banco: o elenco tem opções mais fortes na posição'
                  : 'No banco: briga por posição'
          : gap < -10
            ? 'Fora dos relacionados: ainda abaixo do nível do elenco'
            : s.relationships.coach < 38
              ? 'Fora dos relacionados: o técnico perdeu a confiança'
              : c.fitness < 55
                ? 'Fora dos relacionados: sem condição física'
                : 'Fora dos relacionados: opção do técnico'
  }
  return { status, sel, reason, youthPlan, rotationPlan, debut }
}

/** Situação do jogador na partida do item (o mesmo sorteio do `createLive`), sem tocar no estado. */
export function selectionPreview(data: GameData, s: ImmersiveState, item: CalendarItem): LiveMatch['userStatus'] {
  const { national, userHome, sh, sa } = sides(data, s, item)
  return selection(s, item, national, userHome ? sh : sa, irng(s, 'live', item.id, 'setup')).status
}

export function createLive(data: GameData, s: ImmersiveState, item: CalendarItem): LiveMatch {
  const m = mem(s)
  const { national, f, userTeam, oppId, userHome, sh, sa, neutral } = sides(data, s, item)
  const userSide: Side = userHome ? 'home' : 'away'
  const teamStr = userHome ? sh : sa
  const oppStr = userHome ? sa : sh
  const r = irng(s, 'live', item.id, 'setup')
  const importance = item.importance ?? 0.4
  const pos = s.identity.position
  const gk = isGK(pos)
  const ovr = effOvr(s)

  // ── escalação ──
  const { status, sel, reason, youthPlan, rotationPlan, debut } = selection(s, item, national, teamStr, r)
  let onAt = 999
  if (status === 'starter') onAt = 0
  else if (status === 'bench') {
    const youthTarget = s.age <= 17 ? 0.42 : 0.3
    const p = gk
      ? 0.03
      : debut
        ? 1 // estreia prometida: entra (o motivo no pré-jogo diz "prometeu a sua estreia hoje")
        : youthPlan
          ? clamp(0.7 - importance * 0.4 + Math.max(0, youthTarget * m.clubMatches - s.seasonStats.apps) * 0.12, 0.3, 0.92)
          : rotationPlan
            ? 0.5
            : clamp(0.55 + sel / 50, 0.15, 0.9)
    if (r.chance(p)) onAt = youthPlan ? r.int(62, 84) : r.int(56, 82)
  }
  const frac = onAt === 0 ? 0.95 : onAt < 999 ? (90 - onAt) / 90 : 0

  // ── elencos e nomes ──
  const oppNational = national
  const usSquad = squadOf(data, s.world, userTeam, s.season, national)
  const themSquad = squadOf(data, s.world, oppId, s.season, oppNational)
  const me = s.identity.surname.toLowerCase()
  const us = namesFor(usSquad.filter((p) => p.short.toLowerCase() !== me), pos)
  const them = namesFor(themSquad.filter((p) => p.short.toLowerCase() !== me))

  // ── λ e plano de lances ──
  const impact = clamp((ovr - teamStr) * 0.12 + (s.condition.form - 50) * 0.01, -1, 2.5) * frac
  const [lh, la] = expectedGoals(sh + (userSide === 'home' ? impact : 0), sa + (userSide === 'away' ? impact : 0), neutral)
  const plan = planMoments(s, r, pos, onAt, importance)
  const lm: LiveMem = {
    itemId: item.id,
    national,
    lambda: [lh, la],
    plan,
    momentIdx: 0,
    onAt,
    startMinute: onAt === 0 ? 0 : onAt,
    fitness: s.condition.fitness,
    decider: false,
    extraTime: false,
    teammates: us.all.length ? us.all : ['o camisa 10'],
    opponents: them.all.length ? distinctFrom(them.all, us.all) : ['o atacante'],
    keeper: userSide === 'home' ? [us.keeper, them.keeper] : [them.keeper, us.keeper],
    subsDone: [0, 0],
    cards: { yellow: 0, red: false },
    goalsFor: 0,
    goalsAgainst: 0,
    lastEventMinute: 0,
  }
  if (gk) lm.keeper[idx(userSide)] = s.identity.surname
  // escalação da narração: 10 de linha + goleiro; titular de linha, o jogador ocupa uma das vagas
  {
    const ui = idx(userSide)
    const n = onAt === 0 && !gk ? 9 : 10
    const xi: [string[], string[]] = [[], []]
    const bench: [string[], string[]] = [[], []]
    xi[ui] = lm.teammates.slice(0, n)
    bench[ui] = lm.teammates.slice(n)
    xi[1 - ui] = lm.opponents.slice(0, 10)
    bench[1 - ui] = lm.opponents.slice(10)
    lm.xi = xi
    lm.bench = bench
  }
  // desconta do λ de fundo o valor esperado dos lances do jogador
  const ctxOpp = oppStr
  let eFor = 0
  let eAgainst = 0
  for (const pm of plan) {
    const e = expectedOf(s, pm.situation, ctxOpp, importance)
    eFor += e.for
    eAgainst += e.against
  }
  const ui = idx(userSide)
  const lam: [number, number] = [lh, la]
  lam[ui] = Math.max(0.12, lam[ui] - eFor)
  lam[1 - ui] = Math.max(0.12, lam[1 - ui] - eAgainst)
  lm.lambda = lam

  let knockout = false
  if (f) {
    const prior = priorAggregate(s, f)
    lm.decider = !!f.knockout || (f.legs === 2 && f.leg === 2)
    lm.extraTime = f.extraTime !== false && lm.decider
    if (f.knockout && f.extraTime === undefined) lm.extraTime = true
    // vantagem do empate só em confronto de ida e volta (jogo único vai para pênaltis, como no mundo)
    lm.seedAdvancesOnDraw = f.legs === 2 ? f.seedAdvancesOnDraw : undefined
    lm.userSeed = f.userSeed
    lm.prior = prior
    knockout = lm.decider
  }
  m.live = lm

  const home = teamSide(data, s, userHome ? userTeam : oppId, national, sh)
  const away = teamSide(data, s, userHome ? oppId : userTeam, national, sa)
  const possession = clamp(Math.round(50 + (sh - sa) * 0.8 + (neutral ? 0 : 2)), 30, 70)
  const live: LiveMatch = {
    itemId: item.id,
    selectionReason: reason,
    fixtureKey: item.fixtureKey,
    competitionId: item.competitionId ?? (national ? 'friendly' : (s.leagueId ?? '')),
    stage: item.stage,
    home,
    away,
    userSide,
    userStatus: status,
    userOnPitch: false,
    phase: 'pre',
    minute: 0,
    score: [0, 0],
    knockout,
    events: [],
    pendingMoment: null,
    stats: emptyStats(),
    team: { possession: [possession, 100 - possession], shots: [0, 0], onTarget: [0, 0] },
    importance,
  }
  if (lm.prior) live.aggregate = userHome ? [lm.prior[0], lm.prior[1]] : [lm.prior[1], lm.prior[0]]
  return live
}

/** Tira do adversário os nomes que também estão no seu time ("Rafael" marca pelos dois lados), se sobrar elenco. */
function distinctFrom(list: string[], other: string[]): string[] {
  const mine = new Set(other.map((x) => x.toLowerCase()))
  const out = list.filter((x) => !mine.has(x.toLowerCase()))
  return out.length >= 12 ? out : list
}

function planMoments(s: ImmersiveState, r: Rng, pos: Position, onAt: number, importance: number): PlannedMoment[] {
  if (onAt >= 999) return []
  const [lo, hi] = N_MOMENTS[pos]
  let n = r.int(lo, hi)
  if (r.chance(importance * 0.3)) n++
  if (onAt > 0) n = Math.max(1, Math.round((n * (90 - onAt)) / 90 + 0.3))
  const from = onAt === 0 ? 4 : onAt + 2
  const to = 88
  const span = Math.max(1, to - from)
  const mix = MIX[pos]
  const sits = Object.keys(mix) as KeyMomentSituation[]
  const out: PlannedMoment[] = []
  for (let i = 0; i < n; i++) {
    let minute = Math.round(from + ((i + 0.2 + r.next() * 0.6) / n) * span)
    if (minute === 45 || minute === 46) minute = 44
    out.push({ minute: clamp(minute, from, to), situation: r.weighted(sits, (x) => mix[x] ?? 0) })
  }
  out.sort((a, b) => a.minute - b.minute)
  for (let i = 1; i < out.length; i++) if (out[i].minute <= out[i - 1].minute) out[i].minute = Math.min(89, out[i - 1].minute + 2)
  return out
}

// ───────────────────────── opções e chances ─────────────────────────

interface OptDef {
  id: string
  label: string
  icon: string
  base: number
  attrs: string[]
  on: MomentOptionSpec['onSuccess']
  p2?: number
  card?: number
  risk?: string
  rating: [number, number]
  goal?: boolean
}

function optionDefs(sit: KeyMomentSituation, tm: string): OptDef[] {
  const G = GOAL_SCALE
  switch (sit) {
    case 'shot':
      return [
        { id: 'shoot_placed', label: 'Chutar colocado', icon: 'target', base: 0.3 * G, attrs: ['shooting'], on: 'goal', rating: [1, -0.15], goal: true },
        { id: 'shoot_power', label: 'Bater forte', icon: 'zap', base: 0.25 * G, attrs: ['shooting', 'physical'], on: 'goal', risk: 'Pode isolar', rating: [1.05, -0.2], goal: true },
        { id: 'lay_off', label: `Tocar para ${tm}`, icon: 'send', base: 0.62, attrs: ['passing'], on: 'assist_chance', p2: 0.22, rating: [0.2, -0.1] },
      ]
    case 'one_on_one':
      // cara a cara: base ≈ 30% (≈ 40% para um atacante de nível, ≈ 50% para um craque; ≈ 20–25% aos 16 anos)
      return [
        { id: 'finish', label: 'Tirar do goleiro', icon: 'target', base: 0.97 * G, attrs: ['shooting'], on: 'goal', rating: [1, -0.3], goal: true },
        { id: 'round_gk', label: 'Driblar o goleiro', icon: 'zap', base: 0.81 * G, attrs: ['dribbling'], on: 'goal', risk: 'Perde a bola', rating: [1.15, -0.35], goal: true },
        { id: 'square', label: `Rolar para ${tm}`, icon: 'send', base: 0.66, attrs: ['passing'], on: 'assist_chance', p2: 0.27, rating: [0.3, -0.25] },
      ]
    case 'dribble':
      return [
        { id: 'take_on', label: 'Partir para cima', icon: 'zap', base: 0.5, attrs: ['dribbling', 'pace'], on: 'follow_shot', risk: 'Contra-ataque', rating: [0.15, -0.12] },
        { id: 'one_two', label: `Tabelar com ${tm}`, icon: 'repeat', base: 0.54, attrs: ['passing', 'dribbling'], on: 'follow_shot', rating: [0.12, -0.08] },
        { id: 'win_foul', label: 'Buscar a falta', icon: 'flag', base: 0.45, attrs: ['dribbling'], on: 'foul_won', rating: [0.1, -0.05] },
      ]
    case 'pass':
      return [
        { id: 'key_pass', label: `Passe para ${tm} na área`, icon: 'send', base: 0.48, attrs: ['passing'], on: 'assist_chance', p2: 0.17, rating: [0.2, -0.1] },
        { id: 'keep', label: 'Passe seguro', icon: 'shield', base: 0.86, attrs: ['passing'], on: 'chance', rating: [0.05, -0.1] },
        { id: 'long_shot', label: 'Arriscar de longe', icon: 'target', base: 0.1 * G, attrs: ['shooting'], on: 'goal', risk: 'Perde a posse', rating: [1.1, -0.1], goal: true },
      ]
    case 'through_ball':
      return [
        { id: 'through', label: `Enfiar para ${tm}`, icon: 'send', base: 0.45, attrs: ['passing'], on: 'assist_chance', p2: 0.21, rating: [0.25, -0.1] },
        { id: 'switch', label: 'Inverter o jogo', icon: 'arrow-right-left', base: 0.72, attrs: ['passing'], on: 'chance', rating: [0.08, -0.08] },
        { id: 'long_shot', label: 'Arriscar de longe', icon: 'target', base: 0.1 * G, attrs: ['shooting'], on: 'goal', risk: 'Perde a posse', rating: [1.1, -0.1], goal: true },
      ]
    case 'cross':
      return [
        { id: 'cross_high', label: 'Cruzar na área', icon: 'send', base: 0.42, attrs: ['passing'], on: 'assist_chance', p2: 0.18, rating: [0.18, -0.08] },
        { id: 'low_cross', label: 'Cruzamento rasteiro', icon: 'arrow-down-right', base: 0.47, attrs: ['passing'], on: 'assist_chance', p2: 0.17, rating: [0.18, -0.08] },
        { id: 'cut_back', label: 'Cortar e chutar', icon: 'target', base: 0.12 * G, attrs: ['shooting'], on: 'goal', rating: [1, -0.1], goal: true },
      ]
    case 'header':
      return [
        { id: 'header_goal', label: 'Cabecear para o gol', icon: 'target', base: 0.42 * G, attrs: ['physical'], on: 'goal', rating: [1, -0.1], goal: true },
        { id: 'nod_down', label: `Escorar para ${tm}`, icon: 'send', base: 0.5, attrs: ['physical'], on: 'assist_chance', p2: 0.16, rating: [0.18, -0.08] },
      ]
    case 'free_kick':
      return [
        { id: 'fk_direct', label: 'Bater direto', icon: 'target', base: 0.22 * G, attrs: ['shooting'], on: 'goal', rating: [1.2, -0.05], goal: true },
        { id: 'fk_cross', label: 'Levantar na área', icon: 'send', base: 0.46, attrs: ['passing'], on: 'assist_chance', p2: 0.13, rating: [0.15, -0.05] },
      ]
    case 'penalty':
      return [
        { id: 'pen_left', label: 'Canto esquerdo', icon: 'arrow-left', base: 0.77, attrs: ['shooting'], on: 'goal', rating: [0.9, -0.5], goal: true },
        { id: 'pen_center', label: 'No meio', icon: 'arrow-up', base: 0.77, attrs: ['shooting'], on: 'goal', risk: 'Se o goleiro ficar, defende', rating: [1, -0.6], goal: true },
        { id: 'pen_right', label: 'Canto direito', icon: 'arrow-right', base: 0.77, attrs: ['shooting'], on: 'goal', rating: [0.9, -0.5], goal: true },
      ]
    case 'tackle':
      return [
        { id: 'tackle_stand', label: 'Dar o bote', icon: 'shield', base: 0.55, attrs: ['defending'], on: 'stop', p2: 0.3, card: 0.05, rating: [0.3, -0.25] },
        { id: 'tackle_slide', label: 'Carrinho', icon: 'zap', base: 0.62, attrs: ['defending', 'physical'], on: 'stop', p2: 0.36, card: 0.2, risk: 'Cartão', rating: [0.35, -0.3] },
        { id: 'jockey', label: 'Acompanhar e fechar', icon: 'move', base: 0.48, attrs: ['defending', 'pace'], on: 'stop', p2: 0.18, rating: [0.25, -0.2] },
      ]
    case 'interception':
      return [
        { id: 'anticipate', label: 'Antecipar', icon: 'zap', base: 0.52, attrs: ['defending', 'pace'], on: 'stop', p2: 0.38, rating: [0.32, -0.25] },
        { id: 'cover', label: 'Recuar e cobrir', icon: 'shield', base: 0.62, attrs: ['defending'], on: 'stop', p2: 0.22, rating: [0.25, -0.2] },
        { id: 'tactical_foul', label: 'Falta tática', icon: 'flag', base: 0.58, attrs: ['defending'], on: 'stop', p2: 0.14, card: 0.75, risk: 'Amarelo quase certo', rating: [-0.1, -0.2] },
      ]
    case 'block':
      return [
        { id: 'body', label: 'Jogar o corpo na frente', icon: 'shield', base: 0.55, attrs: ['physical'], on: 'stop', p2: 0.48, rating: [0.35, -0.3] },
        { id: 'angle', label: 'Fechar o ângulo', icon: 'move', base: 0.5, attrs: ['defending'], on: 'stop', p2: 0.38, rating: [0.25, -0.25] },
      ]
    case 'save':
      return [
        { id: 'parry', label: 'Espalmar', icon: 'hand', base: 0.62, attrs: ['reflexes', 'diving'], on: 'save', p2: 0.62, rating: [0.3, -0.35] },
        { id: 'catch', label: 'Encaixar', icon: 'shield', base: 0.52, attrs: ['handling'], on: 'save', p2: 0.8, rating: [0.35, -0.4] },
        { id: 'rush', label: 'Sair do gol', icon: 'zap', base: 0.47, attrs: ['positioning', 'diving'], on: 'save', p2: 0.85, risk: 'Gol vazio', rating: [0.45, -0.45] },
      ]
    case 'penalty_save':
      return [
        { id: 'dive_left', label: 'Pular à esquerda', icon: 'arrow-left', base: 0.26, attrs: ['diving'], on: 'save', p2: 1, rating: [1, -0.1] },
        { id: 'stay', label: 'Ficar no meio', icon: 'arrow-up', base: 0.16, attrs: ['reflexes'], on: 'save', p2: 1, rating: [1, -0.1] },
        { id: 'dive_right', label: 'Pular à direita', icon: 'arrow-right', base: 0.26, attrs: ['diving'], on: 'save', p2: 1, rating: [1, -0.1] },
      ]
  }
}

function attrAvg(s: ImmersiveState, keys: string[]): number {
  const gk = isGK(s.identity.position)
  let t = 0
  for (const k of keys) {
    // goleiro em lance de linha (ou vice-versa) usa um valor baixo
    const has = k in (s.attributes as object)
    t += has ? attr(s.attributes, k as never) : gk ? 35 : 40
  }
  return t / keys.length
}

function optionChance(s: ImmersiveState, d: OptDef, oppStr: number, importance: number, fitness: number, penalty = false): number {
  const c = s.condition
  const a = attrAvg(s, d.attrs)
  const pressure = importance * 0.06 * (1 - composure(s))
  if (d.goal && !penalty) {
    // finalizações: efeitos relativos (uma chance baixa não some com um adversário forte)
    const rel = (fitness - 70) * 0.004 + (c.form - 50) * 0.003 + (c.sharpness - 60) * 0.002 + (c.morale - 60) * 0.002
    // a qualidade separa mais no topo: acima de 85 (craque) cada ponto vale o dobro
    const skill = (a - 70) * 0.02 + Math.max(0, a - 85) * 0.02
    const mult = clamp(1 + skill + rel - (oppStr - 72) * 0.025 - pressure * 2.5, 0.35, 2.1)
    return clamp(d.base * mult, 0.02, 0.9)
  }
  const cond = (fitness - 70) * 0.0015 + (c.form - 50) * 0.0012 + (c.sharpness - 60) * 0.0008 + (c.morale - 60) * 0.0008
  const attrW = penalty ? 0.003 : 0.006
  const oppEff = penalty ? 0.002 : 0.006
  const v = d.base + (a - 70) * attrW + cond - (oppStr - 72) * oppEff - pressure
  return clamp(v, 0.04, 0.95)
}

/** Valor esperado de um lance (gols a favor e contra) com a melhor opção — calibra o λ de fundo. */
/** Valor em gols de um lance encadeado (drible → chute/1×1; falta sofrida → falta/pênalti). */
const FOLLOW_VALUE = 0.12
const FOUL_VALUE = 0.2
/** Peso do risco de cartão na escolha defensiva "esperta" (em gols equivalentes). */
const CARD_COST = 0.1

function expectedOf(s: ImmersiveState, sit: KeyMomentSituation, oppStr: number, importance: number): { for: number; against: number } {
  const defs = optionDefs(sit, '')
  // energia média em campo (o goleiro quase não cansa)
  const fit = s.condition.fitness - (isGK(s.identity.position) ? 4 : 10)
  let bestFor = 0
  let bestAgainst = Infinity
  let bestObj = Infinity
  for (const d of defs) {
    const ch = optionChance(s, d, oppStr, importance, fit, sit === 'penalty')
    if (d.on === 'goal') bestFor = Math.max(bestFor, ch)
    else if (d.on === 'assist_chance') bestFor = Math.max(bestFor, ch * (d.p2 ?? 0.3))
    else if (d.on === 'follow_shot') bestFor = Math.max(bestFor, ch * FOLLOW_VALUE)
    else if (d.on === 'foul_won') bestFor = Math.max(bestFor, ch * FOUL_VALUE)
    if (d.on === 'stop' || d.on === 'save') {
      // a mesma opção que a IA "esperta" escolheria (menos gols, pesando o cartão)
      const g = (1 - ch) * (d.p2 ?? 0.4)
      const obj = g + (d.card ?? 0) * CARD_COST
      if (obj < bestObj) {
        bestObj = obj
        bestAgainst = g
      }
    }
  }
  if (!DEFENSIVE.has(sit)) return { for: bestFor, against: 0 }
  // lance defensivo = um ataque do adversário que o λ de fundo deixa de contar: desconta só a conversão
  // esperada com a melhor opção (jogando bem, o time sofre ≈ o λ do mundo; jogando mal, mais)
  return { for: 0, against: bestAgainst === Infinity ? 0 : bestAgainst }
}

// ───────────────────────── eventos ─────────────────────────

function at(side: Side, zone: 'goal' | 'box' | 'mid' | 'bench', r: Rng): { x: number; y: number } {
  const right = side === 'home'
  if (zone === 'goal') return { x: right ? r.int(88, 97) : r.int(3, 12), y: r.int(38, 62) }
  if (zone === 'box') return { x: right ? r.int(76, 92) : r.int(8, 24), y: r.int(24, 76) }
  if (zone === 'bench') return { x: 50, y: 99 }
  return { x: r.int(30, 70), y: r.int(12, 88) }
}

function push(s: ImmersiveState, live: LiveMatch, e: MatchEvent, fx: ImmersiveEffect[]) {
  e.text = fixArticles(e.text, live)
  live.events.push(e)
  fx.push({ type: 'match_event', event: e })
  const i = idx(e.side)
  if (e.type === 'goal' || e.type === 'penalty_goal') {
    live.score[i]++
    live.team.shots[i]++
    live.team.onTarget[i]++
  } else if (e.type === 'own_goal') live.score[i]++
  else if (e.type === 'chance' || e.type === 'woodwork') live.team.shots[i]++
  else if (e.type === 'save') {
    live.team.shots[i]++
    live.team.onTarget[i]++
  }
  // nota: gols com o jogador em campo
  if ((e.type === 'goal' || e.type === 'penalty_goal' || e.type === 'own_goal') && live.userOnPitch && live.phase !== 'penalties') {
    const lm = mem(s).live!
    const pos = s.identity.position
    const def = pos === 'GOL' || pos === 'ZAG' || pos === 'LD' || pos === 'LE' || pos === 'VOL'
    if (e.side === live.userSide) {
      lm.goalsFor++
      if (!e.byUser) live.stats.rating = r1(clamp(live.stats.rating + 0.08, 3, 10))
    } else {
      lm.goalsAgainst++
      if (isGK(pos)) live.stats.conceded = (live.stats.conceded ?? 0) + 1
      live.stats.rating = r1(clamp(live.stats.rating - (def ? 0.1 : 0.04), 3, 10))
    }
  }
}

function teamName(live: LiveMatch, side: Side): string {
  return side === 'home' ? live.home.shortName : live.away.shortName
}

// ───────────────────────── artigos na narração ─────────────────────────

function teamArt(t: TeamSide): Art {
  return t.national ? countryArt(t.name) : artigo(t)
}

const CONTRACT: Record<string, Record<Exclude<Art, 'o'>, string>> = {
  do: { a: 'da', os: 'dos', as: 'das', '': 'de' },
  no: { a: 'na', os: 'nos', as: 'nas', '': 'em' },
  pelo: { a: 'pela', os: 'pelos', as: 'pelas', '': 'por' },
  ao: { a: 'à', os: 'aos', as: 'às', '': 'a' },
  o: { a: 'a', os: 'os', as: 'as', '': '' },
}

/**
 * Os modelos da narração falam "do {t}", "no {t}", "O {t}": acerta o artigo pelo time ("GOL da Ponte
 * Preta", "na Juventus", "da Argentina", "de Portugal", "dos Estados Unidos").
 */
function fixArticles(text: string, live: LiveMatch): string {
  let out = text
  for (const t of [live.home, live.away]) {
    const art = teamArt(t)
    if (art === 'o') continue
    for (const name of new Set([t.shortName, t.name])) {
      if (!name) continue
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      out = out.replace(new RegExp(`(^|[^\\p{L}])(do|no|pelo|ao|o|Do|No|Pelo|Ao|O) (${esc})(?![\\p{L}])`, 'gu'), (_m, pre: string, w: string, nm: string) => {
        let rep = CONTRACT[w.toLowerCase()][art]
        if (rep && w[0] !== w[0].toLowerCase()) rep = rep.charAt(0).toUpperCase() + rep.slice(1)
        return `${pre}${rep ? `${rep} ` : ''}${nm}`
      })
    }
  }
  return out
}

/** Titulares em campo agora e reservas ainda não usados de um lado (monta na 1ª consulta). */
function lineup(lm: LiveMem, live: LiveMatch, side: Side): { xi: string[]; bench: string[] } {
  if (!lm.xi || !lm.bench) {
    // save antigo (sem escalação montada no createLive): 10 de linha de cada lado
    const split = (list: string[]): [string[], string[]] => [list.slice(0, 10), list.slice(10)]
    const [hx, hb] = split(live.userSide === 'home' ? lm.teammates : lm.opponents)
    const [ax, ab] = split(live.userSide === 'home' ? lm.opponents : lm.teammates)
    lm.xi = [hx, ax]
    lm.bench = [hb, ab]
  }
  const i = idx(side)
  return { xi: lm.xi[i], bench: lm.bench[i] }
}

/** Anota quem entrou do banco (não sai de novo). */
function cameOn(lm: LiveMem, side: Side, names: string[]) {
  const fb: [string[], string[]] = lm.fromBench ?? [[], []]
  fb[idx(side)].push(...names)
  lm.fromBench = fb
}

/** Posições do `xi` de quem começou jogando (quem já entrou do banco não sai de novo). */
function starterSlots(lm: LiveMem, live: LiveMatch, side: Side, xi: string[], from = 0): number[] {
  void live
  const fresh = new Set(lm.fromBench?.[idx(side)] ?? [])
  const out: number[] = []
  for (let j = from; j < xi.length; j++) if (!fresh.has(xi[j])) out.push(j)
  return out
}

function pickName(lm: LiveMem, live: LiveMatch, side: Side, r: Rng): string {
  // os primeiros da lista são os craques (marcam mais); quem entra ocupa a vaga de quem saiu
  const { xi } = lineup(lm, live, side)
  const list = xi.length ? xi : side === live.userSide ? lm.teammates : lm.opponents
  return r.pick(list.slice(0, Math.max(1, Math.min(list.length, 8))))
}

// ───────────────────────── simulação ─────────────────────────

export function kickoff(s: ImmersiveState, fx: ImmersiveEffect[]) {
  const live = s.live!
  const lm = mem(s).live!
  live.phase = 'first_half'
  live.minute = 0
  if (lm.onAt === 0) live.userOnPitch = true
  const r = irng(s, 'live', lm.itemId, 'kickoff')
  push(s, live, { minute: 0, type: 'kickoff', side: 'home', text: say(r, T.kickoff, { h: live.home.shortName, aw: live.away.shortName, st: stagePhrase(live.stage) }), at: { x: 50, y: 50 } }, fx)
}

/**
 * Fase do jogo no fim da frase de abertura (" pela 31ª rodada", " na volta da semifinal"); fase sem
 * jeito natural de dizer fica de fora (o placar da TV já mostra).
 */
export function stagePhrase(stage: string | undefined): string {
  if (!stage) return ''
  const [head, tail] = stage.includes(' — ') ? [stage.slice(stage.lastIndexOf(' — ') + 3), stage.slice(0, stage.indexOf(' — '))] : [stage, '']
  const m = /^(.*?)(?: · (ida|volta))?$/.exec(head)!
  const name = m[1]
  const leg = m[2]
  const rodada = /^(?:(.+) · )?(\d+ª rodada)$/.exec(name)
  if (rodada) return ` pela ${rodada[2]}${rodada[1] ? ` do ${rodada[1]}` : ''}`
  if (name === 'Amistoso internacional') return ' em amistoso internacional'
  if (name === 'Eliminatórias da Copa') return ' pelas Eliminatórias da Copa'
  const KO: Record<string, string> = { Final: 'da final', Semifinal: 'da semifinal', 'Quartas de final': 'das quartas de final', 'Oitavas de final': 'das oitavas de final' }
  if (KO[name]) {
    const what = leg ? `${leg === 'ida' ? 'na ida' : 'na volta'} ${KO[name]}` : name === 'Final' ? 'na grande final' : `${KO[name].replace(/^d/, 'n')}`
    return ` ${what}${tail ? ` do ${/^play-off/i.test(tail) ? tail.toLowerCase() : tail}` : ''}`
  }
  return ''
}

/**
 * Postura em campo (pré-jogo ou durante a partida): "pedir a bola" cria até 2 lances decisivos a mais
 * no tempo que resta; "poupar" corta um (sempre sobra ao menos um) — e o desgaste muda em `minute`.
 * O saldo por partida fica entre −1 e +2, então alternar a postura não fabrica lances infinitos.
 */
export function setPosture(s: ImmersiveState, posture: MatchPosture): boolean {
  const live = s.live
  const lm = mem(s).live
  if (!live || !lm || live.pendingMoment || live.phase === 'full_time' || live.phase === 'penalties') return false
  if (posture !== 'ataque' && posture !== 'equilibrada' && posture !== 'poupar') return false
  if ((lm.posture ?? 'equilibrada') === posture) return true
  lm.posture = posture
  live.posture = posture
  if (lm.onAt >= 999) return true
  const now = live.phase === 'pre' ? 0 : live.minute
  const from = Math.max(now + 3, lm.onAt + 2, 4)
  const net = lm.postureNet ?? 0
  const rest = () => lm.plan.slice(lm.momentIdx).filter((pm) => pm.minute >= from)
  if (posture === 'ataque' && net < 2 && from <= 86) {
    const r = irng(s, 'live', lm.itemId, 'posture', now, net)
    const mix = MIX[s.identity.position]
    const sits = Object.keys(mix) as KeyMomentSituation[]
    const add = Math.min(2 - net, now < 60 ? 2 : 1)
    for (let i = 0; i < add; i++) {
      let minute = r.int(from, 88)
      if (minute === 45 || minute === 46) minute = 47
      lm.plan.push({ minute, situation: r.weighted(sits, (x) => mix[x] ?? 0) })
    }
    lm.postureNet = net + add
  } else if (posture === 'poupar' && net > -1 && rest().length > 1) {
    const last = rest()[rest().length - 1]
    lm.plan.splice(lm.plan.lastIndexOf(last), 1)
    lm.postureNet = net - 1
  }
  // mantém o plano que falta em ordem e sem dois lances no mesmo minuto
  const head = lm.plan.slice(0, lm.momentIdx)
  const tail = lm.plan.slice(lm.momentIdx).sort((a, b) => a.minute - b.minute)
  for (let i = 1; i < tail.length; i++) if (tail[i].minute <= tail[i - 1].minute) tail[i].minute = Math.min(89, tail[i - 1].minute + 2)
  lm.plan = [...head, ...tail]
  return true
}

type Stop = 'moment' | 'half' | 'end' | 'continue'

/** Anda até o próximo lance-chave, intervalo ou fim. */
export function simulate(data: GameData, s: ImmersiveState, fx: ImmersiveEffect[]): Stop {
  const live = s.live!
  const lm = mem(s).live!
  if (live.phase === 'pre') {
    kickoff(s, fx)
    return 'continue'
  }
  if (live.pendingMoment) return 'moment'
  if (live.phase === 'full_time') return 'end'
  if (live.phase === 'half_time') {
    live.phase = 'second_half'
    live.minute = 45
    const r = irng(s, 'live', lm.itemId, 'second')
    push(s, live, { minute: 46, type: 'kickoff', side: 'away', text: say(r, T.secondHalf), at: { x: 50, y: 50 } }, fx)
  }
  if (live.phase === 'penalties') return shootoutStep(data, s, fx)
  const end = live.phase === 'first_half' ? 45 : live.phase === 'second_half' ? 90 : 120
  for (let t = live.minute + 1; t <= end; t++) {
    live.minute = t
    minute(data, s, t, fx)
    const pm = lm.plan[lm.momentIdx]
    if (live.userOnPitch && pm && pm.minute <= t) {
      openMoment(data, s, pm, fx)
      return 'moment'
    }
    // lances planejados enquanto ele não estava em campo são descartados
    while (!live.userOnPitch && lm.plan[lm.momentIdx] && lm.plan[lm.momentIdx].minute <= t) lm.momentIdx++
  }
  return endOfPeriod(data, s, fx)
}

function minute(data: GameData, s: ImmersiveState, t: number, fx: ImmersiveEffect[]) {
  const live = s.live!
  const lm = mem(s).live!
  const r = irng(s, 'live', lm.itemId, live.phase, t)
  const us = live.userSide
  // entrada do banco
  if (!live.userOnPitch && lm.onAt === t && lm.offAt === undefined) {
    live.userOnPitch = true
    lm.startMinute = t
    live.stats.rating = 6
    // sai um titular (nunca um craque do topo da lista) e o jogador ocupa a vaga dele
    const { xi } = lineup(lm, live, us)
    const slots = starterSlots(lm, live, us, xi)
    const j = slots.length ? slots.reduce((a, b) => (Math.abs(b - 6) < Math.abs(a - 6) ? b : a)) : -1
    const off = (j >= 0 ? xi.splice(j, 1)[0] : undefined) ?? 'um companheiro'
    push(s, live, { minute: t, type: 'sub_on', side: us, byUser: true, player: s.identity.surname, assist: off, text: say(r, T.userSubOn, { p: s.identity.surname, a: off }), at: at(us, 'bench', r) }, fx)
  }
  // energia ao vivo e lesão
  if (live.userOnPitch) {
    const phys = isGK(s.identity.position) ? 70 : attr(s.attributes, 'physical')
    const drain = lm.posture === 'ataque' ? 1.3 : lm.posture === 'poupar' ? 0.7 : 1
    lm.fitness = clamp(lm.fitness - (isGK(s.identity.position) ? 0.1 : 0.3 * (1.3 - phys / 150) * drain), 0, 100)
    // ≈ 2,5% de lesão por jogo completo (mais com a energia baixa e na prorrogação)
    const injP = 0.00028 * (lm.fitness < 40 ? 3 : lm.fitness < 60 ? 1.6 : 1) * (live.phase === 'extra_time' ? 1.5 : 1)
    if (r.chance(injP)) {
      lm.injured = true
      push(s, live, { minute: t, type: 'injury', side: us, byUser: true, player: s.identity.surname, text: say(r, T.injury, { p: s.identity.surname }), at: at(us, 'mid', r) }, fx)
      userOff(s, t, fx, 'injury')
    } else if (live.userStatus === 'starter' && t >= 58 && t <= 88 && lm.fitness < 42 && !isGK(s.identity.position) && r.chance(0.12)) {
      userOff(s, t, fx, 'coach')
    }
  }
  // gols de fundo
  // expulsões de cada lado (um a menos pesa; dois a menos, mais)
  const reds = [live.events.filter((e) => e.type === 'red' && e.side === 'home').length, live.events.filter((e) => e.type === 'red' && e.side === 'away').length]
  const etMult = live.phase === 'extra_time' ? MATCH.extraTime * 3 : 1
  for (const side of ['home', 'away'] as Side[]) {
    const i = idx(side)
    let lam = lm.lambda[i] * etMult
    lam *= Math.pow(0.75, Math.min(2, reds[i])) * Math.pow(1.2, Math.min(2, reds[1 - i]))
    if (r.chance(lam / 90)) {
      const scorer = pickName(lm, live, side, r)
      const list = lineup(lm, live, side).xi
      const others = list.filter((x) => x !== scorer)
      const assist = others.length && r.chance(0.6) ? r.pick(others.slice(0, 8)) : undefined
      const tpl = (side === us ? T.goalTeam : T.goalOpp).filter((x) => assist || !x.includes('{a}'))
      const text = say(r, tpl, { t: teamName(live, side), p: scorer, a: assist, g: lm.keeper[1 - i] })
      push(s, live, { minute: t, type: 'goal', side, player: scorer, assist, text, at: at(side, 'goal', r) }, fx)
      if (r.chance(0.06)) push(s, live, { minute: t, type: 'var', side, text: say(r, T.var), at: { x: 50, y: 50 } }, fx)
    }
  }
  // lances de enfeite (chances, defesas, trave, cartões, substituições)
  const tot = lm.lambda[0] + lm.lambda[1] || 1
  if (r.chance(0.07)) {
    const side: Side = r.chance(lm.lambda[0] / tot) ? 'home' : 'away'
    const p = pickName(lm, live, side, r)
    const roll = r.next()
    if (roll < 0.55) push(s, live, { minute: t, type: 'chance', side, player: p, text: say(r, T.chance, { p, t: teamName(live, side) }), at: at(side, 'box', r) }, fx)
    else if (roll < 0.93) push(s, live, { minute: t, type: 'save', side, player: p, text: say(r, T.save, { p, g: lm.keeper[1 - idx(side)] }), at: at(side, 'box', r) }, fx)
    else push(s, live, { minute: t, type: 'woodwork', side, player: p, text: say(r, T.woodwork, { p }), at: at(side, 'goal', r) }, fx)
  }
  // cartões (qualquer um em campo, não só os craques): o 2º amarelo expulsa — quem já tem amarelo joga
  // com cuidado, então a falta dele só vira 2º amarelo às vezes (≈ 0,1 expulsão assim por jogo); expulso
  // sai da escalação (um a menos, e some da narração); nunca amarelo e vermelho direto no mesmo minuto
  let carded = false
  if (r.chance(0.035)) {
    const side: Side = r.chance(0.5) ? 'home' : 'away'
    const { xi } = lineup(lm, live, side)
    const booked = (lm.booked ??= [[], []])[idx(side)]
    let p = r.pick(xi.length ? xi : side === live.userSide ? lm.teammates : lm.opponents)
    const clean = xi.filter((x) => !booked.includes(x))
    const second = booked.includes(p) && r.chance(0.3)
    if (booked.includes(p) && !second && clean.length) p = r.pick(clean)
    carded = true
    if (booked.includes(p)) sendOff(s, lm, live, side, p, say(r, T.secondYellow, { p, t: teamName(live, side) }), t, r, fx)
    else {
      booked.push(p)
      push(s, live, { minute: t, type: 'yellow', side, player: p, text: say(r, T.yellow, { p, t: teamName(live, side) }), at: at(side, 'mid', r) }, fx)
    }
  }
  if (r.chance(0.0012) && !carded) {
    const side: Side = r.chance(0.5) ? 'home' : 'away'
    const p = pickName(lm, live, side, r)
    sendOff(s, lm, live, side, p, say(r, T.red, { p, t: teamName(live, side) }), t, r, fx)
  }
  if (t >= 58 && t <= 88 && live.phase === 'second_half') {
    // até 5 trocas por time em no máx. 3 paradas (duplas às vezes)
    for (const side of ['home', 'away'] as Side[]) {
      const i = idx(side)
      const { xi, bench } = lineup(lm, live, side)
      const slots = starterSlots(lm, live, side, xi, 2)
      if (lm.subsDone[i] < 5 && bench.length && slots.length && r.chance(0.05)) {
        const double = lm.subsDone[i] <= 3 && bench.length >= 2 && slots.length >= 2 && r.chance(0.4)
        const n = double ? 2 : 1
        lm.subsDone[i] += n
        // sai um titular (o craque do topo fica mais; quem já entrou não sai), entra o próximo do banco na vaga
        const ins: string[] = []
        const outs: string[] = []
        for (let k = 0; k < n; k++) {
          const j = slots.splice(r.int(0, slots.length - 1), 1)[0]
          outs.push(xi[j])
          ins.push(bench.shift()!)
          xi[j] = ins[k]
        }
        cameOn(lm, side, ins)
        // um evento por troca (os Lances listam as duas); na dupla, a 2ª frase continua a 1ª
        const v = { p: ins[0], p2: ins[1], a: outs[0], a2: outs[1], t: teamName(live, side) }
        const pair = double ? r.pick(T.subDouble) : null
        push(s, live, { minute: t, type: 'sub_on', side, player: ins[0], assist: outs[0], text: pair ? fill(pair[0], v) : say(r, T.subOn, v), at: at(side, 'bench', r) }, fx)
        if (pair) push(s, live, { minute: t, type: 'sub_on', side, player: ins[1], assist: outs[1], text: fill(pair[1], v), at: at(side, 'bench', r) }, fx)
      }
    }
  }
  // posse de bola oscila
  const drift = Math.round(r.normal(0, 0.6))
  const ph = clamp(live.team.possession[0] + drift, 28, 72)
  live.team.possession = [ph, 100 - ph]
}

/** Expulsão de um jogador de fundo: sai da escalação (sem reposição) e o time segue com um a menos. */
function sendOff(s: ImmersiveState, lm: LiveMem, live: LiveMatch, side: Side, p: string, text: string, t: number, r: Rng, fx: ImmersiveEffect[]) {
  const { xi } = lineup(lm, live, side)
  const j = xi.indexOf(p)
  if (j >= 0) xi.splice(j, 1)
  push(s, live, { minute: t, type: 'red', side, player: p, text, at: at(side, 'mid', r) }, fx)
}

function userOff(s: ImmersiveState, t: number, fx: ImmersiveEffect[], why: 'coach' | 'injury' | 'ask' | 'red') {
  const live = s.live!
  const lm = mem(s).live!
  if (!live.userOnPitch) return
  live.userOnPitch = false
  lm.offAt = t
  live.stats.minutes = Math.max(0, t - lm.startMinute)
  if (why === 'red') return
  const r = irng(s, 'live', lm.itemId, 'off', t)
  // entra um reserva de verdade (do banco) na vaga do jogador
  const { xi, bench } = lineup(lm, live, live.userSide)
  const on = bench.shift() ?? 'um reserva'
  if (on !== 'um reserva') {
    xi.push(on)
    cameOn(lm, live.userSide, [on])
  }
  // pediu para sair: "sentindo o cansaço" só com a energia baixa
  const text = say(r, why === 'ask' ? (lm.fitness < 50 ? T.userAskOff : T.userAskOffFresh) : T.userSubOff, { p: s.identity.surname, a: on })
  push(s, live, { minute: t, type: 'sub_off', side: live.userSide, byUser: true, player: s.identity.surname, assist: on, text, at: at(live.userSide, 'bench', r) }, fx)
}

export function requestSub(s: ImmersiveState, fx: ImmersiveEffect[]): boolean {
  const live = s.live
  if (!live || !live.userOnPitch || live.pendingMoment || live.phase === 'full_time' || live.phase === 'penalties' || live.phase === 'pre') return false
  userOff(s, live.minute, fx, 'ask')
  const lm = mem(s).live!
  lm.plan = lm.plan.slice(0, lm.momentIdx)
  return true
}

function aggregateTied(live: LiveMatch, lm: LiveMem): 'tied' | 'user' | 'opp' {
  const ui = idx(live.userSide)
  let u = live.score[ui]
  let o = live.score[1 - ui]
  if (lm.prior) {
    u += lm.prior[0]
    o += lm.prior[1]
  }
  return u === o ? 'tied' : u > o ? 'user' : 'opp'
}

function endOfPeriod(data: GameData, s: ImmersiveState, fx: ImmersiveEffect[]): Stop {
  const live = s.live!
  const lm = mem(s).live!
  const r = irng(s, 'live', lm.itemId, 'end', live.phase)
  const vars = { h: live.home.shortName, aw: live.away.shortName, s: `${live.score[0]}–${live.score[1]}` }
  if (live.phase === 'first_half') {
    live.phase = 'half_time'
    push(s, live, { minute: 45, addedTime: r.int(1, 4), type: 'half_time', side: 'home', text: say(r, T.halfTime, vars), at: { x: 50, y: 50 } }, fx)
    return 'half'
  }
  if (live.phase === 'second_half' && lm.decider && aggregateTied(live, lm) === 'tied' && !lm.seedAdvancesOnDraw) {
    if (lm.extraTime) {
      live.phase = 'extra_time'
      live.minute = 90
      push(s, live, { minute: 90, addedTime: r.int(2, 6), type: 'kickoff', side: 'home', text: say(r, T.extraTime), at: { x: 50, y: 50 } }, fx)
      // um lance extra na prorrogação para quem está em campo
      if (live.userOnPitch) {
        const pos = s.identity.position
        const mix = MIX[pos]
        const sits = Object.keys(mix) as KeyMomentSituation[]
        lm.plan.push({ minute: r.int(95, 117), situation: r.weighted(sits, (x) => mix[x] ?? 0) })
      }
      return 'continue'
    }
    return startShootout(s, fx)
  }
  if (live.phase === 'extra_time' && lm.decider && aggregateTied(live, lm) === 'tied' && !lm.seedAdvancesOnDraw) return startShootout(s, fx)
  finishRegulation(s, fx)
  return 'end'
}

function finishRegulation(s: ImmersiveState, fx: ImmersiveEffect[]) {
  const live = s.live!
  const lm = mem(s).live!
  const r = irng(s, 'live', lm.itemId, 'ft')
  live.phase = 'full_time'
  // minutos e nota final já no apito (a tela de fim de jogo mostra a mesma nota gravada na carreira)
  if (live.userOnPitch) live.stats.minutes = Math.max(1, Math.min(120, live.minute) - lm.startMinute)
  if (live.stats.minutes > 0) finalRating(s)
  const [h, a] = live.score
  const vars: Record<string, string> = { h: live.home.shortName, aw: live.away.shortName, s: `${h}–${a}` }
  let text: string
  if (live.pens) {
    vars.w = live.pens[0] > live.pens[1] ? live.home.shortName : live.away.shortName
    // "Fulano leva a melhor (4–3)": o placar da disputa com o do vencedor primeiro
    vars.pens = `${Math.max(live.pens[0], live.pens[1])}–${Math.min(live.pens[0], live.pens[1])}`
    text = say(r, T.fullTimePens, vars)
  } else if (h === a) text = say(r, T.fullTimeDraw, vars)
  else {
    vars.w = h > a ? live.home.shortName : live.away.shortName
    text = say(r, T.fullTimeWin, vars)
  }
  push(s, live, { minute: live.minute, addedTime: r.int(2, 6), type: 'full_time', side: 'home', text, at: { x: 50, y: 50 } }, fx)
}

// ───────────────────────── pênaltis ─────────────────────────

function startShootout(s: ImmersiveState, fx: ImmersiveEffect[]): Stop {
  const live = s.live!
  const lm = mem(s).live!
  const r = irng(s, 'live', lm.itemId, 'pens-setup')
  live.phase = 'penalties'
  live.pens = [0, 0]
  if (live.userOnPitch) live.stats.minutes = Math.max(0, live.minute - lm.startMinute)
  const outfield = !isGK(s.identity.position)
  lm.shootout = { h: 0, a: 0, k: 0 }
  if (live.userOnPitch && outfield) lm.shootout.userKick = r.pick([0, 2, 4])
  push(s, live, { minute: live.minute, type: 'full_time', side: 'home', text: 'Empate! A vaga será decidida nos pênaltis.', at: { x: 50, y: 50 } }, fx)
  return 'continue'
}

/** Cobra pênaltis até um lance do jogador ou o fim. Ordem: mandante, visitante, … */
function shootoutStep(data: GameData, s: ImmersiveState, fx: ImmersiveEffect[]): Stop {
  const live = s.live!
  const lm = mem(s).live!
  const so = lm.shootout!
  for (let guard = 0; guard < 60; guard++) {
    if (shootoutOver(so)) {
      live.pens = [so.h, so.a]
      finishRegulation(s, fx)
      return 'end'
    }
    const side: Side = so.k % 2 === 0 ? 'home' : 'away'
    const round = Math.floor(so.k / 2)
    const r = irng(s, 'live', lm.itemId, 'pen', so.k)
    const userKicks = side === live.userSide && so.userKick === round && !so.userDone && live.userOnPitch
    const userSaves = side !== live.userSide && isGK(s.identity.position) && live.userOnPitch && round < 5
    if (userKicks || userSaves) {
      openMoment(data, s, { minute: live.minute, situation: userKicks ? 'penalty' : 'penalty_save' }, fx, true)
      return 'moment'
    }
    const scored = r.chance(MATCH.penalty)
    const p = pickName(lm, live, side, r)
    recordKick(s, side, scored, p, fx, r)
  }
  live.pens = [so.h, so.a]
  finishRegulation(s, fx)
  return 'end'
}

function shootoutOver(so: NonNullable<LiveMem['shootout']>): boolean {
  const kh = Math.ceil(so.k / 2)
  const ka = Math.floor(so.k / 2)
  if (so.k < 10) {
    const leftH = 5 - kh
    const leftA = 5 - ka
    return so.h > so.a + leftA || so.a > so.h + leftH
  }
  return so.k % 2 === 0 && so.h !== so.a
}

/**
 * Narração de uma cobrança coerente com o canto: goleiro no canto certo = defesa; canto errado e
 * perdido = por cima ou na trave (nunca "o goleiro defende" com ele caído do outro lado).
 */
function penaltyTpl(scored: boolean, pen: { shot: PenSide; keeper: PenSide } | undefined, r: Rng): { tpl: readonly string[]; miss?: 'save' | 'over' | 'post' } {
  if (scored) return { tpl: T.penaltyGoal }
  if (!pen) return { tpl: T.penaltyMiss }
  const miss = pen.shot === pen.keeper ? 'save' : r.chance(0.5) ? 'over' : 'post'
  return { tpl: [T.penaltyMiss[miss === 'save' ? 0 : miss === 'over' ? 1 : 2]], miss }
}

function recordKick(s: ImmersiveState, side: Side, scored: boolean, player: string, fx: ImmersiveEffect[], r: Rng, tpl?: readonly string[]) {
  const live = s.live!
  const lm = mem(s).live!
  const so = lm.shootout!
  if (scored) {
    if (side === 'home') so.h++
    else so.a++
  }
  so.k++
  live.pens = [so.h, so.a]
  const g = lm.keeper[1 - idx(side)]
  live.events.push({
    minute: live.minute,
    type: scored ? 'penalty_goal' : 'penalty_miss',
    side,
    shootout: true,
    player,
    text: fixArticles(`${say(r, tpl ?? (scored ? T.penaltyGoal : T.penaltyMiss), { p: player, g })} (${so.h}–${so.a})`, live),
    at: at(side, 'goal', r),
  })
  fx.push({ type: 'match_event', event: live.events[live.events.length - 1] })
}

// ───────────────────────── lances-chave ─────────────────────────

function openMoment(data: GameData, s: ImmersiveState, pm: PlannedMoment, fx: ImmersiveEffect[], shootout = false) {
  const live = s.live!
  const lm = mem(s).live!
  const r = irng(s, 'live', lm.itemId, 'moment', lm.momentIdx, live.phase, shootout ? lm.shootout?.k ?? 0 : 0)
  const us = live.userSide
  const oppStr = us === 'home' ? live.away.strength : live.home.strength
  const tm = pickName(lm, live, us, r)
  const op = pickName(lm, live, us === 'home' ? 'away' : 'home', r)
  const defs = optionDefs(pm.situation, tm)
  const pen = pm.situation === 'penalty' || pm.situation === 'penalty_save'
  const specs: MomentOptionSpec[] = []
  const options: KeyMomentOption[] = []
  for (const d of defs) {
    let ch = optionChance(s, d, oppStr, live.importance + (shootout ? 0.3 : 0), lm.fitness, pen)
    if (pm.situation === 'penalty') ch = penaltyExpected(d.id, ch, keeperDive(s))
    ch = Math.round(ch * 100) / 100
    specs.push({ id: d.id, chance: ch, onSuccess: d.on, p2: d.p2, card: d.card, rating: d.rating, label: d.label })
    const o: KeyMomentOption = { id: d.id, label: d.label, chance: ch, icon: d.icon }
    if (d.risk) o.risk = d.risk
    // passe: chance de a jogada inteira virar gol (acertar o passe × o companheiro marcar), comparável
    // com a de uma finalização
    if (d.on === 'assist_chance') o.detail = `Passe · gol em ${Math.max(1, Math.round(ch * (d.p2 ?? 0.3) * 100))}%`
    else if (d.on === 'goal') o.detail = 'Finalização'
    else if (d.on === 'stop' || d.on === 'save') o.detail = `Se falhar: ${Math.round((d.p2 ?? 0.4) * 100)}% de gol deles`
    else if (d.on === 'follow_shot') o.detail = 'Abre espaço para finalizar'
    options.push(o)
  }
  const minigame: KeyMoment['minigame'] =
    pm.situation === 'penalty' ? 'penalty_kick' : pm.situation === 'penalty_save' ? 'penalty_save' : pm.situation === 'free_kick' || (pm.situation === 'shot' && r.chance(0.3)) ? 'timing' : undefined
  const desc = MOMENT_DESC[pm.situation] ?? ['Lance importante!']
  const score = live.score[idx(us)] === live.score[1 - idx(us)] ? 'Jogo empatado' : live.score[idx(us)] > live.score[1 - idx(us)] ? 'Vocês vencem' : 'Vocês perdem'
  const oppName = us === 'home' ? live.away.shortName : live.home.shortName
  const description = `${fixArticles(say(r, desc, { a: tm, d: op, g: lm.keeper[1 - idx(us)], o: oppName }), live)} ${shootout ? `Disputa por pênaltis: ${live.pens?.[0] ?? 0}–${live.pens?.[1] ?? 0}.` : `${score}, ${live.minute}'.`}`
  const id = `${lm.itemId}:k${lm.momentIdx}:${shootout ? `p${lm.shootout?.k ?? 0}` : live.minute}`
  const km: KeyMoment = {
    id,
    minute: live.minute,
    situation: pm.situation,
    description,
    options,
    timeLimitMs: pen ? 9000 : live.importance >= 0.8 ? 7000 : 8000,
    at: DEFENSIVE.has(pm.situation) ? at(opp(us), 'box', r) : at(us, 'box', r),
  }
  if (minigame) km.minigame = minigame
  // jogada recomendada (maior valor esperado em gols, sem sorteio): é a que vale se o tempo acabar
  const suggested = aiChoice({ id, situation: pm.situation, options: specs, teammate: tm, opponent: op }, 'smart')
  km.suggested = suggested
  lm.pending = { id, situation: pm.situation, options: specs, teammate: tm, opponent: op, minigame, suggested }
  live.pendingMoment = km
  fx.push({ type: 'key_moment', moment: km })
}

/**
 * PÊNALTI (lados sempre do ponto de vista da câmera atrás do batedor: 'left' = canto esquerdo da tela).
 * Goleiro: pula para cada canto 36% e fica no meio 28% — e se adapta às últimas cobranças do jogador
 * (lado repetido fica mais "estudado"). Canto certo do goleiro: defende 70% nos cantos, 88% no meio;
 * canto errado: 7% de erro (fora/trave). Assim os três lados valem ≈ o mesmo (~70%).
 * Jogador como goleiro: batedores miram 42% / 16% / 42%.
 */
const KEEPER_DIVE: [number, number, number] = [0.36, 0.28, 0.36] // esquerda, meio, direita
const KICKER_AIM: [number, number, number] = [0.42, 0.16, 0.42]
const PEN_SAVE_IF_GUESS: [number, number, number] = [0.7, 0.88, 0.7]
const PEN_SIDES = ['left', 'center', 'right'] as const
export type PenSide = (typeof PEN_SIDES)[number]
const SIDE_NAME: Record<PenSide, string> = { left: 'canto esquerdo', center: 'meio do gol', right: 'canto direito' }

/** Lado do minijogo de pênalti (aceita 'left'/'center'/'right' e sinônimos pt/en; índice 0–2). */
export function penSide(x: unknown): PenSide | null {
  if (typeof x === 'number') return x === 0 ? 'left' : x === 1 ? 'center' : x === 2 ? 'right' : null
  if (typeof x !== 'string') return null
  const v = x.trim().toLowerCase()
  if (/^(left|l|esquerda|esquerdo|esq|e)$/.test(v)) return 'left'
  if (/^(center|centre|middle|mid|meio|centro|c|m|stay)$/.test(v)) return 'center'
  if (/^(right|r|direita|direito|dir|d)$/.test(v)) return 'right'
  return null
}

/** Pesos do pulo do goleiro contra o jogador (adapta-se ao histórico recente de cobranças). */
function keeperDive(s: ImmersiveState): [number, number, number] {
  const hist = mem(s).penHist ?? []
  const w: [number, number, number] = [KEEPER_DIVE[0], KEEPER_DIVE[1], KEEPER_DIVE[2]]
  if (hist.length >= 2) {
    for (let i = 0; i < 3; i++) w[i] = Math.max(0.1, w[i] + 0.3 * (hist.filter((h) => h === i).length / hist.length - 1 / 3))
  }
  const t = w[0] + w[1] + w[2]
  return [w[0] / t, w[1] / t, w[2] / t]
}

function penaltyExpected(id: string, base: number, dive: [number, number, number] = KEEPER_DIVE): number {
  const side = id === 'pen_left' ? 0 : id === 'pen_center' ? 1 : 2
  const pGuess = dive[side]
  const quality = clamp(base / 0.77, 0.85, 1.15)
  return clamp((1 - pGuess) * 0.93 * quality + pGuess * (1 - PEN_SAVE_IF_GUESS[side]), 0.3, 0.95)
}

export type AiMode = 'safe' | 'smart'

/**
 * Escolha automática: "segura" (maior chance, evitando cartão: opções com risco de cartão ≥ 50% só
 * se não houver outra) ou "esperta" (maior valor esperado). As duas descontam o risco de cartão.
 */
export function aiChoice(spec: MomentSpec, mode: AiMode, r?: Rng): string {
  let best = spec.options[0]
  let bestV = -Infinity
  const pool = mode === 'safe' && spec.options.some((o) => (o.card ?? 0) < 0.5) ? spec.options.filter((o) => (o.card ?? 0) < 0.5) : spec.options
  for (const o of pool) {
    let v = o.chance - (o.card ?? 0) * 0.6
    if (mode === 'smart') {
      // valor esperado em gols (a favor; nos lances defensivos, gols evitados − custo do cartão)
      if (o.onSuccess === 'goal') v = o.chance * 1.0
      else if (o.onSuccess === 'assist_chance') v = o.chance * (o.p2 ?? 0.3) * 0.85
      else if (o.onSuccess === 'follow_shot') v = o.chance * FOLLOW_VALUE
      else if (o.onSuccess === 'foul_won') v = o.chance * FOUL_VALUE
      else if (o.onSuccess === 'chance') v = o.chance * 0.04
      else v = 1 - (1 - o.chance) * (o.p2 ?? 0.4) - (o.card ?? 0) * CARD_COST
      if (r) v = o.onSuccess === 'stop' || o.onSuccess === 'save' ? v - r.range(0, 0.02) : v * r.range(0.9, 1.1)
    }
    if (v > bestV) {
      bestV = v
      best = o
    }
  }
  return best.id
}

/**
 * Resolve o lance pendente. `optionId` null = tempo esgotado / IA (opção segura).
 * Pênalti (cobrar ou defender): o lado vem de `mini.side` ('left' | 'center' | 'right', sinônimos
 * aceitos); sem lado válido, do id da opção (pen_left/pen_center/pen_right, dive_left/stay/dive_right).
 * Demais lances: `optionId` precisa ser uma das opções (senão a ação é recusada). `mini.timing` 0–1
 * (ideal ≈ 0,62) só vale em lance com minijogo de timing.
 */
export function resolveMoment(
  data: GameData,
  s: ImmersiveState,
  optionId: string | null,
  mini: { side?: 'left' | 'center' | 'right'; timing?: number } | undefined,
  fx: ImmersiveEffect[],
  mode: AiMode = 'safe',
): boolean {
  const live = s.live
  const lm = mem(s).live
  if (!live || !lm || !live.pendingMoment || !lm.pending) return false
  if (!live.userOnPitch) return false
  const spec = lm.pending
  const isPen = spec.situation === 'penalty' || spec.situation === 'penalty_save'
  const validId = optionId !== null && spec.options.some((o) => o.id === optionId)
  // dados do minijogo: lado (pênalti) reconhecível; timing número em [0, 1]
  if (isPen && mini?.side !== undefined && mini.side !== null && !penSide(mini.side)) return false
  if (mini?.timing !== undefined && (typeof mini.timing !== 'number' || !Number.isFinite(mini.timing) || mini.timing < 0 || mini.timing > 1)) return false
  let optId: string
  if (isPen && mini?.side !== undefined && penSide(mini.side)) {
    const side = penSide(mini.side)!
    optId = spec.situation === 'penalty' ? `pen_${side}` : side === 'center' ? 'stay' : `dive_${side}`
  } else if (validId) optId = optionId!
  else if (optionId === null) optId = aiChoice(spec, mode, irng(s, 'live', lm.itemId, 'ai', spec.id))
  else return false
  const o = spec.options.find((x) => x.id === optId)
  if (!o) return false
  const r = irng(s, 'live', lm.itemId, 'resolve', spec.id)
  const u = r.next()
  const us = live.userSide
  const them = opp(us)
  const me = s.identity.surname
  const big = live.importance >= 0.8
  const inShootout = live.phase === 'penalties'
  let success: boolean
  let goal = false
  let text = ''
  let penInfo: { shot: PenSide; keeper: PenSide } | undefined
  const add = (type: MatchEventType, side: Side, extra: Partial<MatchEvent> = {}) => {
    const e: MatchEvent = { minute: live.minute, type, side, text: extra.text ?? text, at: extra.at ?? at(side, type === 'goal' ? 'goal' : 'box', r), ...extra }
    push(s, live, e, fx)
  }

  if (spec.situation === 'penalty') {
    const side = o.id === 'pen_left' ? 0 : o.id === 'pen_center' ? 1 : 2
    const w = keeperDive(s)
    const dive = r.weighted([0, 1, 2], (i) => w[i])
    const q = clamp(o.chance / penaltyExpected(o.id, 0.77, w), 0.8, 1.2)
    success = dive === side ? r.chance(1 - PEN_SAVE_IF_GUESS[side]) : r.chance(clamp(0.93 * q, 0.6, 0.99))
    penInfo = { shot: PEN_SIDES[side], keeper: PEN_SIDES[dive] }
    const m = mem(s)
    m.penHist = [...(m.penHist ?? []), side].slice(-8)
  } else if (spec.situation === 'penalty_save') {
    const side = o.id === 'dive_left' ? 0 : o.id === 'stay' ? 1 : 2
    const shot = r.weighted([0, 1, 2], (i) => KICKER_AIM[i])
    success = shot === side ? r.chance(clamp(0.55 + (attr(s.attributes, 'diving') - 70) * 0.01, 0.35, 0.8)) : r.chance(0.07)
    penInfo = { shot: PEN_SIDES[shot], keeper: PEN_SIDES[side] }
  } else {
    let ch = o.chance
    if (spec.minigame === 'timing' && mini?.timing !== undefined && o.onSuccess === 'goal') {
      // timing: perfeito (0,62) +15%; ~0,07 de erro ≈ neutro; muito fora, até −50%
      const t = clamp(mini.timing, 0, 1)
      ch = clamp(ch * clamp(1.15 - Math.abs(t - 0.62) * 2.2, 0.5, 1.15), 0.02, 0.97)
    }
    success = u < ch
  }
  // narração da cobrança escolhida junto com o texto do resultado (mesmo desfecho nos dois)
  const kick = isPen ? penaltyTpl(spec.situation === 'penalty' ? success : !success, penInfo, r) : undefined
  /** Texto do pênalti com os cantos (batedor e goleiro). */
  const penText = (): string => {
    if (!penInfo) return ''
    const { shot, keeper } = penInfo
    if (spec.situation === 'penalty') {
      if (success) return shot === keeper ? `Bateu no ${SIDE_NAME[shot]}; o goleiro foi junto, mas não alcançou. GOL!` : `Bateu no ${SIDE_NAME[shot]}, goleiro no ${SIDE_NAME[keeper]}. GOL!`
      return shot === keeper ? `O goleiro adivinhou o ${SIDE_NAME[shot]} e defendeu!` : kick?.miss === 'post' ? `Bateu no ${SIDE_NAME[shot]}… e acertou a trave!` : `Bateu no ${SIDE_NAME[shot]}… e mandou por cima!`
    }
    if (success) return keeper === shot ? `Você foi no ${SIDE_NAME[keeper]} e DEFENDEU!` : kick?.miss === 'post' ? 'Na trave! A cobrança não entrou.' : 'A cobrança saiu torta: por cima do gol!'
    return keeper === shot ? `Você adivinhou o ${SIDE_NAME[shot]}, mas a bola entrou.` : `Ele bateu no ${SIDE_NAME[shot]}; você foi no ${SIDE_NAME[keeper]}. Gol deles.`
  }
  const result = (extra: { success: boolean; text: string; goal?: boolean }) => {
    const e: Extract<ImmersiveEffect, { type: 'moment_result' }> = { type: 'moment_result', success: extra.success, text: extra.text, goal: extra.goal, optionId: o.id }
    if (penInfo) e.penalty = penInfo
    fx.push(e)
  }

  const rating = (d: number) => {
    live.stats.rating = r1(clamp(live.stats.rating + d, 3, 10))
  }

  if (inShootout) {
    const so = lm.shootout!
    if (spec.situation === 'penalty') {
      so.userDone = true
      live.stats.shots++
      if (success) live.stats.shotsOnTarget++
      recordKick(s, us, success, me, fx, r, kick?.tpl)
      text = penText()
      rating(success ? 0.3 : -0.5)
    } else {
      recordKick(s, them, !success, spec.opponent, fx, r, kick?.tpl)
      if (success) {
        live.stats.saves = (live.stats.saves ?? 0) + 1
        rating(0.5)
      }
      text = penText()
    }
    result({ success, text, goal: spec.situation === 'penalty' && success })
    finishMoment(s)
    return true
  }

  switch (o.onSuccess) {
    case 'goal': {
      live.stats.shots++
      // narração pela finalização escolhida (cabeceio só no lance de cabeça, falta com barreira…)
      const shot = SHOT_TEXT[SHOT_KIND[o.id] ?? 'placed']
      const sv = { p: me, P: me.toUpperCase(), g: lm.keeper[idx(them)] }
      if (success) {
        goal = true
        live.stats.shotsOnTarget++
        live.stats.goals++
        text = spec.situation === 'penalty' ? say(r, T.penaltyGoal, { p: me, g: lm.keeper[idx(them)] }) : say(r, [...shot.goal, ...T.goalUser], sv)
        add(spec.situation === 'penalty' ? 'penalty_goal' : 'goal', us, { byUser: true, player: me, text })
        rating(o.rating[0] + (big ? 0.2 : 0))
        text = spec.situation === 'penalty' ? penText() : r.pick(RESULT_TEXT.goal)
      } else {
        const roll = r.next()
        if (spec.situation === 'penalty') {
          text = say(r, kick?.tpl ?? T.penaltyMiss, { p: me, g: lm.keeper[idx(them)] })
          add('penalty_miss', us, { byUser: true, player: me, text })
        } else if (roll < 0.45) {
          live.stats.shotsOnTarget++
          text = say(r, shot.save, sv)
          add('save', us, { byUser: true, player: me, text })
        } else if (roll < 0.9) {
          text = say(r, shot.wide, sv)
          add('chance', us, { byUser: true, player: me, text })
        } else {
          text = say(r, shot.post, sv)
          add('woodwork', us, { byUser: true, player: me, text })
        }
        rating(o.rating[1])
        text = spec.situation === 'penalty' ? penText() : r.pick(roll < 0.45 ? RESULT_TEXT.missSaved : roll < 0.9 ? RESULT_TEXT.missWide : RESULT_TEXT.missPost)
      }
      break
    }
    case 'assist_chance': {
      if (success) {
        live.stats.keyPasses++
        const mate = spec.teammate
        // o companheiro finaliza como a jogada pede: de cabeça depois do cruzamento, com os pés no passe
        const fin = CROSS_OPTIONS.has(o.id) ? ASSIST_TEXT.cross : ASSIST_TEXT.ground
        if (r.chance(o.p2 ?? 0.3)) {
          goal = true
          live.stats.assists++
          text = say(r, fin.goal, { p: mate, a: me, t: teamName(live, us) })
          add('goal', us, { player: mate, assist: me, byUser: true, text })
          rating(0.7 + (big ? 0.1 : 0))
          text = r.pick(RESULT_TEXT.assist)
        } else {
          // um sorteio só: a narração e o tipo do lance (defesa × para fora) têm de bater
          const saved = r.chance(0.5)
          text = say(r, saved ? fin.save : fin.wide, { p: mate, g: lm.keeper[idx(them)], t: teamName(live, us) })
          add(saved ? 'save' : 'chance', us, { player: mate, assist: me, text })
          rating(o.rating[0])
          text = r.pick(saved ? RESULT_TEXT.chanceSaved : RESULT_TEXT.chanceWide)
        }
      } else {
        rating(o.rating[1])
        text = r.pick(RESULT_TEXT.passFail)
        add('key_moment', us, { byUser: true, player: me, text: `${me} tenta o passe, mas ${spec.opponent} intercepta.` })
      }
      break
    }
    case 'chance': {
      rating(success ? o.rating[0] : o.rating[1])
      text = success ? 'Posse mantida, o time avança.' : r.pick(RESULT_TEXT.passFail)
      add('key_moment', us, { byUser: true, player: me, text: success ? `${me} gira o jogo com qualidade.` : `${me} erra o passe e o ${teamName(live, them)} recupera.` })
      break
    }
    case 'follow_shot':
    case 'foul_won': {
      if (success) {
        if (o.onSuccess === 'follow_shot') live.stats.dribbles++
        rating(o.rating[0])
        let next: KeyMomentSituation
        if (o.onSuccess === 'foul_won') next = r.chance(0.22) ? 'penalty' : 'free_kick'
        else next = r.chance(0.25) ? 'one_on_one' : 'shot'
        lm.plan.splice(lm.momentIdx + 1, 0, { minute: Math.min(live.minute + 1, live.phase === 'first_half' ? 45 : live.phase === 'extra_time' ? 120 : 90), situation: next, chained: true })
        const oneTwo = o.id === 'one_two'
        text = o.onSuccess === 'foul_won' ? (next === 'penalty' ? 'Derrubado na área: PÊNALTI!' : 'Falta sofrida em boa posição!') : r.pick(oneTwo ? RESULT_TEXT.oneTwoOk : RESULT_TEXT.dribbleOk)
        add('key_moment', us, {
          byUser: true,
          player: me,
          text:
            o.onSuccess === 'foul_won'
              ? `${me} é derrubado por ${spec.opponent}. ${next === 'penalty' ? 'Pênalti!' : 'Falta perigosa.'}`
              : oneTwo
                ? `${me} tabela com ${spec.teammate} e recebe de volta na frente.`
                : `${me} passa por ${spec.opponent} e ganha espaço.`,
        })
      } else {
        rating(o.rating[1])
        // falha conforme a opção: tabela cortada, falta não marcada ou desarme
        const how = o.id === 'one_two' ? 'one_two' : o.onSuccess === 'foul_won' ? 'foul' : 'dribble'
        text = r.pick(how === 'one_two' ? RESULT_TEXT.oneTwoFail : how === 'foul' ? RESULT_TEXT.foulFail : RESULT_TEXT.dribbleFail)
        add('key_moment', us, {
          byUser: true,
          player: me,
          text:
            how === 'one_two'
              ? `${spec.opponent} corta o passe da tabela entre ${me} e ${spec.teammate}.`
              : how === 'foul'
                ? `${me} cai no contato com ${spec.opponent}, mas o árbitro manda seguir.`
                : `${spec.opponent} desarma ${me}.`,
        })
      }
      break
    }
    case 'stop':
    case 'save': {
      if (success) {
        if (o.onSuccess === 'save') {
          // pênalti contra que saiu para fora (você no canto errado): não é defesa sua
          const wide = spec.situation === 'penalty_save' && !!kick?.miss && kick.miss !== 'save'
          if (!wide) live.stats.saves = (live.stats.saves ?? 0) + 1
          text = spec.situation === 'penalty_save' ? penText() : r.pick(RESULT_TEXT.save)
          if (wide) add('penalty_miss', them, { player: spec.opponent, text: say(r, kick!.tpl, { p: spec.opponent, g: me }) })
          else add('save', them, { player: spec.opponent, text: say(r, T.saveUser, { p: spec.opponent, g: me }), byUser: true })
        } else {
          live.stats.tackles++
          text = r.pick(RESULT_TEXT.stop)
          add('key_moment', us, { byUser: true, player: me, text: `${me} desarma ${spec.opponent}. ${text}` })
        }
        rating(o.rating[0])
      } else {
        rating(o.rating[1])
        if (r.chance(o.p2 ?? 0.4)) {
          text = say(r, T.goalOpp, { p: spec.opponent, t: teamName(live, them) })
          add('goal', them, { player: spec.opponent, text })
          text = spec.situation === 'penalty_save' ? penText() : o.onSuccess === 'save' ? r.pick(RESULT_TEXT.concede) : 'Passou… e foi gol deles.'
        } else {
          text = say(r, T.chance, { p: spec.opponent, t: teamName(live, them) })
          add('chance', them, { player: spec.opponent, text })
          text = o.onSuccess === 'save' ? 'Não segurou, mas a bola foi para fora.' : r.pick(RESULT_TEXT.stopFail)
        }
      }
      // cartão
      if ((o.card ?? 0) > 0 && r.chance(o.card!)) cardUser(s, fx, r)
      break
    }
  }
  result({ success, text, goal })
  finishMoment(s)
  return true
}

function cardUser(s: ImmersiveState, fx: ImmersiveEffect[], r: Rng) {
  const live = s.live!
  const lm = mem(s).live!
  const me = s.identity.surname
  if (lm.cards.yellow >= 1) {
    lm.cards.red = true
    live.stats.red = true
    push(s, live, { minute: live.minute, type: 'red', side: live.userSide, byUser: true, player: me, text: `Segundo amarelo! ${me} é expulso.`, at: at(live.userSide, 'mid', r) }, fx)
    live.stats.rating = r1(clamp(live.stats.rating - 1, 3, 10))
    userOff(s, live.minute, fx, 'red')
    lm.plan = lm.plan.slice(0, lm.momentIdx + 1)
    return
  }
  lm.cards.yellow++
  live.stats.yellow = true
  live.stats.rating = r1(clamp(live.stats.rating - 0.3, 3, 10))
  push(s, live, { minute: live.minute, type: 'yellow', side: live.userSide, byUser: true, player: me, text: say(r, T.yellow, { p: me, t: teamName(live, live.userSide) }), at: at(live.userSide, 'mid', r) }, fx)
}

export function finishMoment(s: ImmersiveState) {
  const live = s.live!
  const lm = mem(s).live!
  live.pendingMoment = null
  lm.pending = undefined
  if (live.phase !== 'penalties') lm.momentIdx++
}

/** Joga até o fim (atalho "encerrar"/IA), resolvendo lances com a IA. */
export function runToEnd(data: GameData, s: ImmersiveState, fx: ImmersiveEffect[], mode: AiMode = 'smart') {
  for (let guard = 0; guard < 400 && s.live && s.live.phase !== 'full_time'; guard++) {
    if (s.live.pendingMoment) {
      if (!resolveMoment(data, s, null, undefined, fx, mode)) finishMoment(s)
    } else simulate(data, s, fx)
  }
}

/** Ajustes finais da nota (resultado e jogo sem sofrer gol) — uma vez só por partida. */
export function finalRating(s: ImmersiveState): void {
  const live = s.live!
  const lm = mem(s).live!
  if (live.stats.minutes <= 0 || lm.rated) return
  lm.rated = true
  const ui = idx(live.userSide)
  const u = live.score[ui]
  const o = live.score[1 - ui]
  let d = (u > o ? 0.25 : u < o ? -0.25 : 0) + (live.stats.minutes >= 60 ? 0.25 : 0)
  if (live.pens) d = live.pens[ui] > live.pens[1 - ui] ? 0.15 : -0.15
  const pos = s.identity.position
  if (lm.goalsAgainst === 0 && live.stats.minutes >= 60) d += pos === 'GOL' ? 0.45 : pos === 'ZAG' || pos === 'LD' || pos === 'LE' ? 0.35 : pos === 'VOL' ? 0.2 : 0
  live.stats.rating = r1(clamp(live.stats.rating + d, 3, 10))
}
