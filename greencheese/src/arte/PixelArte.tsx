// Desenha uma Grade de pixel art como SVG nítido.
// Pixels vizinhos da mesma cor viram um <rect> só (corrida na linha, depois empilhada
// com a linha de baixo quando a corrida é igual), então um ícone 16×16 sai com poucos nós.

import { useId, type CSSProperties } from 'react'
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

export interface PixelArteProps {
  grade: Grade
  /** Largura: número em px (de preferência múltiplo de grade.w, para o pixel ficar inteiro) ou valor CSS ("2em", "100%"). Padrão: grade.w px. */
  tamanho?: number | string
  className?: string
  /** Texto para leitor de tela. Sem ele a arte é decorativa (aria-hidden). */
  titulo?: string
  style?: CSSProperties
}

export function PixelArte({ grade, tamanho, className, titulo, style }: PixelArteProps) {
  const idTitulo = useId()
  const largura = tamanho ?? grade.w
  // Com número a altura sai da proporção; com valor CSS o aspect-ratio resolve.
  const altura = typeof largura === 'number' ? (largura * grade.h) / grade.w : undefined
  const rects = retangulos(grade)

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${grade.w} ${grade.h}`}
      width={largura}
      height={altura}
      fill="currentColor"
      shapeRendering="crispEdges"
      className={className}
      style={{ aspectRatio: `${grade.w} / ${grade.h}`, flexShrink: 0, ...style }}
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
