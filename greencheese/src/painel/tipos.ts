// Tipos do painel: o contrato do API.md (seção "Painel do dono"). Dinheiro em reais, datas em ISO UTC.

export type StatusRateio = 'rascunho' | 'aberto' | 'fechado' | 'pedido' | 'caminho' | 'chegou' | 'encerrado' | 'cancelado'
export type StatusVaga = 'reservado' | 'confirmado' | 'expirado' | 'cancelado' | 'entregue'

export interface Usuario {
  login: string
  nome: string
  papel: 'dono'
}

export interface Sessao {
  instalado: boolean
  usuario: Usuario | null
  csrf: string | null
  versao: string
}

export interface RateioAdmin {
  id: string
  titulo: string
  descricao: string
  produtoId: string | null
  imagem: string | null
  precoRateio: number
  precoDepois: number | null
  vagas: number
  confirmadas: number
  reservadas: number
  disponiveis: number
  limitePorPessoa: number
  ufs: string[]
  status: StatusRateio
  aceitaEntradas: boolean
  previsaoMin: number
  previsaoMax: number
  fechaEm: string | null
  fechadoEm: string | null
  pedidoEm: string | null
  chegouEm: string | null
  reservaHoras: number
  demo: boolean
  atualizadoEm: string
  criadoEm: string
  abertoEm: string | null
  caminhoEm: string | null
  encerradoEm: string | null
  canceladoEm: string | null
  totais: {
    pessoasConfirmadas: number
    pessoasReservadas: number
    entregues: number
    expiradas: number
    canceladas: number
    participacoes: number
    arrecadado: number
    aReceber: number
  }
  proximos: StatusRateio[]
  podeApagar: boolean
  noSite: boolean
}

/** Corpo do admin-rateio-salvar (na edição, campo ausente fica como está). */
export interface RateioCorpo {
  id?: string
  titulo: string
  descricao?: string
  produtoId?: string | null
  imagem?: string | null
  precoRateio: number
  precoDepois?: number | null
  vagas: number
  limitePorPessoa?: number
  ufs: string[]
  previsaoMin?: number
  previsaoMax?: number
  fechaEm?: string | null
  reservaHoras?: number
  demo?: boolean
  status?: 'rascunho' | 'aberto'
}

export interface Participante {
  id: number
  codigo: string
  rateio: string
  nome: string
  whatsapp: string
  uf: string
  cidade: string
  quantidade: number
  precoUnit: number
  total: number
  status: StatusVaga
  origem: 'site' | 'painel'
  observacao: string
  criadoEm: string
  atualizadoEm: string
  expiraEm: string | null
  confirmadoEm: string | null
  confirmadoPor: string | null
  canceladoEm: string | null
  entregueEm: string | null
  expiradoEm: string | null
}

export interface ParticipanteCorpo {
  id?: number
  rateio?: string
  nome: string
  whatsapp: string
  uf: string
  cidade?: string
  quantidade?: number
  observacao?: string
  status?: 'reservado' | 'confirmado'
}

export type ParticipanteComTitulo = Participante & { rateioTitulo: string }

export interface Resumo {
  agora: string
  rateios: { rascunho: number; aberto: number; andamento: number; encerrado: number; cancelado: number }
  reservas: { pessoas: number; vagas: number; aReceber: number; vencendo: number }
  confirmado: { pessoas: number; vagas: number; valor: number }
  esperandoPagamento: ParticipanteComTitulo[]
  ultimasEntradas: ParticipanteComTitulo[]
}

export interface Diagnostico {
  versaoApi: string
  agora: string
  php: { versao: string; ok: boolean; sapi: string }
  extensoes: { pdo_sqlite: boolean; sqlite: string; gd: boolean; webp: boolean; exif: boolean; fileinfo: boolean; mbstring: boolean; openssl: boolean; curl: boolean }
  dados: { gravavel: boolean; bancoBytes: number; diario: string; versaoBanco: number }
  uploads: { existe: boolean; gravavel: boolean; arquivos: number; bytes: number }
  limites: { upload_max_filesize: string; post_max_size: string; memory_limit: string; max_execution_time: string; envioMaximo: number; envioMaximoTexto: string }
  https: boolean
  /**
   * IP que conta nos limites de tentativa e se tem CDN na frente. remoto: o REMOTE_ADDR (inteiro quando é da CDN,
   * mascarado quando é de gente); usado: o IP dos limites (mascarado); certo: os limites contam por pessoa;
   * cabecalhos: os de encaminhamento que chegaram (IPs mascarados); site24h: pedidos do site e IPs diferentes em 24 h.
   */
  rede: {
    remoto: string
    proxyNaFrente: boolean
    confiavel: boolean
    usado: string
    certo: boolean
    cabecalhos: { nome: string; ips: string[] }[]
    site24h: { pedidos: number; ips: number }
  }
  instalacao: { codigoDev: boolean }
  web: { testado: boolean; motivo: string; base: string; itens: { nome: string; status: number; ok: boolean | null }[] }
  avisos: string[]
}

export interface Evento {
  id: number
  em: string
  origem: 'painel' | 'site' | 'pix' | 'sistema'
  usuario: string | null
  acao: string
  alvo: string
  detalhe: Record<string, unknown>
  texto: string
}

export interface Envio {
  imagem: string
  largura: number
  altura: number
  bytes: number
  tipo: string
}
