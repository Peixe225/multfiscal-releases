/**
 * Textos das abas: sedes com "e" (os dados trazem "ITA,TUR" ou "CAN/MEX/USA"), placares no mesmo
 * estilo e a temporada fixada à mão que cai quando uma temporada nova é simulada.
 */
import { describe, expect, it } from 'vitest'
import { hostNames, joinPt, pinnedSeason, scoreStyle } from './model'

const NAMES: Record<string, string> = { ITA: 'Itália', TUR: 'Turquia', ESP: 'Espanha', POR: 'Portugal', MAR: 'Marrocos', QAT: 'Catar' }
const name = (c: string) => NAMES[c] ?? c

describe('hostNames', () => {
  it('uma sede, duas com "e", várias com vírgulas', () => {
    expect(hostNames('QAT', name)).toBe('Catar')
    expect(hostNames('ITA,TUR', name)).toBe('Itália e Turquia')
    expect(hostNames('ESP/POR/MAR', name)).toBe('Espanha, Portugal e Marrocos')
    expect(hostNames('ESP, POR', name)).toBe('Espanha e Portugal')
  })
  it('sem sede', () => {
    expect(hostNames(undefined, name)).toBeUndefined()
    expect(hostNames('', name)).toBeUndefined()
  })
})

describe('joinPt', () => {
  it('junta listas em português', () => {
    expect(joinPt([])).toBe('')
    expect(joinPt(['Brasil'])).toBe('Brasil')
    expect(joinPt(['Brasil', 'Argentina', 'Uruguai'])).toBe('Brasil, Argentina e Uruguai')
  })
})

describe('scoreStyle', () => {
  it('placar real no estilo dos simulados', () => {
    expect(scoreStyle('3–3 (4–2 pên.)')).toBe('3×3 (4×2 pên.)')
    expect(scoreStyle('2–1 (prorr.)')).toBe('2×1 (prorr.)')
    expect(scoreStyle('1×0')).toBe('1×0')
  })
})

describe('pinnedSeason', () => {
  it('só vale enquanto a última temporada é a mesma de quando foi fixada', () => {
    expect(pinnedSeason({ pinned: true, season: 2030, latest: 2032 }, 2032)).toBe(2030)
    expect(pinnedSeason({ pinned: true, season: 2030, latest: 2032 }, 2035)).toBeNull()
    expect(pinnedSeason({ pinned: false, season: 2032, latest: 2032 }, 2032)).toBeNull()
  })
})
