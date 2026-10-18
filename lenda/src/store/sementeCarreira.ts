/**
 * Semente da carreira do Clássico sorteada pelo servidor (servidor/CONTRATO-v33.md §E): a ponte entre o src/site (que sabe
 * da conta) e a tela de identidade (que começa a carreira). Só a carreira começada com uma semente que o servidor sorteou
 * para a conta vale para os desafios — a semente escolhida no aparelho dava para fixar pelo console e achar por fora uma
 * carreira que "bate" na verificação. Fora do site, sem conta, sem rede, com o servidor antigo ou no limite de partidas do
 * dia, `pedir` é null ou devolve null e a carreira começa com a semente do aparelho, como sempre (ela só não vale para
 * desafio).
 *
 *   const seed = await sementeDaCarreira()   // o texto da semente (do servidor ou do aparelho); o par fica guardado
 */
import { create } from 'zustand'
import { randomSeed, registrarParDeSemente } from './career'

interface SementeCarreira {
  /** Pede ao servidor a semente da carreira que começa agora: [a0, a1] ou null (sem conta, sem rede, limite do dia). */
  pedir: (() => Promise<readonly [number, number] | null>) | null
}

export const useSementeCarreira = create<SementeCarreira>()(() => ({ pedir: null }))

/** O tempo máximo que a criação da carreira espera pelo servidor antes de seguir com a semente do aparelho. */
export const ESPERA_SEMENTE_MS = 2500

/** A semente da carreira que começa agora: a do servidor, se ele responder a tempo; senão, a do aparelho. */
export async function sementeDaCarreira(espera = ESPERA_SEMENTE_MS): Promise<string> {
  const pedir = useSementeCarreira.getState().pedir
  if (pedir) {
    let t: ReturnType<typeof setTimeout> | undefined
    try {
      const par = await Promise.race([pedir(), new Promise<null>((r) => (t = setTimeout(() => r(null), espera)))])
      const seed = par ? registrarParDeSemente(par) : null
      if (seed) return seed
    } catch {
      // sem rede, sessão caída, servidor antigo: segue com a do aparelho
    } finally {
      if (t) clearTimeout(t)
    }
  }
  return randomSeed()
}
