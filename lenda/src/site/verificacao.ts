/**
 * Verificação por replay pelo admin (#/verificar?id=<carreiras.id>[&candidato=<id>] — servidor/CONTRATO-v33.md §B):
 * busca a carreira em admin.php?r=carreira (só com a sessão do painel), roda o motor de novo e manda o resultado com
 * candidato_verificar. Aqui fica o que não é tela: buscar, decidir para quem mandar, montar o pedido.
 *
 *   const c = await buscarCarreiraAdmin('123')        // { entry, meta, candidatos }
 *   const alvo = alvoDoResultado(c.candidatos, '7')   // { id: 7 } | { carreira: 123 } | null
 *   await mandarResultado(alvo, resultadoParaServidor(v))
 */
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
  candidatos: CandidatoDaCarreira[]
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
  return { entry: r.carreira, meta, temReplay: typeof m?.temReplay === 'boolean' ? m.temReplay : null, candidatos: normalizarCandidatos(r.candidatos) }
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

export async function mandarResultado(alvo: AlvoResultado, resultado: { ok: boolean; detalhes: Record<string, unknown> }): Promise<void> {
  await api('admin.php', { corpo: { acao: 'candidato_verificar', ...alvo, resultado }, tempo: 20_000 })
}
