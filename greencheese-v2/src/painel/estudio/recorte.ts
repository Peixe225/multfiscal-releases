// Estúdio do produto: tirar o fundo, achar o produto e a cor no estilo do site, em pixels (sem DOM). Decide numa cópia
// pequena da foto (até ~480 px no lado maior: rápido no Android intermediário) e o resultado vale pra qualquer tamanho
// (render.ts aplica no tamanho final, com a borda refeita lá).
//
// O fundo: o caso comum é o produto na bancada, em papel liso ou a foto do fornecedor em fundo branco. A borda da foto
// diz como é o fundo: um polinômio de 2º grau em x e y (em OKLab) ajustado nos pixels da borda, ignorando o que não
// bate (o produto encostando na borda), dá conta de gradiente leve e vinheta. Daí, um preenchimento a partir da borda
// junta o que está perto desse fundo (a "tolerância", que o "Quanto do fundo apagar" mexe). Sombra suave (mais escuro,
// da mesma cor, sem quina) também entra no fundo, desde que chegue aos poucos. Borda bagunçada (pouco dela bate com o
// fundo modelado) = fundo complexo: o Estúdio avisa e oferece manter o fundo.

import { LINEAR, oklab } from './cor'

/** RGBA 8 bits, linha a linha (o ImageData sem o DOM). */
export interface Imagem {
  w: number
  h: number
  d: Uint8ClampedArray
}

/** O fundo como superfície suave: 6 coeficientes por canal (1, x, y, x², xy, y², com x e y de −1 a 1). */
export interface Modelo {
  lab: Float64Array
  rgb: Float64Array
}

export interface Analise {
  w: number
  h: number
  /** OKLab ×100 de cada pixel (3 por pixel). */
  lab: Float32Array
  /** Distância de cada pixel ao fundo modelado (ΔE, com a sombra pesando menos). */
  dist: Float32Array
  /** Pixel que parece sombra (mais escuro que o fundo, mesma cor). */
  sombra: Uint8Array
  /** Quina (gradiente da luminância, ΔL por pixel). */
  grad: Float32Array
  /** Transparente na foto de entrada (foto já recortada). */
  vazio: Uint8Array
  modelo: Modelo
  /** Fração da borda que bate com o fundo modelado (0–1). Baixa = fundo bagunçado. */
  borda: number
  /** Ruído do fundo (ΔE típico entre a borda e o modelo). */
  ruido: number
  /** Tolerância sugerida (ΔE). */
  tolerancia: number
  /** A borda da foto já é transparente (foto recortada antes, num ajuste). */
  recortada: boolean
}

export interface Caixa {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Recorte {
  /** 1 = fundo, 0 = produto (na resolução da análise). */
  fundo: Uint8Array
  /** Fração da foto que ficou produto. */
  area: number
  caixa: Caixa | null
}

/* ---------------------------------------------------------------- mínimos quadrados */

const NB = 6
function base(x: number, y: number, f: Float64Array): void {
  f[0] = 1
  f[1] = x
  f[2] = y
  f[3] = x * x
  f[4] = x * y
  f[5] = y * y
}

/** Resolve A·x = b (6×6, eliminação com pivô). */
function resolver(A: Float64Array, b: Float64Array): Float64Array {
  const n = NB
  const M = new Float64Array(n * (n + 1))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i * (n + 1) + j] = A[i * n + j]
    M[i * (n + 1) + n] = b[i]
  }
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r * (n + 1) + c]) > Math.abs(M[p * (n + 1) + c])) p = r
    if (p !== c) for (let j = 0; j <= n; j++) [M[c * (n + 1) + j], M[p * (n + 1) + j]] = [M[p * (n + 1) + j], M[c * (n + 1) + j]]
    const piv = M[c * (n + 1) + c] || 1e-12
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r * (n + 1) + c] / piv
      if (!f) continue
      for (let j = c; j <= n; j++) M[r * (n + 1) + j] -= f * M[c * (n + 1) + j]
    }
  }
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) x[i] = M[i * (n + 1) + n] / (M[i * (n + 1) + i] || 1e-12)
  return x
}

/** Ajusta 3 canais (valores v, 3 por amostra) com pesos; os termos de 2º grau levam um freio (a borda só cerca o meio). */
function ajustar(xs: Float32Array, ys: Float32Array, v: Float32Array, pesos: Uint8Array): Float64Array {
  const A = new Float64Array(NB * NB)
  const b = [new Float64Array(NB), new Float64Array(NB), new Float64Array(NB)]
  const f = new Float64Array(NB)
  let soma = 0
  for (let i = 0; i < xs.length; i++) {
    if (!pesos[i]) continue
    soma++
    base(xs[i], ys[i], f)
    for (let r = 0; r < NB; r++) {
      const fr = f[r]
      for (let c = 0; c < NB; c++) A[r * NB + c] += fr * f[c]
      b[0][r] += fr * v[i * 3]
      b[1][r] += fr * v[i * 3 + 1]
      b[2][r] += fr * v[i * 3 + 2]
    }
  }
  const freio = Math.max(1, soma) * 0.002
  for (let k = 3; k < NB; k++) A[k * NB + k] += freio
  for (let k = 0; k < 3; k++) A[k * NB + k] += 1e-9
  const out = new Float64Array(NB * 3)
  for (let c = 0; c < 3; c++) out.set(resolver(A, b[c]), c * NB)
  return out
}

/** Valor do modelo (3 canais) no ponto normalizado (x, y ∈ −1..1). */
export function noModelo(coef: Float64Array, x: number, y: number, s: Float64Array | number[]): void {
  const f0 = 1
  const f1 = x
  const f2 = y
  const f3 = x * x
  const f4 = x * y
  const f5 = y * y
  for (let c = 0; c < 3; c++) {
    const o = c * NB
    s[c] = coef[o] * f0 + coef[o + 1] * f1 + coef[o + 2] * f2 + coef[o + 3] * f3 + coef[o + 4] * f4 + coef[o + 5] * f5
  }
}

function mediana(v: number[]): number {
  if (!v.length) return 0
  const s = [...v].sort((a, b) => a - b)
  return s[s.length >> 1]
}

/* ---------------------------------------------------------------- análise */

/** Lê a foto pequena: OKLab, o fundo modelado pela borda, a distância de cada pixel a ele, sombra e quina. */
export function analisar(img: Imagem): Analise {
  const { w, h, d } = img
  const n = w * h
  const lab = new Float32Array(n * 3)
  const vazio = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    const i = p * 4
    if (d[i + 3] < 16) vazio[p] = 1
    oklab(LINEAR[d[i]], LINEAR[d[i + 1]], LINEAR[d[i + 2]], lab, p * 3)
  }

  // a faixa da borda (2,5% do lado menor), sem os pixels transparentes
  const faixa = Math.max(2, Math.round(Math.min(w, h) * 0.025))
  const idx: number[] = []
  let transparentesNaBorda = 0
  let naBorda = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (y >= faixa && y < h - faixa && x >= faixa && x < w - faixa) continue
      naBorda++
      const p = y * w + x
      if (vazio[p]) transparentesNaBorda++
      else idx.push(p)
    }
  const recortada = transparentesNaBorda > naBorda * 0.5
  // amostra no máximo ~12 mil pixels da borda
  const passo = Math.max(1, Math.floor(idx.length / 12000))
  const am = idx.filter((_, i) => i % passo === 0)
  const N = am.length
  const xs = new Float32Array(N)
  const ys = new Float32Array(N)
  const vLab = new Float32Array(N * 3)
  const vRgb = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    const p = am[i]
    xs[i] = ((p % w) / Math.max(1, w - 1)) * 2 - 1
    ys[i] = (Math.floor(p / w) / Math.max(1, h - 1)) * 2 - 1
    vLab[i * 3] = lab[p * 3]
    vLab[i * 3 + 1] = lab[p * 3 + 1]
    vLab[i * 3 + 2] = lab[p * 3 + 2]
    vRgb[i * 3] = LINEAR[d[p * 4]]
    vRgb[i * 3 + 1] = LINEAR[d[p * 4 + 1]]
    vRgb[i * 3 + 2] = LINEAR[d[p * 4 + 2]]
  }

  // ajuste robusto: refaz 3 vezes sem as amostras que não batem (o produto encostado na borda, um objeto no canto)
  const pesos = new Uint8Array(N).fill(1)
  const res = new Float32Array(N)
  const t = new Float64Array(3)
  let coefLab: Float64Array = new Float64Array(NB * 3)
  for (let it = 0; it < 4; it++) {
    coefLab = ajustar(xs, ys, vLab, pesos)
    const usados: number[] = []
    for (let i = 0; i < N; i++) {
      noModelo(coefLab, xs[i], ys[i], t)
      res[i] = Math.hypot(vLab[i * 3] - t[0], vLab[i * 3 + 1] - t[1], vLab[i * 3 + 2] - t[2])
      if (pesos[i]) usados.push(res[i])
    }
    const med = mediana(usados)
    const mad = mediana(usados.map((r) => Math.abs(r - med)))
    const lim = Math.max(3, med + 3 * 1.4826 * mad)
    for (let i = 0; i < N; i++) pesos[i] = res[i] <= lim ? 1 : 0
  }
  const coefRgb = ajustar(xs, ys, vRgb, pesos)
  let batem = 0
  const bons: number[] = []
  for (let i = 0; i < N; i++) {
    if (res[i] < 6) batem++
    if (pesos[i]) bons.push(res[i])
  }
  const borda = N ? batem / N : 0
  const ruido = mediana(bons)

  const { dist, sombra, grad } = medir(lab, vazio, w, h, coefLab, recortada)
  const tolerancia = Math.min(20, Math.max(5, 4 + 2.5 * ruido))
  return { w, h, lab, dist, sombra, grad, vazio, modelo: { lab: coefLab, rgb: coefRgb }, borda, ruido, tolerancia, recortada }
}

/** Distância de cada pixel ao fundo modelado (a sombra pesa menos na luz), se parece sombra e a quina (Sobel em L). */
/** Onde cada pixel da imagem cai no fundo modelado (x e y normalizados de −1 a 1); sem mapa, a imagem é o quadro inteiro. */
export type MapaDoFundo = (x: number, y: number) => [number, number]

function medir(lab: Float32Array, vazio: Uint8Array, w: number, h: number, coefLab: Float64Array, recortada: boolean, mapa?: MapaDoFundo): { dist: Float32Array; sombra: Uint8Array; grad: Float32Array } {
  const n = w * h
  const t = new Float64Array(3)
  const dist = new Float32Array(n)
  const sombra = new Uint8Array(n)
  for (let y = 0; y < h; y++) {
    const yn = (y / Math.max(1, h - 1)) * 2 - 1
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (vazio[p]) continue
      if (mapa) {
        const [mx, my] = mapa(x, y)
        noModelo(coefLab, mx, my, t)
      } else noModelo(coefLab, (x / Math.max(1, w - 1)) * 2 - 1, yn, t)
      const L = lab[p * 3]
      const A = lab[p * 3 + 1]
      const B = lab[p * 3 + 2]
      const dL = L - t[0]
      const da = A - t[1]
      const db = B - t[2]
      dist[p] = Math.sqrt((dL < 0 ? 0.55 * dL : dL) ** 2 + da * da + db * db)
      // sombra: escurecer em linear multiplica L, a e b do OKLab pelo mesmo fator
      if (dL < 0 && t[0] > 1) {
        const k = L / t[0]
        if (k > 0.5 && Math.hypot(A - t[1] * k, B - t[2] * k) < 4.5) sombra[p] = 1
      }
    }
  }
  if (recortada) for (let p = 0; p < n; p++) dist[p] = vazio[p] ? 0 : 99
  const grad = new Float32Array(n)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      const a = (p - w - 1) * 3
      const b = (p - w) * 3
      const c = (p - w + 1) * 3
      const e = (p - 1) * 3
      const f = (p + 1) * 3
      const g = (p + w - 1) * 3
      const i = (p + w) * 3
      const j = (p + w + 1) * 3
      const gx = lab[c] + 2 * lab[f] + lab[j] - lab[a] - 2 * lab[e] - lab[g]
      const gy = lab[g] + 2 * lab[i] + lab[j] - lab[a] - 2 * lab[b] - lab[c]
      grad[p] = Math.sqrt(gx * gx + gy * gy) / 8
    }
  return { dist, sombra, grad }
}

/**
 * Um quadro do vídeo medido com o fundo de outro (o 1º quadro do trecho): a câmera parada, o fundo é o mesmo e só o
 * produto mexe. Mais barato que analisar (não ajusta o fundo de novo).
 */
export function medirComModelo(img: Imagem, base: Analise, mapa?: MapaDoFundo, fora?: (x: number, y: number) => boolean): Analise {
  const { w, h, d } = img
  const n = w * h
  const lab = new Float32Array(n * 3)
  const vazio = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    const i = p * 4
    // fora da foto (o quadro passou da borda dela): conta como fundo
    if (fora && fora(p % w, (p / w) | 0)) vazio[p] = 1
    oklab(LINEAR[d[i]], LINEAR[d[i + 1]], LINEAR[d[i + 2]], lab, p * 3)
  }
  const m = medir(lab, vazio, w, h, base.modelo.lab, false, mapa)
  return { ...base, w, h, lab, vazio, ...m, recortada: false }
}

/** "Quanto do fundo apagar" (0–100, 50 = o automático) → tolerância (de ¼ a 4× a sugerida). */
export function toleranciaPara(an: Analise, quanto: number): number {
  return Math.min(45, Math.max(1.5, an.tolerancia * 2 ** ((quanto - 50) / 25)))
}

/** O fundo é liso o bastante pra recortar sozinho? (a borda bate com o modelo e ele não é ruidoso) */
export function fundoLiso(an: Analise): boolean {
  return an.recortada || (an.borda >= 0.62 && an.ruido < 6)
}

/**
 * O fundo já é preto (o vídeo de catálogo, o render 3D girando, o story da loja): o fundo modelado na borda é escuro
 * e sem cor no contorno inteiro. Aí não tem o que recortar (o site já junta o preto ao preto): recortar só arriscaria
 * comer a parte escura do produto (o vidro de um conhaque, a tampa preta). O Estúdio só deixa o preto liso.
 */
export function fundoPreto(an: Analise): boolean {
  if (an.recortada || an.borda < 0.5) return false
  const t = [0, 0, 0]
  for (const [x, y] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
    noModelo(an.modelo.lab, x, y, t)
    // L 20 ≈ cinza 19/255; mais que isso já é um fundo escuro de verdade (parede, pano), que se recorta
    if (t[0] > 20 || Math.hypot(t[1], t[2]) > 5) return false
  }
  return true
}

/** O ponto do preto: abaixo de `de` é fundo (vira preto puro), acima de `ate` é produto inteiro; entre os dois, aos poucos. */
export interface PontoDoPreto {
  de: number
  ate: number
}

/** Luz (L do OKLab ×100) da média 3×3 da luminância em volta do pixel: o ruído do preto pesa menos (o shader faz igual). */
export function luzMedia(img: Imagem, x: number, y: number): number {
  const { w, h, d } = img
  let soma = 0
  let n = 0
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.min(w - 1, Math.max(0, x + dx))
      const yy = Math.min(h - 1, Math.max(0, y + dy))
      const i = (yy * w + xx) * 4
      soma += 0.2126 * LINEAR[d[i]] + 0.7152 * LINEAR[d[i + 1]] + 0.0722 * LINEAR[d[i + 2]]
      n++
    }
  return 100 * Math.cbrt(soma / n)
}

/**
 * O ponto do preto medido na faixa da borda (o fundo): a mediana e o quase-máximo (99,5%) da luz ali. O ruído do preto
 * (compressão do Instagram, o sensor no escuro) fica abaixo de `ate`; o produto escuro (L 18 ou mais) fica acima.
 */
export function pretoDoFundo(img: Imagem): PontoDoPreto {
  const { w, h } = img
  const faixa = Math.max(2, Math.round(Math.min(w, h) * 0.025))
  const v: number[] = []
  const passo = Math.max(1, Math.round((2 * faixa * (w + h)) / 6000))
  let k = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (y >= faixa && y < h - faixa && x >= faixa && x < w - faixa) continue
      if (k++ % passo) continue
      v.push(luzMedia(img, x, y))
    }
  v.sort((a, b) => a - b)
  const med = v[v.length >> 1] ?? 0
  const alto = v[Math.min(v.length - 1, Math.floor(v.length * 0.995))] ?? 0
  const de = Math.max(med, 1) + 1
  return { de, ate: Math.max(alto + 2.5, de + 4) }
}

/** "Quanto do fundo apagar" no fundo preto: menos guarda mais do escuro do produto; mais deixa o preto mais limpo. */
export function pretoPara(p: PontoDoPreto, quanto: number): PontoDoPreto {
  const f = Math.sqrt(2 ** ((quanto - 50) / 25))
  return { de: p.de * f, ate: Math.max(p.de * f + 2, p.ate * f) }
}

/** O que é fundo no fundo preto (luz abaixo do `ate`), na resolução da análise: pra medir a cor só no produto. */
export function fundoDoPreto(img: Imagem, p: PontoDoPreto): Uint8Array {
  const m = new Uint8Array(img.w * img.h)
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) m[y * img.w + x] = luzMedia(img, x, y) < p.ate ? 1 : 0
  return m
}

/** A caixa do produto no fundo preto (o que passa do `ate`), sem a poeira solta (pixel aceso sozinho). */
export function caixaNoPreto(img: Imagem, p: PontoDoPreto): Caixa | null {
  const { w, h } = img
  const fundo = fundoDoPreto(img, p)
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const q = y * w + x
      if (fundo[q]) continue
      // produto só com vizinho produto (pixel aceso sozinho no preto é ruído)
      if (fundo[q - 1] + fundo[q + 1] + fundo[q - w] + fundo[q + w] > 2) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  return x1 >= 0 ? { x0, y0, x1: x1 + 1, y1: y1 + 1 } : null
}

/* ---------------------------------------------------------------- a janela do vídeo (gravação de tela) */

/**
 * A janela do vídeo dentro do quadro, em frações (0–1) do quadro inteiro: o reel ou o story gravado da tela do celular
 * (o jeito que a loja manda: o produto girando no preto, com a interface do Instagram em volta).
 */
export interface Janela {
  x0: number
  y0: number
  x1: number
  y1: number
  /** Achou a moldura em volta (a barra do celular, o nome do perfil, "Enviar mensagem", o cinza do story); false = o
   *  preto já vai de ponta a ponta e só saiu o texto solto da interface, colado na borda. */
  moldura: boolean
}

/** A luz (média 3×3) de cada pixel. */
function mapaDeLuz(img: Imagem): Float32Array {
  const L = new Float32Array(img.w * img.h)
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) L[y * img.w + x] = luzMedia(img, x, y)
  return L
}

function percentil(v: ArrayLike<number>, p: number): number {
  const o = Float32Array.from(v).sort()
  return o.length ? o[Math.min(o.length - 1, Math.floor(o.length * p))] : 0
}

/** Os pedaços ligados de uma máscara (4 vizinhos, ou 8): o rótulo de cada pixel (−1 = fora), e de cada pedaço a contagem e a caixa. */
function pedacos(m: Uint8Array, w: number, h: number, oito: boolean): { rotulo: Int32Array; n: number[]; caixa: Caixa[] } {
  const rotulo = new Int32Array(w * h).fill(-1)
  const n: number[] = []
  const caixa: Caixa[] = []
  const pilha = new Int32Array(w * h)
  const viz = oito ? [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1] : [-1, 1, -w, w]
  for (let q0 = 0; q0 < w * h; q0++) {
    if (!m[q0] || rotulo[q0] >= 0) continue
    const k = n.length
    let topo = 0
    pilha[topo++] = q0
    rotulo[q0] = k
    let c = 0
    const cx = { x0: w, y0: h, x1: 0, y1: 0 }
    while (topo) {
      const q = pilha[--topo]
      const x = q % w
      const y = (q - x) / w
      c++
      if (x < cx.x0) cx.x0 = x
      if (y < cx.y0) cx.y0 = y
      if (x + 1 > cx.x1) cx.x1 = x + 1
      if (y + 1 > cx.y1) cx.y1 = y + 1
      for (const d of viz) {
        const r = q + d
        if (r < 0 || r >= w * h) continue
        const rx = r % w
        if (Math.abs(rx - x) > 1 || !m[r] || rotulo[r] >= 0) continue
        rotulo[r] = k
        pilha[topo++] = r
      }
    }
    n.push(c)
    caixa.push(cx)
  }
  return { rotulo, n, caixa }
}

/**
 * A moldura: o maior pedaço quase preto do quadro, quase um retângulo (o que tem dentro dele, o produto e o texto,
 * conta como dele), com a borda do quadro mais clara em volta e escura (a interface do Instagram no modo escuro). Os
 * lados vêm pra dentro até ficarem inteiros (os cantos arredondados do reel, a borda borrada da compressão). null = não
 * tem moldura (o preto vai até a borda, ou o fundo é claro: não é gravação de tela).
 */
function molduraEscura(img: Imagem, L: Float32Array): Caixa | null {
  const { w, h } = img
  const total = w * h
  const preto = percentil(L, 0.02)
  const faixa = Math.max(2, Math.round(Math.min(w, h) * 0.02))
  const anel: number[] = []
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (y < faixa || y >= h - faixa || x < faixa || x >= w - faixa) anel.push(L[y * w + x])
  const borda = percentil(anel, 0.5)
  // L 45 ≈ cinza 60/255: mais claro que isso não é a interface escura do Instagram
  if (preto > 16 || borda < preto + 6 || borda > 45) return null
  const lim = Math.min(preto + 12, Math.max(preto + 3, (preto + borda) / 2))
  const m = new Uint8Array(total)
  for (let q = 0; q < total; q++) m[q] = L[q] <= lim ? 1 : 0
  const pd = pedacos(m, w, h, false)
  if (!pd.n.length) return null
  let k = 0
  for (let i = 1; i < pd.n.length; i++) if (pd.n[i] > pd.n[k]) k = i
  const B = pd.caixa[k]
  const areaB = (B.x1 - B.x0) * (B.y1 - B.y0)
  if (areaB < total * 0.2 || areaB > total * 0.95) return null
  // de fora: o que se alcança da borda do quadro sem passar pela janela; o resto (a janela e o que ela cerca) é dela
  const fora = new Uint8Array(total)
  const pilha = new Int32Array(total)
  let topo = 0
  const entrar = (q: number) => {
    if (fora[q] || pd.rotulo[q] === k) return
    fora[q] = 1
    pilha[topo++] = q
  }
  for (let x = 0; x < w; x++) {
    entrar(x)
    entrar((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    entrar(y * w)
    entrar(y * w + w - 1)
  }
  while (topo) {
    const q = pilha[--topo]
    const x = q % w
    if (x > 0) entrar(q - 1)
    if (x < w - 1) entrar(q + 1)
    if (q >= w) entrar(q - w)
    if (q < total - w) entrar(q + w)
  }
  let dentro = 0
  for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) dentro += fora[y * w + x] ? 0 : 1
  if (dentro / areaB < 0.93) return null
  // os lados pra dentro até ficarem inteiros (até 6% de cada lado; mais que isso, o lado é torto: não é uma janela)
  let { x0, y0, x1, y1 } = B
  const limX = Math.max(2, Math.round((x1 - x0) * 0.06))
  const limY = Math.max(2, Math.round((y1 - y0) * 0.06))
  const linha = (y: number) => {
    let n = 0
    for (let x = x0; x < x1; x++) n += fora[y * w + x]
    return n
  }
  const coluna = (x: number) => {
    let n = 0
    for (let y = y0; y < y1; y++) n += fora[y * w + x]
    return n
  }
  for (let volta = 0; volta < 64; volta++) {
    let mexeu = false
    if (linha(y0) > 0) (y0++, (mexeu = true))
    if (linha(y1 - 1) > 0) (y1--, (mexeu = true))
    if (coluna(x0) > 0) (x0++, (mexeu = true))
    if (coluna(x1 - 1) > 0) (x1--, (mexeu = true))
    if (!mexeu) break
    if (y0 - B.y0 > limY || B.y1 - y1 > limY || x0 - B.x0 > limX || B.x1 - x1 > limX) return null
  }
  // mais um pixel de folga (a borda da janela vem borrada pela compressão)
  return { x0: x0 + 1, y0: y0 + 1, x1: x1 - 1, y1: y1 - 1 }
}

/** Um pedaço da imagem (a cópia dos pixels da caixa). */
export function recorteDaImagem(img: Imagem, c: Caixa): Imagem {
  const w = c.x1 - c.x0
  const h = c.y1 - c.y0
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) d.set(img.d.subarray(((c.y0 + y) * img.w + c.x0) * 4, ((c.y0 + y) * img.w + c.x1) * 4), y * w * 4)
  return { w, h, d }
}

/** A distância entre duas caixas (0 se encostam ou se cruzam). */
function distancia(a: Caixa, b: Caixa): number {
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1)
  const dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1)
  return Math.max(dx, dy)
}

/**
 * O texto solto da interface colado na borda da janela (o nome do perfil e o tempo do reel, em cima; a legenda
 * embaixo): o que passa do ponto do preto, pequeno, baixinho (uma linha) ou estreito, perto da borda e separado do
 * produto por uma faixa de preto. O
 * produto é o maior pedaço aceso, com os que ficam perto dele (a tampa separada da garrafa pelo vidro escuro). Devolve
 * a janela aparada (nas coordenadas da imagem), sem cortar o produto.
 */
function semTextoNaBorda(img: Imagem): Caixa {
  const { w, h } = img
  const inteira = { x0: 0, y0: 0, x1: w, y1: h }
  // o preto pela mediana da faixa da borda (o quase-máximo do pretoDoFundo pegava o próprio texto, quando ele encosta
  // na borda) e uma folga pro ruído da compressão em volta do texto
  const faixa = Math.max(2, Math.round(Math.min(w, h) * 0.025))
  const L = mapaDeLuz(img)
  const anel: number[] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (y < faixa || y >= h - faixa || x < faixa || x >= w - faixa) anel.push(L[y * w + x])
  const lim = percentil(anel, 0.5) + 8
  const m = new Uint8Array(w * h)
  for (let q = 0; q < w * h; q++) m[q] = L[q] >= lim ? 1 : 0
  const pd = pedacos(m, w, h, true)
  const vivos = pd.n.map((_, i) => i).filter((i) => pd.n[i] >= 3)
  if (!vivos.length) return inteira
  let k = vivos[0]
  for (const i of vivos) if (pd.n[i] > pd.n[k]) k = i
  const perto = Math.max(w, h) * 0.06
  const juntos = new Set([k])
  const cl = { ...pd.caixa[k] }
  for (let mudou = true; mudou; ) {
    mudou = false
    for (const i of vivos) {
      if (juntos.has(i) || distancia(pd.caixa[i], cl) > perto) continue
      juntos.add(i)
      const c = pd.caixa[i]
      cl.x0 = Math.min(cl.x0, c.x0)
      cl.y0 = Math.min(cl.y0, c.y0)
      cl.x1 = Math.max(cl.x1, c.x1)
      cl.y1 = Math.max(cl.y1, c.y1)
      mudou = true
    }
  }
  const corte = { ...inteira }
  const folgaY = h * 0.05
  const folgaX = w * 0.05
  for (const i of vivos) {
    if (juntos.has(i) || pd.n[i] > w * h * 0.03) continue
    const c = pd.caixa[i]
    // texto é baixinho (uma linha) em cima e embaixo, e estreito nos lados; a tampa solta de uma garrafa é mais alta
    const linha = c.y1 - c.y0 <= h * 0.05
    const coluna = c.x1 - c.x0 <= w * 0.1
    if (linha && c.y1 <= cl.y0 - folgaY && c.y0 <= h * 0.15) corte.y0 = Math.max(corte.y0, Math.round(c.y1 + (cl.y0 - c.y1) * 0.3))
    else if (linha && c.y0 >= cl.y1 + folgaY && c.y1 >= h * 0.85) corte.y1 = Math.min(corte.y1, Math.round(c.y0 - (c.y0 - cl.y1) * 0.3))
    else if (coluna && c.x1 <= cl.x0 - folgaX && c.x0 <= w * 0.15) corte.x0 = Math.max(corte.x0, Math.round(c.x1 + (cl.x0 - c.x1) * 0.3))
    else if (coluna && c.x0 >= cl.x1 + folgaX && c.x1 >= w * 0.85) corte.x1 = Math.min(corte.x1, Math.round(c.x0 - (c.x0 - cl.x1) * 0.3))
  }
  return corte
}

/**
 * A janela do vídeo, olhando alguns quadros (cópias pequenas, ~320 px): a moldura escura (a mesma em pelo menos 3 dos
 * quadros: a janela não se mexe, o produto sim) e, dentro dela, o texto solto da interface colado na borda, que sai
 * (de cada lado, o corte que guarda mais, entre os quadros: o produto girando nunca é cortado). null = nada pra cortar:
 * o vídeo de fundo claro, ou o de fundo preto de ponta a ponta sem texto na borda (o caso do vídeo já pronto).
 */
export function janelaDoVideo(quadros: Imagem[]): Janela | null {
  if (!quadros.length) return null
  const { w, h } = quadros[0]
  const luzes = quadros.map(mapaDeLuz)
  const achadas = quadros.map((q, i) => molduraEscura(q, luzes[i])).filter((c): c is Caixa => !!c)
  let janela: Caixa | null = null
  if (achadas.length >= Math.min(3, quadros.length)) {
    const mediana = (f: (c: Caixa) => number) => percentil(achadas.map(f), 0.5)
    const c = { x0: mediana((c) => c.x0), y0: mediana((c) => c.y0), x1: mediana((c) => c.x1), y1: mediana((c) => c.y1) }
    const tol = Math.max(w, h) * 0.03
    const iguais = achadas.filter((a) => Math.abs(a.x0 - c.x0) + Math.abs(a.y0 - c.y0) + Math.abs(a.x1 - c.x1) + Math.abs(a.y1 - c.y1) <= tol)
    // a mais apertada das que batem (a moldura de cada quadro pode vir 1 px maior com a compressão)
    if (iguais.length >= Math.min(3, quadros.length))
      janela = { x0: Math.max(...iguais.map((a) => a.x0)), y0: Math.max(...iguais.map((a) => a.y0)), x1: Math.min(...iguais.map((a) => a.x1)), y1: Math.min(...iguais.map((a) => a.y1)) }
  }
  const moldura = !!janela
  if (!janela) {
    // sem moldura: só no preto de ponta a ponta (o fundo modelado na borda é preto) o texto solto da borda sai
    const preto = quadros.every((q, i) => {
      const L = luzes[i]
      const faixa = Math.max(2, Math.round(Math.min(q.w, q.h) * 0.02))
      const anel: number[] = []
      for (let y = 0; y < q.h; y++) for (let x = 0; x < q.w; x++) if (y < faixa || y >= q.h - faixa || x < faixa || x >= q.w - faixa) anel.push(L[y * q.w + x])
      return percentil(anel, 0.9) < 20
    })
    if (!preto) return null
    janela = { x0: 0, y0: 0, x1: w, y1: h }
  }
  // o texto da borda: de cada lado, o corte que guarda mais entre os quadros
  const cortes = quadros.map((q) => semTextoNaBorda(recorteDaImagem(q, janela)))
  const jw = janela.x1 - janela.x0
  const jh = janela.y1 - janela.y0
  const corte = { x0: Math.min(...cortes.map((c) => c.x0)), y0: Math.min(...cortes.map((c) => c.y0)), x1: Math.max(...cortes.map((c) => c.x1)), y1: Math.max(...cortes.map((c) => c.y1)) }
  const final = { x0: janela.x0 + corte.x0, y0: janela.y0 + corte.y0, x1: janela.x0 + corte.x1, y1: janela.y0 + corte.y1 }
  const aparou = corte.x0 > 0 || corte.y0 > 0 || corte.x1 < jw || corte.y1 < jh
  if (!moldura && !aparou) return null
  // janela pequena demais (menos de 25% do quadro): melhor não cortar
  if ((final.x1 - final.x0) * (final.y1 - final.y0) < w * h * 0.25 * (moldura ? 0.5 : 1)) return null
  return { x0: final.x0 / w, y0: final.y0 / h, x1: final.x1 / w, y1: final.y1 / h, moldura }
}

/* ---------------------------------------------------------------- recorte */

/**
 * Preenche a partir da borda o que é fundo (tolerância em ΔE) e limpa: sobra solta pequena vira fundo. ajustes (da
 * varinha): +1 força produto, −1 força fundo, 0 deixa o automático.
 */
export function recortar(an: Analise, tol: number, ajustes: Int8Array | null): Recorte {
  const { w, h, dist, sombra, grad } = an
  const n = w * h
  const fundo = new Uint8Array(n)
  const fila = new Int32Array(n)
  let ini = 0
  let fim = 0
  // sombra entra se vier aos poucos (sem quina, sem salto de um pixel pro outro); na cópia menor (a máscara de cada
  // quadro do vídeo) a mesma sombra muda mais por pixel, então os limites crescem na mesma proporção
  const escala = Math.max(1, 480 / Math.max(w, h))
  const quinaMax = (2.2 + tol * 0.08) * escala
  const passoMax = (1.6 + tol * 0.05) * escala
  const quinaForte = 3.5 * escala
  const passa = (p: number, de: number) => {
    if (ajustes && ajustes[p] === 1) return false
    const dd = dist[p]
    // quina forte (o contorno do produto) segura o preenchimento, mesmo com a cor perto da do fundo (a tampa prateada
    // no fundo cinza, o papel bege no fundo bege); o que é bem fundo passa sempre
    if (dd < tol) return dd < tol * 0.4 || grad[p] < quinaForte
    return de >= 0 && sombra[p] === 1 && grad[p] < quinaMax && dd - dist[de] < passoMax
  }
  const tentar = (p: number, de: number) => {
    if (fundo[p] || !passa(p, de)) return
    fundo[p] = 1
    fila[fim++] = p
  }
  for (let x = 0; x < w; x++) {
    tentar(x, -1)
    tentar((h - 1) * w + x, -1)
  }
  for (let y = 0; y < h; y++) {
    tentar(y * w, -1)
    tentar(y * w + w - 1, -1)
  }
  while (ini < fim) {
    const p = fila[ini++]
    const x = p % w
    if (x > 0) tentar(p - 1, p)
    if (x < w - 1) tentar(p + 1, p)
    if (p >= w) tentar(p - w, p)
    if (p < n - w) tentar(p + w, p)
  }
  fecharBuracos(fundo, w, h, Math.max(2, Math.round(Math.max(w, h) * 0.009)))
  if (ajustes) for (let p = 0; p < n; p++) if (ajustes[p] === -1) fundo[p] = 1

  // pedaços de produto: fica o maior e os que têm pelo menos 2% dele (um pacote com 2 itens); poeira vira fundo
  const rotulo = new Int32Array(n).fill(-1)
  const tamanhos: number[] = []
  for (let p0 = 0; p0 < n; p0++) {
    if (fundo[p0] || rotulo[p0] >= 0) continue
    const r = tamanhos.length
    let cont = 0
    ini = 0
    fim = 0
    fila[fim++] = p0
    rotulo[p0] = r
    while (ini < fim) {
      const p = fila[ini++]
      cont++
      const x = p % w
      const viz = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1]
      for (const q of viz) {
        if (q < 0 || fundo[q] || rotulo[q] >= 0) continue
        rotulo[q] = r
        fila[fim++] = q
      }
    }
    tamanhos.push(cont)
  }
  const maior = Math.max(0, ...tamanhos)
  const minimo = Math.max(12, maior * 0.02)
  let area = 0
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let p = 0; p < n; p++) {
    if (fundo[p]) continue
    if (tamanhos[rotulo[p]] < minimo && !(ajustes && ajustes[p] === 1)) {
      fundo[p] = 1
      continue
    }
    area++
    const x = p % w
    const y = (p / w) | 0
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return { fundo, area: area / n, caixa: x1 >= 0 ? { x0, y0, x1: x1 + 1, y1: y1 + 1 } : null }
}

/** Máximo (dilatar) ou mínimo (erodir) num quadrado de lado 2r+1, separável (linha e coluna). */
function morfologia(m: Uint8Array, w: number, h: number, r: number, dilatar: boolean): Uint8Array {
  const tmp = new Uint8Array(m.length)
  const out = new Uint8Array(m.length)
  const alvo = dilatar ? 1 : 0
  for (let y = 0; y < h; y++) {
    // janela deslizante: conta quantos "alvo" tem na janela
    let cont = 0
    for (let x = -r; x <= r; x++) if (x >= 0 && x < w && m[y * w + x] === alvo) cont++
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = cont > 0 ? alvo : 1 - alvo
      const sai = x - r
      const entra = x + r + 1
      if (sai >= 0 && m[y * w + sai] === alvo) cont--
      if (entra < w && m[y * w + entra] === alvo) cont++
    }
  }
  for (let x = 0; x < w; x++) {
    let cont = 0
    for (let y = -r; y <= r; y++) if (y >= 0 && y < h && tmp[y * w + x] === alvo) cont++
    for (let y = 0; y < h; y++) {
      out[y * w + x] = cont > 0 ? alvo : 1 - alvo
      const sai = y - r
      const entra = y + r + 1
      if (sai >= 0 && tmp[sai * w + x] === alvo) cont--
      if (entra < h && tmp[entra * w + x] === alvo) cont++
    }
  }
  return out
}

/**
 * Buraco dentro do produto: o contorno com uma falha deixa o preenchimento entrar (a tampa prateada no fundo cinza, o
 * papel bege no fundo bege). Fechando as falhas de até 2r px (dilatar e erodir o produto), o que fica cercado é
 * produto (o buraco e a falha que levava a ele). O resto da borda não muda.
 */
function fecharBuracos(fundo: Uint8Array, w: number, h: number, r: number): void {
  const n = w * h
  const prod = new Uint8Array(n)
  for (let p = 0; p < n; p++) prod[p] = fundo[p] ? 0 : 1
  const fechado = morfologia(morfologia(prod, w, h, r, true), w, h, r, false)
  // o fundo do produto fechado que a borda alcança; o que ela não alcança é buraco
  const alcanca = new Uint8Array(n)
  const fila = new Int32Array(n)
  let ini = 0
  let fim = 0
  const por = (p: number) => {
    if (alcanca[p] || fechado[p]) return
    alcanca[p] = 1
    fila[fim++] = p
  }
  for (let x = 0; x < w; x++) {
    por(x)
    por((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    por(y * w)
    por(y * w + w - 1)
  }
  while (ini < fim) {
    const p = fila[ini++]
    const x = p % w
    if (x > 0) por(p - 1)
    if (x < w - 1) por(p + 1)
    if (p >= w) por(p - w)
    if (p < n - w) por(p + w)
  }
  const buraco = new Uint8Array(n)
  let algum = false
  for (let p = 0; p < n; p++)
    if (!fechado[p] && !alcanca[p]) {
      buraco[p] = 1
      algum = true
    }
  if (!algum) {
    // nenhum buraco: só as falhas fechadas que cercavam alguma coisa contam; sem buraco, nada muda
    return
  }
  const perto = morfologia(buraco, w, h, r + 1, true)
  for (let p = 0; p < n; p++) if (buraco[p] || (fechado[p] && perto[p])) fundo[p] = 0
}

/**
 * A varinha: um toque apaga (ou devolve) a área em volta parecida com o ponto tocado, ligada a ele e até um raio (12%
 * do lado maior), só do lado que ele está (apagar mexe no produto; devolver, no fundo). Grava em ajustes; devolve
 * quantos pixels mudaram.
 */
export function varinha(an: Analise, rec: Recorte, x: number, y: number, modo: 'apagar' | 'devolver', ajustes: Int8Array): number {
  const { w, h, lab } = an
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= w || py >= h) return 0
  const semente = py * w + px
  const ladoFundo = modo === 'devolver' ? 1 : 0
  const L0 = lab[semente * 3]
  const A0 = lab[semente * 3 + 1]
  const B0 = lab[semente * 3 + 2]
  const raio2 = (Math.max(w, h) * 0.12) ** 2
  const limiar = 14
  const visto = new Uint8Array(w * h)
  const fila = [semente]
  visto[semente] = 1
  let mudou = 0
  const valor = modo === 'apagar' ? -1 : 1
  // tocou fora do lado certo (devolver num ponto que já é produto): vale o lado do ponto
  const lado = rec.fundo[semente] === ladoFundo ? ladoFundo : rec.fundo[semente]
  while (fila.length) {
    const p = fila.pop() as number
    if (ajustes[p] !== valor) mudou++
    ajustes[p] = valor
    const qx = p % w
    const qy = (p / w) | 0
    for (const q of [qx > 0 ? p - 1 : -1, qx < w - 1 ? p + 1 : -1, qy > 0 ? p - w : -1, qy < h - 1 ? p + w : -1]) {
      if (q < 0 || visto[q]) continue
      visto[q] = 1
      const dx = (q % w) - px
      const dy = ((q / w) | 0) - py
      if (dx * dx + dy * dy > raio2 || rec.fundo[q] !== lado) continue
      if (Math.hypot(lab[q * 3] - L0, lab[q * 3 + 1] - A0, lab[q * 3 + 2] - B0) > limiar) continue
      fila.push(q)
    }
  }
  return mudou
}

/** Gira a matriz dos ajustes junto com a foto (90° no sentido do relógio): w×h vira h×w. */
export function girarAjustes(a: Int8Array, w: number, h: number): Int8Array {
  const out = new Int8Array(a.length)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x * h + (h - 1 - y)] = a[y * w + x]
  return out
}

/* ---------------------------------------------------------------- cor no estilo do site */

/** O ajuste de cor: L' = base + (L − de)·ganho, a e b × sat. Medido nas ilustrações do site (OKLab): sombra perto de L 12–18, brilho perto de 90–96. */
export interface AjusteCor {
  de: number
  base: number
  ganho: number
  sat: number
}

export const SEM_AJUSTE: AjusteCor = { de: 0, base: 0, ganho: 1, sat: 1 }

/**
 * Níveis e saturação na medida das ilustrações, a partir do produto (sem o fundo): o 1% mais escuro vai pra L 12 (o
 * produto escuro não some no preto do site) e o 99% mais claro pra L 93; saturação um pouco acima (o celular lava a
 * cor), menos em produto quase sem cor (pra não pintar ruído) e no que já é muito colorido.
 */
export function ajusteDeCor(an: Analise, fundo: Uint8Array | null): AjusteCor {
  const { w, h, lab } = an
  const Ls: number[] = []
  let somaC = 0
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      if (an.vazio[p]) continue
      // só o miolo do produto (sem a borda, que mistura com o fundo)
      if (fundo && (fundo[p] || fundo[p - 1] || fundo[p + 1] || fundo[p - w] || fundo[p + w])) continue
      Ls.push(lab[p * 3])
      somaC += Math.hypot(lab[p * 3 + 1], lab[p * 3 + 2])
    }
  if (Ls.length < 50) return SEM_AJUSTE
  Ls.sort((a, b) => a - b)
  const p1 = Ls[Math.floor(Ls.length * 0.01)]
  const p99 = Ls[Math.floor(Ls.length * 0.99)]
  const croma = somaC / Ls.length
  // o escuro só sobe (nunca escurece o produto claro); o claro estica até 93
  const base = Math.max(12, p1)
  const ganho = Math.min(1.45, Math.max(0.92, (93 - base) / Math.max(1, p99 - p1)))
  const sat = croma < 2 ? 1 : croma > 16 ? 1.04 : 1.12
  return { de: p1, base, ganho, sat }
}
