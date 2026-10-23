// A hora do painel (a do servidor, api.agora()) relida de minuto em minuto e na volta pra aba: quem mostra "hoje 23:57",
// "ontem" ou "há 3 min" redesenha sozinho. A lista de pedidos ao vivo recebe 304 sem corpo quando nada mudou e não
// redesenha; sem isso, o "hoje 23:57" ficava "hoje" depois da meia-noite até recarregar. Um relógio só pro painel todo.
import { useSyncExternalStore } from 'react'
import * as api from './api'

let agora = api.agora()
let relogio = 0
const ouvintes = new Set<() => void>()

function tique(): void {
  agora = api.agora()
  ouvintes.forEach((f) => f())
}

function agendar(): void {
  window.clearTimeout(relogio)
  // logo depois da virada de cada minuto (a hora na tela muda junto com a do relógio)
  relogio = window.setTimeout(() => {
    tique()
    agendar()
  }, 60_000 - (api.agora() % 60_000) + 50)
}

function aoVoltar(): void {
  if (document.visibilityState !== 'visible') return
  tique()
  agendar()
}

function assinar(f: () => void): () => void {
  ouvintes.add(f)
  if (ouvintes.size === 1) {
    agora = api.agora()
    agendar()
    document.addEventListener('visibilitychange', aoVoltar)
  }
  return () => {
    ouvintes.delete(f)
    if (!ouvintes.size) {
      window.clearTimeout(relogio)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }
}

/** A hora do painel (ms), que muda a cada minuto: a tela que mostra data e hora relativas redesenha junto. */
export function useAgoraDoMinuto(): number {
  return useSyncExternalStore(assinar, () => agora, () => agora)
}
