import { useInterativosAtivos, type Interativo } from '../interativos/registro'
import { Avatar, Icone } from './comum'
import './AdesivoInterativo.css'

// Card de story no feed (entre o catálogo e os reposts), no molde do repost: cabeçalho da loja e, dentro, o
// convite do interativo com a copy do estado da pessoa. Sem pop-up e sem aviso na chegada: só esta entrada.

export function AdesivoInterativo() {
  const ativos = useInterativosAtivos()
  if (!ativos.length) return null
  return (
    <section className="adesivos-interativos" aria-label="Interativos">
      {ativos.map((i) => (
        <Adesivo key={i.id} i={i} />
      ))}
    </section>
  )
}

function Adesivo({ i }: { i: Interativo }) {
  const e = i.useEntrada!()
  const a = e.adesivo
  if (!a) return null
  return (
    <div className="ai-story">
      <div className="ai-cab">
        <Avatar tamanho={28} />
        <span className="ai-cab-nome">{e.instagram ?? 'Green Cheese'}</span>
        <span className="ai-cab-rot legenda">interativo</span>
      </div>
      <div className="ai-dentro">
        <Icone nome={i.icone} tamanho={64} className="ai-icone" />
        <p className="ai-titulo px px-20">{a.titulo}</p>
        {a.pergunta && (
          <p className="ai-pergunta adesivo-texto-bloco">
            <span className="adesivo-texto">{a.pergunta}</span>
          </p>
        )}
        {a.texto && <p className="ai-texto">{a.texto}</p>}
        <button type="button" className="adesivo-link ai-cta toque" onClick={a.acao}>
          {a.cta}
        </button>
        {(a.legenda || e.exemplo) && (
          <p className="ai-legenda legenda">
            {a.legenda}
            {e.exemplo && <span className="carimbo">exemplo</span>}
          </p>
        )}
      </div>
    </div>
  )
}
