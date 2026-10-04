// Logo da Green Cheese redesenhado em SVG: círculo preto, cuia em linha branca,
// GREEN CHEESE grosso e inclinado dentro da cuia, tesoura aberta pousada na borda.
// Os paths vêm de logo-paths.ts (gerado por scripts/gerar-logo.mjs).
//
// Ganchos para a animação de abertura (GSAP):
//   .logo-cuia     → <path pathLength="1"> com stroke: desenhar com stroke-dasharray "1 2" e dashoffset 1 → 0.
//                    No GSAP use autoRound: false (senão ele arredonda o dashoffset em px e pula de 1 para 0).
//                    "1 2" (e não "1") evita o pontinho da ponta redonda quando está escondido.
//   .logo-tesoura  → .logo-lamina-a / .logo-lamina-b giram em torno do parafuso (LOGO_PIVO);
//                    fechar = rotation LOGO_FECHAR.a / LOGO_FECHAR.b, com svgOrigin: LOGO_ORIGEM_GSAP.
//                    Em CSS puro, o transform-origin no parafuso já vem no style de cada lâmina.
//   .logo-texto    → "GREEN" (.logo-texto-green) e "CHEESE" (.logo-texto-cheese)
import { useId, type CSSProperties } from 'react'
import {
  LOGO_CIRCULO,
  LOGO_CUIA,
  LOGO_FOLGA,
  LOGO_LAMINAS,
  LOGO_PIVO,
  LOGO_TEXTO,
  LOGO_TRACO,
  LOGO_VIEWBOX,
} from './logo-paths'

export { LOGO_VIEWBOX, LOGO_PIVO, LOGO_FECHAR } from './logo-paths'

/** Parafuso no formato do svgOrigin do GSAP: gsap.to('.logo-lamina-a', { rotation: LOGO_FECHAR.a, svgOrigin: LOGO_ORIGEM_GSAP }). */
export const LOGO_ORIGEM_GSAP = `${LOGO_PIVO.x} ${LOGO_PIVO.y}`

export interface LogoProps {
  /** Largura/altura do SVG (número = px). Padrão 120. */
  tamanho?: number | string
  className?: string
  /** Texto acessível. Padrão "Green Cheese Imports". Vazio = decorativo (aria-hidden). */
  titulo?: string
  /** 'circulo' (padrão) = foto de perfil; 'sem-circulo' = só o desenho, para pôr sobre o preto. */
  variante?: 'circulo' | 'sem-circulo'
}

// As lâminas giram em torno do parafuso, em coordenadas do viewBox (sem transform nos pais).
const estiloLamina: CSSProperties = {
  transformBox: 'view-box',
  transformOrigin: `${LOGO_PIVO.x}px ${LOGO_PIVO.y}px`,
}

export function Logo({ tamanho = 120, className, titulo = 'Green Cheese Imports', variante = 'circulo' }: LogoProps) {
  const idTitulo = useId()
  // Respiro entre elementos que se cruzam: preto do círculo, ou a cor do fundo da página (--logo-fundo).
  const respiro = variante === 'circulo' ? '#000' : 'var(--logo-fundo, #000)'
  const comRespiro: CSSProperties = { paintOrder: 'stroke' }
  const decorativo = titulo === ''

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={LOGO_VIEWBOX}
      width={tamanho}
      height={tamanho}
      className={className ? `logo logo--${variante} ${className}` : `logo logo--${variante}`}
      role={decorativo ? undefined : 'img'}
      aria-hidden={decorativo ? true : undefined}
      aria-labelledby={decorativo ? undefined : idTitulo}
      focusable="false"
    >
      {!decorativo && <title id={idTitulo}>{titulo}</title>}

      {variante === 'circulo' && (
        <circle className="logo-fundo" cx={LOGO_CIRCULO.cx} cy={LOGO_CIRCULO.cy} r={LOGO_CIRCULO.r} fill="#000" />
      )}

      <g
        className="logo-cuia"
        fill="none"
        stroke="#fff"
        strokeWidth={LOGO_TRACO}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path className="logo-cuia-corpo" d={LOGO_CUIA.corpo} pathLength={1} />
        <path className="logo-cuia-pe" d={LOGO_CUIA.pe} pathLength={1} />
        <path className="logo-cuia-borda" d={LOGO_CUIA.borda} pathLength={1} />
      </g>

      <g className="logo-texto" fill="#fff" stroke={respiro} strokeWidth={LOGO_FOLGA * 2} strokeLinejoin="round" style={comRespiro}>
        <path className="logo-texto-green" d={LOGO_TEXTO.green} />
        <path className="logo-texto-cheese" d={LOGO_TEXTO.cheese} />
      </g>

      <g className="logo-tesoura" fill="#fff" stroke={respiro} strokeWidth={LOGO_FOLGA * 2} strokeLinejoin="round" style={comRespiro}>
        <g className="logo-lamina-a" style={estiloLamina}>
          <path d={LOGO_LAMINAS.a} />
        </g>
        <g className="logo-lamina-b" style={estiloLamina}>
          <path d={LOGO_LAMINAS.b} />
        </g>
        <circle className="logo-parafuso" cx={LOGO_PIVO.x} cy={LOGO_PIVO.y} r={LOGO_PIVO.r} fill={respiro} stroke="none" />
      </g>
    </svg>
  )
}
