/**
 * Estudo de raridade (servidor/CONTRATO-v33.md §R): joga carreiras do Modo Clássico com o motor e os dados REAIS do
 * jogo, fora do navegador, com várias políticas de escolha. Não muda nada em src/: só importa o motor.
 *
 * Quem roda é o scripts/estudos/raridade.mjs (empacota este arquivo com o rolldown e reparte as carreiras entre
 * workers). A carreira é a mesma do navegador: semente = a0.toString(36) + a1.toString(36), a mesma identidade, o
 * mesmo ritmo e as mesmas escolhas (o replay da v3.3), então qualquer carreira achada aqui pode ser repetida no jogo.
 *
 * Políticas:
 *   aleatoria   escolhe ao acaso entre as opções (sem se aposentar antes da hora), como os testes de balanceamento;
 *   gananciosa  imita quem quer títulos: o clube mais forte em que ainda joga, e nos eventos a opção de maior valor
 *               esperado (OVR, título, seleção, minutos) pelas probabilidades que o cartão mostra;
 *   cacador     a gananciosa com o plano das Taças do Rei: clube sul-americano que joga a Libertadores até ter 2,
 *               prioridade "copa internacional", seleção sempre (nunca se poupa nem se aposenta dela);
 *   oraculo     o caçador que "volta no tempo": prova cada opção (o motor é determinístico) e fica com a que deu mais
 *               Copas/Libertadores/OVR no período — o que faria quem copia o estado salvo ou roda o motor por fora.
 *
 * Políticas de alvo (para as conquistas que pedem uma carreira inteira montada para elas):
 *   mochileiro   um clube novo a cada decisão, de preferência de outro país e de outra confederação (Mochileiro,
 *                Dez escudos, Nômade, Cidadão do mundo);
 *   sulamericano um clube de um país sul-americano onde ainda não jogou (De Ushuaia a Darién);
 *   fiel         fica sempre no mesmo clube (Um clube só, Lenda do clube, Ídolo);
 *   europeu      campeão de liga em cada uma das cinco grandes (Dono da Europa).
 */
import type { CareerEngine } from '../../src/engine/api'
import { careerEngine } from '../../src/engine/career/default'
import { ACHIEVEMENTS } from '../../src/engine/career/achievements'
import { mem } from '../../src/engine/career/memory'
import { predictRole } from '../../src/engine/career/player'
import { clubConfed, clubStrength, indexData, nationStrength } from '../../src/engine/career/util'
import type { EffectSpec, OptionSpec } from '../../src/engine/career/events/types'
import { evaluateRun } from '../../src/engine/legacy'
import { rng } from '../../src/engine/rng'
import type { CareerState, Decision, GameData, Pace, PlayerIdentity, Position, SquadRole } from '../../src/engine/types'

export type Politica = 'aleatoria' | 'gananciosa' | 'cacador' | 'oraculo' | 'mochileiro' | 'sulamericano' | 'fiel' | 'europeu'

export interface Config {
  /** A semente como o navegador sorteia (crypto.getRandomValues(new Uint32Array(2))). */
  a0: number
  a1: number
  nat: string
  pos: Position
  pace: Pace
  pol: Politica
  bonus: number
}

export interface Pick {
  id: string
  kind: string
  idx: number
  pen: 'left' | 'center' | 'right' | null
  n: number
}

export interface Resultado {
  nat: string
  natFim: string
  pos: Position
  pace: Pace
  pol: Politica
  bonus: number
  a0: number
  a1: number
  copas: number
  /** Copas do Mundo que a seleção dele disputou convocado (o jogador estava na lista). */
  copasJogadas: number
  lib: number
  ucl: number
  bolas: number
  titulos: number
  pico: number
  nota: number
  gols: number
  jogos: number
  temporadas: number
  idadeFim: number
  motivo: string
  decisoes: number
  /** Campeões das Copas do Mundo disputadas durante a carreira (o mundo desta semente), em ordem. */
  wc: string[]
  /** Idades em que ele ganhou a Copa e a Libertadores. */
  idadesCopa: number[]
  idadesLib: number[]
  /** Índices em ACHIEVEMENTS das conquistas desta carreira. */
  conq: number[]
  /** Confederações distintas dos clubes (para "Nômade"). */
  confeds: number
  clubes: number
  paisesSul: number
  ms: number
  /** As escolhas (só nas carreiras raras, para repetir no navegador). */
  picks?: Pick[]
}

export const IDS_CONQUISTAS = ACHIEVEMENTS.map((a) => a.id)
export const CATALOGO = ACHIEVEMENTS.map((a) => ({ id: a.id, titulo: a.title, descricao: a.description, raridade: a.rarity, oculta: !!a.hidden }))
const IDX_CONQUISTA = new Map(IDS_CONQUISTAS.map((id, i) => [id, i]))

export const sementeDe = (a0: number, a1: number) => a0.toString(36) + a1.toString(36)

// ───────────────────────────── valor das opções ─────────────────────────────

const PAPEL: Record<SquadRole, number> = { starter: 4, high_rotation: 2, low_rotation: -4, substitute: -10, third_keeper: -14 }

interface Plano {
  pol: Politica
  /** Libertadores que ele ainda quer (o caçador). */
  querLib: boolean
  querCopa: boolean
}

function valorFx(data: GameData, s: CareerState, fx: EffectSpec, p: Plano): number {
  let v = 0
  if (fx.ovr) v += fx.ovr * 3
  if (fx.temp) v += fx.temp.delta * 0.6
  if (fx.roleOverride) v += fx.roleOverride === 'starter' ? 4 : fx.roleOverride === 'high_rotation' ? 1 : fx.roleOverride === 'low_rotation' ? -4 : -7
  if (fx.roleShift) v += fx.roleShift * 3
  if (fx.demoteRoleSeasons) v -= 5 * fx.demoteRoleSeasons
  if (fx.suspend) v -= 18
  if (fx.boost) v += fx.boost * 2
  if (fx.forceTrophy) {
    const k = fx.forceTrophy.kind
    const peso = k === 'world_cup' ? (p.querCopa ? 40 : 14) : k === 'continental_primary' ? (p.querLib ? 30 : 12) : 8
    v += fx.forceTrophy.win ? peso : -peso
  }
  if (fx.national === 'force') v += p.querCopa ? 10 : 4
  if (fx.national === 'skip') v -= p.querCopa ? 25 : 6
  if (fx.nationalBoost) v += fx.nationalBoost * (p.querCopa ? 4 : 1.5)
  if (fx.retireNational) v -= p.querCopa ? 40 : 4
  if (fx.declineFactor) v += (1 - fx.declineFactor) * 16
  if (fx.offerBoost) v += 2
  if (fx.superAgent) v += 1
  if (fx.statsMult) v += (fx.statsMult - 1) * 10
  if (fx.priority) v += fx.priority === 'continental' ? (p.querLib ? 4 : 1) : p.querLib ? -2 : 1
  if (fx.spotlightOff) v -= 6
  if (fx.switchNationality) {
    const a = nationStrength(data, s.world, s.identity.nationality)
    const b = nationStrength(data, s.world, fx.switchNationality)
    v += (b - a) * (p.querCopa ? 2.5 : 0.8)
  }
  if (fx.injury) v += fx.injury.ovrDelta * 2
  return v
}

/** Valor de jogar num clube (força × papel previsto) — o que o cartão mostra (clube, liga, papel). */
function valorClube(data: GameData, s: CareerState, clubId: string, p: Plano): number {
  const idx = indexData(data)
  const club = idx.club.get(clubId)
  if (!club) return -50
  const forca = clubStrength(s.world, club)
  const papel = predictRole(s.ovr, forca, s.identity.position)
  let v = forca + PAPEL[papel]
  if (p.querLib) {
    const sul = clubConfed(data, club) === 'CONMEBOL'
    const naLib = (s.world.qualified?.['conmebol.libertadores'] ?? []).includes(clubId)
    v += sul ? (naLib ? 12 : 3) : -10
  }
  return v
}

const BIG5 = new Set(['ESP', 'ENG', 'ITA', 'GER', 'FRA'])

/** Valor de um clube para as políticas de alvo (o clube de destino da opção, ou o atual quando fica). */
function valorAlvo(data: GameData, s: CareerState, clubId: string | undefined, ficar: boolean, pol: Politica): number {
  const idx = indexData(data)
  const club = clubId ? idx.club.get(clubId) : undefined
  if (!club) return ficar && pol === 'fiel' ? 50 : -30
  const forca = clubStrength(s.world, club)
  const papel = predictRole(s.ovr, forca, s.identity.position)
  const base = forca * 0.1 + PAPEL[papel] * 0.5
  const jogou = new Set(s.seasons.map((r) => r.clubId))
  const paises = new Set(s.seasons.map((r) => r.country))
  const confeds = new Set(s.seasons.map((r) => r.confed))
  const cf = clubConfed(data, club)
  if (pol === 'fiel') return (ficar ? 100 : 0) + base
  if (pol === 'mochileiro') return (jogou.has(club.id) ? -100 : 100) + (paises.has(club.country) ? 0 : 6) + (confeds.has(cf) ? 0 : 10) + base
  if (pol === 'sulamericano') {
    const paisesSul = new Set(s.seasons.filter((r) => r.confed === 'CONMEBOL').map((r) => r.country))
    return (cf === 'CONMEBOL' ? (paisesSul.has(club.country) ? 5 : 100) : -40) + (jogou.has(club.id) ? -3 : 0) + base
  }
  // europeu: liga das cinco grandes que ainda não ganhou, no clube mais forte (para ser campeão)
  const ganhas = new Set(s.seasons.filter((r) => r.trophies.some((t) => t.kind === 'league' && (t.tier ?? r.tier) === 1)).map((r) => r.country))
  const lg = idx.league.get(club.leagueId)
  const alvo = BIG5.has(club.country) && (lg?.tier ?? 1) === 1 && !ganhas.has(club.country)
  return (alvo ? 40 : BIG5.has(club.country) ? 5 : -20) + forca * 0.6 + PAPEL[papel]
}

const ALVO = new Set<Politica>(['mochileiro', 'sulamericano', 'fiel', 'europeu'])

function valorOpcao(data: GameData, s: CareerState, d: Decision, optId: string, p: Plano): number {
  const specs = (d.context?.specs ?? {}) as Record<string, OptionSpec>
  const spec = specs[optId]
  if (!spec) return -1e9
  if (spec.type === 'retire') return -1e6
  if (ALVO.has(p.pol)) {
    const temClube = !!spec.clubId && spec.type !== 'stay'
    let v = temClube ? valorAlvo(data, s, spec.clubId, false, p.pol) : valorAlvo(data, s, s.clubId ?? undefined, true, p.pol)
    for (const o of spec.outcomes) v += o.p * valorFx(data, s, o.fx, p) * 0.2
    return v
  }
  let v = 0
  if (spec.clubId && (spec.type === 'join' || spec.type === 'permanent' || spec.type === 'loan' || spec.type === 'stay')) v += valorClube(data, s, spec.clubId, p)
  else if (spec.type === 'stay' && s.clubId) v += valorClube(data, s, s.clubId, p)
  for (const o of spec.outcomes) v += o.p * valorFx(data, s, o.fx, p)
  return v
}

// ───────────────────────────── jogar ─────────────────────────────

function contaTrofeu(s: CareerState, f: (t: { kind?: string; confed?: string; minor?: boolean; trophyId: string }) => boolean) {
  let n = 0
  for (const r of s.seasons) for (const t of r.trophies) if (f(t)) n++
  return n
}
const copasDe = (s: CareerState) => contaTrofeu(s, (t) => t.trophyId === 'world-cup')
const libDe = (s: CareerState) => contaTrofeu(s, (t) => t.trophyId === 'libertadores')

function plano(pol: Politica, s: CareerState): Plano {
  if (pol === 'cacador' || pol === 'oraculo') return { pol, querLib: libDe(s) < 2 && s.age <= 34, querCopa: true }
  return { pol, querLib: false, querCopa: pol === 'gananciosa' }
}

/** O que o oráculo quer ver depois de um período: Copas e Libertadores primeiro, depois OVR e taças. */
function valorDepois(antes: CareerState, depois: CareerState, p: Plano): number {
  const dc = copasDe(depois) - copasDe(antes)
  const dl = libDe(depois) - libDe(antes)
  const titulos = depois.seasons.slice(antes.seasons.length).reduce((t, r) => t + r.trophies.filter((x) => !x.minor).length, 0)
  const naSelecao = depois.seasons.slice(antes.seasons.length).some((r) => !!r.national)
  return dc * 1000 + (p.querLib ? dl * 600 : dl * 50) + (depois.ovr - antes.ovr) * 12 + titulos * 6 + (naSelecao ? 8 : 0) + (depois.retired && depois.age < 40 ? -5000 : 0)
}

function escolher(engine: CareerEngine, data: GameData, s: CareerState, cfg: Config, step: number): string {
  const d = s.pendingDecision!
  const opts = d.options.filter((o) => !o.id.startsWith('retire-'))
  const r = rng(sementeDe(cfg.a0, cfg.a1), 'politica', cfg.pol, step)
  if (!opts.length) return d.options[0].id
  if (cfg.pol === 'aleatoria') return r.pick(opts).id
  // pênalti decisivo: os cantos têm a chance maior (o meio tem 5 pontos a menos)
  if (d.eventKey === 'decisive_penalty') {
    const cantos = opts.filter((o) => !o.id.endsWith('center'))
    return r.pick(cantos.length ? cantos : opts).id
  }
  const p = plano(cfg.pol, s)
  if (cfg.pol === 'oraculo' && opts.length > 1) {
    let melhor = opts[0].id
    let mv = -Infinity
    for (const o of opts) {
      const out = engine.choose(data, s, o.id).state
      const v = valorDepois(s, out, p) + valorOpcao(data, s, d, o.id, p) * 0.01 + r.next() * 1e-6
      if (v > mv) {
        mv = v
        melhor = o.id
      }
    }
    return melhor
  }
  let melhor = opts[0].id
  let mv = -Infinity
  for (const o of opts) {
    const v = valorOpcao(data, s, d, o.id, p) + r.next() * 0.01
    if (v > mv) {
      mv = v
      melhor = o.id
    }
  }
  return melhor
}

export function jogar(data: GameData, cfg: Config, guardarPicks = false): Resultado {
  const t0 = performance.now()
  const engine = careerEngine
  const seed = sementeDe(cfg.a0, cfg.a1)
  const identity: PlayerIdentity = { surname: 'Estudo', number: 10, foot: 'right', nationality: cfg.nat, position: cfg.pos }
  let s = cfg.bonus ? engine.newCareer(data, identity, cfg.pace, seed, { bonusOvr: cfg.bonus }) : engine.newCareer(data, identity, cfg.pace, seed)
  const picks: Pick[] = []
  for (let step = 0; step < 200 && !s.retired; step++) {
    const d = s.pendingDecision!
    const id = escolher(engine, data, s, cfg, step)
    const idx = d.options.findIndex((o) => o.id === id)
    const specs = (d.context?.specs ?? {}) as Record<string, OptionSpec>
    picks.push({ id, kind: d.kind, idx, pen: specs[id]?.penalty?.side ?? null, n: d.options.length })
    s = engine.choose(data, s, id).state
  }
  const sum = engine.summarize(data, s)
  const conta = (id: string) => sum.trophies.reduce((t, x) => t + (x.trophyId === id ? x.count : 0), 0)
  let nota = 0
  try {
    nota = evaluateRun({ id: s.id, identity: s.identity, seasons: s.seasons, national: s.national }, { finished: true }).score
  } catch {
    nota = -1
  }
  const copasJogadas = s.national.tournaments.filter((t) => t.competitionId === 'fifa.world').length
  const res: Resultado = {
    nat: cfg.nat,
    natFim: s.identity.nationality,
    pos: cfg.pos,
    pace: cfg.pace,
    pol: cfg.pol,
    bonus: cfg.bonus,
    a0: cfg.a0,
    a1: cfg.a1,
    copas: conta('world-cup'),
    copasJogadas,
    lib: conta('libertadores'),
    ucl: conta('champions-league'),
    bolas: sum.awards.reduce((t, x) => t + (x.award === 'ballon_dor' ? x.count : 0), 0),
    titulos: sum.trophies.reduce((t, x) => t + x.count, 0),
    pico: sum.peakOvr,
    nota: Math.round(nota * 10) / 10,
    gols: sum.totals.goals,
    jogos: sum.totals.apps,
    temporadas: s.seasons.length,
    idadeFim: s.age,
    motivo: s.retiredReason ?? '',
    decisoes: picks.length,
    wc: Object.keys(s.world.seasons)
      .map(Number)
      .sort((a, b) => a - b)
      .map((k) => s.world.seasons[k]?.national?.['fifa.world']?.winner)
      .filter((x): x is string => !!x),
    idadesCopa: s.seasons.flatMap((r) => r.trophies.filter((t) => t.trophyId === 'world-cup').map(() => r.age)),
    idadesLib: s.seasons.flatMap((r) => r.trophies.filter((t) => t.trophyId === 'libertadores').map(() => r.age)),
    conq: (s.achievements ?? []).map((id) => IDX_CONQUISTA.get(id) ?? -1).filter((i) => i >= 0),
    confeds: new Set(s.seasons.map((r) => r.confed).filter(Boolean)).size,
    clubes: new Set(s.seasons.map((r) => r.clubId)).size,
    paisesSul: new Set(s.seasons.filter((r) => r.confed === 'CONMEBOL').map((r) => r.country)).size,
    ms: Math.round(performance.now() - t0),
  }
  if (guardarPicks) res.picks = picks
  void mem
  return res
}
