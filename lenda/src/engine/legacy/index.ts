/**
 * Hall das Lendas — motor de legado (puro, sem React/GameData).
 *
 *   const hall = evaluateHall(entries.map(hallEntryToRun))   // runs + lendas + rankings
 *   hall.overall[0]                                          // #1 geral (run ou lenda)
 *   hall.categories.libertadores.slice(0, 3)                 // pódio da categoria
 *   compareRun(hall.runs[2])                                 // "Sua carreira nº 3 tem mais Libertadores que Pelé (2)."
 *   placeRun(liveCareer, previousRuns)                       // nota/posição de uma carreira recém-encerrada
 *   hall.overall[i].tieBreak                                 // por que empatou e quem levou (OVERALL_TIEBREAK)
 *
 * Pesos da Nota de Legado: ver ./score.ts. Categorias e grupos: ./categories.ts. Desempates: ./evaluate.ts.
 */
export * from './categories'
export * from './stats'
export * from './score'
export * from './legends'
export * from './records'
export * from './evaluate'
export {
  REAL_LEGENDS,
  LEGEND_BY_ID,
  LEGENDS_AS_OF,
  LEGENDS_CHECKED_AT,
  legendTotalTitles,
  type Legend,
  type LegendClub,
  type LegendField,
  type LegendHonour,
  type LegendAward,
  type LegendAwardKey,
  type HonourKind,
} from '../../data/catalog/legends'
