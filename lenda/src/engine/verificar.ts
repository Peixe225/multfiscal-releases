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

/** Os números de um resumo (a mesma conta do servidor: _carreiras.php extrairCampos). */
export function numerosDoResumo(s: Partial<CareerSummary> | null | undefined, nota: number | null): NumerosCarreira {
  const trofeus = Array.isArray(s?.trophies) ? s.trophies : []
  const premios = Array.isArray(s?.awards) ? s.awards : []
  const conta = (id: string) => trofeus.reduce((t, x) => t + (x && x.trophyId === id ? contagem(x.count) : 0), 0)
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
}

const ROTULOS_SERVIDOR: [keyof NumerosServidor & keyof NumerosCarreira, string][] = [
  ['copas', 'Copas do Mundo no servidor'],
  ['libertadores', 'Libertadores no servidor'],
  ['titulos', 'Títulos no servidor'],
  ['bolasOuro', 'Bolas de Ouro no servidor'],
  ['pico', 'Pico de OVR no servidor'],
  ['gols', 'Gols no servidor'],
  ['temporadas', 'Temporadas no servidor'],
]

export interface Diferenca {
  campo: keyof NumerosCarreira | 'id' | 'identidade' | 'replay' | 'trofeus' | 'contagem' | 'bonus' | 'servidor'
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
  career?: { seasons?: unknown; national?: unknown; identity?: Partial<PlayerIdentity>; bonusOvr?: unknown }
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
  return { replay, resultado, nota, numeros: numerosDoResumo(resultado.summary, nota) }
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
  const guardado = numerosDoResumo(entry.summary, notaDe(entry))
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
      if (sv !== null && sv !== guardado[k]) diferencas.push({ campo: 'servidor', rotulo, guardado: sv, refeito: refeita.numeros[k] })
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
    avisos: r.avisos.slice(0, 20),
    passos: r.passos,
    dados: { carreira: replay.dados, agora: DADOS_VERSAO, usada, exata },
    ms: o.ms ?? 0,
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
    },
  }
}
