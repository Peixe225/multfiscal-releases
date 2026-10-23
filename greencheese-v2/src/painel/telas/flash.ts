// Recado pra próxima tela ("Publicado! …"): quem salvou deixa e muda de tela. Agora é o recado de sempre (recado.tsx),
// que aparece embaixo e continua na tela que abre; pegarRecado() fica pras telas de antes (não tem mais nada guardado).
import { recado } from '../recado'

export function avisarNaProxima(texto: string): void {
  recado(texto)
}

export function pegarRecado(): string | null {
  return null
}
