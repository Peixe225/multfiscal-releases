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

/** Campo que abre o teclado virtual (texto, número, e-mail, busca…; não checkbox, rádio, botão). */
function campoDeTexto(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el instanceof HTMLInputElement) return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(el.type)
  return el instanceof HTMLTextAreaElement || el.isContentEditable
}

/**
 * Teclado virtual. No iOS (e no Chrome sem interactive-widget) a tela de layout não encolhe quando o teclado abre:
 * as folhas fixas embaixo ficariam atrás dele. Publica a altura coberta em --teclado.
 * No Android com interactive-widget=resizes-content (o nosso index.html) a janela inteira encolhe junto com a
 * visualViewport e a altura coberta fica 0: aí o teclado aparece como a janela mais baixa que a de antes, com um
 * campo de texto focado. Nos dois casos liga html.com-teclado (a barra de abas sai, como no Instagram).
 */
export function vigiarTeclado(): () => void {
  const vv = window.visualViewport
  const raiz = document.documentElement
  // altura da janela sem teclado: a maior vista nesta largura (girar o celular recomeça a conta). As duas são lidas na
  // primeira conferência: ler a janela na montagem forçava um layout da página inteira a mais
  let largura = -1
  let base = 0
  let teclado = raiz.style.getPropertyValue('--teclado') || '0px'
  const atualizar = () => {
    const focado = campoDeTexto(document.activeElement)
    if (window.innerWidth !== largura) {
      largura = window.innerWidth
      base = window.innerHeight
    } else if (!focado || window.innerHeight > base) base = Math.max(base, window.innerHeight)
    const coberto = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0
    // a barra de endereço que aparece e some mexe uns 60 px: o teclado tira bem mais que isso
    const encolheu = focado ? base - window.innerHeight : 0
    // só escreve quando muda: --teclado mora na raiz, e cada escrita refaz o estilo da página inteira (sem ela, o CSS
    // usa 0px)
    const valor = `${Math.round(coberto)}px`
    if (valor !== teclado) {
      teclado = valor
      raiz.style.setProperty('--teclado', valor)
    }
    raiz.classList.toggle('com-teclado', coberto > 80 || encolheu > 150)
  }
  // o foco muda antes do teclado subir (a janela encolhe depois, no resize); trocar de um campo para outro passa
  // por um instante sem foco: confere no quadro seguinte
  let quadro = 0
  const aoFocar = () => {
    cancelAnimationFrame(quadro)
    quadro = requestAnimationFrame(atualizar)
  }
  vv?.addEventListener('resize', atualizar)
  vv?.addEventListener('scroll', atualizar)
  window.addEventListener('resize', atualizar)
  document.addEventListener('focusin', aoFocar)
  document.addEventListener('focusout', aoFocar)
  // a primeira conferência vai no quadro seguinte (antes da pintura): ler a visualViewport na montagem forçava um
  // layout da página inteira a mais e atrasava a primeira tela
  quadro = requestAnimationFrame(atualizar)
  return () => {
    cancelAnimationFrame(quadro)
    vv?.removeEventListener('resize', atualizar)
    vv?.removeEventListener('scroll', atualizar)
    window.removeEventListener('resize', atualizar)
    document.removeEventListener('focusin', aoFocar)
    document.removeEventListener('focusout', aoFocar)
  }
}
