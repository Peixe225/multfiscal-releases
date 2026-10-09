/**
 * Identidade da lenda: votação do chat (posição, nacionalidade), nome do maior apoiador (com filtro)
 * e a criação pelo maior doador, que digita comandos no chat (!nome, !pais, !posicao, !criar e !ok).
 */
import { POSITION_NAMES } from '@/engine/career/util'
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

/** Tamanho máximo do nome na camisa. */
export const NAME_MAX = 15

// ───────────────────────── filtro de palavrões ─────────────────────────
// O nome aparece na live por uma carreira inteira: na dúvida, recusa (o doador escolhe outro).

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a' }

/**
 * Forma "achatada" para o filtro: sem acento, minúsculas, leetspeak → letras (0→o 1→i 3→e 4→a 5→s 7→t @→a),
 * só letras (some espaço, hífen, ponto, emoji, caractere invisível) e sem letras repetidas ("puuuta" → "puta").
 */
export function collapse(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[013457@]/g, (c) => LEET[c])
    .replace(/[^a-z]+/g, '')
    .replace(/(.)\1+/g, '$1')
}

// radicais: bloqueiam qualquer texto que os contenha ("caralhudo", "arrombado", "putinha")
const BLOCK_STEMS = [
  'caralh', 'karalh', 'caraio', 'karaio', 'bucet', 'bocet', 'porra', 'porrinh', 'merd', 'foder', 'fodid', 'fud', 'viad', 'veado', 'arromb',
  'piroc', 'pirok', 'xoxot', 'xerec', 'xavasc', 'bost', 'otari', 'vagabund', 'vadia', 'macac', 'nazi', 'hitler', 'fuck', 'shit', 'bitch',
  'nigga', 'nigger', 'whore', 'slut', 'cunt', 'faggot', 'porn', 'estupr', 'pedofil', 'retardad', 'travec', 'corno', 'cornin', 'cornud',
  'cornao', 'puta', 'puto', 'putinh', 'prostitut', 'quenga', 'rapariga', 'cuzao', 'cuzin', 'siririca', 'punheta', 'boquet', 'penis',
  'vagina', 'pussy', 'safad', 'mongol', 'lesbic', 'bicha', 'bixa', 'boiol', 'baitol', 'sapatao', 'cacet', 'cagad', 'cagao', 'escrot',
  'babac', 'idiot', 'imbecil', 'kct', 'krl',
].map(collapse)
// palavras e siglas curtas: só bloqueiam quando são a palavra inteira (ou o texto inteiro)
const BLOCK_WORDS = new Set(
  [
    'cu', 'ku', 'cus', 'pau', 'pinto', 'rola', 'pica', 'pika', 'xota', 'foda', 'fode', 'gay', 'sex', 'sexo', 'dick', 'cock', 'anus', 'anal',
    'fdp', 'pqp', 'vsf', 'tnc', 'vtnc', 'tmnc', 'pnc', 'crl', 'bct',
  ].map(collapse),
)

const blocked = (c: string) => !!c && (BLOCK_WORDS.has(c) || BLOCK_STEMS.some((b) => c.includes(b)))

/** O texto tem palavrão/ofensa? Confere o texto inteiro achatado ("P-U-T-A", "CARA LHO") e cada palavra. */
export function isOffensive(text: string): boolean {
  if (blocked(collapse(text))) return true
  const words = text.split(/[\s_.,;:!?'’"()[\]{}|/\\-]+/).map(collapse)
  if (words.some(blocked)) return true
  // letras soltas juntas: "F D P", "c u"
  let run = ''
  for (const w of [...words, '']) {
    if (w.length === 1) run += w
    else {
      if (run.length > 1 && blocked(run)) return true
      run = ''
    }
  }
  return false
}

const hasVowel = (s: string) => /[aeiouy]/.test(collapse(s))

/** Texto → letras para a camisa: sem acento, leetspeak no meio da palavra vira letra ("G4BIGOL"), o resto vira espaço. */
const strip = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([A-Za-z])([013457@]+)(?=[A-Za-z])/g, (_, a: string, d: string) => a + [...d].map((c) => LEET[c]).join(''))
    .replace(/[^A-Za-z\s'-]/g, ' ')
    .replace(/(^|\s)['-]+|['-]+(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

const plain = (w: string) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
// "Neymar Júnior" → SANTOS JUNIOR cabe; "Ronaldinho Gaúcho" → RONALDINHO (a origem não vira o nome)
const NAME_SUFFIX = new Set(['junior', 'jr', 'filho', 'neto', 'sobrinho', 'segundo', 'ii', 'iii'])
const NAME_ORIGIN = new Set(['gaucho', 'paulista', 'carioca', 'mineiro', 'baiano', 'pernambucano', 'capixaba', 'paraense', 'cearense', 'goiano', 'potiguar', 'paranaense', 'catarinense', 'paraibano', 'alagoano', 'sergipano', 'maranhense'])
const NAME_PARTICLE = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'del', 'van', 'von', 'der', 'den', 'la', 'le'])

/**
 * Nome comprido → nome de camisa com até 15 letras, sem cortar palavra no meio: o último sobrenome
 * ("Cristiano Ronaldo" → RONALDO, "Neymar da Silva Santos Júnior" → SANTOS JUNIOR); se não der, as
 * primeiras palavras inteiras que couberem ("Ronaldinho Gaúcho" → RONALDINHO). null se nenhuma palavra cabe.
 */
function fitName(s: string, max = NAME_MAX): string | null {
  if (s.length <= max) return s
  const words = s.split(' ')
  let i = words.length - 1
  if (i > 0 && NAME_SUFFIX.has(plain(words[i])) && !NAME_PARTICLE.has(plain(words[i - 1]))) {
    const two = `${words[i - 1]} ${words[i]}`
    if (two.length <= max) return two
    i--
  }
  const last = words[i]
  if (i > 0 && !NAME_ORIGIN.has(plain(last)) && !NAME_PARTICLE.has(plain(last)) && last.length <= max && last.length >= 2) return last
  let out = ''
  for (const w of words) {
    const next = out ? `${out} ${w}` : w
    if (next.length > max) break
    out = next
  }
  // sem partícula solta no fim ("PEDRO DA")
  const kept = out.split(' ')
  while (kept.length > 1 && NAME_PARTICLE.has(plain(kept[kept.length - 1]))) kept.pop()
  out = kept.join(' ')
  return out.length >= 2 ? out : null
}

export type NameCheck = { name: string; shortened: boolean } | { rejected: 'name' | 'name-long' }

/**
 * Nome digitado pelo doador → nome de camisa (2–15 letras, com vogal, sem palavrão).
 * 'name' = recusado (ofensa, sem vogal, curto demais); 'name-long' = nenhuma palavra cabe em 15 letras.
 */
export function checkName(raw: string): NameCheck {
  const s = strip(raw)
  if (s.replace(/[\s'-]/g, '').length < 2) return { rejected: 'name' }
  if (isOffensive(raw) || isOffensive(s) || !hasVowel(s)) return { rejected: 'name' }
  const fit = fitName(s)
  if (!fit) return { rejected: 'name-long' }
  if (!hasVowel(fit)) return { rejected: 'name' }
  return { name: fit.toUpperCase(), shortened: fit !== s }
}

/** Nome de camisa digitado pelo doador (ver checkName). null = recusado. */
export function safeName(raw: string): string | null {
  const r = checkName(raw)
  return 'name' in r ? r.name : null
}

/** Apelido do TikTok → SOBRENOME de camisa (3–15 letras, sem ofensas). null se não der. */
export function surnameFromNick(nick: string): string | null {
  if (isOffensive(nick)) return null
  const words = strip(nick)
    .split(/[\s'-]+/)
    .filter((w) => w.length >= 3 && hasVowel(w))
  if (!words.length) return null
  const fits = words.filter((w) => w.length <= NAME_MAX)
  const w = (fits.length ? fits : words).sort((a, b) => b.length - a.length)[0]
  return w.toUpperCase().slice(0, NAME_MAX)
}

export function randomSurname(seed: number): string {
  return SURNAMES[Math.abs(seed) % SURNAMES.length]
}

/** Nome do campo "fixo" (o streamer digitou): mesmas regras de camisa (sem cortar palavra no meio). */
export function cleanFixed(name: string): string | null {
  const s = strip(name)
  if (s.length < 2) return null
  return (fitName(s) ?? s.slice(0, NAME_MAX).trim()).toUpperCase()
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
  CA: ['ca', 'centroavante', 'centro avante', 'atacante', 'camisa 9', '9', 'artilheiro', 'centroavante 9', 'pivo', 'st', 'cf', 'striker', 'forward'],
  PE: ['pe', 'ponta esquerda', 'ponta esquerdo', 'extremo esquerdo', 'lw'],
  PD: ['pd', 'ponta direita', 'ponta direito', 'ponta', 'extremo', 'extremo direito', 'winger', 'rw'],
  MEI: ['mei', 'meia', 'meia atacante', 'camisa 10', '10', 'armador', 'meia armador', 'cam'],
  MC: ['mc', 'meio campo', 'meio campista', 'meio', 'segundo volante', 'cm', 'midfielder'],
  ME: ['me', 'meia esquerda', 'lm'],
  MD: ['md', 'meia direita', 'rm'],
  VOL: ['vol', 'volante', 'cabeca de area', 'primeiro volante', 'cdm', 'dm'],
  LD: ['ld', 'lateral', 'lateral direito', 'lateral direita', 'ala direito', 'rb'],
  LE: ['le', 'lateral esquerdo', 'lateral esquerda', 'ala esquerdo', 'lb'],
  ZAG: ['zag', 'zagueiro', 'zagueira', 'zaga', 'beque', 'defensor', 'zagueirao', 'cb', 'defender'],
  GOL: ['gol', 'goleiro', 'goleira', 'goleirao', 'arqueiro', 'gk', 'goalkeeper', '1'],
}
const POSITION_BY_ALIAS = new Map<string, Position>()
for (const [pos, list] of Object.entries(POSITION_ALIASES) as [Position, string[]][]) for (const a of list) POSITION_BY_ALIAS.set(a, pos)

const ARTICLE = /^(?:o|a|os|as|de|do|da|dos|das)\s+/

/** Posição pelo nome exato ("goleiro", "camisa 10", "ca"). */
export function findPosition(q: string): Position | null {
  return POSITION_BY_ALIAS.get(norm(q)) ?? null
}

/** Depois de "!posicao": aceita sobra no fim ("zagueiro central", "atacante 9", "o goleiro"). */
function positionLoose(q: string): Position | null {
  const k = norm(q).replace(ARTICLE, '')
  const words = k.split(' ')
  for (let n = words.length; n >= 1; n--) {
    const p = POSITION_BY_ALIAS.get(words.slice(0, n).join(' '))
    if (p) return p
  }
  return null
}

/** Mensagem solta: só a palavra inteira, com 4+ letras ("goleiro", "atacante" — não "gol", "me", "pe", "9"). */
function positionStrict(q: string): Position | null {
  const k = norm(q)
  return /^[a-z ]+$/.test(k) && k.replace(/ /g, '').length >= 4 ? (POSITION_BY_ALIAS.get(k) ?? null) : null
}

/** Apelidos, gentílicos e nomes em inglês de seleções → código FIFA. */
const COUNTRY_ALIASES: Record<string, string> = {
  eua: 'USA', 'estados unidos': 'USA', usa: 'USA', america: 'USA', inglaterra: 'ENG', holanda: 'NED', 'paises baixos': 'NED', escocia: 'SCO',
  gales: 'WAL', 'pais de gales': 'WAL', coreia: 'KOR', 'coreia do sul': 'KOR', 'coreia do norte': 'PRK', alemanha: 'GER', espanha: 'ESP',
  'costa do marfim': 'CIV', 'africa do sul': 'RSA', suica: 'SUI', russia: 'RUS', 'arabia saudita': 'KSA', arabia: 'KSA', tchequia: 'CZE',
  'republica tcheca': 'CZE', irlanda: 'IRL', 'irlanda do norte': 'NIR', japao: 'JPN', china: 'CHN', brasil: 'BRA', brazil: 'BRA',
  // gentílicos ("!nacionalidade brasileira")
  brasileiro: 'BRA', brasileira: 'BRA', argentino: 'ARG', portugues: 'POR', portuguesa: 'POR', alemao: 'GER', alema: 'GER',
  frances: 'FRA', francesa: 'FRA', espanhol: 'ESP', espanhola: 'ESP', italiano: 'ITA', italiana: 'ITA', ingles: 'ENG', inglesa: 'ENG',
  uruguaio: 'URU', uruguaia: 'URU', japones: 'JPN', japonesa: 'JPN', holandes: 'NED', holandesa: 'NED', belga: 'BEL', croata: 'CRO',
  mexicano: 'MEX', mexicana: 'MEX', americano: 'USA', americana: 'USA', 'norte americano': 'USA', 'norte americana': 'USA',
  colombiano: 'COL', colombiana: 'COL', chileno: 'CHI', chilena: 'CHI', paraguaio: 'PAR', paraguaia: 'PAR', peruano: 'PER', peruana: 'PER',
  equatoriano: 'ECU', equatoriana: 'ECU', venezuelano: 'VEN', venezuelana: 'VEN', boliviano: 'BOL', boliviana: 'BOL', nigeriano: 'NGA',
  nigeriana: 'NGA', senegales: 'SEN', senegalesa: 'SEN', marroquino: 'MAR', marroquina: 'MAR', camaronense: 'CMR', egipcio: 'EGY',
  egipcia: 'EGY', ganes: 'GHA', ganesa: 'GHA', coreano: 'KOR', coreana: 'KOR', chines: 'CHN', chinesa: 'CHN', australiano: 'AUS',
  australiana: 'AUS', canadense: 'CAN', suico: 'SUI', sueco: 'SWE', sueca: 'SWE', dinamarques: 'DEN', dinamarquesa: 'DEN', noruegues: 'NOR',
  norueguesa: 'NOR', polones: 'POL', polonesa: 'POL', russo: 'RUS', russa: 'RUS', ucraniano: 'UKR', ucraniana: 'UKR', turco: 'TUR', turca: 'TUR',
  grego: 'GRE', grega: 'GRE', escoces: 'SCO', escocesa: 'SCO', galesa: 'WAL', irlandes: 'IRL', irlandesa: 'IRL', angolano: 'ANG',
  angolana: 'ANG', mocambicano: 'MOZ', mocambicana: 'MOZ', 'cabo verdiano': 'CPV', 'cabo verdiana': 'CPV', saudita: 'KSA', iraniano: 'IRN',
  iraniana: 'IRN', servio: 'SRB', servia: 'SRB', austriaco: 'AUT', austriaca: 'AUT', tcheco: 'CZE', tcheca: 'CZE', hungaro: 'HUN', hungara: 'HUN',
  romeno: 'ROU', romena: 'ROU', israelense: 'ISR', jamaicano: 'JAM', jamaicana: 'JAM', cubano: 'CUB', cubana: 'CUB', catari: 'QAT',
  'costa riquenho': 'CRC', costarriquenho: 'CRC', hondurenho: 'HON', panamenho: 'PAN', marfinense: 'CIV', argelino: 'ALG', argelina: 'ALG',
  tunisiano: 'TUN', tunisiana: 'TUN', 'sul africano': 'RSA', 'sul coreano': 'KOR',
  // em inglês
  england: 'ENG', germany: 'GER', spain: 'ESP', france: 'FRA', italy: 'ITA', japan: 'JPN', netherlands: 'NED', holland: 'NED', qatar: 'QAT',
  belgium: 'BEL', croatia: 'CRO', 'united states': 'USA', korea: 'KOR', 'south korea': 'KOR', 'north korea': 'PRK', switzerland: 'SUI',
  sweden: 'SWE', denmark: 'DEN', norway: 'NOR', poland: 'POL', ukraine: 'UKR', turkey: 'TUR', greece: 'GRE', scotland: 'SCO', wales: 'WAL',
  ireland: 'IRL', 'northern ireland': 'NIR', egypt: 'EGY', morocco: 'MAR', cameroon: 'CMR', ghana: 'GHA', 'ivory coast': 'CIV',
  'south africa': 'RSA', 'saudi arabia': 'KSA', uruguay: 'URU', paraguay: 'PAR', iran: 'IRN', iraq: 'IRQ', 'czech republic': 'CZE',
  czechia: 'CZE', hungary: 'HUN', romania: 'ROU', serbia: 'SRB', 'new zealand': 'NZL', algeria: 'ALG', tunisia: 'TUN', mexico: 'MEX',
}

export interface CountryLite {
  code: string
  name: string
}

/**
 * País do jogo → código FIFA. `strict` (mensagem solta, sem "!") só aceita o nome inteiro ou um apelido
 * com 4+ letras ("Brasil", "Holanda", "brasileiro"); sem `strict` (depois de "!pais") também vale código
 * ("arg"), começo único do nome ("portu") e sobra no fim ("Brasil mesmo").
 */
export type CountryFinder = (q: string, strict?: boolean) => string | null

/** "Brasil", "BRA", "argentina", "eua", "Holanda", "England", "brasileira" → código FIFA (só países do jogo). */
export function makeCountryFinder(countries: CountryLite[]): CountryFinder {
  const byCode = new Map(countries.map((c) => [c.code.toLowerCase(), c.code]))
  const byName = new Map(countries.map((c) => [norm(c.name), c.code]))
  const alias = (k: string) => {
    const a = COUNTRY_ALIASES[k]
    return a && byCode.has(a.toLowerCase()) ? a : null
  }
  const exact = (k: string) => alias(k) ?? byName.get(k) ?? null
  const loose = (k: string) => {
    const hit = exact(k) ?? byCode.get(k)
    if (hit) return hit
    if (k.length >= 4) {
      const hits = [...byName.entries()].filter(([n]) => n.startsWith(k))
      if (hits.length === 1) return hits[0][1]
    }
    return null
  }
  return (q: string, strict = false) => {
    const k = norm(q)
    if (!k) return null
    if (strict) return k.replace(/ /g, '').length >= 4 ? exact(k) : null
    const bare = k.replace(ARTICLE, '')
    const hit = loose(k) ?? (bare !== k ? loose(bare) : null)
    if (hit) return hit
    // "Brasil mesmo", "Argentina demais": tira palavras do fim (só nome/apelido/código exatos)
    const words = bare.split(' ')
    for (let n = words.length - 1; n >= 1; n--) {
      const head = words.slice(0, n).join(' ')
      const c = exact(head) ?? byCode.get(head)
      if (c) return c
    }
    return null
  }
}

export type CreatorRejection = 'name' | 'name-long' | 'country' | 'position'

export interface CreatorParse {
  /** O que a mensagem escolheu (só os campos reconhecidos). */
  draft: CreatorDraft
  /**
   * Algo foi recusado: 'name' (palavrão, sem vogal…), 'name-long' (nenhuma palavra cabe em 15 letras),
   * 'country' / 'position' (não reconhecido; o texto vem em `value`).
   */
  rejected?: CreatorRejection
  /** Texto não reconhecido (só para país/posição; nunca o nome recusado). */
  value?: string
  /** O nome foi encurtado para caber na camisa ("Cristiano Ronaldo" → RONALDO). */
  shortened?: boolean
  /** "!ok": o criador confirmou a ficha (começa já, se estiver completa). */
  confirm?: boolean
  /** Comando sem o valor ("!pais"): como usar. */
  hint?: string
  /** Mensagem sem "!" (conversa): só preenche o que ainda está vazio. */
  bare?: boolean
}

type Keyword = 'name' | 'country' | 'position' | 'create' | 'ok'
const KEYWORDS: Record<string, Keyword> = {
  nome: 'name', name: 'name', apelido: 'name',
  pais: 'country', nacionalidade: 'country', nacao: 'country', selecao: 'country', country: 'country',
  posicao: 'position', pos: 'position', position: 'position',
  criar: 'create', crie: 'create', create: 'create',
  ok: 'ok', okay: 'ok', confirmar: 'ok', confirma: 'ok', pronto: 'ok',
}

const HINTS: Record<Exclude<Keyword, 'ok'>, string> = {
  name: 'Escreva o nome junto: !nome Gabigol',
  country: 'Escreva o país junto: !pais Brasil',
  position: 'Escreva a posição junto: !posicao atacante',
  create: 'Tudo de uma vez: !criar Nome, País, Posição',
}

/** "!nome dele vai ser Gabigol", "!nome é Gabigol" → "Gabigol". */
const NAME_FILLER = /^(?:(?:dele|dela|do jogador|da lenda|vai ser|vai se chamar|ser[aá]|[eé]h?)\s+)+/i

function nameParse(value: string): CreatorParse {
  const n = checkName(value.replace(NAME_FILLER, ''))
  return 'name' in n ? { draft: { surname: n.name }, ...(n.shortened ? { shortened: true } : {}) } : { draft: {}, rejected: n.rejected }
}

/** Junta nome/país/posição já identificados (o nome passa pelo filtro). */
function assemble(name: string | undefined, nationality: string | null | undefined, position: Position | null | undefined, leftover?: string): CreatorParse {
  const out: CreatorParse = { draft: {} }
  if (position) out.draft.position = position
  if (nationality) out.draft.nationality = nationality
  if (name && norm(name)) {
    const n = nameParse(name)
    if (n.draft.surname) out.draft.surname = n.draft.surname
    if (n.shortened) out.shortened = true
    if (n.rejected) out.rejected = n.rejected
  }
  // sobrou texto e falta país ou posição: avisa o que não foi reconhecido
  if (!out.rejected && leftover && norm(leftover) && (!nationality || !position)) {
    out.rejected = !nationality ? 'country' : 'position'
    out.value = leftover
  }
  return out
}

/** "!criar Gabigol Brasil atacante" (sem vírgula): tira posição e país do fim (só exatos); o resto é o nome. */
function peel(text: string, find: CountryFinder): CreatorParse {
  let words = text.trim().split(/\s+/)
  let position: Position | null = null
  let nationality: string | null = null
  for (let round = 0; round < 2; round++) {
    for (let k = Math.min(3, words.length); !position && k >= 1; k--) {
      const p = positionStrict(words.slice(-k).join(' '))
      if (p) {
        position = p
        words = words.slice(0, -k)
      }
    }
    for (let k = Math.min(4, words.length); !nationality && k >= 1; k--) {
      const c = find(words.slice(-k).join(' '), true)
      if (c) {
        nationality = c
        words = words.slice(0, -k)
      }
    }
  }
  return assemble(words.join(' '), nationality, position)
}

/**
 * !criar Nome, País, Posição — nessa ordem quando país e posição batem ("!criar Israel, Brasil, zagueiro"
 * é o Israel brasileiro). Senão, em qualquer ordem: posição = a parte que for posição; país = a única parte
 * que for país (se houver mais de uma, a de nome exato e mais para o fim); nome = a primeira que sobrar.
 */
function parseCreate(value: string, find: CountryFinder): CreatorParse {
  let parts = value
    .split(/\s*[,;/|]+\s*|\s+[-–—]+\s+/)
    .map((p) => p.trim())
    .filter((p) => norm(p))
  if (!parts.length) return { draft: {}, hint: HINTS.create }
  if (parts.length === 1) return peel(parts[0], find)
  // "Gabigol, Brasil e atacante" (mas "Trinidad e Tobago" é um país só)
  parts = parts.flatMap((p) => (find(p, true) ? [p] : p.split(/\s+e\s+/i).filter((x) => norm(x))))
  if (parts.length === 3) {
    const c = find(parts[1])
    const p = positionLoose(parts[2])
    if (c && p) return assemble(parts[0], c, p)
  }
  const left = parts.map((text, i) => ({ text, i }))
  const take = (j: number) => left.splice(j, 1)[0]
  // posição: nome exato (a última que bater); senão, com sobra no fim — nunca a 1ª parte (é o nome)
  let position: Position | null = null
  for (const pick of [findPosition, positionLoose]) {
    for (let j = left.length - 1; !position && j >= 0; j--) {
      if (pick === positionLoose && left[j].i === 0) continue
      const p = pick(left[j].text)
      if (p) {
        position = p
        take(j)
      }
    }
    if (position) break
  }
  // país: exato (o mais para o fim); senão, código/começo do nome — nunca a 1ª parte se houver outra
  let nationality: string | null = null
  for (const strict of [true, false]) {
    for (let j = left.length - 1; !nationality && j >= 0; j--) {
      if (!strict && left[j].i === 0 && left.length > 1) continue
      const c = find(left[j].text, strict)
      if (c) {
        nationality = c
        take(j)
      }
    }
    if (nationality) break
  }
  // com país e posição achados, o que sobra é o nome ("Cristiano, Ronaldo, Portugal, atacante")
  if (nationality && position) return assemble(left.map((x) => x.text).join(' '), nationality, position)
  const name = left.length ? take(0).text : undefined
  return assemble(name, nationality, position, left[0]?.text)
}

/**
 * Comando do doador no chat (só as mensagens DELE são lidas). Palavra-chave SEMPRE com "!" ou "/":
 *   !nome Gabigol · !pais Brasil · !posicao atacante · !criar Gabigol, Brasil, atacante · !ok
 * (acento e "nome: X" / "nome=X" tanto faz; "@streamer !nome X" também vale). Sem "!", a mensagem só
 * preenche país ou posição que ainda faltam, e só com o nome exato ("Brasil", "goleiro" — não "gol",
 * "como", "para"). `current` = ficha atual (para a mensagem solta não trocar o que já foi escolhido).
 * null = a mensagem não é um comando de criação.
 */
export function parseCreatorCommand(text: string, findCountry: CountryFinder, current: CreatorDraft = {}): CreatorParse | null {
  const t = text.trim().replace(/^(?:@\S+\s*)+/, '').trim()
  const m = t.match(/^[!/]\s*([^\s:=]+)\s*(?:[:=]\s*)?([\s\S]*)$/)
  if (m) {
    const kind = KEYWORDS[norm(m[1]).replace(/ /g, '')]
    if (!kind) return null
    if (kind === 'ok') return { draft: {}, confirm: true }
    const value = m[2].trim()
    if (!norm(value)) return { draft: {}, hint: HINTS[kind] }
    if (kind === 'name') return nameParse(value)
    if (kind === 'country') {
      const c = findCountry(value)
      return c ? { draft: { nationality: c } } : { draft: {}, rejected: 'country', value }
    }
    if (kind === 'position') {
      const p = positionLoose(value)
      return p ? { draft: { position: p } } : { draft: {}, rejected: 'position', value }
    }
    return parseCreate(value, findCountry)
  }
  // mensagem solta: número sozinho é voto, não posição
  if (/^\d+$/.test(t)) return null
  let q = t
  let only: Keyword | null = null
  // "País: Argentina", "posição: goleiro" sem "!": mesmas regras da mensagem solta
  const kv = t.match(/^([^\s:=]+)\s*[:=]\s*(.+)$/)
  if (kv) {
    const k = KEYWORDS[norm(kv[1]).replace(/ /g, '')]
    if (k === 'country' || k === 'position') {
      q = kv[2]
      only = k
    }
  }
  if (only !== 'country' && !current.position) {
    const p = positionStrict(q)
    if (p) return { draft: { position: p }, bare: true }
  }
  if (only !== 'position' && !current.nationality) {
    const c = findCountry(q, true)
    if (c) return { draft: { nationality: c }, bare: true }
  }
  return null
}

/** Texto do usuário que volta para a tela: curto e sem palavrão. */
const echo = (s?: string) => {
  const v = (s ?? '').replace(/\s+/g, ' ').trim()
  if (!v || isOffensive(v)) return ''
  return v.length > 20 ? `${v.slice(0, 19)}…` : v
}

/**
 * Retorno para o criador na tela ("Nome: GABIGOL ✓ · País: Brasil ✓", "País não reconhecido: …").
 * `countryName` traduz o código para o nome (sem ele, mostra o código). null = nada a dizer (ex.: "!ok").
 */
export function creatorFeedback(p: CreatorParse, countryName?: (code: string) => string | undefined): string | null {
  if (p.hint) return p.hint
  const ok: string[] = []
  if (p.draft.surname) ok.push(`Nome: ${p.draft.surname}${p.shortened ? ' (até 15 letras)' : ''}`)
  if (p.draft.nationality) ok.push(`País: ${countryName?.(p.draft.nationality) ?? p.draft.nationality}`)
  if (p.draft.position) ok.push(`Posição: ${POSITION_NAMES[p.draft.position]}`)
  const v = echo(p.value)
  const problem =
    p.rejected === 'name'
      ? 'Esse nome não pode — escolha outro'
      : p.rejected === 'name-long'
        ? 'Nome muito longo (até 15 letras) — escolha outro'
        : p.rejected === 'country'
          ? `País não reconhecido${v ? `: ${v}` : ''} — tente !pais Brasil`
          : p.rejected === 'position'
            ? `Posição não reconhecida${v ? `: ${v}` : ''} — tente !posicao atacante`
            : ''
  const parts = [ok.length ? `${ok.join(' · ')} ✓` : '', problem].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}
