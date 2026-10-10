// As regras da vitrine da rua (sem React nem loja: o teste e o site usam as mesmas). Ver vitrine.ts.
//
// Na rua, nada de bebida alcoólica nem de tabaco (Lei 9.294/1996 e as regras da Meta; PENDENCIAS, "Mercador e
// elenco"), nada aceso e nenhum isqueiro (o forro do casaco da rua já deixava o isqueiro do repost de fora), e o nome
// que vai na plaquinha passa pela lista PALAVRAS_PROIBIDAS, como as falas.

import { PALAVRAS_PROIBIDAS } from '../../dados/sorte'
import { pareceAlcool } from '../../lib/alcool'
import type { Categoria, Produto } from '../../lib/tipos'
import { termoProibido } from '../../painel/proibidos'

/** Quantos produtos giram na rua, no máximo (as barrinhas do story também são 8). */
export const MAX_VITRINE = 8

/** Desenho de garrafa: na rua, nunca (é o desenho dos destilados; refrigerante é lata). */
const GARRAFAS = new Set(['garrafa-quadrada', 'garrafa-gin', 'garrafa-conhaque', 'garrafa-licor'])
/** Isqueiro (o desenho e o nome): fica fora da rua, como no forro do casaco dela. */
const ISQUEIRO = ['isqueiro', 'isqueiros', 'lighter', 'zippo', 'macarico']

/**
 * Palavras de categoria de bebida alcoólica (sem acento, palavra inteira), além das marcas e tipos de src/lib/alcool.ts:
 * a categoria "Destilados" e as que o dono pode criar ("Cervejas", "Drinks", "Adega"...).
 */
const CATEGORIA_ALCOOL = [
  'destilado', 'destilados', 'alcool', 'alcoolica', 'alcoolicas', 'alcoolico', 'alcoolicos', 'drink', 'drinks', 'adega',
  'licores', 'whiskies', 'whiskys', 'destilaria', 'coquetel', 'coqueteis', 'bar', 'boteco', 'dose', 'doses',
]

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
/** O texto em palavras soltas, sem acento, com espaço nas pontas (" seda ocb premium slim "). */
const palavras = (s: string) => ` ${semAcento(s).replace(/['’`´]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `
const PROIBIDAS = PALAVRAS_PROIBIDAS.map((p) => palavras(p).trim())

/** A categoria é de bebida alcoólica pelo nome dela (ou pelo id)? */
export function categoriaDeAlcool(c: Pick<Categoria, 'id' | 'nome' | 'curto'>): boolean {
  const t = palavras(`${c.id.replace(/-/g, ' ')} ${c.nome} ${c.curto}`)
  return CATEGORIA_ALCOOL.some((p) => t.includes(` ${p} `)) || pareceAlcool(`${c.nome} ${c.curto}`)
}

/** O produto, pelo que ele mesmo diz (nome, tamanho, linha de baixo, descrição e desenho), é bebida alcoólica? */
function produtoDeAlcool(p: Produto): boolean {
  return GARRAFAS.has(p.arte?.tipo) || pareceAlcool(`${p.nome} ${p.tamanho ?? ''} ${p.detalhe ?? ''} ${p.descricao ?? ''}`)
}

/**
 * Pode aparecer na rua? Não pode: bebida alcoólica (pelo produto ou pela categoria), tabaco (a lista do servidor e do
 * painel; nunca entra no catálogo, mas a rua confere de novo), isqueiro e nome com palavra da lista PALAVRAS_PROIBIDAS
 * (a placa da rua passa pela mesma lista das falas). Numa categoria de bebida, basta um produto dela com cara de álcool para a
 * categoria inteira ficar fora (bebida misturada: a lata sem nome conhecido pode ser cerveja).
 */
export function permitidoNaRua(p: Produto, categorias: readonly Categoria[], todos: readonly Produto[]): boolean {
  const cat = categorias.find((c) => c.id === p.categoria)
  if (!cat || categoriaDeAlcool(cat) || produtoDeAlcool(p)) return false
  if (termoProibido(`${p.nome} ${p.tamanho ?? ''} ${p.detalhe ?? ''}`)) return false
  const nome = palavras(p.nome)
  if (PROIBIDAS.some((w) => nome.includes(` ${w} `))) return false
  if (p.arte?.tipo === 'isqueiro' || ISQUEIRO.some((w) => nome.includes(` ${w} `))) return false
  if (cat.bebida && todos.some((o) => o.categoria === cat.id && produtoDeAlcool(o))) return false
  return true
}

export interface LojaDaVitrine {
  produtos: readonly Produto[]
  categorias: readonly Categoria[]
  canais: readonly { uf: string }[]
  stories: Readonly<Record<string, readonly string[]>>
}

/**
 * Os produtos da vitrine no estado: os do story do Início na ordem do dono e depois os outros permitidos (com preço
 * primeiro, os de exemplo por último), todos à venda no estado e permitidos na rua. Até MAX_VITRINE.
 */
export function produtosDaVitrine(l: LojaDaVitrine, uf: string | null | undefined): Produto[] {
  if (!uf || !l.canais.some((c) => c.uf === uf)) return []
  const ok = (p: Produto | undefined): p is Produto => !!p && p.disponivel[uf] === true && permitidoNaRua(p, l.categorias, l.produtos)
  const doDono = (l.stories[uf] ?? []).map((id) => l.produtos.find((p) => p.id === id)).filter(ok)
  const ja = new Set(doDono.map((p) => p.id))
  const peso = (p: Produto) => (p.demo ? 2 : 0) + (p.preco == null ? 1 : 0)
  const resto = l.produtos.filter((p) => !ja.has(p.id) && ok(p)).sort((a, b) => peso(a) - peso(b))
  return [...doDono, ...resto].slice(0, MAX_VITRINE)
}

