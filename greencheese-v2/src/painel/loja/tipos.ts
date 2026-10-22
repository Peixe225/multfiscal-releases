// Tipos da loja no painel: o contrato do API.md (seção "Loja (painel)"). Dinheiro em reais, datas em ISO UTC.
import type { Raridade } from '../../lib/raridade'
import type { Arte, TipoArte } from '../../lib/tipos'

export type { Arte, Raridade, TipoArte }
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
  /** A rua do mercador no celular (Stories do Início): o 1º story na home, o fim do Início na Home 2. */
  ruaNoStory: boolean
  /** O mercador mostra produtos da loja na rua (Loja → "O mercador mostra produtos na rua"); sem o ajuste, ligada. */
  vitrineNaRua: boolean
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
  /** Bebida alcoólica (a marca): fora da rua do mercador e de prêmio. Sempre junto com bebida. */
  alcool: boolean
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
  /** Thumb animada (Estúdio do produto): o vídeo ('uploads/<nome>.mp4|webm') e a capa dele; os dois ou nenhum. */
  video: string | null
  capa: string | null
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

/** Um bairro da lista da taxa por bairro: o nome, a cidade (sem = qualquer cidade do estado) e a taxa (null = consultar). */
export interface BairroAdmin {
  nome: string
  cidade?: string
  taxa: number | null
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
  /**
   * A taxa por bairro (migração 107; servidor de antes não manda = uma taxa só): 'estado' (a taxaEntrega) ou 'bairro';
   * bairrosVer = como o cliente vê ('site': a lista aparece no site; 'consulta': ele pergunta na conversa); bairros =
   * a lista do dono (a taxa em reais, null = consultar; a cidade só quando o bairro é de uma cidade só do estado).
   */
  taxaPor?: 'estado' | 'bairro'
  bairrosVer?: 'site' | 'consulta'
  bairros?: BairroAdmin[]
  /** Pedido mínimo pra entrega, em reais (null = sem mínimo). Servidor de antes da migração 105 não manda (= sem). */
  pedidoMinimo?: number | null
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
  /** Peso dentro da raridade (1 a 1000; o padrão é 1). */
  peso: number
  validadeDias: number
  demo: boolean
  /** Comum, raro, épico ou lendário (src/lib/raridade.ts): a cor e a chance da raridade. */
  raridade: Raridade
  ativo: boolean
  ordem: number
  /** Vale no site agora (ligado, com o produto no ar e sem bebida). */
  noSite: boolean
  atualizadoEm: string
}

export interface RegrasSorte {
  ligado: boolean
  girosSemConta: number
  /** Com conta: girosPorIntervalo giros a cada intervaloDias dias (1 a 30), em dias de calendário de Brasília. */
  intervaloDias: number
  girosPorIntervalo: number
  /** O nome de antes (igual ao girosPorIntervalo): o servidor ainda manda e aceita. */
  girosPorDiaComConta: number
  reservaSemContaHoras: number
  /** A chance de cada raridade, em % (até 1 casa; somam 100; quanto mais raro, menor). */
  chances: Record<Raridade, number>
}

/** O que o admin-sorte-simular devolve (o sorteio de verdade, N vezes, sem gravar nada). */
export interface SimulacaoSorte {
  giros: number
  uf: string | null
  /** Estado fora do site ou sem prêmio que valha lá: o giro sorteia entre todos (como aqui). */
  todosOsEstados: boolean
  foraDoSite: boolean
  /** O jogo tá desligado: a simulação mostra como sairia com ele ligado. */
  desligado: boolean
  chances: Record<Raridade, number>
  /** esperado e saiuPct em %; saiu em vezes. */
  premios: { id: string; titulo: string; raridade: Raridade; peso: number; esperado: number; saiu: number; saiuPct: number }[]
  raridades: { raridade: Raridade; chance: number; premios: number; esperado: number; saiu: number; saiuPct: number }[]
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
  video?: string | null
  capa?: string | null
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
  /** Pedido mínimo pra entrega em reais; null (ou 0) = sem mínimo. */
  pedidoMinimo?: number | null
  /** A taxa por bairro (só vai o que mudou: o servidor mantém o que não veio). */
  taxaPor?: 'estado' | 'bairro'
  bairrosVer?: 'site' | 'consulta'
  bairros?: BairroAdmin[]
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
  raridade?: Raridade
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
