/**
 * Live standings from ESPN (CORS open):
 *   https://site.api.espn.com/apis/v2/sports/soccer/{espnSlug}/standings
 * Teams are matched to our clubs by ESPN id; unknown teams keep ESPN's name/logo.
 */
import { create } from 'zustand'
import type { Club, StandingRow } from '@/engine/types'

export interface LiveTeam {
  espnId: string
  name: string
  abbr: string
  logo?: string
}

export interface LiveTable {
  rows: StandingRow[]
  /** ESPN rank per clubId (tables come pre-ordered by ESPN's tie-breakers). */
  rank: Record<string, number>
  /** Teams that did not match a club of ours, by pseudo clubId "espn:<id>". */
  extra: Record<string, LiveTeam>
  fetchedAt: number
  season?: string
}

const GROUP_NAMES: Record<string, string> = {
  'eastern conference': 'Conferência Leste',
  'western conference': 'Conferência Oeste',
}

function groupName(raw: string | undefined, leagueId: string): string | undefined {
  if (!raw) return undefined
  const k = raw.toLowerCase().trim()
  if (GROUP_NAMES[k]) return GROUP_NAMES[k]
  const m = /^group\s+(.+)$/i.exec(raw)
  if (m) return `${leagueId.startsWith('arg.') ? 'Zona' : 'Grupo'} ${m[1]}`
  return raw
}

type EspnStat = { name?: string; type?: string; value?: number }
type EspnEntry = { team?: { id?: string; displayName?: string; shortDisplayName?: string; abbreviation?: string; logos?: { href?: string }[] }; stats?: EspnStat[] }
type EspnNode = { name?: string; abbreviation?: string; standings?: { entries?: EspnEntry[]; seasonDisplayName?: string }; children?: EspnNode[] }

const stat = (e: EspnEntry, ...names: string[]) => {
  for (const n of names) {
    const s = e.stats?.find((x) => x.name === n || x.type === n)
    if (s && typeof s.value === 'number' && Number.isFinite(s.value)) return s.value
  }
  return 0
}

export const espnIdOf = (c: Pick<Club, 'id' | 'espnId'>) => c.espnId ?? (/^e\d+$/.test(c.id) ? c.id.slice(1) : undefined)

export function parseEspnStandings(json: unknown, leagueId: string, byEspn: Map<string, Club>): LiveTable {
  const root = json as EspnNode
  const groups: { name?: string; entries: EspnEntry[]; season?: string }[] = []
  const walk = (n: EspnNode | undefined, depth: number) => {
    if (!n) return
    if (n.standings?.entries?.length) groups.push({ name: n.name, entries: n.standings.entries, season: n.standings.seasonDisplayName })
    for (const c of n.children ?? []) walk(c, depth + 1)
  }
  walk(root, 0)
  const multi = groups.length > 1
  const rows: StandingRow[] = []
  const rank: Record<string, number> = {}
  const extra: Record<string, LiveTeam> = {}
  for (const g of groups) {
    const gname = multi ? groupName(g.name, leagueId) : undefined
    for (const e of g.entries) {
      const id = e.team?.id
      if (!id) continue
      const club = byEspn.get(id)
      const clubId = club?.id ?? `espn:${id}`
      if (!club)
        extra[clubId] = {
          espnId: id,
          name: e.team?.shortDisplayName || e.team?.displayName || id,
          abbr: e.team?.abbreviation || '',
          logo: e.team?.logos?.[0]?.href,
        }
      const row: StandingRow = {
        clubId,
        played: stat(e, 'gamesPlayed', 'GP'),
        won: stat(e, 'wins', 'W'),
        drawn: stat(e, 'ties', 'D'),
        lost: stat(e, 'losses', 'L'),
        gf: stat(e, 'pointsFor', 'F'),
        ga: stat(e, 'pointsAgainst', 'A'),
        points: stat(e, 'points', 'P'),
      }
      if (gname) row.group = gname
      rows.push(row)
      const r = stat(e, 'rank', 'R')
      if (r) rank[clubId] = r
    }
  }
  return { rows, rank, extra, fetchedAt: Date.now(), season: groups[0]?.season }
}

const CACHE = 'lenda:live:v1:'

function readCache(leagueId: string): LiveTable | null {
  try {
    const raw = localStorage.getItem(CACHE + leagueId)
    if (!raw) return null
    const v = JSON.parse(raw) as LiveTable
    // keep a day at most
    return v && Array.isArray(v.rows) && Date.now() - v.fetchedAt < 24 * 3600e3 ? v : null
  } catch {
    return null
  }
}

interface LiveStore {
  tables: Record<string, LiveTable>
  status: Record<string, 'idle' | 'loading' | 'error'>
  errors: Record<string, string>
  hydrate(leagueId: string): void
  refresh(leagueId: string, espnSlug: string, clubs: Club[]): Promise<LiveTable | null>
}

export const useLive = create<LiveStore>()((set, get) => ({
  tables: {},
  status: {},
  errors: {},
  hydrate(leagueId) {
    if (get().tables[leagueId]) return
    const c = readCache(leagueId)
    if (c) set((s) => ({ tables: { ...s.tables, [leagueId]: c } }))
  },
  async refresh(leagueId, espnSlug, clubs) {
    if (get().status[leagueId] === 'loading') return null
    set((s) => ({ status: { ...s.status, [leagueId]: 'loading' }, errors: { ...s.errors, [leagueId]: '' } }))
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), 12000)
    try {
      // a "simple" CORS request only: custom headers / cache modes that add headers trigger a preflight ESPN rejects (403)
      const res = await fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${encodeURIComponent(espnSlug)}/standings?t=${Math.floor(Date.now() / 60000)}`, { signal: ctrl.signal, credentials: 'omit' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const byEspn = new Map<string, Club>()
      for (const c of clubs) {
        const e = espnIdOf(c)
        if (e) byEspn.set(e, c)
      }
      const table = parseEspnStandings(json, leagueId, byEspn)
      if (!table.rows.length) throw new Error('Tabela vazia')
      try {
        localStorage.setItem(CACHE + leagueId, JSON.stringify(table))
      } catch {
        /* storage full / blocked */
      }
      set((s) => ({ tables: { ...s.tables, [leagueId]: table }, status: { ...s.status, [leagueId]: 'idle' } }))
      return table
    } catch (err) {
      const msg = (err as Error)?.name === 'AbortError' ? 'A ESPN demorou para responder.' : 'Não foi possível falar com a ESPN.'
      set((s) => ({ status: { ...s.status, [leagueId]: 'error' }, errors: { ...s.errors, [leagueId]: msg } }))
      return null
    } finally {
      window.clearTimeout(timer)
    }
  },
}))

/** "agora mesmo" · "há 4 min" · "há 3 h" · "em 27 set". */
export function relTime(ts: number, now = Date.now()): string {
  const d = Math.max(0, now - ts)
  const m = Math.floor(d / 60000)
  if (m < 1) return 'agora mesmo'
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h} h`
  return `em ${new Date(ts).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', timeZone: 'America/Sao_Paulo' }).replace('.', '').replace(' de ', ' ')}`
}
