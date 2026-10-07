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
  conferirSemCamada()
}

/** Quem espera a pilha de camadas esvaziar (ver quandoSemCamadas). */
let semCamada: (() => void)[] = []

/** Nenhuma camada aberta e nenhuma volta do histórico em andamento: roda quem esperava. */
function conferirSemCamada() {
  if (!semCamada.length || pilha.length || pendentes.size || timerPendentes || ignorarPop) return
  const fila = semCamada
  semCamada = []
  fila.forEach((fn) => fn())
}

/** Alguma camada (story, folha, página do produto, jogo) está aberta por cima da página? */
export function haCamadaAberta(): boolean {
  return pilha.length > 0
}

/** Nenhuma camada aberta nem fechando, nenhuma volta em andamento: dá para mexer no histórico já (troca de aba). */
export function historicoParado(): boolean {
  return !pilha.length && !pendentes.size && !timerPendentes && !ignorarPop
}

/**
 * Roda `fn` quando a última camada aberta fechar e a volta dela terminar no histórico (na hora, se não houver
 * nenhuma). Para o que precisa de uma entrada nova no histórico sem ficar por cima da entrada de uma camada que
 * continua aberta (ex.: a troca de aba depois de trocar de estado com o chat aberto).
 */
export function quandoSemCamadas(fn: () => void) {
  semCamada.push(fn)
  conferirSemCamada()
}

/** Quem espera a pilha chegar a um tamanho (ver quandoEmpilharem). */
let aoEmpilhar: { alvo: number; fn: () => void }[] = []

function conferirEmpilhadas() {
  if (!aoEmpilhar.length) return
  const prontos = aoEmpilhar.filter((x) => pilha.length >= x.alvo)
  if (!prontos.length) return
  aoEmpilhar = aoEmpilhar.filter((x) => pilha.length < x.alvo)
  prontos.forEach((x) => x.fn())
}

/**
 * Roda `fn` depois que mais `quantas` camadas entrarem no histórico (na hora, se nenhuma for esperada), com reserva
 * de `limite` ms. As camadas são pedaços carregados à parte e cada uma entra no histórico quando monta, em qualquer
 * ordem: quem precisa ficar por cima de camadas que acabaram de ser pedidas espera elas entrarem (ex.: o seletor
 * pedido no "Trocar" da abertura, por cima do story aberto por um link).
 */
export function quandoEmpilharem(quantas: number, fn: () => void, limite = 2500) {
  const item = { alvo: pilha.length + quantas, fn }
  if (pilha.length >= item.alvo) {
    fn()
    return
  }
  aoEmpilhar.push(item)
  window.setTimeout(() => {
    if (!aoEmpilhar.includes(item)) return
    aoEmpilhar = aoEmpilhar.filter((x) => x !== item)
    fn()
  }, limite)
}

/** Reserva do pulo de entrada velha (ver pularVelha). */
let timerPulo = 0

/**
 * Entrada de camada que nenhuma camada aberta reclama: sobrou de antes de recarregar a página (a camada reabriu numa
 * entrada nova, ou nem reabriu). Sem camada aberta, o voltar passa direto por ela, senão seria um voltar morto.
 */
function pularVelha(): boolean {
  if (pilha.length || pendentes.size || timerPendentes || dentroDeIframe()) return false
  if (typeof history.state?.gc !== 'string') return false
  ignorarPop++
  history.back()
  // reserva: no começo do histórico o back não faz nada nem avisa; o próximo voltar de verdade não pode ser engolido
  clearTimeout(timerPulo)
  timerPulo = window.setTimeout(() => {
    timerPulo = 0
    if (!ignorarPop) return
    ignorarPop = 0
    if (!timerPendentes) liberarEsperando()
  }, 800)
  return true
}

function ouvir() {
  if (ouvindo) return
  ouvindo = true
  window.addEventListener('popstate', () => {
    if (ignorarPop > 0) {
      ignorarPop--
      clearTimeout(timerPulo)
      timerPulo = 0
      if (ignorarPop === 0 && !timerPendentes && !pularVelha()) liberarEsperando()
      return
    }
    pilha.pop()?.fechar()
    if (!pularVelha()) conferirSemCamada()
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
  if (!dentroDeIframe()) {
    try {
      history.pushState({ ...(history.state ?? {}), gc: c.id }, '')
      c.empilhada = true
    } catch {
      /* ignora */
    }
  }
  conferirEmpilhadas()
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

// ouve desde já: depois de recarregar numa entrada de camada, o voltar pula as entradas velhas mesmo sem camada aberta
ouvir()

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
