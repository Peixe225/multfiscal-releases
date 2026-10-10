// Isqueiro Clipper — corpo de plástico vermelho-laranja brilhante (seção oval, cantos de baixo bem redondos), cabeça de
// metal cromado com as "orelhas" da capa, a roda de faísca serrilhada entre elas e a alavanca de gás na frente.
// "Clipper" em branco, de pé ao longo do corpo (lendo de baixo para cima), acompanhando a curva do plástico.
import type { PropsArte } from './comum'
import { PALAVRAS } from './acessorios-glifos'
import { palavra, r1 } from './acessorios-base'

const CX = 180
const W = 150 // largura do corpo
const XL = CX - W / 2
const XR = CX + W / 2
const CORPO_T = 196 // topo do corpo (sob o colar)
const CORPO_B = 574 // base
const RB = 40 // raio dos cantos de baixo
const COLAR_T = 172
const COLAR_B = 198

const CORPO =
  `M${XL} ${CORPO_T + 6}Q${XL} ${CORPO_T} ${XL + 6} ${CORPO_T}L${XR - 6} ${CORPO_T}Q${XR} ${CORPO_T} ${XR} ${CORPO_T + 6}` +
  `L${XR} ${CORPO_B - RB}C${XR} ${CORPO_B - RB * 0.45} ${XR - RB * 0.45} ${CORPO_B} ${XR - RB} ${CORPO_B}` +
  `L${XL + RB} ${CORPO_B}C${XL + RB * 0.45} ${CORPO_B} ${XL} ${CORPO_B - RB * 0.45} ${XL} ${CORPO_B - RB}Z`

// "Clipper" de pé: u (ao longo da palavra) vira -y na tela; v (altura da letra) vira +x, enrolado na seção oval.
const RW = W / 2 + 14
const TXT_Y = 548 // começo da palavra (embaixo)
const CLIPPER = palavra(PALAVRAS.clipper, { u: 0, v: 0, h: 66, ancora: 'inicio', meioV: true }, (u, v) => [
  CX + 4 + RW * Math.sin(v / RW),
  TXT_Y - u,
])

// Serrilha da roda: riscos verticais que se adensam nas bordas (é um cilindro deitado visto de frente)
const RODA = { x1: CX - 38, x2: CX + 38, y1: 100, y2: 140 }
const SERRILHA = (() => {
  let d = ''
  const n = 30
  for (let i = 0; i <= n; i++) {
    const a = Math.PI - (i / n) * Math.PI
    // eixo da roda é horizontal: a serrilha corre na vertical, espaçamento uniforme em x, mas cada risco
    // é curto em cima e embaixo (curvatura) — simplificado em riscos retos
    const x = RODA.x1 + ((RODA.x2 - RODA.x1) * i) / n
    void a
    d += `M${r1(x)} ${RODA.y1 + 2}L${r1(x)} ${RODA.y2 - 2}`
  }
  return d
})()

export function Isqueiro({ id }: PropsArte) {
  const u = (s: string) => `${id}-${s}`
  const lin = (nome: string, x1: number, x2: number, paradas: [number, string, number?][], vertical = false) => (
    <linearGradient
      id={u(nome)}
      gradientUnits="userSpaceOnUse"
      x1={vertical ? 0 : x1}
      y1={vertical ? x1 : 0}
      x2={vertical ? 0 : x2}
      y2={vertical ? x2 : 0}
    >
      {paradas.map(([o, c, a], i) => (
        <stop key={i} offset={o} stopColor={c} stopOpacity={a ?? 1} />
      ))}
    </linearGradient>
  )
  return (
    <g transform="rotate(-13 180 340)">
      <defs>
        {lin('corpo', XL, XR, [
          [0, '#4a0f04'],
          [0.05, '#8f240e'],
          [0.13, '#cf4426'],
          [0.2, '#ec6440'],
          [0.255, '#f8875f'],
          [0.33, '#ea5d36'],
          [0.5, '#d9492a'],
          [0.68, '#a8331a'],
          [0.8, '#6e1a09'],
          [0.9, '#93280f'],
          [0.955, '#d75a39'],
          [0.985, '#f39a7a'],
          [1, '#4a0f04'],
        ])}
        {/* sombra do colar no topo do corpo e base virando para baixo */}
        {lin('corpoV', CORPO_T, CORPO_B, [
          [0, '#000', 0.55],
          [0.05, '#000', 0.12],
          [0.1, '#000', 0],
          [0.86, '#000', 0],
          [1, '#000', 0.5],
        ], true)}
        {/* reflexo especular principal (estrela de estúdio) */}
        {lin('spec', CORPO_T, CORPO_B, [
          [0, '#fff', 0],
          [0.07, '#fff', 0.85],
          [0.5, '#fff', 0.92],
          [0.86, '#fff', 0.7],
          [0.97, '#fff', 0],
        ], true)}
        {lin('cromo', XL, XR, [
          [0, '#15171a'],
          [0.06, '#4b5057'],
          [0.15, '#b9bec4'],
          [0.22, '#ffffff'],
          [0.28, '#c7ccd2'],
          [0.4, '#5f656c'],
          [0.55, '#2a2e33'],
          [0.68, '#7c838b'],
          [0.8, '#d9dde1'],
          [0.88, '#5a6067'],
          [0.96, '#a9afb6'],
          [1, '#15171a'],
        ])}
        {/* colar: faixa cromada com horizonte de estúdio (claro em cima, escuro embaixo) */}
        {lin('colarV', COLAR_T, COLAR_B, [
          [0, '#fff', 0.55],
          [0.18, '#fff', 0.1],
          [0.5, '#000', 0.25],
          [0.8, '#000', 0.05],
          [1, '#000', 0.45],
        ], true)}
        {lin('roda', RODA.y1, RODA.y2, [
          [0, '#3a3d42'],
          [0.2, '#c9cdd2'],
          [0.38, '#f2f4f6'],
          [0.6, '#7c8288'],
          [0.85, '#2a2d31'],
          [1, '#121315'],
        ], true)}
        {lin('alav', 136, 174, [
          [0, '#0d0e10'],
          [0.12, '#6f757c'],
          [0.3, '#e9ecef'],
          [0.5, '#9aa0a7'],
          [0.85, '#3d4248'],
          [1, '#1c1e21'],
        ], true)}
        <clipPath id={u('cc')}>
          <path d={CORPO} />
        </clipPath>
      </defs>

      {/* ===== corpo ===== */}
      <path d={CORPO} fill={`url(#${u('corpo')})`} />
      <g clipPath={`url(#${u('cc')})`}>
        {/* cantos de baixo mais escuros (curvatura dupla) */}
        <ellipse cx={XL + 10} cy={CORPO_B - 8} rx="46" ry="34" fill="#2a0601" opacity="0.35" />
        <ellipse cx={XR - 6} cy={CORPO_B - 8} rx="46" ry="34" fill="#2a0601" opacity="0.45" />
        <rect x={XL} y={CORPO_T} width={W} height={CORPO_B - CORPO_T} fill={`url(#${u('corpoV')})`} />

        {/* marca */}
        <path d={CLIPPER} fill="#fbf7f2" />

        {/* reflexos do plástico brilhante por cima da impressão */}
        <rect x={XL + 0.235 * W - 5} y={CORPO_T + 10} width="10" height={CORPO_B - CORPO_T - 34} rx="5" fill={`url(#${u('spec')})`} opacity="0.85" />
        <rect x={XL + 0.235 * W - 12} y={CORPO_T + 18} width="24" height={CORPO_B - CORPO_T - 60} rx="12" fill="#fff" opacity="0.08" />
        <rect x={XL + 0.82 * W - 3} y={CORPO_T + 30} width="6" height={CORPO_B - CORPO_T - 90} rx="3" fill={`url(#${u('spec')})`} opacity="0.18" />
        {/* luz de recorte na borda direita */}
        <rect x={XR - 3.2} y={CORPO_T + 14} width="1.6" height={CORPO_B - CORPO_T - 60} rx="0.8" fill="#ffd2bf" opacity="0.45" />
      </g>

      {/* ===== cabeça de metal ===== */}
      {/* colar que abraça o topo do corpo */}
      <rect x={XL - 1} y={COLAR_T} width={W + 2} height={COLAR_B - COLAR_T} rx="5" fill={`url(#${u('cromo')})`} />
      <rect x={XL - 1} y={COLAR_T} width={W + 2} height={COLAR_B - COLAR_T} rx="5" fill={`url(#${u('colarV')})`} />
      <path d={`M${XL + 4} ${COLAR_T + 1.2}L${XR - 4} ${COLAR_T + 1.2}`} stroke="#fff" strokeWidth="1" opacity="0.7" />

      {/* orelhas da capa (dos dois lados da roda) */}
      {[
        { x1: XL + 4, x2: RODA.x1 - 2 },
        { x1: RODA.x2 + 2, x2: XR - 4 },
      ].map((o, i) => (
        <path
          key={i}
          d={`M${o.x1} ${COLAR_T + 2}L${o.x1} ${118}Q${o.x1} ${100} ${(o.x1 + o.x2) / 2} ${98}Q${o.x2} ${100} ${o.x2} ${118}L${o.x2} ${COLAR_T + 2}Z`}
          fill={`url(#${u('cromo')})`}
        />
      ))}
      {/* brilho do topo arredondado das orelhas */}
      <path d={`M${XL + 9} 110Q${XL + 12} 101 ${XL + 22} 100`} stroke="#fff" strokeWidth="2" fill="none" opacity="0.8" strokeLinecap="round" />
      <path d={`M${RODA.x2 + 8} 108Q${RODA.x2 + 12} 101 ${RODA.x2 + 21} 100`} stroke="#fff" strokeWidth="1.4" fill="none" opacity="0.5" strokeLinecap="round" />

      {/* vão escuro entre as orelhas */}
      <rect x={RODA.x1 - 2} y={RODA.y1 - 2} width={RODA.x2 - RODA.x1 + 4} height={COLAR_T - RODA.y1 + 4} fill="#0a0a0b" />
      {/* roda de faísca */}
      <rect x={RODA.x1} y={RODA.y1} width={RODA.x2 - RODA.x1} height={RODA.y2 - RODA.y1} rx="3" fill={`url(#${u('roda')})`} />
      <path d={SERRILHA} stroke="#16181b" strokeWidth="1.3" opacity="0.75" />
      <path d={SERRILHA} stroke="#fff" strokeWidth="0.6" opacity="0.35" transform="translate(1.2 0)" />
      {/* eixo/pedra: sombra embaixo da roda */}
      <rect x={RODA.x1} y={RODA.y2 - 1} width={RODA.x2 - RODA.x1} height="6" fill="#000" opacity="0.7" />

      {/* alavanca de gás (frente da capa) */}
      <path
        d={`M${RODA.x1 - 1} ${COLAR_T + 1}L${RODA.x1 - 1} 150Q${RODA.x1 - 1} 142 ${RODA.x1 + 8} 142L${RODA.x2 - 8} 142Q${RODA.x2 + 1} 142 ${RODA.x2 + 1} 150L${RODA.x2 + 1} ${COLAR_T + 1}Z`}
        fill={`url(#${u('cromo')})`}
      />
      <path
        d={`M${RODA.x1 - 1} ${COLAR_T + 1}L${RODA.x1 - 1} 150Q${RODA.x1 - 1} 142 ${RODA.x1 + 8} 142L${RODA.x2 - 8} 142Q${RODA.x2 + 1} 142 ${RODA.x2 + 1} 150L${RODA.x2 + 1} ${COLAR_T + 1}Z`}
        fill={`url(#${u('alav')})`}
        opacity="0.55"
      />
      {/* fenda do bico de gás */}
      <rect x={CX - 9} y="146" width="18" height="5" rx="2.5" fill="#050505" />
      <path d={`M${RODA.x1 + 6} 143.4L${RODA.x2 - 6} 143.4`} stroke="#fff" strokeWidth="1" opacity="0.65" />
      {/* frestas entre orelhas e alavanca */}
      <path d={`M${RODA.x1 - 2} 118L${RODA.x1 - 2} ${COLAR_T + 1}M${RODA.x2 + 2} 118L${RODA.x2 + 2} ${COLAR_T + 1}`} stroke="#050505" strokeWidth="1.4" />
    </g>
  )
}
