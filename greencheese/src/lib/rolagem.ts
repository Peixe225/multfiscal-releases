import type Lenis from 'lenis'

// Uma instância de Lenis (só com mouse) e um contador de travas: story e folhas param a rolagem da página.

let lenis: Lenis | null = null
let travas = 0

export function registrarLenis(l: Lenis | null) {
  lenis = l
}

export function obterLenis(): Lenis | null {
  return lenis
}

export function travarRolagem() {
  travas++
  if (travas === 1) {
    document.body.classList.add('travado')
    lenis?.stop()
  }
}

export function liberarRolagem() {
  travas = Math.max(0, travas - 1)
  if (travas === 0) {
    document.body.classList.remove('travado')
    lenis?.start()
  }
}

export function rolarPara(alvo: string | HTMLElement, deslocamento = 0) {
  const el = typeof alvo === 'string' ? document.querySelector<HTMLElement>(alvo) : alvo
  if (!el) return
  if (lenis) lenis.scrollTo(el, { offset: deslocamento })
  else {
    const y = el.getBoundingClientRect().top + window.scrollY + deslocamento
    window.scrollTo({ top: y, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
}
