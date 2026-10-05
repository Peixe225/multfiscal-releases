import type { Canal, FormaPagamento } from '../dados/canais'
import { brl } from './formato'
import { calcularLinha } from './preco'
import type { Produto } from './tipos'

export interface LinhaPedido {
  produto: Produto
  variacaoId?: string | null
  qtd: number
}

export interface DadosPedido {
  canal: Canal
  /** Cidade atendida escolhida, ou a cidade informada pela pessoa quando o canal ainda não tem cidade cadastrada. */
  cidade?: string | null
  linhas: LinhaPedido[]
  nome: string
  endereco: string
  pagamento: FormaPagamento | null
  /** Só para dinheiro: valor para o troco (null = sem troco). */
  troco?: number | null
  obs?: string
  /**
   * Cupom de um interativo (ex.: Teste minha sorte), só quando ele vale nesse pedido. Vira UMA linha logo depois do
   * "Subtotal:"; o subtotal nunca é recalculado (a loja confirma o desconto). exemplo = prêmio de exemplo da prévia.
   */
  cupom?: { codigo: string; regra: string; origem: string; exemplo: boolean }
}

export const NOME_PAGAMENTO: Record<FormaPagamento, string> = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  cartao: 'Cartão na entrega',
}

export function cabecalho(tipo: string, canal: Canal, cidade?: string | null): string {
  return `${tipo} GREEN CHEESE — ${canal.uf.toUpperCase()}${cidade ? ` / ${cidade}` : ''}`
}

export function nomeNaMensagem(l: LinhaPedido): string {
  const p = l.produto
  const v = l.variacaoId ? p.variacoes?.find((x) => x.id === l.variacaoId) : undefined
  return `${p.nome}${p.tamanho ? ` ${p.tamanho}` : ''}${v ? ` (${v.nome})` : ''}`
}

export interface Totais {
  subtotal: number
  temConsultar: boolean
  economia: number
}

export function totais(linhas: LinhaPedido[]): Totais {
  let subtotal = 0
  let temConsultar = false
  let economia = 0
  for (const l of linhas) {
    const c = calcularLinha(l.produto, l.qtd, l.variacaoId)
    if (c.total == null) temConsultar = true
    else {
      subtotal += c.total
      economia += c.economia
    }
  }
  return { subtotal: Math.round(subtotal * 100) / 100, temConsultar, economia: Math.round(economia * 100) / 100 }
}

export function textoSubtotal(t: Totais, temItens: boolean): string {
  if (!temItens) return 'a consultar'
  if (t.subtotal === 0 && t.temConsultar) return 'a consultar'
  return `${brl(t.subtotal)}${t.temConsultar ? ' + itens a consultar' : ''}`
}

export function textoPagamento(pagamento: FormaPagamento | null, troco?: number | null): string {
  if (!pagamento) return 'a combinar'
  if (pagamento === 'dinheiro') return troco ? `Dinheiro (troco pra ${brl(troco)})` : 'Dinheiro (sem troco)'
  return NOME_PAGAMENTO[pagamento]
}

/** Mensagem do pedido no formato combinado com a loja. Quem envia é o cliente. */
export function montarPedido(d: DadosPedido): string {
  const linhas = d.linhas.filter((l) => l.qtd > 0)
  const out = [cabecalho('PEDIDO', d.canal, d.cidade)]
  for (const l of linhas) {
    const c = calcularLinha(l.produto, l.qtd, l.variacaoId)
    out.push(`${l.qtd}x ${nomeNaMensagem(l)} — ${c.total == null ? 'preço a consultar' : brl(c.total)}`)
  }
  out.push(`Subtotal: ${textoSubtotal(totais(linhas), linhas.length > 0)}`)
  // sem cupom, a mensagem fica byte a byte igual (scripts/conferir-mensagem.mjs confere)
  if (d.cupom) out.push(`Cupom: ${d.cupom.codigo} — ${d.cupom.regra} (${d.cupom.origem} · ${d.cupom.exemplo ? 'exemplo · ' : ''}a loja confirma)`)
  out.push(`Entrega: ${d.endereco.trim() || 'a combinar'} (taxa a confirmar)`)
  out.push(`Pagamento: ${textoPagamento(d.pagamento, d.troco)}`)
  out.push(`Nome: ${d.nome.trim()}`)
  if (d.obs?.trim()) out.push(`Obs.: ${d.obs.trim()}`)
  return out.join('\n')
}

export interface DadosEncomenda {
  canal: Canal
  cidade?: string | null
  produto: string
  quantidade: string
  referencia?: string
  nome: string
}

export function montarEncomenda(d: DadosEncomenda): string {
  const out = [cabecalho('ENCOMENDA', d.canal, d.cidade)]
  out.push(`Produto: ${d.produto.trim()}`)
  out.push(`Quantidade: ${d.quantidade.trim()}`)
  if (d.referencia?.trim()) out.push(`Link/descrição: ${d.referencia.trim()}`)
  out.push(`Nome: ${d.nome.trim()}`)
  return out.join('\n')
}

export function montarAviso(canal: Canal, cidade: string | null | undefined, produto: Produto): string {
  return [
    cabecalho('AVISA QUANDO CHEGAR', canal, cidade),
    `${produto.nome}${produto.tamanho ? ` ${produto.tamanho}` : ''}`,
    'Vi no site que tá indisponível. Me chama quando chegar!',
  ].join('\n')
}

/** wa.me com número quando o canal tem WhatsApp; sem número, abre o WhatsApp para a pessoa escolher o contato. */
export function linkWhatsApp(canal: Canal, texto: string): string {
  const t = encodeURIComponent(texto)
  return canal.whatsapp ? `https://wa.me/${canal.whatsapp.replace(/\D/g, '')}?text=${t}` : `https://wa.me/?text=${t}`
}

export function linkDM(canal: Canal): string {
  return `https://ig.me/m/${canal.instagram}`
}

export function linkPerfil(instagram: string): string {
  return `https://www.instagram.com/${instagram}/`
}
