// O catálogo visto do painel (a busca do Criar rateio e a arte do rateio): os produtos da loja do servidor (os que
// estão no site, com a foto que o dono mandou) e, enquanto ela não chega (ou sem ela), os embutidos no site
// (src/dados/catalogo.json). Busca e o título sugerido do rateio.
import dados from '../dados/catalogo.json'
import type { Arte } from '../lib/tipos'
import { doCache } from './dados'
import { CHAVE } from './loja/dados'
import type { LojaAdmin } from './loja/tipos'

export interface ProdutoDoCatalogo {
  id: string
  nome: string
  tamanho?: string
  categoria: string
  preco: number | null
  cor: string
  arte: Arte
  foto: string | null
}

const embutidos = (dados as { produtos: ProdutoDoCatalogo[] }).produtos
const categoriasEmbutidas = new Map((dados as { categorias: { id: string; nome: string }[] }).categorias.map((c) => [c.id, c.nome]))

/** Os produtos e as categorias de agora: os da loja do servidor (já lida por alguma tela) ou os embutidos. */
function catalogo(): { produtos: ProdutoDoCatalogo[]; categorias: Map<string, string> } {
  const l = doCache<LojaAdmin>(CHAVE)
  if (!l) return { produtos: embutidos, categorias: categoriasEmbutidas }
  return {
    produtos: l.produtos.filter((p) => p.ativo).map((p) => ({ id: p.id, nome: p.nome, tamanho: p.tamanho || undefined, categoria: p.categoria, preco: p.preco, cor: p.cor, arte: p.arte, foto: p.foto })),
    categorias: new Map(l.categorias.map((c) => [c.id, c.nome])),
  }
}

export function produtoDoCatalogo(id: string): ProdutoDoCatalogo | undefined {
  // produto que saiu do site (ou de antes da loja do servidor): o embutido ainda dá a arte do rateio antigo
  return catalogo().produtos.find((p) => p.id === id) ?? embutidos.find((p) => p.id === id)
}

export function nomeDaCategoria(id: string): string {
  return catalogo().categorias.get(id) ?? categoriasEmbutidas.get(id) ?? id
}

/** "Arizona Green Tea 680 ml" (o nome com o tamanho, como o título do rateio). */
export function tituloSugerido(p: { nome: string; tamanho?: string }): string {
  return p.tamanho && !p.nome.toLowerCase().includes(p.tamanho.toLowerCase()) ? `${p.nome} ${p.tamanho}` : p.nome
}

const sem = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Busca por nome, tamanho ou categoria; sem texto, todos (na ordem do catálogo). */
export function buscarProdutos(texto: string): ProdutoDoCatalogo[] {
  const { produtos, categorias } = catalogo()
  const partes = sem(texto).split(/\s+/).filter(Boolean)
  if (!partes.length) return produtos
  return produtos.filter((p) => {
    const alvo = sem(`${p.nome} ${p.tamanho ?? ''} ${categorias.get(p.categoria) ?? p.categoria} ${p.id}`)
    return partes.every((x) => alvo.includes(x))
  })
}
