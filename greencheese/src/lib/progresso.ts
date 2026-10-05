import { useEffect, useLayoutEffect, useRef } from 'react'
import { movimentoReduzido } from './movimento'

/**
 * Barrinha de progresso do story: animação de transform (scaleX) pela Web Animations API, que corre no compositor —
 * a thread principal fica livre enquanto o story toca (antes era um requestAnimationFrame mexendo no estilo a cada
 * quadro). Pausa e retoma de onde parou; não depende de animação CSS (que o modo de movimento reduzido zera).
 * `chave` reinicia a contagem (ex.: índice do story).
 */
export function useProgresso(opts: { ativo: boolean; duracaoMs: number; chave: string | number; aoTerminar: () => void }) {
  const barra = useRef<HTMLElement | null>(null)
  const atual = useRef<{ a: Animation | null; el: HTMLElement | null; chave: string | number; dur: number } | null>(null)
  const fim = useRef(opts.aoTerminar)
  fim.current = opts.aoTerminar
  const ativo = useRef(opts.ativo)
  ativo.current = opts.ativo

  const acertar = () => {
    const a = atual.current?.a
    if (!a || a.playState === 'finished') return
    if (ativo.current && !document.hidden) a.play()
    else a.pause()
  }

  // a cada render, antes da pintura: chave nova zera (a animação velha sai e a barra volta ao estilo dela, que quem
  // acerta as outras barras define depois); a mesma chave numa barra nova (a lista mudou) continua de onde estava
  useLayoutEffect(() => {
    const el = barra.current
    const v = atual.current
    if (v && v.el === el && v.chave === opts.chave && v.dur === opts.duracaoMs) {
      acertar()
      return
    }
    const mesma = !!v && v.chave === opts.chave && v.dur === opts.duracaoMs
    const herdado = mesma ? (v?.a?.currentTime ?? null) : null
    if (v?.a) {
      v.a.onfinish = null
      v.a.cancel()
    }
    atual.current = { a: null, el, chave: opts.chave, dur: opts.duracaoMs }
    if (!el) return
    if (!mesma) el.style.transform = 'scaleX(0)'
    // movimento reduzido: a barra não corre (quem desenha as barras deixa a atual cheia, parada)
    if (typeof el.animate !== 'function' || movimentoReduzido()) return
    const a = el.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: opts.duracaoMs, easing: 'linear', fill: 'forwards' })
    a.pause()
    if (typeof herdado === 'number') a.currentTime = herdado
    a.onfinish = () => fim.current()
    atual.current.a = a
    acertar()
  })

  // aba escondida pausa (a contagem não corre por trás); ao sair, a animação some junto
  useEffect(() => {
    document.addEventListener('visibilitychange', acertar)
    return () => {
      document.removeEventListener('visibilitychange', acertar)
      const a = atual.current?.a
      if (a) {
        a.onfinish = null
        a.cancel()
      }
      atual.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return barra
}
