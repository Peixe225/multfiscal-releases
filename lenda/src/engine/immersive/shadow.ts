/**
 * Ponte com o motor do Clássico: monta um CareerState "sombra" a partir do estado imersivo para
 * reutilizar ofertas (transferOffers, loanClubs, academyClubs), catálogo de eventos, conquistas e
 * resumo de carreira — sem duplicar regras.
 */
import type { CareerState } from '../types'
import { emptyPeriod, type CareerMemory } from '../career/memory'
import type { ImmersiveState } from './types'
import { mem } from './mem'

export function shadowCareer(s: ImmersiveState, overrides: Partial<CareerState> = {}): CareerState {
  const m = mem(s)
  const cm: CareerMemory = {
    step: m.tick,
    devCycle: null,
    deferred: [],
    period: emptyPeriod(),
    loan: m.loan && s.clubId ? { parentClubId: m.loan.parentClubId, loanClubId: s.clubId, returnAge: s.age + 1 } : null,
    completedLoan: null,
    firstClubId: m.firstClubId,
    slotsDone: [],
    nationalRetired: m.nationalRetired,
    declineFactor: m.declineFactor,
    offerBoost: m.offerBoost,
    superAgent: m.superAgent,
    captainAt: m.captainAt,
    originalNationality: s.identity.nationality,
    salary: s.finance.salary,
    seasonsAtClub: m.seasonsAtClub,
    retrainedFrom: m.retrainedFrom,
    farFromSpotlight: m.farFromSpotlight,
    natConfeds: m.natConfeds,
  }
  return {
    version: 1,
    id: s.id,
    mode: 'immersive',
    pace: 'intensa',
    seed: s.seed,
    identity: s.identity,
    createdAt: s.createdAt,
    phase: s.retired ? 'finished' : 'deciding',
    age: s.age,
    season: s.season,
    ovr: s.ovr,
    devProfile: m.profile,
    marketValue: s.marketValue,
    clubId: s.clubId,
    parentClubId: s.parentClubId,
    contractUntil: s.finance.contractUntil,
    seasons: s.seasons,
    national: s.national,
    pendingDecision: null,
    period: s.seasons.length,
    events: { done: m.eventsDone, slots: [], lastEventAge: 0, injuries: m.injuries },
    modifiers: {},
    streaks: { lowRole: 0, substitute: 0 },
    world: s.world,
    log: s.log,
    retired: s.retired,
    retiredReason: s.retiredReason,
    achievements: s.achievements,
    engine: cm as unknown as Record<string, unknown>,
    ...overrides,
  }
}
