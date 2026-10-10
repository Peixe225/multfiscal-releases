// Lembranças deste aparelho (login, rascunho do formulário, quem já foi avisado). Só conveniência: sem
// localStorage (aba anônima, bloqueado) o painel funciona igual, só não lembra.
const PREFIXO = 'gc-painel-'

export function lido(chave: string): string | null {
  try {
    return localStorage.getItem(PREFIXO + chave)
  } catch {
    return null
  }
}

export function lembrar(chave: string, valor: string | null): void {
  try {
    if (valor == null) localStorage.removeItem(PREFIXO + chave)
    else localStorage.setItem(PREFIXO + chave, valor)
  } catch {
    /* sem armazenamento: segue sem lembrar */
  }
}

export function lidoJson<T>(chave: string): T | null {
  const t = lido(chave)
  if (!t) return null
  try {
    return JSON.parse(t) as T
  } catch {
    return null
  }
}

export function lembrarJson(chave: string, valor: unknown): void {
  lembrar(chave, valor == null ? null : JSON.stringify(valor))
}
