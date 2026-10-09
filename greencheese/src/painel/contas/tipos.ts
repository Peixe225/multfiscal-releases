// Tipos das telas de Equipe e Clientes: o contrato do API.md ("Equipe" e "Contas dos clientes").
import type { PedidoLinha } from '../pedidos/tipos'
import type { Papel, ParticipanteComTitulo } from '../tipos'

export interface UsuarioAdmin {
  login: string
  nome: string
  papel: Papel
  ufs: string[]
  ativo: boolean
  trocarSenha: boolean
  criadoEm: string
  criadoPor: string
  acessoEm: string | null
  senhaEm: string
  desativadoEm: string | null
  /** Aparelhos com o painel aberto agora. */
  sessoes: number
  /** É quem está logado. */
  eu: boolean
}

export interface CorpoUsuario {
  novo?: boolean
  login: string
  nome: string
  papel: Papel
  ufs: string[]
}

export interface SituacaoCodigo {
  /** Os clientes entram com o código agora. */
  ligado: boolean
  /** Tem motor de aviso (Avisos no WhatsApp). */
  motor: boolean
  /** O dono desligou aqui. */
  desligadoPeloDono: boolean
  /**
   * O teto de códigos da loja inteira (por hora e por dia), quantos saíram e, batido o teto, até quando o entrar com
   * código fica pausado (a conta de cada cliente fica no aparelho até liberar). Servidor de antes: não manda.
   */
  teto?: { hora: number; dia: number; usadosHora: number; usadosDia: number; pausadoAte: string | null }
}

export interface ClienteLinha {
  id: number
  nome: string
  whatsapp: string
  aceitaPromo: boolean
  aceitaPromoEm: string | null
  uf: string
  origem: 'site' | 'aparelho'
  criadoEm: string
  acessoEm: string | null
  pedidos: number
  cuponsAtivos: number
}

export interface ListaClientes {
  agora: string
  clientes: ClienteLinha[]
  mais: boolean
  total: number
  comPromo: number
  codigo: SituacaoCodigo
}

export interface EnderecoCliente {
  id: number
  apelido: string
  cep: string
  rua: string
  numero: string
  bairro: string
  cidade: string
  uf: string
  livre: string
  usadoEm: string
}

export interface CupomCliente {
  codigo: string
  interativo: string
  premioId: string
  retrato: { titulo: string; regra: string; tipo: string }
  demo: boolean
  origem: 'giro' | 'aparelho'
  ganhoEm: string
  validoAte: string
  usadoEm: string | null
}

export interface DetalheCliente {
  agora: string
  cliente: ClienteLinha & { confirmou18Em: string }
  enderecos: EnderecoCliente[]
  cupons: CupomCliente[]
  pedidos: PedidoLinha[]
  vagas: ParticipanteComTitulo[]
  giros: number
}
