// Tabelas reais de hoje (standings), jogos restantes (fixtures) e metadados do snapshot por liga.
import { getStandings, getTeams, getEvents, flattenStandings, standingsSeason } from './espn.mjs'
import { pmap } from './http.mjs'

/** Consultas especiais de standings (fase certa quando o padrão da ESPN vem vazio). */
export const STANDINGS_QUERY = { 'ecu.1': 'seasontype=1', 'rou.1': 'seasontype=1', 'sui.1': 'seasontype=1' }

const GROUP_PT = [
  [/eastern conference/i, 'Conferência Leste'],
  [/western conference/i, 'Conferência Oeste'],
  [/^group a$/i, 'Zona A'],
  [/^group b$/i, 'Zona B'],
  [/east region/i, 'Região Leste'],
  [/west region/i, 'Região Oeste'],
]
const groupName = (n) => {
  for (const [re, pt] of GROUP_PT) if (re.test(n)) return pt
  const m = /group ([a-z])$/i.exec(n)
  return m ? `Grupo ${m[1].toUpperCase()}` : n
}

/** Baixa standings + teams de uma liga. */
export async function loadLeague(slug) {
  const st = await getStandings(slug, STANDINGS_QUERY[slug])
  const teamsJson = await getTeams(slug)
  const groups = flattenStandings(st)
  const season = standingsSeason(st)
  const teams = new Map((teamsJson?.sports?.[0]?.leagues?.[0]?.teams || []).map((t) => [String(t.team.id), t.team]))
  return { slug, groups, season, teams, raw: st }
}

export function standingRows(league, { stale = false } = {}) {
  const multi = league.groups.length > 1
  const rows = []
  for (const g of league.groups) {
    for (const e of g.entries) {
      const s = e.stats
      const row = stale
        ? { clubId: 'e' + e.team.id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 }
        : {
            clubId: 'e' + e.team.id,
            played: s.played || 0,
            won: s.won || 0,
            drawn: s.drawn || 0,
            lost: s.lost || 0,
            gf: s.gf || 0,
            ga: s.ga || 0,
            points: s.points || 0,
          }
      if (multi) row.group = groupName(g.name)
      rows.push(row)
    }
  }
  return rows
}

/** Anos de scoreboard a consultar para a temporada atual. */
export function scoreboardYears(league) {
  return league.calendar === 'split' ? ['2026', '2027'] : ['2026', '2027']
}

/** Jogos ainda não disputados da fase atual (mesma temporada e seasonType da tabela). */
export async function remainingFixtures(slug, { seasonYear, seasonType, clubIds, years = ['2026', '2027'], special = false }) {
  const seen = new Set()
  const out = []
  // O scoreboard usa ids GLOBAIS de fase (ex.: 13907); a tabela usa o id local (1, 6…).
  // leagues[0].season.type = {id: local, type: global} da fase atual.
  let globalType = null
  const loaded = []
  for (const y of years) {
    const res = await getEvents(slug, y)
    loaded.push(res)
    const t = res.season?.type
    if (!globalType && t && String(t.id) === String(seasonType) && res.season?.year === seasonYear) globalType = Number(t.type)
  }
  // Sem o id global da fase (tabela pedida com ?seasontype=, ex.: Equador), a fase da tabela já
  // acabou ou está congelada: não misturamos jogos de outra fase.
  if (!globalType && special) return []
  const KO = /final|semi|quarter|round-of|playoff|play-in|eliminat|promotion|relegation|championship|wild-card/i
  const cand = []
  for (const { events } of loaded) {
    for (const e of events) {
      if (seen.has(e.id)) continue
      seen.add(e.id)
      if (seasonYear && e.seasonYear !== seasonYear) continue
      if (globalType ? e.seasonType !== globalType : KO.test(e.stage || '')) continue
      if (/cancel|abandon/i.test(e.statusName || '')) continue
      const home = 'e' + e.home.id
      const away = 'e' + e.away.id
      if (clubIds && (!clubIds.has(home) || !clubIds.has(away))) continue
      cand.push({ e, home, away })
    }
  }
  // Jogo adiado que já foi remarcado (novo evento com o mesmo mando) não conta duas vezes.
  const pairKey = (x) => `${x.home}>${x.away}`
  const byPair = new Map()
  for (const x of cand) {
    if (!byPair.has(pairKey(x))) byPair.set(pairKey(x), [])
    byPair.get(pairKey(x)).push(x)
  }
  for (const x of cand) {
    if (x.e.completed) continue
    if (/postpon|suspend|delay/i.test(x.e.statusName || '') && byPair.get(pairKey(x)).some((y) => y !== x && (y.e.completed || !/postpon/i.test(y.e.statusName || '')) && y.e.date > x.e.date)) continue
    out.push({ date: x.e.date, home: x.home, away: x.away })
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return out
}

/** Número de jogos por clube na fase: moda de (jogados + restantes). */
export function gamesPerTeam(rows, fixtures) {
  const rem = new Map()
  for (const f of fixtures) {
    rem.set(f.home, (rem.get(f.home) || 0) + 1)
    rem.set(f.away, (rem.get(f.away) || 0) + 1)
  }
  const totals = rows.map((r) => r.played + (rem.get(r.clubId) || 0))
  const freq = new Map()
  for (const t of totals) freq.set(t, (freq.get(t) || 0) + 1)
  const mode = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0
  const complete = totals.every((t) => t === mode)
  return { mode, complete, max: Math.max(0, ...totals) }
}

/** Nome pt-BR da fase atual. */
export function phaseName(league, season) {
  const n = `${season.name || ''} ${league.groupsLabel || ''}`
  const y = 2026
  if (/apertura/i.test(n)) return `Apertura ${y}`
  if (/clausura/i.test(n)) return `Clausura ${y}`
  if (/first stage/i.test(n)) return `Primeira fase ${y}`
  return league.calendar === 'split' ? `${y}/${String(y + 1).slice(2)}` : `${y}`
}

export { pmap }
