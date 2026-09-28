#!/usr/bin/env node
// Valida src/data/generated/game-data.json (integridade referencial) e imprime um resumo.
//   node scripts/validate-data.mjs            → erros + resumo
//   node scripts/validate-data.mjs --league bra.1  → força dos clubes de uma liga
import { readFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'
import { r, mean, round1 } from './lib/util.mjs'
import { ATLAS_COLS, CREST_SIZE } from './lib/assets.mjs'

const args = process.argv.slice(2)
const data = JSON.parse(readFileSync(r('src', 'data', 'generated', 'game-data.json'), 'utf8'))
const errors = []
const warns = []
const err = (m) => errors.push(m)
const warn = (m) => warns.push(m)

const dup = (arr, what) => {
  const seen = new Set()
  for (const x of arr) {
    if (seen.has(x.id ?? x.code)) err(`${what} duplicado: ${x.id ?? x.code}`)
    seen.add(x.id ?? x.code)
  }
  return seen
}
const clubIds = dup(data.clubs, 'clube')
const leagueIds = dup(data.leagues, 'liga')
const countryCodes = dup(data.countries, 'país')
const trophyIds = dup(data.trophies, 'troféu')
const compIds = dup(data.competitions, 'competição')
dup(data.stars, 'estrela')
const club = (id, where) => {
  if (!clubIds.has(id)) err(`${where}: clube inexistente ${id}`)
}

// ── países e bandeiras ──
const iso = new Set()
for (const c of data.countries) {
  if (!existsSync(r('public', 'flags', '4x3', `${c.iso2}.svg`))) err(`bandeira ausente: ${c.code} (${c.iso2})`)
  if (iso.has(c.iso2)) warn(`iso2 repetido: ${c.iso2}`)
  iso.add(c.iso2)
  if (c.strength < 40 || c.strength > 95) err(`força fora da faixa: ${c.code} ${c.strength}`)
}

// ── ligas ──
for (const l of data.leagues) {
  if (!trophyIds.has(l.trophyId)) err(`liga ${l.id}: troféu ${l.trophyId} inexistente`)
  if (!compIds.has(l.id)) err(`liga ${l.id}: sem Competition`)
  if (!countryCodes.has(l.country)) err(`liga ${l.id}: país ${l.country} inexistente`)
  if (l.domesticCupId && !compIds.has(l.domesticCupId)) err(`liga ${l.id}: copa ${l.domesticCupId} inexistente`)
  if (l.secondaryCupId && !compIds.has(l.secondaryCupId)) err(`liga ${l.id}: copa ${l.secondaryCupId} inexistente`)
  for (const k of ['upperLeagueId', 'lowerLeagueId']) if (l[k] && !leagueIds.has(l[k])) err(`liga ${l.id}: ${k} ${l[k]} inexistente`)
  const up = l.upperLeagueId && data.leagues.find((x) => x.id === l.upperLeagueId)
  if (up && up.relegation !== l.promotion) err(`liga ${l.id}: acesso ${l.promotion} ≠ rebaixamento de ${up.id} (${up.relegation})`)
  if (up && up.lowerLeagueId !== l.id) err(`liga ${l.id}: ${up.id}.lowerLeagueId deveria ser ${l.id}`)
  if (!data.standings[l.id]?.length) err(`liga ${l.id}: sem tabela`)
  if (l.logo && !existsSync(r('public', l.logo))) err(`liga ${l.id}: logo ${l.logo} não existe`)
  if (!data.snapshot?.[l.id]) err(`liga ${l.id}: sem snapshot`)
}
for (const c of data.competitions) {
  if (!trophyIds.has(c.trophyId)) err(`competição ${c.id}: troféu ${c.trophyId} inexistente`)
  if (c.logo && !existsSync(r('public', c.logo))) err(`competição ${c.id}: logo ${c.logo} não existe`)
  if (c.country && !countryCodes.has(c.country)) err(`competição ${c.id}: país ${c.country}`)
}
for (const [confed, cc] of Object.entries(data.confederations || {})) for (const [k, id] of Object.entries(cc)) if (!compIds.has(id)) err(`confed ${confed}.${k}: ${id} inexistente`)

// ── clubes ──
const atlasCount = {}
for (const c of data.clubs) {
  if (c.leagueId !== 'none' && !leagueIds.has(c.leagueId)) err(`clube ${c.id}: liga ${c.leagueId}`)
  if (!countryCodes.has(c.country)) err(`clube ${c.id} ${c.name}: país ${c.country} inexistente`)
  if (!/^#[0-9A-F]{6}$/i.test(c.colors?.primary) || !/^#[0-9A-F]{6}$/i.test(c.colors?.secondary)) err(`clube ${c.id}: cores inválidas`)
  if (c.strength < 40 || c.strength > 92) err(`clube ${c.id}: força ${c.strength}`)
  if (c.prestige < 0 || c.prestige > 5) err(`clube ${c.id}: prestígio ${c.prestige}`)
  if (c.shortName.length > 14) err(`clube ${c.id}: shortName longo "${c.shortName}"`)
  if (!c.crest) warn(`clube ${c.id} sem escudo`)
  else atlasCount[c.crest.atlas] = Math.max(atlasCount[c.crest.atlas] || 0, c.crest.index + 1)
  if (c.onlyNationality && !countryCodes.has(c.onlyNationality)) err(`clube ${c.id}: onlyNationality`)
}
for (const id of data.extraClubIds) {
  club(id, 'extraClubIds')
  if (data.clubs.find((c) => c.id === id)?.leagueId !== 'none') err(`extra ${id} com liga`)
}
for (const [atlas, n] of Object.entries(atlasCount)) {
  const f = r('public', 'crests', atlas)
  if (!existsSync(f)) {
    err(`atlas ausente: ${atlas}`)
    continue
  }
  const m = await sharp(f).metadata()
  const cap = (m.width / CREST_SIZE) * (m.height / CREST_SIZE)
  if (m.width !== ATLAS_COLS * CREST_SIZE || n > cap) err(`atlas ${atlas}: ${n} índices para ${cap} células (${m.width}×${m.height})`)
}

// ── tabelas, jogos, copas, estrelas, histórico ──
for (const [lid, rows] of Object.entries(data.standings)) {
  const seen = new Set()
  for (const row of rows) {
    club(row.clubId, `tabela ${lid}`)
    if (seen.has(row.clubId)) err(`tabela ${lid}: ${row.clubId} repetido`)
    seen.add(row.clubId)
    const c = data.clubs.find((x) => x.id === row.clubId)
    if (c && c.leagueId !== lid) err(`tabela ${lid}: ${row.clubId} é da liga ${c.leagueId}`)
    if (row.won + row.drawn + row.lost !== row.played) warn(`tabela ${lid}: ${row.clubId} V+E+D ≠ J`)
  }
}
for (const [id, list] of Object.entries(data.fixtures)) {
  if (!leagueIds.has(id) && !compIds.has(id)) err(`fixtures: competição ${id}`)
  for (const f of list) {
    club(f.home, `jogos ${id}`)
    club(f.away, `jogos ${id}`)
  }
}
for (const [id, cup] of Object.entries(data.cupsInProgress)) {
  if (!compIds.has(id)) err(`copa em andamento ${id} sem Competition`)
  for (const a of cup.alive) club(a, `copa ${id} (vivos)`)
  for (const p of cup.pairs || []) {
    club(p.a, `copa ${id}`)
    club(p.b, `copa ${id}`)
  }
  for (const row of cup.table || []) club(row.clubId, `copa ${id} (tabela)`)
  for (const s of cup.completed || []) for (const t of s.ties) {
    club(t.a, `copa ${id} ${s.name}`)
    club(t.b, `copa ${id} ${s.name}`)
    if (!t.winner) err(`copa ${id} ${s.name}: confronto ${t.a}×${t.b} sem vencedor`)
  }
}
for (const s of data.stars) {
  if (s.clubId) club(s.clubId, `estrela ${s.name}`)
  if (!countryCodes.has(s.nationality)) err(`estrela ${s.name}: nacionalidade ${s.nationality}`)
}
for (const b of data.history.ballonDor) {
  club(b.club, `Bola de Ouro ${b.year}`)
  if (!countryCodes.has(b.nationality)) err(`Bola de Ouro ${b.year}: ${b.nationality}`)
}
for (const w of data.history.worldCup) for (const k of ['champion', 'runnerUp']) if (!countryCodes.has(w[k])) err(`Copa ${w.year}: ${w[k]}`)
for (const [cid, list] of Object.entries(data.history.champions)) {
  if (!compIds.has(cid)) err(`histórico: competição ${cid}`)
  for (const x of list) if (!clubIds.has(x.winner) && !countryCodes.has(x.winner)) err(`histórico ${cid} ${x.season}: ${x.winner}`)
}

// ── elencos (opcional) ──
const rosterFile = r('src', 'data', 'generated', 'rosters.json')
let rosterSummary = ''
if (existsSync(rosterFile)) {
  const R = JSON.parse(readFileSync(rosterFile, 'utf8'))
  const POS = new Set(['GOL', 'ZAG', 'LD', 'LE', 'VOL', 'MC', 'ME', 'MD', 'MEI', 'PE', 'PD', 'CA'])
  let n = 0
  let ea = 0
  for (const [id, list] of Object.entries(R.clubs)) {
    club(id, 'rosters')
    for (const p of list) {
      n++
      if (p.ea) ea++
      if (!POS.has(p.position)) err(`rosters ${id}: posição ${p.position} (${p.name})`)
      if (!countryCodes.has(p.nationality)) err(`rosters ${id}: nacionalidade ${p.nationality} (${p.name})`)
      if (!(p.ovr >= 40 && p.ovr <= 95)) err(`rosters ${id}: ovr ${p.ovr} (${p.name})`)
    }
  }
  rosterSummary = ` · elencos: ${Object.keys(R.clubs).length} clubes, ${n} jogadores (${ea} com nota EA)`
}

// ── resumo ──
const pad = (s, n) => String(s).padEnd(n)
const lpad = (s, n) => String(s).padStart(n)
console.log(`\nGameData ${data.generatedAt}`)
console.log(`  ${data.leagues.length} ligas · ${data.clubs.length} clubes (${data.extraClubIds.length} extras) · ${data.countries.length} países · ${data.competitions.length} competições · ${data.trophies.length} troféus · ${data.stars.length} estrelas`)
console.log(`  jogos restantes: ${Object.values(data.fixtures).reduce((a, x) => a + x.length, 0)} · copas em andamento: ${Object.keys(data.cupsInProgress).join(', ')}${rosterSummary}`)
console.log('\n  liga      clubes  força  min–max   coef  fase             jogos/clube restantes')
for (const l of data.leagues) {
  const cs = data.clubs.filter((c) => c.leagueId === l.id)
  const st = cs.map((c) => c.strength)
  const sn = data.snapshot[l.id]
  console.log(`  ${pad(l.id, 9)} ${lpad(cs.length, 5)}  ${lpad(round1(mean(st)).toFixed(1), 5)}  ${lpad(Math.min(...st), 4)}–${pad(Math.max(...st), 4)}  ${l.coefficient.toFixed(2)}  ${pad(sn.phase + (sn.stale ? ' (zerada)' : ''), 17)} ${lpad(sn.gamesPerTeam, 3)}${sn.fixturesComplete ? '✓' : ' '}   ${lpad(data.fixtures[l.id]?.length || 0, 4)}`)
}
const top = [...data.clubs].sort((a, b) => b.strength - a.strength).slice(0, 10)
console.log('\n  10 mais fortes: ' + top.map((c) => `${c.shortName} ${c.strength}`).join(' · '))
const league = args.includes('--league') ? args[args.indexOf('--league') + 1] : 'bra.1'
for (const lid of league === 'bra.1' ? ['bra.1', 'bra.2'] : [league]) {
  const list = data.clubs.filter((c) => c.leagueId === lid).sort((a, b) => b.strength - a.strength)
  console.log(`\n  ${lid} por força: ` + list.map((c) => `${c.shortName} ${c.strength} (p${c.prestige})`).join(' · '))
}

if (warns.length) console.log(`\n  ${warns.length} avisos:\n    ` + warns.slice(0, 20).join('\n    ') + (warns.length > 20 ? `\n    … +${warns.length - 20}` : ''))
if (errors.length) {
  console.log(`\n✗ ${errors.length} erros:\n    ` + errors.slice(0, 60).join('\n    ') + (errors.length > 60 ? `\n    … +${errors.length - 60}` : ''))
  process.exit(1)
}
console.log('\n✓ dados válidos')
