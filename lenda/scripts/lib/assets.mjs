// Escudos (atlas webp por liga), logos de ligas/competições e bandeiras.
import sharp from 'sharp'
import { mkdir, copyFile, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { getBuffer, getJson, pmap } from './http.mjs'
import { r, hex, colorDist, rgbOf } from './util.mjs'

export const CREST_SIZE = 128
export const ATLAS_COLS = 8
const INNER = 116 // escudo dentro da célula (margem para não encostar)

const crestUrl = (id, dark) =>
  `https://a.espncdn.com/combiner/i?img=/i/teamlogos/soccer/${dark ? '500-dark' : '500'}/${id}.png&w=${CREST_SIZE * 2}&h=${CREST_SIZE * 2}`

/** Baixa o escudo (prefere a variante 500-dark, feita para fundo escuro). */
export async function fetchCrest(espnId, { hasLogo = true } = {}) {
  if (!hasLogo || !espnId) return null
  for (const dark of [true, false]) {
    const buf = await getBuffer(crestUrl(espnId, dark), { group: 'crests', ext: '.png' })
    if (buf && buf.length > 200) {
      try {
        const meta = await sharp(buf).metadata()
        if (meta.width >= 16) return { buf, dark }
      } catch {}
    }
  }
  return null
}

/** Cores dominantes (opacas) de uma imagem: [principal, secundária]. */
export async function dominantColors(buf) {
  const { data, info } = await sharp(buf).resize(48, 48, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const count = new Map()
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 200) continue
    const q = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
    count.set(q, (count.get(q) || 0) + 1)
  }
  const cols = [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([q]) => {
      const c = (v) => ((v << 4) | 8).toString(16).padStart(2, '0')
      return hex(c((q >> 8) & 15) + c((q >> 4) & 15) + c(q & 15))
    })
  if (!cols.length) return null
  const primary = cols[0]
  const secondary = cols.find((c) => colorDist(c, primary) > 90) || (lum(primary) > 0.5 ? '#111111' : '#FFFFFF')
  // prefere uma cor "de verdade" como principal quando a mais frequente é branco/preto e há uma cor forte
  const chroma = (h) => {
    const [a, b, c] = rgbOf(h)
    return Math.max(a, b, c) - Math.min(a, b, c)
  }
  if (chroma(primary) < 30 && chroma(secondary) > 80) return [secondary, primary]
  return [primary, secondary]
}

function lum(h) {
  const [a, b, c] = rgbOf(h).map((v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * a + 0.7152 * b + 0.0722 * c
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])

/** Escudo gerado: brasão arredondado nas cores do clube com a sigla. */
export async function generatedBadge(abbr, primary, secondary) {
  const p = hex(primary) || '#3A3F4B'
  let s = hex(secondary) || '#FFFFFF'
  if (colorDist(p, s) < 60) s = lum(p) > 0.5 ? '#111111' : '#FFFFFF'
  const ink = lum(p) > 0.45 ? '#111111' : '#FFFFFF'
  const text = esc(String(abbr || '?').slice(0, 4).toUpperCase())
  const fs = text.length >= 4 ? 30 : text.length === 3 ? 36 : 44
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs><clipPath id="c"><path d="M64 8 L112 22 V60 C112 90 92 110 64 120 C36 110 16 90 16 60 V22 Z"/></clipPath></defs>
  <path d="M64 8 L112 22 V60 C112 90 92 110 64 120 C36 110 16 90 16 60 V22 Z" fill="${p}"/>
  <g clip-path="url(#c)"><rect x="0" y="92" width="128" height="10" fill="${s}"/></g>
  <path d="M64 8 L112 22 V60 C112 90 92 110 64 120 C36 110 16 90 16 60 V22 Z" fill="none" stroke="${s}" stroke-width="6" stroke-linejoin="round"/>
  <text x="64" y="${62 + fs * 0.36}" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-weight="700" font-size="${fs}" text-anchor="middle" fill="${ink}">${text}</text>
</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** Normaliza um escudo para uma célula CREST_SIZE×CREST_SIZE transparente. */
async function cell(buf) {
  const img = await sharp(buf)
    .ensureAlpha()
    .trim({ threshold: 1 })
    .resize(INNER, INNER, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer()
    .catch(() => sharp(buf).ensureAlpha().resize(INNER, INNER, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer())
  const pad = (CREST_SIZE - INNER) / 2
  return sharp(img)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}

/** Monta um atlas (grade de ATLAS_COLS colunas) e grava em public/crests/<file>. */
export async function writeAtlas(file, images) {
  const rows = Math.max(1, Math.ceil(images.length / ATLAS_COLS))
  const cells = await pmap(images, (b) => cell(b), 8)
  const composite = cells.map((input, i) => ({ input, left: (i % ATLAS_COLS) * CREST_SIZE, top: Math.floor(i / ATLAS_COLS) * CREST_SIZE }))
  const out = r('public', 'crests', file)
  await mkdir(path.dirname(out), { recursive: true })
  await sharp({ create: { width: ATLAS_COLS * CREST_SIZE, height: rows * CREST_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composite)
    .webp({ quality: 86, alphaQuality: 90, effort: 5, smartSubsample: true })
    .toFile(out)
  return (await stat(out)).size
}

/** Logo de liga/competição (prefere a variante dark). Retorna o caminho público ou undefined. */
export async function writeLeagueLogo(slug) {
  const meta = await getJson(`https://sports.core.api.espn.com/v2/sports/soccer/leagues/${slug}`, { group: 'espn-meta' })
  const logos = (meta?.logos || []).filter((l) => l.href && !/default-team-logo/.test(l.href))
  if (!logos.length) return undefined
  const dark = logos.find((l) => (l.rel || []).includes('dark'))
  const pick = dark || logos[0]
  const pathPart = new URL(pick.href).pathname
  const url = `https://a.espncdn.com/combiner/i?img=${pathPart}&w=256&h=256`
  let buf = await getBuffer(url, { group: 'logos', ext: '.png' })
  if (!buf) buf = await getBuffer(pick.href, { group: 'logos', ext: '.png' })
  if (!buf) return undefined
  const out = r('public', 'leagues', `${slug}.webp`)
  await mkdir(path.dirname(out), { recursive: true })
  await sharp(buf)
    .ensureAlpha()
    .trim({ threshold: 1 })
    .resize(120, 120, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 4, bottom: 4, left: 4, right: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 88, alphaQuality: 90 })
    .toFile(out)
    .catch(async () => {
      await sharp(buf).resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 88 }).toFile(out)
    })
  return `leagues/${slug}.webp`
}

/** Copia as bandeiras 4x3 do flag-icons para public/flags/4x3. */
export async function copyFlags(iso2s) {
  const src = r('node_modules', 'flag-icons', 'flags', '4x3')
  const dst = r('public', 'flags', '4x3')
  await rm(dst, { recursive: true, force: true })
  await mkdir(dst, { recursive: true })
  const missing = []
  for (const iso of new Set(iso2s)) {
    const f = path.join(src, `${iso}.svg`)
    if (existsSync(f)) await copyFile(f, path.join(dst, `${iso}.svg`))
    else missing.push(iso)
  }
  return { copied: (await readdir(dst)).length, missing }
}

export async function cleanDir(rel) {
  await rm(r(rel), { recursive: true, force: true })
  await mkdir(r(rel), { recursive: true })
}
