// O produto como o site mostra, dentro do Estúdio: o preto, o halo pontilhado da cor do produto (o mesmo desenho do
// site, src/arte/sintonia.ts), a imagem com o preto sumindo no preto (lighten) e a sintonia (chiado → pixel art →
// produto), feita com a mesma composição da arte em pixel do site (src/arte/produtos/compor.ts).
import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react'
import { compor } from '../../arte/produtos/compor'
import { haloDataUrl, sintonizar } from '../../arte/sintonia'
import type { Produto } from '../../lib/tipos'

interface Props extends HTMLAttributes<HTMLDivElement> {
  largura: number
  cor: string
  cinza?: boolean
  /** A camada "real" (o canvas da foto tratada ou do vídeo). */
  children: ReactNode
  /** Muda pra tocar a sintonia (com a imagem de agora). null = sem sintonia. */
  sintonia: { vez: number; imagem: HTMLCanvasElement } | null
  /** Sem o halo (a thumb animada: quadro sobre preto, sem transparência; no site ela fica sem o halo). */
  semHalo?: boolean
}

/** A arte em pixel da foto tratada, como o site gera (90×160, sem o brilho: o da revelação). */
export function pixelDaImagem(imagem: HTMLCanvasElement, cor: string): ImageData {
  const p: Produto = { id: 'estudio', nome: '', categoria: '', preco: null, disponivel: {}, demo: false, foto: 'estudio', cor, arte: { tipo: 'lata', corpo: cor } }
  return compor(p, 90, 160, false, false, imagem, 'estudio')
}

export function Vitrine({ largura, cor, cinza = false, children, sintonia, semHalo = false, className, style, ...resto }: Props) {
  const raiz = useRef<HTMLDivElement>(null)
  const camada = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = raiz.current
    const cv = camada.current
    if (!sintonia || !el || !cv) return
    let pix: ImageData
    try {
      pix = pixelDaImagem(sintonia.imagem, cor)
    } catch {
      return
    }
    el.dataset.real = 'nao'
    const parar = sintonizar(
      cv,
      pix,
      () => {
        el.dataset.real = 'sim'
      },
      () => {},
    )
    return () => {
      parar()
      el.dataset.real = 'sim'
    }
    // a sintonia toca quando a vez muda (não a cada mudança de cor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sintonia?.vez])
  return (
    <div
      ref={raiz}
      className={`pn-est-vitrine${cinza ? ' pn-est-cinza' : ''}${semHalo ? ' pn-est-sem-halo' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: largura, height: Math.round((largura * 16) / 9), ['--pn-est-halo' as string]: `url(${haloDataUrl(cor, cinza)})`, ...style }}
      data-real="sim"
      {...resto}
    >
      {children}
      <canvas ref={camada} className="pn-est-camada" width={1} height={1} aria-hidden="true" />
    </div>
  )
}
