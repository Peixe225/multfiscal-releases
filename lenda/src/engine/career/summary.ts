/**
 * Resumo final da carreira: clubes, totais, vitrine agrupada, prêmios, picos, pódios da Bola de
 * Ouro, nota de legado (0–100), título honorífico e comparações com lendas reais.
 */
import type { AwardId, CareerState, CareerSummary, GameData, TrophyFamily, TrophyWin } from '../types'
import { START_OVR } from './constants'
import { totalsOf } from './season'
import { indexData, withArticle } from './util'

const FAMILY_ORDER: TrophyFamily[] = [
  'world_cup',
  'national_continental',
  'club_world_cup',
  'continental_primary',
  'continental_secondary',
  'continental_tertiary',
  'league',
  'domestic_cup',
  'award',
]

const AWARD_ORDER: AwardId[] = [
  'ballon_dor',
  'the_best',
  'golden_boot',
  'golden_glove',
  'kopa',
  'wc_golden_ball',
  'wc_golden_boot',
  'league_best_player',
  'league_top_scorer',
  'puskas',
  'team_of_the_year',
]

/** Números de carreira de lendas reais (arredondados, fontes públicas até 2026). */
export const LEGENDS: { name: string; goals: number; goalsNote: string; worldCups: number; ballonDor: number; champions: number; libertadores: number }[] = [
  { name: 'Pelé', goals: 757, goalsNote: '757 gols oficiais', worldCups: 3, ballonDor: 0, champions: 0, libertadores: 2 },
  { name: 'Romário', goals: 1000, goalsNote: 'mais de 1.000 gols pela contagem dele', worldCups: 1, ballonDor: 0, champions: 0, libertadores: 0 },
  { name: 'Cristiano Ronaldo', goals: 900, goalsNote: 'mais de 900 gols', worldCups: 0, ballonDor: 5, champions: 5, libertadores: 0 },
  { name: 'Messi', goals: 850, goalsNote: 'mais de 850 gols', worldCups: 1, ballonDor: 8, champions: 4, libertadores: 0 },
  { name: 'Zico', goals: 500, goalsNote: 'mais de 500 gols só pelo Flamengo', worldCups: 0, ballonDor: 0, champions: 0, libertadores: 1 },
  { name: 'Neymar', goals: 400, goalsNote: 'mais de 400 gols', worldCups: 0, ballonDor: 0, champions: 1, libertadores: 1 },
  { name: 'Ronaldo Fenômeno', goals: 400, goalsNote: 'cerca de 400 gols', worldCups: 2, ballonDor: 2, champions: 0, libertadores: 0 },
  { name: 'Maradona', goals: 300, goalsNote: 'mais de 300 gols', worldCups: 1, ballonDor: 0, champions: 0, libertadores: 0 },
  { name: 'Rivaldo', goals: 300, goalsNote: 'cerca de 300 gols', worldCups: 1, ballonDor: 1, champions: 0, libertadores: 0 },
  { name: 'Ronaldinho', goals: 250, goalsNote: 'cerca de 250 gols', worldCups: 1, ballonDor: 1, champions: 1, libertadores: 1 },
  { name: 'Kaká', goals: 200, goalsNote: 'cerca de 200 gols', worldCups: 1, ballonDor: 1, champions: 1, libertadores: 0 },
]

const n = (v: number) => v.toLocaleString('pt-BR')

export function summarize(data: GameData, s: CareerState): CareerSummary {
  const idx = indexData(data)
  const seasons = s.seasons
  const trophies = seasons.flatMap((r) => r.trophies)

  // clubes na ordem em que apareceram
  const clubs = new Map<string, CareerSummary['clubs'][number]>()
  for (const r of seasons) {
    const c = clubs.get(r.clubId) ?? { clubId: r.clubId, seasons: 0, apps: 0, goals: 0, assists: 0, trophies: 0, loan: true }
    c.seasons++
    c.apps += r.stats.apps
    c.goals += r.stats.goals
    c.assists += r.stats.assists
    c.trophies += r.trophies.filter((t) => t.scope === 'club').length
    c.loan = c.loan && r.loan
    clubs.set(r.clubId, c)
  }

  const t = totalsOf(s)
  const isGK = s.identity.position === 'GOL' || seasons.some((r) => r.position === 'GOL')
  const totals: CareerSummary['totals'] = { apps: t.apps, goals: t.goals, assists: t.assists }
  if (isGK || t.cleanSheets > 0) totals.cleanSheets = t.cleanSheets

  // vitrine agrupada
  const famRank = (id: string) => {
    const f = idx.trophy.get(id)?.family
    return f ? FAMILY_ORDER.indexOf(f) : FAMILY_ORDER.length
  }
  const grouped = new Map<string, { trophyId: string; count: number; seasons: number[] }>()
  for (const tr of trophies) {
    const g = grouped.get(tr.trophyId) ?? { trophyId: tr.trophyId, count: 0, seasons: [] }
    g.count++
    g.seasons.push(tr.season)
    grouped.set(tr.trophyId, g)
  }
  const trophyGroups = [...grouped.values()].sort((a, b) => famRank(a.trophyId) - famRank(b.trophyId) || b.count - a.count || a.trophyId.localeCompare(b.trophyId))

  // prêmios (só vitórias; pódios da Bola de Ouro à parte)
  const awardMap = new Map<AwardId, { award: AwardId; count: number; years: number[] }>()
  const podiums: CareerSummary['ballonDorPodiums'] = []
  for (const r of seasons)
    for (const a of r.awards) {
      if (a.award === 'ballon_dor') podiums.push({ year: a.year, place: a.place })
      if (a.place !== 1) continue
      const g = awardMap.get(a.award) ?? { award: a.award, count: 0, years: [] }
      g.count++
      g.years.push(a.year)
      awardMap.set(a.award, g)
    }
  const awards = [...awardMap.values()].sort((a, b) => AWARD_ORDER.indexOf(a.award) - AWARD_ORDER.indexOf(b.award))

  // picos
  let peakOvr = START_OVR
  let peakOvrAge = 16
  for (const r of seasons) {
    if (r.ovrStart > peakOvr) (peakOvr = r.ovrStart), (peakOvrAge = r.age)
    if (r.ovrEnd > peakOvr) (peakOvr = r.ovrEnd), (peakOvrAge = r.age + 1)
  }
  if (s.ovr > peakOvr) (peakOvr = s.ovr), (peakOvrAge = s.age)
  const peakValue = Math.max(s.marketValue, ...seasons.map((r) => r.marketValue))

  const k = kinds(trophies)
  const wins = (a: AwardId) => awardMap.get(a)?.count ?? 0
  const legacyScore = legacy(peakOvr, k, wins, t, isGK)

  return {
    identity: s.identity,
    seasons: seasons.length,
    clubs: [...clubs.values()],
    totals,
    national: s.national,
    trophies: trophyGroups,
    awards,
    peakOvr,
    peakOvrAge,
    peakValue,
    ballonDorPodiums: podiums,
    legacyScore,
    headline: headline(data, s, k, wins, t, isGK, [...clubs.values()], peakOvr),
    comparisons: comparisons(k, wins, t),
  }
}

interface KindCounts {
  worldCup: number
  natCont: number
  cwc: number
  ucl: number
  lib: number
  primary: number
  secondary: number
  leagueTop: number
  leagueLower: number
  cup: number
  minor: number
  all: number
}

function kinds(tr: TrophyWin[]): KindCounts {
  const c: KindCounts = { worldCup: 0, natCont: 0, cwc: 0, ucl: 0, lib: 0, primary: 0, secondary: 0, leagueTop: 0, leagueLower: 0, cup: 0, minor: 0, all: tr.length }
  for (const t of tr) {
    if (t.minor) {
      c.minor++
      continue
    }
    switch (t.kind) {
      case 'world_cup':
        c.worldCup++
        break
      case 'national_continental':
        c.natCont++
        break
      case 'club_world_cup':
        c.cwc++
        break
      case 'continental_primary':
        c.primary++
        if (t.confed === 'UEFA') c.ucl++
        if (t.confed === 'CONMEBOL') c.lib++
        break
      case 'continental_secondary':
      case 'continental_tertiary':
        c.secondary++
        break
      case 'league':
        if ((t.tier ?? 1) === 1) c.leagueTop++
        else c.leagueLower++
        break
      case 'domestic_cup':
        c.cup++
        break
      default:
        c.minor++
    }
  }
  return c
}

function legacy(peak: number, k: KindCounts, wins: (a: AwardId) => number, t: ReturnType<typeof totalsOf>, isGK: boolean): number {
  let raw = Math.max(0, peak - 65) * 1.2
  raw += k.worldCup * 10 + k.natCont * 5 + k.cwc * 3 + k.primary * 6 + k.secondary * 2 + k.leagueTop * 2.5 + k.leagueLower * 1 + k.cup * 1 + k.minor * 0.3
  raw += wins('ballon_dor') * 9 + wins('the_best') * 4 + wins('golden_boot') * 3 + wins('golden_glove') * 3 + wins('wc_golden_ball') * 3
  raw += wins('league_top_scorer') + wins('league_best_player') + wins('kopa') + wins('puskas') * 0.5
  raw += t.goals / 25 + t.apps / 100 + (isGK ? t.cleanSheets / 20 : 0)
  return Math.max(0, Math.min(100, Math.round(100 * (1 - Math.exp(-raw / 70)))))
}

function headline(
  data: GameData,
  s: CareerState,
  k: KindCounts,
  wins: (a: AwardId) => number,
  t: ReturnType<typeof totalsOf>,
  isGK: boolean,
  clubs: CareerSummary['clubs'],
  peak: number,
): string {
  const idx = indexData(data)
  const bdo = wins('ballon_dor')
  if (!s.seasons.length) return 'Uma história por escrever'
  if (bdo >= 5) return 'O melhor de todos os tempos'
  if (k.worldCup >= 1 && bdo >= 1) return 'Campeão do mundo e melhor do planeta'
  if (bdo >= 2) return 'Dono da Bola de Ouro'
  if (k.lib >= 3) return 'Rei da Libertadores'
  if (k.ucl >= 3) return 'Senhor da Champions'
  if (k.worldCup >= 1) return s.identity.nationality === 'BRA' ? 'Herói do hexa' : 'Campeão do mundo'
  if (bdo === 1) return 'Bola de Ouro'
  if (t.goals >= 500 || wins('golden_boot') >= 2 || wins('league_top_scorer') >= 3) return 'Artilheiro implacável'
  if (isGK && t.cleanSheets >= 200) return 'Paredão'
  const top = clubs.slice().sort((a, b) => b.seasons - a.seasons || b.trophies - a.trophies)[0]
  const club = top ? idx.club.get(top.clubId) : undefined
  const name = club?.shortName ?? club?.name ?? top?.clubId
  if (top && top.seasons >= 8 && top.trophies >= 3) return `Lenda ${withArticle('de', club)} ${name}`
  if (new Set(s.seasons.map((r) => r.country)).size >= 5) return 'Cidadão do mundo'
  if (top && top.seasons >= 6) return `Ídolo ${withArticle('de', club)} ${name}`
  if (t.assists >= 150) return 'Garçom de primeira'
  if (peak < 70) return 'Guerreiro dos gramados'
  return 'Operário da bola'
}

function comparisons(k: KindCounts, wins: (a: AwardId) => number, t: ReturnType<typeof totalsOf>): string[] {
  const out: string[] = []
  const byGoals = LEGENDS.slice().sort((a, b) => b.goals - a.goals)
  const beaten = byGoals.find((l) => t.goals > l.goals)
  if (beaten) out.push(`Seus ${n(t.goals)} gols superam ${beaten.name} (${beaten.goalsNote}).`)
  const above = byGoals.filter((l) => l.goals >= t.goals).pop()
  if (above && t.goals >= 100) out.push(`Faltaram ${n(above.goals - t.goals + 1)} gols para passar ${above.name} (${above.goalsNote}).`)

  const bdo = wins('ballon_dor')
  if (bdo > 8) out.push(`${bdo} Bolas de Ouro: mais que as 8 de Messi, o recordista.`)
  else if (bdo === 8) out.push('8 Bolas de Ouro: igualou Messi, o recordista.')
  else if (bdo > 5) out.push(`${bdo} Bolas de Ouro: mais que as 5 de Cristiano Ronaldo.`)
  else if (bdo === 5) out.push('5 Bolas de Ouro, como Cristiano Ronaldo.')
  else if (bdo >= 3) out.push(`${bdo} Bolas de Ouro: mais que as 2 de Ronaldo Fenômeno.`)
  else if (bdo === 2) out.push('2 Bolas de Ouro, como Ronaldo Fenômeno.')
  else if (bdo === 1) out.push('Bola de Ouro no currículo, como Kaká, Rivaldo e Ronaldinho.')

  if (k.worldCup >= 3) out.push(`${k.worldCup} Copas do Mundo: ${k.worldCup > 3 ? 'mais que' : 'igualou'} Pelé, o único tricampeão.`)
  else if (k.worldCup === 2) out.push('Bicampeão do mundo, como Ronaldo Fenômeno.')
  else if (k.worldCup === 1) out.push('Campeão do mundo, como Maradona, Romário e Messi — coisa que Zico e Cristiano Ronaldo nunca conseguiram.')

  if (k.ucl >= 5) out.push(`${k.ucl} Champions: ${k.ucl > 5 ? 'mais que' : 'tantas quanto'} Cristiano Ronaldo (5).`)
  else if (k.ucl === 4) out.push('4 Champions, como Messi.')
  if (k.lib >= 3) out.push(`${k.lib} Libertadores: mais que Pelé (2), Zico, Neymar e Ronaldinho (1 cada).`)
  else if (k.lib === 2) out.push('2 Libertadores, como Pelé.')

  if (k.all >= 45) out.push(`${k.all} títulos: nível Messi, o jogador mais vitorioso da história (mais de 40).`)
  return out.slice(0, 5)
}
