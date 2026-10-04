import { canais } from '../dados/canais'
import { emUf } from '../dados/ufs'
import { useChat } from '../store/chat'
import { useLocal } from '../store/local'
import { useUI } from '../store/ui'
import { Avatar, Icone } from './comum'
import { MapaBlocos } from './MapaBlocos'
import './SemAtendimento.css'

/** Estado sem atendimento: o vazio no molde do Instagram ("Nenhuma publicação ainda"), sem prometer entrega. */
export function SemAtendimento() {
  const { uf, escolher } = useLocal()
  const abrir = useChat((s) => s.abrir)
  const setSeletor = useUI((s) => s.setSeletor)
  return (
    <section className="sem" aria-labelledby="sem-titulo">
      <span className="sem-icone" aria-hidden="true">
        <Icone nome="moto" tamanho={48} />
      </span>
      <h1 id="sem-titulo" className="sem-titulo">
        A Green Cheese ainda não chegou aí
      </h1>
      <p className="sem-txt legenda">
        Por enquanto a entrega é no RJ, MG, SP, ES e SC. {emUf(uf).replace(/^./, (c) => c.toUpperCase())}, dá pra encomendar com um desses perfis.
      </p>
      <MapaBlocos atual={uf} bloco={32} aoTocar={(s) => escolher(s, null, 'manual')} acender />
      <ul className="sem-perfis">
        {canais.map((c) => (
          <li key={c.uf}>
            <button type="button" className="sem-perfil toque" onClick={() => escolher(c.uf, null, 'manual')} aria-label={`Ver a Green Cheese ${c.nome}`}>
              <Avatar tamanho={56} />
              <span className="px px-16">{c.uf.toUpperCase()}</span>
              <span className="legenda">{c.cidades[0]?.nome ?? c.nome}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="sem-botoes">
        <button type="button" className="botao botao-cheio" onClick={() => abrir('encomenda')}>
          Encomendar mesmo assim
        </button>
        <button type="button" className="botao botao-contorno" onClick={() => setSeletor(true)}>
          Trocar estado
        </button>
      </div>
    </section>
  )
}
