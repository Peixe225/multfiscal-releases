// O produto da vitrine em pixel, no tamanho de pixel da rua (1 px da imagem = 1 pixel da arte da cena): da foto que o
// dono mandou ou, sem foto, do desenho em pixel do produto (src/arte/produtos/desenhar.ts, as cores e a marca dele).
// Nesse tamanho (12 × 21) a ilustração realista vira borrão; o desenho foi feito para ler pequeno. Paleta curta tirada
// do próprio produto (o dither Bayer do site), a luz de aro de cima na cor dele, um contorno escuro do tom dele e um
// brilho pontilhado em volta: colorido para chamar o olho no cenário cinza da rua. Uma vez por produto (cache).

import { carregarFoto } from '../../arte/produtos/cache'
import { desenharArte, paletaDoDesenho } from '../../arte/produtos/desenhar'
import { aplicarAro, corDoBrilho, ditherizar, montarPaleta, NEUTROS, paletaDaImagem, recortarFundoPreto, silhuetaDe, type Cor } from '../../arte/produtos/dither'
import type { Produto } from '../../lib/tipos'
import type { Folha } from './pacote'

/** A caixa do produto na rua (px da arte): cabe na palma do mercador, meia cabeça acima do ombro. */
export const PRODUTO_W = 12
export const PRODUTO_H = 21
/** Folga em volta, para o contorno e o brilho. */
const MARGEM = 2
/** A fonte é desenhada a 90 × 160 (o tamanho do card) e reduzida: o desenho tem os detalhes certos nessa escala. */
const FONTE_W = 90
const FONTE_H = 160

export interface ArteNaRua {
  w: number
  h: number
  /** Onde a palma segura (o pixel logo abaixo do meio do produto). */
  pega: [number, number]
  img: HTMLCanvasElement
}

function urlDaFoto(foto: string): string {
  if (/^(https?:|data:|blob:)/.test(foto)) return foto
  return `${import.meta.env.BASE_URL}${foto.replace(/^\/+/, '')}`
}

function telaDe(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('sem canvas 2d')
  return g
}

/** A foto em "contain", fundo preto recortado (como o produto no story), ou null se não der (outro domínio sem CORS). */
function daFoto(img: HTMLImageElement): ImageData | null {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) return null
  const g = telaDe(FONTE_W, FONTE_H)
  const k = Math.min((FONTE_W * 0.9) / iw, (FONTE_H * 0.84) / ih)
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.drawImage(img, (FONTE_W - iw * k) / 2, (FONTE_H - ih * k) / 2, iw * k, ih * k)
  try {
    const d = g.getImageData(0, 0, FONTE_W, FONTE_H)
    recortarFundoPreto(d)
    return d
  } catch {
    return null
  }
}

function doDesenho(p: Produto): ImageData {
  const g = telaDe(FONTE_W, FONTE_H)
  desenharArte(g, p.arte, FONTE_W, FONTE_H, { nome: p.nome })
  return g.getImageData(0, 0, FONTE_W, FONTE_H)
}

/** Recorta na caixa do que aparece e reduz até caber em w × h (em passos de metade: a média fica limpa). */
function caber(src: ImageData, w: number, h: number): ImageData | null {
  const { width: sw, height: sh, data: d } = src
  let x0 = sw
  let y0 = sh
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++)
      if (d[(y * sw + x) * 4 + 3] > 40) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return null
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  const k = Math.min(w / bw, h / bh)
  const tw = Math.max(2, Math.round(bw * k))
  const th = Math.max(2, Math.round(bh * k))
  const base = telaDe(sw, sh)
  base.putImageData(src, 0, 0)
  let fonte: HTMLCanvasElement = base.canvas
  let fx = x0
  let fy = y0
  let fw = bw
  let fh = bh
  while (fw / 2 >= tw && fh / 2 >= th) {
    const m = telaDe(Math.ceil(fw / 2), Math.ceil(fh / 2))
    m.imageSmoothingEnabled = true
    m.imageSmoothingQuality = 'high'
    m.drawImage(fonte, fx, fy, fw, fh, 0, 0, m.canvas.width, m.canvas.height)
    fonte = m.canvas
    fx = 0
    fy = 0
    fw = m.canvas.width
    fh = m.canvas.height
  }
  const out = telaDe(tw, th)
  out.imageSmoothingEnabled = true
  out.imageSmoothingQuality = 'high'
  out.drawImage(fonte, fx, fy, fw, fh, 0, 0, tw, th)
  return out.getImageData(0, 0, tw, th)
}

/** Pontilha na paleta curta, acende o aro e põe o contorno e o brilho em volta, com a folga da margem. */
function pixelar(p: Produto, img: ImageData, base: readonly Cor[]): ArteNaRua {
  const alternativas = [p.arte.faixa, p.arte.tampa, p.arte.detalhe, p.arte.rotulo]
  const tom = corDoBrilho(p.cor, alternativas).rgb
  const pontos = ditherizar(img, { paleta: montarPaleta(base, [tom], NEUTROS), grao: 0.02, semente: 3 })
  aplicarAro(pontos, silhuetaDe(pontos), tom, 0.6)
  const W = pontos.width + MARGEM * 2
  const H = pontos.height + MARGEM * 2
  const g = telaDe(W, H)
  const out = g.createImageData(W, H)
  const o = out.data
  for (let y = 0; y < pontos.height; y++)
    for (let x = 0; x < pontos.width; x++) {
      const i = (y * pontos.width + x) * 4
      if (pontos.data[i + 3] < 128) continue
      const k = ((y + MARGEM) * W + x + MARGEM) * 4
      o[k] = pontos.data[i]
      o[k + 1] = pontos.data[i + 1]
      o[k + 2] = pontos.data[i + 2]
      o[k + 3] = 255
    }
  const anel = (cor: readonly number[], so: (x: number, y: number) => boolean) => {
    const s = silhuetaDe(out)
    const tem = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && s[y * W + x] === 1
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (s[y * W + x] || !(tem(x - 1, y) || tem(x + 1, y) || tem(x, y - 1) || tem(x, y + 1)) || !so(x, y)) continue
        const k = (y * W + x) * 4
        o[k] = cor[0]
        o[k + 1] = cor[1]
        o[k + 2] = cor[2]
        o[k + 3] = 255
      }
  }
  // contorno no tom dele, bem escuro (separa do casaco e do muro), e o brilho pontilhado por fora
  anel(
    tom.map((v) => Math.round(v * 0.35)),
    () => true,
  )
  anel(tom, (x, y) => (x + y) % 2 === 0)
  g.putImageData(out, 0, 0)
  // a palma pega pela linha de baixo (o brilho): o produto fica de pé em cima da mão
  return { w: W, h: H, pega: [Math.floor(W / 2), H - 1], img: g.canvas }
}

const prontas = new Map<string, Promise<ArteNaRua | null>>()

/** Tudo que muda o desenho entra na chave (o dono troca foto, cor e desenho no painel). */
export function chaveDaArte(p: Produto): string {
  const a = p.arte
  return [p.id, p.nome, p.foto ?? '', p.cor, a.tipo, a.corpo, a.faixa, a.rotulo, a.detalhe, a.tampa].join('|')
}

/** O produto em pixel na escala da rua (uma vez por produto; null se não deu para desenhar). */
export function arteNaRua(p: Produto): Promise<ArteNaRua | null> {
  const chave = chaveDaArte(p)
  let pronta = prontas.get(chave)
  if (!pronta) {
    pronta = (async () => {
      if (p.foto) {
        try {
          const fonte = daFoto(await carregarFoto(urlDaFoto(p.foto)))
          const pequena = fonte && caber(fonte, PRODUTO_W, PRODUTO_H)
          if (pequena) return pixelar(p, pequena, paletaDaImagem(pequena, 8))
        } catch {
          /* a foto não veio: o desenho */
        }
      }
      const pequena = caber(doDesenho(p), PRODUTO_W, PRODUTO_H)
      return pequena ? pixelar(p, pequena, paletaDoDesenho(p.arte)) : null
    })().catch(() => null)
    prontas.set(chave, pronta)
  }
  return pronta
}

/** A folha do produto para o motor (um quadro só, que não espelha: o rótulo fica legível dos dois lados). */
export function folhaDoProduto(id: string, a: ArteNaRua): Folha {
  return {
    id,
    w: a.w,
    h: a.h,
    ancora: { x: a.pega[0], y: a.pega[1] },
    colunas: 1,
    anims: { parado: { laco: false, duracao: 1000, q: [{ d: 0, e: 0, ms: 1000, passo: 0, mao: null, caixa: [0, 0, a.w, a.h] }] } },
    retrato: { animacao: 'parado', quadro: 0 },
    img: a.img,
  }
}
