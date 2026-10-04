// Base do grupo "papel": livreto de papelão em pé, inclinado, com espessura (lombada dobrada e ponta aberta mostrando
// o maço de folhas), aba dobrada por cima da capa e folhas finíssimas saindo pela abertura.
// Tudo é desenhado num sistema LOCAL "deitado" (comprimento L no eixo x, altura S no eixo y, abertura em y = 0,
// lombada em y = S) e girado no quadro. Com o giro negativo (~ -68°) o texto sobe da esquerda para a direita,
// a abertura fica à esquerda, a lombada à direita e a ponta x = L vira o topo — luz de cima à esquerda (comum.tsx).
import type { ReactNode } from 'react'
import type { Palavra } from './papel-glifos'

/* ------------------------------------------------------------------ texto em caminho */

export type Ancora = 'inicio' | 'meio' | 'fim'

/** Põe uma palavra (contorno no tamanho 100) com altura de maiúscula `h` ou largura `w`. */
export function Txt({
  p,
  x,
  y,
  h,
  w,
  sx = 1,
  ancora = 'inicio',
  fill,
  opacity,
  stroke,
  strokeWidth,
}: {
  p: Palavra
  x: number
  y: number
  h?: number
  w?: number
  /** Estica/aperta na horizontal. */
  sx?: number
  ancora?: Ancora
  fill: string
  opacity?: number
  stroke?: string
  strokeWidth?: number
}) {
  const s = w != null ? w / (p.w * sx) : (h ?? 10) / -p.y1
  const larg = p.w * s * sx
  const x0 = ancora === 'meio' ? x - larg / 2 : ancora === 'fim' ? x - larg : x
  return (
    <path
      d={p.d}
      fill={fill}
      opacity={opacity}
      stroke={stroke}
      strokeWidth={stroke ? (strokeWidth ?? 1) / s : undefined}
      strokeLinejoin="round"
      transform={`translate(${r2(x0)} ${r2(y)}) scale(${r3(s * sx)} ${r3(s)})`}
    />
  )
}

/** Largura final de uma palavra posta com altura de maiúscula h. */
export const largura = (p: Palavra, h: number, sx = 1) => (p.w * h * sx) / -p.y1

const r2 = (n: number) => Math.round(n * 100) / 100
const r3 = (n: number) => Math.round(n * 10000) / 10000

/* ------------------------------------------------------------------ texturas (geradas uma vez) */

function prng(semente: number) {
  let a = semente >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const f1 = (n: number) => Math.round(n * 10) / 10

/**
 * Fibras de papel natural num ladrilho T×T (caminhos já "embrulhados" nas bordas, sem emenda visível).
 * Devolve 3 camadas: fibras escuras, fibras claras e pintinhas.
 */
function fibras(T: number, n: number, semente: number) {
  const rnd = prng(semente)
  let escuras = ''
  let claras = ''
  let pintas = ''
  const copias = (x: number, y: number, m: number) => {
    const out: [number, number][] = [[0, 0]]
    if (x < m) out.push([T, 0])
    if (x > T - m) out.push([-T, 0])
    if (y < m) out.push([0, T])
    if (y > T - m) out.push([0, -T])
    return out
  }
  for (let i = 0; i < n; i++) {
    const x = rnd() * T
    const y = rnd() * T
    const comp = 1.5 + rnd() * rnd() * 7
    const a = rnd() * Math.PI
    const curva = (rnd() - 0.5) * comp * 0.6
    const dx = Math.cos(a) * comp
    const dy = Math.sin(a) * comp
    for (const [ox, oy] of copias(x, y, comp)) {
      const x0 = x + ox
      const y0 = y + oy
      const d = `M${f1(x0)} ${f1(y0)}q${f1(dx / 2 - dy * curva * 0.08)} ${f1(dy / 2 + dx * curva * 0.08)} ${f1(dx)} ${f1(dy)}`
      if (rnd() < 0.58) escuras += d
      else claras += d
    }
  }
  for (let i = 0; i < n * 0.55; i++) {
    const x = rnd() * T
    const y = rnd() * T
    const r = 0.25 + rnd() * 0.55
    for (const [ox, oy] of copias(x, y, 2)) pintas += `M${f1(x + ox - r)} ${f1(y + oy)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`
  }
  return { escuras, claras, pintas }
}

const FIBRAS = fibras(96, 190, 7)
const FIBRAS_FINAS = fibras(80, 90, 21)

/** Falhas de tinta (carimbo) num ladrilho — usado como máscara sobre a impressão. */
const FALHAS = (() => {
  const rnd = prng(99)
  const T = 64
  let d = ''
  for (let i = 0; i < 70; i++) {
    const x = rnd() * T
    const y = rnd() * T
    const rx = 0.3 + rnd() * 1.1
    const ry = rx * (0.4 + rnd() * 0.8)
    d += `M${f1(x - rx)} ${f1(y)}a${f1(rx)} ${f1(ry)} 0 1 0 ${f1(2 * rx)} 0a${f1(rx)} ${f1(ry)} 0 1 0 ${f1(-2 * rx)} 0`
  }
  return { T, d }
})()

/** Padrão de fibras (papel kraft / sem branqueamento). */
export function PadraoFibras({ id, escura, clara, forca = 1, finas = false }: { id: string; escura: string; clara: string; forca?: number; finas?: boolean }) {
  const f = finas ? FIBRAS_FINAS : FIBRAS
  const T = finas ? 80 : 96
  return (
    <pattern id={id} width={T} height={T} patternUnits="userSpaceOnUse" patternTransform="rotate(8)">
      <path d={f.escuras} fill="none" stroke={escura} strokeOpacity={0.2 * forca} strokeWidth={0.45} strokeLinecap="round" />
      <path d={f.claras} fill="none" stroke={clara} strokeOpacity={0.24 * forca} strokeWidth={0.55} strokeLinecap="round" />
      <path d={f.pintas} fill={escura} fillOpacity={0.3 * forca} />
    </pattern>
  )
}

/** Máscara de tinta gasta: branco com pintinhas pretas (aplicar na impressão). */
export function MascaraFalhas({ id, x, y, w, h, forca = 1 }: { id: string; x: number; y: number; w: number; h: number; forca?: number }) {
  return (
    <>
      <pattern id={`${id}-p`} width={FALHAS.T} height={FALHAS.T} patternUnits="userSpaceOnUse" patternTransform="rotate(-12) scale(0.9)">
        <path d={FALHAS.d} fill="#000" fillOpacity={0.85 * forca} />
      </pattern>
      <mask id={id} maskUnits="userSpaceOnUse" x={x} y={y} width={w} height={h}>
        <rect x={x} y={y} width={w} height={h} fill="#fff" />
        <rect x={x} y={y} width={w} height={h} fill={`url(#${id}-p)`} />
      </mask>
    </>
  )
}

/* ------------------------------------------------------------------ livreto */

export interface CoresLivreto {
  /** Cor da capa (papelão). */
  capa: string
  /** Lombada: fundo do papelão dobrado (mais escuro) e o fio de luz da borda. */
  lombada: string
  lombadaLuz: string
  /** Ponta aberta: borda do papelão e o maço de folhas. */
  corte: string
  folhas: string
}

export interface FormaLivreto {
  L: number
  S: number
  /** Raio dos cantos. */
  r: number
  /** Deslocamento da face de trás (espessura) no sistema local: [x, y]. */
  esp: [number, number]
  /** Giro (graus) e centro no quadro. */
  ang: number
  cx: number
  cy: number
  /** Altura da aba dobrada (a partir de y = 0). */
  aba: number
}

/** Folha de seda saindo da abertura (no sistema local, acima de y = 0). */
export interface Folha {
  /** Início e fim no comprimento. */
  x0: number
  x1: number
  /** Quanto sai em cada ponta. */
  h0: number
  h1: number
  /** Ondulação do topo (+ para fora). */
  onda?: number
  /** Opacidade do papel. */
  op?: number
}

export function Livreto({
  id,
  forma,
  cores,
  folhas = [],
  extraAtras,
  capa,
  aba,
  brilho = 1,
  fosco = 0,
  corFolha = ['#fbfaf6', '#f4f1ea', '#d9d5cc'],
}: {
  id: string
  forma: FormaLivreto
  cores: CoresLivreto
  folhas?: Folha[]
  /** Desenho entre as folhas e o corpo (ex.: piteiras saindo). */
  extraAtras?: ReactNode
  /** Impressão da capa (abaixo da aba). Recebe o sistema local inteiro; a aba cobre y < forma.aba. */
  capa: ReactNode
  /** Impressão da aba. */
  aba: ReactNode
  /** Intensidade do reflexo especular (capa lisa ~1, papel kraft ~0.5). */
  brilho?: number
  /** Escurecimento extra para materiais escuros (deixa o reflexo mais visível). */
  fosco?: number
  /** Cor da seda: topo, meio e base. */
  corFolha?: [string, string, string]
}) {
  const u = (s: string) => `${id}-${s}`
  const url = (s: string) => `url(#${u(s)})`
  const { L, S, r, esp, ang, cx, cy } = forma
  const [ex, ey] = esp
  const A = forma.aba
  const ret = (dx: number, dy: number) =>
    `M${r + dx} ${dy}H${L - r + dx}Q${L + dx} ${dy} ${L + dx} ${r + dy}V${S - r + dy}Q${L + dx} ${S + dy} ${L - r + dx} ${S + dy}H${r + dx}Q${dx} ${S + dy} ${dx} ${S - r + dy}V${r + dy}Q${dx} ${dy} ${r + dx} ${dy}Z`
  // silhueta "varrida" (frente + trás + passos intermediários): base da lombada e da ponta
  const passos = [0, 0.25, 0.5, 0.75, 1].map((t) => ret(ex * t, ey * t)).join('')
  const frente = ret(0, 0)

  // direção da luz (cima-esquerda do quadro) no sistema local
  const ar = (ang * Math.PI) / 180
  const lx = -0.6 * Math.cos(ar) - 0.8 * Math.sin(ar)
  const ly = 0.6 * Math.sin(ar) - 0.8 * Math.cos(ar)
  const kL = Math.abs(lx) * (L / 2) + Math.abs(ly) * (S / 2)
  /** Quanto a ponta x = L recebe de luz (0..1). */
  const luzPonta = Math.max(0, lx)
  const [sedaTopo, sedaMeio, sedaBase] = corFolha

  /** Contorno da folha: sai da abertura (y = 0) com a dobra em cima, levemente ondulada, pontas arredondadas. */
  const folhaD = (f: Folha) => {
    const onda = f.onda ?? 2
    const a = f.x0
    const b = f.x1
    const t1 = a + (b - a) * 0.33
    const t2 = a + (b - a) * 0.66
    const h = (t: number) => f.h0 + (f.h1 - f.h0) * t
    const r0 = Math.min(6, h(0) * 0.8)
    const r1 = Math.min(6, f.h1 * 0.8)
    return (
      `M${a} 10L${a} ${-h(0) + r0}Q${a} ${-h(0)} ${a + r0 * 1.6} ${-h(0)}` +
      `C${t1} ${-h(0.33) - onda} ${t2} ${-h(0.66) + onda * 0.6} ${b - r1 * 1.6} ${-f.h1}` +
      `Q${b} ${-f.h1} ${b} ${-f.h1 + r1}L${b} 10Z`
    )
  }
  /** Só o fio da dobra (topo da folha). */
  const dobraD = (f: Folha) => {
    const onda = f.onda ?? 2
    const a = f.x0
    const b = f.x1
    const t1 = a + (b - a) * 0.33
    const t2 = a + (b - a) * 0.66
    const h = (t: number) => f.h0 + (f.h1 - f.h0) * t
    const r0 = Math.min(6, h(0) * 0.8)
    const r1 = Math.min(6, f.h1 * 0.8)
    return `M${a + r0 * 1.2} ${-h(0) + 0.5}C${t1} ${-h(0.33) - onda + 0.5} ${t2} ${-h(0.66) + onda * 0.6 + 0.5} ${b - r1 * 1.2} ${-f.h1 + 0.5}`
  }
  const hMax = Math.max(4, ...folhas.map((f) => Math.max(f.h0, f.h1) + (f.onda ?? 2)))

  return (
    <g transform={`translate(${cx} ${cy}) rotate(${ang}) translate(${-L / 2} ${-S / 2})`}>
      <defs>
        <clipPath id={u('frente')}>
          <path d={frente} />
        </clipPath>
        <clipPath id={u('varrida')}>
          <path d={passos} />
        </clipPath>
        {/* lombada dobrada: cilindro estreito (sobe da capa, núcleo escuro, fio de luz na borda de trás) */}
        <linearGradient id={u('lomb')} gradientUnits="userSpaceOnUse" x1={0} y1={S - 2} x2={ex * 0.25} y2={S + ey + 1}>
          <stop offset={0} stopColor={cores.capa} />
          <stop offset={0.3} stopColor={cores.lombada} />
          <stop offset={0.62} stopColor={cores.lombada} stopOpacity={0.92} />
          <stop offset={0.86} stopColor={cores.lombadaLuz} />
          <stop offset={1} stopColor={cores.lombada} />
        </linearGradient>
        <linearGradient id={u('lombL')} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={L} y2={0}>
          <stop offset={0} stopColor="#000" stopOpacity={0.55} />
          <stop offset={0.5} stopColor="#000" stopOpacity={0.15} />
          <stop offset={1} stopColor="#fff" stopOpacity={0.08} />
        </linearGradient>
        {/* ponta aberta (topo no quadro): capa, maço de folhas, capa */}
        <linearGradient id={u('ponta')} gradientUnits="userSpaceOnUse" x1={L} y1={0} x2={L + ex} y2={ey}>
          <stop offset={0} stopColor={cores.corte} />
          <stop offset={0.14} stopColor={cores.corte} />
          <stop offset={0.18} stopColor={cores.folhas} />
          <stop offset={0.8} stopColor={cores.folhas} />
          <stop offset={0.84} stopColor={cores.corte} />
          <stop offset={1} stopColor={cores.corte} />
        </linearGradient>
        <linearGradient id={u('pontaS')} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={S + ey}>
          <stop offset={0} stopColor="#fff" stopOpacity={0.28} />
          <stop offset={0.5} stopColor="#fff" stopOpacity={0} />
          <stop offset={1} stopColor="#000" stopOpacity={0.4} />
        </linearGradient>
        {/* luz da capa: de cima à esquerda do quadro (direção calculada a partir do giro) */}
        <linearGradient id={u('luz')} gradientUnits="userSpaceOnUse" x1={L / 2 - lx * kL} y1={S / 2 - ly * kL} x2={L / 2 + lx * kL} y2={S / 2 + ly * kL}>
          <stop offset={0} stopColor="#000" stopOpacity={0.36 + fosco * 0.1} />
          <stop offset={0.4} stopColor="#000" stopOpacity={0.1} />
          <stop offset={0.75} stopColor="#000" stopOpacity={0} />
          <stop offset={1} stopColor="#fff" stopOpacity={0.08} />
        </linearGradient>
        {/* bojo: a capa arredonda para a lombada (y = S) */}
        <linearGradient id={u('bojo')} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={S}>
          <stop offset={0} stopColor="#fff" stopOpacity={0.05} />
          <stop offset={0.3} stopColor="#fff" stopOpacity={0.04} />
          <stop offset={0.55} stopColor="#000" stopOpacity={0} />
          <stop offset={0.86} stopColor="#000" stopOpacity={0.14 + fosco * 0.06} />
          <stop offset={1} stopColor="#000" stopOpacity={0.36} />
        </linearGradient>
        {/* reflexo de softbox atravessando a capa (faixa larga e suave) */}
        <linearGradient id={u('reflexo')} gradientUnits="userSpaceOnUse" x1={L * 0.5} y1={0} x2={L * 0.74} y2={S * 0.25}>
          <stop offset={0} stopColor="#fff" stopOpacity={0} />
          <stop offset={0.4} stopColor="#fff" stopOpacity={0.03 * brilho} />
          <stop offset={0.5} stopColor="#fff" stopOpacity={0.09 * brilho} />
          <stop offset={0.56} stopColor="#fff" stopOpacity={0.12 * brilho} />
          <stop offset={0.61} stopColor="#fff" stopOpacity={0.05 * brilho} />
          <stop offset={0.72} stopColor="#fff" stopOpacity={0.015 * brilho} />
          <stop offset={1} stopColor="#fff" stopOpacity={0} />
        </linearGradient>
        {/* vinco da aba (dobra arredondada em y = 0) e sombra que a aba faz na capa */}
        <linearGradient id={u('vinco')} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={A}>
          <stop offset={0} stopColor="#000" stopOpacity={0.35} />
          <stop offset={0.03} stopColor="#fff" stopOpacity={0.3 * brilho + 0.06} />
          <stop offset={0.1} stopColor="#fff" stopOpacity={0.1} />
          <stop offset={0.3} stopColor="#fff" stopOpacity={0.03} />
          <stop offset={0.85} stopColor="#000" stopOpacity={0} />
          <stop offset={1} stopColor="#000" stopOpacity={0.1} />
        </linearGradient>
        <linearGradient id={u('sombraAba')} gradientUnits="userSpaceOnUse" x1={0} y1={A} x2={0} y2={A + 7}>
          <stop offset={0} stopColor="#000" stopOpacity={0.55} />
          <stop offset={0.35} stopColor="#000" stopOpacity={0.22} />
          <stop offset={1} stopColor="#000" stopOpacity={0} />
        </linearGradient>
        {/* folha de seda: translúcida, mais clara na dobra (luz atravessando), some para dentro do livreto */}
        <linearGradient id={u('seda')} gradientUnits="userSpaceOnUse" x1={0} y1={-hMax} x2={0} y2={1}>
          <stop offset={0} stopColor={sedaTopo} stopOpacity={0.96} />
          <stop offset={Math.max(0.1, 1 - 9 / (hMax + 1))} stopColor={sedaTopo} stopOpacity={0.92} />
          <stop offset={Math.max(0.3, 1 - 4 / (hMax + 1))} stopColor={sedaMeio} stopOpacity={0.84} />
          <stop offset={1} stopColor={sedaBase} stopOpacity={0.7} />
        </linearGradient>
        <linearGradient id={u('sedaL')} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={L} y2={0}>
          <stop offset={0} stopColor="#000" stopOpacity={0.16} />
          <stop offset={0.45} stopColor="#000" stopOpacity={0} />
          <stop offset={0.8} stopColor="#fff" stopOpacity={0.12} />
          <stop offset={1} stopColor="#000" stopOpacity={0.04} />
        </linearGradient>
        {/* penumbra dentro da abertura (as folhas somem para dentro do maço) */}
        <linearGradient id={u('sedaFundo')} gradientUnits="userSpaceOnUse" x1={0} y1={-3.5} x2={0} y2={0}>
          <stop offset={0} stopColor="#000" stopOpacity={0} />
          <stop offset={1} stopColor="#000" stopOpacity={0.32} />
        </linearGradient>
        {/* marca d'água do papel (linhas de corrente, perpendiculares à dobra) */}
        <pattern id={u('linhasSeda')} width={4.2} height={60} patternUnits="userSpaceOnUse">
          <rect width={0.45} height={60} fill="#6f6a60" fillOpacity={0.1} />
        </pattern>
      </defs>

      {/* folhas de seda (atrás do corpo, saindo pela abertura): papel finíssimo, a de trás aparece através da da frente */}
      {folhas.map((f, i) => (
        <g key={i} opacity={f.op ?? 1}>
          <path d={folhaD(f)} fill={url('seda')} />
          <path d={folhaD(f)} fill={url('linhasSeda')} />
          <path d={folhaD(f)} fill={url('sedaL')} />
          <path d={folhaD(f)} fill={url('sedaFundo')} />
          {/* borda fininha e a dobra pegando luz */}
          <path d={folhaD(f)} fill="none" stroke="#fff" strokeOpacity={0.35} strokeWidth={0.5} />
          <path d={dobraD(f)} fill="none" stroke="#fff" strokeOpacity={0.95} strokeWidth={1.2} strokeLinecap="round" />
        </g>
      ))}
      {extraAtras}

      {/* espessura: lombada (direita no quadro) e ponta aberta (topo) */}
      <g clipPath={url('varrida')}>
        <path d={passos} fill={cores.lombada} />
        <rect x={-10} y={S * 0.5} width={L + ex + 20} height={S * 0.5 + ey + 10} fill={url('lomb')} />
        <rect x={-10} y={S * 0.5} width={L + ex + 20} height={S * 0.5 + ey + 10} fill={url('lombL')} />
        <path d={`M${L - r} ${-5}L${L + ex + 20} ${-5}L${L + ex + 20} ${S + ey + 10}L${L + ex} ${S + ey}L${L} ${S}Z`} fill={url('ponta')} />
        <path d={`M${L - r} ${-5}L${L + ex + 20} ${-5}L${L + ex + 20} ${S + ey + 10}L${L + ex} ${S + ey}L${L} ${S}Z`} fill={url('pontaS')} />
        <path d={`M${L - r} ${-5}L${L + ex + 20} ${-5}L${L + ex + 20} ${S + ey + 10}L${L + ex} ${S + ey}L${L} ${S}Z`} fill="#000" fillOpacity={(1 - luzPonta) * 0.35} />
        {/* fios das folhas no maço */}
        {[0.3, 0.42, 0.54, 0.66].map((t) => (
          <line key={t} x1={L + ex * t} y1={ey * t + 2} x2={L + ex * t} y2={S + ey * t - 2} stroke="#000" strokeOpacity={0.12} strokeWidth={0.4} />
        ))}
      </g>
      {/* fio de luz (rim) na borda de trás da lombada */}
      <path d={`M${r + ex} ${S + ey - 0.4}H${L - r + ex}`} stroke={cores.lombadaLuz} strokeOpacity={0.9} strokeWidth={0.9} strokeLinecap="round" />

      {/* capa */}
      <g clipPath={url('frente')}>
        {capa}
        {/* aba dobrada por cima da capa */}
        <rect x={-2} y={A} width={L + 4} height={8} fill={url('sombraAba')} />
        <g>{aba}</g>
        <rect x={-2} y={-2} width={L + 4} height={A + 2} fill={url('vinco')} />
        {/* corte da aba pegando luz */}
        <path d={`M0 ${A - 0.5}H${L}`} stroke="#fff" strokeOpacity={0.22} strokeWidth={0.8} />
        {/* luz e volume */}
        <rect x={-2} y={-2} width={L + 4} height={S + 4} fill={url('luz')} />
        <rect x={-2} y={-2} width={L + 4} height={S + 4} fill={url('bojo')} />
        <rect x={-2} y={-2} width={L + 4} height={S + 4} fill={url('reflexo')} />
      </g>
      {/* arestas: abertura e ponta pegando luz; borda de baixo escurecendo */}
      <path d={`M${L - r} 0.4H${r}`} stroke="#fff" strokeOpacity={0.3} strokeWidth={0.8} strokeLinecap="round" />
      {lx > 0 ? (
        <path d={`M${L - 0.4} ${r}V${S - r}`} stroke="#fff" strokeOpacity={0.35} strokeWidth={0.8} strokeLinecap="round" />
      ) : (
        <path d={`M0.4 ${r}V${S - r}`} stroke="#fff" strokeOpacity={0.3} strokeWidth={0.8} strokeLinecap="round" />
      )}
    </g>
  )
}
