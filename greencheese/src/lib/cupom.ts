// Núcleo dos cupons dos interativos: os prêmios que valem, relógio de Brasília, status e os formatadores de data.
// É o que as entradas do site (destaque, lateral, adesivo) precisam, então fica no pedaço principal, junto com o nome
// do prêmio. Sorteio, código e situação no pedido ficam em cupom-uso.ts (baixam com o jogo, a sacola e a conta).
// Na prévia tudo roda no aparelho; na versão oficial, sorteio, código e limite são validados no servidor.
import { config } from '../dados/config'
import { regrasSorte, type Premio, type ValorPremio } from '../dados/sorte'
import { useCatalogo } from '../store/catalogo'
import { useLoja } from '../store/loja'
import type { Cupom, RetratoPremio } from '../store/conta'
import type { Produto } from './tipos'

/* ───────────────────────── os prêmios que valem ───────────────────────── */

// As regras (nada de bebida, produto que existe, palavras da lista) ficam em src/lib/premios.ts e valem pro embutido e
// pro que chega do servidor; aqui só o que o site usa.
export { palavraProibida } from './premios'

/**
 * Prêmios que valem agora: os da loja (src/store/loja.ts: o servidor ou o embutido, já conferidos e sem os de exemplo
 * fora da prévia). Com o Teste minha sorte desligado no painel, nenhum: o jogo some do site inteiro.
 */
export function premiosValidos(): Premio[] {
  const { sorte } = useLoja.getState()
  return sorte.ligado ? sorte.premios : []
}

export function premioPorId(id: string | null | undefined): Premio | undefined {
  return id ? premiosValidos().find((p) => p.id === id) : undefined
}

/* ───────────────────────── relógio de Brasília ───────────────────────── */

// O dia do cupom é o de Brasília em qualquer estado da loja (o Brasil não tem horário de verão desde 2019). Por isso o
// fim e o começo do dia são escritos com -03:00 fixo.
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
