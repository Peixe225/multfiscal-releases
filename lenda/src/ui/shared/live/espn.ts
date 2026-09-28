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

export type LiveErrorKind = 'blocked' | 'offline' | 'timeout' | 'http' | 'network' | 'empty'

interface LiveStore {
  tables: Record<string, LiveTable>
  status: Record<string, 'idle' | 'loading' | 'error'>
  errors: Record<string, string>
  errorKinds: Record<string, LiveErrorKind>
  /**
   * O ambiente bloqueia conexões externas (CSP `connect-src`, ex.: dentro do claude.ai). Depois da
   * 1ª tentativa bloqueada o botão fica desativado nesta sessão: nada de repetir o erro no console.
   */
  blocked: boolean
  hydrate(leagueId: string): void
  refresh(leagueId: string, espnSlug: string, clubs: Club[]): Promise<LiveTable | null>
}

const ESPN_HOST = 'site.api.espn.com'

/** Violações de CSP para a ESPN (o navegador não diz no erro do fetch por que ele falhou). */
let cspHit = false
let cspWatching = false
function watchCsp() {
  if (cspWatching || typeof document === 'undefined') return
  cspWatching = true
  document.addEventListener('securitypolicyviolation', (e) => {
    if (String(e.blockedURI || '').includes(ESPN_HOST) || /connect-src/.test(e.effectiveDirective || e.violatedDirective || '')) cspHit = true
  })
}

/**
 * Hospedagens que sabidamente bloqueiam conexões externas (artefatos do claude.ai rodam em
 * *.claudeusercontent.com, com CSP `connect-src` fechado): nem tenta, para não sujar o console.
 */
function knownBlockedHost(): boolean {
  try {
    const re = /(^|\.)(claude\.ai|claudeusercontent\.com)$/
    if (re.test(location.hostname)) return true
    const anc = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins
    if (anc) for (let i = 0; i < anc.length; i++) if (re.test(new URL(anc[i]).hostname)) return true
  } catch {
    /* sem location (testes) */
  }
  return false
}

export const LIVE_ERROR_TEXT: Record<LiveErrorKind, string> = {
  blocked: 'Este ambiente bloqueia conexões externas (como dentro do claude.ai), então a ESPN não pode ser consultada daqui.',
  offline: 'Você está sem internet.',
  timeout: 'A ESPN demorou demais para responder.',
  http: 'A ESPN recusou o pedido agora.',
  network: 'Não foi possível falar com a ESPN.',
  empty: 'A ESPN respondeu sem a tabela desta liga.',
}

export const useLive = create<LiveStore>()((set, get) => ({
  tables: {},
  status: {},
  errors: {},
  errorKinds: {},
  blocked: typeof location !== 'undefined' && knownBlockedHost(),
  hydrate(leagueId) {
    if (get().tables[leagueId]) return
    const c = readCache(leagueId)
    if (c) set((s) => ({ tables: { ...s.tables, [leagueId]: c } }))
  },
  async refresh(leagueId, espnSlug, clubs) {
    if (get().status[leagueId] === 'loading') return null
    const fail = (kind: LiveErrorKind) => {
      set((s) => ({
        status: { ...s.status, [leagueId]: 'error' },
        errors: { ...s.errors, [leagueId]: LIVE_ERROR_TEXT[kind] },
        errorKinds: { ...s.errorKinds, [leagueId]: kind },
        blocked: s.blocked || kind === 'blocked',
      }))
      return null
    }
    // já sabemos que o ambiente bloqueia a ESPN, ou estamos offline: nem tenta (sem erro no console)
    if (get().blocked) return fail('blocked')
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return fail('offline')
    watchCsp()
    cspHit = false
    set((s) => ({ status: { ...s.status, [leagueId]: 'loading' }, errors: { ...s.errors, [leagueId]: '' } }))
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), 12000)
    try {
      // a "simple" CORS request only: custom headers / cache modes that add headers trigger a preflight ESPN rejects (403)
      let res: Response
      try {
        res = await fetch(`https://${ESPN_HOST}/apis/v2/sports/soccer/${encodeURIComponent(espnSlug)}/standings?t=${Math.floor(Date.now() / 60000)}`, { signal: ctrl.signal, credentials: 'omit' })
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return fail('timeout')
        // o evento de CSP chega numa task separada: dá um instante para ele
        await new Promise((r) => window.setTimeout(r, 60))
        return fail(cspHit ? 'blocked' : navigator.onLine === false ? 'offline' : 'network')
      }
      if (!res.ok) return fail('http')
      const json = await res.json().catch(() => null)
      const byEspn = new Map<string, Club>()
      for (const c of clubs) {
        const e = espnIdOf(c)
        if (e) byEspn.set(e, c)
      }
      const table = json ? parseEspnStandings(json, leagueId, byEspn) : null
      if (!table?.rows.length) return fail('empty')
      try {
        localStorage.setItem(CACHE + leagueId, JSON.stringify(table))
      } catch {
        /* storage full / blocked */
      }
      set((s) => ({ tables: { ...s.tables, [leagueId]: table }, status: { ...s.status, [leagueId]: 'idle' } }))
      return table
    } finally {
      window.clearTimeout(timer)
    }
  },
}))

/** "27/09" (fuso de São Paulo). */
export function shortDay(ts: number | string): string {
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
}

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
