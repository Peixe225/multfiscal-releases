import { useMemo } from 'react'
import type { LinhaPedido } from '../lib/mensagem'
import { precoUnitario } from '../lib/preco'
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
  /**
   * Por que está fora do pedido: 'estado' (não tem no estado agora, ou acabou), 'variacao' (a opção escolhida saiu da
   * loja: o pedido iria sem dizer qual) ou 'saiu' (o produto saiu da loja). null = no pedido.
   */
  motivo: 'estado' | 'variacao' | 'saiu' | null
  /** O preço da unidade mudou desde que entrou na sacola: o de antes (null = era Consultar). undefined = não mudou. */
  precoAntes?: number | null
}

/**
 * Itens da sacola cruzados com a loja e com o estado atual. Indisponível aqui fica fora do pedido; produto que saiu da
 * loja agora há pouco aparece como fora (com o nome de antes), e a opção que saiu também (o pedido não vai sem dizer
 * qual). Produto que a loja não tem mais e nem retrato dele nesta visita (saiu antes da visita) vai em `saiu`, com o
 * nome guardado no item: conta na sacola e aparece pra tirar. A quantidade do pedido nunca passa do "restam X" (a
 * sacola já ajusta e avisa; ver ajustarSacolaAoEstoque em src/lib/estoque.ts).
 */
export function useLinhasSacola(): { todas: LinhaSacola[]; pedido: LinhaSacola[]; fora: LinhaSacola[]; saiu: ItemSacola[] } {
  const itens = useSacola((s) => s.itens)
  const produtos = useCatalogo((s) => s.produtos)
  // os estados da loja também: o pedido redesenha quando eles mudam (o canal, o WhatsApp, o pagamento)
  const canais = useLoja((s) => s.canais)
  const uf = useLocal((s) => s.uf)
  return useMemo(() => {
    const atendido = !!uf && canais.some((c) => c.uf === uf)
    const todas: LinhaSacola[] = []
    const saiu: ItemSacola[] = []
    // o estoque é do produto: as variações dividem as mesmas unidades, na ordem em que entraram na sacola
    const usado = new Map<string, number>()
    for (const item of itens) {
      const atual = produtos.find((p) => p.id === item.id)
      const produto = atual ?? produtoSumido(item.id)
      if (!produto) {
        saiu.push(item)
        continue
      }
      const opcaoSaiu = !!item.variacao && !produto.variacoes?.some((v) => v.id === item.variacao)
      const limite = atendido && disponivelEm(produto, uf) ? restamEm(produto, uf) : null
      const cabe = opcaoSaiu ? 0 : limite == null ? item.qtd : Math.max(0, Math.min(item.qtd, limite - (usado.get(item.id) ?? 0)))
      usado.set(item.id, (usado.get(item.id) ?? 0) + cabe)
      const disponivel = !!atual && !opcaoSaiu && atendido && disponivelEm(produto, uf) && cabe > 0
      const motivo = disponivel ? null : !atual ? 'saiu' : opcaoSaiu ? 'variacao' : 'estado'
      const agora = precoUnitario(produto, item.variacao)
      const precoAntes = disponivel && item.preco !== undefined && item.preco !== agora ? item.preco : undefined
      todas.push({ item, produto, variacaoId: item.variacao, qtd: disponivel ? cabe : item.qtd, disponivel, limite, motivo, precoAntes })
    }
    return { todas, pedido: todas.filter((l) => l.disponivel), fora: todas.filter((l) => !l.disponivel), saiu }
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
