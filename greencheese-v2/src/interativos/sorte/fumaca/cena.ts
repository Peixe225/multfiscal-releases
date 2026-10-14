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
  /** Desfazendo, solta um fiapo pra cima. */
  fiapo: boolean
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
}

const NUNCA = 1e9

type PorLobulo = (x: number, y: number, raio: number, peso: number, estica: number, dx: number, dy: number, camada: number, giro?: number, amp?: number, alfa?: number, z?: number, cinza?: number) => void
type PorFiapo = (x: number, y: number, comp: number, inc: number, alfa: number, lado: number, fase: number) => void

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
  private agora: PuffAgora = { x: 0, y: 0, r: 0, giro: 0, alfa: 1, estica: 0, dx: 0, dy: -1, chegou: 0 }
  /** Onde está o lóbulo do meio agora (o sorriso do comum anda com ele). */
  private meioX = 0
  private meioY = 0
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
        ...p,
        dist,
        perpX: -(p.ty - p.oy) / dist,
        perpY: (p.tx - p.ox) / dist,
      }
      P.push(pp)
      return pp
    }

    // as baforadas pequenas depois das puxadas: quem fuma solta pelo canto da boca, então entram pelo pé da tela no canto
    // vazio (embaixo à direita, longe da cinza que cai da ponta): a cabeça vem na frente e cresce num cacho de lóbulos que
    // rolam e enrola na ponta; o rastro são lóbulos menores no MESMO caminho, atrasados (um rabo ligado, nada de
    // pedrinhas), que alcançam a cabeça quando ela freia. Sobem girando e se desfazem em dither e fiapos, o rabo primeiro.
    // Fumaça "de verdade": cinza
    r.puxadas.forEach((p: Puxada, k) => {
      if (!p.baforada) return
      const lado = k % 2 ? -1 : 1
      const R = p.baforada * W
      const ox = W * (0.88 - 0.03 * (k % 2))
      const oy = H + u * 0.1
      const tx = W * (0.8 - 0.02 * (k % 2))
      const ty = H * (0.62 - 0.04 * (k % 2))
      const dl = Math.hypot(tx - ox, ty - oy)
      const px = -(ty - oy) / dl
      const py = (tx - ox) / dl
      const t0 = p.solta + 0.03
      const base = { grupo: 0 as const, dur: 0.52, pot: 2.6, ox, oy, bow: lado * u * 0.05, w1: lado * 1.8, amp: 0.08, sobe: u * 0.13, deriva: 0.35, lado, ciclo: 1.1, enrola: 0.75, camada: FUNDO }
      // a cabeça: o lóbulo da frente e dois do lado, que se abrem quando ela freia
      for (let m = 0; m < 3; m++) {
        const abre = (m - 1) * R * 0.7
        novo({
          ...base,
          te: t0 + Math.abs(m - 1) * 0.03,
          tx: tx + px * abre,
          ty: ty + py * abre + (m === 1 ? -R * 0.25 : 0),
          r0: R * 0.4,
          r1: R * (m === 1 ? 1.05 : 0.78),
          w0: lado * 6,
          roda: u * 0.02,
          rola: 3,
          rolaD: 0.4,
          td: t0 + 0.56,
          dd: 0.5,
          fiapo: m !== 1,
          z: m === 1 ? u * 0.12 : u * 0.08,
        })
      }
      // o rabo: no caminho da cabeça, atrasado; some primeiro (a boca parou de soltar)
      for (let m = 1; m <= 4; m++) {
        novo({
          ...base,
          te: t0 + m * 0.03,
          tx,
          ty: ty + R * 0.3,
          r0: R * (0.42 - m * 0.05),
          r1: R * (0.8 - m * 0.12),
          w0: lado * 4,
          td: t0 + 0.2 + m * 0.06,
          dd: 0.42,
          z: u * (0.06 - m * 0.01),
        })
      }
    })

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
        rola: 2,
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
  calcular(t: number, dissipa = 0, resto = 0): void {
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
        f.x = fx
        f.y = fy - (sAge > 0 ? sAge * u * 0.18 : 0) - 0.07 * bk.L
        f.comp = Lr * (0.35 + 0.65 * saiQuad(clamp01(idade / 0.7)))
        f.larg = 1.05
        f.fase = k * 2.1
        f.lado = k % 2 ? -1 : 1
        f.solta = sAge > 0 ? clamp01(sAge / 0.7) : 0
        f.inc = 0
        f.alfa = 1
        f.voltas = 2
      }
    }

    /* ── as nuvens: os lóbulos (baforadas, o jato do sopro, a fumaça da brasa, o rabo do jato) ── */
    const B = q.blobs
    let nb = 0
    const pôr = (x: number, y: number, raio: number, peso: number, estica: number, dx: number, dy: number, camada: number, giro = 0, amp = 0, alfa = 1, z = 0, cinza = 0) => {
      if (nb >= NB || raio <= 0.5 || peso <= 0.001 || alfa <= 0.02) return
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
      nb++
    }
    // os fiapos que se soltam (das pontas dos caracóis e dos pedaços que se desfazem)
    const fiapo = (x: number, y: number, comp: number, inc: number, alfa: number, lado: number, fase: number) => {
      if (q.nFitas >= q.fitas.length || comp < 4 || alfa <= 0.05) return
      const f = q.fitas[q.nFitas++]
      f.x = x
      f.y = y
      f.comp = comp
      f.larg = 0.9
      f.fase = fase
      f.lado = lado
      f.solta = 0
      f.inc = inc
      f.alfa = alfa
      f.voltas = 1
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
    // o épico: as outras nuvens saem de perto da cabeça
    const ro = r.rosto
    const cabX = W / 2
    let cabY = pcy - u * 0.12
    const longeDaCabeca = ro ? sm(ro.cabeca - 0.1, ro.cabeca + 0.3, t) * (1 - sm(ro.sopra + 0.1, ro.sopra + 0.5, t)) : 0
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
        const ex = (x - W / 2) / (W * 0.44)
        const ey = (y - H / 2) / (H * 0.45)
        const dn = Math.hypot(ex, ey)
        if (dn < 1.12) {
          const nd = lerp(dn, 1.12, moldura)
          const ux = dn > 1e-3 ? ex / dn : Math.cos(p.fase)
          const uy = dn > 1e-3 ? ey / dn : Math.sin(p.fase)
          x = W / 2 + ux * nd * W * 0.44
          y = H / 2 + uy * nd * H * 0.45
        }
        raio *= 1 - 0.25 * moldura
      }
      // longe da cabeça (épico)
      if (longeDaCabeca > 0 && p.grupo > 0) {
        const ex = (x - cabX) / (u * 0.36)
        const ey = (y - cabY) / (u * 0.32)
        const dn = Math.hypot(ex, ey)
        const alvo = 1 + (raio / (u * 0.34)) * 0.7
        if (dn < alvo) {
          const nd = lerp(dn, alvo, longeDaCabeca)
          const ux = dn > 1e-3 ? ex / dn : Math.cos(p.fase)
          const uy = dn > 1e-3 ? ey / dn : Math.sin(p.fase)
          x = cabX + ux * nd * u * 0.36
          y = cabY + uy * nd * u * 0.32
        }
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
      const cz = p.grupo === 0 ? 1 : 0
      pôr(x, y, raio, 1, estica, dx, dy, p.camada, A.giro, p.amp, A.alfa, p.z, cz)
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
          pôr(x + Math.cos(an) * d, y + Math.sin(an) * d * 0.9, rs, 1, 0, 0, -1, p.camada, 0, 0, A.alfa, p.z + raio * 0.42, cz)
        }
      }
      // no alto da massa: o caracol que enrola subindo e afina em fiapo, e os pedaços que se soltam e se desfazem
      if (p.topo && A.chegou > 0 && dissipa <= 0 && moldura < 0.5) {
        this.caracol(p, x, y, raio, A.alfa, A.chegou, pôr, fiapo)
        this.pedaco(p, x, y, raio, A.alfa, A.chegou, pôr, fiapo)
      }
      // as que se desfazem soltam um fiapo pra cima
      if (A.alfa < 0.75 && p.fiapo) fiapo(x, y - raio * 0.6, u * 0.16 * (1 - A.alfa), 0.25 * p.lado, A.alfa * 1.3, p.lado, p.fase)
    }
    // o resto da fumaça no fundo do story (sobe e se desfaz)
    if (resto > 0) {
      for (let k = 0; k < 6; k++) {
        const x = W * (0.12 + 0.76 * ((k * 0.37) % 1))
        const y = H * (0.75 - 0.08 * (k % 3)) - resto * u * 0.4
        pôr(x, y, u * (0.09 + 0.03 * (k % 2)) * (1 - resto), 1, 0.2, 0, -1, FRENTE, t * 1.4 + k, 0.14, 1 - resto * 0.6)
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
    q.iso = r.iso ? clamp01((q12(t) - r.iso.de) / 0.25) * (1 - dissipa) : 0
    q.isoFase = r.iso ? t * r.iso.vel : 0

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
      // na saída pro story o túnel apaga primeiro (em ~0,1 s, antes de o story começar a aparecer por baixo): o texto do
      // story nunca fica em cima do caleidoscópio
      q.tunel[0] = sm(pt.abre, pt.abre + 0.8, t) * (1 - sm(0, 0.16, dissipa))
      q.tunel[1] = this.faseTunel.em(t)
      q.tunel[2] = t * 0.12
      q.tunel[3] = 1 - 0.45 * sm(pt.recua, pt.recua + 0.8, t)
      q.estrelas = sm(pt.abre + 0.2, pt.abre + 0.6, t) * (1 - sm(0, 0.16, dissipa))
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
    return true
  }

  /**
   * O caracol no alto de um lóbulo: nasce na borda de cima, cresce pra fora numa corrente de lóbulos cada vez menores que
   * se enrola (cada vez mais, enquanto sobe) e afina num fiapo; no fim do ciclo se solta e se desfaz, e nasce outro do
   * outro lado.
   */
  private caracol(p: Puff, x: number, y: number, raio: number, alfa: number, chegou: number, pôr: PorLobulo, fiapo: PorFiapo) {
    const u = this.geo.u
    const P = p.ciclo
    const c0 = chegou + p.fase * 0.37
    const k = Math.floor(c0 / P)
    const c = (c0 - k * P) / P
    const cresce = sm(0, 0.32, c)
    const enrola = 0.35 + (p.enrola - 0.35) * sm(0.04, 0.9, c)
    const some = sm(0.7, 1, c)
    const lado = (k % 2 ? -1 : 1) * p.lado
    const phi = -Math.PI / 2 + lado * (0.5 + 0.25 * Math.sin(k * 1.9 + p.fase))
    let fx = x + Math.cos(phi) * raio * 0.8
    let fy = y + Math.sin(phi) * raio * 0.8 - some * u * 0.07
    let fa = phi - lado * 0.35
    let rr = raio * 0.36
    const n = 7
    let m = 0
    for (; m < n; m++) {
      if (m / n > cresce) break
      fa += lado * enrola * (0.22 + m * 0.09)
      const passo = rr * 1.05
      fx += Math.cos(fa) * passo
      fy += Math.sin(fa) * passo
      rr *= 0.8
      pôr(fx, fy, rr, 1, 0.2, Math.cos(fa), Math.sin(fa), p.camada, fa * 2, 0, alfa * (1 - some * (0.55 + m * 0.07)), p.z + u * (0.05 + m * 0.01), p.grupo === 0 ? 1 : 0)
    }
    if (m === n) fiapo(fx, fy, u * (0.05 + 0.12 * c), fa + Math.PI / 2 + lado * 0.6, alfa * (1 - some), lado, p.fase + k)
  }

  /** Um pedaço que se solta do alto do lóbulo, sobe, encolhe e se desfaz em dither (e solta um fiapo). */
  private pedaco(p: Puff, x: number, y: number, raio: number, alfa: number, chegou: number, pôr: PorLobulo, fiapo: PorFiapo) {
    const u = this.geo.u
    const P = 0.8
    const c0 = chegou + p.fase * 0.53 + 0.4
    const k = Math.floor(c0 / P)
    const c = (c0 - k * P) / P
    const lado = (k % 2 ? 1 : -1) * p.lado
    const phi = -Math.PI / 2 - lado * (0.15 + 0.3 * Math.abs(Math.sin(k * 2.3 + p.fase)))
    const d = raio * (0.85 + c * 0.8)
    const px = x + Math.cos(phi) * d + lado * c * u * 0.03
    const py = y + Math.sin(phi) * d - c * u * 0.1
    const rr = u * 0.065 * sm(0, 0.12, c) * (1 - 0.55 * c)
    const a = alfa * (1 - sm(0.3, 1, c))
    pôr(px, py, rr, 1, 0.12, 0, -1, p.camada, c * 5 * lado, 0.16, a, p.z + u * 0.06, p.grupo === 0 ? 1 : 0)
    if (c > 0.4) fiapo(px, py - rr * 0.8, u * 0.1 * sm(0.4, 0.8, c), 0.2 * lado, a * 1.4, lado, p.fase * 3 + k)
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
