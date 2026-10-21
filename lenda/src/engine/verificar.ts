/**
 * Verificação por replay (servidor/CONTRATO-v33.md §B): joga de novo, sem tela nem animação, uma carreira do Clássico a
 * partir do replay gravado (./replay.ts) e compara os números com os que estão guardados. Só a tela #/verificar do
 * admin carrega este módulo.
 *
 *   const v = await verificarCarreira(engine, data, entry, avaliar, { servidor, dadosUsados })   // { ok, conclusao, diferencas… }
 *   api('admin.php', { corpo: { acao: 'candidato_verificar', id, resultado: resultadoParaServidor(v) } })
 *
 * §E (correções): as contagens de taças e prêmios são lidas com a MESMA regra do servidor (_carreiras.php: inteiro de 0 a
 * 10.000; fora disso a carreira não bate); os números que o servidor gravou (`servidor`, o meta do admin.php?r=carreira) têm
 * de ser os da carreira guardada; o bônus de OVR do replay tem de ser o da carreira e o do servidor; e a carreira jogada com
 * outra versão dos dados do jogo, sem essa versão em mãos, dá "inconclusiva" (não "não bateu") quando só os números
 * refeitos diferem.
 */
import type { CareerEngine } from './api'
import type { CareerState, CareerSummary, GameData, PlayerIdentity } from './types'
import { DADOS_VERSAO } from '../data/versao'
import { normalizarReplay, sementeDoPar, type CareerReplay } from './replay'
import { ACHIEVEMENT_BY_ID, CONQUISTAS_REGRAS_V, detectAchievements } from './career/achievements'

// ───────────────────────────── jogar de novo ─────────────────────────────

export interface Divergencia {
  /** Decisão (1 = a primeira) em que o replay não bateu com o motor. */
  passo: number
  motivo: string
}

export interface ResultadoReplay {
  state: CareerState
  summary: CareerSummary | null
  passos: number
  divergencia: Divergencia | null
  /** Diferenças pequenas que não impedem de seguir (o cartão em outra posição, outro número de opções). */
  avisos: string[]
}

/**
 * Joga a carreira de novo, decisão por decisão, sem tela nem animação. `ceder` (opcional) roda entre as decisões
 * (a tela de verificação devolve o controle ao navegador e mostra o progresso).
 */
export async function jogarReplay(
  engine: CareerEngine,
  data: GameData,
  replay: CareerReplay,
  ceder?: (passo: number, total: number) => void | Promise<void>,
): Promise<ResultadoReplay> {
  const seed = sementeDoPar(replay.seed)
  let state = replay.bonusOvr ? engine.newCareer(data, replay.identity, replay.pace, seed, { bonusOvr: replay.bonusOvr }) : engine.newCareer(data, replay.identity, replay.pace, seed)
  const avisos: string[] = []
  let divergencia: Divergencia | null = null
  let passos = 0
  for (let i = 0; i < replay.picks.length; i++) {
    const p = replay.picks[i]
    const d = state.pendingDecision
    if (state.retired || state.phase === 'finished' || !d) {
      divergencia = { passo: i + 1, motivo: `A carreira acabou na decisão ${i}, mas o replay tem ${replay.picks.length}.` }
      break
    }
    const idx = d.options.findIndex((o) => o.id === p.id)
    if (idx < 0) {
      divergencia = { passo: i + 1, motivo: `A decisão ${i + 1} (${d.title}) não tem a opção "${p.id}".` }
      break
    }
    if (p.kind && p.kind !== d.kind) avisos.push(`Decisão ${i + 1}: o replay diz ${p.kind}, o motor deu ${d.kind}.`)
    else if (p.idx !== idx || p.n !== d.options.length) avisos.push(`Decisão ${i + 1}: a opção estava em outra posição (${p.idx + 1} de ${p.n} no replay, ${idx + 1} de ${d.options.length} agora).`)
    state = engine.choose(data, state, p.id).state
    passos++
    if (ceder) await ceder(passos, replay.picks.length)
  }
  if (!divergencia && !(state.retired || state.phase === 'finished')) divergencia = { passo: passos + 1, motivo: 'As escolhas do replay acabaram e a carreira ainda não tinha terminado.' }
  let summary: CareerSummary | null = null
  try {
    summary = engine.summarize(data, state)
  } catch {
    summary = null
  }
  return { state, summary, passos, divergencia, avisos }
}

// ───────────────────────────── comparar ─────────────────────────────

/** Os números que a verificação confere (os do contrato e mais dois que denunciam adulteração). */
export interface NumerosCarreira {
  pico: number
  nota: number | null
  gols: number
  titulos: number
  copas: number
  libertadores: number
  bolasOuro: number
  jogos: number
  temporadas: number
  /** v3.4 (os critérios dos desafios de emblema, CONTRATO-v34 §A): Champions League. */
  champions: number
  /** v3.4: clubes diferentes na carreira. */
  clubes: number
  /** v3.4: o maior número de temporadas num mesmo clube (somadas, como o "Ídolo"). */
  mesmoClube: number
  /** v3.4: Copas do Mundo ganhas pela seleção da CRIAÇÃO (a do replay). */
  copasSelecao: number
}

export const ROTULOS: Record<keyof NumerosCarreira, string> = {
  pico: 'Pico de OVR',
  nota: 'Nota de Legado',
  gols: 'Gols',
  titulos: 'Títulos',
  copas: 'Copas do Mundo',
  libertadores: 'Libertadores',
  bolasOuro: 'Bolas de Ouro',
  jogos: 'Jogos',
  temporadas: 'Temporadas',
  champions: 'Champions League',
  clubes: 'Clubes',
  mesmoClube: 'Temporadas no mesmo clube',
  copasSelecao: 'Copas pela seleção da criação',
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** O teto de uma contagem de taça ou prêmio (o mesmo do servidor). */
export const CONTAGEM_MAX = 10_000

/**
 * Uma contagem de taça ou prêmio lida como o servidor lê (_carreiras.php, inteiro(count, 0, 10000)): a fração arredonda,
 * o que passa de 0 a 10.000 é cortado e o que não é número vale 0. §E: antes a soma era crua — uma Copa com -2 cancelava a
 * de +2 aqui e virava 0 lá, e o servidor gravava mais Copas do que o replay refazia sem a verificação perceber.
 */
export const contagem = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(CONTAGEM_MAX, Math.round(v))) : 0)

/** As contagens que não são um inteiro de 0 a 10.000 (o jogo nunca grava assim): ["world-cup×-2", …]. */
export function contagensInvalidas(s: Partial<CareerSummary> | null | undefined): string[] {
  const out: string[] = []
  const olha = (lista: unknown, chave: 'trophyId' | 'award') => {
    for (const x of Array.isArray(lista) ? lista : []) {
      const o = x as Record<string, unknown> | null
      const c = o && typeof o === 'object' ? o.count : undefined
      if (!o || typeof o !== 'object' || typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > CONTAGEM_MAX)
        out.push(`${o && typeof o === 'object' && typeof o[chave] === 'string' ? String(o[chave]).slice(0, 40) : '?'}×${String(c).slice(0, 12)}`)
    }
  }
  olha(s?.trophies, 'trophyId')
  olha(s?.awards, 'award')
  return out.slice(0, 10)
}

/**
 * Os números de um resumo (a mesma conta do servidor: _carreiras.php extrairCampos). `selecao`: a seleção da criação (a do
 * replay), para as Copas ganhas por ela (v3.4); sem ela, a do resumo.
 */
export function numerosDoResumo(s: Partial<CareerSummary> | null | undefined, nota: number | null, selecao?: string | null): NumerosCarreira {
  const trofeus = Array.isArray(s?.trophies) ? s.trophies : []
  const premios = Array.isArray(s?.awards) ? s.awards : []
  const conta = (id: string) => trofeus.reduce((t, x) => t + (x && x.trophyId === id ? contagem(x.count) : 0), 0)
  // clubes: os ids diferentes de summary.clubs; no mesmo clube: as temporadas de cada clube somadas (empréstimo à parte
  // conta no clube do empréstimo), a maior
  // (a mesma conta do servidor: o id do clube no formato do jogo, até 40 clubes; temporadas de 0 a 999)
  const porClube = new Map<string, number>()
  const clubesValidos = new Set<string>()
  for (const c of Array.isArray(s?.clubs) ? s.clubs : []) {
    if (!c || typeof c.clubId !== 'string' || !c.clubId) continue
    if (/^[A-Za-z0-9_-]{1,16}$/.test(c.clubId) && clubesValidos.size < 40) clubesValidos.add(c.clubId)
    const t = typeof c.seasons === 'number' && Number.isFinite(c.seasons) ? Math.max(0, Math.min(999, Math.round(c.seasons))) : 0
    porClube.set(c.clubId, Math.min(999, (porClube.get(c.clubId) ?? 0) + t))
  }
  const sel = selecao ?? s?.identity?.nationality ?? ''
  const nacionais = Array.isArray(s?.national?.trophies) ? s.national.trophies : []
  return {
    pico: n(s?.peakOvr),
    nota,
    gols: n(s?.totals?.goals),
    titulos: trofeus.reduce((t, x) => t + (x && typeof x === 'object' ? contagem(x.count) : 0), 0),
    copas: conta('world-cup'),
    libertadores: conta('libertadores'),
    bolasOuro: premios.reduce((t, x) => t + (x && x.award === 'ballon_dor' ? Math.min(1000, contagem(x.count)) : 0), 0),
    jogos: n(s?.totals?.apps),
    temporadas: n(s?.seasons),
    champions: conta('champions-league'),
    clubes: clubesValidos.size,
    mesmoClube: Math.max(0, ...porClube.values()),
    copasSelecao: nacionais.filter((t) => t && (t.trophyId === 'world-cup' || t.kind === 'world_cup') && t.minor !== true && !!sel && t.teamId === sel).length,
  }
}

/**
 * Os números que o SERVIDOR tirou desta carreira e gravou (o meta do admin.php?r=carreira): são eles que decidem o critério
 * do desafio. null = o servidor não mandou (servidor antigo).
 */
export interface NumerosServidor {
  copas: number | null
  libertadores: number | null
  titulos: number | null
  bolasOuro: number | null
  pico: number | null
  gols: number | null
  temporadas: number | null
  bonusOvr: number | null
  /** v3.4 (opcionais: o servidor de antes não manda). */
  champions?: number | null
  clubes?: number | null
  mesmoClube?: number | null
  copasSelecao?: number | null
  /** v3.4: a lista de conquistas que o servidor guardou desta carreira (carreiras.conquistas); null = não guardou. */
  conquistas?: string[] | null
}

const ROTULOS_SERVIDOR: [keyof NumerosServidor & keyof NumerosCarreira, string][] = [
  ['copas', 'Copas do Mundo no servidor'],
  ['libertadores', 'Libertadores no servidor'],
  ['titulos', 'Títulos no servidor'],
  ['bolasOuro', 'Bolas de Ouro no servidor'],
  ['pico', 'Pico de OVR no servidor'],
  ['gols', 'Gols no servidor'],
  ['temporadas', 'Temporadas no servidor'],
  ['champions', 'Champions no servidor'],
  ['clubes', 'Clubes no servidor'],
  ['mesmoClube', 'Temporadas no mesmo clube no servidor'],
  ['copasSelecao', 'Copas pela seleção no servidor'],
]

/** Um id de conquista no formato que o jogo e o servidor aceitam. */
const ID_CONQUISTA = /^[a-z0-9_.:-]{1,64}$/

/**
 * A lista de conquistas guardada numa carreira (HallEntry.career.achievements), como o servidor lê: só os ids das conquistas
 * do jogo, sem repetir (um id que o jogo não tem não conta na conta: fica de fora, e a verificação avisa).
 */
export function conquistasDaCarreira(entry: { career?: { achievements?: unknown } } | null | undefined): string[] {
  const l = entry?.career?.achievements
  return Array.isArray(l) ? [...new Set(l.filter((x): x is string => typeof x === 'string' && ID_CONQUISTA.test(x) && !!ACHIEVEMENT_BY_ID[x]))] : []
}

/** Ids na lista da carreira que o jogo não tem (o servidor ignora; só aviso). */
const conquistasEstranhas = (entry: { career?: { achievements?: unknown } } | null | undefined): string[] => {
  const l = entry?.career?.achievements
  return Array.isArray(l) ? [...new Set(l.filter((x): x is string => typeof x === 'string' && !ACHIEVEMENT_BY_ID[x]))].map((x) => x.slice(0, 40)).slice(0, 10) : []
}

export interface Diferenca {
  campo: keyof NumerosCarreira | 'id' | 'identidade' | 'replay' | 'trofeus' | 'contagem' | 'bonus' | 'servidor' | 'conquistas'
  rotulo: string
  guardado: string | number | null
  refeito: string | number | null
}

/**
 * §E: as diferenças que não dependem da versão dos dados do jogo (a semente, a contagem fora do formato, o bônus, os números
 * do servidor × os da carreira guardada): com qualquer uma, a carreira "não bateu", seja qual for a versão.
 */
export const DIFERENCAS_DEFINITIVAS: readonly Diferenca['campo'][] = ['id', 'contagem', 'bonus', 'servidor']

/** bateu · nao_bateu · inconclusiva (§E: só os números refeitos diferem, e a carreira é de outra versão dos dados). */
export type Conclusao = 'bateu' | 'nao_bateu' | 'inconclusiva'

/** O que precisa da carreira guardada (um HallEntry, do servidor). */
export interface CarreiraGuardada {
  id: string
  mode?: string
  identity?: Partial<PlayerIdentity>
  summary?: Partial<CareerSummary>
  legacy?: { score?: number; v?: number }
  career?: { seasons?: unknown; national?: unknown; identity?: Partial<PlayerIdentity>; bonusOvr?: unknown; achievements?: unknown }
  replay?: unknown
}

export interface Verificacao {
  ok: boolean
  /** §E: bateu, não bateu ou inconclusiva (outra versão dos dados, sem ela em mãos: não dá para recusar por isso). */
  conclusao: Conclusao
  /** Por que não deu para verificar (sem replay, Imersivo, motor diferente): null quando a verificação rodou. */
  motivo: string | null
  diferencas: Diferenca[]
  guardado: NumerosCarreira | null
  refeito: NumerosCarreira | null
  divergencia: Divergencia | null
  avisos: string[]
  passos: number
  /**
   * Versão dos dados com que a carreira foi jogada × a deste jogo; `usada` = a dos dados com que o motor refez agora;
   * `exata` = a carreira foi jogada inteira com essa versão (então os números refeitos valem como prova).
   */
  dados: { carreira: string; agora: string; usada: string; exata: boolean }
  ms: number
  /**
   * v3.4: a lista de conquistas da carreira (as que ela prova na conta): `guardadas` (career.achievements), `refeitas` (o
   * replay com as regras de agora), `aceitas` (as guardadas que o replay dá, com as regras de agora ou com as de antes de a
   * regra mudar — a carreira pode ter sido jogada antes), `faltam` (guardadas que o replay não dá: não bate) e `sobram`
   * (o replay dá e a lista não tem: só aviso). null = não comparou (não deu para verificar).
   */
  conquistas: { guardadas: string[]; refeitas: string[]; aceitas: string[]; faltam: string[]; sobram: string[]; regras: number } | null
}

/** A carreira foi jogada inteira com a versão `usada` dos dados? ("a>b" = atravessou um deploy: nunca é exata.) */
export function dadosExatos(dadosCarreira: string, usada: string): boolean {
  return !!dadosCarreira && !dadosCarreira.includes('>') && dadosCarreira === usada
}

/** A versão com que a carreira começou ("a>b" → "a"). */
export const versaoInicial = (dadosCarreira: string) => dadosCarreira.split('>')[0] ?? ''

function concluir(ok: boolean, diferencas: readonly Diferenca[], exata: boolean): Conclusao {
  if (ok) return 'bateu'
  if (exata || diferencas.some((d) => DIFERENCAS_DEFINITIVAS.includes(d.campo))) return 'nao_bateu'
  return 'inconclusiva'
}

type Avaliar = (r: { id: string; identity: PlayerIdentity; seasons: CareerState['seasons']; national: CareerState['national'] }) => Promise<{ score: number; v?: number }>

/** Troféus por id (para dizer qual taça mudou quando o total bate por acaso), com a contagem lida como o servidor lê. */
function trofeusPorId(s: Partial<CareerSummary> | null | undefined): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of Array.isArray(s?.trophies) ? s.trophies : []) if (t && typeof t.trophyId === 'string') m.set(t.trophyId, (m.get(t.trophyId) ?? 0) + contagem(t.count))
  return m
}

/** O bônus de OVR que a carreira guardada diz (career.bonusOvr; sem ele, 0). */
const bonusDaCarreira = (entry: CarreiraGuardada) => {
  const b = entry.career?.bonusOvr
  return b === undefined || b === null ? 0 : typeof b === 'number' && Number.isFinite(b) ? b : NaN
}

/**
 * Compara os números guardados com os refeitos. `notaGuardadaVale`: a nota guardada foi calculada com os pesos de
 * agora (senão a nota não entra na conta — mudou a fórmula, não a carreira).
 */
export function compararNumeros(g: NumerosCarreira, r: NumerosCarreira, notaGuardadaVale = true): Diferenca[] {
  const out: Diferenca[] = []
  for (const k of Object.keys(ROTULOS) as (keyof NumerosCarreira)[]) {
    // números que um dos lados não tem (resumo de um formato antigo): não compara
    if (typeof g[k] === 'undefined' || typeof r[k] === 'undefined') continue
    if (k === 'nota' && (!notaGuardadaVale || g.nota === null || r.nota === null)) continue
    if (g[k] !== r[k]) out.push({ campo: k, rotulo: ROTULOS[k], guardado: g[k], refeito: r[k] })
  }
  return out
}

/** A carreira jogada de novo a partir do replay (o que custa: ~2 s de motor). */
export interface Refeita {
  replay: CareerReplay
  resultado: ResultadoReplay
  nota: number | null
  numeros: NumerosCarreira
}

/** Joga o replay de novo e calcula a Nota de Legado da carreira refeita. Lança se o motor parar no meio. */
export async function refazerCarreira(engine: CareerEngine, data: GameData, replay: CareerReplay, avaliar: Avaliar, ceder?: (passo: number, total: number) => void | Promise<void>): Promise<Refeita> {
  const resultado = await jogarReplay(engine, data, replay, ceder)
  let nota: number | null = null
  try {
    const st = resultado.state
    nota = (await avaliar({ id: st.id, identity: st.identity, seasons: st.seasons, national: st.national })).score
  } catch {
    nota = null
  }
  return { replay, resultado, nota, numeros: numerosDoResumo(resultado.summary, nota, replay.identity.nationality) }
}

/** Por que esta carreira não dá para verificar (null = dá): Imersivo, sem replay, replay estragado. */
export function semVerificacao(entry: CarreiraGuardada): string | null {
  if (entry.mode === 'immersive' || entry.mode === 'imersivo') return 'Carreira do Modo Imersivo: não tem replay.'
  if (entry.replay == null) return 'Carreira sem replay (jogada antes da v3.3 ou fora do Clássico).'
  if (!normalizarReplay(entry.replay)) return 'O replay desta carreira está incompleto ou estragado.'
  return null
}

const notaDe = (entry: CarreiraGuardada) => (typeof entry.legacy?.score === 'number' ? entry.legacy.score : typeof entry.summary?.legacyScore === 'number' ? entry.summary.legacyScore : null)

/**
 * Compara a carreira guardada com a refeita (de `refazerCarreira` com o replay DESTA carreira). `versaoNota`: os pesos
 * da Nota de Legado de agora; a nota guardada com outros pesos não entra na conta (mudou a fórmula, não a carreira).
 */
export function compararCarreira(
  entry: CarreiraGuardada,
  refeita: Refeita,
  o: { versaoNota?: number; ms?: number; servidor?: NumerosServidor | null; dadosUsados?: string } = {},
): Verificacao {
  const replay = refeita.replay
  const r = refeita.resultado
  const guardado = numerosDoResumo(entry.summary, notaDe(entry), replay.identity.nationality)
  const diferencas: Diferenca[] = []
  const semente = sementeDoPar(replay.seed)
  if (entry.id !== `career-${semente}`) diferencas.push({ campo: 'id', rotulo: 'Semente', guardado: entry.id, refeito: `career-${semente}` })
  // §E: contagem de taça ou prêmio fora do formato (negativa, fração): o servidor e o motor nunca contariam igual
  const ruins = contagensInvalidas(entry.summary)
  if (ruins.length) diferencas.push({ campo: 'contagem', rotulo: 'Contagem de taças fora do formato', guardado: ruins.join(', '), refeito: 'inteiro de 0 a 10.000' })
  // §E: o bônus de OVR com que o motor refez (o do replay) tem de ser o da carreira guardada e o que o servidor conferiu
  const bonusCarreira = bonusDaCarreira(entry)
  const bonusServidor = o.servidor?.bonusOvr ?? null
  if (replay.bonusOvr !== bonusCarreira || (bonusServidor !== null && bonusServidor !== replay.bonusOvr))
    diferencas.push({ campo: 'bonus', rotulo: 'Bônus de OVR (replay × carreira × servidor)', guardado: `${Number.isNaN(bonusCarreira) ? '?' : bonusCarreira} na carreira, ${bonusServidor ?? '—'} no servidor`, refeito: replay.bonusOvr })
  // §E: os números que o servidor gravou (e que decidem o critério do desafio) têm de ser os da carreira guardada
  if (o.servidor)
    for (const [k, rotulo] of ROTULOS_SERVIDOR) {
      const sv = o.servidor[k]
      if (sv !== null && sv !== undefined && sv !== guardado[k]) diferencas.push({ campo: 'servidor', rotulo, guardado: sv, refeito: refeita.numeros[k] })
    }
  const notaVale = o.versaoNota === undefined || entry.legacy?.v === o.versaoNota
  diferencas.push(...compararNumeros(guardado, refeita.numeros, notaVale))
  // uma taça trocada por outra deixa o total igual: confere taça por taça
  const tg = trofeusPorId(entry.summary)
  const tr = trofeusPorId(r.summary)
  const trocadas = [...new Set([...tg.keys(), ...tr.keys()])].filter((k) => (tg.get(k) ?? 0) !== (tr.get(k) ?? 0))
  if (trocadas.length && !diferencas.some((d) => d.campo === 'titulos'))
    diferencas.push({ campo: 'trofeus', rotulo: 'Taças', guardado: trocadas.map((k) => `${k}×${tg.get(k) ?? 0}`).join(', '), refeito: trocadas.map((k) => `${k}×${tr.get(k) ?? 0}`).join(', ') })
  // a carreira guardada mostra outro jogador (seleção ou posição no fim da carreira)
  const ig = entry.career?.identity ?? entry.identity
  if (ig && (ig.nationality !== r.state.identity.nationality || ig.position !== r.state.identity.position))
    diferencas.push({ campo: 'identidade', rotulo: 'Seleção e posição', guardado: `${ig.nationality ?? '?'} ${ig.position ?? '?'}`, refeito: `${r.state.identity.nationality} ${r.state.identity.position}` })
  if (r.divergencia) diferencas.push({ campo: 'replay', rotulo: 'Replay', guardado: `${replay.picks.length} decisões`, refeito: r.divergencia.motivo })
  // v3.4: a lista de conquistas (o que a carreira prova na conta) — cada uma guardada tem de sair no replay
  const conquistas = compararConquistas(entry, r.state)
  if (conquistas.faltam.length) diferencas.push({ campo: 'conquistas', rotulo: 'Conquistas da carreira', guardado: conquistas.faltam.join(', ').slice(0, 400), refeito: 'não saem no replay' })
  const avisos = r.avisos.slice(0, 20)
  const estranhas = conquistasEstranhas(entry)
  if (estranhas.length) avisos.push(`A lista da carreira tem ids que o jogo não conhece (${estranhas.join(', ')}): o servidor não conta esses.`)
  if (conquistas.sobram.length) avisos.push(`O replay também dá ${conquistas.sobram.length === 1 ? 'a conquista' : 'as conquistas'} ${conquistas.sobram.join(', ')}, que não ${conquistas.sobram.length === 1 ? 'está' : 'estão'} na lista da carreira (não vale como prova; não é trapaça).`)
  // o servidor guardou uma lista (a que conta na conta): ela tem de ser a da carreira guardada
  const listaServidor = o.servidor?.conquistas
  if (listaServidor) {
    const g = new Set(conquistas.guardadas)
    const fora = listaServidor.filter((x) => !g.has(x))
    if (fora.length) diferencas.push({ campo: 'servidor', rotulo: 'Conquistas no servidor', guardado: fora.join(', ').slice(0, 400), refeito: 'não estão na carreira guardada' })
  }
  const usada = o.dadosUsados ?? DADOS_VERSAO
  const exata = dadosExatos(replay.dados, usada)
  const ok = diferencas.length === 0
  return {
    ok,
    conclusao: concluir(ok, diferencas, exata),
    motivo: null,
    diferencas,
    guardado,
    refeito: refeita.numeros,
    divergencia: r.divergencia,
    avisos,
    passos: r.passos,
    dados: { carreira: replay.dados, agora: DADOS_VERSAO, usada, exata },
    ms: o.ms ?? 0,
    conquistas,
  }
}

/**
 * v3.4: a lista de conquistas guardada × a do replay. A refeita é a que o motor juntou decisão a decisão (as regras de agora);
 * uma guardada que só a regra de antes dava (a carreira foi jogada antes da v3.4) também vale: ela é conferida com a regra
 * daquela versão no estado final refeito.
 */
export function compararConquistas(entry: CarreiraGuardada, final: CareerState): NonNullable<Verificacao['conquistas']> {
  const guardadas = conquistasDaCarreira(entry)
  const refeitas = [...new Set(Array.isArray(final.achievements) ? final.achievements : [])]
  const aceitas = new Set(refeitas)
  for (let v = 1; v < CONQUISTAS_REGRAS_V; v++) for (const id of detectAchievements(final, { regras: v })) aceitas.add(id)
  const g = new Set(guardadas)
  return {
    guardadas,
    refeitas,
    aceitas: guardadas.filter((id) => aceitas.has(id)),
    faltam: guardadas.filter((id) => !aceitas.has(id)),
    sobram: refeitas.filter((id) => !g.has(id)),
    regras: CONQUISTAS_REGRAS_V,
  }
}

/**
 * A verificação inteira: confere o replay, joga a carreira de novo e compara com o que está guardado. `avaliar` é a
 * Nota de Legado (computeLegacy do jogo: o motor de legado vem por import dinâmico).
 */
export async function verificarCarreira(
  engine: CareerEngine,
  data: GameData,
  entry: CarreiraGuardada,
  avaliar: Avaliar,
  o: {
    versaoNota?: number
    ceder?: (passo: number, total: number) => void | Promise<void>
    agora?: () => number
    /** §E: os números que o servidor gravou (meta do admin.php?r=carreira). */
    servidor?: NumerosServidor | null
    /** §E: a versão dos dados em `data` (padrão: a deste jogo). */
    dadosUsados?: string
  } = {},
): Promise<Verificacao> {
  const agora = o.agora ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  const t0 = agora()
  const replay = normalizarReplay(entry.replay)
  const sem = semVerificacao(entry)
  const usada = o.dadosUsados ?? DADOS_VERSAO
  const vazio = (motivo: string, guardado: NumerosCarreira | null = null, inconclusiva = false): Verificacao => ({
    ok: false,
    conclusao: inconclusiva ? 'inconclusiva' : 'nao_bateu',
    motivo,
    diferencas: [],
    guardado,
    refeito: null,
    divergencia: null,
    avisos: [],
    passos: 0,
    dados: { carreira: replay?.dados ?? '', agora: DADOS_VERSAO, usada, exata: !!replay && dadosExatos(replay.dados, usada) },
    ms: Math.round(agora() - t0),
    conquistas: null,
  })
  if (sem || !replay) return vazio(sem ?? 'O replay desta carreira está incompleto ou estragado.')
  let refeita: Refeita
  try {
    refeita = await refazerCarreira(engine, data, replay, avaliar, o.ceder)
  } catch (err) {
    // com outros dados, o motor pode parar onde a carreira de verdade seguiu: não dá para concluir
    return vazio(`O motor parou no meio do replay: ${String((err as Error)?.message ?? err).slice(0, 160)}`, numerosDoResumo(entry.summary, notaDe(entry)), !dadosExatos(replay.dados, usada))
  }
  return compararCarreira(entry, refeita, { versaoNota: o.versaoNota, ms: Math.round(agora() - t0), servidor: o.servidor, dadosUsados: usada })
}

/** A verificação numa linha (vai em `detalhes.motivo`: o servidor guarda até 200 letras como o motivo da recusa). */
export function motivoCurto(v: Verificacao): string | null {
  if (v.ok) return null
  if (v.conclusao === 'inconclusiva') return `Inconclusiva: a carreira é da versão ${v.dados.carreira} dos dados e o jogo refez com a ${v.dados.usada}.`.slice(0, 200)
  if (v.motivo) return v.motivo.slice(0, 200)
  const partes = v.diferencas.map((d) => `${d.rotulo}: ${d.guardado ?? '—'} → ${d.refeito ?? '—'}`)
  return `Não bateu na verificação pelo jogo. ${partes.join('; ')}`.slice(0, 200)
}

/** O `resultado` que vai no candidato_verificar (curto: o servidor guarda como texto, até 8 KB). */
export function resultadoParaServidor(v: Verificacao): { ok: boolean; detalhes: Record<string, unknown> } {
  return {
    ok: v.ok,
    detalhes: {
      v: 1,
      conclusao: v.conclusao,
      motivo: motivoCurto(v),
      diferencas: v.diferencas.slice(0, 20).map((d) => ({ campo: d.campo, guardado: typeof d.guardado === 'string' ? d.guardado.slice(0, 200) : d.guardado, refeito: typeof d.refeito === 'string' ? d.refeito.slice(0, 200) : d.refeito })),
      guardado: v.guardado,
      refeito: v.refeito,
      passos: v.passos,
      divergencia: v.divergencia,
      avisos: v.avisos.slice(0, 5).map((a) => a.slice(0, 200)),
      dadosCarreira: v.dados.carreira,
      dadosJogo: v.dados.agora,
      dadosUsados: v.dados.usada,
      dadosExatos: v.dados.exata,
      ms: v.ms,
      // v3.4: as conquistas que a carreira prova (as aceitas) e as que não saíram no replay
      conquistas: v.conquistas ? { regras: v.conquistas.regras, aceitas: v.conquistas.aceitas, faltam: v.conquistas.faltam, sobram: v.conquistas.sobram.slice(0, 20) } : null,
    },
  }
}
