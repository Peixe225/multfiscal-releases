// WhatsApp digitado no painel (incluir quem entrou pela DM): máscara enquanto digita e normaliza o que vier colado
// do WhatsApp (+55, espaço, traço). Quem confere o DDD de verdade é o servidor (a mesma lista da Anatel do site).

/** Só os dígitos do celular (DDD + número), sem o 55 da frente; até 11. */
export function digitosCelular(texto: string): string {
  let d = texto.replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  return d.replace(/^0+/, '').slice(0, 11)
}

/** "(33) 99113-9036", montando aos poucos. */
export function mascaraCelular(texto: string): string {
  const d = digitosCelular(texto)
  if (!d) return ''
  if (d.length <= 2) return `(${d}`
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

/** null = parece certo; senão, o que falta. */
export function conferirCelular(texto: string): string | null {
  const d = digitosCelular(texto)
  if (d.length < 11) return 'Falta número: DDD + 9 dígitos.'
  if (d[2] !== '9') return 'Celular começa com 9 depois do DDD.'
  return null
}

/** Do guardado ('5533991139036') pro campo. */
export function celularNoCampo(guardado: string): string {
  return mascaraCelular(guardado)
}
