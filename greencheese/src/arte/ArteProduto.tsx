// A arte do produto: desenhada em código (ou a foto, quando houver), com o brilho da cor dele, luz
// de aro e dither Bayer em paleta curta, flutuando no preto. Nasce do chiado na 1ª vez que o produto
// aparece; a revelação é do produto, não do tamanho (o card e o story são o mesmo elemento).

import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import type { Produto } from '../lib/tipos'
import { movimentoReduzido } from '../lib/movimento'
import { desenharArte, paletaDoDesenho } from './produtos/desenhar'
import {
  aplicarAro,
  aplicarBrilho,
  corDoBrilho,
  corDominante,
  ditherizar,
  montarPaleta,
  NEUTROS,
  paletaDaImagem,
  recortarFundoPreto,
  revelar as revelarArte,
  silhuetaDe,
  type Cor,
} from './produtos/dither'
import {
  agendar,
  carregarFoto,
  chaveRevelacao,
  chiadoEmCache,
  desmarcarRevelada,
  guardarSilhueta,
  guardarVizinha,
  imagemEmCache,
  jaRevelada,
  lembrar,
  marcarRevelada,
  silhuetaEmCache,
  vizinhaEmCache,
} from './produtos/cache'
import './produtos/arte.css'

export interface PropsArteProduto {
  produto: Produto
  /** Largura da arte em px de arte (não de tela). Padrão 90 → altura 160 (9:16). */
  largura?: number
  /** Dither cinza + chiado por cima. */
  indisponivel?: boolean
  /** Nasce do chiado na 1ª vez que aparece. Padrão true. */
  revelar?: boolean
  /** Halo pontilhado da cor do produto (e luz de aro). Padrão true. */
  brilho?: boolean
  className?: string
  style?: CSSProperties
  /** true = desenha já, sem esperar entrar na tela (hero, story aberto, chat). */
  prioridade?: boolean
  /**
   * Nome lido pelo leitor de tela. Padrão: o nome do produto (+ ", indisponível").
   * null = arte decorativa (aria-hidden), para quando o nome já está em texto ao lado (story, hero).
   */
  rotulo?: string | null
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

/** Tudo que muda o desenho entra na chave (a planilha pode trocar cor e arte em tempo real). '*' = qualquer largura. */
function chaveArte(produto: Produto, w: number | '*', indisponivel: boolean, brilho: boolean): string {
  const a = produto.arte
  return [produto.id, w, indisponivel ? 'cinza' : 'cor', brilho ? 'b' : 'sb', produto.nome, produto.foto ?? '', produto.cor, a.tipo, a.corpo, a.faixa, a.rotulo, a.detalhe, a.tampa].join('|')
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

/** Foto em "contain", com respiro, centrada (como o produto recortado no story). */
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
 * Gera (ou pega do cache) a imagem final da arte: desenho/foto + aro + brilho + dither.
 * Reaproveitável fora do componente (ex.: a miniatura que voa até a sacola).
 */
export function gerarImagemArte(produto: Produto, largura: number, opts: OpcoesArte = {}): Promise<ImageData> {
  const w = larguraValida(largura)
  const h = alturaDaArte(w)
  const indisponivel = opts.indisponivel ?? false
  const brilho = opts.brilho ?? true
  const chave = chaveArte(produto, w, indisponivel, brilho)
  return lembrar(chave, async () => {
    let foto: HTMLImageElement | null = null
    if (produto.foto) {
      try {
        foto = await carregarFoto(urlDaFoto(produto.foto))
      } catch {
        foto = null // sem foto: cai no desenho
      }
    }
    // A composição é síncrona (o rascunho é compartilhado) e entra na fila por quadro.
    const img = await agendar(() => compor(produto, w, h, indisponivel, brilho, foto, chave))
    guardarVizinha(chaveArte(produto, '*', indisponivel, brilho), img)
    return img
  })
}

function compor(produto: Produto, w: number, h: number, indisponivel: boolean, brilho: boolean, foto: HTMLImageElement | null, chave: string): ImageData {
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

/** A mesma arte em outro tamanho, ampliada sem suavizar (rascunho de 1 ou 2 quadros). */
function desenharRascunho(ctx: CanvasRenderingContext2D, img: ImageData, w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  c.getContext('2d')?.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(c, 0, 0, w, h)
}

/* ---------------------------------------------------------------- chiado */

const QUADROS_CHIADO = 3

/**
 * Quadros de chiado na resolução da arte, já recortados na silhueta: pontos cinza esparsos e um
 * ou dois riscos de VHS. Empilhados e alternados por opacity em degraus (CSS), ficam nítidos e
 * presos à grade do pixel da arte.
 */
function gerarChiado(silhueta: Uint8Array, w: number, h: number, semente: number): ImageData[] {
  let rng = semente | 0 || 0x2545f491
  const aleatorio = () => {
    rng ^= rng << 13
    rng ^= rng >>> 17
    rng ^= rng << 5
    return (rng >>> 0) / 4294967296
  }
  const quadros: ImageData[] = []
  for (let q = 0; q < QUADROS_CHIADO; q++) {
    const img = new ImageData(w, h)
    const d = img.data
    for (let k = 0; k < w * h; k++) {
      if (!silhueta[k] || aleatorio() > 0.16) continue
      const v = 150 + ((aleatorio() * 105) | 0)
      const i = k * 4
      d[i] = v
      d[i + 1] = v
      d[i + 2] = v
      d[i + 3] = 80 + ((aleatorio() * 100) | 0)
    }
    // riscos horizontais (linha de VHS), só onde há produto
    for (let r = 0; r < 1 + (q % 2); r++) {
      const y = (aleatorio() * h) | 0
      const x0 = (aleatorio() * w) | 0
      const fim = Math.min(w, x0 + 3 + ((aleatorio() * Math.max(4, w / 6)) | 0))
      for (let x = x0; x < fim; x++) {
        const k = y * w + x
        if (!silhueta[k]) continue
        const i = k * 4
        d[i] = 228
        d[i + 1] = 228
        d[i + 2] = 228
        d[i + 3] = 160
      }
    }
    quadros.push(img)
  }
  return quadros
}

/* ---------------------------------------------------------------- tamanho em escala inteira */

type AoMedir = (larguraTela: number, alturaTela: number) => void
const medidores = new WeakMap<Element, AoMedir>()
let observador: ResizeObserver | null | undefined

/** Um ResizeObserver só para todas as artes, medindo em pixels de tela quando o navegador deixa. */
function medir(el: Element, aoMedir: AoMedir): () => void {
  if (observador === undefined) {
    observador =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entradas) => {
            const dpr = window.devicePixelRatio || 1
            for (const e of entradas) {
              const fn = medidores.get(e.target)
              if (!fn) continue
              const tela = e.devicePixelContentBoxSize?.[0]
              if (tela) fn(tela.inlineSize, tela.blockSize)
              else fn(e.contentRect.width * dpr, e.contentRect.height * dpr)
            }
          })
  }
  const obs = observador
  if (!obs) return () => {}
  medidores.set(el, aoMedir)
  try {
    obs.observe(el, { box: 'device-pixel-content-box' })
  } catch {
    obs.observe(el)
  }
  return () => {
    obs.unobserve(el)
    medidores.delete(el)
  }
}

/**
 * Quadro 9:16 centrado na caixa, com um número inteiro de pixels de tela por pixel de arte:
 * colunas iguais e treliça de Bayer regular (sem moiré). Se o inteiro encolher a arte mais de
 * 14% (miniatura pequena), usa a escala fracionária que enche a caixa.
 */
function encaixar(quadro: HTMLElement, larguraTela: number, alturaTela: number, w: number, h: number) {
  if (larguraTela < 1 || alturaTela < 1) return
  const dpr = window.devicePixelRatio || 1
  const kf = Math.min(larguraTela / w, alturaTela / h)
  const k = Math.floor(kf)
  const inteiro = k >= 1 && k / kf >= 0.86
  const lw = inteiro ? w * k : Math.floor(w * kf)
  const lh = inteiro ? h * k : Math.floor(h * kf)
  quadro.style.width = `${lw / dpr}px`
  quadro.style.height = `${lh / dpr}px`
  quadro.toggleAttribute('data-inteiro', inteiro)
}

/* ---------------------------------------------------------------- componente */

/**
 * <canvas> em resolução de arte (90×160 por padrão), num quadro 9:16 centrado na caixa do pai e
 * ampliado em escala inteira com pixel nítido. Gera a arte quando chega perto da tela (300 px) e
 * revela quando entra; com prefers-reduced-motion, mostra a imagem final direto.
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
  rotulo,
}: PropsArteProduto) {
  const w = larguraValida(largura)
  const h = alturaDaArte(w)
  const caixaRef = useRef<HTMLDivElement>(null)
  const quadroRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chiadoRef = useRef<HTMLDivElement>(null)
  const produtoRef = useRef(produto)
  const chave = chaveArte(produto, w, indisponivel, brilho)
  const grupo = chaveArte(produto, '*', indisponivel, brilho)
  const revelacao = chaveRevelacao(produto.id, indisponivel)

  // O efeito da arte depende só das chaves; o produto mais recente vem por ref.
  useLayoutEffect(() => {
    produtoRef.current = produto
  })

  // Escala inteira: mede a caixa do pai e dimensiona o quadro.
  useLayoutEffect(() => {
    const caixa = caixaRef.current
    const quadro = quadroRef.current
    if (!caixa || !quadro) return
    return medir(caixa, (lt, at) => encaixar(quadro, lt, at, w, h))
  }, [w, h])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let vivo = true
    let mostrado = false
    let naTela = prioridade
    let cancelar: (() => void) | undefined
    let imagem: ImageData | null = imagemEmCache(chave) ?? null
    const animar = revelar && !jaRevelada(revelacao) && !movimentoReduzido()
    const observadores: IntersectionObserver[] = []

    const prepararChiado = (img: ImageData) => {
      const el = chiadoRef.current
      if (!indisponivel || !el) return
      const silhueta = silhuetaEmCache(chave) ?? silhuetaDe(img)
      const quadros = chiadoEmCache(chave, () => gerarChiado(silhueta, w, h, sementeDe(produtoRef.current.id)))
      el.querySelectorAll('canvas').forEach((c, i) => c.getContext('2d')?.putImageData(quadros[i % quadros.length], 0, 0))
      el.setAttribute('data-pronto', '')
    }

    const mostrar = () => {
      if (!vivo || mostrado || !imagem) return
      if (animar && !naTela) return
      mostrado = true
      marcarRevelada(revelacao)
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
    if (!animar) {
      // Já pronta: desenha antes do paint (nada pisca ao trocar de tela). Ainda na fila: a mesma
      // arte em outro tamanho segura o lugar (card de 72 virando story de 108).
      if (imagem) mostrar()
      else {
        const vizinha = vizinhaEmCache(grupo)
        if (vizinha) desenharRascunho(ctx, vizinha, w, h)
      }
    }

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
      // Revelação cortada no meio (inclusive pelo StrictMode em dev): na próxima vez ela aparece.
      if (cancelar) {
        cancelar()
        desmarcarRevelada(revelacao)
      }
      observadores.forEach((o) => o.disconnect())
    }
  }, [chave, grupo, revelacao, w, h, indisponivel, brilho, revelar, prioridade])

  const classes = ['arte-produto', indisponivel ? 'arte-off' : '', className ?? ''].filter(Boolean).join(' ')
  const nome = rotulo === null ? null : `${rotulo ?? produto.nome}${indisponivel ? ', indisponível' : ''}`
  return (
    <div
      ref={caixaRef}
      className={classes}
      style={style}
      role={nome === null ? undefined : 'img'}
      aria-label={nome ?? undefined}
      aria-hidden={nome === null ? true : undefined}
    >
      <div ref={quadroRef} className="arte-quadro">
        <canvas ref={canvasRef} width={w} height={h} aria-hidden="true" />
        {indisponivel && (
          <div ref={chiadoRef} className="arte-chiado" data-pausado="" aria-hidden="true">
            {Array.from({ length: QUADROS_CHIADO }, (_, i) => (
              <canvas key={i} width={w} height={h} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
