/**
 * Identidade da lenda: votação do chat (posição, nacionalidade), nome do maior apoiador (com filtro)
 * e a criação pelo maior doador, que digita comandos no chat (!nome, !pais, !posicao ou !criar).
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

// ───────────────────────── criação pelo maior doador ─────────────────────────

/** Camisa padrão por posição. */
export const NUMBER_BY_POSITION: Record<Position, number> = { GOL: 1, LD: 2, ZAG: 4, LE: 6, VOL: 5, MC: 8, MD: 7, ME: 11, MEI: 10, PD: 7, PE: 11, CA: 9 }

export interface CreatorDraft {
  surname?: string
  nationality?: string
  position?: Position
}

export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const POSITION_ALIASES: Record<Position, string[]> = {
  CA: ['ca', 'centroavante', 'centro avante', 'atacante', 'camisa 9', '9', 'artilheiro', 'centroavante 9', 'st', 'cf', 'striker'],
  PE: ['pe', 'ponta esquerda', 'ponta esquerdo', 'extremo esquerdo', 'lw'],
  PD: ['pd', 'ponta direita', 'ponta direito', 'ponta', 'extremo', 'extremo direito', 'winger', 'rw'],
  MEI: ['mei', 'meia', 'meia atacante', 'camisa 10', '10', 'armador', 'meia armador', 'cam'],
  MC: ['mc', 'meio campo', 'meio campista', 'meio', 'cm'],
  ME: ['me', 'meia esquerda', 'lm'],
  MD: ['md', 'meia direita', 'rm'],
  VOL: ['vol', 'volante', 'cabeca de area', 'primeiro volante', 'cdm', 'dm'],
  LD: ['ld', 'lateral', 'lateral direito', 'rb'],
  LE: ['le', 'lateral esquerdo', 'lb'],
  ZAG: ['zag', 'zagueiro', 'zaga', 'beque', 'defensor', 'zagueirao', 'cb'],
  GOL: ['gol', 'goleiro', 'goleira', 'arqueiro', 'gk', '1'],
}
const POSITION_BY_ALIAS = new Map<string, Position>()
for (const [pos, list] of Object.entries(POSITION_ALIASES) as [Position, string[]][]) for (const a of list) POSITION_BY_ALIAS.set(a, pos)

export function findPosition(q: string): Position | null {
  return POSITION_BY_ALIAS.get(norm(q)) ?? null
}

/** Apelidos comuns de seleções em português → código FIFA. */
const COUNTRY_ALIASES: Record<string, string> = {
  eua: 'USA', 'estados unidos': 'USA', usa: 'USA', america: 'USA', inglaterra: 'ENG', holanda: 'NED', 'paises baixos': 'NED', escocia: 'SCO',
  gales: 'WAL', 'pais de gales': 'WAL', coreia: 'KOR', 'coreia do sul': 'KOR', 'coreia do norte': 'PRK', alemanha: 'GER', espanha: 'ESP',
  'costa do marfim': 'CIV', 'africa do sul': 'RSA', suica: 'SUI', russia: 'RUS', 'arabia saudita': 'KSA', arabia: 'KSA', tchequia: 'CZE',
  'republica tcheca': 'CZE', irlanda: 'IRL', 'irlanda do norte': 'NIR', japao: 'JPN', china: 'CHN', brasil: 'BRA', brazil: 'BRA',
}

export interface CountryLite {
  code: string
  name: string
}

/** "Brasil", "BRA", "argentina", "eua", "Holanda" → código FIFA (só países do jogo). */
export function makeCountryFinder(countries: CountryLite[]): (q: string) => string | null {
  const byCode = new Map(countries.map((c) => [c.code.toLowerCase(), c.code]))
  const byName = new Map(countries.map((c) => [norm(c.name), c.code]))
  return (q: string) => {
    const k = norm(q)
    if (!k) return null
    const alias = COUNTRY_ALIASES[k]
    if (alias && byCode.has(alias.toLowerCase())) return alias
    if (byCode.has(k)) return byCode.get(k)!
    if (byName.has(k)) return byName.get(k)!
    if (k.length >= 4) {
      const hits = [...byName.entries()].filter(([n]) => n.startsWith(k))
      if (hits.length === 1) return hits[0][1]
    }
    return null
  }
}

/** Nome de camisa digitado pelo doador: só letras, 2–15, sem palavrões. */
export function safeName(raw: string): string | null {
  const s = strip(raw).replace(/\s+/g, ' ').trim()
  if (s.length < 2) return null
  for (const w of s.split(' ')) {
    const low = w.toLowerCase()
    if (BLOCK_WORDS.includes(low) || BLOCK_STEMS.some((b) => low.includes(b))) return null
  }
  return s.toUpperCase().slice(0, 15).trim()
}

export type CreatorParse = { draft: CreatorDraft; rejected?: 'name' }

/**
 * Comando do doador no chat (só as mensagens DELE são lidas):
 *   !nome Gabigol · !pais Brasil · !posicao atacante · !criar Gabigol, Brasil, atacante
 * Também valem "nome Gabigol", "país: Argentina", "posição goleiro" e, sozinhos, um país ou uma posição
 * ("Brasil", "goleiro"). null = a mensagem não é um comando de criação.
 */
export function parseCreatorCommand(text: string, findCountry: (q: string) => string | null): CreatorParse | null {
  const t = text.trim().replace(/^[!/.#]+\s*/, '')
  const m = t.match(/^(nome|name|pais|país|nacionalidade|nacao|nação|selecao|seleção|posicao|posição|pos|criar|lenda|jogador)\s*[:=-]?\s+(.+)$/i)
  if (m) {
    const key = norm(m[1])
    const value = m[2].trim()
    if (key === 'nome' || key === 'name') {
      const n = safeName(value)
      return n ? { draft: { surname: n } } : { draft: {}, rejected: 'name' }
    }
    if (key === 'pais' || key === 'nacionalidade' || key === 'nacao' || key === 'selecao') {
      const c = findCountry(value)
      return c ? { draft: { nationality: c } } : null
    }
    if (key === 'posicao' || key === 'pos') {
      const p = findPosition(value)
      return p ? { draft: { position: p } } : null
    }
    // !criar Nome, País, Posição (em qualquer ordem)
    const draft: CreatorDraft = {}
    let rejected: 'name' | undefined
    for (const part of value.split(/[,;/|]+/).map((x) => x.trim()).filter(Boolean)) {
      const p = !draft.position ? findPosition(part) : null
      if (p) {
        draft.position = p
        continue
      }
      const c = !draft.nationality ? findCountry(part) : null
      if (c) {
        draft.nationality = c
        continue
      }
      if (!draft.surname) {
        const n = safeName(part)
        if (n) draft.surname = n
        else rejected = 'name'
      }
    }
    return Object.keys(draft).length || rejected ? { draft, ...(rejected ? { rejected } : {}) } : null
  }
  // sozinho, número não vale (um "1" solto é mais provável ser voto do que "goleiro")
  const p = /^\d+$/.test(t) ? null : findPosition(t)
  if (p) return { draft: { position: p } }
  const c = findCountry(t)
  if (c) return { draft: { nationality: c } }
  return null
}
