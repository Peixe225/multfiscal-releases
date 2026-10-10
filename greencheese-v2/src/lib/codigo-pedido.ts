// O código do pedido (GC-7KD2X) e o segredo dele (32 hex), que nascem no aparelho quando o pedido começa a ser montado.
// O código vai na mensagem do WhatsApp (a loja acha o pedido no painel por ele); o token só vai pro servidor: o mesmo
// código com o mesmo token é sempre o mesmo pedido. Fica no pedaço principal (o chat guarda o código no store dele);
// o envio em si mora em pedido-envio.ts, que baixa com o chat.

/** O mesmo alfabeto dos códigos do servidor (RAT-XXXX): sem 0/O, 1/I/L. */
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

function aleatorios(n: number): Uint32Array {
  const a = new Uint32Array(n)
  try {
    crypto.getRandomValues(a)
  } catch {
    for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 2 ** 32) // reserva: navegador sem crypto
  }
  return a
}

/** Código novo ('GC-7KD2X') e o segredo dele: só quem tem o token repete ou troca o pedido. */
export function novoCodigoPedido(): { codigo: string; token: string } {
  const codigo = `GC-${Array.from(aleatorios(5), (n) => ALFABETO[n % ALFABETO.length]).join('')}`
  const token = Array.from(aleatorios(4), (n) => n.toString(16).padStart(8, '0')).join('')
  return { codigo, token }
}

const CODIGO = new RegExp(`^GC-[${ALFABETO}]{5}$`)

export function codigoValido(c: unknown): c is string {
  return typeof c === 'string' && CODIGO.test(c)
}

export function tokenValido(t: unknown): t is string {
  return typeof t === 'string' && /^[0-9a-f]{32}$/.test(t)
}
