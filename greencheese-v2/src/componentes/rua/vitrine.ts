// A vitrine da rua: os produtos de verdade que o mercador mostra, um de cada vez, entre um cliente e outro. Só o que a
// loja do servidor diz que está à venda no estado da pessoa e que pode aparecer na rua: nada de bebida alcoólica nem
// de tabaco (Lei 9.294/1996 e as regras da Meta; ver PENDENCIAS, "Mercador e elenco"). Primeiro os do story do Início,
// na ordem que o dono escolheu no painel; depois os outros permitidos, na ordem do automático do story (com preço
// primeiro, os de exemplo por último). Até 8.
//
// Sem a loja do servidor nesta visita (servidor fora, antes de chegar, arquivo único), com a chave do painel desligada
// ou sem produto permitido no estado: lista vazia, e a rua segue com os itens desenhados de sempre.

import { useMemo } from 'react'
import type { Produto } from '../../lib/tipos'
import { useLoja } from '../../store/loja'
import { useLocal } from '../../store/local'
import { produtosDaVitrine } from './vitrine-regras'

export { MAX_VITRINE, permitidoNaRua, produtosDaVitrine } from './vitrine-regras'

/**
 * A vitrine da rua agora: só com a loja que o servidor mandou nesta visita (preço e estoque de agora, nunca de outra
 * visita) e com a chave do painel ligada (Loja → "O mercador mostra produtos na rua").
 */
export function useVitrineDaRua(): Produto[] {
  const uf = useLocal((s) => s.uf)
  const servidor = useLoja((s) => s.fonte === 'servidor')
  const ligada = useLoja((s) => s.vitrineNaRua !== false)
  const produtos = useLoja((s) => s.produtos)
  const categorias = useLoja((s) => s.categorias)
  const canais = useLoja((s) => s.canais)
  const stories = useLoja((s) => s.stories)
  return useMemo(
    () => (servidor && ligada ? produtosDaVitrine({ produtos, categorias, canais, stories }, uf) : []),
    [servidor, ligada, produtos, categorias, canais, stories, uf],
  )
}
