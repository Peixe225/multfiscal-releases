import { canalDa } from '../dados/canais'
import { disponivelEm, produtoPorId } from '../store/catalogo'
import { useLocal } from '../store/local'
import { useSacola } from '../store/sacola'
import { useUI } from '../store/ui'

/**
 * Troca o site de estado. Se itens da sacola (que têm no estado atual) não tiverem no novo,
 * pergunta antes: eles continuam na sacola, mas saem do pedido.
 */
export function trocarEstado(uf: string, cidade: string | null = null): boolean {
  const atual = useLocal.getState().uf
  if (atual === uf) {
    useLocal.getState().escolher(uf, cidade, 'manual')
    return true
  }
  const fora = canalDa(atual) && canalDa(uf)
    ? useSacola
        .getState()
        .itens.map((i) => produtoPorId(i.id))
        .filter((p): p is NonNullable<typeof p> => !!p && disponivelEm(p, atual) && !disponivelEm(p, uf))
        .map((p) => p.nome)
    : []
  if (fora.length) {
    useUI.getState().setTroca({ uf, cidade, fora })
    return false
  }
  useLocal.getState().escolher(uf, cidade, 'manual')
  return true
}
