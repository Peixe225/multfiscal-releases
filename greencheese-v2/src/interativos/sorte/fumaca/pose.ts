// Onde o beck para no meio da tela (o jogo faz ele subir da câmara do dichavador até aqui e a RevelacaoFumaca
// assume dali: os dois usam esta conta, pra emenda não pular). Medidas em px de CSS, no palco da fumaça.

export interface PoseBeck {
  /** Centro do beck. */
  x: number
  y: number
  /** Altura do beck (a largura é 1/4: viewBox 60×240). */
  h: number
  /** Inclinação em graus (a ponta pra direita). */
  ang: number
}

/** A proporção do desenho do beck (viewBox 60 × 240). */
export const PROPORCAO_BECK = 0.25

export function poseDoBeck(w: number, h: number): PoseBeck {
  const alt = Math.round(Math.max(120, Math.min(h * 0.5, w * 0.72, 330)))
  return { x: Math.round(w / 2), y: Math.round(h * 0.47), h: alt, ang: 16 }
}
