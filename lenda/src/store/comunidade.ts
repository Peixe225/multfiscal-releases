/**
 * Hall público (carreiras dos jogadores da comunidade — servidor/CONTRATO-v3.md §4): a ponte entre o src/site
 * (que busca no servidor) e as telas do jogo (Hall das Lendas, Resumo), que só leem daqui. Fora do site
 * `ativo` fica false e nada disto aparece.
 *
 *   const pg = useComunidade((s) => s.filtros[chaveFiltro(f)])   // página(s) já carregadas daquele filtro
 *   useComunidade.getState().pedir?.(f)                          // o site busca (com cache por filtro)
 *   useComunidade.getState().abrir?.(id)                         // resumo completo de uma (GET hall.php?id=)
 */
import { create } from 'zustand'
import type { HallEntry } from './career'

export interface FiltroHall {
  /** Seleção (código FIFA). */
  pais?: string
  /** Clube (id do jogo, ex.: e2022). */
  clube?: string
}

export interface CarreiraComunidade {
  /** Id do HallEntry. */
  id: string
  /** Posição geral no Hall público (a do servidor). */
  posicao: number
  apelido: string
  jogador: string
  numero: number
  pais: string
  posicaoCampo: string
  nota: number
  picoOvr: number
  temporadas: number
  gols: number
  titulos: number
  bolasOuro: number
  copas: number
  headline: string
  clubes: string[]
  bonusOvr: number
  terminouEm: string | null
  /** Escolhida pela moderação (v3.2, H12): selo "Destaque". Servidor antigo = false. */
  destaque: boolean
  /** Código do perfil público do dono (v3.3: #/jogador/<código>); null/ausente = perfil fechado ou servidor antigo. */
  perfil?: string | null
}

export interface PaginasComunidade {
  status: 'carregando' | 'pronto' | 'erro'
  /** Sem internet (para a mensagem certa). */
  semRede?: boolean
  itens: CarreiraComunidade[]
  total: number
  /** Páginas já carregadas (50 por página). */
  paginas: number
  atualizadoEm: string | null
  proximaEm: string | null
  /** Carregando a próxima página (as que já vieram continuam na tela). */
  carregandoMais?: boolean
  erroMais?: boolean
}

export type CarreiraAberta = { status: 'carregando' } | { status: 'erro'; naoEncontrada: boolean } | { status: 'pronta'; entry: HallEntry; apelido: string; destaque?: boolean; perfil?: string | null }

interface ComunidadeStore {
  /** O site tem Hall público (build do site). */
  ativo: boolean
  filtros: Record<string, PaginasComunidade>
  abertas: Record<string, CarreiraAberta>
  pedir: ((f: FiltroHall) => void) | null
  mais: ((f: FiltroHall) => void) | null
  tentarDeNovo: ((f: FiltroHall) => void) | null
  abrir: ((id: string) => void) | null
}

export const useComunidade = create<ComunidadeStore>()(() => ({
  ativo: false,
  filtros: {},
  abertas: {},
  pedir: null,
  mais: null,
  tentarDeNovo: null,
  abrir: null,
}))

/** A mesma chave para o mesmo filtro (ordem e caixa não importam). */
export const chaveFiltro = (f: FiltroHall) => `${(f.pais ?? '').toUpperCase()}|${f.clube ?? ''}`

/**
 * A hora da próxima atualização do Hall já passou? (o servidor responde a fotografia anterior e refaz logo depois:
 * a tela diz "atualizando agora" em vez de uma hora no passado)
 */
export const proximaVencida = (proximaEm: string | null | undefined, agora = Date.now()): boolean => {
  const p = proximaEm ? Date.parse(proximaEm) : NaN
  return Number.isFinite(p) && p <= agora
}
