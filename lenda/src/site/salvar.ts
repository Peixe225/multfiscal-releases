/**
 * "Salvar na minha conta" (botão): salva e avisa. Sem rede, a carreira entra na fila do aparelho e sobe sozinha
 * quando a internet voltar (vigias.reenviarPendentes), como "manual".
 */
import type { HallEntry } from '@/store/career'
import { toast } from '@/ui/primitives'
import { mensagemDeErro, valeTentar } from './api'
import { marcarPendente, useCarreiras } from './carreiras'

export async function salvarManual(h: HallEntry): Promise<boolean> {
  try {
    await useCarreiras.getState().salvar(h, 'manual')
    toast.success('Salva na sua conta', `${h.identity.surname} · pico ${h.summary.peakOvr}`)
    return true
  } catch (err) {
    if (valeTentar(err)) {
      marcarPendente(h.id, 'manual')
      toast.info('Sem conexão agora', `${h.identity.surname} sobe para a sua conta sozinha quando a internet voltar.`)
    } else toast.error('Não deu para salvar na conta', mensagemDeErro(err))
    return false
  }
}
