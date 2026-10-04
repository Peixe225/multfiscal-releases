// Dichavador de metal 4 partes, 55 mm — alumínio escovado cinza-azulado em 3/4 (topo elíptico), tampa recartilhada,
// 4 seções com linhas de junção e um anel anodizado colorido no coletor. Produto de exemplo (sem marca).
import type { PropsArte } from './comum'
import { FONTE } from './comum'
import { r1 } from './acessorios-base'

const CX = 180
const R = 146
const K = 0.37 // achatamento das elipses (ry / rx)
const Y0 = 168 // centro da face de cima da tampa

/** Faixa lateral de um cilindro entre yt e yb (raios r1 em cima e r2 embaixo, para chanfros). */
function faixa(yt: number, yb: number, ra: number, rb = ra) {
  return (
    `M${r1(CX - ra)} ${r1(yt)}A${r1(ra)} ${r1(ra * K)} 0 0 0 ${r1(CX + ra)} ${r1(yt)}` +
    `L${r1(CX + rb)} ${r1(yb)}A${r1(rb)} ${r1(rb * K)} 0 0 1 ${r1(CX - rb)} ${r1(yb)}Z`
  )
}
/** Meia elipse da frente (linha de junção). */
const arco = (y: number, r: number) => `M${r1(CX - r)} ${r1(y)}A${r1(r)} ${r1(r * K)} 0 0 0 ${r1(CX + r)} ${r1(y)}`

// Seções (y da borda de cima e de baixo, na linha central lateral) e raios
const TAMPA = { yt: Y0 + 8, yb: Y0 + 84, r: R }
const CAMARA = { yt: Y0 + 86, yb: Y0 + 156, r: R - 3 }
const PENEIRA = { yt: Y0 + 158, yb: Y0 + 226, r: R - 3 }
const COLETOR = { yt: Y0 + 228, yb: Y0 + 290, r: R - 1 }
const ANEL = { yt: Y0 + 232, yb: Y0 + 246 }
const FUNDO = { yt: Y0 + 290, yb: Y0 + 298 }
const RT = R - 11 // raio da face de cima (dentro do chanfro)

// Recartilhado: cristas verticais distribuídas pela meia-volta da frente (adensam nas bordas, como num cilindro)
function cristas(fase: number, n = 84) {
  let d = ''
  for (let i = 0; i < n; i++) {
    const a = Math.PI - ((i + fase) / n) * Math.PI
    const x = CX + TAMPA.r * Math.cos(a) * 0.995
    const dy = TAMPA.r * K * Math.sin(a)
    d += `M${r1(x)} ${r1(TAMPA.yt + 6 + dy)}L${r1(x)} ${r1(TAMPA.yb - 5 + dy)}`
  }
  return d
}
const CRISTA_ESC = cristas(0)
const CRISTA_CLARA = cristas(0.45)

// Riscos de torno (linhas finas horizontais) nas seções lisas
function riscos(secs: { yt: number; yb: number; r: number }[], semente: number) {
  let a = semente
  const rnd = () => ((a = (a * 16807) % 2147483647) / 2147483647)
  let claro = ''
  let escuro = ''
  for (const s of secs) {
    for (let i = 0; i < 9; i++) {
      const y = s.yt + 4 + rnd() * (s.yb - s.yt - 8)
      const seg = arco(y, s.r - 0.6)
      if (rnd() < 0.55) claro += seg
      else escuro += seg
    }
  }
  return { claro, escuro }
}
const RISCOS = riscos([CAMARA, PENEIRA, { yt: COLETOR.yt + 20, yb: COLETOR.yb, r: COLETOR.r }], 7)

// Anéis concêntricos de usinagem na face de cima
const ANEIS = (() => {
  let claro = ''
  let escuro = ''
  for (let r = 14, i = 0; r < RT - 1; r += 2.6, i++) {
    const e = `M${r1(CX - r)} ${Y0}A${r1(r)} ${r1(r * K)} 0 1 0 ${r1(CX + r)} ${Y0}A${r1(r)} ${r1(r * K)} 0 1 0 ${r1(CX - r)} ${Y0}`
    if (i % 3 === 0) escuro += e
    else if (i % 3 === 1) claro += e
  }
  return { claro, escuro }
})()

/** Cunha do brilho anisotrópico (gravata) da face torneada, em coordenadas do disco (antes do achatamento). */
function cunha(ang: number, abre: number, r: number) {
  const a1 = ((ang - abre) * Math.PI) / 180
  const a2 = ((ang + abre) * Math.PI) / 180
  return `M0 0L${r1(r * Math.cos(a1))} ${r1(r * Math.sin(a1))}A${r} ${r} 0 0 1 ${r1(r * Math.cos(a2))} ${r1(r * Math.sin(a2))}Z`
}

export function Dichavador({ id }: PropsArte) {
  const u = (s: string) => `${id}-${s}`
  const metal = [
    { o: 0, c: '#232a31' },
    { o: 0.05, c: '#4d5762' },
    { o: 0.14, c: '#9aa6b2' },
    { o: 0.215, c: '#dfe6ec' },
    { o: 0.25, c: '#f6f9fb' },
    { o: 0.29, c: '#c3ccd5' },
    { o: 0.42, c: '#8b97a3' },
    { o: 0.58, c: '#6a7581' },
    { o: 0.74, c: '#38414a' },
    { o: 0.86, c: '#4f5964' },
    { o: 0.945, c: '#93a1ae' },
    { o: 0.975, c: '#c8d3dc' },
    { o: 1, c: '#2a3138' },
  ]
  const ouro = [
    { o: 0, c: '#2e1d06' },
    { o: 0.06, c: '#6b4a14' },
    { o: 0.16, c: '#c08f35' },
    { o: 0.23, c: '#f6dc96' },
    { o: 0.26, c: '#fff4cf' },
    { o: 0.3, c: '#e2b85e' },
    { o: 0.46, c: '#b07f2a' },
    { o: 0.74, c: '#4a3209' },
    { o: 0.9, c: '#7a561a' },
    { o: 0.97, c: '#d8b064' },
    { o: 1, c: '#2e1d06' },
  ]
  const grad = (nome: string, paradas: { o: number; c: string }[]) => (
    <linearGradient id={u(nome)} gradientUnits="userSpaceOnUse" x1={CX - R} y1={0} x2={CX + R} y2={0}>
      {paradas.map((p, i) => (
        <stop key={i} offset={p.o} stopColor={p.c} />
      ))}
    </linearGradient>
  )
  return (
    <g transform="rotate(-7 180 330)">
      <defs>
        {grad('metal', metal)}
        {grad('ouro', ouro)}
        {/* crista clara: mais forte na faixa do reflexo, some na sombra */}
        <linearGradient id={u('cr')} gradientUnits="userSpaceOnUse" x1={CX - R} y1={0} x2={CX + R} y2={0}>
          <stop offset="0" stopColor="#fff" stopOpacity="0.05" />
          <stop offset="0.24" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.75" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="0.96" stopColor="#fff" stopOpacity="0.4" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        {/* face de cima: luz de cima à esquerda */}
        <linearGradient id={u('topo')} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#d9e1e8" />
          <stop offset="0.45" stopColor="#a3afbb" />
          <stop offset="1" stopColor="#6b7783" />
        </linearGradient>
        <linearGradient id={u('chanfro')} x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0" stopColor="#f4f8fb" />
          <stop offset="0.35" stopColor="#c9d2da" />
          <stop offset="0.7" stopColor="#56606a" />
          <stop offset="1" stopColor="#9eabb7" />
        </linearGradient>
        <clipPath id={u('ctopo')}>
          <ellipse cx={CX} cy={Y0} rx={RT} ry={RT * K} />
        </clipPath>
        <path id={u('anelTxt')} d={`M${CX - 62} ${Y0}A62 62 0 1 1 ${CX + 62} ${Y0}A62 62 0 1 1 ${CX - 62} ${Y0}`} />
      </defs>

      {/* fundo (chanfro de baixo) e coletor */}
      <path d={faixa(FUNDO.yt, FUNDO.yb, COLETOR.r, COLETOR.r - 9)} fill={`url(#${u('metal')})`} />
      <path d={faixa(FUNDO.yt, FUNDO.yb, COLETOR.r, COLETOR.r - 9)} fill="#000" opacity="0.35" />
      <path d={faixa(COLETOR.yt, COLETOR.yb, COLETOR.r)} fill={`url(#${u('metal')})`} />
      {/* anel anodizado */}
      <path d={faixa(ANEL.yt, ANEL.yb, COLETOR.r + 0.5)} fill={`url(#${u('ouro')})`} />
      <path d={arco(ANEL.yt + 0.6, COLETOR.r + 0.5)} fill="none" stroke="#fff3c9" strokeWidth="0.9" opacity="0.7" />
      <path d={arco(ANEL.yb, COLETOR.r + 0.5)} fill="none" stroke="#1e1404" strokeWidth="1.2" opacity="0.8" />

      {/* peneira e câmara */}
      <path d={faixa(PENEIRA.yt, PENEIRA.yb, PENEIRA.r)} fill={`url(#${u('metal')})`} />
      <path d={faixa(CAMARA.yt, CAMARA.yb, CAMARA.r)} fill={`url(#${u('metal')})`} />
      <g fill="none" strokeWidth="0.7">
        <path d={RISCOS.claro} stroke="#fff" opacity="0.16" />
        <path d={RISCOS.escuro} stroke="#000" opacity="0.18" />
      </g>

      {/* juntas entre as partes: fresta escura, sombra embaixo e o fio de luz da borda da peça de baixo */}
      {[
        { y: TAMPA.yb + 1, r: CAMARA.r },
        { y: CAMARA.yb + 1, r: PENEIRA.r },
        { y: PENEIRA.yb + 1, r: COLETOR.r },
      ].map((j, i) => (
        <g key={i} fill="none">
          <path d={arco(j.y + 3, j.r)} stroke="#000" strokeWidth="5" opacity="0.28" />
          <path d={arco(j.y + 6, j.r)} stroke="#000" strokeWidth="4" opacity="0.12" />
          <path d={arco(j.y, j.r + 0.5)} stroke="#0c0f12" strokeWidth="2.6" />
          <path d={arco(j.y + 1.9, j.r)} stroke="#e8eef3" strokeWidth="0.8" opacity="0.55" />
        </g>
      ))}

      {/* tampa: lateral recartilhada */}
      <path d={faixa(TAMPA.yt, TAMPA.yb, TAMPA.r)} fill={`url(#${u('metal')})`} />
      <path d={CRISTA_ESC} stroke="#10151a" strokeWidth="1.5" opacity="0.62" fill="none" />
      <path d={CRISTA_CLARA} stroke={`url(#${u('cr')})`} strokeWidth="1" fill="none" />
      {/* faixas lisas acima e abaixo do recartilhado */}
      <path d={faixa(TAMPA.yt, TAMPA.yt + 6, TAMPA.r)} fill={`url(#${u('metal')})`} />
      <path d={faixa(TAMPA.yb - 5, TAMPA.yb, TAMPA.r)} fill={`url(#${u('metal')})`} />
      <path d={arco(TAMPA.yt + 6, TAMPA.r)} fill="none" stroke="#000" strokeWidth="1" opacity="0.35" />
      <path d={arco(TAMPA.yb - 5, TAMPA.r)} fill="none" stroke="#fff" strokeWidth="0.8" opacity="0.35" />

      {/* chanfro e face de cima */}
      <path
        d={`M${CX - R} ${TAMPA.yt}A${R} ${R * K} 0 1 1 ${CX + R} ${TAMPA.yt}A${R} ${R * K} 0 1 1 ${CX - R} ${TAMPA.yt}Z`}
        fill={`url(#${u('chanfro')})`}
      />
      <ellipse cx={CX} cy={Y0} rx={RT} ry={RT * K} fill={`url(#${u('topo')})`} />
      <g clipPath={`url(#${u('ctopo')})`}>
        <g fill="none" strokeWidth="1">
          <path d={ANEIS.claro} stroke="#fff" opacity="0.13" />
          <path d={ANEIS.escuro} stroke="#1b232b" opacity="0.14" />
        </g>
        {/* brilho anisotrópico em gravata, típico de peça torneada */}
        <g transform={`translate(${CX} ${Y0}) scale(1 ${K})`} fill="#fff">
          <path d={cunha(-128, 16, RT + 2)} opacity="0.1" />
          <path d={cunha(-128, 8, RT + 2)} opacity="0.16" />
          <path d={cunha(-128, 3, RT + 2)} opacity="0.2" />
          <path d={cunha(52, 14, RT + 2)} opacity="0.07" />
          <path d={cunha(52, 6, RT + 2)} opacity="0.12" />
        </g>
        {/* gravação a laser no centro da tampa */}
        <g transform={`translate(${CX} ${Y0}) scale(1 ${K}) translate(${-CX} ${-Y0})`}>
          <circle cx={CX} cy={Y0} r="44" fill="none" stroke="#3c4651" strokeWidth="2.2" opacity="0.55" />
          <circle cx={CX} cy={Y0 + 1.6} r="44" fill="none" stroke="#fff" strokeWidth="1" opacity="0.25" />
          <text fontFamily={FONTE.sans} fontSize="13" fontWeight="700" letterSpacing="3.2" fill="#3a444f" opacity="0.6">
            <textPath href={`#${u('anelTxt')}`} startOffset="0">
              ALUMINIUM · 4 PIECES · 55 MM ·
            </textPath>
          </text>
          <circle cx={CX} cy={Y0} r="7" fill="#5f6b77" opacity="0.6" />
        </g>
      </g>
      {/* aresta de cima do chanfro: fio de luz */}
      <ellipse cx={CX} cy={Y0} rx={RT} ry={RT * K} fill="none" stroke="#fff" strokeWidth="1" opacity="0.5" />
      <path d={`M${CX - R} ${TAMPA.yt}A${R} ${R * K} 0 0 1 ${CX + R} ${TAMPA.yt}`} fill="none" stroke="#e9f0f6" strokeWidth="1" opacity="0.6" />
    </g>
  )
}
