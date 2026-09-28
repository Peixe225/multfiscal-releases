/**
 * Modo Imersivo — derivações puras para a UI (nada aqui muda estado).
 */
import type { CalendarItem, ImmersiveState, LiveMatch, MatchEvent, TeamSide } from '@/engine/immersive/types'
import type { Club, Country, League, Position, StandingRow } from '@/engine/types'
import { getClub, getCompetition, getCountry, getLeague, useData } from '@/store/data'
import type { ClubColors } from '@/ui/primitives'
import { clubColors, formatMoney, nationColors } from '@/ui/primitives'
import { contrast, darken, normHex } from '@/ui/theme/club'

export const isGk = (p: Position | undefined) => p === 'GOL'

/** Liga atual do jogador (o motor real informa; senão, a do clube). */
export const userLeagueId = (s: Pick<ImmersiveState, 'leagueId' | 'clubId'>) => s.leagueId ?? getClub(s.clubId)?.leagueId ?? null

export interface TeamInfo {
  id: string
  name: string
  short: string
  abbr: string
  club?: Club
  country?: Country
  colors: ClubColors
  national: boolean
}

/** Caminho de arquivo em public/ respeitando o base do Vite. */
export const publicUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`

const FALLBACK_COLORS: ClubColors = { primary: '#3a4bd8', secondary: '#0c1450', glow: '#3a4bd8' }

/** Clube ou seleção (código FIFA) → nome/sigla/cores. */
export function teamInfo(id: string | null | undefined, side?: TeamSide): TeamInfo {
  const club = id ? getClub(id) : undefined
  if (club) return { id: club.id, name: side?.name ?? club.name, short: side?.shortName ?? club.shortName, abbr: club.abbr, club, colors: clubColors(club), national: false }
  const country = id ? getCountry(id) : undefined
  if (country)
    return { id: country.code, name: side?.name ?? country.name, short: side?.shortName ?? country.name, abbr: country.code, country, colors: nationColors(country), national: true }
  const name = side?.name ?? id ?? '—'
  return { id: id ?? '?', name, short: side?.shortName ?? name, abbr: (side?.shortName ?? name).slice(0, 3).toUpperCase(), colors: FALLBACK_COLORS, national: !!side?.national }
}

export interface CompInfo {
  id: string
  name: string
  short: string
  logo?: string
  trophyId?: string
  league?: League
}

export function compInfo(id: string | null | undefined): CompInfo {
  if (!id) return { id: '', name: 'Partida', short: 'Partida' }
  if (id === 'friendly') return { id, name: 'Amistoso internacional', short: 'Amistoso' }
  const league = getLeague(id)
  if (league) return { id, name: league.name, short: league.shortName, logo: league.logo ? publicUrl(league.logo) : undefined, trophyId: league.trophyId, league }
  const comp = getCompetition(id)
  if (comp) return { id, name: comp.name, short: comp.name.replace(/^(CONMEBOL|UEFA|CONCACAF|CAF|AFC)\s+/i, ''), logo: comp.logo ? publicUrl(comp.logo) : undefined, trophyId: comp.trophyId }
  return { id, name: id, short: id }
}

// ───────────────────────── partida ─────────────────────────

export const userTeam = (l: LiveMatch) => (l.userSide === 'home' ? l.home : l.away)
export const oppTeam = (l: LiveMatch) => (l.userSide === 'home' ? l.away : l.home)
export const sideIdx = (side: 'home' | 'away') => (side === 'home' ? 0 : 1)

/** Placar reconstruído dos eventos já exibidos (evita "spoiler" durante o replay). */
export function scoreFrom(events: MatchEvent[]): [number, number] {
  const s: [number, number] = [0, 0]
  for (const e of events) {
    if (e.type === 'goal' || e.type === 'penalty_goal') s[sideIdx(e.side)]++
    else if (e.type === 'own_goal') s[sideIdx(e.side === 'home' ? 'away' : 'home')]++
  }
  return s
}

export const isGoal = (e: MatchEvent) => e.type === 'goal' || e.type === 'penalty_goal' || e.type === 'own_goal'

/** "67:12" a partir de um minuto fracionário. */
export function clockText(minute: number, phase?: LiveMatch['phase']): string {
  if (phase === 'half_time') return 'INT'
  if (phase === 'full_time') return 'FIM'
  if (phase === 'pre') return '00:00'
  const m = Math.floor(minute)
  const s = Math.floor((minute - m) * 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function ratingTone(r: number): 'gold' | 'good' | 'mid' | 'bad' {
  return r >= 8 ? 'gold' : r >= 7 ? 'good' : r >= 6 ? 'mid' : 'bad'
}
export const fmtRating = (r: number) => r.toFixed(1).replace('.', ',')

/** Probabilidades pré-jogo (heurística simples, só para o painel). */
export function winProbs(us: number, them: number, home: boolean): [number, number, number] {
  const d = us - them + (home ? 3 : -3)
  const w = 1 / (1 + Math.exp(-d / 7))
  const draw = Math.max(0.16, 0.3 - Math.abs(d) * 0.006)
  const win = (1 - draw) * w
  return [win, draw, 1 - draw - win]
}

// ───────────────────────── calendário ─────────────────────────

export const currentItem = (s: ImmersiveState): CalendarItem | null => s.calendar[s.cursor] ?? null

export function resultLetter(it: CalendarItem): 'V' | 'E' | 'D' | null {
  if (!it.result?.played && !it.result) return null
  const r = it.result
  if (!r) return null
  const [a, b] = it.home === false ? [r.score[1], r.score[0]] : r.score
  return a > b ? 'V' : a < b ? 'D' : 'E'
}

/** Últimos 5 resultados do jogador (partidas concluídas do calendário). */
export function recentForm(s: ImmersiveState, n = 5): ('V' | 'E' | 'D')[] {
  const out: ('V' | 'E' | 'D')[] = []
  for (let i = s.cursor - 1; i >= 0 && out.length < n; i--) {
    const it = s.calendar[i]
    if ((it.kind === 'match' || it.kind === 'national_match') && it.result) {
      const r = resultLetter(it)
      if (r) out.unshift(r)
    }
  }
  return out
}

/** Próxima partida (a atual, se for jogo). */
export function nextMatch(s: ImmersiveState): CalendarItem | null {
  for (let i = s.cursor; i < s.calendar.length; i++) {
    const it = s.calendar[i]
    if (!it.done && (it.kind === 'match' || it.kind === 'national_match')) return it
  }
  return null
}

export function weeksUntil(s: ImmersiveState, it: CalendarItem | null): number {
  return it ? Math.max(0, it.week - s.week) : 0
}

// ───────────────────────── tabela ─────────────────────────

export type ZoneKey = 'lib' | 'pre' | 'sul' | 'reb' | 'up' | null

export function zoneOf(league: League | undefined, pos: number, teams: number): ZoneKey {
  if (!league) return null
  const [p, s] = league.continentalSlots ?? [0, 0]
  if (league.tier > 1 && league.promotion && pos <= league.promotion) return 'up'
  if (league.relegation && pos > teams - league.relegation) return 'reb'
  if (league.tier === 1 && p && pos <= p) return 'lib'
  if (league.tier === 1 && s && pos <= p + s) return 'sul'
  return null
}

export const ZONE_LABEL: Record<Exclude<ZoneKey, null>, string> = {
  lib: 'Continental',
  pre: 'Pré-continental',
  sul: 'Copa secundária',
  reb: 'Rebaixamento',
  up: 'Acesso',
}

const SHORT_COMP: Record<string, string> = {
  'Copa Libertadores': 'Libertadores',
  'CONMEBOL Libertadores': 'Libertadores',
  'CONMEBOL Sul-Americana': 'Sul-Americana',
  'Copa Sul-Americana': 'Sul-Americana',
  'UEFA Champions League': 'Champions',
  'UEFA Europa League': 'Liga Europa',
  'UEFA Conference League': 'Conference',
}

/** Nome real da vaga da zona (Libertadores, Sul-Americana, Champions…) pela confederação da liga. */
export function zoneName(league: League | undefined, z: ZoneKey, short = false): string {
  if (!z) return ''
  if (z === 'reb') return short ? 'Z' + (league?.relegation ?? 4) : 'Rebaixamento'
  if (z === 'up') return 'Acesso'
  const conf = league ? useData.getState().data?.confederations?.[league.confed] : undefined
  const id = z === 'lib' ? conf?.primary : conf?.secondary
  const name = id ? getCompetition(id)?.name : undefined
  if (!name) return ZONE_LABEL[z]
  const s = SHORT_COMP[name] ?? name.replace(/^(CONMEBOL|UEFA|CONCACAF|CAF|AFC)\s+/i, '')
  return short ? s : s
}

export const goalDiff = (r: StandingRow) => r.gf - r.ga

// ───────────────────────── condição ─────────────────────────

export const levelOf = (v: number): 'good' | 'warn' | 'crit' | undefined => (v >= 70 ? 'good' : v < 40 ? 'crit' : v < 55 ? 'warn' : undefined)

/** "Semana 12 · Temporada 2026" */
export const weekLabel = (s: Pick<ImmersiveState, 'week' | 'season'>) => (s.week === 0 ? `Pré-temporada ${s.season}` : `Semana ${s.week} · ${s.season}`)

export type Forecast = { label: 'Titular provável' | 'Briga por vaga' | 'Banco provável' | 'Banco ou tribuna' | 'Fora dos relacionados' | 'Fora (lesão)' | 'Suspenso' | 'Sem clube'; tone: 'pos' | 'warn' | 'neg' }

/**
 * Previsão de escalação para o próximo jogo — a mesma conta do motor que vai decidir (motor real:
 * força do elenco, confiança do técnico, fase, energia, ritmo, rodízio e idade; mock: a regra dele).
 */
export function selectionForecast(s: ImmersiveState, engineKind?: string | null, importance = 0.4): Forecast {
  if (!s.clubId) return { label: 'Sem clube', tone: 'warn' }
  if (s.condition.injury) return { label: 'Fora (lesão)', tone: 'neg' }
  if ((s.condition.suspendedMatches ?? 0) > 0) return { label: 'Suspenso', tone: 'neg' }
  const club = getClub(s.clubId)
  const c = s.condition
  if (engineKind === 'mock') {
    const gap = s.ovr - (club?.strength ?? s.ovr)
    const score = s.relationships.coach + gap * 1.6 + (c.form - 50) * 0.2 - importance * 6
    return score >= 50 && c.fitness >= 30 ? { label: 'Titular provável', tone: 'pos' } : { label: 'Banco provável', tone: 'warn' }
  }
  const teamStr = (s.world?.clubs?.[s.clubId]?.strength as number | undefined) ?? club?.strength ?? s.ovr
  const rotation = importance < 0.5 && c.fitness < 72 ? -8 : 0
  const youth = s.age <= 17 ? -5 : 0
  const sel = (s.ovr - teamStr) * 3.2 + (s.relationships.coach - 50) * 0.45 + (c.form - 50) * 0.25 + (c.fitness - 75) * 0.35 + (c.sharpness - 50) * 0.08 + rotation + youth
  const gk = s.identity.position === 'GOL'
  if (sel >= 5) return { label: 'Titular provável', tone: 'pos' }
  if (sel >= -5) return { label: 'Briga por vaga', tone: 'warn' }
  if (sel >= (gk ? -30 : -22)) return { label: 'Banco provável', tone: 'warn' }
  // garoto da base abaixo do elenco: o técnico alterna banco (minutos da base) e tribuna
  if (s.age <= 19) return { label: 'Banco ou tribuna', tone: 'warn' }
  return { label: 'Fora dos relacionados', tone: 'neg' }
}

/** Compat: rótulo curto da previsão. */
export const likelyStarter = (s: ImmersiveState, engineKind?: string | null) => selectionForecast(s, engineKind).label

const lum = (hex: string) => {
  const m = hex.replace('#', '')
  const n = parseInt(m.length === 3 ? m.replace(/./g, (c) => c + c) : m, 16)
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}
/** Cor de time legível sobre a noite azul (preto vira a 2ª cor; igual ao rival vira alternativa). */
export function visibleColor(c: { primary: string; secondary: string }, avoid?: string): string {
  let out = lum(c.primary) < 0.16 ? (lum(c.secondary) >= 0.16 ? c.secondary : '#8A93C8') : c.primary
  if (avoid && out.toLowerCase() === avoid.toLowerCase()) out = out.toLowerCase() === c.secondary.toLowerCase() ? '#E5243B' : lum(c.secondary) >= 0.16 ? c.secondary : '#E5243B'
  return out
}

/** Dinheiro no padrão pt-BR (€4,3M; €850K). */
export const fmtMoney = (v: number | null | undefined, opts?: { sign?: boolean }) => formatMoney(v, opts).replace(/(\d)\.(\d)/, '$1,$2')

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
export const yearsLabel = (n: number) => plural(n, 'ano', 'anos')

/** "esta semana" · "há 1 sem." · "há 3 sem." · "2025" (temporadas anteriores). */
export function relWeek(s: Pick<ImmersiveState, 'week' | 'season'>, week: number, season?: number): string {
  if (season != null && season !== s.season) return season < s.season ? `temp. ${season}` : `sem. ${week}`
  const d = s.week - week
  if (d <= 0) return 'esta semana'
  if (d === 1) return 'há 1 sem.'
  return `há ${d} sem.`
}

/** Nome em caixa normal ("RIBEIRO" → "Ribeiro"); o CSS põe em caixa-alta onde o grafismo pede. */
export const titleCase = (x: string) => x.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())

/** Sobrenome para frases (evita "o RIBEIRO" no meio do texto). */
/**
 * Título de um item da agenda na voz da transmissão. Coletiva: "Coletiva pré-jogo · Vasco" (o motor
 * real escreve "Coletiva · antes de Brasileirão contra …"); `short` tira o prefixo repetido.
 */
export function itemTitle(it: Pick<CalendarItem, 'kind' | 'title' | 'opponentId'>, short = false): string {
  if (it.kind === 'press') {
    const opp = it.opponentId ? teamInfo(it.opponentId).short : null
    if (opp) return short ? `Pré-jogo · ${opp}` : `Coletiva pré-jogo · ${opp}`
    const t = it.title.replace(/^coletiva\s*[·:-]?\s*/i, '')
    return short ? t.charAt(0).toUpperCase() + t.slice(1) : it.title
  }
  return it.title
}

export const surnameOf = (s: Pick<ImmersiveState, 'identity'>) => (s.identity.surname === s.identity.surname.toUpperCase() ? titleCase(s.identity.surname) : s.identity.surname)

// ───────────────────────── lance decisivo ─────────────────────────

export type PenSide = 'left' | 'center' | 'right'

/** Lado de uma opção de pênalti: ids do motor (pen_left, dive_right, stay) ou do mock (left…); senão pela ordem. */
export function optionSide(id: string, index: number, count: number): PenSide {
  const x = id.toLowerCase()
  if (/left|esq/.test(x)) return 'left'
  if (/right|dir/.test(x)) return 'right'
  if (/center|centre|middle|meio|stay|mid/.test(x)) return 'center'
  if (count === 3) return (['left', 'center', 'right'] as const)[Math.max(0, Math.min(2, index))]
  return index === 0 ? 'left' : 'right'
}

/** Rótulos de sucesso/falha de um lance (sempre em par, com % complementares). */
export function outcomeOf(situation: string, optionId: string, label: string): { ok: string; fail: string; goal: boolean } {
  const id = `${optionId} ${label}`.toLowerCase()
  const shotish = /shot|chut|finaliz|bater|bate |pen_|cavad|goal|\bgol|cabece|chip|toque por cima|encobr|long|longe|cut_back|cortar e|direto|fk_direct|place|power|finesse/.test(id)
  const passish = /toc|passe|pass|lanç|lanc|enfi|through|escor|nod|tabela|assist/.test(id)
  switch (situation) {
    case 'penalty':
      return { ok: 'Gol', fail: 'Defesa / fora', goal: true }
    case 'penalty_save':
      return { ok: 'Defesa', fail: 'Gol deles', goal: false }
    case 'save':
      return { ok: 'Defesa', fail: 'Gol deles', goal: false }
    case 'tackle':
    case 'interception':
    case 'block':
      return { ok: 'Bola recuperada', fail: 'Passam por você', goal: false }
    default:
      if (shotish) return { ok: 'Gol', fail: 'Defesa / fora', goal: true }
      if (/cruz|cross|levant/.test(id)) return { ok: 'Chance criada', fail: 'Cruzamento cortado', goal: false }
      if (passish) return { ok: 'Passe certo', fail: 'Passe cortado', goal: false }
      if (/drib|passar|corte|finta|carreg|arranc/.test(id)) return { ok: 'Passa pelo marcador', fail: 'Perde a bola', goal: false }
      return { ok: 'Jogada certa', fail: 'Perde a posse', goal: false }
  }
}

// ───────────────────────── você na partida (no relógio do replay) ─────────────────────────

export interface PitchPresence {
  /** Em campo no minuto exibido. */
  on: boolean
  /** Já entrou em algum momento (nota vale). */
  played: boolean
  /** Minuto de entrada / saída (no replay). */
  entered: number | null
  left: number | null
  minutes: number
  label: 'Em campo' | 'No banco' | 'Substituído' | 'Expulso' | 'Tribuna'
}

/**
 * Status do jogador no minuto EXIBIDO (não no estado final do motor): durante o replay, o banco só
 * entra quando o evento de substituição dele é revelado.
 */
export function presenceAt(live: LiveMatch, shown: MatchEvent[], clock: number, settled: boolean): PitchPresence {
  const subOn = shown.find((e) => e.type === 'sub_on' && e.byUser)
  const out = shown.find((e) => (e.type === 'sub_off' || e.type === 'red') && e.byUser)
  let entered: number | null = live.userStatus === 'starter' ? 0 : subOn ? subOn.minute : null
  // estado final já exibido: confia no motor (entrou sem evento explícito)
  if (settled && entered == null && (live.userOnPitch || live.stats.minutes > 0)) entered = Math.max(0, Math.round(clock - live.stats.minutes))
  const left = out ? out.minute : settled && entered != null && !live.userOnPitch && live.phase !== 'full_time' ? Math.round(entered + live.stats.minutes) : null
  const on = entered != null && left == null && (settled ? live.userOnPitch || live.phase === 'half_time' : true)
  const end = left ?? clock
  const minutes = entered == null ? 0 : Math.max(0, Math.round(end - entered))
  const label = on ? 'Em campo' : out?.type === 'red' ? 'Expulso' : entered != null ? 'Substituído' : live.userStatus === 'out' ? 'Tribuna' : 'No banco'
  return { on, played: entered != null, entered, left, minutes, label }
}

// ───────────────────────── cores de placar ─────────────────────────

/** Placar de celebração: club → club-2 com a tinta legível nas DUAS pontas (preto/branco não "some"). */
export function scoreColors(c: ClubColors): { '--club': string; '--club-2': string; '--club-ink': string } {
  const p = normHex(c.primary)
  let q = normHex(c.secondary)
  const ink = contrast(p, '#ffffff') >= contrast(p, '#07103a') ? '#ffffff' : '#07103a'
  if (contrast(q, ink) < 3) q = ink === '#ffffff' ? darken(p, 0.45) : darken(p, 0.12)
  return { '--club': p, '--club-2': q, '--club-ink': ink }
}

export const compactNumber = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',')} mi` : n >= 1e4 ? `${Math.round(n / 1000)} mil` : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')} mil` : String(n)
