// Lista dos rateios por status, com o "Criar rateio" bem à mão.
import { useState } from 'react'
import * as api from '../api'
import { useDados } from '../dados'
import { Link, Topo } from '../Moldura'
import { caminho } from '../rotas'
import type { RateioAdmin, StatusRateio } from '../tipos'
import { Aviso, Carregando, Ic, TituloTela } from '../ui'
import { useRestaurarRolagem, useTitulo } from './comum'
import { pegarRecado } from './flash'
import { CartaoLinha } from './Resumo'

const GRUPOS: { nome: string; status: StatusRateio[] }[] = [
  { nome: 'Abertos', status: ['aberto'] },
  { nome: 'Rascunhos', status: ['rascunho'] },
  { nome: 'Em andamento', status: ['fechado', 'pedido', 'caminho', 'chegou'] },
  { nome: 'Encerrados', status: ['encerrado'] },
  { nome: 'Cancelados', status: ['cancelado'] },
]

export function Rateios() {
  useTitulo('Rateios')
  const leitura = useDados<{ agora: string; rateios: RateioAdmin[] }>('rateios', (s) => api.rateios(s))
  useRestaurarRolagem(!!leitura.dados)
  const lista = leitura.dados?.rateios ?? []
  const [recado, setRecado] = useState(pegarRecado)
  return (
    <>
      <Topo
        titulo={<TituloTela>Rateios</TituloTela>}
        acoes={
          <Link href={caminho.novo} className="pn-botao pn-botao-cheio pn-botao-p">
            <Ic nome="mais" tamanho={16} />
            <span className="pn-botao-txt">Criar rateio</span>
          </Link>
        }
      />
      <div className="pn-pagina pn-rateios">
        {recado && (
          <Aviso tipo="ok" acao={<button type="button" className="icone-botao" aria-label="Fechar o recado" onClick={() => setRecado(null)}><Ic nome="fechar" tamanho={16} /></button>}>
            {recado}
          </Aviso>
        )}
        {leitura.erro && (
          <Aviso tipo="erro" acao={<button type="button" className="pn-link-botao" onClick={() => void leitura.recarregar()}>Tentar de novo</button>}>
            {leitura.erro.message}
          </Aviso>
        )}
        {!leitura.dados && !leitura.erro && <Carregando />}
        {leitura.dados && lista.length === 0 && (
          <div className="pn-vazio-grande">
            <Ic nome="caixa" tamanho={48} />
            <p>Nenhum rateio ainda. Cria o primeiro: escolhe o produto, o preço e quantas vagas.</p>
            <Link href={caminho.novo} className="pn-botao pn-botao-cheio">
              <span className="pn-botao-txt">Criar rateio</span>
            </Link>
          </div>
        )}
        {GRUPOS.map((g) => {
          const doGrupo = lista.filter((r) => g.status.includes(r.status))
          if (!doGrupo.length) return null
          return (
            <section key={g.nome} className="pn-bloco" aria-labelledby={`g-${g.nome}`}>
              <h2 id={`g-${g.nome}`} className="pn-h2">
                {g.nome} <span className="pn-conta">{doGrupo.length}</span>
              </h2>
              <ul className="pn-lista-rateios">
                {doGrupo.map((r) => (
                  <li key={r.id}>
                    <CartaoLinha r={r} />
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </>
  )
}
