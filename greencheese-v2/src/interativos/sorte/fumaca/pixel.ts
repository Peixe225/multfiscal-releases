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
import { CABECA, FRENTE, FUNDO, misturar, NB, PASSO_BOLHA, px32, type Anel, type EstadoBeckPx, type EstadoIsqueiro, type Olho, type Paleta, type Quadro } from './quadro'

const T = 0.25
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)
const bayer = (i: number, j: number) => BAYER4[((j & 3) << 2) | (i & 3)]
/** A luz vem de cima à esquerda. */
const LX = -0.6
const LY = -0.8

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
const NPARTES = 26

/** Cores fixas (tons 1, 2, 3) e o contorno de cada parte. */
const FIXAS: Partial<Record<number, [string, string, string, string]>> = {
  [P_PITEIRA]: ['#2a170c', '#a8875a', '#d9c39a', '#efe2c4'],
  [P_PAPEL]: ['#2a170c', '#b8956a', '#e3cfa8', '#f6ead2'],
  [P_TOSTADO]: ['#2a170c', '#4a2a14', '#7a4a22', '#9a6a3a'],
  [P_CINZA]: ['#3a3532', '#6f6a66', '#a9a39d', '#d9d4ce'],
  [P_RACHA]: ['#3a3532', '#4d4743', '#4d4743', '#4d4743'],
  [P_TORCIDA]: ['#2a170c', '#b8956a', '#e3cfa8', '#f6ead2'],
  [P_BOCA_PIT]: ['#2a170c', '#a8875a', '#c9b088', '#d9c39a'],
  [P_M]: ['#2a170c', '#2a170c', '#2a170c', '#2a170c'],
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

interface PaletaIso {
  /** 5 faixas × (sombra, meio, luz) e o contorno; a de trás um pouco mais escura. */
  frente: Uint32Array
  fundo: Uint32Array
  contorno: number
  contornoFundo: number
}

export interface Desenho {
  readonly tipo: 'pixel'
  medir(W: number, H: number, pix: number): void
  /** `subir` falso: só calcula no ImageData (o aquecimento do motor, no giro). */
  pintar(q: Quadro, subir?: boolean): void
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
  private fg: Float32Array[] = [new Float32Array(1), new Float32Array(1), new Float32Array(1)]
  private temCamada = [false, false, false]
  private ruido = new Float32Array(1)
  // recorte por pedaços (8×8 nós) da lista de bolhas
  private pedX = 1
  private pedY = 1
  private pedN = new Int32Array(1)
  private pedL = new Int16Array(1)
  private bIa = new Float32Array(NB)
  private bIc = new Float32Array(NB)
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
  // cores
  private corParte = new Uint32Array(NPARTES * 4)
  private iso: PaletaIso | null = null
  private cinzaFrente: Paleta = { contorno: px32('#1b2228'), sombra: px32('#9aa6ae'), meio: px32('#d3dbe0'), luz: px32('#eef2f4') }
  private cinzaFundo: Paleta = { contorno: px32('#141a1f'), sombra: px32('#6c7780'), meio: px32('#9aa6ae'), luz: px32('#c4cdd4') }

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
    this.fg = [new Float32Array(cols * lins), new Float32Array(cols * lins), new Float32Array(cols * lins)]
    this.pedX = Math.ceil(this.gx / 8)
    this.pedY = Math.ceil(this.gy / 8)
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
    // o ruído que quebra a linha do terminador (blocos de ~4 células, interpolado): estável no quadro
    const r = new Float32Array(cols * lins)
    const g = 4
    for (let j = 0; j < lins; j++)
      for (let i = 0; i < cols; i++) {
        const a = i / g
        const b = j / g
        const a0 = Math.floor(a)
        const b0 = Math.floor(b)
        const fa = a - a0
        const fb = b - b0
        const v00 = hash3(a0, b0, 11)
        const v10 = hash3(a0 + 1, b0, 11)
        const v01 = hash3(a0, b0 + 1, 11)
        const v11 = hash3(a0 + 1, b0 + 1, 11)
        r[j * cols + i] = (v00 * (1 - fa) + v10 * fa) * (1 - fb) + (v01 * (1 - fa) + v11 * fa) * fb
      }
    this.ruido = r
  }

  definirIso(cores: readonly string[] | null, contorno: string) {
    if (!cores) {
      this.iso = null
      return
    }
    const frente = new Uint32Array(cores.length * 4)
    const fundo = new Uint32Array(cores.length * 4)
    cores.forEach((c, k) => {
      const tons = [misturar(c, '#000000', 0.38), c, misturar(c, '#ffffff', 0.35)]
      tons.forEach((x, t) => {
        frente[k * 4 + t + 1] = px32(x)
        fundo[k * 4 + t + 1] = px32(misturar(x, '#000000', 0.3))
      })
    })
    this.iso = { frente, fundo, contorno: px32(contorno), contornoFundo: px32(misturar(contorno, '#000000', 0.3)) }
  }

  campoFrente(i: number, j: number): number {
    if (i < 0 || j < 0 || i >= this.cols || j >= this.lins || !this.temCamada[FRENTE]) return 0
    return this.fg[FRENTE][j * this.cols + i]
  }

  limpar() {
    this.buf.fill(0)
    this.ctx.putImageData(this.img, 0, 0)
  }

  destruir() {
    /* nada guardado fora do canvas */
  }

  pintar(q: Quadro, subir = true) {
    const buf = this.buf
    buf.fill(0)
    this.corDinamica(q)
    if (q.tunel[0] > 0.001) this.tunel(q)
    if (q.estrelas > 0.001) this.estrelasDoFundo(q)
    this.campo(q)
    if (this.temCamada[FUNDO]) this.camada(FUNDO, q)
    for (let k = 0; k < q.nAneis; k++) if (q.aneis[k].atras) this.anel(q.aneis[k])
    if (q.brilhoBrasa[3] > 0.01) this.brilho(q.brilhoBrasa)
    this.beck(q.beck, q.ferve)
    this.isqueiro(q.isqueiro, q.ferve)
    if (q.estalo[2] > 0.01) this.estalo(q.estalo)
    for (let k = 0; k < q.nFitas; k++) this.fita(q, k)
    if (this.temCamada[FRENTE]) this.camada(FRENTE, q)
    if (this.temCamada[CABECA]) this.camada(CABECA, q)
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
    if (q.clarao > 0.001) this.clarao(q.clarao)
    if (subir) this.ctx.putImageData(this.img, 0, 0)
  }

  /* ───────────── cores que mudam no quadro (a brasa, a chama, as argolas, a cabeça) ───────────── */

  private corDinamica(q: Quadro) {
    const c = this.corParte
    const luz = q.beck.luz
    const m = (a: string, b: string, k: number) => px32(misturar(a, b, Math.max(0, Math.min(1, k))))
    // brasa: do vermelho-escuro (encostada) ao miolo amarelo-claro (puxando)
    c[P_BRASA * 4] = px32('#2a170c')
    c[P_BRASA * 4 + 1] = m('#6a1404', '#ff5418', luz)
    c[P_BRASA * 4 + 2] = m('#b4300e', '#ffb534', luz)
    c[P_BRASA * 4 + 3] = m('#e8561c', '#fff4c0', luz)
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

  /** O túnel do lendário: faixas que correm pro fundo em 6 gomos espelhados (caleidoscópio), puxadas pro ouro. */
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
    // as cores: ouro 50%, creme 20%, rosa/ciano/violeta em faixas finas (≤ 30%), e o contorno escuro
    const niveis = 4
    const escQ = Math.round(esc * 50) / 50
    if (!this.corTunel || this.corTunel.esc !== escQ) {
      const base = ['#ffc53d', '#fff1b8', '#ff5fb0', '#35d4ff', '#9466ff']
      const t2 = new Uint32Array(base.length * niveis)
      base.forEach((c, k) => {
        for (let n = 0; n < niveis; n++) t2[k * niveis + n] = px32(misturar(c, '#1a0b2e', (1 - (n + 1) / niveis) * 0.42 + (1 - escQ) * 0.5))
      })
      this.corTunel = { esc: escQ, tab: t2 }
    }
    const tab = this.corTunel.tab
    const tinta = px32('#1a0b2e')
    const seg = (Math.PI * 2) / 6
    const P = (this.polar = this.polarDe(this.polar, cx, cy))
    for (let j = 0; j < lins; j++) {
      for (let i = 0; i < cols; i++) {
        const idx = j * cols + i
        const r = P.r[idx]
        const by = bayer(i, j)
        if (r > alcance - (1 - by) * 0.12 * u) continue
        let an = P.a[idx] + giro
        an = an - seg * Math.floor(an / seg)
        const af = Math.abs(an - seg * 0.5)
        const z = (0.32 * u) / Math.max(r, 0.015 * u)
        const s = z + af * 0.55 - fase
        const fl = Math.floor(s)
        const fr = s - fl
        // a profundidade: mais escuro no fundo do túnel (4 degraus com dither)
        const prof = Math.min(1, r / (0.6 * u))
        const nv = Math.min(niveis - 1, Math.floor(prof * niveis + (by - 0.5) * 0.9))
        let c: number
        if (fr < 0.07) c = tinta
        else if (fr < 0.57) c = tab[0 * niveis + Math.max(0, nv)]
        else if (fr < 0.77) c = tab[1 * niveis + Math.max(0, nv)]
        else if (fr < 0.8) c = tinta
        else c = tab[(2 + (((fl % 3) + 3) % 3)) * niveis + Math.max(0, nv)]
        buf[idx] = c
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

  /** 12 estrelas de 4 pontas (2–3 células) cintilando no fundo do túnel. */
  private estrelasDoFundo(q: Quadro) {
    const { cols, lins } = this
    const cor = px32('#fffbe6')
    const cor2 = px32('#fff1b8')
    for (let k = 0; k < 12; k++) {
      const i = Math.floor(hash3(k, 1, 5) * cols)
      const j = Math.floor(hash3(k, 2, 5) * lins)
      const fase = (q.t * (1.3 + hash3(k, 3, 5)) + hash3(k, 4, 5) * 6) % 3
      const tam = fase < 1 ? 1 : fase < 1.5 ? 2 : fase < 2 ? 3 : fase < 2.5 ? 2 : 0
      if (!tam || hash3(k, 6, 5) > q.estrelas) continue
      this.ponto(i, j, cor)
      for (let a = 1; a <= tam; a++) {
        const c = a === tam ? cor2 : cor
        this.ponto(i + a, j, c)
        this.ponto(i - a, j, c)
        this.ponto(i, j + a, c)
        this.ponto(i, j - a, c)
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
    void pix
    for (let j = 0; j < lins; j++) {
      for (let i = 0; i < cols; i++) {
        const r = P.r[j * cols + i]
        if (r < r0 || r > r1) continue
        let st = (P.a[j * cols + i] / (Math.PI * 2)) * n + giro
        st -= Math.floor(st)
        const d = Math.abs(st - 0.5)
        if (d > 0.2) continue
        const fade = (1 - (r - r0) / (r1 - r0)) * forca
        const by = bayer(i, j)
        if (d < 0.06 && by < fade * 0.75) buf[j * cols + i] = miolo
        else if (by < fade * 0.42) buf[j * cols + i] = cor
      }
    }
  }

  /* ───────────── a fumaça ───────────── */

  /** Soma o campo das bolhas na grade grossa (com o ondulado e a fervura) e interpola nas células. */
  private campo(q: Quadro) {
    const B = q.blobs
    const n = Math.min(NB, q.nBlobs)
    this.temCamada[0] = this.temCamada[1] = this.temCamada[2] = false
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
      const ra = r * (1 + kk) * 1.65
      const rc = r * (1 - 0.35 * kk) * 1.65
      this.bIa[k] = 1 / (ra * ra)
      this.bIc[k] = 1 / (rc * rc)
      const R = Math.max(ra, rc) + folga
      const x = B[o]
      const y = B[o + 1]
      const a0 = Math.max(0, Math.floor((x - R) / G / 8))
      const a1 = Math.min(PX - 1, Math.floor((x + R) / G / 8))
      const b0 = Math.max(0, Math.floor((y - R) / G / 8))
      const b1 = Math.min(PY - 1, Math.floor((y + R) / G / 8))
      for (let b = b0; b <= b1; b++)
        for (let a = a0; a <= a1; a++) {
          const p = b * PX + a
          if (pedN[p] < NB) pedL[p * NB + pedN[p]++] = k
        }
      this.temCamada[B[o + 7] | 0] = true
      alguma = true
    }
    if (!alguma) return
    const cF = this.cg[FUNDO]
    const cR = this.cg[FRENTE]
    const cH = this.cg[CABECA]
    cF.fill(0)
    cR.fill(0)
    cH.fill(0)
    const A = q.ondulado
    const fv = q.fervura
    const t = q.t
    const seed = q.ferve
    const [hx, hy, hrx, hry, hf] = q.buraco
    const ihx = hrx > 0 ? 1 / hrx : 0
    const ihy = hry > 0 ? 1 / hry : 0
    const bIa = this.bIa
    const bIc = this.bIc
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
    for (let pb = 0; pb < PY; pb++)
      for (let pa = 0; pa < PX; pa++) {
        const p = pb * PX + pa
        const cnt = pedN[p]
        const temBuraco = hf > 0
        if (!cnt && !temBuraco) continue
        const lista = p * NB
        const ya0 = pb * 8
        const xa0 = pa * 8
        for (let b = ya0; b < Math.min(gy, ya0 + 8); b++) {
          const py0 = b * G + pix * 0.5
          for (let a = xa0; a < Math.min(gx, xa0 + 8); a++) {
            const px0 = a * G + pix * 0.5
            // o ondulado (baixa frequência, andando) e a fervura (troca a 12 qps)
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
            for (let m = 0; m < cnt; m++) {
              const k = pedL[lista + m]
              const o = k * PASSO_BOLHA
              const dx = sx - B[o]
              const dy = sy - B[o + 1]
              const dxx = B[o + 5]
              const dyy = B[o + 6]
              const al = dx * dxx + dy * dyy
              const ac = dy * dxx - dx * dyy
              const q2 = al * al * bIa[k] + ac * ac * bIc[k]
              if (q2 >= 1) continue
              const v1 = 1 - q2
              const v = v1 * v1 * v1 * B[o + 3]
              const cam = B[o + 7]
              if (cam < 0.5) f0 += v
              else if (cam < 1.5) f1 += v
              else f2 += v
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
            cF[idx] = f0
            cR[idx] = f1
            cH[idx] = f2
          }
        }
      }
    // interpola nas células (nó (a, b) = centro da célula (2a, 2b))
    const cols = this.cols
    const lins = this.lins
    for (let c = 0; c < 3; c++) {
      if (!this.temCamada[c]) continue
      const cg = this.cg[c]
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

  /** Uma camada de fumaça: contorno por fora, faixas de luz e sombra pela silhueta, terminador quebrado, isolinhas. */
  private camada(c: number, q: Quadro) {
    const { cols, lins, pix, buf } = this
    const F = this.fg[c]
    const u = Math.min(this.W, this.H)
    const dl = (0.05 * u) / pix
    const ds = (0.07 * u) / pix
    // deslocamentos (em células) com 2 variantes pra costura em dither
    const lx0 = Math.round(LX * dl)
    const ly0 = Math.round(LY * dl)
    const lx1 = Math.round(LX * (dl + 1.2))
    const ly1 = Math.round(LY * (dl + 1.2))
    const sx0 = Math.round(-LX * ds)
    const sy0 = Math.round(-LY * ds)
    const sx1 = Math.round(-LX * (ds + 1.2))
    const sy1 = Math.round(-LY * (ds + 1.2))
    const fundo = c === FUNDO
    const pal = c === CABECA ? q.cabeca : fundo ? q.fundo : q.frente
    const cinza = c === CABECA ? 0 : q.cinza
    const pc = fundo ? this.cinzaFundo : this.cinzaFrente
    const iso = this.iso && c !== CABECA ? this.iso : null
    const isoK = iso ? q.iso : 0
    const isoTab = iso ? (fundo ? iso.fundo : iso.frente) : null
    const isoC = iso ? (fundo ? iso.contornoFundo : iso.contorno) : 0
    const nIso = isoTab ? isoTab.length >> 2 : 0
    const isoF = q.isoFase
    const frenteF = this.temCamada[FRENTE] ? this.fg[FRENTE] : null
    const ruido = this.ruido
    const ultI = cols - 1
    const ultJ = lins - 1
    for (let j = 0; j < lins; j++) {
      const row = j * cols
      for (let i = 0; i < cols; i++) {
        const idx = row + i
        const f = F[idx]
        if (f <= T) continue
        // o fundo embaixo da frente não aparece (nem o contorno dele)
        if (fundo && frenteF && frenteF[idx] > T) continue
        const by = bayer(i, j)
        const usaCinza = cinza > 0 && by < cinza
        const P = usaCinza ? pc : pal
        let isoB = -1
        if (isoK > 0 && !usaCinza && by < isoK) {
          const b = Math.floor(Math.log(f / T) * 2.3 - isoF)
          isoB = ((b % nIso) + nIso) % nIso
        }
        // contorno: vizinho de fora
        if ((i > 0 && F[idx - 1] <= T) || (i < ultI && F[idx + 1] <= T) || (j > 0 && F[idx - cols] <= T) || (j < ultJ && F[idx + cols] <= T)) {
          buf[idx] = isoB >= 0 ? isoC : P.contorno
          continue
        }
        const v = by < 0.5
        const li = clampI(i + (v ? lx0 : lx1), ultI)
        const lj = clampI(j + (v ? ly0 : ly1), ultJ)
        const si = clampI(i + (v ? sx0 : sx1), ultI)
        const sj = clampI(j + (v ? sy0 : sy1), ultJ)
        const claro = F[lj * cols + li] <= T
        const escuro = F[sj * cols + si] <= T
        let tom = claro && !escuro ? 3 : escuro && !claro ? 1 : 2
        if (tom === 1) {
          // o terminador (sombra → meio) vira linha em ~60% do comprimento: ganchos, não círculos
          const ni = clampI(i - 1, ultI)
          const nj = clampI(j - 1, ultJ)
          const nsi = clampI(ni + sx0, ultI)
          const nsj = clampI(nj + sy0, ultJ)
          if (F[nsj * cols + nsi] > T && ruido[idx] > 0.42) tom = 0
        }
        if (isoB >= 0) buf[idx] = tom === 0 ? isoC : isoTab![isoB * 4 + tom]
        else buf[idx] = tom === 0 ? P.contorno : tom === 1 ? P.sombra : tom === 2 ? P.meio : P.luz
      }
    }
  }

  /* ───────────── sprites: máscara (parte·4 + tom) → cor com contorno de 1 célula ───────────── */

  /** Compõe a máscara na caixa (células) e limpa: quem tem vizinho vazio vira contorno (cor 0 da parte). */
  private compor(i0: number, j0: number, i1: number, j1: number, auto = true) {
    const { cols, lins, buf, mask } = this
    i0 = Math.max(0, i0)
    j0 = Math.max(0, j0)
    i1 = Math.min(cols - 1, i1)
    j1 = Math.min(lins - 1, j1)
    const cor = this.corParte
    for (let j = j0; j <= j1; j++) {
      const row = j * cols
      for (let i = i0; i <= i1; i++) {
        const idx = row + i
        const m = mask[idx]
        if (!m) continue
        const parte = m >> 2
        let tom = m & 3
        if (auto && tom && ((i > 0 && !mask[idx - 1]) || (i < cols - 1 && !mask[idx + 1]) || (j > 0 && !mask[idx - cols]) || (j < lins - 1 && !mask[idx + cols]))) tom = 0
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

  /** O beck: piteira, papel cônico, a torcida dobrada, a linha de queima com o tostado, a brasa e a cinza que pende. */
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
    const sb = b.linha * L
    const brasaW = acesa ? 1.6 * pix : 0
    const cinza = acesa ? b.cinza : 0
    const tostW = acesa ? 2 * pix : 0
    const rb = rAt(sb)
    const rCinza = rb * 0.88
    // a torcida: curta, dobrada pro lado de fora, crimpada
    const tL = TORCIDA_L * L * b.torcida
    const phi = TORCIDA_ANG
    const bx = ax * Math.cos(phi) + nx * Math.sin(phi)
    const byv = ay * Math.cos(phi) + ny * Math.sin(phi)
    const bnx = -byv
    const bny = bx
    const tx0 = b.x0 + ax * L * b.sx
    const ty0 = b.y0 + ay * L * b.sx
    const sFim = Math.max(sb + cinza, tL > 0 ? L : 0)
    const ex = b.x0 + ax * sFim * b.sx
    const ey = b.y0 + ay * sFim * b.sx
    const folga = r1 * Math.max(b.sx, b.sy) + Math.abs(b.pende) + tL + 3 * pix
    const [i0, j0, i1, j1] = this.caixa(b.x0 - ax * pix * 2, b.y0 - ay * pix * 2, ex, ey, folga)
    const ci0 = Math.max(0, i0)
    const cj0 = Math.max(0, j0)
    const ci1 = Math.min(cols - 1, i1)
    const cj1 = Math.min(lins - 1, j1)
    const corte = b.corte
    const isx = 1 / b.sx
    const isy = 1 / b.sy
    const faceMax = rPit * 0.3
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
        // a linha que ferve: o raio treme ±0,55 célula a cada 2 células do comprimento, a 12 qps
        const jit = (hash3(Math.floor(s / (2 * pix)), ferve, 7) - 0.5) * 1.1 * pix
        let code = 0
        if (s >= -0.5 * pix && s <= sb + brasaW + cinza) {
          if (s <= sPit) {
            const r = rPit + jit
            const av = Math.abs(v)
            if (av <= r) {
              const face = faceMax * Math.sqrt(Math.max(0, 1 - (v / rPit) * (v / rPit)))
              if (s < face) code = Math.abs(v) < rPit * 0.75 && ((Math.floor(((v / rPit + 1) * 2.6)) & 1) === 1) ? P_M * 4 + 1 : P_BOCA_PIT * 4 + tomDe(v / r)
              else code = s > sPit - pix ? P_PITEIRA * 4 + 1 : P_PITEIRA * 4 + tomDe(v / r)
            }
          } else if (s <= sb) {
            const r = rAt(s) + jit
            if (Math.abs(v) <= r) {
              if (acesa && s > sb - tostW) code = P_TOSTADO * 4 + (s > sb - pix ? 1 : 2)
              else {
                code = P_PAPEL * 4 + tomDe(v / r)
                // a costura da seda (a beirada colada), tracejada, e uma fibra aqui e ali
                const kv = v / r
                if (kv > 0.08 && kv < 0.08 + pix / r && Math.floor(s / (3 * pix)) % 3 !== 0) code = P_PAPEL * 4 + 1
                else if (hash3(Math.floor(s / pix), Math.floor(v / pix) + 99, 5) < 0.025) code = P_PAPEL * 4 + (kv < -0.36 ? 2 : 1)
              }
            }
          } else if (s <= sb + brasaW) {
            const r = rb * 0.97 + jit
            if (Math.abs(v) <= r) code = P_BRASA * 4 + tomBrasa(v / r)
          } else {
            // a cinza: um cilindro um pouco mais fino, que pende pro lado da gravidade e tem a ponta arredondada
            const k = (s - sb) / Math.max(1, cinza)
            const vc = b.pende * k * k + (b.racha > 0 ? b.racha * pix * 0.6 : 0)
            let r = rCinza
            const fimR = sb + brasaW + cinza - rCinza * 0.55
            if (s > fimR) {
              const e = (s - fimR) / (rCinza * 0.55)
              r *= Math.sqrt(Math.max(0, 1 - e * e))
            }
            r += jit * 0.6
            const vv = v - vc
            if (Math.abs(vv) <= r) {
              const dS = s - sb - brasaW
              const rachaAqui = b.racha > 0 && dS < pix
              if (rachaAqui) code = P_RACHA * 4 + 1
              else if (dS % (5 * pix) < pix * 0.9 && dS > 2 * pix && Math.abs(vv) < r * 0.8 && hash3(Math.floor(dS / (5 * pix)), 3, 0) > 0.25) code = P_RACHA * 4 + 1
              else if (dS < pix * 1.2 && hash3(i, j, ferve) < 0.25 + 0.5 * b.luz) code = P_BRASA * 4 + 3
              else code = P_CINZA * 4 + tomDe(vv / r)
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
    this.compor(ci0, cj0, ci1, cj1)
  }

  /** O brilho pontilhado da brasa em volta dela na puxada (atrás do beck). */
  private brilho(g: Float32Array) {
    const { cols, lins, pix, buf } = this
    const [x, y, R, forca] = g
    const [i0, j0, i1, j1] = this.caixa(x, y, x, y, R)
    const c1 = px32('#ff5418')
    const c2 = px32('#ffb534')
    for (let j = Math.max(0, j0); j <= Math.min(lins - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(cols - 1, i1); i++) {
        const dx = (i + 0.5) * pix - x
        const dy = (j + 0.5) * pix - y
        const r = Math.sqrt(dx * dx + dy * dy) / R
        if (r >= 1) continue
        const v = Math.pow(1 - r, 1.6) * forca
        const by = bayer(i, j)
        if (by < v * 0.55) buf[j * cols + i] = by < v * 0.25 ? c2 : c1
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

  /** Um fiapo: fita fina que sai da brasa, ondula, afina e quebra em caracóis no alto. */
  private fita(q: Quadro, k: number) {
    const f = q.fitas[k]
    if (f.comp < 2) return
    const { cols, lins, pix, mask } = this
    const u = Math.min(this.W, this.H)
    const passo = pix * 0.5
    const n = Math.ceil(f.comp / passo)
    const A = 0.04 * u
    const onda = (Math.PI * 2) / (0.24 * u)
    let mi0 = cols
    let mj0 = lins
    let mi1 = 0
    let mj1 = 0
    const carimbo = (x: number, y: number, raio: number, code: number, sobre: boolean, lado: number) => {
      const ci = Math.floor(x / pix)
      const cj = Math.floor(y / pix)
      const R = Math.ceil(raio)
      for (let dj = -R; dj <= R; dj++)
        for (let di = -R; di <= R; di++) {
          if (di * di + dj * dj > raio * raio + 0.3) continue
          const i = ci + di
          const j = cj + dj
          if (i < 0 || j < 0 || i >= cols || j >= lins) continue
          const idx = j * cols + i
          if (!sobre && mask[idx]) continue
          mask[idx] = code === 0 ? P_FITA * 4 : P_FITA * 4 + (di * lado > 0 && raio > 0.9 ? 1 : 2)
          if (i < mi0) mi0 = i
          if (j < mj0) mj0 = j
          if (i > mi1) mi1 = i
          if (j > mj1) mj1 = j
        }
    }
    const pontos: number[] = []
    for (let s = 0; s <= n; s++) {
      const k2 = s / n
      const ds = k2 * f.comp
      const x = f.x + A * k2 * Math.sin(ds * onda - q.t * 5 + f.fase)
      const y = f.y - ds
      // afina de 2 células pra 1; solta: a base some primeiro
      let w = f.larg * (1 - 0.55 * k2)
      if (f.solta > 0) w *= Math.min(1, Math.max(0, (k2 - f.solta * 0.7) / 0.18))
      if (w < 0.35) continue
      pontos.push(x, y, w)
    }
    // os caracóis no alto (2 voltinhas de 3–5 células)
    if (pontos.length >= 3) {
      const tx = pontos[pontos.length - 3]
      const ty = pontos[pontos.length - 2]
      for (let c = 0; c < 2; c++) {
        const lado = (c ? -1 : 1) * f.lado
        const R0 = pix * (2.4 - c * 0.6)
        const ox = tx + lado * R0 * 0.9
        const oy = ty - pix * (1 + c * 2.2)
        for (let a = 0; a < 1.35 * Math.PI * 2; a += 0.35) {
          const rr = R0 * (1 - a / (1.5 * Math.PI * 2))
          pontos.push(ox - lado * Math.cos(a) * rr, oy - Math.sin(a) * rr, 0.5)
        }
      }
    }
    for (let p = 0; p < pontos.length; p += 3) carimbo(pontos[p], pontos[p + 1], pontos[p + 2] + 1, 0, false, f.lado)
    for (let p = 0; p < pontos.length; p += 3) carimbo(pontos[p], pontos[p + 1], pontos[p + 2], 1, true, f.lado)
    if (mi1 >= mi0) this.compor(mi0, mj0, mi1, mj1, false)
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
    const [x, y, rx, ry, abre, pupila, aro, vis] = q.iris
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
        // pálpebras de fumaça: a fresta aberta é |dy| ≤ ry·abre·√(1 − ex²)
        const fresta = ry * abre * Math.sqrt(Math.max(0, 1 - ex * ex))
        if (Math.abs(dy) > fresta) {
          code = P_PALPEBRA * 4 + (dy < 0 ? (ey < -0.55 ? 3 : 2) : 1)
          if (Math.abs(Math.abs(dy) - fresta) < pix * 0.9) code = P_CONTORNO * 4 + 1
        } else if (r <= pupila) code = r > pupila - pix || (dx + pupila * 0.35) ** 2 + (dy + pupila * 0.35) ** 2 > (pupila * 0.22) ** 2 ? P_PUPILA * 4 + 2 : P_BRILHO * 4 + 2
        else if (r <= ri) code = P_IRIS * 4 + (r > ri - pix ? 1 : dx * LX + dy * LY > r * 0.4 ? 3 : 2)
        else code = P_BRANCO * 4 + (dy > ry * 0.35 ? 1 : 2)
        mask[j * cols + i] = code
      }
    this.compor(ci0, cj0, ci1, cj1)
  }

  /** O sorriso preguiçoso e o olho que pisca do comum: só a linha de contorno, desenhada em cima da fumaça. */
  private sorriso(q: Quadro) {
    const [x, y, w, abre, pisca] = q.sorriso
    const { pix } = this
    const cor = q.frente.contorno
    const ci = x / pix
    const cj = y / pix
    const W = (w / pix) * abre
    const curva = 0.12 * (w / pix)
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
                  const n = isoCores.frente.length >> 2
                  this.buf[j * cols + i] = isoCores.frente[((((b >> 1) % n) + n) % n) * 4 + 2]
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
          const ro = 0.36 * (1 + 0.5 * sopro)
          const e = (qx / ro) ** 2 + (qy / (ro * 1.15)) ** 2
          if (e <= 1) code = e > 0.55 ? P_BOCA * 4 + 3 : P_BOCA * 4 + 1
        } else {
          const ab = sorri
          const topo = -0.1 * ab + 0.38 * qx * qx * ab
          const base = 0.72 * ab * Math.sqrt(Math.max(0, 1 - qx * qx))
          if (Math.abs(qx) <= 1 && qy >= topo && qy <= base) {
            code = P_BOCA * 4 + 2
            if (qy < topo + 0.2 * ab) code = P_DENTE * 4 + 2
            else if (qy > base * 0.55 + 0.08 && Math.abs(qx) < 0.55) code = P_LINGUA * 4 + 2
          }
        }
        if (code) mask[j * cols + i] = code
      }
    this.compor(ci0, cj0, ci1, cj1)
  }

  private clarao(k: number) {
    const { cols, lins, buf } = this
    const c = px32('#fffbe6')
    for (let j = 0; j < lins; j++) for (let i = 0; i < cols; i++) if (bayer(i, j) < k) buf[j * cols + i] = c
  }
}

function clampI(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v
}

/** O tom pelo lado do cilindro (v/r: −1 do lado da luz, +1 do lado da sombra). */
function tomDe(k: number): number {
  return k < -0.36 ? 3 : k > 0.44 ? 1 : 2
}

/** A brasa: o miolo claro no meio, a borda mais escura. */
function tomBrasa(k: number): number {
  const a = Math.abs(k)
  return a < 0.45 ? 3 : a < 0.78 ? 2 : 1
}
