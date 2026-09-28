#!/usr/bin/env node
// LENDA — pipeline de dados (npm run data).
//
// Fontes: ESPN (tabelas de hoje, clubes, cores, escudos, jogos restantes, copas em andamento),
// fut.gg (notas EA FC 27) e os catálogos escritos à mão em src/data/catalog.
// Saídas: src/data/generated/game-data.json (GameData), src/data/generated/rosters.json,
//         public/crests/*.webp, public/leagues/*.webp, public/flags/4x3/*.svg.
//
// Idempotente: todas as respostas HTTP ficam em scripts/.cache (re-execução rápida e offline).
//   node scripts/build-data.mjs            → usa o cache, baixa só o que falta
//   node scripts/build-data.mjs --offline  → nunca acessa a rede
//   node scripts/build-data.mjs --refresh  → ignora o cache (baixa tudo de novo)
//   node scripts/build-data.mjs --no-rosters → pula os elencos (rosters.json)
import { ensureProxyEnv, httpStats, pmap } from './lib/http.mjs'

await ensureProxyEnv(import.meta.url)

const { stat } = await import('node:fs/promises')
const { getTeams } = await import('./lib/espn.mjs')
const { crawlAll } = await import('./lib/ea.mjs')
const { r, writeJson, hex, fitName, round1, mean, fold, nameSim, log } = await import('./lib/util.mjs')
const { loadLeague, standingRows, remainingFixtures, gamesPerTeam, STANDINGS_QUERY } = await import('./lib/tables.mjs')
const { groupEaClubs, matchEaClubs, computeStrengths, defaultPrestige } = await import('./lib/strength.mjs')
const { knockoutInProgress, leaguePhaseInProgress } = await import('./lib/cups.mjs')
const assets = await import('./lib/assets.mjs')
const players = await import('./lib/players.mjs')

const { LEAGUES } = await import('../src/data/catalog/leagues.ts')
const { COUNTRIES } = await import('../src/data/catalog/countries.ts')
const { COMPETITIONS, CONFEDERATIONS } = await import('../src/data/catalog/competitions.ts')
const { TROPHIES } = await import('../src/data/catalog/trophies.ts')
const { CLUB_META, EXTRA_CLUBS, EXTRA_TEAM_SOURCES, STRENGTH_OVERRIDES, COLOR_OVERRIDES } = await import('../src/data/catalog/clubs.ts')
const { BALLON_DOR, BALLON_DOR_2026, WORLD_CUP, CHAMPIONS } = await import('../src/data/catalog/history.ts')

const ARGS = new Set(process.argv.slice(2))
const t0 = Date.now()
const step = (s) => log(`\n▸ ${s}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
const warn = (...a) => console.warn('  ⚠', ...a)

const leagueById = new Map(LEAGUES.map((l) => [l.id, l]))
const countryByCode = new Map(COUNTRIES.map((c) => [c.code, c]))

// ───────────────────────── 1. ligas (standings + teams) ─────────────────────────
step(`Ligas: ${LEAGUES.length} (tabelas e clubes da ESPN)`)
const leagueData = new Map()
await pmap(
  LEAGUES,
  async (l) => {
    const d = await loadLeague(l.id)
    const n = d.groups.reduce((a, g) => a + g.entries.length, 0)
    if (!n) warn(`${l.id}: tabela vazia na ESPN`)
    leagueData.set(l.id, d)
  },
  6,
)

// ───────────────────────── 2. clubes das ligas ─────────────────────────
step('Clubes')
/** registro interno: { id, espnId, leagueId, country, team(ESPN), meta, table } */
const recs = new Map()
for (const l of LEAGUES) {
  const d = leagueData.get(l.id)
  for (const g of d.groups) {
    for (const e of g.entries) {
      const id = 'e' + e.team.id
      if (recs.has(id)) {
        warn(`${id} (${e.team.displayName}) aparece em ${recs.get(id).leagueId} e ${l.id} — mantido em ${recs.get(id).leagueId}`)
        continue
      }
      const team = d.teams.get(String(e.team.id)) || e.team
      const meta = { ...(CLUB_META[e.team.id] || {}) }
      if (STRENGTH_OVERRIDES[e.team.id] !== undefined) meta.strength = STRENGTH_OVERRIDES[e.team.id]
      if (COLOR_OVERRIDES[e.team.id]) meta.colors = COLOR_OVERRIDES[e.team.id]
      recs.set(id, {
        id,
        espnId: String(e.team.id),
        leagueId: l.id,
        slug: l.id,
        country: meta.country || l.country,
        team,
        meta,
        table: l.stale ? null : { played: e.stats.played || 0, points: e.stats.points || 0 },
      })
    }
  }
}
const leagueClubCount = recs.size

// extras: pool de times das continentais (nome, escudo, cores)
const pool = new Map()
for (const slug of EXTRA_TEAM_SOURCES) {
  const j = await getTeams(slug)
  for (const t of j?.sports?.[0]?.leagues?.[0]?.teams || []) if (!pool.has(String(t.team.id))) pool.set(String(t.team.id), { team: t.team, slug })
}
const extraIds = []
for (const x of EXTRA_CLUBS) {
  const id = 'e' + x.espnId
  if (recs.has(id)) {
    warn(`extra ${id} (${x.name}) já está na liga ${recs.get(id).leagueId}`)
    continue
  }
  const p = pool.get(x.espnId)
  if (!p) warn(`extra ${id} (${x.name}) sem dados da ESPN — usa nome/cores do catálogo`)
  recs.set(id, {
    id,
    espnId: x.espnId,
    leagueId: 'none',
    slug: p?.slug || 'uefa.champions',
    country: x.country,
    team: p?.team || { id: x.espnId, displayName: x.name, shortDisplayName: x.shortName, abbreviation: (x.abbr || x.name.slice(0, 3)).toUpperCase(), logos: [] },
    meta: x,
    table: null,
  })
  extraIds.push(id)
}
log(`  ${leagueClubCount} clubes em ligas + ${extraIds.length} extras`)

// ───────────────────────── 3. EA FC 27 → força ─────────────────────────
step('Notas EA FC 27 (fut.gg)')
const eaPlayers = await crawlAll(() => {})
const eaClubs = groupEaClubs(eaPlayers)
const candidates = [...recs.values()].map((c) => ({
  id: c.espnId,
  country: c.country,
  names: [c.team.displayName, c.team.shortDisplayName, c.team.name, c.team.location, c.meta.name, (c.team.slug || '').split('.').pop()?.replace(/_/g, ' ')].filter(Boolean),
}))
const { matched, unmatched } = matchEaClubs(eaClubs, candidates)
for (const [espnId, ea] of matched) recs.get('e' + espnId).ea = ea
log(`  ${eaPlayers.length} cartas, ${eaClubs.length} clubes EA, ${matched.size} associados`)
const unmatchedBig = unmatched.filter((u) => u.top14 >= 66 && u.players.length >= 11)
if (unmatchedBig.length) log(`  EA sem par (${unmatchedBig.length}): ${unmatchedBig.map((u) => `${u.club}[${u.leagueEaId}]`).join(', ')}`)
if (ARGS.has('--debug-ea')) for (const [espnId, ea] of matched) if (ea.sim < 1.5) log(`   ~ ${ea.club} → ${recs.get('e' + espnId).team.displayName} (${ea.sim.toFixed(2)})`)

// ───────────────────────── 4. copas em andamento (podem trazer clubes novos) ─────────────────────────
step('Copas em andamento')
const cupsInProgress = {}
const fixtures = {}
const autoExtra = (id, competitor, country, slug) => {
  if (recs.has(id)) return
  recs.set(id, {
    id,
    espnId: id.slice(1),
    leagueId: 'none',
    slug,
    country,
    team: { id: id.slice(1), displayName: competitor.name, shortDisplayName: competitor.name, abbreviation: competitor.abbr, color: competitor.color, alternateColor: competitor.alt, logos: competitor.logo ? [{ href: competitor.logo, rel: ['full', 'default'] }] : [] },
    meta: { prestige: 0.5 },
    table: null,
    auto: true,
  })
  extraIds.push(id)
  log(`  + clube extra automático: ${id} ${competitor.name} (${country}, via ${slug})`)
}
const KO = [
  { slug: 'conmebol.libertadores', fromStage: 'round-of-16', country: null },
  { slug: 'conmebol.sudamericana', fromStage: 'knockout-round-playoffs', country: null },
  { slug: 'bra.copa_do_brazil', fromStage: 'round-of-16', country: 'BRA' },
  { slug: 'arg.copa', fromStage: 'round-of-16', country: 'ARG' },
  { slug: 'usa.open', fromStage: 'round-of-16', country: 'USA' },
]
for (const k of KO) {
  const { cup, clubIds, unknown } = await knockoutInProgress(k.slug, { fromStage: k.fromStage })
  for (const id of clubIds) if (!recs.has(id)) autoExtra(id, unknown.get(id), k.country || 'BRA', k.slug)
  cupsInProgress[k.slug] = cup
  log(`  ${k.slug}: ${cup.stage} — vivos ${cup.alive.length}, confrontos ${cup.pairs.length}, fases concluídas ${cup.completed.map((s) => s.name).join(' / ')}`)
}
for (const slug of ['uefa.champions', 'uefa.europa', 'uefa.europa.conf']) {
  const d = await loadLeague(slug)
  const rows = standingRows(d)
  for (const row of rows) {
    if (!recs.has(row.clubId)) {
      const e = d.groups.flatMap((g) => g.entries).find((x) => 'e' + x.team.id === row.clubId)
      warn(`${slug}: ${row.clubId} ${e?.team.displayName} não está nos dados — adicione em EXTRA_CLUBS`)
      autoExtra(row.clubId, { name: e?.team.displayName, abbr: e?.team.abbreviation }, 'EUR', slug)
    }
  }
  for (const row of rows) delete row.group
  const { cup, fixtures: fx } = await leaguePhaseInProgress(slug, { standingsRows: rows })
  cupsInProgress[slug] = cup
  fixtures[slug] = fx
  log(`  ${slug}: fase de liga, ${rows.length} clubes, ${fx.length} jogos restantes`)
}

// ───────────────────────── 5. força e prestígio ─────────────────────────
step('Força dos clubes')
const all = [...recs.values()]
computeStrengths(all, leagueById)
for (const c of all) {
  const l = leagueById.get(c.leagueId)
  c.prestige = c.meta.prestige ?? defaultPrestige(c.strength, l?.coefficient ?? 0.4, l?.tier ?? 2)
}

// ───────────────────────── 6. tabelas, jogos restantes e snapshot ─────────────────────────
step('Tabelas de hoje e jogos restantes')
const standings = {}
const snapshot = {}
await pmap(
  LEAGUES,
  async (l) => {
    const d = leagueData.get(l.id)
    const rows = standingRows(d, { stale: !!l.stale }).filter((row) => recs.get(row.clubId)?.leagueId === l.id)
    standings[l.id] = rows
    const ids = new Set(rows.map((x) => x.clubId))
    const type = (d.raw?.seasons || []).flatMap((s) => (s.year === d.season.season ? s.types || [] : [])).find((t) => String(t.id) === String(d.season.seasonType))
    let fx = []
    if (!l.stale) fx = await remainingFixtures(l.id, { seasonYear: d.season.season, seasonType: d.season.seasonType, clubIds: ids, special: !!STANDINGS_QUERY[l.id] })
    fixtures[l.id] = fx
    const n = rows.length
    const groups = new Set(rows.map((x) => x.group).filter(Boolean)).size
    const expected = groups > 1 ? null : l.format.rounds * (n - 1)
    const gp = gamesPerTeam(rows, fx)
    const complete = !l.stale && gp.complete && (expected === null || gp.mode === expected || (l.format.rounds <= 2 && gp.mode >= expected))
    const typeName = `${type?.name || ''} ${d.season.name || ''}`
    const phase = /apertura/i.test(typeName)
      ? 'Apertura 2026'
      : /clausura/i.test(typeName)
        ? 'Clausura 2026'
        : /first stage|liga pro/i.test(typeName) && l.id === 'ecu.1'
          ? 'Primeira fase 2026'
          : l.calendar === 'split'
            ? '2026/27'
            : '2026'
    snapshot[l.id] = {
      season: 2026,
      phase,
      gamesPerTeam: l.stale ? l.format.rounds * (n - 1) : complete ? gp.mode : Math.max(gp.max, expected ?? 0),
      fixturesComplete: complete,
      ...(l.stale ? { stale: true } : {}),
    }
  },
  6,
)

// ───────────────────────── 7. cores, escudos e atlas ─────────────────────────
step('Escudos (atlas por liga) e cores')
await assets.cleanDir('public/crests')
const validPair = (p, s) => p && !(p === '#000000' && (!s || s === '#000000'))
const hasRealLogo = (team) => (team.logos || []).some((l) => l.href && !/default-team-logo/.test(l.href))
const atlasGroups = new Map()
for (const l of LEAGUES) atlasGroups.set(l.id, standings[l.id].map((row) => recs.get(row.clubId)))
atlasGroups.set('extra', extraIds.map((id) => recs.get(id)))
let crestReal = 0
let crestGen = 0
const atlasSizes = {}
for (const [group, list] of atlasGroups) {
  const images = []
  for (const c of list) {
    const crest = await assets.fetchCrest(c.espnId, { hasLogo: hasRealLogo(c.team) || !c.auto })
    // cores: catálogo > ESPN (se válidas) > dominantes do escudo > cinza
    let colors = c.meta.colors ? [hex(c.meta.colors[0]), hex(c.meta.colors[1])] : null
    if (!colors) {
      const p = hex(c.team.color)
      const s = hex(c.team.alternateColor)
      if (validPair(p, s) && !(crest && p === s)) colors = [p, s && s !== p ? s : p === '#FFFFFF' ? '#111111' : '#FFFFFF']
    }
    if (!colors && crest) colors = await assets.dominantColors(crest.buf)
    if (!colors) colors = ['#3A3F4B', '#FFFFFF']
    c.colors = { primary: colors[0], secondary: colors[1] }
    if (crest) {
      images.push(crest.buf)
      crestReal++
    } else {
      images.push(await assets.generatedBadge(c.meta.abbr || c.team.abbreviation || c.team.displayName?.slice(0, 3), colors[0], colors[1]))
      crestGen++
    }
    c.crest = { atlas: `${group}.webp`, index: images.length - 1 }
  }
  atlasSizes[group] = await assets.writeAtlas(`${group}.webp`, images)
}
log(`  ${crestReal} escudos da ESPN, ${crestGen} gerados; atlas: ${Object.keys(atlasSizes).length}, ${(Object.values(atlasSizes).reduce((a, b) => a + b, 0) / 1024).toFixed(0)} KB`)

// ───────────────────────── 8. logos de ligas/competições e bandeiras ─────────────────────────
step('Logos de ligas/competições e bandeiras')
await assets.cleanDir('public/leagues')
const logoOf = {}
const logoIds = [...LEAGUES.map((l) => l.id), ...COMPETITIONS.filter((c) => c.kind !== 'award' && !c.region).map((c) => c.id)]
await pmap(logoIds, async (id) => {
  logoOf[id] = await assets.writeLeagueLogo(id)
}, 6)
log(`  ${Object.values(logoOf).filter(Boolean).length}/${logoIds.length} logos`)
const flags = await assets.copyFlags(COUNTRIES.map((c) => c.iso2))
log(`  ${flags.copied} bandeiras${flags.missing.length ? `, sem arquivo: ${flags.missing.join(' ')}` : ''}`)

// ───────────────────────── 9. objetos finais ─────────────────────────
step('Montando GameData')
const clubs = all.map((c) => {
  const t = c.team
  const name = (c.meta.name || t.displayName || t.name || '').trim()
  const club = {
    id: c.id,
    espnId: c.espnId,
    name,
    shortName: fitName((c.meta.shortName || t.shortDisplayName || name).trim(), 14),
    abbr: String(c.meta.abbr || t.abbreviation || name.slice(0, 3)).toUpperCase().slice(0, 4),
    country: c.country,
    leagueId: c.leagueId,
    colors: c.colors,
    crest: c.crest,
    strength: c.strength,
    prestige: c.prestige,
  }
  if (c.meta.onlyNationality) club.onlyNationality = c.meta.onlyNationality
  if (c.meta.state) club.state = c.meta.state
  return club
})
const clubById = new Map(clubs.map((c) => [c.id, c]))

const leagues = LEAGUES.map((l) => ({ ...l, espnSlug: l.id, ...(logoOf[l.id] ? { logo: logoOf[l.id] } : {}) }))
const competitions = [
  ...LEAGUES.map((l) => ({
    id: l.id,
    name: l.name,
    kind: 'league',
    confed: l.confed,
    country: l.country,
    size: standings[l.id].length,
    trophyId: l.trophyId,
    ...(logoOf[l.id] ? { logo: logoOf[l.id] } : {}),
  })),
  ...COMPETITIONS.map((c) => ({ ...c, ...(logoOf[c.id] ? { logo: logoOf[c.id] } : {}) })),
]

// ───────────────────────── 10. estrelas e elencos ─────────────────────────
step('Estrelas (EA FC 27 + real-stars) e elencos da ESPN')
let rosters = new Map()
if (!ARGS.has('--no-rosters')) {
  rosters = await players.fetchRosters(all.filter((c) => !c.auto || c.slug).map((c) => ({ id: c.id, espnId: c.espnId, slug: c.leagueId === 'none' ? c.slug : c.leagueId })))
  log(`  elencos: ${[...rosters.values()].filter((x) => x.length).length} clubes, ${[...rosters.values()].reduce((a, x) => a + x.length, 0)} jogadores`)
}
const rosterIdx = rosters.size ? players.rosterIndex(rosters) : null
const eaClubKey = new Map()
for (const [espnId, ea] of matched) eaClubKey.set(`${ea.club}|${ea.leagueEaId}`, 'e' + espnId)
const eaNameToId = new Map()
for (const [espnId, ea] of matched) if (!eaNameToId.has(ea.club)) eaNameToId.set(ea.club, 'e' + espnId)
const eaClubToId = (p) => eaClubKey.get(`${p.club}|${p.leagueEaId}`) || eaNameToId.get(p.club) || null
const clubsByName = (name, leagueId) => {
  if (!name) return null
  let best = null
  let bestSim = 0
  for (const c of clubs) {
    if (leagueId && c.leagueId !== leagueId && !(leagueId && c.leagueId === 'none')) continue
    const t = recs.get(c.id).team
    const s = Math.max(...[c.name, c.shortName, t.displayName, t.shortDisplayName, t.name, t.location].filter(Boolean).map((n) => nameSim(name, n)))
    if (s > bestSim) {
      bestSim = s
      best = c.id
    }
  }
  if (bestSim >= 0.75) return best
  return leagueId ? clubsByName(name, null) : null
}
const clubIds = new Set(clubs.map((c) => c.id))
const { stars, skipped } = players.buildStars({ eaPlayers, eaClubToId, realStars: players.loadRealStars(), clubsByName, rosterIdx, clubIds, minOvr: 78 })
log(`  ${stars.length} estrelas (≥78 OVR), ${skipped} sem clube nos dados`)

// ───────────────────────── 11. gravação ─────────────────────────
const gameData = {
  generatedAt: new Date().toISOString(),
  countries: COUNTRIES,
  leagues,
  clubs,
  competitions,
  trophies: TROPHIES,
  stars,
  standings,
  fixtures,
  history: { ballonDor: BALLON_DOR, worldCup: WORLD_CUP, champions: CHAMPIONS, ballonDorShortlist: BALLON_DOR_2026 },
  cupsInProgress,
  extraClubIds: extraIds,
  confederations: CONFEDERATIONS,
  snapshot,
}
const out = r('src', 'data', 'generated', 'game-data.json')
await writeJson(out, gameData)
log(`  ${out.replace(r(''), '')}: ${((await stat(out)).size / 1024).toFixed(0)} KB`)

if (rosters.size) {
  const eaByClub = new Map()
  for (const [espnId, ea] of matched) eaByClub.set('e' + espnId, ea.players)
  const rosterOut = players.buildRosters({ rosters, clubs, eaByClub, stars })
  const rf = r('src', 'data', 'generated', 'rosters.json')
  await writeJson(rf, { generatedAt: gameData.generatedAt, clubs: rosterOut })
  log(`  ${rf.replace(r(''), '')}: ${Object.keys(rosterOut).length} clubes, ${((await stat(rf)).size / 1024).toFixed(0)} KB`)
}

const hs = httpStats()
log(`\n✓ pronto em ${((Date.now() - t0) / 1000).toFixed(1)}s — HTTP: ${hs.hit} do cache, ${hs.miss} baixados, ${hs.fail} falhas`)
log(`  ${leagues.length} ligas · ${clubs.length} clubes (${extraIds.length} extras) · ${stars.length} estrelas · ${COUNTRIES.length} países`)
log(`  força média ${round1(mean(clubs.map((c) => c.strength)))} · fontes: ${Object.entries(all.reduce((a, c) => ((a[c.strengthSource] = (a[c.strengthSource] || 0) + 1), a), {})).map(([k, v]) => `${k} ${v}`).join(', ')}`)
void fold
void countryByCode
void clubById
