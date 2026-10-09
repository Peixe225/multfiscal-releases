/**
 * Votação da live (pura, sem relógio próprio — quem chama passa `now`).
 *
 * Regras:
 *   - Comentário "1", "2"… (ou "#2", "opção 2", "voto 2") = 1 voto por pessoa por rodada; comentar outro
 *     número MUDA o voto.
 *   - Presente "da opção" (Rosa = 1, TikTok = 2…) soma para aquela opção: moedas × pontos por moeda.
 *   - Outro presente vai para o número que a pessoa comentou por último (se ela comentou).
 *   - Presente grande (≥ instantWinCoins, se ligado) decide na hora.
 *   - Vence quem tem mais pontos; empate → mais moedas → mais pessoas → sorteio estável pela rodada.
 */
import { sameGift } from './gifts'
import type { LiveEvent, LiveUser } from './types'

export interface VoteOption {
  id: string
  label: string
  sub?: string
}

export interface VoteRules {
  commentVotes: boolean
  commentPoints: number
  pointsPerCoin: number
  /** Presente de cada opção, pela posição (nome do presente). */
  giftBindings: string[]
  /** Presente que vale isso (ou mais) em moedas decide a rodada na hora. 0 = desligado. */
  instantWinCoins: number
  /** Presentes que não são de opção contam para o último número comentado pela pessoa. */
  unboundGiftsFollowComment: boolean
}

export interface Tally {
  points: number
  coins: number
  comments: number
  voters: number
}

export type RoundKind = 'decision' | 'identity'

export interface Round {
  id: string
  kind: RoundKind
  title: string
  subtitle?: string
  options: VoteOption[]
  startedAt: number
  endsAt: number
  extended: boolean
  tallies: Tally[]
  /** @ → opção do comentário (o voto de comentário da pessoa). */
  commentVote: Record<string, number>
  /** @ → opções em que a pessoa já pontuou (para contar pessoas por opção). */
  backers: Record<string, number[]>
  /** "@|opção" → moedas enviadas (quem presenteou continua apoiando mesmo se mudar o comentário). */
  gifted: Record<string, number>
  /** Decidida por presente grande. */
  decidedBy?: { user: LiveUser; gift: string; coins: number; option: number }
  closed: boolean
}

export const MAX_OPTIONS = 4

export function createRound(spec: { id: string; kind: RoundKind; title: string; subtitle?: string; options: VoteOption[]; seconds: number }, now: number): Round {
  const options = spec.options.slice(0, MAX_OPTIONS)
  return {
    id: spec.id,
    kind: spec.kind,
    title: spec.title,
    ...(spec.subtitle ? { subtitle: spec.subtitle } : {}),
    options,
    startedAt: now,
    endsAt: now + Math.max(5, spec.seconds) * 1000,
    extended: false,
    tallies: options.map(() => ({ points: 0, coins: 0, comments: 0, voters: 0 })),
    commentVote: {},
    backers: {},
    gifted: {},
    closed: false,
  }
}

/** "2", "#2", "2!!", "opção 2", "voto 2", "vou de 2" → índice 1. Só números de opções que existem. */
export function parseVote(text: string, n: number): number | null {
  const t = text.trim().toLowerCase()
  const m = t.match(/^(?:(?:op[cç][aã]o|opc|voto|vou de|vai|é|e)\s*)?#?\s*([1-9])(?![0-9])/)
  if (!m) return null
  const i = Number(m[1]) - 1
  return i >= 0 && i < n ? i : null
}

function back(r: Round, user: string, opt: number) {
  const list = r.backers[user] ?? []
  if (!list.includes(opt)) {
    r.backers[user] = [...list, opt]
    r.tallies[opt].voters += 1
  }
}

function unback(r: Round, user: string, opt: number) {
  const list = r.backers[user]
  if (!list?.includes(opt)) return
  r.backers[user] = list.filter((x) => x !== opt)
  r.tallies[opt].voters = Math.max(0, r.tallies[opt].voters - 1)
}

export interface ApplyResult {
  round: Round
  /** Opção que recebeu algo neste evento (para o feed). */
  option: number | null
  points: number
  /** Presente grande: a rodada acabou de ser decidida. */
  decided: boolean
}

/** Aplica um evento à rodada (imutável: devolve uma cópia quando muda). */
export function applyEvent(round: Round, ev: LiveEvent, rules: VoteRules): ApplyResult {
  const none = { round, option: null, points: 0, decided: false }
  if (round.closed) return none
  const n = round.options.length
  if (ev.type === 'chat') {
    if (!rules.commentVotes) {
      // mesmo sem comentário valendo voto, o número comentado decide para onde vão os presentes "soltos"
      const opt = parseVote(ev.text, n)
      if (opt == null || round.commentVote[ev.user.id] === opt) return none
      return { round: { ...round, commentVote: { ...round.commentVote, [ev.user.id]: opt } }, option: null, points: 0, decided: false }
    }
    const opt = parseVote(ev.text, n)
    if (opt == null) return none
    const prev = round.commentVote[ev.user.id]
    if (prev === opt) return none
    const r: Round = { ...round, tallies: round.tallies.map((t) => ({ ...t })), commentVote: { ...round.commentVote, [ev.user.id]: opt }, backers: { ...round.backers } }
    const pts = Math.max(0, rules.commentPoints)
    if (prev != null) {
      r.tallies[prev].points = Math.max(0, r.tallies[prev].points - pts)
      r.tallies[prev].comments = Math.max(0, r.tallies[prev].comments - 1)
      // só deixa de "apoiar" a opção antiga se não mandou presente nela
      if (!round.gifted[`${ev.user.id}|${prev}`]) unback(r, ev.user.id, prev)
    }
    r.tallies[opt].points += pts
    r.tallies[opt].comments += 1
    back(r, ev.user.id, opt)
    return { round: r, option: opt, points: pts, decided: false }
  }
  if (ev.type === 'gift') {
    let opt = rules.giftBindings.slice(0, n).findIndex((b) => sameGift(ev.gift, b))
    if (opt < 0 && rules.unboundGiftsFollowComment) opt = round.commentVote[ev.user.id] ?? -1
    if (opt < 0) return none
    const coins = ev.gift.coins * ev.count
    const pts = coins * Math.max(0, rules.pointsPerCoin)
    const key = `${ev.user.id}|${opt}`
    const r: Round = { ...round, tallies: round.tallies.map((t) => ({ ...t })), backers: { ...round.backers }, gifted: { ...round.gifted, [key]: (round.gifted[key] ?? 0) + coins } }
    r.tallies[opt].points += pts
    r.tallies[opt].coins += coins
    back(r, ev.user.id, opt)
    if (rules.instantWinCoins > 0 && coins >= rules.instantWinCoins) {
      r.decidedBy = { user: ev.user, gift: ev.gift.name, coins, option: opt }
      r.closed = true
      return { round: r, option: opt, points: pts, decided: true }
    }
    return { round: r, option: opt, points: pts, decided: false }
  }
  return none
}

export function totalPoints(r: Round): number {
  return r.tallies.reduce((s, t) => s + t.points, 0)
}

/** Percentuais inteiros que somam 100 (maiores restos). Sem votos → zeros. */
export function percents(r: Round): number[] {
  const total = totalPoints(r)
  if (!total) return r.tallies.map(() => 0)
  const raw = r.tallies.map((t) => (t.points / total) * 100)
  const out = raw.map(Math.floor)
  let left = 100 - out.reduce((s, x) => s + x, 0)
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left <= 0) break
    out[i] += 1
    left -= 1
  }
  return out
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Ordem do placar: pontos, moedas, pessoas. */
function better(a: Tally, b: Tally): number {
  return b.points - a.points || b.coins - a.coins || b.voters - a.voters
}

/** Índices empatados na liderança (com pelo menos 1 ponto). */
export function leaders(r: Round): number[] {
  if (!totalPoints(r)) return []
  const order = r.tallies.map((_, i) => i).sort((a, b) => better(r.tallies[a], r.tallies[b]))
  const top = r.tallies[order[0]]
  return order.filter((i) => better(r.tallies[i], top) === 0)
}

export interface Outcome {
  winner: number
  /** Como foi decidido (para o anúncio). */
  reason: 'votes' | 'instant' | 'tie-break' | 'no-votes'
}

/** Resultado final. Sem votos → sorteio estável pela rodada (a live não trava esperando o chat). */
export function decide(r: Round): Outcome {
  if (r.decidedBy) return { winner: r.decidedBy.option, reason: 'instant' }
  const top = leaders(r)
  if (!top.length) return { winner: hash(r.id) % r.options.length, reason: 'no-votes' }
  if (top.length === 1) return { winner: top[0], reason: 'votes' }
  return { winner: top[hash(r.id + ':tie') % top.length], reason: 'tie-break' }
}

/** Empate com votos no fim do tempo → prorroga uma vez (se ligado). */
export function shouldExtend(r: Round, now: number, extendOnTie: boolean): boolean {
  return extendOnTie && !r.extended && !r.closed && now >= r.endsAt && leaders(r).length > 1
}

export function extend(r: Round, seconds: number): Round {
  return { ...r, extended: true, endsAt: r.endsAt + seconds * 1000 }
}
