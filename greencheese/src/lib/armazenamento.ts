// localStorage pode falhar (aba anônima, navegador do Instagram com dados bloqueados). Nunca deixar quebrar o site.

export function ler<T>(chave: string, padrao: T): T {
  try {
    const v = localStorage.getItem(chave)
    return v == null ? padrao : (JSON.parse(v) as T)
  } catch {
    return padrao
  }
}

export function gravar(chave: string, valor: unknown): void {
  try {
    localStorage.setItem(chave, JSON.stringify(valor))
  } catch {
    /* sem armazenamento: segue sem lembrar */
  }
}

export function apagar(chave: string): void {
  try {
    localStorage.removeItem(chave)
  } catch {
    /* idem */
  }
}

export function lerSessao(chave: string): string | null {
  try {
    return sessionStorage.getItem(chave)
  } catch {
    return null
  }
}

export function gravarSessao(chave: string, valor: string): void {
  try {
    sessionStorage.setItem(chave, valor)
  } catch {
    /* idem */
  }
}

/** Armazenamento seguro para o persist do Zustand. */
export const armazenamentoSeguro = {
  getItem: (nome: string) => {
    try {
      return localStorage.getItem(nome)
    } catch {
      return null
    }
  },
  setItem: (nome: string, valor: string) => {
    try {
      localStorage.setItem(nome, valor)
    } catch {
      /* idem */
    }
  },
  removeItem: (nome: string) => {
    try {
      localStorage.removeItem(nome)
    } catch {
      /* idem */
    }
  },
}
