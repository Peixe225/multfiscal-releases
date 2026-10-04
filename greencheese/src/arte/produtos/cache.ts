// Cache em memória das artes prontas (o mesmo produto aparece no card, no story e no hero).
// Guarda a imagem final (ImageData já com dither), a promessa em andamento (para não gerar
// duas vezes a mesma arte ao mesmo tempo), as fotos carregadas e quais artes já foram reveladas.

const LIMITE = 160

const prontas = new Map<string, ImageData>()
const emAndamento = new Map<string, Promise<ImageData>>()
const fotos = new Map<string, Promise<HTMLImageElement>>()
const mascaras = new Map<string, string>()
const reveladas = new Set<string>()

export function imagemEmCache(chave: string): ImageData | undefined {
  return prontas.get(chave)
}

/** Devolve a arte da chave; se não existir, gera uma vez só (mesmo com vários pedidos juntos). */
export function lembrar(chave: string, gerar: () => Promise<ImageData>): Promise<ImageData> {
  const pronta = prontas.get(chave)
  if (pronta) return Promise.resolve(pronta)
  const andamento = emAndamento.get(chave)
  if (andamento) return andamento
  const promessa = gerar()
    .then((img) => {
      prontas.set(chave, img)
      // Limite simples: sai a mais antiga (Map guarda a ordem de inserção).
      if (prontas.size > LIMITE) {
        const velha = prontas.keys().next().value
        if (velha !== undefined) {
          prontas.delete(velha)
          mascaras.delete(velha)
        }
      }
      return img
    })
    .finally(() => emAndamento.delete(chave))
  emAndamento.set(chave, promessa)
  return promessa
}

/** Carrega a foto uma vez só por endereço. Erro não fica em cache (tenta de novo depois). */
export function carregarFoto(url: string): Promise<HTMLImageElement> {
  const pronta = fotos.get(url)
  if (pronta) return pronta
  const promessa = new Promise<HTMLImageElement>((ok, falha) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => ok(img)
    img.onerror = () => falha(new Error(`foto não carregou: ${url}`))
    img.src = url
  })
  promessa.catch(() => fotos.delete(url))
  fotos.set(url, promessa)
  return promessa
}

/** Máscara (PNG em dataURL) da silhueta, para o chiado do indisponível ficar só sobre o produto. */
export function mascaraEmCache(chave: string, gerar: () => string): string {
  let m = mascaras.get(chave)
  if (!m) {
    m = gerar()
    mascaras.set(chave, m)
  }
  return m
}

export function jaRevelada(chave: string): boolean {
  return reveladas.has(chave)
}

export function marcarRevelada(chave: string): void {
  reveladas.add(chave)
}

/** Zera tudo (laboratório e medição de tempo). */
export function limparCacheArte(): void {
  prontas.clear()
  emAndamento.clear()
  mascaras.clear()
  reveladas.clear()
}
