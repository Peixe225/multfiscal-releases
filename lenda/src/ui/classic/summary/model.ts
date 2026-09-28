/**
 * Summary view-model: everything the "Resumo da carreira" screen and the share card show, derived
 * from CareerSummary (engine.summarize) + the season records (+ the world when it is available).
 */
import type { AwardId, CareerState, CareerSummary, SeasonRecord, TrophyFamily, WorldState } from '@/engine/types'
import { getClub, getCompetition, getCountry, getLeague, getTrophy } from '@/store/data'
import { formatSeason } from '@/ui/primitives'

export type SummaryCareer = Omit<CareerState, 'world'> & { world?: WorldState }

export interface Spell {
  clubId: string
  from: number // season
  to: number
  fromAge: number
  toAge: number
  loan: boolean
  seasons: number
}

export interface ClubRow {
  clubId: string
  leagueId?: string
  periods: string
  apps: number
  goals: number
  assists: number
  titles: number
  loan: boolean
  seasons: number
  trophies: { trophyId: string; count: number }[]
}

export interface HonorChip {
  label: string
  win?: boolean
}

export interface Honor {
  key: string
  corner: string
  trophyId: string
  title: string
  count: number
  chips: HonorChip[]
  foot?: { k: string; v: string; me?: string }
  tone: 'gold' | 'green' | 'amber' | 'blue'
}

const FAMILY_ORDER: TrophyFamily[] = ['world_cup', 'award', 'continental_primary', 'club_world_cup', 'national_continental', 'league', 'continental_secondary', 'continental_tertiary', 'domestic_cup']
const GOLD_FAMILIES = new Set<TrophyFamily>(['world_cup', 'continental_primary', 'club_world_cup'])

export const AWARD_NAME: Record<AwardId, string> = {
  ballon_dor: 'Bola de Ouro',
  golden_boot: 'Chuteira de Ouro',
  golden_glove: 'Luva de Ouro',
  the_best: 'The Best',
  kopa: 'Troféu Kopa',
  league_top_scorer: 'Artilheiro da liga',
  league_best_player: 'Craque da liga',
  wc_golden_ball: 'Bola de Ouro da Copa',
  wc_golden_boot: 'Chuteira da Copa',
  puskas: 'Prêmio Puskás',
  team_of_the_year: 'Seleção do ano',
}

const AWARD_ORDER: AwardId[] = ['ballon_dor', 'the_best', 'golden_boot', 'wc_golden_ball', 'wc_golden_boot', 'kopa', 'golden_glove', 'puskas', 'league_best_player', 'league_top_scorer', 'team_of_the_year']

export const awardTrophy = (a: AwardId) => a.replace(/_/g, '-')

export function spellsOf(seasons: SeasonRecord[]): Spell[] {
  const out: Spell[] = []
  for (const r of seasons) {
    const last = out[out.length - 1]
    if (last && last.clubId === r.clubId && last.loan === r.loan && last.to === r.season - 1) {
      last.to = r.season
      last.toAge = r.age
      last.seasons++
    } else out.push({ clubId: r.clubId, from: r.season, to: r.season, fromAge: r.age, toAge: r.age, loan: r.loan, seasons: 1 })
  }
  return out
}

const yy = (s: number) => String(s).slice(2)

function periodLabel(spells: Spell[], seasons: SeasonRecord[]): string {
  return spells
    .map((s) => {
      const lg = getLeague(seasons.find((r) => r.season === s.to && r.clubId === s.clubId)?.leagueId)
      const a = formatSeason(s.from, lg?.calendar).split('/')[0]
      const b = s.to === s.from ? '' : `–${yy(s.to)}`
      return `${a}${b}${s.loan ? ' · emp.' : ''}`
    })
    .join(' · ')
}

export function clubRows(summary: CareerSummary, seasons: SeasonRecord[]): ClubRow[] {
  const spells = spellsOf(seasons)
  return summary.clubs
    .map((c) => {
      const mine = spells.filter((s) => s.clubId === c.clubId)
      const recs = seasons.filter((r) => r.clubId === c.clubId)
      const trophies = new Map<string, number>()
      for (const r of recs) for (const t of r.trophies) if (t.scope === 'club') trophies.set(t.trophyId, (trophies.get(t.trophyId) ?? 0) + 1)
      return {
        clubId: c.clubId,
        leagueId: recs[recs.length - 1]?.leagueId,
        periods: periodLabel(mine, seasons),
        apps: c.apps,
        goals: c.goals,
        assists: c.assists,
        titles: c.trophies,
        loan: c.loan,
        seasons: c.seasons,
        trophies: sortTrophies([...trophies.entries()].map(([trophyId, count]) => ({ trophyId, count }))),
      }
    })
    .sort((a, b) => b.titles - a.titles || b.apps - a.apps)
}

export function trophyRank(id: string): number {
  const t = getTrophy(id)
  const f = t?.family ?? 'domestic_cup'
  let r = FAMILY_ORDER.indexOf(f) * 10
  if (id === 'ballon-dor') r -= 5
  if (t?.metal === 'gold') r -= 1
  return r
}

export function sortTrophies<T extends { trophyId: string; count: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => trophyRank(a.trophyId) - trophyRank(b.trophyId) || b.count - a.count)
}

export const isGoldTrophy = (id: string) => {
  const t = getTrophy(id)
  return !!t && (GOLD_FAMILIES.has(t.family) || id === 'ballon-dor' || id === 'golden-boot')
}

export interface Cabinet {
  items: { trophyId: string; count: number; name: string; seasons: number[]; award?: AwardId }[]
  titles: number
  prizes: number
}

/** Trophy room: collective titles + individual prizes (wins only). */
export function cabinet(summary: CareerSummary): Cabinet {
  const titles = summary.trophies.map((t) => ({ trophyId: t.trophyId, count: t.count, name: getTrophy(t.trophyId)?.name ?? humanize(t.trophyId), seasons: t.seasons }))
  const prizes = summary.awards
    .filter((a) => a.count > 0)
    .map((a) => ({ trophyId: awardTrophy(a.award), count: a.count, name: AWARD_NAME[a.award], seasons: a.years, award: a.award }))
  const items = sortTrophies([...titles, ...prizes])
  return { items, titles: titles.reduce((s, t) => s + t.count, 0), prizes: prizes.reduce((s, t) => s + t.count, 0) }
}

export function awardsSorted(summary: CareerSummary) {
  return [...summary.awards].sort((a, b) => AWARD_ORDER.indexOf(a.award) - AWARD_ORDER.indexOf(b.award))
}

// ───────────────────────── honors (3 hero cards) ─────────────────────────

export function honors(summary: CareerSummary, career: SummaryCareer): Honor[] {
  const out: Honor[] = []
  const seasons = career.seasons
  const world = career.world

  // 1. individual — Bola de Ouro (or the best individual prize)
  const bdo = summary.awards.find((a) => a.award === 'ballon_dor')
  const podiums = [...summary.ballonDorPodiums].sort((a, b) => a.year - b.year)
  if (bdo?.count || podiums.length) {
    const chips: HonorChip[] = podiums.map((p) => ({ label: p.place === 1 ? String(p.year) : `${p.place}º ${p.year}`, win: p.place === 1 }))
    const best = podiums.find((p) => p.place === 1) ?? podiums[0]
    out.push({ key: 'bdo', corner: 'Individual', trophyId: 'ballon-dor', title: 'Bola de Ouro', count: bdo?.count ?? 0, chips, foot: best ? ballonFoot(world, best.year) : undefined, tone: 'gold' })
  } else {
    const alt = awardsSorted(summary).find((a) => a.count > 0)
    const bestPlace = bestBallonPlace(career)
    if (alt) {
      out.push({ key: 'ind', corner: 'Individual', trophyId: awardTrophy(alt.award), title: AWARD_NAME[alt.award], count: alt.count, chips: alt.years.map((y) => ({ label: String(y), win: true })), foot: bestPlace ? { k: 'Bola de Ouro', v: `melhor: ${bestPlace.place}º em ${bestPlace.year}` } : undefined, tone: 'gold' })
    } else {
      out.push({ key: 'ind', corner: 'Individual', trophyId: 'ballon-dor', title: 'Bola de Ouro', count: 0, chips: bestPlace ? [{ label: `${bestPlace.place}º ${bestPlace.year}` }] : [{ label: 'Sem indicações' }], foot: undefined, tone: 'gold' })
    }
  }

  // 2. national team — World Cup (or the continental tournament)
  const nat = summary.national
  const wc = nat.tournaments.filter((t) => t.competitionId === 'fifa.world').sort((a, b) => a.year - b.year)
  const wcWins = nat.trophies.filter((t) => t.competitionId === 'fifa.world').length
  const cont = nat.tournaments.filter((t) => t.competitionId !== 'fifa.world').sort((a, b) => a.year - b.year)
  if (wc.length || wcWins) {
    const final = wc.find((t) => t.reached === 'Campeão') ?? wc[wc.length - 1]
    out.push({
      key: 'wc',
      corner: 'Seleção',
      trophyId: 'world-cup',
      title: 'Copa do Mundo',
      count: wcWins,
      chips: wc.map((t) => ({ label: t.reached === 'Campeão' ? String(t.year) : `${reachShort(t.reached)} ${t.year}`, win: t.reached === 'Campeão' })),
      foot: final ? { k: final.reached === 'Campeão' ? 'Campeão' : reachShort(final.reached), v: `${final.year} · ${final.apps} jogos · ${final.goals} ${final.goals === 1 ? 'gol' : 'gols'}` } : undefined,
      tone: 'green',
    })
  } else if (cont.length) {
    const id = cont[0].competitionId
    const comp = getCompetition(id)
    const wins = nat.trophies.filter((t) => t.competitionId === id).length
    out.push({
      key: 'nat',
      corner: 'Seleção',
      trophyId: comp?.trophyId ?? 'copa-america',
      title: comp?.name ?? 'Seleção',
      count: wins,
      chips: cont.filter((t) => t.competitionId === id).map((t) => ({ label: t.reached === 'Campeão' ? String(t.year) : `${reachShort(t.reached)} ${t.year}`, win: t.reached === 'Campeão' })),
      foot: { k: 'Seleção', v: `${nat.apps} jogos · ${nat.goals} gols` },
      tone: 'green',
    })
  } else {
    const country = getCountry(career.identity.nationality)
    out.push({
      key: 'nat',
      corner: 'Seleção',
      trophyId: 'world-cup',
      title: nat.apps ? (country?.name ?? 'Seleção') : 'Seleção',
      count: 0,
      chips: nat.apps ? [{ label: `${nat.apps} jogos` }, { label: `${nat.goals} gols` }] : [{ label: 'Nunca convocado' }],
      foot: nat.firstCallUp ? { k: 'Estreia', v: String(nat.firstCallUp) } : undefined,
      tone: 'green',
    })
  }

  // 3. goals — Chuteira de Ouro / artilharia da liga / best season
  const boot = summary.awards.find((a) => a.award === 'golden_boot' && a.count > 0)
  const scorer = summary.awards.find((a) => a.award === 'league_top_scorer' && a.count > 0)
  const bestSeason = [...seasons].sort((a, b) => b.stats.goals - a.stats.goals)[0]
  const rec = bestSeason ? { k: 'Recorde', v: `${bestSeason.stats.goals} gols`, me: `${getLeague(bestSeason.leagueId)?.shortName ?? ''} ${formatSeason(bestSeason.season, getLeague(bestSeason.leagueId)?.calendar)}` } : undefined
  const gk = career.identity.position === 'GOL'
  if (gk) {
    const glove = summary.awards.find((a) => a.award === 'golden_glove' && a.count > 0)
    out.push({ key: 'gk', corner: 'Gol', trophyId: 'golden-glove', title: 'Luva de Ouro', count: glove?.count ?? 0, chips: (glove?.years ?? []).map((y) => ({ label: String(y), win: true })), foot: { k: 'Sem sofrer gol', v: `${summary.totals.cleanSheets ?? 0} jogos` }, tone: 'blue' })
  } else if (boot) {
    out.push({ key: 'boot', corner: 'Artilharia', trophyId: 'golden-boot', title: 'Chuteira de Ouro', count: boot.count, chips: boot.years.map((y) => ({ label: String(y), win: true })), foot: rec, tone: 'amber' })
  } else {
    out.push({
      key: 'scorer',
      corner: 'Artilharia',
      trophyId: 'golden-boot',
      title: scorer ? 'Artilheiro da liga' : 'Gols na carreira',
      count: scorer?.count ?? 0,
      chips: scorer ? scorer.years.map((y) => ({ label: String(y), win: true })) : [{ label: `${summary.totals.goals} gols` }, { label: `${(summary.totals.goals / Math.max(1, summary.totals.apps)).toFixed(2).replace('.', ',')} por jogo` }],
      foot: rec,
      tone: 'amber',
    })
  }
  return out
}

function reachShort(r: string): string {
  if (r === 'Final') return 'Vice'
  if (r.startsWith('Semifinal')) return 'Semi'
  if (r.startsWith('Quartas')) return 'Quartas'
  if (r.startsWith('Oitavas')) return 'Oitavas'
  if (/grupo/i.test(r)) return 'Grupos'
  return r
}

function ballonFoot(world: WorldState | undefined, year: number): Honor['foot'] {
  if (!world) return undefined
  for (const s of Object.values(world.seasons)) {
    const b = s.awards.find((a) => a.award === 'ballon_dor' && a.year === year)
    if (!b) continue
    const top = b.ranking.slice(0, 3)
    const v = top.map((e, i) => `${i + 1}º ${e.isUser ? 'Você' : shortName(e.name)}`).join(' · ')
    return { k: String(year), v, me: top.find((e) => e.isUser) ? 'Você' : undefined }
  }
  return undefined
}

function shortName(name: string): string {
  const p = name.split(' ')
  return p.length > 1 && name.length > 12 ? `${p[0][0]}. ${p.slice(1).join(' ')}` : name
}

export function bestBallonPlace(career: SummaryCareer): { year: number; place: number } | null {
  let best: { year: number; place: number } | null = null
  for (const s of Object.values(career.world?.seasons ?? {})) {
    const b = s.awards.find((a) => a.award === 'ballon_dor')
    const i = b ? b.ranking.findIndex((e) => e.isUser) : -1
    if (b && i >= 0 && (!best || i + 1 < best.place)) best = { year: b.year, place: i + 1 }
  }
  for (const r of career.seasons) for (const a of r.awards) if (a.award === 'ballon_dor' && (!best || a.place < best.place)) best = { year: a.year, place: a.place }
  return best
}

// ───────────────────────── chart data ─────────────────────────

export interface ChartPoint {
  age: number
  season: number
  ovr: number
  clubId: string
  loan: boolean
  goals: number
  apps: number
  ballon: number | null // place
  worldCup: boolean
  trophies: string[]
}

export function chartPoints(seasons: SeasonRecord[]): ChartPoint[] {
  return seasons.map((r) => ({
    age: r.age,
    season: r.season,
    ovr: r.ovrEnd,
    clubId: r.clubId,
    loan: r.loan,
    goals: r.stats.goals,
    apps: r.stats.apps,
    ballon: r.awards.find((a) => a.award === 'ballon_dor')?.place ?? null,
    worldCup: r.trophies.some((t) => t.competitionId === 'fifa.world'),
    trophies: r.trophies.map((t) => t.trophyId),
  }))
}

// ───────────────────────── misc ─────────────────────────

export function careerSpan(seasons: SeasonRecord[]): { from: number; to: number; label: string } {
  const a = seasons[0]?.season ?? 2026
  const b = seasons[seasons.length - 1]?.season ?? a
  return { from: a, to: b, label: `${a} – ${b}` }
}

export function mainClub(summary: CareerSummary): string | undefined {
  return [...summary.clubs].sort((a, b) => b.apps + b.trophies * 20 - (a.apps + a.trophies * 20))[0]?.clubId
}

export function clubName(id: string | undefined, short = false): string {
  const c = getClub(id)
  return c ? (short ? c.shortName : c.name) : (id ?? '')
}

export function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'jogador'
  )
}

/** "mundial-de-clubes" → "Mundial de clubes" (ids missing from the catalogue). */
export function humanize(id: string): string {
  const s = id.replace(/[-_.]+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : id
}
