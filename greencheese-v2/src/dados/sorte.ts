// Prêmios do "Teste minha sorte" (gira o dichavador e, lá dentro, um story dos Melhores amigos com o cupom).
// É aqui que a loja troca as promoções. Ver "Como trocar os prêmios" no LEIA-ME.md.
//
// REGRAS
// - Só acessórios (sedas, piteiras, acessórios). Nenhum prêmio em bebidas, destilados ou tabaco
//   (Lei 9.294/1996, Anvisa RDC 840/2023): a validação em src/lib/cupom.ts recusa.
// - Nada de frete, prazo ou desconto calculado: o site nunca recalcula o subtotal; a loja confirma no WhatsApp.
// - Todo giro ganha. O sorteio é em dois passos (src/lib/sorteio.ts, o mesmo do servidor): primeiro a `raridade`, pela
//   chance dela (CHANCES_PADRAO em src/lib/raridade.ts, 60/25/12/3; no painel, o dono muda) entre as raridades que têm
//   prêmio valendo no estado; depois o prêmio, pelo `peso` dentro da raridade (peso relativo). Sem `raridade`, comum.
//   As chances nunca aparecem na tela.
// - demo: true = promoção de EXEMPLO. Fica enquanto config.dadosDeExemplo (com o carimbo "exemplo" só se config.carimboDeExemplo); com dadosDeExemplo = false, some.
//   Sem nenhum prêmio válido, o interativo some do site inteiro.
// - ids de produto e de categoria vêm de src/dados/catalogo.json.
// - `regra` é a frase completa que vai na linha do cupom no WhatsApp. Escreve como a loja fala.

import type { Raridade } from '../lib/raridade'

export type TipoPremio = 'desconto-percentual' | 'leve-x-pague-y' | 'brinde'

interface PremioBase {
  id: string
  /** Nome interno ("4 por 3 na OCB"). Na tela o prêmio aparece sempre como destaque + produto (nomeDoPremio). */
  titulo: string
  /**
   * 1 linha curta de apoio no story do prêmio, sem repetir o prêmio (o destaque "15% OFF" + o produto o story monta
   * sozinho a partir do tipo, do valor e do produto). Até uns 28 caracteres (1 linha em 320 px). Sem condição nem promessa
   * de tempo ("hoje"): isso vai na `regra` e no `comoUsar`.
   */
  descricao: string
  /** Frase completa; é ela que vai na linha do WhatsApp. */
  regra: string
  /** ids do catalogo.json. Produtos e/ou categorias. */
  aplicaA: { produtos?: string[]; categorias?: string[] }
  /** Peso relativo dentro da raridade (> 0; o padrão é 1). */
  peso: number
  /** Comum, raro, épico ou lendário (src/lib/raridade.ts): a cor e a animação do prêmio; sem ela, comum. */
  raridade?: Raridade
  /** Dias de validade, contados a partir de quando a pessoa guarda o prêmio (1 a 30). */
  validadeDias: number
  /** Opcional: como usar, numa frase (aparece no "Ver condições" do story e na Minha conta). */
  comoUsar?: string
  demo: boolean
}

/** Tipo e valor andam juntos (o valor muda de forma conforme o tipo). */
export type ValorPremio =
  | { tipo: 'desconto-percentual'; valor: number } // 1 a 50
  | { tipo: 'leve-x-pague-y'; valor: { leve: number; pague: number } }
  | { tipo: 'brinde'; valor: { produto: string; qtd: number } } // produto = id do catalogo.json

export type Premio = PremioBase & ValorPremio

export const regrasSorte = {
  /** Começo do código do cupom (SORTE-AB12). */
  prefixo: 'SORTE',
  /** Quartos de volta para abrir o dichavador (8 = 2 voltas). */
  quartosParaAbrir: 8,
  girosSemConta: 1,
  /**
   * Com conta: `girosPorIntervalo` giros a cada `intervaloDias` dias de calendário de Brasília (em quaisquer X dias
   * seguidos, no máximo N giros; 1 e 1 = 1 por dia, vira à meia-noite). No painel o dono muda (1 a 30 dias, 1 a 5 giros).
   */
  girosPorIntervalo: 1,
  intervaloDias: 1,
  /** Quanto tempo o prêmio de quem girou sem conta fica reservado neste aparelho. */
  reservaSemContaHoras: 24,
  fuso: 'America/Sao_Paulo',
} as const

/**
 * Palavras que não entram em nenhuma copy nem em nenhum prêmio (checadas sem acento e sem caixa na validação).
 * Nada de folha, broto, fumaça, ponta acesa ou cinza no jogo nem no prêmio. Paleta rasta também fica fora.
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
    descricao: 'Uma OCB por conta da sorte.',
    regra: 'Leva 4 Seda OCB Premium Slim e paga 3',
    aplicaA: { produtos: ['seda-ocb-premium-slim'] },
    comoUsar: 'Põe 4 na sacola e usa o cupom. Com o combo da OCB, a conta fecha na conversa.',
    peso: 30,
    validadeDias: 7,
    raridade: 'comum',
    demo: true,
  },
  {
    id: 'piteira-vidro-15',
    tipo: 'desconto-percentual',
    valor: 15,
    titulo: '15% na piteira de vidro',
    descricao: 'A de vidro sai mais em conta.',
    regra: '15% de desconto na Piteira de vidro RAW',
    aplicaA: { produtos: ['piteira-de-vidro-raw'] },
    comoUsar: 'Põe a piteira na sacola e usa o cupom.',
    peso: 20,
    validadeDias: 7,
    raridade: 'raro',
    demo: true,
  },
  {
    id: 'brinde-piteira-papel',
    tipo: 'brinde',
    valor: { produto: 'piteira-de-papel-raw', qtd: 1 },
    titulo: 'Piteira de papel de brinde',
    descricao: 'Vem junto com tua seda.',
    regra: '1 Piteira de papel RAW de brinde no pedido com seda',
    aplicaA: { categorias: ['sedas'] },
    comoUsar: 'Põe qualquer seda na sacola e usa o cupom.',
    peso: 25,
    validadeDias: 7,
    raridade: 'raro',
    demo: true,
  },
  {
    id: 'dichavador-10',
    tipo: 'desconto-percentual',
    valor: 10,
    titulo: '10% no dichavador',
    descricao: 'Agora gira o de verdade.',
    regra: '10% de desconto no Dichavador de metal 4 partes',
    aplicaA: { produtos: ['dichavador-metal-4-partes'] },
    peso: 15,
    validadeDias: 7,
    raridade: 'comum',
    demo: true,
  },
  {
    id: 'bandeja-10',
    tipo: 'desconto-percentual',
    valor: 10,
    titulo: '10% na bandeja RAW',
    descricao: 'Tudo no lugar pra enrolar.',
    regra: '10% de desconto na Bandeja RAW pequena',
    aplicaA: { produtos: ['bandeja-raw-pequena'] },
    peso: 10,
    validadeDias: 7,
    raridade: 'comum',
    demo: true,
  },
  // o épico e o lendário de exemplo (pra loja ver as 4 raridades): só acessório, como os outros
  {
    id: 'bandeja-25',
    tipo: 'desconto-percentual',
    valor: 25,
    titulo: '25% na bandeja RAW',
    descricao: 'Bandeja bem mais em conta.',
    regra: '25% de desconto na Bandeja RAW pequena',
    aplicaA: { produtos: ['bandeja-raw-pequena'] },
    comoUsar: 'Põe a bandeja na sacola e usa o cupom.',
    peso: 1,
    validadeDias: 7,
    raridade: 'epico',
    demo: true,
  },
  {
    id: 'dichavador-40',
    tipo: 'desconto-percentual',
    valor: 40,
    titulo: '40% no dichavador',
    descricao: 'Sorte grande no dichavador.',
    regra: '40% de desconto no Dichavador de metal 4 partes',
    aplicaA: { produtos: ['dichavador-metal-4-partes'] },
    comoUsar: 'Põe o dichavador na sacola e usa o cupom.',
    peso: 1,
    validadeDias: 7,
    raridade: 'lendario',
    demo: true,
  },
]
