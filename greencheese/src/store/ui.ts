import { create } from 'zustand'
import { abaDaURL, type Aba } from '../lib/url'

export interface StoryAberto {
  /** Ids da sequência (a categoria filtrada no momento do toque). */
  lista: string[]
  indice: number
  /** Retângulo do card de origem, para a transição card → story. */
  origem: DOMRect | null
}

/** De onde a página do produto foi aberta (muda o que o "Voltar" mostra e a transição de entrada). */
export type OrigemPagina = 'hero' | 'story' | 'catalogo' | 'sacola' | 'link'

/** Página do produto (a "aba" do produto, no molde da página de produto do Instagram Shopping). */
export interface PaginaAberta {
  /** Pilha de produtos: abrir um "combina com" de dentro da página empilha; "Voltar" desempilha. O topo é o último. */
  pilha: string[]
  origem: OrigemPagina
}

interface Aviso {
  id: number
  texto: string
}

/** Tela pedida ao abrir um interativo (ex.: "Guardar meu prêmio" no adesivo abre direto no cadastro). */
export type TelaInterativo = 'cadastro' | 'entrar'

/** Interativo aberto (a "aba" do jogo, no molde da página do produto). */
export interface InterativoAberto {
  id: string
  tela?: TelaInterativo
}

interface UIState {
  story: StoryAberto | null
  sacolaAberta: boolean
  seletorAberto: boolean
  /** Story de atendimento do estado (destaque "DELIVERY RJ"). */
  infoAberto: boolean
  /** Produto que o story do hero está mostrando (a barra "Enviar mensagem…" responde a ele). */
  heroProduto: string | null
  aberturaAtiva: boolean
  pagina: PaginaAberta | null
  /** Troca de estado esperando confirmação (itens da sacola que não têm no novo estado). */
  trocaPendente: { uf: string; cidade: string | null; fora: string[] } | null
  aviso: Aviso | null
  /** Interativo aberto ("Teste minha sorte" e os próximos). */
  interativo: InterativoAberto | null
  /** Folha "Minha conta". */
  contaAberta: boolean
  /** Vista do site (Início, Catálogo, Por estado). Só o src/lib/abas.ts troca (URL e histórico vão junto). */
  aba: Aba
  setAba: (a: Aba) => void
  abrirInterativo: (id: string, tela?: TelaInterativo) => void
  fecharInterativo: () => void
  setConta: (v: boolean) => void
  setTroca: (t: UIState['trocaPendente']) => void
  setInfo: (v: boolean) => void
  setHeroProduto: (id: string | null) => void
  setAbertura: (v: boolean) => void
  /** Abre a página do produto; com uma página já aberta, empilha o novo produto por cima. */
  abrirPagina: (id: string, origem?: OrigemPagina) => void
  /** Volta um produto na pilha; no primeiro, fecha a página. */
  voltarPagina: () => void
  fecharPagina: () => void
  abrirStory: (lista: string[], indice: number, origem?: DOMRect | null) => void
  irStory: (indice: number) => void
  fecharStory: () => void
  setSacola: (v: boolean) => void
  setSeletor: (v: boolean) => void
  avisar: (texto: string) => void
}

let n = 0

export const useUI = create<UIState>((set) => ({
  story: null,
  sacolaAberta: false,
  seletorAberto: false,
  infoAberto: false,
  heroProduto: null,
  aberturaAtiva: false,
  pagina: null,
  trocaPendente: null,
  aviso: null,
  interativo: null,
  contaAberta: false,
  aba: abaDaURL(),
  setAba: (a) => set({ aba: a }),
  abrirInterativo: (id, tela) => set({ interativo: { id, tela } }),
  fecharInterativo: () => set({ interativo: null }),
  setConta: (v) => set({ contaAberta: v }),
  setTroca: (t) => set({ trocaPendente: t }),
  setInfo: (v) => set({ infoAberto: v }),
  setHeroProduto: (id) => set({ heroProduto: id }),
  setAbertura: (v) => set({ aberturaAtiva: v }),
  abrirPagina: (id, origem = 'link') =>
    set((s) =>
      s.pagina
        ? s.pagina.pilha[s.pagina.pilha.length - 1] === id
          ? s
          : { pagina: { ...s.pagina, pilha: [...s.pagina.pilha, id] } }
        : { pagina: { pilha: [id], origem } },
    ),
  voltarPagina: () =>
    set((s) => (!s.pagina || s.pagina.pilha.length <= 1 ? { pagina: null } : { pagina: { ...s.pagina, pilha: s.pagina.pilha.slice(0, -1) } })),
  fecharPagina: () => set({ pagina: null }),
  abrirStory: (lista, indice, origem = null) => set({ story: { lista, indice, origem } }),
  irStory: (indice) => set((s) => (s.story ? { story: { ...s.story, indice, origem: null } } : s)),
  fecharStory: () => set({ story: null }),
  setSacola: (v) => set({ sacolaAberta: v }),
  setSeletor: (v) => set({ seletorAberto: v }),
  avisar: (texto) => set({ aviso: { id: ++n, texto } }),
}))
