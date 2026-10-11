/**
 * Ranking da live de hoje: as lendas que terminaram a carreira durante a live do dia (data local), com a
 * Nota de Legado, a faixa (Promessa… Imortal) e quem criou (o @ do vencedor da disputa, ou "o chat").
 *
 *   recordLiveLegend({ id, surname, score, tier, by }, realSource())   // fim de carreira (autopilot.ts)
 *   useLiveRanking((s) => s.list)                                      // tela (LiveRanking.tsx)
 *   visibleRanking(list, real)                                         // numa live de verdade, sem as do simulador
 *
 * Fica no localStorage da janela que roda a live, uma chave por dia (lenda:live:ranking:AAAA-MM-DD, até
 * RANKING_CAP lendas de verdade e SIM_RANKING_CAP de teste — cada grupo com o seu limite, saindo as de menor
 * nota; dias com mais de uma semana são apagados). Lenda criada com o simulador, na demonstração da ponte ou
 * num teste vai marcada `sim` e nunca aparece numa live de verdade — o mesmo cuidado dos apoiadores de teste
 * na store. Horas de simulador no mesmo dia nunca empurram as lendas de verdade para fora da lista.
 *
 * Cada gravação relê o armazenamento antes (outra janela do mesmo navegador pode ter gravado no meio).
 */
import { create } from 'zustand'
import { isOffensive } from './identity'

export interface RankEntry {
  /** Id da carreira (a mesma lenda não entra duas vezes). */
  id: string
  surname: string
  /** Nota de Legado (0–100). */
  score: number
  /** Faixa da nota: "Promessa", "Profissional", "Ídolo", "Craque", "Lenda", "Imortal". */
  tier: string
  /** @ de quem criou (vencedor da disputa / maior apoiador). Sem = "o chat". */
  by?: string
  /** Criada com o simulador / público de teste. */
  sim?: boolean
  at: number
}

export const RANKING_PREFIX = 'lenda:live:ranking:'
export const RANKING_CAP = 50
/** Lendas de teste guardadas por dia (só aparecem no simulador/demonstração). */
export const SIM_RANKING_CAP = 20
const KEEP_DAYS = 7

/** Dia local "AAAA-MM-DD" (a live das 23h às 1h muda de ranking à meia-noite, como o "hoje" de quem assiste). */
export function dayKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const byScore = (a: RankEntry, b: RankEntry) => b.score - a.score || a.at - b.at

/**
 * Põe a lenda na lista (sem repetir a carreira), em ordem de nota. O limite vale por grupo: até `cap` de
 * verdade e até `simCap` de teste — lendas de teste (escondidas numa live de verdade) não tomam a vaga das reais.
 */
export function insertRanking(list: readonly RankEntry[], e: RankEntry, cap = RANKING_CAP, simCap = SIM_RANKING_CAP): RankEntry[] {
  const all = [...list.filter((x) => x.id !== e.id), e].sort(byScore)
  const real = all.filter((x) => !x.sim).slice(0, cap)
  const sim = all.filter((x) => x.sim).slice(0, simCap)
  return [...real, ...sim].sort(byScore)
}

/** Numa live de verdade, as lendas do simulador não contam. */
export function visibleRanking(list: readonly RankEntry[], real: boolean): RankEntry[] {
  return (real ? list.filter((e) => !e.sim) : [...list]).sort(byScore)
}

/**
 * "@gabi.fut" · "o chat" (rótulo da linha do ranking). O @ passa pelo filtro de palavrões: o ranking fica
 * na tela o dia inteiro, e um @ ofensivo que venceu uma disputa não pode ficar repetido nele — vira "um torcedor".
 */
export function creatorLabel(e: Pick<RankEntry, 'by'>): string {
  if (!e.by) return 'o chat'
  return isOffensive(e.by) ? 'um torcedor' : `@${e.by}`
}

/** "criada por @gabi.fut" · "criada pelo chat" (a frase do recorde do dia, com a contração certa). */
export function creatorPhrase(e: Pick<RankEntry, 'by'>): string {
  return e.by ? `criada por ${creatorLabel(e)}` : 'criada pelo chat'
}

function isEntry(v: unknown): v is RankEntry {
  if (!v || typeof v !== 'object') return false
  const e = v as RankEntry
  return typeof e.id === 'string' && typeof e.surname === 'string' && typeof e.score === 'number' && Number.isFinite(e.score) && typeof e.at === 'number'
}

/** O ranking do dia no armazenamento; null = sem armazenamento (navegador bloqueando). */
function readStored(day: string): RankEntry[] | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(RANKING_PREFIX + day)
  } catch {
    return null
  }
  try {
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter(isEntry).map((e) => ({ ...e, tier: typeof e.tier === 'string' ? e.tier : '' })).sort(byScore) : []
  } catch {
    return []
  }
}

export function readRanking(day = dayKey()): RankEntry[] {
  return readStored(day) ?? []
}

function writeRanking(day: string, list: RankEntry[]) {
  try {
    localStorage.setItem(RANKING_PREFIX + day, JSON.stringify(list))
    // limpeza: rankings de dias antigos não servem para nada (a chave do dia é comparável como texto)
    const cutoff = dayKey(new Date(Date.now() - KEEP_DAYS * 86_400_000))
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(RANKING_PREFIX) && k.slice(RANKING_PREFIX.length) < cutoff) localStorage.removeItem(k)
    }
  } catch {
    /* sem storage: o ranking vale só enquanto a janela estiver aberta */
  }
}

interface RankingStore {
  day: string
  list: RankEntry[]
  /** Última lenda registrada e se ela bateu o recorde do dia (a tela comemora). */
  last: { id: string; record: boolean } | null
}

export const useLiveRanking = create<RankingStore>()(() => ({ day: '', list: [], last: null }))

/** Relê o ranking de hoje (virou o dia, ou a janela acabou de abrir). */
export function refreshRanking(now = new Date()): RankEntry[] {
  const day = dayKey(now)
  const s = useLiveRanking.getState()
  if (s.day === day) return s.list
  const list = readRanking(day)
  useLiveRanking.setState({ day, list, last: null })
  return list
}

/**
 * Registra a lenda que acabou de terminar. `record` = ela passou a nota da melhor lenda (visível) que já
 * estava no ranking de hoje — a primeira do dia não é "recorde batido", só abre o ranking.
 */
export function recordLiveLegend(e: RankEntry, real: boolean, now = new Date()): { list: RankEntry[]; record: boolean } {
  const day = dayKey(now)
  // relê o armazenamento (não a cópia em memória): outra janela deste navegador pode ter gravado uma lenda
  // depois que esta leu — gravar por cima da cópia velha apagaria a dela
  // (sem armazenamento: vale a lista em memória desta janela)
  const mem = useLiveRanking.getState()
  const before = readStored(day) ?? (mem.day === day ? mem.list : [])
  if (before.some((x) => x.id === e.id)) return { list: before, record: false }
  const best = visibleRanking(before, real)[0]
  const visible = !(real && e.sim)
  const record = visible && !!best && e.score > best.score
  const list = insertRanking(before, e)
  writeRanking(day, list)
  useLiveRanking.setState({ day, list, last: { id: e.id, record } })
  return { list, record }
}

// outra janela deste navegador gravou no ranking de hoje: a lista da tela acompanha (o evento "storage" só
// dispara nas OUTRAS janelas, então não há eco)
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function')
  window.addEventListener('storage', (e) => {
    const s = useLiveRanking.getState()
    if (s.day && e.key === RANKING_PREFIX + s.day) useLiveRanking.setState({ list: readRanking(s.day) })
  })
