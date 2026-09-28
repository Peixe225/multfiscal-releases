/**
 * NOTA DE LEGADO (0–100) — a MESMA função avalia runs e lendas reais, então as duas escalas são
 * comparáveis. Só entram fatos de carreira (nada de OVR, que as lendas não têm) e nada que dependa
 * de OUTRAS runs: a nota de uma run é fixa no dia em que ela termina (a ordem das runs, novas runs
 * ou runs que saem do Hall não mudam nada). Recordes das suas runs aparecem só como selos.
 *
 * 1. Cada categoria vira um "preenchimento" s ∈ [0, 1] com retorno decrescente:
 *      sat(v, k) = 1 − e^(−v/k)   (o 1º título vale mais que o 9º)
 * 2. Pesos (somam 100):
 *
 *      Categoria                        peso   curva
 *      Bolas de Ouro                     20    sat(oficiais + 0,5 × retroativas, 2)   1→39%  3→78%  5→92%  8→98%
 *      Copas do Mundo                    18    sat(v, 1.4)     1→51%  2→76%  3→88%
 *      Continental (Champions + Liberta) 11    sat(ucl + lib, 1.6) — dividido entre as duas pela proporção
 *      Gols*                             14    sat(g, 380)     300→55%  500→73%  757→86%  1000→93%
 *      Média de gols*                    10    (média − 0,25) / 0,65, limitado a [0, 1] × min(1, jogos/300)
 *      Recordes                           9    sat(r, 3)       recordes MUNDIAIS nas métricas do jogo
 *      Títulos nacionais                  6    sat(v, 6)       5→57%  10→81%  20→96%
 *      Assistências*                      6    sat(a, 160)
 *      Chuteiras de Ouro                  4    sat(v, 1.8)
 *      Clubes                             2    2→50%  3→75%  4+→100%; um clube só (300+ jogos) → 100%
 *
 *    * Produção ajustada por posição: atacante ×1, meio-campo ×1,5, defensor ×3 + longevidade
 *      (gols equivalentes = 3 × gols + 0,2 × jogos, no máximo 380 — abaixo de um artilheiro de
 *      verdade; média = o maior entre a média ×3 e 0,25 × min(1, jogos/500)). Goleiro: gols
 *      equivalentes = 0,2 × jogos, assistências = 0,05 × jogos e média = 0,25 × min(1, jogos/500)
 *      (longevidade no lugar de produção ofensiva: um goleiro de 1.100 jogos sem títulos fica < 30).
 *    Bolas de Ouro retroativas = "Nouveau Palmarès" da France Football (só lendas; ver legends.ts).
 * 3. Soma bruta R ∈ [0, 100] → nota = 100 × (1 − e^(−R/40)) / (1 − e^(−100/40)), arredondada.
 *    A curva final abre a parte de baixo da escala (uma run boa não fica "presa" em 20).
 */
import type { PositionGroup } from '../types'
import { CATEGORY_IDS, type CategoryId, type CategoryValues } from './categories'

export const LEGACY_WEIGHTS = {
  ballonDor: 20,
  worldCups: 18,
  goldenBoots: 4,
  continental: 11,
  leagueTitles: 6,
  clubs: 2,
  goals: 14,
  assists: 6,
  records: 9,
  goalsPerGame: 10,
} as const

const K = { ballonDor: 2, worldCups: 1.4, goldenBoots: 1.8, continental: 1.6, leagueTitles: 6, goals: 380, assists: 160, records: 3 }
const FINAL_K = 40
const POS_FACTOR: Record<PositionGroup, number> = { attacking: 1, support: 1.5, defensive: 3, goalkeeper: 0 }
/** Coeficientes de goleiro e defensor (ver cabeçalho). */
export const POSITION_RULES = { gkGoalsPerApp: 0.2, gkAssistsPerApp: 0.05, gkRateFill: 0.25, defAppsBonus: 0.2, defGoalsCap: 380, defRateFill: 0.25 } as const
/** Crédito de cada Bola de Ouro retroativa (não oficial). */
export const RETRO_BALLON_DOR_CREDIT = 0.5
/** Jogos mínimos para "um clube só" valer nota cheia em Clubes. */
const ONE_CLUB_MIN_APPS = 300

export const sat = (v: number, k: number) => (v <= 0 ? 0 : 1 - Math.exp(-v / k))
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export interface ScoreInput {
  values: CategoryValues
  apps: number
  positionGroup: PositionGroup
  /** Carreira inteira num clube só (sem empréstimos). */
  oneClub?: boolean
  /** Bolas de Ouro retroativas (lendas pré-1995; runs não têm). */
  retroBallonDor?: number
}

export interface BreakdownItem {
  id: CategoryId
  /** Pontos obtidos (0 … max). */
  points: number
  /** Teto da categoria (Champions e Libertadores dividem os 11 do continental). */
  max: number
  /** Preenchimento 0–1. */
  fill: number
}

export interface LegacyScore {
  score: number
  raw: number
  breakdown: BreakdownItem[]
}

/** Gols e assistências "equivalentes" usados na nota (ajuste por posição). */
export function adjustedProduction(v: Pick<CategoryValues, 'goals' | 'assists' | 'goalsPerGame'>, apps: number, g: PositionGroup) {
  const R = POSITION_RULES
  const f = POS_FACTOR[g]
  if (g === 'goalkeeper') return { goals: apps * R.gkGoalsPerApp, assists: apps * R.gkAssistsPerApp, rateFill: R.gkRateFill * clamp01(apps / 500) }
  const longevity = clamp01(apps / 500)
  const rate = clamp01((v.goalsPerGame * f - 0.25) / 0.65) * clamp01(apps / 300)
  if (g === 'defensive') return { goals: Math.min(R.defGoalsCap, v.goals * f + R.defAppsBonus * apps), assists: v.assists * 2, rateFill: Math.max(rate, R.defRateFill * longevity) }
  return { goals: v.goals * f, assists: v.assists * Math.min(f, 2), rateFill: rate }
}

/** Preenchimento de Clubes: 2→50%, 3→75%, 4+→100%; um clube só com 300+ jogos também vale 100%. */
export function clubsFill(clubs: number, apps: number, oneClub = false): number {
  if (oneClub && clubs <= 1 && apps >= ONE_CLUB_MIN_APPS) return 1
  return clamp01(Math.max(0, clubs) / 4)
}

/** Nota de Legado a partir das categorias (runs e lendas). */
export function scoreValues(input: ScoreInput): LegacyScore {
  const v = input.values
  const apps = Math.max(0, input.apps)
  const prod = adjustedProduction(v, apps, input.positionGroup)
  const cont = v.ucl + v.libertadores
  const contFill = sat(cont, K.continental)
  const W = LEGACY_WEIGHTS
  const fills: Record<CategoryId, number> = {
    ballonDor: sat(v.ballonDor + RETRO_BALLON_DOR_CREDIT * (input.retroBallonDor ?? 0), K.ballonDor),
    worldCups: sat(v.worldCups, K.worldCups),
    goldenBoots: sat(v.goldenBoots, K.goldenBoots),
    ucl: contFill,
    libertadores: contFill,
    leagueTitles: sat(v.leagueTitles, K.leagueTitles),
    clubs: clubsFill(v.clubs, apps, input.oneClub),
    goals: sat(prod.goals, K.goals),
    assists: sat(prod.assists, K.assists),
    records: sat(v.records, K.records),
    goalsPerGame: prod.rateFill,
  }
  const share = (n: number) => (cont > 0 ? n / cont : 0.5)
  const points: Record<CategoryId, number> = {
    ballonDor: W.ballonDor * fills.ballonDor,
    worldCups: W.worldCups * fills.worldCups,
    goldenBoots: W.goldenBoots * fills.goldenBoots,
    ucl: W.continental * contFill * share(v.ucl),
    libertadores: W.continental * contFill * share(v.libertadores),
    leagueTitles: W.leagueTitles * fills.leagueTitles,
    clubs: W.clubs * fills.clubs,
    goals: W.goals * fills.goals,
    assists: W.assists * fills.assists,
    records: W.records * fills.records,
    goalsPerGame: W.goalsPerGame * fills.goalsPerGame,
  }
  const max = (id: CategoryId) => (id === 'ucl' || id === 'libertadores' ? W.continental : W[id as keyof typeof W])
  const raw = CATEGORY_IDS.reduce((a, id) => a + points[id], 0)
  const score = Math.round((100 * (1 - Math.exp(-raw / FINAL_K))) / (1 - Math.exp(-100 / FINAL_K)))
  return {
    raw,
    score: Math.max(0, Math.min(100, score)),
    breakdown: CATEGORY_IDS.map((id) => ({ id, points: points[id], max: max(id), fill: id === 'ucl' || id === 'libertadores' ? (cont ? contFill * share(v[id]) : 0) : fills[id] })),
  }
}

export interface LegacyTier {
  id: 'promessa' | 'profissional' | 'idolo' | 'craque' | 'lenda' | 'imortal'
  label: string
  min: number
}

export const LEGACY_TIERS: LegacyTier[] = [
  { id: 'imortal', label: 'Imortal', min: 90 },
  { id: 'lenda', label: 'Lenda', min: 75 },
  { id: 'craque', label: 'Craque', min: 60 },
  { id: 'idolo', label: 'Ídolo', min: 45 },
  { id: 'profissional', label: 'Profissional', min: 25 },
  { id: 'promessa', label: 'Promessa', min: 0 },
]

export const legacyTier = (score: number): LegacyTier => LEGACY_TIERS.find((t) => score >= t.min) ?? LEGACY_TIERS[LEGACY_TIERS.length - 1]
