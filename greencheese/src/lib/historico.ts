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
const pendentes = new Map<string, number>()
let ignorarPop = 0
let ouvindo = false

function ouvir() {
  if (ouvindo) return
  ouvindo = true
  window.addEventListener('popstate', () => {
    if (ignorarPop > 0) {
      ignorarPop--
      return
    }
    pilha.pop()?.fechar()
  })
}

function empilhar(c: Camada) {
  ouvir()
  // a mesma camada saiu e voltou no mesmo instante (remontagem): reaproveita a entrada do histórico
  const t = pendentes.get(c.id)
  if (t !== undefined) {
    clearTimeout(t)
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
  pendentes.set(
    id,
    window.setTimeout(() => {
      pendentes.delete(id)
      const i = pilha.findIndex((c) => c.id === id)
      if (i < 0) return
      const [c] = pilha.splice(i, 1)
      if (!c.empilhada) return
      ignorarPop++
      history.back()
    }, 0),
  )
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
