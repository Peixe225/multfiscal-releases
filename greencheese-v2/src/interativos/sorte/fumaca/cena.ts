// A cena da fumaça como função do tempo: dado t (s desde o beck começar a subir) e a geometria do palco, preenche o
// quadro (quadro.ts) que o pintor em pixel pinta e o estado do cartão do prêmio no DOM. Sem estado escondido além das
// trilhas sorteadas na montagem (semente fixa): dá pra pular pra qualquer quadro (o toque que pula, o 0,25× do
// laboratório, o quadro parado do movimento reduzido) e sai sempre igual. Tudo em px de CSS do palco.
import { INFO_RARIDADE, type Raridade } from '../../../lib/raridade'
import { CABECA, FRENTE, FUNDO, NB, PASSO_BOLHA, paleta, px32, misturar, quadroVazio, type Quadro } from './quadro'
import type { PoseBeck } from './pose'
import { ROTEIROS, SUBIDA, type Puxada, type Roteiro } from './roteiro'

export interface Geo {
  W: number
  H: number
  /** O lado menor (a unidade das medidas relativas). */
  u: number
  pose: PoseBeck
  /** O cartão do prêmio (centro e tamanho, px, sem escala), o desenho do produto nele e o retângulo do texto. */
  premio: { x: number; y: number; w: number; h: number; vx: number; vy: number; vw: number; vh: number; tx0: number; ty0: number; tx1: number; ty1: number }
}

/** No jogo: o beck dentro da câmara do dichavador (centro x, o pé, o comprimento) e a boca (a borda da frente recorta). */
export interface Origem {
  x: number
  base: number
  h: number
  boca: { x: number; y: number; rx: number; ry: number }
}

/** O que o motor aplica no DOM (só transform e opacity). */
export interface EstadoDom {
  palcoX: number
  palcoY: number
  cartaoX: number
  cartaoY: number
  cartaoEsc: number
  cartaoAlfa: number
  cartaoAng: number
  carimboEsc: number
  carimboAlfa: number
  carimboHolo: number
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
const entraQuad = (s: number) => s * s
const saiQuad = (s: number) => 1 - (1 - s) * (1 - s)
const entraSai = (s: number) => (s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2)
const passa = (s: number, k = 1.7) => 1 + (k + 1) * Math.pow(s - 1, 3) + k * Math.pow(s - 1, 2)
/** Degrau de 12 qps (o tempo "de desenho" das piscadas e dos estalos). */
const q12 = (t: number) => Math.floor(t * 12) / 12

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

/* ───────────── trilhas ───────────── */

interface Nuvem {
  t0: number
  dur: number
  x0: number
  y0: number
  x1: number
  y1: number
  r: number
  curva: number
  fase: number
  fundo: boolean
  /** Satélites: ângulo, distância (× r), raio (× r), giro (rad/s). */
  sat: [number, number, number, number][]
  /** Solta pedaços por cima a cada `periodo` s (as do alto). */
  periodo: number
  /** Termina em fiapo (as do alto): o lado da curva. */
  rabo: number
  lado: number
}

interface Beck {
  x: number
  y: number
  ang: number
  L: number
  sx: number
  sy: number
}

/** A torcida: comprimento (× L) e a dobra pro lado (rad); o pintor usa as mesmas. */
export const TORCIDA_L = 0.17
export const TORCIDA_ANG = 0.55

/* ───────────── a cena ───────────── */

export class Cena {
  readonly q: Quadro
  readonly dom: EstadoDom
  readonly rot: Roteiro
  readonly fim: number
  private geo!: Geo
  private origem: Origem | null = null
  private nuvens: Nuvem[] = []
  private faseTunel: Integral
  private relogioPremio: Integral
  /** As cores da raridade e a apagada da cabeça (épico depois do sopro). */
  private palFrente
  private palFundo
  private palCabeca
  private palCabecaApagada
  private olhosPortal: [number, number][] = []
  /** O x da cabeça do épico agora (ela espia pelo canto do cartão depois do sopro). */
  private cabecaX = 0
  private gotas: number[] = []

  constructor(
    readonly raridade: Raridade,
    readonly previa: boolean,
  ) {
    this.rot = ROTEIROS[raridade]
    this.fim = this.rot.pronto
    this.q = quadroVazio()
    this.dom = { palcoX: 0, palcoY: 0, cartaoX: 0, cartaoY: 0, cartaoEsc: 0, cartaoAlfa: 0, cartaoAng: 0, carimboEsc: 0, carimboAlfa: 0, carimboHolo: 0, premioVisivel: false }
    const r = this.rot
    this.palFrente = paleta(r.cores)
    this.palFundo = paleta(r.coresFundo)
    this.palCabeca = paleta(['#2e0520', '#b0216e', '#ff5cae', '#ffc6e4'])
    this.palCabecaApagada = paleta(['#2e0520', '#741249', '#b83a80', '#e07fb4'])
    const info = INFO_RARIDADE[raridade]
    this.q.haloCor = px32(info.cor)
    this.q.raiosCor = px32(r.raios?.cor ?? info.cor)
    this.q.raiosMiolo = px32(r.raios?.miolo ?? info.clara)
    this.q.olhosTipo = raridade === 'lendario' ? 1 : raridade === 'raro' ? 2 : 0
    const tu = r.portal
    this.faseTunel = new Integral((t) => {
      if (!tu) return 0
      if (t < tu.lento[0]) return lerp(0.5, 1.6, sm(tu.abre, tu.abre + 0.8, t))
      if (t < tu.lento[1]) return 0.3
      return lerp(0.3, 0.7, sm(tu.lento[1], tu.lento[1] + 0.7, t))
    }, r.pronto + 3)
    // o relógio do prêmio (câmera lenta no lendário)
    this.relogioPremio = new Integral((t) => (tu && t >= tu.lento[0] && t < tu.lento[1] ? 0.45 : 1), r.pronto + 3)
  }

  get geometria(): Geo {
    return this.geo
  }

  /** No jogo, de onde o beck sai (a câmara do dichavador); sem isto ele sobe do pé da tela. */
  definirOrigem(o: Origem | null) {
    this.origem = o
  }

  /** Recalcula as trilhas pro tamanho do palco (montagem e resize). */
  definirGeo(g: Geo) {
    this.geo = g
    const { W, H, u } = g
    const r = this.rot
    const rnd = semente(1234 + r.nuvens * 7 + Math.round(W) * 31 + Math.round(H))
    // as nuvens grandes do sopro: linhas de baixo pra cima cobrindo o quadro; as de baixo chegam primeiro
    const linhas = Math.max(3, Math.round(H / (u * 0.36)))
    const porLinha = Math.max(2, Math.round(W / (u * 0.42)))
    const alvos: [number, number, number][] = []
    for (let j = 0; j < linhas; j++) {
      const y = H * (1 - (j + 0.5) / linhas)
      const n = porLinha + (j % 2)
      for (let i = 0; i < n; i++) {
        const x = W * ((i + (j % 2 ? 0 : 0.5)) / porLinha)
        alvos.push([x, y, j])
      }
    }
    // mais alvos que nuvens: escolhe espalhado (sempre os dos cantos do alto e de baixo)
    const n = Math.min(r.nuvens, alvos.length)
    const passo = alvos.length / n
    const escolhidos = Array.from({ length: n }, (_, k) => alvos[Math.min(alvos.length - 1, Math.floor(k * passo + rnd() * passo * 0.6))])
    // e uma no meio, da frente, que chega junto (o sorriso do comum mora nela; o buraco do prêmio abre nela)
    escolhidos.push([W / 2, g.premio.y, Math.floor(linhas / 2)])
    this.nuvens = escolhidos.map(([x, y, j], k) => {
      const meio = k === escolhidos.length - 1
      const x1 = meio ? x : x + (rnd() - 0.5) * u * 0.12
      const y1 = meio ? y : y + (rnd() - 0.5) * u * 0.1
      const raio = u * (meio ? 0.3 : (0.19 + rnd() * 0.09) * (j === linhas - 1 ? 0.85 : 1))
      const dist = Math.hypot(x1 - W / 2, H + raio - y1)
      const alto = j >= linhas - 2
      // os lobos saem da borda da mãe (a silhueta fica cheia de calombos, não um círculo)
      const nSat = alto ? 3 : 2
      const sat: Nuvem['sat'] = []
      for (let s = 0; s < nSat; s++) sat.push([(s / nSat) * Math.PI * 2 + rnd() * 1.4, 0.85 + rnd() * 0.25, 0.36 + rnd() * 0.16, (s % 2 ? -1 : 1) * (0.3 + rnd() * 0.3)])
      return {
        t0: r.sopro + j * 0.05 + rnd() * 0.05,
        dur: 0.42 + Math.min(0.32, (dist / H) * 0.32) + rnd() * 0.06,
        x0: lerp(W / 2, x1, 0.35) + (rnd() - 0.5) * u * 0.2,
        y0: H + raio * 0.9,
        x1,
        y1,
        r: raio,
        curva: (rnd() < 0.5 ? -1 : 1) * (0.06 + rnd() * 0.1) * u,
        fase: rnd() * 6.28,
        fundo: !meio && k % 3 === 1,
        sat,
        periodo: alto ? 0.4 + rnd() * 0.3 : 0,
        rabo: alto && k % 2 === 0 ? 1 : 0,
        lado: rnd() < 0.5 ? -1 : 1,
      }
    })
    // lendário: os 8 olhos na borda do portal e as 5 gotas que derretem
    this.olhosPortal = Array.from({ length: 8 }, (_, k) => {
      const a = -Math.PI / 2 + (k / 8) * Math.PI * 2 + 0.2
      return [a, k]
    })
    this.gotas = [-2.45, -1.95, -1.5, -1.05, -0.62]
  }

  /* ───────────── o beck ───────────── */

  /** O beck no tempo t (centro, inclinação, comprimento, estica-e-encolhe): sobe, assenta, é fumado, sai. */
  private beckEm(t: number): Beck {
    const g = this.geo
    const P = g.pose
    const r = this.rot
    let x: number
    let y: number
    let ang: number
    let L = P.L
    if (t < r.pousa) {
      const o = this.origem
      if (o && !this.previa) {
        // sai reto da boca (0–0,28) e depois voa crescendo até a pose, já deitando
        const ta = 0.28
        const h0 = o.h
        if (t < ta) {
          const s = saiCubica(t / ta)
          L = lerp(h0, h0 * 1.14, s)
          ang = 6 * s
          x = o.x
          // o pé sobe da base até acima da borda da boca
          const pe = lerp(o.base, o.boca.y - o.boca.ry * 1.2, s)
          y = pe - L / 2
        } else {
          const s = entraSai((t - ta) / (r.pousa - ta))
          const L0 = h0 * 1.14
          const pe0 = o.boca.y - o.boca.ry * 1.2
          const c0x = o.x + Math.sin((6 * Math.PI) / 180) * (L0 / 2)
          const c0y = pe0 - (Math.cos((6 * Math.PI) / 180) * L0) / 2
          L = lerp(L0, P.L * 1.02, s)
          ang = lerp(6, P.ang + 3, s)
          x = lerp(c0x, P.x, s)
          y = lerp(c0y, P.y, s) - Math.sin(Math.PI * s) * g.u * 0.06
        }
      } else {
        const s = saiCubica(clamp01(t / SUBIDA))
        x = P.x
        y = lerp(g.H + P.L * 0.6, P.y, s)
        ang = lerp(12, P.ang + 3, s)
        L = P.L * lerp(0.9, 1.02, s)
      }
    } else {
      // assenta: passa 3° e volta; depois balança de leve
      const s = clamp01((t - r.pousa) / (r.assenta - r.pousa))
      const assenta = t < r.assenta ? lerp(3, 0, saiQuad(s)) : 0
      L = P.L * (t < r.assenta ? lerp(1.02, 1, s) : 1)
      x = P.x + Math.sin(t * 0.9) * 2 * clamp01((t - r.pousa) * 3)
      y = P.y + Math.sin(t * 1.7) * 3 * clamp01((t - r.pousa) * 3)
      ang = P.ang + assenta + Math.sin(t * 1.3) * 2.5 * clamp01((t - r.assenta) * 2)
    }
    // inclina 2° na direção do isqueiro quando ele chega, e volta quando a torcida pega
    const is = r.isqueiro
    ang += 2 * sm(is.entra, is.clique, t) * (1 - sm(is.pega, is.fora, t))
    // as puxadas: encolhe na antecipação, estica puxando, volta passando um pouco
    let sx = 1
    let sy = 1
    for (const p of r.puxadas) {
      if (t < p.de || t > p.ate + 0.2) continue
      if (t < p.puxa) {
        const s = sm(p.de, p.puxa, t)
        sx = lerp(1, 0.96, s)
        sy = lerp(1, 1.04, s)
        ang -= 2 * s
      } else if (t < p.segura) {
        const s = sm(p.puxa, p.segura, t)
        sx = lerp(0.96, 1.05, s)
        sy = lerp(1.04, 0.97, s)
        ang -= 2 * (1 - s)
      } else if (t < p.solta) {
        sx = 1.05
        sy = 0.97
      } else {
        const s = clamp01((t - p.solta) / (p.ate + 0.2 - p.solta))
        // volta passando: 1,05 → 0,99 → 1
        sx = s < 0.5 ? lerp(1.05, 0.99, saiQuad(s * 2)) : lerp(0.99, 1, sm(0, 1, (s - 0.5) * 2))
        sy = s < 0.5 ? lerp(0.97, 1.01, saiQuad(s * 2)) : lerp(1.01, 1, sm(0, 1, (s - 0.5) * 2))
      }
    }
    // o sopro: a "mão" abaixa o beck pra fora do quadro enquanto a fumaça sobe por cima
    if (t > r.sopro) {
      const s = entraSai(clamp01((t - r.sopro) / 0.45))
      y += s * g.H * 0.7
      x -= s * g.u * 0.1
      ang -= 25 * s
    }
    return { x, y, ang, L, sx, sy }
  }

  /** Quanto do papel já queimou no tempo t (a linha de queima anda em in-out na puxada). */
  private queimaEm(t: number): number {
    let q = 0
    for (const p of this.rot.puxadas) q += p.queima * entraSai(clamp01((t - p.puxa) / (p.solta - p.puxa)))
    return q
  }

  /** A brasa no tempo t: acesa (0–1) e o brilho (0–1). */
  private luzEm(t: number): { brasa: number; luz: number } {
    const r = this.rot
    const brasa = sm(r.isqueiro.pega, r.isqueiro.pega + 0.08, t)
    let luz = 0.2
    for (const p of r.puxadas) {
      if (t < p.de - 0.01 || t > p.ate + 0.05) continue
      if (t < p.puxa) luz = lerp(0.2, 0.12, sm(p.de, p.puxa, t))
      else if (t < p.segura) luz = lerp(0.12, 1, Math.pow(clamp01((t - p.puxa) / (p.segura - p.puxa)), 1.6)) * p.forca + 0.12 * (1 - p.forca)
      else if (t < p.solta) luz = (0.9 + 0.1 * Math.sin(q12(t) * 37)) * p.forca
      else luz = lerp(p.forca * 0.95, 0.2, saiCubica(clamp01((t - p.solta) / (p.ate - p.solta))))
    }
    return { brasa, luz: clamp01(luz) }
  }

  /** O comprimento da cinza agora: o que queimou desde a última que caiu. */
  private cinzaEm(t: number, L: number): number {
    let caiu = 0
    for (const c of this.rot.cinzaCai) if (t >= c) caiu = Math.max(caiu, this.queimaEm(c))
    return Math.max(0, (this.queimaEm(t) - caiu) * L * 0.92)
  }

  /** Converte o beck (centro, ângulo, comprimento, escala) no que o pintor usa. */
  private aplicarBeck(b: Beck, t: number) {
    const e = this.q.beck
    const a = (b.ang * Math.PI) / 180
    e.ax = Math.sin(a)
    e.ay = -Math.cos(a)
    e.L = b.L
    e.sx = b.sx
    e.sy = b.sy
    e.x0 = b.x - e.ax * (b.L / 2) * b.sx
    e.y0 = b.y - e.ay * (b.L / 2) * b.sx
    const { brasa, luz } = this.luzEm(t)
    e.brasa = brasa
    e.luz = luz
    e.linha = 1 - this.queimaEm(t)
    e.cinza = this.cinzaEm(t, b.L)
    // pende pro lado da gravidade (com o beck deitado, até 0,25 do diâmetro), com 1 quadro de atraso no balanço
    const atras = this.beckEm(t - 1 / 12)
    const rb = 0.092 * b.L
    e.pende = Math.pow(Math.min(1, e.cinza / (0.14 * b.L)), 2) * 0.5 * rb * Math.sin((atras.ang * Math.PI) / 180) * 1.4
    e.racha = 0
    for (const c of this.rot.cinzaCai) if (t > c - 0.17 && t < c) e.racha = 1
    const is = this.rot.isqueiro
    e.torcida = t < is.pega ? 1 : 1 - clamp01((t - is.pega) / 0.12)
    e.torcidaAcesa = sm(is.lambe + 0.05, is.pega, t)
  }

  /** Onde fica a brasa (px) no tempo t, pras faíscas e os fiapos. */
  brasaEm(t: number): [number, number] {
    const b = this.beckEm(t)
    const a = (b.ang * Math.PI) / 180
    const s = (1 - this.queimaEm(t)) * b.L * b.sx
    const ax = Math.sin(a)
    const ay = -Math.cos(a)
    return [b.x - ax * (b.L / 2) * b.sx + ax * s, b.y - ay * (b.L / 2) * b.sx + ay * s]
  }

  /** A ponta da torcida (px) no tempo t (o isqueiro mira nela; as faíscas do estalo saem dela). */
  pontaEm(t: number): [number, number] {
    const b = this.beckEm(t)
    const a = (b.ang * Math.PI) / 180
    const ax = Math.sin(a)
    const ay = -Math.cos(a)
    const nx = -ay
    const ny = ax
    const tx = b.x + ax * (b.L / 2) * b.sx
    const ty = b.y + ay * (b.L / 2) * b.sx
    const phi = TORCIDA_ANG
    const tl = TORCIDA_L * b.L
    return [tx + (ax * Math.cos(phi) + nx * Math.sin(phi)) * tl * 0.85, ty + (ay * Math.cos(phi) + ny * Math.sin(phi)) * tl * 0.85]
  }

  /** A cinza no instante em que cai: o meio dela, o comprimento, o raio e o ângulo (as partículas a fazem cair). */
  cinzaQueCai(tc: number): { x: number; y: number; comp: number; raio: number; ang: number } {
    const b = this.beckEm(tc)
    const a = (b.ang * Math.PI) / 180
    const ax = Math.sin(a)
    const ay = -Math.cos(a)
    const comp = this.cinzaEm(tc - 0.001, b.L)
    const s = (1 - this.queimaEm(tc)) * b.L * b.sx + comp / 2
    return { x: b.x - ax * (b.L / 2) * b.sx + ax * s, y: b.y - ay * (b.L / 2) * b.sx + ay * s, comp, raio: 0.085 * b.L, ang: a }
  }

  /* ───────────── o quadro ───────────── */

  /**
   * O quadro no tempo t. `dissipa` (0–1): no jogo, depois do auge, a fumaça se abre como cortina (as massas da
   * esquerda vão pra esquerda, as da direita pra direita) e o story entra; `resto` (0–1): o que sobra dela, a 25%,
   * subindo e se desfazendo no fundo do story.
   */
  calcular(t: number, dissipa = 0, resto = 0): void {
    const g = this.geo
    const r = this.rot
    const q = this.q
    const d = this.dom
    const { W, H, u } = g
    q.t = t
    q.ferve = Math.floor(t * 12)
    q.alfa = resto > 0 ? 0.25 * (1 - sm(0.6, 1, resto)) + 0.0001 : 1
    q.ondulado = u * 0.035
    q.fervura = 4 * 0.45
    const prem = g.premio
    const pcx = prem.x
    const pcy = prem.y

    /* ── beck ── */
    const bk = this.beckEm(t)
    this.aplicarBeck(bk, t)
    const e = q.beck
    e.vis = bk.y - bk.L * 0.6 < H && dissipa <= 0 && resto <= 0
    // no jogo, enquanto o pé ainda está dentro da câmara, a borda da frente da boca recorta
    const o = this.origem
    e.corte = o && !this.previa && t < 0.4 ? o.boca : null
    const [bx, by] = this.brasaEm(t)
    q.brilhoBrasa[0] = bx
    q.brilhoBrasa[1] = by
    q.brilhoBrasa[2] = 0.092 * bk.L * 2 * 1.3
    q.brilhoBrasa[3] = e.vis ? e.brasa * Math.max(0, (e.luz - 0.35) / 0.65) : 0

    /* ── isqueiro: entra de lado (embaixo à direita), clica, a chama lambe a torcida, ela pega, ele sai ── */
    const is = r.isqueiro
    const s = q.isqueiro
    s.vis = t > is.entra && t < is.fora && dissipa <= 0
    if (s.vis) {
      const [px, py] = this.pontaEm(t)
      const h = bk.L * 0.24
      s.h = h
      // a chama aponta pra torcida vindo de baixo à direita
      const dirx = -0.25
      const diry = -0.968
      const alcance = h * 0.62
      let x = px - dirx * alcance
      let y = py - diry * alcance
      // entra com passada (6 px) e sai pra baixo à direita
      const ent = clamp01((t - is.entra) / 0.18)
      const fora = entraQuad(clamp01((t - is.sai) / (is.fora - is.sai)))
      const off = (1 - saiCubica(ent)) * 1 + fora * 1.1
      x += off * W * 0.45
      y += off * H * 0.35
      if (ent >= 1 && t < is.clique) {
        const v = Math.sin(clamp01((t - is.entra - 0.18) / 0.12) * Math.PI)
        x -= v * 6 * 0.25
        y -= v * 6 * 0.968
      }
      s.x = x
      s.y = y
      s.ang = Math.atan2(dirx, -diry) * 0.85
      s.chamaAng = Math.atan2(dirx, -diry)
      s.faisca = t > is.clique && t < is.clique + 0.08 ? 1 - (t - is.clique) / 0.08 : 0
      s.chama = t < is.lambe ? 0 : t < is.sai ? Math.min(1, q12(t - is.lambe + 1 / 12) * 6) : Math.max(0, 1 - (t - is.sai) * 10)
    }
    // o estalo da torcida pegando (0,12 s)
    const tp = t - is.pega
    const [ptx, pty] = this.pontaEm(Math.min(t, is.pega + 0.12))
    q.estalo[0] = ptx
    q.estalo[1] = pty
    q.estalo[2] = tp > 0 && tp < 0.12 && dissipa <= 0 ? 1 - Math.floor(tp * 24) / 3 : 0

    /* ── fiapos: um por puxada (e o do estalo), saindo da brasa, alternando ── */
    q.nFitas = 0
    if (e.brasa > 0 && e.vis) {
      const nascem = [is.pega + 0.04, ...r.puxadas.map((p) => p.puxa)]
      const Lr = u * 0.44
      for (let k = 0; k < nascem.length && q.nFitas < 3; k++) {
        const tb = nascem[k]
        if (t < tb) break
        const solta = k + 1 < nascem.length ? nascem[k + 1] : r.sopro
        const idade = t - tb
        const sAge = t - solta
        if (sAge > 0.7) continue
        const f = q.fitas[q.nFitas++]
        const [fx, fy] = sAge > 0 ? this.brasaEm(solta) : [bx, by]
        f.x = fx
        f.y = fy - (sAge > 0 ? sAge * u * 0.18 : 0) - 0.07 * bk.L
        f.comp = Lr * (0.35 + 0.65 * saiQuad(clamp01(idade / 0.7)))
        f.larg = 1.05
        f.fase = k * 2.1
        f.lado = k % 2 ? -1 : 1
        f.solta = sAge > 0 ? clamp01(sAge / 0.7) : 0
      }
    }

    /* ── as nuvens ── */
    const B = q.blobs
    let nb = 0
    const pôr = (x: number, y: number, raio: number, peso: number, estica: number, dx: number, dy: number, camada: number) => {
      if (nb >= NB || raio <= 0.5 || peso <= 0.001) return
      const i = nb * PASSO_BOLHA
      B[i] = x
      B[i + 1] = y
      B[i + 2] = raio
      B[i + 3] = peso
      B[i + 4] = estica
      B[i + 5] = dx
      B[i + 6] = dy
      B[i + 7] = camada
      nb++
    }
    // as baforadas depois de cada puxada (quem fuma solta embaixo, fora do quadro): entram pelo pé no canto vazio
    // embaixo à direita do beck, sobem girando (os lobos dão a volta no miolo) e se desfazem em pedaços
    r.puxadas.forEach((p: Puxada, k) => {
      if (!p.baforada || dissipa > 0) return
      const t0 = p.solta + 0.02
      const a = t - t0
      if (a < 0 || a > 1.5) return
      const raio = p.baforada * W * 1.05
      const ent = saiCubica(clamp01(a / 0.6))
      const some = sm(0.6, 1.5, a)
      const lado = k % 2 ? 1 : -1
      const x = W * (0.66 + lado * 0.06) + Math.sin(a * 2 + k) * u * 0.04 + some * u * 0.05
      const y = lerp(H + raio * 1.3, H * 0.7, ent) - some * u * 0.4
      const rr = raio * (0.5 + 0.5 * ent) * (1 - some * 0.6)
      const vel = (1 - ent) * 1.5
      const giro = a * 2.2 * lado
      // o miolo some primeiro: no fim só os lobos, já soltos, subindo
      pôr(x, y, rr * 0.8 * (1 - some), 1, Math.min(0.6, 0.3 + vel * 0.4), 0, -1, FRENTE)
      for (let m = 0; m < 5; m++) {
        const an = giro + m * 1.257 + (m % 2) * 0.3
        const d = rr * (0.78 + some * 0.9)
        const rl = rr * (0.5 - (m % 3) * 0.06) * (1 - some * (0.8 + m * 0.06))
        pôr(x + Math.cos(an) * d, y + Math.sin(an) * d * 0.75 - some * m * u * 0.02, rl, 1, 0.12, 0, -1, FRENTE)
      }
    })
    // o buraco do prêmio
    const bur = this.buraco(t)
    q.buraco[0] = pcx
    q.buraco[1] = pcy
    q.buraco[2] = bur.rx
    q.buraco[3] = bur.ry
    q.buraco[4] = bur.o * (1 - dissipa)
    // o lendário: a fumaça vira moldura (empurrada pra fora de uma elipse) depois que o portal abre
    const pt = r.portal
    const moldura = pt ? sm(pt.abre - 0.1, pt.abre + 0.6, t) : 0
    // o épico: as outras nuvens saem de perto da cabeça
    const ro = r.rosto
    const cabX = W / 2
    let cabY = pcy - u * 0.12
    const longeDaCabeca = ro ? sm(ro.cabeca - 0.1, ro.cabeca + 0.3, t) * (1 - sm(ro.sopra + 0.1, ro.sopra + 0.5, t)) : 0
    for (let k = 0; k < this.nuvens.length; k++) {
      const n = this.nuvens[k]
      if (t < n.t0) continue
      const a = t - n.t0
      // entrada em in-out: ~0,08 s acelerando, pico na frente da baforada, desacelerando até o alvo
      const aq = a - 0.04 * (1 - Math.exp(-a / 0.04))
      const sE = clamp01(aq / n.dur)
      const eE = saiCubica(sE)
      const px0 = -(n.y1 - n.y0)
      const py0 = n.x1 - n.x0
      const pl = Math.hypot(px0, py0) || 1
      let x = lerp(n.x0, n.x1, eE) + (px0 / pl) * n.curva * Math.sin(Math.PI * eE)
      let y = lerp(n.y0, n.y1, eE) + (py0 / pl) * n.curva * Math.sin(Math.PI * eE)
      // empuxo: depois de chegar, sobe devagar; e respira
      const chegou = Math.max(0, a - n.dur)
      y -= chegou * u * 0.065
      x += Math.sin(t * 0.7 + n.fase) * u * 0.015
      let raio = n.r * lerp(0.35, 1, saiQuad(sE)) * (1 + 0.05 * Math.sin(t * 1.6 + n.fase))
      // velocidade (pra esticar no sentido do movimento)
      const vel = sE < 1 ? (3 * Math.pow(1 - sE, 2) * Math.hypot(n.x1 - n.x0, n.y1 - n.y0)) / n.dur / u : 0
      let dx = n.x1 - n.x0
      let dy = n.y1 - n.y0
      const dl = Math.hypot(dx, dy) || 1
      dx /= dl
      dy /= dl
      let estica = Math.min(0.6, vel * 0.3)
      if (estica < 0.12) {
        estica = 0.12
        dx = 0
        dy = -1
      }
      // moldura (lendário): pra fora da elipse do portal
      if (moldura > 0) {
        // a moldura: só os 22% de fora (o túnel é o fundo principal)
        const ex = (x - W / 2) / (W * 0.44)
        const ey = (y - H / 2) / (H * 0.45)
        const dn = Math.hypot(ex, ey)
        if (dn < 1.12) {
          const nd = lerp(dn, 1.12, moldura)
          const ux = dn > 1e-3 ? ex / dn : Math.cos(n.fase)
          const uy = dn > 1e-3 ? ey / dn : Math.sin(n.fase)
          x = W / 2 + ux * nd * W * 0.44
          y = H / 2 + uy * nd * H * 0.45
        }
        raio *= 1 - 0.25 * moldura
      }
      // longe da cabeça (épico)
      if (longeDaCabeca > 0) {
        const ex = (x - cabX) / (u * 0.36)
        const ey = (y - cabY) / (u * 0.32)
        const dn = Math.hypot(ex, ey)
        const alvo = 1 + (raio / (u * 0.34)) * 0.7
        if (dn < alvo) {
          const nd = lerp(dn, alvo, longeDaCabeca)
          const ux = dn > 1e-3 ? ex / dn : Math.cos(n.fase)
          const uy = dn > 1e-3 ? ey / dn : Math.sin(n.fase)
          x = cabX + ux * nd * u * 0.36
          y = cabY + uy * nd * u * 0.32
        }
      }
      // o buraco empurra as nuvens pra borda dele
      if (bur.o > 0) {
        const ex = (x - pcx) / bur.rx
        const ey = (y - pcy) / bur.ry
        const dn = Math.hypot(ex, ey)
        const alvo = 1 + (raio / Math.min(bur.rx, bur.ry)) * 0.5
        if (dn < alvo) {
          const nd = lerp(dn, alvo, bur.o)
          const ux = dn > 1e-3 ? ex / dn : Math.cos(n.fase)
          const uy = dn > 1e-3 ? ey / dn : Math.sin(n.fase)
          x = pcx + ux * nd * bur.rx
          y = pcy + uy * nd * bur.ry
        }
      }
      // a cortina: as da esquerda vão pra esquerda, as da direita pra direita, esticando (os satélites arrastam)
      let cortina = 0
      let lado = 1
      if (dissipa > 0) {
        if (resto > 0) continue
        lado = x < W / 2 ? -1 : 1
        cortina = entraQuad(dissipa)
        x += lado * cortina * W * (0.85 + 0.2 * Math.sin(n.fase))
        y += (y - H / 2) * cortina * 0.35
        raio *= 1 - 0.45 * dissipa
        estica = Math.max(estica, 0.55 * dissipa)
        dx = lado
        dy = 0
      }
      const camada = n.fundo ? FUNDO : FRENTE
      pôr(x, y, raio, 1, estica, dx, dy, camada)
      // os lobos giram em volta (sentidos alternados); na entrada, ficam pra trás (rabo)
      for (const [ang0, dist, rs, giro] of n.sat) {
        const an = ang0 + giro * t
        const atraso = sE < 1 ? (1 - eE) * 0.5 : 0
        let sxp = x + Math.cos(an) * raio * dist - dx * raio * atraso * 1.4
        const syp = y + Math.sin(an) * raio * dist - dy * raio * atraso * 1.4
        if (dissipa > 0) sxp -= lado * cortina * W * 0.14
        pôr(sxp, syp, raio * rs, 1, estica * 0.6, dx, dy, camada)
      }
      // as do alto se desfazem em pedaços menores (um a cada período) e terminam em fiapo
      if (n.periodo && chegou > 0 && dissipa <= 0) {
        const ciclo = (chegou + n.fase * 0.1) / n.periodo
        const c = Math.floor(ciclo)
        const f = ciclo - c
        const an = -Math.PI / 2 + Math.sin(c * 2.3 + n.fase) * 0.7
        const dist = raio * (0.8 + f * 1.1)
        pôr(x + Math.cos(an) * dist, y + Math.sin(an) * dist - f * u * 0.08, raio * 0.32 * (1 - f) * (f < 0.15 ? f / 0.15 : 1), 1, 0.2, Math.cos(an), Math.sin(an), camada)
      }
      if (n.rabo && dissipa <= 0) {
        let fx = x
        let fy = y - raio * 0.85
        let fa = -Math.PI / 2
        let fr = raio * 0.36 * clamp01(chegou * 3 + sE * 0.5)
        for (let m = 0; m < 6; m++) {
          fa += n.lado * 0.5 * Math.sin(t * 1.1 + m * 0.7 + n.fase) * 0.9
          fx += Math.cos(fa) * fr * 1.25
          fy += Math.sin(fa) * fr * 1.25
          fr *= 0.78
          pôr(fx, fy, fr, 1, 0.3, Math.cos(fa), Math.sin(fa), camada)
        }
        // o pedaço solto na ponta
        const solto = ((t * 0.8 + n.fase) % 1.4) / 1.4
        pôr(fx + Math.cos(fa) * fr * (2 + solto * 6), fy + Math.sin(fa) * fr * (2 + solto * 6) - solto * u * 0.05, fr * (1 - solto), 1, 0, 0, -1, camada)
      }
    }
    // o resto da fumaça no fundo do story (sobe e se desfaz)
    if (resto > 0) {
      for (let k = 0; k < 6; k++) {
        const x = W * (0.12 + 0.76 * ((k * 0.37) % 1))
        const y = H * (0.75 - 0.08 * (k % 3)) - resto * u * 0.4
        pôr(x, y, u * (0.09 + 0.03 * (k % 2)) * (1 - resto), 1, 0.2, 0, -1, FRENTE)
      }
    }

    /* ── épico: a cabeça (uma massa de fumaça numa cor só) ── */
    if (ro && t > ro.cabeca && dissipa <= 0) {
      // depois do sopro ela sobe atrás do prêmio e espia pelo canto de cima, à direita, ao lado do carimbo
      const espia = sm(ro.sopra + 0.2, ro.sopra + 0.7, t)
      const topoCartao = pcy - (prem.h / 2) * r.escala
      const cx2 = lerp(cabX, W / 2 + (prem.w / 2) * r.escala * 0.62, espia)
      cabY = lerp(cabY, topoCartao + u * 0.04, espia)
      const esc = lerp(1, 0.66, espia)
      const boch = sm(ro.bochecha, ro.bochecha + 0.15, t) * (1 - sm(ro.sopra + 0.1, ro.sopra + 0.35, t))
      const partes: [number, number, number, number][] = [
        [0, 0, 0.2, 0],
        [-0.13, 0.03, 0.15, 1],
        [0.13, 0.03, 0.15, 1],
        [0, -0.12, 0.14, 0],
        [-0.08, 0.12, 0.12, 1],
        [0.08, 0.12, 0.12, 1],
      ]
      partes.forEach(([px, py, pr, bochecha], k) => {
        // cada bolha sobe do pé da tela junto com a fumaça e se junta no lugar da cabeça
        const junta = saiCubica(clamp01((t - ro.cabeca - k * 0.035) / 0.42))
        const x = cx2 + px * u * esc + (1 - junta) * (px * u * 1.6)
        const y = lerp(H + u * 0.3, cabY + py * u * esc, junta)
        pôr(x, y, pr * u * esc * lerp(0.6, 1, junta) * (bochecha ? 1 + 0.12 * boch : 1), 1, bochecha ? 0.12 * boch : 0, 1, 0, CABECA)
      })
      q.cabecaApaga = espia
      this.cabecaX = cx2
    } else {
      q.cabecaApaga = 0
      this.cabecaX = cabX
    }
    q.nBlobs = nb

    /* ── paleta e as faixas psicodélicas ── */
    q.frente = this.palFrente
    q.fundo = this.palFundo
    q.cabeca = q.cabecaApaga > 0.5 ? this.palCabecaApagada : this.palCabeca
    // a fumaça "de verdade" (cinza) só nas baforadas; o sopro grande já vem na cor da raridade
    q.cinza = t < r.sopro - 0.05 ? 1 : 0
    q.iso = r.iso ? clamp01((q12(t) - r.iso.de) / 0.25) * (1 - dissipa) : 0
    q.isoFase = r.iso ? t * r.iso.vel : 0

    /* ── comum: o sorriso preguiçoso e o olho que pisca ── */
    q.sorriso[3] = 0
    const so = r.sorriso
    if (so && dissipa <= 0) {
      q.sorriso[0] = W / 2
      q.sorriso[1] = pcy - u * 0.02
      q.sorriso[2] = W * 0.28
      q.sorriso[3] = sm(so.abre, so.abre + 0.25, q12(t)) * (1 - sm(so.some, so.some + 0.15, t))
      const tp2 = t - so.pisca
      q.sorriso[4] = tp2 < 0 ? 0 : tp2 < 0.085 ? 1 : tp2 < 0.255 ? 2 : tp2 < 0.34 ? 1 : 0
    }

    /* ── raro: argolas → espiral → olho → pupila que vira o buraco do prêmio ── */
    q.nAneis = 0
    q.espiral[6] = 0
    q.iris[7] = 0
    const es = r.espiral
    if (es && dissipa <= 0) {
      const cx = W / 2
      const cy = pcy - u * 0.02
      es.aneis.forEach((ta, k) => {
        const a = t - ta
        if (a < 0 || t > es.gira + 0.25) return
        const an = q.aneis[q.nAneis++]
        const [ox, oy] = this.brasaEm(ta)
        // sai da brasa, sobe crescendo; depois se junta no meio (e fica de frente)
        const voa = saiCubica(clamp01(a / 0.75))
        const junta = entraSai(clamp01((t - es.junta) / (es.gira - es.junta)))
        const alvoX = cx + (k - 1) * u * 0.18
        const alvoY = cy - u * 0.32 + k * u * 0.04
        let x = lerp(ox, alvoX, voa)
        let y = lerp(oy - 0.02 * u, alvoY, voa) - Math.sin(Math.PI * voa) * u * 0.05
        let rx = lerp(0.03 * u, (0.15 + 0.03 * k) * u, voa)
        let ry = rx * 0.55
        x = lerp(x, cx, junta)
        y = lerp(y, cy, junta)
        rx = lerp(rx, u * (0.1 + 0.08 * k), junta)
        ry = lerp(ry, rx, junta)
        an.x = x
        an.y = y
        an.rx = rx
        an.ry = ry
        an.esp = lerp(0.012, 0.034, voa) * u
        an.vis = 1 - sm(es.gira - 0.05, es.gira + 0.2, t)
        an.atras = a < 0.17
      })
      if (t > es.gira - 0.1 && t < es.iris + 0.3) {
        q.espiral[0] = cx
        q.espiral[1] = cy
        q.espiral[2] = u * 0.3
        q.espiral[3] = 2.5
        q.espiral[4] = (t - es.gira) * ((120 * Math.PI) / 180) + 0.6
        q.espiral[5] = u * 0.034
        q.espiral[6] = sm(es.gira - 0.1, es.gira + 0.12, t) * (1 - sm(es.iris, es.iris + 0.22, t))
      }
      if (t > es.iris) {
        const iris = q.iris
        iris[0] = cx
        iris[1] = cy
        iris[2] = u * 0.42
        iris[3] = u * 0.27
        const tq = q12(t)
        // abre as pálpebras, pisca (4 quadros a 12 qps), a pupila dilata
        let abre = saiCubica(clamp01((tq - es.iris) / 0.22))
        const tp3 = tq - es.pisca
        if (tp3 >= 0 && tp3 < 0.34) abre = [0.5, 0, 0, 0.5][Math.min(3, Math.floor(tp3 * 12))]
        iris[4] = abre
        const dil = entraSai(clamp01((t - es.dilata) / (es.aro - es.dilata + 0.06)))
        iris[5] = lerp(u * 0.06, u * 0.3, dil)
        iris[6] = t > es.aro ? clamp01((t - es.aro) / 0.42) : 0
        if (t > es.aro) iris[5] = lerp(u * 0.3, Math.min(Math.max(prem.w, prem.h) * 0.52 * r.escala, W * 0.44), saiCubica(clamp01((t - es.aro) / 0.3)))
        iris[7] = t > es.aro + 0.42 ? 0 : 1
      }
    }

    /* ── épico: os olhos e a boca na cabeça ── */
    q.nOlhos = 0
    q.boca[3] = 0
    q.boca[4] = 0
    q.sobrancelha = 0
    if (ro && t > ro.olhosAbrem - 0.05 && dissipa <= 0) {
      const espia = sm(ro.sopra + 0.2, ro.sopra + 0.7, t)
      const esc = lerp(1, 0.66, espia)
      const cabXa = this.cabecaX
      const tq = q12(t)
      let abre = t < ro.olhosAbrem ? 0 : passa(clamp01((t - ro.olhosAbrem) / 0.3), 1.4) * 0.55
      // piscada olhando pra frente (0,2 s), a sobrancelha sobe
      const tb = tq - ro.olhaFrente
      if (tb >= 0 && tb < 0.25) {
        abre = [0.3, 0, 0, 0.3, 0.5][Math.min(4, Math.floor(tb * 20))]
        q.sobrancelha = 1
      }
      const olhar = t < ro.olhaEsq ? 0 : t < ro.olhaDir ? -1 : t < ro.olhaFrente ? 1 : 0
      const desde = t < ro.olhaDir ? ro.olhaEsq : t < ro.olhaFrente ? ro.olhaDir : ro.olhaFrente
      const ant = t < ro.olhaDir ? 0 : t < ro.olhaFrente ? -1 : 1
      const ox = lerp(ant, olhar, sm(desde, desde + 0.09, t))
      for (let k = 0; k < 2; k++) {
        const ol = q.olhos[q.nOlhos++]
        const sx = k ? 1 : -1
        ol.x = cabXa + sx * u * 0.11 * esc
        ol.y = cabY - u * 0.03 * esc
        ol.r = u * 0.078 * esc
        ol.prop = 0.82
        ol.ox = t < ro.olhaEsq ? 0 : ox
        ol.oy = 0.2
        // a piscadela lenta, espiando por cima do prêmio (o olho direito)
        const pl = t - ro.piscadela
        ol.abre = k && pl > 0 && pl < 0.5 ? abre * (1 - Math.sin((pl / 0.5) * Math.PI)) : abre
      }
      q.boca[0] = cabXa
      q.boca[1] = cabY + u * 0.1 * esc
      q.boca[2] = u * 0.12 * esc
      q.boca[3] = sm(ro.sorri, ro.sorri + 0.3, tq) * (1 - espia)
      q.boca[4] = sm(ro.bochecha, ro.bochecha + 0.08, tq) * (1 - espia)
      q.boca[5] = sm(ro.sopra, ro.sopra + 0.25, t)
    }

    /* ── lendário: o portal (túnel), os olhos da borda, as estrelas, o clarão ── */
    q.tunel[0] = 0
    q.estrelas = 0
    q.clarao = 0
    q.centro[0] = pcx
    q.centro[1] = pcy
    if (pt) {
      q.tunel[0] = sm(pt.abre, pt.abre + 0.8, t) * (1 - dissipa)
      q.tunel[1] = this.faseTunel.em(t)
      q.tunel[2] = t * 0.12
      q.tunel[3] = 1 - 0.45 * sm(pt.recua, pt.recua + 0.8, t)
      q.estrelas = sm(pt.abre + 0.2, pt.abre + 0.6, t) * (1 - dissipa)
      if (t > pt.clarao) q.clarao = t < pt.clarao + 1 / 12 ? 1 : (1 - sm(pt.clarao + 1 / 12, pt.clarao + 0.42, t)) * 0.9
      // os 8 olhos na borda: abrem em onda, olham pro meio, piscam juntos
      if (dissipa <= 0 && t > pt.olhos) {
        const tq = q12(t)
        for (const [a, k] of this.olhosPortal) {
          const ol = q.olhos[q.nOlhos++]
          ol.x = W / 2 + Math.cos(a) * W * 0.43
          ol.y = H / 2 + Math.sin(a) * H * 0.44
          ol.r = u * 0.082
          ol.prop = 0.6
          let abre = sm(pt.olhos + k * 0.07, pt.olhos + k * 0.07 + 0.16, tq)
          const tb = tq - pt.piscam
          if (tb >= 0 && tb < 0.25) abre = [0.5, 0, 0, 0.5][Math.min(3, Math.floor(tb * 16))]
          ol.abre = abre * (1 - sm(pt.recua, pt.recua + 0.4, t) * 0.0)
          const olham = sm(pt.olham, pt.olham + 0.1, t)
          const dx = pcx - ol.x
          const dy = pcy - ol.y
          const dl = Math.hypot(dx, dy) || 1
          ol.ox = lerp(Math.sin(t * 2 + k), dx / dl, olham)
          ol.oy = lerp(0, dy / dl, olham)
        }
      }
      // as gotas: a borda de cima da moldura derrete (esticam 0,15u, ponta redonda)
      const dr = clamp01((t - pt.derrete) / 0.8)
      if (dr > 0 && dissipa <= 0) {
        this.gotas.forEach((a, k) => {
          const bx0 = W / 2 + Math.cos(a) * W * 0.44 * 0.96
          const by0 = H / 2 + Math.sin(a) * H * 0.45 * 0.96
          const desce = saiCubica(clamp01(dr * 1.2 - k * 0.06)) * u * 0.18
          const rr = u * 0.042
          pôr(bx0, by0 + desce * 0.4, rr * 0.7, 1, 0.6, 0, 1, FRENTE)
          pôr(bx0, by0 + desce * 0.75, rr * 0.6, 1, 0.5, 0, 1, FRENTE)
          pôr(bx0, by0 + desce + rr * 0.6, rr, 1, 0.05, 0, 1, FRENTE)
        })
        q.nBlobs = nb
      }
    }

    /* ── o prêmio: o anel de brilho, os raios, o cartão e o carimbo ── */
    const info = this.cartao(t)
    d.cartaoX = info.x
    d.cartaoY = info.y
    d.cartaoEsc = info.esc
    d.cartaoAlfa = info.alfa
    d.cartaoAng = info.ang
    d.premioVisivel = info.alfa > 0.5
    const ex2 = info.esc
    const forcaHalo = sm(r.premio, r.premio + 0.35, t) * (1 - sm(0, 0.35, dissipa))
    // o anel em volta do cartão (elipse do tamanho dele, de 1 a 1,32×): fica no buraco da fumaça, nunca em cima do produto
    q.halo[0] = prem.x + info.x
    q.halo[1] = prem.y + info.y
    q.halo[2] = (prem.w / 2) * Math.max(0.2, ex2)
    q.halo[3] = (prem.h / 2) * Math.max(0.2, ex2)
    q.halo[4] = forcaHalo * (r.raridade === 'comum' ? 0.75 : 0.95)
    if (r.raios) {
      q.raios[0] = sm(r.raios.de, r.raios.de + 0.35, t) * (1 - sm(0, 0.3, dissipa))
      q.raios[1] = r.raios.n
      q.raios[2] = t * (r.raridade === 'lendario' ? 0.05 : 0.035)
      q.raios[3] = Math.max(prem.vw, prem.vh) * 0.5 * Math.max(0.2, ex2)
      q.raios[4] = Math.max(W, H)
    } else q.raios[0] = 0
    // o retângulo do texto (as partículas não nascem nele)
    q.texto[0] = prem.tx0
    q.texto[1] = prem.ty0
    q.texto[2] = prem.tx1
    q.texto[3] = prem.ty1
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

    /* ── tremida (lendário) e a batida do carimbo ── */
    d.palcoX = 0
    d.palcoY = 0
    if (r.tremida && t > r.tremida[0] && t < r.tremida[1] && dissipa <= 0) {
      const a = (1 - sm(r.tremida[0], r.tremida[1], t)) * 4
      d.palcoX += Math.sin(q.ferve * 2.1) * a
      d.palcoY += Math.cos(q.ferve * 1.7 + 1) * a
    }
    if (ts > 0 && ts < 0.25 && dissipa <= 0) {
      const a = (1 - ts / 0.25) * (forte ? 5 : 2.5)
      d.palcoX += Math.sin(ts * 90) * a
      d.palcoY += Math.cos(ts * 70) * a * 0.6
    }
  }

  /** O buraco do prêmio no tempo t: progresso e raios (px). */
  private buraco(t: number): { o: number; rx: number; ry: number } {
    const g = this.geo
    const r = this.rot
    const p = g.premio
    const rx = (p.w / 2) * r.escala + g.u * 0.1
    const ry = (p.h / 2) * r.escala + g.u * 0.08
    if (r.portal) {
      const pt = r.portal
      const abre = sm(pt.abre, pt.abre + 0.75, t)
      const recua = sm(pt.recua, pt.recua + 0.8, t)
      return { o: abre, rx: lerp(Math.max(rx, g.W * 0.44), rx * 1.12, recua), ry: lerp(Math.max(ry, g.H * 0.42), ry * 1.1, recua) }
    }
    if (r.espiral) {
      // o raro abre pela pupila: começa do tamanho dela e cresce até o cartão
      const s = saiCubica(clamp01((t - r.abre) / r.abreDur))
      return { o: clamp01((t - r.abre) / 0.08), rx: lerp(g.u * 0.25, rx, s), ry: lerp(g.u * 0.25, ry, s) }
    }
    return { o: saiCubica(clamp01((t - r.abre) / r.abreDur)), rx, ry }
  }

  /** O cartão do prêmio: deslocamento (px), escala, opacidade e giro. */
  private cartao(t: number): { x: number; y: number; esc: number; alfa: number; ang: number } {
    const r = this.rot
    const g = this.geo
    const E = r.escala
    if (t < r.premio) return { x: 0, y: 0, esc: 0, alfa: 0, ang: 0 }
    if (r.rosto) {
      // soprado da boca pra frente: sai pequeno da boca, passa do tamanho e assenta
      const s = clamp01((t - r.premio) / 0.42)
      const yb = this.q.boca[1] - g.premio.y
      return { x: 0, y: lerp(yb, 0, saiCubica(s)), esc: E * lerp(0.12, 1, passa(s, 1.9)), alfa: clamp01(s * 5), ang: lerp(-14, 0, saiCubica(s)) }
    }
    if (r.portal) {
      // desce pelo túnel (vem do fundo, em câmera lenta) girando de leve
      const tt = this.relogioPremio.em(t) - this.relogioPremio.em(r.premio)
      const s = clamp01(tt / 0.42)
      const e = 1 - Math.pow(1 - s, 2.4)
      return { x: 0, y: 0, esc: E * lerp(0.04, 1, s < 1 ? e * (1 + 0.05 * Math.sin(s * Math.PI)) : 1), alfa: clamp01(s * 4), ang: lerp(-30, 0, e) }
    }
    if (r.espiral) {
      // sai da pupila: cresce do meio do olho
      const s = clamp01((t - r.premio) / 0.38)
      return { x: 0, y: lerp(-g.u * 0.02, 0, s), esc: E * lerp(0.08, 1, passa(s, 1.5)), alfa: clamp01(s * 4), ang: 0 }
    }
    const s = clamp01((t - r.premio) / 0.34)
    return { x: 0, y: lerp(18, 0, saiCubica(s)), esc: E * lerp(0.55, 1, passa(s, 1.6)), alfa: clamp01(s * 4), ang: 0 }
  }
}

/** A cor de um prêmio em Uint32 (as partículas usam). */
export function corPx(hex: string): number {
  return px32(hex)
}

export { misturar }
