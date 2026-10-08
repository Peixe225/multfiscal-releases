// Rateio: o contrato público do servidor da loja (greencheese/API.md é a fonte da verdade) e quem fala com ele.
// Aqui fica só o que o pedaço principal usa (a lista, pro selo da barra e o destaque do Início); entrar, minhas vagas e
// o rateio avulso baixam com as telas (src/lib/rateio-vagas.ts).
// Nada trava a tela: leitura com 8 s de limite, entrada (POST) com 20 s (hospedagem compartilhada no 3G). Duas falhas
// diferentes:
// - 'sem-servidor': aqui não tem API (o arquivo único, o zip sem a pasta api/, 404 ou HTML no lugar de JSON, o repasse
//   do Vite com o PHP desligado). A tela segue com os rateios de exemplo e o formulário vira "Entrar pelo WhatsApp".
// - 'fora-do-ar': a API devia responder e não respondeu (tempo esgotado, rede caída, 5xx). Nada de exemplo inventado; e
//   num POST não dá pra saber se a vaga foi gravada (ver EntrarRateio: tenta de novo com o mesmo token).
// O que vem da rede é conferido campo a campo antes de chegar na tela.

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
  | 'fora-do-ar'

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
  /** fora-do-estado: onde o rateio vale agora (o servidor manda; a lista do aparelho pode estar velha). */
  ufs?: string[]
}

export type RespostaRateio<T> = ({ ok: true } & T) | FalhaRateio

const API = './api/index.php'
/** Leitura (lista, rateio, minhas vagas): a tela espera no máximo isso. */
const LIMITE_LEITURA_MS = 8000
/** Entrar no rateio: o servidor pode gravar e demorar a responder; cortar cedo perde a resposta (e o token). */
export const LIMITE_ENTRADA_MS = 20000
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

/** Aqui não tem servidor nenhum: o arquivo único da prévia (build com __ARQUIVO_UNICO__) ou a página aberta do disco. */
function semServidorAqui(): boolean {
  try {
    return __ARQUIVO_UNICO__ || location.protocol === 'file:'
  } catch {
    return false
  }
}

/**
 * Uma chamada à API. Resposta que diz "não tem API aqui" (404 ou HTML da hospedagem, index.html do servidor de
 * desenvolvimento, o repasse do Vite com o PHP desligado) = 'sem-servidor'. Sem resposta (tempo esgotado, rede caída)
 * ou erro da hospedagem (5xx sem JSON) = 'fora-do-ar'. Erro da API = o código dela (desconhecido vira 'erro-interno').
 */
export async function chamar(rota: string, corpo?: unknown, limite = corpo === undefined ? LIMITE_LEITURA_MS : LIMITE_ENTRADA_MS): Promise<RespostaRateio<{ dados: Bruto }>> {
  if (semServidorAqui()) return falha('sem-servidor')
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const t = setTimeout(() => ctrl?.abort(), limite)
  let r: Response
  try {
    r = await fetch(`${API}?r=${rota}`, {
      method: corpo === undefined ? 'GET' : 'POST',
      headers: corpo === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: ctrl?.signal,
      cache: 'no-store',
      credentials: 'same-origin',
    })
  } catch {
    clearTimeout(t)
    return falha('fora-do-ar')
  }
  // sem JSON da API: 404 ou página comum (2xx) = não tem API aqui; o resto (5xx, corpo cortado) = fora do ar
  const naoEApi = () => {
    if (ctrl?.signal.aborted) return falha('fora-do-ar')
    const tipo = r.headers.get('content-type') ?? ''
    return falha(!tipo.includes('json') && (r.status === 404 || r.ok) ? 'sem-servidor' : 'fora-do-ar')
  }
  try {
    let dados: unknown
    try {
      dados = await r.json()
    } catch {
      return naoEApi()
    }
    if (!dados || typeof dados !== 'object' || typeof (dados as Bruto).ok !== 'boolean') return naoEApi()
    const d = dados as Bruto
    if (d.ok === true && r.ok) return { ok: true, dados: d }
    // o repasse do Vite (npm run dev) responde assim quando o PHP está desligado
    if (d.erro === 'sem-servidor') return falha('sem-servidor')
    const erro = ERROS.find((e) => e === d.erro) ?? 'erro-interno'
    return falha(erro, {
      mensagem: texto(d.mensagem, 200),
      campo: texto(d.campo, 20) ?? undefined,
      disponiveis: inteiro(d.disponiveis) ?? undefined,
      limite: inteiro(d.limite, 1) ?? undefined,
      codigo: texto(d.codigo, 20) ?? undefined,
      ufs: Array.isArray(d.ufs) ? d.ufs.filter((u): u is string => typeof u === 'string' && /^[a-z]{2}$/i.test(u)).map((u) => u.toLowerCase()) : undefined,
    })
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

