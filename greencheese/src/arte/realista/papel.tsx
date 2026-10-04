// Ilustrações realistas — grupo "papel". Cada entrada: id do produto (catalogo.json) → componente (ver comum.tsx).
// Livretos de seda e bloco de piteiras em papelão com espessura, aba dobrada e seda translúcida saindo pela abertura.
// A base (geometria, luz, texturas) está em papel-livreto.tsx; as marcas em caminho estão em papel-glifos.tsx.
import type { Arte, PropsArte } from './comum'
import { PALAVRAS as P } from './papel-glifos'
import { largura, Livreto, MascaraFalhas, PadraoFibras, Txt, type FormaLivreto } from './papel-livreto'

/** Pose comum das sedas king size slim (110 × 44 mm): em pé, inclinadas, o texto subindo para a direita. */
const SEDA: FormaLivreto = { L: 430, S: 172, r: 6, esp: [4, 13], ang: -73, cx: 175, cy: 324, aba: 46 }

/**
 * Folhas saindo pela abertura (seda intercalada: cada folha puxa a seguinte). A de trás sai mais perto do topo,
 * a da frente corre quase o livreto todo; onde as duas se sobrepõem o papel fica mais claro (translucidez).
 */
const FOLHAS_SEDA = [
  { x0: 150, x1: SEDA.L - 14, h0: 6, h1: 19, onda: 1.6 },
  { x0: 16, x1: SEDA.L - 60, h0: 9, h1: 12, onda: 2.2 },
]

/* ------------------------------------------------------------------ OCB Premium Slim */

function OcbPremiumSlim({ id }: PropsArte) {
  const u = (s: string) => `${id}-${s}`
  const { L, S, aba: A } = SEDA
  const BR = '#f3f2ee'
  const hOcb = 76
  const xOcb = 24
  const wOcb = largura(P.ocb, hOcb, 1.04)
  const xCol = xOcb + wOcb + 22
  const wCol = L - xCol - 22
  const meio = A + (S - A) / 2
  return (
    <g>
      <defs>
        <PadraoFibras id={u('fib')} escura="#000" clara="#7d828a" forca={0.22} finas />
        <linearGradient id={u('tinta')} x1={0} y1={0} x2={0} y2={1}>
          <stop offset={0} stopColor="#ffffff" />
          <stop offset={1} stopColor="#dcdcd8" />
        </linearGradient>
      </defs>
      <Livreto
        id={id}
        forma={SEDA}
        fosco={0.3}
        brilho={1.6}
        corFolha={['#fdfdfb', '#f1f1ee', '#d7d7d2']}
        cores={{ capa: '#101011', lombada: '#060606', lombadaLuz: '#8d939c', corte: '#1d1d1f', folhas: '#e4e2dc' }}
        folhas={FOLHAS_SEDA}
        capa={
          <>
            <rect x={-2} y={-2} width={L + 4} height={S + 4} fill="#101011" />
            <rect x={-2} y={-2} width={L + 4} height={S + 4} fill={`url(#${u('fib')})`} />
            {/* filetes */}
            <path d={`M16 ${A + 10}H${L - 16}M16 ${S - 11}H${L - 16}`} stroke={BR} strokeOpacity={0.75} strokeWidth={1} />
            <path d={`M16 ${A + 13.5}H${L - 16}M16 ${S - 14.5}H${L - 16}`} stroke={BR} strokeOpacity={0.35} strokeWidth={0.5} />
            {/* marca */}
            <Txt p={P.ocb} x={xOcb} y={meio + hOcb / 2} h={hOcb} sx={1.04} fill={`url(#${u('tinta')})`} />
            {/* filete vertical e coluna PREMIUM / SLIM */}
            <path d={`M${xCol - 11} ${A + 24}V${S - 25}`} stroke={BR} strokeOpacity={0.6} strokeWidth={0.8} />
            <Txt p={P.ocbPremium} x={xCol + wCol / 2} y={A + 40} w={wCol} ancora="meio" fill={BR} />
            <Txt p={P.ocbSlim} x={xCol + wCol / 2} y={A + 84} w={wCol * 0.9} ancora="meio" fill={BR} />
            <Txt p={P.ocbKing} x={xCol + wCol / 2} y={A + 102} h={8} ancora="meio" fill={BR} opacity={0.85} />
          </>
        }
        aba={
          <>
            <rect x={-2} y={-2} width={L + 4} height={A + 2} fill="#111112" />
            <rect x={-2} y={-2} width={L + 4} height={A + 2} fill={`url(#${u('fib')})`} />
            <Txt p={P.ocbFolhas} x={L / 2} y={A / 2 + 3.5} h={7} ancora="meio" fill={BR} opacity={0.8} />
            <path d={`M16 ${A - 9}H${L - 16}`} stroke={BR} strokeOpacity={0.35} strokeWidth={0.6} />
          </>
        }
      />
    </g>
  )
}

/* ------------------------------------------------------------------ RAW Classic King Size Slim */

function RawClassic({ id }: PropsArte) {
  const u = (s: string) => `${id}-${s}`
  const { L, S, aba: A } = SEDA
  const TINTA = '#3b2210'
  const hRaw = 66
  const xRaw = 28
  const wRaw = largura(P.raw, hRaw)
  const xCol = xRaw + wRaw + 18
  const wCol = L - xCol - 24
  return (
    <g>
      <defs>
        <PadraoFibras id={u('fib')} escura="#5b3a1b" clara="#f7e4c2" forca={1.1} />
        <radialGradient id={u('manchas')} gradientUnits="userSpaceOnUse" cx={L * 0.62} cy={S * 0.45} r={L * 0.55}>
          <stop offset={0} stopColor="#e2b98a" stopOpacity={0.5} />
          <stop offset={0.6} stopColor="#c99a66" stopOpacity={0} />
          <stop offset={1} stopColor="#8a5f36" stopOpacity={0.35} />
        </radialGradient>
        <MascaraFalhas id={u('falhas')} x={-5} y={-5} w={L + 10} h={S + 10} forca={0.7} />
      </defs>
      <Livreto
        id={id}
        forma={SEDA}
        brilho={0.55}
        corFolha={['#f3e6cf', '#e6d4b4', '#c9b08a']}
        cores={{ capa: '#c39261', lombada: '#7d5530', lombadaLuz: '#f2d5a6', corte: '#a87b4d', folhas: '#e9d9bb' }}
        folhas={FOLHAS_SEDA}
        capa={
          <>
            <rect x={-2} y={-2} width={L + 4} height={S + 4} fill="#c49463" />
            <rect x={-2} y={-2} width={L + 4} height={S + 4} fill={`url(#${u('manchas')})`} />
            <rect x={-2} y={-2} width={L + 4} height={S + 4} fill={`url(#${u('fib')})`} />
            <g mask={`url(#${u('falhas')})`}>
              {/* moldura dupla */}
              <rect x={12} y={A + 8} width={L - 24} height={S - A - 18} rx={3} fill="none" stroke={TINTA} strokeWidth={1.8} />
              <rect x={16.5} y={A + 12.5} width={L - 33} height={S - A - 27} rx={1.5} fill="none" stroke={TINTA} strokeWidth={0.7} />
              <Txt p={P.raw} x={xRaw} y={S - 32} h={hRaw} fill={TINTA} />
              <Txt p={P.rawNatural} x={xRaw + wRaw / 2} y={S - 20} h={6.8} ancora="meio" fill={TINTA} />
              <path d={`M${xCol - 9} ${A + 22}V${S - 22}`} stroke={TINTA} strokeWidth={0.8} />
              <Txt p={P.rawClassic} x={xCol + wCol / 2} y={A + 48} w={wCol} ancora="meio" fill={TINTA} />
              <path d={`M${xCol + 6} ${A + 58}H${xCol + wCol - 6}`} stroke={TINTA} strokeWidth={0.7} />
              <Txt p={P.rawKing} x={xCol + wCol / 2} y={A + 76} w={wCol} ancora="meio" fill={TINTA} />
            </g>
          </>
        }
        aba={
          <>
            <rect x={-2} y={-2} width={L + 4} height={A + 2} fill="#c69767" />
            <rect x={-2} y={-2} width={L + 4} height={A + 2} fill={`url(#${u('manchas')})`} />
            <rect x={-2} y={-2} width={L + 4} height={A + 2} fill={`url(#${u('fib')})`} />
            <g mask={`url(#${u('falhas')})`}>
              <Txt p={P.raw} x={L / 2} y={A / 2 + 8} h={16} ancora="meio" fill={TINTA} opacity={0.9} />
              <path d={`M18 ${A / 2}H${L / 2 - 48}M${L / 2 + 48} ${A / 2}H${L - 18}`} stroke={TINTA} strokeWidth={0.8} />
            </g>
          </>
        }
      />
    </g>
  )
}

/* ------------------------------------------------------------------ Smoking Brown */

function SmokingBrown({ id }: PropsArte) {
  const u = (s: string) => `${id}-${s}`
  const { L, S, aba: A } = SEDA
  const CREME = '#f4e8d4'
  const wSm = 262
  const xSm = 26
  const xCol = xSm + wSm + 20
  const wCol = L - xCol - 22
  return (
    <g>
      <defs>
        <PadraoFibras id={u('fib')} escura="#24140a" clara="#c99a6d" forca={0.75} finas />
        <radialGradient id={u('manchas')} gradientUnits="userSpaceOnUse" cx={L * 0.6} cy={S * 0.4} r={L * 0.5}>
          <stop offset={0} stopColor="#8a5b36" stopOpacity={0.45} />
          <stop offset={1} stopColor="#3a2312" stopOpacity={0.3} />
        </radialGradient>
      </defs>
      <Livreto
        id={id}
        forma={SEDA}
        brilho={0.8}
        corFolha={['#e2c49d', '#d2b08a', '#a98458']}
        cores={{ capa: '#6a4326', lombada: '#2f1c0e', lombadaLuz: '#d8b088', corte: '#4b2e19', folhas: '#cfae86' }}
        folhas={FOLHAS_SEDA}
        capa={
          <>
            <rect x={-2} y={-2} width={L + 4} height={S + 4} fill="#6b4427" />
            <rect x={-2} y={-2} width={L + 4} height={S + 4} fill={`url(#${u('manchas')})`} />
            <rect x={-2} y={-2} width={L + 4} height={S + 4} fill={`url(#${u('fib')})`} />
            <Txt p={P.smoking} x={xSm} y={A + 82} w={wSm} fill={CREME} />
            <path d={`M${xCol - 10} ${A + 22}V${S - 22}`} stroke={CREME} strokeOpacity={0.55} strokeWidth={0.8} />
            <Txt p={P.smokingBrown} x={xCol + wCol / 2} y={A + 58} w={wCol} ancora="meio" fill={CREME} />
            <Txt p={P.smokingKing} x={xCol + wCol / 2} y={A + 80} h={9} ancora="meio" fill={CREME} opacity={0.85} />
            <path d={`M14 ${S - 12}H${L - 14}`} stroke={CREME} strokeOpacity={0.5} strokeWidth={0.8} />
          </>
        }
        aba={
          <>
            <rect x={-2} y={-2} width={L + 4} height={A + 2} fill="#6d4628" />
            <rect x={-2} y={-2} width={L + 4} height={A + 2} fill={`url(#${u('manchas')})`} />
            <rect x={-2} y={-2} width={L + 4} height={A + 2} fill={`url(#${u('fib')})`} />
            <Txt p={P.smokingUnbleached} x={L / 2} y={A / 2 + 3.5} h={7} ancora="meio" fill={CREME} opacity={0.8} />
          </>
        }
      />
    </g>
  )
}

/* ------------------------------------------------------------------ Piteira de papel RAW (bloco de tips) */

const TIPS: FormaLivreto = { L: 290, S: 160, r: 7, esp: [5, 13], ang: -12, cx: 178, cy: 310, aba: 42 }

/**
 * Piteira saindo do bloco: retângulo de cartão fino sem branqueamento (≈ 50 × 20 mm, o lado longo deitado no bloco),
 * com os vincos perfurados do "W" numa ponta. A parte de baixo fica escondida dentro do bloco.
 */
function Tira({ u, x, y, w, h, giro, frente }: { u: (s: string) => string; x: number; y: number; w: number; h: number; giro: number; frente?: boolean }) {
  const TINTA = '#6f4c2c'
  const x0 = -w / 2
  return (
    <g transform={`translate(${x} ${y}) rotate(${giro})`}>
      {/* espessura do cartão (borda direita e de cima, no escuro) */}
      <rect x={x0 + 1.4} y={-h + 1.1} width={w} height={h + 40} rx={1.6} fill="#8a6b47" />
      <rect x={x0} y={-h} width={w} height={h + 40} rx={1.6} fill="#e8d0a5" />
      <rect x={x0} y={-h} width={w} height={h + 40} rx={1.6} fill={`url(#${u('fibT')})`} />
      <rect x={x0} y={-h} width={w} height={h + 40} rx={1.6} fill={`url(#${u('tiraLuz')})`} />
      {/* vincos perfurados do W, numa ponta */}
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <path key={k} d={`M${x0 + 10 + k * 7.2} ${-h + 3}V${36}`} stroke={TINTA} strokeOpacity={0.5} strokeWidth={0.75} strokeDasharray="2.2 1.6" />
      ))}
      {/* sombra que a piteira da frente faz na de trás / penumbra da abertura */}
      <rect x={x0} y={-8} width={w} height={10} fill={`url(#${u('tiraFundo')})`} />
      {/* arestas pegando luz */}
      <path d={`M${x0 + 0.5} ${36}V${-h + 1.6}Q${x0 + 0.5} ${-h + 0.5} ${x0 + 1.6} ${-h + 0.5}H${-x0 - 1.6}`} stroke="#fff" strokeOpacity={frente ? 0.7 : 0.45} strokeWidth={0.8} fill="none" />
    </g>
  )
}

/** Piteira já enrolada: cilindro de cartão com a ponta mostrando a espiral e o "W". */
function PiteiraEnrolada({ u, x, y, comp, raio, giro }: { u: (s: string) => string; x: number; y: number; comp: number; raio: number; giro: number }) {
  const R = raio
  const rx = R * 0.36
  const xe = comp / 2
  const corpo = `M${-xe} ${-R}H${xe}V${R}H${-xe}A${rx} ${R} 0 0 1 ${-xe} ${-R}Z`
  // espiral do cartão enrolado (2,4 voltas, de fora para dentro)
  let esp = ''
  const voltas = 2.4
  for (let k = 0; k <= 72; k++) {
    const t = (k / 72) * voltas * Math.PI * 2
    const rho = 0.86 - (0.5 * t) / (voltas * Math.PI * 2)
    const px = xe + rx * rho * Math.cos(t + 2.2)
    const py = R * rho * Math.sin(t + 2.2)
    esp += `${k ? 'L' : 'M'}${Math.round(px * 10) / 10} ${Math.round(py * 10) / 10}`
  }
  const zz = [
    [-0.22, -0.34],
    [0.2, -0.17],
    [-0.22, 0],
    [0.2, 0.17],
    [-0.22, 0.34],
  ]
    .map(([a, b], i) => `${i ? 'L' : 'M'}${Math.round((xe + rx * a) * 10) / 10} ${Math.round(R * b * 10) / 10}`)
    .join('')
  return (
    <g transform={`translate(${x} ${y}) rotate(${giro})`}>
      <path d={corpo} fill={`url(#${u('rolo')})`} />
      <path d={corpo} fill={`url(#${u('fibT')})`} />
      {/* fim da tira enrolada (emenda ao longo do comprimento) */}
      <path d={`M${-xe + 3} ${-R * 0.42}H${xe - 1}`} stroke="#7b5a37" strokeOpacity={0.55} strokeWidth={0.9} />
      <path d={`M${-xe + 3} ${-R * 0.42 + 1.1}H${xe - 1}`} stroke="#fff6e4" strokeOpacity={0.5} strokeWidth={0.7} />
      {/* boca: borda do cartão, vãos escuros, espiral e o W */}
      <ellipse cx={xe} cy={0} rx={rx} ry={R} fill="#e3c99e" />
      <ellipse cx={xe} cy={0} rx={rx * 0.9} ry={R * 0.9} fill="#2a1d12" />
      <path d={esp} fill="none" stroke="#e8d1a8" strokeWidth={1.3} strokeLinejoin="round" />
      <path d={zz} fill="none" stroke="#f0dcb6" strokeWidth={1.3} strokeLinejoin="round" />
      <ellipse cx={xe} cy={0} rx={rx} ry={R} fill="none" stroke="#fff" strokeOpacity={0.35} strokeWidth={0.7} />
    </g>
  )
}

function PiteiraPapelRaw({ id }: PropsArte) {
  const u = (s: string) => `${id}-${s}`
  const { L, S, aba: A } = TIPS
  const TINTA = '#3b2210'
  const hRaw = 62
  const hTips = 22
  const wTips = largura(P.rawTips, hTips)
  return (
    <g>
      <defs>
        <PadraoFibras id={u('fib')} escura="#5b3a1b" clara="#f7e4c2" forca={1.1} />
        <PadraoFibras id={u('fibT')} escura="#6b4a2a" clara="#fff3dc" forca={0.6} finas />
        <linearGradient id={u('tiraLuz')} x1={0} y1={0} x2={1} y2={0.35}>
          <stop offset={0} stopColor="#fff" stopOpacity={0.22} />
          <stop offset={0.3} stopColor="#fff" stopOpacity={0.06} />
          <stop offset={0.75} stopColor="#000" stopOpacity={0.06} />
          <stop offset={1} stopColor="#000" stopOpacity={0.26} />
        </linearGradient>
        <linearGradient id={u('tiraFundo')} x1={0} y1={0} x2={0} y2={1}>
          <stop offset={0} stopColor="#000" stopOpacity={0} />
          <stop offset={1} stopColor="#000" stopOpacity={0.4} />
        </linearGradient>
        <linearGradient id={u('rolo')} x1={0} y1={0} x2={0} y2={1}>
          <stop offset={0} stopColor="#7a5a38" />
          <stop offset={0.1} stopColor="#d4b88c" />
          <stop offset={0.26} stopColor="#f8e9cb" />
          <stop offset={0.4} stopColor="#e9d2aa" />
          <stop offset={0.72} stopColor="#b6935f" />
          <stop offset={0.9} stopColor="#8f6e46" />
          <stop offset={1} stopColor="#5e4529" />
        </linearGradient>
        <radialGradient id={u('manchas')} gradientUnits="userSpaceOnUse" cx={L * 0.4} cy={S * 0.45} r={L * 0.6}>
          <stop offset={0} stopColor="#e6c296" stopOpacity={0.5} />
          <stop offset={0.6} stopColor="#c99a66" stopOpacity={0} />
          <stop offset={1} stopColor="#8a5f36" stopOpacity={0.35} />
        </radialGradient>
        <MascaraFalhas id={u('falhas')} x={-5} y={-5} w={L + 10} h={S + 10} forca={0.7} />
      </defs>
      <Livreto
        id={id}
        forma={TIPS}
        brilho={0.5}
        cores={{ capa: '#c39261', lombada: '#6f4a28', lombadaLuz: '#b48a5c', corte: '#a87b4d', folhas: '#e6cfa6' }}
        extraAtras={
          <>
            <Tira u={u} x={L * 0.6} y={4} w={200} h={22} giro={1.5} />
            <Tira u={u} x={L * 0.55} y={4} w={204} h={52} giro={4} />
            <Tira u={u} x={L * 0.46} y={4} w={206} h={88} giro={-3} frente />
          </>
        }
        capa={
          <>
            <rect x={-2} y={-2} width={L + 4} height={S + 4} fill="#c49463" />
            <rect x={-2} y={-2} width={L + 4} height={S + 4} fill={`url(#${u('manchas')})`} />
            <rect x={-2} y={-2} width={L + 4} height={S + 4} fill={`url(#${u('fib')})`} />
            <g mask={`url(#${u('falhas')})`}>
              <rect x={11} y={A + 8} width={L - 22} height={S - A - 18} rx={3} fill="none" stroke={TINTA} strokeWidth={1.6} />
              <Txt p={P.raw} x={L / 2} y={A + 16 + hRaw} h={hRaw} ancora="meio" fill={TINTA} />
              {/* faixa TIPS */}
              <rect x={L / 2 - wTips / 2 - 16} y={A + 84} width={wTips + 32} height={hTips + 10} rx={2} fill={TINTA} />
              <Txt p={P.rawTips} x={L / 2} y={A + 89 + hTips} h={hTips} ancora="meio" fill="#d9ad7a" />
            </g>
          </>
        }
        aba={
          <>
            <rect x={-2} y={-2} width={L + 4} height={A + 2} fill="#c69767" />
            <rect x={-2} y={-2} width={L + 4} height={A + 2} fill={`url(#${u('manchas')})`} />
            <rect x={-2} y={-2} width={L + 4} height={A + 2} fill={`url(#${u('fib')})`} />
            <g mask={`url(#${u('falhas')})`}>
              <Txt p={P.rawTipsNatural} x={L / 2} y={A / 2 + 4} h={9} ancora="meio" fill={TINTA} />
            </g>
          </>
        }
      />
      <PiteiraEnrolada u={u} x={186} y={486} comp={182} raio={20} giro={-20} />
    </g>
  )
}

export const artes: Record<string, Arte> = {
  'seda-ocb-premium-slim': OcbPremiumSlim,
  'seda-raw-classic-king-size': RawClassic,
  'seda-smoking-brown': SmokingBrown,
  'piteira-de-papel-raw': PiteiraPapelRaw,
}
