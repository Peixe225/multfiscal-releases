// Gera src/componentes/rateio/codigo.css: a fonte do código do rateio (RAT-K8EA), em pixel e feita pra ser lida e
// ditada. Na Pixelify (mesmo com o 2 e o 5 do GC Digitos) o 2 e o Z trocam de cara, e B, G e 6 se confundem: o código
// que a pessoa anota ou fala pra loja saía errado. Aqui cada caractere é uma grade 5×7 desenhada pra ficar longe do
// vizinho parecido: 2 com o topo redondo × Z com a barra de cima reta; B de lado reto × 8 redondo; G com a barra pra
// dentro × 6 com o gancho em cima; 5 de canto reto × S redondo. Tem 0–9, A–Z e o hífen (o alfabeto do código é
// 23456789ABCDEFGHJKMNPQRSTUVWXYZ, o resto é sobra pra não cair noutra fonte no meio).
// Métricas parecidas com a da Pixelify (1000 unidades, ascendente 920, descendente -280, avanço 600): a altura das
// maiúsculas fica 700 (a da Pixelify, ~645), então o código não muda o tamanho da linha.
// Gera também 'GC Letras': só o Z maiúsculo redesenhado na grade da Pixelify, pros títulos e selos em pixel do rateio.
// Uso: node scripts/gerar-codigo.mjs   (--previa <pasta> desenha um SVG com os pares que se confundiam)
import { mkdirSync, writeFileSync } from 'node:fs'

const opentype = await import(new URL('../node_modules/opentype.js/dist/opentype.mjs', import.meta.url).href)

const G = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '#.#..', '..#..', '..#..', '..#..', '#####'],
  '2': ['.###.', '#...#', '....#', '..##.', '.#...', '#....', '#####'],
  '3': ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  A: ['..#..', '.#.#.', '#...#', '#...#', '#####', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#..##', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.###.', '#...#', '#....', '.###.', '....#', '#...#', '.###.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
}

const CEL = 100 // 1 pixel da grade, em unidades da fonte
const ESQ = 50 // margem da esquerda (avanço 600 = 50 + 5 × 100 + 50)
const AVANCO = 600

/** Grade 5×7 (linha 0 em cima) → contorno: um quadrado por pixel aceso, emendados por linha (menos nós). */
function caminho(linhas) {
  const p = new opentype.Path()
  linhas.forEach((linha, l) => {
    const y2 = (7 - l) * CEL
    const y1 = y2 - CEL
    for (let c = 0; c < 5; c++) {
      if (linha[c] !== '#') continue
      let f = c
      while (f + 1 < 5 && linha[f + 1] === '#') f++
      const x1 = ESQ + c * CEL
      const x2 = ESQ + (f + 1) * CEL
      p.moveTo(x1, y1)
      p.lineTo(x1, y2)
      p.lineTo(x2, y2)
      p.lineTo(x2, y1)
      p.close()
      c = f
    }
  })
  return p
}

const nomes = { '-': 'hyphen', '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine' }
const glifos = [
  new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: AVANCO, path: new opentype.Path() }),
  new opentype.Glyph({ name: 'space', unicode: 0x20, advanceWidth: AVANCO, path: new opentype.Path() }),
  ...Object.entries(G).map(([ch, linhas]) => new opentype.Glyph({ name: nomes[ch] ?? ch, unicode: ch.charCodeAt(0), advanceWidth: AVANCO, path: caminho(linhas) })),
]
const fonte = new opentype.Font({ familyName: 'GC Codigo', styleName: 'Regular', unitsPerEm: 1000, ascender: 920, descender: -280, glyphs: glifos })
const base64 = Buffer.from(fonte.toArrayBuffer()).toString('base64')

// O Z maiúsculo na grade e nas métricas da Pixelify (avanço 592, maiúscula de -12 a 633, traço ~110): lá o Z é um 2
// arredondado ("ARIZONA" lia "ARI2ONA", "PRAZO" lia "PRA2O"). Barra de cima reta de ponta a ponta, diagonal em 4 degraus
// (como o z minúsculo da própria Pixelify) e base reta: nada do pé e da haste do 2. Entra só nos textos em pixel do
// rateio (--pixel-num), com unicode-range só no Z.
const ZETA = [
  [60, 520, 531, 633], // barra de cima, de ponta a ponta
  [420, 415, 531, 520], // degrau 1
  [326, 310, 437, 415], // degrau 2
  [232, 205, 343, 310], // degrau 3
  [138, 100, 249, 205], // degrau 4
  [60, -12, 531, 100], // base
]
function retangulos(lista) {
  const p = new opentype.Path()
  for (const [x1, y1, x2, y2] of lista) {
    p.moveTo(x1, y1)
    p.lineTo(x1, y2)
    p.lineTo(x2, y2)
    p.lineTo(x2, y1)
    p.close()
  }
  return p
}
const letras = new opentype.Font({
  familyName: 'GC Letras',
  styleName: 'Regular',
  unitsPerEm: 1000,
  ascender: 920,
  descender: -280,
  glyphs: [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 592, path: new opentype.Path() }), new opentype.Glyph({ name: 'Z', unicode: 0x5a, advanceWidth: 592, path: retangulos(ZETA) })],
})
const base64Letras = Buffer.from(letras.toArrayBuffer()).toString('base64')

const css = `/* Gerado por scripts/gerar-codigo.mjs: a fonte do código do rateio (RAT-K8EA), grade 5×7 com 2/Z, B/8, G/6 e 5/S
   bem diferentes. Só os caracteres do código (0–9, A–Z, hífen e espaço); o resto cai na fonte seguinte. */
@font-face {
  font-family: 'GC Codigo';
  src: url(data:font/otf;base64,${base64}) format('opentype');
  font-weight: 100 900;
  font-display: block;
  unicode-range: U+20, U+2D, U+30-39, U+41-5A;
}
/* O Z na grade da Pixelify, com barra reta e diagonal (lá o Z é um 2 arredondado): nos textos em pixel do rateio. */
@font-face {
  font-family: 'GC Letras';
  src: url(data:font/otf;base64,${base64Letras}) format('opentype');
  font-weight: 100 900;
  font-display: block;
  unicode-range: U+5A;
}
`
const destino = new URL('../src/componentes/rateio/codigo.css', import.meta.url)
writeFileSync(destino, css)
console.log(`codigo.css: ${css.length} bytes (fonte ${base64.length} em base64)`)

const i = process.argv.indexOf('--previa')
if (i > 0) {
  const pasta = process.argv[i + 1] ?? '.'
  mkdirSync(pasta, { recursive: true })
  const pares = ['2Z', 'B8', 'G6', '5S', 'RAT-2Z5S', 'RAT-BG68', '23456789ABCDEFGHJKMNPQRSTUVWXYZ']
  const linha = (t, y) => [...t].map((ch, k) => `<g transform="translate(${20 + k * 66},${y}) scale(0.1,-0.1)"><path d="${caminho(G[ch] ?? G['-']).toPathData(0)}"/></g>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${40 + 31 * 66}" height="${pares.length * 100 + 20}" style="background:#000" fill="#fff">${pares.map((t, k) => linha(t, 90 + k * 100)).join('')}</svg>`
  writeFileSync(`${pasta}/codigo.svg`, svg)
  console.log(`prévia: ${pasta}/codigo.svg`)
}
