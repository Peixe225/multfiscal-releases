/**
 * Mock CareerEngine — plausible fake careers so every screen can be built and screenshotted
 * before the real engine (src/engine/career) lands. Deterministic per seed (engine rng).
 *
 * Generates every DecisionKind: academy · transfer · loan · loan_return · non_renewal · event ·
 * injury · club_priority · national_call · contract · retirement (+ the penalty minigame event).
 */
import type {
  AwardResult,
  AwardWin,
  CareerLogEntry,
  CareerState,
  CareerSummary,
  Club,
  Decision,
  DecisionKind,
  DecisionOption,
  EffectChip,
  GameData,
  League,
  Pace,
  PlayerIdentity,
  SeasonRecord,
  SeasonWorldResult,
  SquadRole,
  StandingRow,
  TrophyWin,
  WorldState,
} from '@/engine/types'
import type { CareerEngine, RevealScript } from '@/engine/api'
import { clamp, rng, type Rng } from '@/engine/rng'

export const PACE_SEASONS: Record<Pace, number> = { intensa: 1, normal: 2, expressa: 3 }
const WORLD_CUP_YEARS = new Set([2030, 2034, 2038, 2042, 2046, 2050])
const CONTINENTAL_NATIONAL_YEARS = new Set([2028, 2032, 2036, 2040, 2044, 2048])
const CWC_YEARS = new Set([2029, 2033, 2037, 2041, 2045, 2049])

// ───────────────────────── lookups ─────────────────────────

const clubOf = (d: GameData, id: string | null | undefined) => (id ? d.clubs.find((c) => c.id === id) : undefined)
const leagueById = (d: GameData, id: string | undefined) => (id ? d.leagues.find((l) => l.id === id) : undefined)
const countryOf = (d: GameData, code: string) => d.countries.find((c) => c.code === code)
const compById = (d: GameData, id: string | undefined) => (id ? d.competitions.find((c) => c.id === id) : undefined)

function currentLeague(d: GameData, s: CareerState, clubId: string): League | undefined {
  const dyn = s.world.clubs[clubId]
  return leagueById(d, dyn?.leagueId ?? clubOf(d, clubId)?.leagueId) ?? d.leagues[0]
}

function strengthOf(d: GameData, s: CareerState, clubId: string): number {
  return s.world.clubs[clubId]?.strength ?? clubOf(d, clubId)?.strength ?? 65
}

function groupOf(pos: PlayerIdentity['position']): 'goalkeeper' | 'defensive' | 'support' | 'attacking' {
  if (pos === 'GOL') return 'goalkeeper'
  if (pos === 'ZAG' || pos === 'LD' || pos === 'LE') return 'defensive'
  if (pos === 'VOL' || pos === 'MC' || pos === 'ME' || pos === 'MD') return 'support'
  return 'attacking'
}

function confedPrimary(d: GameData, league: League | undefined): string | undefined {
  if (!league) return undefined
  const c = d.confederations?.[league.confed]
  if (c?.primary) return c.primary
  return league.confed === 'CONMEBOL' ? 'conmebol.libertadores' : league.confed === 'UEFA' ? 'uefa.champions' : undefined
}
function confedSecondary(d: GameData, league: League | undefined): string | undefined {
  if (!league) return undefined
  const c = d.confederations?.[league.confed]
  if (c?.secondary) return c.secondary
  return league.confed === 'CONMEBOL' ? 'conmebol.sudamericana' : league.confed === 'UEFA' ? 'uefa.europa' : undefined
}
const trophyOfComp = (d: GameData, compId: string | undefined, fallback: string) => compById(d, compId)?.trophyId ?? fallback

// ───────────────────────── formulas ─────────────────────────

export function mockMarketValue(ovr: number, age: number, coefficient = 0.7): number {
  const dlt = clamp(ovr - 50, 0, 60)
  let v = 1e5 * 1.19 ** Math.min(dlt, 37) * 1.08 ** Math.max(0, dlt - 37)
  v *= age <= 23 ? 1.15 : age <= 28 ? 1 : age <= 31 ? 0.7 : age <= 34 ? 0.35 : 0.12
  v *= 0.55 + coefficient * 0.55
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(v)) - 1)
  return Math.max(1e5, Math.round(v / mag) * mag)
}

function growth(age: number, dev: CareerState['devProfile'], r: Rng): number {
  const peak = dev === 'early' ? 24 : dev === 'late' ? 29 : 27
  if (age < peak - 6) return r.int(3, 6)
  if (age < peak - 2) return r.int(2, 4)
  if (age <= peak + 2) return r.int(0, 2)
  if (age <= peak + 5) return r.int(-2, 1)
  return r.int(-4, -1)
}

function roleFor(ovr: number, clubStrength: number, age: number): SquadRole {
  const diff = ovr - clubStrength + (age <= 17 ? -6 : 0)
  if (diff >= 1) return 'starter'
  if (diff >= -4) return 'high_rotation'
  if (diff >= -9) return 'low_rotation'
  return 'substitute'
}

const APPS: Record<SquadRole, [number, number]> = { starter: [40, 54], high_rotation: [28, 40], low_rotation: [14, 27], substitute: [4, 13], third_keeper: [0, 3] }
const G_RATE = { attacking: 0.56, support: 0.24, defensive: 0.07, goalkeeper: 0 }
const A_RATE = { attacking: 0.22, support: 0.3, defensive: 0.1, goalkeeper: 0.01 }

// ───────────────────────── effects ─────────────────────────

const fx = (kind: EffectChip['kind'], label: string, probability?: number): EffectChip => ({ kind, label, probability })

function parseOvr(label: string): number {
  const m = /([+−-])\s*(\d+)\s*OVR/i.exec(label)
  if (!m) return 0
  return (m[1] === '+' ? 1 : -1) * Number(m[2])
}

/** Roll one of the probabilistic effects (prob < 1); fixed ones always apply. */
function rollEffects(opt: DecisionOption, r: Rng): { rolled?: number; applied: EffectChip[] } {
  const probs = opt.effects.map((e, i) => ({ e, i })).filter(({ e }) => e.probability != null && e.probability < 1)
  const fixed = opt.effects.filter((e) => e.probability == null || e.probability >= 1)
  if (!probs.length) return { applied: fixed }
  const pick = r.weighted(probs, (x) => x.e.probability ?? 0)
  return { rolled: pick.i, applied: [...fixed, pick.e] }
}

// ───────────────────────── decisions ─────────────────────────

let optSeq = 0
/** Option ids are unique within a decision (the counter resets per decision → deterministic). */
const oid = (k: string) => `${k}-${++optSeq}`

function clubOption(d: GameData, club: Club, label: string, r: Rng, kind: 'academy' | 'transfer' | 'loan' | 'non_renewal', ovr: number): DecisionOption {
  const diff = club.strength - ovr
  const big = diff > 8
  const effects: EffectChip[] =
    kind === 'loan'
      ? [fx('positive', `+${r.int(3, 5)} OVR`, 0.55), fx('neutral', 'Adaptação lenta', 0.45), fx('fixed', 'Titular garantido', 1)]
      : big
        ? [fx('positive', `+${r.int(3, 4)} OVR`, 0.6), fx('negative', `−${r.int(1, 2)} OVR · adaptação`, 0.4)]
        : diff > 0
          ? [fx('positive', `+${r.int(1, 3)} OVR`, 0.8), fx('fixed', 'Titular', 1)]
          : [fx('positive', '+1 OVR', 0.8), fx('fixed', 'Capitão do time', 1)]
  const lg = leagueById(d, club.leagueId)
  const salary = Math.max(0.05, Math.round(((club.prestige + 1) * (ovr - 45) * 0.06 + r.range(0, 1)) * 10) / 10)
  return {
    id: oid(kind),
    label,
    title: club.name,
    clubId: club.id,
    effects,
    details: [
      { label: 'Salário', value: salary >= 1 ? `€${salary.toFixed(salary >= 10 ? 0 : 1)}M/ano` : `€${Math.round(salary * 1000)}K/ano` },
      { label: 'Contrato', value: kind === 'loan' ? '1 temporada' : `${r.int(3, 5)} anos` },
      ...(lg ? [{ label: 'Liga', value: lg.shortName }] : []),
    ],
  }
}

function pickClubs(d: GameData, pred: (c: Club) => boolean, n: number, r: Rng, exclude: (string | null | undefined)[] = []): Club[] {
  const pool = d.clubs.filter((c) => pred(c) && !exclude.includes(c.id))
  return r.sample(pool.length ? pool : d.clubs.filter((c) => !exclude.includes(c.id)), n)
}

export function academyDecision(d: GameData, identity: PlayerIdentity, r: Rng): Decision {
  optSeq = 0
  const home = d.clubs.filter((c) => c.country === identity.nationality)
  const pool = home.length >= 3 ? home : d.clubs.filter((c) => c.country === 'BRA')
  const sorted = [...pool].sort((a, b) => b.strength - a.strength)
  const big = r.pick(sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 4))))
  const mid = r.pick(sorted.slice(Math.ceil(sorted.length / 4), Math.max(2, Math.ceil(sorted.length / 1.6))).filter((c) => c.id !== big.id)) ?? sorted[1]
  const small = r.pick(sorted.slice(-Math.max(1, Math.ceil(sorted.length / 3))).filter((c) => c.id !== big.id && c.id !== mid.id)) ?? sorted[sorted.length - 1]
  const opts = [big, mid, small].map((c, i) => {
    const o = clubOption(d, c, 'Assinar com', r, 'academy', 55)
    o.effects = [
      [fx('positive', '+4 OVR', 0.35), fx('neutral', 'Base concorrida', 0.65)],
      [fx('positive', '+3 OVR', 0.6), fx('neutral', 'Sem efeito', 0.4)],
      [fx('positive', '+2 OVR', 0.85), fx('fixed', 'Estreia garantida', 1)],
    ][i]
    o.details = [{ label: 'Categoria', value: 'Sub-17' }, { label: 'Contrato', value: '3 anos' }]
    return o
  })
  return {
    id: 'academy',
    kind: 'academy',
    title: 'Oferta de base',
    description: 'Três clubes querem você nas categorias de base. Onde começa a sua história?',
    options: opts,
  }
}

interface EventTemplate {
  key: string
  title: string
  description: (ctx: { club: string; surname: string }) => string
  options: () => DecisionOption[]
}

const EVENTS: EventTemplate[] = [
  {
    key: 'penalti-decisivo',
    title: 'Pênalti decisivo na final',
    description: ({ club }) => `Último minuto da final da copa. O juiz aponta a marca da cal e a torcida do ${club} olha para você.`,
    options: () => [
      { id: oid('ev'), label: 'Bater', title: 'Cobrar o pênalti', art: 'penalty', minigame: 'penalty', effects: [fx('positive', 'Título + ídolo', 0.72), fx('negative', 'Perde o título', 0.28)] },
      { id: oid('ev'), label: 'Passar', title: 'Deixar para o capitão', art: 'captain', effects: [fx('neutral', 'Sem pressão', 1)] },
    ],
  },
  {
    key: 'polemica-redes',
    title: 'Polêmica nas redes sociais',
    description: () => 'Um vídeo seu numa festa viralizou na semana do clássico. A imprensa quer uma resposta.',
    options: () => [
      { id: oid('ev'), label: 'Fazer', title: 'Pedir desculpas publicamente', effects: [fx('positive', '+1 OVR · foco', 0.5), fx('neutral', 'Assunto encerrado', 0.5)] },
      { id: oid('ev'), label: 'Fazer', title: 'Ignorar as críticas', effects: [fx('negative', '−2 OVR · vaias', 0.45), fx('neutral', 'Ninguém lembra', 0.55)] },
    ],
  },
  {
    key: 'treino-extra',
    title: 'O técnico quer treino extra',
    description: () => 'Depois de uma sequência ruim, o treinador propõe sessões extras no CT antes de cada jogo.',
    options: () => [
      { id: oid('ev'), label: 'Fazer', title: 'Aceitar o treino extra', effects: [fx('positive', '+3 OVR', 0.55), fx('negative', 'Lesão muscular · −2 OVR', 0.2), fx('neutral', 'Sem efeito', 0.25)] },
      { id: oid('ev'), label: 'Fazer', title: 'Manter a rotina', effects: [fx('neutral', 'Sem efeito', 1)] },
    ],
  },
  {
    key: 'proposta-arabia',
    title: 'Proposta milionária da Arábia',
    description: () => 'Um clube saudita oferece o triplo do seu salário. O dinheiro é irrecusável… ou não?',
    options: () => [
      { id: oid('ev'), label: 'Fazer', title: 'Recusar e seguir no topo', effects: [fx('positive', 'Prestígio +', 1), fx('positive', '+1 OVR', 0.5)] },
      { id: oid('ev'), label: 'Fazer', title: 'Pedir aumento ao clube', effects: [fx('positive', 'Salário +40%', 0.6), fx('negative', '−1 OVR · clima ruim', 0.4)] },
    ],
  },
  {
    key: 'mentor-veterano',
    title: 'Um veterano quer te ensinar',
    description: () => 'O capitão do time se oferece para ser seu mentor nesta temporada.',
    options: () => [
      { id: oid('ev'), label: 'Fazer', title: 'Aceitar a mentoria', effects: [fx('positive', '+2 OVR', 0.8), fx('neutral', 'Sem efeito', 0.2)] },
      { id: oid('ev'), label: 'Fazer', title: 'Seguir sozinho', effects: [fx('neutral', 'Sem efeito', 1)] },
    ],
  },
]

const INJURIES = [
  { id: 'lca', name: 'Ruptura do ligamento cruzado', surgery: -4, rest: -6 },
  { id: 'coxa', name: 'Lesão muscular na coxa', surgery: -1, rest: -2 },
  { id: 'tornozelo', name: 'Entorse grave no tornozelo', surgery: -2, rest: -3 },
]

export function makeDecision(d: GameData, s: CareerState, kind: DecisionKind, r: Rng): Decision {
  optSeq = 0
  const club = clubOf(d, s.clubId)
  const clubName = club?.name ?? 'seu clube'
  const league = club ? currentLeague(d, s, club.id) : undefined
  switch (kind) {
    case 'transfer': {
      const targets = pickClubs(d, (c) => c.strength > strengthOf(d, s, s.clubId ?? '') + 2 && c.strength >= s.ovr - 6, 2, r, [s.clubId])
      const top = targets[0]
      const fee = mockMarketValue(s.ovr, s.age, leagueById(d, top?.leagueId)?.coefficient) * r.range(1.1, 1.5)
      const stay: DecisionOption = {
        id: oid('stay'),
        label: 'Renovar com',
        title: clubName,
        clubId: s.clubId ?? undefined,
        effects: [fx('positive', '+1 OVR', 0.8), fx('fixed', 'Capitão do time', 1)],
        details: [
          { label: 'Salário', value: `€${Math.max(1, Math.round(s.ovr / 14))}M/ano` },
          { label: 'Contrato', value: '4 anos' },
        ],
      }
      return {
        id: `transfer-${s.season}`,
        kind: 'transfer',
        title: top ? `O ${top.name} bateu à sua porta` : 'Janela de transferências',
        description: `Os olheiros não param de ligar. Há ${targets.length === 1 ? 'uma proposta' : 'propostas'} de €${Math.round(fee / 1e6)}M na mesa, e o ${clubName} quer renovar.`,
        options: [...targets.map((c) => clubOption(d, c, 'Assinar com', r, 'transfer', s.ovr)), stay],
      }
    }
    case 'loan': {
      const cur = strengthOf(d, s, s.clubId ?? '')
      const targets = pickClubs(d, (c) => c.strength < cur - 2 && c.strength >= s.ovr - 4, 3, r, [s.clubId])
      return {
        id: `loan-${s.season}`,
        kind: 'loan',
        title: 'Proposta de empréstimo',
        description: `Sem espaço no ${clubName}, a diretoria sugere rodar por empréstimo para ganhar minutos.`,
        options: targets.map((c) => clubOption(d, c, 'Ir para o', r, 'loan', s.ovr)),
      }
    }
    case 'loan_return': {
      const parent = clubOf(d, s.parentClubId)
      return {
        id: `loan-return-${s.season}`,
        kind: 'loan_return',
        title: 'Fim do empréstimo',
        description: `O empréstimo acabou. O ${parent?.name ?? 'clube'} quer você de volta, mas o ${clubName} fez proposta para ficar.`,
        options: [
          { id: oid('ret'), label: 'Voltar ao', title: parent?.name ?? 'Clube de origem', clubId: s.parentClubId, effects: [fx('positive', '+2 OVR', 0.5), fx('negative', 'Reserva · −1 OVR', 0.5)] },
          { id: oid('ret'), label: 'Ficar no', title: clubName, clubId: s.clubId ?? undefined, effects: [fx('positive', '+1 OVR', 0.7), fx('fixed', 'Titular', 1)] },
        ],
      }
    }
    case 'non_renewal': {
      const targets = pickClubs(d, (c) => Math.abs(c.strength - s.ovr) <= 8, 3, r, [s.clubId])
      return {
        id: `non-renewal-${s.season}`,
        kind: 'non_renewal',
        title: `Fim de ciclo no ${clubName}`,
        description: 'O clube decidiu não renovar o seu contrato. Três propostas chegaram para você.',
        options: targets.map((c) => clubOption(d, c, 'Assinar com', r, 'non_renewal', s.ovr)),
      }
    }
    case 'injury': {
      const inj = r.pick(INJURIES)
      return {
        id: `injury-${s.season}`,
        kind: 'injury',
        eventKey: inj.id,
        title: inj.name,
        description: 'Os médicos do clube apresentaram dois caminhos para a recuperação.',
        options: [
          { id: oid('inj'), label: 'Fazer', title: 'Cirurgia imediata', art: 'surgery', effects: [fx('negative', `${inj.surgery} OVR`.replace('-', '−'), 1), fx('fixed', 'Volta em 4 meses', 1)] },
          { id: oid('inj'), label: 'Fazer', title: 'Tratamento conservador', art: 'physio', effects: [fx('positive', 'Recupera 100%', 0.6), fx('negative', `${inj.rest} OVR`.replace('-', '−'), 0.4)] },
        ],
        context: { injuryId: inj.id, injuryName: inj.name },
      }
    }
    case 'club_priority': {
      const cont = compById(d, confedPrimary(d, league))
      return {
        id: `priority-${s.season}`,
        kind: 'club_priority',
        title: `${league?.shortName ?? 'Liga'} ou ${cont?.name ?? 'continental'}?`,
        description: 'O calendário apertou e o técnico quer saber: onde você dá tudo nesta temporada?',
        options: [
          { id: oid('pri'), label: 'Priorizar', title: `o ${league?.shortName ?? 'campeonato'}`, trophyId: league?.trophyId, effects: [fx('positive', 'Chance de título +25%', 1), fx('negative', `${cont?.name ?? 'Continental'} −15%`, 1)] },
          { id: oid('pri'), label: 'Priorizar', title: `a ${cont?.name ?? 'copa'}`, trophyId: cont?.trophyId, effects: [fx('positive', 'Chance de título +20%', 1), fx('negative', 'Liga −10%', 1)] },
        ],
      }
    }
    case 'national_call': {
      const nat = countryOf(d, s.identity.nationality)
      return {
        id: `national-${s.season}`,
        kind: 'national_call',
        title: `Convocação: Seleção ${nat ? (nat.name === 'Brasil' ? 'Brasileira' : `da ${nat.name}`) : ''}`.trim(),
        description: 'O técnico da seleção ligou pessoalmente. Mas o seu clube tem jogos decisivos na mesma data.',
        options: [
          { id: oid('nat'), label: 'Fazer', title: 'Aceitar a convocação', effects: [fx('positive', '+2 OVR', 0.6), fx('negative', '−1 OVR · desgaste', 0.4), fx('fixed', 'Estreia pela seleção', 1)] },
          { id: oid('nat'), label: 'Fazer', title: 'Pedir dispensa', effects: [fx('neutral', 'Foco no clube', 1), fx('negative', 'Esquecido pela seleção', 0.3)] },
        ],
      }
    }
    case 'contract': {
      return {
        id: `contract-${s.season}`,
        kind: 'contract',
        title: `Renovação com o ${clubName}`,
        description: 'Seu contrato está no fim e a diretoria abriu as negociações.',
        options: [
          { id: oid('ctr'), label: 'Fazer', title: 'Renovar por 5 anos', effects: [fx('fixed', `Salário €${Math.max(1, Math.round(s.ovr / 12))}M/ano`, 1), fx('positive', '+1 OVR', 0.5)] },
          { id: oid('ctr'), label: 'Fazer', title: 'Pedir aumento', effects: [fx('positive', 'Salário +50%', 0.55), fx('negative', '−2 OVR · clima ruim', 0.45)] },
          { id: oid('ctr'), label: 'Fazer', title: 'Testar o mercado', effects: [fx('neutral', 'Janela aberta', 1)] },
        ],
      }
    }
    case 'retirement': {
      return {
        id: `retirement-${s.season}`,
        kind: 'retirement',
        title: 'Hora de pendurar as chuteiras?',
        description: `Aos ${s.age} anos, o corpo já dá sinais. A torcida pede mais uma temporada.`,
        options: [
          { id: 'retire', label: 'Fazer', title: 'Anunciar a aposentadoria', art: 'farewell', effects: [fx('fixed', 'Fim da carreira', 1)] },
          { id: oid('ret'), label: 'Fazer', title: 'Jogar mais uma temporada', effects: [fx('negative', '−3 OVR', 0.6), fx('neutral', 'Despedida em alta', 0.4)] },
        ],
      }
    }
    case 'event':
    default: {
      const pool = EVENTS.filter((e) => !s.events.done.includes(e.key))
      const ev = r.pick(pool.length ? pool : EVENTS)
      return {
        id: `event-${ev.key}-${s.season}`,
        kind: 'event',
        eventKey: ev.key,
        title: ev.title,
        description: ev.description({ club: clubName, surname: s.identity.surname }),
        options: ev.options(),
      }
    }
  }
}

function nextDecisionKind(d: GameData, s: CareerState, r: Rng): DecisionKind | null {
  if (s.age >= 40 || s.retired) return null
  if (s.parentClubId) return 'loan_return'
  if (s.age >= 37 || (s.age >= 34 && r.chance(0.45))) return 'retirement'
  const last = s.pendingDecision?.kind
  const club = clubOf(d, s.clubId)
  const cur = club ? strengthOf(d, s, club.id) : 60
  const role = roleFor(s.ovr, cur, s.age)
  const nat = countryOf(d, s.identity.nationality)
  const called = s.ovr >= (nat?.callUpOvr ?? 78)
  const weights: [DecisionKind, number][] = [
    ['transfer', s.ovr >= cur ? 0.3 : 0.12],
    ['event', 0.22],
    ['loan', s.age <= 21 && (role === 'low_rotation' || role === 'substitute') ? 0.45 : 0],
    ['contract', 0.1],
    ['club_priority', cur >= 76 ? 0.12 : 0],
    ['national_call', called && !s.national.firstCallUp ? 0.5 : called ? 0.06 : 0],
    ['injury', s.events.injuries < 2 ? 0.08 : 0],
    ['non_renewal', s.age >= 29 && role !== 'starter' ? 0.25 : 0.03],
  ]
  const opts = weights.filter(([k, w]) => w > 0 && k !== last)
  return r.weighted(opts, ([, w]) => w)[0]
}

// ───────────────────────── season simulation ─────────────────────────

function simulateSeason(d: GameData, s: CareerState, r: Rng, opts: { forceCupWin?: boolean; loanClub?: boolean }): { record: SeasonRecord; world: SeasonWorldResult; log: CareerLogEntry[] } {
  const season = s.season
  const age = s.age
  const clubId = s.clubId ?? d.clubs[0].id
  const club = clubOf(d, clubId)
  const league = currentLeague(d, s, clubId)!
  const cStr = strengthOf(d, s, clubId)
  const ovrStart = s.ovr
  const ovrEnd = clamp(ovrStart + growth(age, s.devProfile, r) + (s.modifiers.tempOvr ?? 0), 40, 99)
  const role = s.modifiers.roleOverride ?? roleFor(ovrEnd, cStr, age)
  const g = groupOf(s.identity.position)
  const [a0, a1] = APPS[role]
  const apps = Math.max(0, Math.round(r.int(a0, a1) * (age <= 16 ? 0.35 : age <= 17 ? 0.65 : 1)))
  const q = 0.55 + (ovrEnd - 60) / 38
  const goals = Math.max(0, Math.round(apps * G_RATE[g] * q * r.range(0.75, 1.25)))
  const assists = Math.max(0, Math.round(apps * A_RATE[g] * q * r.range(0.7, 1.3)))
  const rating = clamp(Math.round((6.1 + (ovrEnd - 60) / 11 + r.normal(0, 0.25)) * 10) / 10, 5.4, 9.6)

  // league table (user boost)
  const boost = clamp((ovrEnd - cStr) / 4, -1, 4) + (s.modifiers.priority === 'league' ? 1.5 : 0)
  const members = d.clubs.filter((c) => (s.world.clubs[c.id]?.leagueId ?? c.leagueId) === league.id)
  if (!members.find((c) => c.id === clubId) && club) members.push(club)
  const scored = members.map((c) => ({ c, v: (s.world.clubs[c.id]?.strength ?? c.strength) + r.normal(0, 3.2) + (c.id === clubId ? boost : 0) })).sort((x, y) => y.v - x.v)
  const games = (members.length - 1) * 2 || 38
  const table: StandingRow[] = scored.map(({ c, v }, i) => {
    const pts = Math.round(clamp(games * 2.3 - i * (games * 0.075) + (v - 75) * 0.4, 8, games * 2.7))
    const won = Math.round(pts / 3.1)
    const drawn = clamp(pts - won * 3, 0, games - won)
    const lost = Math.max(0, games - won - drawn)
    const gf = Math.round(won * 1.9 + drawn * 0.9 + r.int(0, 8))
    const ga = Math.round(lost * 1.7 + drawn * 0.9 + r.int(0, 8))
    return { clubId: c.id, played: games, won, drawn, lost, gf, ga, points: won * 3 + drawn }
  })
  table.sort((x, y) => y.points - x.points || y.gf - y.ga - (x.gf - x.ga))
  const position = table.findIndex((t) => t.clubId === clubId) + 1
  const n = table.length
  const promoted = league.tier > 1 && !!league.upperLeagueId && position <= Math.max(1, league.promotion || 4)
  const relegated = !promoted && !!league.lowerLeagueId && position > n - Math.max(1, league.relegation || 3)

  const trophies: TrophyWin[] = []
  const tw = (trophyId: string, competitionId: string, scope: 'club' | 'national' = 'club', teamId = clubId): TrophyWin => ({ trophyId, competitionId, season, teamId, scope })
  if (position === 1) trophies.push(tw(league.trophyId, league.id))
  const cupId = league.domesticCupId
  if (cupId && (opts.forceCupWin || r.chance(clamp(0.06 + (cStr - 70) * 0.012 + boost * 0.02, 0.02, 0.35)))) trophies.push(tw(trophyOfComp(d, cupId, 'copa-do-brasil'), cupId))
  const prim = confedPrimary(d, league)
  const primChance = clamp((s.modifiers.priority === 'continental' ? 0.14 : 0.06) + (cStr + boost - 80) * 0.02, 0, 0.45)
  let wonPrim = false
  if (prim && league.tier === 1 && r.chance(primChance)) {
    trophies.push(tw(trophyOfComp(d, prim, 'libertadores'), prim))
    wonPrim = true
  } else {
    const sec = confedSecondary(d, league)
    if (sec && league.tier === 1 && r.chance(clamp(0.04 + (cStr - 74) * 0.01, 0, 0.2))) trophies.push(tw(trophyOfComp(d, sec, 'sul-americana'), sec))
  }
  if (CWC_YEARS.has(season + 1) && wonPrim && r.chance(0.45)) trophies.push(tw(trophyOfComp(d, 'fifa.cwc', 'mundial-de-clubes'), 'fifa.cwc'))

  // national team
  const log: CareerLogEntry[] = []
  const nat = countryOf(d, s.identity.nationality)
  const calledUp = age >= 18 && ovrEnd >= (nat?.callUpOvr ?? 78)
  let national: SeasonRecord['national']
  if (calledUp) {
    const napps = r.int(4, 11)
    national = { apps: napps, goals: Math.round(napps * G_RATE[g] * q * 0.8), assists: Math.round(napps * A_RATE[g] * q * 0.7) }
    const year = season + 1
    const tournamentId = WORLD_CUP_YEARS.has(year) ? 'fifa.world' : CONTINENTAL_NATIONAL_YEARS.has(year) ? (nat?.confed === 'UEFA' ? 'uefa.euro' : nat?.confed === 'CONMEBOL' ? 'conmebol.america' : undefined) : undefined
    if (tournamentId) {
      const champ = r.chance(clamp(((nat?.strength ?? 80) - 72) * 0.012 + (ovrEnd - 85) * 0.01, 0.03, 0.4))
      const reached = champ ? 'Campeão' : r.pick(['Final', 'Semifinal', 'Quartas de final', 'Oitavas de final'])
      national.tournament = { competitionId: tournamentId, reached }
      if (champ) trophies.push(tw(trophyOfComp(d, tournamentId, tournamentId === 'fifa.world' ? 'copa-do-mundo' : 'copa-america'), tournamentId, 'national', s.identity.nationality))
    }
    if (!s.national.firstCallUp) log.push({ season, age, type: 'call_up', text: `Primeira convocação para a seleção (${nat?.name ?? s.identity.nationality}).` })
  }

  // awards (ballon d'or of year season+1)
  const awards: AwardWin[] = []
  const year = season + 1
  const userScore = ovrEnd + goals / 6 + assists / 10 + trophies.length * 2.2 + (national?.tournament?.reached === 'Campeão' ? 5 : 0) + r.normal(0, 1.2)
  const rivals = d.stars.map((p) => {
    const a = year - p.birthYear
    const o = p.ovr + (a < 25 ? Math.min(4, (25 - a) * 0.6) : 0) - Math.max(0, a - 30) * 1.6
    return { name: p.name, nationality: p.nationality, clubId: p.clubId, position: p.position, score: o + 6 + r.normal(0, 1.8) }
  })
  const ranking = [...rivals, { name: s.identity.surname, nationality: s.identity.nationality, clubId, position: s.identity.position, score: userScore, isUser: true }]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((e) => ({ ...e, score: Math.round(e.score * 10) }))
  const place = ranking.findIndex((e) => 'isUser' in e && e.isUser) + 1
  if (place >= 1 && place <= 3) awards.push({ award: 'ballon_dor', year, place: place as 1 | 2 | 3 })
  const topScorerGoals = Math.round(18 + league.coefficient * 8 + r.int(0, 6))
  if (goals >= topScorerGoals) awards.push({ award: 'league_top_scorer', year, place: 1, leagueId: league.id })
  if (age <= 21 && ovrEnd >= 80 && r.chance(0.5)) awards.push({ award: 'kopa', year, place: 1 })
  if (g === 'goalkeeper' && ovrEnd >= 84 && r.chance(0.35)) awards.push({ award: 'golden_glove', year, place: 1 })
  if (ovrEnd >= 88 && r.chance(0.5)) awards.push({ award: 'team_of_the_year', year, place: 1 })

  for (const t of trophies) log.push({ season, age, type: 'trophy', text: `Campeão: ${d.trophies.find((x) => x.id === t.trophyId)?.name ?? t.trophyId}`, data: { trophyId: t.trophyId } })
  for (const a of awards) log.push({ season, age, type: 'award', text: a.award === 'ballon_dor' ? `Bola de Ouro ${year}: ${a.place}º lugar` : `Prêmio: ${a.award}`, data: { award: a.award, place: a.place } })
  if (promoted) log.push({ season, age, type: 'promotion', text: `Acesso com o ${club?.name}!` })
  if (relegated) log.push({ season, age, type: 'relegation', text: `Rebaixado com o ${club?.name}.` })

  const record: SeasonRecord = {
    season,
    age,
    clubId,
    leagueId: league.id,
    tier: league.tier,
    loan: !!opts.loanClub,
    period: s.period,
    role,
    ovrStart,
    ovrEnd,
    marketValue: mockMarketValue(ovrEnd, age, league.coefficient),
    stats: g === 'goalkeeper' ? { apps, goals: 0, assists, rating, cleanSheets: Math.round(apps * r.range(0.25, 0.45)), conceded: Math.round(apps * r.range(0.7, 1.2)) } : { apps, goals, assists, rating },
    leaguePosition: position,
    promoted,
    relegated,
    trophies,
    awards,
    national,
    captain: age >= 27 && role === 'starter' && r.chance(0.4),
  }

  const leagueResult = {
    leagueId: league.id,
    season,
    table,
    champion: table[0]?.clubId,
    promoted: promoted ? [clubId] : [],
    relegated: relegated ? [clubId] : [],
    topScorers: [
      { name: s.identity.surname, clubId, goals, isUser: true },
      ...d.stars.filter((p) => p.position === 'CA' || p.position === 'PE' || p.position === 'PD').slice(0, 4).map((p) => ({ name: p.shortName, clubId: p.clubId ?? clubId, goals: r.int(12, 30) })),
    ].sort((a, b) => b.goals - a.goals),
  }
  const ballon: AwardResult = { award: 'ballon_dor', year, winner: ranking[0], ranking }
  const world: SeasonWorldResult = { season, leagues: { [league.id]: leagueResult }, cups: {}, national: {}, awards: [ballon] }
  return { record, world, log }
}

// ───────────────────────── engine ─────────────────────────

function emptyWorld(seed: string): WorldState {
  return { seed, nextSeason: 2026, clubs: {}, nations: {}, rivals: [], seasons: {}, qualified: {} }
}

function applyClubChange(d: GameData, s: CareerState, opt: DecisionOption, kind: DecisionKind, log: CareerLogEntry[]) {
  if (!opt.clubId) return
  if (kind === 'loan') {
    s.parentClubId = s.clubId ?? undefined
    s.clubId = opt.clubId
    log.push({ season: s.season, age: s.age, type: 'loan_started', text: `Emprestado ao ${clubOf(d, opt.clubId)?.name}.` })
    return
  }
  if (kind === 'loan_return') {
    const back = opt.clubId === s.parentClubId
    log.push({ season: s.season, age: s.age, type: 'loan_ended', text: back ? `De volta ao ${clubOf(d, opt.clubId)?.name}.` : `Contratado em definitivo pelo ${clubOf(d, opt.clubId)?.name}.` })
    s.clubId = opt.clubId
    s.parentClubId = undefined
    return
  }
  if (opt.clubId !== s.clubId) {
    s.clubId = opt.clubId
    s.parentClubId = undefined
    log.push({ season: s.season, age: s.age, type: 'joined', text: `Assinou com o ${clubOf(d, opt.clubId)?.name}.` })
  }
}

export function createMockEngine(): CareerEngine {
  return {
    newCareer(data, identity, pace, seed) {
      const r = rng(seed, 'new')
      const devProfile = r.pick(['early', 'normal', 'normal', 'late'] as const)
      const ovr = r.int(51, 56)
      const s: CareerState = {
        version: 1,
        id: `c-${seed}`,
        mode: 'classic',
        pace,
        seed,
        identity,
        createdAt: new Date().toISOString(),
        phase: 'deciding',
        age: 16,
        season: 2026,
        ovr,
        devProfile,
        marketValue: 100_000,
        clubId: null,
        seasons: [],
        national: { apps: 0, goals: 0, assists: 0, trophies: [], tournaments: [] },
        pendingDecision: null,
        period: 0,
        events: { done: [], slots: [], lastEventAge: 0, injuries: 0 },
        modifiers: {},
        streaks: { lowRole: 0, substitute: 0 },
        world: emptyWorld(seed),
        log: [],
        retired: false,
      }
      s.pendingDecision = academyDecision(data, identity, r)
      return s
    },

    choose(data, prev, optionId) {
      const s: CareerState = structuredClone(prev)
      const dec = s.pendingDecision
      const opt = dec?.options.find((o) => o.id === optionId) ?? dec?.options[0]
      const r = rng(s.seed, 'period', s.period, Math.max(0, dec?.options.indexOf(opt!) ?? 0))
      const log: CareerLogEntry[] = []
      const ovrBefore = s.ovr
      const valueBefore = s.marketValue
      const { rolled, applied } = opt ? rollEffects(opt, r) : { rolled: undefined, applied: [] as EffectChip[] }
      const ovrDelta = applied.reduce((a, e) => a + parseOvr(e.label), 0)
      let penalty: RevealScript['penalty']
      let forceCupWin = false
      const achievements: string[] = []

      if (dec && opt) {
        applyClubChange(data, s, opt, dec.kind, log)
        if (dec.kind === 'event' && dec.eventKey) s.events.done.push(dec.eventKey)
        if (dec.kind === 'injury') s.events.injuries++
        if (dec.kind === 'club_priority') s.modifiers.priority = /liga|campeonato|brasileir|premier|laliga|serie/i.test(opt.title ?? '') ? 'league' : 'continental'
        if (dec.kind === 'national_call' && /Aceitar/.test(opt.title ?? '') && !s.national.firstCallUp) s.national.firstCallUp = s.season
        if (opt.minigame === 'penalty') {
          const scored = rolled === 0
          const sides = ['left', 'center', 'right'] as const
          const side = r.pick(sides)
          penalty = { scored, side, keeperSide: scored ? r.pick(sides.filter((x) => x !== side)) : side }
          forceCupWin = scored
          if (scored) achievements.push('heroi-da-final')
        }
        log.push({ season: s.season, age: s.age, type: 'decision', text: `${dec.title}: ${opt.label} ${opt.title ?? ''}`.trim(), data: { kind: dec.kind, optionId: opt.id } })
      }
      s.ovr = clamp(s.ovr + ovrDelta, 40, 99)
      s.lastOutcome = { decisionId: dec?.id ?? '', optionId: opt?.id ?? optionId, rolledEffect: rolled, ovrDelta, summary: applied.map((e) => e.label).join(' · ') }

      // retirement chosen
      const retireNow = dec?.kind === 'retirement' && opt?.id === 'retire'
      const seasons: SeasonRecord[] = []
      const trophies: TrophyWin[] = []
      const awards: AwardWin[] = []
      if (!retireNow) {
        const n = PACE_SEASONS[s.pace]
        for (let i = 0; i < n && s.age < 40; i++) {
          const sr = rng(s.seed, 'season', s.season)
          const res = simulateSeason(data, s, sr, { forceCupWin: forceCupWin && i === 0, loanClub: !!s.parentClubId })
          seasons.push(res.record)
          trophies.push(...res.record.trophies)
          awards.push(...res.record.awards)
          log.push(...res.log)
          s.seasons.push(res.record)
          s.world.seasons[s.season] = res.world
          if (res.record.national) {
            s.national.apps += res.record.national.apps
            s.national.goals += res.record.national.goals
            s.national.assists += res.record.national.assists
            s.national.firstCallUp ??= s.season
            if (res.record.national.tournament) s.national.tournaments.push({ competitionId: res.record.national.tournament.competitionId, year: s.season + 1, reached: res.record.national.tournament.reached, apps: 7, goals: Math.round(res.record.national.goals / 2) })
            s.national.trophies.push(...res.record.trophies.filter((t) => t.scope === 'national'))
          }
          // promotion / relegation moves the club
          const lg = leagueById(data, res.record.leagueId)
          if (res.record.promoted && lg?.upperLeagueId) s.world.clubs[res.record.clubId] = { strength: strengthOf(data, s, res.record.clubId) + 2, leagueId: lg.upperLeagueId, prestige: clubOf(data, res.record.clubId)?.prestige ?? 1 }
          if (res.record.relegated && lg?.lowerLeagueId) s.world.clubs[res.record.clubId] = { strength: strengthOf(data, s, res.record.clubId) - 2, leagueId: lg.lowerLeagueId, prestige: clubOf(data, res.record.clubId)?.prestige ?? 1 }
          s.ovr = res.record.ovrEnd
          s.marketValue = res.record.marketValue
          s.age++
          s.season++
          s.world.nextSeason = s.season
        }
      }
      s.modifiers = {}
      s.period++

      // achievements (mock catalogue ids)
      const all = s.seasons
      const totalGoals = all.reduce((a, x) => a + x.stats.goals, 0)
      const prevGoals = prev.seasons.reduce((a, x) => a + x.stats.goals, 0)
      if (trophies.length && !prev.seasons.some((x) => x.trophies.length)) achievements.push('primeiro-titulo')
      if (totalGoals >= 100 && prevGoals < 100) achievements.push('centenario')
      if (awards.some((a) => a.award === 'ballon_dor' && a.place === 1)) achievements.push('bola-de-ouro')
      if (trophies.some((t) => t.competitionId === 'fifa.world')) achievements.push('campeao-do-mundo')
      if (s.ovr >= 90 && ovrBefore < 90) achievements.push('lenda-90')
      if (seasons.some((x) => x.promoted)) achievements.push('acesso')

      // next decision / finish
      const nr = rng(s.seed, 'next', s.period)
      const kind = retireNow ? null : nextDecisionKind(data, s, nr)
      if (!kind) {
        s.retired = true
        const lastAge = s.seasons[s.seasons.length - 1]?.age ?? s.age
        s.retiredReason = retireNow ? `Aposentou-se aos ${lastAge} anos` : `Pendurou as chuteiras aos ${lastAge} anos`
        s.phase = 'finished'
        s.pendingDecision = null
        log.push({ season: s.season, age: s.age, type: 'retired', text: s.retiredReason })
        achievements.push('fim-de-carreira')
      } else {
        s.pendingDecision = makeDecision(data, s, kind, nr)
        s.phase = 'deciding'
      }
      s.log.push(...log)

      const reveal: RevealScript = {
        optionId: opt?.id ?? optionId,
        rolledEffect: rolled,
        penalty,
        seasons,
        trophies,
        awards,
        relegated: seasons.some((x) => x.relegated),
        promoted: seasons.some((x) => x.promoted),
        ovrBefore,
        ovrAfter: s.ovr,
        valueBefore,
        valueAfter: s.marketValue,
        log,
        achievements,
        finished: s.phase === 'finished',
      }
      return { state: s, reveal }
    },

    summarize(data, s) {
      return summarizeCareer(data, s)
    },

    describeOption(_data, s, optionId) {
      return s.pendingDecision?.options.find((o) => o.id === optionId)?.effects ?? []
    },
  }
}

export function summarizeCareer(data: GameData, s: CareerState): CareerSummary {
  const byClub = new Map<string, CareerSummary['clubs'][number]>()
  for (const r of s.seasons) {
    const k = r.clubId
    const c = byClub.get(k) ?? { clubId: k, seasons: 0, apps: 0, goals: 0, assists: 0, trophies: 0, loan: r.loan }
    c.seasons++
    c.apps += r.stats.apps
    c.goals += r.stats.goals
    c.assists += r.stats.assists
    c.trophies += r.trophies.filter((t) => t.scope === 'club').length
    c.loan = c.loan && r.loan
    byClub.set(k, c)
  }
  const trophyMap = new Map<string, { trophyId: string; count: number; seasons: number[] }>()
  const awardMap = new Map<string, { award: AwardWin['award']; count: number; years: number[] }>()
  for (const r of s.seasons) {
    for (const t of r.trophies) {
      const e = trophyMap.get(t.trophyId) ?? { trophyId: t.trophyId, count: 0, seasons: [] }
      e.count++
      e.seasons.push(t.season)
      trophyMap.set(t.trophyId, e)
    }
    for (const a of r.awards) {
      if (a.place !== 1) continue
      const e = awardMap.get(a.award) ?? { award: a.award, count: 0, years: [] }
      e.count++
      e.years.push(a.year)
      awardMap.set(a.award, e)
    }
  }
  const totals = s.seasons.reduce(
    (a, r) => ({ apps: a.apps + r.stats.apps, goals: a.goals + r.stats.goals, assists: a.assists + r.stats.assists, cleanSheets: (a.cleanSheets ?? 0) + (r.stats.cleanSheets ?? 0) }),
    { apps: 0, goals: 0, assists: 0, cleanSheets: 0 } as CareerSummary['totals'],
  )
  const peak = s.seasons.reduce((b, r) => (r.ovrEnd > b.ovr ? { ovr: r.ovrEnd, age: r.age } : b), { ovr: s.ovr, age: s.age })
  const peakValue = s.seasons.reduce((m, r) => Math.max(m, r.marketValue), s.marketValue)
  const podiums = s.seasons.flatMap((r) => r.awards.filter((a) => a.award === 'ballon_dor').map((a) => ({ year: a.year, place: a.place })))
  const clubs = [...byClub.values()].sort((a, b) => b.seasons - a.seasons)
  const main = clubs[0] ? data.clubs.find((c) => c.id === clubs[0].clubId) : undefined
  const nTrophies = [...trophyMap.values()].reduce((a, t) => a + t.count, 0)
  const ballons = awardMap.get('ballon_dor')?.count ?? 0
  const libs = trophyMap.get('libertadores')?.count ?? 0
  const legacyScore = clamp(Math.round(peak.ovr * 0.45 + nTrophies * 1.6 + ballons * 8 + podiums.length * 2 + totals.goals / 25), 0, 100)
  const headline = ballons >= 3 ? 'Rei da Bola de Ouro' : libs >= 3 ? 'Rei da Libertadores' : main && clubs[0].seasons >= 8 ? `Lenda do ${main.name}` : main ? `Ídolo do ${main.name}` : 'Jogador profissional'
  const comparisons = [
    totals.goals >= 300 ? `Mais gols que Romário na carreira (${totals.goals})` : `${totals.goals} gols em ${totals.apps} jogos`,
    main ? `${clubs[0].goals} gols pelo ${main.name}` : '',
    ballons ? `${ballons}× Bola de Ouro — tantas quanto Ronaldo Fenômeno${ballons > 2 ? ' (e mais!)' : ''}` : '',
  ].filter(Boolean)
  return {
    identity: s.identity,
    seasons: s.seasons.length,
    clubs,
    totals,
    national: s.national,
    trophies: [...trophyMap.values()],
    awards: [...awardMap.values()],
    peakOvr: peak.ovr,
    peakOvrAge: peak.age,
    peakValue,
    ballonDorPodiums: podiums,
    legacyScore,
    headline,
    comparisons,
  }
}

export const mockEngine: CareerEngine = createMockEngine()
