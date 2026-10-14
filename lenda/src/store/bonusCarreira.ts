/**
 * Bônus de OVR na criação da carreira do Clássico (servidor/CONTRATO-v3.md §6): a ponte entre o src/site
 * (que sabe do bônus da conta) e a tela de identidade (que só mostra e pergunta). Fora do site `oferta` fica
 * null e a criação é a de sempre.
 *
 *   const oferta = useBonusCarreira((s) => s.oferta)       // { valor: 3, origem: 'indicação', depois: 1 } | null
 *   const n = await useBonusCarreira.getState().consumir?.('career-<semente>')   // valor aplicado (0 = sem)
 */
import { create } from 'zustand'

/**
 * Por que o bônus não foi confirmado: 'rede' = sem resposta (o servidor pode ter marcado como usado; tentar de novo
 * com a MESMA carreira devolve o mesmo valor), 'sessao' = a conta caiu (nada foi gasto; o aviso já saiu), 'outro' =
 * recusado antes de usar (nada foi gasto).
 */
export class FalhaBonus extends Error {
  readonly tipo: 'rede' | 'sessao' | 'outro'
  constructor(tipo: 'rede' | 'sessao' | 'outro', mensagem = '') {
    super(mensagem)
    this.name = 'FalhaBonus'
    this.tipo = tipo
  }
}

export interface OfertaBonus {
  /** Pontos de OVR do próximo bônus (o mais antigo disponível). */
  valor: number
  /** "indicação", "compartilhou o card"… */
  origem: string
  /** Quantos bônus ainda ficam guardados depois deste. */
  depois: number
}

interface BonusCarreira {
  oferta: OfertaBonus | null
  /** Usar nesta carreira (padrão: sim). */
  usar: boolean
  carregar: (() => void) | null
  /** Marca o bônus como usado nesta carreira no servidor e devolve o valor (lança FalhaBonus se não deu). */
  consumir: ((carreiraId: string) => Promise<number>) | null
}

export const useBonusCarreira = create<BonusCarreira>()(() => ({ oferta: null, usar: true, carregar: null, consumir: null }))
