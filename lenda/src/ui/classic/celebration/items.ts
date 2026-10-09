/**
 * What the celebration overlay shows for a reveal (Copero `mp`, enriched):
 * - a relegated season → relegation items ONLY (trophies of that period are not celebrated);
 * - otherwise every trophy (club + national) and every shelf award won (place 1).
 * Items are sorted by importance (World Cup, league, continental, cups, then the awards); the first one is the hero.
 * A reveal can span up to 3 seasons (ritmo Expresso): the texts below group repeated trophies
 * ("LaLiga ×3") and say how many seasons the haul took.
 */
import type { RevealScript } from '@/engine/api'
import type { CareerState, Confed, SeasonRecord, TrophyFamily } from '@/engine/types'
import { getClub, getCompetition, getCountry, getLeague } from '@/store/data'
import { clubArticle } from '@/engine/career/util'
import { awardShelfItems, nationalTeamName, seasonLabel, seasonShelfItems, type ShelfItem } from '@/ui/classic/cockpit/model'

export interface CelebrationItem extends ShelfItem {
  kind: 'trophy' | 'award' | 'relegation'
  kicker: string
  subtitle: string
  /** Club (or national team) that won it. */
  teamName?: string
  teamId?: string
  record?: SeasonRecord
}

const CONFED_WHERE: Record<Confed, string> = {
  CONMEBOL: 'DA AMÉRICA',
  UEFA: 'DA EUROPA',
  CONCACAF: 'DA CONCACAF',
  CAF: 'DA ÁFRICA',
  AFC: 'DA ÁSIA',
  OFC: 'DA OCEANIA',
}

const LEAGUE_ADJ: Record<string, string> = {
  BRA: 'BRASILEIRO',
  ARG: 'ARGENTINO',
  URU: 'URUGUAIO',
  COL: 'COLOMBIANO',
  CHI: 'CHILENO',
  ESP: 'ESPANHOL',
  ENG: 'INGLÊS',
  ITA: 'ITALIANO',
  GER: 'ALEMÃO',
  FRA: 'FRANCÊS',
  POR: 'PORTUGUÊS',
  NED: 'HOLANDÊS',
  MEX: 'MEXICANO',
  USA: 'DA MLS',
  BEL: 'BELGA',
  TUR: 'TURCO',
  KSA: 'SAUDITA',
  JPN: 'JAPONÊS',
}

const up = (s: string) => s.toLocaleUpperCase('pt-BR')

function kickerFor(it: ShelfItem, rec: SeasonRecord | undefined, confed: Confed | undefined): string {
  const y = it.year
  switch (it.family as TrophyFamily) {
    case 'world_cup':
      return `CAMPEÃO DO MUNDO · ${y}`
    case 'club_world_cup':
      return `CAMPEÃO MUNDIAL DE CLUBES · ${y}`
    case 'national_continental':
    case 'continental_primary':
      return `CAMPEÃO ${confed ? CONFED_WHERE[confed] : 'CONTINENTAL'} · ${y}`
    case 'continental_secondary':
    case 'continental_tertiary':
      // 2º/3º nível (Liga Europa, Conference, Sul-Americana): o nome da taça, sem "campeão da Europa"
      return `CAMPEÃO DA ${up(it.name)} · ${y}`
    case 'league': {
      const lg = getLeague(rec?.leagueId)
      if (lg && lg.tier > 1) return `CAMPEÃO DA ${up(lg.shortName)} · ${y}`
      const adj = LEAGUE_ADJ[lg?.country ?? rec?.country ?? '']
      return `${adj ? `CAMPEÃO ${adj}` : 'CAMPEÃO NACIONAL'} · ${y}`
    }
    case 'domestic_cup':
      // estaduais (Campeonato Gaúcho, Paulistão…) são campeonatos, não copas
      if (/^campeonato|paulist|carioc|mineir|ga[úu]ch|baian|pernambuc|cearens|paranaens|catarinens|goian/i.test(it.name)) return `CAMPEÃO ESTADUAL · ${y}`
      return /^copa|^ta[çc]a/i.test(it.name) ? `CAMPEÃO DA ${up(it.name)} · ${y}` : `CAMPEÃO DA COPA · ${y}`
    case 'award':
      if (/bola de ouro/i.test(it.name)) return `MELHOR JOGADOR DO MUNDO · ${y}`
      if (/chuteira/i.test(it.name)) return `ARTILHEIRO DA EUROPA · ${y}`
      if (/luva/i.test(it.name)) return `MELHOR GOLEIRO DO MUNDO · ${y}`
      return `PRÊMIO INDIVIDUAL · ${y}`
    default:
      return `CAMPEÃO · ${y}`
  }
}

const CONFED_CUP: Partial<Record<Confed, string>> = { UEFA: 'europeia', CONMEBOL: 'sul-americana', CONCACAF: 'da Concacaf', CAF: 'africana', AFC: 'asiática' }

function subtitleFor(it: ShelfItem, team: string | undefined, rec: SeasonRecord | undefined, surname: string, confed?: Confed): string {
  const goals = rec?.stats.goals ?? 0
  const art = (n: string) => clubArticle({ name: n, shortName: n })
  switch (it.family as TrophyFamily) {
    case 'world_cup':
      return `${team ?? 'Sua seleção'} no topo do mundo — e você fez parte da história.`
    case 'national_continental':
      return `${team ?? 'Sua seleção'} levanta a taça do continente.`
    case 'club_world_cup':
      return `${team ? `${art(team) === 'a' ? 'A' : 'O'} ${team}` : 'Seu clube'} é o melhor time do planeta.`
    case 'continental_primary':
      return team ? `${art(team) === 'a' ? 'A' : 'O'} ${team} conquista o continente — com a sua assinatura.` : 'A conquista do continente tem a sua assinatura.'
    case 'continental_secondary':
    case 'continental_tertiary': {
      const kind = `taça ${(confed && CONFED_CUP[confed]) || 'continental'}`
      return team ? `Uma ${kind} para a galeria ${art(team) === 'a' ? 'da' : 'do'} ${team} — com a sua assinatura.` : `Uma ${kind} com a sua assinatura.`
    }
    case 'league':
      return goals > 0 ? `Campeão com ${goals} ${goals === 1 ? 'gol seu' : 'gols seus'} na temporada.` : team ? `Campeão com ${art(team)} ${team}.` : 'Campeão com o seu clube.'
    case 'domestic_cup':
      return `Mais uma taça para a galeria${team ? ` ${art(team) === 'a' ? 'da' : 'do'} ${team}` : ''}.`
    case 'award':
      if (/bola de ouro/i.test(it.name)) return `O melhor jogador do planeta tem nome: ${surname}.`
      return `${surname} entra para a história do futebol.`
    default:
      return ''
  }
}

export function celebrationItems(reveal: RevealScript | null, prev: CareerState | null, next: CareerState | null): CelebrationItem[] {
  if (!reveal || !reveal.seasons.length) return []
  const surname = next?.identity.surname ?? prev?.identity.surname ?? ''
  const relegated = reveal.seasons.filter((r) => r.relegated)
  if (relegated.length) {
    return relegated.map((r) => {
      const club = getClub(r.clubId)
      const y = seasonLabel(r)
      return {
        key: `rel:${r.season}`,
        kind: 'relegation' as const,
        art: 'relegation',
        name: 'Rebaixamento',
        family: 'league' as const,
        season: r.season,
        year: y,
        scope: 'club' as const,
        minor: false,
        kicker: `REBAIXADO · ${y}`,
        subtitle: club ? `Uma temporada para esquecer: ${clubArticle(club)} ${club.name} cai de divisão.` : 'Uma temporada para esquecer.',
        teamName: club?.name,
        teamId: r.clubId,
        record: r,
      }
    })
  }
  const out: CelebrationItem[] = []
  for (const r of reveal.seasons) {
    const items = seasonShelfItems(r)
    for (const it of items) {
      const t = r.trophies.find((x) => `${x.trophyId}:${x.competitionId}:${x.season}:${x.teamId}` === it.key)
      const national = it.scope === 'national'
      const teamId = t?.teamId ?? (national ? r.nationality ?? next?.identity.nationality : r.clubId)
      const teamName = national ? nationalTeamName(getCountry(teamId)?.name ?? teamId ?? '') : getClub(teamId)?.name
      const confed = t?.confed ?? getCompetition(t?.competitionId)?.confed ?? (national ? getCountry(teamId)?.confed : r.confed ?? getLeague(r.leagueId)?.confed)
      out.push({
        ...it,
        kind: it.scope === 'award' ? 'award' : 'trophy',
        kicker: kickerFor(it, r, confed),
        subtitle: subtitleFor(it, teamName, r, surname, confed),
        teamName,
        teamId,
        record: r,
      })
    }
  }
  // awards the reveal lists but the seasons don't carry (defensive)
  for (const a of reveal.awards) {
    for (const it of awardShelfItems(a)) {
      if (out.some((o) => o.key === it.key)) continue
      out.push({ ...it, kind: 'award', kicker: kickerFor(it, undefined, undefined), subtitle: subtitleFor(it, undefined, undefined, surname) })
    }
  }
  const rank = (i: CelebrationItem) => (i.kind === 'award' ? (/bola de ouro/i.test(i.name) ? 20 : 21) : (CELEBRATION_RANK[i.family] ?? 8) + (i.minor ? 3 : 0))
  return out.sort((a, b) => rank(a) - rank(b) || a.season - b.season)
}

/**
 * Ordem da celebração (manchete, figuras e lista): Copa do Mundo, o campeonato nacional, as taças
 * continentais e mundiais, as copas — e só então os prêmios individuais (a Bola de Ouro abre os prêmios).
 */
const CELEBRATION_RANK: Partial<Record<TrophyFamily, number>> = {
  world_cup: 0,
  league: 1,
  continental_primary: 2,
  club_world_cup: 3,
  national_continental: 4,
  continental_secondary: 5,
  continental_tertiary: 6,
  domestic_cup: 7,
}

// ───────────────────────── textos de vários títulos ─────────────────────────

export interface CelebrationGroup extends CelebrationItem {
  /** Quantas vezes a mesma taça/prêmio saiu no período (LaLiga ×3). */
  count: number
  /** Rótulos dos anos em ordem cronológica ("2038/39", "2039/40"). */
  years: string[]
}

const seasonOf = (i: CelebrationItem) => i.record?.season ?? i.season

/** Temporadas cobertas pela revelação (1 a 3). */
export function celebrationSeasons(items: CelebrationItem[]): number {
  return new Set(items.map(seasonOf)).size
}

/** Uma entrada por taça/prêmio, na ordem dos itens; repetidas viram `count` com os anos em ordem. */
export function groupCelebration(items: CelebrationItem[]): CelebrationGroup[] {
  const map = new Map<string, { g: CelebrationGroup; all: CelebrationItem[] }>()
  for (const it of items) {
    const k = `${it.kind}:${it.scope}:${it.art}:${it.name}`
    const cur = map.get(k)
    if (cur) cur.all.push(it)
    else map.set(k, { g: { ...it, count: 0, years: [] }, all: [it] })
  }
  return [...map.values()].map(({ g, all }) => ({ ...g, count: all.length, years: yearLabels(all) }))
}

/** Rótulos únicos dos anos, do mais antigo ao mais recente ("2038/39 · 2039/40 · 2041"). */
export function yearLabels(items: CelebrationItem[]): string[] {
  const seen = new Map<string, number>()
  for (const i of items) if (!seen.has(i.year)) seen.set(i.year, i.season)
  return [...seen.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([y]) => y)
}

const counts = (items: CelebrationItem[]) => {
  const titles = items.filter((i) => i.kind === 'trophy').length
  return { titles, awards: items.filter((i) => i.kind === 'award').length }
}

/** Selo do topo: "3º TÍTULO DA CARREIRA", "+3 TÍTULOS · 7 NA CARREIRA", "+7 TÍTULOS · +2 PRÊMIOS". */
export function celebrationPill(items: CelebrationItem[], careerTitles?: number): string | null {
  if (!items.length || items.some((i) => i.kind === 'relegation')) return null
  const { titles, awards } = counts(items)
  if (!titles) return awards === 1 ? 'PRÊMIO INDIVIDUAL' : `+${awards} PRÊMIOS INDIVIDUAIS`
  if (titles === 1 && !awards) return `${careerTitles ?? 1}º TÍTULO DA CARREIRA`
  const t = `+${titles} ${titles === 1 ? 'TÍTULO' : 'TÍTULOS'}`
  return awards ? `${t} · +${awards} ${awards === 1 ? 'PRÊMIO' : 'PRÊMIOS'}` : `${t} · ${careerTitles ?? titles} NA CARREIRA`
}

/** Linha acima do título: "3 TÍTULOS · 2040/41 · 2041/42", "9 CONQUISTAS EM 3 TEMPORADAS". */
export function celebrationKicker(items: CelebrationItem[]): string {
  const { titles, awards } = counts(items)
  const noun = titles && awards ? 'CONQUISTAS' : titles ? 'TÍTULOS' : 'PRÊMIOS'
  const years = yearLabels(items)
  const seasons = celebrationSeasons(items)
  return seasons > 1 && years.length > 3 ? `${items.length} ${noun} EM ${seasons} TEMPORADAS` : `${items.length} ${noun} · ${years.join(' · ')}`
}

/** Manchete de vários títulos: dobradinha, tríplice coroa, temporada histórica… ("anos de ouro" em várias temporadas). */
export function celebrationHeadline(items: CelebrationItem[]): string {
  const { titles, awards } = counts(items)
  const several = celebrationSeasons(items) > 1
  if (titles && (awards || (several && titles >= 4))) return several ? 'Anos de ouro' : 'Temporada histórica'
  if (!several) {
    const fam = new Set(items.map((i) => i.family))
    if (titles >= 3 && fam.has('league') && fam.has('domestic_cup') && fam.has('continental_primary')) return 'Tríplice coroa'
    if (titles === 2 && fam.has('league') && fam.has('domestic_cup')) return 'Dobradinha'
    if (titles >= 4) return 'Temporada perfeita'
  }
  return titles === 3 ? 'Três taças' : titles === 2 ? 'Duas taças' : titles ? 'Campeão' : `${awards} prêmios`
}

/** "o Borussia Dortmund", "a Roma", "a Seleção Brasileira". */
function withTeamArticle(team: string): string {
  const a = /^sele[çc][ãa]o\b/i.test(team) ? 'a' : clubArticle({ name: team, shortName: team })
  return `${a} ${team}`
}

/** "LaLiga ×3, Liga dos Campeões e Supercopa da UEFA — com o Real Madrid em 3 temporadas." */
export function multiSubtitle(items: CelebrationItem[]): string {
  const names = groupCelebration(items).map((g) => (g.count > 1 ? `${g.name} ×${g.count}` : g.name))
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}` : (names[0] ?? '')
  const teams = [...new Set(items.filter((i) => i.kind === 'trophy').map((i) => i.teamName).filter(Boolean))] as string[]
  const seasons = celebrationSeasons(items)
  const when = seasons > 1 ? ` em ${seasons} temporadas` : ''
  if (teams.length === 1) return `${list} — com ${withTeamArticle(teams[0])}${when}.`
  return when ? `${list} —${when}.` : `${list}.`
}
