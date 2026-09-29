/**
 * Modelo do jogador no Modo Imersivo.
 *
 * ATRIBUTOS (1–99): linha = velocidade, finalização, passe, drible, defesa, físico; goleiro =
 * elasticidade, firmeza, reflexo, posicionamento, reposição. OVR = média ponderada pelos pesos da
 * posição (tabela WEIGHTS, soma 1). Aos 16 anos o perfil nasce da posição (atributos-chave altos,
 * fora de posição baixos) e é deslocado para OVR ≈ 50.
 *
 * POTENCIAL oculto (N(81; 6), 66–96) e perfil early/normal/late (10/80/10, goleiro sempre normal).
 * `state.potential` exibido é uma ESTIMATIVA de olheiro (±, fica precisa com a idade).
 *
 * CRESCIMENTO: taxa anual por idade (GROWTH, em pontos de OVR) × potencial restante
 * ((pot − OVR)/5, até 1). 70% vem dos treinos semanais (foco × intensidade × condição) e 30% no
 * fim da temporada (minutos jogados e nota média). O foco escolhe QUAIS atributos sobem; treinar os
 * atributos pesados da posição rende mais OVR.
 *
 * DECLÍNIO (fim de temporada, 29+): DECLINE por idade (goleiro 2 anos depois, ×0,7), puxado por
 * velocidade/físico; semanas de treino físico freiam até 30%; `declineFactor` dos eventos.
 */
import { clamp, type Rng } from '../rng'
import type { Position } from '../types'
import type { Attributes, AttributeKey, GoalkeeperAttributes, OutfieldAttributes, TrainingFocus } from './types'

export const OUTFIELD_KEYS = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'] as const
export const GK_KEYS = ['diving', 'handling', 'reflexes', 'positioning', 'kicking'] as const

export const WEIGHTS: Record<Position, Partial<Record<AttributeKey, number>>> = {
  CA: { pace: 0.15, shooting: 0.38, passing: 0.08, dribbling: 0.17, defending: 0.02, physical: 0.2 },
  PE: { pace: 0.27, shooting: 0.2, passing: 0.13, dribbling: 0.3, defending: 0.02, physical: 0.08 },
  PD: { pace: 0.27, shooting: 0.2, passing: 0.13, dribbling: 0.3, defending: 0.02, physical: 0.08 },
  MEI: { pace: 0.08, shooting: 0.2, passing: 0.32, dribbling: 0.28, defending: 0.04, physical: 0.08 },
  ME: { pace: 0.22, shooting: 0.12, passing: 0.26, dribbling: 0.25, defending: 0.07, physical: 0.08 },
  MD: { pace: 0.22, shooting: 0.12, passing: 0.26, dribbling: 0.25, defending: 0.07, physical: 0.08 },
  MC: { pace: 0.06, shooting: 0.1, passing: 0.34, dribbling: 0.18, defending: 0.16, physical: 0.16 },
  VOL: { pace: 0.06, shooting: 0.04, passing: 0.24, dribbling: 0.08, defending: 0.34, physical: 0.24 },
  LD: { pace: 0.26, shooting: 0.03, passing: 0.18, dribbling: 0.12, defending: 0.25, physical: 0.16 },
  LE: { pace: 0.26, shooting: 0.03, passing: 0.18, dribbling: 0.12, defending: 0.25, physical: 0.16 },
  ZAG: { pace: 0.12, shooting: 0.02, passing: 0.08, dribbling: 0.03, defending: 0.47, physical: 0.28 },
  GOL: { diving: 0.24, handling: 0.22, reflexes: 0.26, positioning: 0.2, kicking: 0.08 },
}

export const isGK = (p: Position) => p === 'GOL'
export const keysOf = (p: Position): AttributeKey[] => (isGK(p) ? [...GK_KEYS] : [...OUTFIELD_KEYS])

export function attr(a: Attributes, k: AttributeKey): number {
  return (a as unknown as Record<string, number>)[k] ?? 40
}

function setAttr(a: Attributes, k: AttributeKey, v: number) {
  ;(a as unknown as Record<string, number>)[k] = v
}

/** OVR pela posição (média ponderada). Atributos do tipo errado (linha × goleiro) valem 40. */
export function ovrOf(attributes: Attributes, position: Position): number {
  const w = WEIGHTS[position] ?? WEIGHTS.MC
  let sum = 0
  let tot = 0
  for (const [k, wk] of Object.entries(w)) {
    sum += attr(attributes, k as AttributeKey) * (wk as number)
    tot += wk as number
  }
  return clamp(Math.round(sum / (tot || 1)), 1, 99)
}

/** Perfil por posição: desvio de cada atributo em relação ao OVR (estilo FIFA). */
const PROFILE: Record<Position, Partial<Record<AttributeKey, number>>> = {
  CA: { pace: -2, shooting: 7, passing: -9, dribbling: 0, defending: -32, physical: 2 },
  PE: { pace: 5, shooting: 0, passing: -4, dribbling: 5, defending: -35, physical: -8 },
  PD: { pace: 5, shooting: 0, passing: -4, dribbling: 5, defending: -35, physical: -8 },
  MEI: { pace: -4, shooting: 1, passing: 6, dribbling: 4, defending: -25, physical: -8 },
  ME: { pace: 3, shooting: -5, passing: 3, dribbling: 3, defending: -15, physical: -6 },
  MD: { pace: 3, shooting: -5, passing: 3, dribbling: 3, defending: -15, physical: -6 },
  MC: { pace: -6, shooting: -6, passing: 5, dribbling: 0, defending: -3, physical: 1 },
  VOL: { pace: -6, shooting: -18, passing: 0, dribbling: -8, defending: 5, physical: 4 },
  LD: { pace: 5, shooting: -22, passing: -2, dribbling: -4, defending: 2, physical: -1 },
  LE: { pace: 5, shooting: -22, passing: -2, dribbling: -4, defending: 2, physical: -1 },
  ZAG: { pace: -8, shooting: -30, passing: -12, dribbling: -22, defending: 5, physical: 4 },
  GOL: { diving: 1, handling: 0, reflexes: 2, positioning: 0, kicking: -8 },
}

/** Atributos iniciais (16 anos, OVR ≈ `target`). */
export function initialAttributes(position: Position, r: Rng, target = 50): Attributes {
  return attributesFor(position, target, r)
}

/** Atributos com o perfil da posição e OVR ≈ `target` (também usado em testes/ferramentas). */
export function attributesFor(position: Position, target: number, r?: Rng): Attributes {
  const keys = keysOf(position)
  const prof = PROFILE[position]
  const raw: Record<string, number> = {}
  for (const k of keys) raw[k] = target + (prof[k] ?? 0) + (r ? r.normal(0, 2.5) : 0)
  const a = { ...raw } as unknown as Attributes
  const shift = target + (r ? r.normal(0, 0.6) : 0) - ovrExact(a, position)
  for (const k of keys) raw[k] = clamp(Math.round(raw[k] + shift), 15, 99)
  const out = raw as unknown as Attributes
  // ajuste fino para acertar o OVR inteiro
  for (let g = 0; g < 20 && ovrOf(out, position) !== Math.round(target); g++) shiftOvr(out, position, Math.sign(Math.round(target) - ovrOf(out, position)))
  return out
}

function ovrExact(a: Attributes, position: Position): number {
  const w = WEIGHTS[position]
  let sum = 0
  let tot = 0
  for (const [k, wk] of Object.entries(w)) {
    sum += attr(a, k as AttributeKey) * (wk as number)
    tot += wk as number
  }
  return sum / (tot || 1)
}

/** Converte atributos quando o jogador muda de linha ↔ gol (evento de posição). */
export function convertAttributes(a: Attributes, to: Position): Attributes {
  const toGK = isGK(to)
  const hasGK = 'diving' in a
  if (toGK === hasGK) return { ...a }
  const avg = Object.values(a as unknown as Record<string, number>).reduce((x, y) => x + y, 0) / Object.keys(a).length
  const out: Record<string, number> = {}
  for (const k of keysOf(to)) out[k] = Math.round(avg - 8)
  return out as unknown as Attributes
}

// ───────────────────────── potencial ─────────────────────────

export function rollProfile(r: Rng, position: Position): 'early' | 'normal' | 'late' {
  if (isGK(position)) return 'normal'
  const v = r.next()
  return v < 0.1 ? 'early' : v < 0.2 ? 'late' : 'normal'
}

export function rollPotential(r: Rng): number {
  return clamp(Math.round(r.normal(81, 6)), 66, 96)
}

/** Estimativa de olheiro (erro diminui com a idade; arredondada). */
export function scoutPotential(truePot: number, ovr: number, age: number, r: Rng): number {
  const err = age >= 27 ? 0 : Math.max(0, 6 - (age - 16) * 0.6)
  return clamp(Math.round(Math.max(ovr, truePot + r.normal(0, err / 2))), ovr, 99)
}

// ───────────────────────── crescimento ─────────────────────────

/** Ganho anual de OVR por idade (perfil normal). */
const GROWTH: Record<number, number> = { 16: 5.5, 17: 5.5, 18: 5, 19: 4.5, 20: 3.8, 21: 3.2, 22: 2.5, 23: 2, 24: 1.4, 25: 1, 26: 0.6, 27: 0.3 }
/** Perda anual de OVR por idade. */
const DECLINE: Record<number, number> = { 29: 0.3, 30: 0.6, 31: 1, 32: 1.5, 33: 2, 34: 2.6, 35: 3.2, 36: 3.8, 37: 4.4, 38: 5, 39: 5.5 }

export function growthRate(age: number, profile: 'early' | 'normal' | 'late', gk: boolean): number {
  let a = age
  if (gk) a = age - 2
  else if (profile === 'early') a = age + 1.5
  else if (profile === 'late') a = age - 2
  const lo = Math.floor(a)
  const f = a - lo
  const g = (x: number) => (x < 16 ? GROWTH[16] : (GROWTH[x] ?? 0))
  let v = g(lo) * (1 - f) + g(lo + 1) * f
  if (profile === 'early' && age <= 19) v *= 1.1
  return v
}

export function declineRate(age: number, gk: boolean): number {
  const a = gk ? age - 2 : age
  if (a < 29) return 0
  return (DECLINE[Math.min(39, a)] ?? 5.5) * (gk ? 0.7 : 1)
}

/** Fator do potencial restante (desacelera perto do teto, para no teto). */
export function potentialFactor(ovr: number, potential: number): number {
  return clamp((potential - ovr) / 5, 0, 1)
}

/** Nome do atributo para textos do motor (toasts); o mesmo da UI (ATTR_LABEL). */
export const ATTR_NAME: Record<AttributeKey, string> = {
  pace: 'Velocidade',
  shooting: 'Finalização',
  passing: 'Passe',
  dribbling: 'Drible',
  defending: 'Defesa',
  physical: 'Físico',
  diving: 'Elasticidade',
  handling: 'Firmeza',
  reflexes: 'Reflexo',
  positioning: 'Posicionamento',
  kicking: 'Reposição',
}

/** Parcelas por foco de treino (atributos de linha / goleiro). */
export const FOCUS_SHARES: Record<TrainingFocus, { outfield: Partial<Record<AttributeKey, number>>; gk: Partial<Record<AttributeKey, number>> }> = {
  finishing: { outfield: { shooting: 0.75, dribbling: 0.25 }, gk: { kicking: 0.4, reflexes: 0.6 } },
  passing: { outfield: { passing: 0.75, dribbling: 0.25 }, gk: { kicking: 1 } },
  dribbling: { outfield: { dribbling: 0.65, pace: 0.35 }, gk: { reflexes: 0.5, diving: 0.5 } },
  physical: { outfield: { physical: 0.6, pace: 0.4 }, gk: { diving: 0.6, handling: 0.4 } },
  defending: { outfield: { defending: 0.75, physical: 0.25 }, gk: { positioning: 0.6, handling: 0.4 } },
  goalkeeping: { outfield: { physical: 0.5, defending: 0.5 }, gk: { reflexes: 0.3, handling: 0.25, positioning: 0.25, diving: 0.2 } },
  tactical: { outfield: {}, gk: {} },
  rest: { outfield: {}, gk: {} },
  recovery: { outfield: {}, gk: {} },
}

/**
 * Intensidade do treino: leve (pouco ganho, energia), normal, intensa (+70% de ganho — o extra não
 * sofre com a condição —, mais ritmo e confiança do técnico, mas desgasta e arrisca lesão).
 */
export const INTENSITY = {
  leve: { gain: 0.55, fitness: -4, injury: 0.001, sharp: 2 },
  normal: { gain: 1, fitness: -8, injury: 0.004, sharp: 4 },
  intensa: { gain: 1.7, fitness: -13, injury: 0.01, sharp: 6 },
} as const

/** Semanas de treino por temporada (normaliza o ganho semanal). */
export const WEEKS_PER_SEASON = 44

/**
 * Aplica `ovrPoints` de crescimento distribuídos pelo foco. Devolve os atributos que subiram.
 * O XP é fracionário (memória) e vira +1 inteiro quando acumula.
 */
export function applyGrowth(
  a: Attributes,
  position: Position,
  focus: TrainingFocus,
  ovrPoints: number,
  xp: Record<string, number>,
): { key: AttributeKey; from: number; to: number }[] {
  const gk = isGK(position)
  const w = WEIGHTS[position]
  let shares: Partial<Record<AttributeKey, number>> = gk ? FOCUS_SHARES[focus].gk : FOCUS_SHARES[focus].outfield
  let eff = 1
  if (focus === 'tactical' || !Object.keys(shares).length) {
    // tático: proporcional aos pesos da posição (ótimo, mas com eficiência menor)
    shares = { ...w }
    eff = 0.85
  }
  const tot = Object.values(shares).reduce((x, y) => x + (y ?? 0), 0) || 1
  // pontos de atributo por ponto de OVR (referência: peso típico 0,3 de um atributo-chave)
  const perOvr = 1 / 0.3
  const ups: { key: AttributeKey; from: number; to: number }[] = []
  for (const [k, sh] of Object.entries(shares)) {
    const key = k as AttributeKey
    if (!(key in (a as object))) continue
    const cur = attr(a, key)
    // atributos já muito altos sobem mais devagar
    const ceil = clamp((99 - cur) / 15, 0.2, 1)
    xp[key] = (xp[key] ?? 0) + ovrPoints * perOvr * eff * ((sh ?? 0) / tot) * ceil
    let v = cur
    while (xp[key] >= 1 && v < 99) {
      xp[key] -= 1
      v++
    }
    if (v !== cur) {
      setAttr(a, key, v)
      ups.push({ key, from: cur, to: v })
    }
  }
  void w
  return ups
}

/** Declínio de fim de temporada: `ovrPoints` distribuídos (velocidade/físico primeiro). */
export function applyDecline(a: Attributes, position: Position, ovrPoints: number, r: Rng): { key: AttributeKey; from: number; to: number }[] {
  if (ovrPoints <= 0) return []
  const gk = isGK(position)
  const w = WEIGHTS[position]
  const bias: Partial<Record<AttributeKey, number>> = gk
    ? { diving: 1.4, reflexes: 1.3, handling: 0.8, positioning: 0.5, kicking: 0.6 }
    : { pace: 1.8, physical: 1.4, dribbling: 1, shooting: 0.7, passing: 0.5, defending: 0.8 }
  const out: { key: AttributeKey; from: number; to: number }[] = []
  const perOvr = 1 / 0.3
  for (const k of keysOf(position)) {
    const share = ((w[k] ?? 0) * 0.6 + 0.4 / keysOf(position).length) * (bias[k] ?? 1)
    const loss = ovrPoints * perOvr * share * r.range(0.7, 1.3) * 0.9
    const cur = attr(a, k)
    const whole = Math.floor(loss) + (r.next() < loss - Math.floor(loss) ? 1 : 0)
    if (whole > 0) {
      const to = clamp(cur - whole, 20, 99)
      setAttr(a, k, to)
      out.push({ key: k, from: cur, to })
    }
  }
  return out
}

/** Ajuste permanente de OVR (eventos: +2 OVR, lesão −3 OVR): distribui pelos pesos da posição. */
export function shiftOvr(a: Attributes, position: Position, delta: number): void {
  if (!delta) return
  const target = ovrOf(a, position) + delta
  const w = WEIGHTS[position]
  const keys = keysOf(position).sort((x, y) => (w[y] ?? 0) - (w[x] ?? 0))
  for (let guard = 0; guard < 200 && ovrOf(a, position) !== target; guard++) {
    const k = keys[guard % Math.min(4, keys.length)]
    const cur = attr(a, k)
    const nv = clamp(cur + Math.sign(delta), 20, 99)
    if (nv === cur) continue
    setAttr(a, k, nv)
  }
}

// ───────────────────────── valor de mercado ─────────────────────────

const VALUE_CURVE: [number, number][] = [
  [50, 100_000],
  [55, 250_000],
  [60, 500_000],
  [65, 1_200_000],
  [70, 3_000_000],
  [75, 5_000_000],
  [80, 15_000_000],
  [85, 50_000_000],
  [90, 100_000_000],
  [95, 150_000_000],
  [99, 250_000_000],
]

export function valueFromCurve(ovr: number): number {
  const o = clamp(ovr, 50, 99)
  for (let i = 1; i < VALUE_CURVE.length; i++) {
    const [x1, y1] = VALUE_CURVE[i]
    const [x0, y0] = VALUE_CURVE[i - 1]
    if (o <= x1) return y0 + ((y1 - y0) * (o - x0)) / (x1 - x0)
  }
  return VALUE_CURVE[VALUE_CURVE.length - 1][1]
}

export function ageValueFactor(age: number): number {
  if (age <= 18) return 1.5
  if (age <= 22) return 1.2
  if (age <= 26) return 1
  if (age <= 30) return 0.9
  if (age <= 32) return 0.8
  if (age <= 34) return 0.6
  return 0.2
}

export function roundMoney(v: number): number {
  if (v >= 10_000_000) return Math.round(v / 1_000_000) * 1_000_000
  if (v >= 1_000_000) return Math.round(v / 100_000) * 100_000
  if (v >= 100_000) return Math.round(v / 10_000) * 10_000
  // salários pequenos (base, divisões de baixo): €1K de passo — com €10K, pedir €25K sobre €20K virava €30K
  return Math.max(10_000, Math.round(v / 1_000) * 1_000)
}

/**
 * Valor de mercado: curva do Clássico (OVR × idade × liga) × fase (0,85–1,2) × fama × potencial
 * (jovens) × multiplicador de eventos.
 */
export function marketValueOf(o: {
  ovr: number
  age: number
  leagueCoefficient: number
  form: number
  reputation: number
  potential: number
  mult?: number
}): number {
  const league = clamp(0.75 + ((o.leagueCoefficient - 0.3) / 0.7) * 0.4, 0.75, 1.15)
  const form = clamp(0.85 + (o.form - 40) / 200, 0.85, 1.2)
  const fame = 1 + clamp(o.reputation, 0, 100) / 400
  const pot = o.age <= 22 ? 1 + clamp(o.potential - o.ovr, 0, 25) / 45 : 1
  return roundMoney(valueFromCurve(o.ovr) * ageValueFactor(o.age) * league * form * fame * pot * (o.mult ?? 1))
}

export function estimateSalary(value: number, prestige: number, leagueCoefficient: number, mult = 1): number {
  const s = value * 0.12 * (0.7 + 0.12 * prestige) * (0.6 + 0.5 * leagueCoefficient) * mult
  return roundMoney(Math.max(24_000, s))
}

export function contractYears(age: number): number {
  if (age <= 23) return 5
  if (age <= 27) return 4
  if (age <= 30) return 3
  if (age <= 33) return 2
  return 1
}

export type OutfieldOrGk = OutfieldAttributes | GoalkeeperAttributes
