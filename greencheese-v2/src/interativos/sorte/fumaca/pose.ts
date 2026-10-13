// Onde o beck para no meio da tela (pedido do dono da obra: deitado ~35° (+2° quando o isqueiro chega), com presença: ~48% da altura do quadro no
// celular). Medidas em px de CSS, no palco da fumaça. No jogo o beck sobe da câmara do dichavador até aqui, desenhado
// pela própria fumaça (a origem vem do jogo, ver index.tsx: comecarFumaca).

export interface PoseBeck {
  /** Centro do beck. */
  x: number
  y: number
  /** Comprimento inteiro (da boca da piteira à ponta, sem a torcida). */
  L: number
  /** Inclinação em graus a partir da vertical (a ponta pra cima à direita). */
  ang: number
}

export function poseDoBeck(w: number, h: number): PoseBeck {
  // o conjunto deitado (do pé da piteira à torcida e ao isqueiro, que chega por baixo dela) ocupa uns 0,82·L de largura:
  // cabe com 16 px de folga dos dois lados
  const L = Math.round(Math.max(150, Math.min(h * 0.46, (w - 32) * 1.15, 460)))
  // o meio do beck fica à esquerda do meio do quadro: a ponta (a torcida e o isqueiro) inteira à vista, à direita
  return { x: Math.round(w / 2 - 0.12 * L), y: Math.round(h * 0.52), L, ang: 35 }
}
