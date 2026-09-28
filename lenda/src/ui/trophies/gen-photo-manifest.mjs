#!/usr/bin/env node
/**
 * Regenera ./photo-manifest.ts a partir de public/trophies/*.webp e gera as variantes leves
 * public/trophies/h160/<id>.webp e h320/<id>.webp (usadas via srcset: um ícone de 40 px não
 * precisa baixar o recorte de 720 px).
 *
 *   node src/ui/trophies/gen-photo-manifest.mjs
 *
 * Rode sempre que adicionar/remover/editar um recorte em public/trophies/ (o <TrophyArt> só tenta
 * a foto de ids listados no manifesto, então nenhum 404 chega ao navegador).
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, '../../../public/trophies')
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.webp'))
  .sort()

/** Alturas das variantes reduzidas (a original tem 720 px). */
const VARIANTS = [160, 320]
for (const h of VARIANTS) mkdirSync(join(dir, `h${h}`), { recursive: true })

const rows = []
for (const f of files) {
  const { width, height } = await sharp(join(dir, f)).metadata()
  rows.push([f.slice(0, -5), +(width / height).toFixed(4)])
  for (const h of VARIANTS) {
    await sharp(join(dir, f))
      .resize({ height: h, kernel: 'lanczos3' })
      .webp({ quality: h <= 160 ? 80 : 84, alphaQuality: 90, effort: 6, smartSubsample: true })
      .toFile(join(dir, `h${h}`, f))
  }
}

const out = `/**
 * GERADO por gen-photo-manifest.mjs — não edite à mão.
 * Recortes fotográficos reais disponíveis em public/trophies/<id>.webp (720 px de altura, WebP com alfa),
 * mais as variantes reduzidas h160/ e h320/. Fontes e licenças: docs/CREDITOS.md.
 */
/** Alturas das variantes reduzidas em public/trophies/h<altura>/<id>.webp (a original tem 720 px). */
export const TROPHY_PHOTO_VARIANTS: readonly number[] = [${VARIANTS.join(', ')}]

export const TROPHY_PHOTO_IDS: readonly string[] = [
${rows.map(([id]) => `  '${id}',`).join('\n')}
]

/** Proporção largura/altura de cada recorte (reserva a largura antes de a imagem carregar). */
export const TROPHY_PHOTO_ASPECT: Readonly<Record<string, number>> = {
${rows.map(([id, r]) => `  '${id}': ${r},`).join('\n')}
}
`
writeFileSync(join(here, 'photo-manifest.ts'), out)
console.log(`photo-manifest.ts: ${rows.length} ids (+ variantes ${VARIANTS.map((h) => `h${h}`).join(', ')})`)
