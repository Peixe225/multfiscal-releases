// Um canvas de mentira, só com o que o motor da rua usa (fillRect preto ou cinza, drawImage em pixel inteiro sem
// suavizar): o build desenha o pôster da rua com ele, no Node, com o mesmo motor e o mesmo roteiro da página. Na arte
// da rua todo pixel é cheio ou vazio (alfa 255 ou 0), então "por cima" é copiar o pixel cheio.

/** Imagem crua (RGBA), como sai do montar.ts sem createImageBitmap. */
export interface ImagemCrua {
  w: number
  h: number
  dados: Uint8ClampedArray
}

export class TelaFalsa {
  width = 0
  height = 0
  dados = new Uint8ClampedArray(0)

  constructor(w = 0, h = 0) {
    this.width = w
    this.height = h
  }

  /** Os pixels, do tamanho atual (o motor muda width/height depois de criar). */
  pixels(): Uint8ClampedArray {
    const n = this.width * this.height * 4
    if (this.dados.length !== n) this.dados = new Uint8ClampedArray(n)
    return this.dados
  }

  getContext(): ContextoFalso {
    return new ContextoFalso(this)
  }
}

function rgb(css: string): [number, number, number] {
  const n = parseInt(css.slice(1), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}

export class ContextoFalso {
  imageSmoothingEnabled = false
  fillStyle = '#000'
  private tela: TelaFalsa
  constructor(tela: TelaFalsa) {
    this.tela = tela
  }

  fillRect(x: number, y: number, w: number, h: number) {
    const t = this.tela
    const d = t.pixels()
    const [r, g, b] = rgb(this.fillStyle)
    for (let j = Math.max(0, y); j < Math.min(t.height, y + h); j++)
      for (let i = Math.max(0, x); i < Math.min(t.width, x + w); i++) {
        const o = (j * t.width + i) * 4
        d[o] = r
        d[o + 1] = g
        d[o + 2] = b
        d[o + 3] = 255
      }
  }

  /** drawImage(img, dx, dy) ou drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh), sempre 1:1. */
  drawImage(img: TelaFalsa | ImagemCrua, ...n: number[]) {
    const fonte = img instanceof TelaFalsa ? { w: img.width, h: img.height, dados: img.pixels() } : img
    const [sx, sy, sw, sh, dx, dy] = n.length === 2 ? [0, 0, fonte.w, fonte.h, n[0], n[1]] : n
    const t = this.tela
    const d = t.pixels()
    for (let j = 0; j < sh; j++) {
      const yy = dy + j
      const ys = sy + j
      if (yy < 0 || yy >= t.height || ys < 0 || ys >= fonte.h) continue
      for (let i = 0; i < sw; i++) {
        const xx = dx + i
        const xs = sx + i
        if (xx < 0 || xx >= t.width || xs < 0 || xs >= fonte.w) continue
        const s = (ys * fonte.w + xs) * 4
        if (fonte.dados[s + 3] < 128) continue
        const o = (yy * t.width + xx) * 4
        d[o] = fonte.dados[s]
        d[o + 1] = fonte.dados[s + 1]
        d[o + 2] = fonte.dados[s + 2]
        d[o + 3] = 255
      }
    }
  }
}
