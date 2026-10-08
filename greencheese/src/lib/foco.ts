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

/**
 * Para onde vai o foco ao abrir a vista: o h1 visível (o título do Catálogo, o do perfil), a não ser que algo focável
 * venha antes dele — no Início do celular, o story fica antes do perfil. Aí vai a própria vista (região "Início"), e o
 * Tab seguinte segue a ordem da tela em vez de pular o que vem antes do título.
 */
export function alvoDoFoco(vista: HTMLElement): HTMLElement {
  const h1 = [...vista.querySelectorAll<HTMLElement>('h1')].find((h) => h.getClientRects().length > 0)
  if (!h1) return vista
  const antes = [...vista.querySelectorAll<HTMLElement>(FOCAVEIS)].some(
    (el) => el.tabIndex >= 0 && el.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING && el.getClientRects().length > 0,
  )
  return antes ? vista : h1
}

/**
 * Foco no título da aba à vista. Pra quem fecha uma camada que ninguém abriu com o foco (o link direto de um rateio):
 * sem isso o foco caía no <body> e o teclado e o leitor de tela recomeçavam do topo da página.
 */
export function focarVista(aba: string) {
  const vista = document.querySelector<HTMLElement>(`.vista[data-vista="${aba}"]`)
  if (vista) alvoDoFoco(vista).focus({ preventScroll: true })
}
