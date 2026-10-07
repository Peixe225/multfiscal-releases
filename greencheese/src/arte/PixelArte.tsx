// Desenha uma Grade de pixel art como SVG nítido.
// Pixels vizinhos da mesma cor viram um <rect> só (corrida na linha, depois empilhada
// com a linha de baixo quando a corrida é igual), então um ícone 16×16 sai com poucos nós.
//
// Pixel inteiro na tela: a caixa fica do tamanho pedido (o layout não mexe), mas o desenho dentro dela
// é ajustado para que cada pixel da grade ocupe um número inteiro de pixels do aparelho (DPR 1, 2, 2,625, 3…),
// centrado. Assim 24 px num Android de DPR 2,625 não sai com pixels desiguais. Se o ajuste passar da caixa,
// o desenho transborda um pouco (overflow visível) em vez de encolher pela metade. Com ancora="base" a sobra (ou a folga)
// vai toda para cima: o pé do desenho fica sempre no fundo da caixa, e o que vem embaixo não muda com o DPR.
//
// Tamanhos recomendados (múltiplos da grade): ícones 16/32/48, emblemas 48/72/96, mercador 132/176.

import { useEffect, useId, useSyncExternalStore, type CSSProperties } from 'react'
import { TRANSPARENTE, COR_TEXTO, validarGrade, type Grade } from './pixel/grades'

interface Retangulo {
  x: number
  y: number
  w: number
  h: number
  /** undefined = currentColor (herda o fill do <svg>). */
  cor: string | undefined
}

// A grade é imutável: calcula os retângulos uma vez e reaproveita em todas as instâncias.
const cache = new WeakMap<Grade, Retangulo[]>()

function retangulos(grade: Grade): Retangulo[] {
  const pronto = cache.get(grade)
  if (pronto) return pronto
  if (import.meta.env.DEV) validarGrade(grade)

  const saida: Retangulo[] = []
  // Corridas abertas da linha anterior, por "x:w:caractere", para empilhar na vertical.
  let abertas = new Map<string, Retangulo>()

  for (let y = 0; y < grade.h; y++) {
    const linha = grade.linhas[y] ?? ''
    const novas = new Map<string, Retangulo>()
    let x = 0
    while (x < grade.w) {
      const c = linha[x] ?? TRANSPARENTE
      if (c === TRANSPARENTE) {
        x++
        continue
      }
      let fim = x + 1
      while (fim < grade.w && linha[fim] === c) fim++
      const chave = `${x}:${fim - x}:${c}`
      const acima = abertas.get(chave)
      if (acima) {
        acima.h++
        novas.set(chave, acima)
      } else {
        const r: Retangulo = { x, y, w: fim - x, h: 1, cor: c === COR_TEXTO ? undefined : grade.paleta?.[c] }
        saida.push(r)
        novas.set(chave, r)
      }
      x = fim
    }
    abertas = novas
  }

  cache.set(grade, saida)
  return saida
}

/* ── densidade da tela (devicePixelRatio), com aviso quando muda (zoom, outro monitor) ── */

const ouvintes = new Set<() => void>()
let consulta: MediaQueryList | null = null

function religar() {
  consulta?.removeEventListener('change', mudou)
  consulta = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
  consulta.addEventListener('change', mudou)
}
function mudou() {
  religar()
  ouvintes.forEach((avisar) => avisar())
}
function assinarDpr(avisar: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  ouvintes.add(avisar)
  if (ouvintes.size === 1) religar()
  return () => {
    ouvintes.delete(avisar)
    if (ouvintes.size === 0) {
      consulta?.removeEventListener('change', mudou)
      consulta = null
    }
  }
}
const lerDpr = () => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
const lerDprServidor = () => 1

type Ancora = 'centro' | 'base'

/** viewBox que põe a grade com pixel inteiro de tela dentro de uma caixa de `largura` px CSS. */
function viewBoxAjustado(grade: Grade, largura: number, dpr: number, ancora: Ancora): string {
  const tela = largura * dpr
  // px de tela por pixel da grade: o inteiro mais perto (empate arredonda para baixo), no mínimo 1
  const passo = Math.max(1, Math.ceil(tela / grade.w - 0.5))
  const vw = tela / passo
  const vh = (vw * grade.h) / grade.w
  // centrado na largura; na altura, centrado ou com a última linha da grade no fundo da caixa
  const y = ancora === 'base' ? grade.h - vh : (grade.h - vh) / 2
  const n = (v: number) => Math.round(v * 1e4) / 1e4
  return `${n((grade.w - vw) / 2)} ${n(y)} ${n(vw)} ${n(vh)}`
}

// Em dev, avisa uma vez por grade/tamanho quando o tamanho não é múltiplo da grade.
const avisados = new Set<string>()
function avisarTamanho(grade: Grade, largura: number) {
  const chave = `${grade.w}x${grade.h}@${largura}`
  if (avisados.has(chave)) return
  avisados.add(chave)
  const bons = [1, 2, 3, 4].map((k) => k * grade.w).join('/')
  if (largura < grade.w) {
    console.warn(`[pixel] ${largura} px é menor que a grade ${grade.w}×${grade.h}: traço de 1 px some em tela de DPR 1. Use ${bons} px.`)
  } else if (largura % grade.w !== 0) {
    console.warn(`[pixel] ${largura} px não é múltiplo de ${grade.w} (grade ${grade.w}×${grade.h}): o desenho é ajustado ao pixel da tela dentro da caixa. Prefira ${bons} px.`)
  }
}

export interface PixelArteProps {
  grade: Grade
  /**
   * Largura: número em px (de preferência múltiplo de grade.w) ou valor CSS ("2em", "100%"). Padrão: grade.w px.
   * Com número, o desenho é ajustado ao pixel inteiro da tela dentro da caixa; com valor CSS, não.
   */
  tamanho?: number | string
  /** Alternativa ao tamanho: quantos px CSS por pixel da grade (inteiro ≥ 1). Largura = grade.w × escala. */
  escala?: number
  /**
   * Onde o desenho ajustado ao pixel da tela se apoia na caixa. "centro" (padrão): sobra igual em cima e embaixo.
   * "base": a última linha fica no fundo da caixa e a sobra vai para cima (personagem de pé sobre o que vem embaixo).
   */
  ancora?: Ancora
  className?: string
  /** Texto para leitor de tela. Sem ele a arte é decorativa (aria-hidden). */
  titulo?: string
  style?: CSSProperties
}

export function PixelArte({ grade: pedida, tamanho, escala, ancora = 'centro', className, titulo, style }: PixelArteProps) {
  const idTitulo = useId()
  const dpr = useSyncExternalStore(assinarDpr, lerDpr, lerDprServidor)

  const escalaInteira = escala != null ? Math.max(1, Math.round(escala)) : undefined
  const largura = escalaInteira != null ? pedida.w * escalaInteira : (tamanho ?? pedida.w)
  const numero = typeof largura === 'number'
  // A versão detalhada entra quando cada pixel dela cabe em 2 px CSS ou mais (moto: a partir de 64 px).
  const grade = numero && pedida.grande && largura >= pedida.grande.w * 2 ? pedida.grande : pedida
  // Com número a altura sai da proporção; com valor CSS o aspect-ratio resolve.
  const altura = numero ? (largura * grade.h) / grade.w : undefined
  const viewBox = numero ? viewBoxAjustado(grade, largura, dpr, ancora) : `0 0 ${grade.w} ${grade.h}`
  const rects = retangulos(grade)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (escala != null && (!Number.isInteger(escala) || escala < 1)) console.warn(`[pixel] escala ${escala} não é inteiro ≥ 1; usando ${escalaInteira}.`)
    if (typeof largura === 'number') avisarTamanho(grade, largura)
  }, [grade, largura, escala, escalaInteira])

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      width={largura}
      height={altura}
      fill="currentColor"
      shapeRendering="crispEdges"
      className={className}
      style={{ aspectRatio: `${grade.w} / ${grade.h}`, flexShrink: 0, overflow: 'visible', ...style }}
      {...(titulo
        ? { role: 'img', 'aria-labelledby': idTitulo }
        : { 'aria-hidden': true, focusable: false })}
    >
      {titulo ? <title id={idTitulo}>{titulo}</title> : null}
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.cor} />
      ))}
    </svg>
  )
}

/** Quantos <rect> a grade gera (para conferir no laboratório). */
export function contarRetangulos(grade: Grade): number {
  return retangulos(grade).length
}
