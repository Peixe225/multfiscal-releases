// Tato do dichavador: vibração curta onde existir navigator.vibrate (Android; o iPhone ignora) e o "modo leve".
// A vibração nunca é citada em texto e nunca há som.

const PADROES = {
  trava: 8,
  quarto: 14,
  estalo: [18, 40, 28],
  mosaico: 8,
} as const

export type Pulso = keyof typeof PADROES

let ultimo = 0

/** Vibra, com pelo menos 60 ms entre pulsos (girar rápido não vira zumbido). O estalo passa por cima do intervalo. */
export function vibrar(p: Pulso): void {
  try {
    if (!('vibrate' in navigator)) return
    const agora = performance.now()
    if (p !== 'estalo' && agora - ultimo < 60) return
    ultimo = agora
    navigator.vibrate(PADROES[p] as number | number[])
  } catch {
    /* sem vibração */
  }
}

// Modo leve: aparelho fraco (poucos núcleos e pouca memória) ou quadro lento nos primeiros 30 quadros do 1º gesto.
// Nele: sem inércia ao soltar, e a câmera que deita vira um corte.
let leve = (() => {
  try {
    const n = navigator as Navigator & { deviceMemory?: number }
    return (n.hardwareConcurrency ?? 8) <= 4 && (n.deviceMemory ?? 8) <= 2
  } catch {
    return false
  }
})()
let quadros: number[] = []
let medido = false

export function modoLeve(): boolean {
  return leve
}

/** Mede o quadro (ms) durante o 1º gesto; depois de 30 quadros, decide. */
export function medirQuadro(dt: number): void {
  if (medido || leve) return
  quadros.push(dt)
  if (quadros.length < 30) return
  medido = true
  const media = quadros.reduce((a, b) => a + b, 0) / quadros.length
  if (media > 24) leve = true
  quadros = []
}
