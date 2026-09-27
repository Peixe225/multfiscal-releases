// Acesso à API pública da ESPN (JSON). Todas as respostas passam pelo cache de http.mjs.
import { getJson } from './http.mjs'

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer'
const V2 = 'https://site.api.espn.com/apis/v2/sports/soccer'

export const espnUrls = {
  standings: (slug, q = '') => `${V2}/${slug}/standings${q ? '?' + q : ''}`,
  teams: (slug) => `${SITE}/${slug}/teams?limit=500`,
  scoreboard: (slug, dates) => `${SITE}/${slug}/scoreboard?dates=${dates}&limit=1000`,
  roster: (slug, id) => `${SITE}/${slug}/teams/${id}/roster`,
  statistics: (slug) => `${SITE}/${slug}/statistics`,
  dropdown: () => `https://site.api.espn.com/apis/site/v2/leagues/dropdown?sport=soccer&limit=1000`,
  crest: (id, dark) => `https://a.espncdn.com/combiner/i?img=/i/teamlogos/soccer/${dark ? '500-dark' : '500'}/${id}.png&w=128&h=128`,
  leagueLogo: (alt, dark) => `https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/${dark ? '500-dark' : '500'}/${alt}.png&w=128&h=128`,
}

export const getStandings = (slug, q) => getJson(espnUrls.standings(slug, q), { group: 'espn-standings' })
export const getTeams = (slug) => getJson(espnUrls.teams(slug), { group: 'espn-teams' })
export const getScoreboard = (slug, dates) => getJson(espnUrls.scoreboard(slug, dates), { group: 'espn-scoreboard' })
export const getRoster = (slug, id) => getJson(espnUrls.roster(slug, id), { group: 'espn-roster' })
export const getDropdown = () => getJson(espnUrls.dropdown(), { group: 'espn-meta' })

const STAT_KEYS = {
  gamesPlayed: 'played',
  wins: 'won',
  ties: 'drawn',
  losses: 'lost',
  pointsFor: 'gf',
  pointsAgainst: 'ga',
  points: 'points',
  rank: 'rank',
  deductions: 'deductions',
}

/** Achata uma resposta de standings em grupos {name, entries:[{team, stats, note}]}. */
export function flattenStandings(json) {
  if (!json) return []
  const groups = []
  const walk = (node, name) => {
    if (node?.standings?.entries?.length) {
      groups.push({ name: node.name || name || '', abbr: node.abbreviation, entries: node.standings.entries })
    }
    for (const c of node?.children || []) walk(c, c.name)
  }
  walk(json, json.name)
  return groups.map((g) => ({
    name: g.name,
    entries: g.entries.map((e) => {
      const s = {}
      for (const st of e.stats || []) {
        const k = STAT_KEYS[st.name] || STAT_KEYS[st.type]
        if (k && s[k] === undefined) s[k] = Number(st.value ?? 0)
      }
      return {
        team: e.team,
        stats: s,
        note: e.note ? { color: e.note.color, description: e.note.description, rank: e.note.rank } : undefined,
      }
    }),
  }))
}

/** Temporada/fase atual declarada no JSON de standings. */
export function standingsSeason(json) {
  const s = json?.children?.[0]?.standings || json?.standings
  return {
    season: s?.season ?? json?.season?.year,
    seasonType: s?.seasonType,
    name: s?.seasonDisplayName || json?.season?.displayName,
  }
}

/** Normaliza um evento do scoreboard. */
export function parseEvent(ev) {
  const comp = ev.competitions?.[0]
  if (!comp) return null
  const cs = comp.competitors || []
  const home = cs.find((c) => c.homeAway === 'home') || cs[0]
  const away = cs.find((c) => c.homeAway === 'away') || cs[1]
  if (!home || !away) return null
  const st = ev.status?.type || comp.status?.type || {}
  const num = (x) => (x === undefined || x === null || x === '' ? undefined : Number(x))
  return {
    id: ev.id,
    date: ev.date,
    stage: ev.season?.slug || '',
    seasonYear: ev.season?.year,
    seasonType: ev.season?.type,
    state: st.state, // pre | in | post
    completed: !!st.completed,
    statusName: st.name,
    detail: st.shortDetail || st.detail,
    home: { id: String(home.team?.id), name: home.team?.displayName, abbr: home.team?.abbreviation, score: num(home.score), shootout: num(home.shootoutScore), winner: home.winner, color: home.team?.color, alt: home.team?.alternateColor, logo: home.team?.logo },
    away: { id: String(away.team?.id), name: away.team?.displayName, abbr: away.team?.abbreviation, score: num(away.score), shootout: num(away.shootoutScore), winner: away.winner, color: away.team?.color, alt: away.team?.alternateColor, logo: away.team?.logo },
    leg: comp.leg?.value,
    notes: (comp.notes || []).map((n) => n.headline).filter(Boolean),
  }
}

export async function getEvents(slug, dates) {
  const j = await getScoreboard(slug, dates)
  const evs = (j?.events || []).map(parseEvent).filter(Boolean)
  return { events: evs, calendar: j?.leagues?.[0]?.calendar, season: j?.leagues?.[0]?.season }
}
