import { useEffect, useRef } from 'react'
import { dentroDeIframe } from './ambiente'

// Botão "voltar" do Android (e o gesto do navegador do Instagram) fecha a camada aberta por cima,
// em vez de sair do site. Cada camada aberta empilha uma entrada no histórico.

interface Camada {
  id: string
  fechar: () => void
  /** A entrada entrou mesmo no histórico (pushState pode falhar em iframe/sandbox). */
  empilhada?: boolean
}

const pilha: Camada[] = []
/** Camadas fechadas pela interface esperando a volta do histórico (adiada para aguentar remontagem). */
const pendentes = new Set<string>()
let timerPendentes = 0
let ignorarPop = 0
let ouvindo = false
/** Quem pediu pra rodar depois que as voltas pendentes do histórico terminarem (ver depoisDoHistorico). */
let esperando: (() => void)[] = []

function liberarEsperando() {
  const fila = esperando
  esperando = []
  fila.forEach((fn) => fn())
}

function ouvir() {
  if (ouvindo) return
  ouvindo = true
  window.addEventListener('popstate', () => {
    if (ignorarPop > 0) {
      ignorarPop--
      if (ignorarPop === 0 && !timerPendentes) liberarEsperando()
      return
    }
    pilha.pop()?.fechar()
  })
}

function empilhar(c: Camada) {
  ouvir()
  // a mesma camada saiu e voltou no mesmo instante (remontagem): reaproveita a entrada do histórico
  if (pendentes.has(c.id)) {
    pendentes.delete(c.id)
    const existente = pilha.find((x) => x.id === c.id)
    if (existente) {
      existente.fechar = c.fechar
      return
    }
  }
  pilha.push(c)
  // dentro de iframe o histórico é dividido com a página de fora: não mexe (o voltar sairia do app que hospeda)
  if (dentroDeIframe()) return
  try {
    history.pushState({ ...(history.state ?? {}), gc: c.id }, '')
    c.empilhada = true
  } catch {
    /* ignora */
  }
}

function desempilhar(id: string) {
  // adiado: se a camada remontar logo em seguida, não mexe no histórico
  pendentes.add(id)
  if (timerPendentes) return
  timerPendentes = window.setTimeout(() => {
    timerPendentes = 0
    // várias camadas fechando juntas (ex.: a página do produto com 2 níveis) voltam numa viagem só:
    // dois history.back() seguidos podem virar um só em alguns navegadores e deixar entrada sobrando
    let entradas = 0
    for (const pid of pendentes) {
      const i = pilha.findIndex((c) => c.id === pid)
      if (i < 0) continue
      const [c] = pilha.splice(i, 1)
      if (c.empilhada) entradas++
    }
    pendentes.clear()
    if (!entradas) {
      if (!ignorarPop) liberarEsperando()
      return
    }
    ignorarPop++
    history.go(-entradas)
  }, 0)
}

/**
 * Roda `fn` depois que as camadas recém-fechadas saírem do histórico. Para abrir uma camada logo depois de fechar
 * outra (ex.: a página do produto fecha e o story abre): a entrada nova entra depois da volta, não antes dela,
 * e a URL que a camada nova escreve (?p=) não se perde na volta.
 */
export function depoisDoHistorico(fn: () => void) {
  // o fechamento ainda vai passar pelo commit do React (e pelos efeitos): espera a volta ser agendada
  window.setTimeout(() => {
    if (!timerPendentes && !ignorarPop) {
      fn()
      return
    }
    esperando.push(fn)
    // reserva: se o popstate não vier (navegador que não avisa), não deixa a pessoa esperando
    window.setTimeout(() => {
      if (esperando.includes(fn)) {
        esperando = esperando.filter((x) => x !== fn)
        fn()
      }
    }, 700)
  }, 30)
}

/** Liga a camada ao histórico enquanto `aberto` for true. */
export function useCamadaNoHistorico(aberto: boolean, id: string, fechar: () => void) {
  const ref = useRef(fechar)
  ref.current = fechar
  useEffect(() => {
    if (!aberto) return
    let porVoltar = false
    empilhar({
      id,
      fechar: () => {
        porVoltar = true
        ref.current()
      },
    })
    return () => {
      if (!porVoltar) desempilhar(id)
    }
  }, [aberto, id])
}
