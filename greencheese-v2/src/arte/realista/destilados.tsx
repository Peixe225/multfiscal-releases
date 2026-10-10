// Ilustrações realistas — grupo "destilados". Cada entrada: id do produto (catalogo.json) → componente (ver comum.tsx).
// Garrafas de vidro em SVG (só gradientes, recortes e texto), uma por arquivo destilados-*.tsx.
import type { Arte } from './comum'
import { Hennessy } from './destilados-hennessy'
import { JackDaniels } from './destilados-jack'
import { Jagermeister } from './destilados-jager'
import { Tanqueray } from './destilados-tanqueray'

export const artes: Record<string, Arte> = {
  'jack-daniels-old-no7-1l': JackDaniels,
  'gin-tanqueray-london-dry': Tanqueray,
  'hennessy-very-special': Hennessy,
  'jagermeister-700ml': Jagermeister,
}
