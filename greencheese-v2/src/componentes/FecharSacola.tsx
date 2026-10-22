// O rodapé da sacola: o caminho direto (pedido do Ian em 14/10). Um toque em "Fechar pedido no WhatsApp" e o WhatsApp
// do estado abre com o pedido pronto (src/lib/mensagem.ts, montarPedidoSacola): o cliente só toca em enviar e manda o
// endereço na conversa. Nada de nome, endereço ou pagamento antes. No mesmo toque, a cópia vai pro servidor da loja
// (pedido-envio.ts: sendBeacon, sem segurar o link; fila no aparelho até o servidor confirmar), marcada como "sacola".
// - O código GC-XXXXX é o mesmo do pedido guiado (src/store/chat.ts): o que fecha depois entra no lugar do de antes
//   (dentro das 2 h, como o pedido mudado). Se o código de agora já foi com outra mensagem, ou já venceu (mais de 2 h:
//   a pessoa voltou outro dia sem tocar em "Já mandei"), a sacola sorteia um na hora pro link (sem mexer no guiado
//   enquanto a pessoa só olha a sacola) e ele vira o do pedido no toque: pedido de novo, mesmo igual, é pedido novo.
// - O pedido guiado que já foi com esta mesma sacola (dentro das 2 h): a sacola diz que ele já foi e o botão abre a
//   mesma mensagem dele (com o endereço), sem outra cópia — mandar de novo a mesma sacola não troca o guiado por um
//   pedido com menos dados.
// - A volta do WhatsApp (a página recarregada): o App reabre a sacola, que pergunta "Já mandou o pedido GC-…?" com o
//   "Já mandei: limpar a sacola" (como o guiado reabre e pergunta).
// - Com o pedido guiado aberto embaixo (o "Mexer na sacola" do resumo): o botão grande volta pro guiado, com o que a
//   pessoa já respondeu; o caminho direto não aparece ali (as respostas não somem num toque).
// - A loja fechada agora (o horário do painel): uma linha diz quando abre e que a resposta vem quando abrir, sem travar.
// - O pedido mínimo do estado (src/lib/pedido-minimo.ts): faltando, o botão trava e diz quanto falta (também pro
//   leitor de tela; o toque no travado realça o aviso); chegou, o "Pronto" é dito. Com item a consultar ou com cupom,
//   não trava e avisa que a loja confere na conversa. A sacola aberta confere a loja de novo (ETag), pro mínimo que o
//   dono mudou no painel valer sem recarregar.
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
import { situacao } from '../lib/horario'
import { modoBairro } from '../lib/bairros'
import { entregaDoPedido, linkWhatsApp, montarPedidoSacola, taxaParaOServidor, whatsappDoCanal } from '../lib/mensagem'
import { enviarPedido } from '../lib/pedido-envio'
import { corpoDaSacola } from '../lib/pedido-itens'
import { situacaoMinimo, type SituacaoMinimo } from '../lib/pedido-minimo'
import { celularNoCampo } from '../lib/telefone'
import { chaveDaSacola, codigoVencido, substituiDe, useChat } from '../store/chat'
import { useBairroDa } from '../store/bairro'
import { useContaStore } from '../store/conta'
import { useLinhasSacola } from '../store/derivados'
import { nomeCidade, useLocal } from '../store/local'
import { conferirLoja, useCanalDa } from '../store/loja'
import { useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import { Demo, Icone } from './comum'

/** "Faltam R$ 4,10 pro pedido mínimo de R$ 20,00 pra entrega." · o aviso de conferir na conversa · null */
export function textoMinimo(s: SituacaoMinimo): string | null {
  if (s.tipo === 'falta') return `${s.falta === 1 ? 'Falta' : 'Faltam'} ${brlNaTela(s.falta)} pro pedido mínimo de ${brlNaTela(s.minimo)} pra entrega.`
  if (s.tipo === 'conferir' && s.motivo === 'consultar') return `Tem item com preço a consultar: a loja confere o pedido mínimo de ${brlNaTela(s.minimo)} na conversa.`
  if (s.tipo === 'conferir') return `Com o desconto do cupom, a loja confere o pedido mínimo de ${brlNaTela(s.minimo)} na conversa.`
  return null
}

/** A sacola aberta confere a loja assim que abre (se a última conversa foi há mais disso) e, aberta, de tempos em tempos. */
const CONFERIR_AO_ABRIR_MS = 15_000
const CONFERIR_ABERTA_MS = 30_000
/** O "Pronto: chegou no pedido mínimo" fica esse tempo (e o leitor de tela ouve). */
const PRONTO_MS = 4000

/** O código que foi pelo toque nesta visita (a página não recarregou): "pronto no WhatsApp", e não "Já mandou?". */
let tocadoNestaVisita: string | null = null

export function FecharSacola() {
  const setSacola = useUI((s) => s.setSacola)
  const setSeletor = useUI((s) => s.setSeletor)
  const avisar = useUI((s) => s.avisar)
  const abrirChat = useChat((s) => s.abrir)
  const chatAberto = useChat((s) => s.aberto)
  const modoChat = useChat((s) => s.modo)
  const atual = useChat((s) => s.pedido)
  const { pedido } = useLinhasSacola()
  const { uf, cidade, cidadeInformada } = useLocal()
  const canal = useCanalDa(uf)
  const conta = useConta()
  // a conta da loja (entrou com o código pelo WhatsApp): só ela manda o WhatsApp junto, como no pedido guiado
  const contaDaLoja = useContaStore((s) => !!s.servidor && s.servidor === s.atual)
  const { cupom, situacao: situacaoCupom } = useCupomNoPedido()
  // a hora da loja, de minuto em minuto (e na volta pra aba): o horário, a entrega do dia e o código que vence
  const agora = useAgora()
  // estado com uma cidade só: é ela (o cabeçalho sai como no pedido guiado); com mais de uma, a escolhida
  const lugar = canal ? (nomeCidade(canal, cidade, cidadeInformada) ?? (canal.cidades.length === 1 ? canal.cidades[0].nome : null)) : null
  const cupomOk = cupom && situacaoCupom?.tipo === 'ok' ? cupom : null
  // o "Teu bairro" (a taxa por bairro, 22/10): só conta no estado que cobra por bairro (no de uma taxa só, a mensagem
  // fica byte a byte a de sempre)
  const bairroDigitado = useBairroDa(uf)
  const bairro = canal && modoBairro(canal) ? bairroDigitado.trim() || null : null
  const minimo = situacaoMinimo(canal, pedido, cupomOk?.retrato ?? null)
  const travado = minimo.tipo === 'falta'

  // a sacola aberta pergunta a loja de novo (ETag: 304 sem mudança): o mínimo que o dono tirou destrava, o novo vale
  useEffect(() => {
    conferirLoja(CONFERIR_AO_ABRIR_MS)
    const t = window.setInterval(() => conferirLoja(CONFERIR_ABERTA_MS - 1000), CONFERIR_ABERTA_MS)
    return () => window.clearInterval(t)
  }, [])

  // o código que vai no link: o do pedido, ou um sorteado na hora quando o do pedido já foi com outra mensagem (ou venceu)
  const [reserva, setReserva] = useState(novoCodigoPedido)
  const dados = canal && pedido.length
    ? {
        canal,
        cidade: lugar,
        linhas: pedido,
        nome: conta?.nome ?? null,
        cupom: cupomOk ? linhaCupom(cupomOk, 'Teste minha sorte', cupomOk.demo && config.carimboDeExemplo) : undefined,
        agora: new Date(agora),
        bairro,
      }
    : null
  const chave = canal ? chaveDaSacola(canal.uf, pedido) : ''
  // a hora do aparelho (a mesma do enviadaEm), relida a cada minuto junto com a da loja
  const vencido = codigoVencido(atual)
  const fresco = atual.enviada !== null && !vencido
  // o pedido guiado com esta mesma sacola já foi há pouco: a sacola reconhece (não manda outro por cima dele)
  const foiPeloGuiado = !!dados && fresco && atual.enviadaPor === 'guiado' && atual.sacola === chave
  const comAtual = dados ? montarPedidoSacola({ ...dados, codigo: atual.codigo }) : ''
  const precisaNovo = !!dados && !foiPeloGuiado && atual.enviada !== null && (vencido || atual.enviada !== comAtual)
  const mensagem = foiPeloGuiado ? (atual.enviada ?? '') : precisaNovo && dados ? montarPedidoSacola({ ...dados, codigo: reserva.codigo }) : comAtual
  // já foi pelo toque daqui (ou pelo guiado, com a mesma sacola), com esta mesma mensagem: pergunta se mandou
  const jaFoi = !!dados && fresco && atual.enviada === mensagem
  const href = canal && mensagem ? linkWhatsApp(canal, mensagem) : undefined

  const [naoAbriu, setNaoAbriu] = useState(false)
  const alvo = alvoDeSaida()
  const temporizador = useRef(0)
  useEffect(() => () => window.clearTimeout(temporizador.current), [])
  useEffect(() => setNaoAbriu(false), [mensagem])

  // chegou no mínimo (estava faltando): "Pronto" por um instante, e o leitor de tela ouve (a região viva fica sempre aí)
  const [pronto, setPronto] = useState<number | null>(null)
  const tipoAntes = useRef(minimo.tipo)
  const prontoT = useRef(0)
  useEffect(() => {
    const antes = tipoAntes.current
    tipoAntes.current = minimo.tipo
    if (antes === minimo.tipo) return
    window.clearTimeout(prontoT.current)
    if (antes === 'falta' && (minimo.tipo === 'ok' || minimo.tipo === 'conferir')) {
      setPronto(minimo.minimo)
      prontoT.current = window.setTimeout(() => setPronto(null), PRONTO_MS)
    } else setPronto(null)
  }, [minimo])
  useEffect(() => () => window.clearTimeout(prontoT.current), [])

  // o toque no travado: o foco vai pro aviso (o leitor de tela lê quanto falta) e o aviso pisca, pra quem só vê
  const realceT = useRef(0)
  useEffect(() => () => window.clearTimeout(realceT.current), [])
  const tocouTravado = () => {
    const el = document.getElementById('sacola-minimo')
    if (!el) return
    el.focus({ preventScroll: false })
    el.classList.remove('sacola-minimo-realce')
    void el.offsetWidth // recomeça o realce a cada toque
    el.classList.add('sacola-minimo-realce')
    window.clearTimeout(realceT.current)
    realceT.current = window.setTimeout(() => el.classList.remove('sacola-minimo-realce'), 1200)
  }

  const tocou = () => {
    if (!canal || !dados) return
    setNaoAbriu(false)
    tocadoNestaVisita = foiPeloGuiado ? null : precisaNovo ? reserva.codigo : atual.codigo
    // o pedido guiado com esta sacola já foi (a cópia dele, com o endereço, já tá no servidor ou na fila): o link abre
    // a mesma mensagem, sem outra cópia
    if (!foiPeloGuiado) {
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
          bairro,
          taxa: taxaParaOServidor(entregaDoPedido(canal, bairro, lugar, new Date(agora))),
        }),
      )
      if (precisaNovo) {
        useChat.getState().usarCodigoDaSacola({ codigo: reserva.codigo, token: reserva.token }, mensagem, chave)
        setReserva(novoCodigoPedido())
      } else useChat.getState().marcarPedidoEnviado(mensagem, 'sacola', chave)
    }
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
    tocadoNestaVisita = null
    useSacola.getState().guardarUltimo()
    useSacola.getState().limpar()
    // o cupom foi na mensagem: marca como usado (quem dá baixa de verdade é a loja), como no pedido guiado
    if (c) void import('../lib/conta-adaptador').then((m) => m.conta.usarCupom(c)).catch(() => {})
    // o próximo pedido nasce com outro código (o pedido guiado recomeça junto)
    useChat.getState().recomecar()
    avisar(c ? `Valeu! Sacola limpa e o cupom ${c} marcado como usado.` : 'Valeu! Tua sacola ficou limpa pro próximo pedido.')
  }

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
  // o pedido guiado aberto embaixo da sacola (o "Mexer na sacola" do resumo, ou a sacola aberta no meio dele): o botão
  // grande volta pra ele, com o que a pessoa já respondeu (o endereço, o pagamento); o caminho direto não aparece ali
  const voltarProGuiado = chatAberto && modoChat === 'pedido'
  // a loja fechada agora (o horário do painel; o de exemplo só com o carimbo à vista): diz quando abre, sem travar
  const sit = config.carimboDeExemplo || !canal.horario.demo ? situacao(canal, new Date(agora)) : null
  const fechada = sit && !sit.aberto ? sit.texto : null
  const textoPronto = pronto !== null && !aviso ? `Pronto: chegou no pedido mínimo de ${brlNaTela(pronto)} pra entrega.` : null
  const doGuiado = foiPeloGuiado
  const aqui = tocadoNestaVisita === atual.codigo

  return (
    <div className="sacola-fechar">
      {/* a região viva fica sempre montada: o que muda nela (quanto falta, o "Pronto") o leitor de tela ouve */}
      <div className="sacola-vivo" role="status">
        {aviso && (
          <p id="sacola-minimo" className={`sacola-minimo${travado ? ' sacola-minimo-falta' : ''}`} tabIndex={-1}>
            {travado && <span className="sacola-minimo-barra" aria-hidden="true" style={{ ['--feito' as string]: `${Math.min(100, Math.max(4, (minimo.subtotal / minimo.minimo) * 100))}%` }} />}
            {aviso}
          </p>
        )}
        {textoPronto && <p className="sacola-minimo sacola-minimo-pronto">{textoPronto}</p>}
      </div>
      {jaFoi && !naoAbriu && !voltarProGuiado && (
        <div className="sacola-enviado" role="status">
          <p>
            {doGuiado ? (
              <>
                O pedido <span className="px">{atual.codigo}</span> já foi montado no pedido guiado, com o endereço: o botão abre ele igual no WhatsApp.
              </>
            ) : aqui ? (
              <>
                Pedido <span className="px">{atual.codigo}</span> pronto no WhatsApp: é só tocar em enviar lá e mandar o endereço na conversa.
              </>
            ) : (
              <>
                Já mandou o pedido <span className="px">{atual.codigo}</span> no WhatsApp? Se não foi, toca de novo no botão.
              </>
            )}
          </p>
          <button type="button" className="sacola-guiado-botao toque" onClick={mandei}>
            Já mandei: limpar a sacola
          </button>
        </div>
      )}
      {naoAbriu && !voltarProGuiado && (
        <div className="sacola-enviado" role="status">
          <p>
            Não abriu? Toca de novo ou copia o pedido e manda pro WhatsApp da loja: <span className="sacola-numero">{numero}</span>.
          </p>
          <button type="button" className="sacola-guiado-botao toque" onClick={() => avisar(copiarTexto(mensagem) ? 'Pedido copiado.' : 'Segura no botão e copia o texto.')}>
            Copiar o pedido
          </button>
        </div>
      )}
      {fechada && !voltarProGuiado && (
        <p className="sacola-horario">
          {fechada}: a loja responde quando abrir. <Demo ativo={canal.horario.demo} />
        </p>
      )}
      {voltarProGuiado ? (
        <button type="button" className="botao botao-cheio botao-largo sacola-zap" onClick={() => setSacola(false)}>
          Voltar pro pedido guiado
        </button>
      ) : travado || nadaAqui || !href ? (
        <button
          type="button"
          className="botao botao-cheio botao-largo sacola-zap"
          aria-disabled="true"
          aria-describedby={travado ? 'sacola-minimo' : undefined}
          onClick={tocouTravado}
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
      {voltarProGuiado ? (
        <p className="sacola-guiado legenda">O pedido guiado continua de onde parou, com o que tu já respondeu.</p>
      ) : chatAberto ? (
        // a encomenda aberta embaixo: volta pra ela, discreto
        <p className="sacola-guiado">
          <button type="button" className="sacola-guiado-botao toque" onClick={() => setSacola(false)}>
            Voltar pra encomenda
          </button>
        </p>
      ) : (
        <p className="sacola-guiado">
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
        </p>
      )}
    </div>
  )
}
