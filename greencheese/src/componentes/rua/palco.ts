// Geometria da rua, em pixels da grade (1 px da grade = 1 "pixel" da arte). A altura é fixa (a faixa reserva o lugar
// antes de o pedaço chegar: zero pulo); a largura sai da tela. Tudo encostado embaixo: muro, calçada, meio-fio e
// asfalto; a sobra de cima é muro sumindo no preto.
//
//   0 ───────── muro (some no preto nas linhas de cima)
//   76 ──────── calçada (8): fundo 79 (engradados), meio 80 (onde se anda), frente 82, beira 83
//   84 ──────── meio-fio (4)
//   88 ──────── asfalto (4): a moto pisa em 89
//   92

/** Altura da cena em pixels da grade. */
export const ALTURA = 92
export const CALCADA = ALTURA - 16
export const MEIO_FIO = CALCADA + 8
export const ASFALTO = CALCADA + 12

/** Faixas do chão (linha do pé): mais embaixo = mais perto de quem olha (desenha por cima). */
export const CHAO = {
  fundo: CALCADA + 3,
  meio: CALCADA + 4,
  frente: CALCADA + 6,
  beira: CALCADA + 7,
  /** A moto, no asfalto: 6 abaixo da beira, para a mão do motoboy bater na do mercador. */
  moto: CALCADA + 13,
} as const

/** O poste fica na beira da calçada, com a lâmpada na linha 1. */
export const POSTE_PE = CHAO.beira
export const ALTURA_POSTE = POSTE_PE - 1
/** A luz começa debaixo da lâmpada (5 abaixo do topo do poste) e acaba na poça da calçada. */
export const LUZ_TOPO = POSTE_PE - ALTURA_POSTE + 5
export const ALTURA_LUZ = MEIO_FIO - LUZ_TOPO

/** Largura máxima da cena: mais larga, os clientes lentos levariam meia hora para chegar (o resto vira preto). */
export const LARGURA_MAX = 240

export interface Lugares {
  w: number
  poste: number
  porta: number
  engradado: number
  /** Onde o mercador atende: à esquerda (olhando para a direita) ou à direita (olhando para a esquerda). */
  pontoEsq: number
  pontoDir: number
  /** Lugares de passeio entre um cliente e outro. */
  passeio: number[]
}

/**
 * Onde fica cada coisa numa rua de `w` pixels de largura. O poste à esquerda com os engradados (e o gato) debaixo da
 * luz; a porta da loja com o letreiro à direita, fora dos dois pontos de atender (o GC fica à vista); o meio da rua
 * livre para a conversa.
 */
export function lugares(w: number): Lugares {
  const poste = Math.max(14, Math.round(w * 0.1))
  const engradado = poste + 18
  const porta = Math.min(w - 19, Math.round(w * 0.82))
  const pontoEsq = Math.round(w * 0.4)
  const pontoDir = Math.round(w * 0.62)
  return {
    w,
    poste,
    porta,
    engradado,
    pontoEsq,
    pontoDir,
    // no meio, na frente da porta, perto da luz
    passeio: [Math.round(w * 0.5), porta - 20, engradado + 34],
  }
}

/**
 * Escala: px do aparelho por pixel da grade (inteiro) a partir dos px de CSS pedidos. A faixa ocupa ALTURA × k / dpr
 * px de CSS: em DPR quebrado (2,625) cada pixel fica com 5 px do aparelho, sem pixel torto.
 */
export function escalaDoAparelho(kCss: number, dpr: number): number {
  return Math.max(1, Math.round(kCss * dpr))
}

/** Altura da faixa em px de CSS (a mesma conta que a rua faz depois, para reservar o lugar certo). */
export function alturaDaFaixa(kCss: number, dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1): number {
  return (ALTURA * escalaDoAparelho(kCss, dpr)) / dpr
}
