// Cache em memória das artes prontas (o mesmo produto aparece no card, no story e no hero).
// Guarda a imagem final (ImageData já com dither), a promessa em andamento (para não gerar
// duas vezes a mesma arte ao mesmo tempo), as fotos carregadas, a silhueta de cada arte (para o
// chiado do indisponível), os quadros de chiado e quais produtos já foram revelados.

const LIMITE = 160

const prontas = new Map<string, ImageData>()
const emAndamento = new Map<string, Promise<ImageData>>()
const fotos = new Map<string, Promise<HTMLImageElement>>()
const silhuetas = new Map<string, Uint8Array>()
const chiados = new Map<string, ImageData[]>()
const vizinhas = new Map<string, ImageData>()
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
          silhuetas.delete(velha)
          chiados.delete(velha)
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

/* ---------------------------------------------------------------- silhueta e chiado */

/** Silhueta da arte (alfa do produto lido antes do brilho): o chiado cai só nela, não no halo. */
export function guardarSilhueta(chave: string, silhueta: Uint8Array): void {
  silhuetas.set(chave, silhueta)
}

export function silhuetaEmCache(chave: string): Uint8Array | undefined {
  return silhuetas.get(chave)
}

/** Quadros de chiado já recortados na silhueta (gerados uma vez por arte). */
export function chiadoEmCache(chave: string, gerar: () => ImageData[]): ImageData[] {
  let q = chiados.get(chave)
  if (!q) {
    q = gerar()
    chiados.set(chave, q)
  }
  return q
}

/* ---------------------------------------------------------------- vizinha (outro tamanho) */

/**
 * Última arte pronta do mesmo produto e modo, de qualquer largura. Serve de rascunho por 1 ou 2
 * quadros quando o card (72) vira story (108) e a arte grande ainda está na fila.
 */
export function guardarVizinha(grupo: string, img: ImageData): void {
  vizinhas.set(grupo, img)
}

export function vizinhaEmCache(grupo: string): ImageData | undefined {
  return vizinhas.get(grupo)
}

/* ---------------------------------------------------------------- revelação */

/**
 * A revelação é do produto, não do tamanho: id + modo (cor ou cinza). O card de 72 e o story de
 * 108 são o mesmo elemento para quem olha; trocar disponível/indisponível revela de novo.
 */
export function chaveRevelacao(id: string, cinza: boolean): string {
  return `${id}|${cinza ? 'cinza' : 'cor'}`
}

export function jaRevelada(chave: string): boolean {
  return reveladas.has(chave)
}

export function marcarRevelada(chave: string): void {
  reveladas.add(chave)
}

/** Revelação cortada no meio (desmontou antes de acabar): na próxima vez ela aparece inteira. */
export function desmarcarRevelada(chave: string): void {
  reveladas.delete(chave)
}

/* ---------------------------------------------------------------- fila por quadro */

// Várias artes entrando juntas (grade rolando) não podem travar um quadro: cada quadro gasta
// no máximo ~6 ms gerando arte; o resto fica para o próximo. A primeira tarefa sempre roda.
const ORCAMENTO_MS = 6
const fila: (() => void)[] = []
let agendado = false

/** Tempo gasto gerando arte (para o laboratório medir sem contar a espera dos quadros). */
export const medicao = { ms: 0, artes: 0 }

function rodarFila() {
  agendado = false
  const t0 = performance.now()
  while (fila.length && performance.now() - t0 < ORCAMENTO_MS) {
    const tarefa = fila.shift()
    tarefa?.()
  }
  medicao.ms += performance.now() - t0
  if (fila.length) {
    agendado = true
    requestAnimationFrame(rodarFila)
  }
}

export function agendar<T>(tarefa: () => T): Promise<T> {
  return new Promise<T>((ok, falha) => {
    fila.push(() => {
      try {
        ok(tarefa())
        medicao.artes++
      } catch (e) {
        falha(e)
      }
    })
    if (!agendado) {
      agendado = true
      requestAnimationFrame(rodarFila)
    }
  })
}

/** Zera tudo (laboratório e medição de tempo). */
export function limparCacheArte(): void {
  prontas.clear()
  emAndamento.clear()
  silhuetas.clear()
  chiados.clear()
  vizinhas.clear()
  reveladas.clear()
  medicao.ms = 0
  medicao.artes = 0
}
