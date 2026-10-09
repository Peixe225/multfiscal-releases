/** Textos da celebração com vários títulos: taças repetidas agrupadas, anos em ordem, artigo do clube. */
import { describe, expect, it } from 'vitest'
import type { SeasonRecord } from '@/engine/types'
import { celebrationHeadline, celebrationKicker, celebrationPill, groupCelebration, multiSubtitle, type CelebrationItem } from './items'

const rec = (season: number) => ({ season }) as SeasonRecord
const trophy = (name: string, family: CelebrationItem['family'], season: number, year: string, teamName = 'Real Madrid'): CelebrationItem => ({
  key: `${name}:${season}`,
  kind: 'trophy',
  art: name,
  name,
  family,
  season,
  year,
  scope: 'club',
  minor: false,
  kicker: '',
  subtitle: '',
  teamName,
  record: rec(season),
})
const award = (name: string, year: number): CelebrationItem => ({
  key: `${name}:${year}`,
  kind: 'award',
  art: name,
  name,
  family: 'award',
  season: year - 1,
  year: String(year),
  scope: 'award',
  minor: false,
  kicker: '',
  subtitle: '',
})

describe('celebração com vários títulos', () => {
  const laLiga = [trophy('LaLiga', 'league', 2040, '2040/41'), trophy('LaLiga', 'league', 2038, '2038/39'), trophy('LaLiga', 'league', 2039, '2039/40')]

  it('agrupa a mesma taça e põe os anos em ordem cronológica', () => {
    const g = groupCelebration([...laLiga, trophy('Supercopa da UEFA', 'continental_secondary', 2039, '2039/40')])
    expect(g).toHaveLength(2)
    expect(g[0]).toMatchObject({ name: 'LaLiga', count: 3, years: ['2038/39', '2039/40', '2040/41'] })
    expect(g[1]).toMatchObject({ name: 'Supercopa da UEFA', count: 1 })
  })

  it('subtítulo com ×N, artigo do clube e o número de temporadas', () => {
    expect(multiSubtitle([...laLiga, trophy('Liga dos Campeões da UEFA', 'continental_primary', 2039, '2039/40')])).toBe(
      'LaLiga ×3 e Liga dos Campeões da UEFA — com o Real Madrid em 3 temporadas.',
    )
    const dortmund = [trophy('Bundesliga', 'league', 2040, '2040/41', 'Borussia Dortmund'), trophy('Copa da Alemanha', 'domestic_cup', 2040, '2040/41', 'Borussia Dortmund')]
    expect(multiSubtitle(dortmund)).toBe('Bundesliga e Copa da Alemanha — com o Borussia Dortmund.')
    expect(multiSubtitle([trophy('Copa da Itália', 'domestic_cup', 2030, '2030/31', 'Roma'), trophy('Serie A', 'league', 2030, '2030/31', 'Roma')])).toContain('com a Roma.')
  })

  it('selo conta títulos e prêmios separados (nada de "PRÊMIO INDIVIDUAL" num pacote de taças)', () => {
    const mixed = [...laLiga, award('Bola de Ouro', 2040), award('The Best FIFA', 2041)]
    expect(celebrationPill(mixed, 12)).toBe('+3 TÍTULOS · +2 PRÊMIOS')
    expect(celebrationPill(laLiga, 7)).toBe('+3 TÍTULOS · 7 NA CARREIRA')
    expect(celebrationPill([laLiga[0]], 4)).toBe('4º TÍTULO DA CARREIRA')
    expect(celebrationPill([award('Bola de Ouro', 2040)])).toBe('PRÊMIO INDIVIDUAL')
  })

  it('kicker: "conquistas" quando há prêmios; várias temporadas viram "em N temporadas"', () => {
    const mixed = [...laLiga, award('Bola de Ouro', 2040), trophy('Copa América', 'national_continental', 2040, '2041')]
    expect(celebrationKicker(mixed)).toBe('5 CONQUISTAS EM 3 TEMPORADAS')
    expect(celebrationKicker(laLiga)).toBe('3 TÍTULOS · 2038/39 · 2039/40 · 2040/41')
  })

  it('manchete: dobradinha só na mesma temporada; vários anos de taças e prêmios são "anos de ouro"', () => {
    expect(celebrationHeadline([trophy('LaLiga', 'league', 2040, '2040/41'), trophy('Copa do Rei', 'domestic_cup', 2040, '2040/41')])).toBe('Dobradinha')
    expect(celebrationHeadline([trophy('LaLiga', 'league', 2039, '2039/40'), trophy('Copa do Rei', 'domestic_cup', 2040, '2040/41')])).toBe('Duas taças')
    expect(celebrationHeadline([...laLiga, award('Bola de Ouro', 2040)])).toBe('Anos de ouro')
  })
})
