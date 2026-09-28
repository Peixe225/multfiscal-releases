/**
 * Modo Imersivo — derivações puras para a UI (nada aqui muda estado).
 */
import type { CalendarItem, ImmersiveState, LiveMatch, MatchEvent, TeamSide } from '@/engine/immersive/types'
import type { Club, Country, League, Position, StandingRow } from '@/engine/types'
import { getClub, getCompetition, getCountry, getLeague } from '@/store/data'
import type { ClubColors } from '@/ui/primitives'
import { clubColors, nationColors } from '@/ui/primitives'

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

export const goalDiff = (r: StandingRow) => r.gf - r.ga

// ───────────────────────── condição ─────────────────────────

export const levelOf = (v: number): 'good' | 'warn' | 'crit' | undefined => (v >= 70 ? 'good' : v < 40 ? 'crit' : v < 55 ? 'warn' : undefined)

/** "Semana 12 · Temporada 2026" */
export const weekLabel = (s: Pick<ImmersiveState, 'week' | 'season'>) => (s.week === 0 ? `Pré-temporada ${s.season}` : `Semana ${s.week} · ${s.season}`)

/** Titular provável? (mesma ideia do motor: confiança do técnico + forma + energia) */
export function likelyStarter(s: ImmersiveState): 'Titular provável' | 'Banco provável' | 'Fora (lesão)' | 'Suspenso' {
  if (s.condition.injury) return 'Fora (lesão)'
  if ((s.condition.suspendedMatches ?? 0) > 0) return 'Suspenso'
  const club = getClub(s.clubId)
  const gap = s.ovr - (club?.strength ?? s.ovr)
  const score = s.relationships.coach + gap * 1.6 + (s.condition.form - 50) * 0.2
  return score >= 50 && s.condition.fitness >= 30 ? 'Titular provável' : 'Banco provável'
}

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

export const compactNumber = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',')} mi` : n >= 1e4 ? `${Math.round(n / 1000)} mil` : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')} mil` : String(n)
