/**
 * Toda chave de arte de evento/opção do catálogo (`${eventKey}-${optionKey}`) tem foto, e toda foto
 * referenciada existe em public/photos e tem crédito.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PHOTOS, PHOTO_CREDITS, photoFor, themeFor, themeFromText } from './photos'

const root = fileURLToPath(new URL('../../../', import.meta.url))

/** Chaves de arte do catálogo, lidas do código (choice/clubJoin/clubStay/exitOption e a lesão). */
function catalogArtKeys(): string[] {
  const src = readFileSync(`${root}src/engine/career/events/catalog.ts`, 'utf8')
  const keys = new Set<string>()
  for (const b of src.split(/\n    key: '/).slice(1)) {
    const ev = b.slice(0, b.indexOf("'"))
    for (const m of b.matchAll(/(?:choice|clubJoin|clubStay)\(\s*(?:env,\s*)?k,\s*'([a-z_]+)'/g)) keys.add(`${ev}-${m[1]}`)
    if (/exitOption\(env, k/.test(b)) keys.add(`${ev}-join`)
    if (/choice\(\s*k,\s*s\.key/.test(b)) for (const m of b.matchAll(/\{ key: '([a-z_]+)', label:/g)) keys.add(`${ev}-${m[1]}`)
  }
  for (const m of src.matchAll(/choice\('([a-z_]+)',\s*'([a-z_]+)'/g)) keys.add(`${m[1]}-${m[2]}`)
  return [...keys].sort()
}

describe('fotos de eventos', () => {
  it('toda opção do catálogo tem foto', () => {
    const keys = catalogArtKeys()
    expect(keys.length).toBeGreaterThan(60)
    expect(keys.filter((k) => !themeFor(k))).toEqual([])
  })

  it('chaves avulsas (aposentadoria, tipos de decisão) também', () => {
    for (const k of ['retirement', 'academy', 'transfer', 'loan', 'loan_return', 'non_renewal', 'national_call', 'injury-continue']) expect(themeFor(k), k).not.toBeNull()
  })

  it('mini-eventos do Imersivo (`mini-${evento}-${opção}`) também', () => {
    const src = readFileSync(`${root}src/engine/immersive/events.ts`, 'utf8')
    const block = src.slice(src.indexOf('const MINI'), src.indexOf('function miniDecision'))
    const keys: string[] = []
    for (const b of block.split(/\n    key: '/).slice(1)) {
      const ev = b.slice(0, b.indexOf("'"))
      for (const m of b.matchAll(/\{ id: '([a-z_]+)'/g)) keys.push(`mini-${ev}-${m[1]}`)
    }
    expect(keys.length).toBeGreaterThan(30)
    expect(keys.filter((k) => !themeFor(k))).toEqual([])
  })

  it('opções vizinhas do mesmo tema não repetem a foto (slot)', () => {
    const a = photoFor('mini-discussao-desculpas', { salt: 'd1', slot: 0 })
    const b = photoFor('mini-discussao-frente', { salt: 'd1', slot: 1 })
    expect(a).toBeTruthy()
    expect(a).not.toBe(b)
  })

  it('tema pelo texto sem falsos positivos de pedaço de palavra', () => {
    expect(themeFromText('Alguém do clube quer um favor.')).toBeNull()
    expect(themeFromText('Uma proposta do Estudiantes na Série B')).toBeNull()
    expect(themeFromText('Oferta do Estudiantes na Série B')).toBe('money')
    expect(themeFromText('Fase ruim do atacante')).toBeNull()
    expect(themeFromText('Seu avô era italiano')).toBe('national')
    expect(themeFromText('Post antigo viraliza')).toBe('phone')
    expect(themeFromText('Final da Copa')).toBe('celebration')
  })

  it('arquivos existem e têm crédito', () => {
    const files = new Set([...Object.values(PHOTOS).flat(), 'national-3.webp'])
    for (const f of files) {
      expect(existsSync(`${root}public/photos/${f}`), f).toBe(true)
      expect(PHOTO_CREDITS[f], f).toBeTruthy()
    }
  })
})
