/**
 * Hall público — as carreiras da comunidade no Hall das Lendas (GET/POST /lenda/api/hall.php —
 * servidor/CONTRATO-v3.md §4). Preenche o useComunidade (src/store/comunidade.ts), que o Hall e o Resumo leem.
 *
 *   iniciarHallPublico()                         // uma vez (vigias): registra pedir/mais/abrir no store
 *   await denunciar(id, 'nome', 'texto opcional') // logado; 1 por carreira por conta
 *
 * Muita gente ao mesmo tempo: o servidor refaz a foto do Hall a cada 1–3 h e manda `max-age=300`; aqui cada
 * filtro fica em memória (sem pedir de novo por 5 min, nem antes da próxima atualização do servidor), um
 * pedido por filtro de cada vez, páginas de 50 sob demanda e reintento com espera crescente só em falha de
 * rede. Sem rede, o Hall segue com as lendas e as carreiras deste aparelho.
 */
import { chaveFiltro, proximaVencida, useComunidade, type CarreiraAberta, type CarreiraComunidade, type FiltroHall, type PaginasComunidade } from '@/store/comunidade'
import { api, comReintento, ErroApi } from './api'
import { hallEntryValido } from './carreiras'
import { normalizarEmblemas } from './emblemas'

export const POR_PAGINA = 50
/** Uma página guardada vale isto (o servidor também manda max-age=300). */
export const VALIDADE_MS = 5 * 60_000
/** Carreiras abertas (resumo completo) guardadas na memória. */
const ABERTAS_MAX = 12

const str = (v: unknown, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '')
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0)

export function normalizarCarreiraPublica(x: unknown): CarreiraComunidade | null {
  const c = x as Record<string, unknown> | null
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id || c.id.length > 64) return null
  return {
    id: c.id,
    posicao: Math.max(0, int(c.posicao)),
    apelido: str(c.apelido, 20) || 'Jogador',
    jogador: str(c.jogador, 15) || '—',
    numero: Math.max(0, Math.min(99, int(c.numero))),
    pais: /^[A-Z]{3}$/.test(str(c.pais, 3)) ? str(c.pais, 3) : '',
    posicaoCampo: str(c.posicaoCampo, 4),
    nota: Math.max(0, Math.min(100, int(c.nota))),
    picoOvr: Math.max(0, Math.min(99, int(c.picoOvr))),
    temporadas: Math.max(0, int(c.temporadas)),
    gols: Math.max(0, int(c.gols)),
    titulos: Math.max(0, int(c.titulos)),
    bolasOuro: Math.max(0, int(c.bolasOuro)),
    copas: Math.max(0, int(c.copas)),
    headline: str(c.headline, 120),
    clubes: Array.isArray(c.clubes) ? c.clubes.filter((k): k is string => typeof k === 'string' && k.length <= 32).slice(0, 40) : [],
    bonusOvr: Math.max(0, Math.min(10, int(c.bonusOvr))),
    terminouEm: typeof c.terminouEm === 'string' ? c.terminouEm : null,
    destaque: c.destaque === true,
    perfil: typeof c.perfil === 'string' && /^[A-Za-z0-9]{4,16}$/.test(c.perfil) ? c.perfil : null,
    // v3.4: os emblemas do dono (pequenos, ao lado do apelido)
    ...emblemasDaLinha(c),
  }
}

/** v3.4: `emblemas: [{slug, icone, cor}]` (até 3) e `emblemasTotal` de um item do hall.php (servidor antigo: nada). */
function emblemasDaLinha(c: Record<string, unknown>): Pick<CarreiraComunidade, 'emblemas' | 'emblemasTotal'> {
  if (!Array.isArray(c.emblemas)) return {}
  const emblemas = normalizarEmblemas(c.emblemas, 3).map(({ slug, icone, cor, titulo }) => ({ slug, icone, cor, titulo }))
  const total = typeof c.emblemasTotal === 'number' && Number.isFinite(c.emblemasTotal) ? Math.max(emblemas.length, Math.round(c.emblemasTotal)) : emblemas.length
  return { emblemas, emblemasTotal: total }
}

export interface PaginaHall {
  atualizadoEm: string | null
  proximaEm: string | null
  total: number
  porPagina: number
  itens: CarreiraComunidade[]
}

export function normalizarPaginaHall(x: unknown): PaginaHall {
  const r = (x ?? {}) as Record<string, unknown>
  const itens = (Array.isArray(r.itens) ? r.itens : []).map(normalizarCarreiraPublica).filter((c): c is CarreiraComunidade => !!c)
  return {
    atualizadoEm: typeof r.atualizadoEm === 'string' ? r.atualizadoEm : null,
    proximaEm: typeof r.proximaEm === 'string' ? r.proximaEm : null,
    total: Math.max(itens.length, int(r.total)),
    porPagina: int(r.porPagina) || POR_PAGINA,
    itens,
  }
}

/** Junta páginas sem repetir carreira (uma pode mudar de página entre dois pedidos, se a foto foi refeita). */
export function juntarPaginas(a: readonly CarreiraComunidade[], b: readonly CarreiraComunidade[]): CarreiraComunidade[] {
  const vistos = new Set(a.map((c) => c.id))
  return [...a, ...b.filter((c) => !vistos.has(c.id))]
}

/** A página guardada ainda vale? (5 min, e nunca depois da próxima atualização do servidor.) */
export function aindaVale(buscadoEm: number, proximaEm: string | null, agora = Date.now()): boolean {
  if (agora - buscadoEm >= VALIDADE_MS) return false
  const p = proximaEm ? Date.parse(proximaEm) : NaN
  return !(Number.isFinite(p) && agora > p + 15_000 && buscadoEm < p)
}

const query = (f: FiltroHall, pagina: number) => {
  const q: Record<string, string> = { pagina: String(pagina) }
  if (f.pais) q.pais = f.pais
  if (f.clube) q.clube = f.clube
  return q
}

const buscadoEm = new Map<string, number>()
const noAr = new Set<string>()
/** Filtros com uma busca de novo já marcada (a página veio com a próxima atualização no passado), e quantas seguidas. */
const deNovo = new Set<string>()
const vezesDeNovo = new Map<string, number>()

/**
 * A página veio de uma fotografia vencida (o servidor responde a anterior e refaz logo depois): uma busca só deste
 * filtro daqui a 20–30 s, revalidando no servidor (sem esperar os 5 min do cache do navegador).
 */
function buscarDeNovoDepois(f: FiltroHall, proximaEm: string | null) {
  const k = chaveFiltro(f)
  if (!proximaVencida(proximaEm)) {
    vezesDeNovo.delete(k) // veio a nova: conta do zero
    return
  }
  const vezes = vezesDeNovo.get(k) ?? 0
  // no máximo 3 seguidas: um servidor que não refaz não vira um pedido a cada 30 s
  if (deNovo.has(k) || vezes >= 3 || typeof window === 'undefined') return
  vezesDeNovo.set(k, vezes + 1)
  deNovo.add(k)
  window.setTimeout(() => {
    deNovo.delete(k)
    void buscar(f, true, 'no-cache')
  }, 20_000 + Math.random() * 10_000)
}

function gravar(k: string, p: Partial<PaginasComunidade>) {
  const atual = useComunidade.getState().filtros[k]
  const base: PaginasComunidade = atual ?? { status: 'carregando', itens: [], total: 0, paginas: 0, atualizadoEm: null, proximaEm: null }
  useComunidade.setState((s) => ({ filtros: { ...s.filtros, [k]: { ...base, ...p } } }))
}

const semRede = (err: unknown) => (typeof navigator !== 'undefined' && navigator.onLine === false) || (err instanceof ErroApi && (err.codigo === 'rede' || err.codigo === 'tempo'))

async function buscar(f: FiltroHall, forcar = false, cache: RequestCache = 'default') {
  const k = chaveFiltro(f)
  const atual = useComunidade.getState().filtros[k]
  if (noAr.has(`${k}#1`)) return
  if (!forcar && atual?.status === 'pronto' && aindaVale(buscadoEm.get(k) ?? 0, atual.proximaEm)) return
  noAr.add(`${k}#1`)
  // uma lista que já estava na tela continua lá enquanto a nova não chega
  gravar(k, { status: atual?.itens.length ? 'pronto' : 'carregando', semRede: false })
  try {
    const r = normalizarPaginaHall(await comReintento(() => api('hall.php', { query: query(f, 1), cache, tempo: 12_000 }), { tentativas: 3 }))
    buscadoEm.set(k, Date.now())
    gravar(k, { status: 'pronto', itens: r.itens, total: r.total, paginas: 1, atualizadoEm: r.atualizadoEm, proximaEm: r.proximaEm, carregandoMais: false, erroMais: false })
    buscarDeNovoDepois(f, r.proximaEm)
  } catch (err) {
    if (atual?.itens.length) gravar(k, { status: 'pronto' })
    else gravar(k, { status: 'erro', semRede: semRede(err) })
  } finally {
    noAr.delete(`${k}#1`)
  }
}

async function mais(f: FiltroHall) {
  const k = chaveFiltro(f)
  const atual = useComunidade.getState().filtros[k]
  if (!atual || atual.status !== 'pronto' || atual.itens.length >= atual.total) return
  const pagina = atual.paginas + 1
  const chave = `${k}#${pagina}`
  if (noAr.has(chave)) return
  noAr.add(chave)
  gravar(k, { carregandoMais: true, erroMais: false })
  try {
    const r = normalizarPaginaHall(await comReintento(() => api('hall.php', { query: query(f, pagina), cache: 'default', tempo: 12_000 }), { tentativas: 3 }))
    const agora = useComunidade.getState().filtros[k] ?? atual
    gravar(k, { itens: juntarPaginas(agora.itens, r.itens), total: r.total, paginas: pagina, carregandoMais: false, atualizadoEm: r.atualizadoEm ?? agora.atualizadoEm, proximaEm: r.proximaEm ?? agora.proximaEm })
  } catch {
    gravar(k, { carregandoMais: false, erroMais: true })
  } finally {
    noAr.delete(chave)
  }
}

async function abrir(id: string) {
  const ja = useComunidade.getState().abertas[id]
  if (ja && (ja.status === 'pronta' || ja.status === 'carregando')) return
  // cada carreira aberta pesa dezenas de KB: guarda só as últimas
  const guardar = (v: CarreiraAberta) =>
    useComunidade.setState((s) => {
      const { [id]: _, ...resto } = s.abertas
      const ids = Object.keys(resto)
      for (const velho of ids.slice(0, Math.max(0, ids.length - (ABERTAS_MAX - 1)))) delete resto[velho]
      return { abertas: { ...resto, [id]: v } }
    })
  guardar({ status: 'carregando' })
  try {
    const r = await comReintento(() => api<{ carreira?: unknown; apelido?: unknown; destaque?: unknown; perfil?: unknown }>('hall.php', { query: { id }, cache: 'default', tempo: 20_000 }), { tentativas: 2 })
    if (!hallEntryValido(r.carreira)) throw new ErroApi('servidor', 200, 'Essa carreira veio incompleta do servidor.')
    const perfil = typeof r.perfil === 'string' && /^[A-Za-z0-9]{4,16}$/.test(r.perfil) ? r.perfil : null
    guardar({ status: 'pronta', entry: r.carreira, apelido: str(r.apelido, 20) || 'Jogador', destaque: r.destaque === true, perfil })
  } catch (err) {
    guardar({ status: 'erro', naoEncontrada: err instanceof ErroApi && err.status === 404 })
  }
}

export type MotivoDenuncia = 'nome' | 'trapaca' | 'outro'

/** Denuncia uma carreira do Hall público (precisa estar logado). */
export async function denunciar(id: string, motivo: MotivoDenuncia, texto?: string): Promise<void> {
  const corpo: Record<string, unknown> = { acao: 'denunciar', id, motivo }
  const t = texto?.trim()
  if (t) corpo.texto = t.slice(0, 500)
  await api('hall.php', { corpo })
}

let iniciado = false
export function iniciarHallPublico() {
  if (iniciado) return
  iniciado = true
  useComunidade.setState({
    ativo: true,
    pedir: (f) => void buscar(f),
    mais: (f) => void mais(f),
    tentarDeNovo: (f) => void buscar(f, true),
    abrir: (id) => void abrir(id),
  })
  if (typeof window === 'undefined') return
  // a internet voltou: os filtros que falharam tentam de novo (um de cada vez, já com o cache valendo)
  window.addEventListener('online', () => {
    const { filtros, abertas } = useComunidade.getState()
    for (const [k, p] of Object.entries(filtros)) {
      if (p.status !== 'erro') continue
      const [pais, clube] = k.split('|')
      void buscar({ pais: pais || undefined, clube: clube || undefined }, true)
    }
    for (const [id, a] of Object.entries(abertas)) if (a.status === 'erro' && !a.naoEncontrada) void abrir(id)
  })
}
