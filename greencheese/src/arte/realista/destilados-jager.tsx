// Jägermeister — 700 ml. Garrafa verde-escura de ombros largos e corpo quase quadrado (chanfros),
// licor marrom-avermelhado por dentro, rótulo laranja com moldura preta, cabeça de cervo com
// galhada (sem a cruz), "Jägermeister" em serifa preta pesada, tampa preta com aro laranja.
import { FONTE, type PropsArte } from './comum'
import { cilindroMaterial, contorno, Estrias, LG, RG, type Perfil } from './destilados-base'

const CX = 180
const MEIA = 85.5
const CHANFRO = 76
const NIVEL = 201
const FUNDO = 562
const PERFIL: Perfil = {
  ini: [21, 146],
  segs: [
    { p: [21.5, 204] },
    { c1: [22, 226], c2: [40, 234], p: [60, 242] },
    { c1: [78, 249], c2: [MEIA, 258], p: [MEIA, 274] },
    { p: [MEIA, 566] },
    { c1: [MEIA, 575], c2: [81, 580], p: [72, 580] },
  ],
}

const R = { x1: 107, x2: 253, y1: 296, y2: 528 }
const LARANJA = '#ec7a1e'

/** Cabeça de cervo vista de frente (lado direito; o esquerdo é espelho). Origem no meio da testa. */
const CABECA =
  'M0 -14C9 -14 12 -6 10 4C8.5 12 5 20 0 24C-5 20 -8.5 12 -10 4C-12 -6 -9 -14 0 -14Z' +
  'M8.6 -9.4C15 -15 22 -15.6 26 -12.6C22 -6.6 15.4 -4.2 9.4 -4.4Z' +
  'M-8.6 -9.4C-15 -15 -22 -15.6 -26 -12.6C-22 -6.6 -15.4 -4.2 -9.4 -4.4Z' +
  'M-8.4 15C-14 25 -14.6 33 -11.4 41L11.4 41C14.6 33 14 25 8.4 15Z'
const GALHADA = 'M4.6 -13.4C8.6 -23 13 -30 22 -40.5M7.6 -21C12.4 -23.4 18 -23.8 25 -21.6M10.8 -27C15 -30 19.6 -32 27.4 -31.4M15 -32.2C15.4 -37.6 14.6 -42.4 12.4 -46.6M6 -16.4C9.6 -17.6 13.6 -17.2 17.4 -14.6M18.6 -37C22 -38 25.6 -41 27.6 -45'

export function Jagermeister({ id }: PropsArte) {
  const u = (s: string) => `${id}-${s}`
  const url = (s: string) => `url(#${u(s)})`
  const garrafa = contorno(CX, PERFIL)
  const dentro = contorno(CX, PERFIL, 4.5)
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
        <LG
          id={u('verde')}
          p={[
            [0, '#010402'],
            [0.05, '#06190d'],
            [0.11, '#12351f'],
            [0.2, '#1d4a2d'],
            [0.32, '#1a4229'],
            [0.5, '#11301d'],
            [0.7, '#0c2516'],
            [0.88, '#071a0e'],
            [0.94, '#1a4329'],
            [1, '#010402'],
          ]}
        />
        <LG id={u('licor')} p={[[0, '#2a0e04', 0.65], [0.15, '#5a220a', 0.5], [0.3, '#7e3612', 0.42], [0.5, '#4a1c07', 0.5], [0.85, '#250c03', 0.6], [1, '#150601', 0.7]]} />
        <LG id={u('licorV')} us x1={0} y1={NIVEL} x2={0} y2={FUNDO} p={[[0, '#000', 0.5], [0.18, '#000', 0.25], [0.5, '#000', 0], [1, '#000', 0.2]]} />
        <RG id={u('brasa')} cx={174} cy={548} r={92} sy={0.75} p={[[0, '#d8702e', 0.55], [0.5, '#9a4418', 0.2], [1, '#5a2008', 0]]} />
        <RG id={u('brasaOmbro')} cx={168} cy={268} r={74} sy={0.42} p={[[0, '#c0642a', 0.38], [1, '#c0642a', 0]]} />
        <LG id={u('base')} x2={0} y2={1} p={[[0, '#d8a070', 0.6], [0.14, '#10301c', 0.85], [0.55, '#1f5233', 0.6], [0.9, '#d8f5e2', 0.35], [1, '#000', 0]]} />
        <LG id={u('baseH')} p={[[0, '#000', 0.8], [0.12, '#000', 0.2], [0.3, '#fff', 0.1], [0.6, '#000', 0], [0.88, '#000', 0.35], [1, '#000', 0.8]]} />
        <LG id={u('hl')} p={[[0, '#fff', 0], [0.5, '#fff', 1], [1, '#fff', 0]]} />
        <LG id={u('fadeV')} us x1={0} y1={196} x2={0} y2={588} p={[[0, '#fff', 0.6], [0.12, '#fff', 1], [0.85, '#fff', 1], [1, '#fff', 0.1]]} />
        <mask id={u('mVidro')} maskUnits="userSpaceOnUse" x={0} y={0} width={360} height={640}>
          <rect x={0} y={194} width={360} height={396} fill={url('fadeV')} />
          <rect x={R.x1} y={R.y1} width={R.x2 - R.x1} height={R.y2 - R.y1} fill="#000" />
        </mask>
        <LG id={u('aro')} p={[[0, '#effff4', 0.75], [0.07, '#effff4', 0.22], [0.3, '#fff', 0], [0.8, '#d9f5e2', 0], [0.95, '#d9f5e2', 0.45], [1, '#fff', 0.85]]} />
        <LG id={u('laranja')} x1={0} y1={0} x2={1} y2={1} p={[[0, '#f8a24a'], [0.45, LARANJA], [1, '#c45810']]} />
        <LG id={u('laranjaCil')} p={cilindroMaterial({ borda: '#5a2400', base: '#d8691a', claro: '#f59a46', brilho: '#ffd2a0', sombra: '#8a3a08', aro: '#c85e14' })} />
        <RG id={u('aura')} cx={176} cy={366} r={48} p={[[0, '#fff3c6'], [0.42, '#ffc95e'], [0.85, '#f39434'], [1, '#e9801f']]} />
        <LG id={u('preto')} p={cilindroMaterial({ borda: '#000', base: '#0e0e0e', claro: '#2e2e2e', brilho: '#686868', sombra: '#040404', aro: '#262626' })} />
        <LG id={u('rotH')} x1={0} y1={0} x2={1} y2={1} p={[[0, '#fff', 0.14], [0.25, '#fff', 0.03], [0.6, '#000', 0], [1, '#000', 0.25]]} />
      </defs>

      {/* ---------- vidro verde e licor ---------- */}
      <path d={garrafa} fill={url('verde')} />
      <g clipPath={url('vidro')}>
        <rect x={CX - 26} y={146} width={52} height={64} fill={url('verde')} />
      </g>
      <g clipPath={url('dentro')}>
        <rect x={CX - 26} y={146} width={52} height={NIVEL - 146} fill="#000" fillOpacity={0.5} />
        <rect x={CX - MEIA} y={NIVEL} width={MEIA * 2} height={FUNDO - NIVEL} fill={url('licor')} />
        <rect x={CX - 24} y={NIVEL} width={48} height={40} fill={url('licor')} />
        <rect x={CX - MEIA} y={NIVEL} width={MEIA * 2} height={FUNDO - NIVEL} fill={url('licorV')} />
        <rect x={CX - MEIA} y={NIVEL} width={MEIA * 2} height={FUNDO - NIVEL} fill={url('brasa')} />
        <rect x={CX - MEIA} y={230} width={MEIA * 2} height={70} fill={url('brasaOmbro')} />
        <path d={dentro} fill="none" stroke="#010402" strokeOpacity={0.7} strokeWidth={3} />
      </g>
      <ellipse cx={CX} cy={NIVEL} rx={17} ry={1.5} fill="#e0a070" fillOpacity={0.3} stroke="#f2c8a0" strokeOpacity={0.7} strokeWidth={0.8} />
      <g clipPath={url('vidro')}>
        <rect x={CX - MEIA} y={FUNDO} width={MEIA * 2} height={20} fill={url('base')} />
        <rect x={CX - MEIA} y={FUNDO} width={MEIA * 2} height={20} fill={url('baseH')} />
        <rect x={CX - 72} y={FUNDO + 0.2} width={144} height={1.1} fill="#ffe2c4" fillOpacity={0.45} />
      </g>

      {/* ---------- chanfros e ombro ---------- */}
      <g clipPath={url('vidro')}>
        <rect x={CX - MEIA} y={266} width={MEIA - CHANFRO} height={310} fill="#fff" fillOpacity={0.12} />
        <rect x={CX - MEIA + 2} y={270} width={4} height={300} fill={url('hl')} opacity={0.7} />
        <rect x={CX + CHANFRO} y={266} width={MEIA - CHANFRO} height={310} fill="#000" fillOpacity={0.5} />
        <rect x={CX + MEIA - 3.2} y={272} width={2} height={296} fill="#d9f5e2" fillOpacity={0.3} />
        <rect x={CX - CHANFRO - 0.7} y={270} width={1.4} height={296} fill="#fff" fillOpacity={0.38} />
        <rect x={CX + CHANFRO - 0.5} y={270} width={1} height={296} fill="#fff" fillOpacity={0.16} />
        <path d={`M${CX - 24} 222 C${CX - 32} 234 ${CX - 56} 242 ${CX - 72} 250 C${CX - 80} 254 ${CX - 83} 260 ${CX - 84} 270`} fill="none" stroke="#fff" strokeOpacity={0.18} strokeWidth={9} strokeLinecap="round" />
        <path d={`M${CX - 23} 224 C${CX - 32} 235 ${CX - 56} 243 ${CX - 72} 250.6 C${CX - 80} 254.6 ${CX - 83} 261 ${CX - 83.6} 270`} fill="none" stroke="#fff" strokeOpacity={0.7} strokeWidth={1.8} strokeLinecap="round" />
        <path d={`M${CX + 25} 226 C${CX + 34} 236 ${CX + 58} 244 ${CX + 74} 252 C${CX + 81} 256 ${CX + 84} 262 ${CX + 84.4} 272`} fill="none" stroke="#d9f5e2" strokeOpacity={0.4} strokeWidth={1.3} strokeLinecap="round" />
      </g>

      {/* ---------- rótulo laranja ---------- */}
      <rect x={R.x1 + 0.8} y={R.y1 + 1} width={R.x2 - R.x1} height={R.y2 - R.y1} rx={3} fill="#000" fillOpacity={0.55} />
      <rect x={R.x1} y={R.y1} width={R.x2 - R.x1} height={R.y2 - R.y1} rx={3} fill="#121110" />
      {/* moldura com o poema em letra miúda (sugerido) */}
      <rect x={R.x1 + 4} y={R.y1 + 4} width={R.x2 - R.x1 - 8} height={R.y2 - R.y1 - 8} fill="none" stroke={LARANJA} strokeOpacity={0.75} strokeWidth={1.7} strokeDasharray="1.6 0.7 2.6 0.7 1 0.7 3.2 1.4 1.8 0.7 2.2 1.4" />
      <rect x={R.x1 + 8} y={R.y1 + 8} width={R.x2 - R.x1 - 16} height={R.y2 - R.y1 - 16} fill={url('laranja')} />
      <rect x={R.x1 + 11} y={R.y1 + 11} width={R.x2 - R.x1 - 22} height={R.y2 - R.y1 - 22} fill="none" stroke="#141210" strokeWidth={0.8} />
      {/* emblema: cervo com galhada */}
      <circle cx={CX} cy={370} r={47} fill={url('aura')} />
      <circle cx={CX} cy={370} r={47} fill="none" stroke="#141210" strokeWidth={2.4} />
      <circle cx={CX} cy={370} r={43} fill="none" stroke="#141210" strokeWidth={0.7} />
      <g transform={`translate(${CX} 376)`}>
        <g fill="none" stroke="#141210" strokeWidth={3.3} strokeLinecap="round" strokeLinejoin="round">
          <path d={GALHADA} />
          <path d={GALHADA} transform="scale(-1 1)" />
        </g>
        <path d={CABECA} fill="#141210" />
        <ellipse cx={4.6} cy={-1.6} rx={1.5} ry={1.1} fill="#f6b04e" />
        <ellipse cx={-4.6} cy={-1.6} rx={1.5} ry={1.1} fill="#f6b04e" />
        <path d="M-3 18.6Q0 21.4 3 18.6" fill="none" stroke="#f6b04e" strokeOpacity={0.55} strokeWidth={0.9} />
      </g>
      <text x={CX} y={460} fontFamily={FONTE.serifaPesada} fontWeight={700} fontSize={31} textAnchor="middle" textLength={134} lengthAdjust="spacingAndGlyphs" fill="#141210">
        Jägermeister
      </text>
      <path d={`M128 470.5 H232`} stroke="#141210" strokeWidth={1.2} />
      <path d={`M138 474 H222`} stroke="#141210" strokeWidth={0.5} />
      <text x={CX} y={490} fontFamily={FONTE.sans} fontWeight={700} fontSize={8.6} textAnchor="middle" textLength={80} lengthAdjust="spacing" fill="#141210">
        KRÄUTERLIKÖR
      </text>
      <g fontFamily={FONTE.sans} fontWeight={700} fontSize={9} fill="#141210">
        <text x={124} y={509}>35% vol</text>
        <text x={236} y={509} textAnchor="end">0,7 L</text>
      </g>
      <rect x={R.x1} y={R.y1} width={R.x2 - R.x1} height={R.y2 - R.y1} rx={3} fill={url('rotH')} />

      {/* ---------- reflexos do vidro ---------- */}
      <g clipPath={url('vidro')} mask={`url(#${u('mVidro')})`}>
        <rect x={111} y={200} width={34} height={385} fill={url('hl')} opacity={0.28} />
        <rect x={121} y={200} width={5} height={385} fill={url('hl')} opacity={0.65} />
        <rect x={232} y={220} width={14} height={360} fill={url('hl')} opacity={0.12} />
      </g>
      <rect x={CX - 17} y={194} width={5} height={30} fill={url('hl')} opacity={0.5} />
      <path d={garrafa} fill="none" stroke={url('aro')} strokeWidth={1.3} />

      {/* ---------- colarinho laranja ---------- */}
      <g>
        <path d={`M${CX - 22.4} 156 Q${CX} 153.6 ${CX + 22.4} 156 V194 Q${CX} 191.6 ${CX - 22.4} 194Z`} fill={url('laranjaCil')} />
        <path d={anel(159.6, 22.4)} fill="none" stroke="#141210" strokeWidth={0.8} />
        <path d={anel(190.6, 22.4)} fill="none" stroke="#141210" strokeWidth={0.8} />
        <text x={CX} y={178} fontFamily={FONTE.serifaPesada} fontWeight={700} fontSize={8.5} textAnchor="middle" textLength={34} lengthAdjust="spacingAndGlyphs" fill="#141210">
          Jägermeister
        </text>
        <path d={anel(184, 10, 1)} fill="none" stroke="#141210" strokeWidth={0.5} />
      </g>

      {/* ---------- tampa preta com aro laranja ---------- */}
      <g>
        <path d={`M${CX - 24.5} 150 V108 Q${CX - 24.5} 101 ${CX - 18} 100.5 H${CX + 18} Q${CX + 24.5} 101 ${CX + 24.5} 108 V150Z`} fill={url('preto')} />
        <Estrias cx={CX} raio={24.5} y1={108} y2={140} qtd={26} clara={0.16} escura={0.5} />
        <path d={anel(102, 19)} fill="none" stroke="#fff" strokeOpacity={0.35} strokeWidth={1} />
        <path d={`M${CX - 25.5} 141.5 Q${CX} 139 ${CX + 25.5} 141.5 V150 Q${CX} 152.4 ${CX - 25.5} 150Z`} fill={url('laranjaCil')} />
        <rect x={CX - 17} y={103} width={6} height={37} fill={url('hl')} opacity={0.25} />
      </g>
    </g>
  )
}
