/**
 * As 11 categorias do Hall das Lendas (ranking, pódios e Nota de Legado).
 * Pura: sem React, sem GameData.
 */
import type { PositionGroup } from '../types'

export type CategoryId =
  | 'ballonDor'
  | 'worldCups'
  | 'goldenBoots'
  | 'ucl'
  | 'libertadores'
  | 'leagueTitles'
  | 'clubs'
  | 'goals'
  | 'assists'
  | 'records'
  | 'goalsPerGame'

export const CATEGORY_IDS: readonly CategoryId[] = ['ballonDor', 'worldCups', 'goldenBoots', 'ucl', 'libertadores', 'leagueTitles', 'clubs', 'goals', 'assists', 'records', 'goalsPerGame']

export type CategoryValues = Record<CategoryId, number>

export interface CategoryMeta {
  id: CategoryId
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
}

export const CATEGORIES: Record<CategoryId, CategoryMeta> = {
  ballonDor: { id: 'ballonDor', label: 'Bolas de Ouro', short: 'Bolas', one: 'Bola de Ouro', many: 'Bolas de Ouro', more: 'tem mais Bolas de Ouro que', art: 'ballon-dor', icon: 'circle-dot' },
  worldCups: { id: 'worldCups', label: 'Copas do Mundo', short: 'Copas', one: 'Copa do Mundo', many: 'Copas do Mundo', more: 'tem mais Copas do Mundo que', art: 'world-cup', icon: 'globe' },
  goldenBoots: { id: 'goldenBoots', label: 'Chuteiras de Ouro', short: 'Chuteiras', one: 'Chuteira de Ouro', many: 'Chuteiras de Ouro', more: 'tem mais Chuteiras de Ouro que', art: 'golden-boot', icon: 'footprints' },
  ucl: { id: 'ucl', label: 'Champions League', short: 'Champions', one: 'Champions', many: 'Champions', more: 'tem mais Champions que', art: 'champions-league', icon: 'star' },
  libertadores: { id: 'libertadores', label: 'Libertadores', short: 'Liberta', one: 'Libertadores', many: 'Libertadores', more: 'tem mais Libertadores que', art: 'libertadores', icon: 'trophy' },
  leagueTitles: { id: 'leagueTitles', label: 'Títulos nacionais', short: 'Ligas', one: 'título nacional', many: 'títulos nacionais', more: 'tem mais títulos nacionais que', art: 'brasileirao', icon: 'medal' },
  clubs: { id: 'clubs', label: 'Clubes', short: 'Clubes', one: 'clube', many: 'clubes', more: 'jogou em mais clubes que', icon: 'shirt' },
  goals: { id: 'goals', label: 'Gols', short: 'Gols', one: 'gol', many: 'gols', more: 'tem mais gols que', icon: 'goal' },
  assists: { id: 'assists', label: 'Assistências', short: 'Assist.', one: 'assistência', many: 'assistências', more: 'tem mais assistências que', icon: 'hand-helping' },
  records: { id: 'records', label: 'Recordes', short: 'Recordes', one: 'recorde', many: 'recordes', more: 'quebrou mais recordes que', icon: 'zap' },
  goalsPerGame: { id: 'goalsPerGame', label: 'Média de gols', short: 'Média', one: 'gol por jogo', many: 'gols por jogo', more: 'tem média de gols maior que', icon: 'target', ratio: true, minApps: 300 },
}

export const emptyValues = (): CategoryValues => ({ ballonDor: 0, worldCups: 0, goldenBoots: 0, ucl: 0, libertadores: 0, leagueTitles: 0, clubs: 0, goals: 0, assists: 0, records: 0, goalsPerGame: 0 })

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
