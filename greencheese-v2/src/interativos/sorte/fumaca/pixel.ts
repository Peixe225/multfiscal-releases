// O pintor em pixel da revelação (um caminho só, no processador: o mesmo desenho no celular com e sem placa de vídeo, no
// Modo leve, no headless das mídias e dos testes). Pinta o quadro (quadro.ts) numa grade de células de 4 px (5 no Modo
// leve) num ImageData, sobe com putImageData num canvas pequeno que o CSS estica sem suavizar (image-rendering:
// pixelated). Nada de arc() suavizado nem degradê: toda célula é uma cor chapada da paleta, o meio-tom é dither Bayer.
//
// A fumaça de desenho animado (crítica da 1ª rodada: "parece pilha de bolhas"):
//  · o campo das bolhas (metaballs com suporte finito, esticadas no sentido do movimento) é somado numa grade grossa
//    (2 células) com o ondulado de baixa frequência e a fervura de 1 célula a 12 qps no ponto da amostra, e interpolado
//    nas células: as bolhas se FUNDEM numa silhueta só;
//  · luz e sombra pela silhueta inteira, não por bolha: a célula é da faixa clara se andar 0,05u na direção da luz sai
//    da fumaça, da escura se andar 0,07u pro outro lado sai (as faixas seguem o contorno de fora da massa), com dither de
//    1 célula na costura;
//  · contorno de 1 célula só por fora da silhueta (e a dobra da camada da frente sobre a de trás); a linha que separa a
//    sombra do meio vira contorno em ~60% do comprimento (ruído): ganchos e caracóis, não círculos;
//  · nas raridades viajadas, as faixas psicodélicas são isolinhas do campo (andam pra dentro e seguem a forma), com a
//    mesma luz e sombra por cima.
// O beck, o isqueiro, a chama, os fiapos, as argolas, os olhos e as bocas são "sprites" desenhados célula a célula numa
// máscara (código da parte + tom) e compostos com o contorno de 1 célula de quem está na borda (vizinho vazio).
import { TORCIDA_ANG, TORCIDA_L } from './cena'
import { CABECA, FRENTE, FUNDO, misturar, NB, paleta, PASSO_BOLHA, PASSO_CAB, px32, type Anel, type EstadoBeckPx, type EstadoIsqueiro, type Olho, type Paleta, type Quadro } from './quadro'

const T = 0.25
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)
const bayer = (i: number, j: number) => BAYER4[((j & 3) << 2) | (i & 3)]
/** A luz vem de cima à esquerda (no plano); na fumaça, também da frente (o relevo dos lóbulos). */
const LX = -0.6
const LY = -0.8
const LX3 = -0.42
const LY3 = -0.56
const LZ = 0.71
/** As faixas da luz na fumaça: acima de LUZ a luz, de MEIO o meio, de SOMBRA a sombra; abaixo, a sombra funda. */
const LUZ = 0.87
const MEIO = 0.6
const SOMBRA = 0.27
/** O pedaço da grade grossa em que a lista de lóbulos é recortada (nós de lado). */
const PED = 4
/**
 * O alcance do lóbulo no campo: o núcleo é (1 − q²), q = d / (SUP·r), e o limiar T = 0,25 cai em d = r (o lóbulo
 * aparece com o raio dele). Um núcleo afiado, de alcance curto: os lóbulos se fundem com um vinco pequeno (redondos,
 * não massa de modelar) e cada ponto da tela soma poucos lóbulos (o campo custa metade do que custava com (1 − q²)³).
 */
const SUP = 1 / Math.sqrt(1 - T)
/** Dentro do raio do lóbulo (a esfera dele): q² < 1/SUP². */
const RHO2 = SUP * SUP
const DENTRO = 1 / RHO2
/** Quanto a normal de cada lóbulo torce com os calombos dele (o sombreado rola junto com o giro). */
const TORCE = 0.55
/** O brilho de cada lóbulo dá uma voltinha em torno do lugar dele conforme ele gira (o miolo também rola). */
const ORBITA = 0.16
/** O contraste da luz cai no miolo da massa (campo alto): a fumaça se funde, as faixas fortes ficam na borda. */
function funde(d: number, f: number): number {
  const c = f < 1.4 ? 1 : Math.max(0.88, 1 - (f - 1.4) * 0.06)
  return LZ + (d - LZ) * c
}
/** A luz numa esfera (achatada: os lóbulos de fumaça são fofos, não bolas). */
function luzEsfera(nx: number, ny: number, nz: number): number {
  const k = 0.95
  return (nx * k * LX3 + ny * k * LY3 + nz * LZ) / Math.sqrt(k * k * (nx * nx + ny * ny) + nz * nz)
}

/** 0–1, estável por (a, b, c). */
export function hash3(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/* ───────────── as partes dos sprites (código = parte·4 + tom; tom 1 sombra, 2 meio, 3 luz; 0 = contorno fixo) ───────────── */

const P_PITEIRA = 1
const P_PAPEL = 2
const P_TOSTADO = 3
const P_BRASA = 4
const P_CINZA = 5
const P_RACHA = 6
const P_TORCIDA = 7
const P_BOCA_PIT = 8
const P_M = 9
const P_CORPO = 10
const P_CAPUZ = 11
const P_RODA = 12
const P_FENDA = 13
const P_CHAMA = 14
const P_FITA = 15
const P_ANEL = 16
const P_BRANCO = 17
const P_IRIS = 18
const P_PUPILA = 19
const P_PALPEBRA = 20
const P_BRILHO = 21
const P_BOCA = 22
const P_DENTE = 23
const P_LINGUA = 24
const P_CONTORNO = 25
/** O fogo do carvão (amarelo e o miolo quase branco), o carvão apagado e o papel na luz da brasa. */
const P_FOGO = 26
const P_CARVAO = 27
const P_QUENTE = 28
const NPARTES = 29
/** Onde ficam as rachaduras da cinza (fração do comprimento dela). */
const RACHAS = [0.34, 0.68]

/**
 * Cores fixas (tons 1, 2, 3) e o contorno de cada parte. O beck tem contorno de tom médio (no preto, o marrom quase
 * preto sumia: a crítica pediu presença de desenho): laranja-queimado do lado da sombra e das pontas, e uma luz de borda
 * (BORDA_LUZ) do lado de onde vem a luz (cima à esquerda); a linha ferve a 12 qps junto com o raio do beck.
 */
const FIXAS: Partial<Record<number, [string, string, string, string]>> = {
  [P_PITEIRA]: ['#8e5a2c', '#a8875a', '#d9c39a', '#efe2c4'],
  [P_PAPEL]: ['#9c5c28', '#b8956a', '#e3cfa8', '#f6ead2'],
  [P_TOSTADO]: ['#7a3a14', '#4a2a14', '#7a4a22', '#9a6a3a'],
  [P_CINZA]: ['#6e6a67', '#a19c97', '#c9c5c0', '#ebe8e4'],
  [P_RACHA]: ['#6e6a67', '#77726e', '#77726e', '#77726e'],
  // o carvão: vermelho-escuro, vermelho e laranja; o fogo: amarelo e o miolo quase branco
  [P_BRASA]: ['#8a2208', '#8a1e0a', '#d8361a', '#ff7a1a'],
  [P_FOGO]: ['#8a2208', '#ffc23a', '#fff3c4', '#fff3c4'],
  [P_CARVAO]: ['#8a2208', '#3e0e06', '#5a1608', '#6e1c0a'],
  [P_QUENTE]: ['#a8481c', '#c97a3e', '#eaa462', '#ffcf8f'],
  [P_TORCIDA]: ['#9c5c28', '#b8956a', '#e3cfa8', '#f6ead2'],
  [P_BOCA_PIT]: ['#8e5a2c', '#a8875a', '#c9b088', '#d9c39a'],
  [P_M]: ['#5a3416', '#5a3416', '#5a3416', '#5a3416'],
  // o corpo do isqueiro: plástico de desenho animado (coral), o capuz de metal
  [P_CORPO]: ['#2a170c', '#a8283a', '#e2474f', '#ff8f7f'],
  [P_CAPUZ]: ['#2a170c', '#7a848e', '#b8c0c8', '#e6eaee'],
  [P_RODA]: ['#2a170c', '#262b31', '#3a4048', '#5d6670'],
  [P_FENDA]: ['#2a170c', '#1a1d21', '#1a1d21', '#1a1d21'],
  [P_FITA]: ['#1b2228', '#9aa6ae', '#d3dbe0', '#eef2f4'],
  [P_BRANCO]: ['#000000', '#d8dfe6', '#eef3f7', '#ffffff'],
  [P_BRILHO]: ['#ffffff', '#ffffff', '#ffffff', '#ffffff'],
  [P_DENTE]: ['#000000', '#e9dfe4', '#fffaf2', '#fffaf2'],
  [P_LINGUA]: ['#000000', '#d8466e', '#ff6b9a', '#ff9dbb'],
}
/** A luz de borda do beck (o contorno do lado da luz: vizinho vazio em cima ou à esquerda). */
const BORDA_LUZ: Partial<Record<number, string>> = {
  [P_PITEIRA]: '#e6b878',
  [P_PAPEL]: '#f2c288',
  [P_TOSTADO]: '#b06a30',
  [P_CINZA]: '#f4f2ef',
  [P_RACHA]: '#f4f2ef',
  [P_BRASA]: '#ff9a3a',
  [P_FOGO]: '#ffd27a',
  [P_CARVAO]: '#ff7a2a',
  [P_QUENTE]: '#ffc27a',
  [P_TORCIDA]: '#f2c288',
  [P_BOCA_PIT]: '#e6b878',
}

interface PaletaIso {
  /** 5 faixas × (sombra funda, sombra, meio, luz) e o contorno; a de trás um pouco mais escura. */
  frente: Uint32Array
  fundo: Uint32Array
  contorno: number
  contornoFundo: number
}

export interface Desenho {
  readonly tipo: 'pixel'
  medir(W: number, H: number, pix: number): void
  /**
   * `subir` falso: só calcula no ImageData (o aquecimento do motor, no giro). `reusar`: a fumaça (e o que fica embaixo
   * dela: o túnel, o beck, os fiapos da brasa, a cabeça calculada) é a do último quadro completo; só o que vem por cima
   * (a cabeça pintada, olhos, boca, o prêmio, as partículas) é refeito.
   */
  pintar(q: Quadro, subir?: boolean, reusar?: boolean): void
  limpar(): void
  destruir(): void
  /** As faixas psicodélicas (5 cores) e o contorno delas. */
  definirIso(cores: readonly string[] | null, contorno: string): void
  /** Partículas (faíscas, brilhos, confete, a cinza caindo): pintam na mesma grade, depois do resto. */
  aoPintar?: (buf: Uint32Array, cols: number, lins: number, pix: number, q: Quadro) => void
  /** O valor do campo da frente na célula (as partículas e o sorriso usam). */
  campoFrente(i: number, j: number): number
}

export function criarPintor(canvas: HTMLCanvasElement): Desenho | null {
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) return null
  return new Pintor(canvas, ctx)
}

class Pintor implements Desenho {
  readonly tipo = 'pixel' as const
  aoPintar?: Desenho['aoPintar']
  private cols = 1
  private lins = 1
  private pix = 4
  private W = 1
  private H = 1
  private img: ImageData
  private buf: Uint32Array
  private mask: Uint8Array
  // campo: grade grossa (2 células) e fina, por camada
  private gx = 1
  private gy = 1
  private cg: Float32Array[] = [new Float32Array(1), new Float32Array(1), new Float32Array(1)]
  /** Por camada, na grade grossa: a opacidade acumulada (Σ v·alfa) e a luz do relevo. */
  private ca: Float32Array[] = [new Float32Array(1), new Float32Array(1), new Float32Array(1)]
  private cd: Float32Array[] = [new Float32Array(1), new Float32Array(1), new Float32Array(1)]
  /** Quanto da fumaça no nó é "de verdade" (cinza: as baforadas), por camada (Σ v·cinza / Σ v). */
  private cc: Float32Array[] = [new Float32Array(1), new Float32Array(1), new Float32Array(1)]
  /** O véu (a opacidade máxima) no nó, por camada (Σ v·véu / Σ v), e se a camada tem algum lóbulo com véu. */
  private cv: Float32Array[] = [new Float32Array(1), new Float32Array(1)]
  private temVeu = [false, false]
  /** Se a camada tem fumaça "de verdade" (cinza) neste quadro: sem ela, nem olha a mistura. */
  private temCinza = [false, false]
  private fg: Float32Array[] = [new Float32Array(1), new Float32Array(1), new Float32Array(1)]
  private temCamada = [false, false, false]
  // recorte por pedaços (8×8 nós) da lista de bolhas
  private pedX = 1
  private pedY = 1
  private pedN = new Int32Array(1)
  private pedL = new Int16Array(1)
  private bIa = new Float32Array(NB)
  private bIc = new Float32Array(NB)
  private bLim = new Float32Array(NB)
  // caches (o que não muda de um quadro pro outro): a fervura por semente, o ondulado separável por linha e coluna,
  // o raio e o ângulo de cada célula em volta do meio do túnel e do prêmio, as cores do túnel
  private ferveX = new Float32Array(1)
  private ferveY = new Float32Array(1)
  private ferveSemente = -1
  private ondLin = new Float32Array(1)
  private ondLin2 = new Float32Array(1)
  private ondCol = new Float32Array(1)
  private ondCol2 = new Float32Array(1)
  private polar: { cx: number; cy: number; r: Float32Array; a: Float32Array } | null = null
  private polarRaios: { cx: number; cy: number; r: Float32Array; a: Float32Array } | null = null
  private corTunel: { esc: number; tab: Uint32Array } | null = null
  /** A cabeça do épico (por célula, na caixa dela): o lóbulo de cima, a altura dele e o tom. */
  private cabTop = new Int8Array(1)
  private cabH = new Float32Array(1)
  private cabTom = new Uint8Array(1)
  private cabLista = new Int16Array(64)
  private cabG = new Int8Array(1)
  /** A caixa da cabeça calculada neste quadro (células) e se tem cabeça pra pintar. */
  private cabOk = false
  /** A fumaça do último quadro completo (o quadro seguinte pode reaproveitar). */
  private fumacaBuf = new Uint32Array(1)
  private fumacaOk = false
  /** O que a cabeça calculada usou (os lóbulos e a semente da fervura): igual no quadro seguinte, não recalcula. */
  private cabChave = new Float32Array(16 * 6 + 2)
  private cabI0 = 0
  private cabJ0 = 0
  private cabW = 0
  private cabHh = 0
  // cores
  private corParte = new Uint32Array(NPARTES * 4)
  /** A luz de borda de cada parte (0: sem; o contorno é um só). */
  private corLuz = new Uint32Array(NPARTES)
  private iso: PaletaIso | null = null
  private cinzaFrente: Paleta = paleta(['#1b2228', '#9aa6ae', '#d3dbe0', '#f4f7f8'])
  /** As cores iridescentes do lendário: a luz (rosa, ciano, violeta claros) e o meio (saturados), na frente e atrás. */
  private holoLuz = Uint32Array.from(['#ffb8ea', '#b8f8ff', '#dcc8ff'].map((c) => px32(c)))
  private holoMeio = Uint32Array.from(['#ff5fb0', '#35d4ff', '#9a6cff'].map((c) => px32(c)))
  private holoMeioFundo = Uint32Array.from(['#c23c86', '#2296c0', '#6c48c0'].map((c) => px32(c)))
  private raioHolo = Uint32Array.from(['#ffc53d', '#ff5fb0', '#35d4ff', '#9a6cff'].map((c) => px32(c)))
  private raioHoloMiolo = Uint32Array.from(['#fff1b8', '#ffd0ee', '#c8f8ff', '#e2d4ff'].map((c) => px32(c)))
  // (as baforadas passam atrás do beck: o mesmo cinza claro de fumaça, um pouco mais apagado)
  private cinzaFundo: Paleta = paleta(['#1b2228', '#8c99a3', '#c3ccd2', '#e8edf0'])

  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: CanvasRenderingContext2D,
  ) {
    this.img = ctx.createImageData(1, 1)
    this.buf = new Uint32Array(this.img.data.buffer)
    this.mask = new Uint8Array(1)
    for (const [k, cores] of Object.entries(FIXAS)) {
      const p = Number(k)
      cores!.forEach((c, t) => (this.corParte[p * 4 + t] = px32(c)))
    }
    for (const [k, c] of Object.entries(BORDA_LUZ)) this.corLuz[Number(k)] = px32(c!)
  }

  medir(W: number, H: number, pix: number) {
    const cols = Math.max(2, Math.ceil(W / pix))
    const lins = Math.max(2, Math.ceil(H / pix))
    this.W = W
    this.H = H
    this.pix = pix
    if (cols === this.cols && lins === this.lins && this.img.width === cols) return
    this.cols = cols
    this.lins = lins
    this.canvas.width = cols
    this.canvas.height = lins
    this.img = this.ctx.createImageData(cols, lins)
    this.buf = new Uint32Array(this.img.data.buffer)
    this.mask = new Uint8Array(cols * lins)
    this.gx = (cols >> 1) + 2
    this.gy = (lins >> 1) + 2
    const n = this.gx * this.gy
    this.cg = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
    this.ca = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
    this.cd = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
    this.cc = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
    this.cv = [new Float32Array(n), new Float32Array(n)]
    this.fg = [new Float32Array(cols * lins), new Float32Array(cols * lins), new Float32Array(cols * lins)]
    this.pedX = Math.ceil(this.gx / PED)
    this.pedY = Math.ceil(this.gy / PED)
    this.pedN = new Int32Array(this.pedX * this.pedY)
    this.pedL = new Int16Array(this.pedX * this.pedY * NB)
    this.ferveX = new Float32Array(n)
    this.ferveY = new Float32Array(n)
    this.ferveSemente = -1
    this.ondLin = new Float32Array(this.gy)
    this.ondLin2 = new Float32Array(this.gy)
    this.ondCol = new Float32Array(this.gx)
    this.ondCol2 = new Float32Array(this.gx)
    this.polar = null
    this.polarRaios = null
    this.fumacaOk = false
  }

  definirIso(cores: readonly string[] | null, contorno: string) {
    if (!cores) {
      this.iso = null
      return
    }
    // 5 por faixa: (nada), a sombra funda, a sombra, o meio, a luz
    const frente = new Uint32Array(cores.length * 5)
    const fundo = new Uint32Array(cores.length * 5)
    cores.forEach((c, k) => {
      const tons = [misturar(c, contorno, 0.62), misturar(c, '#000000', 0.38), c, misturar(c, '#ffffff', 0.35)]
      tons.forEach((x, t) => {
        frente[k * 5 + t + 1] = px32(x)
        fundo[k * 5 + t + 1] = px32(misturar(x, '#000000', 0.3))
      })
    })
    this.iso = { frente, fundo, contorno: px32(contorno), contornoFundo: px32(misturar(contorno, '#000000', 0.3)) }
  }

  campoFrente(i: number, j: number): number {
    if (i < 0 || j < 0 || i >= this.cols || j >= this.lins || !this.temCamada[FRENTE]) return 0
    return this.fg[FRENTE][j * this.cols + i]
  }

  limpar() {
    this.fumacaOk = false
    this.buf.fill(0)
    this.ctx.putImageData(this.img, 0, 0)
  }

  destruir() {
    /* nada guardado fora do canvas */
  }

  pintar(q: Quadro, subir = true, reusar = false) {
    const buf = this.buf
    this.corDinamica(q)
    if (reusar && this.fumacaOk && this.fumacaBuf.length === buf.length) {
      buf.set(this.fumacaBuf)
      this.porCima(q, subir)
      return
    }
    buf.fill(0)
    if (q.tunel[0] > 0.001) this.tunel(q)
    if (q.estrelas > 0.001) this.estrelasDoFundo(q)
    const dbg = import.meta.env.DEV ? (window as unknown as { __fumacaT?: Record<string, number> }).__fumacaT : undefined
    let t0 = dbg ? performance.now() : 0
    const marca = (nome: string) => {
      if (!dbg) return
      const t1 = performance.now()
      dbg[nome] = (dbg[nome] ?? 0) + t1 - t0
      t0 = t1
    }
    marca('tunel')
    this.campo(q)
    marca('campo')
    // a cabeça do épico: calcula antes das camadas (a fumaça por baixo dela nem é pintada) e pinta por cima
    this.cabOk = q.nCabeca > 0 && this.cabecaCalcular(q)
    marca('cabecaCalc')
    // engolido pelo sopro, o beck passa pra trás de toda a fumaça
    if (q.beck.atras) this.beck(q.beck, q.ferve)
    if (this.temCamada[FUNDO]) this.camada(FUNDO, q)
    for (let k = 0; k < q.nAneis; k++) if (q.aneis[k].atras) this.anel(q.aneis[k])
    if (q.brilhoBrasa[3] > 0.01) this.brilho(q.brilhoBrasa)
    if (!q.beck.atras) this.beck(q.beck, q.ferve)
    this.isqueiro(q.isqueiro, q.ferve)
    if (q.estalo[2] > 0.01) this.estalo(q.estalo)
    // os fiapos da brasa (os 3 primeiros) passam por trás da frente; os que se soltam das nuvens, por cima
    const nb = Math.min(3, q.nFitas)
    for (let k = 0; k < nb; k++) this.fita(q, k)
    marca('fundo')
    if (this.temCamada[FRENTE]) this.camada(FRENTE, q)
    marca('frente')
    // guarda a fumaça (pro quadro seguinte poder reaproveitar, quando o desenho passa do orçamento)
    if (this.fumacaBuf.length !== buf.length) this.fumacaBuf = new Uint32Array(buf.length)
    this.fumacaBuf.set(buf)
    this.fumacaOk = true
    this.porCima(q, subir, nb)
  }

  /** O que vai por cima da fumaça (refeito todo quadro). */
  private porCima(q: Quadro, subir: boolean, nb = Math.min(3, q.nFitas)) {
    const buf = this.buf
    const dbg = import.meta.env.DEV ? (window as unknown as { __fumacaT?: Record<string, number> }).__fumacaT : undefined
    let t0 = dbg ? performance.now() : 0
    const marca = (nome: string) => {
      if (!dbg) return
      const t1 = performance.now()
      dbg[nome] = (dbg[nome] ?? 0) + t1 - t0
      t0 = t1
    }
    if (q.brasaSobre[3] > 0.01) this.brilhoSobre(q.brasaSobre)
    for (let k = nb; k < q.nFitas; k++) this.fita(q, k)
    if (this.temCamada[CABECA]) this.camada(CABECA, q)
    if (this.cabOk) this.cabecaPintar(q)
    marca('cabeca')
    // os raios e o anel do prêmio passam por cima da fumaça (atrás do cartão, que é do DOM): o prêmio brilha nela
    if (q.raios[0] > 0.001) this.raios(q)
    if (q.halo[4] > 0.001) this.halo(q)
    for (let k = 0; k < q.nAneis; k++) if (!q.aneis[k].atras) this.anel(q.aneis[k])
    if (q.espiral[6] > 0.01) this.espiral(q)
    if (q.iris[7] > 0.01) this.iris(q)
    if (q.sorriso[3] > 0.01) this.sorriso(q)
    for (let k = 0; k < q.nOlhos; k++) this.olho(q.olhos[k], q)
    if (q.boca[3] > 0.01 || q.boca[4] > 0.01) this.boca(q)
    this.aoPintar?.(buf, this.cols, this.lins, this.pix, q)
    if (q.clarao > 0.001) this.clarao(q.clarao, q.t)
    marca('resto')
    if (subir) this.ctx.putImageData(this.img, 0, 0)
    marca('subir')
  }

  /* ───────────── cores que mudam no quadro (a brasa, a chama, as argolas, a cabeça) ───────────── */

  private corDinamica(q: Quadro) {
    const c = this.corParte
    const m = (a: string, b: string, k: number) => px32(misturar(a, b, Math.max(0, Math.min(1, k))))
    // a torcida pegando fogo
    const a = q.beck.torcidaAcesa
    c[P_TORCIDA * 4 + 1] = m('#b8956a', '#ff5418', a)
    c[P_TORCIDA * 4 + 2] = m('#e3cfa8', '#ff9a3a', a)
    c[P_TORCIDA * 4 + 3] = m('#f6ead2', '#ffd27a', a)
    // chama: laranja (dourada no lendário)
    const ouro = q.olhosTipo === 1
    c[P_CHAMA * 4] = px32(ouro ? '#5a2a00' : '#5a1400')
    c[P_CHAMA * 4 + 1] = px32(ouro ? '#ffb020' : '#ff7a1a')
    c[P_CHAMA * 4 + 2] = px32(ouro ? '#ffe27a' : '#ffc53d')
    c[P_CHAMA * 4 + 3] = px32(ouro ? '#fffbe6' : '#fff6d6')
    // argolas, pálpebras e boca: a paleta da frente (ou da cabeça)
    const f = q.frente
    c[P_ANEL * 4] = f.contorno
    c[P_ANEL * 4 + 1] = f.sombra
    c[P_ANEL * 4 + 2] = f.meio
    c[P_ANEL * 4 + 3] = f.luz
    const cab = q.olhosTipo === 0 ? q.cabeca : q.frente
    c[P_PALPEBRA * 4] = cab.contorno
    c[P_PALPEBRA * 4 + 1] = cab.sombra
    c[P_PALPEBRA * 4 + 2] = cab.meio
    c[P_PALPEBRA * 4 + 3] = cab.luz
    c[P_CONTORNO * 4] = cab.contorno
    c[P_CONTORNO * 4 + 1] = cab.contorno
    c[P_CONTORNO * 4 + 2] = cab.contorno
    c[P_CONTORNO * 4 + 3] = cab.contorno
    c[P_BOCA * 4] = cab.contorno
    c[P_BOCA * 4 + 1] = px32('#1e0312')
    c[P_BOCA * 4 + 2] = px32('#2b0418')
    c[P_BOCA * 4 + 3] = px32('#3c0822')
    c[P_BRANCO * 4] = cab.contorno
    c[P_DENTE * 4] = cab.contorno
    c[P_LINGUA * 4] = cab.contorno
    c[P_BRILHO * 4] = cab.contorno
    // íris e pupila: azul no raro, a espiral psicodélica no épico, ouro com violeta no lendário
    if (q.olhosTipo === 1) {
      c[P_IRIS * 4] = px32('#24103a')
      c[P_IRIS * 4 + 1] = px32('#9466ff')
      c[P_IRIS * 4 + 2] = px32('#ffc53d')
      c[P_IRIS * 4 + 3] = px32('#fff1b8')
      c[P_PUPILA * 4] = px32('#24103a')
      c[P_PUPILA * 4 + 1] = px32('#1a0b2e')
      c[P_PUPILA * 4 + 2] = px32('#1a0b2e')
      c[P_PUPILA * 4 + 3] = px32('#1a0b2e')
    } else if (q.olhosTipo === 2) {
      c[P_IRIS * 4] = px32('#061a33')
      c[P_IRIS * 4 + 1] = px32('#1d5f9a')
      c[P_IRIS * 4 + 2] = px32('#35a7ff')
      c[P_IRIS * 4 + 3] = px32('#b4e0ff')
      c[P_PUPILA * 4] = px32('#061a33')
      c[P_PUPILA * 4 + 1] = px32('#04101f')
      c[P_PUPILA * 4 + 2] = px32('#061a33')
      c[P_PUPILA * 4 + 3] = px32('#0b2a4a')
    } else {
      c[P_IRIS * 4] = px32('#2e0520')
      c[P_PUPILA * 4] = px32('#2e0520')
      c[P_PUPILA * 4 + 1] = px32('#140310')
      c[P_PUPILA * 4 + 2] = px32('#140310')
      c[P_PUPILA * 4 + 3] = px32('#140310')
    }
  }

  /* ───────────── fundo: túnel, estrelas, halo, raios ───────────── */

  /**
   * O túnel do lendário (o caleidoscópio que o dono elogiou na 1ª rodada; a 3ª tinha puxado pro ouro e encolhido): faixas
   * que correm pro fundo em 6 gomos espelhados, numa estrela forte; 4 cores iguais (ciano, rosa, violeta e ouro: o ouro
   * no máximo 1/4), o traço escuro na costura, a beirada clara de cada faixa e o fundo do túnel mais escuro (4 degraus
   * em dither).
   */
  private tunel(q: Quadro) {
    const { cols, lins, buf } = this
    const u = Math.min(this.W, this.H)
    const cx = q.centro[0]
    const cy = q.centro[1]
    const forca = q.tunel[0]
    const fase = q.tunel[1]
    const giro = q.tunel[2]
    const esc = q.tunel[3]
    const alcance = forca * 2.2 * u
    const niveis = 4
    const escQ = Math.round(esc * 50) / 50
    if (!this.corTunel || this.corTunel.esc !== escQ) {
      const base = ['#35ccff', '#ff5fb0', '#9466ff', '#ffc53d']
      // por cor: 4 degraus de profundidade e a beirada clara
      const t2 = new Uint32Array(base.length * (niveis + 1))
      base.forEach((c, k) => {
        for (let n = 0; n < niveis; n++) t2[k * (niveis + 1) + n] = px32(misturar(c, '#1a0b2e', (1 - (n + 1) / niveis) * 0.5 + (1 - escQ) * 0.5))
        t2[k * (niveis + 1) + niveis] = px32(misturar(misturar(c, '#ffffff', 0.45), '#1a0b2e', (1 - escQ) * 0.5))
      })
      this.corTunel = { esc: escQ, tab: t2 }
    }
    const tab = this.corTunel.tab
    const tinta = px32('#1a0b2e')
    const seg = (Math.PI * 2) / 6
    const P = (this.polar = this.polarDe(this.polar, cx, cy))
    const ni = niveis + 1
    for (let j = 0; j < lins; j++) {
      for (let i = 0; i < cols; i++) {
        const idx = j * cols + i
        const r = P.r[idx]
        const by = bayer(i, j)
        if (r > alcance - (1 - by) * 0.12 * u) continue
        let an = P.a[idx] + giro
        an = an - seg * Math.floor(an / seg)
        const af = Math.abs(an - seg * 0.5)
        const z = (0.24 * u) / Math.max(r, 0.015 * u)
        const s = z + af * 2.2 - fase
        const fl = Math.floor(s)
        const fr = s - fl
        // o fundo do túnel mais escuro (4 degraus com dither)
        const prof = Math.min(1, Math.max(0, (r - 0.05 * u) / (0.55 * u)))
        const nv = Math.max(0, Math.min(niveis - 1, Math.floor(prof * niveis + (by - 0.5) * 0.9)))
        const cor = ((fl % 4) + 4) % 4
        const linha = 0.07 + 0.05 * Math.max(0, 1 - r / (0.4 * u))
        buf[idx] = fr < linha ? tinta : fr > 0.8 ? tab[cor * ni + niveis] : tab[cor * ni + nv]
      }
    }
  }

  /** O raio e o ângulo de cada célula em volta de (cx, cy), guardados enquanto o meio não mudar. */
  private polarDe(atual: { cx: number; cy: number; r: Float32Array; a: Float32Array } | null, cx: number, cy: number) {
    const rx = Math.round(cx)
    const ry = Math.round(cy)
    const n = this.cols * this.lins
    if (atual && atual.cx === rx && atual.cy === ry && atual.r.length === n) return atual
    const r = atual && atual.r.length === n ? atual.r : new Float32Array(n)
    const a = atual && atual.a.length === n ? atual.a : new Float32Array(n)
    const pix = this.pix
    for (let j = 0; j < this.lins; j++) {
      const dy = (j + 0.5) * pix - ry
      for (let i = 0; i < this.cols; i++) {
        const dx = (i + 0.5) * pix - rx
        r[j * this.cols + i] = Math.sqrt(dx * dx + dy * dy)
        a[j * this.cols + i] = Math.atan2(dy, dx)
      }
    }
    return { cx: rx, cy: ry, r, a }
  }

  /** 18 estrelas de 4 pontas (até 6 células de braço, as grandes com o miolo de 3×3) cintilando no túnel: branco, ciano e rosa. */
  private estrelasDoFundo(q: Quadro) {
    const { cols, lins } = this
    const cores = [px32('#ffffff'), px32('#bff6ff'), px32('#ffd0ee'), px32('#fff1b8')]
    const ponta = [px32('#fff1b8'), px32('#5fe0ff'), px32('#ff7ad1'), px32('#ffc53d')]
    for (let k = 0; k < 18; k++) {
      const i = Math.floor(hash3(k, 1, 5) * cols)
      const j = Math.floor(hash3(k, 2, 5) * lins)
      const grande = k % 3 === 0
      const fase = (q.t * (1.3 + hash3(k, 3, 5)) + hash3(k, 4, 5) * 6) % 3
      const pico = grande ? 6 : 4
      const tam = fase < 0.4 ? 1 : fase < 0.9 ? Math.ceil(pico * 0.5) : fase < 1.5 ? pico : fase < 2 ? Math.ceil(pico * 0.5) : fase < 2.4 ? 1 : 0
      if (!tam || hash3(k, 6, 5) > q.estrelas) continue
      const c = cores[k % 4]
      const cp = ponta[k % 4]
      this.ponto(i, j, c)
      if (grande && tam >= 3) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) this.ponto(i + di, j + dj, c)
      for (let a = 1; a <= tam; a++) {
        const cc = a >= tam - 1 ? cp : c
        this.ponto(i + a, j, cc)
        this.ponto(i - a, j, cc)
        this.ponto(i, j + a, cc)
        this.ponto(i, j - a, cc)
      }
      if (tam >= 3) {
        this.ponto(i + 1, j + 1, cp)
        this.ponto(i - 1, j - 1, cp)
        this.ponto(i + 1, j - 1, cp)
        this.ponto(i - 1, j + 1, cp)
      }
    }
  }

  private ponto(i: number, j: number, c: number) {
    if (i < 0 || j < 0 || i >= this.cols || j >= this.lins) return
    this.buf[j * this.cols + i] = c
  }

  /** O anel de brilho na cor da raridade em volta do cartão (elipse dele, de 1 a 1,32×), em dither que some pra fora. */
  private halo(q: Quadro) {
    const { cols, lins, pix, buf } = this
    const [hx, hy, rx, ry, forca] = q.halo
    const cor = q.haloCor
    const R = 1.2
    const i0 = Math.max(0, Math.floor((hx - rx * R) / pix))
    const i1 = Math.min(cols - 1, Math.ceil((hx + rx * R) / pix))
    const j0 = Math.max(0, Math.floor((hy - ry * R) / pix))
    const j1 = Math.min(lins - 1, Math.ceil((hy + ry * R) / pix))
    const claro = px32('#ffffff')
    for (let j = j0; j <= j1; j++) {
      const dy = ((j + 0.5) * pix - hy) / ry
      for (let i = i0; i <= i1; i++) {
        const dx = ((i + 0.5) * pix - hx) / rx
        // a "distância" de caixa arredondada (o cartão é um retângulo alto): superelipse de grau 4
        const e = Math.sqrt(Math.sqrt(dx * dx * dx * dx + dy * dy * dy * dy))
        if (e < 0.96 || e > R) continue
        const k = 1 - (e - 0.96) / (R - 0.96)
        const v = Math.pow(k, 1.6) * forca
        const by = bayer(i, j)
        if (by < v * 0.6) buf[j * cols + i] = by < v * 0.14 ? claro : cor
      }
    }
  }

  /** Raios atrás do prêmio: a cor a 40% (dither) e o miolo de cada raio mais claro. */
  private raios(q: Quadro) {
    const { cols, lins, pix, buf } = this
    const [forca, n, giro, r0, r1] = q.raios
    const hx = q.halo[0]
    const hy = q.halo[1]
    const cor = q.raiosCor
    const miolo = q.raiosMiolo
    const P = (this.polarRaios = this.polarDe(this.polarRaios, hx, hy))
    const holo = q.holo > 0.01
    void pix
    for (let j = 0; j < lins; j++) {
      for (let i = 0; i < cols; i++) {
        const r = P.r[j * cols + i]
        if (r < r0 || r > r1) continue
        const st0 = (P.a[j * cols + i] / (Math.PI * 2)) * n + giro
        const fl = Math.floor(st0)
        const st = st0 - fl
        const d = Math.abs(st - 0.5)
        if (d > 0.2) continue
        const fade = (1 - (r - r0) / (r1 - r0)) * forca
        const by = bayer(i, j)
        // (no lendário cada raio numa cor da placa holográfica: ouro, rosa, ciano, violeta)
        const k = holo ? ((fl % 4) + 4) % 4 : -1
        if (d < 0.06 && by < fade * 0.75) buf[j * cols + i] = k >= 0 ? this.raioHoloMiolo[k] : miolo
        else if (by < fade * 0.42) buf[j * cols + i] = k >= 0 ? this.raioHolo[k] : cor
      }
    }
  }

  /* ───────────── a fumaça ───────────── */

  /**
   * Soma o campo dos lóbulos na grade grossa (2 células), com o ondulado e a fervura no ponto da amostra: cada lóbulo
   * é um metaball esticado no sentido do voo, com a borda em 3 calombos que giram com ele (calombo = 1 + amp·sen 3φ, no
   * referencial do giro). Junto vão a opacidade (Σ v·alfa: o miolo de um pedaço que se desfaz continua cheio e a borda
   * vira dither) e a luz: a inclinação do campo é a normal (o campo é um relevo de calombos que se fundem), e a luz
   * fixa de cima à esquerda dá as faixas. Interpola o campo nas células.
   */
  private campo(q: Quadro) {
    const B = q.blobs
    const n = Math.min(NB, q.nBlobs)
    this.temCamada[0] = this.temCamada[1] = this.temCamada[2] = false
    this.temVeu[0] = this.temVeu[1] = false
    this.temCinza[0] = this.temCinza[1] = false
    if (!n) return
    const pix = this.pix
    const G = pix * 2
    const gx = this.gx
    const gy = this.gy
    const PX = this.pedX
    const PY = this.pedY
    const pedN = this.pedN
    const pedL = this.pedL
    pedN.fill(0)
    const folga = q.ondulado + q.fervura + G
    let alguma = false
    for (let k = 0; k < n; k++) {
      const o = k * PASSO_BOLHA
      const r = B[o + 2]
      const w = B[o + 3]
      if (r <= 0.5 || w <= 0.001) continue
      const kk = B[o + 4]
      const amp = B[o + 10]
      const ra = r * (1 + kk) * SUP
      const rc = r * (1 - 0.35 * kk) * SUP
      this.bIa[k] = 1 / (ra * ra)
      this.bIc[k] = 1 / (rc * rc)
      this.bLim[k] = (1 + amp) * (1 + amp)
      const R = Math.max(ra, rc) * (1 + amp) + folga
      const x = B[o]
      const y = B[o + 1]
      const TP = G * PED
      const a0 = Math.max(0, Math.floor((x - R) / TP))
      const a1 = Math.min(PX - 1, Math.floor((x + R) / TP))
      const b0 = Math.max(0, Math.floor((y - R) / TP))
      const b1 = Math.min(PY - 1, Math.floor((y + R) / TP))
      if (a1 < a0 || b1 < b0) continue
      const R2 = R * R
      for (let b = b0; b <= b1; b++) {
        // só os pedaços que o círculo do lóbulo toca (não a caixa inteira)
        const ty0 = b * TP - G * 0.5
        const qy = y < ty0 ? ty0 - y : y > ty0 + TP ? y - ty0 - TP : 0
        for (let a = a0; a <= a1; a++) {
          const tx0 = a * TP - G * 0.5
          const qx = x < tx0 ? tx0 - x : x > tx0 + TP ? x - tx0 - TP : 0
          if (qx * qx + qy * qy > R2) continue
          const p = b * PX + a
          if (pedN[p] < NB) pedL[p * NB + pedN[p]++] = k
        }
      }
      const cam0 = B[o + 7] | 0
      this.temCamada[cam0] = true
      if (cam0 < 2 && B[o + 14] < 0.999) this.temVeu[cam0] = true
      if (cam0 < 2 && B[o + 13] > 0.001) this.temCinza[cam0] = true
      alguma = true
    }
    if (!alguma) return
    const cF = this.cg
    const cA = this.ca
    for (let c = 0; c < 3; c++) {
      cF[c].fill(0)
      cA[c].fill(0)
      this.cd[c].fill(NaN)
      this.cc[c].fill(0)
    }
    const F0 = cF[0]
    const F1 = cF[1]
    const F2 = cF[2]
    const A0 = cA[0]
    const A1 = cA[1]
    const A2 = cA[2]
    const D0 = this.cd[0]
    const D1 = this.cd[1]
    const D2 = this.cd[2]
    const G0 = this.cc[0]
    const G1 = this.cc[1]
    const V0 = this.cv[0]
    const V1 = this.cv[1]
    const A = q.ondulado
    const fv = q.fervura
    const t = q.t
    const seed = q.ferve
    const [hx, hy, hrx, hry, hf] = q.buraco
    const ihx = hrx > 0 ? 1 / hrx : 0
    const ihy = hry > 0 ? 1 / hry : 0
    const bIa = this.bIa
    const bIc = this.bIc
    const bLim = this.bLim
    const w2 = (Math.PI * 2 * 3) / Math.min(this.W, this.H)
    const oL = this.ondLin
    const oL2 = this.ondLin2
    const oC = this.ondCol
    const oC2 = this.ondCol2
    if (A > 0) {
      for (let b = 0; b < gy; b++) {
        const py0 = b * G + pix * 0.5
        oL[b] = A * Math.sin(py0 * w2 + t * 2.2 + 1.3)
        oL2[b] = Math.cos(py0 * w2 * 1.1 + t * 1.1)
      }
      for (let a = 0; a < gx; a++) {
        const px0 = a * G + pix * 0.5
        oC[a] = Math.cos(px0 * w2 * 0.7 - t * 1.7)
        oC2[a] = A * Math.sin(px0 * w2 * 0.9 - t * 2.0 + 0.4)
      }
    }
    const fX = this.ferveX
    const fY = this.ferveY
    if (fv > 0 && this.ferveSemente !== seed) {
      this.ferveSemente = seed
      for (let b = 0; b < gy; b++)
        for (let a = 0; a < gx; a++) {
          fX[b * gx + a] = (hash3(a, b, seed) - 0.5) * 2 * fv
          fY[b * gx + a] = (hash3(b, a, seed + 77) - 0.5) * 2 * fv
        }
    }
    const temBuraco = hf > 0
    // a cabeça do épico (inteira, por cima): a fumaça bem por baixo dos lóbulos dela não aparece; nem calcula
    const nCab = q.nCabeca
    const Lc = q.cabecaLobos
    const margem = G * 2
    for (let pb = 0; pb < PY; pb++)
      for (let pa = 0; pa < PX; pa++) {
        const p = pb * PX + pa
        const cnt = pedN[p]
        if (!cnt && !temBuraco) continue
        const lista = p * NB
        const ya0 = pb * PED
        const xa0 = pa * PED
        for (let b = ya0; b < Math.min(gy, ya0 + PED); b++) {
          const py0 = b * G + pix * 0.5
          for (let a = xa0; a < Math.min(gx, xa0 + PED); a++) {
            const px0 = a * G + pix * 0.5
            if (nCab) {
              let coberto = false
              for (let k = 0; k < nCab; k++) {
                const o = k * PASSO_CAB
                const rr = Lc[o + 2] - margem
                if (rr <= 0 || Lc[o + 5] < 0.99) continue
                const dx = px0 - Lc[o]
                const dy = py0 - Lc[o + 1]
                if (dx * dx + dy * dy < rr * rr) {
                  coberto = true
                  break
                }
              }
              if (coberto) continue
            }
            let sx = px0
            let sy = py0
            if (A > 0) {
              sx += oL[b] * oC[a]
              sy += oC2[a] * oL2[b]
            }
            if (fv > 0) {
              sx += fX[b * gx + a]
              sy += fY[b * gx + a]
            }
            let f0 = 0
            let f1 = 0
            let f2 = 0
            let a0 = 0
            let a1 = 0
            let a2 = 0
            let g0 = 0
            let g1 = 0
            let e0 = 0
            let e1 = 0
            // o lóbulo de cima em cada camada (o z-buffer de esferas): a altura e a normal dele
            let h0 = -1e9
            let h1 = -1e9
            let h2 = -1e9
            let n0x = 0
            let n0y = 0
            let n0z = 1
            let n1x = 0
            let n1y = 0
            let n1z = 1
            let n2x = 0
            let n2y = 0
            let n2z = 1
            for (let m = 0; m < cnt; m++) {
              const k = pedL[lista + m]
              const o = k * PASSO_BOLHA
              const dx = sx - B[o]
              const dy = sy - B[o + 1]
              const dxx = B[o + 5]
              const dyy = B[o + 6]
              const al = dx * dxx + dy * dyy
              const ac = dy * dxx - dx * dyy
              let q2 = al * al * bIa[k] + ac * ac * bIc[k]
              if (q2 >= bLim[k]) continue
              const amp = B[o + 10]
              let mm = 1
              let fac = 0
              if (amp > 0) {
                // os 3 calombos da borda, girando com o lóbulo: sen 3φ = s(3 − 4s²), s = sen φ no referencial do giro
                const d2 = dx * dx + dy * dy + 0.01
                const s = (dy * B[o + 8] - dx * B[o + 9]) / Math.sqrt(d2)
                fac = s * (3 - 4 * s * s)
                mm = 1 + amp * fac
                q2 /= mm * mm
                if (q2 >= 1) continue
              } else if (q2 >= 1) continue
              const v1 = 1 - q2
              const v = v1 * B[o + 3]
              const al2 = v * B[o + 11]
              const cam = B[o + 7]
              // dentro do raio do lóbulo: a esfera dele (a altura decide quem fica por cima)
              let h = -1e9
              let nz = 1
              if (q2 < DENTRO) {
                nz = Math.sqrt(1 - q2 * RHO2)
                h = B[o + 12] + B[o + 2] * nz
              }
              if (cam < 0.5) {
                f0 += v
                a0 += al2
                g0 += v * B[o + 13]
                e0 += v * B[o + 14]
                if (h > h0) {
                  h0 = h
                  const ir = 1 / (B[o + 2] * mm)
                  // os calombos também no sombreado: a normal torce um pouco em volta do lóbulo, mais na borda, e
                  // gira com ele (o lóbulo rola e a luz e a sombra dele rolam junto)
                  const tw = TORCE * q2 * fac
                  const orb = ORBITA * (1 - q2)
                  n0x = (dx - tw * dy) * ir + orb * B[o + 8]
                  n0y = (dy + tw * dx) * ir + orb * B[o + 9]
                  n0z = nz
                }
              } else if (cam < 1.5) {
                f1 += v
                a1 += al2
                g1 += v * B[o + 13]
                e1 += v * B[o + 14]
                if (h > h1) {
                  h1 = h
                  const ir = 1 / (B[o + 2] * mm)
                  // os calombos também no sombreado: a normal torce um pouco em volta do lóbulo, mais na borda, e
                  // gira com ele (o lóbulo rola e a luz e a sombra dele rolam junto)
                  const tw = TORCE * q2 * fac
                  const orb = ORBITA * (1 - q2)
                  n1x = (dx - tw * dy) * ir + orb * B[o + 8]
                  n1y = (dy + tw * dx) * ir + orb * B[o + 9]
                  n1z = nz
                }
              } else {
                f2 += v
                a2 += al2
                if (h > h2) {
                  h2 = h
                  const ir = 1 / (B[o + 2] * mm)
                  // os calombos também no sombreado: a normal torce um pouco em volta do lóbulo, mais na borda, e
                  // gira com ele (o lóbulo rola e a luz e a sombra dele rolam junto)
                  const tw = TORCE * q2 * fac
                  const orb = ORBITA * (1 - q2)
                  n2x = (dx - tw * dy) * ir + orb * B[o + 8]
                  n2y = (dy + tw * dx) * ir + orb * B[o + 9]
                  n2z = nz
                }
              }
            }
            if (temBuraco) {
              const ex = (sx - hx) * ihx
              const ey = (sy - hy) * ihy
              const e = ex * ex + ey * ey
              if (e < 1) {
                const h = 1 - e
                const sub = h * h * 1.6 * hf
                f0 -= sub
                f1 -= sub
              }
            }
            const idx = b * gx + a
            F0[idx] = f0
            F1[idx] = f1
            F2[idx] = f2
            A0[idx] = a0
            A1[idx] = a1
            A2[idx] = a2
            // (cinza e véu ficam somados: na célula, divididos pelo campo interpolado; assim a borda não pega a cor
            // nem a opacidade do nó vazio do lado)
            G0[idx] = g0
            G1[idx] = g1
            V0[idx] = e0
            V1[idx] = e1
            // a luz da esfera de cima (NaN: nenhum lóbulo cobre o nó, a luz vem do relevo)
            // (no miolo, onde muitos lóbulos se somam, o contraste cai: a massa se funde; na borda, a forma inteira)
            D0[idx] = h0 > -1e8 ? funde(luzEsfera(n0x, n0y, n0z), f0) : NaN
            D1[idx] = h1 > -1e8 ? funde(luzEsfera(n1x, n1y, n1z), f1) : NaN
            D2[idx] = h2 > -1e8 ? funde(luzEsfera(n2x, n2y, n2z), f2) : NaN
          }
        }
      }
    // a luz em cada nó: a normal sai da inclinação do campo (um relevo), a luz fixa vem de cima à esquerda e da frente.
    // O relevo satura (F / (F + 0,6)): onde muitos lóbulos se somam o miolo é chapado (o meio); as faixas aparecem na
    // silhueta e nos vales entre os lóbulos de fora, seguindo a forma
    const u = Math.min(this.W, this.H)
    const S = (0.62 * u) / (2 * G)
    const sat = (v: number) => (v > 0 ? v / (v + 0.6) : 0)
    for (let c = 0; c < 3; c++) {
      if (!this.temCamada[c]) continue
      const cg = cF[c]
      const D = this.cd[c]
      for (let b = 0; b < gy; b++) {
        const bm = b > 0 ? b - 1 : b
        const bp = b < gy - 1 ? b + 1 : b
        for (let a = 0; a < gx; a++) {
          const idx = b * gx + a
          if (D[idx] === D[idx]) continue
          if (cg[idx] <= T * 0.5) {
            D[idx] = LZ
            continue
          }
          const am = a > 0 ? a - 1 : a
          const ap = a < gx - 1 ? a + 1 : a
          const nx = -(sat(cg[b * gx + ap]) - sat(cg[b * gx + am])) * S
          const ny = -(sat(cg[bp * gx + a]) - sat(cg[bm * gx + a])) * S
          D[idx] = (nx * LX3 + ny * LY3 + LZ) / Math.sqrt(nx * nx + ny * ny + 1)
        }
      }
    }
    // interpola o campo nas células (nó (a, b) = centro da célula (2a, 2b))
    const cols = this.cols
    const lins = this.lins
    for (let c = 0; c < 3; c++) {
      if (!this.temCamada[c]) continue
      const cg = cF[c]
      const fg = this.fg[c]
      for (let j = 0; j < lins; j++) {
        const b = j >> 1
        const fy = (j & 1) * 0.5
        const r0 = b * gx
        const r1 = (b + 1) * gx
        for (let i = 0; i < cols; i++) {
          const a = i >> 1
          if (i & 1) {
            const top = (cg[r0 + a] + cg[r0 + a + 1]) * 0.5
            fg[j * cols + i] = fy ? (top + (cg[r1 + a] + cg[r1 + a + 1]) * 0.5) * 0.5 : top
          } else fg[j * cols + i] = fy ? (cg[r0 + a] + cg[r1 + a]) * 0.5 : cg[r0 + a]
        }
      }
    }
  }

  /** O valor de uma grade grossa na célula (i, j), interpolado (meia célula entre os nós). */
  private naCelula(c: Float32Array, i: number, j: number): number {
    const gx = this.gx
    const r0 = (j >> 1) * gx + (i >> 1)
    let v = c[r0]
    if (i & 1) v = (v + c[r0 + 1]) * 0.5
    if (j & 1) {
      let w = c[r0 + gx]
      if (i & 1) w = (w + c[r0 + gx + 1]) * 0.5
      v = (v + w) * 0.5
    }
    return v
  }

  /**
   * Uma camada de fumaça: contorno só por fora da silhuta (e onde a frente dobra sobre a de trás), a opacidade em dither
   * (os pedaços que se desfazem), e 4 faixas pela luz do relevo: a luz, o meio, a sombra e a sombra funda, com dither de
   * 1 célula na costura. Nas raridades viajadas, as faixas psicodélicas (isolinhas do campo) com a mesma luz por cima.
   */
  private camada(c: number, q: Quadro) {
    const { cols, lins, buf } = this
    const F = this.fg[c]
    const D = this.cd[c]
    const Ac = this.ca[c]
    const fundo = c === FUNDO
    const pal = c === CABECA ? q.cabeca : fundo ? q.fundo : q.frente
    const Gc = c < 2 && this.temCinza[c] ? this.cc[c] : null
    const Vc = c < 2 && this.temVeu[c] ? this.cv[c] : null
    const cab = this.cabOk
    const cabL = q.cabecaLobos
    const pc = fundo ? this.cinzaFundo : this.cinzaFrente
    const iso = this.iso && c !== CABECA ? this.iso : null
    const isoK = iso ? q.iso : 0
    const isoTab = iso ? (fundo ? iso.fundo : iso.frente) : null
    const isoC = iso ? (fundo ? iso.contornoFundo : iso.contorno) : 0
    const nIso = isoTab ? isoTab.length / 5 : 0
    const isoF = q.isoFase
    const frenteF = this.temCamada[FRENTE] ? this.fg[FRENTE] : null
    // lendário: as faixas iridescentes que deslizam por cima do ouro (a luz e a beirada de cada faixa) e a luz de borda
    const holoK = c !== CABECA ? q.holo : 0
    const holoL = this.holoLuz
    const holoM = fundo ? this.holoMeioFundo : this.holoMeio
    const holoPasso = (0.2 * Math.min(this.W, this.H)) / this.pix
    const holoF = q.holoFase
    const ultI = cols - 1
    const ultJ = lins - 1
    const opac = 1 / T
    const ferve = q.ferve
    for (let j = 0; j < lins; j++) {
      const row = j * cols
      for (let i = 0; i < cols; i++) {
        const idx = row + i
        const f = F[idx]
        if (f <= T) continue
        // o fundo embaixo da frente não aparece (nem o contorno dele)
        if (fundo && frenteF && frenteF[idx] > T) continue
        if (cab && this.cobertaPelaCabeca(i, j, cabL)) continue
        const by = bayer(i, j)
        // a opacidade: o miolo cheio, a borda de quem se desfaz em dither (o limiar mistura o Bayer com um ruído de 2
        // células que anda: some em grãos irregulares, não num xadrez); quem se desfaz não tem contorno
        let op = this.naCelula(Ac, i, j) * opac
        // o véu (as baforadas semitransparentes): meio-tom ordenado e limpo (Bayer puro), o meio-tom clássico do pixel
        const veu = Vc ? this.naCelula(Vc, i, j) / f : 1
        if (veu < op) {
          if (by >= veu) continue
          op = veu
        } else if (op < 1 && by * 0.55 + hash3(i >> 1, j >> 1, ferve >> 1) * 0.45 >= op) continue
        const fino = op < 0.9
        // a fumaça "de verdade" (as baforadas) é cinza; onde ela encontra a da raridade, mistura em dither
        const usaCinza = Gc !== null && this.naCelula(Gc, i, j) / f > by
        const P = usaCinza ? pc : pal
        let isoB = -1
        if (isoK > 0 && !usaCinza && by < isoK) {
          // as faixas seguem a forma da massa (o campo saturado: nada de manchas onde muitos lóbulos se somam)
          const b = Math.floor((f / (f + 0.9)) * 7.5 - isoF)
          isoB = ((b % nIso) + nIso) % nIso
        }
        // contorno: vizinho de fora
        if (!fino && ((i > 0 && F[idx - 1] <= T) || (i < ultI && F[idx + 1] <= T) || (j > 0 && F[idx - cols] <= T) || (j < ultJ && F[idx + cols] <= T))) {
          buf[idx] = isoB >= 0 ? isoC : P.contorno
          continue
        }
        // a luz do relevo, com a costura em dither
        const d = this.naCelula(D, i, j) + (by - 0.5) * 0.07
        const tom = d > LUZ ? 4 : d > MEIO ? 3 : d > SOMBRA ? 2 : 1
        if (isoB >= 0) buf[idx] = isoTab![isoB * 5 + (tom === 4 ? 4 : tom === 1 ? 2 : 3)]
        else if (holoK > 0 && !usaCinza && by < holoK) {
          // as faixas diagonais correm; a luz pega a cor da faixa, o meio ganha a faixa em dither, a beirada de cima
          // (luz de borda: 2 células pra dentro do contorno, do lado da luz) acende na cor da faixa
          const ph = (i * 0.75 + j * 0.42) / holoPasso - holoF
          const b = Math.floor(ph)
          const fr = ph - b
          const h = ((b % 3) + 3) % 3
          const borda = !fino && ((i > 1 && F[idx - 2] <= T) || (j > 1 && F[idx - 2 * cols] <= T))
          if (borda && tom > 1) buf[idx] = holoL[h]
          else if (tom === 4) buf[idx] = fr < 0.72 ? holoL[h] : P.luz
          else if (tom === 3 && fr > 0.1 && fr < 0.42 && by < 0.5) buf[idx] = holoM[h]
          else buf[idx] = tom === 3 ? P.meio : tom === 2 ? P.sombra : P.funda
        } else buf[idx] = tom === 4 ? P.luz : tom === 3 ? P.meio : tom === 2 ? P.sombra : P.funda
      }
    }
  }

  /**
   * A cabeça de fumaça do épico, célula a célula (as bordas dos lóbulos nítidas): o campo dos lóbulos dá a silhueta
   * (fundidos numa só, contorno de 1 célula só por fora, que ferve a 12 qps), o lóbulo de cima em cada célula dá a cor
   * (as cores das faixas psicodélicas) e a luz da esfera dele (4 tons, costura em dither); onde um lóbulo passa por
   * baixo de outro, 1 célula da sombra funda (a dobra macia). O rubor nas bochechas em dither; desfazendo, em dither.
   */
  private cabecaCalcular(q: Quadro): boolean {
    if (!this.iso) return false
    const n = q.nCabeca
    // (a cabeça anda a 30 qps, como desenho: entre um passo e outro o cálculo é o mesmo)
    const ch = this.cabChave
    const m = n * PASSO_CAB
    let igual = ch[0] === n && ch[1] === q.ferve && this.cabW > 0
    for (let k = 0; igual && k < m; k++) if (ch[k + 2] !== q.cabecaLobos[k]) igual = false
    if (igual) return true
    ch[0] = n
    ch[1] = q.ferve
    for (let k = 0; k < m; k++) ch[k + 2] = q.cabecaLobos[k]
    const Lb = q.cabecaLobos
    const { cols, lins, pix } = this
    let x0 = 1e9
    let y0 = 1e9
    let x1 = -1e9
    let y1 = -1e9
    for (let k = 0; k < n; k++) {
      const o = k * PASSO_CAB
      const r = Lb[o + 2] * SUP
      x0 = Math.min(x0, Lb[o] - r)
      x1 = Math.max(x1, Lb[o] + r)
      y0 = Math.min(y0, Lb[o + 1] - r)
      y1 = Math.max(y1, Lb[o + 1] + r)
    }
    const i0 = Math.max(0, Math.floor(x0 / pix) - 1)
    const j0 = Math.max(0, Math.floor(y0 / pix) - 1)
    const i1 = Math.min(cols - 1, Math.ceil(x1 / pix) + 1)
    const j1 = Math.min(lins - 1, Math.ceil(y1 / pix) + 1)
    if (i1 < i0 || j1 < j0) return false
    const w = i1 - i0 + 1
    const h = j1 - j0 + 1
    this.cabI0 = i0
    this.cabJ0 = j0
    this.cabW = w
    this.cabHh = h
    if (this.cabTop.length < w * h) {
      this.cabTop = new Int8Array(w * h)
      this.cabH = new Float32Array(w * h)
      this.cabTom = new Uint8Array(w * h)
    }
    const top = this.cabTop
    const alt = this.cabH
    const tomA = this.cabTom
    const seed = q.ferve
    // por linha, só os lóbulos que a linha cruza (a cabeça tem ~10; cada linha cruza uns 4)
    const lista = this.cabLista
    // passada grossa (blocos de 2×2 células): o lóbulo de cima no meio de cada bloco, só onde está bem por dentro da
    // silhueta (−1: fora ou perto da borda). Na passada fina, a célula cujo bloco e os 8 vizinhos têm o mesmo lóbulo
    // só calcula a luz dele (o miolo dos lóbulos); as outras (bordas, dobras) calculam tudo
    const gw = (w + 1) >> 1
    const gh = (h + 1) >> 1
    if (this.cabG.length < gw * gh) this.cabG = new Int8Array(gw * gh)
    const G2 = this.cabG
    for (let gj = 0; gj < gh; gj++) {
      const yc = (j0 + 2 * gj + 1) * pix
      let nl = 0
      for (let k = 0; k < n; k++) {
        const o = k * PASSO_CAB
        if (Math.abs(yc - Lb[o + 1]) < Lb[o + 2] * SUP + 3) lista[nl++] = k
      }
      for (let gi = 0; gi < gw; gi++) {
        const xc = (i0 + 2 * gi + 1) * pix
        let f = 0
        let kt = -1
        let hb = -1e9
        for (let m = 0; m < nl; m++) {
          const k = lista[m]
          const o = k * PASSO_CAB
          const r = Lb[o + 2]
          if (r <= 0.5) continue
          const dx = xc - Lb[o]
          const dy = yc - Lb[o + 1]
          const q2 = (dx * dx + dy * dy) / (r * r * RHO2)
          if (q2 >= 1) continue
          f += 1 - q2
          if (q2 < DENTRO * 0.8) {
            const hh = Lb[o + 4] + r * Math.sqrt(1 - q2 * RHO2)
            if (hh > hb) {
              hb = hh
              kt = k
            }
          }
        }
        G2[gj * gw + gi] = f > T * 2 ? kt : -1
      }
    }
    for (let j = j0; j <= j1; j++) {
      const yc = (j + 0.5) * pix
      let nl = 0
      for (let k = 0; k < n; k++) {
        const o = k * PASSO_CAB
        const r = Lb[o + 2] * SUP + 3
        if (Math.abs(yc - Lb[o + 1]) < r) lista[nl++] = k
      }
      const gj = (j - j0) >> 1
      for (let i = i0; i <= i1; i++) {
        const li = (j - j0) * w + (i - i0)
        // o miolo de um lóbulo: só a luz dele
        const gi = (i - i0) >> 1
        const kg = G2[gj * gw + gi]
        if (kg >= 0 && gi > 0 && gj > 0 && gi < gw - 1 && gj < gh - 1) {
          const b0 = (gj - 1) * gw + gi
          const b2 = (gj + 1) * gw + gi
          if (G2[b0 - 1] === kg && G2[b0] === kg && G2[b0 + 1] === kg && G2[b0 + gw - 1] === kg && G2[b0 + gw + 1] === kg && G2[b2 - 1] === kg && G2[b2] === kg && G2[b2 + 1] === kg) {
            const o = kg * PASSO_CAB
            const r = Lb[o + 2]
            const dx = (i + 0.5) * pix - Lb[o]
            const dy = yc - Lb[o + 1]
            const q2 = (dx * dx + dy * dy) / (r * r * RHO2)
            if (q2 < DENTRO) {
              const z = Math.sqrt(1 - q2 * RHO2)
              top[li] = kg
              alt[li] = Lb[o + 4] + r * z
              const d = luzEsfera((dx / r) * 0.62, (dy / r) * 0.62, z) + (bayer(i, j) - 0.5) * 0.07
              tomA[li] = d > LUZ ? 4 : d > MEIO ? 3 : d > SOMBRA ? 2 : 1
              continue
            }
          }
        }
        // a linha ferve: o ponto da amostra treme até ~0,4 célula a 12 qps
        const sx = (i + 0.5) * pix + (hash3(i >> 1, j >> 1, seed) - 0.5) * 2.8
        const sy = yc + (hash3(j >> 1, i >> 1, seed + 77) - 0.5) * 2.8
        let f = 0
        let kt = -1
        let hb = -1e9
        let nx = 0
        let ny = 0
        let nz = 1
        let kmax = -1
        let vmax = 0
        for (let m = 0; m < nl; m++) {
          const k = lista[m]
          const o = k * PASSO_CAB
          const r = Lb[o + 2]
          if (r <= 0.5) continue
          const dx = sx - Lb[o]
          const dy = sy - Lb[o + 1]
          if (dx > r * SUP || dx < -r * SUP) continue
          const q2 = (dx * dx + dy * dy) / (r * r * RHO2)
          if (q2 >= 1) continue
          const v = 1 - q2
          f += v
          if (v > vmax) {
            vmax = v
            kmax = k
          }
          if (q2 < DENTRO) {
            const z = Math.sqrt(1 - q2 * RHO2)
            const hh = Lb[o + 4] + r * z
            if (hh > hb) {
              hb = hh
              kt = k
              nx = dx / r
              ny = dy / r
              nz = z
            }
          }
        }
        if (f <= T) {
          top[li] = -1
          continue
        }
        if (kt < 0) {
          // no vinco entre dois lóbulos (fora das duas esferas): o mais perto, com a normal deitada
          kt = kmax
          const o = kt * PASSO_CAB
          const dx = sx - Lb[o]
          const dy = sy - Lb[o + 1]
          const d = Math.sqrt(dx * dx + dy * dy) || 1
          nx = dx / d
          ny = dy / d
          nz = 0.2
          hb = Lb[o + 4]
        }
        top[li] = kt
        alt[li] = hb
        // (a luz numa esfera achatada: a cara fica quase toda no meio, com o brilho em cima à esquerda e a sombra só
        // na beirada de baixo à direita)
        const d = luzEsfera(nx * 0.62, ny * 0.62, nz) + (bayer(i, j) - 0.5) * 0.07
        tomA[li] = d > LUZ ? 4 : d > MEIO ? 3 : d > SOMBRA ? 2 : 1
      }
    }
    return true
  }

  /** A cabeça coberta inteira (opaca) na célula: a fumaça ali nem é pintada. */
  private cobertaPelaCabeca(i: number, j: number, Lb: Float32Array): boolean {
    const li = i - this.cabI0
    const lj = j - this.cabJ0
    if (li < 1 || lj < 1 || li >= this.cabW - 1 || lj >= this.cabHh - 1) return false
    const k = this.cabTop[lj * this.cabW + li]
    return k >= 0 && Lb[k * PASSO_CAB + 5] >= 0.999
  }

  private cabecaPintar(q: Quadro) {
    const iso = this.iso!
    const Lb = q.cabecaLobos
    const { cols, pix, buf } = this
    const i0 = this.cabI0
    const j0 = this.cabJ0
    const w = this.cabW
    const h = this.cabHh
    const i1 = i0 + w - 1
    const j1 = j0 + h - 1
    const top = this.cabTop
    const alt = this.cabH
    const tomA = this.cabTom
    const contorno = iso.contorno
    const tab = iso.frente
    const nIso = tab.length / 5
    const [hcx, hcy, , rubor, rr] = q.cabecaInfo
    const corRubor = px32('#ff2f6d')
    const R = q.cabecaInfo[2]
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const li = (j - j0) * w + (i - i0)
        const kt = top[li]
        if (kt < 0) continue
        const o = kt * PASSO_CAB
        const a = Lb[o + 5]
        const by = bayer(i, j)
        if (a < 1 && by >= a) continue
        const idx = j * cols + i
        const li0 = i - i0
        const lj0 = j - j0
        if (a > 0.9 && (li0 === 0 || lj0 === 0 || li0 === w - 1 || lj0 === h - 1 || top[li - 1] < 0 || top[li + 1] < 0 || top[li - w] < 0 || top[li + w] < 0)) {
          buf[idx] = contorno
          continue
        }
        let tom = tomA[li]
        // a dobra: o vizinho é de outro lóbulo, mais alto (este passa por baixo dele)
        const h0 = alt[li]
        for (let m = 0; m < 4; m++) {
          const ii = i - i0 + (m === 0 ? -1 : m === 1 ? 1 : 0)
          const jj = j - j0 + (m === 2 ? -1 : m === 3 ? 1 : 0)
          if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue
          const kv = top[jj * w + ii]
          if (kv >= 0 && kv !== kt && alt[jj * w + ii] > h0 + R * 0.02) {
            tom = 1
            break
          }
        }
        const cor = ((Lb[o + 3] | 0) % nIso + nIso) % nIso
        let c = tab[cor * 5 + tom]
        // o rubor das bochechas
        if (rubor > 0.02 && tom > 1) {
          for (const lado of [-1, 1]) {
            const ex = ((i + 0.5) * pix - (hcx + lado * R * 0.56)) / rr
            const ey = ((j + 0.5) * pix - (hcy + R * 0.3)) / (rr * 0.62)
            if (ex * ex + ey * ey < 1 && by < rubor * 0.55) c = corRubor
          }
        }
        buf[idx] = c
      }
  }

  /* ───────────── sprites: máscara (parte·4 + tom) → cor com contorno de 1 célula ───────────── */

  /**
   * Compõe a máscara na caixa (células) e limpa: quem tem vizinho vazio vira contorno (cor 0 da parte); com `luz`, o
   * contorno do lado da luz (vizinho vazio em cima ou à esquerda) vira a luz de borda da parte (quem tiver).
   */
  private compor(i0: number, j0: number, i1: number, j1: number, auto = true, luz = false) {
    const { cols, lins, buf, mask } = this
    i0 = Math.max(0, i0)
    j0 = Math.max(0, j0)
    i1 = Math.min(cols - 1, i1)
    j1 = Math.min(lins - 1, j1)
    const cor = this.corParte
    const corLuz = this.corLuz
    for (let j = j0; j <= j1; j++) {
      const row = j * cols
      for (let i = i0; i <= i1; i++) {
        const idx = row + i
        const m = mask[idx]
        if (!m) continue
        const parte = m >> 2
        let tom = m & 3
        if (auto && tom) {
          const esq = i > 0 && !mask[idx - 1]
          const cima = j > 0 && !mask[idx - cols]
          if (esq || cima || (i < cols - 1 && !mask[idx + 1]) || (j < lins - 1 && !mask[idx + cols])) {
            if (luz && (esq || cima) && corLuz[parte]) {
              buf[idx] = corLuz[parte]
              continue
            }
            tom = 0
          }
        }
        buf[idx] = cor[parte * 4 + tom]
      }
    }
    for (let j = j0; j <= j1; j++) mask.fill(0, j * cols + i0, j * cols + i1 + 1)
  }

  /** Caixa em células de um segmento (px) com folga (px). */
  private caixa(x0: number, y0: number, x1: number, y1: number, folga: number): [number, number, number, number] {
    const p = this.pix
    return [Math.floor((Math.min(x0, x1) - folga) / p), Math.floor((Math.min(y0, y1) - folga) / p), Math.ceil((Math.max(x0, x1) + folga) / p), Math.ceil((Math.max(y0, y1) + folga) / p)]
  }

  /**
   * O beck: piteira, papel cônico, a torcida dobrada e a ponta que queima: a linha de queima irregular (o papel tostado,
   * com a beirada acesa na puxada e a luz quente batendo no papel), o carvão aceso (do vermelho ao laranja e ao miolo
   * amarelo-claro, mais quente e mais comprido quanto mais forte a puxada, com a base da cinza ainda em brasa) e a cinza:
   * irregular, cinza-claro com pintas e rachaduras, a ponta um pouco mais larga e torta, que pende.
   */
  private beck(b: EstadoBeckPx, ferve: number) {
    if (!b.vis) return
    const { cols, lins, pix, mask } = this
    const L = b.L
    const ax = b.ax
    const ay = b.ay
    const nx = -ay
    const ny = ax
    const sPit = 0.2 * L
    const rPit = 0.066 * L
    const r0 = 0.069 * L
    const r1 = 0.092 * L
    const rAt = (s: number) => (s <= sPit ? rPit : r0 + ((r1 - r0) * (s - sPit)) / (L - sPit))
    const acesa = b.brasa > 0.01
    const luz = acesa ? b.luz : 0
    const sb = b.linha * L
    // o carvão: mais comprido na puxada; a base da cinza fica em brasa (quente) enquanto puxa
    const bw = acesa ? (1.3 + 1.5 * luz) * pix : 0
    const quente = acesa ? (0.01 + 0.055 * luz) * L : 0
    const cinza = acesa ? b.cinza : 0
    const tostW = acesa ? 1.6 * pix : 0
    const rb = rAt(sb)
    // a torcida: curta, dobrada pro lado de fora, crimpada
    const tL = TORCIDA_L * L * b.torcida
    const phi = TORCIDA_ANG
    const bx = ax * Math.cos(phi) + nx * Math.sin(phi)
    const byv = ay * Math.cos(phi) + ny * Math.sin(phi)
    const bnx = -byv
    const bny = bx
    const tx0 = b.x0 + ax * L * b.sx
    const ty0 = b.y0 + ay * L * b.sx
    const sCinza0 = sb + bw
    const sFim = Math.max(sCinza0 + cinza, tL > 0 ? L : 0)
    const ex = b.x0 + ax * sFim * b.sx
    const ey = b.y0 + ay * sFim * b.sx
    const folga = r1 * 1.3 * Math.max(b.sx, b.sy) + Math.abs(b.pende) + tL + 3 * pix
    const [i0, j0, i1, j1] = this.caixa(b.x0 - ax * pix * 2, b.y0 - ay * pix * 2, ex, ey, folga)
    const ci0 = Math.max(0, i0)
    const cj0 = Math.max(0, j0)
    const ci1 = Math.min(cols - 1, i1)
    const cj1 = Math.min(lins - 1, j1)
    const corte = b.corte
    const isx = 1 / b.sx
    const isy = 1 / b.sy
    const faceMax = rPit * 0.3
    const fervo = ferve >> 1
    // o raio máximo do corpo e da cinza (com o que ela pende): fora disso não tem beck
    const rLim = r1 * 1.4 + Math.abs(b.pende) + 2 * pix
    for (let j = cj0; j <= cj1; j++) {
      const cy = (j + 0.5) * pix
      for (let i = ci0; i <= ci1; i++) {
        const cx = (i + 0.5) * pix
        if (corte) {
          const qx = (cx - corte.x) / corte.rx
          const borda = corte.y + corte.ry * Math.sqrt(Math.max(0, 1 - qx * qx))
          if (cy > borda) continue
        }
        const dx = cx - b.x0
        const dy = cy - b.y0
        const s = (dx * ax + dy * ay) * isx
        const v = (dx * nx + dy * ny) * isy
        // longe do corpo e da torcida: nada a desenhar (a caixa do beck deitado é quase toda vazia)
        if ((s < -pix || s > sFim + rb * 1.6 || Math.abs(v) > rLim) && tL <= 0) continue
        if (tL > 0 && (s < -pix || Math.abs(v) > rLim) && Math.hypot(cx - tx0, cy - ty0) > tL + rb * 1.2) continue
        // a linha que ferve: o raio treme ±0,55 célula a cada 2 células do comprimento, a 12 qps
        const jit = (hash3(Math.floor(s / (2 * pix)), ferve, 7) - 0.5) * 1.1 * pix
        // a linha de queima irregular (dentes que mudam devagar)
        const vc = Math.floor(v / pix)
        const sbv = sb + (hash3(vc + 31, 5, 1) - 0.5) * 1.5 * pix + (hash3(vc + 31, fervo, 2) - 0.5) * 0.6 * pix
        let code = 0
        if (s >= -0.5 * pix && s <= sFim + rb) {
          if (s <= sPit) {
            const r = rPit + jit
            const av = Math.abs(v)
            if (av <= r) {
              const face = faceMax * Math.sqrt(Math.max(0, 1 - (v / rPit) * (v / rPit)))
              if (s < face) code = Math.abs(v) < rPit * 0.75 && (Math.floor((v / rPit + 1) * 2.6) & 1) === 1 ? P_M * 4 + 1 : P_BOCA_PIT * 4 + tomDe(v / r)
              else code = s > sPit - pix ? P_PITEIRA * 4 + 1 : P_PITEIRA * 4 + tomDe(v / r)
            }
          } else if (s <= sbv || !acesa) {
            const r = rAt(s) + jit
            if (Math.abs(v) <= r && s <= (acesa ? sbv : L)) {
              if (acesa && s > sbv - tostW) {
                // o tostado: a beirada da queima acende na puxada
                code = s > sbv - pix ? (luz > 0.35 ? P_BRASA * 4 + 3 : P_TOSTADO * 4 + 1) : P_TOSTADO * 4 + 2
              } else {
                code = P_PAPEL * 4 + tomDe(v / r)
                // a costura da seda (a beirada colada), tracejada, e uma fibra aqui e ali
                const kv = v / r
                if (kv > 0.08 && kv < 0.08 + pix / r && Math.floor(s / (3 * pix)) % 3 !== 0) code = P_PAPEL * 4 + 1
                else if (hash3(Math.floor(s / pix), Math.floor(v / pix) + 99, 5) < 0.025) code = P_PAPEL * 4 + (kv < -0.36 ? 2 : 1)
                // a luz da brasa batendo no papel perto da queima
                if (acesa && luz > 0.3) {
                  const perto = 1 - (sbv - tostW - s) / (3.2 * pix)
                  if (perto > 0 && bayer(i, j) < (luz - 0.3) * 1.7 * perto) code = P_QUENTE * 4 + tomDe(v / r)
                }
              }
            }
          } else if (s <= sCinza0) {
            // o carvão aceso: o calor no meio, mais fraco na borda; estala a 12 qps
            const r = rb * 0.97 + jit
            const kv = v / r
            if (Math.abs(kv) <= 1) {
              const calor = (0.42 + 0.58 * luz) * (1 - 0.32 * kv * kv) + (hash3(i, j, ferve) - 0.5) * 0.2
              code = corDoCalor(calor)
            }
          } else {
            // a cinza: irregular (o raio varia), alarga e entorta pra ponta, pende pro lado da gravidade
            const k = Math.max(0, (s - sCinza0) / Math.max(1, cinza))
            // o raio irregular (calombos de 2 células, interpolados) e a ponta mais larga e torta
            const qs = (s - sCinza0) / (2.2 * pix)
            const q0 = Math.floor(qs)
            const n1 = lerpN(hash3(q0, 3, 11), hash3(q0 + 1, 3, 11), qs - q0) - 0.5
            let r = rb * (0.84 + 0.32 * n1 + 0.22 * k)
            const centro = b.pende * k * k + rb * 0.26 * Math.sin(k * 3.4 + 1.3) * k + (b.racha > 0 ? b.racha * pix * 0.6 : 0)
            const fimR = sCinza0 + cinza - r * 0.5
            if (s > fimR) {
              const e = (s - fimR) / (r * 0.5)
              r *= Math.sqrt(Math.max(0, 1 - e * e))
              r -= hash3(vc + 7, 2, 13) * pix * 0.9
            }
            r += jit * 0.5
            const vv = v - centro
            if (Math.abs(vv) <= r && s <= sCinza0 + cinza) {
              const dS = s - sCinza0
              const vq = Math.floor(vv / pix)
              const sq = Math.floor(dS / pix)
              // a base ainda em brasa enquanto puxa
              const calor = quente > 0 ? luz * 0.86 * Math.pow(Math.max(0, 1 - dS / quente), 1.2) * (1 - 0.3 * (vv / r) ** 2) + (hash3(i, j, ferve + 3) - 0.5) * 0.22 : 0
              if (b.racha > 0 && dS < pix * 1.2) code = P_RACHA * 4 + 1
              else if (calor > 0.24) code = corDoCalor(calor)
              else {
                code = P_CINZA * 4 + tomDe(vv / r)
                // as pintas escuras e as rachaduras (tortas, atravessando parte da largura)
                if (hash3(sq + 7, vq + 3, 9) < 0.08) code = P_RACHA * 4 + 1
                else if (cinza > 6 * pix) {
                  for (const kc of RACHAS) {
                    const sc = kc * cinza + vv * 0.32 + (hash3(vq, Math.round(kc * 10), 4) - 0.5) * 1.3 * pix
                    if (Math.abs(dS - sc) < 0.55 * pix && Math.abs(vv) < r * 0.78) code = P_RACHA * 4 + 1
                  }
                }
              }
            }
          }
        }
        if (!code && tL > 0) {
          const ddx = cx - tx0
          const ddy = cy - ty0
          const st = ddx * bx + ddy * byv
          const vt = ddx * bnx + ddy * bny
          if (st >= -rb * 0.7 && st <= tL) {
            const w = rb * 0.86 * (st <= 0 ? 1 : Math.pow(Math.max(0, 1 - st / tL), 0.6)) + jit * 0.5
            if (Math.abs(vt) <= w) {
              const k = st / tL
              // as dobras da torcida: 3 vincos em diagonal
              const vinco = (k + (vt / Math.max(1, rb)) * 0.18) * 4
              code = k > 0.12 && vinco - Math.floor(vinco) < 0.2 ? P_TORCIDA * 4 + 1 : P_TORCIDA * 4 + tomDe(vt / Math.max(1, w))
            }
          }
        }
        if (code) mask[j * cols + i] = code
      }
    }
    this.compor(ci0, cj0, ci1, cj1, true, true)
  }

  /**
   * O brilho da brasa em volta (atrás do beck), que pulsa: no preto, 3 tons em dither do vermelho-escuro de fora ao
   * laranja de perto (uma luz suave, não pontinhos); em cima da fumaça, a luz quente batendo nela.
   */
  private brilho(g: Float32Array) {
    const { cols, lins, pix, buf } = this
    const [x, y, R, forca] = g
    const [i0, j0, i1, j1] = this.caixa(x, y, x, y, R)
    const escuro = [px32('#2e0a04'), px32('#621806'), px32('#a8300c')]
    const quente = [px32('#ffb27a'), px32('#ff8a4a')]
    for (let j = Math.max(0, j0); j <= Math.min(lins - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(cols - 1, i1); i++) {
        const dx = (i + 0.5) * pix - x
        const dy = (j + 0.5) * pix - y
        const r = Math.sqrt(dx * dx + dy * dy) / R
        if (r >= 1) continue
        const v = Math.pow(1 - r, 1.25) * forca
        const by = bayer(i, j)
        const nivel = v * 3.3 + (by - 0.5) * 0.95
        if (nivel < 0.55) continue
        const idx = j * cols + i
        if (buf[idx] === 0) buf[idx] = escuro[nivel > 2.3 ? 2 : nivel > 1.4 ? 1 : 0]
        else if (nivel > 1.6 && by < v * 0.7) buf[idx] = quente[nivel > 2.4 ? 0 : 1]
      }
  }

  /** A brasa engolida pela fumaça: a luz dela atravessa a fumaça por um instante (laranja e amarelo em dither). */
  private brilhoSobre(g: Float32Array) {
    const { cols, lins, pix, buf } = this
    const [x, y, R, forca] = g
    const [i0, j0, i1, j1] = this.caixa(x, y, x, y, R)
    const c1 = px32('#ffd27a')
    const c2 = px32('#ff9a4a')
    for (let j = Math.max(0, j0); j <= Math.min(lins - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(cols - 1, i1); i++) {
        const idx = j * cols + i
        if (buf[idx] === 0) continue
        const dx = (i + 0.5) * pix - x
        const dy = (j + 0.5) * pix - y
        const r = Math.sqrt(dx * dx + dy * dy) / R
        if (r >= 1) continue
        const v = Math.pow(1 - r, 1.4) * forca
        const by = bayer(i, j)
        if (by < v * 0.8) buf[idx] = by < v * 0.3 ? c1 : c2
      }
  }

  /** O estalo da torcida pegando: estrela de 4 pontas branca e amarela. */
  private estalo(e: Float32Array) {
    const i = Math.floor(e[0] / this.pix)
    const j = Math.floor(e[1] / this.pix)
    const n = Math.round(2 + 4 * e[2])
    const b = px32('#ffffff')
    const a = px32('#ffe27a')
    for (let k = 0; k <= n; k++) {
      const c = k < n * 0.5 ? b : a
      this.ponto(i + k, j, c)
      this.ponto(i - k, j, c)
      this.ponto(i, j + k, c)
      this.ponto(i, j - k, c)
      if (k <= n * 0.35) {
        this.ponto(i + k, j + k, a)
        this.ponto(i - k, j - k, a)
        this.ponto(i + k, j - k, a)
        this.ponto(i - k, j + k, a)
      }
    }
  }

  /** O isqueiro de desenho (sem marca): corpo, capuz de metal com as fendas, a roda e a chama de lado. */
  private isqueiro(s: EstadoIsqueiro, ferve: number) {
    if (!s.vis) return
    const { cols, lins, pix, mask } = this
    const h = s.h
    const w = h * 0.58
    const ux = Math.sin(s.ang)
    const uy = -Math.cos(s.ang)
    const rx = Math.cos(s.ang)
    const ry = Math.sin(s.ang)
    const [i0, j0, i1, j1] = this.caixa(s.x, s.y, s.x - ux * h, s.y - uy * h, w + h * 0.35)
    const ci0 = Math.max(0, i0)
    const cj0 = Math.max(0, j0)
    const ci1 = Math.min(cols - 1, i1)
    const cj1 = Math.min(lins - 1, j1)
    const capuz = h * 0.24
    for (let j = cj0; j <= cj1; j++)
      for (let i = ci0; i <= ci1; i++) {
        const dx = (i + 0.5) * pix - s.x
        const dy = (j + 0.5) * pix - s.y
        const lx = dx * rx + dy * ry
        const ly = -(dx * ux + dy * uy)
        let code = 0
        const jit = (hash3(i, j, ferve) - 0.5) * 0.6 * pix
        if (ly >= capuz && ly <= capuz + h) {
          // corpo com os cantos de baixo arredondados
          const yy = ly - capuz
          let meia = w * 0.5
          const raio = w * 0.22
          if (yy > h - raio) {
            const e = (yy - (h - raio)) / raio
            meia = w * 0.5 - raio + raio * Math.sqrt(Math.max(0, 1 - e * e))
          }
          if (Math.abs(lx) <= meia + jit) {
            const k = lx / (w * 0.5)
            code = P_CORPO * 4 + (k < -0.45 ? 3 : k > 0.42 ? 1 : 2)
            if (Math.abs(lx + w * 0.3) < pix * 0.6 && yy > h * 0.12 && yy < h * 0.8) code = P_CORPO * 4 + 3
          }
        } else if (ly >= 0 && ly < capuz) {
          if (Math.abs(lx) <= w * 0.44 + jit) {
            const k = lx / (w * 0.44)
            code = P_CAPUZ * 4 + (k < -0.4 ? 3 : k > 0.45 ? 1 : 2)
            for (let f = -1; f <= 1; f++) if (Math.abs(lx - f * w * 0.2) < w * 0.055 && ly > capuz * 0.3 && ly < capuz * 0.78) code = P_FENDA * 4 + 1
          }
        }
        // a roda, atrás do capuz do lado direito, e o botão do lado esquerdo
        if (!code) {
          const qx = lx - w * 0.2
          const qy = ly - capuz * 0.95
          const rr = w * 0.2
          if (qx * qx + qy * qy <= rr * rr) code = P_RODA * 4 + ((Math.floor(Math.atan2(qy, qx) * 3 + ferve) & 1) === 1 ? 1 : 3)
          else if (lx < -w * 0.08 && lx > -w * 0.52 && ly > capuz * 0.7 && ly < capuz * 1.25) code = P_RODA * 4 + 2
        }
        if (code) mask[j * cols + i] = code
      }
    this.compor(ci0, cj0, ci1, cj1)
    if (s.chama > 0.01) this.chama(s.x, s.y, s.chamaAng, h * 0.6 * s.chama, h * 0.17 * Math.min(1, s.chama * 1.5), ferve)
    if (s.faisca > 0.01) {
      const i = Math.floor((s.x + ux * h * 0.05) / pix)
      const j = Math.floor((s.y + uy * h * 0.05) / pix)
      const c = px32('#fff6d6')
      const n = Math.round(1 + 2 * s.faisca)
      for (let k = 1; k <= n; k++) {
        this.ponto(i + k, j - k, c)
        this.ponto(i - k, j - k, c)
        this.ponto(i, j - k - 1, c)
      }
    }
  }

  /** A chama de desenho (gota com 3 faixas), saindo da base (x, y) na direção ang (0 = pra cima). */
  private chama(x: number, y: number, ang: number, comp: number, larg: number, ferve: number) {
    const { cols, lins, pix, mask } = this
    const dx0 = Math.sin(ang)
    const dy0 = -Math.cos(ang)
    const px = -dy0
    const py = dx0
    const [i0, j0, i1, j1] = this.caixa(x, y, x + dx0 * comp, y + dy0 * comp, larg + 2 * pix)
    const ci0 = Math.max(0, i0)
    const cj0 = Math.max(0, j0)
    const ci1 = Math.min(cols - 1, i1)
    const cj1 = Math.min(lins - 1, j1)
    const q = ferve % 3
    const dentro = (s: number, v: number, c: number, w: number) => {
      if (s < -w) return false
      if (s < 0) return s * s + v * v <= w * w
      if (s > c) return false
      return Math.abs(v) <= w * Math.pow(1 - s / c, 1.25)
    }
    for (let j = cj0; j <= cj1; j++)
      for (let i = ci0; i <= ci1; i++) {
        const ddx = (i + 0.5) * pix - x
        const ddy = (j + 0.5) * pix - y
        const s = ddx * dx0 + ddy * dy0 - larg * 0.6
        let v = ddx * px + ddy * py
        // a ponta balança (3 quadros a 12 qps)
        v += Math.sin((s / comp) * 4.5 + q * 2.1) * larg * 0.28 * Math.max(0, s / comp)
        let code = 0
        if (dentro(s, v, comp, larg)) {
          code = P_CHAMA * 4 + 1
          if (dentro(s - comp * 0.06, v, comp * 0.7, larg * 0.68)) code = P_CHAMA * 4 + 2
          if (dentro(s - comp * 0.12, v, comp * 0.42, larg * 0.38)) code = P_CHAMA * 4 + 3
        }
        if (code) mask[j * cols + i] = code
      }
    this.compor(ci0, cj0, ci1, cj1)
  }

  /**
   * Um fiapo (crítica da 3ª rodada: a ponta fechada numa bolota com rabo lia como girino): uma fita de fumaça que sobe
   * da brasa ondulando, fina na base (1 célula), engrossa no meio (até ~2,4 células, com a luz de um lado e a sombra do
   * outro) e afina de novo até 1 célula; a ponta termina num caracol ABERTO (uma espiral de pouco mais de meia volta que
   * vai fechando o raio sem nunca encostar no começo) e se desfaz em pontos de dither. Sem contorno escuro: fumaça
   * clara no preto.
   */
  private fita(q: Quadro, k: number) {
    const f = q.fitas[k]
    if (f.comp < 2 || f.alfa <= 0.05) return
    const { cols, lins, pix, mask } = this
    const u = Math.min(this.W, this.H)
    const passo = pix * 0.5
    // o corpo (até o caracol) e o caracol
    const corpo = f.comp * 0.8
    const n = Math.max(2, Math.ceil(corpo / passo))
    const A0 = 0.05 * u
    const onda = (Math.PI * 2) / (0.26 * u)
    const ex = Math.sin(f.inc)
    const ey = -Math.cos(f.inc)
    const nx = -ey
    const ny = ex
    const alfa = f.alfa
    const t = q.t
    let mi0 = cols
    let mj0 = lins
    let mi1 = 0
    let mj1 = 0
    const marca = (i: number, j: number, dither: number) => {
      if (i < 0 || j < 0 || i >= cols || j >= lins) return
      const by = bayer(i, j)
      if (by >= alfa * dither) return
      mask[j * cols + i] = P_FITA * 4 + 2
      if (i < mi0) mi0 = i
      if (j < mj0) mj0 = j
      if (i > mi1) mi1 = i
      if (j > mj1) mj1 = j
    }
    /** Um disco de diâmetro d (células) no ponto (px); d < 1,3: uma célula só. */
    const disco = (x: number, y: number, d: number, dither: number) => {
      const ci = Math.floor(x / pix)
      const cj = Math.floor(y / pix)
      if (d < 1.3) {
        marca(ci, cj, dither)
        return
      }
      const r = d / 2
      const fx = x / pix - 0.5
      const fy = y / pix - 0.5
      const R = Math.ceil(r)
      for (let dj = -R; dj <= R; dj++)
        for (let di = -R; di <= R; di++) {
          const i = ci + di
          const j = cj + dj
          const ddx = i - fx
          const ddy = j - fy
          if (ddx * ddx + ddy * ddy <= r * r) marca(i, j, dither)
        }
    }
    // o corpo: sobe ondulando (a onda corre pra cima, a amplitude cresce com a altura) e balança de leve
    const balanca = Math.sin(t * 1.3 + f.fase) * 0.02 * u
    let x = f.x
    let y = f.y
    let hx = ex
    let hy = ey
    let px0 = x
    let py0 = y
    for (let s = 0; s <= n; s++) {
      const kk = s / n
      const ds = kk * corpo
      const amp = A0 * (0.2 + 0.8 * kk)
      const off = amp * Math.sin(ds * onda - t * 4 + f.fase) + balanca * kk * kk
      x = f.x + ex * ds + nx * off
      y = f.y + ey * ds + ny * off
      if (s > 0) {
        const dl = Math.hypot(x - px0, y - py0) || 1
        hx = (x - px0) / dl
        hy = (y - py0) / dl
      }
      px0 = x
      py0 = y
      // a espessura: 1 célula na base, engorda no meio, 1 célula no fim do corpo; solta, a base some primeiro
      const inch = kk < 0.78 ? Math.pow(Math.sin(Math.PI * Math.min(1, kk / 0.78)), 0.8) : 0
      let d = (1 + 1.4 * inch * f.larg) * (1 + 0.12 * Math.sin(ds * onda * 2.3 + f.fase - t * 3))
      let dith = 1
      if (f.solta > 0) {
        const corteK = f.solta * 0.85
        if (kk < corteK) continue
        dith = Math.min(1, (kk - corteK) / 0.12)
        d *= 0.6 + 0.4 * dith
      }
      disco(x, y, d, dith)
    }
    // o caracol aberto: o rumo vira pro lado (mais de meia volta, menos de uma), o raio fecha de R0 até ~0,55·R0; a
    // ponta (o último terço) se desfaz em dither e solta uns pontos
    const lado = f.lado
    // (o caracol cresce com o fiapo: pequeno, só um gancho; comprido, mais de meia volta, sempre com o miolo aberto)
    const cresce = Math.min(1, Math.max(0, (f.comp - 0.15 * u) / (0.3 * u)))
    const R0 = Math.min(0.05 * u, Math.max(3.2 * pix, f.comp * 0.11))
    const Th = Math.PI * (0.85 + 0.22 * cresce + 0.08 * Math.sin(t * 1.7 + f.fase))
    // o centro do caracol: do lado de dentro da curva, a R0 da ponta do corpo
    const cxp = x + -hy * lado * R0
    const cyp = y + hx * lado * R0
    const a0 = Math.atan2(y - cyp, x - cxp)
    const m = Math.ceil((Th * R0) / passo)
    let tx = x
    let ty = y
    for (let s = 1; s <= m; s++) {
      const kk = s / m
      const th = kk * Th
      const r = R0 * (1 - 0.45 * kk)
      const an = a0 + lado * th
      tx = cxp + Math.cos(an) * r
      ty = cyp + Math.sin(an) * r
      const dith = kk < 0.55 ? 1 : 1 - ((kk - 0.55) / 0.45) * 0.85
      disco(tx, ty, 1, dith)
    }
    if (mi1 < mi0) return
    // a luz e a sombra da fita: o lado de cima à esquerda acende, o de baixo à direita escurece (só onde ela tem mais
    // de uma célula de largura)
    for (let j = mj0; j <= mj1; j++)
      for (let i = mi0; i <= mi1; i++) {
        const idx = j * cols + i
        if (mask[idx] !== P_FITA * 4 + 2) continue
        const luz = (i > 0 && !mask[idx - 1]) || (j > 0 && !mask[idx - cols])
        const sombra = (i < cols - 1 && !mask[idx + 1]) || (j < lins - 1 && !mask[idx + cols])
        if (luz && !sombra) mask[idx] = P_FITA * 4 + 3
        else if (sombra && !luz) mask[idx] = P_FITA * 4 + 1
      }
    this.compor(mi0, mj0, mi1, mj1, false)
  }

  /** Argola (raro): toro inclinado, a luz em cima do tubo. */
  private anel(a: Anel) {
    if (a.vis <= 0.01 || a.rx < 1) return
    const { cols, lins, pix, mask } = this
    const [i0, j0, i1, j1] = this.caixa(a.x - a.rx, a.y - a.ry, a.x + a.rx, a.y + a.ry, a.esp * 1.3 + pix)
    const ci0 = Math.max(0, i0)
    const cj0 = Math.max(0, j0)
    const ci1 = Math.min(cols - 1, i1)
    const cj1 = Math.min(lins - 1, j1)
    for (let j = cj0; j <= cj1; j++)
      for (let i = ci0; i <= ci1; i++) {
        if (bayer(i, j) >= a.vis) continue
        const dx = (i + 0.5) * pix - a.x
        const dy = (j + 0.5) * pix - a.y
        const ex = dx / a.rx
        const ey = dy / a.ry
        const rho = Math.sqrt(ex * ex + ey * ey)
        if (rho < 1e-3) continue
        const rLoc = Math.sqrt(dx * dx + dy * dy) / rho
        const dist = (rho - 1) * rLoc
        const esp = a.esp * (dy > 0 ? 1.15 : 0.85)
        if (Math.abs(dist) > esp) continue
        const lado = dist > 0 === dy < 0
        const k = Math.abs(dist) / esp
        const tom = k < 0.4 ? 2 : lado ? 3 : 1
        mask[j * cols + i] = P_ANEL * 4 + tom
      }
    this.compor(ci0, cj0, ci1, cj1)
  }

  /** A espiral (raro): as argolas se enrolam numa espiral de frente, girando. */
  private espiral(q: Quadro) {
    const [x, y, R, voltas, giro, esp, vis] = q.espiral
    const { cols, lins, pix, mask } = this
    const [i0, j0, i1, j1] = this.caixa(x - R, y - R, x + R, y + R, esp + pix)
    const ci0 = Math.max(0, i0)
    const cj0 = Math.max(0, j0)
    const ci1 = Math.min(cols - 1, i1)
    const cj1 = Math.min(lins - 1, j1)
    const fim = Math.PI * 2 * voltas
    const passo = R / fim
    for (let j = cj0; j <= cj1; j++)
      for (let i = ci0; i <= ci1; i++) {
        if (bayer(i, j) >= vis) continue
        const dx = (i + 0.5) * pix - x
        const dy = (j + 0.5) * pix - y
        const rho = Math.sqrt(dx * dx + dy * dy)
        let an = Math.atan2(dy, dx) - giro
        an -= Math.PI * 2 * Math.floor(an / (Math.PI * 2))
        // a volta mais perto
        const kk = Math.round((rho / passo - an) / (Math.PI * 2))
        const phiK = an + Math.PI * 2 * kk
        if (phiK < 0 || phiK > fim) continue
        const rk = phiK * passo
        const e = esp * (0.45 + 0.55 * (phiK / fim))
        const d = rho - rk
        if (Math.abs(d) > e) continue
        const luz = (dx * LX + dy * LY) / Math.max(1, rho)
        const k = Math.abs(d) / e
        const tom = k < 0.4 ? 2 : (d > 0) === luz > 0 ? 3 : 1
        mask[j * cols + i] = P_ANEL * 4 + tom
      }
    this.compor(ci0, cj0, ci1, cj1)
  }

  /** O olho do raro (a espiral vira íris): branco, íris azul, pupila que dilata e vira o buraco do prêmio, pálpebras. */
  private iris(q: Quadro) {
    const [x, y, rx, ry, abre, pupila, aro, vis, ox, oy] = q.iris
    const { cols, lins, pix, mask } = this
    const [i0, j0, i1, j1] = this.caixa(x - rx, y - ry, x + rx, y + ry, pix * 3)
    const ci0 = Math.max(0, i0)
    const cj0 = Math.max(0, j0)
    const ci1 = Math.min(cols - 1, i1)
    const cj1 = Math.min(lins - 1, j1)
    const ri = ry * 0.86
    for (let j = cj0; j <= cj1; j++)
      for (let i = ci0; i <= ci1; i++) {
        if (bayer(i, j) >= vis) continue
        const dx = (i + 0.5) * pix - x
        const dy = (j + 0.5) * pix - y
        const r = Math.sqrt(dx * dx + dy * dy)
        let code = 0
        if (aro > 0) {
          // só o aro da íris, como moldura, se partindo em gomos
          const pr = Math.max(pupila, ri * 0.6)
          if (r >= pr && r <= pr + ry * 0.22) {
            const g = Math.floor(((Math.atan2(dy, dx) / (Math.PI * 2)) * 10 + 10) % 10)
            if (hash3(g, 9, 1) > aro - 0.05) code = P_IRIS * 4 + ((r - pr) / (ry * 0.22) < 0.5 ? 3 : 2)
          }
          if (code) mask[j * cols + i] = code
          continue
        }
        const ex = dx / rx
        const ey = dy / ry
        const e = ex * ex + ey * ey
        if (e > 1) continue
        // pálpebras de fumaça: a fresta aberta é |dy| ≤ ry·abre·√(1 − ex²); a linha delas ferve (12 qps)
        const fresta = ry * abre * Math.sqrt(Math.max(0, 1 - ex * ex)) + (hash3(i, q.ferve, 3) - 0.5) * pix * 0.9 * Math.min(1, abre * 4)
        if (Math.abs(dy) > fresta) {
          code = P_PALPEBRA * 4 + (dy < 0 ? (ey < -0.55 ? 3 : 2) : 1)
          if (Math.abs(Math.abs(dy) - fresta) < pix * 0.9) code = P_CONTORNO * 4 + 1
        } else {
          // a íris e a pupila andam juntas pra onde o olho olha
          const qx = dx - ox
          const qy = dy - oy
          const rq = Math.sqrt(qx * qx + qy * qy)
          if (rq <= pupila) code = rq > pupila - pix || (qx + pupila * 0.35) ** 2 + (qy + pupila * 0.35) ** 2 > (pupila * 0.22) ** 2 ? P_PUPILA * 4 + 2 : P_BRILHO * 4 + 2
          else if (rq <= ri) code = P_IRIS * 4 + (rq > ri - pix ? 1 : qx * LX + qy * LY > rq * 0.4 ? 3 : 2)
          else code = P_BRANCO * 4 + (dy > ry * 0.35 ? 1 : 2)
        }
        mask[j * cols + i] = code
      }
    this.compor(ci0, cj0, ci1, cj1)
  }

  /** O sorriso preguiçoso e o olho que pisca do comum: só a linha de contorno, desenhada em cima da fumaça. */
  private sorriso(q: Quadro) {
    const [x, y, w, abre, pisca] = q.sorriso
    const { pix } = this
    const cor = q.frente.contorno
    // a linha do rosto ferve como o resto do desenho (a 12 qps: muda um pouco de lugar e de curva), nunca parada
    const fv = q.ferve
    const ci = x / pix + (hash3(fv, 11, 3) - 0.5) * 1.3
    const cj = y / pix + (hash3(fv, 12, 3) - 0.5) * 1.1
    const W = (w / pix) * abre * (1 + (hash3(fv, 13, 3) - 0.5) * 0.12)
    const curva = 0.12 * (w / pix) * (1 + (hash3(fv, 14, 3) - 0.5) * 0.3)
    // traço de 2 células (lê no celular), só onde tem fumaça da frente
    const marca = (i: number, j: number) => {
      const ii = Math.round(i)
      const jj = Math.round(j)
      if (this.campoFrente(ii, jj) > T) this.ponto(ii, jj, cor)
      if (this.campoFrente(ii, jj + 1) > T) this.ponto(ii, jj + 1, cor)
    }
    // o sorriso: parábola de 1 célula com os cantinhos subindo
    let ultimo = Number.NaN
    for (let d = -W / 2; d <= W / 2; d += 0.5) {
      const k = d / (W / 2 || 1)
      const yy = cj + curva * (1 - k * k) * abre
      marca(ci + d, yy)
      if (!Number.isNaN(ultimo) && Math.abs(Math.round(yy) - ultimo) > 1) marca(ci + d, yy - Math.sign(yy - ultimo))
      ultimo = Math.round(yy)
    }
    if (abre > 0.6) {
      marca(ci - W / 2 - 1, cj - 1)
      marca(ci + W / 2 + 1, cj - 1)
    }
    // os olhos: "^" de 10 células; o direito pisca (^ → ponto → fechado → ^)
    const olhoY = cj - (w / pix) * 0.36
    for (const lado of [-1, 1]) {
      const ox = ci + lado * (w / pix) * 0.24
      const estado = lado > 0 ? pisca : 0
      if (estado < 0.5) {
        for (let d = 0; d <= 3; d++) {
          marca(ox - d, olhoY + d * 0.8 - 1)
          marca(ox + d, olhoY + d * 0.8 - 1)
        }
      } else if (estado < 1.5) {
        marca(ox, olhoY)
        marca(ox + 1, olhoY)
        marca(ox, olhoY + 1)
        marca(ox + 1, olhoY + 1)
      } else for (let d = -3; d <= 3; d++) marca(ox + d, olhoY + 1)
    }
  }

  /** Olho do épico (na cabeça: pálpebra pesada, pupila em espiral, sobrancelha, bolsa) e do lendário (portal). */
  private olho(o: Olho, q: Quadro) {
    if (o.abre <= 0.01 && q.olhosTipo !== 0) return
    const { cols, lins, pix, mask } = this
    const rx = o.r
    const ry = o.r * o.prop
    const [i0, j0, i1, j1] = this.caixa(o.x - rx, o.y - ry * 1.8, o.x + rx, o.y + ry * 1.6, pix * 3)
    const ci0 = Math.max(0, i0)
    const cj0 = Math.max(0, j0)
    const ci1 = Math.min(cols - 1, i1)
    const cj1 = Math.min(lins - 1, j1)
    const epico = q.olhosTipo === 0
    const pupR = ry * (epico ? 0.62 : 0.5)
    const px0 = o.x + o.ox * rx * 0.42
    const py0 = o.y + ry * (epico ? 0.18 : 0.05) + o.oy * ry * 0.3
    // a pálpebra pesada (épico): a fresta é a parte de baixo; o portal abre do meio
    const tampa = epico ? -ry + 2 * ry * (1 - o.abre) : 0
    const isoCores = this.iso
    for (let j = cj0; j <= cj1; j++)
      for (let i = ci0; i <= ci1; i++) {
        const dx = (i + 0.5) * pix - o.x
        const dy = (j + 0.5) * pix - o.y
        const ex = dx / rx
        const ey = dy / ry
        const e = ex * ex + ey * ey
        let code = 0
        if (e <= 1) {
          const fechado = epico ? dy < tampa : Math.abs(dy) > ry * o.abre * Math.sqrt(Math.max(0, 1 - ex * ex))
          if (fechado) {
            code = P_PALPEBRA * 4 + (ey < -0.5 ? 3 : 2)
            const borda = epico ? Math.abs(dy - tampa) < pix * 1.1 : Math.abs(Math.abs(dy) - ry * o.abre * Math.sqrt(Math.max(0, 1 - ex * ex))) < pix
            if (borda) code = P_CONTORNO * 4 + 1
          } else {
            const qx = (i + 0.5) * pix - px0
            const qy = (j + 0.5) * pix - py0
            const rp = Math.sqrt(qx * qx + qy * qy)
            const brilho = (qx + pupR * 0.4) ** 2 + (qy + pupR * 0.42) ** 2 < (pupR * 0.24) ** 2
            if (epico && rp < pupR) {
              if (brilho) code = P_BRILHO * 4 + 2
              else if (rp > pupR - pix || !isoCores) code = P_PUPILA * 4 + 1
              else {
                // a pupila em espiral: anéis nas cores da viagem que correm pra dentro
                const b = Math.floor((rp / pupR) * 4.5 - q.t * 2.6)
                if ((b & 1) === 0) {
                  const n = isoCores.frente.length / 5
                  this.buf[j * cols + i] = isoCores.frente[((((b >> 1) % n) + n) % n) * 5 + 3]
                  continue
                }
                code = P_PUPILA * 4 + 2
              }
            } else if (!epico && rp < pupR * 0.55) code = brilho ? P_BRILHO * 4 + 2 : P_PUPILA * 4 + 2
            else if (!epico && rp < pupR * 1.25) code = P_IRIS * 4 + (rp > pupR * 1.05 ? 1 : qx * LX + qy * LY > 0 ? 3 : 2)
            else code = P_BRANCO * 4 + (ey > 0.45 ? 1 : 2)
          }
        } else if (epico) {
          // a bolsa embaixo do olho (cara de quem viajou) e a sobrancelha que sobe na piscada
          const bx2 = dx / (rx * 0.95)
          const by2 = (dy - ry * 0.25) / (ry * 1.25)
          const eb = bx2 * bx2 + by2 * by2
          if (dy > ry * 0.5 && Math.abs(eb - 1) < (pix * 0.9) / ry && Math.abs(dx) < rx * 0.7) code = P_CONTORNO * 4 + 1
          const sy = o.y - ry * 1.32 - q.sobrancelha * ry * 0.35 + (dx / rx) * (dx / rx) * ry * 0.18
          if (Math.abs(dx) < rx * 0.8 && dy > sy - o.y - pix && dy < sy - o.y + pix) code = P_CONTORNO * 4 + 1
        }
        if (code) mask[j * cols + i] = code
      }
    this.compor(ci0, cj0, ci1, cj1)
  }

  /** A boca do épico: sorriso largo com dentes e língua, que vira bico (O) e sopra. */
  private boca(q: Quadro) {
    const [x, y, w, sorri, bico, sopro] = q.boca
    const { cols, lins, pix, mask } = this
    const L = w
    const [i0, j0, i1, j1] = this.caixa(x - L, y - L, x + L, y + L, pix * 2)
    const ci0 = Math.max(0, i0)
    const cj0 = Math.max(0, j0)
    const ci1 = Math.min(cols - 1, i1)
    const cj1 = Math.min(lins - 1, j1)
    for (let j = cj0; j <= cj1; j++)
      for (let i = ci0; i <= ci1; i++) {
        const qx = ((i + 0.5) * pix - x) / L
        const qy = ((j + 0.5) * pix - y) / L
        let code = 0
        if (bico > 0.5) {
          // o "o" (bochechas cheias) e a boca aberta soprando
          const ro = 0.2 + 0.36 * sopro
          const e = (qx / ro) ** 2 + (qy / (ro * 1.15)) ** 2
          if (e <= 1) code = e > 0.55 ? P_BOCA * 4 + 3 : P_BOCA * 4 + 1
        } else {
          // o sorrisão: os cantos sobem (o lábio de cima é um sorriso, o de baixo mais fundo), os dentes de cima, a
          // língua embaixo e as covinhas nos cantos
          const ab = sorri
          const ax = Math.abs(qx)
          const topo = -0.34 * qx * qx * ab
          const base = topo + 0.64 * ab * Math.pow(Math.max(0, 1 - qx * qx), 0.7)
          if (ax <= 1 && qy >= topo && qy <= base) {
            code = P_BOCA * 4 + 2
            if (qy < topo + 0.17 * ab) code = P_DENTE * 4 + 2
            else if (qy > base - 0.24 * ab && ax < 0.5) code = P_LINGUA * 4 + 2
          } else if (ab > 0.6 && qy > -0.52 * ab && qy < -0.26 * ab && Math.abs(ax - (1.08 - 0.5 * (qy + 0.39 * ab) * (qy + 0.39 * ab) / ab)) < 0.055) code = P_CONTORNO * 4 + 1
        }
        if (code) mask[j * cols + i] = code
      }
    this.compor(ci0, cj0, ci1, cj1)
  }

  /**
   * O clarão do lendário numa placa holográfica: faixas diagonais em tons pastel (rosa, ciano, violeta, creme) que
   * correm, cobrindo tudo no primeiro quadro e indo embora em dither.
   */
  private clarao(k: number, t: number) {
    const { cols, lins, buf, pix } = this
    const u = Math.min(this.W, this.H)
    const cores = [px32('#ffd6f0'), px32('#d2fbff'), px32('#e6d6ff'), px32('#fffbe6')]
    const brilho = px32('#ffffff')
    const larg = (0.16 * u) / pix
    const f = t * 2.2
    for (let j = 0; j < lins; j++)
      for (let i = 0; i < cols; i++) {
        const by = bayer(i, j)
        if (by >= k) continue
        const ph = (i * 0.8 + j * 0.45) / larg - f
        const b = Math.floor(ph)
        const fr = ph - b
        buf[j * cols + i] = fr > 0.86 && by < k * 0.6 ? brilho : cores[((b % 4) + 4) % 4]
      }
  }

}


/** O tom pelo lado do cilindro (v/r: −1 do lado da luz, +1 do lado da sombra). */
function tomDe(k: number): number {
  return k < -0.36 ? 3 : k > 0.44 ? 1 : 2
}

const lerpN = (a: number, b: number, k: number) => a + (b - a) * k

/** A cor do carvão pelo calor (0–1): o apagado, o vermelho-escuro, o vermelho, o laranja, o amarelo, o miolo. */
function corDoCalor(c: number): number {
  return c > 0.84 ? P_FOGO * 4 + 2 : c > 0.68 ? P_FOGO * 4 + 1 : c > 0.52 ? P_BRASA * 4 + 3 : c > 0.36 ? P_BRASA * 4 + 2 : c > 0.2 ? P_BRASA * 4 + 1 : P_CARVAO * 4 + 2
}
