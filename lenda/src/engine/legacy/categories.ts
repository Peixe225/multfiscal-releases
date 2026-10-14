/**
 * As 17 categorias do Hall das Lendas (ranking, pódios e Nota de Legado), em três grupos:
 *   Prêmios ... Bolas de Ouro, Melhor jogador, Chuteiras de Ouro, Artilharias, Prêmio Puskás, Luvas de
 *               Ouro e Prêmios individuais (a soma de todos os prêmios do Hall; não entra na nota)
 *   Títulos ... Copas do Mundo, Champions, Libertadores, Títulos nacionais e Títulos (todos)
 *   Números ... Gols, Assistências, Média de gols, Recordes e Clubes
 * Cada categoria conta a MESMA coisa nas carreiras do jogo e nas lendas: só prêmios e taças que o
 * jogo também dá (ver o cabeçalho de src/data/catalog/legends.ts).
 * Pura: sem React, sem GameData.
 */
import type { AwardId, PositionGroup } from '../types'

export type CategoryId =
  | 'ballonDor'
  | 'bestPlayer'
  | 'goldenBoots'
  | 'topScorer'
  | 'puskas'
  | 'goldenGloves'
  | 'awards'
  | 'worldCups'
  | 'ucl'
  | 'libertadores'
  | 'leagueTitles'
  | 'titles'
  | 'goals'
  | 'assists'
  | 'goalsPerGame'
  | 'records'
  | 'clubs'

export const CATEGORY_IDS: readonly CategoryId[] = [
  'ballonDor',
  'bestPlayer',
  'goldenBoots',
  'topScorer',
  'puskas',
  'goldenGloves',
  'awards',
  'worldCups',
  'ucl',
  'libertadores',
  'leagueTitles',
  'titles',
  'goals',
  'assists',
  'goalsPerGame',
  'records',
  'clubs',
]

export type CategoryValues = Record<CategoryId, number>

export type CategoryGroup = 'premios' | 'titulos' | 'numeros'

export const CATEGORY_GROUPS: { id: CategoryGroup; label: string }[] = [
  { id: 'premios', label: 'Prêmios' },
  { id: 'titulos', label: 'Títulos' },
  { id: 'numeros', label: 'Números' },
]

export interface CategoryMeta {
  id: CategoryId
  group: CategoryGroup
  /** Rótulo de aba/pódio: "Bolas de Ouro". */
  label: string
  /** Rótulo curto (chips, tabelas estreitas). */
  short: string
  /** Singular/plural para "3 Bolas de Ouro". */
  one: string
  many: string
  /** Verbo da comparação: "Sua carreira nº 3 {more} Pelé (2)". */
  more: string
  /** Arte de troféu (src/ui/trophies) quando existe. */
  art?: string
  /** Chave de ícone (lucide) para as categorias sem troféu. */
  icon: string
  /** Valor fracionário (média de gols). */
  ratio?: boolean
  /** Jogos mínimos para entrar no ranking da categoria. */
  minApps?: number
  /** Prêmios do jogo que a categoria soma (categorias de prêmio). */
  awards?: readonly AwardId[]
  /** false = só ranking/pódio; não entra na Nota de Legado (soma de outras categorias). */
  scored?: boolean
}

/** Prêmios individuais do jogo que contam no Hall (a Seleção do Ano fica de fora: é um time). */
export const HALL_AWARDS: readonly AwardId[] = ['ballon_dor', 'the_best', 'wc_golden_ball', 'league_best_player', 'golden_boot', 'wc_golden_boot', 'league_top_scorer', 'puskas', 'golden_glove', 'kopa']

export const CATEGORIES: Record<CategoryId, CategoryMeta> = {
  ballonDor: { id: 'ballonDor', group: 'premios', label: 'Bolas de Ouro', short: 'Bolas', one: 'Bola de Ouro', many: 'Bolas de Ouro', more: 'tem mais Bolas de Ouro que', art: 'ballon-dor', icon: 'circle-dot', awards: ['ballon_dor'] },
  bestPlayer: { id: 'bestPlayer', group: 'premios', label: 'Melhor jogador', short: 'Craque', one: 'prêmio de melhor jogador', many: 'prêmios de melhor jogador', more: 'tem mais prêmios de melhor jogador que', art: 'the-best', icon: 'crown', awards: ['the_best', 'league_best_player', 'wc_golden_ball'] },
  goldenBoots: { id: 'goldenBoots', group: 'premios', label: 'Chuteiras de Ouro', short: 'Chuteiras', one: 'Chuteira de Ouro', many: 'Chuteiras de Ouro', more: 'tem mais Chuteiras de Ouro que', art: 'golden-boot', icon: 'footprints', awards: ['golden_boot'] },
  topScorer: { id: 'topScorer', group: 'premios', label: 'Artilharias', short: 'Artilh.', one: 'artilharia', many: 'artilharias', more: 'foi artilheiro mais vezes que', art: 'league-top-scorer', icon: 'goal', awards: ['league_top_scorer', 'wc_golden_boot'] },
  puskas: { id: 'puskas', group: 'premios', label: 'Prêmio Puskás', short: 'Puskás', one: 'Prêmio Puskás', many: 'Prêmios Puskás', more: 'tem mais Prêmios Puskás que', art: 'puskas', icon: 'sparkles', awards: ['puskas'] },
  goldenGloves: { id: 'goldenGloves', group: 'premios', label: 'Luvas de Ouro', short: 'Luvas', one: 'Luva de Ouro', many: 'Luvas de Ouro', more: 'tem mais Luvas de Ouro que', art: 'golden-glove', icon: 'hand', awards: ['golden_glove'] },
  awards: { id: 'awards', group: 'premios', label: 'Prêmios individuais', short: 'Prêmios', one: 'prêmio individual', many: 'prêmios individuais', more: 'tem mais prêmios individuais que', icon: 'award', awards: HALL_AWARDS, scored: false },
  worldCups: { id: 'worldCups', group: 'titulos', label: 'Copas do Mundo', short: 'Copas', one: 'Copa do Mundo', many: 'Copas do Mundo', more: 'tem mais Copas do Mundo que', art: 'world-cup', icon: 'globe' },
  ucl: { id: 'ucl', group: 'titulos', label: 'Champions League', short: 'Champions', one: 'Champions', many: 'Champions', more: 'tem mais Champions que', art: 'champions-league', icon: 'star' },
  libertadores: { id: 'libertadores', group: 'titulos', label: 'Libertadores', short: 'Liberta', one: 'Libertadores', many: 'Libertadores', more: 'tem mais Libertadores que', art: 'libertadores', icon: 'trophy' },
  leagueTitles: { id: 'leagueTitles', group: 'titulos', label: 'Títulos nacionais', short: 'Ligas', one: 'título nacional', many: 'títulos nacionais', more: 'tem mais títulos nacionais que', art: 'brasileirao', icon: 'medal' },
  titles: { id: 'titles', group: 'titulos', label: 'Títulos', short: 'Títulos', one: 'título', many: 'títulos', more: 'tem mais títulos que', icon: 'trophy' },
  goals: { id: 'goals', group: 'numeros', label: 'Gols', short: 'Gols', one: 'gol', many: 'gols', more: 'tem mais gols que', icon: 'goal' },
  assists: { id: 'assists', group: 'numeros', label: 'Assistências', short: 'Assist.', one: 'assistência', many: 'assistências', more: 'tem mais assistências que', icon: 'hand-helping' },
  goalsPerGame: { id: 'goalsPerGame', group: 'numeros', label: 'Média de gols', short: 'Média', one: 'gol por jogo', many: 'gols por jogo', more: 'tem média de gols maior que', icon: 'target', ratio: true, minApps: 300 },
  records: { id: 'records', group: 'numeros', label: 'Recordes', short: 'Recordes', one: 'recorde', many: 'recordes', more: 'quebrou mais recordes que', icon: 'zap' },
  clubs: { id: 'clubs', group: 'numeros', label: 'Clubes', short: 'Clubes', one: 'clube', many: 'clubes', more: 'jogou em mais clubes que', icon: 'shirt' },
}

/** Categorias que entram na Nota de Legado (Prêmios individuais é só ranking: soma das outras). */
export const SCORED_CATEGORY_IDS: readonly CategoryId[] = CATEGORY_IDS.filter((id) => CATEGORIES[id].scored !== false)

export const emptyValues = (): CategoryValues => Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0])) as CategoryValues

/** Categorias de prêmio a partir de contagens por AwardId (runs e lendas usam a mesma soma). */
export function awardCategoryValues(count: (a: AwardId) => number): Pick<CategoryValues, 'ballonDor' | 'bestPlayer' | 'goldenBoots' | 'topScorer' | 'puskas' | 'goldenGloves' | 'awards'> {
  const sum = (ids: readonly AwardId[] | undefined) => (ids ?? []).reduce((s, a) => s + count(a), 0)
  return {
    ballonDor: sum(CATEGORIES.ballonDor.awards),
    bestPlayer: sum(CATEGORIES.bestPlayer.awards),
    goldenBoots: sum(CATEGORIES.goldenBoots.awards),
    topScorer: sum(CATEGORIES.topScorer.awards),
    puskas: sum(CATEGORIES.puskas.awards),
    goldenGloves: sum(CATEGORIES.goldenGloves.awards),
    awards: sum(HALL_AWARDS),
  }
}

export function positionGroupOf(position: string): PositionGroup {
  if (position === 'GOL') return 'goalkeeper'
  if (position === 'ZAG' || position === 'LD' || position === 'LE' || position === 'VOL') return 'defensive'
  if (position === 'MC' || position === 'ME' || position === 'MD' || position === 'MEI') return 'support'
  return 'attacking'
}

/** "3 Bolas de Ouro", "1 Copa do Mundo", "0,82 gol por jogo" (pt-BR). */
export function formatCategoryValue(id: CategoryId, v: number, opts: { approx?: boolean; unit?: boolean } = {}): string {
  const m = CATEGORIES[id]
  const num = m.ratio ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(v).toLocaleString('pt-BR')
  const pre = opts.approx ? '≈' : ''
  if (opts.unit === false) return pre + num
  if (m.ratio) return `${pre}${num} ${v >= 1.995 ? m.many : m.one}`
  return `${pre}${num} ${Math.round(v) === 1 ? m.one : m.many}`
}
