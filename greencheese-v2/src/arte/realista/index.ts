// Registro das ilustrações realistas por id de produto. Produto sem ilustração cai na arte em pixel.
import type { Arte } from './comum'
import { artes as acessorios } from './acessorios'
import { artes as destilados } from './destilados'
import { artes as latas } from './latas'
import { artes as papel } from './papel'

export const artesRealistas: Record<string, Arte> = { ...latas, ...destilados, ...papel, ...acessorios }

export { QUADRO } from './comum'
