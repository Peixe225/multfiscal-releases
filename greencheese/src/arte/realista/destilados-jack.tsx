// Jack Daniel's Old No. 7 — 1 L. Garrafa quadrada de vidro transparente com whiskey âmbar,
// faces chanfradas (só a luz denuncia), rótulo preto com filete branco, colarinho e tampa pretos.
import { FONTE, type PropsArte } from './comum'
import { contorno, Estrias, LG, RG, type Perfil } from './destilados-base'

const CX = 180
/** Meia largura do corpo e onde começa o chanfro. */
const MEIA = 82.5
const CHANFRO = 72
const NIVEL = 142 // menisco, logo abaixo do colarinho
const FUNDO = 562 // fundo de dentro (o vidro da base é grosso)

const PERFIL: Perfil = {
  ini: [26.5, 98],
  segs: [
    { p: [26.5, 147] },
    { c1: [26.5, 156], c2: [29, 161], p: [38, 163.5] },
    { c1: [54, 167], c2: [70, 170.5], p: [77, 176.5] },
    { c1: [81.5, 180.5], c2: [MEIA, 185], p: [MEIA, 193] },
    { p: [MEIA, 567] },
    { c1: [MEIA, 576], c2: [78, 580], p: [69, 580] },
  ],
}

// Rótulo: retângulo com cantos chanfrados para dentro (rótulo antigo).
const R = { x1: 112, x2: 248, y1: 262, y2: 503, k: 6 }
function rotulo(i = 0) {
  const x1 = R.x1 + i, x2 = R.x2 - i, y1 = R.y1 + i, y2 = R.y2 - i, k = R.k
  return `M${x1 + k} ${y1}H${x2 - k}A${k} ${k} 0 0 0 ${x2} ${y1 + k}V${y2 - k}A${k} ${k} 0 0 0 ${x2 - k} ${y2}H${x1 + k}A${k} ${k} 0 0 0 ${x1} ${y2 - k}V${y1 + k}A${k} ${k} 0 0 0 ${x1 + k} ${y1}Z`
}

const BRANCO = '#f3efe6'

export function JackDaniels({ id }: PropsArte) {
  const u = (s: string) => `${id}-${s}`
  const url = (s: string) => `url(#${u(s)})`
  const garrafa = contorno(CX, PERFIL)
  const dentro = contorno(CX, PERFIL, 4.5)

  return (
    <g>
      <defs>
        <clipPath id={u('vidro')}>
          <path d={garrafa} />
        </clipPath>
        <clipPath id={u('dentro')}>
          <path d={dentro} />
        </clipPath>
        {/* vidro vazio: quase invisível, bordas pegam luz */}
        <LG id={u('vazio')} p={[[0, '#fff1dd', 0.32], [0.06, '#2a1407', 0.55], [0.5, '#140904', 0.35], [0.94, '#2a1407', 0.55], [1, '#fff1dd', 0.3]]} />
        {/* whiskey visto por faces planas: largo e quente no meio, escurece no chanfro */}
        <LG
          id={u('whisky')}
          p={[
            [0, '#160700'],
            [0.05, '#3d1604'],
            [0.12, '#8f430e'],
            [0.22, '#d9781c'],
            [0.34, '#f09a32'],
            [0.46, '#e08424'],
            [0.62, '#c0661a'],
            [0.8, '#8a420f'],
            [0.9, '#4a1d05'],
            [0.96, '#b0601c'],
            [1, '#160700'],
          ]}
        />
        <LG id={u('whiskyV')} x2={0} y2={1} p={[[0, '#000', 0.6], [0.14, '#000', 0.25], [0.4, '#000', 0], [0.82, '#ffb35c', 0.1], [1, '#000', 0.3]]} />
        <RG id={u('brasa')} cx={176} cy={455} r={150} sy={1.25} p={[[0, '#ffd27a', 0.6], [0.4, '#f7a040', 0.25], [1, '#f29a3a', 0]]} />
        <LG id={u('base')} x2={0} y2={1} p={[[0, '#ffcf8a', 0.9], [0.1, '#8a4512', 0.9], [0.45, '#b4651f', 0.75], [0.8, '#4a2208', 0.85], [0.94, '#fff0d8', 0.45], [1, '#000', 0]]} />
        <LG id={u('baseH')} p={[[0, '#000', 0.8], [0.12, '#000', 0.2], [0.3, '#fff', 0.12], [0.6, '#000', 0], [0.88, '#000', 0.35], [1, '#000', 0.8]]} />
        {/* faixas de reflexo */}
        <LG id={u('hl')} p={[[0, '#fff', 0], [0.5, '#fff', 1], [1, '#fff', 0]]} />
        <LG id={u('hlD')} p={[[0, '#fff', 0], [0.35, '#fff', 1], [1, '#fff', 0]]} />
        <LG id={u('fadeV')} x2={0} y2={1} us x1={0} y1={150} y2={590} p={[[0, '#fff', 0.5], [0.12, '#fff', 1], [0.85, '#fff', 1], [1, '#fff', 0.1]]} />
        <mask id={u('mVidro')} maskUnits="userSpaceOnUse" x={0} y={0} width={360} height={640}>
          <rect x={0} y={140} width={360} height={450} fill={url('fadeV')} />
          <path d={rotulo()} fill="#000" />
        </mask>
        {/* contorno: luz fria à esquerda, aro quente à direita */}
        <LG id={u('aro')} p={[[0, '#fff', 0.75], [0.08, '#fff', 0.25], [0.3, '#fff', 0], [0.8, '#ffd9a8', 0], [0.95, '#ffd9a8', 0.5], [1, '#fff', 0.9]]} />
        {/* plástico preto da tampa e do colarinho */}
        <LG id={u('preto')} p={[[0, '#000'], [0.08, '#101010'], [0.18, '#2c2c2c'], [0.25, '#5c5c5c'], [0.32, '#262626'], [0.5, '#0e0e0e'], [0.76, '#040404'], [0.9, '#1d1d1d'], [0.96, '#3a3a3a'], [1, '#000']]} />
        <LG id={u('papel')} x1={0} y1={0} x2={1} y2={1} p={[[0, '#232323'], [0.35, '#0e0e0e'], [1, '#050505']]} />
        <LG id={u('rotH')} p={[[0, '#000', 0.5], [0.05, '#000', 0], [0.12, '#fff', 0.05], [0.22, '#fff', 0.09], [0.32, '#fff', 0.02], [0.9, '#000', 0.1], [1, '#000', 0.45]]} />
      </defs>

      {/* ---------- vidro e líquido ---------- */}
      <path d={garrafa} fill={url('vazio')} />
      <g clipPath={url('dentro')}>
        <rect x={CX - MEIA} y={NIVEL} width={MEIA * 2} height={FUNDO - NIVEL} fill={url('whisky')} />
        <rect x={CX - MEIA} y={NIVEL} width={MEIA * 2} height={FUNDO - NIVEL} fill={url('whiskyV')} />
        <rect x={CX - MEIA} y={NIVEL} width={MEIA * 2} height={FUNDO - NIVEL} fill={url('brasa')} />
        {/* parede de vidro vista por dentro (linha escura) */}
        <path d={dentro} fill="none" stroke="#1a0a02" strokeOpacity={0.75} strokeWidth={3} />
        {/* ombro: o líquido escurece onde o vidro se inclina */}
        <path d={`M${CX - 80} 180 C${CX - 60} 166 ${CX - 30} 162 ${CX} 163 C${CX + 30} 162 ${CX + 60} 166 ${CX + 80} 180 L${CX + 80} 196 C${CX + 50} 184 ${CX - 50} 184 ${CX - 80} 196Z`} fill="#2a1104" fillOpacity={0.5} />
      </g>
      {/* menisco */}
      <ellipse cx={CX} cy={NIVEL} rx={21.5} ry={1.8} fill="#ffcf8a" fillOpacity={0.35} stroke="#ffe2b0" strokeOpacity={0.8} strokeWidth={0.8} />
      {/* base grossa de vidro */}
      <g clipPath={url('vidro')}>
        <rect x={CX - MEIA} y={FUNDO} width={MEIA * 2} height={19} fill={url('base')} />
        <rect x={CX - MEIA} y={FUNDO} width={MEIA * 2} height={19} fill={url('baseH')} />
        <rect x={CX - 66} y={FUNDO + 8} width={132} height={1.2} fill="#ffe7c4" fillOpacity={0.3} />
        <rect x={CX - 70} y={FUNDO + 0.2} width={140} height={1.2} fill="#fff4dc" fillOpacity={0.55} />
      </g>

      {/* ---------- chanfros: a luz desenha a quina ---------- */}
      <g clipPath={url('vidro')}>
        <rect x={CX - MEIA} y={186} width={MEIA - CHANFRO} height={390} fill="#fff" fillOpacity={0.16} />
        <rect x={CX - MEIA + 2} y={190} width={4} height={380} fill={url('hl')} opacity={0.75} />
        <rect x={CX + CHANFRO} y={186} width={MEIA - CHANFRO} height={390} fill="#000" fillOpacity={0.5} />
        <rect x={CX + MEIA - 3.2} y={192} width={2} height={376} fill="#ffd9a8" fillOpacity={0.35} />
        <rect x={CX - CHANFRO - 0.7} y={190} width={1.4} height={376} fill="#fff" fillOpacity={0.42} />
        <rect x={CX + CHANFRO - 0.5} y={190} width={1} height={376} fill="#fff" fillOpacity={0.2} />
        {/* quina do ombro */}
        <path d={`M${CX - 40} 165 C${CX - 58} 168 ${CX - 72} 172 ${CX - 79.5} 181`} fill="none" stroke="#fff" strokeOpacity={0.8} strokeWidth={2} strokeLinecap="round" />
        <path d={`M${CX - 28} 167 C${CX - 52} 170 ${CX - 68} 176 ${CX - 76} 188`} fill="none" stroke="#fff" strokeOpacity={0.2} strokeWidth={8} strokeLinecap="round" />
        <path d={`M${CX + 44} 167 C${CX + 62} 170.5 ${CX + 74} 174 ${CX + 80.5} 184`} fill="none" stroke="#ffd9a8" strokeOpacity={0.5} strokeWidth={1.4} strokeLinecap="round" />
      </g>

      {/* ---------- rótulo ---------- */}
      <path d={rotulo(-0.8)} fill="#000" fillOpacity={0.6} />
      <path d={rotulo()} fill={url('papel')} />
      <path d={rotulo(3.5)} fill="none" stroke={BRANCO} strokeWidth={0.8} />
      <path d={rotulo(6.5)} fill="none" stroke={BRANCO} strokeWidth={1.5} />
      {/* ornamentos dos cantos */}
      {[
        [R.x1 + 13, R.y1 + 13],
        [R.x2 - 13, R.y1 + 13],
        [R.x1 + 13, R.y2 - 13],
        [R.x2 - 13, R.y2 - 13],
      ].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y - 3.2}L${x + 3.2} ${y}L${x} ${y + 3.2}L${x - 3.2} ${y}Z`} fill={BRANCO} />
      ))}
      <g fill={BRANCO} textAnchor="middle">
        <text x={CX} y={303} fontFamily={FONTE.serifa} fontWeight={700} fontSize={27} textLength={116} lengthAdjust="spacingAndGlyphs">
          Jack Daniel’s
        </text>
        <path d={`M126 310 C142 315 156 306 170 309.5 C176 311 184 311 190 309.5 C204 306 218 315 234 310`} fill="none" stroke={BRANCO} strokeWidth={1} />
        <circle cx={CX} cy={310.2} r={1.6} />
        {/* Old No. 7 em caixa */}
        <rect x={129} y={318} width={102} height={42} fill="none" stroke={BRANCO} strokeWidth={1.3} />
        <rect x={132} y={321} width={96} height={36} fill="none" stroke={BRANCO} strokeWidth={0.5} />
        <text x={CX} y={349} fontFamily={FONTE.serifa} fontWeight={700} fontSize={27} textLength={84} lengthAdjust="spacingAndGlyphs">
          Old No. 7
        </text>
        <text x={CX} y={375} fontFamily={FONTE.serifa} fontWeight={700} fontSize={10} textLength={44} lengthAdjust="spacing">
          BRAND
        </text>
        <rect x={134} y={371} width={16} height={0.8} />
        <rect x={210} y={371} width={16} height={0.8} />
        <text x={CX} y={404} fontFamily={FONTE.serifa} fontWeight={700} fontSize={18} textLength={110} lengthAdjust="spacingAndGlyphs">
          TENNESSEE
        </text>
        <text x={CX} y={420} fontFamily={FONTE.sans} fontWeight={700} fontSize={8.5} textLength={64} lengthAdjust="spacing">
          SOUR MASH
        </text>
        <text x={CX} y={446} fontFamily={FONTE.serifa} fontWeight={700} fontSize={20} textLength={98} lengthAdjust="spacingAndGlyphs">
          WHISKEY
        </text>
        <rect x={128} y={455} width={104} height={0.7} />
        <g fontFamily={FONTE.condensada} fontWeight={700}>
          <text x={CX} y={467} fontSize={5.6} textLength={86} lengthAdjust="spacing">DISTILLED AND BOTTLED BY</text>
          <text x={CX} y={476} fontSize={6.4} textLength={98} lengthAdjust="spacing">JACK DANIEL DISTILLERY</text>
          <text x={CX} y={484} fontSize={5} textLength={92} lengthAdjust="spacing">LYNCHBURG, TENNESSEE, U.S.A.</text>
          <text x={CX} y={494} fontSize={6.4} textLength={70} lengthAdjust="spacing">40% ALC./VOL. · 1 L</text>
        </g>
      </g>
      {/* papel: um brilho fosco por cima */}
      <path d={rotulo()} fill={url('rotH')} />

      {/* ---------- reflexos do vidro (não passam por cima do rótulo) ---------- */}
      <g clipPath={url('vidro')} mask={`url(#${u('mVidro')})`}>
        <rect x={111} y={150} width={34} height={430} fill={url('hl')} opacity={0.3} />
        <rect x={121} y={150} width={5} height={430} fill={url('hl')} opacity={0.7} />
        <rect x={230} y={170} width={14} height={410} fill={url('hl')} opacity={0.14} />
      </g>
      {/* gargalo */}
      <rect x={CX - 20} y={136} width={6} height={36} fill={url('hl')} opacity={0.5} />
      <rect x={CX + 17} y={136} width={3} height={34} fill="#ffd9a8" fillOpacity={0.35} />
      {/* contorno do vidro */}
      <path d={garrafa} fill="none" stroke={url('aro')} strokeWidth={1.3} />

      {/* ---------- colarinho preto "Old No 7" ---------- */}
      <g>
        <path d={`M${CX - 27.6} 104 Q${CX} 101.6 ${CX + 27.6} 104 V136 Q${CX} 133.6 ${CX - 27.6} 136Z`} fill={url('preto')} />
        <path d={`M${CX - 27.6} 107 Q${CX} 104.6 ${CX + 27.6} 107`} fill="none" stroke={BRANCO} strokeOpacity={0.85} strokeWidth={0.6} />
        <path d={`M${CX - 27.6} 132.6 Q${CX} 130.2 ${CX + 27.6} 132.6`} fill="none" stroke={BRANCO} strokeOpacity={0.85} strokeWidth={0.6} />
        <text x={CX} y={123.5} fill={BRANCO} fontFamily={FONTE.serifa} fontWeight={700} fontSize={11} textAnchor="middle" textLength={40} lengthAdjust="spacingAndGlyphs">
          Old No 7
        </text>
        <rect x={CX - 18} y={104} width={5} height={30} fill={url('hl')} opacity={0.22} />
      </g>

      {/* ---------- tampa preta ---------- */}
      <g>
        <path d={`M${CX - 31} 98 V62 Q${CX - 31} 55.5 ${CX - 24} 55 H${CX + 24} Q${CX + 31} 55.5 ${CX + 31} 62 V98Z`} fill={url('preto')} />
        <Estrias cx={CX} raio={31} y1={63} y2={95} qtd={30} clara={0.16} escura={0.55} />
        <path d={`M${CX - 32} 96 H${CX + 32} V102 Q${CX} 104.4 ${CX - 32} 102Z`} fill={url('preto')} />
        <path d={`M${CX - 32} 96.4 H${CX + 32}`} stroke="#fff" strokeOpacity={0.18} strokeWidth={0.8} />
        <path d={`M${CX - 27} 56.6 Q${CX} 54.4 ${CX + 27} 56.6`} fill="none" stroke="#fff" strokeOpacity={0.35} strokeWidth={1} />
        <rect x={CX - 21} y={58} width={7} height={38} fill={url('hlD')} opacity={0.28} />
      </g>
    </g>
  )
}
