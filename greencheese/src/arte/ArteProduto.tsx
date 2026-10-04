// A arte do produto: desenhada em código (ou a foto, quando houver), tratada em dither Bayer,
// flutuando no preto com o brilho da cor dele. Nasce do chiado na 1ª vez que aparece na tela.

import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import type { Produto } from '../lib/tipos'
import { movimentoReduzido } from '../lib/movimento'
import { desenharArte } from './produtos/desenhar'
import { corDominante, desenharBrilho, ditherizar, recortarFundoPreto, revelar as revelarArte } from './produtos/dither'
import { carregarFoto, imagemEmCache, jaRevelada, lembrar, marcarRevelada, mascaraEmCache } from './produtos/cache'
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

// Dois canvas reaproveitados: camada do produto e composição final. Só são usados em trechos
// síncronos (depois do await da foto), então dá para compartilhar entre todas as artes.
const rascunhos: (CanvasRenderingContext2D | null)[] = [null, null]

function rascunho(i: 0 | 1, w: number, h: number): CanvasRenderingContext2D {
  let ctx = rascunhos[i]
  if (!ctx) {
    const c = document.createElement('canvas')
    ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('canvas 2d indisponível')
    rascunhos[i] = ctx
  }
  // Trocar o tamanho limpa o canvas e zera o estado.
  ctx.canvas.width = w
  ctx.canvas.height = h
  if (ctx.canvas.width === w && ctx.canvas.height === h) ctx.clearRect(0, 0, w, h)
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
    // Daqui para baixo é síncrono (os rascunhos são compartilhados).
    const camada = rascunho(0, w, h)
    let cor = produto.cor
    if (foto) {
      desenharFoto(camada, foto, w, h)
      const px = camada.getImageData(0, 0, w, h)
      recortarFundoPreto(px)
      camada.putImageData(px, 0, 0)
      cor = corDominante(px)
    } else {
      desenharArte(camada, produto.arte, w, h)
    }
    const final = rascunho(1, w, h)
    if (brilho) desenharBrilho(final, indisponivel ? '#9a9a9a' : cor, w, h, indisponivel ? 0.4 : 1)
    final.drawImage(camada.canvas, 0, 0)
    return ditherizar(final.getImageData(0, 0, w, h), {
      niveis: 6,
      cinza: indisponivel,
      contraste: 1.06,
      grao: 0.05,
      semente: sementeDe(produto.id),
    })
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
    if (Math.random() > 0.14) continue
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
      el.style.setProperty('--arte-mascara', `url(${mascaraEmCache(chave, () => mascaraDe(img))})`)
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
          style={{ '--arte-ruido': `url(${texturaRuido()})`, '--arte-ruido-tam': `${(48 / (2 * w)) * 100}%` } as CSSProperties}
        />
      )}
    </div>
  )
}
