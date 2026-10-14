/**
 * Qual diálogo do site está aberto (conta, perfil, carreiras) e o que fazer depois de entrar.
 *
 *   abrirConta({ modo: 'manual' })                       // "Entrar / Criar conta" do menu
 *   abrirConta({ modo: 'convite' })                      // o convite das 5 partidas
 *   abrirConta({ modo: 'manual', depois: { salvar: id } })  // "Salvar na minha conta" sem conta
 *   abrirCarreiras('aparelho')
 */
import { create } from 'zustand'

export type AbaConta = 'criar' | 'entrar'
export type AbaCarreiras = 'conta' | 'aparelho'

export type DialogoSite =
  | { tipo: 'conta'; modo: 'convite' | 'manual'; aba?: AbaConta; depois?: { salvar: string } }
  | { tipo: 'perfil'; excluir?: boolean }
  | { tipo: 'carreiras'; aba?: AbaCarreiras }

interface SiteUi {
  dialogo: DialogoSite | null
  abrir(d: DialogoSite): void
  fechar(): void
}

export const useSiteUi = create<SiteUi>()((set) => ({
  dialogo: null,
  abrir: (d) => set({ dialogo: d }),
  fechar: () => set({ dialogo: null }),
}))

export const abrirConta = (o: { modo?: 'convite' | 'manual'; aba?: AbaConta; depois?: { salvar: string } } = {}) =>
  useSiteUi.getState().abrir({ tipo: 'conta', modo: o.modo ?? 'manual', aba: o.aba, depois: o.depois })
export const abrirPerfil = (excluir = false) => useSiteUi.getState().abrir({ tipo: 'perfil', excluir })
export const abrirCarreiras = (aba?: AbaCarreiras) => useSiteUi.getState().abrir({ tipo: 'carreiras', aba })
