// Os itens do pedido como a sacola e a mensagem do WhatsApp mostram (nome, quantidade, preço unitário, total da linha
// com o combo e o combo aplicado), pra cópia que vai pro servidor (pedido-envio.ts). A sacola (o "Fechar pedido no
// WhatsApp" direto) e o chat usam: fica no pedaço deles.
import { nomeNaMensagem, textoCombo, textoSubtotal, totais, type LinhaPedido } from './mensagem'
import type { CorpoPedido, ItemPedido } from './pedido-envio'
import { calcularLinha, precoUnitario } from './preco'

// o texto do combo mora em mensagem.ts (a mensagem da sacola mostra ele também)
export { textoCombo }

/** Os itens como a sacola e a mensagem mostram (preço unitário, total com combo), o subtotal e o texto dele. */
export function itensDoPedido(linhas: LinhaPedido[]): { itens: ItemPedido[]; subtotal: number | null; subtotalTexto: string } {
  const validas = linhas.filter((l) => l.qtd > 0)
  const itens = validas.map((l) => {
    const c = calcularLinha(l.produto, l.qtd, l.variacaoId)
    const v = l.variacaoId ? l.produto.variacoes?.find((x) => x.id === l.variacaoId) : undefined
    const unit = precoUnitario(l.produto, l.variacaoId)
    return {
      produtoId: l.produto.id,
      nome: nomeNaMensagem(l),
      variacao: v?.nome ?? null,
      qtd: l.qtd,
      precoUnit: unit,
      total: unit == null ? null : c.total,
      combo: unit == null ? null : textoCombo(c),
    }
  })
  const t = totais(validas)
  return {
    itens,
    // sem nenhum preço conhecido, o subtotal é "a consultar" (null), nunca zero
    subtotal: itens.some((i) => i.total != null) ? t.subtotal : null,
    subtotalTexto: textoSubtotal(t, validas.length > 0),
  }
}

/**
 * A cópia do pedido da sacola (o caminho direto): os itens, o subtotal e o cupom como a mensagem mostra, sem endereço
 * e sem pagamento (o cliente manda na conversa). O nome e o WhatsApp só quando a conta já sabe (nunca perguntados).
 */
export function corpoDaSacola(d: {
  codigo: { codigo: string; token: string; substitui: CorpoPedido['substitui'] }
  uf: string
  cidade: string | null
  linhas: LinhaPedido[]
  nome: string
  whatsapp: string
  cupom: CorpoPedido['cupom']
  mensagem: string
}): CorpoPedido {
  return {
    codigo: d.codigo.codigo,
    token: d.codigo.token,
    tipo: 'pedido',
    origem: 'sacola',
    uf: d.uf,
    cidade: d.cidade ?? '',
    nome: d.nome.trim(),
    whatsapp: d.whatsapp,
    ...itensDoPedido(d.linhas),
    cupom: d.cupom,
    mensagem: d.mensagem,
    site: '',
    substitui: d.codigo.substitui,
  }
}
