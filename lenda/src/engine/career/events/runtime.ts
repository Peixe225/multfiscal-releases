/**
 * Agenda e disparo dos eventos pessoais (Copero `mi`/`hi`/`bi`/`fi`/`Hl`).
 */
import { rng, type Rng } from '../../rng'
import type { CareerState, Club, Decision, GameData, Pace } from '../../types'
import { EVENT_FIRST_AGE, EVENT_LAST_AGE, INJURY_CHANCE, MAX_INJURIES, PACES } from '../constants'
import { mem } from '../memory'
import { transferOffers } from '../offers'
import { predictRole } from '../player'
import {
  clubLeague,
  clubLeagueId,
  clubPrestige,
  clubStrength,
  confedCompetition,
  indexData,
  nationStrength,
  tournamentInSeason,
} from '../util'
import { buildInjury, EVENT_BY_KEY, EVENTS } from './catalog'
import type { BuiltEvent, EventEnv, OptionSpec, TrophyTarget } from './types'

// ───────────────────────── agenda ─────────────────────────

/** Idades de slot: 22..37 no passo do ritmo (Intensa 1, Normal 2, Expressa 3). */
export function slotAges(pace: Pace): number[] {
  const step = PACES[pace].seasons
  const out: number[] = []
  for (let a = EVENT_FIRST_AGE; a <= EVENT_LAST_AGE; a += step) out.push(a)
  return out
}

/** Todas as combinações de k slots sem dois vizinhos (Copero `gi`). */
function combos(n: number, k: number, start = 0): number[][] {
  if (k === 0) return [[]]
  const out: number[][] = []
  for (let i = start; i < n; i++) for (const rest of combos(n, k - 1, i + 2)) out.push([i, ...rest])
  return out
}

/** Sorteia quantos eventos e em quais idades (distância mínima de 2/4/6 anos por ritmo). */
export function planEventSlots(pace: Pace, r: Rng): number[] {
  const ages = slotAges(pace)
  const [lo, hi] = PACES[pace].events
  let k = r.int(lo, hi)
  let all = combos(ages.length, k)
  while (!all.length && k > 0) all = combos(ages.length, --k)
  return r.pick(all).map((i) => ages[i])
}

/** Primeiro slot vencido e ainda não usado (slots perdidos continuam pendentes). */
export function dueSlot(state: CareerState): number | null {
  const m = mem(state)
  if (m.slotsDone.length >= state.events.slots.length) return null
  if (state.age > EVENT_LAST_AGE) return null
  const slot = state.events.slots.find((a) => a <= state.age && !m.slotsDone.includes(a))
  if (slot === undefined) return null
  const cooldown = PACES[state.pace].seasons * 2
  if (m.slotsDone.length > 0 && state.age - state.events.lastEventAge < cooldown) return null
  return slot
}

// ───────────────────────── ambiente de elegibilidade ─────────────────────────

export function buildEnv(data: GameData, state: CareerState): EventEnv {
  const idx = indexData(data)
  const m = mem(state)
  const world = state.world
  const club = state.clubId ? idx.club.get(state.clubId) ?? null : null
  const league = club ? clubLeague(data, world, club) ?? null : null
  const strength = club ? clubStrength(world, club) : 60
  const position = state.identity.position
  const nat = idx.country.get(state.identity.nationality) ?? null
  const paceSeasons = PACES[state.pace].seasons
  const periodSeasons = Array.from({ length: paceSeasons }, (_, i) => state.season + i).filter((s) => s - state.season + state.age < 40)
  let offers: Club[] | null = null
  const env: EventEnv = {
    data,
    state,
    m,
    age: state.age,
    ovr: state.ovr,
    position,
    isGK: position === 'GOL',
    club,
    clubStrength: strength,
    clubPrestige: club ? clubPrestige(world, club) : 0,
    league,
    tier: league?.tier ?? 1,
    role: predictRole(state.ovr, strength, position),
    nat,
    abroad: !!club && club.country !== state.identity.nationality,
    periodSeasons,
    paceSeasons,
    calledUpBefore: state.national.apps > 0 || state.national.firstCallUp !== undefined || state.national.trophies.length > 0,
    callUpOvr: nat?.callUpOvr ?? 75,
    offers() {
      if (!offers) offers = transferOffers(data, state, rng(state.seed, 'offers-dry', m.step), { count: 2 })
      return offers
    },
    clubTrophyTarget: () => clubTrophyTarget(env),
    penaltyTarget: () => penaltyTarget(env),
    nationalTournament: () => nationalTournament(env, false),
    worldCupAhead: () => nationalTournament(env, true) !== null,
  }
  return env
}

function rankIn(world: CareerState['world'], club: Club, clubs: Club[]): number {
  const mine = clubStrength(world, club)
  return clubs.filter((c) => c.id !== club.id && clubStrength(world, c) > mine).length
}

/** "Look-ahead" do Copero: o clube briga de verdade por um título no próximo período? */
function clubTrophyTarget(env: EventEnv): TrophyTarget | null {
  const { data, state, club, league } = env
  if (!club || !league) return null
  const idx = indexData(data)
  const world = state.world
  const leagueClubs = idx.simClubs.filter((c) => clubLeagueId(world, c) === league.id)
  const rank = rankIn(world, club, leagueClubs)
  if (league.tier === 1 && rank <= 1)
    return { kind: 'league', competitionId: league.id, trophyId: league.trophyId, name: league.shortName, scope: 'club' }
  const prim = confedCompetition(data, league.confed, 'primary')
  const q = prim ? world.qualified[prim.id] ?? [] : []
  if (prim && q.includes(club.id)) {
    const qc = q.map((id) => idx.club.get(id)).filter(Boolean) as Club[]
    if (rankIn(world, club, qc) <= 3) return { kind: 'continental_primary', competitionId: prim.id, trophyId: prim.trophyId, name: prim.name, scope: 'club' }
  }
  const cup = league.domesticCupId ? idx.competition.get(league.domesticCupId) : undefined
  if (cup && rank <= 2) return { kind: 'domestic_cup', competitionId: cup.id, trophyId: cup.trophyId, name: cup.name, scope: 'club' }
  return null
}

/** Final continental / Mundial de Clubes / torneio de seleção em que ele pode bater o pênalti. */
function penaltyTarget(env: EventEnv): TrophyTarget | null {
  const { data, state, club, league } = env
  const idx = indexData(data)
  const world = state.world
  if (club && league && league.tier === 1) {
    for (const which of ['primary', 'secondary'] as const) {
      const comp = confedCompetition(data, league.confed, which)
      const q = comp ? world.qualified[comp.id] ?? [] : []
      if (comp && q.includes(club.id)) {
        const qc = q.map((id) => idx.club.get(id)).filter(Boolean) as Club[]
        if (rankIn(world, club, qc) <= (which === 'primary' ? 4 : 6))
          return { kind: comp.kind, competitionId: comp.id, trophyId: comp.trophyId, name: comp.name, scope: 'club' }
      }
    }
    const cwc = data.competitions.find((c) => c.kind === 'club_world_cup')
    if (cwc && (world.qualified[cwc.id] ?? []).includes(club.id) && env.periodSeasons.some((s) => tournamentInSeason(cwc, s)))
      return { kind: 'club_world_cup', competitionId: cwc.id, trophyId: cwc.trophyId, name: cwc.name, scope: 'club' }
  }
  const t = nationalTournament(env, false)
  if (t && env.ovr >= env.callUpOvr && env.nat) {
    const peers = (idx.countriesByConfed.get(env.nat.confed) ?? []).map((c) => nationStrength(data, world, c.code))
    const mine = nationStrength(data, world, env.nat.code)
    const better = peers.filter((v) => v > mine).length
    if (better <= (t.kind === 'world_cup' ? 1 : 3)) return t
  }
  return null
}

function nationalTournament(env: EventEnv, worldCupOnly: boolean): TrophyTarget | null {
  const { data, nat } = env
  if (!nat) return null
  for (const s of env.periodSeasons) {
    for (const c of data.competitions) {
      if (c.kind !== 'world_cup' && (worldCupOnly || c.kind !== 'national_continental' || c.confed !== nat.confed)) continue
      if (!c.schedule || !tournamentInSeason(c, s)) continue
      return { kind: c.kind, competitionId: c.id, trophyId: c.trophyId, name: c.name, scope: 'national' }
    }
  }
  return null
}

// ───────────────────────── disparo ─────────────────────────

export function assembleDecision(
  state: CareerState,
  kind: Decision['kind'],
  built: BuiltEvent,
  extra: { eventKey?: string; variant?: string; context?: Record<string, unknown> } = {},
): Decision {
  const m = mem(state)
  const specs: Record<string, OptionSpec> = {}
  for (const o of built.options) specs[o.option.id] = o.spec
  return {
    id: `${state.seed}-${m.step + 1}-${extra.eventKey ?? kind}`,
    kind,
    eventKey: extra.eventKey,
    variant: extra.variant,
    title: built.title,
    description: built.description,
    options: built.options.map((o) => o.option),
    context: { ...(built.context ?? {}), ...(extra.context ?? {}), specs },
  }
}

/** Evento pessoal da vez, se houver slot vencido (inclui o pré-sorteio de lesão de 2%). */
export function tryEventDecision(data: GameData, state: CareerState, allowed?: string[]): Decision | null {
  const slot = dueSlot(state)
  if (slot === null) return null
  const m = mem(state)
  if (state.events.injuries < MAX_INJURIES && rng(state.seed, 'injury', m.step).chance(INJURY_CHANCE)) {
    const inj = buildInjury(rng(state.seed, 'injury-type', m.step))
    return assembleDecision(state, 'injury', inj, { eventKey: 'injury', variant: inj.injuryId, context: { slot } })
  }
  const env = buildEnv(data, state)
  let pool = EVENTS.filter((e) => !state.events.done.includes(e.key) && (!allowed || allowed.includes(e.key)))
  pool = pool.filter((e) => e.eligible(env))
  const pickR = rng(state.seed, 'event', m.step)
  while (pool.length) {
    const def = pickR.weighted(pool, (e) => e.weight)
    const variant = def.variants ? rng(state.seed, 'variant', m.step, def.key).weighted(def.variants, (v) => v.weight).key : undefined
    const built = def.build(env, variant, rng(state.seed, 'event-build', m.step, def.key))
    if (built && built.options.length) return assembleDecision(state, 'event', built, { eventKey: def.key, variant, context: { slot } })
    pool = pool.filter((e) => e !== def)
  }
  return null
}

/** Monta um evento específico (testes e ferramentas de depuração). */
export function forceEventDecision(data: GameData, state: CareerState, key: string, variant?: string): Decision | null {
  const m = mem(state)
  if (key === 'injury') {
    const inj = buildInjury(rng(state.seed, 'injury-type', m.step, variant ?? ''))
    return assembleDecision(state, 'injury', inj, { eventKey: 'injury', variant: inj.injuryId, context: { slot: state.age } })
  }
  const def = EVENT_BY_KEY[key]
  if (!def) return null
  const env = buildEnv(data, state)
  const v = variant ?? def.variants?.[0]?.key
  const built = def.build(env, v, rng(state.seed, 'event-build', m.step, def.key))
  if (!built) return null
  return assembleDecision(state, 'event', built, { eventKey: key, variant: v, context: { slot: state.age } })
}

export function isEventEligible(data: GameData, state: CareerState, key: string): boolean {
  const def = EVENT_BY_KEY[key]
  return !!def && def.eligible(buildEnv(data, state))
}
