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
import { DEFAULT_BINDINGS, sameGift } from './gifts'
import type { LiveSource } from './types'
import type { VoteRules } from './votes'

export type NameMode = 'apoiador' | 'fixo' | 'aleatorio'
/** Quem cria a próxima lenda: o maior doador de uma disputa, o maior apoiador da carreira anterior ou o chat (votação). */
export type CreatorMode = 'disputa' | 'apoiador' | 'votacao'

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
  creator: CreatorMode
  /** Segundos da disputa (quem doar mais nesse tempo cria a lenda). */
  bidSeconds: number
  /** Segundos para o vencedor digitar nome, país e posição. */
  createSeconds: number
  /** Moedas mínimas para vencer a disputa. */
  minBidCoins: number
  /** O chat vota posição e nacionalidade (ou o que o criador não escolheu a tempo). */
  identityVote: boolean
  nameMode: NameMode
  fixedName: string
  pace: Pace
  /** Simulador: público de mentira mandando votos e presentes. */
  simAuto: boolean
  simSpeed: 1 | 2 | 3
  /** Curtidas para encher o "termômetro da torcida". */
  likesGoal: number
  /**
   * "Área segura do TikTok": na janela da live (9:16) a faixa fica abaixo da sobreposição do topo
   * (~8% da altura) e as opções/votos acima do chat e da barra de presentes de baixo (~22%).
   */
  safeArea: boolean
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
  creator: 'disputa',
  bidSeconds: 30,
  createSeconds: 60,
  minBidCoins: 1,
  identityVote: true,
  nameMode: 'apoiador',
  fixedName: '',
  pace: 'normal',
  simAuto: true,
  simSpeed: 2,
  likesGoal: 1000,
  safeArea: true,
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

const CONFIG_KEY = 'lenda:live:v1'

const sameBinding = (a: string, b: string) => !!a && !!b && sameGift({ id: a, name: a }, b)

/** Opção (índice) que já tem esse presente, fora `index` (Rose e Rosa são o mesmo). -1 = nenhuma. */
export function bindingConflict(bindings: readonly string[], index: number, gift: string): number {
  return gift ? bindings.findIndex((b, j) => j !== index && sameBinding(b, gift)) : -1
}

/** Um presente por opção: repetições (depois da primeira) ficam sem presente. */
export function dedupeBindings(bindings: readonly string[]): string[] {
  return bindings.map((b, i) => (b && bindings.slice(0, i).some((x) => sameBinding(x, b)) ? '' : b))
}

export const useLiveConfig = create<ConfigStore>()(
  persist(
    (set) => ({
      config: DEFAULT_LIVE_CONFIG,
      set: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
      setBinding: (index, gift) =>
        set((s) => {
          const giftBindings = [...s.config.giftBindings]
          while (giftBindings.length < 4) giftBindings.push('')
          // um presente nunca vale para duas opções: se ele já era de outra, as duas trocam de presente
          const j = bindingConflict(giftBindings, index, gift)
          if (j >= 0) giftBindings[j] = giftBindings[index] ?? ''
          giftBindings[index] = gift
          return { config: { ...s.config, giftBindings: dedupeBindings(giftBindings) } }
        }),
      reset: () => set({ config: DEFAULT_LIVE_CONFIG }),
    }),
    {
      name: CONFIG_KEY,
      version: 1,
      // sem storage (navegador bloqueando): o próprio zustand cai para memória — um wrapper que engole o
      // erro faria o persist chamar setItem em undefined e a página ficar em branco
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const config: LiveConfig = { ...DEFAULT_LIVE_CONFIG, ...((persisted as { config?: Partial<LiveConfig> })?.config ?? {}) }
        // configuração salva com o mesmo presente em duas opções (versões antigas): fica só na primeira
        return { ...current, config: { ...config, giftBindings: dedupeBindings(Array.isArray(config.giftBindings) ? config.giftBindings : [...DEFAULT_BINDINGS]) } }
      },
    },
  ),
)

// outra aba/janela mudou a configuração (painel de controle ↔ janela da live): relê do localStorage.
// O evento "storage" só dispara nas OUTRAS janelas da mesma origem, então não há eco.
if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key === CONFIG_KEY || e.key === null) void useLiveConfig.persist?.rehydrate()
  })

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
    { name: 'lenda:live:session', version: 1, storage: createJSONStorage(() => sessionStorage) },
  ),
)

/** No Artifact do claude.ai a página não pode abrir conexões locais (CSP): só o simulador funciona. */
export const LIVE_SANDBOXED = import.meta.env.VITE_ARTIFACT === '1'
