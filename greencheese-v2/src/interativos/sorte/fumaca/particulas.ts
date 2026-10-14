// Partículas em pixel, na mesma grade da fumaça (pintam no ImageData do pintor, depois do resto): as faíscas do estalo e
// da brasa (2–3 por puxada: brasa, não estrelinha), a cinza que racha, cai, quica e se parte em 3, os brilhos de 4
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
  /** Pedaço de cinza: tamanho (px), largura, giro (rad/s) e até onde cai (y). */
  tam?: number
  larg?: number
  giro?: number
  chao?: number
}

const BRASA = ['#fff3c0', '#ffb347', '#ff6a1f'].map((c) => px32(c))
const BRASA_OURO = ['#fffbe0', '#ffd45c', '#ffa21f'].map((c) => px32(c))
const CORES: Record<string, number[]> = {
  prata: ['#ffffff', '#e8eef2', '#b8c4cc'].map((c) => px32(c)),
  azul: ['#ffffff', '#b4e0ff', '#35a7ff'].map((c) => px32(c)),
  rosa: ['#ffffff', '#ffbfe0', '#ff3fa4', '#ff9a3d'].map((c) => px32(c)),
  ouro: ['#ffffff', '#fff1b8', '#ffc53d', '#ff5fb0', '#35d4ff', '#9466ff'].map((c) => px32(c)),
}
const CINZA = ['#3a3532', '#8f8881', '#bdb6ae', '#e4dfd8'].map((c) => px32(c))

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
    for (const tc of r.cinzaCai) {
      const cz = c.cinzaQueCai(tc)
      if (cz.comp < 4) continue
      L.push({ t0: tc, x0: cz.x, y0: cz.y, vx: -12 * escala, vy: 30 * escala, g: 2100 * escala, k: 0, vida: 1.4, tipo: 3, cor: CINZA[2], fase: cz.ang, tam: cz.comp * 0.9, larg: cz.raio * 1.6, giro: 2.4, chao: g.H + 40 })
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
   * A cinza caindo: o pedaço inteiro gira e cai; em 0,16 s se esfarela (2 pedaços grandes e 3 farelos que se afastam um
   * pouco) e todos seguem caindo até sair do quadro. Irregular, com as pintas e a borda esfarelada.
   */
  private cinza(buf: Uint32Array, cols: number, lins: number, pix: number, p: P, a: number, coberto?: (i: number, j: number) => boolean) {
    const A = 0.5 * p.g
    const pedacos: [number, number, number, number, number][] = []
    const quebra = 0.16
    if (a < quebra) {
      pedacos.push([p.x0 + p.vx * a, p.y0 + p.vy * a + A * a * a, p.tam ?? 20, p.fase + (p.giro ?? 3) * a, p.larg ?? 12])
    } else {
      const b = a - quebra
      const xq = p.x0 + p.vx * quebra
      const yq = p.y0 + p.vy * quebra + A * quebra * quebra
      const vyq = p.vy + p.g * quebra
      const tam = p.tam ?? 20
      const larg = p.larg ?? 12
      const partes: [number, number, number, number][] = [
        [-26, 0.5, 0.9, -1.6],
        [24, 0.42, 0.8, 2.1],
        [-60, 0.16, 0.42, 4],
        [8, 0.14, 0.38, -3],
        [52, 0.12, 0.34, 5],
      ]
      partes.forEach(([vx, kt, kl, giro], k) => {
        const off = (k - 2) * larg * 0.18
        pedacos.push([xq + off + (p.vx + vx) * b, yq + vyq * b * (1 + k * 0.04) + A * b * b, tam * kt, p.fase + (p.giro ?? 3) * quebra + giro * b, larg * kl])
      })
    }
    pedacos.forEach(([x, y, comp, ang, larg], n) => {
      if (y - comp > lins * pix) return
      const ax = Math.cos(ang)
      const ay = Math.sin(ang)
      const R = Math.ceil((comp / 2 + larg) / pix) + 1
      const ci = Math.round(x / pix)
      const cj = Math.round(y / pix)
      const h = comp / 2
      // uma pedra de cinza com a borda esfarelada (o raio varia por fatia de 1 célula, fixo no pedaço)
      const dentro = (i: number, j: number) => {
        const dx = (i + 0.5) * pix - x
        const dy = (j + 0.5) * pix - y
        const s = dx * ax + dy * ay
        const v = -dx * ay + dy * ax
        const ds = s - Math.max(-h, Math.min(h, s))
        const r = larg / 2 - ruido(Math.round(s / pix) + 40, n * 7 + 3) * pix * 2.2 - (ruido(Math.round(v / pix) + 9, n + 1) > 0.7 ? pix : 0)
        return ds * ds + v * v <= r * r
      }
      for (let j = cj - R; j <= cj + R; j++)
        for (let i = ci - R; i <= ci + R; i++) {
          if (i < 0 || j < 0 || i >= cols || j >= lins || !dentro(i, j) || coberto?.(i, j)) continue
          const borda = !dentro(i - 1, j) || !dentro(i + 1, j) || !dentro(i, j - 1) || !dentro(i, j + 1)
          if (borda) {
            buf[j * cols + i] = CINZA[0]
            continue
          }
          const dx = (i + 0.5) * pix - x
          const dy = (j + 0.5) * pix - y
          const v = -dx * ay + dy * ax
          // a luz vem de cima; as pintas escuras
          const k = (v * Math.sign(ax || 1)) / (larg / 2)
          const pinta = ruido(i * 3 + n, j * 5 + 1) < 0.1
          buf[j * cols + i] = pinta ? CINZA[1] : k < -0.36 ? CINZA[3] : k > 0.44 ? CINZA[1] : CINZA[2]
        }
    })
  }
}
