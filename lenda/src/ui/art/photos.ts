/**
 * Fotos de eventos da carreira (public/photos/<tema>-<n>.webp, 900 px de largura).
 *
 * Todas vêm do Unsplash (licença Unsplash: uso livre, crédito opcional — ver docs/CREDITOS.md).
 * `photoFor(artKey)` escolhe uma foto coerente com a chave de arte do card de decisão
 * (`${eventKey}-${optionKey}`, ex.: "training_extra-accept", "injury-continue", "retirement")
 * de forma determinística: a mesma chave sempre dá a mesma foto.
 */

export type PhotoTheme =
  | 'injury'
  | 'training'
  | 'rest'
  | 'press'
  | 'phone'
  | 'contract'
  | 'crowd'
  | 'celebration'
  | 'locker'
  | 'national'
  | 'airport'
  | 'money'
  | 'doctor'
  | 'tattoo'
  | 'school'
  | 'family'
  | 'tv'
  | 'captain'

/** Tema → arquivos em public/photos/. */
export const PHOTOS: Readonly<Record<PhotoTheme, readonly string[]>> = {
  injury: ['injury-1.webp', 'injury-2.webp', 'injury-3.webp'],
  training: ['training-1.webp', 'training-2.webp', 'training-3.webp'],
  rest: ['rest-1.webp', 'rest-2.webp'],
  press: ['press-1.webp', 'press-2.webp', 'press-3.webp'],
  phone: ['phone-1.webp', 'phone-2.webp'],
  contract: ['contract-1.webp', 'contract-2.webp', 'contract-3.webp'],
  crowd: ['crowd-1.webp', 'crowd-2.webp', 'crowd-3.webp'],
  celebration: ['celebration-1.webp', 'celebration-2.webp', 'celebration-3.webp'],
  locker: ['locker-1.webp', 'locker-2.webp'],
  // national-3 (camisa da CBF) fica fora do sorteio genérico: só entra para jogadores do Brasil.
  national: ['national-1.webp', 'national-2.webp'],
  airport: ['airport-1.webp', 'airport-2.webp'],
  money: ['money-1.webp', 'money-2.webp', 'money-3.webp'],
  doctor: ['doctor-1.webp', 'doctor-2.webp', 'doctor-3.webp'],
  tattoo: ['tattoo-1.webp', 'tattoo-2.webp'],
  school: ['school-1.webp', 'school-2.webp'],
  family: ['family-1.webp', 'family-2.webp'],
  tv: ['tv-1.webp', 'tv-2.webp', 'tv-3.webp'],
  captain: ['captain-1.webp'],
}

/** Variantes por nacionalidade (código FIFA) acrescentadas ao sorteio do tema. */
const NATIONAL_EXTRA: Readonly<Record<string, readonly string[]>> = {
  BRA: ['national-3.webp'],
}

/** Tema padrão por evento (eventKey). */
const EVENT_THEME: Readonly<Record<string, PhotoTheme>> = {
  // catálogo clássico
  training_extra: 'training',
  personal_coach: 'training',
  mysterious_substance: 'doctor',
  honesty_test: 'press',
  indecent_proposal: 'money',
  controversial_post: 'phone',
  season_load: 'training',
  position_change: 'training',
  position_competition: 'training',
  unexpected_prospect: 'training',
  club_priority: 'crowd',
  rival_offer: 'contract',
  club_crisis: 'locker',
  fan_backlash: 'crowd',
  return_home: 'airport',
  giant_tattoo: 'tattoo',
  tax_trouble: 'money',
  foreign_grandfather: 'national',
  finish_high_school: 'school',
  controversial_statement: 'press',
  triumphant_return: 'crowd',
  club_national_team_conflict: 'national',
  injury_at_peak: 'injury',
  decisive_penalty: 'crowd',
  injury: 'injury',
  // eventos novos
  contract_renewal: 'contract',
  captaincy: 'captain',
  saudi_millions: 'money',
  national_retirement: 'national',
  world_cup_dilemma: 'national',
  super_agent: 'contract',
  coach_conflict: 'locker',
  documentary: 'tv',
  mentor_prospect: 'training',
  position_retraining: 'training',
  // tipos de decisão / chaves avulsas
  academy: 'training',
  transfer: 'contract',
  loan: 'airport',
  loan_return: 'airport',
  non_renewal: 'locker',
  national_call: 'national',
  contract: 'contract',
  retirement: 'crowd',
  farewell: 'crowd',
  penalty: 'crowd',
  captain: 'captain',
  surgery: 'doctor',
  physio: 'doctor',
}

/** Ajustes por opção (chave completa `${eventKey}-${optionKey}` ou só `optionKey`). */
const OPTION_THEME: Readonly<Record<string, PhotoTheme>> = {
  'training_extra-reject': 'rest',
  'personal_coach-reject': 'rest',
  'season_load-stay_calm': 'rest',
  'mentor_prospect-reject': 'rest',
  'world_cup_dilemma-rest': 'rest',
  'controversial_post-support_family': 'family',
  'controversial_post-support_club': 'phone',
  'club_priority-prioritize_continental': 'celebration',
  'club_priority-prioritize_league': 'crowd',
  'rival_offer-reject': 'crowd',
  'return_home-stay_abroad': 'locker',
  'triumphant_return-stay': 'locker',
  'finish_high_school-reject': 'training',
  'club_national_team_conflict-comply': 'locker',
  'injury_at_peak-recover': 'doctor',
  'captaincy-decline': 'locker',
  'saudi_millions-stay': 'crowd',
  'national_retirement-retire_national': 'press',
  'super_agent-sign': 'money',
  'coach_conflict-confront': 'press',
  'coach_conflict-adapt': 'training',
  'documentary-decline': 'family',
  'mysterious_substance-reject': 'training',
  'honesty_test-accept': 'money',
  'honesty_test-reject': 'press',
  'indecent_proposal-proceed': 'phone',
  'indecent_proposal-reject': 'locker',
  'contract_renewal-test_market': 'phone',
  'super_agent-loyal': 'contract',
  'giant_tattoo-reject': 'rest',
  // opções que levam a outro clube
  join: 'airport',
  join_club: 'airport',
  search_exit: 'airport',
  stay_and_fight: 'locker',
  apologize: 'press',
}

/**
 * Mini-eventos do Imersivo (chave `mini-${evento}-${opção}`, engine/immersive/events.ts): tema por
 * opção; a chave só do evento vale para as opções sem entrada própria.
 */
const MINI_THEME: Readonly<Record<string, PhotoTheme>> = {
  treino_extra: 'training',
  'treino_extra-nao': 'rest',
  'festa-ir': 'phone',
  'festa-ficar': 'family',
  patrocinio: 'contract',
  'patrocinio-recusar': 'training',
  jovem_base: 'training',
  'jovem_base-semtempo': 'rest',
  discussao: 'locker',
  entrevista: 'press',
  'entrevista-recusar': 'locker',
  acao_social: 'family',
  'acao_social-nao': 'rest',
  conversa_tecnico: 'locker',
  dor_muscular: 'injury',
  'dor_muscular-tratar': 'doctor',
  post_antigo: 'phone',
  familia: 'family',
  'familia-foco': 'training',
  mentor: 'training',
  'mentor-agradecer': 'locker',
  provocacao: 'phone',
  'provocacao-ignorar': 'training',
  nutricionista: 'doctor',
  'nutricionista-nao': 'training',
  podcast: 'tv',
  'podcast-recusar': 'rest',
  clinica: 'training',
  'clinica-nao': 'locker',
  videogame: 'rest',
  capitao_cobra: 'captain',
  'capitao_cobra-responder': 'locker',
  jornal_estrangeiro: 'press',
  'jornal_estrangeiro-negar': 'crowd',
  desfalque: 'training',
  'desfalque-rodizio': 'rest',
}

/** FNV-1a 32 bits — estável entre sessões e builds. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Separa "event_key-option_key" (eventKey e optionKey usam `_`, o separador é o 1º `-`). */
function splitArt(artKey: string): [string, string] {
  const i = artKey.indexOf('-')
  return i < 0 ? [artKey, ''] : [artKey.slice(0, i), artKey.slice(i + 1)]
}

/** Tema de foto para uma chave de arte, ou null se nada combina. */
export function themeFor(artKey: string): PhotoTheme | null {
  if (!artKey) return null
  const key = artKey.trim().toLowerCase()
  if (key.startsWith('mini-')) {
    const rest = key.slice(5)
    return MINI_THEME[rest] ?? MINI_THEME[splitArt(rest)[0]] ?? null
  }
  const direct = OPTION_THEME[key] ?? EVENT_THEME[key] ?? (key in PHOTOS ? (key as PhotoTheme) : undefined)
  if (direct) return direct
  const [ev, opt] = splitArt(key)
  if (ev === 'injury') return 'injury' // injury-*, qualquer tipo de lesão
  return OPTION_THEME[`${ev}-${opt}`] ?? (opt ? OPTION_THEME[opt] : undefined) ?? EVENT_THEME[ev] ?? null
}

/** URL pública de um arquivo de foto (respeita o `base` do Vite). */
export function photoUrl(file: string): string {
  return `${import.meta.env.BASE_URL}photos/${file}`
}

export interface PhotoForOptions {
  /** Código FIFA da seleção do jogador — libera fotos específicas (ex.: BRA). */
  nationality?: string
  /** Sal extra para variar a foto entre carreiras mantendo o determinismo (ex.: seed). */
  salt?: string | number
  /** Tema usado quando a chave não tem mapeamento (ex.: inferido do texto com `themeFromText`). */
  fallbackTheme?: PhotoTheme | null
  /**
   * Posição do card entre as opções da mesma decisão (com o mesmo `salt`): a foto sai do tema em
   * sequência, então duas opções do mesmo tema nunca repetem a foto (se o tema tiver mais de uma).
   */
  slot?: number
}

/** Texto em pt-BR → tema (para chaves desconhecidas: título/rótulo da opção, título da decisão…). */
const TEXT_HINTS: readonly [RegExp, PhotoTheme][] = [
  [/aposent|despedid|pendurar/i, 'crowd'],
  [/pênalti|penalti|cobran[çc]a/i, 'crowd'],
  [/cirurg|m[ée]dic|fisio|recupera|tratament/i, 'doctor'],
  [/les[ãa]o|machuc|contus/i, 'injury'],
  [/trein|academia|f[íi]sic|prepara|pr[ée]-temporada|t[ée]cnica/i, 'training'],
  [/descans|rotina|folga|f[ée]rias|poupar/i, 'rest'],
  [/imprensa|entrevista|declara|coletiva|pol[êe]mica/i, 'press'],
  [/post|rede social|celular|internet|v[íi]deo viral/i, 'phone'],
  [/tatua/i, 'tattoo'],
  [/escola|estud|diploma|col[ée]gio/i, 'school'],
  [/fam[íi]lia|filh|m[ãa]e|pai|esposa/i, 'family'],
  [/document[áa]rio|s[ée]rie|tv|c[âa]mera|reality/i, 'tv'],
  [/capit[ãa]o|bra[çc]adeira/i, 'captain'],
  [/sele[çc][ãa]o|convoca|p[áa]tria|av[ôo]/i, 'national'],
  [/imposto|dinheiro|milh|sal[áa]rio|oferta|€|pix|dívida/i, 'money'],
  [/contrat|renova|agente|empres[áa]rio|assinar/i, 'contract'],
  [/viag|aeroporto|exterior|voltar para|empr[ée]stimo/i, 'airport'],
  [/vesti[áa]rio|elenco|t[ée]cnico|treinador|crise/i, 'locker'],
  [/torcida|f[ãa]s|est[áa]dio|vaia/i, 'crowd'],
  [/t[íi]tulo|ta[çc]a|campe[ãa]o|final/i, 'celebration'],
]

/** Tema a partir de texto; linhas são testadas em ordem (a 1ª que casar vence). */
export function themeFromText(text: string | undefined): PhotoTheme | null {
  if (!text) return null
  for (const line of text.split('\n')) for (const [re, t] of TEXT_HINTS) if (re.test(line)) return t
  return null
}

/**
 * Foto para a chave de arte de um card (`${eventKey}-${optionKey}`), já como URL pública,
 * ou null quando nenhum tema combina (o <EventArt> desenha a ilustração de reserva).
 */
export function photoFor(artKey: string, opts: PhotoForOptions = {}): string | null {
  const theme = themeFor(artKey) ?? opts.fallbackTheme ?? null
  if (!theme) return null
  let pool: readonly string[] = PHOTOS[theme]
  if (theme === 'national' && opts.nationality && NATIONAL_EXTRA[opts.nationality]) {
    pool = [...pool, ...NATIONAL_EXTRA[opts.nationality]]
  }
  if (pool.length === 0) return null
  const file = opts.slot != null ? pool[(hash(`${theme}|${opts.salt ?? ''}`) + opts.slot) % pool.length] : pool[hash(`${artKey}|${opts.salt ?? ''}`) % pool.length]
  return photoUrl(file)
}

/** Créditos das fotos (Unsplash) — para uma tela "Créditos" dentro do jogo. */
export const PHOTO_CREDITS: Readonly<Record<string, { author: string; unsplashId: string }>> = {
  'injury-1.webp': { author: 'Omar Ramadan', unsplashId: 'photo-1713711437257-0232e837f40c' },
  'injury-2.webp': { author: 'Matheus Protzen', unsplashId: 'photo-1774201426987-73ed89d3aa39' },
  'injury-3.webp': { author: 'Luis Quintero', unsplashId: 'photo-1645114429601-46077d470ca8' },
  'training-1.webp': { author: 'Max Zindel', unsplashId: 'photo-1650897877790-0e171d2207dc' },
  'training-2.webp': { author: 'Vikram TKV', unsplashId: 'photo-1551958219-acbc608c6377' },
  'training-3.webp': { author: 'Nigel Msipa', unsplashId: 'photo-1600679472829-3044539ce8ed' },
  'rest-1.webp': { author: 'Danai Tsoutreli', unsplashId: 'photo-1646668072507-b2215b873c70' },
  'rest-2.webp': { author: 'Simon Spring', unsplashId: 'photo-1672841828459-bc913fdcd995' },
  'press-1.webp': { author: 'Bogomil Mihaylov', unsplashId: 'photo-1516280440614-37939bbacd81' },
  'press-2.webp': { author: 'Andrew Medhat', unsplashId: 'photo-1570563568161-e4f5e8c6e27f' },
  'press-3.webp': { author: 'Headway', unsplashId: 'photo-1540575467063-178a50c2df87' },
  'phone-1.webp': { author: 'Adem AY', unsplashId: 'photo-1611926653458-09294b3142bf' },
  'phone-2.webp': { author: 'Berke Citak', unsplashId: 'photo-1724862936518-ae7fcfc052c1' },
  'contract-1.webp': { author: 'Cytonn Photography', unsplashId: 'photo-1521791055366-0d553872125f' },
  'contract-2.webp': { author: 'Amina Atar', unsplashId: 'photo-1681505531034-8d67054e07f6' },
  'contract-3.webp': { author: 'Scott Graham', unsplashId: 'photo-1450101499163-c8848c66ca85' },
  'crowd-1.webp': { author: 'Krzysztof Dubiel', unsplashId: 'photo-1629217855633-79a6925d6c47' },
  'crowd-2.webp': { author: 'Piero Huerto Gago', unsplashId: 'photo-1569863959165-56dae551d4fc' },
  'crowd-3.webp': { author: 'Igor Batista', unsplashId: 'photo-1705593973313-75de7bf95b56' },
  'celebration-1.webp': { author: 'Waldemar Brandt', unsplashId: 'photo-1551390415-0de411440ca3' },
  'celebration-2.webp': { author: 'Hanson Lu', unsplashId: 'photo-1558151748-f2621b5e52f0' },
  'celebration-3.webp': { author: 'Anders Krøgh Jørgensen', unsplashId: 'photo-1561917423-2ce508445fe4' },
  'locker-1.webp': { author: 'Cristian Tarzi', unsplashId: 'photo-1676498110083-89a7f89e8f88' },
  'locker-2.webp': { author: 'Michelle Myers', unsplashId: 'photo-1637028253736-ccf0e0e2da47' },
  'national-1.webp': { author: 'Alfonso Scarpa', unsplashId: 'photo-1765046804547-06375f9a707b' },
  'national-2.webp': { author: 'Omar Ramadan', unsplashId: 'photo-1641159009736-8a5fd4e52fef' },
  'national-3.webp': { author: 'Olumide Adekunle', unsplashId: 'photo-1783434423781-b942fefc59a0' },
  'airport-1.webp': { author: 'Oskar Kadaksoo', unsplashId: 'photo-1553619948-505cc1cdc320' },
  'airport-2.webp': { author: 'Daniel', unsplashId: 'photo-1653795163859-9ee39ecc6d62' },
  'money-1.webp': { author: 'Lance Asper', unsplashId: 'photo-1614200179396-2bdb77ebf81b' },
  'money-2.webp': { author: 'Victor Furtuna', unsplashId: 'photo-1618418721668-0d1f72aa4bab' },
  'money-3.webp': { author: 'omid armin', unsplashId: 'photo-1580048915913-4f8f5cb481c4' },
  'doctor-1.webp': { author: 'yury kirillov', unsplashId: 'photo-1649751361457-01d3a696c7e6' },
  'doctor-2.webp': { author: 'Toralf Thomassen', unsplashId: 'photo-1545463913-5083aa7359a6' },
  'doctor-3.webp': { author: 'Online Marketing', unsplashId: 'photo-1532938911079-1b06ac7ceec7' },
  'tattoo-1.webp': { author: 'Allef Vinicius', unsplashId: 'photo-1482329033286-79a3d24413b4' },
  'tattoo-2.webp': { author: 'Kristian Angelo', unsplashId: 'photo-1552627019-947c3789ffb5' },
  'school-1.webp': { author: 'Debby Hudson', unsplashId: 'photo-1517673132405-a56a62b18caf' },
  'school-2.webp': { author: 'Fa Barboza', unsplashId: 'photo-1610050731641-f855ccdaf3f6' },
  'family-1.webp': { author: 'Pablo Merchán Montes', unsplashId: 'photo-1533777419517-3e4017e2e15a' },
  'family-2.webp': { author: 'National Cancer Institute', unsplashId: 'photo-1576089073624-b5751a8f4de9' },
  'tv-1.webp': { author: 'Vanilla Bear Films', unsplashId: 'photo-1543235074-4768b5c2233c' },
  'tv-2.webp': { author: 'Simone Impei', unsplashId: 'photo-1567506476376-1282584643ca' },
  'tv-3.webp': { author: 'Jakob Owens', unsplashId: 'photo-1625690303837-654c9666d2d0' },
  'captain-1.webp': { author: 'Elist Nguyen', unsplashId: 'photo-1781863075425-91c985451a4a' },
}
