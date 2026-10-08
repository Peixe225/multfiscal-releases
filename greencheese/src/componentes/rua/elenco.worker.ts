// Worker da rua: monta as folhas do elenco longe do toque e devolve as imagens transferidas (sem cópia).
// No arquivo único (scripts/arquivo-unico.mjs) este código cai no meio da página: só ouve se for worker mesmo.

import { montar } from './montar'
import type { PedidoPacote } from './pacote'

const Escopo = (globalThis as { WorkerGlobalScope?: abstract new () => unknown }).WorkerGlobalScope
const ehWorker = typeof Escopo === 'function' && self instanceof Escopo

if (ehWorker) {
  self.onmessage = async (e: MessageEvent<PedidoPacote>) => {
    try {
      const pacote = await montar(e.data)
      const transf = pacote.imagens.map((i) => ('dados' in i ? i.dados.buffer : i)) as Transferable[]
      ;(self as unknown as Worker).postMessage(pacote, transf)
    } catch (erro) {
      ;(self as unknown as Worker).postMessage({ erro: String(erro) })
    }
  }
}
