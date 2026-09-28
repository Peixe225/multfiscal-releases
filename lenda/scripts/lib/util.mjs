// Utilidades compartilhadas do pipeline.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, '..', '..')
export const r = (...p) => path.join(ROOT, ...p)

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
export const round1 = (x) => Math.round(x * 10) / 10
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
export const sd = (a) => {
  if (a.length < 2) return 0
  const m = mean(a)
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1))
}

export async function writeJson(file, data, pretty = false) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, pretty ? JSON.stringify(data, null, 1) : JSON.stringify(data))
}

/** "#abc"/"abc"/"aabbcc" → "#AABBCC" (ou null se inválido). */
export function hex(h) {
  if (!h) return null
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(h).trim())
  if (!m) return null
  let v = m[1]
  if (v.length === 3) v = v.split('').map((c) => c + c).join('')
  return '#' + v.toUpperCase()
}

export function rgbOf(h) {
  const n = parseInt(hex(h).slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function colorDist(a, b) {
  const [r1, g1, b1] = rgbOf(a)
  const [r2, g2, b2] = rgbOf(b)
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

/** Sem acentos, minúsculo, só letras/dígitos/espaços. */
export function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o')
    .replace(/æ/gi, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/ł/g, 'l')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Palavras genéricas que não identificam um clube.
const STOP = new Set(
  'fc cf sc ac afc cd ca sd ud rc rcd sv vfb vfl tsg fk bk if ss ssc as us calcio club de del la le les el the of and cp sl aa ec se fbc sk nk hnk fsv bsc tsv kv krc kaa rsc fbk il ik ff bc sad ssd asd aas 1 2 04 05 07 1893 1899 1900 1907 1909 1848 1846 1860 1923 1948 1927 1913 1912'.split(' '),
)
const SYN = { utd: 'united', man: 'manchester', nottm: 'nottingham', st: 'saint', sint: 'saint', munchen: 'munich', koln: 'cologne', internazionale: 'inter', dep: 'deportivo', atl: 'atletico', atletico: 'atletico', ind: 'independiente', indep: 'independiente', uni: 'universidad', univ: 'universidad', u: 'universidad', jrs: 'juniors', jr: 'juniors', gimnasia: 'gimnasia', sp: 'sporting', olymp: 'olympique', wolves: 'wolverhampton', spurs: 'tottenham', psg: 'paris', bsg: 'saint' }
export function tokens(s) {
  const all = fold(s).split(' ').filter(Boolean).map((w) => SYN[w] || w)
  const t = all.filter((w) => !STOP.has(w))
  return t.length ? t : all
}

/** Similaridade 0–1 entre dois nomes de clube (tokens + prefixos). */
export function nameSim(a, b) {
  const ta = tokens(a)
  const tb = tokens(b)
  if (!ta.length || !tb.length) return 0
  const fa = fold(a).replace(/ /g, '')
  const fb = fold(b).replace(/ /g, '')
  if (fa === fb) return 1
  let hit = 0
  for (const x of ta) {
    if (tb.some((y) => y === x || (x.length >= 4 && y.length >= 4 && (y.startsWith(x) || x.startsWith(y))))) hit++
  }
  const j = hit / Math.max(ta.length, tb.length)
  const c = hit / Math.min(ta.length, tb.length)
  return Math.max(0.6 * c + 0.4 * j, fa.includes(fb) || fb.includes(fa) ? 0.8 : 0)
}

/** Nome curto até `max` caracteres (corta palavras do fim). */
export function fitName(s, max = 14) {
  s = String(s || '').trim()
  if (s.length <= max) return s
  const words = s.split(/\s+/)
  const weak = /^(de|da|do|del|la|el|y|e|and|&|of|the|fc|cf|sc|ac)$/i
  while (words.length > 1 && (words.join(' ').length > max || weak.test(words[words.length - 1]))) words.pop()
  const out = words.join(' ')
  return out.length <= max ? out : out.slice(0, max - 1).trimEnd() + '.'
}

export function groupBy(arr, fn) {
  const m = new Map()
  for (const x of arr) {
    const k = fn(x)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(x)
  }
  return m
}

export const log = (...a) => console.log(...a)
