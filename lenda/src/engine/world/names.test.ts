import { describe, expect, it } from 'vitest'
import { Rng } from '../rng'
import { NAMED_NATIONALITIES, randomName } from './names'

const PARTICLES = new Set(['de', 'De', 'van', 'Van', 'den', 'der', 'El', 'da', 'dos', 'del', 'Del', 'di', 'Di'])

describe('gerador de nomes', () => {
  it('sobrenome composto fica inteiro: nada de "Mats de" ou "Francesco De"', () => {
    const rng = new Rng('nomes')
    for (const nat of [...NAMED_NATIONALITIES, 'INT', 'SUR']) {
      for (let i = 0; i < 400; i++) {
        const { name, shortName } = randomName(nat, rng)
        const parts = name.split(' ')
        expect(PARTICLES.has(parts[parts.length - 1]), `${nat}: ${name}`).toBe(false)
        expect(PARTICLES.has(shortName), `${nat}: ${shortName}`).toBe(false)
      }
    }
  })

  it('o nome curto leva o sobrenome composto inteiro, com maiúscula', () => {
    const rng = new Rng('nomes-ned')
    const seen = new Map<string, string>()
    for (let i = 0; i < 2000; i++) {
      const n = randomName('NED', rng)
      seen.set(n.name, n.shortName)
    }
    const vanDijk = [...seen].find(([name]) => name.endsWith(' van Dijk'))
    expect(vanDijk?.[1]).toBe('Van Dijk')
    const deLuca = [...Array(2000)].map(() => randomName('ITA', rng)).find((n) => n.name.endsWith(' De Luca'))
    expect(deLuca?.shortName).toBe('De Luca')
  })
})
