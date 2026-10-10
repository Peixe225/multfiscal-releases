// Tudo por query string (?uf=mg&cidade=teofilo-otoni&p=id&produto=id&chat=pedido&jogo=sorte&aba=mercado&rateio=id e
// ?home=2, a Home 2): funciona em qualquer pasta da Hostinger, sem regra de servidor.

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
  /** Aba do site (?aba=mercado (ou catalogo) | rateio | estados; sem parâmetro = Início). Quem escreve é o src/lib/abas.ts. */
  aba: string | null
  /** Página de um rateio aberta (?rateio=<id>), o link que vai no adesivo dos stories. */
  rateio: string | null
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
    rateio: lim(q.get('rateio')),
  }
}

/** As vistas do site: o Início (story + perfil), o Catálogo, o Rateio e Por estado. Camadas (story, sacola, jogo…) não são abas. */
export type Aba = 'inicio' | 'catalogo' | 'rateio' | 'estados'

/** A aba Catálogo virou Mercado: ?aba=mercado abre ela (o id de dentro continua 'catalogo'; ?aba=catalogo vale). */
const APELIDOS: Record<string, string> = { mercado: 'catalogo' }
/** Como a aba aparece na URL (o Catálogo sai como ?aba=mercado). */
export function abaNaURL(a: Aba): string {
  return a === 'catalogo' ? 'mercado' : a
}

/** Aba pedida na URL. Sem parâmetro, ou com valor desconhecido, é o Início. */
export function abaDaURL(): Aba {
  const p = lerParametros().aba
  const v = p ? (APELIDOS[p] ?? p) : p
  return v === 'catalogo' || v === 'rateio' || v === 'estados' ? v : 'inicio'
}

// ---------- a Home 2 (oprojeto.online/greencheese/home2/, pedido do Ian em 10/10) ----------
// Duas homes, que só mudam no celular: a de sempre, com a rua do mercador como o 1º story do Início, e a Home 2, com o
// topo de 08/10 (o 1º story é de produto) e a rua no fim do Início, depois da grade. Quem escolhe é o endereço:
// /home2/ (e Home2/, HOME2/) leva para ../?home=2 mantendo o resto do link (public/home2/ir.js) e a chave fica na URL a
// visita inteira: as trocas de aba, as camadas e o voltar só mexem nas chaves delas (atualizarParametros, urlCom), e os
// links que a pessoa abre em aba nova (hrefAba, o produto do story) levam a chave junto. Recarregar e voltar do WhatsApp
// mantêm a Home 2 (a URL é a mesma); abrir /greencheese/ sem a chave é a home de sempre. O que sai do site para outra
// pessoa (linkCompartilhar: o produto, o rateio, a Sorte) é o endereço da loja, sem a chave.

/** As chaves da home na URL: home, home1, home2, home-1, home-2, em qualquer caixa. */
const CHAVE_HOME = /^home(-?[12])?$/i

/** A URL pede a Home 2? ?home=2, e os jeitos velhos ?home2, ?Home2, ?HOME=2, ?home-2 (?home=1, ?home1: a de sempre). */
function pedeHome2(q: URLSearchParams): boolean {
  return [...q.keys()].some((k) => CHAVE_HOME.test(k) && (/2$/.test(k) || (!/1$/.test(k) && q.get(k) === '2')))
}

let home2: boolean | null = null

/**
 * Lê a home pedida e deixa a URL no jeito de sempre antes do primeiro render (src/lib/abas.ts): na Home 2, ?home=2 na
 * frente e só ele; na de sempre, nenhuma chave home*.
 */
export function normalizarHome(): void {
  try {
    const q = new URLSearchParams(location.search)
    home2 = pedeHome2(q)
    const resto = [...q.entries()].filter(([k]) => !CHAVE_HOME.test(k))
    const nova = new URLSearchParams([...(home2 ? [['home', '2']] : []), ...resto]).toString()
    if (nova === q.toString()) return
    history.replaceState(history.state, '', `${location.pathname}${nova ? `?${nova}` : ''}${location.hash}`)
  } catch {
    /* ignora */
  }
}

/** Esta visita é a Home 2 (o celular com a rua no fim do Início)? Não muda durante a visita. */
export function ehHome2(): boolean {
  if (home2 == null) {
    try {
      home2 = pedeHome2(new URLSearchParams(location.search))
    } catch {
      home2 = false
    }
  }
  return home2
}

/**
 * A query de um link que a própria pessoa abre (em aba nova, segurando o dedo): os parâmetros pedidos e, na Home 2, o
 * ?home=2 na frente, para ela continuar na mesma home. Sem nada, o endereço da página.
 */
export function consultaDaVisita(params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams(ehHome2() ? [['home', '2']] : [])
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v)
  const s = q.toString()
  return s ? `?${s}` : location.pathname
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

/**
 * Link absoluto para compartilhar (produto ou estado), preservando a pasta onde o site está. Vai para outra pessoa: o
 * endereço da loja, sem a chave da Home 2.
 */
export function linkCompartilhar(params: Record<string, string>): string {
  const u = new URL(location.href)
  u.search = ''
  u.hash = ''
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}
