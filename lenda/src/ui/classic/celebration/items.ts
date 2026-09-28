/**
 * What the celebration overlay shows for a reveal (Copero `mp`, enriched):
 * - a relegated season → relegation items ONLY (trophies of that period are not celebrated);
 * - otherwise every trophy (club + national) and every shelf award won (place 1).
 * Items are sorted by importance; the first one is the hero.
 */
import type { RevealScript } from '@/engine/api'
import type { CareerState, Confed, SeasonRecord, TrophyFamily } from '@/engine/types'
import { getClub, getCompetition, getCountry, getLeague } from '@/store/data'
import { clubArticle } from '@/engine/career/util'
import { awardShelfItems, nationalTeamName, seasonLabel, seasonShelfItems, trophyRank, type ShelfItem } from '@/ui/classic/cockpit/model'

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
      return `CAMPEÃO CONTINENTAL · ${y}`
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

function subtitleFor(it: ShelfItem, team: string | undefined, rec: SeasonRecord | undefined, surname: string): string {
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
    case 'continental_secondary':
    case 'continental_tertiary':
      return team ? `${art(team) === 'a' ? 'A' : 'O'} ${team} conquista o continente — com a sua assinatura.` : 'A conquista do continente tem a sua assinatura.'
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
        subtitle: subtitleFor(it, teamName, r, surname),
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
  const rank = (i: CelebrationItem) => (i.kind === 'award' ? (/bola de ouro/i.test(i.name) ? 0.5 : 5.5) : trophyRank(i.family) + (i.minor ? 3 : 0))
  return out.sort((a, b) => rank(a) - rank(b) || a.season - b.season)
}
