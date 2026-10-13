// Com que frequência quem tem conta gira o Teste minha sorte (pedido do Ian em 11/10): N giros a cada X dias, em dias
// de calendário de Brasília. Em quaisquer X dias seguidos, no máximo N giros (contando os da conta, do WhatsApp dela e
// do aparelho). Bloqueado, libera à meia-noite (Brasília) do dia do giro que segura a janela (o N-ésimo mais novo) + X:
// com N = 1, o giro mais novo + X; com X = 1 e N = 1, amanhã (o "1 giro por dia" de sempre). Na janela normal só cabem
// N giros e esse é também o mais antigo; depois que o dono aperta a frequência (de 1 por dia pra 1 por semana), quem
// girou nos dias 0, 1 e 2 espera até o dia 2 + 7 = 9, não o 0 + 7 (no dia 7 a janela ainda teria 2 giros).
// Conta pura (sem store, sem relógio): o site (src/lib/conta.ts) e o painel (Teste minha sorte) usam a mesma; o
// servidor faz a mesma conta em PHP (sorte.php: gc_janela_libera, gc_janela_cabe, gc_sorte_frase).

export interface Frequencia {
  /** X: a janela, em dias (1 = todo dia, 7 = 1x por semana, 30 = 1x por mês). */
  intervaloDias: number
  /** N: quantos giros cabem na janela. */
  girosPorIntervalo: number
}

/** Os atalhos do painel (o "Outro" escolhe de 1 a 30). */
export const ATALHOS_INTERVALO: readonly { dias: number; nome: string }[] = [
  { dias: 1, nome: 'Todo dia' },
  { dias: 2, nome: 'A cada 2 dias' },
  { dias: 3, nome: 'A cada 3 dias' },
  { dias: 7, nome: '1x por semana' },
  { dias: 15, nome: 'A cada 15 dias' },
  { dias: 30, nome: '1x por mês' },
]

export const INTERVALO_MIN = 1
export const INTERVALO_MAX = 30
export const GIROS_MIN = 1
export const GIROS_MAX = 5

const DIA = /^\d{4}-\d{2}-\d{2}$/

/** 'AAAA-MM-DD' → número do dia (dias desde 1970-01-01). */
export function numDia(dia: string): number {
  const [a, m, d] = dia.split('-').map(Number)
  return Math.round(Date.UTC(a, m - 1, d) / 86400000)
}

/** Número do dia → 'AAAA-MM-DD'. */
export function diaDoNum(n: number): string {
  return new Date(n * 86400000).toISOString().slice(0, 10)
}

/**
 * Com conta: o dia ('AAAA-MM-DD') em que libera o próximo giro, à meia-noite de Brasília, ou null se o giro tá
 * liberado hoje. `dias`: os dias de giro (um por giro; pode repetir). Com N ou mais giros entre hoje − X + 1 e hoje,
 * libera no dia do giro que segura a janela (o N-ésimo mais novo) + X.
 */
export function liberaEm(dias: readonly string[], hoje: string, f: Frequencia): string | null {
  const h = numDia(hoje)
  const naJanela = dias.filter((d) => DIA.test(d)).map(numDia).filter((d) => d > h - f.intervaloDias).sort((a, b) => a - b)
  if (naJanela.length < f.girosPorIntervalo) return null
  return diaDoNum(naJanela[naJanela.length - f.girosPorIntervalo] + f.intervaloDias)
}

/** Algum giro em `dias` ainda conta na janela de hoje (com X = 1, girou hoje). */
export function girouNaJanela(dias: readonly string[], hoje: string, intervaloDias: number): boolean {
  const h = numDia(hoje)
  return dias.some((d) => DIA.test(d) && numDia(d) > h - intervaloDias)
}

/** "por dia" · "a cada 2 dias" · "por semana" · "a cada 15 dias" · "por mês" */
export function porPeriodo(intervaloDias: number): string {
  if (intervaloDias === 1) return 'por dia'
  if (intervaloDias === 7) return 'por semana'
  if (intervaloDias === 30) return 'por mês'
  return `a cada ${intervaloDias} dias`
}

/** "1 giro por dia" · "1 giro a cada 2 dias" · "1 giro por semana" · "2 giros por semana" · "1 giro por mês" */
export function giroPorPeriodo(f: Frequencia): string {
  return `${f.girosPorIntervalo === 1 ? '1 giro' : `${f.girosPorIntervalo} giros`} ${porPeriodo(f.intervaloDias)}`
}

/** "1 vez por dia" · "2 vezes por semana" (o "tu gira 1 vez por semana" do cadastro e a frase do painel). */
export function vezesPorPeriodo(f: Frequencia): string {
  return `${f.girosPorIntervalo === 1 ? '1 vez' : `${f.girosPorIntervalo} vezes`} ${porPeriodo(f.intervaloDias)}`
}

/** É o "1 giro por dia" de sempre (os textos de antes, com "hoje" e "amanhã", continuam valendo). */
export const umPorDia = (f: Frequencia): boolean => f.intervaloDias === 1 && f.girosPorIntervalo === 1

const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/** "amanhã" · "sábado, 17/10" (o dia em que libera; `hoje` e `dia` em 'AAAA-MM-DD' de Brasília). */
export function diaQueLibera(dia: string, hoje: string): string {
  const d = numDia(dia) - numDia(hoje)
  if (d <= 0) return 'hoje'
  if (d === 1) return 'amanhã'
  const data = new Date(numDia(dia) * 86400000)
  return `${SEMANA[data.getUTCDay()]}, ${dia.slice(8, 10)}/${dia.slice(5, 7)}`
}
