/**
 * Propostas, negociação, renovação, empréstimo e troca de clube no Modo Imersivo.
 *
 * Janela aberta → o empresário recebe 0–3 propostas (lógica do Clássico: faixa de força ≈ OVR,
 * localização por OVR, superempresário), com o OVR "de vitrine" ajustado pela fase e o número de
 * propostas pela fama e pela fase. Jovem pouco utilizado recebe proposta de empréstimo.
 * Contraproposta (salário/anos/papel): o clube aceita, melhora (meio-termo) ou desiste, conforme o
 * interesse (OVR × força do clube, fama, fase) e o tamanho do pedido; `roundsLeft` limita as rodadas.
 */
import type { WorldEngine } from '../api'
import type { Club, GameData } from '../types'
import { loanClubs, nonRenewalClubs, transferOffers } from '../career/offers'
import { predictRole } from '../career/player'
import type { ContractOffer, ImmersiveAction, ImmersiveEffect, ImmersiveState } from './types'
import { mem } from './mem'
import { addInbox, addNews, applyDeltas } from './media'
import { contractYears, estimateSalary, roundMoney } from './player'
import { shadowCareer } from './shadow'
import { canJoinNow, startSeason, transferNow } from './season'
import { clamp, clubLeagueId, clubOf, clubPrestige, clubStrength, formatMoney, irng, leagueById, nextId } from './util'

function roleFor(s: ImmersiveState, clubId: string, data: GameData): ContractOffer['role'] {
  const role = predictRole(s.ovr, clubStrength(s.world, data, clubId), s.identity.position)
  if (role === 'starter') return 'Titular'
  if (role === 'high_rotation') return 'Rotação'
  return s.age <= 20 ? 'Promessa' : 'Reserva'
}

function makeOffer(data: GameData, s: ImmersiveState, club: Club, kind: ContractOffer['kind'], weeks = 3): ContractOffer {
  const m = mem(s)
  const r = irng(s, 'offer', s.season, s.week, club.id, kind)
  const coef = leagueById(data, clubLeagueId(s.world, data, club.id))?.coefficient ?? 0.5
  const value = Math.max(100_000, s.marketValue)
  const years = kind === 'loan' ? 1 : contractYears(s.age)
  const yearsLeft = Math.max(0, s.finance.contractUntil - s.season)
  const salary = roundMoney(estimateSalary(value, clubPrestige(s.world, data, club.id), coef, m.superAgent ? 1.2 : 1) * r.range(0.9, 1.25))
  const offer: ContractOffer = {
    id: nextId(s, 'of'),
    clubId: club.id,
    kind,
    salary,
    years,
    role: roleFor(s, club.id, data),
    expiresWeek: s.week + weeks,
    roundsLeft: m.superAgent ? 3 : 2,
  }
  if (kind === 'transfer') offer.fee = roundMoney(value * r.range(0.9, 1.35) * (yearsLeft >= 2 ? 1 : yearsLeft === 1 ? 0.75 : 0.4))
  if (kind !== 'loan') offer.releaseClause = roundMoney(value * r.range(2.5, 4))
  if (kind !== 'loan' && salary >= 1_000_000) offer.signingBonus = roundMoney(salary * 0.1)
  const notes: Record<ContractOffer['role'], string[]> = {
    Titular: ['O técnico te quer como titular absoluto.', 'Querem montar o time em volta de você.'],
    Rotação: ['Você brigaria por posição com espaço garantido.', 'Papel importante na rotação do elenco.'],
    Reserva: ['Chegaria para compor o elenco.', 'Começaria como opção de banco.'],
    Promessa: ['Apostam no seu potencial a longo prazo.', 'Plano de desenvolvimento com minutos na equipe B.'],
  }
  offer.note = kind === 'loan' ? 'Empréstimo de uma temporada com minutos garantidos.' : r.pick(notes[offer.role])
  m.offerBase = { ...(m.offerBase ?? {}), [offer.id]: salary }
  return offer
}

/** Tipo de calendário da liga de um clube. */
function clubCalKind(data: GameData, s: ImmersiveState, clubId: string): 'split' | 'calendar' | undefined {
  const lg = leagueById(data, clubLeagueId(s.world, data, clubId))
  return lg ? (lg.calendar === 'split' ? 'split' : 'calendar') : undefined
}

/** Proposta garantida (sem clube há mais de uma janela): um clube modesto perto do nível do jogador. */
function fallbackClub(data: GameData, s: ImmersiveState, r: ReturnType<typeof irng>): Club | undefined {
  const target = s.ovr + 3
  const pool = data.clubs
    .filter((c) => !!leagueById(data, clubLeagueId(s.world, data, c.id)) && clubStrength(s.world, data, c.id) <= target + 2)
    .sort((a, b) => Math.abs(clubStrength(s.world, data, a.id) - target) - Math.abs(clubStrength(s.world, data, b.id) - target) || (a.id < b.id ? -1 : 1))
  const home = pool.filter((c) => c.country === s.identity.nationality).slice(0, 6)
  const list = home.length ? home : pool.slice(0, 8)
  return list.length ? r.pick(list) : undefined
}

function announce(data: GameData, s: ImmersiveState, o: ContractOffer, fx: ImmersiveEffect[]) {
  const name = clubOf(data, o.clubId)?.name ?? o.clubId
  const subject =
    o.kind === 'renewal' ? `${name} quer renovar` : o.kind === 'loan' ? `Empréstimo: ${name}` : o.kind === 'free_agent' ? `Proposta (sem custo): ${name}` : `Proposta: ${name}`
  const body =
    o.kind === 'renewal'
      ? `A diretoria oferece ${o.years} ${o.years === 1 ? 'ano' : 'anos'} e ${formatMoney(o.salary)}/ano. Dá para pedir mais — eles têm margem.`
      : `${name} ${o.fee ? `ofereceu ${formatMoney(o.fee)} ao clube e ` : ''}te quer como ${o.role.toLowerCase()} por ${formatMoney(o.salary)}/ano (${o.years} ${o.years === 1 ? 'ano' : 'anos'}). ${o.note ?? ''}`.trim()
  addInbox(s, 'Seu empresário', subject, body, { offerId: o.id })
  void fx
}

/** Propostas que chegam quando a janela abre. */
export function windowOffers(data: GameData, s: ImmersiveState, fx: ImmersiveEffect[]): ContractOffer[] {
  const m = mem(s)
  const r = irng(s, 'window', s.season, s.week)
  const out: ContractOffer[] = []
  const shownOvr = clamp(Math.round(s.ovr + (s.condition.form - 50) / 20), 40, 99)
  const shadow = shadowCareer(s, { ovr: shownOvr })
  if (!s.clubId) {
    const clubs = [...nonRenewalClubs(data, shadow, r, 2), ...transferOffers(data, shadow, r, { count: 1 })]
    const seen = new Set<string>()
    for (const c of clubs) if (!seen.has(c.id)) (seen.add(c.id), out.push(makeOffer(data, s, c, 'free_agent', 4)))
    // sem clube e sem propostas de novo: o empresário arruma um clube modesto
    if (!out.length && !s.offers.length && (m.freeAgentTries ?? 0) >= 1) {
      const c = fallbackClub(data, s, r)
      if (c) out.push(makeOffer(data, s, c, 'free_agent', 4))
    }
    m.freeAgentTries = out.length ? 0 : (m.freeAgentTries ?? 0) + 1
  } else {
    const minutesShare = s.seasonStats.minutes / Math.max(1, m.clubMatches * 90)
    const want = clamp(0.3 + s.reputation / 35 + (s.condition.form - 55) / 30 + (m.superAgent ? 1 : 0) + m.offerBoost / 3 + r.range(-0.6, 0.6), 0, 3.4)
    const n = Math.floor(want)
    if (n > 0) {
      const clubs = transferOffers(data, shadow, r, { count: n, bandShift: m.offerBoost + (m.superAgent ? 2 : 0) })
      for (const c of clubs) out.push(makeOffer(data, s, c, 'transfer'))
    }
    m.offerBoost = 0
    const lowMinutes = m.clubMatches >= 6 ? minutesShare < 0.25 : s.seasons.length > 0 && (s.seasons[s.seasons.length - 1].stats.minutes ?? 0) < 900
    if (s.age <= 21 && lowMinutes && !m.loan && r.chance(0.7)) {
      const loans = loanClubs(data, shadow, r, 1, out.map((o) => o.clubId))
      if (loans?.length) out.push(makeOffer(data, s, loans[0], 'loan'))
    }
    const renewal = renewalOffer(data, s)
    if (renewal) out.push(renewal)
    // janela de meio da temporada europeia (dezembro): a temporada de ano civil já acabou — sem
    // propostas desses clubes (a transferência cairia num calendário encerrado)
    if (m.calKind === 'split' && s.week >= 20) {
      for (let i = out.length - 1; i >= 0; i--) if (out[i].kind !== 'renewal' && clubCalKind(data, s, out[i].clubId) === 'calendar') out.splice(i, 1)
    }
  }
  for (const o of out) announce(data, s, o, fx)
  s.offers = [...s.offers.filter((o) => !out.some((x) => x.clubId === o.clubId && x.kind === o.kind)), ...out]
  if (out.length) fx.push({ type: 'toast', tone: 'gold', title: 'Janela aberta', description: `${out.length} ${out.length === 1 ? 'proposta chegou' : 'propostas chegaram'} na caixa de entrada.` })
  return out
}

/** Renovação: último ano de contrato (ou extensão para quem cresceu). */
export function renewalOffer(data: GameData, s: ImmersiveState): ContractOffer | null {
  const m = mem(s)
  if (!s.clubId || m.loan) return null
  if (s.offers.some((o) => o.kind === 'renewal')) return null
  const left = s.finance.contractUntil - s.season
  const str = clubStrength(s.world, data, s.clubId)
  const club = clubOf(data, s.clubId)
  if (!club) return null
  const wants = s.relationships.coach >= 38 && s.ovr >= str - 9 && s.age <= 35
  if (left <= 0) {
    if (!wants) {
      if (m.noRenewal !== s.season) {
        m.noRenewal = s.season
        addInbox(s, 'Diretoria', 'Sem renovação', `A diretoria do ${club.shortName} comunicou que não pretende renovar seu contrato, que termina ao fim da temporada.`)
      }
      return null
    }
  } else if (!(left === 1 && s.ovr >= str + 2)) return null
  const o = makeOffer(data, s, club, 'renewal', 8)
  o.salary = roundMoney(Math.max(o.salary, s.finance.salary * 1.1))
  return o
}

// ───────────────────────── resposta e negociação ─────────────────────────

export function respondOffer(
  W: WorldEngine,
  data: GameData,
  s: ImmersiveState,
  a: Extract<ImmersiveAction, { type: 'offer_respond' }>,
  fx: ImmersiveEffect[],
): boolean {
  const o = s.offers.find((x) => x.id === a.offerId)
  if (!o) return false
  if (a.response !== 'accept' && a.response !== 'reject' && a.response !== 'counter') return false
  const club = clubOf(data, o.clubId)
  const name = club?.name ?? o.clubId
  if (a.response === 'reject') {
    s.offers = s.offers.filter((x) => x.id !== o.id)
    if (o.kind === 'renewal') applyDeltas(s, { coach: -3, fans: -2 })
    addInbox(s, 'Seu empresário', `Proposta recusada: ${name}`, 'Avisei o clube. Seguimos atentos ao mercado.')
    fx.push({ type: 'toast', tone: 'info', title: 'Proposta recusada', description: name })
    return true
  }
  if (a.response === 'counter') return counter(data, s, o, a.counter ?? {}, fx)
  // aceitar
  s.offers = s.offers.filter((x) => x.id !== o.id)
  if (o.kind === 'renewal') {
    s.finance.salary = o.salary
    s.finance.contractUntil = s.season + o.years
    if (o.releaseClause) s.finance.releaseClause = o.releaseClause
    if (o.signingBonus) s.finance.balance += o.signingBonus
    applyDeltas(s, { coach: 3, fans: 3, morale: 4 })
    s.log.push({ season: s.season, age: s.age, type: 'decision', text: `Renovou com o ${club?.shortName ?? name} até ${s.finance.contractUntil}.` })
    addNews(s, `${s.identity.surname} renova com o ${club?.shortName ?? name} até ${s.finance.contractUntil}`, 'positive', fx)
    fx.push({ type: 'toast', tone: 'success', title: 'Contrato renovado', description: `Até ${s.finance.contractUntil} · ${formatMoney(o.salary)}/ano` })
    return true
  }
  // transferência / livre / empréstimo: as outras propostas caem (joinClub limpa a lista)
  joinClub(W, data, s, o, fx)
  return true
}

const ROLES: ContractOffer['role'][] = ['Promessa', 'Reserva', 'Rotação', 'Titular']

/**
 * Contraproposta. Entradas validadas (salário finito > 0, anos inteiros 1–5, papel conhecido; em
 * empréstimo só o salário) — inválida = ação recusada. O clube tem um TETO de salário (≈ 1,2–1,5× a
 * oferta original, conforme o interesse): acima dele nunca aceita; "melhorar" fica cada vez menos
 * provável quanto maior o pedido (0,4 × (1 − 2·(pedido/oferta − 1))) e nunca passa do teto.
 */
function counter(data: GameData, s: ImmersiveState, o: ContractOffer, c: { salary?: number; years?: number; role?: ContractOffer['role'] }, fx: ImmersiveEffect[]): boolean {
  const m = mem(s)
  if (c.salary !== undefined && (typeof c.salary !== 'number' || !Number.isFinite(c.salary) || c.salary <= 0)) return false
  if (c.years !== undefined && (typeof c.years !== 'number' || !Number.isInteger(c.years) || c.years < 1 || c.years > 5)) return false
  if (c.role !== undefined && !ROLES.includes(c.role)) return false
  if (o.kind === 'loan' && c.years !== undefined && c.years !== o.years) return false
  const name = clubOf(data, o.clubId)?.name ?? o.clubId
  if (o.roundsLeft <= 0) {
    fx.push({ type: 'toast', tone: 'danger', title: 'Sem margem', description: `${name} disse que a proposta é final.` })
    return true
  }
  const r = irng(s, 'counter', o.id, o.roundsLeft)
  const str = clubStrength(s.world, data, o.clubId)
  const interest = clamp(0.55 + (s.ovr - str) * 0.04 + (s.reputation - 30) / 150 + (s.condition.form - 50) / 150 + (o.kind === 'renewal' ? 0.1 : 0), 0.1, 0.95)
  const base = m.offerBase?.[o.id] ?? o.salary
  const ceiling = roundMoney(base * (1.2 + 0.3 * interest))
  const askSalary = roundMoney(Math.max(o.salary, c.salary ?? o.salary))
  const ratio = askSalary / Math.max(1, o.salary)
  const maxYears = Math.min(5, Math.max(o.years, contractYears(s.age) + 1))
  const years = c.years ?? o.years
  const roleGap = c.role ? Math.max(0, ROLES.indexOf(c.role) - ROLES.indexOf(o.role)) : 0
  let pAccept = clamp(interest * 1.1 - (ratio - 1) * 2.2 - Math.abs(years - o.years) * 0.08 - Math.max(0, years - maxYears) * 0.3 - roleGap * 0.15, 0, 0.95)
  if (askSalary > ceiling) pAccept = 0
  const pImprove = o.salary >= ceiling ? 0 : 0.4 * Math.max(0, 1 - (ratio - 1) * 2)
  const u = r.next()
  o.roundsLeft--
  if (u < pAccept) {
    o.salary = askSalary
    o.years = years
    if (c.role) o.role = c.role
    o.note = 'Aceitaram sua contraproposta! Falta só a sua assinatura.'
    o.expiresWeek = Math.max(o.expiresWeek, s.week + 2)
    addInbox(s, 'Seu empresário', `${name} aceitou!`, `Fechamos em ${formatMoney(o.salary)}/ano por ${o.years} ${o.years === 1 ? 'ano' : 'anos'}${c.role ? ` como ${c.role.toLowerCase()}` : ''}. É só assinar.`, { offerId: o.id })
    fx.push({ type: 'toast', tone: 'success', title: 'Contraproposta aceita', description: name })
  } else if (u < pAccept + pImprove) {
    o.salary = roundMoney(Math.min(ceiling, o.salary + (askSalary - o.salary) * 0.5))
    o.years = clamp(Math.round((o.years + Math.min(years, maxYears)) / 2), 1, 5)
    o.note = o.roundsLeft > 0 ? 'O clube melhorou a oferta.' : 'Oferta final do clube.'
    addInbox(s, 'Seu empresário', `${name} melhorou a proposta`, `Subiram para ${formatMoney(o.salary)}/ano (${o.years} ${o.years === 1 ? 'ano' : 'anos'}). ${o.roundsLeft > 0 ? 'Ainda dá para apertar um pouco.' : 'Disseram que é a última oferta.'}`, { offerId: o.id })
    fx.push({ type: 'toast', tone: 'info', title: 'Proposta melhorada', description: `${name} · ${formatMoney(o.salary)}/ano` })
  } else {
    s.offers = s.offers.filter((x) => x.id !== o.id)
    if (o.kind === 'renewal') applyDeltas(s, { coach: -2 })
    addInbox(s, 'Seu empresário', `${name} desistiu`, 'Pedimos demais e eles saíram da negociação. Faz parte.')
    fx.push({ type: 'toast', tone: 'danger', title: 'Negociação encerrada', description: `${name} desistiu.` })
  }
  return true
}

type JoinSpec = Pick<ContractOffer, 'clubId' | 'kind' | 'salary' | 'years' | 'fee' | 'signingBonus' | 'releaseClause' | 'role'>

/** Contrato, finanças, relações, log e notícias da assinatura (sem mexer no calendário). */
export function signContract(data: GameData, s: ImmersiveState, o: JoinSpec, fx: ImmersiveEffect[]): void {
  const m = mem(s)
  const club = clubOf(data, o.clubId)
  const old = s.clubId
  const name = club?.name ?? o.clubId
  const loan = o.kind === 'loan'
  if (loan) {
    m.loan = { parentClubId: old ?? o.clubId, untilSeason: s.week <= 2 ? s.season : s.season + (m.calKind === 'split' ? 0 : 1) }
    s.parentClubId = old ?? undefined
  } else {
    m.loan = undefined
    s.parentClubId = undefined
    s.finance.salary = o.salary
    s.finance.contractUntil = s.season + Math.max(1, o.years) - (s.week <= 2 ? 1 : 0)
    if (o.releaseClause) s.finance.releaseClause = o.releaseClause
    if (o.signingBonus) s.finance.balance += o.signingBonus
  }
  if (!m.firstClubId) m.firstClubId = o.clubId
  m.seasonsAtClub = 0
  m.freeAgentTries = 0
  if (m.captainAt !== o.clubId) {
    s.captain = false
    m.captainAt = null
  }
  const coach = o.role === 'Titular' ? 62 : o.role === 'Rotação' ? 52 : 44
  s.relationships.coach = coach
  s.relationships.teammates = 50
  s.relationships.fans = clamp(40 + s.reputation * 0.3, 30, 80)
  const how = old ? (loan ? 'loan_started' : 'joined') : 'joined'
  s.log.push({
    season: s.season,
    age: s.age,
    type: how,
    text: loan ? `Empréstimo: ${name}.` : old ? `Novo clube: ${name}${o.fee ? ` (${formatMoney(o.fee)})` : ''}.` : s.seasons.length ? `Assinou com o ${name}.` : `Começou na base: ${name}.`,
    data: { clubId: o.clubId, parentClubId: loan ? old : undefined },
  })
  addNews(s, loan ? `${s.identity.surname} é emprestado ao ${club?.shortName ?? name}` : old ? `${club?.shortName ?? name} anuncia ${s.identity.surname}${o.fee ? ` por ${formatMoney(o.fee)}` : ''}` : `${club?.shortName ?? name} aposta em ${s.identity.surname}, ${s.age} anos`, 'positive', fx, { clubId: o.clubId })
  addInbox(s, 'Diretoria', `Bem-vindo ao ${club?.shortName ?? name}`, `Contrato ${loan ? 'de empréstimo até o fim da temporada' : `até ${s.finance.contractUntil}`}, salário de ${formatMoney(s.finance.salary)}/ano. Honre a camisa.`)
  fx.push({ type: 'transfer', clubId: o.clubId, fee: o.fee })
  s.offers = []
  s.clubId = o.clubId
}

/**
 * Assina com o clube da proposta (transferência, livre ou empréstimo). Clube de outro calendário cuja
 * liga já acabou nesta temporada do mundo (Europa → Brasil em dezembro): acerto fechado agora,
 * apresentação na pré-temporada seguinte (`m.deferredJoin`).
 */
export function joinClub(W: WorldEngine, data: GameData, s: ImmersiveState, o: JoinSpec, fx: ImmersiveEffect[]): void {
  const m = mem(s)
  const old = s.clubId
  const fresh = !old || !s.calendar.length || s.calendar.every((it) => it.kind === 'transfer_window')
  if (!fresh && !canJoinNow(W, data, s, o.clubId)) {
    const club = clubOf(data, o.clubId)
    m.deferredJoin = { clubId: o.clubId, kind: o.kind === 'renewal' ? 'transfer' : o.kind, salary: o.salary, years: o.years, fee: o.fee, role: o.role, releaseClause: o.releaseClause, signingBonus: o.signingBonus }
    s.offers = []
    s.log.push({ season: s.season, age: s.age, type: 'decision', text: `Acertou com o ${club?.shortName ?? o.clubId}: apresentação na próxima pré-temporada.`, data: { clubId: o.clubId } })
    addNews(s, `${s.identity.surname} acerta com o ${club?.shortName ?? o.clubId} e se apresenta na próxima temporada`, 'positive', fx, { clubId: o.clubId })
    addInbox(s, 'Seu empresário', `Acerto fechado com o ${club?.shortName ?? o.clubId}`, 'A temporada de lá já terminou: você termina esta temporada onde está e se apresenta na pré-temporada.')
    fx.push({ type: 'toast', tone: 'gold', title: 'Acerto fechado', description: `${club?.shortName ?? o.clubId} · a partir da próxima temporada` })
    return
  }
  const wasWindow = s.calendar[s.cursor]?.kind === 'transfer_window'
  signContract(data, s, o, fx)
  if (fresh) {
    // sem clube (base / livre): monta a temporada inteira agora
    startSeason(W, data, s)
    if (wasWindow || old === null) {
      const w = s.calendar.findIndex((it) => it.kind === 'transfer_window' && it.week === s.week)
      if (w >= 0 && w === s.cursor) {
        s.calendar[w].done = true
        s.cursor = w + 1
      }
    }
  } else {
    transferNow(W, data, s, o.clubId)
  }
}
