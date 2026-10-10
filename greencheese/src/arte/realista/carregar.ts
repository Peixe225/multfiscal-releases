// As ilustrações realistas pesam (contornos das marcas): vão num pedaço à parte.
// Na primeira visita o pedido espera a abertura chegar no quadro parado (+18 ou local): assim não disputa banda
// com o JS e as fontes da abertura, nem re-renderiza a página escondida no meio da animação do logo.
// Até chegar, o produto aparece na versão em pixel art; quando chega, sintoniza no real.
import { useSyncExternalStore } from 'react'
import type { Arte } from './comum'

let artes: Record<string, Arte> | null = null
let pedido: Promise<Record<string, Arte>> | null = null
let liberado = false
let soltar: (() => void) | null = null
const liberacao = new Promise<void>((ok) => (soltar = ok))
const ouvintes = new Set<() => void>()

/** Libera o download (abertura no quadro parado, sem abertura nesta visita, ou o produto foi pedido na tela). */
export function liberarArtesRealistas(): void {
  if (liberado) return
  liberado = true
  soltar?.()
}

export function carregarArtesRealistas(): Promise<Record<string, Arte>> {
  pedido ??= liberacao.then(() => import('./index')).then(
    (m) => {
      artes = m.artesRealistas
      ouvintes.forEach((f) => f())
      return artes
    },
    (erro) => {
      pedido = null // deixa tentar de novo na próxima montagem
      throw erro
    },
  )
  return pedido
}

function assinar(f: () => void) {
  ouvintes.add(f)
  return () => ouvintes.delete(f)
}

/** Registro das artes realistas, ou null enquanto o pedaço não chegou. */
export function useArtesRealistas(): Record<string, Arte> | null {
  return useSyncExternalStore(assinar, () => artes, () => artes)
}
