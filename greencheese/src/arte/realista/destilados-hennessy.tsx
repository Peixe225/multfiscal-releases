// Hennessy Very Special (V.S). Garrafa de ombros largos e redondos, corpo que afina para a base,
// conhaque âmbar-escuro, rótulo preto com dourado (braço com machado, "Hennessy", "V.S"),
// cápsula e tampa escuras com filetes dourados.
import { FONTE, type PropsArte } from './comum'
import { cilindroMaterial, contorno, LG, RG, TextoCurvo, type Perfil } from './destilados-base'

const CX = 180
const NIVEL = 214
const FUNDO = 566
const PERFIL: Perfil = {
  ini: [23, 130],
  segs: [
    { p: [24, 206] },
    { c1: [24.5, 236], c2: [36, 256], p: [56, 268] },
    { c1: [78, 281], c2: [88, 296], p: [88, 320] },
    { c1: [88, 400], c2: [84, 500], p: [80, 556] },
    { c1: [79, 571], c2: [73, 577], p: [60, 578.5] },
    { c1: [40, 580.5], c2: [20, 581], p: [0, 581] },
  ],
}

const ROTULO = `M108 343Q${CX} 325 252 343L248.5 528Q${CX} 535 111.5 528Z`
const FILETE1 = `M113 347.6Q${CX} 330.4 247 347.6L244 523.4Q${CX} 529.8 116 523.4Z`
const FILETE2 = `M117 351.6Q${CX} 334.8 243 351.6L240.4 519.6Q${CX} 525.6 119.6 519.6Z`

/** Braço armado com machado (o símbolo da casa), simplificado, numa caixa de ~28×30. */
const BRACO_TRACO = 'M4 23.6L13.6 24.4L18.4 9.6' // braço dobrado (traço grosso)
const BRACO_CHEIO =
  'M15.3 7.6a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0Z' + // punho
  'M-1 16.6L5 18.4L5 29L-1 30.8Z' + // manga da armadura
  'M22.8 20.2L24.2 19.8L15.1 -6.2L13.7 -5.8Z' + // cabo do machado
  'M15 -4.8C9.4 -10.4 2.6 -8.6 0.8 -2.2C5.4 -4.4 10.4 -3.6 13.4 0.6Z' + // lâmina
  'M16.2 -3.4L20.6 -5.8L17 -1.2Z' // esporão

export function Hennessy({ id }: PropsArte) {
  const u = (s: string) => `${id}-${s}`
  const url = (s: string) => `url(#${u(s)})`
  const garrafa = contorno(CX, PERFIL)
  const dentro = contorno(CX, PERFIL, 4)
  const conhaque: [number, string][] = [
    [0, '#0e0502'],
    [0.06, '#2e1205'],
    [0.14, '#6e300c'],
    [0.22, '#a8521a'],
    [0.28, '#c86a26'],
    [0.36, '#93460f'],
    [0.52, '#5a2508'],
    [0.72, '#331404'],
    [0.86, '#4a1e07'],
    [0.94, '#8a4716'],
    [1, '#0e0502'],
  ]
  const anel = (y: number, dx: number, e = 2.4) => `M${CX - dx} ${y}Q${CX} ${y - e} ${CX + dx} ${y}`

  return (
    <g>
      <defs>
        <clipPath id={u('vidro')}>
          <path d={garrafa} />
        </clipPath>
        <clipPath id={u('dentro')}>
          <path d={dentro} />
        </clipPath>
        <LG id={u('vazio')} p={[[0, '#ffe9d0', 0.3], [0.08, '#24100a', 0.6], [0.5, '#120805', 0.4], [0.92, '#24100a', 0.6], [1, '#ffe9d0', 0.3]]} />
        <LG id={u('conhaque')} p={conhaque} />
        <LG id={u('conhaqueV')} us x1={0} y1={NIVEL} x2={0} y2={FUNDO} p={[[0, '#000', 0.5], [0.2, '#000', 0.3], [0.45, '#000', 0.05], [0.85, '#000', 0], [1, '#000', 0.35]]} />
        <RG id={u('brasa')} cx={174} cy={540} r={110} sy={0.9} p={[[0, '#ffa04d', 0.5], [0.5, '#d2662a', 0.18], [1, '#7a3410', 0]]} />
        <RG id={u('brasaOmbro')} cx={168} cy={300} r={70} sy={0.6} p={[[0, '#ff9a45', 0.3], [1, '#ff9a45', 0]]} />
        <LG id={u('base')} x2={0} y2={1} p={[[0, '#ffbe7a', 0.75], [0.14, '#5a2508', 0.85], [0.6, '#8a4216', 0.6], [0.9, '#ffe6c8', 0.38], [1, '#000', 0]]} />
        <LG id={u('hl')} p={[[0, '#fff', 0], [0.5, '#fff', 1], [1, '#fff', 0]]} />
        <LG id={u('fadeV')} us x1={0} y1={196} x2={0} y2={585} p={[[0, '#fff', 0.7], [0.1, '#fff', 1], [0.82, '#fff', 1], [1, '#fff', 0.05]]} />
        <mask id={u('mVidro')} maskUnits="userSpaceOnUse" x={0} y={0} width={360} height={640}>
          <rect x={0} y={196} width={360} height={392} fill={url('fadeV')} />
          <path d={ROTULO} fill="#000" />
        </mask>
        <LG id={u('aro')} p={[[0, '#fff', 0.75], [0.07, '#fff', 0.22], [0.3, '#fff', 0], [0.8, '#ffd2a0', 0], [0.95, '#ffd2a0', 0.5], [1, '#fff', 0.85]]} />
        <LG id={u('papel')} p={[[0, '#000'], [0.08, '#0d0907'], [0.2, '#231a13'], [0.27, '#30241a'], [0.34, '#1b140e'], [0.6, '#0e0a07'], [0.85, '#070504'], [0.95, '#14100c'], [1, '#000']]} />
        <LG id={u('papelV')} x2={0} y2={1} p={[[0, '#fff', 0.05], [0.3, '#fff', 0], [1, '#000', 0.25]]} />
        <LG id={u('ouroH')} p={[[0, '#5a3d10'], [0.16, '#d9b062'], [0.27, '#fff3c8'], [0.4, '#c9963e'], [0.7, '#7a5418'], [0.9, '#d6aa55'], [1, '#4a320c']]} />
        <LG id={u('ouroV')} x2={0} y2={1} p={[[0, '#fff3c4'], [0.35, '#e9bf62'], [0.6, '#a8772a'], [0.82, '#efcd7c'], [1, '#8a6120']]} />
        <LG id={u('rotH')} p={[[0, '#000', 0.65], [0.07, '#000', 0.12], [0.2, '#fff', 0.05], [0.27, '#fff', 0.11], [0.35, '#fff', 0.02], [0.78, '#000', 0.15], [1, '#000', 0.65]]} />
        <LG id={u('gargV')} us x1={0} y1={232} x2={0} y2={262} p={[[0, '#fff'], [1, '#fff', 0]]} />
        <mask id={u('mGarg')} maskUnits="userSpaceOnUse" x={0} y={0} width={360} height={640}>
          <rect x={0} y={200} width={360} height={80} fill={url('gargV')} />
        </mask>
        <RG id={u('ombroLuz')} cx={128} cy={276} r={24} sx={1.1} sy={0.34} p={[[0, '#fff', 0.42], [1, '#fff', 0]]} />
        <LG id={u('preto')} p={cilindroMaterial({ borda: '#000', base: '#120c09', claro: '#3a2f29', brilho: '#7a6c62', sombra: '#050302', aro: '#2c231e' })} />
      </defs>

      {/* ---------- vidro e conhaque ---------- */}
      <path d={garrafa} fill={url('vazio')} />
      <g clipPath={url('dentro')}>
        <rect x={CX - 90} y={NIVEL} width={180} height={FUNDO - NIVEL} fill={url('conhaque')} />
        <rect x={CX - 26} y={NIVEL} width={52} height={60} fill={url('conhaque')} mask={`url(#${u('mGarg')})`} />
        <rect x={CX - 90} y={NIVEL} width={180} height={FUNDO - NIVEL} fill={url('conhaqueV')} />
        <rect x={CX - 90} y={NIVEL} width={180} height={FUNDO - NIVEL} fill={url('brasa')} />
        <rect x={CX - 90} y={250} width={180} height={90} fill={url('brasaOmbro')} />
        <path d={dentro} fill="none" stroke="#0e0502" strokeOpacity={0.7} strokeWidth={3} />
      </g>
      <ellipse cx={CX} cy={NIVEL} rx={20} ry={1.6} fill="#ffc890" fillOpacity={0.3} stroke="#ffdcb0" strokeOpacity={0.75} strokeWidth={0.8} />
      <g clipPath={url('vidro')}>
        <path d={`M0 ${FUNDO}Q${CX} ${FUNDO + 9} 360 ${FUNDO}V600H0Z`} fill={url('base')} />
        <path d={`M${CX - 66} ${FUNDO + 1.6}Q${CX} ${FUNDO + 10} ${CX + 66} ${FUNDO + 1.6}`} fill="none" stroke="#fff0dc" strokeOpacity={0.5} strokeWidth={1.1} />
        {/* ombro redondo */}
        <ellipse cx={128} cy={276} rx={26} ry={8} fill={url('ombroLuz')} transform="rotate(30 128 276)" />
        <path d={`M${CX - 18} 248 C${CX - 30} 261 ${CX - 56} 270 ${CX - 76} 292`} fill="none" stroke="#fff" strokeOpacity={0.5} strokeWidth={1.4} strokeLinecap="round" />
        <path d={`M${CX + 22} 250 C${CX + 36} 263 ${CX + 60} 273 ${CX + 79} 298`} fill="none" stroke="#ffd2a0" strokeOpacity={0.3} strokeWidth={1.1} strokeLinecap="round" />
      </g>

      {/* ---------- rótulo preto e dourado ---------- */}
      <path d={ROTULO} fill="#000" fillOpacity={0.5} transform="translate(0.8 1)" />
      <path d={ROTULO} fill={url('papel')} />
      <path d={ROTULO} fill={url('papelV')} />
      <path d={FILETE1} fill="none" stroke={url('ouroH')} strokeWidth={1.4} />
      <path d={FILETE2} fill="none" stroke={url('ouroH')} strokeWidth={0.6} />
      <g transform={`translate(${CX - 12.5} 355) scale(0.9)`}>
        <path d={BRACO_TRACO} fill="none" stroke={url('ouroV')} strokeWidth={5.4} strokeLinecap="round" strokeLinejoin="round" />
        <path d={BRACO_CHEIO} fill={url('ouroV')} />
      </g>
      <text x={CX} y={416} fontFamily={FONTE.serifa} fontStyle="italic" fontWeight={700} fontSize={38} textAnchor="middle" textLength={124} lengthAdjust="spacingAndGlyphs" fill={url('ouroV')}>
        Hennessy
      </text>
      <path d={`M128 425 C146 429 160 422.6 174 425 M186 425 C200 422.6 214 429 232 425`} fill="none" stroke={url('ouroH')} strokeWidth={0.9} />
      <path d={`M${CX} 422.2 L${CX + 2.8} 425 L${CX} 427.8 L${CX - 2.8} 425Z`} fill={url('ouroV')} />
      <TextoCurvo texto="VERY SPECIAL" cx={CX} y={442} raio={86} tam={8.6} esp={2.4} curva={2} fill={url('ouroV')} fontFamily={FONTE.serifa} fontWeight={700} />
      <text x={CX} y={495} fontFamily={FONTE.serifaPesada} fontWeight={700} fontSize={54} textAnchor="middle" textLength={88} lengthAdjust="spacingAndGlyphs" fill={url('ouroV')}>
        V.S
      </text>
      <TextoCurvo texto="COGNAC" cx={CX} y={513} raio={84} tam={10} esp={3.4} curva={3} fill={url('ouroV')} fontFamily={FONTE.serifa} fontWeight={700} />
      {/* curvatura do rótulo: sombra nas bordas, brilho fosco a ~25% */}
      <path d={ROTULO} fill={url('rotH')} />

      {/* ---------- reflexos do vidro ---------- */}
      <g clipPath={url('vidro')} mask={`url(#${u('mVidro')})`}>
        <rect x={CX - 63} y={280} width={26} height={300} fill={url('hl')} opacity={0.3} />
        <rect x={CX - 53} y={286} width={5} height={290} fill={url('hl')} opacity={0.75} />
        <rect x={CX + 50} y={300} width={9} height={270} fill={url('hl')} opacity={0.15} />
        <rect x={CX - 18} y={196} width={6} height={50} fill={url('hl')} opacity={0.55} />
        <rect x={CX + 15} y={196} width={3} height={46} fill="#ffd2a0" fillOpacity={0.3} />
      </g>
      <path d={garrafa} fill="none" stroke={url('aro')} strokeWidth={1.3} />

      {/* ---------- cápsula e tampa ---------- */}
      <g>
        <path d={`M${CX - 24.3} 134 L${CX - 25.4} 198 Q${CX} 195.4 ${CX + 25.4} 198 L${CX + 24.3} 134 Q${CX} 131.6 ${CX - 24.3} 134Z`} fill={url('preto')} />
        <path d={`M${CX - 25.1} 185 Q${CX} 182.4 ${CX + 25.1} 185 L${CX + 25.3} 192 Q${CX} 189.4 ${CX - 25.3} 192Z`} fill={url('ouroH')} />
        <path d={anel(140, 24.4)} fill="none" stroke={url('ouroH')} strokeWidth={0.9} />
        <TextoCurvo texto="H" cx={CX} y={170} raio={25} tam={17} curva={-1} fill={url('ouroV')} fontFamily={FONTE.serifa} fontStyle="italic" fontWeight={700} />
        <rect x={CX - 18} y={136} width={5} height={60} fill={url('hl')} opacity={0.22} />
        <path d={`M${CX - 22.5} 134 V88 Q${CX - 22.5} 80.5 ${CX - 15.5} 80 H${CX + 15.5} Q${CX + 22.5} 80.5 ${CX + 22.5} 88 V134Z`} fill={url('preto')} />
        <path d={anel(82.4, 17)} fill="none" stroke={url('ouroH')} strokeWidth={1.2} />
        <path d={`M${CX - 22.6} 126 Q${CX} 123.6 ${CX + 22.6} 126 V133 Q${CX} 130.6 ${CX - 22.6} 133Z`} fill={url('ouroH')} />
        <rect x={CX - 16} y={84} width={5} height={42} fill={url('hl')} opacity={0.3} />
      </g>
    </g>
  )
}
