// Quem está logado e o que o papel dele pode (o servidor é quem recusa, com 403 sem-permissao; aqui o painel só
// esconde o que não serve pra essa pessoa). Dono pode tudo; gerente e atendente, só os estados deles.
import { useSyncExternalStore } from 'react'
import type { Papel, Usuario } from './tipos'

let atual: Usuario | null = null
const ouvintes = new Set<() => void>()

export function definirUsuario(u: Usuario | null): void {
  atual = u
  ouvintes.forEach((f) => f())
}

export function usuarioAtual(): Usuario | null {
  return atual
}

/** O papel pode isso? Sem a lista de permissões (servidor de antes da equipe), é o dono. */
export function pode(permissao: string, u: Usuario | null = atual): boolean {
  if (!u) return false
  if (u.papel === 'dono' || !u.permissoes) return true
  return u.permissoes.includes(permissao)
}

function assinar(f: () => void) {
  ouvintes.add(f)
  return () => {
    ouvintes.delete(f)
  }
}

export function useUsuario(): Usuario | null {
  return useSyncExternalStore(assinar, usuarioAtual, usuarioAtual)
}

/** Atalho das telas: o papel de quem está logado pode isso? */
export function usePode(permissao: string): boolean {
  const u = useUsuario()
  return pode(permissao, u)
}

/** Os estados de quem está logado (null = todos: o dono, ou o servidor de antes da equipe). */
export function ufsDoUsuario(u: Usuario | null = atual): string[] | null {
  if (!u || u.papel === 'dono' || !u.permissoes) return null
  return u.ufs ?? []
}

/**
 * O rateio vale só em estados de quem está logado? Num que vale também em estado de outro (MG+RJ pro gerente de MG),
 * editar, mudar o passo e cancelar é só com o dono (o servidor recusa: 403 "só o dono mexe nele").
 */
export function rateioEhMeu(ufsRateio: string[], u: Usuario | null = atual): boolean {
  const meus = ufsDoUsuario(u)
  return meus === null || ufsRateio.every((x) => meus.includes(x))
}

/** A dica de quem pode mexer no rateio mas não nesse (vale em estado que não é dele). */
export const DICA_RATEIO_DE_OUTRO = 'Esse rateio vale em estado que não é teu: só o dono mexe nele.'

export const NOME_PAPEL: Record<Papel, string> = { dono: 'dono da loja', gerente: 'gerente', atendente: 'atendente' }

/** "gerente de MG e RJ" · "dono da loja" */
export function descreverAcesso(u: Pick<Usuario, 'papel' | 'ufs'>): string {
  const ufs = (u.ufs ?? []).map((x) => x.toUpperCase())
  if (u.papel === 'dono' || !ufs.length) return NOME_PAPEL[u.papel]
  const ultimo = ufs.pop()
  return `${NOME_PAPEL[u.papel]} de ${ufs.length ? `${ufs.join(', ')} e ${ultimo}` : ultimo}`
}
