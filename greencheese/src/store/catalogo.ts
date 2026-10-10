// O catálogo visto pelas telas: um pedaço da loja (src/store/loja.ts, a fonte única). useCatalogo é a própria loja
// (produtos, categorias…), então quem já lia daqui acompanha a troca da embutida pela do servidor sem mudar nada.
import { config } from '../dados/config'
import { aplicarPlanilha } from '../lib/planilha'
import type { Produto } from '../lib/tipos'
import { lojaPronta, produtoSumido, useLoja } from './loja'

export { useLoja as useCatalogo }

export function produtoPorId(id: string | null | undefined): Produto | undefined {
  if (!id) return undefined
  return useLoja.getState().produtos.find((p) => p.id === id)
}

/** O produto, ou o retrato dele se saiu da loja agora há pouco (a página aberta mostra como indisponível). */
export function produtoOuSumido(id: string | null | undefined): Produto | undefined {
  return id ? (produtoPorId(id) ?? produtoSumido(id)) : undefined
}

/** Disponibilidade no estado atual. Estado sem atendimento (ou não escolhido) = indisponível. */
export function disponivelEm(p: Produto, uf: string | null | undefined): boolean {
  if (!uf) return false
  return p.disponivel[uf] === true
}

/** "Restam X" no estado: as unidades quando o estoque contado chegou no limite do painel (senão null). */
export function restamEm(p: Produto, uf: string | null | undefined): number | null {
  if (!uf || p.disponivel[uf] !== true) return null
  return p.restam?.[uf] ?? null
}

/**
 * Planilha publicada do Google (opcional, só sem o servidor): o dono marca preço/disponível pelo celular. Com a loja
 * do servidor, quem manda é o painel. Falhou = segue o embutido.
 */
export async function carregarPlanilha(): Promise<void> {
  const url = config.planilhaCsvUrl
  if (!url) return
  await lojaPronta()
  if (useLoja.getState().fonte !== 'embutida') return
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(t)
    if (!r.ok) return
    const csv = await r.text()
    useLoja.setState((s) => ({ produtos: aplicarPlanilha(s.produtos, csv, s.canais.map((c) => c.uf)), marca: s.marca + 1 }))
  } catch {
    /* segue com o catalogo.json */
  }
}
