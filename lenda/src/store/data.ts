/**
 * GameData store — loads the static data pack once (real pipeline if `src/data/index.ts`
 * exists, otherwise the tiny mock pack) and builds lookup indexes.
 *
 *   const { status, data, index, source } = useData()
 *   const club = useClub('e2029')         // Club | undefined
 *   getClub('e2029')                       // non-hook
 */
import { create } from 'zustand'
import type { Club, Competition, Country, GameData, League, RealPlayer, Trophy } from '@/engine/types'
import { configureCrests } from '@/ui/primitives/crestAtlas'

export interface GameIndex {
  clubById: Map<string, Club>
  leagueById: Map<string, League>
  countryByCode: Map<string, Country>
  countryByIso2: Map<string, Country>
  trophyById: Map<string, Trophy>
  competitionById: Map<string, Competition>
  starById: Map<string, RealPlayer>
  clubsByLeague: Map<string, Club[]>
  clubsByCountry: Map<string, Club[]>
}

export type DataSource = 'real' | 'mock'

interface DataStore {
  status: 'idle' | 'loading' | 'ready' | 'error'
  data: GameData | null
  index: GameIndex | null
  source: DataSource | null
  error: string | null
  /** 0–1 (for the splash bar). */
  progress: number
  load(): Promise<GameData>
  /** Replace the data pack (tests / fixtures). */
  setData(data: GameData, source: DataSource): void
}

export function buildIndex(d: GameData): GameIndex {
  const clubById = new Map<string, Club>()
  const clubsByLeague = new Map<string, Club[]>()
  const clubsByCountry = new Map<string, Club[]>()
  for (const c of d.clubs ?? []) {
    clubById.set(c.id, c)
    if (!clubsByLeague.has(c.leagueId)) clubsByLeague.set(c.leagueId, [])
    clubsByLeague.get(c.leagueId)!.push(c)
    if (!clubsByCountry.has(c.country)) clubsByCountry.set(c.country, [])
    clubsByCountry.get(c.country)!.push(c)
  }
  const countryByCode = new Map<string, Country>()
  const countryByIso2 = new Map<string, Country>()
  for (const c of d.countries ?? []) {
    countryByCode.set(c.code, c)
    if (c.iso2) countryByIso2.set(c.iso2, c)
  }
  return {
    clubById,
    clubsByLeague,
    clubsByCountry,
    countryByCode,
    countryByIso2,
    leagueById: new Map((d.leagues ?? []).map((l) => [l.id, l])),
    trophyById: new Map((d.trophies ?? []).map((t) => [t.id, t])),
    competitionById: new Map((d.competitions ?? []).map((c) => [c.id, c])),
    starById: new Map((d.stars ?? []).map((s) => [s.id, s])),
  }
}

// Defensive: the data team's module may not exist yet — a glob returns {} instead of failing the build.
const dataModules = import.meta.glob('../data/index.ts')

let inflight: Promise<GameData> | null = null

export const useData = create<DataStore>()((set, get) => ({
  status: 'idle',
  data: null,
  index: null,
  source: null,
  error: null,
  progress: 0,
  setData: (data, source) => set({ data, index: buildIndex(data), source, status: 'ready', error: null, progress: 1 }),
  load: () => {
    const s = get()
    if (s.data) return Promise.resolve(s.data)
    if (inflight) return inflight
    set({ status: 'loading', progress: 0.1 })
    inflight = (async () => {
      let data: GameData | null = null
      let source: DataSource = 'mock'
      const loader = dataModules['../data/index.ts']
      if (loader) {
        try {
          const mod = (await loader()) as Record<string, unknown>
          set({ progress: 0.45 })
          const fn = (mod.loadGameData ?? mod.default) as undefined | (() => Promise<GameData> | GameData)
          if (typeof fn === 'function') {
            const d = await fn()
            if (d && Array.isArray(d.clubs) && d.clubs.length) {
              data = d
              source = 'real'
            }
          }
          const cols = Number(mod.ATLAS_COLS)
          const size = Number(mod.CREST_SIZE)
          configureCrests({ cols: cols > 0 ? cols : undefined, cell: size > 0 ? size : undefined })
        } catch (err) {
          console.warn('[LENDA] loadGameData falhou — usando dados de exemplo.', err)
        }
      }
      let final: GameData
      if (data) final = data
      else {
        const mock = await import('@/ui/classic/mock/mockData')
        final = mock.mockGameData
        source = 'mock'
      }
      set({ data: final, index: buildIndex(final), source, status: 'ready', progress: 1, error: null })
      return final
    })().catch((err) => {
      inflight = null
      set({ status: 'error', error: String(err?.message ?? err) })
      throw err
    })
    return inflight
  },
}))

// ── non-hook getters ──
const idx = () => useData.getState().index
export const getClub = (id: string | null | undefined) => (id ? idx()?.clubById.get(id) : undefined)
export const getLeague = (id: string | null | undefined) => (id ? idx()?.leagueById.get(id) : undefined)
export const getCountry = (code: string | null | undefined) => (code ? idx()?.countryByCode.get(code) : undefined)
export const getTrophy = (id: string | null | undefined) => (id ? idx()?.trophyById.get(id) : undefined)
export const getCompetition = (id: string | null | undefined) => (id ? idx()?.competitionById.get(id) : undefined)

// ── hooks ──
export const useGameData = () => useData((s) => s.data)
export const useGameIndex = () => useData((s) => s.index)
export const useClub = (id: string | null | undefined) => useData((s) => (id ? s.index?.clubById.get(id) : undefined))
export const useLeague = (id: string | null | undefined) => useData((s) => (id ? s.index?.leagueById.get(id) : undefined))
export const useCountry = (code: string | null | undefined) => useData((s) => (code ? s.index?.countryByCode.get(code) : undefined))
export const useTrophy = (id: string | null | undefined) => useData((s) => (id ? s.index?.trophyById.get(id) : undefined))
export const useCompetition = (id: string | null | undefined) => useData((s) => (id ? s.index?.competitionById.get(id) : undefined))
