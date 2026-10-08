import type { Canal, FormaPagamento } from '../dados/canais'
import { config } from '../dados/config'
import { brl } from './formato'
import { calcularLinha } from './preco'
import { formatarCelular } from './telefone'
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

export interface DadosRateio {
  canal: Canal
  cidade?: string | null
  /** Título do rateio como a loja escreveu ("Arizona Green Tea 680 ml"). */
  titulo: string
  /**
   * Vagas desta mensagem. null = a vaga já existe e o site não sabe quantas são (o servidor disse ja-participa, com o
   * código): a linha do produto sai sem conta e a mensagem pede pra loja conferir. Nunca uma conta que pode estar errada.
   */
  quantidade: number | null
  precoRateio: number
  /** Total que o servidor devolveu (soma em centavos); sem ele, quantidade × preço. */
  total?: number
  /** RAT-XXXX da vaga reservada. Sem código (servidor fora do ar), a mensagem pede pra entrar. */
  codigo?: string | null
  nome: string
  /** Só dígitos, com ou sem o 55. */
  whatsapp: string
}

/**
 * Mensagem do rateio, no padrão do pedido: a vaga reservada (com código), o pedido pra entrar (sem servidor) ou, sem
 * quantidade, a vaga que já existe com aquele código (a loja confere quantas vagas e quanto).
 */
export function montarRateio(d: DadosRateio): string {
  const out = [cabecalho('RATEIO', d.canal, d.cidade)]
  if (d.quantidade == null) out.push(d.titulo.trim())
  else {
    const total = d.total ?? Math.round(d.quantidade * d.precoRateio * 100) / 100
    out.push(`${d.titulo.trim()} — ${d.quantidade} ${d.quantidade === 1 ? 'vaga' : 'vagas'} × ${brl(d.precoRateio)} = ${brl(total)}`)
  }
  if (d.codigo) out.push(`Código: ${d.codigo}`)
  out.push(`Nome: ${d.nome.trim()}`)
  out.push(`WhatsApp: ${formatarCelular(d.whatsapp.replace(/\D/g, '').replace(/^55(?=\d{11}$)/, ''))}`)
  out.push(!d.codigo ? 'Quero entrar no rateio.' : d.quantidade == null ? 'Já tenho vaga nesse rateio. Quero conferir e pagar.' : 'Quero confirmar minha vaga e pagar.')
  return out.join('\n')
}

/**
 * Rateio com a loja fora do ar (o site não conseguiu mostrar os rateios, ou a página de um): o pedido pra entrar vai
 * pelo WhatsApp e a loja passa os rateios abertos. Com o link da página, a loja sabe qual era. Sem estado escolhido, o
 * cabeçalho sai sem a UF (a loja pergunta).
 */
export function montarRateioSemConexao(canal: Canal | null | undefined, cidade?: string | null, link?: string | null): string {
  const topo = canal ? cabecalho('RATEIO', canal, cidade) : 'RATEIO GREEN CHEESE'
  return [topo, link ? `Quero entrar nesse rateio: ${link}` : 'Quero entrar num rateio. Quais estão abertos?'].join('\n')
}

export function montarAviso(canal: Canal, cidade: string | null | undefined, produto: Produto): string {
  return [
    cabecalho('AVISA QUANDO CHEGAR', canal, cidade),
    `${produto.nome}${produto.tamanho ? ` ${produto.tamanho}` : ''}`,
    'Vi no site que tá indisponível. Me chama quando chegar!',
  ].join('\n')
}

/** WhatsApp que fecha o pedido do canal (só dígitos): o do estado, se tiver; senão o da loja. */
export function whatsappDoCanal(canal: Canal): string {
  return (canal.whatsapp ?? config.whatsappPedidos).replace(/\D/g, '')
}

/** wa.me com a mensagem pronta. Só o último passo do pedido guiado (pedido e encomenda) e o rateio usam. */
export function linkWhatsApp(canal: Canal, texto: string): string {
  return `https://wa.me/${whatsappDoCanal(canal)}?text=${encodeURIComponent(texto)}`
}

/** wa.me da loja quando ainda não tem estado escolhido (o rateio sem conexão): o WhatsApp de pedidos de todos. */
export function linkWhatsAppLoja(canal: Canal | null | undefined, texto: string): string {
  return canal ? linkWhatsApp(canal, texto) : `https://wa.me/${config.whatsappPedidos.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`
}

/** DM do Instagram do estado: dúvidas que o site não tira e "Avisar quando chegar". */
export function linkDM(canal: Canal): string {
  return `https://ig.me/m/${canal.instagram}`
}

export function linkPerfil(instagram: string): string {
  return `https://www.instagram.com/${instagram}/`
}
