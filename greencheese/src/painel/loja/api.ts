// Conversa do painel com a loja no servidor (API.md, "Loja (painel)"). Passa pelo mesmo pedir() do resto do painel:
// csrf, sessão que cai (o login abre por cima e o pedido é refeito), banco ocupado e rede.
import { pedir } from '../api'
import type {
  Ajustes,
  Carimbo,
  CategoriaAdmin,
  EstadoAdmin,
  EstadoCorpo,
  LojaAdmin,
  NoEstado,
  PlanoExemplos,
  PremioAdmin,
  PremioCorpo,
  ProdutoAdmin,
  ProdutoCorpo,
  RegrasSorte,
  Textos,
} from './tipos'

type Ok<T> = T & { ok: true } & Carimbo

export const loja = (sinal?: AbortSignal) => pedir<{ ok: true; loja: LojaAdmin }>('GET', 'admin-loja', { sinal })

export const salvarProduto = (c: ProdutoCorpo) => pedir<Ok<{ produto: ProdutoAdmin }>>('POST', 'admin-produto-salvar', { corpo: c })

/** A troca rápida: o valor novo (não "inverter"), então dois toques iguais dão no mesmo. */
export const produtoNoEstado = (id: string, uf: string, mudar: Partial<NoEstado>) =>
  pedir<Ok<{ produto: ProdutoAdmin }>>('POST', 'admin-produto-estado', { corpo: { id, uf, ...mudar } })

export const apagarProduto = (id: string) => pedir<Ok<object>>('POST', 'admin-produto-apagar', { corpo: { id } })

export const ordemProdutos = (ids: string[]) => pedir<Ok<{ ordem: string[] }>>('POST', 'admin-produtos-ordem', { corpo: { ids } })

export const salvarCategoria = (c: { id?: string; nome?: string; curto?: string; icone?: string; bebida?: boolean }) =>
  pedir<Ok<{ categoria: Omit<CategoriaAdmin, 'ordem' | 'produtos' | 'premios'> }>>('POST', 'admin-categoria-salvar', { corpo: c })

export const apagarCategoria = (id: string) => pedir<Ok<object>>('POST', 'admin-categoria-apagar', { corpo: { id } })

export const ordemCategorias = (ids: string[]) => pedir<Ok<{ ordem: string[] }>>('POST', 'admin-categorias-ordem', { corpo: { ids } })

export const salvarEstado = (c: EstadoCorpo) => pedir<Ok<{ estado: EstadoAdmin }>>('POST', 'admin-estado-salvar', { corpo: c })

export const salvarStories = (uf: string, produtos: string[]) => pedir<Ok<{ uf: string; produtos: string[] }>>('POST', 'admin-stories-salvar', { corpo: { uf, produtos } })

export const salvarLoja = (c: Partial<Ajustes> & { textos?: Partial<Textos> }) =>
  pedir<Ok<{ ajustes: Ajustes; textos: Textos }>>('POST', 'admin-loja-salvar', { corpo: c })

export const salvarSorte = (c: Partial<RegrasSorte>) => pedir<Ok<{ sorte: RegrasSorte }>>('POST', 'admin-sorte-salvar', { corpo: c })

export const salvarPremio = (c: PremioCorpo) => pedir<Ok<{ premio: PremioAdmin }>>('POST', 'admin-premio-salvar', { corpo: c })

export const apagarPremio = (id: string) => pedir<Ok<object>>('POST', 'admin-premio-apagar', { corpo: { id } })

/** conferir: só diz o que sairia (a folha de confirmação mostra), sem apagar nada. */
export const exemplos = (conferir: boolean) =>
  pedir<Ok<{ plano: PlanoExemplos; apagou: boolean }>>('POST', 'admin-loja-exemplos-apagar', { corpo: conferir ? { conferir: true } : {} })
