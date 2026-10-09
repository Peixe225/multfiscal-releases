import { useMemo } from 'react'
import type { LinhaPedido } from '../lib/mensagem'
import type { Produto } from '../lib/tipos'
import { disponivelEm, restamEm, useCatalogo } from './catalogo'
import { useLocal } from './local'
import { MAX_STORY, produtoSumido, useLoja } from './loja'
import { useSacola, type ItemSacola } from './sacola'

export interface LinhaSacola extends LinhaPedido {
  item: ItemSacola
  disponivel: boolean
  /** Unidades que a loja ainda tem do produto no estado (o "restam X"); null = sem limite conhecido. */
  limite: number | null
}

/**
 * Itens da sacola cruzados com a loja e com o estado atual. Indisponível aqui fica fora do pedido; produto que saiu da
 * loja agora há pouco aparece como fora (com o nome de antes). A quantidade do pedido nunca passa do "restam X" (a
 * sacola já ajusta e avisa; ver ajustarSacolaAoEstoque em src/lib/estoque.ts).
 */
export function useLinhasSacola(): { todas: LinhaSacola[]; pedido: LinhaSacola[]; fora: LinhaSacola[] } {
  const itens = useSacola((s) => s.itens)
  const produtos = useCatalogo((s) => s.produtos)
  // os estados da loja também: o pedido redesenha quando eles mudam (o canal, o WhatsApp, o pagamento)
  const canais = useLoja((s) => s.canais)
  const uf = useLocal((s) => s.uf)
  return useMemo(() => {
    const atendido = !!uf && canais.some((c) => c.uf === uf)
    const todas: LinhaSacola[] = []
    // o estoque é do produto: as variações dividem as mesmas unidades, na ordem em que entraram na sacola
    const usado = new Map<string, number>()
    for (const item of itens) {
      const produto = produtos.find((p) => p.id === item.id) ?? produtoSumido(item.id)
      if (!produto) continue
      const limite = atendido && disponivelEm(produto, uf) ? restamEm(produto, uf) : null
      const cabe = limite == null ? item.qtd : Math.max(0, Math.min(item.qtd, limite - (usado.get(item.id) ?? 0)))
      usado.set(item.id, (usado.get(item.id) ?? 0) + cabe)
      const disponivel = atendido && disponivelEm(produto, uf) && cabe > 0
      todas.push({ item, produto, variacaoId: item.variacao, qtd: disponivel ? cabe : item.qtd, disponivel, limite })
    }
    return { todas, pedido: todas.filter((l) => l.disponivel), fora: todas.filter((l) => !l.disponivel) }
  }, [itens, produtos, canais, uf])
}

/** Produtos disponíveis no estado atual (para sugestões). */
export function useDisponiveis(): Produto[] {
  const produtos = useCatalogo((s) => s.produtos)
  const uf = useLocal((s) => s.uf)
  return useMemo(() => produtos.filter((p) => disponivelEm(p, uf)), [produtos, uf])
}

/**
 * Os produtos do story do Início no estado: os que o dono escolheu no painel, na ordem dele (só o que está à venda
 * lá, até as 8 barrinhas); sem escolha (ou nenhum à venda), o automático: os à venda, os com preço primeiro e os de
 * exemplo por último. Estado sem atendimento ou ainda não escolhido: o catálogo inteiro, na mesma ordem.
 */
export function useStoryDoInicio(uf: string | null): Produto[] {
  const produtos = useCatalogo((s) => s.produtos)
  const stories = useLoja((s) => s.stories)
  const atendido = useLoja((s) => !!uf && s.canais.some((c) => c.uf === uf))
  return useMemo(() => {
    if (atendido && uf) {
      const doDono = (stories[uf] ?? [])
        .map((id) => produtos.find((p) => p.id === id))
        .filter((p): p is Produto => !!p && disponivelEm(p, uf))
        .slice(0, MAX_STORY)
      if (doDono.length) return doDono
    }
    const peso = (p: Produto) => (p.demo ? 2 : 0) + (p.preco == null ? 1 : 0)
    const base = atendido ? produtos.filter((p) => disponivelEm(p, uf)) : produtos
    return [...base].sort((a, b) => peso(a) - peso(b)).slice(0, MAX_STORY)
  }, [produtos, stories, atendido, uf])
}
