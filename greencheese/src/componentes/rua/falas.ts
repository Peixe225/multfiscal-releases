// Falas da rua: curtas, na voz da loja. Nada de frase de jogo (o mercador não repete bordão de ninguém) e nenhuma
// palavra da lista PALAVRAS_PROIBIDAS de src/dados/sorte.ts (o scripts/revisao.mjs confere este arquivo).
// "Sextou!" só às sextas (o motor sabe o dia).

export const FALAS = {
  mercador: {
    /** Quando chamam ele (toque ou teclado), com o botão do Mercado. A longa só onde o balão cabe em duas linhas. */
    chamado: ['Chega mais.', 'Vem no certo!'],
    chamadoLongo: ['Quem já usou sabe da qualidade.'],
    oferecer: ['Tem sim.', 'É pra já.', 'Chega mais.'],
    agradecer: ['Valeu!', 'Tamo junto.', 'Volta sempre!', 'Fechou!'],
    motoboy: ['Voa, parceiro!', 'Vai na fé!', 'Vai com cuidado!'],
    mc: ['Salve!', 'Fala, MC!'],
    turista: ['É aqui mesmo.', 'Chega mais.'],
    entregar: ['Na mão!', 'Tá aqui.'],
  },
  skatista: {
    pedir: ['Salve! Tem seda?', 'Fala! Tem seda aí?'],
    valeu: ['Valeu!', 'Brabo!'],
  },
  motoboy: {
    pedir: ['Pedido da GC!', 'Vim buscar o pedido!'],
    valeu: ['Partiu!', 'Já é!'],
  },
  mc: {
    chegar: ['Salve, mercador!', 'E aí, mercador!'],
    pedir: ['Me vê uma Arizona!', 'Tem Arizona?'],
    valeu: ['Tamo junto!', 'É nóis!'],
  },
  turista: {
    pedir: ['É aqui a Green Cheese?', 'Oi! É aqui a GC?'],
    piteira: ['Tem piteira?', 'Quero uma piteira!'],
    valeu: ['Obrigado!', 'Que demais!'],
  },
  sextou: 'Sextou!',
} as const

/** Uma fala da lista, sem repetir a última dita daquela lista (quando tem mais de uma). */
const ultimas = new WeakMap<readonly string[], string>()
export function sortear(lista: readonly string[], rand: () => number): string {
  if (lista.length < 2) return lista[0]
  const antes = ultimas.get(lista)
  let f = lista[Math.floor(rand() * lista.length)]
  if (f === antes) f = lista[(lista.indexOf(f) + 1) % lista.length]
  ultimas.set(lista, f)
  return f
}
