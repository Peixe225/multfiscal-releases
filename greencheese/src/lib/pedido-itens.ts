// Os itens do pedido como a sacola e a mensagem do WhatsApp mostram (nome, quantidade, preço unitário, total da linha
// com o combo e o combo aplicado), pra cópia que vai pro servidor (pedido-envio.ts). Só o chat usa: fica no pedaço dele.
import { brl } from './formato'
import { nomeNaMensagem, textoSubtotal, totais, type LinhaPedido } from './mensagem'
import type { ItemPedido } from './pedido-envio'
import { calcularLinha, precoUnitario } from './preco'

/** "3 por R$ 19,99" · "2× 3 por R$ 19,99 + 1 avulsa" · null (sem combo). */
export function textoCombo(c: ReturnType<typeof calcularLinha>): string | null {
  if (!c.combos.length) return null
  const partes = c.combos.map((x) => `${x.vezes > 1 ? `${x.vezes}× ` : ''}${x.qtd} por ${brl(x.total)}`)
  if (c.avulsas > 0) partes.push(`${c.avulsas} ${c.avulsas === 1 ? 'avulsa' : 'avulsas'}`)
  return partes.join(' + ')
}

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
