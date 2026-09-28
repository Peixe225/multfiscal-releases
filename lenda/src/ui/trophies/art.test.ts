/**
 * Arte de troféus: o catálogo aponta cada troféu para a SUA arte, os dados gerados estão em
 * sincronia com o catálogo e ids "crus" (League/Competition.trophyId) resolvem pela família.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TROPHIES } from '@/data/catalog/trophies'
import { TROPHY_PHOTO_IDS, TROPHY_PHOTO_VARIANTS } from './photo-manifest'
import { TROPHY_ART_IDS, hasTrophyArt, hasTrophyPhoto, trophyArtKey, trophySvgKey } from './index'

const root = join(__dirname, '../../..')
const svgFile = (id: string) => existsSync(join(root, 'src/ui/trophies/svg', `${id}.svg`))
const photoFile = (id: string) => existsSync(join(root, 'public/trophies', `${id}.webp`))
const GENERIC = new Set(['cup-generic', 'league-generic', 'estadual', 'award-generic'])

describe('catálogo de troféus × arte', () => {
  it('todo troféu com SVG ou foto própria usa a própria arte', () => {
    const wrong = TROPHIES.filter((t) => (svgFile(t.id) || photoFile(t.id)) && t.art !== t.id).map((t) => `${t.id} → ${t.art}`)
    expect(wrong).toEqual([])
  })

  it('nenhum troféu aponta para a arte de outro troféu real, nem para arte inexistente', () => {
    const bad = TROPHIES.filter((t) => t.art && t.art !== t.id && !GENERIC.has(t.art)).map((t) => `${t.id} → ${t.art}`)
    expect(bad).toEqual([])
    const missing = TROPHIES.filter((t) => t.art && !svgFile(t.art) && !photoFile(t.art)).map((t) => `${t.id} → ${t.art}`)
    expect(missing).toEqual([])
  })

  it('o componente enxerga os mesmos arquivos (glob de SVG e manifesto de fotos)', () => {
    for (const t of TROPHIES) {
      expect(hasTrophyArt(t.id), t.id).toBe(svgFile(t.id))
      expect(hasTrophyPhoto(t.id), t.id).toBe(photoFile(t.id))
    }
    expect(TROPHY_ART_IDS.length).toBeGreaterThan(50)
  })

  it('game-data.json traz as mesmas chaves de arte do catálogo', () => {
    const data = JSON.parse(readFileSync(join(root, 'src/data/generated/game-data.json'), 'utf8')) as { trophies: { id: string; art?: string }[] }
    const gen = new Map(data.trophies.map((t) => [t.id, t.art]))
    const drift = TROPHIES.filter((t) => gen.get(t.id) !== t.art).map((t) => `${t.id}: ${gen.get(t.id)} ≠ ${t.art}`)
    expect(drift).toEqual([])
  })

  it('cada foto tem as variantes leves (h160/h320)', () => {
    for (const id of TROPHY_PHOTO_IDS) {
      for (const h of TROPHY_PHOTO_VARIANTS) expect(existsSync(join(root, `public/trophies/h${h}/${id}.webp`)), `${id}@${h}`).toBe(true)
    }
  })
})

describe('resolução de ids crus', () => {
  const resolved = (id: string) => trophySvgKey(trophyArtKey(id))

  it('troféu com arte própria resolve para ele mesmo', () => {
    for (const t of TROPHIES) if (svgFile(t.id)) expect(resolved(t.id), t.id).toBe(t.id)
  })

  it('sem arte própria segue a art/família do catálogo (estadual não vira taça de liga)', () => {
    expect(resolved('goiano')).toBe('estadual')
    expect(resolved('paulista')).toBe('estadual')
    expect(resolved('scottish-cup')).toBe('cup-generic')
    expect(resolved('copa-chile')).toBe('cup-generic')
    expect(resolved('eliteserien')).toBe('league-generic')
    for (const t of TROPHIES) {
      if (svgFile(t.id) || photoFile(t.id)) continue
      expect(resolved(t.id), t.id).toBe(t.art)
    }
  })

  it('id desconhecido cai numa taça neutra; família explícita manda', () => {
    expect(resolved('generic')).toBe('cup-generic')
    expect(trophySvgKey('xyz', 'league')).toBe('league-generic')
    expect(trophySvgKey('xyz', 'award')).toBe('award-generic')
  })

  it('arte genérica de dados antigos + Trophy com id → arte própria', () => {
    expect(trophyArtKey('cup-generic', { id: 'knvb-beker' })).toBe('knvb-beker')
    expect(trophyArtKey('golden-boot', { id: 'league-top-scorer' })).toBe('golden-boot')
    expect(trophyArtKey('cup-generic', { id: 'belgian-cup' })).toBe('cup-generic')
  })
})
