// Copas em andamento hoje (CupInProgress) a partir dos scoreboards da ESPN.
import { getEvents } from './espn.mjs'

export const STAGE_PT = {
  'first-stage': 'Primeira fase',
  'second-stage': 'Segunda fase',
  'third-stage': 'Terceira fase',
  'first-round': 'Primeira fase',
  'second-round': 'Segunda fase',
  'third-round': 'Terceira fase',
  'fourth-round': 'Quarta fase',
  'fifth-round': 'Quinta fase',
  'round-of-64': '32-avos de final',
  'round-of-32': '16-avos de final',
  'knockout-round-playoffs': 'Playoffs',
  'group-stage': 'Fase de grupos',
  'league-phase': 'Fase de liga',
  'round-of-16': 'Oitavas de final',
  quarterfinals: 'Quartas de final',
  semifinals: 'Semifinal',
  final: 'Final',
}
const ORDER = Object.keys(STAGE_PT)

const isTbd = (e) => /tbd/i.test(e.home.name || '') || /tbd/i.test(e.away.name || '')

function matchResult(e) {
  const r = { home: 'e' + e.home.id, away: 'e' + e.away.id, score: [e.home.score ?? 0, e.away.score ?? 0] }
  if (e.home.shootout !== undefined && e.away.shootout !== undefined && !Number.isNaN(e.home.shootout)) r.pens = [e.home.shootout, e.away.shootout]
  if (/AET|PEN|EXTRA/i.test(e.statusName || '') || /AET|ET|Pens/i.test(e.detail || '')) r.aet = true
  return r
}

/** Agrupa eventos de uma fase em confrontos (a × b), na ordem cronológica. */
function tiesOf(events) {
  const m = new Map()
  for (const e of events) {
    if (isTbd(e)) continue
    const k = [e.home.id, e.away.id].sort().join('-')
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(e)
  }
  return [...m.values()].map((evs) => {
    evs.sort((x, y) => (x.date < y.date ? -1 : 1))
    const first = evs[0]
    return { a: 'e' + first.home.id, b: 'e' + first.away.id, events: evs }
  })
}

function decide(tie, nextStageIds) {
  const { a, b, events } = tie
  if (nextStageIds) {
    if (nextStageIds.has(a) && !nextStageIds.has(b)) return a
    if (nextStageIds.has(b) && !nextStageIds.has(a)) return b
  }
  if (!events.every((e) => e.completed)) return null
  let ga = 0
  let gb = 0
  for (const e of events) {
    const h = 'e' + e.home.id
    ga += h === a ? e.home.score : e.away.score
    gb += h === a ? e.away.score : e.home.score
  }
  if (ga !== gb) return ga > gb ? a : b
  const last = events[events.length - 1]
  if (last.home.shootout !== undefined && last.away.shootout !== undefined) {
    const h = 'e' + last.home.id
    const sh = last.home.shootout
    const sa = last.away.shootout
    if (sh !== sa) return (sh > sa) === (h === a) ? a : b
  }
  const w = last.home.winner ? 'e' + last.home.id : last.away.winner ? 'e' + last.away.id : null
  return w
}

/**
 * Estado atual de um mata-mata. `fromStage` = primeira fase a exibir como concluída.
 * Retorna { cup, clubIds:Set, unknownTeams: Map(id → competitor) }.
 */
export async function knockoutInProgress(slug, { season = 2026, year = '2026', fromStage, competitionId = slug }) {
  const { events } = await getEvents(slug, year)
  const evs = events.filter((e) => e.seasonYear === season)
  const byStage = new Map()
  for (const e of evs) {
    if (!byStage.has(e.stage)) byStage.set(e.stage, [])
    byStage.get(e.stage).push(e)
  }
  const stages = [...byStage.keys()].filter((s) => ORDER.includes(s)).sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y))
  const firstIdx = fromStage ? stages.indexOf(fromStage) : 0
  // fase atual = primeira fase (a partir de fromStage) com algum jogo não concluído e confrontos definidos
  let current = null
  for (const s of stages) {
    const list = byStage.get(s).filter((e) => !isTbd(e))
    if (list.length && list.some((e) => !e.completed)) {
      current = s
      break
    }
  }
  const teamsOf = (s) => {
    const set = new Set()
    for (const e of byStage.get(s) || []) if (!isTbd(e)) set.add('e' + e.home.id).add('e' + e.away.id)
    return set
  }
  const unknown = new Map()
  const note = (e) => {
    for (const c of [e.home, e.away]) unknown.set('e' + c.id, c)
  }
  const completed = []
  for (let i = Math.max(0, firstIdx); i < stages.length; i++) {
    const s = stages[i]
    if (s === current) break
    if (s === 'group-stage' || s === 'league-phase') continue
    const next = stages[i + 1] ? teamsOf(stages[i + 1]) : null
    const ties = tiesOf(byStage.get(s)).map((t) => {
      t.events.forEach(note)
      return { a: t.a, b: t.b, legs: t.events.map(matchResult), winner: decide(t, next) }
    })
    completed.push({ name: STAGE_PT[s], ties })
  }
  const cur = current ? tiesOf(byStage.get(current)) : []
  const alive = new Set()
  const pairs = cur.map((t) => {
    t.events.forEach(note)
    const done = t.events.every((e) => e.completed)
    const w = done ? decide(t, null) : null
    if (w) alive.add(w)
    else alive.add(t.a).add(t.b)
    return {
      a: t.a,
      b: t.b,
      legs: t.events.map((e) => {
        const leg = { home: 'e' + e.home.id, away: 'e' + e.away.id }
        if (e.completed) leg.score = [e.home.score ?? 0, e.away.score ?? 0]
        return leg
      }),
    }
  })
  const cup = {
    competitionId,
    season,
    stage: current ? STAGE_PT[current] : 'Encerrada',
    alive: [...alive],
    pairs,
    completed,
  }
  const ids = new Set([...alive, ...completed.flatMap((s) => s.ties.flatMap((t) => [t.a, t.b]))])
  return { cup, clubIds: ids, unknown }
}

/** Fase de liga (Champions/Liga Europa/Conference): tabela atual + jogos restantes. */
export async function leaguePhaseInProgress(slug, { standingsRows, season = 2026 }) {
  const fixtures = []
  const seen = new Set()
  for (const y of ['2026', '2027']) {
    const { events } = await getEvents(slug, y)
    for (const e of events) {
      if (seen.has(e.id) || e.seasonYear !== season || e.stage !== 'league-phase' || e.completed) continue
      seen.add(e.id)
      fixtures.push({ date: e.date, home: 'e' + e.home.id, away: 'e' + e.away.id })
    }
  }
  fixtures.sort((a, b) => (a.date < b.date ? -1 : 1))
  const cup = {
    competitionId: slug,
    season,
    stage: 'Fase de liga',
    alive: standingsRows.map((r) => r.clubId),
    table: standingsRows,
  }
  return { cup, fixtures }
}
