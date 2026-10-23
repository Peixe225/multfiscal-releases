/**
 * O destaque do desafio na tela inicial (v3.3) — a parte leve, que a tela inicial carrega: espera a tela pintar e o
 * navegador sossegar e só então traz o ./DestaqueDesafioCorpo (a lista dos desafios, os emblemas, os ícones e o troféu) e
 * pede a lista ao servidor. v3.5: antes esse pedaço vinha junto com a tela inicial e, no 4G lento, disputava a rede com o
 * "Começar carreira". Sem rede ou com o servidor antigo, nada aparece (o lazySite da tela inicial segura a falha).
 */
import { useEffect, useState, type ComponentType } from 'react'

/** Espera antes de buscar o pedaço e a lista (a tela inicial e o jogo vêm primeiro). */
const ESPERA_MS = 1800

export default function DestaqueDesafio() {
  const [Corpo, setCorpo] = useState<ComponentType | null>(null)
  useEffect(() => {
    let parado = false
    let idle = 0
    const ir = () => {
      if (parado) return
      // sem rede agora: nada aparece (é só o destaque; a tela inicial segue igual)
      import('./DestaqueDesafioCorpo').then(
        (m) => {
          if (!parado) setCorpo(() => m.default)
        },
        () => {},
      )
    }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    const t = window.setTimeout(() => (w.requestIdleCallback ? (idle = w.requestIdleCallback(ir, { timeout: 4000 })) : ir()), ESPERA_MS)
    return () => {
      parado = true
      window.clearTimeout(t)
      if (idle) w.cancelIdleCallback?.(idle)
    }
  }, [])
  return Corpo ? <Corpo /> : null
}

/**
 * v3.4 §E: mede a faixa (e de novo a cada mudança de largura): no celular, a frase "com emblema" sai inteira ou não sai (nada de
 * "Desafios c…"); no computador, o desafio que desceu para a 2ª linha (escondida) sai do Tab e do leitor de tela. Direto no DOM
 * (classe e atributos que o React não controla), para medir sem esperar outro render. Sem ResizeObserver: como antes.
 */
export function medirFaixa(nav: HTMLElement) {
  nav.classList.remove('is-curta')
  const c = nav.querySelector<HTMLElement>('.s4-faixa__c')
  if (c && c.getClientRects().length && c.scrollWidth > c.clientWidth + 1) nav.classList.add('is-curta')
  const bs = [...nav.querySelectorAll<HTMLElement>('.s4-faixa__d')]
  const topo = bs[0]?.offsetTop ?? 0
  for (const b of bs) {
    const fora = b.offsetTop > topo + 2
    b.classList.toggle('is-fora', fora)
    if (fora) {
      b.tabIndex = -1
      b.setAttribute('aria-hidden', 'true')
    } else {
      b.removeAttribute('tabindex')
      b.removeAttribute('aria-hidden')
    }
  }
}
