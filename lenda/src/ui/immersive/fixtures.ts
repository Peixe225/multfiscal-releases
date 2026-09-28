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

const IDENTITY: PlayerIdentity = { surname: 'RIBEIRO', number: 9, foot: 'right', nationality: 'BRA', position: 'CA' }
const SEED = 'lenda-imersivo-demo'

interface Run {
  s: ImmersiveState
  fx: ImmersiveEffect[]
  lastMatch?: LiveMatch
}

export function buildFixture(engine: ImmersiveEngine, data: GameData, name: string): { state: ImmersiveState; lastMatch?: LiveMatch | null; effects?: ImmersiveEffect[] } {
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
  const toMatch = (opts: { starter?: boolean } = {}) => {
    // procura um jogo com o status pedido (titular/banco); senão aceita qualquer um em que você jogue
    let fallback: ImmersiveState | null = null
    for (let tries = 0; tries < 24; tries++) {
      until((_s, it) => it?.kind === 'match')
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
  const craft = (patch: Partial<KeyMoment>) => {
    const l = simUntil((x) => !!x.pendingMoment && !x.pendingMoment.minigame)
    if (!l?.pendingMoment) return
    const km = { ...l.pendingMoment, ...patch }
    run.s = { ...run.s, live: { ...l, pendingMoment: km } }
    run.fx = [{ type: 'key_moment', moment: km }]
  }

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
    case 'penalti': {
      toMatch({ starter: true })
      const l = run.s.live
      craft({
        situation: 'penalty',
        minigame: 'penalty_kick',
        timeLimitMs: 12000,
        description: `PÊNALTI! Você pega a bola e ajeita na marca. A torcida prende a respiração.`,
        at: { x: l?.userSide === 'away' ? 11 : 89, y: 50 },
        options: [
          { id: 'left', label: 'Canto esquerdo', detail: 'FIN · colocado', chance: 0.68, icon: 'arrow-left' },
          { id: 'center', label: 'Meio (cavadinha)', detail: 'Frieza · alto risco', chance: 0.58, icon: 'arrow-up', risk: 'Vira meme se errar' },
          { id: 'right', label: 'Canto direito', detail: 'FIN · forte', chance: 0.68, icon: 'arrow-right' },
        ],
      })
      break
    }
    case 'timing':
      toMatch({ starter: true })
      craft({ minigame: 'timing' })
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
      // balanço com uma taça (a demo termina em 9º): injeta o título da liga para a celebração
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
  return { state: run.s, lastMatch: run.lastMatch ?? null, effects: run.fx }
}
