/** Nome da seleção: adjetivo para as mais comuns, senão "Seleção do/da/de {país}" com o artigo certo. */
import { describe, expect, it } from 'vitest'
import { nationalTeamName } from './model'

describe('nationalTeamName', () => {
  it('adjetivo pátrio quando existe', () => {
    expect(nationalTeamName('Brasil')).toBe('Seleção Brasileira')
    expect(nationalTeamName('Portugal')).toBe('Seleção Portuguesa')
    expect(nationalTeamName('Estados Unidos')).toBe('Seleção dos EUA')
  })
  it('artigo do país no resto (nunca "Seleção de Equador")', () => {
    expect(nationalTeamName('Equador')).toBe('Seleção do Equador')
    expect(nationalTeamName('Peru')).toBe('Seleção do Peru')
    expect(nationalTeamName('Croácia')).toBe('Seleção da Croácia')
    expect(nationalTeamName('Angola')).toBe('Seleção de Angola')
  })
})
