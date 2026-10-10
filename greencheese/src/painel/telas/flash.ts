// Recado pra próxima tela ("Publicado! …"): quem salvou deixa, a tela que abre mostra uma vez.
let recado: string | null = null

export function avisarNaProxima(texto: string): void {
  recado = texto
}

export function pegarRecado(): string | null {
  const r = recado
  recado = null
  return r
}
