// Estúdio do produto: aplica a decisão (recorte.ts) no tamanho que for — a prévia pequena enquanto mexe, o final de
// 720×1280 no "Usar assim". Enquadra no 9:16 com as margens das ilustrações do site, refaz a borda na resolução de saída
// (1–2 px suaves, com o fundo descontado da cor da borda: sem auréola branca), ajusta a cor e dá uma nitidez leve.
// Sem fundo: sai com transparência (o site põe o halo e o preto). Mantendo o fundo: o quadro inteiro, com as bordas
// escurecendo até o preto (no site, o preto some no preto).

import { abrirFoto } from '../foto-medida'
import { LINEAR, deOklab, oklab, paraSrgb } from './cor'
import { noModelo, SEM_AJUSTE, type AjusteCor, type Analise, type Caixa, type Recorte } from './recorte'

/** O tamanho final da foto do produto (9:16, como o viewBox 360×640 das ilustrações, em dobro). */
export const SAIDA = { w: 720, h: 1280 }

/**
 * Onde o produto fica no quadro, medido nas 17 ilustrações do site (viewBox 360×640): centrado na largura, o meio a
 * 51,5% da altura, até 76% da altura (as garrafas vão de 75 a 82%, as latas 67%) e 88% da largura (os largos, 85–91%).
 */
export const MOLDE = { cx: 0.5, cy: 0.515, alt: 0.76, larg: 0.88 }

/** Enquadramento: centro (px da foto), escala (px de saída num quadro de 1280 de altura por px da foto) e o ajuste fino. */
export interface Quadro {
  cx: number
  cy: number
  escala: number
  /** Deslocamento, em fração da largura e da altura do quadro. */
  dx: number
  dy: number
}

/* ---------------------------------------------------------------- canvas */

export function novoCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

export function contexto(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('canvas 2d indisponível')
  return g
}

/**
 * Abre a foto (a orientação do celular já aplicada). Com `lado`, já reduzida (lado maior até ele) quando o navegador
 * sabe: a foto de 50 a 200 megapixels não passa inteira pela memória do celular (src/painel/foto-medida.ts).
 */
export async function abrirImagem(blob: Blob, lado?: number): Promise<{ img: CanvasImageSource; w: number; h: number; soltar: () => void }> {
  return abrirFoto(blob, lado)
}

/** Cópia com o lado maior até `lado` px (nunca aumenta). */
export function reduzir(img: CanvasImageSource, w: number, h: number, lado: number): HTMLCanvasElement {
  const k = Math.min(1, lado / Math.max(w, h))
  const c = novoCanvas(w * k, h * k)
  const g = contexto(c)
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.drawImage(img, 0, 0, c.width, c.height)
  return c
}

/** 90° no sentido do relógio. */
export function girar90(c: HTMLCanvasElement): HTMLCanvasElement {
  const r = novoCanvas(c.height, c.width)
  const g = contexto(r)
  g.translate(r.width, 0)
  g.rotate(Math.PI / 2)
  g.drawImage(c, 0, 0)
  return r
}

function paraBlob(c: HTMLCanvasElement, tipo: string, q?: number): Promise<Blob | null> {
  return new Promise((ok) => c.toBlob(ok, tipo, q))
}

/** WebP (com transparência); o Safari antigo não gera WebP no canvas e cai pro PNG. */
export async function exportar(c: HTMLCanvasElement): Promise<{ blob: Blob; nome: string }> {
  const webp = await paraBlob(c, 'image/webp', 0.9)
  if (webp && webp.type === 'image/webp') return { blob: webp, nome: 'produto.webp' }
  const png = await paraBlob(c, 'image/png')
  if (!png) throw new Error('não deu pra gerar a imagem')
  return { blob: png, nome: 'produto.png' }
}

/* ---------------------------------------------------------------- enquadramento */

/** O quadro que põe a caixa do produto (px da foto) no molde das ilustrações; sem caixa, a foto inteira cabendo. */
export function quadroAutomatico(fw: number, fh: number, caixa: Caixa | null): Quadro {
  if (!caixa) return { cx: fw / 2, cy: fh / 2, escala: Math.min(SAIDA.h / fh, SAIDA.w / fw) * 0.98, dx: 0, dy: 0.5 - MOLDE.cy }
  const bw = Math.max(1, caixa.x1 - caixa.x0)
  const bh = Math.max(1, caixa.y1 - caixa.y0)
  return { cx: (caixa.x0 + caixa.x1) / 2, cy: (caixa.y0 + caixa.y1) / 2, escala: Math.min((MOLDE.alt * SAIDA.h) / bh, (MOLDE.larg * SAIDA.w) / bw), dx: 0, dy: 0 }
}

/** [escala, tx, ty]: saída = escala · foto + t, num quadro w×h. */
export function transformar(q: Quadro, w: number, h: number): [number, number, number] {
  const s = (q.escala * h) / SAIDA.h
  return [s, w * (MOLDE.cx + q.dx) - s * q.cx, h * (MOLDE.cy + q.dy) - s * q.cy]
}

/* ---------------------------------------------------------------- render */

export interface Render {
  /** A foto inteira (já girada), no tamanho de trabalhar (até ~2000 px). */
  fonte: HTMLCanvasElement
  an: Analise
  /** null = manter o fundo. */
  rec: Recorte | null
  quadro: Quadro
  cor: AjusteCor
  /** Nitidez (0 = nenhuma; 0,35 no final). */
  nitidez: number
  w: number
  h: number
}

/** A foto tratada, w×h, RGBA com transparência (ou opaca, mantendo o fundo). */
export function renderizar(r: Render): ImageData {
  const { fonte, an, rec, quadro, w: W, h: H } = r
  const [s, tx, ty] = transformar(quadro, W, H)
  const c = novoCanvas(W, H)
  const g = contexto(c)
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.setTransform(s, 0, 0, s, tx, ty)
  g.drawImage(fonte, 0, 0)
  const img = g.getImageData(0, 0, W, H)
  const d = img.data
  if (rec) {
    // a máscara (resolução da análise) levada pro quadro, suavizada no caminho
    const kx = an.w / fonte.width
    const ky = an.h / fonte.height
    const m = novoCanvas(an.w, an.h)
    const mg = contexto(m)
    const md = mg.createImageData(an.w, an.h)
    for (let p = 0; p < an.w * an.h; p++) {
      const i = p * 4
      md.data[i] = 255
      md.data[i + 1] = 255
      md.data[i + 2] = 255
      md.data[i + 3] = rec.fundo[p] ? 0 : 255
    }
    mg.putImageData(md, 0, 0)
    const u = novoCanvas(W, H)
    const ug = contexto(u)
    ug.imageSmoothingEnabled = true
    ug.imageSmoothingQuality = 'high'
    ug.setTransform(s / kx, 0, 0, s / ky, tx, ty)
    ug.drawImage(m, 0, 0)
    const ua = ug.getImageData(0, 0, W, H).data
    refinarBorda(d, ua, W, H, an, s, tx, ty, kx, ky)
  } else {
    vinheta(d, W, H)
  }
  if (r.cor !== SEM_AJUSTE) aplicarCor(d, W * H, r.cor)
  if (r.nitidez > 0) nitidez(d, W, H, r.nitidez)
  return img
}

/**
 * A borda na resolução de saída: o miolo (máscara cheia) fica, o lado de fora sai e, na faixa entre os dois, cada pixel
 * é a mistura da cor do produto ali perto (F) com a do fundo modelado (B): a fração de produto (α) sai da projeção
 * da cor do pixel no segmento B→F, e a cor dele vira (C − (1−α)·B)/α (o fundo descontado: some a auréola clara).
 */
function refinarBorda(d: Uint8ClampedArray, ua: Uint8ClampedArray, W: number, H: number, an: Analise, s: number, tx: number, ty: number, kx: number, ky: number): void {
  const n = W * H
  // a máscara ampliada vem em degraus (cada pixel da análise vira um bloco): borrada na medida do bloco, o contorno
  // arredonda e a faixa da borda fica com a largura do bloco
  const bloco = s / kx
  const alfa0 = borrar(ua, W, H, Math.max(1, Math.round(bloco * 0.6)))
  const cheio = new Uint8Array(n)
  for (let p = 0; p < n; p++) cheio[p] = alfa0[p] >= 250 && d[p * 4 + 3] >= 248 ? 1 : 0
  const raio = Math.max(2, Math.min(7, Math.ceil(bloco) + 1))
  const B = [0, 0, 0]
  const sx = 2 / Math.max(1, an.w - 1)
  const sy = 2 / Math.max(1, an.h - 1)
  for (let p = 0; p < n; p++) {
    const i = p * 4
    const a = alfa0[p]
    const fonteA = d[i + 3]
    if (an.recortada) {
      d[i + 3] = Math.min(ua[i + 3], fonteA)
      continue
    }
    if (a >= 250) continue
    if (a <= 5) {
      d[i + 3] = 0
      continue
    }
    const x = p % W
    const y = (p / W) | 0
    // o fundo modelado nesse ponto
    const wx = ((x + 0.5 - tx) / s) * kx
    const wy = ((y + 0.5 - ty) / s) * ky
    noModelo(an.modelo.rgb, wx * sx - 1, wy * sy - 1, B)
    const b0 = Math.min(1, Math.max(0, B[0]))
    const b1 = Math.min(1, Math.max(0, B[1]))
    const b2 = Math.min(1, Math.max(0, B[2]))
    // a cor do produto ali perto: média do miolo na janela
    let f0 = 0
    let f1 = 0
    let f2 = 0
    let nf = 0
    for (let yy = Math.max(0, y - raio); yy <= Math.min(H - 1, y + raio); yy++)
      for (let xx = Math.max(0, x - raio); xx <= Math.min(W - 1, x + raio); xx++) {
        const q = yy * W + xx
        if (!cheio[q]) continue
        f0 += LINEAR[d[q * 4]]
        f1 += LINEAR[d[q * 4 + 1]]
        f2 += LINEAR[d[q * 4 + 2]]
        nf++
      }
    const c0 = LINEAR[d[i]]
    const c1 = LINEAR[d[i + 1]]
    const c2 = LINEAR[d[i + 2]]
    let alfa = a / 255
    if (nf) {
      f0 /= nf
      f1 /= nf
      f2 /= nf
    } else {
      f0 = c0
      f1 = c1
      f2 = c2
    }
    const g0 = f0 - b0
    const g1 = f1 - b1
    const g2 = f2 - b2
    const n2 = g0 * g0 + g1 * g1 + g2 * g2
    if (nf && n2 > 0.002) {
      // produto e fundo bem diferentes: vale a cor (o contorno segue o pixel de verdade); parecidos, vale a máscara
      const proj = Math.min(1, Math.max(0, ((c0 - b0) * g0 + (c1 - b1) * g1 + (c2 - b2) * g2) / n2))
      const confia = Math.min(1, (n2 - 0.002) / 0.02)
      alfa = proj * confia + (a / 255) * (1 - confia)
    }
    if (alfa < 0.03) {
      d[i + 3] = 0
      continue
    }
    // descontamina: tira a parte do fundo da cor; com pouco produto, puxa pra cor do produto vizinho
    const t = Math.min(1, alfa / 0.5)
    const u0 = Math.min(1, Math.max(0, (c0 - (1 - alfa) * b0) / alfa))
    const u1 = Math.min(1, Math.max(0, (c1 - (1 - alfa) * b1) / alfa))
    const u2 = Math.min(1, Math.max(0, (c2 - (1 - alfa) * b2) / alfa))
    d[i] = paraSrgb(f0 * (1 - t) + u0 * t)
    d[i + 1] = paraSrgb(f1 * (1 - t) + u1 * t)
    d[i + 2] = paraSrgb(f2 * (1 - t) + u2 * t)
    d[i + 3] = Math.round(alfa * fonteA)
  }
}

/** O alfa (canal 4 do RGBA) borrado numa caixa de lado 2r+1 (separável). */
function borrar(rgba: Uint8ClampedArray, W: number, H: number, r: number): Uint8ClampedArray {
  const a = new Float32Array(W * H)
  for (let p = 0; p < W * H; p++) a[p] = rgba[p * 4 + 3]
  const t = new Float32Array(W * H)
  const out = new Uint8ClampedArray(W * H)
  const lado = 2 * r + 1
  for (let y = 0; y < H; y++) {
    let soma = 0
    for (let x = -r; x <= r; x++) soma += a[y * W + Math.min(W - 1, Math.max(0, x))]
    for (let x = 0; x < W; x++) {
      t[y * W + x] = soma / lado
      soma += a[y * W + Math.min(W - 1, x + r + 1)] - a[y * W + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < W; x++) {
    let soma = 0
    for (let y = -r; y <= r; y++) soma += t[Math.min(H - 1, Math.max(0, y)) * W + x]
    for (let y = 0; y < H; y++) {
      out[y * W + x] = soma / lado
      soma += t[Math.min(H - 1, y + r + 1) * W + x] - t[Math.max(0, y - r) * W + x]
    }
  }
  return out
}

/** Mantendo o fundo: as bordas escurecem até o preto (elipse do quadro) e o que ficou fora da foto é preto. */
function vinheta(d: Uint8ClampedArray, W: number, H: number): void {
  const cx = W / 2
  const cy = H * MOLDE.cy
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const r = Math.hypot((x + 0.5 - cx) / (W / 2), (y + 0.5 - cy) / (H / 2))
      const t = Math.min(1, Math.max(0, (r - 0.55) / 0.42))
      const v = (1 - t * t * (3 - 2 * t)) * (d[i + 3] / 255)
      d[i] *= v
      d[i + 1] *= v
      d[i + 2] *= v
      d[i + 3] = 255
    }
}

/** Níveis e saturação em OKLab (o tom não muda), com joelho suave no claro. */
function aplicarCor(d: Uint8ClampedArray, n: number, a: AjusteCor): void {
  const lab = [0, 0, 0]
  const rgb = [0, 0, 0]
  for (let p = 0; p < n; p++) {
    const i = p * 4
    if (!d[i + 3]) continue
    oklab(LINEAR[d[i]], LINEAR[d[i + 1]], LINEAR[d[i + 2]], lab)
    let L = a.base + (lab[0] - a.de) * a.ganho
    if (L > 90) L = 90 + (L - 90) * 0.45
    if (L < 0) L = 0
    deOklab(L, lab[1] * a.sat, lab[2] * a.sat, rgb)
    d[i] = paraSrgb(rgb[0])
    d[i + 1] = paraSrgb(rgb[1])
    d[i + 2] = paraSrgb(rgb[2])
  }
}

/** Máscara de nitidez (3×3) só no miolo do produto (a borda já foi refeita). */
function nitidez(d: Uint8ClampedArray, W: number, H: number, k: number): void {
  const orig = new Uint8ClampedArray(d)
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x
      const i = p * 4
      if (orig[i + 3] < 255 || orig[i - 4 + 3] < 255 || orig[i + 4 + 3] < 255 || orig[i - W * 4 + 3] < 255 || orig[i + W * 4 + 3] < 255) continue
      for (let c = 0; c < 3; c++) {
        let soma = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) soma += orig[i + (dy * W + dx) * 4 + c]
        const v = orig[i + c]
        d[i + c] = v + k * (v - soma / 9)
      }
    }
}

/** Antes: a foto como veio, cabendo no quadro (como o site mostraria a original). */
export function renderizarOriginal(fonte: HTMLCanvasElement, W: number, H: number): HTMLCanvasElement {
  const c = novoCanvas(W, H)
  const g = contexto(c)
  const k = Math.min(W / fonte.width, H / fonte.height)
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.drawImage(fonte, (W - fonte.width * k) / 2, (H - fonte.height * k) / 2, fonte.width * k, fonte.height * k)
  return c
}
