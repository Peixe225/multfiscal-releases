// A arte do rateio no painel: a imagem do rateio que o dono mandou, o produto do catálogo como o site mostra (a foto
// do produto, a ilustração ou o desenho em pixel; loja/Arte.tsx) ou a caixa de importação em pixel. Atrás, o halo
// pontilhado da cor do produto, com a trava de matiz do site (verde e roxo viram cinza).
import { useEffect, useId, useSyncExternalStore, type CSSProperties } from 'react'
import type { Arte } from '../arte/realista/comum'
import { PixelArte } from '../arte/PixelArte'
import { grade } from './icones'
import { produtoDoCatalogo } from './catalogo'
import { ArteProduto } from './loja/Arte'

let artes: Record<string, Arte> | null = null
let pedido: Promise<void> | null = null
const ouvintes = new Set<() => void>()

function carregar(): void {
  pedido ??= import('../arte/realista/index').then(
    (m) => {
      artes = m.artesRealistas
      ouvintes.forEach((f) => f())
    },
    () => {
      pedido = null
    },
  )
}

function assinar(f: () => void) {
  ouvintes.add(f)
  return () => ouvintes.delete(f)
}

function useArtes(): Record<string, Arte> | null {
  return useSyncExternalStore(assinar, () => artes)
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Mesma regra do site (ProdutoVisual): verde e roxo viram cinza. */
export function corDoHalo(hex: string | undefined): string {
  if (!hex) return '#a8a8a8'
  const [r, g, b] = rgb(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d < 18) return hex
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 360) % 360
  return (h > 75 && h < 165) || (h > 255 && h < 300) ? '#a8a8a8' : hex
}

export function urlImagem(imagem: string): string {
  // o servidor guarda 'uploads/<nome>' (relativo à raiz do site); o painel mora um nível abaixo
  return /^(blob:|data:|https?:)/.test(imagem) ? imagem : `../${imagem}`
}

interface Props {
  produtoId: string | null
  imagem: string | null
  /** Largura em px (a arte é 9:16). */
  largura: number
  halo?: boolean
  className?: string
  /** Pinta tudo em cinza (rateio cancelado). */
  apagada?: boolean
}

export function ArteRateio({ produtoId, imagem, largura, halo = true, className, apagada = false }: Props) {
  const lista = useArtes()
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const produto = produtoId ? produtoDoCatalogo(produtoId) : undefined
  const Desenho = produtoId ? lista?.[produtoId] : undefined
  useEffect(() => {
    if (produtoId && !imagem && !produto) carregar()
  }, [produtoId, imagem, produto])
  // sem imagem do rateio: o produto como o site mostra no cartão (a foto do produto, a ilustração ou o desenho em pixel)
  if (!imagem && produto) return <ArteProduto produto={produto} largura={largura} halo={halo} cinza={apagada} className={className} />
  const estilo = { width: largura, '--pn-halo': apagada ? '#636363' : corDoHalo(produto?.cor) } as CSSProperties
  const caixa = grade('caixa')
  return (
    <span className={`pn-arte${halo ? ' pn-arte-halo' : ''}${apagada ? ' pn-arte-apagada' : ''}${className ? ` ${className}` : ''}`} style={estilo} aria-hidden="true">
      {imagem ? (
        <img className="pn-arte-foto" src={urlImagem(imagem)} alt="" draggable={false} />
      ) : Desenho ? (
        <svg className="pn-arte-svg" viewBox="0 0 360 640" preserveAspectRatio="xMidYMid meet">
          <Desenho id={`pn${id}`} />
        </svg>
      ) : (
        caixa && (
          <span className="pn-arte-caixa">
            <PixelArte grade={caixa} tamanho={Math.max(16, Math.round((largura * 0.55) / 16) * 16)} />
          </span>
        )
      )}
    </span>
  )
}
