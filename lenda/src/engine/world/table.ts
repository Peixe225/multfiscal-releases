/** Tabelas de classificação: linhas, resultados e critérios de desempate. */
import type { StandingRow } from '../types'

export function newRow(clubId: string, group?: string): StandingRow {
  const row: StandingRow = { clubId, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 }
  if (group) row.group = group
  return row
}

export function cloneRow(r: StandingRow): StandingRow {
  return { ...r }
}

export function addResult(home: StandingRow, away: StandingRow, gh: number, ga: number): void {
  home.played++
  away.played++
  home.gf += gh
  home.ga += ga
  away.gf += ga
  away.ga += gh
  if (gh > ga) {
    home.won++
    away.lost++
    home.points += 3
  } else if (gh < ga) {
    away.won++
    home.lost++
    away.points += 3
  } else {
    home.drawn++
    away.drawn++
    home.points++
    away.points++
  }
}

/** Critérios: pontos, vitórias, saldo, gols pró; por fim o id (determinístico). */
export function compareRows(a: StandingRow, b: StandingRow): number {
  return (
    b.points - a.points ||
    b.won - a.won ||
    b.gf - b.ga - (a.gf - a.ga) ||
    b.gf - a.gf ||
    (a.clubId < b.clubId ? -1 : a.clubId > b.clubId ? 1 : 0)
  )
}

/**
 * Ordena a tabela. Com `h2h` (confrontos diretos: "a|b" → [golsA, golsB] somados), clubes empatados
 * em pontos são desempatados antes por vitórias/saldo usando só os jogos entre eles (opcional).
 */
export function sortTable(rows: StandingRow[], h2h?: Map<string, [number, number]>): StandingRow[] {
  const out = rows.slice().sort(compareRows)
  if (!h2h) return out
  // mini-tabela de confronto direto para blocos com mesmos pontos
  let i = 0
  while (i < out.length) {
    let j = i + 1
    while (j < out.length && out[j].points === out[i].points) j++
    if (j - i > 1) {
      const block = out.slice(i, j)
      const pts = new Map<string, number>()
      for (const x of block) {
        let p = 0
        for (const y of block) {
          if (x === y) continue
          const r = h2h.get(`${x.clubId}|${y.clubId}`)
          if (r) p += r[0] > r[1] ? 3 : r[0] === r[1] ? 1 : 0
        }
        pts.set(x.clubId, p)
      }
      block.sort((a, b) => (pts.get(b.clubId) ?? 0) - (pts.get(a.clubId) ?? 0) || compareRows(a, b))
      out.splice(i, j - i, ...block)
    }
    i = j
  }
  return out
}

/** Soma tabelas (turno + returno de Apertura/Clausura → tabela anual). */
export function sumTables(tables: StandingRow[][]): StandingRow[] {
  const acc = new Map<string, StandingRow>()
  for (const t of tables) {
    for (const r of t) {
      const a = acc.get(r.clubId)
      if (!a) {
        acc.set(r.clubId, cloneRow(r))
        continue
      }
      a.played += r.played
      a.won += r.won
      a.drawn += r.drawn
      a.lost += r.lost
      a.gf += r.gf
      a.ga += r.ga
      a.points += r.points
    }
  }
  return sortTable([...acc.values()])
}
