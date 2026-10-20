/**
 * "Fale conosco" (POST /lenda/api/suporte.php — servidor/CONTRATO-v33.md): dúvida, ideia, problema, recomendação ou
 * outro assunto, com ou sem conta (sem conta, o e-mail é obrigatório para a resposta chegar).
 *
 *   const { protocolo } = await enviarSuporte({ tipo: 'ideia', mensagem, email, pagina: '/hall' })
 *
 * O campo `site` é a isca para robôs: fica escondido na tela e vai como veio (preenchido, o servidor descarta calado).
 */
import { api } from './api'
import { erroEmail } from './conta'

export const EMAIL_CONTATO = 'contato@lenda.portalmultipla.online'

export type TipoSuporte = 'duvida' | 'ideia' | 'problema' | 'recomendacao' | 'outro'

export const TIPOS_SUPORTE: readonly { valor: TipoSuporte; rotulo: string; dica: string }[] = [
  { valor: 'duvida', rotulo: 'Dúvida', dica: 'Como funciona alguma coisa do jogo ou da conta' },
  { valor: 'ideia', rotulo: 'Ideia', dica: 'Algo que deixaria o LENDA melhor' },
  { valor: 'problema', rotulo: 'Problema', dica: 'Erro, tela travada, carreira que sumiu' },
  { valor: 'recomendacao', rotulo: 'Recomendação', dica: 'Clube, liga, lenda ou dado que falta ou está errado' },
  { valor: 'outro', rotulo: 'Outro assunto', dica: 'Qualquer outra coisa' },
]

export const MENSAGEM_MIN = 10
export const MENSAGEM_MAX = 2000

export function erroMensagem(m: string): string | null {
  const t = m.trim()
  if (t.length < MENSAGEM_MIN) return `Escreva um pouco mais (pelo menos ${MENSAGEM_MIN} letras).`
  if (t.length > MENSAGEM_MAX) return `A mensagem pode ter no máximo ${MENSAGEM_MAX} letras.`
  return null
}

export interface PedidoSuporte {
  tipo: TipoSuporte
  mensagem: string
  /** Obrigatório sem conta. */
  email?: string
  /** A tela de onde veio (rota do jogo). */
  pagina?: string
  /** A isca: o valor do campo escondido, como veio. */
  site?: string
}

/** O corpo do POST (sem e-mail quando logado: o servidor usa o da conta). */
export function corpoSuporte(p: PedidoSuporte, logado: boolean): Record<string, unknown> {
  const corpo: Record<string, unknown> = { tipo: p.tipo, mensagem: p.mensagem.trim().slice(0, MENSAGEM_MAX) }
  if (!logado && p.email) corpo.email = p.email.trim().slice(0, 190)
  if (p.pagina) corpo.pagina = p.pagina.slice(0, 120)
  if (p.site) corpo.site = p.site.slice(0, 200)
  return corpo
}

/** Confere antes de mandar (a mesma regra do servidor): devolve o primeiro erro, ou null. */
export function erroPedido(p: PedidoSuporte, logado: boolean): string | null {
  if (!TIPOS_SUPORTE.some((t) => t.valor === p.tipo)) return 'Escolha o assunto da mensagem.'
  const m = erroMensagem(p.mensagem)
  if (m) return m
  if (!logado) return erroEmail(p.email ?? '') ? 'Confira o seu e-mail: é por ele que a resposta chega.' : null
  return null
}

export async function enviarSuporte(p: PedidoSuporte, logado: boolean): Promise<{ protocolo: string | null }> {
  const r = await api<{ ok?: unknown; protocolo?: unknown }>('suporte.php', { corpo: corpoSuporte(p, logado), tempo: 20_000 })
  const protocolo = typeof r?.protocolo === 'string' && /^[A-Za-z0-9-]{4,24}$/.test(r.protocolo) ? r.protocolo : null
  return { protocolo }
}
