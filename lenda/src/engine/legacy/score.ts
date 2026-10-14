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
 *      Copas do Mundo                    20    sat(v, 1.2)     1→57%  2→81%  3→92%
 *      Bolas de Ouro                     17    sat(oficiais + 0,75 × retroativas, 2)   1→39%  3→78%  5→92%  8→98%
 *      Continental (Champions + Liberta) 11    sat(ucl + lib, 1.6) — dividido entre as duas pela proporção
 *                                                              1→46%  3→85%  5→96%
 *      Gols*                             10    sat(g, 380)     300→55%  500→73%  757→86%  1000→93%
 *      Média de gols*                     7    (média − 0,25) / 0,65, limitado a [0, 1] × min(1, jogos/300)
 *      Melhor jogador                     5    sat(v, 7)       The Best + craque da liga + Bola de Ouro da Copa
 *                                                              1→13%  3→35%  6→58%  14→86%
 *      Títulos (todos)                    5    sat(v, 24)      estaduais e supercopas valem 0,5
 *                                                              10→34%  20→57%  35→77%  46→85%
 *      Recordes                           5    sat(r, 3)       recordes MUNDIAIS nas métricas do jogo
 *      Títulos nacionais                  5    sat(v, 6)       5→57%  10→81%  20→96%
 *      Artilharias                        4    sat(v, 5)       artilheiro da liga + Chuteira de Ouro da Copa
 *                                                              2→33%  5→63%  9→83%
 *      Assistências*                      4    sat(a, 160)
 *      Chuteiras de Ouro                  3    sat(v, 1.8)
 *      Luvas de Ouro                      2    sat(v, 2)       melhor goleiro do mundo no ano
 *      Prêmio Puskás                      1    sat(v, 1)       1→63%  2→86%
 *      Clubes                             1    2→50%  3→75%  4+→100%; um clube só (300+ jogos) → 100%
 *      Prêmios individuais                —    só ranking (é a soma das categorias de prêmio)
 *
 *    * Produção ajustada por posição: atacante ×1, meio-campo ×1,5, defensor ×3 + longevidade
 *      (gols equivalentes = 3 × gols + 0,2 × jogos, no máximo 380 — abaixo de um artilheiro de
 *      verdade; média = o maior entre a média ×3 e 0,25 × min(1, jogos/500)). Goleiro: gols
 *      equivalentes = 0,2 × jogos, assistências = 0,05 × jogos e média = 0,25 × min(1, jogos/500)
 *      (longevidade no lugar de produção ofensiva: um goleiro de 1.100 jogos sem títulos fica < 30).
 *    Bolas de Ouro retroativas = "Nouveau Palmarès" da France Football (só lendas; ver legends.ts).
 * 3. Soma bruta R ∈ [0, 100] → nota = 100 × (1 − e^(−R/40)) / (1 − e^(−100/40)), arredondada.
 *    A curva final abre a parte de baixo da escala (uma run boa não fica "presa" em 20).
 *
 * Por que esses pesos (v2, out/2026): os prêmios e títulos que o jogo dá entraram na nota (Melhor
 * jogador, Títulos, Artilharias, Luvas, Puskás), mas como contagens de VOLUME: crescem com carreiras
 * longas em ligas dominadas (supercopa todo ano, craque da liga todo ano). Por isso têm curvas largas
 * (k alto), estaduais e supercopas valem meio título, e o peso maior fica no que separa as lendas:
 * Copa do Mundo, Champions/Libertadores e Bola de Ouro. As retroativas valem 3/4 (são da própria
 * France Football, só não eram oficiais). Ordens fixadas em teste (legacy.test.ts): Messi, Pelé e
 * Cristiano Ronaldo nos três primeiros; Maradona no top 12; Zico acima de Ibrahimović; Garrincha
 * acima de Haaland. Mudou a fórmula? Suba LEGACY_VERSION.
 */
import type { PositionGroup } from '../types'
import { SCORED_CATEGORY_IDS, type CategoryId, type CategoryValues } from './categories'

export const LEGACY_WEIGHTS = {
  worldCups: 20,
  ballonDor: 17,
  continental: 11,
  goals: 10,
  goalsPerGame: 7,
  bestPlayer: 5,
  titles: 5,
  records: 5,
  leagueTitles: 5,
  topScorer: 4,
  assists: 4,
  goldenBoots: 3,
  goldenGloves: 2,
  puskas: 1,
  clubs: 1,
} as const

/** Constantes das curvas de cada categoria (ver o cabeçalho). */
export const LEGACY_K = { ballonDor: 2, worldCups: 1.2, goldenBoots: 1.8, continental: 1.6, leagueTitles: 6, goals: 380, assists: 160, records: 3, bestPlayer: 7, titles: 24, topScorer: 5, goldenGloves: 2, puskas: 1 } as const
const K = LEGACY_K
const FINAL_K = 40
const POS_FACTOR: Record<PositionGroup, number> = { attacking: 1, support: 1.5, defensive: 3, goalkeeper: 0 }
/** Coeficientes de goleiro e defensor (ver cabeçalho). */
export const POSITION_RULES = { gkGoalsPerApp: 0.2, gkAssistsPerApp: 0.05, gkRateFill: 0.25, defAppsBonus: 0.2, defGoalsCap: 380, defRateFill: 0.25 } as const
/** Crédito de cada Bola de Ouro retroativa (não oficial). */
export const RETRO_BALLON_DOR_CREDIT = 0.75
/** Crédito de cada taça menor (estadual, supercopa) em Títulos (todos); as demais valem 1. */
export const MINOR_TITLE_CREDIT = 0.5
/**
 * Versão dos pesos e curvas. Sobe a cada mudança na fórmula: a nota gravada em cada carreira do Hall
 * (`HallEntry.legacy.v`) com outra versão é recalculada ao ler o Hall.
 */
export const LEGACY_VERSION = 2
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
  /** Quantos de `values.titles` são taças menores (estaduais e supercopas): valem MINOR_TITLE_CREDIT. */
  minorTitles?: number
}

/** Títulos (todos) como a nota conta: cada taça menor vale MINOR_TITLE_CREDIT. */
export const weightedTitles = (titles: number, minor = 0) => Math.max(0, titles - (1 - MINOR_TITLE_CREDIT) * Math.max(0, Math.min(titles, minor)))

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

/** Peso de uma categoria na nota (0 = não entra; Champions e Libertadores dividem o continental). */
export function categoryWeight(id: CategoryId): number {
  if (id === 'ucl' || id === 'libertadores') return LEGACY_WEIGHTS.continental
  return (LEGACY_WEIGHTS as Record<string, number>)[id] ?? 0
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
  const fills: Partial<Record<CategoryId, number>> = {
    ballonDor: sat(v.ballonDor + RETRO_BALLON_DOR_CREDIT * (input.retroBallonDor ?? 0), K.ballonDor),
    bestPlayer: sat(v.bestPlayer, K.bestPlayer),
    goldenBoots: sat(v.goldenBoots, K.goldenBoots),
    topScorer: sat(v.topScorer, K.topScorer),
    puskas: sat(v.puskas, K.puskas),
    goldenGloves: sat(v.goldenGloves, K.goldenGloves),
    worldCups: sat(v.worldCups, K.worldCups),
    ucl: contFill,
    libertadores: contFill,
    leagueTitles: sat(v.leagueTitles, K.leagueTitles),
    titles: sat(weightedTitles(v.titles, input.minorTitles), K.titles),
    goals: sat(prod.goals, K.goals),
    assists: sat(prod.assists, K.assists),
    goalsPerGame: prod.rateFill,
    records: sat(v.records, K.records),
    clubs: clubsFill(v.clubs, apps, input.oneClub),
  }
  const share = (n: number) => (cont > 0 ? n / cont : 0.5)
  const pointsOf = (id: CategoryId): number => {
    const w = categoryWeight(id)
    if (id === 'ucl' || id === 'libertadores') return w * contFill * share(v[id])
    return w * (fills[id] ?? 0)
  }
  const breakdown: BreakdownItem[] = SCORED_CATEGORY_IDS.map((id) => ({
    id,
    points: pointsOf(id),
    max: categoryWeight(id),
    fill: id === 'ucl' || id === 'libertadores' ? (cont ? contFill * share(v[id]) : 0) : (fills[id] ?? 0),
  }))
  const raw = breakdown.reduce((a, b) => a + b.points, 0)
  const score = Math.round((100 * (1 - Math.exp(-raw / FINAL_K))) / (1 - Math.exp(-100 / FINAL_K)))
  return { raw, score: Math.max(0, Math.min(100, score)), breakdown }
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
