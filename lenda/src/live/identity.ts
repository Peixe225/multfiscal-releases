/**
 * Identidade da lenda votada pelo chat: posições e nacionalidades em votação, nome a partir do maior
 * apoiador (com filtro) ou fixo/aleatório.
 */
import type { Foot, Position } from '@/engine/types'

export const POSITION_CHOICES: { id: Position; label: string; number: number }[] = [
  { id: 'CA', label: 'Centroavante', number: 9 },
  { id: 'MEI', label: 'Meia', number: 10 },
  { id: 'ZAG', label: 'Zagueiro', number: 4 },
  { id: 'GOL', label: 'Goleiro', number: 1 },
]

/** Brasil sempre na votação; as outras 3 giram a cada lenda. */
export const NATION_POOL = ['ARG', 'POR', 'FRA', 'ESP', 'ENG', 'GER', 'ITA', 'NED', 'URU', 'COL', 'BEL', 'CRO', 'MEX', 'JPN', 'USA']

export function nationChoices(seed: number, available: (code: string) => boolean = () => true): string[] {
  const pool = NATION_POOL.filter(available)
  const out: string[] = []
  let x = (seed * 2654435761) >>> 0
  while (out.length < 3 && pool.length) {
    x = (x * 1103515245 + 12345) >>> 0
    out.push(pool.splice(x % pool.length, 1)[0])
  }
  return available('BRA') ? ['BRA', ...out] : out
}

const SURNAMES = ['SILVA', 'SANTOS', 'OLIVEIRA', 'SOUZA', 'LIMA', 'PEREIRA', 'COSTA', 'RIBEIRO', 'ALMEIDA', 'CARVALHO', 'GOMES', 'MARTINS', 'ROCHA', 'BARBOSA', 'MOURA', 'CARDOSO', 'TEIXEIRA', 'MENDES', 'NUNES', 'FREITAS']

/** Palavrões e ofensas comuns (o nome aparece na live; na dúvida, nome aleatório). */
// radicais: bloqueiam qualquer palavra que os contenha ("caralhudo", "arrombado")
const BLOCK_STEMS = [
  'caralh', 'bucet', 'bocet', 'porra', 'merd', 'foder', 'fodid', 'viad', 'arromb', 'piroc', 'xoxot', 'bost', 'otari', 'vagabund', 'macac',
  'nazi', 'hitler', 'fuck', 'shit', 'bitch', 'nigg', 'porn', 'estupr', 'retardad', 'travec', 'corno', 'puta', 'puto', 'cuzao', 'siririca',
  'punheta', 'penis', 'vagina', 'pussy', 'putaria', 'safad', 'mongol', 'lesbic', 'bicha',
]
// palavras curtas: só bloqueiam quando são a palavra inteira
const BLOCK_WORDS = ['cu', 'pau', 'pinto', 'rola', 'xota', 'foda', 'fode', 'gay', 'sex', 'sexo', 'xxx', 'dick', 'cock', 'anus', 'cus']

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z\s'-]/g, ' ')

/** Apelido do TikTok → SOBRENOME de camisa (3–15 letras, sem ofensas). null se não der. */
export function surnameFromNick(nick: string): string | null {
  const words = strip(nick)
    .split(/[\s'_-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3)
  for (const w of words) {
    const low = w.toLowerCase()
    if (BLOCK_WORDS.includes(low) || BLOCK_STEMS.some((b) => low.includes(b))) return null
  }
  const w = words.sort((a, b) => b.length - a.length)[0]
  if (!w) return null
  return w.toUpperCase().slice(0, 15)
}

export function randomSurname(seed: number): string {
  return SURNAMES[Math.abs(seed) % SURNAMES.length]
}

/** Nome do campo "fixo" (o streamer digitou): mesmas regras de camisa. */
export function cleanFixed(name: string): string | null {
  const s = strip(name).replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 15)
  return s.length >= 2 ? s : null
}

export function footFor(seed: number): Foot {
  return seed % 4 === 0 ? 'left' : 'right'
}
