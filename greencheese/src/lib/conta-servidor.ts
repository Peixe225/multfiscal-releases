// A conta do cliente no servidor da loja (API.md, "Contas dos clientes"): quem fala com as rotas cliente-* e converte o
// que volta pro formato do cache 'gc-conta' (datas em ms, como a conta do aparelho sempre guardou). O adaptador
// (conta-adaptador.ts) usa pra entrar, girar e guardar; a Minha conta, pros pedidos, vagas, endereços e o arquivo com
// os dados. Baixa junto com o adaptador, fora do pedaço principal.
// Tudo com a sessão do cookie gc_cliente (HttpOnly: o site nunca lê). 401 sem-sessao = a sessão morreu: a conta sai
// do cache (conta-modo.ts) e a tela volta pro "Entrar".
import type { Conta, Cupom, EnderecoConta, EstadoConta, Pendente, RetratoPremio } from '../store/conta'
import { useContaStore } from '../store/conta'
import { sessaoDoServidorCaiu } from './conta-modo'

const BASE = './api/index.php?r='

export type RespostaApi<T> =
  | { ok: true; status: number; dados: T }
  | { ok: false; status: number; erro: string; mensagem: string | null; extra: Record<string, unknown> }

/** Pedido pra API com tempo-limite (o padrão é 15 s: hospedagem compartilhada no 3G). */
export async function pedirApi<T = Record<string, unknown>>(
  rota: string,
  op: { metodo?: 'GET' | 'POST'; corpo?: unknown; params?: Record<string, string>; ms?: number } = {},
): Promise<RespostaApi<T>> {
  const metodo = op.metodo ?? 'GET'
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), op.ms ?? 15_000)
  const busca = op.params ? `&${new URLSearchParams(op.params)}` : ''
  try {
    const r = await fetch(`${BASE}${rota}${busca}`, {
      method: metodo,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctrl.signal,
      headers: metodo === 'POST' ? { Accept: 'application/json', 'Content-Type': 'application/json' } : { Accept: 'application/json' },
      body: metodo === 'POST' ? JSON.stringify(op.corpo ?? {}) : undefined,
    })
    let j: Record<string, unknown> | null = null
    try {
      j = (await r.json()) as Record<string, unknown>
    } catch {
      j = null
    }
    if (r.ok && j?.ok === true) return { ok: true, status: r.status, dados: j as T }
    const erro = typeof j?.erro === 'string' ? j.erro : j ? 'erro' : 'resposta'
    if (erro === 'sem-sessao') sessaoDoServidorCaiu()
    return { ok: false, status: r.status, erro, mensagem: typeof j?.mensagem === 'string' ? j.mensagem : null, extra: j ?? {} }
  } catch {
    return { ok: false, status: 0, erro: 'rede', mensagem: null, extra: {} }
  } finally {
    clearTimeout(t)
  }
}

/* ───────────────────────── do formato da API pro cache ───────────────────────── */

const ms = (v: unknown): number | null => {
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}
const txt = (v: unknown): string => (typeof v === 'string' ? v : '')

export function contaDaApi(x: unknown): Conta | null {
  const c = x as Record<string, unknown> | null
  if (!c || typeof c.nome !== 'string' || typeof c.whatsapp !== 'string' || !/^55\d{11}$/.test(c.whatsapp)) return null
  return {
    id: txt(c.id) || c.whatsapp,
    nome: c.nome,
    whatsapp: c.whatsapp,
    aceitaPromo: c.aceitaPromo === true,
    aceitaPromoEm: ms(c.aceitaPromoEm),
    confirmou18Em: ms(c.confirmou18Em) ?? Date.now(),
    criadaEm: ms(c.criadaEm) ?? Date.now(),
  }
}

export function cupomDaApi(x: unknown): Cupom | null {
  const k = x as Record<string, unknown> | null
  if (!k || typeof k.codigo !== 'string' || typeof k.premioId !== 'string' || !k.retrato || typeof k.retrato !== 'object') return null
  const ganho = ms(k.ganhoEm)
  const ate = ms(k.validoAte)
  if (ganho == null || ate == null) return null
  const usado = ms(k.usadoEm)
  return {
    codigo: k.codigo,
    interativo: txt(k.interativo) || 'sorte',
    premioId: k.premioId,
    retrato: k.retrato as RetratoPremio,
    demo: k.demo === true,
    ganhoEm: ganho,
    // o servidor guarda até o segundo (23:59:59): fecha o dia como o site (23:59:59,999)
    validoAte: ate + 999,
    ...(usado != null ? { usadoEm: usado } : {}),
    origem: k.origem === 'aparelho' ? 'aparelho' : 'giro',
  }
}

export function enderecoDaApi(x: unknown): EnderecoConta | null {
  const e = x as Record<string, unknown> | null
  if (!e || typeof e.id !== 'number' || typeof e.uf !== 'string') return null
  return {
    id: e.id,
    apelido: txt(e.apelido),
    cep: txt(e.cep),
    rua: txt(e.rua),
    numero: txt(e.numero),
    bairro: txt(e.bairro),
    cidade: txt(e.cidade),
    uf: e.uf,
    livre: txt(e.livre),
    usadoEm: ms(e.usadoEm) ?? 0,
  }
}

export function pendenteDaApi(x: unknown): Pendente | null {
  const p = x as Record<string, unknown> | null
  if (!p || typeof p.premioId !== 'string') return null
  const em = ms(p.sorteadoEm)
  const ate = ms(p.expiraEm)
  if (em == null || ate == null) return null
  return { interativo: txt(p.interativo) || 'sorte', premioId: p.premioId, sorteadoEm: em, expiraEm: ate, servidor: true }
}

export function listaDe<T>(x: unknown, f: (v: unknown) => T | null): T[] {
  return Array.isArray(x) ? x.map(f).filter((v): v is T => v != null) : []
}

/** Os dias de giro que o servidor mandou ({ sorte: ['2026-10-09'] }). */
export function diasDaApi(x: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (Array.isArray(v)) out[k] = v.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(-30)
    }
  }
  return out
}

/** Grava no cache a conta que o servidor devolveu (o "eu"): conta, cupons, endereços e dias de giro. */
export function gravarEu(eu: Record<string, unknown>, extra: Partial<EstadoConta> = {}): Conta | null {
  const conta = contaDaApi(eu.conta)
  if (!conta) return null
  const cupons = listaDe(eu.cupons, cupomDaApi)
  const enderecos = listaDe(eu.enderecos, enderecoDaApi)
  const dias = diasDaApi(eu.dias)
  useContaStore.setState((s) => {
    const contas = { ...s.contas }
    // a conta do servidor de antes (outro número) sai do cache
    if (s.servidor && s.servidor !== conta.whatsapp) delete contas[s.servidor]
    contas[conta.whatsapp] = { conta, cupons }
    return { contas, atual: conta.whatsapp, servidor: conta.whatsapp, enderecos, giros: { ...s.giros, ...dias }, ...extra }
  })
  return conta
}

/* ───────────────────────── Minha conta: pedidos, vagas, endereços, dados ───────────────────────── */

export type StatusPedidoConta = 'novo' | 'confirmado' | 'saiu' | 'entregue' | 'cancelado'

export interface PedidoDaConta {
  codigo: string
  tipo: 'pedido' | 'encomenda'
  status: StatusPedidoConta
  uf: string
  cidade: string
  resumo: string
  unidades: number
  subtotalTexto: string
  criadoEm: number
  atualizadoEm: number
}

export interface VagaDaConta {
  codigo: string
  rateio: string
  titulo: string
  quantidade: number
  total: number
  status: 'reservado' | 'confirmado' | 'expirado' | 'cancelado' | 'entregue'
  expiraEm: number | null
  criadoEm: number
  rateioStatus: string
}

const STATUS_PEDIDO: StatusPedidoConta[] = ['novo', 'confirmado', 'saiu', 'entregue', 'cancelado']

function pedidoDaApi(x: unknown): PedidoDaConta | null {
  const p = x as Record<string, unknown> | null
  if (!p || typeof p.codigo !== 'string' || !STATUS_PEDIDO.includes(p.status as StatusPedidoConta)) return null
  return {
    codigo: p.codigo,
    tipo: p.tipo === 'encomenda' ? 'encomenda' : 'pedido',
    status: p.status as StatusPedidoConta,
    uf: txt(p.uf),
    cidade: txt(p.cidade),
    resumo: txt(p.resumo),
    unidades: typeof p.unidades === 'number' ? p.unidades : 0,
    subtotalTexto: txt(p.subtotalTexto),
    criadoEm: ms(p.criadoEm) ?? 0,
    atualizadoEm: ms(p.atualizadoEm) ?? 0,
  }
}

function vagaDaApi(x: unknown): VagaDaConta | null {
  const v = x as Record<string, unknown> | null
  if (!v || typeof v.codigo !== 'string' || typeof v.titulo !== 'string') return null
  return {
    codigo: v.codigo,
    rateio: txt(v.rateio),
    titulo: v.titulo,
    quantidade: typeof v.quantidade === 'number' ? v.quantidade : 1,
    total: typeof v.total === 'number' ? v.total : 0,
    status: (['reservado', 'confirmado', 'expirado', 'cancelado', 'entregue'].includes(v.status as string) ? v.status : 'reservado') as VagaDaConta['status'],
    expiraEm: ms(v.expiraEm),
    criadoEm: ms(v.criadoEm) ?? 0,
    rateioStatus: txt(v.rateioStatus),
  }
}

export type Lista<T> = { ok: true; itens: T[] } | { ok: false; erro: string }

export async function meusPedidos(): Promise<Lista<PedidoDaConta>> {
  const r = await pedirApi<{ pedidos: unknown }>('cliente-pedidos')
  return r.ok ? { ok: true, itens: listaDe(r.dados.pedidos, pedidoDaApi) } : { ok: false, erro: r.erro }
}

export async function minhasVagasDaConta(): Promise<Lista<VagaDaConta>> {
  const r = await pedirApi<{ vagas: unknown }>('cliente-vagas')
  return r.ok ? { ok: true, itens: listaDe(r.dados.vagas, vagaDaApi) } : { ok: false, erro: r.erro }
}

/** Relê a conta inteira do servidor (abrir a Minha conta: cupons que a loja deu baixa, endereço do último pedido). */
export async function atualizarDoServidor(aparelho: string | null): Promise<boolean> {
  const r = await pedirApi<Record<string, unknown>>('cliente-eu', aparelho ? { params: { aparelho } } : {})
  return r.ok && !!gravarEu(r.dados)
}

export type CorpoEndereco = { id?: number; apelido: string; cep: string; rua: string; numero: string; bairro: string; cidade: string; uf: string; livre: string }

export async function salvarEndereco(e: CorpoEndereco): Promise<{ ok: true } | { ok: false; erro: string; campo?: string; mensagem: string | null }> {
  const r = await pedirApi<{ enderecos: unknown }>('cliente-endereco-salvar', { metodo: 'POST', corpo: e })
  if (!r.ok) return { ok: false, erro: r.erro, campo: typeof r.extra.campo === 'string' ? r.extra.campo : undefined, mensagem: r.mensagem }
  useContaStore.setState({ enderecos: listaDe(r.dados.enderecos, enderecoDaApi) })
  return { ok: true }
}

export async function apagarEndereco(id: number): Promise<boolean> {
  const r = await pedirApi<{ enderecos: unknown }>('cliente-endereco-apagar', { metodo: 'POST', corpo: { id } })
  if (r.ok) useContaStore.setState({ enderecos: listaDe(r.dados.enderecos, enderecoDaApi) })
  return r.ok
}

/** Baixa o arquivo com todos os dados da conta (LGPD). */
export async function baixarMeusDados(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}cliente-exportar`, { credentials: 'same-origin', cache: 'no-store' })
    const nome = /filename="([^"\\/]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1]
    if (!r.ok || !nome) {
      if (r.status === 401) sessaoDoServidorCaiu()
      return false
    }
    const url = URL.createObjectURL(await r.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = nome
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return true
  } catch {
    return false
  }
}
