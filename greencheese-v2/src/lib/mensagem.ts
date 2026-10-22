import type { Canal, FormaPagamento } from '../dados/canais'
import { config } from '../dados/config'
import { chaveBairro, fraseConsultaBairro, taxaDoBairro } from './bairros'
import { brl } from './formato'
import { atendeAindaHoje, ehDiaDeEntregaGratis } from './horario'
import { agoraLoja } from './relogio'
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
  /** A hora do pedido (o dia da entrega grátis); sem ela, agora. */
  agora?: Date
  /**
   * Código do pedido (GC-XXXXX, nasce no aparelho): UMA linha logo depois do cabeçalho, pra loja achar o pedido no
   * painel. O resto da mensagem não muda.
   */
  codigo?: string | null
  /**
   * O bairro do cliente (o do CEP, ou o "Teu bairro" da sacola): só conta quando o estado cobra por bairro (a taxa por
   * bairro, 22/10). No estado de uma taxa só, nada muda na mensagem.
   */
  bairro?: string | null
  /**
   * A cidade pra achar o bairro na lista quando a do cabeçalho (`cidade`) não é conhecida: a do CEP (o estado com mais
   * de uma cidade, e o cliente que não escolheu a dele). A mesma que o servidor usa (a cidade do pedido e, sem ela, a do
   * CEP). Não muda o cabeçalho.
   */
  cidadeBairro?: string | null
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

/**
 * A entrega do estado como o painel deixou: 'gratis' (hoje é dia de entrega grátis), o valor da taxa (o dono pôs um
 * valor de verdade; o de exemplo só com o carimbo de exemplo à vista; 0 = o dono disse que a entrega não tem taxa) ou
 * null (a confirmar no atendimento). O dia é o de Brasília, pela hora da loja (src/lib/relogio.ts). O "grátis hoje" só
 * com a loja atendendo ainda hoje (aberta, ou abre mais tarde): fechada até amanhã, o pedido só sai amanhã, e a
 * mensagem não promete o grátis de hoje (fica a taxa do painel, ou a confirmar). O horário de exemplo não conta.
 */
export function entregaDoCanal(canal: Canal, agora = new Date(agoraLoja())): 'gratis' | number | null {
  const g = canal.entregaGratis
  const horarioVale = !canal.horario.demo || config.carimboDeExemplo
  if (g && (!g.demo || config.carimboDeExemplo) && ehDiaDeEntregaGratis(canal, agora) && (!horarioVale || atendeAindaHoje(canal, agora))) return 'gratis'
  const t = canal.taxaEntrega
  return t.valor != null && (!t.demo || config.carimboDeExemplo) ? t.valor : null
}

/** O que vai entre parênteses na linha da entrega: "entrega grátis hoje", "entrega grátis" (taxa 0), "taxa R$ 15,50" ou "taxa a confirmar". */
export function textoEntrega(entrega: 'gratis' | number | null): string {
  if (entrega === 'gratis') return 'entrega grátis hoje'
  if (entrega === 0) return 'entrega grátis'
  return entrega != null ? `taxa ${brl(entrega)}` : 'taxa a confirmar'
}

/**
 * A entrega do pedido, com a taxa por bairro (22/10): 'gratis-hoje' (o dia de entrega grátis vale por cima de tudo; o
 * bairro vai junto quando o estado cobra por bairro), 'estado' (uma taxa só: o de sempre, entregaDoCanal), 'bairro' (o
 * bairro tá na lista com a taxa), 'bairro-consultar' (a lista aparece no site, mas o bairro tá fora dela, marcado
 * "consultar" ou o cliente não disse) e 'consulta' (o site não mostra valor: o cliente pergunta na conversa).
 */
export type Entrega =
  | { tipo: 'gratis-hoje'; bairro: string | null }
  | { tipo: 'estado'; valor: number | null }
  | { tipo: 'bairro'; bairro: string; valor: number }
  | { tipo: 'bairro-consultar'; bairro: string | null }
  | { tipo: 'consulta'; bairro: string | null }

export function entregaDoPedido(canal: Canal, bairro: string | null | undefined, cidade: string | null | undefined, agora = new Date(agoraLoja())): Entrega {
  const e = entregaDoCanal(canal, agora)
  const t = taxaDoBairro(canal, bairro, cidade)
  if (e === 'gratis') return { tipo: 'gratis-hoje', bairro: t.tipo === 'estado' ? null : t.bairro }
  if (t.tipo === 'estado') return { tipo: 'estado', valor: e }
  if (t.tipo === 'consulta') return { tipo: 'consulta', bairro: t.bairro }
  if (t.tipo === 'valor') return { tipo: 'bairro', bairro: t.bairro, valor: t.valor }
  return { tipo: 'bairro-consultar', bairro: t.bairro }
}

/** O bairro já tá escrito no endereço? (o do CEP sempre tá: aí a taxa não repete o nome) */
function bairroNoTexto(texto: string, bairro: string): boolean {
  const b = chaveBairro(bairro)
  return !!b && ` ${chaveBairro(texto)} `.includes(` ${b} `)
}

/**
 * O que vai entre parênteses na linha da entrega do pedido guiado, com a taxa por bairro: "taxa do bairro: R$ 12,00"
 * (o bairro já tá no endereço) ou "taxa do bairro Copacabana: R$ 12,00", "taxa do bairro a consultar", "taxa a
 * consultar pelo bairro" (o modo consulta) e, no estado de uma taxa só, o de sempre (textoEntrega).
 */
export function entregaNoGuiado(e: Entrega, endereco: string): string {
  const nome = (b: string | null) => (b && !bairroNoTexto(endereco, b) ? ` ${b}` : '')
  switch (e.tipo) {
    case 'gratis-hoje':
      return textoEntrega('gratis')
    case 'estado':
      return textoEntrega(e.valor)
    case 'bairro':
      return e.valor === 0 ? `bairro${nome(e.bairro)} sem taxa` : `taxa do bairro${nome(e.bairro)}: ${brl(e.valor)}`
    case 'bairro-consultar':
      return `taxa do bairro${nome(e.bairro)} a consultar`
    case 'consulta':
      return `taxa a consultar pelo bairro${nome(e.bairro)}`
  }
}

/**
 * A linha da entrega do pedido da sacola, com a taxa por bairro: "Copacabana (taxa R$ 12,00)", "Copacabana (taxa do
 * bairro a consultar)", "taxa do bairro a consultar" (sem bairro), "taxa a consultar (bairro Copacabana)" (o modo
 * consulta), "Copacabana (grátis hoje)" e, no estado de uma taxa só, o de sempre (entregaDaSacola).
 */
export function entregaNaSacola(e: Entrega): string {
  switch (e.tipo) {
    case 'gratis-hoje':
      // no dia de entrega grátis a sacola não mostra o "Teu bairro" (a taxa não depende dele): o bairro guardado de
      // outra visita, que o cliente nem vê, não vai na mensagem
      return entregaDaSacola('gratis')
    case 'estado':
      return entregaDaSacola(e.valor)
    case 'bairro':
      return `${e.bairro} (${e.valor === 0 ? 'grátis' : `taxa ${brl(e.valor)}`})`
    case 'bairro-consultar':
      return e.bairro ? `${e.bairro} (taxa do bairro a consultar)` : 'taxa do bairro a consultar'
    case 'consulta':
      return e.bairro ? `taxa a consultar (bairro ${e.bairro})` : 'taxa a consultar (depende do bairro)'
  }
}

/**
 * A taxa que o site mostrou, pra cópia do pedido no servidor (o painel guarda; o aviso do grupo diz a da tabela do
 * servidor): o valor (null = sem valor) e o texto, sem o bairro (o bairro vai no campo dele).
 */
export function taxaParaOServidor(e: Entrega, agora?: Date): { valor: number | null; texto: string; em?: number } {
  // em: quando o site mostrou essa taxa (a hora da loja que montou a mensagem, unix): o dia de entrega grátis é o do
  // toque, mesmo que a cópia chegue depois da meia-noite (a fila do aparelho manda de novo por até 3 dias)
  const em = agora ? { em: Math.floor(agora.getTime() / 1000) } : {}
  switch (e.tipo) {
    case 'gratis-hoje':
      return { valor: null, texto: entregaDaSacola('gratis'), ...em }
    case 'estado':
      return { valor: e.valor, texto: entregaDaSacola(e.valor), ...em }
    case 'bairro':
      return { valor: e.valor, texto: e.valor === 0 ? 'grátis' : `taxa ${brl(e.valor)}`, ...em }
    case 'bairro-consultar':
      return { valor: null, texto: 'taxa do bairro a consultar', ...em }
    case 'consulta':
      return { valor: null, texto: 'taxa a consultar', ...em }
  }
}

/**
 * Mensagem do pedido no formato combinado com a loja. Quem envia é o cliente. A entrega diz a taxa que o painel pôs
 * (ou o dia de entrega grátis); sem isso (ou com a de exemplo), "taxa a confirmar", como sempre. Com a taxa por bairro,
 * a do bairro (ou "a consultar").
 */
export function montarPedido(d: DadosPedido): string {
  const linhas = d.linhas.filter((l) => l.qtd > 0)
  const out = [cabecalho('PEDIDO', d.canal, d.cidade)]
  if (d.codigo) out.push(`Código: ${d.codigo}`)
  for (const l of linhas) {
    const c = calcularLinha(l.produto, l.qtd, l.variacaoId)
    out.push(`${l.qtd}x ${nomeNaMensagem(l)} — ${c.total == null ? 'preço a consultar' : brl(c.total)}`)
  }
  out.push(`Subtotal: ${textoSubtotal(totais(linhas), linhas.length > 0)}`)
  // sem cupom (e sem código), a mensagem fica byte a byte igual (scripts/conferir-mensagem.mjs confere)
  if (d.cupom) out.push(`Cupom: ${d.cupom.codigo} — ${d.cupom.regra} (${d.cupom.origem} · ${d.cupom.exemplo ? 'exemplo · ' : ''}a loja confirma)`)
  const endereco = d.endereco.trim() || 'a combinar'
  out.push(`Entrega: ${endereco} (${entregaNoGuiado(entregaDoPedido(d.canal, d.bairro, d.cidade || d.cidadeBairro, d.agora), endereco)})`)
  out.push(`Pagamento: ${textoPagamento(d.pagamento, d.troco)}`)
  out.push(`Nome: ${d.nome.trim()}`)
  if (d.obs?.trim()) out.push(`Obs.: ${d.obs.trim()}`)
  return out.join('\n')
}

/** "3 por R$ 19,99" · "2× 3 por R$ 19,99 + 1 avulsa" · null (sem combo): o combo como a sacola mostra. */
export function textoCombo(c: ReturnType<typeof calcularLinha>): string | null {
  if (!c.combos.length) return null
  const partes = c.combos.map((x) => `${x.vezes > 1 ? `${x.vezes}× ` : ''}${x.qtd} por ${brl(x.total)}`)
  if (c.avulsas > 0) partes.push(`${c.avulsas} ${c.avulsas === 1 ? 'avulsa' : 'avulsas'}`)
  return partes.join(' + ')
}

/** A última linha do pedido da sacola: o endereço vai na conversa (o site não pergunta). */
export const LINHA_ENDERECO_SACOLA = 'Endereço: mando aqui na conversa'

export interface DadosPedidoSacola {
  canal: Canal
  cidade?: string | null
  linhas: LinhaPedido[]
  /** O nome que a conta do aparelho já tem (nunca perguntado): vira a linha "Nome:". Sem ele, a linha não vai. */
  nome?: string | null
  /** O cupom que vale nesse pedido (a mesma linha do pedido guiado). */
  cupom?: DadosPedido['cupom']
  agora?: Date
  codigo?: string | null
  /** O "Teu bairro" da sacola (só conta quando o estado cobra por bairro). */
  bairro?: string | null
}

/** A linha da entrega do pedido da sacola: "grátis hoje" · "grátis" (taxa 0) · "taxa R$ 15,50" · "taxa a confirmar". */
export function entregaDaSacola(entrega: 'gratis' | number | null): string {
  if (entrega === 'gratis') return 'grátis hoje'
  if (entrega === 0) return 'grátis'
  return entrega != null ? `taxa ${brl(entrega)}` : 'taxa a confirmar'
}

/**
 * O pedido da sacola (o caminho direto, pedido do Ian em 14/10): um toque e o WhatsApp abre com isto pronto. O mesmo
 * cabeçalho e a mesma linha do código do pedido guiado; cada item com quantidade, nome (tamanho e variação) e preço, com
 * o combo como a sacola mostra; o subtotal; o cupom quando vale; a entrega como o estado diz (sem inventar); o nome só
 * quando a conta já tem; e o endereço, que o cliente manda na conversa. Nada de pedir nome, endereço ou pagamento antes.
 */
export function montarPedidoSacola(d: DadosPedidoSacola): string {
  const linhas = d.linhas.filter((l) => l.qtd > 0)
  const out = [cabecalho('PEDIDO', d.canal, d.cidade)]
  if (d.codigo) out.push(`Código: ${d.codigo}`)
  for (const l of linhas) {
    const c = calcularLinha(l.produto, l.qtd, l.variacaoId)
    const combo = c.total == null ? null : textoCombo(c)
    out.push(`${l.qtd}x ${nomeNaMensagem(l)} — ${c.total == null ? 'preço a consultar' : brl(c.total)}${combo ? ` (combo ${combo})` : ''}`)
  }
  out.push(`Subtotal: ${textoSubtotal(totais(linhas), linhas.length > 0)}`)
  if (d.cupom) out.push(`Cupom: ${d.cupom.codigo} — ${d.cupom.regra} (${d.cupom.origem} · ${d.cupom.exemplo ? 'exemplo · ' : ''}a loja confirma)`)
  out.push(`Entrega: ${entregaNaSacola(entregaDoPedido(d.canal, d.bairro, d.cidade, d.agora))}`)
  const nome = d.nome?.trim()
  if (nome) out.push(`Nome: ${nome}`)
  out.push(LINHA_ENDERECO_SACOLA)
  return out.join('\n')
}

export interface DadosEncomenda {
  canal: Canal
  cidade?: string | null
  produto: string
  quantidade: string
  referencia?: string
  nome: string
  /** Código da encomenda (GC-XXXXX): uma linha logo depois do cabeçalho, como no pedido. */
  codigo?: string | null
}

export function montarEncomenda(d: DadosEncomenda): string {
  const out = [cabecalho('ENCOMENDA', d.canal, d.cidade)]
  if (d.codigo) out.push(`Código: ${d.codigo}`)
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

// O WhatsApp da loja: o embutido (config.whatsappPedidos) até a loja do servidor chegar com o do painel
// (src/store/loja.ts troca). Fica aqui, sem importar o store: o conferir-mensagem roda este arquivo no Node.
let whatsappLoja = config.whatsappPedidos

export function definirWhatsappDaLoja(numero: string): void {
  whatsappLoja = numero
}

/** WhatsApp que fecha o pedido do canal (só dígitos): o do estado, se tiver; senão o da loja. */
export function whatsappDoCanal(canal: Canal): string {
  return (canal.whatsapp ?? whatsappLoja).replace(/\D/g, '')
}

/** wa.me com a mensagem pronta: o "Fechar pedido no WhatsApp" da sacola, o último passo do pedido guiado (pedido e encomenda) e o rateio. */
export function linkWhatsApp(canal: Canal, texto: string): string {
  return `https://wa.me/${whatsappDoCanal(canal)}?text=${encodeURIComponent(texto)}`
}

/** wa.me da loja quando ainda não tem estado escolhido (o rateio sem conexão): o WhatsApp de pedidos de todos. */
export function linkWhatsAppLoja(canal: Canal | null | undefined, texto: string): string {
  return canal ? linkWhatsApp(canal, texto) : `https://wa.me/${whatsappLoja.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`
}

/** DM do Instagram do estado: dúvidas que o site não tira e "Avisar quando chegar". */
export function linkDM(canal: Canal): string {
  return `https://ig.me/m/${canal.instagram}`
}

/**
 * "Perguntar a taxa do meu bairro" (a taxa por bairro no modo consulta, 22/10): a conversa do pedido (o WhatsApp do
 * estado, ou o da loja) com a frase pronta, "Oi! Quanto fica a entrega pro bairro Copacabana?". É a taxa do pedido, e
 * não uma dúvida solta: vai pro mesmo WhatsApp que fecha o pedido, onde a frase já chega escrita (a DM do Instagram não
 * leva texto pronto). Sem WhatsApp nenhum, a DM do estado.
 */
export function linkConsultaBairro(canal: Canal, bairro: string | null | undefined): string {
  return whatsappDoCanal(canal) ? linkWhatsApp(canal, fraseConsultaBairro(bairro)) : linkDM(canal)
}

export function linkPerfil(instagram: string): string {
  return `https://www.instagram.com/${instagram}/`
}
