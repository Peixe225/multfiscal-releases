import { useEffect, useMemo } from 'react'
import { useContaStore } from '../store/conta'
import { useLinhasSacola } from '../store/derivados'
import { useLocal } from '../store/local'
import { useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import type { Cupom } from '../store/conta'
import { contaAtual, useAgora, useCuponsDaConta } from './conta'
import { statusDo } from './cupom'
import { situacaoNoPedido, type Situacao } from './cupom-uso'

// Cupom aplicado no pedido (sacola e resumo do pedido guiado). Só a sacola, o chat e a Minha conta usam: fica fora do
// pedaço principal. Lê o cache da conta pelos mesmos caminhos dos hooks de src/lib/conta.ts.

/** Cupom aplicado na sacola e a situação dele neste pedido. */
export function useCupomNoPedido(): { cupom: Cupom | null; situacao: Situacao | null } {
  const codigo = useSacola((s) => s.cupom)
  const cupons = useCuponsDaConta()
  const { todas } = useLinhasSacola()
  const uf = useLocal((s) => s.uf)
  const agora = useAgora()
  return useMemo(() => {
    const cupom = codigo ? (cupons.find((c) => c.codigo === codigo) ?? null) : null
    return { cupom, situacao: cupom ? situacaoNoPedido(cupom, todas, uf, agora) : null }
  }, [codigo, cupons, todas, uf, agora])
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
  const status = c ? statusDo(c, Date.now()) : null
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
