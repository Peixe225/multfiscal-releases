/**
 * "Abrir no jogo" do painel (CONTRATO-v32 §A.7, X4): o admin vê no #/resumo qualquer carreira salva — inclusive oculta,
 * suspeita ou em revisão — sem ela entrar no Hall deste aparelho. A ponte entre o src/site (que busca em
 * admin.php?r=carreira, só com a sessão do painel) e o Resumo, que só lê daqui. Fora do site `abrir` fica null.
 *
 *   useResumoAdmin.getState().abrir?.('123')       // carreiras.id (só dígitos) ou o HallEntry.id
 *   const a = useResumoAdmin((s) => s.abertas['123'])
 */
import { create } from 'zustand'
import type { HallEntry } from './career'

export interface SinalAdmin {
  nivel: 'grave' | 'leve'
  codigo: string
  texto: string
}

/** O `meta` do admin.php?r=carreira, só o que o resumo mostra (o resto fica no painel). */
export interface MetaAdmin {
  pk: number
  apelido: string
  usuarioId: number
  contaSuspensa: boolean
  hallBloqueado: boolean
  modo: string
  nota: number
  /** 0 = visível · 1 = oculta pelo admin · 2 = escondida por denúncias. */
  oculta: 0 | 1 | 2
  /** Motivos da conferência ("revisao", "gols,bolas"…) ou null. */
  suspeita: string | null
  denunciasAbertas: number
  posicaoHall: number | null
  destaque: boolean
  publica: boolean
  moderacao: { em: string | null; motivo: string | null } | null
  sinais: SinalAdmin[]
}

export type CarreiraAdmin =
  | { status: 'carregando' }
  /** `sessao`: o painel não está mais aberto neste navegador (401/403); `nao_encontrada`: 404; `rede`: tente de novo. */
  | { status: 'erro'; motivo: 'sessao' | 'nao_encontrada' | 'rede'; mensagem: string }
  | { status: 'pronta'; entry: HallEntry; meta: MetaAdmin }

interface ResumoAdminStore {
  abertas: Record<string, CarreiraAdmin>
  abrir: ((id: string) => void) | null
}

export const useResumoAdmin = create<ResumoAdminStore>()(() => ({ abertas: {}, abrir: null }))

/** Onde a carreira está para a moderação, numa frase curta (a faixa da visão do admin). */
export function estadoAdmin(m: Pick<MetaAdmin, 'oculta' | 'suspeita' | 'posicaoHall' | 'hallBloqueado' | 'contaSuspensa'>): { texto: string; tom: 'ok' | 'aviso' | 'neutro' } {
  if (m.oculta === 1) return { texto: 'Oculta pela moderação', tom: 'aviso' }
  if (m.oculta === 2) return { texto: 'Escondida por denúncias (esperando a decisão)', tom: 'aviso' }
  if (m.suspeita === 'revisao') return { texto: 'Em revisão (nota alta): fora do Hall até ser conferida', tom: 'aviso' }
  if (m.suspeita) return { texto: 'Suspeita: fora do Hall até a moderação liberar', tom: 'aviso' }
  if (m.contaSuspensa) return { texto: 'Conta suspensa: fora do Hall', tom: 'aviso' }
  if (m.hallBloqueado) return { texto: 'Conta tirada do Hall público', tom: 'aviso' }
  if (m.posicaoHall) return { texto: `${m.posicaoHall}º no Hall público`, tom: 'ok' }
  return { texto: 'Fora do Hall público agora', tom: 'neutro' }
}
