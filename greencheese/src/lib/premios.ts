// As regras dos prêmios do Teste minha sorte, sem estado nenhum: o que vale pra src/dados/sorte.ts (o embutido) vale
// pro que chega do servidor (o painel confere o mesmo, em src/painel/loja/validar.ts e no PHP). Fica fora do store da
// loja e do cupom.ts pra os dois usarem sem um importar o outro.
import { PALAVRAS_PROIBIDAS, type Premio } from '../dados/sorte'

const minusculoSemAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const PROIBIDAS = PALAVRAS_PROIBIDAS.map(minusculoSemAcento)

/** Primeira palavra proibida que aparece no texto (no começo de palavra: "tapa" não pega "etapa"), ou null. */
export function palavraProibida(texto: string): string | null {
  const t = minusculoSemAcento(texto)
  for (const p of PROIBIDAS) if (new RegExp(`(^|[^a-z0-9])${p}`).test(t)) return p
  return null
}

/** O pedaço do catálogo que decide se um prêmio vale: os produtos (e a categoria deles) e o que é bebida. */
export interface CatalogoDosPremios {
  produtos: readonly { id: string; categoria: string }[]
  categorias: readonly { id: string; bebida?: boolean }[]
}

const TIPOS = new Set<string>(['desconto-percentual', 'leve-x-pague-y', 'brinde'])

/** Por que o prêmio não entra (ou null). Prêmio nunca cai em bebida: as categorias marcadas `bebida`. */
export function motivoInvalido(p: Premio, idsVistos: Set<string>, cat: CatalogoDosPremios): string | null {
  const produtos = new Map(cat.produtos.map((x) => [x.id, x]))
  const categorias = new Set(cat.categorias.map((c) => c.id))
  const fora = new Set(cat.categorias.filter((c) => c.bebida).map((c) => c.id))
  if (!p.id || idsVistos.has(p.id)) return 'id vazio ou repetido'
  if (!TIPOS.has(p.tipo)) return 'tipo desconhecido'
  const alvos = p.aplicaA?.produtos ?? []
  const cats = p.aplicaA?.categorias ?? []
  if (!alvos.length && !cats.length) return 'aplicaA sem produto nem categoria'
  for (const id of alvos) {
    const x = produtos.get(id)
    if (!x) return `produto "${id}" não existe no catálogo`
    if (fora.has(x.categoria)) return `produto "${id}" é de ${x.categoria} (prêmio só em acessórios)`
  }
  for (const c of cats) {
    if (!categorias.has(c)) return `categoria "${c}" não existe no catálogo`
    if (fora.has(c)) return `categoria "${c}" não pode ter prêmio`
  }
  if (!(p.peso > 0)) return 'peso precisa ser maior que 0'
  if (!Number.isInteger(p.validadeDias) || p.validadeDias < 1 || p.validadeDias > 30) return 'validadeDias vai de 1 a 30'
  if (p.tipo === 'desconto-percentual' && !(typeof p.valor === 'number' && p.valor >= 1 && p.valor <= 50)) return 'percentual vai de 1 a 50'
  if (
    p.tipo === 'leve-x-pague-y' &&
    !(p.valor && Number.isInteger(p.valor.leve) && Number.isInteger(p.valor.pague) && p.valor.leve > p.valor.pague && p.valor.pague >= 1)
  )
    return 'leve precisa ser maior que pague, e pague pelo menos 1'
  if (p.tipo === 'brinde') {
    const x = p.valor ? produtos.get(p.valor.produto) : undefined
    if (!x) return `brinde "${p.valor?.produto}" não existe no catálogo`
    if (fora.has(x.categoria)) return `brinde "${p.valor.produto}" é de ${x.categoria}`
    if (!(p.valor.qtd >= 1)) return 'brinde precisa de qtd 1 ou mais'
  }
  for (const campo of [p.titulo, p.descricao, p.regra, p.comoUsar ?? '']) {
    if (typeof campo !== 'string') return 'texto torto'
    const w = palavraProibida(campo)
    if (w) return `palavra fora da lista ("${w}") em "${campo}"`
  }
  return null
}

/**
 * Os prêmios que passam nas regras. `rigido`: em dev, o que veio de src/dados/sorte.ts para com erro na tela (quem
 * editou vê na hora); o resto (no ar, ou o que veio do servidor) só fica de fora, com aviso no console.
 */
export function validarPremios(lista: readonly Premio[], cat: CatalogoDosPremios, rigido = false): Premio[] {
  const ok: Premio[] = []
  const ids = new Set<string>()
  for (const p of lista) {
    const motivo = motivoInvalido(p, ids, cat)
    ids.add(p.id)
    if (motivo) {
      if (rigido) throw new Error(`[sorte] prêmio "${p.id}": ${motivo}`)
      console.warn(`[sorte] prêmio "${p.id}" fora: ${motivo}`)
      continue
    }
    ok.push(p)
  }
  return ok
}
