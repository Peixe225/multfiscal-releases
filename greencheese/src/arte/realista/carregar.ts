// As ilustrações realistas pesam (contornos das marcas): vão num pedaço à parte, pedido logo no início.
// Até chegar, o produto aparece na versão em pixel art; quando chega, sintoniza no real.
import { useSyncExternalStore } from 'react'
import type { Arte } from './comum'

let artes: Record<string, Arte> | null = null
let pedido: Promise<Record<string, Arte>> | null = null
const ouvintes = new Set<() => void>()

export function carregarArtesRealistas(): Promise<Record<string, Arte>> {
  pedido ??= import('./index').then(
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
