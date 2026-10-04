import { canalDa } from '../dados/canais'
import { emUf } from '../dados/ufs'
import { nomeCidade, useLocal } from '../store/local'
import { useUI } from '../store/ui'
import { Folha } from './Folha'

/** "2 itens da sacola não têm em MG": confirma a troca de estado sem sumir com nada calado. */
export function ConfirmarTroca() {
  const troca = useUI((s) => s.trocaPendente)
  const setTroca = useUI((s) => s.setTroca)
  const { uf, cidade, cidadeInformada, escolher } = useLocal()
  const atual = nomeCidade(canalDa(uf), cidade, cidadeInformada) ?? canalDa(uf)?.nome ?? ''
  const destino = troca ? (canalDa(troca.uf)?.cidades[0]?.nome ?? emUf(troca.uf).replace(/^(no|na|em) /, '')) : ''
  return (
    <Folha id="troca" aberta={!!troca} aoFechar={() => setTroca(null)} rotulo="Trocar de estado" cabecalho={<span>Trocar pra {destino}?</span>}>
      {troca && (
        <div className="troca">
          <p>
            {troca.fora.length === 1 ? 'Um item da sacola não tem' : `${troca.fora.length} itens da sacola não têm`} {emUf(troca.uf)}:
          </p>
          <ul>
            {troca.fora.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p className="legenda">Eles continuam na sacola, mas ficam fora do pedido.</p>
          <div className="troca-botoes">
            <button
              type="button"
              className="botao botao-cheio"
              data-foco-inicial
              onClick={() => {
                escolher(troca.uf, troca.cidade, 'manual')
                setTroca(null)
              }}
            >
              Trocar mesmo
            </button>
            <button type="button" className="botao botao-contorno" onClick={() => setTroca(null)}>
              Ficar em {atual}
            </button>
          </div>
        </div>
      )}
    </Folha>
  )
}
