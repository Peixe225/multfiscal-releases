// Desenho dos produtos em código, enquanto não há foto oficial.
// Cada TipoArte tem um desenho próprio, feito numa grade de 90×160 unidades (9:16) e escalado
// para w×h. Fundo transparente. Sombreado cilíndrico: luz da esquerda, reflexo vertical claro,
// sombra à direita e contorno escuro sutil. O dither (dither.ts) transforma os degradês em
// padrão de pixel; por isso aqui pode (e deve) ter degradê.
// Letras de rótulo são só blocos de pixel: nunca escrever a marca.

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

/** Grade de desenho: 90×160 unidades. */
const U = 90
const V = 160
const CX = U / 2

const BRANCO: RGB = [255, 255, 255]
const PRETO: RGB = [0, 0, 0]
const METAL: RGB = [186, 190, 196]
const TINTA: RGB = [20, 20, 20]

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
  /** Luz rebatida na borda direita. */
  aro?: number
}

/** Sombreado cilíndrico por cima do que já foi pintado, preso à silhueta. */
function sombrear(ctx: Ctx, forma: Path2D, x0: number, x1: number, y0: number, y1: number, s: Sombra = {}) {
  const { forca = 1, brilho = 1, pos = 0.24, aro = 1 } = s
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
  l.addColorStop(pos, branco(Math.min(1, 0.62 * brilho)))
  l.addColorStop(pos + 0.045, branco(0.18 * brilho))
  l.addColorStop(pos + 0.14, branco(0))
  l.addColorStop(0.9, branco(0))
  l.addColorStop(0.955, branco(0.14 * aro))
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

/** Reflexo vertical claro, com as pontas sumindo. */
function reflexo(ctx: Ctx, x: number, y: number, w: number, h: number, a = 0.6) {
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, branco(0))
  g.addColorStop(0.15, branco(a))
  g.addColorStop(0.75, branco(a * 0.8))
  g.addColorStop(1, branco(0))
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
}

/* ---------------------------------------------------------------- letras (blocos) */

/** Pseudoaleatório determinístico a partir de uma semente (letras sempre iguais). */
function sorteio(semente: number) {
  let s = semente * 9301 + 49297
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

interface OpcoesEscrita {
  /** Inclinação (skew) para letra cursiva. */
  inclina?: number
  /** Cor de fundo para "furar" as letras (parece letra, não barra). */
  fundo?: RGB
  semente?: number
  /** Letras por palavra (default: 1 palavra). */
  palavras?: number[]
}

/**
 * Uma "palavra" em blocos de pixel, centrada em cx, ocupando a largura dada.
 * Letras com larguras variadas, algumas furadas. Não escreve nada de verdade.
 */
function escrita(ctx: Ctx, cx: number, y: number, largura: number, altura: number, cor: RGB, o: OpcoesEscrita = {}) {
  const { inclina = 0, fundo, semente = 1 } = o
  const palavras = o.palavras ?? [Math.max(2, Math.round(largura / (altura * 0.8)))]
  const r = sorteio(semente)
  const gap = Math.max(0.5, altura * 0.22)
  const espaco = gap * 2.2
  // larguras relativas das letras, palavra por palavra
  const grupos = palavras.map((n) => Array.from({ length: n }, () => ({ w: 0.7 + r() * 0.6, forma: Math.floor(r() * 6) })))
  const nLetras = palavras.reduce((t, n) => t + n, 0)
  const soma = grupos.flat().reduce((t, l) => t + l.w, 0)
  const k = Math.max(0.2, (largura - gap * (nLetras - palavras.length) - espaco * (palavras.length - 1)) / soma)
  let x = cx - largura / 2
  ctx.save()
  if (inclina) {
    ctx.translate(cx, y + altura)
    ctx.transform(1, 0, -inclina, 1, 0, 0)
    ctx.translate(-cx, -(y + altura))
  }
  grupos.forEach((letras, gi) => {
    letras.forEach((l, li) => {
      const lw = l.w * k
      // cursiva: a primeira letra de cada palavra é maiúscula (mais alta)
      const lh = inclina !== 0 && li === 0 ? altura * 1.35 : altura
      const ly = y + altura - lh
      ctx.fillStyle = css(cor)
      ctx.fillRect(x, ly, lw, lh)
      if (fundo && lw > 1.5 && altura > 2.8) furar(ctx, x, ly, lw, lh, l.forma, fundo)
      x += lw + (li < letras.length - 1 ? gap : 0)
    })
    if (gi < grupos.length - 1) x += espaco
  })
  ctx.restore()
}

/**
 * Recorte que faz o bloco parecer letra (sem ser letra nenhuma):
 * 0 cheio, 1 furo, 2 abertura à direita, 3 dois furos, 4 abertura em cima, 5 abertura embaixo.
 */
function furar(ctx: Ctx, x: number, y: number, w: number, h: number, forma: number, fundo: RGB) {
  ctx.fillStyle = css(fundo)
  const fx = x + w * 0.34
  const fw = w * 0.32
  switch (forma) {
    case 1:
      ctx.fillRect(fx, y + h * 0.28, fw, h * 0.44)
      break
    case 2:
      ctx.fillRect(fx, y + h * 0.3, w * 0.66, h * 0.4)
      break
    case 3:
      ctx.fillRect(fx, y + h * 0.18, fw, h * 0.22)
      ctx.fillRect(fx, y + h * 0.6, fw, h * 0.22)
      break
    case 4:
      ctx.fillRect(fx, y, fw, h * 0.62)
      break
    case 5:
      ctx.fillRect(fx, y + h * 0.38, fw, h * 0.62)
      break
  }
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
 * A estampa da lata sai das cores, pela legibilidade: corpo escuro → selo central;
 * letra clara → fita em onda com letra cursiva; letra escura → faixa diagonal com a letra dentro.
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
  // fita em onda (faixa), atravessando a lata
  const y = ym + 9
  const f = new Path2D()
  f.moveTo(CX - r - 2, y + 7)
  f.bezierCurveTo(CX - 10, y - 9, CX + 3, y + 11, CX + r + 2, y - 7)
  f.lineTo(CX + r + 2, y - 2)
  f.bezierCurveTo(CX + 5, y + 15, CX - 9, y - 2, CX - r - 2, y + 12)
  f.closePath()
  pintar(ctx, f, p.faixa)
  // fio fino acompanhando a fita
  ctx.strokeStyle = css(p.detalhe, 0.9)
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(CX - r - 2, y + 15)
  ctx.bezierCurveTo(CX - 9, y + 1, CX + 5, y + 18, CX + r + 2, y + 1.5)
  ctx.stroke()
  // letra cursiva (detalhe) acima da fita, com a cauda por baixo
  escrita(ctx, CX - 1, ym - 15, 30, 6, p.detalhe, { inclina: 0.32, fundo: p.corpo, semente: 3, palavras: [4, 4] })
  ctx.strokeStyle = css(p.detalhe)
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(CX - 14, ym - 6.5)
  ctx.quadraticCurveTo(CX, ym - 3.5, CX + 13, ym - 8)
  ctx.stroke()
  // sabor, miudinho, abaixo da fita
  escrita(ctx, CX, ym + 26, 16, 2.6, p.faixa, { semente: 8 })
}

function estampaDiagonal(ctx: Ctx, p: Paleta, r: number, ym: number) {
  ctx.save()
  ctx.translate(CX, ym - 1)
  ctx.rotate(-0.34)
  ctx.fillStyle = css(p.faixa)
  ctx.fillRect(-r - 12, -8, (r + 12) * 2, 16)
  ctx.fillRect(-r - 12, -12.5, (r + 12) * 2, 2)
  ctx.fillRect(-r - 12, 10.5, (r + 12) * 2, 1.2)
  escrita(ctx, 0, -3.6, 28, 7, p.detalhe, { fundo: p.faixa, semente: 5, palavras: [2, 6] })
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
  // letras no topo
  escrita(ctx, CX, yC0 + 8, 22, 5, p.detalhe, { fundo: p.corpo, semente: 2 })
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
  escrita(ctx, CX, ym - 7, 17, 5.5, galho, { inclina: 0.3, fundo: p.detalhe, semente: 11, palavras: [6] })
  escrita(ctx, CX, ym + 2, 13, 3, p.faixa, { semente: 4, palavras: [3, 3] })
  filete(ctx, CX, ym + 8, 10, 0.9, galho, 0.8)
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
  // assinatura cursiva
  escrita(ctx, CX, ly + 6.5, 19, 4.4, d, { inclina: 0.35, fundo: p.rotulo, semente: 21, palavras: [4, 5] })
  filete(ctx, CX, ly + 13.6, 16, 0.7, d)
  // "Old" + "Nº 7"
  escrita(ctx, CX, ly + 16, 8, 2.4, d, { semente: 6 })
  ctx.fillStyle = css(d)
  // N
  ctx.fillRect(CX - 10.4, ly + 23, 1.7, 9)
  ctx.fillRect(CX - 6.4, ly + 23, 1.7, 9)
  ctx.fill(poligono([CX - 10.4, ly + 23, CX - 8.7, ly + 23, CX - 4.7, ly + 32, CX - 6.4, ly + 32]))
  // º
  ctx.fillRect(CX - 3.6, ly + 23, 2.4, 2.4)
  ctx.fillRect(CX - 3.6, ly + 26.4, 2.4, 0.8)
  // 7 grande
  ctx.fillRect(CX + 0.4, ly + 21, 9.6, 3)
  ctx.fill(poligono([CX + 10, ly + 21, CX + 10, ly + 24, CX + 5.6, ly + 37, CX + 2.4, ly + 37, CX + 7, ly + 24]))
  // miúdos de baixo
  escrita(ctx, CX, ly + 40.5, 11, 2.2, d, { semente: 9 })
  filete(ctx, CX, ly + 45, 21, 1, d, 0.95)
  filete(ctx, CX, ly + 48, 17, 1, d, 0.85)
  filete(ctx, CX, ly + 51, 11, 1, d, 0.75)
  // rótulo também pega a luz (papel fosco)
  sombraPlana(ctx, rot, lx, lx + lw, ly, ly + lh, 0.55)

  // gargalo: cinta preta com dois filetes brancos
  const cinta = ret(CX - xn - 0.4, 31, (xn + 0.4) * 2, 14.5, 0.6)
  pintar(ctx, cinta, p.rotulo)
  filete(ctx, CX, 33, 10, 0.7, d)
  filete(ctx, CX, 43, 10, 0.7, d)
  escrita(ctx, CX, 36.6, 7, 3, d, { semente: 13 })
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
  escrita(ctx, CX, ry + 5.5, 25, 4.6, TINTA, { fundo: p.rotulo, semente: 17 })
  filete(ctx, CX, ry + 12.6, 22, 0.8, p.detalhe)
  escrita(ctx, CX, ry + 15.4, 18, 2.4, TINTA, { semente: 23, palavras: [3, 3, 3] })
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
  // assinatura cursiva
  escrita(ctx, CX, ly + 9, 22, 5, t, { inclina: 0.3, fundo: p.rotulo, semente: 31, palavras: [8] })
  filete(ctx, CX, ly + 17, 18, 0.7, t, 0.8)
  // "V.S" em pixel
  ctx.fillStyle = css(t)
  ctx.fill(poligono([CX - 10, ly + 21, CX - 7.6, ly + 21, CX - 5.4, ly + 30, CX - 3.2, ly + 21, CX - 0.8, ly + 21, CX - 4.2, ly + 33, CX - 6.6, ly + 33]))
  ctx.fillRect(CX + 0.6, ly + 31, 1.8, 2)
  ctx.fillRect(CX + 3.6, ly + 21, 6.4, 2.2)
  ctx.fillRect(CX + 3.6, ly + 21, 2.2, 6.4)
  ctx.fillRect(CX + 3.6, ly + 25.9, 6.4, 2.2)
  ctx.fillRect(CX + 7.8, ly + 25.9, 2.2, 7.1)
  ctx.fillRect(CX + 3.6, ly + 30.8, 6.4, 2.2)
  escrita(ctx, CX, ly + 37, 20, 2.2, t, { semente: 33, palavras: [4, 5] })
  filete(ctx, CX, ly + 42, 14, 0.9, t, 0.7)
  filete(ctx, CX, ly + 45, 9, 0.9, t, 0.6)

  sombrear(ctx, g, CX - 21.5, CX + 21.5, yN, yF, { brilho: 1.2 })
  reflexo(ctx, CX - 17.5, yC - 2, 1.4, 62, 0.55)

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
  escrita(ctx, CX, ly + 5.5, 24, 4.6, tinta, { fundo: p.rotulo, semente: 41, palavras: [11] })
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
  escrita(ctx, CX, ly + 41, 22, 3.6, tinta, { fundo: p.rotulo, semente: 43, palavras: [5, 4] })
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

/** Livreto de seda: em pé e inclinado, com a aba dobrada e a folha escapando por cima. */
function seda(ctx: Ctx, p: Paleta) {
  ctx.save()
  ctx.translate(CX + 1, 82)
  ctx.rotate(-0.26)
  const w = 31
  const h = 80
  const x = -w / 2
  const y = -h / 2

  // folha escapando (papel claro, translúcido)
  const papel = luma(p.detalhe) > 0.85 ? claro(p.detalhe, 0) : p.detalhe
  ctx.save()
  ctx.rotate(0.07)
  const folha = ret(x + 2.2, y - 9, w - 4.4, 14, 0.4)
  pintar(ctx, folha, papel, 0.95)
  ctx.fillStyle = css(escuro(papel, 0.12), 0.9)
  ctx.fillRect(x + 2.2, y - 9, w - 4.4, 1.6) // tira de cola
  ctx.restore()

  // capa
  const capa = ret(x, y, w, h, 1.6)
  pintar(ctx, capa, p.corpo)
  ctx.save()
  ctx.clip(capa)
  // aba dobrada em cima, com o recorte em V no meio
  const yAba = y + 16
  const aba = poligono([x, y, x + w, y, x + w, yAba, 3.2, yAba, 0, yAba + 3.4, -3.2, yAba, x, yAba])
  pintar(ctx, aba, claro(p.corpo, luma(p.corpo) < 0.1 ? 0.1 : 0.08))
  ctx.strokeStyle = preto(0.55)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, yAba + 0.6)
  ctx.lineTo(-3.2, yAba + 0.6)
  ctx.lineTo(0, yAba + 4)
  ctx.lineTo(3.2, yAba + 0.6)
  ctx.lineTo(x + w, yAba + 0.6)
  ctx.stroke()
  // faixa e letras
  ctx.fillStyle = css(p.faixa)
  ctx.fillRect(x, y + 5.5, w, 2.4)
  ctx.fillRect(x, y + h - 13, w, 1.6)
  // letras gordas empilhadas (texto corre no comprimento do livreto)
  const d = p.detalhe
  ctx.save()
  ctx.translate(0, y + 44)
  ctx.rotate(-Math.PI / 2)
  escrita(ctx, 0, -6, 34, 12, d, { fundo: p.corpo, semente: 51, palavras: [3] })
  ctx.restore()
  escrita(ctx, 0, y + h - 9, 18, 2.6, p.faixa, { semente: 53, palavras: [7] })
  // bordas das folhas embaixo
  ctx.fillStyle = css(papel, 0.65)
  ctx.fillRect(x + 1, y + h - 2.2, w - 2, 0.9)
  ctx.restore()
  sombraPlana(ctx, capa, x, x + w, y, y + h, luma(p.corpo) < 0.1 ? 1.6 : 1)
  // lombada esquerda pega luz, direita na sombra
  ctx.save()
  ctx.clip(capa)
  ctx.fillStyle = branco(0.22)
  ctx.fillRect(x, y, 1.6, h)
  ctx.fillStyle = preto(0.45)
  ctx.fillRect(x + w - 2.2, y, 2.2, h)
  ctx.restore()
  contorno(ctx, capa)
  ctx.restore()
}

/** Tubo de vidro (piteira): corpo transparente, paredes claras, reflexo comprido. */
function tuboVidro(ctx: Ctx, x0: number, x1: number, r: number, cor: RGB, bocaChata = false) {
  const corpo = ret(x0, -r, x1 - x0, r * 2, 0)
  pintar(ctx, corpo, cor, 0.24)
  // paredes (vidro grosso aparece mais claro nas bordas)
  ctx.strokeStyle = css(cor, 0.95)
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.moveTo(x0, -r + 0.7)
  ctx.lineTo(x1, -r + 0.7)
  ctx.moveTo(x0, r - 0.7)
  ctx.lineTo(x1, r - 0.7)
  ctx.stroke()
  // reflexo comprido e um segundo, fraco
  ctx.strokeStyle = branco(0.95)
  ctx.lineWidth = 1.1
  ctx.beginPath()
  ctx.moveTo(x0 + 3, -r * 0.42)
  ctx.lineTo(x1 - 4, -r * 0.42)
  ctx.stroke()
  ctx.strokeStyle = branco(0.35)
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(x0 + 6, r * 0.45)
  ctx.lineTo(x1 - 8, r * 0.45)
  ctx.stroke()
  // bocas
  const ry0 = r
  const ry1 = bocaChata ? r * 0.55 : r
  const rx1 = bocaChata ? r * 0.22 : r * 0.36
  pintar(ctx, elipse(x0, 0, r * 0.36, ry0), cor, 0.18)
  ctx.strokeStyle = css(cor, 0.85)
  ctx.lineWidth = 1.2
  ctx.stroke(elipse(x0, 0, r * 0.36, ry0))
  pintar(ctx, elipse(x1, 0, rx1, ry1), cor, 0.3)
  ctx.strokeStyle = css(claro(cor, 0.5))
  ctx.lineWidth = 1.3
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
  ctx.translate(-4, -9.5)
  tuboVidro(ctx, -50, 50, 5.6, p.corpo)
  ctx.restore()
  ctx.save()
  ctx.translate(-10, 10)
  tuboVidro(ctx, -32, 34, 7, claro(p.corpo, 0.1), true)
  ctx.restore()
  ctx.restore()
}

/** Bloco de piteiras de papel, com uma piteira enrolada na frente. */
function piteiraPapel(ctx: Ctx, p: Paleta) {
  const papel = p.detalhe
  ctx.save()
  ctx.translate(CX - 2, 78)
  ctx.rotate(0.12)
  const w = 42
  const h = 58
  const x = -w / 2
  const y = -h / 2
  // tiras picotadas escapando por cima (zigue-zague)
  const dentes: number[] = [x + 3, y + 4]
  for (let i = 0, dx = x + 3; dx < x + w - 3; i++, dx += 3) dentes.push(dx + 1.5, y - (i % 2 === 0 ? 7 : 4.5))
  dentes.push(x + w - 3, y + 4)
  const tiras = poligono(dentes)
  pintar(ctx, tiras, papel)
  ctx.strokeStyle = css(escuro(papel, 0.35), 0.8)
  ctx.lineWidth = 0.6
  ctx.beginPath()
  for (let dx = x + 6; dx < x + w - 4; dx += 6) {
    ctx.moveTo(dx, y - 4)
    ctx.lineTo(dx, y + 2)
  }
  ctx.stroke()
  contorno(ctx, tiras, 0.4, 0.8)

  const capa = ret(x, y, w, h, 1.4)
  pintar(ctx, capa, p.corpo)
  ctx.save()
  ctx.clip(capa)
  // dobra de cima
  ctx.fillStyle = css(escuro(p.corpo, 0.12))
  ctx.fillRect(x, y, w, 9)
  ctx.fillStyle = preto(0.4)
  ctx.fillRect(x, y + 9, w, 1)
  // letras gordas (faixa) e linha picotada
  escrita(ctx, 0, y + 17, 30, 11, p.faixa, { fundo: p.corpo, semente: 61, palavras: [3] })
  ctx.fillStyle = css(p.faixa, 0.9)
  for (let dx = x + 4; dx < x + w - 4; dx += 3.2) ctx.fillRect(dx, y + 33, 1.8, 1)
  escrita(ctx, 0, y + 37, 24, 2.6, p.faixa, { semente: 63, palavras: [4, 3] })
  filete(ctx, 0, y + 43, 18, 0.9, p.faixa, 0.8)
  ctx.restore()
  sombraPlana(ctx, capa, x, x + w, y, y + h)
  contorno(ctx, capa)
  ctx.restore()

  // piteira enrolada (cilindro deitado), com o "M" do picote na boca
  ctx.save()
  ctx.translate(CX + 12, 116)
  ctx.rotate(-0.42)
  const L = 17
  const r = 5
  const tubo = ret(-L, -r, L * 2, r * 2, 0)
  pintar(ctx, tubo, papel)
  ctx.save()
  ctx.clip(tubo)
  const gt = ctx.createLinearGradient(0, -r, 0, r)
  gt.addColorStop(0, branco(0.2))
  gt.addColorStop(0.3, branco(0.5))
  gt.addColorStop(0.45, branco(0))
  gt.addColorStop(1, preto(0.45))
  ctx.fillStyle = gt
  ctx.fillRect(-L, -r, L * 2, r * 2)
  ctx.restore()
  pintar(ctx, elipse(L, 0, r * 0.42, r), escuro(papel, 0.08))
  ctx.strokeStyle = css(escuro(papel, 0.55))
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(L - 1, -3)
  ctx.lineTo(L + 1, -1.2)
  ctx.lineTo(L - 1, 0.4)
  ctx.lineTo(L + 1, 2)
  ctx.lineTo(L - 0.6, 3.4)
  ctx.stroke()
  const sil = new Path2D()
  sil.addPath(tubo)
  sil.addPath(elipse(L, 0, r * 0.42, r))
  contorno(ctx, sil, 0.5, 0.9)
  ctx.restore()
}

/** Cuia de silicone: tigela vista um pouco de cima, boca elíptica, letras em relevo. */
function cuia(ctx: Ctx, p: Paleta) {
  const y0 = 64 // centro da boca
  const rx = 30
  const ry = 10.5
  const yB = 108
  const base = p.corpo

  // pezinho
  const pe = elipse(CX, yB, 14, 3.8)
  pintar(ctx, pe, escuro(base, 0.35))

  const corpo = new Path2D()
  corpo.moveTo(CX - rx, y0)
  corpo.bezierCurveTo(CX - rx, y0 + 26, CX - 17, yB - 1, CX - 12, yB)
  corpo.lineTo(CX + 12, yB)
  corpo.bezierCurveTo(CX + 17, yB - 1, CX + rx, y0 + 26, CX + rx, y0)
  corpo.ellipse(CX, y0, rx, ry, 0, 0, Math.PI, true)
  corpo.closePath()
  pintar(ctx, corpo, base)
  ctx.save()
  ctx.clip(corpo)
  const gv = ctx.createLinearGradient(0, y0, 0, yB)
  gv.addColorStop(0, branco(0.05))
  gv.addColorStop(1, preto(0.35))
  ctx.fillStyle = gv
  ctx.fillRect(CX - rx, y0, rx * 2, yB - y0)
  // letras em relevo (faixa) com luz embaixo
  ctx.save()
  ctx.translate(0.5, 0.6)
  escrita(ctx, CX, y0 + 18, 26, 9, claro(base, 0.25), { fundo: base, semente: 71, palavras: [3] })
  ctx.restore()
  escrita(ctx, CX, y0 + 18, 26, 9, p.faixa, { fundo: base, semente: 71, palavras: [3] })
  ctx.restore()
  sombrear(ctx, corpo, CX - rx, CX + rx, y0 - ry, yB + 2, { brilho: 0.8, pos: 0.22 })

  // boca: miolo escuro, parede de trás iluminada, lábio grosso
  const boca = elipse(CX, y0, rx - 2.6, ry - 2.2)
  const gb = ctx.createLinearGradient(0, y0 - ry, 0, y0 + ry)
  gb.addColorStop(0, css(claro(base, 0.08)))
  gb.addColorStop(0.45, css(escuro(base, 0.35)))
  gb.addColorStop(1, css(escuro(base, 0.62)))
  pintar(ctx, boca, gb)
  ctx.save()
  ctx.clip(boca)
  pintar(ctx, elipse(CX + 3, y0 + 4.5, rx - 10, ry - 5), escuro(base, 0.72))
  ctx.restore()
  const labio = ctx.createLinearGradient(CX - rx, 0, CX + rx, 0)
  labio.addColorStop(0, css(claro(base, 0.5)))
  labio.addColorStop(0.35, css(claro(base, 0.3)))
  labio.addColorStop(1, css(escuro(base, 0.25)))
  ctx.strokeStyle = labio
  ctx.lineWidth = 2.4
  ctx.stroke(elipse(CX, y0, rx - 1.3, ry - 1.1))
  ctx.strokeStyle = css(p.detalhe, 0.55)
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.ellipse(CX, y0, rx - 1.3, ry - 1.1, 0, Math.PI * 0.85, Math.PI * 1.45)
  ctx.stroke()

  contorno(ctx, corpo)
}

/** Dichavador: cilindro metálico em 4 partes, tampa com borda serrilhada. */
function dichavador(ctx: Ctx, p: Paleta) {
  const R = 26
  const ry = 9
  const yT = 60
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
  // metal escovado: faixas de brilho mais duras que no vidro
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
  // serrilhado da tampa: frisos verticais em projeção cilíndrica
  for (let a = -84; a <= 84; a += 7) {
    const x = CX + R * Math.sin((a * Math.PI) / 180)
    const largura = 0.75 * Math.cos((a * Math.PI) / 180) + 0.2
    ctx.fillStyle = css(p.faixa, 0.85)
    ctx.fillRect(x, yT + 1, largura, 11.5)
    if (a < 20) {
      ctx.fillStyle = branco(0.35)
      ctx.fillRect(x - largura, yT + 1, largura * 0.7, 11.5)
    }
  }
  // sulcos entre as partes
  for (const y of [yT + 13, yT + 25, yT + 36]) {
    ctx.strokeStyle = css(p.faixa)
    ctx.lineWidth = 1.3
    ctx.beginPath()
    ctx.ellipse(CX, y, R, ry, 0, Math.PI * 0.02, Math.PI * 0.98)
    ctx.stroke()
    ctx.strokeStyle = css(p.detalhe, 0.55)
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.ellipse(CX, y + 1.3, R, ry, 0, Math.PI * 0.35, Math.PI * 0.98)
    ctx.stroke()
  }
  ctx.restore()

  // tampa (face de cima)
  const topo = elipse(CX, yT, R, ry)
  const gt = ctx.createLinearGradient(CX - R, yT - ry, CX + R, yT + ry)
  gt.addColorStop(0, css(claro(met, 0.6)))
  gt.addColorStop(0.45, css(claro(met, 0.15)))
  gt.addColorStop(1, css(escuro(met, 0.35)))
  pintar(ctx, topo, gt)
  // anel usinado e um disco central
  ctx.strokeStyle = css(p.faixa, 0.6)
  ctx.lineWidth = 0.8
  ctx.stroke(elipse(CX, yT + 0.3, R - 7, ry - 2.4))
  ctx.strokeStyle = branco(0.4)
  ctx.lineWidth = 0.6
  ctx.stroke(elipse(CX, yT + 1.1, R - 7, ry - 2.4))
  pintar(ctx, elipse(CX, yT + 0.4, 6, 2.1), escuro(met, 0.18))
  // brilho da aresta da tampa (lado da luz)
  ctx.strokeStyle = css(p.detalhe, 0.9)
  ctx.lineWidth = 0.9
  ctx.beginPath()
  ctx.ellipse(CX, yT, R - 0.5, ry - 0.4, 0, Math.PI * 0.95, Math.PI * 1.55)
  ctx.stroke()

  contorno(ctx, lado)
  contorno(ctx, topo, 0.35, 0.8)
}

/** Isqueiro formato Clipper: corpo arredondado colorido e cabeça de metal com a pedra. */
function isqueiro(ctx: Ctx, p: Paleta) {
  const x0 = CX - 14
  const w = 28
  const yC = 59
  const yF = 137

  // corpo
  const corpo = ret(x0, yC, w, yF - yC, [3, 3, 9, 9])
  pintar(ctx, corpo, p.corpo)
  ctx.save()
  ctx.clip(corpo)
  // logo vertical (detalhe) e faixa fina
  ctx.save()
  ctx.translate(CX + 1, yC + 40)
  ctx.rotate(-Math.PI / 2)
  escrita(ctx, 0, -3.6, 34, 7.2, p.detalhe, { fundo: p.corpo, semente: 81, palavras: [7] })
  ctx.restore()
  ctx.fillStyle = css(p.faixa, 0.85)
  ctx.fillRect(x0, yF - 12, w, 1.4)
  // nível de gás (corpo translúcido embaixo)
  ctx.fillStyle = css(claro(p.corpo, 0.25), 0.55)
  ctx.fillRect(x0, yF - 9, w, 9)
  ctx.restore()
  sombrear(ctx, corpo, x0, x0 + w, yC, yF, { brilho: 1.2 })
  contorno(ctx, corpo)

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

/** Bandeja de enrolar em perspectiva (em pé no quadro): borda levantada, estampa no fundo. */
function bandeja(ctx: Ctx, p: Paleta) {
  // cantos de fora: longe (em cima) mais estreito
  const tl: [number, number] = [26, 30]
  const tr: [number, number] = [64, 30]
  const br: [number, number] = [77, 126]
  const bl: [number, number] = [13, 126]
  const q = (u: number, v: number): [number, number] => {
    const xa = tl[0] + (tr[0] - tl[0]) * u
    const xb = bl[0] + (br[0] - bl[0]) * u
    const ya = tl[1] + (tr[1] - tl[1]) * u
    const yb = bl[1] + (br[1] - bl[1]) * u
    return [xa + (xb - xa) * v, ya + (yb - ya) * v]
  }
  const quad = (u0: number, v0: number, u1: number, v1: number) => poligono([...q(u0, v0), ...q(u1, v0), ...q(u1, v1), ...q(u0, v1)])

  // espessura (lateral da frente)
  const lateral = poligono([bl[0], bl[1], br[0], br[1], br[0] - 1.2, br[1] + 5, bl[0] + 1.2, bl[1] + 5])
  pintar(ctx, lateral, escuro(p.corpo, 0.5))
  ctx.fillStyle = css(claro(p.corpo, 0.3), 0.8)
  ctx.fillRect(bl[0] + 1, bl[1] + 0.4, br[0] - bl[0] - 2, 0.8)

  const fora = poligono([...tl, ...tr, ...br, ...bl])
  pintar(ctx, fora, claro(p.corpo, 0.12))
  // paredes internas da borda
  const iu0 = 0.065
  const iu1 = 0.935
  const iv0 = 0.05
  const iv1 = 0.955
  pintar(ctx, poligono([...tl, ...tr, ...q(iu1, iv0), ...q(iu0, iv0)]), claro(p.corpo, 0.38))
  pintar(ctx, poligono([...tl, ...q(iu0, iv0), ...q(iu0, iv1), ...bl]), claro(p.corpo, 0.22))
  pintar(ctx, poligono([...tr, ...br, ...q(iu1, iv1), ...q(iu1, iv0)]), escuro(p.corpo, 0.35))
  pintar(ctx, poligono([...bl, ...q(iu0, iv1), ...q(iu1, iv1), ...br]), escuro(p.corpo, 0.15))

  // fundo da bandeja
  const fundo = quad(iu0, iv0, iu1, iv1)
  pintar(ctx, fundo, p.corpo)
  ctx.save()
  ctx.clip(fundo)
  // estampa: moldura fina, letras gordas e linhas miúdas (em perspectiva)
  ctx.strokeStyle = css(p.faixa, 0.85)
  ctx.lineWidth = 0.8
  ctx.stroke(quad(0.13, 0.09, 0.87, 0.91))
  ctx.fillStyle = css(p.faixa)
  const letras = [
    [0.22, 0.34],
    [0.4, 0.58],
    [0.62, 0.78],
  ]
  letras.forEach(([u0, u1], i) => {
    ctx.fill(quad(u0, 0.3, u1, 0.47))
    ctx.save()
    ctx.fillStyle = css(p.corpo)
    const um = (u0 + u1) / 2
    if (i !== 1) ctx.fill(quad(um - 0.03, 0.35, um + 0.03, 0.42))
    else ctx.fill(quad(um - 0.03, 0.4, um + 0.03, 0.47))
    ctx.restore()
  })
  for (let k = 0; k < 3; k++) {
    const v = 0.56 + k * 0.05
    const meia = 0.26 - k * 0.06
    ctx.fill(quad(0.5 - meia, v, 0.5 + meia, v + 0.014))
  }
  // cones pequenos (motivo de estampa)
  for (const [u, v] of [
    [0.25, 0.78],
    [0.5, 0.8],
    [0.75, 0.78],
  ]) {
    ctx.fill(poligono([...q(u - 0.05, v), ...q(u + 0.05, v), ...q(u + 0.015, v + 0.08), ...q(u - 0.015, v + 0.08)]))
  }
  ctx.restore()
  // brilho metálico em diagonal sobre o fundo
  ctx.save()
  ctx.clip(fundo)
  const gd = ctx.createLinearGradient(20, 40, 70, 120)
  gd.addColorStop(0.18, branco(0))
  gd.addColorStop(0.28, branco(0.28))
  gd.addColorStop(0.36, branco(0))
  gd.addColorStop(0.7, preto(0))
  gd.addColorStop(1, preto(0.3))
  ctx.fillStyle = gd
  ctx.fillRect(0, 0, U, V)
  ctx.restore()
  // aresta clara da borda (lado da luz)
  ctx.strokeStyle = css(p.detalhe, 0.75)
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(bl[0] + 0.6, bl[1] - 0.6)
  ctx.lineTo(tl[0] + 0.5, tl[1] + 0.5)
  ctx.lineTo(tr[0] - 0.5, tr[1] + 0.5)
  ctx.stroke()
  contorno(ctx, fora)
}

/* ================================================================ API */

const DESENHOS: Record<TipoArte, (ctx: Ctx, p: Paleta) => void> = {
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
  'piteira-papel': 1.12,
  cuia: 1.1,
  dichavador: 1.16,
  isqueiro: 1.05,
}

/**
 * Desenha o produto centralizado em w×h (pensado para 9:16 em baixa resolução, ex.: 90×160),
 * fundo transparente. Tipo desconhecido cai na lata (melhor uma lata que um buraco).
 */
export function desenharArte(ctx: CanvasRenderingContext2D, arte: Arte, w: number, h: number): void {
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
  desenho(ctx, paleta(arte))
  ctx.restore()
}
