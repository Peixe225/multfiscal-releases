// O roteiro da revelação da fumaça, por raridade (pedido do Ian em 11/10: "quanto mais raro, mais incrível").
// Tempos em segundos a partir do beck parado no meio da tela (no modo 'previa', o beck sobe antes: SUBIDA).
// Cada raridade tem a SUA animação, não só outra cor:
//   comum    ~3,8 s · 1 puxada, uma nuvem cinza-clara, o prêmio com brilho prateado e brilhinhos
//   raro     ~4,9 s · 2 puxadas, fumaça azul-petróleo, argolas voando, faíscas azuis, raios azuis atrás do prêmio
//   épico    ~5,9 s · 3 puxadas, fumaça que vira de matiz, olhos enormes que abrem e piscam, a boca que sopra o prêmio
//   lendário ~7,4 s · 3 puxadas rápidas, vórtice/túnel holográfico com caleidoscópio, formas flutuando, clarão,
//                     câmera lenta e tremida, o prêmio desce pelo túnel com raios dourados, confete e o carimbo batendo
import type { Raridade } from '../../../lib/raridade'

/** No modo 'previa' (teste do painel) o beck sobe do pé da tela antes (no jogo ele sobe da câmara do dichavador). */
export const SUBIDA = 0.7

export interface Puxada {
  /** Começo: a brasa começa a incandescer. */
  de: number
  /** Fim: a brasa volta ao normal. */
  ate: number
  /** Quanto o papel queima nela (fração do comprimento que queima). */
  queima: number
  /** Força (brilho e faíscas), 0–1. */
  forca: number
}

export interface Roteiro {
  raridade: Raridade
  /** A chama de desenho aparece na ponta torcida. */
  acende: number
  /** A torcida queima com um "pop" e a brasa acende. */
  pop: number
  puxadas: Puxada[]
  /** O sopro: as nuvens entram pelo pé da tela (quem fuma é quem olha). */
  sopro: number
  /** Quantas ondas de nuvem e o intervalo entre elas. */
  ondas: number
  intervaloOndas: number
  /** Quantas nuvens (bolhas) no sopro inteiro. */
  nuvens: number
  /** O quadro fica cheio. */
  cheio: number
  /** A fumaça abre no meio (o buraco do prêmio). */
  abre: number
  /** Quanto tempo leva pra abrir. */
  abreDur: number
  /** O prêmio entra (escala com passada). */
  premio: number
  /** O carimbo da raridade bate. */
  carimbo: number
  /** Assentou: onPronto. */
  pronto: number
  /** Quanto o zoom "respira" nas puxadas (1 = nada). */
  respira: number
  /** Paleta da fumaça: contorno, sombra, meio, luz (hex). */
  cores: [string, string, string, string]
  /** A camada de trás (mais escura). */
  coresFundo: [string, string, string, string]
  /** A cor da brasa e da chama mudam pouco: só o lendário tem a chama dourada. */
  chamaDourada: boolean
  /** Raro: as argolas (tempo em que cada uma sai). */
  aneis?: number[]
  /** Épico: os olhos e a boca. */
  rosto?: { olhosAbrem: number; olhaEsq: number; olhaDir: number; pisca: number; olhaFrente: number; sorri: number; bico: number; sopra: number; some: number }
  /** Épico e lendário: a fumaça vira de matiz (psicodélica) a partir daqui. */
  psicodelia?: number
  /** Lendário: o vórtice, o túnel, o clarão e a descida. */
  tunel?: { gira: number; abre: number; caleido: number; formas: number; clarao: number; lento: [number, number]; desce: number; recua: number }
  /** Faíscas e brilhos em volta do prêmio. */
  brilhos: 'prata' | 'azul' | 'rosa' | 'ouro'
  /** Raios atrás do prêmio (raro azul, lendário dourado). */
  raios?: { de: number; n: number }
  /** Ondulação da tela (épico). */
  onda?: [number, number]
  /** Tremida (lendário). */
  tremida?: [number, number]
  /** Confete em pixel (lendário). */
  confete?: number
}

const CINZA: Roteiro['cores'] = ['#1b2228', '#8a97a1', '#c4cdd4', '#f1f4f6']
const CINZA_FUNDO: Roteiro['cores'] = ['#141a1f', '#5d6a74', '#8794a0', '#aeb9c2']
// azul-petróleo puxado pro azul (nada de verde: o verde é só do anel dos Melhores amigos)
const PETROLEO: Roteiro['cores'] = ['#04192c', '#135574', '#2a86b2', '#8fd2f2']
const PETROLEO_FUNDO: Roteiro['cores'] = ['#03111f', '#0c3a52', '#185f82', '#3f90b8']
const ROSA: Roteiro['cores'] = ['#2e0520', '#b0216e', '#ff5cae', '#ffc6e4']
const ROSA_FUNDO: Roteiro['cores'] = ['#1e0316', '#741249', '#b83a80', '#e07fb4']
// lendário: creme dourado com sombra violeta
const OURO: Roteiro['cores'] = ['#24103a', '#9a5fd0', '#ffd877', '#fff6d6']
const OURO_FUNDO: Roteiro['cores'] = ['#170a28', '#5b3590', '#c79a45', '#f0d48c']

export const ROTEIROS: Record<Raridade, Roteiro> = {
  comum: {
    raridade: 'comum',
    acende: 0.18,
    pop: 0.6,
    puxadas: [{ de: 0.78, ate: 1.36, queima: 0.22, forca: 0.7 }],
    sopro: 1.48,
    ondas: 2,
    intervaloOndas: 0.2,
    nuvens: 22,
    cheio: 2.15,
    abre: 2.3,
    abreDur: 0.62,
    premio: 2.5,
    carimbo: 2.95,
    pronto: 3.8,
    respira: 1.03,
    cores: CINZA,
    coresFundo: CINZA_FUNDO,
    chamaDourada: false,
    brilhos: 'prata',
  },
  raro: {
    raridade: 'raro',
    acende: 0.18,
    pop: 0.56,
    puxadas: [
      { de: 0.72, ate: 1.22, queima: 0.16, forca: 0.7 },
      { de: 1.32, ate: 1.92, queima: 0.2, forca: 0.9 },
    ],
    sopro: 1.98,
    ondas: 3,
    intervaloOndas: 0.18,
    nuvens: 26,
    cheio: 2.7,
    abre: 3.0,
    abreDur: 0.6,
    premio: 3.2,
    carimbo: 3.7,
    pronto: 4.9,
    respira: 1.035,
    cores: PETROLEO,
    coresFundo: PETROLEO_FUNDO,
    chamaDourada: false,
    aneis: [2.2, 2.34, 2.48, 2.62],
    brilhos: 'azul',
    raios: { de: 3.3, n: 10 },
  },
  epico: {
    raridade: 'epico',
    acende: 0.18,
    pop: 0.52,
    puxadas: [
      { de: 0.66, ate: 1.08, queima: 0.12, forca: 0.7 },
      { de: 1.16, ate: 1.6, queima: 0.14, forca: 0.85 },
      { de: 1.68, ate: 2.16, queima: 0.18, forca: 1 },
    ],
    sopro: 2.18,
    ondas: 4,
    intervaloOndas: 0.15,
    nuvens: 30,
    cheio: 2.9,
    abre: 4.5,
    abreDur: 0.55,
    premio: 4.5,
    carimbo: 5.02,
    pronto: 5.9,
    respira: 1.04,
    cores: ROSA,
    coresFundo: ROSA_FUNDO,
    chamaDourada: false,
    psicodelia: 2.4,
    rosto: { olhosAbrem: 2.95, olhaEsq: 3.35, olhaDir: 3.58, pisca: 3.78, olhaFrente: 3.95, sorri: 3.9, bico: 4.3, sopra: 4.5, some: 4.44 },
    brilhos: 'rosa',
    onda: [2.6, 5.3],
  },
  lendario: {
    raridade: 'lendario',
    acende: 0.16,
    pop: 0.46,
    puxadas: [
      { de: 0.56, ate: 0.88, queima: 0.16, forca: 0.85 },
      { de: 0.92, ate: 1.24, queima: 0.18, forca: 0.95 },
      { de: 1.28, ate: 1.68, queima: 0.22, forca: 1 },
    ],
    sopro: 1.7,
    ondas: 4,
    intervaloOndas: 0.12,
    nuvens: 32,
    cheio: 2.35,
    abre: 4.5,
    abreDur: 0.9,
    premio: 4.62,
    carimbo: 5.72,
    pronto: 7.4,
    respira: 1.05,
    cores: OURO,
    coresFundo: OURO_FUNDO,
    chamaDourada: true,
    psicodelia: 2.5,
    tunel: { gira: 2.4, abre: 2.62, caleido: 3.0, formas: 3.0, clarao: 4.45, lento: [4.45, 5.6], desce: 4.62, recua: 5.7 },
    brilhos: 'ouro',
    raios: { de: 4.9, n: 16 },
    tremida: [4.45, 5.9],
    confete: 5.74,
  },
}

/** A duração total do roteiro (até o onPronto), já com a subida no modo 'previa'. */
export function duracao(r: Raridade, previa: boolean): number {
  return ROTEIROS[r].pronto + (previa ? SUBIDA : 0)
}
