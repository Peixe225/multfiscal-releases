/**
 * Tabs model — pure helpers shared by Temporada · Prêmios · Mundo (and the summary screen).
 *
 * Everything reads the career state from the store; the world results live in
 * `state.world.seasons[season]` (compacted after 4 seasons: see engine/world/compact.ts), so every
 * helper tolerates missing groups, early knockout stages and short rankings.
 */
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import type {
  AwardId,
  AwardResult,
  CareerState,
  Competition,
  CompetitionKind,
  CupResult,
  GameData,
  KnockoutStage,
  League,
  LeagueSeasonResult,
  SeasonRecord,
  SeasonWorldResult,
} from '@/engine/types'
import { useCareer } from '@/store/career'
import { getClub, getCompetition, getCountry, getLeague } from '@/store/data'
import { formatSeason } from '@/ui/primitives'

// ───────────────────────── career state for the tabs ─────────────────────────

/**
 * The state the tabs show. While a reveal is pending the store already holds the new seasons —
 * show the state *before* the choice so the tabs never spoil the animation.
 */
export function useTabState(): CareerState | null {
  return useCareer((s) => (s.reveal && s.previous ? s.previous : s.state))
}

export interface SeasonEntry {
  season: number
  record: SeasonRecord
  world: SeasonWorldResult | undefined
  /** "2035" or "2035/36" following the player's league calendar that season. */
  label: string
}

export function seasonEntries(state: CareerState | null): SeasonEntry[] {
  if (!state) return []
  const seen = new Map<number, SeasonEntry>()
  for (const r of state.seasons) {
    const lg = getLeague(r.leagueId)
    seen.set(r.season, { season: r.season, record: r, world: state.world?.seasons?.[r.season], label: formatSeason(r.season, lg?.calendar) })
  }
  return [...seen.values()].sort((a, b) => a.season - b.season)
}

// ───────────────────────── selected season (shared by the three tabs) ─────────────────────────

interface TabSeasonStore {
  careerId: string | null
  season: number | null
  /** true once the user picked an older season by hand (until the next simulated season arrives). */
  pinned: boolean
  /** Latest simulated season when the selection was (re)set: a newer one drops the pin. */
  latest: number | null
  select(season: number, pinned?: boolean): void
  reset(careerId: string | null, season: number | null): void
}

export const useTabSeason = create<TabSeasonStore>()((set) => ({
  careerId: null,
  season: null,
  pinned: false,
  latest: null,
  select: (season, pinned = true) => set({ season, pinned }),
  reset: (careerId, season) => set({ careerId, season, latest: season, pinned: false }),
}))

/** Season the user pinned by hand, or null while the tabs follow the latest one (`latest` = newest shown). */
export function pinnedSeason(s: Pick<TabSeasonStore, 'pinned' | 'season' | 'latest'>, latest: number | null | undefined): number | null {
  return s.pinned && s.season != null && s.latest === latest ? s.season : null
}

/** Current season entry + setter; follows the latest season, or the one the user pinned until a new season is simulated. */
export function useSelectedSeason(state: CareerState | null) {
  const entries = useMemo(() => seasonEntries(state), [state])
  const { careerId, season, pinned, latest: seen, select, reset } = useTabSeason()
  const latest = entries.length ? entries[entries.length - 1].season : null
  const id = state?.id ?? null
  useEffect(() => {
    if (careerId !== id || seen !== latest) reset(id, latest)
    else if (!pinned && season !== latest) reset(id, latest)
    else if (season != null && !entries.some((e) => e.season === season)) reset(id, latest)
  }, [careerId, id, latest, seen, pinned, season, entries, reset])
  // a reset is due (other career / new season simulated): show the latest right away, not the stale pick
  const shown = careerId !== id || seen !== latest ? latest : season
  const current = entries.find((e) => e.season === shown) ?? entries[entries.length - 1] ?? null
  return { entries, current, select }
}

// ───────────────────────── competitions ─────────────────────────

const SHORT: Record<string, string> = {
  'conmebol.libertadores': 'Libertadores',
  'conmebol.sudamericana': 'Sul-Americana',
  'conmebol.recopa': 'Recopa',
  'uefa.champions': 'Champions League',
  'uefa.europa': 'Liga Europa',
  'uefa.europa.conf': 'Conference League',
  'uefa.super_cup': 'Supercopa da UEFA',
  'concacaf.champions': 'Concachampions',
  'afc.champions': 'Champions da AFC',
  'afc.cup': 'AFC Champions 2',
  'caf.champions': 'Champions da CAF',
  'caf.confed': 'Copa da CAF',
  'fifa.cwc': 'Mundial de Clubes',
  'fifa.intercontinental_cup': 'Intercontinental',
  'fifa.world': 'Copa do Mundo',
  'conmebol.america': 'Copa América',
  'uefa.euro': 'Eurocopa',
  'concacaf.gold': 'Copa Ouro',
  'caf.nations': 'Copa Africana',
  'afc.asian.cup': 'Copa da Ásia',
  'ofc.nations': 'Copa da OFC',
  'bra.copa_do_brazil': 'Copa do Brasil',
}

export function compName(id: string, short = false): string {
  if (short && SHORT[id]) return SHORT[id]
  const c = getCompetition(id)
  if (c) return short ? c.name.replace(/^Campeonato /, '') : c.name
  const lg = getLeague(id)
  if (lg) return short ? lg.shortName : lg.name
  return SHORT[id] ?? id
}

/** Importance order for lists of champions (lower = first). */
export function compRank(c: Pick<Competition, 'id' | 'kind'> | undefined, league?: League): number {
  if (!c && league) return 40 + league.tier * 10 + (1 - league.coefficient) * 5
  if (!c) return 99
  const base: Record<CompetitionKind, number> = {
    world_cup: 0,
    national_continental: 2,
    club_world_cup: 4,
    continental_primary: 6,
    continental_secondary: 10,
    continental_tertiary: 14,
    league: 40,
    domestic_cup: 70,
    award: 99,
  }
  let r = base[c.kind] ?? 90
  if (c.id.startsWith('uefa.')) r -= 0.6
  else if (c.id.startsWith('conmebol.')) r -= 0.5
  if (c.id === 'fifa.intercontinental_cup' || c.id.endsWith('super_cup') || c.id.endsWith('recopa')) r += 3
  if (c.id.startsWith('bra.camp.')) r += 10
  return r
}

export const isNationalComp = (id: string) => {
  const k = getCompetition(id)?.kind
  return k === 'world_cup' || k === 'national_continental'
}

// ───────────────────────── standings zones ─────────────────────────

export type ZoneKind = 'primary' | 'pre' | 'secondary' | 'tertiary' | 'promotion' | 'playoff' | 'relegation' | 'releg_playoff'

export interface Zone {
  kind: ZoneKind
  label: string
  /** 1-based inclusive positions. */
  from: number
  to: number
}

export const ZONE_COLOR: Record<ZoneKind, string> = {
  primary: 'var(--nx-zone-libertadores, #3ee6a4)',
  pre: 'var(--nx-zone-pre, #7fd9ff)',
  secondary: 'var(--nx-zone-sula, #6f8cff)',
  tertiary: '#b98cff',
  promotion: 'var(--nx-zone-libertadores, #3ee6a4)',
  playoff: 'var(--warning, #ffc857)',
  relegation: 'var(--nx-zone-z4, #ff5e78)',
  releg_playoff: '#ff9a6b',
}

export function leagueZones(data: GameData | null, league: League | undefined, teams: number): Zone[] {
  if (!league || teams < 2) return []
  const zones: Zone[] = []
  const confed = data?.confederations?.[league.confed]
  let pos = 1
  if (league.tier === 1 || !league.upperLeagueId) {
    const [p, s] = league.continentalSlots ?? [0, 0]
    const t = league.continentalTertiarySlots ?? 0
    const primary = confed?.primary ? compName(confed.primary, true) : 'Continental'
    if (p > 0) {
      // Brasileirão-style: the last two primary slots go through the qualifying rounds
      const pre = league.confed === 'CONMEBOL' && p >= 6 ? 2 : 0
      zones.push({ kind: 'primary', label: primary, from: pos, to: pos + p - 1 - pre })
      if (pre) zones.push({ kind: 'pre', label: `Pré-${primary}`, from: pos + p - pre, to: pos + p - 1 })
      pos += p
    }
    if (s > 0 && confed?.secondary) {
      zones.push({ kind: 'secondary', label: compName(confed.secondary, true), from: pos, to: Math.min(teams, pos + s - 1) })
      pos += s
    }
    if (t > 0 && confed?.tertiary) {
      zones.push({ kind: 'tertiary', label: compName(confed.tertiary, true), from: pos, to: Math.min(teams, pos + t - 1) })
      pos += t
    }
  } else if (league.promotion > 0) {
    const po = league.promotionPlayoff
    const direct = Math.max(0, league.promotion - (po?.spots ?? 0))
    const upper = getLeague(league.upperLeagueId)
    if (direct > 0) zones.push({ kind: 'promotion', label: `Acesso${upper ? ` à ${upper.shortName}` : ''}`, from: 1, to: direct })
    if (po) zones.push({ kind: 'playoff', label: 'Play-off de acesso', from: po.positions[0], to: po.positions[1] })
  }
  if (league.relegation > 0 && league.lowerLeagueId) {
    const lower = getLeague(league.lowerLeagueId)
    const po = lower?.promotionPlayoff?.upperPosition
    const direct = po ? league.relegation - 1 : league.relegation
    if (po) zones.push({ kind: 'releg_playoff', label: 'Play-off de permanência', from: po, to: po })
    if (direct > 0) zones.push({ kind: 'relegation', label: 'Rebaixamento', from: teams - direct + 1, to: teams })
  }
  return zones.filter((z) => z.from <= z.to && z.from <= teams)
}

export const zoneAt = (zones: Zone[], pos: number) => zones.find((z) => pos >= z.from && pos <= z.to)

// ───────────────────────── leagues of a season ─────────────────────────

/** League options for the selector: the player's league first, its neighbours, then by prestige. */
export function leagueOptions(world: SeasonWorldResult | undefined, playerLeagueId: string | undefined): League[] {
  if (!world) return []
  const ids = Object.keys(world.leagues)
  const list = ids.map((id) => getLeague(id)).filter((l): l is League => !!l)
  const player = playerLeagueId ? getLeague(playerLeagueId) : undefined
  const near = new Set([player?.id, player?.upperLeagueId, player?.lowerLeagueId].filter(Boolean) as string[])
  return list.sort((a, b) => {
    const na = near.has(a.id) ? (a.id === player?.id ? 0 : 1) : 2
    const nb = near.has(b.id) ? (b.id === player?.id ? 0 : 1) : 2
    if (na !== nb) return na - nb
    return a.tier - b.tier || b.coefficient - a.coefficient || a.name.localeCompare(b.name, 'pt-BR')
  })
}

/** Quick picks (chips) — a few leagues worth one tap. */
export function quickLeagues(options: League[], playerLeagueId: string | undefined): League[] {
  const player = options.find((l) => l.id === playerLeagueId)
  const pick: League[] = []
  const add = (l: League | undefined) => l && !pick.includes(l) && pick.push(l)
  add(player)
  add(options.find((l) => l.id === player?.lowerLeagueId))
  add(options.find((l) => l.id === player?.upperLeagueId))
  for (const id of ['bra.1', 'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'arg.1', 'bra.2']) {
    if (pick.length >= 6) break
    add(options.find((l) => l.id === id))
  }
  return pick
}

export function leagueResult(world: SeasonWorldResult | undefined, leagueId: string | undefined): LeagueSeasonResult | undefined {
  return world && leagueId ? world.leagues[leagueId] : undefined
}

// ───────────────────────── cups ─────────────────────────

export interface CupOption {
  id: string
  cup: CupResult
  /** How far the player's club went (stage name) — undefined if it did not play. */
  reached?: string
  champion: boolean
}

export function stageDepth(name: string | undefined): number {
  if (!name) return 0
  if (name === 'Campeão') return 10
  if (name === 'Final') return 9
  if (name.startsWith('Semifinal') || name === 'Copa Challenger') return 8
  if (name.startsWith('Quartas')) return 7
  if (name.startsWith('Oitavas')) return 6
  if (name.startsWith('16 avos') || name.startsWith('Play-off')) return 5
  if (name.startsWith('32 avos')) return 4
  if (/grupo|liga/i.test(name)) return 3
  return 2
}

/** Cups for the Temporada tab: where the player's club played + the country's and confed's main ones. */
export function cupOptions(data: GameData | null, world: SeasonWorldResult | undefined, clubId: string | undefined): CupOption[] {
  if (!world) return []
  const club = getClub(clubId)
  const lg = getLeague(world.leagues && clubId ? Object.values(world.leagues).find((l) => l.table.some((r) => r.clubId === clubId))?.leagueId : undefined) ?? getLeague(club?.leagueId)
  const country = lg?.country ?? club?.country
  const confed = lg ? data?.confederations?.[lg.confed] : undefined
  const out: CupOption[] = []
  for (const [id, cup] of Object.entries(world.cups)) {
    const comp = getCompetition(id)
    const reached = clubId ? (cup.reached?.[clubId] ?? (cup.winner === clubId ? 'Campeão' : cup.runnerUp === clubId ? 'Final' : undefined)) : undefined
    const played = !!reached || cup.knockout.some((st) => st.ties.some((t) => t.a === clubId || t.b === clubId))
    const local = comp?.country === country && comp?.kind === 'domestic_cup' && (!comp.region || comp.region === club?.state)
    const conti = confed && (id === confed.primary || id === confed.secondary)
    if (played || local || conti) out.push({ id, cup, reached: reached ?? (played ? 'Eliminado' : undefined), champion: cup.winner === clubId })
  }
  return out.sort((a, b) => {
    const pa = a.reached ? 0 : 1
    const pb = b.reached ? 0 : 1
    return pa - pb || compRank(getCompetition(a.id)) - compRank(getCompetition(b.id))
  })
}

/**
 * Order the ties of each stage so the bracket reads as a tree: tie i of stage k+1 is fed by
 * ties 2i and 2i+1 of stage k. Unmatched ties (byes, data gaps) are appended in their order.
 */
export function orderBracket(stages: KnockoutStage[]): KnockoutStage[] {
  const ko = stages.filter((s) => s.ties.length > 0 && !/grupo|liga/i.test(s.name))
  if (ko.length < 2) return ko
  const out: KnockoutStage[] = new Array(ko.length)
  out[ko.length - 1] = ko[ko.length - 1]
  for (let k = ko.length - 2; k >= 0; k--) {
    const next = out[k + 1]
    const pool = [...ko[k].ties]
    const ordered: KnockoutStage['ties'] = []
    for (const t of next.ties) {
      for (const side of [t.a, t.b]) {
        const i = pool.findIndex((x) => x.winner === side)
        if (i >= 0) ordered.push(pool.splice(i, 1)[0])
      }
    }
    out[k] = { ...ko[k], ties: [...ordered, ...pool] }
  }
  return out
}

/**
 * League play-offs may hold several tournaments ("Apertura 2040 — Quartas de final",
 * "Play-off de acesso — Final"): split them by prefix, stage names without it.
 */
export function splitPlayoffs(stages: KnockoutStage[] | undefined): { name: string; stages: KnockoutStage[] }[] {
  if (!stages?.length) return []
  const m = new Map<string, KnockoutStage[]>()
  for (const st of stages) {
    const i = st.name.indexOf(' — ')
    const key = i > 0 ? st.name.slice(0, i) : 'Play-offs'
    const name = i > 0 ? st.name.slice(i + 3) : st.name
    const list = m.get(key) ?? []
    list.push({ ...st, name })
    m.set(key, list)
  }
  return [...m.entries()].map(([name, st]) => ({ name, stages: st }))
}

/** Stage short label for bracket column headers. */
export function stageShort(name: string): string {
  const i = name.indexOf(' — ')
  if (i > 0) name = name.slice(i + 3)
  if (name.startsWith('Quartas')) return 'Quartas'
  if (name.startsWith('Oitavas')) return 'Oitavas'
  if (name.startsWith('Semifinal')) return 'Semifinal'
  return name
}

export function aggregate(tie: KnockoutStage['ties'][number]): { a: number; b: number; pens?: [number, number] } {
  let a = 0
  let b = 0
  let pens: [number, number] | undefined
  for (const leg of tie.legs) {
    const aHome = leg.home === tie.a
    a += aHome ? leg.score[0] : leg.score[1]
    b += aHome ? leg.score[1] : leg.score[0]
    if (leg.pens) pens = aHome ? leg.pens : [leg.pens[1], leg.pens[0]]
  }
  return { a, b, pens }
}

/** "2×1", "1×1 (4×2 pên.)" from the perspective of `first`. */
export function scoreLine(tie: KnockoutStage['ties'][number], first: string = tie.a): string {
  const g = aggregate(tie)
  const flip = first !== tie.a
  const x = flip ? g.b : g.a
  const y = flip ? g.a : g.b
  let s = `${x}×${y}`
  if (g.pens) s += ` (${flip ? g.pens[1] : g.pens[0]}×${flip ? g.pens[0] : g.pens[1]} pên.)`
  return s
}

/** Real-history scores ("3–3 (4–2 pên.)") in the style the simulated ones use ("3×3 (4×2 pên.)"). */
export const scoreStyle = (score: string) => score.replace(/(\d)\s*[–-]\s*(\d)/g, '$1×$2')

/** "Itália", "Itália e Turquia", "Espanha, Portugal e Marrocos". */
export function joinPt(list: string[]): string {
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}` : (list[0] ?? '')
}

/** Host country names of a tournament: the data lists FIFA codes split by "," or "/" ("ITA,TUR", "CAN/MEX/USA"). */
export function hostNames(host: string | undefined, name: (code: string) => string = (c) => getCountry(c)?.name ?? c): string | undefined {
  const list = (host ?? '').split(/[,/]/).map((h) => h.trim()).filter(Boolean)
  return list.length ? joinPt(list.map(name)) : undefined
}

export function finalTie(cup: CupResult): KnockoutStage['ties'][number] | undefined {
  const last = cup.knockout[cup.knockout.length - 1]
  if (!last || !/final/i.test(last.name) || /semi/i.test(last.name)) return undefined
  return last.ties[0]
}

// ───────────────────────── teams (club or nation) ─────────────────────────

export function teamName(id: string, short = false): string {
  const c = getClub(id)
  if (c) return short ? c.shortName || c.name : c.name
  const n = getCountry(id)
  return n?.name ?? id
}

export const isNation = (id: string) => !getClub(id) && !!getCountry(id)

// ───────────────────────── awards ─────────────────────────

export const AWARD_LABEL: Record<AwardId, string> = {
  ballon_dor: 'Bola de Ouro',
  golden_boot: 'Chuteira de Ouro',
  golden_glove: 'Luva de Ouro',
  the_best: 'The Best da FIFA',
  kopa: 'Troféu Kopa',
  league_top_scorer: 'Artilharia da liga',
  league_best_player: 'Craque da liga',
  wc_golden_ball: 'Bola de Ouro da Copa',
  wc_golden_boot: 'Chuteira de Ouro da Copa',
  puskas: 'Prêmio Puskás',
  team_of_the_year: 'Seleção do ano',
}

export const AWARD_HINT: Partial<Record<AwardId, string>> = {
  golden_boot: 'Artilheiro das ligas europeias (pontos = gols × peso da liga)',
  golden_glove: 'Melhor goleiro do ano',
  kopa: 'Melhor jogador sub-21',
  puskas: 'Gol mais bonito do ano',
  the_best: 'Eleição da FIFA',
  wc_golden_ball: 'Melhor jogador da Copa do Mundo',
  wc_golden_boot: 'Artilheiro da Copa do Mundo',
}

export const awardTrophyId = (a: AwardId) => a.replace(/_/g, '-')

/** Unit shown next to the ranking value. */
export function awardUnit(a: AwardId): 'pts' | 'gols' | null {
  if (a === 'league_top_scorer' || a === 'wc_golden_boot') return 'gols'
  if (a === 'puskas') return null
  return 'pts'
}

/** Ballon-style scores are abstract (≈ 40–160): show them ×10 like real voting points. */
export function awardPoints(a: AwardId, score: number): number {
  if (a === 'league_top_scorer' || a === 'wc_golden_boot' || a === 'golden_boot') return score
  return Math.round(score * 10)
}

export function globalAwards(world: SeasonWorldResult | undefined): AwardResult[] {
  return (world?.awards ?? []).filter((a) => !a.leagueId)
}

export function leagueAwards(world: SeasonWorldResult | undefined): Map<string, { best?: AwardResult; scorer?: AwardResult }> {
  const m = new Map<string, { best?: AwardResult; scorer?: AwardResult }>()
  for (const a of world?.awards ?? []) {
    if (!a.leagueId) continue
    const e = m.get(a.leagueId) ?? {}
    if (a.award === 'league_best_player') e.best = a
    if (a.award === 'league_top_scorer') e.scorer = a
    m.set(a.leagueId, e)
  }
  return m
}

/** First name + surname → "L. Yamal" when long (tables). */
export function shortPerson(name: string, max = 16): string {
  if (name.length <= max) return name
  const parts = name.split(' ')
  if (parts.length < 2) return name
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

// ───────────────────────── misc ─────────────────────────

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export function slugify(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'jogador'
  )
}

/** Edition label of a competition played in `season`: "2030" (Copa do Mundo), "2037/38" (Champions), "2037". */
export function editionLabel(id: string, season: number): string {
  const comp = getCompetition(id)
  const lg = getLeague(id)
  if (lg) return formatSeason(season, lg.calendar)
  if (!comp) return String(season)
  if (comp.kind === 'world_cup' || comp.kind === 'national_continental' || comp.kind === 'club_world_cup') {
    return comp.id === 'fifa.intercontinental_cup' ? String(season) : String(season + 1)
  }
  if (comp.kind === 'domestic_cup') {
    const top = comp.country ? leaguesByCountry(comp.country)[0] : undefined
    return formatSeason(season, top?.calendar)
  }
  return formatSeason(season, comp.confed === 'UEFA' ? 'split' : 'calendar')
}

function leaguesByCountry(country: string): League[] {
  const out: League[] = []
  for (const id of ['1', '2']) {
    const l = getLeague(`${country.toLowerCase()}.${id}`)
    if (l) out.push(l)
  }
  return out
}
