// Conversa do painel com o servidor sobre a equipe (logins e papéis) e os clientes do site (API.md). Passa pelo mesmo
// pedir() do painel: csrf, sessão que cai (o login abre por cima e o pedido é refeito), banco ocupado e rede.
import { pedir, type Arquivo } from '../api'
import type { Evento } from '../tipos'
import type { CorpoUsuario, CupomCliente, DetalheCliente, ListaClientes, SituacaoCodigo, UsuarioAdmin } from './tipos'

type Ok<T> = T & { ok: true }

export const usuarios = (sinal?: AbortSignal) => pedir<Ok<{ agora: string; usuarios: UsuarioAdmin[] }>>('GET', 'admin-usuarios', { sinal })

/** Cria (novo: true; a senha provisória volta uma vez) ou edita nome, papel e estados. */
export const salvarUsuario = (c: CorpoUsuario) => pedir<Ok<{ usuario: UsuarioAdmin; senhaProvisoria?: string }>>('POST', 'admin-usuario-salvar', { corpo: c })

/** Senha provisória nova (volta uma vez): as sessões dessa pessoa caem. */
export const redefinirSenha = (login: string) => pedir<Ok<{ usuario: UsuarioAdmin; senhaProvisoria: string }>>('POST', 'admin-usuario-senha', { corpo: { login } })

export const statusUsuario = (login: string, ativo: boolean) => pedir<Ok<{ usuario: UsuarioAdmin; jaEstava?: boolean }>>('POST', 'admin-usuario-status', { corpo: { login, ativo } })

/** O que uma pessoa da equipe fez (os últimos 100). */
export const eventosDe = (login: string, sinal?: AbortSignal) => pedir<Ok<{ eventos: Evento[] }>>('GET', 'admin-eventos', { params: { usuario: login }, sinal })

export const clientes = (f: { busca: string; promo: boolean; limite?: number }, sinal?: AbortSignal) => {
  const params: Record<string, string> = {}
  if (f.busca.trim()) params.busca = f.busca.trim()
  if (f.promo) params.promo = '1'
  if (f.limite) params.limite = String(f.limite)
  return pedir<Ok<ListaClientes>>('GET', 'admin-clientes', { params, sinal })
}

export const cliente = (id: number, sinal?: AbortSignal) => pedir<Ok<DetalheCliente>>('GET', 'admin-cliente', { params: { id: String(id) }, sinal })

export const apagarCliente = (id: number) => pedir<Ok<object>>('POST', 'admin-cliente-apagar', { corpo: { id } })

export const ajustesClientes = (codigo: boolean) => pedir<Ok<{ codigo: SituacaoCodigo }>>('POST', 'admin-clientes-ajustes', { corpo: { codigo } })

export const cupomUsado = (codigo: string, usado: boolean) => pedir<Ok<{ cupom: CupomCliente }>>('POST', 'admin-cupom-usado', { corpo: { codigo, usado } })

/** Baixa a lista de quem aceitou promoções (CSV pro Excel). */
export async function baixarPromocoes(): Promise<void> {
  const a = await pedir<Arquivo>('GET', 'admin-clientes-csv', { arquivo: true, prazo: 60_000 })
  const url = URL.createObjectURL(a.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = a.nome ?? 'clientes-promocoes.csv'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
