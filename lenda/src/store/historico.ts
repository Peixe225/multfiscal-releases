/**
 * O histórico do navegador — o "voltar" do Android (e do navegador) faz o que a pessoa espera.
 *
 *   marcarEntrada()                 // roteador, a cada hashchange: 'nova' | 'voltar' | 'avancar'
 *   entradaAtual()                  // o número da entrada de agora (a chave da posição de rolagem)
 *   voltarNoHistorico({ removendo }) // history.back() que o resto do jogo sabe que está a caminho
 *   depoisDaVolta(fn)               // roda fn quando a volta pendente terminar (ou já, se não há)
 *   aoVoltarNoHistorico(fn)         // ouvir o popstate antes da contabilidade daqui (os diálogos)
 *
 * Cada entrada do jogo ganha um número crescente no history.state (`lxIdx`): ao chegar numa entrada que já tem
 * número, o roteador sabe se foi "voltar" ou "avançar" (o hashchange não diz). Os diálogos abertos no celular
 * ganham uma entrada própria com a MESMA URL (`lxModal`, ver ui/primitives/modalHistorico.ts) e o mesmo número
 * da entrada de baixo.
 *
 * O history.back() é assíncrono: uma navegação feita antes de ele terminar seria desfeita por ele (a entrada nova
 * entra e a volta tira ela). Por isso quem navega (navigate) espera a volta pendente terminar.
 */
export const MODAL_KEY = 'lxModal'
export const IDX_KEY = 'lxIdx'

type Estado = Record<string, unknown>

/** O history.state de agora, se for um objeto. */
export function estadoAtual(): Estado | null {
  try {
    const s = history.state as unknown
    return s && typeof s === 'object' ? (s as Estado) : null
  } catch {
    return null
  }
}

/** O diálogo dono da entrada de agora (null: entrada de uma tela). */
export function modalDaEntrada(): string | null {
  const v = estadoAtual()?.[MODAL_KEY]
  return typeof v === 'string' ? v : null
}

// ───────────────────────── número das entradas ─────────────────────────

let ultimoIdx = 0
let idxAtual: number | null = null

/** Número novo, sempre maior que os de antes (também os de antes de recarregar a página: é a hora em ms). */
export function novoIdx(): number {
  ultimoIdx = Math.max(ultimoIdx + 1, Date.now())
  return ultimoIdx
}

export const entradaAtual = () => idxAtual

/** O roteador chegou numa entrada (hashchange ou a abertura): numera a nova e diz de onde veio. */
export function marcarEntrada(): 'nova' | 'voltar' | 'avancar' {
  const st = estadoAtual()
  const v = st?.[IDX_KEY]
  if (typeof v !== 'number') {
    const i = novoIdx()
    try {
      history.replaceState({ ...(st ?? {}), [IDX_KEY]: i }, '', location.href)
    } catch {
      /* sem histórico: segue sem número */
    }
    idxAtual = i
    return 'nova'
  }
  ultimoIdx = Math.max(ultimoIdx, v)
  const tipo = idxAtual == null || v === idxAtual ? 'nova' : v < idxAtual ? 'voltar' : 'avancar'
  idxAtual = v
  return tipo
}

/** A entrada de agora foi trocada (replaceState) por uma tela nova: ganha número novo. */
export function entradaTrocada(i: number) {
  idxAtual = i
  ultimoIdx = Math.max(ultimoIdx, i)
}

// ───────────────────────── voltas pendentes ─────────────────────────

let pendentes = 0
const removendo = new Set<string>()
let depois: (() => void)[] = []
let seguranca: ReturnType<typeof setTimeout> | 0 = 0
const ouvintes = new Set<() => void>()
let instalado = false

function instalar() {
  if (instalado || typeof window === 'undefined') return
  instalado = true
  window.addEventListener('popstate', aoPop)
}

function aoPop() {
  for (const f of [...ouvintes]) {
    try {
      f()
    } catch (e) {
      console.error('[LENDA] popstate', e)
    }
  }
  if (pendentes > 0 && --pendentes === 0) terminar()
}

function terminar() {
  pendentes = 0
  removendo.clear()
  if (seguranca) clearTimeout(seguranca)
  seguranca = 0
  const fs = depois
  depois = []
  for (const f of fs) f()
}

/** Ouvir o popstate (os diálogos). Roda antes de a volta pendente ser dada como terminada. */
export function aoVoltarNoHistorico(fn: () => void): () => void {
  instalar()
  ouvintes.add(fn)
  return () => {
    ouvintes.delete(fn)
  }
}

/** history.back() avisando o resto do jogo. `removendo`: a entrada de diálogo que esta volta tira. */
export function voltarNoHistorico(o: { removendo?: string } = {}) {
  instalar()
  pendentes++
  if (o.removendo) removendo.add(o.removendo)
  if (seguranca) clearTimeout(seguranca)
  // a volta que não acontece (início do histórico) não dá popstate: não espera para sempre
  seguranca = setTimeout(terminar, 800)
  history.back()
}

export const voltaPendente = () => pendentes > 0
/** A entrada deste diálogo já está saindo por uma volta pendente. */
export const saindoPorVolta = (id: string) => removendo.has(id)

/** Roda `fn` depois da volta pendente (ou já). */
export function depoisDaVolta(fn: () => void) {
  if (!pendentes) fn()
  else depois.push(fn)
}

/** Só para os testes. */
export function _zerarHistorico() {
  pendentes = 0
  removendo.clear()
  depois = []
  ouvintes.clear()
  if (seguranca) clearTimeout(seguranca)
  seguranca = 0
  idxAtual = null
  ultimoIdx = 0
  if (instalado && typeof window !== 'undefined') window.removeEventListener('popstate', aoPop)
  instalado = false
}
