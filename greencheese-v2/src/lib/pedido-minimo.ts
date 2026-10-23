// O pedido mínimo pra entrega de cada estado (o dono põe no painel, em Estados; pedido do cliente em 14/10: "mínimo 20
// reais pra entrega"). A conta é sobre o subtotal dos produtos como a sacola mostra (com os combos), antes da taxa de
// entrega — o mesmo "Subtotal:" que vai na mensagem do WhatsApp. Sem mínimo no estado, nada muda.
// - Chegou no mínimo: fecha.
// - Faltou: trava o "Fechar pedido no WhatsApp" (da sacola e do pedido guiado) e diz quanto falta.
// - Tem item sem preço ("Consultar") e o que tem preço não chega no mínimo: não dá pra fazer a conta. Não trava: avisa
//   que a loja confere o mínimo na conversa.
// - O cupom: o site nunca calcula o desconto (a loja confirma no WhatsApp; DECISOES.md, item 18), então a conta é sobre
//   o subtotal sem o desconto. Pra loja não sair perdendo calada, quando o desconto do cupom PODERIA levar o pedido pra
//   baixo do mínimo (a conta mais generosa pro cliente, só aqui dentro, nunca na tela), o site avisa que a loja confere o
//   mínimo na conversa — sem travar e sem mostrar valor de desconto.
// Encomenda e rateio não têm mínimo (não passam por aqui).
import type { Canal } from '../dados/canais'
import { totais, type LinhaPedido } from './mensagem'
import { precoUnitario } from './preco'

export type SituacaoMinimo =
  /** O estado não tem pedido mínimo. */
  | { tipo: 'sem' }
  /** Chegou no mínimo. */
  | { tipo: 'ok'; minimo: number }
  /** Falta: o fechar trava até chegar. */
  | { tipo: 'falta'; minimo: number; falta: number; subtotal: number }
  /** Não dá pra conferir aqui (item a consultar, ou o desconto do cupom): não trava, a loja confere na conversa. */
  | { tipo: 'conferir'; minimo: number; motivo: 'consultar' | 'cupom' }

/** O cupom que vai no pedido (o retrato do prêmio do dia em que foi ganho), só o que a conta precisa. */
export interface CupomDoMinimo {
  tipo: string
  valor: unknown
  aplicaA: { produtos?: string[]; categorias?: string[] }
}

const cent = (v: number) => Math.round(v * 100)

/** O mínimo do estado em reais (null = sem mínimo). */
export function minimoDoCanal(canal: Canal | null | undefined): number | null {
  const m = canal?.pedidoMinimo
  return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : null
}

/**
 * O máximo que o desconto do cupom poderia tirar do subtotal (em centavos), lendo a regra do jeito mais generoso pro
 * cliente: o percentual em todas as unidades do produto (ou da categoria), o "leva X paga Y" nas unidades mais caras, e o
 * brinde, se o próprio produto do brinde estiver na sacola. Só pra decidir se avisa: nunca aparece na tela.
 */
export function descontoMaximo(cupom: CupomDoMinimo, linhas: LinhaPedido[]): number {
  const ids = cupom.aplicaA.produtos ?? []
  const cats = cupom.aplicaA.categorias ?? []
  const alvo = (l: LinhaPedido) => ids.includes(l.produto.id) || cats.includes(l.produto.categoria)
  const doAlvo = linhas.filter((l) => l.qtd > 0 && alvo(l))
  if (cupom.tipo === 'desconto-percentual' && typeof cupom.valor === 'number') {
    const base = cent(totais(doAlvo).subtotal)
    return Math.round((base * Math.min(100, Math.max(0, cupom.valor))) / 100)
  }
  if (cupom.tipo === 'leve-x-pague-y' && cupom.valor && typeof cupom.valor === 'object') {
    const { leve, pague } = cupom.valor as { leve?: unknown; pague?: unknown }
    if (typeof leve !== 'number' || typeof pague !== 'number' || leve <= pague || leve <= 0) return 0
    const unidades = doAlvo.reduce((n, l) => n + l.qtd, 0)
    const precos = doAlvo.map((l) => precoUnitario(l.produto, l.variacaoId)).filter((p): p is number => p != null)
    return precos.length ? Math.floor(unidades / leve) * (leve - pague) * cent(Math.max(...precos)) : 0
  }
  if (cupom.tipo === 'brinde' && cupom.valor && typeof cupom.valor === 'object') {
    const { produto, qtd } = cupom.valor as { produto?: unknown; qtd?: unknown }
    const linha = linhas.find((l) => l.produto.id === produto && l.qtd > 0)
    const unit = linha ? precoUnitario(linha.produto, linha.variacaoId) : null
    return linha && unit != null ? Math.min(linha.qtd, typeof qtd === 'number' && qtd > 0 ? qtd : 1) * cent(unit) : 0
  }
  return 0
}

/**
 * O pedido chega no mínimo do estado? `linhas` = o que vai no pedido (os itens disponíveis da sacola, com a quantidade
 * que cabe); `cupom` = o cupom que vale nesse pedido (o que vai na mensagem), ou nada.
 */
export function situacaoMinimo(canal: Canal | null | undefined, linhas: LinhaPedido[], cupom?: CupomDoMinimo | null): SituacaoMinimo {
  const minimo = minimoDoCanal(canal)
  if (minimo == null) return { tipo: 'sem' }
  const t = totais(linhas.filter((l) => l.qtd > 0))
  const sub = cent(t.subtotal)
  const min = cent(minimo)
  if (sub >= min) {
    if (cupom && sub - descontoMaximo(cupom, linhas) < min) return { tipo: 'conferir', minimo, motivo: 'cupom' }
    return { tipo: 'ok', minimo }
  }
  if (t.temConsultar) return { tipo: 'conferir', minimo, motivo: 'consultar' }
  return { tipo: 'falta', minimo, falta: (min - sub) / 100, subtotal: t.subtotal }
}

/** Trava o fechar? (só quando dá pra conferir e falta) */
export const travaPeloMinimo = (s: SituacaoMinimo): s is Extract<SituacaoMinimo, { tipo: 'falta' }> => s.tipo === 'falta'
