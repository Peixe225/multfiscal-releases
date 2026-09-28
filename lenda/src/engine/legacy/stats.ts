/**
 * Números de uma run (carreira do jogador) a partir de SeasonRecord[] — funciona para o Clássico e
 * para o Imersivo (os dois produzem SeasonRecord). Sem temporadas, cai para o CareerSummary.
 */
import type { CareerSummary, NationalTeamCareer, PlayerIdentity, Position, PositionGroup, SeasonRecord, TrophyWin } from '../types'
import { emptyValues, positionGroupOf, type CategoryValues } from './categories'

export interface RunInput {
  id: string
  /** Número sequencial da run (1 = a primeira carreira encerrada). */
  runNo?: number
  finishedAt?: string
  identity: PlayerIdentity
  seasons: SeasonRecord[]
  /** Totais da seleção; se ausente, soma `SeasonRecord.national`. */
  national?: Pick<NationalTeamCareer, 'apps' | 'goals' | 'assists'>
  summary?: Pick<CareerSummary, 'totals' | 'clubs' | 'awards' | 'trophies' | 'peakOvr'>
  /** Clubes principais para exibição (opcional). */
  peakOvr?: number
  /**
   * Só para runs sem temporadas (resumo antigo/importado): divisão da liga de um troféu (1 = primeira;
   * undefined = não é liga). Sem ela, uma run só com CareerSummary fica SEM dados de títulos
   * nacionais (`stats.leagueDataMissing`).
   */
  leagueTier?: (trophyId: string) => number | undefined
}

export interface SeasonBest {
  value: number
  season: number
  age: number
  clubId: string
}

export interface RunStats {
  /** Categorias (records fica 0 aqui; é preenchido pela avaliação). */
  values: CategoryValues
  apps: number
  goals: number
  assists: number
  cleanSheets: number
  seasons: number
  /** Todos os títulos, inclusive estaduais e supercopas. */
  titles: number
  otherMajorTitles: number
  position: Position
  positionGroup: PositionGroup
  nationality: string
  /** Clubes na ordem em que apareceram. */
  clubIds: string[]
  /** Clube com mais temporadas (desempate: jogos). */
  mainClubId?: string
  clubTotals: { clubId: string; seasons: number; apps: number; goals: number }[]
  bestSeasonGoals: SeasonBest | null
  bestSeasonAssists: SeasonBest | null
  bestClubGoals: { clubId: string; goals: number } | null
  nationalApps: number
  nationalGoals: number
  youngestBallonDorAge: number | null
  ballonDorStreak: number
  oneClub: boolean
  peakOvr: number
  firstAge: number
  lastAge: number
  /** Run só com CareerSummary e sem `leagueTier`: títulos nacionais desconhecidos (contam 0). */
  leagueDataMissing?: boolean
}

type TrophyClass = 'worldCup' | 'ucl' | 'libertadores' | 'league' | 'other' | 'minor'

function classify(t: TrophyWin, recordTier: number): TrophyClass {
  if (t.minor) return 'minor'
  const kind = t.kind
  if (kind === 'world_cup' || (!kind && t.trophyId === 'world-cup')) return 'worldCup'
  if (kind === 'continental_primary' || (!kind && (t.trophyId === 'champions-league' || t.trophyId === 'libertadores'))) {
    if (t.confed === 'UEFA' || t.trophyId === 'champions-league') return 'ucl'
    if (t.confed === 'CONMEBOL' || t.trophyId === 'libertadores') return 'libertadores'
    return 'other'
  }
  if (kind === 'league') return (t.tier ?? recordTier) === 1 ? 'league' : 'minor'
  if (kind === 'national_continental' || kind === 'club_world_cup' || kind === 'continental_secondary' || kind === 'continental_tertiary') return 'other'
  return 'minor'
}

export function runStats(input: RunInput): RunStats {
  const seasons = input.seasons ?? []
  const values = emptyValues()
  let apps = 0
  let goals = 0
  let assists = 0
  let cleanSheets = 0
  let natApps = 0
  let natGoals = 0
  let natAssists = 0
  let titles = 0
  let otherMajor = 0
  let peak = input.peakOvr ?? input.summary?.peakOvr ?? 0
  const clubs = new Map<string, { clubId: string; seasons: number; apps: number; goals: number }>()
  const posApps = new Map<Position, number>()
  let bestSeasonGoals: SeasonBest | null = null
  let bestSeasonAssists: SeasonBest | null = null
  let youngest: number | null = null
  const bdoYears: number[] = []

  for (const r of seasons) {
    apps += r.stats.apps
    goals += r.stats.goals
    assists += r.stats.assists
    cleanSheets += r.stats.cleanSheets ?? 0
    if (r.national) {
      natApps += r.national.apps
      natGoals += r.national.goals
      natAssists += r.national.assists
    }
    peak = Math.max(peak, r.ovrStart, r.ovrEnd)
    const cl = clubs.get(r.clubId) ?? { clubId: r.clubId, seasons: 0, apps: 0, goals: 0 }
    cl.seasons++
    cl.apps += r.stats.apps
    cl.goals += r.stats.goals
    clubs.set(r.clubId, cl)
    const pos = r.position ?? input.identity.position
    posApps.set(pos, (posApps.get(pos) ?? 0) + Math.max(1, r.stats.apps))
    if (!bestSeasonGoals || r.stats.goals > bestSeasonGoals.value) bestSeasonGoals = { value: r.stats.goals, season: r.season, age: r.age, clubId: r.clubId }
    if (!bestSeasonAssists || r.stats.assists > bestSeasonAssists.value) bestSeasonAssists = { value: r.stats.assists, season: r.season, age: r.age, clubId: r.clubId }
    for (const t of r.trophies) {
      titles++
      const k = classify(t, r.tier)
      if (k === 'worldCup') values.worldCups++
      else if (k === 'ucl') values.ucl++
      else if (k === 'libertadores') values.libertadores++
      else if (k === 'league') values.leagueTitles++
      else if (k === 'other') otherMajor++
    }
    for (const a of r.awards) {
      if (a.place !== 1) continue
      if (a.award === 'ballon_dor') {
        values.ballonDor++
        bdoYears.push(a.year)
        const age = a.year - (r.season - r.age)
        youngest = youngest === null ? age : Math.min(youngest, age)
      } else if (a.award === 'golden_boot') values.goldenBoots++
    }
  }

  // seleção: totais explícitos (CareerState.national) ou a soma por temporada
  const nat = input.national ?? { apps: natApps, goals: natGoals, assists: natAssists }
  apps += nat.apps
  goals += nat.goals
  assists += nat.assists

  // sem temporadas (resumo antigo/importado): usa o CareerSummary
  const sum = input.summary
  const summaryOnly = !seasons.length && !!sum
  if (summaryOnly && sum) {
    apps = sum.totals.apps
    goals = sum.totals.goals
    assists = sum.totals.assists
    cleanSheets = sum.totals.cleanSheets ?? 0
    for (const c of sum.clubs) clubs.set(c.clubId, { clubId: c.clubId, seasons: c.seasons, apps: c.apps, goals: c.goals })
    for (const a of sum.awards) {
      if (a.award === 'ballon_dor') (values.ballonDor = a.count), bdoYears.push(...a.years)
      if (a.award === 'golden_boot') values.goldenBoots = a.count
    }
    for (const t of sum.trophies) {
      titles += t.count
      if (t.trophyId === 'world-cup') values.worldCups += t.count
      else if (t.trophyId === 'champions-league') values.ucl += t.count
      else if (t.trophyId === 'libertadores') values.libertadores += t.count
      else if (input.leagueTier?.(t.trophyId) === 1) values.leagueTitles += t.count
    }
  }

  // sequência de Bolas de Ouro em anos consecutivos
  const years = [...new Set(bdoYears)].sort((a, b) => a - b)
  let streak = 0
  let run = 0
  for (let i = 0; i < years.length; i++) {
    run = i > 0 && years[i] === years[i - 1] + 1 ? run + 1 : 1
    streak = Math.max(streak, run)
  }

  const clubTotals = [...clubs.values()]
  const main = clubTotals.slice().sort((a, b) => b.seasons - a.seasons || b.apps - a.apps)[0]
  const bestClub = clubTotals.slice().sort((a, b) => b.goals - a.goals)[0]
  let position = input.identity.position
  let best = -1
  for (const [p, n] of posApps) if (n > best) (best = n), (position = p)

  values.clubs = clubs.size
  values.goals = goals
  values.assists = assists
  values.goalsPerGame = apps > 0 ? goals / apps : 0

  return {
    values,
    apps,
    goals,
    assists,
    cleanSheets,
    seasons: seasons.length || (sum ? Math.max(0, ...sum.clubs.map((c) => c.seasons)) : 0),
    titles,
    otherMajorTitles: otherMajor,
    position,
    positionGroup: positionGroupOf(position),
    nationality: seasons.at(-1)?.nationality ?? input.identity.nationality,
    clubIds: [...clubs.keys()],
    mainClubId: main?.clubId,
    clubTotals,
    bestSeasonGoals,
    bestSeasonAssists,
    bestClubGoals: bestClub ? { clubId: bestClub.clubId, goals: bestClub.goals } : null,
    nationalApps: nat.apps,
    nationalGoals: nat.goals,
    youngestBallonDorAge: youngest,
    ballonDorStreak: streak,
    oneClub: clubs.size === 1 && seasons.length > 0 && seasons.every((r) => !r.loan),
    peakOvr: peak,
    firstAge: seasons[0]?.age ?? 16,
    lastAge: seasons.at(-1)?.age ?? 16,
    ...(summaryOnly && !input.leagueTier ? { leagueDataMissing: true } : {}),
  }
}
