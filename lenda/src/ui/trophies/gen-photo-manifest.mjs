#!/usr/bin/env node
/**
 * Regenera ./photo-manifest.ts a partir de public/trophies/*.webp.
 *
 *   node src/ui/trophies/gen-photo-manifest.mjs
 *
 * Rode sempre que adicionar/remover um recorte em public/trophies/ (o <TrophyArt> só tenta a
 * foto de ids listados no manifesto, então nenhum 404 chega ao navegador).
 */
import { readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, '../../../public/trophies')
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.webp'))
  .sort()

const rows = []
for (const f of files) {
  const { width, height } = await sharp(join(dir, f)).metadata()
  rows.push([f.slice(0, -5), +(width / height).toFixed(4)])
}

const out = `/**
 * GERADO por gen-photo-manifest.mjs — não edite à mão.
 * Recortes fotográficos reais disponíveis em public/trophies/<id>.webp (720 px de altura, WebP com alfa).
 * Fontes e licenças: docs/CREDITOS.md.
 */
export const TROPHY_PHOTO_IDS: readonly string[] = [
${rows.map(([id]) => `  '${id}',`).join('\n')}
]

/** Proporção largura/altura de cada recorte (reserva a largura antes de a imagem carregar). */
export const TROPHY_PHOTO_ASPECT: Readonly<Record<string, number>> = {
${rows.map(([id, r]) => `  '${id}': ${r},`).join('\n')}
}
`
writeFileSync(join(here, 'photo-manifest.ts'), out)
console.log(`photo-manifest.ts: ${rows.length} ids`)
