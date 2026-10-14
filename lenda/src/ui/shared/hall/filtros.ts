/**
 * Hall das Lendas por nacionalidade e por clube: os mesmos filtros valem para as 50 lendas reais
 * (`nationality`, `clubs[].clubId`), para as carreiras deste aparelho e para as da comunidade (Hall público,
 * que já vem filtrado do servidor). Puro, sem React.
 *
 *   const f = { pais: 'BOL', clube: 'e2022' }
 *   filtrarHall(hall, f)                         // rankings só com quem passa no filtro (posições refeitas)
 *   misturarRanking(rows, comunidade, idsAqui)   // ranking geral com as carreiras da comunidade pela nota
 */
import type { CategoryId, Legend, LegendLegacy, RankEntry, RankRow, RunLegacy } from '@/engine/legacy'
import type { CarreiraComunidade, FiltroHall } from '@/store/comunidade'

export type { FiltroHall }

export const filtroAtivo = (f: FiltroHall) => !!(f.pais || f.clube)

export function lendaNoFiltro(l: Pick<Legend, 'nationality' | 'clubs'>, f: FiltroHall): boolean {
  if (f.pais && l.nationality !== f.pais) return false
  if (f.clube && !l.clubs.some((c) => c.clubId === f.clube)) return false
  return true
}

/** Todos os clubes que a carreira defendeu (temporadas, temporadas divididas e o resumo). */
export function clubesDaRun(r: Pick<RunLegacy, 'input' | 'stats'>): Set<string> {
  const out = new Set<string>()
  for (const s of r.input.seasons ?? []) {
    if (s.clubId) out.add(s.clubId)
    for (const p of (s as { spans?: { clubId?: string }[] }).spans ?? []) if (p.clubId) out.add(p.clubId)
  }
  for (const c of r.input.summary?.clubs ?? []) if (c.clubId) out.add(c.clubId)
  for (const c of r.stats.clubTotals ?? []) if (c.clubId) out.add(c.clubId)
  return out
}

export function runNoFiltro(r: Pick<RunLegacy, 'input' | 'stats'>, f: FiltroHall): boolean {
  if (f.pais && (r.input.identity?.nationality ?? r.stats.nationality) !== f.pais) return false
  if (f.clube && !clubesDaRun(r).has(f.clube)) return false
  return true
}

export function entradaNoFiltro(e: RankEntry, f: FiltroHall): boolean {
  return e.kind === 'run' ? runNoFiltro(e, f) : lendaNoFiltro(e.legend, f)
}

export function comunidadeNoFiltro(c: Pick<CarreiraComunidade, 'pais' | 'clubes'>, f: FiltroHall): boolean {
  if (f.pais && c.pais !== f.pais) return false
  if (f.clube && !c.clubes.includes(f.clube)) return false
  return true
}

const nomeDe = (e: RankEntry) => (e.kind === 'run' ? e.input.identity.surname : e.legend.name)

/**
 * As linhas que passam no filtro, com a posição refeita (quem dividia a posição continua dividindo). O
 * desempate só fica se o vizinho de baixo (ou de cima) continuar ao lado — senão ele citaria quem saiu.
 */
export function filtrarLinhas(rows: readonly RankRow[], manter: (e: RankEntry) => boolean): RankRow[] {
  const kept = rows.filter((r) => manter(r.entry))
  const out: RankRow[] = []
  kept.forEach((r, i) => {
    const prev = out[i - 1]
    const rank = prev && kept[i - 1].rank === r.rank ? prev.rank : i + 1
    const next = kept[i + 1]
    const row: RankRow = { rank, entry: r.entry, value: r.value }
    if (r.tieBreak && next && nomeDe(next.entry) === r.tieBreak.against) row.tieBreak = r.tieBreak
    if (r.behind && kept[i - 1] && nomeDe(kept[i - 1].entry) === r.behind.against) row.behind = r.behind
    out.push(row)
  })
  return out
}

export interface HallFiltrado {
  runs: RunLegacy[]
  legends: LegendLegacy[]
  overall: RankRow[]
  categories: Record<CategoryId, RankRow[]>
  bestRun: RunLegacy | null
  /** A maior lenda real que passa no filtro (pode não haver nenhuma: Bolívia, por exemplo). */
  topLegend: LegendLegacy | null
}

export function filtrarHall(
  hall: { runs: RunLegacy[]; legends: LegendLegacy[]; overall: RankRow[]; categories: Record<CategoryId, RankRow[]>; bestRun: RunLegacy | null; topLegend: LegendLegacy },
  f: FiltroHall,
): HallFiltrado {
  if (!filtroAtivo(f)) return { ...hall }
  const manter = (e: RankEntry) => entradaNoFiltro(e, f)
  const runs = hall.runs.filter(manter)
  const legends = hall.legends.filter(manter)
  const categories = Object.fromEntries(Object.entries(hall.categories).map(([id, rows]) => [id, filtrarLinhas(rows, manter)])) as Record<CategoryId, RankRow[]>
  const bestRun = runs.slice().sort((a, b) => b.raw - a.raw)[0] ?? null
  return { runs, legends, overall: filtrarLinhas(hall.overall, manter), categories, bestRun, topLegend: legends[0] ?? null }
}

// ───────────────────────── ranking geral com a comunidade ─────────────────────────

export type LinhaMista = { kind: 'rank'; rank: number; row: RankRow } | { kind: 'comunidade'; rank: number; c: CarreiraComunidade }

interface Chaves {
  nota: number
  bolas: number
  copas: number
  titulos: number
  gols: number
  ordem: number
}
const chavesDe = (l: { kind: 'rank'; row: RankRow } | { kind: 'comunidade'; c: CarreiraComunidade }): Chaves =>
  l.kind === 'rank'
    ? { nota: l.row.entry.score, bolas: l.row.entry.values.ballonDor, copas: l.row.entry.values.worldCups, titulos: l.row.entry.values.titles, gols: l.row.entry.values.goals, ordem: l.row.entry.kind === 'run' ? 0 : 1 }
    : { nota: l.c.nota, bolas: l.c.bolasOuro, copas: l.c.copas, titulos: l.c.titulos, gols: l.c.gols, ordem: 2 }

/**
 * Ranking geral misturado: lendas e carreiras daqui (já na ordem do motor, com o desempate em cadeia) e as
 * carreiras da comunidade entrando pela nota (empate: Bolas de Ouro → Copas → títulos → gols; tudo igual,
 * as daqui e as lendas na frente). Uma carreira da comunidade que também está neste aparelho (a sua) entra
 * uma vez só, como a daqui.
 */
export function misturarRanking(rows: readonly RankRow[], comunidade: readonly CarreiraComunidade[], idsAqui: ReadonlySet<string> = new Set()): LinhaMista[] {
  const outros = comunidade.filter((c) => !idsAqui.has(c.id))
  if (!outros.length) return rows.map((row) => ({ kind: 'rank', rank: row.rank, row }))
  const base = rows.map((row, i) => ({ kind: 'rank' as const, row, i }))
  const com = [...outros].sort((a, b) => b.nota - a.nota || b.bolasOuro - a.bolasOuro || b.copas - a.copas || b.titulos - a.titulos || b.gols - a.gols || a.posicao - b.posicao)
  // intercala sem mexer na ordem do motor entre as linhas dele
  const out: ({ kind: 'rank'; row: RankRow } | { kind: 'comunidade'; c: CarreiraComunidade })[] = []
  let j = 0
  const vemAntes = (c: CarreiraComunidade, r: RankRow) => {
    const a = chavesDe({ kind: 'comunidade', c })
    const b = chavesDe({ kind: 'rank', row: r })
    return a.nota - b.nota || a.bolas - b.bolas || a.copas - b.copas || a.titulos - b.titulos || a.gols - b.gols
  }
  for (const b of base) {
    while (j < com.length && vemAntes(com[j], b.row) > 0) out.push({ kind: 'comunidade', c: com[j++] })
    out.push({ kind: 'rank', row: b.row })
  }
  while (j < com.length) out.push({ kind: 'comunidade', c: com[j++] })
  // posição: a de cada um na lista misturada (empate total na nota e nos critérios = posição dividida)
  const res: LinhaMista[] = []
  out.forEach((l, i) => {
    const prev = out[i - 1]
    let empate = false
    if (prev) {
      if (prev.kind === 'rank' && l.kind === 'rank') empate = prev.row.rank === l.row.rank
      else {
        const a = chavesDe(prev)
        const b = chavesDe(l)
        empate = a.nota === b.nota && a.bolas === b.bolas && a.copas === b.copas && a.titulos === b.titulos && a.gols === b.gols
      }
    }
    const rank = empate ? res[i - 1].rank : i + 1
    res.push(l.kind === 'rank' ? { kind: 'rank', rank, row: l.row } : { kind: 'comunidade', rank, c: l.c })
  })
  return res
}

// ───────────────────────── busca de clube ─────────────────────────

/** Minúsculas, sem acento e sem pontuação: "São Paulo" ≈ "sao paulo". */
export function normalizarBusca(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export interface ClubeBusca {
  id: string
  name: string
  shortName?: string
  country?: string
}

/**
 * Clubes para a busca: começa com o termo primeiro, depois contém; nome curto também vale. `prioridade`:
 * ids que vêm antes no empate (os clubes das lendas e das suas carreiras).
 */
export function buscarClubes<C extends ClubeBusca>(clubes: readonly C[], termo: string, max = 8, prioridade: ReadonlySet<string> = new Set()): C[] {
  const q = normalizarBusca(termo)
  if (!q) return []
  const pontos: { c: C; p: number }[] = []
  for (const c of clubes) {
    const n = normalizarBusca(c.name)
    const s = c.shortName ? normalizarBusca(c.shortName) : ''
    let p = -1
    if (n === q || s === q) p = 0
    else if (n.startsWith(q) || s.startsWith(q)) p = 1
    else if (n.split(' ').some((w) => w.startsWith(q))) p = 2
    else if (n.includes(q) || s.includes(q)) p = 3
    if (p < 0) continue
    pontos.push({ c, p: p * 2 + (prioridade.has(c.id) ? 0 : 1) })
  }
  return pontos
    .sort((a, b) => a.p - b.p || a.c.name.localeCompare(b.c.name, 'pt-BR'))
    .slice(0, max)
    .map((x) => x.c)
}

/** "14:05" no horário de Brasília (ou null se a data não vier). */
export function horaBr(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(d)
}
