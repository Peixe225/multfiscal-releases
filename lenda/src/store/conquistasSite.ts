/**
 * Conquistas no site (servidor/CONTRATO-v3.md §5): a raridade de cada conquista ("12% dos jogadores") e se
 * elas estão guardadas na conta. O src/site preenche; a tela de conquistas só lê. Fora do site fica vazio.
 */
import { create } from 'zustand'

export interface Raridade {
  /** Jogadores (contas ativas) que entram na conta. */
  jogadores: number
  porConquista: Record<string, number>
}

interface ConquistasSite {
  raridade: Raridade | null
  /** Logado: as conquistas também ficam na conta (sincronizadas). */
  naConta: boolean
  /** Há conquistas esperando para subir (sem rede agora). */
  pendentes: number
  pedirRaridade: (() => void) | null
}

export const useConquistasSite = create<ConquistasSite>()(() => ({ raridade: null, naConta: false, pendentes: 0, pedirRaridade: null }))

/** "12% dos jogadores" · "menos de 1% dos jogadores" (null sem dado suficiente). */
export function textoRaridade(r: Raridade | null, id: string, minimo = 10): string | null {
  if (!r || r.jogadores < minimo) return null
  const n = r.porConquista[id] ?? 0
  const pct = (n / r.jogadores) * 100
  if (n <= 0) return 'Ninguém ainda'
  if (pct < 1) return 'Menos de 1% dos jogadores'
  return `${Math.min(100, Math.round(pct))}% dos jogadores`
}
