// Versão "cheia" de um ícone de contorno (aba atual, no molde do Instagram): tudo o que fica fechado dentro do
// contorno vira traço. Inunda o vazio a partir da borda (4 vizinhos); o vazio que a inundação não alcança é de dentro.
import { COR_TEXTO, TRANSPARENTE, type Grade } from './grades'

const cache = new WeakMap<Grade, Grade>()

export function preenchida(grade: Grade): Grade {
  const pronta = cache.get(grade)
  if (pronta) return pronta
  const { w, h } = grade
  const vazio = (x: number, y: number) => (grade.linhas[y]?.[x] ?? TRANSPARENTE) === TRANSPARENTE
  const fora = new Uint8Array(w * h)
  const fila: number[] = []
  const entrar = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = y * w + x
    if (fora[i] || !vazio(x, y)) return
    fora[i] = 1
    fila.push(i)
  }
  for (let x = 0; x < w; x++) {
    entrar(x, 0)
    entrar(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    entrar(0, y)
    entrar(w - 1, y)
  }
  while (fila.length) {
    const i = fila.pop()!
    const x = i % w
    const y = (i - x) / w
    entrar(x + 1, y)
    entrar(x - 1, y)
    entrar(x, y + 1)
    entrar(x, y - 1)
  }
  const linhas = grade.linhas.map((l, y) =>
    Array.from({ length: w }, (_, x) => {
      const c = l[x] ?? TRANSPARENTE
      return c === TRANSPARENTE && !fora[y * w + x] ? COR_TEXTO : c
    }).join(''),
  )
  const cheia: Grade = { w, h, linhas, paleta: grade.paleta }
  cache.set(grade, cheia)
  return cheia
}
