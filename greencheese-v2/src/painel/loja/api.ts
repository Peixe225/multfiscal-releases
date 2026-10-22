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
  SimulacaoSorte,
  Textos,
} from './tipos'

type Ok<T> = T & { ok: true } & Carimbo

export const loja = (sinal?: AbortSignal) => pedir<{ ok: true; loja: LojaAdmin }>('GET', 'admin-loja', { sinal })

export const salvarProduto = (c: ProdutoCorpo) => pedir<Ok<{ produto: ProdutoAdmin }>>('POST', 'admin-produto-salvar', { corpo: c })

/** A troca rápida: o valor novo (não "inverter"), então dois toques iguais dão no mesmo. */
export const produtoNoEstado = (id: string, uf: string, mudar: Partial<NoEstado>) =>
  pedir<Ok<{ produto: ProdutoAdmin }>>('POST', 'admin-produto-estado', { corpo: { id, uf, ...mudar } })

/** Uma troca do "em massa": o produto num estado, como estava e como ficou (o Desfazer manda o antes de volta). */
export interface MudancaMassa {
  id: string
  uf: string
  antes: NoEstado
  depois: NoEstado
}

export type CorpoMassa =
  | { ids: string[]; ufs: string[]; acao: 'vender' | 'tirar' | 'esgotado' | 'contar' | 'sem-contagem' | 'copiar'; estoque?: number; de?: string }
  | { acao: 'definir'; estados: ({ id: string; uf: string } & NoEstado)[] }

/** Produtos → Selecionar: a mesma troca em vários produtos e estados de uma vez (tudo ou nada, a versão sobe uma vez). */
export const emMassa = (c: CorpoMassa) =>
  pedir<Ok<{ acao: string; marcados: number; mudancas: MudancaMassa[]; produtos: ProdutoAdmin[] }>>('POST', 'admin-produtos-em-massa', { corpo: c })

export const apagarProduto = (id: string) => pedir<Ok<object>>('POST', 'admin-produto-apagar', { corpo: { id } })

export const ordemProdutos = (ids: string[]) => pedir<Ok<{ ordem: string[] }>>('POST', 'admin-produtos-ordem', { corpo: { ids } })

export const salvarCategoria = (c: { id?: string; nome?: string; curto?: string; icone?: string; bebida?: boolean; alcool?: boolean }) =>
  pedir<Ok<{ categoria: Omit<CategoriaAdmin, 'ordem' | 'produtos' | 'premios'> }>>('POST', 'admin-categoria-salvar', { corpo: c })

export const apagarCategoria = (id: string) => pedir<Ok<object>>('POST', 'admin-categoria-apagar', { corpo: { id } })

export const ordemCategorias = (ids: string[]) => pedir<Ok<{ ordem: string[] }>>('POST', 'admin-categorias-ordem', { corpo: { ids } })

export const salvarEstado = (c: EstadoCorpo) => pedir<Ok<{ estado: EstadoAdmin }>>('POST', 'admin-estado-salvar', { corpo: c })

export const salvarStories = (uf: string, produtos: string[]) => pedir<Ok<{ uf: string; produtos: string[] }>>('POST', 'admin-stories-salvar', { corpo: { uf, produtos } })

export const salvarLoja = (c: Partial<Ajustes> & { textos?: Partial<Textos> }) =>
  pedir<Ok<{ ajustes: Ajustes; textos: Textos }>>('POST', 'admin-loja-salvar', { corpo: c })

export const salvarSorte = (c: Partial<RegrasSorte>) => pedir<Ok<{ sorte: RegrasSorte }>>('POST', 'admin-sorte-salvar', { corpo: c })

/** Roda o sorteio de verdade `giros` vezes (100 a 10.000), sem gravar nada; uf null = todos os prêmios. */
export const simularSorte = (giros: number, uf: string | null) => pedir<{ ok: true } & SimulacaoSorte>('POST', 'admin-sorte-simular', { corpo: { giros, uf } })

export const salvarPremio = (c: PremioCorpo) => pedir<Ok<{ premio: PremioAdmin }>>('POST', 'admin-premio-salvar', { corpo: c })

export const apagarPremio = (id: string) => pedir<Ok<object>>('POST', 'admin-premio-apagar', { corpo: { id } })

/**
 * Sem assinatura: só diz o que sairia (a folha de confirmação mostra), com a assinatura do plano, sem apagar nada. Com a
 * assinatura da prévia: apaga, se nada mudou desde ela (mudou = 409 mudou, com o plano novo).
 */
export const exemplos = (assinatura?: string) =>
  pedir<Ok<{ plano: PlanoExemplos; assinatura: string; apagou: boolean }>>('POST', 'admin-loja-exemplos-apagar', { corpo: assinatura ? { assinatura } : { conferir: true } })
