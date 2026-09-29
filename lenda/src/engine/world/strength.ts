/**
 * Evolução anual de forças.
 *
 * Clube: s' = s + (0,3 + 0,2·g)·(âncora − s) + N(0; 1,4) + eventos; âncora = base + 1,5·(prestígio −
 *   prestígio inicial) + 0,6·(média da liga atual − média da liga de origem) + deriva de ligas ricas
 *   (ENG/KSA: +0,1/ano, até +2) + ciclo do clube (o negativo multiplicado por 1 − 0,9·g).
 *   - g (0–1): grau de gigante estrutural — prestígio acima da elite típica da liga de origem (média
 *     dos 6 maiores prestígios). Bayern 0,78, PSG 0,89, Porto/Benfica 0,83, Celtic/Rangers 1,
 *     Real/Barça 0,5, Dortmund 0,44, Inter/Juve/Milan 0,39; City/Arsenal 0,11, Flamengo/Palmeiras 0,22
 *     (ligas de muitos grandes seguem abertas). O gigante tem força estrutural, volta rápido à âncora
 *     e atravessa a fase ruim do ciclo quase sem tombo: perde uma liga aqui e ali, não uma década.
 *   - base: força inicial real + 2,2·g; só quem sobra mais de 4,5 pontos sobre o 2º da liga de origem
 *     tem o excedente comprimido (10% ficam) — nos dados reais, só o PSG (88 → ~85 contra 78).
 *     Bayern 87 → ~89 (Dortmund 84), Real/Barça ~89/88 (Atlético 85), Porto/Benfica ~82/81.
 *   - ciclo: projeto esportivo de cada clube (técnico, gestão, investidor, geração da base), um
 *     ruído suave e sem estado — nós N(0; 2) (limitados a ±2σ) a cada 7 temporadas, com fase
 *     aleatória por clube e interpolação cossenoidal. Cria eras de desafiantes (o Dortmund campeão
 *     de vez em quando, um Leverkusen raro) que o gigante logo encerra.
 *   Eventos: campeão +0,3; campeão continental principal +0,5; rebaixado −1,0; promovido +0,8
 *   (pequenos de propósito: evitam dinastias eternas por realimentação). Desgaste de dinastia: quem
 *   ganhou mais de 2 das últimas 5 ligas (torneio anual) perde 1,4·(1 − g) por título além do 2º,
 *   todo ano — o campeão emergente é desmontado, o gigante segura o elenco.
 *   Calibrado em 30 temporadas × 48 seeds (dados reais de hoje): Bayern 70% das Bundesligas (pior
 *   seed 50%; jejum máximo ≤ 4 temporadas em 43 de 48 seeds, nunca > 6), PSG 68%, Real 40% + Barça
 *   37% (Atlético 16%), Porto+Benfica+Sporting 97%, PSV+Ajax+Feyenoord 94%, Celtic+Rangers 97%;
 *   líder da Premier ~34% (big six + Newcastle/Villa 89%), da Serie A ~35% (Inter/Juve/Milan/Napoli
 *   73%); Brasil 7–13 campeões, Argentina 8–18; Champions sem dono (nenhum clube > 12%).
 *   A 1ª temporada usa a força real inicial (continua a tabela de hoje); tudo isso vale da 2ª em diante.
 * Prestígio (0–5): volta devagar ao inicial (5%/ano), +0,08 por liga, +0,15 por continental, −0,2 se cair.
 * Seleção: n' = n + 0,15·(âncora − n) + N(0; 0,9) − custo dos títulos − desgaste; âncora = base (a força
 *   inicial, com a sobra do líder da confederação sobre a 2ª comprimida) + 25% da variação da média do
 *   top-5 de craques daquela nacionalidade + ciclo de geração (nós a cada 8 anos).
 *   Custo do título (Copa/Euro/Copa América/Copa da Ásia −1,5; Copa Ouro/CAN −0,7), mais −1,5·k(k+1)/2
 *   se a seleção ganhou k das 2 edições anteriores da mesma competição (bi, tri). Desgaste: −0,6 por
 *   ano por título grande das últimas 8 temporadas (bienais valem metade; a OFC não conta, e o líder
 *   da Oceania não é comprimido — a Nova Zelândia segue dona da vaga). Antes, +0,8 por título
 *   realimentava dinastias (Noruega com 4 Euros em 5; ARG-ARG-ARG-ARG na Copa).
 *   Calibrado em 30 temporadas × 24 seeds: ninguém passa de 30% das Copas/Euros nem de 40% das Copas
 *   Américas; ESP/FRA/ENG/ARG/BRA/POR/GER vencem; sequência máxima de 2 Copas/Euros.
 * Limites: clubes 40–92, seleções 40–95. O reforço do jogador NÃO entra aqui (vale só na temporada).
 */
import type { ClubDynamic, GameData, Rival, SeasonWorldResult } from '../types'
import { clamp, rng as subRng } from '../rng'
import type { DataIndex } from './context'

const MONEY_LEAGUES = new Set(['ENG', 'KSA'])

/** Parâmetros do equilíbrio de longo prazo (exportados para calibração). */
export const EVOLVE = {
  /** Vantagem sobre o 2º mais forte da liga de origem mantida integralmente. */
  freeGap: 4.5,
  /** Fração mantida do excedente acima de `freeGap` (só o PSG passa disso nos dados reais). */
  gapKeep: 0.1,
  /** Desvio dos nós do ciclo do clube. */
  cycleSd: 2,
  /** Temporadas entre nós do ciclo. */
  cycleLen: 7,
  /** Fração do caminho até a âncora percorrida por ano (clube comum). */
  pull: 0.3,
  /** Atração extra do gigante estrutural pleno (g = 1): o dinheiro recompõe o elenco rápido. */
  giantPull: 0.2,
  /** Fração do ciclo NEGATIVO absorvida pelo gigante estrutural pleno (g = 1). */
  giantDamp: 0.9,
  /** Força estrutural somada à base do gigante pleno (g = 1, pelo prestígio inicial). */
  giantBonus: 2.2,
  /** Pontos de prestígio acima da média dos 6 maiores prestígios da liga para g = 1. */
  giantSpan: 1.5,
  /**
   * Desgaste de dinastia: janela (temporadas) e perda anual por título acima de `fatigueFree` nela,
   * multiplicada por (1 − g) — o emergente campeão é desmontado; o gigante segura o elenco.
   */
  fatigueWindow: 5,
  fatigueFree: 2,
  fatigue: 1.4,
  /** Ruído anual da força (entressafra: contratações, lesões longas). */
  noise: 1.4,
}

/**
 * Grau de gigante estrutural (0–1): quanto o clube é maior (prestígio: receita, torcida, poder de
 * contratação) que a elite típica da sua liga de origem (média dos 6 maiores prestígios), em
 * unidades de `giantSpan`. Plenos ou quase: PSG, Celtic/Rangers, Porto/Benfica, Ajax, Bayern (0,78);
 * meio-gigantes: Real/Barça (0,5), Dortmund (0,44), Inter/Juve/Milan (0,39); na Premier League e no
 * Brasileirão, com muitos grandes do mesmo tamanho, quase ninguém (≤ 0,22).
 */
export function giantness(ix: DataIndex, clubId: string, prestige: number): number {
  const c = ix.club.get(clubId)
  const ref = c && contenderRef(ix).get(c.leagueId)
  if (!ref) return 0
  return clamp((prestige - ref.prestige) / EVOLVE.giantSpan, 0, 1)
}

interface LeagueRef {
  /** 2ª maior força inicial (o primeiro perseguidor). */
  strength: number
  /** Média dos 6 maiores prestígios iniciais (a elite típica da liga). */
  prestige: number
}

const contenders = new WeakMap<DataIndex, Map<string, LeagueRef>>()

/** Referências de cada 1ª divisão na liga de origem (forças e prestígios iniciais). */
function contenderRef(ix: DataIndex): Map<string, LeagueRef> {
  const hit = contenders.get(ix)
  if (hit) return hit
  const by = new Map<string, { s: number[]; p: number[] }>()
  for (const c of ix.club.values()) {
    const l = by.get(c.leagueId)
    if (l) {
      l.s.push(c.strength)
      l.p.push(c.prestige)
    } else by.set(c.leagueId, { s: [c.strength], p: [c.prestige] })
  }
  const out = new Map<string, LeagueRef>()
  for (const [id, { s, p }] of by) {
    if (ix.league.get(id)?.tier !== 1 || s.length < 6) continue
    s.sort((a, b) => b - a)
    p.sort((a, b) => b - a)
    out.set(id, { strength: s[1], prestige: (p[0] + p[1] + p[2] + p[3] + p[4] + p[5]) / 6 })
  }
  contenders.set(ix, out)
  return out
}

/**
 * Força-base de longo prazo: a real (com a sobra de mais de `freeGap` sobre o 2º da liga de origem
 * comprimida) + a força estrutural do gigante (`giantBonus`·g).
 */
export function baseStrength(ix: DataIndex, clubId: string): number {
  const c = ix.club.get(clubId)
  if (!c) return 60
  const ref = contenderRef(ix).get(c.leagueId)
  if (ref === undefined) return c.strength
  const bonus = EVOLVE.giantBonus * giantness(ix, clubId, c.prestige)
  const excess = c.strength - ref.strength - EVOLVE.freeGap
  return (excess > 0 ? ref.strength + EVOLVE.freeGap + excess * EVOLVE.gapKeep : c.strength) + bonus
}

/** Ciclo suave e sem estado (média 0): nós N(0; sd) limitados a ±2σ a cada `len` temporadas, fase aleatória por chave. */
function smoothCycle(seed: string, key: string, season: number, ref: number, sd: number, len: number): number {
  if (sd <= 0) return 0
  const phase = subRng(seed, 'cycle', key).next() * len
  const t = (season - ref + phase) / len
  const k = Math.floor(t)
  const f = (1 - Math.cos(Math.PI * (t - k))) / 2
  const lim = 2 * sd
  const a = clamp(subRng(seed, 'cycle', key, k).normal(0, sd), -lim, lim)
  const b = clamp(subRng(seed, 'cycle', key, k + 1).normal(0, sd), -lim, lim)
  return a + (b - a) * f
}

/** Ciclo do clube na temporada (média 0): ruído suave por clube, sem estado. */
export function clubCycle(seed: string, clubId: string, season: number, firstSeason: number): number {
  return smoothCycle(seed, clubId, season, firstSeason, EVOLVE.cycleSd, EVOLVE.cycleLen)
}

/** Ciclo de geração da seleção (média 0): safras de craques que vêm e vão. */
export function nationCycle(seed: string, code: string, season: number): number {
  return smoothCycle(seed, `nat:${code}`, season, 2000, EVOLVE_NAT.cycleSd, EVOLVE_NAT.cycleLen)
}

export function clubAnchor(ix: DataIndex, clubId: string, dyn: ClubDynamic, season: number, seed?: string): number {
  const c = ix.club.get(clubId)
  if (!c) return dyn.strength
  const homeMean = ix.leagueMean.get(c.leagueId) ?? c.strength
  const curMean = ix.leagueMean.get(dyn.leagueId) ?? homeMean
  let a = baseStrength(ix, clubId) + 1.5 * (dyn.prestige - c.prestige) + 0.6 * (curMean - homeMean)
  const lg = ix.league.get(dyn.leagueId)
  if (lg && lg.tier === 1 && MONEY_LEAGUES.has(lg.country)) a += 0.1 * Math.min(20, Math.max(0, season - ix.firstSeason))
  if (seed !== undefined) {
    const cyc = clubCycle(seed, clubId, season, ix.firstSeason)
    // o gigante atravessa a fase ruim com metade do tombo: vende caro, contrata logo
    a += cyc < 0 ? cyc * (1 - EVOLVE.giantDamp * giantness(ix, clubId, dyn.prestige)) : cyc
  }
  return a
}

export function evolveClubs(
  data: GameData,
  ix: DataIndex,
  seed: string,
  clubs: Record<string, ClubDynamic>,
  result: SeasonWorldResult,
  moves: Map<string, string>,
  past: Readonly<Record<number, SeasonWorldResult>> = {},
): Record<string, ClubDynamic> {
  const season = result.season
  const rng = subRng(seed, 'season', season, 'evolve')
  const champs = new Set<string>()
  const promoted = new Set<string>()
  const relegated = new Set<string>()
  for (const l of Object.values(result.leagues)) {
    const lg = ix.league.get(l.leagueId)
    if (lg && lg.tier === 1) {
      champs.add(l.champion)
      for (const c of l.champions ?? []) champs.add(c.clubId)
    }
    for (const c of l.promoted) promoted.add(c)
    for (const c of l.relegated) relegated.add(c)
  }
  // títulos de 1ª divisão na janela recente (esta temporada inclusa): base do desgaste de dinastia
  const recent = new Map<string, number>()
  for (let s = season; s > season - EVOLVE.fatigueWindow; s--) {
    const r = s === season ? result : past[s]
    if (!r) continue
    for (const l of Object.values(r.leagues)) {
      if (ix.league.get(l.leagueId)?.tier !== 1 || l.champions?.length) continue
      recent.set(l.champion, (recent.get(l.champion) ?? 0) + 1)
    }
  }
  const continental = new Set<string>()
  for (const cf of Object.values(ix.confed)) {
    const w = cf.primary && result.cups[cf.primary.id]?.winner
    if (w) continental.add(w)
  }
  const out: Record<string, ClubDynamic> = {}
  for (const c of data.clubs) {
    const cur = clubs[c.id]
    if (!cur) continue
    const leagueId = moves.get(c.id) ?? cur.leagueId
    let prestige = cur.prestige + (c.prestige - cur.prestige) * 0.05 + rng.normal(0, 0.04)
    if (champs.has(c.id)) prestige += 0.08
    if (continental.has(c.id)) prestige += 0.15
    if (relegated.has(c.id)) prestige -= 0.2
    prestige = clamp(prestige, 0, 5)
    const next: ClubDynamic = { strength: cur.strength, leagueId, prestige: Math.round(prestige * 100) / 100 }
    const anchor = clubAnchor(ix, c.id, next, season + 1, seed)
    const g = giantness(ix, c.id, prestige)
    const pull = EVOLVE.pull + EVOLVE.giantPull * g
    let s = cur.strength + (anchor - cur.strength) * pull + rng.normal(0, EVOLVE.noise)
    if (champs.has(c.id)) s += 0.3
    if (continental.has(c.id)) s += 0.5
    if (relegated.has(c.id)) s -= 1.0
    if (promoted.has(c.id)) s += 0.8
    // desgaste de dinastia: craques vendidos, rivais contratam os destaques (o gigante resiste)
    const run = (recent.get(c.id) ?? 0) - EVOLVE.fatigueFree
    if (run > 0) s -= EVOLVE.fatigue * run * (1 - g)
    next.strength = Math.round(clamp(s, 40, 92) * 10) / 10
    out[c.id] = next
  }
  return out
}

/** Média dos 5 melhores OVR por nacionalidade. */
export function topTalent(rivals: readonly { nationality: string; ovr: number; retired?: boolean }[]): Map<string, number> {
  const by = new Map<string, number[]>()
  for (const r of rivals) {
    if (r.retired) continue
    const l = by.get(r.nationality)
    if (l) l.push(r.ovr)
    else by.set(r.nationality, [r.ovr])
  }
  const out = new Map<string, number>()
  for (const [k, l] of by) {
    l.sort((a, b) => b - a)
    const top = l.slice(0, 5)
    // quem tem menos de 5 craques completa com 72 (nível de seleção comum)
    while (top.length < 5) top.push(72)
    out.set(k, top.reduce((s, x) => s + x, 0) / 5)
  }
  return out
}

/** Parâmetros da evolução das seleções (exportados para calibração). */
export const EVOLVE_NAT = {
  /** Fração do caminho até a âncora percorrida por ano. */
  pull: 0.15,
  /** Ruído anual. */
  noise: 0.9,
  /**
   * Custo de um título (Copa do Mundo e continentais quadrienais): a geração campeã envelhece, o
   * técnico sai, os rivais estudam o time. Recupera-se pela atração da âncora (15%/ano), então
   * funciona como um desgaste que soma os títulos recentes — duas conquistas seguidas pesam o dobro.
   */
  titleCost: 1.5,
  /** Custo de um título bienal (Copa Ouro, Copa Africana). */
  minorCost: 0.7,
  /**
   * Desgaste de sequência: com k títulos da mesma competição nas `streakEditions` edições anteriores,
   * o título de agora custa mais `streakCost`·k(k+1)/2 (bi em 3 edições: +1×; tri: +3×; bienais: 60%).
   * Evita as eras ARG-ARG-ARG-ARG e as Euros em série de uma seleção de 85.
   */
  streakCost: 1.5,
  streakEditions: 2,
  /**
   * Desgaste de dinastia (como nos clubes): cada título grande (Copa e continentais quadrienais; bienais
   * valem metade) das últimas `fatigueYears` temporadas, acima de `fatigueFree`, tira `fatigue` por ano
   * — a geração campeã é caçada, envelhece junta e o ciclo seguinte demora a vir ("maldição do campeão").
   */
  fatigueYears: 8,
  fatigueFree: 0,
  fatigue: 0.6,
  /** Ciclo de geração: desvio dos nós e temporadas entre nós. */
  cycleSd: 2,
  cycleLen: 8,
  /** Vantagem do líder da confederação sobre a 2ª seleção mantida integralmente, e fração do excedente. */
  freeGap: 1.5,
  gapKeep: 0.35,
}

const confedSecond = new WeakMap<GameData, Map<string, number>>()

/** Força-base de longo prazo da seleção: a real, com a sobra do líder da confederação sobre a 2ª comprimida. */
export function nationBase(data: GameData, code: string): number {
  let ref = confedSecond.get(data)
  if (!ref) {
    const by = new Map<string, number[]>()
    for (const c of data.countries) {
      const l = by.get(c.confed)
      if (l) l.push(c.strength)
      else by.set(c.confed, [c.strength])
    }
    ref = new Map()
    for (const [cf, l] of by) if (l.length >= 2) ref.set(cf, l.sort((a, b) => b - a)[1])
    confedSecond.set(data, ref)
  }
  const c = data.countries.find((x) => x.code === code)
  if (!c) return 60
  const second = ref.get(c.confed)
  // Oceania: a Nova Zelândia (64) contra seleções de ~50 é a realidade, não um desequilíbrio a corrigir
  if (second === undefined || c.confed === 'OFC') return c.strength
  const excess = c.strength - second - EVOLVE_NAT.freeGap
  return excess > 0 ? second + EVOLVE_NAT.freeGap + excess * EVOLVE_NAT.gapKeep : c.strength
}

/**
 * Peso de um título de seleções no desgaste: 1 para a Copa e os continentais quadrienais, 0,5 para os
 * bienais (Copa Ouro, CAN) e 0 na Oceania — a Nova Zelândia domina a OFC na vida real, sem rival que
 * a "cace"; desgastá-la só entregaria a vaga da Copa a seleções de 50.
 */
function titleWeight(comp: GameData['competitions'][number] | undefined): number {
  if (!comp || comp.confed === 'OFC') return 0
  return comp.schedule && comp.schedule.every > 0 && comp.schedule.every < 4 ? 0.5 : 1
}

export function evolveNations(
  data: GameData,
  seed: string,
  season: number,
  nations: Record<string, number>,
  result: SeasonWorldResult,
  initialTalent: Map<string, number>,
  rivals: readonly Rival[],
  past: Readonly<Record<number, SeasonWorldResult>> = {},
): Record<string, number> {
  const rng = subRng(seed, 'season', season, 'nations-evolve')
  const talent = topTalent(rivals)
  const cost = new Map<string, number>()
  for (const t of Object.values(result.national)) {
    if (!t.winner) continue
    const comp = data.competitions.find((c) => c.id === t.competitionId)
    const w = titleWeight(comp)
    if (!w) continue
    const every = comp?.schedule && comp.schedule.every > 0 ? comp.schedule.every : 4
    let c = w < 1 ? EVOLVE_NAT.minorCost : EVOLVE_NAT.titleCost
    // sequência: títulos da mesma competição nas edições anteriores
    let prior = 0
    for (let k = 1; k <= EVOLVE_NAT.streakEditions; k++) if (past[season - k * every]?.national?.[t.competitionId]?.winner === t.winner) prior++
    c += ((prior * (prior + 1)) / 2) * EVOLVE_NAT.streakCost * (w < 1 ? 0.6 : 1)
    cost.set(t.winner, (cost.get(t.winner) ?? 0) + c)
  }
  // títulos recentes (esta temporada inclusa) para o desgaste de dinastia
  const recent = new Map<string, number>()
  for (let s = season; s > season - EVOLVE_NAT.fatigueYears; s--) {
    const r = s === season ? result : past[s]
    if (!r?.national) continue
    for (const t of Object.values(r.national)) {
      const w = t.winner ? titleWeight(data.competitions.find((c) => c.id === t.competitionId)) : 0
      if (w) recent.set(t.winner, (recent.get(t.winner) ?? 0) + w)
    }
  }
  const out: Record<string, number> = {}
  for (const c of data.countries) {
    const cur = nations[c.code] ?? c.strength
    const dt = (talent.get(c.code) ?? 72) - (initialTalent.get(c.code) ?? 72)
    const anchor = nationBase(data, c.code) + clamp(dt * 0.25, -4, 4) + nationCycle(seed, c.code, season + 1)
    let n = cur + (anchor - cur) * EVOLVE_NAT.pull + rng.normal(0, EVOLVE_NAT.noise)
    n -= cost.get(c.code) ?? 0
    // desgaste de dinastia: cada título recente pesa um pouco todo ano
    const run = (recent.get(c.code) ?? 0) - EVOLVE_NAT.fatigueFree
    if (run > 0) n -= EVOLVE_NAT.fatigue * run
    out[c.code] = Math.round(clamp(n, 40, 95) * 10) / 10
  }
  return out
}
