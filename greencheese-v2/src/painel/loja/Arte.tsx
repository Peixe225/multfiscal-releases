// O produto da loja como o site mostra: a foto que o dono mandou (o preto da foto some no preto, como no site), a
// ilustração do produto (os do catálogo de antes) ou a arte em pixel do formato e da cor, com o halo pontilhado da
// cor do produto atrás. Indisponível: em cinza, como no site.
import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { Arte as Ilustracao } from '../../arte/realista/comum'
import { haloDataUrl, temTransparencia } from '../../arte/sintonia'
import { corDoHalo, urlImagem } from '../Arte'
import type { Arte } from './tipos'

let artes: Record<string, Ilustracao> | null = null
let pedido: Promise<void> | null = null
const ouvintes = new Set<() => void>()

function carregar(): void {
  pedido ??= import('../../arte/realista/index').then(
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

/** As ilustrações do site (null até baixar). */
export function useIlustracoes(): Record<string, Ilustracao> | null {
  const a = useSyncExternalStore(assinar, () => artes)
  useEffect(() => {
    if (!a) carregar()
  }, [a])
  return a
}

type Pixel = typeof import('./pixel')
let pixel: Pixel | null = null
let pedidoPixel: Promise<void> | null = null
const ouvintesPixel = new Set<() => void>()
function carregarPixel(): void {
  pedidoPixel ??= import('./pixel').then(
    (m) => {
      pixel = m
      ouvintesPixel.forEach((f) => f())
    },
    () => {
      pedidoPixel = null
    },
  )
}
function assinarPixel(f: () => void) {
  ouvintesPixel.add(f)
  return () => ouvintesPixel.delete(f)
}

export interface ProdutoArte {
  id: string
  nome: string
  cor: string
  arte: Arte
  foto: string | null
  /** Thumb animada (vídeo e capa): toca no lugar da foto, como no card do site. */
  video?: string | null
  capa?: string | null
}

interface Props {
  produto: ProdutoArte
  /** Largura em px (a arte é 9:16). */
  largura: number
  halo?: boolean
  /** Cinza, como o indisponível do site. */
  cinza?: boolean
  className?: string
}

export function ArteProduto({ produto, largura, halo = true, cinza = false, className }: Props) {
  const lista = useIlustracoes()
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const Desenho = !produto.foto && !(produto.video && produto.capa) ? lista?.[produto.id] : undefined
  const mod = useSyncExternalStore(assinarPixel, () => pixel)
  // foto que não abre (apagada do servidor, sem rede): cai no desenho
  const [fotoFalhou, setFotoFalhou] = useState<string | null>(null)
  // com thumb animada: a capa e o vídeo por cima (como o card do site); sem, a foto
  const animada = !!produto.video && !!produto.capa && fotoFalhou !== produto.capa
  const foto = animada ? (produto.capa ?? null) : produto.foto && fotoFalhou !== produto.foto ? produto.foto : null
  const emPixel = !foto && !Desenho && !!lista
  useEffect(() => {
    if (emPixel && !mod) carregarPixel()
  }, [emPixel, mod])
  // a arte em pixel com resolução de ~1 pixel da arte por 2 px de tela (nítida e leve)
  const url = emPixel && mod ? mod.pixelDoProduto({ id: produto.id, nome: produto.nome, cor: produto.cor, arte: produto.arte, largura: Math.min(90, Math.max(27, Math.round(largura / 2))), cinza }) : null
  // o halo é o mesmo desenho do site (pontilhado Bayer da cor do produto, cinza no indisponível)
  const estilo = { width: largura, '--pn-halo': cinza ? '#636363' : corDoHalo(produto.cor), '--pn-halo-img': halo ? `url(${haloDataUrl(produto.cor, cinza)})` : undefined } as CSSProperties
  return (
    <span className={`pn-arte pn-arte-loja${halo ? ' pn-arte-halo pn-arte-halo-site' : ''}${cinza ? ' pn-arte-cinza' : ''}${className ? ` ${className}` : ''}`} style={estilo} aria-hidden="true">
      {animada && !cinza && produto.video && foto ? (
        <VideoPequeno src={urlImagem(produto.video)} capa={urlImagem(foto)} aoFalhar={() => setFotoFalhou(produto.capa ?? null)} />
      ) : foto ? (
        <img className="pn-arte-foto pn-arte-foto-loja" src={urlImagem(foto)} alt="" draggable={false} onError={() => setFotoFalhou(foto)} onLoad={(e) => e.currentTarget.toggleAttribute('data-alfa', temTransparencia(e.currentTarget))} />
      ) : Desenho ? (
        <svg className="pn-arte-svg" viewBox="0 0 360 640" preserveAspectRatio="xMidYMid meet">
          <Desenho id={`pl${id}`} />
        </svg>
      ) : url ? (
        <img className="pn-arte-pixel" src={url} alt="" draggable={false} />
      ) : (
        <span className="pn-arte-espera" />
      )}
    </span>
  )
}

/** A thumb animada pequena do painel: sem som, em volta, tocando só enquanto aparece na tela; a capa é o pôster. */
function VideoPequeno({ src, capa, aoFalhar }: { src: string; capa: string; aoFalhar: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.muted = true
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) v.play().catch(() => {})
      else v.pause()
    })
    io.observe(v)
    return () => io.disconnect()
  }, [src])
  return <video ref={ref} className="pn-arte-foto pn-arte-foto-loja pn-arte-video" src={src} poster={capa} muted loop playsInline preload="metadata" aria-hidden="true" tabIndex={-1} onError={aoFalhar} />
}

/** "Dichavador de metal 4 partes 55 mm", sem quebrar o tamanho no meio ("55" numa linha e "mm" na outra). */
export function NomeProduto({ p }: { p: { nome: string; tamanho: string } }) {
  const tam = p.tamanho && !p.nome.toLowerCase().includes(p.tamanho.toLowerCase()) ? p.tamanho : ''
  return (
    <>
      {p.nome}
      {tam && <span className="pn-nowrap"> {tam}</span>}
    </>
  )
}
