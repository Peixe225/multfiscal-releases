// Rateio: o contrato público do servidor da loja (greencheese/API.md é a fonte da verdade) e quem fala com ele.
// Aqui fica só o que o pedaço principal usa (a lista, pro selo da barra e o destaque do Início); entrar, minhas vagas e
// o rateio avulso baixam com as telas (src/lib/rateio-vagas.ts).
// Tudo com tempo-limite de 4 s e sem nunca travar a tela. Servidor fora do ar, 404, HTML no lugar de JSON (o zip
// sem a pasta api/, o desenvolvimento sem PHP) viram 'sem-servidor': a tela segue com os rateios de exemplo e o
// formulário vira "Entrar pelo WhatsApp". O que vem da rede é conferido campo a campo antes de chegar na tela.

export type StatusRateio = 'aberto' | 'fechado' | 'pedido' | 'caminho' | 'chegou' | 'encerrado'
export type StatusVaga = 'reservado' | 'confirmado' | 'expirado' | 'cancelado' | 'entregue'

export interface Rateio {
  id: string
  titulo: string
  descricao: string
  produtoId: string | null
  /** Caminho relativo à raiz do site ('uploads/ab12cd.webp'): tem prioridade sobre a arte do produto. */
  imagem: string | null
  precoRateio: number
  precoDepois: number | null
  vagas: number
  /** Vagas pagas: o contador. */
  confirmadas: number
  /** Reservadas esperando pagamento (no prazo). */
  reservadas: number
  disponiveis: number
  limitePorPessoa: number
  ufs: string[]
  status: StatusRateio
  aceitaEntradas: boolean
  previsaoMin: number
  previsaoMax: number
  fechaEm: string | null
  fechadoEm: string | null
  pedidoEm: string | null
  chegouEm: string | null
  reservaHoras: number
  demo: boolean
  atualizadoEm: string
}

export interface Participacao {
  /** 'RAT-K8EA' */
  codigo: string
  /** Segredo do aparelho (32 hex). */
  token: string
  rateio: string
  titulo: string
  quantidade: number
  total: number
  status: StatusVaga
  expiraEm: string | null
  criadoEm: string
  confirmadoEm: string | null
  rateioStatus: StatusRateio | 'cancelado'
}

export type ErroRateio =
  | 'invalido'
  | 'nao-encontrado'
  | 'fora-do-estado'
  | 'rateio-fechado'
  | 'sem-vagas'
  | 'limite-por-pessoa'
  | 'ja-participa'
  | 'muitas-tentativas'
  | 'erro-interno'
  | 'sem-servidor'

export interface FalhaRateio {
  ok: false
  erro: ErroRateio
  mensagem: string | null
  /** invalido: qual campo. */
  campo?: string
  /** sem-vagas */
  disponiveis?: number
  /** limite-por-pessoa */
  limite?: number
  /** ja-participa */
  codigo?: string
}

export type RespostaRateio<T> = ({ ok: true } & T) | FalhaRateio

const API = './api/index.php'
const LIMITE_MS = 4000
const ERROS: readonly ErroRateio[] = ['invalido', 'nao-encontrado', 'fora-do-estado', 'rateio-fechado', 'sem-vagas', 'limite-por-pessoa', 'ja-participa', 'muitas-tentativas', 'erro-interno']
export const STATUS_RATEIO: readonly StatusRateio[] = ['aberto', 'fechado', 'pedido', 'caminho', 'chegou', 'encerrado']

/* ───────────────────────── conferência do que chega ───────────────────────── */

export type Bruto = Record<string, unknown>
export const texto = (v: unknown, max = 400): string | null => (typeof v === 'string' ? v.slice(0, max) : null)
export const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export const inteiro = (v: unknown, min = 0): number | null => {
  const n = numero(v)
  return n == null ? null : Math.max(min, Math.round(n))
}
export const data = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null)

/** Rateio que veio da rede (ou do JSON de exemplo), conferido. Qualquer campo essencial errado: fora. */
export function lerRateio(x: unknown): Rateio | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Bruto
  const id = texto(r.id, 80)
  const titulo = texto(r.titulo, 120)?.trim()
  const preco = numero(r.precoRateio)
  const vagas = inteiro(r.vagas, 1)
  const status = STATUS_RATEIO.find((s) => s === r.status)
  if (!id || !/^[a-z0-9-]+$/.test(id) || !titulo || preco == null || preco <= 0 || vagas == null || !status) return null
  const confirmadas = Math.min(vagas, inteiro(r.confirmadas) ?? 0)
  const reservadas = Math.min(vagas - confirmadas, inteiro(r.reservadas) ?? 0)
  const disponiveis = Math.max(0, Math.min(vagas - confirmadas - reservadas, inteiro(r.disponiveis) ?? vagas - confirmadas - reservadas))
  const ufs = Array.isArray(r.ufs) ? [...new Set(r.ufs.filter((u): u is string => typeof u === 'string' && /^[a-z]{2}$/i.test(u)).map((u) => u.toLowerCase()))] : []
  const pMin = inteiro(r.previsaoMin, 1) ?? 6
  const pMax = Math.max(pMin, inteiro(r.previsaoMax, 1) ?? 10)
  const depois = numero(r.precoDepois)
  const imagem = texto(r.imagem, 200)
  return {
    id,
    titulo,
    descricao: texto(r.descricao, 600)?.trim() ?? '',
    produtoId: texto(r.produtoId, 80),
    // só caminho relativo de dentro do site (nada de outro domínio ou javascript:)
    imagem: imagem && /^[a-z0-9/_.-]+$/i.test(imagem) && !imagem.includes('..') ? imagem.replace(/^\/+/, '') : null,
    precoRateio: preco,
    precoDepois: depois != null && depois > preco ? depois : null,
    vagas,
    confirmadas,
    reservadas,
    disponiveis,
    limitePorPessoa: Math.max(1, inteiro(r.limitePorPessoa, 1) ?? 1),
    ufs,
    status,
    aceitaEntradas: r.aceitaEntradas === true && status === 'aberto' && disponiveis > 0,
    previsaoMin: pMin,
    previsaoMax: pMax,
    fechaEm: data(r.fechaEm),
    fechadoEm: data(r.fechadoEm),
    pedidoEm: data(r.pedidoEm),
    chegouEm: data(r.chegouEm),
    reservaHoras: Math.max(1, inteiro(r.reservaHoras, 1) ?? 24),
    demo: r.demo === true,
    atualizadoEm: data(r.atualizadoEm) ?? new Date(0).toISOString(),
  }
}

/* ───────────────────────── rede ───────────────────────── */

export function falha(erro: ErroRateio, extra: Partial<FalhaRateio> = {}): FalhaRateio {
  return { ok: false, erro, mensagem: null, ...extra }
}

/**
 * Uma chamada à API. Resposta que não é JSON da API (sem rede, tempo esgotado, 404 da hospedagem, index.html do
 * servidor de desenvolvimento) = 'sem-servidor'. Erro da API = o código dela (desconhecido vira 'erro-interno').
 */
export async function chamar(rota: string, corpo?: unknown): Promise<RespostaRateio<{ dados: Bruto }>> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const t = setTimeout(() => ctrl?.abort(), LIMITE_MS)
  try {
    const r = await fetch(`${API}?r=${rota}`, {
      method: corpo === undefined ? 'GET' : 'POST',
      headers: corpo === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: ctrl?.signal,
      cache: 'no-store',
      credentials: 'same-origin',
    })
    let dados: unknown
    try {
      dados = await r.json()
    } catch {
      return falha('sem-servidor')
    }
    if (!dados || typeof dados !== 'object' || typeof (dados as Bruto).ok !== 'boolean') return falha('sem-servidor')
    const d = dados as Bruto
    if (d.ok === true && r.ok) return { ok: true, dados: d }
    const erro = ERROS.find((e) => e === d.erro) ?? 'erro-interno'
    return falha(erro, {
      mensagem: texto(d.mensagem, 200),
      campo: texto(d.campo, 20) ?? undefined,
      disponiveis: inteiro(d.disponiveis) ?? undefined,
      limite: inteiro(d.limite, 1) ?? undefined,
      codigo: texto(d.codigo, 20) ?? undefined,
    })
  } catch {
    return falha('sem-servidor')
  } finally {
    clearTimeout(t)
  }
}

/** GET r=rateios: a lista pública e a hora do servidor (para a contagem da reserva não depender do relógio do aparelho). */
export async function buscarRateios(): Promise<RespostaRateio<{ rateios: Rateio[]; agora: string | null }>> {
  const r = await chamar('rateios')
  if (!r.ok) return r
  if (!Array.isArray(r.dados.rateios)) return falha('sem-servidor')
  return { ok: true, rateios: r.dados.rateios.map(lerRateio).filter((x): x is Rateio => !!x), agora: data(r.dados.agora) }
}

