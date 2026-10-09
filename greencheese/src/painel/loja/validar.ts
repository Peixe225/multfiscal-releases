// As conferências do servidor (nucleo/loja-validar.php) aqui também, pra o dono ver o problema enquanto digita.
// Quem recusa de verdade é o servidor; as frases são as mesmas.
import { PALAVRAS_PROIBIDAS } from '../../dados/sorte'
import { lerReais } from '../formato'
import { termoProibido } from '../proibidos'

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const PROIBIDAS = PALAVRAS_PROIBIDAS.map(semAcento)

/** Primeira palavra que o site não usa (gíria e promessa: "grátis", "frete", "prazo"…), no começo de palavra. */
export function palavraProibida(texto: string): string | null {
  const t = semAcento(texto)
  for (let i = 0; i < PROIBIDAS.length; i++) if (new RegExp(`(^|[^a-z0-9])${PROIBIDAS[i]}`).test(t)) return PALAVRAS_PROIBIDAS[i]
  return null
}

export const AVISO_TABACO = 'Tabaco e vape não entram no site (regra da Anvisa pra venda online).'
export const avisoPalavra = (p: string) => `Tira o “${p}”: o site não usa essa palavra.`

/** O aviso do texto: tabaco primeiro, depois as palavras da lista (quando `palavras`). */
export function problemaNoTexto(texto: string, palavras = false): string | null {
  if (termoProibido(texto)) return AVISO_TABACO
  if (palavras) {
    const p = palavraProibida(texto)
    if (p) return avisoPalavra(p)
  }
  return null
}

/** Nome com cara de bebida alcoólica (a rede do servidor pra prêmio): palavra inteira, sem acento. */
const ALCOOL = ['whisky', 'whiskey', 'uisque', 'gin', 'vodka', 'vodca', 'rum', 'tequila', 'cachaca', 'conhaque', 'cognac', 'licor', 'cerveja', 'chopp', 'vinho', 'espumante', 'champagne', 'jagermeister', 'absinto', 'bourbon', 'mezcal']
export function pareceAlcool(nome: string): boolean {
  const t = ` ${semAcento(nome).replace(/[^a-z0-9]+/g, ' ').trim()} `
  return ALCOOL.some((p) => t.includes(` ${p} `))
}

/** Preço do campo: '' = sem preço (Consultar); número de 0 a 100.000; undefined = inválido. */
export function lerPreco(texto: string): number | null | undefined {
  if (!texto.trim()) return null
  const n = lerReais(texto)
  return n == null || n < 0 || n > 100000 ? undefined : n
}

export const tamanho = (s: string) => [...s.trim()].length

/** @ do Instagram limpo (aceita com @ e o link do perfil colado) ou null. */
export function lerInstagram(v: string): string | null {
  let i = v.trim().toLowerCase()
  i = i.replace(/^(https?:\/\/)?(www\.)?instagram\.com\//, '').replace(/^@/, '').replace(/[/?#].*$/, '')
  return /^(?!.*\.\.)(?!\.)[a-z0-9._]{1,30}(?<!\.)$/.test(i) ? i : null
}

/** DDDs em uso (os mesmos de src/lib/telefone.ts e do servidor). */
const DDDS = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99])

/** Celular brasileiro como o servidor guarda ('55' + DDD + 9 dígitos), ou null. */
export function lerWhatsapp(v: string): string | null {
  if (/[^\d\s()+\-.]/.test(v)) return null
  let d = v.replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  d = d.replace(/^0+/, '')
  return d.length === 11 && DDDS.has(Number(d.slice(0, 2))) && d[2] === '9' ? `55${d}` : null
}

/** "HH:MM" de 00:00 a 23:59. */
export const horaValida = (h: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h)

/** Enquanto digita: só os números, com os dois-pontos no lugar ("1400" → "14:00", "930" → "9:30"). */
export function mascaraHora(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 4)
  if (d.length <= 2) return d
  if (d.length === 3) return Number(d.slice(0, 2)) <= 23 ? `${d.slice(0, 2)}:${d.slice(2)}` : `${d[0]}:${d.slice(1)}`
  return `${d.slice(0, 2)}:${d.slice(2)}`
}

/** Ao sair do campo: "9" → "09:00", "14" → "14:00", "9:30" → "09:30", "14:3" → "14:30" ('' continua ''). */
export function normalizarHora(v: string): string {
  const m = mascaraHora(v)
  if (!m) return ''
  const [h, min = ''] = m.split(':')
  return `${h.padStart(2, '0')}:${min.padEnd(2, '0')}`
}
