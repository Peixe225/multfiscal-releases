// Uso dos cupons (o que baixa junto com o jogo, a sacola e a conta, fora do pedaço principal): código e sorteio por
// peso, prêmios que valem no estado, o retrato do prêmio e a situação do cupom no pedido.
// Na prévia tudo roda no aparelho; na versão oficial, sorteio, código e limite são validados no servidor.
import { canalDa } from '../dados/canais'
import type { Premio } from '../dados/sorte'
import { disponivelEm, useCatalogo } from '../store/catalogo'
import type { Cupom, RetratoPremio } from '../store/conta'
import type { LinhaSacola } from '../store/derivados'
import { premiosValidos, statusDo } from './cupom'

// o nome do prêmio mora em cupom.ts (o adesivo do site, no pedaço principal, também usa)
export { destaqueDo, fraseDoPremio, nomeCategoria, nomeDoPremio } from './cupom'
import type { Produto } from './tipos'

/* ───────────────────────── código e sorteio ───────────────────────── */

const ALFABETO = 'ABCDEFGHJKMNPQRTUVWXY346789' // sem I, L, O, 0, 1 (WhatsApp) nem S, 5, Z, 2 (na Pixelify o 5 vira S e o 2 vira Z)

function aleatorios(n: number): Uint32Array {
  const a = new Uint32Array(n)
  try {
    crypto.getRandomValues(a)
  } catch {
    for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 2 ** 32) // reserva: navegador sem crypto
  }
  return a
}

/** `${prefixo}-` + 4 caracteres. Sorteia de novo se o código já existe neste aparelho. Só nasce quando o cupom é guardado. */
export function gerarCodigo(prefixo: string, existentes: Set<string>): string {
  let c = ''
  for (let t = 0; t < 64; t++) {
    c = `${prefixo}-${Array.from(aleatorios(4), (n) => ALFABETO[n % ALFABETO.length]).join('')}`
    if (!existentes.has(c)) return c
  }
  return c
}

/** Escolhe por peso (crypto.getRandomValues; Uint32 / 2^32). */
export function sortear<T extends { peso: number }>(lista: T[]): T | null {
  if (!lista.length) return null
  const total = lista.reduce((s, p) => s + p.peso, 0)
  let r = (aleatorios(1)[0] / 2 ** 32) * total
  for (const p of lista) {
    r -= p.peso
    if (r < 0) return p
  }
  return lista[lista.length - 1]
}

function valeNaUf(p: Premio, uf: string): boolean {
  const produtos = useCatalogo.getState().produtos
  const alvo = produtos.some((x) => (p.aplicaA.produtos?.includes(x.id) || p.aplicaA.categorias?.includes(x.categoria)) && disponivelEm(x, uf))
  if (!alvo) return false
  if (p.tipo === 'brinde') {
    const b = produtos.find((x) => x.id === p.valor.produto)
    return !!b && disponivelEm(b, uf)
  }
  return true
}

/** Só os prêmios que a pessoa consegue usar no estado dela. Sem estado (ou sem atendimento), todos os válidos. */
export function premiosElegiveis(uf: string | null | undefined): Premio[] {
  const validos = premiosValidos()
  if (!uf || !canalDa(uf)) return validos
  const aqui = validos.filter((p) => valeNaUf(p, uf))
  return aqui.length ? aqui : validos
}

/** Retrato do prêmio no dia em que foi ganho. */
export function retratoDe(p: Premio): RetratoPremio {
  const base = { titulo: p.titulo, regra: p.regra, aplicaA: p.aplicaA, comoUsar: p.comoUsar }
  return { ...base, tipo: p.tipo, valor: p.valor } as RetratoPremio
}

/* ───────────────────────── situação no pedido ───────────────────────── */

export type Situacao =
  | { tipo: 'usado' | 'vencido' | 'encerrado' }
  | { tipo: 'fora-do-catalogo' }
  | { tipo: 'indisponivel-aqui'; produto: Produto | null }
  | { tipo: 'falta-produto'; produto?: Produto; categoria?: string; precisa: number }
  | { tipo: 'qtd-insuficiente'; produto?: Produto; categoria?: string; tem: number; precisa: number }
  | { tipo: 'ok' }

/**
 * O cupom vale nesse pedido? Percentual: 1 ou mais do produto. Leve X pague Y: X ou mais. Brinde: 1 item da
 * categoria no pedido e o brinde disponível no estado. `linhas` = useLinhasSacola().todas.
 */
export function situacaoNoPedido(c: Cupom, linhas: LinhaSacola[], uf: string | null, agora: number): Situacao {
  const st = statusDo(c, agora)
  if (st !== 'ativo') return { tipo: st }
  const r = c.retrato
  const produtos = useCatalogo.getState().produtos
  const ids = r.aplicaA.produtos ?? []
  const cats = r.aplicaA.categorias ?? []
  const alvos = ids.map((id) => produtos.find((p) => p.id === id)).filter((p): p is Produto => !!p)
  const brinde = r.tipo === 'brinde' ? produtos.find((p) => p.id === r.valor.produto) : undefined
  if ((ids.length && !alvos.length) || (r.tipo === 'brinde' && !brinde)) return { tipo: 'fora-do-catalogo' }
  const daCat = produtos.filter((p) => cats.includes(p.categoria))
  const atendido = !!canalDa(uf)
  const disp = (p: Produto) => atendido && disponivelEm(p, uf)
  if (![...alvos, ...daCat].some(disp)) return { tipo: 'indisponivel-aqui', produto: alvos[0] ?? daCat[0] ?? null }
  if (brinde && !disp(brinde)) return { tipo: 'indisponivel-aqui', produto: brinde }
  const vale = (p: Produto) => alvos.some((a) => a.id === p.id) || cats.includes(p.categoria)
  const tem = linhas.filter((l) => l.disponivel && vale(l.produto)).reduce((n, l) => n + l.qtd, 0)
  const produto = alvos.find(disp) ?? alvos[0]
  const categoria = cats[0]
  const precisa = r.tipo === 'leve-x-pague-y' ? r.valor.leve : 1
  if (tem === 0) return { tipo: 'falta-produto', produto, categoria, precisa }
  if (tem < precisa) return { tipo: 'qtd-insuficiente', produto, categoria, tem, precisa }
  return { tipo: 'ok' }
}

/** O que vai em DadosPedido.cupom (a linha do WhatsApp). */
export function linhaCupom(c: Cupom, origem: string, exemplo: boolean): { codigo: string; regra: string; origem: string; exemplo: boolean } {
  return { codigo: c.codigo, regra: c.retrato.regra, origem, exemplo }
}

/** Nome curto do produto para frases apertadas: "OCB" de "Seda OCB Premium Slim". */
export function nomeCurto(p: Produto): string {
  const sem = p.nome.replace(/^(Seda|Piteira de|Dichavador de|Bandeja|Cuia de|Isqueiro)\s+/i, '')
  const primeira = sem.split(' ')[0]
  return /^[A-Z]{2,}$/.test(primeira) ? primeira : p.nome
}
