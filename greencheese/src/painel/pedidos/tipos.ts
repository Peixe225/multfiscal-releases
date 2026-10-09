// Tipos dos pedidos, dos avisos no WhatsApp e das falas do pedido guiado no painel (API.md, "Pedidos (painel)").
// Dinheiro em reais, datas em ISO UTC.

export type StatusPedido = 'novo' | 'confirmado' | 'saiu' | 'entregue' | 'cancelado'
export type FiltroPedidos = StatusPedido | 'abertos' | 'todos'

export interface PedidoLigado {
  id: number
  codigo: string
}

/** Linha da lista. */
export interface PedidoLinha {
  id: number
  codigo: string
  tipo: 'pedido' | 'encomenda'
  status: StatusPedido
  uf: string
  cidade: string
  nome: string
  /** '' quando o site não sabia (a loja vê na conversa e pode pôr aqui). */
  whatsapp: string
  /** "1x Jack Daniel's Old No. 7 1 L, 3x Seda OCB…" ou "Encomenda: …". */
  resumo: string
  unidades: number
  subtotal: number | null
  subtotalTexto: string
  criadoEm: string
  atualizadoEm: string
  substitui: PedidoLigado | null
  substituidoPor: PedidoLigado | null
  /** Pedido de exclusão (LGPD) feito: nome, WhatsApp, endereço e mensagem saíram. */
  dadosApagados: boolean
}

export interface ItemDoPedido {
  produtoId: string | null
  nome: string
  variacao: string | null
  qtd: number
  precoUnit: number | null
  total: number | null
  combo: string | null
}

/** O pedido inteiro (detalhe). */
export interface PedidoAdmin extends PedidoLinha {
  itens: ItemDoPedido[]
  cupom: { codigo: string; regra: string; origem: string } | null
  entrega: { endereco: string; rua: string; numero: string; bairro: string; cep: string; cidade: string; uf: string }
  pagamento: 'pix' | 'dinheiro' | 'cartao' | null
  troco: number | null
  observacao: string
  encomenda: { produto: string; quantidade: string; referencia: string } | null
  /** A mensagem exata que foi pro WhatsApp ('' depois de apagar os dados). */
  mensagem: string
  nota: string
  confirmadoEm: string | null
  saiuEm: string | null
  entregueEm: string | null
  canceladoEm: string | null
  statusPor: string | null
  /** Pra onde dá pra ir agora (os botões). */
  proximos: StatusPedido[]
}

export interface ListaPedidos {
  agora: string
  pedidos: PedidoLinha[]
  contagem: Record<FiltroPedidos, number>
  ufs: string[]
  mais: boolean
}

export type Motor = 'nenhum' | 'zapi' | 'evolution' | 'webhook'
export type EventoAviso = 'pedido' | 'encomenda' | 'rateio-reserva' | 'rateio-pago'

export interface SituacaoAvisos {
  motor: Motor
  ligado: boolean
  /** Avisos que falharam nos últimos 7 dias. */
  falhas: number
  naFila: number
  ultimoEnviado: string | null
}

export interface ResumoPedidos {
  agora: string
  novos: number
  emAndamento: number
  ultimos: PedidoLinha[]
  avisos: SituacaoAvisos
}

export interface TentativaAviso {
  em: string
  ok: boolean
  motor: string
  http: number
  ms: number
  erro: string
  por: string
}

export interface EnvioAviso {
  id: number
  tipo: string
  /** 'pedido:12', 'participacao:RAT-K8EA', 'avisos'… */
  alvo: string
  /** null = o destino do painel (o grupo). */
  para: { tipo: 'grupo' | 'numero'; valor: string } | null
  /** false = o texto guardado não é a mensagem que saiu (código de login): não reenvia. */
  reenvia: boolean
  texto: string
  status: 'pendente' | 'enviando' | 'enviado' | 'falhou'
  motor: string
  tentativas: number
  erro: string
  criadoEm: string
  atualizadoEm: string
  enviadoEm: string | null
  tentarEm: string | null
  ultimas: TentativaAviso[]
}

/** Os ajustes como o painel vê: dos segredos, só o final (null = não tem; '' = tem, curto demais pra mostrar o final). */
export interface ConfigAvisos {
  motor: Motor
  destino: { tipo: 'grupo' | 'numero'; valor: string }
  zapi: { instancia: string; token: string | null; clientToken: string | null }
  evolution: { url: string; instancia: string; apikey: string | null }
  webhook: { url: string; temUrl: boolean; segredo: string | null }
  eventos: Record<EventoAviso, boolean>
  atualizadoEm: string | null
}

export interface DadosAvisos {
  agora: string
  config: ConfigAvisos
  situacao: SituacaoAvisos
  envios: EnvioAviso[]
}

/** Corpo do admin-avisos-salvar: campo ausente fica como está; segredo '' fica o de antes; null apaga. */
export interface CorpoAvisos {
  motor: Motor
  destino?: { tipo: 'grupo' | 'numero'; valor: string }
  zapi?: { instancia?: string; token?: string | null; clientToken?: string | null }
  evolution?: { url?: string; instancia?: string; apikey?: string | null }
  webhook?: { url?: string | null; segredo?: string | null }
  eventos?: Partial<Record<EventoAviso, boolean>>
}

export interface TrocaFala {
  texto: string
  atualizadoEm: string
  por: string
}
