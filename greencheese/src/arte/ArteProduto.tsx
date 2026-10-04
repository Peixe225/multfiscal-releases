// A arte do produto: desenhada em código (ou a foto, quando houver), tratada em dither Bayer,
// flutuando no preto com o brilho da cor dele. Nasce do chiado na 1ª vez que aparece na tela.

import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import type { Produto } from '../lib/tipos'
import { movimentoReduzido } from '../lib/movimento'
import { desenharArte } from './produtos/desenhar'
import { aplicarBrilho, corDominante, ditherizar, recortarFundoPreto, revelar as revelarArte } from './produtos/dither'
import { agendar, carregarFoto, imagemEmCache, jaRevelada, lembrar, marcarRevelada, mascaraEmCache } from './produtos/cache'
import './produtos/arte.css'

export interface PropsArteProduto {
  produto: Produto
  /** Largura da arte em px de arte (não de tela). Padrão 90 → altura 160 (9:16). */
  largura?: number
  /** Dither cinza + chiado por cima. */
  indisponivel?: boolean
  /** Nasce do chiado na 1ª vez que aparece. Padrão true. */
  revelar?: boolean
  /** Halo pontilhado da cor do produto. Padrão true. */
  brilho?: boolean
  className?: string
  style?: CSSProperties
  /** true = desenha já, sem esperar entrar na tela (hero, story aberto, chat). */
  prioridade?: boolean
}

export interface OpcoesArte {
  indisponivel?: boolean
  brilho?: boolean
}

/** Altura da arte para uma largura (9:16). */
export function alturaDaArte(largura: number): number {
  return Math.round((largura * 16) / 9)
}

function larguraValida(largura: number): number {
  return Math.max(8, Math.min(540, Math.round(largura)))
}

/** Tudo que muda o desenho entra na chave (a planilha pode trocar cor e arte em tempo real). */
function chaveArte(produto: Produto, w: number, indisponivel: boolean, brilho: boolean): string {
  const a = produto.arte
  return [produto.id, w, indisponivel ? 'cinza' : 'cor', brilho ? 'b' : 'sb', produto.foto ?? '', produto.cor, a.tipo, a.corpo, a.faixa, a.rotulo, a.detalhe, a.tampa].join('|')
}

function sementeDe(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0
  return h
}

function urlDaFoto(foto: string): string {
  if (/^(https?:|data:|blob:)/.test(foto)) return foto
  return `${import.meta.env.BASE_URL}${foto.replace(/^\/+/, '')}`
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

/** Foto em "contain", com respiro, centrada um pouco acima do meio (como no story). */
function desenharFoto(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) return
  const k = Math.min((w * 0.9) / iw, (h * 0.84) / ih)
  const dw = iw * k
  const dh = ih * k
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

/**
 * Gera (ou pega do cache) a imagem final da arte: desenho/foto + brilho + dither.
 * Reaproveitável fora do componente (ex.: a miniatura que voa até a sacola).
 */
export function gerarImagemArte(produto: Produto, largura: number, opts: OpcoesArte = {}): Promise<ImageData> {
  const w = larguraValida(largura)
  const h = alturaDaArte(w)
  const indisponivel = opts.indisponivel ?? false
  const brilho = opts.brilho ?? true
  return lembrar(chaveArte(produto, w, indisponivel, brilho), async () => {
    let foto: HTMLImageElement | null = null
    if (produto.foto) {
      try {
        foto = await carregarFoto(urlDaFoto(produto.foto))
      } catch {
        foto = null // sem foto: cai no desenho
      }
    }
    // A composição é síncrona (os rascunhos são compartilhados) e entra na fila por quadro.
    return agendar(() => compor(produto, w, h, indisponivel, brilho, foto))
  })
}

function compor(produto: Produto, w: number, h: number, indisponivel: boolean, brilho: boolean, foto: HTMLImageElement | null): ImageData {
  const camada = rascunho(w, h)
  let cor = produto.cor
  let px: ImageData
  if (foto) {
    desenharFoto(camada, foto, w, h)
    px = camada.getImageData(0, 0, w, h)
    recortarFundoPreto(px)
    cor = corDominante(px)
  } else {
    desenharArte(camada, produto.arte, w, h)
    px = camada.getImageData(0, 0, w, h)
  }
  // Brilho em JS direto nos pixels (sem segundo canvas): é o trecho que pesa no Android.
  const composta = brilho ? aplicarBrilho(px, indisponivel ? '#9a9a9a' : cor, indisponivel ? 0.35 : 1) : px
  return ditherizar(composta, {
    niveis: 6,
    cinza: indisponivel,
    contraste: 1.06,
    grao: indisponivel ? 0.03 : 0.04,
    semente: sementeDe(produto.id),
  })
}

/* ---------------------------------------------------------------- chiado */

let ruido: string | null = null

/** Textura de chiado (48×48), gerada uma vez: pontos cinza esparsos e riscos de VHS. */
function texturaRuido(): string {
  if (ruido) return ruido
  const n = 48
  const c = document.createElement('canvas')
  c.width = n
  c.height = n
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(n, n)
  const d = img.data
  for (let k = 0; k < n * n; k++) {
    if (Math.random() > 0.1) continue
    const v = 150 + Math.floor(Math.random() * 105)
    d[k * 4] = v
    d[k * 4 + 1] = v
    d[k * 4 + 2] = v
    d[k * 4 + 3] = 140 + Math.floor(Math.random() * 115)
  }
  // riscos horizontais (linha de VHS)
  for (let r = 0; r < 5; r++) {
    const y = Math.floor(Math.random() * n)
    const x0 = Math.floor(Math.random() * n)
    const len = 4 + Math.floor(Math.random() * 10)
    for (let x = x0; x < x0 + len; x++) {
      const i = (y * n + (x % n)) * 4
      d[i] = 230
      d[i + 1] = 230
      d[i + 2] = 230
      d[i + 3] = 190
    }
  }
  ctx.putImageData(img, 0, 0)
  ruido = c.toDataURL('image/png')
  return ruido
}

function mascaraDe(img: ImageData): string {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  c.getContext('2d')?.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}

/* ---------------------------------------------------------------- componente */

/**
 * <canvas> em resolução de arte (90×160 por padrão), ampliado a 100% do pai com pixel nítido.
 * Gera a arte quando chega perto da tela (300 px) e revela quando entra; com
 * prefers-reduced-motion, mostra a imagem final direto.
 */
export function ArteProduto({
  produto,
  largura = 90,
  indisponivel = false,
  revelar = true,
  brilho = true,
  className,
  style,
  prioridade = false,
}: PropsArteProduto) {
  const w = larguraValida(largura)
  const h = alturaDaArte(w)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chiadoRef = useRef<HTMLDivElement>(null)
  const produtoRef = useRef(produto)
  const chave = chaveArte(produto, w, indisponivel, brilho)

  // O efeito de baixo depende só da chave; o produto mais recente vem por ref.
  useLayoutEffect(() => {
    produtoRef.current = produto
  })

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let vivo = true
    let mostrado = false
    let naTela = prioridade
    let cancelar: (() => void) | undefined
    let imagem: ImageData | null = imagemEmCache(chave) ?? null
    const animar = revelar && !jaRevelada(chave) && !movimentoReduzido()
    const observadores: IntersectionObserver[] = []

    const prepararChiado = (img: ImageData) => {
      const el = chiadoRef.current
      if (!indisponivel || !el) return
      el.style.setProperty('--arte-mascara', `url("${mascaraEmCache(chave, () => mascaraDe(img))}")`)
      el.setAttribute('data-pronto', '')
    }

    const mostrar = () => {
      if (!vivo || mostrado || !imagem) return
      if (animar && !naTela) return
      mostrado = true
      marcarRevelada(chave)
      prepararChiado(imagem)
      if (animar) {
        cancelar = revelarArte(canvas, imagem, {
          aoTerminar: () => {
            cancelar = undefined
          },
        })
      } else {
        ctx.putImageData(imagem, 0, 0)
      }
    }

    const preparar = () => {
      if (imagem) return mostrar()
      gerarImagemArte(produtoRef.current, w, { indisponivel, brilho }).then(
        (img) => {
          imagem = img
          mostrar()
        },
        () => {},
      )
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // Já pronta e sem revelação: desenha antes do paint (nada pisca ao trocar de tela).
    if (imagem && !animar) mostrar()

    if (typeof IntersectionObserver === 'undefined') {
      naTela = true
      preparar()
    } else {
      if (prioridade) preparar()
      else {
        const perto = new IntersectionObserver(
          (es) => {
            if (!es.some((e) => e.isIntersecting)) return
            perto.disconnect()
            preparar()
          },
          { rootMargin: '300px' },
        )
        perto.observe(canvas)
        observadores.push(perto)
      }
      // Entrou de fato na tela: dispara a revelação; no indisponível, pausa o chiado fora dela.
      if ((animar && !prioridade) || indisponivel) {
        const tela = new IntersectionObserver(
          (es) => {
            naTela = es[es.length - 1].isIntersecting
            chiadoRef.current?.toggleAttribute('data-pausado', !naTela)
            if (naTela) mostrar()
            if (mostrado && !indisponivel) tela.disconnect()
          },
          { threshold: 0.12 },
        )
        tela.observe(canvas)
        observadores.push(tela)
      }
    }

    return () => {
      vivo = false
      cancelar?.()
      observadores.forEach((o) => o.disconnect())
    }
  }, [chave, w, h, indisponivel, brilho, revelar, prioridade])

  const classes = ['arte-produto', indisponivel ? 'arte-off' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <div className={classes} style={style} role="img" aria-label={produto.nome}>
      <canvas ref={canvasRef} width={w} height={h} aria-hidden="true" />
      {indisponivel && (
        <div
          ref={chiadoRef}
          className="arte-chiado"
          data-pausado=""
          aria-hidden="true"
          style={{ '--arte-ruido': `url("${texturaRuido()}")`, '--arte-ruido-tam': `${(48 / (2 * w)) * 100}%` } as CSSProperties}
        />
      )}
    </div>
  )
}
