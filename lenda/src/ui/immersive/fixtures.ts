/**
 * Modo Imersivo — estados de exemplo (dev / screenshots): #/imersivo?fixture=<nome>.
 * Construídos rodando o MOTOR ATIVO (mock ou real) só com ações do contrato, a partir de uma
 * carreira determinística. Nunca são salvos.
 *
 *   central · treino · decisao · coletiva · mercado · negociacao · social · pre · banco · ao-vivo ·
 *   lance · penalti · timing · intervalo · fim · temporada · gala · carreira
 */
import type { CalendarItem, ImmersiveAction, ImmersiveEffect, ImmersiveEngine, ImmersiveState, KeyMoment, LiveMatch } from '@/engine/immersive/types'
import type { GameData, PlayerIdentity } from '@/engine/types'

export const FIXTURES = ['central', 'treino', 'decisao', 'coletiva', 'mercado', 'negociacao', 'social', 'pre', 'banco', 'ao-vivo', 'lance', 'penalti', 'timing', 'intervalo', 'fim', 'temporada', 'campeao', 'gala', 'carreira'] as const
export type FixtureName = (typeof FIXTURES)[number]

const IDENTITY: PlayerIdentity = { surname: 'Ribeiro', number: 9, foot: 'right', nationality: 'BRA', position: 'CA' }
const SEED = 'lenda-imersivo-demo'

interface Run {
  s: ImmersiveState
  fx: ImmersiveEffect[]
  lastMatch?: LiveMatch
}

export function buildFixture(engine: ImmersiveEngine, data: GameData, name: string): { state: ImmersiveState; lastMatch?: LiveMatch | null; effects?: ImmersiveEffect[]; warning?: string } {
  const run: Run = { s: engine.newCareer(data, IDENTITY, SEED), fx: [] }
  const d = (a: ImmersiveAction) => {
    const before = run.s
    const r = engine.dispatch(data, run.s, a)
    if (before.live && !r.state.live) run.lastMatch = before.live
    run.s = r.state
    run.fx = r.effects
    return run.s
  }
  const cur = () => engine.nextItem(run.s)
  /** Um passo "automático" (fixtures longas): resolve o que estiver pendente. */
  const step = () => {
    const s = run.s
    if (s.live) return d({ type: s.live.phase === 'pre' ? 'match_start' : 'match_finish' })
    if (s.press?.length) return d({ type: 'press_answer', questionId: s.press[0].id, answerId: s.press[0].answers[0].id })
    if (s.pendingDecision) return d({ type: 'decision_choose', optionId: s.pendingDecision.options[0].id })
    const it = cur()
    if (!it) return s
    if (it.kind === 'training') return d({ type: 'train', focus: s.identity.position === 'GOL' ? 'goalkeeping' : 'finishing', intensity: 'normal' })
    return d({ type: 'advance' })
  }
  const until = (pred: (s: ImmersiveState, it: CalendarItem | null) => boolean, max = 600) => {
    for (let i = 0; i < max && !pred(run.s, cur()); i++) {
      const before = run.s
      step()
      if (before === run.s && !run.s.live) break
    }
    return run.s
  }
  /**
   * Titular garantido para as telas de partida: técnico, fase, energia e atributos acima da força do
   * elenco (só nos estados de exemplo — o jogo de verdade nunca faz isso).
   */
  const boostStarter = () => {
    const s = run.s
    if (!s.clubId) return
    const team = (s.world?.clubs?.[s.clubId]?.strength as number | undefined) ?? data.clubs.find((c) => c.id === s.clubId)?.strength ?? 70
    const target = Math.min(90, Math.round(team + 9))
    const attrs = { ...(s.attributes as unknown as Record<string, number>) }
    for (const k of Object.keys(attrs)) attrs[k] = Math.max(attrs[k], target)
    s.attributes = attrs as unknown as ImmersiveState['attributes']
    s.ovr = engine.ovrOf(s.attributes, s.identity.position)
    s.relationships = { ...s.relationships, coach: 100 }
    s.condition = { ...s.condition, fitness: 100, form: 85, sharpness: 90, injury: undefined, suspendedMatches: 0 }
  }
  const toMatch = (opts: { starter?: boolean } = {}) => {
    // procura um jogo com o status pedido (titular/banco); senão aceita qualquer um em que você jogue
    let fallback: ImmersiveState | null = null
    for (let tries = 0; tries < 24; tries++) {
      until((_s, it) => it?.kind === 'match')
      if (opts.starter) boostStarter()
      d({ type: 'advance' })
      const live = run.s.live
      if (!live) break
      const want = opts.starter === undefined ? live.userStatus !== 'out' : opts.starter ? live.userStatus === 'starter' : live.userStatus === 'bench'
      if (want) return live
      if (!fallback && live.userStatus !== 'out') fallback = run.s
      d({ type: 'match_start' })
      d({ type: 'match_finish' })
    }
    if (fallback) run.s = fallback
    return run.s.live
  }
  const simUntil = (pred: (l: LiveMatch) => boolean, choose = true) => {
    for (let i = 0; i < 40; i++) {
      const l = run.s.live
      if (!l || pred(l)) return l
      if (l.pendingMoment) {
        if (!choose) return l
        d({ type: 'match_choose', optionId: l.pendingMoment.options[0].id })
      } else d({ type: l.phase === 'pre' ? 'match_start' : 'match_sim' })
    }
    return run.s.live
  }
  /**
   * Força o PRÓXIMO lance planejado pelo motor a ser da situação pedida (pênalti, falta → barra de
   * precisão): o próprio motor monta o lance, com os ids e a memória dele (nada de lance "de mentira").
   */
  const forceNext = (situation: KeyMoment['situation'], minigame: KeyMoment['minigame']) => {
    const l = run.s.live
    if (!l) return false
    const eng = run.s.engine as { live?: { plan?: { minute: number; situation: string }[] }; plan?: { moments?: { minute: number; situation: string; minigame?: string }[] } }
    const plan = eng.live?.plan ?? eng.plan?.moments
    if (!plan?.length) return false
    const next = plan.find((p) => p.minute > l.minute) ?? plan[plan.length - 1]
    next.situation = situation
    if ('minigame' in next || eng.plan) (next as { minigame?: string }).minigame = minigame
    return true
  }
  const toMoment = (situation: KeyMoment['situation'], minigame: KeyMoment['minigame']) => {
    toMatch({ starter: true })
    if (run.s.live?.phase === 'pre') d({ type: 'match_start' })
    forceNext(situation, minigame)
    simUntil((x) => !!x.pendingMoment, false)
  }
  const craft = (patch: Partial<KeyMoment>) => {
    const l = simUntil((x) => !!x.pendingMoment && !x.pendingMoment.minigame)
    if (!l?.pendingMoment) return
    const km = { ...l.pendingMoment, ...patch }
    run.s = { ...run.s, live: { ...l, pendingMoment: km } }
    run.fx = [{ type: 'key_moment', moment: km }]
  }
  void craft

  switch (name as FixtureName) {
    case 'treino':
      until((_s, it) => it?.kind === 'training' && it.week >= 1)
      break
    case 'decisao':
      until((s) => !!s.pendingDecision)
      break
    case 'coletiva':
      until((_s, it) => it?.kind === 'press')
      d({ type: 'advance' })
      break
    case 'mercado':
    case 'negociacao':
      until((s, it) => it?.kind === 'transfer_window' && s.offers.length > 0)
      break
    case 'social':
      until((s) => s.seasonStats.goals > 0 || s.seasonStats.apps >= 3)
      until((_s, it) => it?.kind === 'training')
      break
    case 'pre':
      until((_s, it) => it?.kind === 'match')
      d({ type: 'advance' })
      break
    case 'banco':
      toMatch({ starter: false })
      break
    case 'ao-vivo':
      toMatch({ starter: true })
      simUntil((l) => l.phase === 'second_half' && !l.pendingMoment)
      break
    case 'lance':
      toMatch({ starter: true })
      simUntil((l) => !!l.pendingMoment && !l.pendingMoment.minigame, false)
      break
    case 'penalti':
      toMoment(IDENTITY.position === 'GOL' ? 'penalty_save' : 'penalty', IDENTITY.position === 'GOL' ? 'penalty_save' : 'penalty_kick')
      break
    case 'timing':
      toMoment('free_kick', 'timing')
      break
    case 'intervalo':
      toMatch({ starter: true })
      simUntil((l) => l.phase === 'half_time')
      break
    case 'fim':
      toMatch({ starter: true })
      simUntil((l) => l.phase === 'full_time')
      break
    case 'temporada':
    case 'gala':
      until((_s, it) => it?.kind === 'season_end')
      d({ type: 'advance' })
      break
    case 'campeao': {
      // balanço com uma taça (a demo termina no meio da tabela): injeta o título da liga para a celebração
      until((_s, it) => it?.kind === 'season_end')
      d({ type: 'advance' })
      const s = structuredClone(run.s)
      const rec = s.seasons[s.seasons.length - 1]
      const league = data.leagues.find((l) => l.id === rec?.leagueId)
      if (rec && league && s.clubId) {
        const tw = { trophyId: league.trophyId, competitionId: league.id, season: rec.season, teamId: s.clubId, scope: 'club' as const, kind: 'league' as const, tier: league.tier }
        rec.trophies = [tw, ...rec.trophies]
        rec.leaguePosition = 1
        s.trophies = [tw, ...s.trophies]
        // a tabela final concorda com o título (mesma fonte do selo de posição)
        const table = s.world.seasons?.[rec.season]?.leagues?.[rec.leagueId]?.table
        if (table?.length) {
          const i = table.findIndex((r) => r.clubId === s.clubId)
          if (i > 0) {
            const [me] = table.splice(i, 1)
            me.points = Math.max(me.points, table[0].points + 3)
            table.unshift(me)
          }
        }
      }
      run.s = s
      break
    }
    case 'carreira':
      for (let k = 0; k < 2; k++) {
        until((_s, it) => it?.kind === 'awards')
        d({ type: 'advance' })
      }
      until((_s, it) => it?.kind === 'training' && it.week >= 1)
      break
    case 'central':
    default:
      until((_s, it) => it?.kind === 'match' && it.week >= 1)
      break
  }
  return { state: run.s, lastMatch: run.lastMatch ?? null, effects: run.fx, warning: check(name as FixtureName, run.s) }
}

/** O estado de exemplo chegou onde devia? Senão, avisa (em vez de mostrar outra tela em silêncio). */
function check(name: FixtureName, s: ImmersiveState): string | undefined {
  const l = s.live
  const want: Partial<Record<FixtureName, [boolean, string]>> = {
    pre: [l?.phase === 'pre', 'pré-jogo'],
    banco: [l?.userStatus === 'bench', 'começar no banco'],
    'ao-vivo': [!!l && l.phase !== 'full_time' && l.phase !== 'pre', 'partida em andamento'],
    lance: [!!l?.pendingMoment && !l.pendingMoment.minigame, 'lance decisivo'],
    penalti: [!!l?.pendingMoment && (l.pendingMoment.minigame === 'penalty_kick' || l.pendingMoment.minigame === 'penalty_save'), 'pênalti'],
    timing: [l?.pendingMoment?.minigame === 'timing', 'barra de precisão'],
    intervalo: [l?.phase === 'half_time', 'intervalo'],
    fim: [l?.phase === 'full_time', 'fim de jogo'],
    coletiva: [!!s.press?.length, 'coletiva'],
    decisao: [!!s.pendingDecision, 'decisão'],
    mercado: [s.offers.length > 0, 'propostas'],
    negociacao: [s.offers.length > 0, 'propostas'],
    temporada: [s.seasons.length > 0, 'temporada encerrada'],
    gala: [s.seasons.length > 0, 'temporada encerrada'],
  }
  const w = want[name]
  return w && !w[0] ? `Estado de exemplo "${name}" incompleto: o motor não chegou a ${w[1]}.` : undefined
}
