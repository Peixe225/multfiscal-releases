/** Resumos por clube e por seleção a partir do resultado da temporada (linha da carreira). */
import type { ClubSeasonSummary, NationSeasonSummary } from '../api'
import type { GameData, SeasonWorldResult } from '../types'
import { rng as subRng } from '../rng'
import { indexData } from './context'

export function clubSeason(result: SeasonWorldResult, data: GameData, clubId: string): ClubSeasonSummary {
  const ix = indexData(data)
  let leagueId = ix.club.get(clubId)?.leagueId ?? 'none'
  let position = 0
  let points = 0
  let played = 0
  let gf = 0
  let ga = 0
  let champion = false
  let promoted = false
  let relegated = false
  const titles: ClubSeasonSummary['titles'] = []
  for (const l of Object.values(result.leagues)) {
    const i = l.table.findIndex((r) => r.clubId === clubId)
    if (i < 0) continue
    const row = l.table[i]
    leagueId = l.leagueId
    position = i + 1
    points = row.points
    played = row.played
    gf = row.gf
    ga = row.ga
    promoted = l.promoted.includes(clubId)
    relegated = l.relegated.includes(clubId)
    const league = ix.league.get(l.leagueId)
    const wins = l.champions?.length ? l.champions.filter((c) => c.clubId === clubId).length : l.champion === clubId ? 1 : 0
    champion = wins > 0
    for (let k = 0; k < wins; k++) titles.push({ competitionId: l.leagueId, trophyId: league?.trophyId ?? l.leagueId, kind: 'league' })
    break
  }
  const reached: Record<string, string> = {}
  for (const cup of Object.values(result.cups)) {
    const st = cup.winner === clubId ? 'Campeão' : cup.reached[clubId]
    if (!st) continue
    reached[cup.competitionId] = st
    if (cup.winner === clubId) {
      const comp = ix.comp.get(cup.competitionId)
      titles.push({
        competitionId: cup.competitionId,
        trophyId: comp?.trophyId ?? cup.trophyId ?? cup.competitionId,
        kind: comp?.kind ?? 'domestic_cup',
      })
    }
  }
  const st = result.clubStats?.[clubId]
  const league = ix.league.get(leagueId)
  const tier = (league?.tier ?? 1) as 1 | 2 | 3
  // sem estatística agregada (resultado antigo): liga + estimativa de sem-sofrer-gol pela média
  const matches = st ? st[0] : played
  return {
    clubId,
    leagueId,
    tier,
    position,
    points,
    leagueChampion: champion,
    promoted,
    relegated,
    matches,
    goalsFor: st ? st[1] : gf,
    goalsAgainst: st ? st[2] : ga,
    cleanSheets: st ? st[3] : Math.round(played * Math.exp(-(ga / Math.max(1, played)))),
    titles,
    reached,
  }
}

export function nationSeason(result: SeasonWorldResult, countryCode: string): NationSeasonSummary {
  const st = result.nationStats?.[countryCode]
  let matches = st?.[0] ?? 0
  let goalsFor = st?.[1] ?? 0
  if (!st) {
    const r = subRng('nation', result.season, countryCode)
    matches = r.int(7, 10)
    goalsFor = r.poisson(matches * 1.3)
  }
  const out: NationSeasonSummary = { countryCode, matches, goalsFor }
  for (const t of Object.values(result.national)) {
    const reached = t.winner === countryCode ? 'Campeão' : t.reached[countryCode]
    if (!reached) continue
    out.tournament = {
      competitionId: t.competitionId,
      reached,
      champion: t.winner === countryCode,
      trophyId: t.trophyId ?? t.competitionId,
    }
    break
  }
  return out
}
