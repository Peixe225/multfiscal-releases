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

export const NOME_PAPEL: Record<Papel, string> = { dono: 'dono da loja', gerente: 'gerente', atendente: 'atendente' }

/** "gerente de MG e RJ" · "dono da loja" */
export function descreverAcesso(u: Pick<Usuario, 'papel' | 'ufs'>): string {
  const ufs = (u.ufs ?? []).map((x) => x.toUpperCase())
  if (u.papel === 'dono' || !ufs.length) return NOME_PAPEL[u.papel]
  const ultimo = ufs.pop()
  return `${NOME_PAPEL[u.papel]} de ${ufs.length ? `${ufs.join(', ')} e ${ultimo}` : ultimo}`
}
