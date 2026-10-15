// Jack Daniel's Tennessee Apple. A mesma garrafa quadrada do Old No. 7 (destilados-jack.tsx: vidro, uísque, chanfros,
// relevo do ombro), com o rótulo verde de moldura creme: "JACK DANIEL'S" em arco, a maçã dourada, ORIGINAL RECIPE,
// Tennessee, APPLE e os miúdos; o colarinho verde com a maçã e a tampa preta de topo dourado (como no story da loja).
import { FONTE, type PropsArte } from './comum'
import { BRANCO, CX, GarrafaJack, R, rotulo } from './destilados-jack'
import { Estrias, LG } from './destilados-base'

const CREME = '#efe4c2'
/** A maçã (centro em 0,0; uns 20 de largura): corpo de dois gomos, o cabinho e a folha. */
const MACA = 'M0-6.5C-3-9.6-10-9-10-1.8C-10 6-5.2 10.6-2.2 10.6C-1.1 10.6-0.6 10-0 10C0.6 10 1.1 10.6 2.2 10.6C5.2 10.6 10 6 10-1.8C10-9 3-9.6 0-6.5Z'
const FOLHA = 'M0.8-8.4C2.6-12.6 6.6-13.2 8.6-11.4C6.8-9 3.6-8.4 0.8-8.4Z'

function Maca({ id, x, y, s }: { id: string; x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d={MACA} fill={`url(#${id}-ouro)`} stroke="#5a3f12" strokeWidth={0.6} />
      <path d="M-6-3.5C-6.4-6.4-4.4-7.4-2.6-7" fill="none" stroke="#fff6d6" strokeOpacity={0.75} strokeWidth={1.1} strokeLinecap="round" />
      <path d="M0-6.5C0-9 0.6-10.8 1.6-12" fill="none" stroke="#5a3f12" strokeWidth={1} strokeLinecap="round" />
      <path d={FOLHA} fill="#d9be6a" stroke="#5a3f12" strokeWidth={0.5} />
    </g>
  )
}

export function JackDanielsApple({ id }: PropsArte) {
  const u = (s: string) => `${id}-${s}`
  const url = (s: string) => `url(#${u(s)})`
  const arco = `M${R.x1 + 18} 304 Q${CX} 280 ${R.x2 - 18} 304`
  return (
    <GarrafaJack
      id={id}
      v={{
        // o papel verde do rótulo (claro em cima à esquerda, onde bate a luz)
        papel: [[0, '#5a8a45'], [0.35, '#3f6d33'], [1, '#22441d']],
        defs: (
          <>
            <path id={u('arcoMarca')} d={arco} />
            <LG id={u('ouro')} x1={0} y1={0} x2={1} y2={1} p={[[0, '#fff0b8'], [0.35, '#e2bb5a'], [0.75, '#a87a26'], [1, '#6e4c14']]} />
            <LG id={u('verdeV')} p={[[0, '#10230d'], [0.1, '#25481f'], [0.24, '#5a8a45'], [0.32, '#3f6d33'], [0.6, '#2a5223'], [0.86, '#162f12'], [1, '#0a1708']]} />
            <LG id={u('topoOuro')} p={[[0, '#3a2a0a'], [0.1, '#7a5a1e'], [0.2, '#c9a24a'], [0.27, '#f5e2a0'], [0.34, '#d6b25c'], [0.55, '#9c7a30'], [0.8, '#5e4515'], [0.94, '#8a6a26'], [1, '#2a1e08']]} />
          </>
        ),
        rotulo: (
          <>
            <path d={rotulo(3.5)} fill="none" stroke={CREME} strokeWidth={0.8} />
            <path d={rotulo(6.5)} fill="none" stroke={CREME} strokeWidth={1.5} />
            {/* ornamentos dos cantos */}
            {[
              [R.x1 + 13, R.y1 + 13],
              [R.x2 - 13, R.y1 + 13],
              [R.x1 + 13, R.y2 - 13],
              [R.x2 - 13, R.y2 - 13],
            ].map(([x, y], i) => (
              <path key={i} d={`M${x} ${y - 3.2}L${x + 3.2} ${y}L${x} ${y + 3.2}L${x - 3.2} ${y}Z`} fill={CREME} />
            ))}
            {/* a marca em arco, como no rótulo */}
            <text fill={CREME} fontFamily={FONTE.serifa} fontWeight={700} fontSize={17}>
              <textPath href={`#${u('arcoMarca')}`} startOffset="50%" textAnchor="middle" textLength={102} lengthAdjust="spacingAndGlyphs">
                JACK DANIEL’S
              </textPath>
            </text>
            <Maca id={id} x={CX} y={319} s={0.95} />
            <g fill={CREME} textAnchor="middle">
              <text x={CX} y={345} fontFamily={FONTE.sans} fontWeight={700} fontSize={7.4} textLength={78} lengthAdjust="spacing">
                ORIGINAL RECIPE
              </text>
              <rect x={150} y={351} width={60} height={0.7} />
              <text x={CX} y={377} fontFamily={FONTE.serifa} fontStyle="italic" fontWeight={400} fontSize={26} textLength={100} lengthAdjust="spacingAndGlyphs">
                Tennessee
              </text>
              <text x={CX} y={409} fontFamily={FONTE.serifa} fontWeight={700} fontSize={29} textLength={96} lengthAdjust="spacingAndGlyphs">
                APPLE
              </text>
              <text x={CX} y={424} fontFamily={FONTE.sans} fontWeight={700} fontSize={6.2} textLength={62} lengthAdjust="spacing">
                FINELY CRAFTED
              </text>
              <rect x={134} y={432} width={92} height={0.7} />
              <g fontFamily={FONTE.condensada} fontWeight={700}>
                <text x={CX} y={445} fontSize={5.6} textLength={92} lengthAdjust="spacing">APPLE LIQUEUR BLENDED WITH</text>
                <text x={CX} y={454} fontSize={5.6} textLength={104} lengthAdjust="spacing">JACK DANIEL’S TENNESSEE WHISKEY</text>
                <text x={CX} y={466} fontSize={5} textLength={92} lengthAdjust="spacing">LYNCHBURG, TENNESSEE, U.S.A.</text>
                <text x={CX} y={480} fontSize={6.4} textLength={58} lengthAdjust="spacing">35% ALC./VOL.</text>
              </g>
            </g>
          </>
        ),
        // colarinho verde com a maçã (no lugar do "Old No 7")
        colarinho: (
          <g>
            <path d={`M${CX - 27.6} 104 Q${CX} 101.6 ${CX + 27.6} 104 V136 Q${CX} 133.6 ${CX - 27.6} 136Z`} fill={url('verdeV')} />
            <path d={`M${CX - 27.6} 107 Q${CX} 104.6 ${CX + 27.6} 107`} fill="none" stroke={CREME} strokeOpacity={0.9} strokeWidth={0.6} />
            <path d={`M${CX - 27.6} 132.6 Q${CX} 130.2 ${CX + 27.6} 132.6`} fill="none" stroke={CREME} strokeOpacity={0.9} strokeWidth={0.6} />
            <Maca id={id} x={CX} y={120} s={0.62} />
            <rect x={CX - 18} y={104} width={5} height={30} fill={url('hl')} opacity={0.22} />
          </g>
        ),
        // tampa preta com o topo dourado
        tampa: (
          <g>
            <path d={`M${CX - 31} 98 V62 Q${CX - 31} 55.5 ${CX - 24} 55 H${CX + 24} Q${CX + 31} 55.5 ${CX + 31} 62 V98Z`} fill={url('preto')} />
            <path d={`M${CX - 31} 77 V62 Q${CX - 31} 55.5 ${CX - 24} 55 H${CX + 24} Q${CX + 31} 55.5 ${CX + 31} 62 V77 Q${CX} 79 ${CX - 31} 77Z`} fill={url('topoOuro')} />
            <Estrias cx={CX} raio={31} y1={80} y2={95} qtd={30} clara={0.16} escura={0.55} />
            <path d={`M${CX - 32} 96 H${CX + 32} V102 Q${CX} 104.4 ${CX - 32} 102Z`} fill={url('preto')} />
            <path d={`M${CX - 32} 96.4 H${CX + 32}`} stroke="#fff" strokeOpacity={0.18} strokeWidth={0.8} />
            <path d={`M${CX - 27} 56.6 Q${CX} 54.4 ${CX + 27} 56.6`} fill="none" stroke="#fff6d6" strokeOpacity={0.6} strokeWidth={1} />
            <path d={`M${CX - 31} 77 Q${CX} 79 ${CX + 31} 77`} fill="none" stroke={BRANCO} strokeOpacity={0.25} strokeWidth={0.8} />
            <rect x={CX - 21} y={58} width={7} height={38} fill={url('hlD')} opacity={0.28} />
          </g>
        ),
      }}
    />
  )
}
