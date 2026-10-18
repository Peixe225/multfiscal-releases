/**
 * Verificação por replay pelo admin (#/verificar?id=<carreiras.id>[&candidato=<id>] — servidor/CONTRATO-v33.md §B):
 * busca a carreira em admin.php?r=carreira (só com a sessão do painel), roda o motor de novo e manda o resultado com
 * candidato_verificar. Aqui fica o que não é tela: buscar, decidir para quem mandar, montar o pedido.
 *
 *   const c = await buscarCarreiraAdmin('123')        // { entry, meta, servidor, candidatos }
 *   const d = await dadosParaVerificar(replay.dados, dadosDeHoje)   // §E: a versão dos dados com que a carreira foi jogada
 *   const alvo = alvoDoResultado(c.candidatos, '7')   // { id: 7 } | { carreira: 123 } | null
 *   const feitos = await mandarResultado(alvo, resultadoParaServidor(v))   // [{id, estado, motivo}] (o servidor pode recusar)
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
  return { entry: r.carreira, meta, temReplay: typeof m?.temReplay === 'boolean' ? m.temReplay : null, servidor: numerosDoServidor(r.meta), candidatos: normalizarCandidatos(r.candidatos) }
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
