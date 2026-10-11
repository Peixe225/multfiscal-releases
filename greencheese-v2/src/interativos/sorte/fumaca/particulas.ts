// Partículas em pixel, num canvas 2D na mesma grade da fumaça (o pixel grande do site): faíscas da brasa e do pop,
// brilhinhos em volta do prêmio, a explosão de faíscas da raridade, pontinhos psicodélicos (épico) e o confete
// (lendário). Tudo sorteado uma vez (semente fixa) e desenhado como função do tempo: pular e voltar dá o mesmo quadro.
import type { Cena } from './cena'

interface P {
  t0: number
  x0: number
  y0: number
  vx: number
  vy: number
  /** Gravidade (px/s²). */
  g: number
  /** Arrasto (1/s): 0 = sem. */
  k: number
  vida: number
  tipo: 0 | 1 | 2 | 3
  cor: string
  fase: number
}

const BRASA = ['#fff3c0', '#ffb347', '#ff6a1f']
const BRASA_OURO = ['#fffbe0', '#ffd45c', '#ffa21f']
const CORES: Record<string, string[]> = {
  prata: ['#ffffff', '#e8eef2', '#b8c4cc'],
  azul: ['#ffffff', '#b4e0ff', '#35a7ff'],
  rosa: ['#ffffff', '#ffbfe0', '#ff3fa4', '#ff9a3d'],
  ouro: ['#ffffff', '#fff1b8', '#ffc53d', '#ff5fb0', '#35d4ff', '#9466ff'],
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
  private ctx: CanvasRenderingContext2D | null
  private pix = 4
  private w = 1
  private h = 1

  constructor(
    private canvas: HTMLCanvasElement,
    private cena: Cena,
  ) {
    this.ctx = canvas.getContext('2d')
  }

  /** Sorteia as partículas pra geometria atual (montagem e resize). */
  medir(w: number, h: number, pix: number) {
    this.pix = pix
    this.w = w
    this.h = h
    this.canvas.width = w
    this.canvas.height = h
    const c = this.cena
    const r = c.rot
    const g = c.geometria
    const t0 = c.t0
    const rnd = semente(4242 + r.puxadas.length * 17)
    const L: P[] = []
    const escala = g.u / 390
    const brasa = r.chamaDourada ? BRASA_OURO : BRASA
    // o pop da torcida: 8 faíscas pra cima e pros lados
    {
      const tp = t0 + r.pop
      const [x, y] = c.pontaEm(tp)
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI / 2 + (rnd() - 0.5) * 2.4
        const v = (90 + rnd() * 120) * escala
        L.push({ t0: tp, x0: x, y0: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 260 * escala, k: 2.2, vida: 0.35 + rnd() * 0.25, tipo: 0, cor: brasa[i % 3], fase: rnd() })
      }
    }
    // faíscas da brasa em cada puxada (mais na mais forte)
    for (const p of r.puxadas) {
      const n = Math.round(5 + 12 * p.forca * (r.raridade === 'lendario' ? 1.6 : 1))
      for (let i = 0; i < n; i++) {
        const ts = t0 + p.de + 0.08 + rnd() * (p.ate - p.de)
        const [x, y] = c.brasaEm(ts)
        const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2
        const v = (50 + rnd() * 110) * escala * (0.7 + p.forca * 0.5)
        L.push({ t0: ts, x0: x, y0: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 140 * escala, k: 1.6, vida: 0.3 + rnd() * 0.45, tipo: 0, cor: brasa[i % 3], fase: rnd() })
      }
    }
    const cores = CORES[r.brilhos]
    const pc = g.premio
    // brilhinhos em volta do prêmio (fora do cartão), piscando em degraus
    {
      const n = r.raridade === 'comum' ? 9 : r.raridade === 'raro' ? 10 : 12
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd() * 0.5
        const rx = pc.w * (0.56 + rnd() * 0.22)
        const ry = pc.h * (0.52 + rnd() * 0.16)
        L.push({ t0: t0 + r.premio + 0.12 + rnd() * 0.5, x0: pc.x + Math.cos(a) * rx, y0: pc.y + Math.sin(a) * ry, vx: 0, vy: -4 * escala, g: 0, k: 0, vida: 99, tipo: 1, cor: cores[i % 2], fase: rnd() * 6 })
      }
    }
    // a explosão de faíscas da raridade (raro, épico, lendário), de trás do prêmio pra fora
    if (r.raridade !== 'comum') {
      const n = r.raridade === 'raro' ? 26 : 34
      const tb = t0 + r.premio + (r.rosto ? 0.05 : 0.08)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd() * 0.3
        const v = (160 + rnd() * 200) * escala
        L.push({ t0: tb, x0: pc.x, y0: pc.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 40 * escala, k: 2.6, vida: 0.55 + rnd() * 0.4, tipo: 0, cor: cores[1 + (i % (cores.length - 1))], fase: rnd() })
      }
    }
    // pontinhos psicodélicos subindo (épico)
    if (r.psicodelia != null && r.raridade === 'epico') {
      for (let i = 0; i < 26; i++) {
        L.push({ t0: t0 + r.psicodelia + rnd() * 3, x0: (rnd() * 0.9 + 0.05) * g.W, y0: g.H * (0.6 + rnd() * 0.5), vx: (rnd() - 0.5) * 20 * escala, vy: -(30 + rnd() * 50) * escala, g: 0, k: 0, vida: 1.6 + rnd(), tipo: 3, cor: cores[i % cores.length], fase: rnd() * 6 })
      }
    }
    // confete do lendário: estoura do meio pra cima e cai balançando
    if (r.confete != null) {
      for (let i = 0; i < 80; i++) {
        const a = -Math.PI / 2 + (rnd() - 0.5) * 2.8
        const v = (220 + rnd() * 260) * escala
        L.push({ t0: t0 + r.confete + rnd() * 0.12, x0: pc.x, y0: pc.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 420 * escala, k: 1.4, vida: 2.4 + rnd() * 1.2, tipo: 2, cor: cores[2 + (i % 4)], fase: rnd() * 6 })
      }
    }
    this.lista = L
  }

  /** Desenha o tempo t. `dissipa`: some junto com a fumaça. */
  pintar(t: number, dissipa = 0) {
    const ctx = this.ctx
    if (!ctx) return
    ctx.clearRect(0, 0, this.w, this.h)
    if (dissipa >= 1) return
    const k = this.pix
    for (const p of this.lista) {
      const a = t - p.t0
      if (a < 0 || a > p.vida) continue
      // arrasto exponencial: v(a) = v0·e^(−k·a)
      const ea = p.k > 0 ? (1 - Math.exp(-p.k * a)) / p.k : a
      const x = p.x0 + p.vx * ea + (p.tipo === 2 ? Math.sin(a * 7 + p.fase) * 9 : 0)
      const y = p.y0 + p.vy * ea + 0.5 * p.g * a * a
      const px = Math.round(x / k)
      const py = Math.round(y / k)
      if (px < -2 || py < -2 || px > this.w + 2 || py > this.h + 2) continue
      ctx.fillStyle = p.cor
      if (p.tipo === 0) {
        // faísca: cabeça + rabo de 1 px no sentido contrário do movimento
        const vx = p.vx * Math.exp(-p.k * a)
        const vy = p.vy * Math.exp(-p.k * a) + p.g * a
        const m = Math.hypot(vx, vy) || 1
        if (a > p.vida * 0.75 && Math.floor(t * 24) % 2) continue
        ctx.fillRect(px, py, 1, 1)
        if (m > 30) {
          ctx.globalAlpha = 0.85
          ctx.fillRect(px - Math.round(vx / m), py - Math.round(vy / m), 1, 1)
          ctx.globalAlpha = 1
        }
      } else if (p.tipo === 1) {
        // brilhinho em cruz: 0 → 1 → 2 → 1 (12 qps), com pausa
        const f = Math.floor(t * 12 + p.fase * 2) % 10
        const raio = f === 1 || f === 3 ? 1 : f === 2 ? 2 : f === 0 || f === 4 ? 0 : -1
        if (raio < 0) continue
        ctx.fillRect(px, py, 1, 1)
        if (raio > 0) {
          ctx.fillRect(px - raio, py, raio, 1)
          ctx.fillRect(px + 1, py, raio, 1)
          ctx.fillRect(px, py - raio, 1, raio)
          ctx.fillRect(px, py + 1, 1, raio)
        }
      } else if (p.tipo === 2) {
        // confete: vira de lado (2×1 ↔ 1×2) e pisca no fim
        if (a > p.vida - 0.4 && Math.floor(t * 16) % 2) continue
        if (Math.sin(a * 11 + p.fase) > 0) ctx.fillRect(px, py, 2, 1)
        else ctx.fillRect(px, py, 1, 2)
      } else {
        // pontinho que sobe e pisca
        if (Math.floor(t * 8 + p.fase) % 4 === 0) continue
        ctx.fillRect(px, py, a < p.vida * 0.5 ? 2 : 1, a < p.vida * 0.5 ? 2 : 1)
      }
    }
  }
}
