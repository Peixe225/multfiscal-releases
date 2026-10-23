/**
 * Configuração da live interativa (salva no navegador) + liga/desliga da sessão.
 *
 *   const cfg = useLiveConfig((s) => s.config)
 *   useLiveConfig.getState().set({ voteSeconds: 30 })
 *   useLiveSession.getState().start()      // o jogo passa a ser controlado pelo chat
 *
 * O painel e a live dentro do OBS (outro navegador) ficam com a mesma configuração pela ponte (channel.ts):
 * cada mudança feita na tela (set/setBinding/reset) avisa onConfigEdited e marca `editedAt`; o que chega
 * da ponte entra por mergeSyncedConfig. Chave do Euler Stream e endereço da ponte ficam em cada janela.
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Pace } from '@/engine/types'
import { localSeguro, sessaoSegura } from '@/store/armazem'
import { DEFAULT_BINDINGS, sameGift } from './gifts'
import type { LiveSource } from './types'
import type { VoteRules } from './votes'

export type NameMode = 'apoiador' | 'fixo' | 'aleatorio'
/** Ritmo da carreira na live: um dos ritmos do jogo ou 'auto' (escolhido a cada lenda pelo movimento da sala). */
export type LivePace = Pace | 'auto'

/**
 * Ritmo automático: a cada nova lenda o autopiloto conta quantas PESSOAS diferentes participaram nos
 * últimos 5 minutos (comentaram, mandaram presente, curtiram, seguiram ou compartilharam — entrar na sala
 * não conta; o voto do streamer e os testes numa live de verdade também não):
 *   menos de 3   → Expresso (8 decisões): carreiras curtas, mais disputas = mais momentos de presente
 *   3 a 14       → Normal (12)
 *   15 ou mais   → Intenso (24): sala cheia aguenta a carreira longa (e é onde as "extraordinárias" brilham)
 */
export const AUTO_PACE = { windowMs: 5 * 60_000, normalFrom: 3, intenseFrom: 15 } as const

export function autoPace(people: number): Pace {
  return people >= AUTO_PACE.intenseFrom ? 'intensa' : people >= AUTO_PACE.normalFrom ? 'normal' : 'expressa'
}

/** "Expresso" · "Normal" · "Intenso" (como no painel). */
export const PACE_NAMES: Record<Pace, string> = { expressa: 'Expresso', normal: 'Normal', intensa: 'Intenso' }

const PACES: readonly string[] = ['auto', 'expressa', 'normal', 'intensa'] satisfies LivePace[]
/**
 * Ritmo conhecido ou o de antes (texto qualquer vindo da ponte/do armazenamento não vira ritmo). Fica antes
 * da store: o persist relê o localStorage já na criação dela (uma const declarada depois estaria em TDZ).
 */
export function validPace(v: unknown, fallback: LivePace): LivePace {
  return typeof v === 'string' && PACES.includes(v) ? (v as LivePace) : fallback
}
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
  /** 'auto' = escolhido a cada lenda pelo movimento da sala (AUTO_PACE). */
  pace: LivePace
  /**
   * "Sala vazia": votação (ou disputa) sem NENHUM voto (lance) depois destes segundos fecha antes do fim,
   * com o sorteio de sempre (na disputa, o caminho de "ninguém doou"). Chegou um voto, vai até o fim; sinal de
   * gente na sala (entrou, comentou, curtiu) empurra o prazo. 0 = desligado.
   *
   * Padrão 15 s (não menos): o espectador vê a live do TikTok uns 3–6 s atrasada e o comentário dele leva ~1 s
   * para chegar — com 10 s, quem chegou sozinho teria uns 4 s para ler a decisão e comentar.
   */
  quietSeconds: number
  /** Chamadas na tela: frases curtas girando a cada ~6 s (como jogar, presentes, seguir, jogar grátis). */
  ctaOn: boolean
  /** Frase do streamer que entra no rodízio das chamadas (passa pelo filtro de palavrões). '' = nenhuma. */
  ctaCustom: string
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
  // configurações novas começam no automático; as já salvas guardam o ritmo que tinham (merge do persist)
  pace: 'auto',
  quietSeconds: 15,
  ctaOn: true,
  ctaCustom: '',
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
  /** Quando a configuração mudou pela última vez nesta janela (ou a hora da que veio da ponte). 0 = nunca. */
  editedAt: number
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

// ── mudanças feitas nesta janela (vão para as outras pela ponte) ──

const editListeners = new Set<() => void>()

/** Alguém mudou a configuração nesta janela (não conta o que chegou de outra janela ou da ponte). */
export function onConfigEdited(fn: () => void): () => void {
  editListeners.add(fn)
  return () => {
    editListeners.delete(fn)
  }
}

const edited = () => {
  for (const f of [...editListeners]) f()
}

/**
 * Configuração salva no navegador → a desta janela: campos novos (de versões novas do jogo) entram com o
 * padrão; os que a pessoa já tinha ficam como estavam — inclusive o ritmo (quem usava "Normal" continua no
 * Normal; só configurações novas começam no automático).
 */
export function mergePersistedConfig(persisted: unknown): { config: LiveConfig; editedAt: number } {
  const p = persisted as { config?: Partial<LiveConfig>; editedAt?: unknown } | undefined
  const config: LiveConfig = { ...DEFAULT_LIVE_CONFIG, ...(p?.config ?? {}) }
  const editedAt = typeof p?.editedAt === 'number' && Number.isFinite(p.editedAt) ? p.editedAt : 0
  // configuração salva com o mesmo presente em duas opções (versões antigas): fica só na primeira
  return { editedAt, config: { ...config, pace: validPace(config.pace, DEFAULT_LIVE_CONFIG.pace), giftBindings: dedupeBindings(Array.isArray(config.giftBindings) ? config.giftBindings : [...DEFAULT_BINDINGS]) } }
}

/**
 * Configuração salva numa versão anterior → a atual. v1 → v2: sala vazia em 10 s (o padrão antigo) vira 15 s.
 * Fica antes da store (o persist relê o localStorage já na criação dela).
 */
export function migrateConfig(persisted: unknown, version: number): unknown {
  const p = persisted as { config?: Partial<LiveConfig> } | null | undefined
  if (!p || typeof p !== 'object' || !p.config || typeof p.config !== 'object') return persisted
  if (version < 2 && p.config.quietSeconds === 10) return { ...p, config: { ...p.config, quietSeconds: 15 } }
  return persisted
}

export const useLiveConfig = create<ConfigStore>()(
  persist(
    (set) => ({
      config: DEFAULT_LIVE_CONFIG,
      editedAt: 0,
      set: (patch) => {
        set((s) => ({ config: { ...s.config, ...patch }, editedAt: Date.now() }))
        edited()
      },
      setBinding: (index, gift) => {
        set((s) => {
          const giftBindings = [...s.config.giftBindings]
          while (giftBindings.length < 4) giftBindings.push('')
          // um presente nunca vale para duas opções: se ele já era de outra, as duas trocam de presente
          const j = bindingConflict(giftBindings, index, gift)
          if (j >= 0) giftBindings[j] = giftBindings[index] ?? ''
          giftBindings[index] = gift
          return { config: { ...s.config, giftBindings: dedupeBindings(giftBindings) }, editedAt: Date.now() }
        })
        edited()
      },
      reset: () => {
        set({ config: DEFAULT_LIVE_CONFIG, editedAt: Date.now() })
        edited()
      },
    }),
    {
      name: CONFIG_KEY,
      // armazém seguro (store/armazem.ts): com window.localStorage null (WebView sem DOM storage) ou a cota cheia,
      // o createJSONStorage puro deixava o setItem lançar e a página ficava preta. O seguro nunca lança: o que não
      // coube fica na memória desta janela (e a ponte continua levando a configuração para as outras)
      storage: createJSONStorage(() => localSeguro),
      // v2: o padrão da sala vazia subiu de 10 para 15 s (atraso do TikTok): quem estava com o padrão antigo sobe junto
      version: 2,
      migrate: (persisted, version) => migrateConfig(persisted, version) as ConfigStore,
      merge: (persisted, current) => ({ ...current, ...mergePersistedConfig(persisted) }),
    },
  ),
)

// ── a mesma configuração no painel e no OBS (pela ponte) ──

/** Ficam em cada janela: a chave do Euler Stream (segredo) e o endereço da ponte (é por onde a janela fala). */
export const LOCAL_ONLY_KEYS = ['signKey', 'bridgeUrl'] as const satisfies readonly (keyof LiveConfig)[]
type LocalOnly = (typeof LOCAL_ONLY_KEYS)[number]
const SYNCED_KEYS = (Object.keys(DEFAULT_LIVE_CONFIG) as (keyof LiveConfig)[]).filter((k) => !(LOCAL_ONLY_KEYS as readonly string[]).includes(k))

/** O que vai para a ponte (e para as outras janelas). */
export function syncedConfig(c: LiveConfig): Omit<LiveConfig, LocalOnly> {
  const out: Record<string, unknown> = {}
  for (const k of SYNCED_KEYS) out[k] = Array.isArray(c[k]) ? [...(c[k] as unknown[])] : c[k]
  return out as Omit<LiveConfig, LocalOnly>
}

/**
 * Configuração que chegou de outra janela pela ponte → a desta janela. Só entram campos conhecidos e do
 * mesmo tipo do padrão (o resto fica como está); chave e endereço da ponte não mudam.
 */
export function mergeSyncedConfig(local: LiveConfig, incoming: unknown): LiveConfig {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return local
  const src = incoming as Record<string, unknown>
  const out = { ...local } as Record<string, unknown>
  for (const k of SYNCED_KEYS) {
    const want = DEFAULT_LIVE_CONFIG[k]
    const v = src[k]
    if (Array.isArray(want)) {
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k] = [...v]
    } else if (typeof v === typeof want && (typeof v !== 'number' || Number.isFinite(v))) out[k] = v
  }
  const config = out as unknown as LiveConfig
  return { ...config, pace: validPace(config.pace, local.pace), giftBindings: dedupeBindings(config.giftBindings) }
}

/** As duas janelas estão com a mesma configuração (fora o que é de cada uma)? */
export function sameSyncedConfig(a: LiveConfig, b: LiveConfig): boolean {
  return SYNCED_KEYS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]))
}

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
    { name: 'lenda:live:session', version: 1, storage: createJSONStorage(() => sessaoSegura) },
  ),
)

/**
 * Build publicado como Artifact no claude.ai (scripts/build-artifact.mjs, VITE_ARTIFACT=1): a CSP de lá
 * bloqueia conexões locais e imagens de fora. Separado de LIVE_SANDBOXED só para o texto e as imagens
 * poderem mudar — o comportamento da live é o mesmo nos dois builds abaixo.
 */
export const LIVE_IN_CLAUDE = import.meta.env.VITE_ARTIFACT === '1'

/**
 * Site público (oprojeto.online/lenda, scripts/build-site.mjs, VITE_SITE=1): qualquer visitante abre a
 * página, então ela nunca tenta ws://localhost (nem a ponte, nem o revezamento, nem o TikFinity) — no PC de
 * quem não tem a ponte isso só geraria erro no console, e no de quem tem seria uma página da internet
 * conversando com um programa local. A live de verdade continua sendo o LENDA rodando no PC (INICIAR-LIVE.bat).
 */
export const LIVE_ON_SITE = import.meta.env.VITE_SITE === '1'

/** Live só com o simulador: Artifact do claude.ai (a CSP não deixa) ou site público (não deve). */
export const LIVE_SANDBOXED = LIVE_IN_CLAUDE || LIVE_ON_SITE
