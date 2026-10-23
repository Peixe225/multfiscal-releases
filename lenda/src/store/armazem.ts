/**
 * Armazém seguro para o persist do zustand (e para quem mais precisar): localStorage/sessionStorage quando dá, e um
 * Map na memória quando o navegador não deixa.
 *
 *   persist(…, { storage: createJSONStorage(() => localSeguro) })
 *
 * Por que não o `createJSONStorage(() => localStorage)` puro: ele só se protege quando ACESSAR o storage lança. Num
 * WebView com o DOM storage desligado, `window.localStorage` é null (o setItem cai em null.setItem) e, com a cota
 * cheia, o setItem lança QuotaExceededError dentro do setState do roteador — nos dois casos a página fica preta.
 * Aqui nada lança: o que não coube fica na memória desta aba (a configuração vale até fechar a página).
 */
import type { StateStorage } from 'zustand/middleware'

export function armazemSeguro(pegar: () => Storage | null | undefined): StateStorage & { getItem(k: string): string | null } {
  const mem = new Map<string, string>()
  /** Chaves cuja última gravação não chegou ao storage: a memória é que vale (o storage tem um valor velho). */
  const soNaMemoria = new Set<string>()
  return {
    getItem(k) {
      if (soNaMemoria.has(k)) return mem.get(k) ?? null
      try {
        const s = pegar()
        if (s) return s.getItem(k)
      } catch {
        /* bloqueado: a memória */
      }
      return mem.get(k) ?? null
    },
    setItem(k, v) {
      mem.set(k, v)
      try {
        const s = pegar()
        if (!s) throw new Error('sem storage')
        s.setItem(k, v)
        soNaMemoria.delete(k)
      } catch {
        /* bloqueado ou cheio: fica na memória */
        soNaMemoria.add(k)
      }
    },
    removeItem(k) {
      mem.delete(k)
      soNaMemoria.delete(k)
      try {
        pegar()?.removeItem(k)
      } catch {
        /* nada a fazer */
      }
    },
  }
}

const janela = () => (typeof window !== 'undefined' ? window : undefined)

/** localStorage com reserva na memória. */
export const localSeguro = armazemSeguro(() => janela()?.localStorage)
/** sessionStorage com reserva na memória. */
export const sessaoSegura = armazemSeguro(() => janela()?.sessionStorage)
