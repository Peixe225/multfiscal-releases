// Prêmios do "Teste minha sorte" (o dichavador que entrega um beck bolado com cupom dentro).
// É aqui que a loja troca as promoções. Ver "Como trocar os prêmios" no LEIA-ME.md.
//
// REGRAS
// - Só acessórios (sedas, piteiras, acessórios). Nenhum prêmio em bebidas, destilados ou tabaco
//   (Lei 9.294/1996, Anvisa RDC 840/2023): a validação em src/lib/cupom.ts recusa.
// - Nada de frete, prazo ou desconto calculado: o site nunca recalcula o subtotal; a loja confirma no WhatsApp.
// - Todo giro ganha. `peso` decide qual sai (peso relativo; não precisa somar 100). As chances nunca aparecem na tela.
// - demo: true = promoção de EXEMPLO. Fica enquanto config.dadosDeExemplo (com o carimbo "exemplo" só se config.carimboDeExemplo); com dadosDeExemplo = false, some.
//   Sem nenhum prêmio válido, o interativo some do site inteiro.
// - ids de produto e de categoria vêm de src/dados/catalogo.json.
// - `regra` é a frase completa que vai na linha do cupom no WhatsApp. Escreve como a loja fala.

export type TipoPremio = 'desconto-percentual' | 'leve-x-pague-y' | 'brinde'

interface PremioBase {
  id: string
  /** Curto, cabe num chip: "4 por 3 na OCB". */
  titulo: string
  /** 1 frase de apoio no cartão. */
  descricao: string
  /** Frase completa; é ela que vai na linha do WhatsApp. */
  regra: string
  /** ids do catalogo.json. Produtos e/ou categorias. */
  aplicaA: { produtos?: string[]; categorias?: string[] }
  /** Peso relativo (> 0). */
  peso: number
  /** Dias de validade, contados a partir de quando a pessoa guarda o prêmio (1 a 30). */
  validadeDias: number
  comoUsar?: string
  /** Cor do beck e do cartão: branco (OCB) ou natural (RAW). Padrão: natural. */
  papel?: 'branco' | 'natural'
  demo: boolean
}

/** Tipo e valor andam juntos (o valor muda de forma conforme o tipo). */
export type ValorPremio =
  | { tipo: 'desconto-percentual'; valor: number } // 1 a 50
  | { tipo: 'leve-x-pague-y'; valor: { leve: number; pague: number } }
  | { tipo: 'brinde'; valor: { produto: string; qtd: number } } // produto = id do catalogo.json

export type Premio = PremioBase & ValorPremio

export const regrasSorte = {
  /** O nome do prêmio fica só aqui (e fora da imagem de compartilhamento e do link da bio: regras da Meta). */
  nomeDoPremio: 'beck bolado',
  /** Começo do código do cupom (SORTE-AB12). */
  prefixo: 'SORTE',
  /** Quartos de volta para abrir o dichavador (8 = 2 voltas). */
  quartosParaAbrir: 8,
  girosSemConta: 1,
  girosPorDiaComConta: 1,
  /** Quanto tempo o prêmio de quem girou sem conta fica reservado neste aparelho. */
  reservaSemContaHoras: 24,
  fuso: 'America/Sao_Paulo',
} as const

/**
 * Palavras que não entram em nenhuma copy nem em nenhum prêmio (checadas sem acento e sem caixa na validação).
 * O "beck" é um tubo de papel enrolado: sem folha, broto, fumaça, ponta acesa ou cinza. Paleta rasta também fica fora.
 * "grátis", "frete", "prazo", "entrega" e "sorteio" ficam fora porque prometem o que o site não garante.
 */
export const PALAVRAS_PROIBIDAS = [
  'folha',
  'erva',
  'flor',
  'prensado',
  'marofa',
  'fumaça',
  'fumar',
  'brisa',
  'chapar',
  'larica',
  'tapa',
  'trago',
  '420',
  'grátis',
  'frete',
  'prazo',
  'entrega',
  'sorteio',
  'cigarro',
  'charuto',
  'backwoods',
  'fumo',
  'tabaco',
] as const

export const premios: Premio[] = [
  {
    id: 'ocb-4-por-3',
    tipo: 'leve-x-pague-y',
    valor: { leve: 4, pague: 3 },
    titulo: '4 por 3 na OCB',
    descricao: 'Compra 3, leva 4.',
    regra: 'Leva 4 Seda OCB Premium Slim e paga 3',
    aplicaA: { produtos: ['seda-ocb-premium-slim'] },
    comoUsar: 'Põe 4 na sacola e usa o cupom. A loja tira 1 na conversa e confirma como fica junto com o combo da OCB.',
    peso: 30,
    validadeDias: 7,
    papel: 'branco',
    demo: true,
  },
  {
    id: 'piteira-vidro-15',
    tipo: 'desconto-percentual',
    valor: 15,
    titulo: '15% na piteira de vidro',
    descricao: 'A piteira de vidro RAW com 15% a menos.',
    regra: '15% de desconto na Piteira de vidro RAW',
    aplicaA: { produtos: ['piteira-de-vidro-raw'] },
    comoUsar: 'Põe a piteira na sacola e usa o cupom. A loja confirma o desconto na conversa.',
    peso: 20,
    validadeDias: 7,
    demo: true,
  },
  {
    id: 'brinde-piteira-papel',
    tipo: 'brinde',
    valor: { produto: 'piteira-de-papel-raw', qtd: 1 },
    titulo: 'Piteira de papel de brinde',
    descricao: 'Uma piteira de papel RAW junto com tua seda.',
    regra: '1 Piteira de papel RAW de brinde no pedido com seda',
    aplicaA: { categorias: ['sedas'] },
    comoUsar: 'Vale em pedido com qualquer seda. A loja confirma a piteira na conversa.',
    peso: 25,
    validadeDias: 7,
    demo: true,
  },
  {
    id: 'dichavador-10',
    tipo: 'desconto-percentual',
    valor: 10,
    titulo: '10% no dichavador',
    descricao: 'Gostou de girar? Leva o de verdade.',
    regra: '10% de desconto no Dichavador de metal 4 partes',
    aplicaA: { produtos: ['dichavador-metal-4-partes'] },
    peso: 15,
    validadeDias: 7,
    demo: true,
  },
  {
    id: 'bandeja-10',
    tipo: 'desconto-percentual',
    valor: 10,
    titulo: '10% na bandeja RAW',
    descricao: 'A bandeja pequena com 10% a menos.',
    regra: '10% de desconto na Bandeja RAW pequena',
    aplicaA: { produtos: ['bandeja-raw-pequena'] },
    peso: 10,
    validadeDias: 7,
    demo: true,
  },
]
