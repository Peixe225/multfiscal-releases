// O catálogo do site (src/dados/catalogo.json, junto no build) visto do painel: busca e o título sugerido do rateio.
import dados from '../dados/catalogo.json'
import type { Produto } from '../lib/tipos'

const produtos = (dados as { produtos: Produto[] }).produtos
const categorias = new Map((dados as { categorias: { id: string; nome: string }[] }).categorias.map((c) => [c.id, c.nome]))

export function produtoDoCatalogo(id: string): Produto | undefined {
  return produtos.find((p) => p.id === id)
}

export function nomeDaCategoria(id: string): string {
  return categorias.get(id) ?? id
}

/** "Arizona Green Tea 680 ml" (o nome com o tamanho, como o título do rateio). */
export function tituloSugerido(p: Produto): string {
  return p.tamanho && !p.nome.toLowerCase().includes(p.tamanho.toLowerCase()) ? `${p.nome} ${p.tamanho}` : p.nome
}

const sem = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Busca por nome, tamanho ou categoria; sem texto, todos (na ordem do catálogo). */
export function buscarProdutos(texto: string): Produto[] {
  const partes = sem(texto).split(/\s+/).filter(Boolean)
  if (!partes.length) return produtos
  return produtos.filter((p) => {
    const alvo = sem(`${p.nome} ${p.tamanho ?? ''} ${nomeDaCategoria(p.categoria)} ${p.id}`)
    return partes.every((x) => alvo.includes(x))
  })
}
