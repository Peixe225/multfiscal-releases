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
