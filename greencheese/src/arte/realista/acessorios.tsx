// Ilustrações realistas — grupo "acessorios". Cada entrada: id do produto (catalogo.json) → componente (ver comum.tsx).
// Cada produto mora no seu arquivo acessorios-<produto>.tsx; a geometria comum está em acessorios-base.tsx e os contornos
// das palavras impressas (RAW, Clipper…) em acessorios-glifos.tsx (gerado por lab/realista-acessorios-glifos.mjs).
import type { Arte } from './comum'
import { Bandeja } from './acessorios-bandeja'
import { Cuia } from './acessorios-cuia'
import { Dichavador } from './acessorios-dichavador'
import { Isqueiro } from './acessorios-isqueiro'
import { Piteira } from './acessorios-piteira'

export const artes: Record<string, Arte> = {
  'piteira-de-vidro-raw': Piteira,
  'cuia-de-silicone-raw': Cuia,
  'dichavador-metal-4-partes': Dichavador,
  'isqueiro-clipper': Isqueiro,
  'bandeja-raw-pequena': Bandeja,
}
