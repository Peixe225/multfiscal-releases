// Piteira de vidro RAW — duas piteiras de borossilicato transparente lado a lado, em diagonal (subindo para a direita,
// como os livretos do grupo "papel"): a slim (redonda, 7 mm × 5 cm, mais longa e fina) atrás e a flat (achatada,
// 6 mm × 3,5 cm, mais curta e larga, com a face larga e a lateral fina visíveis) na frente.
// Vidro sobre o preto: quase tudo transparente; quem desenha o volume são as bordas acesas, a parede grossa (linhas do
// furo por refração), os reflexos especulares compridos e a boca da ponta de cima (anel de vidro polido + furo escuro).
// "RAW" serigrafado em branco ao longo do tubo, enrolado na curva.
import type { PropsArte } from './comum'
import { PALAVRAS } from './acessorios-glifos'
import { palavra, r1 } from './acessorios-base'

/* ----------------------------------------------------------------- slim (redonda) */
const S = { cx: 140, cy: 300, ang: -61, L: 452, r: 31, e: 0.42, furo: 0.56 }
/* ----------------------------------------------------------------- flat (achatada) */
const F = { cx: 238, cy: 398, ang: -55, L: 306, face: 33, lado: 13, e: 11 }
// a flat ocupa y de -F.face (borda de cima da face) até F.face (aresta face/lado) e o lado até F.face + F.lado

// "RAW" enrolado no tubo redondo: u ao longo do eixo, v (altura da letra) vira r·sen(v/r)
const RAW_SLIM = palavra(PALAVRAS.raw, { u: -S.L / 2 + 52, v: 0, h: 27, ancora: 'inicio', meioV: true }, (u, v) => [
  u,
  S.r * 0.97 * Math.sin(v / (S.r * 0.97)),
])
// "RAW" na face larga da flat (plana: só um leve aperto perto das bordas)
const RAW_FLAT = palavra(PALAVRAS.raw, { u: -F.L / 2 + 40, v: -2, h: 30, ancora: 'inicio', meioV: true }, (u, v) => [
  u,
  v,
])

/** Silhueta de um tubo deitado no eixo x (de -L/2 a L/2), meia-largura r, tampas elípticas de raio horizontal er. */
function tubo(L: number, yt: number, yb: number, er: number) {
  const ry = (yb - yt) / 2
  return `M${-L / 2} ${yt}L${L / 2} ${yt}A${er} ${ry} 0 0 1 ${L / 2} ${yb}L${-L / 2} ${yb}A${er} ${ry} 0 0 1 ${-L / 2} ${yt}Z`
}

export function Piteira({ id }: PropsArte) {
  const u = (s: string) => `${id}-${s}`
  const ri = S.r * S.furo
  const erS = S.r * S.e
  // gradiente ao longo do comprimento para os reflexos (somem nas pontas)
  const aoLongo = (nome: string, L: number, a: number) => (
    <linearGradient id={u(nome)} gradientUnits="userSpaceOnUse" x1={-L / 2} y1="0" x2={L / 2} y2="0">
      <stop offset="0" stopColor="#fff" stopOpacity="0" />
      <stop offset="0.12" stopColor="#fff" stopOpacity={a * 0.55} />
      <stop offset="0.55" stopColor="#fff" stopOpacity={a * 0.8} />
      <stop offset="0.9" stopColor="#fff" stopOpacity={a} />
      <stop offset="1" stopColor="#fff" stopOpacity="0" />
    </linearGradient>
  )
  return (
    <g>
      <defs>
        {/* parede de vidro vista de lado: borda acesa, miolo quase invisível, borda do furo de novo clara */}
        <linearGradient id={u('paredeS')} gradientUnits="userSpaceOnUse" x1="0" y1={-S.r} x2="0" y2={S.r}>
          <stop offset="0" stopColor="#dff6fb" stopOpacity="0.62" />
          <stop offset="0.05" stopColor="#9fd6e3" stopOpacity="0.3" />
          <stop offset="0.14" stopColor="#7fbfcf" stopOpacity="0.14" />
          <stop offset={(1 - S.furo) / 2 - 0.01} stopColor="#bfe6ee" stopOpacity="0.28" />
          <stop offset={(1 - S.furo) / 2 + 0.02} stopColor="#bfe6ee" stopOpacity="0.04" />
          <stop offset="0.5" stopColor="#bfe6ee" stopOpacity="0.02" />
          <stop offset={(1 + S.furo) / 2 - 0.02} stopColor="#bfe6ee" stopOpacity="0.05" />
          <stop offset={(1 + S.furo) / 2 + 0.01} stopColor="#bfe6ee" stopOpacity="0.24" />
          <stop offset="0.86" stopColor="#7fbfcf" stopOpacity="0.16" />
          <stop offset="0.95" stopColor="#9fd6e3" stopOpacity="0.34" />
          <stop offset="1" stopColor="#dff6fb" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id={u('paredeF')} gradientUnits="userSpaceOnUse" x1="0" y1={-F.face} x2="0" y2={F.face + F.lado}>
          <stop offset="0" stopColor="#e6f8fc" stopOpacity="0.62" />
          <stop offset="0.05" stopColor="#9fd6e3" stopOpacity="0.28" />
          <stop offset="0.13" stopColor="#bfe6ee" stopOpacity="0.2" />
          <stop offset="0.16" stopColor="#bfe6ee" stopOpacity="0.05" />
          <stop offset="0.5" stopColor="#bfe6ee" stopOpacity="0.03" />
          <stop offset="0.66" stopColor="#bfe6ee" stopOpacity="0.05" />
          <stop offset="0.7" stopColor="#bfe6ee" stopOpacity="0.2" />
          <stop offset="0.8" stopColor="#9fd6e3" stopOpacity="0.16" />
          {/* lateral fina e arredondada: cilindro estreito */}
          <stop offset="0.835" stopColor="#e9fbff" stopOpacity="0.55" />
          <stop offset="0.88" stopColor="#7fbfcf" stopOpacity="0.22" />
          <stop offset="0.95" stopColor="#9fd6e3" stopOpacity="0.32" />
          <stop offset="1" stopColor="#dff6fb" stopOpacity="0.6" />
        </linearGradient>
        {aoLongo('brilhoS', S.L, 0.95)}
        {aoLongo('brilhoF', F.L, 0.9)}
        {aoLongo('brilhoFraco', S.L, 0.4)}
        {/* boca: anel de vidro polido, aceso em cima à esquerda */}
        <linearGradient id={u('anel')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2fcff" stopOpacity="0.95" />
          <stop offset="0.45" stopColor="#a9dbe7" stopOpacity="0.55" />
          <stop offset="1" stopColor="#5d9fb0" stopOpacity="0.6" />
        </linearGradient>
        <radialGradient id={u('furo')} cx="0.45" cy="0.45" r="0.6">
          <stop offset="0" stopColor="#000" stopOpacity="0.95" />
          <stop offset="0.75" stopColor="#02090b" stopOpacity="0.9" />
          <stop offset="1" stopColor="#3f7f8f" stopOpacity="0.7" />
        </radialGradient>
      </defs>

      {/* ============================== SLIM ============================== */}
      <g transform={`translate(${S.cx} ${S.cy}) rotate(${S.ang})`}>
        {/* ponta de baixo (longe): anel visto através do vidro */}
        <ellipse cx={-S.L / 2} cy="0" rx={erS} ry={S.r} fill="#bfe6ee" fillOpacity="0.05" stroke="#c9eef5" strokeWidth="1" strokeOpacity="0.35" />
        <ellipse cx={-S.L / 2} cy="0" rx={erS * S.furo} ry={ri} fill="none" stroke="#c9eef5" strokeWidth="0.9" strokeOpacity="0.3" />
        {/* corpo */}
        <path d={tubo(S.L, -S.r, S.r, erS)} fill={`url(#${u('paredeS')})`} />
        {/* bordas do furo (refração da parede grossa) */}
        <path d={`M${-S.L / 2} ${-ri}L${S.L / 2} ${-ri}M${-S.L / 2} ${ri}L${S.L / 2} ${ri}`} stroke="#d4f3f9" strokeWidth="0.9" strokeOpacity="0.4" />
        {/* contorno aceso (vidro sobre preto) */}
        <path d={`M${-S.L / 2} ${-S.r}L${S.L / 2} ${-S.r}`} stroke="#f1fcff" strokeWidth="1.6" strokeOpacity="0.85" />
        <path d={`M${-S.L / 2} ${S.r}L${S.L / 2} ${S.r}`} stroke="#c6eef6" strokeWidth="1.2" strokeOpacity="0.6" />
        <path d={`M${-S.L / 2} ${-S.r}A${erS} ${S.r} 0 0 0 ${-S.L / 2} ${S.r}`} fill="none" stroke="#d9f5fa" strokeWidth="1.3" strokeOpacity="0.7" />
        {/* serigrafia */}
        <path d={RAW_SLIM} fill="#fff" opacity="0.92" />
        {/* reflexos especulares compridos */}
        <rect x={-S.L / 2 + 10} y={-S.r * 0.8} width={S.L - 24} height={S.r * 0.15} rx={S.r * 0.075} fill={`url(#${u('brilhoS')})`} />
        <rect x={-S.L / 2 + 30} y={-S.r * 0.46} width={S.L - 70} height={S.r * 0.06} rx="1" fill={`url(#${u('brilhoFraco')})`} />
        <rect x={-S.L / 2 + 16} y={S.r * 0.66} width={S.L - 40} height={S.r * 0.09} rx="1.4" fill={`url(#${u('brilhoFraco')})`} />
        {/* boca (ponta de cima, perto) */}
        <ellipse cx={S.L / 2} cy="0" rx={erS} ry={S.r} fill={`url(#${u('anel')})`} />
        <ellipse cx={S.L / 2 + 0.6} cy="0" rx={erS * S.furo} ry={ri} fill={`url(#${u('furo')})`} />
        <path d={`M${S.L / 2 - erS * 0.55} ${-S.r * 0.83}A${erS} ${S.r} 0 0 0 ${S.L / 2 - erS * 0.98} ${S.r * 0.2}`} fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity="0.9" />
        <ellipse cx={S.L / 2} cy="0" rx={erS} ry={S.r} fill="none" stroke="#effbff" strokeWidth="1" strokeOpacity="0.8" />
      </g>

      {/* ============================== FLAT ============================== */}
      <g transform={`translate(${F.cx} ${F.cy}) rotate(${F.ang})`}>
        {/* ponta longe */}
        <rect x={-F.L / 2 - F.e} y={-F.face} width={F.e * 2} height={F.face * 2 + F.lado} rx={F.e} fill="#bfe6ee" fillOpacity="0.05" stroke="#c9eef5" strokeWidth="1" strokeOpacity="0.32" />
        <rect x={-F.L / 2 - 4} y={-F.face + 9} width="8" height={F.face * 2 + F.lado - 18} rx="4" fill="none" stroke="#c9eef5" strokeWidth="0.9" strokeOpacity="0.28" />
        {/* corpo */}
        <path d={tubo(F.L, -F.face, F.face + F.lado, F.e)} fill={`url(#${u('paredeF')})`} />
        {/* canal achatado por dentro + aresta entre a face larga e a lateral */}
        <path d={`M${-F.L / 2} ${-F.face + 9}L${F.L / 2} ${-F.face + 9}M${-F.L / 2} ${F.face - 7}L${F.L / 2} ${F.face - 7}`} stroke="#d4f3f9" strokeWidth="0.9" strokeOpacity="0.38" />
        <path d={`M${-F.L / 2} ${F.face + 1}L${F.L / 2} ${F.face + 1}`} stroke="#effcff" strokeWidth="1.1" strokeOpacity="0.55" />
        {/* contorno aceso */}
        <path d={`M${-F.L / 2} ${-F.face}L${F.L / 2} ${-F.face}`} stroke="#f1fcff" strokeWidth="1.6" strokeOpacity="0.88" />
        <path d={`M${-F.L / 2} ${F.face + F.lado}L${F.L / 2} ${F.face + F.lado}`} stroke="#c6eef6" strokeWidth="1.2" strokeOpacity="0.6" />
        <path d={`M${-F.L / 2} ${-F.face}A${F.e} ${(F.face * 2 + F.lado) / 2} 0 0 0 ${-F.L / 2} ${F.face + F.lado}`} fill="none" stroke="#d9f5fa" strokeWidth="1.3" strokeOpacity="0.7" />
        {/* serigrafia na face larga */}
        <path d={RAW_FLAT} fill="#fff" opacity="0.93" />
        {/* reflexo largo e macio da face plana + fio duro na borda de cima */}
        <rect x={-F.L / 2 + 14} y={-F.face + 3} width={F.L - 34} height="15" rx="2" fill={`url(#${u('brilhoF')})`} opacity="0.16" />
        <rect x={-F.L / 2 + 8} y={-F.face + 2.2} width={F.L - 20} height="3.2" rx="1.6" fill={`url(#${u('brilhoF')})`} />
        <rect x={-F.L / 2 + 20} y={F.face + 4.5} width={F.L - 46} height="2.4" rx="1.2" fill={`url(#${u('brilhoF')})`} opacity="0.55" />
        {/* boca achatada: anel em "estádio" com fenda escura */}
        <rect x={F.L / 2 - F.e} y={-F.face} width={F.e * 2} height={F.face * 2 + F.lado} rx={F.e} fill={`url(#${u('anel')})`} />
        <rect x={F.L / 2 - 4.2} y={-F.face + 9} width="9" height={F.face * 2 + F.lado - 18} rx="4.5" fill={`url(#${u('furo')})`} />
        <path d={`M${F.L / 2 - 4} ${-F.face + 4}Q${F.L / 2 - F.e + 1} ${-F.face + 6} ${F.L / 2 - F.e + 1.5} ${-F.face + 20}`} fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />
        <rect x={F.L / 2 - F.e} y={-F.face} width={F.e * 2} height={F.face * 2 + F.lado} rx={F.e} fill="none" stroke="#effbff" strokeWidth="1" strokeOpacity="0.8" />
      </g>
    </g>
  )
}

void r1
