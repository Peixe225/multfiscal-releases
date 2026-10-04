import { useEffect, useRef } from 'react'

/**
 * Barrinha de progresso do story conduzida por JS (requestAnimationFrame + transform: scaleX), para poder pausar
 * e para não depender de animação CSS (que o modo de movimento reduzido zera).
 * `chave` reinicia a contagem (ex.: índice do story).
 */
export function useProgresso(opts: { ativo: boolean; duracaoMs: number; chave: string | number; aoTerminar: () => void }) {
  const barra = useRef<HTMLElement | null>(null)
  const decorrido = useRef(0)
  const fim = useRef(opts.aoTerminar)
  fim.current = opts.aoTerminar

  // nova chave: zera
  useEffect(() => {
    decorrido.current = 0
    if (barra.current) barra.current.style.transform = 'scaleX(0)'
  }, [opts.chave])

  useEffect(() => {
    if (!opts.ativo) return
    let raf = 0
    let antes = performance.now()
    const passo = (agora: number) => {
      decorrido.current += Math.min(100, agora - antes)
      antes = agora
      const p = Math.min(1, decorrido.current / opts.duracaoMs)
      if (barra.current) barra.current.style.transform = `scaleX(${p})`
      if (p >= 1) {
        fim.current()
        return
      }
      raf = requestAnimationFrame(passo)
    }
    raf = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(raf)
  }, [opts.ativo, opts.duracaoMs, opts.chave])

  return barra
}
