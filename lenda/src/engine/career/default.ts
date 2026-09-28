/**
 * Motor da carreira ligado ao mundo REAL (src/engine/world).
 *
 *   import { careerEngine } from '@/engine/career/default'
 *
 * Fica num módulo separado de `index.ts` para que quem só precisa dos helpers
 * (formatMoney, roleLabel, conquistas…) não carregue o simulador do mundo.
 */
import type { CareerEngine } from '../api'
import { worldEngine } from '../world'
import { createCareerEngine } from './engine'

let bound: CareerEngine | null = null

/** Instância única, criada no primeiro uso. */
export function getCareerEngine(): CareerEngine {
  if (!bound) bound = createCareerEngine(worldEngine)
  return bound
}

export const careerEngine: CareerEngine = {
  newCareer: (...a) => getCareerEngine().newCareer(...a),
  choose: (...a) => getCareerEngine().choose(...a),
  summarize: (...a) => getCareerEngine().summarize(...a),
  describeOption: (...a) => getCareerEngine().describeOption!(...a),
}

export default careerEngine
