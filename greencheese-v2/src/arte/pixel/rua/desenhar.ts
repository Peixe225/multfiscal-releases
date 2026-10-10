// Desenho no canvas: cada personagem vira uma prancha (todos os quadros, dos dois lados, a 1 px por pixel), feita
// uma vez; o motor recorta o quadro e amplia com drawImage sem suavizar. Escala sempre inteira e posição em pixel
// inteiro do aparelho, para nenhum pixel sair torto.

import type { Peca } from './compor'
import { ancoraDo, type Lado, type Personagem, type Quadro } from './modelo'

type Tela = HTMLCanvasElement | OffscreenCanvas
type Contexto2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function novaTela(w: number, h: number): Tela {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

const rgba = new Map<string, [number, number, number, number]>()
function cor(css: string): [number, number, number, number] {
  let c = rgba.get(css)
  if (!c) {
    const n = parseInt(css.slice(1), 16)
    c = css === 'transparent' ? [0, 0, 0, 0] : [n >> 16, (n >> 8) & 255, n & 255, 255]
    rgba.set(css, c)
  }
  return c
}

/** Pinta um quadro (índices da paleta) num ImageData. */
export function imagemDoQuadro(per: Personagem, q: Quadro): ImageData {
  const img = new ImageData(per.w, per.h)
  for (let i = 0; i < q.px.length; i++) {
    const ci = q.px[i]
    if (!ci) continue
    img.data.set(cor(per.cores[ci]), i * 4)
  }
  return img
}

export interface Prancha {
  tela: Tela
  /** Canto de cima à esquerda de cada quadro na prancha, por animação e lado. */
  onde(animacao: string, lado: Lado, i: number): { sx: number; sy: number }
}

const pranchas = new WeakMap<Personagem, Prancha>()

/** A prancha do personagem (feita na primeira chamada). Uma linha por animação; o lado esquerdo logo depois. */
export function prancha(per: Personagem): Prancha {
  const pronta = pranchas.get(per)
  if (pronta) return pronta
  const nomes = Object.keys(per.animacoes)
  const colunas = Math.max(...nomes.map((n) => per.animacoes[n].dir.length))
  const tela = novaTela(colunas * per.w, nomes.length * 2 * per.h)
  const ctx = tela.getContext('2d') as Contexto2D
  const linha = new Map<string, number>()
  nomes.forEach((nome, j) => {
    linha.set(nome, j)
    const a = per.animacoes[nome]
    a.dir.forEach((q, i) => ctx.putImageData(imagemDoQuadro(per, q), i * per.w, j * 2 * per.h))
    a.esq.forEach((q, i) => ctx.putImageData(imagemDoQuadro(per, q), i * per.w, (j * 2 + 1) * per.h))
  })
  const p: Prancha = {
    tela,
    onde: (animacao, lado, i) => ({ sx: i * per.w, sy: ((linha.get(animacao) ?? 0) * 2 + (lado === 'esq' ? 1 : 0)) * per.h }),
  }
  pranchas.set(per, p)
  return p
}

/**
 * Desenha o quadro `i` da animação com a âncora (pés) em (x, y), em px do canvas, a `k` px do canvas por pixel da
 * grade. x e y são arredondados; k deve ser inteiro.
 */
export function desenharQuadro(ctx: Contexto2D, per: Personagem, animacao: string, i: number, lado: Lado, x: number, y: number, k: number) {
  const pr = prancha(per)
  const { sx, sy } = pr.onde(animacao, lado, i)
  const a = ancoraDo(per, lado)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(pr.tela, sx, sy, per.w, per.h, Math.round(x - a.x * k), Math.round(y - a.y * k), per.w * k, per.h * k)
}

/** Uma peça solta (ladrilho do cenário) como tela de 1 px por pixel, para repetir com drawImage ou createPattern. */
export function telaDaPeca(pc: Peca, paleta: Record<string, string>): Tela {
  const tela = novaTela(pc.w, pc.h)
  const ctx = tela.getContext('2d') as Contexto2D
  const img = new ImageData(pc.w, pc.h)
  pc.linhas.forEach((l, y) => {
    for (let x = 0; x < pc.w; x++) {
      const c = l[x]
      if (c && c !== '.' && paleta[c]) img.data.set(cor(paleta[c]), (y * pc.w + x) * 4)
    }
  })
  ctx.putImageData(img, 0, 0)
  return tela
}
