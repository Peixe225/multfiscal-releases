/** Utilitários do motor imersivo (puros). */
import { clamp, rng as subRng, type Rng } from '../rng'
import type { Club, Competition, Country, GameData, League, WorldState } from '../types'
import { indexData as worldIndex } from '../world/context'
import type { ImmersiveState } from './types'
import { mem } from './mem'

export { clamp }

export const r1 = (v: number) => Math.round(v * 10) / 10

/** Clona tudo menos o mundo (o mundo só é trocado inteiro, nunca mutado). */
export function cloneState(st: ImmersiveState): ImmersiveState {
  const { world, ...rest } = st
  const c = structuredClone(rest) as ImmersiveState
  c.world = world
  return c
}

/** Sub-stream reprodutível do motor imersivo. */
export function irng(s: ImmersiveState, ...keys: (string | number)[]): Rng {
  return subRng(s.seed, 'imm', ...keys)
}

/**
 * Sub-stream posicional (temporada, semana, item atual) + chaves do sorteio. Não depende do número de
 * ações (ler a caixa de entrada ou um clique inválido não muda sorteios futuros).
 */
export function trng(s: ImmersiveState, ...keys: (string | number)[]): Rng {
  return subRng(s.seed, 'imm', 'p', s.season, s.week, s.cursor, s.calendar[s.cursor]?.id ?? '-', ...keys)
}

export function ix(data: GameData) {
  return worldIndex(data)
}

export function clubOf(data: GameData, id: string | null | undefined): Club | undefined {
  return id ? ix(data).club.get(id) : undefined
}

export function countryOf(data: GameData, code: string | null | undefined): Country | undefined {
  return code ? ix(data).country.get(code) : undefined
}

export function compOf(data: GameData, id: string | undefined): Competition | undefined {
  return id ? ix(data).comp.get(id) : undefined
}

export function leagueById(data: GameData, id: string | undefined | null): League | undefined {
  return id ? ix(data).league.get(id) : undefined
}

export function clubLeagueId(world: WorldState, data: GameData, clubId: string | null | undefined): string | undefined {
  if (!clubId) return undefined
  return world.clubs[clubId]?.leagueId ?? clubOf(data, clubId)?.leagueId
}

export function clubStrength(world: WorldState, data: GameData, clubId: string | null | undefined): number {
  if (!clubId) return 60
  return world.clubs[clubId]?.strength ?? clubOf(data, clubId)?.strength ?? 60
}

export function clubPrestige(world: WorldState, data: GameData, clubId: string | null | undefined): number {
  if (!clubId) return 0
  return world.clubs[clubId]?.prestige ?? clubOf(data, clubId)?.prestige ?? 0
}

export function nationStrength(world: WorldState, data: GameData, code: string): number {
  return world.nations[code] ?? countryOf(data, code)?.strength ?? 60
}

/** Nome curto de clube ou seleção. */
export function teamShort(data: GameData, id: string): string {
  const c = clubOf(data, id)
  if (c) return c.shortName || c.name
  return countryOf(data, id)?.name ?? id
}

export function teamName(data: GameData, id: string): string {
  const c = clubOf(data, id)
  if (c) return c.name
  return countryOf(data, id)?.name ?? id
}

/** Nome de competição (liga ou copa). */
export function competitionName(data: GameData, id: string | undefined): string {
  if (!id) return 'Amistoso'
  const l = leagueById(data, id)
  if (l) return l.shortName || l.name
  if (id === 'friendly') return 'Amistoso internacional'
  if (id === 'qualifiers') return 'Eliminatórias'
  return compOf(data, id)?.name ?? id
}

/** "no"/"na" — igual ao Clássico. */
export function artigo(club: Pick<Club, 'name' | 'shortName'> | undefined): 'o' | 'a' {
  if (!club) return 'o'
  const n = `${club.name} ${club.shortName}`.toLowerCase()
  if (/inter miami|internacional|america|américa/.test(n)) return 'o'
  if (/juventus|roma\b|lazio|fiorentina|atalanta|udinese|sampdoria|real sociedad|chapecoense|ponte preta|portuguesa|juventude|ferroviária|internazionale|inter de milão/.test(n)) return 'a'
  return 'o'
}

export const no = (c: Club | undefined) => (artigo(c) === 'a' ? 'na' : 'no')
export const do_ = (c: Club | undefined) => (artigo(c) === 'a' ? 'da' : 'do')

export function formatMoney(v: number): string {
  if (v >= 1_000_000) {
    const m = v / 1_000_000
    return `€${m >= 10 ? Math.round(m) : m.toFixed(1).replace('.0', '').replace('.', ',')}M`
  }
  if (v >= 1000) return `€${Math.round(v / 1000)}K`
  return `€${Math.round(v)}`
}

/** Slug de handle (@torcida_palmeiras). */
export function slug(x: string): string {
  return x
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 16)
}

export function capitalize(x: string): string {
  return x ? x.charAt(0).toUpperCase() + x.slice(1).toLowerCase() : x
}

export function pickWeighted<T>(r: Rng, items: readonly T[], w: (t: T) => number): T {
  return r.weighted(items, w)
}

export function ordinalRound(n: number): string {
  return `${n}ª rodada`
}

/** Mantém listas de feed curtas (estado compacto). */
export function cap<T>(list: T[], n: number): T[] {
  return list.length > n ? list.slice(0, n) : list
}

export function nextId(s: ImmersiveState, prefix: string): string {
  const m = mem(s)
  m.idSeq = (m.idSeq ?? 0) + 1
  return `${prefix}-${m.idSeq}`
}

/** "o Flamengo" / "a Juventus" / "Bolívia" (seleções sem artigo). */
export function withArt(data: GameData, id: string | undefined, fallback = 'o adversário'): string {
  if (!id) return fallback
  const c = clubOf(data, id)
  if (c) return `${artigo(c)} ${c.shortName || c.name}`
  return countryOf(data, id)?.name ?? id
}
