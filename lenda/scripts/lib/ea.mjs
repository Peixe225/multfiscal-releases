// Notas EA FC 27 via API pública do fut.gg (cartas base, masculino).
// Rastreia liga a liga (league_id do EA), página a página, e guarda o bruto em scripts/.cache/futgg.
import { getJson, BROWSER_UA, pmap } from './http.mjs'

/** Ligas EA que interessam (clubes simulados + clubes extras de continentais). */
export const EA_LEAGUES = {
  13: 'Premier League',
  14: 'EFL Championship',
  60: 'EFL League One',
  61: 'EFL League Two',
  53: 'LALIGA EA SPORTS',
  54: 'LALIGA HYPERMOTION',
  31: 'Serie A',
  32: 'Serie B',
  19: 'Bundesliga',
  20: 'Bundesliga 2',
  16: 'Ligue 1',
  17: 'Ligue 2',
  10: 'Eredivisie',
  308: 'Liga Portugal',
  68: 'Süper Lig',
  50: 'Scottish Premiership',
  4: '1A Pro League',
  39: 'MLS',
  341: 'Liga MX',
  350: 'ROSHN Saudi League',
  353: 'Liga Profesional de Fútbol',
  41: 'Eliteserien',
  56: 'Allsvenskan',
  1: '3F Superliga',
  80: 'Österreichische Bundesliga',
  189: 'Swiss Super League',
  330: 'SUPERLIGA (ROU)',
  63: 'Hellas Liga',
  66: 'Ekstraklasa',
  83: 'K League 1',
  2012: 'CSL',
  351: 'A-League',
  319: 'Česká Liga',
  332: 'Ukrayina Liha',
  317: 'Liga Hrvatska',
  1003: 'CONMEBOL Libertadores',
  1014: 'CONMEBOL Sudamericana',
  2210: 'Liga Cyprus',
  2211: 'Magyar Liga',
  2172: 'UAE League',
  2274: 'League 2274 (BUL)',
  2149: 'Indian Super League',
  65: 'SSE Airtricity (IRL)',
}

const PAGE = (league, p) =>
  `https://www.fut.gg/api/fut/players/v2/27/?page=${p}&sorts=-overall&gender=1&league_id=${league}`

function slim(x) {
  const fs = x.faceStatsV2 || {}
  return {
    eaId: x.basePlayerEaId || x.eaId,
    name: x.commonName || `${x.firstName || ''} ${x.lastName || ''}`.trim(),
    first: x.firstName,
    last: x.lastName,
    ovr: x.overall,
    pos: x.position,
    alt: x.alternativePositions || [],
    club: x.uniqueClub?.name || x.club?.name,
    clubEaId: x.uniqueClub?.eaId || x.club?.eaId,
    league: x.league?.name,
    leagueEaId: x.league?.eaId,
    nation: x.nation?.name,
    age: x.age,
    height: x.height,
    foot: x.foot,
    rarity: x.rarityName,
    stats: { pac: fs.facePace, sho: fs.faceShooting, pas: fs.facePassing, dri: fs.faceDribbling, def: fs.faceDefending, phy: fs.facePhysicality },
  }
}

/** Todas as cartas BASE (não especiais) de uma liga EA. */
export async function crawlLeague(leagueId) {
  const out = new Map()
  for (let p = 1; p < 60; p++) {
    const j = await getJson(PAGE(leagueId, p), { ua: BROWSER_UA, group: 'futgg' })
    const data = j?.data || []
    for (const x of data) {
      if (x.isSpecial || x.gender === 2) continue
      const s = slim(x)
      const prev = out.get(s.eaId)
      if (!prev || prev.ovr < s.ovr) out.set(s.eaId, s)
    }
    if (!data.length || !j.next) break
  }
  return [...out.values()]
}

export async function crawlAll(log = () => {}) {
  const ids = Object.keys(EA_LEAGUES).map(Number)
  const res = await pmap(
    ids,
    async (id) => {
      const players = await crawlLeague(id)
      log(`  EA ${String(id).padStart(4)} ${EA_LEAGUES[id].padEnd(28)} ${players.length} jogadores`)
      return players
    },
    3,
  )
  const all = new Map()
  for (const list of res) for (const p of list) if (!all.has(p.eaId) || all.get(p.eaId).ovr < p.ovr) all.set(p.eaId, p)
  return [...all.values()]
}
