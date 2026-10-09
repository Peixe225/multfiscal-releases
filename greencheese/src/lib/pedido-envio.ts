// O pedido no servidor da loja (API.md, "Pedidos"): a cópia estruturada que sai no toque de "Fechar pedido no
// WhatsApp" — sendBeacon (ou fetch keepalive), sem segurar o link (regra do Instagram: o link já está montado; nada
// espera resposta). O código GC-XXXXX e o token nascem em codigo-pedido.ts.
// A cópia fica pendente no aparelho até o servidor confirmar (201, ou 200 "repetido"): quando a aba volta a ficar à
// vista, ou na próxima visita, ela vai de novo (o mesmo código com o mesmo token nunca vira outro pedido). Erro que não
// muda tentando de novo (pedido recusado, site sem servidor) tira da fila.
import type { FormaPagamento } from '../dados/canais'
import { apagar, gravar, ler } from './armazenamento'
import { codigoValido, tokenValido } from './codigo-pedido'
import { brl } from './formato'
import { nomeNaMensagem, textoSubtotal, totais, type LinhaPedido } from './mensagem'
import { calcularLinha, precoUnitario } from './preco'

const API = './api/index.php?r=pedido'
/** Onde ficam as cópias que o servidor ainda não confirmou (o pedaço principal só olha se existe: pedido-pendente.ts). */
export const CHAVE_PENDENTES = 'gc-pedidos'
const MAX_PENDENTES = 10
const VALIDADE_MS = 3 * 86_400_000
const MAX_TENTATIVAS = 8
const LIMITE_MS = 15_000

export interface ItemPedido {
  produtoId: string | null
  /** Como na mensagem: nome, tamanho e variação. */
  nome: string
  variacao: string | null
  qtd: number
  /** null = preço a consultar (nunca inventado). */
  precoUnit: number | null
  /** Total da linha com o combo, como o site mostrou. */
  total: number | null
  /** O combo aplicado ("3 por R$ 19,99", "+ 1 avulsa"), ou null. */
  combo: string | null
}

/** O corpo do POST pedido (API.md). */
export interface CorpoPedido {
  codigo: string
  token: string
  tipo: 'pedido' | 'encomenda'
  uf: string
  cidade: string
  nome: string
  /** Só quando o aparelho sabe (a conta do Teste minha sorte); '' = a loja vê na conversa. */
  whatsapp: string
  itens?: ItemPedido[]
  subtotal?: number | null
  subtotalTexto?: string
  cupom?: { codigo: string; regra: string; origem: string } | null
  entrega?: { endereco: string; rua: string; numero: string; bairro: string; cep: string; cidade: string; uf: string }
  pagamento?: FormaPagamento | null
  troco?: number | null
  obs?: string
  encomenda?: { produto: string; quantidade: string; referencia: string }
  /** A mensagem exata do WhatsApp (com a linha do código). */
  mensagem: string
  /** Armadilha de robô: sempre vazio. */
  site: ''
  /** O pedido que este substitui (o mesmo aparelho mudou depois de mandar). */
  substitui: { codigo: string; token: string } | null
}

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

/* ───────────────────────── fila no aparelho ───────────────────────── */

interface Pendente {
  corpo: CorpoPedido
  criado: number
  tentativas: number
  /** Não antes disso (ms): o servidor pediu pra esperar, ou falhou há pouco. */
  proxima: number
}

/** Aqui não tem servidor nenhum: o arquivo único da prévia ou a página aberta do disco. */
function semServidorAqui(): boolean {
  try {
    return __ARQUIVO_UNICO__ || location.protocol === 'file:'
  } catch {
    return false
  }
}

function lerPendentes(): Pendente[] {
  const agora = Date.now()
  const lista = ler<unknown>(CHAVE_PENDENTES, [])
  if (!Array.isArray(lista)) return []
  return lista.filter((x): x is Pendente => {
    const p = x as Pendente | null
    return (
      !!p &&
      typeof p === 'object' &&
      codigoValido(p.corpo?.codigo) &&
      tokenValido(p.corpo?.token) &&
      typeof p.criado === 'number' &&
      agora - p.criado < VALIDADE_MS &&
      typeof p.tentativas === 'number' &&
      p.tentativas < MAX_TENTATIVAS
    )
  })
}

function gravarPendentes(lista: Pendente[]): void {
  if (lista.length) gravar(CHAVE_PENDENTES, lista.slice(-MAX_PENDENTES))
  else apagar(CHAVE_PENDENTES)
}

function tirar(token: string): void {
  gravarPendentes(lerPendentes().filter((p) => p.corpo.token !== token))
}

function adiar(token: string, esperaMs: number | null): void {
  gravarPendentes(
    lerPendentes().map((p) => {
      if (p.corpo.token !== token) return p
      const tentativas = p.tentativas + 1
      // 30 s, 1 min, 2 min… até 6 h; ou o tempo que o servidor mandou
      const espera = esperaMs ?? Math.min(6 * 3600_000, 30_000 * 2 ** (tentativas - 1))
      return { ...p, tentativas, proxima: Date.now() + espera }
    }),
  )
}

type Resultado = { tipo: 'ok' } | { tipo: 'tirar' } | { tipo: 'depois'; esperaMs: number | null }
type Resposta = { ok?: unknown; erro?: unknown; esperaSegundos?: unknown }

/** Um envio com resposta (fetch). keepalive = o toque, com a página saindo pro WhatsApp. */
async function mandar(corpo: CorpoPedido, keepalive: boolean): Promise<Resultado> {
  const ctrl = !keepalive && typeof AbortController !== 'undefined' ? new AbortController() : null
  const t = ctrl ? setTimeout(() => ctrl.abort(), LIMITE_MS) : 0
  let r: Response
  try {
    r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(corpo),
      keepalive,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctrl?.signal,
    })
  } catch {
    if (ctrl) clearTimeout(t)
    return { tipo: 'depois', esperaMs: null }
  }
  let j: Resposta | null = null
  try {
    j = (await r.json()) as Resposta
  } catch {
    j = null
  } finally {
    if (ctrl) clearTimeout(t)
  }
  if (!j || typeof j !== 'object' || typeof j.ok !== 'boolean') {
    // sem JSON da API: 404 ou página comum = não tem servidor aqui (zip sem api/); o resto (5xx) = fora do ar agora
    return r.status === 404 || r.ok ? { tipo: 'tirar' } : { tipo: 'depois', esperaMs: null }
  }
  if (j.ok === true && r.ok) return { tipo: 'ok' }
  if (j.erro === 'muitas-tentativas') {
    const s = typeof j.esperaSegundos === 'number' && j.esperaSegundos > 0 ? j.esperaSegundos : 600
    return { tipo: 'depois', esperaMs: s * 1000 }
  }
  // o repasse do Vite com o PHP desligado (npm run dev): aqui não tem servidor
  if (j.erro === 'sem-servidor') return { tipo: 'tirar' }
  if (j.erro === 'ocupado' || j.erro === 'erro-interno' || r.status >= 500) return { tipo: 'depois', esperaMs: null }
  // recusado de vez (dado errado, armadilha, tabaco, Origin): tentar de novo não muda nada
  return { tipo: 'tirar' }
}

function aplicar(token: string, r: Resultado): void {
  if (r.tipo === 'depois') adiar(token, r.esperaMs)
  else tirar(token)
}

/**
 * No toque de "Fechar pedido no WhatsApp": guarda a cópia como pendente e manda sem esperar. sendBeacon primeiro
 * (o navegador entrega mesmo com a página indo embora); se ele recusar, fetch keepalive (aí dá pra ler a resposta).
 */
export function enviarPedido(corpo: CorpoPedido): void {
  if (semServidorAqui()) return
  const resto = lerPendentes().filter((p) => p.corpo.token !== corpo.token)
  gravarPendentes([...resto, { corpo, criado: Date.now(), tentativas: 0, proxima: 0 }])
  let foi = false
  try {
    foi = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(API, new Blob([JSON.stringify(corpo)], { type: 'application/json' }))
  } catch {
    foi = false // navegador que não aceita JSON no beacon
  }
  if (!foi) void mandar(corpo, true).then((r) => aplicar(corpo.token, r))
}

let reenviando = false

/** Manda de novo as cópias que o servidor ainda não confirmou (uma de cada vez, respeitando a espera de cada uma). */
export async function reenviarPendentes(): Promise<void> {
  if (reenviando || semServidorAqui()) return
  reenviando = true
  try {
    const lista = lerPendentes()
    gravarPendentes(lista) // já sem as vencidas
    for (const p of lista) {
      if (p.proxima > Date.now()) continue
      aplicar(p.corpo.token, await mandar(p.corpo, false))
    }
  } finally {
    reenviando = false
  }
}
