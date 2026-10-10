// Canais de atendimento por estado. É aqui que se troca WhatsApp, cidades, horário, taxa e pagamento.
//
// REGRAS
// - whatsapp: número próprio do estado, com DDI 55 + DDD + número, sem espaço (ex.: '5533999998888').
//   null = o pedido fecha no WhatsApp da loja (config.whatsappPedidos), o mesmo para todos. Nunca invente número.
// - instagram: é pra lá que vão as dúvidas que o site não tira (DM do estado) e o "Avisar quando chegar".
// - demo: true = valor de demonstração (PENDENTE). Com config.carimboDeExemplo ele aparece com a marca "demo";
//   sem o carimbo, horário demo não aparece e taxa demo vira "a confirmar".
// - Com o painel instalado, quem manda nos estados é o servidor (Loja → Estados): o site começa com estes e troca
//   pelos de lá quando a loja chega (src/store/loja.ts). Estes viram a semente de um banco novo e a reserva sem
//   servidor. Sem import neste arquivo: o gerador da semente lê ele direto.

/** Sigla minúscula de um estado da loja. Os daqui são rj, mg, sp, es e sc; o dono ativa outros no painel. */
export type UfAtendida = string
export type FormaPagamento = 'pix' | 'dinheiro' | 'cartao'
/** O desenho do destaque do estado. 'generico' (o pino) = estado ativado no painel, sem desenho próprio. */
export type Emblema = 'pao-de-acucar' | 'pedra-preciosa' | 'predio-sp' | 'convento-es' | 'ponte-sc' | 'generico'

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
  /** Perfil do estado: dúvidas (DM) e "Avisar quando chegar". */
  instagram: string
  /** WhatsApp próprio do estado. null = o da loja (config.whatsappPedidos, ou o do painel). */
  whatsapp: string | null
  /** Domingo = 0 ... sábado = 6. */
  horario: { semana: [Turno, Turno, Turno, Turno, Turno, Turno, Turno]; demo: boolean }
  taxaEntrega: { valor: number | null; texto?: string; demo: boolean }
  /** Entrega grátis nos dias da semana da lista (domingo = 0), com a frase do story. */
  entregaGratis: { dias: number[]; texto: string; demo: boolean } | null
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

const embutidos: Canal[] = [
  {
    uf: 'rj',
    nomePerfil: 'GREEN CHEESE LTDA',
    nome: 'Rio de Janeiro',
    destaque: 'DELIVERY RJ',
    cidades: [{ slug: 'rio-de-janeiro', nome: 'Rio de Janeiro' }],
    instagram: 'greencheese_importsrj',
    whatsapp: null, // usa config.whatsappPedidos
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
    whatsapp: null, // usa config.whatsappPedidos
    horario: horarioDemo,
    taxaEntrega: { valor: 8, demo: true },
    // Dado real dos stories de MG.
    entregaGratis: { dias: [5], texto: 'Sextou com entrega grátis!', demo: false },
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
    whatsapp: null, // usa config.whatsappPedidos
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
    whatsapp: null, // usa config.whatsappPedidos
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
    whatsapp: null, // usa config.whatsappPedidos
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

/** Os estados que vão embutidos no site (a reserva sem servidor e a semente do banco). */
export const canaisEmbutidos: readonly Canal[] = embutidos

/**
 * Os estados do site agora, na ordem da loja. Começa com os embutidos e vira os do servidor quando a loja chega
 * (src/store/loja.ts chama trocarCanais). Quem só lê na hora (o pedido, o rateio) usa daqui; tela que mostra estado
 * assina a loja (useCanais/useCanalDa em src/store/loja.ts) pra redesenhar quando eles mudam.
 */
export let canais: Canal[] = embutidos

export function trocarCanais(novos: Canal[]): void {
  canais = novos
}

export function canalDa(uf: string | null | undefined): Canal | undefined {
  if (!uf) return undefined
  const u = uf.toLowerCase()
  return canais.find((c) => c.uf === u)
}
