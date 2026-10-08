import { useLocal } from '../store/local'
import { useUI } from '../store/ui'
import { dentroDeIframe } from './ambiente'
import { depoisDoHistorico, haCamadaAberta, historicoParado, quandoSemCamadas } from './historico'
import { movimentoReduzido } from './movimento'
import { desviarAncoras, obterLenis, rolarPara } from './rolagem'
import { abaDaURL, atualizarParametros, lerParametros, limparHomeVelha, type Aba } from './url'

// Abas do site (Início, Catálogo, Rateio, Por estado): vistas do mesmo app, no molde das abas do Instagram.
//
// URL: ?aba=catalogo | ?aba=rateio | ?aba=estados; sem parâmetro é o Início. Cada troca empilha uma entrada NOVA no
// histórico, {gcAba}, sem espalhar o estado de quem sai: o voltar do Android (e do navegador) volta para a aba de antes,
// com a rolagem de antes (gcY). As camadas (story, sacola, jogo, chat…) empilham {...estado, gc} por cima da entrada da aba
// (src/lib/historico.ts), então fechar uma camada cai numa entrada com o MESMO gcAba e nunca troca de aba.

export type { Aba }

/** Quem trocou de aba: a abertura do site, um toque (barra, lateral, link) ou o voltar do histórico. */
export type OrigemTroca = 'boot' | 'nav' | 'volta'
/** Para onde vai o foco depois da troca: o título da vista (padrão), a busca do catálogo, ou fica onde está. */
export type FocoAba = 'titulo' | 'busca' | 'nenhum'

interface Troca {
  origem: OrigemTroca
  foco: FocoAba
  /** Rolagem a restaurar (só no voltar). */
  y: number
}

let ultima: Troca = { origem: 'boot', foco: 'nenhum', y: 0 }
/** A última troca, lida pelas Vistas logo depois de pintar a aba nova (rolagem, foco, entrada). */
export function ultimaTroca(): Troca {
  return ultima
}

/** Aba pedida esperando o histórico (camada fechando): o mesmo pedido de novo é ignorado (toques repetidos). */
let pendente: Aba | null = null

const ABAS: readonly Aba[] = ['inicio', 'catalogo', 'rateio', 'estados']
const ehAba = (v: unknown): v is Aba => typeof v === 'string' && (ABAS as readonly string[]).includes(v)

/** URL de uma aba: mantém uf e cidade; tira o que é de camada (story, página do produto, jogo, chat, rateio). */
function urlCom(a: Aba): string {
  const u = new URL(location.href)
  for (const k of ['p', 'produto', 'jogo', 'chat', 'rateio']) u.searchParams.delete(k)
  if (a === 'inicio') u.searchParams.delete('aba')
  else u.searchParams.set('aba', a)
  return u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : '') + u.hash
}

/** Topo da página: suave (corte com movimento reduzido). */
export function rolarAoTopo() {
  const l = obterLenis()
  if (l) l.scrollTo(0, { immediate: movimentoReduzido(), force: true })
  else window.scrollTo({ top: 0, behavior: movimentoReduzido() ? 'auto' : 'smooth' })
}

/** Leva até a busca do catálogo e foca o campo (a lupa tocada de novo, o "Buscar" da lateral). */
export function focarBusca(rolar = true) {
  const vista = document.querySelector<HTMLElement>('.vista[data-vista="catalogo"]')
  const filtros = vista?.querySelector<HTMLElement>('.filtros')
  const campo = vista?.querySelector<HTMLInputElement>('.busca input')
  if (rolar && filtros) {
    // no celular, o adesivo de local fica ancorado no topo (~70 px): a busca para logo abaixo dele
    const topo = window.matchMedia('(min-width: 900px)').matches ? 24 : 84
    rolarPara(filtros, -topo)
  }
  campo?.focus({ preventScroll: true })
}

/**
 * "Ver loja" do perfil: desce até os destaques do Início (suave; corte seco com movimento reduzido) e leva o foco para
 * o título da loja (o Tab seguinte cai nos destaques). Fora do Início, abre o Catálogo.
 */
export function verLoja() {
  const loja = document.querySelector<HTMLElement>('.vista[data-vista="inicio"] .catalogo-inicio')
  if (!loja || useUI.getState().aba !== 'inicio') return irParaAba('catalogo')
  // no celular, o adesivo de local fica ancorado no topo depois do story (~60 px): os destaques param logo abaixo dele
  // e o "Ver loja" some atrás dele
  const topo = window.matchMedia('(min-width: 900px)').matches ? 24 : 64
  rolarPara(loja, -topo)
  loja.querySelector<HTMLElement>('#inicio-loja-titulo')?.focus({ preventScroll: true })
}

/**
 * Troca de aba. Na aba atual: sobe ao topo (ou, com foco 'busca', vai até a busca). Senão empilha a entrada nova no
 * histórico e troca; sempre depois das voltas pendentes do histórico (ex.: a ficha "Ver o catálogo" do chat fecha o
 * chat e pede a aba), para a entrada da aba nunca ficar por cima de uma camada que está saindo.
 */
export function irParaAba(nova: Aba, op: { foco?: FocoAba } = {}) {
  if (pendente === nova) return
  const atual = useUI.getState().aba
  if (nova === atual && !pendente) {
    if (nova === 'catalogo' && op.foco === 'busca') focarBusca()
    else rolarAoTopo()
    return
  }
  pendente = nova
  const trocar = () => {
    // outro pedido de aba (ou o voltar) passou na frente: vale o último
    if (pendente !== nova) return
    // camada que continua aberta (trocar de estado na aba Por estado com o chat aberto: o chat fica): a entrada da
    // aba não pode entrar por cima da entrada dela, senão fechar a camada voltaria para a aba de antes. Troca quando
    // a última camada fechar.
    if (haCamadaAberta()) {
      quandoSemCamadas(trocar)
      return
    }
    pendente = null
    if (useUI.getState().aba === nova) return
    try {
      // guarda a rolagem de quem sai (o voltar restaura)
      history.replaceState({ ...(history.state ?? {}), gcY: Math.round(window.scrollY) }, '')
      // dentro de iframe o histórico é dividido com a página de fora: troca no lugar (mesma regra do historico.ts)
      if (dentroDeIframe()) history.replaceState({ gcAba: nova }, '', urlCom(nova))
      else history.pushState({ gcAba: nova }, '', urlCom(nova))
    } catch {
      /* sem histórico (sandbox): troca do mesmo jeito */
    }
    ultima = { origem: 'nav', foco: op.foco ?? 'titulo', y: 0 }
    useUI.getState().setAba(nova)
  }
  // toque na barra sem camada nenhuma: troca no mesmo quadro (a espera do histórico custava um quadro e meio)
  if (historicoParado()) trocar()
  else depoisDoHistorico(trocar)
}

/** Link de uma aba (href das abas da barra e da lateral: Ctrl+clique ou botão do meio abre em aba nova). */
export function hrefAba(a: Aba): string {
  const q = new URLSearchParams()
  const p = lerParametros()
  if (p.uf) q.set('uf', p.uf)
  if (p.cidade) q.set('cidade', p.cidade)
  if (a !== 'inicio') q.set('aba', a)
  const s = q.toString()
  return s ? `?${s}` : location.pathname
}

/** Clique simples que vira troca de aba (Ctrl/⌘/Shift/Alt ou botão do meio deixam o navegador abrir aba nova). */
export function cliqueDeAba(e: { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault: () => void }): boolean {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return false
  e.preventDefault()
  return true
}

let iniciado = false

/**
 * Liga as abas antes do primeiro render (main.tsx/App): normaliza ?aba, marca a entrada atual com a aba, ouve o
 * voltar, desvia as âncoras antigas e leva ao Início quando a pessoa troca de estado na aba Por estado.
 */
export function iniciarAbas() {
  if (iniciado) return
  iniciado = true
  limparHomeVelha()
  // link de um rateio (?rateio=, o adesivo de link dos stories) sem aba: a página abre por cima da aba Rateio, e fechar
  // mostra os outros rateios (troca no lugar, sem entrada nova: voltar ainda sai do site)
  if (lerParametros().rateio && !lerParametros().aba) atualizarParametros({ aba: 'rateio' })
  const a = abaDaURL()
  const pedida = lerParametros().aba
  // ?aba=inicio ou valor desconhecido (os dois caem no Início): sai da URL, o Início não tem parâmetro
  if (pedida && a === 'inicio') atualizarParametros({ aba: null })
  try {
    history.replaceState({ ...(history.state ?? {}), gcAba: a }, '')
  } catch {
    /* ignora */
  }
  if (useUI.getState().aba !== a) useUI.getState().setAba(a)

  window.addEventListener('popstate', () => {
    const st = history.state as { gcAba?: unknown; gcY?: unknown } | null
    const volta = ehAba(st?.gcAba) ? st.gcAba : abaDaURL()
    if (volta === useUI.getState().aba) return
    pendente = null
    ultima = { origem: 'volta', foco: 'titulo', y: typeof st?.gcY === 'number' ? st.gcY : 0 }
    useUI.getState().setAba(volta)
  })

  // Chat ("Ver o catálogo") e Por estado ainda rolam até #catalogo/#estados: fora da aba, a âncora abre a aba
  desviarAncoras((alvo) => {
    const destino: Aba | null = alvo === '#catalogo' ? 'catalogo' : alvo === '#estados' ? 'estados' : null
    if (!destino || useUI.getState().aba === destino) return false
    irParaAba(destino)
    return true
  })

  // Trocar de estado na aba Por estado leva ao Início, como trocar de conta no Instagram (só a troca feita pela
  // pessoa: o palpite do IP e o link da bio não tiram ninguém da aba). No Catálogo, a troca fica no Catálogo.
  useLocal.subscribe((s, antes) => {
    if (s.uf && s.uf !== antes.uf && s.origem === 'manual' && useUI.getState().aba === 'estados') irParaAba('inicio', { foco: 'nenhum' })
  })
}
