export type TipoArte =
  | 'lata'
  | 'lata-alta'
  | 'garrafa-quadrada'
  | 'garrafa-gin'
  | 'garrafa-conhaque'
  | 'garrafa-licor'
  | 'seda'
  | 'piteira-vidro'
  | 'piteira-papel'
  | 'cuia'
  | 'dichavador'
  | 'isqueiro'
  | 'bandeja'

/** Desenho em pixel art do produto enquanto não há foto oficial. Cores em hex. */
export interface Arte {
  tipo: TipoArte
  /** Cor principal (vidro, lata, papel). */
  corpo: string
  /** Faixa/estampa secundária. */
  faixa?: string
  /** Rótulo (garrafas). */
  rotulo?: string
  /** Detalhe claro (letras, brilho do rótulo). */
  detalhe?: string
  /** Tampa/lacre (garrafas). */
  tampa?: string
}

export interface Combo {
  qtd: number
  total: number
}

export interface Variacao {
  id: string
  nome: string
  /** Preço próprio da variação (opcional). Sem ele vale o preço do produto. */
  preco?: number
}

export interface Produto {
  id: string
  nome: string
  /** Vai junto do nome na mensagem do pedido (ex.: "1 L", "lata"). */
  tamanho?: string
  detalhe?: string
  /** Descrição curta da página do produto (1 ou 2 frases, sem promessa de prazo, frete ou desconto). */
  descricao?: string
  categoria: string
  /** null = "Consultar" (preço desconhecido; nunca inventar). */
  preco: number | null
  combos?: Combo[]
  variacoes?: Variacao[]
  /** uf → à venda lá. Do servidor já vem resolvido (ligado no estado e, com estoque contado, pelo menos 1). */
  disponivel: Record<string, boolean>
  /** uf → unidades, só onde o estoque contado chegou no "restam X" do painel (o adesivo RESTAM 3). */
  restam?: Record<string, number>
  disponivelConfirmado?: string[]
  combinaCom?: string[]
  demo: boolean
  foto: string | null
  /** Cor de brilho (a cor dominante do produto). Com foto, é recalculada a partir dela. */
  cor: string
  arte: Arte
  obs?: string
}

export interface Categoria {
  id: string
  nome: string
  curto: string
  icone: string
  /** Bebida (com ou sem álcool): nunca entra em prêmio do Teste minha sorte. */
  bebida?: boolean
}
