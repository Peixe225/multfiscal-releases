// Pedido que ficou sem confirmação do servidor (o beacon do toque no WhatsApp, src/lib/pedido-envio.ts): o pedaço
// principal só olha se tem alguma cópia pendente no aparelho e, se tiver, baixa o envio no tempo ocioso e manda de novo
// (na abertura do site e quando a aba volta a ficar à vista, a volta do WhatsApp). Sem pendente, não baixa nada.
const CHAVE = 'gc-pedidos' // a mesma de CHAVE_PENDENTES (pedido-envio.ts)

function temPendente(): boolean {
  try {
    const v = localStorage.getItem(CHAVE)
    return !!v && v !== '[]'
  } catch {
    return false
  }
}

function noOcio(f: () => void): void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  if (w.requestIdleCallback) w.requestIdleCallback(f, { timeout: 4000 })
  else setTimeout(f, 1500)
}

function reenviar(): void {
  if (!temPendente()) return
  noOcio(() => {
    void import('./pedido-envio').then((m) => m.reenviarPendentes()).catch(() => {})
  })
}

/** Liga a vigia (uma vez, no App). Devolve o desligar. */
export function vigiarPedidosPendentes(): () => void {
  reenviar()
  const aoVoltar = () => {
    if (document.visibilityState === 'visible') reenviar()
  }
  document.addEventListener('visibilitychange', aoVoltar)
  return () => document.removeEventListener('visibilitychange', aoVoltar)
}
