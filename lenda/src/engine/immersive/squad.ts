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

const TEMPLATE: Position[] = ['GOL', 'ZAG', 'ZAG', 'LD', 'LE', 'VOL', 'MC', 'MEI', 'PE', 'PD', 'CA', 'GOL', 'ZAG', 'LE', 'VOL', 'MEI', 'PE', 'CA']

export function squadOf(data: GameData, world: WorldState, teamId: string, season: number, national: boolean): SquadPlayer[] {
  const club = national ? undefined : clubOf(data, teamId)
  const country = national ? countryOf(data, teamId) : undefined
  const base = national ? (world.nations[teamId] ?? country?.strength ?? 65) : (world.clubs[teamId]?.strength ?? club?.strength ?? 65)
  const stars = world.rivals
    .filter((r) => !r.retired && (national ? r.nationality === teamId : r.clubId === teamId))
    .sort((a, b) => b.ovr - a.ovr)
    .slice(0, national ? 11 : 6)
  const out: SquadPlayer[] = stars.map((r) => ({ name: r.name, short: r.shortName, pos: r.position, ovr: r.ovr }))
  const nat = national ? teamId : (club?.country ?? 'INT')
  const r = subRng(world.seed, 'squad', teamId, Math.floor(season / 3))
  const need = TEMPLATE.slice()
  for (const p of out) {
    const i = need.indexOf(p.pos)
    if (i >= 0) need.splice(i, 1)
    else need.pop()
  }
  for (const pos of need) {
    const n = randomName(r.chance(national ? 1 : 0.8) ? nat : r.pick(['BRA', 'ARG', 'COL', 'URU', 'FRA', 'ESP', 'POR', 'NGA', 'SEN']), r)
    out.push({ name: n.name, short: n.shortName, pos, ovr: Math.round(base + r.normal(-2, 3)) })
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
