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

/** Posição no texto mascarado logo depois do n-ésimo dígito (n = 0: antes do 1º dígito). */
function posicaoDoDigito(v: string, n: number): number {
  if (n <= 0) {
    const i = v.search(/\d/)
    return i < 0 ? v.length : i
  }
  let vistos = 0
  for (let i = 0; i < v.length; i++) if (/\d/.test(v[i]) && ++vistos === n) return i + 1
  return v.length
}

/**
 * Uma edição no campo do WhatsApp, com o cursor no lugar certo. Recebe o valor de antes (já mascarado), o texto do
 * campo depois da edição, onde o cursor ficou e o inputType do evento; devolve o novo valor mascarado e o cursor.
 * - O cursor fica depois do mesmo número de dígitos à esquerda (corrigir um dígito no meio não joga pro fim).
 * - Apagar um caractere da máscara ("(", ")", espaço, "-") apaga o dígito do lado dele (Backspace: o da esquerda;
 *   Delete: o da direita), nunca o último.
 * - Com os 11 dígitos completos, digitar mais um não empurra o último pra fora (não troca o número sem avisar).
 * - Colar (ou o preenchimento automático) com +55, 0 ou espaços normaliza e põe o cursor no fim; colar o mesmo número
 *   sem máscara por cima dele mesmo não apaga nada.
 */
export function editarCelular(antes: string, bruto: string, cursor: number, tipo: string): { valor: string; cursor: number } {
  const digAntes = antes.replace(/\D/g, '')
  let dig = bruto.replace(/\D/g, '')
  let esq = bruto.slice(0, cursor).replace(/\D/g, '').length
  if ((tipo === 'insertText' || tipo === 'insertCompositionText') && digAntes.length >= 11 && dig.length > 11) {
    return { valor: antes, cursor: Math.max(0, cursor - (bruto.length - antes.length)) }
  }
  // mesmos dígitos com o texto mais curto: só é "apagou um caractere da máscara" quando a edição foi de apagar. Colar
  // (ou o preenchimento automático) o MESMO número sem a máscara por cima de tudo também encurta o texto, e aí os
  // dígitos valem como vieram (antes o último dígito sumia: "(33) 99123-456")
  const apagou = tipo.startsWith('delete') || (tipo === '' && antes.length - bruto.length === 1)
  if (dig === digAntes && bruto.length < antes.length && apagou) {
    if (tipo === 'deleteContentForward') dig = dig.slice(0, esq) + dig.slice(esq + 1)
    else if (esq > 0) {
      dig = dig.slice(0, esq - 1) + dig.slice(esq)
      esq--
    }
  }
  const d = normalizarCelular(dig)
  // tirou +55 ou 0 da frente, ou cortou o excesso: o cursor vai pro fim
  esq = d === dig.slice(0, 11) ? Math.min(esq, d.length) : d.length
  const valor = formatarCelular(d)
  return { valor, cursor: posicaoDoDigito(valor, esq) }
}
