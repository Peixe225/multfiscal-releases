// Contas e textos do rateio que as telas dividem (cartão, aba, página). Datas sempre no fuso de Brasília.
import { brl } from '../../lib/formato'
import { diasEntre, formatarDiaMes } from '../../lib/cupom'
import type { Rateio, StatusRateio, StatusVaga } from '../../lib/rateio-api'
import type { VagaGuardada } from '../../store/rateio'

const FUSO = 'America/Sao_Paulo'
const fmtHM = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
const fmtSemana = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'long' })

/** O selo do status, em pixel. */
export const SELO: Record<StatusRateio, string> = {
  aberto: 'ABERTO',
  fechado: 'FECHOU',
  pedido: 'PEDIDO FEITO',
  caminho: 'A CAMINHO',
  chegou: 'CHEGOU',
  encerrado: 'ENTREGUE',
}

/** Em que ponto da linha do tempo o rateio está (0 = aberto … 5 = entregue a todos). */
export const ETAPA: Record<StatusRateio, number> = { aberto: 0, fechado: 1, pedido: 2, caminho: 3, chegou: 4, encerrado: 5 }

/** "18h" · "18h30" */
export function hora(ms: number): string {
  const p = fmtHM.formatToParts(ms)
  const h = p.find((x) => x.type === 'hour')?.value ?? '0'
  const m = p.find((x) => x.type === 'minute')?.value ?? '00'
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

/** "de hoje" · "de amanhã" · "de sexta (10/10)" */
function dia(ms: number, agora: number): string {
  const d = diasEntre(agora, ms)
  if (d === 0) return 'de hoje'
  if (d === 1) return 'de amanhã'
  return `de ${fmtSemana.format(ms).replace(/-feira$/, '')} (${formatarDiaMes(ms)})`
}

/** "18h de amanhã" */
export function ateQuando(iso: string, agora: number): string {
  const ms = Date.parse(iso)
  return `${hora(ms)} ${dia(ms, agora)}`
}

/** "RJ, MG, SP e ES" */
export function listaUfs(ufs: string[]): string {
  const s = ufs.map((u) => u.toUpperCase())
  return s.length <= 1 ? (s[0] ?? '') : `${s.slice(0, -1).join(', ')} e ${s[s.length - 1]}`
}

/** "de 6 a 10 dias" · "em 7 dias" */
export function faixaDias(r: Pick<Rateio, 'previsaoMin' | 'previsaoMax'>): string {
  return r.previsaoMin === r.previsaoMax ? `em ${r.previsaoMin} ${r.previsaoMin === 1 ? 'dia' : 'dias'}` : `de ${r.previsaoMin} a ${r.previsaoMax} dias`
}

/** "Chega de 6 a 10 dias depois que fechar." (aberto) · "…depois que fechou." */
export function textoPrevisao(r: Rateio): string {
  return `Chega ${faixaDias(r)} depois que ${r.status === 'aberto' ? 'fechar' : 'fechou'}.`
}

/**
 * Aberto, mas o prazo pra entrar já passou (fechaEm vencido, ou o servidor diz que não aceita entrada e ainda sobra
 * vaga). O servidor não fecha sozinho pelo prazo: quem decide é a loja. Não é "vagas tomadas".
 */
export function prazoAcabou(r: Rateio, agora: number): boolean {
  if (r.status !== 'aberto') return false
  if (r.fechaEm && Date.parse(r.fechaEm) <= agora) return true
  return !r.aceitaEntradas && r.disponiveis > 0
}

/** Aberto, dentro do prazo, mas todas as vagas pagas ou reservadas (uma reserva que vence devolve a vaga). */
export function vagasTomadas(r: Rateio, agora: number): boolean {
  return r.status === 'aberto' && !r.aceitaEntradas && r.disponiveis === 0 && !prazoAcabou(r, agora)
}

/** "Fecha dia 12/10 ou quando lotar." · "Fecha quando lotar." · prazo vencido: "O prazo pra entrar acabou dia 07/10." */
export function textoPrazo(r: Rateio, agora: number): string {
  if (prazoAcabou(r, agora)) return r.fechaEm ? `O prazo pra entrar acabou dia ${formatarDiaMes(Date.parse(r.fechaEm))}.` : 'O prazo pra entrar acabou.'
  return r.fechaEm ? `Fecha dia ${formatarDiaMes(Date.parse(r.fechaEm))} ou quando lotar.` : 'Fecha quando lotar.'
}

/** "Tua vaga fica guardada" · "Tuas vagas ficam guardadas" */
export function guardadaTexto(qtd: number): string {
  return qtd > 1 ? 'Tuas vagas ficam guardadas' : 'Tua vaga fica guardada'
}

/** Previsão em datas depois de fechar: "entre 14/10 e 18/10". */
export function janelaChegada(r: Rateio): string | null {
  if (!r.fechadoEm) return null
  const base = Date.parse(r.fechadoEm)
  const a = formatarDiaMes(base + r.previsaoMin * 86400000)
  const b = formatarDiaMes(base + r.previsaoMax * 86400000)
  return a === b ? `por volta de ${a}` : `entre ${a} e ${b}`
}

/** Quanto sai mais barato por vaga (só com precoDepois). */
export function economia(r: Rateio): number | null {
  return r.precoDepois != null ? Math.round((r.precoDepois - r.precoRateio) * 100) / 100 : null
}

export function vagasTexto(n: number): string {
  return `${n} ${n === 1 ? 'vaga' : 'vagas'}`
}

/** "2 vagas × R$ 14,90" (o total vem à parte) */
export function contaVagas(qtd: number, preco: number): string {
  return `${vagasTexto(qtd)} × ${brl(preco)}`
}

export function total(qtd: number, preco: number): number {
  return Math.round(qtd * preco * 100) / 100
}

/** Vaga ainda ocupando lugar (reservada no prazo ou confirmada). */
export function vagaAtiva(v: VagaGuardada, agora: number): boolean {
  if (v.status === 'confirmado') return true
  return v.status === 'reservado' && (!v.expiraEm || Date.parse(v.expiraEm) > agora)
}

/** O status que a pessoa vê: a reserva vencida aparece vencida mesmo antes do servidor marcar. */
export function statusVisto(v: VagaGuardada, agora: number): StatusVaga {
  if (v.status === 'reservado' && v.expiraEm && Date.parse(v.expiraEm) <= agora) return 'expirado'
  return v.status
}

export const NOME_VAGA: Record<StatusVaga, string> = {
  reservado: 'Esperando pagamento',
  confirmado: 'Confirmada',
  expirado: 'Venceu',
  cancelado: 'Cancelada',
  entregue: 'Entregue',
}
