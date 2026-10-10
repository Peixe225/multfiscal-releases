// Tipos da loja no painel: o contrato do API.md (seção "Loja (painel)"). Dinheiro em reais, datas em ISO UTC.
import type { Arte, TipoArte } from '../../lib/tipos'

export type { Arte, TipoArte }
export type FormaPagamento = 'pix' | 'dinheiro' | 'cartao'
export type Turno = [string, string] | null
export type TipoPremio = 'desconto-percentual' | 'leve-x-pague-y' | 'brinde'

/** Disponível e estoque de um produto num estado. estoque null = não conta; 0 = esgotado (sai do site sozinho). */
export interface NoEstado {
  disponivel: boolean
  estoque: number | null
}

export interface Ajustes {
  /** WhatsApp da loja (o padrão): 55 + DDD + 9 dígitos. */
  whatsapp: string
  /** Todos os estados fecham no WhatsApp da loja (o próprio de cada estado fica guardado). */
  mesmoWhatsappParaTodos: boolean
  /** "Restam X" quando o estoque chega a esse número (null = nunca mostra). */
  restamAte: number | null
  /** A rua do mercador no fim do Início do celular (Stories do Início). O nome é de quando ela era o 1º story. */
  ruaNoStory: boolean
}

export interface Textos {
  bio: string[]
  fraseStory: string
  sacolaVazia: string
  falasMercado: string[]
}

export interface CategoriaAdmin {
  id: string
  nome: string
  curto: string
  icone: string
  bebida: boolean
  ordem: number
  /** Produtos nela (até os fora do site). */
  produtos: number
  /** Prêmios que valem nela (impedem apagar e virar bebida). */
  premios: { id: string; titulo: string }[]
}

export interface ProdutoAdmin {
  id: string
  nome: string
  tamanho: string
  detalhe: string
  descricao: string
  categoria: string
  preco: number | null
  combos: { qtd: number; total: number }[]
  variacoes: { id: string; nome: string; preco: number | null }[]
  combinaCom: string[]
  foto: string | null
  cor: string
  arte: Arte
  obs: string
  ativo: boolean
  demo: boolean
  ordem: number
  /** Só os estados que têm linha (sem linha = indisponível, sem contar). */
  estados: Partial<Record<string, NoEstado>>
  uso: { rateios: { id: string; titulo: string; demo: boolean }[]; premios: { id: string; titulo: string }[] }
  podeApagar: boolean
  criadoEm: string
  atualizadoEm: string
}

export interface EstadoAdmin {
  uf: string
  nome: string
  ativo: boolean
  destaque: string
  nomePerfil: string | null
  instagram: string
  /** O número próprio do estado (null = o da loja). Guardado mesmo com "o mesmo pra todos" ligado. */
  whatsapp: string | null
  cidades: { slug: string; nome: string }[]
  horario: { semana: Turno[]; demo: boolean }
  taxaEntrega: { valor: number | null; demo: boolean }
  entregaGratis: { dias: number[]; texto: string; demo: boolean } | null
  pagamento: { opcoes: FormaPagamento[]; demo: boolean }
  emblema: string
  ordem: number
  atualizadoEm: string
}

export type ValorPremio = number | { leve: number; pague: number } | { produto: string; qtd: number }

export interface PremioAdmin {
  id: string
  tipo: TipoPremio
  valor: ValorPremio
  titulo: string
  descricao: string
  regra: string
  aplicaA: { produtos?: string[]; categorias?: string[] }
  comoUsar?: string
  peso: number
  validadeDias: number
  demo: boolean
  ativo: boolean
  ordem: number
  /** Vale no site agora (ligado, com o produto no ar e sem bebida). */
  noSite: boolean
  atualizadoEm: string
}

export interface RegrasSorte {
  ligado: boolean
  girosSemConta: number
  girosPorDiaComConta: number
  reservaSemContaHoras: number
}

export interface LojaAdmin {
  versao: number
  atualizadoEm: string
  ajustes: Ajustes
  textos: Textos
  categorias: CategoriaAdmin[]
  produtos: ProdutoAdmin[]
  estados: EstadoAdmin[]
  /** A lista escolhida de cada estado, crua (sem filtrar o que está à venda). Sem chave = automático. */
  stories: Partial<Record<string, string[]>>
  sorte: RegrasSorte & { premios: PremioAdmin[] }
}

/** O que muda em toda escrita: a versão da loja (o site vê na hora). */
export interface Carimbo {
  versao: number
  atualizadoEm: string
}

/** Corpo do admin-produto-salvar (na edição, campo ausente fica como está). */
export interface ProdutoCorpo {
  id?: string
  nome?: string
  tamanho?: string
  detalhe?: string
  descricao?: string
  categoria?: string
  preco?: number | null
  combos?: { qtd: number; total: number }[]
  variacoes?: { id?: string; nome: string; preco?: number | null }[]
  combinaCom?: string[]
  foto?: string | null
  cor?: string
  arte?: Arte
  obs?: string
  ativo?: boolean
  demo?: boolean
  estados?: Record<string, NoEstado>
}

export interface EstadoCorpo {
  uf: string
  ativo?: boolean
  destaque?: string
  nomePerfil?: string | null
  instagram?: string
  whatsapp?: string | null
  cidades?: { nome: string }[]
  horario?: Turno[]
  horarioDemo?: boolean
  taxa?: number | null
  taxaDemo?: boolean
  entregaGratis?: { dias: number[]; texto: string } | null
  entregaGratisDemo?: boolean
  pagamentos?: FormaPagamento[]
  pagamentosDemo?: boolean
}

export interface PremioCorpo {
  id?: string
  tipo?: TipoPremio
  valor?: ValorPremio
  titulo?: string
  descricao?: string
  regra?: string
  aplicaA?: { produtos?: string[]; categorias?: string[] }
  comoUsar?: string
  peso?: number
  validadeDias?: number
  ativo?: boolean
  demo?: boolean
}

export interface PlanoExemplos {
  premios: { id: string; titulo: string }[]
  rateios: { id: string; titulo: string; pessoas: number }[]
  /** Rateio de exemplo em que alguém já pagou: fica, como rateio de verdade. */
  manter: { id: string; titulo: string; pessoas: number; pagas: number }[]
  produtos: { id: string; nome: string }[]
  desativar: { id: string; nome: string }[]
}
