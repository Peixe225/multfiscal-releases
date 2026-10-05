// O produto como aparece no site: ilustração realista (SVG) ou foto, flutuando no preto com halo pontilhado da cor dele.
// Na 1ª vez que entra na tela, "sintoniza": chiado → versão em pixel art → produto real (dissolve em ordem Bayer).
// Indisponível: o mesmo produto em cinza, com dither recortado na silhueta e chiado andando por dentro.
// Sem ilustração nem foto, cai na arte em pixel (ArteProduto).

import { useEffect, useId, useLayoutEffect, useRef, type CSSProperties } from 'react'
import type { Produto } from '../lib/tipos'
import { movimentoReduzido } from '../lib/movimento'
import { ArteProduto, gerarImagemArte } from './ArteProduto'
import { carregarArtesRealistas, useArtesRealistas } from './realista/carregar'
import './ProdutoVisual.css'

export interface PropsProdutoVisual {
  produto: Produto
  /** Largura da camada em pixel (halo e revelação). A ilustração em si é vetorial. */
  largura?: number
  indisponivel?: boolean
  revelar?: boolean
  brilho?: boolean
  className?: string
  style?: CSSProperties
  prioridade?: boolean
  /** null = decorativo (o nome já aparece em texto ao lado). */
  rotulo?: string | null
}

/* ---------------------------------------------------------------- Bayer 8×8 */

const BAYER = (() => {
  const m = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ]
  return (x: number, y: number) => (m[y & 7][x & 7] + 0.5) / 64
})()

/* ---------------------------------------------------------------- halo pontilhado */

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Trava de matiz: verde e roxo viram cinza (verde só no ✅; nada de roxo). */
function corDoHalo(hex: string, cinza: boolean): [number, number, number] {
  if (cinza) return [150, 150, 150]
  const [r, g, b] = hexRgb(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d < 18) return [r, g, b]
  let h = 0
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h = (h * 60 + 360) % 360
  if ((h > 75 && h < 165) || (h > 255 && h < 300)) return [168, 168, 168]
  return [r, g, b]
}

const halos = new Map<string, string>()

/** Halo radial quantizado em Bayer (3 níveis), gerado uma vez por cor e guardado como dataURL. */
function haloDataUrl(cor: string, cinza: boolean): string {
  const chave = `${cor}|${cinza}`
  const pronto = halos.get(chave)
  if (pronto) return pronto
  const w = 90
  const h = 160
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(w, h)
  const [r, g, b] = corDoHalo(cor, cinza)
  const cx = w / 2
  const cy = h * 0.5
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // elipse um pouco mais alta que larga, como o brilho atrás do produto nos stories
      const dx = (x - cx) / (w * 0.46)
      const dy = (y - cy) / (h * 0.36)
      const dist = Math.sqrt(dx * dx + dy * dy)
      const v = Math.max(0, 1 - dist) ** 1.6 * (cinza ? 0.5 : 0.95)
      if (v <= BAYER(x, y)) continue
      const k = (y * w + x) * 4
      const nivel = v > 0.6 ? 1 : v > 0.3 ? 0.72 : 0.45
      img.data[k] = r
      img.data[k + 1] = g
      img.data[k + 2] = b
      img.data[k + 3] = Math.round(255 * nivel)
    }
  ctx.putImageData(img, 0, 0)
  const url = c.toDataURL('image/png')
  halos.set(chave, url)
  return url
}

/* ---------------------------------------------------------------- revelação */

const revelados = new Set<string>()

/**
 * Chiado → pixel art → produto real. A camada de cima (canvas em resolução de pixel) começa como ruído, vira a arte
 * em pixel e some em ordem Bayer, deixando ver a ilustração por baixo.
 */
function sintonizar(canvas: HTMLCanvasElement, pixel: ImageData, aoMostrarReal: () => void, aoTerminar: () => void): () => void {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    aoMostrarReal()
    aoTerminar()
    return () => {}
  }
  const w = pixel.width
  const h = pixel.height
  canvas.width = w
  canvas.height = h
  const quadro = ctx.createImageData(w, h)
  const src = pixel.data
  const dst = quadro.data
  const dur = 1000
  const t0 = performance.now()
  let raf = 0
  let real = false
  let semente = 1
  const ruido = () => {
    semente = (semente * 16807) % 2147483647
    return semente / 2147483647
  }
  const passo = (agora: number) => {
    const t = Math.min(1, (agora - t0) / dur)
    // 0–0,45: ruído vira pixel art; 0,45–1: pixel art dissolve no produto real
    const a = Math.min(1, t / 0.45)
    const b = t <= 0.45 ? 0 : (t - 0.45) / 0.55
    if (b > 0 && !real) {
      real = true
      aoMostrarReal()
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4
        const lim = BAYER(x, y)
        if (b > lim) {
          dst[k + 3] = 0
          continue
        }
        if (a > lim) {
          dst[k] = src[k]
          dst[k + 1] = src[k + 1]
          dst[k + 2] = src[k + 2]
          dst[k + 3] = src[k + 3]
        } else if (ruido() < 0.16) {
          const v = 90 + Math.floor(ruido() * 150)
          dst[k] = v
          dst[k + 1] = v
          dst[k + 2] = v
          dst[k + 3] = 255
        } else dst[k + 3] = 0
      }
    ctx.putImageData(quadro, 0, 0)
    if (t < 1) raf = requestAnimationFrame(passo)
    else {
      ctx.clearRect(0, 0, w, h)
      aoTerminar()
    }
  }
  raf = requestAnimationFrame(passo)
  return () => cancelAnimationFrame(raf)
}

/* ---------------------------------------------------------------- componente */

export function ProdutoVisual(props: PropsProdutoVisual) {
  const { produto, largura = 90, indisponivel = false, revelar = true, brilho = true, className, style, prioridade = false } = props
  const artes = useArtesRealistas()
  const Arte = artes?.[produto.id]
  const temReal = !!Arte || !!produto.foto
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const raiz = useRef<HTMLDivElement>(null)
  const camada = useRef<HTMLCanvasElement>(null)
  const chave = `${produto.id}|${indisponivel ? 'off' : 'on'}`

  // revelação na 1ª vez que entra na tela (por produto + estado); sem movimento reduzido
  useLayoutEffect(() => {
    if (!temReal) return
    const el = raiz.current
    const cv = camada.current
    if (!el || !cv) return
    const animar = revelar && !revelados.has(chave) && !movimentoReduzido()
    el.dataset.real = animar ? 'nao' : 'sim'
    if (!animar) return
    let cancelar: (() => void) | undefined
    let vivo = true
    const iniciar = () => {
      revelados.add(chave)
      gerarImagemArte(produto, largura, { indisponivel, brilho: false }).then(
        (pix) => {
          if (!vivo) return
          cancelar = sintonizar(
            cv,
            pix,
            () => {
              el.dataset.real = 'sim'
            },
            () => {
              cancelar = undefined
            },
          )
        },
        () => {
          el.dataset.real = 'sim'
        },
      )
    }
    if (prioridade || typeof IntersectionObserver === 'undefined') {
      iniciar()
      return () => {
        vivo = false
        cancelar?.()
      }
    }
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return
        io.disconnect()
        iniciar()
      },
      { threshold: 0.2 },
    )
    io.observe(el)
    return () => {
      vivo = false
      io.disconnect()
      cancelar?.()
      // se saiu no meio, mostra o real da próxima vez
      if (el.dataset.real !== 'sim') revelados.delete(chave)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, temReal, revelar, prioridade])

  // halo como fundo (dataURL pronto, sem canvas vivo)
  useLayoutEffect(() => {
    const el = raiz.current
    if (!el || !brilho) return
    el.style.setProperty('--pv-halo', `url(${haloDataUrl(produto.cor, indisponivel)})`)
  }, [produto.cor, indisponivel, brilho])

  useEffect(() => {
    if (!artes) carregarArtesRealistas().catch(() => {})
  }, [artes])

  if (!temReal) return <ArteProduto {...props} />

  const g = `${uid}-g`
  return (
    <div
      ref={raiz}
      className={`pv ${indisponivel ? 'pv-off' : ''} ${brilho ? 'pv-com-halo' : ''} ${className ?? ''}`}
      style={style}
      role={props.rotulo === null ? undefined : 'img'}
      aria-label={props.rotulo === null ? undefined : (props.rotulo ?? produto.nome) + (indisponivel ? ', indisponível' : '')}
      aria-hidden={props.rotulo === null ? true : undefined}
      data-real="sim"
    >
      {produto.foto ? (
        <img className="pv-real" src={fotoUrl(produto.foto)} alt="" loading={prioridade ? 'eager' : 'lazy'} decoding="async" draggable={false} />
      ) : (
        Arte && (
          <svg className="pv-real" viewBox="0 0 360 640" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
            {indisponivel && (
              <defs>
                {/* dither cinza recortado na silhueta do produto (máscara pelo alfa do próprio desenho) */}
                <pattern id={`${uid}-d`} width="6" height="6" patternUnits="userSpaceOnUse">
                  <rect width="3" height="3" fill="#000" />
                  <rect x="3" y="3" width="3" height="3" fill="#000" />
                </pattern>
                <pattern id={`${uid}-r`} width="48" height="48" patternUnits="userSpaceOnUse">
                  <rect x="3" y="7" width="3" height="3" fill="#fff" />
                  <rect x="29" y="2" width="3" height="3" fill="#ddd" />
                  <rect x="17" y="31" width="3" height="3" fill="#fff" />
                  <rect x="40" y="22" width="6" height="3" fill="#bbb" />
                  <rect x="8" y="41" width="3" height="3" fill="#eee" />
                  <rect x="36" y="38" width="3" height="3" fill="#fff" />
                </pattern>
                <mask id={`${uid}-m`} maskUnits="userSpaceOnUse" x="0" y="0" width="360" height="640" style={{ maskType: 'alpha' }}>
                  <use href={`#${g}`} />
                </mask>
              </defs>
            )}
            <g id={g} className="pv-desenho">
              <Arte id={uid} />
            </g>
            {indisponivel && (
              <g mask={`url(#${uid}-m)`}>
                <rect width="360" height="640" fill={`url(#${uid}-d)`} opacity="0.55" />
                <rect className="pv-chiado" x="-48" y="-48" width="456" height="736" fill={`url(#${uid}-r)`} opacity="0.5" />
              </g>
            )}
          </svg>
        )
      )}
      <canvas ref={camada} className="pv-camada" width={1} height={1} aria-hidden="true" />
    </div>
  )
}

function fotoUrl(foto: string): string {
  if (/^(https?:|data:|blob:)/.test(foto)) return foto
  return `${import.meta.env.BASE_URL}${foto.replace(/^\/+/, '')}`
}
