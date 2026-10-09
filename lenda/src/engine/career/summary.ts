/**
 * Resumo final da carreira: clubes, totais, vitrine agrupada, prêmios, picos, pódios da Bola de
 * Ouro, nota de legado (0–100), título honorífico e comparações com lendas reais.
 */
import type { AwardId, CareerState, CareerSummary, GameData, TrophyFamily, TrophyWin } from '../types'
import { START_OVR } from './constants'
import { totalsOf } from './season'
import { indexData, withArticle } from './util'
import { HISTORIC_RECORDS, REAL_LEGENDS, type Legend } from '../../data/catalog/legends'

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

/** Lendas usadas nas barras de gols do Resumo (os números vêm da base curada do Hall das Lendas). */
const SUMMARY_LEGEND_IDS = ['pele', 'romario', 'cristiano-ronaldo', 'messi', 'zico', 'neymar', 'ronaldo', 'maradona', 'rivaldo', 'ronaldinho', 'kaka']

export interface SummaryLegend {
  id: string
  name: string
  /** Gols oficiais (clube + seleção principal). */
  goals: number
  /** Valor com fontes divergentes/estimado: a UI mostra "≈". */
  approx: boolean
  goalsNote: string
  worldCups: number
  ballonDor: number
  champions: number
  libertadores: number
}

const byId = new Map(REAL_LEGENDS.map((l) => [l.id, l]))
const approxGoals = (l: Legend) => !!(l.active || l.uncertain?.includes('goals'))

/** Números de carreira de lendas reais — derivados de src/data/catalog/legends.ts (gols oficiais). */
export const LEGENDS: SummaryLegend[] = SUMMARY_LEGEND_IDS.map((id) => byId.get(id))
  .filter((l): l is Legend => !!l)
  .map((l) => ({
    id: l.id,
    name: l.name,
    goals: l.goals,
    approx: approxGoals(l),
    goalsNote: `${approxGoals(l) ? '≈' : ''}${l.goals.toLocaleString('pt-BR')} gols oficiais`,
    worldCups: l.worldCups,
    ballonDor: l.ballonDor,
    champions: l.ucl,
    libertadores: l.libertadores,
  }))

const n = (v: number) => v.toLocaleString('pt-BR')

export function summarize(data: GameData, s: CareerState): CareerSummary {
  const idx = indexData(data)
  const seasons = s.seasons
  const trophies = seasons.flatMap((r) => r.trophies)

  // clubes na ordem em que apareceram (temporada dividida entre clubes no imersivo: cada parte no seu
  // clube, e cada título no clube que o conquistou)
  const clubs = new Map<string, CareerSummary['clubs'][number]>()
  for (const r of seasons) {
    const parts = r.spans?.length ? r.spans : [{ clubId: r.clubId, loan: r.loan, apps: r.stats.apps, goals: r.stats.goals, assists: r.stats.assists }]
    for (const p of parts) {
      const c = clubs.get(p.clubId) ?? { clubId: p.clubId, seasons: 0, apps: 0, goals: 0, assists: 0, trophies: 0, loan: true }
      c.seasons++
      c.apps += p.apps
      c.goals += p.goals
      c.assists += p.assists
      c.trophies += r.trophies.filter((t) => t.scope === 'club' && (!r.spans?.length || t.teamId === p.clubId)).length
      c.loan = c.loan && !!p.loan
      clubs.set(p.clubId, c)
    }
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
  // superlativo só acima do recorde real (8 de Messi): o Hall das Lendas é quem diz quem é o nº 1
  if (bdo >= 9) return 'O melhor de todos os tempos'
  if (bdo >= 5) return 'Colecionador de Bolas de Ouro'
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

/** "Messi (8)", "Cruyff, Platini e Van Basten (3)". */
function namesOf(ls: Legend[]): string {
  const names = ls.map((l) => l.name)
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}

/**
 * Frase de contagem contra a base curada: bate/iguala o recorde real (HISTORIC_RECORDS) ou passa a
 * lenda com o maior valor abaixo do seu. `get` lê o campo da lenda; `label(v)` escreve "3 Bolas de Ouro".
 */
function countLine(v: number, get: (l: Legend) => number, label: (v: number) => string, metric: string): string | null {
  if (v <= 0) return null
  const rec = HISTORIC_RECORDS.find((r) => r.metric === metric)
  if (rec && v > rec.value) return `${label(v)}: mais que ${rec.holder} (${rec.value}), o recorde.`
  if (rec && v === rec.value) return `${label(v)}: igualou ${rec.holder}, o recorde.`
  const pool = REAL_LEGENDS.filter((l) => get(l) > 0)
  const at = (x: number) => pool.filter((l) => get(l) === x).slice(0, 3)
  const below = Math.max(0, ...pool.map(get).filter((x) => x < v))
  if (below > 0) return `${label(v)}: mais que ${namesOf(at(below))} (${below}).`
  const same = at(v)
  return same.length ? `${label(v)}, como ${namesOf(same)}.` : null
}

const plural = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`

function comparisons(k: KindCounts, wins: (a: AwardId) => number, t: ReturnType<typeof totalsOf>): string[] {
  const out: string[] = []
  // gols oficiais (clube + seleção) contra a base inteira do Hall, só de quem vive de gols
  const scorers = REAL_LEGENDS.filter((l) => l.position !== 'GOL' && l.goals >= 150).sort((a, b) => b.goals - a.goals)
  const note = (l: Legend) => `${approxGoals(l) ? '≈' : ''}${n(l.goals)} gols oficiais`
  const beaten = scorers.find((l) => t.goals > l.goals)
  if (beaten) out.push(`Seus ${n(t.goals)} gols superam ${beaten.name} (${note(beaten)}).`)
  const above = scorers.filter((l) => l.goals >= t.goals).pop()
  if (above && t.goals >= 100) out.push(`${above.goals - t.goals + 1 === 1 ? 'Faltou 1 gol' : `Faltaram ${n(above.goals - t.goals + 1)} gols`} para passar ${above.name} (${note(above)}).`)

  const bdo = countLine(wins('ballon_dor'), (l) => l.ballonDor, (v) => plural(v, 'Bola de Ouro', 'Bolas de Ouro'), 'ballonDor')
  if (bdo) out.push(bdo)
  const wc = countLine(k.worldCup, (l) => l.worldCups, (v) => plural(v, 'Copa do Mundo', 'Copas do Mundo'), 'worldCups')
  if (wc) out.push(k.worldCup === 1 ? 'Campeão do mundo, como Pelé, Maradona, Romário e Messi — coisa que Zico e Cristiano Ronaldo nunca conseguiram.' : wc)
  if (k.ucl >= 2) {
    const line = countLine(k.ucl, (l) => l.ucl, (v) => `${v} Champions`, 'ucl')
    if (line) out.push(line)
  }
  if (k.lib >= 2) {
    const line = countLine(k.lib, (l) => l.libertadores, (v) => `${v} Libertadores`, 'libertadores')
    if (line) out.push(line)
  }
  const titles = HISTORIC_RECORDS.find((r) => r.metric === 'titles')
  if (titles && k.all >= titles.value - 5) out.push(`${k.all} títulos: nível ${titles.holder}, o jogador mais vitorioso da história (${titles.value}).`)
  return out.slice(0, 5)
}
