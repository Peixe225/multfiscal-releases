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

/** Teto de cada linha da sacola (o produto com a opção): a sacola, a página e o story travam e avisam aqui. */
export const MAX_POR_ITEM = 99

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
  /**
   * O cupom aplicado entrou sozinho (o que vale e vence primeiro: src/lib/cupom-automatico.ts), sem o cliente escolher.
   * A linha do cupom diz isso; o que entrou sozinho e deixou de valer dá lugar a outro que vale. Sacola guardada antes
   * disso não tem (false).
   */
  cupomAuto: boolean
  /**
   * O cliente tirou o cupom deste pedido: os códigos que a conta tinha nessa hora não entram mais sozinhos (só um cupom
   * ganho depois). Some quando a sacola fica vazia (limpa no "Já mandei", ou item a item): o pedido seguinte começa do
   * zero. Sacola guardada antes disso não tem ([]).
   */
  cupomRecusados: string[]
  /** auto: entrou sozinho (o cliente não escolheu). */
  aplicarCupom: (codigo: string, auto?: boolean) => void
  /** O cupom sai sem ser o cliente (venceu, foi usado, a conta saiu): o automático pode pôr outro. */
  tirarCupom: () => void
  /** O cliente tirou o cupom: `conhecidos` (os códigos da conta agora) não voltam sozinhos neste pedido. */
  recusarCupom: (conhecidos: string[]) => void
}

/** A sacola ficou vazia: o pedido seguinte começa do zero (o cupom recusado volta a poder entrar sozinho). */
const zerarRecusa = (itens: ItemSacola[]): Partial<SacolaState> => (itens.length ? { itens } : { itens, cupomRecusados: [] })

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
          if (existe) return { itens: s.itens.map((i) => (i === existe ? { ...i, ...retrato(id, variacao), qtd: Math.min(MAX_POR_ITEM, i.qtd + qtd) } : i)) }
          return { itens: [...s.itens, { id, variacao, qtd: Math.min(MAX_POR_ITEM, qtd), ...retrato(id, variacao) }] }
        }),
      alterar: (id, variacao, qtd) =>
        set((s) =>
          zerarRecusa(
            qtd <= 0
              ? s.itens.filter((i) => chaveItem(i.id, i.variacao) !== chaveItem(id, variacao))
              : s.itens.map((i) => (chaveItem(i.id, i.variacao) === chaveItem(id, variacao) ? { ...i, qtd: Math.min(MAX_POR_ITEM, qtd) } : i)),
          ),
        ),
      remover: (id, variacao) => set((s) => zerarRecusa(s.itens.filter((i) => chaveItem(i.id, i.variacao) !== chaveItem(id, variacao)))),
      limpar: () => set({ itens: [], cupom: null, cupomAuto: false, cupomRecusados: [] }),
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
      cupomAuto: false,
      cupomRecusados: [],
      aplicarCupom: (codigo, auto = false) => set({ cupom: codigo, cupomAuto: auto }),
      tirarCupom: () => set({ cupom: null, cupomAuto: false }),
      recusarCupom: (conhecidos) => set((s) => ({ cupom: null, cupomAuto: false, cupomRecusados: [...new Set([...s.cupomRecusados, ...conhecidos])].slice(-50) })),
    }),
    {
      name: 'gc-sacola',
      storage: createJSONStorage(() => armazenamentoSeguro),
      // a sacola guardada antes do cupom automático (ou torta) não tem os campos dele: ficam os de fábrica
      merge: (salvo, atual) => {
        const x = (salvo ?? {}) as Partial<SacolaState>
        return {
          ...atual,
          ...x,
          cupomAuto: x.cupomAuto === true && typeof x.cupom === 'string',
          cupomRecusados: Array.isArray(x.cupomRecusados) ? x.cupomRecusados.filter((c): c is string => typeof c === 'string').slice(-50) : [],
        }
      },
    },
  ),
)

export function contarItens(itens: ItemSacola[]): number {
  return itens.reduce((n, i) => n + i.qtd, 0)
}
