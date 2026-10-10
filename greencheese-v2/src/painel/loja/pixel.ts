// A arte em pixel do produto sem foto nem ilustração, igual à do site (ArteProduto.compor sem a foto): o desenho
// do formato com as cores dele, a luz de aro, o brilho da cor e o dither na paleta curta. Pedaço à parte do painel
// (o desenho dos formatos pesa): baixa na primeira vez que uma arte em pixel aparece. Sai em PNG (data URL), guardado
// por produto, cor e tamanho.
import { desenharArte, paletaDoDesenho } from '../../arte/produtos/desenhar'
import { aplicarAro, aplicarBrilho, corDoBrilho, ditherizar, montarPaleta, NEUTROS, silhuetaDe } from '../../arte/produtos/dither'
import type { Arte } from './tipos'

const prontas = new Map<string, string>()

function sementeDe(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0
  return h
}

export interface PixelPedido {
  id: string
  nome: string
  cor: string
  arte: Arte
  /** Largura em pixel da arte (a altura é 16:9 disso). */
  largura: number
  cinza?: boolean
}

export function pixelDoProduto({ id, nome, cor, arte, largura, cinza = false }: PixelPedido): string {
  const w = Math.max(16, Math.round(largura))
  const h = Math.round((w * 16) / 9)
  const chave = [id, nome, cor, arte.tipo, arte.corpo, arte.faixa, arte.rotulo, arte.detalhe, arte.tampa, w, cinza].join('|')
  const pronta = prontas.get(chave)
  if (pronta) return pronta
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return ''
  desenharArte(ctx, arte, w, h, { nome })
  const px = ctx.getImageData(0, 0, w, h)
  const silhueta = silhuetaDe(px)
  const alternativas = [arte.faixa, arte.tampa, arte.detalhe, arte.rotulo]
  const tom = corDoBrilho(cor, alternativas).rgb
  if (!cinza) aplicarAro(px, silhueta, tom)
  const composta = aplicarBrilho(px, cinza ? '#9a9a9a' : cor, cinza ? 0.22 : 1, alternativas)
  const final = ditherizar(composta, {
    cinza,
    contraste: 1.06,
    grao: cinza ? 0.03 : 0.04,
    semente: sementeDe(id),
    paleta: cinza ? undefined : montarPaleta(paletaDoDesenho(arte), [tom], NEUTROS),
  })
  ctx.clearRect(0, 0, w, h)
  ctx.putImageData(final, 0, 0)
  const url = c.toDataURL('image/png')
  prontas.set(chave, url)
  return url
}
