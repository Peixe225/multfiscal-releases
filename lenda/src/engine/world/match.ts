/**
 * Modelo de partida — Poisson com correção de Dixon–Coles ("lite").
 *
 *   d  = forçaMandante − forçaVisitante + (neutro ? 0 : MANDO)
 *   λm = BASE · e^(β·d)      λv = BASE · e^(−β·d)
 *
 * Com BASE 1.30, β 0.038 e MANDO 3.5: ~2,6–2,7 gols/jogo numa liga, ~25–27% de empates e o mais
 * forte por 10 pontos vence ~68% em casa. A correção τ de Dixon–Coles (ρ = −0,10) aumenta 0–0 e 1–1
 * e reduz 1–0/0–1, como no futebol real. Mata-mata: prorrogação (≈ 1/3 de λ) e pênaltis.
 *
 * Reutilizado pelo modo Imersivo (fase 2): funções puras, só dependem do Rng recebido.
 */
import type { Rng } from '../rng'

export const MATCH = {
  base: 1.3,
  beta: 0.038,
  homeAdvantage: 3.5,
  rho: -0.1,
  /** Fração de λ na prorrogação (30 min, pernas cansadas). */
  extraTime: 0.3,
  /** Conversão média de pênalti. */
  penalty: 0.76,
}

export interface MatchOptions {
  neutral?: boolean
  /** Mata-mata de jogo único: empate vai para prorrogação/pênaltis. */
  knockout?: boolean
  /** false = empate vai direto para os pênaltis (padrão CONMEBOL). Padrão true. */
  extraTime?: boolean
}

export interface SimulatedMatch {
  score: [number, number]
  aet?: boolean
  pens?: [number, number]
  /** 0 = mandante, 1 = visitante; undefined = empate (jogo de liga). */
  winner?: 0 | 1
}

export function expectedGoals(home: number, away: number, neutral = false): [number, number] {
  const d = home - away + (neutral ? 0 : MATCH.homeAdvantage)
  const e = Math.exp(MATCH.beta * d)
  return [MATCH.base * e, MATCH.base / e]
}

/** Placar com a correção de Dixon–Coles por amostragem com rejeição. */
export function sampleScore(lh: number, la: number, rng: Rng): [number, number] {
  const rho = MATCH.rho
  const t00 = Math.max(0, 1 - lh * la * rho)
  const t01 = Math.max(0, 1 + lh * rho)
  const t10 = Math.max(0, 1 + la * rho)
  const t11 = Math.max(0, 1 - rho)
  const tmax = Math.max(1, t00, t01, t10, t11)
  for (let i = 0; i < 12; i++) {
    const h = rng.poisson(lh)
    const a = rng.poisson(la)
    let t = 1
    if (h <= 1 && a <= 1) t = h === 0 ? (a === 0 ? t00 : t01) : a === 0 ? t10 : t11
    if (t >= tmax || rng.next() * tmax < t) return [h, a]
  }
  return [rng.poisson(lh), rng.poisson(la)]
}

/** Disputa de pênaltis: 5 cobranças + alternadas. `edge` (−1..1) favorece levemente o 1º time. */
export function penaltyShootout(rng: Rng, edge = 0): [number, number] {
  const pa = MATCH.penalty + 0.03 * edge
  const pb = MATCH.penalty - 0.03 * edge
  let a = 0
  let b = 0
  for (let k = 0; k < 5; k++) {
    if (rng.chance(pa)) a++
    if (a > b + (5 - k)) return [a, b]
    if (rng.chance(pb)) b++
    if (b > a + (4 - k)) return [a, b]
  }
  for (let k = 0; k < 30 && a === b; k++) {
    const sa = rng.chance(pa)
    const sb = rng.chance(pb)
    if (sa) a++
    if (sb) b++
  }
  if (a === b) a++
  return [a, b]
}

/**
 * Uma partida. `home`/`away` são forças (escala de OVR, 40–95).
 * Em mata-mata de jogo único, o empate vai à prorrogação (se habilitada) e aos pênaltis.
 */
export function simulateMatch(home: number, away: number, rng: Rng, opts: MatchOptions = {}): SimulatedMatch {
  const [lh, la] = expectedGoals(home, away, opts.neutral)
  const score = sampleScore(lh, la, rng)
  if (!opts.knockout) return { score, winner: score[0] === score[1] ? undefined : score[0] > score[1] ? 0 : 1 }
  if (score[0] !== score[1]) return { score, winner: score[0] > score[1] ? 0 : 1 }
  return decide(score, lh, la, home - away, rng, opts.extraTime !== false)
}

/** Resolve um empate de mata-mata (prorrogação opcional + pênaltis). `score` é o placar do jogo. */
export function decide(
  score: [number, number],
  lh: number,
  la: number,
  diff: number,
  rng: Rng,
  extraTime: boolean,
): SimulatedMatch {
  const s: [number, number] = [score[0], score[1]]
  if (extraTime) {
    s[0] += rng.poisson(lh * MATCH.extraTime)
    s[1] += rng.poisson(la * MATCH.extraTime)
    if (s[0] !== s[1]) return { score: s, aet: true, winner: s[0] > s[1] ? 0 : 1 }
  }
  const pens = penaltyShootout(rng, Math.max(-1, Math.min(1, diff / 20)))
  return { score: s, aet: extraTime || undefined, pens, winner: pens[0] > pens[1] ? 0 : 1 }
}

export interface TwoLegResult {
  /** legs[0] = ida (mandante b), legs[1] = volta (mandante a). */
  legs: [SimulatedMatch & { home: 'a' | 'b' }, SimulatedMatch & { home: 'a' | 'b' }]
  aggregate: [number, number] // [a, b]
  winner: 'a' | 'b'
}

/**
 * Confronto de ida e volta: `a` (melhor campanha) decide em casa. Sem gol fora.
 * Agregado empatado → prorrogação no 2º jogo (se habilitada) e pênaltis.
 */
export function simulateTwoLegs(
  a: number,
  b: number,
  rng: Rng,
  opts: { extraTime?: boolean; neutralSecond?: boolean } = {},
): TwoLegResult {
  const first = simulateMatch(b, a, rng) // b em casa
  const [lh, la] = expectedGoals(a, b, opts.neutralSecond)
  let second: SimulatedMatch = { score: sampleScore(lh, la, rng) }
  const aggA = first.score[1] + second.score[0]
  const aggB = first.score[0] + second.score[1]
  let winner: 'a' | 'b'
  if (aggA !== aggB) {
    winner = aggA > aggB ? 'a' : 'b'
  } else {
    const d = decide(second.score, lh, la, a - b, rng, opts.extraTime !== false)
    second = d
    winner = d.winner === 0 ? 'a' : 'b'
  }
  const finalA = first.score[1] + second.score[0]
  const finalB = first.score[0] + second.score[1]
  return {
    legs: [
      { ...first, home: 'b' },
      { ...second, home: 'a' },
    ],
    aggregate: [finalA, finalB],
    winner,
  }
}
