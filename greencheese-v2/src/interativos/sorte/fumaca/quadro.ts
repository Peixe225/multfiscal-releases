// O quadro que a cena (cena.ts) monta a cada desenho e o pintor em pixel (pixel.ts) pinta: tudo em px de CSS do palco
// (origem no canto de cima à esquerda, y pra baixo). Os objetos são criados uma vez e reescritos a cada quadro (nada é
// alocado no meio da animação).

/** Bolhas da fumaça (metaballs): 8 números por bolha. */
export const NB = 112
export const PASSO_BOLHA = 8
/** Camada de cada bolha: o fundo (mais escuro, atrás do beck), a frente e a cabeça do épico (uma cor só, por cima). */
export const FUNDO = 0
export const FRENTE = 1
export const CABECA = 2

/** As 4 cores de uma camada de fumaça (cores já em Uint32 do ImageData). */
export interface Paleta {
  contorno: number
  sombra: number
  meio: number
  luz: number
}

export interface EstadoBeckPx {
  vis: boolean
  /** A ponta da piteira (a boca) e o eixo (unitário, da piteira pra ponta). */
  x0: number
  y0: number
  ax: number
  ay: number
  /** O comprimento inteiro (sem queimar) e o estica-e-encolhe (ao longo, de través). */
  L: number
  sx: number
  sy: number
  /** Onde está a linha de queima (fração do comprimento a partir da piteira: 1 = inteiro). */
  linha: number
  /** A cinza: comprimento (px), quanto pende (px, pro lado da gravidade), rachando (0–1). */
  cinza: number
  pende: number
  racha: number
  /** A brasa acesa (0–1) e o brilho da puxada (0–1). */
  brasa: number
  luz: number
  /** A torcida inteira (1) até pegar fogo (0); acesa: 0–1 (a chama lambendo). */
  torcida: number
  torcidaAcesa: number
  /** O recorte da boca da câmara (o beck subindo do dichavador): só aparece acima da borda da frente. */
  corte: { x: number; y: number; rx: number; ry: number } | null
}

export interface EstadoIsqueiro {
  vis: boolean
  /** O meio do topo (de onde sai a chama), o giro (rad, 0 = em pé) e o tamanho (altura do corpo, px). */
  x: number
  y: number
  ang: number
  h: number
  /** A chama (0–1) e pra onde ela aponta (rad, 0 = pra cima). */
  chama: number
  chamaAng: number
  /** A faísca do clique (0–1). */
  faisca: number
}

export interface Fita {
  /** A base (px), o comprimento (px), a largura na base (células), a fase da onda e o lado do caracol. */
  x: number
  y: number
  comp: number
  larg: number
  fase: number
  lado: number
  /** A base solta (subindo, sem a brasa): o fiapo afina por baixo (0–1). */
  solta: number
}

export interface Anel {
  x: number
  y: number
  rx: number
  ry: number
  esp: number
  /** 0–1: some em dither. */
  vis: number
  /** Atrás do beck (os 2 primeiros quadros). */
  atras: boolean
}

export interface Olho {
  x: number
  y: number
  /** Meia largura (px) e a proporção (altura/largura). */
  r: number
  prop: number
  /** Aberto (0–1), pra onde a pupila olha (−1 a 1). */
  abre: number
  ox: number
  oy: number
}

export interface Quadro {
  t: number
  /** A semente da fervura (troca 12 vezes por segundo). */
  ferve: number
  /* ── fumaça ── */
  blobs: Float32Array // NB × (x, y, r, peso, estica, dirX, dirY, camada)
  nBlobs: number
  /** O buraco do prêmio: x, y, rx, ry, força. */
  buraco: Float32Array
  /** O ondulado de baixa frequência (px) e a fervura (px). */
  ondulado: number
  fervura: number
  frente: Paleta
  fundo: Paleta
  cabeca: Paleta
  /** A fumaça "de verdade" (cinza) antes do sopro grande: 1 = cinza, 0 = a cor da raridade. */
  cinza: number
  /** As faixas psicodélicas (isolinhas do campo): força (0–1, dither), fase (anda pra dentro). */
  iso: number
  isoFase: number
  /** Opacidade do canvas inteiro (o resto da fumaça no fundo do story). */
  alfa: number
  /* ── beck, isqueiro e os fiapos ── */
  beck: EstadoBeckPx
  isqueiro: EstadoIsqueiro
  /** O estalo da torcida pegando: x, y, força. */
  estalo: Float32Array
  /** O brilho da brasa em volta (dither): x, y, raio, força. */
  brilhoBrasa: Float32Array
  fitas: Fita[]
  nFitas: number
  /* ── a viagem de cada raridade ── */
  /** Comum: o sorriso preguiçoso e o olho que pisca: x, y, largura, abre (0–1), piscada (0–3: ^ · ponto · fechado). */
  sorriso: Float32Array
  /** Raro: argolas, a espiral (x, y, raio, voltas, giro, espessura, mistura) e o olho (iris). */
  aneis: Anel[]
  nAneis: number
  espiral: Float32Array
  /** x, y, rx, ry, abre (pálpebras), pupila (raio px), aro (0–1 a moldura azul depois), vis */
  iris: Float32Array
  /** Épico: os olhos (2) e a boca (x, y, largura, sorriso 0–1, bico 0–1, sopro 0–1) e a sobrancelha (sobe 0–1). */
  olhos: Olho[]
  nOlhos: number
  /** A cor dos olhos: 0 = épico (pupila em espiral), 1 = lendário (portal). */
  olhosTipo: number
  boca: Float32Array
  sobrancelha: number
  /** A cabeça do épico apagada (depois do sopro): 0–1. */
  cabecaApaga: number
  /** Lendário: o túnel (força, fase, giro, escurece), o centro, e as estrelas (força). */
  tunel: Float32Array
  centro: Float32Array
  estrelas: number
  /** O clarão (0–1). */
  clarao: number
  /* ── o prêmio (atrás do cartão do DOM) ── */
  /** O anel de brilho na cor da raridade: x, y, r0, r1, força. */
  halo: Float32Array
  haloCor: number
  /** Raios: força, quantos, giro, r0, r1. */
  raios: Float32Array
  raiosCor: number
  raiosMiolo: number
  /** O retângulo do texto do prêmio (as partículas nunca nascem aí): x0, y0, x1, y1. */
  texto: Float32Array
}

/** Uint32 do ImageData (little-endian: A B G R) a partir de "#rrggbb". */
export function px32(hex: string, a = 255): number {
  const n = parseInt(hex.slice(1), 16)
  return ((a << 24) | ((n & 255) << 16) | (n & 0xff00) | ((n >> 16) & 255)) >>> 0
}

/** Mistura duas cores "#rrggbb" (k = 0 → a, 1 → b). */
export function misturar(a: string, b: string, k: number): string {
  const x = parseInt(a.slice(1), 16)
  const y = parseInt(b.slice(1), 16)
  const c = (s: number) => Math.round(((x >> s) & 255) * (1 - k) + ((y >> s) & 255) * k)
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0')}`
}

export function paleta(cores: readonly [string, string, string, string]): Paleta {
  return { contorno: px32(cores[0]), sombra: px32(cores[1]), meio: px32(cores[2]), luz: px32(cores[3]) }
}

export function quadroVazio(): Quadro {
  const olho = (): Olho => ({ x: 0, y: 0, r: 0, prop: 0.6, abre: 0, ox: 0, oy: 0 })
  const vazia: Paleta = { contorno: 0, sombra: 0, meio: 0, luz: 0 }
  return {
    t: 0,
    ferve: 0,
    blobs: new Float32Array(NB * PASSO_BOLHA),
    nBlobs: 0,
    buraco: new Float32Array(5),
    ondulado: 0,
    fervura: 0,
    frente: { ...vazia },
    fundo: { ...vazia },
    cabeca: { ...vazia },
    cinza: 1,
    iso: 0,
    isoFase: 0,
    alfa: 1,
    beck: { vis: false, x0: 0, y0: 0, ax: 0, ay: -1, L: 100, sx: 1, sy: 1, linha: 1, cinza: 0, pende: 0, racha: 0, brasa: 0, luz: 0, torcida: 1, torcidaAcesa: 0, corte: null },
    isqueiro: { vis: false, x: 0, y: 0, ang: 0, h: 60, chama: 0, chamaAng: 0, faisca: 0 },
    estalo: new Float32Array(3),
    brilhoBrasa: new Float32Array(4),
    fitas: Array.from({ length: 3 }, () => ({ x: 0, y: 0, comp: 0, larg: 2, fase: 0, lado: 1, solta: 0 })),
    nFitas: 0,
    sorriso: new Float32Array(5),
    aneis: Array.from({ length: 3 }, () => ({ x: 0, y: 0, rx: 0, ry: 0, esp: 0, vis: 0, atras: false })),
    nAneis: 0,
    espiral: new Float32Array(7),
    iris: new Float32Array(8),
    olhos: Array.from({ length: 8 }, olho),
    nOlhos: 0,
    olhosTipo: 0,
    boca: new Float32Array(6),
    sobrancelha: 0,
    cabecaApaga: 0,
    tunel: new Float32Array(4),
    centro: new Float32Array(2),
    estrelas: 0,
    clarao: 0,
    halo: new Float32Array(5),
    haloCor: 0,
    raios: new Float32Array(5),
    raiosCor: 0,
    raiosMiolo: 0,
    texto: new Float32Array(4),
  }
}
