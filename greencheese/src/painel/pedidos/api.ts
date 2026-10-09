// Conversa do painel com o servidor sobre pedidos, avisos no WhatsApp e falas do pedido guiado (API.md). Passa pelo
// mesmo pedir() do painel: csrf, sessão que cai (o login abre por cima e o pedido é refeito), banco ocupado e rede.
import { pedir } from '../api'
import type { ChaveTexto } from '../../dados/textos-pedido'
import type { CorpoAvisos, DadosAvisos, EnvioAviso, FiltroPedidos, ListaPedidos, PedidoAdmin, PedidoLinha, ResumoPedidos, StatusPedido, ConfigAvisos, SituacaoAvisos, TrocaFala } from './tipos'

type Ok<T> = T & { ok: true }

export interface FiltroLista {
  status: FiltroPedidos
  uf: string | null
  busca: string
  antes?: number
  limite?: number
}

export const listaPedidos = (f: FiltroLista, sinal?: AbortSignal) => {
  const params: Record<string, string> = { status: f.status }
  if (f.uf) params.uf = f.uf
  if (f.busca.trim()) params.busca = f.busca.trim()
  if (f.antes) params.antes = String(f.antes)
  if (f.limite) params.limite = String(f.limite)
  return pedir<Ok<ListaPedidos>>('GET', 'admin-pedidos', { params, sinal })
}

export const resumoPedidos = (sinal?: AbortSignal) => pedir<Ok<ResumoPedidos>>('GET', 'admin-pedidos-resumo', { sinal })

export const pedido = (id: number, sinal?: AbortSignal) =>
  pedir<Ok<{ agora: string; pedido: PedidoAdmin; mesmoCodigo: PedidoLinha[]; avisos: EnvioAviso[] }>>('GET', 'admin-pedido', { params: { id: String(id) }, sinal })

/** jaEstava: o pedido já tinha esse status (outro aparelho, ou o toque de novo depois do "demorou"). */
export const statusPedido = (id: number, status: StatusPedido) =>
  pedir<Ok<{ pedido: PedidoAdmin; jaEstava?: boolean }>>('POST', 'admin-pedido-status', { corpo: { id, status } })

export const salvarPedido = (c: { id: number; whatsapp?: string | null; nota?: string }) => pedir<Ok<{ pedido: PedidoAdmin }>>('POST', 'admin-pedido-salvar', { corpo: c })

export const apagarDadosPedido = (id: number) => pedir<Ok<{ pedido: PedidoAdmin }>>('POST', 'admin-pedido-apagar-dados', { corpo: { id } })

export const avisos = (sinal?: AbortSignal) => pedir<Ok<DadosAvisos>>('GET', 'admin-avisos', { sinal })

export const salvarAvisos = (c: CorpoAvisos) => pedir<Ok<{ config: ConfigAvisos; situacao: SituacaoAvisos }>>('POST', 'admin-avisos-salvar', { corpo: c })

/** Manda a mensagem de teste agora e devolve como foi (o gateway pode demorar: até 30 s). */
export const testarAvisos = () => pedir<Ok<{ envio: EnvioAviso }>>('POST', 'admin-avisos-testar', { corpo: {}, prazo: 30_000 })

export const reenviarAviso = (id: number) => pedir<Ok<{ envio: EnvioAviso }>>('POST', 'admin-aviso-reenviar', { corpo: { id }, prazo: 30_000 })

export type Trocas = Partial<Record<ChaveTexto, TrocaFala>>

export const falas = (sinal?: AbortSignal) => pedir<Ok<{ textos: Trocas; versao: string }>>('GET', 'admin-textos-pedido', { sinal })

/** texto null = volta ao padrão. Devolve todas as trocas. */
export const salvarFala = (chave: ChaveTexto, texto: string | null) => pedir<Ok<{ textos: Trocas; versao: string }>>('POST', 'admin-texto-pedido-salvar', { corpo: { chave, texto } })
