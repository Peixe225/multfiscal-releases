/**
 * Elencos para a narração: craques do mundo (rivais reais e novas gerações) no clube/seleção +
 * nomes fictícios estáveis (trocam a cada 3 temporadas) para completar 18 jogadores.
 */
import { rng as subRng } from '../rng'
import type { GameData, Position, WorldState } from '../types'
import { randomName } from '../world/names'
import { clubOf, countryOf } from './util'

export interface SquadPlayer {
  name: string
  short: string
  pos: Position
  ovr: number
}

/** Partículas de sobrenome que ficam junto do nome curto (van Dijk, De Bruyne, Le Fée, Di María…). */
const PARTICLES = new Set(['de', 'da', 'do', 'das', 'dos', 'di', 'del', 'della', 'van', 'von', 'der', 'den', 'ter', 'ten', 'le', 'la', 'du', 'dal', 'el', 'al', 'bin', 'ben', 'mac', 'st.'])

/**
 * Nome curto para a narração, mantendo as partículas do sobrenome: "Micky van de Ven" → "Van de Ven",
 * "Enzo Le Fée" → "Le Fée", nome curto "De" → "De Bruyne".
 */
export function narrationName(name: string, short: string, nationality?: string): string {
  const t = name.trim().split(/\s+/)
  const sh = (short || '').trim()
  if (t.length < 2 || !sh || sh.includes(' ') || /\./.test(sh)) return sh || name
  let i = -1
  for (let k = t.length - 1; k >= 0; k--) if (t[k] === sh) {
    i = k
    break
  }
  if (i < 0) return sh
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)
  if (PARTICLES.has(t[i].toLowerCase())) {
    // o curto é a própria partícula: estende até o próximo nome de verdade
    let e = i
    while (e < t.length - 1 && PARTICLES.has(t[e].toLowerCase())) e++
    return e > i ? cap(t.slice(i, e + 1).join(' ')) : sh
  }
  // para trás: partículas estrangeiras (van, von, le, di…); "De" só maiúsculo (De Bruyne); "da/do/dos"
  // e "de" minúsculo (nomes lusófonos/hispânicos: "da Silva" → "Silva") ficam de fora
  const dutch = nationality === 'NED' || nationality === 'BEL'
  const back = (k: number) => {
    const x = t[k]
    if (!/^(da|do|das|dos|de)$/.test(x) || x === 'De' || dutch) return true
    return x === 'de' && k > 1 && /^(van|von)$/i.test(t[k - 1])
  }
  let j = i
  while (j > 1 && PARTICLES.has(t[j - 1].toLowerCase()) && back(j - 1)) j--
  return j < i ? cap(t.slice(j, i + 1).join(' ')) : sh
}

const TEMPLATE: Position[] = ['GOL', 'ZAG', 'ZAG', 'LD', 'LE', 'VOL', 'MC', 'MEI', 'PE', 'PD', 'CA', 'GOL', 'ZAG', 'LE', 'VOL', 'MEI', 'PE', 'CA']

export function squadOf(data: GameData, world: WorldState, teamId: string, season: number, national: boolean): SquadPlayer[] {
  const club = national ? undefined : clubOf(data, teamId)
  const country = national ? countryOf(data, teamId) : undefined
  const base = national ? (world.nations[teamId] ?? country?.strength ?? 65) : (world.clubs[teamId]?.strength ?? club?.strength ?? 65)
  const stars = world.rivals
    .filter((r) => !r.retired && (national ? r.nationality === teamId : r.clubId === teamId))
    .sort((a, b) => b.ovr - a.ovr)
    .slice(0, national ? 11 : 6)
  const out: SquadPlayer[] = stars.map((r) => ({ name: r.name, short: narrationName(r.name, r.shortName, r.nationality), pos: r.position, ovr: r.ovr }))
  const nat = national ? teamId : (club?.country ?? 'INT')
  const r = subRng(world.seed, 'squad', teamId, Math.floor(season / 3))
  const need = TEMPLATE.slice()
  for (const p of out) {
    const i = need.indexOf(p.pos)
    if (i >= 0) need.splice(i, 1)
    else need.pop()
  }
  const taken = new Set(out.map((p) => p.short.toLowerCase()))
  for (const pos of need) {
    const code = r.chance(national ? 1 : 0.8) ? nat : r.pick(['BRA', 'ARG', 'COL', 'URU', 'FRA', 'ESP', 'POR', 'NGA', 'SEN'])
    // dois "Moreira" no mesmo elenco confundem a narração: sorteia de novo (algumas tentativas)
    let n = randomName(code, r)
    let short = narrationName(n.name, n.shortName, code)
    for (let k = 0; k < 6 && taken.has(short.toLowerCase()); k++) {
      n = randomName(code, r)
      short = narrationName(n.name, n.shortName, code)
    }
    taken.add(short.toLowerCase())
    out.push({ name: n.name, short, pos, ovr: Math.round(base + r.normal(-2, 3)) })
  }
  return out
}

const ATTACK: Position[] = ['CA', 'PE', 'PD', 'MEI']
const DEF: Position[] = ['ZAG', 'VOL', 'LD', 'LE']

/** Nomes curtos por papel (atacantes primeiro), sem o jogador do usuário. */
export function namesFor(squad: SquadPlayer[], exclude?: Position): { attackers: string[]; defenders: string[]; keeper: string; all: string[] } {
  const list = squad.slice()
  if (exclude) {
    const i = list.findIndex((p) => p.pos === exclude)
    if (i >= 0) list.splice(i, 1)
  }
  const keeper = list.find((p) => p.pos === 'GOL')?.short ?? 'o goleiro'
  const attackers = list.filter((p) => ATTACK.includes(p.pos)).map((p) => p.short)
  const defenders = list.filter((p) => DEF.includes(p.pos)).map((p) => p.short)
  const all = list.filter((p) => p.pos !== 'GOL').map((p) => p.short)
  return { attackers: attackers.length ? attackers : all, defenders: defenders.length ? defenders : all, keeper, all }
}
