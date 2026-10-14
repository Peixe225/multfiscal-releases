/**
 * Indicações e bônus de OVR (GET/POST /lenda/api/bonus.php — servidor/CONTRATO-v3.md §6).
 *
 *   await useBonus.getState().carregar()            // { liberado, faltamPartidas, disponiveis, indicacoes, … }
 *   const n = await usarBonus('career-abc')          // ao começar a carreira (idempotente por carreira)
 *   const r = await useBonus.getState().compartilhei('career-abc')  // { ganhou: 2 } | { ganhou: 0, motivo }
 *
 * Regras (do servidor; o cliente só mostra): indicação válida = +2, +3, +5 (até 3 amigos); compartilhar o
 * card final = +2, 1x por dia; tudo só depois de `liberaAposPartidas` partidas desde o cadastro. Um bônus
 * por carreira: o servidor usa o mais antigo disponível.
 */
import { create } from 'zustand'
import { api, comReintento, ErroApi } from './api'
import { bonusDoSite } from './acesso'
import { useConta } from './conta'
import { linkConvite } from './indicacao'

export type OrigemBonus = 'indicacao' | 'compartilhar' | 'admin'

export interface BonusDisponivel {
  id: number
  valor: number
  origem: OrigemBonus
  criadoEm: string
}

export interface BonusInfo {
  liberado: boolean
  faltamPartidas: number
  disponiveis: BonusDisponivel[]
  /** Já ganhos, mas só ficam disponíveis quando a conta liberar (indicação validada antes das partidas). */
  guardados: BonusDisponivel[]
  usados: number
  indicacoes: { validas: number; pendentes: number; limite: number; proximoValor: number | null }
  /** Ainda dá para ganhar o bônus de compartilhar hoje (liberado e ainda não ganhou hoje) — §8.6. */
  compartilharHoje: boolean
  compartilharValor: number
  codigoConvite: string | null
  linkConvite: string | null
}

const int = (v: unknown, padrao = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : padrao)

export function normalizarBonusInfo(x: unknown): BonusInfo | null {
  const b = x as Partial<Record<keyof BonusInfo, unknown>> | null
  if (!b || typeof b !== 'object') return null
  const ind = (b.indicacoes ?? {}) as Partial<Record<keyof BonusInfo['indicacoes'], unknown>>
  const lista = (x: unknown) =>
    (Array.isArray(x) ? x : [])
      .map((d): BonusDisponivel | null => {
        const o = d as Partial<Record<keyof BonusDisponivel, unknown>>
        const valor = int(o?.valor)
        if (!o || !valor) return null
        const origem = o.origem === 'compartilhar' || o.origem === 'admin' ? o.origem : 'indicacao'
        return { id: int(o.id), valor: Math.min(10, valor), origem, criadoEm: typeof o.criadoEm === 'string' ? o.criadoEm : '' }
      })
      .filter((d): d is BonusDisponivel => !!d)
      // o servidor usa o mais antigo primeiro: a lista fica nessa ordem
      .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm) || a.id - b.id)
  const disponiveis = lista(b.disponiveis)
  const codigo = typeof b.codigoConvite === 'string' && b.codigoConvite ? b.codigoConvite : null
  return {
    liberado: b.liberado === true,
    faltamPartidas: int(b.faltamPartidas),
    disponiveis,
    guardados: lista(b.guardados),
    usados: int(b.usados),
    indicacoes: {
      validas: int(ind.validas),
      pendentes: int(ind.pendentes),
      limite: int(ind.limite, bonusDoSite().maxIndicacoes),
      proximoValor: typeof ind.proximoValor === 'number' && Number.isFinite(ind.proximoValor) && ind.proximoValor > 0 ? Math.round(ind.proximoValor) : null,
    },
    compartilharHoje: b.compartilharHoje === true,
    compartilharValor: typeof b.compartilharValor === 'number' ? Math.min(10, int(b.compartilharValor)) : bonusDoSite().compartilhar,
    codigoConvite: codigo,
    linkConvite: typeof b.linkConvite === 'string' && /^https?:\/\//.test(b.linkConvite) ? b.linkConvite : codigo ? linkConvite(codigo) : null,
  }
}

/** O bônus que a próxima carreira usa (o mais antigo disponível), ou null. */
export const proximoBonus = (b: BonusInfo | null): BonusDisponivel | null => b?.disponiveis[0] ?? null

export const ROTULO_ORIGEM: Record<OrigemBonus, string> = { indicacao: 'indicação', compartilhar: 'compartilhou o card', admin: 'presente do LENDA' }

/**
 * Os degraus das indicações (+2, +3, +5), com o estado de cada um: 'ganho' (indicação válida), 'esperando'
 * (amigo cadastrado que ainda não terminou a 1ª partida) e 'livre'.
 */
export function degrausIndicacao(b: Pick<BonusInfo, 'indicacoes'> | null, valores = bonusDoSite().indicacao, max = bonusDoSite().maxIndicacoes): { valor: number; estado: 'ganho' | 'esperando' | 'livre' }[] {
  const limite = Math.max(0, Math.min(max, b?.indicacoes.limite || max))
  const validas = Math.min(limite, b?.indicacoes.validas ?? 0)
  const pendentes = Math.max(0, Math.min(limite - validas, b?.indicacoes.pendentes ?? 0))
  return Array.from({ length: limite }, (_, i) => ({ valor: valores[i] ?? valores.at(-1) ?? 0, estado: i < validas ? 'ganho' : i < validas + pendentes ? 'esperando' : 'livre' }))
}

/** "faltam 2 partidas" · "falta 1 partida" (para liberar os bônus). */
export const textoFaltam = (n: number) => (n === 1 ? 'falta 1 partida' : `faltam ${n} partidas`)

export type ResultadoCompartilhar = { ganhou: number; motivo?: 'ja_hoje' | 'bloqueado' }

interface BonusStore {
  dados: BonusInfo | null
  carregando: boolean
  erro: string | null
  /** Quando os dados vieram (ms). */
  em: number
  carregar(forcar?: boolean): Promise<BonusInfo | null>
  compartilhei(carreiraId: string): Promise<ResultadoCompartilhar>
  limpar(): void
}

/** Os dados do bônus valem por isto antes de perguntar de novo (o painel de conta força). */
const VALIDADE_MS = 60_000
let noAr: Promise<BonusInfo | null> | null = null

export const useBonus = create<BonusStore>()((set, get) => ({
  dados: null,
  carregando: false,
  erro: null,
  em: 0,

  async carregar(forcar = false) {
    if (!useConta.getState().usuario) return null
    if (!forcar && get().dados && Date.now() - get().em < VALIDADE_MS) return get().dados
    if (noAr) return noAr
    set({ carregando: true, erro: null })
    noAr = (async () => {
      try {
        const r = await comReintento(() => api<unknown>('bonus.php', { tempo: 10_000 }), { tentativas: 2 })
        const dados = normalizarBonusInfo(r)
        set({ dados, carregando: false, em: Date.now() })
        return dados
      } catch (err) {
        if (err instanceof ErroApi && err.status === 401) useConta.getState().sessaoExpirou()
        set({ carregando: false, erro: err instanceof ErroApi ? err.message : 'Não deu para carregar os bônus.' })
        return null
      } finally {
        noAr = null
      }
    })()
    return noAr
  },

  async compartilhei(carreiraId) {
    const r = await comReintento(() => api<{ ganhou?: unknown; motivo?: unknown }>('bonus.php', { corpo: { acao: 'compartilhei', carreiraId } }), { tentativas: 2 })
    const ganhou = int(r?.ganhou)
    const motivo = r?.motivo === 'ja_hoje' || r?.motivo === 'bloqueado' ? r.motivo : undefined
    // o que mudou (compartilharHoje, um bônus novo) aparece da próxima vez que alguém olhar
    set({ em: 0 })
    return { ganhou, motivo }
  },

  limpar() {
    set({ dados: null, erro: null, em: 0 })
  },
}))

/**
 * Usa o bônus disponível mais antigo nesta carreira: devolve o valor (0 sem bônus). Idempotente no
 * servidor (o mesmo `carreiraId` devolve o mesmo valor), então tenta de novo sem medo se a rede cair. Duas
 * tentativas de até 7 s: o jogador não fica meio minuto olhando o botão girar (a tela pergunta o que fazer).
 */
export async function usarBonus(carreiraId: string): Promise<number> {
  const r = await comReintento(() => api<{ valor?: unknown }>('bonus.php', { corpo: { acao: 'usar', carreiraId }, tempo: 7_000 }), { tentativas: 2 })
  useBonus.setState({ em: 0 })
  return Math.min(10, int(r?.valor))
}
