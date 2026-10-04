// Ferramentas do grupo "destilados": contorno simétrico de garrafa, gradientes com opacidade,
// texto impresso em vidro cilíndrico (letra a letra, comprimida nas bordas como numa foto) e as
// estrias de tampa. Tudo em coordenadas do quadro 360×640 (comum.tsx).

import type { SVGProps } from 'react'

export type Pt = readonly [number, number]
/** Trecho do lado direito do contorno: reta até p, ou curva cúbica (c1, c2, p). x = distância ao eixo. */
export interface Seg {
  c1?: Pt
  c2?: Pt
  p: Pt
}
/** Meio contorno (lado direito), de cima para baixo. O lado esquerdo é o espelho. */
export interface Perfil {
  ini: Pt
  segs: Seg[]
}

/** Arredonda para 2 casas (caminhos menores e estáveis). */
export const n = (v: number) => String(Math.round(v * 100) / 100)

/**
 * Caminho fechado e simétrico a partir do meio perfil. `recuo` aproxima a parede de dentro
 * (o líquido): tira `recuo` da meia largura em toda a altura.
 */
export function contorno(cx: number, perfil: Perfil, recuo = 0): string {
  const X = (dx: number, lado: number) => n(cx + lado * Math.max(0, dx - recuo))
  const pt = (q: Pt, lado: number) => `${X(q[0], lado)} ${n(q[1])}`
  const { ini, segs } = perfil
  let d = `M${pt(ini, 1)}`
  for (const s of segs) d += s.c1 && s.c2 ? `C${pt(s.c1, 1)} ${pt(s.c2, 1)} ${pt(s.p, 1)}` : `L${pt(s.p, 1)}`
  d += `L${pt(segs[segs.length - 1].p, -1)}`
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]
    const a = i === 0 ? ini : segs[i - 1].p
    d += s.c1 && s.c2 ? `C${pt(s.c2, -1)} ${pt(s.c1, -1)} ${pt(a, -1)}` : `L${pt(a, -1)}`
  }
  return d + 'Z'
}

/** Parada de gradiente: [posição 0–1, cor, opacidade]. */
export type Parada = readonly [number, string, number?]

function Paradas({ p }: { p: readonly Parada[] }) {
  return (
    <>
      {p.map(([o, c, a], i) => (
        <stop key={i} offset={o} stopColor={c} stopOpacity={a ?? 1} />
      ))}
    </>
  )
}

/** Gradiente linear. Padrão: horizontal, na caixa do objeto. `us` = coordenadas do quadro. */
export function LG({ id, p, x1 = 0, y1 = 0, x2 = 1, y2 = 0, us = false }: { id: string; p: readonly Parada[]; x1?: number; y1?: number; x2?: number; y2?: number; us?: boolean }) {
  return (
    <linearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2} gradientUnits={us ? 'userSpaceOnUse' : 'objectBoundingBox'}>
      <Paradas p={p} />
    </linearGradient>
  )
}

/** Gradiente radial em coordenadas do quadro (pode ser achatado com sx/sy em torno do centro). */
export function RG({ id, p, cx, cy, r, fx, fy, sx = 1, sy = 1 }: { id: string; p: readonly Parada[]; cx: number; cy: number; r: number; fx?: number; fy?: number; sx?: number; sy?: number }) {
  const t = sx !== 1 || sy !== 1 ? `translate(${n(cx)} ${n(cy)}) scale(${sx} ${sy}) translate(${n(-cx)} ${n(-cy)})` : undefined
  return (
    <radialGradient id={id} cx={cx} cy={cy} r={r} fx={fx ?? cx} fy={fy ?? cy} gradientUnits="userSpaceOnUse" gradientTransform={t}>
      <Paradas p={p} />
    </radialGradient>
  )
}

/** Paradas "cilíndricas" de material (metal, plástico, vidro): bordas escuras, reflexo forte a ~25%, aro à direita. */
export function cilindroMaterial(c: { borda: string; base: string; claro: string; brilho: string; sombra: string; aro: string }): Parada[] {
  return [
    [0, c.borda],
    [0.07, c.base],
    [0.17, c.claro],
    [0.245, c.brilho],
    [0.31, c.claro],
    [0.47, c.base],
    [0.72, c.sombra],
    [0.89, c.aro],
    [0.96, c.base],
    [1, c.borda],
  ]
}

/** Larguras aproximadas (em em) das maiúsculas de uma serifa clássica, para espaçar letra a letra. */
const LARGURA: Record<string, number> = {
  A: 0.72, B: 0.66, C: 0.68, D: 0.75, E: 0.64, F: 0.6, G: 0.74, H: 0.8, I: 0.38, J: 0.48, K: 0.72, L: 0.6, M: 0.9,
  N: 0.78, O: 0.77, P: 0.62, Q: 0.77, R: 0.7, S: 0.57, T: 0.65, U: 0.76, V: 0.72, W: 1, X: 0.72, Y: 0.66, Z: 0.62,
  Ä: 0.72, Ö: 0.77, Ü: 0.76, ' ': 0.32, '.': 0.28, ',': 0.28, '&': 0.78, '%': 0.85, '·': 0.3,
  0: 0.58, 1: 0.58, 2: 0.58, 3: 0.58, 4: 0.58, 5: 0.58, 6: 0.58, 7: 0.58, 8: 0.58, 9: 0.58,
}

/**
 * Texto impresso/estampado num cilindro de raio `raio` (visto de frente): cada letra vai para
 * x = cx + R·sen(θ) e é comprimida por cos(θ). `curva` > 0 entorta a linha para baixo nas bordas
 * (abaixo do olho), < 0 para cima (acima do olho).
 */
export function TextoCurvo({ texto, cx, y, raio, tam, esp = 0, curva = 0, ...resto }: { texto: string; cx: number; y: number; raio: number; tam: number; esp?: number; curva?: number } & Omit<SVGProps<SVGGElement>, 'y'>) {
  const letras = [...texto]
  const larg = letras.map((c) => (LARGURA[c] ?? 0.56) * tam)
  const total = larg.reduce((a, b) => a + b, 0) + esp * (letras.length - 1)
  let s = -total / 2
  const filhos = letras.map((c, i) => {
    const centro = s + larg[i] / 2
    s += larg[i] + esp
    if (c === ' ') return null
    const th = Math.max(-1.45, Math.min(1.45, centro / raio))
    const k = Math.cos(th)
    const x = cx + raio * Math.sin(th)
    const yy = y + curva * (1 - k)
    return (
      <text key={i} transform={`translate(${n(x)} ${n(yy)}) scale(${n(k)} 1)`} textAnchor="middle">
        {c}
      </text>
    )
  })
  return (
    <g fontSize={tam} {...resto}>
      {filhos}
    </g>
  )
}

/**
 * Estrias verticais de tampa (serrilhado) num cilindro: linhas claras e escuras alternadas,
 * mais juntas perto das bordas (projeção), mais claras do lado da luz.
 */
export function Estrias({ cx, raio, y1, y2, qtd = 28, clara = 0.22, escura = 0.5 }: { cx: number; raio: number; y1: number; y2: number; qtd?: number; clara?: number; escura?: number }) {
  const linhas = []
  for (let i = 1; i < qtd; i++) {
    const th = -Math.PI / 2 + (Math.PI * i) / qtd
    const x = cx + raio * Math.sin(th)
    // luz vinda da esquerda: mais forte em θ ≈ -0.6
    const luz = Math.max(0, Math.cos(th + 0.6))
    const w = Math.max(0.35, 1.3 * Math.cos(th))
    linhas.push(<rect key={`e${i}`} x={n(x - w / 2)} y={y1} width={n(w * 0.55)} height={y2 - y1} fill="#000" fillOpacity={n(escura * (0.55 + 0.45 * Math.cos(th)))} />)
    linhas.push(<rect key={`c${i}`} x={n(x + w * 0.05)} y={y1} width={n(w * 0.45)} height={y2 - y1} fill="#fff" fillOpacity={n(clara * luz)} />)
  }
  return <g>{linhas}</g>
}
