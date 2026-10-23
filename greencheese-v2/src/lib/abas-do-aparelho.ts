// Duas abas do mesmo aparelho (o link do Instagram aberto de novo, a aba duplicada).
// - A sacola é uma só: quando outra aba grava a sacola, esta relê do aparelho (evento storage). Assim o pedido de uma
//   aba nunca sai com a sacola velha que ela leu ao abrir.
// - O código do pedido (GC-XXXXX) é de uma aba só: a conversa de cada aba é dela, mas as duas leem o mesmo pedido
//   guardado ao abrir. Cada aba prende o código que está usando (Web Locks: o navegador solta sozinho quando a aba fecha,
//   recarrega ou vai pro WhatsApp); a aba que abre e acha o código preso por outra aba aberta ganha um código novo
//   (trocarCodigo: se o de antes já foi pro servidor há pouco, o novo entra no lugar dele, como o pedido mudado). Assim
//   dois pedidos diferentes nunca saem com o mesmo código, e o servidor guarda os dois.
// Navegador sem Web Locks (Safari antes de 15.4): fica como antes, o código guardado vale nas duas abas.
import { useChat } from '../store/chat'
import { useSacola } from '../store/sacola'

let preso: string | null = null
let soltar: (() => void) | null = null

function prender(codigo: string): void {
  if (codigo === preso) return
  soltar?.()
  soltar = null
  preso = codigo
  let locks: LockManager | undefined
  try {
    locks = navigator.locks
  } catch {
    locks = undefined
  }
  if (!locks?.request) return
  locks
    .request(`gc-pedido:${codigo}`, { ifAvailable: true }, (lock) => {
      // trocou de código enquanto esperava: solta na hora
      if (preso !== codigo) return undefined
      if (!lock) {
        // outra aba aberta está com esse código: esta ganha um só dela
        if (useChat.getState().pedido.codigo === codigo) useChat.getState().trocarCodigo()
        return undefined
      }
      return new Promise<void>((ok) => {
        soltar = ok
      })
    })
    .catch(() => {
      /* sem permissão (iframe de outra origem, modo restrito): segue sem prender */
    })
}

/** Liga a sacola compartilhada entre as abas e o código do pedido preso à aba. Uma vez, na abertura. */
export function vigiarAbasDoAparelho(): void {
  prender(useChat.getState().pedido.codigo)
  useChat.subscribe((s, antes) => {
    if (s.pedido.codigo !== antes.pedido.codigo) prender(s.pedido.codigo)
  })
  try {
    window.addEventListener('storage', (e) => {
      // outra aba mexeu na sacola (ou apagou tudo: key null)
      if (e.key === 'gc-sacola' || e.key === null) void useSacola.persist.rehydrate()
    })
  } catch {
    /* sem window: nada a vigiar */
  }
}
