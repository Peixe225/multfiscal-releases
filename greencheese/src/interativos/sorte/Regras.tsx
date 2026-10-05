import { useId, useState } from 'react'
import { config } from '../../dados/config'
import { premiosElegiveis } from '../../lib/cupom'
import { useLocal } from '../../store/local'
import { T } from './textos'

/** Regras e "O que pode sair" (só leitura, sem as chances), em disclosure. Também aparece na Minha conta. */
export function Regras({ rotulo = T.verRegras, className }: { rotulo?: string; className?: string }) {
  const [aberto, setAberto] = useState(false)
  const id = useId()
  const uf = useLocal((s) => s.uf)
  const lista = aberto ? premiosElegiveis(uf) : []
  return (
    <div className={`regras ${className ?? ''}`}>
      <button type="button" className="regras-botao toque" aria-expanded={aberto} aria-controls={id} onClick={() => setAberto((v) => !v)}>
        {rotulo}
      </button>
      <div id={id} className="regras-corpo" hidden={!aberto}>
        <h3 className="regras-titulo">{T.regras}</h3>
        <ul className="regras-lista">
          {T.regrasLista.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="regras-quiz">
          <p className="regras-quiz-topo">{T.oQuePodeSair}</p>
          <ol>
            {lista.map((p, i) => (
              <li key={p.id} className="regras-quiz-linha">
                <span className="regras-quiz-letra" aria-hidden="true">
                  {String.fromCharCode(65 + i)}
                </span>
                <span>{p.titulo}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="legenda regras-nota">{T.mudaPorEstado}</p>
        {config.modoPrevia && <p className="legenda regras-nota">{T.regrasPrevia}</p>}
      </div>
    </div>
  )
}
