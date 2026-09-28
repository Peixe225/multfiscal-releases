/**
 * Conquistas: as 20 do Copero (textos reescritos, mesmas condições salvo correções óbvias)
 * + 30 novas do LENDA. A detecção é PURA: estado → ids (não precisa de GameData, porque cada
 * TrophyWin/SeasonRecord já carrega tipo, confederação, país e divisão).
 */
import type { Achievement, AwardId, CareerState, Confed, SeasonRecord, TrophyWin } from '../types'

interface Ctx {
  s: CareerState
  seasons: SeasonRecord[]
  trophies: TrophyWin[]
  wins: (award: AwardId) => number
  goals: number
  apps: number
  assists: number
  cleanSheets: number
  finished: boolean
}

interface AchievementDef extends Achievement {
  check(c: Ctx): boolean
}

const count = (c: Ctx, f: (t: TrophyWin) => boolean) => c.trophies.filter(f).length
const kind = (k: TrophyWin['kind']) => (t: TrophyWin) => t.kind === k && !t.minor
const primaryOf = (confed: Confed) => (t: TrophyWin) => t.kind === 'continental_primary' && !t.minor && t.confed === confed
const worldCups = (c: Ctx) => count(c, kind('world_cup'))
const ucl = (c: Ctx) => count(c, primaryOf('UEFA'))
const lib = (c: Ctx) => count(c, primaryOf('CONMEBOL'))
const clubsOf = (c: Ctx) => new Set(c.seasons.map((r) => r.clubId))

/** Temporada com liga + copa nacional (+ outra condição) no mesmo clube. */
function sameSeason(c: Ctx, needs: TrophyWin['kind'][], filter?: (r: SeasonRecord) => boolean): boolean {
  return c.seasons.some((r) => (!filter || filter(r)) && needs.every((k) => r.trophies.some((t) => t.scope === 'club' && t.kind === k && !t.minor)))
}

const WC_WINNERS = new Set(['BRA', 'ITA', 'GER', 'ARG', 'ESP', 'FRA', 'URU', 'ENG'])
const PERIPHERY = new Set<Confed>(['CAF', 'AFC', 'OFC', 'CONCACAF'])
const BIG_FIVE = ['ESP', 'FRA', 'ENG', 'ITA', 'GER']

const DEFS: AchievementDef[] = [
  // ─────────────── Copero (20) ───────────────
  {
    id: 'king_of_america',
    title: 'Senhor das Américas',
    description: 'Ganhe a Copa América pela seleção e a Libertadores por um clube na mesma carreira.',
    icon: 'crown',
    rarity: 'epica',
    check: (c) => count(c, (t) => t.kind === 'national_continental' && t.confed === 'CONMEBOL') > 0 && lib(c) > 0,
  },
  {
    id: 'one_club_legend',
    title: 'Lenda do clube',
    description: 'Jogue a carreira inteira no mesmo clube, sem empréstimos, e ganhe liga, copa e o torneio continental por ele.',
    icon: 'shield',
    rarity: 'epica',
    check: (c) => {
      if (!c.finished || !c.seasons.length) return false
      const first = c.seasons[0].clubId
      if (c.seasons.some((r) => r.clubId !== first || r.loan)) return false
      const t = c.trophies.filter((x) => x.scope === 'club' && !x.minor)
      return t.some((x) => x.kind === 'league') && t.some((x) => x.kind === 'domestic_cup') && t.some((x) => x.kind === 'continental_primary')
    },
  },
  {
    id: 'europe_owner',
    title: 'Dono da Europa',
    description: 'Seja campeão das cinco grandes ligas europeias: Espanha, Inglaterra, Itália, Alemanha e França.',
    icon: 'map',
    rarity: 'lendaria',
    check: (c) => {
      const won = new Set(c.seasons.filter((r) => r.trophies.some((t) => t.kind === 'league' && (t.tier ?? r.tier) === 1 && t.scope === 'club')).map((r) => r.country))
      return BIG_FIVE.every((k) => won.has(k))
    },
  },
  { id: 'mr_champions', title: 'Mr. Champions', description: 'Levante a Champions League cinco vezes.', icon: 'star', rarity: 'lendaria', check: (c) => ucl(c) >= 5 },
  {
    id: 'goat',
    title: 'GOAT',
    description: 'Uma Copa do Mundo, dois títulos continentais de seleção, oito Bolas de Ouro e quatro Champions.',
    icon: 'goat',
    rarity: 'lendaria',
    hidden: true,
    check: (c) => worldCups(c) >= 1 && count(c, kind('national_continental')) >= 2 && c.wins('ballon_dor') >= 8 && ucl(c) >= 4,
  },
  {
    id: 'only_pele',
    title: 'Só o Pelé',
    description: 'Ganhe três Copas do Mundo e marque mais de 1.000 gols.',
    icon: 'crown',
    rarity: 'lendaria',
    hidden: true,
    check: (c) => worldCups(c) >= 3 && c.goals > 1000,
  },
  { id: 'black_spider', title: 'Aranha Negra', description: 'Ganhe seis vezes o prêmio de melhor goleiro do ano.', icon: 'hand', rarity: 'lendaria', check: (c) => c.wins('golden_glove') >= 6 },
  { id: 'net_terror', title: 'Terror das redes', description: 'Ganhe seis Chuteiras de Ouro.', icon: 'flame', rarity: 'lendaria', check: (c) => c.wins('golden_boot') >= 6 },
  {
    id: 'complete_football',
    title: 'Futebol completo',
    description: 'Copa do Mundo, Copa América ou Euro, Libertadores, Champions, liga + copa na América do Sul e na Europa, Bola de Ouro e Chuteira de Ouro.',
    icon: 'gem',
    rarity: 'lendaria',
    check: (c) =>
      worldCups(c) >= 1 &&
      count(c, (t) => t.kind === 'national_continental' && (t.confed === 'CONMEBOL' || t.confed === 'UEFA')) > 0 &&
      lib(c) > 0 &&
      ucl(c) > 0 &&
      sameSeason(c, ['league', 'domestic_cup'], (r) => r.confed === 'CONMEBOL') &&
      sameSeason(c, ['league', 'domestic_cup'], (r) => r.confed === 'UEFA') &&
      c.wins('ballon_dor') > 0 &&
      c.wins('golden_boot') > 0,
  },
  { id: 'most_decorated', title: 'O maior campeão da história', description: 'Conquiste 49 títulos coletivos ou mais.', icon: 'trophy', rarity: 'lendaria', check: (c) => c.trophies.length >= 49 },
  {
    id: 'ringless',
    title: 'Sem taça',
    description: 'Encerre uma carreira inteira sem nenhum título coletivo.',
    icon: 'circle-off',
    rarity: 'rara',
    check: (c) => c.finished && c.seasons.length > 0 && c.trophies.length === 0,
  },
  {
    id: 'national_hero',
    title: 'Herói nacional',
    description: 'Ganhe a Copa do Mundo com uma seleção que nunca tinha sido campeã.',
    icon: 'flag',
    rarity: 'lendaria',
    check: (c) => c.seasons.some((r) => r.trophies.some((t) => t.kind === 'world_cup' && !WC_WINNERS.has(t.teamId))),
  },
  {
    id: 'the_world_is_yours',
    title: 'O mundo é seu',
    description: 'Ganhe a Copa do Mundo e o Mundial de Clubes.',
    icon: 'globe',
    rarity: 'epica',
    check: (c) => worldCups(c) >= 1 && count(c, kind('club_world_cup')) >= 1,
  },
  {
    id: 'from_the_periphery',
    title: 'Da periferia ao topo',
    description: 'Ganhe a Bola de Ouro defendendo uma seleção da África, Ásia, Oceania ou América do Norte/Central.',
    icon: 'sunrise',
    rarity: 'lendaria',
    check: (c) =>
      c.seasons.some((r) => r.awards.some((a) => a.award === 'ballon_dor' && a.place === 1) && PERIPHERY.has(natConfed(c, r))),
  },
  {
    id: 'ushuaia_to_darien',
    title: 'De Ushuaia a Darién',
    description: 'Jogue em clubes de dez países diferentes da América do Sul.',
    icon: 'mountain',
    rarity: 'lendaria',
    check: (c) => new Set(c.seasons.filter((r) => r.confed === 'CONMEBOL').map((r) => r.country)).size >= 10,
  },
  { id: 'nomad', title: 'Nômade', description: 'Jogue em clubes das seis confederações.', icon: 'compass', rarity: 'lendaria', check: (c) => new Set(c.seasons.map((r) => r.confed).filter(Boolean)).size >= 6 },
  {
    id: 'from_the_bottom',
    title: 'Lá de baixo',
    description: 'Comece a carreira num clube de divisão inferior e seja campeão da primeira divisão com ele.',
    icon: 'trending-up',
    rarity: 'epica',
    // correção: nossos dados quase não têm 3ª divisão — vale começar em qualquer divisão inferior
    check: (c) => {
      const first = c.seasons[0]
      if (!first || first.tier < 2) return false
      return c.seasons.some((r) => r.clubId === first.clubId && r.trophies.some((t) => t.kind === 'league' && (t.tier ?? r.tier) === 1))
    },
  },
  {
    id: 'matagigantes',
    title: 'Matador de gigantes',
    description: 'Ganhe a Libertadores ou a Champions com um clube pequeno.',
    icon: 'swords',
    rarity: 'epica',
    check: (c) =>
      c.seasons.some((r) => (r.clubPrestige ?? 5) <= 2 && r.trophies.some((t) => primaryOf('UEFA')(t) || primaryOf('CONMEBOL')(t))),
  },
  {
    id: 'the_treble',
    title: 'Tríplice coroa',
    description: 'Ganhe liga, copa nacional e o torneio continental na mesma temporada.',
    icon: 'layers',
    rarity: 'epica',
    check: (c) => sameSeason(c, ['league', 'domestic_cup', 'continental_primary']),
  },
  { id: 'baldosero', title: 'Mochileiro', description: 'Jogue por 24 clubes diferentes (só dá no ritmo Intensa, um clube por temporada).', icon: 'backpack', rarity: 'lendaria', check: (c) => clubsOf(c).size >= 24 },

  // ─────────────── LENDA (30) ───────────────
  { id: 'first_title', title: 'Primeira taça', description: 'Conquiste o seu primeiro título.', icon: 'trophy', rarity: 'comum', check: (c) => c.trophies.length >= 1 },
  { id: 'ballon_dor', title: 'Bola de Ouro', description: 'Seja eleito o melhor jogador do mundo.', icon: 'circle-dot', rarity: 'epica', check: (c) => c.wins('ballon_dor') >= 1 },
  { id: 'ballon_tri', title: 'Tri da Bola de Ouro', description: 'Ganhe três Bolas de Ouro.', icon: 'circle-dot', rarity: 'lendaria', check: (c) => c.wins('ballon_dor') >= 3 },
  {
    id: 'hexa',
    title: 'É hexa!',
    description: 'Dê ao Brasil a sexta Copa do Mundo.',
    icon: 'star',
    rarity: 'lendaria',
    check: (c) => c.trophies.some((t) => t.kind === 'world_cup' && t.teamId === 'BRA'),
  },
  { id: 'world_champion', title: 'Campeão do mundo', description: 'Ganhe uma Copa do Mundo.', icon: 'globe', rarity: 'epica', check: (c) => worldCups(c) >= 1 },
  { id: 'tri_libertadores', title: 'Rei da América', description: 'Ganhe três Libertadores.', icon: 'crown', rarity: 'lendaria', check: (c) => lib(c) >= 3 },
  { id: 'libertadores', title: 'Glória eterna', description: 'Ganhe a Libertadores.', icon: 'trophy', rarity: 'rara', check: (c) => lib(c) >= 1 },
  { id: 'orelhuda', title: 'Orelhuda', description: 'Ganhe a Champions League.', icon: 'trophy', rarity: 'epica', check: (c) => ucl(c) >= 1 },
  { id: 'golden_boot', title: 'Chuteira de Ouro', description: 'Seja o maior artilheiro da Europa numa temporada.', icon: 'footprints', rarity: 'epica', check: (c) => c.wins('golden_boot') >= 1 },
  { id: 'league_top_scorer', title: 'Artilheiro da liga', description: 'Termine uma temporada como artilheiro do campeonato.', icon: 'target', rarity: 'rara', check: (c) => c.wins('league_top_scorer') >= 1 },
  { id: 'goals_300', title: '300 gols', description: 'Marque 300 gols na carreira (clube + seleção).', icon: 'goal', rarity: 'rara', check: (c) => c.goals >= 300 },
  { id: 'goals_500', title: '500 gols', description: 'Marque 500 gols na carreira.', icon: 'goal', rarity: 'epica', check: (c) => c.goals >= 500 },
  { id: 'goals_800', title: '800 gols', description: 'Marque 800 gols na carreira.', icon: 'goal', rarity: 'lendaria', check: (c) => c.goals >= 800 },
  { id: 'apps_500', title: '500 jogos', description: 'Chegue a 500 jogos na carreira (clube + seleção).', icon: 'calendar', rarity: 'comum', check: (c) => c.apps >= 500 },
  { id: 'apps_1000', title: 'Mil jogos', description: 'Chegue a 1.000 jogos na carreira.', icon: 'infinity', rarity: 'lendaria', check: (c) => c.apps >= 1000 },
  {
    id: 'promotion_to_title',
    title: 'Do acesso ao título',
    description: 'Suba de divisão com um clube e depois seja campeão da primeira divisão com ele.',
    icon: 'trending-up',
    rarity: 'epica',
    check: (c) =>
      c.seasons.some((p, i) => p.promoted && c.seasons.slice(i + 1).some((r) => r.clubId === p.clubId && r.trophies.some((t) => t.kind === 'league' && (t.tier ?? r.tier) === 1))),
  },
  {
    id: 'never_relegated',
    title: 'Nunca rebaixado',
    description: 'Jogue 18 temporadas ou mais sem nenhum rebaixamento.',
    icon: 'shield-check',
    rarity: 'comum',
    check: (c) => c.finished && c.seasons.length >= 18 && !c.seasons.some((r) => r.relegated),
  },
  { id: 'globetrotter', title: 'Globetrotter', description: 'Jogue em clubes de cinco países diferentes.', icon: 'plane', rarity: 'rara', check: (c) => new Set(c.seasons.map((r) => r.country).filter(Boolean)).size >= 5 },
  {
    id: 'one_club_only',
    title: 'Um clube só',
    description: 'Jogue 20 temporadas ou mais sempre pelo mesmo clube, sem empréstimos.',
    icon: 'heart',
    rarity: 'epica',
    check: (c) => c.finished && c.seasons.length >= 20 && c.seasons.every((r) => r.clubId === c.seasons[0].clubId && !r.loan),
  },
  { id: 'club_world_champion', title: 'Campeão mundial de clubes', description: 'Ganhe o Mundial de Clubes.', icon: 'globe-2', rarity: 'epica', check: (c) => count(c, kind('club_world_cup')) >= 1 },
  { id: 'playmaker', title: 'Garçom', description: 'Dê 150 assistências na carreira.', icon: 'hand-helping', rarity: 'rara', check: (c) => c.assists >= 150 },
  {
    id: 'wall',
    title: 'Muralha',
    description: 'Como goleiro, termine 250 jogos sem sofrer gols.',
    icon: 'brick-wall',
    rarity: 'epica',
    check: (c) => c.cleanSheets >= 250,
  },
  { id: 'legend_90', title: 'Lenda 90+', description: 'Alcance OVR 90.', icon: 'sparkles', rarity: 'epica', check: (c) => peak(c) >= 90 },
  { id: 'perfection', title: 'Perfeição', description: 'Alcance OVR 99.', icon: 'gem', rarity: 'lendaria', hidden: true, check: (c) => peak(c) >= 99 },
  {
    id: 'idol',
    title: 'Ídolo',
    description: 'Jogue 10 temporadas pelo mesmo clube.',
    icon: 'shirt',
    rarity: 'rara',
    check: (c) => {
      const n = new Map<string, number>()
      for (const r of c.seasons) n.set(r.clubId, (n.get(r.clubId) ?? 0) + 1)
      return Math.max(0, ...n.values()) >= 10
    },
  },
  { id: 'continental_national', title: 'Campeão continental', description: 'Ganhe o torneio continental de seleções (Copa América, Euro…).', icon: 'medal', rarity: 'epica', check: (c) => count(c, kind('national_continental')) >= 1 },
  { id: 'kopa', title: 'Revelação', description: 'Ganhe o Troféu Kopa de melhor jogador sub-21.', icon: 'baby', rarity: 'rara', check: (c) => c.wins('kopa') >= 1 },
  { id: 'the_best', title: 'The Best', description: 'Ganhe o prêmio The Best da FIFA.', icon: 'award', rarity: 'epica', check: (c) => c.wins('the_best') >= 1 },
  {
    id: 'captain_champion',
    title: 'Capitão campeão',
    description: 'Levante a taça da primeira divisão com a braçadeira de capitão.',
    icon: 'badge',
    rarity: 'rara',
    check: (c) => c.seasons.some((r) => r.captain && r.trophies.some((t) => t.kind === 'league' && (t.tier ?? r.tier) === 1)),
  },
  { id: 'puskas', title: 'Golaço', description: 'Ganhe o Prêmio Puskás de gol mais bonito do ano.', icon: 'zap', rarity: 'rara', check: (c) => c.wins('puskas') >= 1 },
  { id: 'wc_golden_ball', title: 'Craque da Copa', description: 'Seja eleito o melhor jogador de uma Copa do Mundo.', icon: 'circle-dot', rarity: 'lendaria', check: (c) => c.wins('wc_golden_ball') >= 1 },
]

function peak(c: Ctx): number {
  let p = c.s.ovr
  for (const r of c.seasons) p = Math.max(p, r.ovrStart, r.ovrEnd)
  return p
}

/** Confederação da seleção do jogador naquela temporada (memória do motor → troféus → tabela). */
function natConfed(c: Ctx, r: SeasonRecord): Confed {
  const nat = r.nationality ?? c.s.identity.nationality
  const known = (c.s.engine as { natConfeds?: Record<string, Confed> } | undefined)?.natConfeds?.[nat]
  if (known) return known
  const t = c.trophies.find((x) => x.scope === 'national' && x.teamId === nat && x.confed)
  if (t?.confed) return t.confed
  return NATIONALITY_CONFED[nat] ?? 'UEFA'
}

/** Confederação por código FIFA (principais seleções) — só para detecção sem GameData. */
const NATIONALITY_CONFED: Record<string, Confed> = Object.fromEntries([
  ...['BRA', 'ARG', 'URU', 'COL', 'CHI', 'PAR', 'PER', 'ECU', 'BOL', 'VEN'].map((k) => [k, 'CONMEBOL']),
  ...['MEX', 'USA', 'CAN', 'CRC', 'HON', 'PAN', 'JAM', 'SLV', 'GUA', 'HAI', 'TRI', 'CUW'].map((k) => [k, 'CONCACAF']),
  ...['MAR', 'SEN', 'NGA', 'EGY', 'CMR', 'GHA', 'CIV', 'ALG', 'TUN', 'MLI', 'RSA', 'BFA', 'COD', 'CPV', 'GUI', 'GAB', 'ANG', 'ZAM', 'KEN', 'UGA'].map((k) => [k, 'CAF']),
  ...['JPN', 'KOR', 'KSA', 'IRN', 'AUS', 'QAT', 'UAE', 'IRQ', 'UZB', 'CHN', 'JOR', 'OMA', 'BHR', 'SYR', 'THA', 'VIE', 'IND', 'KUW', 'KGZ', 'PLE'].map((k) => [k, 'AFC']),
  ...['NZL', 'FIJ', 'PNG', 'SOL', 'TAH', 'NCL', 'VAN'].map((k) => [k, 'OFC']),
]) as Record<string, Confed>

/** Catálogo público (sem as regras). */
export const ACHIEVEMENTS: Achievement[] = DEFS.map(({ check: _c, ...a }) => a)
export const ACHIEVEMENT_BY_ID: Record<string, Achievement> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]))

/** Todas as conquistas que o estado atual desbloqueia (as "de resumo" só com a carreira encerrada). */
export function detectAchievements(s: CareerState): string[] {
  const seasons = s.seasons
  const trophies = seasons.flatMap((r) => r.trophies)
  const awardWins = new Map<AwardId, number>()
  for (const r of seasons) for (const a of r.awards) if (a.place === 1) awardWins.set(a.award, (awardWins.get(a.award) ?? 0) + 1)
  let apps = s.national.apps
  let goals = s.national.goals
  let assists = s.national.assists
  let cleanSheets = 0
  for (const r of seasons) {
    apps += r.stats.apps
    goals += r.stats.goals
    assists += r.stats.assists
    cleanSheets += r.stats.cleanSheets ?? 0
  }
  const c: Ctx = { s, seasons, trophies, wins: (a) => awardWins.get(a) ?? 0, goals, apps, assists, cleanSheets, finished: s.retired }
  return DEFS.filter((d) => d.check(c)).map((d) => d.id)
}
