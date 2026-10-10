/** prefers-reduced-motion: troca motion por cortes secos. */
export function movimentoReduzido(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Ponteiro fino (mouse): só aí liga a rolagem suave. */
export function ponteiroFino(): boolean {
  try {
    return window.matchMedia('(pointer: fine)').matches
  } catch {
    return false
  }
}

export function ehDesktop(): boolean {
  try {
    return window.matchMedia('(min-width: 900px)').matches
  } catch {
    return false
  }
}

/**
 * Roda `fn` quando a página respira depois da primeira tela (ociosa, ou no máximo em `prazo` ms). É para o que só
 * importa com a rolagem (a faixa que anda, a paralaxe do próximo produto, o adesivo do topo): ligado na montagem, o
 * ScrollTrigger mede a página no meio da primeira pintura e atrasa a primeira tela do celular. Devolve o cancelamento.
 */
export function quandoRespirar(fn: () => void, prazo = 700): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: prazo })
    return () => w.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(fn, Math.min(prazo, 200))
  return () => window.clearTimeout(id)
}
