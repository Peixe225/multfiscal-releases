// Tudo por query string (?uf=mg&cidade=teofilo-otoni&p=id&produto=id&chat=pedido&jogo=sorte&aba=catalogo):
// funciona em qualquer pasta da Hostinger, sem regra de servidor.

export interface Parametros {
  uf: string | null
  cidade: string | null
  /** Story do produto aberto. */
  p: string | null
  /** Página do produto aberta (a "aba" com descrição e sacola). */
  produto: string | null
  chat: string | null
  /** Interativo aberto (?jogo=sorte). */
  jogo: string | null
  /** Aba do site (?aba=catalogo | estados; sem parâmetro = Início). Quem escreve é o src/lib/abas.ts. */
  aba: string | null
}

export function lerParametros(): Parametros {
  const q = new URLSearchParams(location.search)
  const lim = (v: string | null) => (v ? v.trim().toLowerCase().slice(0, 60) : null)
  return {
    uf: lim(q.get('uf')),
    cidade: lim(q.get('cidade')),
    p: lim(q.get('p')),
    produto: lim(q.get('produto')),
    chat: lim(q.get('chat')),
    jogo: lim(q.get('jogo')),
    aba: lim(q.get('aba')),
  }
}

/** As vistas do site: o Início (story + perfil), o Catálogo e Por estado. Camadas (story, sacola, jogo…) não são abas. */
export type Aba = 'inicio' | 'catalogo' | 'estados'

/** Aba pedida na URL. Sem parâmetro, ou com valor desconhecido, é o Início. */
export function abaDaURL(): Aba {
  const v = lerParametros().aba
  return v === 'catalogo' || v === 'estados' ? v : 'inicio'
}

/**
 * Links velhos da Home 2, que ficou em teste e saiu (?home=2, ?home2, ?Home2, ?HOME=1…): a chave sai da URL e nada
 * muda, a home é uma só. Roda antes do primeiro render (src/lib/abas.ts).
 */
export function limparHomeVelha(): void {
  try {
    const q = new URLSearchParams(location.search)
    const velhas = [...q.keys()].filter((k) => /^home(-?[12])?$/i.test(k))
    if (!velhas.length) return
    velhas.forEach((k) => q.delete(k))
    const s = q.toString()
    history.replaceState(history.state, '', `${location.pathname}${s ? `?${s}` : ''}${location.hash}`)
  } catch {
    /* ignora */
  }
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

// A troca feita numa camada (seletor, story por cima da sacola…) escreve na entrada do histórico da camada; quando
// ela fecha, a volta cai na entrada de baixo, que ainda tem a URL velha (?uf=mg com o site em RJ: recarregar voltaria).
// Quem escreve na URL diz aqui o que ela deve ter agora, e isso é regravado na entrada onde a volta caiu.
const fontes = new Set<() => Partial<Parametros>>()
let ouvindoVolta = false

/** Mantém na URL o que `fonte` devolve depois de cada volta do histórico. Devolve quem desliga. */
export function manterNaURL(fonte: () => Partial<Parametros>): () => void {
  fontes.add(fonte)
  if (!ouvindoVolta) {
    ouvindoVolta = true
    window.addEventListener('popstate', () => fontes.forEach((f) => atualizarParametros(f())))
  }
  return () => {
    fontes.delete(fonte)
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
