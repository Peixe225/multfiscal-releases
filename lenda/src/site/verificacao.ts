/**
 * Verificação por replay pelo admin (#/verificar?id=<carreiras.id>[&candidato=<id>] — servidor/CONTRATO-v33.md §B):
 * busca a carreira em admin.php?r=carreira (só com a sessão do painel), roda o motor de novo e manda o resultado com
 * candidato_verificar. Aqui fica o que não é tela: buscar, decidir para quem mandar, montar o pedido.
 *
 *   const c = await buscarCarreiraAdmin('123')        // { entry, meta, servidor, candidatos }
 *   const d = await dadosParaVerificar(replay.dados, dadosDeHoje)   // §E: a versão dos dados com que a carreira foi jogada
 *   const alvo = alvoDoResultado(c.candidatos, '7')   // { id: 7 } | { carreira: 123 } | null
 *   const feitos = await mandarResultado(alvo, resultadoParaServidor(v))   // [{id, estado, motivo}] (o servidor pode recusar)
 *
 * v3.4 (CONTRATO-v34 §A.0): a carreira-prova (a que prova conquistas na conta) também recebe o resultado (prova_verificar),
 * e #/verificar?conta=<id> verifica em lote as carreiras-prova de uma conta (admin.php?r=provas).
 *
 *   const p = await buscarProvasConta(7)                          // a conta, as conquistas e as carreiras-prova
 *   const r = await mandarProvas([{ carreira: 123, ok: true, detalhes }])   // até 50 por pedido
 */
import type { NumerosServidor } from '@/engine/verificar'
import type { GameData } from '@/engine/types'
import { hashSeed } from '@/engine/rng'
import { DADOS_VERSAO } from '@/data/versao'
import type { HallEntry } from '@/store/career'
import type { MetaAdmin } from '@/store/resumoAdmin'
import { api, ErroApi } from './api'
import { hallEntryValido } from './carreiras'
import { normalizarMetaAdmin, queryResumoAdmin } from './resumoAdmin'

export interface CandidatoDaCarreira {
  id: number
  estado: 'pendente' | 'verificada' | 'recusada' | 'vencedora'
  em: string | null
  desafio: { id: number; slug: string; titulo: string }
}

export interface CarreiraParaVerificar {
  entry: HallEntry
  meta: MetaAdmin
  /** O servidor diz se a carreira tem replay (v3.3); null = não disse. */
  temReplay: boolean | null
  /** §E: os números que o servidor tirou da carreira e gravou (os que decidem o critério do desafio). */
  servidor: NumerosServidor
  candidatos: CandidatoDaCarreira[]
  /** v3.4: a carreira é prova de conquistas na conta (o servidor guardou a lista dela) e o que a verificação já disse. */
  prova: ProvaDaCarreiraAdmin
}

export interface ProvaDaCarreiraAdmin {
  ehProva: boolean
  /** true = bateu · false = não bateu · null = ainda não verificada. */
  provaOk: boolean | null
  conquistas: string[] | null
  /**
   * §E: a versão do conteúdo que o servidor mandou (meta.versao, sha1 do HallEntry guardado). Vai junto no prova_verificar: se o
   * dono salvou outro conteúdo depois, o servidor não grava o resultado (pulados: mudou). null/ausente = servidor de antes.
   */
  versao?: string | null
}

const ID_CONQUISTA = /^[a-z0-9_.:-]{1,64}$/
/** Uma lista de ids de conquista (do servidor): só os válidos, sem repetir; não é lista = null. */
export const listaDeConquistas = (x: unknown): string[] | null => (Array.isArray(x) ? [...new Set(x.filter((i): i is string => typeof i === 'string' && ID_CONQUISTA.test(i)))] : null)
const boolOuNulo = (v: unknown) => (v === true || v === 1 ? true : v === false || v === 0 ? false : null)

/** v3.4: o que o meta do ?r=carreira diz da prova (meta.prova, meta.provaOk, meta.conquistas). */
export function provaDoMeta(meta: unknown): ProvaDaCarreiraAdmin {
  const m = (meta ?? {}) as Record<string, unknown>
  const conquistas = listaDeConquistas(m.conquistas)
  const p = m.prova
  const ehProva = p === true || p === 1 || (!!p && typeof p === 'object') || (p === undefined && conquistas !== null)
  const versao = typeof m.versao === 'string' && /^[0-9a-f]{40}$/.test(m.versao) ? m.versao : null
  return { ehProva, provaOk: boolOuNulo(m.provaOk), conquistas, ...(versao ? { versao } : {}) }
}

const numOuNulo = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** §E: os números do servidor no meta do admin.php?r=carreira (copas, libertadores, titulos, bolasOuro, picoOvr, gols…). */
export function numerosDoServidor(meta: unknown): NumerosServidor {
  const m = (meta ?? {}) as Record<string, unknown>
  return {
    copas: numOuNulo(m.copas),
    libertadores: numOuNulo(m.libertadores),
    titulos: numOuNulo(m.titulos),
    bolasOuro: numOuNulo(m.bolasOuro),
    pico: numOuNulo(m.picoOvr),
    gols: numOuNulo(m.gols),
    temporadas: numOuNulo(m.temporadas),
    bonusOvr: numOuNulo(m.bonusOvr),
    // v3.4: os números dos critérios novos (quando o servidor manda) e a lista de conquistas que ele guardou
    champions: numOuNulo(m.champions),
    // (no meta, `clubes` pode ser a lista dos clubes: o número é o `nClubes`)
    clubes: numOuNulo(m.nClubes) ?? numOuNulo(m.clubes),
    mesmoClube: numOuNulo(m.mesmoClube) ?? numOuNulo(m.temporadasMesmoClube),
    copasSelecao: numOuNulo(m.copasSelecao) ?? numOuNulo(m.copasPelaSelecao),
    conquistas: listaDeConquistas(m.conquistas),
  }
}

const ESTADOS = ['pendente', 'verificada', 'recusada', 'vencedora'] as const

export function normalizarCandidatos(x: unknown): CandidatoDaCarreira[] {
  return (Array.isArray(x) ? x : [])
    .map((k): CandidatoDaCarreira | null => {
      const o = k as Record<string, unknown> | null
      const d = (o?.desafio ?? null) as Record<string, unknown> | null
      if (!o || typeof o.id !== 'number' || !Number.isInteger(o.id) || o.id <= 0 || !(ESTADOS as readonly unknown[]).includes(o.estado)) return null
      return {
        id: o.id,
        estado: o.estado as CandidatoDaCarreira['estado'],
        em: typeof o.em === 'string' ? o.em : null,
        desafio: { id: typeof d?.id === 'number' ? d.id : 0, slug: typeof d?.slug === 'string' ? d.slug.slice(0, 64) : '', titulo: typeof d?.titulo === 'string' ? d.titulo.slice(0, 120) : 'Desafio' },
      }
    })
    .filter((k): k is CandidatoDaCarreira => !!k)
    .slice(0, 20)
}

/** A carreira e o que o painel sabe dela. Lança ErroApi (401/403 = a sessão do painel acabou; 404 = não existe). */
export async function buscarCarreiraAdmin(id: string): Promise<CarreiraParaVerificar> {
  const r = await api<{ meta?: unknown; carreira?: unknown; candidatos?: unknown }>('admin.php', { query: queryResumoAdmin(id), tempo: 25_000 })
  const meta = normalizarMetaAdmin(r.meta)
  if (!hallEntryValido(r.carreira) || !meta) throw new ErroApi('servidor', 200, 'Essa carreira veio incompleta do servidor.')
  const m = r.meta as { temReplay?: unknown }
  return { entry: r.carreira, meta, temReplay: typeof m?.temReplay === 'boolean' ? m.temReplay : null, servidor: numerosDoServidor(r.meta), candidatos: normalizarCandidatos(r.candidatos), prova: provaDoMeta(r.meta) }
}

/** O nome de uma versão dos dados ("2026-09-28.ff31cb13") que dá para pôr no endereço. */
const VERSAO_RE = /^\d{4}-\d{2}-\d{2}\.[0-9a-f]{8}$/

/**
 * §E: a versão dos dados do jogo com que a carreira foi jogada. A deste jogo → `hoje`. Outra → o arquivo que o build do
 * site publica a cada versão (dados/<versão>.json, scripts/build-site.mjs; os deploys acumulam a pasta), conferido pelo
 * hash do próprio nome (FNV-1a do arquivo, como o DADOS_VERSAO). Sem ele (versão de antes da pasta, sem rede, hash que não
 * bate) → `hoje`, e a verificação diz que os dados não são os da carreira (então "não bateu" só pelos números refeitos
 * vira "inconclusiva").
 */
export async function dadosParaVerificar(
  dadosCarreira: string,
  hoje: GameData,
  buscar: (url: string) => Promise<Response> = (u) => fetch(u, { credentials: 'same-origin', cache: 'force-cache' }),
): Promise<{ data: GameData; versao: string }> {
  const versao = dadosCarreira.split('>')[0] ?? ''
  if (!versao || versao === DADOS_VERSAO || !VERSAO_RE.test(versao)) return { data: hoje, versao: DADOS_VERSAO }
  try {
    const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/lenda/'
    const res = await buscar(new URL(`dados/${versao}.json`, base).href)
    if (!res.ok) return { data: hoje, versao: DADOS_VERSAO }
    const txt = await res.text()
    const d = JSON.parse(txt) as GameData
    const esperado = `${String(d?.generatedAt ?? '').slice(0, 10)}.${hashSeed(txt).toString(16).padStart(8, '0')}`
    if (esperado !== versao || !Array.isArray(d.clubs) || !d.clubs.length) return { data: hoje, versao: DADOS_VERSAO }
    return { data: d, versao }
  } catch {
    return { data: hoje, versao: DADOS_VERSAO }
  }
}

export type AlvoResultado = { id: number } | { carreira: number }

/**
 * Para quem vai o resultado: o candidato do link (o "Verificar no jogo" do painel manda `candidato`), senão todos os
 * candidatos desta carreira que ainda não venceram (o servidor aceita `carreira`). Sem candidato nenhum: null (a
 * verificação fica só na tela).
 */
export function alvoDoResultado(candidatos: readonly CandidatoDaCarreira[], candidato: string | undefined, pk: number): AlvoResultado | null {
  const n = candidato && /^\d{1,10}$/.test(candidato) ? Number(candidato) : 0
  if (n > 0) return { id: n }
  if (pk > 0 && candidatos.some((k) => k.estado !== 'vencedora')) return { carreira: pk }
  return null
}

/** O que o servidor fez com cada candidato (§E: com a verificação que bateu, ele ainda recusa a carreira que não cumpre mais). */
export interface CandidatoFeito {
  id: number
  estado: CandidatoDaCarreira['estado']
  motivo: string | null
}

export async function mandarResultado(alvo: AlvoResultado, resultado: { ok: boolean; detalhes: Record<string, unknown> }): Promise<CandidatoFeito[]> {
  const r = await api<{ candidatos?: unknown }>('admin.php', { corpo: { acao: 'candidato_verificar', ...alvo, resultado }, tempo: 20_000 })
  return (Array.isArray(r?.candidatos) ? r.candidatos : [])
    .map((k): CandidatoFeito | null => {
      const o = k as Record<string, unknown> | null
      if (!o || typeof o.id !== 'number' || !(ESTADOS as readonly unknown[]).includes(o.estado)) return null
      return { id: o.id, estado: o.estado as CandidatoFeito['estado'], motivo: typeof o.motivo === 'string' && o.motivo ? o.motivo.slice(0, 200) : null }
    })
    .filter((k): k is CandidatoFeito => !!k)
}

// ───────────────────────────── v3.4: carreiras-prova de uma conta ─────────────────────────────

export interface CarreiraProva {
  pk: number
  carreiraId: string
  jogador: string
  primeiraEm: string | null
  conquistas: string[]
  /** As que só esta carreira prova (verificar ela é o que confirma essas). */
  unicas: string[]
  /** Está no conjunto mínimo de carreiras que cobre todas as provadas: o lote pode verificar só essas. */
  essencial: boolean
  /** Vale como prova agora (o servidor diz; false = semente, limite do dia, suspeita…). */
  vale: boolean
  motivo: string | null
  provaOk: boolean | null
}

export interface ProvasConta {
  usuario: { id: number; apelido: string; status: string }
  conquistas: { total: number; provadas: number; verificadas: number; naoProvadas: number; faltamProvar: string[]; faltamVerificar: string[] }
  carreiras: CarreiraProva[]
}

const n0 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)

export function normalizarProvasConta(x: unknown): ProvasConta | null {
  const r = x as Record<string, unknown> | null
  const u = (r?.usuario ?? null) as Record<string, unknown> | null
  if (!r || !u || typeof u.id !== 'number' || !Array.isArray(r.carreiras)) return null
  const c = (r.conquistas ?? {}) as Record<string, unknown>
  const carreiras = r.carreiras
    .map((k): CarreiraProva | null => {
      const o = k as Record<string, unknown> | null
      if (!o || typeof o.pk !== 'number' || !Number.isInteger(o.pk) || o.pk <= 0) return null
      return {
        pk: o.pk,
        carreiraId: typeof o.carreiraId === 'string' ? o.carreiraId.slice(0, 64) : '',
        jogador: typeof o.jogador === 'string' && o.jogador ? o.jogador.slice(0, 40) : '—',
        primeiraEm: typeof o.primeiraEm === 'string' ? o.primeiraEm : null,
        conquistas: listaDeConquistas(o.conquistas) ?? [],
        unicas: listaDeConquistas(o.unicas) ?? [],
        essencial: o.essencial === true || o.essencial === 1,
        vale: o.vale !== false && o.vale !== 0,
        motivo: typeof o.motivo === 'string' && o.motivo ? o.motivo.slice(0, 200) : null,
        provaOk: boolOuNulo(o.provaOk),
      }
    })
    .filter((k): k is CarreiraProva => !!k)
    .slice(0, 500)
  return {
    usuario: { id: u.id, apelido: typeof u.apelido === 'string' ? u.apelido.slice(0, 20) : 'Jogador', status: typeof u.status === 'string' ? u.status.slice(0, 16) : '' },
    conquistas: {
      total: n0(c.total),
      provadas: n0(c.provadas),
      verificadas: n0(c.verificadas),
      naoProvadas: n0(c.naoProvadas),
      faltamProvar: listaDeConquistas(c.faltamProvar) ?? [],
      faltamVerificar: listaDeConquistas(c.faltamVerificar) ?? [],
    },
    carreiras,
  }
}

/** As carreiras-prova de uma conta (admin.php?r=provas&usuario=). Lança ErroApi (401/403 = sessão do painel; 404). */
export async function buscarProvasConta(uid: string | number): Promise<ProvasConta> {
  const r = await api<unknown>('admin.php', { query: { r: 'provas', usuario: String(uid) }, tempo: 25_000 })
  const p = normalizarProvasConta(r)
  if (!p) throw new ErroApi('servidor', 200, 'A lista de carreiras-prova veio incompleta do servidor.')
  return p
}

/**
 * Quais carreiras o lote verifica: `essenciais` = as do conjunto mínimo que cobre as provadas (ou, sem a marca do servidor,
 * as que provam alguma conquista sozinhas), `faltam` = só as que ainda não foram verificadas, `todas` = todas as que valem.
 */
export function carreirasDoLote(p: ProvasConta, modo: 'essenciais' | 'faltam' | 'todas'): CarreiraProva[] {
  const valem = p.carreiras.filter((c) => c.vale)
  const temMarca = valem.some((c) => c.essencial)
  const ess = temMarca ? valem.filter((c) => c.essencial) : valem.filter((c) => c.unicas.length > 0)
  if (modo === 'todas') return valem
  if (modo === 'essenciais') return (ess.length ? ess : valem).filter((c) => c.provaOk !== true)
  return valem.filter((c) => c.provaOk === null)
}

export interface ResultadoProva {
  carreira: number
  ok: boolean
  detalhes: Record<string, unknown>
  /** §E: a versão do conteúdo que foi refeito (provaDoMeta().versao); sem ela, o servidor de antes. */
  versao?: string | null
}

/** §E: o resultado como vai para o servidor (a `versao` só quando há). */
export const resultadoParaProva = (r: ResultadoProva) => (r.versao ? { carreira: r.carreira, ok: r.ok, detalhes: r.detalhes, versao: r.versao } : { carreira: r.carreira, ok: r.ok, detalhes: r.detalhes })

export interface ProvasMandadas {
  carreiras: { pk: number; provaOk: boolean | null }[]
  pulados: { carreira: number; motivo: string }[]
  conta: { provadas: number; verificadas: number; total: number } | null
}

/** Manda os resultados (prova_verificar), em pedidos de até 50. */
export async function mandarProvas(resultados: readonly ResultadoProva[], uid?: number): Promise<ProvasMandadas> {
  const out: ProvasMandadas = { carreiras: [], pulados: [], conta: null }
  for (let i = 0; i < resultados.length; i += 50) {
    const r = await api<{ carreiras?: unknown; pulados?: unknown; contas?: unknown }>('admin.php', { corpo: { acao: 'prova_verificar', resultados: resultados.slice(i, i + 50).map(resultadoParaProva) }, tempo: 30_000 })
    for (const k of Array.isArray(r?.carreiras) ? r.carreiras : []) {
      const o = k as Record<string, unknown> | null
      if (o && typeof o.pk === 'number') out.carreiras.push({ pk: o.pk, provaOk: boolOuNulo(o.provaOk) })
    }
    for (const k of Array.isArray(r?.pulados) ? r.pulados : []) {
      const o = k as Record<string, unknown> | null
      if (o && typeof o.carreira === 'number') out.pulados.push({ carreira: o.carreira, motivo: typeof o.motivo === 'string' ? o.motivo.slice(0, 40) : '' })
    }
    const contas = (r?.contas ?? null) as Record<string, Record<string, unknown>> | null
    const c = contas && uid !== undefined ? contas[String(uid)] : null
    if (c && typeof c === 'object') out.conta = { provadas: n0(c.provadas), verificadas: n0(c.verificadas), total: n0(c.total) }
  }
  return out
}
