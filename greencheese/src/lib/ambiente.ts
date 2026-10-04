// Onde o site está rodando: dentro de outro app (iframe, como o preview do Claude) ou numa aba normal.

export function dentroDeIframe(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

/**
 * target dos links de saída (WhatsApp, Instagram). No celular, sem target: o navegador do Instagram é imprevisível
 * com _blank e o link troca de app sozinho. No computador ou dentro de iframe, _blank (o WhatsApp não abre em iframe).
 */
export function alvoDeSaida(): '_blank' | undefined {
  try {
    if (dentroDeIframe() || window.matchMedia('(pointer: fine)').matches) return '_blank'
  } catch {
    /* sem matchMedia */
  }
  return undefined
}

/**
 * Teclado virtual: o navegador do celular não encolhe a tela de layout quando o teclado abre (iOS e Chrome),
 * então as folhas fixas embaixo ficariam atrás dele. Publica a altura coberta em --teclado.
 */
export function vigiarTeclado(): () => void {
  const vv = window.visualViewport
  if (!vv) return () => {}
  const raiz = document.documentElement
  const atualizar = () => {
    const coberto = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
    raiz.style.setProperty('--teclado', `${Math.round(coberto)}px`)
    raiz.classList.toggle('com-teclado', coberto > 80)
  }
  vv.addEventListener('resize', atualizar)
  vv.addEventListener('scroll', atualizar)
  atualizar()
  return () => {
    vv.removeEventListener('resize', atualizar)
    vv.removeEventListener('scroll', atualizar)
  }
}
