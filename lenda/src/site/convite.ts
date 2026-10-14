/**
 * Quando o convite de conta pode aparecer: nunca no meio de uma partida, de uma decisão ou de uma
 * animação, nunca na Live. Abre na tela seguinte ao fim (ou ao tentar começar outra carreira).
 */
export interface ContextoConvite {
  rota: string
  /** Sessão da Live interativa ligada (o jogo está sendo controlado pelo chat). */
  liveLigada: boolean
  /** Clássico: revelação da temporada na tela ou simulação rodando. */
  revelando: boolean
  /** Clássico: carreira em andamento (ainda não terminou). */
  classicoEmAndamento: boolean
  /** Imersivo: partida ao vivo ou coletiva de imprensa em andamento. */
  partidaAoVivo: boolean
  coletiva: boolean
  /** Outro diálogo/celebração aberto (menu, conquistas, taça…). */
  outroDialogo: boolean
}

export function momentoSeguro(c: ContextoConvite): boolean {
  if (c.rota === '/live' || c.liveLigada) return false
  if (c.outroDialogo || c.revelando) return false
  if (c.rota === '/carreira' && c.classicoEmAndamento) return false
  if (c.rota === '/imersivo' && (c.partidaAoVivo || c.coletiva)) return false
  return true
}

/** Tempo que o momento precisa ficar seguro antes do convite abrir (não aparece no meio de uma transição). */
export const CONVITE_ESPERA_MS = 1500
