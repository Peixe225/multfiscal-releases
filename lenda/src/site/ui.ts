/**
 * Qual diálogo do site está aberto (conta, perfil, carreiras) e o que fazer depois de entrar.
 *
 *   abrirConta({ modo: 'manual' })                       // "Entrar / Criar conta" do menu
 *   abrirConta({ modo: 'convite' })                      // o convite das 5 partidas
 *   abrirConta({ modo: 'manual', depois: { salvar: id } })  // "Salvar na minha conta" sem conta
 *   abrirCarreiras('aparelho')
 *   abrirConvideAmigos()                                 // Minha conta, rolada até "Convide amigos"
 *   abrirSuporte()                                       // "Fale conosco" (v3.3)
 *   abrirVerificarEmail(true)                            // o código de 6 dígitos, logo depois do cadastro (v3.3)
 */
import { create } from 'zustand'

export type AbaConta = 'criar' | 'entrar'
export type AbaCarreiras = 'conta' | 'aparelho'

/** Seção de Minha conta para onde rolar ao abrir (o atalho "Convide amigos" do menu). */
export type SecaoPerfil = 'convite'

export type DialogoSite =
  | { tipo: 'conta'; modo: 'convite' | 'manual'; aba?: AbaConta; depois?: { salvar: string } }
  | { tipo: 'perfil'; excluir?: boolean; secao?: SecaoPerfil }
  | { tipo: 'carreiras'; aba?: AbaCarreiras }
  /** v3.3: "Fale conosco" (dúvida, ideia, problema, recomendação). `tipo` já marcado, se veio de um atalho. */
  | { tipo: 'suporte'; assunto?: 'duvida' | 'ideia' | 'problema' | 'recomendacao' | 'outro' }
  /** v3.3: confirmar o e-mail com o código de 6 dígitos (depois do cadastro, ou pela faixa de Minha conta). */
  | { tipo: 'verificar'; depoisDoCadastro?: boolean }

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
/** Minha conta já rolada até "Convide amigos" (link, progresso e bônus das indicações). */
export const abrirConvideAmigos = () => useSiteUi.getState().abrir({ tipo: 'perfil', secao: 'convite' })
export const abrirCarreiras = (aba?: AbaCarreiras) => useSiteUi.getState().abrir({ tipo: 'carreiras', aba })
export const abrirSuporte = (assunto?: Extract<DialogoSite, { tipo: 'suporte' }>['assunto']) => useSiteUi.getState().abrir({ tipo: 'suporte', assunto })
export const abrirVerificarEmail = (depoisDoCadastro = false) => useSiteUi.getState().abrir({ tipo: 'verificar', depoisDoCadastro })
