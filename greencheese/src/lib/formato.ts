const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** R$ 149,90 — com espaço comum (o Intl usa espaço não separável, que estraga mensagem de WhatsApp em alguns aparelhos). */
export function brl(valor: number): string {
  return fmt.format(valor).replace(/\s/g, ' ')
}

/** Preço do produto ou "Consultar" quando não há preço (nunca inventar). */
export function precoOuConsultar(valor: number | null | undefined): string {
  return valor == null ? 'Consultar' : brl(valor)
}

export function soDigitos(s: string): string {
  return s.replace(/\D/g, '')
}

export function formatarCep(s: string): string {
  const d = soDigitos(s).slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

/** "1 item" / "3 itens" */
export function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`
}

/** O maior valor em reais que o servidor aceita num campo de dinheiro (validar.php, gc_centavos). */
export const REAIS_MAX = 100_000

/**
 * Valor em reais digitado ("50", "50,5", "1.000,00", "R$ 75,90") com 2 casas, arredondado pelo próprio texto (meio pra
 * cima: "50,555" → 50.56, sem o erro do ponto flutuante), como o servidor lê (validar.php, gc_centavos_informativo).
 * Ponto com 3 dígitos depois é milhar ("1.000" = mil). null = não dá pra ler.
 */
export function lerReais(texto: string): number | null {
  let s = texto.replace(/[^\d,.]/g, '')
  if (!s) return null
  if (s.includes(',')) {
    if (s.indexOf(',') !== s.lastIndexOf(',')) return null
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s)
  if (!m) return null
  const dec = (m[2] ?? '').padEnd(3, '0')
  const centavos = Number(m[1]) * 100 + Number(dec.slice(0, 2)) + (Number(dec[2]) >= 5 ? 1 : 0)
  return Number.isSafeInteger(centavos) ? centavos / 100 : null
}
