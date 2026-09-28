import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCredits } from './parse'
import { PHOTO_CREDITS } from '@/ui/art/photos'
import { TROPHY_PHOTO_IDS } from '@/ui/trophies/photo-manifest'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const md = readFileSync(`${root}docs/CREDITOS.md`, 'utf8')

describe('créditos (docs/CREDITOS.md)', () => {
  const c = parseCredits(md)

  it('credita todo recorte de troféu que o jogo usa', () => {
    const files = c.trophies.map((t) => t.file)
    for (const id of TROPHY_PHOTO_IDS) expect(files).toContain(`${id}.webp`)
    for (const t of c.trophies) {
      expect(existsSync(`${root}public/trophies/${t.file}`)).toBe(true)
      expect(t.author).not.toBe('')
      expect(t.license).not.toBe('')
      expect(t.url).toMatch(/^https:\/\/commons\.wikimedia\.org\//)
    }
  })

  it('lê licença com link e notas', () => {
    const wc = c.trophies.find((t) => t.file === 'world-cup.webp')!
    expect(wc.author).toBe('Djuradj Vujcic')
    expect(wc.license).toBe('CC BY 2.0')
    expect(wc.licenseUrl).toMatch(/creativecommons\.org/)
    const gb = c.trophies.find((t) => t.file === 'golden-boot.webp')!
    expect(gb.url?.endsWith('.jpg')).toBe(true) // url com parênteses
  })

  it('bate as fotos de eventos com PHOTO_CREDITS', () => {
    const byFile = new Map(c.photos.map((p) => [p.file, p]))
    for (const [file, cr] of Object.entries(PHOTO_CREDITS)) {
      expect(byFile.get(file)?.author).toBe(cr.author)
      expect(byFile.get(file)?.unsplashId).toBe(cr.unsplashId)
    }
  })
})
