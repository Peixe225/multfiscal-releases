// O produto como aparece no site: ilustração realista (SVG) ou foto, flutuando no preto com halo pontilhado da cor dele.
// Na 1ª vez que entra na tela, "sintoniza": chiado → versão em pixel art → produto real (dissolve em ordem Bayer).
// Indisponível: o mesmo produto em cinza, com dither recortado na silhueta e chiado andando por dentro.
// Sem ilustração nem foto, cai na arte em pixel (ArteProduto).
// Thumb animada (o vídeo que o dono fez no Estúdio do produto): onde `video` está ligado (card da grade, story aberto e
// página do produto), mostra a capa e, depois da sintonia, toca o vídeo por cima enquanto ele está à vista (no máximo 2
// ao mesmo tempo, nunca antes da primeira tela pintar; quem toca e quando: video-produto.ts, que só baixa se precisar).
// Movimento reduzido, economia de dados ou vídeo que o navegador não toca: fica na capa. Erro no vídeo: volta pra foto
// ou pra ilustração, como se não tivesse vídeo.

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Produto } from '../lib/tipos'
import { movimentoReduzido, quandoRespirar } from '../lib/movimento'
import { ArteProduto, gerarImagemArte } from './ArteProduto'
import { carregarArtesRealistas, useArtesRealistas } from './realista/carregar'
import { haloDataUrl, sintonizar } from './sintonia'
import type { RegistroVideo } from './video-produto'
import './ProdutoVisual.css'

export interface PropsProdutoVisual {
  produto: Produto
  /** Largura da camada em pixel (halo e revelação). A ilustração em si é vetorial. */
  largura?: number
  indisponivel?: boolean
  /** Sintoniza na 1ª vez que entra na tela. 'sempre' = sintoniza toda vez que monta (o story do prêmio). */
  revelar?: boolean | 'sempre'
  brilho?: boolean
  className?: string
  style?: CSSProperties
  prioridade?: boolean
  /** null = decorativo (o nome já aparece em texto ao lado). */
  rotulo?: string | null
  /** Toca a thumb animada (o vídeo do produto, quando tem) enquanto está à vista: card da grade, story aberto, página. */
  video?: boolean
}

/* ---------------------------------------------------------------- thumb animada: quando pode */

let primeiraTela: Promise<void> | null = null

/**
 * A primeira tela já pintou: a página carregou, a maior pintura (LCP) saiu e o navegador respirou. Antes disso nenhum
 * vídeo baixa (nem o código que cuida deles).
 */
function depoisDaPrimeiraTela(): Promise<void> {
  primeiraTela ??= new Promise<void>((ok) => {
    const respirar = () => quandoRespirar(ok, 2000)
    const carregou = () => {
      const tipos = typeof PerformanceObserver === 'undefined' ? [] : (PerformanceObserver.supportedEntryTypes ?? [])
      if (!tipos.includes('largest-contentful-paint')) return respirar()
      let feito = false
      const fim = () => {
        if (feito) return
        feito = true
        po.disconnect()
        respirar()
      }
      const po = new PerformanceObserver((l) => {
        if (l.getEntries().length) fim()
      })
      po.observe({ type: 'largest-contentful-paint', buffered: true })
      window.setTimeout(fim, 3000)
    }
    if (document.readyState === 'complete') carregou()
    else window.addEventListener('load', carregou, { once: true })
  })
  return primeiraTela
}

/** Movimento reduzido, economia de dados (ou 2G) e vídeo que o navegador não toca: fica na capa. */
function videoPodeTocar(src: string): boolean {
  if (movimentoReduzido()) return false
  const rede = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (rede?.saveData || /(^|-)2g$/.test(rede?.effectiveType ?? '')) return false
  try {
    return document.createElement('video').canPlayType(src.endsWith('.webm') ? 'video/webm' : 'video/mp4') !== ''
  } catch {
    return false
  }
}

/** Trava de matiz do halo (verde e roxo viram cinza): também pinta o confete do prêmio. */
export { corDoHalo } from './sintonia'

const revelados = new Set<string>()

/* ---------------------------------------------------------------- componente */

export function ProdutoVisual(props: PropsProdutoVisual) {
  const { produto, largura = 90, indisponivel = false, revelar = true, brilho = true, className, style, prioridade = false, video: querVideo = false } = props
  const artes = useArtesRealistas()
  const Arte = artes?.[produto.id]
  // vídeo que deu erro: o produto volta pra foto ou pra ilustração, como se não tivesse vídeo
  const [videoFalhou, setVideoFalhou] = useState<string | null>(null)
  const temVideo = !!produto.video && !!produto.capa && videoFalhou !== produto.video
  const tocar = querVideo && temVideo && !indisponivel
  // a imagem do produto: a foto; sem foto, a capa do vídeo. Onde o vídeo toca, a capa (o 1º quadro dele: a troca não pula)
  const imagem = tocar ? (produto.capa ?? null) : (produto.foto ?? (temVideo ? (produto.capa ?? null) : null))
  const temReal = !!Arte || !!imagem
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const raiz = useRef<HTMLDivElement>(null)
  const camada = useRef<HTMLCanvasElement>(null)
  const filme = useRef<HTMLVideoElement>(null)
  const registro = useRef<RegistroVideo | null>(null)
  const revelando = useRef(false)
  const chave = `${produto.id}|${indisponivel ? 'off' : 'on'}`

  // revelação na 1ª vez que entra na tela (por produto + estado); sem movimento reduzido
  useLayoutEffect(() => {
    if (!temReal) return
    const el = raiz.current
    const cv = camada.current
    if (!el || !cv) return
    const animar = !!revelar && (revelar === 'sempre' || !revelados.has(chave)) && !movimentoReduzido()
    el.dataset.real = animar ? 'nao' : 'sim'
    if (!animar) return
    revelando.current = true
    registro.current?.pronto(false)
    let cancelar: (() => void) | undefined
    let vivo = true
    // a sintonia acabou (ou não deu): o vídeo, se tiver, pode tocar
    const revelou = () => {
      revelando.current = false
      registro.current?.pronto(true)
    }
    const iniciar = () => {
      revelados.add(chave)
      gerarImagemArte(imagem === produto.foto ? produto : { ...produto, foto: imagem }, largura, { indisponivel, brilho: false }).then(
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
              revelou()
            },
          )
        },
        () => {
          el.dataset.real = 'sim'
          revelou()
        },
      )
    }
    if (prioridade || typeof IntersectionObserver === 'undefined') {
      iniciar()
      return () => {
        vivo = false
        cancelar?.()
        revelando.current = false
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
      revelando.current = false
      // se saiu no meio, mostra o real da próxima vez
      if (el.dataset.real !== 'sim') revelados.delete(chave)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, temReal, revelar, prioridade])

  // thumb animada: depois da primeira tela, quem cuida dos vídeos (video-produto.ts) decide quando este toca
  const videoSrc = tocar ? (produto.video ?? null) : null
  useEffect(() => {
    const el = raiz.current
    const v = filme.current
    if (!videoSrc || !el || !v || !videoPodeTocar(videoSrc)) return
    let vivo = true
    depoisDaPrimeiraTela()
      .then(() => import('./video-produto'))
      .then(
        (m) => {
          if (!vivo) return
          registro.current = m.registrarVideo(el, v, fotoUrl(videoSrc), () => setVideoFalhou(videoSrc))
          registro.current.pronto(!revelando.current && el.dataset.real !== 'nao')
        },
        () => {},
      )
    return () => {
      vivo = false
      registro.current?.soltar()
      registro.current = null
    }
  }, [videoSrc])

  // halo como fundo (dataURL pronto, sem canvas vivo)
  useLayoutEffect(() => {
    const el = raiz.current
    if (!el || !brilho) return
    el.style.setProperty('--pv-halo', `url(${haloDataUrl(produto.cor, indisponivel)})`)
  }, [produto.cor, indisponivel, brilho])

  useEffect(() => {
    if (!artes) carregarArtesRealistas().catch(() => {})
  }, [artes])

  // o chiado do indisponível só anda na tela: fora dela (o resto da grade, a sacola fechada) para e não gasta CPU
  useEffect(() => {
    const el = raiz.current
    if (!el || !indisponivel || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => el.toggleAttribute('data-fora', !e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [indisponivel, temReal])

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
      {imagem ? (
        <img className="pv-real" src={fotoUrl(imagem)} alt="" loading={prioridade ? 'eager' : 'lazy'} decoding="async" draggable={false} />
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
      {/* a thumb animada: sem src até a vez dele (nada baixa antes); aparece quando o 1º quadro chega, por cima da capa */}
      {videoSrc && <video ref={filme} className="pv-real pv-video" muted loop playsInline preload="none" disablePictureInPicture disableRemotePlayback aria-hidden="true" tabIndex={-1} />}
      <canvas ref={camada} className="pv-camada" width={1} height={1} aria-hidden="true" />
    </div>
  )
}

function fotoUrl(foto: string): string {
  if (/^(https?:|data:|blob:)/.test(foto)) return foto
  return `${import.meta.env.BASE_URL}${foto.replace(/^\/+/, '')}`
}
