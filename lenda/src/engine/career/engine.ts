/**
 * Motor da carreira do modo Clássico: `createCareerEngine(world)`.
 *
 * Fluxo de `choose` (Copero `ql`): aplica a opção (clube, empréstimo, evento com resultado
 * sorteado) → simula o período (1/2/3 temporadas, uma linha por temporada) → sequências de
 * banco → volta de empréstimo → aposentadoria aos 40 → próxima decisão (Copero `$l`).
 */
import type { CareerEngine, RevealScript, WorldEngine } from '../api'
import { rng } from '../rng'
import type {
  CareerLogEntry,
  CareerState,
  Club,
  Decision,
  DecisionOption,
  GameData,
  Pace,
  PlayerIdentity,
  TrophyWin,
} from '../types'
import { detectAchievements } from './achievements'
import { ENGINE_VERSION, PACES, RETIREMENT_AGE, START_AGE, START_OVR, START_SEASON, START_VALUE } from './constants'
import { assembleDecision, planEventSlots, tryEventDecision } from './events/runtime'
import type { BuiltEvent, EffectSpec, EventOption, OptionSpec, OutcomeSpec } from './events/types'
import { emptyPeriod, mem, newMemory, type CareerMemory } from './memory'
import {
  academyClubs,
  clubCard,
  loanClubs,
  nonRenewalClubs,
  signingSalary,
  transferOffers,
} from './offers'
import { clampOvr, contractYears, isBenchRole, isPlayingRole, predictRole, roleFromDelta, roundMoney } from './player'
import { playSeason } from './season'
import { summarize } from './summary'
import { clubArticle, clubStrength, indexData, withArticle } from './util'

// ───────────────────────── helpers de estado ─────────────────────────

/** Clona tudo menos o mundo (o WorldEngine é puro e devolve um mundo novo). */
export function cloneState(st: CareerState): CareerState {
  const { world, ...rest } = st
  const c = structuredClone(rest) as CareerState
  c.world = world
  return c
}

function developmentProfile(seed: string, identity: PlayerIdentity): CareerState['devProfile'] {
  if (identity.position === 'GOL') return 'normal'
  const v = rng(seed, 'development-profile').next()
  return v < 0.1 ? 'early' : v < 0.2 ? 'late' : 'normal'
}

function consecutiveSeasonsAt(s: CareerState, clubId: string | null): number {
  if (!clubId) return 0
  let n = 0
  for (let i = s.seasons.length - 1; i >= 0; i--) {
    const r = s.seasons[i]
    if (r.clubId === clubId) n++
    else if (!r.loan) break
  }
  return n
}

function clubOf(data: GameData, id: string | null | undefined): Club | undefined {
  return id ? indexData(data).club.get(id) : undefined
}

// ───────────────────────── opções comuns ─────────────────────────

const plain = (summary: string): OutcomeSpec[] => [{ p: 1, kind: 'neutral', fx: {}, summary }]

function joinOpt(data: GameData, s: CareerState, club: Club, id: string, label: string, type: OptionSpec['type'] = 'join', loan = false): EventOption {
  return {
    option: clubCard(data, s, club, id, label, { loan }),
    spec: { type, optionKey: type, clubId: club.id, outcomes: plain(`${label} ${club.name}.`) },
  }
}

function stayOpt(data: GameData, s: CareerState, club: Club): EventOption {
  return {
    option: clubCard(data, s, club, `stay-${club.id}`, `Ficar ${withArticle('em', club)}`),
    spec: { type: 'stay', optionKey: 'stay', clubId: club.id, outcomes: plain(`Seguiu ${withArticle('em', club)} ${club.name}.`) },
  }
}

function retireOpt(s: CareerState, reason: string): EventOption {
  const option: DecisionOption = {
    id: `retire-${mem(s).step + 1}`,
    label: '',
    title: 'Aposentar-se',
    art: 'retirement',
    effects: [{ kind: 'fixed', label: 'Encerrar a carreira profissional' }],
  }
  return { option, spec: { type: 'retire', optionKey: 'retire', outcomes: plain('Aposentou-se.'), retireReason: reason } }
}

// ───────────────────────── decisões ─────────────────────────

function academyDecision(data: GameData, s: CareerState): Decision {
  const clubs = academyClubs(data, s, rng(s.seed, 'academy'))
  const built: BuiltEvent = {
    title: 'Oferta da base',
    description: 'Três clubes querem você nas categorias de base. Escolha onde a sua história começa.',
    options: clubs.map((c) => joinOpt(data, s, c, `academy-${c.id}`, 'Assinar com')),
  }
  return assembleDecision(s, 'academy', built)
}

function transferDecision(data: GameData, s: CareerState, reason?: 'suspended'): Decision {
  const m = mem(s)
  const r = rng(s.seed, 'transfer', m.step)
  const offers = transferOffers(data, s, r, { count: m.superAgent ? 3 : 2, bandShift: m.offerBoost + (m.superAgent ? 2 : 0) })
  m.offerBoost = 0
  const current = clubOf(data, s.clubId)
  const options: EventOption[] = offers.map((c) => joinOpt(data, s, c, `transfer-${c.id}`, 'Assinar com'))
  if (current) options.push(stayOpt(data, s, current))
  const canRetire = (offers.length === 0 && s.age >= 34) || s.age >= 36
  if (canRetire) options.push(retireOpt(s, 'voluntary'))
  let description = offers.length
    ? 'Chegaram propostas. Aceite uma delas ou continue no clube.'
    : canRetire
      ? 'Nenhuma proposta apareceu. Dá para seguir no clube ou pendurar as chuteiras.'
      : 'Nenhuma proposta apareceu desta vez. Você segue no clube.'
  if (reason === 'suspended') description = `Você ainda cumpre suspensão. ${description}`
  return assembleDecision(s, 'transfer', { title: 'Janela de transferências', description, options }, { context: { reason } })
}

function loanDecision(data: GameData, s: CareerState, clubs: Club[]): Decision {
  const options = clubs.map((c) => joinOpt(data, s, c, `loan-${c.id}`, 'Ir por empréstimo para', 'loan', true))
  const current = clubOf(data, s.clubId)
  // melhora: o Copero obrigava a sair; aqui dá para ficar e brigar por espaço
  if (current) options.push(stayOpt(data, s, current))
  return assembleDecision(s, 'loan', {
    title: 'Oferta de empréstimo',
    description: 'Seu clube quer que você ganhe minutos em outro time. Escolha onde seguir se desenvolvendo.',
    options,
  })
}

function loanReturnDecision(data: GameData, s: CareerState): Decision | null {
  const m = mem(s)
  const cl = m.completedLoan
  if (!cl) return null
  const parent = clubOf(data, cl.parentClubId)
  const loanClub = clubOf(data, cl.loanClubId)
  if (!parent) return null
  const role = predictRole(s.ovr, clubStrength(s.world, parent), s.identity.position)
  const r = rng(s.seed, 'loan-return', m.step)
  if (isPlayingRole(role)) {
    const offers = transferOffers(data, s, r, { count: 2 })
    const options = offers.map((c) => joinOpt(data, s, c, `transfer-${c.id}`, 'Assinar com'))
    options.push(stayOpt(data, s, parent))
    return assembleDecision(s, 'loan_return', {
      title: 'Volta ao clube',
      description: `O empréstimo acabou e ${clubArticle(parent)} ${parent.shortName} conta com você. Se ainda quiser sair, há propostas na mesa.`,
      options,
    }, { context: { retained: true } })
  }
  const options: EventOption[] = []
  const loans = s.age <= 24 ? loanClubs(data, s, r, 2, [cl.loanClubId]) : null
  if (loans) for (const c of loans) options.push(joinOpt(data, s, c, `loan-${c.id}`, 'Ir por empréstimo para', 'loan', true))
  if (loanClub) options.push(joinOpt(data, s, loanClub, `permanent-${loanClub.id}`, 'Assinar em definitivo com', 'permanent'))
  if (!loans) for (const c of transferOffers(data, s, r, { count: 1, exclude: [cl.loanClubId] })) options.push(joinOpt(data, s, c, `transfer-${c.id}`, 'Assinar com'))
  options.push(stayOpt(data, s, parent))
  return assembleDecision(s, 'loan_return', {
    title: 'Volta ao clube',
    description: `O empréstimo acabou, mas ${clubArticle(parent)} ${parent.shortName} não conta com você. Dá para sair de novo, ficar de vez onde estava ou brigar por espaço.`,
    options,
  }, { context: { retained: false } })
}

function nonRenewalDue(s: CareerState): boolean {
  const cfg = PACES[s.pace]
  return s.age >= 26 && !mem(s).loan && (s.streaks.lowRole >= cfg.lowRotationBeforeNonRenewal || s.streaks.substitute >= cfg.substituteBeforeNonRenewal)
}

function noOffersDecision(s: CareerState): Decision {
  return assembleDecision(s, 'retirement', {
    title: 'Sem propostas',
    description: 'Nenhum clube quer te oferecer um contrato. É hora de pendurar as chuteiras.',
    options: [retireOpt(s, 'no_offers')],
  })
}

function nonRenewalDecision(data: GameData, s: CareerState): Decision | null {
  const m = mem(s)
  const clubs = nonRenewalClubs(data, s, rng(s.seed, 'non-renewal', m.step), s.age < 32 ? 3 : 2)
  if (!clubs.length) return s.age >= 32 ? noOffersDecision(s) : null
  const options = clubs.map((c) => joinOpt(data, s, c, `non-renewal-${c.id}`, 'Assinar com'))
  if (s.age >= 32) options.push(retireOpt(s, 'voluntary'))
  return assembleDecision(s, 'non_renewal', {
    title: 'Fim de ciclo',
    description: 'O clube decidiu não renovar o seu contrato. Escolha o próximo passo da carreira.',
    options,
  })
}

/** Próxima decisão, na ordem do Copero: suspensão → volta de empréstimo → fim de ciclo → evento → empréstimo × janela. */
export function nextDecision(data: GameData, s: CareerState): Decision | null {
  if (s.retired) return null
  const m = mem(s)
  if ((s.modifiers.suspendedSeasons ?? 0) > 0) return transferDecision(data, s, 'suspended')
  if (m.completedLoan) {
    const d = loanReturnDecision(data, s)
    if (d) return d
    m.completedLoan = null
  }
  if (nonRenewalDue(s)) {
    const d = nonRenewalDecision(data, s)
    if (d) return d
  }
  const ev = tryEventDecision(data, s)
  if (ev) return ev
  const contract = clubOf(data, s.parentClubId ?? s.clubId)
  if (contract && !m.loan && s.age >= 18 && s.age <= 24) {
    const role = predictRole(s.ovr, clubStrength(s.world, contract), s.identity.position)
    if (isBenchRole(role)) {
      const w = role === 'low_rotation' ? 30 : 70
      if (rng(s.seed, 'loan-or-transfer', m.step).chance(w / 100)) {
        const clubs = loanClubs(data, s, rng(s.seed, 'loan-clubs', m.step), 3)
        if (clubs) return loanDecision(data, s, clubs)
      }
    }
  }
  return transferDecision(data, s)
}

// ───────────────────────── efeitos ─────────────────────────

function joinClub(data: GameData, s: CareerState, clubId: string, how: 'academy' | 'transfer', log: CareerLogEntry[]) {
  const m = mem(s)
  const club = clubOf(data, clubId)
  s.clubId = clubId
  s.parentClubId = undefined
  m.loan = null
  if (!m.firstClubId) m.firstClubId = clubId
  m.seasonsAtClub = consecutiveSeasonsAt(s, clubId)
  if (m.captainAt !== clubId) m.captainAt = null
  s.streaks = { lowRole: 0, substitute: 0 }
  if (club) m.salary = signingSalary(data, s, club)
  s.contractUntil = s.season + contractYears(s.age)
  const name = club?.name ?? clubId
  log.push({ season: s.season, age: s.age, type: 'joined', text: how === 'academy' ? `Começou na base: ${name}.` : `Novo clube: ${name}.`, data: { clubId } })
}

function startLoan(data: GameData, s: CareerState, clubId: string, log: CareerLogEntry[]) {
  const m = mem(s)
  const parent = s.parentClubId ?? s.clubId
  if (!parent) return joinClub(data, s, clubId, 'transfer', log)
  s.parentClubId = parent
  s.clubId = clubId
  m.loan = { parentClubId: parent, loanClubId: clubId, returnAge: s.age + PACES[s.pace].seasons }
  m.seasonsAtClub = 0
  log.push({ season: s.season, age: s.age, type: 'loan_started', text: `Empréstimo: ${clubOf(data, clubId)?.name ?? clubId}.`, data: { clubId, parentClubId: parent } })
}

function retire(s: CareerState, reason: string, log: CareerLogEntry[]) {
  s.retired = true
  s.retiredReason = reason
  s.phase = 'finished'
  s.pendingDecision = null
  const text =
    reason === 'retirement_age'
      ? `Fim da linha: aposentadoria aos ${s.age} anos.`
      : reason === 'no_offers'
        ? `Sem propostas, encerrou a carreira aos ${s.age} anos.`
        : `Pendurou as chuteiras aos ${s.age} anos.`
  log.push({ season: s.season, age: s.age, type: 'retired', text, data: { reason } })
}

export function applyEffects(data: GameData, s: CareerState, fx: EffectSpec, log: CareerLogEntry[]) {
  const m = mem(s)
  const paceSeasons = PACES[s.pace].seasons
  if (fx.ovr) s.ovr = clampOvr(s.ovr + fx.ovr)
  if (fx.temp) {
    const before = s.ovr
    s.ovr = clampOvr(s.ovr + fx.temp.delta)
    const applied = s.ovr - before
    if (applied) m.deferred.push({ delta: -applied, afterSeasons: fx.temp.afterSeasons })
  }
  if (fx.roleOverride) {
    s.modifiers.roleOverride = fx.roleOverride
    m.period.roleOverrideSeasons = fx.roleSeasons
  }
  if (fx.roleShift) {
    if (fx.roleShiftSeasons) m.period.tempShift = { shift: fx.roleShift, seasons: fx.roleShiftSeasons }
    else m.period.roleShift += fx.roleShift
  }
  if (fx.demoteRoleSeasons) {
    const club = clubOf(data, s.clubId)
    const isGK = s.identity.position === 'GOL'
    const role = club ? roleFromDelta(s.ovr - clubStrength(s.world, club), isGK) : 'substitute'
    const n = fx.demoteRoleSeasons
    if (role === 'starter' || role === 'high_rotation') {
      s.modifiers.roleOverride = isGK ? 'substitute' : 'low_rotation'
      m.period.roleOverrideSeasons = n
    } else if (role === 'low_rotation') {
      s.modifiers.roleOverride = 'substitute'
      m.period.roleOverrideSeasons = n
    } else m.period.zeroAppsSeasons = n
  }
  if (fx.suspend) {
    s.modifiers.suspendedSeasons = Math.max(2, paceSeasons)
    log.push({ season: s.season, age: s.age, type: 'decision', text: `Suspenso por ${Math.max(2, paceSeasons)} temporadas.` })
  }
  if (fx.boost) m.period.boostAdj += fx.boost
  if (fx.priority) s.modifiers.priority = fx.priority
  if (fx.forceTrophy) s.modifiers.forceTrophy = { competitionKind: fx.forceTrophy.kind, chance: fx.forceTrophy.win ? 1 : -1 }
  if (fx.national) m.period.national = fx.national
  if (fx.nationalBoost) m.period.nationalBoost = (m.period.nationalBoost ?? 0) + fx.nationalBoost
  if (fx.switchNationality) {
    s.identity = { ...s.identity, nationality: fx.switchNationality }
    const cf = indexData(data).country.get(fx.switchNationality)?.confed
    if (cf) m.natConfeds[fx.switchNationality] = cf
  }
  if (fx.retireNational) m.nationalRetired = true
  if (fx.declineFactor) m.declineFactor = Math.max(0.35, m.declineFactor * fx.declineFactor)
  if (fx.offerBoost) m.offerBoost = fx.offerBoost
  if (fx.superAgent) m.superAgent = true
  if (fx.captain === true) m.captainAt = s.clubId
  if (fx.captain === 'lose') m.captainAt = null
  if (fx.salaryMult) m.salary = roundMoney(Math.max(m.salary, 24_000) * fx.salaryMult)
  if (fx.renewYears) s.contractUntil = s.season + fx.renewYears
  if (fx.valueMult) m.period.valueMult *= fx.valueMult
  if (fx.statsMult) m.period.statsMult *= fx.statsMult
  if (fx.newPosition) {
    m.retrainedFrom = s.identity.position
    s.identity = { ...s.identity, position: fx.newPosition }
  }
  if (fx.spotlightOff) m.farFromSpotlight = true
  if (fx.injury) {
    m.period.injury = fx.injury
    log.push({ season: s.season, age: s.age, type: 'injury', text: `Lesão: ${fx.injury.name} (${fx.injury.ovrDelta} OVR).`.replace('(-', '(−') })
  }
}

// ───────────────────────── engine ─────────────────────────

function rollOutcome(s: CareerState, spec: OptionSpec): { outcome: OutcomeSpec; rolled?: number } {
  if (spec.outcomes.length <= 1) return { outcome: spec.outcomes[0] ?? { p: 1, kind: 'neutral', fx: {}, summary: '' } }
  const r = rng(s.seed, 'outcome', mem(s).step)
  const u = r.next()
  let acc = 0
  for (const o of spec.outcomes) {
    acc += o.p
    if (u < acc) return { outcome: o, rolled: o.chip }
  }
  const o = spec.outcomes[spec.outcomes.length - 1]
  return { outcome: o, rolled: o.chip }
}

function penaltyScript(s: CareerState, spec: OptionSpec, success: boolean): RevealScript['penalty'] {
  const side = spec.penalty!.side
  const others = (['left', 'center', 'right'] as const).filter((x) => x !== side)
  const r = rng(s.seed, 'penalty', mem(s).step)
  const isGK = s.identity.position === 'GOL'
  if (isGK) {
    // o usuário é o goleiro: defendeu = foi para o lado certo
    return success ? { scored: false, side, keeperSide: side } : { scored: true, side: r.pick(others), keeperSide: side }
  }
  return success ? { scored: true, side, keeperSide: r.pick(others) } : { scored: false, side, keeperSide: side }
}

function updateStreaks(data: GameData, s: CareerState, periodRecords: CareerState['seasons']) {
  const last = periodRecords[periodRecords.length - 1]
  if (!last || last.loan || last.suspended) return
  const club = clubOf(data, last.clubId)
  if (!club || last.clubId !== (s.parentClubId ?? s.clubId)) return
  const role = roleFromDelta(last.ovrStart - clubStrength(s.world, club), s.identity.position === 'GOL')
  if (role === 'low_rotation') s.streaks = { lowRole: s.streaks.lowRole + 1, substitute: 0 }
  else if (role === 'substitute' || role === 'third_keeper') s.streaks = { lowRole: 0, substitute: s.streaks.substitute + 1 }
  else s.streaks = { lowRole: 0, substitute: 0 }
}

export function createCareerEngine(world: WorldEngine): CareerEngine {
  const engine: CareerEngine = {
    newCareer(data: GameData, identity: PlayerIdentity, pace: Pace, seed: string): CareerState {
      if (!PACES[pace]) throw new Error(`Ritmo desconhecido: ${pace}`)
      const id: PlayerIdentity = { ...identity, surname: identity.surname.trim().slice(0, 15), number: Math.max(1, Math.min(99, Math.round(identity.number))) }
      const w = world.createWorld(data, seed)
      const s: CareerState = {
        version: 1,
        id: `career-${seed}`,
        mode: 'classic',
        pace,
        seed,
        identity: id,
        createdAt: data.generatedAt,
        phase: 'deciding',
        age: START_AGE,
        season: START_SEASON,
        ovr: START_OVR,
        devProfile: developmentProfile(seed, id),
        marketValue: START_VALUE,
        clubId: null,
        seasons: [],
        national: { apps: 0, goals: 0, assists: 0, trophies: [], tournaments: [] },
        pendingDecision: null,
        period: 0,
        events: { done: [], slots: planEventSlots(pace, rng(seed, 'event-plan')), lastEventAge: 0, injuries: 0 },
        modifiers: {},
        streaks: { lowRole: 0, substitute: 0 },
        world: w,
        log: [{ season: START_SEASON, age: START_AGE, type: 'decision', text: 'Começa a jornada: 16 anos, OVR 50, sem clube.' }],
        retired: false,
        achievements: [],
        engine: { ...newMemory(id.nationality, indexData(data).country.get(id.nationality)?.confed), engineVersion: ENGINE_VERSION } as unknown as Record<string, unknown>,
      }
      s.pendingDecision = academyDecision(data, s)
      return s
    },

    choose(data: GameData, state: CareerState, optionId: string) {
      if (state.retired || state.phase === 'finished') throw new Error('A carreira já terminou.')
      const decision = state.pendingDecision
      if (!decision) throw new Error('Não há decisão pendente.')
      const option = decision.options.find((o) => o.id === optionId)
      const specs = (decision.context?.specs ?? {}) as Record<string, OptionSpec>
      const spec = specs[optionId]
      if (!option || !spec) throw new Error(`Opção desconhecida: ${optionId}`)

      const s = cloneState(state)
      const m: CareerMemory = mem(s)
      m.step++
      const log: CareerLogEntry[] = []
      const ovrBefore = state.ovr
      const valueBefore = state.marketValue
      m.period = emptyPeriod()
      s.modifiers = { suspendedSeasons: s.modifiers.suspendedSeasons }

      const { outcome, rolled } = rollOutcome(s, spec)
      let penalty: RevealScript['penalty']
      if (spec.penalty) penalty = penaltyScript(s, spec, outcome.kind === 'positive')

      const finishReveal = (seasons: CareerState['seasons']): { state: CareerState; reveal: RevealScript } => {
        const found = detectAchievements(s)
        const prev = new Set(s.achievements ?? [])
        const fresh = found.filter((a) => !prev.has(a))
        s.achievements = [...(s.achievements ?? []), ...fresh]
        s.log.push(...log)
        s.lastOutcome = { decisionId: decision.id, optionId, rolledEffect: rolled, ovrDelta: s.ovr - ovrBefore, summary: outcome.summary }
        const trophies: TrophyWin[] = seasons.flatMap((r) => r.trophies)
        const reveal: RevealScript = {
          optionId,
          rolledEffect: rolled,
          penalty,
          seasons,
          trophies,
          awards: seasons.flatMap((r) => r.awards),
          relegated: seasons.some((r) => !!r.relegated),
          promoted: seasons.some((r) => !!r.promoted),
          ovrBefore,
          ovrAfter: s.ovr,
          valueBefore,
          valueAfter: s.marketValue,
          log,
          achievements: fresh,
          finished: s.retired,
        }
        return { state: s, reveal }
      }

      // ── aplica a opção ──
      switch (spec.type) {
        case 'retire':
          retire(s, spec.retireReason ?? 'voluntary', log)
          return finishReveal([])
        case 'join':
          joinClub(data, s, spec.clubId!, decision.kind === 'academy' ? 'academy' : 'transfer', log)
          break
        case 'permanent':
          joinClub(data, s, spec.clubId!, 'transfer', log)
          break
        case 'loan':
          startLoan(data, s, spec.clubId!, log)
          break
        case 'stay':
          log.push({ season: s.season, age: s.age, type: 'decision', text: `Decidiu ficar: ${clubOf(data, s.clubId)?.name ?? ''}.`.replace(': .', '.') })
          break
        case 'choice':
          break
      }
      applyEffects(data, s, outcome.fx, log)

      if (decision.kind === 'event' || decision.kind === 'injury') {
        const slot = (decision.context?.slot as number | undefined) ?? s.age
        if (!m.slotsDone.includes(slot)) m.slotsDone.push(slot)
        s.events.lastEventAge = s.age
        if (decision.kind === 'injury') s.events.injuries++
        else if (decision.eventKey && !s.events.done.includes(decision.eventKey)) s.events.done.push(decision.eventKey)
        const pick = option.title ? `${option.label} ${option.title}`.trim() : option.label
        log.push({ season: s.season, age: s.age, type: 'decision', text: `${decision.title} — ${pick}. ${outcome.summary}`.trim(), data: { eventKey: decision.eventKey, optionId, outcome: outcome.kind } })
      }
      if (decision.kind === 'loan_return') m.completedLoan = null

      // ── simula o período ──
      s.period++
      const n = PACES[s.pace].seasons
      const seasons: CareerState['seasons'] = []
      for (let i = 0; i < n && s.age < RETIREMENT_AGE; i++) seasons.push(playSeason({ world, data, s, seasonIdx: i, periodSeasons: n, log }))
      // temporários que sobraram (carreira acabou antes do fim do período)
      for (const d of m.deferred) s.ovr = clampOvr(s.ovr + d.delta)
      m.deferred = []

      updateStreaks(data, s, seasons)

      if (m.loan && s.age >= m.loan.returnAge) {
        const { parentClubId, loanClubId } = m.loan
        m.completedLoan = { parentClubId, loanClubId }
        m.loan = null
        s.clubId = parentClubId
        s.parentClubId = undefined
        m.seasonsAtClub = consecutiveSeasonsAt(s, parentClubId)
        log.push({ season: s.season, age: s.age, type: 'loan_ended', text: `Fim do empréstimo. De volta: ${clubOf(data, parentClubId)?.name ?? parentClubId}.`, data: { parentClubId, loanClubId } })
      }

      if (s.age >= RETIREMENT_AGE) retire(s, 'retirement_age', log)
      else s.pendingDecision = nextDecision(data, s)
      return finishReveal(seasons)
    },

    summarize(data: GameData, state: CareerState) {
      return summarize(data, state)
    },

    describeOption(_data: GameData, state: CareerState, optionId: string) {
      return state.pendingDecision?.options.find((o) => o.id === optionId)?.effects ?? []
    },
  }
  return engine
}
