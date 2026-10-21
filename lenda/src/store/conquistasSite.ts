/**
 * Conquistas no site (servidor/CONTRATO-v3.md §5): a raridade de cada conquista ("12% dos jogadores") e se
 * elas estão guardadas na conta. O src/site preenche; a tela de conquistas só lê. Fora do site fica vazio.
 * v3.4 (CONTRATO-v34): quais estão PROVADAS na conta (por uma carreira do Clássico começada com a conta, com replay).
 */
import { create } from 'zustand'

export interface Raridade {
  /** Jogadores (contas ativas) que entram na conta. */
  jogadores: number
  porConquista: Record<string, number>
}

/** v3.4: uma conquista provada na conta. */
export interface ProvaConquista {
  /** A carreira que prova já foi conferida pela equipe (verificação por replay). */
  verificada: boolean
  /** O id (HallEntry) da carreira que prova, se o servidor disse. */
  carreira: string | null
}

export interface ContagemProva {
  provadas: number
  verificadas: number
  naoProvadas: number
  total: number
}

interface ConquistasSite {
  raridade: Raridade | null
  /** Logado: as conquistas também ficam na conta (sincronizadas). */
  naConta: boolean
  /** Há conquistas esperando para subir (sem rede agora). */
  pendentes: number
  pedirRaridade: (() => void) | null
  /** v3.4: as provadas da conta (id → prova); null = não sabe (sem conta, servidor antigo, ainda não leu). */
  provadas: Record<string, ProvaConquista> | null
  contagemProva: ContagemProva | null
  /** v3.4: a tela de conquistas abriu (o site lê as provadas da conta, no máximo uma vez por minuto). */
  pedirProvadas: (() => void) | null
}

export const useConquistasSite = create<ConquistasSite>()(() => ({ raridade: null, naConta: false, pendentes: 0, pedirRaridade: null, provadas: null, contagemProva: null, pedirProvadas: null }))

/** "12% dos jogadores" · "menos de 1% dos jogadores" (null sem dado suficiente). */
export function textoRaridade(r: Raridade | null, id: string, minimo = 5): string | null {
  if (!r || r.jogadores < minimo) return null
  const n = r.porConquista[id] ?? 0
  const pct = (n / r.jogadores) * 100
  if (n <= 0) return 'Ninguém ainda'
  if (pct < 1) return 'Menos de 1% dos jogadores'
  return `${Math.min(100, Math.round(pct))}% dos jogadores`
}
