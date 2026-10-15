// Bandeja RAW pequena (18 × 12 cm) — bandeja de metal estampada, vista de cima e inclinada, com o eixo comprido subindo
// para a direita (como os livretos do grupo "papel"). Geometria 3D de verdade (vista3d): fundo de cantos redondos,
// paredes que abrem para fora (cada faixa sombreada pela própria normal), aro enrolado com fio de luz metálico.
// Estampa kraft da RAW no fundo, projetada em perspectiva: "RAW" grande escuro com falhas de impressão, moldura dupla e
// as linhas "NATURAL UNREFINED" / "ROLLING TRAY".
import type { PropsArte } from './comum'
import { PALAVRAS } from './acessorios-glifos'
import { deformar, mistura, normais, palavra, poli, prng, r1, retRedondo, vista3d, type P3, type Pt } from './acessorios-base'

// medidas em mm
const FW = 172
const FD = 112
const FR = 10
const HW = 11 // altura da parede
const ABRE = 6 // quanto a parede abre para fora até o aro
const ARO = 3.2 // largura do aro enrolado
const N = 9 // pontos por canto

const GIRO = 57
const ELEV = 63
const DIST = 620

// 1) vista provisória para enquadrar; 2) vista final com escala e centro calculados
const contornoAro = retRedondo(FW + 2 * (ABRE + ARO), FD + 2 * (ABRE + ARO), FR + ABRE + ARO, N)
const V = (() => {
  const v0 = vista3d({ giro: GIRO, elev: ELEV, dist: DIST, escala: 1, cx: 0, cy: 0 })
  const pts = contornoAro.map(([x, y]) => v0.proj([x, y, HW - 1]))
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const w = Math.max(...xs) - Math.min(...xs)
  const h = Math.max(...ys) - Math.min(...ys)
  const s = Math.min(326 / w, 470 / h)
  return vista3d({
    giro: GIRO,
    elev: ELEV,
    dist: DIST,
    escala: s,
    cx: 180 - (s * (Math.max(...xs) + Math.min(...xs))) / 2,
    cy: 326 - (s * (Math.max(...ys) + Math.min(...ys))) / 2,
  })
})()
const P = (x: number, y: number, z: number) => V.proj([x, y, z])

const fundoC = retRedondo(FW, FD, FR, N)
const aroInC = retRedondo(FW + 2 * ABRE, FD + 2 * ABRE, FR + ABRE, N)
const aroOutC = contornoAro
const NOR = normais(fundoC)

// luz (direção para a luz, em coordenadas de câmera: x direita, y para baixo, profundidade para longe)
const LUZ: P3 = (() => {
  const v: P3 = [-0.5, -0.72, -0.48]
  const l = Math.hypot(...v)
  return [v[0] / l, v[1] / l, v[2] / l]
})()
const dir = (n: P3) => {
  const a = V.cam(n)
  const o = V.cam([0, 0, 0])
  return [a[0] - o[0], a[1] - o[1], a[2] - o[2]] as P3
}
const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const KRAFT = '#c49a6c'
const KRAFT_ESC = '#5c3a1c'
const KRAFT_CLARO = '#e2c095'

// Paredes internas: uma faixa por segmento do contorno, só as que olham para a câmera
const BETA = Math.atan2(ABRE, HW)
const PAREDES = (() => {
  const faixas: { d: string; cor: string }[] = []
  const n = fundoC.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const nx = (NOR[i][0] + NOR[j][0]) / 2
    const ny = (NOR[i][1] + NOR[j][1]) / 2
    const nin: P3 = [-nx * Math.cos(BETA), -ny * Math.cos(BETA), Math.sin(BETA)]
    if (dot(nin, V.olho) <= 0.0) continue
    const nc = dir(nin)
    const b = Math.max(0, dot(nc, LUZ))
    const t = Math.min(1, 0.18 + 0.95 * b)
    const cor = mistura(KRAFT_ESC, KRAFT_CLARO, t)
    const pts: Pt[] = [P(fundoC[i][0], fundoC[i][1], 0), P(fundoC[j][0], fundoC[j][1], 0), P(aroInC[j][0], aroInC[j][1], HW), P(aroInC[i][0], aroInC[i][1], HW)]
    faixas.push({ d: poli(pts), cor })
  }
  return faixas
})()

// Aro enrolado: faixas entre a borda interna (z = HW) e a externa (um pouco mais baixa)
const ARO_FAIXAS = (() => {
  const faixas: { d: string; cor: string; brilho: number; dEdge: string }[] = []
  const n = aroInC.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const nx = (NOR[i][0] + NOR[j][0]) / 2
    const ny = (NOR[i][1] + NOR[j][1]) / 2
    const nup: P3 = [nx * 0.55, ny * 0.55, 0.83]
    const nc = dir(nup)
    const b = Math.max(0, dot(nc, LUZ))
    // especular simples (meio-vetor entre luz e olho)
    const hv: P3 = [LUZ[0], LUZ[1], LUZ[2] - 1]
    const hl = Math.hypot(...hv)
    const sp = Math.pow(Math.max(0, dot(nc, [hv[0] / hl, hv[1] / hl, hv[2] / hl])), 14)
    const cor = mistura('#6e4a26', '#ead0a8', Math.min(1, 0.2 + 0.85 * b))
    const a = P(aroInC[i][0], aroInC[i][1], HW)
    const b2 = P(aroInC[j][0], aroInC[j][1], HW)
    const c = P(aroOutC[j][0], aroOutC[j][1], HW - 1.2)
    const d = P(aroOutC[i][0], aroOutC[i][1], HW - 1.2)
    faixas.push({ d: poli([a, b2, c, d]), cor, brilho: sp, dEdge: `M${r1(d[0])} ${r1(d[1])}L${r1(c[0])} ${r1(c[1])}` })
  }
  return faixas
})()

const FUNDO_D = poli(fundoC.map(([x, y]) => P(x, y, 0)))
const ARO_OUT_D = poli(aroOutC.map(([x, y]) => P(x, y, HW - 1.2)))
const ARO_IN_D = poli(aroInC.map(([x, y]) => P(x, y, HW)))

// Estampa no plano do fundo: a para a direita (eixo comprido), b para baixo na arte (= -y, para a frente)
const noFundo = (a: number, b: number): Pt => P(a, -b, 0)
const moldura = (ins: number) => deformar(poli(retRedondo(FW - 2 * ins, FD - 2 * ins, Math.max(2, FR - ins + 3), 6)), noFundo, 4)
const MOLD1 = moldura(7)
const MOLD2 = moldura(10)
const RAW = palavra(PALAVRAS.raw, { u: 0, v: 3, h: 31, sx: 1, ancora: 'meio', meioV: true }, noFundo, 3)
const NATURAL = palavra(PALAVRAS.natural, { u: 0, v: -27, h: 6.2, ancora: 'meio' }, noFundo, 3)
const ROLLING = palavra(PALAVRAS.rolling, { u: 0, v: 33, h: 6.2, ancora: 'meio' }, noFundo, 3)
// filete entre as linhas de texto e o logo
const FILETES = [
  deformar(`M-46 -21L46 -21`, noFundo, 4),
  deformar(`M-40 23L40 23`, noFundo, 4),
]

// Falhas de impressão no "RAW" (pintinhas claras, recortadas pelo próprio contorno)
const FALHAS = (() => {
  const rnd = prng(77)
  let d = ''
  for (let i = 0; i < 260; i++) {
    const a = (rnd() - 0.5) * 140
    const b = (rnd() - 0.5) * 40 + 3
    const r = 0.25 + rnd() * rnd() * 1.6
    const [x, y] = noFundo(a, b)
    const [x2] = noFundo(a + r, b)
    const rr = Math.max(0.35, Math.abs(x2 - x))
    d += `M${r1(x - rr)} ${r1(y)}a${r1(rr)} ${r1(rr * 0.8)} 0 1 0 ${r1(rr * 2)} 0a${r1(rr)} ${r1(rr * 0.8)} 0 1 0 ${r1(-rr * 2)} 0`
  }
  return d
})()

// Fibras do kraft (ladrilho 30×30, na tela)
const FIBRAS = (() => {
  const rnd = prng(12)
  let esc = ''
  let cla = ''
  for (let i = 0; i < 34; i++) {
    const x = rnd() * 30
    const y = rnd() * 30
    const a = rnd() * Math.PI
    const l = 1 + rnd() * 3.5
    const s = `M${r1(x)} ${r1(y)}l${r1(Math.cos(a) * l)} ${r1(Math.sin(a) * l)}`
    if (rnd() < 0.55) esc += s
    else cla += s
  }
  return { esc, cla }
})()

// Limites do fundo na tela (para gradientes)
const FB = (() => {
  const pts = fundoC.map(([x, y]) => P(x, y, 0))
  return { x1: Math.min(...pts.map((p) => p[0])), x2: Math.max(...pts.map((p) => p[0])), y1: Math.min(...pts.map((p) => p[1])), y2: Math.max(...pts.map((p) => p[1])) }
})()

export function Bandeja({ id }: PropsArte) {
  const u = (s: string) => `${id}-${s}`
  return (
    <g>
      <defs>
        <linearGradient id={u('fundo')} gradientUnits="userSpaceOnUse" x1={FB.x1} y1={FB.y1} x2={FB.x2} y2={FB.y2}>
          <stop offset="0" stopColor="#d3ab7c" />
          <stop offset="0.5" stopColor={KRAFT} />
          <stop offset="1" stopColor="#a87c50" />
        </linearGradient>
        {/* verniz da estampa: faixa larga e macia de brilho atravessando na diagonal */}
        <linearGradient id={u('verniz')} gradientUnits="userSpaceOnUse" x1={FB.x1} y1={FB.y2} x2={FB.x2} y2={FB.y1}>
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.36" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.46" stopColor="#fff" stopOpacity="0.13" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.2" />
          <stop offset="0.56" stopColor="#fff" stopOpacity="0.07" />
          <stop offset="0.7" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={u('cf')}>
          <path d={FUNDO_D} />
        </clipPath>
        <clipPath id={u('craw')}>
          <path d={RAW} />
        </clipPath>
        <pattern id={u('fibra')} width="30" height="30" patternUnits="userSpaceOnUse">
          <path d={FIBRAS.esc} stroke="#5a3818" strokeWidth="0.7" opacity="0.22" strokeLinecap="round" />
          <path d={FIBRAS.cla} stroke="#f6e2c2" strokeWidth="0.7" opacity="0.25" strokeLinecap="round" />
        </pattern>
      </defs>

      {/* aro por baixo (silhueta escura que segura o recorte no preto) */}
      <path d={ARO_OUT_D} fill="#3b2612" />

      {/* paredes internas */}
      {PAREDES.map((f, i) => (
        <path key={i} d={f.d} fill={f.cor} stroke={f.cor} strokeWidth="0.6" strokeLinejoin="round" />
      ))}

      {/* fundo estampado */}
      <path d={FUNDO_D} fill={`url(#${u('fundo')})`} />
      <g clipPath={`url(#${u('cf')})`}>
        <path d={FUNDO_D} fill={`url(#${u('fibra')})`} />
        <path d={MOLD1} fill="none" stroke="#3a2212" strokeWidth="1.5" opacity="0.85" />
        <path d={MOLD2} fill="none" stroke="#3a2212" strokeWidth="0.7" opacity="0.7" />
        <path d={NATURAL} fill="#3a2212" opacity="0.9" />
        <path d={ROLLING} fill="#3a2212" opacity="0.9" />
        {FILETES.map((d, i) => (
          <path key={i} d={d} stroke="#3a2212" strokeWidth="0.8" opacity="0.7" />
        ))}
        <path d={RAW} fill="#352010" />
        <g clipPath={`url(#${u('craw')})`}>
          <path d={FALHAS} fill="#c9a274" opacity="0.85" />
        </g>
        {/* sombra que a parede da esquerda/de trás faz no fundo + oclusão nas bordas */}
        <path d={FUNDO_D} fill="none" stroke="#2a1708" strokeWidth="10" opacity="0.25" />
        <path d={FUNDO_D} fill="none" stroke="#2a1708" strokeWidth="4" opacity="0.25" />
        <path d={FUNDO_D} fill={`url(#${u('verniz')})`} />
      </g>

      {/* aro enrolado */}
      {ARO_FAIXAS.map((f, i) => (
        <path key={i} d={f.d} fill={f.cor} stroke={f.cor} strokeWidth="0.6" strokeLinejoin="round" />
      ))}
      {ARO_FAIXAS.map((f, i) =>
        f.brilho > 0.04 ? <path key={'b' + i} d={f.dEdge} stroke="#fff6e8" strokeWidth="1.3" opacity={Math.min(0.95, f.brilho * 1.3)} strokeLinecap="round" /> : null,
      )}
      <path d={ARO_IN_D} fill="none" stroke="#3a2412" strokeWidth="0.9" opacity="0.55" />
    </g>
  )
}
