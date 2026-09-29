/**
 * Prêmios individuais. O jogador do usuário concorre com a MESMA função de pontuação dos rivais.
 *
 * Bola de Ouro / The Best (ano = temporada + 1):
 *   nota = OVRt·(0,6 + 0,4·fL)·(0,3 + 0,7·part) + estatística·fL + títulos·(0,25 + 0,75·part) + ruído N(0; 5)
 *   OVRt = 3,2·(OVR − 70) · fL = 0,45 + 0,55·coeficiente da liga · part = min(1, jogos/40)
 *   A participação pesa de verdade (antes: 0,6 + 0,4·min(1, jogos/35) e títulos cheios): quem jogou
 *   20 partidas no time campeão não sobe ao pódio pelo OVR e pelas taças dos outros; a estrela com
 *   40+ jogos não muda nada.
 *   estatística: ataque G + 0,55·A · meio 1,25·G + 0,85·A + 4 · defesa 1,6·G + A + 6 · goleiro 0,6·SG + 6
 *   títulos: Champions 32 (Libertadores 22, outras 10), Copa do Mundo 36, Euro/Copa América 20,
 *   liga 14·coef, copa 4, Liga Europa 10, Mundial de Clubes 14 … + bônus por final/semifinal.
 * Chuteira de Ouro: só ligas UEFA, gols na liga × 2 (5 maiores) ou × 1,5.
 * Luva de Ouro: goleiros · Kopa: sub-21 · Puskás: sorteio ponderado por gols^1,3 entre atacantes.
 * Artilheiro e craque de cada liga de 1ª divisão; Bola e Chuteira de Ouro da Copa em anos de Copa.
 */
import type { UserAwardEntry } from '../api'
import type {
  AwardId,
  AwardRankingEntry,
  AwardResult,
  CompetitionKind,
  Confed,
  GameData,
  Position,
  PositionGroup,
  SeasonWorldResult,
  WorldState,
} from '../types'
import { clamp, rng as subRng } from '../rng'
import { indexData, type DataIndex } from './context'
import { stageDepth } from './knockout'
import { GOAL_W, quality } from './rivals'

export function positionGroup(p: Position): PositionGroup {
  if (p === 'GOL') return 'goalkeeper'
  if (p === 'ZAG' || p === 'LD' || p === 'LE' || p === 'VOL') return 'defensive'
  if (p === 'MC' || p === 'ME' || p === 'MD' || p === 'MEI') return 'support'
  return 'attacking'
}

export interface Candidate {
  key: string
  name: string
  nationality: string
  position: Position
  clubId?: string
  leagueId?: string
  ovr: number
  age: number
  apps: number
  goals: number
  assists: number
  cleanSheets: number
  leagueGoals: number
  titles: string[]
  /** Fase alcançada nas competições do clube (competitionId → fase). */
  clubReached: Record<string, string>
  nation?: { competitionId: string; reached: string; goals: number }
  isUser?: boolean
  synthetic?: boolean
}

interface AwardEnv {
  data: GameData
  ix: DataIndex
  world: WorldState
  season: number
  result: SeasonWorldResult
  leagueOfClub: Map<string, string>
  /** Jogos de liga / jogos totais do clube na temporada. */
  leagueShare: (clubId: string | undefined) => number
}

function coefOf(env: AwardEnv, leagueId: string | undefined): number {
  return (leagueId && env.ix.league.get(leagueId)?.coefficient) || 0.5
}

function compKind(ix: DataIndex, id: string): CompetitionKind | undefined {
  if (ix.league.has(id)) return 'league'
  return ix.comp.get(id)?.kind
}

/** Pontos de um título (campeão) ou de uma campanha (fase alcançada sem título). */
export function titlePoints(ix: DataIndex, compId: string, stage: string): number {
  const kind = compKind(ix, compId)
  const comp = ix.comp.get(compId)
  const confed: Confed | undefined = comp?.confed
  const champion = stage === 'Campeão'
  const d = stageDepth(stage)
  const pick = (champ: number, final: number, semi: number, quarter = 0) =>
    champion ? champ : d >= 9 ? final : d >= 8 ? semi : d >= 7 ? quarter : 0
  if (comp?.superCup) return champion ? 2 : 0
  switch (kind) {
    case 'league': {
      const lg = ix.league.get(compId)!
      return champion ? (lg.tier === 1 ? 14 * lg.coefficient : 3) : 0
    }
    case 'domestic_cup':
      if (comp?.superCup) return champion ? 2 : 0
      if (comp?.region) return champion ? 1.5 : 0
      return pick(4, 1, 0)
    case 'continental_primary':
      if (comp?.superCup) return champion ? 2 : 0
      return confed === 'UEFA' ? pick(32, 12, 6, 2) : confed === 'CONMEBOL' ? pick(22, 9, 4, 1.5) : pick(10, 4, 2)
    case 'continental_secondary':
      return confed === 'UEFA' ? pick(10, 3, 1) : confed === 'CONMEBOL' ? pick(8, 3, 1) : pick(4, 1, 0)
    case 'continental_tertiary':
      return pick(5, 1.5, 0)
    case 'club_world_cup':
      return ix.intercontinental?.id === compId ? pick(5, 2, 0) : pick(14, 6, 3)
    case 'world_cup':
      return champion ? 36 : d >= 9 ? 18 : d >= 8 ? 10 : d >= 7 ? 5 : d >= 6 ? 2 : 0
    case 'national_continental':
      return confed === 'UEFA' || confed === 'CONMEBOL' ? pick(20, 9, 5, 2) : pick(10, 4, 2)
    default:
      return 0
  }
}

function titlesScore(env: AwardEnv, c: Candidate): number {
  let s = 0
  const done = new Set<string>()
  for (const t of c.titles) {
    if (done.has(t)) continue
    done.add(t)
    s += titlePoints(env.ix, t, 'Campeão')
  }
  for (const [comp, st] of Object.entries(c.clubReached)) if (!done.has(comp) && st !== 'Campeão') s += titlePoints(env.ix, comp, st)
  if (c.nation && !done.has(c.nation.competitionId) && c.nation.reached !== 'Campeão') s += titlePoints(env.ix, c.nation.competitionId, c.nation.reached)
  if (c.nation && c.nation.reached === 'Campeão' && !done.has(c.nation.competitionId)) s += titlePoints(env.ix, c.nation.competitionId, 'Campeão')
  return s
}

function statsScore(c: Candidate): number {
  switch (positionGroup(c.position)) {
    case 'attacking':
      return c.goals + 0.55 * c.assists
    case 'support':
      return 1.25 * c.goals + 0.85 * c.assists + 4
    case 'defensive':
      return 1.6 * c.goals + c.assists + 6
    default:
      return 0.6 * c.cleanSheets + 6
  }
}

/** Participação na temporada (0–1): 40+ jogos = temporada cheia de um titular de clube grande. */
export function participation(apps: number, full = 40): number {
  return clamp(apps / full, 0, 1)
}

/** Nota da Bola de Ouro/The Best (mesma função para todos). */
export function ballonScore(env: AwardEnv, c: Candidate, noise: number): number {
  const lf = 0.45 + 0.55 * coefOf(env, c.leagueId)
  const part = participation(c.apps)
  const ovrT = Math.max(0, c.ovr - 70) * 3.2
  return ovrT * (0.6 + 0.4 * lf) * (0.3 + 0.7 * part) + statsScore(c) * lf + titlesScore(env, c) * (0.25 + 0.75 * part) + noise
}

function noiseFor(env: AwardEnv, award: string, key: string, sd: number): number {
  return subRng(env.world.seed, 'awards', env.season, award, key).normal(0, sd)
}

function entry(c: Candidate, score: number): AwardRankingEntry {
  const e: AwardRankingEntry = {
    name: c.name,
    nationality: c.nationality,
    position: c.position,
    score: Math.round(score * 10) / 10,
  }
  if (c.clubId) e.clubId = c.clubId
  if (c.isUser) e.isUser = true
  return e
}

function rank(
  award: AwardId,
  year: number,
  cands: Candidate[],
  score: (c: Candidate) => number,
  top: number,
  leagueId?: string,
): AwardResult | null {
  if (!cands.length) return null
  const scored = cands.map((c) => ({ c, s: score(c) })).sort((a, b) => b.s - a.s || (a.c.key < b.c.key ? -1 : 1))
  const ranking = scored.slice(0, top).map((x) => entry(x.c, x.s))
  const res: AwardResult = { award, year, winner: ranking[0], ranking }
  if (leagueId) res.leagueId = leagueId
  return res
}

// ───────────────────────── candidatos ─────────────────────────

function clubTitles(env: AwardEnv, clubId: string | undefined, nationality: string): { titles: string[]; reached: Record<string, string> } {
  const titles: string[] = []
  const reached: Record<string, string> = {}
  if (clubId) {
    const lg = env.leagueOfClub.get(clubId)
    const lr = lg ? env.result.leagues[lg] : undefined
    if (lr && (lr.champion === clubId || lr.champions?.some((x) => x.clubId === clubId))) titles.push(lr.leagueId)
    for (const cup of Object.values(env.result.cups)) {
      if (cup.winner === clubId) titles.push(cup.competitionId)
      else if (cup.reached[clubId]) reached[cup.competitionId] = cup.reached[clubId]
    }
  }
  for (const t of Object.values(env.result.national)) if (t.winner === nationality) titles.push(t.competitionId)
  return { titles, reached }
}

function nationRun(env: AwardEnv, nationality: string): { competitionId: string; reached: string } | undefined {
  for (const t of Object.values(env.result.national)) {
    const r = t.reached[nationality]
    if (r) return { competitionId: t.competitionId, reached: r }
  }
  return undefined
}

function buildCandidates(env: AwardEnv, user: UserAwardEntry | null): Candidate[] {
  const out: Candidate[] = []
  const cs = env.result.clubStats ?? {}
  for (const r of env.world.rivals) {
    if (r.retired || !r.lastSeason || r.lastSeason.apps <= 0) continue
    const { titles, reached } = clubTitles(env, r.clubId, r.nationality)
    const st = cs[r.clubId]
    const csheets = r.position === 'GOL' && st && st[0] > 0 ? Math.round((st[3] * r.lastSeason.apps) / st[0]) : 0
    const nr = nationRun(env, r.nationality)
    out.push({
      key: r.id,
      name: r.name,
      nationality: r.nationality,
      position: r.position,
      clubId: r.clubId,
      leagueId: env.leagueOfClub.get(r.clubId),
      ovr: r.ovr,
      age: env.season - r.birthYear,
      apps: r.lastSeason.apps,
      goals: r.lastSeason.goals,
      assists: r.lastSeason.assists,
      cleanSheets: csheets,
      leagueGoals: Math.round(r.lastSeason.goals * env.leagueShare(r.clubId)),
      titles,
      clubReached: reached,
      nation: nr ? { ...nr, goals: 0 } : undefined,
    })
  }
  if (user) {
    const derived = clubTitles(env, user.clubId ?? undefined, user.nationality)
    const nt = user.nationalTournament
    out.push({
      key: 'user',
      name: user.name,
      nationality: user.nationality,
      position: user.position,
      clubId: user.clubId ?? undefined,
      leagueId: user.leagueId ?? (user.clubId ? env.leagueOfClub.get(user.clubId) : undefined),
      ovr: user.ovr,
      age: user.age,
      apps: user.apps,
      goals: user.goals,
      assists: user.assists,
      cleanSheets: user.cleanSheets ?? 0,
      leagueGoals: user.leagueGoals ?? Math.round(user.goals * env.leagueShare(user.clubId ?? undefined)),
      titles: user.titles.slice(),
      clubReached: derived.reached,
      nation: nt ? { competitionId: nt.competitionId, reached: nt.reached, goals: nt.goals } : undefined,
      isUser: true,
    })
  }
  return out
}

/** Artilheiros sintéticos das listas de liga como candidatos (ligas sem craques reais). */
function syntheticCandidates(env: AwardEnv, leagueId: string): Candidate[] {
  const lr = env.result.leagues[leagueId]
  if (!lr) return []
  const out: Candidate[] = []
  for (const s of lr.topScorers) {
    if (s.isUser) continue
    if (env.world.rivals.some((r) => r.name === s.name && r.clubId === s.clubId)) continue
    const club = env.ix.club.get(s.clubId)
    const str = env.world.clubs[s.clubId]?.strength ?? club?.strength ?? 65
    const { titles, reached } = clubTitles(env, s.clubId, club?.country ?? 'INT')
    out.push({
      key: `syn:${s.clubId}:${s.name}`,
      name: s.name,
      nationality: club?.country ?? 'INT',
      position: 'CA',
      clubId: s.clubId,
      leagueId,
      ovr: Math.round(Math.min(84, str + 3)),
      age: 26,
      apps: Math.round((lr.table.find((r) => r.clubId === s.clubId)?.played ?? 30) * 0.9),
      goals: Math.round(s.goals / Math.max(0.3, env.leagueShare(s.clubId))),
      assists: Math.round(s.goals * 0.25),
      cleanSheets: 0,
      leagueGoals: s.goals,
      titles,
      clubReached: reached,
      synthetic: true,
    })
  }
  return out
}

// ───────────────────────── Copa do Mundo ─────────────────────────

function tournamentGoals(t: SeasonWorldResult['national'][string], code: string): { goals: number; games: number } {
  let goals = 0
  let games = 0
  for (const g of t.groups ?? []) for (const r of g.table) if (r.clubId === code) (goals += r.gf), (games += r.played)
  for (const st of t.knockout) {
    for (const tie of st.ties) {
      for (const l of tie.legs) {
        if (l.home === code) (goals += l.score[0]), games++
        else if (l.away === code) (goals += l.score[1]), games++
      }
    }
  }
  return { goals, games }
}

function worldCupAwards(env: AwardEnv, cands: Candidate[], user: UserAwardEntry | null): AwardResult[] {
  const wc = Object.values(env.result.national).find((t) => env.ix.comp.get(t.competitionId)?.kind === 'world_cup')
  if (!wc) return []
  const year = env.season + 1
  const inWc = cands.filter((c) => !c.synthetic && wc.reached[c.nationality])
  const goals = new Map<string, number>()
  // distribui os gols de cada seleção entre os craques convocados e o "resto"
  const byNation = new Map<string, Candidate[]>()
  for (const c of inWc) {
    const l = byNation.get(c.nationality)
    if (l) l.push(c)
    else byNation.set(c.nationality, [c])
  }
  for (const [code, list] of byNation) {
    const tg = tournamentGoals(wc, code).goals
    const userGoals = list.find((c) => c.isUser)?.nation?.competitionId === wc.competitionId ? (user?.nationalTournament?.goals ?? 0) : 0
    let left = Math.max(0, tg - userGoals)
    const rng = subRng(env.world.seed, 'awards', env.season, 'wc-goals', code)
    const pool = list.filter((c) => !c.isUser)
    const ws = pool.map((c) => GOAL_W[c.position] * quality(c.ovr))
    const rest = 3.2 * quality(env.world.nations[code] ?? 70)
    const total = ws.reduce((s, x) => s + x, 0) + rest
    while (left-- > 0) {
      let x = rng.next() * total
      let who = -1
      for (let i = 0; i < ws.length; i++) {
        x -= ws[i]
        if (x < 0) {
          who = i
          break
        }
      }
      if (who >= 0) goals.set(pool[who].key, (goals.get(pool[who].key) ?? 0) + 1)
    }
    if (userGoals) goals.set('user', userGoals)
  }
  const out: AwardResult[] = []
  const stageBonus = (st: string | undefined) =>
    st === 'Campeão' ? 22 : st === 'Final' ? 14 : st?.startsWith('Semi') ? 8 : st?.startsWith('Quartas') ? 4 : st?.startsWith('Oitavas') ? 1.5 : 0
  const ball = rank(
    'wc_golden_ball',
    year,
    inWc,
    (c) => Math.max(0, c.ovr - 70) * 2 + (goals.get(c.key) ?? 0) * 4.5 + stageBonus(wc.reached[c.nationality]) + noiseFor(env, 'wc_ball', c.key, 4),
    5,
  )
  if (ball) out.push(ball)
  const boot = rank('wc_golden_boot', year, inWc, (c) => (goals.get(c.key) ?? 0) + c.ovr / 1000, 5)
  if (boot) {
    boot.ranking = boot.ranking.map((e) => ({ ...e, score: Math.floor(e.score) }))
    boot.winner = boot.ranking[0]
    out.push(boot)
  }
  return out
}

// ───────────────────────── API ─────────────────────────

export function computeAwards(
  data: GameData,
  world: WorldState,
  season: number,
  user: UserAwardEntry | null,
): { world: WorldState; awards: AwardResult[] } {
  const result0 = world.seasons[season]
  if (!result0) return { world, awards: [] }
  const ix = indexData(data)
  const leagueOfClub = new Map<string, string>()
  const leaguePlayed = new Map<string, number>()
  for (const l of Object.values(result0.leagues)) {
    for (const r of l.table) {
      leagueOfClub.set(r.clubId, l.leagueId)
      leaguePlayed.set(r.clubId, r.played)
    }
  }
  const cs = result0.clubStats ?? {}
  const leagueShare = (clubId: string | undefined) => {
    if (!clubId) return 1
    const total = cs[clubId]?.[0] ?? 0
    const lp = leaguePlayed.get(clubId) ?? 0
    return total > 0 ? clamp(lp / total, 0, 1) : lp > 0 ? 1 : 0
  }

  // artilharia da liga do usuário (o usuário entra na lista com a mesma regra dos rivais)
  const leagues = { ...result0.leagues }
  if (user && user.clubId) {
    const lg = leagueOfClub.get(user.clubId) ?? user.leagueId ?? undefined
    const lr = lg ? leagues[lg] : undefined
    if (lr) {
      const goals = user.leagueGoals ?? Math.round(user.goals * leagueShare(user.clubId))
      const list = lr.topScorers.filter((s) => !s.isUser)
      if (goals > 0) list.push({ name: user.name, clubId: user.clubId, goals, isUser: true })
      list.sort((a, b) => b.goals - a.goals || (a.isUser ? -1 : b.isUser ? 1 : 0))
      leagues[lr.leagueId] = { ...lr, topScorers: list.slice(0, 5) }
    }
  }
  const result: SeasonWorldResult = { ...result0, leagues }
  const env: AwardEnv = { data, ix, world, season, result, leagueOfClub, leagueShare }
  const cands = buildCandidates(env, user)
  const year = season + 1
  const awards: AwardResult[] = []
  const push = (a: AwardResult | null) => a && awards.push(a)

  push(rank('ballon_dor', year, cands, (c) => ballonScore(env, c, noiseFor(env, 'ballon_dor', c.key, 5)), 10))
  push(rank('the_best', year, cands, (c) => ballonScore(env, c, noiseFor(env, 'the_best', c.key, 5)), 10))
  push(
    rank(
      'kopa',
      year,
      cands.filter((c) => c.age <= 21),
      (c) => ballonScore(env, c, noiseFor(env, 'kopa', c.key, 4)),
      5,
    ),
  )
  push(
    rank(
      'golden_glove',
      year,
      cands.filter((c) => c.position === 'GOL'),
      (c) => Math.max(0, c.ovr - 70) * 3 + c.cleanSheets * 1.3 + titlesScore(env, c) * 0.5 + noiseFor(env, 'golden_glove', c.key, 4),
      5,
    ),
  )
  // Chuteira de Ouro europeia (só ligas da UEFA)
  const uefaLeague = (id: string | undefined) => !!id && ix.league.get(id)?.confed === 'UEFA'
  const shoe: Candidate[] = cands.filter((c) => uefaLeague(c.leagueId))
  for (const l of data.leagues) if (l.confed === 'UEFA' && l.tier === 1) shoe.push(...syntheticCandidates(env, l.id))
  const shoeRes = rank(
    'golden_boot',
    year,
    shoe,
    (c) => c.leagueGoals * (ix.uefaTop5.has(c.leagueId!) ? 2 : 1.5) + c.leagueGoals / 1000,
    5,
  )
  if (shoeRes) {
    shoeRes.ranking = shoeRes.ranking.map((e) => ({ ...e, score: Math.floor(e.score * 2) / 2 }))
    shoeRes.winner = shoeRes.ranking[0]
    awards.push(shoeRes)
  }
  // Puskás: sorteio ponderado entre quem fez muitos gols
  const pusk = cands.filter((c) => positionGroup(c.position) !== 'goalkeeper' && c.goals >= 6)
  for (const l of data.leagues) if (l.tier === 1) pusk.push(...syntheticCandidates(env, l.id).slice(0, 2))
  if (pusk.length) {
    const prng = subRng(world.seed, 'awards', season, 'puskas')
    const pool = pusk.slice()
    const podium: Candidate[] = []
    while (podium.length < 3 && pool.length) {
      const c = prng.weighted(pool, (x) => Math.pow(x.goals, 1.3))
      podium.push(c)
      pool.splice(pool.indexOf(c), 1)
    }
    const ranking = podium.map((c, i) => entry(c, 3 - i))
    awards.push({ award: 'puskas', year, winner: ranking[0], ranking })
  }
  // por liga: artilheiro e craque
  for (const l of data.leagues) {
    if (l.tier !== 1) continue
    const lr = result.leagues[l.id]
    if (!lr) continue
    const ly = l.calendar === 'calendar' ? season : season + 1
    if (lr.topScorers.length) {
      const ranking: AwardRankingEntry[] = lr.topScorers.slice(0, 3).map((s) => {
        const rival = world.rivals.find((r) => r.clubId === s.clubId && r.name === s.name)
        const e: AwardRankingEntry = {
          name: s.name,
          nationality: s.isUser ? (user?.nationality ?? '') : (rival?.nationality ?? ix.club.get(s.clubId)?.country ?? ''),
          position: s.isUser ? (user?.position ?? 'CA') : (rival?.position ?? 'CA'),
          clubId: s.clubId,
          score: s.goals,
        }
        if (s.isUser) e.isUser = true
        return e
      })
      awards.push({ award: 'league_top_scorer', year: ly, winner: ranking[0], ranking, leagueId: l.id })
    }
    const inLeague = cands.filter((c) => c.leagueId === l.id)
    const syn = syntheticCandidates(env, l.id)
    const best = rank(
      'league_best_player',
      ly,
      [...inLeague, ...syn],
      (c) => {
        // craque da liga: quem foi titular a temporada toda (a mesma régua da Bola de Ouro)
        const part = participation(c.apps, 35)
        const titles = (c.titles.includes(l.id) ? 12 : 0) + (l.domesticCupId && c.titles.includes(l.domesticCupId) ? 3 : 0)
        return (
          Math.max(0, c.ovr - 70) * 3.2 * (0.3 + 0.7 * part) +
          statsScore(c) +
          titles * (0.25 + 0.75 * part) +
          noiseFor(env, `lbp:${l.id}`, c.key, 4)
        )
      },
      3,
      l.id,
    )
    if (best) awards.push(best)
  }
  awards.push(...worldCupAwards(env, cands, user))

  const seasons = { ...world.seasons, [season]: { ...result, awards } }
  return { world: { ...world, seasons }, awards }
}
