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
 * O bairro na lista: o da mesma cidade primeiro, depois o que vale pra qualquer cidade (sem cidade). null = fora da
 * lista. `cidade` = a cidade do atendimento (a escolhida, ou a única do estado).
 */
export function bairroNaLista(lista: readonly BairroTaxa[], bairro: string, cidade: string | null | undefined): BairroTaxa | null {
  const chave = chaveBairro(bairro)
  if (!chave) return null
  const daCidade = chaveBairro(cidade ?? '')
  let geral: BairroTaxa | null = null
  for (const b of lista) {
    if (chaveBairro(b.nome) !== chave) continue
    if (!b.cidade) geral ??= b
    else if (daCidade && chaveBairro(b.cidade) === daCidade) return b
  }
  return geral
}

/**
 * Os bairros que combinam com o que a pessoa tá digitando (a sugestão embaixo do campo): os que começam com o texto
 * primeiro, depois os que têm uma palavra começando com ele; só os da cidade do atendimento (ou sem cidade).
 */
export function sugestoesDeBairro(lista: readonly BairroTaxa[], texto: string, cidade: string | null | undefined, max = 5): BairroTaxa[] {
  const t = chaveBairro(texto)
  if (!t) return []
  const daCidade = chaveBairro(cidade ?? '')
  const vale = (b: BairroTaxa) => !b.cidade || !daCidade || chaveBairro(b.cidade) === daCidade
  const comeca: BairroTaxa[] = []
  const palavra: BairroTaxa[] = []
  const vistos = new Set<string>()
  for (const b of lista) {
    if (!vale(b)) continue
    const k = chaveBairro(b.nome)
    if (vistos.has(k)) continue
    if (k.startsWith(t)) comeca.push(b)
    else if (k.includes(` ${t}`)) palavra.push(b)
    else continue
    vistos.add(k)
  }
  const ordem = (a: BairroTaxa, b: BairroTaxa) => a.nome.localeCompare(b.nome, 'pt-BR')
  return [...comeca.sort(ordem), ...palavra.sort(ordem)].slice(0, max)
}

/** O estado cobra por bairro? ('site', 'consulta' ou null = uma taxa só, o de sempre) */
export function modoBairro(canal: Canal | null | undefined): 'site' | 'consulta' | null {
  return canal?.taxaPorBairro?.modo ?? null
}

/**
 * A taxa do bairro do cliente: 'estado' (o estado cobra uma taxa só), 'consulta' (o cliente pergunta na conversa),
 * 'valor' (o bairro tá na lista com a taxa; o nome volta como o dono escreveu) ou 'consultar' (fora da lista, marcado
 * "consultar", ou o cliente ainda não disse o bairro: bairro null).
 */
export type TaxaDoBairro =
  | { tipo: 'estado' }
  | { tipo: 'consulta'; bairro: string | null }
  | { tipo: 'valor'; bairro: string; valor: number }
  | { tipo: 'consultar'; bairro: string | null; fora: boolean }

export function taxaDoBairro(canal: Canal, bairro: string | null | undefined, cidade: string | null | undefined): TaxaDoBairro {
  const tb = canal.taxaPorBairro
  if (!tb) return { tipo: 'estado' }
  const digitado = bairroDigitado(bairro)
  if (tb.modo === 'consulta') return { tipo: 'consulta', bairro: digitado || null }
  if (!digitado) return { tipo: 'consultar', bairro: null, fora: false }
  const b = bairroNaLista(tb.bairros, digitado, cidade)
  if (!b) return { tipo: 'consultar', bairro: digitado, fora: true }
  if (b.taxa == null) return { tipo: 'consultar', bairro: b.nome, fora: false }
  return { tipo: 'valor', bairro: b.nome, valor: b.taxa }
}

/** A frase pronta pra perguntar a taxa do bairro na conversa do estado. */
export function fraseConsultaBairro(bairro: string | null | undefined): string {
  const b = bairroDigitado(bairro)
  return b ? `Oi! Quanto fica a entrega pro bairro ${b}?` : 'Oi! Quanto fica a entrega pro meu bairro?'
}
