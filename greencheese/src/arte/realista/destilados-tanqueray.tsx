// Gin Tanqueray London Dry — 750 ml. Vidro verde-escuro em forma de coqueteleira (cúpula, dois
// frisos no "encaixe" e corpo baixo e redondo), impressão branca direto no vidro, lacre vermelho
// em relevo com o "T", abacaxi prateado na cúpula e tampa de alumínio escovado.
import { FONTE, type PropsArte } from './comum'
import { cilindroMaterial, contorno, Estrias, LG, RG, TextoCurvo, type Perfil } from './destilados-base'

const CX = 180
const NIVEL = 174
const PERFIL: Perfil = {
  ini: [23, 150],
  segs: [
    { p: [23, 184] },
    { c1: [25.5, 184], c2: [26.5, 185.5], p: [26.5, 188] },
    { p: [26.5, 192] },
    { c1: [26.5, 194], c2: [25, 195], p: [23.5, 195.5] },
    // cúpula da coqueteleira
    { c1: [24, 213], c2: [50, 221], p: [66, 233] },
    { c1: [78, 242], c2: [82, 249], p: [82, 257] },
    // frisos do encaixe
    { c1: [85, 257], c2: [87, 259], p: [87, 262] },
    { p: [87, 265] },
    { c1: [87, 267.5], c2: [85, 268.5], p: [83, 269] },
    { c1: [85.5, 269.5], c2: [87, 271], p: [87, 274] },
    { p: [87, 277] },
    { c1: [87, 279.5], c2: [85, 280.5], p: [83.5, 281] },
    // corpo baixo e redondo
    { c1: [85.5, 283], c2: [86, 288], p: [86, 296] },
    { c1: [87.5, 360], c2: [88.5, 450], p: [88, 505] },
    { c1: [87.5, 548], c2: [80, 573], p: [56, 578.5] },
    { c1: [38, 581.5], c2: [18, 582], p: [0, 582] },
  ],
}

const BRANCO = '#f2f5f1'

export function Tanqueray({ id }: PropsArte) {
  const u = (s: string) => `${id}-${s}`
  const url = (s: string) => `url(#${u(s)})`
  const garrafa = contorno(CX, PERFIL)
  const dentro = contorno(CX, PERFIL, 4)
  const verde: [number, string][] = [
    [0, '#010703'],
    [0.05, '#04200f'],
    [0.14, '#0f4a2a'],
    [0.22, '#21774a'],
    [0.27, '#3a9a66'],
    [0.33, '#1d6a40'],
    [0.48, '#0c3f24'],
    [0.7, '#062a16'],
    [0.86, '#0a3a21'],
    [0.94, '#1f6a42'],
    [1, '#010703'],
  ]
  const anel = (y: number, dx: number, e = 4.5) => `M${CX - dx} ${y}Q${CX} ${y - e} ${CX + dx} ${y}`

  return (
    <g>
      <defs>
        <clipPath id={u('vidro')}>
          <path d={garrafa} />
        </clipPath>
        <clipPath id={u('dentro')}>
          <path d={dentro} />
        </clipPath>
        <LG id={u('verde')} p={verde} />
        <LG id={u('verdeV')} us x1={0} y1={150} x2={0} y2={582} p={[[0, '#000', 0.55], [0.22, '#000', 0.2], [0.45, '#000', 0], [0.86, '#000', 0.08], [1, '#000', 0.6]]} />
        <LG id={u('gin')} p={[[0, '#000', 0], [0.18, '#6fdc9c', 0.1], [0.28, '#a6f0c4', 0.2], [0.4, '#3aa36a', 0.08], [1, '#000', 0]]} />
        <RG id={u('brilhoFundo')} cx={172} cy={478} r={120} sy={1.25} p={[[0, '#63e6a0', 0.42], [0.5, '#2a9f61', 0.15], [1, '#0b3a20', 0]]} />
        <LG id={u('base')} x2={0} y2={1} p={[[0, '#8ff5bd', 0.6], [0.14, '#0d4a29', 0.7], [0.6, '#1c7448', 0.45], [0.92, '#d2ffe6', 0.4], [1, '#000', 0]]} />
        <LG id={u('hl')} p={[[0, '#fff', 0], [0.5, '#fff', 1], [1, '#fff', 0]]} />
        <LG id={u('fadeV')} us x1={0} y1={150} x2={0} y2={585} p={[[0, '#fff', 0.6], [0.1, '#fff', 1], [0.82, '#fff', 1], [1, '#fff', 0.05]]} />
        <mask id={u('mVidro')} maskUnits="userSpaceOnUse" x={0} y={0} width={360} height={640}>
          <rect x={0} y={145} width={360} height={445} fill={url('fadeV')} />
        </mask>
        <LG id={u('aro')} p={[[0, '#eafff2', 0.8], [0.07, '#eafff2', 0.25], [0.3, '#fff', 0], [0.8, '#bff5d4', 0], [0.95, '#bff5d4', 0.55], [1, '#fff', 0.9]]} />
        <LG id={u('anel')} p={[[0, '#fff', 0.15], [0.12, '#fff', 0.85], [0.3, '#fff', 0.5], [0.6, '#fff', 0.12], [0.9, '#d6ffe6', 0.55], [1, '#fff', 0.1]]} />
        <LG id={u('metal')} p={cilindroMaterial({ borda: '#1b1d20', base: '#7a8087', claro: '#c7ccd2', brilho: '#fbfcfd', sombra: '#3d4248', aro: '#a8aeb5' })} />
        <pattern id={u('escovado')} width={6} height={1.7} patternUnits="userSpaceOnUse">
          <rect width={6} height={0.55} fill="#fff" fillOpacity={0.09} />
          <rect y={0.85} width={6} height={0.4} fill="#000" fillOpacity={0.08} />
        </pattern>
        <RG id={u('lacre')} cx={169} cy={331} r={46} p={[[0, '#ff6a5e'], [0.3, '#d92b33'], [0.72, '#9a1120'], [1, '#55050e']]} />
        <RG id={u('sombraLacre')} cx={183} cy={350} r={40} p={[[0.78, '#000', 0.55], [1, '#000', 0]]} />
        <LG id={u('ouro')} x2={0} y2={1} p={[[0, '#fff6d8'], [0.4, '#f1cf86'], [0.62, '#c08a38'], [1, '#f6dd9c']]} />
        <RG id={u('cupula')} cx={146} cy={236} r={18} sx={1.4} p={[[0, '#fff', 0.5], [1, '#fff', 0]]} />
        <clipPath id={u('abacaxi')}>
          <ellipse cx={CX} cy={237} rx={6.2} ry={7.6} />
        </clipPath>
      </defs>

      {/* ---------- vidro verde ---------- */}
      <path d={garrafa} fill={url('verde')} />
      <g clipPath={url('vidro')}>
        {/* gargalo tem a própria curvatura */}
        <rect x={CX - 27} y={146} width={54} height={51} fill={url('verde')} />
        <rect x={CX - 90} y={146} width={180} height={440} fill={url('verdeV')} />
      </g>
      <g clipPath={url('dentro')}>
        {/* ar no gargalo: mais escuro e transparente */}
        <rect x={CX - 30} y={146} width={60} height={NIVEL - 146} fill="#000" fillOpacity={0.55} />
        {/* gin: lente que acende o vidro */}
        <rect x={CX - 90} y={NIVEL} width={180} height={410} fill={url('gin')} />
        <rect x={CX - 90} y={NIVEL} width={180} height={410} fill={url('brilhoFundo')} />
        <path d={dentro} fill="none" stroke="#010a04" strokeOpacity={0.65} strokeWidth={3.2} />
      </g>
      <ellipse cx={CX} cy={NIVEL} rx={19} ry={1.6} fill="#bfffd9" fillOpacity={0.25} stroke="#d9ffe9" strokeOpacity={0.7} strokeWidth={0.8} />
      {/* fundo grosso */}
      <g clipPath={url('vidro')}>
        <path d={`M0 566Q${CX} 577 360 566V600H0Z`} fill={url('base')} />
        <path d={`M${CX - 70} 567.5Q${CX} 577.5 ${CX + 70} 567.5`} fill="none" stroke="#e6fff0" strokeOpacity={0.55} strokeWidth={1.1} />
      </g>

      {/* ---------- frisos e cúpula ---------- */}
      <g clipPath={url('vidro')}>
        <path d={anel(262.2, 86.5)} fill="none" stroke={url('anel')} strokeWidth={1.6} />
        <path d={anel(268.8, 83)} fill="none" stroke="#000" strokeOpacity={0.7} strokeWidth={1.8} />
        <path d={anel(274.2, 86.5)} fill="none" stroke={url('anel')} strokeWidth={1.6} />
        <path d={anel(280.8, 83.5)} fill="none" stroke="#000" strokeOpacity={0.7} strokeWidth={1.8} />
        <path d={anel(258, 82, 4)} fill="none" stroke="#000" strokeOpacity={0.35} strokeWidth={1} />
        <ellipse cx={146} cy={236} rx={26} ry={18} fill={url('cupula')} transform="rotate(-32 146 236)" />
        <path d={`M${CX - 30} 212 C${CX - 46} 220 ${CX - 64} 232 ${CX - 76} 247`} fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={1.6} strokeLinecap="round" />
        <path d={`M${CX + 34} 214 C${CX + 50} 222 ${CX + 66} 234 ${CX + 78} 249`} fill="none" stroke="#c9ffe0" strokeOpacity={0.35} strokeWidth={1.2} strokeLinecap="round" />
        <path d={anel(189.5, 26.5, 2)} fill="none" stroke="#fff" strokeOpacity={0.45} strokeWidth={1} />
      </g>

      {/* ---------- impressão no vidro ---------- */}
      {/* abacaxi prateado na cúpula */}
      <g fill={BRANCO} stroke={BRANCO}>
        <ellipse cx={CX} cy={237} rx={6.2} ry={7.6} fill="none" strokeWidth={0.9} />
        <g clipPath={url('abacaxi')} strokeWidth={0.6} fill="none">
          {[-8, -4, 0, 4, 8].map((k) => (
            <path key={k} d={`M${CX - 8 + k} 229L${CX + 8 + k} 245M${CX + 8 + k} 229L${CX - 8 + k} 245`} />
          ))}
        </g>
        <path d={`M${CX} 229.6 L${CX - 1.6} 222 L${CX} 216.5 L${CX + 1.6} 222Z M${CX - 1.5} 229.8 L${CX - 6.5} 221.5 L${CX - 2.5} 225 Z M${CX + 1.5} 229.8 L${CX + 6.5} 221.5 L${CX + 2.5} 225Z M${CX - 3} 230 L${CX - 9} 226 L${CX - 4.4} 226.6Z M${CX + 3} 230 L${CX + 9} 226 L${CX + 4.4} 226.6Z`} stroke="none" />
      </g>
      <TextoCurvo texto="EST. 1830" cx={CX} y={254} raio={70} tam={6.5} esp={1.4} curva={-3} fill={BRANCO} fillOpacity={0.85} fontFamily={FONTE.serifa} />

      {/* lacre vermelho em relevo */}
      <circle cx={183} cy={349.5} r={40} fill={url('sombraLacre')} />
      <circle cx={CX} cy={345} r={34} fill={url('lacre')} />
      <circle cx={CX} cy={345} r={33.4} fill="none" stroke="#3a0207" strokeOpacity={0.7} strokeWidth={1.3} />
      <circle cx={CX} cy={345} r={30.6} fill="none" stroke="#ffd9cc" strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="0.01 3.2" strokeLinecap="round" />
      <circle cx={CX} cy={345} r={27.6} fill="none" stroke="#ffb3a8" strokeOpacity={0.4} strokeWidth={0.9} />
      <circle cx={CX} cy={345} r={26.4} fill="none" stroke="#4a040c" strokeOpacity={0.55} strokeWidth={0.9} />
      <text x={181.2} y={360.8} fontFamily={FONTE.serifaPesada} fontWeight={700} fontSize={40} textAnchor="middle" fill="#3d0208" fillOpacity={0.75}>
        T
      </text>
      <text x={CX} y={359} fontFamily={FONTE.serifaPesada} fontWeight={700} fontSize={40} textAnchor="middle" fill={url('ouro')}>
        T
      </text>
      <path d={`M156 334 A27 27 0 0 1 184 318.4`} fill="none" stroke="#fff" strokeOpacity={0.5} strokeWidth={2.4} strokeLinecap="round" />
      <path d={`M206 352 A27 27 0 0 1 186 371.6`} fill="none" stroke="#2a0005" strokeOpacity={0.5} strokeWidth={2} strokeLinecap="round" />

      <TextoCurvo texto="TANQUERAY" cx={CX} y={428} raio={88} tam={25} esp={1.6} curva={4} fill={BRANCO} fontFamily={FONTE.serifa} fontWeight={700} />
      <TextoCurvo texto="LONDON DRY GIN" cx={CX} y={451} raio={88} tam={10.5} esp={2.6} curva={4} fill={BRANCO} fontFamily={FONTE.serifa} fontWeight={700} />
      <path d={`M${CX - 26} 462.5 H${CX - 6} M${CX + 6} 462.5 H${CX + 26}`} stroke={BRANCO} strokeWidth={0.8} />
      <path d={`M${CX} 459.8 L${CX + 2.7} 462.5 L${CX} 465.2 L${CX - 2.7} 462.5Z`} fill={BRANCO} />
      <TextoCurvo texto="DISTILLED & BOTTLED IN GREAT BRITAIN" cx={CX} y={520} raio={88} tam={5.6} esp={0.7} curva={5} fill={BRANCO} fillOpacity={0.85} fontFamily={FONTE.sans} fontWeight={700} />
      <TextoCurvo texto="47.3% VOL · 750 ML" cx={CX} y={533} raio={88} tam={7.5} esp={1.4} curva={5} fill={BRANCO} fillOpacity={0.9} fontFamily={FONTE.sans} fontWeight={700} />

      {/* ---------- reflexos ---------- */}
      <g clipPath={url('vidro')} mask={`url(#${u('mVidro')})`}>
        <rect x={CX - 60} y={276} width={26} height={300} fill={url('hl')} opacity={0.3} />
        <rect x={CX - 50} y={282} width={5} height={290} fill={url('hl')} opacity={0.75} />
        <rect x={CX + 48} y={290} width={9} height={270} fill={url('hl')} opacity={0.16} />
        <rect x={CX - 18} y={150} width={6} height={46} fill={url('hl')} opacity={0.55} />
        <rect x={CX + 14} y={150} width={3} height={44} fill="#c9ffe0" fillOpacity={0.3} />
      </g>
      <path d={garrafa} fill="none" stroke={url('aro')} strokeWidth={1.3} />

      {/* ---------- tampa de alumínio ---------- */}
      <g>
        <path d={`M${CX - 26} 158 V104 Q${CX - 26} 96.5 ${CX - 19} 96 H${CX + 19} Q${CX + 26} 96.5 ${CX + 26} 104 V158Z`} fill={url('metal')} />
        <path d={`M${CX - 26} 158 V104 Q${CX - 26} 96.5 ${CX - 19} 96 H${CX + 19} Q${CX + 26} 96.5 ${CX + 26} 104 V158Z`} fill={url('escovado')} />
        <Estrias cx={CX} raio={26} y1={140} y2={157} qtd={30} clara={0.4} escura={0.35} />
        <path d={anel(139.5, 26, 2.4)} fill="none" stroke="#000" strokeOpacity={0.45} strokeWidth={1} />
        <path d={anel(138.4, 26, 2.4)} fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={0.7} />
        <path d={`M${CX - 27} 155 H${CX + 27} V159 Q${CX} 161.2 ${CX - 27} 159Z`} fill={url('metal')} />
        <path d={anel(97.6, 21, 2)} fill="none" stroke="#fff" strokeOpacity={0.75} strokeWidth={1} />
        <TextoCurvo texto="TANQUERAY" cx={CX} y={123} raio={26} tam={6.6} esp={0.8} curva={-1} fill="#23262a" fillOpacity={0.55} fontFamily={FONTE.serifa} fontWeight={700} />
      </g>
    </g>
  )
}
