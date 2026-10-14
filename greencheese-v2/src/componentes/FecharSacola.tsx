// O rodapé da sacola: o caminho direto (pedido do Ian em 14/10). Um toque em "Fechar pedido no WhatsApp" e o WhatsApp
// do estado abre com o pedido pronto (src/lib/mensagem.ts, montarPedidoSacola): o cliente só toca em enviar e manda o
// endereço na conversa. Nada de nome, endereço ou pagamento antes. No mesmo toque, a cópia vai pro servidor da loja
// (pedido-envio.ts: sendBeacon, sem segurar o link; fila no aparelho até o servidor confirmar), marcada como "sacola".
// - O código GC-XXXXX é o mesmo do pedido guiado (src/store/chat.ts): o que fecha depois entra no lugar do de antes
//   (dentro das 2 h, como o pedido mudado). Se o código de agora já foi com outra mensagem, a sacola sorteia um na hora
//   pro link (sem mexer no guiado enquanto a pessoa só olha a sacola) e ele vira o do pedido no toque.
// - O pedido mínimo do estado (src/lib/pedido-minimo.ts): faltando, o botão trava e diz quanto falta (também pro
//   leitor de tela); com item a consultar ou com cupom, não trava e avisa que a loja confere na conversa.
// - O pedido guiado (o chat) continua: aqui ele é só a opção de baixo, discreta.
import { useEffect, useRef, useState } from 'react'
import { config } from '../dados/config'
import { alvoDeSaida } from '../lib/ambiente'
import { novoCodigoPedido } from '../lib/codigo-pedido'
import { useAgora, useConta } from '../lib/conta'
import { copiarTexto } from '../lib/copiar'
import { useCupomNoPedido } from '../lib/cupom-pedido'
import { linhaCupom } from '../lib/cupom-uso'
import { brlNaTela } from '../lib/formato'
import { linkWhatsApp, montarPedidoSacola, whatsappDoCanal } from '../lib/mensagem'
import { enviarPedido } from '../lib/pedido-envio'
import { corpoDaSacola } from '../lib/pedido-itens'
import { situacaoMinimo, type SituacaoMinimo } from '../lib/pedido-minimo'
import { celularNoCampo } from '../lib/telefone'
import { substituiDe, useChat } from '../store/chat'
import { useContaStore } from '../store/conta'
import { useLinhasSacola } from '../store/derivados'
import { nomeCidade, useLocal } from '../store/local'
import { useCanalDa } from '../store/loja'
import { useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import { Icone } from './comum'

/** "Faltam R$ 4,10 pro pedido mínimo de R$ 20,00 pra entrega." · o aviso de conferir na conversa · null */
export function textoMinimo(s: SituacaoMinimo): string | null {
  if (s.tipo === 'falta') return `${s.falta === 1 ? 'Falta' : 'Faltam'} ${brlNaTela(s.falta)} pro pedido mínimo de ${brlNaTela(s.minimo)} pra entrega.`
  if (s.tipo === 'conferir' && s.motivo === 'consultar') return `Tem item com preço a consultar: a loja confere o pedido mínimo de ${brlNaTela(s.minimo)} na conversa.`
  if (s.tipo === 'conferir') return `Com o desconto do cupom, a loja confere o pedido mínimo de ${brlNaTela(s.minimo)} na conversa.`
  return null
}

export function FecharSacola() {
  const setSacola = useUI((s) => s.setSacola)
  const setSeletor = useUI((s) => s.setSeletor)
  const avisar = useUI((s) => s.avisar)
  const abrirChat = useChat((s) => s.abrir)
  const chatAberto = useChat((s) => s.aberto)
  const atual = useChat((s) => s.pedido)
  const { pedido } = useLinhasSacola()
  const { uf, cidade, cidadeInformada } = useLocal()
  const canal = useCanalDa(uf)
  const conta = useConta()
  // a conta da loja (entrou com o código pelo WhatsApp): só ela manda o WhatsApp junto, como no pedido guiado
  const contaDaLoja = useContaStore((s) => !!s.servidor && s.servidor === s.atual)
  const { cupom, situacao } = useCupomNoPedido()
  const agora = useAgora()
  // estado com uma cidade só: é ela (o cabeçalho sai como no pedido guiado); com mais de uma, a escolhida
  const lugar = canal ? (nomeCidade(canal, cidade, cidadeInformada) ?? (canal.cidades.length === 1 ? canal.cidades[0].nome : null)) : null
  const cupomOk = cupom && situacao?.tipo === 'ok' ? cupom : null
  const minimo = situacaoMinimo(canal, pedido, cupomOk?.retrato ?? null)
  const travado = minimo.tipo === 'falta'

  // o código que vai no link: o do pedido, ou um sorteado na hora quando o do pedido já foi com outra mensagem
  const [reserva, setReserva] = useState(novoCodigoPedido)
  const dados = canal && pedido.length
    ? {
        canal,
        cidade: lugar,
        linhas: pedido,
        nome: conta?.nome ?? null,
        cupom: cupomOk ? linhaCupom(cupomOk, 'Teste minha sorte', cupomOk.demo && config.carimboDeExemplo) : undefined,
        agora: new Date(agora),
      }
    : null
  const comAtual = dados ? montarPedidoSacola({ ...dados, codigo: atual.codigo }) : ''
  const precisaNovo = !!dados && atual.enviada !== null && atual.enviada !== comAtual
  const mensagem = precisaNovo && dados ? montarPedidoSacola({ ...dados, codigo: reserva.codigo }) : comAtual
  // já foi pelo toque daqui, com esta mesma mensagem (a volta do WhatsApp): pergunta se mandou
  const jaFoi = !!dados && atual.enviadaPor === 'sacola' && atual.enviada === mensagem
  const href = canal && mensagem ? linkWhatsApp(canal, mensagem) : undefined

  const [naoAbriu, setNaoAbriu] = useState(false)
  const alvo = alvoDeSaida()
  const temporizador = useRef(0)
  useEffect(() => () => window.clearTimeout(temporizador.current), [])
  useEffect(() => setNaoAbriu(false), [mensagem])

  const tocou = () => {
    if (!canal || !dados) return
    const usado = precisaNovo ? reserva : atual
    // a cópia vai junto com o toque (o link já está montado: nada espera)
    enviarPedido(
      corpoDaSacola({
        codigo: { codigo: usado.codigo, token: usado.token, substitui: precisaNovo ? substituiDe(atual) : atual.substitui },
        uf: canal.uf,
        cidade: lugar,
        linhas: pedido,
        nome: conta?.nome ?? '',
        whatsapp: contaDaLoja ? (conta?.whatsapp ?? '') : '',
        cupom: cupomOk ? { codigo: cupomOk.codigo, regra: cupomOk.retrato.regra, origem: 'Teste minha sorte' } : null,
        mensagem,
      }),
    )
    if (precisaNovo) {
      useChat.getState().usarCodigoDaSacola({ codigo: reserva.codigo, token: reserva.token }, mensagem)
      setReserva(novoCodigoPedido())
    } else useChat.getState().marcarPedidoEnviado(mensagem, 'sacola')
    setNaoAbriu(false)
    // no celular o link troca de app sem nova aba: se a página continua à vista, o WhatsApp não abriu
    if (!alvo) {
      window.clearTimeout(temporizador.current)
      temporizador.current = window.setTimeout(() => {
        if (document.visibilityState === 'visible') setNaoAbriu(true)
      }, 1600)
    }
  }

  const mandei = () => {
    const c = cupomOk?.codigo
    useSacola.getState().guardarUltimo()
    useSacola.getState().limpar()
    // o cupom foi na mensagem: marca como usado (quem dá baixa de verdade é a loja), como no pedido guiado
    if (c) void import('../lib/conta-adaptador').then((m) => m.conta.usarCupom(c)).catch(() => {})
    // o próximo pedido nasce com outro código (o pedido guiado recomeça junto)
    useChat.getState().recomecar()
    avisar(c ? `Valeu! Sacola limpa e o cupom ${c} marcado como usado.` : 'Valeu! Tua sacola ficou limpa pro próximo pedido.')
  }

  const guiado = (
    <p className="sacola-guiado">
      {chatAberto ? (
        <button type="button" className="sacola-guiado-botao toque" onClick={() => setSacola(false)}>
          Voltar pro pedido guiado
        </button>
      ) : (
        <>
          <span className="legenda">Prefere ir respondendo passo a passo?</span>{' '}
          <button
            type="button"
            className="sacola-guiado-botao toque"
            onClick={() => {
              setSacola(false)
              abrirChat('pedido')
            }}
          >
            Pedido guiado
          </button>
        </>
      )}
    </p>
  )

  // sem estado de atendimento (ainda não escolheu, ou a loja não chegou lá): primeiro o estado
  if (!canal) {
    return (
      <div className="sacola-fechar">
        <button type="button" className="botao botao-cheio botao-largo sacola-zap" onClick={() => setSeletor(true)}>
          Escolher meu estado
        </button>
      </div>
    )
  }

  const aviso = textoMinimo(minimo)
  const nadaAqui = pedido.length === 0
  const numero = celularNoCampo(whatsappDoCanal(canal))
  return (
    <div className="sacola-fechar">
      {aviso && (
        <p id="sacola-minimo" className={`sacola-minimo${travado ? ' sacola-minimo-falta' : ''}`} role="status" tabIndex={-1}>
          {travado && <span className="sacola-minimo-barra" aria-hidden="true" style={{ ['--feito' as string]: `${Math.min(100, Math.max(4, (minimo.subtotal / minimo.minimo) * 100))}%` }} />}
          {aviso}
        </p>
      )}
      {jaFoi && !naoAbriu && (
        <div className="sacola-enviado" role="status">
          <p>
            Pedido <span className="px">{atual.codigo}</span> pronto no WhatsApp: é só tocar em enviar lá e mandar o endereço na conversa.
          </p>
          <button type="button" className="sacola-guiado-botao toque" onClick={mandei}>
            Já mandei: limpar a sacola
          </button>
        </div>
      )}
      {naoAbriu && (
        <div className="sacola-enviado" role="status">
          <p>
            Não abriu? Toca de novo ou copia o pedido e manda pro WhatsApp da loja: <span className="sacola-numero">{numero}</span>.
          </p>
          <button type="button" className="sacola-guiado-botao toque" onClick={() => avisar(copiarTexto(mensagem) ? 'Pedido copiado.' : 'Segura no botão e copia o texto.')}>
            Copiar o pedido
          </button>
        </div>
      )}
      {travado || nadaAqui || !href ? (
        <button
          type="button"
          className="botao botao-cheio botao-largo sacola-zap"
          aria-disabled="true"
          aria-describedby={travado ? 'sacola-minimo' : undefined}
          onClick={() => document.getElementById('sacola-minimo')?.focus()}
        >
          <span>
            <Icone nome="whatsapp" tamanho={20} className="sacola-zap-icone" />
            Fechar pedido no WhatsApp
          </span>
        </button>
      ) : (
        <a className="botao botao-cheio botao-largo sacola-zap" href={href} target={alvo} rel="noopener noreferrer" onClick={tocou}>
          <span>
            <Icone nome="whatsapp" tamanho={20} className="sacola-zap-icone" />
            Fechar pedido no WhatsApp
          </span>
        </a>
      )}
      {guiado}
    </div>
  )
}
