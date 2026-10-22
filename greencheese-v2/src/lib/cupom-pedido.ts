import { useEffect, useMemo } from 'react'
import { canalDa } from '../dados/canais'
import { chaveDaSacola, codigoVencido, useChat } from '../store/chat'
import { useContaStore } from '../store/conta'
import { useLinhasSacola, type LinhaSacola } from '../store/derivados'
import { useLocal } from '../store/local'
import { useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import type { Cupom } from '../store/conta'
import { contaAtual, useAgora, useCuponsDaConta } from './conta'
import { statusDo } from './cupom'
import { escolherCupomAutomatico, ordemAutomatica } from './cupom-automatico'
import { situacaoNoPedido, type Situacao } from './cupom-uso'
import { agoraLoja } from './relogio'

// Cupom aplicado no pedido (sacola e resumo do pedido guiado). Só a sacola, o chat e a Minha conta usam: fica fora do
// pedaço principal. Lê o cache da conta pelos mesmos caminhos dos hooks de src/lib/conta.ts.
// O cupom que vale entra sozinho (pedido do Ian em 22/10: "Quando fechar o pedido tem que ir com o cupom diretamente"):
// useCupomAutomatico, com a sacola aberta e no resumo do pedido guiado (a escolha mora em cupom-automatico.ts).

/** Cupom aplicado na sacola e a situação dele neste pedido; auto = entrou sozinho. */
export function useCupomNoPedido(): { cupom: Cupom | null; situacao: Situacao | null; auto: boolean } {
  const codigo = useSacola((s) => s.cupom)
  const auto = useSacola((s) => s.cupomAuto)
  const cupons = useCuponsDaConta()
  const { todas } = useLinhasSacola()
  const uf = useLocal((s) => s.uf)
  const agora = useAgora()
  return useMemo(() => {
    const cupom = codigo ? (cupons.find((c) => c.codigo === codigo) ?? null) : null
    return { cupom, situacao: cupom ? situacaoNoPedido(cupom, todas, uf, agora) : null, auto: !!cupom && auto }
  }, [codigo, auto, cupons, todas, uf, agora])
}

/** Os outros cupons ativos da conta que valem neste pedido agora (o "Trocar" da linha do cupom), na ordem do automático. */
export function useOutrosQueValem(): Cupom[] {
  const codigo = useSacola((s) => s.cupom)
  const cupons = useCuponsDaConta()
  const { todas } = useLinhasSacola()
  const uf = useLocal((s) => s.uf)
  const agora = useAgora()
  return useMemo(() => cupons.filter((c) => c.codigo !== codigo && situacaoNoPedido(c, todas, uf, agora).tipo === 'ok').sort(ordemAutomatica), [codigo, cupons, todas, uf, agora])
}

/**
 * Aplica sozinho o cupom que vale neste pedido (src/lib/cupom-automatico.ts), quando nenhum está aplicado ou quando o
 * que entrou sozinho deixou de valer e outro vale. O que o cliente escolheu fica; o que ele tirou não volta (a sacola
 * guarda); o pedido que já foi pro WhatsApp com esta mesma sacola (o "Já mandou?") não muda sozinho. Devolve o código
 * aplicado, ou null.
 */
export function aplicarCupomAutomatico(linhas: LinhaSacola[], uf: string | null, agora: number): string | null {
  const s = useSacola.getState()
  const atual = contaAtual(useContaStore.getState())
  if (!atual || !uf || !canalDa(uf)) return null
  const pedido = useChat.getState().pedido
  const doPedido = linhas.filter((l) => l.disponivel)
  if (!doPedido.length) return null
  if (pedido.enviada !== null && !codigoVencido(pedido) && pedido.sacola === chaveDaSacola(uf, doPedido)) return null
  const vale = (c: Cupom) => situacaoNoPedido(c, linhas, uf, agora).tipo === 'ok'
  if (s.cupom) {
    const aplicado = atual.cupons.find((c) => c.codigo === s.cupom)
    if (!s.cupomAuto || (aplicado && vale(aplicado))) return null
  }
  const escolhido = escolherCupomAutomatico(atual.cupons, vale, s.cupomRecusados)
  if (!escolhido || escolhido.codigo === s.cupom) return null
  s.aplicarCupom(escolhido.codigo, true)
  return escolhido.codigo
}

/**
 * Liga o cupom automático enquanto `ativo` (a sacola aberta, o resumo do pedido guiado): confere de novo quando a
 * sacola, a conta (cupom novo, o servidor relendo), o estado ou o relógio mudam — até a hora de fechar.
 */
export function useCupomAutomatico(ativo: boolean): void {
  const codigo = useSacola((s) => s.cupom)
  const auto = useSacola((s) => s.cupomAuto)
  const recusados = useSacola((s) => s.cupomRecusados)
  const cupons = useCuponsDaConta()
  const { todas } = useLinhasSacola()
  const uf = useLocal((s) => s.uf)
  const agora = useAgora()
  const enviada = useChat((s) => s.pedido.enviada)
  useEffect(() => {
    if (ativo) aplicarCupomAutomatico(todas, uf, agora)
  }, [ativo, codigo, auto, recusados, cupons, todas, uf, agora, enviada])
}

/** O cliente tirou o cupom (o "Tirar" da sacola, do pedido guiado e da Minha conta): não volta sozinho neste pedido. */
export function tirarCupomDoPedido(): void {
  const atual = contaAtual(useContaStore.getState())
  useSacola.getState().recusarCupom(atual?.cupons.map((c) => c.codigo) ?? [])
}

/**
 * O cupom aplicado ainda vale? Vencido, encerrado, usado ou fora da conta: sai da sacola com aviso.
 * Roda ao abrir a sacola, quando o pedido chega no resumo e quando a aba volta a ficar visível.
 */
export function conferirCupomAplicado(): void {
  const codigo = useSacola.getState().cupom
  if (!codigo) return
  const atual = contaAtual(useContaStore.getState())
  const c = atual?.cupons.find((x) => x.codigo === codigo)
  const status = c ? statusDo(c, agoraLoja()) : null
  if (status === 'ativo') return
  useSacola.getState().tirarCupom()
  useUI.getState().avisar(status === 'vencido' ? `Teu cupom ${codigo} venceu e saiu do pedido.` : `Teu cupom ${codigo} não vale mais e saiu do pedido.`)
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') conferirCupomAplicado()
  })
}

/** Liga a conferência do cupom aplicado enquanto `ativo` (sacola aberta, chat no resumo). */
export function useConferirCupom(ativo: boolean) {
  useEffect(() => {
    if (ativo) conferirCupomAplicado()
  }, [ativo])
}
