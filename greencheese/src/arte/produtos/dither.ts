// Dither ordenado (Bayer), brilho pontilhado, cor dominante e a revelação "do chiado para a imagem".
// Tudo roda em canvas pequeno (a arte tem ~90×160 px): barato o bastante para Android intermediário.

import { movimentoReduzido } from '../../lib/movimento'

type RGB = [number, number, number]

/* ---------------------------------------------------------------- Bayer */

/** Matriz de Bayer n×n (n potência de 2), valores 0..n²-1, linha a linha. */
function matrizBayer(n: number): number[] {
  let m = [0]
  let tam = 1
  while (tam < n) {
    const dobro = tam * 2
    const nova = new Array<number>(dobro * dobro)
    for (let y = 0; y < tam; y++) {
      for (let x = 0; x < tam; x++) {
        const v = m[y * tam + x] * 4
        nova[y * dobro + x] = v
        nova[y * dobro + x + tam] = v + 2
        nova[(y + tam) * dobro + x] = v + 3
        nova[(y + tam) * dobro + x + tam] = v + 1
      }
    }
    m = nova
    tam = dobro
  }
  return m
}

/** Limiares normalizados em (0, 1): (v + 0,5) / n². */
function limiares(n: number): Float32Array {
  const m = matrizBayer(n)
  return Float32Array.from(m, (v) => (v + 0.5) / (n * n))
}

/** Limiar Bayer 8×8 e 4×4, prontos para consulta: BAYER8[(y & 7) * 8 + (x & 7)]. */
export const BAYER8 = limiares(8)
export const BAYER4 = limiares(4)

/* ---------------------------------------------------------------- ruído determinístico */

/** Hash inteiro → [0, 1). Mesmo pixel, mesmo grão: a arte sai igual toda vez (e o cache faz sentido). */
function hash01(x: number, y: number, semente: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(semente, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/* ---------------------------------------------------------------- ditherizar */

export interface OpcoesDither {
  /** Níveis por canal (2..16). Padrão 6: 216 cores, cara de paleta web de 1998. */
  niveis?: number
  /** Indisponível: dessaturado, mais escuro e com menos níveis. */
  cinza?: boolean
  /** Contraste em torno do cinza médio (1 = igual). */
  contraste?: number
  /** Grão (0..0,2): ruído de luminância somado antes do limiar. */
  grao?: number
  /** 8 (padrão, mais tons) ou 4 (padrão mais grosso). */
  matriz?: 4 | 8
  /** Linhas de varredura de VHS: escurece 1 linha a cada 2 (0..0,3). */
  varredura?: number
  /** Semente do grão (troque por produto para o grão não se repetir igual). */
  semente?: number
}

/**
 * Quantiza cada canal em N níveis com limiar Bayer: degradê vira padrão de pixel.
 * A transparência também é pontilhada (0 ou 255), com a matriz deslocada 1 px para não
 * correlacionar com a cor — assim o halo vira pontinhos, não uma névoa.
 * Devolve um ImageData novo; não mexe no original.
 */
export function ditherizar(img: ImageData, opts: OpcoesDither = {}): ImageData {
  const { cinza = false, contraste = 1, grao = 0, matriz = 8, varredura = 0, semente = 7 } = opts
  const niveisBase = Math.min(16, Math.max(2, Math.round(opts.niveis ?? 6)))
  const niveis = cinza ? Math.max(3, niveisBase - 1) : niveisBase
  const passos = niveis - 1
  const lim = matriz === 4 ? BAYER4 : BAYER8
  const lado = matriz === 4 ? 4 : 8
  const masc = lado - 1

  const { width: w, height: h, data: e } = img
  const saida = new ImageData(w, h)
  const s = saida.data

  for (let y = 0; y < h; y++) {
    const linhaLim = (y & masc) * lado
    const escurece = varredura > 0 && (y & 1) === 1 ? 1 - varredura : 1
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const a = e[i + 3]
      if (a === 0) continue
      // Alfa pontilhado com a matriz deslocada 1 px (vizinho de Bayer ≈ limiar + 0,5).
      if (a / 255 <= lim[linhaLim + ((x + 1) & masc)]) continue

      const t = lim[linhaLim + (x & masc)]
      let r = e[i] / 255
      let g = e[i + 1] / 255
      let b = e[i + 2] / 255
      if (contraste !== 1) {
        r = (r - 0.5) * contraste + 0.5
        g = (g - 0.5) * contraste + 0.5
        b = (b - 0.5) * contraste + 0.5
      }
      if (cinza) {
        const l = (0.299 * r + 0.587 * g + 0.114 * b) * 0.6 + 0.04
        r = l
        g = l
        b = l
      }
      if (grao > 0) {
        const n = (hash01(x, y, semente) - 0.5) * grao
        r += n
        g += n
        b += n
      }
      if (escurece !== 1) {
        r *= escurece
        g *= escurece
        b *= escurece
      }
      s[i] = quantizar(r, t, passos)
      s[i + 1] = quantizar(g, t, passos)
      s[i + 2] = quantizar(b, t, passos)
      s[i + 3] = 255
    }
  }
  return saida
}

function quantizar(v: number, t: number, passos: number): number {
  const q = Math.floor(v * passos + t)
  return q <= 0 ? 0 : q >= passos ? 255 : Math.round((q / passos) * 255)
}

/* ---------------------------------------------------------------- cor */

export function hexParaRgb(hex: string): RGB {
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = h.replace(/./g, (c) => c + c)
  const n = parseInt(h.slice(0, 6), 16)
  if (Number.isNaN(n)) return [168, 168, 168]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbParaHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
}

/** Matiz em graus (0..360) e saturação (0..1, modelo HSV). */
function matizSat([r, g, b]: RGB): [number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return [0, 0]
  let m: number
  if (max === r) m = ((g - b) / d) % 6
  else if (max === g) m = (b - r) / d + 2
  else m = (r - g) / d + 4
  m *= 60
  if (m < 0) m += 360
  return [m, d / max]
}

/**
 * Trava de matiz do brilho (PLANO): verde e roxo viram cinza. Verde é só do "DISPONÍVEL ✅";
 * roxo é a cara de site gerado. O produto continua com a cor dele — só o halo perde a cor.
 */
export function travarMatiz(c: RGB): RGB {
  const [m, s] = matizSat(c)
  const verde = m >= 70 && m <= 175
  const roxo = m >= 250 && m <= 320
  if (s < 0.08 || (!verde && !roxo)) return c
  const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
  const resto = 0.12 // um fio da cor original, para o cinza não ficar morto
  return [l + (c[0] - l) * resto, l + (c[1] - l) * resto, l + (c[2] - l) * resto]
}

/**
 * Média dos pixels saturados (para quando há foto). Pixels cinzas, pretos ou estourados
 * não contam; sem pixel saturado, cai na média dos opacos.
 */
export function corDominante(img: ImageData): string {
  const d = img.data
  let sr = 0
  let sg = 0
  let sb = 0
  let peso = 0
  let ar = 0
  let ag = 0
  let ab = 0
  let opacos = 0
  // Pula de 2 em 2 pixels: a média não muda e custa metade.
  for (let i = 0; i < d.length; i += 8) {
    if (d[i + 3] < 200) continue
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    ar += r
    ag += g
    ab += b
    opacos++
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max < 50) continue
    const sat = (max - min) / max
    if (sat < 0.3) continue
    const p = sat * sat * (max / 255)
    sr += r * p
    sg += g * p
    sb += b * p
    peso += p
  }
  if (peso > 0 && peso > opacos * 0.01) return rgbParaHex([sr / peso, sg / peso, sb / peso])
  if (opacos > 0) return rgbParaHex([ar / opacos, ag / opacos, ab / opacos])
  return '#a8a8a8'
}

/* ---------------------------------------------------------------- brilho */

export interface OpcoesBrilho {
  /** 1 = normal; o indisponível usa um halo cinza bem mais fraco. */
  forca?: number
  /** Silhueta do produto (canvas com fundo transparente): o brilho abraça o recorte. */
  silhueta?: CanvasImageSource
}

/**
 * Halo suave da cor do produto, atrás dele: um halo radial largo e fraco e, com a silhueta,
 * um brilho que abraça o recorte (sombra desfocada colorida, como luz saindo da borda).
 * Depois do dither vira pontilhado; fora dele o fundo continua transparente.
 * O 5º argumento aceita um número (força) por compatibilidade.
 */
export function desenharBrilho(ctx: CanvasRenderingContext2D, cor: string, w: number, h: number, opts: number | OpcoesBrilho = {}): void {
  const { forca: f0 = 1, silhueta } = typeof opts === 'number' ? { forca: opts } : opts
  const original = hexParaRgb(cor)
  const c = travarMatiz(original)
  // Halo travado em cinza brilha menos (cinza claro em volta vira moldura branca).
  const forca = c === original ? f0 : f0 * 0.7
  // Normaliza o pico: cor escura ainda brilha, cor clara não estoura.
  const max = Math.max(c[0], c[1], c[2], 1)
  const k = Math.min(2.4, 210 / max)
  const [r, g, b] = c.map((v) => Math.round(v * k))
  const a = (v: number) => `rgba(${r},${g},${b},${Math.min(1, Math.max(0, v * forca))})`

  // 1) ar em volta: radial largo, fraco
  const rx = w * 0.52
  const ry = h * 0.4
  ctx.save()
  ctx.translate(w / 2, h * 0.5)
  ctx.scale(1, ry / rx)
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
  const base = silhueta ? 0.55 : 1
  grad.addColorStop(0, a(0.5 * base))
  grad.addColorStop(0.35, a(0.34 * base))
  grad.addColorStop(0.62, a(0.14 * base))
  grad.addColorStop(0.85, a(0.04 * base))
  grad.addColorStop(1, a(0))
  ctx.fillStyle = grad
  ctx.fillRect(-rx, -rx, rx * 2, rx * 2)
  ctx.restore()

  // 2) brilho colado no recorte: só a sombra é desenhada (a imagem fica fora do canvas)
  if (silhueta) {
    const longe = w * 4
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.shadowOffsetX = longe
    ctx.shadowColor = a(0.7)
    ctx.shadowBlur = Math.max(4, w * 0.16)
    ctx.drawImage(silhueta, -longe, 0, w, h)
    ctx.restore()
  }
}

/** Interpolação linear por paradas [posição, valor] (posições crescentes). */
function paradas(t: number, p: readonly (readonly [number, number])[]): number {
  if (t <= p[0][0]) return p[0][1]
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i][0]) {
      const [t0, v0] = p[i - 1]
      const [t1, v1] = p[i]
      return v0 + ((t - t0) / (t1 - t0)) * (v1 - v0)
    }
  }
  return p[p.length - 1][1]
}

const HALO: readonly (readonly [number, number])[] = [
  [0, 0.28],
  [0.35, 0.19],
  [0.62, 0.08],
  [0.85, 0.022],
  [1, 0],
]

/** Borra a grade no lugar (caixa 3×3, separável), n vezes. */
function borrar(g: Float32Array, gw: number, gh: number, n: number): Float32Array {
  const tmp = new Float32Array(g.length)
  for (let k = 0; k < n; k++) {
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x
        tmp[i] = (g[i] + (x > 0 ? g[i - 1] : 0) + (x < gw - 1 ? g[i + 1] : 0)) / 3
      }
    }
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x
        g[i] = (tmp[i] + (y > 0 ? tmp[i - gw] : 0) + (y < gh - 1 ? tmp[i + gw] : 0)) / 3
      }
    }
  }
  return g
}

/**
 * O mesmo brilho de desenharBrilho, só que em JS direto no ImageData do produto (é o que a arte
 * usa: sem segundo canvas, sem shadowBlur, sem segunda leitura — bem mais leve no Android).
 * Halo radial largo + brilho que abraça a silhueta. Tudo é calculado numa grade pequena
 * (1 célula = f px) e ampliado bilinear. Escreve no próprio ImageData (cada pixel só lê a si
 * mesmo depois da grade pronta) e devolve ele: produto por cima do brilho.
 */
export function aplicarBrilho(img: ImageData, cor: string, forca = 1): ImageData {
  const { width: w, height: h, data: d } = img
  const original = hexParaRgb(cor)
  const c = travarMatiz(original)
  const fz = c === original ? forca : forca * 0.7
  const max = Math.max(c[0], c[1], c[2], 1)
  const k = Math.min(2.4, 210 / max)
  const hr = c[0] * k
  const hg = c[1] * k
  const hb = c[2] * k

  // 1) cobertura do produto por célula, com folga em volta
  const f = Math.max(2, Math.round(w / 18))
  const folga = 3
  const gw = Math.ceil(w / f) + folga * 2
  const gh = Math.ceil(h / f) + folga * 2
  const g = new Float32Array(gw * gh)
  const area = 1 / (f * f * 255)
  for (let y = 0; y < h; y++) {
    const linha = (((y / f) | 0) + folga) * gw + folga
    for (let x = 0; x < w; x++) {
      const a = d[(y * w + x) * 4 + 3]
      if (a) g[linha + ((x / f) | 0)] += a * area
    }
  }
  // 2) brilho justo e largo (borrões) + radial, combinados na grade
  const justo = borrar(Float32Array.from(g), gw, gh, 1)
  const largo = borrar(Float32Array.from(justo), gw, gh, 3)
  const halo = new Float32Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) {
    const dy = (((gy - folga + 0.5) * f) - h * 0.5) / (h * 0.4)
    for (let gx = 0; gx < gw; gx++) {
      const i = gy * gw + gx
      const dx = (((gx - folga + 0.5) * f) - w * 0.5) / (w * 0.52)
      const t = Math.sqrt(dx * dx + dy * dy)
      const radial = t < 1 ? paradas(t, HALO) : 0
      const sj = Math.min(1, justo[i] * 1.5) * 0.46
      const sl = Math.min(1, largo[i] * 2.2) * 0.36
      halo[i] = Math.min(1, (1 - (1 - radial) * (1 - sj) * (1 - sl)) * fz)
    }
  }
  // 3) por pixel: amostra bilinear (índices pré-calculados) e produto por cima
  const ix = new Int32Array(w)
  const fx = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    const p = (x + 0.5) / f - 0.5 + folga
    ix[x] = Math.min(gw - 2, Math.floor(p))
    fx[x] = p - ix[x]
  }
  const s = d
  for (let y = 0; y < h; y++) {
    const py = (y + 0.5) / f - 0.5 + folga
    const iy = Math.min(gh - 2, Math.floor(py))
    const fy = py - iy
    const l0 = iy * gw
    const l1 = l0 + gw
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const a8 = d[i + 3]
      if (a8 === 255) continue
      const j = ix[x]
      const u = fx[x]
      const cima = halo[l0 + j] + (halo[l0 + j + 1] - halo[l0 + j]) * u
      const baixo = halo[l1 + j] + (halo[l1 + j + 1] - halo[l1 + j]) * u
      const ha = cima + (baixo - cima) * fy
      if (ha <= 0.002 && a8 === 0) continue
      const pa = a8 / 255
      const oa = pa + ha * (1 - pa)
      const kh = (ha * (1 - pa)) / oa
      const kp = pa / oa
      s[i] = d[i] * kp + hr * kh
      s[i + 1] = d[i + 1] * kp + hg * kh
      s[i + 2] = d[i + 2] * kp + hb * kh
      s[i + 3] = oa * 255
    }
  }
  return img
}

/* ---------------------------------------------------------------- revelação */

export interface OpcoesRevelar {
  /** ms. Padrão 600. */
  duracao?: number
  aoTerminar?: () => void
}

/**
 * Revela a arte: começa em chiado cinza esparso (mais denso onde o produto vai aparecer) e os
 * pixels finais entram na ordem do limiar Bayer, com um tremido de VHS em faixas no começo.
 * Para sozinha no fim (sem loop contínuo). Devolve "cancelar", que para e deixa a imagem final.
 * Com prefers-reduced-motion, desenha a imagem final direto.
 */
export function revelar(canvas: HTMLCanvasElement, final: ImageData, opts: OpcoesRevelar = {}): () => void {
  const { duracao = 600, aoTerminar } = opts
  const ctx = canvas.getContext('2d')
  const w = final.width
  const h = final.height
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  if (!ctx) {
    aoTerminar?.()
    return () => {}
  }
  if (movimentoReduzido() || duracao <= 0) {
    ctx.putImageData(final, 0, 0)
    aoTerminar?.()
    return () => {}
  }

  const f = final.data
  const quadro = new ImageData(w, h)
  const q = quadro.data
  // Ordem de aparição: limiar Bayer + um pouco por linha (dá textura de varredura).
  // Vinheta: o chiado do fundo é mais denso no meio e some nas bordas (sem retângulo de estática).
  const ordem = new Float32Array(w * h)
  const vinheta = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const linha = hash01(0, y, 31)
    const dy = (y - h * 0.5) / (h * 0.46)
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      ordem[k] = BAYER8[(y & 7) * 8 + (x & 7)] * 0.78 + linha * 0.22
      const dx = (x - w * 0.5) / (w * 0.5)
      vinheta[k] = Math.max(0, 1 - (dx * dx + dy * dy))
    }
  }

  // xorshift barato para o chiado (muda a cada quadro).
  let rng = 0x9e3779b9 ^ (w * 131 + h)
  const aleatorio = () => {
    rng ^= rng << 13
    rng ^= rng >>> 17
    rng ^= rng << 5
    return (rng >>> 0) / 4294967296
  }

  let inicio = -1
  let raf = 0
  let acabou = false

  const terminar = () => {
    acabou = true
    ctx.putImageData(final, 0, 0)
  }

  const passo = (agora: number) => {
    if (inicio < 0) inicio = agora
    const t = Math.min(1, (agora - inicio) / duracao)
    if (t >= 1) {
      terminar()
      aoTerminar?.()
      return
    }
    // Começa devagar e acelera no fim: o produto "trava" no sinal.
    const p = t * t * (1.6 - 0.6 * t)
    const resto = 1 - t
    const densFundo = 0.09 * resto
    const densProduto = 0.4 * resto
    // Tremido de VHS: 1 faixa de linhas deslocada, só na primeira metade.
    let fy0 = -1
    let fy1 = -1
    let desloc = 0
    if (t < 0.55) {
      fy0 = Math.floor(aleatorio() * h)
      fy1 = fy0 + 2 + Math.floor(aleatorio() * 6)
      desloc = Math.round((aleatorio() < 0.5 ? -1 : 1) * (1 + aleatorio() * 3 * resto))
    }
    for (let y = 0; y < h; y++) {
      const dx = y >= fy0 && y < fy1 ? desloc : 0
      for (let x = 0; x < w; x++) {
        const k = y * w + x
        const i = k * 4
        if (ordem[k] < p) {
          const sx = dx === 0 ? x : Math.min(w - 1, Math.max(0, x - dx))
          const j = (y * w + sx) * 4
          q[i] = f[j]
          q[i + 1] = f[j + 1]
          q[i + 2] = f[j + 2]
          q[i + 3] = f[j + 3]
        } else if (aleatorio() < (f[i + 3] > 0 ? densProduto : densFundo * vinheta[k])) {
          const v = 70 + ((aleatorio() * 150) | 0)
          q[i] = v
          q[i + 1] = v
          q[i + 2] = v
          q[i + 3] = 255
        } else {
          q[i + 3] = 0
        }
      }
    }
    ctx.putImageData(quadro, 0, 0)
    raf = requestAnimationFrame(passo)
  }
  raf = requestAnimationFrame(passo)

  return () => {
    if (acabou) return
    cancelAnimationFrame(raf)
    terminar()
  }
}

/* ---------------------------------------------------------------- foto */

/**
 * Foto recortada "sobre preto puro": o preto ligado à borda vira transparente (flood fill a
 * partir das bordas), para o halo aparecer atrás. Preto de dentro do produto (rótulo preto,
 * lata preta) não encosta na borda e fica. A borda do recorte ganha alfa pelo brilho (suave).
 */
export function recortarFundoPreto(img: ImageData, limite = 18): void {
  const { width: w, height: h, data: d } = img
  const fundo = new Uint8Array(w * h)
  const visto = new Uint8Array(w * h)
  const pilha: number[] = []
  const escuro = (k: number) => {
    const i = k * 4
    return d[i + 3] < 12 || Math.max(d[i], d[i + 1], d[i + 2]) <= limite
  }
  const empurrar = (k: number) => {
    if (visto[k]) return
    visto[k] = 1
    pilha.push(k)
  }
  for (let x = 0; x < w; x++) {
    empurrar(x)
    empurrar((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    empurrar(y * w)
    empurrar(y * w + w - 1)
  }
  while (pilha.length) {
    const k = pilha.pop() as number
    if (!escuro(k)) continue
    fundo[k] = 1
    d[k * 4 + 3] = 0
    const x = k % w
    if (x > 0) empurrar(k - 1)
    if (x < w - 1) empurrar(k + 1)
    if (k >= w) empurrar(k - w)
    if (k < w * (h - 1)) empurrar(k + w)
  }
  // borda suave: pixel escuro encostado no fundo fica meio transparente
  const teto = limite * 3
  for (let k = 0; k < w * h; k++) {
    if (fundo[k]) continue
    const x = k % w
    const vizinho = (x > 0 && fundo[k - 1]) || (x < w - 1 && fundo[k + 1]) || (k >= w && fundo[k - w]) || (k < w * (h - 1) && fundo[k + w])
    if (!vizinho) continue
    const i = k * 4
    const m = Math.max(d[i], d[i + 1], d[i + 2])
    if (m < teto) d[i + 3] = Math.round(d[i + 3] * (m / teto))
  }
}
