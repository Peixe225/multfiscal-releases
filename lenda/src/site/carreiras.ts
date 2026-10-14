/**
 * Carreiras salvas na conta (GET/POST /lenda/api/carreiras.php — servidor/CONTRATO.md).
 *
 *   await useCarreiras.getState().carregar()              // lista da conta (mais recentes primeiro)
 *   await useCarreiras.getState().salvar(entry, 'manual') // grava/atualiza pelo id do HallEntry
 *   await abrirCarreiraDaConta(id)                        // mostra o mesmo #/resumo do jogo com ela
 *
 * Regras: carreira terminada com pico de OVR >= 90 vai para a conta sozinha (como "auto"); ao entrar ou
 * criar a conta, as do Hall do aparelho com pico >= 90 que ainda não estão lá sobem sozinhas. As outras
 * só pelo botão ("manual"). Uma carreira apagada da conta neste aparelho nunca sobe sozinha de novo.
 */
import { create } from 'zustand'
import { navigate, useApp } from '@/store/app'
import { useCareer, withRunNumbers, type HallEntry } from '@/store/career'
import { kv, KV_KEYS } from '@/store/persist'
import { api, ErroApi } from './api'
import { armazem, type Armazem } from './medicao'
import { useConta } from './conta'

export interface CarreiraConta {
  id: string
  modo: 'classico' | 'imersivo'
  jogador: string
  numero: number
  pais: string
  posicao: string
  nota: number | null
  picoOvr: number
  temporadas: number
  gols: number
  titulos: number
  bolasOuro: number
  headline: string
  /** null = ainda só no aparelho. */
  como: 'auto' | 'manual' | null
  salvaEm: string | null
  terminouEm: string | null
}

/** Pico de OVR a partir do qual a carreira vai para a conta sozinha ("acima de 89"). */
export const PICO_AUTO = 90
export const LIMITE_PADRAO = 200
/** O servidor aceita até 600 KB (em bytes) por pedido; acima disto tenta sem o diário da carreira. */
export const CARREIRA_MAX_BYTES = 590_000
/** Tamanho em bytes UTF-8 (acento conta 2): é o que o servidor mede. */
const bytes = (s: string) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length * 3)

export const CHAVE_APAGADAS = 'lenda:carreiras-apagadas'
export const CHAVE_PENDENTES = 'lenda:carreiras-pendentes'
/** Id e momento da última carreira encerrada neste aparelho (sabe que ela existiu mesmo se o Hall a cortou). */
export const CHAVE_ULTIMA = 'lenda:ultima-carreira'

// ───────────────────────────── regras puras ─────────────────────────────

export const picoDe = (h: Pick<HallEntry, 'summary'>): number => (typeof h.summary?.peakOvr === 'number' ? h.summary.peakOvr : 0)

/** Pico 90+ vai para a conta sozinha. */
export const salvaSozinha = (h: Pick<HallEntry, 'summary'>) => picoDe(h) >= PICO_AUTO

/** Na hora em que a carreira termina: salvar sozinha? */
export function deveSalvarSozinha(h: Pick<HallEntry, 'id' | 'summary'>, p: { logado: boolean; naConta: ReadonlySet<string>; apagadas: ReadonlySet<string> }): boolean {
  return p.logado && salvaSozinha(h) && !p.naConta.has(h.id) && !p.apagadas.has(h.id)
}

/** Ao entrar/criar a conta: as do aparelho com pico 90+ que a conta ainda não tem (as mais recentes primeiro). */
export function paraSubirAoEntrar(hall: readonly HallEntry[], naConta: ReadonlySet<string>, apagadas: ReadonlySet<string> = new Set()): HallEntry[] {
  return porRecentes(hall.filter((h) => salvaSozinha(h) && !naConta.has(h.id) && !apagadas.has(h.id)))
}

/** Aba "Neste aparelho": o Hall local que não está na conta, as mais recentes primeiro. */
export function nesteAparelho(hall: readonly HallEntry[], naConta: ReadonlySet<string>): HallEntry[] {
  return porRecentes(hall.filter((h) => !naConta.has(h.id)))
}

/** "Salvar a última carreira": a que terminou por último neste aparelho. */
export function ultimaCarreira(hall: readonly HallEntry[]): HallEntry | null {
  return porRecentes(hall)[0] ?? null
}

/**
 * "Salvar a última carreira" com a marca da última encerrada (CHAVE_ULTIMA): se ela é mais nova que a mais
 * recente do Hall e não está nele (o Hall cortou, ou o jogador a tirou), `perdida` — nada de salvar outra no
 * lugar dela avisando que salvou.
 */
export function escolherUltima(hall: readonly HallEntry[], marca: { id: string; em: number } | null): { h: HallEntry | null; perdida: boolean } {
  const h = ultimaCarreira(hall)
  if (!marca || hall.some((x) => x.id === marca.id)) return { h, perdida: false }
  const quando = h ? Date.parse(h.finishedAt) : NaN
  return Number.isFinite(quando) && quando >= marca.em ? { h, perdida: false } : { h: null, perdida: true }
}

interface FotoClassico {
  status: 'idle' | 'restoring' | 'ready'
  isFixture: boolean
  state: { id: string; retired?: boolean; phase?: string } | null
  reveal: unknown
}
interface FotoImersivo {
  status: 'idle' | 'restoring' | 'ready'
  isFixture: boolean
  state: { id: string; retired?: boolean } | null
}

const encerrada = (st: { retired?: boolean; phase?: string }) => !!st.retired || st.phase === 'finished'

/**
 * A carreira do Clássico terminou agora, NESTA janela? Devolve o id (ou null). Vale a transição do próprio
 * estado (a mesma carreira passa de "em jogo" para encerrada numa jogada, com revelação), e não a entrada no
 * Hall: o Hall tem teto e corta as de nota baixa, e o "Jogar novamente" pode vir antes de ela entrar nele.
 * Não conta: o jogo reaberto (a carreira já vem encerrada no init), o estado relido de outra janela (sem
 * revelação) nem fixture. `s`/`p`: o store depois/antes.
 */
export function fimClassico(s: FotoClassico, p: FotoClassico): string | null {
  if (s.status !== 'ready' || p.status !== 'ready' || s.isFixture || p.isFixture || !s.reveal) return null
  if (!s.state || !p.state || s.state.id !== p.state.id || encerrada(p.state) || !encerrada(s.state)) return null
  return s.state.id
}

/** Imersivo: a mesma carreira passou a aposentada agora, nesta janela? Devolve o id (ou null). */
export function fimImersivo(s: FotoImersivo, p: FotoImersivo): string | null {
  if (s.status !== 'ready' || p.status !== 'ready' || s.isFixture || p.isFixture) return null
  if (!s.state || !p.state || s.state.id !== p.state.id || p.state.retired || !s.state.retired) return null
  return s.state.id
}

function porRecentes(l: readonly HallEntry[]): HallEntry[] {
  return [...l].sort((a, b) => String(b.finishedAt ?? '').localeCompare(String(a.finishedAt ?? '')))
}

/** Os mesmos campos que a lista da conta mostra, montados do HallEntry do aparelho. */
export function resumoLocal(h: HallEntry): CarreiraConta {
  const s = h.summary
  return {
    id: h.id,
    modo: h.mode === 'immersive' ? 'imersivo' : 'classico',
    jogador: h.identity?.surname ?? s?.identity?.surname ?? '—',
    numero: h.identity?.number ?? 0,
    pais: h.identity?.nationality ?? '',
    posicao: h.career?.seasons?.at(-1)?.position ?? h.identity?.position ?? '',
    nota: typeof h.legacy?.score === 'number' ? h.legacy.score : typeof s?.legacyScore === 'number' ? Math.round(s.legacyScore) : null,
    picoOvr: picoDe(h),
    temporadas: s?.seasons ?? 0,
    gols: s?.totals?.goals ?? 0,
    titulos: (s?.trophies ?? []).reduce((a, t) => a + (t.count || 0), 0),
    bolasOuro: (s?.awards ?? []).find((a) => a.award === 'ballon_dor')?.count ?? 0,
    headline: s?.headline ?? '',
    como: null,
    salvaEm: null,
    terminouEm: h.finishedAt ?? null,
  }
}

export function normalizarCarreira(x: unknown): CarreiraConta | null {
  const c = x as Partial<CarreiraConta> | null
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id) return null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    id: c.id,
    modo: c.modo === 'imersivo' ? 'imersivo' : 'classico',
    jogador: typeof c.jogador === 'string' ? c.jogador : '—',
    numero: num(c.numero),
    pais: typeof c.pais === 'string' ? c.pais : '',
    posicao: typeof c.posicao === 'string' ? c.posicao : '',
    nota: typeof c.nota === 'number' ? c.nota : null,
    picoOvr: num(c.picoOvr),
    temporadas: num(c.temporadas),
    gols: num(c.gols),
    titulos: num(c.titulos),
    bolasOuro: num(c.bolasOuro),
    headline: typeof c.headline === 'string' ? c.headline : '',
    como: c.como === 'manual' ? 'manual' : 'auto',
    salvaEm: typeof c.salvaEm === 'string' ? c.salvaEm : null,
    terminouEm: typeof c.terminouEm === 'string' ? c.terminouEm : null,
  }
}

/** HallEntry que veio do servidor tem o mínimo para o resumo abrir? */
export function hallEntryValido(x: unknown): x is HallEntry {
  const h = x as HallEntry | null
  return !!h && typeof h === 'object' && typeof h.id === 'string' && !!h.identity && !!h.summary && typeof h.summary.peakOvr === 'number' && !!h.career && Array.isArray(h.career.seasons)
}

/** O que vai para o servidor: o HallEntry inteiro; grande demais, sem o diário (o resumo não usa). */
export function corpoParaSalvar(h: HallEntry, como: 'auto' | 'manual'): string {
  const inteiro = JSON.stringify({ acao: 'salvar', carreira: h, como })
  if (bytes(inteiro) <= CARREIRA_MAX_BYTES) return inteiro
  const leve = { ...h, career: { ...h.career, log: [] } } as HallEntry
  const menor = JSON.stringify({ acao: 'salvar', carreira: leve, como })
  if (bytes(menor) <= CARREIRA_MAX_BYTES) return menor
  throw new ErroApi('grande', 413)
}

/** Conjunto de ids guardado no aparelho (apagadas / pendentes). */
export function lerIds(a: Armazem, chave: string): Set<string> {
  try {
    const l = JSON.parse(a.get(chave) || '[]') as unknown
    return new Set(Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}
function gravarIds(a: Armazem, chave: string, ids: Set<string>) {
  a.set(chave, JSON.stringify([...ids].slice(-300)))
}

// ───────────────────────────── store ─────────────────────────────

const ls = armazem(() => (typeof window !== 'undefined' ? window.localStorage : undefined))

interface CarreirasStore {
  /** null = ainda não carregou (ou sem conta). */
  lista: CarreiraConta[] | null
  limite: number
  carregando: boolean
  erro: string | null
  /** ids sendo salvos agora (botões com "carregando"). */
  salvando: Record<string, true>
  carregar(forcar?: boolean): Promise<CarreiraConta[] | null>
  salvar(h: HallEntry, como: 'auto' | 'manual'): Promise<CarreiraConta>
  apagar(id: string): Promise<void>
  abrir(id: string): Promise<HallEntry>
  limpar(): void
}

/** 401 de qualquer rota: a sessão caiu — a conta sai deste aparelho. */
function tratar401(err: unknown) {
  if (err instanceof ErroApi && err.status === 401) {
    useConta.getState().sessaoExpirou()
    useCarreiras.getState().limpar()
  }
}

export const useCarreiras = create<CarreirasStore>()((set, get) => ({
  lista: null,
  limite: LIMITE_PADRAO,
  carregando: false,
  erro: null,
  salvando: {},

  async carregar(forcar = false) {
    if (!useConta.getState().usuario) return null
    if (get().lista && !forcar) return get().lista
    set({ carregando: true, erro: null })
    try {
      const r = await api<{ carreiras?: unknown[]; limite?: number }>('carreiras.php')
      const lista = (r.carreiras ?? []).map(normalizarCarreira).filter((c): c is CarreiraConta => !!c)
      set({ lista, limite: typeof r.limite === 'number' ? r.limite : LIMITE_PADRAO, carregando: false })
      return lista
    } catch (err) {
      tratar401(err)
      set({ carregando: false, erro: err instanceof ErroApi ? err.message : 'Não foi possível carregar suas carreiras.' })
      throw err
    }
  },

  async salvar(h, como) {
    if (get().salvando[h.id]) throw new ErroApi('ocupado', 0, 'Essa carreira já está sendo salva.')
    set({ salvando: { ...get().salvando, [h.id]: true } })
    try {
      const corpo = corpoParaSalvar(h, como)
      const r = await api<{ carreira?: unknown }>('carreiras.php', { corpoJson: corpo, tempo: 30_000 })
      const c = normalizarCarreira(r.carreira) ?? { ...resumoLocal(h), como, salvaEm: new Date().toISOString() }
      const atual = get().lista
      if (atual) set({ lista: [c, ...atual.filter((x) => x.id !== c.id)] })
      // salvou: sai das pendentes e das apagadas (o jogador quis de volta)
      const pend = lerIds(ls, CHAVE_PENDENTES)
      if (pend.delete(h.id)) gravarIds(ls, CHAVE_PENDENTES, pend)
      const apag = lerIds(ls, CHAVE_APAGADAS)
      if (apag.delete(h.id)) gravarIds(ls, CHAVE_APAGADAS, apag)
      const u = useConta.getState().usuario
      if (u && !atual?.some((x) => x.id === c.id)) useConta.setState({ usuario: { ...u, estatisticas: { ...u.estatisticas, carreirasSalvas: u.estatisticas.carreirasSalvas + 1 } } })
      return c
    } catch (err) {
      tratar401(err)
      throw err
    } finally {
      const { [h.id]: _, ...resto } = get().salvando
      set({ salvando: resto })
    }
  },

  async apagar(id) {
    try {
      await api('carreiras.php', { corpo: { acao: 'apagar', id } })
    } catch (err) {
      tratar401(err)
      throw err
    }
    const apag = lerIds(ls, CHAVE_APAGADAS)
    apag.add(id)
    gravarIds(ls, CHAVE_APAGADAS, apag)
    const atual = get().lista
    if (atual) set({ lista: atual.filter((c) => c.id !== id) })
    const u = useConta.getState().usuario
    if (u) useConta.setState({ usuario: { ...u, estatisticas: { ...u.estatisticas, carreirasSalvas: Math.max(0, u.estatisticas.carreirasSalvas - 1) } } })
  },

  async abrir(id) {
    try {
      const r = await api<{ carreira?: unknown }>('carreiras.php', { query: { id } })
      if (!hallEntryValido(r.carreira)) throw new ErroApi('servidor', 200, 'Essa carreira veio incompleta do servidor.')
      return r.carreira
    } catch (err) {
      tratar401(err)
      throw err
    }
  },

  limpar() {
    set({ lista: null, erro: null, salvando: {} })
  },
}))

export const idsNaConta = (lista: readonly CarreiraConta[] | null): Set<string> => new Set((lista ?? []).map((c) => c.id))
export const apagadasNoAparelho = () => lerIds(ls, CHAVE_APAGADAS)

/** O HallEntry de uma carreira deste aparelho: no Hall ou, cortada pelo teto dele, a última encerrada nesta janela. */
export function acharCarreira(id: string): HallEntry | null {
  const c = useCareer.getState()
  return c.finishedCareers.find((h) => h.id === id) ?? (c.lastFinished?.id === id ? c.lastFinished : null)
}

/** O Hall do aparelho (sem as transitórias), mais a última encerrada nesta janela se o corte a deixou de fora. */
export function hallComUltima(): HallEntry[] {
  const c = useCareer.getState()
  const hall = c.finishedCareers.filter((h) => !ehTransitoria(h.id))
  const u = c.lastFinished
  return u && !hall.some((h) => h.id === u.id) ? [...hall, u] : hall
}

export function marcarUltima(id: string, em = Date.now()) {
  ls.set(CHAVE_ULTIMA, JSON.stringify({ id, em }))
}
export function lerUltima(a: Armazem = ls): { id: string; em: number } | null {
  try {
    const j = JSON.parse(a.get(CHAVE_ULTIMA) || 'null') as { id?: unknown; em?: unknown } | null
    return j && typeof j.id === 'string' && typeof j.em === 'number' && Number.isFinite(j.em) ? { id: j.id, em: j.em } : null
  } catch {
    return null
  }
}

export function marcarPendente(id: string) {
  const p = lerIds(ls, CHAVE_PENDENTES)
  p.add(id)
  gravarIds(ls, CHAVE_PENDENTES, p)
}
export const pendentesNoAparelho = () => lerIds(ls, CHAVE_PENDENTES)

// ───────────────────────────── abrir no resumo ─────────────────────────────

/**
 * Carreiras abertas da conta que não estão no Hall deste aparelho: entram só na memória (para o #/resumo
 * achar pelo id) e saem quando o jogador deixa o resumo — a não ser que ele as guarde no aparelho.
 */
const transitorias = new Set<string>()
export const ehTransitoria = (id: string) => transitorias.has(id)
/**
 * Marca no próprio HallEntry de uma carreira transitória, que o resumo (SummaryScreen) lê pelo mesmo
 * Symbol.for sem importar o site: lá ela não aparece como "Salvo no Hall das Lendas". Não enumerável e
 * de símbolo, não vai para o IndexedDB nem para o JSON.
 */
export const MARCA_SO_NA_CONTA = Symbol.for('lenda:so-na-conta')

/** `navegar: false` (link #/resumo?id= aberto direto): só mostra se o jogador ainda estiver nesse resumo. */
export async function abrirCarreiraDaConta(id: string, o: { navegar?: boolean } = {}): Promise<void> {
  if (!useCareer.getState().finishedCareers.some((h) => h.id === id)) {
    const h = await useCarreiras.getState().abrir(id)
    const r = useApp.getState().route
    if (o.navegar === false && !(r.path === '/resumo' && r.query.id === id)) return
    const atual = useCareer.getState().finishedCareers
    if (!atual.some((x) => x.id === h.id)) {
      transitorias.add(h.id)
      Object.defineProperty(h, MARCA_SO_NA_CONTA, { value: true })
      useCareer.setState({ finishedCareers: [...atual, h] })
    }
  }
  if (o.navegar !== false) navigate('/resumo', { query: { id } })
}

/** "Guardar no Hall deste aparelho": grava junto com o Hall salvo (ler-mesclar-gravar, como o jogo faz). */
export async function guardarNoAparelho(id: string): Promise<boolean> {
  const mem = useCareer.getState().finishedCareers
  const h = mem.find((x) => x.id === id)
  if (!h) return false
  let salvo: HallEntry[] = []
  try {
    const l = await kv.get<HallEntry[]>(KV_KEYS.hall)
    salvo = Array.isArray(l) ? l : []
  } catch {
    salvo = []
  }
  const outras = new Map<string, HallEntry>()
  for (const x of mem) if (!transitorias.has(x.id) || x.id === id) outras.set(x.id, x)
  for (const x of salvo) outras.set(x.id, x)
  // número da run já usado por outra deste aparelho: ganha o próximo livre
  const usados = new Set([...outras.values()].filter((x) => x.id !== id).map((x) => x.runNo))
  // cópia: sai a marca de "só na conta" (o spread não copia propriedade não enumerável)
  const entrada = usados.has(h.runNo) ? { ...h, runNo: Math.max(0, ...[...usados].map((n) => n ?? 0)) + 1 } : { ...h }
  outras.set(id, entrada)
  const lista = withRunNumbers([...outras.values()])
  const ok = await kv.set(KV_KEYS.hall, lista)
  if (!ok) return false
  transitorias.delete(id)
  const resto = mem.filter((x) => transitorias.has(x.id) && x.id !== id)
  useCareer.setState({ finishedCareers: [...lista, ...resto] })
  return true
}

/** Saiu do resumo de uma carreira transitória: ela sai da memória (o Hall volta a ser só o do aparelho). */
export function vigiarTransitorias(): () => void {
  return useApp.subscribe((s) => {
    if (!transitorias.size) return
    const aberta = s.route.path === '/resumo' ? s.route.query.id : undefined
    const sair = [...transitorias].filter((id) => id !== aberta)
    if (!sair.length) return
    for (const id of sair) transitorias.delete(id)
    const fora = new Set(sair)
    useCareer.setState({ finishedCareers: useCareer.getState().finishedCareers.filter((h) => !fora.has(h.id)) })
  })
}
