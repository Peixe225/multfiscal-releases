/**
 * Bônus de OVR na criação da carreira do Clássico (servidor/CONTRATO-v3.md §6): a ponte entre o src/site
 * (que sabe do bônus da conta) e a tela de identidade (que só mostra e pergunta). Fora do site `oferta` fica
 * null e a criação é a de sempre.
 *
 *   const oferta = useBonusCarreira((s) => s.oferta)       // { valor: 3, origem: 'indicação', depois: 1 } | null
 *   const n = await useBonusCarreira.getState().consumir?.('career-<semente>')   // valor aplicado (0 = sem)
 */
import { create } from 'zustand'

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
  /** Marca o bônus como usado nesta carreira no servidor e devolve o valor (lança se a rede falhar). */
  consumir: ((carreiraId: string) => Promise<number>) | null
}

export const useBonusCarreira = create<BonusCarreira>()(() => ({ oferta: null, usar: true, carregar: null, consumir: null }))
