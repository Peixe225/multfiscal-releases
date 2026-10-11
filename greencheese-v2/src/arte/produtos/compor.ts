// A composição da arte em pixel de um produto (sem CSS nem React): o desenho do formato (ou a foto), a luz de aro, o
// brilho da cor e o dither na paleta curta. O ArteProduto (site) guarda e revela; o Estúdio do produto (painel) usa a
// mesma pra mostrar a sintonia da foto nova antes de salvar.
import type { Produto } from '../../lib/tipos'
import { guardarSilhueta } from './cache'
import { desenharArte, paletaDoDesenho } from './desenhar'
import { aplicarAro, aplicarBrilho, corDoBrilho, corDominante, ditherizar, montarPaleta, NEUTROS, paletaDaImagem, recortarFundoPreto, silhuetaDe, type Cor } from './dither'

/** A foto da arte: a imagem já carregada (no site) ou um canvas (a prévia do Estúdio). */
export type FotoDaArte = HTMLImageElement | HTMLCanvasElement

export function sementeDe(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0
  return h
}

/* ---------------------------------------------------------------- canvas de rascunho */

// Um canvas reaproveitado para todas as artes. Só é usado em trecho síncrono (depois do
// await da foto), então dá para compartilhar.
let rascunhoCtx: CanvasRenderingContext2D | null = null

function rascunho(w: number, h: number): CanvasRenderingContext2D {
  if (!rascunhoCtx) {
    rascunhoCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!rascunhoCtx) throw new Error('canvas 2d indisponível')
  }
  const ctx = rascunhoCtx
  // Mesmo tamanho: só limpa e zera o estado (redimensionar realoca).
  if (ctx.canvas.width !== w || ctx.canvas.height !== h) {
    ctx.canvas.width = w
    ctx.canvas.height = h
  } else {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, w, h)
  }
  return ctx
}

/**
 * Foto em "contain", com respiro, centrada (como o produto recortado no story). A que já vem em 9:16 (a do Estúdio do
 * produto e a capa do vídeo, enquadradas com as margens das ilustrações) ocupa o quadro inteiro, como a foto de verdade
 * por cima: a sintonia não muda de tamanho no meio.
 */
export function desenharFoto(ctx: CanvasRenderingContext2D, img: FotoDaArte, w: number, h: number) {
  const iw = (img instanceof HTMLImageElement ? img.naturalWidth : 0) || img.width
  const ih = (img instanceof HTMLImageElement ? img.naturalHeight : 0) || img.height
  if (!iw || !ih) return
  const quadro = Math.abs(iw / ih - 9 / 16) < 0.012
  const k = quadro ? Math.min(w / iw, h / ih) : Math.min((w * 0.9) / iw, (h * 0.84) / ih)
  const dw = iw * k
  const dh = ih * k
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

/** A arte final (ImageData w×h). chave: onde a silhueta fica guardada (o chiado do indisponível usa). */
export function compor(produto: Produto, w: number, h: number, indisponivel: boolean, brilho: boolean, foto: FotoDaArte | null, chave: string): ImageData {
  const camada = rascunho(w, h)
  let cor = produto.cor
  let px: ImageData | null = null
  let base: readonly Cor[] = []
  if (foto) {
    try {
      desenharFoto(camada, foto, w, h)
      px = camada.getImageData(0, 0, w, h)
      recortarFundoPreto(px)
      cor = corDominante(px)
      base = paletaDaImagem(px, 10)
    } catch {
      // foto de outro domínio sem CORS "suja" o canvas: volta para o desenho
      px = null
      camada.clearRect(0, 0, w, h)
    }
  }
  if (!px) {
    desenharArte(camada, produto.arte, w, h, { nome: produto.nome })
    px = camada.getImageData(0, 0, w, h)
    base = paletaDoDesenho(produto.arte)
  }
  // Silhueta lida ANTES do brilho: o chiado do indisponível cai só no produto, nunca no halo.
  const silhueta = silhuetaDe(px)
  guardarSilhueta(chave, silhueta)
  const a = produto.arte
  const alternativas = [a.faixa, a.tampa, a.detalhe, a.rotulo]
  const tom = corDoBrilho(cor, alternativas).rgb
  if (brilho && !indisponivel) aplicarAro(px, silhueta, tom)
  // Brilho em JS direto nos pixels (sem segundo canvas): é o trecho que pesa no Android.
  const composta = brilho ? aplicarBrilho(px, indisponivel ? '#9a9a9a' : cor, indisponivel ? 0.22 : 1, alternativas) : px
  return ditherizar(composta, {
    cinza: indisponivel,
    contraste: 1.06,
    grao: indisponivel ? 0.03 : 0.04,
    semente: sementeDe(produto.id),
    // paleta curta: as cores do produto, o tom do halo e os cinzas da interface
    paleta: indisponivel ? undefined : montarPaleta(base, brilho ? [tom] : [], NEUTROS),
  })
}
