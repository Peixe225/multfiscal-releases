import type { KeyboardEvent as KeyboardEventReact } from 'react'

// Camadas modais (página do produto, folhas, story): o Tab dá a volta dentro da camada de cima e não vai parar na
// página por trás. A ordem é a do DOM, decidida aqui mesmo quando o foco está fora da lista (na própria caixa depois
// de um clique, num título com tabIndex -1): o navegador sozinho sairia da camada no Shift+Tab.

export const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/** Trata o Tab dentro de `caixa`. Devolve true se tratou. */
export function prenderTab(e: KeyboardEventReact | KeyboardEvent, caixa: HTMLElement | null | undefined): boolean {
  if (e.key !== 'Tab' || !caixa) return false
  const lista = [...caixa.querySelectorAll<HTMLElement>(FOCAVEIS)].filter(
    (el) => el.tabIndex >= 0 && el.getClientRects().length > 0 && !el.closest('[inert]') && getComputedStyle(el).visibility !== 'hidden',
  )
  if (!lista.length) return false
  const ativo = document.activeElement
  const i = lista.indexOf(ativo as HTMLElement)
  let alvo: HTMLElement | undefined
  if (i >= 0) alvo = lista[e.shiftKey ? i - 1 : i + 1]
  else if (ativo && ativo !== caixa && caixa.contains(ativo)) {
    const lado = e.shiftKey ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING
    const doLado = lista.filter((el) => ativo.compareDocumentPosition(el) & lado)
    alvo = e.shiftKey ? doLado[doLado.length - 1] : doLado[0]
  }
  e.preventDefault()
  ;(alvo ?? (e.shiftKey ? lista[lista.length - 1] : lista[0])).focus()
  return true
}
