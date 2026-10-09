/**
 * Quem quer contratar o jogador: oferta de base, janela de transferências, empréstimos,
 * "Fim de ciclo" e os clubes usados pelos eventos (rival, volta para casa, Arábia/MLS…).
 */
import { Rng } from '../rng'
import type { CareerState, Club, Confed, DecisionOption, EffectChip, GameData, SquadRole } from '../types'
import { PACES } from './constants'
import { mem } from './memory'
import {
  contractYears,
  estimateSalary,
  isPlayingRole,
  marketValue,
  predictRole,
} from './player'
import {
  clubConfed,
  clubLeague,
  clubPrestige,
  clubStrength,
  formatMoney,
  indexData,
  roleShortLabel,
} from './util'

export function eligibleFor(club: Club, nationality: string): boolean {
  return !club.onlyNationality || club.onlyNationality === nationality
}

// ───────────────────────── oferta de base ─────────────────────────

/**
 * 3 clubes REAIS do país do jogador, numa mistura ponderada: um grande, um médio e um menor
 * (de preferência da Série B/segunda divisão). Fallback: confederação → UEFA → todos (Copero).
 */
export function academyClubs(data: GameData, state: CareerState, r: Rng): Club[] {
  const idx = indexData(data)
  const nat = state.identity.nationality
  const country = idx.country.get(nat)
  const ok = (c: Club) => eligibleFor(c, nat) && idx.league.has(c.leagueId)
  let pool = (idx.clubsByCountry.get(nat) ?? []).filter(ok)
  if (pool.length < 3 && country) pool = idx.simClubs.filter((c) => ok(c) && clubConfed(data, c) === country.confed)
  if (pool.length < 3) pool = idx.simClubs.filter((c) => ok(c) && clubConfed(data, c) === 'UEFA')
  if (pool.length < 3) pool = idx.simClubs.filter(ok)
  if (pool.length <= 3) return r.shuffle(pool)

  const sorted = pool.slice().sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id))
  const n = sorted.length
  const big = sorted.slice(0, Math.max(1, Math.round(n * 0.3)))
  const mid = sorted.slice(Math.round(n * 0.3), Math.max(Math.round(n * 0.3) + 1, Math.round(n * 0.7)))
  let small = sorted.slice(Math.round(n * 0.7))
  const lower = small.filter((c) => (idx.league.get(c.leagueId)?.tier ?? 1) >= 2)
  if (lower.length) small = lower
  const picks: Club[] = []
  const take = (list: Club[], w: (c: Club) => number) => {
    const avail = list.filter((c) => !picks.includes(c))
    if (avail.length) picks.push(r.weighted(avail, w))
  }
  take(big, (c) => 1 + c.prestige)
  take(mid.length ? mid : sorted, () => 1)
  take(small.length ? small : sorted, () => 1)
  while (picks.length < 3) take(sorted, () => 1)
  return r.shuffle(picks)
}

// ───────────────────────── janela de transferências ─────────────────────────

interface LocationWeights {
  countryClub: number
  countryPlayer: number
  confedClub: number
  confedPlayer: number
  random: number
}

/** Pesos de localização por OVR (Copero `jl`): <73 país; 73–77 confederação; 78–82 misto; 83+ mundo. */
export function locationWeights(ovr: number): LocationWeights {
  if (ovr >= 83) return { countryClub: 0, countryPlayer: 0, confedClub: 0, confedPlayer: 0, random: 100 }
  if (ovr >= 78) return { countryClub: 0, countryPlayer: 0, confedClub: 25, confedPlayer: 25, random: 50 }
  if (ovr >= 73) return { countryClub: 0, countryPlayer: 0, confedClub: 50, confedPlayer: 50, random: 0 }
  return { countryClub: 50, countryPlayer: 50, confedClub: 0, confedPlayer: 0, random: 0 }
}

interface Where {
  clubCountry: string
  clubConfed: Confed
  nat: string
  natConfed: Confed
}

function whereOf(data: GameData, state: CareerState): Where {
  const idx = indexData(data)
  const club = state.clubId ? idx.club.get(state.clubId) : undefined
  const nat = state.identity.nationality
  const natConfed = idx.country.get(nat)?.confed ?? 'UEFA'
  return {
    clubCountry: club?.country ?? nat,
    clubConfed: club ? clubConfed(data, club) : natConfed,
    nat,
    natConfed,
  }
}

/** Redistribui pares de pesos sem candidatos (Copero `qa`) e sorteia. */
function locationPick(data: GameData, r: Rng, cands: Club[], w0: LocationWeights, where: Where, prestigeBias: number): Club | null {
  if (!cands.length) return null
  const w = { ...w0 }
  const confOf = (c: Club) => clubConfed(data, c)
  const hasCC = cands.some((c) => c.country === where.clubCountry)
  const hasCP = cands.some((c) => c.country === where.nat)
  if (w.countryClub + w.countryPlayer > 0) {
    if (!hasCC && hasCP) (w.countryPlayer += w.countryClub), (w.countryClub = 0)
    else if (hasCC && !hasCP) (w.countryClub += w.countryPlayer), (w.countryPlayer = 0)
    else if (!hasCC && !hasCP) (w.countryClub = 0), (w.countryPlayer = 0)
  }
  const hasFC = cands.some((c) => confOf(c) === where.clubConfed)
  const hasFP = cands.some((c) => confOf(c) === where.natConfed)
  if (w.confedClub + w.confedPlayer > 0) {
    if (!hasFC && hasFP) (w.confedPlayer += w.confedClub), (w.confedClub = 0)
    else if (hasFC && !hasFP) (w.confedClub += w.confedPlayer), (w.confedPlayer = 0)
    else if (!hasFC && !hasFP) {
      if (w.random > 0) w.random += w.confedClub + w.confedPlayer
      w.confedClub = 0
      w.confedPlayer = 0
    }
  }
  const weight = (c: Club) => {
    let v = w.random
    if (c.country === where.clubCountry) v += w.countryClub
    if (c.country === where.nat) v += w.countryPlayer
    const cf = confOf(c)
    if (cf === where.clubConfed) v += w.confedClub
    if (cf === where.natConfed) v += w.confedPlayer
    return v * (1 + prestigeBias * c.prestige)
  }
  const total = cands.reduce((t, c) => t + weight(c), 0)
  if (total <= 0) return null
  return r.weighted(cands, weight)
}

export interface OfferOptions {
  count?: number
  /** Desloca a faixa de força (superempresário, testar o mercado). */
  bandShift?: number
  exclude?: string[]
}

/**
 * Até `count` clubes interessados: faixa de força ≈ OVR−2..OVR+3, com deriva de faixa
 * 10/80/10 (Copero `Aa`) e preferência de localização pelo OVR.
 */
export function transferOffers(data: GameData, state: CareerState, r: Rng, opts: OfferOptions = {}): Club[] {
  const idx = indexData(data)
  const world = state.world
  const nat = state.identity.nationality
  const count = opts.count ?? 2
  const ovr = state.ovr
  const exclude = new Set([...(opts.exclude ?? []), ...(state.clubId ? [state.clubId] : []), ...(state.parentClubId ? [state.parentClubId] : [])])
  const where = whereOf(data, state)
  const weights = locationWeights(ovr)
  const bias = ovr >= 83 ? 0.5 : ovr >= 78 ? 0.2 : 0.05
  const picks: Club[] = []
  for (let k = 0; k < count; k++) {
    const drift = r.weighted([-1, 0, 1], (d) => (d === 0 ? 80 : 10)) * 4
    const shift = (opts.bandShift ?? 0) + drift
    let chosen: Club | null = null
    for (let widen = 0; widen <= 5 && !chosen; widen++) {
      const lo = ovr - 2 + shift - widen * 2
      const hi = ovr + 3 + shift + widen * 2
      const cands = idx.simClubs.filter((c) => {
        if (exclude.has(c.id) || picks.includes(c) || !eligibleFor(c, nat)) return false
        const st = clubStrength(world, c)
        return st >= lo && st <= hi
      })
      chosen = locationPick(data, r, cands, weights, where, bias)
    }
    if (chosen) picks.push(chosen)
  }
  return picks
}

// ───────────────────────── empréstimos ─────────────────────────

/** Clubes onde ele seria titular/rotação: mesmo país (peso 90) ou mesma confederação (10). */
export function loanClubs(data: GameData, state: CareerState, r: Rng, count: number, exclude: string[] = []): Club[] | null {
  const idx = indexData(data)
  const world = state.world
  const nat = state.identity.nationality
  const contract = state.parentClubId ?? state.clubId
  const contractClub = contract ? idx.club.get(contract) : undefined
  if (!contractClub) return null
  const conf = clubConfed(data, contractClub)
  const ex = new Set([contract, ...exclude])
  const fit = (c: Club) => {
    if (ex.has(c.id) || !eligibleFor(c, nat)) return false
    const st = clubStrength(world, c)
    // onde ele joga de verdade: titular ou rotação alta, sem ir a um clube muito mais forte
    return isPlayingRole(predictRole(state.ovr, st, state.identity.position)) && st >= state.ovr - 10 && st <= state.ovr + 4
  }
  const home = idx.simClubs.filter((c) => c.country === contractClub.country && fit(c))
  const abroad = idx.simClubs.filter((c) => c.country !== contractClub.country && clubConfed(data, c) === conf && fit(c))
  const picks: Club[] = []
  for (let guard = 0; picks.length < count && guard < 40; guard++) {
    const pools = [
      { list: home.filter((c) => !picks.includes(c)), w: 90 },
      { list: abroad.filter((c) => !picks.includes(c)), w: 10 },
    ].filter((p) => p.list.length)
    if (!pools.length) break
    const pool = r.weighted(pools, (p) => p.w)
    // preferem clubes mais fortes em que ele ainda joga (mais vitrine)
    picks.push(r.weighted(pool.list, (c) => 1 + Math.max(0, clubStrength(world, c) - (state.ovr - 10)) / 4))
  }
  return picks.length === count ? picks : null
}

// ───────────────────────── fim de ciclo ─────────────────────────

/** Ofertas de clubes mais modestos, de qualquer lugar (leve preferência por casa). */
export function nonRenewalClubs(data: GameData, state: CareerState, r: Rng, count: number): Club[] {
  const idx = indexData(data)
  const world = state.world
  const nat = state.identity.nationality
  const where = whereOf(data, state)
  const ovr = state.ovr
  const picks: Club[] = []
  const ex = new Set([state.clubId, state.parentClubId].filter(Boolean) as string[])
  for (let k = 0; k < count; k++) {
    const down = r.chance(0.5)
    let chosen: Club | null = null
    for (let widen = 0; widen <= 4 && !chosen; widen++) {
      const hi = (down ? ovr - 3 : ovr + 1) + (widen > 0 ? 2 : 0)
      const lo = (down ? ovr - 9 : ovr - 5) - widen * 4
      const cands = idx.simClubs.filter((c) => {
        if (ex.has(c.id) || picks.includes(c) || !eligibleFor(c, nat)) return false
        const st = clubStrength(world, c)
        return st >= lo && st <= Math.min(hi, ovr + 1)
      })
      if (cands.length)
        chosen = r.weighted(cands, (c) => (c.country === where.clubCountry || c.country === nat ? 3 : clubConfed(data, c) === where.natConfed ? 2 : 1))
    }
    if (chosen) picks.push(chosen)
  }
  return picks
}

// ───────────────────────── clubes para eventos ─────────────────────────

/** Rival do mesmo país, tão forte e tão grande quanto o clube atual. */
export function rivalClubs(data: GameData, state: CareerState): Club[] {
  const idx = indexData(data)
  const club = state.clubId ? idx.club.get(state.clubId) : undefined
  if (!club) return []
  const st = clubStrength(state.world, club)
  const pr = clubPrestige(state.world, club)
  return (idx.clubsByCountry.get(club.country) ?? []).filter(
    (c) =>
      c.id !== club.id &&
      eligibleFor(c, state.identity.nationality) &&
      clubStrength(state.world, c) >= st &&
      clubPrestige(state.world, c) >= pr,
  )
}

/** Clube do país natal com força perto do OVR (volta para casa). */
export function homeClub(data: GameData, state: CareerState, r: Rng): Club | null {
  const idx = indexData(data)
  const nat = state.identity.nationality
  const list = (idx.clubsByCountry.get(nat) ?? []).filter((c) => c.id !== state.clubId && eligibleFor(c, nat))
  if (!list.length) return null
  const target = state.ovr + 1
  const best = list.slice().sort((a, b) => Math.abs(clubStrength(state.world, a) - target) - Math.abs(clubStrength(state.world, b) - target))
  return r.pick(best.slice(0, Math.min(3, best.length)))
}

/** Clube de outro país (problemas fiscais). */
export function foreignClub(data: GameData, state: CareerState, r: Rng): Club | null {
  const idx = indexData(data)
  const club = state.clubId ? idx.club.get(state.clubId) : undefined
  const offers = transferOffers(data, state, r, { count: 3 }).filter((c) => !club || c.country !== club.country)
  if (offers.length) return offers[0]
  const list = idx.simClubs.filter(
    (c) => (!club || c.country !== club.country) && eligibleFor(c, state.identity.nationality) && Math.abs(clubStrength(state.world, c) - state.ovr) <= 8,
  )
  return list.length ? r.pick(list) : null
}

const MONEY_COUNTRIES = ['KSA', 'QAT', 'UAE', 'USA']

/** Clube "milionário" (Arábia Saudita, Catar, Emirados ou MLS) que o aceitaria como estrela. */
export function moneyClub(data: GameData, state: CareerState, r: Rng): Club | null {
  const idx = indexData(data)
  const club = state.clubId ? idx.club.get(state.clubId) : undefined
  if (club && MONEY_COUNTRIES.includes(club.country)) return null
  const list = idx.simClubs.filter((c) => MONEY_COUNTRIES.includes(c.country) && eligibleFor(c, state.identity.nationality))
  if (!list.length) return null
  const top = list.slice().sort((a, b) => b.prestige - a.prestige || clubStrength(state.world, b) - clubStrength(state.world, a))
  return r.pick(top.slice(0, Math.min(4, top.length)))
}

// ───────────────────────── cards de clube ─────────────────────────

export function clubRole(data: GameData, state: CareerState, club: Club): SquadRole {
  return predictRole(state.ovr, clubStrength(state.world, club), state.identity.position)
}

/** Pílula + detalhes (papel previsto, salário/ano, contrato) de um card de clube. */
export function clubCard(
  data: GameData,
  state: CareerState,
  club: Club,
  id: string,
  label: string,
  opts: { salaryMult?: number; years?: number; loan?: boolean } = {},
): DecisionOption {
  const league = clubLeague(data, state.world, club)
  const role = clubRole(data, state, club)
  const short = roleShortLabel(role)
  // "Papel previsto: Rotação" (antes "Rotação previsto", sem concordância)
  const chip: EffectChip = {
    kind: role === 'starter' ? 'positive' : short === 'Reserva' ? 'negative' : 'neutral',
    label: `Papel previsto: ${short}`,
  }
  const coef = league?.coefficient ?? 0.5
  const value = marketValue(new Rng(1), state.ovr, state.age, coef)
  const salary = estimateSalary(value, clubPrestige(state.world, club), coef, opts.salaryMult ?? 1)
  const years = opts.years ?? contractYears(state.age)
  // o empréstimo dura um trecho da carreira (1, 2 ou 3 temporadas, conforme o ritmo)
  const loanSeasons = PACES[state.pace]?.seasons ?? 1
  const details = [
    { label: 'Papel previsto', value: short },
    opts.loan
      ? { label: 'Duração', value: `${loanSeasons} ${loanSeasons === 1 ? 'temporada' : 'temporadas'}` }
      : { label: 'Contrato', value: `${years} ${years === 1 ? 'ano' : 'anos'}` },
    { label: 'Salário/ano', value: formatMoney(salary) },
  ]
  if (league) details.push({ label: 'Liga', value: league.shortName })
  return { id, label, title: club.shortName || club.name, clubId: club.id, effects: [chip], details }
}

/** Salário anual acertado ao assinar (guardado na memória). */
export function signingSalary(data: GameData, state: CareerState, club: Club, mult = 1): number {
  const league = clubLeague(data, state.world, club)
  const coef = league?.coefficient ?? 0.5
  const value = marketValue(new Rng(1), state.ovr, state.age, coef)
  return estimateSalary(value, clubPrestige(state.world, club), coef, mult * (mem(state).superAgent ? 1.2 : 1))
}
