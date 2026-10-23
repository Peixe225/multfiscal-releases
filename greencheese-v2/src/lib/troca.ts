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
  // cada linha da sacola com a opção dela ("Piteira de vidro RAW (Flat · 6 mm × 3,5 cm)"), sem repetir o mesmo nome
  const fora = canalDa(atual) && canalDa(uf)
    ? [
        ...new Set(
          useSacola
            .getState()
            .itens.map((i) => ({ i, p: produtoPorId(i.id) }))
            .filter((x): x is { i: (typeof x)['i']; p: NonNullable<(typeof x)['p']> } => !!x.p && disponivelEm(x.p, atual) && !disponivelEm(x.p, uf))
            .map(({ i, p }) => {
              const opcao = i.variacao ? (p.variacoes?.find((v) => v.id === i.variacao)?.nome ?? i.variacaoNome) : null
              return opcao ? `${p.nome} (${opcao})` : p.nome
            }),
        ),
      ]
    : []
  if (fora.length) {
    useUI.getState().setTroca({ uf, cidade, fora })
    return false
  }
  useLocal.getState().escolher(uf, cidade, 'manual')
  return true
}
