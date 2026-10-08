// Mensagens prontas do WhatsApp, no tom da loja: frase curta, direta, sem promessa que a loja não fez.
// O dono toca no link (wa.me com o texto) e a conversa abre com a mensagem escrita; ele só manda.
import { ateQuando, brl, faixaDias, janela, vagas } from './formato'
import type { Participante, RateioAdmin, StatusRateio } from './tipos'

export function linkWhats(numero: string, texto: string): string {
  return `https://wa.me/${numero.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`
}

function primeiroNome(nome: string): string {
  const n = nome.trim().split(/\s+/)[0] ?? ''
  return n.length >= 2 ? n : nome.trim()
}

const oi = (p: Participante) => `Oi, ${primeiroNome(p.nome)}!`
const vaga = (p: Participante) => `Código ${p.codigo} · ${vagas(p.quantidade)} · ${brl(p.total)}.`

function previsao(r: RateioAdmin): string {
  const j = janela(r.fechadoEm, r.previsaoMin, r.previsaoMax)
  return j ? `Previsão de chegada: ${j}.` : `Chega ${faixaDias(r.previsaoMin, r.previsaoMax)} depois que fechar.`
}

/** Pagamento confirmado (o contador subiu). */
export function msgConfirmado(p: Participante, r: RateioAdmin): string {
  const depois = r.status === 'aberto' ? `Quando as ${r.vagas} vagas fecharem, a gente faz o pedido e te avisa. ${previsao(r)}` : previsao(r)
  return `${oi(p)} Pagamento confirmado ✅\nTua vaga no rateio de ${r.titulo} tá garantida.\n${vaga(p)}\n${depois}`
}

/** Reserva esperando pagamento: lembrete com o prazo. */
export function msgCobrar(p: Participante, r: RateioAdmin, agora = Date.now()): string {
  const ate = p.expiraEm ? ` até ${ateQuando(p.expiraEm, agora)}` : ''
  return `${oi(p)} Tua vaga no rateio de ${r.titulo} tá reservada${ate}.\n${vaga(p)}\nPra garantir, é só fazer o pagamento. Me chama aqui que te passo o Pix.`
}

/** A reserva venceu e a vaga voltou. */
export function msgVenceu(p: Participante, r: RateioAdmin): string {
  return `${oi(p)} Tua reserva ${p.codigo} no rateio de ${r.titulo} venceu e a vaga voltou pra lista.\nSe ainda quiser entrar, me chama aqui que a gente vê se sobrou vaga.`
}

function msgFechou(p: Participante, r: RateioAdmin, agora: number): string {
  if (p.status === 'reservado') {
    const ate = p.expiraEm ? ` vale até ${ateQuando(p.expiraEm, agora)}` : ' ainda tá de pé'
    return `${oi(p)} O rateio de ${r.titulo} fechou.\nTua reserva ${p.codigo}${ate}: faz o pagamento pra garantir tua vaga.`
  }
  const como = r.confirmadas >= r.vagas ? `Fechou! O rateio de ${r.titulo} lotou ✅` : `O rateio de ${r.titulo} fechou ✅`
  return `${oi(p)} ${como}\nAgora a gente faz o pedido. ${previsao(r)}\nTe aviso de cada passo. Teu código: ${p.codigo}.`
}

function msgPedido(p: Participante, r: RateioAdmin): string {
  return `${oi(p)} Pedido feito! O rateio de ${r.titulo} já foi encomendado.\n${previsao(r)}\nTe aviso quando chegar. Código ${p.codigo}.`
}

function msgCaminho(p: Participante, r: RateioAdmin): string {
  return `${oi(p)} Tá a caminho! O rateio de ${r.titulo} já saiu e tá vindo.\n${previsao(r)}\nCódigo ${p.codigo}.`
}

function msgChegou(p: Participante, r: RateioAdmin): string {
  return `${oi(p)} Chegou! O rateio de ${r.titulo} tá aqui ✅\nBora combinar a entrega? Teu código: ${p.codigo} · ${vagas(p.quantidade)}.`
}

function msgCancelado(p: Participante, r: RateioAdmin): string {
  if (p.status === 'reservado' || p.status === 'expirado') {
    return `${oi(p)} O rateio de ${r.titulo} foi cancelado e tua reserva ${p.codigo} saiu.\nSe já tinha feito o Pix, me chama aqui que a gente resolve.`
  }
  return `${oi(p)} O rateio de ${r.titulo} foi cancelado.\nVou te chamar aqui pra combinar o que fazer com o teu pagamento (código ${p.codigo}).`
}

function msgEntregue(p: Participante, r: RateioAdmin): string {
  return `${oi(p)} Entrega do rateio de ${r.titulo} feita ✅ Valeu por entrar!\nQualquer coisa, chama aqui.`
}

function msgVagaCancelada(p: Participante, r: RateioAdmin): string {
  return `${oi(p)} Tua vaga ${p.codigo} no rateio de ${r.titulo} foi cancelada.\nQualquer dúvida, chama aqui.`
}

/** A mensagem certa pra uma pessoa agora (status dela + passo do rateio). */
export function mensagemPara(p: Participante, r: RateioAdmin, agora = Date.now()): string {
  if (r.status === 'cancelado') return msgCancelado(p, r)
  switch (p.status) {
    case 'reservado':
      return r.status === 'aberto' ? msgCobrar(p, r, agora) : msgFechou(p, r, agora)
    case 'expirado':
      return msgVenceu(p, r)
    case 'cancelado':
      return msgVagaCancelada(p, r)
    case 'entregue':
      return msgEntregue(p, r)
    default:
      return mensagemDoPasso(r.status, p, r, agora) ?? msgConfirmado(p, r)
  }
}

/** Aviso de um passo do rateio pra uma pessoa (null = esse passo não avisa ninguém). */
export function mensagemDoPasso(passo: StatusRateio, p: Participante, r: RateioAdmin, agora = Date.now()): string | null {
  switch (passo) {
    case 'fechado':
      return msgFechou(p, r, agora)
    case 'pedido':
      return msgPedido(p, r)
    case 'caminho':
      return msgCaminho(p, r)
    case 'chegou':
      return msgChegou(p, r)
    case 'cancelado':
      return msgCancelado(p, r)
    default:
      return null
  }
}

/** Quem recebe o aviso de cada passo: quem pagou (e, no fechou e no cancelado, quem ainda tá reservado). */
export function quemAvisar(passo: StatusRateio, lista: Participante[]): Participante[] {
  const comNumero = lista.filter((p) => p.whatsapp)
  switch (passo) {
    case 'fechado':
    case 'cancelado':
      return comNumero.filter((p) => p.status === 'confirmado' || p.status === 'reservado')
    case 'pedido':
    case 'caminho':
      return comNumero.filter((p) => p.status === 'confirmado' || p.status === 'entregue')
    case 'chegou':
      return comNumero.filter((p) => p.status === 'confirmado')
    default:
      return []
  }
}

/** Passos que têm aviso pra mandar. */
export const PASSOS_COM_AVISO: StatusRateio[] = ['fechado', 'pedido', 'caminho', 'chegou', 'cancelado']
