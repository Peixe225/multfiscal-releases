// Desenho dos produtos em código, enquanto não há foto oficial.
// Cada TipoArte tem um desenho próprio, feito numa grade de 90×160 unidades (9:16) e escalado
// para w×h. Fundo transparente. Sombreado de face: luz fraca da esquerda, sombra à direita e
// contorno escuro sutil. A luz forte é a de aro, posta depois na cor do halo (dither.ts): o
// produto contra a luz, como na madrugada. O dither transforma os degradês em padrão de pixel;
// por isso aqui pode (e deve) ter degradê.
// Letreiro: só texto de verdade e legível, em fonte bitmap presa à grade da arte. A marca entra
// onde a marca é a embalagem (RAW, OCB, Smoking, Clipper) e o rótulo só diz o que diz de fato
// ("Nº7", "V.S"). Nada de letra falsa: o resto é filete, faixa e selo geométrico.

import type { Arte, TipoArte } from '../../lib/tipos'

type Ctx = CanvasRenderingContext2D
type RGB = readonly [number, number, number]

interface Paleta {
  corpo: RGB
  faixa: RGB
  rotulo: RGB
  detalhe: RGB
  tampa: RGB
}

/** O que o desenho sabe do produto além das cores. */
interface Extra {
  nome: string
  /** Marca escrita na embalagem (só onde a marca é a embalagem); null = sem letreiro. */
  marca: string | null
}

/** Grade de desenho: 90×160 unidades. */
const U = 90
const V = 160
const CX = U / 2

const BRANCO: RGB = [255, 255, 255]
const PRETO: RGB = [0, 0, 0]
const METAL: RGB = [186, 190, 196]
const TINTA: RGB = PRETO
/** Força do reflexo branco à esquerda (baixo: a luz que manda é a de aro, na cor do halo). */
const REFLEXO = 0.3

/* ---------------------------------------------------------------- cores */

function rgb(hex: string | undefined, reserva: RGB): RGB {
  if (!hex) return reserva
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = h.replace(/./g, (c) => c + c)
  const n = parseInt(h.slice(0, 6), 16)
  return Number.isNaN(n) ? reserva : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const claro = (c: RGB, t: number) => mix(c, BRANCO, t)
const escuro = (c: RGB, t: number) => mix(c, PRETO, t)
const luma = (c: RGB) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255
const preto = (a: number) => `rgba(0,0,0,${a})`
const branco = (a: number) => `rgba(255,255,255,${a})`

/** Rampa de um tom: as mesmas 4 cores entram na paleta do dither, então o que for pintado com
 *  elas (letreiro, relevo) sai liso, sem pontilhado. */
function rampa(c: RGB) {
  return { luz: claro(c, 0.4), base: c, meia: escuro(c, 0.35), funda: escuro(c, 0.7) }
}

function paleta(arte: Arte): Paleta {
  const corpo = rgb(arte.corpo, [128, 128, 128])
  return {
    corpo,
    faixa: rgb(arte.faixa, claro(corpo, 0.5)),
    rotulo: rgb(arte.rotulo, [232, 226, 212]),
    detalhe: rgb(arte.detalhe, BRANCO),
    tampa: rgb(arte.tampa, escuro(corpo, 0.5)),
  }
}

/* ---------------------------------------------------------------- formas */

/** Retângulo com cantos arredondados (raio único ou [se, sd, id, ie]). */
function ret(x: number, y: number, w: number, h: number, r: number | [number, number, number, number] = 0): Path2D {
  const [a, b, c, d] = typeof r === 'number' ? [r, r, r, r] : r
  const p = new Path2D()
  p.moveTo(x + a, y)
  p.arcTo(x + w, y, x + w, y + h, b)
  p.arcTo(x + w, y + h, x, y + h, c)
  p.arcTo(x, y + h, x, y, d)
  p.arcTo(x, y, x + w, y, a)
  p.closePath()
  return p
}

function elipse(x: number, y: number, rx: number, ry: number, rot = 0): Path2D {
  const p = new Path2D()
  p.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2)
  return p
}

function poligono(pts: number[]): Path2D {
  const p = new Path2D()
  p.moveTo(pts[0], pts[1])
  for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1])
  p.closePath()
  return p
}

function pintar(ctx: Ctx, forma: Path2D, cor: RGB | string | CanvasGradient, a = 1) {
  ctx.fillStyle = typeof cor === 'string' || cor instanceof CanvasGradient ? cor : css(cor, a)
  ctx.fill(forma)
}

/** Contorno escuro sutil (metade cai fora: separa o produto do halo). */
function contorno(ctx: Ctx, forma: Path2D, a = 0.55, lw = 1.1) {
  ctx.strokeStyle = preto(a)
  ctx.lineWidth = lw
  ctx.stroke(forma)
}

interface Sombra {
  /** Intensidade da sombra (direita). */
  forca?: number
  /** Intensidade do reflexo vertical claro. */
  brilho?: number
  /** Posição do reflexo (0..1 da largura). */
  pos?: number
}

/** Sombreado cilíndrico por cima do que já foi pintado, preso à silhueta. */
function sombrear(ctx: Ctx, forma: Path2D, x0: number, x1: number, y0: number, y1: number, s: Sombra = {}) {
  const { forca = 1, brilho = 1, pos = 0.24 } = s
  ctx.save()
  ctx.clip(forma)
  const g = ctx.createLinearGradient(x0, 0, x1, 0)
  g.addColorStop(0, preto(0.34 * forca))
  g.addColorStop(0.09, preto(0.08 * forca))
  g.addColorStop(pos + 0.08, preto(0))
  g.addColorStop(0.56, preto(0.12 * forca))
  g.addColorStop(0.8, preto(0.45 * forca))
  g.addColorStop(0.93, preto(0.66 * forca))
  g.addColorStop(1, preto(0.5 * forca))
  ctx.fillStyle = g
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  const l = ctx.createLinearGradient(x0, 0, x1, 0)
  l.addColorStop(0, branco(0))
  l.addColorStop(pos - 0.09, branco(0))
  l.addColorStop(pos, branco(Math.min(1, REFLEXO * brilho)))
  l.addColorStop(pos + 0.045, branco(0.08 * brilho))
  l.addColorStop(pos + 0.14, branco(0))
  l.addColorStop(1, branco(0))
  ctx.fillStyle = l
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  ctx.restore()
}

/** Sombreado de face plana (livreto, bandeja): luz da esquerda, um brilho diagonal. */
function sombraPlana(ctx: Ctx, forma: Path2D, x0: number, x1: number, y0: number, y1: number, brilho = 1) {
  ctx.save()
  ctx.clip(forma)
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  g.addColorStop(0, branco(0.16 * brilho))
  g.addColorStop(0.45, branco(0))
  g.addColorStop(1, preto(0.42))
  ctx.fillStyle = g
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  // brilho diagonal (plástico/papel lustroso)
  const d = ctx.createLinearGradient(x0, y0, x1, y0 + (x1 - x0))
  d.addColorStop(0.2, branco(0))
  d.addColorStop(0.27, branco(0.22 * brilho))
  d.addColorStop(0.31, branco(0))
  ctx.fillStyle = d
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  ctx.restore()
}

/** Reflexo vertical claro, com as pontas sumindo (fraco: a luz forte é a de aro). */
function reflexo(ctx: Ctx, x: number, y: number, w: number, h: number, forca = 0.6) {
  const a = forca * (REFLEXO / 0.62)
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, branco(0))
  g.addColorStop(0.15, branco(a))
  g.addColorStop(0.75, branco(a * 0.8))
  g.addColorStop(1, branco(0))
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
}

/* ---------------------------------------------------------------- letreiro (texto de verdade) */

// Fonte bitmap 5×7 e, para tamanho miúdo, 3×5. Só os glifos que os letreiros usam: letra que não
// está aqui não é escrita (melhor nada que uma palavra errada).
const FONTE7: Record<string, readonly string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  G: ['.####', '#....', '#....', '#..##', '#...#', '#...#', '.####'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  º: ['.#.', '#.#', '.#.', '...', '###', '...', '...'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
}
const FONTE5: Record<string, readonly string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  E: ['###', '#..', '##.', '#..', '###'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  º: ['##', '##', '..', '..', '..'],
  '.': ['.', '.', '.', '.', '#'],
  ' ': ['..', '..', '..', '..', '..'],
}

interface OpcoesLetreiro {
  /** Em pé, lendo de baixo para cima (livreto em pé, corpo do isqueiro). */
  vertical?: boolean
  /** Sombra de 1 px de arte embaixo à direita (letra em relevo). */
  sombra?: RGB
}

/**
 * Escreve texto de verdade em fonte bitmap, preso à grade da arte: cada pixel da fonte vira k×k
 * pixels de arte, com k inteiro (o maior que cabe na caixa maxW×maxH, dada em unidades do
 * desenho e centrada em cx, cy). Tenta 5×7 e cai para 3×5; se nem assim couber, não escreve e
 * devolve false. Pinta sem antisserrilhado, numa cor lisa da paleta: o dither não mexe nela.
 * O contexto não pode estar girado (o letreiro fica sempre na grade).
 */
function letreiro(ctx: Ctx, texto: string, cx: number, cy: number, maxW: number, maxH: number, cor: RGB, o: OpcoesLetreiro = {}): boolean {
  const m = ctx.getTransform()
  const sx = Math.hypot(m.a, m.b)
  const sy = Math.hypot(m.c, m.d)
  const X = m.a * cx + m.c * cy + m.e
  const Y = m.b * cx + m.d * cy + m.f
  const extra = o.sombra ? 1 : 0
  for (const fonte of [FONTE7, FONTE5]) {
    const glifos = [...texto.toUpperCase()].map((ch) => fonte[ch])
    if (glifos.some((g) => !g)) return false
    const lista = glifos as readonly (readonly string[])[]
    const alt = lista[0].length
    const comp = lista.reduce((t, g) => t + g[0].length, 0) + lista.length - 1
    const bw = o.vertical ? alt : comp
    const bh = o.vertical ? comp : alt
    const k = Math.floor(Math.min((maxW * sx - extra) / bw, (maxH * sy - extra) / bh))
    if (k < 1) continue
    const x0 = Math.round(X - (bw * k) / 2)
    const y0 = Math.round(Y - (bh * k) / 2)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    const pintarTexto = (dx: number, dy: number, c: RGB) => {
      ctx.fillStyle = css(c)
      let u = 0
      for (const g of lista) {
        for (let v = 0; v < alt; v++) {
          const linha = g[v]
          for (let gx = 0; gx < linha.length; gx++) {
            if (linha[gx] !== '#') continue
            const t = u + gx
            const px = o.vertical ? x0 + v * k : x0 + t * k
            const py = o.vertical ? y0 + (comp - 1 - t) * k : y0 + v * k
            ctx.fillRect(px + dx, py + dy, k, k)
          }
        }
        u += g[0].length + 1
      }
    }
    if (o.sombra) pintarTexto(1, 1, o.sombra)
    pintarTexto(0, 0, cor)
    ctx.restore()
    return true
  }
  return false
}

/** Marca escrita na embalagem: só onde a marca É a embalagem (o livreto, o isqueiro). */
const MARCAS: readonly [RegExp, string][] = [
  [/\bRAW\b/i, 'RAW'],
  [/\bOCB\b/i, 'OCB'],
  [/\bSmoking\b/i, 'SMOKING'],
  [/\bClipper\b/i, 'CLIPPER'],
]

export function marcaDoNome(nome: string | undefined): string | null {
  if (!nome) return null
  for (const [re, marca] of MARCAS) if (re.test(nome)) return marca
  return null
}

/** Linha fina centrada (texto miúdo do rótulo). */
function filete(ctx: Ctx, cx: number, y: number, w: number, h: number, cor: RGB, a = 1) {
  ctx.fillStyle = css(cor, a)
  ctx.fillRect(cx - w / 2, y, w, h)
}

/* ---------------------------------------------------------------- tampa rosqueada */

function tampaRosca(ctx: Ctx, x: number, y: number, w: number, h: number, cor: RGB) {
  const t = ret(x, y, w, h, [2.2, 2.2, 0.8, 0.8])
  pintar(ctx, t, cor)
  ctx.save()
  ctx.clip(t)
  // frisos
  ctx.fillStyle = css(luma(cor) < 0.15 ? claro(cor, 0.16) : escuro(cor, 0.22))
  for (let fx = x + 1.2; fx < x + w - 0.6; fx += 1.7) ctx.fillRect(fx, y + 2, 0.65, h - 3)
  // aresta de cima clara
  ctx.fillStyle = css(claro(cor, 0.45), 0.8)
  ctx.fillRect(x + 1, y + 0.4, w - 2, 0.9)
  ctx.restore()
  sombrear(ctx, t, x, x + w, y, y + h, { brilho: 1.1 })
  contorno(ctx, t, 0.5, 0.9)
}

/* ================================================================ LATAS */

type EstampaLata = 'onda' | 'diagonal' | 'selo'

/**
 * A estampa da lata sai das cores: corpo escuro → selo central; detalhe claro → fita em onda;
 * detalhe escuro → faixa diagonal. Sem letreiro: a lata se reconhece pela cor e pela estampa.
 */
function estampaDaLata(p: Paleta): EstampaLata {
  if (luma(p.corpo) < 0.12) return 'selo'
  return luma(p.detalhe) > 0.6 ? 'onda' : 'diagonal'
}

function lata(ctx: Ctx, p: Paleta, alta: boolean) {
  const r = alta ? 20 : 22.5
  const rt = r * 0.8 // raio da tampa
  const ry = alta ? 3.8 : 4.4 // elipse achatada: vista um pouco de cima
  const yT = alta ? 23 : 37
  const yF = alta ? 138 : 124
  const yC0 = yT + 8
  const yC1 = yF - 6
  const rf = r * 0.82

  const silhueta = new Path2D()
  silhueta.moveTo(CX - rt, yT)
  silhueta.bezierCurveTo(CX - rt, yT + 3.5, CX - r, yC0 - 4, CX - r, yC0)
  silhueta.lineTo(CX - r, yC1)
  silhueta.bezierCurveTo(CX - r, yC1 + 3, CX - rf, yF - 2, CX - rf, yF)
  silhueta.ellipse(CX, yF, rf, ry * 0.9, 0, Math.PI, 0, true)
  silhueta.bezierCurveTo(CX + rf, yF - 2, CX + r, yC1 + 3, CX + r, yC1)
  silhueta.lineTo(CX + r, yC0)
  silhueta.bezierCurveTo(CX + r, yC0 - 4, CX + rt, yT + 3.5, CX + rt, yT)
  silhueta.ellipse(CX, yT, rt, ry, 0, 0, Math.PI, true)
  silhueta.closePath()

  pintar(ctx, silhueta, METAL)

  // Área impressa: bordas curvas (elipse de baixo), que é o que faz parecer cilindro.
  const impresso = new Path2D()
  impresso.moveTo(CX - r - 1, yC0)
  impresso.ellipse(CX, yC0, r + 1, ry, 0, Math.PI, 0, true)
  impresso.lineTo(CX + r + 1, yC1)
  impresso.ellipse(CX, yC1, r + 1, ry, 0, 0, Math.PI, false)
  impresso.closePath()

  ctx.save()
  ctx.clip(silhueta)
  ctx.clip(impresso)
  ctx.fillStyle = css(p.corpo)
  ctx.fillRect(0, yC0 - ry, U, yC1 - yC0 + ry * 2)
  const ym = (yC0 + yC1) / 2
  if (alta) estampaAlta(ctx, p, r, yC0, yC1)
  else {
    const e = estampaDaLata(p)
    if (e === 'onda') estampaOnda(ctx, p, r, ym)
    else if (e === 'diagonal') estampaDiagonal(ctx, p, r, ym)
    else estampaSelo(ctx, p, r, ym, yC0, yC1)
  }
  ctx.restore()

  // friso de metal onde a tinta acaba (em cima e embaixo)
  ctx.strokeStyle = branco(0.35)
  ctx.lineWidth = 0.7
  ctx.beginPath()
  ctx.ellipse(CX, yC0 + 0.6, r - 0.3, ry, 0, Math.PI * 0.05, Math.PI * 0.95)
  ctx.stroke()

  sombrear(ctx, silhueta, CX - r, CX + r, yT - ry, yF + ry, { brilho: 1.15 })

  // Tampa: aro, miolo rebaixado, boca e anel.
  const aro = elipse(CX, yT, rt, ry)
  const ga = ctx.createLinearGradient(CX - rt, 0, CX + rt, 0)
  ga.addColorStop(0, css(claro(METAL, 0.55)))
  ga.addColorStop(0.5, css(METAL))
  ga.addColorStop(1, css(escuro(METAL, 0.45)))
  pintar(ctx, aro, ga)
  const miolo = elipse(CX, yT + 0.45, rt - 2.1, ry - 1.1)
  const gm = ctx.createLinearGradient(CX - rt, yT - ry, CX + rt, yT + ry)
  gm.addColorStop(0, css(claro(METAL, 0.2)))
  gm.addColorStop(1, css(escuro(METAL, 0.42)))
  pintar(ctx, miolo, gm)
  // boca (na frente) e anel (atrás, levantadinho)
  pintar(ctx, elipse(CX, yT + ry * 0.38, rt * 0.34, ry * 0.3), [34, 34, 36])
  ctx.strokeStyle = css(claro(METAL, 0.5))
  ctx.lineWidth = 1.05
  ctx.beginPath()
  ctx.ellipse(CX, yT - ry * 0.12, rt * 0.3, ry * 0.36, 0, 0, Math.PI * 2)
  ctx.stroke()
  pintar(ctx, elipse(CX, yT - ry * 0.05, 0.9, 0.6), escuro(METAL, 0.5))

  contorno(ctx, silhueta)
}

function estampaOnda(ctx: Ctx, p: Paleta, r: number, ym: number) {
  // A fita em onda sozinha identifica a lata: fita larga clara (detalhe) atravessando, com um fio
  // da cor da faixa correndo por cima. Nada de letreiro.
  const y = ym + 5
  const f = new Path2D()
  f.moveTo(CX - r - 2, y + 8)
  f.bezierCurveTo(CX - 10, y - 10, CX + 3, y + 12, CX + r + 2, y - 8)
  f.lineTo(CX + r + 2, y - 1.5)
  f.bezierCurveTo(CX + 5, y + 18, CX - 9, y - 2.5, CX - r - 2, y + 14.5)
  f.closePath()
  pintar(ctx, f, p.detalhe)
  ctx.strokeStyle = css(p.faixa)
  ctx.lineWidth = 1.7
  ctx.beginPath()
  ctx.moveTo(CX - r - 2, y + 2.5)
  ctx.bezierCurveTo(CX - 10, y - 15.5, CX + 3, y + 6.5, CX + r + 2, y - 13.5)
  ctx.stroke()
}

function estampaDiagonal(ctx: Ctx, p: Paleta, r: number, ym: number) {
  ctx.save()
  ctx.translate(CX, ym - 1)
  ctx.rotate(-0.34)
  ctx.fillStyle = css(p.faixa)
  ctx.fillRect(-r - 12, -8, (r + 12) * 2, 16)
  ctx.fillRect(-r - 12, -12.5, (r + 12) * 2, 2)
  ctx.fillRect(-r - 12, 10.5, (r + 12) * 2, 1.2)
  // dois fios da cor do detalhe dentro da faixa (no lugar do letreiro)
  ctx.fillStyle = css(p.detalhe)
  ctx.fillRect(-r - 12, -3.4, (r + 12) * 2, 1.5)
  ctx.fillRect(-r - 12, 1.6, (r + 12) * 2, 1.5)
  ctx.restore()
  // estrelinha/selo pequeno em cima
  pintar(ctx, elipse(CX + 6, ym - 22, 3.2, 3.2), p.faixa, 0.95)
  pintar(ctx, elipse(CX + 6, ym - 22, 1.6, 1.6), p.detalhe)
}

function estampaSelo(ctx: Ctx, p: Paleta, r: number, ym: number, yC0: number, yC1: number) {
  // faixas finas em cima e embaixo
  ctx.fillStyle = css(p.faixa)
  ctx.fillRect(CX - r - 2, yC0 + 3.5, (r + 2) * 2, 1.6)
  ctx.fillRect(CX - r - 2, yC1 - 5, (r + 2) * 2, 1.6)
  // terceiro fio, fino, logo abaixo do de cima
  ctx.fillRect(CX - r - 2, yC0 + 7.5, (r + 2) * 2, 0.9)
  // mancha (faixa) irregular atrás do rosto
  const pts: number[] = []
  const n = 16
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const rr = i % 2 === 0 ? 14.5 : 10.5
    pts.push(CX + Math.cos(a) * rr * 1.05, ym + 4 + Math.sin(a) * rr)
  }
  pintar(ctx, poligono(pts), p.faixa)
  // rosto de fantasma (detalhe), olhos e boca da cor do corpo
  pintar(ctx, elipse(CX, ym + 3, 6.4, 9.2), p.detalhe)
  pintar(ctx, elipse(CX - 2.7, ym + 0.6, 1.7, 2.8, 0.35), p.corpo)
  pintar(ctx, elipse(CX + 2.7, ym + 0.6, 1.7, 2.8, -0.35), p.corpo)
  pintar(ctx, elipse(CX, ym + 7.4, 1.3, 2.7), p.corpo)
}

function estampaAlta(ctx: Ctx, p: Paleta, r: number, yC0: number, yC1: number) {
  const ym = (yC0 + yC1) / 2
  const galho = escuro(p.corpo, 0.6)
  // faixas finas creme em cima e embaixo
  ctx.fillStyle = css(p.detalhe)
  ctx.fillRect(CX - r - 2, yC0 + 3, (r + 2) * 2, 1.4)
  ctx.fillRect(CX - r - 2, yC1 - 4.4, (r + 2) * 2, 1.4)
  // galhos
  ctx.strokeStyle = css(galho)
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.moveTo(CX - r - 1, yC0 + 22)
  ctx.bezierCurveTo(CX - 10, yC0 + 16, CX - 2, yC0 + 18, CX + 8, yC0 + 9)
  ctx.moveTo(CX - 8, yC0 + 18)
  ctx.lineTo(CX - 5, yC0 + 10)
  ctx.moveTo(CX + r + 1, yC1 - 24)
  ctx.bezierCurveTo(CX + 10, yC1 - 18, CX + 4, yC1 - 14, CX - 6, yC1 - 9)
  ctx.stroke()
  // flores de cerejeira (faixa)
  const flores: [number, number, number][] = [
    [CX - 14, yC0 + 19, 2.6],
    [CX - 5, yC0 + 10, 2.3],
    [CX + 2, yC0 + 13, 2.1],
    [CX + 8, yC0 + 8.5, 2.5],
    [CX - 11, yC0 + 13, 1.8],
    [CX + 14, yC1 - 21, 2.6],
    [CX + 5, yC1 - 15, 2.2],
    [CX - 5, yC1 - 10, 2.4],
  ]
  for (const [x, y, rr] of flores) {
    pintar(ctx, elipse(x, y, rr, rr), p.faixa)
    pintar(ctx, elipse(x - 0.4, y - 0.4, rr * 0.38, rr * 0.38), claro(p.faixa, 0.6))
  }
  // painel creme com as letras
  const painel = ret(CX - 12.5, ym - 15, 25, 30, 9)
  pintar(ctx, painel, p.detalhe)
  ctx.strokeStyle = css(galho, 0.7)
  ctx.lineWidth = 0.7
  ctx.stroke(ret(CX - 10.8, ym - 13.3, 21.6, 26.6, 7.5))
  // no painel, uma flor só e dois fios (sem letreiro)
  pintar(ctx, elipse(CX, ym - 4.5, 3.8, 3.8), p.faixa)
  pintar(ctx, elipse(CX - 0.6, ym - 5.1, 1.4, 1.4), claro(p.faixa, 0.6))
  filete(ctx, CX, ym + 3, 14, 1.1, galho, 0.85)
  filete(ctx, CX, ym + 6.6, 9, 1.1, p.faixa)
}

/* ================================================================ GARRAFAS */

/** Garrafa quadrada (Jack Daniel's): ombro reto, gargalo curto, rótulo preto com moldura branca. */
function garrafaQuadrada(ctx: Ctx, p: Paleta) {
  const xn = 6.2 // meia largura do gargalo
  const xb = 19.5 // meia largura do corpo
  const yN = 27
  const yO = 47
  const yC = 60
  const yF = 145
  const vidro = p.corpo

  const g = new Path2D()
  g.moveTo(CX - xn, yN)
  g.lineTo(CX - xn, yO)
  g.bezierCurveTo(CX - xn, yO + 4.5, CX - xb, yC - 6.5, CX - xb, yC)
  g.lineTo(CX - xb, yF - 2.5)
  g.quadraticCurveTo(CX - xb, yF, CX - xb + 2.5, yF)
  g.lineTo(CX + xb - 2.5, yF)
  g.quadraticCurveTo(CX + xb, yF, CX + xb, yF - 2.5)
  g.lineTo(CX + xb, yC)
  g.bezierCurveTo(CX + xb, yC - 6.5, CX + xn, yO + 4.5, CX + xn, yO)
  g.lineTo(CX + xn, yN)
  g.closePath()

  pintar(ctx, g, vidro)
  ctx.save()
  ctx.clip(g)
  // face da frente: luz da esquerda
  const fr = ctx.createLinearGradient(CX - xb, 0, CX + xb, 0)
  fr.addColorStop(0, css(claro(vidro, 0.42)))
  fr.addColorStop(0.09, css(claro(vidro, 0.42)))
  fr.addColorStop(0.1, css(claro(vidro, 0.16)))
  fr.addColorStop(0.5, css(vidro))
  fr.addColorStop(0.9, css(escuro(vidro, 0.28)))
  fr.addColorStop(0.91, css(escuro(vidro, 0.6)))
  fr.addColorStop(1, css(escuro(vidro, 0.55)))
  ctx.fillStyle = fr
  ctx.fillRect(CX - xb, yO, xb * 2, yF - yO)
  // uísque: luz atravessando, mais quente embaixo
  const lq = ctx.createLinearGradient(0, yC, 0, yF)
  lq.addColorStop(0, 'rgba(255,170,70,0)')
  lq.addColorStop(1, 'rgba(255,170,70,0.22)')
  ctx.fillStyle = lq
  ctx.fillRect(CX - xb, yC, xb * 2, yF - yC)
  // ombro: aresta iluminada
  ctx.strokeStyle = branco(0.4)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(CX - xn + 0.4, yO + 1)
  ctx.bezierCurveTo(CX - xn, yO + 5, CX - xb + 1, yC - 6, CX - xb + 1.2, yC + 1)
  ctx.stroke()
  // fundo grosso de vidro
  ctx.fillStyle = css(claro(vidro, 0.25), 0.7)
  ctx.fillRect(CX - xb, yF - 3.2, xb * 2, 1)
  ctx.restore()

  reflexo(ctx, CX - xb + 1.1, yC + 2, 1.5, yF - yC - 6, 0.7)

  // rótulo preto, topo em arco, moldura branca
  const lx = CX - 14.5
  const ly = 73
  const lw = 29
  const lh = 58
  const rot = new Path2D()
  rot.moveTo(lx, ly + 3.5)
  rot.quadraticCurveTo(CX, ly - 3, lx + lw, ly + 3.5)
  rot.lineTo(lx + lw, ly + lh)
  rot.lineTo(lx, ly + lh)
  rot.closePath()
  pintar(ctx, rot, p.rotulo)
  const moldura = new Path2D()
  moldura.moveTo(lx + 1.8, ly + 4.6)
  moldura.quadraticCurveTo(CX, ly - 0.8, lx + lw - 1.8, ly + 4.6)
  moldura.lineTo(lx + lw - 1.8, ly + lh - 1.8)
  moldura.lineTo(lx + 1.8, ly + lh - 1.8)
  moldura.closePath()
  ctx.strokeStyle = css(p.detalhe)
  ctx.lineWidth = 0.75
  ctx.stroke(moldura)
  const d = p.detalhe
  // topo: fio em arco acompanhando a moldura e um fio reto (no lugar da assinatura)
  ctx.strokeStyle = css(d)
  ctx.lineWidth = 0.9
  ctx.beginPath()
  ctx.moveTo(lx + 6, ly + 9)
  ctx.quadraticCurveTo(CX, ly + 4.6, lx + lw - 6, ly + 9)
  ctx.stroke()
  filete(ctx, CX, ly + 13.6, 16, 0.8, d)
  // miúdos de baixo: só fios
  filete(ctx, CX, ly + 41, 12, 0.8, d, 0.9)
  filete(ctx, CX, ly + 45, 21, 1, d, 0.95)
  filete(ctx, CX, ly + 48, 17, 1, d, 0.85)
  filete(ctx, CX, ly + 51, 11, 1, d, 0.75)
  // rótulo também pega a luz (papel fosco)
  sombraPlana(ctx, rot, lx, lx + lw, ly, ly + lh, 0.55)
  // "Nº7": o que o rótulo diz de fato, em letreiro (depois da luz: cor lisa)
  if (!letreiro(ctx, 'Nº7', CX, ly + 27, 24, 17, d)) filete(ctx, CX, ly + 26, 12, 3, d)

  // gargalo: cinta preta com dois filetes brancos
  const cinta = ret(CX - xn - 0.4, 31, (xn + 0.4) * 2, 14.5, 0.6)
  pintar(ctx, cinta, p.rotulo)
  filete(ctx, CX, 33, 10, 0.7, d)
  filete(ctx, CX, 43, 10, 0.7, d)
  filete(ctx, CX, 37.8, 6, 0.9, d, 0.8)
  sombrear(ctx, ret(CX - xn - 0.5, yN, (xn + 0.5) * 2, yO - yN + 2), CX - xn - 0.5, CX + xn + 0.5, yN, yO + 2, { brilho: 1.1 })

  tampaRosca(ctx, CX - 7.6, 13, 15.2, 14.6, p.tampa)
  contorno(ctx, g)
}

/** Gin (Tanqueray): verde, baixa e larga, topo de coqueteleira em degraus, lacre vermelho redondo. */
function garrafaGin(ctx: Ctx, p: Paleta) {
  const xb = 25
  const yF = 144
  const yD = 84 // onde a cúpula encontra o corpo reto
  const yTopo = 56
  const vidro = p.corpo

  const b = new Path2D()
  b.moveTo(CX - xb, yD)
  b.bezierCurveTo(CX - xb, yD - 18, CX - 15, yTopo + 1, CX - 11.5, yTopo)
  b.lineTo(CX + 11.5, yTopo)
  b.bezierCurveTo(CX + 15, yTopo + 1, CX + xb, yD - 18, CX + xb, yD)
  b.lineTo(CX + xb, yF - 8)
  b.quadraticCurveTo(CX + xb, yF, CX + xb - 8, yF)
  b.lineTo(CX - xb + 8, yF)
  b.quadraticCurveTo(CX - xb, yF, CX - xb, yF - 8)
  b.closePath()

  // degraus da coqueteleira (atrás do corpo, desenhados antes)
  const degraus: [number, number, number, number][] = [
    [12, 47, 10, 3],
    [9, 39.5, 8.5, 2.5],
    [6.6, 31, 9.5, 1.2],
  ]
  for (const [mx, y, hh, rr] of degraus) {
    const d = ret(CX - mx, y, mx * 2, hh, rr)
    pintar(ctx, d, claro(vidro, 0.06))
    sombrear(ctx, d, CX - mx, CX + mx, y, y + hh, { brilho: 1.2 })
    contorno(ctx, d, 0.5, 0.9)
  }

  pintar(ctx, b, vidro)
  ctx.save()
  ctx.clip(b)
  // cúpula pega luz em cima à esquerda
  const cup = ctx.createRadialGradient(CX - 11, yTopo + 10, 1, CX - 11, yTopo + 10, 22)
  cup.addColorStop(0, branco(0.42))
  cup.addColorStop(0.4, branco(0.1))
  cup.addColorStop(1, branco(0))
  ctx.fillStyle = cup
  ctx.fillRect(CX - xb, yTopo, xb * 2, 40)
  // vidro grosso: borda interna mais clara embaixo
  const fundo = ctx.createLinearGradient(0, yF - 14, 0, yF)
  fundo.addColorStop(0, branco(0))
  fundo.addColorStop(1, branco(0.16))
  ctx.fillStyle = fundo
  ctx.fillRect(CX - xb, yF - 14, xb * 2, 14)
  ctx.restore()

  // rótulo creme embaixo
  const rx = CX - 17
  const ry = 103
  const rot = ret(rx, ry, 34, 31, 2)
  pintar(ctx, rot, p.rotulo)
  ctx.strokeStyle = css(p.detalhe, 0.9)
  ctx.lineWidth = 0.6
  ctx.stroke(ret(rx + 1.4, ry + 1.4, 31.2, 28.2, 1.2))
  // losango vermelho no alto e fios (sem letreiro)
  pintar(ctx, poligono([CX, ry + 4, CX + 3.2, ry + 7.2, CX, ry + 10.4, CX - 3.2, ry + 7.2]), p.detalhe)
  filete(ctx, CX, ry + 13.4, 22, 0.8, p.detalhe)
  filete(ctx, CX, ry + 17, 18, 1, TINTA, 0.8)
  filete(ctx, CX, ry + 21, 14, 0.9, TINTA, 0.7)
  filete(ctx, CX, ry + 24.4, 10, 0.9, TINTA, 0.6)

  sombrear(ctx, b, CX - xb, CX + xb, yTopo, yF, { brilho: 1.25 })

  // lacre vermelho redondo (por cima do sombreado: é cera em relevo)
  const sx = CX
  const sy = 87
  const lacre = elipse(sx, sy, 7.6, 7.6)
  const gl = ctx.createRadialGradient(sx - 2.5, sy - 2.5, 0.5, sx, sy, 8)
  gl.addColorStop(0, css(claro(p.detalhe, 0.35)))
  gl.addColorStop(0.6, css(p.detalhe))
  gl.addColorStop(1, css(escuro(p.detalhe, 0.45)))
  pintar(ctx, lacre, gl)
  ctx.strokeStyle = css(escuro(p.detalhe, 0.4))
  ctx.lineWidth = 0.8
  ctx.stroke(elipse(sx, sy, 5.4, 5.4))
  ctx.fillStyle = css(claro(p.detalhe, 0.55))
  ctx.fillRect(sx - 3.4, sy - 3.2, 6.8, 1.5)
  ctx.fillRect(sx - 0.8, sy - 2, 1.6, 5.6)
  contorno(ctx, lacre, 0.45, 0.8)

  tampaRosca(ctx, CX - 7.6, 17.5, 15.2, 14.2, p.tampa)
  contorno(ctx, b)
}

/** Conhaque (Hennessy): ombros arredondados, vidro escuro, rótulo creme grande com topo em arco. */
function garrafaConhaque(ctx: Ctx, p: Paleta) {
  const xn = 6.2
  const yN = 26
  const yO = 43
  const yC = 69
  const yF = 145
  const vidro = p.corpo

  const g = new Path2D()
  g.moveTo(CX - xn, yN)
  g.lineTo(CX - xn, yO)
  g.bezierCurveTo(CX - xn, yO + 10, CX - 21.5, yC - 14, CX - 21.5, yC)
  g.lineTo(CX - 19.5, yF - 4)
  g.quadraticCurveTo(CX - 19.3, yF, CX - 15.5, yF)
  g.lineTo(CX + 15.5, yF)
  g.quadraticCurveTo(CX + 19.3, yF, CX + 19.5, yF - 4)
  g.lineTo(CX + 21.5, yC)
  g.bezierCurveTo(CX + 21.5, yC - 14, CX + xn, yO + 10, CX + xn, yO)
  g.lineTo(CX + xn, yN)
  g.closePath()

  pintar(ctx, g, vidro)
  ctx.save()
  ctx.clip(g)
  // conhaque aceso por dentro (âmbar) perto da luz
  const ac = ctx.createRadialGradient(CX - 8, yC + 4, 1, CX - 8, yC + 4, 30)
  ac.addColorStop(0, 'rgba(255,150,60,0.32)')
  ac.addColorStop(1, 'rgba(255,150,60,0)')
  ctx.fillStyle = ac
  ctx.fillRect(CX - 22, yO, 44, yF - yO)
  ctx.restore()

  // rótulo creme
  const lx = CX - 16
  const ly = 84
  const rot = new Path2D()
  rot.moveTo(lx, ly + 5)
  rot.quadraticCurveTo(CX, ly - 4, lx + 32, ly + 5)
  rot.lineTo(lx + 31.3, ly + 50)
  rot.lineTo(lx + 0.7, ly + 50)
  rot.closePath()
  pintar(ctx, rot, p.rotulo)
  const t = p.detalhe
  // emblema (braço com machado): bloquinho
  ctx.fillStyle = css(t)
  ctx.fillRect(CX - 1, ly + 1.6, 2, 4.4)
  ctx.fillRect(CX - 3, ly + 2, 6, 1.4)
  // fio em arco no lugar da assinatura
  ctx.strokeStyle = css(t)
  ctx.lineWidth = 0.9
  ctx.beginPath()
  ctx.moveTo(CX - 10, ly + 13)
  ctx.quadraticCurveTo(CX, ly + 8.6, CX + 10, ly + 13)
  ctx.stroke()
  filete(ctx, CX, ly + 17, 18, 0.7, t, 0.8)
  filete(ctx, CX, ly + 38, 18, 0.9, t, 0.8)
  filete(ctx, CX, ly + 42, 14, 0.9, t, 0.7)
  filete(ctx, CX, ly + 45, 9, 0.9, t, 0.6)

  sombrear(ctx, g, CX - 21.5, CX + 21.5, yN, yF, { brilho: 1.2 })
  reflexo(ctx, CX - 17.5, yC - 2, 1.4, 62, 0.55)
  // "V.S": o que o rótulo diz de fato (Very Special), em letreiro (depois da luz: cor lisa)
  if (!letreiro(ctx, 'V.S', CX, ly + 27, 24, 14, t)) filete(ctx, CX, ly + 26, 12, 3, t)

  // colarinho do gargalo
  const col = ret(CX - xn - 0.4, 33, (xn + 0.4) * 2, 9.5, 0.6)
  pintar(ctx, col, p.rotulo)
  filete(ctx, CX, 35.4, 9, 0.8, t)
  filete(ctx, CX, 38.6, 6, 0.8, t, 0.8)
  sombrear(ctx, col, CX - xn - 0.4, CX + xn + 0.4, 33, 42.5)

  tampaRosca(ctx, CX - 7.4, 12.5, 14.8, 14.5, p.tampa)
  // anel dourado na base da tampa
  ctx.fillStyle = css(claro(p.rotulo, 0.1), 0.9)
  ctx.fillRect(CX - 7, 26, 14, 1)
  contorno(ctx, g)
}

/** Licor (Jägermeister): verde escuro, quadrada de ombro redondo, rótulo laranja com o selo do cervo. */
function garrafaLicor(ctx: Ctx, p: Paleta) {
  const xn = 6.6
  const xb = 21
  const yN = 30
  const yO = 46
  const yC = 64
  const yF = 145
  const vidro = p.corpo

  const g = new Path2D()
  g.moveTo(CX - xn, yN)
  g.lineTo(CX - xn, yO)
  g.bezierCurveTo(CX - xn, yO + 7, CX - xb, yC - 10, CX - xb, yC)
  g.lineTo(CX - xb, yF - 4)
  g.quadraticCurveTo(CX - xb, yF, CX - xb + 4, yF)
  g.lineTo(CX + xb - 4, yF)
  g.quadraticCurveTo(CX + xb, yF, CX + xb, yF - 4)
  g.lineTo(CX + xb, yC)
  g.bezierCurveTo(CX + xb, yC - 10, CX + xn, yO + 7, CX + xn, yO)
  g.lineTo(CX + xn, yN)
  g.closePath()

  pintar(ctx, g, vidro)
  ctx.save()
  ctx.clip(g)
  // chanfros da garrafa quadrada
  ctx.fillStyle = css(claro(vidro, 0.3))
  ctx.fillRect(CX - xb, yC - 2, 3.4, yF - yC)
  ctx.fillStyle = css(escuro(vidro, 0.55))
  ctx.fillRect(CX + xb - 3.4, yC - 2, 3.4, yF - yC)
  ctx.restore()

  // rótulo laranja de cantos chanfrados
  const lx = CX - 16.5
  const ly = 73
  const lw = 33
  const lh = 62
  const c = 3.2
  const rot = poligono([lx + c, ly, lx + lw - c, ly, lx + lw, ly + c, lx + lw, ly + lh - c, lx + lw - c, ly + lh, lx + c, ly + lh, lx, ly + lh - c, lx, ly + c])
  pintar(ctx, rot, p.rotulo)
  ctx.strokeStyle = css(p.detalhe, 0.95)
  ctx.lineWidth = 0.7
  ctx.stroke(poligono([lx + c + 0.6, ly + 1.4, lx + lw - c - 0.6, ly + 1.4, lx + lw - 1.4, ly + c + 0.6, lx + lw - 1.4, ly + lh - c - 0.6, lx + lw - c - 0.6, ly + lh - 1.4, lx + c + 0.6, ly + lh - 1.4, lx + 1.4, ly + lh - c - 0.6, lx + 1.4, ly + c + 0.6]))
  const tinta = escuro(vidro, 0.55)
  filete(ctx, CX, ly + 6, 24, 1.2, tinta, 0.9)
  filete(ctx, CX, ly + 9.4, 16, 0.9, tinta, 0.75)
  // selo creme com o cervo
  const sy = ly + 26
  pintar(ctx, elipse(CX, sy, 10.5, 10.5), escuro(vidro, 0.2))
  pintar(ctx, elipse(CX, sy, 9.2, 9.2), p.detalhe)
  ctx.strokeStyle = css(tinta)
  ctx.lineWidth = 1.25
  ctx.beginPath()
  // galhada
  ctx.moveTo(CX - 1.4, sy + 1.2)
  ctx.lineTo(CX - 5, sy - 5.6)
  ctx.moveTo(CX - 3.6, sy - 3)
  ctx.lineTo(CX - 6.6, sy - 3.4)
  ctx.moveTo(CX - 4.4, sy - 4.4)
  ctx.lineTo(CX - 3.2, sy - 7.2)
  ctx.moveTo(CX + 1.4, sy + 1.2)
  ctx.lineTo(CX + 5, sy - 5.6)
  ctx.moveTo(CX + 3.6, sy - 3)
  ctx.lineTo(CX + 6.6, sy - 3.4)
  ctx.moveTo(CX + 4.4, sy - 4.4)
  ctx.lineTo(CX + 3.2, sy - 7.2)
  ctx.stroke()
  // cabeça
  ctx.fillStyle = css(tinta)
  ctx.fill(poligono([CX - 2.6, sy + 0.4, CX + 2.6, sy + 0.4, CX + 1.6, sy + 6.6, CX - 1.6, sy + 6.6]))
  // cruz clara entre os chifres
  ctx.fillStyle = css(claro(p.rotulo, 0.35))
  ctx.fillRect(CX - 0.6, sy - 7.4, 1.2, 5)
  ctx.fillRect(CX - 2, sy - 6, 4, 1.2)
  filete(ctx, CX, ly + 42, 22, 1.2, tinta, 0.9)
  filete(ctx, CX, ly + 48, 20, 0.9, tinta, 0.85)
  filete(ctx, CX, ly + 51.4, 15, 0.9, tinta, 0.7)
  filete(ctx, CX, ly + 54.8, 10, 0.9, tinta, 0.6)
  sombraPlana(ctx, rot, lx, lx + lw, ly, ly + lh, 0.6)

  sombrear(ctx, g, CX - xb, CX + xb, yN, yF, { brilho: 1.25, forca: 0.9 })
  reflexo(ctx, CX - xb + 1.2, yC + 1, 1.3, 76, 0.6)

  // cinta laranja no gargalo
  const cinta = ret(CX - xn - 0.4, 35.5, (xn + 0.4) * 2, 8, 0.5)
  pintar(ctx, cinta, p.rotulo)
  filete(ctx, CX, 38.6, 8, 1, tinta)
  sombrear(ctx, cinta, CX - xn - 0.4, CX + xn + 0.4, 35.5, 43.5)

  tampaRosca(ctx, CX - 8.4, 17, 16.8, 14, p.tampa)
  contorno(ctx, g)
}

/* ================================================================ TABACARIA */

/**
 * Livreto de seda em pé, de frente e sem giro (o letreiro fica na grade). A marca corre na capa
 * de baixo para cima, como no livreto deitado da vida real posto em pé. Capa escura (OCB, Smoking)
 * fica mais funda e leva letra clara; capa kraft (RAW) leva letra escura: as duas não se confundem
 * nem no cinza. Slim é mais estreito e mais alto.
 */
function seda(ctx: Ctx, p: Paleta, e: Extra) {
  const slim = /slim/i.test(e.nome)
  const w = slim ? 27 : 33
  const h = slim ? 88 : 82
  const x = CX - w / 2
  const y = 84 - h / 2
  const escura = luma(p.corpo) < 0.4
  // marrom escuro desce para chocolate (o preto da OCB já está no fundo)
  const capaCor = escura && luma(p.corpo) > 0.12 ? rampa(p.corpo).meia : p.corpo
  const letra = escura ? p.detalhe : luma(p.faixa) < 0.4 ? p.faixa : TINTA
  const papel = p.detalhe

  // folha escapando por cima, com a tira de cola
  const folha = ret(x + 2.5, y - 8, w - 5, 12, 0.4)
  pintar(ctx, folha, papel)
  ctx.fillStyle = css(escuro(papel, 0.14))
  ctx.fillRect(x + 2.5, y - 8, w - 5, 1.4)
  contorno(ctx, folha, 0.35, 0.8)

  const capa = ret(x, y, w, h, 1.4)
  pintar(ctx, capa, capaCor)
  ctx.save()
  ctx.clip(capa)
  // aba dobrada em cima, com o recorte em V no meio
  const yAba = y + 15
  pintar(ctx, poligono([x, y, x + w, y, x + w, yAba, CX + 3.2, yAba, CX, yAba + 3.4, CX - 3.2, yAba, x, yAba]), claro(capaCor, 0.07))
  ctx.strokeStyle = preto(0.55)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, yAba + 0.6)
  ctx.lineTo(CX - 3.2, yAba + 0.6)
  ctx.lineTo(CX, yAba + 4)
  ctx.lineTo(CX + 3.2, yAba + 0.6)
  ctx.lineTo(x + w, yAba + 0.6)
  ctx.stroke()
  // fios da faixa: no alto da aba e perto do pé
  ctx.fillStyle = css(p.faixa)
  ctx.fillRect(x, y + 5, w, 1.6)
  ctx.fillRect(x, y + h - 9, w, 1.2)
  // bordas das folhas embaixo
  ctx.fillStyle = css(papel, 0.6)
  ctx.fillRect(x + 1, y + h - 2.2, w - 2, 0.9)
  ctx.restore()
  sombraPlana(ctx, capa, x, x + w, y, y + h, escura ? 1.1 : 0.8)
  // lombada esquerda pega luz, direita na sombra
  ctx.save()
  ctx.clip(capa)
  ctx.fillStyle = branco(0.16)
  ctx.fillRect(x, y, 1.4, h)
  ctx.fillStyle = preto(0.42)
  ctx.fillRect(x + w - 2, y, 2, h)
  ctx.restore()
  contorno(ctx, capa)

  // a marca, de baixo para cima, no meio da capa (depois da luz: cor lisa)
  const yL0 = yAba + 6
  const yL1 = y + h - 12
  const escrito = !!e.marca && letreiro(ctx, e.marca, CX, (yL0 + yL1) / 2, w - 9, yL1 - yL0, letra, { vertical: true })
  // marca desconhecida: uma faixa vertical lisa (grafismo, não letra)
  if (!escrito) filete(ctx, CX, yL0, 5, yL1 - yL0, letra)
}

/** Tubo de vidro (piteira): quase invisível no meio, paredes claras, reflexo comprido e boca oca. */
function tuboVidro(ctx: Ctx, x0: number, x1: number, r: number, cor: RGB, bocaChata = false) {
  const corpo = ret(x0, -r, x1 - x0, r * 2, 0)
  const g = ctx.createLinearGradient(0, -r, 0, r)
  g.addColorStop(0, css(cor, 0.55))
  g.addColorStop(0.16, css(cor, 0.1))
  g.addColorStop(0.3, css(claro(cor, 0.6), 0.5))
  g.addColorStop(0.42, css(cor, 0.08))
  g.addColorStop(0.78, css(cor, 0.14))
  g.addColorStop(1, css(cor, 0.6))
  pintar(ctx, corpo, g)
  // paredes: vidro grosso aparece claro nas bordas
  ctx.lineWidth = 1.1
  ctx.strokeStyle = css(claro(cor, 0.35))
  ctx.beginPath()
  ctx.moveTo(x0, -r + 0.55)
  ctx.lineTo(x1, -r + 0.55)
  ctx.stroke()
  ctx.strokeStyle = css(cor, 0.9)
  ctx.beginPath()
  ctx.moveTo(x0, r - 0.55)
  ctx.lineTo(x1, r - 0.55)
  ctx.stroke()
  // reflexo principal, com um respiro no meio
  const meio = x0 + (x1 - x0) * 0.58
  ctx.strokeStyle = branco(1)
  ctx.lineWidth = 1.15
  ctx.beginPath()
  ctx.moveTo(x0 + 3, -r * 0.48)
  ctx.lineTo(meio - 2, -r * 0.48)
  ctx.moveTo(meio + 2.5, -r * 0.48)
  ctx.lineTo(x1 - 3.5, -r * 0.48)
  ctx.stroke()
  ctx.strokeStyle = branco(0.4)
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(x0 + 7, r * 0.42)
  ctx.lineTo(x1 - 9, r * 0.42)
  ctx.stroke()
  // boca de trás: anel fino
  ctx.strokeStyle = css(cor, 0.8)
  ctx.lineWidth = 0.9
  ctx.stroke(elipse(x0, 0, r * 0.34, r))
  // boca da frente: anel grosso e claro, miolo escuro (é oco)
  const ry1 = bocaChata ? r * 0.6 : r
  const rx1 = bocaChata ? r * 0.24 : r * 0.38
  pintar(ctx, elipse(x1, 0, rx1, ry1), [10, 14, 16])
  ctx.strokeStyle = css(claro(cor, 0.55))
  ctx.lineWidth = 1.5
  ctx.stroke(elipse(x1, 0, rx1, ry1))
  // contorno sutil (só fora)
  ctx.strokeStyle = preto(0.5)
  ctx.lineWidth = 0.9
  ctx.beginPath()
  ctx.moveTo(x0, -r - 0.5)
  ctx.lineTo(x1, -r - 0.5)
  ctx.moveTo(x0, r + 0.5)
  ctx.lineTo(x1, r + 0.5)
  ctx.stroke()
}

/** Piteiras de vidro: a slim (longa) e a flat (curta, boca achatada), cruzando o quadro. */
function piteiraVidro(ctx: Ctx, p: Paleta) {
  ctx.save()
  ctx.translate(CX, 80)
  ctx.rotate(-1.05)
  ctx.save()
  ctx.translate(-4, -10.5)
  tuboVidro(ctx, -50, 50, 6.4, p.corpo)
  ctx.restore()
  ctx.save()
  ctx.translate(-10, 11)
  tuboVidro(ctx, -32, 34, 7.8, claro(p.corpo, 0.1), true)
  ctx.restore()
  ctx.restore()
}

/** Piteira de papel já enrolada, deitada (cilindro), com o "M" do picote na boca. */
function piteiraEnrolada(ctx: Ctx, cx: number, cy: number, ang: number, L: number, r: number, papel: RGB, sombra = false) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(ang)
  const tubo = ret(-L, -r, L * 2, r * 2, 0)
  if (sombra) pintar(ctx, ret(-L + 0.8, -r + 1.8, L * 2, r * 2, r * 0.6), preto(0.4))
  pintar(ctx, tubo, papel)
  ctx.save()
  ctx.clip(tubo)
  const gt = ctx.createLinearGradient(0, -r, 0, r)
  gt.addColorStop(0, branco(0.1))
  gt.addColorStop(0.3, branco(0.28))
  gt.addColorStop(0.45, branco(0))
  gt.addColorStop(1, preto(0.45))
  ctx.fillStyle = gt
  ctx.fillRect(-L, -r, L * 2, r * 2)
  ctx.restore()
  pintar(ctx, elipse(L, 0, r * 0.42, r), escuro(papel, 0.08))
  ctx.strokeStyle = css(escuro(papel, 0.55))
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(L - 1, -r * 0.6)
  ctx.lineTo(L + 1, -r * 0.24)
  ctx.lineTo(L - 1, r * 0.08)
  ctx.lineTo(L + 1, r * 0.4)
  ctx.lineTo(L - 0.6, r * 0.68)
  ctx.stroke()
  const sil = new Path2D()
  sil.addPath(tubo)
  sil.addPath(elipse(L, 0, r * 0.42, r))
  contorno(ctx, sil, 0.5, 0.9)
  ctx.restore()
}

/**
 * Piteira de papel: livreto largo e baixo, como o de verdade, com a tira picotada à mostra por cima
 * (cada pedaço é uma piteira) e uma piteira já enrolada deitada na frente. A marca em letreiro.
 */
function piteiraPapel(ctx: Ctx, p: Paleta, e: Extra) {
  const papel = p.detalhe
  const w = 60
  const h = 34
  const x = CX - w / 2
  const y = 72 - h / 2
  const escura = luma(p.corpo) < 0.4
  const letra = escura ? papel : luma(p.faixa) < 0.4 ? p.faixa : TINTA

  // tira picotada saindo por cima, com a borda rasgada em zigue-zague
  const yT = y - 12
  const pts: number[] = [x + 2.5, y + 2]
  for (let i = 0, dx = x + 2.5; dx <= x + w - 2.5 + 0.01; i++, dx += 2.75) pts.push(dx, yT + (i % 2 === 0 ? 0 : 2.4))
  pts.push(x + w - 2.5, y + 2)
  const tira = poligono(pts)
  pintar(ctx, tira, papel)
  ctx.save()
  ctx.clip(tira)
  const gs = ctx.createLinearGradient(0, yT, 0, y + 2)
  gs.addColorStop(0, preto(0))
  gs.addColorStop(1, preto(0.32))
  ctx.fillStyle = gs
  ctx.fillRect(x, yT, w, y + 2 - yT)
  // picote: uma linha tracejada a cada piteira
  ctx.fillStyle = css(rampa(papel).meia)
  for (let dx = x + 8; dx < x + w - 4; dx += 5.5) for (let dy = yT + 3; dy < y + 1; dy += 2.2) ctx.fillRect(dx, dy, 0.9, 1.1)
  ctx.restore()
  contorno(ctx, tira, 0.4, 0.8)

  const capa = ret(x, y, w, h, 1.6)
  pintar(ctx, capa, p.corpo)
  ctx.save()
  ctx.clip(capa)
  // aba de cima (dobra) e a linha da dobra
  ctx.fillStyle = css(escuro(p.corpo, 0.12))
  ctx.fillRect(x, y, w, 6.5)
  ctx.fillStyle = preto(0.4)
  ctx.fillRect(x, y + 6.5, w, 0.9)
  ctx.restore()
  sombraPlana(ctx, capa, x, x + w, y, y + h, 0.8)
  contorno(ctx, capa)

  // a marca grande e o "TIPS" miúdo, como no livreto (depois da luz: cor lisa)
  const escrito = !!e.marca && letreiro(ctx, e.marca, CX, y + 19.5, w - 16, 14, letra)
  if (escrito) letreiro(ctx, 'TIPS', CX, y + h - 5, w - 26, 5.5, letra)
  else {
    filete(ctx, CX, y + 15, w - 22, 3, letra)
    filete(ctx, CX, y + 22, w - 32, 1, letra, 0.8)
  }

  piteiraEnrolada(ctx, CX + 7, 106, -0.3, 16, 5, papel)
}

/** Cuia de silicone: tigela rasa de borda grossa, vista um pouco de cima, com a marca em relevo. */
function cuia(ctx: Ctx, p: Paleta, e: Extra) {
  const y0 = 70 // centro da boca
  const rx = 32
  const ry = 11.5
  const yB = 100
  const base = p.corpo
  const r = rampa(base)

  // pé
  pintar(ctx, elipse(CX, yB, 17, 4), r.funda)

  const corpo = new Path2D()
  corpo.moveTo(CX - rx, y0)
  corpo.bezierCurveTo(CX - rx, y0 + 17, CX - 23, yB - 1, CX - 17, yB)
  corpo.lineTo(CX + 17, yB)
  corpo.bezierCurveTo(CX + 23, yB - 1, CX + rx, y0 + 17, CX + rx, y0)
  corpo.ellipse(CX, y0, rx, ry, 0, 0, Math.PI, true)
  corpo.closePath()
  pintar(ctx, corpo, base)
  ctx.save()
  ctx.clip(corpo)
  const gv = ctx.createLinearGradient(0, y0, 0, yB)
  gv.addColorStop(0, branco(0.04))
  gv.addColorStop(1, preto(0.32))
  ctx.fillStyle = gv
  ctx.fillRect(CX - rx, y0, rx * 2, yB - y0)
  ctx.restore()
  sombrear(ctx, corpo, CX - rx, CX + rx, y0 - ry, yB + 2, { brilho: 0.7, pos: 0.22 })

  // borda grossa: o anel da boca, mais claro, com luz na aresta de cima
  const anel = elipse(CX, y0, rx, ry)
  const ga = ctx.createLinearGradient(CX - rx, 0, CX + rx, 0)
  ga.addColorStop(0, css(claro(base, 0.2)))
  ga.addColorStop(0.6, css(base))
  ga.addColorStop(1, css(r.meia))
  pintar(ctx, anel, ga)
  ctx.strokeStyle = css(r.luz)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.ellipse(CX, y0, rx - 0.8, ry - 0.6, 0, Math.PI * 0.92, Math.PI * 1.62)
  ctx.stroke()
  // miolo: parede de trás iluminada, fundo escuro
  const borda = 5.2
  const boca = elipse(CX, y0 + 0.6, rx - borda, ry - borda * 0.6)
  const gb = ctx.createLinearGradient(0, y0 - ry, 0, y0 + ry)
  gb.addColorStop(0, css(r.funda))
  gb.addColorStop(0.5, css(r.meia))
  gb.addColorStop(1, css(claro(base, 0.06)))
  pintar(ctx, boca, gb)
  ctx.save()
  ctx.clip(boca)
  pintar(ctx, elipse(CX + 1.5, y0 + 1.6, rx - 13, ry - 7), r.funda)
  ctx.restore()
  ctx.strokeStyle = preto(0.4)
  ctx.lineWidth = 0.9
  ctx.stroke(boca)
  contorno(ctx, corpo)

  // marca em relevo na frente: letra clara com sombra de 1 px (cores da rampa: saem lisas)
  if (e.marca) letreiro(ctx, e.marca, CX, y0 + ry + 8.5, 36, 12, r.luz, { sombra: r.funda })
}

/** Dichavador: cilindro metálico em 4 partes, tampa com borda serrilhada (frisos em relevo). */
function dichavador(ctx: Ctx, p: Paleta) {
  const R = 26
  const ry = 9
  const yT = 60
  const yS = yT + 12.5 // fim da tampa serrilhada
  const yF = 104
  const met = p.corpo

  const lado = new Path2D()
  lado.moveTo(CX - R, yT)
  lado.lineTo(CX - R, yF)
  lado.ellipse(CX, yF, R, ry, 0, Math.PI, 0, true)
  lado.lineTo(CX + R, yT)
  lado.closePath()
  pintar(ctx, lado, met)
  ctx.save()
  ctx.clip(lado)
  // metal: faixas de brilho mais duras que no vidro
  const gm = ctx.createLinearGradient(CX - R, 0, CX + R, 0)
  gm.addColorStop(0, css(escuro(met, 0.2)))
  gm.addColorStop(0.12, css(claro(met, 0.35)))
  gm.addColorStop(0.2, css(claro(met, 0.75)))
  gm.addColorStop(0.28, css(claro(met, 0.15)))
  gm.addColorStop(0.5, css(met))
  gm.addColorStop(0.62, css(claro(met, 0.3)))
  gm.addColorStop(0.7, css(escuro(met, 0.15)))
  gm.addColorStop(0.92, css(escuro(met, 0.6)))
  gm.addColorStop(1, css(escuro(met, 0.4)))
  ctx.fillStyle = gm
  ctx.fillRect(CX - R, yT, R * 2, yF - yT + ry + 1)
  // serrilhado: sulco escuro + flanco claro, em projeção cilíndrica (acompanha a curva)
  const passo = 7.5
  for (let a = -90 + passo / 2; a < 90; a += passo) {
    const t0 = ((a - passo * 0.22) * Math.PI) / 180
    const t1 = ((a + passo * 0.22) * Math.PI) / 180
    const xa = CX + R * Math.sin(t0)
    const xb = CX + R * Math.sin(t1)
    const dy = ry * Math.cos((a * Math.PI) / 180)
    ctx.fillStyle = css(p.faixa, 0.95)
    ctx.fillRect(xa, yT + dy - 0.5, xb - xa, yS - yT + 0.5)
    const luz = a < -15 ? 0.7 : a < 35 ? 0.35 : 0.08
    ctx.fillStyle = branco(luz)
    ctx.fillRect(xb, yT + dy - 0.5, Math.max(0.35, (xb - xa) * 0.55), yS - yT + 0.5)
  }
  // sulcos entre as partes (o da tampa mais fundo)
  for (const [y, lw] of [
    [yS, 1.6],
    [yS + 11.5, 1.2],
    [yS + 22.5, 1.2],
  ] as const) {
    ctx.strokeStyle = css(escuro(p.faixa, 0.3))
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.ellipse(CX, y, R, ry, 0, Math.PI * 0.02, Math.PI * 0.98)
    ctx.stroke()
    ctx.strokeStyle = css(p.detalhe, 0.6)
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.ellipse(CX, y + lw, R, ry, 0, Math.PI * 0.3, Math.PI * 0.98)
    ctx.stroke()
  }
  ctx.restore()
  // dentinhos saltando na silhueta (lados da tampa)
  ctx.fillStyle = css(escuro(met, 0.15))
  for (let y = yT + 0.6; y < yS + 1; y += 2.3) {
    ctx.fillRect(CX - R - 0.9, y, 0.9, 1.2)
    ctx.fillRect(CX + R, y, 0.9, 1.2)
  }

  // tampa (face de cima)
  const topo = elipse(CX, yT, R, ry)
  const gt = ctx.createLinearGradient(CX - R, yT - ry, CX + R, yT + ry)
  gt.addColorStop(0, css(claro(met, 0.62)))
  gt.addColorStop(0.45, css(claro(met, 0.15)))
  gt.addColorStop(1, css(escuro(met, 0.35)))
  pintar(ctx, topo, gt)
  // aro serrilhado em volta da face (pontinhos alternados)
  for (let a = 0; a < 360; a += 9) {
    const t = (a * Math.PI) / 180
    const x = CX + (R - 1) * Math.cos(t)
    const y = yT + (ry - 0.6) * Math.sin(t)
    ctx.fillStyle = (a / 9) % 2 === 0 ? css(escuro(met, 0.35)) : css(claro(met, 0.5))
    ctx.fillRect(x - 0.5, y - 0.4, 1, 0.8)
  }
  // anel usinado e disco central
  ctx.strokeStyle = css(p.faixa, 0.6)
  ctx.lineWidth = 0.8
  ctx.stroke(elipse(CX, yT + 0.3, R - 8, ry - 2.8))
  ctx.strokeStyle = branco(0.45)
  ctx.lineWidth = 0.6
  ctx.stroke(elipse(CX, yT + 1.1, R - 8, ry - 2.8))
  pintar(ctx, elipse(CX, yT + 0.4, 6, 2.1), escuro(met, 0.2))
  pintar(ctx, elipse(CX - 1.6, yT - 0.2, 2.6, 0.8), claro(met, 0.5), 0.8)
  // brilho da aresta (lado da luz)
  ctx.strokeStyle = css(p.detalhe, 0.9)
  ctx.lineWidth = 0.9
  ctx.beginPath()
  ctx.ellipse(CX, yT, R - 0.4, ry - 0.3, 0, Math.PI * 0.95, Math.PI * 1.5)
  ctx.stroke()

  contorno(ctx, lado)
  contorno(ctx, topo, 0.35, 0.8)
}

/** Isqueiro formato Clipper: corpo arredondado colorido e cabeça de metal com a pedra. */
function isqueiro(ctx: Ctx, p: Paleta, e: Extra) {
  const x0 = CX - 14
  const w = 28
  const yC = 59
  const yF = 137

  // corpo
  const corpo = ret(x0, yC, w, yF - yC, [3, 3, 9, 9])
  pintar(ctx, corpo, p.corpo)
  ctx.save()
  ctx.clip(corpo)
  // faixa fina
  ctx.fillStyle = css(p.faixa, 0.85)
  ctx.fillRect(x0, yF - 12, w, 1.4)
  // nível de gás (corpo translúcido embaixo)
  ctx.fillStyle = css(claro(p.corpo, 0.25), 0.55)
  ctx.fillRect(x0, yF - 9, w, 9)
  ctx.restore()
  sombrear(ctx, corpo, x0, x0 + w, yC, yF, { brilho: 1.2 })
  contorno(ctx, corpo)
  // a marca de pé no corpo, de baixo para cima (depois da luz: cor lisa)
  const yL0 = yC + 6
  const yL1 = yF - 15
  const escrito = !!e.marca && letreiro(ctx, e.marca, CX + 0.5, (yL0 + yL1) / 2, w - 9, yL1 - yL0, p.detalhe, { vertical: true })
  if (!escrito) filete(ctx, CX, yL0 + 4, 3, yL1 - yL0 - 8, p.detalhe, 0.9)

  // colarinho de metal
  const col = ret(x0 - 0.6, yC - 4, w + 1.2, 5.2, 1)
  pintar(ctx, col, escuro(METAL, 0.1))
  sombrear(ctx, col, x0, x0 + w, yC - 4, yC + 1.2, { brilho: 1.4 })
  contorno(ctx, col, 0.5, 0.8)

  // cabeça (escudo de metal) com janela da roda
  const cab = ret(x0 + 1, 29, w - 2, yC - 4 - 29 + 0.5, [4, 4, 0, 0])
  pintar(ctx, cab, METAL)
  ctx.save()
  ctx.clip(cab)
  // furinhos de ventilação nas laterais
  ctx.fillStyle = preto(0.55)
  for (const y of [44, 48, 52]) {
    ctx.fillRect(x0 + 3.4, y, 2.2, 2.2)
    ctx.fillRect(x0 + w - 5.6, y, 2.2, 2.2)
  }
  ctx.restore()
  // janela
  const jan = ret(CX - 8.5, 31.5, 17, 11, 2)
  pintar(ctx, jan, [26, 26, 28])
  // roda de pedra (cilindro deitado com estrias)
  const roda = ret(CX - 7, 33, 14, 6.4, 3)
  pintar(ctx, roda, escuro(METAL, 0.25))
  ctx.save()
  ctx.clip(roda)
  ctx.fillStyle = preto(0.6)
  for (let x = CX - 6.5; x < CX + 7; x += 1.4) ctx.fillRect(x, 33, 0.55, 6.4)
  const gr = ctx.createLinearGradient(0, 33, 0, 39.4)
  gr.addColorStop(0, branco(0.55))
  gr.addColorStop(0.4, branco(0.05))
  gr.addColorStop(1, preto(0.4))
  ctx.fillStyle = gr
  ctx.fillRect(CX - 7, 33, 14, 6.4)
  ctx.restore()
  // válvula
  ctx.fillStyle = css(escuro(METAL, 0.55))
  ctx.fillRect(CX - 1.6, 43, 3.2, 6)
  ctx.fillStyle = css(claro(METAL, 0.4))
  ctx.fillRect(CX - 1.6, 43, 1, 6)
  sombrear(ctx, cab, x0 + 1, x0 + w - 1, 29, yC - 3.5, { brilho: 1.5, forca: 1.1 })
  contorno(ctx, cab, 0.55, 0.9)
}

type Pt = [number, number]

/** Polígono com cantos arredondados (arcTo entre os pontos). */
function poliRedondo(pts: Pt[], r: number): Path2D {
  const p = new Path2D()
  const n = pts.length
  const meio = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const ini = meio(pts[n - 1], pts[0])
  p.moveTo(ini[0], ini[1])
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    p.arcTo(a[0], a[1], b[0], b[1], r)
  }
  p.closePath()
  return p
}

/** Livreto deitado em cima da bandeja (vista de cima), com sombra e a marca em letreiro. */
function livretoDeitado(ctx: Ctx, cx: number, cy: number, w: number, h: number, p: Paleta, e: Extra) {
  const x = cx - w / 2
  const y = cy - h / 2
  pintar(ctx, ret(x + 1.6, y + 2.2, w, h, 1), preto(0.42))
  // folhas aparecendo na borda de baixo
  pintar(ctx, ret(x + 0.8, y + h - 0.6, w - 1.6, 1.6, 0.4), p.detalhe)
  const capa = ret(x, y, w, h, 1)
  pintar(ctx, capa, p.faixa)
  // aba: o último quarto, um tom acima, com a linha da dobra
  const xa = x + w * 0.74
  ctx.save()
  ctx.clip(capa)
  ctx.fillStyle = css(claro(p.faixa, 0.1))
  ctx.fillRect(xa, y, x + w - xa, h)
  ctx.fillStyle = preto(0.45)
  ctx.fillRect(xa, y, 0.9, h)
  ctx.restore()
  sombraPlana(ctx, capa, x, x + w, y, y + h, 0.7)
  contorno(ctx, capa, 0.5, 0.8)
  const meio = (x + 2 + xa - 1) / 2
  const escrito = !!e.marca && letreiro(ctx, e.marca, meio, cy, xa - x - 4, h - 4, p.detalhe)
  if (!escrito) filete(ctx, meio, cy - 1, (xa - x) * 0.6, 2, p.detalhe)
}

/**
 * Bandeja de enrolar vista quase de cima (o lado de longe só 6% mais estreito), girada uns 8°:
 * retângulo de cantos redondos com borda elevada (luz na aresta de cima, sombra embaixo e a
 * espessura aparecendo), estampa central simples. Por cima, um livreto e uma piteira deitados.
 */
function bandeja(ctx: Ctx, p: Paleta, e: Extra) {
  const W = 56
  const H = 84
  const longe = 0.94
  const borda = 4.4
  const r = rampa(p.corpo)
  const forma = (m: number, raio: number) => {
    const a = W / 2 - m
    const b = H / 2 - m
    return poliRedondo(
      [
        [-a * longe, -b],
        [a * longe, -b],
        [a, b],
        [-a, b],
      ],
      raio,
    )
  }

  ctx.save()
  ctx.translate(CX, 80)
  ctx.rotate(-0.14)
  const fora = forma(0, 6.5)
  // espessura: a mesma forma um pouco abaixo, no tom mais fundo (levanta a bandeja do preto)
  ctx.save()
  ctx.translate(0, 2.8)
  pintar(ctx, fora, r.funda)
  ctx.restore()
  // topo da borda
  pintar(ctx, fora, claro(p.corpo, 0.1))
  // aresta: luz em cima, sombra embaixo (1 a 2 px de arte)
  ctx.save()
  ctx.clip(fora)
  const ga = ctx.createLinearGradient(0, -H / 2, 0, H / 2)
  ga.addColorStop(0, css(r.luz))
  ga.addColorStop(0.3, css(r.luz, 0))
  ga.addColorStop(0.7, css(r.meia, 0))
  ga.addColorStop(1, css(r.meia))
  ctx.strokeStyle = ga
  ctx.lineWidth = 3
  ctx.stroke(fora)
  ctx.restore()

  // fundo rebaixado: a borda faz sombra em cima e à esquerda, a parede de baixo pega luz
  const fundo = forma(borda, 3.5)
  pintar(ctx, fundo, p.corpo)
  ctx.save()
  ctx.clip(fundo)
  ctx.fillStyle = preto(0.34)
  ctx.fillRect(-W, -H / 2 + borda, W * 2, 2.2)
  ctx.fillStyle = preto(0.18)
  ctx.fillRect(-W / 2, -H, borda + 1.6, H * 2)
  ctx.fillStyle = css(r.luz, 0.55)
  ctx.fillRect(-W, H / 2 - borda - 1.3, W * 2, 1.3)
  // estampa central simples: moldura fina e um selo redondo
  ctx.strokeStyle = css(p.faixa, 0.85)
  ctx.lineWidth = 0.9
  ctx.stroke(forma(borda + 4.5, 2))
  ctx.lineWidth = 2.2
  ctx.stroke(elipse(0, 12, 9.5, 9.5))
  pintar(ctx, elipse(0, 12, 3, 3), p.faixa)
  // brilho largo e fraco na diagonal (metal pintado)
  const gd = ctx.createLinearGradient(-W / 2, -H / 2, W / 2, H / 2)
  gd.addColorStop(0.18, branco(0))
  gd.addColorStop(0.26, branco(0.12))
  gd.addColorStop(0.34, branco(0))
  gd.addColorStop(0.7, preto(0))
  gd.addColorStop(1, preto(0.22))
  ctx.fillStyle = gd
  ctx.fillRect(-W, -H, W * 2, H * 2)
  ctx.restore()
  contorno(ctx, fora)
  ctx.restore()

  // por cima: livreto deitado reto (letreiro na grade) e uma piteira enrolada
  livretoDeitado(ctx, CX - 2, 62, 40, 17, p, e)
  piteiraEnrolada(ctx, CX + 9, 104, -0.55, 12, 3.6, p.detalhe, true)
}

/* ================================================================ API */

const DESENHOS: Record<TipoArte, (ctx: Ctx, p: Paleta, e: Extra) => void> = {
  lata: (ctx, p) => lata(ctx, p, false),
  'lata-alta': (ctx, p) => lata(ctx, p, true),
  'garrafa-quadrada': garrafaQuadrada,
  'garrafa-gin': garrafaGin,
  'garrafa-conhaque': garrafaConhaque,
  'garrafa-licor': garrafaLicor,
  seda,
  'piteira-vidro': piteiraVidro,
  'piteira-papel': piteiraPapel,
  cuia,
  dichavador,
  isqueiro,
  bandeja,
}

/** Quanto cada tipo cresce no quadro (garrafas = 1, já ocupam a altura). */
const ESCALA: Partial<Record<TipoArte, number>> = {
  lata: 1.14,
  'lata-alta': 1.03,
  seda: 1.06,
  'piteira-vidro': 1.04,
  'piteira-papel': 1.06,
  cuia: 1.12,
  dichavador: 1.16,
  isqueiro: 1.05,
}

export interface ExtrasDesenho {
  /** Nome do produto: dele sai a marca escrita na embalagem (RAW, OCB, Smoking, Clipper) e o
   *  formato (seda slim). Sem nome, o desenho sai sem letreiro. */
  nome?: string
}

/**
 * Desenha o produto centralizado em w×h (pensado para 9:16 em baixa resolução, ex.: 90×160),
 * fundo transparente. Tipo desconhecido cai na lata (melhor uma lata que um buraco).
 */
export function desenharArte(ctx: CanvasRenderingContext2D, arte: Arte, w: number, h: number, extras: ExtrasDesenho = {}): void {
  ctx.save()
  ctx.scale(w / U, h / V)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'butt'
  const desenho = DESENHOS[arte.tipo] ?? DESENHOS.lata
  // Lata e acessório são menores que garrafa na vida real; no story eles aparecem grandes.
  const k = ESCALA[arte.tipo] ?? 1
  if (k !== 1) {
    ctx.translate(CX, V / 2)
    ctx.scale(k, k)
    ctx.translate(-CX, -V / 2)
  }
  const nome = extras.nome ?? ''
  desenho(ctx, paleta(arte), { nome, marca: marcaDoNome(nome) })
  ctx.restore()
}

/** Tipos com metal à mostra (tampa de lata, cabeça de isqueiro). */
const COM_METAL: ReadonlySet<TipoArte> = new Set<TipoArte>(['lata', 'lata-alta', 'isqueiro'])

/**
 * As cores do desenho, para a paleta curta do dither: a rampa do corpo, cada cor da arte com o seu
 * tom escuro e o metal. Letreiro e relevo são pintados com estas cores exatas e saem lisos.
 */
export function paletaDoDesenho(arte: Arte): [number, number, number][] {
  const p = paleta(arte)
  const r = rampa(p.corpo)
  const cores: RGB[] = [r.luz, r.base, r.meia, r.funda]
  for (const hex of [arte.faixa, arte.rotulo, arte.detalhe, arte.tampa]) {
    if (!hex) continue
    const c = rgb(hex, BRANCO)
    cores.push(c, escuro(c, 0.45))
  }
  if (COM_METAL.has(arte.tipo)) cores.push(claro(METAL, 0.45), METAL, escuro(METAL, 0.45))
  return cores.map((c) => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])])
}
