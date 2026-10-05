import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Premio, ValorPremio } from '../dados/sorte'
import { armazenamentoSeguro } from '../lib/armazenamento'

// Cache da conta do cliente e dos cupons dos interativos neste aparelho (localStorage 'gc-conta').
// Só o adaptador (src/lib/conta-adaptador.ts) escreve aqui; as telas leem pelos hooks de src/lib/conta.ts.
// Na prévia este cache é a própria fonte (nada vai pra servidor). Na versão oficial, o adaptador do servidor grava
// aqui o que a API devolve a cada chamada (conta, cupons, dias de giro, prêmio reservado) e as telas não mudam.

export interface Conta {
  /** crypto.randomUUID (com reserva). */
  id: string
  nome: string
  /** '55' + DDD + 9 dígitos. É a chave da conta neste aparelho. */
  whatsapp: string
  aceitaPromo: boolean
  /** Quando ligou as promoções (opt-in separado e datado, LGPD). */
  aceitaPromoEm: number | null
  /** Quando criou a conta confirmando ter 18 anos ou mais. */
  confirmou18Em: number
  criadaEm: number
}

/** O texto do prêmio congelado no dia em que a pessoa ganhou: é ele que vale, mesmo que src/dados/sorte.ts mude. */
export type RetratoPremio = Pick<Premio, 'titulo' | 'regra' | 'aplicaA' | 'comoUsar'> & { papel: 'branco' | 'natural' } & ValorPremio

export interface Cupom {
  codigo: string
  /** id do interativo de onde veio (ex.: 'sorte'). */
  interativo: string
  premioId: string
  retrato: RetratoPremio
  demo: boolean
  ganhoEm: number
  validoAte: number
  usadoEm?: number
}

/** Prêmio de quem girou sem conta: reservado neste aparelho por 24 h, ainda sem código. */
export interface Pendente {
  interativo: string
  premioId: string
  sorteadoEm: number
  /** sorteadoEm + 24 h (horário fixo, sem cronômetro correndo na tela). */
  expiraEm: number
}

export interface EstadoConta {
  contas: Record<string, { conta: Conta; cupons: Cupom[] }>
  /** WhatsApp da conta aberta neste aparelho (null = sem conta). */
  atual: string | null
  /** Dias de Brasília ('AAAA-MM-DD') em que este APARELHO girou cada interativo (no máx. 30). Sobrevive a sair/apagar. */
  giros: Record<string, string[]>
  /** Do aparelho: sobrevive a sair/apagar. */
  pendente: Pendente | null
  /** Interativos já abertos neste aparelho (selo "novo"). */
  vistos: string[]
}

export const estadoContaVazio: EstadoConta = { contas: {}, atual: null, giros: {}, pendente: null, vistos: [] }

export const useContaStore = create<EstadoConta>()(
  persist(() => ({ ...estadoContaVazio }), {
    name: 'gc-conta',
    version: 1,
    storage: createJSONStorage(() => armazenamentoSeguro),
    // campos novos não quebram quem já tinha dados guardados
    merge: (salvo, atual) => ({ ...atual, ...((salvo ?? {}) as Partial<EstadoConta>) }),
  }),
)
