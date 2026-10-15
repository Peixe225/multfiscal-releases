// Base do grupo "acessorios": utilitários de geometria para desenhar objetos em perspectiva com SVG puro.
// - deformar(): leva um contorno (comandos absolutos M L Q C Z) ponto a ponto por uma função — é assim que a marca
//   vai para o fundo da bandeja em perspectiva, para o fundo da cuia ou para a curva do isqueiro/piteira.
// - palavra(): posiciona uma palavra de acessorios-glifos (tamanho 100, base em y = 0) e devolve o caminho deformado.
// - vista3d(): câmera simples (giro no plano, elevação e perspectiva leve) para a bandeja.
// - prng(): aleatório com semente, para texturas geradas uma vez (sem filtros).
import type { Palavra } from './acessorios-glifos'

export type Pt = [number, number]
export type P3 = [number, number, number]

export const r1 = (n: number) => Math.round(n * 10) / 10
export const r2 = (n: number) => Math.round(n * 100) / 100

/** Aleatório determinístico (mulberry32). */
export function prng(semente: number) {
  let a = semente >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Passa todos os pontos de um caminho absoluto (M L Q C Z, números separados por espaço ou sinal) por `f`.
 * Retas mais longas que `passo` são quebradas em pedaços para acompanhar deformações curvas.
 */
export function deformar(d: string, f: (x: number, y: number) => Pt, passo = 6): string {
  const tk = d.match(/[MLQCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []
  let i = 0
  let cmd = ''
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  const out: string[] = []
  const num = () => parseFloat(tk[i++])
  const pt = (x: number, y: number) => {
    const [a, b] = f(x, y)
    return `${r1(a)} ${r1(b)}`
  }
  const reta = (x: number, y: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x - cx, y - cy) / passo))
    for (let k = 1; k <= n; k++) out.push('L' + pt(cx + ((x - cx) * k) / n, cy + ((y - cy) * k) / n))
    cx = x
    cy = y
  }
  while (i < tk.length) {
    if (/^[MLQCZ]$/i.test(tk[i])) cmd = tk[i++].toUpperCase()
    if (cmd === 'Z') {
      if (cx !== sx || cy !== sy) reta(sx, sy)
      out.push('Z')
      cx = sx
      cy = sy
      cmd = ''
      continue
    }
    if (cmd === 'M') {
      const x = num()
      const y = num()
      out.push('M' + pt(x, y))
      cx = sx = x
      cy = sy = y
      cmd = 'L'
    } else if (cmd === 'L') {
      reta(num(), num())
    } else if (cmd === 'Q') {
      const x1 = num()
      const y1 = num()
      const x = num()
      const y = num()
      out.push('Q' + pt(x1, y1) + ' ' + pt(x, y))
      cx = x
      cy = y
    } else if (cmd === 'C') {
      const x1 = num()
      const y1 = num()
      const x2 = num()
      const y2 = num()
      const x = num()
      const y = num()
      out.push('C' + pt(x1, y1) + ' ' + pt(x2, y2) + ' ' + pt(x, y))
      cx = x
      cy = y
    } else {
      i++
    }
  }
  return out.join('')
}

export type Ancora = 'inicio' | 'meio' | 'fim'

/**
 * Caminho de uma palavra num plano local (u para a direita, v para baixo), com altura de maiúscula `h` (ou largura `w`),
 * linha de base em (u, v) e depois levada ao quadro por `f` (identidade se omitida).
 */
export function palavra(
  p: Palavra,
  o: { u: number; v: number; h?: number; w?: number; sx?: number; ancora?: Ancora; meioV?: boolean },
  f: (u: number, v: number) => Pt = (u, v) => [u, v],
  passo = 6,
): string {
  const sx = o.sx ?? 1
  const s = o.w != null ? o.w / (p.w * sx) : (o.h ?? 10) / -p.y1
  const larg = p.w * s * sx
  const u0 = o.ancora === 'inicio' ? o.u : o.ancora === 'fim' ? o.u - larg : o.u - larg / 2
  // meioV: v é o centro vertical do contorno (y1..y2), não a linha de base
  const v0 = o.meioV ? o.v - ((p.y1 + p.y2) / 2) * s : o.v
  return deformar(p.d, (x, y) => f(u0 + x * s * sx, v0 + y * s), passo / Math.max(s, 0.01))
}

/** Tamanho final (largura, altura de maiúscula) de uma palavra posta com altura h. */
export const medida = (p: Palavra, h: number, sx = 1) => ({ w: (p.w * h * sx) / -p.y1, h })

/** Polígono/polilinha a partir de pontos. */
export function poli(pts: Pt[], fechar = true) {
  return pts.map((p, k) => (k ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1])).join('') + (fechar ? 'Z' : '')
}

/**
 * Câmera simples: gira o objeto no próprio plano (giro, graus), inclina (elev = ângulo de visão acima do horizonte, 90 = de
 * cima), aplica perspectiva fraca (dist = distância da câmera em unidades do objeto) e põe no quadro com escala e centro.
 * Objeto: x para a direita, y para o fundo, z para cima.
 */
export function vista3d(o: { giro: number; elev: number; dist: number; escala: number; cx: number; cy: number; giroTela?: number }) {
  const g = (o.giro * Math.PI) / 180
  const e = (o.elev * Math.PI) / 180
  const t = ((o.giroTela ?? 0) * Math.PI) / 180
  const cg = Math.cos(g)
  const sg = Math.sin(g)
  const ce = Math.cos(e)
  const se = Math.sin(e)
  const ct = Math.cos(t)
  const st = Math.sin(t)
  /** Coordenadas de câmera: [x tela, y tela (para baixo), profundidade (positiva = longe)]. */
  const cam = ([x, y, z]: P3): P3 => {
    const xr = x * cg - y * sg
    const yr = x * sg + y * cg
    // eixo y (fundo) sobe na tela e se afasta; z sobe na tela e se aproxima
    const ys = -(yr * se + z * ce)
    const prof = yr * ce - z * se
    return [xr, ys, prof]
  }
  const proj = (p: P3): Pt => {
    const [x, y, prof] = cam(p)
    const k = (o.dist / (o.dist + prof)) * o.escala
    const X = x * k
    const Y = y * k
    return [o.cx + X * ct - Y * st, o.cy + X * st + Y * ct]
  }
  /** Direção da câmera no espaço do objeto (do objeto para o olho), para saber se uma face está de frente. */
  const olho: P3 = [-ce * sg, -ce * cg, se]
  return { proj, cam, olho }
}

/** Contorno de um retângulo de cantos redondos (centrado na origem), amostrado com `n` pontos por canto. */
export function retRedondo(w: number, h: number, r: number, n = 10): Pt[] {
  const pts: Pt[] = []
  const cs: [number, number, number][] = [
    [w / 2 - r, -h / 2 + r, -90],
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, 90],
    [-w / 2 + r, -h / 2 + r, 180],
  ]
  for (const [cx, cy, a0] of cs) {
    for (let k = 0; k <= n; k++) {
      const a = ((a0 + (90 * k) / n) * Math.PI) / 180
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  }
  return pts
}

/** Normal externa (no plano) de cada ponto de um contorno fechado amostrado (sentido horário em y para baixo). */
export function normais(pts: Pt[]): Pt[] {
  return pts.map((_, k) => {
    const a = pts[(k - 1 + pts.length) % pts.length]
    const b = pts[(k + 1) % pts.length]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l = Math.hypot(dx, dy) || 1
    return [dy / l, -dx / l]
  })
}

/** Mistura duas cores hex (t = 0 → a, 1 → b). */
export function mistura(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const c = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t)
  return '#' + ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1)
}
