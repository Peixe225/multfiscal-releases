import { create } from 'zustand'
import dados from '../dados/catalogo.json'
import { config } from '../dados/config'
import { aplicarPlanilha } from '../lib/planilha'
import type { Categoria, Produto } from '../lib/tipos'

interface CatalogoState {
  produtos: Produto[]
  categorias: Categoria[]
  fonte: 'json' | 'planilha'
}

// Produto de exemplo (demo: true) só aparece na prévia. Com modoPrevia = false, some do site.
const daLoja = (dados.produtos as Produto[]).filter((p) => config.modoPrevia || !p.demo)

export const useCatalogo = create<CatalogoState>(() => ({
  produtos: daLoja,
  categorias: dados.categorias as Categoria[],
  fonte: 'json',
}))

export function produtoPorId(id: string | null | undefined): Produto | undefined {
  if (!id) return undefined
  return useCatalogo.getState().produtos.find((p) => p.id === id)
}

/** Disponibilidade no estado atual. Estado sem atendimento (ou não escolhido) = indisponível. */
export function disponivelEm(p: Produto, uf: string | null | undefined): boolean {
  if (!uf) return false
  return (p.disponivel as Record<string, boolean>)[uf] === true
}

/** Planilha publicada do Google (opcional): o dono marca preço/disponível pelo celular. Falhou = segue o JSON. */
export async function carregarPlanilha(): Promise<void> {
  const url = config.planilhaCsvUrl
  if (!url) return
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(t)
    if (!r.ok) return
    const csv = await r.text()
    useCatalogo.setState((s) => ({ produtos: aplicarPlanilha(s.produtos, csv), fonte: 'planilha' }))
  } catch {
    /* segue com o catalogo.json */
  }
}
