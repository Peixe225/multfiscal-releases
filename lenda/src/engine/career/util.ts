/**
 * Utilitários do motor da carreira: formatação para a UI, índices de GameData e preposições pt-BR.
 */
import type {
  Club,
  Competition,
  CompetitionKind,
  Confed,
  Country,
  GameData,
  League,
  Position,
  PositionGroup,
  SquadRole,
  Trophy,
  WorldState,
} from '../types'
import type { RateRole } from './constants'

// ───────────────────────── formatação (UI) ─────────────────────────

/** Regra do Copero: ≥ €1M → "€5.5M" (1 casa até €10M, depois inteiro); abaixo → "€380K". */
export function formatMoney(v: number): string {
  const n = Math.max(0, v)
  if (n >= 1e6) return `€${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  return `€${Math.round(n / 1e3)}K`
}

const ROLE_LABELS: Record<SquadRole, string> = {
  starter: 'Titular',
  high_rotation: 'Rotação',
  low_rotation: 'Rotação baixa',
  substitute: 'Reserva',
  third_keeper: 'Terceiro goleiro',
}

export function roleLabel(role: SquadRole): string {
  return ROLE_LABELS[role]
}

/** Rótulo curto do papel previsto nos cards de oferta (Titular / Rotação / Reserva). */
export function roleShortLabel(role: SquadRole): string {
  if (role === 'starter') return 'Titular'
  if (role === 'high_rotation' || role === 'low_rotation') return 'Rotação'
  return 'Reserva'
}

/** Mesmo agrupamento do mundo (src/engine/world/awards.ts): defesa, meio (apoio), ataque. */
export function positionGroup(position: Position): PositionGroup {
  switch (position) {
    case 'GOL':
      return 'goalkeeper'
    case 'ZAG':
    case 'LD':
    case 'LE':
    case 'VOL':
      return 'defensive'
    case 'MC':
    case 'ME':
    case 'MD':
    case 'MEI':
      return 'support'
    default:
      return 'attacking'
  }
}

/** Família de taxas do Copero (atacante / criador / apoio / defensivo / goleiro). */
export function rateRole(position: Position): RateRole {
  switch (position) {
    case 'PE':
    case 'CA':
    case 'PD':
      return 'attacker'
    case 'ME':
    case 'MEI':
    case 'MD':
      return 'creator'
    case 'LE':
    case 'MC':
    case 'LD':
      return 'support'
    case 'VOL':
    case 'ZAG':
      return 'defensive'
    default:
      return 'goalkeeper'
  }
}

export const POSITION_NAMES: Record<Position, string> = {
  GOL: 'Goleiro',
  ZAG: 'Zagueiro',
  LD: 'Lateral-direito',
  LE: 'Lateral-esquerdo',
  VOL: 'Volante',
  MC: 'Meio-campista',
  ME: 'Meia-esquerda',
  MD: 'Meia-direita',
  MEI: 'Meia',
  PE: 'Ponta-esquerda',
  PD: 'Ponta-direita',
  CA: 'Centroavante',
}

export function ordinal(n: number): string {
  return `${n}º`
}

// ───────────────────────── índices de GameData ─────────────────────────

export interface DataIndex {
  club: Map<string, Club>
  league: Map<string, League>
  country: Map<string, Country>
  competition: Map<string, Competition>
  trophy: Map<string, Trophy>
  /** Clubes que jogam uma liga simulada (candidatos a ofertas). */
  simClubs: Club[]
  clubsByCountry: Map<string, Club[]>
  countriesByConfed: Map<Confed, Country[]>
}

const INDEX = new WeakMap<GameData, DataIndex>()

export function indexData(data: GameData): DataIndex {
  const hit = INDEX.get(data)
  if (hit) return hit
  const league = new Map(data.leagues.map((l) => [l.id, l]))
  const club = new Map(data.clubs.map((c) => [c.id, c]))
  const simClubs = data.clubs.filter((c) => league.has(c.leagueId))
  const clubsByCountry = new Map<string, Club[]>()
  for (const c of simClubs) {
    const list = clubsByCountry.get(c.country)
    if (list) list.push(c)
    else clubsByCountry.set(c.country, [c])
  }
  const countriesByConfed = new Map<Confed, Country[]>()
  for (const c of data.countries) {
    const list = countriesByConfed.get(c.confed)
    if (list) list.push(c)
    else countriesByConfed.set(c.confed, [c])
  }
  const idx: DataIndex = {
    club,
    league,
    country: new Map(data.countries.map((c) => [c.code, c])),
    competition: new Map(data.competitions.map((c) => [c.id, c])),
    trophy: new Map(data.trophies.map((t) => [t.id, t])),
    simClubs,
    clubsByCountry,
    countriesByConfed,
  }
  INDEX.set(data, idx)
  return idx
}

/** Liga atual do clube (o mundo move clubes por acesso/rebaixamento). */
export function clubLeagueId(world: WorldState, club: Club): string {
  return world.clubs[club.id]?.leagueId ?? club.leagueId
}

export function clubStrength(world: WorldState, club: Club): number {
  return world.clubs[club.id]?.strength ?? club.strength
}

export function clubPrestige(world: WorldState, club: Club): number {
  return world.clubs[club.id]?.prestige ?? club.prestige
}

export function clubLeague(data: GameData, world: WorldState, club: Club): League | undefined {
  return indexData(data).league.get(clubLeagueId(world, club))
}

export function clubConfed(data: GameData, club: Club): Confed {
  const idx = indexData(data)
  return idx.league.get(club.leagueId)?.confed ?? idx.country.get(club.country)?.confed ?? 'UEFA'
}

/**
 * OVR mínimo para ser convocado, pela força da seleção (a mesma regra vale para todas; a posição na
 * fila da sua posição é checada à parte). Interpolação linear entre os pontos: potências (Espanha,
 * França, Argentina, Inglaterra, Brasil, Portugal, Alemanha: 80–82, o nível de quem fecha a lista
 * delas no EA FC), médias (Colômbia, Uruguai, Suíça 76; EUA, México, Japão 74), fracas bem abaixo
 * (70 → 65; 60 → 56) e as minúsculas quase sem corte (40 → 44).
 */
const CALL_UP_CURVE: [number, number][] = [
  [40, 44],
  [55, 51],
  [65, 60],
  [75, 70],
  [80, 74],
  [84, 77],
  [87, 80],
  [90, 81],
  [95, 82],
]

export function callUpOvr(country: Pick<Country, 'strength'>): number {
  const x = country.strength
  const pts = CALL_UP_CURVE
  if (x <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x0, y0] = pts[i - 1]
    if (x <= x1) return Math.round(y0 + ((y1 - y0) * (x - x0)) / (x1 - x0))
  }
  return pts[pts.length - 1][1]
}

export function nationStrength(data: GameData, world: WorldState, code: string): number {
  return world.nations[code] ?? indexData(data).country.get(code)?.strength ?? 60
}

export function competitionKind(data: GameData, competitionId: string): CompetitionKind | undefined {
  const idx = indexData(data)
  if (idx.league.has(competitionId)) return 'league'
  return idx.competition.get(competitionId)?.kind
}

export function trophyName(data: GameData, trophyId: string, fallback?: string): string {
  return indexData(data).trophy.get(trophyId)?.name ?? fallback ?? trophyId
}

export function clubName(data: GameData, clubId: string | null | undefined): string {
  if (!clubId) return 'Sem clube'
  const c = indexData(data).club.get(clubId)
  return c?.shortName ?? c?.name ?? clubId
}

export function countryName(data: GameData, code: string): string {
  return indexData(data).country.get(code)?.name ?? code
}

/** Competição continental principal/secundária de uma confederação. */
export function confedCompetition(data: GameData, confed: Confed, which: 'primary' | 'secondary' | 'national'): Competition | undefined {
  const idx = indexData(data)
  const byMeta = data.confederations?.[confed]?.[which]
  if (byMeta && idx.competition.has(byMeta)) return idx.competition.get(byMeta)
  const kind: CompetitionKind =
    which === 'primary' ? 'continental_primary' : which === 'secondary' ? 'continental_secondary' : 'national_continental'
  return data.competitions.find((c) => c.kind === kind && c.confed === confed && !c.superCup)
}

/** Temporadas (ano de início) em que um torneio não anual termina: disputa no ano T ⇒ temporada T−1. */
export function tournamentInSeason(comp: Competition, season: number): boolean {
  if (!comp.schedule) return comp.kind !== 'world_cup' && comp.kind !== 'national_continental'
  const year = season + 1
  const { firstYear, every } = comp.schedule
  return year >= firstYear && (year - firstYear) % every === 0
}

// ───────────────────────── pt-BR: artigo do clube ─────────────────────────

const FEMININE_WORDS = [
  'juventus', 'roma', 'lazio', 'fiorentina', 'atalanta', 'udinese', 'sampdoria', 'salernitana', 'cremonese',
  'real sociedad', 'chapecoense', 'ponte preta', 'portuguesa', 'juventude', 'ferroviária', 'tombense',
  'inter de milão', 'internazionale', 'inter milan', 'reggiana', 'spezia', 'ternana', 'sambenedettese',
  'lusitana', 'académica', 'naval', 'real sociedade', 'gimnástica', 'cultural leonesa', 'ponferradina',
]

const MASCULINE_OVERRIDES = ['inter miami', 'internacional', 'america', 'américa']

/** "no"/"na" — Copero escrevia sempre "no" ("no Juventus"). */
export function clubArticle(club: Pick<Club, 'name' | 'shortName'> | undefined): 'o' | 'a' {
  if (!club) return 'o'
  const names = [club.name, club.shortName].map((n) => n.toLowerCase())
  if (names.some((n) => MASCULINE_OVERRIDES.some((w) => n.includes(w)))) return 'o'
  if (names.some((n) => FEMININE_WORDS.some((w) => n === w || n.startsWith(w + ' ') || n.endsWith(' ' + w) || n.includes(w))))
    return 'a'
  return 'o'
}

/** "Ficar no" / "Ficar na". */
export function withArticle(prefix: 'em' | 'a' | 'de', club: Pick<Club, 'name' | 'shortName'> | undefined): string {
  const a = clubArticle(club)
  if (prefix === 'em') return a === 'a' ? 'na' : 'no'
  if (prefix === 'de') return a === 'a' ? 'da' : 'do'
  return a === 'a' ? 'à' : 'ao'
}

// ───────────────────────── diversos ─────────────────────────

export function round1(v: number): number {
  return Math.round(v * 10) / 10
}

/** Arredondamento probabilístico (mantém a média de valores fracionários). */
export function stochasticRound(v: number, u: number): number {
  const f = Math.floor(v)
  return u < v - f ? f + 1 : f
}

export function sum(values: number[]): number {
  let t = 0
  for (const v of values) t += v
  return t
}

export function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
