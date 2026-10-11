// A linguagem visual do produto no site, sem CSS nem React: o halo pontilhado (Bayer) da cor do produto e a sintonia
// (chiado → pixel art → produto real). O ProdutoVisual usa no site; o Estúdio do produto (painel) usa na prévia, pra ela
// ser a mesma coisa que o cliente vê.

/* ---------------------------------------------------------------- Bayer 8×8 */

export const BAYER = (() => {
  const m = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ]
  return (x: number, y: number) => (m[y & 7][x & 7] + 0.5) / 64
})()

/* ---------------------------------------------------------------- halo pontilhado */

export function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Trava de matiz: verde e roxo viram cinza (verde só no ✅; nada de roxo). Também pinta o confete do prêmio. */
export function corDoHalo(hex: string, cinza: boolean): [number, number, number] {
  if (cinza) return [150, 150, 150]
  const [r, g, b] = hexRgb(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d < 18) return [r, g, b]
  let h = 0
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h = (h * 60 + 360) % 360
  if ((h > 75 && h < 165) || (h > 255 && h < 300)) return [168, 168, 168]
  return [r, g, b]
}

const halos = new Map<string, string>()

/** Halo radial quantizado em Bayer (3 níveis), gerado uma vez por cor e guardado como dataURL. */
export function haloDataUrl(cor: string, cinza: boolean): string {
  const chave = `${cor}|${cinza}`
  const pronto = halos.get(chave)
  if (pronto) return pronto
  const w = 90
  const h = 160
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(w, h)
  const [r, g, b] = corDoHalo(cor, cinza)
  const cx = w / 2
  const cy = h * 0.5
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // elipse um pouco mais alta que larga, como o brilho atrás do produto nos stories
      const dx = (x - cx) / (w * 0.46)
      const dy = (y - cy) / (h * 0.36)
      const dist = Math.sqrt(dx * dx + dy * dy)
      const v = Math.max(0, 1 - dist) ** 1.6 * (cinza ? 0.5 : 0.95)
      if (v <= BAYER(x, y)) continue
      const k = (y * w + x) * 4
      const nivel = v > 0.6 ? 1 : v > 0.3 ? 0.72 : 0.45
      img.data[k] = r
      img.data[k + 1] = g
      img.data[k + 2] = b
      img.data[k + 3] = Math.round(255 * nivel)
    }
  ctx.putImageData(img, 0, 0)
  const url = c.toDataURL('image/png')
  halos.set(chave, url)
  return url
}

/* ---------------------------------------------------------------- revelação */

/**
 * Chiado → pixel art → produto real. A camada de cima (canvas em resolução de pixel) começa como ruído, vira a arte
 * em pixel e some em ordem Bayer, deixando ver a ilustração por baixo.
 */
export function sintonizar(canvas: HTMLCanvasElement, pixel: ImageData, aoMostrarReal: () => void, aoTerminar: () => void): () => void {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    aoMostrarReal()
    aoTerminar()
    return () => {}
  }
  const w = pixel.width
  const h = pixel.height
  canvas.width = w
  canvas.height = h
  const quadro = ctx.createImageData(w, h)
  const src = pixel.data
  const dst = quadro.data
  const dur = 1000
  const t0 = performance.now()
  let raf = 0
  let real = false
  let semente = 1
  const ruido = () => {
    semente = (semente * 16807) % 2147483647
    return semente / 2147483647
  }
  const passo = (agora: number) => {
    const t = Math.min(1, (agora - t0) / dur)
    // 0–0,45: ruído vira pixel art; 0,45–1: pixel art dissolve no produto real
    const a = Math.min(1, t / 0.45)
    const b = t <= 0.45 ? 0 : (t - 0.45) / 0.55
    if (b > 0 && !real) {
      real = true
      aoMostrarReal()
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4
        const lim = BAYER(x, y)
        if (b > lim) {
          dst[k + 3] = 0
          continue
        }
        if (a > lim) {
          dst[k] = src[k]
          dst[k + 1] = src[k + 1]
          dst[k + 2] = src[k + 2]
          dst[k + 3] = src[k + 3]
        } else if (ruido() < 0.16) {
          const v = 90 + Math.floor(ruido() * 150)
          dst[k] = v
          dst[k + 1] = v
          dst[k + 2] = v
          dst[k + 3] = 255
        } else dst[k + 3] = 0
      }
    ctx.putImageData(quadro, 0, 0)
    if (t < 1) raf = requestAnimationFrame(passo)
    else {
      ctx.clearRect(0, 0, w, h)
      aoTerminar()
    }
  }
  raf = requestAnimationFrame(passo)
  // parou no meio (pulou, desmontou): nada do quadro velho fica por cima do produto
  return () => {
    cancelAnimationFrame(raf)
    ctx.clearRect(0, 0, w, h)
  }
}

/**
 * A foto tem transparência (recortada no Estúdio: PNG/WebP com alfa)? Então ela cobre o halo como a ilustração
 * (mistura normal: o halo não vaza nas partes escuras do produto). Sem alfa, fica o lighten: o preto da foto some no
 * preto da página. Lê a imagem já carregada num canvas de 24×42 (barato; fotos do mesmo site, sem bloqueio).
 */
export function temTransparencia(img: HTMLImageElement): boolean {
  try {
    const c = document.createElement('canvas')
    c.width = 24
    c.height = 42
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) return false
    g.drawImage(img, 0, 0, c.width, c.height)
    const d = g.getImageData(0, 0, c.width, c.height).data
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true
    return false
  } catch {
    return false
  }
}
