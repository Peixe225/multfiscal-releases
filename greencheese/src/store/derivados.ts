import { useMemo } from 'react'
import { canalDa } from '../dados/canais'
import type { LinhaPedido } from '../lib/mensagem'
import type { Produto } from '../lib/tipos'
import { disponivelEm, useCatalogo } from './catalogo'
import { useLocal } from './local'
import { useSacola, type ItemSacola } from './sacola'

export interface LinhaSacola extends LinhaPedido {
  item: ItemSacola
  disponivel: boolean
}

/** Itens da sacola cruzados com o catálogo e com o estado atual. Indisponível aqui fica fora do pedido. */
export function useLinhasSacola(): { todas: LinhaSacola[]; pedido: LinhaSacola[]; fora: LinhaSacola[] } {
  const itens = useSacola((s) => s.itens)
  const produtos = useCatalogo((s) => s.produtos)
  const uf = useLocal((s) => s.uf)
  return useMemo(() => {
    const atendido = !!canalDa(uf)
    const todas: LinhaSacola[] = []
    for (const item of itens) {
      const produto = produtos.find((p) => p.id === item.id)
      if (!produto) continue
      todas.push({ item, produto, variacaoId: item.variacao, qtd: item.qtd, disponivel: atendido && disponivelEm(produto, uf) })
    }
    return { todas, pedido: todas.filter((l) => l.disponivel), fora: todas.filter((l) => !l.disponivel) }
  }, [itens, produtos, uf])
}

/** Produtos disponíveis no estado atual (para o hero e sugestões). */
export function useDisponiveis(): Produto[] {
  const produtos = useCatalogo((s) => s.produtos)
  const uf = useLocal((s) => s.uf)
  return useMemo(() => produtos.filter((p) => disponivelEm(p, uf)), [produtos, uf])
}
