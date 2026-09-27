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
        nat: a.citizenshipCountry?.abbreviation || nationCode(a.citizenship) || null,
        jersey: a.jersey ? Number(a.jersey) : undefined,
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
  const add = (p) => {
    if (!p.clubId || !clubIds.has(p.clubId)) return false
    const k = keyOf(p.name, p.birthYear)
    if (stars.has(k)) return false
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
  for (const p of eaPlayers) {
    if (p.ovr < minOvr) continue
    const name = p.name
    const birthYear = SEASON_YEAR - (p.age || 25)
    const loose = playerKeys(name).some((k) => byNameLoose.has(`${k}|${birthYear}`) || byNameLoose.has(`${k}|${birthYear - 1}`) || byNameLoose.has(`${k}|${birthYear + 1}`))
    if (loose) continue
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

/** OVR estimado de um jogador sem nota EA: força do clube, idade e posição no elenco. */
export function estimateOvr(strength, age, rank, total) {
  // titulares ~ força do clube; reservas caem; jovens e veteranos um pouco abaixo
  const depth = rank < 11 ? 0.5 : rank < 16 ? -2 : rank < 22 ? -4.5 : -7
  const ageAdj = age <= 18 ? -8 : age <= 20 ? -5 : age <= 22 ? -2 : age >= 35 ? -3 : age >= 33 ? -1 : 0
  void total
  return Math.round(clamp(strength + depth + ageAdj, 40, 90))
}

export function buildRosters({ rosters, clubs, eaByClub }) {
  const out = {}
  for (const club of clubs) {
    const list = rosters.get(club.id)
    if (!list || !list.length) continue
    const ea = eaByClub.get(club.id) || []
    const eaIdx = new Map()
    for (const p of ea) for (const k of playerKeys([p.first, p.last].filter(Boolean).join(' ') || p.name).concat(playerKeys(p.name))) eaIdx.set(k, p)
    const counters = { D: 0, M: 0, F: 0 }
    // ordena por "importância" presumida: EA primeiro (por OVR), depois idade central
    const enriched = list.map((p) => {
      let m = null
      for (const k of playerKeys(p.name)) if (eaIdx.has(k)) { m = eaIdx.get(k); break }
      return { p, m }
    })
    const rankable = enriched.map((x) => ({ ...x, key: x.m ? 100 + x.m.ovr : 50 - Math.abs((x.p.age || 25) - 26) }))
    rankable.sort((a, b) => b.key - a.key)
    const players = rankable.map((x, i) => {
      const coarse = (x.p.pos || 'M')[0]
      let position = x.m ? EA_POS[x.m.pos] || COARSE[coarse] : null
      if (!position) {
        const n = counters[coarse] ?? 0
        if (coarse in counters) counters[coarse] = n + 1
        position = coarse === 'G' ? 'GOL' : coarse === 'D' ? D_CYCLE[n % D_CYCLE.length] : coarse === 'F' ? F_CYCLE[n % F_CYCLE.length] : M_CYCLE[n % M_CYCLE.length]
      }
      const age = x.p.age || (x.m?.age ?? 24)
      const ovr = x.m ? x.m.ovr : estimateOvr(club.strength, age, i, list.length)
      const pl = { name: x.p.name, position, age, nationality: x.p.nat || club.country, ovr }
      if (x.p.jersey) pl.number = x.p.jersey
      if (x.m) pl.ea = true
      return pl
    })
    out[club.id] = players
  }
  return out
}

export { nameSim }
