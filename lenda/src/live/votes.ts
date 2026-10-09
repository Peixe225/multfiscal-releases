/**
 * Votação da live (pura, sem relógio próprio — quem chama passa `now`).
 *
 * Regras:
 *   - Comentário "1", "2"… (ou "#2", "opção 2", "voto 2") = 1 voto por pessoa por rodada; comentar outro
 *     número MUDA o voto.
 *   - Presente "da opção" (Rosa = 1, TikTok = 2…) soma para aquela opção: moedas × pontos por moeda.
 *   - Outro presente vale para o número que a pessoa comentou nesta votação; se ela ainda não comentou,
 *     fica guardado e passa a valer assim que ela comentar um número (antes do fim da votação).
 *   - Presente grande (≥ instantWinCoins, se ligado) decide na hora (o guardado também, quando passa a valer).
 *   - Vence quem tem mais pontos; empate → mais moedas → mais pessoas → sorteio estável pela rodada.
 *   - No máximo 4 opções por votação (MAX_OPTIONS; ver fitOptions).
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
  /** Presentes que não são de opção contam para o número comentado pela pessoa nesta votação (guardados até ela comentar). */
  unboundGiftsFollowComment: boolean
}

/** Presente "solto" de quem ainda não comentou um número nesta votação (somado por presente). */
export interface PendingGift {
  user: LiveUser
  gift: string
  /** Moedas somadas deste presente. */
  coins: number
  /** Unidades somadas. */
  units: number
  /** Maior envio de uma vez (para o "presente que decide na hora"). */
  top: number
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
  /** @ → opção do comentário (o número que a pessoa comentou por último nesta votação). */
  commentVote: Record<string, number>
  /** @ → onde o comentário da pessoa está pontuando (com "comentário vale voto" ligado) e quanto. */
  scored: Record<string, { option: number; points: number }>
  /** @ → opções em que a pessoa já pontuou (para contar pessoas por opção). */
  backers: Record<string, number[]>
  /** "@|opção" → moedas enviadas (quem presenteou continua apoiando mesmo se mudar o comentário). */
  gifted: Record<string, number>
  /** @ → presentes soltos guardados até a pessoa comentar um número. */
  pendingGifts: Record<string, PendingGift[]>
  /** Decidida por presente grande. */
  decidedBy?: { user: LiveUser; gift: string; coins: number; option: number }
  closed: boolean
}

export const MAX_OPTIONS = 4

const OFFER_ID = /^(?:transfer|loan|academy)-/

/**
 * Até MAX_OPTIONS opções para a votação (a tela tem 4 cores/presentes). Com mais que isso, ficam as que não
 * são proposta de clube (ficar, aposentar-se…) e as primeiras propostas, na ordem original. Quem chama mapeia
 * o vencedor pelo índice nesta mesma lista.
 */
export function fitOptions<T extends { id: string }>(options: T[], max = MAX_OPTIONS): T[] {
  if (options.length <= max) return options
  const keep = new Set(options.filter((o) => !OFFER_ID.test(o.id)).slice(0, max))
  for (const o of options) {
    if (keep.size >= max) break
    keep.add(o)
  }
  return options.filter((o) => keep.has(o))
}

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
    scored: {},
    backers: {},
    gifted: {},
    pendingGifts: {},
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
  /** Presente solto guardado: a pessoa ainda não comentou um número nesta votação. */
  held?: boolean
  /** Presentes guardados que passaram a valer com este comentário (somados). */
  released?: { coins: number; units: number; points: number }
}

/** Cópia da rodada que pode ser alterada (tabelas copiadas). */
function draftOf(round: Round): Round {
  return { ...round, tallies: round.tallies.map((t) => ({ ...t })), commentVote: { ...round.commentVote }, scored: { ...round.scored }, backers: { ...round.backers }, gifted: { ...round.gifted }, pendingGifts: { ...round.pendingGifts } }
}

/** Soma `coins` de presente na opção (em uma cópia). Devolve os pontos. */
function addGift(r: Round, user: string, opt: number, coins: number, rules: VoteRules): number {
  const pts = coins * Math.max(0, rules.pointsPerCoin)
  const key = `${user}|${opt}`
  r.gifted[key] = (r.gifted[key] ?? 0) + coins
  r.tallies[opt].points += pts
  r.tallies[opt].coins += coins
  back(r, user, opt)
  return pts
}

const instant = (rules: VoteRules, coins: number) => rules.instantWinCoins > 0 && coins >= rules.instantWinCoins

/** A pessoa comentou `opt`: os presentes guardados dela passam a valer (e podem decidir na hora). */
function release(r: Round, user: string, opt: number, rules: VoteRules): { released?: ApplyResult['released']; decided: boolean } {
  const list = r.pendingGifts[user]
  if (!list?.length) return { decided: false }
  delete r.pendingGifts[user]
  const released = { coins: 0, units: 0, points: 0 }
  let decided = false
  for (const g of list) {
    released.points += addGift(r, user, opt, g.coins, rules)
    released.coins += g.coins
    released.units += g.units
    if (!decided && instant(rules, g.top)) {
      r.decidedBy = { user: g.user, gift: g.gift, coins: g.top, option: opt }
      r.closed = true
      decided = true
    }
  }
  return { released, decided }
}

/** Aplica um evento à rodada (imutável: devolve uma cópia quando muda). */
export function applyEvent(round: Round, ev: LiveEvent, rules: VoteRules): ApplyResult {
  const none = { round, option: null, points: 0, decided: false }
  if (round.closed) return none
  const n = round.options.length
  // rodada criada antes destes campos existirem (ex.: estado retomado)
  if (!round.pendingGifts || !round.scored) round = { ...round, pendingGifts: round.pendingGifts ?? {}, scored: round.scored ?? {} }
  if (ev.type === 'chat') {
    const user = ev.user.id
    const opt = parseVote(ev.text, n)
    if (opt == null) return none
    const had = round.scored[user]
    // pontua só quando a regra está ligada e o voto mudou (a regra pode mudar no meio da votação)
    const score = rules.commentVotes && had?.option !== opt
    if (round.commentVote[user] === opt && !score) return none
    const r = draftOf(round)
    r.commentVote[user] = opt
    let pts = 0
    if (score) {
      if (had) {
        r.tallies[had.option].points = Math.max(0, r.tallies[had.option].points - had.points)
        r.tallies[had.option].comments = Math.max(0, r.tallies[had.option].comments - 1)
        // só deixa de "apoiar" a opção antiga se não mandou presente nela
        if (!round.gifted[`${user}|${had.option}`]) unback(r, user, had.option)
      }
      pts = Math.max(0, rules.commentPoints)
      r.tallies[opt].points += pts
      r.tallies[opt].comments += 1
      r.scored[user] = { option: opt, points: pts }
      back(r, user, opt)
    }
    // mesmo sem comentário valendo voto, o número comentado decide para onde vão os presentes "soltos"
    const { released, decided } = rules.unboundGiftsFollowComment ? release(r, user, opt, rules) : { decided: false }
    const option = score || released ? opt : null
    return { round: r, option, points: pts + (released?.points ?? 0), decided, ...(released ? { released } : {}) }
  }
  if (ev.type === 'gift') {
    const coins = ev.gift.coins * ev.count
    let opt = rules.giftBindings.slice(0, n).findIndex((b) => sameGift(ev.gift, b))
    if (opt < 0) {
      if (!rules.unboundGiftsFollowComment) return none
      opt = round.commentVote[ev.user.id] ?? -1
      if (opt < 0) {
        // ainda não comentou um número nesta votação: guarda até ele comentar
        if (coins <= 0) return none
        const list = round.pendingGifts[ev.user.id] ?? []
        const i = list.findIndex((g) => g.gift === ev.gift.name)
        const next =
          i >= 0
            ? list.map((g, j) => (j === i ? { ...g, user: { ...g.user, ...ev.user }, coins: g.coins + coins, units: g.units + ev.count, top: Math.max(g.top, coins) } : g))
            : [...list, { user: ev.user, gift: ev.gift.name, coins, units: ev.count, top: coins }]
        return { round: { ...round, pendingGifts: { ...round.pendingGifts, [ev.user.id]: next } }, option: null, points: 0, decided: false, held: true }
      }
    }
    const r = draftOf(round)
    const pts = addGift(r, ev.user.id, opt, coins, rules)
    if (instant(rules, coins)) {
      r.decidedBy = { user: ev.user, gift: ev.gift.name, coins, option: opt }
      r.closed = true
      return { round: r, option: opt, points: pts, decided: true }
    }
    return { round: r, option: opt, points: pts, decided: false }
  }
  return none
}

/** Moedas guardadas de quem ainda não comentou um número (somadas). */
export function pendingCoins(r: Round): number {
  let sum = 0
  for (const list of Object.values(r.pendingGifts ?? {})) for (const g of list) sum += g.coins
  return sum
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
  /**
   * Empate nos pontos ('tie-break'): quem desempatou — 'coins' (mais moedas), 'voters' (mais pessoas)
   * ou 'draw' (empate total: sorteio).
   */
  tieBy?: 'coins' | 'voters' | 'draw'
}

/** Resultado final. Sem votos → sorteio estável pela rodada (a live não trava esperando o chat). */
export function decide(r: Round): Outcome {
  if (r.decidedBy) return { winner: r.decidedBy.option, reason: 'instant' }
  const top = leaders(r)
  if (!top.length) return { winner: hash(r.id) % r.options.length, reason: 'no-votes' }
  const best = Math.max(...r.tallies.map((t) => t.points))
  const tied = r.tallies.map((t, i) => (t.points === best ? i : -1)).filter((i) => i >= 0)
  if (tied.length === 1) return { winner: top[0], reason: 'votes' }
  if (top.length > 1) return { winner: top[hash(r.id + ':tie') % top.length], reason: 'tie-break', tieBy: 'draw' }
  // empate nos pontos: decidiu nas moedas, ou (moedas iguais) no número de pessoas
  const maxCoins = Math.max(...tied.map((i) => r.tallies[i].coins))
  const byCoins = tied.filter((i) => r.tallies[i].coins === maxCoins).length === 1
  return { winner: top[0], reason: 'tie-break', tieBy: byCoins ? 'coins' : 'voters' }
}

/** Empate com votos no fim do tempo → prorroga uma vez (se ligado). */
export function shouldExtend(r: Round, now: number, extendOnTie: boolean): boolean {
  return extendOnTie && !r.extended && !r.closed && now >= r.endsAt && leaders(r).length > 1
}

export function extend(r: Round, seconds: number): Round {
  return { ...r, extended: true, endsAt: r.endsAt + seconds * 1000 }
}
