import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { FormaPagamento } from '../dados/canais'
import { armazenamentoSeguro } from '../lib/armazenamento'
import { codigoValido, novoCodigoPedido, tokenValido } from '../lib/codigo-pedido'

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

/**
 * O código do pedido que está sendo montado (vai na mensagem do WhatsApp) e o segredo dele. enviada = a mensagem que
 * já foi pro servidor com esse código: se o pedido mudar depois disso, nasce um código novo que substitui o de antes
 * (o servidor tira o velho da lista, se ainda for novo). Recomeçar, ou trocar de pedido pra encomenda, = código novo.
 */
export interface CodigoPedido {
  codigo: string
  token: string
  enviada: string | null
  substitui: { codigo: string; token: string } | null
}

const codigoNovo = (substitui: CodigoPedido['substitui'] = null): CodigoPedido => ({ ...novoCodigoPedido(), enviada: null, substitui })

function codigoLido(v: unknown): CodigoPedido {
  const c = v as Partial<CodigoPedido> | null
  if (!c || !codigoValido(c.codigo) || !tokenValido(c.token)) return codigoNovo()
  const sub = c.substitui && codigoValido(c.substitui.codigo) && tokenValido(c.substitui.token) ? { codigo: c.substitui.codigo, token: c.substitui.token } : null
  return { codigo: c.codigo, token: c.token, enviada: typeof c.enviada === 'string' ? c.enviada : null, substitui: sub }
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
  /** De onde veio o pedido do produto citado: o story ou a página do produto. */
  respondendoDe: 'story' | 'pagina'
  /** Quando a pessoa tocou em "Fechar pedido no WhatsApp" (para perguntar "Já mandou?" na volta). */
  enviadoEm: number | null
  marcarEnviado: (v: number | null) => void
  pedido: CodigoPedido
  /** A cópia com esse código foi pro servidor (no toque do WhatsApp). */
  marcarPedidoEnviado: (mensagem: string) => void
  /** O pedido mudou depois de ir pro servidor: código novo, que substitui o de antes. */
  trocarCodigo: () => void
  abrir: (modo: ModoChat, opts?: { produtoEncomenda?: string; respondendo?: string[]; de?: 'story' | 'pagina' }) => void
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
      respondendoDe: 'story',
      enviadoEm: null,
      marcarEnviado: (v) => set({ enviadoEm: v }),
      pedido: codigoNovo(),
      marcarPedidoEnviado: (mensagem) => set((s) => ({ pedido: { ...s.pedido, enviada: mensagem } })),
      trocarCodigo: () => set((s) => ({ pedido: codigoNovo({ codigo: s.pedido.codigo, token: s.pedido.token }) })),
      abrir: (modo, opts) => {
        const s = get()
        // Reabrir o mesmo modo continua de onde parou; trocar de modo recomeça o roteiro (as respostas ficam).
        if (s.modo !== modo || ((s.passo === 'resumo' || s.passo === 'enc-resumo') && !s.enviadoEm)) {
          set({ modo, feitos: [], passo: inicio(modo), enviadoEm: null })
        }
        // pedido virou encomenda (ou o contrário): é outro pedido, com outro código
        if (s.modo !== modo) set({ pedido: codigoNovo() })
        if (opts?.produtoEncomenda != null) set((st) => ({ respostas: { ...st.respostas, encProduto: opts.produtoEncomenda! } }))
        set({ aberto: true, respondendo: opts?.respondendo ?? [], respondendoDe: opts?.de ?? 'story' })
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
      recomecar: () => set((s) => ({ feitos: [], passo: inicio(s.modo), enviadoEm: null, pedido: codigoNovo() })),
    }),
    {
      name: 'gc-chat',
      storage: createJSONStorage(() => armazenamentoSeguro),
      partialize: (s) => ({ modo: s.modo, feitos: s.feitos, passo: s.passo, respostas: s.respostas, respondendo: s.respondendo, respondendoDe: s.respondendoDe, enviadoEm: s.enviadoEm, pedido: s.pedido }),
      // respostas novas (campos acrescentados depois) não quebram quem já tinha dados salvos
      merge: (salvo, atual) => {
        const s = (salvo ?? {}) as Partial<ChatState>
        return { ...atual, ...s, respostas: { ...respostasVazias, ...(s.respostas ?? {}) }, pedido: codigoLido(s.pedido) }
      },
    },
  ),
)
