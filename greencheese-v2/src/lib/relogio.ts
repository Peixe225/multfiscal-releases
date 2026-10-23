// A hora da loja: o relógio do aparelho corrigido pela hora do servidor (quando ela vem) e lido no horário de Brasília
// (America/Sao_Paulo), qualquer que seja o fuso do aparelho. A loja só atende estados no horário de Brasília: o
// aberto/fechado, a entrega grátis do dia e a validade do cupom seguem essa hora, nunca o fuso nem o relógio do aparelho.
// A hora do servidor vem do cabeçalho Date da resposta do GET loja (o ETag e o 304 continuam iguais: o corpo não muda) e
// do `agora` do GET rateios. Sem servidor (o arquivo único, o zip sem api/), vale o relógio do aparelho, lido em Brasília.
// Fica no pedaço principal e roda no Node também (o conferir-mensagem empacota mensagem.ts junto): nada de window nem
// localStorage no carregamento, só dentro de try.

export const FUSO_LOJA = 'America/Sao_Paulo'

const CHAVE = 'gc-relogio'
/** Desvio menor que isso é ruído (o Date vem em segundos, mais a ida e volta da rede): fica o relógio do aparelho. */
const TOLERANCIA_MS = 90_000
/** Desvio maior que isso é resposta torta, não relógio errado. */
const DESVIO_MAX_MS = 5 * 366 * 86_400_000

function lerGuardado(): number {
  try {
    const v = Number(localStorage.getItem(CHAVE) ?? 0)
    return Number.isFinite(v) && Math.abs(v) <= DESVIO_MAX_MS ? v : 0
  } catch {
    return 0
  }
}

/** Quanto o relógio do aparelho está atrás (+) ou na frente (−) do servidor, em ms (0 = dentro da tolerância). */
let desvio = lerGuardado()
const ouvintes = new Set<() => void>()

/** Agora em ms pela hora da loja: o relógio do aparelho mais o desvio que o servidor mostrou. */
export function agoraLoja(): number {
  return Date.now() + desvio
}

/** O desvio de agora (0 = o relógio do aparelho vale). */
export function desvioDoRelogio(): number {
  return desvio
}

/**
 * A hora que o servidor disse (ms). Guarda o desvio quando passa da tolerância (e zera quando o aparelho acerta o
 * relógio), avisa quem desenha a hora e lembra pra próxima visita, até o servidor responder de novo.
 */
export function registrarHoraServidor(ms: number): void {
  if (!Number.isFinite(ms)) return
  const bruto = ms - Date.now()
  if (Math.abs(bruto) > DESVIO_MAX_MS) return
  // perto do desvio que já vale: fica o de agora (sem redesenhar a cada resposta por causa de 1 s)
  if (Math.abs(bruto - desvio) <= TOLERANCIA_MS) return
  desvio = Math.abs(bruto) > TOLERANCIA_MS ? bruto : 0
  try {
    if (desvio) localStorage.setItem(CHAVE, String(desvio))
    else localStorage.removeItem(CHAVE)
  } catch {
    /* sem armazenamento: vale nesta visita */
  }
  ouvintes.forEach((f) => f())
}

/** O cabeçalho Date de uma resposta do servidor (mais o Age, se uma CDN guardou a resposta). */
export function registrarHoraDaResposta(r: { headers: { get(nome: string): string | null } }): void {
  const data = r.headers.get('Date')
  if (!data) return
  const ms = Date.parse(data)
  const idade = Number(r.headers.get('Age') ?? 0)
  registrarHoraServidor(ms + (Number.isFinite(idade) && idade > 0 ? idade * 1000 : 0))
}

/** Avisa quando a hora da loja muda de desvio (o servidor respondeu com outra hora). */
export function aoMudarHoraDaLoja(f: () => void): () => void {
  ouvintes.add(f)
  return () => {
    ouvintes.delete(f)
  }
}

let fmt: Intl.DateTimeFormat | null = null
try {
  fmt = new Intl.DateTimeFormat('en-US', { timeZone: FUSO_LOJA, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
} catch {
  fmt = null // navegador sem a tabela de fusos: o -03:00 fixo de baixo
}
const SEMANA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Dia da semana (0 = domingo) e minuto do dia (0–1439) em Brasília, no instante `ms`. */
export function relogioBrasilia(ms: number): { dia: number; minuto: number } {
  if (fmt) {
    try {
      const partes = fmt.formatToParts(ms)
      const v = (t: string) => partes.find((p) => p.type === t)?.value ?? ''
      const dia = SEMANA[v('weekday')]
      const h = Number(v('hour')) % 24
      const m = Number(v('minute'))
      if (dia !== undefined && Number.isFinite(h) && Number.isFinite(m)) return { dia, minuto: h * 60 + m }
    } catch {
      /* cai no fixo */
    }
  }
  // o Brasil não tem horário de verão desde 2019: Brasília = UTC−3
  const d = new Date(ms - 3 * 3600_000)
  return { dia: d.getUTCDay(), minuto: d.getUTCHours() * 60 + d.getUTCMinutes() }
}
