/**
 * Conquistas na conta (GET/POST /lenda/api/conquistas.php — servidor/CONTRATO-v3.md §5).
 *
 *   iniciarConquistas()     // uma vez (vigias): vigia as conquistas do jogo e sincroniza com a conta
 *
 * - Ao entrar/criar a conta (ou abrir já logado): manda TODAS as do aparelho (`sincronizar`, união no
 *   servidor, fica a data mais antiga) e as que vierem da conta (outro aparelho) entram aqui.
 * - A cada conquista nova, com conta: entra numa fila no localStorage (sobrevive a recarregar e a ficar sem
 *   rede) e sobe 3 s depois (junta várias num pedido). Falhou: tenta de novo com espera crescente, quando a
 *   internet volta e na próxima abertura.
 * - Raridade ("12% dos jogadores"): GET ?raridade=1, público, com cache de 1 h (no servidor e aqui).
 */
import { useCareer, type AchievementUnlock } from '@/store/career'
import { useConquistasSite, type Raridade } from '@/store/conquistasSite'
import { api, comReintento, ErroApi, esperaReintento, valeTentar } from './api'
import { aoEntrar, useConta } from './conta'
import { armazem, type Armazem } from './medicao'

export const ID_CONQUISTA = /^[a-z0-9_.:-]{1,64}$/
export const POR_ENVIO = 500
export const CHAVE_FILA = 'lenda:conquistas-fila'
const ESPERA_MS = 3000
const RARIDADE_MS = 60 * 60_000

export interface ConquistaConta {
  id: string
  /** ISO. */
  em: string
}

/** Lista que veio do servidor: só ids válidos, data válida (futura vira agora), sem repetir (fica a mais antiga). */
export function normalizarConquistas(x: unknown, agora = Date.now()): ConquistaConta[] {
  const l = (x as { conquistas?: unknown } | null)?.conquistas
  if (!Array.isArray(l)) return []
  const por = new Map<string, number>()
  for (const c of l) {
    const o = c as Partial<ConquistaConta> | null
    if (!o || typeof o.id !== 'string' || !ID_CONQUISTA.test(o.id)) continue
    let t = typeof o.em === 'string' ? Date.parse(o.em) : NaN
    if (!Number.isFinite(t)) continue
    if (t > agora) t = agora
    const ja = por.get(o.id)
    if (ja === undefined || t < ja) por.set(o.id, t)
  }
  return [...por].map(([id, t]) => ({ id, em: new Date(t).toISOString() }))
}

/** As do aparelho no formato da conta (só ids que o servidor aceita). */
export function doAparelho(unlocked: Record<string, AchievementUnlock>): ConquistaConta[] {
  return Object.values(unlocked)
    .filter((u) => ID_CONQUISTA.test(u.id) && Number.isFinite(Date.parse(u.unlockedAt)))
    .map((u) => ({ id: u.id, em: new Date(Date.parse(u.unlockedAt)).toISOString() }))
}

/**
 * Mescla (união; fica a data mais antiga). `descer`: o que a conta tem e o aparelho não (ou com data mais
 * antiga); `subir`: o que o aparelho tem e a conta não (ou com data mais antiga).
 */
export function mesclarConquistas(local: readonly ConquistaConta[], conta: readonly ConquistaConta[]): { uniao: ConquistaConta[]; descer: ConquistaConta[]; subir: ConquistaConta[] } {
  const l = new Map(local.map((c) => [c.id, Date.parse(c.em)]))
  const r = new Map(conta.map((c) => [c.id, Date.parse(c.em)]))
  const uniao = new Map<string, number>()
  const descer: ConquistaConta[] = []
  const subir: ConquistaConta[] = []
  for (const [id, t] of r) {
    const lt = l.get(id)
    if (lt === undefined || t < lt) descer.push({ id, em: new Date(t).toISOString() })
    uniao.set(id, lt === undefined ? t : Math.min(t, lt))
  }
  for (const [id, t] of l) {
    const rt = r.get(id)
    if (rt === undefined || t < rt) subir.push({ id, em: new Date(t).toISOString() })
    uniao.set(id, rt === undefined ? t : Math.min(t, rt))
  }
  return { uniao: [...uniao].map(([id, t]) => ({ id, em: new Date(t).toISOString() })), descer, subir }
}

// ───────────────────────── fila (localStorage) ─────────────────────────

interface Fila {
  /** Conta dona da fila (trocar de conta no aparelho não manda as de uma para a outra sem querer). */
  uid: number
  itens: ConquistaConta[]
}

export function lerFila(a: Armazem): Fila | null {
  try {
    const j = JSON.parse(a.get(CHAVE_FILA) || 'null') as Partial<Fila> | null
    if (!j || typeof j.uid !== 'number' || !Array.isArray(j.itens)) return null
    return { uid: j.uid, itens: normalizarConquistas({ conquistas: j.itens }) }
  } catch {
    return null
  }
}

export function porNaFila(a: Armazem, uid: number, novas: readonly ConquistaConta[]): Fila {
  const atual = lerFila(a)
  const base = atual && atual.uid === uid ? atual.itens : []
  const itens = mesclarConquistas(base, novas).uniao.slice(-2000)
  const f = { uid, itens }
  a.set(CHAVE_FILA, JSON.stringify(f))
  return f
}

/** Tira da fila o que já subiu (o que entrou depois do envio fica). */
export function tirarDaFila(a: Armazem, uid: number, enviadas: readonly ConquistaConta[]) {
  const atual = lerFila(a)
  if (!atual || atual.uid !== uid) return
  const foram = new Map(enviadas.map((c) => [c.id, c.em]))
  const resto = atual.itens.filter((c) => !foram.has(c.id) || Date.parse(c.em) < Date.parse(foram.get(c.id)!))
  a.set(CHAVE_FILA, resto.length ? JSON.stringify({ uid, itens: resto }) : '')
}

// ───────────────────────── envio ─────────────────────────

const ls = armazem(() => (typeof window !== 'undefined' ? window.localStorage : undefined))

/** Manda em pedaços de até 500 e devolve a união que a conta tem agora. */
async function sincronizar(itens: readonly ConquistaConta[]): Promise<ConquistaConta[]> {
  let uniao: ConquistaConta[] = []
  const pedacos = itens.length ? Array.from({ length: Math.ceil(itens.length / POR_ENVIO) }, (_, i) => itens.slice(i * POR_ENVIO, (i + 1) * POR_ENVIO)) : [[]]
  for (const p of pedacos) {
    const r = await api<unknown>('conquistas.php', { corpo: { acao: 'sincronizar', conquistas: p } })
    uniao = mesclarConquistas(uniao, normalizarConquistas(r)).uniao
  }
  return uniao
}

let importando = false
function descerParaOAparelho(conta: readonly ConquistaConta[]) {
  const { descer } = mesclarConquistas(doAparelho(useCareer.getState().achievements), conta)
  if (!descer.length) return
  // as que descem não voltam para a fila (o vigia abaixo ignora esta mudança)
  importando = true
  try {
    useCareer.getState().importAchievements(descer)
  } finally {
    importando = false
  }
}

let enviando = false
let timer = 0
let tentativa = 0

function atualizarPendentes() {
  const u = useConta.getState().usuario
  const f = lerFila(ls)
  useConquistasSite.setState({ pendentes: u && f && f.uid === u.id ? f.itens.length : 0 })
}

/** Sobe a fila agora (se houver conta e nada em andamento). Falhou por rede: agenda outra tentativa. */
async function enviarFila(): Promise<void> {
  const u = useConta.getState().usuario
  const f = lerFila(ls)
  if (!u || !f || f.uid !== u.id || !f.itens.length || enviando) return
  enviando = true
  try {
    const conta = await sincronizar(f.itens)
    tirarDaFila(ls, u.id, f.itens)
    tentativa = 0
    descerParaOAparelho(conta)
  } catch (err) {
    if (err instanceof ErroApi && err.status === 401) useConta.getState().sessaoExpirou()
    else if (valeTentar(err) && tentativa < 6) agendar(esperaReintento(tentativa++, 3000, 120_000))
  } finally {
    enviando = false
    atualizarPendentes()
  }
}

function agendar(ms = ESPERA_MS) {
  if (typeof window === 'undefined') return
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void enviarFila(), ms)
}

/** As conquistas do aparelho só valem depois que o jogo terminou de ler o IndexedDB (init). */
function carreiraPronta(): Promise<void> {
  if (useCareer.getState().status === 'ready') return Promise.resolve()
  return new Promise((res) => {
    const un = useCareer.subscribe((s) => {
      if (s.status !== 'ready') return
      un()
      res()
    })
  })
}

/** Última leitura da conta neste aparelho (abrir o jogo já logado relê no máximo a cada 10 min). */
const CHAVE_LIDA = 'lenda:conquistas-lidas'
const RELER_MS = 10 * 60_000

/**
 * Entrou/criou a conta: TODAS as do aparelho vão para a conta (união) e o que ela tem desce para cá.
 * Abriu o jogo já logado (`sessao`): só lê a conta (GET, no máximo a cada 10 min) — e sobe só o que faltar lá.
 */
export async function sincronizarAoEntrar(como: 'cadastro' | 'login' | 'redefinir' | 'sessao' = 'login'): Promise<void> {
  if (!useConta.getState().usuario) return
  // antes do jogo ler o que está guardado, "as do aparelho" estariam vazias (e o que descesse seria apagado)
  await carreiraPronta()
  const u = useConta.getState().usuario
  if (!u) return
  const locais = doAparelho(useCareer.getState().achievements)
  try {
    if (como === 'sessao') {
      const lida = Number(ls.get(CHAVE_LIDA)?.split(':')[1])
      if (ls.get(CHAVE_LIDA)?.split(':')[0] === String(u.id) && Number.isFinite(lida) && Date.now() - lida < RELER_MS) return void enviarFila()
      const conta = normalizarConquistas(await comReintento(() => api<unknown>('conquistas.php', { tempo: 10_000 }), { tentativas: 2 }))
      if (useConta.getState().usuario?.id !== u.id) return
      ls.set(CHAVE_LIDA, `${u.id}:${Date.now()}`)
      const { subir } = mesclarConquistas(locais, conta)
      descerParaOAparelho(conta)
      if (subir.length) porNaFila(ls, u.id, subir)
      return void enviarFila()
    }
    // primeiro na fila: se a rede cair no meio, elas sobem depois
    if (locais.length) porNaFila(ls, u.id, locais)
    const conta = await comReintento(() => sincronizar(lerFila(ls)?.uid === u.id ? lerFila(ls)!.itens : []), { tentativas: 3, base: 1500 })
    if (useConta.getState().usuario?.id !== u.id) return
    ls.set(CHAVE_LIDA, `${u.id}:${Date.now()}`)
    tirarDaFila(ls, u.id, locais)
    descerParaOAparelho(conta)
  } catch (err) {
    if (err instanceof ErroApi && err.status === 401) useConta.getState().sessaoExpirou()
    else agendar(15_000)
  } finally {
    atualizarPendentes()
  }
}

// ───────────────────────── raridade ─────────────────────────

let raridadeEm = 0
let raridadeNoAr = false
export function normalizarRaridade(x: unknown): Raridade | null {
  const r = x as { jogadores?: unknown; porConquista?: unknown } | null
  if (!r || typeof r.jogadores !== 'number' || !Number.isFinite(r.jogadores) || r.jogadores < 0) return null
  const por: Record<string, number> = {}
  if (r.porConquista && typeof r.porConquista === 'object') {
    for (const [id, n] of Object.entries(r.porConquista as Record<string, unknown>)) if (ID_CONQUISTA.test(id) && typeof n === 'number' && Number.isFinite(n) && n >= 0) por[id] = Math.round(n)
  }
  return { jogadores: Math.round(r.jogadores), porConquista: por }
}

async function pedirRaridade() {
  if (raridadeNoAr || (useConquistasSite.getState().raridade && Date.now() - raridadeEm < RARIDADE_MS)) return
  raridadeNoAr = true
  try {
    const r = normalizarRaridade(await comReintento(() => api('conquistas.php', { query: { raridade: '1' }, cache: 'default', tempo: 10_000 }), { tentativas: 2 }))
    if (r) {
      raridadeEm = Date.now()
      useConquistasSite.setState({ raridade: r })
    }
  } catch {
    /* sem raridade: a tela de conquistas mostra o resto como sempre */
  } finally {
    raridadeNoAr = false
  }
}

// ───────────────────────── vigia ─────────────────────────

let iniciado = false
export function iniciarConquistas() {
  if (iniciado || typeof window === 'undefined') return
  iniciado = true
  useConquistasSite.setState({ pedirRaridade: () => void pedirRaridade(), naConta: !!useConta.getState().usuario })

  // conquista nova no jogo: com conta, vai para a fila e sobe daqui a pouco (várias juntas)
  useCareer.subscribe((s, p) => {
    // a leitura do IndexedDB na abertura (init) não é conquista nova
    if (importando || s.achievements === p.achievements || s.isFixture || s.status !== 'ready' || p.status !== 'ready') return
    const u = useConta.getState().usuario
    if (!u && !useConta.getState().lembrado) return
    const novas = doAparelho(s.achievements).filter((c) => !p.achievements[c.id] || Date.parse(p.achievements[c.id].unlockedAt) > Date.parse(c.em))
    if (!novas.length) return
    if (!u) {
      // a conta ainda não respondeu (servidor lento), mas este aparelho já entrou: quando ela responder, a leitura da
      // conta é feita na hora (sem a espera de 10 min) e sobe o que faltar lá
      ls.set(CHAVE_LIDA, '')
      return
    }
    porNaFila(ls, u.id, novas)
    atualizarPendentes()
    agendar()
  })

  aoEntrar((_u, como) => {
    useConquistasSite.setState({ naConta: true })
    void sincronizarAoEntrar(como)
  })
  useConta.subscribe((s, p) => {
    if (!!s.usuario !== !!p.usuario) useConquistasSite.setState({ naConta: !!s.usuario })
    if (s.usuario && !p.usuario) atualizarPendentes()
  })
  window.addEventListener('online', () => {
    tentativa = 0
    agendar(1500)
  })
  // a aba vai para o fundo (ou fecha): última chance de subir o que está na fila
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void enviarFila()
  })
}
