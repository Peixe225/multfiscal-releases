/**
 * Configuração da live interativa (salva no navegador) + liga/desliga da sessão.
 *
 *   const cfg = useLiveConfig((s) => s.config)
 *   useLiveConfig.getState().set({ voteSeconds: 30 })
 *   useLiveSession.getState().start()      // o jogo passa a ser controlado pelo chat
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Pace } from '@/engine/types'
import { DEFAULT_BINDINGS } from './gifts'
import type { LiveSource } from './types'
import type { VoteRules } from './votes'

export type NameMode = 'apoiador' | 'fixo' | 'aleatorio'

export interface LiveConfig extends VoteRules {
  source: LiveSource
  /** @ do perfil que vai fazer a live (sem @). */
  username: string
  /** Chave opcional do Euler Stream (aumenta os limites da conexão). */
  signKey: string
  bridgeUrl: string
  tikfinityUrl: string
  /** Segundos de cada votação. */
  voteSeconds: number
  /** Empate no fim → mais 10 s (uma vez). */
  extendOnTie: boolean
  /** Segundos com a comemoração de título na tela antes de seguir. */
  celebrationSeconds: number
  /** Ao fim da carreira: segundos na tela final antes de começar outra. 0 = esperar o streamer. */
  nextCareerSeconds: number
  /** O chat vota posição e nacionalidade da próxima lenda. */
  identityVote: boolean
  nameMode: NameMode
  fixedName: string
  pace: Pace
  /** Simulador: público de mentira mandando votos e presentes. */
  simAuto: boolean
  simSpeed: 1 | 2 | 3
  /** Curtidas para encher o "termômetro da torcida". */
  likesGoal: number
}

export const DEFAULT_LIVE_CONFIG: LiveConfig = {
  source: 'simulador',
  username: '',
  signKey: '',
  bridgeUrl: 'ws://localhost:5178/ws',
  tikfinityUrl: 'ws://localhost:21213/',
  voteSeconds: 25,
  extendOnTie: true,
  celebrationSeconds: 6,
  nextCareerSeconds: 20,
  identityVote: true,
  nameMode: 'apoiador',
  fixedName: '',
  pace: 'normal',
  simAuto: true,
  simSpeed: 2,
  likesGoal: 1000,
  commentVotes: true,
  commentPoints: 1,
  pointsPerCoin: 10,
  giftBindings: [...DEFAULT_BINDINGS],
  instantWinCoins: 0,
  unboundGiftsFollowComment: true,
}

interface ConfigStore {
  config: LiveConfig
  set(patch: Partial<LiveConfig>): void
  setBinding(index: number, gift: string): void
  reset(): void
}

const safeStorage = (get: () => Storage) =>
  createJSONStorage(() => {
    try {
      return get()
    } catch {
      return undefined as unknown as Storage
    }
  })

export const useLiveConfig = create<ConfigStore>()(
  persist(
    (set) => ({
      config: DEFAULT_LIVE_CONFIG,
      set: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
      setBinding: (index, gift) =>
        set((s) => {
          const giftBindings = [...s.config.giftBindings]
          while (giftBindings.length < 4) giftBindings.push('')
          giftBindings[index] = gift
          return { config: { ...s.config, giftBindings } }
        }),
      reset: () => set({ config: DEFAULT_LIVE_CONFIG }),
    }),
    {
      name: 'lenda:live:v1',
      version: 1,
      storage: safeStorage(() => localStorage),
      merge: (persisted, current) => ({ ...current, config: { ...DEFAULT_LIVE_CONFIG, ...((persisted as { config?: Partial<LiveConfig> })?.config ?? {}) } }),
    },
  ),
)

interface SessionStore {
  /** O jogo está sendo controlado pelo chat. */
  on: boolean
  /** Votações em pausa (o streamer pode jogar/explicar). */
  paused: boolean
  start(): void
  stop(): void
  setPaused(p: boolean): void
}

/** Fica no sessionStorage: recarregar a aba no meio da live mantém o modo live. */
export const useLiveSession = create<SessionStore>()(
  persist(
    (set) => ({
      on: false,
      paused: false,
      start: () => set({ on: true, paused: false }),
      stop: () => set({ on: false, paused: false }),
      setPaused: (paused) => set({ paused }),
    }),
    { name: 'lenda:live:session', version: 1, storage: safeStorage(() => sessionStorage) },
  ),
)

/** No Artifact do claude.ai a página não pode abrir conexões locais (CSP): só o simulador funciona. */
export const LIVE_SANDBOXED = import.meta.env.VITE_ARTIFACT === '1'
