// Lata de alumínio em SVG: geometria de superfície de revolução vista um pouco de cima, arte "enrolada" no cilindro
// e o casco metálico (pescoço, costura do topo, tampa com anel, afunilamento e pé). Ver comum.tsx (CONVENÇÕES).
//
// Coordenadas da ARTE (u, v): u = comprimento de arco a partir da frente da lata (0 = centro, ±R·π/2 = bordas),
// v = altura do ponto da FRENTE do anel na tela. enrolar() leva caminhos desenhados "planos" nesse sistema para a
// tela: x = cx + R·sen(u/R) e o anel vira elipse (e cresce para baixo: a câmera está acima da tampa). Assim o
// letreiro encolhe nas bordas e as linhas horizontais viram "sorriso", como numa foto de lata de verdade.
import type { ReactNode } from 'react'
import { PALAVRAS } from './latas-glifos'

export type Pt = readonly [number, number]
/** Matriz afim [a b c d e f] como no SVG: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matriz = readonly [number, number, number, number, number, number]

export interface GeoLata {
  cx: number
  /** Raio do corpo. */
  R: number
  /** y (centro da elipse) do topo da costura. */
  topo: number
  /** y (centro da elipse) do pé. */
  base: number
  /** Achatamento da elipse (ry/rx) no topo e no pé: perspectiva. */
  eTopo: number
  eBase: number
  /** Raio da costura em fração de R. */
  rAro: number
  /** Altura da face externa da costura. */
  hAro: number
  /** Altura do pescoço (afunilamento de cima). */
  pescoco: number
  /** Raio do pé em fração de R. */
  rPe: number
  /** Altura do afunilamento de baixo. */
  hPe: number
}

const fmt = (n: number) => {
  const r = Math.round(n * 10) / 10
  return (r === 0 ? 0 : r).toString()
}
const ptTxt = (p: Pt) => fmt(p[0]) + ' ' + fmt(p[1])
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
const suave = (t: number) => t * t * (3 - 2 * t)

/** Interpolação linear numa tabela [[t, valor], ...] ordenada por t. */
export function tabela(tab: readonly (readonly [number, number])[], t: number): number {
  if (t <= tab[0][0]) return tab[0][1]
  for (let i = 1; i < tab.length; i++) {
    if (t <= tab[i][0]) {
      const [t0, v0] = tab[i - 1]
      const [t1, v1] = tab[i]
      return lerp(v0, v1, (t - t0) / (t1 - t0 || 1))
    }
  }
  return tab[tab.length - 1][1]
}

export interface Cilindro {
  g: GeoLata
  /** Achatamento da elipse no y (centro) dado. */
  e(yc: number): number
  /** Raio do perfil no y (centro) dado. */
  r(yc: number): number
  /** y (centro) onde começa e termina o corpo reto. */
  y0: number
  y1: number
  /** v (frente) do topo e da base do corpo reto. */
  vTopo: number
  vBase: number
  /** Meia largura útil da arte em u (borda visível). */
  uBorda: number
  /** Ponto da superfície: ângulo (0 = frente), y do centro do anel, raio. */
  P(th: number, yc: number, r?: number): Pt
  /** Arte plana (u, v) → tela. */
  W(u: number, v: number): Pt
  /** Caminho plano (só comandos absolutos M L Q C Z) → caminho na tela, já curvado. */
  enrolar(d: string, m?: Matriz): string
  /** Faixa impressa entre v1 e v2 (de borda a borda, ou entre u1 e u2). */
  faixa(v1: number, v2: number, u1?: number, u2?: number): string
  /** Fatia da superfície entre os anéis yc1 e yc2 (frente visível). */
  fatia(yc1: number, yc2: number): string
  /** Arco da frente do anel yc (de borda a borda). */
  anel(yc: number): string
  /** Arco da frente no v dado, de -meia a +meia (para textPath). */
  arco(v: number, meia: number): string
  silhueta: string
  corpo: string
  /** Fios das bordas (para luz de recorte), de cima a baixo. */
  bordaDir: string
  bordaEsq: string
}

export function cilindro(g: GeoLata): Cilindro {
  const { cx, R } = g
  const k = (g.eBase - g.eTopo) / (g.base - g.topo)
  const e = (yc: number) => g.eTopo + k * (yc - g.topo)
  const Ra = g.rAro * R
  const Rp = g.rPe * R
  const yP0 = g.topo + g.hAro
  const y0 = yP0 + g.pescoco
  const y1 = g.base - g.hPe
  const r = (yc: number) => {
    if (yc <= yP0) return Ra
    if (yc < y0) return lerp(Ra - 1, R, suave((yc - yP0) / g.pescoco))
    if (yc <= y1) return R
    const t = clamp01((yc - y1) / g.hPe)
    return lerp(R, Rp, 1 - Math.cos((t * Math.PI) / 2))
  }
  const P = (th: number, yc: number, rr = r(yc)): Pt => [cx + rr * Math.sin(th), yc + e(yc) * rr * Math.cos(th)]
  // v = yc + e(yc)·R  →  yc = (v − R·eTopo + R·k·topo) / (1 + k·R)
  const ycDeV = (v: number) => (v - R * g.eTopo + R * k * g.topo) / (1 + k * R)
  const uMax = (R * Math.PI) / 2 - 0.5
  const W = (u: number, v: number): Pt => {
    const uu = Math.max(-uMax, Math.min(uMax, u))
    const th = uu / R
    const yc = ycDeV(v)
    return [cx + R * Math.sin(th), yc + e(yc) * R * Math.cos(th)]
  }

  function enrolar(d: string, m: Matriz = [1, 0, 0, 1, 0, 0]): string {
    const tk = d.match(/[MLCQZmlcqz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? []
    const out: string[] = []
    let i = 0
    let cmd = ''
    let cur: Pt = [0, 0]
    let ini: Pt = [0, 0]
    const num = () => parseFloat(tk[i++])
    const A = (x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
    const Wp = (p: Pt) => ptTxt(W(p[0], p[1]))
    const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1])
    while (i < tk.length) {
      const t = tk[i]
      if (/[A-Za-z]/.test(t)) {
        cmd = t.toUpperCase()
        i++
        if (cmd === 'Z') {
          out.push('Z')
          cur = ini
          continue
        }
      }
      if (cmd === 'M') {
        const p = A(num(), num())
        out.push('M' + Wp(p))
        cur = ini = p
        cmd = 'L'
      } else if (cmd === 'L') {
        const p = A(num(), num())
        const n = Math.max(1, Math.ceil(dist(cur, p) / 5))
        for (let s = 1; s <= n; s++) out.push('L' + Wp([lerp(cur[0], p[0], s / n), lerp(cur[1], p[1], s / n)]))
        cur = p
      } else if (cmd === 'Q') {
        const c = A(num(), num())
        const p = A(num(), num())
        const p0 = cur
        const B = (t: number): Pt => {
          const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, cc = t * t
          return [a * p0[0] + b * c[0] + cc * p[0], a * p0[1] + b * c[1] + cc * p[1]]
        }
        const D = (t: number): Pt => [2 * (1 - t) * (c[0] - p0[0]) + 2 * t * (p[0] - c[0]), 2 * (1 - t) * (c[1] - p0[1]) + 2 * t * (p[1] - c[1])]
        const n = Math.max(1, Math.ceil((dist(p0, c) + dist(c, p)) / 9))
        for (let s = 0; s < n; s++) {
          const t0 = s / n, t1 = (s + 1) / n
          const b0 = B(t0), d0 = D(t0)
          const h = (t1 - t0) / 2
          out.push('Q' + Wp([b0[0] + h * d0[0], b0[1] + h * d0[1]]) + ' ' + Wp(B(t1)))
        }
        cur = p
      } else if (cmd === 'C') {
        const c1 = A(num(), num())
        const c2 = A(num(), num())
        const p = A(num(), num())
        const p0 = cur
        const B = (t: number): Pt => {
          const u = 1 - t
          const a = u * u * u, b = 3 * u * u * t, cc = 3 * u * t * t, dd = t * t * t
          return [a * p0[0] + b * c1[0] + cc * c2[0] + dd * p[0], a * p0[1] + b * c1[1] + cc * c2[1] + dd * p[1]]
        }
        const D = (t: number): Pt => {
          const u = 1 - t
          return [
            3 * u * u * (c1[0] - p0[0]) + 6 * u * t * (c2[0] - c1[0]) + 3 * t * t * (p[0] - c2[0]),
            3 * u * u * (c1[1] - p0[1]) + 6 * u * t * (c2[1] - c1[1]) + 3 * t * t * (p[1] - c2[1]),
          ]
        }
        const n = Math.max(1, Math.ceil((dist(p0, c1) + dist(c1, c2) + dist(c2, p)) / 10))
        for (let s = 0; s < n; s++) {
          const t0 = s / n, t1 = (s + 1) / n
          const b0 = B(t0), b1 = B(t1), d0 = D(t0), d1 = D(t1)
          const h = (t1 - t0) / 3
          out.push('C' + Wp([b0[0] + h * d0[0], b0[1] + h * d0[1]]) + ' ' + Wp([b1[0] - h * d1[0], b1[1] - h * d1[1]]) + ' ' + Wp(b1))
        }
        cur = p
      } else {
        i++ // token inesperado: pula
      }
    }
    return out.join('')
  }

  const amostrar = (n: number, f: (t: number) => Pt) => {
    const pts: string[] = []
    for (let s = 0; s <= n; s++) pts.push(ptTxt(f(s / n)))
    return pts
  }

  // Os anéis são elipses: arcos "A" exatos (caminho curto e sem serrilhado nas bordas).
  const arcoA = (rx: number, ry: number, varre: 0 | 1, p: Pt) => `A${fmt(rx)} ${fmt(ry)} 0 0 ${varre} ${ptTxt(p)}`

  function faixa(v1: number, v2: number, u1 = -uMax, u2 = uMax): string {
    const y1 = ycDeV(v1), y2 = ycDeV(v2)
    return (
      'M' + ptTxt(W(u1, v1)) + arcoA(R, e(y1) * R, 0, W(u2, v1)) +
      'L' + ptTxt(W(u2, v2)) + arcoA(R, e(y2) * R, 1, W(u1, v2)) + 'Z'
    )
  }

  function fatia(yc1: number, yc2: number): string {
    const ra = r(yc1), rb = r(yc2)
    // laterais seguem o perfil (sem quina na silhueta quando a fatia é alta)
    const n = Math.max(1, Math.ceil(Math.abs(yc2 - yc1) / 1.5))
    const dir: string[] = []
    const esq: string[] = []
    for (let k = 1; k <= n; k++) {
      const y = lerp(yc1, yc2, k / n)
      dir.push(ptTxt([cx + r(y), y]))
      const y2 = lerp(yc2, yc1, k / n)
      esq.push(ptTxt([cx - r(y2), y2]))
    }
    return (
      'M' + ptTxt([cx - ra, yc1]) + arcoA(ra, e(yc1) * ra, 0, [cx + ra, yc1]) +
      'L' + dir.join('L') + arcoA(rb, e(yc2) * rb, 1, [cx - rb, yc2]) +
      'L' + esq.join('L') + 'Z'
    )
  }

  function anel(yc: number): string {
    const rr = r(yc)
    return 'M' + ptTxt(P(-1.5, yc)) + arcoA(rr, e(yc) * rr, 0, P(1.5, yc))
  }

  function arco(v: number, meia: number): string {
    const y = ycDeV(v)
    return 'M' + ptTxt(W(-meia, v)) + arcoA(R, e(y) * R, 0, W(meia, v))
  }

  // Silhueta: lado esquerdo descendo, arco da frente do pé, lado direito subindo, metade de trás da costura.
  const lado = (s: 1 | -1, de: number, ate: number) => {
    const n = Math.max(1, Math.ceil(Math.abs(ate - de) / 2))
    return amostrar(n, (t) => {
      const yc = lerp(de, ate, t)
      return [cx + s * r(yc), yc]
    })
  }
  const silhueta =
    'M' + [...lado(-1, g.topo, y0), ...lado(-1, y1, g.base)].join('L') +
    arcoA(Rp, e(g.base) * Rp, 0, [cx + Rp, g.base]) +
    'L' + [...lado(1, g.base, y1), ...lado(1, y0, g.topo)].join('L') +
    arcoA(Ra, e(g.topo) * Ra, 0, [cx - Ra, g.topo]) + 'Z'

  const borda = (lado: 1 | -1) =>
    'M' +
    amostrar(Math.ceil((g.base - yP0) / 3), (t) => {
      const yc = lerp(yP0 + 3, g.base - 4, t)
      return [cx + lado * (r(yc) - 1.1), yc]
    }).join('L')

  return {
    g,
    e,
    r,
    y0,
    y1,
    vTopo: y0 + e(y0) * R,
    vBase: y1 + e(y1) * R,
    uBorda: uMax,
    P,
    W,
    enrolar,
    faixa,
    fatia,
    anel,
    arco,
    silhueta,
    corpo: fatia(y0, y1),
    bordaDir: borda(1),
    bordaEsq: borda(-1),
  }
}

// ——— Palavras (contornos de latas-glifos) ———

export type NomePalavra = keyof typeof PALAVRAS

export interface OpPalavra {
  /** Centro em u. */
  u: number
  /** Linha de base em v. */
  v: number
  /** Largura (em u) da palavra inteira. */
  larg: number
  /** Inclinação (itálico extra): deslocamento x por unidade de altura. */
  incl?: number
  /** Rotação no plano da arte, em graus (antes de enrolar). */
  rot?: number
  /** Ajuste por letra: deslocamento em v e rotação (graus) em torno do centro da letra. */
  letra?: (i: number) => { dv?: number; rot?: number; esc?: number }
  /** Traços extras (floreio etc.) no sistema da palavra: tamanho 100, linha de base em y = 0, x a partir de 0. */
  extra?: string
}

/** Contorno da palavra já enrolado no cilindro. */
export function palavra(c: Cilindro, nome: NomePalavra, op: OpPalavra): string {
  const p = PALAVRAS[nome]
  const s = op.larg / p.w
  const incl = op.incl ?? 0
  const ang = ((op.rot ?? 0) * Math.PI) / 180
  const cosA = Math.cos(ang), sinA = Math.sin(ang)
  let d = ''
  p.g.forEach(([x0], i) => {
    const aj = op.letra?.(i) ?? {}
    const la = ((aj.rot ?? 0) * Math.PI) / 180
    const esc = aj.esc ?? 1
    // centro aproximado da letra (para girar/escalar em torno dele)
    const prox = p.g[i + 1]?.[0] ?? p.w
    const lcx = (x0 + prox) / 2
    const lcy = (p.y1 + p.y2) / 2
    const cl = Math.cos(la) * esc, sl = Math.sin(la) * esc
    // letra local (x, y) → palavra: gira/escala em torno de (lcx, lcy), inclina, escala s, centra, gira, posiciona
    const m = (x: number, y: number): Pt => {
      const lx = x + x0 - lcx, ly = y - lcy
      let X = lcx + cl * lx - sl * ly
      let Y = lcy + sl * lx + cl * ly + (aj.dv ?? 0) / s
      X = X - incl * Y
      const ux = (X - p.w / 2) * s
      const vy = Y * s
      return [op.u + cosA * ux - sinA * vy, op.v + sinA * ux + cosA * vy]
    }
    // matriz afim equivalente a m (é afim): extrai a, b, c, d, e, f
    const o = m(0, 0), ex = m(1, 0), ey = m(0, 1)
    const mat: Matriz = [ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]]
    d += c.enrolar(p.g[i][1], mat)
  })
  if (op.extra) {
    const m = (x: number, y: number): Pt => {
      const X = x - incl * y
      const ux = (X - p.w / 2) * s
      const vy = y * s
      return [op.u + cosA * ux - sinA * vy, op.v + sinA * ux + cosA * vy]
    }
    const o = m(0, 0), ex = m(1, 0), ey = m(0, 1)
    d += c.enrolar(op.extra, [ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]])
  }
  return d
}

/** Círculo plano (u, v) em caminho cúbico (para enrolar). */
export function circuloD(x: number, y: number, rx: number, ry = rx): string {
  const kx = rx * 0.5523, ky = ry * 0.5523
  return (
    `M${x - rx} ${y}C${x - rx} ${y - ky} ${x - kx} ${y - ry} ${x} ${y - ry}` +
    `C${x + kx} ${y - ry} ${x + rx} ${y - ky} ${x + rx} ${y}` +
    `C${x + rx} ${y + ky} ${x + kx} ${y + ry} ${x} ${y + ry}` +
    `C${x - kx} ${y + ry} ${x - rx} ${y + ky} ${x - rx} ${y}Z`
  )
}

/** Aplica uma matriz afim a um caminho plano (M L Q C Z absolutos), sem enrolar. */
export function transformarD(d: string, m: Matriz): string {
  const tk = d.match(/[MLCQZmlcqz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? []
  const out: string[] = []
  let i = 0
  while (i < tk.length) {
    const t = tk[i]
    if (/[A-Za-z]/.test(t)) {
      out.push(t.toUpperCase())
      i++
      continue
    }
    const x = parseFloat(tk[i++])
    const y = parseFloat(tk[i++])
    out.push(fmt(m[0] * x + m[2] * y + m[4]) + ' ' + fmt(m[1] * x + m[3] * y + m[5]))
  }
  return out.join(' ').replace(/ ([MLCQZ]) /g, '$1').replace(/ Z/g, 'Z')
}

/** Matriz: escala s, gira (graus) e posiciona em (x, y). */
export function mat(x: number, y: number, s = 1, rotGraus = 0, sy = s): Matriz {
  const a = (rotGraus * Math.PI) / 180
  return [Math.cos(a) * s, Math.sin(a) * s, -Math.sin(a) * sy, Math.cos(a) * sy, x, y]
}

// ——— Cores ———

type RGB = [number, number, number]
function rgb(hex: string): RGB {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, (x) => x + x) : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const hex = (c: RGB) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
export function misturar(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b)
  return hex([lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)])
}
/** cor·m coberta por branco com opacidade s (mesma conta das camadas de luz sobre a arte). */
function tom(base: string, m: number, s: number): string {
  const c = rgb(base)
  const a = Math.min(1, s)
  return hex([c[0] * m * (1 - a) + 255 * a, c[1] * m * (1 - a) + 255 * a, c[2] * m * (1 - a) + 255 * a])
}

// Perfil de luz ao redor do cilindro, f = fração da largura (0 = borda esquerda). [f, multiplicador, especular]
// Luz de cima à esquerda: reflexo forte a ~25%, núcleo de sombra a ~75%, luz rebatida e fio de recorte à direita.
const PERFIL: readonly (readonly [number, number, number])[] = [
  [0, 0.16, 0],
  [0.012, 0.3, 0.16],
  [0.035, 0.42, 0.02],
  [0.09, 0.7, 0.02],
  [0.16, 0.92, 0.08],
  [0.215, 1, 0.3],
  [0.245, 1, 0.66],
  [0.27, 1, 0.5],
  [0.3, 1, 0.14],
  [0.36, 0.98, 0.04],
  [0.47, 0.93, 0.03],
  [0.6, 0.82, 0.05],
  [0.66, 0.74, 0.02],
  [0.75, 0.52, 0],
  [0.84, 0.5, 0],
  [0.91, 0.62, 0.05],
  [0.952, 0.7, 0.24],
  [0.972, 0.5, 0.05],
  [1, 0.18, 0],
]

// Perfil reduzido para as fatias (pescoço/pé): menos paradas, mesmos picos.
const PERFIL_CURTO = [0, 1, 2, 3, 5, 6, 8, 10, 12, 13, 15, 16, 18].map((i) => PERFIL[i])

/** Superfície de revolução em fatias opacas. O corte é adaptativo: fatia fina onde a luz muda rápido (sem degrau). */
function Fatias({ id, c, cor, perfil, ini, fim, sobra, metal, quando, reflexo = 1, fixos = [], emenda, max = 16, semRecorte }: {
  id: string
  c: Cilindro
  cor: (t: number) => string
  perfil: (t: number) => { b: number; w: number; k: number }
  ini: number
  fim: number
  sobra: number
  metal?: boolean
  quando: string
  reflexo?: number
  /** Cortes obrigatórios (t). */
  fixos?: number[]
  /** Teto aproximado de fatias. */
  max?: number
  /** Sem os fios especulares das bordas (superfície que foge do olho). */
  semRecorte?: boolean
  /** Gera também o gradiente `${id}-${quando}-em` da superfície em t (fio que cobre a emenda com o corpo). */
  emenda?: number
}) {
  // variação total de luz → tolerância por fatia (fatias finas só onde a luz muda rápido)
  let variacao = 0
  for (let t = 0.01; t <= 1; t += 0.01) {
    const a = perfil(t - 0.01), b = perfil(t)
    variacao += Math.abs(b.b - a.b) + 2 * Math.abs(b.w - a.w)
  }
  const tol = Math.max(0.03, variacao / max)
  const cortes = [0]
  let t0 = 0
  let p0 = perfil(0)
  for (let t = 0.01; t < 0.995; t += 0.01) {
    const p = perfil(t)
    const fixo = fixos.some((f) => f > t - 0.01 && f <= t)
    const dr = Math.abs(c.r(lerp(ini, fim, t)) - c.r(lerp(ini, fim, t0)))
    if (fixo || Math.abs(p.b - p0.b) + 2 * Math.abs(p.w - p0.w) > tol || t - t0 >= 0.2 || dr > 2.2) {
      cortes.push(t)
      t0 = t
      p0 = p
    }
  }
  cortes.push(1)
  const grad = (gid: string, tm: number) => {
    const { b, w, k } = perfil(tm)
    const base = cor(tm)
    return (
      <linearGradient key={gid} id={gid} x1="0" y1="0" x2="1" y2="0">
        {PERFIL_CURTO.map(([f, m, s], j) => (
          <stop key={j} offset={f} stopColor={tom(base, m * b, (semRecorte && (f < 0.05 || f > 0.93) ? 0 : s) * k * (metal ? 1 : reflexo) + w * (0.35 + 0.65 * m))} />
        ))}
      </linearGradient>
    )
  }
  const itens = []
  const grads = []
  for (let i = 0; i < cortes.length - 1; i++) {
    const ta = cortes[i], tb = cortes[i + 1]
    const ya = lerp(ini, fim, ta)
    const yb = Math.min(lerp(ini, fim, tb) + sobra, Math.max(ini, fim))
    const gid = `${id}-${quando}${i}`
    grads.push(grad(gid, (ta + tb) / 2))
    itens.push(<path key={i} d={c.fatia(ya, yb)} fill={`url(#${gid})`} />)
  }
  if (emenda != null) grads.push(grad(`${id}-${quando}-em`, emenda))
  return (
    <>
      <defs>{grads}</defs>
      {itens}
    </>
  )
}

export interface ConfigLata {
  /** Cor base impressa do corpo (fundo da arte). */
  fundo: string
  /** Cor impressa do pescoço (padrão = fundo). */
  pescoco?: string
  /** Alumínio cru (tampa, costura, pé). */
  metal?: string
  /** Intensidade dos reflexos sobre a arte (0..1). */
  reflexo?: number
  /** Cor do anel de abrir. */
  anel?: string
  /** Tom do fio de luz de recorte. */
  recorte?: string
}

/** Casco da lata. children = arte já enrolada (coordenadas de tela), recortada no corpo. */
export function Lata({ id, c, cfg, children }: { id: string; c: Cilindro; cfg: ConfigLata; children?: ReactNode }) {
  const g = c.g
  const { cx, R } = g
  const metal = cfg.metal ?? '#c4c8cd'
  const pesc = cfg.pescoco ?? cfg.fundo
  const reflexo = cfg.reflexo ?? 1
  const recorte = cfg.recorte ?? '#eef3ff'
  const Ra = g.rAro * R
  const eT = c.e(g.topo)
  const yP0 = g.topo + g.hAro
  // tampa: borda interna da costura, painel rebaixado
  const Ri = Ra - 6.5
  const Rpn = Ra - 10.5
  const yPn = g.topo + 6.5
  const ePn = c.e(yPn)
  const x0 = cx - R, x1 = cx + R
  const I = (s: string) => `${id}-${s}`

  return (
    <g>
      <defs>
        <clipPath id={I('corpo')}>
          <path d={c.corpo} />
        </clipPath>
        <clipPath id={I('boca')}>
          <ellipse cx={cx} cy={g.topo} rx={Ri} ry={Ri * eT} />
        </clipPath>
        <linearGradient id={I('sombra')} gradientUnits="userSpaceOnUse" x1={x0} y1="0" x2={x1} y2="0">
          {PERFIL.map(([f, m], j) => (
            <stop key={j} offset={f} stopColor="#000" stopOpacity={Math.max(0, 1 - m)} />
          ))}
        </linearGradient>
        <linearGradient id={I('luz')} gradientUnits="userSpaceOnUse" x1={x0} y1="0" x2={x1} y2="0">
          {PERFIL.map(([f, , s], j) => (
            <stop key={j} offset={f} stopColor="#fff" stopOpacity={Math.min(1, s * reflexo)} />
          ))}
        </linearGradient>
        <linearGradient id={I('vert')} gradientUnits="userSpaceOnUse" x1="0" y1={c.y0} x2="0" y2={c.vBase}>
          <stop offset="0" stopColor="#000" stopOpacity={0} />
          <stop offset="0.7" stopColor="#000" stopOpacity={0} />
          <stop offset="1" stopColor="#000" stopOpacity={0.26} />
        </linearGradient>
        {/* tampa */}
        <linearGradient id={I('labio')} gradientUnits="userSpaceOnUse" x1={cx - Ra} y1="0" x2={cx + Ra} y2="0">
          <stop offset="0" stopColor={tom(metal, 0.55, 0)} />
          <stop offset="0.18" stopColor={tom(metal, 1.05, 0.1)} />
          <stop offset="0.32" stopColor={tom(metal, 1.1, 0.2)} />
          <stop offset="0.6" stopColor={tom(metal, 0.86, 0)} />
          <stop offset="0.82" stopColor={tom(metal, 0.62, 0)} />
          <stop offset="1" stopColor={tom(metal, 0.5, 0)} />
        </linearGradient>
        <linearGradient id={I('crista')} gradientUnits="userSpaceOnUse" x1={cx - Ra} y1="0" x2={cx + Ra} y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity={0} />
          <stop offset="0.2" stopColor="#fff" stopOpacity={0.95} />
          <stop offset="0.42" stopColor="#fff" stopOpacity={0.75} />
          <stop offset="0.75" stopColor="#fff" stopOpacity={0.18} />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
        <linearGradient id={I('parede')} gradientUnits="userSpaceOnUse" x1="0" y1={g.topo - Ri * eT} x2="0" y2={yPn}>
          <stop offset="0" stopColor={tom(metal, 0.62, 0)} />
          <stop offset="0.5" stopColor={tom(metal, 0.82, 0.04)} />
          <stop offset="1" stopColor={tom(metal, 0.5, 0)} />
        </linearGradient>
        <radialGradient id={I('painel')} cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor={tom(metal, 1.12, 0.12)} />
          <stop offset="0.45" stopColor={tom(metal, 0.98, 0.02)} />
          <stop offset="0.85" stopColor={tom(metal, 0.74, 0)} />
          <stop offset="1" stopColor={tom(metal, 0.6, 0)} />
        </radialGradient>
        <linearGradient id={I('anel')} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor={tom(cfg.anel ?? metal, 1.15, 0.16)} />
          <stop offset="0.55" stopColor={tom(cfg.anel ?? metal, 0.95, 0.02)} />
          <stop offset="1" stopColor={tom(cfg.anel ?? metal, 0.68, 0)} />
        </linearGradient>
        <radialGradient id={I('rebite')} cx="0.38" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.5" stopColor={tom(metal, 0.95, 0.05)} />
          <stop offset="1" stopColor={tom(metal, 0.55, 0)} />
        </radialGradient>
        <linearGradient id={I('recorte')} gradientUnits="userSpaceOnUse" x1="0" y1={yP0} x2="0" y2={g.base}>
          <stop offset="0" stopColor={recorte} stopOpacity={0} />
          <stop offset="0.12" stopColor={recorte} stopOpacity={0.7} />
          <stop offset="0.8" stopColor={recorte} stopOpacity={0.55} />
          <stop offset="1" stopColor={recorte} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* pescoço impresso (fatias opacas: o reflexo dobra junto com a curva) */}
      <Fatias
        id={id}
        c={c}
        quando="pk"
        max={22}
        sobra={0.9}
        emenda={1}
        ini={yP0}
        fim={c.y0 + 0.5}
        reflexo={reflexo}
        cor={(t) => misturar(misturar(pesc, metal, 0.14 * (1 - t)), cfg.fundo, suave(clamp01((t - 0.55) / 0.45)))}
        perfil={(t) => ({
          b: tabela([[0, 0.48], [0.08, 0.62], [0.24, 1.12], [0.4, 1.08], [0.58, 0.98], [0.78, 1.0], [1, 1]], t) + 0.025 * Math.sin(t * Math.PI * 5) * (1 - t),
          w: tabela([[0, 0], [0.14, 0.07], [0.3, 0.15], [0.48, 0.07], [0.7, 0.01], [1, 0]], t),
          k: 1,
        })}
      />
      {/* afunilamento de baixo e pé: impressão acaba logo no começo da curva; o resto é alumínio */}
      <Fatias
        id={id}
        c={c}
        quando="pe"
        max={14}
        semRecorte
        sobra={0.9}
        fixos={[0.16]}
        emenda={0.02}
        ini={c.y1 - 0.5}
        fim={g.base}
        metal
        cor={(t) => (t < 0.16 ? cfg.fundo : misturar(metal, '#7b8086', 0.35))}
        perfil={(t) => ({
          b: tabela([[0, 0.9], [0.16, 0.78], [0.22, 0.55], [0.36, 0.36], [0.5, 0.66], [0.6, 0.44], [0.8, 0.3], [0.92, 0.36], [1, 0.7]], t),
          w: tabela([[0, 0], [0.45, 0], [0.5, 0.06], [0.56, 0], [1, 0]], t),
          k: 0.7,
        })}
      />

      {/* corpo: arte + luz do cilindro */}
      <path d={c.corpo} fill={cfg.fundo} />
      <g clipPath={`url(#${I('corpo')})`}>
        {children}
        <rect x={x0} y={c.y0 - 40} width={2 * R} height={c.vBase - c.y0 + 80} fill={`url(#${I('sombra')})`} />
        <rect x={x0} y={c.y0 - 40} width={2 * R} height={c.vBase - c.y0 + 80} fill={`url(#${I('luz')})`} />
        <rect x={x0} y={c.y0 - 40} width={2 * R} height={c.vBase - c.y0 + 80} fill={`url(#${I('vert')})`} />
      </g>

      {/* fios que cobrem as emendas corpo/pescoço e corpo/pé (sem risco de serrilhado) */}
      <path d={c.anel(c.y0)} fill="none" stroke={`url(#${I('pk-em')})`} strokeWidth={1.4} />
      <path d={c.anel(c.y1)} fill="none" stroke={`url(#${I('pe-em')})`} strokeWidth={1.4} />

      {/* face externa da costura */}
      <Fatias
        id={id}
        c={c}
        quando="cs"
        max={4}
        sobra={0.8}
        ini={g.topo}
        fim={yP0 + 0.6}
        metal
        cor={() => metal}
        perfil={(t) => ({ b: tabela([[0, 1.12], [0.5, 0.95], [1, 0.62]], t), w: tabela([[0, 0.1], [1, 0]], t), k: 1.2 })}
      />

      {/* topo: lábio da costura, boca com parede interna e painel rebaixado */}
      <ellipse cx={cx} cy={g.topo} rx={Ra} ry={Ra * eT} fill={`url(#${I('labio')})`} />
      <g clipPath={`url(#${I('boca')})`}>
        <rect x={cx - Ri} y={g.topo - Ri * eT - 1} width={2 * Ri} height={Ri * eT * 2 + 2} fill={`url(#${I('parede')})`} />
        <ellipse cx={cx} cy={yPn} rx={Rpn} ry={Rpn * ePn} fill={`url(#${I('painel')})`} />
        {/* cordão do painel e brilho escovado */}
        <ellipse cx={cx} cy={yPn + 0.6} rx={Rpn * 0.86} ry={Rpn * 0.86 * ePn} fill="none" stroke="#000" strokeOpacity={0.22} strokeWidth={1.1} />
        <ellipse cx={cx} cy={yPn} rx={Rpn * 0.86} ry={Rpn * 0.86 * ePn} fill="none" stroke="#fff" strokeOpacity={0.4} strokeWidth={0.8} />
        <ellipse cx={cx} cy={yPn} rx={Rpn * 0.62} ry={Rpn * 0.62 * ePn} fill="none" stroke="#fff" strokeOpacity={0.1} strokeWidth={4} />
        <ellipse cx={cx} cy={yPn} rx={Rpn} ry={Rpn * ePn} fill="none" stroke="#000" strokeOpacity={0.35} strokeWidth={1} />
        {/* anel de abrir, desenhado de cima e achatado no plano da tampa */}
        <g transform={`translate(${cx} ${yPn}) scale(1 ${ePn}) rotate(-7)`}>
          {/* risco do lacre (abertura) */}
          <path
            d="M-14 13C-27 19-28 47-19 60C-11 71 11 71 19 60C28 47 27 19 14 13"
            fill="none"
            stroke="#000"
            strokeOpacity={0.4}
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M-14 16C-26 22-26 47-18 59C-10 68 10 68 18 59C26 47 26 22 14 16"
            fill="none"
            stroke="#fff"
            strokeOpacity={0.45}
            strokeWidth={0.9}
            vectorEffect="non-scaling-stroke"
          />
          {/* sombra do anel */}
          <path d="M-15 17C-15 26 15 26 15 17L19-30C21-50 12-60 0-60C-12-60-21-50-19-30Z" transform="translate(3 7)" fill="#000" fillOpacity={0.28} />
          {/* anel */}
          <path
            d="M-15 17C-15 26 15 26 15 17L19-30C21-50 12-60 0-60C-12-60-21-50-19-30ZM-10-27C-12-36-10-49 0-50C10-49 12-36 10-27C8-21-8-21-10-27Z"
            fillRule="evenodd"
            fill={`url(#${I('anel')})`}
            stroke="#000"
            strokeOpacity={0.45}
            strokeWidth={0.9}
            vectorEffect="non-scaling-stroke"
          />
          <path d="M-13 15C-13 22 13 22 13 15L16-30C18-47 10-56 0-56C-10-56-18-47-16-30Z" fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
          <circle cx={0} cy={2} r={6} fill={`url(#${I('rebite')})`} stroke="#000" strokeOpacity={0.35} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
        </g>
      </g>
      {/* crista da costura: fio de luz na frente e nas costas */}
      <path
        d={`M${cx - Ra + 2.2} ${g.topo}A${Ra - 2.2} ${(Ra - 2.2) * eT} 0 0 0 ${cx + Ra - 2.2} ${g.topo}`}
        fill="none"
        stroke={`url(#${I('crista')})`}
        strokeWidth={1.6}
      />
      <path
        d={`M${cx - Ra + 1.5} ${g.topo}A${Ra - 1.5} ${(Ra - 1.5) * eT} 0 0 1 ${cx + Ra - 1.5} ${g.topo}`}
        fill="none"
        stroke={`url(#${I('crista')})`}
        strokeOpacity={0.55}
        strokeWidth={1.1}
      />
      <ellipse cx={cx} cy={g.topo} rx={Ri} ry={Ri * eT} fill="none" stroke="#000" strokeOpacity={0.45} strokeWidth={1} />

      {/* fios de luz de recorte nas bordas */}
      <path d={c.bordaDir} fill="none" stroke={`url(#${I('recorte')})`} strokeWidth={1.3} strokeLinecap="round" />
      <path d={c.bordaEsq} fill="none" stroke={`url(#${I('recorte')})`} strokeOpacity={0.4} strokeWidth={1} strokeLinecap="round" />
    </g>
  )
}

/** Memoiza um cálculo pesado (caminhos enrolados) na primeira chamada. */
export function uma<T>(f: () => T): () => T {
  let v: T | undefined
  return () => (v ??= f())
}
