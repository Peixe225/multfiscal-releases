/**
 * Verificação por replay (servidor/CONTRATO-v33.md §B): joga de novo, sem tela nem animação, uma carreira do Clássico a
 * partir do replay gravado (./replay.ts) e compara os números com os que estão guardados. Só a tela #/verificar do
 * admin carrega este módulo.
 *
 *   const v = await verificarCarreira(engine, data, entry, avaliar)   // { ok, diferencas, guardado, refeito… }
 *   api('admin.php', { corpo: { acao: 'candidato_verificar', id, resultado: resultadoParaServidor(v) } })
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

/** Os números de um resumo (a mesma conta do servidor: _carreiras.php extrairCampos). */
export function numerosDoResumo(s: Partial<CareerSummary> | null | undefined, nota: number | null): NumerosCarreira {
  const trofeus = Array.isArray(s?.trophies) ? s.trophies : []
  const premios = Array.isArray(s?.awards) ? s.awards : []
  const conta = (id: string) => trofeus.reduce((t, x) => t + (x && x.trophyId === id ? n(x.count) : 0), 0)
  return {
    pico: n(s?.peakOvr),
    nota,
    gols: n(s?.totals?.goals),
    titulos: trofeus.reduce((t, x) => t + n(x?.count), 0),
    copas: conta('world-cup'),
    libertadores: conta('libertadores'),
    bolasOuro: premios.reduce((t, x) => t + (x && x.award === 'ballon_dor' ? n(x.count) : 0), 0),
    jogos: n(s?.totals?.apps),
    temporadas: n(s?.seasons),
  }
}

export interface Diferenca {
  campo: keyof NumerosCarreira | 'id' | 'identidade' | 'replay' | 'trofeus'
  rotulo: string
  guardado: string | number | null
  refeito: string | number | null
}

/** O que precisa da carreira guardada (um HallEntry, do servidor). */
export interface CarreiraGuardada {
  id: string
  mode?: string
  identity?: Partial<PlayerIdentity>
  summary?: Partial<CareerSummary>
  legacy?: { score?: number; v?: number }
  career?: { seasons?: unknown; national?: unknown; identity?: Partial<PlayerIdentity> }
  replay?: unknown
}

export interface Verificacao {
  ok: boolean
  /** Por que não deu para verificar (sem replay, Imersivo, motor diferente): null quando a verificação rodou. */
  motivo: string | null
  diferencas: Diferenca[]
  guardado: NumerosCarreira | null
  refeito: NumerosCarreira | null
  divergencia: Divergencia | null
  avisos: string[]
  passos: number
  /** Versão dos dados com que a carreira foi jogada × a deste jogo. */
  dados: { carreira: string; agora: string }
  ms: number
}

type Avaliar = (r: { id: string; identity: PlayerIdentity; seasons: CareerState['seasons']; national: CareerState['national'] }) => Promise<{ score: number; v?: number }>

/** Troféus por id (para dizer qual taça mudou quando o total bate por acaso). */
function trofeusPorId(s: Partial<CareerSummary> | null | undefined): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of Array.isArray(s?.trophies) ? s.trophies : []) if (t && typeof t.trophyId === 'string') m.set(t.trophyId, (m.get(t.trophyId) ?? 0) + n(t.count))
  return m
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
export function compararCarreira(entry: CarreiraGuardada, refeita: Refeita, o: { versaoNota?: number; ms?: number } = {}): Verificacao {
  const replay = refeita.replay
  const r = refeita.resultado
  const guardado = numerosDoResumo(entry.summary, notaDe(entry))
  const diferencas: Diferenca[] = []
  const semente = sementeDoPar(replay.seed)
  if (entry.id !== `career-${semente}`) diferencas.push({ campo: 'id', rotulo: 'Semente', guardado: entry.id, refeito: `career-${semente}` })
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
  return {
    ok: diferencas.length === 0,
    motivo: null,
    diferencas,
    guardado,
    refeito: refeita.numeros,
    divergencia: r.divergencia,
    avisos: r.avisos.slice(0, 20),
    passos: r.passos,
    dados: { carreira: replay.dados, agora: DADOS_VERSAO },
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
  o: { versaoNota?: number; ceder?: (passo: number, total: number) => void | Promise<void>; agora?: () => number } = {},
): Promise<Verificacao> {
  const agora = o.agora ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  const t0 = agora()
  const replay = normalizarReplay(entry.replay)
  const sem = semVerificacao(entry)
  const vazio = (motivo: string, guardado: NumerosCarreira | null = null): Verificacao => ({
    ok: false,
    motivo,
    diferencas: [],
    guardado,
    refeito: null,
    divergencia: null,
    avisos: [],
    passos: 0,
    dados: { carreira: replay?.dados ?? '', agora: DADOS_VERSAO },
    ms: Math.round(agora() - t0),
  })
  if (sem || !replay) return vazio(sem ?? 'O replay desta carreira está incompleto ou estragado.')
  let refeita: Refeita
  try {
    refeita = await refazerCarreira(engine, data, replay, avaliar, o.ceder)
  } catch (err) {
    return vazio(`O motor parou no meio do replay: ${String((err as Error)?.message ?? err).slice(0, 160)}`, numerosDoResumo(entry.summary, notaDe(entry)))
  }
  return compararCarreira(entry, refeita, { versaoNota: o.versaoNota, ms: Math.round(agora() - t0) })
}

/** A verificação numa linha (vai em `detalhes.motivo`: o servidor guarda até 200 letras como o motivo da recusa). */
export function motivoCurto(v: Verificacao): string | null {
  if (v.ok) return null
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
      motivo: motivoCurto(v),
      diferencas: v.diferencas.slice(0, 20).map((d) => ({ campo: d.campo, guardado: typeof d.guardado === 'string' ? d.guardado.slice(0, 200) : d.guardado, refeito: typeof d.refeito === 'string' ? d.refeito.slice(0, 200) : d.refeito })),
      guardado: v.guardado,
      refeito: v.refeito,
      passos: v.passos,
      divergencia: v.divergencia,
      avisos: v.avisos.slice(0, 5).map((a) => a.slice(0, 200)),
      dadosCarreira: v.dados.carreira,
      dadosJogo: v.dados.agora,
      ms: v.ms,
    },
  }
}
