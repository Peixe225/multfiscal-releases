// Datas, horas, dinheiro e WhatsApp do jeito que o painel mostra. Tudo no fuso de Brasília (o servidor manda UTC).
export { brl } from '../lib/formato'

const FUSO = 'America/Sao_Paulo'
const fmtDia = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' })
const fmtHM = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const fmtSemana = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'short' })
const fmtSemanaLonga = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'long' })
const fmtData = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' })
const fmtPartes = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

const ms = (iso: string | number) => (typeof iso === 'number' ? iso : Date.parse(iso))

/** "08/10" */
export function diaMes(iso: string | number): string {
  return fmtDia.format(ms(iso))
}

/** "18h" · "18h30" */
export function hora(iso: string | number): string {
  const [h, m] = fmtHM.format(ms(iso)).split(':')
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

/** Dia corrido em Brasília (pra saber se é hoje, amanhã…). */
function diaCorrido(t: number): number {
  const p = Object.fromEntries(fmtPartes.formatToParts(t).map((x) => [x.type, x.value]))
  return Math.floor(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86400000)
}

/** "hoje" · "amanhã" · "ontem" · "sex, 10/10" */
export function dia(iso: string | number, agora = Date.now()): string {
  const d = diaCorrido(ms(iso)) - diaCorrido(agora)
  if (d === 0) return 'hoje'
  if (d === 1) return 'amanhã'
  if (d === -1) return 'ontem'
  return `${fmtSemana.format(ms(iso)).replace('.', '')}, ${diaMes(iso)}`
}

/** "18h de hoje" · "18h de amanhã" · "9h de sexta (10/10)" (pra frase de prazo) */
export function ateQuando(iso: string | number, agora = Date.now()): string {
  const d = diaCorrido(ms(iso)) - diaCorrido(agora)
  const qual = d === 0 ? 'hoje' : d === 1 ? 'amanhã' : `${fmtSemanaLonga.format(ms(iso)).replace(/-feira$/, '')} (${diaMes(iso)})`
  return `${hora(iso)} de ${qual}`
}

/** "hoje às 18h30" · "sex, 10/10 às 9h" */
export function quando(iso: string | number, agora = Date.now()): string {
  return `${dia(iso, agora)} às ${hora(iso)}`
}

/** "08/10/2026" */
export function dataCompleta(iso: string | number): string {
  return fmtData.format(ms(iso))
}

/** "agora" · "há 3 min" · "há 2 h" · "ontem" · "08/10" */
export function relativo(iso: string | number, agora = Date.now()): string {
  const s = Math.round((agora - ms(iso)) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `há ${Math.floor(s / 60)} min`
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`
  const d = dia(iso, agora)
  return d === 'ontem' ? 'ontem' : diaMes(iso)
}

/** Quanto falta: "40 min" · "5 h" · "2 dias". null = já passou. */
export function falta(iso: string | number, agora = Date.now()): string | null {
  const s = Math.round((ms(iso) - agora) / 1000)
  if (s <= 0) return null
  if (s < 3600) return `${Math.max(1, Math.ceil(s / 60))} min`
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} dias`
}

/** '5533991139036' → "(33) 99113-9036" */
export function whatsappBonito(guardado: string): string {
  const d = guardado.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return guardado
}

/** "1 vaga" · "3 vagas" */
export function vagas(n: number): string {
  return `${n} ${n === 1 ? 'vaga' : 'vagas'}`
}

export function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`
}

/** Tamanho de arquivo: "820 KB" · "3,4 MB" */
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

/** "RJ, MG e SP" */
export function listaUfs(ufs: string[]): string {
  const s = ufs.map((u) => u.toUpperCase())
  return s.length <= 1 ? (s[0] ?? '') : `${s.slice(0, -1).join(', ')} e ${s[s.length - 1]}`
}

/** "de 6 a 10 dias" · "7 dias" */
export function faixaDias(min: number, max: number): string {
  return min === max ? `${min} ${min === 1 ? 'dia' : 'dias'}` : `de ${min} a ${max} dias`
}

/** Previsão em datas a partir do dia em que fechou: "entre 14/10 e 18/10". */
export function janela(fechadoEm: string | null, min: number, max: number): string | null {
  if (!fechadoEm) return null
  const base = ms(fechadoEm)
  const a = diaMes(base + min * 86400000)
  const b = diaMes(base + max * 86400000)
  return a === b ? `por volta de ${a}` : `entre ${a} e ${b}`
}

/** Reais digitados ("14,90", "14.9", "R$ 1.234,50") → número; null se não der. */
export function lerReais(texto: string): number | null {
  let t = texto.replace(/[R$\s]/g, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Número → texto do campo de reais ("14,90"). */
export function reaisNoCampo(n: number | null | undefined): string {
  return n == null ? '' : n.toFixed(2).replace('.', ',')
}

/** ISO → valor de <input type="datetime-local"> no horário de Brasília ("2026-10-12T18:00"). */
export function isoParaLocal(iso: string | null): string {
  if (!iso) return ''
  const p = Object.fromEntries(fmtPartes.formatToParts(ms(iso)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
