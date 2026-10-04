import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { FormaPagamento } from '../dados/canais'
import { armazenamentoSeguro } from '../lib/armazenamento'

export type ModoChat = 'pedido' | 'encomenda'

export type Passo =
  // pedido
  | 'local'
  | 'cidade'
  | 'sacola'
  | 'nome'
  | 'endereco'
  | 'cep'
  | 'numero'
  | 'rua'
  | 'pagamento'
  | 'troco'
  | 'obs'
  | 'resumo'
  // encomenda
  | 'enc-produto'
  | 'enc-qtd'
  | 'enc-ref'
  | 'enc-nome'
  | 'enc-resumo'

export interface Respostas {
  nome: string
  cep: string
  rua: string
  bairro: string
  cidadeCep: string
  ufCep: string
  numero: string
  /** Endereço digitado à mão (sem CEP). */
  enderecoLivre: string
  pagamento: FormaPagamento | null
  troco: number | null
  obs: string
  encProduto: string
  encQtd: string
  encRef: string
  /** Canal escolhido para a encomenda quando o estado da pessoa não tem atendimento. */
  canalEnc: string
}

export const respostasVazias: Respostas = {
  nome: '',
  cep: '',
  rua: '',
  bairro: '',
  cidadeCep: '',
  ufCep: '',
  numero: '',
  enderecoLivre: '',
  pagamento: null,
  troco: null,
  obs: '',
  encProduto: '',
  encQtd: '',
  encRef: '',
  canalEnc: '',
}

interface ChatState {
  aberto: boolean
  modo: ModoChat
  /** Passos já respondidos, em ordem (o histórico da conversa é remontado a partir deles). */
  feitos: Passo[]
  passo: Passo
  respostas: Respostas
  /** Produtos do story respondido ("Você respondeu ao story"). */
  respondendo: string[]
  /** Quando a pessoa tocou em "Enviar no WhatsApp"/DM (para perguntar "Já mandou?" na volta). */
  enviadoEm: number | null
  marcarEnviado: (v: number | null) => void
  abrir: (modo: ModoChat, opts?: { produtoEncomenda?: string; respondendo?: string[] }) => void
  fechar: () => void
  responder: (passo: Passo, dados: Partial<Respostas>, proximo: Passo) => void
  avancar: (proximo: Passo) => void
  voltarPara: (passo: Passo) => void
  recomecar: () => void
}

// os dois roteiros começam confirmando o atendimento (estado/cidade)
const inicio = (_modo: ModoChat): Passo => 'local'

export const useChat = create<ChatState>()(
  persist(
    (set, get) => ({
      aberto: false,
      modo: 'pedido',
      feitos: [],
      passo: 'local',
      respostas: respostasVazias,
      respondendo: [],
      enviadoEm: null,
      marcarEnviado: (v) => set({ enviadoEm: v }),
      abrir: (modo, opts) => {
        const s = get()
        // Reabrir o mesmo modo continua de onde parou; trocar de modo recomeça o roteiro (as respostas ficam).
        if (s.modo !== modo || ((s.passo === 'resumo' || s.passo === 'enc-resumo') && !s.enviadoEm)) {
          set({ modo, feitos: [], passo: inicio(modo), enviadoEm: null })
        }
        if (opts?.produtoEncomenda != null) set((st) => ({ respostas: { ...st.respostas, encProduto: opts.produtoEncomenda! } }))
        set({ aberto: true, respondendo: opts?.respondendo ?? [] })
      },
      fechar: () => set({ aberto: false }),
      responder: (passo, dados, proximo) =>
        set((s) => ({
          respostas: { ...s.respostas, ...dados },
          feitos: [...s.feitos.filter((p) => p !== passo), passo],
          passo: proximo,
        })),
      avancar: (proximo) => set({ passo: proximo }),
      voltarPara: (passo) =>
        set((s) => {
          const i = s.feitos.indexOf(passo)
          return { feitos: i >= 0 ? s.feitos.slice(0, i) : s.feitos, passo, enviadoEm: null }
        }),
      recomecar: () => set((s) => ({ feitos: [], passo: inicio(s.modo), enviadoEm: null })),
    }),
    {
      name: 'gc-chat',
      storage: createJSONStorage(() => armazenamentoSeguro),
      partialize: (s) => ({ modo: s.modo, feitos: s.feitos, passo: s.passo, respostas: s.respostas, respondendo: s.respondendo, enviadoEm: s.enviadoEm }),
      // respostas novas (campos acrescentados depois) não quebram quem já tinha dados salvos
      merge: (salvo, atual) => {
        const s = (salvo ?? {}) as Partial<ChatState>
        return { ...atual, ...s, respostas: { ...respostasVazias, ...(s.respostas ?? {}) } }
      },
    },
  ),
)
