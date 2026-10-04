// Ilustrações realistas — grupo "latas". Cada entrada: id do produto (catalogo.json) → componente (ver comum.tsx).
// Latas de alumínio vistas um pouco de cima: costura e tampa com anel em perspectiva, pescoço e pé de alumínio,
// arte impressa enrolada no cilindro (latas-cilindro.tsx) e letreiro da marca em contorno (latas-glifos.tsx).
// As marcas são evocadas (cores, forma do letreiro, elementos do rótulo) com tipos livres, sem copiar logotipo.
import type { Arte, PropsArte } from './comum'
import { FONTE } from './comum'
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
  const M = mat(0, 286) // máscara: coordenadas locais com o topo em v = 286
  const mascara = 'M0 0C30 0 50 22 50 52C50 82 44 104 38 124C31 148 18 170 0 170C-18 170-31 148-38 124C-44 104-50 82-50 52C-50 22-30 0 0 0Z'
  const olhoE = 'M-6 52C-14 54-30 54-38 62C-46 72-42 92-30 96C-18 99-10 86-8 74C-7 66-5 58-6 52Z'
  const olhoD = 'M6 52C14 54 30 54 38 62C46 72 42 92 30 96C18 99 10 86 8 74C7 66 5 58 6 52Z'
  const boca = 'M0 112C7 112 10 124 11 138C12 152 7 162 0 162C-7 162-12 152-11 138C-10 124-7 112 0 112Z'
  const capuz = 'M0-30C44-30 74 4 78 56C82 110 90 150 112 200L-112 200C-90 150-82 110-78 56C-74 4-44-30 0-30Z'
  const dobra1 = 'M-62 40C-70 80-68 130-80 190L-74 190C-62 130-62 80-56 44Z'
  const dobra2 = 'M62 40C70 80 68 130 80 190L74 190C62 130 62 80 56 44Z'
  const letra = (i: number) => ({ dv: [0, 3, -1, 2.5, -1.5][i], rot: [-6, 4, -3, 5, -4][i] })
  return {
    fumaca: c.enrolar(circuloD(0, 370, 125, 150)),
    gotas: c.enrolar(
      gotejarD(-175, 175, c.vTopo - 30, 226, [
        [-150, 14, 7], [-118, 26, 8], [-92, 10, 6], [-64, 34, 8], [-30, 16, 7], [6, 24, 8], [38, 12, 6], [70, 30, 8], [104, 14, 7], [136, 22, 8], [162, 12, 6],
      ]),
    ),
    capuz: c.enrolar(capuz, M),
    dobras: c.enrolar(dobra1, M) + c.enrolar(dobra2, M),
    mascara: c.enrolar(mascara, M),
    sombraMascara: c.enrolar('M22 10C44 26 50 60 46 92C42 124 30 156 6 168C30 150 36 120 38 92C40 60 34 30 22 10Z', M),
    olhos: c.enrolar(olhoE, M) + c.enrolar(olhoD, M),
    orbitas: c.enrolar(olhoE, mat(4.3, 277, 1.18, 0, 1.12)) + c.enrolar(olhoD, mat(-4.3, 277, 1.18, 0, 1.12)),
    boca: c.enrolar(boca, M),
    orbBoca: c.enrolar(boca, mat(0, 272.3, 1.3, 0, 1.1)),
    nariz: c.enrolar('M-3 96C-2 102-1 106 0 107C1 106 2 102 3 96C2 100-2 100-3 96Z', M),
    folha: c.enrolar('M0 0C6-12 22-18 38-14C31-1 15 5 0 0Z', mat(-70, 233, 1, -18)),
    nervura: c.enrolar('M2-1C12-6 22-10 34-13', mat(-70, 233, 1, -18)),
    logo: palavra(c, 'fanta', { u: 2, v: 276, larg: 172, letra }),
    ghost: palavra(c, 'ghost', { u: 0, v: 497, larg: 150 }),
    punch: palavra(c, 'punch', { u: 0, v: 530, larg: 96 }),
  }
})

function FantaGhostFacePunch({ id }: PropsArte) {
  const d = fanta()
  const c = C350
  const I = (s: string) => `${id}-${s}`
  return (
    <Lata id={id} c={c} cfg={{ fundo: '#121214', pescoco: '#18181b', reflexo: 0.9, recorte: '#ffd9e4' }}>
      <defs>
        <radialGradient id={I('fum')} cx="0.5" cy="0.45" r="0.55">
          <stop offset="0" stopColor="#4a4650" />
          <stop offset="0.5" stopColor="#26242a" />
          <stop offset="1" stopColor="#121214" stopOpacity={0} />
        </radialGradient>
        <linearGradient id={I('ponche')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff4f7b" />
          <stop offset="1" stopColor="#c4123f" />
        </linearGradient>
        <linearGradient id={I('capuz')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#09090a" />
          <stop offset="1" stopColor="#050506" />
        </linearGradient>
        <linearGradient id={I('masc')} x1="0" y1="0" x2="1" y2="0.25">
          <stop offset="0" stopColor="#d4d3d0" />
          <stop offset="0.28" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#efeeeb" />
          <stop offset="1" stopColor="#a9a8a5" />
        </linearGradient>
        <linearGradient id={I('folha')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#9be04f" />
          <stop offset="1" stopColor="#2f9b3c" />
        </linearGradient>
      </defs>
      <path d={d.fumaca} fill={`url(#${I('fum')})`} />
      <path d={d.gotas} fill={`url(#${I('ponche')})`} />
      <path d={d.capuz} fill={`url(#${I('capuz')})`} />
      <path d={d.dobras} fill="#2a2a2f" opacity={0.7} />
      <path d={d.mascara} fill={`url(#${I('masc')})`} />
      <path d={d.sombraMascara} fill="#000" opacity={0.12} />
      <path d={d.orbitas} fill="#7c7b79" opacity={0.45} />
      <path d={d.orbBoca} fill="#7c7b79" opacity={0.35} />
      <path d={d.olhos} fill="#060607" />
      <path d={d.boca} fill="#060607" />
      <path d={d.nariz} fill="#9a9996" opacity={0.6} />
      {/* letreiro: contorno escuro, contorno laranja, branco */}
      <path d={d.logo} fill="#fff" stroke="#111" strokeWidth={10} strokeLinejoin="round" />
      <path d={d.logo} fill="#fff" stroke="#ff7a00" strokeWidth={6} strokeLinejoin="round" style={{ paintOrder: 'stroke' }} />
      <path d={d.folha} fill={`url(#${I('folha')})`} stroke="#111" strokeWidth={1.2} />
      <path d={d.nervura} fill="none" stroke="#1d6a26" strokeWidth={1} />
      <path d={d.ghost} fill={`url(#${I('ponche')})`} stroke="#000" strokeWidth={3} style={{ paintOrder: 'stroke' }} />
      <path d={d.punch} fill={`url(#${I('ponche')})`} stroke="#000" strokeWidth={3} style={{ paintOrder: 'stroke' }} />
    </Lata>
  )
}

// ———————————————————————— Coca-Cola Vanilla ————————————————————————

const coca = uma(() => {
  const c = C350
  const N = 60
  const topo: string[] = []
  const baixo: string[] = []
  const creme: string[] = []
  for (let k = 0; k <= N; k++) {
    const u = -175 + (350 * k) / N
    const vt = 356 + 11 * Math.sin(u / 58 + 0.4)
    const esp = 1.6 + 9 * Math.exp(-(((u - 10) / 85) ** 2))
    topo.push(`${u.toFixed(1)} ${vt.toFixed(1)}`)
    baixo.unshift(`${u.toFixed(1)} ${(vt + esp).toFixed(1)}`)
    creme.push(`${u.toFixed(1)} ${(vt + esp + 7 + 4 * Math.sin(u / 40)).toFixed(1)}`)
  }
  const onda = 'M' + topo.join('L') + 'L' + baixo.join('L') + 'Z'
  const faixa = 'M' + creme.join('L') + 'L175 472L-175 472Z'
  // flor de baunilha (orquídea): 5 pétalas + labelo
  let petalas = ''
  for (const [a, l] of [[-90, 30], [-18, 27], [54, 28], [126, 28], [198, 27]] as const) {
    petalas += transformarD(`M0 0C6-6 8-${l * 0.7} 0-${l}C-8-${l * 0.7}-6-6 0 0Z`, mat(0, 0, 1, a + 90))
  }
  const F = mat(66, 398, 0.8, 8)
  return {
    onda: c.enrolar(onda),
    faixa: c.enrolar(faixa),
    filete: c.enrolar('M-175 470L175 470L175 473L-175 473Z'),
    logo: palavra(c, 'coca', { u: 0, v: 326, larg: 236 }),
    vanilla: palavra(c, 'vanilla', { u: -14, v: 452, larg: 150 }),
    vagem: c.enrolar('M-50 26C-15 16 20 6 52-14C54-12 54-10 52-8C22 12-14 22-50 30Z', mat(70, 400, 0.9, 6)),
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
    <Lata id={id} c={c} cfg={{ fundo: '#d8101c', recorte: '#ffe3e3' }}>
      <defs>
        <linearGradient id={I('creme')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbf1d8" />
          <stop offset="1" stopColor="#ecd9ae" />
        </linearGradient>
        <radialGradient id={I('pet')} cx="0.5" cy="0.5" r="0.6">
          <stop offset="0" stopColor="#f3c84f" />
          <stop offset="0.35" stopColor="#fbe7a6" />
          <stop offset="1" stopColor="#fff8e2" />
        </radialGradient>
      </defs>
      <path d={d.onda} fill="#fff" />
      <path d={d.faixa} fill={`url(#${I('creme')})`} />
      <path d={d.filete} fill="#b48a3c" opacity={0.7} />
      <path d={d.vagem} fill="#4a2a17" />
      <path d={d.petalas} fill={`url(#${I('pet')})`} stroke="#c9a24a" strokeWidth={0.6} />
      <path d={d.labelo} fill="#f6d36b" />
      <path d={d.garganta} fill="#e0952a" />
      <path d={d.vanilla} fill="#b5101c" />
      <path d={d.logo} fill="#fff" />
      <TextoArco id={I('ml')} c={c} v={514} meia={80} tam={10} cor="#fff" espaco={1.2}>
        12 FL OZ · 355 mL
      </TextoArco>
    </Lata>
  )
}

// ———————————————————————— Dr Pepper ————————————————————————

const drpepper = uma(() => {
  const c = C350
  return {
    fita: c.enrolar('M-180 400C-80 380 40 340 180 312L180 372C40 396-80 432-180 452Z'),
    filete1: c.enrolar('M-180 398C-80 378 40 338 180 310L180 313C40 341-80 381-180 401Z'),
    filete2: c.enrolar('M-180 451C-80 431 40 395 180 371L180 374C40 398-80 434-180 454Z'),
    sombra: palavra(c, 'drpepper', { u: 2.5, v: 384, larg: 232, rot: -8 }),
    logo: palavra(c, 'drpepper', { u: 0, v: 381, larg: 232, rot: -8 }),
    listra1: c.enrolar('M-180 236L180 236L180 238.5L-180 238.5Z'),
    listra2: c.enrolar('M-180 242L180 242L180 243.2L-180 243.2Z'),
    listra3: c.enrolar('M-180 506L180 506L180 507.2L-180 507.2Z'),
    listra4: c.enrolar('M-180 510.5L180 510.5L180 513L-180 513Z'),
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
      <path d={d.fita} fill="#86202f" opacity={0.75} />
      <path d={d.filete1} fill={`url(#${I('prata')})`} />
      <path d={d.filete2} fill={`url(#${I('prata')})`} />
      <path d={d.listra1 + d.listra2 + d.listra3 + d.listra4} fill={`url(#${I('prata')})`} />
      <path d={d.sombra} fill="#2a0309" opacity={0.6} />
      <path d={d.logo} fill="#fff" />
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
  ]
  const brotos: readonly (readonly [number, number])[] = [[-70, 190], [10, 170], [56, 198], [150, 170], [-100, 236], [126, 520], [86, 512]]
  return {
    galho1: c.enrolar(galhos[0]) + c.enrolar(galhos[5]),
    galho2: galhos.filter((_, i) => i !== 0 && i !== 5).map((g) => c.enrolar(g)).join(''),
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
    <Lata id={id} c={c} cfg={{ fundo: '#93d4bd', pescoco: '#7cc7ab', recorte: '#f2fff9' }}>
      <defs>
        <linearGradient id={I('fundo')} gradientUnits="userSpaceOnUse" x1="0" y1={c.y0} x2="0" y2={c.vBase}>
          <stop offset="0" stopColor="#a9e0cd" />
          <stop offset="0.5" stopColor="#93d4bd" />
          <stop offset="1" stopColor="#79c3a7" />
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
