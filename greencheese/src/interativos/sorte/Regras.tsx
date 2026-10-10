import { useId, useState } from 'react'
import { useModoConta } from '../../lib/conta-modo'
import { nomeDoPremio, premiosElegiveis } from '../../lib/cupom-uso'
import { useLocal } from '../../store/local'
import { T } from './textos'
import './estilo'

/** Regras e "O que pode sair" (só leitura, sem as chances), em disclosure. Também aparece na Minha conta. */
export function Regras({ rotulo = T.verRegras, className }: { rotulo?: string; className?: string }) {
  const [aberto, setAberto] = useState(false)
  const id = useId()
  const uf = useLocal((s) => s.uf)
  const servidor = useModoConta() === 'servidor'
  const lista = aberto ? premiosElegiveis(uf) : []
  // a validade sai dos prêmios (os do painel; sem servidor, src/dados/sorte.ts): "vale 7 dias" quando todos têm a mesma;
  // senão, a data do cupom
  const dias = new Set(lista.map((p) => p.validadeDias))
  const regras = T.regrasLista(dias.size === 1 ? [...dias][0] : null)
  return (
    <div className={`regras ${className ?? ''}`}>
      <button type="button" className="regras-botao toque" aria-expanded={aberto} aria-controls={id} onClick={() => setAberto((v) => !v)}>
        {rotulo}
      </button>
      <div id={id} className="regras-corpo" hidden={!aberto}>
        <h3 className="regras-titulo">{T.regras}</h3>
        <ul className="regras-lista">
          {regras.map((r) => (
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
                <span>{nomeDoPremio(p)}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="legenda regras-nota">{T.mudaPorEstado}</p>
        <p className="legenda regras-nota">{servidor ? T.regrasServidor : T.regrasLocal}</p>
      </div>
    </div>
  )
}
