import { useState, type ReactNode } from 'react'
import { canalDa } from '../dados/canais'
import { config } from '../dados/config'
import { PixelArte } from '../arte/PixelArte'
import { emblemas } from '../arte/pixel/grades'
import { brl } from '../lib/formato'
import { ehDiaDeEntregaGratis, resumoHorario, situacao } from '../lib/horario'
import { alvoDeSaida } from '../lib/ambiente'
import { NOME_PAGAMENTO, linkDM } from '../lib/mensagem'
import { useChat } from '../store/chat'
import { nomeCidade, useLocal } from '../store/local'
import { useUI } from '../store/ui'
import { Demo, Icone } from './comum'
import { StoryShell } from './StoryShell'
import './InfoStory.css'

function Quadro({ children }: { children: ReactNode }) {
  return <div className="info-quadro">{children}</div>
}

/**
 * O destaque "DELIVERY RJ" / "TEÓFILO OTONI": story de atendimento do estado (cidades, horário, entrega, pagamento,
 * como pedir e onde tirar dúvida). O pedido fecha no WhatsApp da loja; dúvida vai pra DM do Instagram do estado.
 */
export function InfoStory() {
  const aberto = useUI((s) => s.infoAberto)
  const setInfo = useUI((s) => s.setInfo)
  const { uf, cidade, cidadeInformada } = useLocal()
  const canal = canalDa(uf)
  const abrirChat = useChat((s) => s.abrir)
  const [i, setI] = useState(0)
  if (!aberto || !canal) return null

  const sit = situacao(canal)
  const sextou = canal.entregaGratis
  const demoVisivel = config.carimboDeExemplo
  const quadros: ReactNode[] = [
    <Quadro key="c">
      <Icone nome="moto" tamanho={96} />
      <p className="info-titulo px">{canal.destaque}</p>
      <PixelArte grade={emblemas[canal.emblema]} tamanho={72} className="info-emblema" />
      <p className="info-txt">Entrega em</p>
      <p className="adesivo-texto-bloco">
        <span className="adesivo-texto">{canal.cidades.length ? canal.cidades.map((c) => c.nome).join(' · ') : `${canal.nome} · cidade a confirmar`}</span>
      </p>
      {nomeCidade(canal, cidade, cidadeInformada) && <p className="info-txt legenda">Teu atendimento: @{canal.instagram}</p>}
    </Quadro>,
    <Quadro key="h">
      <Icone nome="relogio" tamanho={64} />
      <p className="info-titulo px">HORÁRIO</p>
      <p className="info-grande px">{demoVisivel || !canal.horario.demo ? sit.texto : 'A confirmar'}</p>
      {(demoVisivel || !canal.horario.demo) && <p className="info-txt">{resumoHorario(canal)}</p>}
      <Demo ativo={canal.horario.demo} />
    </Quadro>,
    <Quadro key="e">
      <Icone nome="moto" tamanho={64} />
      <p className="info-titulo px">ENTREGA</p>
      {sextou && (
        <p className="adesivo-texto-bloco">
          <span className="adesivo-texto">{sextou.texto}</span>
        </p>
      )}
      <p className="info-grande px">
        {canal.taxaEntrega.valor != null && (demoVisivel || !canal.taxaEntrega.demo) ? `Taxa ${brl(canal.taxaEntrega.valor)}` : 'Taxa a confirmar'}
      </p>
      <p className="info-txt">A taxa certa vem na resposta do atendimento.</p>
      {sextou && !ehDiaDeEntregaGratis(canal) && <p className="info-txt legenda">Entrega grátis vale na sexta.</p>}
      <Demo ativo={canal.taxaEntrega.demo} />
    </Quadro>,
    <Quadro key="p">
      <Icone nome="check" tamanho={64} />
      <p className="info-titulo px">PAGAMENTO</p>
      <ul className="info-lista">
        {canal.pagamento.opcoes.map((o) => (
          <li key={o} className="px">
            {NOME_PAGAMENTO[o]}
          </li>
        ))}
      </ul>
      <Demo ativo={canal.pagamento.demo} />
    </Quadro>,
    <Quadro key="d">
      <Icone nome="whatsapp" tamanho={64} />
      <p className="info-titulo px">PEDIDO</p>
      <p className="info-txt">Monta aqui no site e fecha no WhatsApp da loja.</p>
      <button
        type="button"
        className="botao botao-cheio"
        onClick={() => {
          setInfo(false)
          abrirChat('pedido')
        }}
      >
        Fazer pedido
      </button>
    </Quadro>,
    <Quadro key="i">
      <Icone nome="instagram" tamanho={64} />
      <p className="info-titulo px">DÚVIDAS</p>
      <p className="info-txt">
        O que o site não responder, a <strong className="info-arroba">@{canal.instagram}</strong> responde na DM.
      </p>
      <a className="botao botao-contorno" href={linkDM(canal)} target={alvoDeSaida()} rel="noopener noreferrer">
        Chamar na DM
      </a>
    </Quadro>,
  ]

  return (
    <StoryShell
      id="story-info"
      total={quadros.length}
      indice={Math.min(i, quadros.length - 1)}
      irPara={setI}
      fechar={() => {
        setInfo(false)
        setI(0)
      }}
      origem={null}
      duracaoMs={4500}
      instagram={canal.instagram}
      rotuloCabecalho={canal.destaque}
      rotulo={`Destaque ${canal.destaque}`}
      quadro={quadros[Math.min(i, quadros.length - 1)]}
    />
  )
}
