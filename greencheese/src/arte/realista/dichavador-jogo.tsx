// Dichavador do "Teste minha sorte". Duas vistas do mesmo objeto:
// 1) TAMPA VISTA DE CIMA (viewBox 0 0 340 340, centro 170, raio 160), em 3 camadas HTML empilhadas:
//    Fundo (sombra e chanfro, parado) · Rotor (o que gira: recartilhado de 72 dentes, logo gravado, texto em anel e o
//    entalhe branco) · Estatico (luz parada: anéis de torno, brilho em gravata e o brilho do chanfro). Gira-se o DIV do
//    rotor, nunca um atributo do SVG; a luz fica parada enquanto a gravação passa por baixo. A assimetria (logo, texto
//    que cobre só parte do anel, entalhe) é obrigatória: um disco simétrico girando parece parado.
// 2) CORPO ABERTO EM 3/4, nas coordenadas de acessorios-dichavador (a vitrine), cortado no quadro do jogo:
//    LadoTampa (a lateral recartilhada da tampa, que sai junto com ela) · CorpoAberto (a boca da câmara, vazia: o preto
//    de dentro dela vira o story do prêmio) · LabioCamara (a frente da borda e as laterais, por cima da boca). A largura
//    do corpo (2R) é igual ao diâmetro do disco, e o centro da tampa deitada cai no Y0.
// Só gradientes e formas (sem filtro, sem mix-blend), caminhos calculados uma vez no módulo.
import { LOGO_CUIA, LOGO_LAMINAS, LOGO_TEXTO } from '../logo-paths'
import { ANEL, CAMARA, COLETOR, CX, FUNDO, K, METAL, OURO, PENEIRA, R, RISCOS, Y0, arco, cunha, faixa } from './acessorios-dichavador'
import { r1 } from './acessorios-base'
import { FONTE } from './comum'

/* ───────────────────────── tampa vista de cima ───────────────────────── */

const C = 170
const RO = 160 // borda de fora do recartilhado
const RI = 146 // borda de dentro (começo da face lisa)
const DENTES = 72

const polar = (r: number, grau: number) => {
  const a = (grau * Math.PI) / 180
  return `${r1(C + r * Math.cos(a))} ${r1(C + r * Math.sin(a))}`
}

/** Sulcos escuros (trapézios) e cristas claras do recartilhado: 72 dentes de ~5 px no celular (não cintilam). */
const RECARTILHADO = (() => {
  let sulcos = ''
  let cristas = ''
  const passo = 360 / DENTES
  for (let i = 0; i < DENTES; i++) {
    const a = i * passo
    sulcos += `M${polar(RI + 0.5, a - 1.05)}L${polar(RO, a - 1.45)}L${polar(RO, a + 1.45)}L${polar(RI + 0.5, a + 1.05)}Z`
    const m = a + passo / 2
    cristas += `M${polar(RI + 1.5, m)}L${polar(RO - 1, m)}`
  }
  return { sulcos, cristas }
})()

/** Anéis de torno (finos, parados). */
const TORNO = (() => {
  let claro = ''
  let escuro = ''
  for (let r = 18, i = 0; r < RI - 2; r += 5.2, i++) {
    const d = `M${C - r} ${C}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`
    if (i % 3 === 0) escuro += d
    else if (i % 3 === 1) claro += d
  }
  return { claro, escuro }
})()

/** Coroa (anel entre RI e RO), para a luz parada por cima do recartilhado. */
const COROA = `M${C - RO} ${C}a${RO} ${RO} 0 1 0 ${2 * RO} 0a${RO} ${RO} 0 1 0 ${-2 * RO} 0ZM${C - RI} ${C}a${RI} ${RI} 0 1 1 ${2 * RI} 0a${RI} ${RI} 0 1 1 ${-2 * RI} 0Z`

/** Fundo da tampa: sombra e chanfro de fora. Parado, atrás do rotor. */
export function FundoTampa({ id }: { id: string }) {
  return (
    <svg viewBox="0 0 340 340" width="100%" height="100%" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${id}-sombra`} cx="0.5" cy="0.52" r="0.5">
          <stop offset="0.86" stopColor="#000" stopOpacity="0.7" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={C} cy={C + 4} r={170} fill={`url(#${id}-sombra)`} />
      <circle cx={C} cy={C} r={RO + 1.2} fill="#0c0f12" />
      <circle cx={C} cy={C} r={RO + 1.6} fill="none" stroke="#56606a" strokeWidth="0.8" opacity="0.8" />
    </svg>
  )
}

/** O que gira: recartilhado, face lisa, logo gravado, texto em anel e o entalhe. */
export function Rotor({ id }: { id: string }) {
  const u = (s: string) => `${id}-${s}`
  return (
    <svg viewBox="0 0 340 340" width="100%" height="100%" aria-hidden="true" focusable="false">
      <defs>
        {/* face lisa: gradiente radial centrado (não muda ao girar) com as paradas do alumínio */}
        <radialGradient id={u('face')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#c3ccd5" />
          <stop offset="0.35" stopColor="#aab5c0" />
          <stop offset="0.62" stopColor="#9aa6b2" />
          <stop offset="0.8" stopColor={METAL[6].c} />
          <stop offset="0.93" stopColor={METAL[7].c} />
          <stop offset="1" stopColor={METAL[9].c} />
        </radialGradient>
        <path id={u('anelTxt')} d={`M${C - 120} ${C}a120 120 0 1 1 240 0a120 120 0 1 1 -240 0`} />
      </defs>
      {/* recartilhado */}
      <circle cx={C} cy={C} r={RO} fill="#7f8b97" />
      <path d={RECARTILHADO.sulcos} fill="#1b2128" />
      <path d={RECARTILHADO.cristas} stroke="#e6edf2" strokeWidth="2" opacity="0.55" fill="none" />
      {/* entalhe branco (marca a posição: no fim, para alinhado com o indicador) */}
      <path d={`M${polar(RI - 1, -92.4)}L${polar(RO + 0.5, -92.6)}L${polar(RO + 0.5, -87.4)}L${polar(RI - 1, -87.6)}Z`} fill="#fff" />
      {/* face lisa e o degrau entre ela e o recartilhado */}
      <circle cx={C} cy={C} r={RI} fill={`url(#${u('face')})`} />
      <circle cx={C} cy={C} r={RI} fill="none" stroke="#2a3138" strokeWidth="2" />
      <circle cx={C} cy={C} r={RI - 1.6} fill="none" stroke="#eef3f7" strokeWidth="0.8" opacity="0.5" />
      {/* gravação a laser: cópia branca 1 px abaixo (a borda que pega luz) e o traço escuro por cima */}
      <g transform={`translate(${C - 70} ${C - 72}) scale(${140 / 512})`}>
        <g transform="translate(0 4.5)" fill="#fff" opacity="0.25">
          <path d={LOGO_CUIA} />
          <path d={LOGO_TEXTO.green} />
          <path d={LOGO_TEXTO.cheese} />
          <path d={LOGO_LAMINAS.a} />
          <path d={LOGO_LAMINAS.b} />
        </g>
        <g fill="#3a444f" opacity="0.55">
          <path d={LOGO_CUIA} />
          <path d={LOGO_TEXTO.green} />
          <path d={LOGO_TEXTO.cheese} />
          <path d={LOGO_LAMINAS.a} />
          <path d={LOGO_LAMINAS.b} />
        </g>
      </g>
      {/* texto em anel: cobre só parte da volta (a assimetria mostra o giro) */}
      <g fontFamily={FONTE.sans} fontSize="11.5" fontWeight="700" letterSpacing="2.4">
        <text fill="#fff" opacity="0.25" transform="translate(0 1.2)">
          <textPath href={`#${u('anelTxt')}`}>GREEN CHEESE IMPORTS · RJ · MG · SP · ES · SC ·</textPath>
        </text>
        <text fill="#3a444f" opacity="0.6">
          <textPath href={`#${u('anelTxt')}`}>GREEN CHEESE IMPORTS · RJ · MG · SP · ES · SC ·</textPath>
        </text>
      </g>
      <circle cx={C} cy={C} r="5" fill="#5f6b77" opacity="0.5" />
    </svg>
  )
}

/** Luz parada por cima do rotor: anéis de torno, brilho em gravata e o brilho do chanfro. */
export function Estatico({ id }: { id: string }) {
  const u = (s: string) => `${id}-${s}`
  return (
    <svg viewBox="0 0 340 340" width="100%" height="100%" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={u('coroa')} x1="0.15" y1="0.1" x2="0.85" y2="0.9">
          <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
          <stop offset="0.42" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.62" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.45" />
        </linearGradient>
        <radialGradient id={u('gravata')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.35" />
        </radialGradient>
      </defs>
      <g fill="none" strokeWidth="1">
        <path d={TORNO.claro} stroke="#fff" opacity="0.12" />
        <path d={TORNO.escuro} stroke="#1b232b" opacity="0.12" />
      </g>
      <g transform={`translate(${C} ${C})`} fill={`url(#${u('gravata')})`}>
        <path d={cunha(-128, 16, RI)} opacity="0.1" />
        <path d={cunha(-128, 8, RI)} opacity="0.14" />
        <path d={cunha(-128, 3, RI)} opacity="0.18" />
        <path d={cunha(52, 14, RI)} opacity="0.06" />
        <path d={cunha(52, 6, RI)} opacity="0.1" />
      </g>
      <path d={COROA} fill={`url(#${u('coroa')})`} fillRule="evenodd" />
      <path d={`M${polar(RO - 0.6, 196)}A${RO - 0.6} ${RO - 0.6} 0 0 1 ${polar(RO - 0.6, 296)}`} fill="none" stroke="#f4f8fb" strokeWidth="1.4" opacity="0.6" />
    </svg>
  )
}

/* ───────────────────────── corpo em 3/4 (coordenadas da vitrine) ───────────────────────── */

/**
 * Quadro do corpo nas coordenadas de acessorios-dichavador: 2R ocupa 320/340 da largura (o diâmetro do disco) e o Y0
 * cai a 32% da largura a partir do topo (onde a tampa deitada para: centro do disco − 18%).
 */
const CORPO_W = (340 * R) / 160
const CORPO_X = CX - CORPO_W / 2
const CORPO_Y = Y0 - 0.32 * CORPO_W
const CORPO_H = FUNDO.yb + (COLETOR.r - 9) * K + 6 - CORPO_Y
export const VIEWBOX_CORPO = `${r1(CORPO_X)} ${r1(CORPO_Y)} ${r1(CORPO_W)} ${r1(CORPO_H)}`
/** Altura do quadro do corpo em relação à largura do disco. */
export const PROPORCAO_CORPO = CORPO_H / CORPO_W
/**
 * Centro da boca da câmara (fração da largura do disco, a partir do canto de cima à esquerda do quadro), o raio de
 * baixo da borda (ry) e os raios do buraco escuro de dentro (rxBuraco, ryBuraco): é dele que o story do prêmio nasce.
 */
export const BOCA = {
  x: 0.5,
  y: (CAMARA.yt - CORPO_Y) / CORPO_W,
  ry: (CAMARA.r * K) / CORPO_W,
  rxBuraco: (CAMARA.r - 10) / CORPO_W,
  ryBuraco: ((CAMARA.r - 10) * K) / CORPO_W,
}

const TOPO_TAMPA = { yt: Y0, yb: Y0 + 84 }

/** Cristas verticais do recartilhado da lateral da tampa (meia-volta da frente). */
const CRISTAS_LADO = (() => {
  let esc = ''
  let clara = ''
  const n = 84
  for (let i = 0; i < n; i++) {
    for (const [fase, alvo] of [
      [0, 'e'],
      [0.45, 'c'],
    ] as const) {
      const a = Math.PI - ((i + fase) / n) * Math.PI
      const x = CX + R * Math.cos(a) * 0.995
      const dy = R * K * Math.sin(a)
      const d = `M${r1(x)} ${r1(TOPO_TAMPA.yt + 14 + dy)}L${r1(x)} ${r1(TOPO_TAMPA.yb - 5 + dy)}`
      if (alvo === 'e') esc += d
      else clara += d
    }
  }
  return { esc, clara }
})()

function GradMetal({ id, paradas = METAL }: { id: string; paradas?: { o: number; c: string }[] }) {
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={CX - R} y1={0} x2={CX + R} y2={0}>
      {paradas.map((p, i) => (
        <stop key={i} offset={p.o} stopColor={p.c} />
      ))}
    </linearGradient>
  )
}

/** Lateral recartilhada da tampa em 3/4: fica embaixo do disco deitado e sai junto com ele. */
export function LadoTampa({ id }: { id: string }) {
  const u = (s: string) => `${id}-${s}`
  return (
    <svg viewBox={VIEWBOX_CORPO} width="100%" height="100%" aria-hidden="true" focusable="false" overflow="visible">
      <defs>
        <GradMetal id={u('metal')} />
        <linearGradient id={u('cr')} gradientUnits="userSpaceOnUse" x1={CX - R} y1={0} x2={CX + R} y2={0}>
          <stop offset="0" stopColor="#fff" stopOpacity="0.05" />
          <stop offset="0.24" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.75" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="0.96" stopColor="#fff" stopOpacity="0.4" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={faixa(TOPO_TAMPA.yt, TOPO_TAMPA.yb, R)} fill={`url(#${u('metal')})`} />
      <path d={CRISTAS_LADO.esc} stroke="#10151a" strokeWidth="1.5" opacity="0.62" fill="none" />
      <path d={CRISTAS_LADO.clara} stroke={`url(#${u('cr')})`} strokeWidth="1" fill="none" />
      <path d={faixa(TOPO_TAMPA.yb - 5, TOPO_TAMPA.yb, R)} fill={`url(#${u('metal')})`} />
      <path d={arco(TOPO_TAMPA.yb - 5, R)} fill="none" stroke="#fff" strokeWidth="0.8" opacity="0.35" />
      <path d={arco(TOPO_TAMPA.yb, R)} fill="none" stroke="#0c0f12" strokeWidth="2" />
    </svg>
  )
}

/** Dentes em losango no fundo da câmara (vazia). */
const LOSANGOS = (() => {
  let corpo = ''
  let luz = ''
  const fundoY = CAMARA.yt + 16
  for (const [raio, n, fase] of [
    [34, 7, 0.2],
    [70, 12, 0.5],
    [104, 16, 0.1],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const a = ((i + fase) / n) * Math.PI * 2
      const x = CX + raio * Math.cos(a)
      const y = fundoY + raio * K * Math.sin(a)
      const w = 6.5
      const h = 4.2
      corpo += `M${r1(x)} ${r1(y - h)}L${r1(x + w)} ${r1(y)}L${r1(x)} ${r1(y + h)}L${r1(x - w)} ${r1(y)}Z`
      luz += `M${r1(x - w)} ${r1(y)}L${r1(x)} ${r1(y - h)}L${r1(x + w)} ${r1(y)}`
    }
  }
  return { corpo, luz }
})()

const RB = CAMARA.r // raio de fora da borda da câmara
const RBI = CAMARA.r - 10 // raio do buraco

/** Boca da câmara (borda inteira, buraco escuro e os dentes): atrás do lábio. */
export function CorpoAberto({ id }: { id: string }) {
  const u = (s: string) => `${id}-${s}`
  const y = CAMARA.yt
  return (
    <svg viewBox={VIEWBOX_CORPO} width="100%" height="100%" aria-hidden="true" focusable="false" overflow="visible">
      <defs>
        <linearGradient id={u('borda')} x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0" stopColor="#f4f8fb" />
          <stop offset="0.35" stopColor="#c9d2da" />
          <stop offset="0.7" stopColor="#56606a" />
          <stop offset="1" stopColor="#9eabb7" />
        </linearGradient>
        <linearGradient id={u('buraco')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#05070a" />
          <stop offset="0.55" stopColor="#1a2027" />
          <stop offset="1" stopColor="#2c343d" />
        </linearGradient>
        <clipPath id={u('cb')}>
          <ellipse cx={CX} cy={y} rx={RBI} ry={RBI * K} />
        </clipPath>
      </defs>
      <ellipse cx={CX} cy={y} rx={RB} ry={RB * K} fill={`url(#${u('borda')})`} />
      <ellipse cx={CX} cy={y} rx={RBI} ry={RBI * K} fill={`url(#${u('buraco')})`} />
      <g clipPath={`url(#${u('cb')})`}>
        {/* parede de trás (sombra) e os dentes do fundo */}
        <ellipse cx={CX} cy={y + 16} rx={RBI} ry={RBI * K} fill="#262d35" opacity="0.7" />
        <path d={LOSANGOS.corpo} fill="#56606b" />
        <path d={LOSANGOS.luz} fill="none" stroke="#c3ccd5" strokeWidth="0.8" opacity="0.55" />
        <ellipse cx={CX} cy={y - 6} rx={RBI} ry={RBI * K} fill="none" stroke="#000" strokeWidth="14" opacity="0.55" />
      </g>
      <ellipse cx={CX} cy={y} rx={RBI} ry={RBI * K} fill="none" stroke="#0a0d10" strokeWidth="1.4" />
    </svg>
  )
}

/** Frente da borda da câmara e as laterais do corpo: fica por cima da boca. */
export function LabioCamara({ id }: { id: string }) {
  const u = (s: string) => `${id}-${s}`
  const y = CAMARA.yt
  const juntas = [
    { y: CAMARA.yb + 1, r: PENEIRA.r },
    { y: PENEIRA.yb + 1, r: COLETOR.r },
  ]
  return (
    <svg viewBox={VIEWBOX_CORPO} width="100%" height="100%" aria-hidden="true" focusable="false" overflow="visible">
      <defs>
        <GradMetal id={u('metal')} />
        <GradMetal id={u('ouro')} paradas={OURO} />
        <linearGradient id={u('borda')} x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0" stopColor="#f4f8fb" />
          <stop offset="0.35" stopColor="#c9d2da" />
          <stop offset="0.7" stopColor="#56606a" />
          <stop offset="1" stopColor="#9eabb7" />
        </linearGradient>
      </defs>
      {/* fundo, coletor e o anel anodizado */}
      <path d={faixa(FUNDO.yt, FUNDO.yb, COLETOR.r, COLETOR.r - 9)} fill={`url(#${u('metal')})`} />
      <path d={faixa(FUNDO.yt, FUNDO.yb, COLETOR.r, COLETOR.r - 9)} fill="#000" opacity="0.35" />
      <path d={faixa(COLETOR.yt, COLETOR.yb, COLETOR.r)} fill={`url(#${u('metal')})`} />
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
      {juntas.map((j, i) => (
        <g key={i} fill="none">
          <path d={arco(j.y + 3, j.r)} stroke="#000" strokeWidth="5" opacity="0.28" />
          <path d={arco(j.y, j.r + 0.5)} stroke="#0c0f12" strokeWidth="2.6" />
          <path d={arco(j.y + 1.9, j.r)} stroke="#e8eef3" strokeWidth="0.8" opacity="0.55" />
        </g>
      ))}
      {/* a meia-elipse da frente da borda (o lábio) */}
      <path d={`M${CX - RB} ${y}A${RB} ${RB * K} 0 0 0 ${CX + RB} ${y}L${CX + RBI} ${y}A${RBI} ${RBI * K} 0 0 1 ${CX - RBI} ${y}Z`} fill={`url(#${u('borda')})`} />
      <path d={arco(y, RBI)} fill="none" stroke="#0a0d10" strokeWidth="1.4" />
      <path d={arco(y + 0.8, RB)} fill="none" stroke="#e9f0f6" strokeWidth="1" opacity="0.6" />
    </svg>
  )
}
