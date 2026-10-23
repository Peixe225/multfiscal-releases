/**
 * Diálogos no histórico: com um diálogo aberto no celular, o "voltar" do Android fecha o diálogo de cima, em vez de
 * trocar a tela de baixo ou sair do site.
 *
 *   const soltar = abrirNoHistorico({ fechar: onClose, dispensavel: () => dismissible })
 *   …
 *   soltar()      // o diálogo fechou (pelo X, fundo, Esc, arrastando, ou porque quem usa fechou)
 *
 * Ao abrir: uma entrada nova com a MESMA URL (history.pushState({ lxModal: id, lxIdx }), sem hashchange). No voltar
 * (popstate): fecha, de cima para baixo, os diálogos cuja entrada saiu. Ao fechar por dentro: history.back() só se a
 * entrada de agora ainda é a dele — se o diálogo fechou porque a rota mudou (a entrada já é outra), não volta nada.
 * Um diálogo que fecha e outro que abre no mesmo instante (Menu → Conquistas; a espera das conquistas → o diálogo)
 * dividem a entrada: o novo fica com ela, e o voltar fecha o novo. Escolha obrigatória (dispensavel = false): o
 * voltar não fecha, a entrada volta.
 *
 * Navegar a partir de um diálogo (store/app.ts → navigate) troca a entrada dele pela tela nova.
 */
import { IDX_KEY, MODAL_KEY, aoVoltarNoHistorico, depoisDaVolta, estadoAtual, modalDaEntrada, saindoPorVolta, voltaPendente, voltarNoHistorico } from '@/store/historico'

interface Aberto {
  id: string
  fechar: () => void
  dispensavel: () => boolean
  /** A entrada dele está no histórico (é a de agora, ou está embaixo de outro diálogo). */
  naEntrada: boolean
  /** O endereço quando abriu: um popstate que muda o endereço é navegação (a rota fecha o diálogo), não "fechar". */
  hash: string
}

/** Diálogos abertos com entrada, na ordem em que abriram (o último é o de cima). */
const abertos: Aberto[] = []
let seq = 0
/** Acabou de fechar e a entrada dele ainda é a de agora: na microtarefa, ou outro diálogo fica com ela, ou volta. */
let saindo: string | null = null
let instalado = false

function instalar() {
  if (instalado) return
  instalado = true
  aoVoltarNoHistorico(aoVoltar)
}

const entrada = (id: string) => ({ [IDX_KEY]: estadoAtual()?.[IDX_KEY], [MODAL_KEY]: id })

function entrar(a: Aberto) {
  if (!abertos.includes(a) || a.naEntrada) return
  // fica com a entrada de quem acabou de fechar (no mesmo instante)
  if (saindo && modalDaEntrada() === saindo) {
    saindo = null
    history.replaceState(entrada(a.id), '', location.href)
    a.naEntrada = true
    return
  }
  // um history.back() a caminho tiraria a entrada nova: espera ele terminar
  if (voltaPendente()) return depoisDaVolta(() => entrar(a))
  history.pushState(entrada(a.id), '', location.href)
  a.naEntrada = true
}

function sair(a: Aberto) {
  const i = abertos.indexOf(a)
  if (i >= 0) abertos.splice(i, 1)
  if (!a.naEntrada) return
  a.naEntrada = false
  // a rota mudou (a entrada de agora é outra) ou uma volta pendente já tira esta entrada
  if (modalDaEntrada() !== a.id || saindoPorVolta(a.id)) return
  saindo = a.id
  queueMicrotask(() => {
    if (saindo !== a.id) return
    saindo = null
    if (modalDaEntrada() === a.id) voltarNoHistorico({ removendo: a.id })
  })
}

function aoVoltar() {
  const agora = modalDaEntrada()
  const k = agora ? abertos.findIndex((x) => x.id === agora) : -1
  for (let i = abertos.length - 1; i > k; i--) {
    const x = abertos[i]
    if (!x.naEntrada) continue
    x.naEntrada = false
    // o endereço mudou (navegação para outra tela, digitada ou de um link): quem fecha é a rota. Chamar o onClose
    // aqui deixaria o diálogo navegar por cima (o ?run= do Hall trocava a tela nova de volta pelo Hall)
    if (location.hash !== x.hash) continue
    // a entrada saiu por uma navegação no lugar (navigate replace): o diálogo, se continuar aberto, ganha outra
    if (saindoPorVolta(x.id)) {
      depoisDaVolta(() => entrar(x))
      continue
    }
    if (x.dispensavel()) x.fechar()
    // escolha obrigatória: o voltar não fecha (a entrada volta)
    else entrar(x)
  }
}

/** Põe o diálogo no histórico. Devolve o "fechou". */
export function abrirNoHistorico(o: { fechar: () => void; dispensavel?: () => boolean }): () => void {
  if (typeof window === 'undefined' || typeof history === 'undefined') return () => {}
  instalar()
  const a: Aberto = { id: `m${Date.now().toString(36)}-${++seq}`, fechar: o.fechar, dispensavel: o.dispensavel ?? (() => true), naEntrada: false, hash: location.hash }
  abertos.push(a)
  try {
    entrar(a)
  } catch {
    /* sem histórico (sandbox): o diálogo funciona como antes */
  }
  let feito = false
  return () => {
    if (feito) return
    feito = true
    try {
      sair(a)
    } catch {
      /* idem */
    }
  }
}

/** Só para os testes. */
export function _abertosNoHistorico(): string[] {
  return abertos.map((a) => a.id)
}
export function _zerarModalHistorico() {
  abertos.length = 0
  saindo = null
  instalado = false
}
