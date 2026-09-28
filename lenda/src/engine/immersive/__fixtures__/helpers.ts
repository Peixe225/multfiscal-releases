/** Helpers dos testes do Modo Imersivo (dados reais quando existirem). */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { GameData, PlayerIdentity, Position } from '../../types'
import { createImmersiveEngine } from '../index'
import type { ImmersiveAction, ImmersiveEffect, ImmersiveState } from '../types'

const path = fileURLToPath(new URL('../../../data/generated/game-data.json', import.meta.url))
export const hasRealData = existsSync(path)
let cached: GameData | null = null
export function realData(): GameData {
  if (!cached) cached = JSON.parse(readFileSync(path, 'utf8')) as GameData
  return cached
}

export const E = createImmersiveEngine()

export function identity(position: Position = 'CA', nationality = 'BRA'): PlayerIdentity {
  return { surname: 'Ribeiro', number: 9, foot: 'right', nationality, position }
}

export function dispatch(data: GameData, s: ImmersiveState, a: ImmersiveAction): { state: ImmersiveState; effects: ImmersiveEffect[] } {
  return E.dispatch(data, s, a)
}

/** Nova carreira já assinada com `clubId` (troca as opções da oferta de base). */
export function careerAt(data: GameData, seed: string, clubId: string, position: Position = 'CA'): ImmersiveState {
  let s = E.newCareer(data, identity(position), seed)
  const d = s.pendingDecision!
  const opt = { ...d.options[0], id: `academy-${clubId}`, clubId }
  const specs = { ...(d.context!.specs as Record<string, unknown>), [opt.id]: { type: 'join', optionKey: 'join', clubId, outcomes: [] } }
  s = { ...s, pendingDecision: { ...d, options: [opt], context: { specs } } }
  return dispatch(data, s, { type: 'decision_choose', optionId: opt.id }).state
}

/** Joga no automático até o item `season_end` (decisões: 1ª opção que não aposenta). */
export function toSeasonEnd(data: GameData, s: ImmersiveState): ImmersiveState {
  let x = s
  for (let i = 0; i < 200 && !x.retired; i++) {
    x = dispatch(data, x, { type: 'auto', until: 'season_end' }).state
    if (x.pendingDecision) {
      const o = x.pendingDecision.options.find((o) => !o.id.startsWith('retire')) ?? x.pendingDecision.options[0]
      x = dispatch(data, x, { type: 'decision_choose', optionId: o.id }).state
    } else if (x.calendar[x.cursor]?.kind === 'season_end') break
  }
  return x
}

/** season_end + awards → próxima temporada. */
export function closeSeason(data: GameData, s: ImmersiveState): { state: ImmersiveState; effects: ImmersiveEffect[] } {
  const a = dispatch(data, s, { type: 'advance' })
  const b = dispatch(data, a.state, { type: 'advance' })
  return { state: b.state, effects: [...a.effects, ...b.effects] }
}

/** Avança item a item (partidas encerradas no atalho) até o item atual ser do tipo pedido. */
export function advanceUntil(data: GameData, s: ImmersiveState, kind: string, max = 400): ImmersiveState {
  let x = s
  for (let i = 0; i < max; i++) {
    if (x.pendingDecision) {
      x = dispatch(data, x, { type: 'decision_choose', optionId: x.pendingDecision.options[0].id }).state
      continue
    }
    if (x.live) {
      x = dispatch(data, x, { type: 'match_finish' }).state
      continue
    }
    if (x.press) {
      x = dispatch(data, x, { type: 'press_skip' }).state
      continue
    }
    if (x.calendar[x.cursor]?.kind === kind) return x
    x = dispatch(data, x, { type: 'advance' }).state
  }
  return x
}

/** Estado "clonado" com o mesmo mundo (para ajustes manuais nos testes). */
export function tweak(s: ImmersiveState, f: (x: ImmersiveState) => void): ImmersiveState {
  const { world, ...rest } = s
  const c = structuredClone(rest) as ImmersiveState
  c.world = world
  f(c)
  return c
}
