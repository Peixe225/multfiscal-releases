// Confirmação antes de mexer em dinheiro, vaga ou passo do rateio: diz o que vai acontecer, trava o botão enquanto
// o servidor responde (sem toque duplo) e mostra o erro ali mesmo, sem perder nada.
import { useRef, useState, type ReactNode } from 'react'
import { mensagemDe } from './api'
import { Folha } from './Folha'
import { Aviso, Botao } from './ui'

export interface PedidoConfirmacao {
  titulo: string
  texto?: ReactNode
  /** Linhas de detalhe (quem, quanto). */
  detalhes?: ReactNode
  botao: string
  perigo?: boolean
  /** A ação. Se devolver um resultado, a folha troca pra ele em vez de fechar. */
  acao: () => Promise<Resultado | void>
}

export interface Resultado {
  titulo: string
  conteudo: ReactNode
}

export function Confirmar({ pedido, aoFechar }: { pedido: PedidoConfirmacao | null; aoFechar: () => void }) {
  return pedido ? <ConfirmarAberto key={pedido.titulo + pedido.botao} pedido={pedido} aoFechar={aoFechar} /> : null
}

function ConfirmarAberto({ pedido, aoFechar }: { pedido: PedidoConfirmacao; aoFechar: () => void }) {
  const [ocupado, setOcupado] = useState(false)
  // trava síncrona: o estado só muda no próximo desenho, e um toque duplo passaria pelos dois
  const trava = useRef(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const rodar = async () => {
    if (ocupado) return
    if (trava.current) return
    trava.current = true
    setOcupado(true)
    setErro(null)
    try {
      const r = await pedido.acao()
      if (r) setResultado(r)
      else aoFechar()
    } catch (e) {
      setErro(mensagemDe(e))
    } finally {
      trava.current = false
      setOcupado(false)
    }
  }
  if (resultado) {
    return (
      <Folha
        key="resultado"
        aberta
        aoFechar={aoFechar}
        titulo={resultado.titulo}
        rodape={
          <Botao variante="texto" largo onClick={aoFechar}>
            Pronto
          </Botao>
        }
      >
        <div className="pn-folha-pad">{resultado.conteudo}</div>
      </Folha>
    )
  }
  return (
    <Folha
      key="pergunta"
      aberta
      aoFechar={aoFechar}
      preso={ocupado}
      papel="alertdialog"
      titulo={pedido.titulo}
      rodape={
        <div className="pn-botoes">
          <Botao variante={pedido.perigo ? 'perigo' : 'cheio'} icone={pedido.perigo ? 'atencao' : undefined} largo ocupado={ocupado} onClick={rodar}>
            {pedido.botao}
          </Botao>
          <Botao variante="texto" largo onClick={aoFechar} disabled={ocupado}>
            Voltar
          </Botao>
        </div>
      }
    >
      <div className="pn-folha-pad pn-confirmar">
        {pedido.texto && <div className="pn-confirmar-txt">{pedido.texto}</div>}
        {pedido.detalhes && <div className="pn-confirmar-det">{pedido.detalhes}</div>}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
      </div>
    </Folha>
  )
}
