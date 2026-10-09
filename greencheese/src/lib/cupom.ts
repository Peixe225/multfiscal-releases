// Núcleo dos cupons dos interativos: validação dos prêmios, relógio de Brasília, status e os formatadores de data.
// É o que as entradas do site (destaque, lateral, adesivo) precisam, então fica no pedaço principal, junto com o nome
// do prêmio. Sorteio, código e situação no pedido ficam em cupom-uso.ts (baixam com o jogo, a sacola e a conta).
// Na prévia tudo roda no aparelho; na versão oficial, sorteio, código e limite são validados no servidor.
import dados from '../dados/catalogo.json'
import { config } from '../dados/config'
import { PALAVRAS_PROIBIDAS, premios, regrasSorte, type Premio, type ValorPremio } from '../dados/sorte'
import { useCatalogo } from '../store/catalogo'
import type { Cupom, RetratoPremio } from '../store/conta'
import type { Produto } from './tipos'

/* ───────────────────────── validação dos prêmios (ao carregar o módulo) ───────────────────────── */

const minusculoSemAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const PROIBIDAS = PALAVRAS_PROIBIDAS.map(minusculoSemAcento)

/** Primeira palavra proibida que aparece no texto (no começo de palavra: "tapa" não pega "etapa"), ou null. */
export function palavraProibida(texto: string): string | null {
  const t = minusculoSemAcento(texto)
  for (const p of PROIBIDAS) if (new RegExp(`(^|[^a-z0-9])${p}`).test(t)) return p
  return null
}

interface CatalogoCru {
  produtos: { id: string; categoria: string }[]
  categorias: { id: string; bebida?: boolean }[]
}
const cru = dados as unknown as CatalogoCru
/** Prêmio nunca cai em bebida alcoólica, refrigerante importado nem destilado: as categorias marcadas `bebida`. */
const CATEGORIAS_FORA = new Set(cru.categorias.filter((c) => c.bebida).map((c) => c.id))

function motivoInvalido(p: Premio, idsVistos: Set<string>): string | null {
  const produtos = new Map(cru.produtos.map((x) => [x.id, x]))
  const categorias = new Set(cru.categorias.map((c) => c.id))
  if (!p.id || idsVistos.has(p.id)) return 'id vazio ou repetido'
  const alvos = p.aplicaA.produtos ?? []
  const cats = p.aplicaA.categorias ?? []
  if (!alvos.length && !cats.length) return 'aplicaA sem produto nem categoria'
  for (const id of alvos) {
    const x = produtos.get(id)
    if (!x) return `produto "${id}" não existe no catalogo.json`
    if (CATEGORIAS_FORA.has(x.categoria)) return `produto "${id}" é de ${x.categoria} (prêmio só em acessórios)`
  }
  for (const c of cats) {
    if (!categorias.has(c)) return `categoria "${c}" não existe no catalogo.json`
    if (CATEGORIAS_FORA.has(c)) return `categoria "${c}" não pode ter prêmio`
  }
  if (!(p.peso > 0)) return 'peso precisa ser maior que 0'
  if (!Number.isInteger(p.validadeDias) || p.validadeDias < 1 || p.validadeDias > 30) return 'validadeDias vai de 1 a 30'
  if (p.tipo === 'desconto-percentual' && !(p.valor >= 1 && p.valor <= 50)) return 'percentual vai de 1 a 50'
  if (p.tipo === 'leve-x-pague-y' && !(Number.isInteger(p.valor.leve) && Number.isInteger(p.valor.pague) && p.valor.leve > p.valor.pague && p.valor.pague >= 1))
    return 'leve precisa ser maior que pague, e pague pelo menos 1'
  if (p.tipo === 'brinde') {
    const x = produtos.get(p.valor.produto)
    if (!x) return `brinde "${p.valor.produto}" não existe no catalogo.json`
    if (CATEGORIAS_FORA.has(x.categoria)) return `brinde "${p.valor.produto}" é de ${x.categoria}`
    if (!(p.valor.qtd >= 1)) return 'brinde precisa de qtd 1 ou mais'
  }
  for (const campo of [p.titulo, p.descricao, p.regra, p.comoUsar ?? '']) {
    const w = palavraProibida(campo)
    if (w) return `palavra fora da lista ("${w}") em "${campo}"`
  }
  return null
}

function validarPremios(): Premio[] {
  const ok: Premio[] = []
  const ids = new Set<string>()
  for (const p of premios) {
    const motivo = motivoInvalido(p, ids)
    ids.add(p.id)
    if (motivo) {
      // em dev falha cedo (quem editou src/dados/sorte.ts vê na hora); no ar, só descarta o prêmio
      if (import.meta.env.DEV) throw new Error(`[sorte] prêmio "${p.id}": ${motivo}`)
      console.warn(`[sorte] prêmio "${p.id}" fora: ${motivo}`)
      continue
    }
    ok.push(p)
  }
  return ok
}

const VALIDADOS = validarPremios()

function referidosExistem(p: Premio, produtos: Produto[], categorias: { id: string }[]): boolean {
  const ids = new Set(produtos.map((x) => x.id))
  if ((p.aplicaA.produtos ?? []).some((id) => !ids.has(id))) return false
  if ((p.aplicaA.categorias ?? []).some((c) => !categorias.some((x) => x.id === c))) return false
  if (p.tipo === 'brinde' && !ids.has(p.valor.produto)) return false
  return true
}

/** Prêmios que valem agora: validados, sem os de exemplo fora da prévia, e com todos os produtos no catálogo. */
export function premiosValidos(): Premio[] {
  const { produtos, categorias } = useCatalogo.getState()
  return VALIDADOS.filter((p) => (config.dadosDeExemplo || !p.demo) && referidosExistem(p, produtos, categorias))
}

export function premioPorId(id: string | null | undefined): Premio | undefined {
  return id ? premiosValidos().find((p) => p.id === id) : undefined
}

/* ───────────────────────── relógio de Brasília ───────────────────────── */

// O Brasil não tem horário de verão desde 2019, e os 5 estados atendidos (RJ, MG, SP, ES, SC) ficam em -03:00.
// Por isso o fim e o começo do dia são escritos com -03:00 fixo.
const FUSO = regrasSorte.fuso
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' })

/** 'AAAA-MM-DD' no horário de Brasília. */
export function diaSP(ms: number): string {
  const partes = fmtDia.formatToParts(ms)
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '00'
  return `${v('year')}-${v('month')}-${v('day')}`
}

function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Meia-noite (Brasília) do dia seguinte. */
export function inicioDoDiaSeguinteSP(ms: number): number {
  return Date.parse(`${somarDias(diaSP(ms), 1)}T00:00:00-03:00`)
}

/** 23:59:59,999 (Brasília) do dia de `ms` mais `maisDias`. */
export function fimDoDiaSP(ms: number, maisDias = 0): number {
  return Date.parse(`${somarDias(diaSP(ms), maisDias)}T23:59:59.999-03:00`)
}

/** Dias de calendário (Brasília) de `de` até `ate` (0 = mesmo dia). */
export function diasEntre(de: number, ate: number): number {
  return Math.round((Date.parse(`${diaSP(ate)}T12:00:00Z`) - Date.parse(`${diaSP(de)}T12:00:00Z`)) / 86400000)
}

/* ───────────────────────── status ───────────────────────── */

export type StatusCupom = 'ativo' | 'usado' | 'vencido' | 'encerrado'

export function statusDo(c: Cupom, agora: number): StatusCupom {
  if (c.usadoEm) return 'usado'
  if (c.demo && !config.dadosDeExemplo) return 'encerrado'
  if (agora > c.validoAte) return 'vencido'
  return 'ativo'
}

/* ───────────────────────── formatadores ───────────────────────── */

const fmtSemana = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'short' })
const fmtDiaMes = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' })
const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** "seg., 12/10" */
export function formatarValidade(ms: number): string {
  return `${fmtSemana.format(ms)}, ${fmtDiaMes.format(ms)}`
}

/** "sáb." (só o dia da semana) */
export function formatarDiaSemana(ms: number): string {
  return fmtSemana.format(ms)
}

/** "05/10" */
export function formatarDiaMes(ms: number): string {
  return fmtDiaMes.format(ms)
}

/** "hoje, 23:10" · "amanhã, 21:14" · "seg., 12/10, 21:14" */
export function formatarAte(ms: number, agora: number): string {
  const hora = fmtHora.format(ms)
  const d = diasEntre(agora, ms)
  if (d === 0) return `hoje, ${hora}`
  if (d === 1) return `amanhã, ${hora}`
  return `${formatarValidade(ms)}, ${hora}`
}

/** "em 14 h 20 min" · "em 35 min" · "em 1 min" (curto: "em 14 h"). */
export function formatarEspera(msAte: number, curto = false): string {
  const min = Math.max(1, Math.ceil(msAte / 60000))
  if (min < 60) return `em ${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return curto || m === 0 ? `em ${h} h` : `em ${h} h ${m} min`
}

/** "faltam 3 dias" · "vence amanhã" · "vence hoje" */
export function formatarFalta(validoAte: number, agora: number): string {
  const d = diasEntre(agora, validoAte)
  if (d <= 0) return 'vence hoje'
  if (d === 1) return 'vence amanhã'
  return `faltam ${d} dias`
}

/* ───────────────────────── nome do prêmio ───────────────────────── */

/** Destaque grande do cartão: "LEVA 4 PAGA 3", "15% OFF", "BRINDE". */
export function destaqueDo(p: ValorPremio): string {
  if (p.tipo === 'leve-x-pague-y') return `LEVA ${p.valor.leve} PAGA ${p.valor.pague}`
  if (p.tipo === 'desconto-percentual') return `${p.valor}% OFF`
  return 'BRINDE'
}

/** "seda" a partir de "Sedas" (plural simples). */
function singular(nome: string): string {
  const n = nome.toLowerCase()
  return n.endsWith('s') ? n.slice(0, -1) : n
}

export function nomeCategoria(id: string | undefined): string {
  const c = useCatalogo.getState().categorias.find((x) => x.id === id)
  return c ? singular(c.nome) : (id ?? '')
}

/**
 * O prêmio dito de um jeito só (o herói do story do prêmio e dos cupons da Minha conta): o destaque em pixel e, embaixo, em que produto.
 * Brinde: o produto que vem de brinde. Desconto: o produto do cupom (ou "em qualquer seda", quando é por categoria).
 * O resto (pedido com seda, validade, 1 por pedido) é condição e fica no "Ver condições".
 */
export function fraseDoPremio(r: Pick<RetratoPremio, 'titulo' | 'aplicaA'> & ValorPremio): { destaque: string; alvo: string; produto: Produto | null } {
  const produtos = useCatalogo.getState().produtos
  const destaque = destaqueDo(r)
  if (r.tipo === 'brinde') {
    const b = produtos.find((p) => p.id === r.valor.produto) ?? null
    const qtd = r.valor.qtd > 1 ? `${r.valor.qtd} × ` : ''
    return { destaque, alvo: b ? `${qtd}${b.nome}` : r.titulo, produto: b }
  }
  const alvos = (r.aplicaA.produtos ?? []).map((id) => produtos.find((p) => p.id === id)).filter((p): p is Produto => !!p)
  if (alvos.length) return { destaque, alvo: alvos.map((p) => p.nome).join(' ou '), produto: alvos[0] }
  const cats = (r.aplicaA.categorias ?? []).map(nomeCategoria).filter(Boolean)
  return { destaque, alvo: cats.length ? `em qualquer ${cats.join(' ou ')}` : r.titulo, produto: null }
}

/** O mesmo par numa linha de texto (cadastro, sacola, chat, adesivo): "LEVA 4 PAGA 3 · Seda OCB Premium Slim". */
export function nomeDoPremio(r: Pick<RetratoPremio, 'titulo' | 'aplicaA'> & ValorPremio): string {
  const { destaque, alvo } = fraseDoPremio(r)
  return alvo.startsWith('em ') ? `${destaque} ${alvo}` : `${destaque} · ${alvo}`
}
