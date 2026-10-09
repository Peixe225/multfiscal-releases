// Mensagens prontas pro cliente em cada passo do pedido: o dono toca e a conversa abre com o texto escrito (dá pra
// mexer antes de mandar). Frase curta, no tom da loja, sem prometer prazo, frete ou valor que a loja ainda não passou.
import { canalDa } from '../../dados/canais'
import { doCache } from '../dados'
import { brl } from '../formato'
import { CHAVE as CHAVE_LOJA } from '../loja/dados'
import type { LojaAdmin } from '../loja/tipos'
import type { PedidoAdmin, StatusPedido } from './tipos'

function primeiroNome(nome: string): string {
  const n = nome.trim().split(/\s+/)[0] ?? ''
  return n.length >= 2 ? n : nome.trim()
}

/** "teu pedido GC-7KD2X" · "tua encomenda GC-7KD2X (Fanta de uva japonesa)". */
function oQue(p: PedidoAdmin): string {
  if (p.tipo === 'encomenda') return `tua encomenda ${p.codigo}${p.encomenda?.produto ? ` (${p.encomenda.produto})` : ''}`
  return `teu pedido ${p.codigo}`
}

/** A mensagem do passo (o status que o pedido tem agora, ou o que acabou de ganhar). */
export function mensagemDoPasso(p: PedidoAdmin, status: StatusPedido = p.status): string {
  const oi = `Oi, ${primeiroNome(p.nome)}!`
  const O = oQue(p).replace(/^t/, 'T')
  switch (status) {
    case 'novo':
      return p.tipo === 'encomenda'
        ? `${oi} Recebi ${oQue(p)}. Vou ver se dá pra trazer e te respondo por aqui.`
        : `${oi} Recebi ${oQue(p)}. Já confiro e te respondo por aqui.`
    case 'confirmado':
      if (p.tipo === 'encomenda') return `${oi} ${O} tá confirmada ✅\nTe aviso por aqui quando chegar.`
      return `${oi} ${O} tá confirmado ✅\n${p.subtotal != null ? `Itens: ${brl(p.subtotal)}${p.subtotalTexto.includes('consultar') ? ' + os que a gente confirma aqui' : ''}. ` : ''}A taxa de entrega e o total a gente fecha por aqui.`
    case 'saiu':
      return `${oi} ${O} saiu pra entrega. Qualquer coisa, me chama aqui.`
    case 'entregue': {
      // o @ do estado no painel (Loja → Estados); até a loja chegar, o embutido no site
      const insta = doCache<LojaAdmin>(CHAVE_LOJA)?.estados.find((e) => e.uf === p.uf)?.instagram ?? canalDa(p.uf)?.instagram
      return `${p.tipo === 'encomenda' ? 'Encomenda' : 'Pedido'} ${p.codigo} entregue ✅ Valeu, ${primeiroNome(p.nome)}!${insta ? ` Chegou certinho? Marca @${insta} no story.` : ''}`
    }
    case 'cancelado':
      return `Oi, ${primeiroNome(p.nome)}. ${O} foi cancelad${p.tipo === 'encomenda' ? 'a' : 'o'}. Se quiser refazer ou tiver dúvida, é só me chamar aqui.`
  }
}

/** Rótulo do botão do WhatsApp em cada passo. */
export const ROTULO_AVISO: Record<StatusPedido, string> = {
  novo: 'Responder no WhatsApp',
  confirmado: 'Avisar que confirmou',
  saiu: 'Avisar que saiu',
  entregue: 'Agradecer no WhatsApp',
  cancelado: 'Avisar que cancelou',
}
