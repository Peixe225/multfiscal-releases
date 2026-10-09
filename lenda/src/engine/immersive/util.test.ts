/** Artigos de seleções e clubes (pt-BR) e a fase do jogo na narração de abertura. */
import { describe, expect, it } from 'vitest'
import { hasRealData, realData } from './__fixtures__/helpers'
import { stagePhrase } from './match'
import { fill } from './narration'
import { artigo, countryArt, deCountry, hasCountryArt, withArt } from './util'

describe('imersivo · artigos', () => {
  it('seleções: feminino, sem artigo e plural', () => {
    expect(deCountry('África do Sul')).toBe('da África do Sul')
    expect(deCountry('Etiópia')).toBe('da Etiópia')
    expect(deCountry('Guiné-Bissau')).toBe('da Guiné-Bissau')
    expect(deCountry('Aruba')).toBe('de Aruba')
    expect(deCountry('São Cristóvão e Névis')).toBe('de São Cristóvão e Névis')
    expect(deCountry('El Salvador')).toBe('de El Salvador')
    expect(deCountry('Portugal')).toBe('de Portugal')
    expect(deCountry('Bermudas')).toBe('das Bermudas')
    expect(deCountry('Ilhas Faroé')).toBe('das Ilhas Faroé')
    expect(deCountry('Estados Unidos')).toBe('dos Estados Unidos')
    expect(deCountry('Brasil')).toBe('do Brasil')
    expect(deCountry('País de Gales')).toBe('do País de Gales')
    expect(countryArt('Argentina')).toBe('a')
    expect(countryArt('Japão')).toBe('o')
  })

  it.skipIf(!hasRealData)('todas as seleções do jogo estão na tabela explícita', () => {
    const missing = realData().countries.filter((c) => !hasCountryArt(c.name)).map((c) => c.name)
    expect(missing).toEqual([])
  })

  it.skipIf(!hasRealData)('clubes: o mesmo artigo do Clássico ("da Cremonese", "da Juve Stabia")', () => {
    const data = realData()
    const by = (n: string) => data.clubs.find((c) => c.shortName === n || c.name === n)
    for (const n of ['Cremonese', 'Juve Stabia', 'Carrarese', 'Ponte Preta', 'Juventus']) if (by(n)) expect(artigo(by(n))).toBe('a')
    for (const n of ['Flamengo', 'Internacional', 'Napoli']) if (by(n)) expect(artigo(by(n))).toBe('o')
    const rsa = data.countries.find((c) => c.name === 'África do Sul')
    if (rsa) expect(withArt(data, rsa.code)).toBe('a África do Sul')
  })
})

describe('imersivo · narração', () => {
  it('nome abreviado com ponto não dobra a pontuação', () => {
    expect(fill('Gol do {t}. {p} marca.', { t: 'Argentino Q.', p: 'Figueroa' })).toBe('Gol do Argentino Q. Figueroa marca.')
    expect(fill('Que lance…', {})).toBe('Que lance…')
  })

  it('fase do jogo no fim da frase de abertura', () => {
    expect(stagePhrase('31ª rodada')).toBe(' pela 31ª rodada')
    expect(stagePhrase('Apertura · 5ª rodada')).toBe(' pela 5ª rodada do Apertura')
    expect(stagePhrase('Quartas de final · ida')).toBe(' na ida das quartas de final')
    expect(stagePhrase('Semifinal')).toBe(' na semifinal')
    expect(stagePhrase('Final')).toBe(' na grande final')
    expect(stagePhrase('Clausura — Final')).toBe(' na grande final do Clausura')
    expect(stagePhrase('Amistoso internacional')).toBe(' em amistoso internacional')
    expect(stagePhrase('Fase de grupos')).toBe('')
    expect(stagePhrase(undefined)).toBe('')
  })
})
