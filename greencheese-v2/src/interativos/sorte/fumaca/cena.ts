// A cena da fumaça como função do tempo: dado t (s) e a geometria do palco, devolve tudo o que o desenho precisa
// (as nuvens, a paleta, o buraco do prêmio, o túnel, os olhos e a boca, a brasa, a chama...), o estado do beck e o do
// prêmio. Sem estado escondido além das trilhas sorteadas na montagem (semente fixa): dá pra pular pra qualquer
// quadro (o toque que pula, o 0,25× do laboratório, o quadro parado do movimento reduzido) e sai sempre igual.
// Unidade: u = o lado menor do palco; origem no centro, y pra baixo (como o CSS).
import { INFO_RARIDADE, type Raridade } from '../../../lib/raridade'
import { PONTA_TORCIDA, pontoDaBrasa, type EstadoBeck } from './Beck'
import type { PoseBeck } from './pose'
import { ROTEIROS, SUBIDA, type Roteiro } from './roteiro'

/** Bolhas de fumaça (metaballs): 6 fiapos da brasa, 2 do pop, o resto do sopro. */
export const NB = 40
const FIAPOS = 6
const POP0 = 6
const SOPRO0 = 8
/** Argolas (raro) e formas flutuando (lendário). */
export const NA = 4
export const NF = 8

export interface Geo {
  /** Palco em px de CSS. */
  W: number
  H: number
  /** O lado menor (a unidade da cena). */
  u: number
  pose: PoseBeck
  /** O cartão do prêmio (centro e tamanho, px de CSS, sem escala) e o centro/tamanho do desenho do produto nele. */
  premio: { x: number; y: number; w: number; h: number; vx: number; vy: number; vw: number; vh: number }
}

/** O quadro que os dois desenhos (WebGL e canvas 2D) pintam. Posições em u, relativas ao centro. */
export interface Quadro {
  blobs: Float32Array // NB × (x, y, r, w); w < 0 = camada de trás
  nBlobs: number
  aneis: Float32Array // NA × (x, y, R, espessura)
  cores: Float32Array // 4 × rgb: contorno, sombra, meio, luz
  coresFundo: Float32Array
  /** Os fiapos da brasa: cinza-claro em toda raridade (fumaça "de verdade" antes da viagem). */
  coresFiapo: Float32Array
  psi: Float32Array // mistura, fase, espalhamento, -
  buraco: Float32Array // x, y, rx, ry
  giro: Float32Array // x, y, torção, ondulado
  tunel: Float32Array // mistura, fase, gomos, torção
  caleido: number
  onda: Float32Array // x, y, amplitude, fase
  halo: Float32Array // x, y, r, força
  haloCor: Float32Array
  /** O fundo escuro atrás do prêmio (x, y, rx, ry) e a força. */
  placa: Float32Array
  placaForca: number
  raios: Float32Array // força, quantos, giro, raio
  raiosCor: Float32Array
  olhos: Float32Array // abertura, piscada, olharX, olharY
  olhosP: Float32Array // x, y, tamanho, distância
  boca: Float32Array // x, y, largura, abertura
  bico: number
  formas: Float32Array // NF × (x, y, tamanho, giro)
  formasK: Float32Array // NF × (tipo, cor, alfa, -)
  brasa: Float32Array // x, y, r, força
  chama: Float32Array // x, y, tamanho, ligada
  chamaAng: number
  chamaDourada: number
  flash: number
  boil: number
  t: number
  /** Densidade geral (o raio de todas as bolhas). */
  dens: number
}

/** O que o motor aplica no DOM. */
export interface EstadoDom {
  beck: EstadoBeck
  /** Transform do beck: centro (px), giro (graus), escala, opacidade. */
  beckX: number
  beckY: number
  beckAng: number
  beckEsc: number
  beckAlfa: number
  /** O palco inteiro: zoom que respira e tremida (px). */
  palcoEsc: number
  palcoX: number
  palcoY: number
  /** O cartão do prêmio: deslocamento do centro (px), escala, opacidade, giro. */
  cartaoX: number
  cartaoY: number
  cartaoEsc: number
  cartaoAlfa: number
  cartaoAng: number
  /** O carimbo da raridade. */
  carimboEsc: number
  carimboAlfa: number
  /** 0–1 o brilho holográfico passando no carimbo (lendário). */
  carimboHolo: number
  /** O prêmio já apareceu (o anúncio do leitor de tela). */
  premioVisivel: boolean
}

/* ───────────── utilidades ───────────── */

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const sm = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const saiCubica = (s: number) => 1 - Math.pow(1 - s, 3)
const saiQuad = (s: number) => 1 - (1 - s) * (1 - s)
const passa = (s: number, k = 1.7) => 1 + (k + 1) * Math.pow(s - 1, 3) + k * Math.pow(s - 1, 2)

function semente(n: number) {
  let s = n >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function pôrCores(dest: Float32Array, cores: readonly string[]) {
  cores.forEach((c, i) => dest.set(hexRgb(c), i * 3))
}

/* ───────────── trilhas (sorteadas uma vez por montagem/tamanho) ───────────── */

interface Nuvem {
  t0: number
  dur: number
  x0: number
  y0: number
  x1: number
  y1: number
  r0: number
  r1: number
  curl: number
  fase: number
  fundo: boolean
}

interface Forma {
  t0: number
  ang: number
  tipo: number
  cor: number
  giro: number
}

/** Integral numérica de uma velocidade (fase que desacelera na câmera lenta). Tabela a 240 Hz. */
class Integral {
  private tab: Float32Array
  private passo = 1 / 240
  constructor(
    private vel: (t: number) => number,
    private fim: number,
  ) {
    const n = Math.ceil(fim / this.passo) + 2
    this.tab = new Float32Array(n)
    let acc = 0
    for (let i = 1; i < n; i++) {
      acc += vel((i - 0.5) * this.passo) * this.passo
      this.tab[i] = acc
    }
  }
  em(t: number): number {
    if (t <= 0) return 0
    const i = t / this.passo
    const n = this.tab.length - 1
    if (i >= n) return this.tab[n] + (t - n * this.passo) * this.vel(this.fim + 1)
    const a = Math.floor(i)
    return lerp(this.tab[a], this.tab[a + 1], i - a)
  }
}

/* ───────────── a cena ───────────── */

export class Cena {
  readonly q: Quadro
  readonly dom: EstadoDom
  readonly rot: Roteiro
  /** Deslocamento do roteiro (a subida do modo 'previa'). */
  readonly t0: number
  readonly fim: number
  private geo!: Geo
  private nuvens: Nuvem[] = []
  private formas: Forma[] = []
  private orbita!: Integral
  private faseTunel!: Integral
  private relogioFormas!: Integral
  /** Por onde a fumaça sopra o prêmio (épico: a boca). */
  private hx = 0.5
  private hy = 1

  constructor(
    readonly raridade: Raridade,
    readonly previa: boolean,
  ) {
    this.rot = ROTEIROS[raridade]
    this.t0 = previa ? SUBIDA : 0
    this.fim = this.rot.pronto + this.t0
    this.q = {
      blobs: new Float32Array(NB * 4),
      nBlobs: NB,
      aneis: new Float32Array(NA * 4),
      cores: new Float32Array(12),
      coresFundo: new Float32Array(12),
      coresFiapo: new Float32Array(12),
      psi: new Float32Array(4),
      buraco: new Float32Array(4),
      giro: new Float32Array(4),
      tunel: new Float32Array(4),
      caleido: 0,
      onda: new Float32Array(4),
      halo: new Float32Array(4),
      haloCor: new Float32Array(3),
      placa: new Float32Array(4),
      placaForca: 0,
      raios: new Float32Array(4),
      raiosCor: new Float32Array(3),
      olhos: new Float32Array(4),
      olhosP: new Float32Array(4),
      boca: new Float32Array(4),
      bico: 0,
      formas: new Float32Array(NF * 4),
      formasK: new Float32Array(NF * 4),
      brasa: new Float32Array(4),
      chama: new Float32Array(4),
      chamaAng: 0,
      chamaDourada: this.rot.chamaDourada ? 1 : 0,
      flash: 0,
      boil: 0,
      t: 0,
      dens: 1,
    }
    this.dom = {
      beck: { queima: 0, brasa: 0, luz: 0, torcida: 1, giro: 0, pende: 0 },
      beckX: 0,
      beckY: 0,
      beckAng: 0,
      beckEsc: 1,
      beckAlfa: 1,
      palcoEsc: 1,
      palcoX: 0,
      palcoY: 0,
      cartaoX: 0,
      cartaoY: 0,
      cartaoEsc: 0,
      cartaoAlfa: 0,
      cartaoAng: 0,
      carimboEsc: 0,
      carimboAlfa: 0,
      carimboHolo: 0,
      premioVisivel: false,
    }
    pôrCores(this.q.cores, this.rot.cores)
    pôrCores(this.q.coresFundo, this.rot.coresFundo)
    pôrCores(this.q.coresFiapo, ['#1b2228', '#9aa6ae', '#d3dbe0', '#f6f8f9'])
    const info = INFO_RARIDADE[raridade]
    this.q.haloCor.set(hexRgb(info.cor))
    this.q.raiosCor.set(hexRgb(raridade === 'lendario' ? '#ffd45c' : info.cor))
    const r = this.rot
    // a órbita lenta da fumaça depois de cheia; no lendário vira vórtice e desacelera na câmera lenta
    this.orbita = new Integral((t) => {
      if (r.tunel) {
        const tu = r.tunel
        if (t < tu.gira) return t > r.cheio ? 0.15 : 0
        if (t < tu.lento[0]) return lerp(0.15, 1.7, sm(tu.gira, tu.gira + 0.8, t))
        if (t < tu.lento[1]) return 0.32
        return lerp(0.32, 0.22, sm(tu.lento[1], tu.lento[1] + 0.6, t))
      }
      return t > r.cheio - 0.2 ? 0.13 : 0
    }, r.pronto + 1)
    this.faseTunel = new Integral((t) => {
      const tu = r.tunel
      if (!tu) return 0
      if (t < tu.lento[0]) return lerp(0.6, 2.6, sm(tu.abre, tu.abre + 0.8, t))
      if (t < tu.lento[1]) return 0.35
      return lerp(0.35, 0.8, sm(tu.lento[1], tu.lento[1] + 0.7, t))
    }, r.pronto + 1)
    this.relogioFormas = new Integral((t) => {
      const tu = r.tunel
      if (!tu) return 1
      if (t >= tu.lento[0] && t < tu.lento[1]) return 0.28
      return 1
    }, r.pronto + 1)
  }

  /** Recalcula as trilhas pro tamanho do palco (montagem e resize). */
  definirGeo(g: Geo) {
    this.geo = g
    const u = g.u
    this.hx = g.W / 2 / u
    this.hy = g.H / 2 / u
    const rnd = semente(1234 + this.rot.nuvens * 7 + Math.round(this.hx * 100) * 31 + Math.round(this.hy * 100))
    const r = this.rot
    // grade que cobre o quadro (célula ~0,38 u), com um respiro pra fora da borda
    const cel = 0.33
    const cols = Math.max(2, Math.ceil((2 * this.hx + 0.2) / cel))
    const lins = Math.max(2, Math.ceil((2 * this.hy + 0.2) / cel))
    const cw = (2 * this.hx + 0.2) / cols
    const ch = (2 * this.hy + 0.2) / lins
    const celulas: [number, number][] = []
    for (let j = 0; j < lins; j++) for (let i = 0; i < cols; i++) celulas.push([-this.hx - 0.1 + (i + 0.5) * cw, -this.hy - 0.1 + (j + 0.5) * ch])
    const n = Math.min(NB - SOPRO0, r.nuvens)
    // mais nuvens que células: repete as do meio (camadas); menos: escolhe espalhado
    let alvos: [number, number][]
    if (celulas.length >= n) {
      const passo = celulas.length / n
      alvos = Array.from({ length: n }, (_, k) => celulas[Math.min(celulas.length - 1, Math.floor(k * passo + rnd() * passo))])
    } else {
      alvos = [...celulas]
      while (alvos.length < n) alvos.push(celulas[Math.floor(rnd() * celulas.length)])
    }
    // as de baixo saem primeiro (a fumaça rola de baixo pra cima, de quem olha pra dentro da tela)
    alvos.sort((a, b) => b[1] - a[1])
    const raioCel = Math.max(cw, ch) * 0.7
    this.nuvens = alvos.map(([x, y], k) => {
      const onda = Math.min(r.ondas - 1, Math.floor((k / n) * r.ondas))
      const jx = (rnd() - 0.5) * cw * 0.5
      const jy = (rnd() - 0.5) * ch * 0.5
      const x1 = x + jx
      const y1 = y + jy
      const dist = Math.hypot(x1, y1 - this.hy)
      return {
        t0: r.sopro + onda * r.intervaloOndas + rnd() * 0.07,
        dur: 0.5 + Math.min(0.45, dist * 0.22) + rnd() * 0.1,
        x0: (rnd() - 0.5) * 0.5,
        y0: this.hy + 0.22 + rnd() * 0.1,
        x1,
        y1,
        r0: 0.05 + rnd() * 0.05,
        // tamanhos variados (nuvem grande com bolotas menores em volta): cara de fumaça, não de bolinhas iguais
        r1: raioCel * (k % 4 === 3 ? 0.55 + rnd() * 0.2 : 0.85 + rnd() * 0.45),
        curl: (rnd() < 0.5 ? -1 : 1) * (0.06 + rnd() * 0.14),
        fase: rnd() * 6.28,
        fundo: k % 3 === 1,
      }
    })
    // formas do lendário (estrela, olho, onda, triângulo, argola, losango)
    const fr = semente(77)
    this.formas = Array.from({ length: NF }, (_, k) => ({ t0: k * 0.21, ang: k * 2.39996 + fr() * 0.4, tipo: k % 6, cor: k % 4, giro: (fr() - 0.5) * 4 }))
  }

  /** O beck no tempo t (s desde a montagem): centro (px), inclinação (graus). Flutua de leve; na prévia, sobe antes. */
  poseEm(tReal: number): { x: number; y: number; ang: number } {
    const g = this.geo
    const P = g.pose
    const sobe = this.previa ? saiCubica(clamp01(tReal / SUBIDA)) : 1
    return {
      x: P.x + Math.sin(tReal * 0.9) * 2,
      y: lerp(g.H + P.h * 0.6, P.y, sobe) + Math.sin(tReal * 1.7) * 3,
      ang: P.ang + Math.sin(tReal * 1.3) * 2.5 + (1 - sobe) * -24,
    }
  }

  /** Quanto do papel queimou no tempo t (do roteiro, sem a subida). */
  queimaEm(t: number): number {
    let q = 0
    for (const p of this.rot.puxadas) q += p.queima * sm(0, 1, clamp01((t - p.de) / (p.ate - p.de)))
    return q
  }

  /** Onde fica um ponto do beck (viewBox 60×240) no palco, em px de CSS, com o beck na pose dada. */
  private noPalco(lx: number, ly: number, pose: { x: number; y: number; ang: number } = { x: this.dom.beckX, y: this.dom.beckY, ang: this.dom.beckAng }): [number, number] {
    const h = this.geo.pose.h
    const w = h * 0.25
    const x = (lx / 60 - 0.5) * w
    const y = (ly / 240 - 0.5) * h
    const a = (pose.ang * Math.PI) / 180
    const c = Math.cos(a)
    const s = Math.sin(a)
    return [pose.x + x * c - y * s, pose.y + x * s + y * c]
  }

  /** A brasa no tempo t (px de CSS), pras faíscas. */
  brasaEm(tReal: number): [number, number] {
    return this.noPalco(...pontoDaBrasa(this.queimaEm(tReal - this.t0)), this.poseEm(tReal))
  }

  /** A ponta da torcida no tempo t (px de CSS), pras faíscas do pop. */
  pontaEm(tReal: number): [number, number] {
    return this.noPalco(...PONTA_TORCIDA, this.poseEm(tReal))
  }

  private emU(x: number, y: number): [number, number] {
    const g = this.geo
    return [(x - g.W / 2) / g.u, (y - g.H / 2) / g.u]
  }

  /**
   * O quadro no tempo t (s desde a montagem). `dissipa` (0–1): no jogo, depois do auge, o story entra saindo da
   * fumaça, que vira o fundo e se desfaz (as nuvens encolhem e abrem pra fora, o prêmio e o brilho somem).
   */
  calcular(tReal: number, dissipa = 0): void {
    const g = this.geo
    const r = this.rot
    const q = this.q
    const d = this.dom
    const t = tReal - this.t0
    q.t = tReal
    q.boil = Math.floor(tReal * 12)
    const P = g.pose

    /* ── beck: sobe (prévia), flutua, acende, é fumado e some na fumaça ── */
    const pose = this.poseEm(tReal)
    d.beckX = pose.x
    d.beckY = pose.y
    d.beckAng = pose.ang
    d.beckEsc = 1
    // a torcida: chama em acende, pop em pop
    const popS = clamp01((t - r.pop) / 0.12)
    d.beck.torcida = t < r.pop ? 1 : 1 - popS
    d.beck.brasa = sm(r.pop, r.pop + 0.08, t)
    // queima e luz: cada puxada incandesce e come papel
    const queima = this.queimaEm(t)
    let luz = 0
    let respira = 0
    for (const p of r.puxadas) {
      const s = clamp01((t - p.de) / (p.ate - p.de))
      // a luz sobe rápido, segura e cai: pulsando (cintila a 12 qps por cima)
      const env = t < p.de || t > p.ate + 0.25 ? 0 : sm(p.de, p.de + 0.14, t) * (1 - sm(p.ate - 0.05, p.ate + 0.25, t))
      luz = Math.max(luz, env * p.forca)
      respira = Math.max(respira, Math.sin(Math.PI * s) * (s > 0 && s < 1 ? 1 : 0))
    }
    const cintila = 0.82 + 0.18 * Math.sin(q.boil * 2.7) * Math.sin(q.boil * 1.3 + 1)
    d.beck.queima = queima
    d.beck.luz = clamp01(luz * cintila + d.beck.brasa * 0.12)
    d.beck.giro = tReal * 0.5
    // a cinza pende pra baixo: com o beck inclinado pra direita, pro lado de fora (sinal do ângulo)
    d.beck.pende = Math.sin((d.beckAng * Math.PI) / 180) * 1.2
    // engolido pela fumaça: some por baixo dela (a conta de verdade vem depois das nuvens, abaixo); pelo tempo, no
    // máximo logo depois do quadro cheio e sempre antes de a fumaça (ou o túnel do lendário) abrir no meio
    const fimSome = Math.min(r.cheio + 0.3, r.abre - 0.05, r.tunel ? r.tunel.abre - 0.05 : Infinity)
    d.beckAlfa = 1 - sm(fimSome - 0.25, fimSome, t)
    d.palcoEsc = 1 + (r.respira - 1) * respira

    /* ── brasa e chama (no palco) ── */
    const [bx, by] = this.noPalco(...pontoDaBrasa(queima))
    const [bu, bv] = this.emU(bx, by)
    q.brasa[0] = bu
    q.brasa[1] = bv
    q.brasa[2] = (0.05 + 0.1 * d.beck.luz) * (P.h / g.u) * 1.4
    q.brasa[3] = d.beck.brasa * (0.35 + 0.65 * d.beck.luz) * d.beckAlfa
    const [cx, cy] = this.noPalco(...PONTA_TORCIDA)
    const [cu, cv] = this.emU(cx, cy)
    q.chama[0] = cu
    q.chama[1] = cv
    q.chama[2] = (P.h / g.u) * 0.2
    // a chama pula pra dentro em 2 quadros, treme e some logo depois do pop
    q.chama[3] = t < r.acende ? 0 : t < r.pop + 0.06 ? sm(r.acende, r.acende + 0.08, t) : 1 - sm(r.pop + 0.06, r.pop + 0.16, t)
    q.chamaAng = (d.beckAng * Math.PI) / 180

    /* ── fumaça ── */
    const B = q.blobs
    B.fill(0)
    // fiapos da brasa: nascem a cada 0,14 s nas puxadas (e um pouco depois), sobem enrolando
    let slot = 0
    if (d.beck.brasa > 0) {
      const ini = r.pop + 0.05
      const ultimaPux = r.puxadas[r.puxadas.length - 1].ate + 0.35
      const fimFiapo = Math.min(ultimaPux, r.cheio)
      for (let k = Math.max(0, Math.floor((t - ini - 0.8) / 0.14)); k <= Math.floor((t - ini) / 0.14); k++) {
        const nasce = ini + k * 0.14
        if (nasce > fimFiapo || nasce > t) continue
        const a = (t - nasce) / 0.8
        if (a < 0 || a > 1) continue
        // o fiapo nasce onde a brasa estava na hora (aproximação: a brasa de agora, com a subida já feita)
        const i = (slot++ % FIAPOS) * 4
        const lado = Math.sin(k * 1.9) * 0.5
        B[i] = bu + Math.sin(a * 5.2 + k) * 0.045 * a + a * 0.06 * lado
        B[i + 1] = bv - 0.04 - a * 0.42
        B[i + 2] = (0.016 + 0.05 * Math.pow(a, 0.7)) * (1 - 0.25 * a)
        B[i + 3] = (a < 0.8 ? 1 : (1 - a) / 0.2) * d.beckAlfa
        if (slot >= FIAPOS) break
      }
    }
    // o pop: duas bolinhas na ponta
    if (t >= r.pop && t < r.pop + 0.45) {
      const a = (t - r.pop) / 0.45
      for (let k = 0; k < 2; k++) {
        const i = (POP0 + k) * 4
        B[i] = cu + (k ? 0.035 : -0.03) * (1 + a)
        B[i + 1] = cv - 0.02 - a * 0.08
        B[i + 2] = 0.02 + 0.03 * saiQuad(a)
        B[i + 3] = 1 - sm(0.6, 1, a)
      }
    }
    // o sopro: as nuvens entram por baixo e enchem o quadro
    const ang = this.orbita.em(t)
    const prem = g.premio
    const pcx = (prem.x - g.W / 2) / g.u
    const pcy = (prem.y - g.H / 2) / g.u
    const bur = this.buraco(t)
    q.buraco[0] = pcx
    q.buraco[1] = pcy
    q.buraco[2] = bur.rx * bur.o
    q.buraco[3] = bur.ry * bur.o
    const respiraNuvem = 1 + 0.05 * Math.sin(tReal * 1.6)
    // o redemoinho do lendário: gira mais perto do meio (cada nuvem roda em volta do prêmio pela distância dela)
    const torce = r.tunel ? 1.6 * sm(r.tunel.gira, r.tunel.gira + 0.9, t) * (1 - 0.6 * sm(r.tunel.recua, r.tunel.recua + 0.8, t)) : 0
    for (let k = 0; k < this.nuvens.length; k++) {
      const n = this.nuvens[k]
      const i = (SOPRO0 + k) * 4
      const s = clamp01((t - n.t0) / n.dur)
      if (t < n.t0) continue
      const e = saiCubica(s)
      const px = -(n.y1 - n.y0)
      const py = n.x1 - n.x0
      const pl = Math.hypot(px, py) || 1
      let x = lerp(n.x0, n.x1, e) + (px / pl) * n.curl * Math.sin(Math.PI * e)
      let y = lerp(n.y0, n.y1, e) + (py / pl) * n.curl * Math.sin(Math.PI * e)
      let rr = lerp(n.r0, n.r1, saiQuad(s)) * (1 + 0.06 * Math.sin(tReal * 1.7 + n.fase)) * respiraNuvem
      // órbita (no espaço normalizado do quadro, pra não sair pelos cantos)
      if (ang) {
        const nx = (x - pcx) / this.hx
        const ny = (y - pcy) / this.hy
        const c = Math.cos(ang * (n.fundo ? 0.8 : 1))
        const sn = Math.sin(ang * (n.fundo ? 0.8 : 1))
        x = pcx + (nx * c - ny * sn) * this.hx
        y = pcy + (nx * sn + ny * c) * this.hy
      }
      if (torce) {
        const dx = x - pcx
        const dy = y - pcy
        const ang2 = torce * Math.exp(-Math.hypot(dx, dy) * 1.5)
        const c2 = Math.cos(ang2)
        const s2 = Math.sin(ang2)
        x = pcx + dx * c2 - dy * s2
        y = pcy + dx * s2 + dy * c2
      }
      // o buraco empurra as nuvens pra borda dele
      if (bur.o > 0) {
        const ex = (x - pcx) / bur.rx
        const ey = (y - pcy) / bur.ry
        const dn = Math.hypot(ex, ey)
        const alvo = 1 + (rr / Math.min(bur.rx, bur.ry)) * 0.55
        if (dn < alvo) {
          const dirx = dn > 1e-3 ? ex / dn : Math.cos(n.fase)
          const diry = dn > 1e-3 ? ey / dn : Math.sin(n.fase)
          const nd = lerp(dn, alvo, bur.o)
          x = pcx + dirx * nd * bur.rx
          y = pcy + diry * nd * bur.ry
        }
        rr *= 1 - 0.18 * bur.o
      }
      // dissipa no fim do jogo (o story entra): encolhe e abre pra fora
      if (dissipa > 0) {
        const k = 1 + dissipa * 0.6
        x = pcx + (x - pcx) * k
        y = pcy + (y - pcy) * k
        rr *= 1 - dissipa * (0.75 + 0.25 * Math.sin(n.fase))
      }
      B[i] = x
      B[i + 1] = y
      B[i + 2] = Math.max(0, rr)
      B[i + 3] = n.fundo ? -1 : 1
    }
    q.nBlobs = SOPRO0 + this.nuvens.length
    q.dens = 1
    // o beck só some quando a fumaça já cobre ele inteiro (na ponta, no meio e no pé): assim ele some por baixo dela,
    // sem escurecer no preto enquanto ainda aparece; se ela não cobrir (o vórtice do lendário), some pelo tempo
    if (t > r.sopro && d.beckAlfa > 0) {
      const pts = [[bu, bv], this.emU(...this.noPalco(30, 130)), this.emU(...this.noPalco(30, 226))]
      let menor = Infinity
      for (const [px, py] of pts) {
        let ff = 0
        let fb = 0
        for (let k = SOPRO0; k < q.nBlobs; k++) {
          const i = k * 4
          const rv = B[i + 2]
          if (rv <= 0) continue
          const dx = px - B[i]
          const dy = py - B[i + 1]
          const x = (dx * dx + dy * dy) / (rv * rv * 2.7225)
          if (x >= 1) continue
          const kk = (1 - x) * (1 - x) * (1 - x)
          if (B[i + 3] > 0) ff += kk * B[i + 3]
          else fb += kk
        }
        menor = Math.min(menor, Math.max(ff, fb))
      }
      d.beckAlfa = Math.min(d.beckAlfa, 1 - sm(0.3, 0.55, menor))
      q.brasa[3] = d.beck.brasa * (0.35 + 0.65 * d.beck.luz) * d.beckAlfa
    }
    // o "ondulado" das bordas: mais no épico e no lendário (as formas derretem)
    const derrete = r.psicodelia != null ? sm(r.psicodelia, r.psicodelia + 0.6, t) : 0
    q.giro[0] = pcx
    q.giro[1] = pcy
    q.giro[2] = torce
    q.giro[3] = 0.012 + 0.03 * derrete

    /* ── paleta ── */
    q.psi[0] = derrete
    q.psi[1] = tReal * 1.15
    // quanto a matiz muda de uma bolha pra vizinha; no rosto do épico a nuvem fica quase de uma cor só (o rosto lê),
    // e explode de novo quando a boca sopra
    const rosto = r.rosto ? sm(r.rosto.olhosAbrem - 0.3, r.rosto.olhosAbrem, t) * (1 - sm(r.rosto.sopra, r.rosto.sopra + 0.4, t)) : 0
    q.psi[2] = lerp(r.raridade === 'lendario' ? 0.9 : 0.62, 0.12, rosto)
    q.psi[3] = r.raridade === 'lendario' ? 1 : 0

    /* ── argolas (raro): saem do meio e voam pra fora, crescendo (vindo pra cima de quem olha) ── */
    q.aneis.fill(0)
    r.aneis?.forEach((ta, k) => {
      const s = (t - ta) / 0.75
      if (s < 0 || s > 1) return
      const dir = [
        [-0.75, -0.62],
        [0.8, -0.5],
        [-0.85, 0.35],
        [0.7, 0.55],
      ][k % 4]
      const e = saiQuad(s)
      const i = k * 4
      q.aneis[i] = pcx + dir[0] * e * (this.hx * 0.95)
      q.aneis[i + 1] = pcy - 0.08 + dir[1] * e * (this.hy * 0.85)
      q.aneis[i + 2] = 0.05 + 0.3 * e
      q.aneis[i + 3] = (0.018 + 0.032 * e) * (1 - sm(0.62, 0.95, s)) * sm(0, 0.06, s)
    })

    /* ── rosto (épico): olhos que abrem, olham, piscam; a boca sorri, faz bico e sopra ── */
    q.olhos.fill(0)
    q.boca.fill(0)
    q.bico = 0
    const ro = r.rosto
    if (ro) {
      const tam = 0.13
      q.olhosP[0] = pcx
      q.olhosP[1] = pcy - 0.2
      q.olhosP[2] = tam
      q.olhosP[3] = 0.19
      const some = 1 - sm(ro.some, ro.some + 0.3, t)
      // abertura com passada; semicerrado (cara de viagem) em 0,72
      const abre = t < ro.olhosAbrem ? 0 : passa(clamp01((t - ro.olhosAbrem) / 0.32), 1.2) * 0.72
      // piscada: fecha em 2 quadros, abre em 2 (12 qps)
      const pis = t > ro.pisca && t < ro.pisca + 0.24 ? Math.sin((Math.floor((t - ro.pisca) * 12) / 3) * Math.PI) : 0
      // somem fechando: a pálpebra desce (como piscar) e o olho sai
      const fecha = sm(ro.some, ro.some + 0.14, t)
      q.olhos[0] = t > ro.some + 0.16 ? 0 : abre
      q.olhos[1] = Math.max(clamp01(pis), fecha)
      const olhar = t < ro.olhaEsq ? 0 : t < ro.olhaDir ? -1 : t < ro.olhaFrente ? 1 : 0
      const olharSuave = olhar * sm(0, 1, clamp01(((t < ro.olhaDir ? t - ro.olhaEsq : t < ro.olhaFrente ? t - ro.olhaDir : t - ro.olhaFrente) / 0.12)))
      q.olhos[2] = t < ro.olhaFrente ? olharSuave : 0
      q.olhos[3] = 0.15
      // boca: sorriso que abre, vira bico (O) e sopra
      const sorri = sm(ro.sorri, ro.sorri + 0.3, t)
      const bico = sm(ro.bico, ro.bico + 0.16, t)
      q.boca[0] = pcx
      q.boca[1] = pcy + 0.06
      q.boca[2] = lerp(0.3, 0.1, bico)
      q.boca[3] = sorri * some * (t > ro.sopra ? 1 + 0.4 * Math.sin(clamp01((t - ro.sopra) / 0.3) * Math.PI) : 1)
      q.bico = bico
    }

    /* ── ondulação da tela (épico) ── */
    q.onda.fill(0)
    if (r.onda) {
      const base = 0.006 * sm(r.onda[0], r.onda[0] + 0.5, t) * (1 - sm(r.onda[1] - 0.4, r.onda[1], t))
      const sopro = ro ? Math.exp(-Math.max(0, t - ro.sopra) * 4) * (t > ro.sopra ? 1 : 0) * 0.04 : 0
      q.onda[0] = ro && t > ro.sopra ? q.boca[0] : pcx
      q.onda[1] = ro && t > ro.sopra ? q.boca[1] : pcy
      q.onda[2] = base + sopro
      q.onda[3] = tReal * 7
    }

    /* ── túnel, caleidoscópio, formas e clarão (lendário) ── */
    q.tunel.fill(0)
    q.caleido = 0
    q.formasK.fill(0)
    q.flash = 0
    const tu = r.tunel
    if (tu) {
      // abre do meio pra fora; no fim escurece (o prêmio é o mais claro da tela)
      q.tunel[0] = sm(tu.abre, tu.abre + 0.75, t)
      q.tunel[1] = this.faseTunel.em(t)
      q.tunel[2] = 6
      q.tunel[3] = 1 - 0.45 * sm(tu.recua, tu.recua + 0.8, t)
      q.caleido = sm(tu.caleido, tu.caleido + 0.45, t)
      // formas: nascem no fundo do túnel e vêm vindo (z cresce), girando; a câmera lenta desacelera
      const tf = this.relogioFormas.em(t) - this.relogioFormas.em(tu.formas)
      if (t > tu.formas) {
        const maxZ = Math.max(this.hx, this.hy) * 1.25
        this.formas.forEach((f, k) => {
          const vida = 1.55
          const idade = (((tf - f.t0) % vida) + vida) % vida
          if (tf < f.t0) return
          const z = 0.04 * Math.exp(2.4 * idade)
          if (z > maxZ) return
          const a = f.ang + tf * 0.5
          const i = k * 4
          q.formas[i] = pcx + Math.cos(a) * z
          q.formas[i + 1] = pcy + Math.sin(a) * z
          q.formas[i + 2] = 0.035 + 0.11 * Math.min(1, z / 0.7)
          q.formas[i + 3] = f.giro * tf
          q.formasK[i] = f.tipo
          q.formasK[i + 1] = f.cor
          q.formasK[i + 2] = sm(0.03, 0.12, z) * (1 - sm(tu.recua, tu.recua + 0.6, t) * 0.7)
        })
      }
      // clarão: branco em 1 quadro, desfaz em dither
      if (t > tu.clarao) q.flash = t < tu.clarao + 0.07 ? 1 : 1 - sm(tu.clarao + 0.07, tu.clarao + 0.42, t)
    }

    /* ── prêmio: halo, raios, cartão e carimbo ── */
    const info = this.cartao(t)
    d.cartaoX = info.x
    d.cartaoY = info.y
    d.cartaoEsc = info.esc
    d.cartaoAlfa = info.alfa
    d.cartaoAng = info.ang
    d.premioVisivel = info.alfa > 0.5
    const halo = sm(r.premio, r.premio + 0.35, t)
    // o halo e os raios nascem atrás do desenho do produto (que escala com o cartão, a partir do centro dele)
    const ex = info.esc
    q.halo[0] = pcx + (info.x + (prem.vx - prem.x) * ex) / g.u
    q.halo[1] = pcy + (info.y + (prem.vy - prem.y) * ex) / g.u
    q.halo[2] = (Math.max(prem.vw * 1.25, prem.vh * 0.62) / g.u) * Math.max(0.2, ex) * (1 + 0.04 * Math.sin(tReal * 2.4))
    q.halo[3] = halo * (r.raridade === 'comum' ? 0.8 : 1)
    // o fundo escuro do cartão inteiro (o texto lê em cima do túnel e dos raios)
    q.placa[0] = pcx + info.x / g.u
    q.placa[1] = pcy + info.y / g.u
    q.placa[2] = (prem.w / 2 / g.u + 0.08) * Math.max(0.2, ex)
    q.placa[3] = (prem.h / 2 / g.u + 0.06) * Math.max(0.2, ex)
    q.placaForca = halo * (r.tunel ? 1 : r.raridade === 'epico' ? 0.85 : 0.6)
    if (r.raios) {
      q.raios[0] = sm(r.raios.de, r.raios.de + 0.4, t) * (r.raridade === 'lendario' ? 0.9 : 0.7)
      q.raios[1] = r.raios.n
      q.raios[2] = tReal * (r.raridade === 'lendario' ? 0.32 : 0.22)
      q.raios[3] = Math.max(this.hx, this.hy) * 1.6
    } else q.raios.fill(0)
    // carimbo: bate em degraus (2 → 0,92 → 1); o lendário bate mais forte
    const ts = t - r.carimbo
    const forte = r.raridade === 'lendario'
    if (ts < 0) {
      d.carimboEsc = 0
      d.carimboAlfa = 0
    } else {
      const k = Math.floor(ts * 24)
      const passos = forte ? [2.6, 1.9, 1.3, 0.9, 1.04, 1] : [2, 1.45, 0.92, 1]
      d.carimboEsc = passos[Math.min(passos.length - 1, k)]
      d.carimboAlfa = 1
    }
    d.carimboHolo = forte && ts > 0.25 ? ((ts - 0.25) / 1.6) % 1 : 0

    if (dissipa > 0) {
      const k = 1 - dissipa
      q.halo[3] *= k
      q.placaForca *= k
      q.raios[0] *= k
      q.tunel[0] *= k
      q.aneis.fill(0)
      q.formasK.fill(0)
      d.cartaoAlfa *= clamp01(1 - dissipa * 2.2)
      d.cartaoEsc *= 1 + dissipa * 0.12
      d.carimboAlfa *= clamp01(1 - dissipa * 2.2)
    }

    /* ── tremida (lendário) e a batida do carimbo ── */
    d.palcoX = 0
    d.palcoY = 0
    if (r.tremida && t > r.tremida[0] && t < r.tremida[1]) {
      const a = (1 - sm(r.tremida[0], r.tremida[1], t)) * 5
      d.palcoX += Math.sin(q.boil * 2.1) * a
      d.palcoY += Math.cos(q.boil * 1.7 + 1) * a
    }
    if (ts > 0 && ts < 0.3) {
      const a = (1 - ts / 0.3) * (forte ? 7 : 3)
      d.palcoX += Math.sin(ts * 90) * a
      d.palcoY += Math.cos(ts * 70) * a * 0.6
    }
  }

  /** O buraco do prêmio no tempo t: progresso e raios (u). */
  private buraco(t: number): { o: number; rx: number; ry: number } {
    const g = this.geo
    const r = this.rot
    const p = g.premio
    const rx = p.w / 2 / g.u + 0.14
    const ry = p.h / 2 / g.u + 0.12
    if (r.tunel) {
      const tu = r.tunel
      const abre = sm(tu.abre, tu.abre + 0.75, t)
      const recua = sm(tu.recua, tu.recua + 0.8, t)
      const grx = Math.max(rx, this.hx * 0.82)
      const gry = Math.max(ry, this.hy * 0.8)
      return { o: abre, rx: lerp(grx, rx * 1.12, recua), ry: lerp(gry, ry * 1.12, recua) }
    }
    return { o: saiCubica(clamp01((t - r.abre) / r.abreDur)), rx, ry }
  }

  /** O cartão do prêmio: deslocamento (px), escala, opacidade e giro. */
  private cartao(t: number): { x: number; y: number; esc: number; alfa: number; ang: number } {
    const r = this.rot
    const g = this.geo
    if (t < r.premio) return { x: 0, y: 0, esc: 0, alfa: 0, ang: 0 }
    if (r.rosto) {
      // soprado da boca pra frente: sai pequeno da boca, passa do tamanho e assenta
      const s = clamp01((t - r.premio) / 0.42)
      const yb = (this.q.boca[1] - (g.premio.y - g.H / 2) / g.u) * g.u
      return { x: 0, y: lerp(yb, 0, saiCubica(s)), esc: lerp(0.12, 1, passa(s, 1.9)), alfa: clamp01(s * 5), ang: lerp(-14, 0, saiCubica(s)) }
    }
    if (r.tunel) {
      // desce pelo túnel (vem do fundo, em câmera lenta) girando de leve
      const s = clamp01((t - r.premio) / 1.05)
      const e = 1 - Math.pow(1 - s, 2.4)
      return { x: 0, y: 0, esc: lerp(0.04, 1, s < 1 ? e * (1 + 0.06 * Math.sin(s * Math.PI)) : 1), alfa: clamp01(s * 4), ang: lerp(-30, 0, e) }
    }
    const s = clamp01((t - r.premio) / 0.34)
    return { x: 0, y: lerp(18, 0, saiCubica(s)), esc: lerp(0.55, 1, passa(s, 1.6)), alfa: clamp01(s * 4), ang: 0 }
  }

  /** As cores do brilho e das faíscas da raridade (as partículas usam). */
  get geometria(): Geo {
    return this.geo
  }
}
