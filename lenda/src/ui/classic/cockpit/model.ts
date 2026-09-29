/**
 * Cockpit view-model helpers (pure): table rows, totals, trophy groups, labels.
 *
 *   buildRows(seasons, { pending, newSeasons, competitions, nationality })  → one row per age 16…39
 *   careerTotals(seasons)                                                    → Jogos · Gols · Assist. · Títulos
 *   trophyGroups(seasons)                                                    → vitrine (Copero ordering)
 */
import type {
  AwardId,
  AwardWin,
  CareerState,
  Competition,
  Confed,
  Decision,
  DecisionKind,
  Position,
  SeasonRecord,
  Trophy,
  TrophyFamily,
  TrophyWin,
} from '@/engine/types'
import { getCompetition, getCountry, getLeague, getTrophy } from '@/store/data'
import { formatSeason } from '@/ui/primitives'

export const START_AGE = 16
export const LAST_AGE = 39
export const PACE_SEASONS = { intensa: 1, normal: 2, expressa: 3 } as const

export const isKeeper = (p: Position | undefined) => p === 'GOL'

// ───────────────────────── labels ─────────────────────────

const CLUB_KINDS: DecisionKind[] = ['academy', 'transfer', 'loan', 'loan_return', 'non_renewal']

/** Label on the pending row ("Escolhendo clube…" / "Decisão de carreira…"). */
export function pendingLabel(kind: DecisionKind | undefined): string {
  if (!kind) return 'Aguardando…'
  if (CLUB_KINDS.includes(kind)) return 'Escolhendo clube…'
  if (kind === 'injury') return 'Tratando a lesão…'
  if (kind === 'retirement') return 'Pensando no futuro…'
  if (kind === 'contract') return 'Negociando contrato…'
  return 'Decisão de carreira…'
}

/** Eyebrow of the decision card. */
export const DECISION_KIND_LABEL: Record<DecisionKind, string> = {
  academy: 'Oferta de base',
  transfer: 'Janela de transferências',
  loan: 'Oferta de empréstimo',
  loan_return: 'Fim de empréstimo',
  non_renewal: 'Fim de ciclo',
  event: 'Evento da carreira',
  injury: 'Departamento médico',
  club_priority: 'Prioridade do clube',
  national_call: 'Seleção',
  contract: 'Renovação de contrato',
  retirement: 'Fim de carreira?',
}

export const FOOT_LABEL = { right: 'Destro', left: 'Canhoto' } as const

export function seasonLabel(r: Pick<SeasonRecord, 'season' | 'leagueId'>): string {
  return formatSeason(r.season, getLeague(r.leagueId)?.calendar ?? 'calendar')
}

// ───────────────────────── awards ─────────────────────────

export interface AwardMeta {
  name: string
  art: string
  /** Shown as a trophy in the vitrine / row when won (place 1). */
  shelf: boolean
  short: string
}

export const AWARD_META: Record<AwardId, AwardMeta> = {
  ballon_dor: { name: 'Bola de Ouro', art: 'ballon-dor', shelf: true, short: 'BOLA' },
  golden_boot: { name: 'Chuteira de Ouro', art: 'golden-boot', shelf: true, short: 'CHUTEIRA' },
  golden_glove: { name: 'Luva de Ouro', art: 'golden-glove', shelf: true, short: 'LUVA' },
  the_best: { name: 'The Best FIFA', art: 'the-best', shelf: true, short: 'THE BEST' },
  kopa: { name: 'Troféu Kopa', art: 'kopa', shelf: false, short: 'KOPA' },
  league_top_scorer: { name: 'Artilheiro da liga', art: 'golden-boot', shelf: false, short: 'ARTILHEIRO' },
  league_best_player: { name: 'Craque da liga', art: 'award-generic', shelf: false, short: 'CRAQUE' },
  wc_golden_ball: { name: 'Bola de Ouro da Copa', art: 'ballon-dor', shelf: false, short: 'BOLA DA COPA' },
  wc_golden_boot: { name: 'Chuteira de Ouro da Copa', art: 'golden-boot', shelf: false, short: 'ARTILHEIRO DA COPA' },
  puskas: { name: 'Prêmio Puskás', art: 'award-generic', shelf: false, short: 'PUSKÁS' },
  team_of_the_year: { name: 'Seleção do ano', art: 'award-generic', shelf: false, short: 'SELEÇÃO DO ANO' },
}

export const awardMeta = (a: AwardId): AwardMeta => AWARD_META[a] ?? { name: a, art: 'award-generic', shelf: false, short: a.toUpperCase() }

/** Row tags (ARTILHEIRO, BOLA 3º, CRAQUE…) — trophies-as-icons are separate. */
export interface RowTag {
  kind: 'up' | 'down' | 'gold' | 'susp'
  label: string
  title: string
}

export function rowTags(r: SeasonRecord): RowTag[] {
  const tags: RowTag[] = []
  if (r.suspended) tags.push({ kind: 'susp', label: 'SUSP', title: 'Suspenso' })
  if (r.promoted) tags.push({ kind: 'up', label: 'ACESSO', title: 'Acesso à divisão de cima' })
  if (r.relegated) tags.push({ kind: 'down', label: 'REBAIXADO', title: 'Rebaixamento' })
  for (const a of r.awards) {
    const m = awardMeta(a.award)
    if (a.award === 'ballon_dor') {
      if (a.place > 1) tags.push({ kind: 'gold', label: `BOLA ${a.place}º`, title: `${a.place}º lugar na Bola de Ouro ${a.year}` })
      continue
    }
    if (m.shelf && a.place === 1) continue // shown as an icon
    if (a.place === 1) tags.push({ kind: 'gold', label: m.short, title: m.name })
  }
  return tags
}

// ───────────────────────── trophies ─────────────────────────

const FAMILY_RANK: Record<TrophyFamily, number> = {
  world_cup: 0,
  national_continental: 1,
  club_world_cup: 2,
  continental_primary: 3,
  continental_secondary: 4,
  continental_tertiary: 4.5,
  league: 5,
  domestic_cup: 6,
  award: 9,
}

const KIND_FAMILY: Record<string, TrophyFamily> = {
  league: 'league',
  domestic_cup: 'domestic_cup',
  continental_primary: 'continental_primary',
  continental_secondary: 'continental_secondary',
  continental_tertiary: 'continental_tertiary',
  club_world_cup: 'club_world_cup',
  world_cup: 'world_cup',
  national_continental: 'national_continental',
  award: 'award',
}

export interface TrophyInfo {
  id: string
  /** TrophyArt id (Trophy.art ?? Trophy.id). */
  art: string
  name: string
  family: TrophyFamily
  trophy?: Pick<Trophy, 'family' | 'metal' | 'accent'>
  minor: boolean
}

export function trophyInfo(t: Pick<TrophyWin, 'trophyId' | 'competitionId' | 'kind' | 'minor'>): TrophyInfo {
  const tr = getTrophy(t.trophyId)
  const comp = getCompetition(t.competitionId)
  const family: TrophyFamily = tr?.family ?? KIND_FAMILY[t.kind ?? comp?.kind ?? 'league'] ?? 'league'
  return {
    id: t.trophyId,
    art: tr?.art ?? t.trophyId,
    name: tr?.name ?? comp?.name ?? t.trophyId,
    family,
    trophy: tr ? { family: tr.family, metal: tr.metal, accent: tr.accent } : { family },
    minor: !!t.minor || !!comp?.superCup || !!comp?.region,
  }
}

export const trophyRank = (family: TrophyFamily) => FAMILY_RANK[family] ?? 7

/** National tournaments / Mundial are played mid-year T and close season T-1 → shown as year T. */
export function trophyYearLabel(t: TrophyWin, leagueId?: string): string {
  const fam = trophyInfo(t).family
  if (fam === 'world_cup' || fam === 'national_continental' || fam === 'club_world_cup') return String(t.season + 1)
  return formatSeason(t.season, getLeague(leagueId)?.calendar ?? 'calendar')
}

export interface ShelfItem {
  key: string
  art: string
  name: string
  family: TrophyFamily
  trophy?: TrophyInfo['trophy']
  season: number
  year: string
  scope: 'club' | 'national' | 'award'
  minor: boolean
}

export interface TrophyGroup {
  key: string
  art: string
  name: string
  family: TrophyFamily
  trophy?: TrophyInfo['trophy']
  scope: 'club' | 'national' | 'award'
  minor: boolean
  items: ShelfItem[]
  rank: number
}

const AWARD_ORDER: AwardId[] = ['ballon_dor', 'the_best', 'golden_boot', 'golden_glove']

/** Items of one season (club + national trophies, shelf awards won). */
export function seasonShelfItems(r: SeasonRecord): ShelfItem[] {
  const out: ShelfItem[] = []
  for (const t of r.trophies) {
    const info = trophyInfo(t)
    out.push({
      key: `${t.trophyId}:${t.competitionId}:${t.season}:${t.teamId}`,
      art: info.art,
      name: info.name,
      family: info.family,
      trophy: info.trophy,
      season: t.season,
      year: trophyYearLabel(t, r.leagueId),
      scope: t.scope,
      minor: info.minor,
    })
  }
  for (const a of r.awards) out.push(...awardShelfItems(a))
  return out
}

export function awardShelfItems(a: AwardWin): ShelfItem[] {
  const m = awardMeta(a.award)
  if (!m.shelf || a.place !== 1) return []
  return [{ key: `${a.award}:${a.year}`, art: m.art, name: m.name, family: 'award', trophy: { family: 'award', metal: 'gold' }, season: a.year - 1, year: String(a.year), scope: 'award', minor: false }]
}

/** Vitrine groups: national first, then club (Copero rank), then awards (Bola, The Best, Chuteira, Luva). */
export function trophyGroups(seasons: SeasonRecord[]): TrophyGroup[] {
  const map = new Map<string, TrophyGroup>()
  const order: string[] = []
  for (const r of seasons) {
    for (const it of seasonShelfItems(r)) {
      const key = `${it.scope}:${it.art}:${it.name}`
      let g = map.get(key)
      if (!g) {
        const awardIdx = it.scope === 'award' ? AWARD_ORDER.findIndex((a) => awardMeta(a).name === it.name) : 0
        g = {
          key,
          art: it.art,
          name: it.name,
          family: it.family,
          trophy: it.trophy,
          scope: it.scope,
          minor: it.minor,
          items: [],
          rank: it.scope === 'award' ? 100 + Math.max(0, awardIdx) : (it.scope === 'national' ? 0 : 10) + trophyRank(it.family),
        }
        map.set(key, g)
        order.push(key)
      }
      g.items.push(it)
    }
  }
  return order
    .map((k, i) => ({ g: map.get(k)!, i }))
    .sort((a, b) => a.g.rank - b.g.rank || a.i - b.i)
    .map((x) => x.g)
}

export function groupLabel(g: Pick<TrophyGroup, 'name' | 'items'>): string {
  return g.items.length > 1 ? `${g.items.length}x ${g.name}` : g.name
}

// ───────────────────────── totals ─────────────────────────

export interface Totals {
  apps: number
  goals: number
  assists: number
  cleanSheets: number
  conceded: number
  titles: number
}

export function careerTotals(seasons: SeasonRecord[]): Totals {
  const t: Totals = { apps: 0, goals: 0, assists: 0, cleanSheets: 0, conceded: 0, titles: 0 }
  // clube + seleção: os mesmos totais do resumo da carreira e do card
  for (const r of seasons) {
    t.apps += r.stats.apps + (r.national?.apps ?? 0)
    t.goals += r.stats.goals + (r.national?.goals ?? 0)
    t.assists += r.stats.assists + (r.national?.assists ?? 0)
    t.cleanSheets += r.stats.cleanSheets ?? 0
    t.conceded += r.stats.conceded ?? 0
    t.titles += r.trophies.length
  }
  return t
}

// ───────────────────────── table rows ─────────────────────────

export type RowKind = 'filled' | 'pending' | 'future'

export interface TournamentMarker {
  label: string
  title: string
  kind: 'world_cup' | 'national_continental' | 'club_world_cup'
}

export interface TableRow {
  age: number
  season: number
  kind: RowKind
  record?: SeasonRecord
  /** Season revealed by the running reveal. */
  isNew: boolean
  /** Most recent season (ring + glow). */
  current: boolean
  /** First row of the pending period carries the label + predicted OVR. */
  lead: boolean
  label?: string
  predictedOvr?: number
  markers: TournamentMarker[]
}

/** Upcoming national tournaments (and Mundial de Clubes) that END the given season (played mid-year season+1). */
export function tournamentMarkers(season: number, competitions: Competition[], confed: Confed | undefined): TournamentMarker[] {
  const year = season + 1
  const out: TournamentMarker[] = []
  for (const c of competitions) {
    if (!c.schedule) continue
    if (c.kind !== 'world_cup' && c.kind !== 'national_continental') continue
    if (c.kind === 'national_continental' && c.confed && confed && c.confed !== confed) continue
    if (c.kind === 'national_continental' && !confed) continue
    const { firstYear, every } = c.schedule
    if (year < firstYear || (year - firstYear) % every !== 0) continue
    const name = c.kind === 'world_cup' ? 'Copa do Mundo' : c.name
    out.push({ label: `${name} ${year}`, title: `${c.name} ${year}`, kind: c.kind })
  }
  return out.sort((a, b) => (a.kind === 'world_cup' ? -1 : 1) - (b.kind === 'world_cup' ? -1 : 1))
}

export interface BuildRowsInput {
  seasons: SeasonRecord[]
  /** Seasons (by `season`) being revealed. */
  newSeasons?: Set<number>
  /** Pending decision + pace for the "Escolhendo clube…" rows (null while revealing). */
  pending?: { decision: Decision | null; pace: CareerState['pace']; ovr: number; age: number } | null
  competitions?: Competition[]
  nationality?: string
  /** Hide the current-season ring (end of career). */
  finished?: boolean
}

export function buildRows({ seasons, newSeasons, pending, competitions = [], nationality, finished }: BuildRowsInput): TableRow[] {
  const byAge = new Map<number, SeasonRecord>()
  for (const r of seasons) byAge.set(r.age, r)
  const lastAge = seasons.length ? seasons[seasons.length - 1].age : START_AGE - 1
  const confed = nationality ? getCountry(nationality)?.confed : undefined
  const perDecision = pending ? PACE_SEASONS[pending.pace] : 0
  const pendingFrom = pending?.decision ? pending.age : Infinity
  const pendingTo = pending?.decision ? pending.age + perDecision - 1 : -Infinity
  const rows: TableRow[] = []
  for (let age = START_AGE; age <= LAST_AGE; age++) {
    const season = 2026 + (age - START_AGE)
    const rec = byAge.get(age)
    if (rec) {
      rows.push({
        age,
        season: rec.season,
        kind: 'filled',
        record: rec,
        isNew: !!newSeasons?.has(rec.season),
        current: !finished && age === lastAge,
        lead: false,
        markers: [],
      })
      continue
    }
    const inPending = age >= pendingFrom && age <= pendingTo
    rows.push({
      age,
      season,
      kind: inPending ? 'pending' : 'future',
      isNew: false,
      current: false,
      lead: inPending && age === pendingFrom,
      label: inPending && age === pendingFrom ? pendingLabel(pending?.decision?.kind) : undefined,
      predictedOvr: inPending && age === pendingFrom ? pending?.ovr : undefined,
      markers: age > lastAge && (!inPending || age !== pendingFrom) ? tournamentMarkers(season, competitions, confed) : [],
    })
  }
  return rows
}

/** Future-row fade: max(.28, 1 − (age − 27)·.06), capped at .9 for rows before 27. */
export const futureOpacity = (age: number) => Math.min(0.9, Math.max(0.28, 1 - (age - 27) * 0.06))

// ───────────────────────── national team ─────────────────────────

export interface NationalLine {
  code: string
  name: string
  firstCallUp?: number
  apps: number
  goals: number
  assists: number
  trophies: ShelfItem[]
  caption?: string
}

export function nationalLine(seasons: SeasonRecord[], nationality: string): NationalLine {
  let apps = 0
  let goals = 0
  let assists = 0
  let first: number | undefined
  const trophies: ShelfItem[] = []
  let code = nationality
  for (const r of seasons) {
    if (r.nationality) code = r.nationality
    if (r.national && r.national.apps > 0) {
      apps += r.national.apps
      goals += r.national.goals
      assists += r.national.assists
      first ??= r.season
    }
    for (const it of seasonShelfItems(r)) if (it.scope === 'national') trophies.push(it)
  }
  const best = trophies.slice().sort((a, b) => trophyRank(a.family) - trophyRank(b.family))[0]
  const worldCups = trophies.filter((t) => t.family === 'world_cup')
  const caption = best
    ? best.family === 'world_cup'
      ? `Campeão do Mundo ${worldCups.map((t) => t.year).join(', ')}`
      : `Campeão da ${best.name} ${best.year}`
    : undefined
  const country = getCountry(code)
  return { code, name: nationalTeamName(country?.name ?? code), firstCallUp: first, apps, goals, assists, trophies, caption }
}

/** "Brasil" → "Seleção Brasileira" for the most common nations, else "Seleção de {País}". */
export function nationalTeamName(country: string): string {
  const adj: Record<string, string> = {
    Brasil: 'Seleção Brasileira',
    Argentina: 'Seleção Argentina',
    Uruguai: 'Seleção Uruguaia',
    Colômbia: 'Seleção Colombiana',
    Chile: 'Seleção Chilena',
    Paraguai: 'Seleção Paraguaia',
    Portugal: 'Seleção Portuguesa',
    Espanha: 'Seleção Espanhola',
    França: 'Seleção Francesa',
    Inglaterra: 'Seleção Inglesa',
    Alemanha: 'Seleção Alemã',
    Itália: 'Seleção Italiana',
    Holanda: 'Seleção Holandesa',
    'Países Baixos': 'Seleção Holandesa',
    Bélgica: 'Seleção Belga',
    México: 'Seleção Mexicana',
    'Estados Unidos': 'Seleção dos EUA',
    Japão: 'Seleção Japonesa',
    Marrocos: 'Seleção Marroquina',
  }
  return adj[country] ?? `Seleção de ${country}`
}
