// A taxa de entrega por bairro (pedido do Ian em 22/10: "o Matos poderá configurar a taxa de entrega a depender do
// bairro. Deixe duas opções, uma para aparecer no site (quando configurado) e a outra para que o cliente consulte o
// frete do bairro dele"). O estado escolhe no painel: uma taxa só (o de sempre) ou por bairro; por bairro, a lista
// aparece no site ('site') ou o cliente pergunta na conversa ('consulta'). Aqui fica a conta: achar o bairro do cliente
// na lista (sem acento, sem maiúscula, espaço e pontuação iguais: a mesma do servidor, gc_loja_chave_bairro) e dizer o
// que vale. Nada é inventado: bairro fora da lista, ou marcado "consultar", fica "a consultar".
// Sem import do resto do site além dos tipos: o scripts/conferir-mensagem.mjs empacota a mensagem (que usa isto) no Node.
import type { BairroTaxa, Canal } from '../dados/canais'

/** Bairros por estado, no máximo (o mesmo teto do servidor). */
export const MAX_BAIRROS = 400
/** Teto da taxa de um bairro, em reais (o mesmo do servidor). */
export const TAXA_BAIRRO_MAX = 500

/**
 * O nome pra comparar: sem acento, sem maiúscula, e espaço e pontuação viram um espaço só ("Copacabana", "COPACABANA"
 * e " copacabana. " são o mesmo; "Jardim  da Penha" e "Jardim-da-Penha" também). O "Copacabana" que o CEP preenche
 * casa com o "Copacabana" da lista.
 */
export function chaveBairro(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Mn}+/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o')
    .replace(/ª/g, 'a')
    .replace(/º/g, 'o')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** O bairro como o cliente digitou, limpo (espaços juntados, até 60 letras). '' = não disse. */
export function bairroDigitado(s: string | null | undefined): string {
  return [...(s ?? '').trim().replace(/\s+/g, ' ')].slice(0, 60).join('')
}

/**
 * O que a lista diz do bairro do cliente (a mesma conta do servidor, gc_loja_achar_bairro):
 * - com a cidade do cliente (a escolhida, a única do estado, ou a do CEP): o bairro daquela cidade e, sem ele, o que
 *   vale pra qualquer cidade (sem cidade);
 * - sem a cidade (a sacola de quem não escolheu a cidade num estado com mais de uma): o bairro com esse nome, quando a
 *   taxa é uma só (um bairro só, ou o mesmo valor em todas as cidades); com taxas diferentes em cidades diferentes
 *   ("Centro" de Vila Velha e de Vitória), 'varias' com as opções: o site pede pra escolher a da cidade.
 */
export type Achado = { tipo: 'achou'; bairro: BairroTaxa } | { tipo: 'fora' } | { tipo: 'varias'; opcoes: BairroTaxa[] }

/** Entre os bairros de mesmo nome (a mesma chave), o que vale pra essa cidade (ou as opções, sem cidade). */
function entreOsMesmos(mesmos: readonly BairroTaxa[], cidade: string | null | undefined): Achado {
  if (!mesmos.length) return { tipo: 'fora' }
  const geral = mesmos.find((b) => !b.cidade) ?? null
  const daCidade = chaveBairro(cidade ?? '')
  if (daCidade) {
    const c = mesmos.find((b) => !!b.cidade && chaveBairro(b.cidade) === daCidade)
    return c ? { tipo: 'achou', bairro: c } : geral ? { tipo: 'achou', bairro: geral } : { tipo: 'fora' }
  }
  if (new Set(mesmos.map((b) => b.taxa)).size === 1) return { tipo: 'achou', bairro: geral ?? mesmos[0] }
  return { tipo: 'varias', opcoes: [...mesmos] }
}

export function acharBairro(lista: readonly BairroTaxa[], bairro: string, cidade: string | null | undefined): Achado {
  const chave = chaveBairro(bairro)
  if (!chave) return { tipo: 'fora' }
  return entreOsMesmos(
    lista.filter((b) => chaveBairro(b.nome) === chave),
    cidade,
  )
}

/** O bairro na lista (acharBairro), sem as opções: null = fora da lista, ou em várias cidades com taxas diferentes. */
export function bairroNaLista(lista: readonly BairroTaxa[], bairro: string, cidade: string | null | undefined): BairroTaxa | null {
  const a = acharBairro(lista, bairro, cidade)
  return a.tipo === 'achou' ? a.bairro : null
}

/**
 * Os bairros que combinam com o que a pessoa tá digitando (a sugestão embaixo do campo): os que começam com o texto
 * primeiro, depois os que têm uma palavra começando com ele. Cada nome aparece uma vez, com a taxa que vale pra cidade
 * do atendimento; sem a cidade, o mesmo nome com taxas diferentes em cidades diferentes aparece uma vez por cidade (com
 * a cidade junto: a escolha diz a cidade). Nunca sugere um bairro que a conta da taxa (acharBairro) não acharia.
 */
export function sugestoesDeBairro(lista: readonly BairroTaxa[], texto: string, cidade: string | null | undefined, max = 5): BairroTaxa[] {
  const t = chaveBairro(texto)
  if (!t) return []
  const porNome = new Map<string, BairroTaxa[]>()
  for (const b of lista) {
    const k = chaveBairro(b.nome)
    if (!k.startsWith(t) && !k.includes(` ${t}`)) continue
    const mesmos = porNome.get(k)
    if (mesmos) mesmos.push(b)
    else porNome.set(k, [b])
  }
  const comeca: BairroTaxa[] = []
  const palavra: BairroTaxa[] = []
  for (const [k, mesmos] of porNome) {
    const a = entreOsMesmos(mesmos, cidade)
    if (a.tipo === 'fora') continue
    // o mesmo valor em mais de uma cidade (sem a cidade do cliente): uma sugestão só, sem cidade
    const achados = a.tipo === 'varias' ? a.opcoes : [mesmos.length > 1 && !chaveBairro(cidade ?? '') ? { nome: a.bairro.nome, taxa: a.bairro.taxa } : a.bairro]
    ;(k.startsWith(t) ? comeca : palavra).push(...achados)
  }
  const ordem = (a: BairroTaxa, b: BairroTaxa) => a.nome.localeCompare(b.nome, 'pt-BR') || (a.cidade ?? '').localeCompare(b.cidade ?? '', 'pt-BR')
  return [...comeca.sort(ordem), ...palavra.sort(ordem)].slice(0, max)
}

/**
 * O bairro do endereço escrito à mão (o pedido guiado sem CEP): o bairro da lista que tá escrito no endereço vale mais
 * que o guardado no aparelho (o "Teu bairro" de outra visita, que pode ser de outro endereço). Com o endereço citando
 * um bairro da lista, é ele (o nome mais comprido: "Jardim da Penha" antes de "Penha"); sem citar nenhum, o guardado
 * (a mensagem diz o nome dele: "taxa do bairro Copacabana: R$ 12,00", e quem lê vê de qual bairro é a taxa). Sem lista
 * no site (o cliente consulta): o guardado.
 */
export function bairroDoEndereco(canal: Canal, endereco: string, guardado: string | null | undefined, cidade: string | null | undefined): string | null {
  const tb = canal.taxaPorBairro
  if (!tb) return null
  const g = bairroDigitado(guardado) || null
  if (tb.modo !== 'site') return g
  const texto = ` ${chaveBairro(endereco)} `
  const daCidade = chaveBairro(cidade ?? '')
  let citado: BairroTaxa | null = null
  for (const b of tb.bairros) {
    const k = chaveBairro(b.nome)
    if (!k || !texto.includes(` ${k} `)) continue
    if (daCidade && b.cidade && chaveBairro(b.cidade) !== daCidade) continue
    if (!citado || k.length > chaveBairro(citado.nome).length) citado = b
  }
  if (!citado) return g
  return g && chaveBairro(g) === chaveBairro(citado.nome) ? g : citado.nome
}

/** O estado cobra por bairro? ('site', 'consulta' ou null = uma taxa só, o de sempre) */
export function modoBairro(canal: Canal | null | undefined): 'site' | 'consulta' | null {
  return canal?.taxaPorBairro?.modo ?? null
}

/**
 * A taxa do bairro do cliente: 'estado' (o estado cobra uma taxa só), 'consulta' (o cliente pergunta na conversa),
 * 'valor' (o bairro tá na lista com a taxa; o nome volta como o dono escreveu) ou 'consultar' (fora da lista, marcado
 * "consultar", em mais de uma cidade com taxas diferentes e o cliente sem cidade, ou o cliente ainda não disse o
 * bairro: bairro null). `cidade` = a cidade do atendimento (a escolhida, a única do estado, ou a do CEP).
 */
export type TaxaDoBairro =
  | { tipo: 'estado' }
  | { tipo: 'consulta'; bairro: string | null }
  | { tipo: 'valor'; bairro: string; valor: number }
  /** opcoes: o mesmo bairro em mais de uma cidade, com taxas diferentes, e o cliente sem cidade (escolhe a dele). */
  | { tipo: 'consultar'; bairro: string | null; fora: boolean; opcoes?: BairroTaxa[] }

export function taxaDoBairro(canal: Canal, bairro: string | null | undefined, cidade: string | null | undefined): TaxaDoBairro {
  const tb = canal.taxaPorBairro
  if (!tb) return { tipo: 'estado' }
  const digitado = bairroDigitado(bairro)
  if (tb.modo === 'consulta') return { tipo: 'consulta', bairro: digitado || null }
  if (!digitado) return { tipo: 'consultar', bairro: null, fora: false }
  const a = acharBairro(tb.bairros, digitado, cidade)
  if (a.tipo === 'fora') return { tipo: 'consultar', bairro: digitado, fora: true }
  if (a.tipo === 'varias') return { tipo: 'consultar', bairro: a.opcoes[0].nome, fora: false, opcoes: a.opcoes }
  const b = a.bairro
  if (b.taxa == null) return { tipo: 'consultar', bairro: b.nome, fora: false }
  return { tipo: 'valor', bairro: b.nome, valor: b.taxa }
}

/** A frase pronta pra perguntar a taxa do bairro na conversa do estado. */
export function fraseConsultaBairro(bairro: string | null | undefined): string {
  const b = bairroDigitado(bairro)
  return b ? `Oi! Quanto fica a entrega pro bairro ${b}?` : 'Oi! Quanto fica a entrega pro meu bairro?'
}
