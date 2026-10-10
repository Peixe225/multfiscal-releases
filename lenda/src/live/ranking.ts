/**
 * Ranking da live de hoje: as lendas que terminaram a carreira durante a live do dia (data local), com a
 * Nota de Legado, a faixa (Promessa… Imortal) e quem criou (o @ do vencedor da disputa, ou "o chat").
 *
 *   recordLiveLegend({ id, surname, score, tier, by }, realSource())   // fim de carreira (autopilot.ts)
 *   useLiveRanking((s) => s.list)                                      // tela (LiveRanking.tsx)
 *   visibleRanking(list, real)                                         // numa live de verdade, sem as do simulador
 *
 * Fica no localStorage da janela que roda a live, uma chave por dia (lenda:live:ranking:AAAA-MM-DD, até
 * RANKING_CAP lendas — saem as de menor nota; dias com mais de uma semana são apagados). Lenda criada com o
 * simulador (ou num teste) vai marcada `sim` e nunca aparece numa live de verdade — o mesmo cuidado dos
 * apoiadores de teste na store.
 */
import { create } from 'zustand'

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
const KEEP_DAYS = 7

/** Dia local "AAAA-MM-DD" (a live das 23h às 1h muda de ranking à meia-noite, como o "hoje" de quem assiste). */
export function dayKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const byScore = (a: RankEntry, b: RankEntry) => b.score - a.score || a.at - b.at

/** Põe a lenda na lista (sem repetir a carreira), em ordem de nota, cortando em `cap`. */
export function insertRanking(list: readonly RankEntry[], e: RankEntry, cap = RANKING_CAP): RankEntry[] {
  return [...list.filter((x) => x.id !== e.id), e].sort(byScore).slice(0, cap)
}

/** Numa live de verdade, as lendas do simulador não contam. */
export function visibleRanking(list: readonly RankEntry[], real: boolean): RankEntry[] {
  return (real ? list.filter((e) => !e.sim) : [...list]).sort(byScore)
}

/** "@gabi.fut" · "o chat". */
export const creatorLabel = (e: Pick<RankEntry, 'by'>) => (e.by ? `@${e.by}` : 'o chat')

function isEntry(v: unknown): v is RankEntry {
  if (!v || typeof v !== 'object') return false
  const e = v as RankEntry
  return typeof e.id === 'string' && typeof e.surname === 'string' && typeof e.score === 'number' && Number.isFinite(e.score) && typeof e.at === 'number'
}

export function readRanking(day = dayKey()): RankEntry[] {
  try {
    const raw = localStorage.getItem(RANKING_PREFIX + day)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter(isEntry).map((e) => ({ ...e, tier: typeof e.tier === 'string' ? e.tier : '' })).sort(byScore) : []
  } catch {
    return []
  }
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
  const before = refreshRanking(now)
  if (before.some((x) => x.id === e.id)) return { list: before, record: false }
  const best = visibleRanking(before, real)[0]
  const visible = !(real && e.sim)
  const record = visible && !!best && e.score > best.score
  const list = insertRanking(before, e)
  writeRanking(day, list)
  useLiveRanking.setState({ day, list, last: { id: e.id, record } })
  return { list, record }
}
