import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { canalDa, type FormaPagamento } from '../dados/canais'
import { armazenamentoSeguro } from '../lib/armazenamento'
import { codigoValido, novoCodigoPedido, tokenValido } from '../lib/codigo-pedido'
import { useLocal } from './local'

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
 * já foi pro servidor com esse código (enviadaEm = quando): se o pedido mudar depois disso, nasce um código novo. Até
 * JANELA_TROCA_MS depois do envio, o novo substitui o de antes (o servidor tira o velho da lista, se ainda for novo);
 * depois disso é outro pedido (a pessoa voltou outro dia sem tocar em "Mandei"). Recomeçar, ou trocar de pedido pra
 * encomenda, = código novo.
 */
export interface CodigoPedido {
  codigo: string
  token: string
  enviada: string | null
  enviadaEm: number | null
  substitui: { codigo: string; token: string } | null
  /**
   * Quem mandou a `enviada`: a sacola (o "Fechar pedido no WhatsApp" direto) ou o pedido guiado. Os dois dividem o
   * código: o guiado que fecha depois da sacola (ou o contrário) entra no lugar do de antes, como o pedido mudado.
   */
  enviadaPor: 'sacola' | 'guiado' | null
  /**
   * A sacola de quando a `enviada` foi (chaveDaSacola: o estado, os itens e as quantidades). A sacola reconhece por ela o
   * pedido guiado que já foi com estes mesmos itens: mandar de novo a mesma sacola não é "o pedido mudado".
   */
  sacola: string | null
  /**
   * O cupom que foi na `enviada` (o código; null = foi sem cupom). O cupom é parte do pedido como os itens: a sacola só
   * reconhece o pedido guiado que já foi quando o cupom de agora é o mesmo (trocar ou tirar o cupom depois é pedido
   * novo, que entra no lugar do de antes), e o "Já mandei" marca como usado o que foi na mensagem. undefined = guardado
   * por uma versão de antes, que não anotava (vale o cupom de agora, como antes).
   */
  cupom?: string | null
}

/** Até quanto tempo depois de mandar uma mudança ainda é "o mesmo pedido, mudado" (o servidor confere o mesmo). */
export const JANELA_TROCA_MS = 2 * 3600_000

const codigoNovo = (substitui: CodigoPedido['substitui'] = null): CodigoPedido => ({ ...novoCodigoPedido(), enviada: null, enviadaEm: null, substitui, enviadaPor: null, sacola: null, cupom: null })

/**
 * O código já foi pro servidor há mais que a JANELA_TROCA_MS (ou sem a hora): o pedido de antes já é outro. A pessoa
 * voltou outro dia sem tocar em "Já mandei" e pede de novo, mesmo igual: é um pedido novo, com código novo (o mesmo
 * código com o mesmo token o servidor reconhece como repetido e não grava, nem avisa o grupo).
 */
export function codigoVencido(p: CodigoPedido, agora = Date.now()): boolean {
  return p.enviada !== null && (p.enviadaEm === null || agora - p.enviadaEm >= JANELA_TROCA_MS)
}

/** "mg|seda-ocb-premium-slim:-:4|…": o estado e cada item com a opção e a quantidade, em ordem (o mesmo pedido, a mesma chave). */
export function chaveDaSacola(uf: string, linhas: readonly { produto: { id: string }; variacaoId?: string | null; qtd: number }[]): string {
  const itens = linhas
    .filter((l) => l.qtd > 0)
    .map((l) => `${l.produto.id}:${l.variacaoId ?? '-'}:${l.qtd}`)
    .sort()
  return [uf.toLowerCase(), ...itens].join('|')
}

/** O de antes, se foi mandado há pouco (dentro da JANELA_TROCA_MS): o pedido novo entra no lugar dele. */
export function substituiDe(p: CodigoPedido): CodigoPedido['substitui'] {
  return p.enviadaEm !== null && Date.now() - p.enviadaEm < JANELA_TROCA_MS ? { codigo: p.codigo, token: p.token } : null
}

function codigoLido(v: unknown): CodigoPedido {
  const c = v as Partial<CodigoPedido> | null
  if (!c || !codigoValido(c.codigo) || !tokenValido(c.token)) return codigoNovo()
  const sub = c.substitui && codigoValido(c.substitui.codigo) && tokenValido(c.substitui.token) ? { codigo: c.substitui.codigo, token: c.substitui.token } : null
  const enviada = typeof c.enviada === 'string' ? c.enviada : null
  const enviadaEm = enviada !== null && typeof c.enviadaEm === 'number' && Number.isFinite(c.enviadaEm) ? c.enviadaEm : null
  const enviadaPor = enviada !== null && (c.enviadaPor === 'sacola' || c.enviadaPor === 'guiado') ? c.enviadaPor : enviada !== null ? 'guiado' : null
  const sacola = enviada !== null && typeof c.sacola === 'string' && c.sacola.length <= 4000 ? c.sacola : null
  // o cupom que foi: sem a chave (guardado por uma versão de antes), undefined
  const cupom = enviada === null ? null : typeof c.cupom === 'string' && c.cupom.length <= 64 ? c.cupom : c.cupom === null ? null : undefined
  return { codigo: c.codigo, token: c.token, enviada, enviadaEm, substitui: sub, enviadaPor, sacola, ...(cupom === undefined ? {} : { cupom }) }
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
  /**
   * O estado do site quando a pessoa confirmou o atendimento (o passo "local"). Se o site trocar de estado depois, o
   * pedido volta pro "local" (conferirEstado): endereço, taxa e pagamento são de outro atendimento.
   */
  ufLocal: string | null
  /** O site trocou de estado com o pedido pela metade: recomeça pelo atendimento e tira o que era do estado de antes. */
  conferirEstado: () => void
  pedido: CodigoPedido
  /**
   * A cópia com esse código foi pro servidor (no toque do WhatsApp). por: quem mandou (padrão: o pedido guiado);
   * sacola: a chave da sacola que foi (chaveDaSacola); cupom: o código do cupom que foi na mensagem (null = sem).
   */
  marcarPedidoEnviado: (mensagem: string, por?: 'sacola' | 'guiado', sacola?: string | null, cupom?: string | null) => void
  /**
   * A sacola mandou com um código que ela sorteou na hora (o de agora já tinha ido com outra mensagem, ou venceu): ele
   * vira o código do pedido, já enviado, no lugar do de antes (substitui, dentro das 2 h). O "Já mandou?" do guiado sai
   * junto.
   */
  usarCodigoDaSacola: (novo: { codigo: string; token: string }, mensagem: string, sacola: string, cupom: string | null) => void
  /**
   * O pedido mudou depois de ir pro servidor: código novo, que substitui o de antes. O "Já mandou?" sai junto: a
   * mensagem nova ainda não foi pro WhatsApp (o resumo volta a pedir pra fechar lá).
   */
  trocarCodigo: () => void
  /**
   * O código venceu (codigoVencido): o próximo envio é outro pedido, com código novo e sem substituir o de antes. O
   * "Já mandou?" do resumo fica (ele pergunta do de antes); o link do WhatsApp já sai com o novo.
   */
  renovarCodigo: () => void
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
      ufLocal: null,
      conferirEstado: () => {
        const s = get()
        const uf = useLocal.getState().uf
        // sem atendimento confirmado (antes do campo existir: o estado do CEP), nada a conferir
        const confirmado = s.ufLocal ?? (s.feitos.length ? s.respostas.ufCep || null : null)
        if (!confirmado || confirmado === uf || (!s.feitos.length && s.passo === 'local')) return
        const r = { ...s.respostas }
        // o CEP de outro estado não serve mais (o endereço digitado sem CEP fica como sugestão, a pessoa escolhe de novo)
        if (r.ufCep && r.ufCep !== uf) Object.assign(r, { cep: '', rua: '', bairro: '', cidadeCep: '', ufCep: '', numero: '' })
        // pagamento que o estado novo não aceita sai (o passo do pagamento pergunta de novo)
        const opcoes = canalDa(uf)?.pagamento.opcoes
        if (r.pagamento && opcoes && !opcoes.includes(r.pagamento)) Object.assign(r, { pagamento: null, troco: null })
        set({ feitos: [], passo: inicio(s.modo), enviadoEm: null, ufLocal: null, respostas: r })
      },
      pedido: codigoNovo(),
      marcarPedidoEnviado: (mensagem, por = 'guiado', sacola = null, cupom = null) =>
        set((s) => ({ pedido: { ...s.pedido, enviada: mensagem, enviadaEm: Date.now(), enviadaPor: por, sacola, cupom } })),
      usarCodigoDaSacola: (novo, mensagem, sacola, cupom) =>
        set((s) => ({
          pedido: { codigo: novo.codigo, token: novo.token, enviada: mensagem, enviadaEm: Date.now(), substitui: substituiDe(s.pedido), enviadaPor: 'sacola', sacola, cupom },
          enviadoEm: null,
        })),
      trocarCodigo: () => set((s) => ({ pedido: codigoNovo(substituiDe(s.pedido)), enviadoEm: null })),
      renovarCodigo: () => set((s) => ({ pedido: codigoNovo(substituiDe(s.pedido)) })),
      abrir: (modo, opts) => {
        // trocou de estado desde que confirmou o atendimento: recomeça por ele
        get().conferirEstado()
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
          // o atendimento confirmado é o do estado do site agora
          ...(passo === 'local' ? { ufLocal: useLocal.getState().uf } : {}),
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
      partialize: (s) => ({ modo: s.modo, feitos: s.feitos, passo: s.passo, respostas: s.respostas, respondendo: s.respondendo, respondendoDe: s.respondendoDe, enviadoEm: s.enviadoEm, ufLocal: s.ufLocal, pedido: s.pedido }),
      // respostas novas (campos acrescentados depois) não quebram quem já tinha dados salvos
      merge: (salvo, atual) => {
        const s = (salvo ?? {}) as Partial<ChatState>
        return { ...atual, ...s, respostas: { ...respostasVazias, ...(s.respostas ?? {}) }, ufLocal: typeof s.ufLocal === 'string' ? s.ufLocal : null, pedido: codigoLido(s.pedido) }
      },
    },
  ),
)

// o site trocou de estado (seletor, Por estado, CEP de outro estado) com o pedido pela metade: volta pro atendimento
useLocal.subscribe((s, antes) => {
  if (s.uf !== antes.uf) useChat.getState().conferirEstado()
})
