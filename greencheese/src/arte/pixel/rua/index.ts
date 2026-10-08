// O elenco da rua (Início vivo): o mercador e os quatro clientes, os itens que passam de mão em mão, os efeitos e o
// cenário. Formato dos quadros em modelo.ts; montagem das peças em compor.ts; desenho no canvas em desenhar.ts.
//
// Tudo olha para a direita no `dir`; o `esq` já vem espelhado (com o GC legível). Escala recomendada: 3 px por pixel
// no celular, 2 quando precisa caber mais gente; 3 a 5 no computador.

import { ladrilhos, objetos, sombras } from './cenario'
import { gato } from './gato'
import { itens } from './itens'
import { mc } from './mc'
import { mercadorRua } from './mercador'
import type { Personagem } from './modelo'
import { motoboy } from './motoboy'
import { skatista } from './skatista'
import { turista } from './turista'

export type { Animacao, Lado, Personagem, Quadro } from './modelo'
export type { Ladrilho } from './cenario'
export { ancoraDo, paletaDe, quadroEmLinhas, quadroNoTempo } from './modelo'
export { desenharQuadro, imagemDoQuadro, prancha, telaDaPeca } from './desenhar'
export { criarLuz, criarPoste, paletaCenario } from './cenario'
export { itens }

/** O mercador e os clientes, por id. */
export const elenco: Record<string, Personagem> = {
  mercador: mercadorRua,
  skatista,
  motoboy,
  mc,
  turista,
  gato,
}

/** Objetos do cenário (poste, luz, porta, letreiro) e os ladrilhos que repetem (muro, calçada, meio-fio, asfalto). */
export const cenario = { objetos, ladrilhos }

/** Sombra de chão de cada personagem (mesmo id do elenco). */
export { sombras }
