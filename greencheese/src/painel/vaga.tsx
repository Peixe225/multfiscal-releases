// O que dá pra fazer com a vaga de alguém (API.md, tabela de status da participação), com as confirmações e o
// resultado (o "Avisar no WhatsApp" com a mensagem pronta logo depois de confirmar o pagamento).
import * as api from './api'
import type { PedidoConfirmacao } from './Confirmar'
import { brl, vagas, whatsappBonito } from './formato'
import { linkWhats, mensagemPara, msgConfirmado } from './mensagens'
import { Link } from './Moldura'
import { caminho } from './rotas'
import type { Participante, RateioAdmin, StatusVaga } from './tipos'
import { Aviso, Ic, Linha } from './ui'

export const NOME_VAGA: Record<StatusVaga, string> = {
  reservado: 'Esperando pagamento',
  confirmado: 'Pago',
  entregue: 'Entregue',
  expirado: 'Venceu',
  cancelado: 'Cancelada',
}

export type AoMudar = (r: { participante: Participante; rateio: RateioAdmin }) => void

/** Botão-link do WhatsApp com a mensagem pronta. */
export function BotaoWhats({ p, texto, rotulo = 'Avisar no WhatsApp', variante = 'cheio', pequeno = false, aoTocar }: { p: Participante; texto: string; rotulo?: string; variante?: 'cheio' | 'cinza' | 'contorno'; pequeno?: boolean; aoTocar?: () => void }) {
  if (!p.whatsapp) return null
  return (
    <a className={`pn-botao pn-botao-${variante}${pequeno ? ' pn-botao-p' : ''}`} href={linkWhats(p.whatsapp, texto)} target="_blank" rel="noopener noreferrer" onClick={aoTocar}>
      <Ic nome="whatsapp" tamanho={16} />
      <span className="pn-botao-txt">{rotulo}</span>
      <span className="sr-only"> (abre o WhatsApp de {p.nome})</span>
    </a>
  )
}

function Quem({ p, titulo }: { p: Participante; titulo?: string }) {
  return (
    <dl className="pn-lista-det">
      <Linha rotulo="Quem">{p.nome}</Linha>
      <Linha rotulo="Código">
        <span className="pn-codigo">{p.codigo}</span>
      </Linha>
      {titulo && <Linha rotulo="Rateio">{titulo}</Linha>}
      <Linha rotulo="Vagas">
        {vagas(p.quantidade)} · <strong>{brl(p.total)}</strong>
      </Linha>
      {p.whatsapp && <Linha rotulo="WhatsApp">{whatsappBonito(p.whatsapp)}</Linha>}
    </dl>
  )
}

/** Confirmar o pagamento: o contador sobe; depois, o aviso pronto (e o "lotou", se fechou sozinho). */
export function pedirConfirmarPagamento(p: Participante, r: Pick<RateioAdmin, 'confirmadas' | 'vagas' | 'titulo'> | null, aoMudar: AoMudar, noRateio = true): PedidoConfirmacao {
  const conta = r ? `O contador vai de ${r.confirmadas}/${r.vagas} pra ${Math.min(r.vagas, r.confirmadas + p.quantidade)}/${r.vagas}.` : 'O contador sobe.'
  return {
    titulo: 'Confirmar pagamento?',
    texto: (
      <p>
        Confirma só depois de ver o Pix na conta. {conta}
      </p>
    ),
    detalhes: <Quem p={p} titulo={noRateio ? undefined : r?.titulo} />,
    botao: 'Confirmar pagamento',
    acao: async () => {
      const antes = r ? r.confirmadas : null
      const res = await api.statusParticipante(p.id, 'confirmado')
      aoMudar(res)
      const fechou = res.rateio.status === 'fechado' && res.rateio.fechadoEm && antes !== null && antes < res.rateio.vagas && res.rateio.confirmadas >= res.rateio.vagas
      return {
        // outro aparelho (ou o toque antes do "demorou") já tinha confirmado: o contador não mudou
        titulo: res.jaEstava ? 'Já estava confirmado' : 'Pagamento confirmado ✅',
        conteudo: (
          <div className="pn-resultado">
            <p className="pn-resultado-num px">
              {res.rateio.confirmadas}/{res.rateio.vagas}
            </p>
            {fechou && (
              <p className="pn-resultado-selo">
                <span className="pn-selo px pn-selo-fechado pn-carimbo">LOTOU</span>
              </p>
            )}
            <p>
              Vaga de {res.participante.nome} garantida no rateio de {res.rateio.titulo}. Manda a confirmação no WhatsApp:
            </p>
            {fechou && <Aviso tipo="ok">Lotou! O rateio fechou sozinho. Quando fizer o pedido, marca “Pedido feito” e avisa todo mundo.</Aviso>}
            <BotaoWhats p={res.participante} texto={msgConfirmado(res.participante, res.rateio)} />
            {!noRateio && (
              <Link className="pn-botao pn-botao-cinza" href={caminho.rateio(res.rateio.id)}>
                <span className="pn-botao-txt">Abrir o rateio</span>
              </Link>
            )}
          </div>
        ),
      }
    },
  }
}

export function pedirCancelar(p: Participante, aoMudar: AoMudar): PedidoConfirmacao {
  const pago = p.status === 'confirmado'
  return {
    titulo: pago ? 'Cancelar a vaga paga?' : 'Cancelar a reserva?',
    texto: pago ? (
      <p>
        A vaga volta pra lista e o contador desce {p.quantidade}. Combina com {p.nome.split(' ')[0]} no WhatsApp o que fazer com o pagamento.
      </p>
    ) : (
      <p>A reserva sai e a vaga volta pra lista.</p>
    ),
    detalhes: <Quem p={p} />,
    botao: pago ? 'Cancelar a vaga' : 'Cancelar a reserva',
    perigo: true,
    acao: async () => {
      aoMudar(await api.statusParticipante(p.id, 'cancelado'))
    },
  }
}

export function pedirDesfazerConfirmacao(p: Participante, r: RateioAdmin, aoMudar: AoMudar): PedidoConfirmacao {
  return {
    titulo: 'Desfazer o pagamento?',
    texto: <p>Volta pra “esperando pagamento”, com prazo novo de {r.reservaHoras} h, e o contador desce {p.quantidade}. Use se confirmou a pessoa errada.</p>,
    detalhes: <Quem p={p} />,
    botao: 'Desfazer o pagamento',
    perigo: true,
    acao: async () => {
      aoMudar(await api.statusParticipante(p.id, 'reservado'))
    },
  }
}

export function pedirReservarDeNovo(p: Participante, r: RateioAdmin, aoMudar: AoMudar): PedidoConfirmacao {
  return {
    titulo: 'Reservar de novo?',
    texto: <p>A vaga volta pra {p.nome.split(' ')[0]} por {r.reservaHoras} h, se ainda tiver vaga sobrando.</p>,
    detalhes: <Quem p={p} />,
    botao: 'Reservar de novo',
    acao: async () => {
      aoMudar(await api.statusParticipante(p.id, 'reservado'))
    },
  }
}

export function pedirApagarDados(p: Participante, aoMudar: AoMudar): PedidoConfirmacao {
  return {
    titulo: 'Apagar os dados?',
    texto: <p>Nome, WhatsApp, cidade e observação de {p.nome} somem pra sempre (é o pedido de exclusão da LGPD). A vaga continua nas contas do rateio.</p>,
    detalhes: <Quem p={p} />,
    botao: 'Apagar os dados',
    perigo: true,
    acao: async () => {
      aoMudar(await api.apagarParticipante(p.id))
    },
  }
}

/** Aviso de agora pra uma pessoa (cobrar, venceu, confirmado, fechou…). */
export function avisoDeAgora(p: Participante, r: RateioAdmin): { texto: string; rotulo: string } {
  const texto = mensagemPara(p, r, api.agora())
  const rotulo = p.status === 'reservado' && r.status === 'aberto' ? 'Cobrar no WhatsApp' : p.status === 'expirado' ? 'Avisar que venceu' : 'Avisar no WhatsApp'
  return { texto, rotulo }
}
