// Quais produtos têm ilustração realista, sem baixar o pedaço delas (que pesa). Enquanto ele não chega, o produto que
// vai ganhar a ilustração aparece em pixel art já em cima do halo dela (ProdutoVisual): a troca para o real não muda o
// fundo, e o halo do 1º story conta para a LCP desde a primeira pintura. Mantenha igual às chaves de `artes` em
// acessorios.tsx, destilados.tsx, latas.tsx e papel.tsx (carregar.ts confere em desenvolvimento).
export const IDS_REALISTAS: ReadonlySet<string> = new Set([
  'jack-daniels-old-no7-1l',
  'gin-tanqueray-london-dry',
  'hennessy-very-special',
  'jagermeister-700ml',
  'fanta-ghost-face-punch',
  'coca-cola-vanilla',
  'dr-pepper',
  'arizona-green-tea',
  'seda-ocb-premium-slim',
  'seda-raw-classic-king-size',
  'seda-smoking-brown',
  'piteira-de-papel-raw',
  'piteira-de-vidro-raw',
  'cuia-de-silicone-raw',
  'dichavador-metal-4-partes',
  'isqueiro-clipper',
  'bandeja-raw-pequena',
])
