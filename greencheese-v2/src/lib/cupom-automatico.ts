// O cupom que entra sozinho no pedido (pedido do Ian em 22/10: "Quando fechar o pedido tem que ir com o cupom
// diretamente"). Só a escolha, sem tela nem loja: quem diz se o cupom vale nesta sacola neste estado é quem chama
// (situacaoNoPedido, em cupom-uso.ts); o scripts/conferir-mensagem.mjs confere a ordem e as recusas daqui.
// - Entre os que valem, o que vence primeiro; vencendo juntos, o de maior raridade (o lendário antes do comum); ainda
//   empatado, o ganho primeiro e, por fim, o código (sempre o mesmo resultado nos dois lados da tela).
// - O que o cliente tirou neste pedido não volta sozinho: quando ele toca em "Tirar", a sacola guarda os códigos que a
//   conta tinha naquela hora (`recusados`) e só um cupom que ele ganhar depois pode entrar sozinho. A lista some quando a
//   sacola é limpa (o pedido seguinte começa do zero).
import { nivelRaridade, raridadeDe } from './raridade'

/** O que a escolha precisa de cada cupom (o Cupom da conta tem isso tudo). */
export interface CupomCandidato {
  codigo: string
  validoAte: number
  ganhoEm?: number
  retrato: { raridade?: unknown }
}

/** Ordem do automático: vence antes, mais raro, ganho antes, código. */
export function ordemAutomatica(a: CupomCandidato, b: CupomCandidato): number {
  return (
    a.validoAte - b.validoAte ||
    nivelRaridade(raridadeDe(b.retrato)) - nivelRaridade(raridadeDe(a.retrato)) ||
    (a.ganhoEm ?? 0) - (b.ganhoEm ?? 0) ||
    (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0)
  )
}

/**
 * O cupom que entra sozinho, ou null. `vale` diz se o cupom vale nesta sacola neste estado agora (ativo e com o que ele
 * pede no pedido); `recusados` são os códigos que o cliente já tinha quando tirou o cupom deste pedido.
 */
export function escolherCupomAutomatico<T extends CupomCandidato>(cupons: readonly T[], vale: (c: T) => boolean, recusados: readonly string[] = []): T | null {
  const fora = new Set(recusados)
  const candidatos = cupons.filter((c) => !fora.has(c.codigo) && vale(c))
  return candidatos.length ? [...candidatos].sort(ordemAutomatica)[0] : null
}
