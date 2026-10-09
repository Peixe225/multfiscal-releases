/**
 * Rivais: craques reais (GameData.stars) que envelhecem, trocam de clube e se aposentam, mais
 * NOVAS GERAÇÕES fictícias a cada temporada para manter a elite (85–93) povoada por décadas.
 *
 * Curva de OVR por idade (Δ/ano): ≤21 → 28% do que falta ao potencial (+0,4); 22–24 → 35%;
 *   25–27 → 40%; 28–30 → −0,2; 31–32 → −1,2; 33–34 → −2; 35+ → −3 (com ruído).
 * Aposentadoria: 33: 6% · 34: 15% · 35: 28% · 36: 42% · 37: 58% · 38: 72% · 39: 85% · 40: 100%
 *   (×0,7 para OVR ≥ 85). Regens que não vingam (24+ anos e OVR < 72) saem da lista.
 * Estatísticas: os gols do clube (todas as competições) são divididos entre os craques do elenco e
 *   o "resto do elenco" por peso de posição × e^(0,12·(OVR−78)) × participação.
 */
import type { ClubDynamic, GameData, Position, Rival } from '../types'
import { clamp, rng as subRng, type Rng } from '../rng'
import type { DataIndex } from './context'
import { randomName } from './names'

export const GOAL_W: Record<Position, number> = {
  CA: 1.5, PE: 0.62, PD: 0.62, MEI: 0.48, ME: 0.3, MD: 0.3, MC: 0.24, VOL: 0.1, LE: 0.08, LD: 0.08, ZAG: 0.07, GOL: 0,
}
export const ASSIST_W: Record<Position, number> = {
  CA: 0.5, PE: 0.85, PD: 0.85, MEI: 1.0, ME: 0.7, MD: 0.7, MC: 0.6, VOL: 0.3, LE: 0.5, LD: 0.5, ZAG: 0.12, GOL: 0.02,
}
/** Teto de jogos de um craque na temporada (sem estaduais e seleção). */
const MAX_APPS = 60
/** Teto de gols esperados por jogo. */
const GOAL_CAP: Partial<Record<Position, number>> = { CA: 0.9, PE: 0.65, PD: 0.65, MEI: 0.5, ME: 0.35, MD: 0.35, MC: 0.3 }

/** Soma dos pesos de um time-base (1 CA, 2 pontas, 1 meia, 2 volantes/meias, 2 laterais, 2 zagueiros) × banco. */
const GENERIC_GOAL = (1.5 + 0.62 * 2 + 0.48 + 0.24 * 2 + 0.1 + 0.08 * 2 + 0.07 * 2) * 1.25
const GENERIC_ASSIST = (0.5 + 0.85 * 2 + 1.0 + 0.6 * 2 + 0.3 + 0.5 * 2 + 0.12 * 2) * 1.25

export const quality = (ovr: number) => Math.exp((ovr - 78) * 0.12)

/** Arredondamento probabilístico (evita que ganhos de 0,4/ano sumam no arredondamento). */
function roundProb(x: number, rng: Rng): number {
  const f = Math.floor(x)
  return f + (rng.next() < x - f ? 1 : 0)
}

export function ageIn(r: { birthYear: number }, season: number): number {
  return season - r.birthYear
}

function defaultPotential(ovr: number, age: number): number {
  return Math.round(Math.max(ovr, ovr + clamp((24 - age) * 1.3, 0, 10)))
}

/** Clube para um jogador sem clube conhecido: liga do país (ponderado por força) ou uma liga grande. */
function pickClub(data: GameData, ix: DataIndex, clubs: Record<string, ClubDynamic>, nationality: string, ovr: number, rng: Rng): string {
  const byCountry = data.clubs.filter((c) => c.country === nationality && clubs[c.id] && ix.league.get(clubs[c.id].leagueId)?.tier === 1)
  const pool = byCountry.length
    ? byCountry
    : data.clubs.filter((c) => clubs[c.id] && (ix.league.get(clubs[c.id].leagueId)?.coefficient ?? 0) >= 0.85)
  const ok = pool.filter((c) => !c.onlyNationality || c.onlyNationality === nationality)
  const list = ok.length ? ok : data.clubs.filter((c) => clubs[c.id])
  return rng.weighted(list, (c) => {
    const s = clubs[c.id].strength
    return Math.exp(-Math.abs(s - (ovr - 3)) / 4)
  }).id
}

export function createRivals(data: GameData, ix: DataIndex, clubs: Record<string, ClubDynamic>, seed: string): Rival[] {
  const rng = subRng(seed, 'rivals', 'init')
  return data.stars.map((p) => {
    const age = ix.firstSeason - p.birthYear
    const clubId = p.clubId && clubs[p.clubId] ? p.clubId : pickClub(data, ix, clubs, p.nationality, p.ovr, rng)
    return {
      id: p.id,
      name: p.name,
      shortName: p.shortName,
      nationality: p.nationality,
      position: p.position,
      birthYear: p.birthYear,
      ovr: p.ovr,
      potential: Math.max(p.ovr, p.potential ?? defaultPotential(p.ovr, age)),
      clubId,
      generated: false,
    }
  })
}

function develop(r: Rival, age: number, rng: Rng): number {
  const gap = r.potential - r.ovr
  let d: number
  if (age <= 21) d = gap * 0.28 + rng.normal(0.4, 1.2)
  else if (age <= 24) d = gap * 0.35 + rng.normal(0.2, 1.0)
  else if (age <= 27) d = gap * 0.4 + rng.normal(0, 0.8)
  else if (age <= 30) d = rng.normal(-0.2, 0.9)
  else if (age <= 32) d = rng.normal(-1.2, 1.0)
  else if (age <= 34) d = rng.normal(-2.0, 1.2)
  else d = rng.normal(-3.0, 1.4)
  let ovr = roundProb(r.ovr + d, rng)
  if (age <= 27) ovr = Math.min(ovr, r.potential + 1)
  return clamp(ovr, 45, 95)
}

const RETIRE: Record<number, number> = { 33: 0.06, 34: 0.15, 35: 0.28, 36: 0.42, 37: 0.58, 38: 0.72, 39: 0.85 }

function retires(r: Rival, age: number, rng: Rng): boolean {
  if (age >= 40) return true
  let p = RETIRE[age] ?? 0
  if (age <= 32 && r.ovr < 66) p = 0.08
  if (r.ovr >= 85) p *= 0.7
  return rng.chance(p)
}

const POSITIONS: [Position, number][] = [
  ['CA', 17], ['PE', 9], ['PD', 9], ['MEI', 10], ['MC', 13], ['VOL', 8], ['ME', 2], ['MD', 2], ['ZAG', 14], ['LD', 4], ['LE', 4], ['GOL', 6],
]

export interface RivalEnv {
  data: GameData
  ix: DataIndex
  seed: string
  season: number
  clubs: Record<string, ClubDynamic>
  /** Tamanho-alvo da população (≈ nº inicial de craques). */
  targetPop: number
  /** Nº-alvo de jogadores com OVR ≥ 85. */
  targetElite: number
  /** Distribuição inicial de nacionalidades (peso de "fábrica de talentos"). */
  natWeight: Map<string, number>
}

/** Entressafra: envelhece, aposenta, transfere e cria a nova geração. Não muta a entrada. */
export function offseasonRivals(env: RivalEnv, rivals: readonly Rival[]): Rival[] {
  const rng = subRng(env.seed, 'season', env.season, 'rivals')
  const { data, ix, clubs } = env
  let retired = 0
  const next: Rival[] = []
  for (const r0 of rivals) {
    if (r0.retired) continue
    const age = ageIn(r0, env.season)
    const r: Rival = { ...r0 }
    delete r.lastSeason
    r.ovr = develop(r0, age, rng)
    if (retires(r, age, rng)) {
      retired++
      continue
    }
    if (r.generated && age >= 24 && r.ovr < 72) continue
    if (!clubs[r.clubId]) r.clubId = pickClub(data, ix, clubs, r.nationality, r.ovr, rng)
    next.push(r)
  }
  transfers(env, next, rng)

  // nova geração
  const elite = next.filter((r) => r.ovr >= 85).length
  const pipeline = next.filter((r) => r.potential >= 85 && ageIn(r, env.season) <= 23).length
  const deficit = env.targetPop - next.length
  const count = clamp(Math.round(retired * 0.9 + deficit * 0.25 + 4), 6, 40)
  const eliteGap = (env.targetElite - elite - pipeline * 0.5) / Math.max(1, env.targetElite)
  const potMean = 84 + clamp(eliteGap * 6, -2.5, 3.5)
  const nats = [...env.natWeight.entries()].filter(([code]) => ix.country.has(code))
  for (let k = 0; k < count && nats.length; k++) {
    const nationality = rng.weighted(nats, (x) => x[1])[0]
    const potential = Math.round(clamp(rng.normal(potMean, 4), 74, 95))
    const age = rng.int(17, 19)
    const ovr = Math.round(clamp(potential - rng.range(9, 17) + (age - 17) * 1.5, 58, 84))
    const position = rng.weighted(POSITIONS, (p) => p[1])[0]
    let nm = randomName(nationality, rng)
    const clubId = pickClub(data, ix, clubs, nationality, ovr + 6, rng)
    // dois "Lucas Silva" no mesmo elenco confundem a narração e os rankings: sorteia outro nome
    const taken = (n: typeof nm) => next.some((x) => x.clubId === clubId && (x.name === n.name || x.shortName === n.shortName))
    for (let t = 0; t < 6 && taken(nm); t++) nm = randomName(nationality, rng)
    next.push({
      id: `g${env.season}-${k}`,
      name: nm.name,
      shortName: nm.shortName,
      nationality,
      position,
      birthYear: env.season - age,
      ovr,
      potential,
      clubId,
      generated: true,
    })
  }
  return next
}

/**
 * Craques em clubes fracos demais sobem; veteranos às vezes vão para ligas ricas (KSA/USA).
 * No auge (até 30 anos, OVR 82+), só a Europa: o Brasileirão (coef. 0,74) recebia regens europeus no
 * auge e virava a liga dos 70 gols por temporada. Abaixo disso, ligas fora da UEFA pesam menos (e quase
 * nada para quem é de outro continente) — o argentino vai ao Brasil, o holandês de 25 anos, não.
 */
function transfers(env: RivalEnv, rivals: Rival[], rng: Rng) {
  const { data, ix, clubs } = env
  const big = data.clubs.filter((c) => {
    const d = clubs[c.id]
    const lg = d && ix.league.get(d.leagueId)
    return lg && lg.tier === 1 && lg.coefficient >= 0.7
  })
  const confedOf = (clubId: string) => ix.league.get(clubs[clubId]?.leagueId ?? '')?.confed
  const pull = (r: Rival, clubId: string) => {
    const cf = confedOf(clubId)
    return cf === 'UEFA' ? 1 : cf === ix.country.get(r.nationality)?.confed ? 0.5 : 0.1
  }
  const prime = (r: Rival, age: number) => age <= 30 && r.ovr >= 82
  const rich = data.clubs.filter((c) => {
    const d = clubs[c.id]
    const lg = d && ix.league.get(d.leagueId)
    return lg && lg.tier === 1 && (lg.country === 'KSA' || lg.country === 'USA')
  })
  const starsAt = new Map<string, number>()
  for (const r of rivals) starsAt.set(r.clubId, (starsAt.get(r.clubId) ?? 0) + (r.ovr >= 84 ? 1 : 0))
  for (const r of rivals) {
    const age = ageIn(r, env.season)
    const cs = clubs[r.clubId]?.strength ?? 60
    const gap = r.ovr - cs
    const allowed = (c: (typeof data.clubs)[number]) => (!c.onlyNationality || c.onlyNationality === r.nationality) && c.id !== r.clubId
    if (age <= 31 && r.ovr >= 78 && gap > 4 && rng.chance(clamp(0.3 + 0.04 * (gap - 4), 0, 0.8))) {
      const cands = big.filter(
        (c) => allowed(c) && clubs[c.id].strength >= r.ovr - 7 && clubs[c.id].strength <= r.ovr + 3 && (!prime(r, age) || confedOf(c.id) === 'UEFA'),
      )
      if (cands.length) {
        const dest = rng.weighted(cands, (c) => ((1 + clubs[c.id].prestige) / (1 + (starsAt.get(c.id) ?? 0)) ** 1.5) * pull(r, c.id))
        starsAt.set(r.clubId, Math.max(0, (starsAt.get(r.clubId) ?? 1) - 1))
        starsAt.set(dest.id, (starsAt.get(dest.id) ?? 0) + 1)
        r.clubId = dest.id
      }
    } else if (age >= 31 && r.ovr >= 76 && rich.length && rng.chance(0.1)) {
      const cands = rich.filter(allowed)
      if (cands.length) r.clubId = rng.weighted(cands, (c) => clubs[c.id].strength - 50).id
    } else if (age <= 30 && r.ovr >= 82 && rng.chance(0.05)) {
      // transferência "de mercado" entre clubes de nível parecido
      const cands = big.filter((c) => allowed(c) && Math.abs(clubs[c.id].strength - cs) <= 3 && confedOf(c.id) === 'UEFA')
      if (cands.length) r.clubId = rng.pick(cands).id
    }
  }
}

/**
 * Estatísticas da temporada de cada rival a partir das estatísticas do clube
 * (`clubStats`: [jogos, gols pró, gols contra, sem sofrer gol] — sem os estaduais, que não contam
 * para os rankings: o Flamengo faz 60+ jogos com o Carioca e o craque dele virava artilheiro de 70 gols).
 */
export function rivalSeasonStats(
  seed: string,
  season: number,
  rivals: readonly Rival[],
  clubStats: Map<string, [number, number, number, number]>,
  strength: (clubId: string) => number,
): Rival[] {
  const rng = subRng(seed, 'season', season, 'rival-stats')
  const byClub = new Map<string, number[]>()
  const avail: number[] = []
  rivals.forEach((r, i) => {
    const rel = r.ovr - strength(r.clubId)
    let a = rel >= 2 ? 0.88 : rel >= -2 ? 0.8 : rel >= -6 ? 0.64 : 0.45
    a += rng.normal(0, 0.05)
    if (rng.chance(0.12)) a *= rng.range(0.4, 0.75) // lesão
    if (ageIn(r, season) >= 34) a *= 0.85
    avail[i] = clamp(a, 0.05, 0.97)
    const l = byClub.get(r.clubId)
    if (l) l.push(i)
    else byClub.set(r.clubId, [i])
  })
  const out = rivals.map((r) => ({ ...r }))
  for (const [clubId, idxs] of byClub) {
    const st = clubStats.get(clubId) ?? [0, 0, 0, 0]
    const [m, gf] = st
    const fc = quality(strength(clubId))
    let replacedG = 0
    let replacedA = 0
    let wg = 0
    let wa = 0
    for (const i of idxs) {
      const r = rivals[i]
      replacedG += GOAL_W[r.position] * avail[i]
      replacedA += ASSIST_W[r.position] * avail[i]
      wg += GOAL_W[r.position] * quality(r.ovr) * avail[i]
      wa += ASSIST_W[r.position] * quality(r.ovr) * avail[i]
    }
    const restG = Math.max(GENERIC_GOAL * 0.35, GENERIC_GOAL - replacedG) * fc
    const restA = Math.max(GENERIC_ASSIST * 0.35, GENERIC_ASSIST - replacedA) * fc
    const WG = wg + restG
    const WA = wa + restA
    for (const i of idxs) {
      const r = rivals[i]
      const apps = Math.min(MAX_APPS, Math.round(m * avail[i]))
      // parcela do clube, limitada a 42% dos gols e a um teto por jogo (evita 40 gols em 27 jogos)
      const sg = WG > 0 ? Math.min(0.42, (GOAL_W[r.position] * quality(r.ovr) * avail[i]) / WG) : 0
      const sa = WA > 0 ? Math.min(0.3, (ASSIST_W[r.position] * quality(r.ovr) * avail[i]) / WA) : 0
      const eg = Math.min(gf * sg, apps * (GOAL_CAP[r.position] ?? 0.3))
      const ea = Math.min(gf * 0.72 * sa, apps * 0.45)
      out[i].lastSeason = { apps, goals: apps ? rng.poisson(eg) : 0, assists: apps ? rng.poisson(ea) : 0 }
    }
  }
  return out
}

/** Pesos de nacionalidade para novas gerações: nº de craques reais + força da seleção. */
export function nationalityWeights(data: GameData): Map<string, number> {
  const count = new Map<string, number>()
  for (const s of data.stars) count.set(s.nationality, (count.get(s.nationality) ?? 0) + 1)
  const out = new Map<string, number>()
  for (const c of data.countries) {
    const w = ((count.get(c.code) ?? 0) + 0.6) * Math.pow(Math.max(0, c.strength) / 80, 5)
    if (w > 0.05) out.set(c.code, w)
  }
  return out
}
