// A cena da fumaça como função do tempo: dado t (s desde o beck começar a subir) e a geometria do palco, preenche o
// quadro (quadro.ts) que o pintor em pixel pinta e o estado do cartão do prêmio no DOM. Sem estado escondido além das
// trilhas sorteadas na montagem (semente fixa): dá pra pular pra qualquer quadro (o toque que pula, o 0,25× do
// laboratório, o quadro parado do movimento reduzido) e sai sempre igual. Tudo em px de CSS do palco.
import { INFO_RARIDADE, type Raridade } from '../../../lib/raridade'
import { FRENTE, FUNDO, NB, NCAB, PASSO_BOLHA, PASSO_CAB, paleta, px32, misturar, quadroVazio, type Quadro } from './quadro'
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

/**
 * Um lóbulo de fumaça soprado: nasce em `te` na boca (ox, oy), voa até o alvo em `dur` desacelerando (o jato), crescendo
 * e girando rápido; depois sobe devagar, balança e continua rolando (os 3 calombos da borda giram com ele, e a luz e a
 * sombra mostram o giro). Os que se desfazem (td) perdem a opacidade em dither, encolhem e sobem mais rápido.
 */
interface Puff {
  /** 0 a baforada de uma puxada, 1 o jato do sopro, 2 a fumaça que a brasa solta no sopro, 3 o rabo do jato. */
  grupo: 0 | 1 | 2 | 3
  te: number
  dur: number
  /** A desaceleração do voo (1 − (1 − s)^pot). */
  pot: number
  ox: number
  oy: number
  tx: number
  ty: number
  dist: number
  /** Arco pro lado (px) no voo e a direção dele (perpendicular ao voo). */
  bow: number
  perpX: number
  perpY: number
  r0: number
  r1: number
  /** O giro: inicial (rad), a velocidade no voo e depois (rad/s). */
  rot0: number
  w0: number
  w1: number
  /** A amplitude dos calombos da borda (0 = redondo). */
  amp: number
  /** Depois de chegar: sobe (px/s), balança (px). */
  sobe: number
  bal: number
  fase: number
  camada: number
  /** Começa a se desfazer em td e some em dd s (td enorme = fica até o buraco ou a cortina). */
  td: number
  dd: number
  /** O do meio (o sorriso do comum mora nele; o buraco do prêmio abre nele). */
  meio: boolean
  /** No alto da massa (ou a cabeça da baforada): enrola caracóis que afinam em fiapo e solta pedaços. */
  topo: boolean
  lado: number
  ciclo: number
  /** A profundidade (px): quem fica na frente quando dois lóbulos se cruzam. */
  z: number
  /** Depois de chegar, roda em volta do lugar (raio, px) e quantos lóbulos pequenos rolam pela borda dele. */
  roda: number
  rola: number
  /** De onde os lóbulos que rolam nascem (× r do meio; vão até 0,78). */
  rolaD: number
  /** Subindo, quanto vai pro lado (× sobe; + direita) e quanto o caracol enrola no máximo (voltas × 2π ≈ 1,5). */
  deriva: number
  enrola: number
  /** Desfazendo, solta duas baforadinhas pra cima (pedaços menores que encolhem e somem em dither). */
  fiapo: boolean
  /** O véu (opacidade máxima, 1 = cheia) quando nasce e quando chega (as baforadas entre as puxadas: 0,4–0,7). */
  veu: number
  veuFim: number
}

/** O estado de um lóbulo agora (reaproveitado: nada alocado no quadro). */
interface PuffAgora {
  x: number
  y: number
  r: number
  giro: number
  alfa: number
  estica: number
  dx: number
  dy: number
  chegou: number
  veu: number
}

const NUNCA = 1e9

type PorLobulo = (x: number, y: number, raio: number, peso: number, estica: number, dx: number, dy: number, camada: number, giro?: number, amp?: number, alfa?: number, z?: number, cinza?: number, veu?: number) => void

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
  private puffs: Puff[] = []
  private agora: PuffAgora = { x: 0, y: 0, r: 0, giro: 0, alfa: 1, estica: 0, dx: 0, dy: -1, chegou: 0, veu: 1 }
  /** As baforadas entre as puxadas (a cabeça de cada uma solta os fiapos quando se desfaz). */
  private baforadas: { cabeca: Puff; lado: number }[] = []
  /** Onde está o lóbulo do meio agora (o sorriso do comum anda com ele). */
  private meioX = 0
  private meioY = 0
  private faseTunel: Integral
  private relogioPremio: Integral
  /** As cores da raridade e a da cara (as pálpebras e o contorno dos olhos e da boca do épico). */
  private palFrente
  private palFundo
  private palCabeca
  private olhosPortal: [number, number][] = []
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
    const P: Puff[] = []
    const novo = (p: Partial<Puff> & Pick<Puff, 'grupo' | 'te' | 'dur' | 'ox' | 'oy' | 'tx' | 'ty' | 'r0' | 'r1'>): Puff => {
      const dist = Math.hypot(p.tx - p.ox, p.ty - p.oy) || 1
      const pp: Puff = {
        pot: 2.4,
        bow: 0,
        rot0: rnd() * 6.28,
        w0: 2,
        w1: 0.6,
        amp: 0.12,
        sobe: u * 0.04,
        bal: u * 0.012,
        fase: rnd() * 6.28,
        camada: FRENTE,
        td: NUNCA,
        dd: 0.6,
        meio: false,
        topo: false,
        lado: 1,
        ciclo: 1.3,
        z: rnd() * u * 0.12,
        roda: 0,
        rola: 0,
        rolaD: 0.25,
        deriva: 0,
        enrola: 1.5,
        fiapo: false,
        veu: 1,
        veuFim: 1,
        ...p,
        dist,
        perpX: -(p.ty - p.oy) / dist,
        perpY: (p.tx - p.ox) / dist,
      }
      P.push(pp)
      return pp
    }

    // as baforadas entre as puxadas (crítica da 3ª rodada: eram pedras cinza nascendo do lado oposto da boca): quem fuma
    // solta pela boca, embaixo à esquerda, junto da piteira (de onde sai o jato grande do sopro). A fumaça sai em leque
    // do pé da tela, sobe passando por trás da piteira, abre e afina, enrola no alto e se desfaz em fiapos em ~0,6 s.
    // Semitransparente (véu de 40 a 70%, em dither), sem contorno; cinza (a fumaça "de verdade").
    this.baforadas = []
    {
      const P = g.pose
      const ap = (P.ang * Math.PI) / 180
      const pex = P.x - (Math.sin(ap) * P.L) / 2
      const pey = P.y + (Math.cos(ap) * P.L) / 2
      r.puxadas.forEach((p: Puxada, k) => {
        if (!p.baforada) return
        const lado = k % 2 ? -1 : 1
        const R = p.baforada * W
        const ox = Math.max(u * 0.04, pex - u * 0.05)
        const oy = H + u * 0.05
        const tx = pex + u * (0.1 + 0.025 * lado)
        const ty = pey - u * 0.17
        const dl = Math.hypot(tx - ox, ty - oy) || 1
        const qx = -(ty - oy) / dl
        const qy = (tx - ox) / dl
        const t0 = p.solta + 0.03
        let cabeca: Puff | null = null
        for (let m = 0; m < 6; m++) {
          // a cabeça (m = 0) vai mais longe e cresce mais; as de trás ficam no caminho, juntas (fundem numa massa só
          // que afina pra boca) e abertas pros lados (o leque)
          const ao = 1 - m * 0.1
          const abre = (m % 2 ? -1 : 1) * R * 0.22 * Math.min(1, m)
          const pf = novo({
            grupo: 0,
            te: t0 + m * 0.03,
            dur: 0.34,
            pot: 2.4,
            ox: ox + (m % 2 ? -1 : 1) * u * 0.01,
            oy,
            tx: lerp(ox, tx, ao) + qx * abre,
            ty: lerp(oy, ty, ao) + qy * abre,
            bow: lado * u * 0.03,
            r0: R * 0.3,
            r1: R * (1 - m * 0.1),
            w0: lado * 4,
            w1: lado * 1.4,
            amp: 0.1,
            sobe: u * 0.3,
            deriva: 0.25 * lado,
            lado,
            ciclo: 0.9,
            enrola: 0.9,
            camada: FUNDO,
            roda: u * 0.012,
            rola: m === 0 ? 2 : 0,
            rolaD: 0.4,
            // a boca parou de soltar: o rabo some primeiro
            td: t0 + 0.34 - m * 0.035,
            dd: 0.3,
            topo: m === 0,
            veu: 0.7 - m * 0.05,
            veuFim: 0.48 - m * 0.04,
            z: u * (0.1 - m * 0.015),
          })
          if (m === 0) cabeca = pf
        }
        if (cabeca) this.baforadas.push({ cabeca, lado })
      })
    }

    // o sopro: a baforada grande sai em JATO da boca (no pé da tela, embaixo da piteira), passa por cima do beck e
    // abre em leque até o alto; os lóbulos mais longe saem primeiro (a cabeça do jato) e voam mais rápido, os de perto
    // enchem atrás. Cada um chega girando rápido (o jato rola pra fora dos dois lados do eixo) e depois segue rolando.
    const ts = r.sopro
    const O = { x: W * 0.16, y: H + u * 0.16 }
    const eixo = { x: 0.3, y: -1 }
    const topoY = H * 0.26
    const pe = H * 0.97
    const linhas = Math.max(3, Math.round((pe - topoY) / (u * 0.29)) + 1)
    const porLinha = Math.max(2, Math.round(W / (u * 0.36)))
    const alvos: [number, number, number][] = []
    for (let j = 0; j < linhas; j++) {
      const y = lerp(pe, topoY, j / (linhas - 1))
      const nl = porLinha + (j % 2)
      for (let i = 0; i < nl; i++) alvos.push([W * ((i + (j % 2 ? 0 : 0.5)) / porLinha), y, j])
    }
    let dmax = 1
    for (const [x, y] of alvos) dmax = Math.max(dmax, Math.hypot(x - O.x, y - O.y))
    alvos.forEach(([x0, y0, j], k) => {
      const alto = j === linhas - 1
      const x = x0 + (rnd() - 0.5) * u * 0.1
      // o alto da massa é um morro de lóbulos de alturas diferentes (nada de linha reta)
      const y = y0 + (rnd() - 0.5) * u * (alto ? 0.22 : 0.08)
      const dist = Math.hypot(x - O.x, y - O.y)
      const fr = dist / dmax
      const lado = eixo.x * (y - O.y) - eixo.y * (x - O.x) > 0 ? 1 : -1
      const te = ts + 0.22 * (1 - fr) + rnd() * 0.04
      novo({
        grupo: 1,
        te,
        dur: 0.26 + 0.44 * fr,
        pot: 2.7,
        ox: O.x + (rnd() - 0.5) * u * 0.08,
        oy: O.y,
        tx: x,
        ty: y,
        bow: lado * (0.04 + 0.08 * rnd()) * u * fr,
        r0: u * 0.09,
        r1: u * (0.19 + 0.07 * rnd()) * (j === 0 ? 0.9 : 1),
        w0: lado * (3 + 2 * rnd()),
        w1: lado * (1.2 + 0.7 * rnd()),
        amp: 0.13 + 0.08 * rnd(),
        sobe: u * (0.03 + 0.025 * rnd()),
        bal: u * 0.014,
        camada: k % 4 === 2 ? FUNDO : FRENTE,
        roda: u * (0.08 + 0.04 * rnd()),
        rola: k % 2 ? 1 : 2,
        topo: alto,
        lado,
        ciclo: 1.2 + rnd() * 0.4,
      })
    })
    // o do meio (o sorriso do comum mora nele; o buraco do prêmio abre nele): grande, chega cedo e quase não anda
    novo({ grupo: 1, te: ts + 0.08, dur: 0.46, pot: 2.7, ox: O.x, oy: O.y, tx: W / 2, ty: g.premio.y, r0: u * 0.08, r1: u * 0.3, w0: 2.4, w1: 1.1, amp: 0.08, sobe: 0, bal: u * 0.008, meio: true, z: u * 0.2, roda: u * 0.035, rola: 3, rolaD: 0.72 })
    // a brasa no máximo solta a fumaça dela junto: uma coluna que sobe da ponta e se abre (o beck some dentro)
    const [ebx, eby] = this.brasaEm(ts)
    for (let m = 0; m < 5; m++) {
      const lado = m % 2 ? 1 : -1
      novo({
        grupo: 2,
        te: ts + 0.02 + m * 0.05,
        dur: 0.44,
        pot: 2,
        ox: ebx + (rnd() - 0.5) * u * 0.02,
        oy: eby,
        tx: ebx + u * (0.05 + (rnd() - 0.5) * 0.16),
        ty: eby - u * (0.2 + 0.1 * m),
        bow: lado * u * 0.04,
        r0: u * 0.03,
        r1: u * (0.1 + 0.025 * m),
        w0: lado * 5,
        w1: lado * 1,
        amp: 0.14,
        sobe: u * 0.05,
        topo: m === 4,
        lado,
        // nasce semitransparente (fumaça saindo da brasa, não uma pedra na ponta) e enche quando entra no jato
        veu: 0.55,
        veuFim: 1,
      })
    }
    // o rabo do jato: a boca continua soltando (cada vez menos) até o prêmio aparecer; o pé da massa nunca para
    const fimRabo = r.abre
    for (let te = ts + 0.32, k = 0; te < fimRabo; te += 0.15, k++) {
      const x = W * (0.08 + 0.84 * rnd())
      const y = H * (0.52 + 0.44 * rnd())
      const lado = x > O.x ? 1 : -1
      const dist = Math.hypot(x - O.x, y - O.y)
      novo({
        grupo: 3,
        te,
        dur: 0.36 + 0.24 * (dist / H),
        pot: 2.4,
        ox: O.x + (rnd() - 0.5) * u * 0.1,
        oy: O.y,
        tx: x,
        ty: y,
        bow: lado * u * 0.05,
        r0: u * 0.05,
        r1: u * (0.13 + 0.06 * rnd()),
        w0: lado * 4,
        w1: lado * 0.9,
        amp: 0.13,
        sobe: u * 0.06,
        td: te + 0.9 + 0.4 * rnd(),
        dd: 0.6,
        lado,
        rola: 1,
        roda: u * 0.05,
        fiapo: k % 2 === 0,
        camada: k % 3 === 1 ? FUNDO : FRENTE,
      })
    }
    this.puffs = P
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
    // o sopro: o beck fica no lugar e a baforada grande chega nele (o empurrão: gira uns graus e balança), até sumir
    // dentro da fumaça
    if (t > r.sopro + 0.12) {
      const s = sm(r.sopro + 0.12, r.sopro + 0.34, t)
      const volta = Math.sin(clamp01((t - r.sopro - 0.12) / 0.5) * Math.PI) * 0.4
      ang += 6 * s - 3 * volta
      x += s * g.u * 0.02
      y -= s * g.u * 0.015
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
    const ult = r.puxadas.length - 1
    r.puxadas.forEach((p, k) => {
      // a última desemboca no sopro: a brasa fica no máximo até a fumaça engolir o beck
      if (t < p.de - 0.01 || (k < ult && t > p.ate + 0.05)) return
      if (t < p.puxa) luz = lerp(0.2, 0.12, sm(p.de, p.puxa, t))
      else if (t < p.segura) luz = lerp(0.12, 1, Math.pow(clamp01((t - p.puxa) / (p.segura - p.puxa)), 1.6)) * p.forca + 0.12 * (1 - p.forca)
      else if (t < p.solta || k === ult) luz = (0.9 + 0.1 * Math.sin(q12(t) * 37)) * p.forca
      else luz = lerp(p.forca * 0.95, 0.2, saiCubica(clamp01((t - p.solta) / (p.ate - p.solta))))
    })
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
  calcular(t: number, dissipa = 0, resto = 0, tRosto = t): void {
    const g = this.geo
    const r = this.rot
    const q = this.q
    const d = this.dom
    const { W, H, u } = g
    q.t = t
    q.ferve = Math.floor(t * 12)
    q.alfa = resto > 0 ? 0.25 * (1 - sm(0.6, 1, resto)) + 0.0001 : 1
    // a borda ferve de leve (troca a 12 qps) e ondula devagar: os lóbulos é que dão a forma (nada de serrilhado)
    q.ondulado = u * 0.01
    q.fervura = 1.3
    const prem = g.premio
    const pcx = prem.x
    const pcy = prem.y

    /* ── beck ── */
    const bk = this.beckEm(t)
    this.aplicarBeck(bk, t)
    const e = q.beck
    // fica na tela até a fumaça engolir (cheio): nunca sai pelo pé
    e.vis = bk.y - bk.L * 0.6 < H && t < r.cheio && dissipa <= 0 && resto <= 0
    // no jogo, enquanto o pé ainda está dentro da câmara, a borda da frente da boca recorta
    const o = this.origem
    e.corte = o && !this.previa && t < 0.4 ? o.boca : null
    e.atras = t > r.sopro + 0.08
    const [bx, by] = this.brasaEm(t)
    // o brilho da brasa em volta: pulsa (mais forte e mais largo na puxada)
    const pulso = 1 + 0.08 * Math.sin(q12(t) * 19) + 0.05 * Math.sin(t * 7.3)
    q.brilhoBrasa[0] = bx
    q.brilhoBrasa[1] = by
    q.brilhoBrasa[2] = 0.092 * bk.L * (1.7 + 1.3 * e.luz) * pulso
    q.brilhoBrasa[3] = e.vis ? e.brasa * clamp01((e.luz - 0.15) / 0.85) : 0
    // engolida pela fumaça, a brasa no máximo ainda brilha através dela um instante
    q.brasaSobre[0] = bx
    q.brasaSobre[1] = by
    q.brasaSobre[2] = 0.092 * bk.L * 1.5 * pulso
    q.brasaSobre[3] = e.brasa > 0 && dissipa <= 0 ? sm(r.sopro + 0.16, r.sopro + 0.26, t) * (1 - sm(r.sopro + 0.32, r.cheio + 0.05, t)) : 0

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
        f.x = fx + (sAge > 0 ? sAge * u * 0.1 * (k % 2 ? -1 : 1) : 0)
        f.y = fy - (sAge > 0 ? sAge * u * 0.34 : 0) - 0.07 * bk.L
        f.comp = Lr * (0.35 + 0.65 * saiQuad(clamp01(idade / 0.7)))
        f.larg = 1
        f.fase = k * 2.1
        f.lado = k % 2 ? -1 : 1
        f.solta = sAge > 0 ? clamp01(sAge / 0.7) : 0
        f.inc = 0
        f.alfa = sAge > 0 ? 1 - sm(0.18, 0.55, sAge) : 1
        f.voltas = 1
      }
    }

    /* ── as nuvens: os lóbulos (baforadas, o jato do sopro, a fumaça da brasa, o rabo do jato) ── */
    const B = q.blobs
    let nb = 0
    // épico: com a cabeça inteira na frente, a fumaça que fica toda escondida atrás dela (o lóbulo e o alcance dele no
    // campo dentro de 0,85 R do meio) nem entra no quadro (o desenho não paga por ela)
    const ro0 = r.rosto
    const Rc = Math.min(W * 0.38, H * 0.3)
    const escondeR = ro0 && t > ro0.cabeca + 0.55 && t < ro0.sopra + 0.1 && dissipa <= 0 ? Rc * 0.85 : 0
    const escX = W / 2
    const escY = pcy - Rc * 0.12
    const pôr = (x: number, y: number, raio: number, peso: number, estica: number, dx: number, dy: number, camada: number, giro = 0, amp = 0, alfa = 1, z = 0, cinza = 0, veu = 1) => {
      if (nb >= NB || raio <= 0.5 || peso <= 0.001 || alfa <= 0.02) return
      if (escondeR > 0 && Math.hypot(x - escX, y - escY) + raio * (1 + estica) * 1.16 * (1 + amp) < escondeR) return
      const i = nb * PASSO_BOLHA
      B[i] = x
      B[i + 1] = y
      B[i + 2] = raio
      B[i + 3] = peso
      B[i + 4] = estica
      B[i + 5] = dx
      B[i + 6] = dy
      B[i + 7] = camada
      B[i + 8] = Math.cos(giro)
      B[i + 9] = Math.sin(giro)
      B[i + 10] = amp
      B[i + 11] = alfa
      B[i + 12] = z
      B[i + 13] = cinza
      B[i + 14] = veu
      nb++
    }
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
    // o épico: a cabeça fica por cima da fumaça (ela continua atrás, nada de buraco preto em volta)
    const ro = r.rosto
    const A = this.agora
    this.meioX = W / 2
    this.meioY = pcy
    for (let k = 0; k < this.puffs.length; k++) {
      const p = this.puffs[k]
      if (!this.puffEm(p, t, A)) continue
      if (p.grupo === 0 && dissipa > 0) continue
      let x = A.x
      let y = A.y
      let raio = A.r
      let estica = A.estica
      let dx = A.dx
      let dy = A.dy
      // moldura (lendário): pra fora da elipse do portal (o túnel é o fundo principal)
      if (moldura > 0 && p.grupo > 0) {
        // (crítica da 3ª rodada: o caleidoscópio ficou pequeno; a fumaça vai mais pra borda e afina)
        const ex = (x - W / 2) / (W * 0.46)
        const ey = (y - H / 2) / (H * 0.46)
        const dn = Math.hypot(ex, ey)
        if (dn < 1.22) {
          const nd = lerp(dn, 1.22, moldura)
          const ux = dn > 1e-3 ? ex / dn : Math.cos(p.fase)
          const uy = dn > 1e-3 ? ey / dn : Math.sin(p.fase)
          x = W / 2 + ux * nd * W * 0.46
          y = H / 2 + uy * nd * H * 0.46
        }
        raio *= 1 - 0.38 * moldura
      }
      if (p.meio) {
        this.meioX = x
        this.meioY = y
      }
      // o buraco empurra as nuvens pra borda dele
      if (bur.o > 0) {
        const ex = (x - pcx) / bur.rx
        const ey = (y - pcy) / bur.ry
        const dn = Math.hypot(ex, ey)
        const alvo = 1 + (raio / Math.min(bur.rx, bur.ry)) * 0.5
        if (dn < alvo) {
          const nd = lerp(dn, alvo, bur.o)
          const ux = dn > 1e-3 ? ex / dn : Math.cos(p.fase)
          const uy = dn > 1e-3 ? ey / dn : Math.sin(p.fase)
          x = pcx + ux * nd * bur.rx
          y = pcy + uy * nd * bur.ry
        }
      }
      // a cortina: as da esquerda vão pra esquerda, as da direita pra direita, esticando
      if (dissipa > 0) {
        if (resto > 0) continue
        const lado = x < W / 2 ? -1 : 1
        const cortina = entraQuad(dissipa)
        x += lado * cortina * W * (0.85 + 0.2 * Math.sin(p.fase))
        y += (y - H / 2) * cortina * 0.35
        raio *= 1 - 0.45 * dissipa
        estica = Math.max(estica, 0.55 * dissipa)
        dx = lado
        dy = 0
      }
      // a fumaça "de verdade" (cinza) é a das baforadas das puxadas; o sopro grande já vem na cor da raridade
      // (a fumaça que a brasa solta no sopro nasce cinza e vira a da raridade quando entra no jato)
      const cz = p.grupo === 0 ? 1 : p.grupo === 2 ? 1 - sm(p.te + 0.18, p.te + 0.5, t) : 0
      const veu = A.veu
      pôr(x, y, raio, 1, estica, dx, dy, p.camada, A.giro, p.amp, A.alfa, p.z, cz, veu)
      // os lóbulos que rolam em volta da borda (nascem pequenos, crescem, dão a volta por cima do lóbulo e somem nele)
      if (p.rola > 0 && raio > u * 0.05) {
        for (let m = 0; m < p.rola; m++) {
          const ciclo = 1.2 + 0.3 * m
          const c0 = (t - p.te) / ciclo + p.fase * 0.31 + m / p.rola
          const c = c0 - Math.floor(c0)
          const vida = Math.sin(Math.PI * c)
          const an = p.rot0 + (m * Math.PI * 2) / p.rola + p.lado * (1.9 + 0.4 * m) * (t - p.te)
          // nasce perto do meio e rola pra borda (passa por cima da cara do lóbulo)
          const d = raio * (p.rolaD + (0.78 - p.rolaD) * c)
          const rs = raio * (0.18 + 0.3 * vida)
          pôr(x + Math.cos(an) * d, y + Math.sin(an) * d * 0.9, rs, 1, 0, 0, -1, p.camada, 0, 0, A.alfa, p.z + raio * 0.42, cz, veu)
        }
      }
      // no alto da massa: o caracol que enrola subindo e afina em fiapo, e os pedaços que se soltam e se desfazem
      if (p.topo && A.chegou > 0 && dissipa <= 0 && moldura < 0.5) {
        this.caracol(p, x, y, raio, A.alfa, A.chegou, veu, pôr)
        if (p.grupo > 0) this.pedaco(p, x, y, raio, A.alfa, A.chegou, pôr)
      }
      // as que se desfazem soltam duas baforadinhas pra cima, que se afastam, encolhem e somem em dither (nada de glifo
      // solto: o fiapo fino fica só na brasa e nas baforadas)
      if (A.alfa < 0.8 && p.fiapo) {
        const k2 = 1 - A.alfa
        for (const sl of [-1, 1]) {
          const rr = Math.max(u * 0.03, raio * (0.42 - 0.18 * k2))
          pôr(x + sl * raio * (0.35 + 0.5 * k2), y - raio * (0.55 + 0.9 * k2) - (sl > 0 ? u * 0.02 : 0), rr, 1, 0.15, 0, -1, p.camada, p.fase + sl, 0.12, A.alfa * 0.85, p.z + u * 0.03, cz, Math.min(veu, 0.62 - 0.25 * k2))
        }
      }
    }
    // o resto da fumaça no fundo do story (sobe e se desfaz)
    if (resto > 0) {
      for (let k = 0; k < 6; k++) {
        const x = W * (0.12 + 0.76 * ((k * 0.37) % 1))
        const y = H * (0.75 - 0.08 * (k % 3)) - resto * u * 0.4
        pôr(x, y, u * (0.09 + 0.03 * (k % 2)) * (1 - resto), 1, 0.2, 0, -1, FRENTE, t * 1.4 + k, 0.14, 1 - resto * 0.6)
      }
    }

    /* ── épico: a cabeça de fumaça, os olhos e a boca ── */
    q.nCabeca = 0
    q.cabecaInfo[3] = 0
    q.nOlhos = 0
    q.boca[3] = 0
    q.boca[4] = 0
    q.sobrancelha = 0
    if (ro && tRosto > ro.cabeca && dissipa <= 0) this.rosto(tRosto, ro)
    q.nBlobs = nb

    /* ── paleta e as faixas psicodélicas ── */
    q.frente = this.palFrente
    q.fundo = this.palFundo
    q.cabeca = this.palCabeca
    q.iso = r.iso ? clamp01((q12(t) - r.iso.de) / 0.25) * (1 - dissipa) : 0
    q.isoFase = r.iso ? t * r.iso.vel : 0
    q.holo = r.holo ? sm(r.sopro, r.sopro + 0.3, t) * (1 - dissipa) : 0
    q.holoFase = t * 0.9

    /* ── comum: o sorriso preguiçoso e o olho que pisca ── */
    q.sorriso[3] = 0
    const so = r.sorriso
    if (so && dissipa <= 0) {
      // mora no lóbulo do meio e anda com ele
      q.sorriso[0] = this.meioX
      q.sorriso[1] = this.meioY - u * 0.02
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
        // a pupila passeia (olha pra um lado, pro outro, pra cima) até dilatar, em saltos de desenho (12 qps)
        const olha = clamp01((tq - es.iris - 0.2) / 0.05) * (1 - sm(es.dilata - 0.1, es.dilata, t))
        const salto = Math.floor((tq - es.iris) * 3)
        iris[8] = olha * u * 0.05 * [0, -1, 1, 0.6, -0.8, 0][((salto % 6) + 6) % 6]
        iris[9] = olha * u * 0.025 * [0, 0.3, -0.2, -1, 0.4, 0][((salto % 6) + 6) % 6]
        iris[6] = t > es.aro ? clamp01((t - es.aro) / 0.42) : 0
        if (t > es.aro) iris[5] = lerp(u * 0.3, Math.min(Math.max(prem.w, prem.h) * 0.52 * r.escala, W * 0.44), saiCubica(clamp01((t - es.aro) / 0.3)))
        iris[7] = t > es.aro + 0.42 ? 0 : 1
      }
    }

    /* ── lendário: o portal (túnel), os olhos da borda, as estrelas, o clarão ── */
    q.tunel[0] = 0
    q.estrelas = 0
    q.clarao = 0
    q.centro[0] = pcx
    q.centro[1] = pcy
    if (pt) {
      // na saída pro story o túnel apaga primeiro (em ~0,1 s, antes de o story começar a aparecer por baixo): o texto do
      // story nunca fica em cima do caleidoscópio
      q.tunel[0] = sm(pt.abre, pt.abre + 0.8, t) * (1 - sm(0, 0.16, dissipa))
      q.tunel[1] = this.faseTunel.em(t)
      q.tunel[2] = t * 0.12
      // no auge o túnel escurece só um pouco (o cartão tem fundo próprio: o caleidoscópio continua vivo atrás)
      q.tunel[3] = 1 - 0.2 * sm(pt.recua, pt.recua + 0.8, t)
      q.estrelas = sm(pt.abre + 0.2, pt.abre + 0.6, t) * (1 - sm(0, 0.16, dissipa))
      if (t > pt.clarao) q.clarao = t < pt.clarao + 1 / 12 ? 1 : (1 - sm(pt.clarao + 1 / 12, pt.clarao + 0.42, t)) * 0.9
      // os 8 olhos na borda: abrem em onda, olham pro meio, piscam juntos
      if (dissipa <= 0 && t > pt.olhos) {
        const tq = q12(t)
        for (const [a, k] of this.olhosPortal) {
          const ol = q.olhos[q.nOlhos++]
          ol.x = W / 2 + Math.cos(a) * W * 0.45
          ol.y = H / 2 + Math.sin(a) * H * 0.455
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
          const bx0 = W / 2 + Math.cos(a) * W * 0.46 * 0.98
          const by0 = H / 2 + Math.sin(a) * H * 0.46 * 0.98
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
    const forcaHalo = sm(r.premio, r.premio + 0.35, t) * (1 - sm(0, 0.16, dissipa))
    // o anel em volta do cartão (elipse do tamanho dele, de 1 a 1,32×): fica no buraco da fumaça, nunca em cima do produto
    q.halo[0] = prem.x + info.x
    q.halo[1] = prem.y + info.y
    q.halo[2] = (prem.w / 2) * Math.max(0.2, ex2)
    q.halo[3] = (prem.h / 2) * Math.max(0.2, ex2)
    q.halo[4] = forcaHalo * (r.raridade === 'comum' ? 0.75 : 0.95)
    if (r.raios) {
      q.raios[0] = sm(r.raios.de, r.raios.de + 0.35, t) * (1 - sm(0, 0.16, dissipa))
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

  /* ───────────── o rosto do épico ───────────── */

  /**
   * A cabeça de fumaça do épico (crítica da 3ª rodada: virou uma gota rosa num buraco preto): redonda e macia, com mais
   * de 70% da largura do quadro no celular, montada com 13 lóbulos nas cores das faixas psicodélicas (a cara cor-de-rosa
   * no meio, testa, lados, bochechas e queixo em volta) que vêm da fumaça e se juntam passando um pouco do ponto;
   * respira (sobe e desce, estica e encolhe). Os olhos têm 1/4 da largura da cabeça (pálpebra pesada, pupila em espiral);
   * o sorriso abre de uma vez (lê em 1 quadro), as bochechas sobem e coram, uma piscadela; as bochechas enchem
   * (a cabeça alarga), os olhos apertam, a boca vira um "o" no meio; sopra: as bochechas murcham, a boca abre e o
   * prêmio sai dela; a cabeça recua e se desfaz na fumaça (nada fica espiando no auge).
   */
  private rosto(t0: number, ro: NonNullable<Roteiro['rosto']>) {
    const g = this.geo
    const q = this.q
    // a cabeça anda a 30 qps (desenho animado; o cálculo dela por célula fica pela metade)
    const t = Math.floor(t0 * 30) / 30
    const R = Math.min(g.W * 0.38, g.H * 0.3)
    const tq = q12(t)
    // respira; o sorriso sobe as bochechas; enche (alarga); sopra (recua) e se desfaz
    const sorriso = ro.sorri <= t ? passa(clamp01((t - ro.sorri) / 0.12), 1.2) : 0
    const enche = sm(ro.bochecha, ro.bochecha + 0.16, t) * (1 - sm(ro.sopra, ro.sopra + 0.1, t))
    const recua = sm(ro.sopra, ro.sopra + 0.18, t)
    const desfaz = sm(ro.sopra + 0.12, ro.sopra + 0.62, t)
    if (desfaz >= 0.999) return
    const resp = Math.sin((t - ro.cabeca) * 3.4)
    const sx = (1 + 0.025 * resp + 0.08 * enche) * (1 - 0.07 * recua)
    const sy = (1 - 0.025 * resp - 0.05 * enche) * (1 - 0.07 * recua)
    const cx = g.W / 2
    const cy = g.premio.y - R * 0.12 + Math.sin((t - ro.cabeca) * 1.9) * R * 0.025 - recua * R * 0.04
    // os lóbulos: x, y, raio (× R), cor (0 rosa, 1 laranja, 2 violeta, 3 azul, 4 amarelo), profundidade (× R)
    const L = q.cabecaLobos
    let n = 0
    const lobos = LOBOS_CABECA
    for (let k = 0; k < lobos.length && n < NCAB; k++) {
      const [lx, ly, lr, cor, lz, papel] = lobos[k]
      // vem de fora (de baixo e dos lados, da fumaça) e se junta passando do ponto; a cara (papel 2) enche no meio
      // depois que a volta já juntou (não voa: incha no lugar, passando do ponto)
      const cara = papel === 2
      const s = cara ? clamp01((t - ro.cabeca - 0.2) / 0.36) : clamp01((t - ro.cabeca - (k - 1) * 0.03) / 0.46)
      const junta = s < 1 ? passa(s, cara ? 1.8 : 1.3) : 1
      let x = lx
      let y = ly
      let rr = lr
      // a respiração de cada lóbulo (cada um no seu tempo: a massa nunca para)
      x += 0.018 * Math.sin(t * 2.3 + k * 1.7)
      y += 0.018 * Math.cos(t * 2.1 + k * 2.3)
      rr *= 1 + 0.03 * Math.sin(t * 2.7 + k)
      let zz = lz
      if (papel === 1) {
        // bochecha: sobe com o sorriso; enche (cresce, vai pro lado e pra frente da cara)
        y -= 0.08 * sorriso * (1 - enche)
        rr *= 1 + 0.5 * enche
        x *= 1 + 0.2 * enche
        zz += 0.45 * enche
      }
      // desfaz: cada lóbulo vai pra fora (pra fumaça) e encolhe
      const ang = Math.atan2(ly + 0.1, lx + 1e-3)
      x += Math.cos(ang) * desfaz * (0.8 + 0.2 * (k % 3))
      y += Math.sin(ang) * desfaz * (0.8 + 0.2 * (k % 3)) - desfaz * 0.3
      rr *= 1 - 0.35 * desfaz
      const ox = cara ? lx : lx * 2.4
      const oy = cara ? ly : ly * 1.4 + 1.6
      const o = n * PASSO_CAB
      L[o] = cx + lerp(ox, x, junta) * R * sx
      L[o + 1] = cy + lerp(oy, y, junta) * R * sy
      L[o + 2] = rr * R * lerp(cara ? 0.25 : 0.45, 1, Math.min(1.08, junta)) * (papel === 1 ? 1 : (sx + sy) / 2)
      L[o + 3] = cor
      L[o + 4] = zz * R
      L[o + 5] = (1 - desfaz) * clamp01(s * 4)
      n++
    }
    q.nCabeca = n
    q.cabecaInfo[0] = cx
    q.cabecaInfo[1] = cy
    q.cabecaInfo[2] = R
    q.cabecaInfo[3] = Math.max(sorriso * 0.75, enche) * (1 - desfaz)
    q.cabecaInfo[4] = R * 0.17 * (1 + 0.3 * enche)
    // os olhos e a boca só enquanto a cabeça está inteira
    const inteira = clamp01((t - ro.cabeca - 0.3) / 0.12) * (1 - sm(ro.sopra + 0.1, ro.sopra + 0.25, t))
    if (inteira <= 0.5 || t < ro.olhosAbrem - 0.05) return
    // os olhos: pálpebra pesada, abrem passando do ponto; piscam olhando pra frente; apertam no sorriso e quando enche
    let abre = t < ro.olhosAbrem ? 0 : passa(clamp01((t - ro.olhosAbrem) / 0.3), 1.4) * 0.58
    const tb = tq - ro.olhaFrente
    if (tb >= 0 && tb < 0.25) {
      abre = [0.3, 0, 0, 0.3, 0.5][Math.min(4, Math.floor(tb * 20))]
      q.sobrancelha = 1
    }
    abre *= 1 - 0.32 * sorriso * (1 - enche)
    abre = lerp(abre, 0.12, enche)
    // soprando: arregala
    if (t > ro.sopra) abre = lerp(abre, 0.9, sm(ro.sopra, ro.sopra + 0.06, t))
    const olhar = t < ro.olhaEsq ? 0 : t < ro.olhaDir ? -1 : t < ro.olhaFrente ? 1 : 0
    const desde = t < ro.olhaDir ? ro.olhaEsq : t < ro.olhaFrente ? ro.olhaDir : ro.olhaFrente
    const ant = t < ro.olhaDir ? 0 : t < ro.olhaFrente ? -1 : 1
    const ox = lerp(ant, olhar, sm(desde, desde + 0.09, t))
    for (let k = 0; k < 2; k++) {
      const ol = q.olhos[q.nOlhos++]
      const lado = k ? 1 : -1
      ol.x = cx + lado * R * 0.38 * sx
      ol.y = cy - R * (0.12 + 0.05 * sorriso * (1 - enche)) * sy
      ol.r = R * 0.25 * sx
      ol.prop = 0.8
      ol.ox = t < ro.olhaEsq ? 0 : ox
      ol.oy = 0.2
      // a piscadela (o olho direito), no meio do sorriso
      const pl = t - ro.piscadela
      ol.abre = k && pl > 0 && pl < 0.34 ? abre * (pl < 0.08 || pl > 0.26 ? 0.4 : 0) : abre
    }
    // a boca: o sorrisão (abre de uma vez), o "o" quando enche, a boca aberta soprando
    q.boca[0] = cx
    q.boca[1] = cy + R * 0.42 * sy
    q.boca[2] = R * 0.48 * sx
    q.boca[3] = Math.min(1, sorriso) * (1 - enche)
    q.boca[4] = enche > 0.3 || t > ro.sopra ? 1 : 0
    q.boca[5] = sm(ro.sopra, ro.sopra + 0.12, t)
  }

  /* ───────────── os lóbulos ───────────── */

  /** Onde está o lóbulo no tempo t (falso: ainda não nasceu ou já se desfez). */
  private puffEm(p: Puff, t: number, o: PuffAgora): boolean {
    const a = t - p.te
    if (a < 0) return false
    const alfa = p.td < NUNCA ? 1 - sm(p.td, p.td + p.dd, t) : 1
    if (alfa <= 0.1) return false
    const s = clamp01(a / p.dur)
    const E = 1 - Math.pow(1 - s, p.pot)
    const arco = Math.sin(Math.PI * E) * p.bow
    let x = lerp(p.ox, p.tx, E) + p.perpX * arco
    let y = lerp(p.oy, p.ty, E) + p.perpY * arco
    const pos = Math.max(0, a - p.dur)
    const some = 1 - alfa
    // depois de chegar: o empuxo (sobe), o balanço; desfazendo, sobe mais rápido
    const solto = clamp01(pos * 2)
    const subiu = pos * p.sobe + some * some * p.sobe * 1.4
    y -= subiu
    x += subiu * p.deriva
    x += Math.sin(t * 0.9 + p.fase) * p.bal * solto
    y += Math.cos(t * 0.7 + p.fase * 1.3) * p.bal * 0.6 * solto
    // a convecção: depois de chegar, cada lóbulo grande roda devagar em volta do lugar dele (a massa nunca para)
    if (p.roda > 0) {
      const an = p.fase + p.lado * (1.8 + 0.4 * Math.sin(p.fase)) * pos
      x += (Math.cos(an) - Math.cos(p.fase)) * p.roda * solto
      y += (Math.sin(an) - Math.sin(p.fase)) * p.roda * 0.8 * solto
    }
    const cresce = 1 - (1 - s) * (1 - s)
    o.r = lerp(p.r0, p.r1, cresce) * (1 + 0.05 * Math.sin(t * 1.6 + p.fase)) * (1 - 0.62 * some)
    // gira rápido no voo (o jato rola) e continua rolando depois
    o.giro = p.rot0 + p.w1 * a + (p.w0 - p.w1) * 0.45 * (1 - Math.exp(-a / 0.45))
    // estica no sentido do voo enquanto voa rápido
    const vel = s < 1 ? (p.pot * Math.pow(1 - s, p.pot - 1) * p.dist) / p.dur : 0
    // (as baforadas esticam mais: o rabo vira um cometa ligado à cabeça)
    const est = p.grupo === 0 ? Math.min(0.6, (vel / this.geo.u) * 0.14) : Math.min(0.32, (vel / this.geo.u) * 0.07)
    if (some > 0.05 && est < 0.2) {
      // desfazendo: estica pra cima e afina (vira fiapo), em vez de virar um xadrez de dither
      o.estica = Math.min(0.6, some * 0.75)
      o.dx = p.deriva * 0.3
      o.dy = -1
    } else if (est < 0.05) {
      o.estica = 0
      o.dx = 0
      o.dy = -1
    } else {
      o.estica = est
      o.dx = (p.tx - p.ox) / p.dist
      o.dy = (p.ty - p.oy) / p.dist
    }
    o.x = x
    o.y = y
    o.alfa = alfa
    o.chegou = pos
    o.veu = p.veu < 1 ? lerp(p.veu, p.veuFim, cresce) : 1
    return true
  }

  /**
   * O caracol no alto de um lóbulo: nasce na borda de cima, cresce pra fora numa corrente de lóbulos que vão afinando
   * (nunca menores que 0,03u: nada de glifo de 1 célula), enrola cada vez mais enquanto sobe e a ponta se desfaz em
   * dither; no fim do ciclo a corrente sobe solta e some, e nasce outro do outro lado.
   */
  private caracol(p: Puff, x: number, y: number, raio: number, alfa: number, chegou: number, veu: number, pôr: PorLobulo) {
    const u = this.geo.u
    const P = p.ciclo
    const c0 = chegou + p.fase * 0.37
    const k = Math.floor(c0 / P)
    const c = (c0 - k * P) / P
    const cresce = sm(0, 0.36, c)
    const enrola = 0.35 + (p.enrola - 0.35) * sm(0.04, 0.9, c)
    const some = sm(0.66, 1, c)
    const lado = (k % 2 ? -1 : 1) * p.lado
    const phi = -Math.PI / 2 + lado * (0.5 + 0.25 * Math.sin(k * 1.9 + p.fase))
    let fx = x + Math.cos(phi) * raio * 0.8
    let fy = y + Math.sin(phi) * raio * 0.8 - some * u * 0.08
    let fa = phi - lado * 0.35
    let rr = raio * 0.36
    const rMin = u * 0.03
    const n = 4
    for (let m = 0; m < n; m++) {
      if (m / n > cresce) break
      fa += lado * enrola * (0.3 + m * 0.13)
      const passo = rr * 1.05
      fx += Math.cos(fa) * passo
      fy += Math.sin(fa) * passo
      rr = Math.max(rMin, rr * 0.84)
      // a ponta afina em dither (cada elo mais transparente) e o ciclo termina sumindo
      const a = alfa * (1 - m * 0.13) * (1 - some * (0.6 + m * 0.08))
      pôr(fx, fy, rr, 1, 0.2, Math.cos(fa), Math.sin(fa), p.camada, fa * 2, 0, a, p.z + u * (0.05 + m * 0.01), p.grupo === 0 ? 1 : 0, veu)
    }
  }

  /**
   * Um pedaço que se solta do alto do lóbulo, sobe e encolhe; no meio do caminho se parte em duas baforadinhas que se
   * afastam, encolhem e somem em dither (nunca menores que 0,03u).
   */
  private pedaco(p: Puff, x: number, y: number, raio: number, alfa: number, chegou: number, pôr: PorLobulo) {
    const u = this.geo.u
    const P = 0.9
    const c0 = chegou + p.fase * 0.53 + 0.4
    const k = Math.floor(c0 / P)
    const c = (c0 - k * P) / P
    const lado = (k % 2 ? 1 : -1) * p.lado
    const phi = -Math.PI / 2 - lado * (0.15 + 0.3 * Math.abs(Math.sin(k * 2.3 + p.fase)))
    const d = raio * (0.85 + c * 0.8)
    const px = x + Math.cos(phi) * d + lado * c * u * 0.03
    const py = y + Math.sin(phi) * d - c * u * 0.1
    const cz = p.grupo === 0 ? 1 : 0
    const rMin = u * 0.03
    if (c < 0.45) {
      const rr = Math.max(rMin, u * 0.07 * sm(0, 0.12, c) * (1 - 0.4 * c))
      // (semitransparente: um pedaço de fumaça, não uma pedrinha de contorno fechado)
      if (c > 0.04) pôr(px, py, rr, 1, 0.12, 0, -1, p.camada, c * 5 * lado, 0.16, alfa * (1 - 0.3 * sm(0.25, 0.45, c)), p.z + u * 0.06, cz, 0.72 - 0.3 * c)
      return
    }
    const s2 = (c - 0.45) / 0.55
    for (const sl of [-1, 1]) {
      const rr = Math.max(rMin, u * 0.05 * (1 - 0.45 * s2))
      const a = alfa * 0.75 * (1 - sm(0.2, 1, s2))
      pôr(px + sl * u * (0.02 + 0.05 * s2), py - s2 * u * (0.04 + (sl > 0 ? 0.02 : 0)), rr, 1, 0.15, 0, -1, p.camada, c * 5 * sl, 0.14, a, p.z + u * 0.06, cz, 0.58 - 0.25 * s2)
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
      // (a boca da cabeça: 0,3 R abaixo do meio do cartão; ver rosto())
      const yb = Math.min(g.W * 0.38, g.H * 0.3) * 0.3
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

/**
 * Os lóbulos da cabeça do épico: x, y, raio (× R), cor (0 rosa, 1 laranja, 2 violeta, 3 azul, 4 amarelo), profundidade
 * (× R: a cara fica por cima) e o papel (1 = bochecha, 2 = a cara).
 */
const LOBOS_CABECA: [number, number, number, number, number, number][] = [
  [0, 0.05, 0.8, 0, 0.5, 2],
  [-0.52, -0.56, 0.52, 2, 0.12, 0],
  [0.1, -0.76, 0.44, 3, 0.06, 0],
  [0.62, -0.44, 0.48, 1, 0.1, 0],
  [-0.12, -1.08, 0.2, 4, 0, 0],
  [-0.8, 0.14, 0.38, 4, 0.02, 0],
  [0.82, 0.2, 0.36, 3, 0.02, 0],
  [-0.58, 0.42, 0.34, 0, 0.3, 1],
  [0.58, 0.42, 0.34, 0, 0.3, 1],
  [0, 0.86, 0.4, 2, 0.15, 0],
]

/** A cor de um prêmio em Uint32 (as partículas usam). */
export function corPx(hex: string): number {
  return px32(hex)
}

export { misturar }
