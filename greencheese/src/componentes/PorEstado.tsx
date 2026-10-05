import { useState } from 'react'
import { canais, canalDa, perfisAConfirmar } from '../dados/canais'
import { config } from '../dados/config'
import { emUf, ufPorSigla } from '../dados/ufs'
import { PixelArte } from '../arte/PixelArte'
import { emblemas } from '../arte/pixel/grades'
import { situacao } from '../lib/horario'
import { linkPerfil } from '../lib/mensagem'
import { rolarPara } from '../lib/rolagem'
import { useChat } from '../store/chat'
import { useLocal } from '../store/local'
import { trocarEstado } from '../lib/troca'
import { Demo } from './comum'
import { MapaBlocos } from './MapaBlocos'
import './PorEstado.css'

/** "Green Cheese por estado": o story deles com a lista dos perfis, mais o mapa em blocos. */
/** "@greencheese_importsmg" que pode quebrar depois do "_" (no celular estreito vira duas linhas, sem cortar letra). */
function Arroba({ perfil }: { perfil: string }) {
  const partes = perfil.split('_')
  return (
    <span className="estado-mencao-txt">
      @
      {partes.map((t, i) => (
        <span key={i}>
          {t}
          {i < partes.length - 1 && (
            <>
              _<wbr />
            </>
          )}
        </span>
      ))}
    </span>
  )
}

export function PorEstado() {
  const uf = useLocal((s) => s.uf)
  const abrirChat = useChat((s) => s.abrir)
  const [fora, setFora] = useState<string | null>(null)
  // o estado atual vem primeiro
  const ordem = [...canais].sort((a, b) => (a.uf === uf ? -1 : b.uf === uf ? 1 : 0))

  const tocarMapa = (s: string) => {
    if (canalDa(s)) {
      setFora(null)
      trocarEstado(s)
    } else {
      setFora(s)
      const el = document.querySelector(`.estados .mapa-uf[aria-label^="${ufPorSigla(s)?.nome}"]`)
      el?.classList.remove('chiando')
      void (el as HTMLElement | null)?.offsetWidth
      el?.classList.add('chiando')
    }
  }

  return (
    <section id="estados" className="estados" aria-labelledby="estados-titulo">
      <h2 id="estados-titulo" className="adesivo-texto-bloco estados-titulo">
        <span className="adesivo-texto">Segue o perfil do teu estado</span>
      </h2>
      <div className="estados-grade">
        <div className="estados-mapa">
          <MapaBlocos atual={uf} bloco={40} aoTocar={tocarMapa} acender />
          {fora && (
            <div className="estados-fora" role="status">
              <p>
                A Green Cheese ainda não chegou <strong>{emUf(fora)}</strong>.
              </p>
              <button type="button" className="botao botao-contorno" onClick={() => abrirChat('encomenda')}>
                Encomendar mesmo assim
              </button>
            </div>
          )}
        </div>
        <ul className="estados-lista">
          {ordem.map((c, k) => {
            const eh = c.uf === uf
            const sit = situacao(c)
            return (
              <li key={c.uf} className={`estado ${eh ? 'atual' : ''}`}>
                <button
                  type="button"
                  className="estado-uf px toque"
                  onClick={() => {
                    if (trocarEstado(c.uf)) rolarPara('#raiz', 0)
                  }}
                  aria-label={`Trocar o site para ${c.nome}`}
                  aria-pressed={eh}
                >
                  {c.uf.toUpperCase()}
                </button>
                <div className="estado-corpo">
                  <a
                    className="adesivo-mencao estado-mencao"
                    style={{ transform: `rotate(${k % 2 ? 2 : -3}deg)` }}
                    href={linkPerfil(c.instagram)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Arroba perfil={c.instagram} />
                  </a>
                  <p className="estado-cidade">
                    {c.cidades.length ? c.cidades.map((x) => x.nome).join(' · ') : <span className="legenda">cidade a confirmar</span>}
                    {eh && <span className="estado-aqui"> · teu atendimento</span>}
                  </p>
                  <p className="estado-horario legenda">
                    {config.modoPrevia || !c.horario.demo ? sit.texto : 'Horário a confirmar'} <Demo ativo={c.horario.demo} />
                  </p>
                  {c.entregaGratis && <p className="estado-sextou">{c.entregaGratis.texto}</p>}
                  <div className="estado-botoes">
                    <button
                      type="button"
                      className="botao botao-cheio"
                      onClick={() => {
                        if (eh || trocarEstado(c.uf)) abrirChat('pedido')
                      }}
                    >
                      {eh ? 'Pedir aqui' : `Pedir em ${c.uf.toUpperCase()}`}
                    </button>
                    <a className="botao botao-contorno" href={linkPerfil(c.instagram)} target="_blank" rel="noopener noreferrer">
                      Abrir Instagram
                    </a>
                  </div>
                </div>
                <PixelArte grade={emblemas[c.emblema]} tamanho={44} className="estado-emblema" titulo={`Emblema de ${c.nome}`} />
              </li>
            )
          })}
          {perfisAConfirmar.map((p) => (
            <li key={p.instagram} className="estado estado-confirmar">
              <span className="estado-uf px" aria-hidden="true">
                ?
              </span>
              <div className="estado-corpo">
                <a className="adesivo-mencao estado-mencao" href={linkPerfil(p.instagram)} target="_blank" rel="noopener noreferrer">
                  <Arroba perfil={p.instagram} />
                </a>
                <p className="estado-cidade">
                  <span className="carimbo">{p.nota}</span> <span className="legenda">{p.obs}</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
