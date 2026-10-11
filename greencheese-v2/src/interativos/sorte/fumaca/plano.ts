// O caminho sem WebGL (ou com o contexto perdido, ou no modo leve): o mesmo quadro desenhado em canvas 2D, na mesma
// grade de pixel grande. Mais simples (sem o ondulado que derrete, sem caleidoscópio na fumaça), mas com a mesma cara:
// nuvens de contorno escuro com 3 faixas de luz, halo e raios em dither, o túnel em anéis, olhos, boca, argolas, chama.
import type { Desenho } from './gl'
import type { Quadro } from './cena'
import { NA, NF } from './cena'

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const HOLO = ['#ffc53d', '#ff5fb0', '#35ccff', '#9466ff']
const ESCURO = '#1a0b2e'

const rgb = (a: Float32Array, i: number) => `rgb(${Math.round(a[i] * 255)},${Math.round(a[i + 1] * 255)},${Math.round(a[i + 2] * 255)})`
const matiz = (x: number) => 200 + 185 * (0.5 + 0.5 * Math.sin(x))

export function criar2D(canvas: HTMLCanvasElement): Desenho | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const camada = document.createElement('canvas')
  const fc = camada.getContext('2d')
  if (!fc) return null
  let w = 1
  let h = 1
  const padroes = new Map<string, CanvasPattern | null>()
  /** Padrão 4×4 de dither: a cor nos pontos da matriz de Bayer abaixo do nível. */
  const padrao = (cor: string, nivel: number): CanvasPattern | string => {
    const n = Math.max(0, Math.min(16, Math.round(nivel * 16)))
    if (n >= 16) return cor
    const chave = `${cor}|${n}`
    let p = padroes.get(chave)
    if (p === undefined) {
      const c = document.createElement('canvas')
      c.width = 4
      c.height = 4
      const x = c.getContext('2d')
      if (x) {
        x.fillStyle = cor
        for (let i = 0; i < 16; i++) if (BAYER[i] < n) x.fillRect(i % 4, Math.floor(i / 4), 1, 1)
      }
      p = ctx.createPattern(c, 'repeat')
      padroes.set(chave, p)
    }
    return p ?? cor
  }
  const disco = (c: CanvasRenderingContext2D, x: number, y: number, r: number) => {
    if (r <= 0) return
    c.beginPath()
    c.arc(x, y, r, 0, Math.PI * 2)
    c.fill()
  }

  return {
    tipo: '2d',
    medir(nw, nh) {
      if (nw === w && nh === h) return
      w = Math.max(2, nw)
      h = Math.max(2, nh)
      canvas.width = camada.width = w
      canvas.height = camada.height = h
    },
    limpar() {
      ctx.clearRect(0, 0, w, h)
    },
    destruir() {
      padroes.clear()
    },
    pintar(q: Quadro) {
      const m = Math.min(w, h)
      const X = (x: number) => w / 2 + x * m
      const Y = (y: number) => h / 2 + y * m
      ctx.clearRect(0, 0, w, h)
      ctx.imageSmoothingEnabled = false
      const cx = X(q.halo[0])
      const cy = Y(q.halo[1])

      // túnel (lendário): gomos espelhados que giram (caleidoscópio) e anéis que correm pro meio
      if (q.tunel[0] > 0.02) {
        const fase = q.tunel[1]
        const base = Math.floor(fase)
        const fr = fase - base
        const R = Math.hypot(w, h)
        ctx.save()
        ctx.beginPath()
        ctx.arc(cx, cy, Math.min(1, q.tunel[0]) * 2.2 * m, 0, Math.PI * 2)
        ctx.clip()
        ctx.globalAlpha = q.tunel[3] ?? 1
        for (let i = 0; i < 12; i++) {
          const a0 = (i / 12) * Math.PI * 2 + fase * 0.15
          ctx.beginPath()
          ctx.moveTo(cx, cy)
          ctx.arc(cx, cy, R, a0, a0 + Math.PI / 6)
          ctx.closePath()
          ctx.fillStyle = HOLO[(i + base) % 4]
          ctx.fill()
          ctx.strokeStyle = ESCURO
          ctx.lineWidth = 1
          ctx.stroke()
        }
        for (let k = 1; k < 30; k++) {
          const r = (0.6 / (k - fr)) * m
          if (r < 3) break
          if (r > R) continue
          ctx.beginPath()
          ctx.arc(cx, cy, r, 0, Math.PI * 2)
          ctx.strokeStyle = ESCURO
          ctx.lineWidth = Math.max(1, r * 0.08)
          ctx.stroke()
        }
        ctx.restore()
        ctx.globalAlpha = 1
      }
      // halo em dither
      if (q.halo[3] > 0.01) {
        const R = q.halo[2] * m
        const cor = rgb(q.haloCor, 0)
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = padrao(cor, (0.2 + i * 0.18) * q.halo[3])
          disco(ctx, cx, cy, R * (1 - i * 0.18))
        }
      }
      // raios
      if (q.raios[0] > 0.01) {
        const n = q.raios[1]
        const R = q.raios[3] * m
        ctx.fillStyle = padrao(rgb(q.raiosCor, 0), 0.5 * q.raios[0])
        for (let i = 0; i < n; i++) {
          const a0 = ((i + q.raios[2]) / n) * Math.PI * 2
          const a1 = a0 + (Math.PI / n) * 0.7
          ctx.beginPath()
          ctx.moveTo(cx, cy)
          ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R)
          ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R)
          ctx.fill()
        }
      }
      // formas (estrelas e losangos)
      for (let k = 0; k < NF; k++) {
        const al = q.formasK[k * 4 + 2]
        if (al <= 0.05) continue
        const fx = X(q.formas[k * 4])
        const fy = Y(q.formas[k * 4 + 1])
        const fr = q.formas[k * 4 + 2] * m
        const giro = q.formas[k * 4 + 3]
        ctx.beginPath()
        const pontas = q.formasK[k * 4] % 2 ? 4 : 5
        for (let i = 0; i < pontas * 2; i++) {
          const a = giro + (i / (pontas * 2)) * Math.PI * 2 - Math.PI / 2
          const rr = i % 2 ? fr * 0.45 : fr
          ctx.lineTo(fx + Math.cos(a) * rr, fy + Math.sin(a) * rr)
        }
        ctx.closePath()
        ctx.fillStyle = HOLO[q.formasK[k * 4 + 1] | 0]
        ctx.fill()
        ctx.strokeStyle = ESCURO
        ctx.lineWidth = 1
        ctx.stroke()
      }
      // brasa e chama
      if (q.brasa[3] > 0.01) {
        const R = q.brasa[2] * m
        ctx.fillStyle = padrao('#ff6a1f', 0.45 * q.brasa[3])
        disco(ctx, X(q.brasa[0]), Y(q.brasa[1]), R)
        ctx.fillStyle = padrao('#ffd27a', 0.7 * q.brasa[3])
        disco(ctx, X(q.brasa[0]), Y(q.brasa[1]), R * 0.45)
      }
      if (q.chama[3] > 0.01) {
        const s = q.chama[2] * q.chama[3] * m * (1 + 0.1 * Math.sin(q.boil * 2.3))
        const fx = X(q.chama[0])
        const fy = Y(q.chama[1]) - s * 0.3
        const gota = (k: number, cor: string, dy: number) => {
          ctx.beginPath()
          ctx.moveTo(fx, fy - s * 1.4 * k + dy)
          ctx.bezierCurveTo(fx + s * 0.55 * k, fy - s * 0.6 * k + dy, fx + s * 0.5 * k, fy + s * 0.45 * k + dy, fx, fy + s * 0.45 * k + dy)
          ctx.bezierCurveTo(fx - s * 0.5 * k, fy + s * 0.45 * k + dy, fx - s * 0.55 * k, fy - s * 0.6 * k + dy, fx, fy - s * 1.4 * k + dy)
          ctx.fillStyle = cor
          ctx.fill()
        }
        const ouro = q.chamaDourada > 0.5
        gota(1.12, '#3b1200', 0)
        gota(1, ouro ? '#ffb020' : '#ff7a1a', 0)
        gota(0.72, ouro ? '#ffe27a' : '#ffc53d', s * 0.08)
        gota(0.42, '#fff6d6', s * 0.15)
      }

      // fumaça numa camada à parte (o buraco do prêmio recorta só ela)
      fc.clearRect(0, 0, w, h)
      const B = q.blobs
      const n = q.nBlobs
      const psi = q.psi[0]
      const camadaDe = (fundo: boolean) => {
        const cores = fundo ? q.coresFundo : q.cores
        // [x, y, r, id]; a linha "ferve" a 12 qps: cada bolha treme meio pixel quando o desenho troca
        const lista: [number, number, number, number][] = []
        for (let i = 0; i < n; i++) {
          const wv = B[i * 4 + 3]
          const r = B[i * 4 + 2]
          if (!wv || r <= 0 || (wv < 0) !== fundo) continue
          const jx = Math.sin(q.boil * 12.9898 + i * 78.233) * 0.6
          const jy = Math.sin(q.boil * 39.346 + i * 11.135) * 0.6
          lista.push([X(B[i * 4]) + jx, Y(B[i * 4 + 1]) + jy, r * m * q.dens * Math.sqrt(Math.min(1, Math.abs(wv))), i + 1])
        }
        const corDe = (faixa: number, id: number) => {
          if (!fundo && id <= 8) return rgb(q.coresFiapo, faixa * 3)
          if (psi < 0.5) return rgb(cores, faixa * 3)
          const hh = matiz(q.psi[1] + id * q.psi[2] + (fundo ? 2.1 : 0))
          const l = [9, 34, 55, 78][faixa] * (fundo && faixa ? 0.7 : 1)
          return `hsl(${hh % 360},${faixa ? 88 : 65}%,${l}%)`
        }
        for (const [x, y, r, id] of lista) {
          fc.fillStyle = corDe(0, id)
          disco(fc, x, y, r + 1)
        }
        for (const [x, y, r, id] of lista) {
          fc.fillStyle = corDe(1, id)
          disco(fc, x, y, r)
        }
        for (const [x, y, r, id] of lista) {
          fc.fillStyle = corDe(2, id)
          disco(fc, x - r * 0.1, y - r * 0.13, r * 0.86)
        }
        for (const [x, y, r, id] of lista) {
          fc.fillStyle = corDe(3, id)
          disco(fc, x - r * 0.36, y - r * 0.42, r * 0.36)
        }
      }
      camadaDe(true)
      camadaDe(false)
      if (q.buraco[2] > 0) {
        fc.globalCompositeOperation = 'destination-out'
        fc.beginPath()
        fc.ellipse(X(q.buraco[0]), Y(q.buraco[1]), q.buraco[2] * m * 0.92, q.buraco[3] * m * 0.92, 0, 0, Math.PI * 2)
        fc.fill()
        fc.globalCompositeOperation = 'source-over'
      }
      ctx.drawImage(camada, 0, 0)

      // argolas
      for (let k = 0; k < NA; k++) {
        const th = q.aneis[k * 4 + 3]
        if (th <= 0) continue
        const ax = X(q.aneis[k * 4])
        const ay = Y(q.aneis[k * 4 + 1])
        const R = q.aneis[k * 4 + 2] * m
        ctx.beginPath()
        ctx.arc(ax, ay, R, 0, Math.PI * 2)
        ctx.strokeStyle = rgb(q.cores, 0)
        ctx.lineWidth = th * 2 * m + 2
        ctx.stroke()
        ctx.strokeStyle = rgb(q.cores, 6)
        ctx.lineWidth = th * 2 * m
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(ax, ay, R, Math.PI * 1.05, Math.PI * 1.55)
        ctx.strokeStyle = rgb(q.cores, 9)
        ctx.lineWidth = Math.max(1, th * m)
        ctx.stroke()
      }
      // olhos
      if (q.olhos[0] > 0.01) {
        const abre = q.olhos[0] * (1 - q.olhos[1])
        for (const sx of [-1, 1]) {
          const ox = X(q.olhosP[0] + sx * q.olhosP[3])
          const oy = Y(q.olhosP[1])
          const R = q.olhosP[2] * m
          ctx.save()
          ctx.beginPath()
          ctx.arc(ox, oy, R, 0, Math.PI * 2)
          ctx.fillStyle = '#fff7fb'
          ctx.fill()
          ctx.clip()
          ctx.fillStyle = '#140310'
          disco(ctx, ox + q.olhos[2] * R * 0.38, oy + R * 0.27, R * 0.5)
          ctx.fillStyle = '#fff'
          disco(ctx, ox + q.olhos[2] * R * 0.38 - R * 0.17, oy + R * 0.09, R * 0.12)
          const tampa = oy + R * (-1.05 + 2.1 * (1 - abre))
          ctx.fillStyle = rgb(q.cores, 6)
          ctx.fillRect(ox - R - 1, oy - R - 1, 2 * R + 2, tampa - (oy - R - 1))
          ctx.fillStyle = rgb(q.cores, 0)
          ctx.fillRect(ox - R - 1, tampa - 1, 2 * R + 2, 2)
          ctx.restore()
          ctx.beginPath()
          ctx.arc(ox, oy, R, 0, Math.PI * 2)
          ctx.strokeStyle = rgb(q.cores, 0)
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
      }
      // boca
      if (q.boca[3] > 0.01) {
        const bx = X(q.boca[0])
        const byy = Y(q.boca[1])
        const L = q.boca[2] * m
        const ab = q.boca[3]
        ctx.beginPath()
        if (q.bico > 0.5) ctx.ellipse(bx, byy, L * 0.55 * Math.min(ab, 1.3), L * 0.6 * Math.min(ab, 1.3), 0, 0, Math.PI * 2)
        else {
          ctx.moveTo(bx - L, byy - L * 0.08 * ab + L * 0.32 * ab)
          ctx.quadraticCurveTo(bx, byy - L * 0.08 * ab, bx + L, byy - L * 0.08 * ab + L * 0.32 * ab)
          ctx.quadraticCurveTo(bx, byy + L * 0.9 * ab, bx - L, byy - L * 0.08 * ab + L * 0.32 * ab)
        }
        ctx.fillStyle = '#2b0418'
        ctx.fill()
        if (q.bico <= 0.5) {
          // dentes em cima e a língua embaixo, recortados na boca
          ctx.save()
          ctx.clip()
          ctx.fillStyle = '#fffaf2'
          ctx.fillRect(bx - L, byy - L * 0.2 * ab, 2 * L, L * 0.34 * ab)
          ctx.fillStyle = '#ff6b9a'
          ctx.beginPath()
          ctx.ellipse(bx, byy + L * 0.62 * ab, L * 0.42, L * 0.24 * ab, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
        ctx.strokeStyle = rgb(q.cores, 0)
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      // clarão
      if (q.flash > 0.01) {
        ctx.fillStyle = padrao('#fffbe6', q.flash)
        ctx.fillRect(0, 0, w, h)
      }
    },
  }
}
