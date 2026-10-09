// O que é bebida pra regra "prêmio só em acessório" do Teste minha sorte, além da categoria marcada como bebida: o
// desenho de bebida (lata alta e garrafas) e o nome de bebida alcoólica (os tipos e as marcas comuns). É a rede pra
// quando o produto foi parar numa categoria sem bebida. O site (src/lib/premios.ts), o painel (src/painel/loja) e o
// servidor (GC_LOJA_ALCOOL e GC_LOJA_ARTES_BEBIDA em api/nucleo/loja-validar.php) usam as mesmas listas: o
// scripts/testar-api-loja.mjs confere que batem.

/** Nome de bebida alcoólica: palavra (ou palavras) inteira, sem acento. */
export const ALCOOL = [
  'whisky', 'whiskey', 'uisque', 'gin', 'vodka', 'vodca', 'rum', 'tequila', 'cachaca', 'conhaque', 'cognac', 'licor',
  'cerveja', 'chopp', 'vinho', 'espumante', 'champagne', 'jagermeister', 'absinto', 'bourbon', 'mezcal',
  'chope', 'chopes', 'cervejas', 'vinhos', 'champanhe', 'prosecco', 'sidra', 'sake', 'saque', 'soju', 'vermute', 'vermouth',
  'martini', 'pinga', 'aguardente', 'ice beer', 'beats', 'jager', 'jack daniel', 'jack daniels',
  'smirnoff', 'absolut', 'ciroc', 'grey goose', 'johnnie walker', 'red label', 'black label', 'blue label', 'gold label',
  'double black', 'chivas', 'jameson', 'ballantines', 'white horse', 'old parr', 'buchanans', 'jim beam', 'wild turkey',
  'makers mark', 'glenfiddich', 'macallan', 'tanqueray', 'beefeater', 'bombay sapphire', 'gordons', 'bacardi',
  'havana club', 'malibu', 'jose cuervo', 'cuervo', 'campari', 'aperol', 'baileys', 'amarula', 'cointreau', 'ypioca',
  'velho barreiro', 'sagatiba', 'askov', 'catuaba', 'heineken', 'brahma', 'skol', 'budweiser', 'stella', 'corona',
  'amstel', 'itaipava', 'eisenbahn', 'spaten', 'becks', 'devassa', 'bohemia', 'guinness', 'hoegaarden', 'michelob',
  'kirin', 'sapporo', 'asahi', 'jinro', 'xeque mate',
]

/**
 * Formatos do desenho que são de bebida (lata alta e garrafas): produto assim não vira prêmio, mesmo fora de categoria
 * de bebida. A lata comum fica de fora: é o desenho que todo produto novo ganha no painel.
 */
export const ARTES_DE_BEBIDA = ['lata-alta', 'garrafa-quadrada', 'garrafa-gin', 'garrafa-conhaque', 'garrafa-licor']

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Nome com cara de bebida alcoólica? O apóstrofo sai antes ("Jack Daniel's" e "Gordon's" são "daniels" e "gordons"). */
export function pareceAlcool(nome: string): boolean {
  const t = ` ${semAcento(nome).replace(/['’`´]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `
  return ALCOOL.some((p) => t.includes(` ${p} `))
}

/** O produto é bebida pelo que ele mesmo diz (o desenho ou o nome), sem olhar a categoria. */
export function bebidaPeloProduto(p: { nome?: string; arte?: { tipo?: string } | null }): boolean {
  return (!!p.arte?.tipo && ARTES_DE_BEBIDA.includes(p.arte.tipo)) || (!!p.nome && pareceAlcool(p.nome))
}
