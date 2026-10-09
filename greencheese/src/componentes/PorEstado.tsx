import { useMemo, useState } from 'react'
import type { Canal } from '../dados/canais'
import { config } from '../dados/config'
import { emUf, ufPorSigla } from '../dados/ufs'
import { ehDiaDeEntregaGratis, entregaGratisNoDia, situacao } from '../lib/horario'
import { linkPerfil } from '../lib/mensagem'
import { trocarEstado } from '../lib/troca'
import { useChat } from '../store/chat'
import { useLocal } from '../store/local'
import { useCanais } from '../store/loja'
import { Avatar, Demo, Icone } from './comum'
import { MapaBrasil, ordemNoMapa } from './MapaBrasil'
import './PorEstado.css'

// "Segue o perfil do teu estado": o mapa do Brasil com a lupa no Sudeste + SC e, ao lado, a lista dos perfis
// no molde do "trocar de conta" do Instagram (um perfil por estado; o do cliente marcado). A lista segue a ordem
// do mapa, de cima para baixo (hoje MG, ES, RJ, SP, SC; estado ativado no painel entra no lugar dele).

/** "greencheese_importsmg" que pode quebrar depois do "_" (no celular estreito vira duas linhas, sem cortar letra). */
function Arroba({ perfil }: { perfil: string }) {
  const partes = perfil.split('_')
  return (
    <>
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
    </>
  )
}

const cidadesDe = (c: Canal) => (c.cidades.length ? c.cidades.map((x) => x.nome).join(' · ') : null)

export function PorEstado() {
  const { uf } = useLocal()
  const abrirChat = useChat((s) => s.abrir)
  const [fora, setFora] = useState<string | null>(null)
  const [realce, setRealce] = useState<string | null>(null)
  const canais = useCanais()
  const canaisNoMapa = useMemo(() => ordemNoMapa(canais.map((c) => c.uf)).map((s) => canais.find((c) => c.uf === s)!), [canais])
  const canalDa = (s: string | null) => (s ? canais.find((c) => c.uf === s) : undefined)
  const canalAtual = canalDa(uf)

  const escolher = (s: string) => {
    setFora(null)
    trocarEstado(s)
  }
  const tocarMapa = (s: string) => {
    if (canalDa(s)) escolher(s)
    else setFora(s)
  }
  const realcar = (s: string | null) => () => setRealce(s)

  return (
    <section id="estados" className="estados" aria-labelledby="estados-titulo">
      <div className="estados-caixa">
        <h2 id="estados-titulo" className="adesivo-texto-bloco estados-titulo">
          <span className="adesivo-texto">Segue o perfil do teu estado</span>
        </h2>
        <div className="estados-grade">
          <div className="estados-mapa">
            <MapaBrasil
              modo="secao"
              atual={uf}
              aoTocar={tocarMapa}
              acender
              realce={realce}
              aoFecharBalao={() => setFora(null)}
              balao={
                fora
                  ? {
                      uf: fora,
                      conteudo: (
                        <>
                          <p>
                            A Green Cheese ainda não chegou <strong>{emUf(fora)}</strong> — dá pra encomendar.
                          </p>
                          <span className="estados-balao-botoes">
                            <button type="button" className="botao botao-cheio estados-balao-botao" onClick={() => abrirChat('encomenda')}>
                              Encomendar
                            </button>
                            <button type="button" className="icone-botao estados-balao-fechar" onClick={() => setFora(null)} aria-label="Fechar aviso">
                              <Icone nome="fechar" tamanho={16} />
                            </button>
                          </span>
                        </>
                      ),
                    }
                  : null
              }
            />
            <p className="estados-legenda legenda">
              <span className="estados-chave estados-chave-aceso" aria-hidden="true" /> tem Green Cheese
              <span className="estados-chave estados-chave-apagado" aria-hidden="true" /> ainda não chegou
              <span className="estados-fonte">Fonte: IBGE</span>
            </p>
          </div>

          {/* o "trocar de conta" do Instagram: um perfil por estado */}
          <div className="pe-contas degrau-topo">
            <span className="pe-contas-alca" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <ul className="pe-contas-lista">
              {canaisNoMapa.map((c) => {
                const eh = c.uf === uf
                const cid = cidadesDe(c)
                const sub = (
                  <>
                    {c.nomePerfil && <span>{c.nomePerfil} · </span>}
                    {cid ?? <span className="pe-contas-confirmar">cidade a confirmar</span>}
                  </>
                )
                const avatar = (
                  <span className="pe-conta-avatar" aria-hidden="true">
                    <Avatar tamanho={52} className={eh ? undefined : 'pe-avatar-visto'} />
                    <span className="pe-conta-uf px">{c.uf.toUpperCase()}</span>
                  </span>
                )
                const sit = situacao(c)
                // a linha é sempre o mesmo <button> (a do cliente também, com aria-current): ao escolher, o foco
                // continua nela; o horário e os botões da conta atual entram depois, como irmãos
                return (
                  <li key={c.uf} className={`pe-conta ${eh ? 'atual' : ''}`} onMouseEnter={realcar(c.uf)} onMouseLeave={realcar(null)}>
                    <button
                      type="button"
                      className="pe-conta-linha toque"
                      onClick={() => !eh && escolher(c.uf)}
                      onFocus={realcar(c.uf)}
                      onBlur={realcar(null)}
                      aria-current={eh ? 'true' : undefined}
                    >
                      {/* o nome do botão vem do texto que se vê (rótulo no nome, WCAG 2.5.3), com o estado na frente */}
                      <span className="sr-only">{eh ? `${c.nome}: ` : `Trocar para ${c.nome}: `}</span>
                      {avatar}
                      <span className="pe-conta-txt">
                        <span className="pe-conta-arroba">
                          <Arroba perfil={c.instagram} />
                        </span>
                        <span className="pe-conta-sub legenda">
                          {sub}
                          {eh && <span className="pe-conta-aqui"> · teu atendimento</span>}
                        </span>
                      </span>
                      <span className={`pe-conta-radio ${eh ? 'marcado' : ''}`} aria-hidden="true">
                        {eh && <Icone nome="check" tamanho={16} />}
                      </span>
                    </button>
                    {eh && (
                      <div className="pe-conta-mais">
                        {(config.carimboDeExemplo || !c.horario.demo) && (
                          <p className="pe-conta-horario legenda">
                            {sit.texto} <Demo ativo={c.horario.demo} />
                          </p>
                        )}
                        {c.entregaGratis &&
                          (ehDiaDeEntregaGratis(c) ? (
                            <p className="pe-conta-sextou">{c.entregaGratis.texto}</p>
                          ) : (
                            <p className="pe-conta-horario legenda">{entregaGratisNoDia(c)}</p>
                          ))}
                        <div className="pe-conta-botoes">
                          <button type="button" className="botao botao-cheio" onClick={() => abrirChat('pedido')}>
                            Pedir aqui
                          </button>
                          <a className="botao botao-contorno" href={linkPerfil(c.instagram)} target="_blank" rel="noopener noreferrer">
                            Abrir Instagram
                          </a>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
              {/* no lugar do "Adicionar conta": quem está fora dos 5 estados encomenda */}
              <li className="pe-conta">
                <button type="button" className="pe-conta-linha toque" onClick={() => abrirChat('encomenda')}>
                  <span className="pe-conta-avatar pe-conta-avatar-mais" aria-hidden="true">
                    <Icone nome="mais" tamanho={24} />
                  </span>
                  <span className="pe-conta-txt">
                    <span className="pe-conta-arroba">Teu estado não tá aqui?</span>
                    <span className="pe-conta-sub legenda">Dá pra encomendar com um desses perfis</span>
                  </span>
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>
      {/* sempre montada (vazia sem balão): região "status" criada junto com o texto costuma não ser lida */}
      <p className="sr-only" role="status">
        {fora ? `A Green Cheese ainda não chegou ${emUf(fora)}. Dá pra encomendar.` : ''}
      </p>
      <p className="sr-only" role="status">
        {canalAtual ? `Teu atendimento: Green Cheese ${ufPorSigla(uf)?.nome ?? ''}, @${canalAtual.instagram}` : ''}
      </p>
    </section>
  )
}
