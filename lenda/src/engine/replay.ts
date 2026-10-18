/**
 * Replay de uma carreira do Modo Clássico (servidor/CONTRATO-v33.md §B): o motor é determinístico — a mesma semente,
 * identidade inicial, ritmo, bônus de OVR e as mesmas escolhas dão exatamente a mesma carreira —, então guardar isso
 * basta para jogá-la de novo e conferir os números que o aparelho mandou (o desafio "As Taças do Rei").
 *
 *   const r = novoReplay(seed, identity, pace, bonusOvr, par)   // na criação (null: semente que não dá para refazer)
 *   r.picks.push(escolhaDoReplay(decisao, optionId))            // a cada decisão
 *
 * Nada aqui mexe no motor: o replay é gravado ao lado do estado (CareerState.replay, que o motor só copia). Jogar de
 * novo e comparar fica em ./verificar.ts (só a tela do admin carrega).
 */
import type { Decision, Pace, PlayerIdentity } from './types'
import { DADOS_VERSAO } from '../data/versao'

export const REPLAY_V = 1 as const
/** Uma carreira do Intenso tem ~25 decisões com os eventos; acima disto o replay não é de uma carreira de verdade. */
export const REPLAY_MAX_PICKS = 120
export const LADOS = ['left', 'center', 'right'] as const
export type LadoPenalti = (typeof LADOS)[number]

export interface ReplayPick {
  /** Id da opção escolhida (o que o motor recebe). */
  id: string
  /** Tipo da decisão (academy, transfer, event…). */
  kind: string
  /** Posição do cartão na decisão (o #ck-opt-<idx> da tela). */
  idx: number
  /** Canto do pênalti decisivo, ou null. */
  pen: LadoPenalti | null
  /** Quantas opções a decisão tinha. */
  n: number
}

export interface CareerReplay {
  v: typeof REPLAY_V
  /** Os dois números de crypto.getRandomValues: a semente da carreira é a0.toString(36) + a1.toString(36). */
  seed: [number, number]
  /** A identidade da CRIAÇÃO (a carreira pode trocar de seleção ou de posição no caminho). */
  identity: PlayerIdentity
  pace: Pace
  picks: ReplayPick[]
  bonusOvr: number
  /** Versão dos dados do jogo com que a carreira começou (src/data/versao.ts). */
  dados: string
}

const U32 = 0x1_0000_0000

/** A semente (texto) de um par: a mesma conta do randomSeed() do jogo. */
export const sementeDoPar = (p: readonly [number, number]) => `${p[0].toString(36)}${p[1].toString(36)}`

const u32 = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < U32

/**
 * Um par [a0, a1] que dá esta semente (null: não veio do randomSeed). Mais de um corte pode servir ("1a"+"bc" e
 * "1ab"+"c"): qualquer um refaz o mesmo texto, então a carreira é a mesma; o randomSeed lembra o par original.
 */
export function parDaSemente(seed: string): [number, number] | null {
  if (typeof seed !== 'string' || !/^[0-9a-z]{2,14}$/.test(seed)) return null
  for (let k = 1; k < seed.length; k++) {
    const a = seed.slice(0, k)
    const b = seed.slice(k)
    if (a.length > 7 || b.length > 7) continue
    const a0 = parseInt(a, 36)
    const a1 = parseInt(b, 36)
    if (u32(a0) && u32(a1) && sementeDoPar([a0, a1]) === seed) return [a0, a1]
  }
  return null
}

/** O replay da carreira que começa agora; null se a semente não for do randomSeed (não dá para repetir). */
export function novoReplay(seed: string, identity: PlayerIdentity, pace: Pace, bonusOvr = 0, par?: readonly [number, number] | null): CareerReplay | null {
  const p = par && u32(par[0]) && u32(par[1]) && sementeDoPar(par) === seed ? ([par[0], par[1]] as [number, number]) : parDaSemente(seed)
  if (!p) return null
  const { surname, number, foot, nationality, position } = identity
  return { v: REPLAY_V, seed: p, identity: { surname, number, foot, nationality, position }, pace, picks: [], bonusOvr: Math.max(0, Math.round(bonusOvr) || 0), dados: DADOS_VERSAO }
}

function ladoDe(decisao: Decision, optionId: string): LadoPenalti | null {
  const o = decisao.options.find((x) => x.id === optionId)
  if (o?.minigame !== 'penalty') return null
  const spec = (decisao.context?.specs as Record<string, { penalty?: { side?: unknown } }> | undefined)?.[optionId]
  const lado = spec?.penalty?.side ?? /-(left|center|right)$/.exec(optionId)?.[1]
  return (LADOS as readonly unknown[]).includes(lado) ? (lado as LadoPenalti) : null
}

/** A escolha como vai no replay. */
export function escolhaDoReplay(decisao: Decision, optionId: string): ReplayPick {
  return { id: optionId, kind: decisao.kind, idx: decisao.options.findIndex((o) => o.id === optionId), pen: ladoDe(decisao, optionId), n: decisao.options.length }
}

/** O replay que veio de fora (servidor, HallEntry de outro aparelho), conferido campo a campo; null = não serve. */
export function normalizarReplay(x: unknown): CareerReplay | null {
  const r = x as Record<string, unknown> | null
  if (!r || typeof r !== 'object' || r.v !== REPLAY_V) return null
  const seed = r.seed as unknown[]
  if (!Array.isArray(seed) || seed.length !== 2 || !u32(seed[0]) || !u32(seed[1])) return null
  const id = r.identity as Record<string, unknown> | null
  if (!id || typeof id !== 'object' || typeof id.surname !== 'string' || typeof id.number !== 'number' || typeof id.nationality !== 'string' || typeof id.position !== 'string') return null
  if (id.foot !== 'left' && id.foot !== 'right') return null
  if (r.pace !== 'intensa' && r.pace !== 'normal' && r.pace !== 'expressa') return null
  if (!Array.isArray(r.picks) || r.picks.length > REPLAY_MAX_PICKS) return null
  const picks: ReplayPick[] = []
  for (const p of r.picks as unknown[]) {
    const o = p as Record<string, unknown> | null
    if (!o || typeof o.id !== 'string' || !o.id || o.id.length > 80) return null
    const pen = (LADOS as readonly unknown[]).includes(o.pen) ? (o.pen as LadoPenalti) : null
    picks.push({ id: o.id, kind: typeof o.kind === 'string' ? o.kind.slice(0, 24) : '', idx: typeof o.idx === 'number' ? o.idx : -1, pen, n: typeof o.n === 'number' ? o.n : 0 })
  }
  const bonus = typeof r.bonusOvr === 'number' && Number.isFinite(r.bonusOvr) ? Math.max(0, Math.round(r.bonusOvr)) : 0
  return {
    v: REPLAY_V,
    seed: [seed[0] as number, seed[1] as number],
    identity: { surname: id.surname, number: id.number, foot: id.foot, nationality: id.nationality, position: id.position as PlayerIdentity['position'] },
    pace: r.pace,
    picks,
    bonusOvr: bonus,
    dados: typeof r.dados === 'string' ? r.dados.slice(0, 64) : '',
  }
}
