// Partículas em pixel, na mesma grade da fumaça (pintam no ImageData do pintor, depois do resto): as faíscas do estalo e
// da brasa (2–3 por puxada: brasa, não estrelinha), a lasca de cinza que se solta e se esfarela em pontos, os brilhos de 4
// pontas em volta do prêmio (nunca em cima do texto), a explosão da raridade e o confete do lendário. Tudo sorteado uma
// vez (semente fixa) e desenhado como função do tempo: pular e voltar dá o mesmo quadro.
import type { Cena } from './cena'
import { px32 } from './quadro'

interface P {
  t0: number
  x0: number
  y0: number
  vx: number
  vy: number
  /** Gravidade (px/s²) e arrasto (1/s). */
  g: number
  k: number
  vida: number
  /** 0 faísca, 1 brilho de 4 pontas, 2 confete, 3 pedaço de cinza. */
  tipo: 0 | 1 | 2 | 3
  cor: number
  fase: number
  /** Pedaço de cinza: tamanho (px), largura, giro (rad/s) e os grãos (a grade local da lasca). */
  tam?: number
  larg?: number
  giro?: number
  graos?: Graos
}

/**
 * Os grãos da lasca de cinza, numa grade local (ns ao longo do eixo do beck × nv de través, uma célula cada): quando
 * cada um se solta (s depois de cair; a borda primeiro, o miolo por último), quanto vive solto e pra onde vai.
 */
interface Graos {
  ns: number
  nv: number
  existe: Uint8Array
  solta: Float32Array
  vida: Float32Array
  vx: Float32Array
  vy: Float32Array
}

const BRASA = ['#fff3c0', '#ffb347', '#ff6a1f'].map((c) => px32(c))
const BRASA_OURO = ['#fffbe0', '#ffd45c', '#ffa21f'].map((c) => px32(c))
const CORES: Record<string, number[]> = {
  prata: ['#ffffff', '#e8eef2', '#b8c4cc'].map((c) => px32(c)),
  azul: ['#ffffff', '#b4e0ff', '#35a7ff'].map((c) => px32(c)),
  rosa: ['#ffffff', '#ffbfe0', '#ff3fa4', '#ff9a3d'].map((c) => px32(c)),
  ouro: ['#ffffff', '#fff1b8', '#ffc53d', '#ff5fb0', '#35d4ff', '#9466ff'].map((c) => px32(c)),
}
// a cinza: contorno cinza-médio (nada de marrom: lia como torrão), a sombra, o meio e a luz; os farelos
const CINZA = ['#7a7672', '#aaa6a1', '#cfcbc6', '#efede9'].map((c) => px32(c))
const FARELO = ['#d9d6d2', '#b9b5b0', '#f4f2ef'].map((c) => px32(c))
/** O passo da grade local dos grãos da lasca (px de CSS: a célula de 4 px do desenho). */
const PASSO_GRAO = 4

/** Um número de 0 a 1 fixo por par de inteiros (a borda e os grãos da cinza). */
function ruido(a: number, b: number) {
  let x = (a * 374761393 + b * 668265263) | 0
  x = Math.imul(x ^ (x >>> 13), 1274126177)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

function semente(n: number) {
  let s = n >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export class Particulas {
  private lista: P[] = []

  constructor(private cena: Cena) {}

  /** Sorteia as partículas pra geometria atual (montagem e resize). */
  medir() {
    const c = this.cena
    const r = c.rot
    const g = c.geometria
    const rnd = semente(4242 + r.puxadas.length * 17)
    const L: P[] = []
    const escala = g.u / 390
    const brasa = r.chamaDourada ? BRASA_OURO : BRASA
    // o estalo da torcida: 9 faíscas pra cima e pros lados
    {
      const tp = r.isqueiro.pega
      const [x, y] = c.pontaEm(tp)
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI / 2 + (rnd() - 0.5) * 2.6
        const v = (90 + rnd() * 130) * escala
        L.push({ t0: tp, x0: x, y0: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 260 * escala, k: 2.2, vida: 0.32 + rnd() * 0.25, tipo: 0, cor: brasa[i % 3], fase: rnd() })
      }
    }
    // as faíscas da brasa em cada puxada (na hora em que ela incandesce): 4 a 6, pra cima e pros lados
    for (const p of r.puxadas) {
      const n = 3 + Math.round(p.forca * 3)
      for (let i = 0; i < n; i++) {
        const ts = p.puxa + (p.segura - p.puxa) * (0.25 + rnd() * 0.75)
        const [x, y] = c.brasaEm(ts)
        const a = -Math.PI / 2 + (rnd() - 0.5) * 1.8
        const v = (60 + rnd() * 90) * escala
        L.push({ t0: ts, x0: x, y0: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 180 * escala, k: 1.6, vida: 0.35 + rnd() * 0.3, tipo: 0, cor: brasa[i % 3], fase: rnd() })
      }
    }
    // a cinza: racha, se solta da ponta e cai girando (presa no peso dela, sem chão invisível), se esfarela no meio do
    // caminho em pedaços que caem juntos e sai pelo pé do quadro
    // (a lasca: o pedaço da ponta, um pouco mais fino que o beck, com a borda roída; se esfarela em grãos de 1 célula
    // da borda pro miolo enquanto cai, e os grãos piscam e somem)
    for (const tc of r.cinzaCai) {
      const cz = c.cinzaQueCai(tc)
      if (cz.comp < 4) continue
      const tam = Math.max(cz.comp * 0.95, PASSO_GRAO * 3)
      const larg = cz.raio * 1.1
      const ns = Math.max(3, Math.round(tam / PASSO_GRAO))
      const nv = Math.max(3, Math.round(larg / PASSO_GRAO))
      const n = ns * nv
      const gr: Graos = { ns, nv, existe: new Uint8Array(n), solta: new Float32Array(n), vida: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n) }
      for (let b = 0; b < nv; b++)
        for (let a = 0; a < ns; a++) {
          const id = b * ns + a
          const ks = Math.abs((a - (ns - 1) / 2) / (ns / 2))
          const kv = Math.abs((b - (nv - 1) / 2) / (nv / 2))
          // as pontas arredondadas e a borda roída
          const borda = Math.max(ks * ks * 0.7 + kv * kv, kv)
          if (borda > 1 || (borda > 0.62 && ruido(a + 7, b * 13 + 1) < 0.32)) continue
          gr.existe[id] = 1
          gr.solta[id] = 0.05 + (1 - Math.min(1, borda)) * 0.4 + rnd() * 0.1
          gr.vida[id] = 0.25 + rnd() * 0.3
          // os grãos caem (um pouco pros lados), não explodem
          gr.vx[id] = (rnd() - 0.5) * 50 * escala
          gr.vy[id] = (20 + rnd() * 70) * escala
        }
      L.push({ t0: tc, x0: cz.x, y0: cz.y, vx: -10 * escala, vy: 20 * escala, g: 1500 * escala, k: 0, vida: 1.2, tipo: 3, cor: CINZA[2], fase: cz.ang, tam, larg, giro: 3.2, graos: gr })
    }
    const cores = CORES[r.brilhos]
    const pc = g.premio
    const E = r.escala
    // brilhos de 4 pontas em volta do prêmio (fora do cartão e do texto), piscando em degraus
    {
      const n = r.raridade === 'comum' ? 6 : r.raridade === 'raro' ? 8 : 10
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd() * 0.5
        const rx = (pc.w / 2) * E * (1.08 + rnd() * 0.25)
        const ry = (pc.h / 2) * E * (0.95 + rnd() * 0.12)
        L.push({ t0: r.premio + 0.12 + rnd() * 0.45, x0: pc.x + Math.cos(a) * rx, y0: pc.y + Math.sin(a) * ry, vx: 0, vy: -4 * escala, g: 0, k: 0, vida: 99, tipo: 1, cor: cores[i % 2], fase: rnd() * 6 })
      }
    }
    // a explosão de faíscas da raridade (raro, épico, lendário), de trás do prêmio pra fora
    if (r.raridade !== 'comum') {
      const n = r.raridade === 'raro' ? 22 : 30
      const tb = r.premio + 0.06
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd() * 0.3
        const v = (170 + rnd() * 200) * escala
        L.push({ t0: tb, x0: pc.x, y0: pc.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 40 * escala, k: 2.6, vida: 0.5 + rnd() * 0.4, tipo: 0, cor: cores[1 + (i % (cores.length - 1))], fase: rnd() })
      }
    }
    // o confete do lendário: estoura do meio pra cima e cai balançando
    if (r.confete != null) {
      for (let i = 0; i < 70; i++) {
        const a = -Math.PI / 2 + (rnd() - 0.5) * 2.8
        const v = (220 + rnd() * 260) * escala
        L.push({ t0: r.confete + rnd() * 0.12, x0: pc.x, y0: pc.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 420 * escala, k: 1.4, vida: 2.2 + rnd() * 1.0, tipo: 2, cor: cores[2 + (i % 4)], fase: rnd() * 6 })
      }
    }
    this.lista = L
  }

  /** Pinta o tempo t no buffer (células de `pix` px). `some`: as do prêmio somem junto com a fumaça. */
  pintar(buf: Uint32Array, cols: number, lins: number, pix: number, t: number, some = 0, texto?: Float32Array, coberto?: (i: number, j: number) => boolean) {
    if (some >= 1) return
    const tx0 = texto ? texto[0] / pix : 0
    const ty0 = texto ? texto[1] / pix : 0
    const tx1 = texto ? texto[2] / pix : -1
    const ty1 = texto ? texto[3] / pix : -1
    const pt = (i: number, j: number, c: number) => {
      if (i < 0 || j < 0 || i >= cols || j >= lins) return
      if (i >= tx0 && i <= tx1 && j >= ty0 && j <= ty1) return
      buf[j * cols + i] = c
    }
    for (const p of this.lista) {
      const a = t - p.t0
      if (a < 0 || a > p.vida) continue
      if (p.tipo === 3) {
        this.cinza(buf, cols, lins, pix, p, a, coberto)
        continue
      }
      const ea = p.k > 0 ? (1 - Math.exp(-p.k * a)) / p.k : a
      const x = p.x0 + p.vx * ea + (p.tipo === 2 ? Math.sin(a * 7 + p.fase) * 9 : 0)
      const y = p.y0 + p.vy * ea + 0.5 * p.g * a * a
      const i = Math.round(x / pix)
      const j = Math.round(y / pix)
      if (i < -3 || j < -3 || i > cols + 3 || j > lins + 3) continue
      if (p.tipo === 0) {
        // faísca: cabeça + rabo de 1 célula no sentido contrário do movimento; pisca no fim
        const vx = p.vx * Math.exp(-p.k * a)
        const vy = p.vy * Math.exp(-p.k * a) + p.g * a
        const m = Math.hypot(vx, vy) || 1
        if (a > p.vida * 0.7 && Math.floor(t * 24) % 2) continue
        pt(i, j, p.cor)
        if (m > 30) pt(i - Math.round(vx / m), j - Math.round(vy / m), p.cor)
      } else if (p.tipo === 1) {
        if (some > 0) continue
        // brilho de 4 pontas: 0 → 1 → 2 → 1 (12 qps), com pausa
        const f = Math.floor(t * 12 + p.fase * 2) % 10
        const raio = f === 1 || f === 3 ? 1 : f === 2 ? 2 : f === 0 || f === 4 ? 0 : -1
        if (raio < 0) continue
        pt(i, j, p.cor)
        for (let k = 1; k <= raio; k++) {
          pt(i - k, j, p.cor)
          pt(i + k, j, p.cor)
          pt(i, j - k, p.cor)
          pt(i, j + k, p.cor)
        }
      } else {
        if (some > 0.5) continue
        // confete: vira de lado (2×1 ↔ 1×2) e pisca no fim
        if (a > p.vida - 0.4 && Math.floor(t * 16) % 2) continue
        pt(i, j, p.cor)
        if (Math.sin(a * 11 + p.fase) > 0) pt(i + 1, j, p.cor)
        else pt(i, j + 1, p.cor)
      }
    }
  }

  /**
   * A lasca de cinza caindo: gira devagar e cai; da borda pro miolo, cada grão se solta, ganha um empurrão pra fora,
   * cai um pouco mais rápido, pisca e some (se esfarela em pontos). Cinza-claro, contorno cinza-médio.
   */
  private cinza(buf: Uint32Array, cols: number, lins: number, pix: number, p: P, a: number, coberto?: (i: number, j: number) => boolean) {
    const gr = p.graos
    if (!gr) return
    const { ns, nv, existe, solta, vida, vx, vy } = gr
    const X = p.x0 + p.vx * a
    const Y = p.y0 + p.vy * a + 0.5 * p.g * a * a
    const ang = p.fase + (p.giro ?? 1.6) * a
    // o eixo do beck (ang = a inclinação a partir da vertical) e a normal (pro lado de baixo à direita: a sombra)
    const Ax = Math.sin(ang)
    const Ay = -Math.cos(ang)
    const Nx = Math.cos(ang)
    const Ny = Math.sin(ang)
    const meioS = (ns - 1) / 2
    const meioV = (nv - 1) / 2
    const preso = (sa: number, sb: number) => sa >= 0 && sb >= 0 && sa < ns && sb < nv && existe[sb * ns + sa] === 1 && a < solta[sb * ns + sa]
    // o pedaço que ainda está inteiro: varre a caixa e volta cada célula pra grade local (sem buraco no giro)
    const R = Math.ceil((Math.hypot(ns, nv) / 2) * (PASSO_GRAO / pix)) + 1
    const ci = Math.round(X / pix)
    const cj = Math.round(Y / pix)
    for (let j = cj - R; j <= cj + R; j++) {
      if (j < 0 || j >= lins) continue
      for (let i = ci - R; i <= ci + R; i++) {
        if (i < 0 || i >= cols) continue
        const dx = (i + 0.5) * pix - X
        const dy = (j + 0.5) * pix - Y
        const sa = Math.round((dx * Ax + dy * Ay) / PASSO_GRAO + meioS)
        const sb = Math.round((dx * Nx + dy * Ny) / PASSO_GRAO + meioV)
        if (!preso(sa, sb) || coberto?.(i, j)) continue
        const borda = !preso(sa - 1, sb) || !preso(sa + 1, sb) || !preso(sa, sb - 1) || !preso(sa, sb + 1)
        const kv = (sb - meioV) / Math.max(1, nv / 2)
        let c = borda ? CINZA[0] : kv < -0.3 ? CINZA[3] : kv > 0.4 ? CINZA[1] : CINZA[2]
        // a luz de borda do lado de cima (como a do beck)
        if (borda && kv < -0.2) c = CINZA[3]
        buf[j * cols + i] = c
      }
    }
    // os grãos soltos
    const flick = Math.floor((p.t0 + a) * 24)
    for (let id = 0; id < ns * nv; id++) {
      if (!existe[id]) continue
      const b0 = a - solta[id]
      if (b0 < 0 || b0 > vida[id]) continue
      if (b0 > vida[id] * 0.6 && (flick + id) % 2) continue
      const sa = id % ns
      const sb = Math.floor(id / ns)
      const ts = solta[id]
      // onde estava preso quando soltou
      const Xs = p.x0 + p.vx * ts
      const Ys = p.y0 + p.vy * ts + 0.5 * p.g * ts * ts
      const an = p.fase + (p.giro ?? 1.6) * ts
      const ls = (sa - meioS) * PASSO_GRAO
      const lv = (sb - meioV) * PASSO_GRAO
      const x0 = Xs + ls * Math.sin(an) + lv * Math.cos(an)
      const y0 = Ys - ls * Math.cos(an) + lv * Math.sin(an)
      const vy0 = p.vy + p.g * ts
      const x = x0 + (p.vx + vx[id]) * b0
      const y = y0 + (vy0 + vy[id]) * b0 + 0.5 * p.g * 1.15 * b0 * b0
      const i = Math.floor(x / pix)
      const j = Math.floor(y / pix)
      if (i < 0 || j < 0 || i >= cols || j >= lins || coberto?.(i, j)) continue
      buf[j * cols + i] = FARELO[id % 3]
    }
  }
}
