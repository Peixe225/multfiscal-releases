// O roteiro da revelação da fumaça, por raridade (pedido do Ian em 11/10: "quanto mais raro, mais incrível").
// Tempos em segundos a partir do beck começando a subir (no jogo, da câmara do dichavador, quando a tampa voa; no modo
// 'previa', do pé da tela). Cada raridade tem a SUA viagem, crescendo:
//   comum    ~3,8 s · 1 puxada funda, a baforada grande engole o beck, a fumaça rola e se desfia; um sorriso preguiçoso
//                     e um olho que pisca numa nuvem
//   raro     ~5,1 s · 2 puxadas, 3 argolas saem da fumaça, se enrolam numa espiral que vira um olho azul, pisca, a
//                     pupila dilata e o prêmio sai dela; a íris fica de moldura e se parte nos raios
//   épico    ~6,5 s · 3 puxadas, a fumaça em faixas psicodélicas (isolinhas), uma cabeça de fumaça cor-de-rosa abre os
//                     olhos (pálpebra pesada, pupila em espiral), olha pros lados, pisca, sorri, enche as bochechas e
//                     sopra o prêmio pela boca
//   lendário ~7,2 s · 3 puxadas, um portal (túnel em caleidoscópio, puxado pro ouro) com a fumaça só de moldura, 8 olhos
//                     abrindo em onda na borda, olhando pro meio e piscando juntos, a borda derretendo, estrelas, o clarão
//                     e o prêmio descendo pelo túnel em câmera lenta
// Cada puxada tem 4 tempos (antecipação, puxa, segura, solta) e entre uma e outra a brasa volta a ≤ 0,25; depois de cada
// uma (menos a última) uma baforada pequena sobe pelo canto vazio. A última desemboca no sopro: com a brasa ainda no
// máximo, a baforada grande sai em jato do pé da tela (de onde fica a boca de quem fuma, embaixo da piteira) e, junto
// com a fumaça que a brasa solta, engole o beck; a fumaça enche a tela rolando e a viagem acontece nela.
import type { Raridade } from '../../../lib/raridade'

/** No modo 'previa' (teste do painel) o beck sobe do pé da tela; no jogo, da câmara: o mesmo tempo. */
export const SUBIDA = 0.62

export interface Puxada {
  /** Antecipação: a brasa cai, o beck encolhe no eixo e recua um pouco. */
  de: number
  /** Puxa: a brasa incandesce, a linha de queima avança, a cinza cresce, o beck estica. */
  puxa: number
  /** Segura no máximo (cintila). */
  segura: number
  /** Solta: a luz cai, o beck volta passando um pouco e assenta. */
  solta: number
  ate: number
  /** Fração do comprimento que queima nela. */
  queima: number
  forca: number
  /** A baforada que sobe pelo canto depois dela (fração da largura); 0 = a última (vem o sopro grande). */
  baforada: number
}

export interface Roteiro {
  raridade: Raridade
  /** O beck chega na pose (com o assentamento até `assenta`). */
  pousa: number
  assenta: number
  isqueiro: { entra: number; clique: number; lambe: number; pega: number; sai: number; fora: number }
  puxadas: Puxada[]
  /** A cinza racha e cai (fim de uma puxada). */
  cinzaCai: number[]
  /** O sopro grande: a baforada sai em jato do pé da tela e engole o beck (que some dentro da fumaça em `cheio`). */
  sopro: number
  /** Quantas nuvens grandes no jato. */
  nuvens: number
  cheio: number
  /** A fumaça abre no meio (o buraco do prêmio) e quanto leva. */
  abre: number
  abreDur: number
  /** O prêmio entra; o carimbo bate; assentou (onPronto). */
  premio: number
  carimbo: number
  pronto: number
  /** A escala final do cartão (cresce com a raridade). */
  escala: number
  /** Paleta da fumaça: contorno, sombra, meio, luz; e a de trás. */
  cores: [string, string, string, string]
  coresFundo: [string, string, string, string]
  /** As faixas psicodélicas (isolinhas): de quando e as 5 cores. */
  iso?: { de: number; cores: [string, string, string, string, string]; contorno: string; vel: number }
  chamaDourada: boolean
  /** Comum: o sorriso abre, o olho pisca, some quando a fumaça abre. */
  sorriso?: { abre: number; pisca: number; some: number }
  /** Raro: as argolas saem da fumaça, se juntam, a espiral gira, vira olho, pisca, a pupila dilata. */
  espiral?: { aneis: number[]; junta: number; gira: number; iris: number; pisca: number; dilata: number; aro: number }
  /** Épico: a cabeça junta, os olhos abrem, olham, piscam, a boca sorri, as bochechas enchem e sopram. */
  rosto?: { cabeca: number; olhosAbrem: number; olhaEsq: number; olhaDir: number; olhaFrente: number; sorri: number; bochecha: number; sopra: number; piscadela: number }
  /** Lendário: o portal abre, os olhos em onda, olham pro meio, piscam juntos, a borda derrete, o clarão, a descida. */
  portal?: { abre: number; olhos: number; olham: number; piscam: number; derrete: number; clarao: number; desce: number; lento: [number, number]; recua: number }
  brilhos: 'prata' | 'azul' | 'rosa' | 'ouro'
  raios?: { de: number; n: number; cor: string; miolo: string }
  tremida?: [number, number]
  confete?: number
}

const CINZA: Roteiro['cores'] = ['#1b2228', '#8a97a1', '#c4cdd4', '#f1f4f6']
const CINZA_FUNDO: Roteiro['cores'] = ['#141a1f', '#5d6a74', '#8794a0', '#aeb9c2']
// azul do raro, puxado pra cor do carimbo (nada de verde-azulado)
const AZUL: Roteiro['cores'] = ['#061a33', '#1d5f9a', '#4fa9e6', '#b4e0ff']
const AZUL_FUNDO: Roteiro['cores'] = ['#04142a', '#174a7a', '#3a86c4', '#8cc6f0']
const ROSA: Roteiro['cores'] = ['#2e0520', '#b0216e', '#ff5cae', '#ffc6e4']
const ROSA_FUNDO: Roteiro['cores'] = ['#1e0316', '#741249', '#b83a80', '#e07fb4']
// lendário: a moldura dourada (o violeta só no contorno)
const OURO: Roteiro['cores'] = ['#24103a', '#c79a45', '#ffd877', '#fff6d6']
const OURO_FUNDO: Roteiro['cores'] = ['#170a28', '#8a6a2e', '#c79a45', '#f0d48c']

/** O começo é igual em todas: o beck sobe e assenta, o isqueiro entra de lado ainda na subida, a torcida pega. */
const ISQUEIRO = { entra: 0.4, clique: 0.6, lambe: 0.66, pega: 0.9, sai: 0.96, fora: 1.16 }

const pux = (de: number, puxa: number, segura: number, solta: number, ate: number, queima: number, forca: number, baforada: number): Puxada => ({ de, puxa, segura, solta, ate, queima, forca, baforada })

export const ROTEIROS: Record<Raridade, Roteiro> = {
  comum: {
    raridade: 'comum',
    pousa: 0.62,
    assenta: 0.78,
    isqueiro: ISQUEIRO,
    // uma puxada só, a mais funda: a cinza cresce, pende e vai junto com o beck pra dentro da fumaça
    puxadas: [pux(1.02, 1.14, 1.52, 1.62, 1.9, 0.24, 1, 0)],
    cinzaCai: [],
    sopro: 1.6,
    nuvens: 22,
    cheio: 2.16,
    abre: 3.06,
    abreDur: 0.5,
    premio: 3.16,
    carimbo: 3.48,
    pronto: 3.76,
    escala: 1,
    cores: CINZA,
    coresFundo: CINZA_FUNDO,
    chamaDourada: false,
    sorriso: { abre: 2.36, pisca: 2.7, some: 3.0 },
    brilhos: 'prata',
  },
  raro: {
    raridade: 'raro',
    pousa: 0.62,
    assenta: 0.78,
    isqueiro: ISQUEIRO,
    puxadas: [pux(1.0, 1.12, 1.42, 1.52, 1.72, 0.13, 0.78, 0.12), pux(1.86, 1.98, 2.3, 2.4, 2.66, 0.17, 1, 0)],
    cinzaCai: [1.7],
    sopro: 2.38,
    nuvens: 22,
    cheio: 2.94,
    abre: 4.52,
    abreDur: 0.36,
    premio: 4.56,
    carimbo: 4.88,
    pronto: 5.14,
    escala: 1.04,
    cores: AZUL,
    coresFundo: AZUL_FUNDO,
    chamaDourada: false,
    espiral: { aneis: [2.98, 3.1, 3.22], junta: 3.4, gira: 3.6, iris: 3.9, pisca: 4.14, dilata: 4.45, aro: 4.56 },
    brilhos: 'azul',
    raios: { de: 4.84, n: 10, cor: '#35a7ff', miolo: '#b4e0ff' },
  },
  epico: {
    raridade: 'epico',
    pousa: 0.62,
    assenta: 0.78,
    isqueiro: ISQUEIRO,
    puxadas: [pux(1.0, 1.12, 1.4, 1.5, 1.7, 0.11, 0.7, 0.12), pux(1.86, 1.98, 2.28, 2.38, 2.58, 0.13, 0.85, 0.14), pux(2.74, 2.86, 3.28, 3.38, 3.64, 0.16, 1, 0)],
    cinzaCai: [2.54],
    sopro: 3.36,
    nuvens: 22,
    cheio: 3.9,
    abre: 5.8,
    abreDur: 0.4,
    premio: 5.82,
    carimbo: 6.28,
    pronto: 6.54,
    escala: 1.08,
    cores: ROSA,
    coresFundo: ROSA_FUNDO,
    iso: { de: 3.62, cores: ['#ff5cae', '#ff9a3d', '#9466ff', '#35b8ff', '#ffd877'], contorno: '#2e0520', vel: 2.4 },
    chamaDourada: false,
    rosto: { cabeca: 3.98, olhosAbrem: 4.44, olhaEsq: 4.7, olhaDir: 4.92, olhaFrente: 5.12, sorri: 5.38, bochecha: 5.66, sopra: 5.81, piscadela: 6.38 },
    brilhos: 'rosa',
  },
  lendario: {
    raridade: 'lendario',
    pousa: 0.62,
    assenta: 0.78,
    isqueiro: ISQUEIRO,
    puxadas: [pux(1.0, 1.12, 1.4, 1.5, 1.7, 0.14, 0.8, 0.12), pux(1.86, 1.98, 2.28, 2.38, 2.58, 0.16, 0.9, 0.14), pux(2.74, 2.86, 3.28, 3.38, 3.64, 0.2, 1, 0)],
    cinzaCai: [2.54],
    sopro: 3.36,
    nuvens: 22,
    cheio: 3.9,
    abre: 5.5,
    abreDur: 0.8,
    premio: 5.5,
    carimbo: 6.6,
    pronto: 7.24,
    escala: 1.12,
    cores: OURO,
    coresFundo: OURO_FUNDO,
    chamaDourada: true,
    portal: { abre: 3.92, olhos: 4.2, olham: 4.8, piscam: 4.98, derrete: 4.64, clarao: 5.46, desce: 5.5, lento: [5.46, 6.34], recua: 6.54 },
    brilhos: 'ouro',
    raios: { de: 5.94, n: 16, cor: '#ffd45c', miolo: '#fff1b8' },
    tremida: [5.46, 5.84],
    confete: 6.62,
  },
}

/** A duração total do roteiro (até o onPronto). */
export function duracao(r: Raridade): number {
  return ROTEIROS[r].pronto
}
