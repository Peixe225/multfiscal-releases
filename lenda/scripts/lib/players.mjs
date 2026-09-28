// Jogadores reais: estrelas (RealPlayer) e elencos (rosters.json para o modo Imersivo).
import { readFileSync } from 'node:fs'
import { getRoster } from './espn.mjs'
import { pmap } from './http.mjs'
import { fold, clamp, r, nameSim } from './util.mjs'
import { nationCode } from './nations.mjs'

export const EA_POS = {
  GK: 'GOL', CB: 'ZAG', RB: 'LD', LB: 'LE', RWB: 'LD', LWB: 'LE', CDM: 'VOL', CM: 'MC', CAM: 'MEI',
  LM: 'ME', RM: 'MD', LW: 'PE', RW: 'PD', ST: 'CA', CF: 'CA',
}

export const SEASON_YEAR = 2026

/** Potencial estimado para jovens (≤ 23 anos). */
export function potentialOf(ovr, age) {
  if (age > 23) return undefined
  const add = { 16: 16, 17: 14, 18: 12, 19: 10, 20: 8, 21: 6, 22: 4, 23: 3 }[Math.max(16, age)] ?? 3
  return clamp(Math.max(ovr + add, ovr), ovr, 95)
}

export const loadRealStars = () => JSON.parse(readFileSync(r('scripts', 'data', 'real-stars.json'), 'utf8'))

const slug = (s) => fold(s).replace(/ /g, '-')

/** Chaves de comparação de nome de jogador (nome completo e "inicial + sobrenome"). */
export function playerKeys(name) {
  const t = fold(name).split(' ').filter(Boolean)
  if (!t.length) return []
  const keys = [t.join(' ')]
  if (t.length >= 2) keys.push(`${t[0][0]} ${t[t.length - 1]}`, t[t.length - 1])
  return keys
}

/** Siglas de país da ESPN que não são o código FIFA (territórios franceses → FRA). */
const ESPN_NAT = { MOR: 'MAR', CRM: 'CMR', RDC: 'COD', KORS: 'KOR', SBA: 'SRB', ROM: 'ROU', MTG: 'MNE', XKX: 'KOS', PAL: 'PLE', LIB: 'LBN', SUD: 'SDN', NCD: 'NCL', MARQ: 'FRA', GLP: 'FRA', GUF: 'FRA', SMA: 'FRA', BOE: 'CUW', HOL: 'NED', SAU: 'KSA', GER: 'GER' }
export const fixNat = (c) => (c ? ESPN_NAT[c] || c : null)

const statOf = (a, name) => {
  for (const cat of a.statistics?.splits?.categories || []) for (const st of cat.stats || []) if (st.name === name) return Number(st.value) || 0
  return 0
}

/** Baixa os elencos da ESPN de uma lista de clubes [{espnId, leagueId}]. */
export async function fetchRosters(list, conc = 8) {
  const out = new Map()
  await pmap(
    list,
    async (c) => {
      const j = await getRoster(c.slug, c.espnId)
      const ath = j?.athletes || []
      out.set(c.id, ath.map((a) => ({
        espnId: String(a.id),
        name: a.displayName || a.fullName,
        short: a.shortName,
        pos: a.position?.abbreviation || '',
        age: a.age,
        dob: a.dateOfBirth,
        nat: fixNat(a.citizenshipCountry?.abbreviation) || nationCode(a.citizenship) || null,
        jersey: a.jersey ? Number(a.jersey) : undefined,
        apps: statOf(a, 'appearances'),
        subs: statOf(a, 'subIns'),
      })))
    },
    conc,
  )
  return out
}

/** Índice de jogadores ESPN por chave de nome → [{clubId, p}]. */
export function rosterIndex(rosters) {
  const idx = new Map()
  for (const [clubId, list] of rosters) {
    for (const p of list) {
      for (const k of playerKeys(p.name)) {
        if (!idx.has(k)) idx.set(k, [])
        idx.get(k).push({ clubId, p })
      }
    }
  }
  return idx
}

/** Procura um jogador EA/real nos elencos da ESPN (nome + ano de nascimento). */
export function findInRosters(idx, name, birthYear) {
  for (const k of playerKeys(name)) {
    const hits = (idx.get(k) || []).filter((h) => {
      const by = h.p.dob ? Number(h.p.dob.slice(0, 4)) : h.p.age ? SEASON_YEAR - h.p.age : null
      return !birthYear || !by || Math.abs(by - birthYear) <= 1
    })
    if (hits.length === 1) return hits[0]
    if (hits.length > 1 && k.includes(' ')) return hits[0]
  }
  return null
}

/**
 * Estrelas: EA FC 27 (≥ minOvr) + real-stars.json (clubes já atualizados pós-janela e estimativas
 * para o Brasileirão). Clube: elenco atual da ESPN > real-stars > clube EA.
 */
export function buildStars({ eaPlayers, eaClubToId, realStars, clubsByName, rosterIdx, clubIds, minOvr = 78 }) {
  const stars = new Map()
  const keyOf = (name, by) => `${fold(name)}|${by}`
  const byNameLoose = new Map()
  const ids = new Set()
  const add = (p) => {
    if (!p.clubId || !clubIds.has(p.clubId)) return false
    const k = keyOf(p.name, p.birthYear)
    if (stars.has(k)) return false
    if (ids.has(p.id)) p.id = `${p.id}-${p.birthYear}`
    ids.add(p.id)
    stars.set(k, p)
    for (const pk of playerKeys(p.name)) byNameLoose.set(`${pk}|${p.birthYear}`, p)
    return true
  }
  let skipped = 0
  // 1) real-stars (autoridade para clube atual e para as estimativas do Brasil)
  for (const s of realStars) {
    const clubId = clubsByName(s.club, s.league)
    const age = SEASON_YEAR - s.birthYear
    const ok = add({
      id: `rs-${slug(s.name)}`,
      name: s.name,
      shortName: s.shortName || s.name.split(' ').slice(-1)[0],
      nationality: s.nationality,
      position: s.position,
      birthYear: s.birthYear,
      clubId,
      ovr: s.ovr,
      ...(potentialOf(s.ovr, age) ? { potential: potentialOf(s.ovr, age) } : {}),
    })
    if (!ok && !clubId) skipped++
  }
  // 2) EA FC 27
  const realList = [...stars.values()].map((q) => ({ ...q, toks: [q.name, q.shortName].flatMap((x) => fold(x).split(' ')).filter((t) => t.length >= 3 && !['junior', 'jr'].includes(t)) }))
  for (const p of eaPlayers) {
    if (p.ovr < minOvr) continue
    const name = p.name
    const birthYear = SEASON_YEAR - (p.age || 25)
    const loose = playerKeys(name).some((k) => byNameLoose.has(`${k}|${birthYear}`) || byNameLoose.has(`${k}|${birthYear - 1}`) || byNameLoose.has(`${k}|${birthYear + 1}`))
    if (loose) continue
    // mesmo jogador com grafia diferente ("Gabriel" × "Gabriel Magalhães", "Vini Jr." × "Vinícius Júnior")
    const nat = nationCode(p.nation)
    const toks = new Set([name, p.first, p.last].filter(Boolean).flatMap((x) => fold(x).split(' ')).filter((t) => t.length >= 3 && !['junior', 'jr'].includes(t)))
    const same = realList.some((q) => q.nationality === nat && Math.abs(q.birthYear - birthYear) <= 1 && Math.abs(q.ovr - p.ovr) <= 3 && q.toks.some((t) => toks.has(t) || [...toks].some((u) => u.length >= 4 && t.length >= 4 && (u.startsWith(t.slice(0, 4)) && t.startsWith(u.slice(0, 4))))))
    if (same) continue
    const hit = rosterIdx ? findInRosters(rosterIdx, [p.first, p.last].filter(Boolean).join(' ') || name, birthYear) || findInRosters(rosterIdx, name, birthYear) : null
    const clubId = hit?.clubId || eaClubToId(p)
    const pos = EA_POS[p.pos] || 'MC'
    const ok = add({
      id: `ea${p.eaId}`,
      name: [p.first, p.last].filter(Boolean).join(' ').length > name.length + 12 ? name : name,
      shortName: shortOf(p),
      nationality: nationCode(p.nation) || hit?.p.nat || 'ENG',
      position: pos,
      birthYear,
      clubId,
      ovr: p.ovr,
      ...(potentialOf(p.ovr, p.age) ? { potential: potentialOf(p.ovr, p.age) } : {}),
      ...(hit ? { espnId: hit.p.espnId } : {}),
    })
    if (!ok && !clubId) skipped++
  }
  const list = [...stars.values()].sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name))
  return { stars: list, skipped }
}

function shortOf(p) {
  if (p.name && !p.name.includes(' ')) return p.name
  if (p.last) return p.last.split(' ').slice(-1)[0]
  return p.name.split(' ').slice(-1)[0]
}

// ───────────────────────── elencos (modo Imersivo) ─────────────────────────

const COARSE = { G: 'GOL', D: 'ZAG', M: 'MC', F: 'CA' }
const D_CYCLE = ['ZAG', 'ZAG', 'LD', 'LE', 'ZAG', 'LD', 'LE', 'ZAG']
const M_CYCLE = ['VOL', 'MC', 'MEI', 'MC', 'VOL', 'ME', 'MD', 'MEI']
const F_CYCLE = ['CA', 'PE', 'PD', 'CA', 'PE', 'PD']

/** OVR estimado de um jogador sem nota EA: força do clube, papel no elenco (titularidade) e idade. */
export function estimateOvr(strength, age, rank) {
  let o
  if (rank < 11) o = strength + 3 - 0.45 * rank
  else if (rank < 18) o = strength - 2 - 0.5 * (rank - 11)
  else o = strength - 5.5 - 0.4 * (rank - 18)
  o = Math.max(o, strength - 14)
  if (age <= 17) o -= 4
  else if (age <= 19) o -= 2
  else if (age >= 35) o -= 1.5
  return Math.round(clamp(o, 40, 90))
}

export function buildRosters({ rosters, clubs, eaByClub, stars }) {
  const out = {}
  const starsByClub = new Map()
  for (const s of stars || []) {
    if (!starsByClub.has(s.clubId)) starsByClub.set(s.clubId, [])
    starsByClub.get(s.clubId).push(s)
  }
  for (const club of clubs) {
    const list = rosters.get(club.id)
    if (!list || !list.length) continue
    const eaIdx = new Map()
    for (const p of eaByClub.get(club.id) || []) for (const k of playerKeys([p.first, p.last].filter(Boolean).join(' ') || p.name).concat(playerKeys(p.name))) if (k.includes(' ')) eaIdx.set(k, p)
    const stIdx = new Map()
    for (const p of starsByClub.get(club.id) || []) for (const k of playerKeys(p.name).concat(playerKeys(p.shortName))) if (k.includes(' ') || k.length > 4) stIdx.set(k, p)
    const counters = { D: 0, M: 0, F: 0 }
    const enriched = list.map((p) => {
      let m = null
      let st = null
      for (const k of playerKeys(p.name)) {
        if (!m && eaIdx.has(k)) m = eaIdx.get(k)
        if (!st && stIdx.has(k)) st = stIdx.get(k)
      }
      const starts = Math.max(0, (p.apps || 0) - (p.subs || 0))
      return { p, m, st, starts }
    })
    // ordem de importância: titularidade na temporada (ESPN), depois idade "de auge"
    const byRole = [...enriched].sort((a, b) => b.starts - a.starts || (b.p.apps || 0) - (a.p.apps || 0) || Math.abs((a.p.age || 26) - 26) - Math.abs((b.p.age || 26) - 26))
    const roleRank = new Map(byRole.map((x, i) => [x, i]))
    const players = enriched.map((x) => {
      const coarse = (x.p.pos || 'M')[0]
      let position = x.m ? EA_POS[x.m.pos] : x.st ? x.st.position : null
      if (!position) {
        const n = counters[coarse] ?? 0
        if (coarse in counters) counters[coarse] = n + 1
        position = coarse === 'G' ? 'GOL' : coarse === 'D' ? D_CYCLE[n % D_CYCLE.length] : coarse === 'F' ? F_CYCLE[n % F_CYCLE.length] : M_CYCLE[n % M_CYCLE.length]
      }
      const age = x.p.age || (x.m?.age ?? 24)
      const ovr = x.m ? x.m.ovr : x.st ? x.st.ovr : estimateOvr(club.strength, age, roleRank.get(x))
      const pl = { name: x.p.name, position, age, nationality: x.p.nat || club.country, ovr }
      if (x.p.jersey) pl.number = x.p.jersey
      if (x.m) pl.ea = true
      return pl
    })
    players.sort((a, b) => b.ovr - a.ovr)
    out[club.id] = players
  }
  return out
}

export { nameSim }
