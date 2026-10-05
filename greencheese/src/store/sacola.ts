import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { armazenamentoSeguro } from '../lib/armazenamento'

export interface ItemSacola {
  id: string
  variacao: string | null
  qtd: number
}

export const chaveItem = (id: string, variacao: string | null) => `${id}::${variacao ?? ''}`

interface SacolaState {
  itens: ItemSacola[]
  /** Último pedido enviado (para "Repetir último pedido"). */
  ultimo: ItemSacola[]
  guardarUltimo: () => void
  repetirUltimo: () => void
  adicionar: (id: string, variacao: string | null, qtd: number) => void
  alterar: (id: string, variacao: string | null, qtd: number) => void
  remover: (id: string, variacao: string | null) => void
  /** Limpa os itens e o cupom aplicado. */
  limpar: () => void
  /** Código do cupom aplicado neste pedido (um só por pedido). Não mexe no subtotal: a loja confirma no WhatsApp. */
  cupom: string | null
  aplicarCupom: (codigo: string) => void
  tirarCupom: () => void
}

export const useSacola = create<SacolaState>()(
  persist(
    (set) => ({
      itens: [],
      ultimo: [],
      // o último pedido guarda só os itens: o cupom não volta junto ("Repetir último pedido")
      guardarUltimo: () => set((s) => ({ ultimo: s.itens.map((i) => ({ ...i })) })),
      repetirUltimo: () => set((s) => ({ itens: s.ultimo.map((i) => ({ ...i })) })),
      adicionar: (id, variacao, qtd) =>
        set((s) => {
          const k = chaveItem(id, variacao)
          const existe = s.itens.find((i) => chaveItem(i.id, i.variacao) === k)
          if (existe) return { itens: s.itens.map((i) => (i === existe ? { ...i, qtd: Math.min(99, i.qtd + qtd) } : i)) }
          return { itens: [...s.itens, { id, variacao, qtd: Math.min(99, qtd) }] }
        }),
      alterar: (id, variacao, qtd) =>
        set((s) => ({
          itens:
            qtd <= 0
              ? s.itens.filter((i) => chaveItem(i.id, i.variacao) !== chaveItem(id, variacao))
              : s.itens.map((i) => (chaveItem(i.id, i.variacao) === chaveItem(id, variacao) ? { ...i, qtd: Math.min(99, qtd) } : i)),
        })),
      remover: (id, variacao) => set((s) => ({ itens: s.itens.filter((i) => chaveItem(i.id, i.variacao) !== chaveItem(id, variacao)) })),
      limpar: () => set({ itens: [], cupom: null }),
      cupom: null,
      aplicarCupom: (codigo) => set({ cupom: codigo }),
      tirarCupom: () => set({ cupom: null }),
    }),
    { name: 'gc-sacola', storage: createJSONStorage(() => armazenamentoSeguro) },
  ),
)

export function contarItens(itens: ItemSacola[]): number {
  return itens.reduce((n, i) => n + i.qtd, 0)
}
