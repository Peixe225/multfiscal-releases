import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { armazenamentoSeguro } from '../lib/armazenamento'
import { precoUnitario } from '../lib/preco'
import { produtoPorId } from './catalogo'

export interface ItemSacola {
  id: string
  variacao: string | null
  qtd: number
  /**
   * O retrato de quando o item entrou na sacola: o nome (com o tamanho), o nome da opção e o preço da unidade (null =
   * Consultar). O produto que saiu da loja e a opção que saiu aparecem com esse nome; o preço que mudou desde então
   * aparece com o de antes (até a pessoa ver a sacola: aí o retrato acompanha). Item guardado antes disso não tem.
   */
  nome?: string
  variacaoNome?: string | null
  preco?: number | null
}

export const chaveItem = (id: string, variacao: string | null) => `${id}::${variacao ?? ''}`

/** O retrato do item agora (vazio se a loja daqui não tem o produto, ou não tem mais a opção). */
function retrato(id: string, variacao: string | null): Pick<ItemSacola, 'nome' | 'variacaoNome' | 'preco'> {
  const p = produtoPorId(id)
  if (!p) return {}
  const v = variacao ? p.variacoes?.find((x) => x.id === variacao) : undefined
  if (variacao && !v) return {}
  return { nome: `${p.nome}${p.tamanho ? ` ${p.tamanho}` : ''}`, variacaoNome: v?.nome ?? null, preco: precoUnitario(p, variacao) }
}

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
  /**
   * Põe o retrato nos itens que ainda não têm (guardados antes dele existir), sem mexer no preço de quem já tem: é
   * esse preço que mostra que ele mudou.
   */
  completarRetratos: () => void
  /** A pessoa viu a sacola: o retrato de cada item acompanha a loja (o aviso de preço novo some). */
  conferirRetratos: () => void
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
      // quem põe na sacola acabou de ver o preço: o retrato é o de agora
      adicionar: (id, variacao, qtd) =>
        set((s) => {
          const k = chaveItem(id, variacao)
          const existe = s.itens.find((i) => chaveItem(i.id, i.variacao) === k)
          if (existe) return { itens: s.itens.map((i) => (i === existe ? { ...i, ...retrato(id, variacao), qtd: Math.min(99, i.qtd + qtd) } : i)) }
          return { itens: [...s.itens, { id, variacao, qtd: Math.min(99, qtd), ...retrato(id, variacao) }] }
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
      completarRetratos: () =>
        set((s) => {
          let mudou = false
          const itens = s.itens.map((i) => {
            if (i.nome !== undefined) return i
            const r = retrato(i.id, i.variacao)
            if (r.nome === undefined) return i
            mudou = true
            return { ...i, ...r }
          })
          return mudou ? { itens } : s
        }),
      conferirRetratos: () =>
        set((s) => {
          let mudou = false
          const itens = s.itens.map((i) => {
            const r = retrato(i.id, i.variacao)
            if (r.nome === undefined || (r.nome === i.nome && r.variacaoNome === i.variacaoNome && r.preco === i.preco)) return i
            mudou = true
            return { ...i, ...r }
          })
          return mudou ? { itens } : s
        }),
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
