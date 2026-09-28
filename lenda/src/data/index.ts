/**
 * Pacote de dados estáticos do LENDA (gerado por `npm run data`).
 *
 *   const data = await loadGameData()      // GameData (import dinâmico → chunk separado)
 *   const ix = indexes(data)               // índices memoizados
 *   ix.clubById.get('e819')
 *   <div style={crestStyle(club.crest, 32)} />
 */
import type { Club, Competition, Country, CrestRef, GameData, League, RealPlayer, Trophy } from '../engine/types'

/** Grade dos atlas de escudos (public/crests/<liga>.webp): colunas × células de CREST_SIZE px. */
export const ATLAS_COLS = 8
export const CREST_SIZE = 128

let dataPromise: Promise<GameData> | null = null

/** Carrega o GameData uma única vez (o JSON vira um chunk próprio no build). */
export function loadGameData(): Promise<GameData> {
  if (!dataPromise) {
    dataPromise = import('./generated/game-data.json')
      .then((m) => ((m as { default?: unknown }).default ?? m) as unknown as GameData)
      .catch((err) => {
        dataPromise = null
        throw err
      })
  }
  return dataPromise
}

export default loadGameData

/** Jogador de elenco (modo Imersivo). `ovr` vem da EA FC 27 quando `ea` = true; senão é estimado. */
export interface RosterPlayer {
  name: string
  position: RealPlayer['position']
  age: number
  nationality: string
  number?: number
  ovr: number
  ea?: true
}

export interface RostersPack {
  generatedAt: string
  clubs: Record<string, RosterPlayer[]>
}

let rostersPromise: Promise<RostersPack> | null = null

/** Elencos completos por clube (arquivo separado, só para o modo Imersivo). */
export function loadRosters(): Promise<RostersPack> {
  if (!rostersPromise) {
    rostersPromise = import('./generated/rosters.json?url')
      .then((m) => fetch(m.default))
      .then((r) => {
        if (!r.ok) throw new Error(`rosters.json: HTTP ${r.status}`)
        return r.json() as Promise<RostersPack>
      })
      .catch((err) => {
        rostersPromise = null
        throw err
      })
  }
  return rostersPromise
}

export interface GameIndexes {
  clubById: Map<string, Club>
  leagueById: Map<string, League>
  countryByCode: Map<string, Country>
  trophyById: Map<string, Trophy>
  competitionById: Map<string, Competition>
  starById: Map<string, RealPlayer>
  /** Clubes de uma liga no início da temporada 2026 (ordem da tabela real). */
  clubsInLeague(leagueId: string): Club[]
  /** Clubes de um país (ligas simuladas + extras). */
  clubsInCountry(code: string): Club[]
}

const indexCache = new WeakMap<GameData, GameIndexes>()

/** Índices memoizados por instância de GameData. */
export function indexes(data: GameData): GameIndexes {
  const hit = indexCache.get(data)
  if (hit) return hit
  const clubById = new Map(data.clubs.map((c) => [c.id, c]))
  const byLeague = new Map<string, Club[]>()
  const byCountry = new Map<string, Club[]>()
  for (const c of data.clubs) {
    if (!byLeague.has(c.leagueId)) byLeague.set(c.leagueId, [])
    byLeague.get(c.leagueId)!.push(c)
    if (!byCountry.has(c.country)) byCountry.set(c.country, [])
    byCountry.get(c.country)!.push(c)
  }
  // ordena cada liga pela tabela real de hoje
  for (const [lid, list] of byLeague) {
    const order = new Map((data.standings[lid] ?? []).map((r, i) => [r.clubId, i]))
    list.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
  }
  const ix: GameIndexes = {
    clubById,
    leagueById: new Map(data.leagues.map((l) => [l.id, l])),
    countryByCode: new Map(data.countries.map((c) => [c.code, c])),
    trophyById: new Map(data.trophies.map((t) => [t.id, t])),
    competitionById: new Map(data.competitions.map((c) => [c.id, c])),
    starById: new Map(data.stars.map((s) => [s.id, s])),
    clubsInLeague: (leagueId) => byLeague.get(leagueId) ?? [],
    clubsInCountry: (code) => byCountry.get(code) ?? [],
  }
  indexCache.set(data, ix)
  return ix
}

export const clubById = (data: GameData, id: string) => indexes(data).clubById.get(id)
export const leagueById = (data: GameData, id: string) => indexes(data).leagueById.get(id)
export const countryByCode = (data: GameData, code: string) => indexes(data).countryByCode.get(code)
export const trophyById = (data: GameData, id: string) => indexes(data).trophyById.get(id)
export const competitionById = (data: GameData, id: string) => indexes(data).competitionById.get(id)
export const clubsInLeague = (data: GameData, leagueId: string) => indexes(data).clubsInLeague(leagueId)

/** URL pública de um arquivo em public/ respeitando o `base` do Vite. */
export const publicUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`

/**
 * CSS para desenhar um escudo do atlas num elemento de `size` px:
 *   <span style={crestStyle(club.crest, 28)} />
 */
export function crestStyle(ref: CrestRef | undefined, size = 32): Record<string, string> {
  if (!ref) return { width: `${size}px`, height: `${size}px` }
  const col = ref.index % ATLAS_COLS
  const row = Math.floor(ref.index / ATLAS_COLS)
  return {
    width: `${size}px`,
    height: `${size}px`,
    backgroundImage: `url(${publicUrl(`crests/${ref.atlas}`)})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${ATLAS_COLS * size}px auto`,
    backgroundPosition: `-${col * size}px -${row * size}px`,
  }
}

/** Caminho da bandeira 4x3 de um país (public/flags/4x3/<iso2>.svg). */
export const flagUrl = (country: Pick<Country, 'iso2'>) => publicUrl(`flags/4x3/${country.iso2}.svg`)

/** Caminho do logo de uma liga/competição, se existir. */
export const logoUrl = (x: { logo?: string }) => (x.logo ? publicUrl(x.logo) : undefined)
