// Ilustrações realistas — grupo "latas". Cada entrada: id do produto (catalogo.json) → componente (ver comum.tsx).
// Latas de alumínio vistas um pouco de cima: costura e tampa com anel em perspectiva, pescoço e pé de alumínio,
// arte impressa enrolada no cilindro (latas-cilindro.tsx) e letreiro da marca em contorno (latas-glifos.tsx).
// As marcas são evocadas (cores, forma do letreiro, elementos do rótulo) com tipos livres, sem copiar logotipo.
import type { Arte, PropsArte } from './comum'
import { FONTE } from './comum'
import { PALAVRAS } from './latas-glifos'
import { Lata, circuloD, cilindro, mat, palavra, transformarD, uma, type Cilindro, type GeoLata } from './latas-cilindro'

/** Lata 350/355 ml (66 × 122 mm ≈ 1 : 1,85). */
const GEO_350: GeoLata = { cx: 180, R: 108, topo: 152, base: 534, eTopo: 0.23, eBase: 0.3, rAro: 0.85, hAro: 6, pescoco: 34, rPe: 0.8, hPe: 26 }
/** Lata alta 680 ml (≈ 1 : 2,35). */
const GEO_680: GeoLata = { cx: 180, R: 98, topo: 104, base: 548, eTopo: 0.22, eBase: 0.3, rAro: 0.86, hAro: 6, pescoco: 30, rPe: 0.8, hPe: 24 }

const C350 = cilindro(GEO_350)
const C680 = cilindro(GEO_680)

/** Texto pequeno seguindo o arco da frente (volume, ml…). */
function TextoArco({ id, c, v, meia, children, tam, cor, fonte = FONTE.sans, peso = 700, espaco = 1, estilo }: {
  id: string
  c: Cilindro
  v: number
  meia: number
  children: string
  tam: number
  cor: string
  fonte?: string
  peso?: number
  espaco?: number
  estilo?: 'italic'
}) {
  return (
    <>
      <defs>
        <path id={id} d={c.arco(v, meia)} />
      </defs>
      <text fontFamily={fonte} fontSize={tam} fontWeight={peso} fontStyle={estilo} fill={cor} letterSpacing={espaco}>
        <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
          {children}
        </textPath>
      </text>
    </>
  )
}

/** Faixa com gotas escorrendo (borda de baixo). gotas: [u, comprimento, largura]. */
function gotejarD(u1: number, u2: number, vTopo: number, vBorda: number, gotas: readonly (readonly [number, number, number])[]): string {
  let d = `M${u1} ${vTopo}L${u2} ${vTopo}L${u2} ${vBorda}`
  const ord = [...gotas].sort((a, b) => b[0] - a[0])
  for (const [u, len, w] of ord) {
    const h = w / 2
    d += `L${u + h + 3} ${vBorda}C${u + h} ${vBorda} ${u + h} ${vBorda + 2} ${u + h} ${vBorda + 6}`
    d += `L${u + h * 0.9} ${vBorda + len - h}C${u + h} ${vBorda + len + h * 0.6} ${u - h} ${vBorda + len + h * 0.6} ${u - h * 0.9} ${vBorda + len - h}`
    d += `L${u - h} ${vBorda + 6}C${u - h} ${vBorda + 2} ${u - h} ${vBorda} ${u - h - 3} ${vBorda}`
  }
  return d + `L${u1} ${vBorda}Z`
}

// ———————————————————————— Fanta Ghost Face Punch ————————————————————————

const fanta = uma(() => {
  const c = C350
  const M = mat(0, 288) // máscara: coordenadas locais com o topo em v = 288
  const mascara = 'M0 0C29 0 48 22 48 54C48 84 42 108 35 128C28 150 16 172 0 172C-16 172-28 150-35 128C-42 108-48 84-48 54C-48 22-29 0 0 0Z'
  // olhos "tristes": canto de dentro alto, gota caindo para fora
  const olhoE = 'M-7 50C-16 50-30 56-35 66C-41 79-37 98-27 103C-18 107-11 96-9 84C-7 72-4 58-7 50Z'
  const olhoD = 'M7 50C16 50 30 56 35 66C41 79 37 98 27 103C18 107 11 96 9 84C7 72 4 58 7 50Z'
  const boca = 'M0 114C7 114 10 126 11 140C12 154 7 164 0 164C-7 164-12 154-11 140C-10 126-7 114 0 114Z'
  const capuz = 'M0-31C41-31 67 2 71 56C75 110 82 152 100 204L-100 204C-82 152-75 110-71 56C-67 2-41-31 0-31Z'
  const dobras =
    'M-56 30C-66 70-64 130-76 200L-69 200C-58 130-58 74-50 36Z' +
    'M56 30C66 70 64 130 76 200L69 200C58 130 58 74 50 36Z' +
    'M-28-23C-46-15-58 4-63 30L-59 32C-52 8-42-10-26-19Z' +
    'M28-23C46-15 58 4 63 30L59 32C52 8 42-10 26-19Z'
  const letra = (i: number) => ({ dv: [0, 2.5, -1, 2, -1.5][i], rot: [-5, 3, -2, 4, -3][i] })
  return {
    fumaca: c.enrolar(circuloD(0, 380, 140, 175)),
    gotas: c.enrolar(
      gotejarD(-175, 175, c.vTopo - 30, 226, [
        [-150, 14, 7], [-118, 26, 8], [-92, 10, 6], [-64, 30, 8], [-30, 14, 7], [8, 22, 8], [40, 12, 6], [72, 28, 8], [104, 14, 7], [136, 22, 8], [162, 12, 6],
      ]),
    ),
    capuz: c.enrolar(capuz, M),
    dobras: c.enrolar(dobras, M),
    mascara: c.enrolar(mascara, M),
    sombraMascara: c.enrolar('M20 8C42 24 48 60 44 94C40 126 28 158 4 170C28 152 35 122 37 94C39 60 33 28 20 8Z', M),
    olhos: c.enrolar(olhoE, M) + c.enrolar(olhoD, M),
    orbitas: c.enrolar(olhoE, mat(3.5, 278.3, 1.16, 0, 1.1)) + c.enrolar(olhoD, mat(-3.5, 278.3, 1.16, 0, 1.1)),
    boca: c.enrolar(boca, M),
    orbBoca: c.enrolar(boca, mat(0, 274, 1.3, 0, 1.1)),
    nariz: c.enrolar('M-3 98C-2 104-1 108 0 109C1 108 2 104 3 98C2 102-2 102-3 98Z', M),
    folha: c.enrolar('M0 0C7-14 26-21 46-16C37-1 17 6 0 0Z', mat(-64, 236, 1, -24)),
    nervura: c.enrolar('M3-1C15-7 27-12 42-15', mat(-64, 236, 1, -24)),
    logo: palavra(c, 'fanta', { u: 2, v: 278, larg: 176, letra }),
    ghost: palavra(c, 'ghost', { u: 0, v: 498, larg: 152 }),
    punch: palavra(c, 'punch', { u: 0, v: 531, larg: 98 }),
  }
})

function FantaGhostFacePunch({ id }: PropsArte) {
  const d = fanta()
  const c = C350
  const I = (s: string) => `${id}-${s}`
  return (
    <Lata id={id} c={c} cfg={{ fundo: '#111113', pescoco: '#161619', reflexo: 0.9, recorte: '#ffd9e4' }}>
      <defs>
        <radialGradient id={I('fum')} cx="0.5" cy="0.42" r="0.55">
          <stop offset="0" stopColor="#8d8496" />
          <stop offset="0.45" stopColor="#4a4452" />
          <stop offset="1" stopColor="#111113" stopOpacity={0} />
        </radialGradient>
        <linearGradient id={I('fundo')} gradientUnits="userSpaceOnUse" x1="0" y1={c.y0} x2="0" y2={c.vBase}>
          <stop offset="0" stopColor="#1f1d24" />
          <stop offset="1" stopColor="#0a0a0b" />
        </linearGradient>
        <linearGradient id={I('ponche')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff5a83" />
          <stop offset="1" stopColor="#d0164a" />
        </linearGradient>
        <linearGradient id={I('capuz')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b0b0d" />
          <stop offset="0.7" stopColor="#060607" />
          <stop offset="1" stopColor="#060607" stopOpacity={0} />
        </linearGradient>
        <linearGradient id={I('masc')} x1="0" y1="0" x2="1" y2="0.25">
          <stop offset="0" stopColor="#cfcecb" />
          <stop offset="0.28" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#efeeeb" />
          <stop offset="1" stopColor="#a3a29f" />
        </linearGradient>
        <linearGradient id={I('folha')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#a6e85a" />
          <stop offset="1" stopColor="#2e9a3b" />
        </linearGradient>
      </defs>
      <rect x={60} y={150} width={240} height={420} fill={`url(#${I('fundo')})`} />
      <path d={d.fumaca} fill={`url(#${I('fum')})`} />
      <path d={d.gotas} fill={`url(#${I('ponche')})`} />
      <path d={d.capuz} fill={`url(#${I('capuz')})`} stroke="#3a3840" strokeOpacity={0.55} strokeWidth={1.2} />
      <path d={d.dobras} fill="#4a4752" opacity={0.6} />
      <path d={d.mascara} fill={`url(#${I('masc')})`} />
      <path d={d.sombraMascara} fill="#000" opacity={0.12} />
      <path d={d.orbitas} fill="#7c7b79" opacity={0.42} />
      <path d={d.orbBoca} fill="#7c7b79" opacity={0.32} />
      <path d={d.olhos} fill="#060607" />
      <path d={d.boca} fill="#060607" />
      <path d={d.nariz} fill="#9a9996" opacity={0.6} />
      {/* letreiro: contorno escuro, contorno laranja, branco */}
      <path d={d.logo} fill="#fff" stroke="#0d0d0d" strokeWidth={6.5} strokeLinejoin="round" />
      <path d={d.logo} fill="#fff" stroke="#ff7a00" strokeWidth={3.6} strokeLinejoin="round" style={{ paintOrder: 'stroke' }} />
      <path d={d.folha} fill={`url(#${I('folha')})`} stroke="#0d0d0d" strokeWidth={1.6} style={{ paintOrder: 'stroke' }} />
      <path d={d.nervura} fill="none" stroke="#1d6a26" strokeWidth={1.1} />
      <path d={d.ghost} fill={`url(#${I('ponche')})`} stroke="#000" strokeWidth={3} style={{ paintOrder: 'stroke' }} />
      <path d={d.punch} fill={`url(#${I('ponche')})`} stroke="#000" strokeWidth={3} style={{ paintOrder: 'stroke' }} />
    </Lata>
  )
}

// ———————————————————————— Coca-Cola Vanilla ————————————————————————

const coca = uma(() => {
  const c = C350
  const N = 70
  // fita branca dinâmica e, logo abaixo, a faixa creme da baunilha acompanhando a onda
  const vt = (u: number) => 362 + 10 * Math.sin(u / 58 + 0.4)
  const esp = (u: number) => 1.4 + 8 * Math.exp(-(((u - 10) / 85) ** 2))
  const ct = (u: number) => vt(u) + esp(u) + 5
  const cb = (u: number) => vt(u + 14) + 58 + 5 * Math.exp(-((u / 90) ** 2))
  const meio = (u: number) => (ct(u) + cb(u)) / 2
  const ondaT: string[] = []
  const ondaB: string[] = []
  const cremeT: string[] = []
  const cremeB: string[] = []
  for (let k = 0; k <= N; k++) {
    const u = -176 + (352 * k) / N
    ondaT.push(`${u.toFixed(1)} ${vt(u).toFixed(1)}`)
    ondaB.unshift(`${u.toFixed(1)} ${(vt(u) + esp(u)).toFixed(1)}`)
    cremeT.push(`${u.toFixed(1)} ${ct(u).toFixed(1)}`)
    cremeB.unshift(`${u.toFixed(1)} ${cb(u).toFixed(1)}`)
  }
  // VANILLA acompanha a faixa: cada letra sobe/desce e gira com a onda
  const V = PALAVRAS.vanilla
  const larg = 148
  const uV = -14
  const sV = larg / V.w
  const vBase = meio(uV) + 11
  const letra = (i: number) => {
    const x0 = V.g[i][0]
    const x1 = V.g[i + 1]?.[0] ?? V.w
    const u = uV + ((x0 + x1) / 2 - V.w / 2) * sV
    const incl = (meio(u + 1) - meio(u - 1)) / 2
    return { dv: meio(u) - meio(uV), rot: (Math.atan(incl) * 180) / Math.PI }
  }
  // flor de baunilha (orquídea): 3 sépalas + 2 pétalas
  let petalas = ''
  for (const [a, l, w] of [[-90, 30, 7], [-18, 27, 8], [54, 28, 7], [126, 28, 7], [198, 27, 8]] as const) {
    petalas += transformarD(`M0 0C${w}-6 ${w + 2}-${l * 0.7} 0-${l}C-${w + 2}-${l * 0.7}-${w}-6 0 0Z`, mat(0, 0, 1, a + 90))
  }
  const F = mat(92, ct(92) + 2, 0.95, 10)
  // floreio da cauda do primeiro "C", por baixo de "oca" (coordenadas da palavra)
  const cauda = 'M22 1C52 16 122 17 184-3C186-2 186-1 185 0.5C124 14 54 15 22 1Z'
  return {
    onda: c.enrolar('M' + ondaT.join('L') + 'L' + ondaB.join('L') + 'Z'),
    creme: c.enrolar('M' + cremeT.join('L') + 'L' + cremeB.join('L') + 'Z'),
    logo: palavra(c, 'coca', { u: -2, v: 330, larg: 252, extra: cauda }),
    vanilla: palavra(c, 'vanilla', { u: uV, v: vBase, larg, letra }),
    vagem: c.enrolar('M-50 26C-15 16 20 6 52-14C54-12 54-10 52-8C22 12-14 22-50 30Z', mat(108, ct(108) + 4, 0.62, 8)),
    petalas: c.enrolar(petalas, F),
    labelo: c.enrolar(circuloD(0, 2, 9, 8), F),
    garganta: c.enrolar(circuloD(0, 3, 4.5, 4), F),
  }
})

function CocaColaVanilla({ id }: PropsArte) {
  const d = coca()
  const c = C350
  const I = (s: string) => `${id}-${s}`
  return (
    <Lata id={id} c={c} cfg={{ fundo: '#d9101c', recorte: '#ffe3e3' }}>
      <defs>
        <linearGradient id={I('creme')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fdf3da" />
          <stop offset="1" stopColor="#efdcb0" />
        </linearGradient>
        <radialGradient id={I('pet')} cx="0.5" cy="0.5" r="0.6">
          <stop offset="0" stopColor="#f0c040" />
          <stop offset="0.35" stopColor="#fbe7a6" />
          <stop offset="1" stopColor="#fffaea" />
        </radialGradient>
      </defs>
      <path d={d.onda} fill="#fff" />
      <path d={d.creme} fill={`url(#${I('creme')})`} />
      <path d={d.vanilla} fill="#b30d1a" />
      <path d={d.vagem} fill="#3e2213" />
      <path d={d.petalas} fill={`url(#${I('pet')})`} stroke="#b88e33" strokeWidth={0.7} />
      <path d={d.labelo} fill="#f6d36b" stroke="#c98a22" strokeWidth={0.5} />
      <path d={d.garganta} fill="#e08a22" />
      <path d={d.logo} fill="#fff" stroke="#fff" strokeWidth={1.3} strokeLinejoin="round" />
      <TextoArco id={I('ml')} c={c} v={516} meia={80} tam={10} cor="#fff" espaco={1.2}>
        12 FL OZ · 355 mL
      </TextoArco>
    </Lata>
  )
}

// ———————————————————————— Dr Pepper ————————————————————————

const drpepper = uma(() => {
  const c = C350
  // faixa inclinada que acompanha o letreiro (−8°)
  const t = Math.tan((8 * Math.PI) / 180)
  const vc = (u: number) => 368 - u * t
  const linha = (dv: number, e: number) =>
    `M-180 ${vc(-180) + dv}L180 ${vc(180) + dv}L180 ${vc(180) + dv + e}L-180 ${vc(-180) + dv + e}Z`
  return {
    fita: c.enrolar(linha(-40, 82)),
    filetes: c.enrolar(linha(-43, 2.2)) + c.enrolar(linha(43, 2.2)),
    sombra: palavra(c, 'drpepper', { u: 1.2, v: 383.6, larg: 246, rot: -8 }),
    logo: palavra(c, 'drpepper', { u: 0, v: 382, larg: 246, rot: -8 }),
    listras:
      c.enrolar('M-180 236L180 236L180 238.5L-180 238.5Z') +
      c.enrolar('M-180 242L180 242L180 243.2L-180 243.2Z') +
      c.enrolar('M-180 506L180 506L180 507.2L-180 507.2Z') +
      c.enrolar('M-180 510.5L180 510.5L180 513L-180 513Z'),
  }
})

function DrPepper({ id }: PropsArte) {
  const d = drpepper()
  const c = C350
  const I = (s: string) => `${id}-${s}`
  return (
    <Lata id={id} c={c} cfg={{ fundo: '#5f0b18', pescoco: '#650d1b', recorte: '#ffe0e4' }}>
      <defs>
        <linearGradient id={I('fundo')} gradientUnits="userSpaceOnUse" x1="0" y1={c.y0} x2="0" y2={c.vBase}>
          <stop offset="0" stopColor="#7a1626" />
          <stop offset="0.5" stopColor="#62101d" />
          <stop offset="1" stopColor="#470812" />
        </linearGradient>
        <linearGradient id={I('prata')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8d8f95" />
          <stop offset="0.3" stopColor="#f4f5f7" />
          <stop offset="0.7" stopColor="#c9cbd0" />
          <stop offset="1" stopColor="#8d8f95" />
        </linearGradient>
      </defs>
      <rect x={60} y={150} width={240} height={420} fill={`url(#${I('fundo')})`} />
      <path d={d.fita} fill="#8a2131" opacity={0.7} />
      <path d={d.filetes} fill={`url(#${I('prata')})`} />
      <path d={d.listras} fill={`url(#${I('prata')})`} />
      <path d={d.sombra} fill="#2a0309" opacity={0.5} />
      <path d={d.logo} fill="#fff" />
      <TextoArco id={I('desde')} c={c} v={278} meia={80} tam={11} cor="#f3dfe2" fonte={FONTE.serifa} espaco={3}>
        SINCE 1885
      </TextoArco>
      <TextoArco id={I('ml')} c={c} v={496} meia={70} tam={10} cor="#f3dfe2" espaco={1.4}>
        355 mL
      </TextoArco>
    </Lata>
  )
}

// ———————————————————————— Arizona Green Tea ————————————————————————

function florD(u: number, v: number, r: number, rot: number): string {
  let d = ''
  for (let k = 0; k < 5; k++) {
    const p = `M0 0C${0.46 * r} ${-0.2 * r} ${0.66 * r} ${-0.8 * r} ${0.22 * r} ${-r}C${0.1 * r} ${-1.02 * r} ${0.03 * r} ${-0.92 * r} 0 ${-0.86 * r}C${-0.03 * r} ${-0.92 * r} ${-0.1 * r} ${-1.02 * r} ${-0.22 * r} ${-r}C${-0.66 * r} ${-0.8 * r} ${-0.46 * r} ${-0.2 * r} 0 0Z`
    d += transformarD(p, mat(u, v, 1, rot + k * 72))
  }
  return d
}

const FLORES: readonly (readonly [number, number, number, number])[] = [
  [-150, 236, 9, 20], [-120, 210, 12, 8], [-88, 224, 9, 40], [-46, 197, 13, 0], [-30, 247, 9, 25], [-4, 184, 10, 60],
  [30, 180, 13, 15], [70, 211, 10, 35], [98, 160, 12, 5], [126, 140, 9, 50], [150, 154, 9, 30],
  [70, 497, 12, 12], [104, 488, 10, 44], [136, 508, 11, 22], [44, 512, 8, 30],
  [-150, 462, 11, 18], [-118, 448, 13, 40], [-84, 440, 10, 8], [-104, 476, 9, 30], [-60, 428, 8, 52],
]

const arizona = uma(() => {
  const c = C680
  const galhos = [
    'M-180 230C-130 205-90 216-46 197C-12 182 22 190 62 172C92 160 122 166 180 146',
    'M-62 206C-56 222-46 236-30 247',
    'M32 184C42 200 54 208 70 211',
    'M92 163C100 152 110 145 126 140',
    'M-118 211C-130 222-140 230-150 236',
    'M180 522C140 504 112 508 72 496C58 492 48 500 44 512',
    'M108 503C104 496 104 492 104 488',
    'M-180 470C-150 462-128 450-104 448C-88 446-74 436-60 428',
    'M-118 449C-112 460-108 468-104 476',
  ]
  const brotos: readonly (readonly [number, number])[] = [[-70, 190], [10, 170], [56, 198], [150, 170], [-100, 236], [126, 520], [86, 512], [-136, 452], [-72, 444], [-48, 420]]
  return {
    galho1: c.enrolar(galhos[0]) + c.enrolar(galhos[5]) + c.enrolar(galhos[7]),
    galho2: galhos.filter((_, i) => i !== 0 && i !== 5 && i !== 7).map((g) => c.enrolar(g)).join(''),
    flores: FLORES.map(([u, v, r, a]) => c.enrolar(florD(u, v, r, a))).join(''),
    miolos: FLORES.map(([u, v, r]) => c.enrolar(circuloD(u, v, r * 0.24))).join(''),
    brotos: brotos.map(([u, v]) => c.enrolar(circuloD(u, v, 3.6, 4.4))).join(''),
    logo: palavra(c, 'arizona', { u: 0, v: 336, larg: 192 }),
    tea: palavra(c, 'greentea', { u: 0, v: 378, larg: 160 }),
    linha1: c.enrolar('M-80 392L80 392L80 393.2L-80 393.2Z'),
  }
})

function ArizonaGreenTea({ id }: PropsArte) {
  const d = arizona()
  const c = C680
  const I = (s: string) => `${id}-${s}`
  return (
    <Lata id={id} c={c} cfg={{ fundo: '#86dcc0', pescoco: '#78d0b2', recorte: '#f2fff9' }}>
      <defs>
        <linearGradient id={I('fundo')} gradientUnits="userSpaceOnUse" x1="0" y1={c.y0} x2="0" y2={c.vBase}>
          <stop offset="0" stopColor="#a2ead3" />
          <stop offset="0.5" stopColor="#86dcc0" />
          <stop offset="1" stopColor="#6ccdab" />
        </linearGradient>
        <radialGradient id={I('pet')} cx="0.5" cy="0.5" r="0.62">
          <stop offset="0" stopColor="#d9578a" />
          <stop offset="0.3" stopColor="#f39bbb" />
          <stop offset="1" stopColor="#ffd6e4" />
        </radialGradient>
      </defs>
      <rect x={70} y={100} width={220} height={480} fill={`url(#${I('fundo')})`} />
      <path d={d.galho1} fill="none" stroke="#5a3a2c" strokeWidth={4.2} strokeLinecap="round" />
      <path d={d.galho2} fill="none" stroke="#5a3a2c" strokeWidth={2.2} strokeLinecap="round" />
      <path d={d.brotos} fill="#e9799f" />
      <path d={d.flores} fill={`url(#${I('pet')})`} stroke="#d2668f" strokeWidth={0.5} />
      <path d={d.miolos} fill="#b3305f" />
      <path d={d.logo} fill="#1d5a3b" stroke="#fdf6e4" strokeWidth={4} strokeLinejoin="round" style={{ paintOrder: 'stroke' }} />
      <path d={d.tea} fill="#1d5a3b" />
      <path d={d.linha1} fill="#1d5a3b" opacity={0.6} />
      <TextoArco id={I('gin')} c={c} v={410} meia={90} tam={13} cor="#1f5c3d" fonte={FONTE.serifa} peso={400} espaco={0.2} estilo="italic">
        with Ginseng and Honey
      </TextoArco>
      <TextoArco id={I('ml')} c={c} v={546} meia={90} tam={9} cor="#1f5c3d" espaco={1}>
        23 FL OZ (680 mL)
      </TextoArco>
    </Lata>
  )
}

export const artes: Record<string, Arte> = {
  'fanta-ghost-face-punch': FantaGhostFacePunch,
  'coca-cola-vanilla': CocaColaVanilla,
  'dr-pepper': DrPepper,
  'arizona-green-tea': ArizonaGreenTea,
}
