/**
 * Rodada ao vivo: os outros jogos da rodada do jogador (placar que evolui no relógio da
 * transmissão) e a "tabela ao vivo" com eles + o seu placar. Só exibição.
 *
 * Fonte: a memória do motor quando ela traz a rodada (motor real: `league.matches` + `agenda`;
 * mock: `preview`). Sem isso, a lista fica vazia e a UI mostra só a classificação.
 */
import type { ImmersiveState, LiveMatch } from '@/engine/immersive/types'
import type { StandingRow } from '@/engine/types'
import { addResult, newRow, sortTable } from '@/engine/world/table'
import { userLeagueId } from './view'

export interface RoundGame {
  home: string
  away: string
  /** Placar final (pré-simulado). */
  final: [number, number]
  /** Minuto de cada gol [mandante[], visitante[]] (determinístico). */
  minutes: [number[], number[]]
}

type RealMem = {
  league?: { leagueId: string; matches: [string, string, number, number, number, number][] }
  agenda?: { key: string; competitionId: string; kind: string; round?: number; leg?: number }[]
}
type MockMem = { preview?: { itemId: string; games: [string, string, number, number][] } }

const hash = (str: string) => {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

function goalMinutes(seed: string, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(1 + (hash(`${seed}:${i}`) % 90))
  return out.sort((a, b) => a - b)
}

/** Outros jogos da rodada da partida ao vivo (vazio fora da liga ou sem dados). */
export function roundGames(s: ImmersiveState, live: LiveMatch): RoundGame[] {
  const eng = (s.engine ?? {}) as RealMem & MockMem
  let list: [string, string, number, number][] = []
  if (eng.preview && eng.preview.itemId === live.itemId) list = eng.preview.games
  else if (eng.league?.matches?.length && live.fixtureKey && eng.agenda) {
    const f = eng.agenda.find((x) => x.key === live.fixtureKey)
    if (f && f.kind === 'league' && f.round && !f.leg && f.competitionId === eng.league.leagueId) {
      const club = s.clubId
      list = eng.league.matches.filter((m) => m[4] === f.round && m[0] !== club && m[1] !== club).map((m) => [m[0], m[1], m[2], m[3]])
    }
  }
  return list.map(([h, a, gh, ga]) => ({ home: h, away: a, final: [gh, ga], minutes: [goalMinutes(`${live.itemId}:${h}:h`, gh), goalMinutes(`${live.itemId}:${a}:a`, ga)] }))
}

/** Placar de um jogo da rodada no minuto exibido. */
export function scoreAt(g: RoundGame, clock: number, done: boolean): [number, number] {
  if (done) return g.final
  return [g.minutes[0].filter((m) => m <= clock).length, g.minutes[1].filter((m) => m <= clock).length]
}

export interface LiveRow {
  row: StandingRow
  pos: number
  /** Variação em relação à tabela antes da rodada (+ sobe). */
  delta: number
}

/** A partida ao vivo é da liga do jogador (a da tabela)? */
export const isLeagueGame = (s: ImmersiveState, live: LiveMatch) => !live.home.national && !!live.competitionId && live.competitionId === userLeagueId(s)

/** Tabela ao vivo: base (antes da rodada) + placares correntes da rodada + o seu jogo. */
export function liveStandings(base: StandingRow[], s: ImmersiveState, live: LiveMatch, games: RoundGame[], clock: number, userScore: [number, number], done: boolean): LiveRow[] {
  if (!base.length) return []
  // só jogo da liga mexe na tabela (copa entre dois clubes da mesma liga não soma ponto)
  const inLeague = isLeagueGame(s, live) && base.some((r) => r.clubId === live.home.id) && base.some((r) => r.clubId === live.away.id)
  const rows = new Map(base.map((r) => [r.clubId, { ...r }]))
  const get = (id: string) => rows.get(id) ?? (rows.set(id, newRow(id)), rows.get(id)!)
  if (inLeague && live.phase !== 'pre') addResult(get(live.home.id), get(live.away.id), userScore[0], userScore[1])
  if (inLeague) for (const g of games) {
    const [h, a] = scoreAt(g, clock, done)
    if (clock > 0 || done) addResult(get(g.home), get(g.away), h, a)
  }
  const before = new Map(sortTable(base.map((r) => ({ ...r }))).map((r, i) => [r.clubId, i + 1]))
  return sortTable([...rows.values()]).map((row, i) => ({ row, pos: i + 1, delta: (before.get(row.clubId) ?? i + 1) - (i + 1) }))
}

/** Últimos resultados de um clube na liga (motor real: jogos já disputados da rodada atual para trás). */
export function clubForm(s: ImmersiveState, clubId: string, n = 5): ('V' | 'E' | 'D')[] {
  const eng = (s.engine ?? {}) as RealMem & { fixed?: Record<string, unknown> }
  const lg = eng.league
  if (!lg?.matches?.length || !eng.agenda) return []
  const played = eng.agenda.filter((f) => f.kind === 'league' && f.round && !f.leg && eng.fixed?.[f.key]).map((f) => f.round ?? 0)
  const cur = played.length ? Math.max(...played) : 0
  if (!cur) return []
  const out: ('V' | 'E' | 'D')[] = []
  const list = lg.matches.filter((m) => m[4] <= cur && (m[0] === clubId || m[1] === clubId) && m[0] !== s.clubId && m[1] !== s.clubId).sort((a, b) => a[4] - b[4] || a[5] - b[5])
  for (const [h, , gh, ga] of list) {
    const [f, a] = h === clubId ? [gh, ga] : [ga, gh]
    out.push(f > a ? 'V' : f < a ? 'D' : 'E')
  }
  return out.slice(-n)
}
