// Celular brasileiro da conta: máscara enquanto digita, normalização ao colar e validação com os DDDs da Anatel.
// Guarda como '55' + DDD + 9 dígitos (o formato do wa.me).

/** DDDs em uso no Brasil (plano da Anatel). */
const DDDS = new Set<string>([
  ...intervalo(11, 19),
  '21', '22', '24', '27', '28',
  ...intervalo(31, 35), '37', '38',
  ...intervalo(41, 49),
  '51', '53', '54', '55',
  ...intervalo(61, 69),
  '71', '73', '74', '75', '77', '79',
  ...intervalo(81, 89),
  ...intervalo(91, 99),
])

function intervalo(de: number, ate: number): string[] {
  const out: string[] = []
  for (let n = de; n <= ate; n++) out.push(String(n))
  return out
}

/** Máscara progressiva: "(21", "(21) 9", "(21) 99999-9", "(21) 99999-9999". Recebe só dígitos (até 11). */
export function formatarCelular(digitos: string): string {
  const d = digitos.replace(/\D/g, '').slice(0, 11)
  if (!d) return ''
  if (d.length <= 2) return `(${d}`
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

/** Só dígitos; tira um 55 da frente quando sobram 12–13 dígitos (colou com +55); tira zeros da frente; corta em 11. */
export function normalizarCelular(texto: string): string {
  let d = texto.replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  d = d.replace(/^0+/, '')
  return d.slice(0, 11)
}

/** null quando está certo; senão a mensagem de erro (curta, no tom do site). */
export function validarCelular(d: string): string | null {
  if (d.length < 11) return 'Falta número: DDD + 9 dígitos.'
  const ddd = d.slice(0, 2)
  if (!DDDS.has(ddd)) return `DDD ${ddd} não existe. Confere.`
  if (d[2] !== '9') return 'Celular começa com 9 depois do DDD.'
  return null
}

/** '55' + 11 dígitos (chave da conta e formato do wa.me). null se não for um celular válido. */
export function celularParaGuardar(texto: string): string | null {
  const d = normalizarCelular(texto)
  return validarCelular(d) ? null : `55${d}`
}

/** Exibe o número guardado sem expor tudo: "(21) 9••••-8888". */
export function mascararCelular(guardado: string): string {
  const d = guardado.replace(/\D/g, '').replace(/^55(?=\d{11}$)/, '')
  if (d.length !== 11) return formatarCelular(d)
  return `(${d.slice(0, 2)}) ${d[2]}••••-${d.slice(7)}`
}

/** Número guardado de volta para o campo (sem o 55), já com a máscara. */
export function celularNoCampo(guardado: string): string {
  return formatarCelular(guardado.replace(/\D/g, '').replace(/^55(?=\d{11}$)/, ''))
}
