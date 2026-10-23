// Gera src/interativos/sorte/digitos.css: uma fonte mínima só com o 2 e o 5 redesenhados na grade da Pixelify Sans.
// Na Pixelify o 5 é quase um S e o 2 é quase um Z ("15% OFF" lia "1S% OFF"). A fonte entra com unicode-range
// (U+32, U+35) na frente da Pixelify só no destaque do prêmio: o navegador troca esses dois dígitos e o resto continua
// Pixelify. Mesmas métricas (1000 unidades, ascendente 920, descendente -280, avanço 592), traço de 110/112 unidades
// e cantos com o degrau de 1 pixel da fonte.
// Uso: node scripts/gerar-digitos.mjs   (--previa <pasta> desenha um PNG ampliado com S 5 Z 2 lado a lado)
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'

const opentype = await import(new URL('../node_modules/opentype.js/dist/opentype.mjs', import.meta.url).href)

/** Retângulos [x1, y1, x2, y2] (y pra cima, unidades da fonte) viram contornos no mesmo sentido (união por nonzero). */
function caminho(retangulos) {
  const p = new opentype.Path()
  for (const [x1, y1, x2, y2] of retangulos) {
    p.moveTo(x1, y1)
    p.lineTo(x1, y2)
    p.lineTo(x2, y2)
    p.lineTo(x2, y1)
    p.close()
  }
  return p
}

// 5: barra de cima reta e cheia (cantos retos: é isso que separa do S), haste da esquerda até a barra do meio,
// barra do meio com o canto de 1 pixel na direita, haste da direita embaixo, base com o pé da esquerda (como no S).
const CINCO = [
  [60, 520, 531, 633], // barra de cima
  [60, 255, 170, 520], // haste esquerda
  [60, 255, 440, 366], // barra do meio
  [420, 77, 531, 279], // haste direita de baixo
  [150, -12, 440, 100], // base
  [60, 77, 170, 190], // pé da esquerda
]

// 2: arco de cima com o pé da esquerda (como na Pixelify), haste direita até o meio, diagonal em 3 degraus de 1 pixel
// (o Z da Pixelify não tem diagonal: é isso que separa) e base reta e cheia.
const DOIS = [
  [150, 520, 440, 633], // barra de cima (cantos em degrau)
  [60, 432, 170, 544], // pé da esquerda em cima
  [420, 344, 531, 544], // haste direita
  [330, 255, 440, 366], // degrau 1
  [240, 166, 350, 277], // degrau 2
  [150, 77, 260, 188], // degrau 3
  [60, -12, 531, 100], // base
]

const glifos = [
  new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 592, path: new opentype.Path() }),
  new opentype.Glyph({ name: 'two', unicode: 0x32, advanceWidth: 592, path: caminho(DOIS) }),
  new opentype.Glyph({ name: 'five', unicode: 0x35, advanceWidth: 592, path: caminho(CINCO) }),
]
const fonte = new opentype.Font({ familyName: 'GC Digitos', styleName: 'Regular', unitsPerEm: 1000, ascender: 920, descender: -280, glyphs: glifos })
const base64 = Buffer.from(fonte.toArrayBuffer()).toString('base64')

const css = `/* Gerado por scripts/gerar-digitos.mjs: o 2 e o 5 redesenhados na grade da Pixelify (lá o 5 vira S e o 2 vira Z).
   Só entra no destaque do prêmio (font-family: 'GC Digitos', var(--pixel)); unicode-range troca só esses dois. */
@font-face {
  font-family: 'GC Digitos';
  src: url(data:font/otf;base64,${base64}) format('opentype');
  font-weight: 100 900;
  font-display: block;
  unicode-range: U+32, U+35;
}
`
const destino = new URL('../src/interativos/sorte/digitos.css', import.meta.url)
writeFileSync(destino, css)
console.log(`digitos.css: ${css.length} bytes (fonte ${base64.length} em base64)`)

const i = process.argv.indexOf('--previa')
if (i > 0) {
  const pasta = process.argv[i + 1] ?? '.'
  mkdirSync(pasta, { recursive: true })
  const buf = readFileSync(new URL('../node_modules/@fontsource/pixelify-sans/files/pixelify-sans-latin-500-normal.woff', import.meta.url))
  const pix = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const lista = [
    ['S', pix.charToGlyph('S').path],
    ['5 novo', caminho(CINCO)],
    ['5 Pixelify', pix.charToGlyph('5').path],
    ['Z', pix.charToGlyph('Z').path],
    ['2 novo', caminho(DOIS)],
    ['2 Pixelify', pix.charToGlyph('2').path],
  ]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lista.length * 200}" height="260" style="background:#e8d5b5">${lista
    .map(([r, p], k) => `<g transform="translate(${k * 200 + 20},230) scale(0.27,-0.27)"><path d="${p.toPathData(0)}"/></g><text x="${k * 200 + 20}" y="252" font-size="14" font-family="sans-serif">${r}</text>`)
    .join('')}</svg>`
  writeFileSync(`${pasta}/digitos.svg`, svg)
  console.log(`prévia: ${pasta}/digitos.svg`)
}
