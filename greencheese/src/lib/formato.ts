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
