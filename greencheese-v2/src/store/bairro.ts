// O bairro do cliente, por estado (a taxa por bairro, 22/10): o "Teu bairro" que a pessoa digita na sacola ou na busca
// do story de atendimento ("Qual a taxa do meu bairro?"). Fica guardado no aparelho ('gc-bairro'): a sacola, o story e o
// pedido guiado (quando o CEP não trouxe bairro) usam o mesmo. Só conta quando o estado cobra por bairro.
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { armazenamentoSeguro } from '../lib/armazenamento'
import { bairroDigitado } from '../lib/bairros'

interface EstadoBairro {
  /** uf → o bairro como a pessoa digitou (ou escolheu na lista). */
  porUf: Record<string, string>
  definir: (uf: string, bairro: string) => void
}

export const useBairro = create<EstadoBairro>()(
  persist(
    (set) => ({
      porUf: {},
      definir: (uf, bairro) =>
        set((s) => {
          const u = uf.toLowerCase()
          const b = [...bairro.replace(/\s+/g, ' ')].slice(0, 60).join('').replace(/^\s+/, '')
          if ((s.porUf[u] ?? '') === b) return s
          const porUf = { ...s.porUf }
          if (b) porUf[u] = b
          else delete porUf[u]
          return { porUf }
        }),
    }),
    {
      name: 'gc-bairro',
      storage: createJSONStorage(() => armazenamentoSeguro),
      partialize: (s) => ({ porUf: s.porUf }),
      // o guardado por outra versão, torto: começa vazio
      merge: (guardado, atual) => {
        const g = guardado as { porUf?: unknown } | null
        const porUf: Record<string, string> = {}
        if (g && g.porUf && typeof g.porUf === 'object' && !Array.isArray(g.porUf)) {
          for (const [uf, b] of Object.entries(g.porUf as Record<string, unknown>)) if (/^[a-z]{2}$/.test(uf) && typeof b === 'string' && bairroDigitado(b)) porUf[uf] = b
        }
        return { ...atual, porUf }
      },
    },
  ),
)

/** O bairro do cliente nesse estado ('' = ainda não disse). Assina: redesenha quando muda. */
export function useBairroDa(uf: string | null | undefined): string {
  return useBairro((s) => (uf ? (s.porUf[uf.toLowerCase()] ?? '') : ''))
}
