// Geometria da rua, em pixels da grade (1 px da grade = 1 "pixel" da arte). Duas composições com o mesmo chão:
//
// A FAIXA (computador, e o celular deitado): altura fixa de 92 (a vaga reserva o lugar antes de o pedaço chegar: zero
// pulo); a largura sai da tela. Tudo encostado embaixo: muro, calçada, meio-fio e asfalto; a sobra de cima é muro
// sumindo no preto.
//
//   0 ───────── muro (some no preto nas linhas de cima)
//   76 ──────── calçada (8): fundo 79 (engradados), meio 80 (onde se anda), frente 82, beira 83
//   84 ──────── meio-fio (4)
//   88 ──────── asfalto (4): a moto pisa em 89
//   92
//
// EM PÉ (o primeiro story do celular): um mundo fixo de 176 × 281, o mesmo em todo celular (o pôster do build é ele),
// que o story recorta: no meio na largura e, na altura, com a linha de baixo da moto (ANCORA) logo acima dos adesivos
// do pé do story. Em cima o céu de madrugada, a fachada da loja subindo e o poste alto; embaixo o asfalto continua por
// trás dos adesivos e da barra "Enviar mensagem…". O que importa fica no meio (de 28 a 148: o que um celular de 360 px
// mostra a 3×).

/** Altura da faixa em pixels da grade. */
export const ALTURA = 92
/** Linha de cima da calçada na faixa. */
export const CALCADA = ALTURA - 16

/** Poste da faixa (a lâmpada cabe nas 92 linhas) e o do story em pé, alto. Os dois saem do mesmo worker. */
export const POSTE_FAIXA = CALCADA + 7 - 1
export const POSTE_EM_PE = 116

/** Largura máxima da faixa: mais larga, os clientes lentos levariam meia hora para chegar (o resto vira preto). */
export const LARGURA_MAX = 240
/** A faixa do story do celular deitado: um pouco mais curta, para o primeiro atendimento caber nos ~12 s do segmento. */
export const LARGURA_DEITADO = 220

/** O mundo em pé (story do celular): largura, linha da calçada e altura. */
export const EM_PE = { w: 176, calcada: 200, h: 281 } as const
/** Linha do mundo em pé que fica logo acima dos adesivos do story (a sombra da moto, 2 abaixo da roda). */
export const ANCORA = EM_PE.calcada + 15
/**
 * Linha do alto da cabeça do mercador parado no meio da calçada do mundo em pé (62 acima do pé, na arte dele): os
 * balões mais altos da cena saem dela.
 */
export const CABECA_MERCADOR = EM_PE.calcada + 4 - 62

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

/** Faixas do chão (linha do pé): mais embaixo = mais perto de quem olha (desenha por cima). */
export interface Chao {
  fundo: number
  meio: number
  frente: number
  beira: number
  /** A moto, no asfalto: 6 abaixo da beira, para a mão do motoboy bater na do mercador. */
  moto: number
}

export interface Palco {
  w: number
  h: number
  calcada: number
  meioFio: number
  asfalto: number
  chao: Chao
  /** O poste fica na beira da calçada; a luz começa debaixo da lâmpada e acaba na poça da calçada. */
  postePe: number
  luzTopo: number
  /** Folhas do poste e da luz (as do story em pé são as altas). */
  poste: string
  luz: string
  /** Pé do letreiro GC, em cima da porta (no story em pé, acima da cabeça de todo mundo). */
  letreiroPe: number
  lugar: Lugares
  /** Composição em pé: céu, prédio, janela. */
  emPe: boolean
  /** Some no preto nas pontas (cena que não vai de ponta a ponta). */
  bordas: boolean
  /** O pedaço do mundo que aparece (px da grade): quem chega entra por aqui e quem vai embora sai por aqui. */
  visivel: { x0: number; x1: number }
}

function chaoDe(calcada: number): Chao {
  return { fundo: calcada + 3, meio: calcada + 4, frente: calcada + 6, beira: calcada + 7, moto: calcada + 13 }
}

/**
 * Onde fica cada coisa numa faixa de `w` pixels de largura. O poste à esquerda com os engradados (e o gato) debaixo da
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

/** A faixa de `w` pixels (computador e celular deitado). */
export function palcoFaixa(w: number, bordas: boolean): Palco {
  const chao = chaoDe(CALCADA)
  return {
    w,
    h: ALTURA,
    calcada: CALCADA,
    meioFio: CALCADA + 8,
    asfalto: CALCADA + 12,
    chao,
    postePe: chao.beira,
    luzTopo: chao.beira - POSTE_FAIXA + 5,
    poste: 'poste',
    luz: 'luz',
    letreiroPe: CALCADA - 50,
    lugar: lugares(w),
    emPe: false,
    bordas,
    visivel: { x0: 0, x1: w },
  }
}

/**
 * A faixa no story do celular deitado: a de sempre, com o mercador atendendo mais perto da ponta direita, de onde vem o
 * primeiro cliente (o primeiro atendimento cabe nos ~12 s do segmento), e a porta com o letreiro do lado de cá dele,
 * longe da cabeça de quem chega (na faixa do computador os pontos ficam no meio e a porta na ponta).
 */
export function palcoFaixaStory(w: number): Palco {
  const p = palcoFaixa(w, true)
  const r = (f: number) => Math.round(w * f)
  return { ...p, lugar: { ...p.lugar, porta: r(0.38), pontoEsq: r(0.6), pontoDir: r(0.75), passeio: [r(0.5), r(0.66), p.lugar.engradado + 34] } }
}

/**
 * Lugares do mundo em pé: no meio de 360 px a 3× (de 28 a 148). O poste à esquerda, com os engradados e o gato na luz
 * dele; a porta à direita; o mercador atende no meio, de um lado ou do outro da conversa.
 */
const LUGARES_EM_PE: Lugares = {
  w: EM_PE.w,
  poste: 34,
  engradado: 48,
  porta: 130,
  pontoEsq: 80,
  pontoDir: 110,
  passeio: [94, 108, 86],
}

/** O mundo em pé, com o pedaço que o story mostra (`visivel`, px da grade). */
export function palcoEmPe(visivel: { x0: number; x1: number }): Palco {
  const c = EM_PE.calcada
  const chao = chaoDe(c)
  return {
    w: EM_PE.w,
    h: EM_PE.h,
    calcada: c,
    meioFio: c + 8,
    asfalto: c + 12,
    chao,
    postePe: chao.beira,
    luzTopo: chao.beira - POSTE_EM_PE + 5,
    poste: 'poste-alto',
    luz: 'luz-alta',
    letreiroPe: c - 78,
    lugar: LUGARES_EM_PE,
    emPe: true,
    bordas: true,
    visivel: { x0: Math.max(0, Math.floor(visivel.x0)), x1: Math.min(EM_PE.w, Math.ceil(visivel.x1)) },
  }
}

/** Altura da luz do poste (da lâmpada até a poça da calçada) para um poste de `altura` linhas. */
export const alturaDaLuz = (altura: number) => altura - 4

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
