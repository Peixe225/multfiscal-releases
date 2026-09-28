/**
 * Calendários: pontos corridos (método do círculo), fases de liga "suíças" (UEFA) e o
 * complemento de temporadas em andamento (tabela real + jogos reais restantes → completa o que faltar).
 * Reutilizado pelo modo Imersivo (fase 2).
 */
import type { Fixture, StandingRow } from '../types'
import type { Rng } from '../rng'

export type Pairing = [home: string, away: string]

/**
 * Pontos corridos: `rounds` turnos (1–4). Retorna rodadas (cada uma com os jogos daquela rodada).
 * Mando equilibrado: turnos pares espelham os ímpares; em cada turno cada clube tem ±1 jogo em casa.
 */
export function roundRobin(teams: readonly string[], rounds: number, rng?: Rng, balanced = false): Pairing[][] {
  const list: (string | null)[] = rng ? rng.shuffle(teams) : teams.slice()
  if (list.length < 2) return []
  if (list.length % 2 === 1) {
    if (balanced) list.unshift(null)
    else list.push(null)
  }
  const n = list.length
  const half = n / 2
  const base: Pairing[][] = []
  const arr = list.slice()
  for (let r = 0; r < n - 1; r++) {
    const day: Pairing[] = []
    for (let i = 0; i < half; i++) {
      const a = arr[i]
      const b = arr[n - 1 - i]
      if (a === null || b === null) continue
      // balanced (Modo Imersivo): todos invertem nas rodadas ímpares e, com número ímpar de clubes, a
      // folga fica na posição fixa → cada clube alterna o mando (sequência máx. de 2 jogos no mesmo
      // mando, também entre turno e returno); sem `balanced`, o padrão do Clássico
      const flip = balanced || i === 0 ? r % 2 === 1 : (r + i) % 2 === 1
      day.push(flip ? [b, a] : [a, b])
    }
    base.push(day)
    // rotação (o primeiro fica fixo)
    const last = arr.pop()!
    arr.splice(1, 0, last)
  }
  const out: Pairing[][] = []
  for (let t = 0; t < rounds; t++) {
    const mirror = t % 2 === 1
    for (const day of base) out.push(mirror ? day.map(([h, a]) => [a, h] as Pairing) : day.map((p) => [p[0], p[1]] as Pairing))
  }
  return out
}

const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * Gera jogos até cada clube cumprir seu déficit (`need`), evitando repetir confrontos de `avoid`
 * sempre que possível. Mando para quem tem menos jogos em casa (`homes`).
 */
export function fillPairings(
  need: Map<string, number>,
  rng: Rng,
  opts: { avoid?: Set<string>; homes?: Map<string, number>; allowRepeat?: boolean; last?: Map<string, number> } = {},
): Pairing[] {
  const avoid = opts.avoid ?? new Set<string>()
  // (Modo Imersivo) `last` = sequência atual de mando de cada clube (+k: k jogos seguidos em casa,
  // −k: fora): prefere parceiro de mando oposto e dá o mando a quem vem de fora (alterna)
  const last = opts.last
  const homes = opts.homes ?? new Map<string, number>()
  const left = new Map<string, number>()
  for (const [t, n] of need) if (n > 0) left.set(t, n)
  const out: Pairing[] = []
  let guard = 0
  while (left.size > 1 && guard++ < 100000) {
    // ordena por maior déficit (desempate aleatório estável)
    const teams = rng.shuffle([...left.keys()]).sort((a, b) => left.get(b)! - left.get(a)!)
    const t = teams[0]
    let partner: string | undefined
    for (let i = 1; i < teams.length; i++) {
      if (!avoid.has(key(t, teams[i]))) {
        partner = teams[i]
        break
      }
    }
    if (last && partner) {
      const lt = Math.sign(last.get(t) ?? 0)
      for (let i = 1; i < teams.length; i++) {
        if (!avoid.has(key(t, teams[i])) && lt !== 0 && Math.sign(last.get(teams[i]) ?? 0) === -lt) {
          partner = teams[i]
          break
        }
      }
    }
    if (!partner) {
      if (opts.allowRepeat === false) {
        left.delete(t)
        continue
      }
      partner = teams[1]
    }
    const ht = homes.get(t) ?? 0
    const hp = homes.get(partner) ?? 0
    let home: string
    if (last) {
      // quem está há mais tempo fora (ou menos tempo em casa) recebe
      const rt = last.get(t) ?? 0
      const rp = last.get(partner) ?? 0
      home = rt < rp ? t : rp < rt ? partner : ht <= hp ? t : partner
    } else home = ht < hp ? t : hp < ht ? partner : rng.chance(0.5) ? t : partner
    const away = home === t ? partner : t
    if (last) {
      last.set(home, Math.max(0, last.get(home) ?? 0) + 1)
      last.set(away, Math.min(0, last.get(away) ?? 0) - 1)
    }
    homes.set(home, (homes.get(home) ?? 0) + 1)
    out.push([home, away])
    avoid.add(key(t, partner))
    for (const x of [t, partner]) {
      const v = left.get(x)! - 1
      if (v <= 0) left.delete(x)
      else left.set(x, v)
    }
  }
  return out
}

/**
 * Temporada nova: pontos corridos (dentro de cada grupo/conferência, se houver) e ajuste para
 * `target` jogos por clube — trunca por rodadas ou completa com jogos extras (interzonais).
 */
export function seasonSchedule(
  teams: readonly string[],
  rounds: number,
  rng: Rng,
  target?: number,
  groups?: Map<string, string>,
  balanced = false,
): Pairing[] {
  const groupLists = new Map<string, string[]>()
  if (groups && groups.size) {
    for (const t of teams) {
      const g = groups.get(t) ?? '_'
      const l = groupLists.get(g)
      if (l) l.push(t)
      else groupLists.set(g, [t])
    }
  } else groupLists.set('_', teams.slice())

  const played = new Map<string, number>()
  const homes = new Map<string, number>()
  const avoid = new Set<string>()
  const out: Pairing[] = []
  for (const t of teams) played.set(t, 0)
  for (const list of groupLists.values()) {
    const days = roundRobin(list, rounds, rng, balanced)
    for (const day of days) {
      if (target !== undefined && day.some(([h, a]) => played.get(h)! >= target || played.get(a)! >= target)) {
        // rodada que estouraria o alvo: aproveita só os jogos que cabem
        for (const [h, a] of day) {
          if (played.get(h)! < target && played.get(a)! < target) push(h, a)
        }
        continue
      }
      for (const [h, a] of day) push(h, a)
    }
  }
  if (target !== undefined) {
    const need = new Map<string, number>()
    for (const t of teams) need.set(t, target - played.get(t)!)
    let last: Map<string, number> | undefined
    if (balanced) {
      last = new Map()
      for (const [h, a] of out) {
        last.set(h, Math.max(0, last.get(h) ?? 0) + 1)
        last.set(a, Math.min(0, last.get(a) ?? 0) - 1)
      }
    }
    for (const [h, a] of fillPairings(need, rng, { avoid, homes, last })) out.push([h, a])
  }
  return out

  function push(h: string, a: string) {
    out.push([h, a])
    played.set(h, played.get(h)! + 1)
    played.set(a, played.get(a)! + 1)
    homes.set(h, (homes.get(h) ?? 0) + 1)
    avoid.add(key(h, a))
  }
}

/**
 * Continuação da temporada real: joga os `fixtures` reais ainda sem placar (entre clubes da liga)
 * e, se `complete` for falso ou alguém ainda não chegar a `target` jogos, completa o calendário.
 */
export function remainingSchedule(
  rows: readonly StandingRow[],
  fixtures: readonly Fixture[] | undefined,
  target: number,
  rng: Rng,
  complete = false,
): Pairing[] {
  const played = new Map<string, number>()
  for (const r of rows) played.set(r.clubId, r.played)
  const out: Pairing[] = []
  const homes = new Map<string, number>()
  const avoid = new Set<string>()
  for (const f of fixtures ?? []) {
    if (f.score) continue
    const ph = played.get(f.home)
    const pa = played.get(f.away)
    if (ph === undefined || pa === undefined || f.home === f.away) continue
    if (ph >= target || pa >= target) continue
    out.push([f.home, f.away])
    played.set(f.home, ph + 1)
    played.set(f.away, pa + 1)
    homes.set(f.home, (homes.get(f.home) ?? 0) + 1)
  }
  const need = new Map<string, number>()
  let missing = 0
  for (const [t, p] of played) {
    const d = target - p
    if (d > 0) {
      need.set(t, d)
      missing += d
    }
  }
  if (missing > 0 && (!complete || missing > 1)) {
    for (const p of fillPairings(need, rng, { avoid, homes })) out.push(p)
  }
  return out
}

/**
 * Fase de liga "suíça" (Champions 2024+): cada clube faz `matches` jogos contra adversários
 * diferentes (metade em casa). `already` = jogos por clube já disputados (continuação real).
 */
export function swissPairings(
  teams: readonly string[],
  matches: number,
  rng: Rng,
  already?: Map<string, number>,
): Pairing[] {
  const need = new Map<string, number>()
  for (const t of teams) need.set(t, matches - (already?.get(t) ?? 0))
  return fillPairings(need, rng, {})
}
