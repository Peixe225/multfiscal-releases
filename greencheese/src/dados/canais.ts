// Canais de atendimento por estado. É aqui que se troca WhatsApp, cidades, horário, taxa e pagamento.
//
// REGRAS
// - whatsapp: só número real, com DDI 55 + DDD + número, sem espaço (ex.: '5533999998888'). null = PENDENTE.
//   Nunca invente número: com null o site manda a pessoa escolher o contato no WhatsApp ou abre a DM do Instagram.
// - demo: true = valor de demonstração (PENDENTE). Na prévia ele aparece com a marca "demo";
//   com config.modoPrevia = false, horário e taxa demo viram "a confirmar".

export type UfAtendida = 'rj' | 'mg' | 'sp' | 'es' | 'sc'
export type FormaPagamento = 'pix' | 'dinheiro' | 'cartao'
export type Emblema = 'pao-de-acucar' | 'pedra-preciosa' | 'predio-sp' | 'convento-es' | 'ponte-sc'

export interface Cidade {
  slug: string
  nome: string
}

/** [abre, fecha] no formato 'HH:MM'. Fecha depois da meia-noite = madrugada do dia seguinte (ex.: ['18:00', '02:00']). null = fechado. */
export type Turno = [string, string] | null

export interface Canal {
  uf: UfAtendida
  /** Nome do estado. */
  nome: string
  /** Nome do destaque no Instagram (ex.: "DELIVERY RJ"). */
  destaque: string
  /** Nome que aparece no perfil do Instagram. null = só o @ (não visto nos prints). */
  nomePerfil: string | null
  /** Cidades atendidas. Vazio = cidade PENDENTE (o pedido pergunta a cidade). */
  cidades: Cidade[]
  instagram: string
  whatsapp: string | null
  /** Domingo = 0 ... sábado = 6. */
  horario: { semana: [Turno, Turno, Turno, Turno, Turno, Turno, Turno]; demo: boolean }
  taxaEntrega: { valor: number | null; texto?: string; demo: boolean }
  /** Promoção real vista no Instagram (dia da semana: domingo = 0). */
  entregaGratis: { diaSemana: number; texto: string; demo: boolean } | null
  pagamento: { opcoes: FormaPagamento[]; demo: boolean }
  emblema: Emblema
}

// Horário de demonstração (PENDENTE): madrugada de fim de semana, como o clima dos stories.
const horarioDemo: Canal['horario'] = {
  semana: [
    ['15:00', '23:00'], // dom
    ['14:00', '00:00'], // seg
    ['14:00', '00:00'], // ter
    ['14:00', '00:00'], // qua
    ['14:00', '00:00'], // qui
    ['14:00', '03:00'], // sex
    ['14:00', '03:00'], // sáb
  ],
  demo: true,
}

const pagamentoDemo: Canal['pagamento'] = { opcoes: ['pix', 'dinheiro', 'cartao'], demo: true }

export const canais: Canal[] = [
  {
    uf: 'rj',
    nomePerfil: 'GREEN CHEESE LTDA',
    nome: 'Rio de Janeiro',
    destaque: 'DELIVERY RJ',
    cidades: [{ slug: 'rio-de-janeiro', nome: 'Rio de Janeiro' }],
    instagram: 'greencheese_importsrj',
    whatsapp: null, // PENDENTE
    horario: horarioDemo,
    taxaEntrega: { valor: 10, demo: true },
    entregaGratis: null,
    pagamento: pagamentoDemo,
    emblema: 'pao-de-acucar',
  },
  {
    uf: 'mg',
    nomePerfil: 'GREEN CHEESE LTDA',
    nome: 'Minas Gerais',
    destaque: 'TEÓFILO OTONI',
    cidades: [{ slug: 'teofilo-otoni', nome: 'Teófilo Otoni' }],
    instagram: 'greencheese_importsmg',
    whatsapp: null, // PENDENTE
    horario: horarioDemo,
    taxaEntrega: { valor: 8, demo: true },
    // Dado real dos stories de MG.
    entregaGratis: { diaSemana: 5, texto: 'Sextou com entrega grátis!', demo: false },
    pagamento: pagamentoDemo,
    emblema: 'pedra-preciosa',
  },
  {
    uf: 'sp',
    nomePerfil: null,
    nome: 'São Paulo',
    destaque: 'DELIVERY SP',
    cidades: [], // PENDENTE
    instagram: 'greencheese_importssp',
    whatsapp: null, // PENDENTE
    horario: horarioDemo,
    taxaEntrega: { valor: 12, demo: true },
    entregaGratis: null,
    pagamento: pagamentoDemo,
    emblema: 'predio-sp',
  },
  {
    uf: 'es',
    nomePerfil: null,
    nome: 'Espírito Santo',
    destaque: 'DELIVERY ES',
    cidades: [], // PENDENTE
    instagram: 'greencheese_importses',
    whatsapp: null, // PENDENTE
    horario: horarioDemo,
    taxaEntrega: { valor: 10, demo: true },
    entregaGratis: null,
    pagamento: pagamentoDemo,
    emblema: 'convento-es',
  },
  {
    uf: 'sc',
    nomePerfil: null,
    nome: 'Santa Catarina',
    destaque: 'DELIVERY SC',
    cidades: [], // PENDENTE
    instagram: 'greencheese_importssc',
    whatsapp: null, // PENDENTE
    horario: horarioDemo,
    taxaEntrega: { valor: 12, demo: true },
    entregaGratis: null,
    pagamento: pagamentoDemo,
    emblema: 'ponte-sc',
  },
]

/** Perfis que aparecem em marcações de clientes mas ainda não foram confirmados como canal. */
export const perfisAConfirmar = [
  { instagram: 'greencheese_importsvv', nota: 'confirmar', obs: 'aparece em marcações de clientes do Rio' },
]

export const ufsAtendidas = canais.map((c) => c.uf)

export function canalDa(uf: string | null | undefined): Canal | undefined {
  if (!uf) return undefined
  return canais.find((c) => c.uf === uf.toLowerCase())
}
