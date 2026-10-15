// Cuia de silicone RAW — tigela de silicone fosco cor de caramelo vista de cima (elevação ~52°), borda grossa e macia,
// interior à mostra e "RAW" em baixo-relevo no fundo, projetado no plano do fundo (perspectiva certa).
// Silicone fosco: só gradientes largos e macios (nada de reflexo duro) e um grão finíssimo por cima.
import type { PropsArte } from './comum'
import { PALAVRAS } from './acessorios-glifos'
import { palavra, poli, prng, r1, type Pt } from './acessorios-base'

const CX = 180
const CY = 262 // centro da boca
const ELEV = (52 * Math.PI) / 180
const KS = Math.sin(ELEV) // achatamento das elipses horizontais
const KC = Math.cos(ELEV) // quanto a profundidade desce na tela
const R = 156 // raio externo da borda
const RI = 135 // raio interno da borda
const H = 140 // altura externa
const RB = 102 // raio da base
const D = 116 // profundidade interna
const RF = 100 // raio do fundo interno
const CYF = CY + D * KC // centro do fundo interno na tela

/** Raio externo na profundidade z (0 = borda, H = base): bojo que segura a largura e fecha perto da base. */
const rho = (z: number) => {
  const t = z / H
  return R - (R - RB) * Math.pow(t, 2.1) - 4 * Math.sin(Math.PI * Math.min(1, t * 1.2))
}

// Silhueta de baixo do corpo: para cada x, o ponto mais baixo entre todas as elipses do bojo
const CONTORNO: Pt[] = (() => {
  const pts: Pt[] = []
  for (let x = -R; x <= R + 0.01; x += 3) {
    let best = CY
    for (let z = 0; z <= H; z += 2) {
      const r = rho(z)
      if (Math.abs(x) > r) continue
      const y = CY + z * KC + KS * Math.sqrt(r * r - x * x)
      if (y > best) best = y
    }
    pts.push([CX + x, best])
  }
  return pts
})()
const BASE_Y = Math.max(...CONTORNO.map((p) => p[1]))

const elipse = (cy: number, rx: number, ry: number) =>
  `M${r1(CX - rx)} ${r1(cy)}A${r1(rx)} ${r1(ry)} 0 1 0 ${r1(CX + rx)} ${r1(cy)}A${r1(rx)} ${r1(ry)} 0 1 0 ${r1(CX - rx)} ${r1(cy)}Z`

// Corpo: metade de trás da elipse da borda + contorno de baixo
const CORPO = `M${CX - R} ${CY}A${R} ${r1(R * KS)} 0 0 1 ${CX + R} ${CY}` + poli([...CONTORNO].reverse(), false).replace(/^M/, 'L') + 'Z'
// Faixa externa visível: abaixo da metade da frente da borda
const BORDA = elipse(CY, R, R * KS)
const BOCA = elipse(CY, RI, RI * KS)
const FUNDO = elipse(CYF, RF, RF * KS)

// "RAW" no plano do fundo: u para a direita, v para a frente (desce na tela achatado por KS)
const fundo = (u: number, v: number): Pt => [CX + u, CYF + v * KS]
const RAW = (dx: number, dy: number) =>
  palavra(PALAVRAS.raw, { u: 0, v: 2, h: 43, sx: 0.88, ancora: 'meio', meioV: true }, (a, b) => {
    const [x, y] = fundo(a, b)
    return [x + dx, y + dy]
  })
const RAW0 = RAW(0, 0)
const RAW_LUZ = RAW(-1.6, -1.6) // deslocado para cima-esquerda (o que sobra embaixo-direita vira parede acesa)
const RAW_SOMBRA = RAW(2.6, 2.2)

// Grão do silicone fosco (ladrilho 26×26)
const GRAO = (() => {
  const rnd = prng(31)
  let claro = ''
  let escuro = ''
  for (let i = 0; i < 26; i++) {
    const x = r1(rnd() * 26)
    const y = r1(rnd() * 26)
    const s = `M${x} ${y}h0.9v0.9h-0.9z`
    if (rnd() < 0.5) claro += s
    else escuro += s
  }
  return { claro, escuro }
})()

export function Cuia({ id }: PropsArte) {
  const u = (s: string) => `${id}-${s}`
  const tf = `translate(${CX} ${CY}) scale(1 ${r1(KS * 1000) / 1000}) translate(${-CX} ${-CY})`
  const tff = `translate(${CX} ${r1(CYF)}) scale(1 ${r1(KS * 1000) / 1000}) translate(${-CX} ${-r1(CYF)})`
  return (
    <g transform="rotate(-9 180 330)">
      <defs>
        {/* lateral externa: luz larga à esquerda, sombra à direita (fosco) */}
        <linearGradient id={u('ext')} gradientUnits="userSpaceOnUse" x1={CX - R} y1="0" x2={CX + R} y2="0">
          <stop offset="0" stopColor="#3a1f0b" />
          <stop offset="0.08" stopColor="#7d4c24" />
          <stop offset="0.24" stopColor="#c48a52" />
          <stop offset="0.34" stopColor="#c99159" />
          <stop offset="0.52" stopColor="#a56c3a" />
          <stop offset="0.76" stopColor="#5f3818" />
          <stop offset="0.92" stopColor="#6e4220" />
          <stop offset="0.975" stopColor="#a1693a" />
          <stop offset="1" stopColor="#3a1f0b" />
        </linearGradient>
        <linearGradient id={u('extV')} gradientUnits="userSpaceOnUse" x1="0" y1={CY + R * KS - 10} x2="0" y2={BASE_Y}>
          <stop offset="0" stopColor="#000" stopOpacity="0" />
          <stop offset="0.55" stopColor="#000" stopOpacity="0.18" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </linearGradient>
        {/* borda grossa e arredondada: escura onde vira para dentro e para fora, clara em cima */}
        <radialGradient id={u('borda')} gradientUnits="userSpaceOnUse" cx={CX} cy={CY} r={R} gradientTransform={tf}>
          <stop offset={RI / R - 0.005} stopColor="#5e3618" />
          <stop offset={RI / R + 0.03} stopColor="#b47b45" />
          <stop offset={RI / R + 0.07} stopColor="#dca672" />
          <stop offset="0.965" stopColor="#c08650" />
          <stop offset="1" stopColor="#6a3f1d" />
        </radialGradient>
        <linearGradient id={u('bordaLuz')} x1="0.05" y1="0" x2="0.95" y2="1">
          <stop offset="0" stopColor="#fff2df" stopOpacity="0.3" />
          <stop offset="0.4" stopColor="#fff2df" stopOpacity="0.04" />
          <stop offset="0.62" stopColor="#000" stopOpacity="0.05" />
          <stop offset="1" stopColor="#000" stopOpacity="0.42" />
        </linearGradient>
        {/* interior: parede da esquerda na sombra, parede do fundo-direita acesa */}
        <linearGradient id={u('dentro')} gradientUnits="userSpaceOnUse" x1={CX - RI} y1={CY - 40} x2={CX + RI} y2={CY + 30}>
          <stop offset="0" stopColor="#2e1707" />
          <stop offset="0.3" stopColor="#5c3416" />
          <stop offset="0.62" stopColor="#a16a38" />
          <stop offset="0.85" stopColor="#c68e57" />
          <stop offset="1" stopColor="#9a6234" />
        </linearGradient>
        <radialGradient id={u('fundo')} gradientUnits="userSpaceOnUse" cx={CX + 18} cy={CYF - 6} r={RF * 1.05} gradientTransform={tff}>
          <stop offset="0" stopColor="#c48c55" />
          <stop offset="0.6" stopColor="#a8703f" />
          <stop offset="0.9" stopColor="#7a4a24" />
          <stop offset="1" stopColor="#5a3416" />
        </radialGradient>
        <clipPath id={u('cboca')}>
          <path d={BOCA} />
        </clipPath>
        <clipPath id={u('cfundo')}>
          <path d={FUNDO} />
        </clipPath>
        <clipPath id={u('craw')}>
          <path d={RAW0} />
        </clipPath>
        <clipPath id={u('craw2')}>
          <path d={RAW_LUZ} />
        </clipPath>
        <pattern id={u('grao')} width="26" height="26" patternUnits="userSpaceOnUse">
          <path d={GRAO.claro} fill="#fff" opacity="0.07" />
          <path d={GRAO.escuro} fill="#000" opacity="0.1" />
        </pattern>
      </defs>

      {/* ===== corpo por fora ===== */}
      <path d={CORPO} fill={`url(#${u('ext')})`} />
      <path d={CORPO} fill={`url(#${u('extV')})`} />
      <path d={CORPO} fill={`url(#${u('grao')})`} />
      {/* luz de recorte fina na direita */}
      <path d={poli(CONTORNO.slice(Math.floor(CONTORNO.length * 0.72)), false)} fill="none" stroke="#e9b98a" strokeWidth="1.2" opacity="0.35" />

      {/* ===== borda ===== */}
      <path d={BORDA + BOCA} fillRule="evenodd" fill={`url(#${u('borda')})`} />
      <path d={BORDA + BOCA} fillRule="evenodd" fill={`url(#${u('bordaLuz')})`} />
      {/* brilho macio no topo da borda, frente-esquerda */}
      <path
        d={`M${r1(CX - (RI + 10) * 0.97)} ${r1(CY + (RI + 10) * KS * 0.24)}A${RI + 10} ${r1((RI + 10) * KS)} 0 0 0 ${r1(CX - (RI + 10) * 0.35)} ${r1(CY + (RI + 10) * KS * 0.94)}`}
        fill="none"
        stroke="#ffe9cf"
        strokeWidth="6"
        strokeLinecap="round"
        opacity="0.16"
      />
      <path
        d={`M${r1(CX - (RI + 10) * 0.9)} ${r1(CY - (RI + 10) * KS * 0.44)}A${RI + 10} ${r1((RI + 10) * KS)} 0 0 1 ${r1(CX - (RI + 10) * 0.2)} ${r1(CY - (RI + 10) * KS * 0.98)}`}
        fill="none"
        stroke="#fff3e2"
        strokeWidth="5"
        strokeLinecap="round"
        opacity="0.2"
      />

      {/* ===== interior ===== */}
      <g clipPath={`url(#${u('cboca')})`}>
        <rect x={CX - RI} y={CY - RI} width={RI * 2} height={RI * 2} fill={`url(#${u('dentro')})`} />
        {/* parede do fundo mais clara no meio (de frente para a câmera) */}
        <ellipse cx={CX + 26} cy={CY - 30} rx={RI * 0.75} ry={RI * KS * 0.5} fill="#d59c62" opacity="0.18" />
        {/* sombra de contato da parede com o fundo (oclusão) */}
        <ellipse cx={CX} cy={CYF} rx={RF + 16} ry={(RF + 16) * KS} fill="#2a1406" opacity="0.28" />
        <ellipse cx={CX} cy={CYF} rx={RF + 7} ry={(RF + 7) * KS} fill="#2a1406" opacity="0.25" />
        {/* fundo */}
        <path d={FUNDO} fill={`url(#${u('fundo')})`} />
        <g clipPath={`url(#${u('cfundo')})`}>
          {/* a borda da esquerda faz sombra no fundo (luz de cima à esquerda) */}
          <ellipse cx={CX + 40} cy={CYF + 12} rx={RF + 24} ry={(RF + 24) * KS} fill="none" stroke="#1d0d03" strokeWidth="40" opacity="0.22" />
          <ellipse cx={CX + 30} cy={CYF + 8} rx={RF + 16} ry={(RF + 16) * KS} fill="none" stroke="#1d0d03" strokeWidth="26" opacity="0.18" />

          {/* RAW em baixo-relevo: parede de cima-esquerda na sombra, de baixo-direita acesa */}
          <g clipPath={`url(#${u('craw')})`}>
            <rect x={CX - RF} y={CYF - RF} width={RF * 2} height={RF * 2} fill="#e7b47f" />
            <path d={RAW_LUZ} fill="#2b1406" />
            <g clipPath={`url(#${u('craw2')})`}>
              <path d={RAW_SOMBRA} fill="#6b3f1c" />
            </g>
          </g>
        </g>
        {/* sombra da borda de trás descendo pela parede */}
        <path
          d={`M${CX - RI} ${CY}A${RI} ${r1(RI * KS)} 0 0 1 ${CX + RI} ${CY}`}
          fill="none"
          stroke="#1d0d03"
          strokeWidth="14"
          opacity="0.32"
        />
        <path d={BOCA} fill={`url(#${u('grao')})`} />
      </g>
      {/* aresta interna da borda (curva que entra na cuia) */}
      <path d={`M${CX - RI} ${CY}A${RI} ${r1(RI * KS)} 0 0 0 ${CX + RI} ${CY}`} fill="none" stroke="#2a1406" strokeWidth="1.4" opacity="0.6" />
      <path d={BORDA + BOCA} fillRule="evenodd" fill={`url(#${u('grao')})`} />
    </g>
  )
}
