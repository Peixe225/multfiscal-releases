// Tudo por query string (?uf=mg&cidade=teofilo-otoni&p=id&produto=id&chat=pedido): funciona em qualquer pasta da Hostinger, sem regra de servidor.

export interface Parametros {
  uf: string | null
  cidade: string | null
  /** Story do produto aberto. */
  p: string | null
  /** Página do produto aberta (a "aba" com descrição e sacola). */
  produto: string | null
  chat: string | null
}

export function lerParametros(): Parametros {
  const q = new URLSearchParams(location.search)
  const lim = (v: string | null) => (v ? v.trim().toLowerCase().slice(0, 60) : null)
  return { uf: lim(q.get('uf')), cidade: lim(q.get('cidade')), p: lim(q.get('p')), produto: lim(q.get('produto')), chat: lim(q.get('chat')) }
}

/** Atualiza a query sem recarregar e sem criar entrada no histórico. null remove a chave. */
export function atualizarParametros(mudancas: Partial<Parametros>): void {
  try {
    const u = new URL(location.href)
    for (const [k, v] of Object.entries(mudancas)) {
      if (v) u.searchParams.set(k, v)
      else u.searchParams.delete(k)
    }
    const nova = u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : '') + u.hash
    if (nova !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', nova)
  } catch {
    /* ignora */
  }
}

/** Link absoluto para compartilhar (produto ou estado), preservando a pasta onde o site está. */
export function linkCompartilhar(params: Record<string, string>): string {
  const u = new URL(location.href)
  u.search = ''
  u.hash = ''
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}
